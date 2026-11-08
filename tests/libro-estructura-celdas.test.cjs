const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../js/haiku-libro-semantica-v1.js');

function hoja() {
 return {celdas:[
  {r:1,c:2,valor:'6 nov',fechaISO:'2026-11-06'},
  {r:1,c:6,valor:'7 nov',fechaISO:'2026-11-07'},
  {r:1,c:10,valor:'8 nov',fechaISO:'2026-11-08'},
  {r:2,c:0,valor:'cabaña 3'},
  {r:2,c:2,valor:'Ana Pérez // 2 ADL // 1 noche'},
  {r:24,c:2,valor:'Pagos de arriendos de hoy'},
  {r:24,c:6,valor:'Pagos de arriendos de hoy'},
  {r:24,c:10,valor:'Pagos de arriendos de hoy'},
  {r:25,c:0,valor:'cabaña 3'}
 ],combinaciones:[
  ...[2,6,10].map(c=>({s:{r:1,c},e:{r:1,c:c+2}})),
  {s:{r:2,c:2},e:{r:2,c:4}},
  {s:{r:25,c:0},e:{r:29,c:0}}
 ]};
}
const leer=d=>S.normalizarHoja(d,'Nov26');
const campo=(d,r,c)=>d.celdas.find(x=>x.r===r&&x.c===c);

test('una fecha escrita como texto en su encabezado conserva el día y las reservas',()=>{
 for(const valor of ['sábado, noviembre 07, 2026','Saturday, November 7, 2026','07-11-2026','7 de noviembre de 2026']) {
  const d=hoja();Object.assign(campo(d,1,6),{valor,fechaISO:null});
  d.celdas.push({r:2,c:6,valor:'Pedro Silva // 2 ADL // 1 noche'});
  d.combinaciones.push({s:{r:2,c:6},e:{r:2,c:8}});
  const h=leer(d);assert.equal(h.reservas.length,2,valor);
  assert.deepEqual(h.fechas,['2026-11-06','2026-11-07','2026-11-08']);
  assert.equal(h.reservas.find(r=>r.titular==='Pedro Silva').fecha_checkin,'2026-11-07');
  assert.ok(h.reservas.every(r=>r.geometria_inequivoca));
 }
});

test('fecha con mes y día explícitos usa el año sólo si ambos vecinos y las celdas coinciden',()=>{
 const d=hoja();Object.assign(campo(d,1,6),{valor:'sábado 7 de noviembre, feriado',fechaISO:null});
 d.combinaciones.find(m=>m.s.r===2).e.c=8;
 const r=leer(d).reservas[0];assert.equal(r.noches,2);assert.equal(r.geometria_inequivoca,true);
 const copia=structuredClone(d);campo(copia,1,6).valor='sábado 8 de noviembre, feriado';
 assert.equal(leer(copia).reservas.length,0);
 assert.ok(leer(copia).anotaciones.some(a=>a.tipo==='reserva_por_identificar'&&/fecha/i.test(a.motivo_identificacion)));
});

test('una fecha equivocada no borra las reservas de los otros días ni se corrige en silencio',()=>{
 const d=hoja();campo(d,1,6).fechaISO='2025-11-07';campo(d,1,6).valor='7 nov 2025';
 d.celdas.push({r:2,c:6,valor:'Pedro Silva // 2 ADL // 1 noche'});
 d.combinaciones.push({s:{r:2,c:6},e:{r:2,c:8}});
 const h=leer(d);assert.equal(h.reservas.length,1);assert.equal(h.reservas[0].titular,'Ana Pérez');
 const a=h.anotaciones.find(a=>a.tipo==='reserva_por_identificar');
 assert.equal(a.origen.celda,'G3');assert.equal(a.fecha,'2026-11-07');
 assert.match(a.motivo_identificacion,/2025-11-07/);assert.equal(h.cobertura.geometria,false);
});

test('un encabezado vacío dentro de una estadía deja la duda visible, sin inventar noches',()=>{
 const d=hoja();campo(d,1,6).valor='';campo(d,1,6).fechaISO=null;
 d.combinaciones.find(m=>m.s.r===2).e.c=8;
 const h=leer(d);assert.equal(h.reservas.length,0);
 assert.ok(h.anotaciones.some(a=>a.tipo==='reserva_por_identificar'&&/fecha/i.test(a.motivo_identificacion)));
});

test('una fecha inferida para localizar la duda tampoco autoriza pagos, cancelaciones ni aseos',()=>{
 const d=hoja();campo(d,1,6).fechaISO='2025-11-07';
 d.celdas.push({r:16,c:0,valor:'CANCELACIONES'},{r:16,c:6,valor:'Pedro Silva // 1 noche'},
  {r:18,c:0,valor:'OTRAS VENTAS'},{r:2,c:5,valor:'Check out Laura // Rosa Vega // 10:00-11:00'},
  {r:25,c:6,valor:'6 nov',fechaISO:'2026-11-06'},{r:25,c:7,valor:'Ana Pérez // Efectivo'},
  {r:25,c:8,valor:'cab 3 / 1 noche'},{r:25,c:9,valor:'50000',valorNumero:50000});
 const h=leer(d);assert.equal(h.pagos.length,0);assert.equal(h.cancelaciones.length,0);assert.equal(h.aseos.length,0);
 assert.ok(h.anotaciones.some(a=>a.tipo==='cancelacion_fecha_dudosa'&&a.origen.celda==='G17'));
 assert.equal(h.reservas.length,1);
});

test('el bloque se encuentra por sus celdas aunque el titular no se reconozca',()=>{
 const d=hoja();Object.assign(campo(d,2,2),{c:3,valor:'2 ADL // 1 noche // rut pendiente'});
 d.combinaciones.find(m=>m.s.r===2).s.c=3;
 const h=leer(d);assert.equal(h.reservas.length,0);
 const a=h.anotaciones.find(a=>a.tipo==='reserva_por_identificar');
 assert.equal(a.origen.celda,'D3');assert.match(a.motivo_identificacion,/titular/i);
 assert.deepEqual(a.fechas_ocupadas,['2026-11-06']);
});

test('dos bloques en el mismo día y cabaña no se reducen arbitrariamente al primero',()=>{
 const d=hoja();d.combinaciones=d.combinaciones.filter(m=>m.s.r!==2);
 d.celdas.push({r:2,c:3,valor:'Pedro Silva // 2 ADL // 1 noche'});
 const h=leer(d);assert.equal(h.reservas.length,0);
 assert.equal(h.anotaciones.filter(a=>a.tipo==='reserva_por_identificar').length,2);
 assert.ok(h.anotaciones.every(a=>/bloque/i.test(a.motivo_identificacion)));
});

test('LIBRE y la celda contigua de mantención conservan sus roles sin crear pendientes de reservas',()=>{
 for(const marca of ['LIBRE','DETALLE MANTENCIÓN','Lista para la venta','MANTENCIÓN']) {
  const d=hoja();campo(d,2,2).valor=marca;d.combinaciones=d.combinaciones.filter(m=>m.s.r!==2);
  d.celdas.push({r:2,c:3,valor:'El refri gotea mucho'});
  const h=leer(d);assert.equal(h.reservas.length,0);
  assert.equal(h.anotaciones.filter(a=>a.tipo==='reserva_por_identificar').length,0);
  assert.equal(h.anotaciones[0].tipo,'nota_cabana');assert.equal(h.anotaciones[0].origen.celda,'D3');
 }
 const d=hoja();campo(d,2,2).valor='LIBRE';d.celdas.push({r:2,c:3,valor:'Pedro Silva // 2 ADL'});
 assert.equal(leer(d).anotaciones.filter(a=>a.tipo==='reserva_por_identificar').length,2);
 const mantencion=hoja();campo(mantencion,2,2).valor='MANTENCIÓN';
 mantencion.combinaciones=mantencion.combinaciones.filter(m=>m.s.r!==2);
 mantencion.celdas.push({r:2,c:3,valor:'- Mantención @Personal favor revisar ducha y 2 personas de reparación'});
 assert.equal(leer(mantencion).anotaciones.filter(a=>a.tipo==='reserva_por_identificar').length,0);
});

test('nombre junto al RUT, rótulo de huésped y puntuación no ocultan una identidad explícita',()=>{
 for(const nombre of ['"Ana Pérez','-Ana Pérez','..Ana Pérez','Ana Pérez,','Ana Pérez Rut: 12345678-5',
  'Ana Pérez: 12345678-5','Ana Pérez12345678-5','PROMO HAIKU Ana Pérez','PROMO HAIKU - Ana Pérez','Huésped: Ana Pérez']) {
  const d=hoja();campo(d,2,2).valor=`${nombre} // 2 ADL // 1 noche`;
  const r=leer(d).reservas[0];assert.equal(r?.titular,'Ana Pérez',nombre);
  assert.equal(r.texto_original,campo(d,2,2).valor);
  if(nombre.includes('12345678'))assert.equal(r.rut_documento,'12345678-5');
 }
 const agencia=hoja();campo(agencia,2,2).valor='booker: agencia Ejemplo // Huèsped: Ana Pérez // 2 ADL';
 assert.equal(leer(agencia).reservas[0]?.titular,'Ana Pérez');
 campo(agencia,2,2).valor='BOOKER Pedro Silva // HUÉSPED: Ana Pérez // 2 ADL';
 assert.equal(leer(agencia).reservas[0]?.titular,'Ana Pérez');
 campo(agencia,2,2).valor='Ana Pérez // ID VEN 12345678-5 // 2 ADL // Sociedad comercial Ejemplo spa 11111111-1';
 assert.equal(leer(agencia).reservas[0]?.titular,'Ana Pérez');
 assert.equal(leer(agencia).reservas[0]?.rut_documento,'12345678-5');
 const dos=hoja();campo(dos,2,2).valor='Ana Pérez Rut: 12345678-5 // Pedro Silva Rut: 11111111-1 // 2 ADL';
 assert.equal(leer(dos).reservas.length,0);
 assert.deepEqual(leer(dos).anotaciones[0].titulares_posibles,['Ana Pérez','Pedro Silva']);
 campo(dos,2,2).valor='Ana Pérez12345678-5 // Pedro Silva 11111111-1 // BOOKER Rosa Vega // 2 ADL';
 assert.equal(leer(dos).reservas.length,0);
 assert.deepEqual(leer(dos).anotaciones[0].titulares_posibles,['Ana Pérez','Pedro Silva']);
});

test('un RUT ya escrito tras pedir rut y una fecha administrativa tras cama adicional se conservan',()=>{
 const d=hoja();campo(d,2,2).valor='Ana Pérez // pedir rut: 12345678-5 // 2 ADL // CamaAdicional // 1 noche // 01-11-2026 CO // Tinaja 06-11-2026 17:00 cortesía';
 const r=leer(d).reservas[0];assert.equal(r.rut_documento,'12345678-5');assert.equal(r.fecha_ingreso_libro,'2026-11-01');
 campo(d,2,2).valor='Ana Pérez // pedir pasaporte: AB1234567 // pedir correo: -ana@example.invalid // 2 ADL';
 const contacto=leer(d).reservas[0];assert.equal(contacto.rut_documento,'AB1234567');assert.equal(contacto.correo,'-ana@example.invalid');
});

test('nombres con tildes compuestas o descompuestas conservan identidad y evidencia',()=>{
 for(const formato of ['NFC','NFD']) {
  const d=hoja(),nombre='Ana Sáez Muñoz'.normalize(formato);
  campo(d,2,2).valor=`${nombre} // 2 ADL // 1 noche`;
  const h=leer(d);assert.equal(h.reservas[0].titular,nombre);
  assert.equal(h.reservas[0].texto_original,campo(d,2,2).valor);
 }
});

test('la fecha y los contactos de un servicio o pagador no reemplazan los datos del huésped',()=>{
 const d=hoja();campo(d,2,2).valor='Ana Pérez // 2 ADL // 1 noche // 01-11-2026 // CO // Tinaja 06-11-2026 17:00 cortesía // Masajista: Rosa Vega rosa@example.invalid +56900000003 // Pagador: Pedro Silva pedro@example.invalid +56900000004';
 const r=leer(d).reservas[0];assert.equal(r.fecha_ingreso_libro,'2026-11-01');
 assert.equal(r.correo,null);assert.equal(r.telefono,null);
 campo(d,2,2).valor+=' // ana@example.invalid // +56900000005';
 const conContacto=leer(d).reservas[0];assert.equal(conContacto.correo,'ana@example.invalid');assert.equal(conContacto.telefono,'+56900000005');
 const soloServicio=hoja();campo(soloServicio,2,2).valor='Ana Pérez // 2 ADL // Tinaja // 06-11-2026 // 17:00';
 assert.equal(leer(soloServicio).reservas[0].fecha_ingreso_libro,null);
});

test('aseo vecino y notas fuera del calendario nunca se trasladan al bloque de reserva',()=>{
 const d=hoja(),antes=leer(d).reservas;
 d.celdas.push({r:2,c:1,valor:'Check out Laura // Rosa Vega // 10:00-11:00'},
  {r:0,c:2,valor:'Cortesía masaje Pedro Silva 17:00'},
  {r:15,c:2,valor:'Nota suelta // transferencia $50.000 // Pedro Silva'});
 assert.deepEqual(leer(d).reservas,antes);assert.equal(leer(d).pagos.length,0);
});

test('la cobertura financiera verifica la cabaña y el final de su bloque, no sólo cuántas etiquetas hay',()=>{
 const d=hoja();campo(d,25,0).valor='cabaña 8';
 const h=leer(d);assert.equal(h.cobertura.pagos,false);assert.equal(h.reservas[0].cobertura_pagos,false);
 const sinFin=hoja();sinFin.combinaciones=sinFin.combinaciones.filter(m=>m.s.r!==25);
 assert.equal(leer(sinFin).reservas[0].cobertura_pagos,false);
});

test('la ausencia de encabezados financieros no borra una cuadrícula de reservas reconocible',()=>{
 const d=hoja();d.celdas=d.celdas.filter(c=>c.r!==24);
 const h=leer(d);assert.equal(h.reservas[0].titular,'Ana Pérez');
 assert.equal(h.cobertura.pagos,false);assert.equal(h.reservas[0].cobertura_pagos,false);
 assert.equal(h.pagos.length,0);assert.match(h.advertencias.join(' '),/encabezado de pagos/);
});

test('una etiqueta de cabaña copiada dentro de los datos no duplica ni suprime el bloque de pagos',()=>{
 const d=hoja();d.celdas.push({r:25,c:2,valor:'5 nov',fechaISO:'2026-11-05'},
  {r:25,c:3,valor:'Ana Pérez // Efectivo'},{r:25,c:4,valor:'cab 3 / 1 noche'},
  {r:25,c:5,valor:'50000',valorNumero:50000});
 const antes=leer(d);assert.equal(antes.pagos.length,1);
 d.celdas.push({r:25,c:11,valor:'cabaña 3'});
 const despues=leer(d);assert.deepEqual(despues.pagos,antes.pagos);
 assert.equal(despues.cobertura.pagos,true);
});

test('consulta y comparación explican la celda pendiente sin ofrecer incorporarla a ciegas',async()=>{
 const F=require('./fixtures/libro-comparacion-readonly.cjs');
 for(const tipo of ['titular','fecha']) {
  const d=hoja();if(tipo==='titular')campo(d,2,2).valor='2 ADL // 1 noche';
  else {campo(d,1,6).fechaISO='2025-11-07';d.combinaciones.find(m=>m.s.r===2).e.c=8;}
  const datos=leer(d),w=F.web(datos);w.HAIKU_LIBRO_RESERVA_V1={...w.HAIKU_LIBRO_RESERVA_V1,listarHojas:()=>['Nov26']};
  const db=F.cliente({reserva_estadias:[],pagos:[],cabanas:[],bloqueos_cabana:[]}),q=w.HAIKU_LIBRO_CONSULTAS;
  const r=await q.consultar('Libro: compara reservas de noviembre 2026 con Proyecto H',w.HAIKU_LIBRO_RESERVA_V1,db);
  assert.equal(r.reservas_por_identificar.length,1);const texto=q.respuesta(r);
  assert.match(texto,/Nov26.*C3/);assert.match(texto,tipo==='titular'?/Completa el nombre/:/Confirma ese encabezado/);
  assert.doesNotMatch(texto,/Aparecen varios nombres: \./);
  const plan=await q.prepararIncorporacion(r,new Map(),new Set(),db);
  assert.equal(plan.items.filter(i=>i.categoria==='nuevas').length,0);assert.deepEqual(db.mutaciones,[]);
 }
});

test('los pagos de otra sección no se absorben al extender el último bloque de cabaña',()=>{
 const d=hoja();d.combinaciones=d.combinaciones.filter(m=>m.s.r!==25);
 d.celdas.push({r:30,c:0,valor:'OTRAS VENTAS NO ASOCIADAS AL CHECK IN DEL DIA'},
  {r:31,c:2,valor:'6 nov',fechaISO:'2026-11-06'},
  {r:31,c:3,valor:'Persona Externa // Efectivo'},
  {r:31,c:4,valor:'Servicio externo'}, {r:31,c:5,valor:'50000',valorNumero:50000});
 assert.equal(leer(d).pagos.length,0);
});

test('orden de las celdas y traslación uniforme no cambian la interpretación',()=>{
 const original=leer(hoja()),d=hoja();d.celdas.reverse();d.combinaciones.reverse();
 assert.deepEqual(leer(d),original);
 const desplazada=hoja();desplazada.celdas.forEach(c=>{c.r+=3;c.c+=5});
 desplazada.combinaciones.forEach(m=>{m.s.r+=3;m.e.r+=3;m.s.c+=5;m.e.c+=5});
 const r=leer(desplazada).reservas[0];assert.equal(r.titular,original.reservas[0].titular);
 assert.equal(r.fecha_checkin,original.reservas[0].fecha_checkin);assert.equal(r.cabana,3);
 assert.equal(r.coordenadas_origen.celda,'H6');
});

module.exports={hoja};
