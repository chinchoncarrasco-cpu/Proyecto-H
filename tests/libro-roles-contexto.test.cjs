const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
const F = require('./fixtures/libro-comparacion-readonly.cjs');

// Misma geometría que Nov26!X5:AD5, con identidades y contactos ficticios.
function hoja(texto, aseo = 'Check out ? // Camarero // Tiempos // IN ? // Check ?') {
 return {celdas:[
  {r:1,c:23,valor:'6 nov',fechaISO:'2026-11-06'},
  {r:1,c:27,valor:'7 nov',fechaISO:'2026-11-07'},
  {r:1,c:31,valor:'8 nov',fechaISO:'2026-11-08'},
  {r:4,c:0,valor:'cabaña 3'}, {r:4,c:22,valor:aseo},
  {r:4,c:23,valor:texto}, {r:24,c:23,valor:'Pagos de arriendos de hoy'}
 ],combinaciones:[{s:{r:4,c:23},e:{r:4,c:29}}]};
}
const leer = texto => S.normalizarHoja(hoja(texto), 'Nov26');

test('aseo realizado por una persona no compite con el titular, en cualquier posición', () => {
 for(const nota of ['aseo express realizado por Rosa Vega','ASEO EXPRESS REALIZADO POR ROSA',
  'Limpieza realizada por Pedro Silva','Se realizó aseo express por Rosa Vega',
  'Rosa Vega realizó el aseo','Camarero: Pedro Silva','Encargada de aseo: Rosa Vega']) {
  for(const texto of [`Ana Pérez // 2 ADL // 2 NOCHES // ${nota}`,`${nota}\nAna Pérez\n2 ADL\n2 noches`]) {
   const d=leer(texto),r=d.reservas[0];
   assert.equal(d.reservas.length,1,texto);assert.equal(r.titular,'Ana Pérez');
   assert.equal(r.texto_original,texto);assert.equal(r.coordenadas_origen.celda,'X5');
   assert.deepEqual(r.fechas_ocupadas,['2026-11-06','2026-11-07']);
   assert.equal(r.fecha_checkout,'2026-11-08');assert.equal(r.adultos,2);
   assert.equal(d.pagos.length,0);assert.equal(r.servicios.length,0);
   assert.equal(d.anotaciones.filter(a=>a.tipo==='reserva_por_identificar').length,0);
  }
  assert.equal(leer(nota).reservas.length,0,nota);
 }
});

test('los roles explícitos también se respetan cuando nombre y etiqueta usan campos separados', () => {
 for(const rol of ['Camarero','Encargada de aseo','Aseo realizado por','Masajista','Pagador','Acompañante']) {
  for(const separador of [' // ','\n']) {
   const texto=['Ana Pérez','2 ADL',rol,'Pedro Silva','2 noches'].join(separador);
   assert.equal(leer(texto).reservas[0]?.titular,'Ana Pérez',texto);
   const sinTitular=[rol,'Pedro Silva','2 ADL','2 noches'].join(separador);
   assert.equal(leer(sinTitular).reservas.length,0,sinTitular);
  }
 }
 // El rol sólo afecta al campo contiguo, nunca salta un dato ni oculta un segundo huésped.
 for(const texto of ['Ana Pérez // Camarero // 2 ADL // Pedro Silva',
  'Ana Pérez // Camarero // Rosa Vega // Pedro Silva']) {
  assert.equal(leer(texto).reservas.length,0,texto);
  assert.deepEqual(leer(texto).anotaciones[0].titulares_posibles,['Ana Pérez','Pedro Silva']);
 }
});

test('la celda de aseo conserva su responsable sin prestarlo a la reserva contigua', () => {
 const d=S.normalizarHoja(hoja('Ana Pérez // 2 ADL // 2 noches',
  'Check out Laura // Rosa Vega // 10:00-11:00 // IN Pedro // Check Elena'), 'Nov26');
 assert.equal(d.reservas[0].titular,'Ana Pérez');assert.equal(d.aseos[0].camarero,'Rosa Vega');
 assert.equal(d.aseos[0].origen.celda,'W5');assert.equal(d.reservas[0].coordenadas_origen.celda,'X5');
 const vacia=S.normalizarHoja(hoja('', 'Check out Laura // Rosa Vega // 10:00-11:00'), 'Nov26');
 assert.equal(vacia.reservas.length,0);assert.equal(vacia.aseos[0].camarero,'Rosa Vega');
});

test('pagador y profesional identificados no reemplazan al huésped ni crean movimientos', () => {
 for(const nota of ['Transferencia de Pedro Silva','Pago realizado por Pedro Silva','Pagador: Pedro Silva',
  'Masajista: Rosa Vega','Terapeuta: Rosa Vega','Acompañante: Pedro Silva']) {
  const d=leer(`Ana Pérez // 2 ADL // 2 noches // ${nota}`);
  assert.equal(d.reservas[0]?.titular,'Ana Pérez',nota);assert.equal(d.pagos.length,0);
  assert.equal(d.reservas[0].servicios.length,0,nota);
 }
});

test('profesiones sin prestación no crean masajes; una prestación explícita conserva sus datos', () => {
 for(const texto of ['Masajista: Rosa Vega 17:00','Terapeuta Rosa Vega 1 hora','Masajistas disponibles', 'Terapeutas disponibles']) {
  assert.equal(S.clasificarFragmentoServicio(texto).semantica,'NO_SERVICIO',texto);
  assert.equal(S.servicios(texto).length,0,texto);
 }
 for(const texto of ['Masaje terapéutico 1 hora 17:00 con Rosa Vega', 'Masajista Rosa Vega: masaje relajante 1 hora 17:00']) {
  const servicios=S.servicios(texto);assert.equal(servicios.length,1,texto);
  assert.equal(servicios[0].concepto,'masaje');assert.equal(servicios[0].hora,'17:00');
 }
});

test('la anotación de aseo no altera notas, cobro, horarios ni clasificación de servicios', () => {
 const texto='Ana Pérez // 2 ADL // 2 noches // TINAJA TONEL 07-11-2026 17:15 CORTESÍA // ENTREGADO CARBON';
 const antes=leer(texto),despues=leer(texto+' // aseo express realizado por Rosa Vega');
 assert.deepEqual(despues.reservas[0].servicios,antes.reservas[0].servicios);
 assert.deepEqual(despues.reservas[0].pagos_pendientes,antes.reservas[0].pagos_pendientes);
 assert.equal(despues.reservas[0].servicios[0].cortesia,true);
 assert.match(despues.reservas[0].texto_original,/ENTREGADO CARBON/);
});

test('dos nombres sin rol siguen requiriendo aclaración; el nombre del personal no se veta globalmente', () => {
 for(const texto of ['Ana Pérez // Pedro Silva // aseo express realizado por Rosa Vega',
  'Ana Pérez // 2 ADL // Pedro Silva // Camarero: Rosa Vega']) {
  const d=leer(texto);assert.equal(d.reservas.length,0);
  assert.deepEqual(d.anotaciones[0].titulares_posibles,['Ana Pérez','Pedro Silva']);
 }
 for(const nombre of ['Rosa Vega','Pedro Silva','René del Campo','Ana Limpio','Juan del Aseo'])
  assert.equal(leer(`${nombre} // 2 ADL // 2 noches`).reservas[0]?.titular,nombre);
});

test('préstamos, instrucciones, insumos y no show se conservan como contexto de la reserva', () => {
 for(const nota of ['se le prestó cenicero','implementos asado','se le prestó cartas','RESERVA NO SHOW',
  'COLOCAR ENDULZANTE','AFILAR LOS CUCHILLOS','NO HACERLES FIRMAR EL CONTRATO DE MASCOTAS',
  'COLOCAR CORTESIA DE ESPUMANTE Y CHOCOLATES','SE LE PRESTÓ UN CARGADOR DE TELEFONO',
  'minipimer y mortero','Ana Pedir Rut','se entregó tabla de picar nueva']) {
  for(const texto of [`Ana Pérez // 2 ADL // ${nota}`,`${nota} // Ana Pérez // 2 ADL`]) {
   const d=leer(texto);assert.equal(d.reservas[0]?.titular,'Ana Pérez',texto);
   assert.equal(d.reservas[0].texto_original,texto);assert.equal(d.pagos.length,0);
  }
  assert.equal(leer(nota).reservas.length,0,nota);
 }
});

test('el canal con separador conserva el nombre; NO SHOW describe la reserva, no al titular', () => {
 for(const canal of ['BOOKING-','Booking:','AIRBNB —','WALK IN -']) {
  const texto=`${canal} Ana Pérez // 2 ADL // 2 noches // NO SHOW`;
  const d=leer(texto);assert.equal(d.reservas[0]?.titular,'Ana Pérez',texto);
  assert.equal(d.reservas[0].texto_original,texto);
  const ambigua=leer(texto+' // Pedro Silva');assert.equal(ambigua.reservas.length,0);
  assert.deepEqual(ambigua.anotaciones[0].titulares_posibles,['Ana Pérez','Pedro Silva']);
 }
 for(const texto of ['BOOKING - pedir rut','Booking - pago pendiente','NO SHOW'])
  assert.equal(leer(texto).reservas.length,0,texto);
});

test('consulta y preparación recuperan la reserva con nota de aseo sin escribir datos', async () => {
 const data=leer('Ana Pérez // 2 ADL // 2 noches // aseo express realizado por Rosa Vega');
 const w=F.web(data);w.HAIKU_LIBRO_RESERVA_V1={...w.HAIKU_LIBRO_RESERVA_V1,listarHojas:()=>['Nov26']};
 const db=F.cliente({reserva_estadias:[],pagos:[],cabanas:[],bloqueos_cabana:[]});
 const q=w.HAIKU_LIBRO_CONSULTAS;
 const r=await q.consultar('Libro: compara reservas de noviembre 2026 con Proyecto H',w.HAIKU_LIBRO_RESERVA_V1,db);
 assert.equal(r.comparacion.meta.faltantes,1);assert.equal(r.reservas_por_identificar.length,0);
 const plan=await q.prepararIncorporacion(r,new Map(),new Set(),db);
 assert.equal(plan.items.filter(i=>i.categoria==='nuevas').length,1);assert.deepEqual(db.mutaciones,[]);
});
