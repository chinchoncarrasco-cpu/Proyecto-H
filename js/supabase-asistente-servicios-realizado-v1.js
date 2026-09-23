/* Haku · marcar un servicio persistido como realizado · C2: sólo simulación. */
(function(root){
 'use strict';
 if(root.HAIKU_ASISTENTE_SERVICIOS_REALIZADO_V1)return;
 const base=root.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1||
  (typeof require==='function'?require('./supabase-asistente-servicios-cortesia-v1.js'):null);
 const cancelacion=root.HAIKU_ASISTENTE_SERVICIOS_CANCELACION_V1||
  (typeof require==='function'?require('./supabase-asistente-servicios-cancelacion-v1.js'):null);
 const INTENCION='MARCAR_SERVICIO_REALIZADO';
 const RPC='haiku_marcar_servicio_realizado_asistente_v1';
 const RPC_REALIZADO_PRODUCCION_HABILITADO=false;
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
 function evaluarElegibilidad(l){
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
  if(!tiempo||!s.fecha_servicio||s.fecha_servicio>tiempo.dia||
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
      l.aplicaciones.some(x=>x.cargo_id!==cargo?.id)||l.estados.length!==l.cargos.length||
      l.estados.some(x=>!l.cargos.some(y=>y.id===x.cargo_id))||!vista||
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
   if(!candidatos.length)return {estado:'no_encontrado',consulta:q,mensaje:'No encontré un servicio persistido que coincida con esos datos.'};
   if(candidatos.length>1)return {estado:'multiples',consulta:q,candidatos,
    mensaje:`Encontré ${candidatos.length} servicios. Indica fecha, hora, tipo o cabaña para identificar uno solo.`};
   const encontrado=candidatos[0],lectura=await cargar(encontrado,{cliente,leerTiempo});
   if(lectura.servicio.id!==encontrado.id||lectura.servicio.actualizado_en!==encontrado.actualizado_en)
    throw Error('El servicio cambió durante la lectura; prepara una propuesta nueva.');
   const candidato={...encontrado,...lectura.servicio,reserva:lectura.reserva,catalogo:lectura.catalogo};
   const evaluacion=evaluarElegibilidad(lectura);
   if(evaluacion.estado==='already_realized')return {estado:'already_realized',consulta:q,candidato,
    mensaje:'Este servicio ya está marcado como realizado.'};
   if(!evaluacion.elegible)return {estado:'bloqueada',consulta:q,candidato,evaluacion,lectura,
    mensaje:'No puedo marcar automáticamente este servicio como realizado. Requiere revisión.'};
   const esperado=estadoEsperado(lectura),p={estado:'propuesta',consulta:q,candidato,lectura,
    p_estado_esperado:esperado,mensaje:'Propuesta preparada. Proyecto H no ha cambiado.'};
   propuestas.set(p,{consulta:q,servicioId:candidato.id,cliente,buscar,cargar,leerTiempo,permiso,
    snapshot:JSON.stringify(esperado),reloj:lectura.reloj,invalidada:false,enCurso:null,operationId:null,payload:null,resultado:null});
   return p;
  }catch(error){return {estado:'bloqueada',consulta:q,mensaje:`No pude completar la lectura de Proyecto H. ${error?.message||error}`};}
 }
 async function confirmarInterno(p,o,opciones){
  if(RPC_REALIZADO_PRODUCCION_HABILITADO)throw Error('Esta versión sólo implementa la simulación.');
  if(o.invalidada)return {estado:'obsoleta',mensaje:'Esta propuesta ya fue invalidada. Prepara una nueva.'};
  if(o.resultado)return o.resultado;
  if(!o.permiso())return {estado:'bloqueada',mensaje:'No tienes el permiso servicios.editar.'};
  try{
   opciones.onEstado?.('Revalidando servicio, reserva, finanzas y tiempo…');
   const candidatos=await o.buscar(o.consulta,{cliente:o.cliente});
   if(candidatos.length!==1||candidatos[0].id!==o.servicioId){o.invalidada=true;
    return {estado:'obsoleta',mensaje:'La identificación del servicio cambió.',
     nueva:await preparar(o.consulta,{cliente:o.cliente,buscar:o.buscar,cargarEstado:o.cargar,leerTiempo:o.leerTiempo,permiso:o.permiso})};}
   const actual=await o.cargar(candidatos[0],{cliente:o.cliente,leerTiempo:o.leerTiempo});
   if(!evaluarElegibilidad(actual).elegible||JSON.stringify(estadoEsperado(actual))!==o.snapshot){
    o.invalidada=true;
    return {estado:'obsoleta',mensaje:'El servicio, la reserva o las finanzas cambiaron.',
     nueva:await preparar(o.consulta,{cliente:o.cliente,buscar:o.buscar,cargarEstado:o.cargar,leerTiempo:o.leerTiempo,permiso:o.permiso})};
   }
   if(!o.payload){
    const id=opciones.operationId||root.crypto?.randomUUID?.();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||''))
     return {estado:'bloqueada',mensaje:'No se pudo generar un operation_id válido.'};
    o.operationId=id;
    o.payload=Object.freeze({p_operacion_id:id,p_servicio_id:o.servicioId,p_estado_esperado:JSON.parse(o.snapshot)});
   }
   o.resultado={estado:'simulada',mensaje:'Confirmación simulada. No se llamó al RPC ni se modificó Proyecto H.',
    rpc:RPC,operation_id:o.operationId,payload:o.payload,candidato:p.candidato,lectura:p.lectura};
   return o.resultado;
  }catch(error){return {estado:'bloqueada',mensaje:`No pude revalidar la propuesta. ${error?.message||error}`};}
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
  if(!['propuesta','simulada'].includes(p.estado))return `<article class="haku-servicio-cortesia"><h3>Cambio de servicio</h3><p>${esc(p.mensaje)}</p></article>`;
  const c=p.candidato,l=p.lectura||null,f=l?finanzasVisuales(l):null;
  return `<article class="haku-servicio-cortesia haku-servicio-cortesia--propuesta">${cabecera(c)}
   <h3>Estado operativo</h3><div class="haku-servicio-cortesia-comparacion"><div><span>Antes</span><strong>${esc(etiquetaEstado(c.estado_servicio))}</strong></div><span class="haku-servicio-cortesia-flecha">→</span><div><span>Después</span><strong>Realizado</strong></div></div>
   <h3>Estado financiero</h3><p><strong>${esc(f?.titulo)}</strong><br>${esc(f?.detalle)}</p><p class="haku-servicio-cortesia-efecto">${esc(f?.explicacion)}</p>
   ${p.estado==='propuesta'?`<p class="haku-servicio-cortesia-confirmacion">Confirmar sólo revalidará y preparará el RPC. En esta etapa no modificará Proyecto H.</p><p data-servicio-realizado-estado></p><div class="haku-servicio-cortesia-acciones"><button type="button" data-servicio-realizado-confirmar>Confirmar cambio · simulación</button><button type="button" data-servicio-realizado-cancelar>Cancelar</button></div>`:
    `<p class="haku-servicio-cortesia-confirmacion">${esc(p.mensaje)}</p><p><strong>RPC preparado:</strong> ${esc(p.rpc)}<br><strong>operation_id:</strong> ${esc(p.operation_id)}</p><details><summary>Payload preparado</summary><pre>${esc(JSON.stringify(p.payload,null,2))}</pre></details>`}</article>`;
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
    if(!b.hasAttribute('data-servicio-realizado-confirmar')||b.disabled||p?.estado!=='propuesta')return;
    b.disabled=true;try{p=await confirmar(p,{onEstado:estado=>{const x=el.querySelector('[data-servicio-realizado-estado]');if(x)x.textContent=estado;}});}catch(error){p={estado:'bloqueada',mensaje:`No pude revalidar. ${error?.message||error}`};}
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
  evaluarElegibilidad,finanzasVisuales,preparar,confirmar,renderizar});
 root.HAIKU_ASISTENTE_SERVICIOS_REALIZADO_V1=api;
 if(typeof module!=='undefined')module.exports=api;
 if(root.document)instalar();
})(typeof window!=='undefined'?window:globalThis);
