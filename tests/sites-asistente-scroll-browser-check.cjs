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
        if (type === 'comparison') {
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

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const { messages, insert } = await setup(page);
        const header = page.locator('.haiku-asistente-cabecera');
        const composer = page.locator('.haiku-asistente-pie');
        const headerBefore = await header.boundingBox();
        const composerBefore = await composer.boundingBox();
        await insert('comparison');
        let state = await position(page, messages);
        assert.equal(state.overflow, 'auto');
        assert.equal(state.scrollbar, 'none');
        assert.equal(state.webkit, 'none');
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

        await insert('conversation');
        state = await position(page, messages);
        assert.ok(state.height > state.client + 500, `la conversación larga usa el mismo scroll: ${JSON.stringify(state)}`);
        await page.mouse.wheel(0, 520);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 100);
        assert.equal((await position(page, messages)).page, 0);

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
        } finally { await mobile.close(); }
        console.log('Haku Sites: wheel, trackpad, touch, comparación y conversación largas, footer fijo y scrollbar oculta OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
