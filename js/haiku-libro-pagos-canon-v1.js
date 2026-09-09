// ========================================
// HAKU · LIBRO · CANON DE PAGOS V1
// Capa conservadora previa a la conciliación Libro ↔ Proyecto H.
//
// Reglas:
// - BOVTAR sí identifica una transacción de tarjeta.
// - BOVE es un dato administrativo/tributario y NO demuestra un pago nuevo.
// - Corrige el medio de pago usando el texto original cuando viene explícito.
// - No inventa identidad para efectivo/transferencia sin referencia transaccional.
//
// Esta capa no escribe en Supabase ni modifica el XLSX. Sólo normaliza la
// copia semántica devuelta por Libro de Reserva antes de que Haku compare.
// ========================================
(function (root) {
    "use strict";

    const api = root.HAIKU_LIBRO_RESERVA_V1;
    if (!api || api.__haikuPagosCanonV1) return;

    const consultarOriginal = api.consultarHoja?.bind(api);
    if (typeof consultarOriginal !== "function") return;

    function normalizarTexto(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function canonId(valor) {
        return String(valor || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    }

    function medioDesdeTexto(pago) {
        const t = normalizarTexto(`${pago?.texto_original || ""} ${pago?.concepto || ""}`);
        if (/\bdebito\b/.test(t)) return "debito";
        if (/\bcredito\b/.test(t)) return "credito";
        if (/\btransf(?:erencia)?\b/.test(t)) return "transferencia";
        if (/\befectivo\b/.test(t)) return "efectivo";
        if (/\bweb\s*pay\b|\bwebpay\b/.test(t)) return "webpay";
        return pago?.medio_pago || null;
    }

    function corregirPago(pago) {
        if (!pago || typeof pago !== "object") return pago;

        const copia = { ...pago };
        const bovtar = canonId(pago.bovtar);
        const boveAdministrativo = pago.bove || null;

        // Conservamos el BOVE únicamente como dato de procedencia. La lógica
        // histórica de conciliación usa `bove` como identificador fuerte; por
        // eso aquí sólo colocamos BOVTAR en ese canal cuando BOVTAR realmente
        // existe. Un BOVE sin BOVTAR nunca convierte un movimiento en pago
        // "nuevo seguro".
        copia.bove_administrativo = boveAdministrativo;
        copia.bove = bovtar ? pago.bovtar : null;
        copia.medio_pago = medioDesdeTexto(pago);
        copia.identificador_pago = bovtar ? "bovtar" : (canonId(pago.codigo_autorizacion) ? "codigo_autorizacion" : null);

        return copia;
    }

    function corregirResultado(resultado) {
        if (!resultado || typeof resultado !== "object") return resultado;

        const copia = typeof structuredClone === "function"
            ? structuredClone(resultado)
            : JSON.parse(JSON.stringify(resultado));

        if (Array.isArray(copia.pagos)) {
            copia.pagos = copia.pagos.map(corregirPago);
        }

        if (Array.isArray(copia.reservas)) {
            copia.reservas = copia.reservas.map(reserva => ({
                ...reserva,
                pagos: Array.isArray(reserva?.pagos) ? reserva.pagos.map(corregirPago) : [],
                pagos_sin_asociacion: Array.isArray(reserva?.pagos_sin_asociacion)
                    ? reserva.pagos_sin_asociacion.map(corregirPago)
                    : []
            }));
        }

        return copia;
    }

    const envuelto = {
        ...api,
        __haikuPagosCanonV1: true,
        version: `${api.version || "1"}+pagos-canon-v1`,
        consultarHoja: async (...args) => corregirResultado(await consultarOriginal(...args))
    };

    root.HAIKU_LIBRO_RESERVA_V1 = Object.freeze(envuelto);
    root.HAIKU_LIBRO_PAGOS_CANON_V1 = Object.freeze({
        corregirPago,
        corregirResultado,
        medioDesdeTexto
    });

    console.info("HAKU · Canon de pagos del Libro V1 preparado.");
})(typeof window !== "undefined" ? window : globalThis);
