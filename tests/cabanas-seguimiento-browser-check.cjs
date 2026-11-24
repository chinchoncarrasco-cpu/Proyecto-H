// Panel real y datos ficticios: no usa credenciales ni escribe en producción.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const scripts = new Set(['js/historial.js', 'js/calendario.js', 'js/checklist.js', 'js/app.js', 'js/cabanas.js', 'js/sites-cabanas-v1.js', 'js/checkout-core-v1.js', 'js/checkout-workflow-v2.js', 'js/checkout-ui-v2.js', 'js/cabanas-espacios-v1.js']);
(async () => {
 const browser = await chromium.launch({ headless: true, executablePath: process.env.HAIKU_BROWSER_PATH || undefined });
 try {
  for (const width of [1440, 390]) for (const theme of ['claro', 'oscuro']) {
   const page = await browser.newPage({ viewport: { width, height: 1100 }, timezoneId: 'America/Santiago' });
   const errors = [];
   await page.addInitScript(() => { window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: 'visible', armado: true }) }; });
   page.on('pageerror', e => errors.push(e.message));
   await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient:()=>({})}' });
    if (url.hostname !== 'haku-cabanas.test') return route.abort();
    const name = decodeURIComponent(url.pathname.slice(1));
    if (name.includes('..')) return route.abort();
    const file = path.join(root, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    if (name.endsWith('.js') && !scripts.has(name)) return route.fulfill({ contentType: 'application/javascript', body: '' });
    return route.fulfill({ contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream', body: fs.readFileSync(file) });
   });
   await page.goto('http://haku-cabanas.test/panel.html');
   await page.waitForFunction(() => window.HAIKU_CABANAS_SITES_V1);
   await page.evaluate(theme => {
    Date.now = () => Date.parse('2026-10-31T18:03:00Z');
    fechaSeleccionada = '2026-10-31';
    document.documentElement.setAttribute('data-haiku-tema', theme);
    document.documentElement.classList.remove('haiku-cabanas-pendiente', 'haiku-privacidad-arranque', 'haiku-resumen-pendiente', 'haiku-pagos-pendiente');
    const day = obtenerDatosDia(fechaSeleccionada);
    for (let n = 1; n <= 11; n++) day.cabanas[n] = {
     aseo: n === 7 ? 'René' : 'Scarla', aseoIn: n === 3 ? '14:27' : n === 7 ? '14:40' : '11:50',
     aseoOut: n === 3 || n === 7 ? '' : '12:01',
     estadoRevision: [3, 5, 7].includes(n) ? 'pendiente' : 'lista',
     revisionCompletaCiclo: { fecha: fechaSeleccionada, verificado: true,
      estado: [3, 5, 7].includes(n) ? 'pendiente' : 'completada', resultado: [3, 5, 7].includes(n) ? null : 'lista' }
    };
    const counts = { aseo_full: 0, aseo_express: 0, venta_huesped: 0, sin_especificar: 0 };
    window.HAIKU_INSUMOS_ASEO_V1 = {
     hidratar: () => Promise.resolve(),
     total: () => ({ listo: true, lena: 1, lenaKg: 8, carbon: 1, destinos: { lena: { ...counts, aseo_full: 1 }, carbon: { ...counts, aseo_full: 1 } } }),
     obtener: (_, n) => ({ listo: true,
      lena: { cantidad: n === 3 ? 1 : 0, pesoKg: n === 3 ? 8 : 0, confirmada: n === 3 ? 1 : 0, destinos: { ...counts, aseo_full: n === 3 ? 1 : 0 }, sacos: n === 3 ? [{ destino: 'aseo_full', peso_kg: 8 }] : [] },
      carbon: { cantidad: n === 7 ? 1 : 0, confirmada: n === 7 ? 1 : 0, destinos: { ...counts, aseo_full: n === 7 ? 1 : 0 } } })
    };
    window.HAIKU_CABANAS_SITES_V1.pintar();
   }, theme);
   await page.locator('.menu-item[data-seccion="cabanas"]').click();
   const surface=theme==='claro'?'rgb(255, 253, 251)':'rgb(35, 31, 37)';
   const accent=theme==='claro'?'rgb(120, 38, 63)':'rgb(240, 173, 191)';
   const background=locator=>locator.evaluate(n=>getComputedStyle(n).backgroundColor);
   assert.deepEqual(await page.locator('#cabinsSummary .cb-summary-count').allTextContents(), ['2','1','8']);
   assert.deepEqual(await page.locator('#cabinsSummary .cb-cabin-number').allTextContents(), ['3','7','5','1','2','4','6','8','9','10','11']);
   const summary = await page.locator('#cabinsSummary').boundingBox();
   assert.ok(summary.height <= (width > 1100 ? 44 : 154), 'resumen compacto: ' + summary.height);
   await page.locator('[data-cb-filter="en_curso"]').click();
   assert.equal(await page.locator('.cb-tracking-row').count(), 2);
   assert.equal(await page.locator('.cb-tracking-row [data-supply-open]').count(), 0);
   assert.deepEqual(await page.locator('[data-cb-elapsed]').allTextContents(), ['36 min','23 min']);
   await page.locator('[data-cab-tab="supplies"]').click();
   assert.equal(await background(page.locator('#cabinsSuppliesSummary')),surface);
   assert.equal(await background(page.locator('.cb-supply-cabin').first()),surface);
   assert.equal(await page.locator('.cb-supply-cabin .cb-outline').first().evaluate(n=>getComputedStyle(n).color),accent);
   const details = page.locator('[data-insumos-destinos]');
   await details.locator('summary').click();
   assert.equal(await details.getAttribute('open'), '');
   const rows = await page.locator('.cb-supply-destination').allTextContents();
   assert.ok(rows.some(s => s.includes('Cabaña 3 · Aseo Full') && s.includes('1 saco · 8 kg')));
   assert.ok(rows.some(s => s.includes('Cabaña 7 · Aseo Full') && s.includes('Carbón · 1 saco')));
   if (process.env.HAKU_UI_SHOTS) {
    fs.mkdirSync(process.env.HAKU_UI_SHOTS, { recursive: true });
    await page.locator('#seccion-cabanas').screenshot({ path: path.join(process.env.HAKU_UI_SHOTS, 'web-' + width + '-' + theme + '.png') });
   }
   await page.locator('[data-cab-tab="operation"]').click();
   await page.locator('#cabinsFilters [data-cb-filter="todas"]').click();
   const duration=page.locator('[data-cb-duration="3"]');
   assert.equal(await duration.textContent(),'En curso: 36 min');
   assert.equal(await duration.evaluate(n=>getComputedStyle(n).color),theme==='oscuro'?'rgb(166, 204, 238)':'rgb(53, 106, 134)','contador activo azul');
   assert.equal(await page.locator('[data-cb-duration="1"]').textContent(),'Tiempo total: 11 min');
   const out=page.locator('[data-cb-cabin="3"] [data-aseo-hora="aseoOut"]');
   await out.focus();
   await page.evaluate(()=>{
    window.__outNode=document.querySelector('[data-cb-cabin="3"] [data-aseo-hora="aseoOut"]');
    const c=obtenerDatosDia(fechaSeleccionada).cabanas[3];c.aseoOut='15:00';c.estadoRevision='lista';c.revisionCompletaCiclo.estado='completada';c.revisionCompletaCiclo.resultado='lista';
    window.HAIKU_CABANAS_SITES_V1.pintar();
   });
   assert.equal(await page.evaluate(()=>window.__outNode===document.querySelector('[data-cb-cabin="3"] [data-aseo-hora="aseoOut"]')),true,'mostrar el total no reconstruye el input enfocado');
   assert.equal(await duration.textContent(),'Tiempo total: 33 min','OUT congela el tiempo inmediatamente');
   assert.equal(await duration.evaluate(n=>getComputedStyle(n).color),theme==='oscuro'?'rgb(159, 210, 179)':'rgb(36, 98, 71)','total terminado verde');
   await page.locator('#cabinsFilters [data-cb-filter="listas"]').click();
   assert.equal(await duration.textContent(),'Tiempo total: 33 min');
   await page.evaluate(()=>{Date.now=()=>Date.parse('2026-10-31T21:03:00Z');document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await duration.textContent(),'Tiempo total: 33 min','el reloj no sigue sumando después de OUT');
   await page.evaluate(()=>{obtenerDatosDia(fechaSeleccionada).cabanas[3].aseoOut='15:12';window.HAIKU_CABANAS_SITES_V1.pintar();});
   assert.equal(await duration.textContent(),'Tiempo total: 45 min','corregir OUT recalcula');
   await page.locator('#cabinsFilters [data-cb-filter="todas"]').click();
   assert.equal(await duration.textContent(),'Tiempo total: 45 min');
   assert.equal(await page.locator('[data-cb-duration="7"]').textContent(),'En curso: 3 h 23 min');
   await page.evaluate(()=>{const c=obtenerDatosDia(fechaSeleccionada).cabanas[11];c.aseoIn='';c.aseoOut='';c.aseoEstado='no_requiere';window.HAIKU_CABANAS_SITES_V1.pintar();});
   assert.equal(await page.locator('[data-cb-duration="11"]').isVisible(),false,'No requiere sin horas no inventa duración');
   if(process.env.HAKU_UI_SHOTS) await page.locator('[data-cb-cabin="3"]').screenshot({path:path.join(process.env.HAKU_UI_SHOTS,`total-${width}-${theme}.png`)});
   assert.equal(await page.locator('[data-cab-tab="review"]').count(), 0);
   await page.locator('[data-cab-tab="supplies"]').click();
   assert.equal(await page.locator('#cabinsSuppliesCabins article').count(), 11);
   await page.evaluate(()=>{
    window.haikuSesion={auth:{id:'usuario-sintetico'}};
    window.haikuSupabase={async rpc(name,{p_fecha}) {
     if(name==='haiku_operacion_dia') return {data:[{fecha:p_fecha,numero:3,cabana_id:'cab-3',salida_estadia_id:'salida-prueba',salida_titular:'Titular de prueba'}]};
     if(name==='haiku_revisiones_checkout_dia_v2') return {data:{fecha:p_fecha,puede_editar:false,revisiones:[{
      fecha_operativa:p_fecha,cabana_id:'cab-3',estadia_id:'salida-prueba',revision:1,
      hora_out:null,hora_out_definida:false,encargado:'',recuperados:[],revision_estado:'pendiente',chequeados:['llaves']
     }]}};
     throw new Error('RPC inesperada: '+name);
    }};
   });
   await page.locator('[data-cab-tab="checkout"]').click();
   const checkout=page.locator('#cabinsCheckout .co-list-row');
   await checkout.waitFor();
   const review=checkout.locator('button.co-primary');
   await review.waitFor();
   assert.equal(await background(checkout),surface);
   assert.equal(await background(review),theme==='claro'?'rgb(120, 38, 63)':'rgb(145, 59, 87)');
   if(width<=720) {
    assert.equal(await page.locator('#cabinsCheckoutList').evaluate(n=>getComputedStyle(n).borderTopWidth),'0px');
    assert.equal(await checkout.evaluate(n=>getComputedStyle(n).borderBottomColor),theme==='claro'?'rgb(231, 222, 218)':'rgb(58, 50, 60)');
   }
   if(process.env.HAKU_UI_SHOTS) await page.locator('#seccion-cabanas').screenshot({path:path.join(process.env.HAKU_UI_SHOTS,`checkout-${width}-${theme}.png`)});
   const overflow = await page.locator('#seccion-cabanas').evaluate(n => n.scrollWidth - n.clientWidth);
   assert.ok(overflow <= 1, 'sin desborde horizontal: ' + overflow);
   assert.deepEqual(errors, []);
   await page.close();
   console.log('Web ' + width + 'px ' + theme + ': resumen, seguimiento, insumos y Check out OK.');
  }
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
