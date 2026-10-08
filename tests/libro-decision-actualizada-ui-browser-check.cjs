// Presentación nueva sobre preguntas y callbacks reales; transporte sólo en memoria.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('js/haiku-libro-consultas-v1.js').replace(
    'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })',
    'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion, renderizarComparacion })'
);
const query = 'Libro: compara las reservas de octubre 2026 con Proyecto H';
const originalText = 'Decisión actualizada. Pulsa Preparar incorporación para actualizar el resumen.';
const screenshots = path.join(os.tmpdir(), 'haiku-libro-decision-actualizada-ui');
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
            '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            ['styles', 'sites-shell-v1', 'supabase-asistente-v1', 'supabase-haku-reconciliacion-v1', 'sites-asistente-v1']
                .map(name => `<link rel="stylesheet" href="/css/${name}.css">`).join('') +
            '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel"><header class="haiku-asistente-cabecera">Haku · Libro</header><div class="haiku-asistente-mensajes" id="mensajes"></div><footer class="haiku-asistente-compositor">Consulta local de prueba</footer></div></div></body></html>'
        );
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
        const type = pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript';
        response.writeHead(200, { 'Content-Type': type }).end(fs.readFileSync(file));
    } catch { response.writeHead(404).end(); }
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        await page.addInitScript(() => {
            window.__reads = 0;
            window.__writes = 0;
            window.__blockRead = false;
            window.__failRead = false;
            window.__waiters = [];
            window.__release = () => { window.__blockRead = false; window.__waiters.splice(0).forEach(resolve => resolve()); };
            const book = { id: 'Oct26!C3', titular: 'Carmen Ruiz', rut_documento: '12345678-9', cabana: 2,
                fecha_checkin: '2026-10-08', fecha_checkout: '2026-10-09', tipo_estadia: 'alojamiento', noches: 1,
                pagos: [], pagos_sin_asociacion: [], servicios: [], advertencias: [],
                coordenadas_origen: { hoja: 'Oct26', celda: 'C3' } };
            const stay = { id: '22222222-2222-4222-8222-222222222222', reserva_id: '11111111-1111-4111-8111-111111111111',
                cabanas: { numero: 2 }, fecha_ingreso: book.fecha_checkin, fecha_salida: book.fecha_checkout,
                estado_estadia: 'confirmada', tipo_estadia: 'alojamiento',
                reservas: { titular_nombre: book.titular, titular_numero_documento: '99999999-1', estado_reserva: 'confirmada' } };
            window.HAIKU_LIBRO_RESERVA_V1 = {
                listo: async () => {}, estado: () => ({ cargado: true, generacion: 1, nombre: 'Prueba local.xlsx' }),
                listarHojas: () => ['Oct26'], consultarHoja: async () => ({ cobertura: { geometria: false }, reservas: [book], bloqueos: [], advertencias: [] })
            };
            window.haikuSupabase = {
                auth: { getSession: async () => ({ data: { session: { user: { id: 'prueba-local' } } } }) },
                from(table) {
                    const builder = { select: () => builder, lte: () => builder, gte: () => builder, in: () => builder, order: () => builder,
                        range: async (start, end) => {
                            window.__reads++;
                            if (window.__blockRead) await new Promise(resolve => window.__waiters.push(resolve));
                            if (window.__failRead) throw new Error('Lectura de prueba rechazada');
                            return { data: (table === 'reserva_estadias' ? [stay] : []).slice(start, end + 1), error: null };
                        } };
                    return builder;
                },
                rpc() { window.__writes++; throw new Error('Este check no permite escrituras'); }
            };
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.addScriptTag({ content: read('js/haiku-libro-semantica-v1.js') });
        await page.addScriptTag({ content: read('js/haiku-libro-reconciliacion-ux-v1.js') });
        await page.addScriptTag({ content: source });
        const render = async () => page.evaluate(async texto => {
            localStorage.removeItem('haiku-libro-reconciliacion-decisiones-v1');
            const result = await window.HAIKU_LIBRO_CONSULTAS.consultar(texto);
            window.__result = result;
            window.__before = JSON.stringify(result.comparacion);
            const out = document.createElement('div');
            window.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out, result);
            document.getElementById('mensajes').replaceChildren(out);
        }, query);
        const questions = page.locator('.haiku-asistente-preview-lista:has(> label)');
        const notice = page.locator('.haku-comparacion-sites-decision');
        const actions = page.locator('.haku-comparacion-sites-acciones');
        const revalidate = actions.getByRole('button', { name: 'Revalidar contra Proyecto H', exact: true });
        const prepare = actions.getByRole('button', { name: 'Preparar incorporación', exact: true });
        const choose = async () => {
            await questions.locator(':scope > strong').click();
            await questions.locator('.haku-pregunta-caso > summary').click();
            await questions.locator('select').selectOption('asociar:22222222-2222-4222-8222-222222222222');
        };
        await render();
        await page.waitForFunction(() => document.getElementById('haiku-libro-decision-cards-v1')?.sheet);
        assert.equal(await notice.count(), 0, 'sin aviso antes de decidir');
        assert.equal(await questions.locator('.haiku-reconciliacion-meta').innerText(), '0 resueltas · 1 pendiente');
        await page.evaluate(() => { window.__questions = document.querySelector('.haiku-asistente-preview-lista:has(> label)'); });
        await choose();
        assert.equal(await questions.locator(':scope > strong').textContent(), 'Preguntas necesarias · sólo para esta vista previa', 'título funcional intacto');
        assert.equal(await questions.locator(':scope > strong').evaluate(el => getComputedStyle(el, '::after').content), '"Ocultar"', 'misma interacción del desplegable');
        assert.equal(await questions.locator('.haiku-reconciliacion-meta').innerText(), '1 resuelta · 0 pendientes');
        assert.equal(await notice.count(), 1);
        assert.equal(await notice.textContent(), originalText, 'texto funcional exacto');
        assert.equal(await notice.getAttribute('role'), 'status');
        assert.equal(await notice.locator('strong').innerText(), 'Decisión actualizada.');
        assert.equal(await notice.locator('span').innerText(), 'Pulsa Preparar incorporación para actualizar el resumen.');
        await page.waitForFunction(() => document.querySelector('.haku-comparacion-sites-decision-icono')?.naturalWidth === 18);
        assert.equal(await page.evaluate(() => JSON.stringify(window.__result.comparacion) === window.__before), true, 'presentación no muta comparación');
        assert.equal(await questions.evaluate(el => el === window.__questions), true, 'las preguntas no se reconstruyen al decidir');
        assert.deepEqual(await questions.locator('option').evaluateAll(nodes => nodes.map(n => n.value)),
            ['', 'asociar:22222222-2222-4222-8222-222222222222', 'independiente']);
        await questions.locator(':scope > strong').click();
        assert.equal(await questions.locator('select').isVisible(), false, 'cerrar preguntas conserva decisión y aviso');

        fs.mkdirSync(screenshots, { recursive: true });
        const measurements = [];
        for (const width of [1440, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            await notice.scrollIntoViewIfNeeded();
            const fit = await page.evaluate(() => {
                const card = document.querySelector('.haku-comparacion-sites');
                const status = card.querySelector('.haku-comparacion-sites-decision');
                const question = card.querySelector('.haiku-asistente-preview-lista:has(> label) > strong');
                const counter = card.querySelector('.haiku-reconciliacion-meta');
                const buttons = [...card.querySelectorAll('.haku-comparacion-sites-acciones > button')];
                const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
                return { scroll: card.scrollWidth, client: card.clientWidth, pageScroll: document.documentElement.scrollWidth,
                    status: rect(status), helper: rect(card.querySelector('.haku-comparacion-sites-pie > span')),
                    question: { ...rect(question), font: getComputedStyle(question).fontSize, weight: getComputedStyle(question).fontWeight,
                        background: getComputedStyle(question).backgroundColor, radius: getComputedStyle(question).borderRadius,
                        toggle: getComputedStyle(question, '::after').content, toggleWeight: getComputedStyle(question, '::after').fontWeight },
                    counter: rect(counter), footer: rect(card.querySelector('.haku-comparacion-sites-pie')),
                    noticeStyle: { background: getComputedStyle(status).backgroundColor, radius: getComputedStyle(status).borderRadius,
                        titleFont: getComputedStyle(status.querySelector('strong')).fontSize, titleWeight: getComputedStyle(status.querySelector('strong')).fontWeight,
                        bodyColor: getComputedStyle(status.querySelector('span')).color, bodyFont: getComputedStyle(status.querySelector('span')).fontSize },
                    buttons: buttons.map(el => ({ ...rect(el), scroll: el.scrollWidth, client: el.clientWidth,
                        background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color,
                        border: getComputedStyle(el).borderTopWidth, borderStyle: getComputedStyle(el).borderTopStyle,
                        shadow: getComputedStyle(el).boxShadow })),
                    noticeFits: status.scrollWidth <= status.clientWidth, text: status.textContent,
                    ordered: card.querySelector('.haiku-reconciliacion-meta').getBoundingClientRect().bottom <= status.getBoundingClientRect().top &&
                        status.getBoundingClientRect().bottom <= card.querySelector('.haku-comparacion-sites-pie').getBoundingClientRect().top };
            });
            assert.ok(fit.scroll <= fit.client + 1 && fit.pageScroll <= width, `${width}: sin overflow`);
            assert.ok(fit.noticeFits && fit.ordered, `${width}: aviso íntegro debajo del contador y antes del pie`);
            assert.equal(fit.text, originalText);
            assert.equal(fit.question.height, width === 320 ? 48 : 32, 'franja compacta; sólo envuelve cuando falta ancho');
            assert.equal(fit.question.font, '9px');
            assert.equal(fit.question.weight, '600');
            assert.equal(fit.question.radius, '4px');
            assert.equal(fit.question.toggle, '"Mostrar"');
            assert.equal(fit.question.toggleWeight, '400');
            assert.equal(fit.question.background, 'rgb(230, 242, 235)');
            assert.equal(fit.counter.y - fit.question.y - fit.question.height, 12, 'contador separado 12 px de la franja');
            assert.equal(fit.status.y - fit.counter.y - fit.counter.height, 16, 'aviso separado 16 px del contador');
            assert.equal(fit.footer.y - fit.status.y - fit.status.height, 16, 'separación de acciones sin cambiar sus estilos');
            assert.equal(fit.question.x, fit.status.x, 'ambos bloques alineados');
            assert.equal(fit.question.width, fit.status.width);
            assert.equal(fit.status.height, width === 1440 ? 63 : 79, 'altura visual de la referencia');
            assert.deepEqual(fit.noticeStyle, { background: 'rgb(230, 242, 235)', radius: '8px', titleFont: '12px', titleWeight: '600',
                bodyColor: 'rgb(104, 120, 115)', bodyFont: '11px' });
            const [secondary, primary] = fit.buttons;
            assert.equal(secondary.height, 34);
            assert.equal(primary.height, 34);
            assert.equal(primary.width, secondary.width);
            assert.equal(primary.x, secondary.x);
            assert.ok(primary.y >= secondary.y + secondary.height);
            assert.ok(fit.buttons.every(b => b.scroll <= b.client));
            assert.ok(fit.buttons.every(b => b.border === '1px' && b.borderStyle === 'solid' && b.shadow === 'none'), 'borde uniforme sin sombra nativa');
            assert.equal(secondary.background, 'rgb(255, 255, 255)');
            assert.equal(secondary.color, 'rgb(34, 115, 92)');
            assert.equal(primary.background, 'rgb(34, 115, 92)');
            assert.equal(primary.color, 'rgb(255, 255, 255)');
            if (width > 600) assert.ok(fit.helper.x < secondary.x && fit.helper.y < primary.y, 'ayuda izquierda / botones derecha');
            else assert.ok(fit.helper.y + fit.helper.height <= secondary.y, 'ayuda sobre los botones en móvil');
            measurements.push({ viewport: width, questionHeight: fit.question.height, noticeHeight: fit.status.height, buttons: `${secondary.width}×${secondary.height}` });
            await page.evaluate(() => { const messages = document.getElementById('mensajes'); messages.scrollTop = messages.scrollHeight; });
            await page.locator('.haiku-asistente-panel').screenshot({ path: path.join(screenshots, `decision-${width}.png`) });
            const clip = await page.evaluate(() => {
                const header = document.querySelector('.haiku-asistente-preview-lista:has(> label) > strong').getBoundingClientRect();
                const status = document.querySelector('.haku-comparacion-sites-decision').getBoundingClientRect();
                return { x: header.x - 8, y: header.y - 8, width: header.width + 16, height: status.bottom - header.y + 16 };
            });
            await page.screenshot({ path: path.join(screenshots, `bloques-${width}.png`), clip });
            await notice.locator('span').evaluate(el => { el.textContent = ' Pulsa Preparar incorporación para actualizar el resumen. '.repeat(8) + 'EvidenciaSinEspacios'.repeat(12); });
            assert.ok(await notice.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight), `${width}: texto largo completo sin recorte`);
            await notice.locator('span').evaluate(el => { el.textContent = ' Pulsa Preparar incorporación para actualizar el resumen.'; });
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('.haku-comparacion-sites').evaluate(el => { el.style.width = '280px'; });
        assert.ok(await page.locator('.haku-comparacion-sites').evaluate(el => el.scrollWidth <= el.clientWidth), 'panel angosto en desktop también envuelve sin overflow');
        await page.locator('.haku-comparacion-sites').evaluate(el => { el.style.removeProperty('width'); });
        // Callback original de revalidación, disparado también por teclado.
        const reads = await page.evaluate(() => window.__reads);
        await page.evaluate(() => { window.__blockRead = true; });
        await revalidate.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.__waiters.length > 0);
        assert.equal(await revalidate.isDisabled(), true);
        assert.equal(await prepare.isDisabled(), true);
        assert.equal(await notice.count(), 0, 'carga conserva su feedback original');
        assert.match(await page.locator('.haku-comparacion-sites').innerText(), /Revalidando reservas, pagos y decisiones recordadas compatibles/);
        await page.evaluate(() => window.__release());
        await page.waitForFunction(() => !document.querySelector('.haku-comparacion-sites-acciones > button')?.disabled);
        assert.ok(await page.evaluate(() => window.__reads) > reads, 'revalidación ejecuta las lecturas originales');
        assert.equal(await questions.locator('.haiku-reconciliacion-meta').innerText(), '1 resuelta · 0 pendientes', 'decisión recordada sigue aplicada');

        // Callback original de preparación y guardas disabled/loading.
        await render();
        await choose();
        await page.evaluate(() => { window.__blockRead = true; });
        await prepare.click();
        await page.waitForFunction(() => window.__waiters.length > 0);
        const loading = actions.locator('.haku-comparacion-sites-preparar');
        assert.equal(await loading.innerText(), 'Preparando…');
        assert.equal(await loading.getAttribute('aria-busy'), 'true');
        assert.equal(await loading.isDisabled(), true);
        assert.equal(await revalidate.isDisabled(), true);
        assert.equal(await questions.locator('select').isDisabled(), true);
        assert.equal(await notice.count(), 0);
        const preparingReads = await page.evaluate(() => window.__reads);
        await loading.dispatchEvent('click');
        assert.equal(await page.evaluate(() => window.__reads), preparingReads, 'doble clic no duplica preparación');
        await page.evaluate(() => window.__release());
        await page.waitForSelector('.haku-incorporacion-sites');
        assert.equal(await page.evaluate(() => window.__writes), 0, 'preparar no incorpora ni escribe');

        // Los errores mantienen los estados originales, sin aviso de éxito.
        await render();
        await choose();
        await page.evaluate(() => { window.__failRead = true; });
        await revalidate.click();
        await page.waitForFunction(() => document.querySelector('.haku-comparacion-sites')?.textContent.includes('No se pudo revalidar:'));
        assert.equal(await notice.count(), 0);
        assert.equal(await revalidate.isEnabled(), true);
        assert.equal(await prepare.isDisabled(), true, 'no prepara un resultado cuya revalidación falló');
        await page.evaluate(() => { window.__failRead = false; });
        await render();
        await choose();
        await page.evaluate(() => { window.__failRead = true; });
        await prepare.click();
        await page.waitForFunction(() => document.querySelector('.haku-comparacion-sites')?.textContent.includes('No se pudo preparar:'));
        assert.equal(await notice.count(), 0);
        assert.equal(await prepare.isEnabled(), true);
        assert.equal(await prepare.getAttribute('aria-busy'), null);
        assert.equal(await revalidate.isEnabled(), true);
        assert.equal(await questions.locator('select').isEnabled(), true);
        assert.equal(await page.evaluate(() => window.__writes), 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ result: 'OK', checks: 'aviso/texto exacto, desktop/390/320, texto largo, preguntas, callbacks reales, teclado, loading/disabled, errores, sin escrituras', measurements, screenshots }, null, 2));
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
