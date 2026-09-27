// Panel real, transporte simulado y red limitada a localhost.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { crearServidor } = require('./insumos-aseo-localhost.cjs');

(async () => {
    const servidor = crearServidor();
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/Santiago' });
        const errores = [];
        page.on('pageerror', error => errores.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        await page.goto(`http://127.0.0.1:${servidor.address().port}/panel.html`);
        await page.waitForFunction(() => window.__insumosDemoListo);
        await page.evaluate(async () => {
            const r = window.__insumosDemo;
            r.filas.movimientos_insumos.push(...['lena', 'carbon'].map(insumo => ({
                id: 'historico-' + insumo, fecha_operativa: fechaSeleccionada, cabana_id: 'cab-1', aseo_id: 'aseo-1',
                insumo, cantidad: insumo === 'carbon' ? 2 : null, origen: 'aseo', unidad: 'unidad'
            })));
            r.filas.movimientos_insumos_unidades.push({ id: 'saco-historico', movimiento_id: 'historico-lena', peso_kg: 17.5, version: 1 });
            await window.HAIKU_INSUMOS_ASEO_V1.hidratar(fechaSeleccionada);
        });
        await page.locator('[data-cb-open="1"]').first().click();
        const antes = await page.evaluate(() => JSON.stringify(obtenerDatosDia(fechaSeleccionada).cabanas[1]));
        const esperar = async (insumo, texto) => page.waitForFunction(({ insumo, texto }) =>
            document.querySelector(`[data-insumo-cantidad=${insumo}]`).textContent === texto &&
            document.getElementById('cabinsReplenishment').getAttribute('aria-busy') === 'false', { insumo, texto });
        assert.equal(await page.locator('[data-saco-destino]').inputValue(), '');
        assert.match(await page.locator('[data-sacos-lena]').textContent(), /17.5 kgSin especificar/);
        assert.equal(await page.locator('[data-carbon-destino=sin_especificar]').textContent(), '2');
        assert.equal(await page.locator('[data-insumo-destino=sin_especificar][data-insumo-delta="1"]').count(), 0);

        // No se registra un saco si el operador todavía no eligió destino.
        const escrituras = await page.evaluate(() => window.__insumosDemo.control.escrituras.length);
        await page.locator('[data-saco-peso]').fill('18');
        await page.locator('[data-saco-agregar]').click();
        assert.equal(await page.locator('[data-saco-destino]').evaluate(n => n.validity.valueMissing), true);
        assert.equal(await page.evaluate(() => window.__insumosDemo.control.escrituras.length), escrituras);
        for (const [destino, peso, total] of [['aseo_full', 18, '2 sacos · 35.5 kg'], ['aseo_express', 19, '3 sacos · 54.5 kg'], ['venta_huesped', 20, '4 sacos · 74.5 kg']]) {
            await page.locator('[data-saco-destino]').selectOption(destino);
            await page.locator('[data-saco-peso]').fill(String(peso));
            await page.locator('[data-saco-agregar]').click();
            await esperar('lena', total);
        }
        const lista = await page.locator('[data-sacos-lena]').textContent();
        for (const nombre of ['Sin especificar', 'Aseo Full', 'Aseo Express', 'Venta / compra huésped']) assert.ok(lista.includes(nombre));
        await page.locator('[data-saco-editar="saco-historico"]').click();
        await page.locator('[data-saco-editar-peso]').fill('17.8');
        await page.locator('[data-saco-guardar]').click();
        await esperar('lena', '4 sacos · 74.8 kg');
        assert.match(await page.locator('[data-sacos-lena]').textContent(), /17.8 kgSin especificar/);

        const cambiar = async (destino, delta, total) => {
            await page.locator(`[data-insumo-destino=${destino}][data-insumo-delta="${delta}"]`).click();
            await esperar('carbon', String(total));
        };
        await cambiar('aseo_full', 1, 3);
        await cambiar('aseo_express', 1, 4);
        await cambiar('venta_huesped', 1, 5);
        await cambiar('aseo_express', -1, 4);
        assert.equal(await page.locator('[data-insumo-destino=aseo_express][data-insumo-delta="-1"]').isDisabled(), true);
        assert.equal(await page.locator('[data-carbon-destino=venta_huesped]').textContent(), '1');
        await cambiar('sin_especificar', -1, 3);
        assert.equal(await page.locator('[data-carbon-destino=sin_especificar]').textContent(), '1');
        assert.equal(await page.evaluate(() => JSON.stringify(obtenerDatosDia(fechaSeleccionada).cabanas[1])), antes);

        // Realtime conserva la clasificación y el canal existente.
        await page.evaluate(async () => {
            await window.__insumosDemo.cliente.rpc('haiku_agregar_saco_lena_v2', {
                p_fecha: fechaSeleccionada, p_cabana_id: 'cab-1', p_unidad_id: 'saco-remoto-destino', p_peso_kg: 16, p_destino: 'aseo_express'
            });
        });
        await esperar('lena', '5 sacos · 90.8 kg');
        assert.equal(await page.evaluate(() => window.__insumosDemo.control.canales.filter(c => !c.removido).length), 1);
        assert.match(await page.locator('[data-sacos-lena] li').last().textContent(), /Aseo Express/);
        await page.locator('[data-saco-anular="saco-remoto-destino"]').click();
        await esperar('lena', '4 sacos · 74.8 kg');

        await page.reload(); await page.waitForFunction(() => window.__insumosDemoListo);
        assert.equal(await page.locator('[data-insumos-total=lena]').textContent(), '4 sacos · 74.8 kg');
        assert.equal(await page.locator('[data-insumos-total=carbon]').textContent(), '3 sacos');
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1100 });
            await page.evaluate(() => window.HAIKU_CABANAS_SITES_V1.cerrar());
            await page.locator('[data-insumos-destinos]').evaluate(n => { n.open = true; });
            assert.match(await page.locator('[data-insumos-desglose=lena]').textContent(), /Aseo Full: 1 saco.*Aseo Express: 1 saco.*Venta \/ compra huésped: 1 saco.*Sin especificar: 1 saco/);
            assert.match(await page.locator('[data-insumos-desglose=carbon]').textContent(), /Aseo Full: 1 saco.*Venta \/ compra huésped: 1 saco.*Sin especificar: 1 saco/);
            if (process.env.HAIKU_INSUMOS_SCREENSHOTS) {
                fs.mkdirSync(process.env.HAIKU_INSUMOS_SCREENSHOTS, { recursive: true });
                await page.screenshot({ path: path.join(process.env.HAIKU_INSUMOS_SCREENSHOTS, `destinos-resumen-${width}.png`) });
            }
            await page.locator('[data-cb-open="1"]').first().click();
            await page.locator('#cabinsReplenishment').scrollIntoViewIfNeeded();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
            const geo = await page.locator('#cabinsReplenishment').evaluate(n => {
                const contenedor = n.getBoundingClientRect();
                return [...n.querySelectorAll('button,select,input')].every(h => { const r=h.getBoundingClientRect(); return !r.width || (r.left >= contenedor.left - 1 && r.right <= contenedor.right + 1); });
            });
            assert.equal(geo, true, 'Controles dentro de la ficha');
            if (process.env.HAIKU_INSUMOS_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.HAIKU_INSUMOS_SCREENSHOTS, `destinos-ficha-${width}.png`) });
        }
        assert.deepEqual(errores, []);
        console.log('Destinos browser: selector obligatorio, tres destinos, históricos, totales, corrección/anulación, realtime, recarga y mobile OK');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => servidor.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
