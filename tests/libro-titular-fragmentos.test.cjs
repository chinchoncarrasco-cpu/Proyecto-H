const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../js/haiku-libro-semantica-v1.js');
function hoja(texto,desplazada=false){return {celdas:[
 {r:1,c:2,valor:'12 sep',fechaISO:'2026-09-12'},{r:1,c:6,valor:'13 sep',fechaISO:'2026-09-13'},
 {r:2,c:0,valor:'cabaña 2'},{r:2,c:desplazada?3:2,valor:texto},
 {r:24,c:2,valor:'Pagos de arriendos de hoy'}],combinaciones:[{s:{r:2,c:desplazada?3:2},e:{r:2,c:4}}]};}
const normalizar=t=>S.normalizarHoja(hoja(t),'Sep26');
test('operational language does not expel a guest or become a reservation on its own',()=>{
 for(const nota of ['Llegará tarde','Solicita leña','Manager pendiente','Llegada tarde','Sin azúcar','Cena por pagar','AGREGAR ESTACIONAMIENTO','Enviar instrucciones','Preparar bienvenida','Camas juntas','Confirmado por recepción']){
  for(const texto of [`Ana Pérez // ${nota} // 1 NOCHE`,`${nota}\nAna Pérez\n1 NOCHE`]){
   const h=normalizar(texto);assert.equal(h.reservas.length,1,texto);assert.equal(h.reservas[0].titular,'Ana Pérez',texto);assert.equal(h.reservas[0].texto_original,texto);
  }
  assert.equal(normalizar(nota).reservas.length,0,nota);
 }
});
test('human names remain eligible alongside operational notes',()=>{
 for(const nombre of ['Agustin Rampa Spinelli','David Sanchez','Katty Vaisman','Andrés Mahecha','Flavia Flores Loyola']){
  assert.equal(normalizar(`${nombre} // Solicita leña // 1 NOCHE`).reservas[0]?.titular,nombre);
 }
 const h=normalizar('Ana Pérez // Juan Soto // 1 NOCHE');assert.equal(h.reservas.length,0);assert.match(h.advertencias.join(' '),/varios posibles titulares/);
});
test('Yervic: request before guest is retained as original information, never selected as titular',()=>{
 const texto='SOLICITA FACTURA // Yervic Enrique // +56 9 1234 5678 // 26.144.154-3 // 2 ADL // 1 NOCHE // FC';
 const r=normalizar(texto).reservas;assert.equal(r.length,1);assert.equal(r[0].titular,'Yervic Enrique');
 assert.equal(r[0].cabana,2);assert.equal(r[0].fecha_checkin,'2026-09-12');assert.equal(r[0].fecha_checkout,'2026-09-13');assert.equal(r[0].noches,1);assert.equal(r[0].texto_original,texto);
});
test('administrative verbs plus context exclude requests, not only exact invoice phrases',()=>{
 for(const nota of ['PIDE FACTURA','REQUIERE BOLETA','SOLICITA BOLETA','REQUIERE FACTURA','DEJAR CAMAS JUNTAS','DEJAR LAS BATAS','COORDINAR LATE CHECK OUT','POSIBLE LATE CHECK OUT','TRATO ESPECIAL','SOLICITAN UNA CUNA','PIDE DESAYUNO TEMPRANO']){
  for(const texto of [`${nota} // Nombre Persona // 1 noche`,`Nombre Persona\n${nota}\n1 noche`,`+56 9 1234 5678 // ${nota} // Nombre Persona`]){
   assert.equal(normalizar(texto).reservas[0]?.titular,'Nombre Persona',texto);
  }
  assert.equal(normalizar(nota).reservas.length,0,nota);
 }
});
test('structured fragments, labels, services and operator codes cannot compete with the unique guest',()=>{
 for(const dato of ['Teléfono de contacto','Correo electrónico','RUT documento','2 ADL','1 NOCHE','12/09/2026','FC','SIN ABONO','POR CONFIRMAR','CAMA ADICIONAL','JACUZZI CORTESÍA','FULL DAY','AIRBNB','HUESPED FRECUENTE','HUESPED FRECUENTE / TRATO ESPECIAL']){
  assert.equal(normalizar(`${dato} // David Sanchez`).reservas[0]?.titular,'David Sanchez',dato);
 }
});
test('two plausible humans are ambiguous regardless of order or contact position; displaced anchor retains warning',()=>{
 for(const texto of ['Ana Pérez // Juan Soto','Juan Soto // Ana Pérez','Ana Pérez // +56 9 1234 5678 // Juan Soto','SOLICITA FACTURA // Ana Pérez // Juan Soto // 1 noche']){
  for(const desplazada of [false,true]){const h=S.normalizarHoja(hoja(texto,desplazada),'Sep26');assert.equal(h.reservas.length,0);assert.match(h.advertencias.join(' '),/varios posibles titulares/);assert.ok(h.anotaciones.some(a=>a.texto_original===texto));}
 }
});
test('September payment parser and association keep their prior output',()=>{
 const d=require('./fixtures/libro-pagos-sep26.cjs')(),before=S.normalizarHoja(d,'Sep26');
 for(const c of d.celdas.filter(c=>c.r<24&&c.valor.startsWith('Macarena Hurtado')))c.valor='SOLICITA FACTURA // '+c.valor;
 const after=S.normalizarHoja(d,'Sep26');assert.deepEqual(after.pagos,before.pagos);
 assert.deepEqual(after.reservas.map(r=>[r.titular,r.pagos,r.pagos_sin_asociacion]),before.reservas.map(r=>[r.titular,r.pagos,r.pagos_sin_asociacion]));
});
test('cancellation context and operational-block classification retain their separate existing contract',()=>{
 const d=hoja('Yervic Enrique // 1 noche');d.celdas.push({r:16,c:0,valor:'CANCELACIONES'},{r:16,c:3,valor:'Carol Vega Ruiz // 1 noche'},{r:18,c:0,valor:'OTRAS VENTAS'});
 const h=S.normalizarHoja(d,'Sep26');assert.equal(h.cancelaciones.length,1);assert.equal(h.cancelaciones[0].titular,'Carol Vega Ruiz');
 const rojo=hoja('POSIBLE LATE CHECK OUT (X COORDINAR)');rojo.celdas.find(c=>c.r===2&&c.c===0).valor='cabaña 10';rojo.celdas.find(c=>c.r===2&&c.c===2).estiloId=0;rojo.estilos=[{fill:{patternType:'solid',fgColor:{rgb:'FFFF0000'}}}];
 const b=S.normalizarHoja(rojo,'Sep26');assert.equal(b.reservas.length,0);assert.equal(b.bloqueos.length,1);assert.equal(b.bloqueos[0].cabana,10);
 rojo.celdas.find(c=>c.r===2&&c.c===2).valor+=' // Ana Pérez // Juan Soto';const conflict=S.normalizarHoja(rojo,'Sep26');assert.equal(conflict.reservas.length,0);assert.equal(conflict.bloqueos.length,0);
});
