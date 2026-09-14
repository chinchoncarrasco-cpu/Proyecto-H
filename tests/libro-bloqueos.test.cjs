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

test('Sep26 BG3 FULLDAY on CAB 1 Sep 15 is independent of Gabriela Mora Full Day on Sep 16',()=>{
 for(const marcador of ['FULLDAY','FULL DAY']){
  const d=datos();d.celdas.pop();d.celdas.filter(c=>c.fechaISO).forEach((c,i)=>c.c=54+i*4);
  d.celdas.push({r:2,c:58,valor:marcador,estiloId:0},{r:2,c:62,valor:'Gabriela Mora // 2 ADL // FULLDAY',estiloId:2});
  d.combinaciones=[{s:{r:2,c:58},e:{r:2,c:60}},{s:{r:2,c:62},e:{r:2,c:64}}];
  const h=sem(d);assert.equal(h.bloqueos.length,1);assert.equal(h.reservas.length,1);
  const b=h.bloqueos[0],r=h.reservas[0];assert.equal(b.cabana,1);assert.equal(b.fecha_inicio,'2026-09-15');assert.equal(b.fecha_fin,'2026-09-16');
  assert.equal(b.origen.rango,'BG3:BI3');assert.equal(b.nota,marcador);assert.equal(b.evidencia.tipo,'marcador_full_day');
  assert.equal(r.titular,'Gabriela Mora');assert.equal(r.tipo_estadia,'full_day');assert.equal(r.cabana,1);assert.equal(r.fecha_checkin,'2026-09-16');assert.equal(r.fecha_checkout,'2026-09-16');
  assert.ok(!h.advertencias.some(a=>a.includes('BG3')));assert.ok(!h.espacios.some(e=>e.cabana===1&&e.fecha==='2026-09-15'));
  const sinMarcador=structuredClone(d);sinMarcador.celdas=sinMarcador.celdas.filter(c=>!(c.r===2&&c.c===58));sinMarcador.combinaciones.shift();
  const baseline=sem(sinMarcador);assert.deepEqual(h.reservas,baseline.reservas);assert.deepEqual(h.pagos,baseline.pagos);assert.deepEqual(h.cancelaciones,baseline.cancelaciones);
 }
});

test('isolated FULL DAY blocks exactly its calendar night, including month end, without duplicate categories',()=>{
 for(const fecha of ['2026-09-02','2026-09-30']) for(const red of [true,false]) for(const merged of [true,false]){
  const d=datos();d.celdas.filter(c=>c.fechaISO).forEach((c,i)=>c.fechaISO=S.sumarDias(fecha,i));
  Object.assign(d.celdas.at(-1),{r:4,valor:'FULL DAY',estiloId:red?0:2});
  d.combinaciones=merged?[{s:{r:4,c:2},e:{r:4,c:4}}]:[];
  const h=sem(d);assert.equal(h.bloqueos.length,1);const b=h.bloqueos[0];assert.equal(b.cabana,3);assert.equal(b.fecha_inicio,fecha);assert.equal(b.fecha_fin,S.sumarDias(fecha,1));assert.equal(b.nota,'FULL DAY');
  assert.equal(h.reservas.length,0);assert.ok(!h.espacios.some(x=>x.fecha===fecha&&x.cabana===3));assert.equal(b.evidencia.tipo,'marcador_full_day');
 }
});
test('FULL DAY with guest remains a real stay; ambiguous or out-of-grid markers are not automatic blocks',()=>{
 const d=datos();Object.assign(d.celdas.at(-1),{estiloId:2,valor:'Ana Pérez // ana@example.test // 2 ADL // FULL DAY'});
 const h=sem(d);assert.equal(h.bloqueos.length,0);assert.equal(h.reservas.length,1);assert.equal(h.reservas[0].tipo_estadia,'full_day');
 d.celdas.at(-1).valor='FULL DAY';d.combinaciones[0].e.c=8;const m=sem(d);assert.equal(m.bloqueos.length,0);assert.equal(m.reservas.length,0);assert.ok(m.advertencias.length);
 d.celdas.at(-1).r=20;d.combinaciones=[];assert.equal(sem(d).bloqueos.length,0);
});

test('CAB 2 reported multiline note is one structural block, never a guest or financial movement',()=>{
 const texto='LATE OUT 13,00 HRS DE CORTESIA\n(X HACER) REPONER:\n- leña\n- carbón\n- todos los amenities\n- 3 café\n- 3 te de hierba\nUsaron fogón y salamandra';
 const d=datos();d.celdas.filter(c=>c.fechaISO).forEach((c,i)=>c.fechaISO=`2026-09-${13+i}`);
 d.celdas.at(-1).r=3;d.celdas.at(-1).valor=texto;d.combinaciones[0].s.r=3;d.combinaciones[0].e.r=3;
 const h=sem(d);assert.equal(h.bloqueos.length,1);assert.equal(h.bloqueos[0].cabana,2);assert.equal(h.bloqueos[0].fecha_inicio,'2026-09-13');assert.equal(h.bloqueos[0].fecha_fin,'2026-09-14');assert.equal(h.bloqueos[0].nota,texto);
 assert.equal(h.reservas.length,0);assert.equal(h.pagos.length,0);
 d.combinaciones[0].e.c=12;const multi=sem(d);assert.equal(multi.bloqueos.length,1);assert.equal(multi.bloqueos[0].fecha_fin,'2026-09-16');assert.equal(multi.reservas.length,0);
});
test('complete red geometry does not need recognized operational vocabulary or reject isolated names',()=>{
 for(const texto of ['MANTENCION CALEFONT','NO VENDER / REPARAR JACUZZI','REVISAR EQUIPO ANTES DE HABILITAR','EQUIPO EN OBSERVACIÓN','Usaron fogón y salamandra','Ana Pérez']){
  const d=datos();d.celdas.at(-1).valor=texto;const h=sem(d);assert.equal(h.bloqueos.length,1,texto);assert.equal(h.bloqueos[0].nota,texto);assert.equal(h.reservas.length,0,texto);
 }
});
test('red contradictions and partial geometry are quarantined with exact source and warning',()=>{
 for(const value of ['Ana Pérez // correo@example.test // +56 9 1234 5678 // 2 ADL // 1 NOCHE','Ana Pérez // 2 ADL','Ana Pérez // AB1234567']){
  const d=datos();d.celdas.at(-1).valor=value;const h=sem(d);assert.equal(h.reservas.length,0);assert.equal(h.bloqueos.length,0);assert.match(h.advertencias.join(' '),/contradictorios/);assert.ok(h.anotaciones.some(a=>a.texto_original===value));
 }
 for(const mutate of [d=>d.combinaciones[0].e.c=3,d=>d.combinaciones=[],d=>d.combinaciones[0].e.r=12,d=>{d.celdas.at(-1).c=4;d.combinaciones[0].s.c=4;},d=>{d.combinaciones[0].e.c=8;d.celdas[1].fechaISO='2026-09-16';}]){
  const d=datos();d.celdas.at(-1).valor='Usaron fogón y salamandra';mutate(d);const h=sem(d);assert.equal(h.bloqueos.length,0);assert.equal(h.reservas.length,0);assert.ok(h.advertencias.length);
 }
 const d=datos();d.celdas.at(-1).estiloId=2;d.celdas.at(-1).valor='Ana Pérez // 1 noche // late checkout de cortesía';const h=sem(d);assert.equal(h.bloqueos.length,0);assert.equal(h.reservas.length,1);
});
test('CAB 10 reported text: complete solid red block becomes one semantic bloqueo, never a reservation',()=>{
 const d=datos(),before=JSON.stringify(d),h=sem(d);assert.equal(h.reservas.length,0);assert.equal(h.bloqueos.length,1);
 const b=h.bloqueos[0];assert.equal(b.cabana,10);assert.equal(b.fecha_inicio,'2026-09-14');assert.equal(b.fecha_fin,'2026-09-15');assert.equal(b.nota,nota);assert.equal(b.origen.rango,'C12:E12');assert.equal(b.evidencia.fondo,'FF0000');assert.equal(JSON.stringify(d),before);
});
test('multi-day merge is one block; two independent blocks stay separate',()=>{
 const d=datos();d.combinaciones[0].e.c=8;let h=sem(d);assert.equal(h.bloqueos.length,1);assert.equal(h.bloqueos[0].fecha_fin,'2026-09-16');
 d.celdas.push({r:11,c:10,valor:'NO VENDER',estiloId:0});d.combinaciones.push({s:{r:11,c:10},e:{r:11,c:12}});h=sem(d);assert.equal(h.bloqueos.length,2);assert.equal(h.bloqueos[1].fecha_inicio,'2026-09-16');assert.equal(h.reservas.length,0);
});
test('color alone never creates a block; real guests, pink, confirmed and full-day reservations remain',()=>{
 for(const estiloId of [1,2])for(const valor of ['Ana Pérez // 1 noche','Ana Pérez // full day','Ana Pérez // POSIBLE LATE CHECK OUT (X COORDINAR)','Ana Pérez (late check out)']){
  const d=datos();Object.assign(d.celdas.at(-1),{estiloId,valor});const h=sem(d);assert.equal(h.bloqueos.length,0,valor);assert.equal(h.reservas.length,1,valor);
 }
 for(const estiloId of [1,2]){const d=datos();d.celdas.at(-1).estiloId=estiloId;const h=sem(d);assert.equal(h.bloqueos.length,0);assert.equal(h.reservas.length,0);assert.ok(h.anotaciones.some(a=>a.texto_original===nota));}
});
test('operational vocabulary needs red fill, full availability geometry and no guest/booking structure',()=>{
 for(const valor of ['MANTENCIÓN','NO VENDER','BLOQUEADO','REPARACIÓN','PINTURA DE TECHO','SE REQUIERE HABILITAR ACCESO']){const d=datos();d.celdas.at(-1).valor=valor;assert.equal(sem(d).bloqueos.length,1,valor);}
 for(const mutate of [d=>d.celdas.at(-1).r=20,d=>d.combinaciones[0].e.r=12,d=>d.combinaciones[0].e.c=3,
  d=>d.celdas.at(-1).valor=nota+' // 1 noche',
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
function env(input,cabana=10){
 let generation=1,accepted=true;const h=input || sem(),blocks=[],stays=[],calls=[];
 const db={auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(table){
  calls.push(['select',table]);const q={select(){return q},eq(){return q},order(){return q},range:async(a,z)=>({data:(table==='cabanas'?[{id:'cab'+cabana,numero:cabana,activa:true}]:table==='bloqueos_cabana'?blocks:stays).slice(a,z+1)})};return q;
 },rpc:async(name,args)=>{calls.push(['rpc',name,args]);blocks.push({id:'block1',desde:args.p_desde+'T03:00:00Z',hasta:args.p_hasta+'T03:00:00Z',motivo:args.p_motivo,estado:'activo'});return {data:{bloqueo_id:'block1',ya_existia:false}};}};
 const libro={estado:()=>({generacion:generation,cargado:true}),listo:async()=>{},listarHojas:()=>['Sep26'],consultarHoja:async()=>structuredClone(h)};
 const context={structuredClone,Intl,Date,haikuSupabase:db,HAIKU_LIBRO_RESERVA_V1:libro,haikuTienePermiso:()=>true,confirm:()=>accepted};
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-bloqueos-v1.js','utf8'),context);
 return {api:context.HAIKU_LIBRO_BLOQUEOS_V1,context,h,b:h.bloqueos[0],db,libro,blocks,stays,calls,change:()=>generation++,decline:()=>accepted=false,writes:()=>calls.filter(c=>c[0]==='rpc')};
}

const septiembre={desde:'2026-09-01',hasta:'2026-09-30'};
const bloqueoH=(overrides={})=>({id:'h1',desde:'2026-09-14T03:00:00Z',hasta:'2026-09-15T03:00:00Z',motivo:nota,...overrides});
test('CAB 2 real DST interval of 23 hours is Ya coincide in both directions, with no additional write',async()=>{
 const x=env(undefined,2);Object.assign(x.b,{cabana:2,fecha_inicio:'2026-09-06',fecha_fin:'2026-09-07',nota:'LATE HASTA LAS 14:00'});
 x.blocks.push(bloqueoH({desde:'2026-09-06T04:00:00Z',hasta:'2026-09-07T03:00:00Z',motivo:x.b.nota}));
 assert.equal((Date.parse(x.blocks[0].hasta)-Date.parse(x.blocks[0].desde))/3600000,23);
 const r=await x.api.comparar([x.b],x.db,septiembre);
 assert.equal(r[0].estado,'ya_coincide');assert.equal(r.solo_proyecto_h.length,0);assert.equal(r.revision_inversa.length,0);
 assert.equal((await x.api.prepararTodos(r,1)).cantidad,0);
 assert.equal((await x.api.confirmar(await x.api.preparar(x.b,1))).estado,'ya_coincide');assert.equal(x.writes().length,0);
});
test('Santiago autumn night of 25 hours matches calendar dates without fixed duration',async()=>{
 const x=env();Object.assign(x.b,{fecha_inicio:'2026-04-04',fecha_fin:'2026-04-05'});
 x.blocks.push(bloqueoH({desde:'2026-04-04T03:00:00Z',hasta:'2026-04-05T04:00:00Z'}));
 assert.equal((Date.parse(x.blocks[0].hasta)-Date.parse(x.blocks[0].desde))/3600000,25);
 const r=await x.api.comparar([x.b],x.db,{desde:'2026-04-01',hasta:'2026-04-30'});
 assert.equal(r[0].estado,'ya_coincide');assert.equal(r.revision_inversa.length,0);assert.equal(r.solo_proyecto_h.length,0);assert.equal(x.writes().length,0);
});
test('DST day boundary also works as exclusive end, while actual partial starts and wrong notes still require review',async()=>{
 const x=env();Object.assign(x.b,{fecha_inicio:'2026-09-05',fecha_fin:'2026-09-06'});
 x.blocks.push(bloqueoH({desde:'2026-09-05T04:00:00Z',hasta:'2026-09-06T04:00:00Z'}));
 assert.equal((await x.api.revisar(x.b,x.db)).estado,'ya_coincide');
 Object.assign(x.b,{fecha_inicio:'2026-09-06',fecha_fin:'2026-09-07'});
 assert.equal((await x.api.revisar(x.b,x.db)).estado,'no_existe','end at first local instant does not extend into next day');
 for(const [start,end,day] of [['2026-09-06T04:00:00.001Z','2026-09-07T03:00:00Z','2026-09-06'],['2026-09-06T05:00:00Z','2026-09-07T03:00:00Z','2026-09-06'],['2026-09-07T04:00:00Z','2026-09-08T03:00:00Z','2026-09-07']]){
  x.b.fecha_inicio=day;x.b.fecha_fin=end.slice(0,10);Object.assign(x.blocks[0],{desde:start,hasta:end});assert.equal((await x.api.revisar(x.b,x.db)).estado,'revision');
 }
 Object.assign(x.b,{fecha_inicio:'2026-09-06',fecha_fin:'2026-09-07'});Object.assign(x.blocks[0],{desde:'2026-09-06T04:00:00Z',hasta:'2026-09-07T03:00:00Z',motivo:'Otro motivo'});
 assert.equal((await x.api.revisar(x.b,x.db)).estado,'revision');assert.equal(x.writes().length,0);
});
test('8 blocks with 3 existing including DST CAB 2 leave exactly 5 new in batch UI and preparation',async()=>{
 const x=env(undefined,2),days=[1,6,10,12,14,18,20,23],f=d=>'2026-09-'+String(d).padStart(2,'0');
 x.h.bloqueos=days.map((d,i)=>({...structuredClone(x.b),id:'block-'+i,cabana:2,fecha_inicio:f(d),fecha_fin:f(d+1),nota:d===6?'LATE HASTA LAS 14:00':'Operativo '+i}));
 for(const b of x.h.bloqueos.slice(0,3)){const offset=b.fecha_inicio<'2026-09-07'?'04':'03';x.blocks.push({id:b.id,desde:b.fecha_inicio+'T'+offset+':00:00Z',hasta:b.fecha_fin+'T'+(b.fecha_fin<'2026-09-06'?'04':'03')+':00:00Z',motivo:b.nota});}
 const r=await x.api.comparar(x.h.bloqueos,x.db,septiembre);assert.equal(r.filter(c=>c.estado==='ya_coincide').length,3);assert.equal(r.revision_inversa.length,0);
 class El{constructor(tag){this.tag=tag;this.children=[];}append(...xs){this.children.push(...xs)}setAttribute(){}addEventListener(){}}
 x.context.document={createElement:t=>new El(t)};x.context.addEventListener=()=>{};const out=new El('div');x.api.renderizar(out,r,1);
 const texts=n=>[n.textContent,...n.children.flatMap(texts)];assert.ok(texts(out).includes('Preparar todos los bloqueos nuevos (5)'));
 assert.equal((await x.api.prepararTodos(r,1)).cantidad,5);assert.equal(x.writes().length,0);
});
test('inverse comparison shares exact matching, never double counts, and keeps Libro-only preparable',async()=>{
 const x=env();x.blocks.push(bloqueoH());
 const result=await x.api.comparar([x.b],x.db,septiembre);
 assert.equal(result[0].estado,'ya_coincide');assert.equal(result.solo_proyecto_h.length,0);assert.equal(result.revision_inversa.length,0);
 assert.equal(x.calls.filter(c=>c[1]==='bloqueos_cabana').length,1,'reuse the forward read');
 x.blocks.length=0;const missing=await x.api.comparar([x.b],x.db,septiembre);
 assert.equal(missing[0].estado,'no_existe');assert.equal(missing.solo_proyecto_h.length,0);assert.equal(x.writes().length,0);
});
test('CAB 10 removed from current Libro appears once in inverse read-only UI, with no destructive action',async()=>{
 const x=env();x.h.bloqueos=[];x.blocks.push(bloqueoH({motivo:'POSIBLE LATE CHECK OUT (X COODRINAR)'}));
 // The real September sheet also has an unrelated quarantined FULLDAY at CAB 1 / BG3.
 x.h.advertencias.push('Sep26 · BG3: rojo de disponibilidad con datos contradictorios de reserva; requiere revisión manual.');
 x.h.anotaciones.push({texto_original:'FULLDAY',origen:{hoja:'Sep26',celda:'BG3'},cabana:1,advertencias:['con datos contradictorios de reserva']});
 x.context.HAIKU_LIBRO_SEMANTICA=S;
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-consultas-v1.js','utf8'),x.context);
 const before=JSON.stringify(x.h),result=await x.context.HAIKU_LIBRO_CONSULTAS.consultar('Libro: compara mes de septiembre 2026 con Proyecto H',x.libro,x.db);
 assert.equal(result.q.desde,'2026-09-01');assert.equal(result.q.hasta,'2026-09-30');assert.equal(result.bloqueos_lectura_segura,true);
 assert.equal(result.bloqueos_cabanas_revision.join(','),'1');
 const inverse=result.bloqueos_comparacion.solo_proyecto_h;
 assert.equal(inverse.length,1);assert.equal(inverse[0].cabana,10);assert.equal(inverse[0].fecha_inicio,'2026-09-14');assert.equal(inverse[0].fecha_fin,'2026-09-15');
 class El{constructor(tag){this.tag=tag;this.children=[];}append(...xs){this.children.push(...xs)}setAttribute(){}}
 x.context.document={createElement:t=>new El(t)};const out=new El('div');x.api.renderizar(out,result.bloqueos_comparacion,1);
 const nodes=n=>[n,...n.children.flatMap(nodes)],all=nodes(out),text=all.map(n=>n.textContent||'').join(' ');
 assert.match(text,/Bloqueos sólo en Proyecto H \(1\)/);assert.match(text,/POSIBLE LATE CHECK OUT \(X COODRINAR\)/);
 assert.match(text,/No aparece en el Libro actual/);assert.match(text,/Revisar antes de eliminar/);assert.match(text,/Sólo lectura/);
 const accordion=all.find(n=>n.tag==='details'&&n.children[0]?.textContent==='Bloqueos sólo en Proyecto H (1)');assert.equal(accordion.open,false);assert.equal(accordion.children[0].tag,'summary');
 assert.equal(all.filter(n=>n.tag==='button').length,0);assert.equal(x.writes().length,0);assert.equal(JSON.stringify(x.h),before);
 assert.equal(result.comparacion.length,0);assert.equal(result.reservas.length,0);
});
test('localized availability warning keeps its own cabin in inverse manual review without asserting absence',async()=>{
 const x=env();x.h.bloqueos=[];x.blocks.push(bloqueoH());
 x.h.advertencias.push('Sep26 · BC12: rojo de disponibilidad con datos contradictorios de reserva; requiere revisión manual.');
 x.h.anotaciones.push({origen:{hoja:'Sep26',celda:'BC12'},cabana:10});x.context.HAIKU_LIBRO_SEMANTICA=S;
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-consultas-v1.js','utf8'),x.context);
 const r=await x.context.HAIKU_LIBRO_CONSULTAS.consultar('Libro: compara mes de septiembre 2026 con Proyecto H',x.libro,x.db);
 assert.equal(r.bloqueos_comparacion.solo_proyecto_h.length,0);assert.equal(r.bloqueos_comparacion.revision_inversa.length,1);
 assert.match(r.bloqueos_comparacion.revision_inversa[0].mensaje,/No se puede afirmar/);assert.equal(x.writes().length,0);
});
test('two system blocks with one matched leave exactly one inverse item; duplicate rows do not inflate count',async()=>{
 const x=env();x.blocks.push(bloqueoH(),bloqueoH({id:'h2',desde:'2026-09-16T03:00:00Z',hasta:'2026-09-17T03:00:00Z'}));
 x.blocks.push({...x.blocks[1]});const result=await x.api.comparar([x.b],x.db,septiembre);
 assert.equal(result[0].estado,'ya_coincide');assert.equal(result.solo_proyecto_h.length,1);assert.equal(result.solo_proyecto_h[0].id,'h2');assert.equal(result.revision_inversa.length,0);
 assert.equal(x.writes().length,0);
});
test('FULL DAY matches in both directions without being declared absent',async()=>{
 const d=datos();d.celdas.at(-1).valor='FULL DAY';const x=env(sem(d));x.blocks.push(bloqueoH({motivo:'FULL DAY'}));
 const result=await x.api.comparar([x.b],x.db,septiembre);
 assert.equal(result[0].estado,'ya_coincide');assert.equal(result.solo_proyecto_h.length,0);assert.equal(result.revision_inversa.length,0);assert.equal(x.writes().length,0);
});
test('inverse respects period, CAB and half-open checkout without expanding the requested scope',async()=>{
 const x=env();x.blocks.push(bloqueoH());
 for(const scope of [{desde:'2026-09-15',hasta:'2026-09-30'},{desde:'2026-09-01',hasta:'2026-09-13'},{...septiembre,cabana:2}]){
  const result=await x.api.comparar([],x.db,scope);assert.equal(result.solo_proyecto_h.length,0);assert.equal(result.revision_inversa.length,0);
 }
 assert.equal((await x.api.comparar([],x.db,{desde:'2026-09-14',hasta:'2026-09-14'})).solo_proyecto_h.length,1);
 assert.equal((await x.api.comparar([],x.db)).solo_proyecto_h,undefined);assert.equal(x.writes().length,0);
});
test('different notes, partial ranges and overlapping system blocks remain manual review, never inverse-only',async()=>{
 for(const overrides of [{motivo:'Otra nota'},{hasta:'2026-09-14T12:00:00Z'}]){
  const x=env();x.blocks.push(bloqueoH(overrides));const result=await x.api.comparar([x.b],x.db,septiembre);
  assert.equal(result[0].estado,'revision');assert.equal(result.solo_proyecto_h.length,0);assert.equal(result.revision_inversa.length,1);assert.equal(x.writes().length,0);
 }
 const x=env();x.blocks.push(bloqueoH(),bloqueoH({id:'h2',motivo:'Otro'}));const result=await x.api.comparar([],x.db,septiembre);
 assert.equal(result.solo_proyecto_h.length,0);assert.equal(result.revision_inversa.length,2);
});
test('inverse read failure and incomplete semantic geometry never claim absence',async()=>{
 const x=env();x.db.from=()=>{throw Error('Sin acceso');};const result=await x.api.comparar([],x.db,septiembre);
 assert.equal(result.solo_proyecto_h.length,0);assert.match(result.error_inversa,/Sin acceso/);
 for(const unsafe of [{cobertura:{geometria:false}},{advertencias:['Sep26 · BC12: rojo de disponibilidad irregular; requiere revisión manual.']}]){
  const y=env();y.h.bloqueos=[];Object.assign(y.h,unsafe);y.blocks.push(bloqueoH());y.context.HAIKU_LIBRO_SEMANTICA=S;
  vm.runInNewContext(fs.readFileSync('js/haiku-libro-consultas-v1.js','utf8'),y.context);
  const r=await y.context.HAIKU_LIBRO_CONSULTAS.consultar('Libro: compara septiembre 2026',y.libro,y.db);
  assert.equal(r.bloqueos_lectura_segura,false);assert.equal(r.bloqueos_comparacion?.solo_proyecto_h,undefined);assert.equal(y.writes().length,0);
 }
});
test('inverse does not mutate reservations, payments, services or cancellations and only reads block sources',async()=>{
 const h=sem(require('./fixtures/libro-pagos-sep26.cjs')());h.servicios=[{id:'service-sentinel'}];h.cancelaciones=[{titular:'Cancellation sentinel'}];
 const x=env(h),before=JSON.stringify(h);x.blocks.push(bloqueoH());
 await x.api.comparar(h.bloqueos,x.db,septiembre);
 assert.equal(JSON.stringify(h),before);assert.equal(x.writes().length,0);
 assert.ok(x.calls.every(c=>c[0]==='select'&&['cabanas','bloqueos_cabana'].includes(c[1])));
});

test('FULL DAY marker reuses existing block preview: absent is preparable and existing is no-op',async()=>{
 const d=datos();d.celdas.at(-1).valor='FULL DAY';const x=env(sem(d));
 const preview=await x.api.preparar(x.b,1);assert.equal(preview.estado,'no_existe');assert.equal(x.writes().length,0);
 x.blocks.push({id:'existing',desde:'2026-09-14T03:00:00Z',hasta:'2026-09-15T03:00:00Z',motivo:'FULL DAY'});
 const existente=await x.api.preparar(x.b,1);assert.equal(existente.estado,'ya_coincide');await x.api.confirmar(existente);assert.equal(x.writes().length,0);
});
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
 const button=nodes().find(n=>n.tag==='button'&&n.textContent==='Preparar bloqueo');await button.events.click();assert.equal(x.writes().length,0);assert.equal(button.textContent,'Confirmar bloqueo');assert.match(text(),/PREVISUALIZACIÓN · Sin escritura/);
 x.change();onChange();assert.equal(button.disabled,true);await button.events.click();assert.equal(x.writes().length,0);assert.match(text(),/Propuesta invalidada/);
 const readonly=new Element('div');x.api.renderizar(readonly,[{...cases[0],estado:'revision',mensaje:'Reserva real en el intervalo'},{...cases[0],estado:'ya_coincide',mensaje:'Ya coincide'}],2);
 assert.equal(nodes(readonly).filter(n=>n.tag==='button').length,0);
});
test('new identical block after preview is no-op; concurrent confirms cannot send two RPC calls',async()=>{
 const x=env(),v=await x.api.preparar(x.b,1);x.blocks.push({id:'b1',desde:'2026-09-14T03:00:00Z',hasta:'2026-09-15T03:00:00Z',motivo:nota});
 assert.equal((await x.api.confirmar(v)).estado,'ya_coincide');assert.equal(x.writes().length,0);
 const y=env(),p=await y.api.preparar(y.b,1);const first=y.api.confirmar(p);await assert.rejects(y.api.confirmar(p),/en curso/);await first;assert.equal(y.writes().length,1);
});
