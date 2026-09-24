const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../js/supabase-asistente-servicios-realizado-v1.js');

const orden='Haku, marca como realizado el Tonel de Dayana del 20-09.';
const operationId='11111111-1111-4111-8111-111111111111';
const otroId='22222222-2222-4222-8222-222222222222';
const reserva={id:'r1',titular_nombre:'Dayana Luna Mendoza',estado_reserva:'hospedada',
 bove_checkout:null,bove_cierre:null,actualizado_en:'2026-09-20T18:00:00Z'};
const estadia={id:'e1',reserva_id:'r1',cabana_id:'cab6',estado_estadia:'hospedada',
 checkout_realizado_en:null,cabanas:{numero:6}};
const catalogo={id:'cat1',codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera',activo:true};
const servicio={id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cat1',recurso_id:'rec1',
 fecha_servicio:'2026-09-20',hora_inicio:'19:15:00',hora_fin:'20:15:00',cantidad:1,personas:2,
 precio_unitario_aplicado:30000,monto_adicional:0,total:30000,tipo_cobro:'normal',
 motivo_cortesia:null,estado_servicio:'programado',actualizado_en:'2026-09-20T18:00:00Z',
 catalogo_servicios:catalogo};
const cargo={id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',
 estadia_noche_id:null,concepto:catalogo.nombre,moneda:'CLP',monto:30000,estado:'activo',
 actualizado_en:'2026-09-20T18:00:00Z'};
const vista={cargo_id:'c1',servicio_id:'s1',estado:'activo',monto:30000,monto_ajustado:30000,
 aplicado_neto:0,saldo_cargo:30000,estado_pago:'pendiente',ajuste_neto:0};
const datos=(extra={})=>({servicios:[structuredClone(servicio)],reservas:[structuredClone(reserva)],
 reserva_estadias:[structuredClone(estadia)],catalogo_servicios:[structuredClone(catalogo)],
 cargos:[structuredClone(cargo)],vista_estado_cargos:[structuredClone(vista)],
 pagos:[],pago_aplicaciones:[],cargo_ajustes:[],eventos_auditoria:[],...extra});
function cliente(t){
 const consultas=[],envios=[];
 return {consultas,envios,from(tabla){
  const filtros=[];let columnas='*',ordenarPor=null;
  const q={select(x){columnas=x;return q;},
   eq(k,v){filtros.push(x=>x[k]===v);return q;},
   in(k,vs){filtros.push(x=>vs.includes(x[k]));return q;},
   order(k){ordenarPor=k;return q;},
   async range(desde,hasta){
    consultas.push(tabla);
    if(t.readError)return {data:null,error:new Error('Lectura interrumpida')};
    const filas=(t[tabla]||[]).filter(x=>filtros.every(f=>f(x))).slice();
    if(ordenarPor)filas.sort((a,b)=>String(a[ordenarPor]).localeCompare(String(b[ordenarPor])));
    return {data:filas.slice(desde,hasta+1).map(x=>{
     if(columnas!=='*')return structuredClone(x);
     if(tabla==='servicios'){const {catalogo_servicios,...persistido}=x;return structuredClone(persistido);}
     if(tabla==='reserva_estadias'){const {cabanas,...persistido}=x;return structuredClone(persistido);}
     return structuredClone(x);
    }),error:null};
   },
   update(){throw Error('update prohibido');},insert(){throw Error('insert prohibido');},
   delete(){throw Error('delete prohibido');},upsert(){throw Error('upsert prohibido');}};
  return q;
 },async rpc(nombre,payload){envios.push({nombre,payload:structuredClone(payload)});
  throw Error('Definir respuesta RPC en la prueba');}};
}
const opciones=cli=>({cliente:cli,permiso:()=>true,leerTiempo:async()=> '2026-09-23T15:00:00Z',
 diaActual:'2026-09-23'});
const respuesta=(payload,extra={})=>({ok:true,estado:'realized',operacion_id:payload.p_operacion_id,
 servicio_id:'s1',reserva_id:'r1',estado_anterior:'programado',estado_servicio:'realizado',
 tipo_cobro:'normal',total:30000,cargo_activo_id:'c1',saldo_cargo:30000,...extra});
function aplicar(t,payload,{auditoria=true}={}){
 t.servicios[0].estado_servicio='realizado';
 t.servicios[0].actualizado_en='2026-09-23T16:00:00Z';
 if(auditoria)t.eventos_auditoria.push({id:'a1',entidad_tipo:'servicios',entidad_id:'s1',
  reserva_id:'r1',usuario_id:'u1',origen:'haku',
  datos_contexto:{operacion_id:payload.p_operacion_id},
  cambios:[{campo:'estado_servicio',anterior:'programado',nuevo:'realizado'}]});
}
async function propuesta(t,cli){
 const p=await R.preparar(orden,opciones(cli));
 assert.equal(p.estado,'propuesta');
 return p;
}

test('manual selecciona el ID exacto y omite sólo filtros preventivos exclusivos de Haku',async()=>{
 const historico={...cargo,id:'c0',estado:'anulado'};
 const t=datos({servicios:[structuredClone(servicio),{...servicio,id:'s2'}],
  cargos:[structuredClone(cargo),historico],vista_estado_cargos:[structuredClone(vista)]});
 const cli=cliente(t),sinReloj={...opciones(cli),leerTiempo:async()=>null};
 const manual=await R.prepararManual('s1',sinReloj);
 assert.equal(manual.estado,'propuesta');
 assert.equal(manual.candidato.id,'s1');
 assert.equal(manual.p_estado_esperado.cargos.length,2);
 assert.equal(cli.envios.length,0);
 const haku=await R.preparar(orden,sinReloj);
 assert.equal(haku.estado,'multiples');
 const tUnico=datos({cargos:[structuredClone(cargo),historico],
  vista_estado_cargos:[structuredClone(vista)]});
 const hakuUnico=await R.preparar(orden,{...opciones(cliente(tUnico)),leerTiempo:async()=>null});
 assert.equal(hakuUnico.estado,'bloqueada');
 assert.match(hakuUnico.mensaje,/automáticamente/);
 assert.ok(hakuUnico.evaluacion.razones.some(x=>/hora del servidor/.test(x)));
 assert.ok(hakuUnico.evaluacion.razones.some(x=>/cargo o su saldo/.test(x)));
});

test('manual conserva los bloqueos canónicos y sus razones concretas',async()=>{
 for(const [extra,razon] of [
  [{servicios:[{...servicio,fecha_servicio:'2026-09-24'}]},/fecha del servicio es futura/],
  [{servicios:[{...servicio,estado_servicio:'cancelado'}]},/estado operativo/],
  [{reservas:[{...reserva,bove_checkout:'BOVE-1'}]},/BOVE/],
  [{cargo_ajustes:[{id:'aj1',cargo_id:'c1'}]},/ajustes históricos/]
 ]){
  const cli=cliente(datos(extra));
  const p=await R.prepararManual('s1',opciones(cli));
  assert.equal(p.estado,'bloqueada');
  assert.match(p.mensaje,/No se puede marcar este servicio/);
  assert.ok(p.evaluacion.razones.some(x=>razon.test(x)),String(razon));
  assert.equal(cli.envios.length,0);
 }
});

test('manual revalida con sus propias reglas y detiene una propuesta obsoleta',async()=>{
 const t=datos(),cli=cliente(t);
 const p=await R.prepararManual('s1',{...opciones(cli),leerTiempo:async()=>null});
 assert.equal(p.estado,'propuesta');
 t.cargos[0].monto=31000;
 const resultado=await R.confirmar(p,{operationId});
 assert.equal(resultado.estado,'obsoleta');
 assert.equal(resultado.nueva.estado,'bloqueada');
 assert.ok(resultado.nueva.evaluacion.razones.some(x=>/cargo o su saldo/.test(x)));
 assert.doesNotMatch(resultado.mensaje,/Preparé|automáticamente/);
 assert.equal(cli.envios.length,0);
});

test('manual confirma con el RPC protegido, mantiene cargo y saldo y expone rechazo canónico',async()=>{
 const t=datos(),cli=cliente(t),sinReloj={...opciones(cli),leerTiempo:async()=>null};
 const p=await R.prepararManual('s1',sinReloj);
 assert.equal(p.estado,'propuesta');
 const finanzas=structuredClone({cargos:t.cargos,pagos:t.pagos,
  aplicaciones:t.pago_aplicaciones,ajustes:t.cargo_ajustes,estados:t.vista_estado_cargos});
 cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
  aplicar(t,payload);return {data:respuesta(payload),error:null};};
 const r=await R.confirmar(p,{operationId});
 assert.equal(r.estado,'realizado');
 assert.equal(cli.envios.length,1);
 assert.equal(cli.envios[0].nombre,'haiku_marcar_servicio_realizado_asistente_v1');
 assert.deepEqual({cargos:t.cargos,pagos:t.pagos,aplicaciones:t.pago_aplicaciones,
  ajustes:t.cargo_ajustes,estados:t.vista_estado_cargos},finanzas);

 const bloqueado=datos(),cliBloqueado=cliente(bloqueado);
 const pBloqueado=await R.prepararManual('s1',{...opciones(cliBloqueado),leerTiempo:async()=>null});
 cliBloqueado.rpc=async(nombre,payload)=>{cliBloqueado.envios.push({nombre,payload});
  return {data:null,error:new Error('El servicio tiene fecha futura; requiere revisión humana')};};
 const resultado=await R.confirmar(pBloqueado,{operationId:otroId});
 assert.equal(resultado.estado,'revision_humana');
 assert.match(resultado.mensaje,/fecha futura/);
 assert.doesNotMatch(resultado.mensaje,/automáticamente/);
 assert.equal(bloqueado.servicios[0].estado_servicio,'programado');
});

test('confirmación real usa sólo el RPC oficial y acredita servicio, cargo, saldo y auditoría',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 const finanzas=structuredClone({cargos:t.cargos,pagos:t.pagos,aplicaciones:t.pago_aplicaciones,
  ajustes:t.cargo_ajustes,estados:t.vista_estado_cargos,reserva:t.reservas});
 cli.rpc=async(nombre,payload)=>{
  cli.envios.push({nombre,payload:structuredClone(payload)});aplicar(t,payload);
  return {data:respuesta(payload),error:null};
 };
 const r=await R.confirmar(p,{operationId});
 assert.equal(r.estado,'realizado');assert.equal(r.candidato.estado_servicio,'realizado');
 assert.equal(r.operation_id,operationId);
 assert.equal(cli.envios.length,1);
 assert.equal(cli.envios[0].nombre,'haiku_marcar_servicio_realizado_asistente_v1');
 assert.deepEqual(Object.keys(cli.envios[0].payload),['p_operacion_id','p_servicio_id','p_estado_esperado']);
 assert.deepEqual(cli.envios[0].payload.p_estado_esperado,p.p_estado_esperado);
 assert.equal(cli.envios[0].payload.p_operacion_id,operationId);
 assert.deepEqual({cargos:t.cargos,pagos:t.pagos,aplicaciones:t.pago_aplicaciones,
  ajustes:t.cargo_ajustes,estados:t.vista_estado_cargos,reserva:t.reservas},finanzas);
 assert.match(R.renderizar(r),/✓ Servicio marcado como realizado/);
 assert.match(R.renderizar(r),/Pendiente de pago · \$30\.000/);
 assert.match(R.renderizar(r),/No se modificaron pagos ni aplicaciones/);
 assert.strictEqual(await R.confirmar(p,{operationId:otroId}),r);
 assert.equal(cli.envios.length,1);
});
test('pagado parcialmente, pagado, cortesía y BOVE conservan su estado',async()=>{
 for(const [tipo,extra,esperado] of [
  ['parcial',{pagos:[{id:'p1',reserva_id:'r1',estado:'confirmado',tipo_movimiento:'pago'}],
   pago_aplicaciones:[{id:'pa1',cargo_id:'c1',pago_id:'p1',monto_aplicado:10000}],
   vista_estado_cargos:[{...vista,aplicado_neto:10000,saldo_cargo:20000,estado_pago:'parcial'}]},/saldo pendiente \$20\.000/],
  ['pagado',{pagos:[{id:'p1',reserva_id:'r1',estado:'confirmado',tipo_movimiento:'pago'}],
   pago_aplicaciones:[{id:'pa1',cargo_id:'c1',pago_id:'p1',monto_aplicado:30000}],
   vista_estado_cargos:[{...vista,aplicado_neto:30000,saldo_cargo:0,estado_pago:'pagado'}]},/Pagado · saldo \$0/],
  ['cortesia',{servicios:[{...servicio,tipo_cobro:'cortesia',total:0,motivo_cortesia:'Invitación'}],
   cargos:[],vista_estado_cargos:[]},/Cortesía · \$0/]
 ]){
  const t=datos(extra),cli=cliente(t),p=await propuesta(t,cli);
  const finanzas=structuredClone({cargos:t.cargos,pagos:t.pagos,aplicaciones:t.pago_aplicaciones,
   ajustes:t.cargo_ajustes,estados:t.vista_estado_cargos,reserva:t.reservas});
  cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
   aplicar(t,payload);return {data:respuesta(payload,{tipo_cobro:t.servicios[0].tipo_cobro,
    total:t.servicios[0].total,cargo_activo_id:tipo==='cortesia'?null:'c1',
    saldo_cargo:tipo==='cortesia'?null:t.vista_estado_cargos[0].saldo_cargo}),error:null};};
  const r=await R.confirmar(p,{operationId});
  assert.equal(r.estado,'realizado',tipo);assert.match(R.renderizar(r),esperado);
  assert.deepEqual({cargos:t.cargos,pagos:t.pagos,aplicaciones:t.pago_aplicaciones,
   ajustes:t.cargo_ajustes,estados:t.vista_estado_cargos,reserva:t.reservas},finanzas);
 }
 const t=datos({reservas:[{...reserva,bove_checkout:'BOVE-123'}]}),cli=cliente(t);
 const p=await R.preparar(orden,opciones(cli));
 assert.equal(p.estado,'bloqueada');assert.equal(cli.envios.length,0);
});
test('doble clic comparte promesa y emite una sola llamada',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 let resolver;
 cli.rpc=(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
  return new Promise(fin=>{resolver=()=>{aplicar(t,payload);fin({data:respuesta(payload),error:null});};});};
 const uno=R.confirmar(p,{operationId}),dos=R.confirmar(p,{operationId:otroId});
 assert.strictEqual(uno,dos);
 for(let i=0;i<10&&!resolver;i++)await new Promise(fin=>setImmediate(fin));
 assert.equal(cli.envios.length,1);resolver();
 assert.equal((await uno).estado,'realizado');assert.equal(cli.envios.length,1);
});
test('respuesta perdida tras commit se acredita por relectura sin segundo RPC',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
  aplicar(t,payload);throw Error('Red interrumpida');};
 const r=await R.confirmar(p,{operationId});
 assert.equal(r.estado,'realizado');assert.equal(r.origen,'relectura');assert.equal(cli.envios.length,1);
});
test('error incierto relee; reintento técnico conserva operation_id y payload',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
  if(cli.envios.length===1){t.readError=true;throw Error('timeout');}
  aplicar(t,payload);return {data:respuesta(payload),error:null};};
 const incierto=await R.confirmar(p,{operationId});
 assert.equal(incierto.estado,'incierto');assert.equal(cli.envios.length,1);
 assert.equal((await R.verificarEstado(p)).estado,'incierto');assert.equal(cli.envios.length,1);
 t.readError=false;
 const seguro=await R.verificarEstado(p);
 assert.equal(seguro.estado,'reintento_seguro');
 assert.match(R.renderizar(seguro),/Reintentar misma operación/);
 const final=await R.confirmar(p,{operationId:otroId});
 assert.equal(final.estado,'realizado');assert.equal(cli.envios.length,2);
 assert.deepEqual(cli.envios[0].payload,cli.envios[1].payload);
 assert.equal(cli.envios[1].payload.p_operacion_id,operationId);
});
test('respuesta exitosa con lectura retrasada sólo ofrece releer',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 let payload;
 cli.rpc=async(nombre,x)=>{payload=x;cli.envios.push({nombre,payload:structuredClone(x)});
  return {data:respuesta(x),error:null};};
 const pendiente=await R.confirmar(p,{operationId});
 assert.equal(pendiente.estado,'sincronizando');assert.match(R.renderizar(pendiente),/Comprobar estado/);
 assert.equal((await R.confirmar(p)).estado,'sincronizando');assert.equal(cli.envios.length,1);
 aplicar(t,payload);
 assert.equal((await R.verificarEstado(p)).estado,'realizado');assert.equal(cli.envios.length,1);
});
test('cambio previo, STALE, already_realized y SIN_PERMISO no hacen segunda escritura',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 t.pagos.push({id:'p1',reserva_id:'r1',estado:'confirmado',tipo_movimiento:'pago'});
 const stale=await R.confirmar(p,{operationId});
 assert.equal(stale.estado,'obsoleta');assert.equal(cli.envios.length,0);
 const t2=datos(),cli2=cliente(t2),p2=await propuesta(t2,cli2);
 cli2.rpc=async(nombre,payload)=>{cli2.envios.push({nombre,payload:structuredClone(payload)});
  return {data:null,error:{code:'40001',message:'La propuesta quedó obsoleta'}};};
 const rpcStale=await R.confirmar(p2,{operationId});
 assert.equal(rpcStale.estado,'obsoleta');assert.equal(cli2.envios.length,1);
 assert.equal((await R.confirmar(p2)).estado,'obsoleta');
 assert.equal(rpcStale.nueva.estado,'propuesta');
 cli2.rpc=async(nombre,payload)=>{cli2.envios.push({nombre,payload:structuredClone(payload)});
  aplicar(t2,payload);return {data:respuesta(payload),error:null};};
 assert.equal((await R.confirmar(rpcStale.nueva,{operationId:otroId})).estado,'realizado');
 assert.equal(cli2.envios[1].payload.p_operacion_id,otroId);
 const t3=datos(),cli3=cliente(t3),p3=await propuesta(t3,cli3);
 cli3.rpc=async(nombre,payload)=>{cli3.envios.push({nombre,payload:structuredClone(payload)});
  t3.servicios[0].estado_servicio='realizado';
  return {data:{ok:true,estado:'already_realized',servicio_id:'s1',
   operacion_id:payload.p_operacion_id},error:null};};
 assert.equal((await R.confirmar(p3,{operationId})).estado,'already_realized');
 assert.equal((await R.confirmar(p3)).estado,'already_realized');assert.equal(cli3.envios.length,1);
 const t4=datos(),cli4=cliente(t4);let permitido=true;
 const p4=await R.preparar(orden,{...opciones(cli4),permiso:()=>permitido});
 permitido=false;assert.equal((await R.confirmar(p4)).estado,'sin_permiso');assert.equal(cli4.envios.length,0);
});
test('BOVE nuevo, hora no verificable y rechazo financiero bloquean la escritura',async()=>{
 const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
 t.reservas[0].bove_cierre='BOVE-123';
 const cambio=await R.confirmar(p,{operationId});
 assert.equal(cambio.estado,'obsoleta');assert.equal(cambio.nueva.estado,'bloqueada');
 assert.equal(cli.envios.length,0);
 const t2=datos(),cli2=cliente(t2);let hora='2026-09-23T15:00:00Z';
 const p2=await R.preparar(orden,{...opciones(cli2),leerTiempo:async()=>hora});
 assert.equal(p2.estado,'propuesta');hora=null;
 const sinHora=await R.confirmar(p2,{operationId});
 assert.equal(sinHora.estado,'obsoleta');assert.equal(sinHora.nueva.estado,'bloqueada');
 assert.equal(cli2.envios.length,0);
 const t3=datos(),cli3=cliente(t3),p3=await propuesta(t3,cli3);
 cli3.rpc=async(nombre,payload)=>{cli3.envios.push({nombre,payload:structuredClone(payload)});
  return {data:null,error:{code:'P0001',message:'El servicio tiene ajustes históricos; requiere revisión humana'}};};
 assert.equal((await R.confirmar(p3,{operationId})).estado,'revision_humana');
 assert.equal((await R.confirmar(p3)).estado,'obsoleta');
 assert.equal(cli3.envios.length,1);
});
test('sin auditoría o con finanzas alteradas no acredita éxito ni repite el RPC',async()=>{
 for(const defecto of ['auditoria','cargo','pago']){
  const t=datos(),cli=cliente(t),p=await propuesta(t,cli);
  cli.rpc=async(nombre,payload)=>{cli.envios.push({nombre,payload:structuredClone(payload)});
   aplicar(t,payload,{auditoria:defecto!=='auditoria'});
   if(defecto==='cargo')t.cargos[0].monto=31000;
   if(defecto==='pago')t.pagos.push({id:'p2',reserva_id:'r1',estado:'confirmado'});
   return {data:respuesta(payload),error:null};};
  const r=await R.confirmar(p,{operationId});
  assert.equal(r.estado,'sincronizando',defecto);assert.equal(cli.envios.length,1);
  assert.doesNotMatch(R.renderizar(r),/✓ Servicio marcado como realizado/);
 }
});
