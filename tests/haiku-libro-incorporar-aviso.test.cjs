const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {entorno}=require('./fixtures/libro-servicio-manual.cjs');
const read=p=>fs.readFileSync(require.resolve('../js/'+p+'.js'),'utf8');
const fila={id:'ficticia',titular:'Persona de prueba',cabana:8,fecha_checkin:'2026-11-07',fecha_checkout:'2026-11-08',adultos:2};
function coordinador(){
 const estado={gen:1,usuario:'u1',preparadas:0,escrituras:0,servicios:0,consultas:[],resuelto:false};
 const c={structuredClone,haikuSesion:{usuario:{activo:true},roles:['administrador']},
  haikuSupabase:{auth:{getUser:async()=>({data:{user:{id:estado.usuario}}})}},
  HAIKU_LIBRO_RESERVA_V1:{estado:()=>({generacion:estado.gen})},
  HAIKU_LIBRO_CONTEXTO_V1:{actualizarDesdeLibro:async r=>r,enriquecer:async r=>r},
  HAIKU_LIBRO_CONSULTAS:{
   revalidarCambiosDetectados:async rows=>{estado.consultas.push(rows);return estado.resuelto?
    {items:[],reservas:[],comparacion:[]}:{items:[{tipo:'nueva',actual:fila,accionable:true}],reservas:[fila],comparacion:[],q:{}};},
   prepararIncorporacion:async()=>{estado.preparadas++;return {items:[
    {id:'reserva',categoria:'nuevas',seleccionado:true,payload:{reserva:fila}},
    {id:'pago',categoria:'pagos',seleccionado:true,payload:{tipo:'pago'}}]};},
   confirmarIncorporacion:async(_r,_d,_a,plan)=>{estado.escrituras++;assert.equal(plan.items[1].seleccionado,false);
    estado.resuelto=true;return {resultado:{ok:true,reservas_creadas:1}};}
  }};
 vm.runInNewContext(read('supabase-asistente-libro-actualizacion-v1'),c);
 return {c,estado,api:c.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1,informe:{estado:'ok',libro_actual:{generacion:1},
  nuevas:[{actual:fila}],incorporacion:{listos:[{}],reservasListas:[fila.id]}}};
}
test('un clic incorpora reservas, excluye pagos y comparte un solo intento concurrente',async()=>{
 const h=coordinador();const [a,b]=await Promise.all([h.api.incorporarDesdeAviso(h.informe),h.api.incorporarDesdeAviso(h.informe)]);
 assert.equal(a.reservas_creadas,1);assert.equal(a,b);assert.equal(h.estado.escrituras,1);
 assert.equal(a.pendientes.length,0);assert.equal(h.estado.preparadas,1);
 await h.api.incorporarDesdeAviso(h.informe);assert.equal(h.estado.escrituras,1);
 assert.ok(h.estado.consultas.every(rows=>rows.length===1&&rows[0].actual.id===fila.id));
});
test('respuesta perdida conserva el mismo plan y solicitud al reintentar',async()=>{
 const h=coordinador();let primero;
 h.c.HAIKU_LIBRO_CONSULTAS.confirmarIncorporacion=async(_r,_d,_a,plan)=>{
  if(!primero){primero=plan;plan.solicitudPendiente={operacionId:'op-ficticia'};throw Error('Respuesta perdida');}
  assert.equal(plan,primero);assert.equal(plan.solicitudPendiente.operacionId,'op-ficticia');h.estado.resuelto=true;
  return {resultado:{ok:true,reservas_creadas:1}};
 };
 await assert.rejects(h.api.incorporarDesdeAviso(h.informe),/Respuesta perdida/);
 const fin=await h.api.incorporarDesdeAviso(h.informe);assert.equal(fin.reservas_creadas,1);assert.equal(h.estado.preparadas,1);
});
test('cambio de sesión bloquea el reintento de una solicitud pendiente',async()=>{
 const h=coordinador();h.c.HAIKU_LIBRO_CONSULTAS.confirmarIncorporacion=async(_r,_d,_a,p)=>{
  h.estado.escrituras++;p.solicitudPendiente={operacionId:'op'};throw Error('Red');
 };
 await assert.rejects(h.api.incorporarDesdeAviso(h.informe),/Red/);h.estado.usuario='otra';
 await assert.rejects(h.api.incorporarDesdeAviso(h.informe),/sesión cambió/);assert.equal(h.estado.escrituras,1);
});
test('conserva un resultado parcial y reintenta sólo servicios pendientes',async()=>{
 const h=coordinador(),original=h.c.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados;
 h.informe.incorporacion.operacionesListas=[{id:'srv:ficticio',reserva:fila.id}];
 h.c.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados=async rows=>({...await original(rows),revisionServicios:{reservas:[fila],generacion:1}});
 h.c.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4={crearIncorporacionAviso:()=>async()=>{
  if(++h.estado.servicios===1)throw Error('Fallo de servicios');return {ok:true,servicios_creados:1,notas_creadas:0};
 }};
 await assert.rejects(h.api.incorporarDesdeAviso(h.informe),e=>e.incorporado.reservas_creadas===1);
 const fin=await h.api.incorporarDesdeAviso(h.informe);
 assert.equal(fin.reservas_creadas,1);assert.equal(fin.servicios_creados,1);assert.equal(h.estado.escrituras,1);
});
test('los incompletos explican el dato que falta y nunca llegan al writer',async()=>{
 const h=coordinador();h.c.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados=async()=>({items:[
  {actual:fila,revision:{motivos:['Falta la fecha del masaje.']}}],reservas:[],comparacion:[]});
 const fin=await h.api.incorporarDesdeAviso(h.informe);
 assert.equal(fin.pendientes[0].motivos[0],'Falta la fecha del masaje.');assert.equal(h.estado.escrituras,0);
});
test('el mismo clic termina las notas que quedan listas después del servicio',async()=>{
 const h=coordinador();
 h.informe.incorporacion.operacionesListas=[{id:'srv:ficticio',reserva:fila.id}];
 h.c.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados=async()=>h.estado.resuelto?{items:[],reservas:[],comparacion:[]}:
  {items:[{tipo:'modificacion',actual:fila}],reservas:h.estado.servicios?[fila]:[],comparacion:[],q:{},revisionServicios:{reservas:[fila],generacion:1}};
 h.c.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4={crearIncorporacionAviso:()=>async()=>{h.estado.servicios++;
  return {ok:true,servicios_creados:1,notas_creadas:1};}};
 const fin=await h.api.incorporarDesdeAviso(h.informe);
 assert.equal(h.estado.escrituras,1);assert.equal(h.estado.servicios,1);assert.equal(fin.pendientes.length,0);
 assert.equal(fin.servicios_creados,1);assert.equal(fin.notas_creadas,1);
});
test('si falla la lectura final no pierde el recibo ni vuelve a guardar',async()=>{
 const h=coordinador(),original=h.c.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados;let n=0;
 h.c.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados=async rows=>{if(++n===2)throw Error('Lectura final');return original(rows);};
 await assert.rejects(h.api.incorporarDesdeAviso(h.informe),e=>e.incorporado.reservas_creadas===1);
 const fin=await h.api.incorporarDesdeAviso(h.informe);assert.equal(fin.reservas_creadas,1);assert.equal(h.estado.escrituras,1);
});
async function servicios(){
 const e=entorno();e.guard();
 e.c.haikuSesion={usuario:{activo:true},roles:['administrador']};e.c.haikuTienePermiso=()=>true;
 e.c.confirm=()=>assert.fail('El clic de la burbuja ya confirmó');
 const r=e.state.reservas[0];r.texto_original='1 HORA JACUZZI CORTESIA A LAS 22:00 // DEJAR BATAS';
 r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
 const rpc=e.c.haikuSupabase.rpc;e.c.haikuSupabase.rpc=async(n,a)=>{
  const res=await rpc(n,a);
  if(res.data?.ok)Object.assign(res.data,{servicios_omitidos:0,notas_omitidas:0,
   notas:a.p_notas.map(x=>({item_id:x.item_id,estado:'creada',reserva_id:x.reserva_id,estadia_id:x.estadia_id}))});
  return res;
 };
 return {...e,r,scope:{reservas:[r],generacion:1},crear:scope=>e.c.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4.crearIncorporacionAviso(scope)};
}
test('servicio real: un clic escribe la estadía única y sus notas sin diálogo ni otra reserva',async()=>{
 const e=await servicios(),guardar=e.crear(e.scope);
 const [a,b]=await Promise.all([guardar(),guardar()]);assert.equal(a,b);assert.equal(a.servicios_creados,1);
 assert.equal(e.state.escrituras.length,1);const p=e.state.escrituras[0];assert.equal(p.p_servicios[0].codigo_servicio,'tinajaJacuzzi');
 assert.equal(p.p_servicios[0].estadia_id,e.state.db.reserva_estadias[0].id);
 assert.ok(p.p_notas.every(n=>n.reserva_id===p.p_servicios[0].reserva_id));
 assert.deepEqual(Array.from(a.confirmados,x=>x.detalles[0][0]),['Tinaja Jacuzzi','Nota de la reserva']);
 await guardar();assert.equal(e.state.escrituras.length,1);
});
test('el aviso guarda sólo el ítem mostrado y un resultado omitido no aparece como incorporado',async()=>{
 const e=await servicios(),plan=await e.api.prepararHistorial(e.scope),nota=plan.items.find(x=>x.kind==='nota');
 const original=e.c.haikuSupabase.rpc;
 e.c.haikuSupabase.rpc=async(n,a)=>{
  const res=await original(n,a);
  return {data:{...res.data,notas_creadas:0,notas_omitidas:1,notas:[{item_id:nota.item_id,estado:'ya_importada'}]}};
 };
 const guardar=e.crear({...e.scope,seleccionAviso:{ids:[nota.item_id],nuevas:[]}});
 const fin=await guardar();
 assert.equal(fin.notas_omitidas,1);
 assert.equal(fin.confirmados.length,0);
 assert.equal(e.state.escrituras[0].p_servicios.length,0);
 assert.equal(e.state.escrituras[0].p_notas[0].item_id,nota.item_id);
});
test('servicios: respuesta perdida reenvía idéntico UUID y payload',async()=>{
 const e=await servicios(),original=e.c.haikuSupabase.rpc;let args;
 e.c.haikuSupabase.rpc=async(n,a)=>{if(n==='haiku_importar_libro_operaciones_v2'&&!args){args=JSON.stringify(a);throw Error('Red');}
  if(n==='haiku_importar_libro_operaciones_v2')assert.equal(JSON.stringify(a),args);return original(n,a);};
 const guardar=e.crear(e.scope);await assert.rejects(guardar(),/Red/);await guardar();assert.equal(e.state.escrituras.length,1);
});
for(const escenario of ['sin permiso','sin fecha','estadía duplicada','respuesta incompleta'])test(`servicios: ${escenario} no anuncia incorporación`,async()=>{
 const e=await servicios();
 if(escenario==='sin permiso')e.c.haikuTienePermiso=()=>false;
 if(escenario==='sin fecha'){e.r.fecha_checkout='2026-10-13';e.r.noches=3;e.state.db.reserva_estadias[0].fecha_salida=e.r.fecha_checkout;}
 if(escenario==='estadía duplicada')e.state.db.reserva_estadias.push({...e.state.db.reserva_estadias[0],id:'duplicada'});
 if(escenario==='respuesta incompleta')e.c.haikuSupabase.rpc=async()=>({data:{ok:true}});
 const guardar=e.crear(e.scope);
 if(['sin fecha','estadía duplicada'].includes(escenario)){const fin=await guardar();assert.equal(fin.servicios_creados,0);}
 else await assert.rejects(guardar());
 if(escenario==='sin fecha')assert.ok(e.state.escrituras.every(p=>p.p_servicios.length===0),'una nota completa no habilita el servicio sin fecha');
 else assert.equal(e.state.escrituras.length,0);
});
test('reserva real: motor canónico envía el RPC desde el aviso y revalida el resultado',async()=>{
 const h=coordinador(),rows=[],calls=[];
 const r={...fila,titular:'Persona Sintética',rut_documento:'11111111-1',tipo_estadia:'alojamiento',noches:1,ninos:0,mascotas:0,
  pagos:[],pagos_sin_asociacion:[],servicios:[],advertencias:[],notas_importantes:[],coordenadas_origen:{hoja:'Nov26',celda:'AB10'}};
 h.informe.nuevas=[{actual:r}];h.c.HAIKU_LIBRO_SEMANTICA=require('../js/haiku-libro-semantica-v1.js');
 h.c.haikuTienePermiso=()=>true;h.c.HAIKU_LIBRO_ESCRITURA_HABILITADA=true;
 h.c.haikuSupabase={auth:{getUser:async()=>({data:{user:{id:'u1'}}}),getSession:async()=>({data:{session:{user:{id:'u1'}}}})},
  from:table=>{const b={select:()=>b,lte:()=>b,gte:()=>b,in:()=>b,eq:()=>b,order:()=>b,
   range:async(a,z)=>({data:(table==='reserva_estadias'?rows:[]).slice(a,z+1)})};return b;},
  rpc:async(name,args)=>{
   calls.push({name,args});assert.equal(name,'haiku_incorporar_libro_v1');assert.equal(args.p_items[0].tipo,'reserva_nueva');
   rows.push({id:'00000000-0000-4000-8000-000000000001',reserva_id:'00000000-0000-4000-8000-000000000002',cabana_id:'c8',cabanas:{numero:8},fecha_ingreso:r.fecha_checkin,
    fecha_salida:r.fecha_checkout,tipo_estadia:'alojamiento',estado_estadia:'confirmada',adultos:2,ninos:0,mascotas:0,
    reservas:{id:'00000000-0000-4000-8000-000000000002',titular_nombre:r.titular,titular_tipo_documento:'rut',titular_numero_documento:r.rut_documento,estado_reserva:'confirmada'}});
   return {data:{ok:true,reservas_creadas:1,estadias_agregadas:0,pagos_creados:0,actualizaciones:0,omitidos:0,
    resultados:[{tipo:'reserva_nueva',item_id:args.p_items[0].item_id,reserva_id:rows[0].reserva_id}]}};
  }};
 vm.runInNewContext(read('haiku-libro-consultas-v1'),h.c);
 const fin=await h.api.incorporarDesdeAviso(h.informe);
 assert.equal(calls.length,1);assert.equal(fin.reservas_creadas,1);assert.equal(fin.pendientes.length,0,JSON.stringify(fin.pendientes));
 assert.equal(fin.confirmados[0].titular,r.titular);
 assert.match(fin.confirmados[0].detalles[0].join(' '),/Reserva incorporada.*CAB 8/);
});
