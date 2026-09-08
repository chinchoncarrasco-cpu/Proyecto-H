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
})(typeof window !== "undefined" ? window : globalThis);
