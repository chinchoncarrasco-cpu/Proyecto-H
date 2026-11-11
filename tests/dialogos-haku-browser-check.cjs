// Interfaz real, todos los estilos del panel y datos sintéticos. Sin servicios externos.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { chromium } = require('playwright');
const root = path.join(__dirname, '..'), out = process.env.HAIKU_DIALOGOS_OUTPUT || '/tmp/haku-dialogos-capturas';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const styles = [...read('index.html').matchAll(/<link[^>]+href="(css\/[^"?]+)(?:\?[^"]*)?"[^>]*>/g)].map(m => `<link rel="stylesheet" href="/${m[1]}">`).join('');
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}
<style>body{margin:0;min-height:100vh;background:var(--haku-compacto-control);color:var(--haku-compacto-texto);font:14px Inter,Arial,sans-serif}
.fixture{padding:24px;display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:24px}.fixture header{display:flex;justify-content:space-between;align-items:center;gap:12px}
.fixture aside,.fixture main{padding:20px;border:1px solid var(--haku-compacto-borde);border-radius:8px;background:var(--haku-compacto-superficie)}
.fixture button{font:inherit;padding:8px 12px;color:inherit;background:var(--haku-compacto-control);border:1px solid var(--haku-compacto-borde);border-radius:6px}
.fixture article{padding:16px 0;border-bottom:1px solid var(--haku-compacto-borde)}.fixture small{color:var(--haku-compacto-secundario)}
@media(max-width:600px){.fixture{padding:12px;display:block}.fixture main{display:none}.fixture aside{padding:12px}}
</style></head><body><div class="fixture"><main><header><strong>H A I K U</strong><span>Operación / Proyecto H</span></header><h1>Cabañas</h1>
<article>Cabaña 1 · Sin reserva</article><article>Cabaña 2 · Sin reserva</article><article>Cabaña 3 · Sin reserva</article></main>
<aside id="haiku-asistente-panel"><header class="haiku-asistente-cabecera"><div><strong>Haku</strong><br><small>Asistente operativo</small></div><button id="haiku-asistente-cerrar">×</button></header>
<div id="haiku-asistente-mensajes"><p>Hola. ¿En qué te ayudo?</p></div></aside></div>
<button id="origen" style="margin:24px">Abrir operación</button><form id="pago" style="margin:24px"><label for="bove">BOVE</label><input id="bove" name="bove" aria-describedby="ayuda"><span id="ayuda">Número de boleta</span><button type="button" id="guardar">Guardar</button></form>
<script src="/js/haiku-dialogos-v1.js"></script><script src="/js/supabase-asistente-historial-v1.js"></script></body></html>`;
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
    if (!/^\/(?:css|js)\/[a-zA-Z0-9_.-]+$/.test(pathname)) { res.statusCode = 404; return res.end(); }
    const file = path.join(root, pathname);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'application/javascript'); res.end(fs.readFileSync(file));
});
(async () => {
    fs.mkdirSync(out, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    const errors = [], native = [], report = []; let page;
    try {
        page = await browser.newPage();
        page.on('pageerror', e => errors.push(e.message));
        page.on('dialog', d => { native.push(d.type()); d.dismiss(); });
        await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
        const open = async (api, args) => {
            await page.locator('#origen').focus();
            await page.evaluate(({ api, args }) => { window.resultado = 'pendiente'; window.HAIKU_DIALOGOS[api](...args).then(r => { window.resultado = r; }); }, { api, args });
            await page.locator('.hk-dialogo[open]').waitFor();
        };
        const cancel = async () => { await page.keyboard.press('Escape'); assert.equal(await page.locator('.hk-dialogo').count(), 0); };
        const checkBounds = async () => {
            const rect = await page.locator('.hk-dialogo').boundingBox(), size = page.viewportSize();
            assert.ok(rect.x >= 15 && rect.y >= 15 && rect.x + rect.width <= size.width - 15 && rect.y + rect.height <= size.height - 15, JSON.stringify({ rect, size }));
            assert.equal(await page.locator('.hk-dialogo').evaluate(n => n.scrollWidth <= n.clientWidth), true);
            assert.equal(await page.locator('.hk-dialogo button[type=submit]').isVisible(), true);
        };
        for (const tema of ['claro', 'oscuro']) for (const width of [1440, 390, 320]) {
            await page.setViewportSize({ width, height: 900 }); await page.goto(origin);
            await page.evaluate(tema => {
                document.documentElement.dataset.haikuTema = tema;
                window.haikuSesion = { auth: { id: 'usuario-sintetico' } };
                localStorage.setItem('reserva-sintetica', 'intacta');
                document.getElementById('haiku-asistente-mensajes').innerHTML = '<article>1 cambio en el Libro<br><small>1 agregada · 0 modificadas</small></article>';
                window.HAIKU_ASISTENTE_HISTORIAL_V1.guardar();
            }, tema);
            const before = await page.locator('#haiku-asistente-mensajes').innerHTML();
            await page.locator('#haiku-asistente-borrar-historial').click(); await checkBounds();
            assert.equal(await page.locator('.hk-dialogo h2').textContent(), '¿Borrar esta conversación?');
            assert.equal(await page.locator('.hk-dialogo').evaluate(n => getComputedStyle(n).backgroundColor), tema === 'claro' ? 'rgb(251, 252, 251)' : 'rgb(27, 38, 33)');
            assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Conservar');
            for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => !!document.activeElement.closest('.hk-dialogo')), true); }
            await page.screenshot({ path: path.join(out, `historial-${tema}-${width}.png`) });
            await page.getByRole('button', { name: 'Conservar', exact: true }).click();
            assert.equal(await page.locator('#haiku-asistente-mensajes').innerHTML(), before);
            assert.equal(await page.evaluate(() => document.activeElement.id), 'haiku-asistente-borrar-historial');
            await page.locator('#haiku-asistente-borrar-historial').click(); await cancel();
            assert.equal(await page.locator('#haiku-asistente-mensajes').innerHTML(), before);
            await page.locator('#haiku-asistente-borrar-historial').click();
            await page.getByRole('button', { name: 'Borrar conversación', exact: true }).click();
            assert.match(await page.locator('#haiku-asistente-mensajes').textContent(), /Hola/);
            assert.equal(await page.evaluate(() => localStorage.getItem('reserva-sintetica')), 'intacta');

            await open('ocupacion', [{ adultos: 2, ninos: 0, mascotas: 1 }, 5, 'Reserva · CAB 2']); await checkBounds();
            await page.screenshot({ path: path.join(out, `ocupacion-${tema}-${width}.png`) });
            await page.getByLabel('Adultos', { exact: true }).fill('0'); await page.getByRole('button', { name: 'Guardar ocupación' }).click();
            assert.equal(await page.getByLabel('Adultos', { exact: true }).getAttribute('aria-invalid'), 'true');
            await page.getByLabel('Adultos', { exact: true }).fill('4'); await page.getByLabel('Niños', { exact: true }).fill('2');
            await page.getByRole('button', { name: 'Guardar ocupación' }).click(); assert.equal(await page.locator('.hk-dialogo[open]').count(), 1);
            assert.match(await page.locator('.hk-dialogo').textContent(), /máximo de 5/);
            await page.getByLabel('Niños', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Guardar ocupación' }).click();
            assert.deepEqual(await page.evaluate(() => resultado), { adultos: '4', ninos: '1', mascotas: '1' });

            await open('confirmar', ['Registrar pagos', { titulo: 'Registrar pagos', cuerpo: '', contexto: 'Haku · Pagos', accion: 'Registrar pagos', resumen: [['Pagos', 3], ['Reservas', 2], ['Total', '$120.000']], aviso: 'El lote se guarda completo o no se guarda nada.' }]);
            await checkBounds(); await page.screenshot({ path: path.join(out, `pagos-${tema}-${width}.png`) }); await cancel();
            await open('solicitar', ['Motivo de reapertura del cierre:', '']);
            await page.getByRole('button', { name: 'Reabrir cierre' }).click(); assert.equal(await page.locator('.hk-dialogo[open]').count(), 1);
            await page.getByLabel('Motivo de reapertura').fill('Corrección de un dato');
            await page.screenshot({ path: path.join(out, `reapertura-${tema}-${width}.png`) });
            await page.getByRole('button', { name: 'Reabrir cierre' }).click(); assert.equal(await page.evaluate(() => resultado), 'Corrección de un dato');

            await page.locator('#guardar').focus();
            await page.evaluate(() => { HAIKU_DIALOGOS.aviso('Ingresa el número de BOVE.'); HAIKU_DIALOGOS.aviso('Revisa el BOVE antes de guardar.'); });
            assert.equal(await page.locator('.hk-validacion').count(), 1);
            assert.equal((await page.locator('#bove').getAttribute('aria-describedby')).split(' ').length, 2);
            await page.screenshot({ path: path.join(out, `validacion-${tema}-${width}.png`) });
            await page.locator('#bove').fill('101'); assert.equal(await page.locator('.hk-validacion').count(), 0);
            assert.equal(await page.locator('#bove').getAttribute('aria-describedby'), 'ayuda');
            assert.equal(await page.locator('#bove').getAttribute('aria-invalid'), null);
            report.push({ tema, width, historial: 'cancelar/escape/aceptar', ocupacion: 'rango/capacidad', pagos: 'resumen', reapertura: 'motivo requerido', validacion: 'contextual' });
        }
        await page.setViewportSize({ width: 390, height: 420 });
        await open('solicitar', ['Tu navegador no permitió leer el portapapeles. Pega aquí:', 'Texto largo\n'.repeat(70)]);
        await checkBounds(); await page.screenshot({ path: path.join(out, 'teclado-altura-reducida.png') }); await cancel();
        await open('confirmar', ['<img src=x onerror=alert(1)>', { titulo: '<script>sin ejecutar</script>', accion: 'Aplicar' }]);
        assert.equal(await page.locator('.hk-dialogo img,.hk-dialogo script').count(), 0);
        assert.equal(await page.evaluate(() => HAIKU_DIALOGOS.confirmar('Otra operación')), false);
        await page.getByRole('button', { name: 'Aplicar', exact: true }).click(); assert.equal(await page.evaluate(() => resultado), true);
        await open('confirmar', ['Operación privada']);
        await page.evaluate(() => { document.documentElement.classList.add('haiku-privacidad-bloqueada'); dispatchEvent(new CustomEvent('haiku:privacidad-cambio', { detail: { bloqueada: true } })); });
        assert.equal(await page.evaluate(() => resultado), false); assert.equal(await page.locator('.hk-dialogo').count(), 0);
        assert.equal(await page.evaluate(() => HAIKU_DIALOGOS.confirmar('Bloqueada')), false);
        await page.evaluate(() => document.documentElement.classList.remove('haiku-privacidad-bloqueada'));
        await page.evaluate(() => {
            const card = document.createElement('div'); card.className = 'haiku-bove-cierre';
            card.innerHTML = '<label>BOVE<input data-haiku-bove-total></label><button id="bove-real">Registrar BOVE</button>';
            document.body.append(card); card.querySelector('button').focus();
            HAIKU_DIALOGOS.aviso('Ingresa el BOVE del alojamiento.');
        });
        assert.equal(await page.locator('[data-haiku-bove-total]').getAttribute('aria-invalid'), 'true');
        await page.locator('[data-haiku-bove-total]').fill('202');
        await page.evaluate(() => HAIKU_DIALOGOS.aviso('Cabaña liberada. Ya no bloquea una nueva venta.', { tipo: 'exito' }));
        assert.equal(await page.locator('#hk-avisos .hk-aviso.exito[role=status]').count(), 1);
        await open('confirmar', ['Otra sesión']);
        await page.evaluate(() => { window.haikuSesion.auth.id = 'otro-usuario'; dispatchEvent(new Event('haiku:auth-ready')); });
        assert.equal(await page.evaluate(() => resultado), false);
        assert.deepEqual(errors, []); assert.deepEqual(native, []);
        fs.writeFileSync(path.join(out, 'resultados.json'), JSON.stringify({ report, errores: errors, ventanasNativas: native }, null, 2));
        console.log('Diálogos Haku: seis combinaciones de tema/ancho, foco, decisiones, formularios, avisos y privacidad correctos.');
    } catch (error) {
        await page?.screenshot({ path: path.join(out, 'fallo.png'), fullPage: true });
        fs.writeFileSync(path.join(out, 'fallo.json'), JSON.stringify({ error: String(error), errors, native, report }, null, 2));
        throw error;
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
