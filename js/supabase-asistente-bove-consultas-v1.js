/* BOVE ETAPA 2. Sólo SELECT y lectura del Libro cargado. Sin reconciliación. */
(function(root){
 'use strict';
 if(root.HAIKU_ASISTENTE_BOVE_CONSULTAS_V1)return;
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const numero=v=>/^\d+(?:[.,]\d{3})*$/.test(String(v??'').trim())?String(v).trim().replace(/[.,]/g,''):null;
 const hoy=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const meses=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
 const moverDia=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
 function rangoPendientes(t,dia){
  const fecha=(d,m,y)=>{const v=`${String(y).length===2?'20'+y:y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;return Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:null;};
  let desde,hasta,m;
  if((m=t.match(/entre el (\d{2})-(\d{2})-(\d{2}(?:\d{2})?) y el (\d{2})-(\d{2})-(\d{2}(?:\d{2})?)\.?$/))){desde=fecha(m[1],m[2],m[3]);hasta=fecha(m[4],m[5],m[6]);}
  else if((m=t.match(/del (\d{1,2}) al (\d{1,2}) de ([a-z]+)(?: (?:de )?(20\d{2}))?\.?$/))){const mes=meses.indexOf(m[3]=== 'setiembre'?'septiembre':m[3])+1;desde=fecha(m[1],mes,m[4]||dia.slice(0,4));hasta=fecha(m[2],mes,m[4]||dia.slice(0,4));}
  else if((m=t.match(/desde el (\d{1,2}) hasta hoy\.?$/))){desde=fecha(m[1],dia.slice(5,7),dia.slice(0,4));hasta=dia;}
  else if(/\b(?:desde|entre|del)\b/.test(t))return {error_rango:'Indícame el rango completo: por ejemplo, entre el 05-09-26 y el 10-09-26.'};
  else if(/esta semana\.?$/.test(t)){const dow=new Date(dia+'T12:00:00Z').getUTCDay();desde=moverDia(dia,-((dow+6)%7));hasta=dia;}
  else if(/\bayer\.?$/.test(t))desde=hasta=moverDia(dia,-1);
  else if(/\bhoy\.?$/.test(t))desde=hasta=dia;
  if(!desde||!hasta)return {error_rango:'Indícame un rango válido para revisar los BOVE pendientes: hoy, ayer o del 1 al 10 de septiembre.'};
  if(desde>hasta)return {error_rango:'El inicio debe ser anterior o igual al final del rango.'};
  if((Date.parse(hasta)-Date.parse(desde))/86400000+1>31)return {error_rango:'Revisa un rango menor: máximo 31 días por consulta operativa.'};
  return {desde,hasta,hasta_efectiva:hasta>dia?dia:hasta,futuro:hasta>dia};
 }
 function interpretar(texto,dia=hoy()){
  const t=norm(texto).replace(/^haku[ ,:]*/,'').replace(/[¿?¡!]/g,'').replace(/\s+por favor$/,'');
  if(/\b(pon|pone|ponle|registra|registrar|guarda|guardar|asigna|completa|escribe|edita|elimina)\b/.test(t))return null;
  const busqueda=t.match(/^(?:busca|buscar|buscame|encuentra|muestra|muestrame|revisa)\s+(?:en proyecto h\s+)?(?:(?:el|los|estos)\s+)?(?:bove\s*:?\s*)?([\d.,\s/y]+?)(?:\s+en (?:el )?(?:libro|proyecto h))?\.?$/);
  if(busqueda){
   const tokens=busqueda[1].match(/\d{1,3}(?:[.,]\d{3})+|\d+/g)||[];
   const resto=busqueda[1].replace(/\d{1,3}(?:[.,]\d{3})+|\d+/g,'');
   if(!/^[\s,/y]*$/.test(resto))return null;
   const numeros=[...new Set(tokens.map(numero))];
   if(numeros.length&&(/\bbove\b/.test(t)||numeros.length>1))return {accion:'buscar',numero:numeros.length===1?numeros[0]:undefined,numeros,fuente:/proyecto h/.test(t)?'proyecto_h':/\blibro\b/.test(t)?'libro':'ambas',...(numeros.length>20?{error_rango:'Consulta como máximo 20 números BOVE a la vez.'}:{})};
  }
  if(!/\bbove\b/.test(t))return null;
  if(/^(?:que|cual|cuales|revisa)\b.*\bbove\b.*\bpendientes?\b/.test(t))return {accion:'pendientes',fuente:'ambas',...rangoPendientes(t,dia)};
  if(/^(?:cual es el |el )?ultimo bove(?: registrado)?\.?$/.test(t))return {accion:'ultimo',fuente:'ambas'};
  if(/^que bove existe en proyecto h que no este en el libro\.?$/.test(t))return {accion:'comparar',fuente:'ambas',direccion:'proyecto_h'};
  if(/^que bove existe en el libro que no este en proyecto h\.?$/.test(t))return {accion:'comparar',fuente:'ambas',direccion:'libro'};
  if(/^(?:compara|comparar)\s+(?:los\s+)?bove\b/.test(t))return {accion:'comparar',fuente:'ambas'};
  return null;
 }
 async function paginas(build){
  const out=[];
  for(let i=0;;i+=500){const {data,error}=await build().range(i,i+499);if(error)throw error;out.push(...(data||[]));if((data||[]).length<500)return out;}
 }
 const campos='id,titular_nombre,estado_reserva,bove_cierre,bove_checkout,estadias:reserva_estadias(id,fecha_ingreso,fecha_salida,estado_estadia,tipo_estadia,checkin_realizado_en,checkout_realizado_en,cabanas(numero))';
 function desdeProyecto(reservas){
  return reservas.flatMap(r=>{
   const grupos=new Map();
   for(const [campo,tipo] of [['bove_cierre','alojamiento'],['bove_checkout','servicios']]){
    const n=numero(r[campo]);if(!n)continue;
    if(!grupos.has(n))grupos.set(n,{numero:n,estado:'registrado',fuente:'proyecto_h',reserva_id:r.id,titular:r.titular_nombre,tipos:[],segmentos:(r.estadias||[]).map(e=>({cabana:e.cabanas?.numero,fecha:e.fecha_ingreso,hasta:e.fecha_salida}))});
    grupos.get(n).tipos.push(tipo);
   }return [...grupos.values()];
  });
 }
 function contiene(origen,e){
  if(origen?.hoja!==e.origen.hoja)return false;
  const coords=String(origen.celda||'').split(':');
  if(coords.length===1)return coords[0]===e.origen.celda;
  const col=s=>[...s.match(/^[A-Z]+/)[0]].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0);
  return coords.every(s=>Number(s.match(/\d+$/)?.[0])===e.origen.fila)&&col(coords[0])<=e.origen.columna&&col(coords[1])>=e.origen.columna;
 }
 function resolverContexto(e,hoja){
  const dia=e.fecha_bloque,cab=Number(e.cabana_contexto);
  const fechaValida=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  if(!fechaValida(dia)||!Number.isInteger(cab)||cab<=0)return {resolucion:'no_determinada'};
  const candidatas=(hoja.reservas||[]).filter(r=>{
   if(Number(r.cabana)!==cab||(r.hoja&&r.hoja!==e.origen.hoja))return false;
   // Días ocupados de la semántica: salida excluida en alojamiento; Full Day
   // pertenece a su fecha de ingreso/salida, sin agregar una noche.
   if(r.tipo_estadia==='full_day')return r.fecha_checkin===dia&&r.fecha_checkout===dia;
   if(Array.isArray(r.fechas_ocupadas))return r.fechas_ocupadas.includes(dia);
   return fechaValida(r.fecha_checkin)&&fechaValida(r.fecha_checkout)&&r.fecha_checkin<=dia&&dia<r.fecha_checkout;
  });
  const r=candidatas[0];
  if(candidatas.length!==1)return {resolucion:candidatas.length?'contexto_ambiguo':'sin_candidatas',candidatas_contexto:candidatas.length};
  if(!r.titular?.trim()||r.titular==='no_determinado'||r.advertencias?.length)return {resolucion:'no_determinada',candidatas_contexto:1};
  return {titular_resuelto:r.titular,resolucion:'contexto_unico',candidatas_contexto:1,
   reserva_contexto:{cabana:r.cabana,fecha_checkin:r.fecha_checkin,fecha_checkout:r.fecha_checkout,tipo_estadia:r.tipo_estadia}};
 }
 function desdeLibro(hoja){
  return (hoja.evidencias_bove||[]).map(e=>{
   // Únicamente asociaciones ya resueltas por la semántica, nunca proximidad.
   const candidatos=(hoja.reservas||[]).flatMap(r=>{
    if(contiene(r.coordenadas_origen,e))return [{r,tipo:'no_determinado'}];
    return (r.pagos||[]).filter(p=>contiene(p.origen,e)).map(p=>({r,tipo:p.tipo_movimiento==='alojamiento'?'alojamiento':p.tipo_movimiento==='servicio'?'servicios':'no_determinado'}));
   });
   const seguro=candidatos.length===1?candidatos[0]:null;
   return {...e,...(!seguro?.r.titular?resolverContexto(e,hoja):{}),fuente:'libro',titular:seguro?.r.titular,tipos:[seguro?.tipo||'no_determinado'],
    segmentos:seguro?[{cabana:seguro.r.cabana,fecha:seguro.r.fecha_checkin,hasta:seguro.r.fecha_checkout}]:[],
    serie:/\bno\s+afect[ao]\b/.test(norm(e.texto_original))?'no_afecta':/\bafect[ao]\b/.test(norm(e.texto_original))?'normal':'no_determinada'};
  });
 }
 function compatible(a,b){
  return !!a.titular&&norm(a.titular)===norm(b.titular)&&a.tipos.some(t=>t!=='no_determinado'&&b.tipos.includes(t))&&
   a.segmentos.some(x=>b.segmentos.some(y=>x.cabana!=null&&String(x.cabana)===String(y.cabana)&&x.fecha&&x.fecha===y.fecha&&x.hasta&&x.hasta===y.hasta));
 }
 function comparar(libro,proyecto){
  const out=[],usados=new Set();
  for(const l of libro){
   if(l.estado==='no_determinado'){out.push({estado:'no_determinado',libro:l});continue;}
   const candidatos=proyecto.filter(p=>compatible(l,p));
   const inversos=candidatos.length===1?libro.filter(x=>compatible(x,candidatos[0])):[];
   if(candidatos.length===1&&inversos.length===1){
    const p=candidatos[0];usados.add(p);
    out.push({estado:l.estado==='pendiente'?'pendiente':!p.numero?'solo_libro':l.numero===p.numero?'coinciden':'conflicto',libro:l,proyecto:p});
   }else if(candidatos.length||!l.titular||proyecto.some(p=>p.numero===l.numero))out.push({estado:'no_determinado',libro:l,candidatos});
   else out.push({estado:l.estado==='pendiente'?'pendiente':'solo_libro',libro:l});
  }
  for(const p of proyecto)if(!usados.has(p))out.push({estado:!p.numero?'pendiente':libro.some(l=>l.numero===p.numero||compatible(l,p)||!l.titular)?'no_determinado':'solo_proyecto_h',proyecto:p});
  return out;
 }
 const cache=new WeakMap();
 async function leerLibro(libro,q,dia,control){
  if(!libro)throw Error('Carga un XLSX para consultar el Libro.');await libro.listo();control.comprobar();const estado=libro.estado();
  if(!estado.cargado)throw Error('Carga un XLSX para consultar el Libro.');
  let c=cache.get(libro);if(!c||c.g!==estado.generacion){c={g:estado.generacion,hojas:new Map(),numeros:new Map()};cache.set(libro,c);}
  let nombres=libro.listarHojas();
  // Búsqueda textual por concepto: conserva 16.968 y 16,968, sin reconciliar.
  if(q.accion==='pendientes'){
   const requeridos=new Set();
   for(let d=q.desde;d<=q.hasta_efectiva;d=moverDia(d,1))requeridos.add(meses[Number(d.slice(5,7))-1].slice(0,3)+d.slice(2,4));
   nombres=nombres.filter(n=>requeridos.has(norm(n).replace(/\s/g,'')));
   if(nombres.length!==requeridos.size)throw Error('No se identificaron inequívocamente todas las hojas mensuales del rango. Cobertura del Libro no determinada.');
  }else if(q.accion==='buscar'){
   if(!libro.buscarHojasBove)throw Error('El lector activo aún no dispone de búsqueda BOVE focalizada. Actualiza la aplicación conservando el Libro guardado.');
   const clave=[...q.numeros].sort().join('|');
   if(!c.numeros.has(clave))c.numeros.set(clave,libro.buscarHojasBove(q.numeros.length===1?q.numeros[0]:q.numeros).catch(e=>{c.numeros.delete(clave);throw e;}));
   nombres=[...new Set((await c.numeros.get(clave)).hojas)];
  }else if(libro.buscarHojas)nombres=(await libro.buscarHojas('BOVE')).hojas;
  control.comprobar();
  const evidencias=[],avisos=[];
  for(const nombre of nombres){
   control.comprobar();
   if(!c.hojas.has(nombre))c.hojas.set(nombre,libro.consultarHoja(nombre).catch(e=>{c.hojas.delete(nombre);throw e;}));
   const h=await c.hojas.get(nombre);
   control.comprobar();
   if(!Array.isArray(h.evidencias_bove))throw Error('El lector cargado aún no expone evidencias BOVE. Recarga la aplicación.');
   evidencias.push(...desdeLibro(h));
  }
  if(libro.estado().generacion!==c.g)throw Error('El Libro cambió durante la lectura. Repite la consulta.');
  return {evidencias,avisos};
 }
 async function pendientes(reservas,cliente,dia,rango={desde:dia,hasta_efectiva:dia}){
  const aplica=e=>e.fecha_ingreso>=rango.desde&&e.fecha_ingreso<=rango.hasta_efectiva&&e.fecha_ingreso<=dia&&
   !['cancelada','no_show'].includes(e.estado_estadia)&&
   (['hospedada','checked_out'].includes(e.estado_estadia)||!!e.checkin_realizado_en||!!e.checkout_realizado_en);
  const rs=reservas.filter(r=>!['cancelada','no_show'].includes(r.estado_reserva)&&(r.estadias||[]).some(aplica));
  const out=[];
  for(const r of rs){
   const cargos=await paginas(()=>cliente.from('vista_estado_cargos').select('reserva_id,servicio_id,monto,saldo_cargo,tipo_cargo,estado').eq('reserva_id',r.id).eq('estado','activo').order('servicio_id'));
   for(const [tipo,campo] of [['alojamiento','bove_cierre'],['servicios','bove_checkout']]){
    if(String(r[campo]||'').trim())continue;
    const cs=cargos.filter(c=>c.tipo_cargo===(tipo==='servicios'?'servicio':'alojamiento'));
    if(!cs.length||cs.reduce((s,c)=>s+Number(c.monto||0),0)<=0)continue;
    if(tipo==='servicios'){
     const servicios=await paginas(()=>cliente.from('servicios').select('id,total,tipo_cobro,estado_servicio').eq('reserva_id',r.id).order('id'));
     const pagado=servicios.some(s=>Number(s.total)>0&&s.tipo_cobro!=='cortesia'&&!['cancelada','cancelado','no_show'].includes(s.estado_servicio)&&
      cs.some(c=>c.servicio_id===s.id)&&cs.filter(c=>c.servicio_id===s.id).reduce((a,c)=>a+Number(c.saldo_cargo||0),0)<=0);
     if(!pagado)continue;
    }
    out.push({fuente:'proyecto_h',estado:'pendiente',numero:null,reserva_id:r.id,titular:r.titular_nombre,tipos:[tipo],segmentos:r.estadias.filter(aplica).map(e=>({cabana:e.cabanas?.numero,fecha:e.fecha_ingreso,hasta:e.fecha_salida}))});
   }
  }return out;
 }
 async function ejecutarConsulta(texto,{libro=root.HAIKU_LIBRO_RESERVA_V1,cliente=root.haikuSupabase,dia=hoy()}={},control){
  const q=interpretar(texto,dia);if(!q)throw Error('Consulta BOVE no reconocida.');
  const r={q,dia,libro:[],proyecto:[],comparacion:[],avisos:[]};let reservas=[];
  if(q.error_rango){r.avisos.push(q.error_rango);return r;}
  if(q.futuro)r.avisos.push('Revisé hasta hoy; las fechas futuras no se consideran pendientes.');
  if(q.accion==='pendientes'&&q.desde>q.hasta_efectiva){r.avisos=['El rango solicitado es futuro: todavía no es exigible. No se consultaron reservas.'];return r;}
  if(q.fuente!=='libro'){
   if(!cliente)throw Error('La sesión de Proyecto H no está disponible.');
   reservas=await paginas(()=>{let b=cliente.from('reservas').select(q.accion==='pendientes'?campos.replace('reserva_estadias(','reserva_estadias!inner('):campos).order('id');
    if(q.accion==='pendientes')b=b.gte('estadias.fecha_ingreso',q.desde).lte('estadias.fecha_ingreso',q.hasta_efectiva);
    if(q.accion==='buscar'){
     const variantes=[...new Set(q.numeros.flatMap(n=>[n,n.replace(/\B(?=(\d{3})+(?!\d))/g,'.'),n.replace(/\B(?=(\d{3})+(?!\d))/g,',')]))];
     b=b.or(['bove_cierre','bove_checkout'].flatMap(c=>variantes.map(n=>`${c}.eq."${n}"`)).join(','));
    }return b;});
   r.proyecto=q.accion==='pendientes'?await pendientes(reservas,cliente,dia,q):desdeProyecto(reservas);
  }
  if(q.fuente!=='proyecto_h'){
   try{control.comprobar();const l=await leerLibro(libro,q,dia,control);r.libro=l.evidencias;}catch(e){r.avisos.push(e.message);r.incompleto=true;}
  }
  if(q.accion==='buscar'){
   r.libro=r.libro.filter(e=>q.numeros.includes(e.numero));r.proyecto=r.proyecto.filter(e=>q.numeros.includes(e.numero));
  }
  if(q.accion==='pendientes'){
   const sinContexto=r.libro.filter(e=>!e.segmentos.length&&!e.fecha_bloque).length;
   if(sinContexto)r.avisos.push(`${sinContexto} evidencias del Libro sin fecha/asociación segura: no se asignan a los ingresos del rango.`);
   const dentro=d=>d&&d>=q.desde&&d<=q.hasta_efectiva;
   r.libro=r.libro.filter(e=>e.segmentos.some(s=>dentro(s.fecha))||dentro(e.fecha_bloque));
  }
  if(q.fuente==='ambas'&&!r.incompleto){
   const faltantes=[];
   if(q.accion==='comparar')for(const reserva of reservas)for(const [campo,tipo] of [['bove_cierre','alojamiento'],['bove_checkout','servicios']]){
    if(String(reserva[campo]||'').trim())continue;
    const e={fuente:'proyecto_h',estado:'pendiente',numero:null,reserva_id:reserva.id,titular:reserva.titular_nombre,tipos:[tipo],segmentos:(reserva.estadias||[]).map(s=>({cabana:s.cabanas?.numero,fecha:s.fecha_ingreso,hasta:s.fecha_salida}))};
    if(r.libro.some(l=>compatible(l,e)))faltantes.push(e);
   }
   r.comparacion=q.accion==='buscar'?q.numeros.flatMap(n=>comparar(r.libro.filter(e=>e.numero===n),r.proyecto.filter(e=>e.numero===n))):comparar(r.libro,[...r.proyecto,...faltantes]);
  }
  if(q.accion==='buscar')r.por_numero=q.numeros.map(n=>{
   const l=r.libro.filter(e=>e.numero===n),p=r.proyecto.filter(e=>e.numero===n);
   const c=q.fuente==='ambas'&&!r.incompleto?comparar(l,p):[];
   const estado=r.incompleto?'no_determinado':q.fuente!=='ambas'?(l.length+p.length?'encontrado':'no_encontrado'):!l.length&&!p.length?'no_encontrado':c.every(x=>x.estado==='coinciden')?'coinciden':c.length===1?c[0].estado:'no_determinado';
   return {numero:n,libro:l,proyecto:p,comparacion:c,estado};
  });
  return r;
 }
 async function consultar(texto,opciones={}){
  let vencida=false,timer;
  const error=()=>Error('La consulta BOVE superó el tiempo de espera (20 segundos). No se pudo completar la lectura; no significa que el BOVE no exista.');
  const control={comprobar(){if(vencida)throw error();}};
  try{return await Promise.race([ejecutarConsulta(texto,opciones,control),new Promise((_,reject)=>{
   timer=setTimeout(()=>{vencida=true;reject(error());},opciones.timeoutMs??20000);
  })]);}finally{clearTimeout(timer);}
 }
 function resumenUltimos(items){
  const grupos=new Map();
  for(const e of items){if(!e.numero)continue;const serie=e.serie&&e.serie!=='no_determinada'?e.serie:`sin certificar (${e.numero.length} dígitos)`;
   const n=grupos.get(serie);if(!n||BigInt(e.numero)>BigInt(n))grupos.set(serie,e.numero);}
  return [...grupos].map(([serie,n])=>`${serie}: mayor número observado ${n}`).join('\n')||'No encontré números BOVE.';
 }
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function renderizar(r){
  const labels={coinciden:'Coinciden',conflicto:'Conflicto · requiere revisión',pendiente:'Pendiente',solo_libro:'Sólo en Libro',solo_proyecto_h:'Sólo en Proyecto H',no_determinado:'No determinado · requiere revisión',encontrado:'Encontrado',no_encontrado:'No encontrado'};
  if(r.q.error_rango)return `<article class="haku-bove-consulta"><h3>Consulta BOVE</h3><p>${esc(r.q.error_rango)}</p></article>`;
  if(r.por_numero?.length>1){
   const totales=new Map();for(const x of r.por_numero)totales.set(x.estado,(totales.get(x.estado)||0)+1);
   return `<article class="haku-bove-consulta"><h3>BOVE consultados · ${r.por_numero.length}</h3><p>${[...totales].map(([e,n])=>`${n} ${labels[e]}`).join(' · ')}</p>${r.por_numero.map(x=>`<section><p>Estado: ${labels[x.estado]}</p>${renderizar({...r,...x,por_numero:null,q:{...r.q,numero:x.numero,numeros:[x.numero]}})}</section>`).join('')}</article>`;
  }
  const notaPendiente=e=>{
   if(r.q.accion!=='pendientes'||e.fuente!=='proyecto_h')return '';
   if(r.incompleto)return '<p>Libro: lectura no disponible; no se puede contrastar.</p>';
   const candidatas=r.libro.filter(l=>compatible(l,e));
   if(candidatas.length===1&&r.proyecto.filter(p=>compatible(candidatas[0],p)).length===1){
    const l=candidatas[0];return l.numero?`<p>Libro contiene BOVE ${esc(l.numero)}; Proyecto H aún no lo tiene registrado.</p>`:l.estado==='pendiente'?'<p>Pendiente en ambas fuentes.</p>':'<p>Libro: evidencia no determinada.</p>';
   }
   const posibles=r.libro.filter(l=>candidatas.includes(l)||e.segmentos.some(s=>String(s.cabana)===String(l.cabana_contexto)&&s.fecha===l.fecha_bloque));
   return posibles.length?`<p>Posible contexto del Libro, sin asociación inequívoca: ${posibles.map(l=>esc(`${l.numero||'sin número'} · ${l.origen?.hoja||''}!${l.origen?.celda||''}`)).join('; ')}.</p>`:'<p>Libro: no hay evidencia inequívocamente asociada en esta consulta.</p>';
  };
  const fila=e=>`<div class="haku-bove-item"><strong>${esc(e.numero||(e.estado==='pendiente'?'BOVE pendiente':'BOVE no determinado'))}</strong> · ${esc(e.tipos.join(' / '))}<p>${esc(e.titular||e.titular_resuelto||'Titular no determinado')} ${esc(e.segmentos.map(s=>`· CAB ${s.cabana??'—'} · ${s.fecha} → ${s.hasta}`).join(' '))}</p>${e.origen?`<small>${esc(e.origen.hoja)} · ${esc(e.origen.celda)}${e.fecha_bloque?` · Contexto del bloque: CAB ${esc(e.cabana_contexto)} · ${esc(e.fecha_bloque)} (sin asociación automática)`:''}</small>`:''}${e.resolucion==='contexto_unico'?'<p>Identificado por contexto único de estadía.</p>':e.resolucion==='contexto_ambiguo'?`<p>Más de una estadía compatible con CAB ${esc(e.cabana_contexto)} · ${esc(e.fecha_bloque)}. Titular no determinado.</p>`:''}${notaPendiente(e)}</div>`;
  let h=`<article class="haku-bove-consulta"><h3>${r.q.accion==='pendientes'?`BOVE pendientes · ${r.q.desde} → ${r.q.hasta} · ${r.proyecto.length} requieren revisión`:r.q.numero?`BOVE ${esc(r.q.numero)}`:'Consulta BOVE'}</h3><p>Sólo lectura · ${esc(r.dia)}</p>`;
  if(r.q.accion==='pendientes')h+='<p>Sólo ingresos con check-in acreditado o estadía Hospedada/Checked Out. Confirmadas sin check-in no se consideran atrasadas.</p>';
  for(const a of r.avisos)h+=`<p>${esc(a)}</p>`;
  if(r.q.accion==='ultimo')h+=`<p style="white-space:pre-line">${esc(resumenUltimos([...r.libro,...r.proyecto]))}</p><p>Mayor número observado no certifica orden de registro ni serie tributaria. Las longitudes se muestran separadas.</p>`;
  else{
   for(const [key,titulo] of [['proyecto','Proyecto H'],['libro','Libro de Reservas']]){
    if(r.q.fuente==='libro'&&key==='proyecto'||r.q.fuente==='proyecto_h'&&key==='libro')continue;
    h+=`<details${r.q.accion==='comparar'?'':' open'}><summary>${titulo} · ${r[key].length}</summary>${r[key].map(fila).join('')||`<p>${key==='libro'&&r.incompleto?'Lectura no disponible.':'Sin coincidencias en esta consulta.'}</p>`}</details>`;
   }
   if(r.comparacion.length)h+='<section><h4>Comparación</h4>'+r.comparacion.filter(c=>!r.q.direccion||c.estado===('solo_'+r.q.direccion)||['conflicto','no_determinado'].includes(c.estado)).map(c=>`<p><strong>${labels[c.estado]}</strong> · ${esc(c.libro?.titular||c.proyecto?.titular||'Contexto no determinado')} · Libro: ${esc(c.libro?.numero||'sin número')} · Proyecto H: ${esc(c.proyecto?.numero||'sin número')}</p>`).join('')+'</section>';
  }
  return h+'<p>Las evidencias sin contexto seguro no prueban ausencia ni identidad. No se ofrecen acciones de guardado.</p></article>';
 }
 function instalar(){
  const doc=root.document;if(!doc)return;let campo,mensajes;
  const style=doc.createElement('style');style.textContent='.haku-bove-consulta{border:1px solid #cbded1;border-radius:14px;padding:14px;background:#f6faf7;color:#263e30;overflow-wrap:anywhere}.haku-bove-consulta h3{font-size:17px;margin:0}.haku-bove-consulta p{font-size:12px;line-height:1.5;margin:6px 0}.haku-bove-consulta h4{font-size:13px;margin:14px 0 6px}.haku-bove-item{padding:8px;border:1px solid #dce8df;border-radius:9px;background:white;margin:6px 0;font-size:12px}';doc.head.appendChild(style);
  let ocupado=false;
  const mensaje=(tipo,texto)=>{const el=doc.createElement('div');el.className=`haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`;el.textContent=texto;mensajes.appendChild(el);return el;};
  async function procesar(t){if(ocupado)return;ocupado=true;campo.value='';campo.dispatchEvent(new root.Event('input',{bubbles:true}));mensaje('usuario',t);const el=mensaje('asistente','Consultando BOVE…');
   try{el.innerHTML=renderizar(await consultar(t));}catch(e){el.textContent='No pude completar la lectura BOVE. '+e.message;}finally{ocupado=false;mensajes.scrollTop=mensajes.scrollHeight;}}
  // La UI se crea dinámicamente. Registrar captura ahora conserva el orden de
  // panel.html; resolver los nodos al enviar evita esperar a DOMContentLoaded.
  function interceptar(e){
   campo=doc.getElementById('haiku-asistente-texto');mensajes=doc.getElementById('haiku-asistente-mensajes');
   if(!campo||!mensajes)return;
   if(e.type==='click'?!e.target?.closest?.('#haiku-asistente-enviar'):e.target!==campo)return;
   if(e.type==='keydown'&&(e.key!=='Enter'||e.shiftKey||e.isComposing))return;
   if(doc.getElementById('haiku-asistente-adjuntos')?.querySelector('.haiku-asistente-adjunto'))return;
   const t=campo.value.trim();if(!interpretar(t))return;e.preventDefault();e.stopImmediatePropagation();void procesar(t);}
  root.addEventListener('click',interceptar,true);root.addEventListener('keydown',interceptar,true);
 }
 const api=Object.freeze({interpretar,consultar,desdeProyecto,desdeLibro,comparar,resumenUltimos,renderizar,pendientes});
 root.HAIKU_ASISTENTE_BOVE_CONSULTAS_V1=api;if(typeof module!=='undefined')module.exports=api;
 if(root.document)instalar();
})(typeof window!=='undefined'?window:globalThis);
