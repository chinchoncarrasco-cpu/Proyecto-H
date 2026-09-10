/* BOVE ETAPA 3: preparación y revalidación sólo lectura.
 * Confirmación bloqueada hasta desplegar y verificar la protección atómica.
 * No hay writer, RPC, flag de habilitación ni evento de guardado en este módulo.
 */
(function(root){
 'use strict';
 if(root.HAIKU_ASISTENTE_BOVE_ESCRITURA_V1)return;
 const bloqueo='Confirmación bloqueada: falta desplegar y verificar la migración atómica BOVE en Supabase.';
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const numero=v=>/^\d+(?:[.,]\d{3})*$/.test(String(v??'').trim())?String(v).trim().replace(/[.,]/g,''):null;
 const hoy=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const fecha=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 const campos='id,titular_nombre,estado_reserva,bove_cierre,bove_checkout,estadias:reserva_estadias(id,fecha_ingreso,fecha_salida,estado_estadia,tipo_estadia,checkin_realizado_en,checkout_realizado_en,cabanas(numero))';
 const propuestas=new WeakMap();
 function interpretar(texto,diaActual=hoy()){
  let t=norm(texto).replace(/^haku[ ,:]*/,'').replace(/\s+por favor[.!]?$/,'').replace(/[.!]$/,'');
  if(!/\bbove\b/.test(t)||! /\b(pon|ponle|registra|registrar|guarda|asigna|completa|escribe|edita)\b/.test(t))return null;
  const error=mensaje=>({error:mensaje});
  if(/\balojamiento\b/.test(t)&&/\b(servicios|checkout|check-out)\b/.test(t))return error('La operación combinada de alojamiento y servicios requiere revisión; prepara un alcance a la vez.');
  const meses=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  // Sólo fechas completas de día/mes, nunca un número BOVE aislado.
  const patron=/(?:\b(?:del|el)\s+)?\b(?:(\d{1,2})([-/])(\d{1,2})\2(\d{4}|\d{2})|(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?(\d{4}))?)\b/g;
  const fechas=[...t.matchAll(patron)];let diaExplicito=null,anoInferido=false;
  if(fechas.length>1)return error('Indica una única fecha para resolver esta reserva.');
  if(fechas.length){
   const f=fechas[0],d=f[1]||f[5],mes=f[3]||meses.indexOf(f[6]==='setiembre'?'septiembre':f[6])+1;
   const ano=f[4]||f[7]||diaActual.slice(0,4);anoInferido=!f[4]&&!f[7];
   diaExplicito=`${ano.length===2?'20'+ano:ano}-${String(mes).padStart(2,'0')}-${d.padStart(2,'0')}`;
   if(!fecha(diaExplicito))return error('La fecha indicada no es válida. Indica día, mes y, si corresponde, año.');
   t=(t.slice(0,f.index)+' '+t.slice(f.index+f[0].length)).replace(/\s+/g,' ').trim();
  }
  // Gramáticas completas: el texto sobrante nunca se ignora para seleccionar hoy.
  let m=t.match(/^(?:a (.+?) )?(?:pon|ponle|registra|registrar|guarda|asigna|escribe) (?:el )?bove ([\d.,]+)(?: (?:de )?(alojamiento|servicios|checkout|check-out))?(?: (?:a|para) (.+?))?(?: (hoy))?$/);
  if(!m){const p=t.match(/^completa el bove pendiente de (.+?) con ([\d.,]+)(?: (hoy))?$/);if(p)m=[p[0],p[1],p[2],undefined,undefined,p[3]];}
  if(!m)return error('Necesito un número explícito y un destino: por ejemplo, «ponle BOVE 16989 de alojamiento a CAB 6 del 3 de septiembre». Sin fecha se consulta hoy.');
  if(m[1]&&m[4])return error('Indica un único destino para el BOVE.');
  const n=numero(m[2]),destino=m[1]||m[4]||'';
  if(!n)return error('Indica un número BOVE válido, sin calcular el siguiente número.');
  const cab=destino.match(/^cab(?:ana)?\s+(\d+)(?:\s+(.+))?$/),titular=cab?cab[2]||null:destino;
  if((!cab&&!titular)||titular&&(!/^[a-z]+(?:[ '-][a-z]+)+$/.test(titular)||/\b(hoy|ayer|manana|pasado|libro|bove|cab|del|reserva)\b/.test(titular)))return error('Indica CAB y número, o el titular completo; puedes agregar una fecha explícita.');
  if(cab&&Number(cab[1])<=0)return error('Indica una cabaña válida.');
  if(diaExplicito&&m[5])return error('No combines hoy con otra fecha. Indica una única fecha.');
  return {numero:n,cabana:cab?Number(cab[1]):null,titular,tipo:m[3]?(m[3]==='alojamiento'?'alojamiento':'servicios'):null,...(diaExplicito?{fecha:diaExplicito,ano_inferido:anoInferido}:{})};
 }
 function operativa(r,dia,explicita=false){
  return !['cancelada','no_show'].includes(r.estado_reserva)&&(r.estadias||[]).some(e=>
   !['cancelada','no_show'].includes(e.estado_estadia)&&fecha(e.fecha_ingreso)&&fecha(e.fecha_salida)&&
   (e.tipo_estadia==='full_day'?e.fecha_ingreso===dia&&e.fecha_salida===dia:e.fecha_ingreso<=dia&&(explicita?dia<e.fecha_salida:dia<=e.fecha_salida)));
 }
 function compatibleDestino(r,q,dia){
  return operativa(r,dia,!!q.fecha)&&(!q.titular||norm(r.titular_nombre)===norm(q.titular))&&
   (!q.cabana||(r.estadias||[]).some(e=>Number(e.cabanas?.numero)===q.cabana&&operativa({...r,estadias:[e]},dia,!!q.fecha)));
 }
 async function filas(build){
  const out=[];for(let i=0;;i+=500){const {data,error}=await build().range(i,i+499);if(error)throw error;out.push(...(data||[]));if((data||[]).length<500)return out;}
 }
 const valor=v=>String(v??'').trim();
 const sello=r=>JSON.stringify({...r,estadias:[...(r.estadias||[])].sort((a,b)=>String(a.id).localeCompare(String(b.id)))});
 async function comprobarLibro(r,q,libro,lectura,control){
  if(!libro)return {mensaje:'Libro no cargado; no se pudo contrastar.',evidencias:[]};
  await libro.listo();control();if(!libro.estado().cargado)return {mensaje:'Libro no cargado; no se pudo contrastar.',evidencias:[]};
  if(!lectura)throw Error('El módulo de consultas BOVE no está disponible.');
  const generacion=libro.estado().generacion;
  const exacta=await lectura.consultar(`busca BOVE ${q.numero} en el Libro`,{libro});control();
  if(exacta.incompleto)throw Error(exacta.avisos.join(' '));
  // Además del número buscado, revisar las hojas de la estadía para detectar
  // un número diferente. Reutiliza consultarHoja y su caché; no compara versiones.
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'],requeridos=new Set();
  for(const e of r.estadias||[]){
   if(!fecha(e.fecha_ingreso)||!fecha(e.fecha_salida)||e.fecha_salida<e.fecha_ingreso)throw Error('Fechas de estadía insuficientes para contrastar el Libro.');
   let d=e.fecha_ingreso.slice(0,7)+'-01',fin=e.fecha_salida.slice(0,7)+'-01';
   while(d<=fin){requeridos.add(meses[Number(d.slice(5,7))-1]+d.slice(2,4));if(requeridos.size>24)throw Error('El alcance del Libro requiere una revisión específica.');const x=new Date(d+'T12:00:00Z');x.setUTCMonth(x.getUTCMonth()+1);d=x.toISOString().slice(0,10);}
  }
  const evidencias=[...exacta.libro],nombres=libro.listarHojas(),faltantes=[];
  for(const mes of requeridos){
   const ns=nombres.filter(n=>norm(n).replace(/\s/g,'')===mes);
   if(ns.length!==1){faltantes.push(mes);continue;}
   control();const h=await libro.consultarHoja(ns[0]);control();
   if(!Array.isArray(h.evidencias_bove))throw Error('La hoja no entrega evidencias BOVE; revisión incompleta.');
   evidencias.push(...lectura.desdeLibro(h));
  }
  if(libro.estado().generacion!==generacion)throw Error('El Libro cambió durante la preparación. Repite la consulta.');
  const unicas=[...new Map(evidencias.map(e=>[JSON.stringify([e.origen,e.numero,e.estado]),e])).values()];
  const objetivo={titular:r.titular_nombre,numero:q.numero,tipos:[q.tipo],segmentos:r.estadias.map(e=>({cabana:e.cabanas?.numero,fecha:e.fecha_ingreso,hasta:e.fecha_salida}))};
  const fuertes=unicas.filter(e=>lectura.comparar([e],[objetivo]).some(c=>['coinciden','conflicto','pendiente'].includes(c.estado)));
  const conflictos=fuertes.filter(e=>e.numero&&e.numero!==q.numero);
  // El análisis de conflictos conserva todas las evidencias fuertes. El detalle
  // individual sólo expone el número solicitado y el contexto de esta propuesta.
  const contextuales=unicas.filter(e=>{
   if(e.titular||e.titular_resuelto){if(norm(e.titular||e.titular_resuelto)!==norm(r.titular_nombre))return false;}
   if(e.tipos?.some(t=>t!=='no_determinado')&&!e.tipos.includes(q.tipo))return false;
   return fecha(e.fecha_bloque)&&(!q.fecha||e.fecha_bloque===q.fecha)&&r.estadias.some(s=>
    (!q.cabana||Number(s.cabanas?.numero)===q.cabana)&&String(s.cabanas?.numero)===String(e.cabana_contexto)&&
    operativa({...r,estadias:[s]},e.fecha_bloque,true));
  });
  // comparar() también llama «pendiente» a una evidencia sin pareja. Ese
  // estado por sí solo no acredita asociación con la reserva de la propuesta.
  const pendientesSeguros=unicas.filter(e=>e.estado==='pendiente'&&(
   lectura.comparar([e],[objetivo]).some(c=>c.estado==='pendiente'&&c.libro===e&&c.proyecto===objetivo)||
   contextuales.includes(e)&&e.resolucion==='contexto_unico'&&norm(e.titular_resuelto)===norm(r.titular_nombre)));
  const relevantes=unicas.filter(e=>e.estado==='pendiente'?pendientesSeguros.length===1&&pendientesSeguros[0]===e:e.numero===q.numero||fuertes.includes(e)||contextuales.includes(e));
  const pendiente=pendientesSeguros.length>0;
  const pendientesSinAsociar=!pendiente&&unicas.some(e=>e.estado==='pendiente');
  return {generacion,evidencias:relevantes,conflicto:conflictos.length>0,mensaje:conflictos.length?`Conflicto con el Libro: ${conflictos.map(e=>e.numero).join(', ')}; solicitado: ${q.numero}. Revisa antes de registrar.`:
   (fuertes.some(e=>e.numero===q.numero)?'Libro: encontrado y compatible.':unicas.some(e=>e.numero===q.numero)?'Libro: BOVE encontrado, contexto no concluyente.':`No encontré este BOVE en el Libro cargado. BOVE ${q.numero} no encontrado.`)+(pendiente?' El Libro aún figura PEND BOVE.':pendientesSinAsociar?' El Libro contiene pendientes, pero ninguno puede asociarse de forma segura a esta reserva.':'')+(!pendiente&&!fuertes.some(e=>e.estado!=='pendiente')?' Libro: sin evidencia asociable de forma segura.':'')+(faltantes.length?` Cobertura parcial: hojas no determinadas (${faltantes.join(', ')}).`:'')};
 }
 async function preparar(texto,opciones={}){
  const diaActual=opciones.dia||hoy();
  const q=typeof texto==='string'?interpretar(texto,diaActual):{...texto};
  if(!q||q.error)return {estado:'bloqueada',mensaje:q?.error||'Intención BOVE no reconocida.'};
  if(!numero(q.numero)||!['alojamiento','servicios',null].includes(q.tipo)||q.fecha&&!fecha(q.fecha)||!q.cabana&&!q.titular&&!opciones.reservaId)return {estado:'bloqueada',mensaje:'Propuesta BOVE inválida.'};
  const cliente=opciones.cliente||root.haikuSupabase,libro=opciones.libro===undefined?root.HAIKU_LIBRO_RESERVA_V1:opciones.libro;
  const lectura=opciones.lectura||root.HAIKU_ASISTENTE_BOVE_CONSULTAS_V1,permiso=opciones.permiso||(()=>root.haikuTienePermiso?.('pagos.verificar')===true),dia=q.fecha||diaActual;
  let vencida=false,timer;const control=()=>{if(vencida)throw Error('La preparación BOVE superó el tiempo de espera. Reintenta; no se escribió ningún dato.');};
  const ejecutar=async()=>{
   if(!permiso())return {estado:'bloqueada',mensaje:'No tienes el permiso pagos.verificar.'};
   if(!cliente)throw Error('La sesión de Proyecto H no está disponible.');
   const candidatas=(await filas(()=>{
    let consulta=cliente.from('reservas').select(campos.replace('reserva_estadias(','reserva_estadias!inner(')).lte('estadias.fecha_ingreso',dia).gte('estadias.fecha_salida',dia).order('id');
    if(opciones.reservaId)consulta=consulta.eq('id',opciones.reservaId);
    return consulta;
   })).filter(r=>compatibleDestino(r,q,dia));
   control();
   if(!candidatas.length)return {estado:'bloqueada',mensaje:`No encuentro una reserva operativa inequívoca para ese destino ${q.fecha?'el '+dia:'hoy'}.`};
   if(!opciones.reservaId&&candidatas.length>1)return {estado:'elegir_reserva',q,candidatas,mensaje:'Hay varias reservas compatibles. Selecciona la reserva para preparar; no se registrará ningún BOVE.'};
   const elegida=opciones.reservaId?candidatas.find(r=>r.id===opciones.reservaId):candidatas[0];
   if(!elegida)return {estado:'bloqueada',mensaje:'La reserva elegida ya no corresponde a la operación solicitada.'};
   // Lectura completa por ID: el filtro de candidatas no debe truncar segmentos.
   const rs=await filas(()=>cliente.from('reservas').select(campos).eq('id',elegida.id).order('id'));control();
   const r=rs[0];if(rs.length!==1||r.id!==elegida.id||!compatibleDestino(r,q,dia)||norm(r.titular_nombre)!==norm(elegida.titular_nombre))throw Error('Proyecto H cambió durante la resolución. Repite la consulta.');
   const cargos=await filas(()=>cliente.from('vista_estado_cargos').select('reserva_id,monto,saldo_cargo,tipo_cargo,estado').eq('reserva_id',r.id).eq('tipo_cargo','servicio').eq('estado','activo').order('reserva_id'));control();
   const servicios=cargos.filter(c=>c.tipo_cargo==='servicio'&&c.estado==='activo');
   const total=servicios.reduce((a,c)=>a+Number(c.monto),0),saldo=servicios.reduce((a,c)=>a+Number(c.saldo_cargo),0);
   if(!Number.isFinite(total)||!Number.isFinite(saldo))throw Error('No pude verificar los importes de servicios.');
   let tipo=opciones.tipo||q.tipo;
   if(!tipo){const posibles=[!valor(r.bove_cierre)&&'alojamiento',total>0&&!valor(r.bove_checkout)&&'servicios'].filter(Boolean);
    if(posibles.length===2)return {estado:'elegir_tipo',q,reserva:r,mensaje:'¿Corresponde a alojamiento o servicios?'};
    if(!posibles.length)return {estado:'bloqueada',reserva:r,mensaje:`No hay un alcance pendiente inequívoco. Alojamiento: ${valor(r.bove_cierre)||'pendiente'}; servicios: ${valor(r.bove_checkout)||'sin BOVE'}.`};tipo=posibles[0];}
   if(!['alojamiento','servicios'].includes(tipo))throw Error('Alcance inválido.');
   const actual=valor(r[tipo==='alojamiento'?'bove_cierre':'bove_checkout']);
   if(actual)return {estado:actual===q.numero?'sin_cambios':'bloqueada',reserva:r,mensaje:actual===q.numero?`El BOVE ${q.numero} ya está registrado para esta reserva. No hay cambios que realizar.`:`Proyecto H ya tiene BOVE ${actual}. Solicitaste ${q.numero}. No voy a reemplazarlo automáticamente.`};
   let finanzas={total,saldo};
   if(tipo==='servicios'){if(total<=0||saldo!==0)return {estado:'bloqueada',reserva:r,mensaje:'Servicios no tiene un total positivo completamente pagado.'};}
   else{const saldos=await filas(()=>cliente.from('vista_saldos_alojamiento_reserva').select('reserva_id,saldo_alojamiento,total_alojamiento').eq('reserva_id',r.id).order('reserva_id'));control();
    if(saldos.length!==1||saldos[0].saldo_alojamiento==null||Number(saldos[0].saldo_alojamiento)!==0)return {estado:'bloqueada',reserva:r,mensaje:'No se acredita el pago completo del alojamiento.'};finanzas=saldos[0];}
   const contraste=await comprobarLibro(r,{...q,tipo},libro,lectura,control);control();
   if(contraste.conflicto)return {estado:'bloqueada',reserva:r,libro:contraste,mensaje:contraste.mensaje};
   const p={estado:'propuesta',q:{...q,tipo},reserva:r,libro:contraste,dia,mensaje:`Se propone registrar BOVE ${q.numero} en ${tipo}. Fecha de referencia: ${dia}.${q.ano_inferido?' Año no indicado: se usa el año actual de America/Santiago.':''}`,bloqueo};
   propuestas.set(p,{q:{...q,tipo},id:r.id,sello:sello(r),finanzas:JSON.stringify(finanzas),dia,opciones:{...opciones,libro,lectura,cliente,permiso}});return p;
  };
  try{return await Promise.race([ejecutar(),new Promise((_,reject)=>{timer=setTimeout(()=>{vencida=true;try{control();}catch(e){reject(e);}},opciones.timeoutMs??20000);})]);}
  catch(e){return {estado:'bloqueada',mensaje:'No pude completar la preparación. '+e.message};}finally{clearTimeout(timer);}
 }
 async function revalidar(p){
  const original=propuestas.get(p);if(!original)return {estado:'bloqueada',mensaje:'Prepara una propuesta nueva antes de revalidar.'};
  if(!original.q.fecha&&(original.opciones.dia||hoy())!==original.dia)return {estado:'bloqueada',mensaje:'Cambió el día operativo. Prepara una propuesta nueva.'};
  const nueva=await preparar(original.q,{...original.opciones,reservaId:original.id,tipo:original.q.tipo});
  const datos=propuestas.get(nueva);
  if(!datos||datos.sello!==original.sello||datos.finanzas!==original.finanzas)return {estado:'bloqueada',mensaje:'Proyecto H o la comprobación del Libro cambió desde que preparaste esta acción. Revisa la propuesta nuevamente. '+(nueva.mensaje||'')};
  return {...nueva,estado:'revalidada',mensaje:'Segunda revalidación completada. No se guardó ningún BOVE.',bloqueo};
 }
 async function confirmar(){return {estado:'bloqueada',mensaje:bloqueo};}
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const descripcion=r=>`${r.titular_nombre} · ${(r.estadias||[]).map(e=>`CAB ${e.cabanas?.numero??'—'} · ${e.fecha_ingreso} → ${e.fecha_salida}`).join(' / ')}`;
 function encabezado(p){
  const r=p.reserva,q=p.q;if(!q)return descripcion(r);
  const segmentos=(r.estadias||[]).filter(e=>(!q.cabana||Number(e.cabanas?.numero)===q.cabana)&&operativa({...r,estadias:[e]},p.dia||q.fecha||hoy(),!!q.fecha));
  if(segmentos.length!==1)return descripcion(r);
  return descripcion({...r,estadias:segmentos})+(r.estadias.length>1?' · Reserva con otro segmento asociado':'');
 }
 function renderizar(p){
  return `<article class="haku-bove-preparacion"><h3>Preparación BOVE</h3><p>Sólo lectura · sin guardado</p>${p.reserva?`<strong>${esc(encabezado(p))}</strong>`:''}<p>${esc(p.mensaje)}</p>${p.libro?`<p>${esc(p.libro.mensaje)}</p>${p.libro.evidencias.map(e=>`<small>${esc(e.numero||e.estado)} · ${esc(e.origen?.hoja)}!${esc(e.origen?.celda)}</small>`).join('<br>')}`:''}${['propuesta','revalidada'].includes(p.estado)?`<p>Proyecto H: BOVE ${esc(p.q.tipo)} pendiente.</p><p>${esc(bloqueo)}</p>`:''}<div class="haku-bove-acciones">${p.estado==='elegir_reserva'?p.candidatas.map((r,i)=>`<button type="button" data-bove-elegir="${i}">${esc(descripcion(r))}</button>`).join(''):p.estado==='elegir_tipo'?'<button type="button" data-bove-tipo="alojamiento">Alojamiento</button><button type="button" data-bove-tipo="servicios">Servicios</button>':''}${p.estado==='propuesta'?'<button type="button" data-bove-revalidar>Revalidar propuesta</button>':''}${['propuesta','revalidada'].includes(p.estado)?'<button type="button" disabled aria-disabled="true" title="Protección atómica pendiente">Confirmar BOVE · bloqueado</button>':''}<button type="button" data-bove-cancelar>Cancelar</button></div></article>`;
 }
 function instalar(){
  const doc=root.document,style=doc.createElement('style');style.textContent='.haku-bove-preparacion{background:#f6faf7;color:#263e30;border:1px solid #cbded1;border-radius:14px;padding:14px;overflow-wrap:anywhere;font-size:12px}.haku-bove-preparacion h3{font-size:16px;margin:0 0 8px}.haku-bove-preparacion p{line-height:1.5}.haku-bove-acciones{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.haku-bove-acciones button{font:inherit;border:1px solid #b7cec0;border-radius:9px;padding:8px 12px;background:white;color:#294b37;cursor:pointer;max-width:100%}.haku-bove-acciones button:disabled{background:#eef1ef;color:#68766d;cursor:not-allowed}.haku-bove-acciones button:focus-visible{outline:2px solid #356949;outline-offset:2px}';doc.head.appendChild(style);
  let ocupado=false;
  async function procesar(t,campo,mensajes){
   if(ocupado)return;ocupado=true;campo.value='';campo.dispatchEvent(new root.Event('input',{bubbles:true}));
   const usuario=doc.createElement('div');usuario.className='haiku-asistente-mensaje haiku-asistente-mensaje--usuario';usuario.textContent=t;mensajes.appendChild(usuario);
   const el=doc.createElement('div');el.className='haiku-asistente-mensaje haiku-asistente-mensaje--asistente';el.textContent='Preparando propuesta BOVE…';mensajes.appendChild(el);
   let p;try{p=await preparar(t);el.innerHTML=renderizar(p);}finally{ocupado=false;mensajes.scrollTop=mensajes.scrollHeight;}
   let enCurso=false,cancelada=false;
   el.addEventListener('click',async e=>{
    const boton=e.target?.closest?.('button');if(!boton)return;
    e.preventDefault();e.stopPropagation();
    if(boton.hasAttribute('data-bove-cancelar')){cancelada=true;el.textContent='Preparación cancelada. No se guardó ningún BOVE.';return;}
    if(enCurso||cancelada)return;enCurso=true;boton.disabled=true;
    try{let siguiente;
     if(boton.hasAttribute('data-bove-revalidar')&&p.estado==='propuesta')siguiente=await revalidar(p);
     else if(boton.hasAttribute('data-bove-elegir')&&p.estado==='elegir_reserva'){const r=p.candidatas[Number(boton.dataset.boveElegir)];if(r)siguiente=await preparar(p.q,{reservaId:r.id});}
     else if(boton.hasAttribute('data-bove-tipo')&&p.estado==='elegir_tipo')siguiente=await preparar(p.q,{reservaId:p.reserva.id,tipo:boton.dataset.boveTipo});
     if(siguiente&&!cancelada){p=siguiente;el.innerHTML=renderizar(p);}
    }finally{enCurso=false;}
   });
  }
  function interceptar(e){
   const campo=doc.getElementById('haiku-asistente-texto'),mensajes=doc.getElementById('haiku-asistente-mensajes');if(!campo||!mensajes)return;
   if(e.type==='click'?!e.target?.closest?.('#haiku-asistente-enviar'):e.target!==campo)return;
   if(e.type==='keydown'&&(e.key!=='Enter'||e.shiftKey||e.isComposing))return;
   if(doc.getElementById('haiku-asistente-adjuntos')?.querySelector('.haiku-asistente-adjunto'))return;
   const t=campo.value.trim();if(!interpretar(t))return;e.preventDefault();e.stopImmediatePropagation();void procesar(t,campo,mensajes);
  }
  root.addEventListener('click',interceptar,true);root.addEventListener('keydown',interceptar,true);
 }
 const api=Object.freeze({interpretar,preparar,revalidar,confirmar,renderizar});root.HAIKU_ASISTENTE_BOVE_ESCRITURA_V1=api;
 if(typeof module!=='undefined')module.exports=api;if(root.document)instalar();
})(typeof window!=='undefined'?window:globalThis);
