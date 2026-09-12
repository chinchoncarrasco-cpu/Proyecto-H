// ========================================
// HAIKU · ESTADOS DE RESERVA SUPABASE V2
// Cancelación inmediata + Full Day en Calendario
// + liberación operativa anticipada.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let cancelando = false;
    let liberandoFullDay = false;
    let parcheCalendarioInstalado = false;

    const CLASES_COLOR_CALENDARIO = [
        "cal-reserva-checkout",
        "cal-reserva-checkin",
        "cal-reserva-bloqueada",
        "cal-reserva-confirmada",
        "cal-reserva-confirmacion-pendiente",
        "cal-reserva-fullday"
    ];

    function cerrarMenuEstado() {
        try {
            if (typeof cerrarMenuEstadoFicha === "function") {
                cerrarMenuEstadoFicha();
            }
        } catch (_) {}
    }

    function cerrarFicha() {
        try {
            document.getElementById("ficha-reserva-cerrar")?.click();
        } catch (_) {}
    }

    function datosHaikuLocal() {
        try {
            return JSON.parse(localStorage.getItem("haikuDatos") || "{}");
        } catch {
            return {};
        }
    }

    function mapaFullDaysActivos() {
        const mapa = new Map();
        const datos = datosHaikuLocal();

        Object.entries(datos).forEach(([fecha, dia]) => {
            Object.entries(dia?.cabanas || {}).forEach(([cabana, registro]) => {
                if (!registro?.reservaId) return;
                if (String(registro.estado || "").toLowerCase() !== "fullday") return;
                if (registro.fulldayLiberadoEn) return;

                const id = String(registro.reservaId);
                if (mapa.has(id)) return;

                mapa.set(id, {
                    reservaId: id,
                    cabana: String(cabana),
                    fecha: String(registro.fechaOrigenReserva || fecha).slice(0, 10),
                    titular: registro.titular || "Full Day"
                });
            });
        });

        return mapa;
    }

    function retirarReservaDelCache(reservaId, { borrarFicha = false } = {}) {
        const id = String(reservaId || "");
        if (!id) return;

        try {
            Object.values(datosPorFecha || {}).forEach(dia => {
                if (!dia?.cabanas) return;

                Object.keys(dia.cabanas).forEach(numero => {
                    if (String(dia.cabanas[numero]?.reservaId || "") === id) {
                        delete dia.cabanas[numero];
                    }
                });
            });
        } catch (_) {}

        if (borrarFicha) {
            try {
                const fichas = JSON.parse(
                    localStorage.getItem("haikuFichaReservas") || "{}"
                );
                delete fichas[id];
                localStorage.setItem("haikuFichaReservas", JSON.stringify(fichas));
            } catch (_) {}
        }

        try {
            if (typeof guardarDatos === "function") guardarDatos();
        } catch (_) {}

        document
            .querySelectorAll(`[data-reserva-id="${CSS.escape(id)}"]`)
            .forEach(elemento => elemento.remove());
    }

    function renderCalendarioInmediato() {
        try {
            if (typeof generarCalendario === "function") generarCalendario();
        } catch (_) {}
    }

    async function refrescarFuentesSupabase() {
        const tareas = [];

        if (typeof window.haikuSincronizarReservasSupabase === "function") {
            tareas.push(
                Promise.resolve().then(() => window.haikuSincronizarReservasSupabase())
            );
        }

        if (window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar) {
            tareas.push(
                Promise.resolve().then(() => window.HAIKU_OPERACION_RESUMEN_FIX_V1.refrescar())
            );
        }

        if (typeof window.haikuCargarPagosPendientesSupabase === "function") {
            tareas.push(
                Promise.resolve().then(() => window.haikuCargarPagosPendientesSupabase())
            );
        }

        await Promise.allSettled(tareas);

        try {
            if (typeof generarCalendario === "function") generarCalendario();
        } catch (_) {}

        try {
            if (typeof actualizarResumenDia === "function") {
                actualizarResumenDia(fechaSeleccionada);
            }
        } catch (_) {}

        try {
            if (typeof generarResumenOperativo === "function") {
                generarResumenOperativo(fechaSeleccionada);
            }
        } catch (_) {}
    }

    async function cancelarReservaSupabase(reservaId, opciones = {}) {
        if (!reservaId || cancelando) return;

        const confirmar = window.confirm(
            "¿Seguro que deseas cancelar esta reserva?\n\n" +
            "La reserva desaparecerá inmediatamente del Resumen y del Calendario."
        );

        if (!confirmar) return;

        cancelando = true;
        cerrarMenuEstado();

        try {
            // El puente del Libro revalida después de la confirmación nativa.
            if (opciones.antesDeCancelar && await opciones.antesDeCancelar() === false) return {estado:'sin_cambios'};
            const { data, error } = await cliente.rpc(
                "haiku_cancelar_reserva",
                { p_reserva_id: reservaId }
            );

            if (error) throw error;

            console.info("HAIKU · Reserva cancelada en Supabase:", data || reservaId);

            // La base ya confirmó la cancelación. Desde aquí la interfaz
            // responde al instante y la sincronización completa ocurre después.
            cerrarFicha();
            retirarReservaDelCache(reservaId, { borrarFicha: true });
            renderCalendarioInmediato();

            refrescarFuentesSupabase().catch(errorRefresco => {
                console.warn("HAIKU · Refresco posterior a cancelación:", errorRefresco);
            });
            return {estado:'cancelada',data};
        } catch (error) {
            if (opciones.antesDeCancelar) throw error;
            console.error("HAIKU · No fue posible cancelar la reserva:", error);
            alert(error?.message || "No fue posible cancelar la reserva.");
        } finally {
            cancelando = false;
        }
    }

    function datosVisualesConFullDay() {
        const original = localStorage.getItem("haikuDatos");
        let datos;

        try {
            datos = JSON.parse(original || "{}");
        } catch {
            return { original, visual: original, modificado: false };
        }

        let modificado = false;

        Object.values(datos).forEach(dia => {
            Object.values(dia?.cabanas || {}).forEach(cabana => {
                if (!cabana?.reservaId) return;
                if (String(cabana.estado || "").toLowerCase() !== "fullday") return;
                if (cabana.fulldayLiberadoEn) return;

                // Solo para el motor visual del calendario: un Full Day ocupa
                // una celda completa. No cambiamos sus noches reales.
                if (Number(cabana.noches || 0) < 1) {
                    cabana.noches = 1;
                    modificado = true;
                }
            });
        });

        return {
            original,
            visual: JSON.stringify(datos),
            modificado
        };
    }

    function decorarFullDaysCalendario() {
        // La autoridad por estadía decide también el color operativo del Full Day.
        if (window.HAIKU_CALENDARIO_ESTADOS_V1) {
            window.HAIKU_CALENDARIO_ESTADOS_V1.aplicar();
            return;
        }
        const fullDays = mapaFullDaysActivos();
        if (fullDays.size === 0) return;

        document
            .querySelectorAll(
                ".calendario-reserva-barra[data-reserva-id], " +
                ".calendario-panel-reserva[data-reserva-id]"
            )
            .forEach(elemento => {
                const id = String(elemento.dataset.reservaId || "");
                if (!fullDays.has(id)) return;
                if (elemento.dataset.estadiaId && elemento.dataset.haikuFullday !== '1') return;

                CLASES_COLOR_CALENDARIO.forEach(clase => elemento.classList.remove(clase));
                elemento.classList.add("cal-reserva-fullday");
                elemento.dataset.haikuFullday = "1";
            });
    }

    function instalarParcheCalendarioFullDay() {
        if (parcheCalendarioInstalado) return;
        if (typeof generarCalendario !== "function") return;

        const generarOriginal = generarCalendario;

        const generarConFullDay = function (...args) {
            const temporal = datosVisualesConFullDay();

            if (temporal.modificado) {
                localStorage.setItem("haikuDatos", temporal.visual);
            }

            let resultado;
            try {
                resultado = generarOriginal.apply(this, args);
            } finally {
                if (temporal.modificado) {
                    if (temporal.original === null) {
                        localStorage.removeItem("haikuDatos");
                    } else {
                        localStorage.setItem("haikuDatos", temporal.original);
                    }
                }
            }

            decorarFullDaysCalendario();
            return resultado;
        };

        try {
            generarCalendario = generarConFullDay;
        } catch (_) {
            window.generarCalendario = generarConFullDay;
        }

        window.generarCalendario = generarConFullDay;
        parcheCalendarioInstalado = true;

        try {
            generarConFullDay();
        } catch (error) {
            console.warn("HAIKU · No fue posible redibujar Full Day en Calendario:", error);
        }
    }

    function asegurarModalFullDay() {
        let fondo = document.getElementById("haiku-fullday-acciones-fondo");
        if (fondo) return fondo;

        fondo = document.createElement("div");
        fondo.id = "haiku-fullday-acciones-fondo";
        fondo.hidden = true;
        fondo.innerHTML = `
            <div class="haiku-fullday-acciones-card" role="dialog" aria-modal="true" aria-labelledby="haiku-fullday-acciones-titulo">
                <button type="button" class="haiku-fullday-acciones-cerrar" aria-label="Cerrar">×</button>
                <small>CALENDARIO · FULL DAY</small>
                <h3 id="haiku-fullday-acciones-titulo">Full Day</h3>

                <div class="haiku-fullday-acciones-datos">
                    <div><span>Cabaña</span><strong data-fd-cabana>—</strong></div>
                    <div><span>Fecha</span><strong data-fd-fecha>—</strong></div>
                    <div class="haiku-fd-dato-ancho"><span>Titular</span><strong data-fd-titular>—</strong></div>
                </div>

                <p>
                    El Full Day mantiene la cabaña ocupada durante todo el día.
                    Libérala solamente si el huésped ya salió y el aseo terminó,
                    dejando la cabaña lista para una nueva venta.
                </p>

                <div class="haiku-fullday-acciones-botones">
                    <button type="button" data-fd-accion="cancelar">Cerrar</button>
                    <button type="button" data-fd-accion="ver">Ver reserva</button>
                    <button type="button" class="haiku-fd-liberar" data-fd-accion="liberar">Liberar cabaña</button>
                </div>
            </div>
        `;

        document.body.appendChild(fondo);

        fondo.addEventListener("click", evento => {
            if (
                evento.target === fondo ||
                evento.target.closest?.(".haiku-fullday-acciones-cerrar") ||
                evento.target.closest?.('[data-fd-accion="cancelar"]')
            ) {
                fondo.hidden = true;
                return;
            }

            const accion = evento.target.closest?.("[data-fd-accion]")?.dataset?.fdAccion;
            if (!accion) return;

            const info = fondo.__haikuFullDayInfo;
            if (!info) return;

            if (accion === "ver") {
                fondo.hidden = true;
                abrirFichaFullDay(info);
                return;
            }

            if (accion === "liberar") {
                liberarFullDay(info, evento.target.closest("button"));
            }
        });

        return fondo;
    }

    function abrirModalFullDay(info) {
        const fondo = asegurarModalFullDay();
        fondo.__haikuFullDayInfo = info;
        fondo.querySelector("[data-fd-cabana]").textContent = `CAB ${info.cabana}`;
        fondo.querySelector("[data-fd-fecha]").textContent = formatearFechaCorta(info.fecha);
        fondo.querySelector("[data-fd-titular]").textContent = info.titular || "Full Day";
        fondo.hidden = false;
    }

    function formatearFechaCorta(fecha) {
        const [a, m, d] = String(fecha || "").slice(0, 10).split("-");
        return a && m && d ? `${d}-${m}-${a}` : String(fecha || "—");
    }

    function abrirFichaFullDay(info) {
        try {
            const fechaAnterior = fechaSeleccionada;
            fechaSeleccionada = info.fecha;
            const botonCabana = document.querySelector(
                `[data-ficha-cabana="${CSS.escape(String(info.cabana))}"]`
            );
            botonCabana?.click();
            fechaSeleccionada = fechaAnterior;
        } catch (error) {
            console.warn("HAIKU · No fue posible abrir ficha Full Day:", error);
        }
    }

    async function liberarFullDay(info, boton) {
        if (!info?.reservaId || liberandoFullDay) return;

        const confirmar = window.confirm(
            "¿Liberar esta cabaña para una nueva venta?\n\n" +
            "Confirma solamente si el huésped del Full Day ya salió y el aseo terminó."
        );
        if (!confirmar) return;

        liberandoFullDay = true;
        const textoOriginal = boton?.textContent || "Liberar cabaña";
        if (boton) {
            boton.disabled = true;
            boton.textContent = "Liberando…";
        }

        try {
            const { data, error } = await cliente.rpc(
                "haiku_liberar_fullday",
                {
                    p_reserva_id: info.reservaId,
                    p_motivo: "Salida anticipada confirmada; cabaña aseada y liberada para nueva venta"
                }
            );

            if (error) throw error;

            console.info("HAIKU · Full Day liberado para nueva venta:", data || info.reservaId);

            retirarReservaDelCache(info.reservaId, { borrarFicha: false });
            asegurarModalFullDay().hidden = true;
            renderCalendarioInmediato();

            refrescarFuentesSupabase().catch(errorRefresco => {
                console.warn("HAIKU · Refresco posterior a liberar Full Day:", errorRefresco);
            });

            alert("Cabaña liberada. El Full Day permanece guardado en el historial, pero ya no bloquea una nueva venta.");
        } catch (error) {
            console.error("HAIKU · No fue posible liberar Full Day:", error);
            alert(error?.message || "No fue posible liberar la cabaña.");
        } finally {
            liberandoFullDay = false;
            if (boton) {
                boton.disabled = false;
                boton.textContent = textoOriginal;
            }
        }
    }

    document.addEventListener(
        "click",
        evento => {
            const opcion = evento.target?.closest?.(
                '[data-ficha-estado-opcion="cancelada"]'
            );

            if (!opcion) return;

            const modal = document.getElementById("ficha-reserva-modal");
            const reservaId = String(modal?.dataset?.reservaId || "");
            if (!reservaId) return;

            // Evita que la ruta legacy de localStorage se ejecute después.
            evento.preventDefault();
            evento.stopPropagation();
            evento.stopImmediatePropagation();

            cancelarReservaSupabase(reservaId);
        },
        true
    );

    // Los Full Day tienen una acción especial desde Calendario.
    document.addEventListener(
        "click",
        evento => {
            const item = evento.target?.closest?.(
                ".calendario-reserva-barra[data-reserva-id], " +
                ".calendario-panel-reserva[data-reserva-id]"
            );
            if (!item) return;

            const id = String(item.dataset.reservaId || "");
            const info = mapaFullDaysActivos().get(id);
            if (!info) return;

            evento.preventDefault();
            evento.stopPropagation();
            evento.stopImmediatePropagation();
            abrirModalFullDay(info);
        },
        true
    );

    // Cuando se abre el panel +N, coloreamos sus Full Day también.
    document.addEventListener("click", evento => {
        if (!evento.target.closest?.(".calendario-mas-reservas")) return;
        setTimeout(decorarFullDaysCalendario, 0);
    });

    const estilo = document.createElement("style");
    estilo.textContent = `
        #haiku-fullday-acciones-fondo {
            position: fixed;
            inset: 0;
            z-index: 2400;
            display: grid;
            place-items: center;
            padding: 18px;
            background: rgba(20, 28, 24, .42);
        }
        #haiku-fullday-acciones-fondo[hidden] { display: none !important; }
        .haiku-fullday-acciones-card {
            position: relative;
            width: min(390px, calc(100vw - 28px));
            padding: 18px;
            border: 1px solid #d9dedb;
            border-radius: 16px;
            background: #fffdfa;
            box-shadow: 0 18px 52px rgba(20, 30, 24, .22);
            color: #202723;
        }
        .haiku-fullday-acciones-card > small {
            display: block;
            margin-bottom: 4px;
            color: #6f7b74;
            font-size: 10px;
            letter-spacing: .08em;
        }
        .haiku-fullday-acciones-card h3 {
            margin: 0 36px 14px 0;
            font-size: 20px;
        }
        .haiku-fullday-acciones-cerrar {
            position: absolute;
            top: 12px;
            right: 12px;
            width: 32px;
            height: 32px;
            border: 1px solid #dce1de;
            border-radius: 50%;
            background: #fff;
            cursor: pointer;
            font-size: 19px;
        }
        .haiku-fullday-acciones-datos {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 9px;
            margin-bottom: 14px;
        }
        .haiku-fullday-acciones-datos > div {
            padding: 10px 11px;
            border: 1px solid #e1e5e2;
            border-radius: 11px;
            background: #fafbf9;
        }
        .haiku-fd-dato-ancho { grid-column: 1 / -1; }
        .haiku-fullday-acciones-datos span,
        .haiku-fullday-acciones-datos strong { display: block; }
        .haiku-fullday-acciones-datos span {
            margin-bottom: 3px;
            color: #7a837e;
            font-size: 10px;
        }
        .haiku-fullday-acciones-datos strong { font-size: 13px; }
        .haiku-fullday-acciones-card p {
            margin: 0 0 16px;
            color: #5f6963;
            font-size: 12px;
            line-height: 1.45;
        }
        .haiku-fullday-acciones-botones {
            display: grid;
            grid-template-columns: auto 1fr 1.25fr;
            gap: 8px;
        }
        .haiku-fullday-acciones-botones button {
            min-height: 40px;
            padding: 8px 10px;
            border: 1px solid #d7ded9;
            border-radius: 9px;
            background: #fff;
            color: #29342e;
            font: inherit;
            font-size: 12px;
            font-weight: 650;
            cursor: pointer;
        }
        .haiku-fullday-acciones-botones .haiku-fd-liberar {
            border-color: #2f7653;
            background: #2f7653;
            color: #fff;
        }
        .haiku-fullday-acciones-botones button:disabled {
            opacity: .55;
            cursor: wait;
        }
        @media (max-width: 480px) {
            .haiku-fullday-acciones-botones {
                grid-template-columns: 1fr 1fr;
            }
            .haiku-fullday-acciones-botones .haiku-fd-liberar {
                grid-column: 1 / -1;
            }
        }
    `;
    document.head.appendChild(estilo);

    setTimeout(instalarParcheCalendarioFullDay, 80);
    setTimeout(decorarFullDaysCalendario, 220);

    window.HAIKU_RESERVA_ESTADOS_SUPABASE_V2 = Object.freeze({
        cancelar: cancelarReservaSupabase,
        liberarFullDay,
        decorarFullDaysCalendario
    });

    // Conservamos el nombre anterior por compatibilidad.
    window.HAIKU_RESERVA_ESTADOS_SUPABASE_V1 = window.HAIKU_RESERVA_ESTADOS_SUPABASE_V2;

    console.info("HAIKU · Estados de reserva Supabase V2 preparados.");
})();
