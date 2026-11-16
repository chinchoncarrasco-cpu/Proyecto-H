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

    function detalle(cargos=[],pagos=[]){
        const resumen=calcular(cargos,pagos),activos=cargos.filter(c=>c.estado==='activo');
        const aplicado=sumar(activos,'aplicado_neto');
        const devoluciones=sumar(pagos.filter(p=>p.tipo_movimiento==='devolucion'&&p.estado==='confirmado'),'monto');
        const neto=resumen.abono-devoluciones;
        return {...resumen,saldoCargos:resumen.saldo,saldoNeto:Math.max(resumen.total-neto,0),
            saldoFavor:Math.max(neto-resumen.total,0),sinAplicar:Math.max(neto-aplicado,0),aplicado};
    }
    window.HAIKU_FINANZAS_RESUMEN_V1 = Object.freeze({ calcular,detalle });
})();
