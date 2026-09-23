/* Haku · cancelación lógica de servicios persistidos · C2 (simulación). */
(function(root){
 'use strict';
 if(root.HAIKU_ASISTENTE_SERVICIOS_CANCELACION_V1)return;
 const autoridad=root.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1||
  (typeof require==='function'?require('./supabase-asistente-servicios-cortesia-v1.js'):null);
 const INTENCION='CANCELAR_SERVICIO_EXISTENTE';
 const RPC='haiku_cancelar_servicio_asistente_v1';
 const RPC_CANCELACION_PRODUCCION_HABILITADO=false;
 const propuestas=new WeakMap();
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const numero=v=>v==null||v===''?null:Number(v);
 const hora=v=>String(v??'').match(/^(\d{1,2}):(\d{2})/)?.slice(1).map((x,i)=>i?x:x.padStart(2,'0')).join(':')||null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const dinero=v=>'$'+Number(v||0).toLocaleString('es-CL');
 const fecha=v=>String(v||'').replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3-$2-$1');
 const hoy=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const MASAJES=['masajeTerapeutico30','masajeTerapeutico60','masajeDescontracturante30','masajeDescontracturante60'];

 function interpretar(texto,{diaActual=hoy()}={}){
  const original=String(texto??'').replace(/^\s*(?:asistente\s+)?haku\s*[,;:!¡¿?\-–—]*\s*/i,'');
  const t=norm(original);
  if(/\bno\s+(?:canceles?|anules?|elimines?)\b/.test(t))return null;
  const verbo=/\b(?:cancela|cancelar|cancelame|anula|anular|anulame)\b/.test(t)||/\belimina(?:r)?\s+de\s+la\s+agenda\b/.test(t);
  const dominio=/\b(?:servicio|tinaja|tonel|jacuzzi|masaje|late\s*(?:check\s*[- ]?\s*out|out)|cama|cuna)\b/.test(t);
  if(!verbo||!dominio)return null;
  const concepto=original.match(/\b(?:tinaja\s+(?:(?:tipo|de)\s+)?(?:tonel|jacuzzi|madera)|tonel(?:\s+de\s+madera)?|jacuzzi|tinaja|masaje(?:\s+(?:relajante|terapeutico|terapéutico|holistico|holístico|descontracturante))?|late\s*(?:check\s*[- ]?\s*out|out)|cama(?:\s+adicional)?|cuna)\b/i);
  const tipo=norm(concepto?.[0]||'');
  let codigos=[];
  if(/\bjacuzzi\b/.test(tipo))codigos=['tinajaJacuzzi'];
  else if(/\btonel\b|\bmadera\b/.test(tipo))codigos=['tinajaTonel'];
  else if(/\btinaja\b/.test(tipo))codigos=['tinajaTonel','tinajaJacuzzi'];
  else if(/\bmasaje\b/.test(tipo)){
   if(/\bterapeutico\b/.test(tipo))codigos=MASAJES.filter(x=>x.startsWith('masajeTerapeutico'));
   else if(/\bdescontracturante\b/.test(tipo))codigos=MASAJES.filter(x=>x.startsWith('masajeDescontracturante'));
   else codigos=MASAJES;
  }else if(/\blate\b/.test(tipo))codigos=['lateCheckout'];
  else if(/\bcuna\b/.test(tipo))codigos=['cuna'];
  const cab=t.match(/\bcab(?:ana)?\.?\s*(\d{1,2})\b/);
  const marcaHora=t.match(/\b(?:a\s+las?|hora)\s+([01]?\d|2[0-3])[:h.,]([0-5]\d)\b/)||t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const fechaServicio=autoridad.fechaDesdeTexto(original,diaActual);
  let titular=null;
  if(concepto){
   const resto=original.slice(concepto.index+concepto[0].length);
   if(/^\s+de\s+/i.test(resto)&&!/^\s+de\s+(?:la\s+)?cab(?:aña|ana)?\b/i.test(resto)){
    const candidato=resto.replace(/^\s+de\s+/i,'').split(/\s*(?:[,;]|\b(?:del?|a\s+las?|hora|cab(?:aña|ana)?)\b)/i)[0].trim();
    if(/^[\p{L}][\p{L}'’ -]*$/u.test(candidato))titular=candidato;
   }
  }
  const errores=[];
  if(!concepto||!codigos.length)errores.push(tipo?'Este tipo de servicio aún no se puede identificar con seguridad.':'Indica el tipo de servicio.');
  if(!titular&&cab==null)errores.push('Indica el titular o la cabaña.');
  if(!titular&&!fechaServicio)errores.push('Sin titular, indica también la fecha.');
  return {intencion:INTENCION,accion:INTENCION,titular,cabana:cab?Number(cab[1]):null,
   concepto:concepto?.[0]||null,codigos_servicio:codigos,fecha:fechaServicio,
   familia:/\bmasaje\b/.test(tipo)?'masaje':null,
   subtipo:/\b(relajante|holistico|terapeutico|descontracturante)\b/.exec(tipo)?.[1]||null,
   hora:marcaHora?`${String(marcaHora[1]).padStart(2,'0')}:${marcaHora[2]}`:null,errores};
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
 async function cargarEstado(candidato,{cliente=root.haikuSupabase,cargarFinanzas=autoridad.cargarFinanzas}={}){
  const [finanzas,estadias]=await Promise.all([
   cargarFinanzas(candidato,{cliente,completo:true}),
   filas(()=>cliente.from('reserva_estadias').select('id,reserva_id,checkout_realizado_en').eq('reserva_id',candidato.reserva_id).order('id'))
  ]);
  const checkout=estadias.map(x=>x.checkout_realizado_en).filter(Boolean)
   .sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)||null;
  return {finanzas,checkout,estadias};
 }
 async function buscarServicios(q,{cliente=root.haikuSupabase}={}){
  if(q.familia!=='masaje')return autoridad.buscarServicios(q,{cliente});
  if(!cliente?.from)throw Error('No está disponible la lectura autenticada de Proyecto H.');
  const catalogo=await filas(()=>cliente.from('catalogo_servicios').select('id,codigo,nombre').order('id'));
  const codigos=catalogo.filter(x=>/^masaje/i.test(String(x.codigo||''))||/^masaje\b/i.test(norm(x.nombre)))
   .filter(x=>{
    if(!q.subtipo)return true;
    const nombre=norm(`${x.codigo||''} ${x.nombre||''}`);
    const patron=q.subtipo==='relajante'?/relajant|relajacion/:
     q.subtipo==='holistico'?/holistic/:new RegExp(q.subtipo);
    return patron.test(nombre);
   }).map(x=>x.codigo).filter(Boolean);
  return codigos.length?autoridad.buscarServicios({...q,codigos_servicio:codigos},{cliente}):[];
 }
 function estadoEsperado(candidato,{finanzas,checkout}){
  const cargos=[...finanzas.cargos].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const activos=cargos.filter(x=>x.estado==='activo'),cargo=activos.length===1?activos[0]:null;
  const vista=cargo?finanzas.estados.find(x=>x.cargo_id===cargo.id):null;
  return {
   version:1,servicio_id:candidato.id,servicio_actualizado_en:candidato.actualizado_en??null,
   estado_servicio:candidato.estado_servicio,tipo_cobro:candidato.tipo_cobro,total:numero(candidato.total),
   fecha_servicio:candidato.fecha_servicio,hora_inicio:candidato.hora_inicio??null,hora_fin:candidato.hora_fin??null,
   reserva_id:candidato.reserva_id,estadia_id:candidato.estadia_id,
   estado_reserva:candidato.reserva?.estado_reserva??null,reserva_actualizado_en:candidato.reserva?.actualizado_en??null,
   checkout_realizado_en:checkout,bove_checkout:candidato.reserva?.bove_checkout??null,
   cargos,cargo_activo_id:cargo?.id??null,cargo_monto:cargo?numero(cargo.monto):null,
   cargo_aplicado_neto:vista?numero(vista.aplicado_neto):null,cargo_saldo:vista?numero(vista.saldo_cargo):null,
   cantidad_cargos_activos:activos.length,cantidad_aplicaciones:finanzas.aplicaciones.length,cantidad_ajustes:finanzas.ajustes.length
  };
 }
 function evaluarElegibilidad(c,{finanzas,checkout}){
  if(c.estado_servicio==='cancelado')return {estado:'already_cancelled',elegible:false,razones:[]};
  const razones=[],activos=finanzas.cargos.filter(x=>x.estado==='activo'),total=numero(c.total);
  if(c.estado_servicio!=='programado')razones.push('El servicio no está programado.');
  if(c.cancelado_en!=null||c.cancelado_por!=null||c.motivo_cancelacion!=null)razones.push('El servicio conserva datos de una cancelación previa.');
  if(!['pendiente','confirmada','hospedada'].includes(c.reserva?.estado_reserva)||checkout!=null)razones.push('La reserva cerró o ya realizó check-out.');
  if(c.reserva?.bove_checkout!=null)razones.push('Existe BOVE de check-out.');
  if(finanzas.cargos.some(x=>x.reserva_id!==c.reserva_id||x.estadia_id!==c.estadia_id||x.servicio_id!==c.id||x.tipo_cargo!=='servicio'||x.estadia_noche_id!=null||!['activo','anulado'].includes(x.estado)))razones.push('Existen cargos relacionados incoherentes.');
  if(finanzas.aplicaciones.length)razones.push('Existen aplicaciones de pago históricas.');
  if(finanzas.ajustes.length)razones.push('Existen ajustes históricos.');
  if(c.tipo_cobro==='cortesia'){
   if(total!==0||!String(c.motivo_cortesia||'').trim()||activos.length)razones.push('La cortesía o sus finanzas no son coherentes.');
  }else if(c.tipo_cobro==='normal'){
   const cargo=activos.length===1?activos[0]:null,vista=cargo?finanzas.estados.find(x=>x.cargo_id===cargo.id):null;
   if(!(total>0)||activos.length!==1||!cargo||numero(cargo.monto)!==total||!vista||
      numero(vista.monto_ajustado)!==total||numero(vista.aplicado_neto)!==0||numero(vista.saldo_cargo)!==total)
    razones.push('El cargo activo no coincide con el total íntegramente pendiente.');
  }else razones.push('El tipo de cobro requiere revisión.');
  return {estado:razones.length?'bloqueada':'elegible',elegible:!razones.length,razones};
 }
 async function preparar(texto,opciones={}){
  const q=typeof texto==='string'?interpretar(texto,{diaActual:opciones.diaActual||hoy()}):texto;
  if(!q)return {estado:'no_aplica'};
  if(q.errores?.length)return {estado:'incompleta',consulta:q,mensaje:`Entendí que quieres cancelar un servicio, pero necesito identificarlo mejor. ${q.errores.join(' ')}`};
  const permiso=opciones.permiso||(()=>root.haikuTienePermiso?.('servicios.cancelar')===true);
  if(!permiso())return {estado:'bloqueada',consulta:q,mensaje:'No tienes el permiso servicios.cancelar.'};
  const buscar=opciones.buscar||buscarServicios,cargar=opciones.cargarFinanzas||autoridad.cargarFinanzas,cliente=opciones.cliente||root.haikuSupabase;
  try{
   const candidatos=await buscar(q,{cliente});
   if(!candidatos.length)return {estado:'no_encontrado',consulta:q,mensaje:'No encontré un servicio persistido que coincida con esos datos.'};
   if(candidatos.length>1)return {estado:'multiples',consulta:q,candidatos,mensaje:`Encontré ${candidatos.length} servicios. Indica fecha, hora, tipo o cabaña para identificar uno solo.`};
   const candidato=candidatos[0];
   if(candidato.estado_servicio==='cancelado')return {estado:'already_cancelled',consulta:q,candidato,mensaje:'Este servicio ya está cancelado. No requiere cambios.'};
   const lectura=await cargarEstado(candidato,{cliente,cargarFinanzas:cargar});
   const elegibilidad=evaluarElegibilidad(candidato,lectura);
   if(!elegibilidad.elegible)return {estado:'bloqueada',consulta:q,candidato,elegibilidad,mensaje:'No puedo cancelar automáticamente este servicio. Requiere revisión.'};
   const p={estado:'propuesta',consulta:q,candidato,elegibilidad,p_estado_esperado:estadoEsperado(candidato,lectura),mensaje:'Propuesta de cancelación preparada en modo simulación.'};
   propuestas.set(p,{consulta:q,servicioId:candidato.id,snapshot:JSON.stringify(p.p_estado_esperado),
    evidencia:JSON.stringify({candidato,lectura}),cliente,buscar,cargar,permiso,operacionId:null,payload:null,resultado:null,enCurso:null});
   return p;
  }catch(error){return {estado:'bloqueada',consulta:q,mensaje:`No pude completar la lectura de Proyecto H. ${error?.message||error}`};}
 }
 async function confirmar(p,motivo,opciones={}){
  const o=propuestas.get(p);
  if(!o)return {estado:'bloqueada',mensaje:'Prepara una propuesta nueva antes de confirmar.'};
  if(o.enCurso)return o.enCurso;
  if(o.resultado)return o.resultado;
  if(!String(motivo??'').trim())return {estado:'motivo_requerido',mensaje:'Ingresa un motivo de cancelación.',propuesta:p};
  o.enCurso=(async()=>{
   try{
    if(!o.permiso())return {estado:'bloqueada',mensaje:'Ya no tienes el permiso servicios.cancelar.'};
    const candidatos=await o.buscar(o.consulta,{cliente:o.cliente});
    if(candidatos.length!==1||candidatos[0].id!==o.servicioId)
     return {estado:'obsoleta',mensaje:'La identificación cambió. Preparé una propuesta nueva.',nueva:await preparar(o.consulta,{cliente:o.cliente,buscar:o.buscar,cargarFinanzas:o.cargar,permiso:o.permiso})};
    const c=candidatos[0],lectura=await cargarEstado(c,{cliente:o.cliente,cargarFinanzas:o.cargar});
    const nuevo=estadoEsperado(c,lectura);
    if(!evaluarElegibilidad(c,lectura).elegible||JSON.stringify(nuevo)!==o.snapshot||JSON.stringify({candidato:c,lectura})!==o.evidencia)
     return {estado:'obsoleta',mensaje:'El servicio o sus finanzas cambiaron. Preparé una propuesta nueva.',nueva:await preparar(o.consulta,{cliente:o.cliente,buscar:o.buscar,cargarFinanzas:o.cargar,permiso:o.permiso})};
    if(!o.payload){
     const id=opciones.operacionId||root.crypto?.randomUUID?.();
     if(!id)throw Error('No se pudo generar un identificador de operación.');
     o.operacionId=id;
     o.payload={p_operacion_id:id,p_servicio_id:o.servicioId,p_motivo:String(motivo),p_estado_esperado:nuevo};
    }
    // C2: no existe ninguna llamada de escritura en esta ruta, incluso si alguien cambia el flag.
    o.resultado={estado:'simulada',mensaje:'Confirmación simulada. No se llamó al RPC ni se modificó Proyecto H.',
     candidato:c,rpc:RPC,parametros:o.payload,operacion_id:o.operacionId,produccion_habilitada:RPC_CANCELACION_PRODUCCION_HABILITADO};
    return o.resultado;
   }catch(error){return {estado:'bloqueada',mensaje:`No pude revalidar el servicio. ${error?.message||error}`};}
   finally{o.enCurso=null;}
  })();
  return o.enCurso;
 }
 function resumen(c){return `${c.reserva?.titular_nombre||'Titular'} · CAB ${c.cabana_numero??'—'} · ${c.catalogo?.nombre||'Servicio'} · ${fecha(c.fecha_servicio)} · ${hora(c.hora_inicio)||'sin hora'}`;}
 function renderizar(p){
  if(p.estado==='obsoleta')return `<article class="haku-servicio-cortesia"><h3>Propuesta obsoleta</h3><p>${esc(p.mensaje)}</p></article>${renderizar(p.nueva)}`;
  if(p.estado==='multiples')return `<article class="haku-servicio-cortesia"><h3>Servicios coincidentes</h3><p>${esc(p.mensaje)}</p><ol>${p.candidatos.map(c=>`<li>${esc(resumen(c))}</li>`).join('')}</ol><p>No elegí ninguno automáticamente.</p></article>`;
  if(p.estado==='bloqueada'&&p.candidato&&p.elegibilidad?.razones?.length){
   const c=p.candidato;
   return `<article class="haku-servicio-cortesia haku-servicio-cortesia--bloqueada"><header class="haku-servicio-cortesia-cabecera"><div class="haku-servicio-cortesia-estado"><span class="haku-servicio-cortesia-sello">Cancelar servicio</span><span class="haku-servicio-cortesia-etiqueta">Requiere revisión</span></div><strong class="haku-servicio-cortesia-titular">${esc(c.reserva?.titular_nombre)} · CAB ${esc(c.cabana_numero??'—')}</strong><span class="haku-servicio-cortesia-nombre">${esc(c.catalogo?.nombre)}</span><span class="haku-servicio-cortesia-fecha">${esc(fecha(c.fecha_servicio))} · ${esc(hora(c.hora_inicio)||'sin hora')}</span></header><p class="haku-servicio-cortesia-intro">No puedo cancelar este servicio automáticamente.</p><section class="haku-servicio-cortesia-motivos"><h3>Motivos</h3><ul>${p.elegibilidad.razones.map(x=>`<li><strong>Revisión requerida</strong><span>${esc(x)}</span></li>`).join('')}</ul></section><p class="haku-servicio-cortesia-cierre">Revisión manual necesaria</p></article>`;
  }
  if(p.estado==='simulada')return `<article class="haku-servicio-cortesia"><h3>Confirmación simulada</h3><p>${esc(p.mensaje)}</p><details><summary>RPC y payload preparados</summary><pre>${esc(JSON.stringify({rpc:p.rpc,parametros:p.parametros},null,2))}</pre></details></article>`;
  if(p.estado!=='propuesta')return `<article class="haku-servicio-cortesia"><h3>Cancelar servicio</h3><p>${esc(p.mensaje)}</p></article>`;
  const c=p.candidato,normal=c.tipo_cobro==='normal',cargo=p.p_estado_esperado;
  return `<article class="haku-servicio-cortesia haku-servicio-cortesia--propuesta"><header class="haku-servicio-cortesia-cabecera"><span class="haku-servicio-cortesia-sello">Cancelar servicio</span><strong class="haku-servicio-cortesia-titular">${esc(c.reserva?.titular_nombre)} · CAB ${esc(c.cabana_numero??'—')}</strong><span class="haku-servicio-cortesia-nombre">${esc(c.catalogo?.nombre)}</span><span class="haku-servicio-cortesia-fecha">${esc(fecha(c.fecha_servicio))} · ${esc(hora(c.hora_inicio)||'sin hora')}${c.hora_fin?`–${esc(hora(c.hora_fin))}`:''}</span></header><div class="haku-servicio-cortesia-comparacion"><div><span>Estado actual</span><strong>Programado</strong><b>${normal?`Cobro normal · ${esc(dinero(c.total))}`:'Cortesía · $0'}</b></div><span class="haku-servicio-cortesia-flecha">→</span><div><span>Después</span><strong>Cancelado</strong></div></div><p class="haku-servicio-cortesia-efecto">${normal?`Cargo pendiente ${esc(dinero(cargo.cargo_saldo))} → será anulado. El monto histórico se conservará.`:'Sin cargo activo. No se generará ningún cobro.'}</p><label class="haku-servicio-cortesia-motivo">Motivo de cancelación<textarea data-servicio-cancelacion-motivo rows="2" required autocomplete="off"></textarea></label><p class="haku-servicio-cortesia-confirmacion">Esta confirmación es una simulación: no modificará Proyecto H.</p><div class="haku-servicio-cortesia-acciones"><button type="button" data-servicio-cancelacion-confirmar disabled>Confirmar cancelación · simulación</button><button type="button" data-servicio-cancelacion-cancelar>Cancelar</button></div></article>`;
 }
 function instalar(){
  const doc=root.document;
  let ocupado=false;
  async function procesar(texto,campo,mensajes){
   if(ocupado)return;ocupado=true;campo.value='';campo.dispatchEvent(new root.Event('input',{bubbles:true}));
   const u=doc.createElement('div');u.className='haiku-asistente-mensaje haiku-asistente-mensaje--usuario';u.textContent=texto;mensajes.appendChild(u);
   const el=doc.createElement('div');el.className='haiku-asistente-mensaje haiku-asistente-mensaje--asistente';el.textContent='Buscando el servicio en Proyecto H…';mensajes.appendChild(el);
   let p;try{p=await preparar(texto);el.innerHTML=renderizar(p);}catch(error){el.textContent=`No pude leer el servicio. ${error?.message||error}`;}finally{ocupado=false;mensajes.scrollTop=mensajes.scrollHeight;}
   el.addEventListener('input',e=>{if(!e.target?.matches?.('[data-servicio-cancelacion-motivo]'))return;const b=el.querySelector('[data-servicio-cancelacion-confirmar]');if(b)b.disabled=!e.target.value.trim();});
   el.addEventListener('click',async e=>{const b=e.target?.closest?.('button');if(!b)return;e.preventDefault();e.stopPropagation();
    if(b.hasAttribute('data-servicio-cancelacion-cancelar')){p={estado:'cancelada',mensaje:'Cancelé la propuesta. No se modificó Proyecto H.'};el.innerHTML=renderizar(p);return;}
    if(!b.hasAttribute('data-servicio-cancelacion-confirmar')||b.disabled||p?.estado!=='propuesta')return;
    const motivo=el.querySelector('[data-servicio-cancelacion-motivo]')?.value||'';
    if(!motivo.trim())return;
    el.querySelectorAll('button,textarea').forEach(x=>x.disabled=true);
    p=await confirmar(p,motivo);el.innerHTML=renderizar(p);
    if(p.estado==='obsoleta')p=p.nueva;
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
 const api=Object.freeze({RPC_CANCELACION_PRODUCCION_HABILITADO,interpretar,buscarServicios,cargarEstado,estadoEsperado,evaluarElegibilidad,preparar,confirmar,renderizar});
 root.HAIKU_ASISTENTE_SERVICIOS_CANCELACION_V1=api;
 if(typeof module!=='undefined')module.exports=api;
 if(root.document)instalar();
})(typeof window!=='undefined'?window:globalThis);
