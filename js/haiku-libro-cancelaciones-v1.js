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
   return caso.evidencia;
  }
  if(!hoja||caso.anterior?.hoja!==hoja)throw Error('Cancelación entre hojas: requiere revisión manual.');
  if(caso.fuente==='historial'){
   const diferencias=root.HAIKU_LIBRO_DIFERENCIAS_V1;
   if(diferencias?.evidenciaCancelacion?.(caso.anterior,caso.evidencia)!==true)
    throw Error('La evidencia guardada no corresponde a esta reserva. Vuelve a revisar el Libro.');
   const actual=await libro.consultarHoja(hoja,'actual','semantica');vigente(g,libro);
   const coincidencias=(actual?.cancelaciones||[]).filter(e=>diferencias.evidenciaCancelacion(caso.anterior,e));
   if(coincidencias.length!==1)throw Error('No encontré una cancelación única para esta reserva en el Libro actual.');
   const evidencia=coincidencias[0],mismaPersona=root.HAIKU_LIBRO_SEMANTICA?.mismaPersona;
   if(actual.reservas?.some(r=>r.fecha_checkin===caso.anterior.fecha_checkin&&mismaPersona?.(r.titular,caso.anterior.titular)))
    throw Error('La reserva también figura activa en el Libro actual. Revisa cuál es su estado.');
   comprobarEvidencia(evidencia,actual);
   return evidencia;
  }
  const anterior=await libro.consultarHoja(hoja,'anterior','semantica'),actual=await libro.consultarHoja(hoja,'actual','semantica');vigente(g,libro);
  const resultado=root.HAIKU_LIBRO_DIFERENCIAS_V1.comparar([anterior],[actual]);
  const matches=(resultado.cancelaciones_confirmadas||[]).filter(x=>JSON.stringify(x)===JSON.stringify(caso));
  if(matches.length!==1)throw Error('La evidencia de cancelación ya no coincide. Vuelve a comparar.');
  return caso.evidencia;
 }
 function resolverDesdeReservas(caso,rs,evidencia){
  const r=caso.fuente==='libro_actual'?caso.evidencia:caso.anterior;
  const candidatos=rs.filter(v=>normal(v.titular_nombre)===normal(r.titular)&&v.estadias?.some(e=>e.fecha_ingreso===r.fecha_checkin));
  const compatibles=candidatos.filter(v=>compatible(r,v)&&(caso.fuente!=='historial'||compatible(evidencia,v)));
  if(caso.fuente==='historial'&&!compatibles.length)throw Error('No encontré una reserva compatible con este aviso en Proyecto H.');
  if(compatibles.length!==1)throw Error('La reserva no se identifica de forma única; requiere revisión.');
  const v=compatibles[0];if(v.estadias.length!==1)throw Error('La reserva contiene varios segmentos; requiere revisión antes de cancelar.');
  if(v.estado_reserva!=='cancelada'&&!['pendiente','confirmada','hospedada','sin_checkin'].includes(v.estadias[0].estado_estadia))throw Error('Estado de estadía incompatible; requiere revisión manual.');
  for(const [a,b] of [['rut_documento','titular_numero_documento'],['correo','correo_contacto'],['telefono','telefono_contacto']]){
   const canon=x=>a==='rut_documento'?normal(x).replace(/[.\s-]/g,''):a==='telefono'?String(x).replace(/\D/g,''):normal(x);
   if(r[a]&&v[b]&&canon(r[a])!==canon(v[b]))throw Error('Los datos de identidad no coinciden; requiere revisión.');
  }
  return v;
 }
 async function resolver(caso,cliente,evidencia){
  const r=caso.fuente==='libro_actual'?caso.evidencia:caso.anterior;
  const estadias=await filas(()=>cliente.from('reserva_estadias').select('id,reserva_id').eq('fecha_ingreso',r.fecha_checkin).order('id'));
  const ids=[...new Set(estadias.map(e=>e.reserva_id))];if(!ids.length)throw Error('No encontré la reserva exacta en Proyecto H.');
  const rs=await filas(()=>cliente.from('reservas').select('id,titular_nombre,titular_numero_documento,correo_contacto,telefono_contacto,estado_reserva,estadias:reserva_estadias(id,fecha_ingreso,fecha_salida,estado_estadia,cabanas(numero))').in('id',ids).order('id'));
  return resolverDesdeReservas(caso,rs,evidencia);
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
  const evidencia=await comprobarCaso(caso,g,libro);
  const v=await resolver(caso,cliente,evidencia);vigente(g,libro);
  if(caso.reserva_id&&caso.reserva_id!==v.id)throw Error('Proyecto H cambió. Vuelve a comparar.');
  if(v.estado_reserva!=='cancelada'&&!['pendiente','confirmada','hospedada'].includes(v.estado_reserva))throw Error('Estado no activo; requiere revisión manual.');
  const e=v.estadias[0];
  const vista={estado:v.estado_reserva==='cancelada'?'ya_coincide':'propuesta',estado_actual:v.estado_reserva,titular:v.titular_nombre,cabana:e.cabanas?.numero,fecha_checkin:e.fecha_ingreso,fecha_checkout:e.fecha_salida,reserva_id:v.id};
  if(caso.fuente==='historial')vista.origen_libro=evidencia.origen;
  propuestas.set(vista,{caso:structuredClone(caso),g,libro,cliente,firma:JSON.stringify(v),
   evidencia:JSON.stringify(evidencia),id:v.id});return vista;
 }
 async function confirmar(vista){
  const p=propuestas.get(vista);if(!p)throw Error('Propuesta no válida.');
  if(vista.estado==='ya_coincide')return {estado:'ya_coincide'};
  permiso();vigente(p.g,p.libro);
  if(!root.HAIKU_RESERVA_ESTADOS_SUPABASE_V2?.cancelar)throw Error('El flujo de cancelación de ficha no está disponible.');
  return root.HAIKU_RESERVA_ESTADOS_SUPABASE_V2.cancelar(p.id,{antesDeCancelar:async()=>{
   permiso();
   const evidencia=await comprobarCaso(p.caso,p.g,p.libro);
   if(JSON.stringify(evidencia)!==p.evidencia)throw Error('La evidencia del Libro cambió desde la vista previa. Vuelve a preparar.');
   const actual=await resolver(p.caso,p.cliente,evidencia);vigente(p.g,p.libro);
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
 function cabecera(out,texto,n){const h=elemento('h3','haiku-cancelacion-titulo haiku-cancelacion-titulo--detectadas',texto);h.append(elemento('span','haiku-cancelacion-cantidad',String(n)));out.append(h);}
 function tarjeta(caso,resuelta=false){
  const r=caso.actual||caso.anterior,origen=caso.evidencia?.origen;
  const box=elemento('section',`haku-libro-item haiku-cancelacion-card${resuelta?' haiku-cancelacion-card--resuelta':''}`);
  if(!resuelta){
   box.className+=' haiku-cancelacion-card--detectada';
   const top=elemento('div','haiku-cancelacion-top'),identidad=elemento('div','haiku-cancelacion-identidad');
   top.append(elemento('span','haiku-cancelacion-badge','Confirmada en el Libro'),elemento('span','haiku-cancelacion-cab',`CAB ${r.cabana??'—'}`));
   const entrada=String(r.fecha_checkin||''),salida=String(r.fecha_checkout||''),mismoMes=entrada.slice(0,7)===salida.slice(0,7)&&/^\d{4}-\d{2}-\d{2}$/.test(entrada)&&/^\d{4}-\d{2}-\d{2}$/.test(salida);
   const anioEntrada=entrada.slice(0,4),anioSalida=salida.slice(0,4);
   let periodo=`${mismoMes?Number(entrada.slice(8,10)):fechaVisual(entrada)}${anioEntrada!==anioSalida&&/^\d{4}$/.test(anioEntrada)?' '+anioEntrada:''} → ${fechaVisual(salida)}${/^\d{4}$/.test(anioSalida)?' '+anioSalida:''}`;
   if(r.noches!=null)periodo+=` · ${r.noches} ${Number(r.noches)===1?'noche':'noches'}`;
   const fechas=elemento('p','haiku-cancelacion-periodo',periodo);fechas.title=`${r.fecha_checkin} → ${r.fecha_checkout}`;
   identidad.append(elemento('h4','haiku-cancelacion-nombre',r.titular),fechas);box.append(top,identidad);
   if(origen&&(origen.hoja||origen.celda))box.append(elemento('p','haiku-cancelacion-origen',['Origen','CANCELACIONES',origen.hoja,origen.celda].filter(Boolean).join(' · ')));
   return box;
  }
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
 function periodoEstadia(vista){
  const noches=(Date.parse(vista.fecha_checkout)-Date.parse(vista.fecha_checkin))/86400000;
  const anioEntrada=String(vista.fecha_checkin||'').slice(0,4),anioSalida=String(vista.fecha_checkout||'').slice(0,4);
  let fechas=`${fechaVisual(vista.fecha_checkin)}${anioEntrada!==anioSalida?' '+anioEntrada:''} → ${fechaVisual(vista.fecha_checkout)}${/^\d{4}$/.test(anioSalida)?' '+anioSalida:''}`;
  if(Number.isInteger(noches)&&noches>=0)fechas+=` · ${noches} ${noches===1?'noche':'noches'}`;
  return fechas;
 }
 function inspeccionReserva(vista){
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
  ver.disabled=!vista.reserva_id;
  return {ver,errorReserva};
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
  datos.append(elemento('p','haiku-cancelacion-pantalla__fechas',periodoEstadia(vista)));
  nombre.append(datos,elemento('span','haiku-cancelacion-pantalla__cabana',`CAB ${vista.cabana??'—'}`));reserva.append(nombre);
  const libro=elemento('div','haiku-cancelacion-pantalla__libro');
  libro.append(elemento('span','','EN EL LIBRO'),elemento('strong','haiku-cancelacion-pantalla__badge haiku-cancelacion-pantalla__badge--libro','Cancelación confirmada'));
  reserva.append(libro);
  const origen=vista.origen_libro||caso.evidencia?.origen;
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
  const {ver,errorReserva}=inspeccionReserva(vista);
  reserva.append(cambio,ver,errorReserva);cuerpo.append(reserva);
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
 function pantallaCancelacionEnInforme(caso,vista,{volver,guardar,completada=false,coincide=false,error=''}){
  const resuelta=completada||coincide;
  const panel=elemento('section','haiku-cancelacion-informe');
  const titulo=elemento('h3',resuelta?'haiku-cancelacion-informe__titulo--resuelta':'',completada?'Cancelación completada':coincide?'Ya estaba cancelada':'Revisar cancelación');
  titulo.tabIndex=-1;
  const origen=vista.origen_libro||caso.evidencia?.origen;
  const cabecera=elemento('header','haiku-cancelacion-informe__cabecera');cabecera.append(titulo);
  if(origen?.hoja||origen?.celda)cabecera.append(elemento('span','haiku-cancelacion-informe__fuente',['Libro',origen.hoja,origen.celda].filter(Boolean).join(' · ')));
  const cabana=!caso.anterior.cabana&&vista.cabana?`CAB ${vista.cabana}`:'';
  const fechas=[cabana,periodoEstadia(vista),caso.anterior.tipo_estadia==='full_day'?'Full Day':''].filter(Boolean).join(' · ');
  panel.append(cabecera,elemento('span','haiku-cancelacion-informe__fechas',fechas));
  const mensajes=elemento('div','haiku-cancelacion-informe__mensajes',error);mensajes.setAttribute('role',error?'alert':'status');
  const acciones=elemento('footer','haiku-cancelacion-informe__acciones');
  const atras=botonPantalla(resuelta?'Volver a la revisión':'Volver','volver',volver);acciones.append(atras);
  const {ver,errorReserva}=vista.reserva_id?inspeccionReserva(vista):{};
  if(ver)acciones.append(ver);
  let cambio=null,confirmarBoton=null;
  if(!error&&!resuelta){
   cambio=elemento('div','haiku-cancelacion-informe__cambio');
   cambio.append(elemento('span','','Proyecto H'),elemento('strong','',estadoVisual(vista.estado_actual)),
    elemento('span','','→'),elemento('strong','haiku-cancelacion-informe__destino','Cancelada'));
   panel.append(cambio);
   confirmarBoton=botonPantalla('Confirmar cancelación','confirmar',guardar);acciones.append(confirmarBoton);
  }
  panel.append(mensajes,acciones);
  if(errorReserva)panel.append(errorReserva);
  return {panel,titulo,mensajes,confirmar:confirmarBoton,atras,ver,cambio};
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
 function adjuntarCaso(out,caso,g,alVolver){
   const contenedor=elemento('div','haiku-cancelacion-flujo'),status=elemento('div','haiku-cancelacion-status');
   status.setAttribute('role','status');status.setAttribute('aria-live','polite');
   const directo=typeof alVolver==='function',box=directo?null:tarjeta(caso),button=directo?null:elemento('button','libro-reserva-boton secundario haiku-cancelacion-boton','Preparar cancelación');
   const r=caso.actual||caso.anterior;
   if(button){button.type='button';button.setAttribute('aria-label',`Preparar cancelación · ${r.titular}`);}
   let vista=null,pantalla=null,ocupado=false,obsoleto=false,terminada=false;
   function bloquear(texto){
    if(!pantalla){mostrarEstado(status,texto);return;}
    if(pantalla.confirmar)pantalla.confirmar.disabled=true;
    if(directo){
     pantalla.mensajes.setAttribute('role','alert');pantalla.mensajes.textContent=texto;
     pantalla.cambio?.remove();pantalla.confirmar?.remove();
    }else pantalla.mensajes.replaceChildren(avisoPantalla('Revisión necesaria',texto,'error'));
   }
   function volver(){
    if(ocupado)return;
    if(vista)propuestas.delete(vista);
    pantalla=null;
    if(directo){
     root.removeEventListener?.('haiku:libro-cambio',invalidar);
     return alVolver(terminada);
    }
    if(terminada){const resuelta=tarjeta(caso,true);resuelta.tabIndex=-1;contenedor.replaceChildren(resuelta);resuelta.focus?.({preventScroll:true});}
    else{vista=null;contenedor.replaceChildren(box);button.focus?.({preventScroll:true});}
   }
   function mostrar(datos,opciones={}){
    const renderizar=directo?pantallaCancelacionEnInforme:pantallaCancelacion;
    pantalla=renderizar(caso,datos,{volver,guardar,...opciones});contenedor.replaceChildren(pantalla.panel);pantalla.titulo.focus?.({preventScroll:true});
   }
   async function guardar(){
    if(ocupado||obsoleto||terminada||!vista||!pantalla?.confirmar||pantalla.confirmar.disabled)return;
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
      if(directo)actual.mensajes.textContent='Pendiente de confirmación.';
      else actual.mensajes.replaceChildren(avisoPantalla('Cancelación no confirmada','La cancelación se aplicará al confirmar'));
     }
    }catch(e){fallo=true;bloquear(e.message||'No se pudo confirmar la cancelación.');}
    finally{
     ocupado=false;actual.panel.setAttribute('aria-busy','false');actual.atras.disabled=false;
     if(actual.cerrar)actual.cerrar.disabled=false;
     if(actual.ver)actual.ver.disabled=!vista?.reserva_id;
     if(pantalla===actual){actual.confirmar.textContent='Confirmar cancelación';actual.confirmar.disabled=fallo||obsoleto||!propuestas.has(vista);}
    }
   }
   const libroCambiado='El Libro cambió. Esta propuesta quedó invalidada. Vuelve a la revisión y genera un informe nuevo.';
   function invalidar(){
    obsoleto=true;if(button)button.disabled=true;
    if(!terminada)bloquear(libroCambiado);
   }
   async function abrir(){
    if(ocupado||obsoleto||terminada)return;
    ocupado=true;if(button)button.disabled=true;
    try{
     mostrarEstado(status,directo?'Comprobando la cancelación…':'Comprobando cancelación contra Proyecto H…');vista=await preparar(caso,g);
     if(obsoleto){propuestas.delete(vista);throw Error(libroCambiado);}
     terminada=vista.estado==='ya_coincide';mostrar(vista,{coincide:terminada});status.replaceChildren();
    }catch(e){
     vista=null;mostrarEstado(status,e.message||'No se pudo preparar la cancelación.');mostrar({...r,estado_actual:caso.estado_proyecto,reserva_id:caso.reserva_id},{error:e.message||'No se pudo preparar la cancelación.'});
    }finally{ocupado=false;if(button)button.disabled=obsoleto||terminada;}
   }
   root.addEventListener('haiku:libro-cambio',invalidar,{once:true});
   if(directo){
    contenedor.append(status);out.appendChild(contenedor);
    return abrir();
   }
   button.addEventListener('click',abrir);
   const pie=elemento('div','haiku-cancelacion-pie'),verificacion=elemento('div','haiku-cancelacion-verificacion');
   verificacion.append(elemento('span','haiku-cancelacion-estado-haku','Haku · por verificar'),elemento('span','haiku-cancelacion-ayuda','Se revisará antes de confirmar.'));
   pie.append(verificacion,button);box.append(status,pie);contenedor.append(box);out.appendChild(contenedor);
 }
 function adjuntar(out,resultado,g){
  if(!resultado.cancelaciones_confirmadas?.length)return;
  cabecera(out,'Cancelaciones confirmadas',resultado.cancelaciones_confirmadas.length);
  for(const caso of resultado.cancelaciones_confirmadas)adjuntarCaso(out,caso,g);
 }
 function abrirRevisionHistorial(out,item,g,alVolver){
  if(item?.tipo!=='cancelacion'||!item.anterior||typeof alVolver!=='function')throw Error('Faltan los datos del aviso de cancelación.');
  const caso={tipo:'cancelacion_confirmada',fuente:'historial',anterior:item.anterior,evidencia:item.evidencia,
   reserva_id:item.sistema?.reserva_id,estado_proyecto:item.sistema?.estado_reserva};
  return adjuntarCaso(out,caso,g,alVolver);
 }
 const api=Object.freeze({preparar,confirmar,adjuntar,detectarActual,detectarActualConSnapshot,adjuntarResueltas,adjuntarRevision,abrirRevisionHistorial});root.HAIKU_LIBRO_CANCELACIONES_V1=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
