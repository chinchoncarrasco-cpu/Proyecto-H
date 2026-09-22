/* HAKU · MODIFICAR SERVICIO EXISTENTE · NORMAL A CORTESÍA V1
 * Texto natural -> búsqueda persistida -> elegibilidad -> vista previa.
 * La confirmación es una simulación read-only: este módulo no contiene writer ni RPC.
 */
(function(root){
 'use strict';
 if(root.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1)return;

 const INTENCION='MODIFICAR_SERVICIO_EXISTENTE';
 const ACCION='NORMAL_A_CORTESIA';
 const RPC_FUTURO='haiku_cambiar_servicio_a_cortesia_v1';
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
   const p={estado:'propuesta',consulta:q,candidato,elegibilidad,p_estado_esperado:estadoEsperado(candidato,finanzas),mensaje:'Cambio preparado en modo de simulación. No se ha modificado Proyecto H.'};
   propuestas.set(p,{consulta:{...q},servicioId:candidato.id,snapshot:JSON.stringify(p.p_estado_esperado),cliente,buscar,cargar,permiso});
   return p;
  }catch(error){return {estado:'bloqueada',consulta:q,mensaje:`No pude completar la lectura de Proyecto H. ${error?.message||error}`};}
 }
 function uuid(opciones={}){
  if(opciones.operacionId)return opciones.operacionId;
  if(typeof root.crypto?.randomUUID==='function')return root.crypto.randomUUID();
  throw Error('No se pudo generar el identificador de la operación simulada.');
 }
 async function confirmar(p,motivo,opciones={}){
  const original=propuestas.get(p),limpio=String(motivo??'').trim();
  if(!original)return {estado:'bloqueada',mensaje:'Prepara una propuesta nueva antes de confirmar.'};
  if(!limpio)return {estado:'bloqueada',mensaje:'El motivo de cortesía es obligatorio.'};
  if(!original.permiso())return {estado:'bloqueada',mensaje:'El permiso servicios.editar ya no está disponible.'};
  try{
   const candidatos=await original.buscar(original.consulta,{cliente:original.cliente});
   if(candidatos.length!==1||candidatos[0].id!==original.servicioId)return {estado:'bloqueada',mensaje:'La coincidencia cambió. Prepara una propuesta nueva.'};
   const actual=candidatos[0],finanzas=await original.cargar(actual,{cliente:original.cliente}),elegibilidad=evaluarElegibilidad(actual,finanzas),snapshot=estadoEsperado(actual,finanzas);
   if(!elegibilidad.elegible||JSON.stringify(snapshot)!==original.snapshot)return {estado:'bloqueada',mensaje:'El servicio o sus finanzas cambiaron. Prepara una propuesta nueva.'};
   return {estado:'simulada',mensaje:'Confirmación simulada. El RPC no fue ejecutado.',rpc:RPC_FUTURO,parametros:{p_operacion_id:uuid(opciones),p_servicio_id:original.servicioId,p_motivo:limpio,p_estado_esperado:snapshot}};
  }catch(error){return {estado:'bloqueada',mensaje:`No pude revalidar la propuesta. ${error?.message||error}`};}
 }
 const cancelar=()=>({estado:'cancelada',mensaje:'Cambio cancelado. No se modificó Proyecto H.'});
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dinero=v=>`$${Math.round(Number(v)||0).toLocaleString('es-CL')}`;
 const fechaVisible=v=>String(v||'—').split('-').reverse().join('-');
 function resumen(c){return `${c.catalogo?.nombre||'Servicio'} · ${fechaVisible(c.fecha_servicio)} · ${cortoHora(c.hora_inicio)||'sin hora'}${c.hora_fin?`–${cortoHora(c.hora_fin)}`:''} · CAB ${c.cabana_numero||'—'}`;}
 function renderizar(p){
  if(p.estado==='multiples')return `<article class="haku-servicio-cortesia"><h3>Servicios coincidentes</h3><p>${esc(p.mensaje)}</p><ol>${p.candidatos.map(c=>`<li>${esc(resumen(c))}</li>`).join('')}</ol><p>No elegí ninguno automáticamente.</p></article>`;
  if(['no_encontrado','incompleta','bloqueada','already_courtesy','cancelada'].includes(p.estado))return `<article class="haku-servicio-cortesia"><h3>Cambio de servicio</h3><p>${esc(p.mensaje)}</p>${p.elegibilidad?.razones?.length?`<ul>${p.elegibilidad.razones.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</article>`;
  if(p.estado==='simulada')return `<article class="haku-servicio-cortesia"><h3>Confirmación simulada</h3><p>${esc(p.mensaje)}</p><p>No se llamó a Supabase ni se modificó Proyecto H.</p><details><summary>Payload preparado</summary><pre>${esc(JSON.stringify({rpc:p.rpc,parametros:p.parametros},null,2))}</pre></details></article>`;
  const c=p.candidato,cargo=p.p_estado_esperado;
  return `<article class="haku-servicio-cortesia"><h3>Cambio de servicio</h3><strong>${esc(c.reserva.titular_nombre)} · CAB ${esc(c.cabana_numero)}</strong><p>${esc(c.catalogo.nombre)}<br>${esc(fechaVisible(c.fecha_servicio))} · ${esc(cortoHora(c.hora_inicio)||'sin hora')}${c.hora_fin?`–${esc(cortoHora(c.hora_fin))}`:''}</p><div class="haku-servicio-cortesia-grid"><section><b>Actual</b><p>Cobro normal<br>${esc(dinero(c.total))}<br>Cargo pendiente ${esc(dinero(cargo.saldo_cargo))}</p></section><section><b>Cambio propuesto</b><p>Cortesía<br>$0</p></section></div><p><b>Efecto:</b> el cargo pendiente asociado será anulado al confirmar.</p>${c.reserva.estado_reserva==='checked_out'?'<p class="haku-servicio-cortesia-aviso">La reserva ya realizó check-out.</p>':''}<label>Motivo de cortesía<textarea data-servicio-cortesia-motivo rows="3" autocomplete="off"></textarea></label><div class="haku-servicio-cortesia-acciones"><button type="button" data-servicio-cortesia-confirmar disabled>Confirmar cambio · simulación</button><button type="button" data-servicio-cortesia-cancelar>Cancelar</button></div><small>Ejecución remota deshabilitada en esta etapa.</small></article>`;
 }
 function instalar(){
  const doc=root.document,style=doc.createElement('style');style.textContent='.haku-servicio-cortesia{background:#f8faf7;color:#263c2c;border:1px solid #cbd9cd;border-radius:14px;padding:14px;overflow-wrap:anywhere;font-size:12px}.haku-servicio-cortesia h3{font-size:16px;margin:0 0 8px}.haku-servicio-cortesia p{line-height:1.5}.haku-servicio-cortesia-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.haku-servicio-cortesia-grid section{background:white;border:1px solid #dce5de;border-radius:10px;padding:10px}.haku-servicio-cortesia-aviso{color:#7a4d13}.haku-servicio-cortesia label{display:grid;gap:6px;font-weight:600}.haku-servicio-cortesia textarea{font:inherit;resize:vertical;border:1px solid #aebfb2;border-radius:8px;padding:8px}.haku-servicio-cortesia-acciones{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.haku-servicio-cortesia button{font:inherit;border:1px solid #adc2b2;border-radius:9px;padding:8px 11px;background:white;color:#294b37}.haku-servicio-cortesia button:disabled{background:#edf0ed;color:#748078}.haku-servicio-cortesia pre{white-space:pre-wrap;font-size:11px}';doc.head.appendChild(style);
  let ocupado=false;
  async function procesar(texto,campo,mensajes){
   if(ocupado)return;ocupado=true;campo.value='';campo.dispatchEvent(new root.Event('input',{bubbles:true}));
   const u=doc.createElement('div');u.className='haiku-asistente-mensaje haiku-asistente-mensaje--usuario';u.textContent=texto;mensajes.appendChild(u);
   const el=doc.createElement('div');el.className='haiku-asistente-mensaje haiku-asistente-mensaje--asistente';el.textContent='Buscando el servicio en Proyecto H…';mensajes.appendChild(el);
   let p;try{p=await preparar(texto);el.innerHTML=renderizar(p);}finally{ocupado=false;mensajes.scrollTop=mensajes.scrollHeight;}
   el.addEventListener('input',e=>{if(!e.target?.matches?.('[data-servicio-cortesia-motivo]'))return;const b=el.querySelector('[data-servicio-cortesia-confirmar]');if(b)b.disabled=!e.target.value.trim();});
   el.addEventListener('click',async e=>{const b=e.target?.closest?.('button');if(!b)return;e.preventDefault();e.stopPropagation();
    if(b.hasAttribute('data-servicio-cortesia-cancelar')){p=cancelar();el.innerHTML=renderizar(p);return;}
    if(!b.hasAttribute('data-servicio-cortesia-confirmar')||b.disabled)return;
    const motivo=el.querySelector('[data-servicio-cortesia-motivo]')?.value||'';el.querySelectorAll('button,textarea').forEach(x=>x.disabled=true);
    p=await confirmar(p,motivo);el.innerHTML=renderizar(p);
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
 const api=Object.freeze({interpretar,buscarServicios,resolverCandidatos,cargarFinanzas,estadoEsperado,evaluarElegibilidad,preparar,confirmar,cancelar,renderizar});
 root.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1=api;
 if(typeof module!=='undefined')module.exports=api;
 if(root.document)instalar();
})(typeof window!=='undefined'?window:globalThis);
