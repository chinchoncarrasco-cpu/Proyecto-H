const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { crearServidor } = require('./insumos-aseo-localhost.cjs');
(async () => {
    const servidor = crearServidor();
    await new Promise(resolve => servidor.listen(0,'127.0.0.1',resolve));
    const url = `http://127.0.0.1:${servidor.address().port}/panel.html`;
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless:true });
        const page = await browser.newPage({ viewport:{ width:1440,height:1000 },timezoneId:'America/Santiago' });
        const errores = [];
        page.on('pageerror', e => errores.push(e.message));
        await page.route('**/*', ruta => new URL(ruta.request().url()).hostname === '127.0.0.1' ? ruta.continue() : ruta.abort());
        const esperar = async () => page.waitForFunction(() => window.__insumosDemoListo);
        const cantidad = insumo => page.locator(`[data-insumo-cantidad=${insumo}]`);
        const total = insumo => page.locator(`[data-insumos-total=${insumo}]`);
        const cambiar = async (insumo,delta,valor) => {
            await page.locator(`[data-insumo=${insumo}][data-insumo-destino="aseo_full"][data-insumo-delta="${delta}"]`).click();
            await page.waitForFunction(({insumo,valor}) => document.querySelector(`[data-insumo-cantidad=${insumo}]`)?.textContent === String(valor)
                && document.getElementById('cabinsReplenishment').getAttribute('aria-busy') === 'false', {insumo,valor});
        };
        const agregarSaco = async (peso, texto) => {
            await page.locator('[data-saco-destino]').selectOption('aseo_full');
            await page.locator('[data-saco-peso]').fill(String(peso));
            await page.locator('[data-saco-agregar]').click();
            await page.waitForFunction(texto => document.querySelector('[data-insumo-cantidad=lena]')?.textContent === texto
                && document.getElementById('cabinsReplenishment').getAttribute('aria-busy') === 'false', texto);
        };
        await page.goto(url); await esperar();
        assert.equal(await total('lena').textContent(),'0 sacos · 0 kg'); assert.equal(await total('carbon').textContent(),'0 sacos');
        assert.equal(await page.locator('[data-cb-insumos="1"]').textContent(),'');
        await page.locator('[data-cb-open="1"]').first().click();
        const antes = await page.evaluate(() => JSON.stringify(obtenerDatosDia(fechaSeleccionada).cabanas[1]));
        assert.equal(await cantidad('lena').textContent(),'0 sacos · 0 kg');
        assert.equal(await page.locator('[data-insumo=lena]').count(),0,'Leña no tiene contador editable');
        await agregarSaco(18.4,'1 saco · 18.4 kg'); await agregarSaco(17.9,'2 sacos · 36.3 kg'); await cambiar('carbon',1,1);
        assert.equal(await total('lena').textContent(),'2 sacos · 36.3 kg'); assert.equal(await total('carbon').textContent(),'1 saco');
        assert.equal(await page.locator('[data-saco-peso]').count(),1,'Un único campo de peso, para Leña');
        const sacoId=await page.locator('[data-saco-editar]').first().getAttribute('data-saco-editar');
        await page.locator('[data-saco-editar]').first().click();
        assert.equal(await page.locator('[data-saco-editar-peso]').inputValue(),'18.4');
        await page.locator('[data-saco-editar-peso]').fill('0');
        await page.locator('[data-saco-guardar]').click();
        assert.equal(await cantidad('lena').textContent(),'2 sacos · 36.3 kg');
        await page.locator('[data-saco-editar-peso]').fill('18.7');
        await page.locator('[data-saco-editar-peso]').press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-insumo-cantidad=lena]').textContent === '2 sacos · 36.6 kg'
            && !document.querySelector('[data-saco-editar-peso]'));
        assert.equal(await total('lena').textContent(),'2 sacos · 36.6 kg');
        assert.equal(await page.locator('[data-saco-editar]').first().getAttribute('data-saco-editar'),sacoId);
        assert.equal(await page.evaluate(() => window.__insumosDemo.filas.movimientos_insumos_unidades_historial.length),1);
        await page.locator('[data-saco-editar]').first().click();
        await page.locator('[data-saco-editar-peso]').fill('19');
        // Otro dispositivo corrige antes de guardar el borrador abierto: no cambiar su versión esperada.
        await page.evaluate(async id => {
            const remoto=window.__insumosDemo;
            const respuesta=await remoto.cliente.rpc('haiku_editar_peso_saco_lena_v1',{p_unidad_id:id,p_peso_kg:18.4,p_version_esperada:2});
            if (respuesta.error) throw respuesta.error;
        },sacoId);
        await page.waitForFunction(() => document.querySelector('[data-insumos-total=lena]').textContent === '2 sacos · 36.3 kg');
        assert.equal(await page.locator('[data-saco-editar-peso]').inputValue(),'19');
        await page.locator('[data-saco-guardar]').click();
        await page.waitForFunction(() => document.querySelector('[data-saco-editar-peso]')?.value === '18.4');
        assert.match(await page.locator('#cabinsReplenishment [data-insumos-error]').textContent(),/otro dispositivo/);
        await page.locator('[data-saco-cancelar]').click();
        await page.evaluate(() => { window.__insumosDemo.control.fallar = true; });
        await page.locator('[data-saco-peso]').fill('20'); await page.locator('[data-saco-agregar]').click();
        await page.waitForFunction(() => document.querySelector('#cabinsReplenishment [data-insumos-error]').textContent.includes('No se confirmó'));
        assert.equal(await cantidad('lena').textContent(),'2 sacos · 36.3 kg'); assert.equal(await total('lena').textContent(),'2 sacos · 36.3 kg');
        await page.evaluate(() => { window.__insumosDemo.control.fallar = false; });
        const intento=await page.evaluate(() => window.__insumosDemo.control.escrituras.at(-1).p.p_unidad_id);
        assert.equal(await page.locator('[data-saco-agregar]').textContent(),'Reintentar saco');
        await page.locator('[data-saco-agregar]').click();
        await page.waitForFunction(() => document.querySelector('[data-insumo-cantidad=lena]').textContent === '3 sacos · 56.3 kg');
        assert.equal(await page.evaluate(() => window.__insumosDemo.control.escrituras.at(-1).p.p_unidad_id),intento);
        await page.locator(`[data-saco-anular="${intento}"]`).click();
        await page.waitForFunction(() => document.querySelector('[data-insumo-cantidad=lena]').textContent === '2 sacos · 36.3 kg');
        // Respuesta perdida con commit: la UI permanece verificando, incluso con Enter/click repetidos.
        await page.evaluate(() => {
            window.__insumosDemo.control.respuestaPerdida=true;
            window.__insumosDemo.control.pausaVerificacion=new Promise(resolve => { window.__liberarSaco=resolve; });
        });
        await page.locator('[data-saco-peso]').fill('20'); await page.locator('[data-saco-peso]').press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-saco-agregar]').textContent === 'Verificando registro…');
        assert.equal(await page.locator('[data-saco-agregar]').isDisabled(),true);
        const escrituras=await page.evaluate(() => {
            document.querySelector('[data-saco-agregar]').click();
            document.querySelector('[data-saco-peso]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true}));
            return window.__insumosDemo.control.escrituras.length;
        });
        await page.evaluate(() => { window.__insumosDemo.control.respuestaPerdida=false; window.__liberarSaco(); });
        await page.waitForFunction(() => document.querySelector('[data-insumo-cantidad=lena]').textContent === '3 sacos · 56.3 kg'
            && document.querySelector('[data-saco-peso]').value === '');
        assert.equal(await page.evaluate(() => window.__insumosDemo.control.escrituras.length),escrituras);
        await page.locator('[data-saco-anular]').last().click();
        await page.waitForFunction(() => document.querySelector('[data-insumo-cantidad=lena]').textContent === '2 sacos · 36.3 kg');
        const snapshot = await page.evaluate(() => JSON.stringify(obtenerDatosDia(fechaSeleccionada).cabanas[1]));
        assert.equal(snapshot,antes,'La reposición no cambia Aseo, Revisión, Final ni Express');
        assert.equal(await page.locator('#cabinsAseoProgress').textContent(),'Lista para revisar');
        assert.equal(await page.locator('#cabinsFinalProgress').textContent(),'Lista');
        await page.evaluate(() => {
            const remoto = window.__insumosDemo;
            const movimiento = remoto.filas.movimientos_insumos.find(f => f.insumo === 'lena');
            remoto.filas.movimientos_insumos_unidades.push({id:'saco-remoto',movimiento_id:movimiento.id,peso_kg:18.1,version:1});
            remoto.emitir('movimientos_insumos_unidades',{new:{movimiento_id:movimiento.id}});
        });
        await page.waitForFunction(() => document.querySelector('[data-insumo-cantidad=lena]').textContent === '3 sacos · 54.4 kg');
        assert.equal(await total('lena').textContent(),'3 sacos · 54.4 kg');
        await page.locator('[data-saco-anular]').first().click();
        await page.waitForFunction(() => document.querySelector('[data-insumo-cantidad=lena]').textContent === '2 sacos · 36 kg');
        await cambiar('carbon',1,2); await cambiar('carbon',-1,1);
        await page.reload(); await esperar();
        assert.equal(await total('lena').textContent(),'2 sacos · 36 kg');
        await page.evaluate(() => window.HAIKU_CABANAS_SITES_V1.cerrar());
        assert.match(await page.locator('[data-cb-insumos="1"]').textContent(), /Leña 2 sacos · 36 kg · Carbón 1 saco/);
        for (const width of [1600,1440,1280,1000,781,768,390]) {
            await page.setViewportSize({width,height:1000});
            const geo = await page.locator('.cb-operation-row').first().evaluate(n => ({
                alto:n.getBoundingClientRect().height,columnas:n.children.length,
                overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
            }));
            assert.equal(geo.columnas,9); assert.equal(geo.overflow,false);
            if (width > 780) assert.equal(geo.alto,73,`${width}: filas compactas con consumo`);
            if (process.env.HAIKU_INSUMOS_SCREENSHOTS && [1440,390].includes(width)) {
                fs.mkdirSync(process.env.HAIKU_INSUMOS_SCREENSHOTS,{recursive:true});
                await page.screenshot({path:path.join(process.env.HAIKU_INSUMOS_SCREENSHOTS,`insumos-lista-${width}.png`)});
                await page.locator('[data-cb-open="1"]').first().click();
                await page.locator('#cabinsReplenishment').scrollIntoViewIfNeeded();
                await page.screenshot({path:path.join(process.env.HAIKU_INSUMOS_SCREENSHOTS,`insumos-ficha-${width}.png`)});
                await page.locator('[data-saco-editar]').first().click();
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),false);
                await page.screenshot({path:path.join(process.env.HAIKU_INSUMOS_SCREENSHOTS,`insumos-editar-${width}.png`)});
                await page.locator('[data-saco-cancelar]').click();
                await page.locator('#volver-cabanas').click();
            }
        }
        assert.deepEqual(errores,[]);
        console.log('Panel insumos: retry seguro, edición, conflicto, realtime, recarga, estados intactos y diseño 390–1600px OK.');
    } finally { await browser?.close(); await new Promise(resolve => servidor.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode=1; });
