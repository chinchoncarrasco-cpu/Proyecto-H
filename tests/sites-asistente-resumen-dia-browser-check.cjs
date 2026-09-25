// Contrato de la vista Sites del resumen operativo. Todas las fuentes son simuladas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/sites-shell-v1.css"><link rel="stylesheet" href="/css/supabase-asistente-v1.css"><link rel="stylesheet" href="/css/sites-asistente-v1.css"></head><body><main style="height:3000px">Página de fondo</main></body></html>');
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try { response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(fs.readFileSync(file)); }
    catch { response.writeHead(404).end(); }
});

async function setup(page) {
    await page.addInitScript(() => {
        window.haikuSesion = { usuario: { id: 'resumen-test' } };
        window.__lecturas = [];
        window.__datos = { operacion: [], servicios: [], pagos: [] };
        window.haikuSupabase = {
            auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
            rpc(nombre, parametros) {
                window.__lecturas.push({ nombre, parametros });
                return Promise.resolve({ data: window.__datos.operacion, error: null });
            }
        };
        window.HAIKU_SERVICIOS_HIDRATACION_V2 = { async sincronizar() { window.__lecturas.push({ nombre: 'hidratar-servicios' }); } };
        window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1 = {
            async refrescar(fecha) { window.__lecturas.push({ nombre: 'refrescar-pagos', fecha }); },
            obtener(fecha) { window.__lecturas.push({ nombre: 'obtener-pagos', fecha }); return window.__datos.pagos; }
        };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ content: read('js/supabase-asistente-v1.js') });
    await page.addScriptTag({ content: read('js/supabase-asistente-resumen-dia-v1.js') });
    await page.locator('#haiku-asistente-boton').click();
}

async function consultar(page, texto, datos) {
    await page.evaluate(datosActuales => {
        window.__datos = datosActuales;
        localStorage.setItem('haikuServicios', JSON.stringify(datosActuales.servicios));
    }, datos);
    const previos = await page.locator('.haku-dia-sites').count();
    await page.locator('#haiku-asistente-texto').fill(texto);
    await page.locator('#haiku-asistente-enviar').click();
    await page.waitForFunction(anterior => document.querySelectorAll('.haku-dia-sites').length > anterior, previos);
    return page.locator('.haku-dia-sites').last();
}

const fila = (numero, tipo) => ({
    numero,
    ...(tipo === 'ingreso' ? { ingreso_estadia_id: `i-${numero}`, ingreso_titular: `Titular ${numero}` } : {}),
    ...(tipo === 'salida' ? { salida_estadia_id: `s-${numero}`, salida_titular: `Titular ${numero}` } : {}),
    ...(tipo === 'continua' ? { continua_estadia_id: `c-${numero}`, continua_titular: `Titular ${numero}` } : {})
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errores = [];
        page.on('pageerror', error => errores.push(error.message));
        await setup(page);
        const fecha = '2026-09-12';
        const datos = {
            operacion: [fila(4, 'ingreso'), fila(2, 'salida'), fila(3, 'continua')],
            servicios: [
                { fechaServicio: fecha, numeroCabana: 5, titular: 'Servicio real', nombre: 'Masaje', hora: '17:00', estadoServicio: 'pendiente' },
                { fechaServicio: fecha, numeroCabana: 6, titular: 'Cancelado', nombre: 'Tinaja', hora: '18:00', estadoServicio: 'cancelado' },
                { fechaServicio: fecha, numeroCabana: 7, titular: 'No show', nombre: 'Jacuzzi', hora: '19:00', estadoServicio: 'no_show' }
            ],
            pagos: [{ numeroCabana: 4, titular: 'Titular 4', titulo: 'Cobro check-in pendiente', monto: 16000 }]
        };
        const vista = await consultar(page, 'Haku, resumen del día 12 de septiembre de 2026', datos);
        assert.equal(await vista.locator('.haku-dia-sites__mensaje-usuario').innerText(), 'Haku, resumen del día 12 de septiembre de 2026');
        assert.equal(await page.locator('#haiku-asistente-titulo').innerText(), 'Resumen del día');
        assert.equal(await page.locator('.haiku-asistente-titulo span').innerText(), 'HAKU · ASISTENTE OPERATIVO');
        assert.equal(await page.locator('.haku-dia-sites__cabecera-chip').innerText(), 'Solo lectura');
        assert.equal(await vista.locator('.haku-dia-sites__fecha').innerText(), '12-09-2026');
        assert.deepEqual(await vista.locator('.haku-dia-sites__valor').allInnerTexts(), ['1', '1', '1', '1', '1']);
        assert.deepEqual(await vista.locator('.haku-dia-sites__seccion-titulo > span:first-child').allTextContents(), ['Ingresan', 'Salen', 'Continúan', 'Servicios', 'Pagos pendientes']);
        assert.match(await vista.innerText(), /CAB 4\s+Titular 4\s+Ingreso\s+Por ingresar/);
        assert.match(await vista.innerText(), /CAB 2\s+Titular 2\s+Salida\s+Por salir/);
        assert.match(await vista.innerText(), /CAB 3\s+Titular 3\s+Continúa\s+En estadía/);
        assert.match(await vista.innerText(), /CAB 5\s+Servicio real\s+17:00 · Masaje/);
        assert.doesNotMatch(await vista.innerText(), /Cancelado|No show/);
        assert.match(await vista.innerText(), /Cobro check-in pendiente\s+\$16\.000/);
        assert.match(await vista.locator('.haku-dia-sites__alerta').innerText(), /1 pago pendiente.*\$16\.000/);
        assert.deepEqual((await page.evaluate(() => window.__lecturas)).filter(x => x.nombre === 'haiku_operacion_dia').map(x => x.parametros.p_fecha), [fecha]);
        assert.equal(await page.locator('#haku-resumen-dia-v1-css').count(), 0, 'sin CSS legacy inyectado');
        assert.equal(await vista.locator('.haku-dia-sites__tarjeta').count(), 1, 'Sites desde el primer render');
        assert.doesNotMatch(await vista.innerText(), /Vista visual|En Haku real|datos de muestra|prototipo|demostración/i);
        assert.match(await vista.locator('.haku-dia-sites__pie').innerText(), /esta consulta no modificó/);
        await page.screenshot({ path: path.join(os.tmpdir(), 'haku-resumen-dia-sites-desktop.png') });

        const vacio = await consultar(page, 'Haku, resumen del día 13 de septiembre de 2026', { operacion: [fila(2, 'salida')], servicios: [], pagos: [] });
        assert.deepEqual(await vacio.locator('.haku-dia-sites__valor').allInnerTexts(), ['0', '1', '0', '0', '0']);
        assert.deepEqual(await vacio.locator('.haku-dia-sites__seccion-titulo > span:first-child').allTextContents(), ['Salen']);
        assert.equal(await vacio.locator('.haku-dia-sites__alerta').count(), 0);

        const muchos = Array.from({ length: 35 }, (_, i) => fila(i + 1, 'ingreso'));
        const largo = await consultar(page, 'Haku, resumen del día 14 de septiembre de 2026', { operacion: muchos, servicios: [], pagos: [] });
        const area = page.locator('#haiku-asistente-mensajes');
        const scroll = await page.evaluate(() => {
            const el = document.getElementById('haiku-asistente-mensajes');
            const lista = document.querySelector('.haku-dia-sites:last-child .haku-dia-sites__lista');
            return { overflow: getComputedStyle(el).overflowY, scrollbar: getComputedStyle(el).scrollbarWidth,
                listaOverflow: getComputedStyle(lista).overflowY, height: el.scrollHeight, client: el.clientHeight };
        });
        assert.equal(scroll.overflow, 'auto');
        assert.equal(scroll.scrollbar, 'none');
        assert.notEqual(scroll.listaOverflow, 'auto', 'sin scroll anidado en filas');
        assert.ok(scroll.height > scroll.client + 500);
        await area.evaluate(el => { el.scrollTop = 0; });
        const box = await area.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 560);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 100);
        assert.equal(await page.evaluate(() => window.scrollY), 0);
        await page.mouse.wheel(0, -560);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop < 100);
        assert.equal(await largo.locator('.haku-dia-sites__fila').count(), 35);

        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
        assert.equal(await largo.locator('.haku-dia-sites__metrica').count(), 5);
        assert.equal(await page.evaluate(() => {
            const card = document.querySelector('.haku-dia-sites:last-child .haku-dia-sites__tarjeta');
            return card.scrollWidth <= card.clientWidth + 1;
        }), true);
        await page.screenshot({ path: path.join(os.tmpdir(), 'haku-resumen-dia-sites.png') });
        await page.evaluate(() => document.getElementById('haiku-asistente-mensajes').appendChild(document.createElement('div')));
        await page.waitForFunction(() => document.getElementById('haiku-asistente-titulo').textContent === 'Haku');
        await page.evaluate(() => document.getElementById('haiku-asistente-mensajes').lastElementChild.remove());
        await page.waitForFunction(() => document.getElementById('haiku-asistente-titulo').textContent === 'Resumen del día');
        await page.locator('#haiku-asistente-cerrar').click();
        assert.equal(await page.locator('#haiku-asistente-panel').isVisible(), false);
        assert.deepEqual([...new Set((await page.evaluate(() => window.__lecturas)).map(x => x.nombre))].sort(),
            ['haiku_operacion_dia', 'hidratar-servicios', 'obtener-pagos', 'refrescar-pagos']);
        assert.equal(errores.length, 0, errores.join('\n'));

        const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        try {
            const paginaTactil = await movil.newPage();
            await setup(paginaTactil);
            await consultar(paginaTactil, 'Haku, resumen del día 14 de septiembre de 2026', { operacion: muchos, servicios: [], pagos: [] });
            const mensajesMovil = paginaTactil.locator('#haiku-asistente-mensajes');
            await mensajesMovil.evaluate(el => { el.scrollTop = 0; });
            const areaMovil = await mensajesMovil.boundingBox();
            const x = Math.round(areaMovil.x + areaMovil.width / 2);
            const y = Math.round(areaMovil.y + areaMovil.height * .78);
            const cdp = await movil.newCDPSession(paginaTactil);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (let paso = 1; paso <= 8; paso++) await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove', touchPoints: [{ x, y: y - paso * 45 }]
            });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await paginaTactil.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 20);
            assert.equal(await paginaTactil.evaluate(() => window.scrollY), 0);
        } finally { await movil.close(); }
        console.log('Resumen del día Sites: datos reales de consulta, métricas, filas, monto, estados vacíos, scroll, móvil y X OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
