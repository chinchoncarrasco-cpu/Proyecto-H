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
 function resolverDesdeReservas(caso,rs){
  const r=caso.fuente==='libro_actual'?caso.evidencia:caso.anterior;
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
 async function resolver(caso,cliente){
  const r=caso.fuente==='libro_actual'?caso.evidencia:caso.anterior;
  const estadias=await filas(()=>cliente.from('reserva_estadias').select('id,reserva_id').eq('fecha_ingreso',r.fecha_checkin).order('id'));
  const ids=[...new Set(estadias.map(e=>e.reserva_id))];if(!ids.length)throw Error('No encontré la reserva exacta en Proyecto H.');
  const rs=await filas(()=>cliente.from('reservas').select('id,titular_nombre,titular_numero_documento,correo_contacto,telefono_contacto,estado_reserva,estadias:reserva_estadias(id,fecha_ingreso,fecha_salida,estado_estadia,cabanas(numero))').in('id',ids).order('id'));
  return resolverDesdeReservas(caso,rs);
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
 function detectarActualConSnapshot(hojas,estadias){
  const out={cancelaciones_confirmadas:[],cancelaciones_revision:[],cancelaciones_ya_coinciden:[]};
  const grupos=new Map();
  for(const e of estadias||[]){
   if(!e?.reserva_id)continue;
   if(!grupos.has(e.reserva_id))grupos.set(e.reserva_id,{id:e.reserva_id,titular_nombre:e.titular,titular_numero_documento:e.rut_documento,
    correo_contacto:e.correo,telefono_contacto:e.telefono,estado_reserva:e.estado_reserva,estadias:[]});
   grupos.get(e.reserva_id).estadias.push({id:e.id,fecha_ingreso:e.fecha_checkin,fecha_salida:e.fecha_checkout,estado_estadia:e.estado_operativo,cabanas:{numero:e.cabana}});
  }
  const reservas=[...grupos.values()];
  for(const hoja of hojas||[])for(const evidencia of hoja?.cancelaciones||[]){
   try{
    comprobarEvidencia(evidencia,hoja);
    const caso={tipo:'cancelacion_confirmada',fuente:'libro_actual',evidencia:structuredClone(evidencia)};
    const v=resolverDesdeReservas(caso,reservas),e=v.estadias[0];
    caso.actual={...evidencia,cabana:e.cabanas?.numero,fecha_checkout:e.fecha_salida};caso.reserva_id=v.id;caso.estado_proyecto=v.estado_reserva;
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
  const vista={estado:v.estado_reserva==='cancelada'?'ya_coincide':'propuesta',estado_actual:v.estado_reserva,titular:v.titular_nombre,cabana:e.cabanas?.numero,fecha_checkin:e.fecha_ingreso,fecha_checkout:e.fecha_salida,reserva_id:v.id};
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
  const r=caso.actual||caso.anterior,origen=caso.evidencia?.origen;
  const box=elemento('section',`haku-libro-item haiku-cancelacion-card${resuelta?' haiku-cancelacion-card--resuelta':''}`);
  const top=elemento('div','haiku-cancelacion-top');top.append(elemento('span','haiku-cancelacion-badge',resuelta?'✓ Ya coincide':'Cancelación confirmada'),elemento('span','haiku-cancelacion-cab',`CAB ${r.cabana??'—'}`));
  const chips=elemento('div','haiku-cancelacion-chips');
  const fechas=elemento('span','haiku-cancelacion-chip',`${fechaVisual(r.fecha_checkin)} → ${fechaVisual(r.fecha_checkout)}`);fechas.title=`${r.fecha_checkin} → ${r.fecha_checkout}`;chips.append(fechas);
  if(r.noches!=null)chips.append(elemento('span','haiku-cancelacion-chip',`${r.noches} ${Number(r.noches)===1?'noche':'noches'}`));
  chips.append(elemento('span','haiku-cancelacion-chip',`Proyecto H: ${resuelta?'Cancelada':caso.fuente==='libro_actual'?'Activa':'pendiente de revalidar'}`));
  box.append(top,elemento('h4','haiku-cancelacion-nombre',r.titular),chips);
  if(origen&&(origen.hoja||origen.celda))box.append(elemento('p','haiku-cancelacion-secundario','Encontrada en:'),elemento('p','haiku-cancelacion-origen',['CANCELACIONES',origen.hoja,origen.celda].filter(Boolean).join(' · ')));
  if(resuelta)box.append(elemento('p','haiku-cancelacion-nota','No se requiere ninguna escritura.'));
  else box.append(elemento('p','haiku-cancelacion-secundario','Acción propuesta:'),elemento('p','haiku-cancelacion-accion','Cancelar reserva'));
  return box;
 }
 function mostrarEstado(status,texto,tipo='aviso'){
  status.replaceChildren();status.className=`haiku-cancelacion-status haiku-cancelacion-status--${tipo}`;status.textContent=texto;
 }
 function estadoVisual(estado){
  return {confirmada:'Activa',pendiente:'Pendiente',hospedada:'Hospedada',cancelada:'Cancelada'}[estado]||estado||'Sin verificar';
 }
 function periodoVisual(caso){
  const hoja=caso.evidencia?.origen?.hoja,meses=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const m=String(hoja||'').match(/^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(\d{2}|\d{4})$/i);
  if(m)return `${meses[['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'].indexOf(m[1].toLowerCase())]} ${m[2].length===2?'20':''}${m[2]}`;
  return hoja||'Período sin identificar';
 }
 function botonPantalla(texto,variante,accion){
  const boton=elemento('button',`haiku-cancelacion-pantalla__boton haiku-cancelacion-pantalla__boton--${variante}`,texto);
  boton.type='button';boton.addEventListener('click',accion);return boton;
 }
 function avisoPantalla(titulo,texto,tipo='pendiente'){
  const aviso=elemento('div',`haiku-cancelacion-pantalla__aviso haiku-cancelacion-pantalla__aviso--${tipo}`);
  aviso.setAttribute('role',tipo==='error'?'alert':'status');
  const icono=elemento('span','haiku-cancelacion-pantalla__icono',tipo==='confirmado'?'✓':tipo==='pendiente'?'i':'!');icono.setAttribute('aria-hidden','true');
  const contenido=elemento('div','');contenido.append(elemento('strong','',titulo),elemento('p','',texto));aviso.append(icono,contenido);return aviso;
 }
 // Estas dos vistas sólo presentan el resultado del puente existente preparar/confirmar.
 function pantallaCancelacion(caso,vista,{volver,guardar,completada=false,coincide=false,error=''}){
  const panel=elemento('section','haiku-cancelacion-pantalla');panel.setAttribute('aria-label',completada?'Cancelación completada':'Revisar cancelación');
  const header=elemento('header','haiku-cancelacion-pantalla__cabecera'),marca=elemento('span','haiku-cancelacion-pantalla__marca','H');marca.setAttribute('aria-hidden','true');
  const identidad=elemento('div','haiku-cancelacion-pantalla__identidad');identidad.append(elemento('strong','','Haku'),elemento('span','','Asistente operativo'));
  const cerrar=botonPantalla('×','cerrar',volver);cerrar.setAttribute('aria-label','Cerrar revisión de cancelación');header.append(marca,identidad,cerrar);
  const cuerpo=elemento('div','haiku-cancelacion-pantalla__cuerpo'),titulo=elemento('h3','haiku-cancelacion-pantalla__titulo',completada?'Cancelación completada':'Revisar cancelación');titulo.tabIndex=-1;
  cuerpo.append(elemento('p','haiku-cancelacion-pantalla__etiqueta',`REVISIÓN DEL LIBRO · ${periodoVisual(caso).toLocaleUpperCase('es')}`),titulo,
   elemento('p','haiku-cancelacion-pantalla__descripcion',completada?'La reserva ya está actualizada en Haku.':'Confirma el cambio de estado de esta reserva.'));
  if(completada)cuerpo.append(avisoPantalla('Cambio confirmado',`${vista.titular} · CAB ${vista.cabana??'—'}`,'confirmado'));
  const reserva=elemento('section','haiku-cancelacion-pantalla__reserva'),nombre=elemento('div','haiku-cancelacion-pantalla__reserva-cabecera'),datos=elemento('div','haiku-cancelacion-pantalla__datos');
  datos.append(elemento('h4','',vista.titular||'Huésped sin identificar'));
  const noches=(Date.parse(vista.fecha_checkout)-Date.parse(vista.fecha_checkin))/86400000;
  const anioEntrada=String(vista.fecha_checkin||'').slice(0,4),anioSalida=String(vista.fecha_checkout||'').slice(0,4);
  let fechas=`${fechaVisual(vista.fecha_checkin)}${anioEntrada!==anioSalida?' '+anioEntrada:''} → ${fechaVisual(vista.fecha_checkout)}${/^\d{4}$/.test(anioSalida)?' '+anioSalida:''}`;
  if(Number.isInteger(noches)&&noches>=0)fechas+=` · ${noches} ${noches===1?'noche':'noches'}`;
  datos.append(elemento('p','haiku-cancelacion-pantalla__fechas',fechas));
  nombre.append(datos,elemento('span','haiku-cancelacion-pantalla__cabana',`CAB ${vista.cabana??'—'}`));reserva.append(nombre);
  const libro=elemento('div','haiku-cancelacion-pantalla__libro');
  libro.append(elemento('span','','EN EL LIBRO'),elemento('strong','haiku-cancelacion-pantalla__badge haiku-cancelacion-pantalla__badge--libro','Cancelación confirmada'));
  reserva.append(libro);
  const origen=caso.evidencia?.origen;
  if(origen&&(origen.hoja||origen.celda))reserva.append(elemento('p','haiku-cancelacion-pantalla__origen',['CANCELACIONES',origen.hoja,origen.celda].filter(Boolean).join(' · ')));
  const cambio=elemento('div','haiku-cancelacion-pantalla__cambio');
  cambio.append(elemento('p','haiku-cancelacion-pantalla__etiqueta',completada||coincide?'ESTADO ACTUAL EN HAKU':'CAMBIO EN HAKU'));
  const estados=elemento('div','haiku-cancelacion-pantalla__estados');
  function estado(etiqueta,valor){
   const bloque=elemento('div','haiku-cancelacion-pantalla__estado');
   if(etiqueta)bloque.append(elemento('span','',etiqueta));
   const badge=elemento('strong',`haiku-cancelacion-pantalla__badge haiku-cancelacion-pantalla__badge--${valor||'desconocida'}`,estadoVisual(valor));
   badge.setAttribute('data-estado',valor||'');if(valor==='confirmada')badge.title='Estado de la reserva: Confirmada';bloque.append(badge);return bloque;
  }
  if(completada||coincide){
   estados.append(estado('', 'cancelada'));
   cambio.append(estados,elemento('p','haiku-cancelacion-pantalla__resultado',completada?'Cancelación completada.':'Ya estaba cancelada. No se aplicaron cambios.'));
  }else{
   const flecha=elemento('span','haiku-cancelacion-pantalla__flecha','→');flecha.setAttribute('aria-hidden','true');
   estados.append(estado('Actual',vista.estado_actual),flecha,estado('Después de confirmar','cancelada'));cambio.append(estados);
  }
  const errorReserva=elemento('p','haiku-cancelacion-pantalla__error-reserva');errorReserva.setAttribute('role','alert');
  const ver=botonPantalla('Ver reserva','ver',async()=>{
   if(ver.disabled)return;ver.disabled=true;errorReserva.textContent='';
   try{
    const inspector=root.HAIKU_INSPECTOR_V1||root.HAIKU_PANELES_V1;
    let resultado;
    if(!vista.reserva_id)throw Error('No se pudo verificar una reserva única.');
    if(typeof inspector?.abrirReserva==='function')resultado=await inspector.abrirReserva(vista.reserva_id,ver);
    else if(typeof inspector?.abrirInspector==='function')resultado=await inspector.abrirInspector({tipo:'reserva',entidadId:vista.reserva_id},{origen:ver});
    else throw Error('El Inspector de reservas todavía no está disponible.');
    if(resultado===false)throw Error('No se pudo verificar la reserva seleccionada.');
   }catch(e){errorReserva.textContent=e.message||'No se pudo abrir la reserva.';}
   finally{ver.disabled=false;}
  });
  ver.disabled=!vista.reserva_id;reserva.append(cambio,ver,errorReserva);cuerpo.append(reserva);
  if(completada)cuerpo.append(elemento('p','haiku-cancelacion-pantalla__continuidad','Puedes continuar con la revisión del libro.'));
  const mensajes=elemento('div','haiku-cancelacion-pantalla__mensajes');mensajes.setAttribute('aria-live','polite');
  if(error)mensajes.append(avisoPantalla('Revisión necesaria',error,'error'));
  else if(coincide)mensajes.append(avisoPantalla('Ya coincide','La reserva ya estaba cancelada. No se realizó una nueva cancelación.','confirmado'));
  else if(!completada)mensajes.append(avisoPantalla('Pendiente de confirmar','La cancelación se aplicará al confirmar'));
  cuerpo.append(mensajes);
  const pie=elemento('footer','haiku-cancelacion-pantalla__pie'),atras=botonPantalla(completada||coincide?'Volver a la revisión':'Volver',completada||coincide?'volver-revision':'volver',volver);
  pie.append(atras);let confirmarBoton=null;
  if(!completada&&!coincide){confirmarBoton=botonPantalla('Confirmar cancelación','confirmar',guardar);confirmarBoton.disabled=Boolean(error);pie.append(confirmarBoton);}
  panel.append(header,cuerpo,pie);
  return {panel,titulo,mensajes,confirmar:confirmarBoton,cerrar,atras,ver};
 }
 function adjuntarResueltas(out,resultado){
  const casos=resultado.cancelaciones_ya_coinciden||[];if(!casos.length)return;
  out=desplegable(out,'Cancelaciones · Ya coincide',casos.length);for(const caso of casos)out.append(tarjeta(caso,true));
 }
 function desplegable(out,titulo,n,revision=false){
  const grupo=elemento('div','haiku-cancelaciones-grupo'),seccion=elemento('details','haiku-comparacion-acordeon'+(revision?' haiku-comparacion-acordeon--revision':''));
  seccion.open=false;seccion.append(elemento('summary','',`${titulo} (${n})`));grupo.append(seccion);out.append(grupo);return seccion;
 }
 function adjuntarRevision(out,resultado){
  const casos=resultado.cancelaciones_revision||[];if(!casos.length)return;
  out=desplegable(out,'Cancelaciones por verificar',casos.length,true);
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
   const doc=root.document,contenedor=elemento('div','haiku-cancelacion-flujo'),box=tarjeta(caso),button=doc.createElement('button'),status=doc.createElement('div');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.className='haiku-cancelacion-status';
   const r=caso.actual||caso.anterior;
   button.type='button';button.className='libro-reserva-boton secundario haiku-cancelacion-boton';button.textContent='Preparar cancelación';button.setAttribute('aria-label',`Preparar cancelación · ${r.titular}`);
   let vista=null,pantalla=null,ocupado=false,obsoleto=false,terminada=false;
   function bloquear(texto){
    if(pantalla){pantalla.mensajes.replaceChildren(avisoPantalla('Revisión necesaria',texto,'error'));if(pantalla.confirmar)pantalla.confirmar.disabled=true;}
    else mostrarEstado(status,texto);
   }
   function volver(){
    if(ocupado)return;
    if(vista)propuestas.delete(vista);
    pantalla=null;
    if(terminada){const resuelta=tarjeta(caso,true);resuelta.tabIndex=-1;contenedor.replaceChildren(resuelta);resuelta.focus?.({preventScroll:true});}
    else{vista=null;contenedor.replaceChildren(box);button.focus?.({preventScroll:true});}
   }
   function mostrar(datos,opciones={}){
    pantalla=pantallaCancelacion(caso,datos,{volver,guardar,...opciones});contenedor.replaceChildren(pantalla.panel);pantalla.titulo.focus?.({preventScroll:true});
   }
   async function guardar(){
    if(ocupado||obsoleto||terminada||!vista||pantalla?.confirmar?.disabled)return;
    ocupado=true;
    const actual=pantalla;let fallo=false;
    for(const boton of [actual.confirmar,actual.cerrar,actual.atras,actual.ver])if(boton)boton.disabled=true;
    actual.panel.setAttribute('aria-busy','true');actual.confirmar.textContent='Confirmando…';
    try{
     const resultado=await confirmar(vista);
     if(resultado?.estado==='cancelada'){
      terminada=true;vista.estado='ya_coincide';vista.estado_actual='cancelada';mostrar(vista,{completada:true});
     }else if(resultado?.estado==='sin_cambios'||resultado?.estado==='ya_coincide'){
      terminada=true;vista.estado='ya_coincide';vista.estado_actual='cancelada';mostrar(vista,{coincide:true});
     }else if(!obsoleto){
      actual.mensajes.replaceChildren(avisoPantalla('Cancelación no confirmada','La cancelación se aplicará al confirmar'));
     }
    }catch(e){fallo=true;bloquear(e.message||'No se pudo confirmar la cancelación.');}
    finally{
     ocupado=false;actual.panel.setAttribute('aria-busy','false');actual.cerrar.disabled=false;actual.atras.disabled=false;actual.ver.disabled=!vista?.reserva_id;
     if(pantalla===actual){actual.confirmar.textContent='Confirmar cancelación';actual.confirmar.disabled=fallo||obsoleto||!propuestas.has(vista);}
    }
   }
   root.addEventListener('haiku:libro-cambio',()=>{obsoleto=true;button.disabled=true;if(!terminada)bloquear('El Libro cambió. Esta propuesta quedó invalidada. Vuelve a la revisión y genera un informe nuevo.');},{once:true});
   button.addEventListener('click',async()=>{
    if(ocupado||obsoleto||terminada)return;ocupado=true;button.disabled=true;
    try{
     mostrarEstado(status,'Comprobando cancelación contra Proyecto H…');vista=await preparar(caso,g);if(obsoleto)return;
     terminada=vista.estado==='ya_coincide';mostrar(vista,{coincide:terminada});status.replaceChildren();
    }catch(e){
     vista=null;mostrarEstado(status,e.message||'No se pudo preparar la cancelación.');mostrar({...r,estado_actual:caso.estado_proyecto,reserva_id:caso.reserva_id},{error:e.message||'No se pudo preparar la cancelación.'});
    }finally{ocupado=false;button.disabled=obsoleto||terminada;}
   });box.append(status,button);contenedor.append(box);out.appendChild(contenedor);
  }
 }
 const api=Object.freeze({preparar,confirmar,adjuntar,detectarActual,detectarActualConSnapshot,adjuntarResueltas,adjuntarRevision});root.HAIKU_LIBRO_CANCELACIONES_V1=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
