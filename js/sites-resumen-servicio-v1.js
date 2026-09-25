// Resumen Sites: un solo formulario visible y el RPC oficial como escritor.
(() => {
    "use strict";

    if (window.HAIKU_RESUMEN_SERVICIO_SITES_V1) return;

    const RPC = "haiku_registrar_servicio";
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const FECHA = /^\d{4}-\d{2}-\d{2}$/;
    const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
    const estado = { identidad: null, catalogo: new Map(), ocupada: false, consumida: false, version: 0, origen: "resumen" };

    const elemento = id => document.getElementById(id);
    // Una sesión autenticada jamás puede caer en el guardado local si falla el cliente.
    const sesionReal = () => Boolean(window.haikuSesion);
    const permiso = () => window.haikuTienePermiso?.("servicios.crear") === true;
    const fechaActual = () => {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    };
    const fechaOrigen = () => estado.origen === "servicios"
        ? String(elemento("sites-servicios-fecha")?.value || "") : fechaActual();

    function identidadOperacion(fila) {
        if (!fila) return null;
        const estadoOperativo = String(fila.estado_operativo || "");
        const claves = {
            "libre-ingresa": ["ingreso_reserva_id", "ingreso_estadia_id"],
            "sale-ingresa": ["ingreso_reserva_id", "ingreso_estadia_id"],
            "sale-libre": ["salida_reserva_id", "salida_estadia_id"],
            continua: ["continua_reserva_id", "continua_estadia_id"],
            fullday: ["fullday_reserva_id", "fullday_estadia_id"]
        }[estadoOperativo];
        if (!claves) return null;
        const reservaId = String(fila[claves[0]] || "");
        const estadiaId = String(fila[claves[1]] || "");
        return UUID.test(reservaId) && UUID.test(estadiaId)
            ? { reservaId, estadiaId, estadoOperativo, numeroCabana: String(fila.numero || "") }
            : null;
    }

    function articuloActual(numeroCabana, fecha) {
        const article = document.querySelector(
            `#seccion-resumen .sites-resumen-cabana[data-cabana="${numeroCabana}"]`
        );
        if (!article || article.dataset.resumenFecha !== fecha) return null;
        const boton = article.querySelector("[data-agregar-servicio]");
        return boton && !boton.hidden ? article : null;
    }

    async function identidadVigente(numeroCabana, fecha, reservaEsperada = "") {
        if (!sesionReal() || !window.haikuSupabase || !permiso() ||
            !FECHA.test(fecha) || !/^\d{1,2}$/.test(numeroCabana)) {
            throw new Error("La sesión, el permiso o la fecha del servicio no son válidos.");
        }
        const article = estado.origen === "resumen" ? articuloActual(numeroCabana, fecha) : null;
        if (estado.origen === "resumen" && !article) {
            throw new Error("El Resumen cambió. Actualiza el día antes de agregar el servicio.");
        }
        if (estado.origen === "servicios" && fechaOrigen() !== fecha) {
            throw new Error("La fecha de Servicios cambió. Reabre el formulario.");
        }

        const cliente = window.haikuSupabase;
        const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error) throw error;
        const filas = (Array.isArray(data) ? data : []).filter(fila =>
            String(fila.numero) === numeroCabana
        );
        if (filas.length !== 1) throw new Error("No hay una cabaña única para esta fecha.");
        const actual = identidadOperacion(filas[0]);
        if (!actual || (reservaEsperada && actual.reservaId !== reservaEsperada)) {
            throw new Error("La reserva cambió. Reabre el formulario desde el Resumen actualizado.");
        }
        if (article && article.dataset.resumenReservaId !== actual.reservaId) {
            throw new Error("La reserva visible ya no coincide con Proyecto H. Actualiza el Resumen.");
        }
        if (article && article.dataset.resumenEstadiaId !== actual.estadiaId) {
            throw new Error("La estadía visible ya no coincide con Proyecto H. Actualiza el Resumen.");
        }

        const { data: estadia, error: errorEstadia } = await cliente.from("reserva_estadias")
            .select("id,reserva_id,fecha_ingreso,fecha_salida,estado_estadia,adultos,ninos,cabanas(numero)")
            .eq("id", actual.estadiaId).eq("reserva_id", actual.reservaId).single();
        if (errorEstadia) throw errorEstadia;
        if (!estadia || String(estadia.cabanas?.numero) !== numeroCabana ||
            ["cancelada", "no_show"].includes(String(estadia.estado_estadia || ""))) {
            throw new Error("La estadía ya no corresponde a esta reserva y cabaña.");
        }
        const { data: reserva, error: errorReserva } = await cliente.from("reservas")
            .select("id,estado_reserva,titular_nombre,codigo_haiku").eq("id", actual.reservaId).single();
        if (errorReserva) throw errorReserva;
        if (!reserva || ["cancelada", "no_show"].includes(String(reserva.estado_reserva || ""))) {
            throw new Error("La reserva ya no está activa para registrar servicios.");
        }
        return {
            ...actual, fecha,
            ingreso: String(estadia.fecha_ingreso || "").slice(0, 10),
            salida: String(estadia.fecha_salida || "").slice(0, 10),
            titular: String(reserva.titular_nombre || "").trim(),
            codigoHaiku: String(reserva.codigo_haiku || "").trim(),
            adultos: Number(estadia.adultos || 0),
            ninos: Number(estadia.ninos || 0)
        };
    }

    async function catalogoReal() {
        const { data, error } = await window.haikuSupabase.from("catalogo_servicios")
            .select("codigo,nombre,categoria,unidad,precio_base,precio_persona_adicional,capacidad_incluida,capacidad_maxima,requiere_horario,permite_cortesia,activo")
            .eq("activo", true).order("nombre", { ascending: true });
        if (error) throw error;
        const filas = (Array.isArray(data) ? data : []).filter(fila => fila.codigo && fila.nombre);
        if (!filas.length) throw new Error("No se pudo leer el catálogo activo de Proyecto H.");
        return filas;
    }

    function precioCatalogo(producto, cantidad, personas, precioManual = null) {
        const base = precioManual === null ? Number(producto.precio_base || 0) : precioManual;
        const adicional = precioManual === null && producto.capacidad_incluida != null &&
            producto.precio_persona_adicional != null
            ? Math.max(0, personas - Number(producto.capacidad_incluida)) *
                Number(producto.precio_persona_adicional)
            : 0;
        return base * cantidad + adicional;
    }

    function entero(valor, minimo) {
        const texto = String(valor ?? "").trim();
        const numero = Number(texto);
        return /^\d+$/.test(texto) && Number.isSafeInteger(numero) && numero >= minimo
            ? numero : null;
    }

    function validarFormulario(valores, producto, identidad) {
        if (!producto?.activo) throw new Error("El servicio no está activo en el catálogo real.");
        const cantidad = entero(valores.cantidad, 1);
        const personas = entero(valores.personas, 0);
        if (cantidad === null || personas === null) throw new Error("Cantidad o personas inválidas.");
        if (["tinajaTonel", "tinajaJacuzzi"].includes(producto.codigo) && personas < 1) {
            throw new Error("La tinaja requiere al menos una persona.");
        }
        if (producto.capacidad_maxima != null && personas > Number(producto.capacidad_maxima)) {
            throw new Error(`Este servicio admite máximo ${producto.capacidad_maxima} personas.`);
        }
        const fecha = String(valores.fecha || "").trim();
        if (!FECHA.test(fecha) || fecha < identidad.ingreso || fecha > identidad.salida) {
            throw new Error("La fecha del servicio debe pertenecer a esta estadía.");
        }
        const requiereHorario = producto.requiere_horario || producto.codigo === "earlyCheckin";
        const hora = requiereHorario ? String(valores.hora || "").trim() : "";
        if (requiereHorario && !HORA.test(hora)) {
            throw new Error("Selecciona una hora válida para este servicio.");
        }
        if (hora && !HORA.test(hora)) throw new Error("La hora del servicio no es válida.");
        const tipoCobro = String(valores.tipoCobro || "");
        if (!["normal", "cortesia"].includes(tipoCobro)) throw new Error("Tipo de cobro inválido.");
        if (tipoCobro === "cortesia" && !producto.permite_cortesia) {
            throw new Error("El catálogo no permite cortesía para este servicio.");
        }
        const motivo = String(valores.motivo || "").trim();
        if (tipoCobro === "cortesia" && !motivo) throw new Error("Indica el motivo de la cortesía.");
        const manualTexto = String(valores.precioManual ?? "").trim();
        const precioManual = manualTexto === "" ? null : entero(manualTexto, 1);
        if (producto.codigo === "earlyCheckin" && precioManual === null) {
            throw new Error("Early Check-In requiere un precio manual positivo por hora.");
        }
        if (manualTexto !== "" && precioManual === null) {
            throw new Error("El precio manual debe ser un entero positivo.");
        }
        if (precioManual !== null && !["tinajaJacuzzi", "earlyCheckin"].includes(producto.codigo)) {
            throw new Error("El precio manual sólo está disponible para Jacuzzi y Early Check-In.");
        }
        // El RPC de alta suma el adicional una vez, aunque la cantidad sea varias horas.
        // Evitar un total menor al precio por hora aprobado para Jacuzzi.
        if (producto.codigo === "tinajaJacuzzi" && precioManual === null && cantidad > 1 &&
            producto.capacidad_incluida != null && personas > Number(producto.capacidad_incluida)) {
            throw new Error("Jacuzzi de varias horas con personas adicionales requiere revisión de precio.");
        }
        const total = tipoCobro === "cortesia" ? 0 :
            precioCatalogo(producto, cantidad, personas, precioManual);
        if (!Number.isSafeInteger(total) || total < 0) throw new Error("El precio del catálogo no es válido.");
        return {
            p_reserva_id: identidad.reservaId,
            p_estadia_id: identidad.estadiaId,
            p_codigo_servicio: producto.codigo,
            p_fecha_servicio: fecha,
            p_hora: hora || null,
            p_cantidad: cantidad,
            p_personas: personas,
            p_tipo_cobro: tipoCobro,
            p_precio_manual: precioManual,
            p_motivo_cortesia: tipoCobro === "cortesia" ? motivo : null,
            p_observaciones: String(valores.observaciones ?? "").trim() || null
        };
    }

    const campoPersonas = () => elemento("resumen-servicio-personas");
    const campoMotivo = () => elemento("resumen-servicio-motivo-cortesia");

    function contextoReserva(identidad) {
        const partes = [identidad.titular, identidad.codigoHaiku].filter(Boolean);
        if (Number.isSafeInteger(identidad.adultos) && identidad.adultos > 0) {
            partes.push(`${identidad.adultos} adulto${identidad.adultos === 1 ? "" : "s"}`);
        }
        if (Number.isSafeInteger(identidad.ninos) && identidad.ninos > 0) {
            partes.push(`${identidad.ninos} niño${identidad.ninos === 1 ? "" : "s"}`);
        }
        return `${partes.join(" · ") || "Reserva comprobada"}. Guardar servicio modificará Proyecto H.`;
    }

    function estadoVisible(mensaje, error = false) {
        const modal = elemento("resumen-servicio-modal");
        if (!modal) return;
        let aviso = elemento("resumen-servicio-sites-estado");
        if (!aviso) {
            aviso = document.createElement("p");
            aviso.id = "resumen-servicio-sites-estado";
            aviso.setAttribute("role", "status");
            aviso.setAttribute("aria-live", "polite");
            modal.querySelector(".resumen-servicio-modal-cabecera")?.insertAdjacentElement("afterend", aviso);
        }
        aviso.textContent = mensaje;
        aviso.dataset.error = error ? "true" : "false";
    }

    function valoresFormulario() {
        return {
            codigo: elemento("resumen-servicio-producto")?.value || "",
            cantidad: elemento("resumen-servicio-cantidad")?.value || "",
            personas: campoPersonas()?.value || "",
            fecha: elemento("resumen-servicio-fecha")?.value || estado.identidad?.fecha || "",
            hora: elemento("resumen-servicio-hora")?.value || "",
            tipoCobro: document.querySelector('input[name="resumen-servicio-tipo-cobro"]:checked')?.value || "",
            precioManual: elemento("resumen-servicio-precio-manual")?.value || "",
            motivo: campoMotivo()?.value || "",
            observaciones: elemento("resumen-servicio-observaciones")?.value || ""
        };
    }

    function pintarSeleccion() {
        if (!sesionReal() || !estado.identidad) return;
        const producto = estado.catalogo.get(elemento("resumen-servicio-producto")?.value || "");
        const programacion = elemento("resumen-servicio-programacion");
        const precioManual = elemento("resumen-servicio-precio-manual-wrap");
        const etiquetaPrecioManual = elemento("resumen-servicio-precio-manual-label");
        const campoPrecioManual = elemento("resumen-servicio-precio-manual");
        const motivo = elemento("resumen-servicio-motivo-wrap");
        const valores = valoresFormulario();
        if (programacion) programacion.hidden = !(producto?.requiere_horario || producto?.codigo === "earlyCheckin");
        const precioEditable = ["tinajaJacuzzi", "earlyCheckin"].includes(producto?.codigo);
        if (precioManual) precioManual.hidden = !precioEditable;
        if (etiquetaPrecioManual) etiquetaPrecioManual.textContent = producto?.codigo === "earlyCheckin"
            ? "Precio por hora · Early Check-In" : "Precio por hora · Jacuzzi";
        if (campoPrecioManual) campoPrecioManual.placeholder = producto?.codigo === "earlyCheckin"
            ? "Ej. 10000" : "Ej. 40000";
        if (!precioEditable && campoPrecioManual) {
            campoPrecioManual.value = "";
        }
        if (motivo) motivo.hidden = valores.tipoCobro !== "cortesia";
        if (campoPersonas()) campoPersonas().max = producto?.capacidad_maxima || "";
        const total = elemento("resumen-servicio-total");
        if (!total) return;
        if (!producto) { total.textContent = "$0"; return; }
        try {
            const payload = validarFormulario({
                ...valores,
                fecha: valores.fecha || estado.identidad.fecha,
                hora: (producto.requiere_horario || producto.codigo === "earlyCheckin")
                    ? (valores.hora || "19:00") : "",
                motivo: valores.tipoCobro === "cortesia" ? (valores.motivo || "Vista previa") : ""
            }, producto, estado.identidad);
            total.textContent = payload.p_tipo_cobro === "cortesia" ? "$0" :
                `$${precioCatalogo(producto, payload.p_cantidad, payload.p_personas,
                    payload.p_precio_manual).toLocaleString("es-CL")}`;
        } catch { total.textContent = "—"; }
    }

    async function abrir(numeroCabana, opciones = {}) {
        const modal = elemento("resumen-servicio-modal");
        const guardar = elemento("resumen-servicio-guardar");
        if (!modal || !guardar) return;
        const version = ++estado.version;
        estado.origen = opciones.origen === "servicios" ? "servicios" : "resumen";
        estado.identidad = null;
        estado.catalogo = new Map();
        estado.consumida = false;
        const fecha = estado.origen === "servicios" ? String(opciones.fecha || "") : fechaActual();
        modal.hidden = false;
        guardar.disabled = true;
        elemento("resumen-servicio-observaciones").value = "";
        elemento("resumen-servicio-kicker").textContent = `CABAÑA ${numeroCabana}`;
        elemento("resumen-servicio-titulo").textContent = "Agregar servicio";
        elemento("resumen-servicio-contexto").textContent = "Comprobando la reserva de Proyecto H…";
        estadoVisible("Comprobando reserva, estadía y catálogo de Proyecto H…");
        try {
            const identidad = await identidadVigente(numeroCabana, fecha);
            const catalogo = await catalogoReal();
            if (version !== estado.version || modal.hidden) return;
            estado.identidad = identidad;
            estado.catalogo = new Map(catalogo.map(fila => [String(fila.codigo), fila]));
            const producto = elemento("resumen-servicio-producto");
            producto.replaceChildren(new Option("Seleccionar servicio", ""),
                ...catalogo.map(fila => new Option(fila.nombre, fila.codigo)));
            producto.value = "";
            elemento("resumen-servicio-cabana").value = `Cabaña ${numeroCabana}`;
            elemento("resumen-servicio-cabana").dataset.numeroCabana = numeroCabana;
            elemento("resumen-servicio-contexto").textContent = contextoReserva(identidad);
            elemento("resumen-servicio-cantidad").value = "1";
            campoPersonas().value = "1";
            campoMotivo().value = "";
            elemento("resumen-servicio-fecha").value = fecha;
            elemento("resumen-servicio-hora").value = "";
            elemento("resumen-servicio-precio-manual").value = "";
            document.querySelector('input[name="resumen-servicio-tipo-cobro"][value="normal"]').checked = true;
            pintarSeleccion();
            guardar.disabled = false;
            estadoVisible("Reserva y catálogo comprobados. Guardar servicio modificará Proyecto H.");
            producto.focus();
        } catch (error) {
            if (version !== estado.version) return;
            estadoVisible(error?.message || "No fue posible comprobar este servicio.", true);
            guardar.disabled = true;
        }
    }

    async function comprobarResultado(respuesta, payload, totalEsperado) {
        const id = String(respuesta?.servicio_id || "");
        if (!UUID.test(id) || !["creado", "ya_existente"].includes(String(respuesta?.estado || ""))) {
            throw new Error("El RPC no confirmó un servicio verificable.");
        }
        if (respuesta.codigo !== payload.p_codigo_servicio ||
            respuesta.tipo_cobro !== payload.p_tipo_cobro ||
            Number(respuesta.total) !== totalEsperado) {
            throw new Error("El resultado del RPC no coincide con el servicio confirmado.");
        }
        const { data, error } = await window.haikuSupabase.from("servicios")
            .select("id,reserva_id,estadia_id,fecha_servicio,hora_inicio,cantidad,personas,total,tipo_cobro,estado_servicio,catalogo_servicios(codigo)")
            .eq("id", id).single();
        if (error) throw error;
        if (!data || data.reserva_id !== payload.p_reserva_id ||
            data.estadia_id !== payload.p_estadia_id ||
            data.catalogo_servicios?.codigo !== payload.p_codigo_servicio ||
            String(data.fecha_servicio || "").slice(0, 10) !== payload.p_fecha_servicio ||
            String(data.hora_inicio || "").slice(0, 5) !== (payload.p_hora || "") ||
            Number(data.cantidad) !== payload.p_cantidad ||
            Number(data.personas) !== payload.p_personas ||
            Number(data.total) !== totalEsperado ||
            data.tipo_cobro !== payload.p_tipo_cobro ||
            ["cancelado", "no_show"].includes(String(data.estado_servicio || ""))) {
            throw new Error("El servicio registrado requiere revisión: la verificación posterior no coincide.");
        }
        return data;
    }

    async function confirmar() {
        if (estado.ocupada || estado.consumida) return false;
        const guardar = elemento("resumen-servicio-guardar");
        const identidad = estado.identidad;
        if (!identidad || !guardar || !sesionReal()) return false;
        estado.ocupada = true;
        guardar.disabled = true;
        const textoBoton = guardar.textContent;
        guardar.textContent = "Guardando…";
        let rpcIniciado = false;
        try {
            if (!permiso() || fechaOrigen() !== identidad.fecha) {
                throw new Error("La sesión, el permiso o el día seleccionado cambiaron.");
            }
            const valores = valoresFormulario();
            const actual = await identidadVigente(identidad.numeroCabana, identidad.fecha,
                identidad.reservaId);
            if (actual.estadiaId !== identidad.estadiaId) {
                throw new Error("La estadía cambió. Reabre el formulario.");
            }
            const catalogo = await catalogoReal();
            const producto = catalogo.find(fila => fila.codigo === valores.codigo);
            if (!producto || JSON.stringify(producto) !==
                JSON.stringify(estado.catalogo.get(valores.codigo))) {
                throw new Error("El catálogo cambió. Reabre el formulario antes de guardar.");
            }
            const article = articuloActual(identidad.numeroCabana, identidad.fecha);
            if (!permiso() || fechaOrigen() !== identidad.fecha ||
                (estado.origen === "resumen" && (
                    article?.dataset.resumenReservaId !== identidad.reservaId ||
                    article?.dataset.resumenEstadiaId !== identidad.estadiaId))) {
                throw new Error("La reserva, la estadía o el permiso cambiaron. Reabre el formulario.");
            }
            const payload = validarFormulario(valores, producto, actual);
            const totalEsperado = payload.p_tipo_cobro === "cortesia" ? 0 :
                precioCatalogo(producto, payload.p_cantidad, payload.p_personas,
                    payload.p_precio_manual);
            estadoVisible("Guardando servicio en Proyecto H…");
            rpcIniciado = true;
            const { data, error } = await window.haikuSupabase.rpc(RPC, payload);
            if (error) throw error;
            estado.consumida = true;
            await comprobarResultado(data, payload, totalEsperado);
            const servicios = await window.haikuSincronizarServiciosDesdeSupabase?.();
            if (!Array.isArray(servicios)) {
                throw new Error("El servicio se registró, pero no se pudo refrescar el Resumen. No vuelvas a confirmar.");
            }
            if (typeof window.cargarCabanasDia === "function") {
                window.cargarCabanasDia(identidad.fecha, {
                    evento: "servicio RPC confirmado", tipo: "externo"
                });
            }
            if (typeof window.actualizarResumenDia === "function") {
                window.actualizarResumenDia(identidad.fecha);
            }
            document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {
                detail: { fecha: identidad.fecha }
            }));
            estadoVisible(data.estado === "ya_existente" ?
                "El servicio ya existía; no se creó un duplicado." : "Servicio guardado en Proyecto H.");
            elemento("resumen-servicio-modal").hidden = true;
            estado.identidad = null;
            return true;
        } catch (error) {
            if (rpcIniciado) estado.consumida = true;
            estadoVisible((error?.message || "No fue posible guardar el servicio.") +
                (rpcIniciado ? " Comprueba Servicios antes de volver a intentarlo." : ""), true);
            return false;
        } finally {
            estado.ocupada = false;
            guardar.textContent = textoBoton;
            guardar.disabled = estado.consumida || !estado.identidad;
        }
    }

    document.addEventListener("click", evento => {
        if (!sesionReal()) return;
        const boton = evento.target.closest?.("[data-agregar-servicio]");
        if (boton) {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            if (!boton.hidden) abrir(String(boton.dataset.agregarServicio || ""));
            return;
        }
        if (evento.target.closest?.("#resumen-servicio-guardar")) {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            confirmar();
            return;
        }
        if (evento.target.closest?.("#resumen-servicio-cerrar, #resumen-servicio-cancelar")) {
            if (estado.ocupada) {
                evento.preventDefault();
                evento.stopImmediatePropagation();
            } else {
                estado.version++;
                estado.identidad = null;
            }
        }
    }, true);

    for (const tipo of ["change", "input"]) {
        document.addEventListener(tipo, evento => {
            if (!sesionReal() || !evento.target.closest?.("#resumen-servicio-modal")) return;
            if (!evento.target.matches?.("select, input, textarea")) return;
            // El cálculo legacy usa el catálogo en memoria; en sesión real sólo pinta el catálogo DB.
            evento.stopImmediatePropagation();
            pintarSeleccion();
        }, true);
    }

    window.HAIKU_RESUMEN_SERVICIO_SITES_V1 = Object.freeze({
        identidadOperacion, validarFormulario, precioCatalogo, abrir, confirmar,
        abrirDesdeServicios: (numeroCabana, fecha) => abrir(numeroCabana, { origen: "servicios", fecha })
    });
})();
