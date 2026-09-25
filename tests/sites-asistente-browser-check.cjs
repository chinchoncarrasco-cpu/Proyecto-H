// Contrato de la presentación Sites del Haku real. Se ejecuta en Edge local
// con Supabase simulado: ninguna solicitud sale del proceso de pruebas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const { chromium } = require('playwright');

const html = read('index.html');
const panelHtml = read('panel.html');
const css = read('css/sites-asistente-v1.css');
assert.match(html, /css\/sites-asistente-v1\.css/);
assert.match(panelHtml, /css\/sites-asistente-v1\.css/);
assert.match(panelHtml, /supabase-asistente-resumen-dia-v1/, 'módulo operativo del día presente en el panel real');
assert.doesNotThrow(() => new Function(panelHtml.match(/<script>([\s\S]*?)<\/script>/)[1]), 'bootstrap del panel válido');
assert.match(css, /haiku-asistente-panel/);
assert.doesNotMatch(css, /haku-assist-demo-note/);

const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/supabase-asistente-v1.css"><link rel="stylesheet" href="/css/supabase-asistente-adjuntos-fix-v1.css"><link rel="stylesheet" href="/css/sites-asistente-v1.css"></head><body><main>Vista previa del panel</main></body></html>');
        return;
    }
    // El historial pide dos parches de otros flujos. Sus contratos se prueban
    // aparte; aquí sólo necesitamos su carga sin una aplicación completa.
    if (/^\/js\/haiku-libro-(historial-ui-fix|confirm-cancel-fix)-v1\.js$/.test(pathname)) {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end('');
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
        response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
        response.end(fs.readFileSync(file));
    } catch { response.writeHead(404).end(); }
});

async function install(page) {
    await page.addScriptTag({ content: read('js/supabase-asistente-v1.js') });
    await page.addScriptTag({ content: read('js/supabase-asistente-resumen-dia-v1.js') });
    await page.addScriptTag({ content: read('js/supabase-asistente-historial-v1.js') });
    await page.locator('#haiku-asistente-boton').waitFor();
}

async function takeCall(page) {
    await page.waitForFunction(() => window.__pending.length > 0);
    return page.evaluate(() => window.__calls.at(-1));
}

async function finishCall(page, result) {
    await page.evaluate(value => window.__pending.shift()(value), result);
    await page.waitForFunction(() => !window.HAIKU_ASISTENTE.procesando());
}

function samplePreview() {
    return {
        ok: true,
        preview: {
            confianza: 'alta', resumen: 'Reserva preparada para revisión.',
            reserva: {
                tipo_estadia: 'alojamiento', titular_nombre: 'Valentina Prueba',
                fecha_llegada: '2026-09-25', fecha_salida: '2026-09-26',
                cabana: 2, cloudbeds_id: 'CB-TEST-1', adultos: 2,
                monto_total: 160000, monto_pagado: 0, saldo_pendiente: 160000
            },
            pagos: [], faltantes: [], advertencias: []
        }
    };
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            window.haikuSesion = { usuario: { id: 'test-only' } };
            window.__calls = [];
            window.__rpcCalls = [];
            window.__pending = [];
            window.__confirm = false;
            window.confirm = () => window.__confirm;
            window.alert = message => { window.__lastAlert = message; };
            window.haikuTienePermiso = () => true;
            window.haikuSupabase = {
                auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
                functions: { invoke(name, options) {
                    window.__calls.push({ name, options });
                    return new Promise(resolve => window.__pending.push(resolve));
                } },
                rpc(name, options) {
                    window.__rpcCalls.push({ name, options });
                    if (name === 'haiku_operacion_dia') return Promise.resolve({ data: [], error: null });
                    if (name === 'haiku_cabanas_disponibles') return Promise.resolve({ data: [{ numero: 2 }], error: null });
                    if (name === 'haiku_crear_reserva') return Promise.resolve({ data: { codigo_haiku: 'H-TEST' }, error: null });
                    return Promise.resolve({ data: null, error: { message: `RPC inesperado: ${name}` } });
                }
            };
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await install(page);

        const panel = page.locator('#haiku-asistente-panel');
        const overlay = page.locator('#haiku-asistente-overlay');
        const opener = page.locator('#haiku-asistente-boton');
        const welcome = page.locator('#haiku-asistente-bienvenida');
        const messages = page.locator('#haiku-asistente-mensajes');
        assert.equal(await panel.isVisible(), false, 'panel cerrado al cargar');
        assert.equal(await overlay.isVisible(), false, 'overlay cerrado al cargar');
        await opener.click();
        assert.equal(await panel.isVisible(), true);
        assert.equal(await overlay.isVisible(), true);
        assert.equal(await panel.getAttribute('aria-modal'), 'true');
        assert.match(await panel.locator('.haiku-asistente-cabecera').innerText(), /Haku\s+Asistente operativo/);
        assert.match(await welcome.innerText(), /¿En qué te ayudo durante el turno\?/);
        assert.equal(await welcome.isVisible(), true);
        assert.equal(await messages.locator('.haiku-asistente-mensaje').count(), 0, 'sin saludo legacy');
        assert.doesNotMatch(await panel.innerText(), /Vista de diseño|sin cambios en datos reales|prototipo/i);
        const desktop = await panel.boundingBox();
        assert.ok(desktop.width >= 450 && desktop.width <= 487, `ancho Sites: ${desktop.width}`);

        const input = page.locator('#haiku-asistente-texto');
        const send = page.locator('#haiku-asistente-enviar');
        const fileInput = page.locator('#haiku-asistente-archivos');
        await Promise.all([
            page.waitForEvent('filechooser'),
            welcome.locator('[data-haiku-accion-rapida="revisar-captura"]').click()
        ]);
        assert.equal(await fileInput.getAttribute('accept'), 'image/png,image/jpeg,image/webp');
        await welcome.locator('[data-haiku-accion-rapida="preparar-reserva"]').click();
        assert.match(await input.inputValue(), /prepara una nueva reserva/i);
        assert.equal((await page.evaluate(() => window.__calls)).length, 0, 'preparar no crea datos ni envía solo');
        await page.locator('#haiku-asistente-rapidas summary').click();
        await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('#haiku-asistente-rapidas [data-haiku-accion-rapida="consultar-documento"]').click()
        ]);
        assert.equal(await fileInput.getAttribute('accept'), 'application/pdf');
        await page.locator('#haiku-asistente-rapidas summary').click();
        await page.locator('#haiku-asistente-rapidas [data-haiku-accion-rapida="tareas-hoy"]').click();
        await page.locator('.haku-dia-card').waitFor();
        assert.equal((await page.evaluate(() => window.__calls)).length, 0, 'Tareas de hoy usa el módulo operativo, no la Edge Function genérica');
        assert.equal((await page.evaluate(() => window.__rpcCalls.map(call => call.name))).includes('haiku_operacion_dia'), true);
        assert.match(await page.locator('.haku-dia-card').innerText(), /Resumen del día/);

        await page.locator('#haiku-asistente-cerrar').click();
        assert.equal(await panel.isVisible(), false, 'X cierra');
        await opener.click();
        await page.keyboard.press('Escape');
        assert.equal(await panel.isVisible(), false, 'Escape cierra');
        await opener.click();
        await overlay.click({ position: { x: 20, y: 20 } });
        assert.equal(await panel.isVisible(), false, 'overlay cierra');
        await opener.click();

        assert.match(await input.getAttribute('placeholder'), /Escribe una consulta o instrucción/);
        assert.equal(await send.isDisabled(), true);
        await input.fill('Necesito revisar esta reserva.');
        await send.click();
        const first = await takeCall(page);
        assert.equal(first.name, 'haiku-asistente-reserva', 'mismo flujo real de análisis');
        assert.equal(first.options.body.mensaje, 'Necesito revisar esta reserva.');
        assert.equal(await send.isDisabled(), true, 'sin segundo envío');
        await page.evaluate(() => document.getElementById('haiku-asistente-enviar').click());
        assert.equal((await page.evaluate(() => window.__calls)).length, 1);
        assert.match(await messages.innerText(), /Analizando/);
        await finishCall(page, { data: null, error: { message: 'Error de prueba' } });
        assert.match(await messages.innerText(), /Error de prueba/);
        assert.equal(await welcome.isVisible(), false, 'la bienvenida deja lugar al chat real');

        assert.match(read('js/supabase-asistente-v1.js'), /image\/png,image\/jpeg,image\/webp,application\/pdf/);
        await fileInput.setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
        assert.equal((await page.evaluate(() => window.HAIKU_ASISTENTE.adjuntos())).length, 1);
        assert.equal(await page.locator('.haiku-asistente-adjunto img').count(), 1);
        await page.locator('.haiku-asistente-quitar').click();
        assert.equal((await page.evaluate(() => window.HAIKU_ASISTENTE.adjuntos())).length, 0);

        await page.evaluate(() => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'pegada.png', { type: 'image/png' }));
            const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
            document.getElementById('haiku-asistente-texto').dispatchEvent(event);
            window.__pastePrevented = event.defaultPrevented;
        });
        assert.equal(await page.evaluate(() => window.__pastePrevented), true);
        assert.equal((await page.evaluate(() => window.HAIKU_ASISTENTE.adjuntos()))[0].nombre, 'pegada.png');
        await page.locator('.haiku-asistente-quitar').click();

        await fileInput.setInputFiles({ name: 'documento.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
        assert.match(await page.locator('.haiku-asistente-adjunto').innerText(), /PDF\s+documento\.pdf/);
        assert.equal((await page.evaluate(() => window.HAIKU_ASISTENTE.adjuntos()))[0].tipo, 'application/pdf');
        await page.evaluate(() => {
            window.__pdfCalls = [];
            window.HAIKU_CLOUDBEDS_PDF_V1 = {
                async leerPDF(buffer) { window.__pdfCalls.push(['leer', buffer.byteLength]); return [{ id: 'ejemplo' }]; },
                async consultar(rows) { window.__pdfCalls.push(['consultar', rows.length]); return { ok: true }; },
                renderizar() { return '<p>Informe PDF de prueba · sólo lectura</p>'; }
            };
        });
        const beforePdf = (await page.evaluate(() => window.__calls)).length;
        await send.click();
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').textContent.includes('Informe PDF de prueba'));
        assert.deepEqual((await page.evaluate(() => window.__pdfCalls.map(call => call[0]))), ['leer', 'consultar']);
        assert.equal((await page.evaluate(() => window.__calls)).length, beforePdf, 'PDF conserva ruta de sólo lectura');

        await input.fill('Prepara esta reserva para revisión.');
        await send.click();
        await takeCall(page);
        await finishCall(page, { data: samplePreview(), error: null });
        const preview = messages.locator('.haiku-asistente-preview').last();
        assert.equal(await preview.count(), 1);
        assert.match(await preview.innerText(), /NADA GUARDADO|Nada guardado/);
        assert.equal((await page.evaluate(() => window.__rpcCalls.filter(call => call.name !== 'haiku_operacion_dia'))).length, 0, 'propuesta sola no escribe');
        const confirm = preview.locator('.haiku-asistente-preview-pie button');
        assert.equal(await confirm.isDisabled(), false);
        await confirm.click();
        assert.equal((await page.evaluate(() => window.__rpcCalls.filter(call => call.name !== 'haiku_operacion_dia'))).length, 0, 'cancelar confirmación no escribe');
        await page.evaluate(() => { window.__confirm = true; });
        await confirm.click();
        await page.waitForFunction(() => window.__rpcCalls.some(call => call.name === 'haiku_crear_reserva'));
        assert.deepEqual((await page.evaluate(() => window.__rpcCalls.filter(call => call.name !== 'haiku_operacion_dia').map(call => call.name))).slice(0, 2),
            ['haiku_cabanas_disponibles', 'haiku_crear_reserva']);
        assert.match(await preview.innerText(), /RESERVA CREADA|Reserva creada/);

        await page.evaluate(() => window.HAIKU_ASISTENTE_HISTORIAL_V1.guardar());
        await page.reload();
        await install(page);
        await opener.click();
        assert.match(await messages.innerText(), /Necesito revisar esta reserva/);
        assert.equal(await welcome.isVisible(), false, 'el historial restaurado reemplaza la bienvenida');
        assert.equal(await preview.locator('button:not([disabled])').count(), 0, 'propuesta histórica sin acciones activas');
        await page.evaluate(() => { window.__confirm = false; });
        await page.locator('#haiku-asistente-borrar-historial').click();
        assert.match(await messages.innerText(), /Necesito revisar esta reserva/, 'cancelar borrado conserva mensajes');
        await page.evaluate(() => { window.__confirm = true; });
        await page.locator('#haiku-asistente-borrar-historial').click();
        assert.equal(await messages.locator('.haiku-asistente-mensaje').count(), 0);
        assert.equal(await welcome.isVisible(), true);

        await page.setViewportSize({ width: 390, height: 844 });
        const mobile = await panel.boundingBox();
        assert.ok(mobile.width <= 391 && mobile.width >= 370, `ancho móvil: ${mobile.width}`);
        assert.equal(await input.isVisible(), true);
        assert.equal(await page.locator('#haiku-asistente-adjuntar').isVisible(), true);
        const clearFits = await page.evaluate(() => {
            const clear = document.getElementById('haiku-asistente-borrar-historial');
            return clear.textContent === 'Borrar historial' && clear.scrollWidth <= clear.clientWidth;
        });
        assert.equal(clearFits, true, 'Borrar historial completo en móvil');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
        await page.evaluate(() => {
            const key = `haiku_asistente_historial_v1::${location.pathname}`;
            sessionStorage.setItem(key, JSON.stringify({ version: 1, html: '\n<div class="haiku-asistente-mensaje haiku-asistente-mensaje--asistente">Hola, soy Haku. Envíame capturas.</div>\n<div class="haiku-asistente-mensaje haiku-asistente-mensaje--usuario">Consulta conservada</div>' }));
        });
        await page.reload();
        await install(page);
        await opener.click();
        assert.match(await messages.innerText(), /Consulta conservada/, 'migra conversación legacy existente');
        assert.doesNotMatch(await messages.innerText(), /Hola, soy Haku/, 'quita sólo el saludo visual legacy');
        assert.equal(await welcome.isVisible(), false);
        await page.evaluate(() => {
            const key = `haiku_asistente_historial_v1::${location.pathname}`;
            sessionStorage.setItem(key, JSON.stringify({ version: 1, html: '\n<div class="haiku-asistente-mensaje haiku-asistente-mensaje--asistente">Hola, soy Haku. Envíame capturas.</div>\n' }));
            document.getElementById('haiku-asistente-mensajes').replaceChildren();
        });
        await page.reload();
        await install(page);
        await opener.click();
        assert.equal(await welcome.isVisible(), true, 'historial antiguo con sólo saludo muestra bienvenida Sites');
        assert.equal(errors.length, 0, errors.join('\n'));
        console.log('Haku Sites: drawer, bienvenida, chat, error, adjuntos, propuesta, historial y móvil OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
