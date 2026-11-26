const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('./fixtures/libro-transferencias-bancarias.cjs');
const base=F.leer(), reserva=base.reservas[0];
const pago={...base.pagos[0],medio_pago:'webpay',codigo_autorizacion:'123456',detalle_bancario:null,
 pagador:null,evidencia_transferencia:null,
 texto_original:'Persona Prueba // WebPay por confirmar // CodAut 123456 // CREDITO',
 estado_pago:'por_confirmar',pago_recibido:null};
const nota={...pago,monto:null,medio_pago:null,codigo_autorizacion:null,concepto:null,titular:null,
 texto_original:'BOVE 17204',origen:{hoja:'Oct26',celda:'C28:F28'}};
const datos={...base,pagos:[pago,nota],reservas:[{...reserva,pagos:[pago,nota],pagos_sin_asociacion:[]}]};

function pagina({tardia=false,inicial=datos}={}) {
 const callbacks=[],listeners=new Map(),campo={value:''};let actual=inicial,generacion=1;
 const fuente=()=>{const copia=structuredClone(actual),g=generacion;
  return {listo:async()=>{},estado:()=>({cargado:true,generacion:g,nombre:'Prueba.xlsx'}),listarHojas:()=>['Oct26'],
   consultarHoja:async(h,v,t)=>t&&t!=='semantica'?{hojas:['Oct26']}:structuredClone(copia),
   consultarHojas:async nombres=>nombres.map(()=>structuredClone(copia)),consultarIndice:async()=>({nombres:['Oct26']})};};
 const api={...fuente(),crearLectura:async()=>fuente()};
 const document={readyState:tardia?'loading':'complete',head:{appendChild(){}},
  getElementById:id=>id==='haiku-asistente-texto'?campo:null,querySelector:()=>null,
  createElement:()=>({dataset:{},style:{}}),addEventListener:(e,f)=>{if(e==='DOMContentLoaded')callbacks.push(f);}};
 const ctx=vm.createContext({document,console:{info(){}},structuredClone,Date,Math,Intl,Set,Map,
  setInterval:()=>1,clearInterval(){},MutationObserver:class {observe(){}},
  HAIKU_LIBRO_SEMANTICA:F.S,
  addEventListener:(e,f)=>{if(!listeners.has(e))listeners.set(e,[]);listeners.get(e).push(f);}});
 ctx.window=ctx;if(!tardia)ctx.HAIKU_LIBRO_RESERVA_V1=api;
 for(const name of ['haiku-libro-pagos-canon-v1','haiku-libro-lenguaje-natural-v1','haiku-libro-pagos-focalizados-v1','haiku-libro-consultas-v1'])
  vm.runInContext(fs.readFileSync(require.resolve('../js/'+name+'.js'),'utf8'),ctx);
 if(tardia){ctx.HAIKU_LIBRO_RESERVA_V1=api;callbacks.forEach(f=>f());}
 return {ctx,api:()=>ctx.HAIKU_LIBRO_RESERVA_V1,actualizar(data){actual=data;generacion++;},
  disparar(texto){campo.value=texto;for(const f of listeners.get('click')||[]){
   // Sólo activa el filtro focalizado; el envío completo se prueba por consultar().
   if(f.name==='prepararScopeAntesDeHaku')f({type:'click',target:{closest:()=>({})}});
  }},listeners,campo};
}

for(const tardia of [false,true]) test('consulta estable conserva canon y notas con inicialización '+(tardia?'diferida':'inmediata'),async()=>{
 const h=pagina({tardia}),lectura=await h.api().crearLectura();
 const vivo=await h.api().consultarHoja('Oct26'),estable=await lectura.consultarHoja('Oct26');
 assert.deepEqual(estable,vivo);
 assert.equal(estable.reservas[0].pagos.length,1);
 assert.equal(estable.reservas[0].pagos[0].medio_pago,'webpay_credito');
 assert.equal(estable.reservas[0].pagos[0].pago_recibido,true);
 assert.equal(estable.anotaciones.filter(x=>x.tipo==='nota_financiera').length,1);
 const [lote]=await lectura.consultarHojas(['Oct26']);assert.deepEqual(lote,estable);
 assert.equal((await lectura.consultarHojaMensual('Oct26')).pagos.length,1);
 assert.deepEqual(await lectura.consultarHoja('Oct26','actual','buscar'),{hojas:['Oct26']});
 assert.deepEqual(await lectura.consultarIndice(),{nombres:['Oct26']});
 assert.equal((await lectura.consultarHoja('Oct26','anterior')).pagos.length,1);
});

test('actualizar el Libro conserva consulta, reglas y generación; la próxima consulta usa la versión nueva',async()=>{
 const h=pagina(),lectura=await h.api().crearLectura();
 const enCurso=lectura.consultarHoja('Oct26');
 h.actualizar({...datos,reservas:[],pagos:[],anotaciones:[]});
 assert.equal((await enCurso).reservas[0].pagos.length,1);
 assert.equal((await lectura.consultarHoja('Oct26')).reservas.length,1);
 assert.equal(lectura.estado().generacion,1);
 const nueva=await h.api().crearLectura();assert.equal(nueva.estado().generacion,2);
 assert.equal((await nueva.consultarHoja('Oct26')).reservas.length,0);
});

test('WebPay por confirmar se prepara como abono con la fecha y autorización del Libro',async()=>{
 const h=pagina(),db=F.cliente([reserva]);
 const result=await h.ctx.HAIKU_LIBRO_CONSULTAS.consultar('compara libro octubre 2026 con proyecto h',h.api(),db);
 const plan=await h.ctx.HAIKU_LIBRO_CONSULTAS.prepararIncorporacion(result,new Map(),new Set(),db);
 const items=plan.items.filter(i=>i.pagoLibro);
 assert.equal(items.length,1);assert.equal(items[0].categoria,'pagos');
 assert.equal(items[0].seleccionado,true);
 const enviados=h.ctx.HAIKU_LIBRO_CONSULTAS.serializarIncorporacion(plan);
 assert.equal(enviados.length,1);
 assert.equal(enviados[0].aprobado_manualmente,false);
 assert.equal(enviados[0].argumentos.p_medio_pago,'webpay_credito');
 assert.equal(enviados[0].argumentos.p_codigo_autorizacion,'123456');
 assert.equal(enviados[0].argumentos.p_fecha_pago,pago.fecha_comprobante);
 assert.equal(enviados[0].argumentos.p_monto,pago.monto);
 const fuente=await (await h.api().crearLectura()).consultarHoja('Oct26');
 assert.equal(fuente.anotaciones.filter(x=>x.tipo==='nota_financiera').length,1);
 assert.ok(!db.llamadas.some(n=>/registrar|incorporar/.test(n)));
});

for (const [caso,cambio] of [
 ['el código falta aunque la fila traiga folio y BOVTAR',{codigo_autorizacion:null,folio:'009876',bovtar:'005432',
  texto_original:'Persona Prueba // WebPay X confirmar // CREDITO // Folio 009876 // BOVTAR 005432'}],
 ['falta precisar débito o crédito',{texto_original:'Persona Prueba // WebPay por confirmar // CodAut 123456'}],
 ['el comprobante figura rechazado',{texto_original:pago.texto_original+' // rechazado'}],
 ['el pago figura pendiente de recibir',{texto_original:pago.texto_original+' // pendiente de recibir'}]
]) test('WebPay por confirmar sigue en revisión si '+caso,async()=>{
 const db=F.cliente([reserva]),modificado={...pago,...cambio};
 const h=pagina({inicial:{...datos,pagos:[modificado],reservas:[{...reserva,pagos:[modificado],pagos_sin_asociacion:[]}]}});
 const result=await h.ctx.HAIKU_LIBRO_CONSULTAS.consultar('compara libro octubre 2026 con proyecto h',h.api(),db);
 const plan=await h.ctx.HAIKU_LIBRO_CONSULTAS.prepararIncorporacion(result,new Map(),new Set(),db);
 const item=plan.items.find(i=>i.pagoLibro);
 assert.equal(result.comparacion.pagosDetalle[0].estado,'revisar');
 assert.equal(item.categoria,'dudosos');
 assert.equal(item.aprobable,false);
 assert.ok(!h.ctx.HAIKU_LIBRO_CONSULTAS.serializarIncorporacion(plan).some(i=>i.tipo==='pago'));
});

test('el filtro por titular persiste en la lectura estable y no contamina la lectura mensual',async()=>{
 const h=pagina();h.actualizar({...datos,reservas:[...datos.reservas,{...datos.reservas[0],titular:'Otra Persona',cabana:11}]});
 h.disparar('haku revisa los pagos de Exequiel Almoncid el 30 de octubre de 2026');
 const lectura=await h.api().crearLectura();
 h.disparar('haku revisa los pagos de Otra Persona el 30 de octubre de 2026');
 const focal=await lectura.consultarHoja('Oct26');assert.equal(focal.reservas.length,1);
 assert.equal(focal.reservas[0].titular,'Exequiel Almoncid');
 assert.equal(focal.reservas[0].pagos[0].medio_pago,'webpay_credito');
 assert.equal((await lectura.consultarHojaMensual('Oct26')).reservas.length,2);
});

for(const etiqueta of ['Cod.aout:244543','Cod.aout: 602159','COD. AOUT: 000123'])
 test('error de escritura conocido en autorización conserva el código explícito: '+etiqueta,()=>{
  const libro=F.leer([{pagos:[{glosa:'Persona Prueba // webpay por confirmar // '+etiqueta+' // credito'}]}]);
  const p=libro.pagos[0];assert.equal(p.codigo_autorizacion,etiqueta.match(/\d+/)[0]);
  assert.equal(p.medio_pago,'webpay_credito');assert.equal(p.pago_recibido,true);
 });
test('BOVE o número sin rótulo no se convierte en autorización',()=>{
 for(const glosa of ['Persona Prueba // WebPay credito // BOVE 17204','Persona Prueba // WebPay credito // 244543'])
  assert.equal(F.leer([{pagos:[{glosa}]}]).pagos[0].codigo_autorizacion,null);
});
