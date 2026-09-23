const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const R=require('../js/supabase-asistente-servicios-reactivacion-v1.js');
const A=require('../js/supabase-asistente-servicios-cortesia-v1.js');

const diaActual='2026-09-23';
const orden='Haku, reactiva el Tonel de Sebastian Gatta, cab 1, del 25-09 a las 22:15.';
const reserva={id:'r1',titular_nombre:'Sebastián Gatta',estado_reserva:'confirmada',bove_checkout:null,bove_cierre:null,
 actualizado_en:'2026-09-22T12:00:00+00:00'};
const estadia={id:'e1',reserva_id:'r1',cabana_id:'cab1',cabanas:{numero:1},estado_estadia:'confirmada',checkout_realizado_en:null};
const catalogo={id:'cs1',codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera',activo:true,requiere_horario:true};
const recurso={id:'rec1',activo:true};
const servicio=(extra={})=>({id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cs1',recurso_id:'rec1',
 fecha_servicio:'2026-09-25',hora_inicio:'22:15:00',hora_fin:'23:15:00',cantidad:1,personas:2,total:30000,
 tipo_cobro:'normal',motivo_cortesia:null,estado_servicio:'cancelado',cancelado_en:'2026-09-23T05:16:33.216786+00:00',
 cancelado_por:'d7ff4b4d-a330-4a48-acce-4fa353491e2e',motivo_cancelacion:'Prueba',
 actualizado_en:'2026-09-23T05:16:33.216786+00:00',catalogo_servicios:catalogo,...extra});
const candidato=(extra={})=>{const s=servicio(extra);return {...s,reserva,estadia,catalogo:s.catalogo_servicios,cabana_numero:1};};
const cargo={id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,
 monto:30000,estado:'anulado',actualizado_en:'2026-09-23T05:16:33.216786+00:00'};
const auditoria=[{id:'a1',entidad_tipo:'servicios',entidad_id:'s1',reserva_id:'r1',cambios:[
 {campo:'estado_servicio',anterior:'programado',nuevo:'cancelado'},
 {campo:'motivo_cancelacion',nuevo:'Prueba'},
 {campo:'cancelado_en',nuevo:'2026-09-23T05:16:33.216786+00:00'},
 {campo:'cancelado_por',nuevo:'d7ff4b4d-a330-4a48-acce-4fa353491e2e'}]}];
const tablas=(extra={})=>({reservas:[{...reserva}],reserva_estadias:[{...estadia}],
 catalogo_servicios:[{...catalogo}],recursos_servicio:[{...recurso}],servicios:[servicio()],
 cargos:[{...cargo}],vista_estado_cargos:[{cargo_id:'c1',monto:30000,monto_ajustado:30000,aplicado_neto:0,saldo_cargo:0}],
 pago_aplicaciones:[],cargo_ajustes:[],pagos:[],eventos_auditoria:auditoria.map(x=>({...x,cambios:x.cambios.map(y=>({...y}))})),...extra});
function clienteLectura(datos){
 const consultas=[],escrituras=[];
 return {consultas,escrituras,from(tabla){
  const filtros=[],registro={tabla,filtros:[]};
  const q={select(){return q;},eq(k,v){registro.filtros.push([k,v]);filtros.push(x=>x[k]===v);return q;},
   in(k,vs){registro.filtros.push([k,vs]);filtros.push(x=>vs.includes(x[k]));return q;},order(){return q;},
   async range(desde,hasta){consultas.push(registro);return {data:(datos[tabla]||[]).filter(x=>filtros.every(f=>f(x)))
    .slice(desde,hasta+1),error:null};},
   update(){escrituras.push('update');throw Error('Escritura prohibida');},
   insert(){escrituras.push('insert');throw Error('Escritura prohibida');},
   delete(){escrituras.push('delete');throw Error('Escritura prohibida');},
   upsert(){escrituras.push('upsert');throw Error('Escritura prohibida');}};
  return q;
 },rpc(){escrituras.push('rpc');throw Error('RPC prohibido');}};
}
const opciones=(cliente,extra={})=>({cliente,permiso:()=>true,diaActual,...extra});
const lectura=(extra={})=>({finanzas:{cargos:[{...cargo}],aplicaciones:[],ajustes:[],estados:[]},
 reserva:{...reserva},estadia:{...estadia},checkout:null,catalogo:{...catalogo},recurso:{...recurso},
 conflictos:[],pagos:[],auditoria:auditoria.map(x=>({...x,cambios:x.cambios.map(y=>({...y}))})),...extra});

test('intención canónica y prioridad de Servicios aun cuando faltan datos',async()=>{
 for(const t of [orden,'Haku, vuelve a activar el Jacuzzi de Paulina del 04-09.',
  'Haku, vuelve a programar el masaje de Laura del 19-09 a las 13:15.',
  'Haku, restaura el servicio','reactivar la tinaja de la cab 1 del 25-09'])
  assert.equal(R.interpretar(t,{diaActual})?.intencion,'REACTIVAR_SERVICIO_EXISTENTE');
 for(const t of ['reactiva la reserva de Pedro','reactiva el estado de la reserva','crea un servicio nuevo','no reactives el Tonel'])
  assert.equal(R.interpretar(t,{diaActual}),null);
 const incompleta=await R.preparar('Haku, restaura el servicio',{diaActual});
 assert.equal(incompleta.estado,'incompleta');assert.match(incompleta.mensaje,/necesito identificarlo mejor/);
});
test('aliases aprobados, titular sin tilde, fecha y CAB reutilizan búsqueda persistida',async()=>{
 const q=R.interpretar(orden,{diaActual});
 assert.deepEqual([q.titular,q.cabana,q.fecha,q.hora,q.codigos_servicio],
  ['Sebastian Gatta',1,'2026-09-25','22:15',['tinajaTonel']]);
 for(const alias of ['tonel','tinaja tonel','tonel de madera','tinaja de madera','tinaja tipo tonel'])
  assert.deepEqual(R.interpretar(`reactiva ${alias} de Sebastian Gatta, cab 1, del 25-09`,{diaActual}).codigos_servicio,['tinajaTonel']);
 for(const alias of ['jacuzzi','tinaja jacuzzi','tinaja tipo jacuzzi'])
  assert.deepEqual(R.interpretar(`restaura ${alias} de Paulina del 04-09`,{diaActual}).codigos_servicio,['tinajaJacuzzi']);
 const cli=clienteLectura(tablas());
 assert.equal((await A.buscarServicios(q,{cliente:cli}))[0].id,'s1');
 assert.equal((await A.buscarServicios(R.interpretar('reactiva el Tonel de Sebastian, cab 1, del 25-09',{diaActual}),{cliente:cli})).length,1);
 assert.equal(cli.consultas.some(x=>x.tabla==='servicios'),true);
});
test('masajes dinámicos, late check-out y cuna conservan cardinalidad',async()=>{
 const m=R.interpretar('vuelve a programar el masaje de Laura del 25-09 a las 13:15',{diaActual});
 assert.equal(m.familia,'masaje');assert.equal(m.hora,'13:15');
 assert.deepEqual(R.interpretar('reactiva el late check-out de Pedro',{diaActual}).codigos_servicio,['lateCheckout']);
 assert.deepEqual(R.interpretar('reactiva la cuna de Pedro',{diaActual}).codigos_servicio,['cuna']);
 const ms=tablas({catalogo_servicios:[{id:'m1',codigo:'masajeDescontracturante60',nombre:'Masaje Descontracturante 60 min',activo:true},
  {id:'m2',codigo:'masajeRelajacion60',nombre:'Masaje Relajación 60 min',activo:true}],
  servicios:[servicio({id:'m1s',catalogo_servicio_id:'m1',hora_inicio:'12:15:00',catalogo_servicios:{id:'m1',codigo:'masajeDescontracturante60',nombre:'Masaje Descontracturante 60 min'}}),
   servicio({id:'m2s',catalogo_servicio_id:'m2',hora_inicio:'13:15:00',catalogo_servicios:{id:'m2',codigo:'masajeRelajacion60',nombre:'Masaje Relajación 60 min'}})]});
 const q=R.interpretar('reactiva el masaje de Sebastian Gatta, cab 1, del 25-09',{diaActual});
 assert.equal((await R.preparar(q,opciones(clienteLectura(ms)))).estado,'multiples');
 assert.equal((await R.preparar({...q,hora:'13:15'},opciones(clienteLectura(ms)))).estado,'bloqueada');
});
test('0, 1 o varios candidatos y servicio ya programado',async()=>{
 const q=R.interpretar(orden,{diaActual});
 assert.equal((await R.preparar(q,opciones(clienteLectura(tablas())))).estado,'propuesta');
 assert.equal((await R.preparar({...q,cabana:9},opciones(clienteLectura(tablas())))).estado,'no_encontrado');
 const varios=await R.preparar({...q,hora:null},opciones(clienteLectura(tablas({servicios:[servicio(),servicio({id:'s2',hora_inicio:'20:15:00'})]}))));
 assert.equal(varios.estado,'multiples');assert.doesNotMatch(R.renderizar(varios),/data-servicio-reactivacion-confirmar/);
 const activo=await R.preparar(q,opciones(clienteLectura(tablas({servicios:[servicio({estado_servicio:'programado'})]}))));
 assert.equal(activo.estado,'already_active');assert.match(R.renderizar(activo),/ya está activo/);
 assert.doesNotMatch(R.renderizar(activo),/data-servicio-reactivacion-confirmar|haiku_reactivar_servicio_asistente_v1/);
});
test('Sebastián elegible: snapshot exacto, disponibilidad y cargo nuevo esperado',async()=>{
 const cli=clienteLectura(tablas()),p=await R.preparar(orden,opciones(cli));
 assert.equal(p.estado,'propuesta');assert.equal(p.disponibilidad.libre,true);
 assert.deepEqual(Object.keys(p.p_estado_esperado),[
  'version','servicio_id','servicio_actualizado_en','estado_servicio','cancelado_en','cancelado_por','motivo_cancelacion',
  'reserva_id','estadia_id','catalogo_servicio_id','catalogo_activo','estadia_estado','recurso_id','recurso_activo',
  'fecha_servicio','hora_inicio','hora_fin','tipo_cobro','total','estado_reserva','reserva_actualizado_en',
  'checkout_realizado_en','bove_checkout','bove_cierre','cargos','cantidad_cargos_activos','aplicaciones','ajustes','conflictos']);
 assert.equal(p.p_estado_esperado.cantidad_cargos_activos,0);
 assert.deepEqual(p.p_estado_esperado.cargos,[cargo]);
 assert.deepEqual(p.p_estado_esperado.conflictos,[]);
 assert.match(R.renderizar(p),/Sebastián Gatta · CAB 1/);
 assert.match(R.renderizar(p),/25-09-2026 · 22:15–23:15/);
 assert.match(R.renderizar(p),/Cargo histórico anulado: \$30\.000/);
 assert.match(R.renderizar(p),/nuevo cargo activo por \$30\.000/);
 assert.match(R.renderizar(p),/Horario disponible/);
 assert.match(R.renderizar(p),/Confirmar reactivación · simulación/);
 assert.ok(cli.consultas.some(x=>x.tabla==='eventos_auditoria'));
 assert.ok(cli.consultas.some(x=>x.tabla==='recursos_servicio'));
});
test('cortesía limpia se reactiva sin cargo nuevo',async()=>{
 const l=lectura({finanzas:{cargos:[],aplicaciones:[],ajustes:[],estados:[]}});
 const c=candidato({tipo_cobro:'cortesia',total:0,motivo_cortesia:'Atención comercial'});
 assert.equal(R.evaluarElegibilidad(c,l,{diaActual}).estado,'elegible');
 const p=await R.preparar(orden,opciones(clienteLectura(tablas({servicios:[servicio({tipo_cobro:'cortesia',total:0,motivo_cortesia:'Atención comercial'})],cargos:[]}))));
 assert.equal(p.estado,'propuesta');assert.match(R.renderizar(p),/No se creará ningún cargo/);
});
test('bloqueos operativos, auditoría, reserva, BOVE, fecha y recurso',()=>{
 const casos=[
  ...['realizado','no_show','en_proceso'].map(estado=>[candidato({estado_servicio:estado}),lectura()]),
  [candidato(),lectura({auditoria:[]})],
  [candidato(),lectura({reserva:{...reserva,estado_reserva:'checked_out'}})],
  [candidato(),lectura({checkout:'2026-09-23T12:00:00+00:00'})],
  [candidato(),lectura({reserva:{...reserva,bove_checkout:{folio:'B1'}}})],
  [candidato(),lectura({reserva:{...reserva,bove_cierre:{folio:'B2'}}})],
  [candidato(),lectura({estadia:{...estadia,estado_estadia:'checked_out'}})],
  [candidato({fecha_servicio:'2026-09-22'}),lectura()],
  [candidato(),lectura({catalogo:{...catalogo,activo:false}})],
  [candidato(),lectura({recurso:{...recurso,activo:false}})],
  [candidato({hora_fin:'22:00:00'}),lectura()]
 ];
 for(const [c,l] of casos)assert.equal(R.evaluarElegibilidad(c,l,{diaActual}).estado,'bloqueada');
});
test('cargo activo, historial incoherente, aplicaciones y ajustes bloquean',()=>{
 const casos=[
  lectura({finanzas:{cargos:[{...cargo,estado:'activo'}],aplicaciones:[],ajustes:[]}}),
  lectura({finanzas:{cargos:[{...cargo,reserva_id:'otra'}],aplicaciones:[],ajustes:[]}}),
  lectura({finanzas:{cargos:[cargo],aplicaciones:[{id:'a1'}],ajustes:[]}}),
  lectura({finanzas:{cargos:[cargo],aplicaciones:[],ajustes:[{id:'j1'}]}})
 ];
 for(const l of casos)assert.equal(R.evaluarElegibilidad(candidato(),l,{diaActual}).estado,'bloqueada');
});
test('horario ocupado muestra conflictos y no ofrece Confirmar',async()=>{
 const ocupado=servicio({id:'s2',estado_servicio:'programado',hora_inicio:'22:30:00',hora_fin:'23:30:00'});
 const p=await R.preparar(orden,opciones(clienteLectura(tablas({servicios:[servicio(),ocupado]}))));
 assert.equal(p.estado,'bloqueada');assert.equal(p.disponibilidad.libre,false);
 assert.match(R.renderizar(p),/Horario no disponible/);assert.match(R.renderizar(p),/22:30–23:30/);
 assert.doesNotMatch(R.renderizar(p),/data-servicio-reactivacion-confirmar/);
});
test('simulación revalida, conserva operation_id y payload, y nunca escribe',async()=>{
 const cli=clienteLectura(tablas());
 const p=await R.preparar(orden,opciones(cli));
 const id='11111111-1111-4111-8111-111111111111';
 const uno=R.confirmar(p,{operacionId:id}),dos=R.confirmar(p,{operacionId:id});
 assert.strictEqual(uno,dos);
 const resultado=await uno;
 assert.equal(resultado.estado,'simulada');assert.equal(resultado.rpc,'haiku_reactivar_servicio_asistente_v1');
 assert.equal(resultado.payload.p_operacion_id,id);assert.equal(resultado.payload.p_servicio_id,'s1');
 assert.deepEqual(resultado.payload.p_estado_esperado,p.p_estado_esperado);
 assert.strictEqual(await R.confirmar(p,{operacionId:'22222222-2222-4222-8222-222222222222'}),resultado);
 assert.deepEqual(cli.escrituras,[]);
 assert.match(R.renderizar(resultado),/RPC y payload preparados/);
 assert.match(R.renderizar(resultado),/No se modificó Proyecto H/);
 const nuevo=await R.preparar(orden,opciones(cli));
 assert.notStrictEqual(nuevo,p);
 assert.equal(nuevo.estado,'propuesta');
 const siguiente=await R.confirmar(nuevo,{operacionId:'22222222-2222-4222-8222-222222222222'});
 assert.equal(siguiente.payload.p_operacion_id,'22222222-2222-4222-8222-222222222222');
 assert.deepEqual(cli.escrituras,[]);
});
test('stale state por servicio, finanzas, auditoría o disponibilidad invalida y reconstruye',async()=>{
 const cambios=[
  t=>{t.servicios[0].actualizado_en='2026-09-23T14:00:00+00:00';},
  t=>{t.cargos.push({...cargo,id:'c2',estado:'activo'});},
  t=>{t.eventos_auditoria=[];},
  t=>{t.servicios.push(servicio({id:'s2',estado_servicio:'programado',hora_inicio:'22:45:00'}));},
  t=>{t.reservas[0].bove_cierre={folio:'BOVE'};}
 ];
 for(const cambiar of cambios){
  const t=tablas(),p=await R.preparar(orden,opciones(clienteLectura(t)));
  assert.equal(p.estado,'propuesta');cambiar(t);
  const resultado=await R.confirmar(p,{operacionId:'11111111-1111-4111-8111-111111111111'});
  assert.equal(resultado.estado,'obsoleta');assert.ok(resultado.nueva);
  assert.equal((await R.confirmar(p)).estado,'obsoleta');
 }
});
test('flag independiente y guard de escritura estático; carga tras autoridad y cancelación',()=>{
 const js=fs.readFileSync(require.resolve('../js/supabase-asistente-servicios-reactivacion-v1.js'),'utf8');
 assert.equal(R.RPC_REACTIVACION_PRODUCCION_HABILITADO,false);
 assert.match(js,/RPC_REACTIVACION_PRODUCCION_HABILITADO=false/);
 assert.doesNotMatch(js,/\.(?:rpc|update|insert|delete|upsert)\s*\(/);
 const html=fs.readFileSync(path.join(__dirname,'../panel.html'),'utf8');
 assert.ok(html.indexOf("'supabase-asistente-servicios-cortesia-v1','supabase-asistente-servicios-cancelacion-v1','supabase-asistente-servicios-reactivacion-v1'")>0);
});
