const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../js/haiku-libro-contexto-v1.js'),S=require('../js/haiku-libro-semantica-v1.js');
require('../js/haiku-libro-diferencias-v1.js');
const r=(extra={})=>({id:'Sep26!AU9',hoja:'Sep26',titular:'Persona Ejemplo',cabana:7,fecha_checkin:'2026-09-12',fecha_checkout:'2026-09-14',noches:2,tipo_estadia:'alojamiento',adultos:2,ninos:0,mascotas:0,estado_confirmacion:'confirmada_por_color',estado_operativo:'checked_out',rut_documento:'19548208-k',advertencias:[],pagos:[],servicios:[],notas_importantes:[],pagos_pendientes:[],...extra});
const registro=(extra={})=>({id:'p1',tipo:'modificacion',anterior:r(),actual:r({fecha_checkout:'2026-09-13',noches:1}),cambios:[{campo:'fecha_checkout',antes:'2026-09-14',ahora:'2026-09-13'},{campo:'noches',antes:2,ahora:1}],...extra});
function lector(rows,cont=[]){return {crearLectura:async()=>({estado:()=>({generacion:4}),listarHojas:()=>['Sep26'],consultarHoja:async h=>{cont.push(h);return {reservas:rows,cobertura:{geometria:true}};}})};}
const sistema={id:'e1',reserva_id:'r1',estado_operativo:'checked_out'};
test('1HRA TINAJA indica duración y conserva el intervalo horario explícito',()=>{
 assert.deepEqual(S.horasDeServicio('1HRA TINAJA CORTESÍA tonel 22:15 a 23:15'),['22:15','23:15']);
 assert.deepEqual(S.horasDeServicio('Tonel a la 1 HR'),['01:00']);
 assert.deepEqual(S.horasDeServicio('Jacuzzi a las 19 HRS'),['19:00']);
 assert.deepEqual(S.horasDeServicio('Tinaja 1:00'),['01:00']);
 assert.deepEqual(S.horasDeServicio('12hrs tonel'),['12:00']);
});
const caso=(extra={})=>({...registro(),sistema,...extra});
function calendarioDias(noches,{libre=true,texto='2 noches'}={}){
 const celdas=[{r:1,c:51,valor:'13 nov',fechaISO:'2026-11-13'},{r:1,c:55,valor:'14 nov',fechaISO:'2026-11-14'},
  {r:1,c:59,valor:'15 nov',fechaISO:'2026-11-15'},{r:10,c:0,valor:'cabaña 9'},
  {r:10,c:51,valor:`Persona Ejemplo // 2 ADL // ${texto}`},{r:24,c:51,valor:'Pagos de arriendos de hoy'}];
 if(libre)celdas.push({r:10,c:51+4*noches,valor:'LIBRE'});
 return S.normalizarHoja({celdas,combinaciones:[{s:{r:10,c:51},e:{r:10,c:53+4*(noches-1)}}]},'Nov26');
}
async function contextoCalendario(data){
 const actual=data.reservas[0],l={crearLectura:async()=>({estado:()=>({generacion:1}),listarHojas:()=>['Nov26'],consultarHoja:async()=>data})};
 const [item]=await C.actualizarDesdeLibro([registro({actual,anterior:actual})],l);
 return {...item,sistema,contexto:C.construir({...item,sistema})};
}
test('contrasta texto con fechas de encabezados y muestra el día LIBRE de la misma cabaña',async()=>{
 const item=await contextoCalendario(calendarioDias(1)),e=item.contexto.calendario;
 assert.equal(e.rango,'AZ11:BB11');assert.deepEqual(e.noches,['2026-11-13']);assert.equal(e.siguiente_libre.celda,'BD11');
 const aviso=item.contexto.avisos.find(x=>x.codigo==='noches_contradictorias').texto;
 assert.match(aviso,/texto dice 2 noches.*noche del 13-11-2026.*14-11-2026.*LIBRE/);
 const html=require('../js/supabase-asistente-libro-actualizacion-v1.js').renderizarPendientes({items:[item]});
 assert.match(html,/Celdas revisadas: Nov26 · AZ11:BB11\. LIBRE: BD11/);
});
test('dos días ocupados y texto de dos noches se corroboran: no crea una contradicción',async()=>{
 const item=await contextoCalendario(calendarioDias(2));
 assert.equal(item.actual.fecha_checkout,'2026-11-15');assert.deepEqual(item.contexto.calendario.noches,['2026-11-13','2026-11-14']);
 assert.ok(!item.contexto.avisos.some(x=>x.codigo==='noches_contradictorias'));
 assert.match(item.contexto.hechos.join(' '),/2 noches: del 13-11-2026 al 14-11-2026/);
});
test('no inventa LIBRE por una celda vacía, ni usa el LIBRE de otra cabaña',async()=>{
 const data=calendarioDias(1,{libre:false});data.espacios.push({fecha:'2026-11-14',cabana:8,estado:'libre_explicito',origen:{celda:'BD10'}});
 const item=await contextoCalendario(data);assert.equal(item.contexto.calendario.siguiente_libre,null);
 assert.doesNotMatch(item.contexto.avisos.find(x=>x.codigo==='noches_contradictorias').texto,/LIBRE/);
});
test('duración explícita con extensión se contrasta completa y no sólo con la primera noche',async()=>{
 const item=await contextoCalendario(calendarioDias(2,{texto:'1 noche // pidió extender 1 noche'}));
 assert.equal(item.actual.noches_texto,1);assert.equal(item.actual.noches_texto_efectivas,2);
 assert.ok(!item.contexto.avisos.some(x=>x.codigo==='noches_contradictorias'));
});
test('geometría incierta o fechas deducidas del texto no se presentan como celdas comprobadas',async()=>{
 for(const cambios of [{geometria_inequivoca:false},{geometria_resuelta_texto:true}]){
  const data=calendarioDias(1);Object.assign(data.reservas[0],cambios);
  const item=await contextoCalendario(data);assert.equal(item.fuente_vigente.calendario,null);assert.equal(item.contexto.calendario,undefined);
 }
});
test('pendiente de una salida antigua vuelve al Libro vigente, conservando su ID y evidencia anterior',async()=>{
 const original=registro(),previo=structuredClone(original),out=await C.actualizarDesdeLibro([original],lector([r()]));
 assert.equal(out[0].id,'p1');assert.equal(out[0].actual.fecha_checkout,'2026-09-14');assert.equal(out[0].cambios[0].ahora,'2026-09-14');
 assert.equal(out[0].fuente_vigente.estado,'verificada');assert.deepEqual(original,previo);
});
test('dos pendientes de una ficha se agrupan sin perder notas, servicios ni IDs; una lectura por hoja',async()=>{
 const lecturas=[],a=registro(),b=registro({id:'p2',cambios:[{campo:'notas_importantes',antes:[],ahora:['Batas']}]});
 const out=await C.actualizarDesdeLibro([a,b],lector([r({notas_importantes:['Batas']})],lecturas));
 assert.equal(out.length,1);assert.deepEqual(out[0].ids_origen,['p1','p2']);assert.equal(out[0].cambios.length,3);assert.deepEqual(lecturas,['Sep26']);
});
test('no mezcla dos estadías de una misma persona',async()=>{
 const otra=r({id:'Sep26!BY9',fecha_checkin:'2026-09-22',fecha_checkout:'2026-09-24'});
 const out=await C.actualizarDesdeLibro([registro(),registro({id:'p2',actual:otra,anterior:otra})],lector([r(),otra]));
 assert.equal(out.length,2);
});
test('no confunde ausencia, duplicados o errores de lectura con cancelación o resolución',async()=>{
 for(const [rows,estado] of [[[],'no_encontrada'],[[r(),r()],'ambigua'],[[r({titular:'Otra Persona',rut_documento:'11111111-1'})],'no_encontrada']]){
  const out=await C.actualizarDesdeLibro([registro()],lector(rows));assert.equal(out[0].fuente_vigente.estado,estado);
 }
 const out=await C.actualizarDesdeLibro([registro()],{crearLectura:async()=>{throw Error('sin conexión')}});assert.equal(out[0].fuente_vigente.estado,'no_disponible');
});
test('no verifica una hoja incompleta y conserva cancelaciones para su flujo específico',async()=>{
 const l=lector([]);l.crearLectura=async()=>({estado:()=>({generacion:4}),listarHojas:()=>['Sep26'],consultarHoja:async()=>({reservas:[r()],cobertura:{geometria:false}})});
 const cancelada=registro({tipo:'cancelacion',actual:null});const out=await C.actualizarDesdeLibro([registro(),cancelada],l);
 assert.equal(out[0].fuente_vigente.estado,'no_disponible');assert.deepEqual(out[1],cancelada);
});
test('una cancelación exige bloque explícito, misma persona, fecha y datos de respaldo',async()=>{
 const evidencia={bloque:'CANCELACIONES',titular:'Persona Ejemplo',fecha_checkin:'2026-09-12',noches:1,rut_documento:'19548208-k'};
 const l=lector([]);l.crearLectura=async()=>({estado:()=>({generacion:4}),listarHojas:()=>['Sep26'],consultarHoja:async()=>({reservas:[],cancelaciones:[evidencia],cobertura:{geometria:true}})});
 assert.equal((await C.actualizarDesdeLibro([registro()],l))[0].fuente_vigente.estado,'cancelada');
 evidencia.bloque='PETICIONES';assert.equal((await C.actualizarDesdeLibro([registro()],l))[0].fuente_vigente.estado,'no_encontrada');
 evidencia.bloque='CANCELACIONES';evidencia.fecha_checkin='2026-09-22';assert.equal((await C.actualizarDesdeLibro([registro()],l))[0].fuente_vigente.estado,'no_encontrada');
});
function cliente(tablas,llamadas=[],demora){return {from(nombre){llamadas.push(nombre);let ids,campo;const q={select(){return q},in(k,v){campo=k;ids=v;return q},order(){return q},limit(){return q},abortSignal(){return q},then(a,b){return (demora?demora(nombre):Promise.resolve({data:(tablas[nombre]||[]).filter(x=>ids.includes(x[campo]))})).then(a,b)}};return q;}};}
const tablas={eventos_auditoria:[],estadia_noches:[{id:'n1',estadia_id:'e1',fecha:'2026-09-12'},{id:'n2',estadia_id:'e1',fecha:'2026-09-13'}],vista_estado_cargos:[1,2].map(n=>({cargo_id:'c'+n,reserva_id:'r1',estadia_id:'e1',estadia_noche_id:'n'+n,tipo_cargo:'alojamiento',estado:'activo',monto:162000,monto_ajustado:162000,aplicado_neto:162000,saldo_cargo:0}))};
test('explica cobros y pagos de la noche retirada sin alterar cantidades ni emitir escrituras',async()=>{
 const llamadas=[],out=await C.enriquecer([caso()],cliente(tablas,llamadas),{puedeVerPagos:true});
 assert.deepEqual(out[0].contexto.finanzas,{total:324000,aplicado:324000,retirado:162000,pagadoRetirado:162000});
 assert.match(out[0].contexto.avisos[0].texto,/162\.000/);assert.equal(llamadas.length,3);
});
test('las lecturas se agrupan: 100 tarjetas no generan 100 consultas',async()=>{
 const llamadas=[];await C.enriquecer(Array.from({length:100},()=>caso()),cliente(tablas,llamadas),{puedeVerPagos:true});
 assert.deepEqual(llamadas.sort(),['estadia_noches','eventos_auditoria','vista_estado_cargos']);
});
test('notas y servicios reutilizan la comparación, sin lecturas financieras innecesarias',async()=>{
 const llamadas=[];const out=await C.enriquecer([caso({cambios:[{campo:'servicios'}]})],cliente(tablas,llamadas),{comparacion:{serviciosDetalle:[{estado:'en_sistema',reserva:r(),servicio:{concepto:'masaje',hora:'16:00'}},{estado:'faltante',reserva:r(),servicio:{concepto:'tonel',hora:'17:15'}}]}});
 assert.deepEqual(llamadas,['eventos_auditoria']);assert.equal(out[0].contexto.servicios.length,2);assert.match(out[0].contexto.hechos.join(' '),/ya está registrado/);
});
test('sin permiso de pagos o sin cargos visibles no informa cero ni permite concluir precio conservado',async()=>{
 const llamadas=[],out=await C.enriquecer([caso()],cliente(tablas,llamadas),{puedeVerPagos:false});
 assert.deepEqual(llamadas,['eventos_auditoria']);assert.equal(out[0].contexto.finanzas,null);assert.equal(out[0].contexto.avisos[0].codigo,'cobros_no_comprobados');
 const vacio=await C.enriquecer([caso()],cliente({}),{puedeVerPagos:true});assert.equal(vacio[0].contexto.finanzas,null);
});
test('fallos y lecturas truncadas se muestran como contexto no comprobado',async()=>{
 for(const respuesta of [{error:{message:'RLS'}},{data:Array(500).fill({})},{data:null}]){
 const out=await C.enriquecer([caso()],cliente({},[],async()=>respuesta),{puedeVerPagos:true});assert.equal(out[0].contexto.finanzas,null);
 }
});
test('el plazo limita la espera y una respuesta tardía no cambia el informe entregado',async()=>{
 let terminar;const promesa=new Promise(r=>terminar=r),inicio=Date.now();
 const out=await C.enriquecer([caso()],cliente({},[],()=>promesa),{puedeVerPagos:true,plazoMs:15});
 assert.ok(Date.now()-inicio<250);const antes=JSON.stringify(out);terminar({data:tablas.vista_estado_cargos});await new Promise(r=>setImmediate(r));assert.equal(JSON.stringify(out),antes);
});
test('distingue contradicción de noches, cambios en ambas fuentes e historial comprobado',()=>{
 const item=caso({actual:r({fecha_checkout:'2026-09-13',noches:1,noches_texto:2}),cambios:[{campo:'fecha_checkout',antes:'2026-09-14',ahora:'2026-09-13',proyecto:'2026-09-15'}]});
 const c=C.construir(item,{historial:{rows:[{reserva_id:'r1',estadia_id:'e1',creado_en:'2026-11-06',cambios:[{campo:'fecha_salida',anterior:'2026-09-14',nuevo:'2026-09-15'}]}]}});
 assert.ok(c.avisos.some(x=>x.codigo==='noches_contradictorias'));assert.ok(c.avisos.some(x=>x.codigo==='cambio_en_ambas_fuentes'));assert.match(C.fraseHistorial(c.historial),/14-09-2026 → 15-09-2026/);
});
test('integración: el pendiente obsoleto se resuelve con Libro actual y H, sin RPC ni cambios financieros',async()=>{
 const ctx={HAIKU_LIBRO_SEMANTICA:S,structuredClone,console,Intl,Date};vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8'),ctx);
 const vigente=await C.actualizarDesdeLibro([registro()],lector([r()]));
 const tabla={id:'e1',reserva_id:'r1',fecha_ingreso:'2026-09-12',fecha_salida:'2026-09-14',estado_estadia:'checked_out',tipo_estadia:'alojamiento',adultos:2,ninos:0,mascotas:0,cabanas:{numero:7},reservas:{id:'r1',titular_nombre:'Persona Ejemplo',titular_numero_documento:'19548208-k',estado_reserva:'checked_out'}};
 const db={auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},from(){const q={select(){return q},lte(){return q},gte(){return q},order(){return q},range:async()=>({data:[tabla]})};return q;},rpc(){assert.fail('No debe escribir');}};
 const out=await ctx.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados(vigente,db,{generacion:4});
 assert.equal(out.items.length,0);assert.equal(out.resueltos[0],'p1');assert.equal(out.resueltosDetalle[0].motivo,'ya_coincide');
 const noVerificado=await ctx.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([{...registro(),fuente_vigente:{estado:'no_disponible'}}],db,{generacion:4});
 assert.equal(noVerificado.items[0].accionable,false);assert.equal(noVerificado.reservas.length,0);
 const altaNoVerificada=await ctx.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([{...registro({tipo:'nueva',actual:r()}),fuente_vigente:{estado:'no_disponible'}}],db,{generacion:4});
 assert.equal(altaNoVerificada.resueltos.length,0);assert.equal(altaNoVerificada.items[0].accionable,false);
 const cancelada={...registro({tipo:'nueva',cambios:[]}),fuente_vigente:{estado:'cancelada'}};
 const activa=await ctx.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([cancelada],db,{generacion:4});
 assert.equal(activa.resueltos.length,0);assert.equal(activa.items[0].accionable,false);
 tabla.reservas.titular_nombre='Otra Persona';tabla.reservas.titular_numero_documento='11111111-1';
 const cerrada=await ctx.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([cancelada],db,{generacion:4});
 assert.equal(cerrada.items.length,0);assert.equal(cerrada.resueltosDetalle[0].motivo,'cancelada_en_libro');
});
test('lote canónico conserva estilos, texto enriquecido y semántica; abre XLSX y ZIP una sola vez',async()=>{
 const path=require('node:path'),os=require('node:os'),assets=process.env.HAIKU_LIBRO_WORKER_ASSETS||path.join(os.tmpdir(),'haiku-jonathan-real-xlsx');
 const XLSX=require(path.join(assets,'xlsx.full.min.js')),JSZip=require(path.join(assets,'jszip.min.js'));
 let lecturas=0,zips=0;
 const L=require('../js/supabase-libro-reserva-worker-v1.js').crearLector({XLSX:{...XLSX,read(...args){lecturas++;return XLSX.read(...args)}},JSZip:{loadAsync(...args){zips++;return JSZip.loadAsync(...args)}}});
 const bytes=fs.readFileSync(path.join(__dirname,'fixtures/libro-reconciliacion-oct26-real.xlsx'));
 const lote=await L.leerHojas(bytes,['Oct26']);assert.equal(lecturas,1);assert.equal(zips,1);
 const individual=await L.leerHoja(bytes,'Oct26');
 assert.deepEqual(lote[0].datos,individual);assert.deepEqual(S.normalizarHoja(lote[0].datos,'Oct26'),S.normalizarHoja(individual,'Oct26'));
 await assert.rejects(L.leerHojas(bytes,[]),/1 y 8/);await assert.rejects(L.leerHojas(bytes,['Oct26','Oct26']),/distintas/);
});
test('la actualización del contexto pide un lote único de las hojas necesarias',async()=>{
 let llamadas=0;const l={crearLectura:async()=>({estado:()=>({generacion:4}),listarHojas:()=>['Sep26','Oct26'],consultarHojas:async nombres=>{
  llamadas++;assert.deepEqual(nombres,['Sep26']);return [{hoja:'Sep26',reservas:[r()],cobertura:{geometria:true}}];
 },consultarHoja(){assert.fail('No debe repetir la lectura por hoja')}})};
 const out=await C.actualizarDesdeLibro([registro(),registro({id:'p2'})],l);assert.equal(llamadas,1);assert.equal(out[0].fuente_vigente.estado,'verificada');
});
test('cerrar un caso agrupado retira sus dos avisos y conserva el pendiente no resuelto',async()=>{
 const libroActual=lector([r()]);
 const ctx={HAIKU_LIBRO_CONTEXTO_V1:{...C,actualizarDesdeLibro:rows=>C.actualizarDesdeLibro(rows,libroActual)},HAIKU_LIBRO_RESERVA_V1:libroActual,structuredClone,Date};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/supabase-asistente-libro-actualizacion-v1.js'),'utf8'),ctx);
 let historial={version:1,cambios:[registro(),registro({id:'p2'}),registro({id:'p3',actual:r({id:'Sep26!ZZ99',titular:'Otra Persona',rut_documento:'11111111-1'})})]},consultas=0;
 const cache=ctx.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.crearCachePendientes({generacion:()=>4,leer:async()=>historial,guardar:async x=>{historial=x},revalidarCambios:async rows=>{
  consultas++;assert.equal(rows.length,2);return {items:[rows[1]],resueltos:[rows[0].id],resueltosDetalle:[rows[0]],reservas:[]};
 }});
 const informe={estado:'sin_cambios',libro_actual:{generacion:4}};
 await cache.obtener(informe);assert.deepEqual(Array.from(historial.cambios,x=>x.id),['p3']);await cache.obtener(informe);assert.equal(consultas,1);
});
test('servicios reutilizan el contexto de lectura; su revisión independiente vuelve a consultar las reservas',async()=>{
 const {entorno}=require('./fixtures/libro-servicio-manual.cjs'),e=entorno(),llamadas=[],from=e.c.haikuSupabase.from;
 e.c.haikuSupabase.from=t=>{llamadas.push(t);return from(t)};
 const sistema=e.state.db.reserva_estadias.map(x=>({...x,...e.state.db.reservas.find(r=>r.id===x.reserva_id),id:x.id,cabana_numero:e.state.db.cabanas.find(c=>c.id===x.cabana_id).numero}));
 const a=await e.api.compararReservas(e.state.reservas,{desde:'2026-10-10',hasta:'2026-10-11'},e.c.haikuSupabase,sistema);
 assert.ok(a.items.length);assert.ok(!llamadas.includes('reserva_estadias'));assert.ok(!llamadas.includes('reservas'));assert.ok(!llamadas.includes('cabanas'));
 llamadas.length=0;await e.construir();assert.ok(llamadas.includes('reserva_estadias'));assert.equal(e.state.escrituras.length,0);
});
test('presentación compacta conserva consecuencias, escapa datos y agrupa resueltos sin contarlos como pendientes',()=>{
 const A=require('../js/supabase-asistente-libro-actualizacion-v1.js');
 const item=caso({contexto:{hechos:['Alojamiento: $324.000. Pagos aplicados: $324.000.'],avisos:[{codigo:'noche_con_cobro',texto:'La noche tiene $162.000 de pagos aplicados.'}],servicios:[{estado:'faltante',concepto:'<img src=x>',hora:'17:15'}]}});
 const html=A.renderizarPendientes({items:[item],resueltosDetalle:[{...registro(),motivo:'ya_coincide'},{...registro(),motivo:'cancelada_en_libro'}]});
 assert.match(html,/324\.000/);assert.match(html,/162\.000/);assert.match(html,/Ya resueltos \(2\)/);assert.match(html,/Hay 1 caso/);
 assert.match(html,/Libro actual y Proyecto H ya coinciden/);assert.match(html,/Cancelada en el Libro/);assert.doesNotMatch(html,/<img/);
});
