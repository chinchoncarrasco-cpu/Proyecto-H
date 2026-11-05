const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const { createFixtureClient, contextFixtureData } = require('./fixtures/cabin-context/client.cjs');
const root = path.resolve(__dirname, '..');
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/sites-cabanas-v1.css"><style>body{margin:0;background:#f4f7f5}html[data-haiku-tema=oscuro] body{background:#0f1915}#seccion-cabanas{display:block;padding:16px;box-sizing:border-box;background:var(--cb-canvas);color:var(--cb-text)}header{background:var(--cb-surface);padding:12px;border:1px solid var(--cb-border);border-radius:8px;margin-bottom:12px}p{margin:0}h2{font-size:16px}</style></head><body><section id="seccion-cabanas"><header><h2>Revisión · CAB 3 · Ingreso</h2><p id="day-people" class="cb-occupancy-summary"></p><div id="day-context" class="cb-cabin-context"></div></header><header><h2>Check out · CAB 3 · Salida</h2><p id="stay-people" class="cb-occupancy-summary"></p><div id="stay-context" class="cb-cabin-context"></div></header></section><script src="/js/cabin-context-v1.js"></script><script src="/js/cabin-context-ui-v1.js"></script></body></html>';
(async () => {
 const browser = await chromium.launch({ headless: true });
 try { for (const width of [1440, 390]) for (const theme of ['claro', 'oscuro']) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://haku-context.test/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    const file = path.join(root, url.pathname);
    if (url.pathname.includes('..') || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : 'text/css', body: fs.readFileSync(file) });
  });
  await page.addInitScript({ content: 'window.__makeClient=' + createFixtureClient.toString() + ';window.__makeData=' + contextFixtureData.toString() + ';' });
  await page.goto('https://haku-context.test/');
  await page.evaluate(theme => {
    document.documentElement.dataset.haikuTema = theme;
    window.__owner = 'staff'; window.__client = window.__makeClient(window.__makeData());
    const common = { client: window.__client, user: () => window.__owner, date: () => '2026-11-05' };
    window.__dayOptions = { ...common, occupancy: document.querySelector('#day-people'), fallbackHTML: '<div class="cb-note-summary"><span class="cb-note-summary-item">Nota del día</span></div>', target: { scope: 'day', day: '2026-11-05', cabinId: 'cab-3', cabinNumber: 3, reservationId: 'incoming' } };
    window.__stayOptions = { ...common, occupancy: document.querySelector('#stay-people'), fallback: { notes: ['Nota de salida'] }, target: { scope: 'stay', day: '2026-11-05', cabinId: 'cab-3', cabinNumber: 3, stayId: 'stay-3', reservationId: 'reservation-3' } };
    window.HAIKU_CABIN_CONTEXT_UI_V1.render(document.querySelector('#day-context'), window.__dayOptions);
    window.HAIKU_CABIN_CONTEXT_UI_V1.render(document.querySelector('#stay-context'), window.__stayOptions);
  }, theme);
  await page.locator('#stay-people').filter({ hasText: '3 personas · 2 adultos · 1 niño · 1 mascota' }).waitFor();
  await page.locator('#day-people').filter({ hasText: '4 personas · 4 adultos · 0 niños · Sin mascotas' }).waitFor();
  assert.match(await page.locator('#day-context').textContent(), /Tinaja entrante · 19:00 · Programado/);
  assert.doesNotMatch(await page.locator('#day-context').textContent(), /03\/11|Nota del ingreso/);
  assert.match(await page.locator('#stay-context').textContent(), /Tinaja · 03\/11 · 18:00 · Realizado/);
  assert.match(await page.locator('#stay-context').textContent(), /Recambio de Toallas: Cambiar toallas · 03\/11 · Completada/);
  assert.doesNotMatch(await page.locator('#stay-context').textContent(), /entrante|Otra cabaña|otra cabaña/);
  const color = await page.locator('#stay-context .cb-service-summary-item').first().evaluate(el => getComputedStyle(el).color);
  assert.equal(color, theme === 'oscuro' ? 'rgb(212, 180, 242)' : 'rgb(113, 52, 163)');
  const reads = await page.evaluate(() => window.__client.reads.length);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.HAIKU_CABIN_CONTEXT_UI_V1.render(document.querySelector('#stay-context'), window.__stayOptions); });
  assert.equal(await page.evaluate(() => window.__client.reads.length), reads);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.HAKU_UI_SHOTS) { fs.mkdirSync(process.env.HAKU_UI_SHOTS, { recursive: true }); await page.screenshot({ fullPage: true, path: path.join(process.env.HAKU_UI_SHOTS, `context-web-${width}-${theme}.png`) }); }
  await page.evaluate(() => {
    const host = document.querySelector('#stay-context'), options = window.__stayOptions;
    window.HAIKU_CABIN_CONTEXT_UI_V1.render(host, { ...options, target: { ...options.target, cabinId: 'cab-5', cabinNumber: 5, stayId: 'stay-5', reservationId: 'reservation-5' }, fallback: {} });
  });
  await page.locator('#stay-people').filter({ hasText: '2 personas · 2 adultos · 0 niños · Sin mascotas' }).waitFor();
  assert.equal(await page.locator('#stay-context .cb-service-summary-item').count(), 0);
  assert.doesNotMatch(await page.locator('#stay-context').textContent(), /Tinaja|Nota del ingreso/);
  await page.evaluate(() => { window.__client.callbacks.filter(callback => callback.filter === 'reserva_id=eq.reservation-3').forEach(callback => callback.fn({ new: { reserva_id: 'reservation-3' } })); });
  assert.match(await page.locator('#stay-people').textContent(), /2 personas · 2 adultos · 0 niños · Sin mascotas/);
  await page.evaluate(() => { window.__owner = ''; window.HAIKU_CABIN_CONTEXT_UI_V1.render(document.querySelector('#stay-context'), { ...window.__stayOptions, fallbackHTML: 'No debe mostrarse' }); });
  assert.equal(await page.locator('#stay-context').textContent(), '');
  assert.deepEqual(errors, []); await page.close();
 } } finally { await browser.close(); }
 console.log('Contexto Web: personas, servicios morados, día/estadía, cambio de huésped, logout y caché OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
