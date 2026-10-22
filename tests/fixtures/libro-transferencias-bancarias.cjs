// Libro sintético: no consulta, aprueba ni registra pagos reales.
const S=require('../../js/haiku-libro-semantica-v1.js');
const C=require('../../js/haiku-libro-pagos-canon-v1.js');
const L=require('../../js/haiku-libro-lenguaje-natural-v1.js').crearSemantica(S,C);
const glosa='Transf. 0177406988 ALMONACID ERICES EXEQUIEL IGNACIO';
function leer(casos=[{}]) {
 const celdas=[{r:1,c:2,valor:'30 oct',fechaISO:'2026-10-30'},{r:1,c:6,valor:'31 oct',fechaISO:'2026-10-31'},
  {r:24,c:2,valor:'Pagos de arriendos de hoy'}],combinaciones=[];
 casos.forEach((caso,i)=>{
  const cab=caso.cabana ?? 10+i,fila=2+i,pie=25+i*6;
  celdas.push({r:fila,c:0,valor:'cabana '+cab},
   {r:fila,c:2,valor:(caso.titular || 'Exequiel Almoncid')+' // 2 ADL // RUT '+(caso.rut || '17740698-8')},
   {r:pie,c:0,valor:'cabana '+cab});
  combinaciones.push({s:{r:fila,c:2},e:{r:fila,c:4}},{s:{r:pie,c:0},e:{r:pie+4,c:0}});
  for(const [j,p] of (caso.pagos || [{}]).entries()) {
   const fecha=p.fecha===undefined?'2026-10-21':p.fecha,monto=p.monto===undefined?75000:p.monto;
   celdas.push({r:pie+1+j,c:2,valor:fecha || '',...(fecha?{fechaISO:fecha}:{})},
    {r:pie+1+j,c:3,valor:p.glosa===undefined?glosa:p.glosa},
    {r:pie+1+j,c:4,valor:p.concepto===undefined?'cab'+cab+'/1noche':p.concepto},
    {r:pie+1+j,c:5,valor:monto==null?'':String(monto),...(monto==null?{}:{valorNumero:monto})});
  }
 });
 const hoja={celdas,combinaciones};
 return L.corregirResultado(C.corregirResultado(S.normalizarHoja(hoja,'Oct26')));
}
function cliente(reservas,pagos=[]) {
 const llamadas=[];
 const estadias=reservas.map((r,i)=>({id:'estadia-sintetica-'+i,reserva_id:'reserva-sintetica-'+i,cabanas:{numero:r.cabana},
  fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,tipo_estadia:r.tipo_estadia,adultos:2,ninos:0,mascotas:0,
  estado_estadia:'confirmada',reservas:{titular_nombre:r.titular,titular_tipo_documento:'rut',titular_numero_documento:r.rut_documento,
   estado_reserva:'confirmada',observaciones:r.texto_original}}));
 return {llamadas,estadias,auth:{getSession:async()=>({data:{session:{user:{id:'usuario-sintetico'}}}})},
  from(tabla){llamadas.push(tabla);const data=tabla==='reserva_estadias'?estadias:tabla==='pagos'?pagos:[];
   const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range(a,z){return Promise.resolve({data:data.slice(a,z+1)})}};return b;},
  rpc(nombre){llamadas.push(nombre);if(/capacidad/.test(nombre))return Promise.resolve({data:null});throw Error('Escritura prohibida en esta prueba: '+nombre);}};
}
module.exports={S,leer,cliente,glosa};
