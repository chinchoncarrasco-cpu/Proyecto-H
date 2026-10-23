const {entorno}=require('./libro-medio-pago-manual.cjs');
const T=require('./libro-transferencias-bancarias.cjs');
function caso(tipo='efectivo_servicio') {
 const h=entorno({alojamiento:tipo!=='efectivo_servicio',conServicios:tipo==='efectivo_servicio',fuerte:false});
 h.ctx.haikuSesion={usuario:{activo:true},roles:[{codigo:'administrador'}]};h.capacidad=true;
 const rpc=h.db.rpc.bind(h.db);
 h.db.rpc=async(n,a)=>{
  if(n==='haiku_libro_transferencias_capacidad_v2')return {data:{version:2,confirmacion_final:true}};
  const r=await rpc(n,a);
  if(n==='haiku_libro_aplicaciones_servicio_capacidad_v1')r.data={...r.data,revision_pago_admin_v1:h.capacidad};
  return r;
 };
 const p=h.r.pagos[0];p.bove=null;
 if(tipo==='efectivo_servicio') {
  Object.assign(p,{medio_pago:'efectivo',concepto:'masaje',monto:40000,texto_original:'Cliente sintético // EFECTIVO // MASAJE // $40.000'});
  Object.assign(h.tablas.servicios[0],{total:40000,catalogo_servicios:{codigo:'masaje30',nombre:'Masaje 30 min',categoria:'masaje'}});
  Object.assign(h.tablas.vista_estado_cargos[0],{concepto:'Masaje 30 min',monto:40000,monto_ajustado:40000,saldo_cargo:40000});
 } else {
  const parsed=T.leer([{cabana:10,pagos:[{concepto:'cab2/1noche',monto:135000}]}]).reservas[0];
  Object.assign(h.r,{...parsed,id:h.r.id});
  const e=h.tablas.reserva_estadias[0];e.cabanas.numero=10;e.fecha_ingreso=parsed.fecha_checkin;e.fecha_salida=parsed.fecha_checkout;
  Object.assign(e.reservas,{titular_nombre:parsed.titular,titular_numero_documento:parsed.rut_documento});
  h.result.q={desde:'2026-10-01',hasta:'2026-10-31'};
 }
 h.p=h.r.pagos[0] || h.r.pagos_sin_asociacion[0];
 h.confirmar=(plan,extra={})=>h.Q.resolverAprobacionManualPago(h.result,h.decisiones,h.aprobados,plan,h.item(plan).id,
  {tipo:'revision_admin_pago',confirmado:true,cabana:h.r.cabana,motivo:'Recepción y destino verificados personalmente',...extra},h.db);
 return h;
}
module.exports={caso};
