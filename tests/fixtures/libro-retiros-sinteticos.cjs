const F=require('./libro-comparacion-readonly.cjs'),S=require('../../js/haiku-libro-semantica-v1.js');
const bloque=s=>'[DATOS DEL LIBRO]\n'+s+'\n[/DATOS DEL LIBRO]';
function crear(){
 const antes='Comentario manual intacto.\n'+bloque('Ingreso 18:00\nLate check-out 14:00')+'\n'+
  bloque('Ingreso 18:00\nLate check-out 14:00')+'\n[DATOS DEL LIBRO]\nIngreso 18:00\nLate check-out 14:00';
 const a=F.reserva({id:'Oct26!C3',hoja:'Oct26',titular:'Aurora Ficción',noches:1,fecha_checkout:'2026-10-04',fechas_ocupadas:['2026-10-03'],
  texto_original:'',notas_importantes:['Ingreso 19:00','Late check-out 14:00'],servicios:[]});
 const servicio=hora=>S.servicios(`TINAJA TONEL ${hora} CORTESIA`,{origen_campo:'notas_reserva'})[0];
 const b=F.reserva({id:'Oct26!C4',hoja:'Oct26',titular:'Bastián Inventado',cabana:2,noches:1,fecha_checkout:'2026-10-04',fechas_ocupadas:['2026-10-03'],
  texto_original:'',notas_importantes:[],servicios:[servicio('19:00')],coordenadas_origen:F.origen('C4')});
 const estadias=[a,b].map((r,i)=>F.estadia(r,{id:'estadia-sintetica-'+i,reserva_id:'reserva-sintetica-'+i,
  reservas:{id:'reserva-sintetica-'+i,titular_nombre:r.titular,estado_reserva:'confirmada',actualizado_en:'2026-10-01T12:00:00Z',
   observaciones:i===0?antes:bloque('TINAJA TONEL 18:00 CORTESIA')}}));
 const servicios=estadias.map((e,i)=>({id:'servicio-sintetico-'+i,reserva_id:e.reserva_id,estadia_id:e.id,
  catalogo_servicio_id:'catalogo-tonel',catalogo_servicios:{id:'catalogo-tonel',codigo:'tinajaTonel',nombre:'Tinaja Tonel',activo:true,permite_cortesia:true},
  fecha_servicio:'2026-10-03',hora_inicio:'18:00',hora_fin:'19:00',personas:2,cantidad:1,precio_unitario_aplicado:0,monto_adicional:0,total:0,tipo_cobro:'cortesia',
  motivo_cortesia:'Cortesía sintética del Libro.',estado_servicio:'programado',actualizado_en:'2026-10-01T12:00:00Z',
  observaciones:'Importado desde Libro de Reserva. TINAJA TONEL 18:00 CORTESIA [HAKU-LIBRO-SERVICIO:srv:sintetico-'+i+']'}));
 const data={hoja:'Oct26',reservas:[a,b],pagos:[],cancelaciones:[],bloqueos:[],aseos:[],espacios:[],anotaciones:[],advertencias:[],
  fechas:Array.from({length:31},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0')),cobertura:{geometria:true,pagos:true}};
 const previa={...F.copy(data),reservas:[{...F.copy(a),notas_importantes:['Ingreso 18:00','Late check-out 14:00'],servicios:[servicio('18:00')]},
  {...F.copy(b),servicios:[servicio('18:00')]}]};
 const db={reserva_estadias:estadias,reservas:estadias.map(e=>e.reservas),servicios,
  catalogo_servicios:[servicios[0].catalogo_servicios],cargos:[],vista_estado_cargos:[],pago_aplicaciones:[],cargo_ajustes:[],pagos:[],cabanas:[],bloqueos_cabana:[]};
 const registros=data.reservas.map((r,i)=>({id:'historia-sintetica-'+i,tipo:'modificacion',anterior:previa.reservas[i],actual:r,
  fuente_vigente:{estado:'verificada',generacion:1},cambios:[
   ...(i===0?[{campo:'notas_importantes',antes:previa.reservas[i].notas_importantes,ahora:r.notas_importantes}]:[]),
   {campo:'servicios',antes:previa.reservas[i].servicios,ahora:r.servicios}]}));
 return {data,previa,db,registros,antes};
}
function libro(data,previa,registros=[]){
 let historial=structuredClone(registros);
 const estado=()=>({cargado:true,nombre:'libro-sintetico.xlsx',version:'b'.repeat(64),generacion:1});
 const api={estado,listo:async()=>{},listarHojas:()=>['Oct26'],leerCambiosDetectados:async()=>({version:1,cambios:structuredClone(historial)}),
  guardarCambiosDetectados:async r=>{historial=structuredClone(r.cambios);},
  consultarHoja:async(h,version='actual')=>structuredClone(version==='anterior'?previa:data),
  consultarIndice:async()=>({nombres:['Oct26']}),
  consultarHuellas:async version=>({version_huella:2,nombres:['Oct26'],huellas:{Oct26:{sha256:(version==='anterior'?'a':'b').repeat(64)}}})};
 api.crearLectura=async()=>api;return api;
}
function regresiones(){
 const escenarios=[];
 for(const respaldo of [true,false]){
  const f=crear(),r=f.data.reservas[0],viejo='JACUZZI 18:30',nuevo='JACUZZI 15:30',late='Late check-out 14:00';
  f.data.reservas=[r];f.previa.reservas=[{...structuredClone(r),notas_importantes:respaldo?[viejo,late]:['Indicación anterior sin horario'],servicios:[]}];
  r.notas_importantes=[nuevo,late];f.db.reserva_estadias=f.db.reserva_estadias.slice(0,1);f.db.servicios=[];
  f.db.reserva_estadias[0].reservas.observaciones='[DATOS DEL LIBRO]\n'+viejo+'\n'+late+'\n'+late+'\nComentario manual intacto.';
  f.registros=[];escenarios.push({...f,caso:respaldo?'notas-respaldo':'notas-inciertas'});
 }
 for(const incorporada of [false,true]){
  const f=crear(),r=f.data.reservas[0];r.notas_importantes=incorporada?['Dato vigente']:['Dejar dos batas'];
  if(!incorporada)r.texto_original='Dejar dos batas';
  f.data.reservas=[r];f.previa.reservas=[];f.db.servicios=[];
  f.db.reserva_estadias=incorporada?f.db.reserva_estadias.slice(0,1):[];
  if(incorporada)f.db.reserva_estadias[0].estado_estadia='checked_out';
  f.registros=[{id:'retiro-obsoleto',tipo:'retiro',anterior:{...structuredClone(r),notas_importantes:['Dato anterior']},actual:null,cambios:[]}];
  escenarios.push({...f,caso:incorporada?'reaparecida-existente':'reaparecida-alta'});
 }
 const f=crear();f.data.reservas=f.data.reservas.slice(0,1);f.data.reservas[0].notas_importantes=[];f.previa.reservas=structuredClone(f.data.reservas);
 f.db.reserva_estadias=f.db.reserva_estadias.slice(0,1);f.db.servicios=f.db.servicios.slice(0,1);
 f.db.reserva_estadias[0].reservas.observaciones=bloque('');
 f.db.servicios[0].observaciones='Importado desde Libro de Reserva. TEXTO ANTIGUO ILEGIBLE [HAKU-LIBRO-SERVICIO:srv:ilegible]';
 f.registros=[];escenarios.push({...f,caso:'servicio-ilegible'});
 return escenarios;
}
module.exports={crear,libro,bloque,regresiones};
