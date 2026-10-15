const {randomUUID}=require('node:crypto');
const repair=require('../../tools/rut-identidad-reparacion.cjs');
async function incidente(h){
  const p={canonicalId:h.ids.guest,redundantId:h.ids.owner,
    original:{id:h.ids.reserva,code:'FICTICIA-ANTERIOR',arrival:'2026-10-13',departure:'2026-10-15',cabin:1,status:'cancelada',payments:1},
    subsequent:{id:randomUUID(),code:'FICTICIA-NUEVA',arrival:'2026-10-30',departure:'2026-11-01',cabin:1,status:'confirmada',payments:0}};
  const eid=randomUUID(),pid=randomUUID(),cid=randomUUID();
  await h.db.query(`insert into reservas(id,codigo_haiku,titular_nombre,titular_tipo_documento,titular_numero_documento,titular_huesped_id,estado_reserva)
    values($1,$2,'Persona Sintética','rut','12345670k',$3,'confirmada')`,[p.subsequent.id,p.subsequent.code,p.redundantId]);
  await h.db.query(`insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia)
    values($1,$2,$3,'2026-10-30','2026-11-01','confirmada')`,[eid,p.subsequent.id,h.ids.cabana]);
  await h.db.query('insert into reserva_huespedes(reserva_id,huesped_id) values($1,$2)',[p.subsequent.id,p.redundantId]);
  await h.db.query('insert into estadia_huespedes(estadia_id,huesped_id) values($1,$2)',[eid,p.redundantId]);
  await h.db.query(`insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values
    ($1,'2026-10-30',100000,'catalogo'),($1,'2026-10-31',100000,'catalogo')`,[eid]);
  await h.db.query(`insert into pagos(id,reserva_id,monto,moneda,tipo_movimiento,medio_pago,estado)
    values($1,$2,10000,'CLP','pago','efectivo','confirmado')`,[pid,p.original.id]);
  await h.db.query(`insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto) values($1,$2,$3,'alojamiento','activo',10000)`,[cid,p.original.id,h.ids.estadia]);
  await h.db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,10000)',[pid,cid]);
  for(const t of ['notas','solicitudes'])await h.db.query(`insert into ${t}(huesped_id,reserva_id,estadia_id) values($1,$2,$3)`,[p.redundantId,p.subsequent.id,eid]);
  const m=await repair.manifest(h.db,p);
  const approval={action:'apply',samePerson:true,authorized:true,manifestHash:m.sha256,evidenceHash:repair.hash('evidencia ficticia independiente del nombre'),operationId:randomUUID()};
  return {p,m,approval,eid,pid,cid};
}
module.exports={incidente};
