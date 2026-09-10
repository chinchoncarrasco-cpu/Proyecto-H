const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../js/haiku-libro-semantica-v1.js'),fixture=require('./fixtures/libro-pagos-sep26.cjs');
for(const texto of ['BOVE: 16968','BOVE 16968','BOVE: 16.968']) test('evidencia sin monto: '+texto,()=>{
 const d=fixture(); d.celdas.push({r:26,c:11,valor:texto});
 const e=S.normalizarHoja(d,'Sep26').evidencias_bove[0];
 assert.equal(e.numero,'16968');assert.equal(e.estado,'registrado');
 assert.deepEqual(e.origen,{hoja:'Sep26',celda:'L27',fila:27,columna:12});assert.equal(e.reserva_id,undefined);
});
for(const texto of ['PEND BOVE','BOVE PEND','PENDIENTE BOVE','PEND 50% BOVE Y MANAGER']) test(texto+' sin número',()=>{
 const e=S.normalizarHoja({celdas:[{r:0,c:0,valor:texto}]},'X').evidencias_bove;
 assert.equal(e[0].numero,null);assert.equal(e[0].estado,'pendiente');
});
test('BOVTAR y texto sin BOVE no generan evidencia',()=>{
 assert.deepEqual(S.normalizarHoja({celdas:[{r:0,c:0,valor:'BOVTAR: 16968'},{r:1,c:0,valor:'Nota sin monto'}]},'X').evidencias_bove,[]);
});
test('evidencia paralela mantiene reservas, pagos y comparación, sin mutar entrada',()=>{
 const a=fixture(),b=fixture();b.celdas.push({r:26,c:11,valor:'BOVE: 16968'});const copy=structuredClone(b);
 const x=S.normalizarHoja(a,'Sep26'),y=S.normalizarHoja(b,'Sep26');
 assert.deepEqual(x.reservas,y.reservas);assert.deepEqual(x.pagos,y.pagos);
 assert.deepEqual(x.reservas.map(r=>r.pagos_sin_asociacion),y.reservas.map(r=>r.pagos_sin_asociacion));
 assert.deepEqual(S.compararVersiones(x.reservas,y.reservas),S.compararVersiones(x.reservas,x.reservas));assert.deepEqual(b,copy);
});
test('geometría aporta sólo contexto y formatos inciertos no inventan número',()=>{
 const d=fixture();d.celdas.push({r:26,c:11,valor:'BOVE: 16968'});const e=S.normalizarHoja(d,'Sep26').evidencias_bove[0];
 assert.equal(e.fecha_bloque,'2026-09-03');assert.equal(e.cabana_contexto,1);assert.equal(e.titular,undefined);
 for(const texto of ['BOVE por gestionar','BOVE 50%','BOVE 16.97']){
  const x=S.normalizarHoja({celdas:[{r:0,c:0,valor:texto}]},'X').evidencias_bove[0];assert.equal(x.numero,null);assert.equal(x.estado,'no_determinado');
 }
});
test('BOVE no afecta explícita conserva número corto',()=>{
 const e=S.normalizarHoja({celdas:[{r:0,c:0,valor:'BOVE NO AFECTA: 327'}]},'X').evidencias_bove[0];assert.equal(e.numero,'327');
});
