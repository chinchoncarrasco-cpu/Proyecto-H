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
 // La capacidad v2 permite seleccionar; no inventa CodAut ni aprobación manual.
 assert.equal(item.aprobable,false);assert.equal(item.seleccionado,true);assert.equal(item.payload.aprobado_manualmente,false);
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
 assert.equal(Q.serializarIncorporacion(inicial).length,1);
 assert.equal(Q.serializarIncorporacion(inicial)[0].aprobado_manualmente,false);
 assert.equal(Q.serializarIncorporacion(inicial)[0].confirmacion_final,undefined);
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
 const rpc=h.db.rpc;h.db.rpc=(n,a)=>n==='haiku_libro_transferencias_capacidad_v2'?Promise.resolve({data:{version:2,confirmacion_final:true}}):rpc(n,a);
 const p=h.r.pagos[0];p.texto_original='0177406988 ALMONACID ERICES EXEQUIEL IGNACIO';
 const plan=await h.definir(await h.preparar(),'transferencia'),item=h.item(plan);
 assert.equal(item.pagoLibro.medio_pago,'transferencia');
 assert.equal(item.seleccionado,true);
 assert.ok(!item.motivos.some(m=>/identificador fuerte/.test(m)));
 assert.ok(!h.llamadas.some(x=>x.nombre==='haiku_incorporar_libro_v1'));
});

test('pago ya existente exige también glosa, recepción, monto y destino: no se vuelve a preparar',async()=>{
 const h=await comparar([{pagos:[{glosa:F.glosa+' // Operacion 901'}]}],[guardado({referencia_externa:'0177406988 Transf. ALMONACID ERICES EXEQUIEL IGNACIO // Operacion 901'})]);
 assert.equal(movimiento(h).estado,'en_sistema');assert.equal(movimiento(h).sistema.id,'pago-sintetico');
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
 assert.equal(plan.items.find(i=>i.pagoLibro).categoria,'omitidos');sinEscrituras(h);
});
test('el mismo remitente pudo transferir antes: otra fecha no equivale a la misma transacción',async()=>{
 const h=await comparar([{}],[guardado({fecha_pago:'2026-10-20'})]);
 assert.equal(movimiento(h).estado,'nuevo_seguro');
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db),item=plan.items.find(i=>i.pagoLibro);
 assert.equal(item.seleccionado,true);assert.ok(!item.motivos.some(m=>/Hay otro pago/.test(m)));sinEscrituras(h);
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

test('dos transferencias iguales el mismo día con operaciones diferentes se seleccionan independientemente',async()=>{
 const h=await comparar([{pagos:[{glosa:F.glosa+' // Operacion 901'},{glosa:F.glosa+' // Operación 902'}]}]);
 assert.ok(h.c.pagosDetalle.every(x=>x.estado==='nuevo_seguro'));
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
 const items=plan.items.filter(i=>i.pagoLibro);
 assert.equal(items.length,2);assert.ok(items.every(i=>i.seleccionado&&!i.aprobable));
 assert.ok(Q.serializarIncorporacion(plan).every(i=>!i.aprobado_manualmente&&!i.confirmacion_final));sinEscrituras(h);
});
test('una hora diferente no distingue dos transferencias sin operación bancaria',async()=>{
 const h=await comparar([{pagos:[{glosa:F.glosa+' // Hora 10:15'},{glosa:F.glosa+' // Hora 11:30'}]}]);
 assert.ok(h.c.pagosDetalle.every(x=>x.estado==='revisar'));sinEscrituras(h);
});
test('una fila idéntica a pago existente sin operación sigue en revisión, no se fusiona',async()=>{
 const h=await comparar([{}],[guardado()]);assert.equal(movimiento(h).estado,'revisar');sinEscrituras(h);
});
test('otra operación del mismo remitente, día y monto no se descarta frente a pago existente',async()=>{
 const h=await comparar([{pagos:[{glosa:F.glosa+' // Operacion 902'}]}],
  [guardado({referencia_externa:F.glosa+' // Operacion 901'})]);
 assert.equal(movimiento(h).estado,'nuevo_seguro');sinEscrituras(h);
});
test('relectura incorporada conserva identidad por operación y datos financieros aunque cambie de fila',async()=>{
 const h=await comparar([{pagos:[{glosa:F.glosa+' // Operacion 901'}]}]);
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
 const item=plan.items.find(i=>i.pagoLibro),persistido=guardado({
  referencia_externa:item.payload.argumentos.p_referencia_externa,datos_origen:item.payload.datos_origen});
 const movido=await comparar([{desplazamiento:2,pagos:[{glosa:F.glosa+' // Operacion 901'}]}],[persistido]);
 assert.notDeepEqual(movido.libro.pagos[0].origen,h.libro.pagos[0].origen);
 assert.equal(movimiento(movido).estado,'en_sistema');sinEscrituras(movido);
});
for(const extra of [{monto:70000},{reserva_id:'otra-reserva'},{estado:'anulado'}])
 test('misma operación con datos contradictorios requiere revisión '+JSON.stringify(extra),async()=>{
  const h=await comparar([{pagos:[{glosa:F.glosa+' // Operacion 901'}]}],
   [guardado({referencia_externa:F.glosa+' // Operacion 901',...extra})]);
  assert.equal(movimiento(h).estado,'revisar');sinEscrituras(h);
 });
test('reutilizar coordenadas de otra transferencia no establece identidad',async()=>{
 const original=await comparar([{}]);
 const h=await comparar([{pagos:[{monto:70000,fecha:'2026-10-22'}]}],
  [guardado({datos_origen:{origen_libro:original.libro.pagos[0].origen}})]);
 assert.equal(movimiento(h).estado,'nuevo_seguro');sinEscrituras(h);
});
test('sin capacidad SQL no se anuncia un pago nuevo seguro ni se permite forzar su selección',async()=>{
 const libro=F.leer(),db=F.cliente(libro.reservas),rpc=db.rpc;
 db.rpc=n=>n==='haiku_libro_transferencias_capacidad_v2'?Promise.resolve({error:{message:'no existe'}}):rpc(n);
 const c=await Q.compararSistema(libro.reservas,db,q);
 assert.equal(c.pagosDetalle[0].estado,'revisar');assert.match(c.pagosDetalle[0].motivos.join(' '),/contrato SQL/);
 const plan=await Q.prepararIncorporacion({reservas:libro.reservas,q,comparacion:c},new Map(),new Set(),db);
 plan.items.forEach(i=>{i.seleccionado=true;});assert.deepEqual(Q.serializarIncorporacion(plan),[]);
});
test('sólo la confirmación final envía el indicador al writer, sin aprobación manual ficticia',async()=>{
 const h=await comparar([{pagos:[{glosa:F.glosa+' // Operacion 901'}]}]);
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
 sinEscrituras(h);assert.equal(Q.serializarIncorporacion(plan)[0].confirmacion_final,undefined);
 const enviados=[],rpc=h.db.rpc;
 h.db.rpc=(n,a)=>{
  if(n==='haiku_incorporar_libro_v1') {enviados.push(a.p_items);return Promise.resolve({data:{ok:true,pagos_creados:1,omitidos:0}});}
  return rpc(n,a);
 };
 await Q.confirmarIncorporacion(h.result,new Map(),new Set(),plan,h.db);
 assert.equal(enviados.length,1);assert.equal(enviados[0][0].confirmacion_final,true);
 assert.equal(enviados[0][0].aprobado_manualmente,false);
});
test('relectura sin operación queda en revisión aunque tenga evidencia persistida y cambie de fila',async()=>{
 const h=await comparar(),plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
 const item=plan.items.find(i=>i.pagoLibro);
 const otra=await comparar([{desplazamiento:2}],[guardado({datos_origen:item.payload.datos_origen})]);
 assert.equal(movimiento(otra).estado,'revisar');sinEscrituras(otra);
});
for(const glosa of [F.glosa+' // Operacion 901 // Operacion 902',F.glosa+' // Operacion pendiente'])
 test('operaciones incompletas o contradictorias no acreditan identidad: '+glosa,async()=>{
  const h=await comparar([{pagos:[{glosa}]}]);assert.equal(movimiento(h).estado,'revisar');
  assert.match(movimiento(h).motivos.join(' '),/operación bancaria/);sinEscrituras(h);
 });

function reciboHistorico(libro, cambios={}) {
 const p=libro.pagos[0];
 return guardado({referencia_externa:p.texto_original,observaciones:p.texto_original,
  datos_origen:{contexto:'haku_libro_incorporacion',aprobado_manualmente:true,
   operacion_id:'operacion-historica-sintetica',fecha_bloque:p.fecha_bloque,
   origen_libro:p.origen,item_id:'pago:reserva-historica:'+p.origen.hoja+'!'+p.origen.celda+':'+JSON.stringify(p)},...cambios});
}
test('recibo histórico aprobado se reconoce sin operación bancaria y sin preparar otra inserción',async()=>{
 const libro=F.leer(),g=reciboHistorico(libro);
 const h=await comparar([{}],[g]);
 assert.equal(movimiento(h).estado,'en_sistema');assert.equal(movimiento(h).sistema.id,g.id);
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
 assert.equal(plan.items.find(i=>i.pagoLibro).categoria,'omitidos');
 assert.deepEqual(Q.serializarIncorporacion(plan),[]);sinEscrituras(h);
});
test('recibo histórico conserva identidad al mover la fila, sin usar coordenadas como identidad',async()=>{
 const g=reciboHistorico(F.leer());const h=await comparar([{desplazamiento:2}],[g]);
 assert.equal(movimiento(h).estado,'en_sistema');sinEscrituras(h);
});
test('dos filas indistinguibles no consumen un recibo histórico dos veces',async()=>{
 const h=await comparar([{pagos:[{},{}]}],[reciboHistorico(F.leer())]);
 assert.ok(h.c.pagosDetalle.every(x=>x.estado==='revisar'));sinEscrituras(h);
});
test('dos recibos históricos compatibles requieren revisión en vez de elegir uno',async()=>{
 const g=reciboHistorico(F.leer());const h=await comparar([{}],[g,{...g,id:'segundo-historico'}]);
 assert.equal(movimiento(h).estado,'revisar');sinEscrituras(h);
});
for(const cambio of [
 {datos_origen:{}},{datos_origen:{contexto:'haku_libro_incorporacion',aprobado_manualmente:true,operacion_id:'op',item_id:'pago:sin-json'}},
 {estado:'anulado'},{reserva_id:'otra-reserva'},
]) test('sin recibo íntegro y destino/estado exactos no rescata un histórico '+JSON.stringify(cambio),async()=>{
 const h=await comparar([{}],[reciboHistorico(F.leer(),cambio)]);
 assert.equal(movimiento(h).estado,'revisar');sinEscrituras(h);
});
test('reutilizar la celda histórica con otra glosa no reconoce el pago anterior',async()=>{
 const glosa='Transf. 0123456785 OTRO REMITENTE';
 const h=await comparar([{pagos:[{glosa}]}],[reciboHistorico(F.leer())]);
 assert.equal(movimiento(h).estado,'revisar');sinEscrituras(h);
});

test('un histórico íntegro no vuelve a revisión por requisitos nuevos de glosa o encabezado',async()=>{
 const casos=[{pagos:[{glosa:'0177406988 Transf.',concepto:'cab10/1noche'}]}];
 const libro=F.leer(casos),g=reciboHistorico(libro);
 const h=await comparar(casos,[g]);
 assert.equal(movimiento(h).estado,'en_sistema');sinEscrituras(h);
});
test('el mismo recibo admite ambos órdenes de la misma glosa bancaria',async()=>{
 const g=reciboHistorico(F.leer());
 const h=await comparar([{pagos:[{glosa:'0177406988 Transf. ALMONACID ERICES EXEQUIEL IGNACIO'}]}],[g]);
 assert.equal(movimiento(h).estado,'en_sistema');sinEscrituras(h);
});
test('un pago adicional sin recibo impide consumir el histórico como coincidencia única',async()=>{
 const g=reciboHistorico(F.leer());
 const h=await comparar([{}],[g,guardado({id:'pago-adicional',referencia_externa:g.referencia_externa})]);
 assert.equal(movimiento(h).estado,'revisar');sinEscrituras(h);
});

for(const [antes,despues] of [
 [' // PEND BOVE Y MANAGER',' // BOVE: 17152'],[' // BOVE:',' // BOVE 17.152'],
 [' // PENDIENTE 50% BOVE Y MANAGER',''],[' // CO',' // JD // BOVE: 17152']
]) test('completar trámites administrativos conserva el pago confirmado: '+antes,async()=>{
 const base=[{pagos:[{glosa:F.glosa+antes}]}],libro=F.leer(base);
 const h=await comparar([{pagos:[{glosa:F.glosa+despues}]}],[reciboHistorico(libro)]);
 assert.equal(movimiento(h).estado,'en_sistema');
 const plan=await Q.prepararIncorporacion(h.result,new Map(),new Set(),h.db);
 assert.deepEqual(Q.serializarIncorporacion(plan),[]);sinEscrituras(h);
});
test('cambiar anotación de noches no crea otra transferencia con el mismo recibo',async()=>{
 const h=await comparar([{pagos:[{concepto:'cab10/2noches'}]}],[reciboHistorico(F.leer())]);
 assert.equal(movimiento(h).estado,'en_sistema');sinEscrituras(h);
});
test('añadir monto total informativo no invalida el recibo de una parte ya registrada',async()=>{
 const h=await comparar([{pagos:[{glosa:F.glosa+' // MONTO CLP$150.000 // BOVE: 17152'}]}],[reciboHistorico(F.leer())]);
 assert.equal(movimiento(h).estado,'en_sistema');sinEscrituras(h);
});
test('relectura del writer v2 reconoce el recibo aunque cambie BOVE y se mueva la fila',async()=>{
 const g=reciboHistorico(F.leer());g.datos_origen.aprobado_manualmente=false;
 g.datos_origen.evidencia_transferencia={version:2,glosa_original:F.glosa};
 const h=await comparar([{desplazamiento:2,pagos:[{glosa:F.glosa+' // BOVE:17152'}]}],[g]);
 assert.equal(movimiento(h).estado,'en_sistema');sinEscrituras(h);
});
for(const pago of [{fecha:'2026-10-22'},{monto:76000},{glosa:'Transf. 0111111111 OTRO REMITENTE'},
 {glosa:F.glosa+' // Operacion 902'},{concepto:'cab11/1noche'},{glosa:F.glosa+' // por pagar'}])
 test('una contradicción financiera no queda oculta por un recibo anterior '+JSON.stringify(pago),async()=>{
  const g=reciboHistorico(F.leer([{pagos:[{glosa:F.glosa+' // Operacion 901'}]}]));
  const h=await comparar([{pagos:[pago]}],[g]);
  assert.notEqual(movimiento(h).estado,'en_sistema');sinEscrituras(h);
 });
test('dos filas idénticas tras completar BOVE no consumen dos veces el mismo recibo',async()=>{
 const h=await comparar([{pagos:[{glosa:F.glosa+' // BOVE:17152'},{glosa:F.glosa+' // BOVE:17152'}]}],[reciboHistorico(F.leer())]);
 assert.ok(h.c.pagosDetalle.every(x=>x.estado==='revisar'));sinEscrituras(h);
});
test('misma glosa de check-in con otra fecha requiere revisar esa diferencia concreta',async()=>{
 const h=await comparar([{}],[guardado({fecha_pago:'2026-10-20',datos_origen:{contexto:'checkin',manager_revisado:true}})]);
 assert.equal(movimiento(h).estado,'revisar');assert.match(movimiento(h).motivos.join(' '),/fecha.*2026-10-20.*2026-10-21/);sinEscrituras(h);
});
test('dos partes históricas de igual monto en la misma reserva conservan su CAB y recibo propio',async()=>{
 const casos=[{}, {cabana:11}],libro=F.leer(casos);
 const a=reciboHistorico({pagos:[libro.pagos[0]]}),b=reciboHistorico({pagos:[libro.pagos[1]]},{id:'segundo-componente'});
 const db=F.cliente(libro.reservas,[a,b]);
 db.estadias.forEach(e=>{e.reserva_id='reserva-sintetica-0';e.reservas.grupo_reserva_id='grupo-sintetico';});
 const c=await Q.compararSistema(libro.reservas,db,q);
 assert.equal(c.pagosDetalle.length,2);assert.ok(c.pagosDetalle.every(x=>x.estado==='en_sistema'));
 assert.equal(new Set(c.pagosDetalle.map(x=>x.sistema.id)).size,2);
 const plan=await Q.prepararIncorporacion({reservas:libro.reservas,q,comparacion:c},new Map(),new Set(),db);
 assert.ok(!Q.serializarIncorporacion(plan).some(i=>i.tipo==='pago'));sinEscrituras({db});
});
