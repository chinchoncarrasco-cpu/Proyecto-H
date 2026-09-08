const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_SEMANTICA = S;
const Q = require('../js/haiku-libro-consultas-v1.js');
const row = (extra = {}) => ({id:'Sep26!BO3',titular:'Marco Iturrieta Rojas',cabana:1,
 fecha_checkin:'2026-09-17',fecha_checkout:'2026-09-20',tipo_estadia:'alojamiento',
 rut_documento:'12345678-9',correo:'marco@example.test',telefono:'+56912345678',adultos:2,
 pagos:[],pagos_sin_asociacion:[],cobertura_pagos:true,servicios:[],notas_importantes:[],advertencias:[],
 coordenadas_origen:{hoja:'Sep26',celda:'BO3'},...extra});
const cab2 = extra => row({id:'Sep26!BO4',cabana:2,coordenadas_origen:{hoja:'Sep26',celda:'BO4'},...extra});
const sheet = reservas => ({hoja:'Sep26',cobertura:{geometria:true,pagos:true},reservas});
const compare = (a,b) => S.compararVersiones(sheet(a),sheet(b));
const pay = (extra={}) => ({codigo_autorizacion:'AUTH1',monto:147930,moneda:'CLP',concepto:'Arriendo',tipo_movimiento:'alojamiento',estado_pago:'registrado_en_libro',origen:{hoja:'Sep26',celda:'BO30:BR30'},...extra});
const freeze = x => {Object.freeze(x);Object.values(x).forEach(v=>{if(v&&typeof v==='object')freeze(v)});return x};

test('Marco: CAB1+CAB2 is exactly one unchanged logical reservation, regardless of row order or coordinates',()=>{
 const before=freeze(sheet([row(),cab2()])),after=freeze(sheet([cab2({id:'moved'}),row({id:'other',coordenadas_origen:{hoja:'Sep26',celda:'XX3'}})]));
 const result=S.compararVersiones(before,after);
 assert.equal(result.length,1);assert.equal(result[0].tipo,'sin_cambios');assert.deepEqual(result[0].actual.cabanas,[1,2]);assert.deepEqual(result[0].diferencias,[]);
});
test('matching also groups Marco without contact data, normalizing accents and whitespace',()=>{
 const a=row({rut_documento:null,correo:null,telefono:null}),b=cab2({rut_documento:null,correo:null,telefono:null,titular:'  MARCO   ITURRIETA RÓJAS '});
 assert.deepEqual(compare([a,b],[b,a]).map(c=>c.tipo),['sin_cambios']);
});
test('adding and removing one cabin are modifications, never duplicate new/disappeared reservations',()=>{
 for(const [a,b,type] of [[[row()],[row(),cab2()],'cabana_agregada'],[[row(),cab2()],[row()],'cabana_eliminada']]){
  const c=compare(a,b);assert.equal(c.length,1);assert.equal(c[0].tipo,'modificada');assert.equal(c[0].diferencias[0].tipo,type);
 }
});
test('real removal and real new reservations',()=>{
 assert.equal(compare([row()],[])[0].tipo,'ya_no_aparece');assert.equal(compare([],[row(),cab2()])[0].tipo,'nueva');
});
test('specific date, contact, guest, state, notes and services changes',()=>{
 for(const [campo,v] of Object.entries({fecha_checkin:'2026-09-18',fecha_checkout:'2026-09-21',correo:'new@example.test',telefono:'+56987654321',adultos:3,ninos:2,mascotas:1,estado_operativo:'hospedada',estado_confirmacion:'confirmada_por_color',notas_importantes:['Llega tarde'],servicios:[{concepto:'jacuzzi',hora:'20:00'}]})){
  const c=compare([row()],[row({[campo]:v})]);assert.equal(c.length,1,campo);assert.equal(c[0].tipo,'modificada',campo);assert.ok(c[0].diferencias.some(d=>d.campo===campo),campo);
 }
});
test('contact change on one cabin retains the multicabin group when its document agrees',()=>{
 const c=compare([row(),cab2()],[row(),cab2({correo:'updated@example.test'})]);
 assert.equal(c.length,1);assert.equal(c[0].tipo,'modificada');assert.ok(c[0].campos.includes('correo'));
});
test('a conflict produces one review case retaining both versions',()=>{
 const c=compare([row()],[row({rut_documento:'99999999-1'})]);
 assert.equal(c.length,1);assert.equal(c[0].tipo,'requiere_revision');assert.ok(c[0].anterior);assert.ok(c[0].actual);
});
test('unparsed notes are observable',()=>{
 const c=compare([row({texto_original:'Marco Iturrieta Rojas // llega tarde'})],[row({texto_original:'Marco Iturrieta Rojas // llega temprano'})]);
 assert.equal(c[0].tipo,'modificada');assert.ok(c[0].campos.includes('notas'));
});
test('unparsed notes stay observable alongside a date change',()=>{
 const c=compare([row({texto_original:'Marco Iturrieta Rojas // llega tarde'})],[row({fecha_checkout:'2026-09-21',texto_original:'Marco Iturrieta Rojas // pide almohada'})])[0];
 assert.ok(c.campos.includes('fecha_checkout'));assert.ok(c.campos.includes('notas'));
});
test('document conflict, duplicate rows and real homonyms never invent a match or disappearance',()=>{
 const scenarios=[[[row()],[row({rut_documento:'99999999-1'})]],[[row(),row({id:'duplicate'})],[row()]],
 [[row({rut_documento:null,correo:null,telefono:null}),row({id:'repeat',rut_documento:null,correo:null,telefono:null})],[row({rut_documento:null,correo:null,telefono:null})]]];
 for(const [a,b] of scenarios) assert.ok(compare(a,b).every(c=>c.tipo==='requiere_revision'));
});
test('missing identity cannot bridge two conflicting people into a safe group',()=>{
 const a=row(), b=cab2({rut_documento:null,correo:null,telefono:null}), c=row({id:'c3',cabana:3,rut_documento:'99999999-1',correo:'other@example.test'});
 for(const rows of [[a,b,c],[c,b,a]]) assert.ok(compare(rows,rows).every(x=>x.tipo==='requiere_revision'));
});
test('different strong identities stay separate even with same holder and dates',()=>{
 const a=row(),b=cab2({rut_documento:'99999999-1',correo:'other@example.test',telefono:'+56911111111'});
 assert.deepEqual(compare([a,b],[b,a]).map(c=>c.tipo),['sin_cambios','sin_cambios']);
});
test('payment with distinct strong identifier is added exactly once across cabins',()=>{
 const p=pay(),p2=pay({codigo_autorizacion:'AUTH2'});
 const c=compare([row({pagos:[p]}),cab2({pagos:[p]})],[row({pagos:[p,p2]}),cab2({pagos:[p,p2]})]);
 assert.equal(c[0].tipo,'modificada');assert.equal(c[0].diferencias.filter(d=>d.tipo==='pago_agregado').length,1);
});
test('payment elimination and changed amount are explicit and safe',()=>{
 assert.equal(compare([row({pagos:[pay()]})],[row()])[0].diferencias[0].tipo,'pago_eliminado');
 const c=compare([row({pagos:[pay()]})],[row({pagos:[pay({monto:200000})]})])[0];
 assert.equal(c.tipo,'requiere_revision');assert.equal(c.diferencias[0].tipo,'pago_modificado');
});
test('Folio+Bovtar and BOVE are strong; Folio alone is not',()=>{
 for(const p of [pay({codigo_autorizacion:null,folio:'21',bovtar:'45'}),pay({codigo_autorizacion:null,bove:'902'})]) assert.equal(compare([row()],[row({pagos:[p]})])[0].diferencias[0].tipo,'pago_agregado');
 assert.equal(compare([row()],[row({pagos:[pay({codigo_autorizacion:null,folio:'21'})]})])[0].tipo,'requiere_revision');
});
test('conflicting duplicate payments and lower-priority identifier collisions require review',()=>{
 for(const payments of [[pay(),pay({monto:2})],[pay({bove:'3'}),pay({codigo_autorizacion:'AUTH2',bove:'3'})]]){
  const c=compare([row()],[row({pagos:payments})]);assert.equal(c[0].tipo,'requiere_revision');assert.ok(!c[0].diferencias.some(d=>d.tipo==='pago_agregado'));
 }
});
test('same payment ID on unrelated logical reservations cannot be declared safely added',()=>{
 const b=row({titular:'Otra Persona',rut_documento:'99999999-1',cabana:3,id:'x',pagos:[pay()]});
 const c=compare([row(),{...b,pagos:[]}],[row({pagos:[pay()]}),b]);assert.ok(c.every(x=>x.tipo==='requiere_revision'));
});
test('coordinate changes and reordered payments do not modify a payment',()=>{
 const p=pay(),p2=pay({codigo_autorizacion:'AUTH2'});
 assert.equal(compare([row({pagos:[p,p2]})],[row({pagos:[p2,{...p,origen:{hoja:'Sep26',celda:'Z1'}}]})])[0].tipo,'sin_cambios');
});
test('incomplete coverage and unassociated movements never assert added or eliminated payments',()=>{
 for(const extra of [{cobertura_pagos:false},{pagos_sin_asociacion:[pay()]}]){
  const c=compare([row({pagos:[pay()],...extra})],[row()]);assert.equal(c[0].tipo,'requiere_revision');assert.ok(!c[0].diferencias.some(d=>d.tipo==='pago_eliminado'));
 }
});
test('unknown geometry is not an empty book',()=>{
 assert.equal(S.compararVersiones({cobertura:{geometria:false}},sheet([row()]))[0].tipo,'no_comparable');
});
function book(a,b){return {listo:async()=>{},estado:()=>({cargado:true,nombre:'Actual.xlsx',generacion:1}),listarHojas:()=>['Sep26'],consultarHoja:async(h,v)=>sheet(v==='anterior'?a:b),buscarHojas:()=>{throw Error('Must not hide removed holders')}};}
test('real query routing is read-only even with compara/agrega, and cabin filters retain logical groups',async()=>{
 const forbidden=new Proxy({},{get(){throw Error('No database access permitted')}});
 const r=await Q.consultar('Libro: compara los cambios con el anterior, agrega reservas de septiembre 2026 CAB 2',book([row(),cab2()],[row(),cab2()]),forbidden);
 assert.equal(r.q.comparar,false);assert.equal(r.cambios.length,1);assert.deepEqual(r.cambios[0].actual.cabanas,[1,2]);
 const text=Q.respuesta(r);assert.match(text,/CAMBIOS ENTRE LIBROS · Septiembre 2026/);assert.match(text,/CAB 1 \+ CAB 2/);assert.doesNotMatch(text,/Sep26!|asociacion_ambigua|ya_no_aparece_o_modificada/);
});
test('name search retains holders removed from the current book',async()=>{
 const r=await Q.consultar('Libro: cambios de la reserva de Marco Iturrieta Rojas',book([row()],[]));assert.equal(r.cambios[0].tipo,'ya_no_aparece');
});
test('date moves across selected monthly sheets remain a single modification',async()=>{
 const b=book([],[]);b.listarHojas=()=>['Sep26','Oct26'];
 b.consultarHoja=async(h,v)=>sheet(v==='anterior'?(h==='Sep26'?[row()]:[]):(h==='Oct26'?[row({fecha_checkin:'2026-10-02',fecha_checkout:'2026-10-05'})]:[]));
 const r=await Q.consultar('Libro cambios del 01-09-26 al 31-10-26',b);
 assert.equal(r.cambios.length,1);assert.equal(r.cambios[0].tipo,'modificada');
});
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.dataset={};}
 append(...xs){this.children.push(...xs)} replaceChildren(...xs){this.children=xs}
}
test('visual report has five totals, one Marco card, hidden technical coordinates, no write controls',async()=>{
 const ctx={HAIKU_LIBRO_SEMANTICA:S,document:{createElement:t=>new Element(t),querySelector:()=>null},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8'),ctx);
 const out=new Element('div'), result=await Q.consultar('Libro cambios septiembre 2026',book([row(),cab2()],[row(),cab2()]));
 ctx.HAIKU_LIBRO_CONSULTAS.renderizarVersiones(out,result);
 const all=e=>[e,...e.children.flatMap(all)];const nodes=all(out);
 assert.equal(nodes.filter(e=>e.tag==='article').length,1);assert.equal(nodes.find(e=>e.className==='haiku-versiones-totales').children.length,5);
 const technical=nodes.filter(e=>e.tag==='details'&&e.className==='haiku-versiones-tecnico');assert.ok(technical.length);assert.ok(technical.every(e=>!e.open));
 const visible=e=> e.tag==='details'&&!e.open ? e.children[0]?.textContent||'' : e.textContent+' '+e.children.map(visible).join(' ');
 assert.doesNotMatch(visible(out),/Sep26!|BO3/);assert.match(visible(out),/CAB 1 \+ CAB 2/);assert.equal(nodes.filter(e=>e.tag==='button').length,0);
 assert.match(nodes.map(e=>e.textContent).join(' '),/Sep26!BO3/);
});
