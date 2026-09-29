// ========================================
// HAIKU · NUEVA RESERVA FULL DAY V1
// Extiende el mismo selector Alojamiento / Full Day al flujo Crear.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    const reglaTarifa = window.HAIKU_FULLDAY_TARIFA_V1;
    if (!cliente || !reglaTarifa) return;

    let tipoCreacion = "alojamiento";
    let tarifaFullDay = 0;
    let tarifaManual = false;
    let guardando = false;

    function modoActual() {
        try { return String(modoFormularioReserva || "crear"); }
        catch { return "crear"; }
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

    function asegurarEditor() {
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
        return editor;
    }

    function mostrarEditorCreacion() {
        if (modoActual() !== "crear") return;
        const editor = asegurarEditor();
        if (!editor) return;
        editor.hidden = false;
        editor.querySelectorAll("[data-haiku-tipo-estadia]").forEach(boton => {
            boton.classList.toggle(
                "activo",
                boton.dataset.haikuTipoEstadia === tipoCreacion
            );
        });
    }

    function ocupacionActual() {
        let adultos = 1;
        let ninos = 0;
        try { adultos = Number(adultosReserva ?? 1); } catch {}
        try { ninos = Number(ninosReserva ?? 0); } catch {}
        return { adultos, ninos };
    }

    function resolverTarifaFullDay() {
        const fecha = llegadaActual();
        const resultado = reglaTarifa.resolver({
            ...ocupacionActual(),
            tarifaManual: tarifaManual ? tarifaFullDay : null
        });
        tarifaFullDay = Number(resultado.tarifa || 0);
        if (fecha) {
            try { tarifasNochesReserva = { [fecha]: tarifaFullDay }; } catch {}
        }
        return resultado;
    }

    function mostrarAyudaTarifa(resultado = resolverTarifaFullDay()) {
        const editor = asegurarEditor();
        if (!editor) return;
        let ayuda = editor.querySelector("[data-haiku-fullday-tarifa-ayuda]");
        if (!ayuda) {
            ayuda = document.createElement("small");
            ayuda.dataset.haikuFulldayTarifaAyuda = "";
            editor.appendChild(ayuda);
        }
        ayuda.hidden = tipoCreacion !== "fullday";
        ayuda.textContent = resultado.mensaje;
        ayuda.classList.toggle("es-bloqueada", resultado.bloqueada);
    }

    function ajustarVisual() {
        if (modoActual() !== "crear") return;
        mostrarEditorCreacion();
        const esFullDay = tipoCreacion === "fullday";

        const titulo = document.querySelector("#reserva-paso-fechas .nueva-reserva-titulo strong");
        if (titulo) titulo.textContent = esFullDay ? "Selecciona la fecha" : "Selecciona las fechas";

        const ayudaRegla = document.querySelector("[data-haiku-fullday-tarifa-ayuda]");
        if (ayudaRegla) ayudaRegla.hidden = !esFullDay;
        if (!esFullDay) return;

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

    function aplicarTipo(tipo) {
        tipoCreacion = tipo === "fullday" ? "fullday" : "alojamiento";
        tarifaManual = false;
        tarifaFullDay = 0;

        if (tipoCreacion === "fullday") {
            const fecha = llegadaActual();
            if (fecha) {
                try {
                    fechaSalidaReserva = fechaMasUno(fecha);
                    tarifasNochesReserva = {};
                    resolverTarifaFullDay();
                    if (typeof actualizarSeleccionCalendarioReserva === "function") {
                        actualizarSeleccionCalendarioReserva();
                    }
                } catch {}
            }
        }

        setTimeout(ajustarVisual, 0);
        setTimeout(ajustarVisual, 80);
    }

    function datosFormularioFullDay() {
        const titular = document.getElementById("reserva-nuevo-titular")?.value.trim() || "";
        const telefono = document.getElementById("reserva-nuevo-telefono")?.value.trim() || "";
        const rut = document.getElementById("reserva-nuevo-rut")?.value.trim() || "";
        const correo = document.getElementById("reserva-nuevo-correo")?.value.trim() || "";
        const observaciones = document.getElementById("reserva-nueva-observacion")?.value.trim() || "";
        const acompanantes = Array.from(
            document.querySelectorAll(".reserva-nuevo-acompanante")
        ).map(c => c.value.trim()).filter(Boolean);

        let llegada = "";
        let cabana = 0;
        let adultos = 1;
        let ninos = 0;
        let mascotas = 0;
        let tarifas = {};
        try { llegada = String(fechaLlegadaReserva || "").slice(0, 10); } catch {}
        try { cabana = Number(cabanaSeleccionadaReserva || 0); } catch {}
        try { adultos = Number(adultosReserva ?? 1); } catch {}
        try { ninos = Number(ninosReserva ?? 0); } catch {}
        try { mascotas = Number(mascotasReserva ?? 0); } catch {}
        try { tarifas = { ...(tarifasNochesReserva || {}) }; } catch {}

        const tarifa = Number(tarifas[llegada] || tarifaFullDay || 0);

        return {
            titular, telefono, rut, correo, observaciones, acompanantes,
            llegada, cabana, adultos, ninos, mascotas, tarifa
        };
    }

    async function cabanaDisponible(datos) {
        const { data, error } = await cliente.rpc("haiku_cabanas_disponibles", {
            p_fecha_ingreso: datos.llegada,
            p_fecha_salida: datos.llegada,
            p_tipo_estadia: "fullday"
        });
        if (error) throw error;
        return (data || []).some(item => Number(item.numero) === Number(datos.cabana));
    }

    async function crearFullDay(datos) {
        if (!window.haikuTienePermiso?.("reservas.crear")) {
            throw new Error("Tu usuario no tiene permiso para crear reservas.");
        }
        if (!datos.titular || !datos.llegada || !datos.cabana) {
            throw new Error("Faltan datos obligatorios de la reserva.");
        }
        if (datos.tarifa <= 0) {
            const resultado = reglaTarifa.resolver({
                adultos: datos.adultos,
                ninos: datos.ninos
            });
            throw new Error(resultado.mensaje);
        }
        if (!(await cabanaDisponible(datos))) {
            throw new Error(`CAB ${datos.cabana} ya no está disponible para ese Full Day.`);
        }

        const { data, error } = await cliente.rpc("haiku_crear_reserva", {
            p_titular_nombre: datos.titular,
            p_cabana_numero: datos.cabana,
            p_fecha_ingreso: datos.llegada,
            p_fecha_salida: datos.llegada,
            p_adultos: Math.max(0, datos.adultos),
            p_ninos: Math.max(0, datos.ninos),
            p_mascotas: Math.max(0, datos.mascotas),
            p_correo_contacto: datos.correo || null,
            p_telefono_contacto: datos.telefono || null,
            p_rut: datos.rut || null,
            p_observaciones: datos.observaciones || null,
            p_tarifas: { [datos.llegada]: datos.tarifa },
            p_acompanantes: datos.acompanantes,
            p_tipo_estadia: "fullday",
            p_cloudbeds_id: null
        });
        if (error) throw error;
        return data;
    }

    document.addEventListener("click", evento => {
        const tipo = evento.target.closest?.("[data-haiku-tipo-estadia]")?.dataset?.haikuTipoEstadia;
        if (!tipo || modoActual() !== "crear") return;
        evento.preventDefault();
        aplicarTipo(tipo);
    });

    document.addEventListener("click", evento => {
        if (modoActual() !== "crear" || tipoCreacion !== "fullday") return;
        const dia = evento.target.closest?.("#reserva-calendario .reserva-dia[data-fecha]");
        if (!dia || dia.disabled) return;
        const fecha = dia.dataset.fecha;
        setTimeout(() => {
            try {
                fechaLlegadaReserva = fecha;
                fechaSalidaReserva = fechaMasUno(fecha);
                tarifasNochesReserva = {};
                resolverTarifaFullDay();
                if (typeof actualizarSeleccionCalendarioReserva === "function") {
                    actualizarSeleccionCalendarioReserva();
                }
            } catch {}
            ajustarVisual();
        }, 0);
    });

    document.addEventListener("click", evento => {
        if (modoActual() !== "crear" || tipoCreacion !== "fullday") return;
        const tarjeta = evento.target.closest?.(".reserva-cabana-opcion[data-cabana]");
        if (!tarjeta) return;
        setTimeout(() => {
            resolverTarifaFullDay();
            ajustarVisual();
        }, 0);
    });

    document.addEventListener("click", evento => {
        if (modoActual() !== "crear" || tipoCreacion !== "fullday") return;
        if (!evento.target.closest?.(".reserva-tarifas-aplicar")) return;
        setTimeout(() => {
            const fecha = llegadaActual();
            try {
                tarifaFullDay = Number(tarifasNochesReserva?.[fecha] || tarifaFullDay || 0);
                tarifaManual = tarifaFullDay > 0;
                resolverTarifaFullDay();
            } catch {}
            ajustarVisual();
        }, 0);
    });

    document.addEventListener("change", evento => {
        if (modoActual() !== "crear" || tipoCreacion !== "fullday") return;
        if (!evento.target.closest?.(".reserva-ocupacion-adultos, .reserva-ocupacion-ninos")) return;
        setTimeout(() => {
            resolverTarifaFullDay();
            ajustarVisual();
        }, 0);
    });

    document.addEventListener("click", async evento => {
        const boton = evento.target.closest?.("#crear-nueva-reserva");
        if (!boton || modoActual() !== "crear" || tipoCreacion !== "fullday") return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
        if (guardando) return;

        const datos = datosFormularioFullDay();
        const texto = boton.textContent;
        guardando = true;
        boton.disabled = true;
        boton.textContent = "Creando Full Day…";

        try {
            const resultado = await crearFullDay(datos);
            console.info("HAIKU · Full Day creado en Supabase:", resultado);

            if (typeof window.haikuSincronizarReservasSupabase === "function") {
                await window.haikuSincronizarReservasSupabase();
            }
            try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}
            try { if (typeof generarCalendario === "function") generarCalendario(); } catch {}

            document.getElementById("cerrar-nueva-reserva")?.click();
            alert("Full Day creado correctamente.");
        } catch (error) {
            console.error("HAIKU · No fue posible crear Full Day:", error);
            alert(error?.message || "No fue posible crear el Full Day.");
        } finally {
            guardando = false;
            boton.disabled = false;
            boton.textContent = texto;
        }
    }, true);

    document.addEventListener("click", evento => {
        if (!evento.target.closest?.("#boton-nueva-reserva")) return;
        tipoCreacion = "alojamiento";
        tarifaFullDay = 0;
        tarifaManual = false;
        setTimeout(mostrarEditorCreacion, 60);
        setTimeout(ajustarVisual, 140);
    }, true);

    document.addEventListener("click", evento => {
        if (modoActual() !== "crear" || tipoCreacion !== "fullday") return;
        if (!evento.target.closest?.(
            "#continuar-fechas-reserva, #continuar-reserva-detalles, .reserva-editar-tarifas, #volver-reserva-fechas, #volver-reserva-cabana"
        )) return;
        setTimeout(ajustarVisual, 0);
        setTimeout(ajustarVisual, 80);
    });

    console.info("HAIKU · Nueva reserva Full Day V1 preparada.");
})();
