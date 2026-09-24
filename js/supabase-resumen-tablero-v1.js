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
    const historial = new Map();
    const historialPendiente = new Map();
    const historialVersion = new Map();
    let actualizacionPendiente = false;

    function fechaActiva() {
        try {
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
        texto(final?.querySelector(".sites-resumen-valor"),
            selectFinal?.selectedOptions?.[0]?.textContent?.trim() || "Pendiente");
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

    function actualizar() {
        actualizacionPendiente = false;
        const fecha = fechaActiva();
        if (!fecha) return;
        document.querySelectorAll(selectorFila).forEach(fila => {
            resumenFila(fila, fecha);
            pintarFlujo(fila, fecha);
        });
        cargarHistorial(fecha);
    }

    function programarActualizacion() {
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

    function cargarHistorial(fecha) {
        if (!window.haikuSesion || !window.haikuSupabase) return;
        for (const dia of [sumarDias(fecha, -1), fecha, sumarDias(fecha, 1)]) {
            if (historial.has(dia) || historialPendiente.has(dia)) continue;
            const version = historialVersion.get(dia) || 0;
            const pendiente = window.haikuSupabase.rpc("haiku_operacion_dia", { p_fecha: dia })
                .then(({ data, error }) => {
                    if (error) throw error;
                    if ((historialVersion.get(dia) || 0) !== version) return;
                    historial.set(dia, new Map((Array.isArray(data) ? data : [])
                        .map(item => [String(item.numero), item])));
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

    function navegar(diferencia) {
        const fecha = fechaActiva();
        if (!fecha || typeof seleccionarDia !== "function") return;
        const nueva = sumarDias(fecha, diferencia);
        const [anio, mes, dia] = nueva.split("-").map(Number);
        seleccionarDia(anio, mes - 1, dia, nueva);
        programarActualizacion();
    }

    function navegarHoy() {
        if (typeof seleccionarDia !== "function") return;
        const ahora = new Date();
        const fecha = [ahora.getFullYear(), String(ahora.getMonth() + 1).padStart(2, "0"),
            String(ahora.getDate()).padStart(2, "0")].join("-");
        seleccionarDia(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), fecha);
        programarActualizacion();
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
        document.getElementById("resumen-dia-anterior")?.addEventListener("click", () => navegar(-1));
        document.getElementById("resumen-dia-hoy")?.addEventListener("click", navegarHoy);
        document.getElementById("resumen-dia-siguiente")?.addEventListener("click", () => navegar(1));
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
        document.addEventListener("haiku:resumen-datos-actualizados", () => {
            invalidarHistorial(fechaActiva());
            programarActualizacion();
        });

        const original = window.cargarCabanasDia;
        if (typeof original === "function" && !original.__haikuResumenSites) {
            const envuelta = function (...argumentos) {
                const resultado = original.apply(this, argumentos);
                programarActualizacion();
                return resultado;
            };
            envuelta.__haikuResumenSites = true;
            window.cargarCabanasDia = envuelta;
        }

        const observador = new MutationObserver(cambios => {
            if (cambios.some(cambio => !cambio.target.closest?.(
                ".sites-resumen-fila, .sites-resumen-flujo"
            ))) programarActualizacion();
        });
        observador.observe(lista, { childList: true, characterData: true, subtree: true });
        const listaCheckout = document.getElementById("pagos-lista-checkout");
        if (listaCheckout) {
            const observadorCheckout = new MutationObserver(programarActualizacion);
            observadorCheckout.observe(listaCheckout, { childList: true, subtree: true });
        }
        programarActualizacion();
    }

    window.HAIKU_RESUMEN_SITES_V1 = Object.freeze({ refrescar: programarActualizacion });
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
