// Identidad de destino y valores nuevos se leen por separado.
(function (root) {
    "use strict";
    const L = root.HAIKU_ASISTENTE_LENGUAJE_V1 ||
        (typeof module !== "undefined" ? require("./haiku-asistente-lenguaje-v1.js") : null);
    if (!L) return;

    const error = mensaje => ({ error: mensaje });
    const sinArticulo = t => t.replace(/^(?:(?:el|la|los|las|un|una|este|esta)\s+)+/i, "");
    const sinPunto = t => t.trim().replace(/\.$/, "");
    const dinero = t => L.importeClp(sinPunto(t));
    const agregarDia = (fecha, n) => new Date(Date.parse(fecha) + n * 86400000).toISOString().slice(0, 10);
    const cabana = t => {
        const m = sinPunto(t).match(/^(?:(?:cab(?:a[nñ]a)?\.?|cba\.?)\s*#?\s*)?([1-9]\d?)$/i);
        return m ? Number(m[1]) : null;
    };

    function fechaCompleta(t, dia) {
        const f = L.extraerFecha(sinPunto(t), dia);
        return f.fecha && !/\S/.test(f.resto) ? f.fecha : null;
    }

    function rango(t, dia) {
        const texto = sinPunto(t).replace(/^(?:del?|desde|entre)\s+/i, "");
        const m = texto.match(/^(.+?)\s+(?:al?|hasta(?:\s+el)?|y|→)\s+(.+)$/i);
        if (!m) return null;
        const hasta = fechaCompleta(m[2], dia);
        if (!hasta) return null;
        const [, anio, mes] = hasta.match(/^(\d{4})-(\d{2})-/);
        const desde = fechaCompleta(/^\d{1,2}$/.test(m[1]) ? m[1] + "/" + mes + "/" + anio : m[1], dia);
        return desde && hasta >= desde ? { desde, hasta } : null;
    }

    function destino(t, dia, usarDia = false) {
        const texto = sinPunto(t).replace(/^(?:(?:de|para|a|en|la|el|reserva)\s+)+/i, "");
        const codigo = texto.match(/\bH-\d{8}-\d{2}-[a-z0-9]+\b/i)?.[0];
        const f = L.extraerFecha(codigo ? texto.replace(codigo, "") : texto, dia);
        if (f.error) return f;
        const c = L.extraerCabana(f.resto);
        if (c.error) return c;
        const titular = L.limpiarTitular(c.resto.replace(/\b(?:de\s+la\s+reserva|en\s+la\s+cabaña)\s*$/i, ""));
        if (titular && !L.nombreValido(titular) || !titular && !codigo && !c.cabana) {
            return error("Indica la cabaña y el día, el titular o el código de reserva.");
        }
        return { titular: titular || null, cabana: c.cabana, codigo: codigo?.toUpperCase() || null,
            fecha: f.fecha || (usarDia || !titular && c.cabana && !codigo ? dia : null),
            modoFecha: f.modoFecha || "estadia" };
    }

    function dividirCambio(t, leer, comprobar = () => true) {
        const cortes = [...t.matchAll(/\s+(?:a|al|en|por|con|para)\s+|\s*→\s*/gi)].reverse();
        for (const m of cortes) {
            const valor = leer(t.slice(m.index + m[0].length));
            const base = t.slice(0, m.index);
            if (valor !== null && valor !== undefined && comprobar(base)) return { base, valor };
        }
        return null;
    }

    const camposReserva = [
        [/^(?:fecha\s+de\s+)?(?:ingreso|check[ -]?in)\b/i, "ingreso"],
        [/^(?:fecha\s+de\s+)?(?:salida|check[ -]?out)\b/i, "salida"],
        [/^(?:las\s+)?fechas\b|^estad[ií]a\b/i, "fechas"],
        [/^(?:caba[nñ]a|cban?a|cab)\b/i, "cabana"],
        [/^(?:titular|titualr|nombre(?:\s+del\s+titular)?)\b/i, "titular"],
        [/^(?:correo(?:\s+electr[oó]nico)?|email|e-mail|mail)\b/i, "correo"],
        [/^(?:tel[eé]fono|celular|fono|contacto)\b/i, "telefono"],
        [/^(?:ocupaci[oó]n|hu[eé]spedes|personas|adultos|ni[nñ]os|mascotas)\b/i, "ocupacion"],
        [/^(?:tarifa|precio|valor)\s+(?:por\s+noche|de\s+(?:la\s+)?noche)\b/i, "tarifa"]
    ];

    function ocupacion(t, campo) {
        if (/^(adultos|ninos|mascotas)$/.test(campo) && /^\d{1,2}$/.test(sinPunto(t))) {
            return { [campo]: Number(sinPunto(t)) };
        }
        const datos = {};
        const resto = L.normalizar(t).replace(/\b(\d{1,2})\s*(adultos?|adl|ninos?|menores?|mascotas?)\b/g, (_, n, k) => {
            const clave = /^ad/.test(k) ? "adultos" : /^m[a]/.test(k) ? "mascotas" : "ninos";
            if (Object.hasOwn(datos, clave)) return _;
            datos[clave] = Number(n);
            return "";
        });
        return Object.keys(datos).length && !resto.replace(/\by\b|[.\s,]/g, "") ? datos : null;
    }

    function editarReserva(verbo, t, dia) {
        if (!["edita","modifica","cambia","actualiza","mueve","traslada","reagenda","fija","pon","deja"].includes(verbo)) return null;
        let valorCampo = camposReserva.find(([patron]) => patron.test(t));
        let cuerpo;
        if (!valorCampo) {
            if (!["mueve","traslada","reagenda"].includes(verbo) || !/^reserva\s+/i.test(t)) return null;
            valorCampo = [null, "mover"];
            cuerpo = t.replace(/^reserva\s+/i, "");
        } else {
            // Los comandos de pago llevan sus propios campos y su propia identidad.
            if (/^(?:correo|tel[eé]fono|titular)\s+(?:del?|para)\s+(?:pago|abono)\b/i.test(t)) return null;
            cuerpo = t.replace(valorCampo[0], "").trim();
        }
        const [patron, campo] = valorCampo;
        const modoOcupacion = L.normalizar(t.match(patron || /$^/)?.[0] || "");
        let noche = null;
        if (campo === "tarifa") {
            const m = cuerpo.match(/^\s*(?:del?\s+)?(.+?)\s+de\s+(?:(?:la\s+)?reserva\s+)?(.+)$/i);
            if (m) {
                noche = fechaCompleta(m[1], dia);
                if (noche) cuerpo = m[2];
            }
        }
        const leer = nuevo => {
            const valor = sinPunto(nuevo);
            switch (campo) {
                case "ingreso":
                case "salida": return fechaCompleta(valor, dia);
                case "fechas": return rango(valor, dia);
                case "cabana": return cabana(valor);
                case "mover": return /^cab/i.test(valor) ? cabana(valor) : rango(valor, dia);
                case "titular": {
                    const nombre = valor.replace(/^nombre\s+de\s+/i, "");
                    return L.nombreValido(nombre) && nombre.length <= 180 ? nombre : null;
                }
                case "correo": return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(valor) && valor.length <= 254 ? valor : null;
                case "telefono": return /^[+\d][\d ()-]{6,22}$/.test(valor) && valor.replace(/\D/g, "").length >= 8 ? valor : null;
                case "ocupacion": return ocupacion(valor, modoOcupacion);
                case "tarifa": return dinero(valor);
                default: return null;
            }
        };
        let m = dividirCambio(cuerpo, leer);
        if (!m && ["fechas","mover"].includes(campo)) {
            for (const corte of cuerpo.matchAll(/\s+(?:del|desde)\s+/gi)) {
                const nuevo = rango(cuerpo.slice(corte.index + corte[0].length), dia);
                if (nuevo) {
                    m = { base: cuerpo.slice(0, corte.index), valor: nuevo };
                    break;
                }
            }
        }
        if (!m) {
            // «Edita reserva …» conserva el acceso anterior al editor general.
            if (!cuerpo || !/\b(?:cab(?:a[nñ]a)?\s*\d|reserva\s|H-\d{8})/i.test(cuerpo)) return null;
            return error("Indica la reserva y el dato nuevo después de «a». Para cambiar ambas fechas usa «del día de ingreso al día de salida».");
        }
        const q = destino(m.base, dia);
        if (q.error) return q;
        return { accion: "editarReserva", campo: campo === "mover" ? (typeof m.valor === "number" ? "cabana" : "fechas") : campo,
            valor: m.valor, noche, ...q };
    }

    function cambiarEstado(verbo, t, dia) {
        const acciones = {
            cancela: "cancelada", cancelar: "cancelada", reactiva: "reactivar", reactivar: "reactivar",
            confirma: "confirmada", confirmar: "confirmada"
        };
        if (acciones[verbo] && /^reserva\b/i.test(t)) {
            const estado = acciones[verbo];
            const base = t.replace(/^reserva\s*/i, "");
            if (/\b(?:del libro|en el libro)\b/i.test(base)) return null;
            const q = destino(base, dia);
            return q.error ? q : { accion: "estadoReserva", estado, ...q };
        }
        if (!["marca","registra","haz","hace","pon","checkout","check-out","no-show"].includes(verbo)) return null;
        const final = t.match(/^reserva\s+(.+?)\s+(?:como|en)\s+(check[ -]?out|no[ -]?show|cancelada|confirmada)$/i);
        if (final) {
            const pedido = L.normalizar(final[2]).replace(/[ -]/g, "");
            const estado = { checkout: "checked_out", noshow: "no_show", cancelada: "cancelada", confirmada: "confirmada" }[pedido];
            const q = destino(final[1], dia);
            return q.error ? q : { accion: "estadoReserva", estado, ...q };
        }
        const m = t.match(/^(?:check[ -]?out|salida\s+realizada|no[ -]?show|no\s+lleg[oó])(?:\s+|$)/i);
        if (!m && !["checkout","check-out","no-show"].includes(verbo)) return null;
        const estado = /no[ -]?show|no\s+lleg[oó]/i.test(m?.[0] || verbo) ? "no_show" : "checked_out";
        const q = destino(m ? t.slice(m[0].length) : t, dia);
        if (estado === "checked_out" && q.fecha && q.modoFecha === "estadia") q.modoFecha = "salida";
        return q.error ? q : { accion: "estadoReserva", estado, ...q };
    }

    function hora(texto) {
        const m = sinPunto(texto).match(/^(?:a\s+las?\s+|las?\s+)?(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?$/i);
        if (!m) return null;
        const h = Number(m[1]), mm = Number(m[2] || 0), periodo = L.normalizar(m[3]);
        if (h > 23 || mm > 59 || periodo && (h < 1 || h > 12)) return null;
        return String(periodo ? h % 12 + (periodo === "pm" ? 12 : 0) : h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
    }

    function horario(t, dia) {
        const directo = hora(t);
        if (directo) return { hora: directo };
        const f = L.extraerFecha(t, dia);
        if (!f.fecha) return null;
        const h = hora(f.resto.trim());
        return h || !f.resto.trim() ? { fecha: f.fecha, hora: h } : null;
    }

    const servicio = /^(?:(?:la\s+)?tinaja\s+(?:t[oó]nel|jacuzzi)|t[oó]nel|jacuzzi|tinajas?|masajes?(?:\s+(?:descontracturante|terap[eé]utico))?(?:\s+(?:30|60)\s*(?:min(?:utos?)?))?|late\s*(?:check[ -]?)?out|early\s*(?:check[ -]?)?in|servicio)\b/i;
    function servicios(verbo, t, dia) {
        if (["reagenda","reprograma","mueve","cambia","traslada","modifica"].includes(verbo)) {
            if (/\ba\s+(?:cobro\s+normal|cortes[ií]a)\b/i.test(t)) return null;
            t = t.replace(/^(?:horario|hora|fecha)\s+del?\s+(?:(?:la|el)\s+)?/i, "");
            const etiqueta = t.match(servicio);
            if (!etiqueta) return null;
            const patronHora = /\b(?:de\s+las?|a\s+las?|hora)\s+(\d{1,2}(?:[:.h]\d{2})?\s*(?:am|pm)?)(?=\s|$)/i;
            const m = dividirCambio(t.slice(etiqueta[0].length).trim(), v => horario(v, dia),
                base => !destino(base.replace(patronHora, ""), dia, true).error);
            if (!m) return error("Indica la cabaña, la fecha del servicio y el horario nuevo. Ejemplo: mueve el Tónel de CAB 3 hoy a las 20:45.");
            const antigua = m.base.match(patronHora);
            const q = destino(antigua ? m.base.replace(antigua[0], "") : m.base, dia, true);
            if (q.error) return q;
            const horaOriginal = antigua ? hora(antigua[1]) : null;
            return antigua && !horaOriginal ? error("Revisa la hora original del servicio.") :
                { accion: "reprogramar", servicio: L.normalizar(etiqueta[0]), nuevo: m.valor, horaOriginal, ...q };
        }
        const lectura = L.normalizar(t);
        if (["muestra","consulta","busca",""].includes(verbo) || /^(?:hay|que|cuales|tienen)$/.test(verbo)) {
            if (!/\b(?:masajes?|servicios?)\b/.test(lectura) || !/\b(?:horarios?|agenda|disponibilidad|libres?|agendados?|disponibles?)\b/.test(lectura) ||
                /\b(?:libro|tinaja[s]?|tonel|jacuzzi)\b/.test(lectura)) return null;
            const f = L.extraerFecha(t, dia);
            if (f.error) return f;
            const c = L.extraerCabana(f.resto);
            return c.error ? c : { accion: "agendaServicios", fecha: f.fecha || dia, cabana: c.cabana,
                soloMasajes: /\bmasajes?\b/.test(lectura) };
        }
        return null;
    }

    function separarTexto(t) {
        const m = t.match(/^([^:\n]+?)\s*(?:\s:\s*|:(?!\d)|\n)\s*([\s\S]+)$/);
        return m ? { base: m[1].trim(), texto: m[2].trim() } : null;
    }

    const mediosPago = {
        transferencia: "transferencia", transf: "transferencia", efectivo: "efectivo",
        "tarjeta debito": "tarjeta_debito", debito: "tarjeta_debito", "tarjeta credito": "tarjeta_credito",
        credito: "tarjeta_credito", "webpay credito": "webpay_credito", "webpay debito": "webpay_debito",
        "airbnb prepaid card": "airbnb_prepaid_card", otro: "otro"
    };
    const medioPago = v => mediosPago[L.normalizar(sinPunto(v)).replace(/\s+/g, " ")] || null;

    function cambioPago(texto, dia) {
        const t = sinPunto(texto);
        const monto = dinero(t.replace(/^monto\s+/i, ""));
        if (monto) return { monto };
        const fechaPago = t.match(/^fecha(?:\s+de\s+pago)?\s+(.+)$/i);
        if (fechaPago) {
            const f = fechaCompleta(fechaPago[1], dia);
            return f ? { fecha_pago: f } : null;
        }
        const medio = medioPago(t.replace(/^medio(?:\s+de\s+pago)?\s+/i, ""));
        if (medio) return { medio_pago: medio };
        const ref = t.match(/^(folio|bovtar|cod\s*aut|autorizaci[oó]n|glosa|referencia)\s+(.+)$/i);
        if (!ref || !ref[2].trim() || ref[2].length > 160) return null;
        const clave = L.normalizar(ref[1]).replace(/\s/g, "");
        const campo = { folio: "folio", bovtar: "bove", codaut: "codigo_autorizacion", autorizacion: "codigo_autorizacion",
            glosa: "referencia_externa", referencia: "referencia_externa" }[clave];
        return { [campo]: ref[2].trim() };
    }

    function pagos(verbo, t, dia) {
        const registrada = ["registra","anota","ingresa","guarda"].includes(verbo) &&
            t.match(/^devoluci[oó]n\s+(?:ya\s+realizada\s+)?del?\s+(?:(?:el|un|este)\s+)?(?=(?:pago|abono)\b)([\s\S]+)/i);
        if (registrada) {
            const partes = registrada[1].match(/^(.+?)\s*,?\s+fecha\s+(?:de\s+devoluci[oó]n\s+)?(.+?)\s*,?\s+medio\s+(.+?)\s*,?\s+comprobante\s+([\w./-]+)(?:\s*,?\s+motivo\s*:\s*([\s\S]+))?$/i);
            if (!partes || !fechaCompleta(partes[2], dia) || !medioPago(partes[3]) || !partes[5]?.trim()) {
                return error("Indica el pago original, la fecha real, el medio, el comprobante y el motivo de la devolución realizada.");
            }
            const origen = pagos("reembolsa", partes[1], dia);
            return !origen || origen.error ? origen || error("Indica el pago original de la devolución.") :
                { ...origen, accion: "registrarDevolucion", fechaDevolucion: fechaCompleta(partes[2], dia),
                    medio: medioPago(partes[3]), comprobante: partes[4], motivo: partes[5].trim() };
        }
        const inicio = t.match(/^(?:(?:web\s*pay|pago\s+web\s*pay)(?:\s+pendiente)?|abono|pago)\b/i);
        const devolver = ["reembolsa","reembolsar","devuelve","devolver"].includes(verbo);
        if (!inicio || !["edita","modifica","cambia","corrige","cancela","anular","cancelar"].includes(verbo) && !devolver) return null;
        const tipo = devolver ? "reembolso" : ["cancela","anular","cancelar"].includes(verbo) ? "anularPago" : "editarPago";
        let base = t.slice(inicio[0].length).trim();
        const motivo = base.match(/\s+motivo\s*:\s*([\s\S]+)$/i);
        if (motivo) base = base.slice(0, motivo.index);
        const cambio = tipo === "editarPago" && dividirCambio(base, v => cambioPago(v, dia));
        if (cambio) base = cambio.base;
        const referencia = base.match(/\b(folio|cod\s*aut|autorizaci[oó]n|referencia)\s*[:#]?\s*([\w.-]+)\b/i);
        if (referencia) base = base.replace(referencia[0], "");
        const importe = base.match(/^(?:de\s+)?(?:clp\s*|\$\s*)?(\d+(?:\.\d{3})*(?:\s+(?:lucas|mil))?)(?=\s|$)/i);
        if (importe) base = base.slice(importe[0].length);
        const fechaPago = base.match(/\b(?:fecha\s+de\s+pago|pagado)\s+(.+?)(?=\s+de\s+(?:cab|la reserva)|$)/i);
        const diaPago = fechaPago && fechaCompleta(fechaPago[1], dia);
        if (fechaPago && !diaPago) return error("Indica la fecha del pago, además de la reserva si la conoces.");
        if (fechaPago) base = base.replace(fechaPago[0], "");
        const webpay = /web\s*pay/i.test(inicio[0]);
        if (webpay && tipo === "anularPago" && !referencia) return error("Indica el CodAut del WebPay pendiente para identificarlo.");
        const q = webpay && tipo === "anularPago" && !base.trim() ? {} : destino(base, dia);
        if (q.error) return q;
        return { accion: tipo, webpay, referencia: referencia?.[2] || null,
            campoRef: referencia ? (/^folio/i.test(referencia[1]) ? "folio" : /^referencia/i.test(referencia[1]) ? "referencia_externa" : "codigo_autorizacion") : null,
            monto: importe ? dinero(importe[0].replace(/^de\s+/i, "")) : null,
            diaPago: diaPago || null, motivo: motivo?.[1].trim() || "", cambio: cambio?.valor || null, ...q };
    }

    function operacionCabana(verbo, t, dia) {
        if (["bloquea","bloquear","blokea"].includes(verbo)) {
            const motivo = t.match(/\s+(?:motivo\s*:|por)\s*([\s\S]+)$/i);
            const c = L.extraerCabana(motivo ? t.slice(0, motivo.index) : t);
            if (!c.cabana || c.error) return error(c.error || "Indica qué cabaña quieres bloquear.");
            const f = rango(c.resto, dia), solo = fechaCompleta(c.resto, dia);
            if (!f && !solo && c.resto.trim()) return error("Indica un día o el rango desde el inicio hasta el día de liberación.");
            const desde = f?.desde || solo || dia, hasta = f?.hasta || agregarDia(desde, 1);
            if (hasta <= desde) return error("La fecha de liberación debe ser posterior al inicio.");
            return { accion: "bloquear", cabana: c.cabana, desde, hasta, motivo: motivo?.[1].trim() || "" };
        }
        if (!["registra","marca","deja","anota","agrega","ingresa","guarda","inicia","termina","cierra","pon"].includes(verbo)) return null;
        const nota = t.match(/^nota\s+(?:(operativa|de\s+reserva)\s+)?/i);
        if (nota) {
            const partes = separarTexto(t.slice(nota[0].length));
            if (!partes) return error("Escribe la cabaña o reserva y después «:» seguido del texto de la nota.");
            const q = destino(partes.base, dia, true);
            return q.error ? q : { accion: "nota", texto: partes.texto, asociar: /reserva/i.test(nota[1] || "") || Boolean(q.titular || q.codigo), ...q };
        }
        const aseo = t.match(/^aseo\s+/i);
        if (aseo) {
            const contenido = t.slice(aseo[0].length);
            const etiquetas = [...contenido.matchAll(/\b(in|out|encargad[oa])\s*:?\s+/gi)];
            const primero = etiquetas[0]?.index ?? contenido.length;
            let base = contenido.slice(0, primero);
            const manual = base.match(/\b(no\s+requiere|pendiente)\b/i);
            if (manual) base = base.replace(manual[0], "");
            const q = destino(base, dia, true);
            if (q.error || !q.cabana || q.titular || q.codigo) return error("Indica la cabaña y la fecha del aseo.");
            const campos = {};
            for (const [i, e] of etiquetas.entries()) {
                const k = L.normalizar(e[1]).startsWith("encargad") ? "encargado_nombre" : L.normalizar(e[1]);
                const valor = sinPunto(contenido.slice(e.index + e[0].length, etiquetas[i+1]?.index)).replace(/[,;]\s*$/, "").trim();
                if (Object.hasOwn(campos, k)) return error("Indica un solo IN, OUT y encargado.");
                campos[k] = k === "encargado_nombre" ? valor : hora(valor);
                if (!campos[k]) return error("Revisa los datos de aseo. Usa IN 10:00 y OUT 11:30.");
            }
            if (manual && (campos.in || campos.out)) return error("Indica el estado o las horas de aseo en solicitudes separadas.");
            const estado = manual ? (L.normalizar(manual[0]) === "pendiente" ? "pendiente" : "no_requiere") : null;
            if (!estado && !etiquetas.length) return error("Indica IN, OUT, el encargado o «no requiere» para el aseo.");
            return { accion: "aseo", estado, campos, ...q };
        }
        const revision = t.match(/^(revisi[oó]n|revsi[oó]n|repaso)\s+(?:(completa|express)\s+)?/i);
        if (!revision) return null;
        const estado = t.match(/\b(con\s+detalles|en\s+revisi[oó]n|pendiente|list[ao]|terminada)\b/i);
        if (!estado && verbo !== "inicia") return error("Indica el estado de la revisión: lista, con detalles, en revisión o pendiente.");
        const q = destino(t.slice(revision[0].length).replace(estado?.[0] || "", ""), dia, true);
        if (q.error || !q.cabana || q.titular || q.codigo) return error("Indica la cabaña y la fecha de la revisión.");
        const nombre = L.normalizar(estado?.[0] || "en revisión").replace(/\s+/g, " ");
        const valor = { "con detalles": "con-detalles", "en revision": "en_revision", pendiente: "pendiente" }[nombre] || "lista";
        return { accion: "revision", modalidad: /^repaso/i.test(revision[1]) ? "repaso" : L.normalizar(revision[2]) || null, estado: valor, ...q };
    }

    function contacto(verbo, t, dia) {
        if (["cobra","cobrar","cobrame","pide"].includes(verbo) && /^(?:el\s+)?(?:saldo|cobro|pago)\b/i.test(t)) {
            const q = destino(t.replace(/^(?:el\s+)?(?:saldo|cobro|pago)\s*/i, ""), dia);
            return q.error ? q : { accion: "cobrar", ...q };
        }
        if (!["envia","enviar","manda","mandar","escribe","redacta","prepara"].includes(verbo)) return null;
        const m = t.match(/^(?:mensaje(?:\s+por\s+(?:whats\s*app|correo))?|whats\s*app|correo)\s+/i);
        if (!m) return null;
        const partes = separarTexto(t.slice(m[0].length));
        if (!partes) return error("Indica la reserva y escribe «:» seguido del mensaje.");
        const q = destino(partes.base, dia);
        return q.error ? q : { accion: "mensaje", canal: /correo/i.test(m[0]) ? "correo" : "whatsapp", texto: partes.texto, ...q };
    }

    function interpretar(texto, { diaActual = L.hoy() } = {}) {
        const { limpia, verbo, resto } = L.orden(texto, true);
        // Comandos con texto de nota o mensaje conservan acentos, signos y saltos.
        const t = sinArticulo(L.corregirEntidadInicial(resto || limpia)).replace(/^[¿¡]+/, "");
        const directo = L.normalizar(limpia).match(/^(check[ -]?out|no[ -]?show)\s+(.+)$/);
        if (directo) {
            const base = limpia.replace(/^(check[ -]?out|no[ -]?show)\s+/i, "");
            return cambiarEstado(directo[1].includes("out") ? "checkout" : "no-show", base, diaActual);
        }
        return pagos(verbo, t, diaActual) || cambiarEstado(verbo, t, diaActual) ||
            operacionCabana(verbo, t, diaActual) || contacto(verbo, t, diaActual) ||
            servicios(verbo, t, diaActual) || editarReserva(verbo, t, diaActual);
    }

    const api = Object.freeze({ interpretar, hora, rango });
    root.HAIKU_ASISTENTE_OPERACIONES_V1 = api;
    if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
