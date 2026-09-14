/* Reconciliación del Libro: preparación y liberación individual con versión esperada. */
(function(root){
 'use strict';
 const propuestas=new WeakMap(),cambio='El bloqueo cambió desde la vista previa. Requiere revisión.';
 const claves=['id','cabana_id','desde','hasta','motivo','estado','actualizado_en'];
 const firma=s=>JSON.stringify(claves.map(k=>s?.[k]));
 const puedePreparar=b=>!!(b?.id&&b.consulta&&b.sistema?.actualizado_en&&b.sistema.estado==='activo'&&b.sistema.id===b.id);
 function vigente(p){if(p.libro.estado().generacion!==p.g)throw Error('El Libro cambió. Vuelve a comparar.');}
 function permiso(){if(root.haikuTienePermiso?.('cabanas.liberar')!==true)throw Error('No tienes permiso para liberar cabañas.');}
 async function revalidar(p){
  permiso();vigente(p);
  // Mismo flujo mensual e inverso: conserva sus filtros, cobertura y casos de revisión.
  const actualizado=await root.HAIKU_LIBRO_CONSULTAS.consultar(p.b.consulta,p.libro,p.cliente);vigente(p);
  const {data,error}=await p.cliente.from('bloqueos_cabana').select(claves.join(',')).eq('id',p.b.id).limit(2);
  if(error)throw error;vigente(p);permiso();
  if(!data?.length)return {estado:'ya_no_existe',actualizado};
  if(data.length!==1)throw Error(cambio);
  const s=data[0];
  if(s.estado!=='activo')return {estado:'ya_liberado',actualizado};
  if(firma(s)!==firma(p.b.sistema))throw Error(cambio);
  const candidatos=actualizado.bloqueos_comparacion?.solo_proyecto_h?.filter(b=>b.id===p.b.id)||[];
  if(candidatos.length!==1)throw Error('El bloqueo reapareció en el Libro o su ausencia no es inequívoca. Requiere revisión.');
  const b=candidatos[0];
  if(b.cabana!==p.b.cabana||b.fecha_inicio!==p.b.fecha_inicio||b.fecha_fin!==p.b.fecha_fin||b.nota!==p.b.nota||firma(b.sistema)!==firma(s))throw Error(cambio);
  return {estado:'propuesta',actualizado};
 }
 async function preparar(b,g,{libro=root.HAIKU_LIBRO_RESERVA_V1,cliente=root.haikuSupabase}={}){
  if(!puedePreparar(b))throw Error('Falta una lectura inequívoca y versionada de Proyecto H. Vuelve a comparar.');
  const p={b:structuredClone(b),g,libro,cliente};const r=await revalidar(p);
  const vista={bloqueo:structuredClone(p.b),estado:r.estado};propuestas.set(vista,p);return vista;
 }
 async function confirmar(vista){
  const p=propuestas.get(vista);if(!p||p.ocupado)throw Error('Propuesta no válida o ya en curso. Vuelve a comparar.');
  p.ocupado=true;
  try{
   permiso();vigente(p);
   if(root.confirm?.(`CAB ${p.b.cabana} · ${p.b.fecha_inicio} → ${p.b.fecha_fin}\n${p.b.nota}\nHaku volverá a comprobar el Libro y Proyecto H antes de quitar este bloqueo. ¿Confirmas?`)!==true)return {estado:'sin_confirmar'};
   const r=await revalidar(p);
   propuestas.delete(vista);
   if(r.estado!=='propuesta')return r;
   const {data,error}=await p.cliente.rpc('haiku_liberar_bloqueo_libro_seguro',{
    p_bloqueo_id:p.b.id,p_cabana_numero:p.b.cabana,p_desde:p.b.fecha_inicio,
    p_hasta:p.b.fecha_fin,p_motivo:p.b.nota,p_actualizado_en:p.b.sistema.actualizado_en
   });
   if(error)throw error;
   if(data?.bloqueo_id!==p.b.id||!['liberado','ya_liberado','ya_no_existe'].includes(data.resultado))throw Error('Respuesta no confirmada. Reconsulta antes de reintentar.');
   let actualizado,aviso;
   try{actualizado=await root.HAIKU_LIBRO_CONSULTAS.consultar(p.b.consulta,p.libro,p.cliente);vigente(p);}catch(e){actualizado=null;aviso='No se pudo refrescar: '+e.message;}
   try{await root.HAIKU_BLOQUEOS_CALENDARIO_SUPABASE_V1?.refrescar?.();}catch(_){/* La liberación confirmada no se revierte por un fallo visual. */}
   return {estado:data.resultado,actualizado,aviso};
  }finally{p.ocupado=false;}
 }
 function adjuntar(card,b,g,seccion,alActualizar){
  if(!puedePreparar(b))return false;
  const doc=root.document,button=doc.createElement('button'),status=doc.createElement('div');
  button.type='button';button.className='haiku-cancelacion-boton';button.textContent='Preparar eliminación';
  status.className='haiku-cancelacion-status haiku-bloqueo-nota';status.setAttribute('role','status');
  let vista=null,ocupado=false,obsoleto=false;
  root.addEventListener('haiku:libro-cambio',()=>{obsoleto=true;button.disabled=true;status.textContent='El Libro cambió. Propuesta invalidada.';seccion.open=true;},{once:true});
  button.addEventListener('click',async()=>{
   if(ocupado||obsoleto)return;ocupado=true;button.disabled=true;seccion.open=true;
   try{
    if(!vista){
     vista=await preparar(b,g);if(obsoleto)return;
     status.textContent=vista.estado==='propuesta'?`PREVISUALIZACIÓN · Sin escritura\nCAB ${b.cabana} · ${b.fecha_inicio} → ${b.fecha_fin}\n${b.nota}\nEste bloqueo existe en Proyecto H pero ya no aparece en el Libro actual.`:'Ya no existe un bloqueo activo. Sin escritura.';
     button.textContent=vista.estado==='propuesta'?'Confirmar eliminación':'Ya no existe';if(vista.estado!=='propuesta')obsoleto=true;
    }else{
     const r=await confirmar(vista);
     if(r.estado==='sin_confirmar'){status.textContent+='\nConfirmación cancelada. Sin escritura.';return;}
     obsoleto=true;status.textContent=(r.estado==='liberado'?'Bloqueo liberado.':'Ya no existe un bloqueo activo. Sin escritura.')+(r.aviso?'\n'+r.aviso:'');
     if(r.actualizado)alActualizar(r.actualizado,status);
    }
   }catch(e){obsoleto=true;status.textContent=e.message+'\nVuelve a comparar antes de reintentar.';}
   finally{ocupado=false;button.disabled=obsoleto;seccion.open=true;}
  });card.append(status,button);return true;
 }
 const api=Object.freeze({puedePreparar,preparar,confirmar,adjuntar});root.HAIKU_LIBRO_BLOQUEOS_RETIRO_V1=api;
})(typeof window!=='undefined'?window:globalThis);
