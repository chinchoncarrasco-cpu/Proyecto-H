// ========================================
// HAIKU · RESUMEN FINANCIERO COMPARTIDO
// Lectura pura de cargos y pagos de una reserva
// ========================================

(() => {
    "use strict";

    function sumar(lista, campo) {
        return (lista || []).reduce(
            (total, item) => total + Number(item?.[campo] || 0),
            0
        );
    }

    function montoCargo(cargo) {
        return Number(cargo?.monto_ajustado ?? cargo?.monto ?? 0);
    }

    function calcular(cargos = [], pagos = []) {
        const activos = cargos.filter(cargo => cargo?.estado === "activo");
        const confirmados = pagos.filter(pago =>
            pago?.tipo_movimiento === "pago" && pago?.estado === "confirmado"
        );
        const servicios = activos.filter(cargo => cargo?.tipo_cargo === "servicio");

        return {
            total: activos.reduce((total, cargo) => total + montoCargo(cargo), 0),
            abono: sumar(confirmados, "monto"),
            saldo: sumar(activos, "saldo_cargo"),
            servicios: sumar(servicios, "saldo_cargo")
        };
    }

    window.HAIKU_FINANZAS_RESUMEN_V1 = Object.freeze({ calcular });
})();
