/* Bloqueos del Libro: colección independiente y puente a la RPC de calendario existente. */
(function(root){
 'use strict';
 const previews=new WeakMap(),lotes=new WeakMap();
 const fechaChile=v=>{if(!v)return null;const d=new Date(v);if(!Number.isFinite(+d))return null;const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`;};
 // Inicio real del día local: el instante anterior aún pertenece a otra fecha.
 // En el salto DST de Santiago puede ser 01:00; no es una tolerancia de horas.
 const inicioDia=v=>{const fecha=fechaChile(v);return fecha!==null&&fechaChile(new Date(+new Date(v)-1))!==fecha;};
 const cruza=(a,b,c,d)=>a<d&&b>c;
 const equivalente=(x,b)=>fechaChile(x.desde)===b.fecha_inicio&&fechaChile(x.hasta)===b.fecha_fin&&inicioDia(x.desde)&&inicioDia(x.hasta)&&x.motivo===b.nota;
 function rangoSistema(x){const inicio=fechaChile(x.desde),fin=fechaChile(x.hasta);return {inicio,fin:fin&&!inicioDia(x.hasta)?new Date(Date.parse(fin+'T12:00:00Z')+86400000).toISOString().slice(0,10):fin};}
 async function leerBloqueos(cliente,id,cache){
  if(cache?.has(id))return cache.get(id);
  const rows=await filas(()=>cliente.from('bloqueos_cabana').select('id,desde,hasta,motivo,estado,actualizado_en').eq('cabana_id',id).eq('estado','activo').order('id'));
  cache?.set(id,rows);return rows;
 }
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
 async function revisar(b,cliente=root.haikuSupabase,cache){
  validar(b);await sesion(cliente);
  const cs=await filas(()=>cliente.from('cabanas').select('id,numero,activa').eq('numero',b.cabana).eq('activa',true).order('id'));
  if(cs.length!==1)throw Error('Cabaña no identificada de forma única.');
  const id=cs[0].id;
  const blocks=await leerBloqueos(cliente,id,cache);
  const stays=await filas(()=>cliente.from('reserva_estadias').select('id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia').eq('cabana_id',id).order('id'));
  // Mismo intervalo semiabierto que haiku_registrar_bloqueo_calendario; incluye Full Day.
  if(stays.some(e=>!['cancelada','no_show'].includes(e.estado_estadia)&&
   (!e.fecha_ingreso||!e.fecha_salida||!['alojamiento','fullday','full_day'].includes(e.tipo_estadia)||
   (e.tipo_estadia==='alojamiento'?cruza(e.fecha_ingreso,e.fecha_salida,b.fecha_inicio,b.fecha_fin):e.fecha_ingreso>=b.fecha_inicio&&e.fecha_ingreso<b.fecha_fin))))return {estado:'revision',mensaje:'Existe una reserva real o una estadía no determinada en el intervalo. Sin acción automática.',cabana_id:id};
  const overlapping=blocks.filter(x=>{
   const start=fechaChile(x.desde),end=fechaChile(x.hasta);
   const fin=end&&!inicioDia(x.hasta)?new Date(Date.parse(end+'T12:00:00Z')+86400000).toISOString().slice(0,10):end;
   return !start||cruza(start,fin||'9999-12-31',b.fecha_inicio,b.fecha_fin);
  });
  if(overlapping.length){
   const x=overlapping[0];
   if(overlapping.length===1&&equivalente(x,b))return {estado:'ya_coincide',mensaje:'Ya coincide. Sin escritura.',cabana_id:id};
   return {estado:'revision',mensaje:'Hay otro bloqueo, un intervalo parcial o una nota diferente. Requiere revisión manual.',cabana_id:id};
  }
  // La RPC existente recorta espacios exteriores. No prometer una nota exacta que no conservaría.
  if(b.nota!==b.nota.trim())return {estado:'revision',mensaje:'La función existente recortaría espacios de la nota. Preparación bloqueada para conservar el original.',cabana_id:id};
  if(typeof cliente.rpc!=='function')return {estado:'revision',mensaje:'La función existente de bloqueos no está accesible. Sólo lectura.',cabana_id:id};
  return {estado:'no_existe',mensaje:'No existe',cabana_id:id};
 }
 async function comparar(bloqueos,cliente,periodo){
  const cache=new Map();
  const out=[];for(const bloqueo of bloqueos){try{
   if(bloqueos.some(x=>x!==bloqueo&&x.cabana===bloqueo.cabana&&cruza(x.fecha_inicio,x.fecha_fin,bloqueo.fecha_inicio,bloqueo.fecha_fin)))throw Error('Bloqueos superpuestos en el Libro. Requiere revisión manual.');
   out.push({bloqueo,...await revisar(bloqueo,cliente,cache)});
  }catch(error){out.push({bloqueo,estado:'revision',mensaje:error.message});}}
  if(periodo?.desde&&periodo?.hasta){
   out.solo_proyecto_h=[];out.revision_inversa=[];
   try{
    await sesion(cliente);
    const cabanas=await filas(()=>cliente.from('cabanas').select('id,numero,activa').eq('activa',true).order('id'));
    const finConsulta=new Date(Date.parse(periodo.hasta+'T12:00:00Z')+86400000).toISOString().slice(0,10),vistos=new Set();
    for(const cab of cabanas.filter(c=>!periodo.cabana||Number(c.numero)===Number(periodo.cabana))){
     const rows=await leerBloqueos(cliente,cab.id,cache);
     for(const x of rows){
      if(!x.id||vistos.has(x.id))continue;vistos.add(x.id);
      if(periodo.nombre&&!String(x.motivo||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(periodo.nombre))continue;
      const rango=rangoSistema(x);
      if(rango.inicio&&rango.fin&&!cruza(rango.inicio,rango.fin,periodo.desde,finConsulta))continue;
      const item={id:x.id,cabana:Number(cab.numero),fecha_inicio:rango.inicio,fecha_fin:rango.fin,nota:x.motivo,consulta:periodo.texto,
       sistema:{id:x.id,cabana_id:cab.id,desde:x.desde,hasta:x.hasta,motivo:x.motivo,estado:x.estado,actualizado_en:x.actualizado_en}};
      if(out.some(c=>c.estado==='ya_coincide'&&c.cabana_id===cab.id&&equivalente(x,c.bloqueo)))continue;
      if(periodo.cabanas_revision?.includes(Number(cab.numero))){out.revision_inversa.push({...item,mensaje:'El Libro tiene una advertencia de disponibilidad en esta cabaña. No se puede afirmar que el bloqueo esté ausente. Revisión manual.'});continue;}
      const solapados=bloqueos.filter(b=>b.cabana===Number(cab.numero)&&rango.inicio&&cruza(b.fecha_inicio,b.fecha_fin,rango.inicio,rango.fin||'9999-12-31'));
      const cruceSistema=rows.some(y=>{if(y.id===x.id)return false;const r=rangoSistema(y);return !r.inicio||!r.fin||cruza(rango.inicio,rango.fin,r.inicio,r.fin);});
      if(!rango.inicio||!rango.fin||rango.fin<=rango.inicio||solapados.length||cruceSistema||cabanas.filter(c=>Number(c.numero)===Number(cab.numero)).length!==1){out.revision_inversa.push({...item,mensaje:'Intervalo no inequívoco o bloqueos solapados con diferencias. Revisión manual.'});continue;}
      out.solo_proyecto_h.push(item);
     }
    }
   }catch(error){out.solo_proyecto_h=[];out.revision_inversa=[];out.error_inversa='No se pudo completar la comparación inversa: '+error.message;}
  }
  return out;
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
  return await ejecutarRevalidado(p,()=>previews.delete(vista));
  }finally{p.confirmando=false;}
 }
 // Núcleo compartido: la confirmación individual o global ocurre antes de entrar aquí.
 async function ejecutarRevalidado(p,consumir,antesDeRpc=()=>{}){
  await comprobar(p.b,p.g,p.libro);const actual=await revisar(p.b,p.cliente);vigente(p.g,p.libro);permiso();
  if(actual.cabana_id!==p.cabana_id||actual.estado==='revision')throw Error(actual.mensaje||'Proyecto H cambió. Vuelve a preparar.');
  if(actual.estado==='ya_coincide'){consumir();return {estado:'ya_coincide'};}
  // Consumir la propuesta antes de enviar: un error de red requiere releer, no repetir ciegamente.
  consumir();antesDeRpc();
  const {data,error}=await p.cliente.rpc('haiku_registrar_bloqueo_calendario',{p_cabana_numero:p.b.cabana,p_desde:p.b.fecha_inicio,p_hasta:p.b.fecha_fin,p_motivo:p.b.nota});
  if(error)throw error;if(!data?.bloqueo_id)throw Error('Proyecto H no confirmó el bloqueo. Vuelve a comparar antes de reintentar.');
  // La RPC puede devolver un bloqueo concurrente que cubre el rango sin comparar la nota.
  const final=await revisar(p.b,p.cliente);
  try{await root.HAIKU_BLOQUEOS_CALENDARIO_SUPABASE_V1?.refrescar?.();}catch(_){/* La confirmación real no se revierte por un fallo del refresco visual. */}
  return final.estado==='ya_coincide'?{estado:data.ya_existia?'ya_coincide':'creado'}:{estado:'revision',mensaje:'Proyecto H devolvió un bloqueo que requiere revisar rango y nota. Vuelve a comparar.'};
 }
 function candidatosNuevos(resultado){
  return resultado.filter(c=>{try{validar(c.bloqueo);return c.estado==='no_existe';}catch(_){return false;}});
 }
 async function prepararTodos(resultado,g,{libro=root.HAIKU_LIBRO_RESERVA_V1,cliente=root.haikuSupabase}={}){
  permiso();vigente(g,libro);const items=[],privados=[];
  for(const {bloqueo} of candidatosNuevos(resultado)){
   const b=structuredClone(bloqueo);
   try{const v=await preparar(b,g,{libro,cliente});items.push(v);privados.push({...previews.get(v),estado:v.estado});}
   catch(error){items.push({bloqueo:b,estado:'revision',mensaje:error.message});privados.push({b,estado:'revision',mensaje:error.message});}
  }
  vigente(g,libro);const vista={items,cantidad:items.filter(c=>c.estado==='no_existe').length};
  lotes.set(vista,{items:privados,g,libro,cliente});return vista;
 }
 async function confirmarTodos(vista){
  const p=lotes.get(vista);if(!p)throw Error('Lote no válido o ya consumido. Vuelve a comparar.');
  if(p.confirmando)throw Error('El lote ya está en curso.');p.confirmando=true;
  try{
   permiso();await sesion(p.cliente);vigente(p.g,p.libro);
   const cantidad=p.items.filter(c=>c.estado==='no_existe').length;
   if(!cantidad||root.confirm?.(`Se intentarán crear ${cantidad} bloqueos en Proyecto H.\nCada bloqueo será revalidado individualmente antes de escribirse.\nLa operación es secuencial y no atómica.\n¿Confirmas?`)!==true)return {estado:'sin_confirmar'};
   lotes.delete(vista); // Nunca reutilizar una confirmación aceptada, incluso ante respuesta incierta.
   const reporte={estado:'completado',creados:[],omitidos:[],pendientes:[],fallo:null};
   for(let i=0;i<p.items.length;i++){
    const item=p.items[i],b=item.b;let enviada=false;
    if(item.estado!=='no_existe'){reporte.omitidos.push({bloqueo:b,estado:item.estado,mensaje:item.mensaje||'Ya existe'});continue;}
    try{
     const r=await ejecutarRevalidado(item,()=>{},()=>{enviada=true;});
     if(r.estado==='revision')throw Error(r.mensaje);
     if(r.estado==='creado')reporte.creados.push(b);
     else reporte.omitidos.push({bloqueo:b,estado:'ya_coincide',mensaje:'Ya existe'});
    }catch(error){
     if(!enviada){reporte.omitidos.push({bloqueo:b,estado:'revision',mensaje:error.message});continue;}
     reporte.estado='detenido';reporte.fallo={bloqueo:b,mensaje:error.message};
     reporte.pendientes=p.items.slice(i+1).map(x=>x.b);break;
    }
   }
   return reporte;
  }finally{p.confirmando=false;}
 }
 const detalle=b=>`CAB ${b.cabana} · ${b.fecha_inicio} → ${b.fecha_fin} · ${b.nota}`;
 function textoReporte(r){
  const existentes=r.omitidos.filter(x=>x.estado==='ya_coincide').length;
  return [r.estado==='completado'?'Proceso completado':'Proceso detenido',`Creados: ${r.creados.length}`,`Omitidos: ${r.omitidos.length} · Ya existían: ${existentes} · Requieren revisión: ${r.omitidos.length-existentes}`,`Pendientes por procesar: ${r.pendientes.length}`,`Fallos: ${r.fallo?1:0}`,
   ...r.creados.map(b=>'Creado · '+detalle(b)),...r.omitidos.map(x=>'Omitido · '+detalle(x.bloqueo)+' · '+x.mensaje),...r.pendientes.map(b=>'Pendiente · '+detalle(b)),
   ...(r.fallo?[`Falló: ${detalle(r.fallo.bloqueo)} · ${r.fallo.mensaje}`, 'La escritura fallida puede tener resultado incierto. Reconsulta antes de intentar otra operación; no se reintentó.']:[])].join('\n');
 }
 function renderizar(out,resultado,g,interno=false){
  if(!resultado)return;const doc=root.document,el=(tag,clase,texto)=>{const n=doc.createElement(tag);n.className=clase;if(texto!=null)n.textContent=texto;return n;};
  if(!resultado.length&&!resultado.solo_proyecto_h?.length&&!resultado.revision_inversa?.length&&!resultado.error_inversa)return;
  if(!interno){const grupo=el('div','haiku-bloqueos-grupo');out.append(grupo);out=grupo;}
  let loteEnCurso=false,obsoletoGrupo=false,individualesEnCurso=0;const botones=[];
  const seccion=el('details','haiku-comparacion-acordeon');seccion.open=false;
  seccion.append(el('summary','',`Bloqueos del Libro (${resultado.length})`));out.append(seccion);
  const cantidad=candidatosNuevos(resultado).length;
  if(cantidad){
   const button=el('button','haiku-cancelacion-boton',`Preparar todos los bloqueos nuevos (${cantidad})`),status=el('div','haiku-cancelacion-status haiku-bloqueo-nota');
   button.type='button';status.setAttribute('role','status');botones.push(button);seccion.append(button,status);let vista=null;
   root.addEventListener('haiku:libro-cambio',()=>{obsoletoGrupo=true;button.disabled=true;status.textContent+='\nEl Libro cambió. Vuelve a comparar.';seccion.open=true;},{once:true});
   button.addEventListener('click',async()=>{
    if(loteEnCurso||obsoletoGrupo||individualesEnCurso)return;loteEnCurso=true;seccion.open=true;
    const estados=botones.map(b=>b.disabled);botones.forEach(b=>b.disabled=true);
    try{
     if(!vista){
      status.textContent='Preparando bloqueos… Sin escritura.';vista=await prepararTodos(resultado,g);if(obsoletoGrupo)return;
      status.textContent=[`Se prepararon ${vista.cantidad} bloqueos nuevos. Sin escritura.`,...vista.items.map(x=>`${detalle(x.bloqueo)}${x.estado==='no_existe'?'':' · Omitido: '+(x.mensaje||'Ya existe')}`),'Se revalidarán individualmente. Operación secuencial, no atómica.'].join('\n');
      button.textContent=`Confirmar bloqueos nuevos (${vista.cantidad})`;if(!vista.cantidad)obsoletoGrupo=true;
     }else{
      const r=await confirmarTodos(vista);
      if(r.estado==='sin_confirmar'){status.textContent+='\nConfirmación cancelada. No se realizó ninguna escritura.';return;}
      status.textContent=textoReporte(r);obsoletoGrupo=true;
      if(r.estado==='completado'){
       try{
        const libro=root.HAIKU_LIBRO_RESERVA_V1;vigente(g,libro);
        const actualizado=await comparar(resultado.map(c=>c.bloqueo),root.haikuSupabase);vigente(g,libro);
        for(const k of ['solo_proyecto_h','revision_inversa','error_inversa'])actualizado[k]=resultado[k];
        out.replaceChildren();const actual=renderizar(out,actualizado,g,true);actual.append(status);actual.open=true;
       }catch(error){status.textContent+='\nNo se pudo refrescar la comparación: '+error.message;}
      }
     }
    }catch(error){status.textContent+='\n'+error.message;vista=null;button.textContent='Volver a preparar todos los bloqueos nuevos';}
    finally{seccion.open=true;loteEnCurso=false;botones.forEach((b,i)=>b.disabled=obsoletoGrupo||estados[i]);}
   });
  }
  for(const caso of resultado){const b=caso.bloqueo,card=el('section','haiku-cancelacion-card'),status=el('div','haiku-cancelacion-status');status.setAttribute('role','status');
   card.append(el('span','haiku-cancelacion-badge',caso.estado==='ya_coincide'?'✓ Ya coincide':caso.estado==='revision'?'Revisión necesaria':'Bloqueo'),
    el('h4','haiku-cancelacion-nombre',`CAB ${b.cabana}`),el('p','haiku-cancelacion-origen',`${b.fecha_inicio} → ${b.fecha_fin}`),
    el('p','haiku-cancelacion-nota haiku-bloqueo-nota',b.nota),el('p','haiku-cancelacion-secundario',`Origen: ${b.origen.hoja} · ${b.origen.rango}`),el('p','haiku-cancelacion-nota',`Proyecto H: ${caso.mensaje}`));
   if(caso.estado==='no_existe'){
    card.append(el('p','haiku-cancelacion-accion','Acción propuesta: Crear bloqueo'));const button=el('button','haiku-cancelacion-boton','Preparar bloqueo');button.type='button';
    botones.push(button);let vista=null,busy=false,obsoleto=false;
    root.addEventListener('haiku:libro-cambio',()=>{obsoleto=true;button.disabled=true;status.textContent='El Libro cambió. Propuesta invalidada.';seccion.open=true;},{once:true});
    button.addEventListener('click',async()=>{if(busy||obsoleto||loteEnCurso||obsoletoGrupo)return;busy=true;individualesEnCurso++;button.disabled=true;seccion.open=true;
     try{if(!vista){vista=await preparar(b,g);if(obsoleto)return;status.textContent=vista.estado==='ya_coincide'?'Ya coincide. Sin escritura.':`PREVISUALIZACIÓN · Sin escritura\nCAB ${b.cabana} · ${b.fecha_inicio} → ${b.fecha_fin}\n${b.nota}\nSe revalidará después de confirmar.`;button.textContent=vista.estado==='ya_coincide'?'Ya coincide':'Confirmar bloqueo';}
      else{const r=await confirmar(vista);if(obsoleto)return;status.textContent=r.estado==='creado'?'✓ Bloqueo creado.':r.estado==='ya_coincide'?'✓ Ya coincide. Sin escritura.':r.mensaje||'Bloqueo no confirmado.';if(r.estado!=='sin_confirmar'){button.disabled=true;obsoleto=true;}}
     }catch(e){if(!obsoleto){status.textContent=e.message;vista=null;button.textContent='Volver a preparar bloqueo';}}
     finally{seccion.open=true;busy=false;individualesEnCurso--;button.disabled=obsoleto||vista?.estado==='ya_coincide';}
    });status.className+=' haiku-bloqueo-nota';card.append(status,button);
   }else card.append(el('p','haiku-cancelacion-secundario',caso.estado==='ya_coincide'?'No se requiere ninguna escritura.':'Sin acción automática.'));
   seccion.append(card);
  }
  for(const [titulo,items,revision] of [['Bloqueos sólo en Proyecto H',resultado.solo_proyecto_h,false],['Bloqueos de Proyecto H por revisar',resultado.revision_inversa,true]]){
   if(!items?.length)continue;let destino=out;
   if(revision)out.append(el('h3','haiku-cancelacion-titulo',`${titulo} (${items.length})`));
   else{destino=el('details','haiku-comparacion-acordeon haiku-comparacion-acordeon--revision');destino.open=false;destino.append(el('summary','',`${titulo} (${items.length})`));out.append(destino);}
   for(const b of items){const card=el('section','haiku-cancelacion-card');
    const retiro=!revision&&root.HAIKU_LIBRO_BLOQUEOS_RETIRO_V1?.puedePreparar(b);
    card.append(el('h4','haiku-cancelacion-nombre',`CAB ${b.cabana}`),el('p','haiku-cancelacion-origen',`${b.fecha_inicio||'Fecha no determinada'} → ${b.fecha_fin||'Fin no determinado'}`),el('p','haiku-cancelacion-nota haiku-bloqueo-nota',b.nota||'Sin motivo registrado'),el('p','haiku-cancelacion-secundario',revision?b.mensaje:'No aparece en el Libro actual.'),el('p','haiku-cancelacion-secundario',revision?'Sólo lectura. Sin acción automática.':retiro?'Revisar antes de eliminar.':'Revisar antes de eliminar. Sólo lectura.'));
    if(retiro)root.HAIKU_LIBRO_BLOQUEOS_RETIRO_V1.adjuntar(card,b,g,destino,(nuevo,status)=>{
     out.replaceChildren();renderizar(out,nuevo.bloqueos_comparacion,nuevo.generacion,true);out.append(status);
    });destino.append(card);
   }
  }
  if(resultado.error_inversa)out.append(el('p','haiku-cancelacion-secundario',resultado.error_inversa));
  return seccion;
 }
 const api=Object.freeze({comparar,revisar,preparar,confirmar,prepararTodos,confirmarTodos,renderizar});root.HAIKU_LIBRO_BLOQUEOS_V1=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
