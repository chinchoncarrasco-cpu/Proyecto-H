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

test('BOVE, BOVTAR and CodAut remain three independent identifiers',()=>{
    const pago=C.corregirPago({bove:'16979',bovtar:'094778',codigo_autorizacion:'091559',
        texto_original:'BOVE 16979 // Folio 000250 // BOVTAR 094778 // CodAut 091559 // WebPay crédito'});
    assert.equal(pago.bove,'16979');
    assert.equal(pago.bove_administrativo,'16979');
    assert.equal(pago.bovtar,'094778');
    assert.equal(pago.codigo_autorizacion,'091559');
});

test('Paulina: one $190.000 transaction keeps two applications instead of becoming a $160.000 payment',()=>{
    const common={titular:'Paulina Varas',cabana:1,fecha_bloque:'2026-09-10',fecha_comprobante:'2026-09-08',moneda:'CLP',
        codigo_autorizacion:'285466',medio_pago:'webpay',pago_recibido:true,estado_pago:'registrado_en_libro'};
    const grouped=C.agruparTransaccionesDistribuidas([
        {...common,monto:160000,concepto:'Alojamiento',tipo_movimiento:'alojamiento',origen:{hoja:'Sep26',celda:'A1:D1'},texto_original:'WEBPAY CREDITO // CodAut 285466 // MONTO $190.000 // Alojamiento'},
        {...common,monto:30000,concepto:'Tinaja Jacuzzi',tipo_movimiento:'servicio',origen:{hoja:'Sep26',celda:'A2:D2'},texto_original:'WEBPAY CREDITO // CodAut 285466 // MONTO $190.000 // Tinaja Jacuzzi'}
    ].map(C.corregirPago));
    assert.equal(grouped.length,1);
    assert.equal(grouped[0].monto,190000);
    assert.equal(grouped[0].medio_pago,'webpay_credito');
    assert.equal(grouped[0].tipo_movimiento,'distribuido');
    assert.deepEqual(grouped[0].aplicaciones_libro.map(x=>x.monto),[160000,30000]);
});

test('Paulina: a pending WebPay note still forms one receipt for verification against Proyecto H',()=>{
    const common={titular:'Paulina Varas',cabana:3,fecha_bloque:'2026-09-04',fecha_comprobante:'2026-08-31',moneda:'CLP',
        codigo_autorizacion:'285466',medio_pago:'webpay',pago_recibido:null,estado_pago:'por_confirmar'};
    const grouped=C.agruparTransaccionesDistribuidas([
        {...common,monto:160000,concepto:'cab2/1noche',tipo_movimiento:'alojamiento',origen:{hoja:'Sep26',celda:'K46:N46'},texto_original:'Paulina Varas // Webpay por confirmar // COD.AUT: 285466 // MONTO $190.000 // CREDITO'},
        {...common,monto:30000,concepto:'TINAJA',tipo_movimiento:'servicio',origen:{hoja:'Sep26',celda:'K47:N47'},texto_original:'Paulina Varas // Webpay por confirmar // COD.AUT: 285466 // MONTO $190.000 // CREDITO'}
    ].map(C.corregirPago));
    assert.equal(grouped.length,1);
    assert.equal(grouped[0].monto,190000);
    assert.equal(grouped[0].estado_pago,'por_confirmar');
    assert.equal(grouped[0].evidencia_agrupacion.confirmacion_pago,'requiere_pago_existente_en_proyecto_h');
    assert.deepEqual(grouped[0].aplicaciones_libro.map(x=>[x.concepto,x.monto]),[['cab2/1noche',160000],['TINAJA',30000]]);
});

test('shared identifier with incompatible totals is not silently consolidated',()=>{
    const base={codigo_autorizacion:'X1',monto:100000,moneda:'CLP',texto_original:'CodAut X1 // MONTO $190.000'};
    assert.equal(C.agruparTransaccionesDistribuidas([base,{...base,monto:50000}]).length,2);
});

const aplicacion=(extra={})=>({titular:'Persona Prueba',cabana:5,fecha_bloque:'2026-09-13',fecha_comprobante:'2026-09-13',
 moneda:'CLP',folio:'000271',bovtar:'008714',medio_pago:'debito',pago_recibido:true,estado_pago:'registrado_en_libro',
 monto:30000,concepto:'Tinaja',tipo_movimiento:'servicio',texto_original:'Folio 000271 // BOVTAR 008714 // Débito',
 origen:{hoja:'Sep26',celda:'AU47:AX47'},...extra});

test('Camila: explicit total creates one transaction with Tinaja and firewood applications',()=>{
 const filas=[aplicacion({texto_original:'TOTAL $38.000 // Folio 000271 // BOVTAR 008714'}),
  aplicacion({monto:8000,concepto:'Leña',origen:{hoja:'Sep26',celda:'AU48:AX48'},texto_original:'TOTAL $38.000 // Folio 000271 // BOVTAR 008714'})];
 const [tx]=C.agruparTransaccionesDistribuidas(filas.map(C.corregirPago));
 assert.equal(tx.monto_total,38000);assert.equal(tx.total_declarado,38000);assert.equal(tx.total_inferido,false);
 assert.deepEqual(tx.aplicaciones_libro.map(x=>[x.concepto,x.monto]),[['Tinaja',30000],['Leña',8000]]);
 assert.deepEqual(tx.origenes.map(x=>x.celda),['AU47:AX47','AU48:AX48']);
});

test('Hernan: strong shared voucher permits one inferred parent with two applications',()=>{
 const filas=[aplicacion({titular:'Hernán Guzmán',cabana:8,fecha_bloque:'2026-09-14',fecha_comprobante:'2026-09-14',folio:'000276',bovtar:'300549',origen:{hoja:'Sep26',celda:'AY62:BB62'}}),
  aplicacion({titular:'Hernán Guzmán',cabana:8,fecha_bloque:'2026-09-14',fecha_comprobante:'2026-09-14',folio:'000276',bovtar:'300549',monto:70000,concepto:'Masaje',origen:{hoja:'Sep26',celda:'AY63:BB63'}})];
 const [tx]=C.agruparTransaccionesDistribuidas(filas.map(C.corregirPago));
 assert.equal(tx.monto_total,100000);assert.equal(tx.total_declarado,null);assert.equal(tx.total_inferido,true);
 assert.deepEqual(tx.aplicaciones_libro.map(x=>x.monto),[30000,70000]);
});

test('Alejandro: explicit 50k voucher groups Late Out and Jacuzzi only with complete evidence',()=>{
 const common={titular:'Alejandro Ramos Donaire',cabana:2,fecha_bloque:'2026-09-06',fecha_comprobante:'2026-09-06',folio:'000250',bovtar:'094778'};
 const filas=[aplicacion({...common,monto:20000,concepto:'LATEOUT',texto_original:'TOTAL: CLP$50,000',origen:{hoja:'Sep26',celda:'S33:V33'}}),
  aplicacion({...common,monto:30000,concepto:'JACUZZI',texto_original:'TOTAL: CLP$50,000',origen:{hoja:'Sep26',celda:'S34:V34'}})];
 const [tx]=C.agruparTransaccionesDistribuidas(filas.map(C.corregirPago));
 assert.equal(tx.monto_total,50000);assert.equal(tx.aplicaciones_libro.length,2);
});

test('three applications group, while one row and weak identity preserve their prior shape',()=>{
 const tres=[aplicacion(),aplicacion({monto:8000,concepto:'Leña',origen:{hoja:'Sep26',celda:'AU48:AX48'}}),
  aplicacion({monto:5000,concepto:'Carbón',origen:{hoja:'Sep26',celda:'AU49:AX49'}})];
 const grouped=C.agruparTransaccionesDistribuidas(tres.map(C.corregirPago));assert.equal(grouped.length,1);assert.equal(grouped[0].aplicaciones_libro.length,3);
 assert.equal(C.agruparTransaccionesDistribuidas([aplicacion()]).length,1);
 const debiles=tres.map((x,i)=>({...x,folio:null,bovtar:null,origen:{hoja:'Sep26',celda:`A${i+1}:D${i+1}`}}));
 assert.equal(C.agruparTransaccionesDistribuidas(debiles).length,3);
});

test('same strong identifier never groups incompatible reservation, currency, medium or duplicate application',()=>{
 for(const [caso,cambio] of [
  ['titular',{titular:'Otra Persona'}], ['moneda',{moneda:'USD'}],
  ['medio',{medio_pago:'efectivo',texto_original:'Folio 000271 // BOVTAR 008714 // Efectivo'}],
  ['aplicación duplicada',{concepto:'Tinaja'}]
 ]) {
  const filas=[aplicacion(),aplicacion({monto:8000,concepto:'Leña',origen:{hoja:'Sep26',celda:'AU48:AX48'},...cambio})];
  const out=C.agruparTransaccionesDistribuidas(filas.map(C.corregirPago));
  assert.equal(out.length,2,caso);assert.ok(out.every(x=>x.conflicto_distribucion),caso);
 }
});

test('explicit total mismatch stays separate for review; cancelled and financial notes never join',()=>{
 const mismatch=[aplicacion({texto_original:'TOTAL $39.000'}),aplicacion({monto:8000,concepto:'Leña',origen:{hoja:'Sep26',celda:'AU48:AX48'},texto_original:'TOTAL $39.000'})];
 const out=C.agruparTransaccionesDistribuidas(mismatch.map(C.corregirPago));assert.equal(out.length,2);assert.ok(out.every(x=>x.conflicto_distribucion));
 const anulada=aplicacion({monto:8000,concepto:'Leña',estado:'anulado',origen:{hoja:'Sep26',celda:'AU48:AX48'}});
 assert.equal(C.agruparTransaccionesDistribuidas([aplicacion(),anulada].map(C.corregirPago)).length,2);
 const nota=aplicacion({monto:8000,concepto:'Reembolso',tipo_movimiento:'otro',texto_original:'REEMBOLSO POR GESTIONAR',origen:{hoja:'Sep26',celda:'AU48:AX48'}});
 assert.equal(C.agruparTransaccionesDistribuidas([aplicacion(),nota].map(C.corregirPago)).length,2);
});
