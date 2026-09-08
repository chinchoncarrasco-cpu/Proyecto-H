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

    function ajustarResultadoPagos(data) {
        if (!data || typeof data !== "object") return data;
        const cache = new Map();
        const ajustar = pago => {
            if (!pago || typeof pago !== "object") return pago;
            if (!cache.has(pago)) cache.set(pago, ajustarPagoLibro(pago));
            return cache.get(pago);
        };
        return {
            ...data,
            pagos: Array.isArray(data.pagos) ? data.pagos.map(ajustar) : data.pagos,
            reservas: Array.isArray(data.reservas) ? data.reservas.map(reserva => ({
                ...reserva,
                pagos: Array.isArray(reserva.pagos) ? reserva.pagos.map(ajustar) : reserva.pagos,
                pagos_sin_asociacion: Array.isArray(reserva.pagos_sin_asociacion) ? reserva.pagos_sin_asociacion.map(ajustar) : reserva.pagos_sin_asociacion
            })) : data.reservas
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
