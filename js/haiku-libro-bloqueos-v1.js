/* Bloqueos del Libro: colección independiente y puente a la RPC de calendario existente. */
(function(root){
 'use strict';
 const previews=new WeakMap();
 const fechaChile=v=>{if(!v)return null;const d=new Date(v);if(!Number.isFinite(+d))return null;const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`;};
 const medianoche=v=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(v))==='00:00:00';
 const cruza=(a,b,c,d)=>a<d&&b>c;
 function vigente(g,libro){if(g===undefined||libro.estado().generacion!==g)throw Error('El Libro cambió. Vuelve a comparar; la propuesta quedó invalidada.');}
 async function sesion(cliente){const s=await cliente?.auth?.getSession();if(s?.error||!s?.data?.session)throw Error('Inicia sesión para revisar los bloqueos.');}
 function permiso(){if(root.haikuTienePermiso?.('cabanas.bloquear')!==true)throw Error('No tienes permiso para bloquear cabañas.');}
 async function filas(build){const rows=[];for(let i=0;i<10000;i+=500){const {data,error}=await build().range(i,i+499);if(error)throw error;rows.push(...(data||[]));if((data||[]).length<500)return rows;}throw Error('Lectura incompleta; requiere revisión manual.');}
 function validar(b){
  const fecha=f=>/^\d{4}-\d{2}-\d{2}$/.test(f)&&Number.isFinite(Date.parse(f))&&new Date(f).toISOString().slice(0,10)===f;
  if(!Number.isInteger(b.cabana)||b.cabana<=0||!fecha(b.fecha_inicio)||!fecha(b.fecha_fin)||b.fecha_fin<=b.fecha_inicio||!b.nota?.trim()||!b.origen?.hoja||!b.origen?.rango||b.evidencia?.geometria!=='disponibilidad_completa')throw Error('Evidencia incompleta; requiere revisión manual.');
 }
 async function comprobar(b,g,libro){
  vigente(g,libro);validar(b);const h=await libro.consultarHoja(b.origen.hoja,'actual','semantica');vigente(g,libro);
  const iguales=(h.bloqueos||[]).filter(x=>x.id===b.id);
  if(!h.cobertura?.geometria||iguales.length!==1||JSON.stringify(iguales[0])!==JSON.stringify(b)||
   (h.bloqueos||[]).some(x=>x.id!==b.id&&x.cabana===b.cabana&&cruza(x.fecha_inicio,x.fecha_fin,b.fecha_inicio,b.fecha_fin))||
   (h.reservas||[]).some(x=>x.cabana===b.cabana&&(x.fecha_checkin===x.fecha_checkout?x.fecha_checkin>=b.fecha_inicio&&x.fecha_checkin<b.fecha_fin:cruza(x.fecha_checkin,x.fecha_checkout,b.fecha_inicio,b.fecha_fin))))throw Error('La evidencia del Libro cambió o contiene cruces. Requiere revisión manual.');
 }
 async function revisar(b,cliente=root.haikuSupabase){
  validar(b);await sesion(cliente);
  const cs=await filas(()=>cliente.from('cabanas').select('id,numero,activa').eq('numero',b.cabana).eq('activa',true).order('id'));
  if(cs.length!==1)throw Error('Cabaña no identificada de forma única.');
  const id=cs[0].id;
  const blocks=await filas(()=>cliente.from('bloqueos_cabana').select('id,desde,hasta,motivo,estado').eq('cabana_id',id).eq('estado','activo').order('id'));
  const stays=await filas(()=>cliente.from('reserva_estadias').select('id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia').eq('cabana_id',id).order('id'));
  // Mismo intervalo semiabierto que haiku_registrar_bloqueo_calendario; incluye Full Day.
  if(stays.some(e=>!['cancelada','no_show'].includes(e.estado_estadia)&&
   (!e.fecha_ingreso||!e.fecha_salida||!['alojamiento','fullday','full_day'].includes(e.tipo_estadia)||
   (e.tipo_estadia==='alojamiento'?cruza(e.fecha_ingreso,e.fecha_salida,b.fecha_inicio,b.fecha_fin):e.fecha_ingreso>=b.fecha_inicio&&e.fecha_ingreso<b.fecha_fin))))return {estado:'revision',mensaje:'Existe una reserva real o una estadía no determinada en el intervalo. Sin acción automática.',cabana_id:id};
  const overlapping=blocks.filter(x=>{
   const start=fechaChile(x.desde),end=fechaChile(x.hasta);
   const fin=end&&!medianoche(x.hasta)?new Date(Date.parse(end+'T12:00:00Z')+86400000).toISOString().slice(0,10):end;
   return !start||cruza(start,fin||'9999-12-31',b.fecha_inicio,b.fecha_fin);
  });
  if(overlapping.length){
   const x=overlapping[0];
   if(overlapping.length===1&&fechaChile(x.desde)===b.fecha_inicio&&fechaChile(x.hasta)===b.fecha_fin&&medianoche(x.desde)&&medianoche(x.hasta)&&x.motivo===b.nota)return {estado:'ya_coincide',mensaje:'Ya coincide. Sin escritura.',cabana_id:id};
   return {estado:'revision',mensaje:'Hay otro bloqueo, un intervalo parcial o una nota diferente. Requiere revisión manual.',cabana_id:id};
  }
  // La RPC existente recorta espacios exteriores. No prometer una nota exacta que no conservaría.
  if(b.nota!==b.nota.trim())return {estado:'revision',mensaje:'La función existente recortaría espacios de la nota. Preparación bloqueada para conservar el original.',cabana_id:id};
  if(typeof cliente.rpc!=='function')return {estado:'revision',mensaje:'La función existente de bloqueos no está accesible. Sólo lectura.',cabana_id:id};
  return {estado:'no_existe',mensaje:'No existe',cabana_id:id};
 }
 async function comparar(bloqueos,cliente){
  const out=[];for(const bloqueo of bloqueos){try{
   if(bloqueos.some(x=>x!==bloqueo&&x.cabana===bloqueo.cabana&&cruza(x.fecha_inicio,x.fecha_fin,bloqueo.fecha_inicio,bloqueo.fecha_fin)))throw Error('Bloqueos superpuestos en el Libro. Requiere revisión manual.');
   out.push({bloqueo,...await revisar(bloqueo,cliente)});
  }catch(error){out.push({bloqueo,estado:'revision',mensaje:error.message});}}return out;
 }
 async function preparar(b,g,{libro=root.HAIKU_LIBRO_RESERVA_V1,cliente=root.haikuSupabase}={}){
  permiso();await comprobar(b,g,libro);const resultado=await revisar(b,cliente);vigente(g,libro);
  if(resultado.estado==='revision')throw Error(resultado.mensaje);
  const vista={bloqueo:structuredClone(b),...resultado};previews.set(vista,{b:structuredClone(b),g,libro,cliente,cabana_id:resultado.cabana_id});return vista;
 }
 async function confirmar(vista){
  const p=previews.get(vista);if(!p)throw Error('Vista previa no válida. Vuelve a preparar.');
  if(p.confirmando)throw Error('La confirmación de este bloqueo ya está en curso.');
  p.confirmando=true;
  try{
  permiso();await sesion(p.cliente);vigente(p.g,p.libro);
  if(vista.estado==='ya_coincide')return {estado:'ya_coincide'};
  if(root.confirm?.(`¿Crear bloqueo en CAB ${p.b.cabana}, del ${p.b.fecha_inicio} al ${p.b.fecha_fin}?\n${p.b.nota}`)!==true)return {estado:'sin_confirmar'};
  await comprobar(p.b,p.g,p.libro);const actual=await revisar(p.b,p.cliente);vigente(p.g,p.libro);permiso();
  if(actual.cabana_id!==p.cabana_id||actual.estado==='revision')throw Error(actual.mensaje||'Proyecto H cambió. Vuelve a preparar.');
  if(actual.estado==='ya_coincide'){previews.delete(vista);return {estado:'ya_coincide'};}
  // Consumir la propuesta antes de enviar: un error de red requiere releer, no repetir ciegamente.
  previews.delete(vista);
  const {data,error}=await p.cliente.rpc('haiku_registrar_bloqueo_calendario',{p_cabana_numero:p.b.cabana,p_desde:p.b.fecha_inicio,p_hasta:p.b.fecha_fin,p_motivo:p.b.nota});
  if(error)throw error;if(!data?.bloqueo_id)throw Error('Proyecto H no confirmó el bloqueo. Vuelve a comparar antes de reintentar.');
  // La RPC puede devolver un bloqueo concurrente que cubre el rango sin comparar la nota.
  const final=await revisar(p.b,p.cliente);
  try{await root.HAIKU_BLOQUEOS_CALENDARIO_SUPABASE_V1?.refrescar?.();}catch(_){/* La confirmación real no se revierte por un fallo del refresco visual. */}
  return final.estado==='ya_coincide'?{estado:data.ya_existia?'ya_coincide':'creado'}:{estado:'revision',mensaje:'Proyecto H devolvió un bloqueo que requiere revisar rango y nota. Vuelve a comparar.'};
  }finally{p.confirmando=false;}
 }
 function renderizar(out,resultado,g){
  if(!resultado?.length)return;const doc=root.document,el=(tag,clase,texto)=>{const n=doc.createElement(tag);n.className=clase;if(texto!=null)n.textContent=texto;return n;};
  out.append(el('h3','haiku-cancelacion-titulo',`Bloqueos del Libro (${resultado.length})`));
  for(const caso of resultado){const b=caso.bloqueo,card=el('section','haiku-cancelacion-card'),status=el('div','haiku-cancelacion-status');status.setAttribute('role','status');
   card.append(el('span','haiku-cancelacion-badge',caso.estado==='ya_coincide'?'✓ Ya coincide':caso.estado==='revision'?'Revisión necesaria':'Bloqueo'),
    el('h4','haiku-cancelacion-nombre',`CAB ${b.cabana}`),el('p','haiku-cancelacion-origen',`${b.fecha_inicio} → ${b.fecha_fin}`),
    el('p','haiku-cancelacion-nota haiku-bloqueo-nota',b.nota),el('p','haiku-cancelacion-secundario',`Origen: ${b.origen.hoja} · ${b.origen.rango}`),el('p','haiku-cancelacion-nota',`Proyecto H: ${caso.mensaje}`));
   if(caso.estado==='no_existe'){
    card.append(el('p','haiku-cancelacion-accion','Acción propuesta: Crear bloqueo'));const button=el('button','haiku-cancelacion-boton','Preparar bloqueo');button.type='button';
    let vista=null,busy=false,obsoleto=false;
    root.addEventListener('haiku:libro-cambio',()=>{obsoleto=true;button.disabled=true;status.textContent='El Libro cambió. Propuesta invalidada.';},{once:true});
    button.addEventListener('click',async()=>{if(busy||obsoleto)return;busy=true;button.disabled=true;
     try{if(!vista){vista=await preparar(b,g);if(obsoleto)return;status.textContent=vista.estado==='ya_coincide'?'Ya coincide. Sin escritura.':`PREVISUALIZACIÓN · Sin escritura\nCAB ${b.cabana} · ${b.fecha_inicio} → ${b.fecha_fin}\n${b.nota}\nSe revalidará después de confirmar.`;button.textContent=vista.estado==='ya_coincide'?'Ya coincide':'Confirmar bloqueo';}
      else{const r=await confirmar(vista);if(obsoleto)return;status.textContent=r.estado==='creado'?'✓ Bloqueo creado.':r.estado==='ya_coincide'?'✓ Ya coincide. Sin escritura.':r.mensaje||'Bloqueo no confirmado.';if(r.estado!=='sin_confirmar'){button.disabled=true;obsoleto=true;}}
     }catch(e){if(!obsoleto){status.textContent=e.message;vista=null;button.textContent='Volver a preparar bloqueo';}}
     finally{busy=false;button.disabled=obsoleto||vista?.estado==='ya_coincide';}
    });status.className+=' haiku-bloqueo-nota';card.append(status,button);
   }else card.append(el('p','haiku-cancelacion-secundario',caso.estado==='ya_coincide'?'No se requiere ninguna escritura.':'Sin acción automática.'));
   out.append(card);
  }
 }
 const api=Object.freeze({comparar,revisar,preparar,confirmar,renderizar});root.HAIKU_LIBRO_BLOQUEOS_V1=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
