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
 return {api:context.HAIKU_LIBRO_CANCELACIONES_V1,caso,row,libro,calls:()=>writerCalls,change:()=>g++,deny:()=>allow=false,rejectConfirm:()=>confirmAccepted=false};
}
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
