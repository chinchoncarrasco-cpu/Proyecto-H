// ========================================
// HAIKU · SUPABASE · EDICIÓN COMPLETA V2
// Se carga antes del legacy para interceptar el guardado de edición.
// Permite modificar cabaña, fechas, tipo, ocupación, huéspedes y tarifas.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    const reglaTarifa = window.HAIKU_FULLDAY_TARIFA_V1;
    if (!cliente || !reglaTarifa) return;

    let guardando = false;
    let tipoEdicion = "alojamiento";
    let reservaTipoActual = "";
    let tarifaFullDayActual = 0;
    let tarifaFullDayManual = false;

    function modoActual() {
        try { return String(modoFormularioReserva || "crear"); }
        catch { return "crear"; }
    }

    function reservaIdActual() {
        try { return String(reservaEditandoId || ""); }
        catch { return ""; }
    }

    function fechaMasUno(fecha) {
        if (!fecha) return "";
        try {
            if (typeof sumarDiasNuevaReserva === "function") {
                return sumarDiasNuevaReserva(fecha, 1);
            }
        } catch {}
        const [a, m, d] = String(fecha).split("-").map(Number);
        const base = new Date(a, m - 1, d, 12, 0, 0);
        base.setDate(base.getDate() + 1);
        return [
            base.getFullYear(),
            String(base.getMonth() + 1).padStart(2, "0"),
            String(base.getDate()).padStart(2, "0")
        ].join("-");
    }

    function fechaBonita(fecha) {
        if (!fecha) return "";
        const [a, m, d] = String(fecha).slice(0, 10).split("-");
        return `${d}-${m}-${a}`;
    }

    function llegadaActual() {
        try { return String(fechaLlegadaReserva || "").slice(0, 10); }
        catch { return ""; }
    }

    function ocupacionActual() {
        let adultos = 1;
        let ninos = 0;
        try { adultos = Number(adultosReserva ?? 1); } catch {}
        try { ninos = Number(ninosReserva ?? 0); } catch {}
        return { adultos, ninos };
    }

    function resolverTarifaFullDay(fecha) {
        let guardada = 0;
        try { guardada = Number(tarifasNochesReserva?.[fecha] || 0); } catch {}
        return reglaTarifa.resolver({
            ...ocupacionActual(),
            tarifaManual: tarifaFullDayManual
                ? (guardada || tarifaFullDayActual)
                : null
        });
    }

    function fijarTarifaFullDay(fecha) {
        const resultado = resolverTarifaFullDay(fecha);
        tarifaFullDayActual = Number(resultado.tarifa || 0);
        if (fecha) {
            try { tarifasNochesReserva = { [fecha]: tarifaFullDayActual }; } catch {}
        }
        return resultado;
    }

    function datosFormulario() {
        const titular = document.getElementById("reserva-nuevo-titular")?.value.trim() || "";
        const telefono = document.getElementById("reserva-nuevo-telefono")?.value.trim() || "";
        const rut = document.getElementById("reserva-nuevo-rut")?.value.trim() || "";
        const correo = document.getElementById("reserva-nuevo-correo")?.value.trim() || "";
        const observaciones = document.getElementById("reserva-nueva-observacion")?.value.trim() || "";
        const acompanantes = Array.from(
            document.querySelectorAll(".reserva-nuevo-acompanante")
        ).map(c => c.value.trim()).filter(Boolean);

        let llegada = "";
        let salida = "";
        let cabana = 0;
        let tarifas = {};
        let adultos = 1;
        let ninos = 0;
        let mascotas = 0;

        try { llegada = String(fechaLlegadaReserva || "").slice(0, 10); } catch {}
        try { salida = String(fechaSalidaReserva || "").slice(0, 10); } catch {}
        try { cabana = Number(cabanaSeleccionadaReserva || 0); } catch {}
        try { tarifas = { ...(tarifasNochesReserva || {}) }; } catch {}
        try { adultos = Number(adultosReserva ?? 1); } catch {}
        try { ninos = Number(ninosReserva ?? 0); } catch {}
        try { mascotas = Number(mascotasReserva ?? 0); } catch {}

        let tarifaFullDay = null;
        if (tipoEdicion === "fullday") {
            salida = llegada;
            tarifaFullDay = Number(
                tarifas[llegada] || tarifaFullDayActual || 0
            );
            tarifas = tarifaFullDay > 0 && llegada
                ? { [llegada]: tarifaFullDay }
                : {};
        }

        return {
            titular, telefono, rut, correo, observaciones,
            acompanantes, llegada, salida, cabana, tarifas,
            adultos, ninos, mascotas,
            tipoEstadia: tipoEdicion,
            tarifaFullDay
        };
    }

    function prepararSelectorTipo() {
        const paso = document.getElementById("reserva-paso-fechas");
        if (!paso) return null;

        let editor = document.getElementById("haiku-tipo-estadia-editor");
        if (!editor) {
            editor = document.createElement("div");
            editor.id = "haiku-tipo-estadia-editor";
            editor.className = "haiku-tipo-estadia-editor";
            editor.innerHTML = `
                <span class="haiku-tipo-estadia-label">Tipo de estadía</span>
                <div class="haiku-tipo-estadia-opciones" role="group" aria-label="Tipo de estadía">
                    <button type="button" data-haiku-tipo-estadia="alojamiento">Alojamiento</button>
                    <button type="button" data-haiku-tipo-estadia="fullday">Full Day</button>
                </div>
                <small>Full Day ocupa una sola fecha y se mostrará automáticamente como FULLDAY en Resumen.</small>
            `;
            const titulo = paso.querySelector(".nueva-reserva-titulo");
            paso.insertBefore(editor, titulo || paso.firstChild);
        }

        editor.hidden = modoActual() !== "editar";
        editor.querySelectorAll("[data-haiku-tipo-estadia]").forEach(boton => {
            boton.classList.toggle(
                "activo",
                boton.dataset.haikuTipoEstadia === tipoEdicion
            );
        });
        return editor;
    }

    function mostrarAyudaTarifa(resultado = resolverTarifaFullDay(llegadaActual())) {
        const editor = prepararSelectorTipo();
        if (!editor) return;
        let ayuda = editor.querySelector("[data-haiku-fullday-tarifa-ayuda]");
        if (!ayuda) {
            ayuda = document.createElement("small");
            ayuda.dataset.haikuFulldayTarifaAyuda = "";
            editor.appendChild(ayuda);
        }
        ayuda.hidden = tipoEdicion !== "fullday";
        ayuda.textContent = resultado.mensaje;
        ayuda.classList.toggle("es-bloqueada", resultado.bloqueada);
    }

    function ajustarVisualTipo() {
        const editor = prepararSelectorTipo();
        if (!editor || editor.hidden) return;

        const esFullDay = tipoEdicion === "fullday";
        const tituloFechas = document.querySelector("#reserva-paso-fechas .nueva-reserva-titulo strong");
        if (tituloFechas) tituloFechas.textContent = esFullDay ? "Selecciona la fecha" : "Selecciona las fechas";

        const ayudaRegla = editor.querySelector("[data-haiku-fullday-tarifa-ayuda]");
        if (ayudaRegla) ayudaRegla.hidden = !esFullDay;
        if (esFullDay) {
            const salida = document.getElementById("reserva-fecha-salida");
            if (salida && llegadaActual()) salida.textContent = "Mismo día";

            document.querySelectorAll(".reserva-cabana-info small").forEach(el => {
                el.textContent = el.textContent.replace(/^\s*1\s+noche\b/i, "Full Day");
            });
            document.querySelectorAll(".reserva-editar-tarifas").forEach(el => {
                el.textContent = "Editar tarifa Full Day";
            });

            const encabezado = document.querySelector(".reserva-tarifas-encabezado strong");
            if (encabezado) encabezado.textContent = "Tarifa Full Day";
            const ayuda = document.querySelector(".reserva-tarifas-encabezado span");
            if (ayuda) ayuda.textContent = "Define el valor de este Full Day";

            document.querySelectorAll(".reserva-tarifa-fila > span").forEach(el => {
                if (llegadaActual()) el.textContent = `${fechaBonita(llegadaActual())} · Full Day`;
            });

            const detalle = document.querySelector("#resumen-cabana-seleccionada .reserva-detalles-cabana span");
            if (detalle && llegadaActual()) {
                detalle.textContent = `${fechaBonita(llegadaActual())} · Full Day`;
            }
            mostrarAyudaTarifa();
        }
    }

    function aplicarTipo(tipo, { desdeCarga = false } = {}) {
        tipoEdicion = tipo === "fullday" ? "fullday" : "alojamiento";
        prepararSelectorTipo();

        if (tipoEdicion === "fullday") {
            const llegada = llegadaActual();
            if (llegada) {
                try { fechaSalidaReserva = fechaMasUno(llegada); } catch {}
                fijarTarifaFullDay(llegada);
                try {
                    if (typeof actualizarSeleccionCalendarioReserva === "function") {
                        actualizarSeleccionCalendarioReserva();
                    }
                } catch {}
            }
        } else if (!desdeCarga) {
            tarifaFullDayManual = false;
        }

        setTimeout(ajustarVisualTipo, 0);
        setTimeout(ajustarVisualTipo, 80);
    }

    async function cargarTipoReserva(reservaId) {
        if (!reservaId) return;
        try {
            const { data: estadia, error } = await cliente
                .from("reserva_estadias")
                .select("id,fecha_ingreso,fecha_salida,tipo_estadia,cabanas(numero)")
                .eq("reserva_id", reservaId)
                .not("estado_estadia", "in", "(cancelada,no_show)")
                .order("creado_en", { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            if (!estadia) return;

            reservaTipoActual = estadia.tipo_estadia || "alojamiento";
            tarifaFullDayActual = 0;
            tarifaFullDayManual = reservaTipoActual === "fullday";

            if (reservaTipoActual === "fullday") {
                const { data: cargos, error: errorCargos } = await cliente
                    .from("vista_estado_cargos")
                    .select("monto")
                    .eq("reserva_id", reservaId)
                    .eq("tipo_cargo", "alojamiento")
                    .eq("estado", "activo");
                if (errorCargos) throw errorCargos;
                tarifaFullDayActual = (cargos || []).reduce(
                    (suma, cargo) => suma + Number(cargo.monto || 0), 0
                );

                const fecha = String(estadia.fecha_ingreso || "").slice(0, 10);
                try {
                    fechaLlegadaReserva = fecha;
                    fechaSalidaReserva = fechaMasUno(fecha);
                    cabanaSeleccionadaReserva = String(estadia.cabanas?.numero || cabanaSeleccionadaReserva || "");
                    tarifasNochesReserva = tarifaFullDayActual > 0
                        ? { [fecha]: tarifaFullDayActual }
                        : {};
                    if (typeof actualizarSeleccionCalendarioReserva === "function") {
                        actualizarSeleccionCalendarioReserva();
                    }
                } catch {}
            }

            aplicarTipo(reservaTipoActual, { desdeCarga: true });
        } catch (error) {
            console.warn("HAIKU · No fue posible cargar tipo de estadía para editar:", error);
            aplicarTipo("alojamiento", { desdeCarga: true });
        }
    }

    async function guardarEdicionCompleta(reservaId, datos) {
        if (!window.haikuTienePermiso?.("reservas.editar")) {
            throw new Error("Tu usuario no tiene permiso para editar reservas.");
        }
        if (!datos.titular || !datos.cabana || !datos.llegada || !datos.salida) {
            throw new Error("Faltan datos obligatorios para guardar la edición.");
        }
        if (datos.tipoEstadia === "fullday" && Number(datos.tarifaFullDay || 0) <= 0) {
            const resultado = reglaTarifa.resolver({
                adultos: datos.adultos,
                ninos: datos.ninos
            });
            throw new Error(resultado.mensaje);
        }

        const { data, error } = await cliente.rpc(
            "haiku_modificar_reserva_completa",
            {
                p_reserva_id: reservaId,
                p_titular_nombre: datos.titular,
                p_cabana_numero: datos.cabana,
                p_fecha_ingreso: datos.llegada,
                p_fecha_salida: datos.salida,
                p_tipo_estadia: datos.tipoEstadia,
                p_adultos: Math.max(0, datos.adultos),
                p_ninos: Math.max(0, datos.ninos),
                p_mascotas: Math.max(0, datos.mascotas),
                p_correo_contacto: datos.correo || null,
                p_telefono_contacto: datos.telefono || null,
                p_rut: datos.rut || null,
                p_observaciones: datos.observaciones || null,
                p_tarifas: datos.tarifas,
                p_tarifa_fullday: datos.tipoEstadia === "fullday"
                    ? Number(datos.tarifaFullDay)
                    : null,
                p_acompanantes: datos.acompanantes
            }
        );
        if (error) throw error;
        return data;
    }

    document.addEventListener("click", async evento => {
        const boton = evento.target.closest("#crear-nueva-reserva");
        if (!boton || modoActual() !== "editar") return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        if (guardando) return;

        const reservaId = reservaIdActual();
        const datos = datosFormulario();
        if (!reservaId) {
            alert("No se encontró la reserva que estás editando.");
            return;
        }

        const texto = boton.textContent;
        guardando = true;
        boton.disabled = true;
        boton.textContent = "Guardando en Supabase…";

        try {
            const resultado = await guardarEdicionCompleta(reservaId, datos);
            console.info("HAIKU · Edición completa guardada en Supabase:", resultado);

            if (typeof window.haikuSincronizarReservasSupabase === "function") {
                await window.haikuSincronizarReservasSupabase();
            }
            try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}

            document.getElementById("cerrar-nueva-reserva")?.click();
            alert("Reserva actualizada correctamente.");
        } catch (error) {
            console.error("HAIKU · No fue posible guardar edición completa:", error);
            alert(error?.message || "No fue posible guardar los cambios.");
        } finally {
            guardando = false;
            boton.disabled = false;
            boton.textContent = texto;
        }
    }, true);

    document.addEventListener("click", evento => {
        const tipo = evento.target.closest?.("[data-haiku-tipo-estadia]")?.dataset?.haikuTipoEstadia;
        if (!tipo || modoActual() !== "editar") return;
        evento.preventDefault();
        aplicarTipo(tipo);
    });

    document.addEventListener("click", evento => {
        if (modoActual() !== "editar" || tipoEdicion !== "fullday") return;
        const dia = evento.target.closest?.("#reserva-calendario .reserva-dia[data-fecha]");
        if (!dia || dia.disabled) return;
        const fecha = dia.dataset.fecha;
        setTimeout(() => {
            try {
                fechaLlegadaReserva = fecha;
                fechaSalidaReserva = fechaMasUno(fecha);
                fijarTarifaFullDay(fecha);
                if (typeof actualizarSeleccionCalendarioReserva === "function") {
                    actualizarSeleccionCalendarioReserva();
                }
            } catch {}
            ajustarVisualTipo();
        }, 0);
    });

    document.addEventListener("click", evento => {
        if (modoActual() !== "editar" || tipoEdicion !== "fullday") return;
        const tarjeta = evento.target.closest?.(".reserva-cabana-opcion[data-cabana]");
        if (!tarjeta) return;
        setTimeout(() => {
            fijarTarifaFullDay(llegadaActual());
            ajustarVisualTipo();
        }, 0);
    });

    document.addEventListener("click", evento => {
        if (modoActual() !== "editar" || tipoEdicion !== "fullday") return;
        if (!evento.target.closest?.(".reserva-tarifas-aplicar")) return;
        setTimeout(() => {
            const fecha = llegadaActual();
            try {
                tarifaFullDayActual = Number(tarifasNochesReserva?.[fecha] || tarifaFullDayActual || 0);
                tarifaFullDayManual = tarifaFullDayActual > 0;
                fijarTarifaFullDay(fecha);
            } catch {}
            ajustarVisualTipo();
        }, 0);
    });

    document.addEventListener("change", evento => {
        if (modoActual() !== "editar" || tipoEdicion !== "fullday") return;
        if (!evento.target.closest?.(".reserva-ocupacion-adultos, .reserva-ocupacion-ninos")) return;
        setTimeout(() => {
            fijarTarifaFullDay(llegadaActual());
            ajustarVisualTipo();
        }, 0);
    });

    document.addEventListener("click", evento => {
        const editar = evento.target.closest?.("#ficha-reserva-editar");
        if (!editar) return;
        const reservaId = String(
            document.getElementById("ficha-reserva-modal")?.dataset?.reservaId || ""
        );
        setTimeout(() => {
            prepararSelectorTipo();
            cargarTipoReserva(reservaId);
        }, 100);
    }, true);

    document.addEventListener("click", evento => {
        if (!evento.target.closest?.("#boton-nueva-reserva")) return;
        tipoEdicion = "alojamiento";
        reservaTipoActual = "";
        tarifaFullDayActual = 0;
        tarifaFullDayManual = false;
        setTimeout(() => {
            const editor = prepararSelectorTipo();
            if (editor) editor.hidden = true;
        }, 30);
    }, true);

    document.addEventListener("click", evento => {
        if (modoActual() !== "editar" || tipoEdicion !== "fullday") return;
        if (!evento.target.closest?.(
            "#continuar-fechas-reserva, #continuar-reserva-detalles, .reserva-editar-tarifas, #volver-reserva-fechas, #volver-reserva-cabana"
        )) return;
        setTimeout(ajustarVisualTipo, 0);
        setTimeout(ajustarVisualTipo, 80);
    });

    const estilo = document.createElement("style");
    estilo.textContent = `
        .haiku-tipo-estadia-editor {
            margin: 0 0 14px;
            padding: 12px;
            border: 1px solid #dbe3de;
            border-radius: 12px;
            background: #f8faf8;
        }
        .haiku-tipo-estadia-editor[hidden] { display: none !important; }
        .haiku-tipo-estadia-label {
            display: block;
            margin-bottom: 7px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .04em;
            text-transform: uppercase;
            color: #496255;
        }
        .haiku-tipo-estadia-opciones {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 7px;
        }
        .haiku-tipo-estadia-opciones button {
            min-height: 38px;
            border: 1px solid #ced8d2;
            border-radius: 9px;
            background: #fff;
            color: #233229;
            font: inherit;
            font-weight: 650;
            cursor: pointer;
        }
        .haiku-tipo-estadia-opciones button.activo {
            border-color: #2f7653;
            background: #2f7653;
            color: #fff;
        }
        .haiku-tipo-estadia-editor small {
            display: block;
            margin-top: 7px;
            line-height: 1.35;
            color: #718077;
        }
        .haiku-tipo-estadia-editor [data-haiku-fullday-tarifa-ayuda] {
            padding-top: 7px;
            border-top: 1px solid #dbe3de;
            color: #2f6b4b;
            font-weight: 650;
        }
        .haiku-tipo-estadia-editor [data-haiku-fullday-tarifa-ayuda].es-bloqueada {
            color: #9d3b27;
        }
    `;
    document.head.appendChild(estilo);

    setTimeout(prepararSelectorTipo, 250);
    console.info("HAIKU · Edición completa Supabase V2 preparada.");
})();
