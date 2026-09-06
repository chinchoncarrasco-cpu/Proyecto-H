// ========================================
// HAIKU · SALE / BLOQ. V1
// Estado VISUAL derivado para una cabaña que simultáneamente:
// - tiene una salida de alojamiento ese día; y
// - tiene un bloqueo activo ese día.
//
// Importante:
// - NO reemplaza ni modifica el bloqueo real.
// - NO escribe reservas ni bloqueos.
// - El calendario sigue usando el bloqueo real y por eso conserva el rojo.
// - El Resumen muestra SALE / BLOQ. y el contador SALEN usa la operación real.
// - Sin polling, MutationObserver ni parches globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_SALE_BLOQ_V1) return;

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let consultando = false;
    let fechaPendiente = "";
    let canal = null;
    let timer = null;
    let timerSegundaPasada = null;

    function fechaActual() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
        } catch (_) {
            return "";
        }
    }

    function programar(ms = 80, fecha = "") {
        clearTimeout(timer);
        timer = setTimeout(() => refrescar(fecha), ms);
    }

    function programarDoble(fecha = "") {
        const objetivo = String(fecha || fechaActual()).slice(0, 10);
        if (!objetivo) return;

        programar(100, objetivo);

        // supabase-operacion-resumen-fix-v1 hace una segunda hidratación
        // alrededor de 420 ms. Reaplicamos después para que SALE/BLOQ. sea
        // el estado visual definitivo y el rojo no vuelva a ser reemplazado.
        clearTimeout(timerSegundaPasada);
        timerSegundaPasada = setTimeout(() => {
            if (fechaActual() === objetivo) refrescar(objetivo);
        }, 560);
    }

    function asegurarOpcionSaleBloq(selector) {
        if (!selector) return null;

        let opcion = Array.from(selector.options || []).find(
            item => item.value === "sale-bloqueada"
        );

        if (!opcion) {
            opcion = document.createElement("option");
            opcion.value = "sale-bloqueada";
            opcion.textContent = "SALE / BLOQ.";
            opcion.disabled = true;

            const bloqueada = Array.from(selector.options || []).find(
                item => item.value === "bloqueada"
            );

            if (bloqueada?.nextSibling) {
                selector.insertBefore(opcion, bloqueada.nextSibling);
            } else {
                selector.appendChild(opcion);
            }
        }

        return opcion;
    }

    function titularReal(fila) {
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

    function limpiarClasesOperativas(tr) {
        tr?.classList.remove(
            "cabana-checkout",
            "cabana-checkin",
            "cabana-libre",
            "cabana-ingresa",
            "cabana-bloqueada"
        );
    }

    function aplicarRojoPrioritario(tr) {
        if (!tr) return;
        limpiarClasesOperativas(tr);
        tr.classList.add("cabana-bloqueada");
        tr.dataset.haikuSaleBloq = "1";
    }

    function restaurarFilaSiEraDerivada(tr, fila) {
        if (!tr || tr.dataset.haikuSaleBloq !== "1") return;

        delete tr.dataset.haikuSaleBloq;

        const selector = tr.querySelector('[data-campo="estado"]');
        if (selector && selector.value === "sale-bloqueada") {
            const estado = String(fila?.estado_operativo || "");
            const existe = Array.from(selector.options || []).some(
                item => item.value === estado
            );
            if (existe) selector.value = estado;
        }

        const numero = String(fila?.numero || "");
        const titular = tr.querySelector(`[data-titular-cabana="${numero}"]`);
        if (titular) titular.textContent = titularReal(fila);

        try {
            if (typeof actualizarColorCabana === "function") {
                actualizarColorCabana(tr);
            }
        } catch (_) {}
    }

    function aplicarFila(fila) {
        const numero = String(fila?.numero || "");
        if (!numero) return;

        const tr = document.querySelector(
            `#seccion-resumen tbody tr[data-cabana="${numero}"]`
        );
        if (!tr) return;

        const saleBloq = Boolean(fila?.bloqueo_id && fila?.salida_estadia_id);

        if (!saleBloq) {
            restaurarFilaSiEraDerivada(tr, fila);
            return;
        }

        const selector = tr.querySelector('[data-campo="estado"]');
        asegurarOpcionSaleBloq(selector);
        if (selector) selector.value = "sale-bloqueada";

        const titular = tr.querySelector(`[data-titular-cabana="${numero}"]`);
        if (titular) {
            titular.textContent = fila.salida_titular || "Sin titular";
        }

        // El rojo de BLOQ. tiene prioridad incluso si se marca Check-out.
        aplicarRojoPrioritario(tr);
    }

    function actualizarContadorSalidas(filas) {
        const contador = document.getElementById("contador-salen");
        if (!contador) return;

        const cantidad = (filas || []).filter(fila =>
            Boolean(fila?.salida_estadia_id || fila?.fullday_estadia_id)
        ).length;

        contador.textContent = String(cantidad);
    }

    async function refrescar(fechaForzada = "") {
        const fecha = String(fechaForzada || fechaActual()).slice(0, 10);
        if (!fecha || !window.haikuSesion) return;

        if (consultando) {
            fechaPendiente = fecha;
            return;
        }

        consultando = true;

        try {
            const { data, error } = await cliente.rpc(
                "haiku_operacion_dia",
                { p_fecha: fecha }
            );
            if (error) throw error;

            const filas = Array.isArray(data) ? data : [];

            if (fechaActual() === fecha) {
                filas.forEach(aplicarFila);
                actualizarContadorSalidas(filas);
            }

            console.info(
                "HAIKU · SALE/BLOQ derivado:",
                fecha,
                filas.filter(f => f?.bloqueo_id && f?.salida_estadia_id).length,
                "cabañas"
            );
        } catch (error) {
            console.warn("HAIKU · No fue posible derivar SALE/BLOQ:", error);
        } finally {
            consultando = false;
            const pendiente = fechaPendiente;
            fechaPendiente = "";
            if (pendiente && pendiente !== fecha) {
                programar(30, pendiente);
            }
        }
    }

    function instalarRealtime() {
        if (canal || !window.haikuSesion) return;

        canal = cliente
            .channel("haiku-sale-bloq-v1")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "bloqueos_cabana" },
                () => programarDoble(fechaActual())
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "reserva_estadias" },
                () => programarDoble(fechaActual())
            );

        canal.subscribe();
    }

    // Después de las acciones locales, reaplicamos únicamente la prioridad roja
    // y el estado visual derivado. No bloqueamos ni sustituimos ningún handler.
    document.addEventListener("change", evento => {
        if (evento.target?.closest?.("#seccion-resumen [data-cabana]")) {
            programarDoble(fechaActual());
        }
    });

    document.addEventListener("click", evento => {
        if (
            evento.target?.closest?.(".dia-calendario") ||
            evento.target?.closest?.('[data-seccion="resumen"]') ||
            evento.target?.closest?.(".haiku-bloqueo-liberar-confirmar") ||
            evento.target?.closest?.("#confirmar-bloqueo-calendario")
        ) {
            programarDoble(fechaActual());
        }
    }, true);

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(() => {
            instalarRealtime();
            programarDoble(fechaActual());
        }, 140);
    });

    window.addEventListener("pageshow", () => {
        setTimeout(() => programarDoble(fechaActual()), 140);
    });

    window.addEventListener("focus", () => {
        setTimeout(() => programarDoble(fechaActual()), 120);
    });

    setTimeout(() => {
        if (window.haikuSesion) {
            instalarRealtime();
            programarDoble(fechaActual());
        }
    }, 260);

    window.HAIKU_SALE_BLOQ_V1 = Object.freeze({
        refrescar,
        esSaleBloq: fila => Boolean(fila?.bloqueo_id && fila?.salida_estadia_id)
    });

    console.info("HAIKU · SALE / BLOQ. V1 preparado.");
})();