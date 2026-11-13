// El área central de Haku debe ser el único scroll vertical durante la conversación.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/sites-shell-v1.css"><link rel="stylesheet" href="/css/supabase-asistente-v1.css"><link rel="stylesheet" href="/css/supabase-haku-reconciliacion-v1.css"><link rel="stylesheet" href="/css/sites-asistente-v1.css"></head><body><main style="height:3000px">Página de fondo</main></body></html>');
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try { response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(fs.readFileSync(file)); }
    catch { response.writeHead(404).end(); }
});

async function setup(page) {
    await page.addInitScript(() => {
        window.haikuSesion = { usuario: { id: 'scroll-test' } };
        window.haikuSupabase = { auth: { onAuthStateChange() {} } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ content: read('js/supabase-asistente-v1.js') });
    await page.locator('#haiku-asistente-boton').click();
    const messages = page.locator('#haiku-asistente-mensajes');
    const insert = async kind => page.evaluate(type => {
        const messages = document.getElementById('haiku-asistente-mensajes');
        messages.replaceChildren();
        if (type === 'short') {
            messages.append(Object.assign(document.createElement('div'), {
                className: 'haiku-asistente-mensaje haiku-asistente-mensaje--asistente', textContent: 'Respuesta breve de Haku' }));
        } else if (type === 'comparison') {
            const report = document.createElement('article');
            report.className = 'haiku-asistente-preview haku-comparacion-compacta haku-comparacion-sites';
            report.append(Object.assign(document.createElement('header'), { className: 'haku-comparacion-sites-cabecera', textContent: 'Libro de Reserva ↔ Proyecto H' }));
            for (let i = 0; i < 70; i++) report.append(Object.assign(document.createElement('p'), { textContent: `Caso de comparación ${i + 1}` }));
            messages.append(report);
        } else {
            for (let i = 0; i < 70; i++) messages.append(Object.assign(document.createElement('div'), {
                className: 'haiku-asistente-mensaje haiku-asistente-mensaje--asistente', textContent: `Mensaje ${i + 1} de Haku` }));
        }
        messages.scrollTop = 0;
    }, kind);
    return { messages, insert };
}

async function position(page, messages) {
    return messages.evaluate(el => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight,
        overflow: getComputedStyle(el).overflowY, scrollbar: getComputedStyle(el).scrollbarWidth,
        webkit: getComputedStyle(el, '::-webkit-scrollbar').display,
        page: window.scrollY }));
}

async function revisarDesplegables(page, messages) {
    const errores = [];
    const recogerError = error => errores.push(error.message);
    page.on('pageerror', recogerError);
    const consultas = read('js/haiku-libro-consultas-v1.js');
    const exportacion = 'const apiConsultas = Object.freeze({ interpretar,';
    assert.ok(consultas.includes(exportacion));
    await page.addScriptTag({ content: read('js/haiku-libro-semantica-v1.js') });
    await page.addScriptTag({ content: consultas.replace(exportacion, exportacion.replace('interpretar,', 'renderizarIncorporacion, interpretar,')) });
    await page.evaluate(() => {
        window.__busquedasPagos = 0;
        const buscar = document.querySelectorAll.bind(document);
        document.querySelectorAll = selector => {
            if (selector.includes('haiku-incorporacion-item--pagos')) window.__busquedasPagos++;
            return buscar(selector);
        };
        window.HAIKU_LIBRO_RESERVA_V1 = { consultarHoja: async () => ({ reservas: [] }), listarHojas: () => [] };
    });
    for (const modulo of ['pagos-ui', 'pagos-seleccion', 'consulta-anual-ui']) {
        await page.addScriptTag({ url: `/js/haiku-libro-${modulo}-v1.js` });
    }
    await messages.evaluate(area => {
        const respuesta = document.createElement('div');
        respuesta.className = 'haiku-asistente-mensaje haiku-asistente-mensaje--asistente';
        area.append(respuesta);
        respuesta.textContent = 'LIBRO · CONSULTA ANUAL · 2026\nReserva ficticia · 1 reserva\n' +
            '• CAB 2 · Reserva ficticia · 2026-11-12 → 2026-11-13 · 1 noche';
    });
    await messages.locator('.haiku-anual-persona').getByText('Reserva ficticia', { exact: true }).waitFor();
    await messages.evaluate(area => {
        const plan = {
            escrituraHabilitada: true,
            permisos: [],
            items: Array.from({ length: 80 }, (_, i) => ({
                id: String(i), categoria: 'pagos', dependeDe: [], motivos: [], seleccionado: true,
                texto: `Reserva ficticia ${i} · CAB 2 · $10.000 CLP`,
                pagoLibro: {
                    monto: 10000, fecha_bloque: '2026-11-12', fecha_comprobante: '2026-11-10',
                    medio_pago: 'transferencia', referencia_externa: `Glosa de prueba ${i}`
                },
                payload: { tipo: 'pago' }
            }))
        };
        const salida = document.createElement('div');
        area.replaceChildren(salida);
        window.__rehacerPlanHaku = () => window.HAIKU_LIBRO_CONSULTAS.renderizarIncorporacion(
            salida, structuredClone(plan), () => {}, null, () => {}
        );
        window.__rehacerPlanHaku();
    });
    const seccion = messages.locator('.haiku-incorporacion-seccion--pagos');
    const resumen = seccion.locator('summary').first();
    const checks = seccion.locator('input[type="checkbox"]');
    await page.waitForFunction(() => document.querySelector('[data-haiku-pago-seleccion-key]'));
    assert.equal(await checks.count(), 80, 'las fichas plegadas conservan sus datos');
    assert.equal(await seccion.locator('article').first().evaluate(el => getComputedStyle(el).contentVisibility), 'auto');
    await resumen.press('Space');
    await checks.first().uncheck();
    assert.equal(await checks.last().evaluate(el => el.checkVisibility({ contentVisibilityAuto: true })), false);
    const zona = await messages.boundingBox();
    const inicio = (await position(page, messages)).top;
    await page.mouse.move(zona.x + zona.width / 2, zona.y + zona.height / 2);
    await page.mouse.wheel(0, 500);
    await page.waitForFunction(top => document.getElementById('haiku-asistente-mensajes').scrollTop > top + 100, inicio);
    assert.equal((await position(page, messages)).page, 0);
    await checks.last().evaluate(el => el.closest('article').scrollIntoView({ block: 'center' }));
    await page.waitForFunction(() => {
        const tarjetas = document.querySelectorAll('.haiku-incorporacion-seccion--pagos article');
        return tarjetas[tarjetas.length - 1]?.querySelector('input').checkVisibility({ contentVisibilityAuto: true });
    });
    await resumen.click();
    await resumen.click();
    assert.equal(await checks.first().isChecked(), false);
    assert.equal(await messages.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.evaluate(() => window.__rehacerPlanHaku());
    await page.waitForFunction(() => !document.querySelector('.haiku-incorporacion-seccion--pagos input').checked);
    assert.equal(await checks.last().isChecked(), true);
    assert.equal(await page.evaluate(() => window.__busquedasPagos), 0, 'la navegación evita recorrer los pagos de toda la página');
    assert.deepEqual(errores, []);
    page.off('pageerror', recogerError);
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = process.env.HAKU_CHROMIUM_PATH || (fs.existsSync(edge) ? edge : undefined);
    const browser = await chromium.launch({ executablePath, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const { messages, insert } = await setup(page);
        const header = page.locator('.haiku-asistente-cabecera');
        const composer = page.locator('.haiku-asistente-pie');
        const headerBefore = await header.boundingBox();
        const composerBefore = await composer.boundingBox();
        await insert('short');
        let state = await position(page, messages);
        assert.ok(state.height <= state.client + 1, `el contenido corto no crea scroll innecesario: ${JSON.stringify(state)}`);
        await insert('comparison');
        state = await position(page, messages);
        assert.equal(state.overflow, 'auto');
        assert.equal(state.scrollbar, 'thin');
        assert.equal(state.webkit, 'block');
        assert.ok(state.height > state.client + 500, `la comparación aporta su altura al área central: ${JSON.stringify(state)}`);
        const box = await messages.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 650);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 100);
        const down = (await position(page, messages)).top;
        await page.mouse.wheel(0, -650);
        await page.waitForFunction(previous => document.getElementById('haiku-asistente-mensajes').scrollTop < previous, down);
        await messages.evaluate(el => { el.scrollTop = 0; });
        for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 23.5);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 50);
        assert.equal((await position(page, messages)).page, 0, 'no se mueve la página de fondo');
        assert.equal((await header.boundingBox()).y, headerBefore.y, 'header fijo');
        assert.equal((await composer.boundingBox()).y, composerBefore.y, 'compositor fijo');
        assert.equal(await page.locator('#haiku-asistente-texto').isVisible(), true);
        assert.equal(await page.locator('#haiku-asistente-rapidas').isVisible(), true);

        const insetBarra = await messages.evaluate(async el => {
            el.scrollTop = 0;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return (el.offsetWidth - el.clientWidth) / 2;
        });
        const scrollbarBox = await messages.boundingBox();
        const scrollX = scrollbarBox.x + scrollbarBox.width - insetBarra;
        await page.mouse.move(scrollX, scrollbarBox.y + scrollbarBox.height * .14);
        await page.mouse.down();
        await page.mouse.move(scrollX, scrollbarBox.y + scrollbarBox.height * .72, { steps: 8 });
        await page.mouse.up();
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 50);

        await insert('conversation');
        state = await position(page, messages);
        assert.ok(state.height > state.client + 500, `la conversación larga usa el mismo scroll: ${JSON.stringify(state)}`);
        await page.mouse.wheel(0, 520);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 100);
        assert.equal((await position(page, messages)).page, 0);
        await revisarDesplegables(page, messages);

        const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        try {
            const touchPage = await mobile.newPage();
            const { messages: mobileMessages, insert: mobileInsert } = await setup(touchPage);
            await mobileInsert('comparison');
            const area = await mobileMessages.boundingBox();
            const x = Math.round(area.x + area.width / 2);
            const y = Math.round(area.y + area.height * .78);
            const cdp = await mobile.newCDPSession(touchPage);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove', touchPoints: [{ x, y: y - step * 45 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await touchPage.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 20);
            assert.equal((await position(touchPage, mobileMessages)).page, 0);
            assert.equal(await touchPage.locator('#haiku-asistente-texto').isVisible(), true);
            await touchPage.addStyleTag({ url: '/css/haiku-tema-oscuro-v1.css' });
            await touchPage.evaluate(() => { document.documentElement.dataset.haikuTema = 'oscuro'; });
            await revisarDesplegables(touchPage, mobileMessages);
        } finally { await mobile.close(); }
        console.log('Haku Sites: desplazamiento, desplegables, selección y posición del compositor en escritorio y móvil OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
