const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('./fixtures/libro-pagos-revision.cjs');
const fila=p=>p.items.find(i=>i.pagoLibro?.origen?.celda==='AZ31:BC31');
const preparar=x=>x.Q.prepararIncorporacion(x.result,new Map(),new Set(),x.cliente);
const contexto=(caso=R.caso(),cap={...R.capacidad,aplicar_pago_existente_v1:true})=>{
 const x=R.contexto(caso,cap),src=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
 const base='Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
 vm.runInContext(src.replace(base,base.replace(' })',', resolverAprobacionManualPago })')),x.c);x.Q=x.c.HAIKU_LIBRO_CONSULTAS;return x;
};
test('ofrece aplicar sobre el pago original; prepara no escribe ni selecciona un pago nuevo',async()=>{
 const x=contexto(),p=await preparar(x),i=fila(p),a=i.aplicacionExistente;
 assert.equal(i.categoria,'omitidos');assert.equal(i.seleccionado,false);assert.equal(i.payload,null);
 assert.equal(a.pago_id,R.ids.pago);assert.equal(a.estadia_id,R.ids.estadia);assert.equal(a.disponible_esperado,144000);
 assert.equal(a.pago_esperado.datos_origen.origen_libro.hoja,'Oct26');assert.equal(a.cargos.length,1);assert.equal(a.cargos[0].saldo_cargo_esperado,158400);
 assert.deepEqual(x.cliente.mutaciones,[]);
});
test('dos destinos quedan disponibles sin elegir automáticamente uno',async()=>{
 const caso=R.caso();caso.db.vista_estado_cargos.push({...caso.db.vista_estado_cargos[0],cargo_id:'77777777-7777-4777-8777-777777777777'});
 const i=fila(await preparar(contexto(caso)));assert.equal(i.aplicacionExistente.cargos.length,2);assert.equal(i.aplicacionExistente.cargo_id,undefined);
});
test('sin capacidad o permiso no ofrece aplicación',async()=>{
 assert.equal(fila(await preparar(contexto(R.caso(),R.capacidad))).aplicacionExistente,null);
 const x=contexto();x.c.haikuTienePermiso=()=>false;assert.equal(fila(await preparar(x)).aplicacionExistente,null);
});
test('lectura parcial de aplicaciones no presupone que el pago esté disponible',async()=>{
 const x=contexto(),from=x.cliente.from;
 x.cliente.from=t=>{if(t==='pago_aplicaciones')throw Error('Cobertura incompleta');return from(t);};
 assert.equal(fila(await preparar(x)).aplicacionExistente,null);
});
test('aplicaciones a cualquier cargo y devoluciones se descuentan del disponible',async()=>{
 const caso=R.caso();caso.db.pago_aplicaciones.push({id:'app',pago_id:R.ids.pago,cargo_id:'cargo-otro',monto_aplicado:40000});
 caso.db.pagos.push({...caso.db.pagos[0],id:'refund',tipo_movimiento:'devolucion',monto:10000,pago_origen_id:R.ids.pago,
  codigo_autorizacion:null,folio:'devolucion-ficticia',datos_origen:{}});
 caso.db.pago_aplicaciones.push({id:'dev',pago_id:'refund',cargo_id:'cargo-otro',monto_aplicado:5000});
 const a=fila(await preparar(contexto(caso))).aplicacionExistente;
 assert.equal(a.aplicado_pago_esperado,35000);assert.equal(a.devuelto_esperado,10000);assert.equal(a.disponible_esperado,99000);
});
test('pago completamente aplicado o alojamiento de otra estadía no ofrece acción',async()=>{
 const caso=R.caso();caso.db.pago_aplicaciones.push({id:'app',pago_id:R.ids.pago,cargo_id:R.ids.alojamiento,monto_aplicado:144000});
 assert.equal(fila(await preparar(contexto(caso))).aplicacionExistente,null);
 const otro=R.caso();otro.db.vista_estado_cargos[0].estadia_id='77777777-7777-4777-8777-777777777777';
 assert.equal(fila(await preparar(contexto(otro))).aplicacionExistente,null);
});
test('revalida saldo y fuente antes de invocar el escritor',async()=>{
 const x=contexto(),d=new Map(),a=new Set(),p=await x.Q.prepararIncorporacion(x.result,d,a,x.cliente),i=fila(p);
 x.cliente.db.vista_estado_cargos[0].saldo_cargo=100000;
 const accion={tipo:'aplicar_pago_existente_v1',cargoId:R.ids.alojamiento,confirmado:true};
 await assert.rejects(()=>x.Q.resolverAprobacionManualPago(x.result,d,a,p,i.id,accion,x.cliente),/saldo cambi/);
 assert.deepEqual(x.cliente.mutaciones,[]);
});
test('Libro reemplazado o permiso revocado invalida la confirmación',async()=>{
 for(const cambio of ['libro','permiso']){
  const x=contexto(),d=new Map(),a=new Set(),p=await x.Q.prepararIncorporacion(x.result,d,a,x.cliente),i=fila(p);
  if(cambio==='permiso')x.c.haikuTienePermiso=()=>false;
  else x.c.HAIKU_LIBRO_RESERVA_V1.estado=()=>({cargado:true,generacion:2,version:'a'.repeat(64)});
  await assert.rejects(()=>x.Q.resolverAprobacionManualPago(x.result,d,a,p,i.id,
   {tipo:'aplicar_pago_existente_v1',cargoId:R.ids.alojamiento,confirmado:true},x.cliente),/cambi|actualiz|versi/i);
  assert.deepEqual(x.cliente.mutaciones,[]);
 }
});
test('respuesta perdida reintenta el mismo UUID sin crear un pago nuevo',async()=>{
 const x=contexto(),d=new Map(),a=new Set(),p=await x.Q.prepararIncorporacion(x.result,d,a,x.cliente),i=fila(p);
 const read=x.cliente.rpc,ops=new Map(),calls=[];let escrituras=0;
 x.cliente.rpc=async(n,args)=>{
  if(n!=='haiku_libro_aplicar_pago_existente_v1')return read(n,args);calls.push(args);
  if(ops.has(args.p_operacion_id))return{data:ops.get(args.p_operacion_id)};
  escrituras++;x.cliente.db.pago_aplicaciones.push({id:'app',pago_id:R.ids.pago,cargo_id:R.ids.alojamiento,monto_aplicado:144000});
  x.cliente.db.vista_estado_cargos[0].saldo_cargo=14400;x.cliente.db.vista_estado_cargos[0].aplicado_neto=144000;
  ops.set(args.p_operacion_id,{ok:true,pago_id:R.ids.pago,cargo_id:R.ids.alojamiento,aplicado_total_cargo:144000,sin_aplicar:0,saldo_cargo:14400});throw Error('Respuesta perdida');
 };
 const accion={tipo:'aplicar_pago_existente_v1',cargoId:R.ids.alojamiento,confirmado:true};
 await assert.rejects(()=>x.Q.resolverAprobacionManualPago(x.result,d,a,p,i.id,accion,x.cliente),/Respuesta perdida/);
 const despues=await x.Q.resolverAprobacionManualPago(x.result,d,a,p,i.id,accion,x.cliente);
 assert.equal(escrituras,1);assert.equal(calls.length,2);assert.equal(calls[0].p_operacion_id,calls[1].p_operacion_id);
 assert.equal(despues.resultadoAplicacionExistente.ok,true);assert.equal(fila(despues).aplicacionExistente,null);assert.equal(x.cliente.db.pagos.length,1);
});
test('guardado confirmado con relectura fallida muestra confirmación y bloquea la vista vieja',async()=>{
 const x=contexto(),d=new Map(),a=new Set(),p=await x.Q.prepararIncorporacion(x.result,d,a,x.cliente),i=fila(p),read=x.cliente.rpc;
 x.cliente.rpc=async(n,args)=>{if(n!=='haiku_libro_aplicar_pago_existente_v1')return read(n,args);
  x.cliente.from=()=>{throw Error('No hay conexión para releer');};
  return{data:{ok:true,pago_id:R.ids.pago,cargo_id:R.ids.alojamiento,aplicado_total_cargo:144000,sin_aplicar:0,saldo_cargo:14400}};
 };
 const despues=await x.Q.resolverAprobacionManualPago(x.result,d,a,p,i.id,{tipo:'aplicar_pago_existente_v1',cargoId:R.ids.alojamiento,confirmado:true},x.cliente);
 assert.equal(despues.resultadoAplicacionExistente.lecturaPendiente,true);assert.equal(despues.escrituraHabilitada,false);
 assert.ok(despues.items.every(i=>!i.seleccionado&&!i.aplicacionExistente));assert.match(i.aviso,/confirmada en el servidor.*Falta releer/);
});
