const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const api=require('../js/supabase-asistente-bove-escritura-v1.js');
const lectura=require('../js/supabase-asistente-bove-consultas-v1.js');
const copia=x=>JSON.parse(JSON.stringify(x));
const reserva=(extra={})=>({id:'r1',titular_nombre:'Juan Pérez',estado_reserva:'hospedada',bove_cierre:null,bove_checkout:null,estadias:[{id:'e1',fecha_ingreso:'2026-09-09',fecha_salida:'2026-09-11',estado_estadia:'hospedada',tipo_estadia:'alojamiento',cabanas:{numero:6}}],...extra});
function entorno(rs=[reserva()],cs=[]){
 const tablas={reservas:rs,vista_estado_cargos:cs,vista_saldos_alojamiento_reserva:[{reserva_id:'r1',saldo_alojamiento:0,total_alojamiento:100000}]},llamadas=[];
 const cliente={rpc(){throw Error('RPC prohibida');},from(tabla){llamadas.push(tabla);const filtros=[];const q={select(){return q;},eq(k,v){filtros.push(r=>r[k]===v);return q;},gte(){return q;},lte(){return q;},order(){return q;},async range(a,b){return {data:copia(tablas[tabla].filter(r=>filtros.every(f=>f(r))).slice(a,b+1))};}};return q;}};
 const opciones={cliente,dia:'2026-09-10',libro:null,lectura,permiso:()=>true};
 return {tablas,llamadas,opciones,preparar:(t='ponle BOVE 16989 a CAB 6',o={})=>api.preparar(t,{...opciones,...o})};
}
const cargo=()=>({reserva_id:'r1',tipo_cargo:'servicio',estado:'activo',monto:20000,saldo_cargo:0});
function libro(evidencias,rs=[]){
 const visitas=[];return {visitas,listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Jun20','Sep26'],buscarHojasBove:async()=>({hojas:['Sep26']}),consultarHoja:async n=>{visitas.push(n);return {evidencias_bove:copia(evidencias),reservas:copia(rs)};}};
}
const evidencia=(n='16989',estado='registrado')=>({numero:n,estado,origen:{hoja:'Sep26',celda:'L27',fila:27,columna:12}});
const semantica=()=>({titular:'Juan Pérez',cabana:6,fecha_checkin:'2026-09-09',fecha_checkout:'2026-09-11',pagos:[{tipo_movimiento:'alojamiento',origen:{hoja:'Sep26',celda:'L27'}}]});

for(const [texto,tipo] of [['Haku, ponle BOVE 16989 de alojamiento a CAB 6','alojamiento'],['Haku, registra BOVE 16989 de servicios para CAB 3','servicios'],['ponle BOVE 16989 checkout a CAB 6','servicios']])test('interpreta '+texto,()=>{assert.equal(api.interpretar(texto).tipo,tipo);});
for(const n of ['16989','16.989','16,989'])test('normaliza '+n,()=>assert.equal(api.interpretar(`a CAB 6 ponle BOVE ${n}`).numero,'16989'));
test('pendiente con número explícito y titular completo',()=>{assert.equal(api.interpretar('completa el BOVE pendiente de CAB 4 con 16989').cabana,4);assert.equal(api.interpretar('Haku, a Juan Pérez ponle BOVE 16991').titular,'juan perez');});
for(const texto of ['busca BOVE 16989','Libro: CAB 6 el 05-09-26','ponle BOVTAR 16989 a CAB 6'])test('no reclama '+texto,()=>assert.equal(api.interpretar(texto),null));
for(const texto of ['ponle el siguiente BOVE a CAB 6','ponle BOVE 16989 a CAB 6 ayer','ponle BOVE 16989 a CAB 6 mañana','ponle BOVE 16.98 a CAB 6','ponle BOVE 16989 para alojamiento y servicios a CAB 6'])test('bloquea intención insegura '+texto,()=>assert.ok(api.interpretar(texto).error));
test('resuelve única actual y alojamiento único sin escribir',async()=>{const e=entorno(),antes=copia(e.tablas);const p=await e.preparar();assert.equal(p.estado,'propuesta');assert.equal(p.q.tipo,'alojamiento');assert.deepEqual(e.tablas,antes);assert.match(p.libro.mensaje,/no cargado/);});
test('resuelve titular exacto, no parecido débil',async()=>{const e=entorno();assert.equal((await e.preparar('a Juan Pérez ponle BOVE 16989')).estado,'propuesta');assert.equal((await e.preparar('a Juan Peres ponle BOVE 16989')).estado,'bloqueada');});
test('CAB histórica queda fuera',async()=>{const r=reserva();r.estadias[0].fecha_salida='2026-09-09';assert.equal((await entorno([r]).preparar()).estado,'bloqueada');});
test('varias candidatas ofrecen selección, no propuesta automática',async()=>{const e=entorno([reserva(),reserva({id:'r2'})]);const p=await e.preparar();assert.equal(p.estado,'elegir_reserva');assert.equal(p.candidatas.length,2);assert.equal((await e.preparar(undefined,{reservaId:'r1'})).estado,'propuesta');assert.equal((await e.preparar(undefined,{reservaId:'ajena'})).estado,'bloqueada');});
test('servicios único pendiente y ambos posibles',async()=>{const e=entorno([reserva({bove_cierre:'123'})],[cargo()]);assert.equal((await e.preparar()).q.tipo,'servicios');e.tablas.reservas[0].bove_cierre=null;assert.equal((await e.preparar()).estado,'elegir_tipo');assert.equal((await e.preparar('ponle BOVE 16989 de servicios a CAB 6')).q.tipo,'servicios');});
test('Full Day con dos alcances no se fuerza',async()=>{const r=reserva();Object.assign(r.estadias[0],{fecha_ingreso:'2026-09-10',fecha_salida:'2026-09-10',tipo_estadia:'full_day'});assert.equal((await entorno([r],[cargo()]).preparar()).estado,'elegir_tipo');});
for(const estado of ['cancelada','no_show'])test('excluye '+estado,async()=>{assert.equal((await entorno([reserva({estado_reserva:estado})]).preparar()).estado,'bloqueada');const r=reserva();r.estadias[0].estado_estadia=estado;assert.equal((await entorno([r]).preparar()).estado,'bloqueada');});
test('mismo número no-op; otro no reemplaza; ambos llenos bloquean',async()=>{const e=entorno([reserva({bove_cierre:'16989'})]);assert.equal((await e.preparar('ponle BOVE 16989 de alojamiento a CAB 6')).estado,'sin_cambios');assert.match((await e.preparar('ponle BOVE 16990 de alojamiento a CAB 6')).mensaje,/No voy a reemplazar/);e.tablas.reservas[0].bove_checkout='23';assert.equal((await e.preparar()).estado,'bloqueada');});
test('espacios se consideran vacío sin cambiar número solicitado',async()=>{assert.equal((await entorno([reserva({bove_cierre:'  '})]).preparar()).estado,'propuesta');assert.equal((await entorno().preparar('ponle BOVE 123 a CAB 6')).q.numero,'123');});
test('sin permiso no consulta ni escribe',async()=>{const e=entorno();assert.equal((await e.preparar(undefined,{permiso:()=>false})).estado,'bloqueada');assert.deepEqual(e.llamadas,[]);});
test('no propone con saldo alojamiento o servicios pendiente',async()=>{const e=entorno();e.tablas.vista_saldos_alojamiento_reserva[0].saldo_alojamiento=1;assert.equal((await e.preparar()).estado,'bloqueada');const s=entorno([reserva()],[{...cargo(),saldo_cargo:1}]);assert.equal((await s.preparar('ponle BOVE 16989 de servicios a CAB 6')).estado,'bloqueada');});
test('Libro coincide con vínculo fuerte; sólo hojas relevantes',async()=>{const l=libro([evidencia()],[semantica()]);const p=await entorno().preparar(undefined,{libro:l});assert.equal(p.estado,'propuesta');assert.match(p.libro.mensaje,/encontrado y compatible/);assert.ok(l.visitas.every(n=>n==='Sep26'));});
test('contexto secundario nunca se vuelve vínculo fuerte',async()=>{const l=libro([{...evidencia(),cabana_contexto:6,fecha_bloque:'2026-09-10'}]);const p=await entorno().preparar(undefined,{libro:l});assert.equal(p.estado,'propuesta');assert.match(p.libro.mensaje,/contexto no concluyente/);});
test('Libro con OTRO número bloquea aunque búsqueda exacta sea vacía',async()=>{const l=libro([evidencia('16988')],[semantica()]);const p=await entorno().preparar(undefined,{libro:l});assert.equal(p.estado,'bloqueada');assert.match(p.mensaje,/16988/);});
test('PEND BOVE no se vuelve número ni conflicto',async()=>{const p=await entorno().preparar(undefined,{libro:libro([evidencia(null,'pendiente')],[semantica()])});assert.equal(p.estado,'propuesta');assert.match(p.libro.mensaje,/PEND BOVE/);});
test('Libro sin evidencia permite propuesta con aviso',async()=>{const p=await entorno().preparar(undefined,{libro:libro([])});assert.equal(p.estado,'propuesta');assert.match(p.libro.mensaje,/No encontré/);});
test('error de Libro no se disfraza de ausencia',async()=>{const l=libro([]);l.consultarHoja=async()=>{throw Error('fallo lector');};const p=await entorno().preparar(undefined,{libro:l});assert.equal(p.estado,'bloqueada');assert.match(p.mensaje,/fallo lector/);});
test('revalidación lee nuevamente el mismo ID y vuelve a contrastar',async()=>{const e=entorno(),l=libro([]),p=await e.preparar(undefined,{libro:l});const n=e.llamadas.length;const r=await api.revalidar(p);assert.equal(r.estado,'revalidada');assert.ok(e.llamadas.length>n);assert.match(r.mensaje,/No se guardó/);});
for(const campo of ['bove_cierre','estado_reserva','titular_nombre'])test('segunda lectura detecta cambio en '+campo,async()=>{const e=entorno(),p=await e.preparar();e.tablas.reservas[0][campo]=campo==='estado_reserva'?'cancelada':'otro';assert.equal((await api.revalidar(p)).estado,'bloqueada');});
test('segunda lectura detecta finanzas y permiso revocado',async()=>{const e=entorno(),p=await e.preparar();e.tablas.vista_saldos_alojamiento_reserva[0].total_alojamiento=200000;assert.equal((await api.revalidar(p)).estado,'bloqueada');let permitido=true;const p2=await e.preparar(undefined,{permiso:()=>permitido});permitido=false;assert.equal((await api.revalidar(p2)).estado,'bloqueada');});
test('rechaza propuestas falsificadas y confirmar siempre bloquea',async()=>{assert.equal((await api.revalidar({})).estado,'bloqueada');const e=entorno(),p=await e.preparar();for(const v of [undefined,p,{...p,habilitado:true,force:true}])assert.equal((await api.confirmar(v,{habilitado:true})).estado,'bloqueada');});
test('timeout termina sin resultado tardío usable',async()=>{const e=entorno();e.opciones.cliente.from=()=>({select(){return this;},lte(){return this;},gte(){return this;},order(){return this;},range:()=>new Promise(()=>{})});assert.match((await e.preparar(undefined,{timeoutMs:5})).mensaje,/tiempo de espera/);});
test('tarjeta escapa contenido y muestra bloqueo independiente del botón',async()=>{const e=entorno([reserva({titular_nombre:'<img onerror=alert(1)>'})]),p=await e.preparar();const html=api.renderizar(p);assert.doesNotMatch(html,/<img/);assert.match(html,/disabled aria-disabled="true"/);assert.match(html,/Revalidar propuesta/);assert.match(html,/falta desplegar/);});
test('módulo no contiene writer, confirm nativo, persistencia ni eventos falsos',()=>{const s=fs.readFileSync('js/supabase-asistente-bove-escritura-v1.js','utf8');assert.doesNotMatch(s,/\.rpc\s*\(|\.update\s*\(|\.insert\s*\(|localStorage|indexedDB|haiku:bove-actualizado|root\.confirm\s*\(/);});

test('segunda revalidación detecta un conflicto nuevo del Libro',async()=>{
 const e=entorno(),l=libro([]),p=await e.preparar(undefined,{libro:l});
 l.estado=()=>({cargado:true,generacion:2});l.consultarHoja=async()=>({reservas:[semantica()],evidencias_bove:[evidencia('16988')]});
 assert.equal((await api.revalidar(p)).estado,'bloqueada');
});
test('CAB sólo coincide con el segmento operativo correspondiente',async()=>{
 const r=reserva();r.estadias.push({...r.estadias[0],id:'historica',fecha_ingreso:'2026-08-01',fecha_salida:'2026-08-03',cabanas:{numero:8}});
 assert.equal((await entorno([r]).preparar('ponle BOVE 16989 a CAB 8')).estado,'bloqueada');
 assert.equal((await entorno([r]).preparar()).estado,'propuesta');
});
test('UI real prepara, revalida y cancela sin RPC ni guardado aun retirando disabled',async()=>{
 const vm=require('node:vm'),listeners=[],nodos=new Map();
 const elemento=()=>({value:'',children:[],handlers:{},appendChild(e){this.children.push(e);},dispatchEvent(){},addEventListener(t,f){this.handlers[t]=f;},querySelector(){return null;}});
 const doc={head:elemento(),createElement:elemento,getElementById:id=>nodos.get(id)};
 const e=entorno(),dia=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 Object.assign(e.tablas.reservas[0].estadias[0],{fecha_ingreso:dia,fecha_salida:dia,tipo_estadia:'full_day'});
 const w={document:doc,haikuSupabase:e.opciones.cliente,haikuTienePermiso:()=>true,Event:class{},addEventListener:(t,f)=>listeners.push({t,f})};
 vm.runInNewContext(fs.readFileSync('js/supabase-asistente-bove-escritura-v1.js','utf8'),{window:w,setTimeout,clearTimeout,Intl});
 const campo=elemento(),mensajes=elemento();nodos.set('haiku-asistente-texto',campo);nodos.set('haiku-asistente-mensajes',mensajes);campo.value='ponle BOVE 16989 a CAB 6';
 listeners.find(l=>l.t==='click').f({type:'click',target:{closest:()=>({})},preventDefault(){},stopImmediatePropagation(){}});
 await new Promise(r=>setImmediate(r));
 const tarjeta=mensajes.children[1];assert.match(tarjeta.innerHTML,/Revalidar propuesta/);
 const click=async atributo=>tarjeta.handlers.click({target:{closest:()=>({hasAttribute:a=>a===atributo,dataset:{},disabled:false})},preventDefault(){},stopPropagation(){}});
 const n=e.llamadas.length;await click('data-bove-revalidar');assert.ok(e.llamadas.length>n);assert.match(tarjeta.innerHTML,/Segunda revalidación completada/);
 const html=tarjeta.innerHTML;await click('data-bove-confirmar');assert.equal(tarjeta.innerHTML,html);
 await click('data-bove-cancelar');assert.match(tarjeta.textContent,/cancelada/);assert.equal(e.tablas.reservas[0].bove_cierre,null);
});
