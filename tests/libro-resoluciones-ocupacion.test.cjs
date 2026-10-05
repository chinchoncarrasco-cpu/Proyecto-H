const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const S=require('../js/haiku-libro-semantica-v1.js'),T=require('../js/haiku-fullday-tarifa-v1.js');
const r=(extra={})=>({id:'Oct26!C3',titular:'Esperanza Aranda',cabana:1,fecha_checkin:'2026-10-02',fecha_checkout:'2026-10-03',
 tipo_estadia:'alojamiento',adultos:null,ninos:null,mascotas:null,noches:1,hoja:'Oct26',
 coordenadas_origen:{hoja:'Oct26',celda:'C3'},texto_original:'Esperanza Aranda // 1 noche // ocupación por confirmar',
 pagos:[],pagos_sin_asociacion:[],servicios:[],advertencias:[],notas_importantes:[],...extra});
function entorno(data=[],generacionInicial=1){
 class El {
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.style={};this.dataset={};this.textContent='';this.value='';}
  append(...xs){this.children.push(...xs);}appendChild(x){this.append(x);}replaceChildren(...xs){this.children=xs;}
  addEventListener(k,f){this.events[k]=f;}setAttribute(k,v){this[k]=v;}get options(){return this.children;}
  querySelectorAll(s){return this.children.flatMap(e=>[e,...e.querySelectorAll('*')]).filter(e=>s==='*'||s===e.tag||s.startsWith('.')&&(e.className||'').split(' ').includes(s.slice(1)));}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
 }
 let estado={generacion:generacionInicial,version:'a'.repeat(64)},reads=0,writes=0;const events={};
 const cliente={auth:{getSession:async()=>({data:{session:{user:{id:'mock-user'}}}})},from(){
  const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range:async()=>({data:[]})};return b;
 },async rpc(nombre,args){
  if(nombre==='haiku_libro_leer_resoluciones_v1'){reads++;return {data:args.p_identidades.flatMap(id=>data.filter(d=>JSON.stringify(d.identidad)===JSON.stringify(id)).slice(-1))};}
  if(nombre==='haiku_libro_confirmar_resolucion_v1'){
   writes++;const d={id:args.p_operacion_id,identidad:structuredClone(args.p_identidad),campo:args.p_campo,
    valor_original:args.p_identidad.evidencia.adultos,valor_confirmado:structuredClone(args.p_valor),usuario_id:'mock-user',confirmado_en:new Date().toISOString()};
   data.push(d);return {data:d};
  }throw Error('RPC inesperado '+nombre);
 }};
 const c={structuredClone,crypto:webcrypto,HAIKU_LIBRO_SEMANTICA:S,HAIKU_FULLDAY_TARIFA_V1:T,
  HAIKU_LIBRO_RESERVA_V1:{estado:()=>estado},haikuSupabase:cliente,document:{createElement:t=>new El(t),querySelector:()=>null,querySelectorAll:()=>[]},
  addEventListener(k,f){(events[k]||=[]).push(f);},Option:function(t,v){const e=new El('option');e.textContent=t;e.value=v;return e;}};
 for(const file of ['haiku-libro-resoluciones-v1','haiku-libro-consultas-v1','supabase-asistente-libro-incorporacion-v1'])vm.runInNewContext(fs.readFileSync(`js/${file}.js`,'utf8'),c);
 const out=new El('div');
 return {c,out,R:c.HAIKU_LIBRO_RESOLUCIONES_V1,Q:c.HAIKU_LIBRO_CONSULTAS,B:c.HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1,cliente,data,
  estado:()=>estado,cambiar(){estado={generacion:estado.generacion+1,version:'b'.repeat(64)};events['haiku:libro-cambio']?.forEach(f=>f());},
  reads:()=>reads,writes:()=>writes,boton:t=>out.querySelectorAll('button').find(e=>e.textContent===t),
  texto:()=>out.querySelectorAll('*').map(e=>e.textContent).join(' ')};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function preparar(h,reservas){return h.Q.prepararIncorporacion({reservas,generacion:1,q:{desde:'2026-10-02',hasta:'2026-10-03'}},new Map(),new Set(),h.cliente);}

test('sin ocupación: revisión inline visible y no incorporable',async()=>{
 const h=entorno();await h.Q.abrirComparacionEstructurada(h.out,{reservas:[r()],generacion:1});await tick();
 assert.ok(h.boton('Completar ocupación'));assert.match(h.texto(),/Revisión manual/);
 assert.equal(h.Q.serializarIncorporacion(await preparar(h,[r()])).length,0);
});
test('confirmar 2/0/0 habilita preparación efectiva sin mutar origen',async()=>{
 const h=entorno(),a=r(),before=JSON.stringify(a);await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);
 const p=await preparar(h,[a]),items=h.Q.serializarIncorporacion(p);
 assert.equal(items.length,1);assert.equal(items[0].estadias[0].datos.adultos,2);
 assert.equal(items[0].estadias[0].resolucion_manual.id,h.data[0].id);assert.equal(JSON.stringify(a),before);
});
test('cancelar editor no persiste ni modifica ocupación',async()=>{
 const h=entorno(),a=r();h.R.adjuntar(h.out,[a],1);await tick();h.boton('Completar ocupación').events.click();
 h.out.querySelectorAll('input')[0].value='2';h.boton('Cancelar').events.click();
 assert.equal(a.adultos,null);assert.equal(h.writes(),0);assert.equal(h.boton('Completar ocupación').hidden,false);
});
test('editar reemplaza únicamente decisión de campo y conserva historial',async()=>{
 const h=entorno(),a=r({telefono:'123'}),d=await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);
 await h.R.confirmar(a,{adultos:3,ninos:1,mascotas:0},1,d.id);
 const [eff]=await h.R.efectivos([a],1);assert.equal(eff.adultos,3);assert.equal(eff.telefono,'123');assert.equal(h.data.length,2);assert.equal(a.adultos,null);
});
test('negativos, decimales, strings, blancos y exceso smallint no se confirman',async()=>{
 const h=entorno();for(const [k,v] of [['adultos',-1],['adultos',2.5],['adultos','2'],['adultos',null],['adultos',NaN],['ninos',-1],['mascotas',0.5],['adultos',32768]])
  await assert.rejects(h.R.confirmar(r(),{adultos:2,ninos:0,mascotas:0,[k]:v},1),/entero/);
 assert.equal(h.writes(),0);
});
test('otro conflicto sigue presente y bloqueado después de resolver ocupación',async()=>{
 const h=entorno(),a=r({advertencias:['La geometría es ambigua; confirmar fechas.']});await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);
 const [eff]=await h.R.efectivos([a],1);assert.deepEqual(Array.from(eff.advertencias),a.advertencias);
 const p=await preparar(h,[a]);assert.equal(h.Q.serializarIncorporacion(p).length,0);assert.ok(p.items.some(i=>i.motivos.length));
});
test('cambio de generación invalida editor/preparación; nueva versión no recupera decisión',async()=>{
 const h=entorno(),a=r();await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);h.R.adjuntar(h.out,[a],1);await tick();h.cambiar();
 await assert.rejects(h.R.efectivos([a],1),/Libro cambió/);assert.equal(h.boton('Editar resolución').disabled,true);
 assert.equal((await h.R.efectivos([a],2))[0].adultos,null);
});
test('resolución A no afecta B aunque coincidan titular y CAB',async()=>{
 const h=entorno(),a=r(),b=r({id:'Oct26!G3',coordenadas_origen:{hoja:'Oct26',celda:'G3'}}),d=await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);
 assert.throws(()=>h.R.aplicar(b,d,h.estado()),/no corresponde/);
 const efectivos=await h.R.efectivos([a,b],1);assert.equal(efectivos[0].adultos,2);assert.equal(efectivos[1].adultos,null);
});
test('mismo origen con evidencia cambiada tampoco recupera decisión',async()=>{
 const h=entorno(),a=r();await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);
 assert.equal((await h.R.efectivos([{...a,texto_original:'Nueva evidencia'}],1))[0].adultos,null);
});
test('alojamiento válido sigue sin consultas de resolución ni cambio de payload',async()=>{
 const h=entorno(),a=r({adultos:1,ninos:2,mascotas:0});const p=await preparar(h,[a]),items=h.Q.serializarIncorporacion(p);
 assert.equal(items.length,1);assert.equal(items[0].estadias[0].resolucion_manual,undefined);assert.equal(items[0].estadias[0].libro_origen,undefined);assert.equal(h.reads(),0);assert.equal(h.writes(),0);
});
test('Full Day sin ADL bloquea; resolución 2 ADL + 1 niño usa 120000 canónicos',async()=>{
 const h=entorno(),a=r({tipo_estadia:'full_day',fecha_checkout:'2026-10-02',noches:0,texto_original:'Esperanza Aranda // FULLDAY // ocupación por confirmar'});
 assert.equal(h.Q.serializarIncorporacion(await preparar(h,[a])).length,0);
 await h.R.confirmar(a,{adultos:2,ninos:1,mascotas:0},1);
 const items=h.Q.serializarIncorporacion(await preparar(h,[a]));assert.equal(items[0].estadias[0].tarifas['2026-10-02'],T.TARIFA_PERSONA_CLP*2);
 assert.equal(items[0].estadias[0].datos.ninos,1);assert.equal(a.adultos,null);assert.match(a.texto_original,/confirmar/);
});
test('Full Day 1 ADL continúa inválido y no genera decisión',async()=>{
 const h=entorno();await assert.rejects(h.R.confirmar(r({tipo_estadia:'full_day'}),{adultos:1,ninos:2,mascotas:0},1),/2 ADL/);assert.equal(h.writes(),0);
});
test('solo ambiguas ofrece resolver junto al problema sin volverlas transferibles',async()=>{
 const h=entorno(),a=r(),result={estado:'ok',ambiguas:[{actuales:[a],motivo:'Identidad no concluyente'}]};h.B.adjuntar(h.out,result,1);await tick();
 assert.ok(h.boton('Completar ocupación'));assert.equal(h.boton('Preparar cambios en Proyecto H'),undefined);
 await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);assert.equal(h.B.adaptar(result,1).reservas.length,0);
});
test('respuesta persistente incompleta o ajena nunca confirma la tarjeta',async()=>{
 const h=entorno();h.cliente.rpc=async()=>({data:{}});
 await assert.rejects(h.R.confirmar(r(),{adultos:2,ninos:0,mascotas:0},1),/no corresponde/);
});
test('error de lectura persistente bloquea preparación aunque haya una decisión previa',async()=>{
 const h=entorno();await h.R.confirmar(r(),{adultos:2,ninos:0,mascotas:0},1);h.cliente.rpc=async()=>({error:{message:'offline'}});
 await assert.rejects(preparar(h,[r()]),/offline/);
});
test('resolución requiere huella de versión verificada, sin fallback a localStorage',async()=>{
 const h=entorno();h.estado().version=null;await assert.rejects(h.R.confirmar(r(),{adultos:2,ninos:0,mascotas:0},1),/verificar/);
 assert.doesNotMatch(fs.readFileSync('js/haiku-libro-resoluciones-v1.js','utf8'),/localStorage/);
});
test('recargar Haku: mismo SHA/evidencia y generación nueva recuperan la última resolución sin reconfirmar',async()=>{
 const h=entorno(),a=r(),d=await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1),recargado=entorno(h.data,7);
 const [eff]=await recargado.R.efectivos([a],7);assert.equal(eff.adultos,2);assert.equal(eff.resolucion_manual.id,d.id);
 assert.equal(eff.libro_origen.version,h.estado().version);assert.equal(recargado.writes(),0);assert.equal(h.data.length,1);
 assert.equal(recargado.R.aplicar(a,d,recargado.estado()).adultos,2);
 recargado.R.adjuntar(recargado.out,[a],7);await tick();assert.ok(recargado.boton('Editar resolución'));assert.equal(a.adultos,null);
});
test('editar después de preparar exige revisar de nuevo antes de incorporar',async()=>{
 const h=entorno(),a=r(),d=await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1),p=await preparar(h,[a]);
 await h.R.confirmar(a,{adultos:3,ninos:0,mascotas:0},1,d.id);
 await assert.rejects(h.Q.confirmarIncorporacion({reservas:[a],generacion:1,q:{desde:'2026-10-02',hasta:'2026-10-03'}},new Map(),new Set(),p,h.cliente),/resolución manual cambió/);
});
test('cambio de Libro durante confirmación no muestra una decisión vigente ni muta original',async()=>{
 const h=entorno(),a=r(),rpc=h.cliente.rpc;h.cliente.rpc=async(name,args)=>{const response=await rpc(name,args);if(name.includes('confirmar'))h.cambiar();return response;};
 await assert.rejects(h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1),/Libro cambió/);
 assert.equal(a.adultos,null);assert.equal(h.data[0].generacion,undefined);assert.equal((await h.R.efectivos([a],2))[0].adultos,null);
});
test('misma SHA pero otro origen exige una resolución nueva',async()=>{
 const h=entorno(),a=r();await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);
 const b=r({coordenadas_origen:{hoja:'Oct26',celda:'G3'}});assert.equal((await h.R.efectivos([b],1))[0].adultos,null);
});
test('guard runtime rechaza una lectura en curso aunque el SHA permanezca igual',async()=>{
 const h=entorno(),a=r();await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);const rpc=h.cliente.rpc;
 h.cliente.rpc=async(name,args)=>{const result=await rpc(name,args);if(name.includes('leer'))h.estado().generacion++;return result;};
 await assert.rejects(h.R.efectivos([a],1),/Libro cambió/);assert.equal(a.adultos,null);
});
function sistema(a=r(),extra={}){return {id:'stay-a',reserva_id:'reserva-a',fecha_ingreso:a.fecha_checkin,fecha_salida:a.fecha_checkout,
 tipo_estadia:a.tipo_estadia==='full_day'?'fullday':'alojamiento',adultos:1,ninos:0,mascotas:0,estado_estadia:'pendiente',cabanas:{numero:a.cabana},
 reservas:{id:'reserva-a',titular_nombre:a.titular,estado_reserva:'pendiente'},...extra};}
function conSistema(h,rows){h.cliente.from=table=>{const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range:async()=>({data:table==='reserva_estadias'?rows:[]})};return b;};}
test('estadía existente queda fuera del resolver inline y de las actualizaciones con resolución',async()=>{
 const h=entorno(),a=r(),d=await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);conSistema(h,[sistema(a)]);
 h.R.adjuntar(h.out,[a],1);await tick();assert.equal(h.boton('Completar ocupación').hidden,true);assert.match(h.texto(),/Requiere revisión manual.*sólo permite crear reservas nuevas/);
 const p=await preparar(h,[a]);assert.ok(p.items.some(i=>i.motivos.some(m=>/sólo permite crear reservas nuevas/.test(m))));
 assert.equal(h.Q.serializarIncorporacion(p).filter(i=>i.tipo==='reserva_actualizar').length,0);assert.equal(h.data[0].id,d.id);
});
test('Full Day existente con adultos explícitos conserva actualización de main sin permiso financiero nuevo',async()=>{
 const h=entorno(),a=r({tipo_estadia:'full_day',fecha_checkout:'2026-10-02',adultos:2,ninos:0,mascotas:0,texto_original:'Esperanza Aranda // FULLDAY // 2 ADL'});
 conSistema(h,[sistema(a)]);const p=await preparar(h,[a]),item=p.items.find(i=>i.payload?.tipo==='reserva_actualizar');
 assert.ok(item);assert.equal(item.payload.estadia.despues.adultos,2);assert.equal(item.permisos.includes('pagos.verificar'),false);
 assert.equal(item.payload.resolucion_manual,undefined);assert.doesNotMatch(item.aviso||'',/recalcular|saldo disponible/);
});
test('candidato existente: no ofrece completar y bloquea añadir/asociar con una resolución previa',async()=>{
 for(const decision of ['estadia:stay-a','actualizar:stay-a','independiente']){
  const h=entorno(),a=r();await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);
  conSistema(h,[sistema(a,{fecha_ingreso:'2026-10-04',fecha_salida:'2026-10-05'})]);
  h.R.adjuntar(h.out,[a],1);await tick();assert.equal(h.boton('Completar ocupación').hidden,true);
  const result={reservas:[a],generacion:1,q:{desde:'2026-10-02',hasta:'2026-10-05'}},comp=await h.Q.compararSistema([a],h.cliente,result.q);
  const decisions=new Map([[comp.grupos[0].clave,{valor:decision}]]),p=await h.Q.prepararIncorporacion(result,decisions,new Set(),h.cliente);
  assert.equal(h.Q.serializarIncorporacion(p).length,0);assert.ok(p.items.some(i=>i.motivos.some(m=>/sólo permite crear reservas nuevas/.test(m))));
 }
});
test('reserva nueva resuelta se incorpora directamente con referencia, sin RPC de aprobación',async()=>{
 const h=entorno(),a=r();await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);const p=await preparar(h,[a]),rpc=h.cliente.rpc,calls=[];
 h.cliente.rpc=async(name,args)=>{if(name.includes('leer'))return rpc(name,args);calls.push({name,args});return {data:{ok:true}};};
 await h.Q.confirmarIncorporacion({reservas:[a],generacion:1,q:{desde:'2026-10-02',hasta:'2026-10-03'}},new Map(),new Set(),p,h.cliente);
 assert.deepEqual(calls.map(x=>x.name),['haiku_incorporar_libro_v1']);
 assert.equal(calls[0].args.p_items[0].tipo,'reserva_nueva');assert.equal(calls[0].args.p_items[0].estadias[0].resolucion_manual.id,h.data[0].id);
 assert.equal(h.data[0].generacion,undefined);assert.equal(h.data[0].identidad.generacion,undefined);
});
test('generación cambia durante preparación con mismo SHA: no devuelve preparación vigente',async()=>{
 const h=entorno(),a=r();await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);
 const from=h.cliente.from;let changed=false;h.cliente.from=table=>{const b=from(table),range=b.range;b.range=async()=>{const result=await range();if(!changed){h.estado().generacion++;changed=true;}return result;};return b;};
 await assert.rejects(preparar(h,[a]),/Libro cambió/);assert.equal(a.adultos,null);
});
test('conflictos estables descartan el payload pendiente y exigen volver a preparar',async()=>{
 for(const code of ['HLC01','HLC02']){
  const h=entorno(),p={items:[],solicitudPendiente:{operacionId:'op',items:[{tipo:'reserva_nueva'}],servicios:[]}};
  h.cliente.rpc=async()=>({error:{code,message:'Conflicto de resolución'}});
  await assert.rejects(h.Q.confirmarIncorporacion({generacion:1},new Map(),new Set(),p,h.cliente),e=>e.haikuConflictoDatos===true);
  assert.equal(p.solicitudPendiente,null);
 }
});
test('error de transporte conserva UUID y payload para reintento idempotente',async()=>{
 const h=entorno(),pending={operacionId:'same-op',items:[{tipo:'reserva_nueva'}],servicios:[]},p={items:[],solicitudPendiente:pending},calls=[];
 h.cliente.rpc=async(name,args)=>{calls.push(args);return calls.length===1?{error:{message:'Failed to fetch'}}:{data:{ok:true,reintento:true}};};
 await assert.rejects(h.Q.confirmarIncorporacion({generacion:1},new Map(),new Set(),p,h.cliente),e=>!e.haikuConflictoDatos);
 assert.equal(p.solicitudPendiente,pending);
 await h.Q.confirmarIncorporacion({generacion:1},new Map(),new Set(),p,h.cliente);
 assert.equal(calls[0].p_operacion_id,calls[1].p_operacion_id);assert.deepEqual(calls[0].p_items,calls[1].p_items);
});
test('hermanas multicabaña requieren resoluciones propias y conservan sus originales',async()=>{
 const h=entorno(),a=r(),b=r({id:'Oct26!G3',cabana:2,coordenadas_origen:{hoja:'Oct26',celda:'G3'}}),before=JSON.stringify([a,b]);
 await h.R.confirmar(a,{adultos:2,ninos:0,mascotas:0},1);let copies=await h.R.efectivos([a,b],1);
 assert.equal(copies[1].adultos,null);assert.equal(h.Q.serializarIncorporacion(await preparar(h,[a,b])).length,0);
 await h.R.confirmar(b,{adultos:4,ninos:1,mascotas:0},1);copies=await h.R.efectivos([a,b],1);
 const items=h.Q.serializarIncorporacion(await preparar(h,[a,b]));assert.equal(items[0].estadias.length,2);
 assert.deepEqual(copies.map(x=>x.adultos),[2,4]);assert.notEqual(items[0].estadias[0].resolucion_manual.id,items[0].estadias[1].resolucion_manual.id);
 assert.equal(JSON.stringify([a,b]),before);
});
