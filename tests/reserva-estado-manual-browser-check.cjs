// Edge local, ficha y estilos reales, RPC simulada, TODA la red bloqueada.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const read=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');
const R='00000000-0000-4000-8000-000000000001',E='00000000-0000-4000-8000-000000000002';
const styles=['css/styles.css','css/sites-resumen-v1.css'].map(read).join('\n');
const scripts=['js/haiku-reserva-estado-manual-v1.js','js/supabase-finanzas-resumen-v1.js',
 'js/sites-resumen-drawer-v1.js','js/sites-resumen-reserva-v1.js'].map(read);
async function montar(page,state='hospedada',group=false){
 await page.goto('about:blank');
 await page.setContent(`<style>${styles}</style><button id="abrir">Ver reserva</button>`);
 await page.evaluate(({R,E,state,group})=>{
  window.fechaSeleccionada='2026-09-27';window.__writes=[];window.__refresh=[];window.__fail=false;
  window.__delay=0;window.__permission=true;
  window.__reads=0;window.__rpcError=null;window.__serverCambio=null;window.__httpStatus=200;
  window.__readGate=null;
  window.__resumenEventos=[];
  window.__readFailure=false;window.__failReadAfterConflict=false;
  window.__now='2026-09-27T15:00:00Z';const BrowserDate=Date;
  window.Date=class extends BrowserDate {
   constructor(...args){super(...(args.length?args:[window.__now]));}
   static now(){return new BrowserDate(window.__now).getTime();}
  };
  window.haikuSesion={usuario:{id:'usuario-prueba'}};
  window.haikuTienePermiso=p=>p==='reservas.ver'||window.__permission;
  window.__ficha={reserva:{id:R,codigo_haiku:'H-PRUEBA-01',titular_nombre:'Valentina Araya',
    estado_reserva:state,observaciones:'Llegada confirmada',bove_cierre:'BOVE 101',bove_checkout:null},
   estadias:[{id:E,reserva_id:R,cabana_numero:2,estado_estadia:state,tipo_estadia:'alojamiento',
    fecha_ingreso:'2026-09-25',fecha_salida:'2026-09-28',adultos:2,ninos:1,
    checkin_realizado_en:state==='hospedada'?'2026-09-25T18:00:00Z':null,
    checkout_realizado_en:null}],
   huespedes:[{es_titular:true,nombre:'Valentina',apellido:'Araya'},{nombre:'Alex',apellido:'Rivas'}],
   servicios:[{fecha_servicio:'2026-09-27',hora_inicio:'19:15:00',estado_servicio:'programado',catalogo_servicios:{nombre:'Tinaja Tonel'}}],
   pagos:[{estado:'confirmado',tipo_movimiento:'pago',etapa_operativa:'checkin',monto:150000}],
   cargos:[{estado:'activo',tipo_cargo:'alojamiento',monto:200000,saldo_cargo:50000}],
   notas:[{texto:'Aviso al turno',fecha_operacion:'2026-09-27'}],solicitudes:[{descripcion:'Desayuno sin frutos secos'}]};
  if(group)window.__ficha.estadias.unshift({...window.__ficha.estadias[0],id:'00000000-0000-4000-8000-000000000003',cabana_numero:7,estado_estadia:'confirmada',checkin_realizado_en:null});
  window.haikuLeerFichaSupabaseV2=async()=>{window.__reads++;
   if(window.__readGate)await window.__readGate;
   if(window.__readFailure)throw Error('Relectura simulada fallida');return structuredClone(window.__ficha);};
  window.haikuSupabase={async rpc(name,payload){
   assertLocal(name==='haiku_cambiar_estado_reserva_manual_v1','Sólo RPC manual');
   window.__writes.push({name,payload:structuredClone(payload)});
   window.__readsAtRpc=window.__reads;
   if(window.__delay)await new Promise(r=>setTimeout(r,window.__delay));
   if(window.__fail)return{error:{code:'P0001',message:'Fallo simulado de Supabase'},status:409};
   const s=window.__ficha.estadias.find(s=>s.id===payload.p_estadia_id);
   if(window.__rpcError){
    if(window.__serverCambio){s.estado_estadia=window.__serverCambio;s.checkin_realizado_en=null;s.checkout_realizado_en=null;
     window.__ficha.reserva.estado_reserva=window.__serverCambio;}
    if(window.__failReadAfterConflict)window.__readFailure=true;
    return{error:structuredClone(window.__rpcError),status:window.__httpStatus};
   }
   if(['cancelada','no_show'].includes(payload.p_estado))window.__ficha.estadias.forEach(s=>s.estado_estadia=payload.p_estado);
   else s.estado_estadia=payload.p_estado;
   window.__ficha.reserva.estado_reserva=payload.p_estado;
   s.checkin_realizado_en=payload.p_estado==='hospedada'?'2026-09-27T18:00:00Z':null;
   s.checkout_realizado_en=payload.p_estado==='checked_out'?'2026-09-27T18:00:00Z':null;
   return{data:{ok:true,estado:payload.p_estado}};
  }};
  function assertLocal(ok,msg){if(!ok)throw Error(msg);}
  window.haikuSincronizarReservasSupabase=async()=>window.__refresh.push('reservas');
  window.HAIKU_OPERACION_RESUMEN_FIX_V1={refrescar:async()=>window.__refresh.push('resumen')};
  window.HAIKU_RESERVAS_V1={recargar:async()=>window.__refresh.push('listado')};
  window.HistorialSupabase={cargar:async()=>window.__refresh.push('historial')};
  window.generarCalendario=()=>window.__refresh.push('calendario');
  window.cargarCabanasDia=(fecha,{evento})=>window.__resumenEventos.push(evento);
  window.haikuCargarPagosPendientesSupabase=async()=>window.__refresh.push('pagos');
 },{R,E,state,group});
 for(const content of scripts)await page.addScriptTag({content});
 await page.evaluate(({R,E})=>window.HAIKU_RESUMEN_RESERVA_SITES_V1.abrirPorId(R,document.querySelector('#abrir'),{estadiaId:E,numeroCabana:2}),{R,E});
}
async function directoPausado(page,destino){
 await page.locator('[data-reserva-estado-operativo]').click();
 await page.evaluate(destino=>{
  window.__readGate=new Promise(resolve=>window.__releaseRead=resolve);
  window.__avisosDirectos=0;
  const aviso=document.querySelector('[data-reserva-estado-confirmacion]');
  new MutationObserver(cambios=>{
   if(!aviso.hidden||cambios.some(c=>c.oldValue===null))window.__avisosDirectos++;
  }).observe(aviso,{attributes:true,attributeFilter:['hidden'],attributeOldValue:true});
  const boton=document.querySelector(`[data-reserva-nuevo-estado="${destino}"]`);
  boton.click();boton.click();
 },destino);
}
async function continuarLectura(page){
 await page.evaluate(()=>{window.__readGate=null;window.__releaseRead();});
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
 let checks=0;
 try{
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
   const page=await browser.newPage({viewport});const errors=[];
   await page.route('**/*',route=>route.abort());page.on('pageerror',e=>errors.push(e.message));
   await montar(page);
   const badge=page.locator('[data-reserva-estado-operativo]');
   const menu=page.locator('[data-reserva-estado-menu]');
   const confirm=page.locator('[data-reserva-estado-confirmacion]');
   await badge.click();assert.equal(await menu.isVisible(),true);checks++;
   assert.equal(await menu.locator('button').count(),6);checks++;
   assert.equal(await menu.locator('[aria-checked="true"]').innerText(),'Hospedado\n✓ Estado actual');checks++;
   assert.equal(await menu.locator('[data-reserva-nuevo-estado="no_show"]').isDisabled(),true);checks++;
   await page.screenshot({path:path.join(os.tmpdir(),`haiku-reserva-estado-${viewport.width}-selector.png`),fullPage:true});
   await menu.locator('[data-reserva-nuevo-estado="cancelada"]').click();
   assert.equal(await confirm.isVisible(),true);assert.equal(await page.evaluate(()=>__writes.length),0);checks++;
   assert.match(await confirm.innerText(),/Hospedado → Cancelada/);checks++;
   assert.match(await confirm.innerText(),/todas las estadías/);checks++;
   await page.screenshot({path:path.join(os.tmpdir(),`haiku-reserva-estado-${viewport.width}-confirmacion.png`),fullPage:true});
   const panel=await confirm.boundingBox();assert.ok(panel.x>=0&&panel.x+panel.width<=viewport.width);checks++;
   await page.locator('[data-reserva-estado-cancelar]').click();
   assert.equal(await confirm.isVisible(),false);assert.equal(await badge.innerText(),'Hospedado');
   assert.equal(await page.evaluate(()=>__writes.length),0);checks++;
   await badge.click();await menu.locator('[data-reserva-nuevo-estado="cancelada"]').click();
   await page.keyboard.press('Escape');
   assert.equal(await confirm.isVisible(),false);assert.equal(await badge.isVisible(),true);
   assert.equal(await page.evaluate(()=>__writes.length),0);checks++;
   // Una sola escritura, incluso con dos clics síncronos.
   await badge.click();await menu.locator('[data-reserva-nuevo-estado="confirmada"]').click();
   assert.match(await confirm.innerText(),/limpiarán el check-in y el check-out/);checks++;
   await page.evaluate(()=>{__delay=100;const b=document.querySelector('[data-reserva-estado-confirmar]');b.click();b.click();});
   await page.waitForFunction(()=>document.querySelector('[data-reserva-estado-operativo]').textContent==='Confirmada');
   assert.equal(await page.evaluate(()=>__writes.length),1);checks++;
   assert.equal(await page.evaluate(()=>__writes[0].payload.p_estadia_id),E);
   assert.equal(await page.evaluate(()=>__writes[0].payload.p_estado),'confirmada');checks++;
   assert.deepEqual((await page.evaluate(()=>__refresh)).sort(),['calendario','historial','listado','pagos','reservas','resumen']);checks++;
   assert.match(await page.locator('[data-reserva-contenido]').innerText(),/Valentina Araya|Tinaja Tonel|Desayuno sin frutos secos/);
   // Error del servidor: badge anterior, mensaje explícito y ninguna pintura de éxito.
   await page.evaluate(()=>{__fail=true;__delay=0;});await badge.click();
   await menu.locator('[data-reserva-nuevo-estado="hospedada"]').click();
   assert.equal(await confirm.isVisible(),false);checks++;
   await page.waitForFunction(()=>document.querySelector('[data-reserva-estado]').textContent.includes('Fallo simulado'));
   assert.equal(await badge.innerText(),'Confirmada');checks++;
   assert.match(await page.locator('[data-reserva-estado]').innerText(),/No se pudo confirmar/);checks++;
   // Cambio concurrente o pérdida de permiso detienen la operación antes de escribir.
   await page.evaluate(()=>{__fail=false;});await badge.click();await menu.locator('[data-reserva-nuevo-estado="pendiente"]').click();
   await page.evaluate(()=>{__ficha.estadias[0].fecha_salida='2026-09-29';});
   await page.locator('[data-reserva-estado-confirmar]').click();
   await page.waitForFunction(()=>document.querySelector('[data-reserva-estado]').textContent.includes('cambi'));
   assert.equal(await page.evaluate(()=>__writes.length),2);checks++;
   await montar(page,'confirmada');await badge.click();await menu.locator('[data-reserva-nuevo-estado="pendiente"]').click();
   await page.evaluate(()=>{__permission=false;});await page.locator('[data-reserva-estado-confirmar]').click();
   await page.waitForFunction(()=>document.querySelector('[data-reserva-estado]').textContent.includes('permiso'));
   assert.equal(await page.evaluate(()=>__writes.length),0);assert.equal(await badge.innerText(),'Confirmada');checks++;
   // SQLSTATE manda: 40001 reconcilia incluso con HTTP 200; P0001 no lo hace
   // incluso con HTTP 409. El destino rechazado nunca aparece como guardado.
   for(const status of [200,409]){
    await montar(page);await badge.click();await menu.locator('[data-reserva-nuevo-estado="cancelada"]').click();
    await page.evaluate(status=>{__rpcError={code:'40001',message:'Snapshot obsoleto'};__httpStatus=status;__serverCambio='confirmada';},status);
    await page.locator('[data-reserva-estado-confirmar]').click();
    await page.waitForFunction(()=>document.querySelector('[data-reserva-estado]').textContent.includes('Se releyó'));
    assert.equal(await badge.innerText(),'Confirmada');assert.equal(await page.evaluate(()=>__writes.length),1);checks++;
    assert.ok(await page.evaluate(()=>__reads>__readsAtRpc));
    assert.equal(await page.locator('[data-reserva-estado]').getAttribute('data-error'),'true');checks++;
    assert.deepEqual((await page.evaluate(()=>__refresh)).sort(),['calendario','historial','listado','pagos','reservas','resumen']);checks++;
    assert.deepEqual(await page.evaluate(()=>__resumenEventos),['conflicto concurrente de estado de reserva']);checks++;
   }
   await montar(page);await badge.click();await menu.locator('[data-reserva-nuevo-estado="cancelada"]').click();
   await page.evaluate(()=>{__rpcError={code:'P0001',message:'Regla de negocio'};__httpStatus=409;__serverCambio='confirmada';});
   await page.locator('[data-reserva-estado-confirmar]').click();
   await page.waitForFunction(()=>document.querySelector('[data-reserva-estado]').textContent.includes('Regla de negocio'));
   assert.equal(await badge.innerText(),'Hospedado');assert.ok(await page.evaluate(()=>__reads===__readsAtRpc));
   assert.deepEqual(await page.evaluate(()=>__refresh),[]);checks++;
   await montar(page);await badge.click();await menu.locator('[data-reserva-nuevo-estado="cancelada"]').click();
   await page.evaluate(()=>{__rpcError={code:'40001',message:'Snapshot obsoleto'};__failReadAfterConflict=true;});
   await page.locator('[data-reserva-estado-confirmar]').click();
   await page.waitForFunction(()=>document.querySelector('[data-reserva-estado]').textContent.includes('No se pudo releer'));
   assert.equal(await badge.innerText(),'Hospedado');assert.equal(await page.evaluate(()=>__writes.length),1);checks++;
   // La opción queda habilitada en el mismo ingreso a las 00:00 de Chile.
   await montar(page,'confirmada');await page.evaluate(()=>{__ficha.estadias[0].fecha_ingreso='2026-09-27';__now='2026-09-27T03:00:00Z';});
   await page.evaluate(({R,E})=>window.HAIKU_RESUMEN_RESERVA_SITES_V1.abrirPorId(R,document.querySelector('#abrir'),{estadiaId:E,numeroCabana:2}),{R,E});
   await badge.click();assert.equal(await menu.locator('[data-reserva-nuevo-estado="no_show"]').isEnabled(),true);checks++;
   await page.evaluate(()=>{__now='2026-09-27T02:59:00Z';});await badge.click();await badge.click();
   assert.equal(await menu.locator('[data-reserva-nuevo-estado="no_show"]').isDisabled(),true);checks++;
   await montar(page,'confirmada',true);await badge.click();await menu.locator('[data-reserva-nuevo-estado="hospedada"]').click();
   assert.equal(await confirm.isVisible(),false);checks++;
   await page.waitForFunction(()=>__writes.length===1&&document.querySelector('[data-reserva-estado-confirmacion]').hidden);
   assert.equal(await page.evaluate(()=>__ficha.estadias.find(s=>s.cabana_numero===7).estado_estadia),'confirmada');checks++;
   await montar(page,'cancelada');await badge.click();assert.equal(await menu.locator('button').count(),6);
   assert.equal(await menu.locator('[data-reserva-nuevo-estado="pendiente"]').isEnabled(),true);
   assert.equal(await menu.locator('[data-reserva-nuevo-estado="confirmada"]').isDisabled(),true);checks++;
   // Los cuatro destinos conservan el aviso actual → nuevo y Cancelar no escribe.
   for(const destino of ['pendiente','confirmada','cancelada','no_show']){
    await montar(page,destino==='confirmada'?'pendiente':'confirmada');
    const anterior=await badge.innerText();
    await badge.click();await menu.locator(`[data-reserva-nuevo-estado="${destino}"]`).click();
    assert.equal(await confirm.isVisible(),true);assert.equal(await page.evaluate(()=>__writes.length),0);checks++;
    const nuevo=await page.evaluate(destino=>HAIKU_RESERVA_ESTADO_MANUAL_V1.etiqueta(destino),destino);
    assert.ok((await confirm.innerText()).includes(`${anterior} → ${nuevo}`));checks++;
    await page.locator('[data-reserva-estado-cancelar]').click();
    assert.equal(await badge.innerText(),anterior);assert.equal(await page.evaluate(()=>__writes.length),0);checks++;
   }
   for(const destino of ['hospedada','checked_out']){
    // Sin aviso ni pintura optimista; el doble clic queda bloqueado durante
    // revalidación y se usa la misma RPC segura con identidad y snapshot.
    await montar(page,'confirmada');await directoPausado(page,destino);
    assert.equal(await confirm.isVisible(),false);assert.equal(await menu.isVisible(),false);checks++;
    assert.equal(await badge.innerText(),'Confirmada');assert.equal(await page.evaluate(()=>__writes.length),0);checks++;
    assert.match(await page.locator('[data-reserva-estado]').innerText(),/Actualizando estado/);checks++;
    await continuarLectura(page);
    const nuevo=destino==='hospedada'?'Hospedado':'Check-out';
    await page.waitForFunction(nuevo=>document.querySelector('[data-reserva-estado-operativo]').textContent===nuevo,nuevo);
    assert.equal(await page.evaluate(()=>__writes.length),1);assert.equal(await page.evaluate(()=>__avisosDirectos),0);checks++;
    assert.equal(await page.evaluate(()=>__writes[0].name),'haiku_cambiar_estado_reserva_manual_v1');
    assert.equal(await page.evaluate(()=>__writes[0].payload.p_estadia_id),E);
    assert.equal(await page.evaluate(()=>__writes[0].payload.p_estado),destino);
    assert.equal(await page.evaluate(()=>__writes[0].payload.p_esperado.estadias[0].estado_estadia),'confirmada');checks++;
    assert.ok(await page.evaluate(()=>__reads>__readsAtRpc));
    assert.deepEqual((await page.evaluate(()=>__refresh)).sort(),['calendario','historial','listado','pagos','reservas','resumen']);checks++;
    // Un rechazo operativo del backend conserva el badge y no refresca como éxito.
    await montar(page,'confirmada');
    await page.evaluate(destino=>{__rpcError={code:'P0001',message:destino==='checked_out'?
     'Check-out bloqueado por fecha/hora':'Check-in bloqueado por regla operativa'};},destino);
    await badge.click();await menu.locator(`[data-reserva-nuevo-estado="${destino}"]`).click();
    await page.waitForFunction(()=>document.querySelector('[data-reserva-estado]').textContent.includes('bloqueado'));
    assert.equal(await badge.innerText(),'Confirmada');assert.equal(await confirm.isVisible(),false);checks++;
    assert.equal(await page.evaluate(()=>__writes.length),1);
    assert.deepEqual(await page.evaluate(()=>__refresh),[]);
    assert.equal(await page.locator('[data-reserva-estado]').getAttribute('data-error'),'true');checks++;
    // Permiso perdido o identidad obsoleta durante revalidación: cero RPC.
    for(const fallo of ['permiso','identidad']){
     await montar(page,'confirmada');await directoPausado(page,destino);
     await page.evaluate(fallo=>{
      if(fallo==='permiso')__permission=false;
      else __ficha.estadias[0].fecha_salida='2026-09-29';
     },fallo);
     await continuarLectura(page);
     await page.waitForFunction(()=>document.querySelector('[data-reserva-estado]').dataset.error==='true');
     assert.equal(await page.evaluate(()=>__writes.length),0);assert.equal(await badge.innerText(),'Confirmada');checks++;
     assert.equal(await confirm.isVisible(),false);assert.equal(await page.evaluate(()=>__avisosDirectos),0);checks++;
    }
    // El conflicto SQLSTATE también reconcilia en el camino directo, sin reintento.
    await montar(page,'confirmada');
    await page.evaluate(()=>{__rpcError={code:'40001',message:'Snapshot obsoleto'};__httpStatus=200;__serverCambio='pendiente';});
    await badge.click();await menu.locator(`[data-reserva-nuevo-estado="${destino}"]`).click();
    await page.waitForFunction(()=>document.querySelector('[data-reserva-estado]').textContent.includes('Se releyó'));
    assert.equal(await badge.innerText(),'Confirmación Pendiente');assert.equal(await confirm.isVisible(),false);checks++;
    assert.equal(await page.evaluate(()=>__writes.length),1);assert.ok(await page.evaluate(()=>__reads>__readsAtRpc));checks++;
    assert.equal(await page.locator('[data-reserva-estado]').getAttribute('data-error'),'true');
    assert.deepEqual(await page.evaluate(()=>__resumenEventos),['conflicto concurrente de estado de reserva']);checks++;
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log(`PASS: ${checks} comprobaciones browser Edge desktop/móvil, sin red. Capturas: ${os.tmpdir()}\\haiku-reserva-estado-*.png`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
