// ========================================
// HAIKU · SUPABASE · ATAJOS DESDE FICHA
// Total/Saldo -> Saldo Check-in
// Abono       -> Verificar abonos
// Servicios   -> Cobros Check-out (día de salida)
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const CONFIG = Object.freeze({
        "ficha-pago-total": {
            destino: "saldo",
            fecha: "ingreso",
            titulo: "Ir a Saldo Check-in",
            detalle: "total"
        },
        "ficha-pago-abono": {
            destino: "abono",
            fecha: "ingreso",
            titulo: "Ir a Verificar abonos",
            detalle: "abono"
        },
        "ficha-pago-saldo": {
            destino: "saldo",
            fecha: "ingreso",
            titulo: "Ir a Saldo Check-in",
            detalle: "saldo"
        },
        "ficha-pago-servicios": {
            destino: "servicios",
            fecha: "salida",
            titulo: "Ir a Cobros Check-out del día de salida",
            detalle: "servicios"
        }
    });

    const cacheEstadias = new Map();
    let navegando = false;
    const PULSACION_LARGA_MS = 520;
    const MOVIMIENTO_MAXIMO = 14;
    let pulsacion = null;
    let clicSuprimido = null;
    let turnoDetalle = 0;
    let popup = null;
    let cuadroPopup = null;

    function dinero(valor) {
        return `$${Math.round(Number(valor || 0)).toLocaleString("es-CL")}`;
    }

    function fechaCorta(valor) {
        const [a,m,d] = String(valor || "").slice(0,10).split("-");
        return a && m && d ? `${d}-${m}-${a.slice(-2)}` : "Sin fecha";
    }

    function textoMedio(valor) {
        const nombres = {
            transferencia: "Transferencia",
            efectivo: "Efectivo",
            tarjeta_credito: "Tarjeta crédito",
            tarjeta_debito: "Tarjeta débito",
            webpay_credito: "WebPay crédito",
            webpay_debito: "WebPay débito"
        };
        return nombres[String(valor || "").toLowerCase()] || String(valor || "Pago").replaceAll("_", " ");
    }

    function crear(tag, clase, texto) {
        const elemento = document.createElement(tag);
        if (clase) elemento.className = clase;
        if (texto !== undefined) elemento.textContent = texto;
        return elemento;
    }

    function sumar(lista, campo) {
        return (lista || []).reduce((total, item) => total + Number(item?.[campo] || 0), 0);
    }

    function agruparPagos(pagos, cabanaPorReserva) {
        const grupos = new Map();
        (pagos || []).forEach(pago => {
            const clave = pago.pago_grupo_id ? `grupo:${pago.pago_grupo_id}` : `pago:${pago.id}`;
            if (!grupos.has(clave)) {
                grupos.set(clave, {
                    monto: 0,
                    fecha: pago.fecha_pago,
                    medio: pago.medio_pago,
                    folio: pago.folio || "",
                    autorizacion: pago.codigo_autorizacion || "",
                    bove: pago.bove || "",
                    referencia: pago.referencia_externa || "",
                    cabanas: new Set()
                });
            }
            const grupo = grupos.get(clave);
            grupo.monto += Number(pago.monto || 0);
            const cabana = cabanaPorReserva.get(String(pago.reserva_id));
            if (cabana) grupo.cabanas.add(cabana);
        });
        return [...grupos.values()].sort((a,b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    }

    async function leerDetalleFinanciero(reservaId, numeroCabana, tipo) {
        const { data: grupo, error: errorGrupo } = await cliente.rpc("haiku_finanzas_grupo", {
            p_reserva_id: reservaId
        });
        if (errorGrupo) throw errorGrupo;

        const miembros = grupo?.es_grupo && Array.isArray(grupo.miembros)
            ? grupo.miembros.map(item => ({
                reservaId: String(item.reserva_id || ""),
                cabana: String(item.cabana || ""),
                nombre: item.nombre || ""
            })).filter(item => item.reservaId)
            : [{ reservaId:String(reservaId), cabana:String(numeroCabana || ""), nombre:"" }];
        const ids = [...new Set(miembros.map(item => item.reservaId).filter(Boolean))];
        const cabanaPorReserva = new Map(miembros.map(item => [item.reservaId,item.cabana]));

        const consultas = [cliente
            .from("vista_estado_cargos")
            .select("cargo_id,reserva_id,servicio_id,tipo_cargo,estado,monto_ajustado,aplicado_neto,saldo_cargo")
            .in("reserva_id", ids)
            .eq("estado", "activo")];
        if (tipo === "abono") {
            consultas.push(cliente
                .from("pagos")
                .select("id,reserva_id,monto,medio_pago,fecha_pago,folio,codigo_autorizacion,bove,referencia_externa,pago_grupo_id")
                .in("reserva_id", ids)
                .eq("tipo_movimiento", "pago")
                .eq("etapa_operativa", "abono")
                .eq("estado", "confirmado")
                .order("fecha_pago", { ascending:false }));
        }
        if (tipo === "servicios") {
            consultas.push(cliente
                .from("servicios")
                .select("id,reserva_id,fecha_servicio,hora_inicio,total,tipo_cobro,estado_servicio,catalogo_servicios(nombre)")
                .in("reserva_id", ids));
        }

        const resultados = await Promise.all(consultas);
        const [cargosR, detalleR] = resultados;
        if (cargosR.error) throw cargosR.error;
        if (detalleR?.error) throw detalleR.error;

        const cargos = (cargosR.data || []).filter(item => item.estado === "activo");
        const alojamiento = cargos.filter(item => item.tipo_cargo === "alojamiento");
        const cargosServicio = cargos.filter(item => item.tipo_cargo === "servicio");
        const resumenCalculado = {
            // La ficha define Total como lo aplicado más el saldo vigente.
            // El popup conserva exactamente esa misma autoridad visual.
            total: sumar(alojamiento, "aplicado_neto") + sumar(alojamiento, "saldo_cargo"),
            abono: sumar(alojamiento, "aplicado_neto"),
            saldo: sumar(alojamiento, "saldo_cargo"),
            servicios: sumar(cargosServicio, "saldo_cargo")
        };
        const resumen = grupo?.es_grupo ? {
            total: Number(grupo.total_alojamiento || 0),
            abono: Number(grupo.abonado_alojamiento || 0),
            saldo: Number(grupo.saldo_alojamiento || 0),
            servicios: Number(grupo.servicios_pendientes || 0)
        } : resumenCalculado;

        const porCabana = miembros.map(miembro => {
            const propios = alojamiento.filter(cargo => String(cargo.reserva_id) === miembro.reservaId);
            return {
                cabana: miembro.cabana,
                nombre: miembro.nombre,
                total: sumar(propios, "aplicado_neto") + sumar(propios, "saldo_cargo"),
                abono: sumar(propios, "aplicado_neto"),
                saldo: sumar(propios, "saldo_cargo")
            };
        });

        const detalle = {
            esGrupo: Boolean(grupo?.es_grupo),
            miembros,
            resumen,
            porCabana,
            pagos: tipo === "abono" ? agruparPagos(detalleR?.data || [], cabanaPorReserva) : [],
            servicios: []
        };

        if (tipo === "servicios") {
            const serviciosPorId = new Map((detalleR?.data || []).map(item => [String(item.id),item]));
            detalle.servicios = cargosServicio
                .filter(cargo => Number(cargo.saldo_cargo || 0) > 0)
                .map(cargo => {
                    const servicio = serviciosPorId.get(String(cargo.servicio_id)) || {};
                    return {
                        cabana: cabanaPorReserva.get(String(cargo.reserva_id)) || "",
                        nombre: servicio.catalogo_servicios?.nombre || "Servicio pendiente",
                        fecha: servicio.fecha_servicio,
                        hora: String(servicio.hora_inicio || "").slice(0,5),
                        saldo: Number(cargo.saldo_cargo || 0)
                    };
                })
                .sort((a,b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
        }
        return detalle;
    }

    function filaDetalle(principal, valor, meta = "") {
        const fila = crear("div", "haiku-ficha-detalle-fila");
        const textos = crear("div", "haiku-ficha-detalle-textos");
        textos.append(crear("strong", "", principal));
        if (meta) textos.append(crear("small", "", meta));
        fila.append(textos, crear("b", "", valor));
        return fila;
    }

    function agregarSeccion(contenido, titulo, filas, vacio) {
        const seccion = crear("section", "haiku-ficha-detalle-seccion");
        seccion.append(crear("h4", "", titulo));
        if (filas.length) filas.forEach(fila => seccion.append(fila));
        else seccion.append(crear("p", "haiku-ficha-detalle-vacio", vacio));
        contenido.append(seccion);
    }

    function identificadoresPago(pago) {
        const partes = [];
        if (pago.folio) partes.push(`Folio ${pago.folio}`);
        if (pago.autorizacion) partes.push(`Aut. ${pago.autorizacion}`);
        if (pago.bove) partes.push(`BOVTAR ${pago.bove}`);
        if (pago.referencia) partes.push(pago.referencia);
        return partes.join(" · ");
    }

    function pintarDetalle(contenido, tipo, datos) {
        contenido.replaceChildren();
        const etiquetas = {
            total: datos.esGrupo ? "Total del grupo" : "Total de la reserva",
            abono: datos.esGrupo ? "Abonos del grupo" : "Abonos de la reserva",
            saldo: datos.esGrupo ? "Saldo del grupo" : "Saldo de la reserva",
            servicios: datos.esGrupo ? "Servicios pendientes del grupo" : "Servicios pendientes"
        };
        const valor = datos.resumen[tipo];
        const cabecera = crear("div", "haiku-ficha-detalle-importe");
        cabecera.append(crear("span", "", etiquetas[tipo]), crear("strong", "", dinero(valor)));
        contenido.append(cabecera);

        const ecuacion = crear("div", "haiku-ficha-detalle-ecuacion");
        [["Total",datos.resumen.total],["Abonado",datos.resumen.abono],["Saldo",datos.resumen.saldo]]
            .forEach(([label,monto]) => {
                const celda = crear("div");
                celda.append(crear("span", "", label), crear("strong", "", dinero(monto)));
                ecuacion.append(celda);
            });
        contenido.append(ecuacion);

        if (["total","saldo"].includes(tipo)) {
            const filas = datos.porCabana
                .filter(item => tipo === "total" || item.saldo > 0)
                .map(item => filaDetalle(
                    item.cabana ? `CAB ${item.cabana}` : "Alojamiento",
                    dinero(tipo === "total" ? item.total : item.saldo),
                    tipo === "total"
                        ? `Abonado ${dinero(item.abono)} · Saldo ${dinero(item.saldo)}`
                        : `de ${dinero(item.total)} · abonado ${dinero(item.abono)}`
                ));
            agregarSeccion(contenido, tipo === "total" ? "Desglose de alojamiento" : "Saldo por cabaña", filas,
                tipo === "saldo" ? "El alojamiento está completamente pagado." : "No hay cargos de alojamiento activos.");
        }

        if (tipo === "abono") {
            const filas = datos.pagos.map(pago => filaDetalle(
                `${fechaCorta(pago.fecha)} · ${textoMedio(pago.medio)}`,
                dinero(pago.monto),
                [pago.cabanas.size ? [...pago.cabanas].sort((a,b) => Number(a)-Number(b)).map(n => `CAB ${n}`).join(" + ") : "", identificadoresPago(pago)]
                    .filter(Boolean).join(" · ")
            ));
            agregarSeccion(contenido, "Pagos confirmados", filas, "No hay abonos confirmados para mostrar.");
        }

        if (tipo === "servicios") {
            const filas = datos.servicios.map(servicio => filaDetalle(
                `${servicio.cabana ? `CAB ${servicio.cabana} · ` : ""}${servicio.nombre}`,
                dinero(servicio.saldo),
                [servicio.fecha ? fechaCorta(servicio.fecha) : "", servicio.hora].filter(Boolean).join(" · ")
            ));
            agregarSeccion(contenido, "Detalle pendiente", filas, "No hay servicios pendientes de pago.");
        }

        contenido.append(crear("small", "haiku-ficha-detalle-lectura", "Información actual de Proyecto H · Sólo lectura"));
    }

    function obtenerPopup() {
        if (popup?.isConnected) return popup;
        popup = crear("aside", "haiku-ficha-detalle-popup");
        popup.id = "haiku-ficha-detalle-popup";
        popup.hidden = true;
        popup.setAttribute("role", "dialog");
        popup.setAttribute("aria-live", "polite");
        popup.setAttribute("aria-label", "Detalle financiero de la reserva");

        const cabecera = crear("header", "haiku-ficha-detalle-cabecera");
        const titulo = crear("div");
        titulo.append(crear("span", "", "DETALLE FINANCIERO"), crear("strong", "", "Proyecto H"));
        const cerrar = crear("button", "haiku-ficha-detalle-cerrar", "×");
        cerrar.type = "button";
        cerrar.setAttribute("aria-label", "Cerrar detalle financiero");
        cerrar.addEventListener("click", cerrarDetalle);
        cabecera.append(titulo, cerrar);

        const contenido = crear("div", "haiku-ficha-detalle-contenido");
        contenido.dataset.haikuFichaDetalleContenido = "1";
        popup.append(cabecera, contenido);
        document.body.appendChild(popup);
        return popup;
    }

    function posicionarPopup(cuadro) {
        const panel = obtenerPopup();
        const rect = cuadro.getBoundingClientRect();
        const ancho = Math.min(390, Math.max(280, window.innerWidth - 24));
        panel.style.width = `${ancho}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        if (window.innerWidth <= 620) {
            panel.style.left = "12px";
            panel.style.right = "12px";
            panel.style.bottom = "12px";
            panel.style.top = "auto";
            panel.style.width = "auto";
            return;
        }
        const izquierda = Math.max(12, Math.min(window.innerWidth - ancho - 12,
            rect.left + rect.width / 2 - ancho / 2));
        panel.style.left = `${izquierda}px`;
        panel.style.top = `${Math.min(window.innerHeight - 120, rect.bottom + 10)}px`;
        requestAnimationFrame(() => {
            if (panel.hidden || cuadroPopup !== cuadro) return;
            const alto = panel.getBoundingClientRect().height;
            if (rect.bottom + 10 + alto > window.innerHeight - 12) {
                panel.style.top = `${Math.max(12, rect.top - alto - 10)}px`;
            }
        });
    }

    function cerrarDetalle() {
        turnoDetalle++;
        cuadroPopup?.classList.remove("haiku-ficha-atajo-detalle-activo");
        cuadroPopup = null;
        if (popup) {
            popup.hidden = true;
            popup.removeAttribute("aria-busy");
        }
    }

    async function abrirDetalle(cuadro, id) {
        const config = CONFIG[id];
        const modal = document.getElementById("ficha-reserva-modal");
        const reservaId = String(modal?.dataset?.reservaId || "");
        const numeroCabana = String(modal?.dataset?.numeroCabana || "");
        if (!config || !reservaId || modal?.hidden) return;

        cerrarDetalle();
        cuadroPopup = cuadro;
        cuadro.classList.add("haiku-ficha-atajo-detalle-activo");
        const panel = obtenerPopup();
        const contenido = panel.querySelector("[data-haiku-ficha-detalle-contenido]");
        contenido.replaceChildren(crear("p", "haiku-ficha-detalle-cargando", "Consultando información actual…"));
        panel.hidden = false;
        panel.setAttribute("aria-busy", "true");
        posicionarPopup(cuadro);
        const turno = ++turnoDetalle;

        try {
            const datos = await leerDetalleFinanciero(reservaId, numeroCabana, config.detalle);
            if (turno !== turnoDetalle || cuadroPopup !== cuadro || modal.hidden ||
                String(modal.dataset.reservaId || "") !== reservaId) return;
            pintarDetalle(contenido, config.detalle, datos);
            panel.removeAttribute("aria-busy");
            posicionarPopup(cuadro);
        } catch (error) {
            if (turno !== turnoDetalle || cuadroPopup !== cuadro) return;
            console.error("HAIKU · detalle financiero en ficha:", error);
            contenido.replaceChildren(crear("p", "haiku-ficha-detalle-error",
                error?.message || "No fue posible cargar el detalle financiero."));
            panel.removeAttribute("aria-busy");
            posicionarPopup(cuadro);
        }
    }

    function cancelarPulsacion({ conservarPopup = true } = {}) {
        if (!pulsacion) return;
        clearTimeout(pulsacion.temporizador);
        pulsacion.cuadro.classList.remove("haiku-ficha-atajo-esperando");
        if (!conservarPopup && pulsacion.abierta) cerrarDetalle();
        pulsacion = null;
    }

    function iniciarPulsacion(evento, cuadro, id) {
        if (evento.pointerType === "mouse" && evento.button !== 0) return;
        // Si el navegador anterior no produjo click tras otra pulsación larga,
        // una nueva pulsación es una intención distinta y limpia ese bloqueo.
        // La pulsación actual volverá a marcarlo al completar el tiempo.
        clicSuprimido = null;
        cancelarPulsacion();
        const estado = {
            cuadro,
            id,
            pointerId:evento.pointerId,
            x:evento.clientX,
            y:evento.clientY,
            abierta:false,
            temporizador:null
        };
        pulsacion = estado;
        cuadro.classList.add("haiku-ficha-atajo-esperando");
        cuadro.setPointerCapture?.(evento.pointerId);
        estado.temporizador = setTimeout(() => {
            if (pulsacion !== estado) return;
            estado.abierta = true;
            cuadro.classList.remove("haiku-ficha-atajo-esperando");
            // Se conserva hasta consumir el click que el navegador genera al
            // soltar. No vence por tiempo: el operador puede mantener pulsado
            // todo lo necesario para leer el popup antes de levantar el dedo.
            clicSuprimido = { cuadro, pointerId:estado.pointerId };
            abrirDetalle(cuadro, id);
        }, PULSACION_LARGA_MS);
    }

    function prepararAtajos() {
        Object.entries(CONFIG).forEach(([id, config]) => {
            const valor = document.getElementById(id);
            const cuadro = valor?.parentElement;
            if (!valor || !cuadro) return;

            // Todos los cuadros financieros funcionan como navegación.
            // Servicios se mantiene activo incluso cuando marca $0, porque
            // también sirve para revisar pagos ya realizados o el estado
            // completo del Check-out en la fecha de salida.
            const habilitado = true;

            cuadro.classList.toggle("haiku-ficha-atajo", habilitado);
            cuadro.classList.toggle("haiku-ficha-atajo-inactivo", !habilitado);
            cuadro.dataset.haikuFichaAtajo = habilitado ? id : "";

            if (habilitado) {
                const ayuda = `${config.titulo}. Mantén presionado para ver el detalle aquí.`;
                cuadro.setAttribute("role", "button");
                cuadro.setAttribute("tabindex", "0");
                cuadro.setAttribute("title", ayuda);
                cuadro.setAttribute("aria-label", ayuda);
            } else {
                cuadro.removeAttribute("role");
                cuadro.removeAttribute("tabindex");
                cuadro.removeAttribute("title");
                cuadro.removeAttribute("aria-label");
            }
        });
    }

    async function obtenerEstadia(reservaId, numeroCabana) {
        const clave = `${reservaId}|${numeroCabana}`;
        if (cacheEstadias.has(clave)) return cacheEstadias.get(clave);

        const { data, error } = await cliente.rpc("haiku_ficha_reserva_core", {
            p_reserva_id: reservaId
        });
        if (error) throw error;

        const estadias = Array.isArray(data?.estadias) ? data.estadias : [];
        const estadia = estadias.find(
            e => String(e?.cabana_numero || "") === String(numeroCabana || "")
        ) || estadias[0] || null;

        if (estadia) cacheEstadias.set(clave, estadia);
        return estadia;
    }

    function establecerFecha(fecha) {
        const iso = String(fecha || "").slice(0, 10);
        if (!iso) return;

        try {
            fechaSeleccionada = iso;
        } catch (error) {
            console.warn("HAIKU · No fue posible cambiar fecha global desde atajo:", error);
        }

        localStorage.setItem("haikuFechaSeleccionada", iso);
    }

    function cerrarFicha() {
        const cerrar = document.getElementById("ficha-reserva-cerrar");
        if (cerrar) cerrar.click();
    }

    function abrirPagos() {
        const boton = document.querySelector('.menu-item[data-seccion="pagos"]');
        if (boton) boton.click();
    }

    async function refrescarPagos(destino) {
        try {
            if (destino === "abono") {
                await window.haikuCargarAbonosSupabase?.();
                return;
            }

            if (destino === "saldo") {
                await window.haikuCargarSaldosCheckinSupabase?.();
                return;
            }

            if (destino === "servicios") {
                if (typeof window.haikuCargarCheckoutSupabase === "function") {
                    await window.haikuCargarCheckoutSupabase();
                } else if (typeof cargarCobrosCheckout === "function") {
                    await Promise.resolve(cargarCobrosCheckout());
                }
            }
        } catch (error) {
            console.warn("HAIKU · Refresco de atajo de pagos:", error);
        }
    }

    function buscarTarjeta(destino, reservaId, numeroCabana) {
        if (destino === "abono") {
            return document.querySelector(
                `#pagos-lista-abonos .pago-abono-item[data-reserva-id="${CSS.escape(reservaId)}"]`
            );
        }

        if (destino === "saldo") {
            return document.querySelector(
                `#pagos-lista-checkin .haiku-saldo-v4[data-reserva-id="${CSS.escape(reservaId)}"]`
            );
        }

        if (destino === "servicios") {
            const lista = document.getElementById("pagos-lista-checkout");
            if (!lista) return null;

            const exacta = lista.querySelector(
                `[data-reserva-id="${CSS.escape(reservaId)}"]`
            );
            if (exacta) return exacta;

            return [...lista.querySelectorAll(".pago-checkout-item")].find(
                item => item.textContent.includes(`CAB ${numeroCabana}`)
            ) || lista;
        }

        return null;
    }

    async function enfocarDestino(destino, reservaId, numeroCabana) {
        for (let intento = 0; intento < 24; intento++) {
            const tarjeta = buscarTarjeta(destino, reservaId, numeroCabana);
            if (tarjeta) {
                tarjeta.scrollIntoView({ behavior: "smooth", block: "center" });
                tarjeta.classList.add("haiku-atajo-destino");
                setTimeout(() => tarjeta.classList.remove("haiku-atajo-destino"), 1900);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 90));
        }

        const fallback = destino === "abono"
            ? document.getElementById("pagos-lista-abonos")
            : destino === "saldo"
                ? document.getElementById("pagos-lista-checkin")
                : document.getElementById("pagos-lista-checkout");

        fallback?.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
    }

    async function ejecutarAtajo(id) {
        const config = CONFIG[id];
        if (!config || navegando) return;

        const modal = document.getElementById("ficha-reserva-modal");
        const reservaId = String(modal?.dataset?.reservaId || "");
        const numeroCabana = String(modal?.dataset?.numeroCabana || "");
        if (!reservaId) return;

        navegando = true;
        try {
            const estadia = await obtenerEstadia(reservaId, numeroCabana);
            if (!estadia) throw new Error("No se encontró la estadía de esta reserva.");

            const fechaDestino = config.fecha === "salida"
                ? (estadia.fecha_salida || estadia.fecha_ingreso)
                : estadia.fecha_ingreso;

            establecerFecha(fechaDestino);
            cerrarFicha();
            abrirPagos();

            await new Promise(resolve => setTimeout(resolve, 80));
            await refrescarPagos(config.destino);
            await enfocarDestino(config.destino, reservaId, numeroCabana);

            console.info(
                "HAIKU · Atajo ficha → Pagos:",
                config.destino,
                reservaId,
                String(fechaDestino || "").slice(0, 10)
            );
        } catch (error) {
            console.error("HAIKU · No fue posible abrir atajo desde ficha:", error);
            alert(error?.message || "No fue posible abrir el apartado correspondiente.");
        } finally {
            navegando = false;
        }
    }

    document.addEventListener("pointerdown", evento => {
        const cuadro = evento.target.closest?.("[data-haiku-ficha-atajo]");
        const id = cuadro?.dataset?.haikuFichaAtajo || "";
        if (!id) return;
        iniciarPulsacion(evento, cuadro, id);
    }, true);

    document.addEventListener("pointermove", evento => {
        if (!pulsacion || pulsacion.pointerId !== evento.pointerId || pulsacion.abierta) return;
        if (Math.hypot(evento.clientX - pulsacion.x, evento.clientY - pulsacion.y) > MOVIMIENTO_MAXIMO) {
            cancelarPulsacion();
        }
    }, true);

    ["pointerup","pointercancel"].forEach(tipo => document.addEventListener(tipo, evento => {
        if (pulsacion?.pointerId !== evento.pointerId) return;
        cancelarPulsacion();
    }, true));

    document.addEventListener("contextmenu", evento => {
        if (evento.target.closest?.("[data-haiku-ficha-atajo]")) evento.preventDefault();
    }, true);

    document.addEventListener("dragstart", evento => {
        if (evento.target.closest?.("[data-haiku-ficha-atajo]")) evento.preventDefault();
    }, true);

    document.addEventListener("click", evento => {
        const cuadro = evento.target.closest?.("[data-haiku-ficha-atajo]");
        const id = cuadro?.dataset?.haikuFichaAtajo || "";
        if (!id) {
            if (popup && !popup.hidden && !popup.contains(evento.target)) cerrarDetalle();
            return;
        }

        if (clicSuprimido?.cuadro === cuadro) {
            clicSuprimido = null;
            evento.preventDefault();
            evento.stopPropagation();
            evento.stopImmediatePropagation?.();
            return;
        }
        clicSuprimido = null;
        cerrarDetalle();

        evento.preventDefault();
        evento.stopPropagation();
        ejecutarAtajo(id);
    }, true);

    document.addEventListener("keydown", evento => {
        if (evento.key === "Escape" && popup && !popup.hidden) {
            evento.preventDefault();
            cerrarDetalle();
            return;
        }
        if (!["Enter", " "].includes(evento.key)) return;
        const cuadro = evento.target.closest?.("[data-haiku-ficha-atajo]");
        const id = cuadro?.dataset?.haikuFichaAtajo || "";
        if (!id) return;

        evento.preventDefault();
        ejecutarAtajo(id);
    }, true);

    const modal = document.getElementById("ficha-reserva-modal");
    if (modal) {
        new MutationObserver(() => {
            prepararAtajos();
            if (modal.hidden) cerrarDetalle();
        }).observe(modal, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["class","hidden","data-reserva-id"]
        });
    }

    window.addEventListener("blur", () => cancelarPulsacion({ conservarPopup:false }));
    window.addEventListener("resize", () => {
        if (cuadroPopup && popup && !popup.hidden) posicionarPopup(cuadroPopup);
    });

    window.addEventListener("haiku:auth-ready", () => setTimeout(prepararAtajos, 120));
    setTimeout(prepararAtajos, 180);

    const estilo = document.createElement("style");
    estilo.textContent = `
        .ficha-pagos > .haiku-ficha-atajo {
            position: relative;
            cursor: pointer;
            user-select: none;
            -webkit-user-select: none;
            touch-action: pan-y;
            transition: background .16s ease, box-shadow .16s ease, transform .16s ease;
        }
        .ficha-pagos > .haiku-ficha-atajo:hover {
            background: #f5faf7;
            box-shadow: inset 0 0 0 1px rgba(47,118,83,.16);
        }
        .ficha-pagos > .haiku-ficha-atajo:active {
            transform: scale(.985);
        }
        .ficha-pagos > .haiku-ficha-atajo:focus-visible {
            outline: 2px solid rgba(47,118,83,.42);
            outline-offset: -2px;
        }
        .ficha-pagos > .haiku-ficha-atajo-esperando {
            background: #eef8f2;
            box-shadow: inset 0 0 0 1px rgba(47,118,83,.3);
            transform: scale(.985);
        }
        .ficha-pagos > .haiku-ficha-atajo-esperando::before {
            content: "";
            position: absolute;
            right: 8px;
            bottom: 2px;
            left: 8px;
            height: 2px;
            border-radius: 999px;
            background: #2f7653;
            transform-origin: left;
            animation: haikuFichaPulsacion ${PULSACION_LARGA_MS}ms linear both;
        }
        .ficha-pagos > .haiku-ficha-atajo-detalle-activo {
            background: #eef8f2;
            box-shadow: inset 0 0 0 2px rgba(47,118,83,.24);
        }
        .ficha-pagos > .haiku-ficha-atajo::after {
            content: "›";
            position: absolute;
            top: 6px;
            right: 8px;
            color: #8aa294;
            font-size: 12px;
            font-weight: 800;
            opacity: .72;
        }
        .haiku-atajo-destino {
            animation: haikuAtajoDestino 1.8s ease;
        }
        .haiku-ficha-detalle-popup {
            position: fixed;
            z-index: 10060;
            box-sizing: border-box;
            max-height: min(510px, calc(100vh - 24px));
            overflow: hidden;
            border: 1px solid #cfdbd4;
            border-radius: 15px;
            background: rgba(253,254,253,.985);
            color: #223129;
            box-shadow: 0 24px 65px rgba(16,35,25,.24), 0 4px 14px rgba(16,35,25,.1);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            animation: haikuFichaDetalleEntrada .16s ease-out both;
        }
        .haiku-ficha-detalle-popup[hidden] { display: none !important; }
        .haiku-ficha-detalle-cabecera {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 13px 14px 11px;
            border-bottom: 1px solid #e2e9e5;
            background: #f3f8f5;
        }
        .haiku-ficha-detalle-cabecera > div { display: flex; flex-direction: column; gap: 2px; }
        .haiku-ficha-detalle-cabecera span { font-size: 9px; letter-spacing: .09em; color: #718078; }
        .haiku-ficha-detalle-cabecera strong { font-size: 13px; color: #244f38; }
        .haiku-ficha-detalle-cerrar {
            width: 30px;
            height: 30px;
            border: 1px solid #d4dfd8;
            border-radius: 9px;
            background: #fff;
            color: #526159;
            font: 20px/1 system-ui;
            cursor: pointer;
        }
        .haiku-ficha-detalle-contenido {
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-height: min(445px, calc(100vh - 90px));
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 12px;
        }
        .haiku-ficha-detalle-importe {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 10px 11px;
            border: 1px solid #d9e6de;
            border-radius: 11px;
            background: #f3faf6;
        }
        .haiku-ficha-detalle-importe span { font-size: 11px; color: #52655a; }
        .haiku-ficha-detalle-importe strong { font-size: 19px; color: #236942; font-variant-numeric: tabular-nums; }
        .haiku-ficha-detalle-ecuacion { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; }
        .haiku-ficha-detalle-ecuacion > div {
            display: flex;
            flex-direction: column;
            gap: 3px;
            min-width: 0;
            padding: 8px;
            border-radius: 9px;
            background: #f5f6f5;
            text-align: center;
        }
        .haiku-ficha-detalle-ecuacion span { font-size: 9px; color: #758078; }
        .haiku-ficha-detalle-ecuacion strong { font-size: 11px; font-variant-numeric: tabular-nums; }
        .haiku-ficha-detalle-seccion { display: flex; flex-direction: column; gap: 6px; }
        .haiku-ficha-detalle-seccion h4 { margin: 1px 2px 0; font-size: 10px; color: #5a6a61; text-transform: uppercase; letter-spacing: .05em; }
        .haiku-ficha-detalle-fila {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 8px 9px;
            border: 1px solid #e1e7e3;
            border-radius: 9px;
            background: #fff;
        }
        .haiku-ficha-detalle-textos { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .haiku-ficha-detalle-textos strong { font-size: 11px; overflow-wrap: anywhere; }
        .haiku-ficha-detalle-textos small { font-size: 9px; color: #748078; overflow-wrap: anywhere; }
        .haiku-ficha-detalle-fila > b { flex: 0 0 auto; font-size: 11px; color: #2b5e42; font-variant-numeric: tabular-nums; }
        .haiku-ficha-detalle-vacio,
        .haiku-ficha-detalle-cargando,
        .haiku-ficha-detalle-error { margin: 0; padding: 13px 10px; border-radius: 9px; background: #f5f7f6; color: #68736d; font-size: 11px; text-align: center; }
        .haiku-ficha-detalle-error { background: #fff3ef; color: #914d39; }
        .haiku-ficha-detalle-lectura { display: block; color: #7b867f; font-size: 9px; text-align: center; }
        @keyframes haikuFichaPulsacion { from { transform: scaleX(0); opacity: .35; } to { transform: scaleX(1); opacity: 1; } }
        @keyframes haikuFichaDetalleEntrada { from { opacity: 0; transform: translateY(-4px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes haikuAtajoDestino {
            0%, 100% { box-shadow: inherit; }
            22%, 70% { box-shadow: 0 0 0 3px rgba(47,118,83,.22), 0 10px 24px rgba(47,118,83,.12); }
        }
        @media (max-width: 620px) {
            .haiku-ficha-detalle-popup { max-height: min(70vh, 520px); border-radius: 16px; }
            .haiku-ficha-detalle-contenido { max-height: calc(min(70vh, 520px) - 58px); }
        }
        @media (prefers-reduced-motion: reduce) {
            .haiku-ficha-detalle-popup,
            .ficha-pagos > .haiku-ficha-atajo-esperando::before { animation: none; }
        }
    `;
    document.head.appendChild(estilo);

    window.HAIKU_FICHA_ATAJOS_V2 = Object.freeze({
        abrirDetalle: (id) => {
            const cuadro = document.getElementById(id)?.parentElement;
            if (cuadro && CONFIG[id]) return abrirDetalle(cuadro, id);
        },
        cerrarDetalle,
        leerDetalleFinanciero
    });

    console.info("HAIKU · Atajos de ficha Supabase preparados.");
})();
