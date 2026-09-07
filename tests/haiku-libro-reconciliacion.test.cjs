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
test('two candidates, duplicate book rows and cancelled reservations stay ambiguous',async()=>{
 assert.equal((await compare([book()],[stay(),stay(book(),{id:'e9',reserva_id:'r9'})]))[0].estado,'ambigua');
 assert.equal((await compare([book(),book({id:'copy'})],[stay()])).meta.asociadas,0);
 assert.equal((await compare([book()],[stay(book(),{estado_estadia:'cancelada'})]))[0].estado,'ambigua');
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
  get options(){return this.children} get text(){return this.textContent}
 }
 const document={createElement:t=>new Element(t),querySelector:()=>null};
 const context={HAIKU_LIBRO_SEMANTICA:global.HAIKU_LIBRO_SEMANTICA,document,addEventListener(){},Option:function(t,v){const e=new Element('option',t);e.value=v;return e;}};
 const source=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8').replace('Object.freeze({ interpretar, consultar, compararSistema, respuesta })','Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarComparacion })');
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
 nodes.find(e=>e.textContent==='Preparar vista previa').events.click();
 assert.match(normal(out).join(' '),/Es una reserva independiente/);assert.match(normal(out).join(' '),/escritura deshabilitada/);
});
