// Aceptación de la demo servida por HTTP real, aislada de cualquier red externa.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { crearServidor } = require('./reserva-estado-manual-localhost.cjs');
const estados = require('../js/haiku-reserva-estado-manual-v1.js').estados;

(async () => {
    const servidor = crearServidor();
    servidor.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const base = `http://127.0.0.1:${servidor.address().port}`;
    let browser, checks = 0;
    try {
        const respuesta = await fetch(base);
        assert.equal(respuesta.status, 200);
        assert.match(respuesta.headers.get('content-security-policy'), /connect-src 'none'/); checks++;
        for (const ruta of ['/js/supabase-client.js', '/js/supabase-auth.js', '/panel.html', '/index.html',
            '/supabase/config.toml', '/.env', '/rest/v1/reservas']) {
            assert.equal((await fetch(base + ruta)).status, 404); checks++;
        }
        assert.equal((await fetch(base + '/', { method: 'POST', body: 'ficticio' })).status, 405); checks++;
        browser = await chromium.launch({
            executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true
        });
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
            const page = await browser.newPage({ viewport });
            const errors = [], externos = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', route => {
                if (new URL(route.request().url()).origin === base) return route.continue();
                externos.push(route.request().url()); return route.abort();
            });
            await page.goto(base);
            await page.waitForFunction(() => window.__reservaEstadoDemoLista);
            assert.equal(await page.evaluate(() => typeof window.supabase), 'undefined'); checks++;
            await page.locator('#demo-abrir').click();
            const badge = page.locator('[data-reserva-estado-operativo]');
            const menu = page.locator('[data-reserva-estado-menu]');
            const confirm = page.locator('[data-reserva-estado-confirmacion]');
            assert.equal(await badge.innerText(), 'Confirmada'); checks++;
            const contenido = await page.locator('[data-reserva-contenido]').innerText();
            for (const texto of ['Familia TEST', 'Acompañante TEST', 'Tinaja TEST', 'Desayuno TEST', 'Nota ficticia', '$222.000']) {
                assert.ok(contenido.includes(texto), texto); checks++;
            }
            await badge.click();
            assert.equal(await menu.locator('button').count(), 6); checks++;
            for (const e of estados) assert.ok((await menu.innerText()).includes(e.etiqueta)); checks++;
            await page.screenshot({ path: path.join(os.tmpdir(), `haiku-reserva-demo-${viewport.width}-selector.png`), fullPage: true });
            // Los destinos con confirmación no cambian el badge al seleccionarlos.
            await menu.locator('[data-reserva-nuevo-estado="cancelada"]').click();
            assert.equal(await confirm.isVisible(), true); checks++;
            assert.match(await confirm.innerText(), /Confirmada → Cancelada/); checks++;
            assert.equal(await badge.innerText(), 'Confirmada');
            assert.equal(await page.locator('[data-demo-contador]').innerText(), '0 cambios simulados'); checks++;
            await page.locator('[data-reserva-estado-cancelar]').click();
            assert.equal(await confirm.isVisible(), false);
            assert.equal(await badge.innerText(), 'Confirmada'); checks++;
            await badge.click(); await menu.locator('[data-reserva-nuevo-estado="no_show"]').click();
            await page.keyboard.press('Escape');
            assert.equal(await confirm.isVisible(), false);
            assert.equal(await badge.innerText(), 'Confirmada'); checks++;
            // Todos los destinos, incluidos los terminales, son recorribles sólo
            // en esta demo. El drawer y su confirmación siguen siendo los reales.
            let anterior = 'Confirmada';
            for (const [i, valor] of ['pendiente', 'hospedada', 'checked_out', 'cancelada', 'no_show', 'confirmada'].entries()) {
                const nuevo = estados.find(e => e.valor === valor).etiqueta;
                await badge.click(); await menu.locator(`[data-reserva-nuevo-estado="${valor}"]`).click();
                if (['hospedada', 'checked_out'].includes(valor)) {
                    assert.equal(await confirm.isVisible(), false); checks++;
                    assert.equal(await menu.isVisible(), false); checks++;
                } else {
                    assert.equal(await confirm.isVisible(), true); checks++;
                    assert.match(await page.locator('[data-reserva-estado-mensaje]').innerText(), new RegExp(`${anterior} → ${nuevo}`)); checks++;
                    assert.equal(await badge.innerText(), anterior); checks++;
                    const caja = await confirm.boundingBox();
                    assert.ok(caja.x >= 0 && caja.x + caja.width <= viewport.width); checks++;
                    if (i === 0) await page.screenshot({ path: path.join(os.tmpdir(), `haiku-reserva-demo-${viewport.width}-confirmacion.png`), fullPage: true });
                    await page.locator('[data-reserva-estado-confirmar]').click();
                }
                await page.waitForFunction(nuevo => document.querySelector('[data-reserva-estado-operativo]').textContent === nuevo &&
                    document.querySelector('[data-reserva-estado-confirmacion]').hidden, nuevo);
                assert.equal(await page.locator('[data-demo-badge]').innerText(), nuevo);
                assert.equal(await page.locator('[data-demo-log] li').count(), i + 1); checks++;
                assert.match(await page.locator('.demo-drawer-notice').innerText(), /Confirmación simulada en memoria/); checks++;
                anterior = nuevo;
            }
            await page.locator('[data-reserva-cerrar]').click();
            await page.locator('#demo-abrir').click();
            assert.equal(await badge.innerText(), 'Confirmada');
            assert.equal(await page.locator('[data-demo-log] li').count(), 6); checks++;
            await page.locator('[data-reserva-cerrar]').click(); await page.locator('#demo-reiniciar').click();
            assert.equal(await page.locator('[data-demo-contador]').innerText(), '0 cambios simulados'); checks++;
            await page.locator('#demo-abrir').click(); await badge.click();
            await menu.locator('[data-reserva-nuevo-estado="hospedada"]').click();
            assert.equal(await confirm.isVisible(), false); checks++;
            await page.waitForFunction(() => document.querySelector('[data-demo-badge]').textContent === 'Hospedado');
            await page.reload(); await page.waitForFunction(() => window.__reservaEstadoDemoLista);
            assert.equal(await page.locator('[data-demo-badge]').innerText(), 'Confirmada');
            assert.equal(await page.locator('[data-demo-contador]').innerText(), '0 cambios simulados'); checks++;
            assert.equal(await page.evaluate(() => localStorage.length), 0); checks++;
            assert.deepEqual(errors, []); assert.deepEqual(externos, []); checks++;
            await page.close();
        }
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.goto(base + '/movil');
        const frame = page.frameLocator('iframe');
        await frame.locator('#demo-abrir').click();
        assert.equal(await frame.locator('[data-reserva-estado-operativo]').innerText(), 'Confirmada'); checks++;
        assert.equal(await page.locator('iframe').evaluate(e => e.contentWindow.innerWidth), 390); checks++;
        await page.screenshot({ path: path.join(os.tmpdir(), 'haiku-reserva-demo-vista-movil.png'), fullPage: true });
        console.log(`PASS: ${checks} comprobaciones demo HTTP + Edge escritorio/móvil. Sin SDK ni red externa.`);
        console.log(`Capturas: ${path.join(os.tmpdir(), 'haiku-reserva-demo-*.png')}`);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => servidor.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
