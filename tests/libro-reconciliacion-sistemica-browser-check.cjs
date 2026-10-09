// Derivado OOXML anonimizado → worker de producción → semántica → reconciliación → tarjeta.
// Todas las lecturas/escrituras de Proyecto H usan un snapshot LOCAL; no hay red remota.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), crypto = require('node:crypto'), { chromium } = require('playwright');
const { F, esperados, instalar } = require('./fixtures/libro-reconciliacion-real.cjs');
const root = path.resolve(__dirname, '..'), assets = process.env.HAIKU_LIBRO_WORKER_ASSETS || path.join(os.tmpdir(), 'haiku-jonathan-real-xlsx');
const salida = process.env.HAIKU_RECONCILIACION_REPORT || path.join(os.tmpdir(), 'haiku-servicios-auditoria');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/libro-reconciliacion-oct26-real.xlsx'));
assert.equal(hash(bytes), F.origen.sha256_fixture);
const deps = new Map([
    ['https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', fs.readFileSync(path.join(assets, 'xlsx.full.min.js'))],
    ['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', fs.readFileSync(path.join(assets, 'jszip.min.js'))]
]);
const servidos = new Map(), errores = [], externos = [];
const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        ['styles', 'sites-asistente-v1', 'supabase-asistente-v1'].map(n => `<link rel="stylesheet" href="/css/${n}.css">`).join('') +
        '<body><div class="haiku-asistente-panel"><div id="haiku-asistente-mensajes"></div></div></body></html>');
    if (u.pathname === '/original.xlsx') return res.end(bytes);
    const file = path.resolve(root, '.' + u.pathname);
    if (!file.startsWith(root + path.sep) || !/^\/(?:css|js)\//.test(u.pathname)) return res.writeHead(403).end();
    try { const b = fs.readFileSync(file); servidos.set(u.pathname, hash(b)); res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript;charset=utf-8' : 'text/css;charset=utf-8', 'Cache-Control': 'no-store' }).end(b); }
    catch { res.writeHead(404).end(); }
});
const consulta = 'Libro: compara servicios de octubre 2026 con Proyecto H';
const row = (page, id) => page.locator('.haku-libro-servicios__item').filter({ has: page.locator(`input[data-haku-item-id="${id}"]`) });
const revision = '.haku-libro-servicios__seccion--revision', existente = '.haku-libro-servicios__seccion--existentes';
async function abrirSecciones(page) { await page.locator('.haku-libro-servicios__seccion').evaluateAll(xs => xs.forEach(x => x.open = true)); }
async function preparar(page, errorTabla = null) {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const n of ['haiku-libro-semantica-v1', 'haiku-servicios-identidad-v1']) await page.addScriptTag({ url: `/js/${n}.js` });
    const hoja = await page.evaluate(async () => {
        const buffer = await (await fetch('/original.xlsx')).arrayBuffer(), worker = new Worker('/js/supabase-libro-reserva-worker-v1.js');
        const r = await new Promise((ok, no) => {
            worker.onerror = no; worker.onmessage = e => e.data.ok ? ok(e.data.resultado) : no(Error(e.data.error));
            worker.postMessage({ id: 1, tipo: 'hoja', nombreHoja: 'Oct26', buffer }, [buffer]);
        }); worker.terminate(); globalThis.hojaReal = r; return r;
    });
    for (const celda of F.origen.celdas) {
        const c = F.hoja.celdas.find(c => hash(c.valor) === celda.sha256_texto);
        const actual = hoja.celdas.find(x => x.r === c.r && x.c === c.c);
        assert.equal(hash(actual.valor), celda.sha256_texto, celda.celda);
    }
    await page.evaluate(({ instalar, db, origen, errorTabla }) => {
        const normalizada = HAIKU_LIBRO_SEMANTICA.normalizarHoja(hojaReal, 'Oct26');
        (0, eval)(`(${instalar})`)(normalizada, db, origen);
        reconciliacionFixture.errorTabla = errorTabla;
    }, { instalar: instalar.toString(), db: F.db, origen: F.origen, errorTabla });
    await page.addScriptTag({ url: '/js/haiku-libro-servicios-scope-v2.js' });
    await page.evaluate(q => HAIKU_LIBRO_SERVICIOS_SCOPE_V2.procesar(q), consulta); await abrirSecciones(page);
}
(async () => {
    fs.mkdirSync(salida, { recursive: true }); await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
    try {
        browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        for (const width of [1100, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 950 } });
            await context.route('**/*', r => deps.has(r.request().url()) ? r.fulfill({ contentType: 'application/javascript', body: deps.get(r.request().url()) }) :
                new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : (externos.push(r.request().url()), r.abort()));
            const page = await context.newPage(); page.on('pageerror', e => errores.push(e.message)); await preparar(page);
            const matriz = await page.evaluate(async ({ q, antes }) => {
                const r = await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.construir(q), items = r.items.filter(i => i.kind === 'servicio');
                return antes.map(a => { const i = items.find(i => i.item_id === a.item_id); return {
                    ...a, categoria_anterior: a.estado, categoria_nueva: i.reconciliacion_estado, estado_ui: i.estado,
                    reserva: i.asociacion.sistema?.reserva_id || null, estadia: i.asociacion.sistema?.id || null,
                    fecha: i.fecha, hora: i.hora, candidato_ids: i.candidatos_existentes.map(c => c.id),
                    candidatos: i.reconciliacion.evaluados.map(e => ({ id: e.candidato.id, nombre: e.candidato.catalogo_servicios.nombre,
                        fecha: e.candidato.fecha_servicio, hora: e.candidato.hora_inicio, cantidad: e.candidato.cantidad, total: e.candidato.total,
                        cobro: e.candidato.tipo_cobro, coincidencias: e.coincidencias, faltantes: e.faltantes, contradicciones: e.contradicciones })),
                    motivos: i.razones, decision: i.reconciliacion.motivo, escritura_propuesta: Boolean(i.payload) }; });
            }, { q: consulta, antes: F.antes });
            assert.equal(matriz.length, 21);
            for (const [n, m] of matriz.entries()) {
                assert.equal(m.categoria_nueva, esperados[n], JSON.stringify(m));
                const tarjeta = row(page, m.item_id); assert.equal(await tarjeta.count(), 1);
                const clase = m.estado_ui === 'existente' ? existente : m.estado_ui === 'listo' ? '.haku-libro-servicios__seccion--servicios' : revision;
                assert.equal(await page.locator(clase).locator(`input[data-haku-item-id="${m.item_id}"]`).count(), 1);
                assert.equal(await tarjeta.locator('input').isDisabled(), !m.escritura_propuesta);
                if (m.categoria_nueva === 'EXISTENTE_SEGURO') assert.equal(await tarjeta.getByRole('button', { name: 'Aprobación manual', exact: true }).count(), 0);
            }
            if (width === 1100) fs.writeFileSync(path.join(salida, 'matriz-reconciliacion-21.json'), JSON.stringify({ origen: F.origen, matriz }, null, 2) + '\n');
            // Un fallo de notas bloquea la selección anterior antes de confirmar o llamar al writer.
            const seleccionPrevia = await page.locator('input[type=checkbox]:enabled:checked').evaluateAll(xs => xs.map(x => x.dataset.hakuItemId));
            assert.equal(seleccionPrevia.length, 3);
            const dbSinCambios = await page.evaluate(() => JSON.stringify(reconciliacionFixture.db));
            await page.evaluate(() => {
                reconciliacionFixture.errorTabla = 'notas';
                globalThis.confirm = () => { reconciliacionFixture.confirmaciones = (reconciliacionFixture.confirmaciones || 0) + 1; return false; };
            });
            const incorporar = page.locator('button[data-haku-accion="incorporar"]');
            for (let intento = 0; intento < 2; intento++) {
                await incorporar.click();
                await page.waitForFunction(() => !document.querySelector('button[data-haku-accion="incorporar"]').hasAttribute('aria-busy'));
                assert.match(await page.locator('.haku-libro-servicios').textContent(), /No pude consultar las notas de Proyecto H.*Reintenta/);
                assert.equal(await incorporar.isEnabled(), true);
                assert.deepEqual(await page.evaluate(() => reconciliacionFixture.rpcs), []);
                assert.deepEqual(await page.evaluate(() => reconciliacionFixture.escrituras), []);
                assert.equal(await page.evaluate(() => reconciliacionFixture.confirmaciones || 0), 0);
            }
            await page.evaluate(() => reconciliacionFixture.errorTabla = null);
            await incorporar.click(); // Reintento con SELECT correcto; cancelar la confirmación.
            await page.waitForFunction(() => !document.querySelector('button[data-haku-accion="incorporar"]').hasAttribute('aria-busy'));
            assert.equal(await page.evaluate(() => reconciliacionFixture.confirmaciones), 1);
            assert.deepEqual(await page.evaluate(() => reconciliacionFixture.rpcs), []);
            assert.equal(await page.evaluate(() => JSON.stringify(reconciliacionFixture.db)), dbSinCambios);
            assert.deepEqual(await page.locator('input[type=checkbox]:enabled:checked').evaluateAll(xs => xs.map(x => x.dataset.hakuItemId)), seleccionPrevia);
            await page.evaluate(() => globalThis.confirm = () => true);
            const id = F.antes[12].item_id, rocio = F.antes[9].item_id, sergio = F.antes[19].item_id;
            assert.equal(await row(page, id).getByRole('button', { name: 'Aprobación manual', exact: true }).count(), 0);
            // La selección de otro item sobrevive abrir/cancelar/confirmar la asociación.
            await row(page, sergio).locator('input').uncheck();
            const dbAntes = await page.evaluate(() => JSON.stringify(reconciliacionFixture.db));
            await row(page, id).getByRole('button', { name: 'Vincular con existente', exact: true }).click();
            let panel = page.locator('.haku-libro-servicio-manual');
            assert.match(await panel.innerText(), /13:30–14:00|13:30/); assert.match(await panel.innerText(), /35\.000/);
            assert.match(await panel.innerText(), /al recargar deberás revisarlo otra vez/);
            assert.equal(await panel.locator('input,select').count(), 0);
            await panel.screenshot({ path: path.join(salida, `vincular-joseph-${width}.png`) });
            await panel.getByRole('button', { name: 'Cancelar', exact: true }).click(); assert.equal(await panel.count(), 0);
            assert.equal(await row(page, sergio).locator('input').isChecked(), false); assert.equal(await row(page, rocio).locator('input').isChecked(), true);
            await row(page, id).getByRole('button', { name: 'Vincular con existente', exact: true }).click();
            await page.locator('.haku-libro-servicio-manual').getByRole('button', { name: 'Confirmar vínculo con existente', exact: true }).click();
            await page.waitForFunction(id => document.querySelector(`.haku-libro-servicios__seccion--existentes input[data-haku-item-id="${id}"]`), id);
            await abrirSecciones(page);
            const vinculado = await page.evaluate(async ({ q, id }) => {
                const card = document.querySelector('.haku-libro-servicios');
                const r = await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.revalidarVista(card, q);
                return r.items.find(i => i.item_id === id);
            }, { q: consulta, id });
            assert.equal(vinculado.item_id, id);
            assert.equal(vinculado.reconciliacion_estado, 'EXISTENTE_SEGURO'); assert.equal(vinculado.payload, null);
            assert.equal(await page.evaluate(() => JSON.stringify(reconciliacionFixture.db)), dbAntes);
            assert.deepEqual(await page.evaluate(() => reconciliacionFixture.rpcs), []);
            assert.equal(await row(page, sergio).locator('input').isChecked(), false);
            // Revalidación del lote completo: modificar un vínculo bloquea incluso otra creación seleccionada.
            await page.evaluate(() => reconciliacionFixture.db.servicios.find(s => s.id === '00000000-0000-4000-9000-000000000149').total++);
            await page.locator('button[data-haku-accion="incorporar"]').click();
            await page.waitForFunction(() => document.querySelector('.haku-libro-servicios').textContent.includes('Un vínculo del lote cambió'));
            assert.deepEqual(await page.evaluate(() => reconciliacionFixture.escrituras), []);
            // Un nuevo render muestra el vínculo obsoleto y permite descartarlo para revisar otra vez.
            await page.evaluate(async ({ q, id }) => {
                const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2, card = document.querySelector('.haku-libro-servicios');
                globalThis.estadoObsoleto = (await api.revalidarVista(card, q)).items.find(i => i.item_id === id);
            }, { q: consulta, id });
            assert.equal(await page.evaluate(() => estadoObsoleto.reconciliacion_estado), 'CONFLICTO');
            await abrirSecciones(page);
            await row(page, id).getByRole('button', { name: 'Descartar vínculo y revisar', exact: true }).click();
            await page.waitForFunction(id => [...document.querySelectorAll('.haku-libro-servicios__item')].some(x =>
                x.querySelector(`input[data-haku-item-id="${id}"]`) && x.textContent.includes('Vincular con existente')), id);
            // Incorporación simulada independiente; jamás toca Supabase ni llama al registrar.
            await page.reload(); await preparar(page); await page.evaluate(() => reconciliacionFixture.permitirWriterLocal = true);
            await page.locator('input[type=checkbox]:enabled').evaluateAll((xs, id) => xs.forEach(x => {
                x.checked = x.dataset.hakuItemId === id; x.dispatchEvent(new Event('change', { bubbles: true }));
            }), rocio);
            await page.locator('button[data-haku-accion="incorporar"]').click();
            await page.waitForFunction(() => reconciliacionFixture.escrituras.length === 1);
            const primera = await page.evaluate(() => ({ count: reconciliacionFixture.db.servicios.length, args: reconciliacionFixture.escrituras[0] }));
            assert.equal(primera.args.p_servicios.length, 1); assert.equal(primera.args.p_servicios[0].item_id, rocio);
            await page.evaluate(q => HAIKU_LIBRO_SERVICIOS_SCOPE_V2.procesar(q), consulta);
            const segunda = await page.evaluate(async ({ q, id }) => {
                const i = (await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.construir(q)).items.find(i => i.item_id === id);
                return { categoria: i.reconciliacion_estado, payload: i.payload, razones: i.razones, decision: i.reconciliacion, count: reconciliacionFixture.db.servicios.length };
            }, { q: consulta, id: rocio });
            assert.equal(segunda.categoria, 'EXISTENTE_SEGURO', JSON.stringify({ primera, segunda })); assert.equal(segunda.payload, null); assert.equal(segunda.count, primera.count);
            assert.equal(await page.evaluate(() => reconciliacionFixture.rpcs.includes('haiku_registrar_servicio')), false);
            // Fallo en la consulta inicial: sólo error claro, sin tarjetas incorporables; nueva consulta permite recuperar.
            await preparar(page, 'notas');
            assert.match(await page.locator('#haiku-asistente-mensajes').textContent(), /No pude consultar las notas de Proyecto H.*Reintenta/);
            assert.equal(await page.locator('button[data-haku-accion="incorporar"]').count(), 0);
            assert.deepEqual(await page.evaluate(() => reconciliacionFixture.rpcs), []);
            assert.deepEqual(await page.evaluate(() => reconciliacionFixture.escrituras), []);
            await page.evaluate(async q => { reconciliacionFixture.errorTabla = null; await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.procesar(q); }, consulta);
            const recuperado = await page.evaluate(async ({ q, antes }) => {
                const r = await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.construir(q), notas = r.items.filter(i => i.kind === 'nota');
                return { listas: notas.filter(i => i.estado === 'listo').length, existentes: notas.filter(i => i.estado === 'existente').length,
                    servicios: antes.map(a => r.items.find(i => i.item_id === a.item_id).reconciliacion_estado), payloads: r.items.filter(i => i.kind === 'servicio' && i.payload).map(i => i.item_id).sort() };
            }, { q: consulta, antes: F.antes });
            assert.equal(recuperado.listas, 1); assert.equal(recuperado.existentes, 16);
            assert.deepEqual(recuperado.servicios, esperados); assert.deepEqual(recuperado.payloads, [rocio, sergio].sort());
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            for (const n of ['haiku-libro-semantica-v1', 'haiku-servicios-identidad-v1', 'haiku-libro-servicios-scope-v2', 'supabase-libro-reserva-worker-v1'])
                assert.equal(servidos.get(`/js/${n}.js`), hash(fs.readFileSync(path.join(root, 'js', n + '.js'))));
            console.log(`PASS ${width}px: XLSX real → worker → 21 categorías/UI/payload; error de notas inicial/final bloquea, 0 RPC, reintento conserva 1 lista/16 existentes; cancelar/vincular SELECT; selección persistente; lote obsoleto bloqueado; segunda incorporación omite existente; SHA JS actual.`);
            await context.close();
        }
        assert.deepEqual(errores, []); assert.deepEqual(externos, []);
    } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
