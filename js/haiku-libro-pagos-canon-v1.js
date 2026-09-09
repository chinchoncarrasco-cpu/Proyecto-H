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

    let instalado = false;

    function asegurarUiPagos() {
        if (!root.document || document.getElementById("haiku-libro-pagos-ui-v1-script")) return;
        const script = document.createElement("script");
        script.id = "haiku-libro-pagos-ui-v1-script";
        script.src = "js/haiku-libro-pagos-ui-v1.js?v=1";
        script.defer = true;
        document.head.appendChild(script);
    }

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

        // Proyecto H histórico guarda el identificador mostrado como BOVTAR en
        // `pagos.bove` para varios pagos de tarjeta. La conciliación antigua
        // compara ese campo, así que exponemos BOVTAR por ese canal únicamente
        // cuando el Libro realmente trae BOVTAR. Un BOVE administrativo sin
        // BOVTAR nunca convierte un movimiento en "nuevo seguro".
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

    function instalar() {
        if (instalado) return true;
        const api = root.HAIKU_LIBRO_RESERVA_V1;
        if (!api) return false;
        if (api.__haikuPagosCanonV1) {
            instalado = true;
            asegurarUiPagos();
            return true;
        }

        const consultarOriginal = api.consultarHoja?.bind(api);
        if (typeof consultarOriginal !== "function") return false;

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
        instalado = true;
        asegurarUiPagos();
        console.info("HAKU · Canon de pagos del Libro V1 preparado.");
        return true;
    }

    // `supabase-libro-reserva-v1.js` puede crear su API recién en
    // DOMContentLoaded. Este módulo se carga inmediatamente después; por eso no
    // debe rendirse si la API todavía no existe. Se instala en cuanto el Libro
    // termina de inicializarse y deja un retry corto como defensa adicional.
    if (!instalar()) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", instalar, { once: true });
        }
        let intentos = 0;
        const timer = setInterval(() => {
            intentos += 1;
            if (instalar() || intentos >= 40) clearInterval(timer);
        }, 50);
    }
})(typeof window !== "undefined" ? window : globalThis);