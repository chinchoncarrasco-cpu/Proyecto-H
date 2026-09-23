const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const R=require('../js/supabase-asistente-servicios-realizado-v1.js');

const diaActual='2026-09-23';
const orden='Haku, marca como realizado el Tonel de Dayana del 20-09.';
const reloj='2026-09-23T15:00:00+00:00';
const reserva={id:'r1',titular_nombre:'Dayana Luna Mendoza',estado_reserva:'hospedada',bove_checkout:null,bove_cierre:null,actualizado_en:'2026-09-20T18:00:00+00:00'};
const estadia={id:'e1',reserva_id:'r1',cabana_id:'cab6',estado_estadia:'hospedada',checkout_realizado_en:null,cabanas:{numero:6}};
const catalogo={id:'cat1',codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera',activo:true};
const servicio={id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cat1',recurso_id:'rec1',
 fecha_servicio:'2026-09-20',hora_inicio:'19:15:00',hora_fin:'20:15:00',cantidad:1,personas:2,
 precio_unitario_aplicado:30000,monto_adicional:0,total:30000,tipo_cobro:'normal',motivo_cortesia:null,
 estado_servicio:'programado',actualizado_en:'2026-09-20T18:00:00+00:00',catalogo_servicios:catalogo};
const cargo={id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,
 concepto:catalogo.nombre,moneda:'CLP',monto:30000,estado:'activo',actualizado_en:'2026-09-20T18:00:00+00:00'};
const vista={cargo_id:'c1',servicio_id:'s1',estado:'activo',monto:30000,monto_ajustado:30000,
 aplicado_neto:0,saldo_cargo:30000,estado_pago:'pendiente',ajuste_neto:0};
const tablas=(extra={})=>({catalogo_servicios:[catalogo],reservas:[reserva],reserva_estadias:[estadia],
 servicios:[servicio],cargos:[cargo],vista_estado_cargos:[vista],pago_aplicaciones:[],cargo_ajustes:[],pagos:[],...extra});
function clienteLectura(datos){
 const consultas=[],escrituras=[];
 return {consultas,escrituras,from(tabla){
  const filtros=[],registro={tabla,filtros:[]};
  const q={select(columnas){registro.columnas=columnas;return q;},eq(k,v){registro.filtros.push([k,v]);filtros.push(x=>x[k]===v);return q;},
   in(k,vs){registro.filtros.push([k,vs]);filtros.push(x=>vs.includes(x[k]));return q;},
   order(k,{ascending=true}={}){registro.orden=[k,ascending];return q;},
   async range(desde,hasta){consultas.push(registro);
    const rows=(datos[tabla]||[]).filter(x=>filtros.every(f=>f(x))).slice();
    if(registro.orden)rows.sort((a,b)=>String(a[registro.orden[0]]).localeCompare(String(b[registro.orden[0]]))*(registro.orden[1]?1:-1));
    const data=rows.slice(desde,hasta+1).map(x=>{
     if(registro.columnas!=='*')return x;
     if(tabla==='servicios'){const {catalogo_servicios,...persistido}=x;return persistido;}
     if(tabla==='reserva_estadias'){const {cabanas,...persistido}=x;return persistido;}
     return x;
    });
    return {data,error:null};},
   update(){escrituras.push('update');throw Error('Escritura prohibida');},
   insert(){escrituras.push('insert');throw Error('Escritura prohibida');},
   delete(){escrituras.push('delete');throw Error('Escritura prohibida');},
   upsert(){escrituras.push('upsert');throw Error('Escritura prohibida');}};
  return q;
 },rpc(){escrituras.push('rpc');throw Error('RPC prohibido');}};
}
 const opciones=(cliente,extra={})=>({cliente,permiso:()=>true,diaActual,leerTiempo:async()=>reloj,...extra});

test('consulta la hora de la respuesta Supabase sin usar auditoría ni reloj cliente',async()=>{
 const llamadas=[];
 const cliente={supabaseUrl:'https://proyecto.supabase.co',supabaseKey:'clave-publicable',
  auth:{getSession:async()=>({data:{session:{access_token:'sesion'}}})}};
 const fetchImpl=async (url,opcionesFetch)=>{llamadas.push([url,opcionesFetch]);
  return {ok:true,headers:{get:campo=>campo==='date'?'Wed, 23 Sep 2026 15:00:00 GMT':null}};};
 assert.equal(await R.leerReloj(cliente,{fetchImpl}),'2026-09-23T15:00:00.000Z');
 assert.match(llamadas[0][0],/\/rest\/v1\/catalogo_servicios\?select=id&limit=0$/);
 assert.equal(llamadas[0][1].method,'GET');assert.equal(llamadas[0][1].cache,'no-store');
 assert.equal(llamadas[0][1].headers.Authorization,'Bearer sesion');
 assert.equal(await R.leerReloj(cliente,{fetchImpl:async()=>({ok:true,headers:{get:()=>null}})}),null);
 assert.equal(await R.leerReloj(cliente,{fetchImpl:async()=>({ok:false,headers:{get:()=>reloj}})}),null);
 assert.equal(await R.leerReloj(cliente,{fetchImpl:async()=>{throw Error('Sin red');}}),null);
 assert.equal(await R.leerReloj({...cliente,auth:{getSession:async()=>({data:{session:null}})}},{fetchImpl}),null);
 assert.equal(llamadas.length,1);
});

test('intención canónica, órdenes incompletas y narración no operativa',async()=>{
 for(const t of [orden,'Haku, marca realizada la tinaja de la cab 6 de las 19:15.',
  'Haku, el masaje de Alejandra de las 16:00 ya se realizó.',
  'Haku, marca como realizado el servicio de la cab 6.',
  'Ponlo como realizado: Jacuzzi de Paulina del 20-09.',
  'Completar servicio Tonel de Dayana del 20-09.',
  'Haku, la cuna de Elena ya se hizo.'])
  assert.equal(R.interpretar(t,{diaActual})?.intencion,'MARCAR_SERVICIO_REALIZADO',t);
 for(const t of ['El huésped dijo que ayer se realizó la tinaja.',
  'La huésped comentó que el masaje ya se hizo.','El huésped dijo: marca realizado el Tonel.',
  'No marques realizado el Tonel de Dayana.',
  'Haku, crea una reserva para Dayana.'])assert.equal(R.interpretar(t,{diaActual}),null,t);
 const incompleta=await R.preparar('Haku, marca como realizado el servicio de la cab 6.',{diaActual});
 assert.equal(incompleta.estado,'incompleta');assert.match(incompleta.mensaje,/necesito identificarlo mejor/);
});
test('aliases, nombres normalizados, CAB + hora y cardinalidad de servicios',async()=>{
 const q=R.interpretar(orden,{diaActual});
 assert.deepEqual([q.titular,q.fecha,q.codigos_servicio],['Dayana','2026-09-20',['tinajaTonel']]);
 for(const [texto,codigo] of [['tinaja tonel','tinajaTonel'],['Jacuzzi','tinajaJacuzzi'],
  ['late check-out','lateCheckout'],['cuna','cuna']])
  assert.ok(R.interpretar(`Haku, marca como realizado el ${texto} de Dayana del 20-09.`,{diaActual}).codigos_servicio.includes(codigo));
 const cli=clienteLectura(tablas());
 assert.equal((await R.preparar(orden,opciones(cli))).estado,'propuesta');
 assert.equal((await R.preparar('Haku, marca realizada la tinaja de la cab 6 de las 19:15.',opciones(cli))).estado,'propuesta');
 assert.equal((await R.preparar('Haku, marca como realizado el Tonel de Dayana de la cab 9 del 20-09.',opciones(cli))).estado,'no_encontrado');
 const varios=await R.preparar(orden,opciones(clienteLectura(tablas({servicios:[servicio,{...servicio,id:'s2',hora_inicio:'21:15:00'}]}))));
 assert.equal(varios.estado,'multiples');assert.doesNotMatch(R.renderizar(varios),/data-servicio-realizado-confirmar/);
});
test('masaje dinámico pagado conserva las aplicaciones',async()=>{
 const cat={...catalogo,id:'mas1',codigo:'masajeTerapeutico60',nombre:'Masaje Terapéutico 60 min'};
 const s={...servicio,id:'s2',catalogo_servicio_id:'mas1',catalogo_servicios:cat,hora_inicio:'16:00:00',hora_fin:'17:00:00',fecha_servicio:'2026-09-14'};
 const c={...cargo,id:'c2',servicio_id:'s2',concepto:cat.nombre};
 const v={...vista,cargo_id:'c2',servicio_id:'s2',aplicado_neto:30000,saldo_cargo:0,estado_pago:'pagado'};
 const p={id:'p1',reserva_id:'r1',estado:'confirmado',tipo_movimiento:'pago',monto:30000};
 const a={id:'a1',cargo_id:'c2',pago_id:'p1',monto_aplicado:30000};
 const cli=clienteLectura(tablas({catalogo_servicios:[cat],servicios:[s],cargos:[c],vista_estado_cargos:[v],pagos:[p],pago_aplicaciones:[a]}));
 const propuesta=await R.preparar('Haku, el masaje de Dayana de las 16:00 ya se realizó.',opciones(cli));
 assert.equal(propuesta.estado,'propuesta');
 assert.match(R.renderizar(propuesta),/Pagado · saldo \$0/);
 assert.match(R.renderizar(propuesta),/no modificará sus pagos ni aplicaciones/);
 assert.equal(propuesta.p_estado_esperado.aplicaciones.length,1);
});
test('programado y en_proceso terminados; bloqueos de tiempo, estado, checkout y BOVE',async()=>{
 for(const estado of ['programado','en_proceso']){
  const p=await R.preparar(orden,opciones(clienteLectura(tablas({servicios:[{...servicio,estado_servicio:estado}]}))));
  assert.equal(p.estado,'propuesta');
 }
 for(const estado of ['cancelado','no_show']){
  const p=await R.preparar(orden,opciones(clienteLectura(tablas({servicios:[{...servicio,estado_servicio:estado}]}))));
  assert.equal(p.estado,'bloqueada');
 }
 const realizado=await R.preparar(orden,opciones(clienteLectura(tablas({servicios:[{...servicio,estado_servicio:'realizado'}]}))));
 assert.equal(realizado.estado,'already_realized');assert.doesNotMatch(R.renderizar(realizado),/data-servicio-realizado-confirmar/);
 const variantes=[
  tablas({servicios:[{...servicio,fecha_servicio:'2026-09-24'}]}),
  tablas({servicios:[{...servicio,fecha_servicio:'2026-09-23',hora_inicio:'12:15:00',hora_fin:'13:15:00'}]}),
  tablas({servicios:[{...servicio,estado_servicio:'en_proceso',hora_fin:null}]}),
  tablas({reservas:[{...reserva,estado_reserva:'checked_out'}]}),
  tablas({reservas:[{...reserva,bove_checkout:'BOVE-1'}]}),
  tablas({reservas:[{...reserva,bove_cierre:'BOVE-2'}]}),
  tablas({reserva_estadias:[{...estadia,checkout_realizado_en:reloj}]}),
  tablas({catalogo_servicios:[{...catalogo,activo:false}]})
 ];
 for(const datos of variantes){
  const texto=datos.servicios[0].fecha_servicio===servicio.fecha_servicio?orden:'Haku, marca como realizado el Tonel de Dayana, cab 6.';
  const p=await R.preparar(texto,opciones(clienteLectura(datos)));
  assert.equal(p.estado,'bloqueada');assert.match(R.renderizar(p),/Requiere revisión/);
  assert.doesNotMatch(R.renderizar(p),/data-servicio-realizado-confirmar/);}
 const sinHora=await R.preparar(orden,opciones(clienteLectura(tablas()),{leerTiempo:async()=>null}));
 assert.equal(sinHora.estado,'bloqueada');assert.match(R.renderizar(sinHora),/hora del servidor Supabase/);
 assert.doesNotMatch(R.renderizar(sinHora),/data-servicio-realizado-confirmar/);
 const hoyTermino=tablas({servicios:[{...servicio,fecha_servicio:'2026-09-23',hora_inicio:'09:00:00',hora_fin:'10:00:00'}]});
 assert.equal((await R.preparar(orden,opciones(clienteLectura(hoyTermino)))).estado,'no_encontrado');
 assert.equal((await R.preparar('Haku, marca como realizado el Tonel de Dayana del 23-09.',opciones(clienteLectura(hoyTermino)))).estado,'propuesta');
});
test('pendiente, parcial, cortesía y ajustes mantienen estados financieros separados',async()=>{
 const pendiente=await R.preparar(orden,opciones(clienteLectura(tablas())));
 assert.match(R.renderizar(pendiente),/Estado operativo/);
 assert.match(R.renderizar(pendiente),/Estado financiero/);
 assert.match(R.renderizar(pendiente),/Pendiente de pago · \$30\.000/);
 assert.match(R.renderizar(pendiente),/El cargo seguirá pendiente por \$30\.000/);
 const parcial=tablas({vista_estado_cargos:[{...vista,aplicado_neto:10000,saldo_cargo:20000}],
  pagos:[{id:'p1',reserva_id:'r1',estado:'confirmado',tipo_movimiento:'pago'}],
  pago_aplicaciones:[{id:'a1',cargo_id:'c1',pago_id:'p1',monto_aplicado:10000}]});
 const pp=await R.preparar(orden,opciones(clienteLectura(parcial)));
 assert.equal(pp.estado,'propuesta');assert.match(R.renderizar(pp),/Pagado parcialmente · saldo pendiente \$20\.000/);
 const cortesia=tablas({servicios:[{...servicio,tipo_cobro:'cortesia',total:0,motivo_cortesia:'Invitación'}],
  cargos:[{...cargo,estado:'anulado'}],vista_estado_cargos:[{...vista,estado:'anulado',saldo_cargo:0}]});
 const pc=await R.preparar(orden,opciones(clienteLectura(cortesia)));
 assert.equal(pc.estado,'propuesta');assert.match(R.renderizar(pc),/Cortesía · \$0/);assert.match(R.renderizar(pc),/Sin cargo activo/);
 const ajustado=await R.preparar(orden,opciones(clienteLectura(tablas({cargo_ajustes:[{id:'aj1',cargo_id:'c1',monto:1000}]}))));
 assert.equal(ajustado.estado,'bloqueada');assert.match(R.renderizar(ajustado),/ajustes históricos/);
});
test('snapshot completo, revalidación, UUID estable, doble clic y cero escrituras',async()=>{
 const datos=tablas(),cli=clienteLectura(datos),p=await R.preparar(orden,opciones(cli));
 assert.equal(p.estado,'propuesta');
 assert.deepEqual(Object.keys(p.p_estado_esperado),['version','servicio','reserva','estadia','catalogo',
  'checkout_realizado_en','cargos','finanzas','aplicaciones','pagos','ajustes']);
 assert.equal(p.p_estado_esperado.servicio.id,'s1');
 assert.equal(Object.hasOwn(p.p_estado_esperado.servicio,'catalogo_servicios'),false);
 assert.equal(Object.hasOwn(p.p_estado_esperado.estadia,'cabanas'),false);
 assert.equal(p.p_estado_esperado.finanzas[0].ajuste_neto,0);
 assert.equal(p.p_estado_esperado.finanzas[0].estado_pago,'pendiente');
 assert.equal(R.RPC_REALIZADO_PRODUCCION_HABILITADO,false);
 assert.match(R.renderizar(p),/Confirmar cambio · simulación/);
 const id='11111111-1111-4111-8111-111111111111';
 const [a,b]=await Promise.all([R.confirmar(p,{operationId:id}),R.confirmar(p,{operationId:id})]);
 assert.equal(a,b);assert.equal(a.estado,'simulada');assert.equal(a.rpc,'haiku_marcar_servicio_realizado_asistente_v1');
 assert.equal(a.operation_id,id);assert.equal(a.payload.p_operacion_id,id);
 assert.deepEqual(a.payload.p_estado_esperado,p.p_estado_esperado);
 assert.equal((await R.confirmar(p)).operation_id,id);
 assert.deepEqual(cli.escrituras,[]);
 assert.ok(cli.consultas.filter(x=>x.tabla==='servicios').length>=4);
 for(const tabla of ['reservas','reserva_estadias','cargos','vista_estado_cargos','pagos'])
  assert.ok(cli.consultas.filter(x=>x.tabla===tabla).length>=2,tabla);
 assert.equal(cli.consultas.some(x=>x.tabla==='eventos_auditoria'),false);
 const otra=await R.preparar(orden,opciones(clienteLectura(tablas())));
 otra.p_estado_esperado.servicio.total=1;
 const segundo=await R.confirmar(otra,{operationId:'22222222-2222-4222-8222-222222222222'});
 assert.notEqual(segundo.operation_id,id);
 assert.equal(segundo.payload.p_estado_esperado.servicio.total,30000);
 const datosViejos=tablas(),viejo=await R.preparar(orden,opciones(clienteLectura(datosViejos)));
 datosViejos.cargos[0]={...cargo,monto:31000};
 const stale=await R.confirmar(viejo,{operationId:'33333333-3333-4333-8333-333333333333'});
 assert.equal(stale.estado,'obsoleta');assert.equal(stale.nueva.estado,'bloqueada');
 assert.equal((await R.confirmar(viejo)).estado,'obsoleta');
});
test('cargador conecta el módulo después de la búsqueda persistida y el código no contiene writer',()=>{
 const panel=fs.readFileSync(path.join(__dirname,'../panel.html'),'utf8');
 const src=fs.readFileSync(path.join(__dirname,'../js/supabase-asistente-servicios-realizado-v1.js'),'utf8');
 assert.ok(panel.indexOf('supabase-asistente-servicios-reactivacion-v1')<panel.indexOf('supabase-asistente-servicios-realizado-v1'));
 assert.doesNotMatch(src,/\.rpc\s*\(|\.update\s*\(|\.insert\s*\(|\.delete\s*\(|\.upsert\s*\(/);
 assert.doesNotMatch(src,/eventos_auditoria/);
});
