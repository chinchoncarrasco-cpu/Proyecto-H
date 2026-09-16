const test = require('node:test');
const assert = require('node:assert/strict');

const base = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_SEMANTICA = base;

const evidencia = (colores={detalle:'FFFFFFFF',concepto:'FFFFFFFF',monto:'FFFFFFFF'}) => ({
 sector:'pagos',estructura_fila:'fecha_detalle_concepto_monto',
 columnas_ocupadas:{fecha:true,detalle:true,concepto:true,monto:true},colores
});
const pago = (extra={}) => ({
 fecha_bloque:'2026-09-17',fecha_comprobante:'2026-09-01',cabana:1,titular:'Persona Prueba',
 monto:160000,moneda:'CLP',medio_pago:'transferencia',concepto:'cab1/1noche',tipo_movimiento:'alojamiento',
 estado_pago:'registrado_en_libro',pago_recibido:true,texto_original:'Persona Prueba // 0175175059 Transf. // cab1/1noche // $160.000',
 origen:{hoja:'Sep26',celda:'BO26:BR26'},evidencia_financiera:evidencia(),...extra
});

const marco = pago({fecha_comprobante:null,monto:null,medio_pago:null,concepto:null,tipo_movimiento:'penalidad',pago_recibido:null,
 texto_original:'APLICADO 10% PENALIDAD POR MODIFICACIÓN // POR PAGAR $516.000 ($420.000 SALDO RESTANTE + 96.000 DE PENALIDAD)',
 origen:{hoja:'Sep26',celda:'BO28:BR28'},evidencia_financiera:evidencia({detalle:'FFFFFF00',concepto:'',monto:''})});
const pascual = pago({fecha_comprobante:null,monto:320000,medio_pago:null,concepto:'REEMBOLSO',tipo_movimiento:'otro',pago_recibido:true,
 texto_original:'Pascual Abarca // reembolso por gestionar // BOVE 16979 NC 530 // REEMBOLSO // $320.000',
 origen:{hoja:'Sep26',celda:'BO43:BR43'},evidencia_financiera:evidencia({detalle:'FFFFFFFF',concepto:'FFFFFF00',monto:'FFFFFFFF'})});
const reales = [
 pago(),
 pago({medio_pago:'webpay_credito',codigo_autorizacion:'561984',texto_original:'Persona Prueba // WebPay crédito // Cod.Aut: 561984'}),
 pago({medio_pago:'efectivo',texto_original:'Persona Prueba // Efectivo // BOVE 16988'}),
 pago({medio_pago:null,codigo_autorizacion:'ABC98765',texto_original:'Persona Prueba // Cod.Aut ABC98765',evidencia_financiera:evidencia({detalle:'FFCC99FF',concepto:'FFCC99FF',monto:'FFCC99FF'})})
];
const porPagar = pago({fecha_comprobante:null,monto:null,medio_pago:null,pago_recibido:null,estado_pago:'pendiente',texto_original:'POR PAGAR SALDO RESTANTE',origen:{hoja:'Sep26',celda:'S50:V50'}});
const ambiguo = pago({medio_pago:null,codigo_autorizacion:null,folio:null,bovtar:null,texto_original:'Persona Prueba // abono por revisar',origen:{hoja:'Sep26',celda:'W50:Z50'}});

const reserva = {id:'libro-1',titular:'Persona Prueba',cabana:1,fecha_checkin:'2026-09-17',fecha_checkout:'2026-09-18',
 pagos:[marco,pascual,...reales,porPagar,ambiguo],pagos_sin_asociacion:[],notas_importantes:[],coordenadas_origen:{hoja:'Sep26',celda:'BO3'}};
const resultado = {reservas:[reserva],pagos:reserva.pagos,espacios:[],anotaciones:[]};
global.HAIKU_LIBRO_RESERVA_V1 = Object.freeze({consultarHoja:async()=>structuredClone(resultado)});
require('../js/haiku-libro-lenguaje-natural-v1.js');

test('Marco penalidad and Pascual refund become associated financial notes, never payments',async()=>{
 const out=await global.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Sep26');
 const notas=out.anotaciones.filter(x=>x.tipo==='nota_financiera');
 assert.deepEqual(notas.map(x=>x.origen.celda),['BO28:BR28','BO43:BR43','S50:V50']);
 assert.ok(notas.every(x=>x.titular==='Persona Prueba'&&x.reserva_id==='libro-1'&&x.texto_original&&x.origen?.hoja==='Sep26'));
 assert.ok(!out.pagos.some(x=>[marco.origen.celda,pascual.origen.celda,porPagar.origen.celda].includes(x.origen.celda)));
 assert.ok(!out.reservas[0].pagos.some(x=>x.clasificacion_financiera==='nota_financiera'));
});

test('real transfer, WebPay, cash and atypical color with strong ID remain real payments',async()=>{
 const out=await global.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Sep26');
 const pagos=out.reservas[0].pagos.filter(x=>x.clasificacion_financiera==='pago_real');
 assert.equal(pagos.length,4);
 assert.deepEqual(pagos.map(x=>x.medio_pago),['transferencia','webpay_credito','efectivo',null]);
});

test('partial financial signals remain doubtful for manual review',async()=>{
 const out=await global.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Sep26');
 const item=out.reservas[0].pagos.find(x=>x.origen.celda===ambiguo.origen.celda);
 assert.equal(item.clasificacion_financiera,'dudoso');
});
