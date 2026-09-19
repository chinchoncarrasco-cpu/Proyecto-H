// ========================================
// HAKU · SERVICIOS + NOTAS DEL LIBRO V2
// - Separa servicios reales de notas operativas.
// - Puede inferir fecha/personas sólo cuando la operación lo hace inequívoco.
// - Nunca adivina tipo de tinaja ni fecha en estadías de varias noches.
// - Servicios y notas se revalidan y se guardan en una sola transacción.
// ========================================
(function (root) {
    "use strict";

    if (!root.document || root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2) return;

    const MESES = Object.freeze({
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
        julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
        noviembre: 11, diciembre: 12
    });
    const DIAS = Object.freeze({ domingo: 0, dom: 0, lunes: 1, lun: 1, martes: 2, mar: 2, miercoles: 3, mie: 3, jueves: 4, jue: 4, viernes: 5, vie: 5, sabado: 6, sab: 6 });
    const PREFIJOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    let ocupado = false;
    const nochesPorVista = new WeakMap();

    function normalizar(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function iso(y, m, d) {
        const yy = Number(y), mm = Number(m), dd = Number(d);
        const fecha = new Date(Date.UTC(yy, mm - 1, dd));
        if (fecha.getUTCFullYear() !== yy || fecha.getUTCMonth() !== mm - 1 || fecha.getUTCDate() !== dd) return null;
        return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }

    function sumarDias(fecha, dias) {
        const d = new Date(`${fecha}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + dias);
        return d.toISOString().slice(0, 10);
    }

    function diferenciaDias(inicio, fin) {
        if (!inicio || !fin) return null;
        const a = Date.parse(`${inicio}T12:00:00Z`), b = Date.parse(`${fin}T12:00:00Z`);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        return Math.round((b - a) / 86400000);
    }

    function rangoDesdeTexto(texto) {
        const t = normalizar(texto);
        const fechas = [...t.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g)].map(m => {
            let y = Number(m[3]);
            if (y < 100) y += 2000;
            return iso(y, Number(m[2]), Number(m[1]));
        }).filter(Boolean);
        if (fechas.length >= 2) return { desde: fechas[0], hasta: fechas[1] };
        if (fechas.length === 1) return { desde: fechas[0], hasta: fechas[0] };
        const mes = t.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/);
        if (!mes) return null;
        const numero = MESES[mes[1]], year = Number(mes[2]);
        const ultimo = new Date(Date.UTC(year, numero, 0)).getUTCDate();
        return { desde: iso(year, numero, 1), hasta: iso(year, numero, ultimo) };
    }

    function esConsultaServicios(texto) {
        const t = normalizar(texto);
        if (!/\blibro\b/.test(t)) return false;
        if (!/\bservicios?\b|\btinajas?\b|\bjacuzzi\b|\bmasajes?\b|\blate\s*(?:check\s*)?out\b|\bcamas?\s+adicional(?:es)?\b|\bcunas?\b/.test(t)) return false;
        return /\brevisa|revisar|busca|buscar|lista|listar|muestra|mostrar|compara|comparar|pasa|pasar|agrega|agregar|incorpora|incorporar|registra|registrar|servicios?\b/.test(t);
    }

    function quiereIncorporar(texto) {
        return /\b(?:pasa|pasar|pasalos|pasalas|agrega|agregar|agregalos|agregalas|incorpora|incorporar|incorporalos|incorporalas|registra|registrar|registralos|registralas)\b/.test(normalizar(texto));
    }

    function hojasDelRango(nombres, desde, hasta) {
        const hojas = [];
        let cursor = `${desde.slice(0, 7)}-01`;
        const fin = `${hasta.slice(0, 7)}-01`;
        while (cursor <= fin) {
            const mes = Number(cursor.slice(5, 7)), yy = cursor.slice(2, 4), clave = `${PREFIJOS[mes - 1]}${yy}`;
            const hoja = nombres.find(h => normalizar(h).replace(/\s/g, "") === clave);
            if (!hoja) throw new Error(`No encuentro la hoja ${clave} en el Libro cargado.`);
            hojas.push(hoja);
            const d = new Date(`${cursor}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1);
            cursor = d.toISOString().slice(0, 7) + "-01";
        }
        return [...new Set(hojas)];
    }

    function solapa(reserva, desde, hasta) {
        return Boolean(reserva?.fecha_checkin && reserva?.fecha_checkout && reserva.fecha_checkin <= hasta && reserva.fecha_checkout >= desde);
    }

    function hashCorto(texto) {
        let h = 2166136261;
        for (const ch of String(texto || "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(36);
    }

    function claveServicio(reserva, servicio) {
        const identidadReserva = [reserva?.titular, reserva?.rut_documento, reserva?.cabana,
            reserva?.fecha_checkin, reserva?.fecha_checkout].map(normalizar).join(":");
        return `srv:${hashCorto(`${identidadReserva}:${servicio?.concepto || "servicio"}:${normalizar(servicio?.texto_original)}`)}`;
    }

    function claveNota(reserva, texto) {
        const origen = reserva?.coordenadas_origen || {};
        return `nota:${hashCorto(`${origen.hoja || reserva?.hoja || "libro"}:${origen.celda || reserva?.id || "fila"}:${normalizar(texto)}`)}`;
    }

    function depurarServicios(reserva) {
        const grupos = new Map();
        for (const servicio of Array.isArray(reserva?.servicios) ? reserva.servicios : []) {
            const key = normalizar(servicio?.texto_original);
            if (!grupos.has(key)) grupos.set(key, []);
            grupos.get(key).push(servicio);
        }
        const salida = [];
        for (const items of grupos.values()) {
            const conceptos = new Set(items.map(x => x.concepto));
            for (const item of items) {
                if (item.concepto === "tinaja" && (conceptos.has("jacuzzi") || conceptos.has("tonel"))) continue;
                salida.push(item);
            }
        }
        return salida;
    }

    function fragmentosReserva(texto) {
        return String(texto || "").split(/\s*\/\/\s*|\n|;/).map(x => x.trim()).filter(Boolean);
    }

    function textoNotaBatas(fragmento) {
        const m = String(fragmento || "").match(/dejar\s+batas(?:\s+en\s+(?:la\s+)?caba(?:n|ñ)a(?:s)?)?/i);
        return m ? m[0].replace(/^./, x => x.toUpperCase()) : null;
    }

    function esNotaConocida(fragmento) {
        const t = normalizar(fragmento);
        return /lista\s+arcoiris|huesped\s+frecuente|trato\s+especial|iva\s+descontad|solicita?r?\s+factura|promo\s+haiku|voucher\s+regalo|cama\s+adicional|agregar\s+cama|\bcuna\b|coordinar.{0,35}tinaja|tinaja.{0,35}coordinar|pedir.{0,30}(?:documento|pasaporte|dni|rut)|presentar.{0,30}(?:documento|pasaporte|dni|rut)|solicitar.{0,30}(?:documento|pasaporte|dni|rut)|\bno\s+mover\b|sacacorchos|juegos?\s+de\s+mesa|articulos?\s+de\s+asado|cenicero|paraguas|trapero|prest(?:a|ado|ados|ada|adas)|batas\s+en\s+caba/.test(t);
    }

    function notaImportante(texto) {
        const t = normalizar(texto);
        return /lista\s+arcoiris|huesped\s+frecuente|trato\s+especial|cama\s+adicional|\bcuna\b|dejar\s+batas|coordinar|documento|pasaporte|\bdni\b|\brut\b|factura|\bno\s+mover\b|sacacorchos|juegos?\s+de\s+mesa|articulos?\s+de\s+asado|cenicero|paraguas|trapero|prest/.test(t);
    }

    function servicioDebeSerNota(servicio) {
        const t = normalizar(servicio?.texto_original), c = servicio?.concepto;
        if (c === "cama_adicional" || c === "cuna") return true;
        if (c === "tinaja") return true;
        if (["jacuzzi", "tonel"].includes(c) && /\b(?:x|por)\s+confirmar\b|\bcoordinar\b|\bpor\s+coordinar\b|\bconsultar\b/.test(t)) return true;
        return false;
    }

    function extraerNotasReserva(reserva, servicios) {
        const notas = [];
        for (const s of servicios) if (servicioDebeSerNota(s)) notas.push(s.texto_original);
        for (const frag of fragmentosReserva(reserva?.texto_original)) {
            const batas = textoNotaBatas(frag);
            if (batas) notas.push(batas);
            if (esNotaConocida(frag)) notas.push(frag);
        }
        const unicas = new Map();
        for (const texto of notas.map(x => String(x || "").trim()).filter(Boolean)) {
            const k = normalizar(texto);
            if (!unicas.has(k)) unicas.set(k, texto);
        }
        return [...unicas.values()];
    }

    async function leerLibro(texto) {
        const libro = root.HAIKU_LIBRO_RESERVA_V1;
        if (!libro) throw new Error("Abre Libro de Reserva y carga un XLSX primero.");
        await libro.listo();
        const estado = libro.estado();
        if (!estado?.cargado) throw new Error("Carga primero un XLSX en Libro de Reserva.");
        const rango = rangoDesdeTexto(texto);
        if (!rango) throw new Error("Indica un mes con año o una fecha para revisar los servicios del Libro.");
        const hojas = hojasDelRango(libro.listarHojas(), rango.desde, rango.hasta);
        const reservas = [];
        for (const hoja of hojas) {
            const data = await libro.consultarHoja(hoja);
            for (const r of Array.isArray(data?.reservas) ? data.reservas : []) if (solapa(r, rango.desde, rango.hasta)) reservas.push(r);
        }
        return { ...rango, hojas, reservas, archivo: estado.nombre, generacion: estado.generacion };
    }

    function canonDocumento(v) { return normalizar(v).replace(/[^a-z0-9]/g, "").replace(/^0+/, ""); }
    function canonTelefono(v) { return String(v || "").replace(/\D/g, "").slice(-8); }

    function mismaPersona(libro, sistema) {
        const nombre = normalizar(libro?.titular) === normalizar(sistema?.titular_nombre);
        const docA = canonDocumento(libro?.rut_documento), docB = canonDocumento(sistema?.titular_numero_documento);
        const mailA = normalizar(libro?.correo), mailB = normalizar(sistema?.correo_contacto);
        const telA = canonTelefono(libro?.telefono), telB = canonTelefono(sistema?.telefono_contacto);
        const fuerte = Boolean((docA && docB && docA === docB) || (mailA && mailB && mailA === mailB) || (telA.length >= 8 && telB.length >= 8 && telA === telB));
        return { nombre, fuerte, compatible: nombre || fuerte, documentoDifiere: Boolean(docA && docB && docA !== docB) };
    }

    async function cargarSistema(desde, hasta, cliente) {
        const { data: estadias, error: e1 } = await cliente.from("reserva_estadias")
            .select("id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia")
            .lte("fecha_ingreso", hasta).gte("fecha_salida", desde);
        if (e1) throw e1;
        const activas = (estadias || []).filter(e => !/cancelad|no_show/i.test(String(e.estado_estadia || "")));
        const reservaIds = [...new Set(activas.map(e => e.reserva_id).filter(Boolean))];
        const cabanaIds = [...new Set(activas.map(e => e.cabana_id).filter(Boolean))];
        const [reservasResp, cabanasResp] = await Promise.all([
            reservaIds.length ? cliente.from("reservas").select("id,titular_nombre,titular_numero_documento,correo_contacto,telefono_contacto,estado_reserva").in("id", reservaIds) : Promise.resolve({ data: [], error: null }),
            cabanaIds.length ? cliente.from("cabanas").select("id,numero").in("id", cabanaIds) : Promise.resolve({ data: [], error: null })
        ]);
        if (reservasResp.error) throw reservasResp.error;
        if (cabanasResp.error) throw cabanasResp.error;
        const reservas = new Map((reservasResp.data || []).filter(r => !/cancelad|no_show/i.test(String(r.estado_reserva || ""))).map(r => [r.id, r]));
        const cabanas = new Map((cabanasResp.data || []).map(c => [c.id, c.numero]));
        // Mantener el ID de estadía: el ID de reserva ya está en reserva_id.
        return activas.map(e => ({ ...(reservas.get(e.reserva_id) || {}), ...e, cabana_numero: cabanas.get(e.cabana_id) })).filter(e => reservas.has(e.reserva_id));
    }

    function asociarReserva(libro, sistema) {
        const exactas = sistema.filter(s => Number(s.cabana_numero) === Number(libro.cabana) && s.fecha_ingreso === libro.fecha_checkin && s.fecha_salida === libro.fecha_checkout);
        const compatibles = exactas.filter(s => mismaPersona(libro, s).compatible);
        if (compatibles.length === 1) {
            const persona = mismaPersona(libro, compatibles[0]);
            return { estado: "asociada", sistema: compatibles[0], nota: persona.documentoDifiere ? "Asociada por nombre + CAB + fechas; el documento difiere, pero no se crea otra reserva." : null };
        }
        if (compatibles.length > 1) return { estado: "revisar", motivo: "Hay más de una reserva compatible con el mismo huésped, CAB y fechas." };
        if (exactas.length === 1) return { estado: "revisar", motivo: "Coinciden CAB y fechas, pero la identidad no permite asociarla con seguridad." };
        if (exactas.length > 1) return { estado: "revisar", motivo: "Hay varias reservas en Proyecto H con la misma CAB y fechas." };
        return { estado: "revisar", motivo: "No encontré una reserva de Proyecto H con la misma CAB y fechas." };
    }

    function fechaExplicita(texto, reserva) {
        // Sólo para fechas: una hora explícita como "a las 22.15" no es dd.mm.
        const t = normalizar(texto)
            .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, "-")
            .replace(/\ba\s+las?\s+(?:[01]?\d|2[0-3])[:.,][0-5]\d\b/g, " ");
        const completa = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
        if (completa) {
            let y = Number(completa[3]); if (y < 100) y += 2000;
            return iso(y, Number(completa[2]), Number(completa[1]));
        }
        const parcial = t.match(/\b(\d{1,2})[-/.](\d{1,2})(?![-/.]\d)\b/);
        if (parcial) return /^\d{4}-\d{2}-\d{2}$/.test(reserva.fecha_checkin || "")
            ? iso(Number(reserva.fecha_checkin.slice(0, 4)), Number(parcial[2]), Number(parcial[1])) : null;
        const dia = Object.keys(DIAS).find(nombre => new RegExp(`\\b${nombre}\\b`).test(t));
        if (!dia || !reserva.fecha_checkin || !reserva.fecha_checkout) return null;
        const candidatas = [];
        for (let d = reserva.fecha_checkin; d <= reserva.fecha_checkout; d = sumarDias(d, 1)) if (new Date(`${d}T12:00:00Z`).getUTCDay() === DIAS[dia]) candidatas.push(d);
        return candidatas.length === 1 ? candidatas[0] : null;
    }

    function horaTexto(texto, preferirHasta = false) {
        const t = normalizar(texto);
        const patrones = preferirHasta
            ? [/hasta\s+(?:las?\s+)?([0-2]?\d)[:.,]([0-5]\d)/, /hasta\s+(?:las?\s+)?([0-2]?\d)\s*(?:h|hr|hrs|hs)\b/]
            : [/\b([0-2]?\d)[:.,]([0-5]\d)\b/, /\b([0-2]?\d)\s*(?:h|hr|hrs|hs)\b/];
        for (const re of patrones) {
            const m = t.match(re); if (!m) continue;
            const hh = Number(m[1]), mm = m[2] === undefined ? 0 : Number(m[2]);
            if (hh <= 23 && mm <= 59) return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        }
        return null;
    }

    function minutosHora(hora) {
        if (!hora || !/^\d{2}:\d{2}$/.test(hora)) return null;
        const [h, m] = hora.split(":").map(Number);
        return h * 60 + m;
    }

    function nochesValidas(reserva, hora) {
        const { fecha_checkin: inicio, fecha_checkout: fin } = reserva || {};
        if (![inicio, fin].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && iso(...d.split('-')) === d)) return [];
        const n = diferenciaDias(inicio, fin), mins = minutosHora(hora);
        if (!Number.isInteger(n) || n < 1 || /full.?day/.test(normalizar(reserva.tipo_estadia)) ||
            (reserva.noches != null && Number(reserva.noches) !== n) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora || '') || !Number.isInteger(mins) || (mins > 720 && mins < 900)) return [];
        // Misma convención que una estadía de una noche: tarde en ingreso, mañana en salida.
        return Array.from({ length: n }, (_, i) => ({ noche_indice: i + 1, fecha: sumarDias(inicio, i + (mins <= 720 ? 1 : 0)) }));
    }

    function nocheOrdinal(texto) {
        const t = normalizar(texto), valores = [];
        const palabras = { primera: 1, segunda: 2, tercera: 3, cuarta: 4, quinta: 5, sexta: 6, septima: 7, octava: 8, novena: 9, decima: 10 };
        for (const m of t.matchAll(/\b(primera|segunda|tercera|cuarta|quinta|sexta|septima|octava|novena|decima|\d+(?:ra|era|da|ta|ma|a|ª|º)?)\s+noche\b|\bnoche\s+(\d+)\b/g)) {
            valores.push(m[2] ? Number(m[2]) : palabras[m[1]] || Number(m[1].match(/^\d+/)?.[0]));
        }
        return valores.length ? [...new Set(valores)] : null;
    }

    function inferirFechaServicio(reserva, servicio, hora) {
        const explicita = fechaExplicita(servicio?.texto_original, reserva);
        const ordinales = nocheOrdinal(servicio?.texto_original);
        if (ordinales) {
            const noche = ordinales.length === 1 && nochesValidas(reserva, hora).find(n => n.noche_indice === ordinales[0]);
            if (!noche || (explicita && explicita !== noche.fecha)) return { fecha: null, inferida: false, conflicto: true,
                detalle: 'La noche indicada es contradictoria, no existe en la estadía o no permite derivar una fecha segura.' };
            return { fecha: noche.fecha, inferida: true, detalle: `Fecha por Noche ${noche.noche_indice}: ${noche.fecha}.` };
        }
        if (explicita) return { fecha: explicita, inferida: false, detalle: null };
        const texto = normalizar(servicio?.texto_original), tipo = normalizar(reserva?.tipo_estadia);
        const mins = minutosHora(hora);
        if (tipo === "full_day" || tipo === "fullday" || reserva?.fecha_checkin === reserva?.fecha_checkout) {
            if (reserva?.fecha_checkin) return { fecha: reserva.fecha_checkin, inferida: true, detalle: "Fecha inferida: en un Full Day el servicio corresponde al mismo día (09:30–21:30)." };
        }
        const noches = Number.isInteger(reserva?.noches) ? reserva.noches : diferenciaDias(reserva?.fecha_checkin, reserva?.fecha_checkout);
        if (noches !== 1) return { fecha: null, inferida: false, detalle: null };
        if (Number.isInteger(mins)) {
            if (mins >= 15 * 60) return { fecha: reserva.fecha_checkin, inferida: true, detalle: `Fecha inferida por estadía de 1 noche: ${hora} es después del check-in de las 15:00, por lo que corresponde al día de ingreso.` };
            if (mins <= 12 * 60) return { fecha: reserva.fecha_checkout, inferida: true, detalle: `Fecha inferida por estadía de 1 noche: ${hora} es antes o a la hora del check-out de las 12:00, por lo que corresponde al día de salida.` };
            return { fecha: null, inferida: false, detalle: "El horario cae entre check-out (12:00) y check-in (15:00); no se infiere la fecha." };
        }
        if (/\btarde\b|\bnoche\b/.test(texto)) return { fecha: reserva.fecha_checkin, inferida: true, detalle: "Fecha inferida por estadía de 1 noche: al indicar tarde/noche corresponde al día de ingreso." };
        if (/\bmanana\b/.test(texto)) return { fecha: reserva.fecha_checkout, inferida: true, detalle: "Fecha inferida por estadía de 1 noche: al indicar mañana corresponde al día de salida." };
        return { fecha: null, inferida: false, detalle: null };
    }

    function personasTexto(texto) {
        const m = normalizar(texto).match(/\b(\d+)\s*(?:personas?|pax)\b/);
        return m ? Number(m[1]) : null;
    }

    function mapearConcepto(servicio) {
        const t = normalizar(servicio?.texto_original), concepto = servicio?.concepto;
        // El concepto ya segmentado manda. Un texto antiguo podía mencionar Jacuzzi y
        // Late Check-out juntos; inferir por el texto antes que por el concepto mezcló
        // el código de la tinaja con la fecha/hora del checkout.
        if (concepto === "lateout") return { codigo: "lateCheckout", nombre: "Late Check-out", requiereHorario: true, requierePersonas: false, permiteCortesia: false };
        if (concepto === "jacuzzi") return { codigo: "tinajaJacuzzi", nombre: "Tinaja Jacuzzi", requiereHorario: true, requierePersonas: true, permiteCortesia: true };
        if (concepto === "tonel") return { codigo: "tinajaTonel", nombre: "Tinaja Tonel de Madera", requiereHorario: true, requierePersonas: true, permiteCortesia: false };
        if (/\bjacuzzi\b/.test(t)) return { codigo: "tinajaJacuzzi", nombre: "Tinaja Jacuzzi", requiereHorario: true, requierePersonas: true, permiteCortesia: true };
        if (/\btonel\b|tinaja\s+de\s+madera/.test(t)) return { codigo: "tinajaTonel", nombre: "Tinaja Tonel de Madera", requiereHorario: true, requierePersonas: true, permiteCortesia: false };
        if (concepto === "masaje") {
            const minutos = Number(t.match(/\b(30|60)\s*min/)?.[1]);
            if (/relajante/.test(t) && /descontracturante/.test(t)) return { motivo: "La misma nota contiene dos masajes distintos; deben separarse antes de incorporarlos." };
            if (/descontractur/.test(t) && minutos) return { codigo: `masajeDescontracturante${minutos}`, nombre: `Masaje Descontracturante ${minutos} min`, requiereHorario: true, requierePersonas: false, permiteCortesia: false };
            if (/terapeut/.test(t) && minutos) return { codigo: `masajeTerapeutico${minutos}`, nombre: `Masaje Terapéutico ${minutos} min`, requiereHorario: true, requierePersonas: false, permiteCortesia: false };
            if (/relajante/.test(t)) return { motivo: "El Libro dice masaje relajante, pero ese nombre no tiene una equivalencia inequívoca en el catálogo actual." };
            return { motivo: "Falta precisar el tipo de masaje y si es de 30 o 60 minutos." };
        }
        return { motivo: "No hay una equivalencia segura con el catálogo de servicios de Proyecto H." };
    }

    function prepararServicio(reserva, servicio, asociacion, nocheManual = null) {
        const razones = [], inferencias = [];
        if (asociacion.estado !== "asociada") razones.push(asociacion.motivo);
        const mapa = mapearConcepto(servicio);
        if (!mapa.codigo) razones.push(mapa.motivo);
        const esLate = servicio.concepto === "lateout" || mapa.codigo === "lateCheckout";
        const hora = mapa.requiereHorario ? (esLate ? horaTexto(servicio.texto_original, true) : (servicio.hora || horaTexto(servicio.texto_original))) : null;
        if (mapa.requiereHorario && !hora) razones.push("Falta un horario inequívoco del servicio.");
        const fechaInfo = esLate ? { fecha: reserva.fecha_checkout, inferida: false, detalle: null } : inferirFechaServicio(reserva, servicio, hora);
        const opcionesNoches = nochesValidas(reserva, hora);
        if (nocheManual != null && !fechaInfo.fecha && !fechaInfo.conflicto) {
            const noche = opcionesNoches.find(n => n.noche_indice === nocheManual);
            if (noche) { fechaInfo.fecha = noche.fecha; fechaInfo.detalle = `Fecha confirmada: Noche ${nocheManual} · ${noche.fecha.split('-').reverse().join('/')}`; }
        }
        if (fechaInfo.conflicto) razones.push(fechaInfo.detalle);
        const fecha = fechaInfo.fecha;
        if (fechaInfo.detalle) inferencias.push(fechaInfo.detalle);
        if (!fecha) razones.push("Falta una fecha inequívoca del servicio; con estas noches/horario no se puede inferir sin adivinar.");

        const mins = minutosHora(hora);
        if ((normalizar(reserva.tipo_estadia) === "full_day" || reserva.fecha_checkin === reserva.fecha_checkout) && Number.isInteger(mins) && (mins < 570 || mins > 1290)) razones.push("El horario queda fuera del Full Day (09:30–21:30).");

        let personas = mapa.requierePersonas ? personasTexto(servicio.texto_original) : (mapa.codigo?.startsWith("masaje") ? 1 : 0);
        if (mapa.requierePersonas && !Number.isInteger(personas) && Number.isInteger(reserva?.adultos) && reserva.adultos > 0) {
            personas = reserva.adultos;
            inferencias.push(`Personas inferidas desde la ocupación de la reserva: ${reserva.adultos} adulto${reserva.adultos === 1 ? "" : "s"}.`);
        }
        if (mapa.requierePersonas && !Number.isInteger(personas)) razones.push("Falta indicar cuántas personas usarán la tinaja y la reserva no permite inferirlo.");
        if (mapa.codigo === "tinajaJacuzzi" && Number.isInteger(personas) && (personas < 1 || personas > 5)) razones.push("La cantidad de personas no es válida para Jacuzzi.");
        if (mapa.codigo === "tinajaTonel" && Number.isInteger(personas) && (personas < 1 || personas > 3)) razones.push("La cantidad de personas no es válida para Tonel de madera.");

        const cortesia = Boolean(servicio.cortesia || /\bcortesia\b|\bregalo\b/.test(normalizar(servicio.texto_original)));
        if (cortesia && mapa.codigo && !mapa.permiteCortesia) razones.push(`${mapa.nombre} no admite cortesía en el catálogo actual de Proyecto H.`);
        const itemId = claveServicio(reserva, servicio);
        return {
            kind: "servicio", item_id: itemId, reserva, servicio, asociacion, mapa, fecha, hora, personas, cortesia,
            opcionesNoches, nocheManual,
            puedeElegirNoche: !fecha && !fechaInfo.conflicto && razones.length === 1 && razones[0].startsWith('Falta una fecha inequívoca') && opcionesNoches.length > 0,
            inferencias: [...new Set(inferencias)], razones: [...new Set(razones.filter(Boolean))],
            payload: asociacion.estado === "asociada" && mapa.codigo && fecha ? {
                item_id: itemId,
                reserva_id: asociacion.sistema.reserva_id,
                estadia_id: asociacion.sistema.id,
                codigo_servicio: mapa.codigo,
                fecha_servicio: fecha,
                hora: hora || null,
                cantidad: 1,
                personas: Number.isInteger(personas) ? personas : 0,
                tipo_cobro: cortesia ? "cortesia" : "normal",
                precio_manual: null,
                motivo_cortesia: cortesia ? `Cortesía indicada en el Libro: ${servicio.texto_original}` : null,
                observaciones: `Importado desde Libro de Reserva. ${servicio.texto_original}`
            } : null
        };
    }

    function prepararNota(reserva, texto, asociacion) {
        const razones = [];
        if (asociacion.estado !== "asociada") razones.push(asociacion.motivo);
        const itemId = claveNota(reserva, texto);
        return {
            kind: "nota", item_id: itemId, reserva, texto, asociacion, inferencias: [], razones,
            payload: asociacion.estado === "asociada" ? {
                item_id: itemId,
                reserva_id: asociacion.sistema.reserva_id,
                estadia_id: asociacion.sistema.id,
                fecha_operacion: reserva.fecha_checkin || null,
                texto,
                importante: notaImportante(texto)
            } : null
        };
    }

    async function cargarExistentes(cliente, reservaIds) {
        if (!reservaIds.length) return { servicios: [], notas: [] };
        const [sr, nr] = await Promise.all([
            cliente.from("servicios").select("id,reserva_id,estadia_id,fecha_servicio,hora_inicio,hora_fin,total,cantidad,personas,tipo_cobro,estado_servicio,observaciones,catalogo_servicios(codigo,nombre)").in("reserva_id", reservaIds),
            cliente.from("notas").select("id,reserva_id,tipo,texto").in("reserva_id", reservaIds)
        ]);
        if (sr.error) throw sr.error;
        return { servicios: sr.data || [], notas: nr.error ? [] : (nr.data || []) };
    }

    function codigoExistente(x) {
        const c = x?.catalogo_servicios;
        return Array.isArray(c) ? c[0]?.codigo || null : c?.codigo || null;
    }

    function decisionServicioExistente(item, existentes) {
        const reservaId = item.payload?.reserva_id || (item.asociacion?.estado === 'asociada' ? item.asociacion.sistema.reserva_id : null);
        if (!reservaId) return { estado: "revisar", motivo: "Falta la reserva destino para comprobar el servicio." };
        const identidad = root.HAIKU_SERVICIOS_IDENTIDAD_V1;
        if (identidad?.resolverServicio && item.payload) {
            return identidad.resolverServicio({
                ...item.payload,
                total: item.servicio?.monto,
                item_id: item.item_id
            }, existentes);
        }
        const hora = String(item.hora || "").slice(0, 5), marca = `[HAKU-LIBRO-SERVICIO:${item.item_id}]`;
        const coincide = existentes.some(x => {
            if (x.reserva_id !== reservaId || /cancelad/i.test(String(x.estado_servicio || ""))) return false;
            if (String(x.observaciones || "").includes(marca)) return true;
            if (!item.payload) return false;
            return codigoExistente(x) === item.payload.codigo_servicio && x.fecha_servicio === item.payload.fecha_servicio && String(x.hora_inicio || "").slice(0, 5) === hora;
        });
        return { estado: coincide ? "existente" : "nuevo", motivo: coincide ? "Coincidencia operativa exacta." : null };
    }

    function servicioYaExiste(item, existentes) {
        return decisionServicioExistente(item, existentes).estado === "existente";
    }

    function notaYaExiste(item, existentes) {
        if (!item.payload) return false;
        const tipo = `libro_reserva:${item.item_id}`, texto = normalizar(item.payload.texto);
        return existentes.some(x => x.reserva_id === item.payload.reserva_id && (x.tipo === tipo || normalizar(x.texto) === texto));
    }

    function aplicarNocheManual(item, overrides) {
        const eleccion = overrides.get(item.item_id);
        if (!eleccion) return item;
        if (eleccion.invalidada || eleccion.firma !== item.firmaNoche || !item.puedeElegirNoche ||
            !item.opcionesNoches.some(n => n.noche_indice === eleccion.noche_indice)) {
            // La vista obsoleta no puede volver a habilitarse en un segundo intento.
            overrides.set(item.item_id, { ...eleccion, invalidada: true });
            item.razones.push('La confirmación de noche quedó invalidada; vuelve a revisar.');
            item.puedeElegirNoche = false;
            return item;
        }
        return { ...prepararServicio(item.reserva, item.servicio, item.asociacion, eleccion.noche_indice), firmaNoche: item.firmaNoche };
    }

    async function construir(texto, overrides = new Map()) {
        const cliente = root.haikuSupabase;
        if (!cliente) throw new Error("No está disponible la conexión con Proyecto H.");
        const libro = await leerLibro(texto), sistema = await cargarSistema(libro.desde, libro.hasta, cliente), items = [];
        for (const reserva of libro.reservas) {
            const asociacion = asociarReserva(reserva, sistema), servicios = depurarServicios(reserva);
            const notas = extraerNotasReserva(reserva, servicios);
            for (const servicio of servicios) if (!servicioDebeSerNota(servicio)) items.push(prepararServicio(reserva, servicio, asociacion));
            for (const nota of notas) items.push(prepararNota(reserva, nota, asociacion));
        }
        // Firma exacta, sin persistencia: incluye todos los datos leídos del Libro y la asociación actual.
        const firmaLibro = JSON.stringify([libro.archivo, libro.generacion, libro.reservas]);
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            item.firmaNoche = JSON.stringify([firmaLibro, item.item_id, item.servicio, item.asociacion]);
            if (item.kind === 'servicio') items[i] = aplicarNocheManual(item, overrides);
        }
        for (const [id, eleccion] of overrides) if (!items.some(x => x.item_id === id)) overrides.set(id, { ...eleccion, invalidada: true });
        const reservaIds = [...new Set(items.map(x => x.payload?.reserva_id || (x.asociacion.estado === 'asociada' ? x.asociacion.sistema.reserva_id : null)).filter(Boolean))];
        const existentes = await cargarExistentes(cliente, reservaIds);
        for (const item of items) {
            if (item.kind === "nota") {
                item.estado = notaYaExiste(item, existentes.notas) ? "existente" : item.razones.length ? "revisar" : "listo";
                continue;
            }
            const decision = decisionServicioExistente(item, existentes.servicios);
            item.decision_identidad = decision.estado;
            if (decision.estado === "revisar") item.razones.push(decision.motivo);
            item.razones = [...new Set(item.razones.filter(Boolean))];
            item.estado = decision.estado === "existente" ? "existente" : item.razones.length ? "revisar" : "listo";
        }
        return { ...libro, items, quiereIncorporar: quiereIncorporar(texto) };
    }

    function mensaje(tipo, texto) {
        const wrap = document.getElementById("haiku-asistente-mensajes");
        if (!wrap) return null;
        const el = document.createElement("div");
        el.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`;
        el.dataset.haikuLibroRespuesta = "1";
        el.textContent = texto; wrap.appendChild(el); return el;
    }

    function instalarEstilos() {
        if (document.getElementById("haku-libro-servicios-estilos-v2")) return;
        const style = document.createElement("style"); style.id = "haku-libro-servicios-estilos-v2";
        style.textContent = `
          .haku-libro-servicios{width:100%;max-width:none;min-width:0;margin:0;padding:0;border:1px solid #d5e2db;border-radius:0;background:#fbfdfb;box-shadow:none;display:flex;flex-direction:column;gap:0;overflow:visible;box-sizing:border-box;color:#26372c;font-size:12px;line-height:1.4}.haiku-asistente-panel .haku-libro-servicios.haku-comparacion-compacta{gap:0!important;row-gap:0!important}
          .haku-libro-servicios__head{width:100%;display:flex;justify-content:space-between;gap:10px;align-items:flex-start;padding:10px 12px;border-bottom:1px solid #dfe9e2;box-sizing:border-box}.haku-libro-servicios__head>div{min-width:0}
          .haku-libro-servicios__kicker{font-size:9px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#26704c}.haku-libro-servicios__title{font-size:16px;font-weight:800;line-height:1.25;color:#17261d;margin-top:2px;overflow-wrap:anywhere}
          .haku-libro-servicios__chip{flex:0 0 auto;font-size:9px;font-weight:750;padding:4px 7px;border:1px solid #d8e7de;border-radius:2px;background:#edf7f0;color:#326b4c;white-space:nowrap}
          .haku-libro-servicios__stats{width:100%;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;margin:0;border-bottom:1px solid #dfe8e2;background:#f8fbf9}.haku-libro-servicios__stat{min-width:0;margin:0;padding:7px 8px;border:0;border-right:1px solid #dfe8e2;border-radius:0;background:transparent;box-sizing:border-box}.haku-libro-servicios__stat:last-child{border-right:0}.haku-libro-servicios__stat span{display:block;font-size:7.5px;line-height:1.25;text-transform:uppercase;letter-spacing:.06em;color:#6f7d74;overflow-wrap:anywhere}.haku-libro-servicios__stat strong{display:block;font-size:15px;line-height:1.2;margin-top:2px;color:#25352b}
          .haiku-asistente-panel .haku-libro-servicios.haku-comparacion-compacta>.haku-libro-servicios__seccion{width:100%;min-width:0;margin:3px 0 0!important;padding:0!important;border:0!important;border-bottom:1px solid #d9e4de!important;border-radius:0!important;background:#fff;box-shadow:none;overflow:visible;box-sizing:border-box}.haku-libro-servicios__seccion--notas{--franja-fondo:#edf4f0;--franja-acento:#6f9180}.haku-libro-servicios__seccion--existentes{--franja-fondo:#e8f2ec;--franja-acento:#598c74}
          .haku-libro-servicios>.haku-libro-servicios__seccion>summary{position:relative;cursor:pointer;display:flex;align-items:center;gap:8px;min-height:34px;padding:5px 38px 5px 44px;border-left:3px solid var(--franja-acento,#428165);background:var(--franja-fondo,#e2efe8);font-size:12px;font-weight:650;line-height:1.4;color:#293f35;list-style:none;box-sizing:border-box;overflow-wrap:anywhere}.haku-libro-servicios>.haku-libro-servicios__seccion>summary span{min-width:0}.haku-libro-servicios>.haku-libro-servicios__seccion>summary strong{margin-left:auto;font-size:12px}.haku-libro-servicios summary::-webkit-details-marker{display:none}
          .haiku-asistente-panel .haku-libro-servicios.haiku-asistente-preview>.haku-libro-servicios__seccion>.haku-libro-servicios__lista{display:block;width:100%;max-width:none;max-height:none;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;overflow:visible;box-sizing:border-box}.haku-libro-servicios__item{width:100%;margin:0;padding:8px 12px;border:0;border-bottom:1px solid #e3eae5;border-radius:0;box-shadow:none;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;background:#fff;box-sizing:border-box}.haku-libro-servicios__item:last-child{border-bottom:0}.haku-libro-servicios__item--revisar{border-color:#ead9b4;background:#fffaf0}.haku-libro-servicios__item--existente{background:#f7faf8;color:#526158}.haku-libro-servicios__item--nota{background:#f5faf7}
          .haku-libro-servicios__check{margin:2px 0 0}.haku-libro-servicios__nombre{font-size:11px;font-weight:800;color:#203127;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}.haku-libro-servicios__meta{font-size:9px;color:#6d796f;margin-top:2px;line-height:1.35}.haku-libro-servicios__texto{font-size:10px;color:#39473e;margin-top:4px;line-height:1.35;overflow-wrap:anywhere}.haku-libro-servicios__razones{margin:4px 0 0;padding-left:16px;font-size:9px;color:#805e23;line-height:1.4}.haku-libro-servicios__inferencias{margin:4px 0 0;padding-left:16px;font-size:9px;color:#347052;line-height:1.4}.haku-libro-servicios__nota{font-size:9px;color:#657369;margin:0;padding:8px 12px}
          .haku-libro-servicios__acciones{display:flex;gap:7px;align-items:center;margin:0;padding:7px 12px;border-top:1px solid #e2e9e4}.haku-libro-servicios__boton{border:0;border-radius:2px;padding:8px 11px;background:#1f7650;color:#fff;font:inherit;font-size:10px;font-weight:800;cursor:pointer}.haku-libro-servicios__boton:disabled{opacity:.45;cursor:not-allowed}.haku-libro-servicios__pie{width:100%;font-size:9px;line-height:1.4;color:#738078;margin:0;padding:8px 12px;border-top:1px solid #e2e9e4;box-sizing:border-box}
          .haku-libro-servicios__noche{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:4px;font-size:9px;min-width:0}.haku-libro-servicios__noche label{display:flex;align-items:center;gap:5px;min-width:0;flex:1}.haku-libro-servicios__noche select{min-width:0;max-width:100%;flex:1;padding:3px;font:inherit;height:28px}.haku-libro-servicios__noche button{padding:4px 7px;font-size:9px;height:28px}
          @media(max-width:440px){.haku-libro-servicios__head{padding:9px 10px;flex-wrap:wrap}.haku-libro-servicios__chip{margin-left:0}.haku-libro-servicios__stat{padding:6px 4px}.haku-libro-servicios__stat span{font-size:7px;letter-spacing:.03em}.haku-libro-servicios>.haku-libro-servicios__seccion>summary{padding-right:34px;padding-left:42px;font-size:11px}.haku-libro-servicios__item{padding:8px 10px}}
        `;
        document.head.appendChild(style);
    }

    function stat(etiqueta, valor) {
        const box = document.createElement("div"); box.className = "haku-libro-servicios__stat";
        const s = document.createElement("span"); s.textContent = etiqueta; const strong = document.createElement("strong"); strong.textContent = String(valor); box.append(s, strong); return box;
    }

    function nombreItem(item) {
        if (item.kind === "nota") return `CAB ${item.reserva.cabana} · ${item.reserva.titular} · NOTA PARA RESUMEN`;
        return `CAB ${item.reserva.cabana} · ${item.reserva.titular} · ${item.mapa.nombre || item.servicio.concepto}`;
    }

    function crearItem(item, seleccionados, confirmarNoche) {
        const fila = document.createElement("div"); fila.className = `haku-libro-servicios__item haku-libro-servicios__item--${item.estado}${item.kind === "nota" ? " haku-libro-servicios__item--nota" : ""}`;
        const check = document.createElement("input"); check.type = "checkbox"; check.className = "haku-libro-servicios__check"; check.disabled = item.estado !== "listo"; check.checked = item.estado === "listo";
        check.dataset.hakuItemId = item.item_id;
        if (check.checked) seleccionados.add(item.item_id); check.addEventListener("change", () => check.checked ? seleccionados.add(item.item_id) : seleccionados.delete(item.item_id));
        const cuerpo = document.createElement("div"), nombre = document.createElement("div"); nombre.className = "haku-libro-servicios__nombre"; nombre.textContent = nombreItem(item);
        const meta = document.createElement("div"); meta.className = "haku-libro-servicios__meta";
        if (item.kind === "nota") meta.textContent = `${item.payload?.importante ? "Nota importante" : "Nota"} · vinculada a la reserva, no genera cargo`;
        else meta.textContent = `${item.fecha ? `Fecha ${item.fecha}` : "Fecha por definir"}${item.hora ? ` · ${item.hora}` : ""}${Number.isInteger(item.personas) && item.personas > 0 ? ` · ${item.personas} pers.` : ""}${item.cortesia ? " · cortesía" : ""}`;
        const texto = document.createElement("div"); texto.className = "haku-libro-servicios__texto"; texto.textContent = item.kind === "nota" ? item.texto : (item.servicio.texto_original || "Servicio indicado en el Libro");
        cuerpo.append(nombre, meta, texto);
        if (item.nocheManual && item.estado === 'listo') meta.textContent += ' · Listo · fecha confirmada manualmente';
        if (item.estado === 'revisar' && item.puedeElegirNoche && confirmarNoche) {
            const linea = document.createElement('div'); linea.className = 'haku-libro-servicios__noche';
            const label = document.createElement('label'); label.textContent = 'Noche: ';
            const select = document.createElement('select'); select.setAttribute('aria-label', `Noche de servicio de ${item.reserva.titular}`);
            for (const noche of item.opcionesNoches) {
                const option = document.createElement('option'); option.value = String(noche.noche_indice);
                option.textContent = `Noche ${noche.noche_indice} · ${noche.fecha.slice(5).split('-').reverse().join('/')}`; select.append(option);
            }
            const boton = document.createElement('button'); boton.type = 'button'; boton.className = 'haku-libro-servicios__boton'; boton.textContent = 'Confirmar';
            boton.dataset.hakuAccion = 'confirmar-noche';
            boton.addEventListener('click', async event => {
                event.preventDefault(); event.stopPropagation();
                boton.disabled = true; select.disabled = true;
                try { await confirmarNoche(item, Number(select.value)); }
                catch (e) { const aviso = document.createElement('div'); aviso.className = 'haku-libro-servicios__razones'; aviso.textContent = e.message || 'No se pudo revalidar la noche.'; cuerpo.append(aviso); }
                finally { boton.disabled = false; select.disabled = false; }
            });
            label.append(select); linea.append(label, boton); cuerpo.append(linea);
        }
        if (item.asociacion.nota) { const n = document.createElement("div"); n.className = "haku-libro-servicios__nota"; n.textContent = item.asociacion.nota; cuerpo.append(n); }
        if (item.inferencias?.length) { const ul = document.createElement("ul"); ul.className = "haku-libro-servicios__inferencias"; item.inferencias.forEach(r => { const li = document.createElement("li"); li.textContent = r; ul.append(li); }); cuerpo.append(ul); }
        if (item.razones.length) { const ul = document.createElement("ul"); ul.className = "haku-libro-servicios__razones"; item.razones.forEach(r => { const li = document.createElement("li"); li.textContent = r; ul.append(li); }); cuerpo.append(ul); }
        fila.append(check, cuerpo); return fila;
    }

    function seccion(titulo, items, seleccionados, clases, confirmarNoche) {
        const details = document.createElement("details"); details.className = `haku-libro-servicios__seccion haiku-comparacion-acordeon ${clases}`; details.open = false; const summary = document.createElement("summary");
        const s1 = document.createElement("span"); s1.textContent = titulo; const s2 = document.createElement("strong"); s2.textContent = String(items.length); summary.append(s1, s2); details.append(summary);
        const lista = document.createElement("div"); lista.className = "haku-libro-servicios__lista";
        if (!items.length) { const p = document.createElement("div"); p.className = "haku-libro-servicios__nota"; p.textContent = "Sin elementos en esta categoría."; lista.append(p); }
        else items.forEach(i => lista.append(crearItem(i, seleccionados, confirmarNoche)));
        details.append(lista); return details;
    }

    function uuid() {
        if (root.crypto?.randomUUID) return root.crypto.randomUUID();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
    }

    function mensajeErrorIncorporacion(error) {
        const texto = String(error?.message || error || "").trim();
        if (/permission denied for table eventos_auditoria/i.test(texto)) {
            return "Proyecto H no pudo registrar la auditoría de la incorporación. No se guardó ningún servicio ni nota; vuelve a intentar después de actualizar la base.";
        }
        return texto || "No se pudo completar la incorporación.";
    }

    async function importarSeleccionados(seleccionados, card, textoOriginal, overrides = new Map()) {
        const ids = [...seleccionados]; if (!ids.length) return;
        const actual = await construir(textoOriginal, overrides), mapa = new Map(actual.items.filter(x => x.estado === "listo").map(x => [x.item_id, x]));
        const elegidos = ids.map(id => mapa.get(id)).filter(Boolean);
        if (elegidos.length !== ids.length) throw new Error("Uno o más elementos cambiaron desde la vista previa. Vuelve a revisar antes de guardar.");
        const servicios = elegidos.filter(x => x.kind === "servicio"), notas = elegidos.filter(x => x.kind === "nota");
        const confirmar = root.confirm(`Se incorporarán ${servicios.length} servicio${servicios.length === 1 ? "" : "s"} y ${notas.length} nota${notas.length === 1 ? "" : "s"} desde el Libro. Haku revalidó la información y la operación será atómica. ¿Confirmas?`);
        if (!confirmar) return;
        const botones = card.querySelectorAll("button,input[type=checkbox]"); botones.forEach(x => x.disabled = true);
        try {
            const { data, error } = await root.haikuSupabase.rpc("haiku_importar_libro_operaciones_v2", {
                p_operacion_id: uuid(), p_servicios: servicios.map(x => x.payload), p_notas: notas.map(x => x.payload)
            });
            if (error) throw error; if (!data?.ok) throw new Error("Proyecto H no confirmó la incorporación.");
            card.className = "haiku-asistente-preview haiku-incorporacion haku-incorporacion-resultado haku-incorporacion-resultado--servicios";
            card.replaceChildren();
            const cabecera = document.createElement("div"); cabecera.className = "haiku-incorporacion-cabecera haku-incorporacion-resultado-cabecera"; const titulo = document.createElement("div");
            const k = document.createElement("span"); k.textContent = "LIBRO ↔ PROYECTO H"; const t = document.createElement("strong"); t.textContent = "Incorporación completada"; titulo.append(k, t);
            const estado = document.createElement("span"); estado.className = "haiku-incorporacion-modo"; estado.textContent = "Guardado"; cabecera.append(titulo, estado);
            const mensaje = document.createElement("p"); mensaje.className = "haiku-incorporacion-aviso haku-incorporacion-resultado-mensaje"; mensaje.textContent = "Proyecto H confirmó la incorporación completa. El Libro original no fue modificado.";
            const resumen = document.createElement("div"); resumen.className = "haiku-incorporacion-resumen haku-incorporacion-resultado-resumen";
            for (const [cantidad, etiqueta] of [[Number(data.servicios_creados || 0), "Servicios"], [Number(data.notas_creadas || 0), "Notas"], [Number(data.servicios_omitidos || 0) + Number(data.notas_omitidas || 0), "Omitidos"]]) {
                const indicador = document.createElement("div"); indicador.className = "haiku-incorporacion-indicador haku-incorporacion-resultado-indicador";
                const valor = document.createElement("strong"); valor.textContent = String(cantidad); const label = document.createElement("span"); label.textContent = etiqueta; indicador.append(valor, label); resumen.append(indicador);
            }
            card.append(cabecera, mensaje, resumen);
        } catch (error) {
            const aviso = document.createElement("div"); aviso.className = "haku-libro-servicios__razones"; aviso.textContent = mensajeErrorIncorporacion(error); card.append(aviso);
            botones.forEach(x => x.disabled = false);
        }
    }

    function revalidarVista(card, texto) {
        return construir(texto, nochesPorVista.get(card) || new Map());
    }

    function renderizar(resultado, out, textoOriginal, overrides = new Map()) {
        nochesPorVista.set(out, overrides);
        instalarEstilos(); out.className = "haiku-asistente-preview haku-libro-servicios haku-comparacion-compacta"; out.textContent = "";
        const confirmarNoche = async (item, indice) => {
            if (!item.puedeElegirNoche || !item.opcionesNoches.some(n => n.noche_indice === indice)) throw new Error('La noche elegida no es válida.');
            overrides.set(item.item_id, { noche_indice: indice, firma: item.firmaNoche });
            try { const actual = await construir(textoOriginal, overrides); renderizar(actual, out, textoOriginal, overrides); }
            catch (e) { overrides.delete(item.item_id); throw e; }
        };
        const listosServicios = resultado.items.filter(x => x.estado === "listo" && x.kind === "servicio");
        const listosNotas = resultado.items.filter(x => x.estado === "listo" && x.kind === "nota");
        const existentes = resultado.items.filter(x => x.estado === "existente"), revisar = resultado.items.filter(x => x.estado === "revisar"), seleccionados = new Set();
        const head = document.createElement("div"); head.className = "haku-libro-servicios__head"; const left = document.createElement("div");
        const kicker = document.createElement("div"); kicker.className = "haku-libro-servicios__kicker"; kicker.textContent = "LIBRO · SERVICIOS + NOTAS";
        const title = document.createElement("div"); title.className = "haku-libro-servicios__title"; title.textContent = "Interpretación operativa del Libro"; left.append(kicker, title);
        const chip = document.createElement("span"); chip.className = "haku-libro-servicios__chip"; chip.textContent = `${resultado.desde} → ${resultado.hasta}`; head.append(left, chip); out.append(head);
        const stats = document.createElement("div"); stats.className = "haku-libro-servicios__stats";
        stats.append(stat("Servicios listos", listosServicios.length), stat("Notas listas", listosNotas.length), stat("Ya existen", existentes.length), stat("Revisar", revisar.length), stat("Total", resultado.items.length)); out.append(stats);
        out.append(
            seccion("Servicios listos para incorporar", listosServicios, seleccionados, "haku-franja--normal haku-icono--servicio haku-libro-servicios__seccion--servicios"),
            seccion("Notas operativas para el resumen", listosNotas, seleccionados, "haku-franja--neutro haku-icono--archivo haku-libro-servicios__seccion--notas"),
            seccion("Ya existen en Proyecto H", existentes, seleccionados, "haku-franja--normal haku-icono--calendario haku-libro-servicios__seccion--existentes"),
            seccion("Requieren revisión manual", revisar, seleccionados, "haku-franja--revision haku-icono--alerta haku-libro-servicios__seccion--revision", confirmarNoche)
        );
        // La comparación ya contiene una selección explícita y revalidable. Permitir
        // iniciar la incorporación desde esta misma vista aunque la consulta original
        // haya dicho "comparar": el guard vuelve a leer Libro y Proyecto H antes de
        // pedir confirmación y los ítems dudosos/existentes continúan deshabilitados.
        if (listosServicios.length || listosNotas.length) {
            const acciones = document.createElement("div"); acciones.className = "haku-libro-servicios__acciones"; const boton = document.createElement("button"); boton.type = "button"; boton.className = "haku-libro-servicios__boton";
            boton.dataset.hakuAccion = 'incorporar';
            const refrescar = () => { const elegidos = resultado.items.filter(x => seleccionados.has(x.item_id)); const s = elegidos.filter(x => x.kind === "servicio").length, n = elegidos.filter(x => x.kind === "nota").length; boton.textContent = `Incorporar ${s} servicio${s === 1 ? "" : "s"} + ${n} nota${n === 1 ? "" : "s"}`; boton.disabled = !elegidos.length; };
            out.onchange = refrescar; refrescar(); boton.addEventListener("click", async () => { boton.disabled = true; try { await importarSeleccionados(seleccionados, out, textoOriginal, overrides); } catch (e) { const a = document.createElement("div"); a.className = "haku-libro-servicios__razones"; a.textContent = e?.message || "No se pudo revalidar."; out.append(a); boton.disabled = false; } });
            acciones.append(boton); out.append(acciones);
        }
        const pie = document.createElement("div"); pie.className = "haku-libro-servicios__pie";
        pie.textContent = "Reglas activas: alojamiento nocturno 15:00→12:00; Full Day 09:30→21:30. En 1 noche Haku puede inferir la fecha por horario; en varias noches no adivina. “Tinaja” sin tipo, cama adicional, cuna y otras instrucciones operativas se tratan como notas, no como servicios."; out.append(pie);
    }

    async function procesar(texto) {
        if (ocupado) return; ocupado = true;
        const campo = document.getElementById("haiku-asistente-texto"), boton = document.getElementById("haiku-asistente-enviar");
        if (campo) { campo.value = ""; campo.disabled = true; } if (boton) boton.disabled = true;
        mensaje("usuario", texto); const out = mensaje("asistente", "Revisando servicios y separando notas operativas…");
        try { const resultado = await construir(texto); if (out) renderizar(resultado, out, texto); }
        catch (error) { if (out) out.textContent = error?.message || "No pude revisar los servicios del Libro."; }
        finally { ocupado = false; if (campo) { campo.disabled = false; campo.dispatchEvent(new Event("input", { bubbles: true })); } if (boton) boton.disabled = false; out?.scrollIntoView?.({ block: "nearest" }); }
    }

    function interceptar(event) {
        const target = event.type === "click" ? event.target?.closest?.("#haiku-asistente-enviar") : event.target?.id === "haiku-asistente-texto" && event.key === "Enter" && !event.shiftKey;
        if (!target) return;
        const campo = document.getElementById("haiku-asistente-texto"), texto = campo?.value?.trim() || "";
        if (!esConsultaServicios(texto)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (ocupado || root.HAIKU_ASISTENTE?.procesando?.()) return;
        if (document.querySelector("#haiku-asistente-adjuntos .haiku-asistente-adjunto")) { mensaje("asistente", "Retira las capturas adjuntas; para esta consulta usaré directamente el XLSX cargado en Libro de Reserva."); return; }
        procesar(texto);
    }

    const api = Object.freeze({ version: "2.0.0", esConsultaServicios, rangoDesdeTexto, construir, revalidarVista, procesar });
    root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2 = api;
    root.HAIKU_LIBRO_SERVICIOS_SCOPE_V1 = api;
    root.addEventListener("click", interceptar, true);
    root.addEventListener("keydown", interceptar, true);
})(typeof window !== "undefined" ? window : globalThis);
