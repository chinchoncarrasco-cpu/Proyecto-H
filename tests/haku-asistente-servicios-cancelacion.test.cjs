const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=require('../js/supabase-asistente-servicios-cancelacion-v1.js');
const A=require('../js/supabase-asistente-servicios-cortesia-v1.js');

const reserva={id:'r1',titular_nombre:'Hernán Guzmán',estado_reserva:'confirmada',bove_checkout:null,actualizado_en:'2026-09-22T12:00:00+00:00'};
const estadia={id:'e1',reserva_id:'r1',cabana_id:'cab8',cabanas:{numero:8},checkout_realizado_en:null};
const servicio=(extra={})=>({id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cs1',recurso_id:'rec1',
 fecha_servicio:'2026-09-13',hora_inicio:'19:15:00',hora_fin:'20:15:00',cantidad:1,personas:2,total:30000,
 tipo_cobro:'normal',motivo_cortesia:null,estado_servicio:'programado',cancelado_en:null,cancelado_por:null,motivo_cancelacion:null,
 actualizado_en:'2026-09-22T12:00:00+00:00',catalogo_servicios:{id:'cs1',codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera'},...extra});
const candidato=(extra={})=>{const s=servicio(extra);return {...s,reserva,estadia,catalogo:s.catalogo_servicios,cabana_numero:8};};
const cargo={id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,monto:30000,estado:'activo',actualizado_en:'2026-09-22T12:00:00+00:00'};
const finanzas=(extra={})=>({cargos:[cargo],estados:[{cargo_id:'c1',monto:30000,monto_ajustado:30000,aplicado_neto:0,saldo_cargo:30000}],aplicaciones:[],ajustes:[],...extra});
function clienteLectura(tablas){
 const consultas=[];
 return {consultas,from(tabla){
  const filtros=[],registro={tabla,filtros:[]};
  const b={select(){return b;},in(campo,valores){registro.filtros.push([campo,valores]);filtros.push(x=>valores.includes(x[campo]));return b;},
   eq(campo,v){registro.filtros.push([campo,v]);filtros.push(x=>x[campo]===v);return b;},order(){return b;},
   async range(desde,hasta){consultas.push(registro);return {data:(tablas[tabla]||[]).filter(x=>filtros.every(f=>f(x))).slice(desde,hasta+1),error:null};}};
  return b;
 }};
}
const tablas=(extra={})=>({catalogo_servicios:[{id:'cs1',codigo:'tinajaTonel'}],reservas:[reserva],reserva_estadias:[estadia],servicios:[servicio()],
 cargos:[cargo],vista_estado_cargos:[{cargo_id:'c1',monto:30000,monto_ajustado:30000,aplicado_neto:0,saldo_cargo:30000}],
 pago_aplicaciones:[],cargo_ajustes:[],...extra});
const orden='Haku, cancela el Tonel de Hernan Guzman, cab 8, del 13-09 a las 19:15.';
const diaActual='2026-09-23';

test('enruta cancela, anula y elimina de la agenda como cancelación lógica, incluso incompleta',()=>{
 for(const texto of ['Haku, cancela el Tonel de Pedro del 25-09.','anula la tinaja de la cab 6 del 12-09.',
  'elimina de la agenda el Jacuzzi de Pedro.','cancela el servicio']){
  assert.equal(C.interpretar(texto,{diaActual}).intencion,'CANCELAR_SERVICIO_EXISTENTE');
 }
 assert.equal(C.interpretar('cancela la reserva de Pedro'),null);
 assert.equal(C.interpretar('no canceles el Tonel de Pedro'),null);
 const incompleta=C.interpretar('cancela el servicio',{diaActual});
 assert.ok(incompleta.errores.length);
});
test('aliases, nombres sin tildes, CAB, fecha y hora opcional',async()=>{
 const q=C.interpretar(orden,{diaActual});
 assert.deepEqual([q.titular,q.cabana,q.fecha,q.hora,q.codigos_servicio],['Hernan Guzman',8,'2026-09-13','19:15',['tinajaTonel']]);
 for(const nombre of ['tonel','tinaja tonel','tonel de madera','tinaja de madera','tinaja tipo tonel'])
  assert.deepEqual(C.interpretar(`cancela ${nombre} de Pedro del 25-09`,{diaActual}).codigos_servicio,['tinajaTonel']);
 for(const nombre of ['jacuzzi','tinaja jacuzzi','tinaja tipo jacuzzi'])
  assert.deepEqual(C.interpretar(`anula ${nombre} de Paulina cab 3 del 04-09`,{diaActual}).codigos_servicio,['tinajaJacuzzi']);
 const cliente=clienteLectura(tablas());
 assert.equal((await A.buscarServicios(q,{cliente})).length,1);
 assert.equal((await A.buscarServicios(C.interpretar('anula la tinaja de la cab 8 del 13-09',{diaActual}),{cliente})).length,1);
 assert.equal((await A.buscarServicios(C.interpretar('cancela el Tonel de Hernan del 13-09',{diaActual}),{cliente})).length,1);
 assert.equal((await A.buscarServicios(C.interpretar('cancela el Tonel de Hernan a las 20:15',{diaActual}),{cliente})).length,0);
});
test('masajes, late checkout y cuna se identifican por código; cama sin código pide revisión',()=>{
 assert.deepEqual(C.interpretar('cancela el masaje de Laura del 19-09 a las 13:15',{diaActual}).codigos_servicio,
  ['masajeTerapeutico30','masajeTerapeutico60','masajeDescontracturante30','masajeDescontracturante60']);
 assert.deepEqual(C.interpretar('cancela el masaje descontracturante de Laura del 19-09',{diaActual}).codigos_servicio,
  ['masajeDescontracturante30','masajeDescontracturante60']);
 assert.deepEqual(C.interpretar('anula el late check-out de Pedro',{diaActual}).codigos_servicio,['lateCheckout']);
 assert.deepEqual(C.interpretar('anula la cuna de Pedro',{diaActual}).codigos_servicio,['cuna']);
 assert.equal(C.interpretar('cancela el masaje holístico de Laura',{diaActual}).subtipo,'holistico');
 assert.ok(C.interpretar('cancela la cama adicional de Laura',{diaActual}).errores.length);
});
test('búsqueda dinámica de masajes conserva todos los códigos y filtra subtipo sin elegir el primero',async()=>{
 const t=tablas({catalogo_servicios:[{id:'m1',codigo:'masajeDescontracturante60',nombre:'Masaje Descontracturante 60 min'},
  {id:'m2',codigo:'masajeRelajacion60',nombre:'Masaje Relajación 60 min'}],
  servicios:[servicio({id:'s1',catalogo_servicio_id:'m1',catalogo_servicios:{id:'m1',codigo:'masajeDescontracturante60',nombre:'Masaje Descontracturante 60 min'},hora_inicio:'12:15:00'}),
   servicio({id:'s2',catalogo_servicio_id:'m2',catalogo_servicios:{id:'m2',codigo:'masajeRelajacion60',nombre:'Masaje Relajación 60 min'},hora_inicio:'13:15:00'})]});
 const cliente=clienteLectura(t);
 const generico=C.interpretar('cancela el masaje de Hernan Guzman, cab 8, del 13-09',{diaActual});
 assert.equal((await C.buscarServicios(generico,{cliente})).length,2);
 assert.equal((await C.buscarServicios({...generico,hora:'13:15'},{cliente}))[0].id,'s2');
 const relajante=C.interpretar('cancela el masaje relajante de Hernan Guzman, cab 8, del 13-09',{diaActual});
 assert.equal((await C.buscarServicios(relajante,{cliente}))[0].id,'s2');
});
test('cero, uno y varios candidatos; cancelado no pide motivo',async()=>{
 const q=C.interpretar(orden,{diaActual}),cli=clienteLectura(tablas());
 const base={cliente:cli,permiso:()=>true,diaActual};
 assert.equal((await C.preparar(q,base)).estado,'propuesta');
 assert.equal((await C.preparar({...q,cabana:9},base)).estado,'no_encontrado');
 const t=tablas({servicios:[servicio(),servicio({id:'s2',hora_inicio:'20:15:00'})]});
 assert.equal((await C.preparar({...q,hora:null},{...base,cliente:clienteLectura(t)})).estado,'multiples');
 const masajes=tablas({catalogo_servicios:[{id:'m1',codigo:'masajeTerapeutico60',nombre:'Masaje Terapéutico'},
  {id:'m2',codigo:'masajeRelajacion60',nombre:'Masaje Relajación'}],servicios:[
  servicio({id:'m1s',catalogo_servicio_id:'m1',catalogo_servicios:{id:'m1',codigo:'masajeTerapeutico60',nombre:'Masaje Terapéutico'}}),
  servicio({id:'m2s',catalogo_servicio_id:'m2',catalogo_servicios:{id:'m2',codigo:'masajeRelajacion60',nombre:'Masaje Relajación'}})]});
 assert.equal((await C.preparar('cancela el masaje de Hernan Guzman, cab 8, del 13-09',
  {...base,cliente:clienteLectura(masajes)})).estado,'multiples');
 const ya=await C.preparar(q,{...base,cliente:clienteLectura(tablas({servicios:[servicio({estado_servicio:'cancelado'})]}))});
 assert.equal(ya.estado,'already_cancelled');assert.doesNotMatch(C.renderizar(ya),/textarea|Confirmar cancelación/);
});
test('política conservadora bloquea estados, checkout, BOVE, pagos, ajustes e incoherencias',()=>{
 for(const estado of ['realizado','no_show','en_proceso'])
  assert.equal(C.evaluarElegibilidad(candidato({estado_servicio:estado}),{finanzas:finanzas(),checkout:null}).estado,'bloqueada');
 for(const datos of [
  {c:candidato(),l:{finanzas:finanzas(),checkout:'2026-09-14T12:00:00+00:00'}},
  {c:{...candidato(),reserva:{...reserva,estado_reserva:'checked_out'}},l:{finanzas:finanzas(),checkout:null}},
  {c:{...candidato(),reserva:{...reserva,bove_checkout:{folio:'B1'}}},l:{finanzas:finanzas(),checkout:null}},
  {c:candidato(),l:{finanzas:finanzas({aplicaciones:[{id:'pa1'}]}),checkout:null}},
  {c:candidato(),l:{finanzas:finanzas({ajustes:[{id:'a1'}]}),checkout:null}},
  {c:candidato(),l:{finanzas:finanzas({estados:[{cargo_id:'c1',monto_ajustado:30000,aplicado_neto:10000,saldo_cargo:20000}]}),checkout:null}},
  {c:candidato(),l:{finanzas:finanzas({cargos:[{...cargo,reserva_id:'r2'}]}),checkout:null}}
 ])assert.equal(C.evaluarElegibilidad(datos.c,datos.l).estado,'bloqueada');
 const bloqueada={estado:'bloqueada',candidato:candidato(),elegibilidad:C.evaluarElegibilidad(candidato(),{finanzas:finanzas({aplicaciones:[{id:'pa1'}]}),checkout:null})};
 assert.match(C.renderizar(bloqueada),/Requiere revisión/);assert.doesNotMatch(C.renderizar(bloqueada),/data-servicio-cancelacion-confirmar/);
});
test('lee checkout de todas las estadías de la reserva y conserva el más reciente real',async()=>{
 const otro={...estadia,id:'e2',checkout_realizado_en:'2026-09-14T15:00:00-03:00'};
 const primero={...estadia,id:'e3',checkout_realizado_en:'2026-09-14T19:00:00+02:00'};
 const cliente=clienteLectura(tablas({reserva_estadias:[estadia,otro,primero]}));
 const lectura=await C.cargarEstado(candidato(),{cliente,cargarFinanzas:async()=>finanzas()});
 assert.equal(lectura.checkout,otro.checkout_realizado_en);
 assert.equal(C.evaluarElegibilidad(candidato(),lectura).estado,'bloqueada');
});
test('normal limpio y cortesía limpia muestran propuesta y snapshot exacto del RPC',async()=>{
 const q=C.interpretar(orden,{diaActual}),cliente=clienteLectura(tablas());
 const p=await C.preparar(q,{cliente,permiso:()=>true});
 assert.equal(p.estado,'propuesta');assert.equal(p.p_estado_esperado.cargo_activo_id,'c1');
 assert.equal(p.p_estado_esperado.cargo_saldo,30000);assert.equal(p.p_estado_esperado.cantidad_aplicaciones,0);
 assert.equal(p.p_estado_esperado.checkout_realizado_en,null);
 assert.deepEqual(p.p_estado_esperado.cargos,[cargo]);
 assert.match(C.renderizar(p),/Confirmar cancelación · simulación/);assert.match(C.renderizar(p),/Motivo de cancelación/);
 const c=candidato({tipo_cobro:'cortesia',total:0,motivo_cortesia:'Cortesía'});
 assert.equal(C.evaluarElegibilidad(c,{finanzas:finanzas({cargos:[],estados:[]}),checkout:null}).estado,'elegible');
 assert.match(C.renderizar({...p,candidato:c,p_estado_esperado:{...p.p_estado_esperado,cargo_saldo:null}}),/Sin cargo activo/);
});
test('motivo obligatorio, revalidación, idempotencia local y ausencia de escrituras',async()=>{
 const q=C.interpretar(orden,{diaActual}),cliente=clienteLectura(tablas());
 let n=0,rpc=0;
 cliente.rpc=()=>{rpc++;throw Error('RPC prohibido');};
 const buscar=async()=>{n++;return [candidato()];};
 const cargarFinanzas=async()=>finanzas();
 const p=await C.preparar(q,{cliente,permiso:()=>true,buscar,cargarFinanzas});
 assert.equal((await C.confirmar(p,'   ')).estado,'motivo_requerido');
 assert.equal(n,1);
 const [uno,dos]=await Promise.all([C.confirmar(p,'Huésped desistió',{operacionId:'op-1'}),C.confirmar(p,'Huésped desistió',{operacionId:'op-2'})]);
 assert.equal(uno.estado,'simulada');assert.strictEqual(uno,dos);assert.equal(n,2);
 assert.equal(uno.rpc,'haiku_cancelar_servicio_asistente_v1');
 assert.equal(uno.parametros.p_operacion_id,'op-1');assert.equal(uno.parametros.p_motivo,'Huésped desistió');
 assert.deepEqual(uno.parametros.p_estado_esperado,p.p_estado_esperado);
 assert.strictEqual(await C.confirmar(p,'Otro motivo'),uno);
 assert.equal(rpc,0);assert.equal(C.RPC_CANCELACION_PRODUCCION_HABILITADO,false);
 const p2=await C.preparar(q,{cliente,permiso:()=>true,buscar,cargarFinanzas});
 assert.equal((await C.confirmar(p2,'Nuevo',{operacionId:'op-3'})).parametros.p_operacion_id,'op-3');
 let cambio=false;
 const buscarCambio=async()=>[candidato(cambio?{actualizado_en:'nuevo'}:{})];
 const p3=await C.preparar(q,{cliente,permiso:()=>true,buscar:buscarCambio,cargarFinanzas});
 cambio=true;
 const obsoleta=await C.confirmar(p3,'Motivo',{operacionId:'op-4'});
 assert.equal(obsoleta.estado,'obsoleta');assert.notEqual(obsoleta.nueva.estado,'simulada');
 assert.equal(rpc,0);
});
test('módulo de cancelación no contiene ruta de escritura y carga después de la autoridad',()=>{
 const js=fs.readFileSync(require.resolve('../js/supabase-asistente-servicios-cancelacion-v1.js'),'utf8');
 assert.doesNotMatch(js,/\.rpc\s*\(|\.(?:update|insert|delete|upsert)\s*\(/);
 const html=fs.readFileSync(require('node:path').join(__dirname,'../panel.html'),'utf8');
 assert.ok(html.indexOf("'supabase-asistente-servicios-cortesia-v1','supabase-asistente-servicios-cancelacion-v1'")>0);
});
