const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const S=require('../js/haiku-libro-semantica-v1.js'),D=require('../js/haiku-libro-diferencias-v1.js');
const r=()=>({id:'Sep26!C3',hoja:'Sep26',titular:'Carol Vega Ruiz',cabana:1,fecha_checkin:'2026-09-01',fecha_checkout:'2026-09-03',noches:2,tipo_estadia:'alojamiento',advertencias:[],correo:'carol@example.test'});
const e=()=>({bloque:'CANCELACIONES',titular:'Carol Vega Ruiz',fecha_checkin:'2026-09-01',noches:2,correo:'carol@example.test',origen:{hoja:'Sep26',celda:'D16'}});
const sheet=(rs,cs=[])=>({hoja:'Sep26',fechas:['2026-09-01','2026-09-02'],reservas:rs,cancelaciones:cs,cobertura:{geometria:true}});
const compare=(cs,rs=[])=>D.comparar([sheet([r()])],[sheet(rs,cs)]);
test('only positive unique cancellation evidence moves a missing reservation to its own category',()=>{
 assert.equal(compare([]).ya_no_aparecen.length,1);
 const out=compare([e()]);assert.equal(out.cancelaciones_confirmadas.length,1);assert.equal(out.ya_no_aparecen.length,0);assert.equal(out.resumen.cancelaciones_confirmadas,1);assert.equal(out.estado,'ok');
 for(const cs of [[{...e(),fecha_checkin:'2026-09-02'}],[e(),e()],[{...e(),noches:3}],[{...e(),correo:'other@example.test'}],[{...e(),noches:null,correo:null}],[{...e(),bloque:'OTRAS VENTAS'}]])assert.equal(compare(cs).cancelaciones_confirmadas,undefined);
 assert.equal(compare([e()],[r()]).cancelaciones_confirmadas,undefined);
});
test('CANCELACIONES boundaries follow primary labels, preserve source and exclude other areas and payment output',()=>{
 for(const fila of [8,12]){
 const data={celdas:[{r:1,c:2,valor:'1 sep',fechaISO:'2026-09-01'},{r:1,c:6,valor:'2 sep',fechaISO:'2026-09-02'},{r:2,c:0,valor:'cabaña 1'},
 {r:fila,c:0,valor:' CANCELACIONES '},{r:fila,c:3,valor:'CANCELADA A PETICIÓN // Carol Vega Ruiz // 2 noches // carol@example.test'},
 {r:fila-1,c:3,valor:'Otra Persona // 2 noches'},{r:fila+2,c:0,valor:'OTRAS VENTAS NO ASOCIADAS AL CHECK IN DEL DIA'},{r:fila+2,c:3,valor:'Fuera Bloque // 2 noches'},
 {r:fila+4,c:2,valor:'Pagos de arriendos de hoy'},{r:fila+5,c:0,valor:'cabaña 1'}],combinaciones:[{s:{r:fila,c:0},e:{r:fila+1,c:0}},{s:{r:fila+5,c:0},e:{r:fila+7,c:0}}]};
 const res=S.normalizarHoja(data,'Sep26');assert.equal(res.cancelaciones.length,1);assert.equal(res.cancelaciones[0].titular,'Carol Vega Ruiz');assert.equal(res.cancelaciones[0].origen.fila,fila+1);assert.equal(res.cancelaciones[0].fecha_checkin,'2026-09-01');assert.deepEqual(res.pagos,[]);
 }
});
function environment(){
 let g=1,allow=true,writerCalls=0,confirmAccepted=true;const caso=compare([e()]).cancelaciones_confirmadas[0];
 const row={id:'r1',titular_nombre:r().titular,correo_contacto:r().correo,estado_reserva:'confirmada',estadias:[{id:'s1',fecha_ingreso:r().fecha_checkin,fecha_salida:r().fecha_checkout,estado_estadia:'confirmada',cabanas:{numero:1}}]};
 const libro={estado:()=>({generacion:g}),consultarHoja:async(h,v)=>v==='anterior'?sheet([r()]):sheet([],[e()])};
 const cliente={auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},from(t){const q={select(){return q},eq(){return q},in(){return q},order(){return q},range:async()=>({data:t==='reservas'?[row]:[{id:'s1',reserva_id:'r1'}]})};return q;}};
 const context={structuredClone,HAIKU_LIBRO_DIFERENCIAS_V1:D,HAIKU_LIBRO_RESERVA_V1:libro,haikuSupabase:cliente,haikuTienePermiso:()=>allow,
 HAIKU_RESERVA_ESTADOS_SUPABASE_V2:{cancelar:async(id,options)=>{if(!confirmAccepted)return;if(await options.antesDeCancelar()===false)return {estado:'sin_cambios'};writerCalls++;return {estado:'cancelada'};}}};
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-cancelaciones-v1.js','utf8'),context);
 return {api:context.HAIKU_LIBRO_CANCELACIONES_V1,context,caso,row,libro,cliente,calls:()=>writerCalls,change:()=>g++,deny:()=>allow=false,rejectConfirm:()=>confirmAccepted=false};
}

function visualEnvironment(){
 const x=environment();
 class Element {
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.textContent='';}
  append(...xs){this.children.push(...xs)} appendChild(x){this.children.push(x)} replaceChildren(...xs){this.children=xs}
  setAttribute(k,v){this[k]=v} addEventListener(k,f){this.events[k]=f}
 }
 x.context.document={createElement:t=>new Element(t)};x.context.addEventListener=(k,f)=>{x.onChange=f;};
 x.out=new Element('div');x.nodes=(el=x.out)=>[el,...el.children.flatMap(c=>x.nodes(c))];x.text=()=>x.nodes().map(e=>e.textContent).join(' ');
 return x;
}
test('visual cancellation card preserves source; original button prepares a read-only preview then completes',async()=>{
 const x=visualEnvironment(),detected=await x.api.detectarActual(sheet([],[e()]),x.cliente);
 x.api.adjuntar(x.out,detected,1);
 assert.equal(x.nodes().filter(n=>n.className?.includes('haiku-cancelacion-card')).length,1);
 for(const text of ['Carol Vega Ruiz','CAB 1','CANCELACIONES · Sep26 · D16','Proyecto H: Activa','2 noches'])assert.ok(x.text().includes(text),text);
 const button=x.nodes().find(n=>n.tag==='button');assert.equal(button.textContent,'Preparar cancelación');assert.equal(typeof button.events.click,'function');
 await button.events.click();assert.equal(x.calls(),0);
 for(const text of ['PREVISUALIZACIÓN · Sin escritura','01/09/2026 → 03/09/2026','Estado actual: Activa','Nuevo estado: Cancelada','Se revalidará después de confirmar.'])assert.ok(x.text().includes(text),text);
 assert.equal(button.textContent,'Confirmar cancelación');await button.events.click();assert.equal(x.calls(),1);assert.ok(button.disabled);assert.match(x.text(),/✓ Cancelación completada/);
});
test('resolved and manual-review cards preserve all cases and have no cancellation buttons',async()=>{
 const x=visualEnvironment();x.row.estado_reserva='cancelada';
 const result=await x.api.detectarActual(sheet([],[e()]),x.cliente);
 result.cancelaciones_revision=['Daniela Ubierna Yáñez · Sep26: La reserva no se identifica de forma única.','Aviso sin estructura: conservar todos los detalles.'];
 x.api.adjuntarResueltas(x.out,result);x.api.adjuntarRevision(x.out,result);
 assert.equal(x.nodes().filter(n=>n.tag==='section').length,3);assert.equal(x.nodes().filter(n=>n.tag==='button').length,0);
 for(const text of ['✓ Ya coincide','Proyecto H: Cancelada','No se requiere ninguna escritura.','CANCELACIONES · Sep26 · D16','Daniela Ubierna Yáñez','La reserva no se identifica de forma única.','Aviso sin estructura: conservar todos los detalles.','Sin acción automática.'])assert.ok(x.text().includes(text),text);
});
test('visual preview invalidation retains existing disabled button and prevents writing; ordinary result is untouched',async()=>{
 const x=visualEnvironment();const ordinary={reservas:[]};x.api.adjuntar(x.out,ordinary,1);x.api.adjuntarResueltas(x.out,ordinary);x.api.adjuntarRevision(x.out,ordinary);assert.equal(x.out.children.length,0);
 x.api.adjuntar(x.out,await x.api.detectarActual(sheet([],[e()]),x.cliente),1);const button=x.nodes().find(n=>n.tag==='button');
 await button.events.click();x.onChange();assert.ok(button.disabled);assert.match(x.text(),/El Libro cambió/);assert.doesNotMatch(x.text(),/PREVISUALIZACIÓN/);await button.events.click();assert.equal(x.calls(),0);
});

test('current cancellation is detected with no previous version or an identical previous version',async()=>{
 for(const previous of [null,sheet([],[e()])]){
  const x=environment(),reads=[];x.libro.consultarHoja=async(h,v)=>{reads.push(v);if(v==='anterior'){if(!previous)throw Error('No anterior');return previous;}return sheet([],[e()]);};
  const result=await x.api.detectarActual(sheet([],[e()]),x.cliente);
  assert.equal(result.cancelaciones_confirmadas.length,1);const caso=result.cancelaciones_confirmadas[0];
  assert.equal(caso.fuente,'libro_actual');assert.equal(caso.actual.cabana,1);
  const preview=await x.api.preparar(caso,1);assert.equal(x.calls(),0);
  await x.api.confirmar(preview);assert.equal(x.calls(),1);assert.ok(!reads.includes('anterior'));
 }
});
test('current cancellation conflicts, duplicate evidence, missing signals and non-active state require manual review',async()=>{
 for(const mutate of [
  (x,h)=>h.cancelaciones.push(e()),(x,h)=>h.reservas.push(r()),
  (x,h)=>h.cancelaciones[0].noches=3,(x,h)=>h.cancelaciones[0].correo='other@example.test',
  (x,h)=>Object.assign(h.cancelaciones[0],{noches:null,correo:null}),
  (x,h)=>h.cobertura.geometria=false,(x,h)=>x.row.estado_reserva='no_show',
  (x,h)=>x.row.estadias.push({...x.row.estadias[0],id:'s2'}),
  (x,h)=>x.row.titular_nombre='Carola Vega Ruiz',
  (x,h)=>x.row.estadias[0].fecha_ingreso='2026-09-02'
 ]){const x=environment(),h=sheet([],[e()]);mutate(x,h);const out=await x.api.detectarActual(h,x.cliente);assert.equal(out.cancelaciones_confirmadas.length,0);assert.ok(out.cancelaciones_revision.length);assert.equal(x.calls(),0);}
});
test('one extra exact signal suffices, normalized identity is exact, and two compatible reservations are ambiguous',async()=>{
 const x=environment();x.row.titular_nombre='  CÁROL   VEGA RUIZ ';
 for(const evidence of [{...e(),correo:null},{...e(),noches:null}])assert.equal((await x.api.detectarActual(sheet([],[evidence]),x.cliente)).cancelaciones_confirmadas.length,1);
 const from=x.cliente.from;x.cliente.from=t=>{const q=from(t);if(t==='reservas')q.range=async()=>({data:[x.row,{...x.row,id:'r2'}]});return q;};
 const out=await x.api.detectarActual(sheet([],[e()]),x.cliente);assert.equal(out.cancelaciones_confirmadas.length,0);assert.equal(out.cancelaciones_revision.length,1);
});
test('already cancelled and disappeared without CANCELACIONES never propose writing',async()=>{
 const x=environment();x.row.estado_reserva='cancelada';const out=await x.api.detectarActual(sheet([],[e()]),x.cliente);
 assert.equal(out.cancelaciones_confirmadas.length,0);assert.equal(out.cancelaciones_ya_coinciden.length,1);
 const p=await x.api.preparar(out.cancelaciones_ya_coinciden[0],1);assert.equal(p.estado,'ya_coincide');await x.api.confirmar(p);assert.equal(x.calls(),0);
 assert.equal((await x.api.detectarActual(sheet([]),x.cliente)).cancelaciones_confirmadas.length,0);
});
test('current preview revalidates generation, evidence, identity and target snapshot',async()=>{
 for(const mutate of [x=>x.change(),x=>x.libro.consultarHoja=async()=>sheet([]),x=>x.row.correo_contacto='changed@example.test',x=>x.row.id='r2']){
  const x=environment(),out=await x.api.detectarActual(sheet([],[e()]),x.cliente),p=await x.api.preparar(out.cancelaciones_confirmadas[0],1);
  mutate(x);await assert.rejects(x.api.confirmar(p));assert.equal(x.calls(),0);
 }
});
test('Carlos remains a normal modification while current Carol cancellation is independently detected; Sep26 payments unchanged',async()=>{
 const x=environment(),fixture=require('./fixtures/libro-pagos-sep26.cjs')(),h=S.normalizarHoja(fixture,'Sep26'),before=JSON.stringify(h);
 const carlos={...r(),titular:'Carlos Márquez'},old=sheet([carlos]),current=sheet([{...carlos,correo:'nuevo@example.test'}],[e()]);
 current.reservas[0].correo=carlos.correo;current.reservas[0].adultos=3;old.reservas[0].adultos=2;
 const diff=D.comparar([old],[current]);assert.equal(diff.modificadas.length,1);assert.equal(diff.modificadas[0].anterior.titular,'Carlos Márquez');
 assert.equal((await x.api.detectarActual(current,x.cliente)).cancelaciones_confirmadas.length,1);
 await x.api.detectarActual(h,x.cliente);assert.equal(JSON.stringify(h),before);
});
test('Libro vs Proyecto H consultation reads current CANCELACIONES without requesting previous sheet',async()=>{
 const x=environment(),reads=[];const ctx={structuredClone,HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_CANCELACIONES_V1:x.api};
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-consultas-v1.js','utf8'),ctx);
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Sep26'],consultarHoja:async(h,v)=>{reads.push(v||'actual');assert.notEqual(v,'anterior');return sheet([],[e()]);}};
 const out=await ctx.HAIKU_LIBRO_CONSULTAS.consultar('Libro: compara septiembre 2026',libro,x.cliente);
 assert.equal(out.cancelaciones_confirmadas.length,1);assert.equal(out.comparacion.length,0);assert.deepEqual(reads,['actual']);
});
test('preview is read-only and cancellation uses existing confirmation with second reading',async()=>{const x=environment(),p=await x.api.preparar(x.caso,1);assert.equal(p.estado,'propuesta');assert.equal(x.calls(),0);assert.equal((await x.api.confirmar(p)).estado,'cancelada');assert.equal(x.calls(),1);await assert.rejects(x.api.confirmar(p),/no válida/)});
test('already cancelled is no-op; confirmation refusal never writes',async()=>{const x=environment();x.row.estado_reserva='cancelada';const p=await x.api.preparar(x.caso,1);assert.equal(p.estado,'ya_coincide');await x.api.confirmar(p);assert.equal(x.calls(),0);const y=environment(),q=await y.api.preparar(y.caso,1);y.rejectConfirm();await y.api.confirmar(q);assert.equal(y.calls(),0)});
test('changed generation, target, permissions and evidence block before writing',async()=>{
 for(const mutate of [x=>x.change(),x=>x.row.titular_nombre='Otra Persona',x=>x.deny(),x=>x.libro.consultarHoja=async(h,v)=>v==='anterior'?sheet([r()]):sheet([])]){
 const x=environment(),p=await x.api.preparar(x.caso,1);mutate(x);await assert.rejects(x.api.confirmar(p));assert.equal(x.calls(),0);
 }
 const x=environment();x.row.estadias.push({...x.row.estadias[0],id:'s2'});await assert.rejects(x.api.preparar(x.caso,1),/segmentos/);
});
test('existing ficha cancellation runs the revalidation hook after native confirm, before its original RPC',async()=>{
 const src=fs.readFileSync('js/supabase-reserva-estados-v1.js','utf8');const fn=src.slice(src.indexOf('    async function cancelarReservaSupabase'),src.indexOf('    function datosVisualesConFullDay'));
 const calls=[],ctx={window:{confirm:()=>{calls.push('confirm');return true;}},cancelando:false,cliente:{rpc:async()=>{calls.push('rpc');return {data:{}};}},cerrarMenuEstado(){},cerrarFicha(){},retirarReservaDelCache(){},renderCalendarioInmediato(){},refrescarFuentesSupabase:async()=>{},console,alert(){}};vm.runInNewContext(fn+';this.run=cancelarReservaSupabase;',ctx);
 await ctx.run('r1',{antesDeCancelar:async()=>{calls.push('revalidar');return false;}});assert.deepEqual(calls,['confirm','revalidar']);calls.length=0;
 await ctx.run('r1');assert.deepEqual(calls,['confirm','rpc']);
});
