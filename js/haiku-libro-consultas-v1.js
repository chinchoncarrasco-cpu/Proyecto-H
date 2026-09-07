(function (root) {
    "use strict";
    const S = root.HAIKU_LIBRO_SEMANTICA;
    if (!S) return;
    const money = v => v === null || v === undefined ? "monto no determinado" : `$${Number(v).toLocaleString("es-CL")} CLP`;
    const source = x => `${x?.hoja || ""}!${x?.celda || ""}`;
    const nombresMes = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    function interpretar(texto, hojas) {
        const t = S.normalizar(texto), warnings = [];
        const fechas = [...t.matchAll(/\b\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})\b/g)].map(m => S.fechaTexto(m[0]));
        const isoDates = [...t.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(m => m[0]);
        if (isoDates.length) fechas.push(...isoDates);
        let desde = fechas[0], hasta = fechas[1] || fechas[0];
        const monthMatch = t.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
        let month = monthMatch ? nombresMes.indexOf(monthMatch[1] === "setiembre" ? "septiembre" : monthMatch[1]) : -1;
        const literal = hojas.find(h => /^[a-z]{3}\s*\d{2}$/.test(S.normalizar(h)) && t.replace(/\s/g, "").includes(S.normalizar(h).replace(/\s/g, "")));
        if (!desde && month >= 0) {
            const year = t.match(/\b20\d{2}\b/)?.[0] || new Date().getFullYear();
            if (!t.match(/\b20\d{2}\b/)) warnings.push(`Interpreto el mes en ${year}; indica otro año si corresponde.`);
            const days = t.match(/\b(?:del?|el)\s+(\d{1,2})(?:\s+al\s+(\d{1,2}))?\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)/);
            desde = S.iso(year, month + 1, days?.[1] || 1);
            hasta = days ? S.iso(year, month + 1, days[2] || days[1]) : new Date(Date.UTC(Number(year), month + 1, 0)).toISOString().slice(0, 10);
        }
        if (!desde && literal && /^([a-z]{3})\s*(\d{2})$/i.test(literal)) {
            const m = literal.match(/^([a-z]{3})\s*(\d{2})$/i), mo = S.meses.indexOf(m[1].toLowerCase());
            if (mo >= 0) { desde = S.iso(2000 + Number(m[2]), mo + 1, 1); hasta = new Date(Date.UTC(2000 + Number(m[2]), mo + 1, 0)).toISOString().slice(0, 10); }
        }
        if (fechas.some(x => !x) || (desde && (!S.iso(...desde.split("-")) || !S.iso(...hasta.split("-")) || hasta < desde))) throw new Error("Revisa las fechas: el intervalo no es válido.");
        if (hasta && /inclu\w*\s+(?:el\s+)?lunes/.test(t)) {
            const dia = new Date(hasta + "T12:00:00Z").getUTCDay();
            if (dia === 0) hasta = S.sumarDias(hasta, 1);
            else if (dia !== 1) throw new Error("Indica la fecha del lunes que quieres incluir.");
        }
        if (desde && (Date.parse(hasta) - Date.parse(desde)) / 86400000 > 62) throw new Error("Consulta como máximo 62 días a la vez.");
        let seleccion = [];
        if (desde) {
            for (let d = desde; d <= hasta; d = S.sumarDias(d, 1)) {
                const key = S.meses[Number(d.slice(5, 7)) - 1] + d.slice(2, 4);
                const h = hojas.find(h => S.normalizar(h).replace(/\s/g, "") === key);
                if (!h) throw new Error(`No encuentro la hoja ${key} en el Libro cargado.`);
                if (!seleccion.includes(h)) seleccion.push(h);
            }
        }
        const guest = t.match(/\b(?:reserva|huesped|titular)\s+(?:de\s+)?(.+?)(?=\s+(?:del?\s+cab|en\s+cab|cab\s*\d|el\s+\d|del?\s+\d|y\s+(?:dime|compara|revisa))|[?.]|$)/)?.[1]?.trim();
        const nombre = guest && !/^(libro|reservas|que|del|actual|anterior|faltan|nuevas|cancelad)/.test(guest) ? guest : null;
        if (!seleccion.length && nombre) {
            seleccion = hojas.filter(h => /^([a-z]{3})\s*\d{2}$/i.test(S.normalizar(h)) && S.meses.includes(S.normalizar(h).slice(0, 3)));
            warnings.push("Búsqueda por nombre en las hojas mensuales; se omiten hojas con geometría desconocida.");
        }
        const listar = /(?:lista|cuales|que)\b.*\bhojas\b/.test(t);
        if (!seleccion.length && !listar) throw new Error("Indica una fecha completa, un mes con año o un titular. Ejemplo: «Libro: CAB 6 el 05-09-26».");
        return { texto, desde, hasta, hojas: seleccion, nombre, cabana: Number(t.match(/\b(?:cab|cabana)\s*(\d{1,2})\b/)?.[1]) || null,
            listar, versiones: /cambio|cambios|version|anterior/.test(t), comparar: /compara|sistema|supabase|proyecto h|calendario/.test(t),
            escribir: /\b(agrega|agregar|crea|crear|registra|registrar|incorpora|incorporar|modifica|modificar|borra|borrar|elimina|eliminar)\b/.test(t),
            aseo: /aseo|reviso|revision|camarero/.test(t), libres: /vender|libres|disponib/.test(t), checkedout: /checked\s*out/.test(t),
            pendientes: /pendiente|bove|manager/.test(t), alertas: /alerta|solicitud|nota/.test(t), warnings };
    }
    function coincidenciasAnotaciones(items, nombre) {
        const filas = new Set(items.filter(a => S.normalizar(a.texto_original).includes(nombre)).map(a => a.origen.fila));
        return items.filter(a => filas.has(a.origen.fila));
    }
    function filtrar(r, q) {
        return (!q.cabana || r.cabana === q.cabana) && (!q.nombre || S.normalizar(r.titular).includes(q.nombre)) &&
            (!q.desde || r.fechas_ocupadas.some(d => d >= q.desde && d <= q.hasta));
    }
    async function paginas(build) {
        const rows = [];
        for (let start = 0; start < 5000; start += 500) {
            const { data, error } = await build().order("id").range(start, start + 499);
            if (error) throw new Error("No se pudo consultar Proyecto H con tu sesión. No se concluye que falten registros.");
            if (!Array.isArray(data)) throw new Error("Respuesta incompleta de Proyecto H.");
            rows.push(...data);
            if (data.length < 500) return rows;
        }
        throw new Error("La consulta supera el límite seguro de registros; reduce las fechas.");
    }
    async function compararSistema(reservas, cliente) {
        if (!cliente?.auth?.getSession) throw new Error("Inicia sesión en Proyecto H para comparar.");
        const { data: sesion, error } = await cliente.auth.getSession();
        if (error || !sesion?.session) throw new Error("Inicia sesión en Proyecto H para comparar.");
        if (!reservas.length) return [];
        const desde = reservas.map(r => r.fecha_checkin).sort()[0], hasta = reservas.map(r => r.fecha_checkout).sort().at(-1);
        const raw = await paginas(() => cliente.from("reserva_estadias")
            .select("id,reserva_id,fecha_ingreso,fecha_salida,estado_estadia,tipo_estadia,cabanas(numero),reservas(id,titular_nombre,titular_numero_documento,correo_contacto,telefono_contacto,estado_reserva)")
            .lte("fecha_ingreso", S.sumarDias(hasta, 31)).gte("fecha_salida", S.sumarDias(desde, -31)));
        const system = raw.map(e => ({ id: e.id, reserva_id: e.reserva_id, cabana: e.cabanas?.numero,
            titular: e.reservas?.titular_nombre, rut_documento: e.reservas?.titular_numero_documento, correo: e.reservas?.correo_contacto,
            telefono: e.reservas?.telefono_contacto, fecha_checkin: e.fecha_ingreso, fecha_checkout: e.fecha_salida, estado_operativo: e.estado_estadia, estado_reserva: e.reservas?.estado_reserva }));
        const resultados = reservas.map(r => ({ libro: r, ...S.asociar(r, system), diferencias: [] }));
        const ids = [...new Set(resultados.filter(r => r.estado === "asociada").map(r => r.sistema.reserva_id))];
        const pagos = [], servicios = [];
        for (let i = 0; i < ids.length; i += 50) {
            const grupo = ids.slice(i, i + 50);
            pagos.push(...await paginas(() => cliente.from("pagos").select("id,reserva_id,monto,moneda,estado,folio,codigo_autorizacion,bove,datos_origen").in("reserva_id", grupo)));
            servicios.push(...await paginas(() => cliente.from("servicios").select("id,reserva_id,fecha_servicio,total,estado_servicio,catalogo_servicios(nombre)").in("reserva_id", grupo)));
        }
        for (const result of resultados) {
            if (result.estado !== "asociada") continue;
            const r = result.libro, s = result.sistema;
            for (const key of ["cabana", "fecha_checkin", "fecha_checkout", "telefono", "correo", "estado_operativo"]) {
                const canon = v => key === "telefono" ? String(v).replace(/\D/g, "") : S.normalizar(v);
                if (r[key] && r[key] !== "no_determinado" && s[key] && canon(r[key]) !== canon(s[key])) result.diferencias.push(`${key}: Libro «${r[key]}» / Proyecto H «${s[key]}»`);
            }
            if (/cancelad|reembols/.test(s.estado_reserva || "")) result.diferencias.push(`Proyecto H figura ${s.estado_reserva}; revisar con la reserva visible en el Libro.`);
            for (const p of r.pagos) {
                const matched = pagos.filter(x => x.reserva_id === s.reserva_id && ((p.codigo_autorizacion && x.codigo_autorizacion === p.codigo_autorizacion) || (p.folio && p.bovtar && x.folio === p.folio && String(x.datos_origen?.bovtar || "") === p.bovtar)));
                if (matched.length === 1) {
                    const x = matched[0];
                    if (p.monto !== null && (Number(x.monto) !== p.monto || x.moneda !== p.moneda)) result.diferencias.push(`Monto/moneda diferente en ${source(p.origen)}.`);
                    if (p.bove && String(x.bove || "") !== p.bove) result.diferencias.push(`BOVE diferente en ${source(p.origen)}.`);
                } else result.diferencias.push(`${source(p.origen)}: pago sin correspondencia inequívoca (${p.estado_pago}). Revisar; no se incorpora automáticamente.`);
            }
            for (const service of r.servicios) {
                if (!servicios.some(x => x.reserva_id === s.reserva_id && S.normalizar(x.catalogo_servicios?.nombre).includes(service.concepto.replace(/_/g, " ")))) result.diferencias.push(`Servicio mencionado sin coincidencia por concepto: ${service.concepto}. La fecha y el monto requieren revisión.`);
            }
        }
        return resultados;
    }
    async function consultar(texto, libro = root.HAIKU_LIBRO_RESERVA_V1, cliente = root.haikuSupabase) {
        if (!libro) throw new Error("Abre Libro de Reserva y carga un XLSX primero.");
        await libro.listo();
        const estado = libro.estado(), hojas = libro.listarHojas();
        if (!estado.cargado) throw new Error("Carga primero un XLSX en Libro de Reserva.");
        const q = interpretar(texto, hojas);
        if (q.listar) return { q, archivo: estado.nombre, hojas, reservas: [], aseos: [], espacios: [], anotaciones: [], cambios: [], comparacion: [] };
        const resultado = { q, archivo: estado.nombre, reservas: [], aseos: [], espacios: [], anotaciones: [], cambios: [], comparacion: [], advertencias: [...q.warnings] };
        if (q.nombre && !q.desde && libro.buscarHojas) {
            const matches = await libro.buscarHojas(q.nombre);
            q.hojas = q.hojas.filter(h => matches.hojas.includes(h));
        }
        for (const h of q.hojas) {
            const data = await libro.consultarHoja(h);
            resultado.advertencias.push(...data.advertencias);
            resultado.reservas.push(...data.reservas.filter(r => filtrar(r, q)));
            resultado.aseos.push(...data.aseos.filter(a => (!q.cabana || a.cabana === q.cabana) && (!q.desde || a.fecha >= q.desde && a.fecha <= q.hasta)));
            resultado.espacios.push(...data.espacios.filter(a => (!q.cabana || a.cabana === q.cabana) && (!q.desde || a.fecha >= q.desde && a.fecha <= q.hasta)));
            if (q.nombre) resultado.anotaciones.push(...coincidenciasAnotaciones(data.anotaciones, q.nombre));
            if (q.versiones) {
                const old = await libro.consultarHoja(h, "anterior");
                resultado.cambios.push(...S.compararVersiones(old, data).filter(c => !c.actual && !c.anterior || (c.actual && filtrar(c.actual, q)) || (c.anterior && filtrar(c.anterior, q))));
            }
        }
        if (q.nombre) for (const h of hojas.filter(h => /reagendar|reembolso/i.test(h))) {
            const data = await libro.consultarHoja(h);
            resultado.anotaciones.push(...coincidenciasAnotaciones(data.anotaciones, q.nombre));
        }
        if (q.comparar) resultado.comparacion = await compararSistema(resultado.reservas, cliente);
        if (libro.estado().generacion !== estado.generacion) throw new Error("El Libro cambió durante la consulta. Vuelve a preguntar.");
        return resultado;
    }
    const etiquetas = { sin_checkin: "Sin Check-In según texto negro", hospedada: "Hospedada según texto blanco", checked_out: "Checked Out según texto azul", no_determinado: "No determinado", confirmada_por_color: "Confirmada según fondo lila", pendiente_por_color: "Pendiente de confirmación según fondo rosado" };
    function respuesta(result) {
        const q = result.q;
        if (q.listar) return `Libro ${result.archivo}: ${result.hojas.join(", ")}.`;
        const lines = [`LIBRO · SÓLO LECTURA · ${result.archivo}`, q.desde ? `Consulta: ${q.desde} al ${q.hasta}${q.cabana ? ` · CAB ${q.cabana}` : ""}` : "Búsqueda por titular."];
        if (q.escribir) lines.push("Esta etapa sólo lee y compara. No crearé reservas, pagos ni servicios desde el Libro; primero debemos validar su interpretación.");
        if (q.versiones) {
            lines.push(`${result.cambios.length} diferencias detectadas en el intervalo.`);
            for (const c of result.cambios) lines.push(`${c.tipo}: ${c.actual?.titular || c.anterior?.titular || c.detalle} · ${(c.campos || []).join(", ")} · ${source(c.actual?.coordenadas_origen || c.anterior?.coordenadas_origen)}`);
            lines.push("Que una reserva ya no aparezca no prueba una cancelación: puede haberse movido o cambiado de titular.");
        } else if (q.libres) {
            const libres = result.espacios.filter(x => x.estado === "libre_explicito");
            lines.push(`${libres.length} marcas explícitas de LIBRE:`);
            for (const x of libres) lines.push(`${x.fecha} · CAB ${x.cabana} · ${source(x.origen)}`);
            lines.push("Una celda vacía o marcada FULL DAY no se considera disponibilidad confirmada. Contrasta bloqueos y ocupación de Proyecto H antes de vender.");
        } else {
            const rs = result.reservas.filter(r => (!q.checkedout || r.estado_operativo === "checked_out") &&
                (!q.pendientes || q.cabana || r.pagos_pendientes.length || [...r.pagos, ...r.pagos_sin_asociacion].some(p => p.bove_pendiente || p.manager_pendiente || p.estado_pago !== "registrado_en_libro")) &&
                (!q.alertas || q.cabana || r.notas_importantes.length));
            lines.push(`${rs.length} reservas identificadas. Los datos describen la copia cargada, no una actualización en vivo.`);
            for (const r of rs) {
                lines.push(`\nCAB ${r.cabana} · ${r.titular} · ${source(r.coordenadas_origen)}`,
                    `${r.fecha_checkin} → ${r.fecha_checkout} · ${r.tipo_estadia === "full_day" ? "Full Day" : `${r.noches} noches`}`,
                    `${etiquetas[r.estado_confirmacion] || r.estado_confirmacion}. ${etiquetas[r.estado_operativo]}.`,
                    `Adultos: ${r.adultos ?? "sin dato"}; niños: ${r.ninos ?? "sin dato"}; mascotas: ${r.mascotas ?? "sin dato"}.`);
                if (r.rut_documento || r.correo || r.telefono) lines.push([r.rut_documento, r.correo, r.telefono].filter(Boolean).join(" · "));
                if (r.operador || r.fecha_ingreso_libro) lines.push(`Ingreso al Libro: ${r.fecha_ingreso_libro || "sin fecha"} · operador ${r.operador || "sin dato"}.`);
                for (const note of r.notas_importantes) lines.push(`Nota roja: ${note}`);
                for (const pending of r.pagos_pendientes) lines.push(`Pendiente mencionado: ${pending}`);
                for (const service of r.servicios) lines.push(`Servicio: ${service.concepto} · ${service.texto_original}`);
                lines.push(`Pagos: se revisó el bloque del Check-In ${r.fecha_checkin}.`);
                for (const [items, seguro] of [[r.pagos, true], [r.pagos_sin_asociacion, false]]) for (const p of items) {
                    lines.push(`${seguro ? "Pago asociado" : "Movimiento del bloque SIN asociación segura al titular"}: ${p.tipo_movimiento} · ${money(p.monto)} · ${p.estado_pago} · ${source(p.origen)}`, p.texto_original);
                    if (p.bove_pendiente || p.manager_pendiente) lines.push(`Trámite administrativo pendiente: ${p.bove_pendiente ? "BOVE " : ""}${p.manager_pendiente ? "Manager" : ""}. No equivale a deuda del cliente.${r.estado_operativo === "checked_out" ? " La reserva figura Checked Out: revisar posible atraso." : ""}`);
                    if (p.tipo_movimiento === "penalidad") lines.push(`Penalidad ${p.penalidad_porcentaje ?? "?"}% · ${money(p.monto_penalidad)}; saldo indicado: ${money(p.saldo_por_pagar)}. No se suma como pago.`);
                }
                if (!r.pagos.length && !r.pagos_sin_asociacion.length) lines.push(r.cobertura_pagos ? "El bloque revisado no registra movimientos; no es una certificación de deuda." : "No pude verificar el bloque financiero; no puedo concluir que no tenga abonos.");
                for (const warning of r.advertencias) lines.push(`Revisar: ${warning}`);
            }
            // Cleaning belongs to its own date, never to a merged reservation's check-in by default.
            if (q.aseo || q.cabana) {
                lines.push("\nASEO DEL INTERVALO CONSULTADO");
                for (const a of result.aseos) lines.push(`${a.fecha} · CAB ${a.cabana} · ${source(a.origen)}: salida ${a.checkout_por || "no registrada"}; aseo ${a.camarero || "no registrado"}; ${a.hora_inicio || "?"}–${a.hora_fin || "?"}; IN ${a.ingreso || "no registrado"}; revisó ${a.revisado_por || "no registrado"}.`);
                if (!result.aseos.length) lines.push("No encontré un registro de aseo para esas fechas; no inferí quién lo hizo.");
            }
        }
        for (const c of result.comparacion) {
            lines.push(`\nCOMPARACIÓN · ${c.libro.titular}: ${c.estado === "asociada" ? "asociación inequívoca con los datos disponibles" : c.estado === "ambigua" ? "No puedo asociarla con seguridad" : "Sin coincidencia en los registros visibles del intervalo ampliado; revisar antes de incorporarla"}.`);
            lines.push(...c.diferencias);
            if (c.estado === "asociada" && !c.diferencias.length) lines.push("Sin diferencias en los campos verificados. Esto no certifica pagos sin identificadores ni servicios ambiguos.");
        }
        for (const a of result.anotaciones) lines.push(`Coincidencia textual sin asociación automática · ${source(a.origen)}: ${a.texto_original}`);
        lines.push(...[...new Set(result.advertencias || [])]);
        return lines.join("\n");
    }
    root.HAIKU_LIBRO_CONSULTAS = Object.freeze({ interpretar, consultar, compararSistema, respuesta });
    if (typeof module !== "undefined") module.exports = root.HAIKU_LIBRO_CONSULTAS;
    if (!root.document) return;
    let ocupado = false;
    const esLibro = texto => /\blibro\b/i.test(texto);
    function mensaje(tipo, texto) {
        const el = document.createElement("div"); el.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`;
        el.dataset.haikuLibroRespuesta = "1"; el.textContent = texto; document.getElementById("haiku-asistente-mensajes")?.append(el); return el;
    }
    async function enviar(texto) {
        ocupado = true;
        const campo = document.getElementById("haiku-asistente-texto"), boton = document.getElementById("haiku-asistente-enviar");
        campo.disabled = true; boton.disabled = true; campo.value = "";
        mensaje("usuario", texto); const out = mensaje("asistente", "Leyendo la estructura del Libro local…");
        try { out.textContent = respuesta(await consultar(texto)); }
        catch (error) { out.textContent = error.message || "No pude completar la lectura del Libro."; }
        finally { ocupado = false; campo.disabled = false; campo.dispatchEvent(new Event("input", { bubbles: true })); out.scrollIntoView({ block: "nearest" }); }
    }
    function interceptar(event) {
        const target = event.type === "click" ? event.target?.closest?.("#haiku-asistente-enviar") : event.target?.id === "haiku-asistente-texto" && (event.ctrlKey || event.metaKey) && event.key === "Enter";
        if (!target) return;
        const texto = document.getElementById("haiku-asistente-texto")?.value.trim();
        if (!esLibro(texto)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (ocupado || root.HAIKU_ASISTENTE?.procesando?.()) return;
        if (document.querySelector("#haiku-asistente-adjuntos .haiku-asistente-adjunto")) { mensaje("asistente", "Para consultar el Libro, retira las capturas adjuntas. Usaré el XLSX cargado en Libro de Reserva."); return; }
        enviar(texto);
    }
    // Window capture precedes the existing document-level routes; only Libro messages are claimed.
    root.addEventListener("click", interceptar, true);
    root.addEventListener("keydown", interceptar, true);
    root.addEventListener("haiku:libro-cambio", () => {
        document.querySelectorAll('[data-haiku-libro-respuesta="1"]').forEach(el => { el.textContent = "Consulta del Libro anterior invalidada: el archivo cambió o se quitó. Vuelve a preguntar."; });
    });
    const acciones = document.querySelector("#seccion-libro-reserva .libro-reserva-acciones");
    const nota = document.querySelector("#seccion-libro-reserva .libro-reserva-nota span:last-child");
    if (nota) nota.textContent = "Haku puede consultar esta copia local sin modificar el original ni guardarla en Google o Supabase. En PC se conservan como máximo el Libro actual y el anterior; Quitar libro de memoria borra ambos.";
    if (acciones && root.matchMedia("(min-width: 901px)").matches) {
        const boton = document.createElement("button"); boton.type = "button"; boton.className = "libro-reserva-boton secundario";
        boton.textContent = "Consultar Libro con Haku";
        boton.addEventListener("click", () => {
            root.HAIKU_ASISTENTE?.abrir?.();
            const campo = document.getElementById("haiku-asistente-texto");
            if (campo) { campo.value = "Libro: "; campo.dispatchEvent(new Event("input", { bubbles: true })); campo.focus(); }
        });
        acciones.append(boton);
    }
})(typeof window !== "undefined" ? window : globalThis);
