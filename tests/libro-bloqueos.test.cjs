const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../js/haiku-libro-semantica-v1.js');
const nota='POSIBLE LATE CHECK OUT (X COORDINAR)';
// Fixture sintético con las fechas y el texto reportados; no sustituye al XLSX de Drive.
function datos(){
 const celdas=[],combinaciones=[],estilos=[{fill:{patternType:'solid',fgColor:{rgb:'FFFF0000'}}},{fill:{patternType:'solid',fgColor:{rgb:'FFF4CCCC'}}},{fill:{patternType:'solid',fgColor:{rgb:'FFB4A7D6'}}}];
 for(let i=0;i<4;i++)celdas.push({r:1,c:2+i*4,valor:String(14+i),fechaISO:`2026-09-${14+i}`});
 for(let i=1;i<=10;i++)celdas.push({r:i+1,c:0,valor:`cabaña ${i}`});
 celdas.push({r:24,c:2,valor:'Pagos de arriendos de hoy'},{r:11,c:2,valor:nota,estiloId:0});
 combinaciones.push({s:{r:11,c:2},e:{r:11,c:4}});
 return {celdas,combinaciones,estilos};
}
const sem=d=>S.normalizarHoja(d||datos(),'Sep26');
test('CAB 10 reported text: complete solid red block becomes one semantic bloqueo, never a reservation',()=>{
 const d=datos(),before=JSON.stringify(d),h=sem(d);assert.equal(h.reservas.length,0);assert.equal(h.bloqueos.length,1);
 const b=h.bloqueos[0];assert.equal(b.cabana,10);assert.equal(b.fecha_inicio,'2026-09-14');assert.equal(b.fecha_fin,'2026-09-15');assert.equal(b.nota,nota);assert.equal(b.origen.rango,'C12:E12');assert.equal(b.evidencia.fondo,'FF0000');assert.equal(JSON.stringify(d),before);
});
test('multi-day merge is one block; two independent blocks stay separate',()=>{
 const d=datos();d.combinaciones[0].e.c=8;let h=sem(d);assert.equal(h.bloqueos.length,1);assert.equal(h.bloqueos[0].fecha_fin,'2026-09-16');
 d.celdas.push({r:11,c:10,valor:'NO VENDER',estiloId:0});d.combinaciones.push({s:{r:11,c:10},e:{r:11,c:12}});h=sem(d);assert.equal(h.bloqueos.length,2);assert.equal(h.bloqueos[1].fecha_inicio,'2026-09-16');assert.equal(h.reservas.length,0);
});
test('color alone never creates a block; real guests, pink, confirmed and full-day reservations remain',()=>{
 for(const estiloId of [0,1,2])for(const valor of ['Ana Pérez // 1 noche','Ana Pérez // full day','Ana Pérez // POSIBLE LATE CHECK OUT (X COORDINAR)','Ana Pérez (late check out)']){
  const d=datos();Object.assign(d.celdas.at(-1),{estiloId,valor});const h=sem(d);assert.equal(h.bloqueos.length,0,valor);assert.equal(h.reservas.length,1,valor);
 }
 for(const estiloId of [1,2]){const d=datos();d.celdas.at(-1).estiloId=estiloId;const h=sem(d);assert.equal(h.bloqueos.length,0);assert.equal(h.reservas.length,0);assert.ok(h.anotaciones.some(a=>a.texto_original===nota));}
});
test('operational vocabulary needs red fill, full availability geometry and no guest/booking structure',()=>{
 for(const valor of ['MANTENCIÓN','NO VENDER','BLOQUEADO','REPARACIÓN','PINTURA DE TECHO','SE REQUIERE HABILITAR ACCESO']){const d=datos();d.celdas.at(-1).valor=valor;assert.equal(sem(d).bloqueos.length,1,valor);}
 for(const mutate of [d=>d.celdas.at(-1).r=20,d=>d.combinaciones[0].e.r=12,d=>d.combinaciones[0].e.c=3,
  d=>d.celdas.at(-1).valor=nota+' // 1 noche',d=>d.celdas.at(-1).valor=nota+' // Ana Pérez',
  d=>d.celdas.at(-1).valor=nota+' // AB1234567',
  d=>d.estilos[0].fill.fgColor={theme:5},d=>d.estilos[0].fill.patternType='darkGrid',
  d=>d.celdas.push({r:11,c:3,valor:'Ana Pérez'}),d=>d.celdas[1].fechaISO='2026-09-16']){
  const d=datos();mutate(d);if(d.celdas[1].fechaISO==='2026-09-16')d.combinaciones[0].e.c=8;assert.equal(sem(d).bloqueos.length,0);
 }
});
test('single-cell availability at daily width one is supported; unmerged partial red cell is not',()=>{
 const d=datos();d.combinaciones=[];assert.equal(sem(d).bloqueos.length,0);
 d.celdas.filter(c=>c.fechaISO).forEach((c,i)=>c.c=2+i);assert.equal(sem(d).bloqueos.length,1);
});
test('September fixture keeps identical payments and other reservations after adding a separate operational block',()=>{
 const d=require('./fixtures/libro-pagos-sep26.cjs')(),before=sem(d);d.estilos=datos().estilos;
 d.celdas.push({r:11,c:10,valor:nota,estiloId:0});d.combinaciones.push({s:{r:11,c:10},e:{r:11,c:12}});
 const after=sem(d);assert.equal(after.bloqueos.length,1);assert.deepEqual(after.pagos,before.pagos);assert.deepEqual(after.reservas,before.reservas);
});
function env(){
 let generation=1,accepted=true;const h=sem(),blocks=[],stays=[],calls=[];
 const db={auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(table){
  calls.push(['select',table]);const q={select(){return q},eq(){return q},order(){return q},range:async(a,z)=>({data:(table==='cabanas'?[{id:'cab10',numero:10,activa:true}]:table==='bloqueos_cabana'?blocks:stays).slice(a,z+1)})};return q;
 },rpc:async(name,args)=>{calls.push(['rpc',name,args]);blocks.push({id:'block1',desde:args.p_desde+'T03:00:00Z',hasta:args.p_hasta+'T03:00:00Z',motivo:args.p_motivo,estado:'activo'});return {data:{bloqueo_id:'block1',ya_existia:false}};}};
 const libro={estado:()=>({generacion:generation,cargado:true}),listo:async()=>{},listarHojas:()=>['Sep26'],consultarHoja:async()=>structuredClone(h)};
 const context={structuredClone,Intl,Date,haikuSupabase:db,HAIKU_LIBRO_RESERVA_V1:libro,haikuTienePermiso:()=>true,confirm:()=>accepted};
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-bloqueos-v1.js','utf8'),context);
 return {api:context.HAIKU_LIBRO_BLOQUEOS_V1,context,h,b:h.bloqueos[0],db,libro,blocks,stays,calls,change:()=>generation++,decline:()=>accepted=false,writes:()=>calls.filter(c=>c[0]==='rpc')};
}
test('preview is read-only; explicit confirmation revalidates and calls only the existing block RPC with the exact note',async()=>{
 const x=env(),v=await x.api.preparar(x.b,1);assert.equal(x.writes().length,0);assert.equal(v.estado,'no_existe');
 const result=await x.api.confirmar(v);assert.equal(result.estado,'creado');assert.equal(x.writes().length,1);
 assert.equal(x.writes()[0][1],'haiku_registrar_bloqueo_calendario');assert.equal(x.writes()[0][2].p_motivo,nota);assert.equal(x.writes()[0][2].p_hasta,'2026-09-15');await assert.rejects(x.api.confirmar(v),/no válida/);
});
test('exact existing block is Ya coincide with no write; a covering block with another note is manual review',async()=>{
 const x=env();x.blocks.push({id:'b1',desde:'2026-09-14T03:00:00Z',hasta:'2026-09-15T03:00:00Z',motivo:nota});
 assert.equal((await x.api.revisar(x.b,x.db)).estado,'ya_coincide');await x.api.confirmar(await x.api.preparar(x.b,1));assert.equal(x.writes().length,0);
 x.blocks[0].motivo='Otro motivo';assert.equal((await x.api.revisar(x.b,x.db)).estado,'revision');
 x.blocks[0].hasta='2026-09-14T12:00:00Z';assert.equal((await x.api.revisar(x.b,x.db)).estado,'revision');
});
test('real stay collisions and Full Day block preparation, while half-open checkout and cancelled stays do not',async()=>{
 for(const e of [{fecha_ingreso:'2026-09-13',fecha_salida:'2026-09-15',tipo_estadia:'alojamiento'},{fecha_ingreso:'2026-09-14',fecha_salida:'2026-09-14',tipo_estadia:'fullday'}]){
  const x=env();x.stays.push({...e,estado_estadia:'confirmada'});assert.equal((await x.api.revisar(x.b,x.db)).estado,'revision');await assert.rejects(x.api.preparar(x.b,1));assert.equal(x.writes().length,0);
 }
 const x=env();x.stays.push({fecha_ingreso:'2026-09-13',fecha_salida:'2026-09-14',tipo_estadia:'alojamiento',estado_estadia:'checked_out'});assert.equal((await x.api.revisar(x.b,x.db)).estado,'no_existe');
 x.stays[0].fecha_salida='2026-09-16';x.stays[0].estado_estadia='cancelada';assert.equal((await x.api.revisar(x.b,x.db)).estado,'no_existe');
});
test('changed Libro, evidence, permission, cabin or a new conflict prevents confirmation writing',async()=>{
 for(const mutate of [x=>x.change(),x=>x.h.bloqueos[0].nota='NO VENDER',x=>x.context.haikuTienePermiso=()=>false,
  x=>x.stays.push({fecha_ingreso:'2026-09-14',fecha_salida:'2026-09-16',tipo_estadia:'alojamiento',estado_estadia:'confirmada'})]){
  const x=env(),v=await x.api.preparar(x.b,1);mutate(x);await assert.rejects(x.api.confirmar(v));assert.equal(x.writes().length,0);
 }
 const x=env(),v=await x.api.preparar(x.b,1);x.decline();assert.equal((await x.api.confirmar(v)).estado,'sin_confirmar');assert.equal(x.writes().length,0);
});
test('unavailable writer and note-trimming are blocked; read errors and duplicate Libro blocks remain review',async()=>{
 const x=env();x.db.rpc=undefined;assert.equal((await x.api.revisar(x.b,x.db)).estado,'revision');
 const y=env();y.b.nota+=' ';assert.equal((await y.api.revisar(y.b,y.db)).estado,'revision');
 assert.ok((await y.api.comparar([y.b,{...y.b,id:'other'}],y.db)).every(c=>c.estado==='revision'));
 y.db.from=()=>{throw Error('Sin acceso');};assert.equal((await y.api.comparar([y.b],y.db))[0].estado,'revision');
});
test('monthly comparison exposes blocks separately and does not create a new guest or generic incorporation item',async()=>{
 const x=env();x.context.HAIKU_LIBRO_SEMANTICA=S;
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-consultas-v1.js','utf8'),x.context);
 const q=x.context.HAIKU_LIBRO_CONSULTAS,result=await q.consultar('Libro: compara septiembre 2026',x.libro,x.db);
 assert.equal(result.reservas.length,0);assert.equal(result.bloqueos.length,1);assert.equal(result.bloqueos_comparacion[0].estado,'no_existe');
 assert.equal(result.comparacion.length,0);assert.equal(x.writes().length,0);
 const plan=q.crearPlanIncorporacion(result.reservas,result.comparacion);assert.equal(plan.items.length,0);
});
test('block card retains source and exact note, previews without writes, and Libro event disables confirmation',async()=>{
 const x=env();class Element{
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.events={};}
  append(...xs){this.children.push(...xs)}setAttribute(k,v){this[k]=v}addEventListener(k,f){this.events[k]=f}
 }
 let onChange;x.context.document={createElement:t=>new Element(t)};x.context.addEventListener=(event,fn)=>{assert.equal(event,'haiku:libro-cambio');onChange=fn;};
 const out=new Element('div'),nodes=(n=out)=>[n,...n.children.flatMap(c=>nodes(c))],text=()=>nodes().map(n=>n.textContent).join(' ');
 const cases=await x.api.comparar([x.b],x.db);x.api.renderizar(out,cases,1);
 assert.equal(nodes().filter(n=>n.tag==='section').length,1);assert.match(text(),/Bloqueos del Libro \(1\)/);assert.ok(text().includes(nota));assert.match(text(),/Sep26 · C12:E12/);
 const button=nodes().find(n=>n.tag==='button');await button.events.click();assert.equal(x.writes().length,0);assert.equal(button.textContent,'Confirmar bloqueo');assert.match(text(),/PREVISUALIZACIÓN · Sin escritura/);
 x.change();onChange();assert.equal(button.disabled,true);await button.events.click();assert.equal(x.writes().length,0);assert.match(text(),/Propuesta invalidada/);
 const readonly=new Element('div');x.api.renderizar(readonly,[{...cases[0],estado:'revision',mensaje:'Reserva real en el intervalo'},{...cases[0],estado:'ya_coincide',mensaje:'Ya coincide'}],2);
 assert.equal(nodes(readonly).filter(n=>n.tag==='button').length,0);
});
test('new identical block after preview is no-op; concurrent confirms cannot send two RPC calls',async()=>{
 const x=env(),v=await x.api.preparar(x.b,1);x.blocks.push({id:'b1',desde:'2026-09-14T03:00:00Z',hasta:'2026-09-15T03:00:00Z',motivo:nota});
 assert.equal((await x.api.confirmar(v)).estado,'ya_coincide');assert.equal(x.writes().length,0);
 const y=env(),p=await y.api.preparar(y.b,1);const first=y.api.confirmar(p);await assert.rejects(y.api.confirmar(p),/en curso/);await first;assert.equal(y.writes().length,1);
});
