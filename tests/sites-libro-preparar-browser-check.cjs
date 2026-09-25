// Evento real del botón Sites, incluido el informe restaurado desde historial.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const source = read('js/haiku-libro-consultas-v1.js').replace(
    'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })',
    'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion, renderizarComparacion })'
);
const query = 'Libro: compara las reservas de septiembre 2026 con Proyecto H';
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/supabase-asistente-v1.css"><link rel="stylesheet" href="/css/supabase-haku-reconciliacion-v1.css"><link rel="stylesheet" href="/css/sites-asistente-v1.css"></head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel"><header class="haiku-asistente-cabecera"><span>Haku</span><button id="haiku-asistente-cerrar" type="button">Cerrar</button></header><div id="haiku-asistente-mensajes" class="haiku-asistente-mensajes"></div><footer class="haiku-asistente-compositor">Acciones rápidas</footer></div></div></body></html>');
        return;
    }
    if (/^\/js\/haiku-libro-(historial-ui-fix|confirm-cancel-fix)-v1\.js$/.test(pathname)) {
        response.writeHead(200, { 'Content-Type': 'text/javascript' }).end('');
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
        const content = fs.readFileSync(file);
        response.writeHead(200, { 'Content-Type': pathname.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(content);
    }
    catch { response.writeHead(404).end(); }
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            window.__reads = 0;
            window.__authReads = 0;
            window.__rpc = 0;
            window.__blockRead = false;
            window.__failRead = false;
            window.__releaseRead = null;
            const book = { titular: 'Persona de prueba', rut_documento: '12345678-9', cabana: 2,
                fecha_checkin: '2026-09-12', fecha_checkout: '2026-09-13', tipo_estadia: 'alojamiento', noches: 1,
                pagos: [], pagos_sin_asociacion: [], servicios: [], advertencias: [],
                coordenadas_origen: { hoja: 'Sep26', celda: 'D20' } };
            window.HAIKU_LIBRO_RESERVA_V1 = {
                listo: async () => {}, estado: () => ({ cargado: true, generacion: 1, nombre: 'Libro de prueba.xlsx' }),
                listarHojas: () => ['Sep26'], consultarHoja: async () => ({ cobertura: { geometria: false }, reservas: [book], bloqueos: [], advertencias: [] })
            };
            window.haikuSupabase = {
                auth: { getSession: async () => { window.__authReads++; return { data: { session: { user: { id: 'test' } } } }; } },
                from() {
                    const builder = { select: () => builder, lte: () => builder, gte: () => builder,
                        in: () => builder, order: () => builder,
                        range: async () => {
                            window.__reads++;
                            if (window.__failRead) throw new Error('Error de lectura de Proyecto H');
                            if (window.__blockRead) await new Promise(resolve => { window.__releaseRead = resolve; });
                            return { data: [], error: null };
                        } };
                    return builder;
                },
                rpc() { window.__rpc++; throw new Error('La preparación no debe escribir'); }
            };
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.addScriptTag({ content: read('js/haiku-libro-semantica-v1.js') });
        await page.addScriptTag({ content: source });
        await page.addScriptTag({ content: read('js/supabase-asistente-historial-v1.js') });
        await page.evaluate(() => {
            window.__closed = 0;
            document.getElementById('haiku-asistente-cerrar').addEventListener('click', () => window.__closed++);
        });
        await page.evaluate(async texto => {
            const mensajes = document.getElementById('haiku-asistente-mensajes');
            const user = document.createElement('div');
            user.className = 'haiku-asistente-mensaje--usuario';
            user.textContent = texto;
            mensajes.append(user);
            const out = document.createElement('div');
            const result = await window.HAIKU_LIBRO_CONSULTAS.consultar(texto);
            window.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out, result);
            mensajes.append(out);
            window.__originalButton = out.querySelector('.haku-comparacion-sites-preparar');
            window.HAIKU_ASISTENTE_HISTORIAL_V1.guardar();
            window.HAIKU_ASISTENTE_HISTORIAL_V1.restaurar();
        }, query);
        const button = page.locator('.haku-comparacion-sites-preparar');
        assert.equal(await button.count(), 1);
        assert.equal(await page.evaluate(() => document.querySelector('.haku-comparacion-sites-preparar') === window.__originalButton), false,
            'el historial recrea un nodo sin sus listeners');
        assert.equal(await button.isEnabled(), true, 'la comparación restaurada con consulta vigente puede reanudarse');
        assert.equal(await button.getAttribute('aria-disabled'), null);
        const before = await page.evaluate(() => window.__authReads);
        await page.evaluate(() => { window.__blockRead = true; });
        await button.click();
        await page.waitForFunction(() => window.__releaseRead !== null);
        assert.equal(await button.isDisabled(), true, 'feedback inmediato y bloqueo de segundo clic');
        assert.equal(await button.innerText(), 'Preparando…');
        await button.dispatchEvent('click');
        assert.equal(await page.evaluate(() => window.__authReads), before + 1, 'doble clic no duplica la consulta');
        await page.evaluate(() => { window.__blockRead = false; window.__releaseRead(); });
        await page.waitForFunction(() => !document.querySelector('.haku-comparacion-sites-preparar'));
        assert.equal(await page.evaluate(() => window.__authReads), before + 2, 'una reconsulta y una preparación real');
        assert.equal(await page.evaluate(() => window.__rpc), 0, 'la preparación no escribe');
        assert.equal(await page.locator('.haku-incorporacion-sites-grupo').count(), 3, 'tres grupos Sites desde el primer render');
        assert.equal(await page.locator('.haku-incorporacion-sites-fila').count(), 9, 'ocho categorías y la información');
        assert.equal(await page.locator('.haku-incorporacion-sites-pie .libro-reserva-boton:not(.secundario)').isDisabled(), true);
        if (process.env.HAKU_INCORPORACION_SCREENSHOT) {
            await page.evaluate(() => { document.getElementById('haiku-asistente-mensajes').scrollTop = 0; });
            await page.screenshot({ path: process.env.HAKU_INCORPORACION_SCREENSHOT, fullPage: true });
        }
        for (const row of await page.locator('.haku-incorporacion-sites-fila').all()) {
            await row.locator('summary').first().click();
            assert.equal(await row.getAttribute('open'), '', 'cada acordeón abre');
            await row.locator('summary').first().click();
            assert.equal(await row.getAttribute('open'), null, 'cada acordeón cierra');
        }
        await page.locator('.haku-incorporacion-sites-cerrar').click();
        assert.equal(await page.evaluate(() => window.__closed), 1, 'X usa el cierre real de Haku');
        await page.locator('.haku-incorporacion-sites-pie .secundario').click();
        assert.equal(await page.locator('.haku-comparacion-sites').count(), 1, 'Volver usa el callback original');
        assert.equal(await page.evaluate(() => window.__rpc), 0, 'Volver no escribe');

        await page.evaluate(async texto => {
            const mensajes = document.getElementById('haiku-asistente-mensajes');
            mensajes.replaceChildren();
            const user = document.createElement('div');
            user.className = 'haiku-asistente-mensaje--usuario'; user.textContent = texto; mensajes.append(user);
            const out = document.createElement('div');
            const result = await window.HAIKU_LIBRO_CONSULTAS.consultar(texto);
            window.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out, result);
            mensajes.append(out);
            window.HAIKU_ASISTENTE_HISTORIAL_V1.guardar();
            window.HAIKU_ASISTENTE_HISTORIAL_V1.restaurar();
            window.__failRead = true;
        }, query);
        await button.click();
        await page.waitForFunction(() => document.querySelector('.haku-comparacion-sites')?.textContent.includes('Error de lectura de Proyecto H'));
        assert.equal(await button.isEnabled(), true, 'el error real se muestra y permite reintentar');
        await page.evaluate(() => { window.__failRead = false; });

        await page.evaluate(async texto => {
            const mensajes = document.getElementById('haiku-asistente-mensajes');
            mensajes.replaceChildren();
            const out = document.createElement('div');
            const result = await window.HAIKU_LIBRO_CONSULTAS.consultar(texto);
            window.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out, result);
            delete out.dataset.haikuLibroConsulta;
            mensajes.append(out);
            window.HAIKU_ASISTENTE_HISTORIAL_V1.guardar();
            window.HAIKU_ASISTENTE_HISTORIAL_V1.restaurar();
        }, query);
        assert.equal(await button.isDisabled(), true, 'sin consulta asociada no se prepara un informe viejo');
        assert.match(await page.locator('.haku-comparacion-sites').innerText(), /No hay una consulta del Libro asociada/);

        await page.evaluate(async texto => {
            const mensajes = document.getElementById('haiku-asistente-mensajes');
            mensajes.replaceChildren();
            const out = document.createElement('div');
            const result = await window.HAIKU_LIBRO_CONSULTAS.consultar(texto);
            window.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out, result);
            mensajes.append(out);
        }, query);
        const freshBefore = await page.evaluate(() => window.__authReads);
        assert.equal(await button.isEnabled(), true, 'el botón recién renderizado conserva su listener');
        await button.click();
        await page.waitForFunction(() => !document.querySelector('.haku-comparacion-sites-preparar'));
        assert.equal(await page.evaluate(() => window.__authReads), freshBefore + 1, 'el botón fresco llama una vez al handler de preparación');
        assert.deepEqual(errors, []);
        console.log('Preparar incorporación Sites: evento restaurado, handler real único, doble clic, error y condición disabled OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
