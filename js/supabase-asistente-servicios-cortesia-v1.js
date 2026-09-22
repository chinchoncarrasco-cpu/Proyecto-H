/* HAKU · MODIFICAR SERVICIO EXISTENTE · NORMAL A CORTESÍA V1
 * Texto natural -> búsqueda persistida -> elegibilidad -> vista previa.
 * La ejecución queda cerrada en producción hasta desplegar y verificar el RPC.
 */
(function(root){
 'use strict';
 if(root.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1)return;

 const INTENCION='MODIFICAR_SERVICIO_EXISTENTE';
 const ACCION='NORMAL_A_CORTESIA';
 const RPC='haiku_cambiar_servicio_a_cortesia_v1';
 const RPC_PRODUCCION_HABILITADO=true;
 const propuestas=new WeakMap();
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const numero=v=>v==null||v===''?null:Number(v);
 const cortoHora=v=>String(v??'').match(/^(\d{1,2}):(\d{2})/)?.slice(1,3).map((x,i)=>i?x:x.padStart(2,'0')).join(':')||null;
 const uno=v=>Array.isArray(v)?v[0]||null:v||null;
 const quitarHaku=v=>String(v??'').replace(/^\s*(?:asistente\s+)?haku\s*(?:[,;:!¡¿?\-–—]+\s*|(?=(?:cambia|cambiar|pasa|pasar|pon|poner|deja|dejar)\b))/i,'').trimStart();
 const hoy=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

 function iso(y,m,d){
  y=Number(y);m=Number(m);d=Number(d);
  if(y<2000||y>2100||m<1||m>12||d<1||d>31)return null;
  const x=new Date(Date.UTC(y,m-1,d));
  return x.getUTCFullYear()===y&&x.getUTCMonth()===m-1&&x.getUTCDate()===d
   ?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
 }
 function fechaDesdeTexto(texto,diaActual=hoy()){
  const t=norm(texto),anioActual=Number(diaActual.slice(0,4));
  let m=t.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/);
  if(m){let y=m[3]?Number(m[3]):anioActual;if(y<100)y+=2000;return iso(y,m[2],m[1]);}
  const meses={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};
  m=t.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/);
  return m?iso(m[3]||anioActual,meses[m[2]],m[1]):null;
 }
 function titularDesdeTexto(texto,coincidenciaServicio){
  if(!coincidenciaServicio)return null;
  const resto=texto.slice(coincidenciaServicio.index+coincidenciaServicio[0].length);
  if(!/^\s+de\s+/i.test(resto))return null;
  let candidato=resto.replace(/^\s+de\s+/i,'');
  candidato=candidato.split(/\s*[,;]?\s+(?=(?:cab(?:aña|ana)?\.?\s*\d+|(?:del?|el)\s+\d{1,2}(?:[-/.]|\s+de\s+)|a\s+las?\s+\d|a\s+cortes[ií]a)\b)/i)[0];
  candidato=candidato.replace(/[.,;:!?]+$/,'').trim();
  const palabras=candidato.match(/[\p{L}][\p{L}'-]*/gu)||[];
  return palabras.length>=2&&palabras.join(' ').length===candidato.replace(/\s+/g,' ').length?candidato:null;
 }
 function interpretar(texto,{diaActual=hoy()}={}){
  const limpio=quitarHaku(texto),t=norm(limpio);
  if(!t||/\bno\s+(?:cambies?|pases?|pongas?|dejes?)\b/.test(t))return null;
  if(!/\b(?:cambia|cambiar|pasa|pasar|pon|poner|deja|dejar)\b/.test(t)||!/\bcortesia\b/.test(t))return null;
  const servicio=limpio.match(/\b(?:servicio\s+)?(?:tinaja\s+tonel|tinaja\s+de\s+madera|tonel(?:\s+de\s+madera)?|tinaja)\b/i);
  const conceptoNorm=norm(servicio?.[0]||'').replace(/^servicio\s+/,'');
  const especifico=/\btonel\b|\bde madera\b/.test(conceptoNorm);
  const cab=t.match(/\bcab(?:ana)?\.?\s*(\d{1,2})\b/);
  const hora=t.match(/\b(?:a\s+las?|hora)\s+([01]?\d|2[0-3])[:h]([0-5]\d)\b/)||t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const titular=titularDesdeTexto(limpio,servicio);
  const errores=[];
  if(!servicio)errores.push('Indica el concepto del servicio.');
  if(!titular)errores.push('Indica el nombre completo del titular después del servicio.');
  return {
   intencion:INTENCION,accion:ACCION,titular,
   cabana:cab?Number(cab[1]):null,
   concepto:servicio?(especifico?'tinaja tonel':'tinaja'):null,
   codigo_servicio:especifico?'tinajaTonel':null,
   codigos_servicio:especifico?['tinajaTonel']:servicio?['tinajaTonel','tinajaJacuzzi']:[],
   fecha:fechaDesdeTexto(limpio,diaActual),
   hora:hora?`${String(hora[1]).padStart(2,'0')}:${hora[2]}`:null,
   errores
  };
 }

 async function filas(fabrica){
  const salida=[];
  for(let desde=0;;desde+=500){
   const consulta=fabrica(),respuesta=typeof consulta?.range==='function'?await consulta.range(desde,desde+499):await consulta;
   if(respuesta?.error)throw respuesta.error;
   const datos=Array.isArray(respuesta?.data)?respuesta.data:[];salida.push(...datos);
   if(datos.length<500)return salida;
  }
 }
 function resolverCandidatos(q,{reservas=[],servicios=[],estadias=[]}={}){
  const reservasExactas=new Map(reservas.filter(r=>norm(r.titular_nombre)===norm(q.titular)).map(r=>[r.id,r]));
  const estadiasPorId=new Map(estadias.map(e=>[e.id,e]));
  return servicios.map(s=>{
   const reserva=reservasExactas.get(s.reserva_id),estadia=estadiasPorId.get(s.estadia_id),catalogo=uno(s.catalogo_servicios);
   return reserva?{...s,reserva,estadia,catalogo,cabana_numero:Number(uno(estadia?.cabanas)?.numero)}:null;
  }).filter(Boolean).filter(s=>
   q.codigos_servicio.includes(String(s.catalogo?.codigo||''))&&
   (!q.cabana||s.cabana_numero===q.cabana)&&
   (!q.fecha||s.fecha_servicio===q.fecha)&&
   (!q.hora||cortoHora(s.hora_inicio)===q.hora)
  ).sort((a,b)=>`${a.fecha_servicio}|${a.hora_inicio||''}|${a.id}`.localeCompare(`${b.fecha_servicio}|${b.hora_inicio||''}|${b.id}`));
 }
 async function buscarServicios(q,{cliente=root.haikuSupabase}={}){
  if(!cliente?.from)throw Error('No está disponible la lectura autenticada de Proyecto H.');
  const patron=`%${String(q.titular||'').trim().split(/\s+/).join('%')}%`;
  const reservas=await filas(()=>cliente.from('reservas').select('id,titular_nombre,estado_reserva,bove_checkout').ilike('titular_nombre',patron).order('id'));
  const reservaIds=reservas.map(r=>r.id);
  if(!reservaIds.length)return [];
  const servicios=await filas(()=>{
   let x=cliente.from('servicios').select('id,reserva_id,estadia_id,catalogo_servicio_id,recurso_id,fecha_servicio,hora_inicio,hora_fin,cantidad,personas,precio_unitario_aplicado,monto_adicional,total,tipo_cobro,motivo_cortesia,estado_servicio,actualizado_en,catalogo_servicios(id,codigo,nombre,activo,permite_cortesia)').in('reserva_id',reservaIds);
   if(q.fecha)x=x.eq('fecha_servicio',q.fecha);
   return x.order('id');
  });
  const estadiaIds=[...new Set(servicios.map(s=>s.estadia_id).filter(Boolean))];
  const estadias=estadiaIds.length?await filas(()=>cliente.from('reserva_estadias').select('id,reserva_id,cabana_id,cabanas(numero)').in('id',estadiaIds).order('id')):[];
  return resolverCandidatos(q,{reservas,servicios,estadias});
 }
 async function cargarFinanzas(candidato,{cliente=root.haikuSupabase}={}){
  const cargos=await filas(()=>cliente.from('cargos').select('id,reserva_id,estadia_id,servicio_id,tipo_cargo,estadia_noche_id,monto,estado,actualizado_en').eq('servicio_id',candidato.id).order('id'));
  const ids=cargos.map(c=>c.id);
  const [estados,aplicaciones,ajustes]=ids.length?await Promise.all([
   filas(()=>cliente.from('vista_estado_cargos').select('cargo_id,monto,monto_ajustado,aplicado_neto,saldo_cargo,estado,estado_pago').in('cargo_id',ids).order('cargo_id')),
   filas(()=>cliente.from('pago_aplicaciones').select('id,pago_id,cargo_id,monto_aplicado').in('cargo_id',ids).order('id')),
   filas(()=>cliente.from('cargo_ajustes').select('id,cargo_id,estado,monto,operacion_id').in('cargo_id',ids).order('id'))
  ]):[[],[],[]];
  return {cargos,estados,aplicaciones,ajustes};
 }
 function estadoEsperado(candidato,finanzas){
  const activos=finanzas.cargos.filter(c=>c.estado==='activo'),cargo=activos.length===1?activos[0]:null;
  const vista=cargo?finanzas.estados.find(e=>e.cargo_id===cargo.id)||null:null;
  return {
   version:1,servicio_id:candidato.id,servicio_actualizado_en:candidato.actualizado_en,
   tipo_cobro:candidato.tipo_cobro,total:numero(candidato.total),estado_servicio:candidato.estado_servicio,
   estado_reserva:candidato.reserva.estado_reserva,bove_checkout:candidato.reserva.bove_checkout??null,
   cargo_id:cargo?.id??null,cargo_estado:cargo?.estado??null,cargo_monto:cargo?numero(cargo.monto):null,
   cargo_actualizado_en:cargo?.actualizado_en??null,aplicado_neto:vista?numero(vista.aplicado_neto):null,
   saldo_cargo:vista?numero(vista.saldo_cargo):null,cantidad_cargos:finanzas.cargos.length,
   cantidad_cargos_activos:activos.length,cantidad_aplicaciones:finanzas.aplicaciones.length,
   cantidad_ajustes:finanzas.ajustes.length
  };
 }
 function evaluarElegibilidad(candidato,finanzas){
  const razones=[],catalogo=candidato.catalogo||{},total=numero(candidato.total),activos=finanzas.cargos.filter(c=>c.estado==='activo');
  const incoherentes=finanzas.cargos.filter(c=>c.reserva_id!==candidato.reserva_id||c.estadia_id!==candidato.estadia_id||c.servicio_id!==candidato.id||c.tipo_cargo!=='servicio'||c.estadia_noche_id!=null||!['activo','anulado'].includes(c.estado));
  if(catalogo.activo!==true)razones.push('El catálogo está inactivo.');
  if(catalogo.permite_cortesia!==true)razones.push('El catálogo no permite cortesía.');
  if(!['programado','en_proceso','realizado'].includes(candidato.estado_servicio))razones.push('El estado operativo requiere revisión.');
  if(incoherentes.length)razones.push('Existen cargos relacionados incoherentes.');
  if(candidato.tipo_cobro==='cortesia'){
   const coherente=total===0&&String(candidato.motivo_cortesia||'').trim()&&activos.length===0&&finanzas.aplicaciones.length===0&&finanzas.ajustes.length===0&&finanzas.cargos.every(c=>c.estado==='anulado')&&!razones.length;
   return coherente?{estado:'already_courtesy',elegible:false,razones:[]}:{estado:'bloqueada',elegible:false,razones:[...razones,'El servicio figura como cortesía, pero sus finanzas no son coherentes.']};
  }
  if(candidato.tipo_cobro!=='normal'||!Number.isFinite(total)||total<=0)razones.push('El servicio no es un cobro normal positivo.');
  if(activos.length!==1)razones.push('Debe existir exactamente un cargo activo.');
  if(finanzas.aplicaciones.length)razones.push('Existen aplicaciones de pago históricas.');
  if(finanzas.ajustes.length)razones.push('Existen ajustes históricos.');
  if(activos.length===1){
   const cargo=activos[0],vista=finanzas.estados.find(e=>e.cargo_id===cargo.id);
   if(numero(cargo.monto)!==total||!vista||numero(vista.monto_ajustado)!==total||Number(vista.aplicado_neto??0)!==0||numero(vista.saldo_cargo)!==total)razones.push('El cargo activo no coincide con el total pendiente del servicio.');
  }
  return {estado:razones.length?'bloqueada':'elegible',elegible:!razones.length,razones};
 }

 async function preparar(texto,opciones={}){
  const q=typeof texto==='string'?interpretar(texto,{diaActual:opciones.diaActual||hoy()}):texto;
  if(!q)return {estado:'no_aplica'};
  if(q.errores?.length)return {estado:'incompleta',consulta:q,mensaje:q.errores.join(' ')};
  const permiso=opciones.permiso||(()=>root.haikuTienePermiso?.('servicios.editar')===true);
  if(!permiso())return {estado:'bloqueada',consulta:q,mensaje:'No tienes el permiso servicios.editar.'};
  const buscar=opciones.buscar||buscarServicios,cargar=opciones.cargarFinanzas||cargarFinanzas,cliente=opciones.cliente||root.haikuSupabase;
  try{
   const candidatos=await buscar(q,{cliente});
   if(!candidatos.length)return {estado:'no_encontrado',consulta:q,mensaje:'No encontré un servicio persistido que coincida con esos datos.'};
   if(candidatos.length>1)return {estado:'multiples',consulta:q,candidatos,mensaje:`Encontré ${candidatos.length} servicios. Indica fecha, hora o cabaña para identificar uno solo.`};
   const candidato=candidatos[0],finanzas=await cargar(candidato,{cliente}),elegibilidad=evaluarElegibilidad(candidato,finanzas);
   if(elegibilidad.estado==='already_courtesy')return {estado:'already_courtesy',consulta:q,candidato,mensaje:'Este servicio ya está registrado como cortesía. No requiere cambios.'};
   if(!elegibilidad.elegible)return {estado:'bloqueada',consulta:q,candidato,elegibilidad,mensaje:'No puedo demostrar que este cambio sea seguro. Requiere revisión.'};
   const p={estado:'propuesta',consulta:q,candidato,elegibilidad,p_estado_esperado:estadoEsperado(candidato,finanzas),mensaje:'Cambio preparado. No se ha modificado Proyecto H.'};
   propuestas.set(p,{consulta:{...q},servicioId:candidato.id,snapshot:JSON.stringify(p.p_estado_esperado),evidencia:JSON.stringify({candidato,finanzas}),cliente,buscar,cargar,permiso,operacionId:null,payload:null,enCurso:null,resultado:null,rpcRespondioExito:false});
   return p;
  }catch(error){return {estado:'bloqueada',consulta:q,mensaje:`No pude completar la lectura de Proyecto H. ${error?.message||error}`};}
 }
 function uuid(opciones={}){
  if(opciones.operacionId)return opciones.operacionId;
  if(typeof root.crypto?.randomUUID==='function')return root.crypto.randomUUID();
  throw Error('No se pudo generar el identificador de la operación.');
 }
 const avisoCambio='La situación de este servicio cambió desde que preparé la propuesta. Volveré a comprobarlo antes de realizar el cambio.';
 const permisoRpc=(opciones,cliente)=>RPC_PRODUCCION_HABILITADO||
  (opciones.modoPruebaLocal===true&&typeof module!=='undefined'&&!!module.exports&&
   !root.document&&cliente?.__hakuCortesiaMock===true);
 async function releer(original){
  const candidatos=await original.buscar(original.consulta,{cliente:original.cliente});
  if(candidatos.length!==1||candidatos[0].id!==original.servicioId)return null;
  const candidato=candidatos[0],finanzas=await original.cargar(candidato,{cliente:original.cliente});
  return {candidato,finanzas,elegibilidad:evaluarElegibilidad(candidato,finanzas),snapshot:estadoEsperado(candidato,finanzas),evidencia:JSON.stringify({candidato,finanzas})};
 }
 const coincidePropuesta=(original,lectura)=>lectura?.elegibilidad.elegible&&
  JSON.stringify(lectura.snapshot)===original.snapshot&&lectura.evidencia===original.evidencia;
 async function obsoleta(original){
  const nueva=await preparar(original.consulta,{cliente:original.cliente,buscar:original.buscar,cargarFinanzas:original.cargar,permiso:original.permiso});
  return {estado:'obsoleta',mensaje:avisoCambio,nueva};
 }
 function respuestaError(error){
  const mensaje=String(error?.message||error||''),codigo=String(error?.code||'');
  if(codigo==='40001'||/obsoleta|cambiaron|cambió de reserva|propuesta nueva/i.test(mensaje))return 'stale';
  if(codigo==='42501'||/permiso|sesión|usuario no activo/i.test(mensaje))return 'sin_permiso';
  if(/aplicaciones de pago históricas/i.test(mensaje))return 'aplicaciones';
  if(/ajustes históricos/i.test(mensaje))return 'ajustes';
  if(/cargo activo|incoheren|finanzas|postcondición|historial financiero/i.test(mensaje))return 'incoherencia';
  return 'desconocido';
 }
 function verificarCambio(original,lectura,motivo){
  if(!lectura||lectura.candidato.id!==original.servicioId||lectura.candidato.tipo_cobro!=='cortesia'||numero(lectura.candidato.total)!==0||numero(lectura.candidato.monto_adicional)!==0||
     String(lectura.candidato.motivo_cortesia||'').trim()!==motivo)return false;
  const antes=JSON.parse(original.snapshot),cargos=lectura.finanzas.cargos;
  return cargos.length===antes.cantidad_cargos&&cargos.every(c=>c.estado==='anulado')&&
   cargos.some(c=>c.id===antes.cargo_id&&c.estado==='anulado'&&numero(c.monto)===antes.cargo_monto)&&
   lectura.finanzas.estados.length===cargos.length&&lectura.finanzas.estados.every(e=>e.estado==='anulado')&&
   lectura.finanzas.aplicaciones.length===antes.cantidad_aplicaciones&&
   lectura.finanzas.ajustes.length===antes.cantidad_ajustes;
 }
 function refrescarAutoridades(original,lectura){
  if(!root.document||!root.CustomEvent)return;
  root.document.dispatchEvent(new root.CustomEvent('haiku:servicio-supabase-cambiado',{
   detail:{servicioId:original.servicioId,reservaId:lectura.candidato.reserva_id}
  }));
 }
 function resultadoExito(p,original,lectura,motivo,origen){
  const antes=JSON.parse(original.snapshot),resultado={
   estado:'realizado',mensaje:origen==='relectura'?'Cambio realizado, acreditado por una nueva lectura.':'Cambio realizado.',
   candidato:lectura.candidato,servicio_despues:lectura.candidato,cargo_anterior:antes,
   motivo,operacion_id:original.operacionId,origen
  };
  original.resultado=resultado;refrescarAutoridades(original,lectura);return resultado;
 }
 async function verificarEstado(p){
  const original=propuestas.get(p);
  if(!original||!original.payload)return {estado:'bloqueada',mensaje:'No hay una operación pendiente para comprobar.'};
  if(original.resultado)return original.resultado;
  try{
   const lectura=await releer(original);
   if(verificarCambio(original,lectura,original.payload.p_motivo))return resultadoExito(p,original,lectura,original.payload.p_motivo,'relectura');
   if(coincidePropuesta(original,lectura))
    return original.rpcRespondioExito
     ?{estado:'sincronizando',mensaje:'El RPC respondió correctamente; la lectura todavía no refleja el cambio. Sólo volveré a leer.',propuesta:p,motivo:original.payload.p_motivo}
     :{estado:'reintento_seguro',mensaje:'La lectura confirma que el servicio sigue sin cambios. Puedes reintentar la misma operación.',propuesta:p,motivo:original.payload.p_motivo,operacion_id:original.operacionId};
   return await obsoleta(original);
  }catch(error){
   return {estado:'incierto',mensaje:'No pude comprobar el estado real del servicio. Sólo se permite volver a leer; no se repetirá el RPC automáticamente.',propuesta:p,motivo:original.payload.p_motivo};
  }
 }
 async function simular(p,motivo,opciones={}){
  const original=propuestas.get(p),limpio=String(motivo??'').trim();
  if(!original)return {estado:'bloqueada',mensaje:'Prepara una propuesta nueva antes de confirmar.'};
  if(!limpio)return {estado:'bloqueada',mensaje:'El motivo de cortesía es obligatorio.'};
  if(!original.permiso())return {estado:'bloqueada',mensaje:'El permiso servicios.editar ya no está disponible.'};
  try{
   const lectura=await releer(original);
   if(!coincidePropuesta(original,lectura))return await obsoleta(original);
   return {estado:'simulada',mensaje:'Confirmación simulada. El RPC no fue ejecutado.',rpc:RPC,parametros:{p_operacion_id:uuid(opciones),p_servicio_id:original.servicioId,p_motivo:limpio,p_estado_esperado:lectura.snapshot}};
  }catch(error){return {estado:'bloqueada',mensaje:`No pude revalidar la propuesta. ${error?.message||error}`};}
 }
 async function confirmarInterno(p,original,limpio,opciones){
  const cliente=original.cliente;
  if(!permisoRpc(opciones,cliente))return {estado:'bloqueada',mensaje:'La ejecución del RPC sigue bloqueada hasta su despliegue y autorización.'};
  if(!limpio)return {estado:'bloqueada',mensaje:'El motivo de cortesía es obligatorio.'};
  if(original.resultado)return original.resultado;
  if(original.payload&&original.payload.p_motivo!==limpio)return {estado:'bloqueada',mensaje:'El motivo cambió. Prepara una propuesta nueva para otra operación.'};
  if(!original.permiso())return {estado:'sin_permiso',mensaje:'No tienes el permiso servicios.editar. No se realizó ningún cambio.'};
  opciones.onEstado?.('Verificando nuevamente…');
  let lectura;
  try{lectura=await releer(original);}catch(error){return {estado:'bloqueada',mensaje:`No pude revalidar la propuesta. ${error?.message||error}`};}
  if(original.payload&&verificarCambio(original,lectura,limpio))return resultadoExito(p,original,lectura,limpio,'relectura');
  if(!coincidePropuesta(original,lectura))return await obsoleta(original);
  if(original.rpcRespondioExito)return {estado:'sincronizando',mensaje:'El RPC ya respondió correctamente. Sólo volveré a leer el estado.',propuesta:p,motivo:limpio};
  if(!original.payload){
   original.operacionId=uuid(opciones);
   original.payload=Object.freeze({p_operacion_id:original.operacionId,p_servicio_id:original.servicioId,p_motivo:limpio,p_estado_esperado:Object.freeze({...lectura.snapshot})});
  }
  opciones.onEstado?.('Aplicando cambio…');
  let respuesta,errorRpc;
  try{({data:respuesta,error:errorRpc}=await cliente.rpc(RPC,original.payload));}
  catch(error){errorRpc=error;}
  if(errorRpc){
   const clase=respuestaError(errorRpc);
   if(clase==='stale')return await obsoleta(original);
   if(clase==='sin_permiso')return {estado:'sin_permiso',mensaje:'No tienes permiso para realizar este cambio.'};
   if(clase==='aplicaciones'||clase==='ajustes'||clase==='incoherencia')
    return {estado:'revision_humana',mensaje:clase==='aplicaciones'?'El servicio tiene aplicaciones de pago históricas; requiere revisión humana.':clase==='ajustes'?'El servicio tiene ajustes históricos; requiere revisión humana.':'Las finanzas del servicio son incoherentes; requiere revisión humana.'};
   return await verificarEstado(p);
  }
  if(!respuesta||respuesta.ok!==true||respuesta.servicio_id!==original.servicioId)
   return await verificarEstado(p);
  if(respuesta.estado==='already_courtesy')return {estado:'already_courtesy',mensaje:'Este servicio ya está registrado como cortesía. No requiere cambios.'};
  if(respuesta.estado!=='changed_to_courtesy'||respuesta.cargo_id!==original.payload.p_estado_esperado.cargo_id||
     numero(respuesta.cargo_monto_historico)!==original.payload.p_estado_esperado.cargo_monto)
   return await verificarEstado(p);
  original.rpcRespondioExito=true;
  const observado=await verificarEstado(p);
  if(observado.estado==='sincronizando'||observado.estado==='incierto'){
   for(let intento=0;intento<2;intento++){
    await new Promise(resolver=>setTimeout(resolver,300));
    const siguiente=await verificarEstado(p);
    if(siguiente.estado==='realizado'||siguiente.estado==='obsoleta')return siguiente;
   }
  }
  return observado.estado==='incierto'
   ?{estado:'sincronizando',mensaje:'El RPC respondió correctamente; estoy esperando poder leer el cambio. Sólo volveré a leer.',propuesta:p,motivo:limpio}
   :observado;
 }
 function confirmar(p,motivo,opciones={}){
  const original=propuestas.get(p);
  if(!original)return Promise.resolve({estado:'bloqueada',mensaje:'Prepara una propuesta nueva antes de confirmar.'});
  if(original.enCurso)return original.enCurso;
  const tarea=confirmarInterno(p,original,String(motivo??'').trim(),opciones);
  original.enCurso=tarea;
  void tarea.then(()=>{original.enCurso=null;},()=>{original.enCurso=null;});
  return tarea;
 }
 const cancelar=()=>({estado:'cancelada',mensaje:'Cambio cancelado. No se modificó Proyecto H.'});
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dinero=v=>`$${Math.round(Number(v)||0).toLocaleString('es-CL')}`;
 const fechaVisible=v=>String(v||'—').split('-').reverse().join('-');
 function resumen(c){return `${c.catalogo?.nombre||'Servicio'} · ${fechaVisible(c.fecha_servicio)} · ${cortoHora(c.hora_inicio)||'sin hora'}${c.hora_fin?`–${cortoHora(c.hora_fin)}`:''} · CAB ${c.cabana_numero||'—'}`;}
 function renderizar(p){
  if(p.estado==='multiples')return `<article class="haku-servicio-cortesia"><h3>Servicios coincidentes</h3><p>${esc(p.mensaje)}</p><ol>${p.candidatos.map(c=>`<li>${esc(resumen(c))}</li>`).join('')}</ol><p>No elegí ninguno automáticamente.</p></article>`;
  if(p.estado==='obsoleta')return `<article class="haku-servicio-cortesia"><p>${esc(p.mensaje)}</p></article>${renderizar(p.nueva)}`;
  if(['no_encontrado','incompleta','bloqueada','already_courtesy','cancelada','revision_humana','sin_permiso'].includes(p.estado))return `<article class="haku-servicio-cortesia"><h3>Cambio de servicio</h3><p>${esc(p.mensaje)}</p>${p.elegibilidad?.razones?.length?`<ul>${p.elegibilidad.razones.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</article>`;
  if(p.estado==='simulada')return `<article class="haku-servicio-cortesia"><h3>Confirmación simulada</h3><p>${esc(p.mensaje)}</p><p>No se llamó a Supabase ni se modificó Proyecto H.</p><details><summary>Payload preparado</summary><pre>${esc(JSON.stringify({rpc:p.rpc,parametros:p.parametros},null,2))}</pre></details></article>`;
  if(p.estado==='realizado'){
   const c=p.candidato,antes=p.cargo_anterior;
   return `<article class="haku-servicio-cortesia haku-servicio-cortesia--realizado">
    <header class="haku-servicio-cortesia-cabecera"><span class="haku-servicio-cortesia-sello">✓ Cambio realizado</span><strong class="haku-servicio-cortesia-titular">${esc(c.reserva.titular_nombre)} · CAB ${esc(c.cabana_numero)}</strong><span class="haku-servicio-cortesia-nombre">${esc(c.catalogo.nombre)}</span><span class="haku-servicio-cortesia-fecha">${esc(fechaVisible(c.fecha_servicio))} · ${esc(cortoHora(c.hora_inicio)||'sin hora')}</span></header>
    <div class="haku-servicio-cortesia-comparacion"><div><span>Antes</span><strong>Normal</strong><b>${esc(dinero(antes.total))}</b></div><span class="haku-servicio-cortesia-flecha" aria-hidden="true">→</span><div><span>Después</span><strong>Cortesía</strong><b>$0</b></div></div>
    <p class="haku-servicio-cortesia-efecto">Cargo asociado anulado <span>·</span> Monto histórico conservado: <strong>${esc(dinero(antes.cargo_monto))}</strong> <span>·</span> Sin cobro pendiente activo</p>
    <p class="haku-servicio-cortesia-motivo-resultado"><span>Motivo:</span> ${esc(p.motivo)}</p>${c.reserva.estado_reserva==='checked_out'?'<p class="haku-servicio-cortesia-aviso">Modificación realizada después del check-out.</p>':''}</article>`;
  }
  if(['sincronizando','incierto','reintento_seguro'].includes(p.estado))return `<article class="haku-servicio-cortesia"><h3>${p.estado==='sincronizando'?'Sincronizando':p.estado==='incierto'?'Estado por comprobar':'Reintento disponible'}</h3><p>${esc(p.mensaje)}</p><div class="haku-servicio-cortesia-acciones">${p.estado==='reintento_seguro'?`<button type="button" data-servicio-cortesia-reintentar ${RPC_PRODUCCION_HABILITADO?'':'disabled'}>Reintentar misma operación</button>`:'<button type="button" data-servicio-cortesia-releer>Comprobar estado</button>'}</div></article>`;
  const c=p.candidato,cargo=p.p_estado_esperado;
  return `<article class="haku-servicio-cortesia haku-servicio-cortesia--propuesta">
   <header class="haku-servicio-cortesia-cabecera"><span class="haku-servicio-cortesia-sello">Cambio de servicio</span><strong class="haku-servicio-cortesia-titular">${esc(c.reserva.titular_nombre)} · CAB ${esc(c.cabana_numero)}</strong><span class="haku-servicio-cortesia-nombre">${esc(c.catalogo.nombre)}</span><span class="haku-servicio-cortesia-fecha">${esc(fechaVisible(c.fecha_servicio))} · ${esc(cortoHora(c.hora_inicio)||'sin hora')}${c.hora_fin?`–${esc(cortoHora(c.hora_fin))}`:''}</span></header>
   <div class="haku-servicio-cortesia-comparacion"><div><span>Antes</span><strong>Normal</strong><b>${esc(dinero(c.total))}</b></div><span class="haku-servicio-cortesia-flecha" aria-hidden="true">→</span><div><span>Después</span><strong>Cortesía</strong><b>$0</b></div></div>
   <p class="haku-servicio-cortesia-efecto">Cargo pendiente <strong>${esc(dinero(cargo.saldo_cargo))}</strong> <span aria-hidden="true">→</span> será anulado</p>
   ${c.reserva.estado_reserva==='checked_out'?'<p class="haku-servicio-cortesia-aviso">Esta reserva ya realizó check-out.</p>':''}
   <label class="haku-servicio-cortesia-motivo">Motivo de cortesía<textarea data-servicio-cortesia-motivo rows="2" autocomplete="off"></textarea></label>
   <p class="haku-servicio-cortesia-confirmacion">Al confirmar, Proyecto H cambiará el servicio y anulará su cargo activo.</p><p data-servicio-cortesia-estado></p>
   <div class="haku-servicio-cortesia-acciones"><button type="button" data-servicio-cortesia-confirmar disabled>Confirmar cambio</button><button type="button" data-servicio-cortesia-cancelar>Cancelar</button></div></article>`;
 }
 function instalar(){
  const doc=root.document,style=doc.createElement('style');style.textContent=`
   .haku-servicio-cortesia{box-sizing:border-box;width:100%;padding:14px 16px;background:#fff;color:#263c2c;border:1px solid #dbe5de;border-radius:11px;overflow-wrap:anywhere;font-size:12px;line-height:1.45}
   .haku-servicio-cortesia h3{font-size:15px;margin:0 0 8px}.haku-servicio-cortesia p{line-height:1.45}
   .haku-servicio-cortesia-cabecera{display:flex;flex-direction:column;gap:2px;padding-bottom:12px;border-bottom:1px solid #e7ede9}
   .haku-servicio-cortesia-sello{margin-bottom:6px;color:#24704e;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
   .haku-servicio-cortesia--realizado .haku-servicio-cortesia-sello{color:#1c6b42}
   .haku-servicio-cortesia-titular{color:#17251d;font-size:15px;line-height:1.25}
   .haku-servicio-cortesia-nombre{color:#334139;font-size:13px;font-weight:650}
   .haku-servicio-cortesia-fecha{color:#65746a;font-size:12px}
   .haku-servicio-cortesia-comparacion{display:grid;grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr);align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid #e7ede9}
   .haku-servicio-cortesia-comparacion>div{display:grid;gap:1px;min-width:0}
   .haku-servicio-cortesia-comparacion>div>span{color:#7b8980;font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
   .haku-servicio-cortesia-comparacion strong{font-size:12px;font-weight:600;color:#425048}
   .haku-servicio-cortesia-comparacion b{font-size:18px;line-height:1.2;color:#17251d}
   .haku-servicio-cortesia-comparacion>div:last-child strong,.haku-servicio-cortesia-comparacion>div:last-child b{color:#1f6e4c}
   .haku-servicio-cortesia-flecha{color:#81a08c;text-align:center;font-size:18px}
   .haku-servicio-cortesia-efecto{margin:10px 0 0;color:#45584a;font-size:11px}
   .haku-servicio-cortesia-efecto strong{color:#263c2c}.haku-servicio-cortesia-efecto>span{color:#819488}
   .haku-servicio-cortesia-aviso{margin:9px 0 0;color:#795c2f;font-size:11px}
   .haku-servicio-cortesia-motivo{display:grid;gap:6px;margin-top:14px;color:#344d3c;font-size:11px;font-weight:700}
   .haku-servicio-cortesia textarea{box-sizing:border-box;width:100%;min-height:56px;font:inherit;font-size:12px;font-weight:400;line-height:1.4;resize:vertical;border:1px solid #cbd9cf;border-radius:7px;padding:8px 9px;background:#fff;color:#263c2c}
   .haku-servicio-cortesia textarea:focus-visible,.haku-servicio-cortesia button:focus-visible{outline:2px solid #31835b;outline-offset:2px}
   .haku-servicio-cortesia-confirmacion{margin:9px 0 0;color:#65746a;font-size:11px}
   .haku-servicio-cortesia-motivo-resultado{margin:12px 0 0;padding-top:10px;border-top:1px solid #e7ede9;color:#263c2c}
   .haku-servicio-cortesia-motivo-resultado span{color:#65746a;font-weight:700}
   .haku-servicio-cortesia-acciones{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
   .haku-servicio-cortesia button{min-height:34px;font:inherit;font-weight:700;border:1px solid #cbd9cf;border-radius:7px;padding:7px 11px;background:#fff;color:#425048;cursor:pointer}
   .haku-servicio-cortesia button[data-servicio-cortesia-confirmar]:not(:disabled){border-color:#1f6e4c;background:#1f6e4c;color:#fff}
   .haku-servicio-cortesia button[data-servicio-cortesia-confirmar]:not(:disabled):hover{background:#174f39}
   .haku-servicio-cortesia button:disabled{background:#edf0ed;color:#748078;cursor:not-allowed}
   .haku-servicio-cortesia pre{white-space:pre-wrap;font-size:11px}
   @media(max-width:540px){.haku-servicio-cortesia{padding:12px}.haku-servicio-cortesia-comparacion{grid-template-columns:minmax(0,1fr);gap:4px}.haku-servicio-cortesia-flecha{text-align:left;line-height:1}.haku-servicio-cortesia-comparacion>div:last-child{padding-top:2px}}
  `;doc.head.appendChild(style);
  let ocupado=false;
  async function procesar(texto,campo,mensajes){
   if(ocupado)return;ocupado=true;campo.value='';campo.dispatchEvent(new root.Event('input',{bubbles:true}));
   const u=doc.createElement('div');u.className='haiku-asistente-mensaje haiku-asistente-mensaje--usuario';u.textContent=texto;mensajes.appendChild(u);
   const el=doc.createElement('div');el.className='haiku-asistente-mensaje haiku-asistente-mensaje--asistente';el.textContent='Buscando el servicio en Proyecto H…';mensajes.appendChild(el);
   let p;try{p=await preparar(texto);el.innerHTML=renderizar(p);}finally{ocupado=false;mensajes.scrollTop=mensajes.scrollHeight;}
   el.addEventListener('input',e=>{if(!e.target?.matches?.('[data-servicio-cortesia-motivo]'))return;const b=el.querySelector('[data-servicio-cortesia-confirmar]');if(b)b.disabled=!e.target.value.trim();});
   el.addEventListener('click',async e=>{const b=e.target?.closest?.('button');if(!b)return;e.preventDefault();e.stopPropagation();
    if(b.hasAttribute('data-servicio-cortesia-cancelar')){p=cancelar();el.innerHTML=renderizar(p);return;}
    if(b.disabled)return;
    if(!b.matches('[data-servicio-cortesia-confirmar],[data-servicio-cortesia-reintentar],[data-servicio-cortesia-releer]'))return;
    const propuesta=p.estado==='propuesta'?p:p.propuesta;
    const motivo=p.estado==='propuesta'?el.querySelector('[data-servicio-cortesia-motivo]')?.value||'':p.motivo;
    el.querySelectorAll('button,textarea').forEach(x=>x.disabled=true);
    try{
     if(b.hasAttribute('data-servicio-cortesia-releer'))p=await verificarEstado(propuesta);
     else if(!RPC_PRODUCCION_HABILITADO)p=await simular(propuesta,motivo);
     else p=await confirmar(propuesta,motivo,{onEstado:estado=>{const indicador=el.querySelector('[data-servicio-cortesia-estado]');if(indicador)indicador.textContent=estado;else el.textContent=estado;}});
    }catch(error){p={estado:'incierto',mensaje:'No pude completar la comprobación. Consulta nuevamente el estado antes de reintentar.',propuesta,motivo};}
    el.innerHTML=renderizar(p);
    if(p.estado==='obsoleta')p=p.nueva;
   });
  }
  function interceptar(e){
   const campo=doc.getElementById('haiku-asistente-texto'),mensajes=doc.getElementById('haiku-asistente-mensajes');if(!campo||!mensajes)return;
   if(e.type==='click'?!e.target?.closest?.('#haiku-asistente-enviar'):e.target!==campo)return;
   if(e.type==='keydown'&&(e.key!=='Enter'||e.shiftKey||e.isComposing))return;
   if(doc.getElementById('haiku-asistente-adjuntos')?.querySelector('.haiku-asistente-adjunto'))return;
   const texto=campo.value.trim();if(!interpretar(texto))return;e.preventDefault();e.stopImmediatePropagation();void procesar(texto,campo,mensajes);
  }
  root.addEventListener('click',interceptar,true);root.addEventListener('keydown',interceptar,true);
 }
 const api=Object.freeze({interpretar,buscarServicios,resolverCandidatos,cargarFinanzas,estadoEsperado,evaluarElegibilidad,preparar,simular,confirmar,verificarEstado,cancelar,renderizar});
 root.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1=api;
 if(typeof module!=='undefined')module.exports=api;
 if(root.document)instalar();
})(typeof window!=='undefined'?window:globalThis);
