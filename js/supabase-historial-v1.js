// ========================================
// HAIKU · HISTORIAL + AUDITORÍA · SUPABASE V2
// Historial humano + auditoría técnica legible desde eventos_auditoria.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const seccion = document.getElementById("seccion-historial");
    if (!seccion) return;

    let modo = "historial";
    let eventos = [];
    let limite = 250;
    let visibles = 14;
    let totalExacto = 0;
    let cargando = false;
    let errorCarga = "";
    let ultimaCarga = 0;
    const abiertos = { historial: new Set(), auditoria: new Set() };

    const contexto = {
        usuarios: new Map(),
        reservas: new Map(),
        cabanas: new Map(),
        pagos: new Map(),
        servicios: new Map(),
        estadias: new Map()
    };

    const CAMPOS = {
        estado: "Estado",
        estado_reserva: "Estado de reserva",
        estado_estadia: "Estado de estadía",
        estado_servicio: "Estado del servicio",
        titular_nombre: "Titular",
        fecha_ingreso: "Ingreso",
        fecha_salida: "Salida",
        fecha_servicio: "Fecha del servicio",
        hora_inicio: "Hora",
        cabana_id: "Cabaña",
        reserva_id: "Reserva",
        estadia_id: "Estadía",
        monto: "Monto",
        total: "Total",
        medio_pago: "Medio de pago",
        etapa_operativa: "Etapa",
        codigo_autorizacion: "CodAut",
        folio: "Folio",
        bove: "BOVE",
        bove_cierre: "BOVE alojamiento",
        bove_checkout: "BOVE Check-out",
        resumen_entrega: "Resumen de entrega",
        novedades: "Novedades",
        motivo_reapertura: "Motivo de reapertura",
        checkin_realizado_en: "Check-in",
        checkout_realizado_en: "Check-out",
        observaciones: "Observaciones",
        datos_origen: "Datos del pago",
        verificado_en: "Verificado",
        verificado_por: "Verificado por",
        bove_cierre_registrado_en: "BOVE alojamiento registrado",
        bove_cierre_registrado_por: "BOVE alojamiento registrado por",
        bove_checkout_registrado_en: "BOVE Check-out registrado",
        bove_checkout_registrado_por: "BOVE Check-out registrado por",
        cerrado_en: "Cerrado",
        cerrado_por: "Cerrado por",
        reabierto_en: "Reabierto",
        reabierto_por: "Reabierto por",
        finalizado_en: "Finalizado",
        finalizado_por: "Finalizado por",
        snapshot: "Copia histórica del cierre"
    };

    const CAMPOS_OCULTOS_HISTORIAL = new Set([
        "datos_origen",
        "snapshot",
        "verificado_en",
        "verificado_por",
        "bove_cierre_registrado_en",
        "bove_cierre_registrado_por",
        "bove_checkout_registrado_en",
        "bove_checkout_registrado_por",
        "cerrado_en",
        "cerrado_por",
        "reabierto_en",
        "reabierto_por",
        "finalizado_en",
        "finalizado_por",
        "creado_en",
        "creado_por",
        "actualizado_en",
        "actualizado_por"
    ]);

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    function limpiar(valor) {
        return String(valor ?? "").trim();
    }

    function textoVisibleSeguro(valor) {
        return limpiar(valor)
            .replace(/\bBearer\s+\S+/gi, "Bearer [oculto]")
            .replace(/\b(access[_-]?token|refresh[_-]?token|secret|password|api[_-]?key|authorization|jwt)\b\s*[:=]\s*[^\s,;]+/gi, "$1: [oculto]");
    }

    function normalizarBusqueda(valor) {
        return limpiar(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CL");
    }

    function elemento(tag, clase, texto) {
        const el = document.createElement(tag);
        if (clase) el.className = clase;
        if (texto !== undefined) el.textContent = texto;
        return el;
    }

    function dinero(valor) {
        return `$${Number(valor || 0).toLocaleString("es-CL")}`;
    }

    function medioPago(valor) {
        const mapa = {
            transferencia: "Transferencia",
            webpay_credito: "WebPay Crédito",
            webpay_debito: "WebPay Débito",
            tarjeta_credito: "Tarjeta Crédito",
            tarjeta_debito: "Tarjeta Débito",
            efectivo: "Efectivo"
        };
        return mapa[String(valor || "")] || textoEstado(valor);
    }

    function textoEstado(valor) {
        const mapa = {
            pendiente_asociacion: "Pendiente de asociar",
            pendiente: "Pendiente",
            confirmado: "Confirmado",
            confirmada: "Confirmada",
            hospedada: "Hospedada",
            checked_out: "Check-out realizado",
            cancelada: "Cancelada",
            no_show: "No Show",
            activo: "Activo",
            anulado: "Anulado",
            programado: "Programado",
            en_proceso: "En proceso",
            realizado: "Realizado",
            completado: "Completado",
            completada: "Completada",
            cerrado: "Cerrado",
            abierto: "Abierto",
            borrador: "Borrador",
            cerrado_con_pendientes: "Cerrado con pendientes",
            reabierto: "Reabierto",
            abono: "Abono",
            saldo: "Saldo",
            otro: "Otro",
            usuario: "Usuario",
            sistema: "Sistema",
            importacion: "Importación",
            cloudbeds: "Cloudbeds"
        };
        const clave = limpiar(valor);
        if (!clave) return "—";
        return mapa[clave] || clave.replaceAll("_", " ").replace(/^./, s => s.toUpperCase());
    }

    function fechaHora(valor) {
        if (!valor) return "—";
        try {
            return new Intl.DateTimeFormat("es-CL", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Santiago"
            }).format(new Date(valor));
        } catch {
            return String(valor);
        }
    }

    function fechaCorta(valor) {
        if (!valor) return "—";
        const texto = String(valor);
        const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) return `${match[3]}-${match[2]}-${match[1]}`;
        return fechaHora(valor);
    }

    function fechaLocal(valor) {
        if (!valor) return "";
        try {
            const partes = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Santiago",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).formatToParts(new Date(valor));
            const obj = Object.fromEntries(partes.map(p => [p.type, p.value]));
            return `${obj.year}-${obj.month}-${obj.day}`;
        } catch {
            return "";
        }
    }

    function horaLocal(valor) {
        if (!valor) return "—";
        return new Intl.DateTimeFormat("es-CL", {
            hour: "2-digit", minute: "2-digit", hour12: false,
            timeZone: "America/Santiago"
        }).format(new Date(valor));
    }

    function fechaGrupo(fecha) {
        const texto = new Intl.DateTimeFormat("es-CL", {
            weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
        }).format(new Date(`${fecha}T12:00:00Z`));
        return texto.replace(/^./, inicial => inicial.toLocaleUpperCase("es-CL"));
    }

    function esFechaISO(valor) {
        if (typeof valor !== "string") return false;
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor);
    }

    function esUuid(valor) {
        return UUID_RE.test(String(valor || ""));
    }

    function cortoId(valor) {
        const texto = limpiar(valor);
        if (!texto) return "—";
        return texto.length > 13 ? `${texto.slice(0, 8)}…${texto.slice(-4)}` : texto;
    }

    function idsUnicos(lista) {
        return [...new Set(lista.filter(Boolean).map(String))];
    }

    function usuarioNombre(id) {
        if (!id) return "Sistema";
        const u = contexto.usuarios.get(String(id));
        if (!u) return "Usuario sin identificar";
        return [u.nombre, u.apellido].filter(Boolean).join(" ") || "Usuario sin identificar";
    }

    function reservaInfo(id) {
        return id ? contexto.reservas.get(String(id)) || null : null;
    }

    function cabanaInfo(id) {
        return id ? contexto.cabanas.get(String(id)) || null : null;
    }

    function estadiaInfo(id) {
        return id ? contexto.estadias.get(String(id)) || null : null;
    }

    function pagoInfo(evento) {
        if (!["pago", "pagos"].includes(evento?.entidad_tipo)) return null;
        return evento.entidad_id ? contexto.pagos.get(String(evento.entidad_id)) || null : null;
    }

    function servicioInfo(evento) {
        if (!["servicio", "servicios"].includes(evento?.entidad_tipo)) return null;
        return evento.entidad_id ? contexto.servicios.get(String(evento.entidad_id)) || null : null;
    }

    function reservaEvento(evento) {
        return reservaInfo(
            evento?.reserva_id ||
            pagoInfo(evento)?.reserva_id ||
            servicioInfo(evento)?.reserva_id ||
            estadiaInfo(evento?.estadia_id)?.reserva_id
        );
    }

    function cabanaEvento(evento) {
        const directa = cabanaInfo(evento?.cabana_id);
        if (directa) return directa;
        const estadia = estadiaInfo(evento?.estadia_id);
        return cabanaInfo(estadia?.cabana_id);
    }

    function normalizarCambios(evento) {
        const lista = Array.isArray(evento?.cambios) ? evento.cambios : [];
        return lista.map(c => ({
            campo: limpiar(c?.campo) || "Cambio",
            anterior: c?.anterior !== undefined ? c.anterior : c?.antes,
            nuevo: c?.nuevo !== undefined ? c.nuevo : c?.despues
        }));
    }

    function nombreCampo(campo) {
        return CAMPOS[campo] || limpiar(campo)
            .replaceAll("_", " ")
            .replace(/^./, s => s.toUpperCase());
    }

    function nombreEntidad(valor) {
        const mapa = {
            reservas: "Reserva",
            reserva: "Reserva",
            reserva_estadias: "Estadía",
            estadia_noches: "Noche de estadía",
            pagos: "Pago",
            pago: "Pago",
            servicios: "Servicio",
            servicio: "Servicio",
            turnos: "Turno",
            cierres_turno: "Cierre de turno",
            cierre_turno: "Cierre de turno"
        };
        return mapa[String(valor || "")] || textoEstado(valor);
    }

    function nombreTipoEvento(valor) {
        const mapa = {
            creacion: "Creación",
            actualizacion: "Actualización",
            eliminacion: "Eliminación",
            finanzas: "Finanzas",
            cierre_turno: "Cierre de turno"
        };
        return mapa[String(valor || "")] || textoEstado(valor);
    }

    function resumenObjeto(valor, campo) {
        if (!valor || typeof valor !== "object") return "Información actualizada";

        if (campo === "datos_origen") {
            const partes = [];
            if (valor.destino_asociacion) {
                const destino = valor.destino_asociacion === "servicios"
                    ? "Servicios Check-out"
                    : valor.destino_asociacion === "alojamiento"
                        ? "Alojamiento"
                        : textoEstado(valor.destino_asociacion);
                partes.push(`Destino: ${destino}`);
            }
            if (valor.cabana_referencia) partes.push(`CAB ${valor.cabana_referencia}`);
            if (valor.tarjeta_referencia) partes.push(valor.tarjeta_referencia);
            if (valor.tipo_webpay) partes.push(`WebPay ${textoEstado(valor.tipo_webpay)}`);
            if (typeof valor.manager_revisado === "boolean") {
                partes.push(`Manager: ${valor.manager_revisado ? "revisado" : "pendiente"}`);
            }
            return partes.length ? partes.join(" · ") : "Datos administrativos del pago actualizados";
        }

        if (campo === "snapshot") {
            return "Copia histórica del cierre guardada";
        }

        const cantidad = Array.isArray(valor)
            ? valor.length
            : Object.keys(valor).length;
        return cantidad
            ? `Información interna actualizada (${cantidad} ${cantidad === 1 ? "dato" : "datos"})`
            : "Información interna actualizada";
    }

    function valorHumano(valor, campo = "", modoValor = "historial") {
        if (valor === null || valor === undefined || valor === "") return "—";
        if (typeof valor === "boolean") return valor ? "Sí" : "No";
        if (typeof valor === "object") return resumenObjeto(valor, campo);

        const texto = String(valor);

        if (String(campo).includes("monto") || campo === "total") return dinero(valor);
        if (campo === "medio_pago") return medioPago(valor);
        if (["estado", "estado_reserva", "estado_estadia", "estado_servicio", "etapa_operativa"].includes(campo)) {
            return textoEstado(valor);
        }
        if (["fecha_ingreso", "fecha_salida", "fecha_servicio"].includes(campo)) {
            return fechaCorta(valor);
        }
        if (esFechaISO(texto) || /_(en)$/.test(campo)) return fechaHora(valor);

        if (campo.endsWith("_por") && esUuid(texto)) {
            return usuarioNombre(texto);
        }
        if (campo === "reserva_id" && esUuid(texto)) {
            const r = reservaInfo(texto);
            return r ? referenciaReserva(r) : (modoValor === "auditoria" ? cortoId(texto) : "Reserva HAIKU");
        }
        if (campo === "cabana_id" && esUuid(texto)) {
            const c = cabanaInfo(texto);
            return c?.numero ? `CAB ${c.numero}` : (modoValor === "auditoria" ? cortoId(texto) : "Cabaña");
        }
        if (campo === "estadia_id" && esUuid(texto)) {
            const e = estadiaInfo(texto);
            return e ? referenciaEstadia(e) : (modoValor === "auditoria" ? cortoId(texto) : "Estadía");
        }
        if (esUuid(texto)) {
            return modoValor === "auditoria" ? cortoId(texto) : "Referencia interna";
        }

        return textoVisibleSeguro(texto);
    }

    function referenciaReserva(reserva) {
        if (!reserva) return "Reserva HAIKU";
        return [
            reserva.titular_nombre,
            reserva.codigo_haiku || reserva.cloudbeds_id
        ].filter(Boolean).join(" · ") || "Reserva HAIKU";
    }

    function referenciaEstadia(estadia) {
        if (!estadia) return "Estadía";
        const cabana = cabanaInfo(estadia.cabana_id);
        const partes = [];
        if (cabana?.numero) partes.push(`CAB ${cabana.numero}`);
        if (estadia.fecha_ingreso && estadia.fecha_salida) {
            partes.push(`${fechaCorta(estadia.fecha_ingreso)} → ${fechaCorta(estadia.fecha_salida)}`);
        }
        return partes.join(" · ") || "Estadía";
    }

    function categoriaEvento(evento) {
        const entidad = String(evento?.entidad_tipo || "");
        const tipo = String(evento?.tipo_evento || "");
        if (["reservas", "reserva"].includes(entidad)) {
            const estado = cambioTiene(evento, "estado_reserva")?.nuevo;
            if (estado === "hospedada") return "checkin";
            if (estado === "checked_out") return "checkout";
        }
        if (["reservas", "reserva", "reserva_estadias", "estadia_noches"].includes(entidad)) return "reserva";
        if (["pagos", "pago"].includes(entidad) || tipo === "finanzas") return "pago";
        if (["servicios", "servicio"].includes(entidad)) return "servicio";
        if (["cabanas", "cabana", "aseos", "revisiones_cabina"].includes(entidad)) return "cabana";
        if (entidad.includes("cierre") || entidad === "turnos" || tipo === "cierre_turno") return "cierre";
        return "sistema";
    }

    function cambioTiene(evento, campo) {
        return normalizarCambios(evento).find(c => c.campo === campo) || null;
    }

    function esTecnicoOcultoEnHistorial(evento) {
        const entidad = String(evento?.entidad_tipo || "");
        const tipo = String(evento?.tipo_evento || "");

        if (["reserva_estadias", "estadia_noches", "turnos", "cierres_turno"].includes(entidad)) {
            return ["creacion", "actualizacion", "eliminacion"].includes(tipo);
        }
        return false;
    }

    function tituloEstadoReserva(evento) {
        const cambio = cambioTiene(evento, "estado_reserva");
        if (!cambio) return "Estado de reserva actualizado";
        const nuevo = String(cambio.nuevo || "");
        const mapa = {
            confirmada: "Reserva confirmada",
            hospedada: "Check-in realizado",
            checked_out: "Check-out realizado",
            cancelada: "Reserva cancelada",
            no_show: "Reserva marcada No Show",
            pendiente: "Reserva dejada pendiente"
        };
        return mapa[nuevo] || "Estado de reserva actualizado";
    }

    function tituloBove(evento, campo, etiqueta) {
        const cambio = cambioTiene(evento, campo);
        if (!cambio) return `${etiqueta} actualizado`;
        if (!cambio.anterior && cambio.nuevo) return `${etiqueta} registrado`;
        if (cambio.anterior && !cambio.nuevo) return `${etiqueta} retirado`;
        return `${etiqueta} actualizado`;
    }

    function tituloHumano(evento) {
        const entidad = String(evento?.entidad_tipo || "");
        const tipo = String(evento?.tipo_evento || "");
        const pago = pagoInfo(evento);
        const servicio = servicioInfo(evento);

        if (tipo === "cierre_turno") {
            if (String(evento.accion).includes("reabr")) return "Cierre de turno reabierto";
            if (String(evento.accion).includes("cerr")) return "Cierre de turno realizado";
            return textoVisibleSeguro(evento.descripcion) || "Cierre de turno";
        }

        if (entidad === "reservas") {
            if (tipo === "creacion") return "Reserva creada";
            if (cambioTiene(evento, "bove_checkout")) return tituloBove(evento, "bove_checkout", "BOVE Check-out");
            if (cambioTiene(evento, "bove_cierre")) return tituloBove(evento, "bove_cierre", "BOVE alojamiento");
            if (cambioTiene(evento, "estado_reserva")) return tituloEstadoReserva(evento);
            return "Reserva actualizada";
        }

        if (entidad === "reserva_estadias") {
            if (cambioTiene(evento, "fecha_ingreso") || cambioTiene(evento, "fecha_salida")) {
                return "Fechas de estadía actualizadas";
            }
            if (cambioTiene(evento, "estado_estadia")) return "Estado de estadía actualizado";
            return tipo === "creacion" ? "Estadía creada" : "Estadía actualizada";
        }

        if (entidad === "estadia_noches") {
            return tipo === "creacion" ? "Noche de estadía creada" : "Tarifa de noche actualizada";
        }

        if (["pagos", "pago"].includes(entidad) || tipo === "finanzas") {
            const estado = cambioTiene(evento, "estado");
            const esWebpay = String(pago?.medio_pago || "").startsWith("webpay_");

            if (tipo === "creacion") {
                return esWebpay && pago?.estado === "pendiente_asociacion"
                    ? "WebPay pendiente registrado"
                    : "Pago registrado";
            }
            if (estado?.nuevo === "confirmado") {
                return esWebpay ? "WebPay asociado y confirmado" : "Pago confirmado";
            }
            if (tipo === "finanzas") {
                return textoVisibleSeguro(evento.descripcion) || "Movimiento financiero";
            }
            return esWebpay ? "WebPay actualizado" : "Pago actualizado";
        }

        if (["servicios", "servicio"].includes(entidad)) {
            const estado = cambioTiene(evento, "estado_servicio");
            if (tipo === "creacion") {
                const nombre = servicio?.catalogo_servicios?.nombre;
                return nombre ? `Servicio agregado · ${nombre}` : "Servicio agregado";
            }
            if (estado?.nuevo === "realizado") return "Servicio marcado realizado";
            if (estado?.nuevo === "cancelado") return "Servicio cancelado";
            return "Servicio actualizado";
        }

        if (entidad === "turnos") {
            if (cambioTiene(evento, "estado")) return "Estado del turno actualizado";
            return tipo === "creacion" ? "Turno creado" : "Turno actualizado";
        }

        if (entidad === "cierres_turno") {
            return tipo === "creacion" ? "Cierre preparado" : "Cierre actualizado";
        }

        if (tipo === "creacion") return "Registro creado";
        if (tipo === "actualizacion") return "Registro actualizado";
        if (tipo === "eliminacion") return "Registro eliminado";
        return textoVisibleSeguro(evento.descripcion) || textoEstado(evento.accion) || "Actividad registrada";
    }

    function limpioAccion(valor) {
        const texto = limpiar(valor);
        if (!texto) return "";
        const mapa = {
            reabrir_cierre: "Cierre de turno reabierto",
            cerrar_turno: "Cierre de turno realizado"
        };
        return mapa[texto] || texto.replaceAll("_", " ").replace(/^./, s => s.toUpperCase());
    }

    function tituloAuditoria(evento) {
        const humano = tituloHumano(evento);
        if (!["Registro creado", "Registro actualizado", "Registro eliminado", "Actividad registrada"].includes(humano)) {
            return humano;
        }
        return limpioAccion(evento.accion) || humano;
    }

    function descripcionHumana(evento) {
        const pago = pagoInfo(evento);
        const servicio = servicioInfo(evento);

        if (pago) {
            const partes = [dinero(pago.monto), medioPago(pago.medio_pago)];
            if (pago.etapa_operativa) partes.push(textoEstado(pago.etapa_operativa));
            return partes.filter(Boolean).join(" · ");
        }

        if (servicio) {
            const nombre = servicio.catalogo_servicios?.nombre || "Servicio";
            const partes = [nombre];
            if (Number(servicio.total || 0) > 0) partes.push(dinero(servicio.total));
            if (servicio.fecha_servicio) partes.push(fechaCorta(servicio.fecha_servicio));
            return partes.join(" · ");
        }

        if (String(evento?.tipo_evento || "") === "cierre_turno") {
            return textoVisibleSeguro(evento.descripcion);
        }

        return "";
    }

    function descripcionDetalle(evento, modoCard) {
        if (modoCard === "auditoria") {
            return textoVisibleSeguro(evento.descripcion) || descripcionHumana(evento);
        }

        const entidad = String(evento?.entidad_tipo || "");
        const pago = pagoInfo(evento);
        const servicio = servicioInfo(evento);

        if (pago) {
            return `${dinero(pago.monto)} · ${medioPago(pago.medio_pago)}${pago.etapa_operativa ? ` · ${textoEstado(pago.etapa_operativa)}` : ""}`;
        }
        if (servicio) {
            return `${servicio.catalogo_servicios?.nombre || "Servicio"} · ${dinero(servicio.total || 0)}${servicio.fecha_servicio ? ` · ${fechaCorta(servicio.fecha_servicio)}` : ""}`;
        }
        if (entidad === "reservas" && cambioTiene(evento, "bove_cierre")) {
            const c = cambioTiene(evento, "bove_cierre");
            return c?.nuevo ? `BOVE alojamiento: ${c.nuevo}` : "El BOVE de alojamiento fue retirado.";
        }
        if (entidad === "reservas" && cambioTiene(evento, "bove_checkout")) {
            const c = cambioTiene(evento, "bove_checkout");
            return c?.nuevo ? `BOVE Check-out: ${c.nuevo}` : "El BOVE Check-out fue retirado.";
        }
        if (String(evento?.tipo_evento || "") === "cierre_turno") {
            return textoVisibleSeguro(evento.descripcion);
        }
        if (entidad === "reservas" && String(evento.tipo_evento) === "creacion") {
            return "Reserva creada y registrada en HAIKU.";
        }
        return "";
    }

    function referenciaHumana(evento) {
        const reserva = reservaEvento(evento);
        const cabana = cabanaEvento(evento);
        const partes = [];

        if (cabana?.numero) partes.push(`CAB ${cabana.numero}`);
        if (reserva?.titular_nombre) partes.push(reserva.titular_nombre);
        if (reserva?.codigo_haiku) partes.push(reserva.codigo_haiku);
        else if (reserva?.cloudbeds_id) partes.push(reserva.cloudbeds_id);

        if (!partes.length && String(evento?.tipo_evento || "") === "cierre_turno") {
            const fecha = evento?.datos_contexto?.fecha_operativa;
            return fecha ? `Turno ${fechaCorta(fecha)}` : "Cierre de turno";
        }

        return partes.length ? partes.join(" · ") : "Actividad general";
    }

    function textoBuscable(evento) {
        const reserva = reservaEvento(evento);
        const cabana = cabanaEvento(evento);
        const pago = pagoInfo(evento);
        const servicio = servicioInfo(evento);

        return [
            evento.id,
            evento.accion,
            textoVisibleSeguro(evento.descripcion),
            evento.origen,
            evento.tipo_evento,
            evento.entidad_tipo,
            evento.entidad_id,
            evento.reserva_id,
            evento.estadia_id,
            evento.cabana_id,
            evento.turno_id,
            usuarioNombre(evento.usuario_id),
            reserva?.titular_nombre,
            reserva?.codigo_haiku,
            reserva?.cloudbeds_id,
            cabana?.numero,
            pago?.medio_pago,
            pago?.monto,
            servicio?.catalogo_servicios?.nombre,
            ...cambiosMostrables(evento, "auditoria").flatMap(c => [
                c.campo,
                valorHumano(c.anterior, c.campo, "auditoria"),
                valorHumano(c.nuevo, c.campo, "auditoria")
            ])
        ]
            .filter(v => v !== undefined && v !== null)
            .join(" ")
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CL");
    }

    function permisosLocales() {
        const sesion = window.haikuSesion || {};
        const roles = Array.isArray(sesion.roles) ? sesion.roles : [];
        const permisos = Array.isArray(sesion.permisos) ? sesion.permisos : [];
        const codigosRoles = roles.map(r =>
            String(typeof r === "string" ? r : (r?.codigo || r?.nombre || "")).toLowerCase()
        );
        const codigosPermisos = permisos.map(p =>
            String(typeof p === "string" ? p : (p?.codigo || p?.nombre || ""))
        );
        return {
            auditoria:
                codigosRoles.some(r => ["administrador", "manager"].includes(r)) ||
                codigosPermisos.includes("auditoria.ver")
        };
    }

    function sincronizarPermisos() {
        const auditoria = seccion.querySelector('[data-historial-modo="auditoria"]');
        if (!auditoria) return;
        auditoria.disabled = !permisosLocales().auditoria;
        auditoria.title = auditoria.disabled ? "Tu usuario no tiene permiso para ver la auditoría técnica" : "";
        if (auditoria.disabled && modo === "auditoria") modo = "historial";
    }

    function construirUI() {
        const legacyModal = document.getElementById("historial-reserva-modal");
        if (legacyModal) legacyModal.hidden = true;
        sincronizarPermisos();
        seccion.querySelector("[data-historial-refresh]")?.addEventListener("click", () => cargarEventos(true));

        seccion.querySelectorAll("[data-historial-modo]").forEach(btn => {
            btn.addEventListener("click", () => cambiarModo(btn.dataset.historialModo));
        });

        ["input", "change"].forEach(nombre => {
            seccion.addEventListener(nombre, event => {
                if (event.target?.matches?.(
                    "[data-historial-buscar],[data-historial-desde],[data-historial-hasta],[data-historial-tipo]"
                )) {
                    visibles = 14;
                    renderizar();
                }
            });
        });

        seccion.querySelector("[data-historial-limpiar]")?.addEventListener("click", () => {
            ["buscar", "desde", "hasta", "tipo"].forEach(campo => {
                const control = seccion.querySelector(`[data-historial-${campo}]`);
                if (control) control.value = "";
            });
            visibles = 14;
            renderizar();
            seccion.querySelector("[data-historial-buscar]")?.focus();
        });

        seccion.querySelector("[data-historial-mas]")?.addEventListener("click", () => {
            const totalFiltrado = eventosFiltrados().length;
            if (visibles < totalFiltrado) {
                visibles += 14;
                renderizar();
            } else if (eventos.length < totalExacto) {
                limite += 250;
                visibles += 14;
                cargarEventos(true);
            }
        });
    }

    async function consultaPorIds(tabla, select, ids) {
        if (!ids.length) return [];
        const { data, error } = await cliente.from(tabla).select(select).in("id", ids);
        if (error) {
            console.warn(`HAIKU · Historial no pudo enriquecer ${tabla}:`, error);
            return [];
        }
        return data || [];
    }

    async function enriquecer(lista) {
        const usuarioIds = idsUnicos(lista.map(e => e.usuario_id));
        const reservaIdsDirectos = idsUnicos(lista.map(e => e.reserva_id));
        const cabanaIdsDirectos = idsUnicos(lista.map(e => e.cabana_id));
        const pagoIds = idsUnicos(
            lista.filter(e => ["pago", "pagos"].includes(e.entidad_tipo)).map(e => e.entidad_id)
        );
        const servicioIds = idsUnicos(
            lista.filter(e => ["servicio", "servicios"].includes(e.entidad_tipo)).map(e => e.entidad_id)
        );
        const estadiaIds = idsUnicos([
            ...lista.map(e => e.estadia_id),
            ...lista.filter(e => e.entidad_tipo === "reserva_estadias").map(e => e.entidad_id)
        ]);

        const [usuarios, reservasA, cabanasA, pagos, servicios, estadias] = await Promise.all([
            consultaPorIds("usuarios", "id,nombre,apellido", usuarioIds),
            consultaPorIds("reservas", "id,codigo_haiku,cloudbeds_id,titular_nombre", reservaIdsDirectos),
            consultaPorIds("cabanas", "id,numero,nombre", cabanaIdsDirectos),
            consultaPorIds(
                "pagos",
                "id,reserva_id,monto,medio_pago,estado,etapa_operativa,tipo_movimiento,codigo_autorizacion,folio,bove,datos_origen",
                pagoIds
            ),
            consultaPorIds(
                "servicios",
                "id,reserva_id,estadia_id,total,estado_servicio,fecha_servicio,hora_inicio,tipo_cobro,catalogo_servicios(nombre,codigo)",
                servicioIds
            ),
            consultaPorIds(
                "reserva_estadias",
                "id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia",
                estadiaIds
            )
        ]);

        const reservaIdsExtra = idsUnicos([
            ...pagos.map(x => x.reserva_id),
            ...servicios.map(x => x.reserva_id),
            ...estadias.map(x => x.reserva_id)
        ].filter(id => !reservaIdsDirectos.includes(String(id))));

        const cabanaIdsExtra = idsUnicos(
            estadias.map(x => x.cabana_id)
                .filter(id => !cabanaIdsDirectos.includes(String(id)))
        );

        const [reservasB, cabanasB] = await Promise.all([
            consultaPorIds("reservas", "id,codigo_haiku,cloudbeds_id,titular_nombre", reservaIdsExtra),
            consultaPorIds("cabanas", "id,numero,nombre", cabanaIdsExtra)
        ]);

        contexto.usuarios = new Map(usuarios.map(x => [String(x.id), x]));
        contexto.reservas = new Map([...reservasA, ...reservasB].map(x => [String(x.id), x]));
        contexto.cabanas = new Map([...cabanasA, ...cabanasB].map(x => [String(x.id), x]));
        contexto.pagos = new Map(pagos.map(x => [String(x.id), x]));
        contexto.servicios = new Map(servicios.map(x => [String(x.id), x]));
        contexto.estadias = new Map(estadias.map(x => [String(x.id), x]));
    }

    async function cargarEventos(forzar = false) {
        if (cargando) return;

        if (!forzar && Date.now() - ultimaCarga < 1200) {
            renderizar();
            return;
        }

        const lista = seccion.querySelector("[data-historial-lista]");
        const boton = seccion.querySelector("[data-historial-refresh]");

        cargando = true;
        if (boton) boton.disabled = true;
        if (lista && eventos.length === 0) {
            lista.replaceChildren(elemento("p", "sites-history-loading", "Cargando actividad real…"));
        }

        try {
            const { data, error, count } = await cliente
                .from("eventos_auditoria")
                .select(
                    "id,usuario_id,accion,tipo_evento,entidad_tipo,entidad_id,reserva_id,estadia_id,cabana_id,turno_id,descripcion,cambios,datos_contexto,origen,creado_en",
                    { count: "exact" }
                )
                .order("creado_en", { ascending: false })
                .range(0, limite - 1);

            if (error) throw error;

            eventos = [...new Map((data || []).map(evento => [String(evento.id), evento])).values()]
                .sort((a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en) || String(b.id).localeCompare(String(a.id)));
            totalExacto = Number(count ?? eventos.length);
            await enriquecer(eventos);
            ultimaCarga = Date.now();
            errorCarga = "";
            renderizar();
        } catch (error) {
            console.error("HAIKU · No fue posible cargar historial Supabase:", error);
            errorCarga = error?.message?.includes("permission")
                ? "Tu usuario no tiene permiso para consultar la auditoría."
                : "No fue posible cargar el historial. Intenta actualizar nuevamente.";
            renderizar();
        } finally {
            cargando = false;
            if (boton) boton.disabled = false;
        }
    }

    function cambiarModo(nuevo) {
        if (!["historial", "auditoria"].includes(nuevo)) return;

        if (nuevo === "auditoria" && !permisosLocales().auditoria) {
            alert("Tu usuario no tiene permiso para ver la auditoría técnica.");
            return;
        }

        modo = nuevo;

        seccion.querySelectorAll("[data-historial-modo]").forEach(btn => {
            btn.setAttribute("aria-selected", String(btn.dataset.historialModo === modo));
        });

        renderizar();
    }

    function eventosFiltrados(origen = eventos, modoForzado = modo) {
        const buscar = normalizarBusqueda(
            seccion.querySelector("[data-historial-buscar]")?.value
        );
        const desde = seccion.querySelector("[data-historial-desde]")?.value || "";
        const hasta = seccion.querySelector("[data-historial-hasta]")?.value || "";
        const tipo = seccion.querySelector("[data-historial-tipo]")?.value || "";
        if (desde && hasta && desde > hasta) return [];

        return origen.filter(evento => {
            if (modoForzado === "historial" && esTecnicoOcultoEnHistorial(evento)) return false;

            const fecha = fechaLocal(evento.creado_en);
            if (desde && fecha < desde) return false;
            if (hasta && fecha > hasta) return false;
            if (tipo && categoriaEvento(evento) !== tipo) return false;
            if (buscar && !textoBuscable(evento).includes(buscar)) return false;

            return true;
        });
    }

    function campoSensible(campo) {
        return /token|secret|password|contrasena|contraseña|cookie|jwt|authorization|autorizacion_header|api.?key|credential|clave_privada|rut|telefono|correo|email/i.test(campo) ||
            ["datos_origen", "snapshot"].includes(String(campo));
    }

    function cambiosMostrables(evento, modoCard) {
        return normalizarCambios(evento).filter(c =>
            !campoSensible(c.campo) &&
            (modoCard !== "historial" || !CAMPOS_OCULTOS_HISTORIAL.has(c.campo))
        );
    }

    function categoriaTexto(categoria) {
        return ({ reserva: "Reserva", checkin: "Check-in", checkout: "Check-out", servicio: "Servicio", pago: "Pago", cabana: "Cabaña", cierre: "Cierre", sistema: "Sistema" })[categoria] || "Sistema";
    }

    function dato(titulo, valor) {
        const caja = elemento("div");
        caja.append(elemento("dt", "", titulo), elemento("dd", "", valor));
        return caja;
    }

    function crearCambios(evento, modoCard) {
        const cambios = cambiosMostrables(evento, modoCard);
        if (!cambios.length) return null;

        if (modoCard === "historial") {
            const cont = elemento("div", "sites-history-change-brief");
            cont.appendChild(elemento("strong", "", "Cambios"));
            cambios.forEach(c => {
                const fila = elemento("span", "");
                fila.append(elemento("span", "", `${nombreCampo(c.campo)}: `));
                fila.append(elemento("s", "", valorHumano(c.anterior, c.campo, modoCard)));
                fila.append(" → ", elemento("b", "", valorHumano(c.nuevo, c.campo, modoCard)));
                cont.appendChild(fila);
            });
            return cont;
        }

        const cont = elemento("div", "sites-history-diff");
        const cabecera = elemento("div", "sites-history-diff-head");
        ["Campo", "Antes", "Después"].forEach(t => cabecera.appendChild(elemento("span", "", t)));
        cont.appendChild(cabecera);
        cambios.forEach(c => {
            const fila = elemento("div", "sites-history-diff-row");
            fila.append(
                elemento("code", "", nombreCampo(c.campo)),
                elemento("span", "", valorHumano(c.anterior, c.campo, modoCard)),
                elemento("strong", "", valorHumano(c.nuevo, c.campo, modoCard))
            );
            cont.appendChild(fila);
        });
        return cont;
    }

    function crearCard(evento, modoCard = modo) {
        const categoria = categoriaEvento(evento);
        const card = elemento("details", `sites-history-event is-${categoria}${modoCard === "auditoria" ? " sites-history-audit-event" : ""}`);
        card.dataset.eventoId = String(evento.id);
        card.open = abiertos[modoCard]?.has(String(evento.id)) || false;
        card.addEventListener("toggle", () => {
            const grupo = abiertos[modoCard];
            if (card.open) grupo.add(String(evento.id));
            else grupo.delete(String(evento.id));
        });

        const resumen = elemento("summary");
        resumen.appendChild(elemento("time", "sites-history-time", horaLocal(evento.creado_en)));
        const rail = elemento("span", "sites-history-rail");
        rail.appendChild(elemento("i"));
        resumen.appendChild(rail);

        const principal = elemento("span", "sites-history-event-main");
        const linea = elemento("span", "sites-history-action-line");
        linea.append(
            elemento("strong", "", modoCard === "historial" ? tituloHumano(evento) : tituloAuditoria(evento)),
            elemento("span", `sites-history-kind is-${categoria}`, categoriaTexto(categoria))
        );
        principal.appendChild(linea);
        const contexto = modoCard === "auditoria"
            ? [nombreEntidad(evento.entidad_tipo), evento.entidad_id ? cortoId(evento.entidad_id) : "", referenciaHumana(evento)].filter(Boolean).join(" · ")
            : [referenciaHumana(evento), descripcionHumana(evento)].filter(Boolean).join(" · ");
        principal.appendChild(elemento("span", "sites-history-context", contexto));
        resumen.appendChild(principal);

        const actor = elemento("span", "sites-history-actor", usuarioNombre(evento.usuario_id));
        if (evento.origen) actor.appendChild(elemento("small", "", textoEstado(evento.origen)));
        resumen.append(actor, elemento("span", "sites-history-expand", "⌄"));
        card.appendChild(resumen);

        const detalle = elemento("div", "sites-history-detail-content");
        const descripcion = descripcionDetalle(evento, modoCard);
        if (descripcion) detalle.appendChild(elemento("p", "sites-history-description", descripcion));

        const reserva = reservaEvento(evento);
        const cabana = cabanaEvento(evento);
        const hechos = elemento("dl", modoCard === "auditoria" ? "sites-history-audit-facts" : "sites-history-detail-facts");
        if (modoCard === "historial") {
            hechos.append(
                dato("Ubicación / afectado", referenciaHumana(evento)),
                dato("Quién y origen", [usuarioNombre(evento.usuario_id), evento.origen ? textoEstado(evento.origen) : ""].filter(Boolean).join(" · ")),
                dato("Fecha y hora", fechaHora(evento.creado_en)),
                dato("Referencia", reserva?.codigo_haiku || reserva?.cloudbeds_id || cortoId(evento.id))
            );
        } else {
            hechos.append(
                dato("Operación", limpioAccion(evento.accion) || nombreTipoEvento(evento.tipo_evento)),
                dato("Entidad", nombreEntidad(evento.entidad_tipo)),
                dato("ID evento", limpiar(evento.id) || "—"),
                dato("ID entidad", limpiar(evento.entidad_id) || "—"),
                dato("Fecha y hora", fechaHora(evento.creado_en)),
                dato("Actor", usuarioNombre(evento.usuario_id))
            );
            if (evento.origen) hechos.appendChild(dato("Origen", textoEstado(evento.origen)));
            if (reserva) hechos.appendChild(dato("Reserva", referenciaReserva(reserva)));
            if (cabana?.numero) hechos.appendChild(dato("Cabaña", `CAB ${cabana.numero}`));
            if (evento.estadia_id) hechos.appendChild(dato("ID estadía", String(evento.estadia_id)));
            if (evento.turno_id) hechos.appendChild(dato("ID turno", String(evento.turno_id)));
            if (esUuid(evento.datos_contexto?.operacion_id)) hechos.appendChild(dato("ID operación", String(evento.datos_contexto.operacion_id)));
            if (evento.datos_contexto?.fecha_operativa) hechos.appendChild(dato("Fecha operativa", fechaCorta(evento.datos_contexto.fecha_operativa)));
        }
        detalle.appendChild(hechos);

        const cambios = crearCambios(evento, modoCard);
        if (cambios) {
            if (modoCard === "auditoria") detalle.appendChild(elemento("p", "sites-history-diff-title", "Cambios registrados"));
            detalle.appendChild(cambios);
        }
        card.appendChild(detalle);
        return card;
    }

    function pintarLista(contenedor, lista, modoCard, vacio) {
        contenedor.replaceChildren();
        if (!lista.length) {
            contenedor.appendChild(elemento("p", "sites-history-empty", vacio));
            return;
        }

        const grupos = new Map();
        lista.forEach(evento => {
            const fecha = fechaLocal(evento.creado_en) || "sin-fecha";
            if (!grupos.has(fecha)) grupos.set(fecha, []);
            grupos.get(fecha).push(evento);
        });
        grupos.forEach((filas, fecha) => {
            const grupo = elemento("section", "sites-history-date-group");
            const cabecera = elemento("header", "sites-history-date-heading");
            cabecera.append(
                elemento("h2", "", fecha === "sin-fecha" ? "Sin fecha" : fechaGrupo(fecha)),
                elemento("span", "", `${filas.length} ${filas.length === 1 ? "evento" : "eventos"}`)
            );
            const eventosGrupo = elemento("div", "sites-history-event-list");
            filas.forEach(evento => eventosGrupo.appendChild(crearCard(evento, modoCard)));
            grupo.append(cabecera, eventosGrupo);
            contenedor.appendChild(grupo);
        });
    }

    function actualizarOpcionesTipo() {
        const select = seccion.querySelector("[data-historial-tipo]");
        if (!select) return;
        const anterior = select.value;
        const categorias = [...new Set(eventos
            .filter(evento => modo === "auditoria" || !esTecnicoOcultoEnHistorial(evento))
            .map(categoriaEvento))]
            .sort((a, b) => categoriaTexto(a).localeCompare(categoriaTexto(b), "es-CL"));
        select.replaceChildren(new Option("Todos", ""), ...categorias.map(c => new Option(categoriaTexto(c), c)));
        select.value = categorias.includes(anterior) ? anterior : "";
    }

    function renderizar() {
        const listaEl = seccion.querySelector("[data-historial-lista]");
        const contador = seccion.querySelector("[data-historial-contador]");
        const fuente = seccion.querySelector("[data-historial-fuente]");
        const masWrap = seccion.querySelector("[data-historial-mas-wrap]");
        const mas = seccion.querySelector("[data-historial-mas]");
        const limpiar = seccion.querySelector("[data-historial-limpiar]");
        const error = seccion.querySelector("[data-historial-error]");
        if (!listaEl) return;

        actualizarOpcionesTipo();
        const desde = seccion.querySelector("[data-historial-desde]")?.value || "";
        const hasta = seccion.querySelector("[data-historial-hasta]")?.value || "";
        const rangoInvalido = Boolean(desde && hasta && desde > hasta);
        if (error) {
            error.hidden = !rangoInvalido && !errorCarga;
            error.textContent = rangoInvalido ? "La fecha «Desde» no puede ser posterior a «Hasta»." : errorCarga;
        }
        const filtrados = eventosFiltrados();
        const visiblesAhora = filtrados.slice(0, visibles);
        const filtrosActivos = ["buscar", "desde", "hasta", "tipo"].some(campo =>
            Boolean(seccion.querySelector(`[data-historial-${campo}]`)?.value)
        );
        if (limpiar) limpiar.hidden = !filtrosActivos;

        if (contador) contador.textContent = `${filtrados.length} ${filtrados.length === 1 ? "evento" : "eventos"} · ${visiblesAhora.length} visibles`;
        if (fuente) {
            const pendienteRemoto = totalExacto > eventos.length;
            fuente.textContent = pendienteRemoto
                ? `Filtrado entre ${eventos.length} de ${totalExacto} eventos cargados`
                : (modo === "historial" ? "Actividad operativa registrada" : "Registro técnico de auditoría");
        }
        pintarLista(
            listaEl, visiblesAhora, modo,
            rangoInvalido ? "Corrige el rango de fechas para consultar eventos." :
                (modo === "historial" ? "No hay actividad operativa para mostrar con estos filtros." : "No hay eventos de auditoría para mostrar con estos filtros.")
        );
        const quedanLocales = Math.max(0, filtrados.length - visiblesAhora.length);
        const quedanRemotos = Math.max(0, totalExacto - eventos.length);
        if (masWrap) masWrap.hidden = !quedanLocales && !quedanRemotos;
        if (mas) mas.textContent = quedanLocales
            ? `Mostrar más eventos · ${quedanLocales} restantes`
            : (quedanRemotos ? "Mostrar más eventos anteriores" : "Mostrar más eventos");
    }

    function asegurarModalReserva() {
        let modal = document.getElementById("sites-history-reservation-modal");
        if (modal) return modal;

        modal = elemento("div", "sites-history-modal");
        modal.id = "sites-history-reservation-modal";
        modal.hidden = true;
        modal.innerHTML = `
            <section class="sites-history-modal-card" role="dialog" aria-modal="true" aria-labelledby="sites-history-reservation-title">
                <header class="sites-history-modal-head">
                    <div>
                        <span class="sites-history-kicker">TRAZABILIDAD</span>
                        <h2 id="sites-history-reservation-title">Historial de la reserva</h2>
                        <p data-historial-reserva-meta>Preparando…</p>
                    </div>
                    <button type="button" data-historial-reserva-cerrar aria-label="Cerrar">×</button>
                </header>
                <div class="sites-history-modal-body">
                    <div data-historial-reserva-lista>
                        <p class="sites-history-loading">Cargando historial…</p>
                    </div>
                </div>
            </section>
        `;

        document.body.appendChild(modal);

        modal.querySelector("[data-historial-reserva-cerrar]")?.addEventListener(
            "click",
            () => cerrarModalReserva()
        );

        modal.addEventListener("click", event => {
            if (event.target === modal) cerrarModalReserva();
        });

        return modal;
    }

    function cerrarModalReserva() {
        const modal = document.getElementById("sites-history-reservation-modal");
        if (!modal) return;
        modal.hidden = true;
        document.body.style.overflow = "";
    }

    async function abrirHistorialReserva(reservaIdSolicitado = "", metaSolicitud = null) {
        const ficha = document.getElementById("ficha-reserva-modal");
        const reservaId = String(reservaIdSolicitado || ficha?.dataset.reservaId || "").trim();
        if (!reservaId) return;

        const modal = asegurarModalReserva();
        const listaEl = modal.querySelector("[data-historial-reserva-lista]");
        const meta = modal.querySelector("[data-historial-reserva-meta]");
        const titular = metaSolicitud
            ? String(metaSolicitud.titular || "").trim()
            : document.getElementById("ficha-huesped-titular")?.textContent?.trim() ||
                document.getElementById("ficha-reserva-titular")?.textContent?.trim() || "";
        const cabana = metaSolicitud
            ? String(metaSolicitud.cabana || "").trim()
            : ficha?.dataset.numeroCabana || "";

        if (meta) {
            meta.textContent = [
                cabana ? `CAB ${cabana}` : "",
                titular
            ].filter(Boolean).join(" · ") || "Reserva HAIKU";
        }

        if (listaEl) {
            listaEl.replaceChildren(elemento("p", "sites-history-loading", "Cargando historial de la reserva…"));
        }

        modal.hidden = false;
        document.body.style.overflow = "hidden";

        try {
            const { data, error } = await cliente
                .from("eventos_auditoria")
                .select(
                    "id,usuario_id,accion,tipo_evento,entidad_tipo,entidad_id,reserva_id,estadia_id,cabana_id,turno_id,descripcion,cambios,datos_contexto,origen,creado_en"
                )
                .eq("reserva_id", reservaId)
                .order("creado_en", { ascending: false })
                .limit(400);

            if (error) throw error;

            const lista = [...new Map((data || []).map(evento => [String(evento.id), evento])).values()]
                .sort((a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en) || String(b.id).localeCompare(String(a.id)));
            await enriquecer([...eventos, ...lista]);

            const visibles = lista.filter(e => !esTecnicoOcultoEnHistorial(e));

            pintarLista(
                listaEl,
                visibles,
                "historial",
                "Esta reserva todavía no tiene actividad registrada."
            );
        } catch (error) {
            console.error("HAIKU · No fue posible abrir historial de reserva:", error);

            if (listaEl) {
                listaEl.innerHTML = "";
                listaEl.appendChild(
                    elemento(
                        "p",
                        "sites-history-error",
                        "No fue posible cargar el historial de esta reserva."
                    )
                );
            }
        }
    }

    construirUI();
    asegurarModalReserva();

    document.addEventListener(
        "click",
        event => {
            const botonFicha = event.target?.closest?.("#ficha-reserva-historial");

            if (botonFicha) {
                event.preventDefault();
                event.stopImmediatePropagation();
                abrirHistorialReserva();
                return;
            }

            const enlace = event.target?.closest?.('[data-seccion="historial"]');
            if (enlace) setTimeout(() => cargarEventos(true), 70);
        },
        true
    );

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") cerrarModalReserva();
    });

    let visibleAnterior = seccion.classList.contains("activa");

    const observador = new MutationObserver(() => {
        const visible = seccion.classList.contains("activa") && !seccion.hidden;
        if (visible && !visibleAnterior) setTimeout(() => cargarEventos(true), 30);
        visibleAnterior = visible;
    });

    observador.observe(seccion, {
        attributes: true,
        attributeFilter: ["class", "hidden", "style"]
    });

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(() => {
            sincronizarPermisos();
            cambiarModo(modo);
            if (seccion.classList.contains("activa")) cargarEventos(true);
        }, 250);
    });

    setTimeout(() => {
        if (window.haikuSesion && seccion.classList.contains("activa")) {
            cargarEventos(true);
        }
    }, 700);

    window.HistorialSupabase = {
        cargar: () => cargarEventos(true),
        abrirReserva: abrirHistorialReserva,
        eventos: () => [...eventos]
    };

})();
