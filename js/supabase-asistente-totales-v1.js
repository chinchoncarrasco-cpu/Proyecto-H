/* TOTAL 1: vista previa, segunda lectura y una única RPC transaccional. */
(function(root){
 'use strict';if(root.HAIKU_ASISTENTE_TOTALES_V1)return;
 const MAX=20,RPC='haiku_cambiar_totales_lote_v1',previews=new WeakMap();
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const copia=v=>JSON.parse(JSON.stringify(v));
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dinero=v=>'CLP $'+Number(v).toLocaleString('es-CL');
 function monto(v){const t=String(v).replace(/^(?:CLP\s*\$?|\$)\s*/i,'');if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(t))return null;const n=Number(t.replace(/\./g,''));return Number.isSafeInteger(n)&&n>0?n:null;}
 function interpretar(texto){
  let t=String(texto).trim().replace(/^haku[ ,:]*/i,'');
  // La variante reserva primero se traduce al formato existente; no cambia la resolución.
  const reservaPrimero=t.match(/^reserva\s+(.+?)\s+(cambia|modifica|fija)\s+(?:el\s+)?total\s+a\s+((?:CLP\s*\$?\s*|\$\s*)?[\d.]+)$/i);
  if(reservaPrimero){
   const cabFinal=reservaPrimero[1].match(/^(.+?)\s+(?:cab|cabaña)\s+(\d+)$/i);
   const nombre=(cabFinal?cabFinal[1]:reservaPrimero[1]).trim();
   if(/\b(?:cab|cabaña|cambia|modifica|fija|total)\b/i.test(nombre))return {error:'Indica una sola reserva con titular completo y CAB inequívoca.'};
   t=`${reservaPrimero[2]} total ${cabFinal?'CAB '+cabFinal[2]+' ':''}${nombre} a ${reservaPrimero[3]}`;
  }
  if(!/^(?:cambia|modifica|fija)\s+(?:el\s+|los\s+)?(?:precio\s+)?total(?:es)?\b/i.test(t))return null;
  t=t.replace(/^(?:cambia|modifica|fija)\s+(?:el\s+|los\s+)?(?:precio\s+)?total(?:es)?\s*/i,'');
  const partes=t.split(/\s+y\s+|,\s*|\r?\n+/i).map(x=>x.trim()).filter(Boolean);
  if(!partes.length||partes.length>MAX)return {error:`Indica entre 1 y ${MAX} reservas con su nuevo total.`};
  const entradas=[];
  for(let p of partes){
   p=p.replace(/^(?:de\s+)?(?:la\s+)?reserva\s+(?:de\s+)?/i,'').replace(/^de\s+/i,'');
   const m=p.match(/^(.+?)\s+a\s+((?:CLP\s*\$?\s*|\$\s*)?[\d.]+)$/i);
   if(!m||monto(m[2])===null)return {error:'Cada entrada debe indicar titular y un total CLP entero positivo. Ejemplo: CAB 5 Bruno Borge a $459.000.'};
   const cab=m[1].match(/^CAB\s+(\d+)\s*[·:—-]?\s+(.+)$/i),nombre=(cab?cab[2]:m[1]).trim();
   if(!/^[a-z]+(?:[ '\-][a-z]+)+$/.test(norm(nombre))||cab&&Number(cab[1])<=0)return {error:'Indica un titular completo y, si corresponde, CAB. No se usa parecido de nombres.'};
   entradas.push({titular:nombre,cabana:cab?Number(cab[1]):null,total_objetivo:monto(m[2]),origen:'chat'});
  }return {entradas};
 }
 async function filas(build){const out=[];for(let i=0;i<10000;i+=500){const {data,error}=await build().range(i,i+499);if(error)throw error;out.push(...(data||[]));if((data||[]).length<500)return out;}throw Error('Demasiadas candidatas para garantizar una resolución completa.');}
 const campos='id,titular_nombre,estado_reserva,grupo_reserva_id,estadias:reserva_estadias(id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,cabanas(numero),noches:estadia_noches(fecha,tarifa))';
 function motivo(r,total,objetivo,ajustes,permitirResiduo=true){
  if(['cancelada','no_show'].includes(r.estado_reserva))return 'Reserva cancelada o no-show.';
  if(r.grupo_reserva_id)return 'Reserva vinculada a un grupo: requiere revisión.';
  if(r.estadias?.length!==1)return 'Varias estadías o estructura desconocida: requiere revisión.';
  const e=r.estadias[0];if(['cancelada','no_show'].includes(e.estado_estadia))return 'Estadía no editable.';
  if(ajustes.length)return 'Existen ajustes activos: requiere revisión.';
  if(!Number.isSafeInteger(total)||total<0)return 'Total financiero no disponible.';
  if(e.tipo_estadia==='fullday')return e.fecha_ingreso===e.fecha_salida?null:'Full Day inconsistente.';
  if(e.tipo_estadia!=='alojamiento')return 'Tipo de estadía no admitido.';
  const dias=(Date.parse(e.fecha_salida)-Date.parse(e.fecha_ingreso))/86400000,n=e.noches||[];
  if(!Number.isInteger(dias)||dias<=0||n.length!==dias||new Set(n.map(x=>x.fecha)).size!==dias||n.some(x=>x.fecha<e.fecha_ingreso||x.fecha>=e.fecha_salida))return 'Noches incompletas: requiere revisión.';
  if(new Set(n.map(x=>Number(x.tarifa))).size!==1||n.some(x=>Number(x.tarifa)<=0)||n.reduce((a,x)=>a+Number(x.tarifa),0)!==total)return 'Tarifas variables o cargos inconsistentes: requiere revisión.';
  if(!permitirResiduo&&objetivo%dias!==0)return 'El total debe dividirse exactamente entre las noches; no se redondean tarifas.';
  return null;
 }
 async function leer(cliente,id){
  const rs=await filas(()=>cliente.from('reservas').select(campos).eq('id',id).order('id'));
  if(rs.length!==1)throw Error('La reserva no está disponible.');
  const saldos=await filas(()=>cliente.from('vista_saldos_alojamiento_reserva').select('reserva_id,total_alojamiento').eq('reserva_id',id).order('reserva_id'));
  if(saldos.length!==1||saldos[0].total_alojamiento==null)throw Error('No se pudo leer el total financiero de alojamiento.');
  const ajustes=await filas(()=>cliente.from('cargo_ajustes').select('id,operacion_id,reserva_id,cargo_id,tipo_ajuste,signo,monto,concepto,porcentaje,base_calculo,estado').eq('reserva_id',id).eq('estado','activo').order('id'));
  return {reserva:rs[0],total:Number(saldos[0].total_alojamiento),ajustes};
 }
 async function diagnosticarAjustes(cliente,v){
  try{
   const cargos=await filas(()=>cliente.from('vista_estado_cargos').select('cargo_id,reserva_id,tipo_cargo,estado,monto,monto_ajustado').eq('reserva_id',v.reserva.id).eq('tipo_cargo','alojamiento').eq('estado','activo').order('cargo_id'));
   const sumar=(xs,campo)=>xs.length&&xs.every(x=>x[campo]!=null&&Number.isSafeInteger(Number(x[campo])))?xs.reduce((a,x)=>a+Number(x[campo]),0):null;
   // Sólo sumar importes existentes; nunca recalcular IVA, porcentajes ni el
   // total final a partir de los ajustes. La vista financiera es la autoridad.
   const grupos=new Map();
   for(const a of v.ajustes){
    const clave=a.operacion_id||a.id;
    if(!grupos.has(clave))grupos.set(clave,[]);grupos.get(clave).push(a);
   }
   const operaciones=[...grupos].map(([id,filas])=>{
    // Una operación puede repartir su monto entre cargos. Mantener separados
    // tipos/signos/conceptos diferentes y mostrar las bases originales por fila.
    const partes=new Map();
    for(const a of filas){const clave=JSON.stringify([a.tipo_ajuste,a.signo,a.concepto]);if(!partes.has(clave))partes.set(clave,[]);partes.get(clave).push(a);}
    return {id,partes:[...partes.values()].map(xs=>({tipo:xs[0].tipo_ajuste,signo:xs[0].signo,concepto:xs[0].concepto,monto:sumar(xs,'monto'),bases:xs.map(x=>({porcentaje:x.porcentaje,base_calculo:x.base_calculo})),cargos_activos:xs.every(x=>cargos.some(c=>c.cargo_id===x.cargo_id))}))};
   });
   return {total_base:sumar(cargos,'monto'),total_ajustado:v.total,operaciones,discrepancia:sumar(cargos,'monto_ajustado')!==v.total};
  }catch(e){return {total_base:null,total_ajustado:v.total,operaciones:[],error:'No se pudo completar el detalle de ajustes: '+e.message};}
 }
 function soloIva(ajustes){return ajustes.length>0&&ajustes.every(a=>a.operacion_id&&a.tipo_ajuste==='iva_exento'&&Number(a.signo)===-1&&Number(a.porcentaje)===19)&&new Set(ajustes.map(a=>a.operacion_id)).size===1;}
 async function writerDisponible(cliente){
  try{const {data,error}=await cliente.rpc('haiku_capacidad_totales_v1');return !error&&data?.writer_disponible===true&&['total1_financiero_v2','total1_financiero_v3','total1_financiero_v31'].includes(data?.version);}
  catch(_){return false;}
 }
 async function leerPlanIva(cliente,id,objetivo,actual){
  const {data,error}=await cliente.rpc('haiku_previsualizar_total_iva_v1',{p_reserva_id:id,p_total_objetivo:objetivo});
  if(error)throw Error('La vista previa IVA no está disponible o requiere revisión. '+error.message);
  if(data?.reserva_id!==id||Number(data.total_actual)!==actual||Number(data.total_objetivo)!==objetivo||Number(data.total_final_esperado)!==objetivo||typeof data.firma!=='string'||!data.firma||!Array.isArray(data.filas)||!data.filas.length||['base_actual','base_nueva','iva_actual','iva_nuevo'].some(k=>!Number.isSafeInteger(Number(data[k]))||Number(data[k])<0))throw Error('Plan IVA no verificable. No se permite confirmar.');
  return data;
 }
 async function preparar(fuente,opciones={}){
  const q=typeof fuente==='string'?interpretar(fuente):{entradas:copia(fuente)};
  if(!q||q.error)return {estado:'bloqueada',mensaje:q?.error||'Orden no reconocida.'};
  const entradas=q.entradas,cliente=opciones.cliente||root.haikuSupabase,permiso=opciones.permiso||(()=>root.haikuTienePermiso?.('reservas.editar')&&root.haikuTienePermiso?.('pagos.ver'));
  if(!Array.isArray(entradas)||!entradas.length||entradas.length>MAX||entradas.some(e=>!Number.isSafeInteger(e.total_objetivo)||e.total_objetivo<=0||!e.reserva_id&&!e.titular))return {estado:'bloqueada',mensaje:'Lote inválido. No se preparó ningún cambio.'};
  try{
   if(!permiso())throw Error('Se requieren permisos reservas.editar y pagos.ver.');
   if(!cliente)throw Error('Sesión no disponible.');
   const candidatas=entradas.some(e=>!e.reserva_id)?await filas(()=>cliente.from('reservas').select(campos).order('id')):[];
   const items=[],errores=[];
   for(const entrada of entradas){
    const cs=entrada.reserva_id?[{id:entrada.reserva_id}]:candidatas.filter(r=>norm(r.titular_nombre)===norm(entrada.titular)&&(!entrada.cabana||r.estadias?.some(e=>Number(e.cabanas?.numero)===entrada.cabana)));
    if(cs.length!==1){errores.push(`${entrada.titular||entrada.reserva_id}: ${cs.length?'varias reservas compatibles; indica CAB o revisa la ficha':'no se encontró una reserva compatible'}.`);continue;}
    const v=await leer(cliente,cs[0].id),r=v.reserva;
    if(entrada.titular&&norm(r.titular_nombre)!==norm(entrada.titular)||entrada.cabana&&!r.estadias?.some(e=>Number(e.cabanas?.numero)===entrada.cabana))throw Error('La identificación cambió durante la preparación.');
    if(entrada.total_actual!=null&&Number(entrada.total_actual)!==v.total)throw Error('El total esperado por la fuente ya cambió.');
    let error=motivo(r,v.total,entrada.total_objetivo,v.ajustes),plan_iva=null;
    if(soloIva(v.ajustes)){
     try{plan_iva=await leerPlanIva(cliente,r.id,entrada.total_objetivo,v.total);error=motivo(r,Number(plan_iva.base_actual),Number(plan_iva.base_nueva),[],true);}
     catch(e){error=e.message;}
    }
    if(error)errores.push(`${r.titular_nombre}: ${error}`);
    const diagnostico=v.ajustes.length?await diagnosticarAjustes(cliente,v):null;
    items.push({reserva_id:r.id,titular:r.titular_nombre,cabana:entrada.cabana||r.estadias[0]?.cabanas?.numero,ingreso:r.estadias[0]?.fecha_ingreso,salida:r.estadias[0]?.fecha_salida,total_actual:v.total,total_objetivo:entrada.total_objetivo,origen:entrada.origen||'estructurado',snapshot:JSON.stringify(v),...(error?{error}:{}),...(diagnostico?{diagnostico}:{}),...(plan_iva?{plan_iva}:{})});
   }
   if(new Set(items.map(e=>e.reserva_id)).size!==items.length)errores.push('La misma reserva aparece más de una vez.');
   if(errores.length)return {estado:'bloqueada',items,solicitados:entradas.length,mensaje:'No se aplicará ningún cambio hasta resolver todas las entradas. '+errores.join(' ')};
   const cambios=items.filter(e=>e.total_actual!==e.total_objetivo).length,p={estado:cambios?'propuesta':'sin_cambios',items,cambios,mensaje:cambios?'Revisa los totales. Se confirmará todo el lote en una sola operación.':'Los totales ya coinciden. No hay cambios que realizar.'};
   if(cambios&&(!await writerDisponible(cliente)||items.some(e=>e.plan_iva?.solo_lectura===true)))return {...p,estado:'previsualizacion',mensaje:'Sólo previsualización. Guardar totales permanece bloqueado; el writer no está disponible para esta sesión.'};
   if(cambios)previews.set(p,{items:copia(items),cliente,permiso,estado:'pendiente'});return p;
  }catch(e){return {estado:'bloqueada',mensaje:e.message};}
 }
 async function refrescar(items){
  const tareas=[()=>root.haikuSincronizarReservasSupabase?.(),()=>root.HAIKU_RESERVAS_V1?.recargar?.(),()=>root.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(),()=>root.haikuCargarSaldosCheckinSupabase?.()];
  const modal=root.document?.getElementById('ficha-reserva-modal');
  if(modal&&!modal.hidden&&items.some(e=>e.reserva_id===modal.dataset.reservaId))tareas.push(()=>root.haikuRefrescarFichaSupabaseV2?.(modal.dataset.reservaId));
  const resultados=await Promise.allSettled(tareas.map(f=>Promise.resolve().then(f)));return resultados.some(r=>r.status==='rejected');
 }
 function cancelar(p){const c=previews.get(p);if(c&&c.estado==='pendiente')c.estado='cancelada';return {estado:'cancelada',mensaje:'Operación cancelada. No se enviaron cambios.'};}
 async function confirmar(p){
  const c=previews.get(p);if(!c||c.estado!=='pendiente')return {estado:'bloqueada',mensaje:'Esta propuesta no está disponible para confirmar.'};
  c.estado='revalidando';let enviado=false;
  try{
   if(!c.permiso())throw Error('Ya no tienes permisos para editar totales.');
   if(!await writerDisponible(c.cliente))throw Error('El writer de totales ya no está disponible.');
   for(const item of c.items){const v=await leer(c.cliente,item.reserva_id);if(JSON.stringify(v)!==item.snapshot)throw Error('La reserva o su total cambió desde la vista previa. Prepara nuevamente el lote.');
    let error;
    if(item.plan_iva){const plan=await leerPlanIva(c.cliente,item.reserva_id,item.total_objetivo,v.total);if(plan.solo_lectura===true||plan.firma!==item.plan_iva.firma)throw Error('El plan IVA cambió desde la vista previa o volvió a sólo lectura.');error=motivo(v.reserva,Number(plan.base_actual),Number(plan.base_nueva),[],true);}
    else error=motivo(v.reserva,v.total,item.total_objetivo,v.ajustes);if(error)throw Error(error);
   }
   if(!c.permiso())throw Error('Ya no tienes permisos para editar totales.');
   c.estado='enviando';enviado=true;
   const {data,error}=await c.cliente.rpc(RPC,{p_cambios:c.items.map(e=>({reserva_id:e.reserva_id,total_actual:e.total_actual,total_objetivo:e.total_objetivo,...(e.plan_iva?{firma_iva:e.plan_iva.firma}:{})}))});
   if(error)throw error;
   if(data?.ok!==true||!Array.isArray(data.resultados)||data.resultados.length!==c.items.length||c.items.some(e=>!data.resultados.some(r=>r.reserva_id===e.reserva_id&&Number(r.total_nuevo)===e.total_objetivo)))throw Error('Respuesta del guardado no verificable.');
   c.estado='completada';const aviso=await refrescar(c.items);
   return {estado:'completada',items:c.items,mensaje:'Totales actualizados correctamente.'+(aviso?' Alguna vista no pudo refrescarse; vuelve a abrirla.':'')};
  }catch(e){c.estado='terminada';return {estado:'bloqueada',mensaje:(enviado?'No se pudo confirmar el resultado del lote. Revisa Proyecto H antes de reintentar. ':'No se envió ningún cambio. ')+e.message};}
 }
 function renderizarDiagnostico(d,objetivo){
  const importe=v=>v==null?'No disponible':dinero(v);
  return `<p>Total base de alojamiento: <b>${importe(d.total_base)}</b></p>${d.operaciones.map((op,i)=>`<div><strong>Operación de ajuste activa ${i+1}</strong>${op.partes.map(a=>`<p>${esc(a.concepto||'Concepto no disponible')}<br>Tipo: ${esc(a.tipo||'No disponible')} · ${Number(a.signo)===1?'+':Number(a.signo)===-1?'−':'Signo no disponible: '}${importe(a.monto)}</p>${a.bases.some(b=>b.porcentaje!=null||b.base_calculo!=null)?`<details><summary>Porcentaje y base por cargo</summary>${a.bases.map(b=>`<p>Porcentaje: ${b.porcentaje==null?'No disponible':esc(b.porcentaje)+'%'} · Base: ${importe(b.base_calculo)}</p>`).join('')}</details>`:''}${a.cargos_activos?'':'<p>Hay ajustes vinculados a cargos fuera del alojamiento activo consultado; requieren revisión.</p>'}`).join('')}</div>`).join('')}<p>Total final actual: <b>${importe(d.total_ajustado)}</b><br>Nuevo total solicitado: <b>${dinero(objetivo)}</b></p>${d.error?`<p>${esc(d.error)}</p>`:''}${d.discrepancia?'<p>Las lecturas financieras no coinciden. Revisa nuevamente; no se recalculó el total.</p>':''}<p><strong>Requiere definir tratamiento del ajuste antes de modificar.</strong></p>`;
 }
 function renderizarPlanIva(e){const p=e.plan_iva;return `<p>Se conserva la operación IVA exento. ${p.solo_lectura===true?'Vista previa del <b>total final</b>. Guardado bloqueado.':'Confirmas el <b>total final</b>.'}</p><p>Base: ${dinero(p.base_actual)} → <b>${dinero(p.base_nueva)}</b><br>IVA exento: −${dinero(p.iva_actual)} → <b>−${dinero(p.iva_nuevo)}</b><br>Total final: ${dinero(e.total_actual)} → <b>${dinero(p.total_final_esperado)}</b></p><details><summary>Distribución exacta por noche</summary>${p.filas.map(f=>`<p>${esc(f.fecha)} · Base ${dinero(f.base_nueva)} · IVA −${dinero(f.iva_nuevo)}</p>`).join('')}</details>`;}
 function renderizar(p){return `<article class="haku-totales"><h3>${p.items?`${p.estado==='bloqueada'?'Diagnóstico de totales':'Cambiar totales'} · ${p.solicitados||p.items.length} reserva(s)`:'Cambio de total'}</h3><p>${esc(p.mensaje)}</p>${(p.items||[]).map(e=>`<section><strong>CAB ${esc(e.cabana)} · ${esc(e.titular)}</strong><p>${esc(e.ingreso)} → ${esc(e.salida)}</p>${e.plan_iva?renderizarPlanIva(e):e.diagnostico?renderizarDiagnostico(e.diagnostico,e.total_objetivo):`<p>${dinero(e.total_actual)} → <b>${dinero(e.total_objetivo)}</b></p><small>Diferencia: ${e.total_objetivo>=e.total_actual?'+':'−'}${dinero(Math.abs(e.total_objetivo-e.total_actual))}</small>`}${p.estado==='bloqueada'?`<p>${e.error?'⚠ '+esc(e.error):'✓ Sin bloqueo detectado en esta entrada; no se aplicará mientras el lote esté bloqueado.'}</p>`:''}</section>`).join('')}${p.estado==='propuesta'?`<p>Una operación atómica. Si alguna entrada falla, el lote se revierte.</p><div><button type="button" data-total-confirmar>Confirmar ${p.cambios} cambio(s)</button> <button type="button" data-total-cancelar>Cancelar</button></div>`:''}</article>`;}
 function instalar(){
  const doc=root.document,style=doc.createElement('style');style.textContent='.haku-totales{border:1px solid #cbded1;border-radius:14px;padding:14px;background:#f6faf7;color:#263e30;font:12px/1.5 system-ui;overflow-wrap:anywhere}.haku-totales h3{font-size:16px;margin:0}.haku-totales section{border:1px solid #dce8df;background:white;border-radius:9px;margin:8px 0;padding:10px}.haku-totales button{font:inherit;border-radius:9px;padding:8px 12px;border:1px solid #b7cec0;margin:4px 0;cursor:pointer}.haku-totales [data-total-confirmar]{background:#295a3d;color:white}.haku-totales button:disabled{opacity:.6;cursor:wait}';doc.head.appendChild(style);let ocupado=false;
  async function enviar(t,campo,mensajes){if(ocupado)return;ocupado=true;campo.value='';campo.dispatchEvent(new root.Event('input',{bubbles:true}));
   const agregar=(tipo,texto)=>{const el=doc.createElement('div');el.className='haiku-asistente-mensaje haiku-asistente-mensaje--'+tipo;el.textContent=texto;mensajes.appendChild(el);return el;};agregar('usuario',t);const el=agregar('asistente','Preparando vista previa de totales…');
   try{const p=await preparar(t);el.innerHTML=renderizar(p);let activo=false;
    el.addEventListener('click',async ev=>{const b=ev.target.closest?.('button');if(!b||activo)return;ev.preventDefault();ev.stopPropagation();
     if(b.hasAttribute('data-total-cancelar')){activo=true;el.innerHTML=renderizar(cancelar(p));}
     else if(b.hasAttribute('data-total-confirmar')){activo=true;el.querySelectorAll('button').forEach(x=>x.disabled=true);el.innerHTML=renderizar(await confirmar(p));}
    });
   }finally{ocupado=false;mensajes.scrollTop=mensajes.scrollHeight;}
  }
  const interceptar=e=>{const campo=doc.getElementById('haiku-asistente-texto'),mensajes=doc.getElementById('haiku-asistente-mensajes');if(!campo||!mensajes)return;
   if(e.type==='click'?!e.target.closest?.('#haiku-asistente-enviar'):e.target!==campo||e.key!=='Enter'||e.shiftKey||e.isComposing)return;
   if(doc.getElementById('haiku-asistente-adjuntos')?.querySelector('.haiku-asistente-adjunto'))return;
   const t=campo.value.trim();if(!interpretar(t))return;e.preventDefault();e.stopImmediatePropagation();void enviar(t,campo,mensajes);};
  root.addEventListener('click',interceptar,true);root.addEventListener('keydown',interceptar,true);
 }
 const api=Object.freeze({interpretar,preparar,confirmar,cancelar,renderizar});root.HAIKU_ASISTENTE_TOTALES_V1=api;if(typeof module!=='undefined')module.exports=api;if(root.document)instalar();
})(typeof window!=='undefined'?window:globalThis);
