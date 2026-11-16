// Sólo datos sintéticos. Ninguna conexión remota ni escritura de negocio real.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('./fixtures/libro-comparacion-readonly.cjs');
const S=require('../js/haiku-libro-semantica-v1.js'),D=require('../js/haiku-libro-diferencias-v1.js');
const bloque=s=>'[DATOS DEL LIBRO]\n'+s+'\n[/DATOS DEL LIBRO]';
const servicio=(hora='18:00',extra={})=>S.servicios(`TINAJA TONEL ${hora} CORTESIA`,{origen_campo:'notas_reserva'}).map(s=>({...s,...extra}))[0];
function entorno({notas=bloque('Nota anterior'),servicios=[],actuales=[],reservas=true}={}){
 const r=F.reserva({id:'Oct26!C3',hoja:'Oct26',noches:1,fecha_checkout:'2026-10-04',fechas_ocupadas:['2026-10-03'],
  texto_original:'',notas_importantes:[],servicios:actuales});
 const data={hoja:'Oct26',reservas:reservas?[r]:[],fechas:['2026-10-03','2026-10-04'],cobertura:{geometria:true,pagos:true},
  anotaciones:[],espacios:[{cabana:1,fecha:'2026-10-03',estado:'sin_dato',lectura:'vacia_confirmada'}]};
 const db={reserva_estadias:[F.estadia(r,{reservas:{id:'reserva-ficticia-1',titular_nombre:r.titular,estado_reserva:'confirmada',observaciones:notas}})],
  servicios,pagos:[],cabanas:[],bloqueos_cabana:[]};
 const c=F.web(data);for(const f of ['haiku-libro-diferencias-v1','haiku-libro-contexto-v1'])
  vm.runInContext(fs.readFileSync('js/'+f+'.js','utf8'),c);
 let generacion=1;const hojas=new Map([['Oct26',data]]);
 const libro={listo:async()=>{},listarHojas:()=>[...hojas.keys()],estado:()=>({cargado:true,generacion,version:String(generacion).repeat(64)}),
  crearLectura:async()=>{const copia=new Map([...hojas].map(([k,v])=>[k,F.copy(v)])),estado=libro.estado();
   return {listo:libro.listo,estado:()=>estado,listarHojas:()=>[...copia.keys()],consultarHoja:async h=>F.copy(copia.get(h))};}};
 c.HAIKU_LIBRO_RESERVA_V1=libro;c.haikuTienePermiso=()=>true;
 const cliente=F.cliente(db),Q=c.HAIKU_LIBRO_CONSULTAS;
 return {r,data,hojas,c,Q,cliente,libro,cambiar:()=>generacion++,C:c.HAIKU_LIBRO_CONTEXTO_V1,
  comparar:()=>Q.compararSistema([r],cliente,{desde:r.fecha_checkin,hasta:r.fecha_checkout,incluirFinanzas:false})};
}
const guardado=(extra={})=>F.servicioH({catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tinaja Tonel'},
 fecha_servicio:'2026-10-03',hora_inicio:'18:00',hora_fin:'19:00',cantidad:1,personas:2,total:0,tipo_cobro:'cortesia',actualizado_en:'2026-10-01T12:00:00Z',
 observaciones:'Importado desde Libro de Reserva. TINAJA TONEL 18:00 CORTESIA [HAKU-LIBRO-SERVICIO:srv:sintetico]',...extra});
const registro=(e,antes,ahora,campo='notas_importantes')=>({id:'cambio-sintetico',tipo:'modificacion',anterior:{...e.r,[campo]:antes},actual:{...e.r,[campo]:ahora},
 cambios:[{campo,antes,ahora}],fuente_vigente:{estado:'verificada',generacion:1}});

test('retiro puro genera parche vacío y conserva la nota manual',async()=>{
 const e=entorno({notas:'Comentario manual.\n\n'+bloque('Nota anterior')}),comp=await e.comparar();
 const p=e.Q.actualizacionReservaLibro(e.r,comp[0].sistema);
 assert.equal(p.reserva.despues.observaciones,'Comentario manual.\n\n'+bloque(''));
 assert.ok(p.cambios.some(c=>c.campo==='Notas y detalles del Libro'));
 const otra=e.Q.actualizacionReservaLibro(e.r,{...comp[0].sistema,observaciones:p.reserva.despues.observaciones});
 assert.equal(otra.reserva.cambios.length,0);
 const vacio=e.Q.actualizacionReservaLibro(e.r,{...comp[0].sistema,observaciones:bloque('Nota anterior')});
 assert.equal(vacio.reserva.despues.observaciones,bloque(''));
});
test('antes y después ya guardados: la nota antigua sigue pendiente y es retirable',async()=>{
 const e=entorno({notas:bloque('Ingreso 18:00\nIngreso 19:00\nOtra indicación vigente')});e.r.notas_importantes=['Ingreso 19:00'];
 const estado=await e.Q.revalidarCambiosDetectados([registro(e,['Ingreso 18:00'],['Ingreso 19:00'])],e.cliente,{generacion:1});
 assert.equal(estado.items.length,1);assert.equal(estado.items[0].accionable,true);
 const texto=estado.items[0].vistaIncorporacion.notas;assert.ok(texto.retiradas.includes('Ingreso 18:00'));
 const plan=e.Q.crearPlanIncorporacion(estado.reservas,estado.comparacion);
 const guardado=plan.items.find(i=>i.payload?.tipo==='reserva_actualizar').payload.reserva.despues.observaciones;
 assert.doesNotMatch(guardado,/18:00/);assert.match(guardado,/Otra indicación vigente/);
});
test('bloques repetidos, apertura sin cierre, hora corregida y late repetido: una glosa bien formada',async()=>{
 const antes='Comentario manual al inicio.\n'+bloque('Ingreso 18:00 // Late check-out 14:00')+'\n'+
  bloque('Ingreso 18:00\nLate check-out 14:00')+'\n[DATOS DEL LIBRO]\nIngreso 18:00\nLate check-out 14:00\nComentario manual al final.';
 const e=entorno({notas:antes});e.r.notas_importantes=['Ingreso 19:00','Late check-out 14:00','Late check-out 14:00'];
 const comp=await e.comparar(),p=e.Q.actualizacionReservaLibro(e.r,comp[0].sistema),despues=p.reserva.despues.observaciones;
 assert.equal((despues.match(/\[DATOS DEL LIBRO\]/g)||[]).length,1);assert.equal((despues.match(/\[\/DATOS DEL LIBRO\]/g)||[]).length,1);
 assert.equal((despues.match(/Late check-out 14:00/g)||[]).length,1);assert.doesNotMatch(despues,/Ingreso 18:00/);
 assert.match(despues,/Comentario manual al inicio\./);assert.match(despues,/Comentario manual al final\./);
 assert.equal(e.Q.actualizacionReservaLibro(e.r,{...comp[0].sistema,observaciones:despues}).reserva.cambios.length,0);
 assert.match(comp.cambiosLibro.find(x=>x.campo==='notas_importantes').motivo,/incompleto/);
});
test('un fragmento antiguo fuera del bloque queda para revisión, nunca se borra como importado',async()=>{
 const e=entorno({notas:'Ingreso 18:00\nComentario manual.'});
 const p=await e.Q.revalidarCambiosDetectados([registro(e,['Ingreso 18:00'],[])],e.cliente,{generacion:1});
 assert.equal(p.items.length,1);assert.equal(p.items[0].accionable,false);assert.match(p.items[0].cambios[0].proyecto,/origen.*incierto/);
 assert.equal(e.cliente.mutaciones.length,0);
});
test('retirar un servicio con contraparte activa no se resuelve por ausencia de servicios actuales',async()=>{
 const e=entorno({servicios:[guardado()]}),p=await e.Q.revalidarCambiosDetectados([registro(e,[servicio()],[],'servicios')],e.cliente,{generacion:1});
 assert.equal(p.items.length,1);assert.equal(p.items[0].retirosServicios[0].accion,'revisar_cancelacion_servicio');assert.equal(p.resueltos.length,0);
 e.cliente.db.servicios[0].estado_servicio='cancelado';
 const fin=await e.Q.revalidarCambiosDetectados([registro(e,[servicio()],[],'servicios')],e.cliente,{generacion:1});assert.deepEqual(F.copy(fin.resueltos),['cambio-sintetico']);
});
test('horario inequívoco propone el mismo servicio; dos turnos legítimos se conservan',async()=>{
 const e=entorno({servicios:[guardado()],actuales:[servicio('19:00')]}),comp=await e.comparar();
 const c=comp.cambiosLibro.find(x=>x.campo==='servicios');assert.equal(c.accion,'reprogramar_servicio');assert.equal(c.sistema.id,'servicio-ficticio-1');assert.equal(c.despues.hora,'19:00');
 e.r.servicios=[servicio('18:00'),servicio('19:00')];assert.equal((await e.comparar()).cambiosLibro.filter(x=>x.campo==='servicios').length,0);
 e.r.servicios=[servicio('19:00'),servicio('20:00')];assert.equal((await e.comparar()).cambiosLibro.find(x=>x.campo==='servicios').tipo,'revision');
});
test('fechas diferentes distinguen dos servicios y una repetición de texto no los fusiona',async()=>{
 const e=entorno(),s={reserva_id:'r',id:'e'};
 const rows=[guardado({id:'uno',reserva_id:'r',estadia_id:'e'}),guardado({id:'dos',reserva_id:'r',estadia_id:'e',fecha_servicio:'2026-10-04'})];
 const r={...e.r,servicios:[servicio('18:00',{fecha:'2026-10-03'}),servicio('18:00',{fecha:'2026-10-04'})]};
 assert.equal(e.Q.serviciosRetiradosLibro(r,s,rows).length,0);
 assert.equal(D.detallarCambio({campo:'servicios',antes:r.servicios,ahora:[r.servicios[1]]}).retirados.length,1);
});
for(const [nombre,extra]of [['manual',{observaciones:'Servicio manual'}],['realizado',{estado_servicio:'realizado'}],['resolución manual',{libro_resolucion_manual_v1:{version:1}}]])
 test(nombre+': retirada histórica exige revisión',async()=>{
  const e=entorno({servicios:[guardado(extra)]}),p=await e.Q.revalidarCambiosDetectados([registro(e,[servicio()],[],'servicios')],e.cliente,{generacion:1});
  assert.equal(p.items.length,1);assert.equal(p.items[0].retirosServicios[0].accion,null);assert.equal(e.cliente.mutaciones.length,0);
 });
test('reserva movida de CAB, fecha y mes conserva continuidad sin declarar baja',async()=>{
 const e=entorno({reservas:false}),vieja={...e.r,rut_documento:'FICTICIO-PASAPORTE',fecha_checkin:'2026-10-31',fecha_checkout:'2026-11-02',noches:2},nueva={...vieja,id:'Nov26!G4',hoja:'Nov26',cabana:2,
  fecha_checkin:'2026-11-01',fecha_checkout:'2026-11-02',noches:1,geometria_inequivoca:true,fechas_ocupadas:['2026-11-01'],coordenadas_origen:{hoja:'Nov26',celda:'G4'}};
 e.hojas.set('Nov26',{...e.data,hoja:'Nov26',reservas:[nueva],fechas:['2026-11-01','2026-11-02'],
  espacios:[{cabana:2,fecha:'2026-11-02',estado:'libre_explicito',origen:{hoja:'Nov26',celda:'K4'}}]});
 const [p]=await e.C.actualizarDesdeLibro([{id:'alta',tipo:'nueva',actual:vieja,anterior:null}],e.libro);
 assert.equal(p.fuente_vigente.estado,'verificada');assert.equal(p.actual.cabana,2);assert.equal(p.actual.hoja,'Nov26');
 assert.equal(p.fuente_vigente.calendario.siguiente_libre.celda,'K4');
});
test('desaparecida antes de incorporarse retira el alta; después conserva revisión y enlace',async()=>{
 const e=entorno({reservas:false}),[r]=await e.C.actualizarDesdeLibro([{id:'alta',tipo:'nueva',actual:e.r,anterior:null}],e.libro);
 assert.equal(r.tipo,'retiro');assert.equal(r.fuente_vigente.estado,'ausencia_verificada');
 e.cliente.db.reserva_estadias=[];
 const sin=await e.Q.revalidarCambiosDetectados([r],e.cliente,{generacion:1});assert.equal(sin.items.length,0);assert.equal(sin.resueltosDetalle[0].motivo,'propuesta_retirada');
 const con=entorno({reservas:false}),p=await con.Q.revalidarCambiosDetectados([r],con.cliente,{generacion:1});
 assert.equal(p.items.length,1);assert.equal(p.items[0].sistema.reserva_id,'reserva-ficticia-1');assert.match(p.items[0].proyecto,/Ya no aparece/);
 con.cliente.db.reserva_estadias[0].reservas.observaciones='Comentario creado en Proyecto H';
 assert.match((await con.Q.revalidarCambiosDetectados([r],con.cliente,{generacion:1})).items[0].proyecto,/no tiene evidencia de origen Libro/);
});
for(const modo of ['incompleta','ambigua','falta_hoja'])test(modo+': no se concluye retiro ni se borra el pendiente',async()=>{
 const e=entorno({reservas:false});if(modo==='incompleta')e.data.cobertura.geometria=false;
 if(modo==='ambigua')e.data.anotaciones=[{tipo:'reserva_por_identificar',cabana:1,fecha:'2026-10-03',origen:{celda:'C3'}}];
 if(modo==='falta_hoja')e.hojas.delete('Oct26');
 const [r]=await e.C.actualizarDesdeLibro([{id:'alta',tipo:'nueva',actual:e.r,anterior:null}],e.libro);assert.notEqual(r.tipo,'retiro');assert.notEqual(r.fuente_vigente.estado,'ausencia_verificada');
});
test('una nota sin interpretar y una cabaña sin cobertura no se presentan como celdas vacías',async()=>{
 for(const modo of ['nota','sin_cabana']){
  const e=entorno({reservas:false});e.data.espacios=[];
  if(modo==='nota')e.data.anotaciones=[{texto_original:'Contenido sin interpretar',cabana:1,fecha:e.r.fecha_checkin,origen:F.origen()}];
  const [r]=await e.C.actualizarDesdeLibro([{id:'p',tipo:'nueva',actual:e.r,anterior:null}],e.libro);
  assert.notEqual(r.fuente_vigente.estado,'ausencia_verificada');assert.notEqual(r.tipo,'retiro');
  assert.match(r.fuente_vigente.motivo,/interpretarse|cobertura/);
 }
});
test('celda ilegible se distingue de vacía y una hoja faltante no demuestra baja',()=>{
 const e=entorno(),old={...e.data,reservas:[e.r]},actual={...e.data,reservas:[],anotaciones:[{tipo:'reserva_por_identificar',cabana:1,fecha:e.r.fecha_checkin,origen:F.origen()}]};
 const d=D.comparar([old],[actual]);assert.equal(d.ya_no_aparecen.length,0);assert.match(d.ambiguas[0].motivo,/no pudo interpretar/);
 assert.equal(D.comparar([old],[]).ya_no_aparecen.length,0);
});
test('antes de actuar revalida permiso, versión, identidad y estado; no ejecuta RPC',async()=>{
 const e=entorno({servicios:[guardado()],actuales:[servicio('19:00')]}),c=(await e.comparar()).cambiosLibro.find(x=>x.campo==='servicios');
 const opciones={cliente:e.cliente,libro:e.libro,permiso:()=>true,finanzas:async()=>({aplicaciones:[],ajustes:[],estados:[]})};
 assert.equal((await e.Q.comprobarCambioServicioLibro(c,opciones)).caso.sistema.id,c.sistema.id);
 await assert.rejects(e.Q.comprobarCambioServicioLibro(c,{...opciones,permiso:()=>false}),/permiso/);
 await assert.rejects(e.Q.comprobarCambioServicioLibro(c,{...opciones,finanzas:async()=>({aplicaciones:[{monto_aplicado:1000}],ajustes:[],estados:[]})}),/revisión manual/);
 await assert.rejects(e.Q.comprobarCambioServicioLibro(c,{...opciones,finanzas:async()=>{e.cambiar();return {aplicaciones:[],ajustes:[],estados:[]};}}),/otra versión/);
 e.r.servicios=[];e.cambiar();await assert.rejects(e.Q.comprobarCambioServicioLibro(c,opciones),/cambiaron/);
 assert.equal(e.cliente.mutaciones.length,0);
});
module.exports={entorno,guardado,servicio,bloque};

test('actualizar sólo adultos en el historial no vacía ni reemplaza el bloque de notas',async()=>{
 const e=entorno({notas:'Manual intacto.\n'+bloque('Información importada vigente')});e.r.adultos=3;
 const p=await e.Q.revalidarCambiosDetectados([registro(e,2,3,'adultos')],e.cliente,{generacion:1});
 assert.equal(p.items[0].accionable,true);
 const plan=e.Q.crearPlanIncorporacion(p.reservas,p.comparacion),payload=plan.items.find(i=>i.payload?.tipo==='reserva_actualizar').payload;
 assert.equal(payload.estadia.despues.adultos,3);assert.equal(Object.hasOwn(payload.reserva.despues,'observaciones'),false);
});
test('la comparación sólo de pagos no convierte notas omitidas en retiros',async()=>{
 const e=entorno(),comp=await e.Q.compararSistema([e.r],e.cliente,{desde:e.r.fecha_checkin,hasta:e.r.fecha_checkout,solo_pagos:true,incluirFinanzas:false});
 const plan=e.Q.crearPlanIncorporacion([e.r],comp);
 assert.equal(plan.items.some(x=>Object.hasOwn(x.payload?.reserva?.despues||{},'observaciones')),false);
 assert.equal(comp.cambiosLibro.some(x=>x.campo==='notas_importantes'),false);
});

test('la fecha explícita del servicio prevalece sobre el día de ingreso en todas las vistas',async()=>{
 const texto='TINAJA TONEL 04/10/2026 18:00 CORTESIA',srv=S.servicios(texto,{origen_campo:'notas_reserva'})[0];
 const e=entorno({servicios:[guardado({fecha_servicio:'2026-10-04',observaciones:'Importado desde Libro de Reserva. '+texto+' [HAKU-LIBRO-SERVICIO:srv:fecha]'})],actuales:[srv]});
 assert.equal(S.referenciaServicioLibro(srv,e.r).fecha,'2026-10-04');assert.equal((await e.comparar()).cambiosLibro.filter(x=>x.campo==='servicios').length,0);
 const dos={...srv,texto_original:'TINAJA TONEL 04/10/2026 O 05/10/2026 18:00 CORTESIA'};
 e.r.servicios=[dos];const c=(await e.comparar()).cambiosLibro.find(x=>x.campo==='servicios');assert.equal(c.tipo,'revision');assert.equal(c.accion,null);
});
test('late check-out compara la hora final y propone revisar el mismo servicio, sin desplazar su inicio',async()=>{
 const late=hora=>S.servicios('LATE CHECK OUT '+hora,{origen_campo:'notas_reserva'})[0];
 const e=entorno({servicios:[guardado({catalogo_servicios:{codigo:'lateCheckout',nombre:'Late Check-out'},fecha_servicio:'2026-10-04',hora_inicio:'12:00',hora_fin:'14:00',
  observaciones:'Importado desde Libro de Reserva. LATE CHECK OUT 14:00 [HAKU-LIBRO-SERVICIO:srv:late]'})],actuales:[late('14:00')]});
 assert.equal((await e.comparar()).cambiosLibro.filter(x=>x.campo==='servicios').length,0);
 e.r.servicios=[late('15:00')];const c=(await e.comparar()).cambiosLibro.find(x=>x.campo==='servicios');
 assert.equal(c.sistema.id,'servicio-ficticio-1');assert.equal(c.despues.hora,'15:00');assert.equal(c.accion,null);assert.match(c.motivo,/mismo servicio/);
});
test('un servicio trasladado de día propone actualizar su UUID; otra cita legítima se conserva',async()=>{
 const e=entorno({servicios:[guardado()],actuales:[servicio('19:00',{fecha:'2026-10-04'})]});e.r.noches=2;e.r.fecha_checkout='2026-10-05';
 e.cliente.db.reserva_estadias[0].fecha_salida=e.r.fecha_checkout;
 let c=(await e.comparar()).cambiosLibro.find(x=>x.campo==='servicios');assert.equal(c.accion,'reprogramar_servicio');assert.equal(c.despues.fecha,'2026-10-04');
 e.cliente.db.servicios.push(guardado({id:'otra-cita',fecha_servicio:'2026-10-04',hora_inicio:'19:00'}));
 c=(await e.comparar()).cambiosLibro.find(x=>x.campo==='servicios');assert.equal(c.sistema.id,'servicio-ficticio-1');assert.equal(c.accion,'revisar_cancelacion_servicio');
 assert.equal(e.cliente.db.servicios[1].id,'otra-cita');
});

test('comentario manual incierto conserva también sus separadores',()=>{
 const e=entorno(),manual='Comentario manual // mantener esta separación';
 const notas=e.Q.unirObservacionesLibro(bloque('Ingreso 18:00')+'\n[DATOS DEL LIBRO]\nIngreso 18:00\n'+manual,['Ingreso 19:00']);
 assert.match(notas,/Comentario manual \/\/ mantener esta separación/);assert.doesNotMatch(notas,/18:00/);
});
test('late check-out con variantes de separadores y sufijo horario se conserva una sola vez',()=>{
 const e=entorno(),notas=e.Q.unirObservacionesLibro('',[
  'Late check-out 14:00','LATE CHECK OUT 14:00 HRS','Late checkout 14:00 hs']);
 assert.equal(e.Q.separarObservacionesLibro(notas).bloques[0].split('\n').length,1);
});
test('antes de incorporar una propuesta movida busca continuidad y no envía los datos antiguos',async()=>{
 const e=entorno();Object.assign(e.r,{rut_documento:'PASAPORTE-FICTICIO',fecha_checkin:'2026-10-31',fecha_checkout:'2026-11-02',noches:2,fechas_ocupadas:['2026-10-31','2026-11-01']});e.cliente.db.reserva_estadias=[];
 const consulta=await e.Q.consultar(F.consulta,e.libro,e.cliente),nueva={...F.copy(e.r),id:'Nov26!G4',hoja:'Nov26',cabana:2,
  fecha_checkin:'2026-11-01',fecha_checkout:'2026-11-02',noches:1,fechas_ocupadas:['2026-11-01'],coordenadas_origen:{hoja:'Nov26',celda:'G4'}};
 e.data.reservas=[];e.hojas.set('Nov26',{...F.copy(e.data),hoja:'Nov26',reservas:[nueva],fechas:['2026-11-01','2026-11-02']});e.cambiar();
 const plan=await e.Q.prepararIncorporacion(consulta,new Map(),new Set(),e.cliente),conflicto=plan.items.find(x=>x.cambioFuente)?.cambioFuente;
 assert.equal(conflicto.actual.hoja,'Nov26');assert.match(conflicto.motivo,/continúa en otra ubicación/);
 assert.equal(e.Q.serializarIncorporacion(plan).length,0);assert.equal(e.cliente.mutaciones.length,0);
});
test('otra visita histórica del mismo huésped no sustituye una reserva desaparecida',async()=>{
 const e=entorno({reservas:false}),r={...e.r,rut_documento:'PASAPORTE-FICTICIO'},otra={...F.copy(r),id:'Sep26!G4',hoja:'Sep26',
  fecha_checkin:'2026-09-01',fecha_checkout:'2026-09-02',coordenadas_origen:{hoja:'Sep26',celda:'G4'}};
 e.hojas.set('Sep26',{...F.copy(e.data),hoja:'Sep26',reservas:[otra],fechas:['2026-09-01','2026-09-02']});
 const [caso]=await e.C.actualizarDesdeLibro([{id:'p1',tipo:'nueva',actual:r,anterior:null}],e.libro);
 assert.equal(caso.fuente_vigente.estado,'ambigua');assert.equal(caso.actual.id,r.id);assert.match(caso.fuente_vigente.motivo,/no acredita la misma estadía/);
});

test('varias CAB de una reserva consolidan las notas actuales y retiran sólo lo que dejó de estar vigente',async()=>{
 const e=entorno({notas:'Comentario manual.\n'+bloque('Ingreso 18:00\nCuna vigente')});e.r.notas_importantes=['Ingreso 19:00'];
 const b={...F.copy(e.r),id:'Oct26!C4',cabana:2,notas_importantes:['Cuna vigente'],coordenadas_origen:F.origen('C4')};
 e.cliente.db.reserva_estadias.push(F.estadia(b,{id:'otra-estadia',reserva_id:'reserva-ficticia-1',reservas:F.copy(e.cliente.db.reserva_estadias[0].reservas)}));
 const comp=await e.Q.compararSistema([e.r,b],e.cliente,{desde:e.r.fecha_checkin,hasta:e.r.fecha_checkout,incluirFinanzas:false});
 const items=e.Q.crearPlanIncorporacion([e.r,b],comp).items.filter(x=>x.payload?.tipo==='reserva_actualizar');
 assert.equal(items.length,1);const notas=items[0].payload.reserva.despues.observaciones;
 assert.doesNotMatch(notas,/18:00/);assert.match(notas,/19:00/);assert.match(notas,/Cuna vigente/);assert.match(notas,/Comentario manual\./);
 assert.equal((notas.match(/\[DATOS DEL LIBRO\]/g)||[]).length,1);
});
test('estadías con fechas diferentes conservan sus fragmentos al consolidar una reserva compartida',async()=>{
 const e=entorno({notas:bloque('Primera nota antigua\nSegunda nota vigente')});e.r.notas_importantes=['Primera nota nueva'];
 const b={...F.copy(e.r),id:'Oct26!K3',fecha_checkin:'2026-10-06',fecha_checkout:'2026-10-07',fechas_ocupadas:['2026-10-06'],
  notas_importantes:['Segunda nota vigente'],coordenadas_origen:F.origen('K3')};
 e.cliente.db.reserva_estadias.push(F.estadia(b,{id:'segunda-estadia',reserva_id:'reserva-ficticia-1',reservas:F.copy(e.cliente.db.reserva_estadias[0].reservas)}));
 const comp=await e.Q.compararSistema([e.r,b],e.cliente,{desde:'2026-10-01',hasta:'2026-10-31',incluirFinanzas:false});
 const plan=e.Q.crearPlanIncorporacion([e.r,b],comp),notas=plan.items.find(x=>x.payload?.reserva?.despues?.observaciones).payload.reserva.despues.observaciones;
 assert.match(notas,/Primera nota nueva/);assert.match(notas,/Segunda nota vigente/);assert.doesNotMatch(notas,/Primera nota antigua/);
 assert.equal(plan.items.filter(x=>x.payload?.reserva?.despues?.observaciones).length,1);
});
test('alcance parcial conserva notas de la otra estadía y mantiene la revisión después de agregar las nuevas',async()=>{
 const e=entorno({notas:bloque('Otra estadía vigente\nNota antigua')});e.r.notas_importantes=['Nota nueva'];
 const b={...F.copy(e.r),cabana:2};e.cliente.db.reserva_estadias.push(F.estadia(b,{id:'no-leida',reserva_id:'reserva-ficticia-1',reservas:F.copy(e.cliente.db.reserva_estadias[0].reservas)}));
 let comp=await e.comparar(),plan=e.Q.crearPlanIncorporacion([e.r],comp);
 const notas=plan.items.find(x=>x.payload?.reserva?.despues?.observaciones).payload.reserva.despues.observaciones;
 assert.match(notas,/Otra estadía vigente/);assert.match(notas,/Nota antigua/);assert.match(notas,/Nota nueva/);
 for(const s of e.cliente.db.reserva_estadias)s.reservas.observaciones=notas;
 comp=await e.comparar();assert.equal(comp.cambiosLibro.find(x=>x.campo==='notas_importantes').tipo,'revision');
 assert.match(comp.cambiosLibro.find(x=>x.campo==='notas_importantes').motivo,/Faltan otras estadías/);
});
test('una lectura sin campos de notas o servicios no equivale a campos vacíos',async()=>{
 const e=entorno({servicios:[guardado()]});delete e.r.servicios;
 const c=(await e.comparar()).cambiosLibro.find(x=>x.campo==='servicios');assert.equal(c.tipo,'revision');assert.equal(c.accion,null);
 const s=(await e.comparar())[0].sistema;
 const r={...e.r,texto_original:undefined,notas_importantes:undefined,pagos_pendientes:undefined};
 assert.equal(Object.hasOwn(e.Q.actualizacionReservaLibro(r,s).reserva.despues,'observaciones'),false);
});
test('desaparecida antes del alta se muestra también en la comparación mensual con la copia anterior',async()=>{
 const R=require('./fixtures/libro-retiros-sinteticos.cjs'),e=entorno({reservas:false}),previa={...F.copy(e.data),reservas:[e.r]};
 e.cliente.db.reserva_estadias=[];const libro=R.libro(e.data,previa,[{id:'alta-previa',tipo:'nueva',actual:e.r,anterior:null}]);
 const resultado=await e.Q.consultar(F.consulta,libro,e.cliente);
 assert.ok(resultado.comparacion.cambiosLibro.some(x=>x.campo==='reserva'&&/alta.*no está vigente/.test(x.motivo)));
 assert.equal(resultado.comparacion.cambiosLibro.filter(x=>x.campo==='reserva').length,1,'el aviso persistido y el delta de versiones representan un solo caso');
 assert.equal(e.Q.serializarIncorporacion(e.Q.crearPlanIncorporacion(resultado.reservas,resultado.comparacion)).length,0);
});

for(const caso of ['retiro','traslado','lectura incompleta'])test('comparación mensual con un Libro grande: '+caso,async()=>{
 const e=entorno({reservas:false});
 if(caso==='traslado'){
  Object.assign(e.r,{rut_documento:'FICTICIO-PASAPORTE',tipo_documento:'pasaporte',
    fecha_checkin:'2026-10-31',fecha_checkout:'2026-11-02',noches:2});
  const estadia=e.cliente.db.reserva_estadias[0];
  Object.assign(estadia,{fecha_ingreso:e.r.fecha_checkin,fecha_salida:e.r.fecha_checkout});
  Object.assign(estadia.reservas,{titular_numero_documento:e.r.rut_documento,titular_tipo_documento:e.r.tipo_documento});
 }
 const anterior={...e.data,reservas:[e.r]};
 const nombres=['Sep26','Oct26','Nov26',...Array.from({length:36},(_,i)=>
    ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][i%12]+(27+Math.floor(i/12)))];
 const operativas=['Sep26','Oct26','Nov26'],lecturas=[],lotes=[],huellas=[];
 const destinos=new Map(operativas.map(hoja=>[hoja,{...F.copy(e.data),hoja,reservas:[],fechas:[],espacios:[]}]));
 destinos.set('Oct26',e.data);
 if(caso==='traslado')destinos.get('Nov26').reservas=[{...e.r,id:'Nov26!D4',hoja:'Nov26',cabana:2,
   fecha_checkin:'2026-11-01',noches:1}];
 if(caso==='lectura incompleta')destinos.get('Nov26').cobertura.geometria=false;
 const obtener=(h,version)=>F.copy(version==='anterior'&&h==='Oct26'?anterior:destinos.get(h));
 const libro={listo:async()=>{},estado:e.libro.estado,listarHojas:()=>nombres,
   consultarIndice:async()=>({nombres}),
   consultarHoja:async(h,version)=>{lecturas.push(h);return obtener(h,version);},
   consultarHojas:async(hs,version)=>{lotes.push(...hs);return hs.map(h=>obtener(h,version));},
   consultarHuellas:async(version,hs)=>{
     huellas.push(...hs);
     return {version_huella:2,nombres:hs,huellas:Object.fromEntries(hs.map(h=>[h,{sha256:h==='Oct26'?version:h}]))};
   }};
 const resultado=await e.Q.consultar(F.consulta,libro,e.cliente);
 assert.deepEqual([...new Set([...lecturas,...lotes,...huellas])].sort(),[...operativas].sort());
 assert.ok(lotes.includes('Nov26'),'la continuidad usa el lector por lotes');
 const cambio=resultado.comparacion.cambiosLibro.find(x=>x.campo==='reserva');
 assert.equal(cambio.tipo,caso==='retiro'?'retirado':'revision');
 if(caso==='traslado')assert.match(cambio.motivo,/otra ubicación|Nov26 · CAB 2/);
 if(caso==='lectura incompleta')assert.match(cambio.motivo,/lectura segura/);
 assert.equal(e.cliente.mutaciones.length,0);
});

test('cancelar el servicio no cierra su texto antiguo mientras siga en el bloque importado',async()=>{
 const viejo=servicio(),e=entorno({notas:'Comentario manual.\n'+bloque(viejo.texto_original),servicios:[guardado({estado_servicio:'cancelado'})]});
 const reg=registro(e,[viejo],[],'servicios');
 const p=await e.Q.revalidarCambiosDetectados([reg],e.cliente,{generacion:1});
 assert.equal(p.resueltos.length,0);assert.equal(p.items[0].accionable,true);
 assert.equal(p.items[0].cambios[0].campo,'observaciones_libro');
 const notas=e.Q.crearPlanIncorporacion(p.reservas,p.comparacion).items.find(i=>i.payload?.reserva?.despues?.observaciones).payload.reserva.despues.observaciones;
 assert.equal(notas,'Comentario manual.\n\n'+bloque(''));
 e.cliente.db.reserva_estadias[0].reservas.observaciones=notas;
 const fin=await e.Q.revalidarCambiosDetectados([reg],e.cliente,{generacion:1});assert.equal(fin.items.length,0);
});

test('reprogramar el servicio deja pendiente reemplazar la hora vieja de su glosa importada',async()=>{
 const viejo=servicio(),nuevo=servicio('19:00'),e=entorno({notas:bloque(viejo.texto_original+'\n'+nuevo.texto_original),
  servicios:[guardado({hora_inicio:'19:00',hora_fin:'20:00'})],actuales:[nuevo]});
 vm.runInContext(fs.readFileSync('js/haiku-libro-servicios-scope-v2.js','utf8'),e.c);
 e.cliente.db.catalogo_servicios=[{id:'catalogo-tonel',codigo:'tinajaTonel',nombre:'Tinaja Tonel',activo:true,precio_base:30000,permite_cortesia:true}];
 const p=await e.Q.revalidarCambiosDetectados([registro(e,[viejo],[nuevo],'servicios')],e.cliente,{generacion:1});
 assert.equal(p.items.length,1);assert.equal(p.items[0].accionable,true,JSON.stringify(p.items[0].cambios));
 const notas=e.Q.crearPlanIncorporacion(p.reservas,p.comparacion).items.find(i=>i.payload?.reserva?.despues?.observaciones).payload.reserva.despues.observaciones;
 assert.equal(notas,bloque(nuevo.texto_original));
});

test('el retiro histórico no borra una indicación todavía vigente en otra CAB de la misma reserva',async()=>{
 const e=entorno({notas:bloque('Cuna vigente')});
 const b={...F.copy(e.r),id:'Oct26!C4',cabana:2,adultos:3,notas_importantes:['Cuna vigente'],coordenadas_origen:F.origen('C4')};
 e.cliente.db.reserva_estadias.push(F.estadia(b,{id:'otra-estadia',reserva_id:'reserva-ficticia-1',adultos:2,reservas:F.copy(e.cliente.db.reserva_estadias[0].reservas)}));
 const reg=registro(e,['Cuna vigente'],[]),otro={...registro(e,2,3,'adultos'),id:'otra-cab',anterior:{...b,adultos:2},actual:b};
 const p=await e.Q.revalidarCambiosDetectados([reg,otro],e.cliente,{generacion:1});
 assert.ok(p.resueltos.includes(reg.id));
 for(const item of e.Q.crearPlanIncorporacion(p.reservas,p.comparacion).items){
  if(item.payload?.reserva?.despues?.observaciones)assert.match(item.payload.reserva.despues.observaciones,/Cuna vigente/);
 }
});

test('el historial focal descubre otra estadía fuera del mes y no retira sus fragmentos sin fuente',async()=>{
 const e=entorno({notas:bloque('Indicación compartida')});
 const b={...F.copy(e.r),fecha_checkin:'2026-12-03',fecha_checkout:'2026-12-04'};
 e.cliente.db.reserva_estadias.push(F.estadia(b,{id:'otra-fecha',reserva_id:'reserva-ficticia-1',reservas:F.copy(e.cliente.db.reserva_estadias[0].reservas)}));
 const p=await e.Q.revalidarCambiosDetectados([registro(e,['Indicación compartida'],[])],e.cliente,{generacion:1});
 assert.equal(p.items.length,1);assert.equal(p.items[0].accionable,false);assert.match(p.items[0].cambios[0].proyecto,/Faltan otras estadías/);
 assert.equal(e.Q.serializarIncorporacion(e.Q.crearPlanIncorporacion(p.reservas,p.comparacion)).length,0);
});

test('una nota sin color ni cambio tipado entra al historial y conserva la fuente al revalidar',async()=>{
 const e=entorno({notas:'Manual intacto.\n'+bloque('Comentario anterior')}),anterior={...e.r,texto_original:'Comentario anterior'};
 e.r.texto_original='Comentario corregido';
 const diff=D.comparar([{...F.copy(e.data),reservas:[anterior]}],[e.data]);
 assert.equal(diff.modificadas.length,1);assert.equal(diff.modificadas[0].cambios[0].campo,'observaciones_libro');
 const [actualizado]=await e.C.actualizarDesdeLibro([{id:'texto-sin-color',tipo:'modificacion',...diff.modificadas[0]}],e.libro);
 assert.deepEqual(F.copy(actualizado.cambios[0].ahora),['Comentario corregido']);
 const p=await e.Q.revalidarCambiosDetectados([actualizado],e.cliente,{generacion:1});assert.equal(p.items[0].accionable,true);
 const notas=e.Q.crearPlanIncorporacion(p.reservas,p.comparacion).items.find(x=>x.payload?.reserva?.despues?.observaciones).payload.reserva.despues.observaciones;
 assert.equal(notas,'Manual intacto.\n\n'+bloque('Comentario corregido'));
});

test('un marcador abierto usa el Libro anterior para retirar jacuzzi 18:30, conservar el manual y un solo late',async()=>{
 const viejo='JACUZZI 18:30',nuevo='JACUZZI 15:30',late='Late check-out 14:00',manual='Comentario manual intacto.';
 const e=entorno({notas:'[DATOS DEL LIBRO]\n'+viejo+'\n'+late+'\n'+late+'\n'+manual});
 e.r.notas_importantes=[nuevo,late];
 const reg=registro(e,[viejo,late],[nuevo,late]);
 const p=await e.Q.revalidarCambiosDetectados([reg],e.cliente,{generacion:1});
 assert.equal(p.items[0].accionable,true);assert.ok(p.items[0].vistaIncorporacion.notas.retiradas.includes(viejo));
 const notas=e.Q.crearPlanIncorporacion(p.reservas,p.comparacion).items.find(x=>x.payload?.reserva?.despues?.observaciones).payload.reserva.despues.observaciones;
 assert.doesNotMatch(notas,/18:30/);assert.equal((notas.match(/15:30/g)||[]).length,1);
 assert.equal((notas.match(/Late check-out 14:00/g)||[]).length,1);assert.match(notas,/Comentario manual intacto\./);
 assert.equal(e.Q.separarObservacionesLibro(notas).malformado,false);
 e.cliente.db.reserva_estadias[0].reservas.observaciones=notas;
 assert.equal((await e.Q.revalidarCambiosDetectados([reg],e.cliente,{generacion:1})).items.length,0);
});

test('marcador abierto sin respaldo del horario antiguo conserva revisión explícita, no una corrección aplicada',async()=>{
 const A=require('../js/supabase-asistente-libro-actualizacion-v1.js'),e=entorno({notas:'[DATOS DEL LIBRO]\nJACUZZI 18:30\nComentario manual.'});
 e.r.notas_importantes=['JACUZZI 15:30','Late check-out 14:00'];
 const reg=registro(e,['JACUZZI 18:30'],e.r.notas_importantes);reg.anterior=null;
 const p=await e.Q.revalidarCambiosDetectados([reg],e.cliente,{generacion:1});
 assert.equal(p.items[0].accionable,false);assert.match(p.items[0].cambios[0].proyecto,/origen.*incierto/);
 assert.equal(e.Q.serializarIncorporacion(e.Q.crearPlanIncorporacion(p.reservas,p.comparacion)).length,0);
 const html=A.renderizarPendientes(p);assert.match(html,/incierto/);assert.doesNotMatch(html,/YA COMPROBADA|ya coinciden/);
 assert.match(e.cliente.db.reserva_estadias[0].reservas.observaciones,/18:30/);
});

for(const incorporada of [false,true])test('flujo normal: reserva reaparecida '+(incorporada?'existente conserva estado e historial':'deja una sola alta vigente'),async()=>{
 const A=require('../js/supabase-asistente-libro-actualizacion-v1.js'),e=entorno();
 e.r.notas_importantes=['Dato vigente'];if(!incorporada)e.cliente.db.reserva_estadias=[];
 else{e.cliente.db.reserva_estadias[0].estado_estadia='checked_out';e.cliente.db.eventos_auditoria=[{id:'historia-intacta'}];}
 const snapshot=F.copy(e.cliente.db),retiro={id:'retiro-obsoleto',tipo:'retiro',anterior:{...F.copy(e.r),notas_importantes:['Dato anterior']},actual:null,cambios:[]};
 let historial={version:1,cambios:[retiro]};
 const cache=A.crearCachePendientes({generacion:()=>1,leer:async()=>F.copy(historial),guardar:async v=>{historial=F.copy(v);},
  contexto:{actualizarDesdeLibro:rs=>e.C.actualizarDesdeLibro(rs,e.libro),enriquecer:async rs=>rs},
  revalidarCambios:(rs,o)=>e.Q.revalidarCambiosDetectados(rs,e.cliente,o)});
 const informe={estado:'sin_cambios',libro_actual:{generacion:1},nuevas:[],modificadas:[],ya_no_aparecen:[]};
 let p=await cache.obtener(informe,{revalidar:true});
 assert.ok(p.resueltos.includes(retiro.id));assert.equal(historial.cambios.some(x=>x.tipo==='retiro'),false);
 if(incorporada){assert.equal(p.items.length,0);assert.equal(historial.cambios.length,0);}
 else{
  assert.equal(p.items.length,1);assert.equal(p.items[0].tipo,'nueva');assert.equal(p.items[0].accionable,true);
  assert.deepEqual(F.copy(p.items[0].actual.notas_importantes),['Dato vigente']);
  assert.equal(historial.cambios.length,1);assert.equal(p.registrosAviso.length,1);
  p=await cache.obtener(informe,{revalidar:true});assert.equal(p.items.length,1);assert.equal(historial.cambios.length,1);
 }
 assert.deepEqual(e.cliente.db,snapshot);assert.equal(e.cliente.mutaciones.length,0);
});

test('reaparecer con un alta vigente ya detectada no genera una segunda propuesta',async()=>{
 const e=entorno();e.cliente.db.reserva_estadias=[];
 const retiro={id:'retiro',tipo:'retiro',anterior:e.r,actual:null,cambios:[]},nueva={id:'alta-vigente',tipo:'nueva',actual:e.r,anterior:null,cambios:[]};
 const vigentes=await e.C.actualizarDesdeLibro([retiro,nueva],e.libro);
 const p=await e.Q.revalidarCambiosDetectados(vigentes,e.cliente,{generacion:1});
 assert.deepEqual(F.copy(p.resueltos),['retiro']);assert.equal(p.items.length,1);assert.equal(p.items[0].id,'alta-vigente');assert.equal(p.reemplazos.length,0);
});

test('servicio importado ilegible conserva su ID y se clasifica como Servicios · Requiere revisión',async()=>{
 const e=entorno({servicios:[guardado({observaciones:'Importado desde Libro de Reserva. TEXTO ANTIGUO ILEGIBLE [HAKU-LIBRO-SERVICIO:srv:ilegible]'})]});
 const comp=await e.comparar(),c=comp.cambiosLibro.find(x=>x.sistema?.id==='servicio-ficticio-1');
 assert.equal(c.id,'servicio:servicio-ficticio-1');assert.equal(c.campo,'servicios');assert.equal(c.tipo,'revision');assert.equal(c.accion,null);
 assert.match(c.motivo,/no pudo interpretarse/);assert.equal(c.sistema.id,'servicio-ficticio-1');
});

for(const respaldo of [true,false])test('comparación y preparación normales de nota abierta '+(respaldo?'usan la versión anterior':'conservan revisión sin respaldo'),async()=>{
 const R=require('./fixtures/libro-retiros-sinteticos.cjs'),f=R.regresiones().find(x=>x.caso===(respaldo?'notas-respaldo':'notas-inciertas'));
 const e=entorno(),libro=R.libro(f.data,f.previa),cliente=F.cliente(f.db);e.c.HAIKU_LIBRO_RESERVA_V1=libro;
 const resultado=await e.Q.consultar(F.consulta,libro,cliente),cambio=resultado.comparacion.cambiosLibro.find(x=>x.campo==='notas_importantes');
 const plan=await e.Q.prepararIncorporacion(resultado,new Map(),new Set(),cliente),parche=plan.items.find(x=>x.payload?.reserva?.despues?.observaciones);
 if(respaldo){
  assert.ok(cambio.retirados.includes('JACUZZI 18:30'));assert.ok(parche);
  const notas=parche.payload.reserva.despues.observaciones;
  assert.doesNotMatch(notas,/18:30/);assert.equal((notas.match(/15:30/g)||[]).length,1);assert.equal((notas.match(/Late check-out 14:00/g)||[]).length,1);
  assert.match(notas,/Comentario manual intacto/);
 }else{
  assert.equal(cambio.tipo,'revision');assert.match(cambio.motivo,/no está aplicada/);assert.equal(parche,undefined);
  assert.ok(plan.items.some(x=>x.categoria==='pendientes'&&x.motivos.some(m=>/origen.*incierto/.test(m))));
 }
 assert.equal(cliente.mutaciones.length,0);
});

test('un retiro sin fuente vigente inequívoca no se cierra como reserva reaparecida',async()=>{
 const e=entorno({reservas:false}),r={id:'retiro',tipo:'retiro',anterior:e.r,actual:null,cambios:[],fuente_vigente:{estado:'ambigua'}};
 const p=await e.Q.revalidarCambiosDetectados([r],e.cliente,{generacion:1});
 assert.equal(p.items[0].tipo,'retiro');assert.equal(p.resueltos.length,0);assert.equal(p.reemplazos.length,0);
});

test('la copia anterior de otra estadía no acredita el retiro de una nota bajo un marcador abierto',async()=>{
 const e=entorno({notas:'[DATOS DEL LIBRO]\nJACUZZI 18:30\nComentario manual.'});e.r.notas_importantes=['JACUZZI 15:30'];
 const reg=registro(e,['JACUZZI 18:30'],e.r.notas_importantes);
 reg.anterior.fecha_checkin='2026-09-01';reg.anterior.fecha_checkout='2026-09-02';
 const p=await e.Q.revalidarCambiosDetectados([reg],e.cliente,{generacion:1});
 assert.equal(p.items[0].accionable,false);assert.match(p.items[0].cambios[0].proyecto,/origen.*incierto/);
 assert.equal(p.reservas.length,0);assert.equal(e.cliente.mutaciones.length,0);
});

test('Revisar cambios conserva Dejar dos batas una vez en la vista previa y en la única alta serializada',async()=>{
 const A=require('../js/supabase-asistente-libro-actualizacion-v1.js'),e=entorno();e.cliente.db.reserva_estadias=[];
 e.r.texto_original='Dejar dos batas';e.r.notas_importantes=['Dejar dos batas'];
 let historial={version:1,cambios:[{id:'retiro-batas',tipo:'retiro',anterior:{...F.copy(e.r),texto_original:'Nota antigua',notas_importantes:['Nota antigua']},actual:null,cambios:[]}]};
 const cache=A.crearCachePendientes({generacion:()=>1,leer:async()=>F.copy(historial),guardar:async x=>{historial=F.copy(x);},
  contexto:{actualizarDesdeLibro:rs=>e.C.actualizarDesdeLibro(rs,e.libro),enriquecer:async rs=>rs},
  revalidarCambios:(rs,o)=>e.Q.revalidarCambiosDetectados(rs,e.cliente,o)});
 const informe={estado:'sin_cambios',libro_actual:{generacion:1},nuevas:[],modificadas:[],ya_no_aparecen:[]};
 const p=await cache.obtener(informe,{revalidar:true});
 assert.equal(p.items.length,1);assert.equal(p.items[0].tipo,'nueva');
 assert.equal(p.items[0].vistaIncorporacion.notas.añadidas.filter(x=>x==='Dejar dos batas').length,1);
 const plan=await e.Q.prepararIncorporacion(p.preparacion,new Map(),new Set(),e.cliente);
 const operaciones=e.Q.serializarIncorporacion(plan),altas=operaciones.filter(x=>x.tipo==='reserva_nueva');
 assert.equal(altas.length,1);assert.equal((altas[0].reserva.observaciones.match(/Dejar dos batas/g)||[]).length,1);
 assert.doesNotMatch(altas[0].reserva.observaciones,/Nota antigua/);
 const otra=await cache.obtener(informe,{revalidar:true});assert.equal(otra.items.length,1);assert.equal(historial.cambios.length,1);
 assert.equal(e.cliente.mutaciones.length,0);
});
