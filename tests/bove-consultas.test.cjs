const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../js/supabase-asistente-bove-consultas-v1.js');
const reserva=(extra={})=>({id:'r1',titular_nombre:'Persona Prueba',bove_cierre:'19888',bove_checkout:null,estadias:[{fecha_ingreso:'2026-09-10',fecha_salida:'2026-09-11',cabanas:{numero:6}}],...extra});
const pro=()=>B.desdeProyecto([reserva()])[0];
const lib=(extra={})=>({...pro(),fuente:'libro',origen:{hoja:'Sep26',celda:'L27'},...extra});
function cliente(rows,cargos=[],servicios=[]){const calls=[];return {calls,from(tabla){calls.push(tabla);let data=tabla==='reservas'?rows:tabla==='servicios'?servicios:cargos;const q={select(s){calls.push(s);return q;},order(){return q;},eq(){return q;},or(){return q;},async range(a,b){return {data:data.slice(a,b+1)};}};return q;}};}
const libro=items=>({listo:async()=>{},estado:()=>({generacion:1,cargado:true}),listarHojas:()=>['Sep26'],buscarHojasBove:async()=>({hojas:['Sep26']}),buscarHojas:async()=>({hojas:['Sep26']}),consultarHoja:async()=>({evidencias_bove:items,reservas:[]})});
for(const [texto,fuente] of [['Haku, busca el BOVE 19888','ambas'],['busca el BOVE 19888 en el Libro','libro'],['busca en Proyecto H el BOVE 19888','proyecto_h']])test(texto,async()=>{
 const c=cliente([reserva()]);const r=await B.consultar(texto,{cliente:c,libro:libro([{numero:'19888',estado:'registrado',origen:{hoja:'Sep26',celda:'L27'},texto_original:'BOVE:19888'}])});
 assert.equal(r.q.fuente,fuente);assert.equal(r.proyecto.length,fuente==='libro'?0:1);assert.equal(r.libro.length,fuente==='proyecto_h'?0:1);if(fuente==='libro')assert.equal(c.calls.length,0);
});
test('coincidencia y conflicto conservan ambos valores',()=>{
 assert.equal(B.comparar([lib()],[pro()])[0].estado,'coinciden');
 const c=B.comparar([lib({numero:'19999'})],[pro()])[0];assert.equal(c.estado,'conflicto');assert.equal(c.proyecto.numero,'19888');
});
test('sólo Libro, sólo Proyecto H y pendientes separados',()=>{
 assert.equal(B.comparar([lib()],[])[0].estado,'solo_libro');assert.equal(B.comparar([],[pro()])[0].estado,'solo_proyecto_h');
 assert.equal(B.comparar([lib({numero:null,estado:'pendiente'})],[pro()])[0].estado,'pendiente');
});
test('múltiples coincidencias y evidencia sin titular requieren revisión',()=>{
 assert.equal(B.comparar([lib(),lib()],[pro()])[0].estado,'no_determinado');
 assert.equal(B.comparar([lib({titular:undefined})],[pro()])[0].estado,'no_determinado');
});
test('fuente Proyecto H excluye pagos.bove y agrupa campos iguales',()=>{
 assert.equal(B.desdeProyecto([reserva({bove_cierre:null,pagos:[{bove:'19888'}]})]).length,0);
 const r=B.desdeProyecto([reserva({bove_checkout:'19888'})]);assert.equal(r.length,1);assert.deepEqual(r[0].tipos,['alojamiento','servicios']);
 assert.equal(B.desdeProyecto([reserva({bove_checkout:'19889'})]).length,2);
});
test('no afecta explícita y longitudes no certificadas no se mezclan',()=>{
 const s=B.resumenUltimos([{numero:'19888'},{numero:'327',serie:'no_afecta'},{numero:'328'}]);
 assert.match(s,/no_afecta: mayor número observado 327/);assert.match(s,/3 dígitos.*328/);assert.match(s,/5 dígitos.*19888/);
});
test('pendientes hoy excluye futuro, cancelada y servicios sin pago',async()=>{
 const c=cliente([],[{tipo_cargo:'alojamiento',monto:100,saldo_cargo:100},{tipo_cargo:'servicio',servicio_id:'s1',monto:30,saldo_cargo:0}],[{id:'s1',total:30}]);
 const hoy=reserva({bove_cierre:null});const futuro=reserva({id:'r2',bove_cierre:null,estadias:[{fecha_ingreso:'2026-09-11'}]});
 const r=await B.pendientes([hoy,futuro,reserva({estado_reserva:'cancelada'})],c,'2026-09-10');assert.equal(r.length,2);assert.deepEqual(r.map(x=>x.tipos[0]),['alojamiento','servicios']);
 const impago=cliente([],[{tipo_cargo:'servicio',monto:30,saldo_cargo:1}]);assert.equal((await B.pendientes([hoy],impago,'2026-09-10')).length,0);
});
test('inexistente y error de Libro no declaran ausencia falsa',async()=>{
 const r=await B.consultar('busca BOVE 99999',{cliente:cliente([]),libro:libro([])});assert.equal(r.proyecto.length+r.libro.length,0);
 const e=await B.consultar('busca BOVE 19888',{cliente:cliente([reserva()]),libro:null});assert.equal(e.incompleto,true);assert.deepEqual(e.comparacion,[]);assert.match(B.renderizar(e),/Lectura no disponible/);
});
test('frases financieras y comandos de escritura siguen fuera del interceptor',()=>{
 for(const t of ['pagos pendientes hoy','busca BOVTAR 123','ponle BOVE 123','registra BOVE 123','reservas pendientes del Libro','busca BOVE 16.97','busca BOVE 123 y modifica pagos'])assert.equal(B.interpretar(t),null);
 assert.equal(B.interpretar('¿qué BOVE está pendiente completar para hoy?').accion,'pendientes');
});
test('salida escapa HTML y omite texto original con datos personales',()=>{
 const r={q:{accion:'buscar',fuente:'libro',numero:'19888'},dia:'2026-09-10',libro:[lib({titular:'<script>',texto_original:'correo privado'})],proyecto:[],comparacion:[],avisos:[]};
 const html=B.renderizar(r);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('correo privado'));
});
test('el módulo no incluye writers, RPC ni reconciliación',()=>{
 const s=require('node:fs').readFileSync(require.resolve('../js/supabase-asistente-bove-consultas-v1.js'),'utf8');assert.doesNotMatch(s,/\.(?:insert|update|upsert|rpc)\s*\(/);assert.doesNotMatch(s,/from\(['"]pagos/);
});
test('entrada semántica sin asociación conserva sólo contexto, nunca adivina titular',()=>{
 const e={numero:'16968',estado:'registrado',origen:{hoja:'Sep26',celda:'L27',fila:27,columna:12},fecha_bloque:'2026-09-03',cabana_contexto:1};
 const r=B.desdeLibro({evidencias_bove:[e],reservas:[{titular:'Otro',cabana:1,fecha_checkin:'2026-09-03',pagos_sin_asociacion:[{origen:{hoja:'Sep26',celda:'K27:N27'}}]}]});
 assert.equal(r[0].titular,undefined);assert.deepEqual(r[0].segmentos,[]);assert.equal(r[0].cabana_contexto,1);
});
test('contexto de pago ya asociado permite comparación sin usar BOVE como identidad de pago',()=>{
 const e={numero:'19888',estado:'registrado',texto_original:'BOVE 19888',origen:{hoja:'Sep26',celda:'L27',fila:27,columna:12}};
 const r=B.desdeLibro({evidencias_bove:[e],reservas:[{titular:'Persona Prueba',cabana:6,fecha_checkin:'2026-09-10',fecha_checkout:'2026-09-11',pagos:[{tipo_movimiento:'alojamiento',origen:{hoja:'Sep26',celda:'K27:N27'}}]}]});
 assert.equal(B.comparar(r,[pro()])[0].estado,'coinciden');
});
test('caché del Libro por generación, Proyecto H se consulta de nuevo',async()=>{
 let g=1,lecturas=0;const l=libro([]);l.estado=()=>({generacion:g,cargado:true});l.consultarHoja=async()=>{lecturas++;return {evidencias_bove:[],reservas:[]};};
 const c=cliente([]);for(let i=0;i<2;i++)await B.consultar('busca BOVE 123',{cliente:c,libro:l});assert.equal(lecturas,1);
 g++;await B.consultar('busca BOVE 123',{cliente:c,libro:l});assert.equal(lecturas,2);assert.equal(c.calls.filter(x=>x==='reservas').length,3);
});
test('pendientes usa sólo hoja de hoy y relación real, sin recorrer historia',async()=>{
 const l=libro([]),leidas=[];l.listarHojas=()=>['Jun20','Sep26','Oct26'];l.buscarHojas=()=>{throw Error('No debe buscar todo el Libro');};
 l.consultarHoja=async h=>{leidas.push(h);return {evidencias_bove:[]};};const c=cliente([]);
 await B.consultar('qué BOVE está pendiente completar para hoy',{cliente:c,libro:l,dia:'2026-09-10'});
 assert.deepEqual(leidas,['Sep26']);assert.ok(c.calls.some(x=>x.includes('estadias:reserva_estadias!inner')));
});
test('Full Day de hoy conserva pendiente; una estadía adicional no duplica BOVE de reserva',async()=>{
 const r=reserva({bove_cierre:null,estadias:[{fecha_ingreso:'2026-09-10',fecha_salida:'2026-09-10',tipo_estadia:'full_day',cabanas:{numero:6}},{fecha_ingreso:'2026-09-10',fecha_salida:'2026-09-11',cabanas:{numero:7}}]});
 const p=await B.pendientes([r],cliente([],[{tipo_cargo:'alojamiento',monto:20}]),'2026-09-10');assert.equal(p.length,1);assert.equal(p[0].segmentos.length,2);
});
test('el interceptor se instala antes del parser general aun durante carga DOM',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),listeners=[];
 const campo={},mensajes={},doc={readyState:'loading',getElementById:id=>id==='haiku-asistente-texto'?campo:id==='haiku-asistente-mensajes'?mensajes:null,createElement:()=>({}),head:{appendChild(){}},addEventListener(){throw Error('No debe posponer interceptor');}};
 const w={document:doc,addEventListener:(t,f,c)=>listeners.push([t,c])};vm.runInNewContext(fs.readFileSync(require.resolve('../js/supabase-asistente-bove-consultas-v1.js'),'utf8'),{window:w});
 assert.deepEqual(listeners,[['click',true],['keydown',true]]);
 const panel=fs.readFileSync('panel.html','utf8');assert.ok(panel.indexOf("'supabase-asistente-bove-consultas-v1'")<panel.indexOf("'haiku-libro-consultas-v1'"));
});
