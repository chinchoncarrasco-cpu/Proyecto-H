/* Haku · reactivación de servicios persistidos · C2: sólo simulación. */
(function(root){
 'use strict';
 if(root.HAIKU_ASISTENTE_SERVICIOS_REACTIVACION_V1)return;
 const autoridad=root.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1||
  (typeof require==='function'?require('./supabase-asistente-servicios-cortesia-v1.js'):null);
 const cancelacion=root.HAIKU_ASISTENTE_SERVICIOS_CANCELACION_V1||
  (typeof require==='function'?require('./supabase-asistente-servicios-cancelacion-v1.js'):null);
 const INTENCION='REACTIVAR_SERVICIO_EXISTENTE';
 const RPC='haiku_reactivar_servicio_asistente_v1';
 const RPC_REACTIVACION_PRODUCCION_HABILITADO=false;
 const propuestas=new WeakMap();
 const numero=v=>v==null||v===''?null:Number(v);
 const hora=v=>String(v??'').match(/^(\d{1,2}):(\d{2})/)?.slice(1).map((x,i)=>i?x:x.padStart(2,'0')).join(':')||null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const dinero=v=>'$'+Number(v||0).toLocaleString('es-CL');
 const fecha=v=>String(v||'').replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3-$2-$1');
 const hoy=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

 function interpretar(texto,{diaActual=hoy()}={}){
  const original=String(texto??'').replace(/^\s*(?:asistente\s+)?haku\s*[,;:!¡¿?\-–—]*\s*/i,'');
  const t=original.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\bno\s+(?:reactives?|restaures?|vuelvas?\s+a\s+(?:activar|programar))\b/.test(t))return null;
  const verbo=/\b(?:reactiva|reactivar|reactivame|restaura|restaurar)\b/.exec(t)||
   /\bvuelve\s+a\s+(?:activar|programar)\b/.exec(t);
  if(!verbo||/\b(?:reactiva|reactivar|restaura|restaurar)\s+(?:la\s+|una\s+)?reserva\b/.test(t))return null;
  if(!/\b(?:servicio|tinaja|tonel|jacuzzi|masaje|late\s*(?:check\s*[- ]?\s*out|out)|cama|cuna)\b/.test(t))return null;
  // El intérprete de cancelación ya contiene los aliases aprobados de Servicios.
  const convertido=original.slice(0,verbo.index)+'cancela'+original.slice(verbo.index+verbo[0].length);
  const base=cancelacion.interpretar(convertido,{diaActual});
  return base?{...base,intencion:INTENCION,accion:INTENCION}:null;
 }

 async function filas(fabrica){
  const salida=[];
  for(let desde=0;;desde+=500){
   const q=fabrica(),r=typeof q.range==='function'?await q.range(desde,desde+499):await q;
   if(r?.error)throw r.error;
   const datos=Array.isArray(r?.data)?r.data:[];salida.push(...datos);
   if(datos.length<500)return salida;
  }
 }
 const unica=async fabrica=>(await filas(fabrica))[0]||null;
 function conflictos(c,servicios){
  if(!c.recurso_id||!c.fecha_servicio||!c.hora_inicio||!c.hora_fin)return [];
  return servicios.filter(s=>s.id!==c.id&&s.estado_servicio!=null&&
   !['cancelado','no_show'].includes(s.estado_servicio)&&
   s.hora_inicio<c.hora_fin&&s.hora_fin>c.hora_inicio)
   .sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 }
 async function cargarEstado(c,{cliente=root.haikuSupabase,cargarFinanzas=autoridad.cargarFinanzas}={}){
  if(!cliente?.from)throw Error('No está disponible la lectura autenticada de Proyecto H.');
  const [finanzas,reserva,estadias,catalogo,recurso,otros,pagos,auditoria]=await Promise.all([
   cargarFinanzas(c,{cliente,completo:true}),
   unica(()=>cliente.from('reservas').select('id,titular_nombre,estado_reserva,bove_checkout,bove_cierre,actualizado_en').eq('id',c.reserva_id)),
   filas(()=>cliente.from('reserva_estadias').select('id,reserva_id,estado_estadia,checkout_realizado_en').eq('reserva_id',c.reserva_id).order('id')),
   c.catalogo_servicio_id?unica(()=>cliente.from('catalogo_servicios').select('id,activo,requiere_horario').eq('id',c.catalogo_servicio_id)):null,
   c.recurso_id?unica(()=>cliente.from('recursos_servicio').select('id,activo').eq('id',c.recurso_id)):null,
   c.recurso_id&&c.fecha_servicio?filas(()=>cliente.from('servicios')
    .select('id,recurso_id,fecha_servicio,hora_inicio,hora_fin,estado_servicio,actualizado_en')
    .eq('recurso_id',c.recurso_id).eq('fecha_servicio',c.fecha_servicio).order('id')):[],
   filas(()=>cliente.from('pagos').select('*').eq('reserva_id',c.reserva_id).order('id')),
   filas(()=>cliente.from('eventos_auditoria').select('id,entidad_tipo,entidad_id,reserva_id,cambios')
    .eq('entidad_id',c.id).order('id'))
  ]);
  const estadia=estadias.find(x=>x.id===c.estadia_id)||null;
  const checkout=estadias.map(x=>x.checkout_realizado_en).filter(Boolean)
   .sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)||null;
  const disponibles=conflictos(c,otros);
  return {finanzas,reserva,estadia,checkout,catalogo,recurso,conflictos:disponibles,pagos,auditoria};
 }
 function cancelacionAuditada(c,l){
  if(!c.cancelado_en||!c.cancelado_por||!String(c.motivo_cancelacion||'').trim())return false;
  return l.auditoria.some(e=>e.entidad_tipo==='servicios'&&e.entidad_id===c.id&&
   e.reserva_id===c.reserva_id&&Array.isArray(e.cambios)&&[
    ['estado_servicio','cancelado'],['motivo_cancelacion',c.motivo_cancelacion],
    ['cancelado_por',c.cancelado_por]
   ].every(([campo,nuevo])=>e.cambios.some(x=>x.campo===campo&&x.nuevo===nuevo))&&
   e.cambios.some(x=>x.campo==='cancelado_en'&&
    Date.parse(x.nuevo)===Date.parse(c.cancelado_en)));
 }
 function estadoEsperado(c,l){
  const cargos=[...l.finanzas.cargos].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const aplicaciones=[...l.finanzas.aplicaciones].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const ajustes=[...l.finanzas.ajustes].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  return {
   version:1,servicio_id:c.id,servicio_actualizado_en:c.actualizado_en??null,
   estado_servicio:c.estado_servicio,cancelado_en:c.cancelado_en??null,
   cancelado_por:c.cancelado_por??null,motivo_cancelacion:c.motivo_cancelacion??null,
   reserva_id:c.reserva_id,estadia_id:c.estadia_id,catalogo_servicio_id:c.catalogo_servicio_id,
   catalogo_activo:l.catalogo?.activo??null,estadia_estado:l.estadia?.estado_estadia??null,
   recurso_id:c.recurso_id??null,recurso_activo:l.recurso?.activo??null,
   fecha_servicio:c.fecha_servicio,hora_inicio:c.hora_inicio??null,hora_fin:c.hora_fin??null,
   tipo_cobro:c.tipo_cobro,total:numero(c.total),
   estado_reserva:l.reserva?.estado_reserva??null,reserva_actualizado_en:l.reserva?.actualizado_en??null,
   checkout_realizado_en:l.checkout,bove_checkout:l.reserva?.bove_checkout??null,bove_cierre:l.reserva?.bove_cierre??null,
   cargos,cantidad_cargos_activos:cargos.filter(x=>x.estado==='activo').length,
   aplicaciones,ajustes,conflictos:l.conflictos.map(x=>({id:x.id,estado_servicio:x.estado_servicio,actualizado_en:x.actualizado_en}))
  };
 }
 function evaluarElegibilidad(c,l,{diaActual=hoy()}={}){
  if(c.estado_servicio==='programado')return {estado:'already_active',elegible:false,razones:[]};
  const razones=[],f=l.finanzas,cargos=f.cargos,activos=cargos.filter(x=>x.estado==='activo');
  if(c.estado_servicio!=='cancelado')razones.push('El estado operativo no permite reactivación automática.');
  else if(!cancelacionAuditada(c,l))razones.push('La cancelación anterior o su auditoría requiere revisión.');
  if(!['pendiente','confirmada','hospedada'].includes(l.reserva?.estado_reserva)||l.checkout!=null)
   razones.push('La reserva cerró o ya realizó check-out.');
  if(l.reserva?.bove_checkout!=null||l.reserva?.bove_cierre!=null)razones.push('Existe BOVE de check-out o cierre.');
  if(!l.estadia||l.estadia.reserva_id!==c.reserva_id||
     !['pendiente','confirmada','hospedada'].includes(l.estadia.estado_estadia)||l.estadia.checkout_realizado_en!=null)
   razones.push('La estadía requiere revisión.');
  if(!c.fecha_servicio||c.fecha_servicio<diaActual)razones.push('La fecha del servicio ya pasó.');
  if(!l.catalogo||l.catalogo.activo!==true)razones.push('El catálogo del servicio no está activo.');
  if(c.recurso_id&&l.recurso?.activo!==true)razones.push('El recurso del servicio no está activo.');
  if(l.catalogo?.requiere_horario===true&&
     (!c.recurso_id||!c.hora_inicio||!c.hora_fin||c.hora_fin<=c.hora_inicio))
   razones.push('El servicio requiere recurso y horario válidos.');
  if(l.conflictos.length)razones.push('El horario está ocupado por otro servicio.');
  if(activos.length)razones.push('Existe un cargo activo inesperado.');
  if(cargos.some(x=>x.servicio_id!==c.id||x.reserva_id!==c.reserva_id||x.estadia_id!==c.estadia_id||
      x.tipo_cargo!=='servicio'||x.estadia_noche_id!=null||x.estado!=='anulado'))
   razones.push('El historial de cargos requiere revisión.');
  if(f.aplicaciones.length)razones.push('Existen aplicaciones de pago históricas.');
  if(f.ajustes.length)razones.push('Existen ajustes históricos.');
  if(c.tipo_cobro==='normal'){
   if(!(numero(c.total)>0))razones.push('El total del cobro normal requiere revisión.');
  }else if(c.tipo_cobro==='cortesia'){
   if(numero(c.total)!==0||!String(c.motivo_cortesia||'').trim())razones.push('La cortesía requiere revisión.');
  }else razones.push('El tipo de cobro requiere revisión.');
  return {estado:razones.length?'bloqueada':'elegible',elegible:!razones.length,razones};
 }
 async function preparar(texto,opciones={}){
  const q=typeof texto==='string'?interpretar(texto,{diaActual:opciones.diaActual||hoy()}):texto;
  if(!q)return {estado:'no_aplica'};
  if(q.errores?.length)return {estado:'incompleta',consulta:q,
   mensaje:`Entendí que quieres reactivar un servicio, pero necesito identificarlo mejor. ${q.errores.join(' ')}`};
  const permiso=opciones.permiso||(()=>root.haikuTienePermiso?.('servicios.editar')===true);
  if(!permiso())return {estado:'bloqueada',consulta:q,mensaje:'No tienes el permiso servicios.editar.'};
  const buscar=opciones.buscar||cancelacion.buscarServicios,cargar=opciones.cargarFinanzas||autoridad.cargarFinanzas;
  const cliente=opciones.cliente||root.haikuSupabase;
  try{
   const candidatos=await buscar(q,{cliente});
   if(!candidatos.length)return {estado:'no_encontrado',consulta:q,mensaje:'No encontré un servicio persistido que coincida con esos datos.'};
   if(candidatos.length>1)return {estado:'multiples',consulta:q,candidatos,
    mensaje:`Encontré ${candidatos.length} servicios. Indica fecha, hora, tipo o cabaña para identificar uno solo.`};
   const base=candidatos[0];
   if(base.estado_servicio==='programado')return {estado:'already_active',consulta:q,candidato:base,
    mensaje:'Este servicio ya está activo/programado. No requiere reactivación.'};
   const lectura=await cargarEstado(base,{cliente,cargarFinanzas:cargar});
   const candidato={...base,reserva:lectura.reserva||base.reserva};
   const elegibilidad=evaluarElegibilidad(candidato,lectura,{diaActual:opciones.diaActual||hoy()});
   if(!elegibilidad.elegible)return {estado:'bloqueada',consulta:q,candidato,elegibilidad,
    disponibilidad:{libre:lectura.conflictos.length===0,conflictos:lectura.conflictos},
    mensaje:'No puedo reactivar automáticamente este servicio. Requiere revisión.'};
   const esperado=estadoEsperado(candidato,lectura);
   const p={estado:'propuesta',consulta:q,candidato,p_estado_esperado:esperado,
    disponibilidad:{libre:true,conflictos:[]},cargos_historicos:lectura.finanzas.cargos,
    mensaje:'Propuesta de reactivación preparada. No se ha modificado Proyecto H.'};
   propuestas.set(p,{consulta:q,servicioId:candidato.id,cliente,buscar,cargar,permiso,
    diaActual:opciones.diaActual||null,snapshot:JSON.stringify(esperado),
    evidencia:JSON.stringify({candidato,lectura}),invalidada:false,enCurso:null,resultado:null});
   return p;
  }catch(error){return {estado:'bloqueada',consulta:q,mensaje:`No pude completar la lectura de Proyecto H. ${error?.message||error}`};}
 }
 async function releer(o){
  const candidatos=await o.buscar(o.consulta,{cliente:o.cliente});
  if(candidatos.length!==1||candidatos[0].id!==o.servicioId)return null;
  const lectura=await cargarEstado(candidatos[0],{cliente:o.cliente,cargarFinanzas:o.cargar});
  const candidato={...candidatos[0],reserva:lectura.reserva||candidatos[0].reserva};
  return {candidato,lectura,snapshot:estadoEsperado(candidato,lectura),
   evidencia:JSON.stringify({candidato,lectura})};
 }
 async function confirmarInterno(p,o,opciones){
  if(RPC_REACTIVACION_PRODUCCION_HABILITADO)return {estado:'bloqueada',mensaje:'Esta etapa sólo permite simulación.'};
  if(o.resultado)return o.resultado;
  if(o.invalidada)return {estado:'obsoleta',mensaje:'Esta propuesta ya fue invalidada. Prepara una nueva.'};
  if(!o.permiso())return {estado:'sin_permiso',mensaje:'No tienes el permiso servicios.editar.'};
  opciones.onEstado?.('Revalidando servicio, finanzas y disponibilidad…');
  let actual;
  try{actual=await releer(o);}catch(error){return {estado:'bloqueada',mensaje:`No pude revalidar la propuesta. ${error?.message||error}`};}
  const elegible=actual&&evaluarElegibilidad(actual.candidato,actual.lectura,{diaActual:o.diaActual||hoy()}).elegible;
  if(!elegible||JSON.stringify(actual.snapshot)!==o.snapshot||actual.evidencia!==o.evidencia){
   o.invalidada=true;
   const nueva=await preparar(o.consulta,{cliente:o.cliente,buscar:o.buscar,cargarFinanzas:o.cargar,
    permiso:o.permiso,diaActual:o.diaActual||hoy()});
   return {estado:'obsoleta',mensaje:'El servicio, sus finanzas o la disponibilidad cambiaron. Preparé una nueva evaluación.',nueva};
  }
  const id=opciones.operacionId||root.crypto?.randomUUID?.();
  if(!id||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).test(id))
   return {estado:'bloqueada',mensaje:'No se pudo generar un identificador de operación válido.'};
  const payload=Object.freeze({p_operacion_id:id,p_servicio_id:o.servicioId,
   p_estado_esperado:JSON.parse(o.snapshot)});
  o.resultado={estado:'simulada',mensaje:'Reactivación simulada. No se modificó Proyecto H.',
   candidato:actual.candidato,rpc:RPC,payload,operacion_id:id};
  return o.resultado;
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
 function renderizar(p){
  if(p.estado==='obsoleta')return `<article class="haku-servicio-cortesia"><h3>Propuesta obsoleta</h3><p>${esc(p.mensaje)}</p></article>${p.nueva?renderizar(p.nueva):''}`;
  if(p.estado==='multiples')return `<article class="haku-servicio-cortesia"><h3>Servicios coincidentes</h3><p>${esc(p.mensaje)}</p><ol>${p.candidatos.map(c=>`<li>${esc(resumen(c))}</li>`).join('')}</ol><p>Indica cuál deseas reactivar.</p></article>`;
  if(p.estado==='bloqueada'&&p.candidato){
   const c=p.candidato,razones=p.elegibilidad?.razones||[];
   const conflictos=p.disponibilidad?.conflictos||[];
   return `<article class="haku-servicio-cortesia haku-servicio-cortesia--bloqueada"><header class="haku-servicio-cortesia-cabecera"><div class="haku-servicio-cortesia-estado"><span class="haku-servicio-cortesia-sello">Reactivar servicio</span><span class="haku-servicio-cortesia-etiqueta">Requiere revisión</span></div><strong class="haku-servicio-cortesia-titular">${esc(c.reserva?.titular_nombre)} · CAB ${esc(c.cabana_numero??'—')}</strong><span class="haku-servicio-cortesia-nombre">${esc(c.catalogo?.nombre)}</span><span class="haku-servicio-cortesia-fecha">${esc(fecha(c.fecha_servicio))} · ${esc(hora(c.hora_inicio)||'sin hora')}</span></header><p class="haku-servicio-cortesia-intro">No puedo reactivar automáticamente este servicio.</p>${conflictos.length?`<section class="haku-servicio-cortesia-motivos"><h3>Disponibilidad · Horario no disponible</h3><ul>${conflictos.map(x=>`<li><strong>Horario ocupado</strong><span>${esc(hora(x.hora_inicio))}–${esc(hora(x.hora_fin))}</span></li>`).join('')}</ul></section>`:''}<section class="haku-servicio-cortesia-motivos"><h3>Motivos</h3><ul>${razones.map(x=>`<li><strong>Revisión requerida</strong><span>${esc(x)}</span></li>`).join('')}</ul></section><p class="haku-servicio-cortesia-cierre">Revisión manual necesaria</p></article>`;
  }
  if(p.estado==='simulada')return `<article class="haku-servicio-cortesia haku-servicio-cortesia--realizado"><header class="haku-servicio-cortesia-cabecera"><span class="haku-servicio-cortesia-sello">✓ Simulación completada</span><strong class="haku-servicio-cortesia-titular">${esc(p.candidato.reserva?.titular_nombre)} · CAB ${esc(p.candidato.cabana_numero??'—')}</strong><span class="haku-servicio-cortesia-nombre">${esc(p.candidato.catalogo?.nombre)}</span></header><p>${esc(p.mensaje)}</p><details><summary>RPC y payload preparados</summary><p>${esc(p.rpc)}</p><pre>${esc(JSON.stringify(p.payload,null,2))}</pre></details></article>`;
  if(p.estado!=='propuesta')return `<article class="haku-servicio-cortesia"><h3>Reactivar servicio</h3><p>${esc(p.mensaje)}</p></article>`;
  const c=p.candidato,normal=c.tipo_cobro==='normal';
  const historicos=p.cargos_historicos||[];
  const montoHistorico=historicos.reduce((n,x)=>n+Number(x.monto||0),0);
  return `<article class="haku-servicio-cortesia haku-servicio-cortesia--propuesta"><header class="haku-servicio-cortesia-cabecera"><span class="haku-servicio-cortesia-sello">Reactivar servicio</span><strong class="haku-servicio-cortesia-titular">${esc(c.reserva?.titular_nombre)} · CAB ${esc(c.cabana_numero??'—')}</strong><span class="haku-servicio-cortesia-nombre">${esc(c.catalogo?.nombre)}</span><span class="haku-servicio-cortesia-fecha">${esc(fecha(c.fecha_servicio))} · ${esc(hora(c.hora_inicio)||'sin hora')}${c.hora_fin?`–${esc(hora(c.hora_fin))}`:''}</span></header><div class="haku-servicio-cortesia-comparacion"><div><span>Estado actual</span><strong>Cancelado</strong><b>${normal?`Cobro normal · ${esc(dinero(c.total))}`:'Cortesía · $0'}</b></div><span class="haku-servicio-cortesia-flecha">→</span><div><span>Después</span><strong>Programado</strong></div></div><p class="haku-servicio-cortesia-efecto"><strong>Disponibilidad</strong> · ${c.recurso_id&&c.hora_inicio&&c.hora_fin?'✓ Horario disponible':'No requiere horario compartido'}</p><p class="haku-servicio-cortesia-efecto"><strong>Efecto financiero</strong><br>${normal?`${historicos.length?`Cargo histórico anulado: ${esc(dinero(montoHistorico))} → permanecerá anulado.<br>`:''}Se creará un nuevo cargo activo por ${esc(dinero(c.total))}.`:'No se creará ningún cargo.'}</p><p class="haku-servicio-cortesia-confirmacion">La cancelación anterior quedará en el historial. Esta confirmación es una simulación: no modificará Proyecto H.</p><p data-servicio-reactivacion-estado></p><div class="haku-servicio-cortesia-acciones"><button type="button" data-servicio-reactivacion-confirmar>Confirmar reactivación · simulación</button><button type="button" data-servicio-reactivacion-cancelar>Cancelar</button></div></article>`;
 }
 function instalar(){
  const doc=root.document;let ocupado=false;
  async function procesar(texto,campo,mensajes){
   if(ocupado)return;ocupado=true;campo.value='';campo.dispatchEvent(new root.Event('input',{bubbles:true}));
   const u=doc.createElement('div');u.className='haiku-asistente-mensaje haiku-asistente-mensaje--usuario';u.textContent=texto;mensajes.appendChild(u);
   const el=doc.createElement('div');el.className='haiku-asistente-mensaje haiku-asistente-mensaje--asistente';el.textContent='Buscando el servicio en Proyecto H…';mensajes.appendChild(el);
   let p;try{p=await preparar(texto);el.innerHTML=renderizar(p);}catch(error){el.textContent=`No pude leer el servicio. ${error?.message||error}`;}finally{ocupado=false;mensajes.scrollTop=mensajes.scrollHeight;}
   el.addEventListener('click',async e=>{const b=e.target?.closest?.('button');if(!b)return;e.preventDefault();e.stopPropagation();
    if(b.hasAttribute('data-servicio-reactivacion-cancelar')){p={estado:'cancelada',mensaje:'Cancelé la propuesta. No se modificó Proyecto H.'};el.innerHTML=renderizar(p);return;}
    if(!b.hasAttribute('data-servicio-reactivacion-confirmar')||b.disabled||p?.estado!=='propuesta')return;
    b.disabled=true;
    try{p=await confirmar(p,{onEstado:estado=>{const indicador=el.querySelector('[data-servicio-reactivacion-estado]');if(indicador)indicador.textContent=estado;}});}
    catch(error){p={estado:'bloqueada',mensaje:`No pude completar la simulación. ${error?.message||error}`};}
    el.innerHTML=renderizar(p);if(p.estado==='obsoleta')p=p.nueva;
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
 const api=Object.freeze({RPC_REACTIVACION_PRODUCCION_HABILITADO,interpretar,cargarEstado,estadoEsperado,
  evaluarElegibilidad,preparar,confirmar,renderizar});
 root.HAIKU_ASISTENTE_SERVICIOS_REACTIVACION_V1=api;
 if(typeof module!=='undefined')module.exports=api;
 if(root.document)instalar();
})(typeof window!=='undefined'?window:globalThis);
