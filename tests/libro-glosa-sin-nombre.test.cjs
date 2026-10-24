const test=require('node:test'),assert=require('node:assert/strict');
const F=require('./fixtures/libro-transferencias-bancarias.cjs');
global.HAIKU_LIBRO_SEMANTICA=F.S;
const Q=require('../js/haiku-libro-consultas-v1.js');
const q={desde:'2026-10-01',hasta:'2026-10-31'},numero='0123456701';
async function caso(pagos=[{glosa:numero+' Transf.'}],{guardados=[],capacidad=true,titular='Titular Sintetico'}={}) {
 const libro=F.leer([{titular,rut:'11111111-1',pagos}]),db=F.cliente(libro.reservas,guardados),rpc=db.rpc;
 db.rpc=n=>n==='haiku_libro_transferencias_capacidad_v2'?
  Promise.resolve({data:{version:2,confirmacion_final:true,...(capacidad?{glosa_sin_nombre:true}:{})}}):rpc(n);
 const comparacion=await Q.compararSistema(libro.reservas,db,q);
 const result={reservas:libro.reservas,q,comparacion};
 const plan=await Q.prepararIncorporacion(result,new Map(),new Set(),db);
 return {libro,db,comparacion,result,plan,p:libro.pagos[0],item:plan.items.find(i=>i.pagoLibro)};
}
const sinEscrituras=h=>assert.ok(!h.db.llamadas.some(n=>/incorporar|registrar|aprobar/.test(n)));
for(const glosa of ['Transf. '+numero,numero+' Transf.',numero+' Transferencia','Transferencia '+numero,
 'Titular Sintetico // '+numero+' Transf. // BOVE: 54321',numero])
 test('reconoce la glosa sin inventar nombre ni operación: '+glosa,async()=>{
  const h=await caso([{glosa,concepto:'cab10/1noche // Transferencia'}]);
  assert.equal(F.S.evidenciaTransferencia(h.p).valida,true);
  assert.equal(h.p.pagador.numero_remitente,numero);assert.equal(h.p.pagador.nombre,null);
  assert.equal(h.p.evidencia_transferencia.operacion_bancaria,null);
  assert.equal(h.libro.reservas[0].titular,'Titular Sintetico');assert.equal(h.libro.reservas[0].rut_documento,'11111111-1');
  assert.equal(h.comparacion.pagosDetalle[0].estado,'nuevo_seguro');
  assert.equal(h.item.seleccionado,true);assert.equal(h.item.payload.aprobado_manualmente,false);
  assert.equal(h.item.payload.datos_origen.pagador.nombre,null);
  assert.equal(h.item.payload.argumentos.p_codigo_autorizacion,null);
  assert.equal(h.item.payload.argumentos.p_folio,null);assert.equal(h.item.payload.argumentos.p_bove,null);
  assert.equal(Q.serializarIncorporacion(h.plan)[0].confirmacion_final,undefined);sinEscrituras(h);
 });

test('sin capacidad del writer reconoce la glosa pero no promete una incorporación imposible',async()=>{
 const h=await caso(undefined,{capacidad:false});
 assert.equal(F.S.evidenciaTransferencia(h.p).valida,true);assert.equal(h.item.seleccionado,false);
 assert.match(h.item.motivos.join(' '),/glosa bancaria está reconocida/);
 assert.equal(Q.serializarIncorporacion(h.plan).length,0);sinEscrituras(h);
});
for(const glosa of [numero,'Teléfono '+numero,'RUT 12345670-1','Folio '+numero])
 test('un número sin medio confirmado o una etiqueta ajena no se convierte en transferencia: '+glosa,async()=>{
  const h=await caso([{glosa}]);
  assert.notEqual(h.comparacion.pagosDetalle[0].estado,'nuevo_seguro');assert.equal(h.item.seleccionado,false);sinEscrituras(h);
 });
test('un nombre bancario explícito de un tercero se conserva separado del titular',async()=>{
 const h=await caso([{glosa:numero+' Transf. Pagador Distinto'}]);
 assert.equal(h.p.pagador.nombre,'Pagador Distinto');assert.equal(h.libro.reservas[0].titular,'Titular Sintetico');
 assert.equal(h.item.seleccionado,true);sinEscrituras(h);
});
test('dos glosas, un nombre parcial y mezcla de medios conservan revisión',async()=>{
 for(const glosa of [numero+' Transf. // 0765432109 Transf.',numero+' Transf. Parcial',numero+' Transf. // Webpay crédito']){
  const h=await caso([{glosa}]);assert.equal(h.item.seleccionado,false);sinEscrituras(h);
 }
});
test('mismo número, fecha e importe sin operación mantiene los dos movimientos en revisión',async()=>{
 const h=await caso([{glosa:numero+' Transf.'},{glosa:'Transf. '+numero}]);
 assert.equal(h.comparacion.pagosDetalle.length,2);
 assert.ok(h.comparacion.pagosDetalle.every(x=>x.estado==='revisar'&&x.motivos.some(m=>/duplicado/.test(m))));
 assert.equal(Q.serializarIncorporacion(h.plan).length,0);sinEscrituras(h);
});
test('la ausencia de nombre no oculta un posible duplicado cuyo pagador sí tiene nombre',async()=>{
 const h=await caso([{glosa:numero+' Transf.'},{glosa:numero+' Transf. Pagador Distinto'}]);
 assert.ok(h.comparacion.pagosDetalle.every(x=>x.estado==='revisar'));sinEscrituras(h);
});
test('operaciones distintas permiten dos abonos iguales sin usar el número de remitente como ID',async()=>{
 const h=await caso([{glosa:numero+' Transf. // Operacion 901'},{glosa:numero+' Transf. // Operacion 902'}]);
 assert.equal(Q.serializarIncorporacion(h.plan).length,2);
 assert.ok(h.comparacion.pagosDetalle.every(x=>x.estado==='nuevo_seguro'));sinEscrituras(h);
});
test('un abono de otra fecha no se descarta por compartir la glosa',async()=>{
 const h=await caso([{glosa:numero+' Transf.'},{glosa:numero+' Transf.',fecha:'2026-10-22'}]);
 assert.equal(Q.serializarIncorporacion(h.plan).length,2);sinEscrituras(h);
});
for(const glosa of [numero+' Transf.',numero])test('relectura del recibo persistido no vuelve a preparar: '+glosa,async()=>{
 const entrada={glosa,concepto:'cab10/1noche // Transferencia'},inicial=await caso([entrada]),payload=Q.serializarIncorporacion(inicial.plan)[0];
 const guardado={id:'pago-sintetico',reserva_id:'reserva-sintetica-0',estado:'confirmado',tipo_movimiento:'pago',
  monto:75000,moneda:'CLP',medio_pago:'transferencia',fecha_pago:'2026-10-21',referencia_externa:inicial.p.texto_original,
  datos_origen:{...payload.datos_origen,contexto:'haku_libro_incorporacion',operacion_id:'operacion-sintetica',
   item_id:payload.item_id,fecha_bloque:inicial.p.fecha_bloque}};
 const h=await caso([entrada],{guardados:[guardado]});
 assert.equal(h.comparacion.pagosDetalle[0].estado,'en_sistema');assert.equal(h.item.categoria,'omitidos');
 assert.equal(h.item.seleccionado,false);sinEscrituras(h);
});
