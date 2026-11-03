// Interacción real del listado y ficha Web, con persistencia simulada; sin datos productivos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const scripts = new Set(['js/historial.js', 'js/calendario.js', 'js/checklist.js', 'js/app.js', 'js/cabanas.js', 'js/sites-cabanas-v1.js']);
(async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  for (const width of [1440, 390, 320]) for (const theme of ['claro', 'oscuro']) {
   const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: 'America/Santiago' });
   const errors = [];
   page.on('pageerror', error => errors.push(error.message));
   page.on('dialog', dialog => dialog.dismiss());
   await page.addInitScript(() => {
    window.haikuSesion = { auth: { id: 'test-repaso' } };
    window.haikuSupabase = { rpc: async () => ({ data: [], error: null }) };
    window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: 'visible', armado: true }) };
   });
   await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient:()=>({})}' });
    if (u.hostname !== 'haku-repaso.test') return route.abort();
    const name = decodeURIComponent(u.pathname.slice(1));
    if (name.includes('..')) return route.abort();
    const file = path.join(root, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    if (name.endsWith('.js') && !scripts.has(name)) return route.fulfill({ contentType: 'application/javascript', body: '' });
    return route.fulfill({ contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : 'application/octet-stream', body: fs.readFileSync(file) });
   });
   await page.goto('http://haku-repaso.test/panel.html');
   await page.waitForFunction(() => Boolean(window.HAIKU_CABANAS_SITES_V1));
   await page.evaluate(theme => {
    document.documentElement.setAttribute('data-haiku-tema', theme);
    fechaSeleccionada = '2026-11-03';
    const data = obtenerDatosDia(fechaSeleccionada);
    data.cabanas['1'] = { aseoEstado: 'no_requiere', detallesRevision: 'Observación existente', checklist: {}, revisionCompletaCiclo: {
     fecha: fechaSeleccionada, verificado: true, id: 'rev-1', estado: 'pendiente', esRepaso: false,
    } };
    window.__repasoWrites = [];
    window.HAIKU_REVISION_SUPABASE_V1 = { async guardarTipoRevision(number, type, day) {
     if (window.__repasoFail) throw new Error('Sin conexión');
     window.__repasoWrites.push({ number, type, day });
     const cabin = obtenerDatosDia(day).cabanas[number];
     cabin.revisionCompletaCiclo.esRepaso = type === 'repaso'; guardarDatos();
    } };
    guardarDatos(); window.HAIKU_CABANAS_SITES_V1.pintar(fechaSeleccionada);
   }, theme);
   await page.locator('.menu-item[data-seccion="cabanas"]').click();
   const row = page.locator('#cabinsOperation [data-cb-cabin="1"]');
   const repaso = row.locator('[data-cb-repaso="1"]');
   await repaso.click();
   await page.waitForFunction(() => document.querySelector('#cabinsOperation [data-cb-repaso="1"]')?.getAttribute('aria-pressed') === 'true');
   assert.deepEqual(await page.evaluate(() => window.__repasoWrites[0]), { number: '1', type: 'repaso', day: '2026-11-03' });
   assert.equal((await row.locator('.cb-final-status').textContent()).includes('Pendiente'), true);
   const repasoRect = await repaso.boundingBox(), noCleaningRect = await row.locator('[data-cb-no-requiere]').boundingBox();
   assert.ok(repasoRect.y > (await row.locator('[data-cb-revision-select]').boundingBox()).y);
   if (width > 780) assert.ok(Math.abs(repasoRect.y - noCleaningRect.y) < 5, 'acciones alineadas');
   await row.locator('[data-cb-open="1"]').click();
   assert.equal(await page.locator('#cabinsReviewMode').inputValue(), 'repaso');
   assert.equal(await page.locator('#cabinsStandardReviewLabel').textContent(), 'Repaso');
   assert.equal(await page.locator('#revision-individual').isVisible(), true);
   const before = await page.locator('#revision-detalles').inputValue();
   const checklist = await page.locator('#revision-checklist [data-checklist-id]').count();
   assert.ok(checklist > 0, 'mantiene el checklist habitual');
   await page.locator('#cabinsReviewMode').selectOption('completa');
   await page.waitForFunction(() => document.querySelector('#cabinsStandardReviewLabel')?.textContent === 'Revisión completa');
   assert.equal(await page.locator('#revision-detalles').inputValue(), before);
   assert.equal(await page.locator('#revision-checklist [data-checklist-id]').count(), checklist);
   await page.locator('#volver-cabanas').click();
   await page.evaluate(() => { window.__repasoFail = true; });
   await repaso.click();
   await page.waitForFunction(() => !document.querySelector('#cabinsOperation [data-cb-repaso="1"]').disabled);
   assert.equal(await repaso.getAttribute('aria-pressed'), 'false', 'un fallo no deja activada la modalidad');
   await page.evaluate(() => {
    window.__repasoFail = false;
    fechaSeleccionada = '2026-11-04';
    obtenerDatosDia(fechaSeleccionada).cabanas['1'] = {};
    window.HAIKU_CABANAS_SITES_V1.pintar(fechaSeleccionada);
   });
   assert.equal(await repaso.getAttribute('aria-pressed'), 'false', 'Repaso pertenece a la fecha elegida');
   assert.deepEqual(errors, []);
   if (process.env.HAKU_UI_SHOTS) {
    fs.mkdirSync(process.env.HAKU_UI_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.HAKU_UI_SHOTS, `repaso-web-${width}-${theme}.png`) });
   }
   console.log(`PASS Web Repaso ${width} ${theme}: activar, ficha, completa, error y fecha.`);
   await page.close();
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
