// ========================================
// HAKU · PAGOS FECHA EXACTA V1
// En una consulta individual con fecha explícita, esa fecha corresponde al
// pago solicitado. Filtra movimientos de otras fechas después de que la capa
// de pagos relacionados haya recuperado eventuales movimientos huérfanos.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_LIBRO_PAGOS_FECHA_EXACTA_V1) return;

    function normalizar(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function fechaCanon(valor) {
        const s = String(valor || "").trim();
        const iso = s.match(/^(20\d{2})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        const local = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/);
        if (!local) return null;
        const y = Number(local[3]) < 100 ? 2000 + Number(local[3]) : Number(local[3]);
        return `${String(y).padStart(4, "0")}-${String(Number(local[2])).padStart(2, "0")}-${String(Number(local[1])).padStart(2, "0")}`;
    }

    function fechaMovimiento(pago) {
        return fechaCanon(pago?.fecha_comprobante) ||
            fechaCanon(pago?.fecha_pago) ||
            fechaCanon(pago?.texto_original) ||
            fechaCanon(pago?.fecha_bloque) ||
            null;
    }

    function consultaIndividualFechaExacta(scope) {
        if (!scope?.fecha || scope?.objetivos?.length !== 1 || scope.objetivos[0]?.cabana) return false;
        const texto = normalizar(scope.texto);
        // Sólo se abre el rango si el operador lo pide expresamente.
        if (/\btodos\s+(?:los\s+)?pagos\b|\btodos\s+sus\s+pagos\b|\btodos\s+(?:los\s+)?movimientos\b/.test(texto)) return false;
        return true;
    }

    function aplicar(data) {
        const scope = window.HAIKU_LIBRO_PAGOS_FOCALIZADOS_V1?.estado?.();
        if (!consultaIndividualFechaExacta(scope) || !Array.isArray(data?.reservas)) return data;

        return {
            ...data,
            reservas: data.reservas.map(r => ({
                ...r,
                pagos: (r.pagos || []).filter(p => fechaMovimiento(p) === scope.fecha),
                pagos_sin_asociacion: (r.pagos_sin_asociacion || []).filter(p => fechaMovimiento(p) === scope.fecha)
            }))
        };
    }

    function instalar() {
        const original = window.HAIKU_LIBRO_RESERVA_V1;
        if (!original || original.__pagosFechaExactaProxy) return Boolean(original);
        if (typeof original.consultarHoja !== "function") return false;

        const consultarOriginal = original.consultarHoja.bind(original);
        window.HAIKU_LIBRO_RESERVA_V1 = Object.freeze({
            ...original,
            __pagosFechaExactaProxy: true,
            consultarHoja: async (...args) => aplicar(await consultarOriginal(...args))
        });
        return true;
    }

    window.HAIKU_LIBRO_PAGOS_FECHA_EXACTA_V1 = Object.freeze({ version: "1.0.0", instalar, aplicar });

    instalar();
    if (!window.HAIKU_LIBRO_RESERVA_V1) document.addEventListener("DOMContentLoaded", instalar, { once: true });
})();
