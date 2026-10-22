const test=require('node:test'),assert=require('node:assert/strict');
const F=require('./fixtures/libro-transferencias-bancarias.cjs');
global.HAIKU_LIBRO_SEMANTICA=F.S;
const Q=require('../js/haiku-libro-consultas-v1.js');
const q={desde:'2026-10-01',hasta:'2026-10-31'};
async function comparar(casos=[{}],guardados=[]) {
 const libro=F.leer(casos),db=F.cliente(libro.reservas,guardados);
 const c=await Q.compararSistema(libro.reservas,db,q);
 return {libro,db,c,result:{reservas:libro.reservas,q,comparacion:c}};
}
const movimiento=h=>h.c.pagosDetalle[0];
const sinEscrituras=h=>assert.ok(!h.db.llamadas.some(x=>/incorporar|registrar|aprobar/.test(x)));
const guardado=(extra={})=>({id:'pago-sintetico',reserva_id:'reserva-sintetica-0',estado:'confirmado',tipo_movimiento:'pago',
 monto:75000,moneda:'CLP',medio_pago:'transferencia',fecha_pago:'2026-10-21',referencia_externa:F.glosa,...extra});

for(const [glosa,concepto] of [
 [F.glosa,'cab10/1noche'],['0177406988 Transf. ALMONACID ERICES EXEQUIEL IGNACIO','cab10/1noche'],
 ['0177406988 ALMONACID ERICES EXEQUIEL IGNACIO','cab10/1noche // Transferencia']
]) test('glosa bancaria preservada, sin identidad transaccional de tarjeta: '+glosa,async()=>{
 const h=await comparar([{pagos:[{glosa,concepto}]}]),r=h.libro.reservas[0],p=h.libro.pagos[0],x=movimiento(h);
 assert.equal(r.cabana,10);assert.equal(r.fecha_checkin,'2026-10-30');assert.equal(r.titular,'Exequiel Almoncid');
 assert.equal(r.rut_documento,'17740698-8');assert.equal(p.fecha_comprobante,'2026-10-21');assert.equal(p.monto,75000);
 assert.equal(p.medio_pago,'transferencia');assert.equal(p.evidencia_transferencia.glosa_original,glosa);
 assert.deepEqual(p.pagador,{nombre:'ALMONACID ERICES EXEQUIEL IGNACIO',numero_remitente:'0177406988',fuente:'glosa_bancaria'});
 assert.ok(p.texto_original.includes(glosa));assert.equal(p.codigo_autorizacion,null);assert.equal(p.folio,null);assert.equal(p.bovtar,null);
 assert.equal(r.pagos.length,1);assert.equal(x.estado,'nuevo_seguro');assert.equal(x.resolucionPago.evidencia,'transferencia_bancaria_contextual');
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db),item=plan.items.find(i=>i.pagoLibro);
 // El contrato de escritura mantiene su aprobación manual; no se inventa CodAut.
 assert.equal(item.aprobable,true);assert.equal(item.seleccionado,false);assert.equal(item.payload.aprobado_manualmente,false);
 assert.equal(item.payload.argumentos.p_fecha_pago,'2026-10-21');assert.deepEqual(item.payload.datos_origen.pagador,p.pagador);
 assert.equal(item.payload.datos_origen.evidencia_transferencia.glosa_original,glosa);
 assert.ok(!plan.items.some(i=>i.payload?.tipo==='reserva_actualizar'));
 sinEscrituras(h);
});

for(const [rut,titular] of [['17740698-8','Exequiel Almoncid'],['11111111-1','Pareja Sintetica'],['12345678-5','Titular Tercero']])
 test('identidades separadas: titular '+titular,async()=>{
  const h=await comparar([{rut,titular}]);
  assert.equal(movimiento(h).estado,'nuevo_seguro');assert.equal(h.libro.reservas[0].rut_documento,rut);
  assert.equal(h.libro.pagos[0].pagador.numero_remitente,'0177406988');
  assert.equal(h.libro.reservas[0].titular,titular);sinEscrituras(h);
 });

test('mismo remitente en dos pagos de igual monto con distinta recepción no se agrupa ni se descarta',async()=>{
 const h=await comparar([{pagos:[{}, {fecha:'2026-10-22'}]}]);
 assert.equal(h.libro.pagos.length,2);assert.equal(h.c.pagosDetalle.length,2);
 assert.ok(h.c.pagosDetalle.every(x=>x.estado==='nuevo_seguro'));sinEscrituras(h);
});
test('aprobación sólo simulada prepara una transferencia sin IDs de tarjeta y conserva las dos identidades',async()=>{
 const h=await comparar([{rut:'11111111-1',titular:'Titular Sintetico'}]);
 const inicial=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db),item=inicial.items.find(i=>i.pagoLibro);
 assert.deepEqual(Q.serializarIncorporacion(inicial),[]);
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set([item.id]),h.db);
 const payload=Q.serializarIncorporacion(plan).find(i=>i.tipo==='pago');
 assert.ok(payload);assert.equal(payload.aprobado_manualmente,true);assert.equal(payload.argumentos.p_codigo_autorizacion,null);
 assert.equal(payload.argumentos.p_folio,null);assert.equal(payload.argumentos.p_bove,null);
 assert.equal(payload.argumentos.p_fecha_pago,'2026-10-21');assert.equal(payload.argumentos.p_monto,75000);
 assert.ok(payload.argumentos.p_referencia_externa.includes(F.glosa));
 assert.equal(payload.datos_origen.pagador.numero_remitente,'0177406988');
 assert.equal(h.libro.reservas[0].rut_documento,'11111111-1');sinEscrituras(h);
});
test('un tercero paga reservas distintas: decide el bloque, no el RUT del pagador',async()=>{
 const h=await comparar([{rut:'11111111-1',titular:'Persona Uno'},
  {cabana:11,rut:'12345678-5',titular:'Persona Dos',pagos:[{fecha:'2026-10-22',monto:60000}]}]);
 assert.equal(h.c.pagosDetalle.length,2);assert.ok(h.c.pagosDetalle.every(x=>x.estado==='nuevo_seguro'));
 assert.deepEqual(h.libro.reservas.map(r=>r.rut_documento),['11111111-1','12345678-5']);
 assert.ok(h.libro.pagos.every(p=>p.pagador.numero_remitente==='0177406988'));
 sinEscrituras(h);
});
test('mismo tercero, misma recepción y reservas diferentes con importes distintos no se confunden',async()=>{
 const h=await comparar([{rut:'11111111-1',titular:'Persona Uno'},
  {cabana:11,rut:'12345678-5',titular:'Persona Dos',pagos:[{monto:60000}]}]);
 assert.equal(h.c.pagosDetalle.length,2);assert.ok(h.c.pagosDetalle.every(x=>x.estado==='nuevo_seguro'));sinEscrituras(h);
});
for(const casos of [[{pagos:[{},{}]}],[{}, {cabana:11,titular:'Otra Reserva',rut:'11111111-1'}]])
 test('posible duplicado con igual remitente, recepción y monto queda en revisión',async()=>{
  const h=await comparar(casos);
  assert.ok(h.c.pagosDetalle.every(x=>x.estado==='revisar'));
  assert.ok(h.c.pagosDetalle.every(x=>x.motivos.some(m=>/duplicado/.test(m))));
  const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
  const items=plan.items.filter(i=>i.pagoLibro);
  assert.ok(items.length);assert.ok(items.every(i=>!i.seleccionado&&!i.aprobable));
  assert.ok(items.every(i=>i.motivos.some(m=>/duplicado/.test(m))));sinEscrituras(h);
 });
test('una selección forzada no elimina la revisión de los posibles duplicados',async()=>{
 const h=await comparar([{pagos:[{},{}]}]);
 const base=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
 const ids=base.items.filter(i=>i.pagoLibro).map(i=>i.id);
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(ids),h.db);
 plan.items.filter(i=>i.pagoLibro).forEach(i=>{i.seleccionado=true;});
 assert.deepEqual(Q.serializarIncorporacion(plan),[]);sinEscrituras(h);
});
test('un medio confirmado para una glosa sin Transf no añade una exigencia de CodAut',async()=>{
 const {entorno}=require('./fixtures/libro-medio-pago-manual.cjs');
 const h=entorno({alojamiento:true,fuerte:false,conComparacion:true,signal:'0177406988 ALMONACID ERICES EXEQUIEL IGNACIO'});
 const p=h.r.pagos[0];p.texto_original='0177406988 ALMONACID ERICES EXEQUIEL IGNACIO';
 const plan=await h.definir(await h.preparar(),'transferencia'),item=h.item(plan);
 assert.equal(item.pagoLibro.medio_pago,'transferencia');
 assert.equal(item.aprobable,true);
 assert.ok(!item.motivos.some(m=>/identificador fuerte/.test(m)));
 assert.ok(!h.llamadas.some(x=>x.nombre==='haiku_incorporar_libro_v1'));
});

test('pago ya existente exige también glosa, recepción, monto y destino: no se vuelve a preparar',async()=>{
 const h=await comparar([{}],[guardado({referencia_externa:'0177406988 Transf. ALMONACID ERICES EXEQUIEL IGNACIO'})]);
 assert.equal(movimiento(h).estado,'en_sistema');assert.equal(movimiento(h).sistema.id,'pago-sintetico');
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
 assert.equal(plan.items.find(i=>i.pagoLibro).categoria,'omitidos');sinEscrituras(h);
});
test('el mismo remitente pudo transferir antes: otra fecha no equivale a la misma transacción',async()=>{
 const h=await comparar([{}],[guardado({fecha_pago:'2026-10-20'})]);
 assert.equal(movimiento(h).estado,'nuevo_seguro');
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db),item=plan.items.find(i=>i.pagoLibro);
 assert.equal(item.aprobable,true);assert.ok(!item.motivos.some(m=>/Hay otro pago/.test(m)));sinEscrituras(h);
});
for(const pagos of [
 [guardado({referencia_externa:'0177406988'})],[guardado({reserva_id:'otra-reserva'})],
 [guardado(),guardado({id:'segundo'})],[guardado({fecha_pago:null})],[guardado({estado:'anulado'})]
]) test('un pago posiblemente duplicado o contradictorio no se asocia sólo por remitente',async()=>{
 const h=await comparar([{}],pagos);assert.equal(movimiento(h).estado,'revisar');
 assert.match(movimiento(h).motivos.join(' '),/duplicada|contradictoria/);sinEscrituras(h);
});
test('un RUT coincidente sin el resto de evidencias no asocia ni descarta el pago',async()=>{
 const h=await comparar([{}],[guardado({referencia_externa:'0177406988',monto:25000,fecha_pago:'2026-10-12',reserva_id:'otra-reserva'})]);
 assert.equal(movimiento(h).estado,'nuevo_seguro');sinEscrituras(h);
});

for(const [pago,motivo] of [[{fecha:null},/fecha.*recepción/],[{monto:null},/monto/],
 [{concepto:'cab11/1noche'},/CAB/],[{glosa:F.glosa+' // por pagar'},/recibida/],
 [{concepto:'cab10/1noche // Webpay credito'},/medio/]])
 test('transferencia incompleta o contradictoria muestra su causa: '+JSON.stringify(pago),async()=>{
  const h=await comparar([{pagos:[pago]}]);assert.equal(movimiento(h).estado,'revisar');
  assert.match(movimiento(h).motivos.join(' '),motivo);sinEscrituras(h);
 });
for(const glosa of ['0177406988','RUT 17740698-8','0177406988 ALMONACID ERICES EXEQUIEL IGNACIO'])
 test('sin medio inequívoco no convierte un número o RUT aislado en transferencia segura: '+glosa,async()=>{
  const h=await comparar([{pagos:[{glosa}]}]);assert.equal(h.libro.pagos[0].medio_pago,null);
  assert.notEqual(movimiento(h).estado,'nuevo_seguro');sinEscrituras(h);
 });
test('si el destino es ambiguo, ni el nombre ni el RUT del remitente eligen la reserva',async()=>{
 const h=await comparar([{}, {cabana:10,titular:'Otro Titular',rut:'11111111-1',pagos:[]}]);
 assert.ok(h.c.pagosDetalle.every(x=>x.estado==='revisar'));
 assert.ok(h.c.pagosDetalle.every(x=>x.motivos.some(m=>/destino/.test(m))));sinEscrituras(h);
});
for(const glosa of ['0177406988','0177406988 Transf.','Remitente Incompleto // 0177406988 Transf.'])
 test('una glosa incompleta no demuestra una transacción anterior de otra fecha: '+glosa,async()=>{
  const h=await comparar([{pagos:[{glosa,concepto:'cab10/1noche // Transferencia'}]}],
   [guardado({fecha_pago:'2026-10-20',referencia_externa:glosa})]);
  assert.equal(movimiento(h).estado,'revisar');assert.match(movimiento(h).motivos.join(' '),/glosa bancaria completa/);sinEscrituras(h);
 });
