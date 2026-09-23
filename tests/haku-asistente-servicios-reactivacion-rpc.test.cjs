const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../js/supabase-asistente-servicios-reactivacion-v1.js');

const diaActual='2026-09-23';
const orden='Haku, reactiva el Tonel de Sebastian Gatta, cab 1, del 25-09 a las 22:15.';
const id1='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
const reserva={id:'r1',titular_nombre:'Sebastián Gatta',estado_reserva:'confirmada',bove_checkout:null,bove_cierre:null,
 actualizado_en:'2026-09-22T12:00:00+00:00'};
const estadia={id:'e1',reserva_id:'r1',cabana_id:'cab1',cabanas:{numero:1},estado_estadia:'confirmada',checkout_realizado_en:null};
const catalogo={id:'cs1',codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera',activo:true,requiere_horario:true};
const servicio=(extra={})=>({id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cs1',recurso_id:'rec1',
 fecha_servicio:'2026-09-25',hora_inicio:'22:15:00',hora_fin:'23:15:00',cantidad:1,personas:2,total:30000,
 tipo_cobro:'normal',motivo_cortesia:null,estado_servicio:'cancelado',cancelado_en:'2026-09-23T05:16:33.216786+00:00',
 cancelado_por:'u0',motivo_cancelacion:'Prueba',actualizado_en:'2026-09-23T05:16:33.216786+00:00',
 catalogo_servicios:catalogo,...extra});
const historico={id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,
 monto:30000,estado:'anulado',actualizado_en:'2026-09-23T05:16:33.216786+00:00'};
const cancelacion={id:'a1',entidad_tipo:'servicios',entidad_id:'s1',reserva_id:'r1',usuario_id:'u0',origen:'haku',
 cambios:[{campo:'estado_servicio',anterior:'programado',nuevo:'cancelado'},
  {campo:'motivo_cancelacion',nuevo:'Prueba'},
  {campo:'cancelado_en',nuevo:'2026-09-23T05:16:33.216786+00:00'},
  {campo:'cancelado_por',nuevo:'u0'}],datos_contexto:{operacion_id:'anterior'}};
const datos=(extra={})=>({reservas:[{...reserva}],reserva_estadias:[{...estadia}],
 catalogo_servicios:[{...catalogo}],recursos_servicio:[{id:'rec1',activo:true}],servicios:[servicio()],
 cargos:[{...historico}],vista_estado_cargos:[{cargo_id:'c1',monto:30000,monto_ajustado:30000,aplicado_neto:0,saldo_cargo:0}],
 pago_aplicaciones:[],cargo_ajustes:[],pagos:[{id:'p1',reserva_id:'r1',monto:50000}],
 eventos_auditoria:[structuredClone(cancelacion)],readError:false,...extra});
function cliente(t){
 const consultas=[],envios=[];
 const cli={consultas,envios,from(tabla){
  const filtros=[];
  const q={select(){return q;},eq(campo,v){filtros.push(x=>x[campo]===v);return q;},
   in(campo,vs){filtros.push(x=>vs.includes(x[campo]));return q;},order(){return q;},
   async range(inicio,fin){consultas.push(tabla);if(t.readError)return {data:null,error:new Error('lectura no disponible')};
    return {data:(t[tabla]||[]).filter(x=>filtros.every(f=>f(x))).slice(inicio,fin+1),error:null};},
   update(){throw Error('update prohibido');},insert(){throw Error('insert prohibido');},
   delete(){throw Error('delete prohibido');},upsert(){throw Error('upsert prohibido');}};
  return q;
 },async rpc(nombre,payload){envios.push({nombre,payload:structuredClone(payload)});throw Error('Definir respuesta RPC en la prueba');}};
 return cli;
}
const opciones=cli=>({cliente:cli,permiso:()=>true,diaActual});
const respuesta=(payload,extra={})=>({ok:true,estado:'reactivated',operacion_id:payload.p_operacion_id,
 servicio_id:'s1',reserva_id:'r1',estadia_id:'e1',tipo_cobro:'normal',total:30000,
 cargo_nuevo_id:'c2',cargos_historicos:1,...extra});
function aplicarReactivacion(t,payload,{cargo=true,auditoria=true}={}){
 Object.assign(t.servicios[0],{estado_servicio:'programado',cancelado_en:null,cancelado_por:null,
  motivo_cancelacion:null,actualizado_en:'2026-09-23T16:00:00+00:00'});
 if(cargo)t.cargos.push({...historico,id:'c2',estado:'activo',actualizado_en:'2026-09-23T16:00:00+00:00'});
 if(auditoria)t.eventos_auditoria.push({id:'a2',entidad_tipo:'servicios',entidad_id:'s1',reserva_id:'r1',
  usuario_id:'u1',origen:'haku',datos_contexto:{operacion_id:payload.p_operacion_id},
  cambios:[{campo:'estado_servicio',anterior:'cancelado',nuevo:'programado'}]});
}
async function propuesta(t,cli){const p=await R.preparar(orden,opciones(cli));assert.equal(p.estado,'propuesta');return p;}

test('respuesta real acredita servicio, cargo nuevo, históricos, pagos y auditoría',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 cli.rpc=async(nombre,payload)=>{
  cli.envios.push({nombre,payload:structuredClone(payload)});
  aplicarReactivacion(t,payload);
  return {data:respuesta(payload),error:null};
 };
 const r=await R.confirmar(p,{operacionId:id1});
 assert.equal(r.estado,'realizado');assert.equal(r.candidato.estado_servicio,'programado');
 assert.equal(r.candidato.cancelado_en,null);assert.equal(r.candidato.cancelado_por,null);
 assert.equal(r.candidato.motivo_cancelacion,null);
 assert.equal(r.cargo_nuevo.id,'c2');assert.equal(r.cargo_nuevo.monto,30000);
 assert.deepEqual(r.cargos_historicos,[historico]);assert.deepEqual(t.pagos,[{id:'p1',reserva_id:'r1',monto:50000}]);
 assert.equal(cli.envios.length,1);assert.equal(cli.envios[0].nombre,'haiku_reactivar_servicio_asistente_v1');
 assert.deepEqual(Object.keys(cli.envios[0].payload),['p_operacion_id','p_servicio_id','p_estado_esperado']);
 assert.deepEqual(cli.envios[0].payload.p_estado_esperado,p.p_estado_esperado);
 assert.match(R.renderizar(r),/✓ Servicio reactivado/);
 assert.match(R.renderizar(r),/Cargo histórico: <strong>Anulado · \$30\.000/);
 assert.match(R.renderizar(r),/Nuevo cargo: <strong>Activo · \$30\.000/);
 assert.match(R.renderizar(r),/Disponible y reservado nuevamente/);
 assert.strictEqual(await R.confirmar(p,{operacionId:id2}),r);
 assert.equal(cli.envios.length,1);
});
test('cortesía reactivada conserva cero cargos y muestra resultado sin cobro',async()=>{
 const t=datos({servicios:[servicio({tipo_cobro:'cortesia',total:0,motivo_cortesia:'Atención comercial'})],cargos:[]});
 const cli=cliente(t),p=await propuesta(t,cli);
 cli.rpc=async(nombre,payload)=>{
  cli.envios.push({nombre,payload:structuredClone(payload)});
  aplicarReactivacion(t,payload,{cargo:false});
  return {data:respuesta(payload,{tipo_cobro:'cortesia',total:0,cargo_nuevo_id:null,cargos_historicos:0}),error:null};
 };
 const r=await R.confirmar(p,{operacionId:id1});
 assert.equal(r.estado,'realizado');assert.equal(r.cargo_nuevo,null);
 assert.deepEqual(t.cargos,[]);assert.match(R.renderizar(r),/No se creó ningún cargo/);
 assert.equal(cli.envios.length,1);
});
test('doble clic comparte promesa y emite un único RPC',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 let resolver;
 cli.rpc=(nombre,payload)=>{
  cli.envios.push({nombre,payload:structuredClone(payload)});
  return new Promise(fin=>{resolver=()=>{aplicarReactivacion(t,payload);fin({data:respuesta(payload),error:null});};});
 };
 const primero=R.confirmar(p,{operacionId:id1}),segundo=R.confirmar(p,{operacionId:id2});
 assert.strictEqual(primero,segundo);
 for(let i=0;i<10&&!resolver;i++)await new Promise(fin=>setImmediate(fin));
 assert.equal(typeof resolver,'function');assert.equal(cli.envios.length,1);
 resolver();assert.equal((await primero).estado,'realizado');assert.equal(cli.envios.length,1);
});
test('respuesta perdida tras commit se acredita por relectura, sin segundo RPC',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
  aplicarReactivacion(t,payload);throw Error('red interrumpida');};
 const r=await R.confirmar(p,{operacionId:id1});
 assert.equal(r.estado,'realizado');assert.equal(r.origen,'relectura');assert.equal(cli.envios.length,1);
});
test('error incierto exige lectura; reintento conserva exactamente operation_id y payload',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 cli.rpc=async(nombre,payload)=>{
  cli.envios.push({nombre,payload:structuredClone(payload)});
  if(cli.envios.length===1){t.readError=true;throw Error('timeout');}
  aplicarReactivacion(t,payload);return {data:respuesta(payload),error:null};
 };
 const incierto=await R.confirmar(p,{operacionId:id1});
 assert.equal(incierto.estado,'incierto');assert.equal(cli.envios.length,1);
 assert.equal((await R.verificarEstado(p)).estado,'incierto');assert.equal(cli.envios.length,1);
 t.readError=false;
 const seguro=await R.verificarEstado(p);
 assert.equal(seguro.estado,'reintento_seguro');assert.match(R.renderizar(seguro),/Reintentar misma operación/);
 const final=await R.confirmar(p,{operacionId:id2});
 assert.equal(final.estado,'realizado');assert.equal(cli.envios.length,2);
 assert.deepEqual(cli.envios[0].payload,cli.envios[1].payload);
 assert.equal(cli.envios[1].payload.p_operacion_id,id1);
});
test('respuesta exitosa con lectura retrasada sólo ofrece releer',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 let payload;
 cli.rpc=async(nombre,enviado)=>{payload=enviado;cli.envios.push({nombre,payload:structuredClone(enviado)});
  return {data:respuesta(enviado),error:null};};
 const pendiente=await R.confirmar(p,{operacionId:id1});
 assert.equal(pendiente.estado,'sincronizando');assert.equal(cli.envios.length,1);
 assert.match(R.renderizar(pendiente),/Comprobar estado/);
 assert.equal((await R.confirmar(p)).estado,'sincronizando');assert.equal(cli.envios.length,1);
 aplicarReactivacion(t,payload);
 assert.equal((await R.verificarEstado(p)).estado,'realizado');assert.equal(cli.envios.length,1);
});
test('horario ocupado entre vista previa y Confirmar invalida sin RPC',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 t.servicios.push(servicio({id:'s2',estado_servicio:'programado',hora_inicio:'22:45:00'}));
 const r=await R.confirmar(p,{operacionId:id1});
 assert.equal(r.estado,'obsoleta');assert.equal(r.nueva.estado,'bloqueada');
 assert.match(R.renderizar(r.nueva),/Horario no disponible/);
 assert.equal(cli.envios.length,0);
});
test('STALE del RPC reconstruye propuesta sin reenviar y una propuesta nueva tiene otro ID',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
  if(cli.envios.length===1)return {data:null,error:{code:'40001',message:'La propuesta quedó obsoleta'}};
  aplicarReactivacion(t,payload);return {data:respuesta(payload),error:null};};
 const r=await R.confirmar(p,{operacionId:id1});
 assert.equal(r.estado,'obsoleta');assert.equal(r.nueva.estado,'propuesta');
 assert.equal(cli.envios.length,1);assert.equal((await R.confirmar(p)).estado,'obsoleta');
 const nuevo=await R.confirmar(r.nueva,{operacionId:id2});
 assert.equal(nuevo.estado,'realizado');assert.equal(cli.envios.length,2);
 assert.equal(cli.envios[1].payload.p_operacion_id,id2);
});
test('already_active, permiso e historial financiero nunca se presentan como éxito',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
  t.servicios[0].estado_servicio='programado';
  return {data:{ok:true,estado:'already_active',servicio_id:'s1',operacion_id:id1},error:null};};
 const activo=await R.confirmar(p,{operacionId:id1});
 assert.equal(activo.estado,'already_active');assert.doesNotMatch(R.renderizar(activo),/✓ Servicio reactivado/);
 assert.equal(cli.envios.length,1);assert.equal((await R.confirmar(p)).estado,'already_active');
 const t2=datos(),cli2=cliente(t2);let permitido=true;
 const p2=await R.preparar(orden,{...opciones(cli2),permiso:()=>permitido});
 permitido=false;assert.equal((await R.confirmar(p2)).estado,'sin_permiso');assert.equal(cli2.envios.length,0);
 const t3=datos(),cli3=cliente(t3),p3=await propuesta(t3,cli3);
 cli3.rpc=async(nombre,payload)=>{cli3.envios.push({nombre,payload:structuredClone(payload)});
  return {data:null,error:{code:'P0001',message:'El servicio tiene aplicaciones de pago históricas; requiere revisión humana'}};};
 assert.equal((await R.confirmar(p3,{operacionId:id1})).estado,'revision_humana');
 assert.equal(cli3.envios.length,1);
});
test('already_active con lectura retrasada sólo relee y nunca ofrece otro RPC',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
  return {data:{ok:true,estado:'already_active',servicio_id:'s1',operacion_id:id1},error:null};};
 const pendiente=await R.confirmar(p,{operacionId:id1});
 assert.equal(pendiente.estado,'sincronizando');assert.equal(cli.envios.length,1);
 assert.equal((await R.confirmar(p)).estado,'sincronizando');assert.equal(cli.envios.length,1);
 t.servicios[0].estado_servicio='programado';
 assert.equal((await R.verificarEstado(p)).estado,'already_active');assert.equal(cli.envios.length,1);
});
test('postcondición sin auditoría o sin cargo nuevo no acredita éxito ni reenvía',async()=>{
 for(const defecto of ['auditoria','cargo']){
  const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
  cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
   aplicarReactivacion(t,payload,{auditoria:defecto!=='auditoria',cargo:defecto!=='cargo'});
   return {data:respuesta(payload),error:null};};
  const r=await R.confirmar(p,{operacionId:id1});
  assert.equal(r.estado,'sincronizando');assert.equal(cli.envios.length,1);
  assert.doesNotMatch(R.renderizar(r),/✓ Servicio reactivado/);
 }
});
