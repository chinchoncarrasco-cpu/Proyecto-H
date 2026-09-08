(function (root) {
    "use strict";
    const base = root.HAIKU_LIBRO_SEMANTICA;
    if (!base || typeof base.normalizar !== "function") return;

    const normalizarBase = base.normalizar.bind(base);
    const meses = {
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
        julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
        noviembre: 11, diciembre: 12
    };

    const ETIQUETA_FRECUENTE = /^(?:huesped|cliente)\s+frecuente(?:\s+trato\s+especial)?$/;
    const ETIQUETA_NO_TITULAR = /^(?:(?:huesped|cliente)\s+frecuente(?:\s+trato\s+especial)?|trato\s+especial|late\s*check\s*out|full\s*day|x\s+hacer|por\s+hacer|pendiente|sin\s+titular)$/;

    function partesReservaLibro(texto) {
        return String(texto || "")
            .split(/\s*\/\/\s*|\n/)
            .map(x => x.trim())
            .filter(Boolean);
    }

    function esNombrePersonaLibro(texto) {
        const limpio = String(texto || "").trim();
        const normal = normalizarBase(limpio);
        if (!limpio || ETIQUETA_NO_TITULAR.test(normal)) return false;
        if (/^(full\s*day|promo\b|voucher\b|lista arcoiris|booking\b)/.test(normal)) return false;
        if (/\b(?:adult|adl\b|nino|nin\b|mascota|noche|rut\b|correo|telefono|cortesia|tinaja|jacuzzi|masaje|check\s*out|check\s*in)\b/.test(normal)) return false;
        if (!/^[\p{L}][\p{L}\s.'’()-]+$/u.test(limpio)) return false;
        const palabras = limpio.split(/\s+/).filter(Boolean).length;
        return palabras >= 2 && palabras <= 7;
    }

    function notasFrecuenteDesdeTexto(texto) {
        return partesReservaLibro(texto).filter(parte => ETIQUETA_FRECUENTE.test(normalizarBase(parte)));
    }

    function repararTitularYNotas(reserva) {
        if (!reserva || typeof reserva !== "object") return reserva;
        const partes = partesReservaLibro(reserva.texto_original);
        const actual = normalizarBase(reserva.titular);
        let titular = reserva.titular;

        if (ETIQUETA_NO_TITULAR.test(actual)) {
            const candidato = partes.find(esNombrePersonaLibro);
            if (candidato) titular = candidato;
        }

        const notasSemanticas = notasFrecuenteDesdeTexto(reserva.texto_original);
        const notasImportantes = [...new Set([
            ...(Array.isArray(reserva.notas_importantes) ? reserva.notas_importantes : []),
            ...notasSemanticas
        ])];

        return {
            ...reserva,
            titular,
            notas_importantes: notasImportantes
        };
    }

    function marcaOperativaDesdeReserva(reserva) {
        const t = normalizarBase(reserva?.titular);
        if (!/^(?:late\s*check\s*out|full\s*day)$/.test(t)) return null;
        const esLate = /^late\s*check\s*out$/.test(t);
        const rojo = String(reserva?.formato?.fondo || "").toUpperCase() === "FF0000";
        return {
            fecha: reserva.fecha_checkin,
            cabana: reserva.cabana,
            estado: rojo ? "bloqueo_operativo" : "bloque_o_marca",
            subtipo: esLate ? "late_check_out" : "full_day_marca",
            bloquea_venta: rojo,
            texto_original: reserva.texto_original,
            origen: reserva.coordenadas_origen,
            motivo: esLate
                ? "Marca operativa LATE CHECK OUT del Libro; no corresponde al nombre de un huésped ni a una reserva nueva."
                : "Marca operativa FULLDAY del Libro; no corresponde al nombre de un huésped."
        };
    }

    function ajustarEspacioLibro(espacio) {
        if (!espacio || typeof espacio !== "object") return espacio;
        const t = normalizarBase(espacio.texto_original);
        if (!/^full\s*day$/.test(t)) return espacio;

        const fechaFullDay = espacio.fecha && typeof base.sumarDias === "function"
            ? base.sumarDias(espacio.fecha, 1)
            : null;

        return {
            ...espacio,
            estado: "bloqueo_previo_fullday",
            subtipo: "fullday_dia_siguiente",
            fecha_fullday: fechaFullDay,
            bloquea_alojamiento_nocturno: true,
            horario_fullday: { ingreso: "09:30", salida: "21:30" },
            checkout_alojamiento_estandar: "12:00",
            motivo: fechaFullDay
                ? `Día bloqueado por convención del Libro: el ${fechaFullDay} hay FULLDAY de 09:30 a 21:30. Una estadía nocturna iniciada este día saldría a las 12:00 del día siguiente y se superpondría con el FULLDAY.`
                : "Día bloqueado por convención del Libro porque al día siguiente hay FULLDAY de 09:30 a 21:30; una salida normal a las 12:00 se superpondría."
        };
    }

    function pareceConsultaLibro(original, normalizado) {
        const raw = String(original || "");
        return /\b(?:haku|libro)\b/i.test(raw) &&
            /\b(?:reserva(?:s)?|hu[eé]sped(?:es)?|titular(?:es)?|pago(?:s)?)\b/i.test(raw) &&
            /\b(?:revisa|revisar|busca|buscar|encuentra|encontrar|verifica|verificar|compara|comparar|agr[eé]ga(?:r|lo|la|los|las)?|incorpora(?:r|lo|la|los|las)?|actualiza(?:r|lo|la|los|las)?|actualice(?:lo|la|los|las)?|registra(?:r|lo|la|los|las)?|modifica(?:r|lo|la|los|las)?)\b/i.test(raw) &&
            /\b(?:reserva(?:s)?|huesped(?:es)?|titular(?:es)?|pago(?:s)?)\b/.test(normalizado);
    }

    function canonizarBusquedaTitular(texto) {
        return texto.replace(
            /\b(?:busca|buscar|encuentra|encontrar|revisa|revisar|verifica|verificar)\s+(?:la\s+reserva\s+de\s+|(?:al?|el)\s+titular\s+|a\s+)([\p{L}][\p{L}\s.'’()-]*?)(?=\s*[,;:.]|\s+(?:y|e|si|que|para|con|revisa|revisar|verifica|verificar|compara|comparar|agrega[a-z]*|incorpora[a-z]*|actualiza[a-z]*|actualice[a-z]*|registra[a-z]*|modifica[a-z]*)\b|$)/gu,
            (_, nombre) => `titular ${nombre.trim()}. `
        );
    }

    function separarTitular(texto) {
        return texto.replace(
            /\b((?:reserva|huesped|titular)\s+(?:de\s+)?)([\p{L}][\p{L}\s.'’()-]*?)(?:\s*[,;:]\s*|\s+)(?=\b(?:si|que|para|porque|cuando|donde|revisa|revisar|compara|comparar|agrega[a-z]*|incorpora[a-z]*|actualiza[a-z]*|actualice[a-z]*|registra[a-z]*|modifica[a-z]*|(?:y|e)\s+(?:si|que|luego|ahora|despues|revisa|revisar|compara|comparar|agrega[a-z]*|incorpora[a-z]*|actualiza[a-z]*|actualice[a-z]*|registra[a-z]*|modifica[a-z]*))\b)/u,
            (_, prefijo, nombre) => `${prefijo}${nombre.trim()}. `
        );
    }

    function canonizarAcciones(texto) {
        return texto
            .replace(/\bagrega(?:r)?(?:lo|la|los|las)?\b/g, "agrega")
            .replace(/\bincorpora(?:r)?(?:lo|la|los|las)?\b/g, "incorpora")
            .replace(/\bregistra(?:r)?(?:lo|la|los|las)?\b/g, "registra")
            .replace(/\bactualiza(?:r)?(?:lo|la|los|las)?\b/g, "modifica")
            .replace(/\bactualice(?:lo|la|los|las)?\b/g, "modifica")
            .replace(/\bmodifica(?:r)?(?:lo|la|los|las)?\b/g, "modifica");
    }

    function canonizarPeriodo(texto) {
        return texto.replace(
            /\b(?:mes\s+(?:de\s+)?|en\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/g,
            (_, nombreMes, year) => {
                const mes = meses[nombreMes];
                const mm = String(mes).padStart(2, "0");
                const ultimo = new Date(Date.UTC(Number(year), mes, 0)).getUTCDate();
                return `01-${mm}-${year} ${String(ultimo).padStart(2, "0")}-${mm}-${year}`;
            }
        );
    }

    function normalizarConsulta(valor) {
        let texto = normalizarBase(valor);
        if (!pareceConsultaLibro(valor, texto)) return texto;
        texto = canonizarBusquedaTitular(texto);
        texto = separarTitular(texto);
        texto = canonizarAcciones(texto);
        return canonizarPeriodo(texto);
    }

    root.HAIKU_LIBRO_SEMANTICA = Object.freeze({ ...base, normalizar: normalizarConsulta });

    // Compatibilidad de pagos del Libro real:
    // - una fila del bloque de pagos con monto representa un pago recibido;
    // - "Webpay por confirmar" es un pendiente administrativo, no una deuda del huésped;
    // - si la glosa dice débito/crédito, ese dato específico tiene prioridad sobre "Webpay".
    function ajustarPagoLibro(pago) {
        if (!pago || typeof pago !== "object") return pago;
        const texto = normalizarBase(pago.texto_original || "");
        const pendienteCliente = /(?:\bpor\b|\bx\b)\s*pagar\b|saldo\s+pendiente/.test(texto);
        const webpayPorConfirmar = /web\s*pay.{0,25}(?:por|x)\s*confirmar/.test(texto);
        const copia = { ...pago, webpay_por_confirmar: webpayPorConfirmar };

        if (/\bdebito\b/.test(texto)) copia.medio_pago = "debito";
        else if (/\bcredito\b/.test(texto)) copia.medio_pago = "credito";
        else if (/transf/.test(texto)) copia.medio_pago = "transferencia";
        else if (/efectivo/.test(texto)) copia.medio_pago = "efectivo";
        else if (/web\s*pay/.test(texto)) copia.medio_pago = "webpay";

        const montoValido = Number.isFinite(Number(copia.monto)) && Number(copia.monto) > 0;
        if (copia.tipo_movimiento !== "penalidad" && montoValido && !pendienteCliente) {
            copia.estado_pago = "registrado_en_libro";
            copia.pago_recibido = true;
        } else if (pendienteCliente) {
            copia.estado_pago = "pendiente";
            copia.pago_recibido = null;
        }
        return copia;
    }

    function esNotaAdministrativaFinanciera(pago) {
        if (!pago || typeof pago !== "object") return false;
        const monto = Number(pago.monto);
        if (Number.isFinite(monto) && monto > 0) return false;
        const texto = normalizarBase(pago.texto_original || "");
        if (!texto) return false;
        return /\b(?:bove|manager|boleta)\b/.test(texto) ||
            /\bpend(?:iente)?\b[^\n]{0,40}\b\d+\s*%/.test(texto);
    }

    function notaFinancieraDesdePago(pago) {
        return {
            texto_original: pago?.texto_original || "",
            origen: pago?.origen || null,
            fecha: pago?.fecha_bloque || null,
            cabana: pago?.cabana || null,
            tipo: "nota_financiera_administrativa",
            motivo: "Pendiente administrativo de BOVE, Manager o boleta. No corresponde a un pago independiente."
        };
    }

    function ajustarResultadoPagos(data) {
        if (!data || typeof data !== "object") return data;
        const cache = new Map();
        const ajustar = pago => {
            if (!pago || typeof pago !== "object") return pago;
            if (!cache.has(pago)) cache.set(pago, ajustarPagoLibro(pago));
            return cache.get(pago);
        };

        const reservas = [];
        const espaciosExtra = [];
        const anotacionesExtra = [];
        const notasFinancierasVistas = new Set();

        const depurarPagos = lista => {
            if (!Array.isArray(lista)) return lista;
            const salida = [];
            for (const pago of lista) {
                if (esNotaAdministrativaFinanciera(pago)) {
                    const clave = `${pago?.origen?.hoja || ""}|${pago?.origen?.celda || ""}|${pago?.texto_original || ""}`;
                    if (!notasFinancierasVistas.has(clave)) {
                        notasFinancierasVistas.add(clave);
                        anotacionesExtra.push(notaFinancieraDesdePago(pago));
                    }
                    continue;
                }
                salida.push(ajustar(pago));
            }
            return salida;
        };

        for (const original of Array.isArray(data.reservas) ? data.reservas : []) {
            const reserva = repararTitularYNotas(original);
            const marca = marcaOperativaDesdeReserva(reserva);
            if (marca) {
                espaciosExtra.push(marca);
                continue;
            }

            if (ETIQUETA_FRECUENTE.test(normalizarBase(reserva?.titular))) {
                anotacionesExtra.push({
                    texto_original: reserva.texto_original,
                    origen: reserva.coordenadas_origen,
                    fecha: reserva.fecha_checkin,
                    cabana: reserva.cabana,
                    tipo: "nota_huesped_frecuente_sin_titular"
                });
                continue;
            }

            reservas.push({
                ...reserva,
                pagos: depurarPagos(reserva.pagos),
                pagos_sin_asociacion: depurarPagos(reserva.pagos_sin_asociacion)
            });
        }

        const espacios = [
            ...(Array.isArray(data.espacios) ? data.espacios.map(ajustarEspacioLibro) : []),
            ...espaciosExtra
        ];

        return {
            ...data,
            pagos: depurarPagos(data.pagos),
            reservas,
            espacios,
            anotaciones: [
                ...(Array.isArray(data.anotaciones) ? data.anotaciones : []),
                ...anotacionesExtra
            ]
        };
    }

    function instalarCompatibilidadPagos() {
        const libro = root.HAIKU_LIBRO_RESERVA_V1;
        if (!libro || libro.__haikuPagosCompatV1 || typeof libro.consultarHoja !== "function") return;
        const consultarHojaBase = libro.consultarHoja.bind(libro);
        root.HAIKU_LIBRO_RESERVA_V1 = Object.freeze({
            ...libro,
            __haikuPagosCompatV1: true,
            consultarHoja: async (...args) => {
                const resultado = await consultarHojaBase(...args);
                return args[2] === "buscar" ? resultado : ajustarResultadoPagos(resultado);
            }
        });
    }

    instalarCompatibilidadPagos();
    if (!root.HAIKU_LIBRO_RESERVA_V1 && root.document?.readyState === "loading") {
        root.document.addEventListener("DOMContentLoaded", instalarCompatibilidadPagos, { once: true });
    }
})(typeof window !== "undefined" ? window : globalThis);
