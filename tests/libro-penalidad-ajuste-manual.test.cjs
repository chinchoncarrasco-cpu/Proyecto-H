const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const S=require('../js/haiku-libro-semantica-v1.js');
const Q=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
const A=fs.readFileSync(require.resolve('../js/supabase-ajustes-cargo-v1.js'),'utf8');
const M=fs.readFileSync(require.resolve('../js/supabase-ajustes-cargo-manual-v1.js'),'utf8');
const inicio=Q.indexOf("            if (p.tipo_movimiento === 'penalidad') {");
const fin=Q.indexOf("            if (duplicado) {",inicio);
assert.ok(inicio>0 && fin>inicio);
const rama=Q.slice(inicio,fin).replace(/\bcontinue;\s*}\s*$/,'return item;\n}');
const propuesta=(p,r,destino,comp)=>new Function('p','r','destino','comp','add','id','texto','money',rama)(
 p,r,destino,comp,(cat,id,texto,payload,motivos)=>({categoria:cat,payload,motivos}),
 'item-fixture','Ana de Prueba · CAB 1 · $16.000 · penalidad',n=>'$'+n);
const r={id:'Oct26!C26',cabana:1,fecha_checkin:'2026-10-16',fecha_checkout:'2026-10-17'};
const destino={reserva_id:'11111111-1111-4111-8111-111111111111',
 estadia_id:'22222222-2222-4222-8222-222222222222',bloqueado:false};
const comp=[{libro:{id:r.id},estado:'asociada',sistema:{id:destino.estadia_id,
 reserva_id:destino.reserva_id,cabana:1,fecha_checkin:r.fecha_checkin,fecha_checkout:r.fecha_checkout}}];
const p={tipo_movimiento:'penalidad',cabana:1,fecha_bloque:r.fecha_checkin,monto:16000,moneda:'CLP',
 monto_penalidad:null,penalidad_porcentaje:null,bove_pendiente:true,manager_pendiente:true};

test('parser del Libro: penalidad y BOVE/Manager no equivalen a pago recibido',()=>{
 const data=S.normalizarHoja({celdas:[
  {r:1,c:2,valor:'16 oct',fechaISO:'2026-10-16'},
  {r:1,c:6,valor:'17 oct',fechaISO:'2026-10-17'},
  {r:2,c:0,valor:'cabaña 1'},{r:2,c:2,valor:'Ana de Prueba // 1 noche // 2 ADL'},
  {r:24,c:2,valor:'Pagos de arriendos de hoy'},{r:25,c:0,valor:'cabaña 1'},
  {r:26,c:2,valor:'07-10-2026',fechaISO:'2026-10-07'},
  {r:26,c:3,valor:'Ana de Prueba // Transferencia // PEND BOVE Y MANAGER // penalidad'},
  {r:26,c:4,valor:'penalidad'},{r:26,c:5,valor:'$16.000',valorNumero:16000}
 ],combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}},{s:{r:25,c:0},e:{r:29,c:0}}],estilos:[]},'Oct26');
 assert.equal(data.reservas.length,1);
 assert.equal(data.pagos[0].tipo_movimiento,'penalidad');
 assert.equal(data.pagos[0].pago_recibido,null);
 assert.equal(data.pagos[0].monto,16000);
 assert.equal(data.pagos[0].bove_pendiente,true);
 assert.equal(data.pagos[0].manager_pendiente,true);
});
test('penalidad se muestra como cargo para revisión, no nuevo abono',()=>{
 const item=propuesta(p,r,destino,comp);
 assert.equal(item.categoria,'dudosos');assert.equal(item.payload,null);assert.equal(item.aprobable,false);
 assert.deepEqual(item.penalidadManual,{reservaId:destino.reserva_id,cabana:1,fechaIngreso:r.fecha_checkin,montoLibro:16000});
 assert.match(item.aviso,/BOVE y Manager pendientes son trámites administrativos/);
 assert.doesNotMatch(item.motivos.join(' '),/destino financiero del pago de servicio|aprobación manual de la asociación y el pago/i);
});
test('dos candidatas o otra reserva no habilitan cargo',()=>{
 assert.equal(propuesta(p,r,destino,[...comp,...comp]).penalidadManual,null);
 assert.equal(propuesta(p,r,{...destino,reserva_id:'otra'},comp).penalidadManual,null);
 assert.equal(propuesta(p,r,{...destino,bloqueado:true},comp).penalidadManual,null);
});
test('importe inválido y fecha diferente mantienen revisión sin botón',()=>{
 for(const x of [{...p,monto:0},{...p,moneda:'USD'},{...p,monto_penalidad:12000},
 {...p,penalidad_porcentaje:15},{...p,fecha_bloque:'2026-10-17'}])
    assert.equal(propuesta(x,r,destino,comp).penalidadManual,null);
});
test('aprobación se delega al mismo formulario de ajuste, sin crear pagos en la comparación',()=>{
 assert.match(Q,/Revisar penalidad 10%/);
 assert.match(Q,/HAIKU_AJUSTES_CARGO_V2\?\.abrirParaReserva/);
 assert.match(A,/abrirParaReserva,/);
 assert.doesNotMatch(rama,/haiku_registrar_pago|haiku_aplicar_ajuste/);
});
test('la selección comprueba nuevamente la reserva y previene penalidades duplicadas',()=>{
 assert.match(A,/compatibles\.length !== 1/);
 assert.match(A,/await cargarResumenSeleccionado\(\)/);
 assert.match(A,/['"]cargo_cancelacion['"],['"]cargo_modificacion['"]/);
 assert.match(M,/montoLibro > 0 \? montoLibro : sugerido/);
 assert.match(M,/Confirma motivo e importe antes de aplicar/);
});
