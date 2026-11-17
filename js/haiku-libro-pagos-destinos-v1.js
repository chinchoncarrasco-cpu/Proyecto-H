/* Haku Libro: resolución pura de aplicaciones de servicios contra cargos reales. */
(function (root) {
    "use strict";

    const normalizar = valor => String(valor ?? "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

    function conceptoCanon(valor) {
        const texto = normalizar(valor);
        if (!texto) return null;
        const alimentos = ['queque', 'pan', 'huevos'].filter(concepto =>
            new RegExp(`\\b${concepto === 'huevos' ? 'huevos?' : concepto}\\b`).test(texto));
        if (alimentos.length) {
            const otroServicio = /\blate\s*(?:check\s*)?out\b|\blateout\b|\bearly\s*(?:check\s*)?in\b|\bearlyin\b|\bcama\s+adicional\b|\blena\b|\bmasaj|\btonel\b|\bjacuzzi\b|\btinaja\b|\bcuna\b/.test(texto);
            return alimentos.length === 1 && !otroServicio ? alimentos[0] : null;
        }
        if (/\blate\s*(?:check\s*)?out\b|\blateout\b/.test(texto)) return "late_checkout";
        if (/\bearly\s*(?:check\s*)?in\b|\bearlyin\b/.test(texto)) return "early_checkin";
        if (/\bcama\s+adicional\b/.test(texto)) return "cama_adicional";
        if (/\blena\b/.test(texto)) return "lena";
        if (/\bmasaj/.test(texto)) return "masaje";
        if (/\btonel\b/.test(texto)) return "tinaja_tonel";
        if (/\bjacuzzi\b/.test(texto)) return "tinaja_jacuzzi";
        if (/\btinaja\b/.test(texto)) return "tinaja";
        if (/\bcuna\b/.test(texto)) return "cuna";
        return null;
    }

    function esPagoMixto(pago) {
        return pago?.tipo_movimiento === 'mixto' || pago?.concepto_pago?.tipo === 'mixto' || pago?.transaccion_distribuida === true &&
            pago.aplicaciones_libro?.some(aplicacion => ['alojamiento','mixto'].includes(aplicacion.tipo_movimiento)) &&
            pago.aplicaciones_libro?.some(aplicacion => aplicacion.tipo_movimiento !== 'alojamiento');
    }

    function aplicacionesLibro(pago) {
        if (!pago || typeof pago !== "object") return [];
        if (pago.clasificacion_financiera === "nota_financiera" || pago.conflicto_distribucion) return [];
        if (/anulad|cancelad|invalid/.test(normalizar(pago.estado || pago.estado_pago))) return [];
        if (pago.transaccion_distribuida && Array.isArray(pago.aplicaciones_libro)) {
            return pago.aplicaciones_libro.map((aplicacion, indice) => ({
                ...aplicacion,
                indice,
                concepto_canon: conceptoCanon(aplicacion.concepto || aplicacion.tipo_movimiento),
                monto: Number(aplicacion.monto),
                fecha: aplicacion.fecha_bloque || aplicacion.fecha_comprobante || null
            }));
        }
        if (pago.tipo_movimiento !== "servicio") return [];
        return [{
            indice: 0,
            concepto: pago.concepto || null,
            concepto_canon: conceptoCanon(pago.concepto),
            monto: Number(pago.monto),
            fecha: pago.fecha_bloque || pago.fecha_comprobante || null,
            origen: pago.origen || null,
            metadata_servicio: pago.servicio || pago.metadata_servicio || null
        }];
    }

    async function paginas(fabrica) {
        const salida = [];
        for (let desde = 0; ; desde += 1000) {
            const consulta = fabrica();
            const respuesta = typeof consulta?.range === "function"
                ? await consulta.range(desde, desde + 999)
                : await consulta;
            if (respuesta?.error) throw respuesta.error;
            const filas = Array.isArray(respuesta?.data) ? respuesta.data : [];
            salida.push(...filas);
            if (filas.length < 1000) return salida;
        }
    }

    async function leerSnapshot(cliente, reservaIds) {
        const ids = [...new Set((reservaIds || []).filter(Boolean))];
        if (!cliente?.from) throw new Error("No está disponible la lectura financiera de Proyecto H.");
        if (!ids.length) return { disponible: true, cargos: [], servicios: [], aplicaciones: [], pagos: [] };

        const [cargos, servicios] = await Promise.all([
            paginas(() => cliente.from("vista_estado_cargos")
                .select("cargo_id,reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,monto_ajustado,aplicado_neto,saldo_cargo,estado,estado_pago")
                .in("reserva_id", ids).order("cargo_id")),
            paginas(() => cliente.from("servicios")
                .select("id,reserva_id,estadia_id,fecha_servicio,hora_inicio,cantidad,personas,precio_unitario_aplicado,monto_adicional,total,tipo_cobro,estado_servicio,observaciones,catalogo_servicios(codigo,nombre,categoria)")
                .in("reserva_id", ids).order("id"))
        ]);

        const cargoIds = cargos.map(cargo => cargo.cargo_id).filter(Boolean);
        const aplicaciones = cargoIds.length ? await paginas(() => cliente.from("pago_aplicaciones")
            .select("id,pago_id,cargo_id,monto_aplicado").in("cargo_id", cargoIds).order("cargo_id")) : [];
        const pagoIds = [...new Set(aplicaciones.map(aplicacion => aplicacion.pago_id).filter(Boolean))];
        const pagos = pagoIds.length ? await paginas(() => cliente.from("pagos")
            .select("id,reserva_id,monto,moneda,estado,folio,codigo_autorizacion,bove,datos_origen,medio_pago,fecha_pago,tipo_movimiento")
            .in("id", pagoIds).order("id")) : [];

        return { disponible: true, cargos, servicios, aplicaciones, pagos };
    }

    function enriquecerCargos(snapshot, reservaId) {
        const servicios = new Map((snapshot?.servicios || []).map(servicio => [servicio.id, servicio]));
        return (snapshot?.cargos || []).filter(cargo => cargo.reserva_id === reservaId && cargo.tipo_cargo === "servicio")
            .map(cargo => {
                const servicio = servicios.get(cargo.servicio_id) || null;
                const catalogo = servicio?.catalogo_servicios || {};
                return {
                    ...cargo,
                    servicio,
                    concepto_canon: conceptoCanon([cargo.concepto, catalogo.codigo, catalogo.nombre, catalogo.categoria].filter(Boolean).join(" ")),
                    monto_ajustado: Number(cargo.monto_ajustado ?? cargo.monto),
                    aplicado_neto: Number(cargo.aplicado_neto || 0),
                    saldo_cargo: Number(cargo.saldo_cargo || 0)
                };
            });
    }

    function cargoAplicable(cargo) {
        const servicio = cargo.servicio;
        return cargo.estado === "activo" && cargo.monto_ajustado > 0 && servicio &&
            !/cancelad|no show/.test(normalizar(servicio.estado_servicio)) &&
            servicio.tipo_cobro !== "cortesia" && Number(servicio.total || 0) > 0;
    }

    function conjuntoSaldoExactoUnico(cargos, monto) {
        if (!Number.isSafeInteger(monto) || monto <= 0 || cargos.length > 20) return { estado: "revision", conjuntos: [] };
        const candidatos = cargos.map(cargo => ({ cargo, saldo: Number(cargo.saldo_cargo) }));
        if (candidatos.some(item => !Number.isSafeInteger(item.saldo) || item.saldo <= 0)) return { estado: "revision", conjuntos: [] };
        const conjuntos = [];
        const buscar = (indice, suma, elegidos) => {
            if (conjuntos.length > 1 || suma > monto) return;
            if (suma === monto) { conjuntos.push([...elegidos]); return; }
            for (let i = indice; i < candidatos.length && conjuntos.length <= 1; i += 1) {
                elegidos.push(candidatos[i]);
                buscar(i + 1, suma + candidatos[i].saldo, elegidos);
                elegidos.pop();
            }
        };
        buscar(0, 0, []);
        return { estado: conjuntos.length === 1 ? "unico" : conjuntos.length > 1 ? "ambiguo" : "sin_suma", conjuntos };
    }

    function resolverAplicacion(aplicacion, cargos, snapshot, pagoSistema = null, opciones = {}) {
        if (!aplicacion.concepto_canon || !Number.isSafeInteger(aplicacion.monto) || aplicacion.monto <= 0) {
            return { ...aplicacion, estado: "revision", motivo: "La aplicación no tiene concepto o monto financiero válido." };
        }
        const conceptoCompatible = cargo => cargo.concepto_canon === aplicacion.concepto_canon ||
            (aplicacion.concepto_canon === "tinaja" && ["tinaja_tonel", "tinaja_jacuzzi"].includes(cargo.concepto_canon));
        let compatibles = cargos.filter(cargo => cargoAplicable(cargo) && conceptoCompatible(cargo));
        if(opciones.estadiaId){
            const otras=compatibles.filter(c=>c.estadia_id!==opciones.estadiaId);
            compatibles=compatibles.filter(c=>c.estadia_id===opciones.estadiaId);
            if(!compatibles.length&&otras.length)return {...aplicacion,estado:'revision',candidatos:otras,
                motivo:'El cargo compatible pertenece a otra estadía. Revisa su asociación; no se aplicará este comprobante allí.'};
        }
        if (!compatibles.length) {
            return { ...aplicacion, estado: "sin_destino", motivo: "No existe un servicio pendiente compatible en Proyecto H.", candidatos: [] };
        }

        const mismaFecha = compatibles.filter(cargo => aplicacion.fecha && cargo.servicio?.fecha_servicio === aplicacion.fecha);
        if (mismaFecha.length) compatibles = mismaFecha;

        const yaAplicada = cargo => pagoSistema?.id && (snapshot?.aplicaciones || []).some(item =>
            item.pago_id === pagoSistema.id && item.cargo_id === cargo.cargo_id && Number(item.monto_aplicado) === aplicacion.monto);
        const exacta = compatibles.filter(yaAplicada);
        if (exacta.length === 1) {
            return { ...aplicacion, estado: "ya_aplicada", cargo_id: exacta[0].cargo_id, cargo: exacta[0], motivo: "El comprobante ya está aplicado a este cargo." };
        }
        if (exacta.length > 1) {
            return { ...aplicacion, estado: "revision", motivo: "El comprobante aparece aplicado a más de un cargo compatible.", candidatos: exacta };
        }

        const pendientes = compatibles.filter(cargo => cargo.saldo_cargo > 0);
        if (!pendientes.length) {
            return { ...aplicacion, estado: "ya_aplicada", motivo: "El cargo compatible ya está pagado; no se puede aplicar nuevamente.", candidatos: compatibles };
        }
        if (pendientes.length > 1) {
            const conjunto = conjuntoSaldoExactoUnico(pendientes, aplicacion.monto);
            if (conjunto.estado !== "unico") return { ...aplicacion, estado: "multiples_destinos",
                motivo: conjunto.estado === "ambiguo" ?
                    "Existe más de una combinación de cargos compatible con el total; requiere revisión." :
                    "Los cargos compatibles no forman un único conjunto con suma exacta; no se elige por orden.",
                candidatos: pendientes };
            const aplicacionesDistribuidas = conjunto.conjuntos[0].map(({ cargo, saldo }) => ({
                ...aplicacion,
                estado: "destino_unico",
                cargo_id: cargo.cargo_id,
                cargo,
                monto: saldo,
                aplicacion_parcial: false,
                remanente_cargo: 0,
                motivo: "Parte de una distribución única cuya suma coincide exactamente con el pago."
            }));
            return { ...aplicacion, estado: "destino_distribuido", aplicaciones_distribuidas: aplicacionesDistribuidas,
                candidatos: conjunto.conjuntos[0].map(item => item.cargo),
                motivo: "Existe un único conjunto de cargos compatibles cuya suma coincide exactamente con el pago." };
        }

        const cargo = pendientes[0];
        if (aplicacion.monto > cargo.saldo_cargo) {
            if(opciones.excedenteAprobable===true)return {...aplicacion,estado:'destino_unico',cargo_id:cargo.cargo_id,cargo,
                monto:cargo.saldo_cargo,monto_recibido:aplicacion.monto,excedente:aplicacion.monto-cargo.saldo_cargo,
                motivo:'Comprobante íntegro; aplicar sólo el saldo del cargo y conservar el excedente sin aplicar requiere aprobación explícita.'};
            return { ...aplicacion, estado: "saldo_insuficiente", cargo_id: cargo.cargo_id, cargo,
                monto_recibido:aplicacion.monto,monto_aplicable:cargo.saldo_cargo,excedente:aplicacion.monto-cargo.saldo_cargo,
                motivo: "El monto de la aplicación supera el saldo pendiente del cargo." };
        }
        return { ...aplicacion, estado: "destino_unico", cargo_id: cargo.cargo_id, cargo,
            aplicacion_parcial: aplicacion.monto < cargo.saldo_cargo,
            remanente_cargo: cargo.saldo_cargo - aplicacion.monto,
            motivo: aplicacion.monto < cargo.saldo_cargo
                ? "Destino único; la aplicación es parcial y conserva saldo pendiente."
                : "Destino financiero único y saldo exacto." };
    }

    function conceptoServicioMixto(valor) {
        const texto = normalizar(valor).replace(/^1 /,'');
        if (!/^(?:tinajas?(?: (?:jacuzzi|tonel))?|jacuzzi|tonel|masajes?|lena|cama adicional|cuna|queque|pan|huevos?|late(?: (?:check )?out|out)|early(?: (?:check )?in|in))$/.test(texto)) return null;
        return conceptoCanon(texto);
    }

    function resolverPagoMixto(pago, reservaId, snapshot, estadiaId, asociado) {
        const revision = (motivo, aplicaciones = []) => ({ estado: 'revision', mixto: true, resoluble: false,
            aplicaciones, aplicaciones_payload: [], motivo });
        if (pago.conflicto_distribucion) return revision(pago.conflicto_distribucion);
        const concepto = pago.concepto_pago;
        if (concepto?.conflicto_desglose) return revision('Los importes por concepto del Detalle y del Concepto se contradicen. Verifica el comprobante original.');
        const componentes = pago.transaccion_distribuida ? aplicacionesLibro(pago) : concepto?.aplicaciones || [];
        if (!componentes.some(parte => parte.tipo_movimiento === 'alojamiento') ||
            !componentes.some(parte => parte.tipo_movimiento === 'servicio') ||
            (pago.transaccion_distribuida ? !pago.total_declarado : !concepto?.desglose_comprobable)) {
            return revision('Falta el desglose del comprobante: indica qué importe corresponde a alojamiento y a cada servicio.');
        }
        if (!componentes.every(parte => ['alojamiento','servicio'].includes(parte.tipo_movimiento) &&
            Number.isSafeInteger(parte.monto) && parte.monto > 0) || componentes.reduce((suma, parte) => suma + parte.monto, 0) !== pago.monto) {
            return revision('Los importes del desglose no coinciden con el total del comprobante.');
        }
        const servicios = componentes.filter(parte => parte.tipo_movimiento === 'servicio').map(parte => conceptoServicioMixto(parte.concepto));
        if (servicios.includes(null) || (!pago.transaccion_distribuida &&
            [...servicios].sort().join('|') !== concepto.servicios.map(conceptoServicioMixto).sort().join('|'))) {
            return revision('Falta identificar en el desglose cada servicio mencionado en Concepto y su importe.');
        }
        if (!asociado || !reservaId || !estadiaId || pago.advertencias?.length) return revision('Falta comprobar la reserva y la estadía de este comprobante mixto.');
        if (pago.clasificacion_financiera !== 'pago_real' || pago.pago_recibido !== true || pago.webpay_por_confirmar ||
            !(pago.codigo_autorizacion || pago.folio && pago.bovtar)) return revision('Falta confirmar la recepción y el identificador del comprobante mixto.');
        if (!snapshot?.disponible) return revision('Falta consultar los cargos y saldos de la estadía.');
        const alojamiento = (snapshot.cargos || []).filter(cargo => cargo.reserva_id === reservaId && cargo.estadia_id === estadiaId &&
            cargo.tipo_cargo === 'alojamiento' && cargo.estado === 'activo');
        const cargosServicio = enriquecerCargos(snapshot, reservaId).filter(cargo => cargo.estadia_id === estadiaId && cargoAplicable(cargo));
        const aplicaciones = componentes.map((parte, indice) => {
            const canon = parte.tipo_movimiento === 'alojamiento' ? 'alojamiento' : conceptoServicioMixto(parte.concepto);
            const candidatos = canon === 'alojamiento' ? alojamiento : cargosServicio.filter(cargo => cargo.concepto_canon === canon ||
                (canon === 'tinaja' && ['tinaja_tonel','tinaja_jacuzzi'].includes(cargo.concepto_canon)));
            const base = { ...parte, indice, concepto_canon: canon };
            if (candidatos.length !== 1 || !candidatos[0].cargo_id) return { ...base, estado: 'revision', motivo: candidatos.length > 1 ?
                'Hay más de un cargo compatible. Identifica el cargo en el comprobante; el importe no permite elegirlo.' :
                'Falta un cargo de esta estadía compatible con el componente.' };
            const cargo = candidatos[0], saldo = Number(cargo.saldo_cargo), total = Number(cargo.monto_ajustado ?? cargo.monto);
            return Number.isSafeInteger(saldo) && Number.isSafeInteger(total) && saldo <= total && saldo >= parte.monto ?
                { ...base, cargo, cargo_id: cargo.cargo_id, estado: 'destino_unico' } :
                { ...base, cargo, estado: 'revision', motivo: 'El importe del componente excede el saldo comprobado de su cargo.' };
        });
        const cargosUsados = aplicaciones.map(parte => parte.cargo_id).filter(Boolean);
        if (new Set(cargosUsados).size !== cargosUsados.length) return revision('Más de un componente señala el mismo cargo; comprueba el reparto.', aplicaciones);
        return revision(aplicaciones.every(parte => parte.estado === 'destino_unico') ?
            'Desglose y saldos comprobados. La incorporación protegida no admite todavía alojamiento y servicios en un mismo pago.' :
            'Falta comprobar el cargo o el saldo de uno o más componentes.', aplicaciones);
    }

    function resolverTransaccion(pago, reservaId, snapshot, pagoSistema = null, opciones = {}) {
        if (esPagoMixto(pago)) return resolverPagoMixto(pago, reservaId, snapshot, opciones.estadiaId, opciones.asociado);
        if (!snapshot?.disponible) return { estado: "revision", resoluble: false, aplicaciones: [], motivo: snapshot?.error || "No fue posible leer el snapshot financiero." };
        if (!reservaId) return { estado: "revision", resoluble: false, aplicaciones: [], motivo: "La reserva destino no es inequívoca." };
        const aplicaciones = aplicacionesLibro(pago);
        if (!aplicaciones.length) return null;
        const suma = aplicaciones.reduce((total, aplicacion) => total + Number(aplicacion.monto || 0), 0);
        if (pago.transaccion_distribuida && suma !== Number(pago.monto)) {
            return { estado: "revision", resoluble: false, aplicaciones, motivo: "La suma de aplicaciones no coincide con el comprobante padre." };
        }
        const cargos = enriquecerCargos(snapshot, reservaId);
        const resueltasBase = aplicaciones.map(aplicacion => resolverAplicacion(aplicacion, cargos, snapshot, pagoSistema,opciones));
        const resueltas = resueltasBase.flatMap(aplicacion => aplicacion.aplicaciones_distribuidas || [aplicacion]);
        const usados = new Map();
        for (const aplicacion of resueltas.filter(item => item.cargo_id && item.estado === "destino_unico")) {
            usados.set(aplicacion.cargo_id, (usados.get(aplicacion.cargo_id) || 0) + 1);
        }
        for (const aplicacion of resueltas) {
            if (aplicacion.cargo_id && usados.get(aplicacion.cargo_id) > 1) {
                aplicacion.estado = "revision";
                aplicacion.motivo = "Más de una aplicación intenta usar el mismo cargo; requiere revisión.";
            }
        }
        const resoluble = resueltas.length > 0 && resueltas.every(item => item.estado === "destino_unico");
        const todasAplicadas = resueltas.length > 0 && resueltas.every(item => item.estado === "ya_aplicada");
        return {
            estado: resoluble ? "destino_unico" : todasAplicadas ? "ya_aplicada" : "revision",
            resoluble,
            aplicaciones: resueltas,
            aplicaciones_payload: resoluble ? resueltas.map(item => ({ cargo_id: item.cargo_id, monto: item.monto })) : [],
            monto_total: Number(pago.monto),
            monto_sin_aplicar:resueltas.reduce((n,a)=>n+(a.estado==='destino_unico'?Number(a.excedente||0):0),0),
            motivo: resoluble ? "Todas las aplicaciones tienen un destino financiero único." :
                todasAplicadas ? "Todas las aplicaciones ya están cubiertas en Proyecto H." : "Una o más aplicaciones requieren revisión."
        };
    }


    // TINAJA 1/2 ADL EXTRA: segundo comprobante de una Jacuzzi ya cobrada.
    // No es un servicio nuevo ni otro pago del cargo original completamente aplicado.
    function proponerAmpliacionJacuzzi(pago,reserva,destino,comparacion) {
        const snapshot=comparacion?.snapshot?.finanzas, valor=normalizar(pago?.concepto||'');
        const extras=valor.match(/(?:^|\s)([12])\s*(?:adl|adultos?|personas?)\s*(?:extra|adicional(?:es)?)(?:\s|$)/);
        const cantidad=Number(extras?.[1]||0);
        if (!extras || !/\b(?:tinaja|jacuzzi)\b/.test(valor) ||
            pago?.tipo_movimiento!=='servicio' ||
            pago?.pago_recibido!==true || pago?.estado_pago!=='registrado_en_libro' ||
            pago?.moneda!=='CLP' || pago?.monto!==cantidad*10000 ||
            !['debito','credito','tarjeta_debito','tarjeta_credito'].includes(pago?.medio_pago) ||
            !pago?.folio || !pago?.bovtar || pago?.codigo_autorizacion ||
            !/^\d{4}-\d{2}-\d{2}$/.test(pago?.fecha_comprobante||'') ||
            !pago?.origen?.hoja || !pago?.origen?.celda ||
            !reserva?.id || !destino?.reserva_id || !destino?.estadia_id || destino.bloqueado ||
            pago.fecha_bloque!==reserva.fecha_checkin || Number(pago.cabana)!==Number(reserva.cabana) ||
            snapshot?.disponible!==true) return null;
        const asociadas=Array.from(comparacion||[]).filter(x=>x.libro?.id===reserva.id &&
            x.estado==='asociada' && x.sistema?.reserva_id===destino.reserva_id &&
            x.sistema?.id===destino.estadia_id && x.sistema.fecha_checkin===reserva.fecha_checkin &&
            x.sistema.fecha_checkout===reserva.fecha_checkout &&
            Number(x.sistema.cabana)===Number(reserva.cabana));
        if (asociadas.length!==1) return null;
        const servicios=(snapshot.servicios||[]).filter(s=>s.reserva_id===destino.reserva_id &&
            s.estadia_id===destino.estadia_id && s.catalogo_servicios?.codigo==='tinajaJacuzzi' &&
            !/cancelad|no.?show|anulad/.test(normalizar(s.estado_servicio||'')));
        if (servicios.length!==1) return null;
        const servicio=servicios[0],personas=Number(servicio.personas),
            total=Number(servicio.total),montoAdicional=Number(servicio.monto_adicional),
            fin= Math.max(3,personas)+cantidad,incremento=cantidad*10000;
        if (Number(servicio.cantidad)!==1 || servicio.tipo_cobro!=='normal' ||
            !Number.isInteger(personas) || personas<1 || personas>4 || fin>5 ||
            total!==30000+Math.max(0,personas-3)*10000 ||
            Number(servicio.precio_unitario_aplicado)!==30000 ||
            montoAdicional!==Math.max(0,personas-3)*10000 ||
            !(servicio.fecha_servicio>=reserva.fecha_checkin &&
                servicio.fecha_servicio<=reserva.fecha_checkout) ||
            !/^\d{2}:\d{2}/.test(servicio.hora_inicio||'')) return null;
        const cargos=(snapshot.cargos||[]).filter(c=>c.servicio_id===servicio.id &&
            c.reserva_id===destino.reserva_id && c.estadia_id===destino.estadia_id &&
            c.tipo_cargo==='servicio' && c.estado==='activo');
        if (cargos.length!==1 || Number(cargos[0].monto_ajustado)!==total ||
            Number(cargos[0].aplicado_neto)!==total || Number(cargos[0].saldo_cargo)!==0) return null;
        const recibos=(comparacion?.snapshot?.pagos_todos||[]).filter(p=>p.tipo_movimiento==='pago' &&
            p.estado!=='anulado' && String(p.folio||'').replace(/[^0-9a-z]/gi,'').toUpperCase()===
                String(pago.folio).replace(/[^0-9a-z]/gi,'').toUpperCase() &&
            String(p.bove||p.codigo_autorizacion||'').replace(/[^0-9a-z]/gi,'').toUpperCase()===
                String(pago.bovtar).replace(/[^0-9a-z]/gi,'').toUpperCase());
        if (recibos.length) return null;
        return {
            reservaId:destino.reserva_id,estadiaId:destino.estadia_id,servicioId:servicio.id,
            adicionales:cantidad,personasActuales:personas,personasFinales:fin,
            totalActual:total,totalFinal:total+incremento,montoAdicional:incremento,
            esperado:{
                personas, total, cantidad:1, precio:30000,
                fecha_servicio:servicio.fecha_servicio,
                hora:String(servicio.hora_inicio).slice(0,5),
                aplicado:total,saldo:0
            },
            origen:{
                concepto:pago.concepto,folio:pago.folio,bovtar:pago.bovtar,
                fecha_pago:pago.fecha_comprobante,fecha_bloque:pago.fecha_bloque,
                monto:pago.monto,moneda:pago.moneda,
                hoja:pago.origen.hoja,celda:pago.origen.celda
            }
        };
    }

    const api = Object.freeze({ conceptoCanon, esPagoMixto, aplicacionesLibro, leerSnapshot, resolverAplicacion, resolverTransaccion, proponerAmpliacionJacuzzi });
    root.HAIKU_LIBRO_PAGOS_DESTINOS_V1 = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
