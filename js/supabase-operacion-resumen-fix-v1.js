// ========================================
// HAIKU · OPERACIÓN RESUMEN FIX V4
// Supabase = autoridad para la operación diaria.
//
// Objetivos:
// - BLOQUEO + SALIDA se muestra como SALE / BLOQ. sin perder ninguna verdad.
// - El bloqueo sigue guardado como BLOQUEADA en el cache para que el Calendario
//   legacy conserve su barra roja de forma estable.
// - El contador SALEN se calcula desde las salidas reales de Supabase.
// - Los colores del resto de filas quedan a cargo de Checkout/Resumen V2.
// - BLOQUEADA y SALE / BLOQ. tienen prioridad visual roja.
// - Sin setInterval, polling, MutationObserver ni parches globales.
// ========================================
(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let sincronizando = false;
    let fechaPendiente = "";
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
                return fila.ingreso_titular || "Sin titular";
            case "sale-libre":
                return fila.salida_titular || "Sin titular";
            case "continua":
                return fila.continua_titular || "Sin titular";
            case "fullday":
                return fila.fullday_titular || "Sin titular";
            case "bloqueada":
                return "BLOQUEADA";
            default:
                return "Sin titular";
        }
    }

    function leerCache() {
        try {
            return JSON.parse(localStorage.getItem("haikuDatos") || "{}") || {};
        } catch (_) {
            return {};
        }
    }

    function asegurarDia(datos, fecha) {
        if (!datos[fecha]) {
            datos[fecha] = {
                encargado: "",
                notas: "",
                notasOperativas: [],
                cabanas: {},
                servicios: [],
                pagos: [],
                mantencion: [],
                lavanderia: []
            };
        }
        if (!datos[fecha].cabanas) datos[fecha].cabanas = {};
        return datos[fecha];
    }

    function guardarCache(datos) {
        try {
            localStorage.setItem("haikuDatos", JSON.stringify(datos));
        } catch (_) {}

        try {
            if (typeof datosPorFecha !== "undefined") {
                datosPorFecha = datos;
            }
        } catch (_) {}
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
            .find(item => item.value === "bloqueada");

        if (bloqueada?.nextSibling) {
            selector.insertBefore(opcion, bloqueada.nextSibling);
        } else {
            selector.appendChild(opcion);
        }
    }

    function limpiarColorFila(fila) {
        fila?.classList.remove(
            "cabana-checkout",
            "cabana-checkin",
            "cabana-libre",
            "cabana-ingresa",
            "cabana-sale-libre",
            "cabana-bloqueada"
        );
    }

    function aplicarRojo(fila, motivo = "") {
        if (!fila) return;
        limpiarColorFila(fila);
        fila.classList.add("cabana-bloqueada");
        if (motivo) fila.title = `Bloqueada · ${motivo}`;
    }

    function aplicarFilaVisual(fila) {
        const numero = String(fila?.numero || "");
        if (!numero) return;

        const tr = document.querySelector(
            `#seccion-resumen tr[data-cabana="${CSS.escape(numero)}"]`
        );
        if (!tr) return;

        const saleBloq = esSaleBloq(fila);
        const estadoReal = String(fila?.estado_operativo || "libre-libre");
        const estadoVisual = saleBloq ? "sale-bloqueada" : estadoReal;
        const selector = tr.querySelector('[data-campo="estado"]');

        if (selector) {
            if (saleBloq) asegurarOpcionSaleBloq(selector);

            const existe = Array.from(selector.options || [])
                .some(opcion => opcion.value === estadoVisual);

            if (existe) selector.value = estadoVisual;
        }

        const titular = tr.querySelector(
            `[data-titular-cabana="${CSS.escape(numero)}"]`
        );
        if (titular) titular.textContent = titularPrincipal(fila);

        if (fila?.bloqueo_id) {
            tr.dataset.haikuBloqueoActivo = "1";
            tr.dataset.haikuSaleBloq = saleBloq ? "1" : "0";
            aplicarRojo(tr, String(fila?.bloqueo_motivo || "").trim());
        } else {
            delete tr.dataset.haikuBloqueoActivo;
            delete tr.dataset.haikuSaleBloq;
            if (tr.title?.startsWith("Bloqueada ·")) tr.removeAttribute("title");
        }
    }

    function actualizarContadorSalidas(filas) {
        const contador = document.getElementById("contador-salen");
        if (!contador) return;

        const cantidad = (filas || []).filter(fila =>
            Boolean(fila?.salida_estadia_id || fila?.fullday_estadia_id)
        ).length;

        contador.textContent = String(cantidad);
    }

    function estabilizarColores(filas, fecha) {
        // Primero dejamos que la autoridad existente resuelva Checkout vs Hospedado
        // para las filas normales. Después el bloqueo vuelve a imponer rojo.
        try {
            window.HAIKU_CHECKOUT_RESUMEN_V2?.aplicarColores?.(fecha);
        } catch (_) {}

        (filas || [])
            .filter(fila => Boolean(fila?.bloqueo_id))
            .forEach(aplicarFilaVisual);
    }

    async function refrescar(fechaForzada = "") {
        const fecha = String(fechaForzada || fechaActual()).slice(0, 10);
        if (!fecha || !window.haikuSesion) return false;

        if (sincronizando) {
            fechaPendiente = fecha;
            return false;
        }

        sincronizando = true;

        try {
            const { data, error } = await cliente.rpc(
                "haiku_operacion_dia",
                { p_fecha: fecha }
            );
            if (error) throw error;

            const filas = Array.isArray(data) ? data : [];
            const cache = leerCache();
            const dia = asegurarDia(cache, fecha);

            filas.forEach(fila => {
                const numero = String(fila?.numero || "");
                if (!numero) return;

                const anterior = dia.cabanas[numero] || {};
                const estadoReal = String(fila?.estado_operativo || "libre-libre");
                const titular = titularPrincipal(fila);

                // El cache conserva BLOQUEADA porque calendario.js legacy todavía
                // materializa la barra desde ese estado. En SALE/BLOQ sí conservamos
                // el titular saliente para no perder la información operativa.
                dia.cabanas[numero] = {
                    ...anterior,
                    estado: estadoReal,
                    titular:
                        titular === "Sin titular" || titular === "BLOQUEADA"
                            ? ""
                            : titular
                };
            });

            guardarCache(cache);

            if (fechaActual() === fecha) {
                filas.forEach(aplicarFilaVisual);
                actualizarContadorSalidas(filas);
                estabilizarColores(filas, fecha);
            }

            console.info(
                "HAIKU · Operación Resumen V4:",
                fecha,
                "· salidas",
                filas.filter(f => f?.salida_estadia_id || f?.fullday_estadia_id).length,
                "· SALE/BLOQ",
                filas.filter(esSaleBloq).length
            );

            return true;
        } catch (error) {
            console.warn("HAIKU · No fue posible hidratar la operación diaria:", error);
            return false;
        } finally {
            sincronizando = false;

            const pendiente = fechaPendiente;
            fechaPendiente = "";
            if (pendiente && pendiente !== fecha) {
                programar(30, pendiente);
            }
        }
    }

    function programar(ms = 90, fecha = "") {
        clearTimeout(timer);
        timer = setTimeout(() => refrescar(fecha || fechaActual()), ms);
    }

    function instalarRealtime() {
        if (canal || !window.haikuSesion) return;

        canal = cliente
            .channel("haiku-operacion-resumen-v4")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "bloqueos_cabana" },
                () => programar(90, fechaActual())
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "reserva_estadias" },
                () => programar(90, fechaActual())
            )
            .subscribe();
    }

    document.addEventListener("click", evento => {
        if (evento.target?.closest?.(".dia-calendario")) {
            // El handler legacy cambia fechaSeleccionada durante el mismo click.
            setTimeout(() => programar(20, fechaActual()), 0);
            return;
        }

        if (
            evento.target?.closest?.('[data-seccion="resumen"]') ||
            evento.target?.closest?.("#confirmar-bloqueo-calendario") ||
            evento.target?.closest?.(".haiku-bloqueo-liberar-confirmar")
        ) {
            programar(80, fechaActual());
        }
    }, true);

    document.addEventListener("change", evento => {
        if (evento.target?.closest?.("#seccion-resumen tr[data-cabana]")) {
            programar(60, fechaActual());
        }
    });

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(() => {
            instalarRealtime();
            refrescar(fechaActual());
        }, 120);
    });

    window.addEventListener("pageshow", () => {
        setTimeout(() => refrescar(fechaActual()), 120);
    });

    window.addEventListener("focus", () => {
        setTimeout(() => refrescar(fechaActual()), 120);
    });

    setTimeout(() => {
        if (window.haikuSesion) {
            instalarRealtime();
            refrescar(fechaActual());
        }
    }, 220);

    window.HAIKU_OPERACION_RESUMEN_FIX_V1 = Object.freeze({
        refrescar,
        esSaleBloq
    });

    console.info("HAIKU · Operación Resumen Fix V4 preparado.");
})();