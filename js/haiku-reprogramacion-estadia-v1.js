// Vista previa compartida Haku/Libro. El servidor decide identidad y disponibilidad.
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.HAIKU_REPROGRAMACION_V1=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const UUID=()=>root.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.random()*16|0;return(c==='x'?n:(n&3)|8).toString(16);});
 const defaults=p=>Object.fromEntries(p.items.map(i=>[i.id,i.inicial]));
 const pendientes=(p,d)=>p.items.filter(i=>!i.opciones.includes(d[i.id]));
 const valida=(p,d)=>!p.bloqueos.length&&!pendientes(p,d).length;
 const fecha=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?d.split('-').reverse().join('/'):'sin traslado';
 const tramo=o=>`CAB ${o.cabana_numero} · ${fecha(o.fecha_ingreso)} → ${fecha(o.fecha_salida)}`;
 const moneda=n=>'$'+Number(n).toLocaleString('es-CL');
 async function abrirRevision(p,tipo){
  if(root.haikuTienePermiso?.('reservas.ver')!==true)throw Error('Se requiere permiso para revisar la reserva.');
  if(tipo==='historial'){
   if(typeof root.HistorialSupabase?.abrirReserva!=='function')throw Error('El historial no está disponible. Abre Reservas, selecciona la reserva y pulsa Historial.');
   await root.HistorialSupabase.abrirReserva(p.reserva_id,{cabana:p.origen.cabana_numero});return;
  }
  const api=root.HAIKU_RESUMEN_RESERVA_SITES_V1;
  if(typeof api?.abrirPorId!=='function')throw Error('La ficha no está disponible. Abre Reservas y selecciona esta reserva por su ID.');
  if(await api.abrirPorId(p.reserva_id,null,{estadiaId:p.estadia_id,numeroCabana:String(p.origen.cabana_numero)})===false)throw Error('No se pudo abrir la estadía; vuelve a buscarla en Reservas.');
 }
 async function leer(cliente,reservaId,estadiaId,destino){
  const {data,error}=await cliente.rpc('haiku_reprogramacion_preparar_v1',{p_reserva_id:reservaId,p_estadia_id:estadiaId,p_destino:destino});
  if(error)throw Error(/PGRST202|42883/.test(error.code||'')?'La reprogramación conjunta requiere la migración pendiente; no se guardará un traslado parcial.':error.message||'No se pudo comprobar servicios y notas.');
  if(data?.version!==1||data.reserva_id!==reservaId||data.estadia_id!==estadiaId||!Array.isArray(data.items)||!Array.isArray(data.bloqueos)||!data.snapshot||!data.firma)
   throw Error('La revisión operativa está incompleta. Vuelve a preparar.');
  return data;
 }
 function diferencias(a,b){
  const cambios=[];
  for(const [k,n]of [['reserva','reserva'],['estadia','fechas, cabaña o estado de la estadía'],['servicios','servicios'],['notas','notas operativas'],['noches','noches'],['finanzas','cargos o pagos'],['destino_catalogo','cabaña destino'],['recursos','recursos']])
   if(JSON.stringify(a.snapshot[k])!==JSON.stringify(b.snapshot[k]))cambios.push(n);
  for(const i of b.items){const antes=a.items.find(x=>x.id===i.id);if(antes&&JSON.stringify([i.fecha_propuesta,i.estado,i.conflictos])!==JSON.stringify([antes.fecha_propuesta,antes.estado,antes.conflictos]))
   cambios.push(`${i.nombre}: ${i.motivo}`);}
  if(JSON.stringify(a.bloqueos)!==JSON.stringify(b.bloqueos))cambios.push(...b.bloqueos);
  return [...new Set(cambios)];
 }
 function css(){if(!root.document||document.getElementById('haku-reprogramacion-css'))return;
  const link=document.createElement('link');link.id='haku-reprogramacion-css';link.rel='stylesheet';link.href='css/haiku-reprogramacion-estadia-v1.css?v=20261116-2';document.head.append(link);
 }
 function renderizar(p,d,onChange=()=>{}){
  css();const el=(t,c,text)=>{const e=document.createElement(t);e.className=c||'';if(text!=null)e.textContent=text;return e;};
  const panel=el('section','haku-reprogramacion');panel.dataset.hakuReprogramacion='1';
  panel.append(el('h3','','Reprogramar estadía, servicios y notas'));
  const recorrido=el('div','haku-reprogramacion-recorrido');
  for(const [titulo,v]of [['Origen',p.origen],['Destino',p.destino]]){const box=el('div');box.append(el('strong','',titulo),el('p','',tramo(v)));recorrido.append(box);}panel.append(recorrido);
  panel.append(el('p','haku-reprogramacion-finanzas',p.politica_financiera));
  for(const b of p.bloqueos)panel.append(el('p','haku-reprogramacion-bloqueo',b));
  if(p.bloqueos.length){
   const acciones=el('div','haku-reprogramacion-accesos'),aviso=el('p');aviso.setAttribute('role','status');
   for(const [tipo,texto]of [['ficha','Abrir ficha de esta estadía'],['historial','Revisar historial de la reserva']]){
    const b=el('button','',texto);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await abrirRevision(p,tipo);aviso.textContent='Revisión abierta; la reprogramación permanece sin guardar.';}catch(e){aviso.textContent=e.message;}finally{b.disabled=false;}});acciones.append(b);
   }panel.append(el('p','','Revisa las fechas y estados en la ficha; los cargos y sus aplicaciones en Pagos; el registro de ingreso/salida en Historial. Este traslado no reinicia esos registros.'),acciones,aviso);
  }
  const estado=el('p','haku-reprogramacion-pendientes');estado.setAttribute('role','status');
  const actualizar=()=>{const n=pendientes(p,d).length;estado.textContent=p.bloqueos.length?'Hay bloqueos. Abre la ficha o el historial para revisar antes de continuar.':n?`${n} decisión(es) pendiente(s). No se puede confirmar todavía.`:'Decisiones completas. Revisa el origen y destino antes de confirmar.';onChange({...d});};
  for(const tipo of ['noche','servicio','nota']){
   const seccion=el('details','haku-reprogramacion-seccion');seccion.open=true;
   const items=p.items.filter(i=>i.tipo===tipo);if(tipo==='noche'&&!items.length)continue;
   seccion.append(el('summary','',`${tipo==='noche'?'Noches y cargos':tipo==='servicio'?'Servicios':'Notas'} (${items.length})`));
   if(tipo==='noche')seccion.append(el('p','','Noches verificadas de esta estadía: '+moneda(items.reduce((s,i)=>s+i.monto_antes,0))+' → '+moneda(items.reduce((s,i)=>s+i.monto_despues,0))+'. Los servicios se revisan aparte.'));
   if(!items.length)seccion.append(el('p','','Sin registros asociados.'));
   for(const i of items){
    const fila=el('div','haku-reprogramacion-fila');fila.dataset.registroId=i.registro_id;
    const identidad=el('div','haku-reprogramacion-identidad');identidad.append(el('strong','',i.nombre),el('small','',i.estado_original||({otra_estadia:'Otra estadía',historico:'Se conserva',revision:'Requiere decisión',trasladable:'Traslado propuesto'})[i.estado]));
    const antes=el('div','haku-reprogramacion-fecha');antes.append(el('span','','Antes'),el('p','',`${fecha(i.fecha_anterior)}${i.hora_inicio?' · '+i.hora_inicio.slice(0,5)+'–'+i.hora_fin.slice(0,5):''}`));
    const despues=el('div','haku-reprogramacion-fecha');despues.append(el('span','','Propuesta'),el('p','',`${fecha(i.fecha_propuesta)}${i.fecha_propuesta&&i.hora_inicio?' · '+i.hora_inicio.slice(0,5)+'–'+i.hora_fin.slice(0,5):''}`));
    if(tipo==='noche'){antes.append(el('p','',moneda(i.monto_antes)));despues.append(el('p','',moneda(i.monto_despues)));}
    const razon=el('p','haku-reprogramacion-motivo',i.motivo);
    fila.append(identidad,antes,despues);
    if(i.opciones.length>1||i.inicial===null){
     const label=el('label','haku-reprogramacion-decision','Decisión'),select=el('select');select.setAttribute('aria-label','Decisión · '+i.nombre);
     const vacio=el('option','','Elige una decisión');vacio.value='';select.append(vacio);
     for(const o of i.opciones){const opt=el('option','',o==='aprobar'?(i.operacion==='agregar'?'Aprobar noche y cargo de '+moneda(i.tarifa):'Aprobar retiro · conservar historial'):({mover:'Trasladar al destino propuesto',revision:'Dejar para revisión · no trasladar',conservar:'Conservar fecha e historial'})[o]);opt.value=o;select.append(opt);}
     select.value=d[i.id]||'';select.addEventListener('change',()=>{d[i.id]=select.value||null;actualizar();});label.append(select);fila.append(label);
    }else fila.append(el('span','haku-reprogramacion-decision','Conservar · sin cambios'));
    fila.append(razon);seccion.append(fila);
   }panel.append(seccion);
  }panel.append(estado);actualizar();return panel;
 }
 async function preparar(opciones){
  const {cliente=root.haikuSupabase,reservaId,estadiaId,destino,identidad,onGuardado}=opciones;
  const p=await leer(cliente,reservaId,estadiaId,destino),d=defaults(p),op=UUID();let intento=false;
  const sesion=await cliente.auth.getSession(),uid=sesion.data?.session?.user?.id;if(!uid||sesion.error)throw Error('Inicia sesión para revisar esta reprogramación.');
  const observadores=new Set();const propuesta={identidad,filas:[],etiqueta:'Confirmar reprogramación',
   puedeGuardar:()=>valida(p,d),alCambiar:fn=>{observadores.add(fn);fn(valida(p,d));},
   renderizar:out=>out.append(renderizar(p,d,()=>observadores.forEach(fn=>fn(valida(p,d))))),
   revisar:()=>preparar(opciones),propuesta:p,decisiones:d,
   async guardar(){
    if(!valida(p,d))throw Error(p.bloqueos.join(' ')||'Resuelve las decisiones pendientes.');
    const s=await cliente.auth.getSession();if(s.error||s.data?.session?.user?.id!==uid)throw Error('La sesión cambió. Vuelve a revisar.');
    const nueva=await leer(cliente,reservaId,estadiaId,destino),diff=diferencias(p,nueva);
    if(!intento&&(p.firma!==nueva.firma||diff.length))throw Object.assign(Error('Cambió '+diff.join(' · ')+'. Revisa nuevamente antes de confirmar.'),{reprogramacionActual:nueva});
    intento=true;
    const {data,error}=await cliente.rpc('haiku_reprogramar_estadia_v1',{p_operacion_id:op,p_propuesta:p,p_decisiones:d});
    if(error)throw Object.assign(Error(error.message||'No se confirmó la reprogramación.'),{...(error.code==='HLC01'?{reprogramacionActual:await leer(cliente,reservaId,estadiaId,destino)}:{})});
    if(data?.ok!==true||data.estadia_id!==estadiaId||data.reserva_id!==reservaId||!(data.finanzas_conservadas===true||data.vinculos_financieros_conservados===true))throw Error('Reprogramación sin resultado confirmado; reintenta la misma operación.');
    await Promise.allSettled([()=>onGuardado?.(data),()=>root.HAIKU_SERVICIOS_HIDRATACION_V2?.sincronizar?.('reprogramación confirmada'),
        ()=>root.HAIKU_SITES_SERVICIOS_V1?.refrescar?.(),()=>root.haikuRefrescarFichaSupabaseV2?.(reservaId),
        ()=>root.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(),()=>root.HAIKU_NOTAS_RESUMEN_SUPABASE_V1?.refrescar?.(undefined,false)].map(fn=>Promise.resolve().then(fn)));
    return `Reprogramación confirmada · ${tramo(data.destino)}. ${data.cambios.filter(i=>i.tipo==='servicio').length} servicio(s) y ${data.cambios.filter(i=>i.tipo==='nota').length} nota(s) trasladados. ${data.servicios_revision.length} servicio(s) para revisión. ${data.cambios.filter(i=>i.tipo==='noche').length} cambio(s) de noches aprobado(s). Pagos, aplicaciones e historial conservados.`;
   }};return propuesta;
 }
 function revisionServicio(s){const r=s?.reprogramacion_revision_v1;if(!r||r.version!==1||!['programado','pendiente'].includes(s.estado_servicio||s.estadoServicioDb))return false;
  return String(s.fecha_servicio||s.fechaServicio||s.fecha).slice(0,10)===r.fecha&&String(s.hora_inicio||s.hora||'').slice(0,5)===String(r.inicio||'').slice(0,5);}
 return Object.freeze({leer,preparar,renderizar,defaults,pendientes,valida,diferencias,revisionServicio,abrirRevision,nuevoId:UUID});
});
