// PostgreSQL WASM efímero; usa los RPC versionados y sólo datos sintéticos.
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {preparar}=require('./fixtures/libro-identidad-documento-sql.cjs');
global.HAIKU_LIBRO_SEMANTICA=require('../js/haiku-libro-semantica-v1.js');
const Q=require('../js/haiku-libro-consultas-v1.js');
const bloque=s=>'[DATOS DEL LIBRO]\n'+s+'\n[/DATOS DEL LIBRO]';
function modelos(h,observaciones,notas){
 const s={id:h.ids.estadia,reserva_id:h.ids.reserva,titular:'Persona Ficticia A',rut_documento:'FICTICIO-A',tipo_documento:'pasaporte',
  cabana:1,fecha_checkin:'2026-10-13',fecha_checkout:'2026-10-15',tipo_estadia:'alojamiento',adultos:1,ninos:0,mascotas:0,
  estado_operativo:'confirmada',estado_reserva:'confirmada',observaciones};
 const r={...s,id:'Oct26!C3',texto_original:'',notas_importantes:notas,pagos_pendientes:[],servicios:[]};
 return {s,r};
}
test('SQL: retiro vacío, resultado confirmado e idempotencia conservan reservas, historia financiera e identidad',async()=>{
 const h=await preparar();try{
  const antes=bloque('Nota retirada');await h.db.query('update reservas set observaciones=$1 where id=$2',[antes,h.ids.reserva]);
  const {s,r}=modelos(h,antes,[]),p=Q.actualizacionReservaLibro(r,s);p.item_id='retiro-sintetico';
  assert.equal(p.reserva.despues.observaciones,bloque(''));const snapshot=await h.snapshot(),op=randomUUID();
  const desconocido=structuredClone(p);desconocido.reserva.despues.observaciones='';
  await assert.rejects(h.lote([desconocido]),/sin valor del Libro/);assert.deepEqual(await h.snapshot(),snapshot);
  const result=await h.lote([p],op);assert.equal(result.actualizaciones,1);
  const valor=(await h.db.query('select observaciones from reservas where id=$1',[h.ids.reserva])).rows[0].observaciones;
  assert.equal(valor,bloque(''));const final=await h.snapshot();assert.deepEqual(final.pagos,snapshot.pagos);assert.deepEqual(final.cargos,snapshot.cargos);
  assert.equal(final['private.haiku_libro_incorporaciones'].length,1,'la operación confirmada queda en el registro idempotente');
  assert.deepEqual(final.huespedes,snapshot.huespedes);assert.deepEqual(final.estadia_huespedes,snapshot.estadia_huespedes);
  assert.equal((await h.lote([p],op)).reintento,true);assert.deepEqual(await h.snapshot(),final);
  assert.equal(Q.actualizacionReservaLibro(r,{...s,observaciones:valor}).reserva.cambios.length,0);
 }finally{await h.db.close();}
});
test('SQL: bloque repetido e incompleto, hora corregida, late una vez y comentario manual intacto',async()=>{
 const h=await preparar();try{
  const antes='Comentario manual intacto.\n'+bloque('Ingreso 18:00\nLate check-out 14:00')+'\n'+
   bloque('Ingreso 18:00\nLate check-out 14:00')+'\n[DATOS DEL LIBRO]\nIngreso 18:00\nLate check-out 14:00';
  await h.db.query('update reservas set observaciones=$1 where id=$2',[antes,h.ids.reserva]);
  const {s,r}=modelos(h,antes,['Ingreso 19:00','Late check-out 14:00','Late check-out 14:00']);
  const p=Q.actualizacionReservaLibro(r,s);p.item_id='correccion-sintetica';await h.lote([p]);
  const valor=(await h.db.query('select observaciones from reservas where id=$1',[h.ids.reserva])).rows[0].observaciones;
  assert.equal(valor,p.reserva.despues.observaciones);assert.match(valor,/Comentario manual intacto\./);assert.doesNotMatch(valor,/18:00/);
  assert.equal((valor.match(/Late check-out 14:00/g)||[]).length,1);assert.equal(Q.separarObservacionesLibro(valor).bloques.length,1);
  assert.equal(Q.actualizacionReservaLibro(r,{...s,observaciones:valor}).reserva.cambios.length,0);
 }finally{await h.db.close();}
});
test('SQL: cambio concurrente entre vista previa y guardado rechaza el parche y preserva todos los datos',async()=>{
 const h=await preparar();try{
  const antes=bloque('Nota anterior');await h.db.query('update reservas set observaciones=$1 where id=$2',[antes,h.ids.reserva]);
  const {s,r}=modelos(h,antes,[]),p=Q.actualizacionReservaLibro(r,s);p.item_id='concurrencia-sintetica';
  await h.db.query('update reservas set observaciones=$1 where id=$2',['Comentario manual nuevo.\n'+antes,h.ids.reserva]);
  const snapshot=await h.snapshot();await assert.rejects(h.lote([p]),/cambi|prepar|conflict|nuevo/i);assert.deepEqual(await h.snapshot(),snapshot);
 }finally{await h.db.close();}
});

test('SQL: marcador único abierto, jacuzzi corregido con evidencia anterior, late único y manual intacto',async()=>{
 const h=await preparar();try{
  const viejo='JACUZZI 18:30',nuevo='JACUZZI 15:30',late='Late check-out 14:00';
  const antes='[DATOS DEL LIBRO]\n'+viejo+'\n'+late+'\n'+late+'\nComentario manual intacto.';
  await h.db.query('update reservas set observaciones=$1 where id=$2',[antes,h.ids.reserva]);
  const {s,r}=modelos(h,antes,[nuevo,late]);
  r._observacionesLibroParcial={retirar:[viejo]};r._evidenciaNotasLibroAnterior=[viejo,late];
  const p=Q.actualizacionReservaLibro(r,s);p.item_id='jacuzzi-corregido';const snapshot=await h.snapshot(),op=randomUUID();
  assert.ok(p.reserva.despues.observaciones);await h.lote([p],op);
  const valor=(await h.db.query('select observaciones from reservas where id=$1',[h.ids.reserva])).rows[0].observaciones;
  const partes=Q.separarObservacionesLibro(valor);
  assert.equal(partes.base,'Comentario manual intacto.');assert.equal(partes.bloques.length,1);assert.equal(partes.malformado,false);
  assert.deepEqual(partes.bloques[0].split('\n').sort(),[nuevo,late].sort());assert.doesNotMatch(valor,/18:30/);
  const final=await h.snapshot();assert.deepEqual(final.pagos,snapshot.pagos);assert.deepEqual(final.cargos,snapshot.cargos);
  assert.deepEqual(final.huespedes,snapshot.huespedes);assert.deepEqual(final.estadia_huespedes,snapshot.estadia_huespedes);
  assert.equal((await h.lote([p],op)).reintento,true);assert.deepEqual(await h.snapshot(),final);
  assert.equal(Q.actualizacionReservaLibro(r,{...s,observaciones:valor}).reserva.cambios.length,0);
 }finally{await h.db.close();}
});
