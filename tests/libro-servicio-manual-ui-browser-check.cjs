// Presentación real de Servicios; sólo loopback y el cliente de fixtures en memoria.
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const { chromium } = require('playwright');
const { read, source, setup, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const root = path.resolve(__dirname, '..'), errors = [], externos = [], medidas = [];
const baseline = process.env.HAKU_SERVICIOS_UI_BASELINE === '1';
const output = process.env.HAKU_SERVICIOS_UI_SCREENSHOT_DIR;
const anterior = process.env.HAKU_SERVICIOS_UI_BASELINE_FILE ? JSON.parse(fs.readFileSync(process.env.HAKU_SERVICIOS_UI_BASELINE_FILE, 'utf8')) : null;
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        ['styles', 'supabase-asistente-v1', 'supabase-haku-reconciliacion-v1', 'sites-asistente-v1'].map(s => `<link rel="stylesheet" href="/css/${s}.css">`).join('') +
        '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel"><header class="haiku-asistente-cabecera">Haku</header><div class="haiku-asistente-mensajes" id="mensajes"><div id="prev" class="haiku-asistente-mensaje--usuario"></div><div id="out"></div></div></div></div></body></html>');
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/css' }).end(fs.readFileSync(file)); }
    catch { res.writeHead(404).end(); }
});
const geometria = row => row.evaluate(el => {
    const box = x => { const r = x.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; };
    return { ...box(el), client: el.clientWidth, scroll: el.scrollWidth,
        acciones: box(el.querySelector('.haku-libro-servicio-manual__acciones')),
        botones: [...el.querySelectorAll('.haku-libro-servicio-manual__acciones > button')].map(b => ({
            ...box(b), texto: b.textContent, color: getComputedStyle(b).color, fondo: getComputedStyle(b).backgroundColor })) };
});
const sinOverflow = async page => {
    const desbordes = await page.evaluate(() => [...document.querySelectorAll('.haku-libro-servicios-sites, .haku-libro-servicios__item, .haku-libro-servicio-manual, .haku-libro-servicio-manual input, .haku-libro-servicio-manual select')]
        .filter(el => el.getBoundingClientRect().width && el.scrollWidth > el.clientWidth + 1)
        .map(el => ({ clase: el.className, scroll: el.scrollWidth, client: el.clientWidth })));
    assert.deepEqual(desbordes, [], 'sin overflow interno');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
};
const foto = async (locator, nombre) => {
    if (!output) return;
    fs.mkdirSync(output, { recursive: true });
    await locator.screenshot({ path: path.join(output, nombre + '.png') });
};
(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
        for (const width of [1100, 390, 320]) {
            const page = await browser.newPage({ viewport: { width, height: 950 } });
            page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : (externos.push(r.request().url()), r.abort()));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for (const f of ['haiku-libro-semantica-v1', 'haiku-servicios-identidad-v1']) await page.addScriptTag({ content: read(`js/${f}.js`) });
            await page.evaluate(setup); await page.addScriptTag({ content: source });
            await page.evaluate(async q => {
                window.q = q; window.reservasAbiertas = [];
                window.HAIKU_INSPECTOR_V1 = { abrirReserva: (id, boton) => reservasAbiertas.push({ id, texto: boton.textContent }) };
                document.getElementById('prev').textContent = q;
                const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
                api.renderizar(await api.construir(q), document.getElementById('out'), q);
            }, consulta);
            if (!baseline) await page.waitForFunction(() => [...document.styleSheets].some(s => s.href?.includes('haiku-libro-pagos-ui-v1.css')));
            if (!baseline) {
                // La capa visual de Pagos también puede estar activa en el shell real.
                await page.addScriptTag({ content: read('js/haiku-libro-pagos-ui-v1.js') });
                assert.equal(await page.locator('#haiku-libro-pagos-ui-v1-css').count(), 1, 'una sola hoja compartida');
            }
            const revision = page.locator('.haku-libro-servicios__seccion--revision');
            await revision.locator(':scope > summary').click();
            assert.equal(await page.locator('.haku-libro-servicio-manual').count(), 0);
            await sinOverflow(page); await foto(revision, `revision-${width}`);
            const ids = await page.locator('.haku-libro-servicios__item input').evaluateAll(els => els.map(e => e.dataset.hakuItemId));
            for (const [caso, texto, id, campos] of [
                ['tinaja', '1 HORA DE CORTESIA TINAJA', '00000000-0000-4000-8000-000000000001', ['codigo_servicio', 'hora']],
                ['late', 'X PAGAR LATE OUT', '00000000-0000-4000-8000-000000000001', ['hora']],
                ['masaje', '1 MASAJE DE 1 HORA', '00000000-0000-4000-8000-000000000002', ['codigo_servicio', 'hora']]
            ]) {
                const row = revision.locator('.haku-libro-servicios__item').filter({ hasText: texto });
                const m = await geometria(row); medidas.push({ viewport: width, caso, ...m });
                assert.equal(m.botones.length, 2);
                if (!baseline) {
                    for (const b of m.botones) assert.ok(b.height >= 30 && b.height <= 34, JSON.stringify(b));
                    assert.equal(m.botones[0].fondo, 'rgb(255, 255, 255)'); assert.equal(m.botones[1].color, 'rgb(255, 255, 255)');
                    assert.ok(Math.abs(m.botones[0].y - m.botones[1].y) <= 1, 'misma fila cuando caben');
                    assert.ok(Math.abs(m.botones[0].x - m.acciones.x) <= 1, 'secundario a la izquierda');
                    assert.ok(Math.abs(m.botones[1].right - m.acciones.right) <= 1, 'CTA a la derecha');
                    const viejo = anterior?.find(x => x.viewport === width && x.caso === caso);
                    if (anterior) assert.ok(viejo, 'medida original del mismo viewport y caso');
                    if (viejo) assert.ok(m.height <= viejo.height + 1, `tarjeta compacta ${caso} ${width}: ${m.height} <= ${viejo.height}`);
                }
                await row.getByRole('button', { name: 'Ver reserva', exact: true }).click();
                assert.deepEqual(await page.evaluate(() => reservasAbiertas.at(-1)), { id, texto: 'Ver reserva' });
                await row.getByRole('button', { name: 'Aprobación manual', exact: true }).click();
                const panel = page.locator('.haku-libro-servicio-manual'); await panel.waitFor({ state: 'visible' });
                assert.deepEqual(await panel.locator('[data-campo-manual]').evaluateAll(els => els.map(x => x.dataset.campoManual)), campos);
                assert.match(await panel.innerText(), /Datos conocidos:.*60 minutos|Datos conocidos:.*cortesía|Datos conocidos:.*cobrable/);
                if (!baseline) {
                    assert.equal(await panel.locator('.haiku-manual-cabecera h3').count(), 1);
                    assert.equal(await panel.locator('.haiku-manual-resumen').count(), 1);
                    assert.equal(await panel.locator('.haiku-manual-badge').filter({ hasText: 'CAB' }).count(), 1);
                    assert.equal(await panel.locator('.haiku-manual-aviso--revision').count(), 1);
                    const evidencia = panel.locator('.haiku-manual-evidencia'); await evidencia.locator('summary').click();
                    assert.match(await evidencia.innerText(), new RegExp(texto));
                    assert.equal(await panel.locator('.haiku-manual-pie .haiku-manual-primario').textContent(), 'Confirmar datos y revalidar');
                    await panel.locator('[data-campo-manual="hora"]').fill('17:00');
                    await panel.locator('[data-campo-manual="hora"]').dispatchEvent('change');
                    assert.match(await panel.innerText(), /Inicio 17:00/);
                }
                await sinOverflow(page); await foto(panel, `${caso}-${width}`);
                await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
                await panel.waitFor({ state: 'detached' });
                assert.deepEqual(await page.locator('.haku-libro-servicios__item input').evaluateAll(els => els.map(e => e.dataset.hakuItemId)), ids);
                assert.equal(await page.evaluate(() => HAIKU_LIBRO_SERVICIOS_SCOPE_V2.estadosPorVista.get(document.getElementById('out')).manuales.size), 0);
                assert.equal(await page.evaluate(() => fixtureServicios.escrituras.length), 0);
            }
            if (!baseline) {
                // Estado ya soportado: servicio sin equivalencia manual; conserva sólo Ver reserva.
                await page.evaluate(async () => {
                    const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2, resultado = await api.construir(q), base = resultado.items[0];
                    api.renderizar({ ...resultado, items: [{ ...base, servicio: { ...base.servicio, concepto: 'cuna' }, mapa: { nombre: 'Cuna' } }] }, document.getElementById('out'), q);
                });
                await revision.locator(':scope > summary').click();
                const single = revision.locator('.haku-libro-servicios__item');
                assert.equal(await single.getByRole('button').count(), 1);
                assert.equal(await single.getByRole('button').textContent(), 'Ver reserva');
                await single.getByRole('button').click(); assert.equal(await page.evaluate(() => reservasAbiertas.length), 4);
                await sinOverflow(page); await foto(single, `solo-ver-${width}`);
                // Reducir el ancho disponible fuerza wrap sin alterar los callbacks ni el shell.
                await page.evaluate(async () => {
                    const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2; api.renderizar(await api.construir(q), document.getElementById('out'), q);
                });
                await revision.locator(':scope > summary').click();
                const narrow = revision.locator('.haku-libro-servicios__item').first();
                await narrow.locator('.haku-libro-servicio-manual__acciones').evaluate(el => el.style.width = '180px');
                const wrap = await geometria(narrow);
                assert.ok(wrap.botones[1].y > wrap.botones[0].y, 'wrap sólo cuando no caben');
                assert.ok(wrap.botones.every(b => b.right <= wrap.acciones.right + 1));
                await sinOverflow(page);
                await narrow.getByRole('button', { name: 'Ver reserva', exact: true }).evaluate(el => el.remove());
                const primarioSolo = await geometria(narrow);
                assert.equal(primarioSolo.botones.length, 1);
                assert.ok(Math.abs(primarioSolo.botones[0].right - primarioSolo.acciones.right) <= 1, 'CTA único conserva alineación');
                await sinOverflow(page);
            }
            await page.close(); console.log(`PASS Servicios UI ${width}px: tinaja/Late/masaje, panel abierto/cerrado, botones y callbacks, sin overflow`);
        }
        assert.deepEqual(errors, []); assert.deepEqual(externos, []);
        if (output) fs.writeFileSync(path.join(output, 'medidas.json'), JSON.stringify(medidas, null, 2));
    } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
