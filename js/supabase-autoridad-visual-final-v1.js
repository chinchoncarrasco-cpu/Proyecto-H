// ========================================
// HAIKU · AUTORIDAD VISUAL FINAL V1
// Una sola autoridad para Resumen + Calendario en los estados que se estaban
// sobrescribiendo entre módulos legacy y Supabase.
//
// Reglas:
// - Supabase (haiku_operacion_dia) decide SALE/BLOQ y contador SALEN.
// - Checkout real domina sobre check-in histórico en una salida normal.
// - Un bloqueo activo siempre domina visualmente en rojo.
// - Al terminar una rehidratación comercial del Calendario, los bloqueos se
//   materializan de nuevo desde Supabase antes del render final.
// - Sin polling, setInterval ni MutationObserver global.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_AUTORIDAD_VISUAL_FINAL_V1) return;

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const colorLegacy =
        typeof window.actualizarColorCabana === "function"
            ? window.actualizarColorCabana
            : null;

    const resumenLegacy =
        typeof window.actualizarResumenDia === "function"
            ? window.actualizarResumenDia
            : null;

    const generarCalendarioLegacy =
        typeof window.generarCalendario === "function"
            ? window.generarCalendario
            : null;

    const operacionPorFecha = new Map();
    const salenPorFecha = new Map();

    let consultando = false;
    let fechaPendiente = "";
    let esperandoRenderPostSyncCalendario = false;
    let rehidratandoBloqueos = false;
    let canal = null;
    let timer = null;

    function fechaActual() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
        } catch (_) {
            return "";
        }
    }

    function esSaleBloq(fila) {
        return Boolean(fila?.bloqueo_id && fila?.salida_estadia_id);
    }

    function titularPrincipal(fila) {
        if (esSaleBloq(fila)) {
            return fila?.salida_titular || "Sin titular";
        }

        switch (String(fila?.estado_operativo || "")) {
            case "sale-ingresa":
            case "libre-ingresa":
                return fila?.ingreso_titular || "Sin titular";
            case "sale-libre":
                return fila?.salida_titular || "Sin titular";
            case "continua":
                return fila?.continua_titular || "Sin titular";
            case "fullday":
                return fila?.fullday_titular || "Sin titular";
            case "bloqueada":
                return "BLOQUEADA";
            default:
                return "Sin titular";
        }
    }

    function asegurarOpcionSaleBloq(selector) {
        if (!selector) return;

        const existente = Array.from(selector.options || [])
            .find(opcion => opcion.value === "sale-bloqueada");
        if (existente) return;

        const opcion = document.createElement("option");
        opcion.value = "sale-bloqueada";
        opcion.textContent = "SALE / BLOQ.";
        opcion.disabled = true;

        const bloqueada = Array.from(selector.options || [])
            .find(opcionActual => opcionActual.value === "bloqueada");

        if (bloqueada?.nextSibling) {
            selector.insertBefore(opcion, bloqueada.nextSibling);
        } else {
            selector.appendChild(opcion);
        }
    }

    function limpiarColor(tr) {
        tr?.classList.remove(
            "cabana-checkout",
            "cabana-checkin",
            "cabana-libre",
            "cabana-ingresa",
            "cabana-sale-libre",
            "cabana-bloqueada"
        );
    }

    function aplicarFallbackColor(tr, fila, fecha) {
        if (!tr) return;

        const numero = String(fila?.numero || tr.dataset?.cabana || "");
        let cabana = null;
        try {
            cabana = obtenerDatosDia(fecha)?.cabanas?.[numero] || null;
        } catch (_) {}

        limpiarColor(tr);

        if (fila?.bloqueo_id || String(cabana?.estado || "") === "bloqueada") {
            tr.classList.add("cabana-bloqueada");
            return;
        }

        if (fila?.salida_checkout_en || cabana?.checkoutRealizado === true || String(cabana?.checkout || "").trim()) {
            tr.classList.add("cabana-checkout");
            return;
        }

        if (cabana?.checkinRealizado === true || fila?.ingreso_checkin_en) {
            tr.classList.add("cabana-checkin");
            return;
        }

        const estado = String(fila?.estado_operativo || cabana?.estado || "");
        if (estado === "sale-libre") {
            tr.classList.add("cabana-sale-libre");
        } else if (estado === "libre-ingresa" || estado === "sale-ingresa") {
            tr.classList.add("cabana-ingresa");
        } else {
            tr.classList.add("cabana-libre");
        }
    }

    function aplicarFila(fila, fecha = fechaActual()) {
        const numero = String(fila?.numero || "");
        if (!numero || !fecha) return false;

        const tr = document.querySelector(
            `#seccion-resumen tr[data-cabana="${CSS.escape(numero)}"]`
        );
        if (!tr) return false;

        const saleBloq = esSaleBloq(fila);
        const selector = tr.querySelector('[data-campo="estado"]');

        if (selector) {
            if (saleBloq) {
                asegurarOpcionSaleBloq(selector);
                selector.value = "sale-bloqueada";
            } else if (fila?.bloqueo_id) {
                selector.value = "bloqueada";
            } else {
                const estado = String(fila?.estado_operativo || "");
                if (Array.from(selector.options || []).some(op => op.value === estado)) {
                    selector.value = estado;
                }
            }
        }

        const titular = tr.querySelector(
            `[data-titular-cabana="${CSS.escape(numero)}"]`
        );
        if (titular) titular.textContent = titularPrincipal(fila);

        if (fila?.bloqueo_id) {
            limpiarColor(tr);
            tr.classList.add("cabana-bloqueada");
            tr.dataset.haikuBloqueoActivo = "1";
            tr.dataset.haikuSaleBloq = saleBloq ? "1" : "0";
            const motivo = String(fila?.bloqueo_motivo || "").trim();
            if (motivo) tr.title = `Bloqueada · ${motivo}`;
            return true;
        }

        delete tr.dataset.haikuBloqueoActivo;
        delete tr.dataset.haikuSaleBloq;
        if (tr.title?.startsWith("Bloqueada ·")) tr.removeAttribute("title");

        const apiCheckout = window.HAIKU_CHECKOUT_RESUMEN_V2;
        if (apiCheckout?.aplicarColorFila) {
            apiCheckout.aplicarColorFila(numero, fecha);
        } else {
            aplicarFallbackColor(tr, fila, fecha);
        }

        return true;
    }

    function aplicarFilasFecha(fecha) {
        const mapa = operacionPorFecha.get(fecha);
        if (!mapa) return;
        mapa.forEach(fila => aplicarFila(fila, fecha));
    }

    function fijarContadorSalen(fecha) {
        const cantidad = salenPorFecha.get(fecha);
        if (cantidad == null) return;

        const contador = document.getElementById("contador-salen");
        if (!contador) return;

        contador.textContent = String(cantidad);
        contador.dataset.haikuAutoridad = "supabase";
        contador.dataset.haikuValor = String(cantidad);
    }

    async function consultarOperacion(fechaForzada = "") {
        const fecha = String(fechaForzada || fechaActual()).slice(0, 10);
        if (!fecha || !window.haikuSesion) return [];

        if (consultando) {
            fechaPendiente = fecha;
            return [];
        }

        consultando = true;
        try {
            const { data, error } = await cliente.rpc(
                "haiku_operacion_dia",
                { p_fecha: fecha }
            );
            if (error) throw error;

            const filas = Array.isArray(data) ? data : [];
            operacionPorFecha.set(
                fecha,
                new Map(filas.map(fila => [String(fila?.numero || ""), fila]))
            );

            salenPorFecha.set(
                fecha,
                filas.filter(fila => Boolean(fila?.salida_estadia_id || fila?.fullday_estadia_id)).length
            );

            if (fechaActual() === fecha) {
                aplicarFilasFecha(fecha);
                fijarContadorSalen(fecha);
            }

            return filas;
        } catch (error) {
            console.warn("HAIKU · Autoridad visual: no fue posible consultar operación:", error);
            return [];
        } finally {
            consultando = false;
            const pendiente = fechaPendiente;
            fechaPendiente = "";
            if (pendiente && pendiente !== fecha) {
                setTimeout(() => consultarOperacion(pendiente), 0);
            }
        }
    }

    async function rehidratarBloqueosYFinalizar(fecha = fechaActual()) {
        if (rehidratandoBloqueos || !fecha || !window.haikuSesion) return;
        rehidratandoBloqueos = true;

        try {
            await window.HAIKU_BLOQUEOS_CALENDARIO_SUPABASE_V1?.refrescar?.();
            await consultarOperacion(fecha);
            try {
                await window.HAIKU_CHECKOUT_AUTORIDAD_V1?.sincronizar?.({
                    regenerarCalendario: false
                });
            } catch (_) {}

            aplicarFilasFecha(fecha);
            fijarContadorSalen(fecha);

            try { window.HAIKU_VINCULOS_ESTABLES_V1?.refrescarCalendario?.(); } catch (_) {}
        } finally {
            rehidratandoBloqueos = false;
        }
    }

    if (colorLegacy) {
        window.actualizarColorCabana = function (tr) {
            const fecha = fechaActual();
            const numero = String(tr?.dataset?.cabana || "");
            const fila = operacionPorFecha.get(fecha)?.get(numero);

            if (fila) {
                aplicarFila(fila, fecha);
                return;
            }

            try {
                const cabana = obtenerDatosDia(fecha)?.cabanas?.[numero] || {};
                if (String(cabana?.estado || "") === "bloqueada") {
                    limpiarColor(tr);
                    tr.classList.add("cabana-bloqueada");
                    return;
                }
            } catch (_) {}

            if (window.HAIKU_CHECKOUT_RESUMEN_V2?.aplicarColorFila) {
                window.HAIKU_CHECKOUT_RESUMEN_V2.aplicarColorFila(numero, fecha);
                return;
            }

            colorLegacy(tr);
        };
    }

    if (resumenLegacy) {
        window.actualizarResumenDia = function (fecha) {
            const resultado = resumenLegacy(fecha);
            const clave = String(fecha || fechaActual()).slice(0, 10);
            fijarContadorSalen(clave);
            if (clave === fechaActual()) aplicarFilasFecha(clave);
            return resultado;
        };
    }

    if (generarCalendarioLegacy) {
        window.generarCalendario = function (...args) {
            const resultado = generarCalendarioLegacy.apply(this, args);

            if (esperandoRenderPostSyncCalendario && !rehidratandoBloqueos) {
                esperandoRenderPostSyncCalendario = false;
                queueMicrotask(() => rehidratarBloqueosYFinalizar(fechaActual()));
            }

            return resultado;
        };
    }

    document.addEventListener("click", evento => {
        if (evento.target?.closest?.('[data-seccion="calendario"]')) {
            esperandoRenderPostSyncCalendario = true;
            return;
        }

        if (evento.target?.closest?.('[data-seccion="resumen"]')) {
            requestAnimationFrame(() => consultarOperacion(fechaActual()));
        }
    });

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(async () => {
            await window.HAIKU_BLOQUEOS_CALENDARIO_SUPABASE_V1?.refrescar?.();
            await consultarOperacion(fechaActual());
            aplicarFilasFecha(fechaActual());
            fijarContadorSalen(fechaActual());
        }, 220);
    });

    window.addEventListener("pageshow", () => {
        setTimeout(() => rehidratarBloqueosYFinalizar(fechaActual()), 180);
    });

    window.addEventListener("focus", () => {
        setTimeout(() => rehidratarBloqueosYFinalizar(fechaActual()), 180);
    });

    function programarRefresco() {
        clearTimeout(timer);
        timer = setTimeout(() => rehidratarBloqueosYFinalizar(fechaActual()), 100);
    }

    function instalarRealtime() {
        if (canal || !window.haikuSesion) return;
        canal = cliente
            .channel("haiku-autoridad-visual-final-v1")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "bloqueos_cabana" },
                programarRefresco
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "reserva_estadias" },
                programarRefresco
            )
            .subscribe();
    }

    window.addEventListener("haiku:auth-ready", () => setTimeout(instalarRealtime, 260));
    setTimeout(() => {
        if (window.haikuSesion) {
            instalarRealtime();
            rehidratarBloqueosYFinalizar(fechaActual());
        }
    }, 320);

    window.HAIKU_AUTORIDAD_VISUAL_FINAL_V1 = Object.freeze({
        refrescar: rehidratarBloqueosYFinalizar,
        consultarOperacion,
        aplicar: () => {
            const fecha = fechaActual();
            aplicarFilasFecha(fecha);
            fijarContadorSalen(fecha);
        }
    });

    console.info("HAIKU · Autoridad Visual Final V1 preparada.");
})();
