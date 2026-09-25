// ========================================
// HAIKU · RESERVA CON CAMBIO DE CABAÑA V2
// Guardia del flujo V1: disponibilidad Supabase + creación con botón exclusivo.
// Evita que el creador simple intercepte una reserva multitramos.
// Sin observers, intervalos, parches de clientes ni prototipos globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_RESERVA_CAMBIO_CABANA_V2) return;

    const sb = window.haikuSupabase;
    if (!sb) return;

    const ID_NORMAL = "crear-nueva-reserva";
    const ID_CAMBIO = "crear-reserva-cambio-cabana";
    let guardando = false;
    let verificandoPaso = false;

    const $ = selector => document.querySelector(selector);

    function modoCrearAlojamiento() {
        let modo = "crear";
        try { modo = String(modoFormularioReserva || "crear"); } catch {}
        const fullDay = Boolean(
            document.querySelector('[data-haiku-tipo-estadia="fullday"].activo')
        );
        return modo === "crear" && !fullDay;
    }

    function estadoV1() {
        try {
            return window.HAIKU_RESERVA_CAMBIO_CABANA_V1?.estado?.() || {
                tramos: [],
                tramosConfirmacion: []
            };
        } catch {
            return { tramos: [], tramosConfirmacion: [] };
        }
    }

    function fmtFecha(fecha) {
        try { return formatearFechaReserva(fecha); }
        catch {
            const [a,m,d] = String(fecha || "").split("-");
            return a && m && d ? `${d}-${m}-${a}` : String(fecha || "—");
        }
    }

    function fmtDinero(valor) {
        try { return formatearPrecioReserva(Number(valor || 0)); }
        catch { return `$${Number(valor || 0).toLocaleString("es-CL")}`; }
    }

    function restaurarBotonNormal() {
        const boton = document.getElementById(ID_CAMBIO);
        if (!boton) return;
        boton.id = ID_NORMAL;
        delete boton.dataset.haikuCambioCabanaV2;
        boton.textContent = "Crear reserva";
        boton.disabled = false;
    }

    async function consultarDisponibles(fechaIngreso, fechaSalida) {
        const { data, error } = await sb.rpc("haiku_cabanas_disponibles", {
            p_fecha_ingreso: fechaIngreso,
            p_fecha_salida: fechaSalida,
            p_tipo_estadia: "alojamiento"
        });
        if (error) throw error;
        return new Set((data || []).map(item => Number(item.numero)));
    }

    function asegurarEstadoDisponibilidad() {
        const lista = $("#lista-cabanas-disponibles");
        if (!lista) return null;
        let estado = $("#haiku-disponibilidad-supabase-v2");
        if (!estado) {
            estado = document.createElement("div");
            estado.id = "haiku-disponibilidad-supabase-v2";
            estado.style.cssText = "margin:0 0 10px;padding:9px 11px;border:1px solid #dfe8e2;border-radius:10px;background:#f7faf8;font-size:12px;color:#52605a;";
            lista.parentNode?.insertBefore(estado, lista);
        }
        return estado;
    }

    async function filtrarPasoCabanaConSupabase() {
        if (!modoCrearAlojamiento() || verificandoPaso) return;

        let llegada = "";
        let salida = "";
        try { llegada = String(fechaLlegadaReserva || "").slice(0,10); } catch {}
        try { salida = String(fechaSalidaReserva || "").slice(0,10); } catch {}
        if (!llegada || !salida) return;

        const lista = $("#lista-cabanas-disponibles");
        if (!lista || lista.closest("[hidden]")) return;

        const estado = asegurarEstadoDisponibilidad();
        const continuar = $("#continuar-reserva-detalles");
        const tarjetas = [...lista.querySelectorAll(".reserva-cabana-opcion[data-cabana]")];

        verificandoPaso = true;
        if (estado) estado.textContent = "Verificando disponibilidad real en Supabase…";
        tarjetas.forEach(t => { t.disabled = true; });
        if (continuar) continuar.disabled = true;

        try {
            const disponibles = await consultarDisponibles(llegada, salida);
            let visibles = 0;

            tarjetas.forEach(tarjeta => {
                const numero = Number(tarjeta.dataset.cabana || 0);
                if (!disponibles.has(numero)) {
                    tarjeta.remove();
                    return;
                }
                tarjeta.disabled = false;
                visibles += 1;
            });

            if (estado) {
                estado.textContent = visibles > 0
                    ? `Disponibilidad verificada en Supabase · ${visibles} ${visibles === 1 ? "cabaña disponible" : "cabañas disponibles"}.`
                    : "No hay cabañas disponibles para este rango.";
            }

            if (visibles === 0) {
                try { cabanaSeleccionadaReserva = ""; } catch {}
            }
        } catch (error) {
            console.error("HAIKU · No fue posible verificar disponibilidad del selector:", error);
            tarjetas.forEach(t => { t.disabled = true; });
            if (estado) estado.textContent = "No fue posible verificar disponibilidad. No selecciones una cabaña hasta recargar o volver a intentar.";
            alert("No fue posible verificar la disponibilidad real en Supabase. No se habilitaron cabañas para evitar una sobreventa.");
        } finally {
            verificandoPaso = false;
        }
    }

    async function verificarTramos(tramos) {
        for (let i = 0; i < tramos.length; i++) {
            const tramo = tramos[i];
            const disponibles = await consultarDisponibles(
                String(tramo.fecha_ingreso).slice(0,10),
                String(tramo.fecha_salida).slice(0,10)
            );
            if (!disponibles.has(Number(tramo.cabana))) {
                throw new Error(
                    `Tramo ${i + 1}: CAB ${tramo.cabana} ya no está disponible entre ${fmtFecha(tramo.fecha_ingreso)} y ${fmtFecha(tramo.fecha_salida)}.`
                );
            }
        }
        return true;
    }

    async function convertirBotonYVerificar() {
        const estado = estadoV1();
        if (!modoCrearAlojamiento() || estado.tramosConfirmacion.length < 2) return;

        const boton = document.getElementById(ID_NORMAL) || document.getElementById(ID_CAMBIO);
        if (!boton || boton.dataset.haikuCambioCabana !== "1") return;

        // El ID exclusivo evita que supabase-data.js trate este clic como reserva simple.
        boton.id = ID_CAMBIO;
        boton.dataset.haikuCambioCabanaV2 = "1";
        boton.disabled = true;
        boton.textContent = "Verificando disponibilidad…";

        try {
            await verificarTramos(estado.tramosConfirmacion);
            boton.disabled = false;
            boton.textContent = "Crear reserva con cambio de cabaña";
        } catch (error) {
            console.warn("HAIKU · Cambio de cabaña no pasó prevalidación:", error);
            boton.disabled = true;
            boton.textContent = "Revisar disponibilidad";
            alert(error?.message || "Alguno de los alojamientos ya no está disponible.");
        }
    }

    function datosFormulario() {
        return {
            titular: $("#reserva-nuevo-titular")?.value.trim() || "",
            telefono: $("#reserva-nuevo-telefono")?.value.trim() || "",
            rut: $("#reserva-nuevo-rut")?.value.trim() || "",
            correo: $("#reserva-nuevo-correo")?.value.trim() || "",
            observaciones: $("#reserva-nueva-observacion")?.value.trim() || "",
            acompanantes: [...document.querySelectorAll(".reserva-nuevo-acompanante")]
                .map(c => c.value.trim()).filter(Boolean)
        };
    }

    async function crearCambioCabana(boton) {
        if (guardando) return;

        const estado = estadoV1();
        const tramos = estado.tramosConfirmacion || [];
        if (tramos.length < 2) {
            alert("La reserva necesita al menos dos alojamientos consecutivos.");
            return;
        }

        const datos = datosFormulario();
        if (!datos.titular) {
            alert("Ingresa el nombre del titular de la reserva.");
            $("#reserva-nuevo-titular")?.focus();
            return;
        }

        const correo = $("#reserva-nuevo-correo");
        if (correo?.value.trim() && !correo.checkValidity()) {
            alert("Revisa que el correo esté escrito correctamente.");
            correo.focus();
            return;
        }

        if (!window.haikuTienePermiso?.("reservas.crear")) {
            alert("Tu usuario no tiene permiso para crear reservas.");
            return;
        }

        const payload = tramos.map(t => ({
            cabana: Number(t.cabana),
            fecha_ingreso: String(t.fecha_ingreso).slice(0,10),
            fecha_salida: String(t.fecha_salida).slice(0,10),
            tarifas: { ...(t.tarifas || {}) }
        }));

        const primero = tramos[0] || {};
        const texto = boton.textContent;
        guardando = true;
        boton.disabled = true;
        boton.textContent = "Creando reserva completa…";

        try {
            // Preflight de UX. La RPC vuelve a validar todo dentro de la misma transacción.
            await verificarTramos(payload);

            const { data, error } = await sb.rpc("haiku_crear_reserva_cambio_cabana", {
                p_titular_nombre: datos.titular,
                p_tramos: payload,
                p_adultos: Number(primero.adultos ?? 1),
                p_ninos: Number(primero.ninos ?? 0),
                p_mascotas: Number(primero.mascotas ?? 0),
                p_correo_contacto: datos.correo || null,
                p_telefono_contacto: datos.telefono || null,
                p_rut: datos.rut || null,
                p_observaciones: datos.observaciones || null,
                p_acompanantes: datos.acompanantes,
                p_cloudbeds_id: null
            });
            if (error) throw error;

            if (!data?.reserva_id || Number(data?.cantidad_tramos || 0) !== payload.length) {
                throw new Error("Supabase no confirmó todos los alojamientos. No se considera creada la reserva.");
            }

            try { reservaCreadaId = String(data.reserva_id); } catch {}
            try { cabanaSeleccionadaReserva = String(payload[0].cabana); } catch {}
            try { fechaLlegadaReserva = payload[0].fecha_ingreso; } catch {}
            try { fechaSalidaReserva = payload[payload.length - 1].fecha_salida; } catch {}

            if (typeof window.haikuSincronizarReservasSupabase === "function") {
                await window.haikuSincronizarReservasSupabase();
            }
            try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}
            try { if (typeof generarCalendario === "function") generarCalendario(); } catch {}
            try { if (typeof cargarCabanasDia === "function") cargarCabanasDia(fechaSeleccionada, {
                evento: "cambio de cabaña confirmado", tipo: "externo"
            }); } catch {}

            const confirmacion = $("#reserva-paso-confirmacion");
            const resumen = $("#reserva-confirmacion-resumen");
            const paso3 = $("#reserva-paso-detalles");
            const titulo = confirmacion?.querySelector(".reserva-confirmacion-titulo strong");
            const subtitulo = confirmacion?.querySelector(".reserva-confirmacion-titulo span");

            if (titulo) titulo.textContent = "¡Reserva creada!";
            if (subtitulo) subtitulo.textContent = `${payload.length} alojamientos consecutivos fueron registrados en una sola reserva.`;

            if (resumen) {
                resumen.innerHTML = `
                    <div class="reserva-confirmacion-fila"><span>Alojamientos</span><strong>${payload.map(t => `CAB ${t.cabana}`).join(" → ")}</strong></div>
                    <div class="reserva-confirmacion-fila"><span>Fechas</span><strong>${fmtFecha(payload[0].fecha_ingreso)} → ${fmtFecha(payload[payload.length-1].fecha_salida)}</strong></div>
                    <div class="reserva-confirmacion-fila"><span>Titular</span><strong>${datos.titular}</strong></div>
                    <div class="reserva-confirmacion-fila"><span>Total alojamiento</span><strong class="reserva-confirmacion-total">${fmtDinero(data.total_alojamiento)}</strong></div>
                    <div class="reserva-confirmacion-id">${data.codigo_haiku || data.reserva_id}</div>`;
            }

            if (paso3) paso3.hidden = true;
            if (confirmacion) confirmacion.hidden = false;
            document.querySelectorAll(".reserva-paso").forEach(p =>
                p.classList.toggle("activo", p.dataset.paso === "4")
            );

            console.info("HAIKU · Cambio de cabaña V2 creado atómicamente:", data);
        } catch (error) {
            console.error("HAIKU · No fue posible crear cambio de cabaña V2:", error);
            alert(error?.message || "No fue posible crear la reserva. No se guardó ningún tramo.");
            boton.disabled = false;
            boton.textContent = texto;
        } finally {
            guardando = false;
        }
    }

    // Al entrar al selector de CAB, contrastar el listado legacy contra Supabase.
    document.addEventListener("click", evento => {
        if (!evento.target.closest?.("#continuar-fechas-reserva")) return;
        if (!modoCrearAlojamiento()) return;
        setTimeout(filtrarPasoCabanaConSupabase, 0);
        setTimeout(filtrarPasoCabanaConSupabase, 80);
    }, true);

    // Este listener se registra antes que V1. V1 prepara el detalle; luego cambiamos el ID.
    document.addEventListener("click", evento => {
        if (!evento.target.closest?.("#continuar-reserva-detalles")) return;
        if (!modoCrearAlojamiento() || estadoV1().tramos.length < 1) return;
        setTimeout(convertirBotonYVerificar, 0);
        setTimeout(convertirBotonYVerificar, 80);
    }, true);

    // Botón exclusivo: ni supabase-data ni el creador legacy lo reconocen.
    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.(`#${ID_CAMBIO}`);
        if (!boton || boton.dataset.haikuCambioCabanaV2 !== "1") return;
        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
        crearCambioCabana(boton);
    }, true);

    // Antes de que V1 resetee, devolver el ID normal para el siguiente flujo.
    document.addEventListener("click", evento => {
        if (evento.target.closest?.("#boton-nueva-reserva, #crear-otra-reserva, #cerrar-nueva-reserva, #cancelar-nueva-reserva")) {
            restaurarBotonNormal();
            $("#haiku-disponibilidad-supabase-v2")?.remove();
            return;
        }

        if (evento.target.closest?.("[data-haiku-quitar-tramo]")) {
            setTimeout(() => {
                if (estadoV1().tramos.length === 0) restaurarBotonNormal();
            }, 0);
        }
    }, true);

    window.HAIKU_RESERVA_CAMBIO_CABANA_V2 = Object.freeze({
        filtrarDisponibilidad: filtrarPasoCabanaConSupabase,
        verificarTramos,
        restaurarBotonNormal
    });

    console.info("HAIKU · Reserva con cambio de cabaña V2 preparada.");
})();
