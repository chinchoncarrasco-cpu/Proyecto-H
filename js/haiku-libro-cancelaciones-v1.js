/* Cancelaciones explícitas del Libro: lectura, propuesta y puente al flujo de ficha. */
(function(root){
 'use strict';
 const propuestas=new WeakMap(),normal=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 function vigente(g,libro){if(g===undefined||libro.estado().generacion!==g)throw Error('El Libro cambió. Genera un informe nuevo; esta cancelación quedó invalidada.');}
 function permiso(){if(root.haikuTienePermiso?.('reservas.cancelar')!==true)throw Error('No tienes permiso para cancelar reservas.');}
 async function filas(query){const out=[];for(let i=0;i<10000;i+=500){const {data,error}=await query().range(i,i+499);if(error)throw error;out.push(...(data||[]));if((data||[]).length<500)return out;}throw Error('Demasiadas candidatas: requiere revisión.');}
 async function comprobarCaso(caso,g,libro){
  vigente(g,libro);
  const hoja=caso.evidencia?.origen?.hoja;
  if(caso.fuente==='libro_actual'){
   const actual=await libro.consultarHoja(hoja,'actual','semantica');vigente(g,libro);
   comprobarEvidencia(caso.evidencia,actual);
   return;
  }
  if(!hoja||caso.anterior?.hoja!==hoja)throw Error('Cancelación entre hojas: requiere revisión manual.');
  const anterior=await libro.consultarHoja(hoja,'anterior','semantica'),actual=await libro.consultarHoja(hoja,'actual','semantica');vigente(g,libro);
  const resultado=root.HAIKU_LIBRO_DIFERENCIAS_V1.comparar([anterior],[actual]);
  const matches=(resultado.cancelaciones_confirmadas||[]).filter(x=>JSON.stringify(x)===JSON.stringify(caso));
  if(matches.length!==1)throw Error('La evidencia de cancelación ya no coincide. Vuelve a comparar.');
 }
 async function resolver(caso,cliente){
  const r=caso.fuente==='libro_actual'?caso.evidencia:caso.anterior;
  const estadias=await filas(()=>cliente.from('reserva_estadias').select('id,reserva_id').eq('fecha_ingreso',r.fecha_checkin).order('id'));
  const ids=[...new Set(estadias.map(e=>e.reserva_id))];if(!ids.length)throw Error('No encontré la reserva exacta en Proyecto H.');
  const rs=await filas(()=>cliente.from('reservas').select('id,titular_nombre,titular_numero_documento,correo_contacto,telefono_contacto,estado_reserva,estadias:reserva_estadias(id,fecha_ingreso,fecha_salida,estado_estadia,cabanas(numero))').in('id',ids).order('id'));
  const candidatos=rs.filter(v=>normal(v.titular_nombre)===normal(r.titular)&&v.estadias?.some(e=>e.fecha_ingreso===r.fecha_checkin));
  const compatibles=candidatos.filter(v=>compatible(r,v));
  if(compatibles.length!==1)throw Error('La reserva no se identifica de forma única; requiere revisión.');
  const v=compatibles[0];if(v.estadias.length!==1)throw Error('La reserva contiene varios segmentos; requiere revisión antes de cancelar.');
  if(v.estado_reserva!=='cancelada'&&!['pendiente','confirmada','hospedada','sin_checkin'].includes(v.estadias[0].estado_estadia))throw Error('Estado de estadía incompatible; requiere revisión manual.');
  for(const [a,b] of [['rut_documento','titular_numero_documento'],['correo','correo_contacto'],['telefono','telefono_contacto']]){
   const canon=x=>a==='rut_documento'?normal(x).replace(/[.\s-]/g,''):a==='telefono'?String(x).replace(/\D/g,''):normal(x);
   if(r[a]&&v[b]&&canon(r[a])!==canon(v[b]))throw Error('Los datos de identidad no coinciden; requiere revisión.');
  }
  return v;
 }
 function compatible(r,v){
  const e=v.estadias?.find(e=>e.fecha_ingreso===r.fecha_checkin);if(!e)return false;
  if(!Number.isFinite(Date.parse(e.fecha_salida))||Date.parse(e.fecha_salida)<Date.parse(e.fecha_ingreso))return false;
  let senales=0;
  const pares=[['noches',r.noches,(Date.parse(e.fecha_salida)-Date.parse(e.fecha_ingreso))/86400000],
   ['documento',r.rut_documento,v.titular_numero_documento],['correo',r.correo,v.correo_contacto],['telefono',r.telefono,v.telefono_contacto]];
  for(const [tipo,a,b] of pares){
   if(a==null||a===''||b==null||b==='')continue;
   const canon=x=>tipo==='noches'?Number(x):tipo==='documento'?normal(x).replace(/[.\s-]/g,''):tipo==='telefono'?String(x).replace(/\D/g,''):normal(x);
   if(canon(a)!==canon(b)||canon(a)==='')return false;senales++;
  }
  if(r.fecha_checkout&&r.fecha_checkout!==e.fecha_salida)return false;
  if(r.cabana&&Number(r.cabana)!==Number(e.cabanas?.numero))return false;
  return senales>0;
 }
 function comprobarEvidencia(e,hoja){
  const mismos=(hoja.cancelaciones||[]).filter(x=>normal(x.titular)===normal(e.titular)&&x.fecha_checkin===e.fecha_checkin);
  if(!hoja.cobertura?.geometria||e.bloque!=='CANCELACIONES'||!normal(e.titular)||!e.origen?.hoja||e.origen.hoja!==hoja.hoja||e.advertencias?.length||!/^\d{4}-\d{2}-\d{2}$/.test(e.fecha_checkin)||
   mismos.length!==1||JSON.stringify(mismos[0])!==JSON.stringify(e)||
   (hoja.reservas||[]).some(r=>normal(r.titular)===normal(e.titular)&&r.fecha_checkin===e.fecha_checkin))
   throw Error('La evidencia de cancelación no es única o tiene conflictos; requiere revisión manual.');
 }
 async function detectarActual(hoja,cliente=root.haikuSupabase){
  const out={cancelaciones_confirmadas:[],cancelaciones_revision:[],cancelaciones_ya_coinciden:[]};
  if(hoja.cancelaciones?.length){
   const session=await cliente?.auth?.getSession();
   if(session?.error||!session?.data?.session)throw Error('Inicia sesión para revisar las cancelaciones.');
  }
  for(const evidencia of hoja.cancelaciones||[]){
   try{
    comprobarEvidencia(evidencia,hoja);
    const caso={tipo:'cancelacion_confirmada',fuente:'libro_actual',evidencia:structuredClone(evidencia)};
    const v=await resolver(caso,cliente),e=v.estadias[0];
    caso.actual={...evidencia,cabana:e.cabanas?.numero,fecha_checkout:e.fecha_salida};
    caso.reserva_id=v.id;caso.estado_proyecto=v.estado_reserva;
    if(v.estado_reserva==='cancelada')out.cancelaciones_ya_coinciden.push(caso);
    else if(!['pendiente','confirmada','hospedada'].includes(v.estado_reserva))throw Error('Estado de Proyecto H no activo; requiere revisión manual.');
    else out.cancelaciones_confirmadas.push(caso);
   }catch(error){out.cancelaciones_revision.push(`${evidencia.titular} · ${evidencia.origen?.hoja}: ${error.message}`);}
  }
  return out;
 }
 async function preparar(caso,g,{libro=root.HAIKU_LIBRO_RESERVA_V1,cliente=root.haikuSupabase}={}){
  permiso();const session=await cliente.auth.getSession();if(session.error||!session.data?.session)throw Error('Inicia sesión para revisar la cancelación.');
  await comprobarCaso(caso,g,libro);const v=await resolver(caso,cliente);vigente(g,libro);
  if(caso.reserva_id&&caso.reserva_id!==v.id)throw Error('Proyecto H cambió. Vuelve a comparar.');
  if(v.estado_reserva!=='cancelada'&&!['pendiente','confirmada','hospedada'].includes(v.estado_reserva))throw Error('Estado no activo; requiere revisión manual.');
  const e=v.estadias[0];
  const vista={estado:v.estado_reserva==='cancelada'?'ya_coincide':'propuesta',titular:v.titular_nombre,cabana:e.cabanas?.numero,fecha_checkin:e.fecha_ingreso,fecha_checkout:e.fecha_salida,reserva_id:v.id};
  propuestas.set(vista,{caso:structuredClone(caso),g,libro,cliente,firma:JSON.stringify(v),id:v.id});return vista;
 }
 async function confirmar(vista){
  const p=propuestas.get(vista);if(!p)throw Error('Propuesta no válida.');
  if(vista.estado==='ya_coincide')return {estado:'ya_coincide'};
  permiso();vigente(p.g,p.libro);
  if(!root.HAIKU_RESERVA_ESTADOS_SUPABASE_V2?.cancelar)throw Error('El flujo de cancelación de ficha no está disponible.');
  return root.HAIKU_RESERVA_ESTADOS_SUPABASE_V2.cancelar(p.id,{antesDeCancelar:async()=>{
   permiso();await comprobarCaso(p.caso,p.g,p.libro);const actual=await resolver(p.caso,p.cliente);vigente(p.g,p.libro);
   if(actual.estado_reserva==='cancelada'){propuestas.delete(vista);return false;}
   if(JSON.stringify(actual)!==p.firma)throw Error('Proyecto H cambió desde la vista previa. Vuelve a preparar.');
   propuestas.delete(vista);return true;
  }});
 }
 // Presentación compartida: no transforma los casos ni decide acciones.
 function elemento(tag,clase,texto){const el=root.document.createElement(tag);el.className=clase;if(texto!=null)el.textContent=texto;return el;}
 function fechaVisual(fecha,completa=false){
  const m=String(fecha||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return fecha||'Sin fecha';
  return completa?`${m[3]}/${m[2]}/${m[1]}`:`${Number(m[3])} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][Number(m[2])-1]}`;
 }
 function cabecera(out,texto,n){const h=elemento('h3','haiku-cancelacion-titulo',texto);h.append(elemento('span','haiku-cancelacion-cantidad',`(${n})`));out.append(h);}
 function tarjeta(caso,resuelta=false){
  const r=caso.actual||caso.anterior,origen=caso.evidencia.origen;
  const box=elemento('section',`haku-libro-item haiku-cancelacion-card${resuelta?' haiku-cancelacion-card--resuelta':''}`);
  const top=elemento('div','haiku-cancelacion-top');top.append(elemento('span','haiku-cancelacion-badge',resuelta?'✓ Ya coincide':'Cancelación confirmada'),elemento('span','haiku-cancelacion-cab',`CAB ${r.cabana??'—'}`));
  const chips=elemento('div','haiku-cancelacion-chips');
  const fechas=elemento('span','haiku-cancelacion-chip',`${fechaVisual(r.fecha_checkin)} → ${fechaVisual(r.fecha_checkout)}`);fechas.title=`${r.fecha_checkin} → ${r.fecha_checkout}`;chips.append(fechas);
  if(r.noches!=null)chips.append(elemento('span','haiku-cancelacion-chip',`${r.noches} ${Number(r.noches)===1?'noche':'noches'}`));
  chips.append(elemento('span','haiku-cancelacion-chip',`Proyecto H: ${resuelta?'Cancelada':caso.fuente==='libro_actual'?'Activa':'pendiente de revalidar'}`));
  box.append(top,elemento('h4','haiku-cancelacion-nombre',r.titular),chips,
   elemento('p','haiku-cancelacion-secundario','Encontrada en:'),elemento('p','haiku-cancelacion-origen',`CANCELACIONES · ${origen.hoja} · ${origen.celda}`));
  if(resuelta)box.append(elemento('p','haiku-cancelacion-nota','No se requiere ninguna escritura.'));
  else box.append(elemento('p','haiku-cancelacion-secundario','Acción propuesta:'),elemento('p','haiku-cancelacion-accion','Cancelar reserva'));
  return box;
 }
 function mostrarEstado(status,texto,tipo='aviso'){
  status.replaceChildren();status.className=`haiku-cancelacion-status haiku-cancelacion-status--${tipo}`;status.textContent=texto;
 }
 function mostrarPreview(status,vista){
  status.textContent='';status.replaceChildren();status.className='haiku-cancelacion-status haiku-cancelacion-preview';
  status.append(elemento('strong','haiku-cancelacion-etiqueta','PREVISUALIZACIÓN · Sin escritura'),
   elemento('h4','haiku-cancelacion-nombre',vista.titular),elemento('p','haiku-cancelacion-origen',`CAB ${vista.cabana}`),
   elemento('p','haiku-cancelacion-origen',`${fechaVisual(vista.fecha_checkin,true)} → ${fechaVisual(vista.fecha_checkout,true)}`),
   elemento('p','haiku-cancelacion-nota','Estado actual: Activa'),elemento('p','haiku-cancelacion-accion','Nuevo estado: Cancelada'),
   elemento('p','haiku-cancelacion-secundario','Se revalidará después de confirmar.'));
 }
 function adjuntarResueltas(out,resultado){
  const casos=resultado.cancelaciones_ya_coinciden||[];if(!casos.length)return;
  cabecera(out,'Cancelaciones · Ya coincide',casos.length);for(const caso of casos)out.append(tarjeta(caso,true));
 }
 function adjuntarRevision(out,resultado){
  const casos=resultado.cancelaciones_revision||[];if(!casos.length)return;
  cabecera(out,'Cancelaciones por verificar',casos.length);
  for(const texto of casos){
   const box=elemento('section','haiku-cancelacion-card haiku-cancelacion-card--revision');
   box.append(elemento('span','haiku-cancelacion-badge','Revisión necesaria'));
   // Los avisos actuales son texto. Separar sólo su formato conocido y conservar el resto íntegro.
   const m=String(texto).match(/^(.+?) · ([^:]+): ([\s\S]+)$/);
   if(m)box.append(elemento('h4','haiku-cancelacion-nombre',m[1]),elemento('p','haiku-cancelacion-origen',m[2]),elemento('p','haiku-cancelacion-nota',m[3]));
   else box.append(elemento('p','haiku-cancelacion-nota',texto));
   box.append(elemento('p','haiku-cancelacion-secundario','Sin acción automática. Requiere revisión manual.'));out.append(box);
  }
 }
 function adjuntar(out,resultado,g){
  if(!resultado.cancelaciones_confirmadas?.length)return;
  cabecera(out,'Cancelaciones confirmadas',resultado.cancelaciones_confirmadas.length);
  for(const caso of resultado.cancelaciones_confirmadas||[]){
   const doc=root.document,box=tarjeta(caso),button=doc.createElement('button'),status=doc.createElement('div');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.className='haiku-cancelacion-status';
   const r=caso.actual||caso.anterior;
   button.type='button';button.className='libro-reserva-boton secundario haiku-cancelacion-boton';button.textContent='Preparar cancelación';button.setAttribute('aria-label',`Preparar cancelación · ${r.titular}`);
   let vista=null,ocupado=false,obsoleto=false;
   root.addEventListener('haiku:libro-cambio',()=>{obsoleto=true;button.disabled=true;mostrarEstado(status,'El Libro cambió. Esta propuesta quedó invalidada.');},{once:true});
   button.addEventListener('click',async()=>{
    if(ocupado||obsoleto)return;ocupado=true;button.disabled=true;
    try{if(!vista){mostrarEstado(status,'Comprobando cancelación contra Proyecto H…');vista=await preparar(caso,g);if(obsoleto)return;
      if(vista.estado==='ya_coincide')mostrarEstado(status,'✓ Ya coincide: la reserva ya está cancelada. No se escribirá.','resuelto');else mostrarPreview(status,vista);
      button.textContent=vista.estado==='ya_coincide'?'Ya coincide':'Confirmar cancelación';
      button.className='libro-reserva-boton secundario haiku-cancelacion-boton haiku-cancelacion-boton--confirmar';button.setAttribute('aria-label',button.textContent);
     }else{const r=await confirmar(vista);if(obsoleto)return;mostrarEstado(status,r?.estado==='cancelada'?'✓ Cancelación completada.':r?.estado==='sin_cambios'?'✓ Ya coincide: no se escribió.':'Cancelación no confirmada.',r?.estado==='cancelada'||r?.estado==='sin_cambios'?'resuelto':'aviso');if(r)vista.estado='ya_coincide';}
    }catch(e){mostrarEstado(status,e.message);vista=null;button.textContent='Volver a preparar cancelación';button.setAttribute('aria-label',button.textContent);button.className='libro-reserva-boton secundario haiku-cancelacion-boton';}
    finally{ocupado=false;button.disabled=obsoleto||vista?.estado==='ya_coincide';}
   });box.append(status,button);out.appendChild(box);
  }
 }
 const api=Object.freeze({preparar,confirmar,adjuntar,detectarActual,adjuntarResueltas,adjuntarRevision});root.HAIKU_LIBRO_CANCELACIONES_V1=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
