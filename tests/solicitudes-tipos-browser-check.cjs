// Interfaz real, backend ficticio: no usa credenciales ni escribe en producción.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const scripts = new Set(['js/historial.js', 'js/calendario.js', 'js/checklist.js', 'js/app.js',
  'js/cabanas.js', 'js/sites-cabanas-v1.js', 'js/supabase-aseo-operacion-v1.js']);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.HAIKU_BROWSER_PATH || undefined });
  try {
    for (const width of [1440, 390]) for (const theme of ['claro', 'oscuro']) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: 'America/Santiago' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.addInitScript(() => {
        window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: 'visible', armado: true }) };
        window.HAIKU_REVISION_SUPABASE_V1 = {};
      });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient:()=>({})}' });
        if (url.hostname !== 'haku-solicitudes.test') return route.abort();
        const name = decodeURIComponent(url.pathname.slice(1));
        if (name.includes('..')) return route.abort();
        const file = path.join(root, name);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
        if (name.endsWith('.js') && !scripts.has(name)) return route.fulfill({ contentType: 'application/javascript', body: '' });
        return route.fulfill({ contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
      });
      await page.goto('http://haku-solicitudes.test/panel.html');
      await page.waitForFunction(() => document.readyState === 'complete' && window.HAIKU_CABANAS_SITES_V1);
      await page.evaluate(async theme => {
        fechaSeleccionada = '2026-11-02';
        document.documentElement.setAttribute('data-haiku-tema', theme);
        document.documentElement.classList.remove('haiku-cabanas-pendiente', 'haiku-privacidad-arranque', 'haiku-resumen-pendiente', 'haiku-pagos-pendiente');
        const names = ['Losa', 'Llave de gas', 'Té', 'Café', 'Té Hierbas', 'Cama', 'Salamandra', 'Leña', 'Diario', 'Amenities', 'Papel H.', 'Toallas', 'WC', 'Carbón', 'Fogón', 'Ventanas'];
        const rows = {
          cabanas: Array.from({ length: 11 }, (_, i) => ({ id: 'cab-' + (i + 1), numero: i + 1, activa: true })),
          checklist_items: names.map((nombre, i) => ({ id: 'express-' + i, nombre, categoria: '🧹 ASEO EXPRESS', activo: true })),
          solicitudes: [], revisiones_cabana: [], revision_items: [], aseos: [],
        };
        window.__requestRows = rows;
        window.__requestWrites = [];
        window.haikuSupabase = { from(table) {
          const filters = []; let payload, mutation;
          const read = () => (rows[table] || []).filter(row => filters.every(filter => filter(row)));
          const perform = () => {
            if (!mutation) return { data: read(), error: null };
            window.__requestWrites.push({ table, mutation, payload: { ...payload } });
            if (window.__requestFail) { window.__requestFail = false; return { data: null, error: new Error('Prueba: sin conexión') }; }
            let row = mutation === 'update' ? read()[0] : (rows[table] || []).find(row => row.fecha_operativa === payload.fecha_operativa && row.cabana_id === payload.cabana_id && row.categoria === payload.categoria);
            if (!row) { row = { id: table + '-' + (rows[table].length + 1) }; rows[table].push(row); }
            Object.assign(row, payload);
            return { data: row, error: null };
          };
          const query = {
            select() { return query; }, order() { return query; }, limit() { return query; },
            eq(key, value) { filters.push(row => row[key] === value); return query; },
            neq(key, value) { filters.push(row => row[key] !== value); return query; },
            is(key, value) { filters.push(row => (row[key] ?? null) === value); return query; },
            in(key, values) { filters.push(row => values.includes(row[key])); return query; },
            upsert(value) { payload = value; mutation = 'upsert'; return query; },
            insert(value) { payload = value; mutation = 'insert'; return query; },
            update(value) { payload = value; mutation = 'update'; return query; },
            single() { return Promise.resolve(perform()); },
            maybeSingle() { return Promise.resolve({ data: read()[0] || null, error: null }); },
            then(resolve, reject) { return Promise.resolve(perform()).then(resolve, reject); },
          };
          return query;
        } };
        document.dispatchEvent(new CustomEvent('haiku:supabase-ready'));
        window.haikuSesion = { auth: { id: 'request-test-user' }, usuario: { id: 'request-test-user' } };
        window.dispatchEvent(new CustomEvent('haiku:auth-ready'));
        await window.HAIKU_ASEO_OPERACION_V1.hidratar(fechaSeleccionada);
        window.HAIKU_CABANAS_SITES_V1.pintar();
      }, theme);
      await page.locator('.menu-item[data-seccion="cabanas"]').click();
      await page.evaluate(() => window.HAIKU_CABANAS_SITES_V1.abrir(1));
      const fullText = '🍳 COCINA\nConservar este detalle completo';
      await page.locator('#revision-detalles').fill(fullText);
      await page.locator('#revision-detalles').blur();
      const fullCheck = page.locator('#revision-checklist input[type="checkbox"]').first();
      await fullCheck.check();
      const checkedBefore = await page.locator('#revision-checklist input:checked').count();
      const modal = page.locator('#panel-agregar-solicita');
      const add = async (category, detail = '') => {
        await page.locator('#cabinsDetailAddRequest').click();
        assert.equal(await modal.locator('#solicita-cabana').isVisible(), false, 'la ficha ya determina la cabaña');
        assert.equal(await modal.locator('#solicita-cabana').isDisabled(), true);
        assert.equal(await modal.locator('#solicita-cabana-fija').textContent(), 'Cabaña 1');
        assert.equal(await modal.locator('[name="solicita-tipo"]').count(), 6);
        await modal.locator(`[value="${category}"]`).check();
        await page.locator('#solicita-texto').fill(detail);
        await page.locator('#guardar-solicita').click();
        await page.waitForFunction(() => !document.querySelector('#panel-agregar-solicita').classList.contains('activo'));
      };
      for (const category of ['reposicion_lena', 'reposicion_carbon', 'recambio_toallas', 'recambio_sabanas', 'recambio_ropa_cama']) {
        await add(category, category === 'reposicion_lena' ? '1 saco para el fogón' : '');
        assert.equal(await page.locator('#cabinsReviewMode').inputValue(), 'completa');
      }
      assert.equal(await page.locator('#cabinsDetailRequests .cb-typed-request').count(), 5);
      await page.locator('[data-cb-request-edit="1"][data-cb-request-category="reposicion_lena"]').click();
      assert.equal(await modal.locator('[name="solicita-tipo"]:checked').inputValue(), 'reposicion_lena');
      assert.equal(await modal.locator('[name="solicita-tipo"]:checked').isDisabled(), true);
      assert.equal(await modal.locator('#solicita-cabana').isVisible(), false, 'editar tampoco permite mover la solicitud a otra cabaña');
      await page.locator('#solicita-texto').fill('2 sacos\nDejar junto al fogón');
      await page.locator('#guardar-solicita').click();
      await page.waitForFunction(() => !document.querySelector('#panel-agregar-solicita').classList.contains('activo'));
      assert.equal(await page.evaluate(() => window.__requestRows.solicitudes.length), 5);
      await add('aseo_express');
      await page.waitForFunction(() => document.querySelector('#cabinsReviewMode').value === 'aseo_express');
      assert.equal(await page.locator('#revision-individual').isVisible(), false);
      assert.equal(await page.locator('#aseo-express-individual').isVisible(), true);
      assert.equal(await page.locator('#aseo-express-checklist input[type="checkbox"]').count(), 16);
      assert.equal(await page.locator('#cabinsDetailRequests .cb-typed-request').count(), 6);
      await page.locator('[data-cb-request-cancel="1"][data-cb-request-category="reposicion_lena"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#cabinsDetailRequests .cb-typed-request').length === 5);
      assert.equal(await page.locator('#cabinsReviewMode').inputValue(), 'aseo_express');
      await page.locator('[data-cb-request-cancel="1"][data-cb-request-category="aseo_express"]').click();
      await page.waitForFunction(() => document.querySelector('#cabinsReviewMode').value === 'completa');
      assert.equal(await page.locator('#revision-detalles').inputValue(), fullText);
      assert.equal(await page.locator('#revision-checklist input:checked').count(), checkedBefore);
      await page.locator('#cabinsDetailAddRequest').click();
      await modal.locator('[value="reposicion_lena"]').check();
      const draft = 'Este detalle no se pierde\nSegunda línea';
      await page.locator('#solicita-texto').fill(draft);
      await page.evaluate(() => { window.__requestFail = true; });
      await page.locator('#guardar-solicita').click();
      await page.waitForFunction(() => document.querySelector('#solicita-error').textContent.includes('sin conexión'));
      assert.equal(await modal.evaluate(node => node.classList.contains('activo')), true);
      assert.equal(await page.locator('#solicita-texto').inputValue(), draft);
      assert.equal(await modal.locator('#solicita-cabana').isDisabled(), true, 'un fallo no libera la cabaña fijada por la ficha');
      await page.evaluate(() => window.HAIKU_ASEO_OPERACION_V1.hidratar(fechaSeleccionada));
      assert.equal(await page.locator('#solicita-texto').inputValue(), draft);
      const overflow = await modal.locator('.cb-request-drawer-panel').evaluate(node => node.scrollWidth - node.clientWidth);
      assert.ok(overflow <= 1, 'el formulario cabe sin desplazamiento horizontal');
      assert.equal(await modal.locator('textarea:focus').count(), 0, 'guardar no vuelve a abrir el teclado');
      if (process.env.HAKU_UI_SHOTS) {
        fs.mkdirSync(process.env.HAKU_UI_SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.HAKU_UI_SHOTS, `requests-${width}-${theme}.png`) });
      }
      await page.locator('#guardar-solicita').click();
      await page.waitForFunction(() => !document.querySelector('#panel-agregar-solicita').classList.contains('activo'));
      assert.equal(await page.evaluate(() => window.__requestRows.solicitudes.find(row => row.categoria === 'reposicion_lena').descripcion), draft);
      assert.equal(await page.evaluate(() => window.__requestRows.solicitudes.every(row => row.cabana_id === 'cab-1')), true);
      await page.evaluate(() => { window.HAIKU_CABANAS_SITES_V1.cerrar(); window.HAIKU_CABANAS_SITES_V1.abrir(7); });
      await page.locator('#cabinsDetailAddRequest').click();
      assert.equal(await modal.locator('#solicita-cabana-fija').textContent(), 'Cabaña 7');
      assert.equal(await modal.locator('#solicita-cabana').isVisible(), false);
      await modal.locator('[value="recambio_toallas"]').check();
      await page.locator('#solicita-texto').fill('Toallas para Cabaña 7');
      // Incluso si otro productor toca el select oculto, se guarda la ficha original.
      await page.evaluate(() => { document.querySelector('#solicita-cabana').value = '2'; });
      await page.locator('#guardar-solicita').click();
      await page.waitForFunction(() => !document.querySelector('#panel-agregar-solicita').classList.contains('activo'));
      assert.equal(await page.evaluate(() => window.__requestRows.solicitudes.find(row => row.descripcion === 'Toallas para Cabaña 7').cabana_id), 'cab-7');
      await page.evaluate(() => window.HAIKU_CABANAS_SITES_V1.cerrar());
      await page.locator('#agregar-solicita').click();
      assert.equal(await modal.locator('#solicita-cabana').isVisible(), true, 'el listado general conserva la elección de cabaña');
      assert.equal(await modal.locator('#solicita-cabana').isDisabled(), false);
      assert.equal(await modal.locator('#solicita-cabana-fija').isVisible(), false);
      await modal.locator('#solicita-cabana').selectOption('3');
      await modal.locator('[value="reposicion_carbon"]').check();
      await page.locator('#solicita-texto').fill('Carbón para Cabaña 3');
      await page.locator('#guardar-solicita').click();
      await page.waitForFunction(() => !document.querySelector('#panel-agregar-solicita').classList.contains('activo'));
      assert.equal(await page.evaluate(() => window.__requestRows.solicitudes.find(row => row.descripcion === 'Carbón para Cabaña 3').cabana_id), 'cab-3');
      assert.equal(await page.evaluate(() => window.__requestWrites.every(write => write.table === 'solicitudes')), true, 'no modifica aseos, revisiones ni insumos');
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Solicitudes ${width}px ${theme}: seis tipos, detalle opcional, edición, cancelación, Express automático y revisión completa conservada OK.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
