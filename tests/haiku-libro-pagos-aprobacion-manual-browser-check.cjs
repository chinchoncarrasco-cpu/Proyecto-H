// UI real con el cliente local de las regresiones funcionales. Ninguna conexión remota.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exportsBase = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const source = read('js/haiku-libro-consultas-v1.js').replace(exportsBase,
    exportsBase.replace(' })', ', renderizarIncorporacion, continuarVistaManualPago })'));
const fixtureSource = read('tests/haiku-libro-pagos-aprobacion-manual.test.cjs');
const fixtures = fixtureSource.slice(fixtureSource.indexOf('const id ='), fixtureSource.indexOf('const itemPago=plan'));
assert.ok(fixtures.includes('function entorno('), 'reutiliza el cliente en memoria validado');
const missing = [];
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        const styles = ['styles', 'supabase-asistente-v1', 'supabase-haku-reconciliacion-v1', 'sites-asistente-v1', 'haiku-libro-pagos-ui-v1'];
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
            '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            styles.map(name => `<link rel="stylesheet" href="/css/${name}.css">`).join('') +
            '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel">' +
            '<header class="haiku-asistente-cabecera"><span>Haku</span><button type="button">Cerrar</button></header>' +
            '<div id="haiku-asistente-mensajes" class="haiku-asistente-mensajes"></div>' +
            '<footer class="haiku-asistente-compositor">Acciones rápidas</footer></div></div></body></html>');
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
        response.writeHead(200, { 'Content-Type': pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript' })
            .end(fs.readFileSync(file));
    } catch { missing.push(pathname); response.writeHead(404).end(); }
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
        const errors = [], external = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname === '127.0.0.1') return route.continue();
            external.push(url.origin); return route.abort();
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(() => { window.HAIKU_LIBRO_RESERVA_V1 = { consultarHoja: async data => data }; });
        for (const file of ['haiku-libro-semantica-v1', 'haiku-libro-pagos-destinos-v1', 'haiku-libro-pagos-canon-v1']) {
            await page.addScriptTag({ content: read('js/' + file + '.js') });
        }
        await page.addScriptTag({ content: source });
        await page.addScriptTag({ content: `const S=window.HAIKU_LIBRO_SEMANTICA,C=window.HAIKU_LIBRO_PAGOS_CANON_V1,D=window.HAIKU_LIBRO_PAGOS_DESTINOS_V1,Q=window.HAIKU_LIBRO_CONSULTAS;
            const global=window,assert={equal(a,b){if(a!==b)throw Error(a+' != '+b)},fail(t){throw Error(t)}}; ${fixtures}` });
        await page.evaluate(() => {
            window.__opened = []; window.__incorporar = 0;
            window.HAIKU_INSPECTOR_V1 = { abrirReserva: (...args) => window.__opened.push(args) };
            window.__start = async options => {
                const h = entorno(options); window.__h = h; window.haikuSupabase = h.db;
                window.__actions = 0; window.__gate = false; window.__continue = null;
                const aprobar = async () => { throw Error('Ruta de aprobación inesperada'); };
                const render = plan => {
                    window.__plan = plan;
                    const out = document.createElement('div');
                    document.getElementById('haiku-asistente-mensajes').replaceChildren(out);
                    Q.renderizarIncorporacion(out, plan, () => {}, aprobar, () => { window.__incorporar++; });
                };
                aprobar.manualPago = async (plan, id, action) => {
                    window.__actions++;
                    if (window.__gate) await new Promise(resolve => { window.__continue = resolve; });
                    const next = await h.resolver(plan, plan.items.find(item => item.id === id), action);
                    Q.continuarVistaManualPago(plan, next, id, action); render(next);
                };
                render(await h.preparar());
            };
        });
        const panel = page.locator('.haiku-incorporacion-manual-pago-panel:not([hidden])');
        const start = async options => {
            await page.evaluate(options => window.__start(options), options);
            await page.locator('.haiku-incorporacion-seccion--dudosos > summary').click();
            await page.getByRole('button', { name: 'Aprobación manual', exact: true }).click();
            await panel.waitFor({ state: 'visible' });
        };
        const fill = async (index, codigo, cantidad, precio, personas) => {
            await page.waitForFunction(() => document.querySelector('[aria-label="Servicio del catálogo"]')?.options.length > 1);
            await panel.getByLabel('Aplicación a resolver', { exact: true }).selectOption(String(index));
            await panel.getByLabel('Servicio del catálogo', { exact: true }).selectOption(codigo);
            await panel.getByLabel('Fecha del servicio', { exact: true }).fill('2026-10-03');
            await panel.getByLabel('Cantidad', { exact: true }).fill(String(cantidad));
            await panel.getByLabel('Precio unitario CLP', { exact: true }).fill(String(precio));
            if (personas !== undefined) await panel.getByLabel('Personas', { exact: true }).fill(String(personas));
            await panel.getByLabel('Tipo de cobro', { exact: true }).selectOption('normal');
            const manual = panel.getByLabel('Confirmo el precio manual y el total exacto del Libro', { exact: true });
            if (await manual.isVisible()) await manual.check();
            assert.equal(await panel.getByRole('button', { name: 'Guardar servicio y continuar', exact: true }).isEnabled(), true);
        };
        const geometry = async mobile => {
            await page.waitForFunction(() => [...document.querySelectorAll('.haiku-incorporacion-manual-pago-panel:not([hidden]) img')].every(i => i.complete && i.naturalWidth > 0));
            const result = await panel.evaluate(e => {
                const r = e.getBoundingClientRect();
                return { width: r.width, scroll: e.scrollWidth, client: e.clientWidth,
                    columns: getComputedStyle(e.querySelector('.haiku-manual-dos-columnas')).gridTemplateColumns.split(' ').length,
                    shell: document.querySelector('.haiku-asistente-panel').getBoundingClientRect().width,
                    overflow: getComputedStyle(document.getElementById('haiku-asistente-mensajes')).overflowY,
                    images: [...e.querySelectorAll('img')].map(i => ({ loaded: i.complete && i.naturalWidth > 0,
                        width: i.getBoundingClientRect().width, original: i.naturalWidth })) };
            });
            assert.ok(result.scroll <= result.client + 1, 'panel sin overflow horizontal');
            assert.equal(result.shell, mobile ? 390 : 486, 'ancho global intacto');
            assert.equal(result.overflow, 'auto', 'scroll natural del panel existente');
            assert.equal(result.columns, mobile ? 1 : 2);
            assert.ok(result.images.every(i => i.loaded && i.width === i.original), 'SVG reales en sus dimensiones originales: ' + JSON.stringify(result.images));
        };
        const screenshot = async name => {
            if (!process.env.HAKU_MANUAL_SCREENSHOT_DIR) return;
            fs.mkdirSync(process.env.HAKU_MANUAL_SCREENSHOT_DIR, { recursive: true });
            // Vista aislada sólo de QA: conserva valores y CSS, sin modificar el shell real.
            const snapshot = await panel.evaluate(e => {
                const copy = e.cloneNode(true); copy.style.margin = '0'; copy.style.width = '100%';
                e.querySelectorAll('select').forEach((select, i) => {
                    [...copy.querySelectorAll('select')[i].options].forEach(option => { option.selected = option.value === select.value;
                        if (option.selected) option.setAttribute('selected', ''); else option.removeAttribute('selected'); });
                });
                e.querySelectorAll('input').forEach((input, i) => {
                    const next = copy.querySelectorAll('input')[i]; next.setAttribute('value', input.value);
                    if (input.checked) next.setAttribute('checked', ''); else next.removeAttribute('checked');
                });
                return { html: copy.outerHTML, font: getComputedStyle(e).fontFamily, width: Math.min(486, innerWidth) };
            });
            const preview = await browser.newPage({ viewport: { width: snapshot.width, height: 2000 } });
            try {
                await preview.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
                await preview.setContent('<!doctype html><html><head><base href="' + page.url() + '">' +
                    ['styles', 'supabase-asistente-v1', 'supabase-haku-reconciliacion-v1', 'sites-asistente-v1', 'haiku-libro-pagos-ui-v1']
                        .map(file => `<link rel="stylesheet" href="css/${file}.css">`).join('') +
                    '</head><body style="display:block;margin:0;padding:0;overflow:auto;width:100vw"><div class="haiku-asistente-root" style="position:static;width:100%;max-width:none">' + snapshot.html + '</div></body></html>');
                await preview.locator('body').evaluate((e, font) => { e.style.fontFamily = font; }, snapshot.font);
                await preview.locator('.haiku-incorporacion-manual-pago-panel').screenshot({ path: path.join(process.env.HAKU_MANUAL_SCREENSHOT_DIR, name + '.png') });
            } finally { await preview.close(); }
        };

        await start({ distribuido: false, conServicios: false });
        assert.match(await panel.innerText(), /Paso 1 de 2[\s\S]*Asociar el servicio[\s\S]*Ignacio Herrera/);
        assert.equal(await panel.getByRole('button', { name: 'Guardar servicio y continuar' }).isDisabled(), true);
        assert.equal(await page.evaluate(() => window.__h.tablas.servicios.length), 0, 'sólo renderizar no crea servicios');
        await fill(0, 'tinajaTonel', 1, 30000, 2);
        assert.equal(await panel.getByLabel('Hora cuando corresponda', { exact: true }).isVisible(), false);
        await geometry(false); await screenshot('paso1-escritorio');
        await page.evaluate(() => { window.__gate = true; });
        const guardar = panel.getByRole('button', { name: 'Guardar servicio y continuar', exact: true });
        await guardar.click();
        await page.waitForFunction(() => window.__continue !== null);
        await guardar.dispatchEvent('click');
        assert.equal(await page.evaluate(() => window.__actions), 1, 'guardia visual evita doble acción');
        await page.evaluate(() => { window.__gate = false; window.__continue(); });
        await page.waitForFunction(() => document.querySelector('.haiku-incorporacion-manual-pago-panel')?.dataset.paso === '2');
        assert.equal(await panel.isVisible(), true, 'la categoría del nuevo plan permanece abierta');
        assert.match(await panel.innerText(), /Tinaja Tonel[\s\S]*03 oct 2026[\s\S]*Los montos coinciden/);
        await screenshot('paso2-escritorio');
        await panel.getByRole('button', { name: 'Volver a editar', exact: true }).click();
        assert.equal(await panel.count(), 0);
        await page.getByRole('button', { name: 'Aprobación manual', exact: true }).click();
        await panel.getByRole('button', { name: 'Confirmar asociación y pago', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.haiku-incorporacion-manual-pago-panel')?.dataset.paso === 'aprobado');
        assert.match(await panel.innerText(), /Pago seguro[\s\S]*Asociación y pago aprobados/);
        await screenshot('aprobado-escritorio');
        await panel.getByRole('button', { name: 'Ver reserva', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__opened[0][0]), '00000000-0000-4000-8000-000000000001');
        assert.equal(await page.evaluate(() => window.__opened[0][2].estadiaId), '00000000-0000-4000-8000-000000000002');
        await panel.getByRole('button', { name: 'Volver a revisión', exact: true }).click();
        assert.equal(await page.locator('.haiku-incorporacion-item--pagos').count(), 1);

        await page.setViewportSize({ width: 390, height: 844 });
        await start({ conServicios: false });
        await panel.getByRole('button', { name: 'Confirmar distribución', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.haiku-manual-progreso')?.textContent === 'Aplicaciones resueltas 0 de 3');
        for (const [index, codigo, cantidad, precio] of [[0, 'quequeEntero', 1, 5000], [1, 'panMasaMadre', 1, 5000], [2, 'huevo', 6, 500]]) {
            await fill(index, codigo, cantidad, precio);
            assert.equal(await panel.getByLabel('Personas', { exact: true }).isVisible(), false);
            assert.equal(await panel.getByLabel('Hora cuando corresponda', { exact: true }).isVisible(), false);
            await geometry(true);
            if (index === 2) {
                assert.equal(await panel.getByLabel('Confirmo el precio manual y el total exacto del Libro', { exact: true }).isVisible(), false);
                assert.match(await panel.locator('.haiku-manual-total').innerText(), /3\.000 CLP/);
            }
            await panel.getByRole('button', { name: 'Guardar servicio y continuar', exact: true }).click();
            await page.waitForFunction(n => document.querySelector('.haiku-manual-progreso')?.textContent === `Aplicaciones resueltas ${n} de 3`, index + 1);
            assert.equal(await panel.getAttribute('data-paso'), index === 2 ? '2' : '1');
        }
        await screenshot('paso2-movil');
        await panel.getByRole('button', { name: 'Confirmar asociación y pago', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.haiku-incorporacion-manual-pago-panel')?.dataset.paso === 'aprobado');
        const gaston = await page.evaluate(() => ({ servicios: window.__h.tablas.servicios.length, pagos: window.__h.tablas.pagos.length,
            padres: window.__plan.items.filter(i => i.categoria === 'pagos').length,
            personas: window.__h.llamadas.filter(l => l.nombre === 'haiku_registrar_servicio').map(l => l.args.p_personas),
            writes: window.__h.llamadas.filter(l => l.nombre === 'haiku_incorporar_pago_servicios_libro_v1').length }));
        assert.deepEqual(gaston, { servicios: 3, pagos: 0, padres: 1, personas: [0, 0, 0], writes: 0 });
        assert.match(await panel.innerText(), /13\.000 CLP/);
        assert.equal(await page.evaluate(() => window.__incorporar), 0, 'no se incorporan pagos en la prueba de UI');
        assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(missing, []);
        console.log('OK · aprobación manual: pasos 1/2/éxito, Ignacio, Gastón 0/3→3/3, UUID Inspector, doble clic, escritorio/móvil, SVG y cero operaciones remotas.');
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
