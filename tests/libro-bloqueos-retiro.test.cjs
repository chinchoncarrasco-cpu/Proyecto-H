const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class El{
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.events={};this.disabled=false;}
 append(...xs){this.children.push(...xs)}replaceChildren(...xs){this.children=xs}setAttribute(){}addEventListener(k,f){this.events[k]=f}
}
const nodes=n=>[n,...n.children.flatMap(nodes)],text=n=>nodes(n).map(x=>x.textContent).join('\n');
function env(){
 let generation=1,accepted=true;const calls=[],confirms=[],listeners=[];
 const row={id:'block1',cabana_id:'cab10',desde:'2026-09-14T03:00:00Z',hasta:'2026-09-15T03:00:00Z',motivo:'POSIBLE LATE CHECK OUT (X COODRINAR)',estado:'activo',actualizado_en:'2026-09-14T10:00:00.123456Z'};
 const rows=[row],h={bloqueos:[],reservas:[],cobertura:{geometria:true}},periodo={texto:'Libro: compara septiembre 2026 con Proyecto H',desde:'2026-09-01',hasta:'2026-09-30'};
 const libro={estado:()=>({generacion:generation}),consultarHoja:async()=>structuredClone(h)};
 const db={auth:{getSession:async()=>({data:{session:{user:{id:'user'}}}})},from(table){
  calls.push(['select',table]);const filters=[];
  const result=()=>({data:(table==='cabanas'?[{id:'cab10',numero:10,activa:true}]:table==='bloqueos_cabana'?rows:[]).filter(r=>filters.every(([k,v])=>r[k]===v)).map(r=>({...r}))});
  const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},range:async()=>result(),limit:async()=>result()};return q;
 },rpc:async(name,args)=>{calls.push(['rpc',name,args]);assert.equal(name,'haiku_liberar_bloqueo_libro_seguro');assert.equal(args.p_actualizado_en,row.actualizado_en);row.estado='liberado';return {data:{bloqueo_id:row.id,resultado:'liberado',estado:'liberado'}};}};
 const ctx={structuredClone,Intl,Date,haikuSupabase:db,HAIKU_LIBRO_RESERVA_V1:libro,haikuTienePermiso:()=>true,confirm:t=>{confirms.push(t);return accepted;},document:{createElement:t=>new El(t)},addEventListener:(e,f)=>listeners.push(f)};
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-bloqueos-v1.js','utf8'),ctx);
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-bloqueos-retiro-v1.js','utf8'),ctx);
 const blocks=ctx.HAIKU_LIBRO_BLOQUEOS_V1,api=ctx.HAIKU_LIBRO_BLOQUEOS_RETIRO_V1;
 ctx.HAIKU_LIBRO_CONSULTAS={consultar:async()=>{calls.push(['libro']);const actual=await libro.consultarHoja();return {generacion:generation,bloqueos_comparacion:await blocks.comparar(actual.bloqueos,db,periodo)};}};
 const compare=()=>blocks.comparar(h.bloqueos,db,periodo);
 return {ctx,api,blocks,row,rows,h,db,libro,calls,confirms,compare,decline:()=>accepted=false,change:()=>{generation++;listeners.forEach(f=>f());},writes:()=>calls.filter(c=>c[0]==='rpc'),book:()=>({id:'Sep26!BC12',cabana:10,fecha_inicio:'2026-09-14',fecha_fin:'2026-09-15',nota:row.motivo,origen:{hoja:'Sep26',rango:'BC12:BE12'},evidencia:{geometria:'disponibilidad_completa'}}),item:async()=>(await compare()).solo_proyecto_h[0]};
}
test('inverse-only item has preparation; preview and cancelled native confirmation never write',async()=>{
 const x=env(),r=await x.compare(),out=new El('div');x.blocks.renderizar(out,r,1);
 const button=nodes(out).find(n=>n.textContent==='Preparar eliminación');assert.ok(button);await button.events.click();
 assert.equal(x.writes().length,0);assert.match(text(out),/PREVISUALIZACIÓN · Sin escritura/);assert.match(text(out),/Este bloqueo existe en Proyecto H/);assert.equal(button.textContent,'Confirmar eliminación');
 x.decline();await button.events.click();assert.equal(x.writes().length,0);assert.equal(x.confirms.length,1);assert.match(text(out),/Confirmación cancelada/);
});
test('reappearing Libro block or generation change after preview prevents RPC',async()=>{
 for(const mutate of [x=>x.h.bloqueos.push(x.book()),x=>x.change()]){
  const x=env(),p=await x.api.preparar(await x.item(),1);mutate(x);await assert.rejects(x.api.confirmar(p),/Libro|revisión/);assert.equal(x.writes().length,0);
 }
});
test('CAB, interval, motive, identifier and timestamp changes all abort frontend revalidation',async()=>{
 for(const [key,value] of [['cabana_id','other-cab'],['desde','2026-09-13T03:00:00Z'],['hasta','2026-09-16T03:00:00Z'],['motivo','Otro'],['actualizado_en','2026-09-14T10:00:00.123457Z']]){
  const x=env(),p=await x.api.preparar(await x.item(),1);x.row[key]=value;await assert.rejects(x.api.confirmar(p),/cambió|revisión/);assert.equal(x.writes().length,0);
 }
 const x=env(),p=await x.api.preparar(await x.item(),1);x.row.id='replacement';assert.equal((await x.api.confirmar(p)).estado,'ya_no_existe');assert.equal(x.writes().length,0);
});
test('already released and missing IDs return idempotent outcomes without RPC',async()=>{
 for(const removed of [false,true]){const x=env(),p=await x.api.preparar(await x.item(),1);if(removed)x.rows.length=0;else x.row.estado='liberado';const r=await x.api.confirmar(p);assert.equal(r.estado,removed?'ya_no_existe':'ya_liberado');assert.equal(x.writes().length,0);}
});
test('successful release uses exact version, second reading and only the new RPC; UI removes item after requery',async()=>{
 const x=env(),out=new El('div');x.blocks.renderizar(out,await x.compare(),1);const button=nodes(out).find(n=>n.textContent==='Preparar eliminación');
 await button.events.click();const before=x.calls.filter(c=>c[0]==='libro').length;await button.events.click();
 assert.equal(x.writes().length,1);assert.equal(x.writes()[0][2].p_actualizado_en,'2026-09-14T10:00:00.123456Z');assert.equal(x.row.estado,'liberado');
 assert.ok(x.calls.filter(c=>c[0]==='libro').length>=before+2);assert.doesNotMatch(text(out),/Bloqueos sólo en Proyecto H \(1\)/);assert.match(text(out),/Bloqueo liberado/);
});
test('matched and ambiguous cases never show retirement action; unversioned rows remain read-only',async()=>{
 for(const scenario of ['match','ambiguous','unversioned']){
  const x=env();if(scenario==='unversioned')delete x.row.actualizado_en;else{x.h.bloqueos.push(x.book());if(scenario==='ambiguous')x.h.bloqueos[0].nota='Otro';}
  const out=new El('div');x.blocks.renderizar(out,await x.compare(),1);assert.ok(!nodes(out).some(n=>n.textContent==='Preparar eliminación'));assert.equal(x.writes().length,0);
 }
});
test('backend conflict after frontend read is surfaced without retries, and tampered public preview cannot change payload',async()=>{
 const x=env(),p=await x.api.preparar(await x.item(),1);p.bloqueo.sistema.actualizado_en='tampered';p.bloqueo.id='tampered';
 x.db.rpc=async(name,args)=>{x.calls.push(['rpc',name,args]);assert.equal(args.p_bloqueo_id,'block1');assert.equal(args.p_actualizado_en,x.row.actualizado_en);return {error:Error('El bloqueo cambió desde la vista previa. Requiere revisión.')};};
 await assert.rejects(x.api.confirmar(p),/cambió/);assert.equal(x.row.estado,'activo');await assert.rejects(x.api.confirmar(p),/Propuesta no válida/);assert.equal(x.writes().length,1);
});
test('SQL checks expected version and identity after locking, without replacing the calendar function',()=>{
 const sql=fs.readFileSync('supabase/migrations/20260914155231_liberar_bloqueo_libro_seguro.sql','utf8');
 assert.ok(sql.indexOf('for update of b, c')<sql.indexOf('v_bloqueo.actualizado_en is distinct from p_actualizado_en'));
 assert.ok(sql.indexOf('v_bloqueo.actualizado_en is distinct from p_actualizado_en')<sql.indexOf('update public.bloqueos_cabana'));
 assert.doesNotMatch(sql,/create(?: or replace)? function public.haiku_liberar_bloqueo_calendario/i);assert.doesNotMatch(sql,/delete from/i);
});
