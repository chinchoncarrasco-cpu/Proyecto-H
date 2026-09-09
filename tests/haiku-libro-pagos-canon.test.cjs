const test = require('node:test');
const assert = require('node:assert/strict');

global.document = {
    readyState: 'complete',
    getElementById() { return null; },
    createElement() { return {}; },
    head: { appendChild() {} }
};
global.HAIKU_LIBRO_RESERVA_V1 = Object.freeze({
    version: 'test',
    consultarHoja: async data => data
});
require('../js/haiku-libro-pagos-canon-v1.js');
const C = global.HAIKU_LIBRO_PAGOS_CANON_V1;

test('WebPay keeps its channel together with debit or credit card type',()=>{
    assert.equal(C.medioDesdeTexto({texto_original:'WEBPAY // CREDITO // CodAut 285466'}),'webpay_credito');
    assert.equal(C.medioDesdeTexto({texto_original:'WEBPAY // DEBITO // CodAut 285466'}),'webpay_debito');
    assert.equal(C.medioDesdeTexto({texto_original:'CREDITO // Folio 12 // BOVTAR 34'}),'credito');
});

test('Paulina: one $190.000 transaction keeps two applications instead of becoming a $160.000 payment',()=>{
    const common={titular:'Paulina Varas',cabana:1,fecha_bloque:'2026-09-10',fecha_comprobante:'2026-09-08',moneda:'CLP',
        codigo_autorizacion:'285466',medio_pago:'webpay',pago_recibido:true,estado_pago:'registrado_en_libro'};
    const grouped=C.agruparTransaccionesDistribuidas([
        {...common,monto:160000,concepto:'Alojamiento',tipo_movimiento:'alojamiento',texto_original:'WEBPAY CREDITO // CodAut 285466 // MONTO $190.000 // Alojamiento'},
        {...common,monto:30000,concepto:'Tinaja Jacuzzi',tipo_movimiento:'servicio',texto_original:'WEBPAY CREDITO // CodAut 285466 // MONTO $190.000 // Tinaja Jacuzzi'}
    ].map(C.corregirPago));
    assert.equal(grouped.length,1);
    assert.equal(grouped[0].monto,190000);
    assert.equal(grouped[0].medio_pago,'webpay_credito');
    assert.equal(grouped[0].tipo_movimiento,'distribuido');
    assert.deepEqual(grouped[0].aplicaciones_libro.map(x=>x.monto),[160000,30000]);
});

test('shared identifier with incompatible totals is not silently consolidated',()=>{
    const base={codigo_autorizacion:'X1',monto:100000,moneda:'CLP',texto_original:'CodAut X1 // MONTO $190.000'};
    assert.equal(C.agruparTransaccionesDistribuidas([base,{...base,monto:50000}]).length,2);
});
