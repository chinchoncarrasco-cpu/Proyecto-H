const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');

// Geometría real de Oct26; sin documentos, contactos ni importes privados.
function octubre() {
 const celdas=[],combinaciones=[];
 const cell=(r,c,valor,extra={})=>celdas.push({r,c,valor,...extra});
 for(let d=1;d<=31;d++) cell(1,2+(d-1)*4,String(d),{fechaISO:`2026-10-${String(d).padStart(2,'0')}`});
 for(let cab=1;cab<=11;cab++) cell(cab+1,0,`cabaña ${cab}`);
 cell(24,2,'Pagos de arriendos de hoy');
 const bloques=[
  [5,54,56,'AIRBNB // Agustin Rampa Spinelli'],
  [5,86,96,'Valeria González Vega'],
  [6,7,12,'Flavia Flores Loyola'],
  [6,34,44,'HUESPED FRECUENTE TRATO ESPECIAL // David Sanchez'],
  [6,90,96,'Rocio Leal'],
  [7,39,44,'Andrés Mahecha'],
  [9,42,48,'Daniel Villallobos'],
  [10,42,44,'HUESPED FRECUENTE // Katty Vaisman'],
  [10,46,48,'LATE CHECK OUT']
 ];
 for(const [r,c,end,texto] of bloques) {
  cell(r,c,texto);combinaciones.push({s:{r,c},e:{r,c:end}});
 }
 cell(6,6,'LIBRE');cell(7,38,'LIBRE');cell(2,2,'LIBRE');
 return {celdas,combinaciones};
}

test('Oct26: eight real guests, exact displaced anchors and dates, no duplicate or operational guest',()=>{
 const data=octubre(),before=JSON.stringify(data),r=S.normalizarHoja(data,'Oct26');
 assert.deepEqual(r.reservas.map(x=>[x.titular,x.coordenadas_origen.celda,x.fecha_checkin,x.fecha_checkout]),[
  ['Agustin Rampa Spinelli','BC6','2026-10-14','2026-10-15'],
  ['Valeria González Vega','CI6','2026-10-22','2026-10-25'],
  ['Flavia Flores Loyola','H7','2026-10-02','2026-10-04'],
  ['David Sanchez','AI7','2026-10-09','2026-10-12'],
  ['Rocio Leal','CM7','2026-10-23','2026-10-25'],
  ['Andrés Mahecha','AN8','2026-10-10','2026-10-12'],
  ['Daniel Villallobos','AQ10','2026-10-11','2026-10-13'],
  ['Katty Vaisman','AQ11','2026-10-11','2026-10-12']
 ]);
 assert.deepEqual(r.reservas.find(x=>x.titular==='Flavia Flores Loyola').fechas_ocupadas,['2026-10-02','2026-10-03']);
 assert.equal(r.reservas.find(x=>x.titular==='Andrés Mahecha').cabana,6);
 assert.ok(r.espacios.some(x=>x.cabana===1&&x.fecha==='2026-10-01'&&x.estado==='libre_explicito'));
 assert.equal(JSON.stringify(data),before);
});

test('shifted recovery excludes auxiliary columns, other rows, vertical merges and unmerged notes',()=>{
 const data=octubre();
 for(const [r,c,endR,endC] of [[2,5,2,8],[3,3,4,4],[14,3,14,4]]) {
  data.celdas.push({r,c,valor:'Persona Auxiliar'});
  data.combinaciones.push({s:{r,c},e:{r:endR,c:endC}});
 }
 data.celdas.push({r:2,c:3,valor:'Nota Administrativa'});
 const res=S.normalizarHoja(data,'Oct26');
 assert.equal(res.reservas.length,8);
 assert.ok(!res.reservas.some(r=>r.titular==='Persona Auxiliar'||r.titular==='Nota Administrativa'));
});

test('known labels and invalid first fragments are skipped before selecting a guest',()=>{
 const etiquetas=['AIRBNB','BOOKING','FULL DAY','PROMO','VOUCHER','LISTA ARCOIRIS','LIBRE','CLIENTE FRECUENTE',
  'HUESPED FRECUENTE','HUESPED FRECUENTE TRATO ESPECIAL','LATE CHECK OUT','X HACER','POR HACER','PENDIENTE','SIN TITULAR','123'];
 for(const etiqueta of etiquetas) {
  const data=octubre();data.celdas.find(c=>c.r===5&&c.c===54).valor=etiqueta+' // Ana Pérez';
  assert.equal(S.normalizarHoja(data,'Oct26').reservas[0].titular,'Ana Pérez',etiqueta);
  data.celdas.find(c=>c.r===5&&c.c===54).valor=etiqueta;
  assert.equal(S.normalizarHoja(data,'Oct26').reservas.length,7,etiqueta);
 }
});

test('reservation labels do not change September payment interpretation or association',()=>{
 const fixture=require('./fixtures/libro-pagos-sep26.cjs');
 const data=fixture(),old=S.normalizarHoja(data,'Sep26');
 for(const c of data.celdas.filter(c=>c.r<24&&c.valor.startsWith('Macarena Hurtado'))) c.valor='AIRBNB // HUESPED FRECUENTE // '+c.valor;
 const now=S.normalizarHoja(data,'Sep26');
 assert.equal(now.pagos.length,4);
 assert.deepEqual(now.reservas.map(r=>[r.titular,r.pagos.length,r.pagos_sin_asociacion.length]),[
  ['Macarena Hurtado',0,2],['Macarena Hurtado',2,0]
 ]);
 const financial=r=>JSON.parse(JSON.stringify({pagos:r.pagos,reservas:r.reservas.map(x=>({pagos:x.pagos,pagos_sin_asociacion:x.pagos_sin_asociacion}))}));
 assert.deepEqual(financial(now),financial(old));
});
