const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../js/supabase-asistente-servicios-cancelacion-v1.js');

const ID='00000000-0000-4000-8000-000000000051';
const ORDEN='Haku, cancela el Tonel de Sebastian Gatta, cab 1, del 25-09-2026 a las 22:15.';
const clonar=x=>JSON.parse(JSON.stringify(x));
function arnes(){
 let s={id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cs1',recurso_id:'rec1',
  fecha_servicio:'2026-09-25',hora_inicio:'22:15:00',hora_fin:'23:15:00',cantidad:1,personas:2,
  precio_unitario_aplicado:30000,monto_adicional:0,total:30000,tipo_cobro:'normal',motivo_cortesia:null,
  motivo_ajuste_precio:null,estado_servicio:'programado',cancelado_en:null,cancelado_por:null,motivo_cancelacion:null,
  actualizado_en:'2026-09-23T10:00:00+00:00',
  reserva:{id:'r1',titular_nombre:'Sebastian Gatta',estado_reserva:'confirmada',bove_checkout:null,actualizado_en:'2026-09-23T10:00:00+00:00'},
  estadia:{id:'e1',reserva_id:'r1',cabana_id:'cab1'},cabana_numero:1,
  catalogo:{id:'cs1',codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera'}};
 let f={cargos:[{id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,
  monto:30000,estado:'activo',actualizado_en:'2026-09-23T10:00:00+00:00'}],
  estados:[{cargo_id:'c1',monto:30000,monto_ajustado:30000,aplicado_neto:0,saldo_cargo:30000,estado:'activo'}],
  aplicaciones:[],ajustes:[]};
 const estadias=[{id:'e1',reserva_id:'r1',checkout_realizado_en:null}];
 const pagos=[{id:'p1',reserva_id:'r1',monto:10000,estado:'confirmado'}],eventos=[],llamadas=[];
 let fallaLectura=false;
 const tablas={reserva_estadias:estadias,pagos,eventos_auditoria:eventos};
 const cliente={from(tabla){
  const filtros=[];
  const b={select(){return b;},eq(campo,valor){filtros.push(x=>x[campo]===valor);return b;},order(){return b;},
   async range(desde,hasta){if(fallaLectura)throw Error('Lectura no disponible');
    return {data:(tablas[tabla]||[]).filter(x=>filtros.every(fn=>fn(x))).slice(desde,hasta+1),error:null};}};
  return b;
 }};
 const h={cliente,llamadas,estadias,pagos,eventos,
  buscar:async()=>{if(fallaLectura)throw Error('Lectura no disponible');return [clonar(s)];},
  cargarFinanzas:async()=>{if(fallaLectura)throw Error('Lectura no disponible');return clonar(f);},
  cambiar(payload,{auditoria=true}={}){
   s={...s,estado_servicio:'cancelado',cancelado_en:'2026-09-23T11:00:00+00:00',cancelado_por:'u1',
    motivo_cancelacion:payload.p_motivo,actualizado_en:'2026-09-23T11:00:00+00:00'};
   f.cargos[0]={...f.cargos[0],estado:'anulado',actualizado_en:'2026-09-23T11:00:00+00:00'};
   f.estados[0]={...f.estados[0],estado:'anulado'};
   if(auditoria)eventos.push({id:'ev1',entidad_tipo:'servicios',entidad_id:'s1',reserva_id:'r1',usuario_id:'u1',origen:'haku',
    datos_contexto:{operacion_id:payload.p_operacion_id},cambios:[
     {campo:'estado_servicio',anterior:'programado',nuevo:'cancelado'},
     {campo:'motivo_cancelacion',anterior:null,nuevo:payload.p_motivo}]});
  },
  mutarServicio(x){s={...s,...x};},mutarFinanzas(x){f={...f,...x};},fallarLectura(v){fallaLectura=v;},
  async preparar(){return C.preparar(ORDEN,{diaActual:'2026-09-23',cliente,permiso:()=>true,buscar:h.buscar,cargarFinanzas:h.cargarFinanzas});},
  confirmar(p,motivo='Huésped desistió'){return C.confirmar(p,motivo,{operacionId:ID});}
 };
 cliente.rpc=async(nombre,payload)=>{llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload);
  return {data:{ok:true,estado:'cancelled',operacion_id:payload.p_operacion_id,servicio_id:'s1',motivo:payload.p_motivo,
   total_original:30000,cargo_anulado_id:'c1',cargos_historicos:1},error:null};};
 return h;
}

test('vista real exige motivo; un solo RPC y payload exacto; acredita servicio, cargo, pagos y auditoría',async()=>{
 const h=arnes(),p=await h.preparar(),vista=C.renderizar(p);
 for(const x of ['Sebastian Gatta · CAB 1','Tinaja Tonel de Madera','25-09-2026 · 22:15–23:15',
  'Programado','Cobro normal · $30.000','Cancelado','Cargo pendiente $30.000','El monto histórico se conservará.',
  'Motivo de cancelación','Confirmar cancelación','Al confirmar, Proyecto H cancelará'])assert.ok(vista.includes(x),x);
 assert.doesNotMatch(vista,/simulación|RPC no será ejecutado/i);
 assert.equal(h.llamadas.length,0);
 assert.equal((await h.confirmar(p,'   ')).estado,'motivo_requerido');assert.equal(h.llamadas.length,0);
 const anteriorDoc=globalThis.document,anteriorEvento=globalThis.CustomEvent,eventos=[];
 globalThis.document={dispatchEvent:e=>eventos.push(e)};
 globalThis.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options.detail;}};
 try{
  const r=await h.confirmar(p,'Huésped desistió');
  assert.equal(r.estado,'realizado');assert.equal(h.llamadas.length,1);
  assert.equal(h.llamadas[0].nombre,'haiku_cancelar_servicio_asistente_v1');
  assert.deepEqual(Object.keys(h.llamadas[0].payload).sort(),['p_estado_esperado','p_motivo','p_operacion_id','p_servicio_id']);
  assert.deepEqual(h.llamadas[0].payload.p_estado_esperado,p.p_estado_esperado);
  assert.equal(h.llamadas[0].payload.p_operacion_id,ID);
  assert.equal(r.candidato.cancelado_por,'u1');assert.equal(r.cargo_anterior.monto,30000);
  assert.match(C.renderizar(r),/✓ Servicio cancelado/);assert.match(C.renderizar(r),/Sin cobro pendiente activo/);
  assert.equal(eventos.length,1);assert.equal(eventos[0].type,'haiku:servicio-supabase-cambiado');
  assert.deepEqual(eventos[0].detail,{servicioId:'s1',reservaId:'r1'});
 }finally{if(anteriorDoc===undefined)delete globalThis.document;else globalThis.document=anteriorDoc;
  if(anteriorEvento===undefined)delete globalThis.CustomEvent;else globalThis.CustomEvent=anteriorEvento;}
});
test('doble clic comparte promesa y operation_id; una sola escritura',async()=>{
 const h=arnes(),p=await h.preparar();let liberar;
 const espera=new Promise(resolve=>{liberar=resolve;});
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});await espera;h.cambiar(payload);
  return {data:{ok:true,estado:'cancelled',operacion_id:ID,servicio_id:'s1',motivo:payload.p_motivo,total_original:30000,cargo_anulado_id:'c1'}};};
 const uno=h.confirmar(p),dos=h.confirmar(p);assert.strictEqual(uno,dos);liberar();
 assert.equal((await uno).estado,'realizado');assert.equal((await dos).estado,'realizado');assert.equal(h.llamadas.length,1);
});
test('respuesta perdida tras commit se acredita por relectura sin segundo RPC',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload);throw Error('NetworkError');};
 const r=await h.confirmar(p);assert.equal(r.estado,'realizado');assert.equal(r.origen,'relectura');assert.equal(h.llamadas.length,1);
});
test('error incierto permite reintento sólo tras leer estado anterior, con payload idéntico',async()=>{
 const h=arnes(),p=await h.preparar();let intento=0;
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});if(++intento===1)throw Error('NetworkError');
  h.cambiar(payload);return {data:{ok:true,estado:'cancelled',operacion_id:ID,servicio_id:'s1',motivo:payload.p_motivo,total_original:30000,cargo_anulado_id:'c1'}};};
 assert.equal((await h.confirmar(p)).estado,'reintento_seguro');assert.equal(h.llamadas.length,1);
 assert.equal((await h.confirmar(p,'Otro motivo')).estado,'bloqueada');assert.equal(h.llamadas.length,1);
 assert.equal((await h.confirmar(p)).estado,'realizado');assert.equal(h.llamadas.length,2);
 assert.deepEqual(h.llamadas[1].payload,h.llamadas[0].payload);
});
test('lectura incierta bloquea reenvío hasta poder comprobar estado',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});h.fallarLectura(true);throw Error('NetworkError');};
 assert.equal((await h.confirmar(p)).estado,'incierto');assert.equal(h.llamadas.length,1);
 assert.equal((await C.verificarEstado(p)).estado,'incierto');assert.equal(h.llamadas.length,1);
 h.fallarLectura(false);assert.equal((await C.verificarEstado(p)).estado,'reintento_seguro');assert.equal(h.llamadas.length,1);
});
test('stale antes o durante RPC reconstruye propuesta sin segundo envío',async()=>{
 const h=arnes(),p=await h.preparar();h.mutarServicio({actualizado_en:'2026-09-23T10:01:00+00:00'});
 assert.equal((await h.confirmar(p)).estado,'obsoleta');assert.equal(h.llamadas.length,0);
 const p2=await h.preparar();h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});
  return {error:{code:'40001',message:'La propuesta quedó obsoleta'}};};
 const r=await h.confirmar(p2);assert.equal(r.estado,'obsoleta');assert.equal(h.llamadas.length,1);
 assert.equal(r.nueva.estado,'propuesta');
});
test('already_cancelled, permisos e historial financiero no se presentan como éxito ni repiten RPC',async()=>{
 for(const [respuesta,estado] of [
  [{data:{ok:true,estado:'already_cancelled',servicio_id:'s1'}},'already_cancelled'],
  [{error:{code:'42501',message:'Sin permiso'}},'sin_permiso'],
  [{error:{message:'El servicio tiene aplicaciones de pago históricas'}},'revision_humana']]){
  const h=arnes(),p=await h.preparar();h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});return respuesta;};
  const r=await h.confirmar(p);assert.equal(r.estado,estado);assert.equal(h.llamadas.length,1);
  assert.doesNotMatch(C.renderizar(r),/data-servicio-cancelacion-confirmar/);
 }
});
test('respuesta exitosa con lectura retrasada sólo relee; auditoría ausente no acredita éxito',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});return {data:{ok:true,estado:'cancelled',
  operacion_id:ID,servicio_id:'s1',motivo:payload.p_motivo,total_original:30000,cargo_anulado_id:'c1'}};};
 assert.equal((await h.confirmar(p)).estado,'sincronizando');assert.equal(h.llamadas.length,1);
 assert.equal((await C.verificarEstado(p)).estado,'sincronizando');assert.equal(h.llamadas.length,1);
 h.cambiar(h.llamadas[0].payload,{auditoria:false});
 assert.equal((await C.verificarEstado(p)).estado,'sincronizando');assert.equal(h.llamadas.length,1);
});
test('lectura retrasada acredita después el éxito sin reenviar RPC',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});return {data:{ok:true,estado:'cancelled',
  operacion_id:ID,servicio_id:'s1',motivo:payload.p_motivo,total_original:30000,cargo_anulado_id:'c1'}};};
 assert.equal((await h.confirmar(p)).estado,'sincronizando');
 h.cambiar(h.llamadas[0].payload);
 assert.equal((await C.verificarEstado(p)).estado,'realizado');assert.equal(h.llamadas.length,1);
});
test('cortesía limpia se cancela sin cargo activo ni cobro nuevo',async()=>{
 const h=arnes();h.mutarServicio({tipo_cobro:'cortesia',total:0,motivo_cortesia:'Cortesía autorizada'});
 h.mutarFinanzas({cargos:[],estados:[]});
 const p=await h.preparar();assert.equal(p.estado,'propuesta');assert.match(C.renderizar(p),/Sin cargo activo/);
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});
  h.mutarServicio({estado_servicio:'cancelado',cancelado_en:'2026-09-23T11:00:00+00:00',cancelado_por:'u1',
   motivo_cancelacion:payload.p_motivo,actualizado_en:'2026-09-23T11:00:00+00:00'});
  h.eventos.push({id:'ev1',entidad_tipo:'servicios',entidad_id:'s1',reserva_id:'r1',usuario_id:'u1',origen:'haku',
   datos_contexto:{operacion_id:ID},cambios:[{campo:'estado_servicio',anterior:'programado',nuevo:'cancelado'},
    {campo:'motivo_cancelacion',anterior:null,nuevo:payload.p_motivo}]});
  return {data:{ok:true,estado:'cancelled',operacion_id:ID,servicio_id:'s1',motivo:payload.p_motivo,
   total_original:0,cargo_anulado_id:null,cargos_historicos:0}};};
 const r=await h.confirmar(p);assert.equal(r.estado,'realizado');assert.equal(r.cargo_anterior,null);
 assert.match(C.renderizar(r),/Sin cargo activo ni cobro pendiente/);assert.equal(h.llamadas.length,1);
});
test('pagos cambiados o cargo sin anular impiden acreditar éxito',async()=>{
 for(const alterar of [h=>h.pagos.push({id:'p2',reserva_id:'r1',monto:1000}),h=>h.mutarFinanzas({cargos:[{id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,monto:30000,estado:'activo'}]})]){
  const h=arnes(),p=await h.preparar();
  h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload);alterar(h);
   return {data:{ok:true,estado:'cancelled',operacion_id:ID,servicio_id:'s1',motivo:payload.p_motivo,total_original:30000,cargo_anulado_id:'c1'}};};
  const r=await h.confirmar(p);assert.notEqual(r.estado,'realizado');assert.equal(h.llamadas.length,1);
 }
});
