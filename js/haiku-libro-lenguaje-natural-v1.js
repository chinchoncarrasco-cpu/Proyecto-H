(function (root) {
    "use strict";
    const base = root.HAIKU_LIBRO_SEMANTICA;
    if (!base || typeof base.normalizar !== "function") return;

    const normalizarBase = base.normalizar.bind(base);

    function pareceConsultaLibro(original, normalizado) {
        const raw = String(original || "");
        return /\b(?:haku|libro)\b/i.test(raw) &&
            /\b(?:reserva|hu[eé]sped|titular)\b/i.test(raw) &&
            /\b(?:revisa|revisar|compara|comparar|agr[eé]ga(?:r|lo|la|los|las)?|incorpora(?:r|lo|la|los|las)?|actualiza(?:r|lo|la|los|las)?|actualice(?:lo|la|los|las)?|registra(?:r|lo|la|los|las)?|modifica(?:r|lo|la|los|las)?)\b/i.test(raw) &&
            /\b(?:reserva|huesped|titular)\b/.test(normalizado);
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

    function normalizarConsulta(valor) {
        let texto = normalizarBase(valor);
        if (!pareceConsultaLibro(valor, texto)) return texto;
        texto = separarTitular(texto);
        return canonizarAcciones(texto);
    }

    root.HAIKU_LIBRO_SEMANTICA = Object.freeze({ ...base, normalizar: normalizarConsulta });
})(typeof window !== "undefined" ? window : globalThis);
