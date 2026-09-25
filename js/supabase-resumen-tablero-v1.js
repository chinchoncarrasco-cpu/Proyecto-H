// Resumen Sites: presentación de los controles y datos reales de Proyecto H.
// Las acciones y la persistencia siguen en sus módulos funcionales originales.
(() => {
    "use strict";
    if (window.HAIKU_RESUMEN_SITES_V1) return;

    const estados = Object.freeze({
        "libre-libre": ["Libre", "libre"],
        "libre-ingresa": ["Ingresa hoy", "ingresa"],
        "sale-libre": ["Sale hoy", "sale"],
        "sale-ingresa": ["Sale + ingresa", "recambio"],
        "sale-bloqueada": ["Sale · bloqueada", "bloqueada"],
        continua: ["Continúa", "continua"],
        bloqueada: ["Bloqueada", "bloqueada"],
        fullday: ["Full day", "fullday"]
    });
    const selectorFila = "#seccion-resumen .sites-resumen-cabana[data-cabana]";
    const filtros = new Set(["continuan", "ingresan", "salen", "servicios", "pagos"]);
    const historial = new Map();
    const operacionFiltrada = new Map();
    const historialPendiente = new Map();
    const historialVersion = new Map();
    let actualizacionPendiente = false;
    let filtroSeleccionado = "";
    let serviciosHidratados = false;
    const pagosHidratados = new Set();
    let cobrosConocidos = { clave: "", cargos: new Map() };
    let cobrosEnLectura = "";
    let versionCobros = 0;
    let usuarioHistorial = "";

    function fechaActiva() {
        try {
            const coordinador = window.HAIKU_RESUMEN_REFRESH_V1;
            if (coordinador?.activo() && !coordinador.publicando() &&
                coordinador.ultimo()?.fecha) return coordinador.ultimo().fecha;
            const fecha = String(fechaSeleccionada || "").slice(0, 10);
            return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : "";
        } catch (_) {
            return "";
        }
    }

    function sumarDias(fecha, diferencia) {
        if (typeof sumarDiasFecha === "function") {
            return sumarDiasFecha(fecha, diferencia);
        }
        const valor = new Date(`${fecha}T12:00:00`);
        valor.setDate(valor.getDate() + diferencia);
        return [valor.getFullYear(), String(valor.getMonth() + 1).padStart(2, "0"),
            String(valor.getDate()).padStart(2, "0")].join("-");
    }

    function datosLocales(fecha, numero) {
        try {
            return datosPorFecha?.[fecha]?.cabanas?.[numero] || null;
        } catch (_) {
            return null;
        }
    }

    function texto(elemento, valor) {
        if (elemento && elemento.textContent !== valor) elemento.textContent = valor;
    }

    function listaLectura(elemento, valores, mensajeVacio) {
        if (!elemento) return;
        const textos = valores.length ? valores : [mensajeVacio];
        const actuales = [...elemento.children].map(item => item.textContent);
        if (actuales.length === textos.length &&
            actuales.every((valor, indice) => valor === textos[indice])) return;
        elemento.replaceChildren(...textos.map(valor => {
            const item = document.createElement("li");
            item.textContent = valor;
            return item;
        }));
    }

    function servicioParaLectura(valor) {
        const coincidencia = String(valor).match(/^(\d{1,2}:\d{2})\s+(.+)$/);
        return coincidencia ? `${coincidencia[2]} · ${coincidencia[1]}` : valor;
    }

    function fechaCorta(fecha) {
        const partes = String(fecha || "").slice(0, 10).split("-").map(Number);
        if (partes.length !== 3 || partes.some(valor => !valor)) return "";
        return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" })
            .format(new Date(partes[0], partes[1] - 1, partes[2])).replace(/\./g, "");
    }

    function campo(fila, nombre) {
        return fila.querySelector(`[data-campo="${nombre}"]`);
    }

    function obtenerNotas(fila) {
        const caja = fila.querySelector(".nota-cabana");
        if (!caja) return [];
        const entradas = [...caja.querySelectorAll(".nota-operativa-item")];
        const nodos = entradas.length ? entradas : [caja];
        return nodos.map(nodo => {
            const copia = nodo.cloneNode(true);
            copia.querySelectorAll("button, input, select, textarea").forEach(control => control.remove());
            return String(copia.textContent || "").replace(/\s+/g, " ").trim();
        }).filter(Boolean);
    }

    function reservaExacta(fila, datos) {
        const estado = campo(fila, "estado")?.value || datos?.estado || "";
        const idDeEstaFecha = fila.dataset.resumenFecha === fechaActiva();
        const usarLocal = !window.haikuSesion;
        const ingreso = String((idDeEstaFecha && fila.dataset.ingresoReservaId) ||
            (usarLocal && (datos?.ingresoReservaId || datos?.ingreso_reserva_id)) || "").trim();
        const salida = String((idDeEstaFecha && fila.dataset.salidaReservaId) ||
            (usarLocal && (datos?.salidaReservaId || datos?.salida_reserva_id)) || "").trim();
        const vigente = String((idDeEstaFecha && fila.dataset.resumenReservaId) ||
            (usarLocal && (datos?.reservaId || datos?.reserva_id)) || "").trim();
        if (estado === "sale-ingresa") return { id: ingreso, etapa: "checkin" };
        if (estado === "sale-libre") return { id: salida, etapa: "checkout" };
        if (estado === "sale-bloqueada") return { id: salida, etapa: "" };
        if (estado === "bloqueada") return { id: "", etapa: "" };
        if (estado === "libre-ingresa") return { id: ingreso || vigente, etapa: "checkin" };
        if (estado === "fullday") return { id: vigente, etapa: "checkin" };
        if (estado === "continua") return { id: vigente, etapa: "abono" };
        return { id: vigente || ingreso || salida, etapa: "" };
    }

    function titularVisible(fila, fecha, estado, datos) {
        if (window.haikuSesion && fila.dataset.resumenFecha !== fecha) return "";
        if (estado === "bloqueada") return "";
        if (window.haikuSesion) {
            const reserva = reservaExacta(fila, datos);
            return titularReservaExacta(fila, fecha, estado, reserva.id, null);
        }
        if (["sale-libre", "sale-bloqueada"].includes(estado)) {
            const salida = fila.dataset.resumenFecha === fecha
                ? String(fila.dataset.resumenSalidaTitular || "").trim() : "";
            if (salida) return salida;
        }
        const titular = String(fila.querySelector(".titular-cabana")?.textContent || "").trim();
        return titular && !/^sin (?:titular|reserva)$/i.test(titular)
            ? titular : String(datos?.titular || "").trim();
    }

    function idReservaOperacion(fila, estado) {
        if (!fila) return "";
        if (["libre-ingresa", "sale-ingresa"].includes(estado)) return String(fila.ingreso_reserva_id || "");
        if (["sale-libre", "sale-bloqueada"].includes(estado)) return String(fila.salida_reserva_id || "");
        if (estado === "continua") return String(fila.continua_reserva_id || "");
        if (estado === "fullday") return String(fila.fullday_reserva_id || "");
        return "";
    }

    function titularReservaExacta(fila, fecha, estado, reservaId, datosSeguros) {
        if (!reservaId) return "";
        const operacion = historial.get(fecha)?.get(String(fila.dataset.cabana || ""));
        if (operacion && idReservaOperacion(operacion, estado) !== reservaId) return "";
        if (window.haikuSesion && fila.dataset.resumenFecha === fecha &&
            String(fila.dataset.resumenTitularReservaId || "") === reservaId) {
            const titular = String(fila.dataset.resumenTitular || "").trim();
            if (titular && !/^(?:sin titular|sin reserva|bloqueada)$/i.test(titular)) return titular;
        }
        const titularRemoto = operacion ? String(titularOperacion(operacion) || "").trim() : "";
        const titularLocal = !window.haikuSesion ? String(datosSeguros?.titular || "").trim() : "";
        const titular = titularRemoto || titularLocal;
        return /^(?:sin titular|sin reserva|bloqueada)$/i.test(titular) ? "" : titular;
    }

    function habilitarAcciones(fila, datos) {
        const reserva = reservaExacta(fila, datos);
        const permiso = nombre => window.haikuTienePermiso?.(nombre) === true;
        const ficha = fila.querySelector("[data-ficha-cabana]");
        const servicio = fila.querySelector("[data-agregar-servicio]");
        const nota = fila.querySelector("[data-agregar-nota-cabana]");
        const pago = fila.querySelector("[data-resumen-pago]");

        const estado = campo(fila, "estado")?.value || "";
        const reservaActiva = reserva.id && !["sale-libre", "sale-bloqueada"].includes(estado);
        const salidaExacta = estado === "sale-libre" && reserva.id &&
            fila.dataset.resumenFecha === fechaActiva() &&
            String(fila.dataset.resumenReservaId || "") === reserva.id &&
            Boolean(fila.dataset.resumenEstadiaId);
        if (ficha) ficha.hidden = !(reserva.id &&
            (reservaActiva || estado === "sale-libre") && permiso("reservas.ver"));
        if (servicio) servicio.hidden = !((reservaActiva || salidaExacta) && permiso("servicios.crear"));
        if (nota) nota.hidden = !permiso("notas.gestionar");
        if (pago) {
            const visible = Boolean(reserva.id && reserva.etapa && permiso("pagos.registrar"));
            pago.hidden = !visible;
            if (visible) {
                pago.dataset.resumenPagoReservaId = reserva.id;
                pago.dataset.resumenPagoEtapa = reserva.etapa;
            } else {
                delete pago.dataset.resumenPagoReservaId;
                delete pago.dataset.resumenPagoEtapa;
            }
        }
    }

    function resumenFila(fila, fecha) {
        const numero = String(fila.dataset.cabana || "");
        const datos = datosLocales(fecha, numero);
        const estado = String(campo(fila, "estado")?.value || datos?.estado || "").trim();
        const [nombreEstado, tipoEstado] = estados[estado] || ["Sin datos", "sin-datos"];
        const reserva = reservaExacta(fila, datos);
        const operacionActual = historial.get(fecha)?.get(numero);
        const idOperacion = operacionActual ? idReservaOperacion(operacionActual, estado) : "";
        const coincideOperacion = !operacionActual || idOperacion === reserva.id;
        const idLocal = String(datos?.reservaId || datos?.reserva_id || "").trim();
        const datosSeguros = !window.haikuSesion ||
            (reserva.id && idLocal && reserva.id === idLocal) ? datos : null;
        const datosReserva = coincideOperacion ? datosSeguros : null;
        const titular = titularReservaExacta(fila, fecha, estado, reserva.id, datosReserva);
        const sinReserva = !reserva.id;
        const huesped = fila.querySelector(".sites-resumen-celda--huesped");
        const adultos = Number(datosReserva ? campo(fila, "adultos")?.value || datosReserva.adultos || 0 : 0);
        const ninos = Number(datosReserva ? campo(fila, "ninos")?.value || datosReserva.ninos || 0 : 0);
        const mascotas = Number(datosReserva ? campo(fila, "mascotas")?.value || datosReserva.mascotas || 0 : 0);
        const ocupacion = [adultos ? `${adultos} adulto${adultos === 1 ? "" : "s"}` : "",
            ninos ? `${ninos} niño${ninos === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
        const codigo = String(datosReserva?.codigoHaiku || "").trim();
        texto(huesped?.querySelector(".sites-resumen-valor"),
            sinReserva || estado === "bloqueada" ? "Sin reserva" :
                (titular || codigo || "Sin titular"));
        texto(huesped?.querySelector(".sites-resumen-subvalor"), estado === "bloqueada"
            ? "Cabaña bloqueada" : sinReserva ? "Disponible hoy" :
            ([titular ? codigo : "", ocupacion].filter(Boolean).join(" · ") || "Reserva del día"));

        const badge = fila.querySelector(".sites-resumen-estado-badge");
        texto(badge, nombreEstado);
        if (badge && badge.dataset.estadoVisual !== tipoEstado) badge.dataset.estadoVisual = tipoEstado;

        const aseo = fila.querySelector(".sites-resumen-celda--aseo");
        const responsable = String(campo(fila, "aseo")?.value || "").trim();
        const horaAseo = String(campo(fila, "aseoIn")?.value || "").trim();
        const horaSalida = String(campo(fila, "checkout")?.value || "").trim();
        const horaIngreso = String(campo(fila, "ingreso")?.value || "").trim();
        const fechaIngreso = String(datosReserva?.fechaIngresoReserva || datosReserva?.fechaOrigenReserva ||
            (["libre-ingresa", "sale-ingresa", "fullday"].includes(estado) ? fecha : "")).trim();
        const reservaHorario = fila.querySelector(".sites-resumen-reserva-horario");
        texto(reservaHorario, sinReserva || estado === "bloqueada" ? "Sin reserva para este día" :
            estado.startsWith("sale") && estado !== "sale-ingresa"
                ? `Salida ${fechaCorta(fecha)}${horaSalida ? ` · ${horaSalida}` : ""}`
                : `Ingreso${fechaIngreso ? ` ${fechaCorta(fechaIngreso)}` : ""}${horaIngreso ? ` · ${horaIngreso}` : ""}`);
        const personas = [adultos ? `${adultos} adulto${adultos === 1 ? "" : "s"}` : "",
            ninos ? `${ninos} niño${ninos === 1 ? "" : "s"}` : "",
            mascotas ? `${mascotas} mascota${mascotas === 1 ? "" : "s"}` : ""]
            .filter(Boolean).join(" · ");
        texto(fila.querySelector(".sites-resumen-reserva-personas"),
            reserva.id && personas ? `Huéspedes: ${personas}` : "");
        const noches = Number(fila.querySelector(".valor-noches")?.textContent ||
            datosReserva?.noches || 0);
        texto(fila.querySelector(".sites-resumen-reserva-extra"),
            reserva.id && noches > 0 ? `${noches} noche${noches === 1 ? "" : "s"}` : "");
        texto(aseo?.querySelector(".sites-resumen-valor"), [responsable, horaAseo].filter(Boolean).join(" · ") || "—");
        texto(fila.querySelector(".sites-resumen-aseo-resumen"),
            [responsable, horaAseo].filter(Boolean).join(" · ") || "Sin datos de aseo");
        texto(aseo?.querySelector(".sites-resumen-subvalor"),
            estado.startsWith("sale") && horaSalida ? `Salida · ${horaSalida}` :
                ["libre-ingresa", "sale-ingresa"].includes(estado) && horaIngreso ?
                    `Ingreso · ${horaIngreso}` : "—");

        const servicios = fila.querySelector(".sites-resumen-celda--servicios");
        const listaServicios = String(campo(fila, "servicio")?.value || "").trim()
            .split(/\s+·\s+/).filter(Boolean);
        const chip = servicios?.querySelector(".sites-resumen-servicio-chip");
        texto(chip,
            listaServicios[0] || "Sin servicios");
        if (chip) chip.dataset.vacio = String(listaServicios.length === 0);
        const notas = obtenerNotas(fila);
        listaLectura(fila.querySelector(".sites-resumen-detalle-servicios"),
            listaServicios.map(servicioParaLectura), "Sin servicios");
        listaLectura(fila.querySelector(".sites-resumen-detalle-notas"), notas, "Sin notas");
        texto(servicios?.querySelector(".sites-resumen-subvalor"),
            [notas[0] || "", listaServicios.length > 1 ? `+${listaServicios.length - 1}` : ""]
                .filter(Boolean).join(" · ") || "—");

        const final = fila.querySelector(".sites-resumen-celda--final");
        const selectFinal = campo(fila, "estadoFinal") || campo(fila, "estadoRevision");
        const cabana = datosLocales(fecha, String(fila.dataset.cabana || ""));
        const valorFinal = window.HAIKU_CABANAS_SITES_V1?.estadoFinal?.(cabana, fecha);
        const etiquetasFinales = { pendiente: "Pendiente", en_curso: "En curso",
            lista_para_revisar: "Lista para revisar", "con-detalles": "Con detalles",
            lista: "Lista", no_requiere: "No requiere" };
        const etiquetaFinal = etiquetasFinales[valorFinal]
            || selectFinal?.selectedOptions?.[0]?.textContent?.trim() || "Pendiente";
        if (selectFinal) {
            selectFinal.disabled = true;
            selectFinal.hidden = true;
            selectFinal.setAttribute("aria-label", `Estado final de cabaña ${fila.dataset.cabana}: ${etiquetaFinal}`);
            let lectura = selectFinal.parentElement?.querySelector(".sites-resumen-final-lectura");
            if (!lectura && selectFinal.parentElement) {
                lectura = document.createElement("output");
                lectura.className = "sites-resumen-final-lectura";
                selectFinal.insertAdjacentElement("afterend", lectura);
            }
            texto(lectura, etiquetaFinal);
        }
        texto(final?.querySelector(".sites-resumen-valor"), etiquetaFinal);
        habilitarAcciones(fila, datosReserva);
    }

    function titularOperacion(fila) {
        const estado = String(fila?.estado_operativo || "");
        if (estado === "sale-ingresa" || estado === "libre-ingresa") return fila.ingreso_titular || "";
        if (estado === "sale-libre" || estado === "sale-bloqueada") return fila.salida_titular || "";
        if (estado === "continua") return fila.continua_titular || "";
        if (estado === "fullday") return fila.fullday_titular || "";
        return "";
    }

    function descripcionDia(estado, titular) {
        const accion = {
            "libre-libre": "Libre", "libre-ingresa": "Ingresa", "sale-libre": "Sale",
            "sale-ingresa": "Sale e ingresa", "sale-bloqueada": "Sale · bloqueada",
            continua: "Ocupada", bloqueada: "Bloqueada",
            fullday: "Full day"
        }[estado] || "Sin datos";
        return [accion, titular].filter(Boolean).join(" · ");
    }

    function resumenDiaLocal(fecha, numero) {
        const datos = datosLocales(fecha, numero);
        if (!datos) return "Sin datos";
        return descripcionDia(String(datos.estado || ""), String(datos.titular || "").trim());
    }

    function pintarFlujo(fila, fecha) {
        const numero = String(fila.dataset.cabana || "");
        const anterior = sumarDias(fecha, -1);
        const siguiente = sumarDias(fecha, 1);
        for (const [tipo, dia] of [["anterior", anterior], ["siguiente", siguiente]]) {
            const filaRemota = historial.get(dia)?.get(numero);
            const valor = filaRemota
                ? descripcionDia(String(filaRemota.estado_operativo || ""), titularOperacion(filaRemota))
                : (!window.haikuSesion ? resumenDiaLocal(dia, numero) : "Sin datos");
            texto(fila.querySelector(`.sites-resumen-dia--${tipo} .sites-resumen-dia-valor`), valor);
        }
        const estado = String(campo(fila, "estado")?.value || "");
        const titular = titularVisible(fila, fecha, estado,
            !window.haikuSesion ? datosLocales(fecha, numero) : null);
        texto(fila.querySelector(".sites-resumen-dia--actual .sites-resumen-dia-valor"),
            descripcionDia(estado, titular === "Sin titular" ? "" : titular));
    }

    function operacionParaFiltro(fila, fecha) {
        const numero = String(fila.dataset.cabana || "");
        if (window.haikuSesion) {
            // El historial del tablero se invalida y consulta de nuevo en cada
            // refresh/realtime. La identidad inicial sola podría quedar vieja.
            if (fila.dataset.resumenFecha !== fecha) return null;
            const operacion = (historial.get(fecha) || operacionFiltrada.get(fecha))?.get(numero);
            if (!operacion) return null;
            const estado = String(operacion.estado_operativo || "");
            return {
                estado,
                ingresaHoy: ["libre-ingresa", "sale-ingresa", "fullday"].includes(estado),
                saleHoy: Boolean(operacion.salida_estadia_id || operacion.fullday_estadia_id) ||
                    ["sale-libre", "sale-ingresa", "fullday"].includes(estado)
            };
        }
        const estado = String(datosLocales(fecha, numero)?.estado || "");
        return {
            estado,
            ingresaHoy: ["libre-ingresa", "sale-ingresa", "fullday"].includes(estado),
            saleHoy: ["sale-libre", "sale-ingresa", "fullday", "sale-bloqueada"].includes(estado)
        };
    }

    function serviciosDelDia(fecha) {
        if (window.haikuSesion && !serviciosHidratados) return null;
        let servicios = [];
        try {
            servicios = JSON.parse(localStorage.getItem("haikuServicios") || "[]");
        } catch (_) { return []; }
        return (Array.isArray(servicios) ? servicios : [])
            .filter(servicio => servicio.fechaServicio === fecha &&
                !["cancelado", "no_show"].includes(String(servicio.estadoServicio || "")));
    }

    function cabanasConServicios(servicios) {
        return new Set((servicios || [])
            .map(servicio => String(servicio.numeroCabana || ""))
            .filter(Boolean));
    }

    function pagosPendientesDelDia(fecha) {
        if (!window.haikuSesion || !pagosHidratados.has(fecha)) return null;
        const puente = window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1;
        if (!puente?.estaListo?.(fecha)) return null;
        const pendientes = puente.obtener(fecha);
        return Array.isArray(pendientes) ? pendientes : null;
    }

    function objetivosCobro(operacion) {
        const estado = String(operacion?.estado_operativo || "");
        const objetivos = [];
        if (["libre-ingresa", "sale-ingresa", "fullday"].includes(estado)) {
            const id = estado === "fullday" ? operacion.fullday_reserva_id : operacion.ingreso_reserva_id;
            if (id) objetivos.push(`${id}|alojamiento`);
        }
        if (["sale-libre", "sale-ingresa", "fullday"].includes(estado)) {
            const id = estado === "fullday" ? operacion.fullday_reserva_id : operacion.salida_reserva_id;
            if (id) objetivos.push(`${id}|servicio`);
        }
        return objetivos;
    }

    function invalidarCobrosConocidos() {
        ++versionCobros;
        cobrosConocidos = { clave: "", cargos: new Map() };
        cobrosEnLectura = "";
    }

    function identidadLecturaCobros(fecha, operaciones) {
        const ids = [...new Set([...operaciones.values()].flatMap(objetivosCobro)
            .map(objetivo => objetivo.split("|")[0]))].sort();
        return { ids, clave: `${fecha}|${ids.join(",")}` };
    }

    function cargarCobrosConocidos(fecha, operaciones, lectura) {
        if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) return;
        if (!window.haikuSesion || !operaciones || !pagosHidratados.has(fecha)) return;
        const { ids, clave } = lectura;
        if (cobrosConocidos.clave === clave || cobrosEnLectura === clave) return;
        if (!ids.length) {
            cobrosConocidos = { clave, cargos: new Map() };
            return;
        }
        const version = ++versionCobros;
        cobrosEnLectura = clave;
        window.haikuSupabase.from("vista_estado_cargos")
            .select("reserva_id,tipo_cargo,estado,saldo_cargo,monto_ajustado")
            .in("reserva_id", ids)
            .then(({ data, error }) => {
                if (error) throw error;
                if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) return;
                if (version !== versionCobros || fecha !== fechaActiva()) return;
                const cargos = new Map();
                for (const cargo of Array.isArray(data) ? data : []) {
                    if (cargo.estado !== "activo") continue;
                    if (!["alojamiento", "servicio"].includes(cargo.tipo_cargo)) continue;
                    const id = `${cargo.reserva_id}|${cargo.tipo_cargo}`;
                    const estado = cargos.get(id) || { cero: true, conMonto: false };
                    const saldo = Number(cargo.saldo_cargo);
                    estado.cero = estado.cero && cargo.saldo_cargo != null &&
                        Number.isFinite(saldo) && saldo === 0;
                    estado.conMonto = estado.conMonto || Number(cargo.monto_ajustado) > 0;
                    cargos.set(id, estado);
                }
                cobrosConocidos = { clave, cargos };
                programarActualizacion();
            })
            .catch(error => console.warn("Resumen: no fue posible leer cobros del día", error))
            .finally(() => {
                if (cobrosEnLectura === clave) cobrosEnLectura = "";
            });
    }

    function pintarCobros(fila, fecha, pendientes, operaciones, lectura) {
        const celda = fila.querySelector?.(".sites-resumen-celda--cobros");
        const valor = celda?.querySelector(".sites-resumen-valor");
        const detalle = celda?.querySelector(".sites-resumen-subvalor");
        if (!valor || !detalle) return;
        let principal = "—", secundario = "", visual = "";
        const numero = String(fila.dataset.cabana || "");
        const propios = (pendientes || []).filter(item => String(item.numeroCabana || "") === numero);
        if (pendientes && fila.dataset.resumenFecha === fecha && propios.length) {
            const montos = propios.map(item => Number(item.monto));
            principal = montos.every(monto => Number.isFinite(monto) && monto > 0)
                ? `Saldo $${Math.round(montos.reduce((total, monto) => total + monto, 0)).toLocaleString("es-CL")}`
                : "Cobro pendiente";
            secundario = propios.length > 1 ? `${propios.length} cobros pendientes` :
                propios[0].tipo === "checkin" ? "Cobro pendiente de ingreso" :
                    propios[0].tipo === "servicio" ? "Servicios pendientes de salida" : "Cobro pendiente";
            visual = "pendiente";
        } else if (pendientes && fila.dataset.resumenFecha === fecha && operaciones) {
            const objetivos = objetivosCobro(operaciones.get(numero));
            if (cobrosConocidos.clave === lectura?.clave) {
                const conocidos = objetivos.map(id => cobrosConocidos.cargos.get(id)).filter(Boolean);
                if (conocidos.length && conocidos.every(cargo => cargo.cero)) {
                    principal = conocidos.some(cargo => cargo.conMonto) ? "Pagado" : "Sin cobro pendiente";
                    secundario = "Sin saldo pendiente";
                    visual = "pagado";
                }
            }
        }
        texto(valor, principal);
        texto(detalle, secundario);
        if (visual) valor.dataset.cobroVisual = visual;
        else delete valor.dataset.cobroVisual;
    }

    function coincideFiltro(fila, fecha, tipo, fuentes = {}) {
        if (!tipo) return true;
        const numero = String(fila.dataset.cabana || "");
        if (tipo === "servicios") return fuentes.servicios?.has(numero) || false;
        if (tipo === "pagos") return fila.dataset.resumenFecha === fecha &&
            (fuentes.pagos?.has(numero) || false);
        const operacion = operacionParaFiltro(fila, fecha);
        if (!operacion) return false;
        if (tipo === "continuan") return operacion.estado === "continua";
        if (tipo === "ingresan") return operacion.ingresaHoy === true;
        if (tipo === "salen") return operacion.saleHoy === true;
        return false;
    }

    function aplicarFiltro(fecha) {
        const filas = [...document.querySelectorAll(selectorFila)];
        const servicios = serviciosDelDia(fecha);
        const pendientes = pagosPendientesDelDia(fecha);
        const operaciones = historial.get(fecha) || operacionFiltrada.get(fecha);
        const lecturaCobros = operaciones ? identidadLecturaCobros(fecha, operaciones) : null;
        cargarCobrosConocidos(fecha, operaciones, lecturaCobros);
        filas.forEach(fila => pintarCobros(fila, fecha, pendientes, operaciones, lecturaCobros));
        if (servicios) texto(document.getElementById?.("contador-servicios"), String(servicios.length));
        const operacionDisponible = !window.haikuSesion ||
            (filas.every(fila => fila.dataset.resumenFecha === fecha) &&
                (historial.has(fecha) || operacionFiltrada.has(fecha)));
        if (operacionDisponible) {
            for (const [tipo, id] of [["continuan", "contador-continuan"],
                ["ingresan", "contador-ingresan"], ["salen", "contador-salen"]]) {
                const total = filas.filter(fila => coincideFiltro(fila, fecha, tipo)).length;
                texto(document.getElementById?.(id), String(total));
            }
        }
        const fuentes = {
            servicios: filtroSeleccionado === "servicios" ? cabanasConServicios(servicios) : null,
            pagos: filtroSeleccionado === "pagos" ? new Set((pendientes || [])
                .map(pendiente => String(pendiente.numeroCabana || "")).filter(Boolean)) : null
        };
        let visibles = 0;
        filas.forEach(fila => {
            const mostrar = coincideFiltro(fila, fecha, filtroSeleccionado, fuentes);
            fila.hidden = !mostrar;
            if (mostrar) visibles++;
        });
        texto(document.getElementById?.("resumen-cabanas-conteo"),
            `${visibles} de ${filas.length} cabañas`);
        const mostrarTodas = document.getElementById?.("resumen-mostrar-todas");
        if (mostrarTodas) mostrarTodas.hidden = !filtroSeleccionado;
        document.querySelectorAll("#seccion-resumen [data-resumen-filtro]").forEach(tarjeta => {
            tarjeta.setAttribute?.("aria-pressed", String(tarjeta.dataset?.resumenFiltro === filtroSeleccionado));
        });
    }

    function seleccionarFiltro(tipo) {
        if (tipo && !filtros.has(tipo)) return;
        filtroSeleccionado = filtroSeleccionado === tipo ? "" : tipo;
        aplicarFiltro(fechaActiva());
    }

    function actualizar() {
        actualizacionPendiente = false;
        const fecha = fechaActiva();
        if (!fecha) return;
        document.querySelectorAll(selectorFila).forEach(fila => {
            resumenFila(fila, fecha);
            pintarFlujo(fila, fecha);
        });
        aplicarFiltro(fecha);
        if (!window.HAIKU_RESUMEN_REFRESH_V1?.activo()) cargarHistorial(fecha);
    }

    function programarActualizacion(origen) {
        const coordinador = window.HAIKU_RESUMEN_REFRESH_V1;
        if (coordinador?.activo()) {
            if (!coordinador.publicando()) {
                const evento = typeof origen === "string" ? origen :
                    origen?.evento || origen?.type || "programarActualizacion";
                coordinador.solicitar(origen?.fecha, {
                    categoria: "tablero", evento,
                    tipo: origen?.tipo || (evento === "programarActualizacion" ||
                        evento === "MutationObserver pagos-lista-checkout"
                        ? "interno_derivado" : "externo")
                });
            }
            return;
        }
        if (actualizacionPendiente) return;
        actualizacionPendiente = true;
        requestAnimationFrame(actualizar);
    }

    function invalidarHistorial(fecha) {
        if (!fecha) return;
        for (const dia of [sumarDias(fecha, -1), fecha, sumarDias(fecha, 1)]) {
            historial.delete(dia);
            historialVersion.set(dia, (historialVersion.get(dia) || 0) + 1);
            historialPendiente.delete(dia);
        }
    }

    function invalidarHistorialDeOtraSesion() {
        for (const dia of new Set([...historial.keys(), ...historialPendiente.keys()])) {
            historialVersion.set(dia, (historialVersion.get(dia) || 0) + 1);
        }
        historial.clear();
        historialPendiente.clear();
        operacionFiltrada.clear();
    }

    function cargarHistorial(fecha) {
        if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) return;
        if (!window.haikuSesion || !window.haikuSupabase) return;
        for (const dia of [sumarDias(fecha, -1), fecha, sumarDias(fecha, 1)]) {
            if (historial.has(dia) || historialPendiente.has(dia)) continue;
            const version = historialVersion.get(dia) || 0;
            const pendiente = window.haikuSupabase.rpc("haiku_operacion_dia", { p_fecha: dia })
                .then(({ data, error }) => {
                    if (error) throw error;
                    if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) return;
                    if ((historialVersion.get(dia) || 0) !== version) return;
                    const filas = new Map((Array.isArray(data) ? data : [])
                        .map(item => [String(item.numero), item]));
                    historial.set(dia, filas);
                    // Conservar la última proyección del mismo día evita que
                    // notas/servicios/pagos hagan parpadear el filtro al refrescar.
                    if (dia === fechaActiva()) operacionFiltrada.set(dia, filas);
                    if (fechaActiva() === fecha) programarActualizacion();
                })
                .catch(error => {
                    console.warn("Resumen: no fue posible leer el contexto del día", dia, error);
                })
                .finally(() => {
                    if (historialPendiente.get(dia) === pendiente) historialPendiente.delete(dia);
                });
            historialPendiente.set(dia, pendiente);
        }
    }

    let navegacionCargando = null;

    function finalizarNavegacionCargando(fecha, generacion) {
        const pendiente = navegacionCargando;
        if (!pendiente || pendiente.fecha !== fecha ||
            (generacion != null && pendiente.generacion != null &&
                generacion !== pendiente.generacion)) return;
        pendiente.boton.removeAttribute("aria-busy");
        if (pendiente.etiquetaOriginal == null) pendiente.boton.removeAttribute("aria-label");
        else pendiente.boton.setAttribute("aria-label", pendiente.etiquetaOriginal);
        navegacionCargando = null;
    }

    function mostrarNavegacionCargando(id, fecha) {
        if (navegacionCargando) finalizarNavegacionCargando(
            navegacionCargando.fecha, navegacionCargando.generacion);
        const boton = document.getElementById(id);
        if (!boton) return;
        const etiquetaOriginal = boton.getAttribute("aria-label");
        boton.setAttribute("aria-busy", "true");
        boton.setAttribute("aria-label",
            `${etiquetaOriginal || boton.textContent.replace(/\s+/g, " ").trim()}, cargando`);
        navegacionCargando = { boton, fecha, generacion: null, etiquetaOriginal };
    }

    window.HAIKU_RESUMEN_NAV_CARGA_V1 = Object.freeze({
        aceptar: (fecha, generacion) => {
            if (navegacionCargando?.fecha === fecha) navegacionCargando.generacion = generacion;
        },
        finalizar: finalizarNavegacionCargando
    });

    function navegar(diferencia) {
        // Mientras B se prepara, la vista muestra A, pero la navegación debe
        // continuar desde el día que el usuario acaba de seleccionar.
        let fecha = fechaActiva();
        if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
            try {
                const seleccionada = String(fechaSeleccionada || "").slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(seleccionada)) fecha = seleccionada;
            } catch (_) {}
        }
        if (!fecha || typeof seleccionarDia !== "function") return;
        const nueva = sumarDias(fecha, diferencia);
        const [anio, mes, dia] = nueva.split("-").map(Number);
        mostrarNavegacionCargando(diferencia < 0 ?
            "resumen-dia-anterior" : "resumen-dia-siguiente", nueva);
        seleccionarDia(anio, mes - 1, dia, nueva, {
            categoria: "navegación usuario",
            evento: diferencia < 0 ? "Día anterior" : "Día siguiente",
            tipo: "usuario"
        });
        if (!window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
            programarActualizacion();
            finalizarNavegacionCargando(nueva);
        }
    }

    function navegarHoy() {
        if (typeof seleccionarDia !== "function") return;
        const ahora = new Date();
        const partes = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit"
        }).formatToParts(ahora).filter(parte =>
            ["year", "month", "day"].includes(parte.type))
            .map(parte => [parte.type, parte.value]));
        const fecha = `${partes.year}-${partes.month}-${partes.day}`;
        mostrarNavegacionCargando("resumen-dia-hoy", fecha);
        seleccionarDia(Number(partes.year), Number(partes.month) - 1,
            Number(partes.day), fecha, {
                categoria: "navegación usuario", evento: "Hoy", tipo: "usuario"
            });
        if (!window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
            programarActualizacion();
            finalizarNavegacionCargando(fecha);
        }
    }

    function alternarDetalle(boton) {
        const detalle = document.getElementById(boton.getAttribute("aria-controls"));
        if (!detalle) return;
        const abrir = detalle.hidden;
        detalle.hidden = !abrir;
        boton.setAttribute("aria-expanded", String(abrir));
        boton.textContent = abrir ? "Ocultar detalle ↑" : "Ver detalle ↓";
    }

    function iniciar() {
        const lista = document.querySelector("#seccion-resumen .sites-resumen-lista");
        if (!lista) return;
        window.HAIKU_RESUMEN_REFRESH_V1?.registrar("tablero", {
            orden: 100,
            dependencias: ["operacion", "pagos"],
            preparar: async ({ fecha }) => {
                const dias = [sumarDias(fecha, -1), sumarDias(fecha, 1)];
                const respuestas = await Promise.all(dias.map(async dia => {
                    try {
                        const respuesta = await window.haikuSupabase.rpc(
                            "haiku_operacion_dia", { p_fecha: dia });
                        if (respuesta.error) throw respuesta.error;
                        return { dia, filas: respuesta.data || [] };
                    } catch (error) {
                        console.warn("Resumen: no fue posible leer el contexto del día", dia, error);
                        return null;
                    }
                }));
                const mapas = new Map();
                respuestas.forEach(respuesta => {
                    if (respuesta) mapas.set(respuesta.dia, new Map(
                        respuesta.filas.map(item => [String(item.numero), item])));
                });
                return mapas;
            },
            completar: async ({ fecha, datos }, mapas) => {
                mapas.set(fecha, new Map(datos.operacion.filas
                    .map(item => [String(item.numero), item])));
                const lectura = identidadLecturaCobros(fecha, mapas.get(fecha));
                const cargos = new Map();
                for (const cargo of datos.pagos.cargos) {
                    if (cargo.estado !== "activo" ||
                        !["alojamiento", "servicio"].includes(cargo.tipo_cargo)) continue;
                    const id = `${cargo.reserva_id}|${cargo.tipo_cargo}`;
                    const estado = cargos.get(id) || { cero: true, conMonto: false };
                    const saldo = Number(cargo.saldo_cargo);
                    estado.cero = estado.cero && cargo.saldo_cargo != null &&
                        Number.isFinite(saldo) && saldo === 0;
                    estado.conMonto ||= Number(cargo.monto_ajustado) > 0;
                    cargos.set(id, estado);
                }
                return { mapas, lectura, cargos };
            },
            publicar: snapshot => {
                const { mapas, lectura, cargos } = snapshot.datos.tablero;
                mapas.forEach((filas, dia) => historial.set(dia, filas));
                operacionFiltrada.set(snapshot.fecha, mapas.get(snapshot.fecha));
                serviciosHidratados = true;
                pagosHidratados.add(snapshot.fecha);
                cobrosConocidos = { clave: lectura.clave, cargos };
                actualizar();
            }
        });
        const metricas = document.querySelector("#seccion-resumen > .resumen");
        metricas?.addEventListener("click", evento => {
            const tarjeta = evento.target.closest?.("[data-resumen-filtro]");
            if (tarjeta) seleccionarFiltro(tarjeta.dataset.resumenFiltro);
        });
        metricas?.addEventListener("keydown", evento => {
            if (!["Enter", " "].includes(evento.key) || evento.repeat) return;
            const tarjeta = evento.target.closest?.("[data-resumen-filtro]");
            if (!tarjeta) return;
            evento.preventDefault();
            seleccionarFiltro(tarjeta.dataset.resumenFiltro);
        });
        document.getElementById?.("resumen-mostrar-todas")?.addEventListener("click", () => {
            filtroSeleccionado = "";
            aplicarFiltro(fechaActiva());
        });
        const botonAnterior = document.getElementById("resumen-dia-anterior");
        const botonHoy = document.getElementById("resumen-dia-hoy");
        const botonSiguiente = document.getElementById("resumen-dia-siguiente");
        botonAnterior?.addEventListener("click", () => navegar(-1));
        botonHoy?.addEventListener("click", navegarHoy);
        botonSiguiente?.addEventListener("click", () => navegar(1));
        lista.addEventListener("click", evento => {
            const boton = evento.target.closest?.("[data-resumen-expandir]");
            if (boton) {
                alternarDetalle(boton);
                return;
            }
            const cabana = evento.target.closest?.("[data-resumen-ficha-cabana]");
            if (!cabana) return;
            const fila = cabana.closest(".sites-resumen-cabana");
            const ficha = fila?.querySelector("[data-ficha-cabana]");
            if (ficha && !ficha.hidden) {
                ficha.click();
            } else {
                const ampliar = fila?.querySelector("[data-resumen-expandir]");
                if (ampliar?.getAttribute("aria-expanded") === "false") alternarDetalle(ampliar);
            }
        });
        lista.addEventListener("input", programarActualizacion);
        lista.addEventListener("change", programarActualizacion);
        document.addEventListener("haiku:resumen-datos-actualizados", evento => {
            if (window.HAIKU_RESUMEN_REFRESH_V1?.publicando()) return;
            invalidarHistorial(fechaActiva());
            programarActualizacion(evento);
        });
        document.addEventListener("haiku:servicios-hidratados", evento => {
            if (window.HAIKU_RESUMEN_REFRESH_V1?.publicando()) return;
            serviciosHidratados = true;
            programarActualizacion(evento);
        });
        document.addEventListener("haiku:resumen-pagos-actualizados", evento => {
            if (window.HAIKU_RESUMEN_REFRESH_V1?.publicando()) return;
            const fecha = String(evento.detail?.fecha || "");
            if (fecha) pagosHidratados.add(fecha);
            invalidarCobrosConocidos();
            if (fecha === fechaActiva()) programarActualizacion(evento);
        });
        window.addEventListener?.("haiku:auth-ready", evento => {
            const usuario = String(evento.detail?.auth?.id || evento.detail?.usuario?.id || "");
            if (usuario !== usuarioHistorial || !usuario) {
                usuarioHistorial = usuario;
                serviciosHidratados = false;
                pagosHidratados.clear();
                invalidarCobrosConocidos();
                invalidarHistorialDeOtraSesion();
            }
            // El coordinador ya inicia o invalida la generación de sesión.
            if (!window.HAIKU_RESUMEN_REFRESH_V1?.activo()) programarActualizacion(evento);
        });

        const original = window.cargarCabanasDia;
        if (typeof original === "function" && !original.__haikuResumenSites) {
            const envuelta = function (...argumentos) {
                const resultado = original.apply(this, argumentos);
                programarActualizacion({
                    fecha: argumentos[0], evento: "cargarCabanasDia envuelto",
                    tipo: "interno_derivado"
                });
                return resultado;
            };
            envuelta.__haikuResumenSites = true;
            window.cargarCabanasDia = envuelta;
        }

        const observador = new MutationObserver(cambios => {
            if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) return;
            if (cambios.some(cambio => !cambio.target.closest?.(
                ".sites-resumen-fila, .sites-resumen-flujo"
            ))) programarActualizacion();
        });
        observador.observe(lista, { childList: true, characterData: true, subtree: true });
        const listaCheckout = document.getElementById("pagos-lista-checkout");
        if (listaCheckout) {
            const observadorCheckout = new MutationObserver(() => {
                programarActualizacion("MutationObserver pagos-lista-checkout");
            });
            observadorCheckout.observe(listaCheckout, { childList: true, subtree: true });
        }
        programarActualizacion();
    }

    window.HAIKU_RESUMEN_SITES_V1 = Object.freeze({
        refrescar: () => programarActualizacion({
            evento: "refresh explícito tablero", tipo: "externo"
        })
    });
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
