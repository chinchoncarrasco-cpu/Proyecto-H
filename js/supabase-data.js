// ========================================
// HAIKU · PUENTE DE DATOS SUPABASE
// Primera etapa: Resumen diario + Crear reserva
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;

    if (!cliente) {
        console.error("HAIKU · Supabase Data: cliente no disponible.");
        return;
    }

    let iniciado = false;
    let permitiendoCreacionLegacy = false;
    let cargandoDia = false;
    let ultimoDiaCargado = "";
    let identidadDia = { fecha: "", filas: new Map() };

    const CLAVES_LEGACY_DATOS = [
        "haikuDatos",
        "haikuFichaReservas",
        "haikuServicios",
        "haikuWebpay",
        "haikuHistorialActividades",
        "haikuReservasCanceladas",
        "haikuReservasNoShow"
    ];

    function normalizarFecha(fecha) {
        if (!fecha) return "";
        return String(fecha).slice(0, 10);
    }

    function fechaVisibleResumen() {
        try { return normalizarFecha(fechaSeleccionada); } catch (_) { return ""; }
    }

    function diferenciaDias(inicio, fin) {
        const a = new Date(`${inicio}T12:00:00`);
        const b = new Date(`${fin}T12:00:00`);
        return Math.max(0, Math.round((b - a) / 86400000));
    }

    function horaChileDesdeTimestamp(valor) {
        if (!valor) return "";

        try {
            return new Intl.DateTimeFormat("es-CL", {
                timeZone: "America/Santiago",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }).format(new Date(valor));
        } catch {
            return "";
        }
    }

    function obtenerEstadiaPrincipal(fila, estadiasPorId) {
        const estado = fila.estado_operativo;
        let id = null;

        if (estado === "sale-ingresa" || estado === "libre-ingresa") {
            id = fila.ingreso_estadia_id;
        } else if (estado === "continua") {
            id = fila.continua_estadia_id;
        } else if (estado === "fullday") {
            id = fila.fullday_estadia_id;
        }

        return id ? estadiasPorId.get(id) || null : null;
    }

    function obtenerTitularPrincipal(fila) {
        switch (fila.estado_operativo) {
            case "sale-ingresa":
            case "libre-ingresa":
                return fila.ingreso_titular || "Sin titular";
            case "sale-libre":
                return "Sin titular";
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

    async function cargarDetallesEstadias(filas) {
        const ids = [
            ...new Set(
                filas.flatMap(fila => [
                    fila.ingreso_estadia_id,
                    fila.salida_estadia_id,
                    fila.continua_estadia_id,
                    fila.fullday_estadia_id
                ]).filter(Boolean)
            )
        ];

        if (ids.length === 0) {
            return new Map();
        }

        const { data, error } = await cliente
            .from("reserva_estadias")
            .select(
                "id,reserva_id,fecha_ingreso,fecha_salida,adultos,ninos,mascotas,tipo_estadia,estado_estadia,hora_ingreso_prevista,checkin_realizado_en,checkout_realizado_en"
            )
            .in("id", ids);

        if (error) throw error;

        return new Map((data || []).map(item => [item.id, item]));
    }

    function pintarEstadoOperacion(fila, fecha) {
        const numero = String(fila.numero);
        const tr = document.querySelector(
            `#seccion-resumen .sites-resumen-cabana[data-cabana="${numero}"]`
        );

        if (!tr) return null;

        const titular = obtenerTitularPrincipal(fila);

        const titularElemento = tr.querySelector(
            `[data-titular-cabana="${numero}"]`
        );
        if (titularElemento) {
            titularElemento.textContent = titular;
        }

        const estado = tr.querySelector('[data-campo="estado"]');
        if (estado) {
            estado.value = fila.estado_operativo || "libre-libre";
        }

        tr.dataset.haikuFuente = "supabase";
        tr.dataset.haikuCabanaId = fila.cabana_id || "";
        tr.dataset.resumenFecha = fecha;
        tr.dataset.resumenSalidaTitular = fila.salida_titular || "";
        tr.dataset.ingresoReservaId = fila.ingreso_reserva_id || "";
        tr.dataset.salidaReservaId = fila.salida_reserva_id || "";
        const identidad = identidadReservaOperacion(fila);
        tr.dataset.resumenReservaId = fila.estado_operativo === "bloqueada" ? "" : identidad.id;
        tr.dataset.resumenTitularReservaId = identidad.id;
        tr.dataset.resumenTitular = identidad.id ? identidad.titular : "";

        return tr;
    }

    function identidadReservaOperacion(fila) {
        switch (fila.estado_operativo) {
            case "libre-ingresa":
            case "sale-ingresa":
                return { id: fila.ingreso_reserva_id || "", titular: fila.ingreso_titular || "" };
            case "continua":
                return { id: fila.continua_reserva_id || "", titular: fila.continua_titular || "" };
            case "fullday":
                return { id: fila.fullday_reserva_id || "", titular: fila.fullday_titular || "" };
            case "sale-libre":
                return { id: fila.salida_reserva_id || "", titular: fila.salida_titular || "" };
            case "bloqueada":
                if (fila.bloqueo_id && fila.salida_estadia_id) {
                    return { id: fila.salida_reserva_id || "", titular: fila.salida_titular || "" };
                }
                return { id: "", titular: "" };
            default:
                return { id: "", titular: "" };
        }
    }

    function pintarFilaOperacion(fila, estadiasPorId, fecha) {
        const tr = pintarEstadoOperacion(fila, fecha);
        if (!tr) return;

        const numero = String(fila.numero);
        const estadia = obtenerEstadiaPrincipal(fila, estadiasPorId);
        tr.dataset.resumenEstadiaId = fila.estado_operativo === "sale-libre"
            ? fila.salida_estadia_id || "" : estadia?.id || "";

        const adultos = tr.querySelector('[data-campo="adultos"]');
        const ninos = tr.querySelector('[data-campo="ninos"]');
        const mascotas = tr.querySelector('[data-campo="mascotas"]');

        if (adultos) adultos.value = estadia?.adultos ?? "";
        if (ninos) ninos.value = estadia?.ninos ?? "";
        if (mascotas) mascotas.value = estadia?.mascotas ?? "";

        const noches = tr.querySelector(
            `[data-valor-noches="${numero}"]`
        );
        if (noches) {
            noches.textContent =
                estadia?.tipo_estadia === "alojamiento"
                    ? diferenciaDias(
                        normalizarFecha(estadia.fecha_ingreso),
                        normalizarFecha(estadia.fecha_salida)
                    )
                    : estadia?.tipo_estadia === "fullday"
                        ? "FD"
                        : "";
            const contenedorNoches = noches.closest(".cabana-noches");
            if (contenedorNoches) contenedorNoches.hidden = !estadia;
        }

        const ocupacion = tr.querySelector(".ocupacion-cabana");
        if (
            ocupacion &&
            typeof actualizarTextoOcupacionResumen === "function"
        ) {
            actualizarTextoOcupacionResumen(ocupacion, estadia
                ? {
                    reservaId: estadia.reserva_id || "ocupada",
                    estado: fila.estado_operativo,
                    adultos: estadia.adultos,
                    ninos: estadia.ninos,
                    mascotas: estadia.mascotas
                }
                : { estado: fila.estado_operativo });
        }

        const ingreso = tr.querySelector('[data-campo="ingreso"]');
        if (ingreso) {
            ingreso.value =
                fila.estado_operativo === "sale-libre"
                    ? ""
                    : fila.hora_ingreso_prevista ||
                        estadia?.hora_ingreso_prevista ||
                        "";
        }

        const checkin = tr.querySelector('[data-campo="checkinRealizado"]');
        if (checkin) {
            checkin.checked = Boolean(
                fila.ingreso_checkin_en ||
                estadia?.checkin_realizado_en
            );
        }

        const checkout = tr.querySelector('[data-campo="checkout"]');
        if (checkout) {
            checkout.value = horaChileDesdeTimestamp(
                fila.salida_checkout_en ||
                estadia?.checkout_realizado_en
            );
        }

        const estadoRevision = tr.querySelector(
            '[data-campo="estadoRevision"], [data-campo="estadoFinal"]'
        );
        if (estadoRevision && fila.revision_resultado) {
            const valor = String(fila.revision_resultado)
                .toLowerCase()
                .replaceAll("_", "-");

            if (
                Array.from(estadoRevision.options)
                    .some(opcion => opcion.value === valor)
            ) {
                estadoRevision.value = valor;
            }
        }
    }

    async function cargarContadoresRelacionados(fecha, filas) {
        const serviciosContador =
            document.getElementById("contador-servicios");
        const pagosContador =
            document.getElementById("contador-pagos");

        const { data: servicios, error: errorServicios } = await cliente
            .from("vista_servicios_pendientes")
            .select("id,estado_servicio")
            .eq("fecha_servicio", fecha);

        if (fechaVisibleResumen() && fechaVisibleResumen() !== fecha) return;

        if (!errorServicios && serviciosContador) {
            serviciosContador.textContent = String(
                (servicios || []).length
            );
        }

        const puentePagos =
            window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1;

        if (puentePagos) {
            await puentePagos.refrescar(fecha);
            return;
        }

        const reservasIngreso = [
            ...new Set(
                filas.flatMap(fila => [
                    fila.ingreso_reserva_id,
                    fila.fullday_reserva_id
                ]).filter(Boolean)
            )
        ];

        if (reservasIngreso.length === 0) {
            if (pagosContador) pagosContador.textContent = "0";
            return;
        }

        const { data: saldos, error: errorSaldos } = await cliente
            .from("vista_saldos_reserva")
            .select("reserva_id,saldo")
            .in("reserva_id", reservasIngreso);

        if (fechaVisibleResumen() && fechaVisibleResumen() !== fecha) return;

        if (!errorSaldos && pagosContador) {
            const pendientes = (saldos || [])
                .filter(item => Number(item.saldo || 0) > 0)
                .length;
            pagosContador.textContent = String(pendientes);
        }
    }

    async function cargarOperacionDia(fecha) {
        const fechaISO = normalizarFecha(fecha);
        if (!fechaISO || cargandoDia || !window.haikuSesion) return;

        cargandoDia = true;

        try {
            const { data, error } = await cliente.rpc(
                "haiku_operacion_dia",
                { p_fecha: fechaISO }
            );

            if (error) throw error;

            if (fechaVisibleResumen() && fechaVisibleResumen() !== fechaISO) return;

            const filas = Array.isArray(data) ? data : [];
            identidadDia = {
                fecha: fechaISO,
                filas: new Map(filas.map(fila => [String(fila.numero), fila]))
            };

            document
                .querySelectorAll("#seccion-resumen .sites-resumen-cabana[data-cabana]")
                .forEach(article => {
                    article.dataset.resumenFecha = "";
                    article.dataset.resumenSalidaTitular = "";
                    article.dataset.resumenReservaId = "";
                    article.dataset.resumenTitularReservaId = "";
                    article.dataset.resumenTitular = "";
                    article.dataset.salidaReservaId = "";
                    article.dataset.ingresoReservaId = "";
                    article.dataset.resumenEstadiaId = "";
                });

            // El RPC ya contiene el estado operativo y el titular. Pintarlos
            // ahora evita mantener colores antiguos mientras se consultan los
            // detalles de noches y ocupación en una segunda llamada.
            filas.forEach(fila => pintarEstadoOperacion(fila, fechaISO));

            const estadiasPorId = await cargarDetallesEstadias(filas);

            if (fechaVisibleResumen() && fechaVisibleResumen() !== fechaISO) return;

            filas.forEach(fila =>
                pintarFilaOperacion(fila, estadiasPorId, fechaISO)
            );

            const ingresan = filas.filter(fila =>
                ["libre-ingresa", "sale-ingresa", "fullday"]
                    .includes(fila.estado_operativo)
            ).length;

            const salen = filas.filter(fila =>
                ["sale-libre", "sale-ingresa", "fullday"]
                    .includes(fila.estado_operativo)
            ).length;

            const continuan = filas.filter(fila =>
                fila.estado_operativo === "continua"
            ).length;

            const contadorIngresan =
                document.getElementById("contador-ingresan");
            const contadorSalen =
                document.getElementById("contador-salen");
            const contadorContinuan =
                document.getElementById("contador-continuan");

            if (contadorIngresan) contadorIngresan.textContent = String(ingresan);
            if (contadorSalen) contadorSalen.textContent = String(salen);
            if (contadorContinuan) contadorContinuan.textContent = String(continuan);

            await cargarContadoresRelacionados(fechaISO, filas);

            if (fechaVisibleResumen() && fechaVisibleResumen() !== fechaISO) return;

            ultimoDiaCargado = fechaISO;
            document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {
                detail: { fecha: fechaISO }
            }));

            console.info(
                "HAIKU · Operación diaria desde Supabase:",
                fechaISO,
                filas.length,
                "cabañas"
            );
        } catch (error) {
            console.error(
                "HAIKU · No fue posible cargar operación diaria:",
                error
            );
        } finally {
            cargandoDia = false;
            // Si el usuario cambió de día durante una lectura, la llamada
            // intermedia pudo descartarse por cargandoDia. Leer el día vigente.
            const vigente = fechaVisibleResumen();
            if (vigente && vigente !== fechaISO && window.haikuSesion) {
                cargarOperacionDia(vigente);
            }
        }
    }

    // Proyección de identidad del RPC ya consultado para Resumen. Cabañas
    // consume los mismos datos por fecha/ID, sin leer texto renderizado.
    window.HAIKU_OPERACION_DIA_IDENTIDAD_V1 = Object.freeze({
        obtener(fecha, numero) {
            if (normalizarFecha(fecha) !== identidadDia.fecha) return null;
            const fila = identidadDia.filas.get(String(numero));
            if (!fila) return null;
            const identidad = identidadReservaOperacion(fila);
            return {
                estado: String(fila.estado_operativo || ""),
                reservaId: String(identidad.id || ""),
                titular: String(identidad.titular || "").trim()
            };
        }
    });

    function limpiarCacheLegacyUnaVez() {
        if (localStorage.getItem("haikuSupabaseLocalResetV1") === "1") {
            return;
        }

        CLAVES_LEGACY_DATOS.forEach(clave =>
            localStorage.removeItem(clave)
        );

        localStorage.setItem("haikuSupabaseLocalResetV1", "1");

        try {
            if (typeof datosPorFecha !== "undefined") {
                datosPorFecha = {};
            }
        } catch {}

        try {
            if (typeof serviciosRegistrados !== "undefined") {
                serviciosRegistrados = [];
            }
        } catch {}

        console.info(
            "HAIKU · Cache legacy limpiado para iniciar Supabase desde cero."
        );
    }

    function obtenerDatosNuevaReserva() {
        const titular =
            document.getElementById("reserva-nuevo-titular")?.value.trim() || "";
        const telefono =
            document.getElementById("reserva-nuevo-telefono")?.value.trim() || "";
        const rut =
            document.getElementById("reserva-nuevo-rut")?.value.trim() || "";
        const correo =
            document.getElementById("reserva-nuevo-correo")?.value.trim() || "";
        const observaciones =
            document.getElementById("reserva-nueva-observacion")?.value.trim() || "";
        const acompanantes = Array.from(
            document.querySelectorAll(".reserva-nuevo-acompanante")
        ).map(campo => campo.value.trim()).filter(Boolean);

        let llegada = "";
        let salida = "";
        let cabana = "";
        let tarifas = {};
        let adultos = 1;
        let ninos = 0;
        let mascotas = 0;

        try { llegada = fechaLlegadaReserva || ""; } catch {}
        try { salida = fechaSalidaReserva || ""; } catch {}
        try { cabana = cabanaSeleccionadaReserva || ""; } catch {}
        try { tarifas = { ...(tarifasNochesReserva || {}) }; } catch {}
        try { adultos = Number(adultosReserva ?? 1); } catch {}
        try { ninos = Number(ninosReserva ?? 0); } catch {}
        try { mascotas = Number(mascotasReserva ?? 0); } catch {}

        return {
            titular,
            telefono,
            rut,
            correo,
            observaciones,
            acompanantes,
            llegada,
            salida,
            cabana: Number(cabana),
            tarifas,
            adultos,
            ninos,
            mascotas
        };
    }

    async function validarDisponibilidadReserva(datos) {
        const { data, error } = await cliente.rpc(
            "haiku_cabanas_disponibles",
            {
                p_fecha_ingreso: datos.llegada,
                p_fecha_salida: datos.salida,
                p_tipo_estadia: "alojamiento"
            }
        );

        if (error) throw error;

        return (data || []).some(
            cabana => Number(cabana.numero) === Number(datos.cabana)
        );
    }

    async function crearReservaSupabase(datos) {
        if (!window.haikuTienePermiso?.("reservas.crear")) {
            throw new Error("Tu usuario no tiene permiso para crear reservas.");
        }

        if (!datos.titular || !datos.llegada || !datos.salida || !datos.cabana) {
            throw new Error("Faltan datos obligatorios de la reserva.");
        }

        const disponible = await validarDisponibilidadReserva(datos);
        if (!disponible) {
            throw new Error(
                `CAB ${datos.cabana} ya no está disponible para ese rango.`
            );
        }

        const { data, error } = await cliente.rpc(
            "haiku_crear_reserva",
            {
                p_titular_nombre: datos.titular,
                p_cabana_numero: datos.cabana,
                p_fecha_ingreso: datos.llegada,
                p_fecha_salida: datos.salida,
                p_adultos: Math.max(0, datos.adultos),
                p_ninos: Math.max(0, datos.ninos),
                p_mascotas: Math.max(0, datos.mascotas),
                p_correo_contacto: datos.correo || null,
                p_telefono_contacto: datos.telefono || null,
                p_rut: datos.rut || null,
                p_observaciones: datos.observaciones || null,
                p_tarifas: datos.tarifas,
                p_acompanantes: datos.acompanantes,
                p_tipo_estadia: "alojamiento",
                p_cloudbeds_id: null
            }
        );

        if (error) throw error;
        return data;
    }

    document.addEventListener(
        "click",
        async evento => {
            const boton = evento.target.closest("#crear-nueva-reserva");
            if (!boton || permitiendoCreacionLegacy) return;

            evento.preventDefault();
            evento.stopPropagation();
            evento.stopImmediatePropagation();

            const datos = obtenerDatosNuevaReserva();
            const textoOriginal = boton.textContent;
            boton.disabled = true;
            boton.textContent = "Guardando en Supabase…";

            try {
                const creada = await crearReservaSupabase(datos);

                console.info(
                    "HAIKU · Reserva creada en Supabase:",
                    creada
                );

                // La interfaz legacy sólo recibe una copia local DESPUÉS
                // de que PostgreSQL confirma la reserva. Así conserva por
                // ahora su modal de confirmación y navegación existente.
                const generadorOriginal = window.generarReservaId;

                if (typeof generadorOriginal === "function") {
                    window.generarReservaId = () => creada.reserva_id;
                }

                permitiendoCreacionLegacy = true;
                try {
                    boton.disabled = false;
                    boton.textContent = textoOriginal;
                    boton.click();
                } finally {
                    permitiendoCreacionLegacy = false;
                    if (typeof generadorOriginal === "function") {
                        window.generarReservaId = generadorOriginal;
                    }
                }

                setTimeout(() => {
                    cargarOperacionDia(datos.llegada);
                }, 50);
            } catch (error) {
                console.error(
                    "HAIKU · No fue posible crear reserva en Supabase:",
                    error
                );

                alert(
                    error?.message ||
                    "No fue posible crear la reserva."
                );
            } finally {
                boton.disabled = false;
                boton.textContent = textoOriginal;
            }
        },
        true
    );

    function detectarCambioFecha() {
        let fecha = "";
        try { fecha = normalizarFecha(fechaSeleccionada); } catch {}

        if (
            fecha &&
            fecha !== ultimoDiaCargado &&
            window.haikuSesion
        ) {
            cargarOperacionDia(fecha);
        }
    }

    async function iniciar() {
        if (iniciado || !window.haikuSesion) return;
        iniciado = true;

        // Esperar a que todos los scripts legacy terminen de declarar
        // sus variables globales y construir el DOM.
        await new Promise(resolve => setTimeout(resolve, 0));

        limpiarCacheLegacyUnaVez();

        let fecha = "";
        try { fecha = normalizarFecha(fechaSeleccionada); } catch {}

        if (!fecha) {
            fecha = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Santiago",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).format(new Date());
        }

        await cargarOperacionDia(fecha);

        document.addEventListener("click", () => {
            setTimeout(detectarCambioFecha, 0);
        });

        document.addEventListener("change", () => {
            setTimeout(detectarCambioFecha, 0);
        });

        console.info(
            "HAIKU · Puente Supabase activo: Resumen + Crear reserva."
        );
    }

    window.addEventListener("haiku:auth-ready", iniciar);

    window.addEventListener("load", () => {
        setTimeout(() => {
            if (window.haikuSesion) iniciar();
        }, 0);
    });
})();
