const test = require('node:test');
const assert = require('node:assert/strict');
global.HAIKU_LIBRO_SEMANTICA = require('../js/haiku-libro-semantica-v1.js');
const Q = require('../js/haiku-libro-consultas-v1.js');
const q = {desde:'2026-09-01',hasta:'2026-09-30'};
const book = (extra={}) => ({id:'b1',titular:'Marco Iturrieta',rut_documento:'12345678-9',cabana:1,
 fecha_checkin:'2026-09-17',fecha_checkout:'2026-09-20',tipo_estadia:'alojamiento',noches:3,
 pagos:[],pagos_sin_asociacion:[],servicios:[],advertencias:[],coordenadas_origen:{hoja:'Sep26',celda:'C3'},...extra});
function stay(r=book(), extra={}) {return {id:'e'+r.cabana,reserva_id:'r1',cabanas:{numero:r.cabana},
 fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,estado_estadia:'confirmada',tipo_estadia:r.tipo_estadia,
 reservas:{titular_nombre:r.titular,titular_numero_documento:r.rut_documento,estado_reserva:'confirmada'},...extra};}
function client(rows=[], payments=[]) {
 const calls=[];
 return {calls,auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(table){
  calls.push(table);let data={reserva_estadias:rows,pagos:payments,servicios:[]}[table];
  const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range(a,z){return Promise.resolve({data:data.slice(a,z+1)})}};
  return b;
 }};
}
const compare=(rs,ss=[],ps=[])=>Q.compararSistema(rs,client(ss,ps),q);
test('September 2026: two cabins in one reservation count as one complete logical group',async()=>{
 const a=book(),b=book({id:'b2',cabana:2}); const c=await compare([a,b],[stay(a),stay(b)]);
 assert.equal(c.meta.libro,1);assert.equal(c.meta.estadias_libro,2);assert.equal(c.meta.asociadas,1);assert.equal(c.meta.faltantes,0);
});
test('partial group proposes missing stay, never a new reservation',async()=>{
 const c=await compare([book(),book({id:'b2',cabana:2})],[stay()]);
 assert.equal(c.grupos[0].categoria,'estadia_faltante');assert.equal(c.grupos[0].estado,'ambigua');assert.equal(c.meta.faltantes,0);assert.ok(c.grupos[0].pregunta);
});
test('new multicabin group is one missing reservation',async()=>{
 const c=await compare([book(),book({id:'b2',cabana:2})]);assert.equal(c.meta.faltantes,1);
});
test('cabin change, dates and holder require a decision',async()=>{
 for(const [r,category] of [[book({cabana:3}),'posible_cambio_cabana'],[book({fecha_checkin:'2026-09-18'}),'modificacion_fechas_o_independiente'],[book({titular:'Otra Persona',rut_documento:'99999999-1'}),'modificacion_titular']]){
  const c=await compare([r],[stay()]);assert.equal(c[0].categoria,category);assert.equal(c.meta.faltantes,0);assert.ok(c[0].pregunta);
 }
});
test('same guest full day and overnight remain distinct, ask independent vs changed dates',async()=>{
 const a=book({fecha_checkin:'2026-09-03',fecha_checkout:'2026-09-04',cabana:5});
 const b=book({id:'b2',fecha_checkin:'2026-09-04',fecha_checkout:'2026-09-04',cabana:10,tipo_estadia:'full_day'});
 const c=await compare([a,b],[stay(a)]);assert.equal(c.meta.libro,2);assert.equal(c[1].estado,'ambigua');assert.match(c[1].pregunta,/independiente/);
});
test('conflicting documents never merge or auto-associate even with same name',async()=>{
 const c=await compare([book(),book({id:'b2',cabana:2,rut_documento:'99999999-1'})],[stay()]);
 assert.equal(c.meta.libro,2);const d=await compare([book({rut_documento:'99999999-1'})],[stay()]);assert.equal(d[0].estado,'ambigua');
});
test('two candidates and duplicate book rows stay ambiguous; cancelled stays are excluded',async()=>{
 assert.equal((await compare([book()],[stay(),stay(book(),{id:'e9',reserva_id:'r9'})]))[0].estado,'ambigua');
 assert.equal((await compare([book(),book({id:'copy'})],[stay()])).meta.asociadas,0);
 assert.equal((await compare([book()],[stay(book(),{estado_estadia:'cancelada'})]))[0].estado,'sin_coincidencia');
});
const pay=(extra={})=>({codigo_autorizacion:'AUTH-123',monto:100000,moneda:'CLP',tipo_movimiento:'alojamiento',origen:{hoja:'Sep26',celda:'O27:R27'},...extra});
test('safe new payment, existing payment and identifier attached elsewhere',async()=>{
 const r=book({pagos:[pay()]});
 assert.equal((await compare([r],[stay()])).pagosDetalle[0].estado,'nuevo_seguro');
 assert.equal((await compare([r],[stay()],[{...pay(),reserva_id:'r1'}])).pagosDetalle[0].estado,'en_sistema');
 assert.equal((await compare([r],[stay()],[{...pay(),reserva_id:'other'}])).pagosDetalle[0].estado,'revisar');
});
test('repeated book identifier, weak identifiers, penalties and missing reservation payments require review',async()=>{
 const c=await compare([book({pagos:[pay(),pay({origen:{hoja:'Sep26',celda:'Z30'}})]})],[stay()]);assert.ok(c.pagosDetalle.every(p=>p.estado==='revisar'));
 for(const p of [pay({codigo_autorizacion:null}),pay({tipo_movimiento:'penalidad'}),pay({monto:null})]) assert.equal((await compare([book({pagos:[p]})],[stay()])).pagosDetalle[0].estado,'revisar');
 assert.equal((await compare([book({pagos:[pay()]})])).pagosDetalle[0].estado,'revisar');
});
test('revalidation detects newly inserted payment using fresh read-only queries',async()=>{
 const payments=[],db=client([stay()],payments),r=book({pagos:[pay()]});
 assert.equal((await Q.compararSistema([r],db,q)).meta.pagos_faltantes,1);
 payments.push({...pay(),reserva_id:'r1'});
 assert.equal((await Q.compararSistema([r],db,q)).meta.pagos_faltantes,0);
 assert.deepEqual(db.calls,['reserva_estadias','pagos','servicios','reserva_estadias','pagos','servicios']);
});
test('text comparison hides XLSX coordinates and includes confidence/questions',async()=>{
 const c=await compare([book({cabana:2,pagos:[pay()]})],[stay()]);const text=Q.respuesta({q:{...q,comparar:true},comparacion:c});
 assert.doesNotMatch(text,/Sep26!|O27:R27/);assert.match(text,/confianza/);assert.match(text,/¿/);
});
test('empty valid book still queries and counts September system',async()=>{
 const c=await compare([], [stay()]);assert.equal(c.meta.proyecto,1);assert.equal(c.meta.faltantes,0);
});
test('visual report retains cards, confines coordinates to technical details and prepares decisions without writes',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 class Element {
  constructor(tag,text=''){this.tag=tag;this.textContent=text;this.children=[];this.style={};this.events={};this.dataset={};this.selectedIndex=0;}
  append(...xs){this.children.push(...xs)} replaceChildren(...xs){this.children=xs} addEventListener(k,f){this.events[k]=f}
  setAttribute(k,v){this[k]=v}
  get options(){return this.children} get text(){return this.textContent}
 }
 const document={createElement:t=>new Element(t),querySelector:()=>null};
 const context={HAIKU_LIBRO_SEMANTICA:global.HAIKU_LIBRO_SEMANTICA,document,addEventListener(){},Option:function(t,v){const e=new Element('option',t);e.value=v;return e;}};
 const source=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8').replace('Object.freeze({ interpretar, consultar, compararSistema, respuesta, crearPlanIncorporacion, prepararIncorporacion })','Object.freeze({ interpretar, consultar, compararSistema, respuesta, crearPlanIncorporacion, prepararIncorporacion, renderizarComparacion })');
 vm.runInNewContext(source,context);
 const c=await compare([book({cabana:2,pagos:[pay()]})],[stay()]),out=new Element('div');
 context.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out,{q,comparacion:c});
 const all=e=>[e,...e.children.flatMap(all)],nodes=all(out);
 assert.equal(out.className,'haiku-asistente-preview');assert.ok(nodes.some(e=>e.className==='haiku-asistente-preview-grid'));
 const technical=nodes.find(e=>e.tag==='details'&&e.children[0].textContent.startsWith('Detalles técnicos'));
 assert.ok(all(technical).some(e=>e.textContent.includes('Sep26!')));
 const normal=e=>e===technical?[]:[e.textContent,...e.children.flatMap(normal)];
 assert.doesNotMatch(normal(out).join(' '),/Sep26!/);
 const select=nodes.find(e=>e.tag==='select');select.selectedIndex=1;select.events.change();
 assert.ok(nodes.find(e=>e.textContent==='Preparar incorporación'));
 assert.match(normal(out).join(' '),/Son reservas independientes/);assert.match(normal(out).join(' '),/Sólo lectura/);
});

test('test/demo and cancelled/no-show candidates are excluded before every matching path',async()=>{
 for(const name of ['PRUEBA FULLDAY','TEST_FULLDAY','Reserva demo','Testing']) {
  const r=book({titular:name});
  const c=await compare([r],[stay(r)]);
  assert.equal(c[0].estado,'sin_coincidencia');assert.deepEqual(c[0].candidatos,[]);assert.equal(c.meta.proyecto,0);
 }
 for(const estado of ['cancelada','cancelado','cancelled','canceled','no-show','no_show','NO SHOW','noshow']) {
  for(const s of [stay(book(),{estado_estadia:estado}),stay(book(),{reservas:{...stay().reservas,estado_reserva:estado}})]) {
   const c=await compare([book()],[s]);assert.deepEqual(c[0].candidatos,[]);assert.equal(c.meta.asociadas,0);
  }
 }
 for(const titular of ['Sara Bertrand','Glenyfer Luque',"Yann O’Connell",'Vanessa Conoman','Dayana Luna','Hernán Guzmán','Michel Querales','Matías Fernández']) {
  const r=book({titular,rut_documento:null,fecha_checkin:'2026-09-01',fecha_checkout:'2026-09-02'});
  const fake=book({titular:'PRUEBA FULLDAY',fecha_checkin:'2026-09-09',fecha_checkout:'2026-09-09'});
  const c=await compare([r],[stay(fake,{estado_estadia:'cancelada'})]);
  assert.equal(c[0].estado,'sin_coincidencia');assert.deepEqual(c[0].candidatos,[]);
 }
});

test('same cabin and weak or masked phone never create unrelated-date candidates',async()=>{
 for(const telefono of ['sin teléfono','****1234','1234','+56 **** 1234']) {
  const r=book({titular:'Sara Bertrand',rut_documento:null,telefono,fecha_checkin:'2026-09-01',fecha_checkout:'2026-09-02'});
  const s=stay(book(),{reservas:{...stay().reservas,telefono_contacto:telefono}});
  const c=await compare([r],[s]);assert.equal(c[0].estado,'sin_coincidencia');assert.deepEqual(c[0].candidatos,[]);
 }
});

test('exact holder, dates and cabin associate without documents and despite excluded decoys',async()=>{
 for(const titular of ['Marco Iturrieta Rojas','Alejandro Ramos Donaire','Laura Mayorga Ocampo',"Yann O'Connell"]) {
  const r=book({titular,rut_documento:null,pagos:[pay()]});
  const s=stay(r,{reservas:{...stay(r).reservas,titular_nombre:titular.replace("'",'')}});
  const c=await compare([r],[s,stay(book({titular:'PRUEBA FULLDAY'}),{id:'test'})]);
  assert.equal(c[0].estado,'asociada');assert.equal(c.meta.asociadas,1);assert.equal(c.meta.ambiguas,0);
  assert.equal(c.meta.pagos_faltantes,1);assert.equal(c.pagosDetalle[0].estado,'nuevo_seguro');
 }
});

test('complete multicabin reservation group links explicit sibling reservations and retains missing payments',async()=>{
 const a=book({titular:'Marco Iturrieta Rojas',pagos:[pay()]}),b=book({titular:a.titular,id:'b2',cabana:2});
 const rows=[stay(a,{reservas:{...stay(a).reservas,grupo_reserva_id:'g1'}}),stay(b,{reserva_id:'r2',reservas:{...stay(b).reservas,grupo_reserva_id:'g1'}})];
 const c=await compare([a,b],rows);
 assert.equal(c.meta.asociadas,1);assert.equal(c.meta.ambiguas,0);assert.equal(c.meta.pagos_faltantes,1);
 assert.equal(c.grupos[0].pregunta,null);assert.equal(c.meta.faltantes,0);
});

test('payment on a securely matched stay stays safe while another cabin awaits a decision',async()=>{
 const a=book({pagos:[pay()]}),b=book({id:'b2',cabana:2});
 const c=await compare([a,b],[stay(a)]);
 assert.equal(c.grupos[0].estado,'ambigua');assert.equal(c.meta.pagos_faltantes,1);
 assert.equal(c.pagosDetalle[0].estado,'nuevo_seguro');
});

function renderHarness(reconsultar, db) {
 const fs=require('node:fs'),vm=require('node:vm');
 class Element {
  constructor(tag,text=''){this.tag=tag;this.textContent=text;this.children=[];this.style={};this.events={};this.dataset={};this.selectedIndex=0;}
  append(...xs){this.children.push(...xs)} replaceChildren(...xs){this.children=xs} addEventListener(k,f){this.events[k]=f}
  setAttribute(k,v){this[k]=v} get options(){return this.children} get text(){return this.textContent}
  querySelectorAll(selector){return this.children.flatMap(e=>[e,...e.querySelectorAll('*')]).filter(e=>
   selector==='*'||selector===e.tag||selector==='details[open]'&&e.tag==='details'&&e.open||
   selector.startsWith('.')&&(e.className||'').split(' ').includes(selector.slice(1)));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 }
 const context={HAIKU_LIBRO_SEMANTICA:global.HAIKU_LIBRO_SEMANTICA,document:{createElement:t=>new Element(t),querySelector:()=>null},addEventListener(){},
  haikuSupabase:db, reconsultar,Option:function(t,v){const e=new Element('option',t);e.value=v;return e;}};
 const source=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8')
  .replace('Object.freeze({ interpretar, consultar, compararSistema, respuesta, crearPlanIncorporacion, prepararIncorporacion })','Object.freeze({ interpretar, consultar, compararSistema, respuesta, crearPlanIncorporacion, prepararIncorporacion, renderizarComparacion })')
  .replace('const nuevo = await consultar(result.q.texto);','const nuevo = await root.reconsultar(result.q.texto);');
 vm.runInNewContext(source,context);
 const out=new Element('div');
 return {out,render:result=>context.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out,result),
  texts:()=>out.querySelectorAll('*').map(e=>e.textContent).join(' '),button:t=>out.querySelectorAll('button').find(e=>e.textContent===t)};
}

test('exact ambiguous stay offers association review, never modify or duplicate stay',async()=>{
 const r=book(),c=await compare([r,book({id:'copy'})],[stay(r)]),h=renderHarness();
 h.render({q,comparacion:c});
 const options=h.out.querySelectorAll('option').map(e=>e.textContent).join(' ');
 assert.match(options,/Es la misma reserva/);assert.doesNotMatch(options,/Modificar:|Añadir estadía a:/);
 const exact=await compare([r],[stay(r)]);h.render({q,comparacion:exact});
 assert.equal(h.out.querySelectorAll('select').length,0);
});

test('holder-only change never offers adding the already occupied stay',async()=>{
 const c=await compare([book({titular:'Otra Persona',rut_documento:'99999999-1'})],[stay()]),h=renderHarness();
 h.render({q,comparacion:c});assert.match(h.texts(),/Es la misma reserva/);assert.doesNotMatch(h.texts(),/Modificar:/);assert.doesNotMatch(h.texts(),/Añadir estadía a:/);
});

test('revalidation keeps open sections, reports persistent results and clears stale decisions',async()=>{
 const r=book({cabana:2}),c=await compare([r],[stay()]);let finish;
 const h=renderHarness(()=>new Promise(resolve=>finish=resolve));h.render({q:{...q,texto:'Libro: septiembre 2026 compara'},comparacion:c});
 const detail=h.out.querySelector('details');detail.open=true;
 const questions=h.out.querySelectorAll('div').find(e=>e.children.some(c=>c.tag==='label'));
 questions.className+=' haiku-reconciliacion-abierto';
 const select=h.out.querySelector('select');select.selectedIndex=1;select.events.change();
 const pending=h.button('Revalidar contra Proyecto H').events.click();
 assert.match(h.texts(),/Revalidando/);assert.equal(detail.open,true);
 finish({q,comparacion:c});await pending;
 assert.equal(h.out.querySelector('details').open,true);assert.ok(h.out.querySelector('.haiku-reconciliacion-abierto'));
 assert.match(h.texts(),/Revalidación completada/);assert.doesNotMatch(h.texts(),/Revalidando;/);
 assert.equal(h.out.querySelector('select').selectedIndex,0);
});

test('failed revalidation stays visible, prevents stale preparation and permits retry',async()=>{
 const c=await compare([book()],[stay()]);const h=renderHarness(async()=>{throw new Error('Sin conexión')});h.render({q,comparacion:c});
 await h.button('Revalidar contra Proyecto H').events.click();
 assert.match(h.texts(),/No se pudo revalidar: Sin conexión/);
 assert.equal(h.button('Revalidar contra Proyecto H').disabled,false);
 assert.equal(h.button('Preparar incorporación').disabled,true);
});

test('Yann and Alejandro: field comparison explains document conflict and preview association only',async()=>{
 for(const titular of ["Yann O'Connell",'Alejandro Ramos']) {
  const r=book({titular,correo:'a@example.test',telefono:'+56 9 1234 5678',pagos:[pay()]});
  const s=stay(r,{reservas:{...stay(r).reservas,titular_numero_documento:'99999999-1',correo_contacto:'b@example.test'}});
  const c=await compare([r],[s]),before=JSON.stringify(c),h=renderHarness();h.render({q,comparacion:c});
  const rows=h.out.querySelectorAll('tr');
  const row=name=>rows.find(e=>e.children[0].textContent===name).children.map(e=>e.textContent);
  assert.equal(row('Nombre')[3],'✅ coincide');assert.equal(row('CAB')[3],'✅ coincide');
  assert.equal(row('Check-In')[3],'✅ coincide');assert.equal(row('Check-Out')[3],'✅ coincide');
  assert.equal(row('RUT/documento')[3],'⚠️ difiere');assert.equal(row('Correo')[3],'⚠️ difiere');
  assert.equal(row('Teléfono')[3],'— sin dato');assert.match(h.texts(),/RUT\/documento difiere/);
  assert.doesNotMatch(h.texts(),/¿Cambió el titular|Modificar:/);
  const select=h.out.querySelector('select');assert.deepEqual(select.options.map(o=>o.value),['','asociar:e1','independiente']);
  select.selectedIndex=1;select.events.change();
  assert.match(h.texts(),/sin aprobar pagos automáticamente/);
  assert.equal(JSON.stringify(c),before);assert.equal(c.meta.pagos_faltantes,0);
 }
});

test('Macarena extension preserves the existing full day and offers only additive or independent decisions',async()=>{
 const a=book({titular:'Macarena Hurtado',cabana:5,fecha_checkin:'2026-09-03',fecha_checkout:'2026-09-04'});
 const b=book({...a,cabana:10,fecha_checkin:'2026-09-04',tipo_estadia:'full_day'});
 const c=await compare([a],[stay(b)]),h=renderHarness();h.render({q,comparacion:c});
 const select=h.out.querySelector('select');assert.deepEqual(select.options.map(o=>o.value),['','estadia:e10','independiente']);
 assert.match(h.texts(),/conservaría la reserva actual/);assert.doesNotMatch(h.texts(),/Modificar:/);
 select.selectedIndex=1;select.events.change();h.button('Preparar incorporación').events.click();
 assert.match(h.texts(),/CAB 10/);
 select.selectedIndex=2;select.events.change();assert.match(h.texts(),/Decisión actualizada/);
 assert.match(h.texts(),/Son reservas independientes/);
});

test('Angelo without candidate displays the blocking warning and only new or pending choices',async()=>{
 const c=await compare([book({titular:'Angelo Villegas',advertencias:['Check-Out deducido; revisar fecha.']})]),h=renderHarness();
 h.render({q,comparacion:c});const select=h.out.querySelector('select');
 assert.deepEqual(select.options.map(o=>o.value),['','nueva']);assert.match(h.texts(),/Check-Out deducido; revisar fecha/);
 assert.match(h.texts(),/No hay candidato real/);assert.doesNotMatch(h.texts(),/Modificar:|Añadir esta estadía/);
 assert.match(h.texts(),/Dejar pendiente — no se incorpora/);
 select.selectedIndex=1;select.events.change();h.button('Preparar incorporación').events.click();
 assert.match(h.texts(),/Tratar como reserva nueva — propondría crear una nueva reserva/);
 assert.equal(c.meta.faltantes,0);
});

test('eleven clear missing reservations remain unchanged alongside all preview decision categories',async()=>{
 const missing=Array.from({length:11},(_,i)=>book({id:'new'+i,titular:'Persona '+i,rut_documento:'doc'+i}));
 const c=await compare(missing),before=JSON.stringify(c),h=renderHarness();h.render({q,comparacion:c});
 assert.equal(c.meta.faltantes,11);assert.equal(h.out.querySelectorAll('select').length,0);
 assert.ok(h.button('Preparar incorporación'));
 assert.equal(JSON.stringify(c),before);
 const technical=h.out.querySelectorAll('details').find(e=>e.children[0].textContent.startsWith('Detalles técnicos XLSX'));
 assert.ok(technical);assert.ok(!technical.open);
});

test('partial multicabin offers missing stay addition while retaining safe payments',async()=>{
 const a=book({pagos:[pay()]}),b=book({id:'b2',cabana:2}),c=await compare([a,b],[stay(a)]),h=renderHarness();
 h.render({q,comparacion:c});assert.ok(h.out.querySelectorAll('option').some(o=>o.value==='estadia:e1'));
 assert.equal(c.meta.pagos_faltantes,1);assert.match(h.texts(),/Pagos nuevos seguros/);
});

const readyBook=(extra={})=>book({adultos:2,ninos:0,mascotas:0,...extra});
const readyPay=(extra={})=>pay({medio_pago:'efectivo',fecha_bloque:'2026-09-17',fecha_comprobante:'2026-09-10',pago_recibido:true,estado_pago:'registrado_en_libro',...extra});
const prepare=async(rs,rows=[],ps=[],dec=new Map(),approved=new Set())=>{
 const db=client(rows,ps),comparacion=await Q.compararSistema(rs,db,q);
 return Q.prepararIncorporacion({reservas:rs,q,comparacion},dec,approved,db);
};
test('preparation is idempotent, read only, preserves known data and groups multiple cabins',async()=>{
 const rs=[readyBook({correo:'guest@example.test'}),readyBook({id:'b2',cabana:2})];
 const a=await prepare(rs),b=await prepare(rs);assert.deepEqual(a,b);assert.equal(a.escrituraHabilitada,false);
 assert.equal(a.items.length,1);assert.equal(a.items[0].payload.estadias.length,2);
 assert.equal(a.items[0].payload.reserva.correo_contacto,'guest@example.test');assert.equal(a.items[0].payload.reserva.telefono_contacto,null);
 assert.deepEqual(a.permisos,['reservas.crear']);
});
test('fresh revalidation omits a reservation inserted after comparison',async()=>{
 const r=readyBook(),rows=[],db=client(rows),comparacion=await Q.compararSistema([r],db,q);
 rows.push(stay(r));const p=await Q.prepararIncorporacion({reservas:[r],q,comparacion},new Map(),new Set(),db);
 assert.equal(p.items[0].categoria,'omitidos');assert.equal(p.items.filter(i=>i.categoria==='nuevas').length,0);
});
test('all strong global identifiers omit payments on any reservation',async()=>{
 for(const fields of [{codigo_autorizacion:'AUTH-123'},{codigo_autorizacion:null,folio:'123',bovtar:'45'},{codigo_autorizacion:null,bove:'800'}]) {
 const p=readyPay(fields),r=readyBook({pagos:[p]}),plan=await prepare([r],[],[{...p,reserva_id:'another',datos_origen:{bovtar:p.bovtar}}]);
 assert.equal(plan.items.find(i=>i.id.startsWith('pago:')).categoria,'omitidos');
 }
});
test('Full Day remains same-day fullday with zero nights',async()=>{
 const p=await prepare([readyBook({tipo_estadia:'full_day',fecha_checkout:'2026-09-17'})]);
 const s=p.items[0].payload.estadias[0];assert.equal(s.datos.tipo_estadia,'fullday');assert.equal(s.noches,0);assert.equal(s.datos.fecha_ingreso,s.datos.fecha_salida);
});
test('payment for a new reservation carries a dependency and symbolic reference, never a fake ID',async()=>{
 const p=await prepare([readyBook({pagos:[readyPay()]})]);const r=p.items.find(i=>i.categoria==='nuevas'),pay=p.items.find(i=>i.categoria==='pagos');
 assert.ok(pay);assert.equal(pay.payload.reserva_ref,r.id);assert.equal(pay.payload.argumentos.p_reserva_id,null);assert.deepEqual(pay.dependeDe,[r.id]);
 assert.ok(p.permisos.includes('pagos.registrar'));
});
test('missing essentials block reservation and its payment, invalid rows are not silently lost',async()=>{
 const p=await prepare([readyBook({adultos:null,pagos:[readyPay()]})]);assert.equal(p.items[0].seleccionado,false);assert.match(p.items[0].motivos.join(' '),/adultos/);
 assert.equal(p.items.find(i=>i.id.startsWith('pago:')).categoria,'dudosos');
 const invalid=await prepare([readyBook({titular:null})]);assert.equal(invalid.items[0].categoria,'pendientes');
});
test('pending, new, association and additional-stay decisions are honored',async()=>{
 const r=readyBook({cabana:2}),c=await compare([r],[stay()]),key=c.grupos[0].clave;
 for(const [valor,cat] of [['','pendientes'],['independiente','nuevas'],['estadia:e1','estadias']]) {
 const p=await prepare([r],[stay()],[],new Map([[key,{valor}]]));assert.equal(p.items[0].categoria,cat);
 }
 const mismatch=readyBook({rut_documento:'99999999-1'}),cc=await compare([mismatch],[stay()]);
 const p=await prepare([mismatch],[stay()],[],new Map([[cc.grupos[0].clave,{valor:'asociar:e1'}]]));assert.equal(p.items[0].categoria,'asociadas');
});
test('partial multicabin adds only missing cabin',async()=>{
 const rs=[readyBook(),readyBook({id:'b2',cabana:2})],c=await compare(rs,[stay()]);
 const p=await prepare(rs,[stay()],[],new Map([[c.grupos[0].clave,{valor:'estadia:e1'}]]));
 assert.deepEqual(p.items[0].payload.estadias.map(s=>s.cabana_numero),[2]);assert.equal(p.items[0].payload.reserva_id,'r1');
});
test('same association and amount are omitted conservatively, repeated book IDs are not prepared twice',async()=>{
 const r=readyBook({pagos:[readyPay()]}),p=await prepare([r],[stay()],[{reserva_id:'r1',monto:100000,moneda:'CLP'}]);
 assert.equal(p.items.find(i=>i.id.startsWith('pago:')).categoria,'omitidos');
 const repeated=await prepare([readyBook({pagos:[readyPay(),readyPay({origen:{hoja:'Sep26',celda:'Z30'}})]})]);
 assert.ok(repeated.items.filter(i=>i.categoria==='pagos').length<=1);
});
test('wrong checkin block, pending money and unknown webpay subtype stay blocked',async()=>{
 for(const extra of [{fecha_bloque:'2026-09-18'},{pago_recibido:null,estado_pago:'pendiente'},{medio_pago:'webpay'}]) {
 const p=await prepare([readyBook({pagos:[readyPay(extra)]})]);assert.equal(p.items.find(i=>i.id.startsWith('pago:')).categoria,'dudosos');
 }
});
test('manual approval allows a weak identifier only after explicit review and cannot bypass missing data',async()=>{
 const rs=[readyBook({pagos:[readyPay({codigo_autorizacion:null})]})],p=await prepare(rs),item=p.items.find(i=>i.categoria==='dudosos');assert.equal(item.aprobable,true);
 const approved=await prepare(rs,[],[],new Map(),new Set([item.id]));assert.equal(approved.items.find(i=>i.id===item.id).categoria,'pagos');
});
test('second screen revalidates, shows all categories, enforces dependencies and disables confirmation',async()=>{
 const r=readyBook({pagos:[readyPay()]}),db=client(),c=await Q.compararSistema([r],db,q),h=renderHarness(null,db);
 h.render({q,reservas:[r],comparacion:c});await h.button('Preparar incorporación').events.click();
 assert.match(h.texts(),/Escritura real deshabilitada en modo de prueba/);
 for(const t of ['Reservas nuevas claras','Estadías/cabañas a añadir','Mismas reservas ya asociadas','Pagos nuevos seguros','Pagos dudosos','Casos pendientes','Ya existe / omitido']) assert.ok(h.texts().includes(t));
 assert.equal(h.button('Confirmar incorporación').disabled,true);assert.equal(h.button('Confirmar incorporación').events.click,undefined);
 const checks=h.out.querySelectorAll('input'),first=checks[0];first.checked=false;first.events.change();
 assert.equal(checks[1].disabled,true);assert.equal(checks[1].checked,false);
 assert.equal(db.calls.filter(x=>x==='pagos').length,2);
});
test('failed preparation never displays an actionable stale plan',async()=>{
 const r=readyBook(),c=await compare([r]),db=client();db.auth.getSession=async()=>{throw new Error('offline')};
 const h=renderHarness(null,db);h.render({q,reservas:[r],comparacion:c});await h.button('Preparar incorporación').events.click();
 assert.match(h.texts(),/No se pudo preparar: offline/);assert.equal(h.button('Confirmar incorporación'),undefined);
});

test('payment inserted meanwhile is omitted after preparing, not merely after comparison',async()=>{
 const r=readyBook({pagos:[readyPay()]}),payments=[],db=client([stay()],payments),comparacion=await Q.compararSistema([r],db,q);
 payments.push({...readyPay(),reserva_id:'r1'});
 const p=await Q.prepararIncorporacion({q,reservas:[r],comparacion},new Map(),new Set(),db);
 assert.equal(p.items.find(i=>i.id.startsWith('pago:')).categoria,'omitidos');
});
test('conflicting repeated identifier blocks the first payment too',async()=>{
 const p=await prepare([readyBook({pagos:[readyPay(),readyPay({monto:200000,origen:{hoja:'Sep26',celda:'Z1'}})]})]);
 assert.equal(p.items.filter(i=>i.categoria==='pagos').length,0);
});
test('grouped existing reservations retain payment destination per original reservation',async()=>{
 const a=readyBook({pagos:[readyPay()]}),b=readyBook({id:'b2',cabana:2});
 const rows=[stay(a,{reserva_id:'r1',reservas:{...stay(a).reservas,grupo_reserva_id:'g'}}),stay(b,{reserva_id:'r2',reservas:{...stay(b).reservas,grupo_reserva_id:'g'}})];
 const p=await prepare([a,b],rows);assert.equal(p.items[0].categoria,'asociadas');assert.equal(p.items.find(i=>i.categoria==='pagos').payload.argumentos.p_reserva_id,'r1');
});
test('source has no database mutators, global polling or enabled confirmation handler',()=>{
 const s=require('fs').readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
 assert.doesNotMatch(s,/\.\s*(insert|update|upsert|rpc)\s*\(|setInterval\s*\(|new MutationObserver/);
});
