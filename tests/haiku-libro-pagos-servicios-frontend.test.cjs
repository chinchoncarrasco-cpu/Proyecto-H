const test=require('node:test');
const assert=require('node:assert/strict');

global.HAIKU_LIBRO_SEMANTICA=require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_PAGOS_DESTINOS_V1=require('../js/haiku-libro-pagos-destinos-v1.js');
delete require.cache[require.resolve('../js/haiku-libro-consultas-v1.js')];
const Q=require('../js/haiku-libro-consultas-v1.js');

const q={desde:'2026-09-01',hasta:'2026-09-30'};
const CAP={version:1,contrato:'aplicaciones_servicio_v1',rpc:'haiku_incorporar_pago_servicios_libro_v1',efectivo_sin_identificador:false};
const pago=extra=>({tipo_movimiento:'servicio',concepto:'tinaja',monto:30000,moneda:'CLP',medio_pago:'debito',
 codigo_autorizacion:'622979',fecha_comprobante:'2026-09-12',fecha_bloque:'2026-09-12',pago_recibido:true,
 estado_pago:'registrado_en_libro',texto_original:'Carlos // 622979 // Tinaja $30.000',origen:{hoja:'Sep26',celda:'K20'},...extra});
const reserva=p=>({id:'libro-1',titular:'Carlos Marquez',rut_documento:'11111111-1',cabana:1,
 fecha_checkin:'2026-09-12',fecha_checkout:'2026-09-13',tipo_estadia:'alojamiento',noches:1,adultos:2,ninos:0,mascotas:0,
 pagos:[p],pagos_sin_asociacion:[],servicios:[],advertencias:[],coordenadas_origen:{hoja:'Sep26',celda:'C20'}});
const estadia=(r,id='e1')=>({id,reserva_id:'r1',fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,
 estado_estadia:'confirmada',tipo_estadia:'alojamiento',adultos:2,ninos:0,mascotas:0,cabanas:{numero:r.cabana},
 reservas:{id:'r1',titular_nombre:r.titular,titular_numero_documento:r.rut_documento,estado_reserva:'confirmada'}});
const servicio=(id='s1',nombre='Tinaja Tonel',fecha='2026-09-12',total=30000)=>({id,reserva_id:'r1',fecha_servicio:fecha,total,
 tipo_cobro:'normal',estado_servicio:'programado',catalogo_servicios:{codigo:nombre,nombre,categoria:'servicio'}});
const cargo=(id='c1',servicioId='s1',concepto='Tinaja Tonel',saldo=30000,extra={})=>({cargo_id:id,reserva_id:'r1',servicio_id:servicioId,
 tipo_cargo:'servicio',concepto,monto:saldo,monto_ajustado:saldo,aplicado_neto:0,saldo_cargo:saldo,estado:'activo',estado_pago:'pendiente',...extra});

function cliente(tablas,opciones={}){
 const calls=[];
 return {calls,auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(tabla){
  calls.push({tipo:'from',tabla});const b={select(){return b},in(){return b},eq(){return b},lte(){return b},gte(){return b},order(){return b},
   async range(a,z){return {data:structuredClone((tablas[tabla]||[]).slice(a,z+1)),error:null}}};return b;
 },async rpc(nombre,args){
  calls.push({tipo:'rpc',nombre,args});
  if(nombre==='haiku_libro_aplicaciones_servicio_capacidad_v1'){
   if(opciones.capacidad instanceof Error) throw opciones.capacidad;
   if(opciones.capacidad?.error) return {error:opciones.capacidad.error};
   return {data:opciones.capacidad||null,error:null};
  }
  if(nombre==='haiku_incorporar_pago_servicios_libro_v1'){
   if(typeof opciones.writerHandler==='function'){
    const indice=calls.filter(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1').length-1;
    return opciones.writerHandler({args,indice});
   }
   if(opciones.writerError) return {error:{message:opciones.writerError}};
   return {data:{ok:true,pagos_creados:1,omitidos:0,pago_id:'p-nuevo'},error:null};
  }
  if(nombre==='haiku_incorporar_libro_v1') return {data:{ok:true,pagos_creados:1,omitidos:0},error:null};
  throw new Error('RPC inesperada: '+nombre);
 }};
}

function tablasCarlos(r,extra={}){
 return {reserva_estadias:[estadia(r)],pagos:[],servicios:[servicio()],vista_estado_cargos:[cargo()],pago_aplicaciones:[],...extra};
}

async function prepararCarlos(capacidad=CAP,aprobados=new Set(),extra={}){
 const p=extra.pago||pago(),r=extra.reserva||reserva(p),db=cliente(extra.tablas||tablasCarlos(r),{capacidad,writerError:extra.writerError});
 const result={reservas:[r],q};
 const plan=await Q.prepararIncorporacion(result,new Map(),aprobados,db);
 return {p,r,db,result,plan,item:plan.items.find(x=>x.pagoLibro===p)};
}

test('capability ausente, con error o versión incorrecta falla cerrado',async()=>{
 for(const capacidad of [{error:{message:'RPC no desplegada'}},new Error('schema cache'),{...CAP,version:2},{version:1}]){
  const {item,db}=await prepararCarlos(capacidad);
  assert.equal(item.aprobableFinancieramente,true);
  assert.equal(item.aprobable,false);
  assert.equal(item.seleccionado,false);
  assert.match(item.motivos.join(' '),/escritura protegida.+no está disponible/i);
  assert.equal(db.calls.some(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
  assert.equal(db.calls.some(c=>c.nombre==='haiku_registrar_pago'),false);
 }
});

test('capability ausente nunca deja un payload de fallback al writer histórico',async()=>{
 const x=await prepararCarlos({error:{message:'RPC no desplegada'}});
 assert.equal(x.item.payload.contrato,'aplicaciones_servicio_v1');
 x.item.categoria='pagos';x.item.motivos=[];x.item.seleccionado=true;
 assert.equal(Q.serializarIncorporacion(x.plan)[0].tipo,'pago_servicios_4c');
 await assert.rejects(Q.confirmarIncorporacion(x.result,new Map(),new Set(),x.plan,x.db),/escritura protegida/i);
 assert.equal(x.db.calls.some(c=>c.nombre==='haiku_incorporar_libro_v1'),false);
 assert.equal(x.db.calls.some(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
});

test('capability exacta habilita aprobación de Carlos y serializa el contrato 4C',async()=>{
 const inicial=await prepararCarlos();
 assert.equal(inicial.item.aprobableFinancieramente,true);
 assert.equal(inicial.item.backendServiciosDisponible,true);
 assert.equal(inicial.item.aprobable,true);
 assert.equal(inicial.item.categoria,'dudosos');
 const aprobado=await prepararCarlos(CAP,new Set([inicial.item.id]));
 assert.equal(aprobado.item.categoria,'pagos');assert.equal(aprobado.item.seleccionado,true);
 const [out]=Q.serializarIncorporacion(aprobado.plan);
 assert.equal(out.tipo,'pago_servicios_4c');assert.equal(out.reserva_id,'r1');assert.equal(out.aprobado_manualmente,true);
 assert.equal(out.argumentos.p_monto,30000);assert.equal(out.argumentos.p_modo_aplicacion,'ninguno');
 assert.equal(out.argumentos.p_bove,null,'un BOVE administrativo nunca se copia al canal BOVTAR');
 assert.deepEqual(out.datos_origen.aplicaciones_servicio_v1,{version:1,reserva_id:'r1',monto_total:30000,moneda:'CLP',aplicaciones:[{
  cargo_id:'c1',servicio_id:'s1',concepto_canon:'tinaja',monto:30000,saldo_esperado:30000,aplicado_esperado:0,
  cantidad_aplicaciones_esperada:0,fecha_contexto:'2026-09-12',fecha_servicio_esperada:'2026-09-12'
 }]});
});

test('una transacción de 50000 produce un pago con dos aplicaciones explícitas',async()=>{
 const p=pago({monto:50000,concepto:'servicios',transaccion_distribuida:true,aplicaciones_libro:[
  {concepto:'Late Out',monto:20000,fecha_bloque:'2026-09-12'},
  {concepto:'Jacuzzi',monto:30000,fecha_bloque:'2026-09-12'}
 ]});
 const r=reserva(p),tablas=tablasCarlos(r,{servicios:[servicio('s1','Late Checkout','2026-09-12',20000),servicio('s2','Jacuzzi','2026-09-12',30000)],
  vista_estado_cargos:[cargo('c1','s1','Late Checkout',20000),cargo('c2','s2','Jacuzzi',30000)]});
 const inicial=await prepararCarlos(CAP,new Set(),{pago:p,reserva:r,tablas});
 assert.equal(inicial.item.aprobable,true);
 const aprobado=await prepararCarlos(CAP,new Set([inicial.item.id]),{pago:p,reserva:r,tablas});
 const [out]=Q.serializarIncorporacion(aprobado.plan),apps=out.datos_origen.aplicaciones_servicio_v1.aplicaciones;
 assert.equal(out.tipo,'pago_servicios_4c');assert.equal(apps.length,2);
 assert.equal(apps.reduce((n,a)=>n+a.monto,0),50000);
 assert.deepEqual(apps.map(a=>[a.cargo_id,a.monto]),[['c1',20000],['c2',30000]]);
});

test('Sara: un pago fuerte de 95000 prepara una distribución única de dos masajes',async()=>{
 const p=pago({monto:95000,concepto:'masajes',codigo_autorizacion:'002506',folio:'000232',
  fecha_comprobante:'2026-09-02',fecha_bloque:'2026-09-01',texto_original:'Sara Bertrand // Débito // Folio 000232 // Aut. 002506 // masajes'});
 const r=reserva(p);r.titular='Sara Bertrand';r.fecha_checkin='2026-09-01';r.fecha_checkout='2026-09-02';
 r.servicios=[{concepto:'tinaja',texto_original:'Tinaja mencionada',pendiente:true}];
 const tablas=tablasCarlos(r,{servicios:[
  servicio('s1','Masaje Descontracturante 60 min','2026-09-01',50000),
  servicio('s2','Masaje Terapéutico 60 min','2026-09-01',45000)
 ],vista_estado_cargos:[
  cargo('c1','s1','Masaje Descontracturante 60 min',50000),
  cargo('c2','s2','Masaje Terapéutico 60 min',45000)
 ]});
 const inicial=await prepararCarlos(CAP,new Set(),{pago:p,reserva:r,tablas});
 assert.equal(inicial.item.aprobableFinancieramente,true);
 assert.equal(inicial.item.aprobable,true);
 assert.equal(inicial.item.motivos.length,1,'sólo conserva la aprobación manual normal del flujo de servicios');
 const aprobado=await prepararCarlos(CAP,new Set([inicial.item.id]),{pago:p,reserva:r,tablas});
 assert.equal(aprobado.item.categoria,'pagos');assert.equal(aprobado.item.seleccionado,true);
 const serializados=Q.serializarIncorporacion(aprobado.plan),pagosServicio=serializados.filter(item=>item.tipo==='pago_servicios_4c');
 assert.equal(pagosServicio.length,1);
 const [out]=pagosServicio,apps=out.datos_origen.aplicaciones_servicio_v1.aplicaciones;
 assert.equal(out.tipo,'pago_servicios_4c');assert.equal(out.argumentos.p_monto,95000);
 assert.equal(apps.length,2);assert.equal(apps.reduce((suma,item)=>suma+item.monto,0),95000);
 assert.deepEqual(apps.map(item=>[item.cargo_id,item.monto]),[['c1',50000],['c2',45000]]);
 const comp=await Q.compararSistema([r],cliente(tablas,{capacidad:CAP}),q);
 assert.equal(comp.serviciosDetalle.find(item=>item.servicio.concepto==='tinaja').estado,'revisar');
});

test('el pago fuerte de Sara ya existente se omite antes de distribuir cargos',async()=>{
 const p=pago({monto:95000,concepto:'masajes',codigo_autorizacion:'002506',folio:'000232',fecha_comprobante:'2026-09-02',fecha_bloque:'2026-09-01'});
 const r=reserva(p);r.fecha_checkin='2026-09-01';r.fecha_checkout='2026-09-02';
 const existente={id:'p-sara',reserva_id:'r1',monto:95000,moneda:'CLP',estado:'confirmado',codigo_autorizacion:'002506',medio_pago:'tarjeta_debito',fecha_pago:'2026-09-02'};
 const tablas=tablasCarlos(r,{pagos:[existente],servicios:[servicio('s1','Masaje Descontracturante 60 min','2026-09-01',50000),servicio('s2','Masaje Terapéutico 60 min','2026-09-01',45000)],
  vista_estado_cargos:[cargo('c1','s1','Masaje Descontracturante 60 min',50000),cargo('c2','s2','Masaje Terapéutico 60 min',45000)]});
 const db=cliente(tablas,{capacidad:CAP}),plan=await Q.prepararIncorporacion({reservas:[r],q},new Map(),new Set(),db);
 const item=plan.items.find(x=>x.pagoLibro===p);
 assert.equal(item.categoria,'omitidos');assert.notEqual(item.aprobable,true);
 assert.equal(Q.serializarIncorporacion(plan).length,0);
 assert.equal(db.calls.some(call=>call.nombre==='haiku_libro_aplicaciones_servicio_capacidad_v1'),false);
});

test('dos movimientos Libro con el identificador fuerte de Sara quedan en revisión',async()=>{
 const primero=pago({monto:95000,concepto:'masajes',codigo_autorizacion:'002506',folio:'000232',fecha_comprobante:'2026-09-02',fecha_bloque:'2026-09-01'});
 const segundo=pago({monto:50000,concepto:'masajes',codigo_autorizacion:'002506',folio:'000232',fecha_comprobante:'2026-09-02',fecha_bloque:'2026-09-01'});
 const r=reserva(primero);r.fecha_checkin='2026-09-01';r.fecha_checkout='2026-09-02';r.pagos=[primero,segundo];
 const tablas=tablasCarlos(r,{servicios:[servicio('s1','Masaje Descontracturante 60 min','2026-09-01',50000),servicio('s2','Masaje Terapéutico 60 min','2026-09-01',45000)],
  vista_estado_cargos:[cargo('c1','s1','Masaje Descontracturante 60 min',50000),cargo('c2','s2','Masaje Terapéutico 60 min',45000)]});
 const db=cliente(tablas,{capacidad:CAP}),plan=await Q.prepararIncorporacion({reservas:[r],q},new Map(),new Set(),db);
 const items=plan.items.filter(item=>item.pagoLibro===primero||item.pagoLibro===segundo);
 assert.equal(items.length,2);assert.ok(items.every(item=>item.categoria==='dudosos'&&item.aprobable===false));
 assert.equal(Q.serializarIncorporacion(plan).length,0);
});

test('suma distinta, destinos ausentes, ya aplicados, reserva ambigua y nota financiera nunca se habilitan',async()=>{
 const casos=[];
 const distribuido=pago({monto:50000,transaccion_distribuida:true,aplicaciones_libro:[{concepto:'Tinaja',monto:30000}]});
 casos.push({nombre:'suma distinta',p:distribuido,tablas:null});
 casos.push({nombre:'Constanza/Hernán sin destino',p:pago(),tablas:{servicios:[],vista_estado_cargos:[]}});
 casos.push({nombre:'Yenny/Pascual ya aplicado',p:pago(),tablas:{servicios:[servicio()],vista_estado_cargos:[cargo('c1','s1','Tinaja Tonel',0,{monto:30000,monto_ajustado:30000,aplicado_neto:30000,estado_pago:'pagado'})]}});
 casos.push({nombre:'nota financiera',p:pago({clasificacion_financiera:'nota_financiera'}),tablas:null});
 for(const caso of casos){
  const r=reserva(caso.p),tablas=tablasCarlos(r,caso.tablas||{}),x=await prepararCarlos(CAP,new Set(),{pago:caso.p,reserva:r,tablas});
  assert.notEqual(x.item?.aprobable,true,caso.nombre);assert.equal(Q.serializarIncorporacion(x.plan).some(i=>i.tipo==='pago_servicios_4c'),false,caso.nombre);
 }
 const p=pago(),r=reserva(p),tablas=tablasCarlos(r,{reserva_estadias:[estadia(r,'e1'),{...estadia(r,'e2'),reserva_id:'r2',reservas:{...estadia(r).reservas,id:'r2'}}]});
 const ambiguo=await prepararCarlos(CAP,new Set(),{pago:p,reserva:r,tablas});
 assert.notEqual(ambiguo.item?.aprobable,true);assert.equal(Q.serializarIncorporacion(ambiguo.plan).length,0);
});

test('pago confirmado existente se omite antes de capability y del writer 4C',async()=>{
 const p=pago(),r=reserva(p),existente={id:'p1',reserva_id:'r1',monto:30000,moneda:'CLP',estado:'confirmado',codigo_autorizacion:'622979',medio_pago:'tarjeta_debito',fecha_pago:'2026-09-12'};
 const db=cliente(tablasCarlos(r,{pagos:[existente]}),{capacidad:CAP});
 const plan=await Q.prepararIncorporacion({reservas:[r],q},new Map(),new Set(),db);
 const item=plan.items.find(i=>i.pagoLibro===p);
 assert.equal(item.categoria,'omitidos');assert.notEqual(item.aprobable,true);
 assert.equal(db.calls.some(c=>c.nombre==='haiku_libro_aplicaciones_servicio_capacidad_v1'),false);
});

test('confirma varios pagos protegidos en un lote y reanuda sin duplicar tras un corte de red',async()=>{
 const primero=pago({concepto:'Tinaja',monto:30000,codigo_autorizacion:'622979',texto_original:'Carlos // 622979 // Tinaja $30.000'});
 const segundo=pago({concepto:'Late Checkout',monto:20000,codigo_autorizacion:'622980',texto_original:'Carlos // 622980 // Late Checkout $20.000'});
 const r=reserva(primero);r.pagos=[primero,segundo];
 const tablas=tablasCarlos(r,{servicios:[servicio('s1','Tinaja Tonel','2026-09-12',30000),servicio('s2','Late Checkout','2026-09-12',20000)],
  vista_estado_cargos:[cargo('c1','s1','Tinaja Tonel',30000),cargo('c2','s2','Late Checkout',20000)]});
 let intentoWriter=0;
 const db=cliente(tablas,{capacidad:CAP,writerHandler:({indice})=>{
  intentoWriter++;
  if(intentoWriter===2) throw new Error('Failed to fetch');
  return {data:{ok:true,pagos_creados:1,omitidos:0,pago_id:`p-${indice}`},error:null};
 }});
 const result={reservas:[r],q};
 const inicial=await Q.prepararIncorporacion(result,new Map(),new Set(),db);
 const revisables=inicial.items.filter(item=>item.pagoLibro===primero||item.pagoLibro===segundo);
 assert.equal(revisables.length,2);assert.ok(revisables.every(item=>item.aprobable===true));
 const aprobados=new Set(revisables.map(item=>item.id));
 const plan=await Q.prepararIncorporacion(result,new Map(),aprobados,db);
 assert.equal(Q.serializarIncorporacion(plan).filter(item=>item.tipo==='pago_servicios_4c').length,2);

 await assert.rejects(Q.confirmarIncorporacion(result,new Map(),aprobados,plan,db),/Failed to fetch/);
 assert.equal(plan.solicitudPendiente.servicios.length,2);
 assert.ok(plan.solicitudPendiente.servicios[0].resultado);
 assert.equal(plan.solicitudPendiente.servicios[1].resultado,null);
 const llamadasTrasFallo=db.calls.filter(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1');
 assert.equal(llamadasTrasFallo.length,2);
 const operacionPrimerPago=llamadasTrasFallo[0].args.p_operacion_id;
 const operacionSegundoPago=llamadasTrasFallo[1].args.p_operacion_id;

 const confirmado=await Q.confirmarIncorporacion(result,new Map(),aprobados,plan,db);
 const llamadasFinales=db.calls.filter(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1');
 assert.equal(llamadasFinales.length,3,'el primer pago confirmado no vuelve a enviarse');
 assert.equal(llamadasFinales.filter(c=>c.args.p_operacion_id===operacionPrimerPago).length,1);
 assert.equal(llamadasFinales[2].args.p_operacion_id,operacionSegundoPago,'el pago pendiente reusa su operación idempotente');
 assert.equal(confirmado.resultado.pagos_creados,2);
});

test('conflicto de RPC 4C no usa fallback ni reintento ciego y exige comparar de nuevo',async()=>{
 const inicial=await prepararCarlos(),aprobados=new Set([inicial.item.id]);
 const listo=await prepararCarlos(CAP,aprobados,{writerError:'El destino dejó de ser único; vuelve a preparar'});
 await assert.rejects(Q.confirmarIncorporacion(listo.result,new Map(),aprobados,listo.plan,listo.db),error=>error.haikuConflictoDatos===true);
 assert.equal(listo.db.calls.filter(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1').length,1);
 assert.equal(listo.db.calls.filter(c=>c.nombre==='haiku_incorporar_libro_v1').length,0);
 assert.equal(listo.db.calls.filter(c=>c.nombre==='haiku_registrar_pago').length,0);
 assert.equal(listo.plan.solicitudPendiente,null);
});
