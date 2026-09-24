/* Haku · marcar un servicio persistido como realizado. */
(function(root){
 'use strict';
 if(root.HAIKU_ASISTENTE_SERVICIOS_REALIZADO_V1)return;
 const base=root.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1||
  (typeof require==='function'?require('./supabase-asistente-servicios-cortesia-v1.js'):null);
 const cancelacion=root.HAIKU_ASISTENTE_SERVICIOS_CANCELACION_V1||
  (typeof require==='function'?require('./supabase-asistente-servicios-cancelacion-v1.js'):null);
 const INTENCION='MARCAR_SERVICIO_REALIZADO';
 const RPC='haiku_marcar_servicio_realizado_asistente_v1';
 const RPC_REALIZADO_PRODUCCION_HABILITADO=true;
 const propuestas=new WeakMap();
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const num=v=>v==null||v===''?null:Number(v);
 const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const dinero=v=>'$'+Number(v||0).toLocaleString('es-CL');
 const fecha=v=>String(v||'').replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3-$2-$1');
 const hora=v=>String(v??'').match(/^(\d{1,2}):(\d{2})/)?.slice(1).map((x,i)=>i?x:x.padStart(2,'0')).join(':')||null;
 const etiquetaEstado=v=>({programado:'Programado',en_proceso:'En proceso',realizado:'Realizado',cancelado:'Cancelado',no_show:'No show'})[v]||v||'Sin estado';
 const ordenar=(a,campo='id')=>[...a].sort((x,y)=>String(x[campo]).localeCompare(String(y[campo])));
 const formatoChile=instante=>{
  const partes=new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instante));
  const valor=nombre=>partes.find(x=>x.type===nombre)?.value;
  return {dia:`${valor('year')}-${valor('month')}-${valor('day')}`,hora:`${valor('hour')}:${valor('minute')}`};
 };

 function interpretar(texto,{diaActual}={}){
  const original=String(texto??'').replace(/^\s*(?:asistente\s+)?haku\s*[,;:!¡¿?\-–—]*\s*/i,'').trim();
  const t=norm(original);
  if(!t||/\bno\s+(?:marques?|pongas?|completes?|registres?)\b/.test(t))return null;
  const orden=/^\s*(?:por\s+favor[,;:]?\s*)?(?:marca(?:r)?|marcame|pon(?:lo|la|er)?|completa(?:r)?|completame|registra(?:r)?)\b/.test(t)&&
   /\b(?:realizad[oa]s?|completad[oa]s?|completa(?:r)?\s+(?:el|la|este|un)?\s*servicio)\b/.test(t);
  const dirigido=/^\s*(?:el|la|este|esta)?\s*(?:servicio|tinaja|tonel|jacuzzi|masaje|late|cuna)\b/.test(t)&&
   /\bya\s+se\s+(?:realizo|hizo)\b/.test(t);
  if(!orden&&!dirigido)return null;
  if(/\b(?:dijo|conto|comento|informo|pregunto|cree|parece)\s+que\b/.test(t))return null;
  const convertido=original.replace(/\b(?:marca(?:r)?|marcame)\s+(?:como\s+)?realizad[oa]s?\b/i,'cancela')
   .replace(/\bpon(?:lo|la|er)?\s+como\s+realizad[oa]s?\b/i,'cancela')
   .replace(/\b(?:completa(?:r)?|completame|registra(?:r)?)\s+(?:el\s+|la\s+|este\s+|un\s+)?servicio\b/i,'cancela el servicio')
   .replace(/\bya\s+se\s+(?:realiz[oó]|hizo)(?=\W|$)/i,'cancela');
  const parsed=cancelacion.interpretar(convertido,{diaActual});
  if(parsed&&parsed.cabana&&parsed.hora&&!parsed.titular)
   parsed.errores=parsed.errores.filter(x=>!x.startsWith('Sin titular, indica también la fecha.'));
  return parsed?{...parsed,intencion:INTENCION,accion:INTENCION}:
   {intencion:INTENCION,accion:INTENCION,titular:null,cabana:null,concepto:null,codigos_servicio:[],fecha:null,hora:null,
    errores:['Indica el tipo de servicio y el titular o la cabaña.']};
 }

 async function filas(fabrica){
  const salida=[];
  for(let desde=0;;desde+=500){
   const q=fabrica(),r=typeof q?.range==='function'?await q.range(desde,desde+499):await q;
   if(r?.error)throw r.error;
   const datos=Array.isArray(r?.data)?r.data:[];salida.push(...datos);
   if(datos.length<500)return salida;
  }
 }
 const unico=async fabrica=>(await filas(fabrica))[0]||null;
 async function leerReloj(cliente,{fetchImpl=root.fetch}={}){
  // GET sin filas al Data API: Date proviene de la respuesta de Supabase,
  // no de registros históricos ni del reloj del navegador.
  try{
   const baseUrl=cliente?.supabaseUrl||root.HAIKU_SUPABASE_CONFIG?.url;
   const key=cliente?.supabaseKey;
   if(!baseUrl||!key||!cliente?.auth?.getSession||typeof fetchImpl!=='function')return null;
   const sesion=await cliente.auth.getSession();
   const token=sesion?.data?.session?.access_token;
   if(sesion?.error||!token)return null;
   const url=new URL('/rest/v1/catalogo_servicios?select=id&limit=0',baseUrl);
   if(url.protocol!=='https:')return null;
   const respuesta=await fetchImpl(url.href,{method:'GET',cache:'no-store',
    headers:{apikey:key,Authorization:`Bearer ${token}`}});
   const valor=respuesta?.ok?respuesta.headers?.get('date'):null;
   return valor&&Number.isFinite(Date.parse(valor))?new Date(valor).toISOString():null;
  }catch(_){return null;}
 }
 async function cargarEstado(c,{cliente=root.haikuSupabase,leerTiempo=leerReloj}={}){
  if(!cliente?.from)throw Error('No está disponible la lectura autenticada de Proyecto H.');
  const [servicio,reserva,estadia,catalogo,estadias,cargos,pagos,reloj]=await Promise.all([
   unico(()=>cliente.from('servicios').select('*').eq('id',c.id)),
   unico(()=>cliente.from('reservas').select('*').eq('id',c.reserva_id)),
   unico(()=>cliente.from('reserva_estadias').select('*').eq('id',c.estadia_id)),
   unico(()=>cliente.from('catalogo_servicios').select('*').eq('id',c.catalogo_servicio_id)),
   filas(()=>cliente.from('reserva_estadias').select('id,checkout_realizado_en').eq('reserva_id',c.reserva_id).order('id')),
   filas(()=>cliente.from('cargos').select('*').eq('servicio_id',c.id).order('id')),
   filas(()=>cliente.from('pagos').select('*').eq('reserva_id',c.reserva_id).order('id')),
   leerTiempo(cliente)
  ]);
  if(!servicio||!reserva||!estadia||!catalogo)throw Error('El servicio o sus dependencias ya no están disponibles.');
  const ids=cargos.map(x=>x.id);
  const [estados,aplicaciones,ajustes]=ids.length?await Promise.all([
   filas(()=>cliente.from('vista_estado_cargos').select('*').eq('servicio_id',c.id).order('cargo_id')),
   filas(()=>cliente.from('pago_aplicaciones').select('*').in('cargo_id',ids).order('id')),
   filas(()=>cliente.from('cargo_ajustes').select('*').in('cargo_id',ids).order('id'))
  ]):[[],[],[]];
  const checkout=estadias.map(x=>x.checkout_realizado_en).filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)||null;
  return {servicio,reserva,estadia,catalogo,checkout,cargos:ordenar(cargos),estados:ordenar(estados,'cargo_id'),
   aplicaciones:ordenar(aplicaciones),ajustes:ordenar(ajustes),pagos:ordenar(pagos),reloj};
 }
 function estadoEsperado(l){
  return {version:1,servicio:l.servicio,reserva:l.reserva,estadia:l.estadia,catalogo:l.catalogo,
   checkout_realizado_en:l.checkout,cargos:l.cargos,
   finanzas:l.estados.map(x=>({cargo_id:x.cargo_id,estado:x.estado,monto:x.monto,
    monto_ajustado:x.monto_ajustado,aplicado_neto:x.aplicado_neto,saldo_cargo:x.saldo_cargo,
    estado_pago:x.estado_pago??null,ajuste_neto:x.ajuste_neto??null})),
   aplicaciones:l.aplicaciones,pagos:l.pagos,ajustes:l.ajustes};
 }
 function evaluarElegibilidad(l,{manual=false}={}){
  const s=l.servicio,r=l.reserva,e=l.estadia,cat=l.catalogo,razones=[];
  if(s.estado_servicio==='realizado')return {estado:'already_realized',elegible:false,razones:[]};
  if(!['programado','en_proceso'].includes(s.estado_servicio))razones.push('El estado operativo requiere revisión.');
  if(!['pendiente','confirmada','hospedada'].includes(r.estado_reserva)||l.checkout!=null)
   razones.push('La reserva cerró o ya realizó check-out.');
  if(r.bove_checkout!=null||r.bove_cierre!=null)razones.push('Existe BOVE de check-out o cierre.');
  if(s.reserva_id!==r.id||s.estadia_id!==e.id||e.reserva_id!==r.id||
     !['pendiente','confirmada','hospedada'].includes(e.estado_estadia)||e.checkout_realizado_en!=null)
   razones.push('La estadía requiere revisión.');
  if(cat.id!==s.catalogo_servicio_id||cat.activo!==true)razones.push('El catálogo requiere revisión.');
  if(s.hora_inicio&&s.hora_fin&&s.hora_fin<=s.hora_inicio)razones.push('El horario del servicio requiere revisión.');
  const tiempo=l.reloj?formatoChile(l.reloj):null;
  if(manual){
   // El RPC comprueba now() en la transacción. Si el GET no expone Date,
   // la acción manual puede llegar al RPC; Haku conserva su bloqueo preventivo.
   if(!s.fecha_servicio)razones.push('Falta la fecha del servicio.');
   else if(tiempo&&s.fecha_servicio>tiempo.dia)razones.push('La fecha del servicio es futura.');
   else if(tiempo&&s.fecha_servicio===tiempo.dia&&
      (!s.hora_fin||hora(s.hora_fin)>tiempo.hora))
    razones.push('El horario del servicio aún no termina.');
   if(s.estado_servicio==='en_proceso'&&!s.hora_fin)
    razones.push('Falta la hora de término del servicio en proceso.');
  }else if(!tiempo||!s.fecha_servicio||s.fecha_servicio>tiempo.dia||
     (s.fecha_servicio===tiempo.dia&&(!s.hora_fin||hora(s.hora_fin)>tiempo.hora))||
     (s.estado_servicio==='en_proceso'&&!s.hora_fin))
   razones.push('No pude verificar con la hora del servidor Supabase que el servicio ya terminó.');
  if(l.ajustes.length)razones.push('Existen ajustes históricos.');
  if(l.cargos.some(x=>x.reserva_id!==s.reserva_id||x.estadia_id!==s.estadia_id||x.servicio_id!==s.id||
      x.tipo_cargo!=='servicio'||x.estadia_noche_id!=null||!['activo','anulado'].includes(x.estado)))
   razones.push('El historial de cargos requiere revisión.');
  const activos=l.cargos.filter(x=>x.estado==='activo');
  if(s.tipo_cobro==='normal'){
   const cargo=activos.length===1?activos[0]:null,vista=cargo?l.estados.find(x=>x.cargo_id===cargo.id):null;
   if(!(num(s.total)>0)||!cargo||num(cargo.monto)!==num(s.total)||cargo.concepto!==cat.nombre||cargo.moneda!=='CLP'||
      l.aplicaciones.some(x=>x.cargo_id!==cargo?.id)||
      (!manual&&(l.estados.length!==l.cargos.length||
       l.estados.some(x=>!l.cargos.some(y=>y.id===x.cargo_id))))||!vista||
      num(vista.aplicado_neto)==null||num(vista.aplicado_neto)<0||num(vista.aplicado_neto)>num(cargo?.monto)||
      num(vista.monto_ajustado)!==num(cargo?.monto)||num(vista.saldo_cargo)!==num(cargo?.monto)-num(vista.aplicado_neto))
    razones.push('El cargo o su saldo requiere revisión.');
   if(l.aplicaciones.some(a=>{
    const p=l.pagos.find(x=>x.id===a.pago_id);
    return !p||p.reserva_id!==s.reserva_id||p.estado!=='confirmado'||!['pago','devolucion'].includes(p.tipo_movimiento)||!(num(a.monto_aplicado)>0);
   }))razones.push('Las aplicaciones de pago requieren revisión.');
  }else if(s.tipo_cobro==='cortesia'){
   if(num(s.total)!==0||!String(s.motivo_cortesia||'').trim()||activos.length||l.aplicaciones.length)
    razones.push('La cortesía o sus finanzas requieren revisión.');
  }else razones.push('El tipo de cobro requiere revisión.');
  return {estado:razones.length?'bloqueada':'elegible',elegible:!razones.length,razones};
 }
 function finanzasVisuales(l){
  const s=l.servicio;
  if(s.tipo_cobro==='cortesia')return {titulo:'Cortesía · $0',detalle:'Sin cargo activo',explicacion:'El estado financiero no cambiará.'};
  const cargo=l.cargos.find(x=>x.estado==='activo'),vista=l.estados.find(x=>x.cargo_id===cargo?.id),saldo=num(vista?.saldo_cargo)||0;
  if(saldo===0)return {titulo:`Cobro normal · ${dinero(s.total)}`,detalle:'Pagado · saldo $0',
   explicacion:'El servicio ya está pagado. Marcarlo realizado no modificará sus pagos ni aplicaciones.'};
  const parcial=(num(vista?.aplicado_neto)||0)>0;
  return {titulo:`Cobro normal · ${dinero(s.total)}`,detalle:parcial?`Pagado parcialmente · saldo pendiente ${dinero(saldo)}`:
   `Pendiente de pago · ${dinero(saldo)}`,explicacion:parcial?'El saldo pendiente no cambiará.':
    `El estado financiero no cambiará. El cargo seguirá pendiente por ${dinero(saldo)}.`};
 }
 async function preparar(texto,opciones={}){
  const manual=opciones.modoManual===true;
  const q=typeof texto==='string'?interpretar(texto,{diaActual:opciones.diaActual}):texto;
  if(!q)return {estado:'no_aplica'};
  if(q.errores?.length)return {estado:'incompleta',consulta:q,
   mensaje:`Entendí que quieres marcar un servicio como realizado, pero necesito identificarlo mejor. ${q.errores.join(' ')}`};
  const permiso=opciones.permiso||(()=>root.haikuTienePermiso?.('servicios.editar')===true);
  if(!permiso())return {estado:'bloqueada',consulta:q,mensaje:'No tienes el permiso servicios.editar.'};
  const cliente=opciones.cliente||root.haikuSupabase,buscar=opciones.buscar||cancelacion.buscarServicios,
   cargar=opciones.cargarEstado||cargarEstado,leerTiempo=opciones.leerTiempo||leerReloj;
  try{
   const candidatos=await buscar(q,{cliente});
   if(!candidatos.length)return {estado:'no_encontrado',consulta:q,mensaje:manual?
    'No se encontró el servicio seleccionado.':'No encontré un servicio persistido que coincida con esos datos.'};
   if(candidatos.length>1)return {estado:'multiples',consulta:q,candidatos,
    mensaje:`Encontré ${candidatos.length} servicios. Indica fecha, hora, tipo o cabaña para identificar uno solo.`};
   const encontrado=candidatos[0],lectura=await cargar(encontrado,{cliente,leerTiempo});
   if(lectura.servicio.id!==encontrado.id||lectura.servicio.actualizado_en!==encontrado.actualizado_en)
    throw Error('El servicio cambió durante la lectura; prepara una propuesta nueva.');
   const candidato={...encontrado,...lectura.servicio,reserva:lectura.reserva,catalogo:lectura.catalogo};
   const evaluacion=evaluarElegibilidad(lectura,{manual});
   if(evaluacion.estado==='already_realized')return {estado:'already_realized',consulta:q,candidato,
    mensaje:'Este servicio ya está marcado como realizado.'};
   if(!evaluacion.elegible)return {estado:'bloqueada',consulta:q,candidato,evaluacion,lectura,
    mensaje:manual?'No se puede marcar este servicio como realizado.':
     'No puedo marcar automáticamente este servicio como realizado. Requiere revisión.'};
   const esperado=estadoEsperado(lectura),p={estado:'propuesta',consulta:q,candidato,lectura,
    p_estado_esperado:esperado,mensaje:'Propuesta preparada. Proyecto H no ha cambiado.'};
   propuestas.set(p,{consulta:q,servicioId:candidato.id,cliente,buscar,cargar,leerTiempo,permiso,manual,
    snapshot:JSON.stringify(esperado),lecturaInicial:lectura,candidatoInicial:candidato,
    invalidada:false,enCurso:null,operationId:null,payload:null,resultado:null,
    rpcRespondioExito:false,rpcAlreadyRealized:false});
   return p;
  }catch(error){return {estado:'bloqueada',consulta:q,mensaje:manual?
   `No se pudo completar la lectura de Proyecto H. ${error?.message||error}`:
   `No pude completar la lectura de Proyecto H. ${error?.message||error}`};}
 }
 async function buscarServicioExacto(q,{cliente}){
  return filas(()=>cliente.from('servicios')
   .select('id,reserva_id,estadia_id,catalogo_servicio_id,actualizado_en')
   .eq('id',q.servicio_id));
 }
 function prepararManual(servicioId,opciones={}){
  return preparar({intencion:INTENCION,servicio_id:servicioId,errores:[]},
   {...opciones,modoManual:true,buscar:buscarServicioExacto});
 }
 async function releer(o){
  const candidatos=await o.buscar(o.consulta,{cliente:o.cliente});
  if(candidatos.length!==1||candidatos[0].id!==o.servicioId)return null;
  const lectura=await o.cargar(candidatos[0],{cliente:o.cliente,leerTiempo:o.leerTiempo});
  if(lectura.servicio.id!==o.servicioId)return null;
  return {candidato:{...candidatos[0],...lectura.servicio,reserva:lectura.reserva,catalogo:lectura.catalogo},
   lectura,snapshot:JSON.stringify(estadoEsperado(lectura))};
 }
 const coincidePropuesta=(o,actual)=>actual&&evaluarElegibilidad(actual.lectura,{manual:o.manual}).elegible&&
  actual.snapshot===o.snapshot;
 async function obsoleta(o,mensaje='El servicio, la reserva o las finanzas cambiaron. Preparé una nueva evaluación.'){
  o.invalidada=true;
  const nueva=await preparar(o.consulta,{cliente:o.cliente,buscar:o.buscar,cargarEstado:o.cargar,
   leerTiempo:o.leerTiempo,permiso:o.permiso,modoManual:o.manual});
  return {estado:'obsoleta',mensaje:o.manual?
   'El servicio, la reserva o las finanzas cambiaron. Revisa el estado actual antes de continuar.':mensaje,nueva};
 }
 function errorRpc(error){
  const codigo=String(error?.code||''),mensaje=String(error?.message||error||'');
  if(codigo==='40001'||/obsoleta|estado esperado|propuesta nueva|cambió la reserva/i.test(mensaje))return 'stale';
  if(codigo==='42501'||/permiso|iniciar sesión|usuario no activo/i.test(mensaje))return 'sin_permiso';
  if(/BOVE|check.?out|requiere revisión|estado operativo|estadía|catálogo|horario|fecha futura|ajustes|aplicaciones|pagos|cargo|saldo|finanzas/i.test(mensaje))return 'revision_humana';
  return 'incierto';
 }
 function mismaFila(a,b,ignorar=[]){
  if(!a||!b)return false;
  const omitir=new Set(ignorar);
  return JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k])=>!omitir.has(k))))===
   JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k])=>!omitir.has(k))));
 }
 async function verificarCambio(o,actual){
  if(!actual||!o.payload)return false;
  const antes=o.lecturaInicial,despues=actual.lectura;
  if(despues.servicio.id!==o.servicioId||despues.servicio.estado_servicio!=='realizado'||
     !mismaFila(antes.servicio,despues.servicio,['estado_servicio','actualizado_en'])||
     !mismaFila(antes.reserva,despues.reserva)||!mismaFila(antes.estadia,despues.estadia)||
     !mismaFila(antes.catalogo,despues.catalogo)||antes.checkout!==despues.checkout||
     antes.cargos.length!==despues.cargos.length||
     !mismaFila(antes.pagos,despues.pagos)||!mismaFila(antes.aplicaciones,despues.aplicaciones)||
     !mismaFila(antes.ajustes,despues.ajustes)||!mismaFila(antes.estados,despues.estados))return false;
  for(let i=0;i<antes.cargos.length;i++){
   const inicial=antes.cargos[i],final=despues.cargos[i];
   if(!mismaFila(inicial,final,inicial.estado==='activo'?['actualizado_en']:[]))return false;
  }
  const eventos=await filas(()=>o.cliente.from('eventos_auditoria')
   .select('id,entidad_tipo,entidad_id,reserva_id,usuario_id,origen,cambios,datos_contexto')
   .eq('entidad_id',o.servicioId).order('id'));
  return eventos.filter(e=>e.entidad_tipo==='servicios'&&e.entidad_id===o.servicioId&&
   e.reserva_id===despues.servicio.reserva_id&&e.usuario_id&&e.origen==='haku'&&
   e.datos_contexto?.operacion_id===o.operationId&&Array.isArray(e.cambios)&&
   e.cambios.some(x=>x.campo==='estado_servicio'&&x.anterior===antes.servicio.estado_servicio&&
    x.nuevo==='realizado')).length===1;
 }
 function resultadoExito(o,actual,origen){
  const l=actual.lectura,resultado={estado:'realizado',mensaje:'Servicio marcado como realizado y verificado.',
   candidato:actual.candidato,lectura:l,estado_anterior:o.lecturaInicial.servicio.estado_servicio,
   operation_id:o.operationId,origen};
  o.resultado=resultado;
  if(root.document&&root.CustomEvent)root.document.dispatchEvent(new root.CustomEvent('haiku:servicio-supabase-cambiado',
   {detail:{servicioId:o.servicioId,reservaId:l.servicio.reserva_id}}));
  return resultado;
 }
 async function verificarEstado(p){
  const o=propuestas.get(p);
  if(!o?.payload)return {estado:'bloqueada',mensaje:'No hay una operación pendiente para comprobar.'};
  if(o.resultado)return o.resultado;
  try{
   const actual=await releer(o);
   if(await verificarCambio(o,actual))return resultadoExito(o,actual,'relectura');
   if(o.rpcAlreadyRealized)return actual?.lectura.servicio.estado_servicio==='realizado'
    ?{estado:'already_realized',mensaje:'Este servicio ya estaba realizado. No se hizo otra modificación.'}
    :{estado:'sincronizando',mensaje:'El RPC informó que el servicio ya estaba realizado. Sólo volveré a leer.',propuesta:p};
   if(coincidePropuesta(o,actual))return o.rpcRespondioExito
    ?{estado:'sincronizando',mensaje:'El RPC respondió correctamente. Sólo volveré a leer; no repetiré la escritura.',propuesta:p}
    :{estado:'reintento_seguro',mensaje:'La lectura confirma el estado anterior. Puedes reintentar la misma operación.',propuesta:p,operation_id:o.operationId};
   if(o.rpcRespondioExito)return {estado:'sincronizando',mensaje:'El cambio aún no se puede acreditar por lectura. Sólo volveré a leer.',propuesta:p};
   return {estado:'revision_humana',mensaje:'El servicio o sus finanzas cambiaron. Requiere revisión antes de otra operación.'};
  }catch(_){return {estado:'incierto',mensaje:'No pude comprobar el estado real. Sólo se permite volver a leer; no repetiré el RPC automáticamente.',propuesta:p};}
 }
 async function confirmarInterno(p,o,opciones){
  if(!RPC_REALIZADO_PRODUCCION_HABILITADO)return {estado:'bloqueada',mensaje:'El cambio real sigue bloqueado.'};
  if(o.resultado)return o.resultado;
  if(o.invalidada)return {estado:'obsoleta',mensaje:'Esta propuesta ya fue invalidada. Prepara una nueva.'};
  if(!o.permiso())return {estado:'sin_permiso',mensaje:'No tienes el permiso servicios.editar.'};
  opciones.onEstado?.('Revalidando servicio, reserva, finanzas y tiempo…');
  let actual;
  try{actual=await releer(o);}catch(error){return o.payload
   ?{estado:'incierto',mensaje:'No pude comprobar el estado real. Sólo volveré a leer antes de considerar un reintento.',propuesta:p}
    :{estado:'bloqueada',mensaje:o.manual?
      `No se pudo revalidar el servicio. ${error?.message||error}`:
      `No pude revalidar la propuesta. ${error?.message||error}`};}
  if(o.payload){
   try{if(await verificarCambio(o,actual))return resultadoExito(o,actual,'relectura');}
   catch(_){return {estado:'incierto',mensaje:'No pude acreditar la operación por lectura. Sólo volveré a leer.',propuesta:p};}
  }
  if(!coincidePropuesta(o,actual))return o.payload?verificarEstado(p):obsoleta(o);
  if(o.rpcAlreadyRealized)return verificarEstado(p);
  if(o.rpcRespondioExito)return {estado:'sincronizando',mensaje:'El RPC ya respondió correctamente. Sólo volveré a leer el resultado.',propuesta:p};
  if(!o.payload){
   const id=opciones.operationId||root.crypto?.randomUUID?.();
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||''))
    return {estado:'bloqueada',mensaje:'No se pudo generar un operation_id válido.'};
   o.operationId=id;
   o.payload=Object.freeze({p_operacion_id:id,p_servicio_id:o.servicioId,p_estado_esperado:JSON.parse(o.snapshot)});
  }
  opciones.onEstado?.('Marcando servicio como realizado…');
  let respuesta,error;
  try{({data:respuesta,error}=await o.cliente.rpc(RPC,o.payload));}catch(e){error=e;}
  if(error){
   const clase=errorRpc(error);
   if(clase==='stale')return obsoleta(o);
   if(clase==='sin_permiso'){o.invalidada=true;return {estado:'sin_permiso',mensaje:'No tienes permiso para modificar este servicio.'};}
   if(clase==='revision_humana'){o.invalidada=true;return {estado:'revision_humana',mensaje:o.manual?
    `No se puede marcar este servicio como realizado. ${error?.message||error}`:
    'El servicio requiere revisión humana. No se realizó otro intento.'};}
   return verificarEstado(p);
  }
  if(respuesta?.estado==='already_realized'&&respuesta.ok===true&&
     respuesta.servicio_id===o.servicioId&&respuesta.operacion_id===o.operationId){
   o.rpcAlreadyRealized=true;return verificarEstado(p);
  }
  if(!respuesta||respuesta.ok!==true||respuesta.estado!=='realized'||
     respuesta.servicio_id!==o.servicioId||respuesta.operacion_id!==o.operationId||
     respuesta.estado_servicio!=='realizado'||respuesta.tipo_cobro!==o.lecturaInicial.servicio.tipo_cobro||
     num(respuesta.total)!==num(o.lecturaInicial.servicio.total))return verificarEstado(p);
  o.rpcRespondioExito=true;
  let observado=await verificarEstado(p);
  if(['sincronizando','incierto'].includes(observado.estado))for(let intento=0;intento<2;intento++){
   await new Promise(resolver=>setTimeout(resolver,300));
   observado=await verificarEstado(p);
   if(['realizado','revision_humana'].includes(observado.estado))return observado;
  }
  return observado.estado==='incierto'
   ?{estado:'sincronizando',mensaje:'El RPC respondió correctamente; sólo volveré a leer antes de acreditar el cambio.',propuesta:p}
   :observado;
 }
 function confirmar(p,opciones={}){
  const o=propuestas.get(p);
  if(!o)return Promise.resolve({estado:'bloqueada',mensaje:'Prepara una propuesta nueva antes de confirmar.'});
  if(o.enCurso)return o.enCurso;
  const tarea=confirmarInterno(p,o,opciones);o.enCurso=tarea;
  void tarea.then(()=>{o.enCurso=null;},()=>{o.enCurso=null;});
  return tarea;
 }
 function resumen(c){return `${c.reserva?.titular_nombre||'Titular'} · CAB ${c.cabana_numero??'—'} · ${c.catalogo?.nombre||'Servicio'} · ${fecha(c.fecha_servicio)} · ${hora(c.hora_inicio)||'sin hora'}`;}
 function cabecera(c){return `<header class="haku-servicio-cortesia-cabecera"><span class="haku-servicio-cortesia-sello">Marcar servicio como realizado</span><strong class="haku-servicio-cortesia-titular">${esc(c.reserva?.titular_nombre)} · CAB ${esc(c.cabana_numero??'—')}</strong><span class="haku-servicio-cortesia-nombre">${esc(c.catalogo?.nombre)}</span><span class="haku-servicio-cortesia-fecha">${esc(fecha(c.fecha_servicio))} · ${esc(hora(c.hora_inicio)||'sin hora')}${c.hora_fin?`–${esc(hora(c.hora_fin))}`:''}</span></header>`;}
 function renderizar(p){
  if(p.estado==='multiples')return `<article class="haku-servicio-cortesia"><h3>Servicios coincidentes</h3><p>${esc(p.mensaje)}</p><ol>${p.candidatos.map(c=>`<li>${esc(resumen(c))}</li>`).join('')}</ol><p>Indica cuál deseas marcar como realizado.</p></article>`;
  if(p.estado==='obsoleta')return `<article class="haku-servicio-cortesia"><h3>Propuesta obsoleta</h3><p>${esc(p.mensaje)}</p></article>${p.nueva?renderizar(p.nueva):''}`;
  if(p.estado==='already_realized')return `<article class="haku-servicio-cortesia">${cabecera(p.candidato)}<p>${esc(p.mensaje)}</p></article>`;
  if(p.estado==='bloqueada'&&p.candidato)return `<article class="haku-servicio-cortesia haku-servicio-cortesia--bloqueada">${cabecera(p.candidato)}<p class="haku-servicio-cortesia-etiqueta">Requiere revisión</p><p>${esc(p.mensaje)}</p><ul>${p.evaluacion.razones.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></article>`;
  if(p.estado==='realizado'){
   const f=finanzasVisuales(p.lectura);
   return `<article class="haku-servicio-cortesia haku-servicio-cortesia--realizado">${cabecera(p.candidato)}
    <h3>✓ Servicio marcado como realizado</h3>
    <div class="haku-servicio-cortesia-comparacion"><div><span>Antes</span><strong>${esc(etiquetaEstado(p.estado_anterior))}</strong></div><span class="haku-servicio-cortesia-flecha">→</span><div><span>Ahora</span><strong>Realizado</strong></div></div>
    <h3>Estado financiero</h3><p><strong>${esc(f.titulo)}</strong><br>${esc(f.detalle)}</p>
    <p class="haku-servicio-cortesia-efecto">${p.candidato.tipo_cobro==='cortesia'?'La cortesía sigue en $0.':'El cargo sigue activo y su saldo intacto.'} No se modificaron pagos ni aplicaciones.</p></article>`;
  }
  if(p.estado==='revision_humana')return `<article class="haku-servicio-cortesia haku-servicio-cortesia--bloqueada"><h3>Requiere revisión</h3><p>${esc(p.mensaje)}</p></article>`;
  if(['sincronizando','incierto','reintento_seguro'].includes(p.estado))return `<article class="haku-servicio-cortesia"><h3>${p.estado==='reintento_seguro'?'Reintento disponible':'Comprobando cambio'}</h3><p>${esc(p.mensaje)}</p><div class="haku-servicio-cortesia-acciones">${p.estado==='reintento_seguro'?'<button type="button" data-servicio-realizado-reintentar>Reintentar misma operación</button>':'<button type="button" data-servicio-realizado-releer>Comprobar estado</button>'}</div></article>`;
  if(p.estado!=='propuesta')return `<article class="haku-servicio-cortesia"><h3>Cambio de servicio</h3><p>${esc(p.mensaje)}</p></article>`;
  const c=p.candidato,l=p.lectura||null,f=l?finanzasVisuales(l):null;
  return `<article class="haku-servicio-cortesia haku-servicio-cortesia--propuesta">${cabecera(c)}
   <h3>Estado operativo</h3><div class="haku-servicio-cortesia-comparacion"><div><span>Antes</span><strong>${esc(etiquetaEstado(c.estado_servicio))}</strong></div><span class="haku-servicio-cortesia-flecha">→</span><div><span>Después</span><strong>Realizado</strong></div></div>
   <h3>Estado financiero</h3><p><strong>${esc(f?.titulo)}</strong><br>${esc(f?.detalle)}</p><p class="haku-servicio-cortesia-efecto">${esc(f?.explicacion)}</p>
   <p class="haku-servicio-cortesia-confirmacion">Al confirmar, Proyecto H marcará este servicio como realizado. El estado financiero no cambiará.</p><p data-servicio-realizado-estado></p><div class="haku-servicio-cortesia-acciones"><button type="button" data-servicio-realizado-confirmar>Confirmar cambio</button><button type="button" data-servicio-realizado-cancelar>Cancelar</button></div></article>`;
 }
 function instalar(){
  const doc=root.document,style=doc.createElement('style');
  style.textContent='.haku-servicio-cortesia button[data-servicio-realizado-confirmar]:not(:disabled){border-color:#1f6e4c;background:#1f6e4c;color:#fff}.haku-servicio-cortesia button[data-servicio-realizado-confirmar]:not(:disabled):hover{background:#174f39}';
  doc.head.appendChild(style);
  let ocupado=false;
  async function procesar(texto,campo,mensajes){
   if(ocupado)return;ocupado=true;campo.value='';campo.dispatchEvent(new root.Event('input',{bubbles:true}));
   const u=doc.createElement('div');u.className='haiku-asistente-mensaje haiku-asistente-mensaje--usuario';u.textContent=texto;mensajes.appendChild(u);
   const el=doc.createElement('div');el.className='haiku-asistente-mensaje haiku-asistente-mensaje--asistente';el.textContent='Buscando el servicio en Proyecto H…';mensajes.appendChild(el);
   let p;try{p=await preparar(texto);el.innerHTML=renderizar(p);}catch(error){el.textContent=`No pude leer el servicio. ${error?.message||error}`;}finally{ocupado=false;mensajes.scrollTop=mensajes.scrollHeight;}
   el.addEventListener('click',async e=>{const b=e.target?.closest?.('button');if(!b)return;e.preventDefault();e.stopPropagation();
    if(b.hasAttribute('data-servicio-realizado-cancelar')){p={estado:'cancelada',mensaje:'Cancelé la propuesta. No se modificó Proyecto H.'};el.innerHTML=renderizar(p);return;}
    const confirma=b.hasAttribute('data-servicio-realizado-confirmar')&&p?.estado==='propuesta';
    const reintenta=b.hasAttribute('data-servicio-realizado-reintentar')&&p?.estado==='reintento_seguro';
    const relee=b.hasAttribute('data-servicio-realizado-releer')&&['sincronizando','incierto'].includes(p?.estado);
    if(!confirma&&!reintenta&&!relee||b.disabled)return;
    b.disabled=true;const propuesta=p.propuesta||p;
    try{p=relee?await verificarEstado(propuesta):await confirmar(propuesta,{onEstado:estado=>{
     const x=el.querySelector('[data-servicio-realizado-estado]');if(x)x.textContent=estado;}});}
    catch(_){p={estado:'incierto',mensaje:'No pude comprobar el resultado. Sólo volveré a leer antes de otro intento.',propuesta};}
    el.innerHTML=renderizar(p);if(p.estado==='obsoleta'&&p.nueva)p=p.nueva;
   });
  }
  function interceptar(e){
   const campo=doc.getElementById('haiku-asistente-texto'),mensajes=doc.getElementById('haiku-asistente-mensajes');if(!campo||!mensajes)return;
   if(e.type==='click'?!e.target?.closest?.('#haiku-asistente-enviar'):e.target!==campo)return;
   if(e.type==='keydown'&&(e.key!=='Enter'||e.shiftKey||e.isComposing))return;
   if(doc.getElementById('haiku-asistente-adjuntos')?.querySelector('.haiku-asistente-adjunto'))return;
   const texto=campo.value.trim();if(!interpretar(texto))return;
   e.preventDefault();e.stopImmediatePropagation();void procesar(texto,campo,mensajes);
  }
  root.addEventListener('click',interceptar,true);root.addEventListener('keydown',interceptar,true);
 }
 const api=Object.freeze({RPC_REALIZADO_PRODUCCION_HABILITADO,interpretar,leerReloj,cargarEstado,estadoEsperado,
  evaluarElegibilidad,finanzasVisuales,preparar,prepararManual,confirmar,verificarEstado,renderizar});
 root.HAIKU_ASISTENTE_SERVICIOS_REALIZADO_V1=api;
 if(typeof module!=='undefined')module.exports=api;
 if(root.document)instalar();
})(typeof window!=='undefined'?window:globalThis);
