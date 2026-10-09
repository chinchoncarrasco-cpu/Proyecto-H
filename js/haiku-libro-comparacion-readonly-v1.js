/* Núcleo mensual canónico. Sin transporte, UI, decisiones ni capacidades de escritura. */
(function (root) {
    "use strict";
    const schemaVersion = 1, canonicalRevision = "proyecto-h/libro-mensual-readonly/1-r1";
    const timezone = "America/Santiago";
    const cadenaCanonica = Object.freeze(["worker/semantica", "pagos-canon-v1", "lenguaje-natural-v1",
        "consultas-v1/consultar", "cancelaciones/detectarActual", "bloqueos/comparar"]);
    const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const lista = x => Array.isArray(x) ? x : [];
    const escalar = x => typeof x === "string" || typeof x === "boolean" || typeof x === "number" && Number.isFinite(x) ? x : null;
    const campos = (x, keys) => Object.fromEntries(keys.map(k => [k, escalar(x?.[k])]));
    const textos = x => lista(x).filter(v => typeof v === "string");
    const unico = x => [...new Set(x)];
    const fallosPropios = new WeakSet();
    function fallo(code, message) {
        const error = Object.assign(new Error(message), { code }); fallosPropios.add(error); return error;
    }

    function periodoMes(ahora, solicitado) {
        if (solicitado && (typeof solicitado.desde !== "string" || typeof solicitado.hasta !== "string"))
            throw fallo("PERIODO_INCONSISTENTE", "El período debe incluir fechas de inicio y fin válidas.");
        const d = new Date(ahora);
        if (!Number.isFinite(+d)) throw fallo("PERIODO_INCONSISTENTE", "La fecha de referencia no es válida.");
        const local = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" })
            .formatToParts(d).map(p => [p.type, p.value]));
        const year = solicitado ? Number(solicitado.desde?.slice(0, 4)) : Number(local.year);
        const month = solicitado ? Number(solicitado.desde?.slice(5, 7)) : Number(local.month);
        if (!Number.isInteger(year) || year < 2000 || year > 2099 || !Number.isInteger(month) || month < 1 || month > 12)
            throw fallo("PERIODO_INCONSISTENTE", "Se requiere un mes calendario válido.");
        const desde = `${year}-${String(month).padStart(2, "0")}-01`;
        const hasta = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
        if (solicitado && (solicitado.desde !== desde || solicitado.hasta !== hasta))
            throw fallo("PERIODO_INCONSISTENTE", "El período debe abarcar exactamente un mes calendario.");
        return { desde, hasta, etiqueta: `${meses[month - 1]} ${year}`, timezone };
    }

    // Una cadena de consulta sólo puede empezar con SELECT. No devuelve el builder real.
    function clienteLectura(cliente) {
        const errores = [], tablas = new Set(["reserva_estadias", "reservas", "pagos", "servicios",
            "vista_estado_cargos", "pago_aplicaciones", "cabanas", "bloqueos_cabana"]);
        const registrar = e => { errores.push(e); return e; };
        const prohibir = () => { throw registrar(fallo("OPERACION_NO_READONLY", "La comparación sólo admite lecturas; operación bloqueada.")); };
        const auth = Object.freeze({ getSession: async () => {
            try {
                if (typeof cliente?.auth?.getSession !== "function") throw fallo("SESION_PERMISOS", "Se requiere una sesión de Proyecto H.");
                const r = await cliente.auth.getSession();
                if (r?.error || !r?.data?.session?.user?.id) throw fallo("SESION_PERMISOS", "No se pudo verificar la sesión de Proyecto H.");
                return { data: { session: { user: { id: r.data.session.user.id } } }, error: null };
            } catch (_) { throw registrar(fallo("SESION_PERMISOS", "No se pudo verificar la sesión de Proyecto H.")); }
        } });
        const api = Object.freeze({ auth, rpc: prohibir, from: tabla => {
            if (!tablas.has(tabla)) throw registrar(fallo("OPERACION_NO_READONLY", "Tabla fuera del contrato de comparación."));
            let query, seleccionada = false;
            const vista = { insert: prohibir, update: prohibir, upsert: prohibir, delete: prohibir, rpc: prohibir };
            for (const method of ["select", "eq", "in", "lte", "gte", "order", "range"]) vista[method] = (...args) => {
                try {
                    if (method === "select") {
                        if (seleccionada) throw fallo("OPERACION_NO_READONLY", "Sólo se permite un SELECT por consulta.");
                        query = cliente.from(tabla); seleccionada = true;
                    } else if (!seleccionada) throw fallo("OPERACION_NO_READONLY", "La consulta debe comenzar con SELECT.");
                    if (typeof query?.[method] !== "function") throw fallo("ERROR_SUPABASE", "El cliente no permite completar la lectura paginada.");
                    query = query[method](...args); return fachada;
                } catch (e) { throw registrar(e.code === "OPERACION_NO_READONLY" || e.code === "ERROR_SUPABASE" ? e : fallo("ERROR_SUPABASE", `No se pudo consultar ${tabla}.`)); }
            };
            vista.then = (ok, no) => Promise.resolve().then(async () => {
                if (!seleccionada) throw fallo("OPERACION_NO_READONLY", "La consulta debe comenzar con SELECT.");
                const r = await query;
                if (r?.error) throw fallo(["42501", "PGRST301", "PGRST302"].includes(r.error.code) ? "SESION_PERMISOS" : "ERROR_SUPABASE",
                    `No se pudo leer ${tabla}; no se concluye que falten registros.`);
                if (!Array.isArray(r?.data)) throw fallo("ERROR_SUPABASE", `Respuesta incompleta al leer ${tabla}.`);
                return { data: r.data, error: null };
            }).catch(e => { throw registrar(["OPERACION_NO_READONLY", "ERROR_SUPABASE", "SESION_PERMISOS"].includes(e.code) ? e : fallo("ERROR_SUPABASE", `No se pudo leer ${tabla}.`)); }).then(ok, no);
            const fachada = Object.freeze(vista); return fachada;
        } });
        return { api, errores };
    }

    function origen(x) {
        if (!x || typeof x !== "object") return null;
        const o = campos(x, ["hoja", "celda", "fila", "columna", "rango"]);
        if (x.merge?.s && x.merge?.e) o.merge = { s: campos(x.merge.s, ["r", "c"]), e: campos(x.merge.e, ["r", "c"]) };
        else o.merge = null;
        o.celdas = textos(x.celdas);
        return o;
    }
    function reserva(x) {
        if (!x) return null;
        return { ...campos(x, ["titular", "cabana", "fecha_checkin", "fecha_checkout", "tipo_estadia", "noches",
            "adultos", "ninos", "mascotas", "rut_documento", "correo", "telefono", "estado_confirmacion",
            "estado_operativo", "estado_reserva", "operador", "fecha_ingreso_libro", "texto_original", "cobertura_pagos"]),
            cabanas: lista(x.cabanas).map(escalar), origen: origen(x.coordenadas_origen || x.origen),
            notasImportantes: textos(x.notas_importantes), notasInterpretacion: textos(x.notas_interpretacion),
            pagosPendientes: textos(x.pagos_pendientes), advertencias: textos(x.advertencias),
            advertenciasInformativas: textos(x.advertencias_informativas) };
    }
    function estadia(x) {
        return reserva(x);
    }
    function pago(x) {
        if (!x) return null;
        return { ...campos(x, ["monto", "moneda", "medio_pago", "tipo_movimiento", "concepto", "estado_pago",
            "clasificacion_financiera", "fecha_comprobante", "fecha_bloque", "texto_original", "folio", "bovtar",
            "codigo_autorizacion", "bove_pendiente", "manager_pendiente"]), origen: origen(x.origen),
            advertencias: textos(x.advertencias), origenes: lista(x.origenes).map(origen),
            aplicaciones: lista(x.aplicaciones_libro).map(a => ({ ...campos(a, ["concepto", "tipo_movimiento", "codigo_servicio", "monto", "moneda"]), origen: origen(a.origen) })) };
    }
    function servicio(x) {
        if (!x) return null;
        return { ...campos(x, ["concepto", "codigo_servicio", "fecha", "hora", "monto", "cantidad", "personas", "duracion_minutos",
            "cortesia", "intencion_cobro", "clasificacion", "semantica", "texto_original"]), origen: origen(x.coordenadas_origen || x.origen),
            advertencias: textos(x.advertencias), evidenciaVisual: x.evidencia_visual_v1 ? campos(x.evidencia_visual_v1,
                ["version", "fuente", "rgb", "cobertura", "inferencia"]) : null };
    }
    function destino(x) {
        if (!x) return null;
        return { ...campos(x, ["estado", "resoluble", "motivo", "monto_total"]),
            aplicaciones: lista(x.aplicaciones).map(a => ({ ...campos(a, ["estado", "concepto", "tipo_cargo", "codigo_servicio", "monto", "motivo"]),
                origen: origen(a.origen), cargo: a.cargo ? campos(a.cargo, ["concepto", "tipo_cargo", "saldo_cargo"]) : null })) };
    }
    const metaKeys = ["libro", "estadias_libro", "libro_detectadas", "proyecto", "asociadas", "faltantes", "ambiguas",
        "con_diferencias", "pagos_faltantes", "pagos_revisar", "servicios_revisar"];

    function exportar(result, { periodo, fuente, generatedAt = new Date().toISOString(), modelo } = {}) {
        if (typeof generatedAt !== "string" || !Number.isFinite(+new Date(generatedAt)))
            throw fallo("RESULTADO_INVALIDO", "La fecha de generación debe ser una fecha ISO válida.");
        generatedAt = new Date(generatedAt).toISOString();
        const comp = result?.comparacion;
        if (!result?.q?.comparar || !Array.isArray(comp) || !Array.isArray(comp.grupos) || !comp.meta ||
            !Array.isArray(comp.pagosDetalle) || !Array.isArray(comp.serviciosDetalle))
            throw fallo("RESULTADO_INVALIDO", "No existe una comparación canónica completa para exportar.");
        if (!periodo || result.q.desde !== periodo.desde || result.q.hasta !== periodo.hasta)
            throw fallo("PERIODO_INCONSISTENTE", "El resultado no corresponde al período solicitado.");
        modelo ||= dependencias().motor.modeloPresentacionComparacion(result);
        const itemIds = new Map(comp.map((x, n) => [x, `caso:${n + 1}`]));
        const grupoIds = new Map(comp.grupos.map((g, n) => [g, `grupo:${n + 1}`]));
        const coleccion = (datos, kind) => datos.map((x, n) => ({ x, id: `${kind}:${n + 1}` }));
        const ps = coleccion(comp.pagosDetalle, "pago"), ss = coleccion(comp.serviciosDetalle, "servicio");
        const mismaReserva = (a, b) => a === b || a?.id && a.id === b?.id || JSON.stringify(reserva(a)) === JSON.stringify(reserva(b));
        const idMovimiento = (rows, x, key, proyeccion) => {
            const exacto = rows.find(r => r.x === x);
            if (exacto) return exacto.id;
            const matches = rows.filter(r => r.x.estado === x.estado && mismaReserva(r.x.reserva, x.reserva) &&
                JSON.stringify(proyeccion(r.x[key])) === JSON.stringify(proyeccion(x[key])));
            if (matches.length !== 1) throw fallo("RESULTADO_INVALIDO", "No se puede representar una relación de pago o servicio inequívocamente.");
            return matches[0].id;
        };
        const refs = (rows, xs, key, project) => unico(lista(xs).map(x => idMovimiento(rows, x, key, project)));
        const items = comp.map(x => ({ id: itemIds.get(x), ...campos(x, ["estado", "categoria", "confianza", "pregunta"]),
            motivo: escalar(x.pregunta), libro: reserva(x.libro), proyecto: estadia(x.sistema), diferencias: textos(x.diferencias),
            candidatos: lista(x.candidatosDetalle).map(estadia),
            pagoIds: refs(ps, x.pagosComparacion, "pago", pago), servicioIds: refs(ss, x.serviciosComparacion, "servicio", servicio) }));
        const grupos = comp.grupos.map(g => ({ id: grupoIds.get(g), ...campos(g, ["estado", "categoria", "confianza", "pregunta"]),
            itemIds: lista(g.items).map(x => itemIds.get(x)), principalItemId: itemIds.get(g.items.find(x => x.libro === g.principal)) || null,
            cabanas: lista(g.cabanas).map(escalar), diferencias: textos(g.diferencias),
            pagoIds: refs(ps, g.pagos, "pago", pago), servicioIds: refs(ss, g.servicios, "servicio", servicio) }));
        if (grupos.some(g => g.itemIds.some(id => !id))) throw fallo("RESULTADO_INVALIDO", "Un grupo contiene casos ajenos a la comparación.");
        const referencias = (id, key) => {
            const casos = items.filter(i => i[key].includes(id)).map(i => i.id);
            return { itemIds: casos, grupoIds: grupos.filter(g => g.itemIds.some(i => casos.includes(i))).map(g => g.id) };
        };
        const pagosDetalle = ps.map(({ x, id }) => ({ id, ...referencias(id, "pagoIds"), estado: escalar(x.estado),
            libro: pago(x.pago), proyecto: x.sistema ? campos(x.sistema, ["monto", "moneda", "medio_pago", "fecha_pago", "estado", "tipo_movimiento"]) : null,
            resolucionSemantica: x.resolucionPago ? campos(x.resolucionPago, ["estado", "evidencia"]) : null,
            motivos: textos(x.motivos || x.resolucionPago?.motivos || x.pago?.advertencias), diferencias: textos(x.diferencias),
            destinoFinanciero: destino(x.destinoFinanciero) }));
        const serviciosDetalle = ss.map(({ x, id }) => ({ id, ...referencias(id, "servicioIds"), estado: escalar(x.estado),
            libro: servicio(x.servicio), proyecto: x.sistema ? { ...campos(x.sistema, ["fecha_servicio", "hora_inicio", "total", "estado_servicio"]),
                catalogo: campos(x.sistema.catalogo_servicios, ["codigo", "nombre", "categoria"]) } : null,
            motivo: escalar(x.razon), diferencias: textos(x.diferencias) }));
        const b = result.bloqueos_comparacion;
        const bloqueo = x => ({ ...campos(x, ["cabana", "fecha_inicio", "fecha_fin", "nota", "estado", "mensaje"]), origen: origen(x.origen) });
        const cancelacion = x => typeof x === "string" ? { motivo: x } : { ...campos(x, ["tipo", "fuente", "estado_proyecto"]),
            actual: reserva(x.actual), evidencia: x.evidencia ? { ...reserva(x.evidencia), origen: origen(x.evidencia.origen) } : null };
        const cobertura = { hojas: lista(result.cobertura).map(c => campos(c, ["hoja", "geometria", "pagos"])),
            bloqueosLecturaSegura: escalar(result.bloqueos_lectura_segura), cabanasRevision: lista(result.bloqueos_cabanas_revision).map(escalar),
            pagosPorCaso: items.map(i => ({ itemId: i.id, cobertura: i.libro.cobertura_pagos })) };
        const completa = cobertura.hojas.length > 0 && cobertura.hojas.every(c => c.geometria === true && c.pagos === true) &&
            cobertura.bloqueosLecturaSegura === true && !cobertura.cabanasRevision.length &&
            cobertura.pagosPorCaso.every(c => c.cobertura === true) &&
            !(comp.meta.libro_detectadas > 0 && !comp.meta.estadias_libro);
        return { schemaVersion, intent: "comparar_libro_mes_actual", mode: "read-only", canonicalRevision, generatedAt,
            status: completa ? "ok" : "incompleto", error: completa ? null : { code: "COBERTURA_INSUFICIENTE", message: "La lectura no permite afirmar cobertura completa." },
            periodo: campos(periodo, ["desde", "hasta", "etiqueta", "timezone"]), fuente: campos(fuente, ["tipo", "nombre", "version", "modifiedTime", "verifiedAt", "generacion"]),
            alcance: { tipo: "registros_accesibles_sesion", hojas: textos(result.q.hojas), comparacion: "reservas_pagos_servicios" },
            comparacion: { items, grupos, meta: campos(comp.meta, metaKeys) }, pagosDetalle, serviciosDetalle,
            advertencias: textos(result.advertencias), cobertura,
            contexto: { cadenaCanonica: [...cadenaCanonica], advertenciasInformativas: textos(modelo.advertenciasInformativas),
                bloqueos: { items: lista(b).map(x => ({ ...bloqueo(x.bloqueo), ...campos(x, ["estado", "mensaje"]) })),
                    soloProyectoH: lista(b?.solo_proyecto_h).map(bloqueo), revisionInversa: lista(b?.revision_inversa).map(bloqueo), errorInversa: escalar(b?.error_inversa) },
                cancelaciones: { confirmadas: lista(result.cancelaciones_confirmadas).map(cancelacion),
                    yaCoinciden: lista(result.cancelaciones_ya_coinciden).map(cancelacion), revision: lista(result.cancelaciones_revision).map(cancelacion) } },
            presentacion: campos(modelo.contadores, ["gruposLibro", "registrosDetectados", "reservasProyecto", "estadiasAsociadas",
                "estadiasValidas", "gruposAsociados", "faltantes", "ambiguas", "casosConDiferencias", "gruposConDiferencias",
                "pagosFaltantes", "pagosRevisar", "serviciosRevisar", "advertencias", "advertenciasInformativas"]) };
    }

    function dependencias() {
        const cargar = (global, file) => root[global] || (typeof module !== "undefined" && module.exports ? require(file) : null);
        const semantica = cargar("HAIKU_LIBRO_SEMANTICA", "./haiku-libro-semantica-v1.js");
        const canon = cargar("HAIKU_LIBRO_PAGOS_CANON_V1", "./haiku-libro-pagos-canon-v1.js");
        const lenguaje = cargar("HAIKU_LIBRO_LENGUAJE_NATURAL_V1", "./haiku-libro-lenguaje-natural-v1.js");
        const consultas = cargar("HAIKU_LIBRO_CONSULTAS", "./haiku-libro-consultas-v1.js");
        const contexto = lenguaje.crearSemantica(semantica, canon);
        return { semantica: contexto.semantica, canon, corregirLenguaje: contexto.corregirResultado,
            motor: consultas.crearMotorLectura({ semantica: contexto.semantica,
                pagosDestinos: cargar("HAIKU_LIBRO_PAGOS_DESTINOS_V1", "./haiku-libro-pagos-destinos-v1.js"),
                cancelaciones: cargar("HAIKU_LIBRO_CANCELACIONES_V1", "./haiku-libro-cancelaciones-v1.js"),
                bloqueos: cargar("HAIKU_LIBRO_BLOQUEOS_V1", "./haiku-libro-bloqueos-v1.js") }) };
    }
    function crearNucleo() {
        const deps = dependencias();
        async function compararMes({ fuente, cliente, ahora = new Date().toISOString(), periodo: solicitado, lector } = {}) {
            let periodo = null;
            const generatedAt = Number.isFinite(+new Date(ahora)) ? new Date(ahora).toISOString() : null;
            try {
                periodo = periodoMes(ahora, solicitado);
                if (!fuente) throw fallo("LIBRO_AUSENTE", "Se requiere un Libro suministrado para comparar.");
                const consultasHojas = [], wrapped = fuente.libro;
                let hojas, leer;
                if (wrapped) {
                    if (!["listo", "estado", "listarHojas", "consultarHoja"].every(k => typeof wrapped[k] === "function"))
                        throw fallo("LIBRO_INVALIDO", "La entrada canónica del Libro está incompleta.");
                    await wrapped.listo();
                    if (!wrapped.estado()?.cargado) throw fallo("LIBRO_AUSENTE", "El Libro no está cargado.");
                    hojas = wrapped.listarHojas();
                    leer = h => typeof wrapped.consultarHojaMensual === "function" ? wrapped.consultarHojaMensual(h) : wrapped.consultarHoja(h);
                } else if (fuente.bytes) {
                    if (!lector?.indiceNombres || !lector?.leerHoja) throw fallo("LIBRO_INVALIDO", "Se requiere el lector canónico para los bytes suministrados.");
                    const bytes = ArrayBuffer.isView(fuente.bytes) ? new Uint8Array(fuente.bytes.buffer, fuente.bytes.byteOffset, fuente.bytes.byteLength).slice().buffer :
                        fuente.bytes instanceof ArrayBuffer ? fuente.bytes.slice(0) : null;
                    if (!bytes) throw fallo("LIBRO_INVALIDO", "Se requieren bytes XLSX, no una URL ni un archivo remoto.");
                    try { hojas = (await lector.indiceNombres(bytes)).nombres; }
                    catch (_) { throw fallo("LIBRO_INVALIDO", "Los bytes no contienen un Libro XLSX válido."); }
                    leer = h => lector.leerHoja(bytes, h);
                } else {
                    if (!fuente.hojas || typeof fuente.hojas !== "object") throw fallo("LIBRO_INVALIDO", "Se requieren hojas suministradas o una entrada canónica cargada.");
                    hojas = Object.keys(fuente.hojas); leer = h => fuente.hojas[h];
                }
                const estado = () => wrapped ? wrapped.estado() : { cargado: true, nombre: fuente.nombre, version: fuente.version,
                    generacion: fuente.generacion ?? 1, modifiedTime: fuente.modifiedTime };
                const inicial = estado();
                const sello = e => JSON.stringify(campos(e, ["nombre", "version", "generacion", "cargado", "modifiedTime"]));
                const selloInicial = sello(inicial);
                const metadata = { tipo: fuente.tipo || (wrapped ? "canonica_web" : fuente.bytes ? "xlsx_suministrado" : "hojas_suministradas"),
                    nombre: inicial.nombre || fuente.nombre || null, version: inicial.version || fuente.version || null,
                    generacion: inicial.generacion, modifiedTime: inicial.modifiedTime || fuente.modifiedTime, verifiedAt: fuente.verifiedAt };
                const hojaEsperada = deps.semantica.meses[Number(periodo.desde.slice(5, 7)) - 1] + periodo.desde.slice(2, 4);
                if (!Array.isArray(hojas) || !hojas.some(h => deps.semantica.normalizar(h).replace(/\s/g, "") === hojaEsperada))
                    throw fallo("HOJA_AUSENTE", `No se encuentra la hoja mensual ${hojaEsperada}.`);
                const libro = Object.freeze({ listo: async () => {}, estado, listarHojas: () => [...hojas], consultarHoja: async h => {
                    let data;
                    try { data = await leer(h); } catch (_) { throw fallo("ERROR_LECTURA", `No se pudo leer la hoja ${h}.`); }
                    if (!data || typeof data !== "object") throw fallo("LIBRO_INVALIDO", `La hoja ${h} no es válida.`);
                    if (!wrapped && Array.isArray(data.celdas)) {
                        if (!data.celdas.length) throw fallo("LIBRO_INVALIDO", `La hoja ${h} no contiene celdas interpretables.`);
                        data = deps.semantica.normalizarHoja(data, h);
                    }
                    if (!Array.isArray(data.reservas)) throw fallo("LIBRO_INVALIDO", `La hoja ${h} no contiene una entrada semántica válida.`);
                    if (!wrapped) data = deps.corregirLenguaje(deps.canon.corregirResultado(data));
                    consultasHojas.push({ hoja: h, geometria: escalar(data.cobertura?.geometria), pagos: escalar(data.cobertura?.pagos) });
                    return data;
                } });
                const lectura = clienteLectura(cliente);
                let result;
                try { result = await deps.motor.consultar(`Libro: compara reservas de ${periodo.etiqueta} con Proyecto H`, libro, lectura.api); }
                catch (e) {
                    if (sello(estado()) !== selloInicial) throw fallo("FUENTE_CAMBIADA", "El Libro cambió durante la comparación; vuelve a consultar.");
                    throw lectura.errores[0] || e;
                }
                if (lectura.errores.length) throw lectura.errores[0];
                if (sello(estado()) !== selloInicial) throw fallo("FUENTE_CAMBIADA", "El Libro cambió durante la comparación; vuelve a consultar.");
                result.cobertura = consultasHojas;
                return exportar(result, { periodo, fuente: metadata, generatedAt, modelo: deps.motor.modeloPresentacionComparacion(result) });
            } catch (e) {
                return { schemaVersion, intent: "comparar_libro_mes_actual", mode: "read-only", canonicalRevision, generatedAt,
                    status: "error", periodo, error: { code: fallosPropios.has(e) ? e.code : "ERROR_LECTURA",
                        message: fallosPropios.has(e) ? e.message : "No se pudo completar la comparación canónica." },
                    fuente: null, alcance: null, comparacion: null, pagosDetalle: null, serviciosDetalle: null,
                    advertencias: null, cobertura: null, contexto: null, presentacion: null };
            }
        }
        return Object.freeze({ compararMes });
    }
    const api = Object.freeze({ schemaVersion, canonicalRevision, crearNucleo, exportar });
    root.HAIKU_LIBRO_COMPARACION_READONLY_V1 = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
