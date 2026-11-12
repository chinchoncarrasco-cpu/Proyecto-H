// Preparación y confirmación de órdenes operativas del chat.
(function (root) {
    "use strict";
    const L = root.HAIKU_ASISTENTE_LENGUAJE_V1;
    if (!L) return;

    const titulos = {
        editarReserva: "Editar reserva", estadoReserva: "Cambiar estado", editarPago: "Corregir pago",
        anularPago: "Anular registro de pago", reembolso: "Preparar reembolso", registrarDevolucion: "Registrar devolución",
        reprogramar: "Reprogramar servicio", agendaServicios: "Agenda de servicios", nota: "Agregar nota",
        aseo: "Registrar aseo", revision: "Estado de revisión", bloquear: "Bloquear cabaña",
        mensaje: "Preparar mensaje", cobrar: "Preparar solicitud de pago"
    };
    const cab = n => "CAB " + n;
    const fecha = v => v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—";
    const moneda = n => "$" + Number(n).toLocaleString("es-CL") + " CLP";
    const fechaChile = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" });
    const permisos = (...claves) => claves.every(k => root.haikuTienePermiso?.(k) === true);
    const usuario = () => root.haikuSesion?.auth?.id;
    const actual = () => root.haikuSupabase;
    const textoError = mensaje => { throw new Error(mensaje); };
    const datos = async consulta => {
        const { data, error } = await consulta;
        if (error) throw error;
        return data;
    };
    const rpc = (nombre, argumentos) => datos(actual().rpc(nombre, argumentos));
    const diaPago = p => p.fecha_pago ? fechaChile.format(new Date(p.fecha_pago)) : null;
    const minutos = h => Number(h?.slice(0, 2)) * 60 + Number(h?.slice(3, 5));
    const hora = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    const rango = (inicio, fin) => fecha(inicio) + " → " + fecha(fin);
    const agregarDia = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
    const diferenciaDias = (d, h) => (Date.parse(h) - Date.parse(d)) / 86400000;
    const normal = L.normalizar;
    const etiquetaEstado = {
        pendiente: "Pendiente", no_requiere: "No requiere", en_proceso: "En proceso",
        completado: "Completado", en_revision: "En revisión", lista: "Lista",
        "con-detalles": "Con detalles", con_detalles: "Con detalles"
    };
    const identidad = f => [f.reservas.titular_nombre, cab(f.cabanas.numero),
        rango(f.fecha_ingreso, f.fecha_salida)].join(" · ");
    const comparacion = (etiqueta, antes, despues) => [etiqueta, String(antes || "—") + " → " + String(despues)];
    const yaGuardado = texto => ({ detalle: texto });
    const aviso = (id, mensaje, modulo = "") => {
        const tareas = [
            () => root.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(),
            () => id && root.haikuRefrescarFichaSupabaseV2?.(id)
        ];
        if (modulo === "reservas") tareas.push(
            () => root.haikuSincronizarReservasSupabase?.(),
            () => root.HAIKU_RESERVAS_V1?.recargar?.(),
            () => root.HAIKU_CHECKOUT_RESUMEN_V2?.refrescar?.());
        if (modulo === "pagos" || modulo === "reservas")
            tareas.push(() => root.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada?.(mensaje));
        if (modulo === "servicios") tareas.push(() => root.HAIKU_SITES_SERVICIOS_V1?.refrescar?.());
        void Promise.allSettled(tareas.map(tarea => Promise.resolve().then(tarea)));
    };

    async function cabanaActiva(n) {
        const c = await datos(actual().from("cabanas").select("id,numero,precio_base").eq("numero", n).eq("activa", true).maybeSingle());
        if (!c?.id) textoError("No encontré esa cabaña activa.");
        return c;
    }

    async function leerFicha(f) {
        if (!permisos("reservas.ver") || typeof root.haikuLeerFichaSupabaseV2 !== "function") {
            textoError("Tu cuenta necesita permiso para abrir la ficha de esta reserva.");
        }
        const ficha = await root.haikuLeerFichaSupabaseV2(f.reserva_id);
        const e = ficha?.estadias?.find(x => x.id === f.id);
        if (ficha?.reserva?.id !== f.reserva_id || !e || Number(e.cabana_numero) !== Number(f.cabanas.numero) ||
            e.fecha_ingreso !== f.fecha_ingreso || e.fecha_salida !== f.fecha_salida ||
            ficha.reserva.titular_nombre !== f.reservas.titular_nombre) {
            textoError("La reserva cambió durante la búsqueda. Vuelve a pedir la acción.");
        }
        return { ficha, e };
    }

    function elegir(opciones, preparar, detalle) {
        if (!opciones.length) textoError("No encontré un registro compatible. Revisa la cabaña, la fecha y el titular.");
        if (opciones.length === 1) return preparar(opciones[0].dato);
        return { detalle, opciones: opciones.map(o => ({ etiqueta: o.etiqueta, cargar: () => preparar(o.dato) })) };
    }

    function conReserva(q, buscar, preparar) {
        return buscar(q).then(filas => elegir(filas.map(f => ({ dato: f, etiqueta: identidad(f) })),
            preparar, "Hay varias estadías. Elige la que corresponde."));
    }

    function totalTarifas(tarifas) {
        return Object.values(tarifas).reduce((suma, n) => suma + Number(n), 0);
    }

    function propuestaEdicion(f, ficha, filas, nuevo, detalle = "", base = null) {
        return { identidad: identidad(f), filas, detalle, etiqueta: "Guardar cambios",
            async guardar() {
                const esperado = { reserva: ficha.reserva, estadias: ficha.estadias, noches: ficha.noches,
                    huespedes: ficha.huespedes, saldo: ficha.saldo };
                const respuesta = await rpc("haiku_editar_reserva_asistente_v1", {
                    p_reserva_id: f.reserva_id, p_estadia_id: f.id, p_esperado: esperado,
                    p_datos: nuevo, p_tarifa_base: base?.precio_base ?? null
                });
                if (respuesta?.reserva_id !== f.reserva_id) textoError("Reabre la ficha para comprobar el resultado del cambio.");
                aviso(f.reserva_id, "edición de reserva desde Haku", "reservas");
                return respuesta.estado_operativo_reiniciado ? "Reserva guardada como Confirmada." : "Cambios de la reserva guardados.";
            } };
    }

    async function editarReserva(q, f) {
        if (!permisos("reservas.editar")) textoError("Tu cuenta necesita permiso para editar reservas.");
        const { ficha, e } = await leerFicha(f);
        const r = ficha.reserva;
        if (ficha.estadias.filter(s => !["cancelada", "no_show"].includes(s.estado_estadia)).length !== 1 ||
            ["cancelada", "no_show"].includes(e.estado_estadia) || ["cancelada", "no_show"].includes(r.estado_reserva)) {
            textoError("La edición directa requiere una sola estadía activa. Abre la ficha para revisar esta reserva.");
        }
        const huespedes = ficha.huespedes || [];
        const titular = huespedes.find(h => h.es_titular) || {};
        const contacto = {
            titular: ["titular_nombre", "Titular en esta reserva", r.titular_nombre],
            correo: ["correo_contacto", "Correo", r.correo_contacto || titular.correo],
            telefono: ["telefono_contacto", "Teléfono", r.telefono_contacto || titular.telefono]
        }[q.campo];
        if (contacto) {
            const [campo, etiqueta, anterior] = contacto;
            if (anterior === q.valor) return yaGuardado("La reserva ya tiene ese dato.");
            return propuestaEdicion(f, ficha, [comparacion(etiqueta, anterior, q.valor)], { campo, valor: q.valor });
        }
        if (q.campo === "ocupacion") {
            const campos = [["adultos","Adultos"],["ninos","Niños"],["mascotas","Mascotas"]];
            const nuevo = Object.fromEntries(campos.map(([k]) => [k, q.valor[k] ?? Number(e[k])]));
            const filas = campos.filter(([k]) => nuevo[k] !== Number(e[k]))
                .map(([k, nombre]) => comparacion(nombre, String(e[k]), nuevo[k]));
            if (!filas.length) return yaGuardado("La reserva ya tiene esa ocupación.");
            return propuestaEdicion(f, ficha, filas, { campo: "ocupacion", ...nuevo });
        }
        const full = e.tipo_estadia === "fullday";
        const tarifas = Object.fromEntries((ficha.noches || []).filter(n => n.estadia_id === e.id).map(n => [n.fecha, Number(n.tarifa)]));
        const nochesOriginales = diferenciaDias(e.fecha_ingreso, e.fecha_salida);
        const totalFull = full ? (ficha.cargos || []).filter(c => c.tipo_cargo === "alojamiento" && c.estado === "activo")
            .reduce((s, c) => s + Number(c.monto), 0) : null;
        if (full ? !Number.isSafeInteger(totalFull) || totalFull <= 0 :
            Object.keys(tarifas).length !== nochesOriginales || Object.values(tarifas).some(n => !Number.isSafeInteger(n) || n <= 0)) {
            textoError("No pude comprobar todas las tarifas de esta estadía. Revísalas en la ficha.");
        }

        const original = {
            cabana_numero: Number(e.cabana_numero),
            fecha_ingreso: e.fecha_ingreso, fecha_salida: e.fecha_salida, tipo_estadia: e.tipo_estadia,
            tarifas, tarifa_fullday: totalFull
        };
        const nuevo = { ...original, tarifas: { ...tarifas } };
        const campo = { ingreso: "fecha_ingreso", salida: "fecha_salida", cabana: "cabana_numero" }[q.campo];
        if (campo) nuevo[campo] = q.valor;
        if (q.campo === "fechas") {
            nuevo.fecha_ingreso = q.valor.desde;
            nuevo.fecha_salida = q.valor.hasta;
        }
        if (full && ["ingreso", "salida"].includes(q.campo)) {
            nuevo.fecha_ingreso = nuevo.fecha_salida = q.valor;
        }
        const noches = diferenciaDias(nuevo.fecha_ingreso, nuevo.fecha_salida);
        if (full ? noches !== 0 : noches < 1) textoError(full ? "Full Day requiere ingreso y salida el mismo día." : "La salida debe ser posterior al ingreso.");
        if (q.campo === "tarifa") {
            if (full) textoError("Esta estadía es Full Day. Pide el cambio del total de alojamiento.");
            if (q.noche && !Object.hasOwn(tarifas, q.noche)) textoError("La noche indicada no pertenece a la estadía.");
            for (const n of Object.keys(tarifas)) if (!q.noche || n === q.noche) nuevo.tarifas[n] = q.valor;
        }

        const cambioFechas = nuevo.fecha_ingreso !== original.fecha_ingreso || nuevo.fecha_salida !== original.fecha_salida;
        const cambioCabana = nuevo.cabana_numero !== original.cabana_numero;
        const estructura = cambioFechas || cambioCabana;
        let base;
        if (estructura) {
            base = await cabanaActiva(nuevo.cabana_numero);
            if (!full) {
                nuevo.tarifas = {};
                for (let i = 0; i < noches; i++) {
                    const dia = agregarDia(nuevo.fecha_ingreso, i);
                    nuevo.tarifas[dia] = tarifas[dia] || Number(base.precio_base);
                    if (!Number.isSafeInteger(nuevo.tarifas[dia]) || nuevo.tarifas[dia] <= 0) {
                        textoError("Falta la tarifa base de una de las noches nuevas.");
                    }
                }
            }
        }

        const filas = [];
        const escalar = (k, etiqueta, mostrar = String) => {
            if (original[k] !== nuevo[k]) filas.push(comparacion(etiqueta, original[k] ? mostrar(original[k]) : "—", mostrar(nuevo[k])));
        };
        if (cambioFechas) filas.push(comparacion("Estadía", rango(original.fecha_ingreso, original.fecha_salida), rango(nuevo.fecha_ingreso, nuevo.fecha_salida)));
        escalar("cabana_numero", "Cabaña", cab);
        if (q.campo === "tarifa" && JSON.stringify(nuevo.tarifas) !== JSON.stringify(tarifas)) {
            filas.push(q.noche ? comparacion("Noche del " + fecha(q.noche), moneda(tarifas[q.noche]), moneda(q.valor)) :
                ["Por noche", moneda(q.valor)]);
        }
        if (!filas.length) return yaGuardado("La reserva ya tiene esos datos.");
        const totalAnterior = full ? totalFull : totalTarifas(tarifas);
        const totalNuevo = full ? totalFull : totalTarifas(nuevo.tarifas);
        if (totalNuevo !== totalAnterior || estructura || q.campo === "tarifa") {
            filas.push(comparacion("Total alojamiento", moneda(totalAnterior), moneda(totalNuevo)));
        }
        const advertenciaEstado = estructura && (e.checkin_realizado_en || e.checkout_realizado_en ||
            ["hospedada", "checked_out"].includes(e.estado_estadia));
        return propuestaEdicion(f, ficha, filas, nuevo,
            advertenciaEstado ? "Proyecto H volverá a Confirmada y reiniciará el ingreso o la salida registrada." : "", base);
    }

    async function estadoReserva(q, f) {
        const manual = root.HAIKU_RESERVA_ESTADO_MANUAL_V1;
        if (!manual) textoError("Recarga Proyecto H para abrir el cambio de estado.");
        const { ficha, e } = await leerFicha(f);
        const anterior = manual.actual(ficha, e);
        const opciones = manual.opciones(ficha, e, permiso => permisos(permiso));
        if (q.estado === "reactivar" && anterior !== "cancelada") textoError("Esta reserva figura " + manual.etiqueta(anterior) + ".");
        const opcion = q.estado === "reactivar" ?
            opciones.find(x => ["confirmada", "pendiente"].includes(x.valor) && !x.motivo) :
            opciones.find(x => x.valor === q.estado);
        if (opcion?.actual) return yaGuardado("La reserva ya figura " + opcion.etiqueta + ".");
        if (!opcion || opcion.motivo) textoError(opcion?.motivo || "La reserva requiere revisar abonos, fechas y disponibilidad para reactivarla.");
        return { identidad: identidad(f), filas: [comparacion("Estado", manual.etiqueta(anterior), opcion.etiqueta)],
            detalle: manual.aviso(ficha, e, opcion.valor),
            etiqueta: { cancelada: "Confirmar cancelación", checked_out: "Confirmar check-out", no_show: "Confirmar No Show" }[opcion.valor] ||
                (q.estado === "reactivar" ? "Confirmar reactivación" : "Confirmar estado"),
            async guardar() {
                const resultado = await rpc("haiku_cambiar_estado_reserva_manual_v1", {
                    p_reserva_id: f.reserva_id, p_estadia_id: f.id, p_estado: opcion.valor, p_esperado: manual.esperado(ficha)
                });
                if (resultado?.ok !== true || resultado.estado !== opcion.valor) textoError("Reabre la ficha para comprobar el estado guardado.");
                aviso(f.reserva_id, "estado de reserva desde Haku", "reservas");
                return "Estado guardado · " + opcion.etiqueta + ".";
            } };
    }

    const columnasPago = "id,reserva_id,pago_grupo_id,fecha_pago,estado,etapa_operativa,tipo_movimiento,medio_pago,monto,moneda,folio,codigo_autorizacion,bove,referencia_externa,actualizado_en";
    const medios = { transferencia: "Transferencia", efectivo: "Efectivo", tarjeta_credito: "Tarjeta crédito", tarjeta_debito: "Tarjeta débito",
        webpay_credito: "WebPay crédito", webpay_debito: "WebPay débito", airbnb_prepaid_card: "Airbnb Prepaid Card", otro: "Otro" };
    const nombrePago = p => [moneda(p.monto), medios[p.medio_pago] || p.medio_pago, fecha(diaPago(p)),
        p.folio && "Folio " + p.folio, p.codigo_autorizacion && "CodAut " + p.codigo_autorizacion, p.referencia_externa].filter(Boolean).join(" · ");

    async function prepararPago(q, f) {
        let consulta = actual().from("pagos").select(columnasPago).eq("tipo_movimiento", "pago");
        if (f) consulta = consulta.eq("reserva_id", f.reserva_id).eq("estado", "confirmado");
        else consulta = consulta.is("reserva_id", null).eq("estado", "pendiente_asociacion")
            .in("medio_pago", ["webpay_credito", "webpay_debito"]);
        if (q.referencia) consulta = consulta.eq(q.campoRef, q.referencia);
        if (q.monto) consulta = consulta.eq("monto", q.monto);
        const pagos = (await datos(consulta.order("id").limit(101)) || []).filter(p => !q.diaPago || diaPago(p) === q.diaPago);
        if (pagos.length > 100) textoError("Indica el folio, la referencia o la fecha del pago.");
        return elegir(pagos.map(p => ({ dato: p, etiqueta: nombrePago(p) })), p => operacionPago(q, p, f),
            "Hay varios pagos. Elige el comprobante que quieres usar.");
    }

    function operacionPago(q, p, f) {
        const id = f ? identidad(f) : "WebPay pendiente de asociación";
        const filas = [["Pago", nombrePago(p)]];
        const esCLP = p.moneda === "CLP";
        if (q.accion === "reembolso") {
            const detalle = ["Solicitud de reembolso", id, nombrePago(p), q.motivo && "Motivo: " + q.motivo].filter(Boolean).join("\n");
            return { identidad: id, filas, detalle: "Procesa la devolución en el medio original. Con el comprobante, pide «registra devolución» para dejarla en Proyecto H.",
                copiar: detalle, etiqueta: "Copiar datos del reembolso" };
        }
        if (!esCLP) textoError("El pago requiere revisión en su moneda original.");
        const anular = q.accion === "anularPago";
        const devolucion = q.accion === "registrarDevolucion";
        if (p.pago_grupo_id) textoError("Es un pago conjunto. Abre Pagos por titular para revisar el movimiento y su distribución.");
        if (anular && f && !q.motivo) textoError("Indica por qué se anula el registro. Añade «motivo:» al final de la orden.");
        if (anular && !f) return { identidad: id, filas, detalle: "Se anulará el registro pendiente de asociación.", etiqueta: "Anular WebPay pendiente",
            async guardar() {
                const r = await rpc("haiku_anular_webpay_pendiente", { p_pago_id: p.id });
                if (r?.estado !== "anulado") textoError("Comprueba el estado en WebPay pendientes.");
                aviso(null, "WebPay pendiente anulado desde Haku", "pagos");
                return "Registro WebPay anulado.";
            } };
        let etiqueta = "Anular registro";
        if (devolucion) {
            filas.push(["Devolución completa", [moneda(p.monto), fecha(q.fechaDevolucion), medios[q.medio], q.comprobante].join(" · ")]);
            etiqueta = "Registrar devolución realizada";
        }
        if (q.accion === "editarPago") {
            if (!q.cambio || !Object.keys(q.cambio).length) textoError("Indica el cambio. Ejemplo: corrige el abono folio 123 de CAB 3 hoy a $90.000.");
            if (p.etapa_operativa !== "abono" && (q.cambio.monto != null || q.cambio.fecha_pago != null)) {
                textoError("La corrección de monto o fecha está disponible para abonos. En un saldo puedes corregir el medio o sus referencias.");
            }
            const nombres = { monto: "Monto", fecha_pago: "Fecha del pago", medio_pago: "Medio",
                folio: "Folio", bove: "BOVTAR", referencia_externa: "Referencia", codigo_autorizacion: "CodAut" };
            for (const [k, v] of Object.entries(q.cambio)) {
                const mostrar = k === "monto" ? moneda : k === "medio_pago" ? m => medios[m] : k === "fecha_pago" ? fecha : String;
                const valor = k === "fecha_pago" ? diaPago(p) : p[k];
                if (String(valor ?? "") !== String(v)) filas.push(comparacion(nombres[k], valor ? mostrar(valor) : "—", mostrar(v)));
            }
            if (filas.length === 1) return yaGuardado("El pago ya tiene esos datos.");
            etiqueta = "Guardar corrección";
        }
        return { identidad: id, filas, etiqueta, detalle: q.motivo ? "Motivo: " + q.motivo : "",
            async guardar() {
                const r = await rpc("haiku_pago_asistente_v1", { p_pago_id: p.id, p_version: p.actualizado_en,
                    p_accion: anular ? "anular" : devolucion ? "devolucion" : "corregir",
                    p_datos: devolucion ? { fecha_pago: q.fechaDevolucion, medio_pago: q.medio, comprobante: q.comprobante } : q.cambio || {},
                    p_motivo: q.motivo || null });
                if (r?.ok !== true || r.pago_id !== p.id) textoError("Comprueba el movimiento en Pagos.");
                aviso(f.reserva_id, etiqueta + " desde Haku", "pagos");
                return anular ? "Registro anulado en Proyecto H." :
                    devolucion ? "Devolución registrada en Proyecto H." : "Corrección del pago guardada.";
            } };
    }

    const columnasServicio = "id,estadia_id,reserva_id,recurso_id,fecha_servicio,hora_inicio,hora_fin,estado_servicio,actualizado_en,total,catalogo_servicios!inner(codigo,nombre,categoria)";
    function coincideServicio(s, pedido) {
        const { codigo, categoria, nombre } = s.catalogo_servicios;
        if (pedido === "servicio") return true;
        if (/tonel/.test(pedido)) return codigo === "tinajaTonel";
        if (/jacuzzi/.test(pedido)) return codigo === "tinajaJacuzzi";
        if (/tinaja/.test(pedido)) return categoria === "tinaja";
        if (/^late/.test(pedido)) return codigo === "lateCheckout";
        if (/^early/.test(pedido)) return codigo === "earlyCheckin";
        return categoria === "masaje" && ["terapeutico", "descontracturante", "30", "60"]
            .every(t => !pedido.includes(t) || normal(nombre).includes(t));
    }

    async function reprogramar(q, buscar) {
        if (!permisos("servicios.ver", "servicios.editar", "reservas.ver")) textoError("Tu cuenta necesita permiso para editar servicios.");
        const destinos = await buscar({ ...q, modoFecha: q.modoFecha === "estadia" ? "incluyeSalida" : q.modoFecha });
        if (!destinos.length) textoError("No encontré la estadía del servicio.");
        const porId = new Map(destinos.map(f => [f.id, f]));
        const filas = await datos(actual().from("servicios").select(columnasServicio)
            .in("estadia_id", [...porId.keys()]).eq("fecha_servicio", q.fecha).eq("estado_servicio", "programado").order("hora_inicio"));
        const opciones = (filas || []).filter(s => s.reserva_id === porId.get(s.estadia_id)?.reserva_id &&
            coincideServicio(s, q.servicio) && (!q.horaOriginal || s.hora_inicio?.slice(0, 5) === q.horaOriginal));
        if (!opciones.length) textoError("No encontré un servicio programado con esos datos.");
        return elegir(opciones.map(s => ({ dato: s, etiqueta: [s.catalogo_servicios.nombre, s.hora_inicio?.slice(0, 5), identidad(porId.get(s.estadia_id))].filter(Boolean).join(" · ") })),
            s => propuestaServicio(q, s, porId.get(s.estadia_id)), "Elige el servicio que quieres mover.");
    }

    function propuestaServicio(q, s, f) {
        const nuevoDia = q.nuevo.fecha || s.fecha_servicio;
        const inicio = q.nuevo.hora || s.hora_inicio?.slice(0, 5);
        if (nuevoDia < f.fecha_ingreso || nuevoDia > f.fecha_salida) textoError("El servicio debe quedar dentro de la estadía, incluido el día de salida.");
        if (q.nuevo.hora && !s.hora_inicio) textoError("El servicio no tiene una duración registrada. Revisa su horario.");
        const duracion = s.hora_inicio ? minutos(s.hora_fin) - minutos(s.hora_inicio) : 0;
        const finMinutos = inicio ? minutos(inicio) + duracion : 0;
        if (inicio && (duracion <= 0 || finMinutos >= 1440)) textoError("La hora nueva debe permitir que el servicio termine el mismo día.");
        const fin = inicio ? hora(finMinutos) : null;
        if (nuevoDia === s.fecha_servicio && inicio === s.hora_inicio?.slice(0, 5)) return yaGuardado("El servicio ya está en ese horario.");
        const mostrar = (d, h, f) => [fecha(d), h && h.slice(0, 5) + "–" + f.slice(0, 5)].filter(Boolean).join(" · ");
        return { identidad: identidad(f), filas: [["Servicio", s.catalogo_servicios.nombre],
            comparacion("Fecha y horario", mostrar(s.fecha_servicio, s.hora_inicio, s.hora_fin), mostrar(nuevoDia, inicio, fin))],
            detalle: "Se mantiene el importe registrado de " + moneda(s.total) + ".", etiqueta: "Confirmar horario",
            async guardar() {
                const r = await rpc("haiku_reprogramar_servicio_asistente_v1", {
                    p_servicio_id: s.id, p_estadia_id: f.id, p_version: s.actualizado_en, p_fecha: nuevoDia, p_hora: inicio || null
                });
                if (r?.servicio_id !== s.id || r.fecha_servicio !== nuevoDia) textoError("Comprueba el horario en Servicios.");
                aviso(f.reserva_id, "servicio reprogramado desde Haku", "servicios");
                return "Servicio reprogramado · " + mostrar(nuevoDia, inicio, fin) + ".";
            } };
    }

    async function agenda(q, buscar) {
        if (!permisos("servicios.ver")) textoError("Tu cuenta necesita permiso para ver servicios.");
        let consulta = actual().from("servicios").select(columnasServicio).eq("fecha_servicio", q.fecha)
            .in("estado_servicio", ["programado", "en_proceso", "realizado"]).order("hora_inicio");
        if (q.cabana) {
            const estadias = await buscar({ ...q, modoFecha: "incluyeSalida" });
            if (!estadias.length) return yaGuardado("No encontré una estadía de esa cabaña para ese día.");
            consulta = consulta.in("estadia_id", estadias.map(e => e.id));
        }
        const servicios = await datos(consulta);
        const seleccion = (servicios || []).filter(s => q.soloMasajes ? s.catalogo_servicios.categoria === "masaje" : s.hora_inicio);
        return { identidad: [q.cabana && cab(q.cabana), fecha(q.fecha)].filter(Boolean).join(" · "),
            filas: seleccion.map(s => [s.hora_inicio ? s.hora_inicio.slice(0, 5) + "–" + s.hora_fin.slice(0, 5) : "Sin hora", s.catalogo_servicios.nombre]),
            detalle: (seleccion.length ? "" : "La agenda no tiene servicios con esos datos. ") +
                "Confirma los horarios libres de masaje con el profesional. Proyecto H registra las citas." };
    }

    async function guardarNota(q, f) {
        if (!permisos("notas.gestionar", "notas.ver")) textoError("Tu cuenta necesita permiso para guardar notas.");
        const api = root.HAIKU_NOTAS_RESUMEN_SUPABASE_V1;
        if (!api?.guardar) textoError("Recarga Proyecto H para abrir Notas.");
        const c = await cabanaActiva(f?.cabanas.numero || q.cabana);
        if (f) await leerFicha(f);
        return { identidad: f ? identidad(f) : cab(c.numero) + " · " + fecha(q.fecha), texto: q.texto, etiqueta: "Guardar nota",
            async guardar() {
                if (f) await leerFicha(f);
                const nota = await api.guardar({ fecha: q.fecha, numeroCabana: c.numero, texto: q.texto,
                    reservaId: f?.reserva_id || null, estadiaId: f?.id || null, cabanaIdEsperada: c.id });
                if (!nota?.id) textoError("Comprueba la nota en el Resumen.");
                aviso(f?.reserva_id, "nota guardada desde Haku");
                void api.refrescar?.(q.fecha).catch(() => {});
                return "Nota guardada.";
            } };
    }

    async function bloqueo(q) {
        if (!permisos("cabanas.bloquear")) textoError("Tu cuenta necesita permiso para bloquear cabañas.");
        const c = await cabanaActiva(q.cabana);
        return { identidad: cab(c.numero), filas: [["Bloqueada desde", fecha(q.desde)], ["Disponible desde", fecha(q.hasta)]],
            detalle: q.motivo || "Bloqueo de calendario.", etiqueta: "Confirmar bloqueo",
            async guardar() {
                const r = await rpc("haiku_registrar_bloqueo_calendario", { p_cabana_numero: c.numero,
                    p_desde: q.desde, p_hasta: q.hasta, p_motivo: q.motivo || null });
                if (!r?.bloqueo_id) textoError("Comprueba el bloqueo en Calendario.");
                void root.HAIKU_BLOQUEOS_CALENDARIO_SUPABASE_V1?.refrescar?.()?.catch(() => {});
                aviso(null, "bloqueo de calendario desde Haku");
                return r.ya_existia ? "La cabaña ya estaba bloqueada en ese rango." : "Bloqueo guardado.";
            } };
    }

    async function guardarFila(tabla, anterior, destino, parche) {
        const consulta = anterior ? actual().from(tabla).update(parche)
            .eq("id", anterior.id).eq("actualizado_en", anterior.actualizado_en) :
            actual().from(tabla).insert({ ...destino, ...parche });
        const resultado = await datos(consulta.select("id").maybeSingle());
        if (!resultado?.id) textoError("El registro cambió antes de guardar. Vuelve a pedir la acción.");
    }

    async function aseo(q) {
        if (!permisos("aseos.gestionar_todos") && !permisos("aseos.gestionar_asignados")) textoError("Tu cuenta necesita permiso para registrar aseo.");
        const c = await cabanaActiva(q.cabana);
        const a = await datos(actual().from("aseos").select("id,estado,tipo_aseo,iniciado_en,completado_en,encargado_nombre,actualizado_en,asignado_a")
            .eq("cabana_id", c.id).eq("fecha", q.fecha).maybeSingle());
        if (!permisos("aseos.gestionar_todos") && a?.asignado_a !== usuario()) textoError("La cabaña requiere un aseo asignado a tu cuenta.");
        if (a?.estado === "cancelado" || a?.tipo_aseo === "express") textoError("Este aseo tiene un ciclo especial. Revísalo desde Cabañas.");
        const api = root.HAIKU_ASEO_OPERACION_V1;
        if (!api?.fechaHoraSantiagoAISO) textoError("Recarga Proyecto H para registrar las horas de aseo.");
        const parche = {};
        if (q.campos.in) parche.iniciado_en = api.fechaHoraSantiagoAISO(q.fecha, q.campos.in);
        if (q.campos.out) parche.completado_en = api.fechaHoraSantiagoAISO(q.fecha, q.campos.out);
        if (q.campos.encargado_nombre) parche.encargado_nombre = q.campos.encargado_nombre;
        const desde = parche.iniciado_en || a?.iniciado_en;
        const hasta = parche.completado_en || a?.completado_en;
        if (hasta && (!desde || Date.parse(hasta) < Date.parse(desde))) textoError("Registra IN antes de OUT y revisa el orden de las horas.");
        if (q.estado && (desde || hasta)) textoError("Este aseo ya tiene horas registradas. Revisa el ciclo en Cabañas.");
        if (a?.estado === "no_requiere" && (desde || hasta)) textoError("El aseo figura No requiere. Cámbialo a Pendiente antes de registrar horas.");
        parche.estado = q.estado || (hasta ? "completado" : desde ? "en_proceso" : a?.estado || "pendiente");
        const filas = [];
        if (parche.estado !== (a?.estado || "pendiente")) filas.push(comparacion("Estado", etiquetaEstado[a?.estado || "pendiente"], etiquetaEstado[parche.estado]));
        if (q.campos.in && q.campos.in !== api.horaSantiago(a?.iniciado_en)) filas.push(comparacion("IN", api.horaSantiago(a?.iniciado_en), q.campos.in));
        if (q.campos.out && q.campos.out !== api.horaSantiago(a?.completado_en)) filas.push(comparacion("OUT", api.horaSantiago(a?.completado_en), q.campos.out));
        if (q.campos.encargado_nombre && q.campos.encargado_nombre !== a?.encargado_nombre) filas.push(comparacion("Encargado", a?.encargado_nombre, q.campos.encargado_nombre));
        if (!filas.length) return yaGuardado("El aseo ya figura con esos datos.");
        return { identidad: cab(c.numero) + " · " + fecha(q.fecha), filas, etiqueta: "Guardar aseo",
            async guardar() {
                await guardarFila("aseos", a, { cabana_id: c.id, fecha: q.fecha, tipo_aseo: "salida", creado_por: usuario() }, parche);
                void api.hidratar?.(q.fecha)?.catch(() => {});
                aviso(null, "aseo desde Haku");
                return "Aseo guardado.";
            } };
    }

    async function revision(q) {
        if (!permisos("revisiones.ver", "revisiones.gestionar")) textoError("Tu cuenta necesita permiso para registrar revisiones.");
        const c = await cabanaActiva(q.cabana);
        const revisiones = await datos(actual().from("revisiones_cabana")
            .select("id,actualizado_en,tipo_revision,es_repaso,estado,resultado,iniciado_en")
            .eq("cabana_id", c.id).eq("fecha", q.fecha).in("tipo_revision", ["completa", "repaso", "aseo_express"])
            .neq("estado", "cancelada").order("creado_en", { ascending: false }));
        const modalidad = r => r.es_repaso ? "repaso" : r.tipo_revision === "aseo_express" ? "express" : r.tipo_revision;
        const seleccion = (revisiones || []).filter(r => !q.modalidad || modalidad(r) === q.modalidad);
        if (q.modalidad && !seleccion.length &&
            (q.modalidad === "express" || q.modalidad === "completa" && revisiones?.some(r => r.tipo_revision === "completa"))) {
            textoError("No encontré un ciclo de " + q.modalidad + " para esa cabaña y día. Revísalo en Cabañas.");
        }
        if (!seleccion.length && ["lista", "con-detalles"].includes(q.estado)) {
            textoError("Inicia la revisión de esa cabaña antes de marcarla lista o con detalles.");
        }
        const modoInicial = q.modalidad || "completa";
        return elegir((seleccion.length ? seleccion : [null]).map(r => ({ dato: r, etiqueta: "Revisión " + (r ? modalidad(r) : modoInicial) })),
            r => {
                const modo = r ? modalidad(r) : modoInicial;
                if (r?.estado === "cancelada") textoError("La revisión está cancelada. Ábrela desde Cabañas.");
                const resultado = { lista: "lista", "con-detalles": "con_detalles" }[q.estado] || null;
                const estado = resultado ? "completada" : q.estado === "pendiente" ? "pendiente" : "en_proceso";
                const anterior = r?.resultado || (r?.estado === "en_proceso" ? "en_revision" : r?.estado) || "pendiente";
                if (r?.estado === estado && r?.resultado === resultado) return yaGuardado("La revisión ya figura " + etiquetaEstado[q.estado] + ".");
                return { identidad: cab(c.numero) + " · " + fecha(q.fecha), filas: [["Revisión", modo],
                    comparacion("Estado", etiquetaEstado[anterior] || anterior, etiquetaEstado[q.estado])],
                    etiqueta: "Guardar estado",
                    async guardar() {
                        await guardarFila("revisiones_cabana", r, { cabana_id: c.id, fecha: q.fecha, tipo_revision: modoInicial },
                            { estado, resultado, finalizado_en: resultado ? new Date().toISOString() : null, revisado_por: usuario() });
                        void root.HAIKU_REVISION_RESUMEN_SYNC_V2?.resincronizar?.();
                        aviso(null, "revisión desde Haku");
                        return "Estado de revisión guardado.";
                    } };
            }, "Elige el ciclo de revisión.");
    }

    function telefonoContacto(valor) {
        const t = String(valor || "").trim();
        if (!/^[+\d][\d ()-]+$/.test(t)) return null;
        const n = t.replace(/\D/g, "");
        return t.startsWith("+") && /^[1-9]\d{7,14}$/.test(n) || /^569\d{8}$/.test(n) ?
            n : /^9\d{8}$/.test(n) ? "56" + n : null;
    }

    async function mensaje(q, f) {
        const { ficha } = await leerFicha(f);
        const r = ficha.reserva, titular = (ficha.huespedes || []).find(h => h.es_titular);
        const cobro = q.accion === "cobrar";
        const saldo = Number(ficha.saldo?.saldo);
        if (cobro && (!Number.isSafeInteger(saldo) || saldo <= 0)) return yaGuardado("La ficha no acredita un saldo pendiente para esta reserva.");
        const texto = cobro ? "Hola " + r.titular_nombre + ", te escribimos de Haiku Cabañas. Tu reserva en " +
            cab(f.cabanas.numero) + " (" + rango(f.fecha_ingreso, f.fecha_salida) + ") tiene un saldo pendiente de " + moneda(saldo) +
            ". Cuando realices el pago, envíanos el comprobante. Gracias." : q.texto;
        const correo = String(r.correo_contacto || titular?.correo || "").trim();
        const telefono = telefonoContacto(r.telefono_contacto || titular?.telefono);
        const porCorreo = q.canal === "correo";
        const url = porCorreo ?
            (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(correo) ?
                "mailto:" + encodeURIComponent(correo).replace("%40", "@") + "?subject=" +
                encodeURIComponent("Tu reserva en Haiku Cabañas") + "&body=" + encodeURIComponent(texto) : null) :
            (telefono ? "https://wa.me/" + telefono + "?text=" + encodeURIComponent(texto) : null);
        return { identidad: identidad(f), texto, copiar: texto, etiqueta: "Copiar texto",
            filas: url ? [[porCorreo ? "Correo" : "WhatsApp", porCorreo ? correo : "+" + telefono]] : [],
            detalle: url ? "Revisa y envía el mensaje desde " + (porCorreo ? "tu correo." : "WhatsApp.") :
                "La ficha no tiene un contacto válido para ese canal. Puedes copiar el texto.",
            enlace: url ? { url, etiqueta: porCorreo ? "Abrir correo" : "Abrir WhatsApp" } : null };
    }

    const pagos = ["editarPago", "anularPago", "reembolso", "registrarDevolucion"];
    async function preparar(q, buscar) {
        if (!usuario() || !actual()) textoError("Inicia sesión en Proyecto H para realizar esta acción.");
        switch (q.accion) {
            case "editarReserva": return conReserva(q, buscar, f => editarReserva(q, f));
            case "estadoReserva": return conReserva(q, buscar, f => estadoReserva(q, f));
            case "reprogramar": return reprogramar(q, buscar);
            case "agendaServicios": return agenda(q, buscar);
            case "bloquear": return bloqueo(q);
            case "aseo": return aseo(q);
            case "revision": return revision(q);
            case "nota": return q.asociar ? conReserva(q, buscar, f => guardarNota(q, f)) : guardarNota(q, null);
            case "cobrar":
            case "mensaje": return conReserva(q, buscar, f => mensaje(q, f));
            default:
                if (!pagos.includes(q.accion)) textoError("Acción no disponible.");
                if (!permisos("pagos.ver") || q.accion === "editarPago" && !permisos("pagos.registrar",
                    q.cambio?.monto != null || q.cambio?.fecha_pago != null ? "pagos.anular" : "pagos.verificar") ||
                    q.accion === "anularPago" && !permisos("pagos.anular") ||
                    q.accion === "registrarDevolucion" && !permisos("pagos.reembolsar")) {
                    textoError("Tu cuenta necesita permiso para esta acción de pagos.");
                }
                return q.webpay && q.accion === "anularPago" && !q.cabana && !q.titular && !q.codigo ?
                    prepararPago(q, null) : conReserva(q, buscar, f => prepararPago(q, f));
        }
    }

    root.HAIKU_ASISTENTE_OPERACIONES_SUPABASE_V1 = Object.freeze({ preparar, titulos, usuario });
})(typeof window === "undefined" ? globalThis : window);
