const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../js/supabase-asistente-servicios-cortesia-v1.js');

const OPERACION='00000000-0000-4000-8000-000000000001';
const ORDEN='Haku, cambia a cortesía la Tinaja Tonel de Madera de Luis Ortiz, cab 10, del 12-09-2026 a las 20:45.';
const clonar=x=>JSON.parse(JSON.stringify(x));

function arnes(){
 let s={id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cs1',recurso_id:'rec1',
  fecha_servicio:'2026-09-12',hora_inicio:'20:45:00',hora_fin:'21:45:00',cantidad:1,personas:2,
  precio_unitario_aplicado:30000,monto_adicional:0,total:30000,tipo_cobro:'normal',motivo_cortesia:null,
  estado_servicio:'programado',actualizado_en:'2026-09-20T10:00:00.000Z',
  reserva:{id:'r1',titular_nombre:'Luis Ortiz',estado_reserva:'checked_out',bove_checkout:null},
  estadia:{id:'e1',cabana_id:'cab10'},cabana_numero:10,
  catalogo:{id:'cs1',codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera',activo:true,permite_cortesia:true}};
 let f={cargos:[{id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,monto:30000,estado:'activo',actualizado_en:'2026-09-20T10:00:01.000Z'}],
  estados:[{cargo_id:'c1',monto:30000,monto_ajustado:30000,aplicado_neto:0,saldo_cargo:30000,estado:'activo',estado_pago:'pendiente'}],aplicaciones:[],ajustes:[]};
 const llamadas=[];
 const cliente={__hakuCortesiaMock:true,async rpc(nombre,payload){llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload.p_motivo);return {data:{ok:true,estado:'changed_to_courtesy',servicio_id:'s1',cargo_id:'c1',cargo_monto_historico:30000},error:null};}};
 const h={cliente,llamadas,buscar:async()=>[clonar(s)],cargarFinanzas:async()=>clonar(f),
  cambiar(motivo){s={...s,tipo_cobro:'cortesia',total:0,monto_adicional:0,motivo_cortesia:motivo,actualizado_en:'2026-09-22T11:00:00.000Z'};
   f.cargos[0].estado='anulado';f.estados[0]={...f.estados[0],estado:'anulado',estado_pago:'anulado',saldo_cargo:30000};},
  mutarServicio(cambios){s={...s,...cambios};},mutarFinanzas(cambios){f={...f,...cambios};},
  async preparar(){return A.preparar(ORDEN,{diaActual:'2026-09-22',cliente,permiso:()=>true,buscar:h.buscar,cargarFinanzas:h.cargarFinanzas});},
  confirmar(p,motivo='Cortesía autorizada'){return A.confirmar(p,motivo,{modoPruebaLocal:true,operacionId:OPERACION});}
 };
 return h;
}

test('vista previa real exige motivo y confirma sólo al llamar el RPC autorizado',async()=>{
 const h=arnes(),p=await h.preparar();
 const vista=A.renderizar(p);
 for(const texto of ['Luis Ortiz · CAB 10','Tinaja Tonel de Madera','12-09-2026 · 20:45–21:45','Antes','Normal · $30.000','Cargo pendiente · $30.000','Después','Cortesía · $0','Cargo activo será anulado','Esta reserva ya realizó check-out.','Motivo:','Al confirmar, Proyecto H cambiará el servicio','data-servicio-cortesia-confirmar disabled>Confirmar cambio'])assert.ok(vista.includes(texto),texto);
 assert.doesNotMatch(vista,/simulación|RPC no será ejecutado|Ejecución remota deshabilitada/i);
 assert.equal(h.llamadas.length,0);
 const sinMotivo=await A.confirmar(p,'   ',{operacionId:OPERACION});
 assert.equal(sinMotivo.estado,'bloqueada');assert.equal(h.llamadas.length,0);
 const r=await A.confirmar(p,'Cortesía autorizada',{operacionId:OPERACION});
 assert.equal(r.estado,'realizado');assert.equal(h.llamadas.length,1);
 assert.equal(h.llamadas[0].nombre,'haiku_cambiar_servicio_a_cortesia_v1');
});

test('revalida, envía sólo el RPC y acredita servicio y cargo mediante relectura',async()=>{
 const h=arnes(),p=await h.preparar(),estados=[];
 const r=await A.confirmar(p,' Cortesía autorizada ',{modoPruebaLocal:true,operacionId:OPERACION,onEstado:x=>estados.push(x)});
 assert.equal(r.estado,'realizado');assert.deepEqual(estados,['Verificando nuevamente…','Aplicando cambio…']);
 assert.equal(h.llamadas.length,1);assert.equal(h.llamadas[0].nombre,'haiku_cambiar_servicio_a_cortesia_v1');
 assert.deepEqual(Object.keys(h.llamadas[0].payload).sort(),['p_estado_esperado','p_motivo','p_operacion_id','p_servicio_id']);
 assert.deepEqual(h.llamadas[0].payload.p_estado_esperado,p.p_estado_esperado);
 assert.match(A.renderizar(r),/Cambio realizado/);assert.match(A.renderizar(r),/No existe cobro pendiente activo/);
 assert.equal((await A.verificarEstado(p)).estado,'realizado');assert.equal(h.llamadas.length,1);
});

test('doble confirmación comparte promesa y operation_id; no duplica la escritura',async()=>{
 const h=arnes(),p=await h.preparar();let liberar;
 const espera=new Promise(resolve=>{liberar=resolve;});
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});await espera;h.cambiar(payload.p_motivo);return {data:{ok:true,estado:'changed_to_courtesy',servicio_id:'s1',cargo_id:'c1',cargo_monto_historico:30000}};};
 const uno=h.confirmar(p),dos=h.confirmar(p);assert.equal(uno,dos);liberar();
 assert.equal((await uno).estado,'realizado');assert.equal((await dos).estado,'realizado');
 assert.equal(h.llamadas.length,1);assert.equal(h.llamadas[0].payload.p_operacion_id,OPERACION);
});

test('respuesta perdida después de commit se acredita por lectura sin reenviar',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload.p_motivo);throw Error('NetworkError: respuesta perdida');};
 const r=await h.confirmar(p);
 assert.equal(r.estado,'realizado');assert.equal(r.origen,'relectura');assert.equal(h.llamadas.length,1);
});

test('red incierta con servicio intacto permite sólo reintento idéntico',async()=>{
 const h=arnes(),p=await h.preparar();let intento=0;
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});if(++intento===1)throw Error('NetworkError');h.cambiar(payload.p_motivo);return {data:{ok:true,estado:'changed_to_courtesy',servicio_id:'s1',cargo_id:'c1',cargo_monto_historico:30000}};};
 const primero=await h.confirmar(p);assert.equal(primero.estado,'reintento_seguro');
 const segundo=await h.confirmar(p);assert.equal(segundo.estado,'realizado');
 assert.equal(h.llamadas.length,2);assert.deepEqual(h.llamadas[1].payload,h.llamadas[0].payload);
});

test('error de red y lectura fallida mantienen el estado incierto hasta nueva consulta',async()=>{
 const h=arnes();let fallarLectura=false,invocaciones=0;
 const buscar=h.buscar;h.buscar=async(...args)=>{if(fallarLectura)throw Error('Lectura no disponible');return buscar(...args);};
 const p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});if(++invocaciones===1){fallarLectura=true;throw Error('NetworkError');}h.cambiar(payload.p_motivo);return {data:{ok:true,estado:'changed_to_courtesy',servicio_id:'s1',cargo_id:'c1',cargo_monto_historico:30000}};};
 assert.equal((await h.confirmar(p)).estado,'incierto');assert.equal(h.llamadas.length,1);
 fallarLectura=false;assert.equal((await A.verificarEstado(p)).estado,'reintento_seguro');
 assert.equal((await h.confirmar(p)).estado,'realizado');assert.deepEqual(h.llamadas[1].payload,h.llamadas[0].payload);
});

test('cambio entre propuesta y confirmación invalida y reconstruye sin RPC',async()=>{
 const h=arnes(),p=await h.preparar();
 h.mutarServicio({actualizado_en:'2026-09-22T11:01:00.000Z'});
 const r=await h.confirmar(p);assert.equal(r.estado,'obsoleta');assert.equal(r.nueva.estado,'propuesta');
 assert.equal(h.llamadas.length,0);assert.notEqual(r.nueva,p);
});

test('cambio de catálogo relevante invalida aunque el snapshot RPC no lo incluya',async()=>{
 const h=arnes(),p=await h.preparar();
 h.mutarServicio({catalogo:{...p.candidato.catalogo,nombre:'Nuevo nombre'}});
 const r=await h.confirmar(p);assert.equal(r.estado,'obsoleta');assert.equal(h.llamadas.length,0);
});

test('already courtesy, permiso y rechazos financieros no se convierten en éxito',async()=>{
 for(const [respuesta,esperado] of [
  [{data:{ok:true,estado:'already_courtesy',servicio_id:'s1'}},'already_courtesy'],
  [{error:{code:'42501',message:'Tu usuario no tiene permiso'}},'sin_permiso'],
  [{error:{message:'El servicio tiene aplicaciones de pago históricas; requiere revisión humana'}},'revision_humana'],
  [{error:{message:'El servicio tiene ajustes históricos; requiere revisión humana'}},'revision_humana'],
  [{error:{message:'El cargo activo no coincide con el servicio; requiere revisión humana'}},'revision_humana']]){
  const h=arnes(),p=await h.preparar();h.cliente.rpc=async()=>{h.llamadas.push(1);return respuesta;};
  const r=await h.confirmar(p);assert.equal(r.estado,esperado);assert.equal(h.llamadas.length,1);
  if(esperado==='already_courtesy')assert.doesNotMatch(A.renderizar(r),/Confirmar cambio/);
 }
});

test('respuesta stale del RPC invalida la tarjeta y reconstruye sin otro envío',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async()=>{h.llamadas.push(1);h.mutarServicio({actualizado_en:'2026-09-22T12:00:00.000Z'});return {error:{code:'40001',message:'La propuesta quedó obsoleta'}};};
 const r=await h.confirmar(p);assert.equal(r.estado,'obsoleta');assert.equal(r.nueva.estado,'propuesta');assert.equal(h.llamadas.length,1);
});

test('éxito verificado emite el refresh existente de servicios y finanzas',async()=>{
 const h=arnes(),p=await h.preparar(),eventos=[];
 const rpc=h.cliente.rpc,documentoAnterior=globalThis.document,eventoAnterior=globalThis.CustomEvent;
 h.cliente.rpc=async(...args)=>{const resultado=await rpc(...args);globalThis.document={dispatchEvent:e=>eventos.push(e)};globalThis.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options.detail;}};return resultado;};
 try{
  assert.equal((await h.confirmar(p)).estado,'realizado');
  assert.equal(eventos.length,1);assert.equal(eventos[0].type,'haiku:servicio-supabase-cambiado');
  assert.deepEqual(eventos[0].detail,{servicioId:'s1',reservaId:'r1'});
 }finally{if(documentoAnterior===undefined)delete globalThis.document;else globalThis.document=documentoAnterior;
  if(eventoAnterior===undefined)delete globalThis.CustomEvent;else globalThis.CustomEvent=eventoAnterior;}
});

test('éxito RPC con lectura rezagada sólo reintenta lecturas',async()=>{
 const h=arnes(),p=await h.preparar();h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});return {data:{ok:true,estado:'changed_to_courtesy',servicio_id:'s1',cargo_id:'c1',cargo_monto_historico:30000}};};
 const r=await h.confirmar(p);assert.equal(r.estado,'sincronizando');assert.equal(h.llamadas.length,1);
 assert.equal((await A.verificarEstado(p)).estado,'sincronizando');assert.equal(h.llamadas.length,1);
 h.cambiar('Cortesía autorizada');assert.equal((await A.verificarEstado(p)).estado,'realizado');
});

test('finanzas históricas nuevas antes de confirmar bloquean sin RPC',async()=>{
 const h=arnes(),p=await h.preparar();h.mutarFinanzas({aplicaciones:[{id:'a1',cargo_id:'c1'}]});
 const r=await h.confirmar(p);assert.equal(r.estado,'obsoleta');assert.equal(r.nueva.estado,'bloqueada');assert.equal(h.llamadas.length,0);
});
