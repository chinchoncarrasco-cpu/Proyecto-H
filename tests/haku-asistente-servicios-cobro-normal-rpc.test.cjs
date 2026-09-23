const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../js/supabase-asistente-servicios-cortesia-v1.js');

const OPERACION='d9042e70-2ac6-41f8-9f07-65f16bdcc77b';
const clonar=v=>JSON.parse(JSON.stringify(v));
const reserva={id:'r1',titular_nombre:'Nestor Gelvez',estado_reserva:'checked_out',bove_checkout:null};
const catalogo={id:'cat1',codigo:'tinajaJacuzzi',nombre:'Tinaja Jacuzzi',activo:true,permite_cortesia:true,unidad:'hora',precio_base:30000,capacidad_incluida:3,capacidad_maxima:5,precio_persona_adicional:10000};
const inicial={id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cat1',recurso_id:'re1',fecha_servicio:'2026-09-13',hora_inicio:'22:15:00',hora_fin:'23:15:00',cantidad:1,personas:2,precio_unitario_aplicado:30000,monto_adicional:0,total:0,tipo_cobro:'cortesia',motivo_cortesia:'Cortesía',motivo_ajuste_precio:null,estado_servicio:'programado',actualizado_en:'2026-09-22T12:00:00Z',reserva,estadia:{id:'e1'},catalogo,cabana_numero:4};
const orden='Haku, pasa el Jacuzzi de Nestor Gelvez, cab 4, del 13-09 a cobro normal para 4 personas.';

function arnes(extra={}){
 let actual=clonar(inicial),finanzas={cargos:[],estados:[],aplicaciones:[],ajustes:[]};
 const llamadas=[],eventos=[];
 const h={llamadas,eventos,get actual(){return clonar(actual);},get finanzas(){return clonar(finanzas);},
  mutarServicio(cambio){actual={...actual,...cambio};},mutarFinanzas(cambio){finanzas={...finanzas,...cambio};},
  cambiar(payload){
   actual={...actual,tipo_cobro:'normal',personas:payload.p_personas,total:40000,
    precio_unitario_aplicado:30000,monto_adicional:10000,motivo_cortesia:null,motivo_ajuste_precio:null,
    actualizado_en:'2026-09-22T12:01:00Z'};
   finanzas={...finanzas,cargos:[{id:'c2',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,monto:40000,estado:'activo'}],
    estados:[{cargo_id:'c2',monto_ajustado:40000,aplicado_neto:0,saldo_cargo:40000,estado:'activo'}]};
  },
  buscar:async()=>[clonar(actual)],cargar:async()=>clonar(finanzas),
  cliente:{rpc:async(nombre,payload)=>{
   llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload);
   return {data:{ok:true,estado:'changed_to_normal',servicio_id:'s1',personas:4,total:40000,cargo_estado:'activo',cargo_id:'c2'}};
  }},
  async preparar(){return A.preparar(orden,{diaActual:'2026-09-22',cliente:h.cliente,buscar:h.buscar,cargarFinanzas:h.cargar,permiso:extra.permiso||(()=>true)});},
  confirmar(p,opts={}){return A.confirmarCobro(p,{operacionId:OPERACION,...opts});}
 };
 return h;
}

test('confirmación real usa un solo RPC, payload esperado, verifica cargo nuevo y mantiene idempotencia',async()=>{
 const h=arnes(),p=await h.preparar();
 assert.equal(p.estado,'propuesta');assert.equal(h.llamadas.length,0);
 const r=await h.confirmar(p);
 assert.equal(r.estado,'realizado');assert.equal(r.total,40000);assert.equal(r.cargo_nuevo.id,'c2');
 assert.equal(h.llamadas.length,1);assert.equal(h.llamadas[0].nombre,'haiku_cambiar_servicio_a_cobro_normal_v1');
 assert.deepEqual(Object.keys(h.llamadas[0].payload),['p_operacion_id','p_servicio_id','p_personas','p_estado_esperado']);
 assert.equal(h.llamadas[0].payload.p_operacion_id,OPERACION);assert.equal(h.llamadas[0].payload.p_personas,4);
 assert.deepEqual(h.llamadas[0].payload.p_estado_esperado,p.p_estado_esperado);
 assert.match(A.renderizar(r),/Nuevo cargo activo/);
 assert.equal((await h.confirmar(p)).estado,'realizado');assert.equal(h.llamadas.length,1);
});

test('dos clics comparten promesa y ejecutan una sola vez',async()=>{
 const h=arnes(),p=await h.preparar();let liberar;
 const espera=new Promise(r=>{liberar=r;});
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});await espera;h.cambiar(payload);return {data:{ok:true,estado:'changed_to_normal',servicio_id:'s1',personas:4,total:40000,cargo_estado:'activo',cargo_id:'c2'}};};
 const a=h.confirmar(p),b=h.confirmar(p);assert.equal(a,b);liberar();
 assert.equal((await a).estado,'realizado');assert.equal(h.llamadas.length,1);
});

test('respuesta de red perdida tras la escritura se acredita sólo por relectura',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload);throw Error('NetworkError');};
 const r=await h.confirmar(p);assert.equal(r.estado,'realizado');assert.equal(r.origen,'relectura');assert.equal(h.llamadas.length,1);
});

test('error incierto con servicio intacto sólo permite reintentar el mismo operation_id',async()=>{
 const h=arnes(),p=await h.preparar();let intentos=0;
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});if(++intentos===1)throw Error('NetworkError');h.cambiar(payload);return {data:{ok:true,estado:'changed_to_normal',servicio_id:'s1',personas:4,total:40000,cargo_estado:'activo',cargo_id:'c2'}};};
 const primero=await h.confirmar(p);assert.equal(primero.estado,'reintento_seguro');assert.match(A.renderizar(primero),/Reintentar misma operación/);
 const segundo=await h.confirmar(p);assert.equal(segundo.estado,'realizado');assert.equal(h.llamadas.length,2);
 assert.deepEqual(h.llamadas[1].payload,h.llamadas[0].payload);
});

test('sin lectura tras error de red queda incierto hasta comprobar de nuevo',async()=>{
 const h=arnes();let lecturaFallida=false;
 h.buscar=async()=>{if(lecturaFallida)throw Error('Lectura no disponible');return [h.actual];};
 const p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});lecturaFallida=true;throw Error('NetworkError');};
 const r=await h.confirmar(p);assert.equal(r.estado,'incierto');assert.equal(h.llamadas.length,1);
 lecturaFallida=false;
 assert.equal((await A.verificarEstadoCobro(p)).estado,'reintento_seguro');assert.equal(h.llamadas.length,1);
});

test('rechazo stale del RPC reconstruye la propuesta sin segundo envío',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});
  h.mutarServicio({actualizado_en:'2026-09-22T12:05:00Z'});
  return {error:{code:'40001',message:'La propuesta quedó obsoleta'}};};
 const r=await h.confirmar(p);assert.equal(r.estado,'obsoleta');assert.equal(r.nueva.estado,'propuesta');assert.equal(h.llamadas.length,1);
});

test('pago nuevo, catálogo cambiado y permiso revocado detienen antes de escribir',async()=>{
 const h=arnes(),p=await h.preparar();
 h.mutarFinanzas({aplicaciones:[{id:'a1',cargo_id:'c0'}]});
 const r=await h.confirmar(p);assert.equal(r.estado,'obsoleta');assert.equal(r.nueva.estado,'bloqueada');assert.equal(h.llamadas.length,0);
 const j=arnes(),p2=await j.preparar();j.mutarServicio({catalogo:{...catalogo,precio_base:40000}});
 assert.equal((await j.confirmar(p2)).estado,'obsoleta');assert.equal(j.llamadas.length,0);
 let permiso=true;const k=arnes({permiso:()=>permiso}),p3=await k.preparar();permiso=false;
 assert.equal((await k.confirmar(p3)).estado,'sin_permiso');assert.equal(k.llamadas.length,0);
});

test('already_normal se acredita mediante lectura y nunca provoca una segunda escritura',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload);return {data:{ok:true,estado:'already_normal',servicio_id:'s1'}};};
 const r=await h.confirmar(p);assert.equal(r.estado,'realizado');assert.equal(h.llamadas.length,1);
 assert.equal((await A.verificarEstadoCobro(p)).estado,'realizado');assert.equal(h.llamadas.length,1);
});

test('already_normal con lectura rezagada no ofrece reintentar la escritura',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});return {data:{ok:true,estado:'already_normal',servicio_id:'s1'}};};
 const r=await h.confirmar(p);
 assert.equal(r.estado,'sincronizando');assert.equal(h.llamadas.length,1);
 assert.equal((await A.verificarEstadoCobro(p)).estado,'sincronizando');
 assert.equal((await h.confirmar(p)).estado,'sincronizando');assert.equal(h.llamadas.length,1);
});

test('respuesta exitosa sin lectura visible sólo relee, sin reenviar el RPC',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});return {data:{ok:true,estado:'changed_to_normal',servicio_id:'s1',personas:4,total:40000,cargo_estado:'activo',cargo_id:'c2'}};};
 const r=await h.confirmar(p);assert.equal(r.estado,'sincronizando');assert.equal(h.llamadas.length,1);
 assert.equal((await A.verificarEstadoCobro(p)).estado,'sincronizando');assert.equal(h.llamadas.length,1);
 h.cambiar(h.llamadas[0].payload);assert.equal((await A.verificarEstadoCobro(p)).estado,'realizado');
});

test('postcondición financiera incompleta no se presenta como éxito ni repite escritura',async()=>{
 const h=arnes(),p=await h.preparar();
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload);
  h.mutarFinanzas({estados:[{cargo_id:'c2',monto_ajustado:40000,aplicado_neto:1000,saldo_cargo:39000}]});
  return {data:{ok:true,estado:'changed_to_normal',servicio_id:'s1',personas:4,total:40000,cargo_estado:'activo',cargo_id:'c2'}};};
 const r=await h.confirmar(p);assert.equal(r.estado,'revision_humana');assert.equal(h.llamadas.length,1);
 assert.doesNotMatch(A.renderizar(r),/data-servicio-cobro-confirmar|data-servicio-cobro-reintentar/);
});

test('éxito verificado dispara el refresh visual existente una sola vez',async()=>{
 const h=arnes(),p=await h.preparar(),eventos=[];
 const anteriorDocumento=globalThis.document,anteriorEvento=globalThis.CustomEvent;
 h.cliente.rpc=async(nombre,payload)=>{h.llamadas.push({nombre,payload:clonar(payload)});h.cambiar(payload);
  globalThis.document={dispatchEvent:e=>eventos.push(e)};
  globalThis.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options.detail;}};
  return {data:{ok:true,estado:'changed_to_normal',servicio_id:'s1',personas:4,total:40000,cargo_estado:'activo',cargo_id:'c2'}};};
 try{assert.equal((await h.confirmar(p)).estado,'realizado');assert.equal(eventos.length,1);
  assert.equal(eventos[0].type,'haiku:servicio-supabase-cambiado');
  assert.deepEqual(eventos[0].detail,{servicioId:'s1',reservaId:'r1'});
 }finally{if(anteriorDocumento===undefined)delete globalThis.document;else globalThis.document=anteriorDocumento;
  if(anteriorEvento===undefined)delete globalThis.CustomEvent;else globalThis.CustomEvent=anteriorEvento;}
});
