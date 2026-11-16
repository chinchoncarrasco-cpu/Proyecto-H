const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('./fixtures/libro-pagos-revision.cjs');
const D=require('../js/haiku-libro-pagos-destinos-v1.js');
const F=require('./fixtures/libro-comparacion-readonly.cjs');
const fila=(plan,n)=>plan.items.find(i=>i.pagoLibro?.origen?.celda===`AZ${n}:BC${n}`&&!i.id.endsWith(':comprobante'));
async function preparar(ctx,aprobados=new Set()){return ctx.Q.prepararIncorporacion(ctx.result,new Map(),aprobados,ctx.cliente);}

test('cinco filas: pago histórico sin aplicar, tarifa alojamiento, ajuste distinto, tinaja excedente y masaje sin cargo',async()=>{
 const x=R.contexto(),p=await preparar(x);
 assert.equal(fila(p,31).categoria,'omitidos');assert.match(fila(p,31).aviso,/aplicado \$0.*sin aplicar \$144.000/);
 assert.match(fila(p,31).aviso,/Oct26!CI36:CL36.*2026-10-22/);
 assert.equal(fila(p,32).pagoLibro.tipo_movimiento,'alojamiento');
 assert.match(fila(p,32).aviso,/Diferencia de tarifa.*alojamiento/);assert.doesNotMatch(fila(p,32).motivos.join(' '),/pago de servicio/);
 assert.equal(fila(p,32).aprobable,true);assert.equal(fila(p,32).seleccionado,false);
 assert.match(fila(p,32).aviso,/no acredita un número de operación/);
 assert.equal(fila(p,33).categoria,'dudosos');assert.match(fila(p,33).motivos.join(' '),/monto: Libro \$16.000.*Proyecto H \$14.400/);
 const recibo=p.items.find(i=>i.id===fila(p,33).id+':comprobante');assert.equal(recibo.aprobable,true);assert.equal(recibo.payload,null);
 assert.equal(fila(p,34).aprobable,true);assert.equal(fila(p,34).precioServicioManual.cargo_id,R.ids.jacuzzi);
 assert.match(fila(p,34).aviso,/Tinaja Jacuzzi.*32.500.*30.000.*2.500/);
 assert.equal(fila(p,35).manualPago.tipo,'crear_servicio_faltante');assert.match(fila(p,35).motivos.join(' '),/Falta un cargo compatible/);
 assert.deepEqual(x.cliente.mutaciones,[]);
});
test('aprobar tarjeta no modifica ajuste; conserva íntegros 32.500 y destina sólo 30.000',async()=>{
 const x=R.contexto(),aprobados=new Set(),p=await preparar(x,aprobados);
 const tarjeta=p.items.find(i=>i.id.endsWith(':comprobante'));aprobados.add(tarjeta.id);aprobados.add(fila(p,34).id);
 const listo=await preparar(x,aprobados),items=x.Q.serializarIncorporacion(listo);
 const tinaja=items.find(i=>i.argumentos?.p_monto===32500),penalidad=items.find(i=>i.argumentos?.p_monto===16000);
 assert.ok(tinaja);assert.equal(tinaja.tipo,'pago_servicios_4c');assert.equal(tinaja.argumentos.p_monto,32500);
 const d=tinaja.datos_origen.aplicaciones_servicio_v1;
 assert.equal(d.aplicaciones.length,1);assert.equal(d.aplicaciones[0].cargo_id,R.ids.jacuzzi);assert.equal(d.aplicaciones[0].monto,30000);
 assert.equal(d.monto_sin_aplicar,2500);assert.equal(tinaja.datos_origen.excedente_servicio_libro_v1.confirmado,true);
 assert.ok(penalidad);assert.equal(penalidad.tipo,'pago_servicios_4c');
 assert.equal(penalidad.datos_origen.destino_alojamiento_libro_v1.cargo_id,R.ids.alojamiento);
 assert.equal(fila(listo,33).categoria,'dudosos');assert.equal(x.cliente.db.cargo_ajustes.length,1);
 assert.deepEqual(x.cliente.mutaciones,[]);
});
test('cambio de saldo entre vista previa y confirmación invalida aprobación del excedente',async()=>{
 const x=R.contexto(),a=new Set(),p=await preparar(x,a);const id=fila(p,34).id;a.add(id);
 x.cliente.db.vista_estado_cargos[1].saldo_cargo=29000;x.cliente.db.vista_estado_cargos[1].aplicado_neto=1000;
 const actualizado=await preparar(x,a),i=fila(actualizado,34);
 assert.equal(a.has(id),false);assert.equal(i.categoria,'dudosos');assert.equal(i.seleccionado,false);assert.equal(i.decisionManualInvalidada,true);
});
test('confirmación completa relee saldo y rechaza antes de invocar un escritor',async()=>{
 const x=R.contexto(),a=new Set(),p=await preparar(x,a);a.add(fila(p,34).id);
 const listo=await preparar(x,a);assert.equal(fila(listo,34).seleccionado,true);
 x.cliente.db.vista_estado_cargos[1].saldo_cargo=29000;x.cliente.db.vista_estado_cargos[1].aplicado_neto=1000;
 await assert.rejects(()=>x.Q.confirmarIncorporacion(x.result,new Map(),a,listo,x.cliente),/cambi|revis/i);
 assert.deepEqual(x.cliente.mutaciones,[]);
});
test('precio confirmado con respuesta perdida reutiliza operación y conserva un solo ajuste',async()=>{
 const x=R.contexto(),src=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
 const base='Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
 vm.runInContext(src.replace(base,base.replace(' })',', resolverAprobacionManualPago })')),x.c);x.Q=x.c.HAIKU_LIBRO_CONSULTAS;
 const a=new Set(),d=new Map(),p=await x.Q.prepararIncorporacion(x.result,d,a,x.cliente),i=fila(p,34);
 const lectura=x.cliente.rpc,ops=new Map(),calls=[];let ajustes=0;
 x.cliente.rpc=async(nombre,args)=>{
  if(nombre!=='haiku_libro_ajustar_precio_cargo_v1')return lectura(nombre,args);
  calls.push(args);if(ops.has(args.p_operacion_id))return{data:ops.get(args.p_operacion_id)};
  ajustes++;x.cliente.db.vista_estado_cargos[1].monto_ajustado=32500;x.cliente.db.vista_estado_cargos[1].saldo_cargo=32500;
  ops.set(args.p_operacion_id,{ok:true,cargo_id:R.ids.jacuzzi,ajuste:2500,precio_final:32500});throw Error('Failed to fetch');
 };
 const accion={tipo:'precio_cargo_libro_v1',confirmado:true,motivo:'Precio final acordado en ejemplo',autorizacion:'Autorización ficticia independiente acta 777'};
 await assert.rejects(()=>x.Q.resolverAprobacionManualPago(x.result,d,a,p,i.id,accion,x.cliente),/Failed to fetch/);
 const siguiente=await x.Q.resolverAprobacionManualPago(x.result,d,a,p,i.id,accion,x.cliente);
 assert.equal(ajustes,1);assert.equal(calls.length,2);assert.equal(calls[0].p_operacion_id,calls[1].p_operacion_id);
 assert.equal(siguiente.resultadoPrecioCargo.ok,true);assert.equal(fila(siguiente,34).payload.argumentos.p_monto,32500);
});
test('backend anterior conserva revisión y no ofrece aplicación parcial ni ajuste de precio',async()=>{
 const x=R.contexto(R.caso(),{...R.capacidad,excedente_servicio_libro_v1:false,precio_cargo_libro_v1:false,destino_alojamiento_libro_v1:false});
 const p=await preparar(x);assert.equal(fila(p,34).aprobable,false);assert.equal(fila(p,34).precioServicioManual,undefined);
 assert.equal(p.items.find(i=>i.id.endsWith(':comprobante')).aprobable,false);
 assert.equal(fila(p,32).aprobable,false);
});
test('tarifa sola exige cargo único y la confirmación rechaza saldo modificado',async()=>{
 const caso=R.caso();caso.r.pagos=[caso.r.pagos[1]];caso.data.pagos=caso.r.pagos;
 const x=R.contexto(caso),a=new Set(),p=await preparar(x,a);assert.equal(fila(p,32).aprobable,true);a.add(fila(p,32).id);
 const listo=await preparar(x,a),i=fila(listo,32);assert.equal(i.payload.contrato,'aplicaciones_servicio_v1');
 assert.equal(i.payload.datos_origen.destino_alojamiento_libro_v1.cargo_id,R.ids.alojamiento);
 x.cliente.db.vista_estado_cargos[0].saldo_cargo-=1000;x.cliente.db.vista_estado_cargos[0].aplicado_neto+=1000;
 await assert.rejects(()=>x.Q.confirmarIncorporacion(x.result,new Map(),a,listo,x.cliente),/cambi/i);
 const ambiguo=R.caso();ambiguo.db.vista_estado_cargos.push({...ambiguo.db.vista_estado_cargos[0],cargo_id:'alojamiento-otro'});
 const y=R.contexto(ambiguo),review=await preparar(y);assert.equal(fila(review,32).aprobable,false);
});
test('pago ya confirmado muestra aplicaciones anteriores y nunca propone duplicarlo',async()=>{
 const caso=R.caso();caso.db.pagos.push(F.pagoH({id:'pago-tinaja-ficticio',reserva_id:R.ids.reserva,monto:32500,tipo_movimiento:'pago',
  medio_pago:'tarjeta_debito',folio:'880034',codigo_autorizacion:null,bove:'990034',datos_origen:{bovtar:'990034'},fecha_pago:'2026-11-14'}));
 caso.db.pago_aplicaciones.push({id:'app-ficticia',pago_id:'pago-tinaja-ficticio',cargo_id:R.ids.jacuzzi,monto_aplicado:30000});
 caso.db.vista_estado_cargos[1].saldo_cargo=0;caso.db.vista_estado_cargos[1].aplicado_neto=30000;
 const x=R.contexto(caso),p=await preparar(x);assert.equal(fila(p,34).categoria,'omitidos');
 assert.match(fila(p,34).aviso,/aplicado \$30.000.*sin aplicar \$2.500/);assert.equal(fila(p,34).payload,null);
});
test('pago de penalidad ya registrado conserva la revisión independiente del ajuste distinto',async()=>{
 const caso=R.caso();caso.db.pagos.push(F.pagoH({id:'penalidad-ficticia',reserva_id:R.ids.reserva,monto:16000,tipo_movimiento:'pago',
  medio_pago:'tarjeta_credito',folio:'880033',codigo_autorizacion:null,bove:'990033',datos_origen:{bovtar:'990033'},fecha_pago:'2026-10-22'}));
 caso.db.pago_aplicaciones.push({id:'app-ficticia',pago_id:'penalidad-ficticia',cargo_id:R.ids.alojamiento,monto_aplicado:16000});
 const x=R.contexto(caso),p=await preparar(x);assert.equal(fila(p,33).categoria,'dudosos');
 const recibo=p.items.find(i=>i.id===fila(p,33).id+':comprobante');assert.equal(recibo.categoria,'omitidos');
 assert.equal(recibo.penalidadComprobanteRegistrado,true);
 assert.match(recibo.aviso,/Pago de penalidad.*ya registrados.*Aplicado \$16.000/);assert.equal(recibo.payload,null);
});
test('ajuste autorizado de un servicio no se confunde con un segundo ajuste de penalidad',async()=>{
 const caso=R.caso();caso.db.cargo_ajustes.push({...caso.db.cargo_ajustes[0],id:'precio-ficticio',cargo_id:R.ids.jacuzzi,monto:2500,porcentaje:8.33});
 const x=R.contexto(caso),p=await preparar(x);assert.equal(fila(p,33).penalidadComparacion.diferencias.length,1);
 assert.equal(fila(p,33).penalidadComparacion.diferencias[0].campo,'monto');
});
test('lectura de tarjeta con MANAGEER conserva recepción y pendientes administrativos, sin inventar transferencia',()=>{
 const S=require('../js/haiku-libro-semantica-v1.js'),C=require('../js/haiku-libro-pagos-canon-v1.js');
 const N=require('../js/haiku-libro-lenguaje-natural-v1.js').crearSemantica(S,C);
 const hoja={celdas:[{r:1,c:2,valor:'13 nov',fechaISO:'2026-11-13'},{r:1,c:6,valor:'14 nov',fechaISO:'2026-11-14'},
  {r:2,c:0,valor:'cabaña 2'},{r:2,c:2,valor:'Persona Ficticia // 1 noche // 2 ADL'},
  {r:24,c:2,valor:'Pagos de arriendos de hoy'},{r:25,c:0,valor:'cabaña 2'},
  {r:26,c:2,valor:'22-10-2026',fechaISO:'2026-10-22'},{r:26,c:3,valor:'Persona Ficticia//Bovtar:990033-Folio:880033//credito//PEND BOVE Y MANAGEER'},
  {r:26,c:4,valor:'penalidad'},{r:26,c:5,valor:'$16.000',valorNumero:16000}],
  combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}},{s:{r:25,c:0},e:{r:29,c:0}}],estilos:[]};
 const p=N.corregirResultado(S.normalizarHoja(hoja,'Nov26')).pagos[0];
 assert.equal(p.manager_pendiente,true);assert.equal(p.bove_pendiente,true);assert.equal(p.pago_recibido,true);assert.equal(p.tipo_movimiento,'penalidad');
 const sinComprobante=structuredClone(hoja);sinComprobante.celdas.find(c=>c.r===26&&c.c===3).valor='Penalidad por pagar // PEND BOVE Y MANAGER';
 assert.notEqual(N.corregirResultado(S.normalizarHoja(sinComprobante,'Nov26')).pagos[0]?.pago_recibido,true);
});
test('32.500 contra 30.000 exige destino único de la misma estadía',()=>{
 const caso=R.caso(),snap={disponible:true,cargos:caso.db.vista_estado_cargos,servicios:caso.db.servicios,aplicaciones:[],pagos:[]};
 const p=caso.r.pagos[3];const base=D.resolverTransaccion(p,R.ids.reserva,snap,null,{estadiaId:R.ids.estadia});
 assert.equal(base.aplicaciones[0].estado,'saldo_insuficiente');
 const otro=structuredClone(snap);otro.cargos.push({...otro.cargos[1],cargo_id:'otro-cargo'});
 assert.notEqual(D.resolverTransaccion(p,R.ids.reserva,otro,null,{estadiaId:R.ids.estadia,excedenteAprobable:true}).estado,'destino_unico');
 assert.notEqual(D.resolverTransaccion(p,R.ids.reserva,snap,null,{estadiaId:'otra-estadia',excedenteAprobable:true}).estado,'destino_unico');
});
test('ficha distingue neto, cargos sin aplicar y abonos disponibles, con devoluciones',()=>{
 const c={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../js/supabase-finanzas-resumen-v1.js'),'utf8'),c);
 const caso=R.caso(),d=c.window.HAIKU_FINANZAS_RESUMEN_V1.detalle(caso.db.vista_estado_cargos,caso.db.pagos);
 assert.equal(d.total,188400);assert.equal(d.abono,144000);assert.equal(d.saldoCargos,188400);assert.equal(d.sinAplicar,144000);assert.equal(d.saldoNeto,44400);
 const e=c.window.HAIKU_FINANZAS_RESUMEN_V1.detalle(caso.db.vista_estado_cargos,[...caso.db.pagos,{tipo_movimiento:'devolucion',estado:'confirmado',monto:1000}]);
 assert.equal(e.saldoNeto,45400);assert.equal(e.sinAplicar,143000);
});
module.exports={fila};
