// Panel y renderizadores reales. Sólo datos sintéticos, sin acceso a producción.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {panelSinDatos,auditarContraste}=require('./haiku-tema-browser-check.cjs');
const {read,setup}=require('./fixtures/libro-servicio-manual.cjs');
const fixtures=require('./fixtures/haiku-tema-v1.cjs');
const root=path.resolve(__dirname,'..'),output=process.env.HAKU_COMPACTO_OUTPUT||'/tmp/haku-compacto';
const add=(p,n)=>p.addScriptTag({content:read('js/'+n+'.js')});
const pendientes=[];
function verificarInterior(el){
  return [el,...el.querySelectorAll('*')].filter(e=>{
    if(!e.getClientRects().length||e.closest('details:not([open])')&&!e.closest('summary'))return false;
    const s=getComputedStyle(e);return s.display!=='contents'&&s.overflowX!=='auto'&&s.overflowX!=='scroll'&&e.scrollWidth>e.clientWidth+2;
  }).map(e=>({el:e.id||e.className,width:e.clientWidth,scroll:e.scrollWidth}));
}
async function verificar(p,selector,nombre,width,tema){
  const el=p.locator(selector);await el.waitFor({state:'visible'});
  await el.screenshot({path:path.join(output,`${nombre}-${width}-${tema}.png`)});
  const r=await el.boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width+1,`${nombre}: dentro del viewport`);
  assert.deepEqual(await el.evaluate(verificarInterior),[],`${nombre}/${width}/${tema}: sin desbordes`);
  assert.deepEqual(await p.evaluate(auditarContraste,selector),[],`${nombre}/${width}/${tema}: contraste`);
  assert.equal(await el.evaluate(e=>getComputedStyle(e).backgroundColor),tema==='oscuro'?'rgb(27, 38, 33)':'rgb(251, 252, 251)');
  const icono=el.locator('.haiku-compacto-cerrar-icono').first();
  if(await icono.count())assert.deepEqual(await icono.evaluate(e=>{const r=e.getBoundingClientRect();return[r.width,r.height,getComputedStyle(e).maskImage.includes('/assets/icons/finanzas-compactas/cerrar.svg')]}),[16,16,true]);
}
async function saldo(p,width,tema){
  await p.evaluate(()=>{
    window.creditoPrueba={saldo_a_favor:40000,titular:'Andrea Muñoz',fuentes:[{disponible:40000,medio_pago:'transferencia',fecha_pago:'2026-10-22T12:00:00Z',glosa:'Reserva CAB 1'}],cargos_servicio:[{cargo_id:'cargo-prueba',cabana:1,hora:'20:45',concepto:'Tinaja · Tonel',saldo:30000,fecha_servicio:'2026-10-22'}]};
    window.escriturasCredito=[];window.haikuTienePermiso=()=>true;
    window.haikuSupabase={rpc:async(n,args)=>{if(n==='haiku_saldo_favor_unidad')return {data:structuredClone(creditoPrueba)};assertRpc(n);escriturasCredito.push(args);return {data:{monto_usado:args.p_monto}}}};
    window.assertRpc=n=>{if(n!=='haiku_usar_saldo_favor')throw Error('RPC inesperado '+n)};
  });
  await add(p,'supabase-saldo-favor-v2');await p.evaluate(()=>HAIKU_SALDO_FAVOR_V2.abrir('reserva-prueba'));
  const modal='.haiku-saldo-favor-modal';await verificar(p,modal,'saldo',width,tema);
  const posiciones=await p.evaluate(()=>['.haiku-saldo-favor-formulario','.haiku-saldo-favor-resultado'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y}}));
  assert.equal(posiciones[1].x>posiciones[0].x+20,width>620);
  assert.equal(await p.locator('#credito-monto').inputValue(),'30000');
  await p.locator('#credito-monto').fill('15000');
  assert.match(await p.locator('#credito-preview').innerText(),/15\.000[\s\S]*25\.000/);
  await p.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema==='claro'?'oscuro':'claro');
  assert.equal(await p.locator('#credito-monto').inputValue(),'15000');
  await p.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
  await p.locator('#credito-monto').fill('50000');await p.locator('#credito-aplicar').click();
  assert.match(await p.locator('#credito-estado').innerText(),/Revisa el monto/);assert.equal(await p.evaluate(()=>escriturasCredito.length),0);
  await p.locator('#credito-monto').fill('15000');await p.locator('#credito-aplicar').click();
  await p.waitForFunction(()=>document.getElementById('haiku-saldo-favor-overlay').hidden);
  assert.deepEqual(await p.evaluate(()=>escriturasCredito),[{p_reserva_id:'reserva-prueba',p_cargo_id:'cargo-prueba',p_monto:15000}]);
  await p.evaluate(()=>{creditoPrueba.cargos_servicio.push({...creditoPrueba.cargos_servicio[0],cargo_id:'otro',cabana:8,concepto:'Masaje de relajación con descripción larga',saldo:45000});creditoPrueba.fuentes[0].glosa='FOLIO-'+ '1234567890'.repeat(12)});
  await p.evaluate(()=>HAIKU_SALDO_FAVOR_V2.abrir('reserva-prueba'));await p.locator('#credito-cargo').selectOption('otro');
  assert.equal(await p.locator('#credito-monto').inputValue(),'40000');assert.match(await p.locator('#credito-contexto').innerText(),/CAB 8/);
  assert.deepEqual(await p.locator(modal).evaluate(verificarInterior),[]);
  await p.keyboard.press('Escape');assert.equal(await p.locator('#haiku-saldo-favor-overlay').isVisible(),false);
  for(const caso of ['sincredito','sinservicios']){
    await p.evaluate(c=>{creditoPrueba.saldo_a_favor=c==='sincredito'?0:40000;if(c==='sinservicios')creditoPrueba.cargos_servicio=[]},caso);
    await p.evaluate(()=>HAIKU_SALDO_FAVOR_V2.abrir('reserva-prueba'));assert.equal(await p.locator('#credito-aplicar').isDisabled(),true);
    assert.match(await p.locator('#credito-estado').innerText(),caso==='sincredito'?/no tiene saldo/:/No hay servicios/);await p.keyboard.press('Escape');
  }
}
async function financiero(p,width,tema){
  await p.evaluate(()=>{
    const m=document.getElementById('ficha-reserva-modal');m.hidden=false;m.removeAttribute('inert');m.dataset.reservaId='reserva-prueba';m.dataset.numeroCabana='1';
    document.getElementById('ficha-reserva-titular').textContent='Andrea Muñoz';
    window.haikuSupabase={rpc:async()=>({data:{es_grupo:false}}),from:table=>{
      const rows=table==='vista_estado_cargos'?[{cargo_id:'cargo-prueba',reserva_id:'reserva-prueba',tipo_cargo:'alojamiento',concepto:'Alojamiento',estado:'activo',monto_ajustado:320000,aplicado_neto:160000,saldo_cargo:160000}]:table==='pagos'?[{id:'pago-prueba',reserva_id:'reserva-prueba',monto:160000,tipo_movimiento:'pago',estado:'confirmado',medio_pago:'transferencia',fecha_pago:'2026-10-22',referencia_externa:'Reserva CAB 1'}]:[];
      const q={select(){return q},in(){return q},eq(){return q},order(){return q},then(resolve){return Promise.resolve({data:rows}).then(resolve)}};return q;
    }};
  });
  await add(p,'supabase-finanzas-resumen-v1');await add(p,'supabase-ficha-atajos');await p.locator('#ficha-pago-total').scrollIntoViewIfNeeded();
  await p.evaluate(()=>HAIKU_FICHA_ATAJOS_V2.abrirDetalle('ficha-pago-total'));
  const popup='#haiku-ficha-detalle-popup';await verificar(p,popup,'financiero',width,tema);
  assert.deepEqual(await p.locator(popup+' .haiku-ficha-detalle-ecuacion strong').allTextContents(),['$320.000','$160.000','$160.000']);
  if(width>620)assert.equal(Math.round((await p.locator(popup).boundingBox()).width),704);
  for(const tipo of ['abono','saldo','servicios']){
    await p.evaluate(id=>HAIKU_FICHA_ATAJOS_V2.abrirDetalle(id),'ficha-pago-'+tipo);
    assert.deepEqual(await p.locator(popup).evaluate(verificarInterior),[]);assert.deepEqual(await p.evaluate(auditarContraste,popup),[]);
  }
  await p.getByRole('button',{name:'Cerrar detalle financiero',exact:true}).click();assert.equal(await p.locator(popup).isVisible(),false);
}
async function financieroFichaSites(p, width, tema) {
  const reservaId = '182c1e83-ea8a-4dfa-8779-463854267d29';
  const otraReservaId = '82c10a25-40d4-405a-965f-0fe07722951f';
  await fixtures['haku-inicio'](p);
  if (width === 390) {
    await p.addStyleTag({ path: path.join(root, 'css/haku-mobile-assistant-v1.css') });
    await p.evaluate(() => {
      document.documentElement.dataset.hakuMobileAssistant = '1';
      document.documentElement.classList.add('haku-mobile-assistant-ready');
    });
  }
  await p.evaluate(({ reservaId, otraReservaId }) => {
    const cargos = [
      { cargo_id: 'c1', reserva_id: reservaId, tipo_cargo: 'alojamiento', estado: 'activo',
        monto_ajustado: 176000, aplicado_neto: 14400, saldo_cargo: 161600 },
      { cargo_id: 'c2', reserva_id: reservaId, tipo_cargo: 'servicio', servicio_id: 's1', estado: 'activo',
        monto_ajustado: 30000, aplicado_neto: 0, saldo_cargo: 30000 }
    ];
    const pagos = [{ id: 'p1', reserva_id: reservaId, monto: 158400, tipo_movimiento: 'pago',
      estado: 'confirmado', medio_pago: 'tarjeta_debito', fecha_pago: '2026-11-13', folio: '126' }];
    const servicios = [{ id: 's1', reserva_id: reservaId, fecha_servicio: '2026-11-13',
      hora_inicio: '22:15:00', catalogo_servicios: { nombre: 'Tinaja Jacuzzi' } }];
    const datos = { vista_estado_cargos: cargos, pagos, servicios,
      pago_aplicaciones: [{ pago_id: 'p1', cargo_id: 'c1', monto_aplicado: 14400 }] };
    window.detalleConsultas = [];
    window.haikuSupabase = {
      async rpc(nombre, { p_reserva_id }) {
        if (nombre !== 'haiku_finanzas_grupo' || p_reserva_id !== reservaId) {
          throw Error('RPC inesperado ' + nombre + '/' + p_reserva_id);
        }
        window.detalleConsultas.push(p_reserva_id);
        if (window.detenerDetalle) await new Promise(resolve => { window.continuarDetalle = resolve; });
        return { data: { es_grupo: false } };
      },
      from(tabla) {
        if (!Object.hasOwn(datos, tabla)) throw Error('Tabla inesperada ' + tabla);
        const q = { select() { return q; }, in() { return q; }, eq() { return q; }, order() { return q; },
          then(resolve) { return Promise.resolve({ data: datos[tabla] }).then(resolve); } };
        return q;
      }
    };
    window.haikuLeerFichaSupabaseV2 = async id => {
      const principal = id === reservaId;
      if (!principal && id !== otraReservaId) throw Error('Reserva inesperada ' + id);
      return {
        reserva: { id, titular_nombre: principal ? 'Andrea Muñoz' : 'Martín Rojas',
          estado_reserva: 'confirmada', observaciones: '' },
        estadias: [{ id: '08484ba1-05c0-4caf-9160-75af42217761', cabana_numero: principal ? 2 : 5,
          fecha_ingreso: '2026-11-13', fecha_salida: '2026-11-14' }],
        cargos: principal ? cargos : [], pagos: principal ? pagos : [], servicios: principal ? servicios : []
      };
    };
  }, { reservaId, otraReservaId });
  for (const script of ['supabase-finanzas-resumen-v1', 'sites-resumen-drawer-v1',
    'sites-resumen-reserva-v1', 'supabase-ficha-atajos']) await add(p, script);
  assert.equal(await p.evaluate(id => HAIKU_PANELES_V1.abrirReserva(id), reservaId), true);
  const drawer = p.locator('#sites-resumen-reserva-drawer');
  const popup = p.locator('#haiku-ficha-detalle-popup');
  const cerrar = popup.getByRole('button', { name: 'Cerrar detalle financiero' });
  const boton = tipo => drawer.locator(`[data-haiku-ficha-detalle="${tipo}"]`);
  const movil = width <= 620;
  for (const [tipo, detalle] of Object.entries({
    total: /Cargos · CAB 2/, abono: /Folio 126/, saldo: /Saldo por cabaña/, servicios: /Tinaja Jacuzzi/
  })) {
    const control = boton(tipo);
    if (movil) await control.tap();
    else await control.hover();
    await popup.locator('.haiku-ficha-detalle-seccion').getByText(detalle).waitFor();
    assert.equal(await control.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await popup.locator('.haiku-ficha-detalle-ecuacion strong').allTextContents(),
      ['$206.000', '$158.400', '$191.600']);
    if (tipo === 'servicios') {
      await verificar(p, '#haiku-ficha-detalle-popup', 'financiero-ficha-sites', width, tema);
      assert.match(await popup.innerText(), /\$30\.000/);
    }
    if (movil) {
      if (tipo === 'total') await control.tap();
      else await cerrar.tap();
    } else {
      await cerrar.hover();
      // El detalle sigue abierto mientras se usa su interior.
      await p.mouse.move(2, 2);
    }
    await popup.waitFor({ state: 'hidden' });
    assert.equal(await control.getAttribute('aria-expanded'), 'false');
  }

  await boton('abono').focus();
  await p.keyboard.press('Enter');
  await popup.waitFor();
  assert.equal(await cerrar.evaluate(el => el === document.activeElement), true);
  await p.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  assert.equal(await boton('abono').evaluate(el => el === document.activeElement), true);
  assert.equal(await drawer.isVisible(), true);
  await p.keyboard.press('Enter');
  await popup.waitFor();
  await p.keyboard.press('Tab');
  await popup.waitFor({ state: 'hidden' });
  assert.equal(await boton('saldo').evaluate(el => el === document.activeElement), true);

  const consultasPrevias = await p.evaluate(() => {
    window.detenerDetalle = true;
    return window.detalleConsultas.length;
  });
  await boton('saldo').press('Space');
  await p.waitForFunction(anteriores => typeof window.continuarDetalle === 'function' &&
    window.detalleConsultas.length === anteriores + 1, consultasPrevias);
  assert.equal(await p.evaluate(id => HAIKU_PANELES_V1.abrirReserva(id), otraReservaId), true);
  await p.evaluate(() => window.continuarDetalle());
  await popup.waitFor({ state: 'hidden' });
  assert.equal(await drawer.locator('#sites-resumen-reserva-titulo').innerText(), 'Martín Rojas');
  assert.equal(await boton('saldo').getAttribute('aria-expanded'), 'false');
}
async function recibo(p,width,tema){
  await fixtures['haku-inicio'](p);for(const n of ['haiku-libro-semantica-v1','haiku-servicios-identidad-v1'])await add(p,n);
  await p.evaluate(setup);await add(p,'haiku-libro-servicios-scope-v2');await add(p,'haiku-libro-confirm-cancel-fix-v1');
  await p.evaluate(()=>{
    const out=document.createElement('div');out.id='recibo-prueba';document.querySelector('.haiku-asistente-mensajes').replaceChildren(out);
    window.mostrarRecibo=(modo='servicio')=>{
      const servicio={item_id:'s1',kind:'servicio',estado:'listo',reserva:{titular:'Andrea Muñoz',cabana:1},mapa:{nombre:'Tinaja · Tonel'},hora_fin:'21:45',servicio:{texto_original:'TIN TONEL 20:45 A 21:45'},payload:{item_id:'s1',reserva_id:'reserva-prueba',estadia_id:'estadia-prueba',fecha_servicio:'2026-10-22',hora:'20:45',cantidad:1,tipo_cobro:'cortesia'}};
      const nota={item_id:'n1',kind:'nota',estado:'listo',reserva:{titular:'Andrea Muñoz',cabana:1},texto:'Cuna junto a la cama.\nPreparar antes de la llegada.',payload:{item_id:'n1',reserva_id:'reserva-prueba',texto:'Cuna junto a la cama.\nPreparar antes de la llegada.'}};
      const elegidos=modo==='nota'?[nota]:modo==='servicio'?[servicio]:[servicio,nota];
      const data={ok:true,servicios_creados:modo==='nota'?0:1,notas_creadas:modo==='servicio'?0:1,servicios_omitidos:0,notas_omitidas:0,servicios:modo==='nota'?[]:[{item_id:'s1',estado:'creado'}],notas:modo==='servicio'?[]:[{item_id:modo==='aviso'?'desconocido':'n1',estado:'creada'}]};
      HAIKU_LIBRO_SERVICIOS_SCOPE_V2.renderizarResultadoServicios(out,data,{items:elegidos},elegidos,'Libro: consulta sintética');
      HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4.completarRecibo(out,data,elegidos);
    };mostrarRecibo();
  });
  const recibo='#recibo-prueba';await verificar(p,recibo,'haku',width,tema);
  assert.equal(await p.locator(recibo+' [data-tipo="nota"]').isVisible(),false);
  const previo=p.getByRole('button',{name:'Ver revisión anterior',exact:true});await previo.click();
  assert.equal(await previo.getAttribute('aria-expanded'),'true');assert.equal(await p.locator(recibo+' input').count(),0);await previo.click();
  assert.equal(await previo.getAttribute('aria-expanded'),'false');
  for(const modo of ['nota','ambos','aviso']){
    await p.evaluate(m=>mostrarRecibo(m),modo);
    assert.deepEqual(await p.locator(recibo).evaluate(verificarInterior),[]);assert.deepEqual(await p.evaluate(auditarContraste,recibo),[]);
    if(modo==='aviso')assert.equal(await p.locator(recibo+' .haku-libro-resultado-sites__grupo-aviso').isVisible(),true);
    else assert.equal(await p.locator(recibo+' [data-tipo="nota"] .haku-libro-resultado-sites__texto-incorporado').textContent(),'Cuna junto a la cama.\nPreparar antes de la llegada.');
  }
  assert.equal(await p.evaluate(()=>fixtureServicios.escrituras.length),0);
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});const html=await panelSinDatos();
  assert.equal((html.match(/href="css\/haiku-tema-finanzas-compactas-v1.css/g)||[]).length,1);
  const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost').pathname;if(u==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(html);const f=path.resolve(root,'.'+u);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();try{res.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'application/javascript':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream'}).end(fs.readFileSync(f))}catch{res.writeHead(404).end()}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});const resultados=[];
  try{for(const width of [1600,390,320])for(const tema of ['claro','oscuro'])for(const [nombre,escena] of Object.entries({saldo,financiero,financieroFichaSites,recibo})){
    const p=await browser.newPage({viewport:{width,height:1000},hasTouch:width<=620,isMobile:width<=620,timezoneId:'America/Santiago'});p.setDefaultTimeout(8000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
    try{await p.goto(url);await p.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});await p.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);await escena(p,width,tema);assert.deepEqual(errors,[]);resultados.push({nombre,width,tema,ok:true});console.log('OK',nombre,width,tema)}
    catch(e){resultados.push({nombre,width,tema,error:e.message});pendientes.push(e);console.error(nombre,width,tema,e);await p.screenshot({path:path.join(output,`error-${nombre}-${width}-${tema}.png`)})}
    finally{fs.writeFileSync(path.join(output,'resultados.json'),JSON.stringify(resultados,null,2));await p.close()}
  }}finally{await browser.close();await new Promise(r=>server.close(r))}
  assert.equal(pendientes.length,0,'Todas las vistas y acciones verificadas');
})().catch(e=>{console.error(e);process.exitCode=1});
