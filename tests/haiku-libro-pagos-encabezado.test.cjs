const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
const fixture = require('./fixtures/libro-pagos-sep26.cjs');

test('Sep26: blank merged financial heading retains actual K46:N47 as CAB 5 review movements',()=>{
 const data=fixture(), original=structuredClone(data), out=S.normalizarHoja(data,'Sep26');
 assert.deepEqual(data,original);
 const r=out.reservas.find(r=>r.cabana===5);
 assert.equal(r.pagos.length,0); assert.equal(r.pagos_sin_asociacion.length,2);
 assert.equal(r.cabana,5); assert.equal(r.fecha_checkin,'2026-09-03');
 const [a,b]=r.pagos_sin_asociacion;
 assert.deepEqual([a.monto,a.medio_pago,a.fecha_comprobante,a.folio,a.bovtar,a.origen.celda],
  [153000,'credito','2026-09-03','000235','173121','K46:N46']);
 assert.match(a.advertencias.join(' '),/CAB 1.*CAB 5/);
 assert.deepEqual([b.monto,b.tipo_movimiento,b.concepto,b.folio,b.bovtar,b.origen.celda],
  [40000,'servicio','early check in','000235','173121','K47:N47']);
 assert.equal(r.cobertura_pagos,false);
});

test('Sep26: labelled September 04 payments remain byte-for-byte identical',()=>{
 const data=fixture(), without=fixture();
 without.celdas=without.celdas.filter(c=>!(c.r===45||c.r===46));
 const get=d=>S.normalizarHoja(d,'Sep26').reservas.find(r=>r.cabana===10).pagos;
 assert.deepEqual(get(data),get(without));
 assert.deepEqual(get(data).map(p=>[p.monto,p.medio_pago,p.folio,p.bovtar]),
  [[100000,'efectivo',null,null],[20000,'debito','000242','750453']]);
});

test('missing heading recovery refuses unknown geometry, another heading and incomplete financial rows',()=>{
 for(const mutate of [
  d=>d.combinaciones=d.combinaciones.filter(m=>!(m.s.r===24&&m.s.c===10)),
  d=>d.celdas.find(c=>c.r===24&&c.c===10).valor='Otros registros',
  d=>d.celdas.filter(c=>(c.r===45||c.r===46)&&c.c===10).forEach(c=>c.fechaISO=null),
  d=>d.celdas=d.celdas.filter(c=>!/Pagos de arriendos/.test(c.valor))
 ]) {
  const d=fixture(); mutate(d);
  assert.equal(S.normalizarHoja(d,'Sep26').pagos.filter(p=>p.fecha_bloque==='2026-09-03').length,0);
 }
});

test('contradictory cabin with multiple compatible stays never becomes an automatic payment association',()=>{
 const d=fixture(); d.celdas.push({r:7,c:10,valor:'Macarena Hurtado // 1 noche'});
 const out=S.normalizarHoja(d,'Sep26');
 assert.equal(out.reservas.flatMap(r=>r.pagos).filter(p=>p.fecha_bloque==='2026-09-03').length,0);
 assert.equal(out.reservas.find(r=>r.cabana===5).pagos_sin_asociacion.length,2);
});
