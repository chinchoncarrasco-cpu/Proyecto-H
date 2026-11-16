// Únicamente datos ficticios; reproduce las formas de las cinco filas financieras.
const F=require('./libro-comparacion-readonly.cjs');
const N=require('../../js/haiku-libro-lenguaje-natural-v1.js').crearSemantica(
 require('../../js/haiku-libro-semantica-v1.js'),require('../../js/haiku-libro-pagos-canon-v1.js'));
const ids={reserva:'11111111-1111-4111-8111-111111111111',estadia:'22222222-2222-4222-8222-222222222222',
 alojamiento:'33333333-3333-4333-8333-333333333333',jacuzzi:'44444444-4444-4444-8444-444444444444',
 servicio:'55555555-5555-4555-8555-555555555555',pago:'66666666-6666-4666-8666-666666666666'};
const capacidad={version:1,contrato:'aplicaciones_servicio_v1',rpc:'haiku_incorporar_pago_servicios_libro_v1',efectivo_sin_identificador:false,
 conceptos_adicionales:['queque','pan','huevos'],servicio_faltante_manual_v1:true,revision_pago_admin_v1:true,
 excedente_servicio_libro_v1:true,destino_alojamiento_libro_v1:true,precio_cargo_libro_v1:true};
function caso(){
 const r=F.reserva({id:'libro-finanzas-ficticio',titular:'Persona Ficticia',cabana:2,fecha_checkin:'2026-11-13',fecha_checkout:'2026-11-14',
  noches:1,fechas_ocupadas:['2026-11-13'],texto_original:'',coordenadas_origen:{...F.origen('AZ4'),hoja:'Nov26'}});
 const pago=(fila,monto,concepto,texto,extra={})=>F.pago({titular:r.titular,cabana:2,monto,concepto,texto_original:texto,
  fecha_comprobante:'2026-11-14',fecha_bloque:r.fecha_checkin,medio_pago:'debito',codigo_autorizacion:null,
  folio:'8800'+fila,bovtar:'9900'+fila,origen:{hoja:'Nov26',celda:`AZ${fila}:BC${fila}`},
  evidencia_financiera:{sector:'pagos',columnas_ocupadas:{fecha:true,detalle:true,concepto:true,monto:true}},...extra});
 r.pagos=[pago(31,144000,'cab3//1noche','Webpay confirmado CodAut 770031 débito',
  {fecha_comprobante:'2026-10-16',medio_pago:'webpay_debito',codigo_autorizacion:'770031',folio:null,bovtar:null}),
  pago(32,14400,'DIFERENCIA TARIFA','1234567890 Transf. Persona Ficticia // GO',{tipo_movimiento:'otro',medio_pago:'transferencia',folio:null,bovtar:null,fecha_comprobante:'2026-10-22'}),
  pago(33,16000,'penalidad','Bovtar:990033-Folio:880033// credito// PEND BOVE Y MANAGEER',
   {tipo_movimiento:'penalidad',medio_pago:'credito',pago_recibido:null,fecha_comprobante:'2026-10-22'}),
  pago(34,32500,'tinaja','Bovtar:990034-Folio:880034// debito',{tipo_movimiento:'servicio'}),
  pago(35,65000,'masaje','Bovtar:990035-Folio:880035// debito',{tipo_movimiento:'servicio'})];
 const entrada={hoja:'Nov26',reservas:[r],pagos:r.pagos,cancelaciones:[],bloqueos:[],aseos:[],espacios:[],anotaciones:[],advertencias:[],cobertura:{geometria:true,pagos:true}};
 const data=N.corregirResultado(entrada);
 const db={reserva_estadias:[F.estadia(r,{id:ids.estadia,reserva_id:ids.reserva,reservas:{id:ids.reserva,titular_nombre:r.titular,estado_reserva:'checked_out'},estado_estadia:'checked_out'})],
  reservas:[],pagos:[F.pagoH({id:ids.pago,reserva_id:ids.reserva,tipo_movimiento:'pago',monto:144000,medio_pago:'webpay_debito',fecha_pago:'2026-10-16',
   codigo_autorizacion:'770031',folio:null,datos_origen:{fecha_bloque:'2026-10-22',origen_libro:{hoja:'Oct26',celda:'CI36:CL36'}}})],
  servicios:[F.servicioH({id:ids.servicio,reserva_id:ids.reserva,estadia_id:ids.estadia,fecha_servicio:'2026-11-13',tipo_cobro:'normal',total:30000,
   catalogo_servicios:{codigo:'tinajaJacuzzi',nombre:'Tinaja Jacuzzi',categoria:'tinaja'}})],
  vista_estado_cargos:[{cargo_id:ids.alojamiento,reserva_id:ids.reserva,estadia_id:ids.estadia,tipo_cargo:'alojamiento',concepto:'Alojamiento ficticio',estado:'activo',monto:144000,monto_ajustado:158400,aplicado_neto:0,saldo_cargo:158400},
   {cargo_id:ids.jacuzzi,reserva_id:ids.reserva,estadia_id:ids.estadia,servicio_id:ids.servicio,tipo_cargo:'servicio',concepto:'Tinaja Jacuzzi',estado:'activo',monto:30000,monto_ajustado:30000,aplicado_neto:0,saldo_cargo:30000}],
  cargo_ajustes:[{id:'ajuste-ficticio',operacion_id:'op-ficticio',reserva_id:ids.reserva,cargo_id:ids.alojamiento,tipo_ajuste:'cargo_modificacion',signo:1,porcentaje:10,monto:14400,estado:'activo',observaciones:'Modificación de tarifa confirmada por operador ficticio'}],
  pago_aplicaciones:[],cabanas:[],bloqueos_cabana:[],estadia_noches:[]};
 return {r:data.reservas[0],data,db,entrada};
}
function contexto(casoActual=caso(),cap=capacidad){
 const {r,data,db}=casoActual,c=F.web(data),cliente=F.cliente(db);
 c.haikuTienePermiso=()=>true;c.haikuSesion={usuario:{activo:true},roles:[{codigo:'administrador'}]};c.haikuSupabase=cliente;
 c.HAIKU_LIBRO_RESERVA_V1={...F.libroBase(data),listarHojas:()=>['Nov26']};
 cliente.rpc=async nombre=>{
  if(nombre==='haiku_libro_aplicaciones_servicio_capacidad_v1')return{data:cap};
  if(nombre==='haiku_resumen_ajustes_unidad')return{data:{reserva_id:ids.reserva,ajustes:cliente.db.cargo_ajustes}};
  if(nombre==='haiku_libro_transferencias_capacidad_v2')return{data:{version:2,confirmacion_final:true,glosa_sin_nombre:true}};
  throw Error('RPC de negocio bloqueado: '+nombre);
 };
 const result={reservas:[r],generacion:1,q:{desde:r.fecha_checkin,hasta:r.fecha_checkout,incluirFinanzas:true}};
 return {...casoActual,c,cliente,Q:c.HAIKU_LIBRO_CONSULTAS,result};
}
module.exports={ids,capacidad,caso,contexto};
