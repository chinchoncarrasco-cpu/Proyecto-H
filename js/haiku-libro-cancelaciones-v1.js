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
  if(!hoja||caso.anterior?.hoja!==hoja)throw Error('Cancelación entre hojas: requiere revisión manual.');
  const anterior=await libro.consultarHoja(hoja,'anterior','semantica'),actual=await libro.consultarHoja(hoja,'actual','semantica');vigente(g,libro);
  const resultado=root.HAIKU_LIBRO_DIFERENCIAS_V1.comparar([anterior],[actual]);
  const matches=(resultado.cancelaciones_confirmadas||[]).filter(x=>JSON.stringify(x)===JSON.stringify(caso));
  if(matches.length!==1)throw Error('La evidencia de cancelación ya no coincide. Vuelve a comparar.');
 }
 async function resolver(caso,cliente){
  const r=caso.anterior;
  const estadias=await filas(()=>cliente.from('reserva_estadias').select('id,reserva_id').eq('fecha_ingreso',r.fecha_checkin).order('id'));
  const ids=[...new Set(estadias.map(e=>e.reserva_id))];if(!ids.length)throw Error('No encontré la reserva exacta en Proyecto H.');
  const rs=await filas(()=>cliente.from('reservas').select('id,titular_nombre,titular_numero_documento,correo_contacto,telefono_contacto,estado_reserva,estadias:reserva_estadias(id,fecha_ingreso,fecha_salida,estado_estadia,cabanas(numero))').in('id',ids).order('id'));
  const candidatos=rs.filter(v=>normal(v.titular_nombre)===normal(r.titular)&&v.estadias?.some(e=>e.fecha_ingreso===r.fecha_checkin&&e.fecha_salida===r.fecha_checkout&&Number(e.cabanas?.numero)===Number(r.cabana)));
  if(candidatos.length!==1)throw Error('La reserva no se identifica de forma única; requiere revisión.');
  const v=candidatos[0];if(v.estadias.length!==1)throw Error('La reserva contiene varios segmentos; requiere revisión antes de cancelar.');
  for(const [a,b] of [['rut_documento','titular_numero_documento'],['correo','correo_contacto'],['telefono','telefono_contacto']]){
   const canon=x=>a==='rut_documento'?normal(x).replace(/[.\s-]/g,''):a==='telefono'?String(x).replace(/\D/g,''):normal(x);
   if(r[a]&&v[b]&&canon(r[a])!==canon(v[b]))throw Error('Los datos de identidad no coinciden; requiere revisión.');
  }
  return v;
 }
 async function preparar(caso,g,{libro=root.HAIKU_LIBRO_RESERVA_V1,cliente=root.haikuSupabase}={}){
  permiso();const session=await cliente.auth.getSession();if(session.error||!session.data?.session)throw Error('Inicia sesión para revisar la cancelación.');
  await comprobarCaso(caso,g,libro);const v=await resolver(caso,cliente);vigente(g,libro);
  const vista={estado:v.estado_reserva==='cancelada'?'ya_coincide':'propuesta',titular:v.titular_nombre,cabana:caso.anterior.cabana,fecha_checkin:caso.anterior.fecha_checkin,fecha_checkout:caso.anterior.fecha_checkout,reserva_id:v.id};
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
 function adjuntar(out,resultado,g){
  if(!resultado.cancelaciones_confirmadas?.length)return;
  const titulo=root.document.createElement('h3');titulo.textContent=`Cancelaciones confirmadas (${resultado.cancelaciones_confirmadas.length})`;out.appendChild(titulo);
  for(const caso of resultado.cancelaciones_confirmadas||[]){
   const doc=root.document,box=doc.createElement('section'),button=doc.createElement('button'),status=doc.createElement('p');
   box.className='haku-libro-item';button.type='button';button.className='libro-reserva-boton secundario';button.textContent=`Preparar cancelación · ${caso.anterior.titular}`;
   const detalle=doc.createElement('p'),r=caso.anterior,origen=caso.evidencia.origen;
   detalle.textContent=`${r.titular} · CAB ${r.cabana} · ${r.fecha_checkin} → ${r.fecha_checkout}. Encontrada en CANCELACIONES de ${origen.hoja} · ${origen.celda}. Proyecto H: pendiente de revalidar. Acción propuesta: cancelar reserva, con confirmación independiente.`;
   box.append(detalle);
   let vista=null,ocupado=false,obsoleto=false;
   root.addEventListener('haiku:libro-cambio',()=>{obsoleto=true;button.disabled=true;status.textContent='El Libro cambió. Esta propuesta quedó invalidada.';},{once:true});
   button.addEventListener('click',async()=>{
    if(ocupado||obsoleto)return;ocupado=true;button.disabled=true;
    try{if(!vista){status.textContent='Comprobando cancelación contra Proyecto H…';vista=await preparar(caso,g);if(obsoleto)return;
      status.textContent= vista.estado==='ya_coincide'?'Ya coincide: la reserva ya está cancelada. No se escribirá.':`${vista.titular} · CAB ${vista.cabana} · ${vista.fecha_checkin} → ${vista.fecha_checkout}. Se propone Cancelada en Proyecto H. Se revalidará después de la confirmación.`;
      button.textContent=vista.estado==='ya_coincide'?'Ya coincide':'Confirmar cancelación';
     }else{const r=await confirmar(vista);if(obsoleto)return;status.textContent=r?.estado==='cancelada'?'Cancelación completada.':r?.estado==='sin_cambios'?'Ya coincide: no se escribió.':'Cancelación no confirmada.';if(r)vista.estado='ya_coincide';}
    }catch(e){status.textContent=e.message;vista=null;button.textContent='Volver a preparar cancelación';}
    finally{ocupado=false;button.disabled=obsoleto||vista?.estado==='ya_coincide';}
   });box.append(button,status);out.appendChild(box);
  }
 }
 const api=Object.freeze({preparar,confirmar,adjuntar});root.HAIKU_LIBRO_CANCELACIONES_V1=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
