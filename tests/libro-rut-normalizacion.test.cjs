const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_SEMANTICA = S;
const Q = require('../js/haiku-libro-consultas-v1.js');
const F = require('./fixtures/libro-actualizaciones-pagos-flujo.cjs');
const formatos = ['19.548.208-K','19548208-K','19548208-k','19548208K'];
for (const valor of [...formatos, '12.345.678-5', '123456785']) {
 test('incorporación canónica: '+valor, async () => {
  const f=F.crear(); f.reservas=[{...f.reservas[4],rut_documento:valor}];
  const db=F.cliente(f), comparacion=await Q.compararSistema(f.reservas,db,f.q);
  const plan=await Q.prepararIncorporacion({reservas:f.reservas,q:f.q,comparacion},new Map(),new Set(),db);
  const item=plan.items.find(i=>i.payload?.reserva?.titular_numero_documento);
  assert.ok(item); assert.equal(item.payload.reserva.titular_numero_documento,valor.includes('19548')||valor.includes('19.548')?'19548208-k':'12345678-5');
 });
}
for(const valor of formatos) test('mismo RUT no prepara actualización y permite confirmar pago: '+valor,async()=>{
 const f=F.crear(); f.reservas=[f.reservas[0]]; f.estadias=[f.estadias[0]];
 const r=f.reservas[0], s=f.estadias[0]; r.rut_documento=valor; r.texto_original=r.titular+' // RUT '+valor; s.reservas.observaciones=r.titular+' // RUT 19548208-k';
 // El writer sin la candidata SQL guarda esta clave interna, no el formato visible.
 Object.assign(s.reservas,{titular_nombre:r.titular,titular_numero_documento:'19548208K',titular_tipo_documento:'rut'});
 const db=F.cliente(f,{conflicto:-1}), aprobados=new Set(), decisiones=new Map();
 const comparacion=await Q.compararSistema(f.reservas,db,f.q);
 for(const g of comparacion.grupos) decisiones.set(g.clave,{valor:'asociar:'+s.id});
 const result={reservas:f.reservas,q:f.q,comparacion};
 const plan=await Q.prepararIncorporacion(result,decisiones,aprobados,db);
 assert.equal(plan.items.filter(i=>i.payload?.tipo==='reserva_actualizar').length,0);
 const pago=plan.items.find(i=>i.pagoLibro); assert.ok(pago); assert.equal(pago.categoria,'pagos'); assert.deepEqual(pago.motivos,[]); assert.deepEqual(pago.dependeDe,[]);
 plan.items.forEach(i=>i.seleccionado=i===pago);
 await Q.confirmarIncorporacion(result,decisiones,aprobados,plan,db);
 assert.equal(db.pagos.length,1);
});
test('ausentes, extranjeros y diferencias reales se conservan',()=>{
 for(const v of [null,undefined,'','AB0123456','00-123.456','1954820']) assert.equal(S.normalizarDocumento(v),v);
 assert.equal(S.normalizarDocumento('19548208K','pasaporte'),'19548208K');
 assert.notEqual(S.documentoCanon('19548208K'),S.documentoCanon('19548209K'));
 assert.notEqual(S.documentoCanon('AB-123456'),S.documentoCanon('AB123456'));
});

for (const [libro,sistema,tipo] of [['19548209K','19548208-k','rut'],['AB-0123456','AB0123456','pasaporte'],['12345670K','12345670-k','pasaporte']]) {
 test('diferencia real conserva actualización: '+tipo,async()=>{
  const f=F.crear(); f.reservas=[f.reservas[0]]; f.estadias=[f.estadias[0]];
  const r=f.reservas[0],s=f.estadias[0]; r.rut_documento=libro; r.tipo_documento=tipo;
  Object.assign(s.reservas,{titular_nombre:r.titular,titular_numero_documento:sistema,titular_tipo_documento:tipo});
  const db=F.cliente(f,{conflicto:-1}),comparacion=await Q.compararSistema(f.reservas,db,f.q),decisiones=new Map();
  for(const g of comparacion.grupos) decisiones.set(g.clave,{valor:'asociar:'+s.id});
  const plan=await Q.prepararIncorporacion({reservas:f.reservas,q:f.q,comparacion},decisiones,new Set(),db);
  const update=plan.items.find(i=>i.payload?.tipo==='reserva_actualizar'); assert.ok(update);
  assert.equal(update.payload.reserva.despues.titular_numero_documento,S.normalizarDocumento(libro,tipo));
 });
}
for(const valor of ['AB-0123456','19548208K']) test('alta extranjera conserva documento: '+valor,async()=>{
 const f=F.crear(); f.reservas=[{...f.reservas[4],rut_documento:valor,tipo_documento:'pasaporte'}];
 const db=F.cliente(f),comparacion=await Q.compararSistema(f.reservas,db,f.q);
 const plan=await Q.prepararIncorporacion({reservas:f.reservas,q:f.q,comparacion},new Map(),new Set(),db);
 assert.equal(plan.items.find(i=>i.payload?.reserva).payload.reserva.titular_numero_documento,valor);
});
for(const valor of formatos) test('lectura del Libro reconoce '+valor,()=>{
 const hoja={celdas:[{r:1,c:2,valor:'21 sep',fechaISO:'2026-09-21'},{r:1,c:6,valor:'22 sep',fechaISO:'2026-09-22'},{r:1,c:10,valor:'23 sep',fechaISO:'2026-09-23'},{r:2,c:0,valor:'cabana 6'},{r:2,c:2,valor:'Ana Perez // 2 ADL // '+valor},{r:24,c:2,valor:'Pagos de arriendos de hoy'}],combinaciones:[{s:{r:2,c:2},e:{r:2,c:8}}]};
 assert.equal(S.normalizarHoja(hoja,'Sep26').reservas[0].rut_documento,'19548208-k');
});
const D = require('../js/haiku-libro-diferencias-v1.js');
for(const [a,b,igual,tipo] of [['19.548.208-K','19548208K',true],['12.345.678-5','123456785',true],['19548208K','19548209K',false],['AB-0123456','AB0123456',false],['12345670K','12345670-k',false,'pasaporte']]) test('comparación Libro: '+a+' / '+b,()=>{
 const row=doc=>({id:'Oct26!C3',titular:'Ana Perez',cabana:6,fecha_checkin:'2026-10-13',fecha_checkout:'2026-10-15',tipo_estadia:'alojamiento',adultos:2,rut_documento:doc,tipo_documento:tipo,correo:'ana@example.invalid',telefono:'+56912345678',advertencias:[]});
 const sheet=doc=>[{hoja:'Oct26',cobertura:{geometria:true,pagos:true},fechas:['2026-10-13','2026-10-15'],reservas:[row(doc)]}];
 const r=D.comparar(sheet(a),sheet(b));
 assert.equal(r.resumen.modificadas,igual?0:1);
});
test('un teléfono sin etiqueta RUT no se convierte en documento',()=>{
 const hoja={celdas:[{r:1,c:2,valor:'21 sep',fechaISO:'2026-09-21'},{r:1,c:6,valor:'22 sep',fechaISO:'2026-09-22'},{r:2,c:0,valor:'cabana 6'},{r:2,c:2,valor:'Ana Perez // 2 ADL // +56 9 1234 5678'},{r:24,c:2,valor:'Pagos de arriendos de hoy'}],combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}}]};
 assert.equal(S.normalizarHoja(hoja,'Sep26').reservas[0].rut_documento,null);
});

function hojaConDocumento(fragmentos) {
 return {celdas:[
  {r:1,c:2,valor:'21 sep',fechaISO:'2026-09-21'},{r:1,c:6,valor:'22 sep',fechaISO:'2026-09-22'},
  {r:2,c:0,valor:'cabana 6'},{r:2,c:2,valor:'Ana Perez // 2 ADL // '+fragmentos},
  {r:24,c:2,valor:'Pagos de arriendos de hoy'}
 ],combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}}]};
}
for (const [origen,esperado] of [
 ['RUT 123456785','12345678-5'],['rut:123456785','12345678-5'],['RUT : 123456785','12345678-5'],
 ['RUT 12345674','1234567-4'],['Telefono 912345678 // RUT 123456785 // Folio 987654321','12345678-5'],
 ['RUT 123456781','12345678-1'], // La lectura no sustituye ni relaja la validación del DV.
 ['123456785',null],['Telefono 123456785',null],['+56912345678',null],['Folio 123456785',null],
 ['CodAut 123456785',null],['Reserva 123456785',null],['SIN RUT 123456785',null],['NRUT 123456785',null],
 ['RUT 1234567850',null],['RUT 123456785X',null],['RUT +123456785',null],['RUT 12345678 5',null],
 ['RUT 123456785 Telefono 912345678',null],['Pasaporte 123456785',null],
 ['Pasaporte AB1234567','AB1234567'],['Pasaporte AB1234567 // Telefono 123456785','AB1234567']
]) test('lectura real del Libro con contexto: '+origen,()=>{
 const hoja=hojaConDocumento(origen),antes=structuredClone(hoja);
 const resultado=S.normalizarHoja(hoja,'Sep26');
 assert.equal(resultado.reservas.length,1);
 assert.equal(resultado.reservas[0].rut_documento,esperado);
 assert.equal(resultado.reservas[0].titular,'Ana Perez');
 assert.equal(resultado.reservas[0].fecha_checkin,'2026-09-21');
 assert.equal(resultado.reservas[0].fecha_checkout,'2026-09-22');
 assert.equal(resultado.reservas[0].texto_original,'Ana Perez // 2 ADL // '+origen);
 assert.deepEqual(hoja,antes);
});
test('lectura real de CANCELACIONES comparte el reconocimiento contextual del RUT compacto',()=>{
 const hoja=hojaConDocumento('Telefono 912345678');
 hoja.celdas.push({r:8,c:0,valor:'CANCELACIONES'},
  {r:8,c:3,valor:'CANCELADA A PETICION // Ana Perez // 1 noche // RUT 123456785'},
  {r:10,c:0,valor:'OTRAS VENTAS NO ASOCIADAS AL CHECK IN DEL DIA'});
 const resultado=S.normalizarHoja(hoja,'Sep26');
 assert.equal(resultado.cancelaciones.length,1);
 assert.equal(resultado.cancelaciones[0].rut_documento,'12345678-5');
 assert.equal(resultado.reservas[0].rut_documento,null);
});
test('RUT numerico compacto leido del Libro confirma pago contra el formato persistido sin candidata SQL',async()=>{
 const f=F.crear(),pago={...f.reservas[0].pagos[0],fecha_bloque:'2026-09-21',fecha_comprobante:'2026-09-21'};
 const r=S.normalizarHoja(hojaConDocumento('RUT 123456785'),'Sep26').reservas[0];
 assert.equal(r.rut_documento,'12345678-5');
 r.pagos=[pago]; f.reservas=[r]; f.estadias=[f.estadias[0]]; f.q={desde:'2026-09-01',hasta:'2026-09-30'};
 const s=f.estadias[0];
 Object.assign(s,{cabanas:{numero:6},fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout});
 Object.assign(s.reservas,{titular_nombre:r.titular,titular_numero_documento:'123456785',titular_tipo_documento:'rut',observaciones:r.texto_original.replace('123456785','12345678-5')});
 const db=F.cliente(f,{conflicto:-1}),aprobados=new Set(),decisiones=new Map();
 const comparacion=await Q.compararSistema(f.reservas,db,f.q);
 for(const g of comparacion.grupos) decisiones.set(g.clave,{valor:'asociar:'+s.id});
 const result={reservas:f.reservas,q:f.q,comparacion};
 const plan=await Q.prepararIncorporacion(result,decisiones,aprobados,db);
 assert.equal(plan.items.filter(i=>i.payload?.tipo==='reserva_actualizar').length,0);
 const item=plan.items.find(i=>i.pagoLibro); assert.ok(item); assert.equal(item.categoria,'pagos'); assert.deepEqual(item.dependeDe,[]);
 plan.items.forEach(i=>i.seleccionado=i===item);
 await Q.confirmarIncorporacion(result,decisiones,aprobados,plan,db);
 assert.equal(db.pagos.length,1);
});
