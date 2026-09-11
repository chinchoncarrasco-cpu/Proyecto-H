/* Cloudbeds PDF 2A: extracción local y comparación de sólo lectura. */
(function(root){
 'use strict';
 const MAPA=Object.freeze({LC1:1,LC2:2,LC3:3,LC4:4,LC6:6,CD5:5,CD7:7,CD8:8,CD9:9,C10:10,C11:11});
 const CLASES=['COINCIDE','TOTAL_DIFERENTE','FALTA_EN_PROYECTO_H','CANCELADA','MULTIHABITACION_REQUIERE_REVISION','AMBIGUA','NO_SOPORTADA'];
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const canon=v=>norm(v).replace(/[^a-z0-9]/g,'');
 const HEAD={reserva:'reserva_cloudbeds',fechadelareserva:'fecha_reserva',numerodehabitacion:'habitaciones_raw',checkin:'check_in',checkout:'check_out',preciototal:'precio_total',totaldelahabitacion:'total_habitacion',estado:'estado',noches:'noches',adultos:'adultos',ninos:'ninos',habitacionid:'habitacion_ids',nombreyapellido:'nombre_huesped',correoelectronico:'correo',movil:'movil',telefono:'telefono',saldopendiente:'saldo_pendiente'};
 const REQUERIDAS=['reserva_cloudbeds','habitaciones_raw','check_in','check_out','precio_total','estado','noches','nombre_huesped','habitacion_ids'];
 function dinero(v){const s=String(v??'').trim().replace(/^(?:CLP\s*\$?|\$)\s*/i,'');if(!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(s))return null;const n=Number(s.replace(/\./g,''));return Number.isSafeInteger(n)?n:null;}
 function fecha(v){const m=String(v??'').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!m)return null;const [d,mo,y]=m.slice(1).map(Number),t=new Date(Date.UTC(y,mo-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===mo-1&&t.getUTCDate()===d?`${m[3]}-${m[2]}-${m[1]}`:null;}
 const entero=v=>/^\d+$/.test(String(v??'').trim())?Number(v):null;
 const contacto=v=>String(v??'').trim()||null;
 const mascara=v=>/[*•●]|[xX]{3,}/.test(v||'');
 function normalizar(raw,origen={}){
  const codigos=String(raw.habitaciones_raw||'').replace(/\s+/g,'').split(',').filter(Boolean);
  const habitaciones=codigos.map(raw=>{const m=raw.toUpperCase().match(/^([A-Z]+\d+)(?:\((\d+)\))?$/);return {raw,codigo:m?.[1]||null,cantidad:m?Number(m[2]||1):null,cabana:m?MAPA[m[1]]??null:null};});
  const r={reserva_cloudbeds:String(raw.reserva_cloudbeds||'').replace(/\s/g,''),fecha_reserva:fecha(raw.fecha_reserva),habitaciones_raw:raw.habitaciones_raw||'',habitaciones,check_in:fecha(raw.check_in),check_out:fecha(raw.check_out),precio_total:dinero(raw.precio_total),total_habitacion:dinero(raw.total_habitacion),estado:norm(raw.estado),noches:entero(raw.noches),adultos:entero(raw.adultos),ninos:entero(raw.ninos),habitacion_ids:String(raw.habitacion_ids||'').split(/[\s,;]+/).filter(Boolean),nombre_huesped:contacto(raw.nombre_huesped),correo:contacto(raw.correo),movil:contacto(raw.movil),telefono:contacto(raw.telefono),saldo_pendiente:dinero(raw.saldo_pendiente),origen,advertencias:[]};
  r.correo_enmascarado=mascara(r.correo);r.movil_enmascarado=mascara(r.movil);r.telefono_enmascarado=mascara(r.telefono);r.contactos_verificados=false;
  r.multihabitacion=habitaciones.length>1||habitaciones.some(h=>h.cantidad>1)||r.habitacion_ids.length>1;
  const dias=r.check_in&&r.check_out?(Date.parse(r.check_out)-Date.parse(r.check_in))/86400000:null;
  if(dias===null||dias<0||r.noches===null||r.noches!==dias)r.advertencias.push('Fechas/noches incompletas o incompatibles.');
  if(!r.reserva_cloudbeds||!r.nombre_huesped||r.precio_total===null||r.precio_total<0)r.advertencias.push('Identificación o precio incompletos.');
  if(!['confirmada','confirmado','confirmacion pendiente','pendiente','checked out','checked in','cancelada','cancelado','no show'].includes(r.estado))r.advertencias.push('Estado no soportado.');
  if(!r.multihabitacion&&r.total_habitacion!==null&&r.precio_total!==null&&Math.abs(r.total_habitacion-r.precio_total)>5)r.advertencias.push('Precio total y total de habitación no coinciden: revisar alcance.');
  r.valor_por_noche_referencia=!r.multihabitacion&&r.noches>0&&r.precio_total!==null?r.precio_total/r.noches:null;
  return r;
 }
 function columnas(page){
  const candidatos=page.items.filter(i=>canon(i.str)==='reserva').sort((a,b)=>a.x-b.x||a.y-b.y);if(!candidatos.length)return null;
  const a=candidatos[0],h=Math.max(a.h||4,2),items=page.items.filter(i=>Math.abs(i.y-a.y)<=h*2.5);
  const grupos=[];for(const i of items){let g=grupos.find(g=>Math.abs(g.x-i.x)<h*.35);if(!g)grupos.push(g={x:i.x,items:[]});g.items.push(i);}
  const cols=grupos.map(g=>({x:g.x,key:HEAD[canon(g.items.sort((a,b)=>a.y-b.y||a.x-b.x).map(i=>i.str).join(' '))]})).filter(c=>c.key).sort((a,b)=>a.x-b.x);
  if(REQUERIDAS.some(k=>!cols.some(c=>c.key===k))||new Set(cols.map(c=>c.key)).size!==cols.length)return null;
  return {cols,width:page.width,fin:Math.max(...items.filter(i=>i.y<=a.y+h*2.5).map(i=>i.y)),alto:h};
 }
 function parsearPaginas(pages){
  if(!Array.isArray(pages)||!pages.length)throw Error('PDF vacío o inválido.');
  let cab=null;const entradas=[];
  for(let p=0;p<pages.length;p++){
   const page=pages[p],propia=columnas(page);if(propia)cab=propia;
   if(!cab||Math.abs(page.width-cab.width)>1)throw Error('PDF no Cloudbeds o columnas no reconocidas. Exporta el listado con Estado, Noches y Habitación ID.');
   const col=i=>{let c=null;for(const k of cab.cols){if(i.x>=k.x-cab.alto*.5)c=k;else break;}return c?.key;};
   const items=page.items.filter(i=>i.str.trim()&&i.y>(propia?propia.fin+cab.alto:30)&&i.y<page.height-22);
   const anchors=items.filter(i=>col(i)==='reserva_cloudbeds'&&/^\d{8,}(?:-\d+)?$/.test(i.str.trim())).sort((a,b)=>a.y-b.y);
   if(!anchors.length)throw Error(`Página ${p+1}: no se encontraron filas inequívocas.`);
   anchors.forEach((a,n)=>{
    const top=n?(anchors[n-1].y+a.y)/2:(propia?propia.fin+cab.alto:30),bottom=n+1<anchors.length?(a.y+anchors[n+1].y)/2:page.height-22;
    const cells={};for(const i of items.filter(i=>i.y>=top&&i.y<bottom)){const k=col(i);if(k)(cells[k]??=[]).push(i);}
    const raw={};for(const [k,list]of Object.entries(cells))raw[k]=list.sort((a,b)=>a.y-b.y||a.x-b.x).map(i=>i.str.trim()).join(' ').replace(/\s+/g,' ').trim();
    entradas.push(normalizar(raw,{pagina:p+1,fila:n+1}));
   });
  }
  return entradas;
 }
 async function leerPDF(bytes,{pdfjs,timeout=30000}={}){
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(data.length>12*1024*1024)throw Error('El PDF supera 12 MB.');
  if(new TextDecoder().decode(data.slice(0,5))!=='%PDF-')throw Error('Archivo PDF inválido.');
  if(!pdfjs){pdfjs=await import('../vendor/pdfjs/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdfjs/pdf.worker.mjs',root.document.baseURI).href;}
  const task=pdfjs.getDocument({data,isEvalSupported:false,useSystemFonts:true,stopAtErrors:true,disableAutoFetch:true});
  let timer;try{return await Promise.race([(async()=>{const doc=await task.promise;if(doc.numPages>50)throw Error('El PDF supera 50 páginas.');const pages=[];for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n),viewport=p.getViewport({scale:1}),text=await p.getTextContent();pages.push({width:viewport.width,height:viewport.height,items:text.items.filter(i=>i.str?.trim()).map(i=>({str:i.str,x:i.transform[4],y:viewport.height-i.transform[5],w:i.width,h:i.height}))});}return parsearPaginas(pages);})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('El PDF tardó demasiado. Intenta con un archivo más pequeño.')),timeout);})]);}finally{clearTimeout(timer);await task.destroy();}
 }
 function comparar(entradas,reservas,saldos){
  const montos=new Map(saldos.map(s=>[s.reserva_id,s.total_alojamiento]));
  const counts=Object.fromEntries(CLASES.map(k=>[k,0]));const repetidos=new Set(entradas.filter((r,i)=>entradas.some((o,j)=>j!==i&&o.reserva_cloudbeds===r.reserva_cloudbeds)).map(r=>r.reserva_cloudbeds));
  const filas=entradas.map(r=>{
   let clase,motivo,candidatas=[],evidencia=null;
   if(['cancelada','cancelado'].includes(r.estado)){clase='CANCELADA';motivo='Cancelada en Cloudbeds. No se propone crear una reserva activa.';}
   else if(repetidos.has(r.reserva_cloudbeds)){clase='AMBIGUA';motivo='Identificador repetido en el PDF: revisar segmentos.';}
   else if(r.multihabitacion){clase='MULTIHABITACION_REQUIERE_REVISION';motivo='Total global de varias habitaciones. No se reparte por CAB ni se asume correspondencia de segmentos.';}
   else if(r.advertencias.length||r.habitaciones.length!==1||!r.habitaciones[0].cabana||r.estado==='no show'){clase='NO_SOPORTADA';motivo=r.advertencias.join(' ')||'Habitación o estado sin correspondencia segura.';}
   else{
    const cab=r.habitaciones[0].cabana;
    candidatas=reservas.filter(x=>String(x.cloudbeds_id||'').trim()===r.reserva_cloudbeds);
    const exactas=reservas.filter(x=>norm(x.titular_nombre)===norm(r.nombre_huesped)&&x.estadias?.some(e=>Number(e.cabanas?.numero)===cab&&e.fecha_ingreso===r.check_in&&e.fecha_salida===r.check_out));
    if(candidatas.length){evidencia='ID Cloudbeds';if(exactas.some(e=>!candidatas.some(c=>c.id===e.id))){clase='AMBIGUA';motivo='ID Cloudbeds y contexto apuntan a reservas distintas.';}}
    else {candidatas=exactas;evidencia='CAB + fechas + nombre exactos';}
    if(!clase){if(candidatas.length>1){clase='AMBIGUA';motivo='Más de una reserva compatible.';}
     else if(!candidatas.length){
      const parcial=reservas.filter(x=>norm(x.titular_nombre)===norm(r.nombre_huesped)||x.estadias?.some(e=>Number(e.cabanas?.numero)===cab&&e.fecha_ingreso===r.check_in));
      clase=parcial.length?'AMBIGUA':'FALTA_EN_PROYECTO_H';motivo=parcial.length?'Existe evidencia parcial, insuficiente para unir o declarar faltante.':'Sin coincidencia en las reservas accesibles consultadas.';
     }else{const x=candidatas[0],e=x.estadias?.[0],total=montos.get(x.id);
      if(x.estadias?.length!==1||x.grupo_reserva_id||!e||Number(e.cabanas?.numero)!==cab||e.fecha_ingreso!==r.check_in||e.fecha_salida!==r.check_out||['cancelada','no_show'].includes(x.estado_reserva)) {clase='AMBIGUA';motivo='ID o contexto encontrado, pero estado/segmentos/fechas/CAB requieren revisión.';}
      else if(total===null||total===undefined||!Number.isSafeInteger(Number(total))){clase='NO_SOPORTADA';motivo='Total efectivo de alojamiento no disponible.';}
      else{clase=Math.abs(r.precio_total-Number(total))<=5?'COINCIDE':'TOTAL_DIFERENTE';motivo=clase==='COINCIDE'?'Diferencia de hasta $5 CLP.':'Diferencia mayor a $5 CLP; sólo informativa.';}
     }
    }
   }
   counts[clase]++;return {clase,motivo,evidencia,entrada:r,reserva_id:candidatas.length===1?candidatas[0].id:null,total_proyecto_h:candidatas.length===1?montos.get(candidatas[0].id)??null:null};
  });return {solo_lectura:true,total:filas.length,conteos:counts,filas};
 }
 async function consultar(entradas,cliente){
  async function leer(tabla,campos,orden){const result=[];for(let i=0;i<20000;i+=500){const {data,error}=await cliente.from(tabla).select(campos).order(orden).range(i,i+499);if(error)throw Error('No se pudo consultar Proyecto H. No se clasifican reservas como faltantes.');if(!Array.isArray(data))throw Error('Respuesta incompleta de Proyecto H.');result.push(...data);if(data.length<500)return result;}throw Error('Consulta demasiado amplia; requiere revisión.');}
  const [rs,ss]=await Promise.all([leer('reservas','id,cloudbeds_id,titular_nombre,estado_reserva,grupo_reserva_id,estadias:reserva_estadias(id,fecha_ingreso,fecha_salida,cabanas(numero))','id'),leer('vista_saldos_alojamiento_reserva','reserva_id,total_alojamiento','reserva_id')]);
  return comparar(entradas,rs,ss);
 }
 function renderizar(informe){
  const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const moneda=v=>v===null||v===undefined?'No disponible':'$'+Number(v).toLocaleString('es-CL');
  const labels={COINCIDE:'Coinciden',TOTAL_DIFERENTE:'Total diferente',FALTA_EN_PROYECTO_H:'Sin coincidencia en Proyecto H',CANCELADA:'Canceladas',MULTIHABITACION_REQUIERE_REVISION:'Multihabitación · revisar',AMBIGUA:'Ambiguas',NO_SOPORTADA:'No soportadas'};
  return `<section class="haiku-cloudbeds-informe"><strong>Cloudbeds · informe de sólo lectura</strong><p>Revisé ${informe.total} entradas. Precio total corresponde a todas las noches de alojamiento.</p><p>Comparación con reservas accesibles en Proyecto H. No se crean ni modifican datos.</p>${CLASES.map(k=>`<details><summary>${esc(labels[k])} · ${informe.conteos[k]}</summary>${informe.filas.filter(f=>f.clase===k).map(f=>{const r=f.entrada;return `<article style="border-top:1px solid #dce6e0;padding:10px 0;overflow-wrap:anywhere"><strong>${esc(r.nombre_huesped)}</strong><p>${esc(r.habitaciones_raw)} · ${esc(r.check_in)} → ${esc(r.check_out)} · ${esc(r.noches)} noches</p><p>Cloudbeds: ${esc(moneda(r.precio_total))} · Proyecto H: ${esc(moneda(f.total_proyecto_h))}</p><p>${esc(f.motivo)} ${f.evidencia?'Evidencia: '+esc(f.evidencia):''}</p><small>Reserva Cloudbeds: ${esc(r.reserva_cloudbeds)} · Página ${esc(r.origen.pagina)}<br>Habitación ID: ${esc(r.habitacion_ids.join(', '))}<br>Correo: ${esc(r.correo)}${r.correo_enmascarado?' (enmascarado)':''}<br>Móvil: ${esc(r.movil)}${r.movil_enmascarado?' (enmascarado)':''}<br>Teléfono: ${esc(r.telefono)}${r.telefono_enmascarado?' (enmascarado)':''}<br>Contactos no verificados.</small></article>`;}).join('')}</details>`).join('')}</section>`;
 }
 const api=Object.freeze({MAPA,CLASES,dinero,fecha,normalizar,parsearPaginas,leerPDF,comparar,consultar,renderizar});root.HAIKU_CLOUDBEDS_PDF_V1=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
