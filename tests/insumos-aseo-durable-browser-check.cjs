// Cierre real de pestaña/navegador; perfil temporal y Supabase simulado, sin red externa.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { crearServidor } = require('./insumos-aseo-localhost.cjs');

(async () => {
    const servidor=crearServidor();
    await new Promise(resolve=>servidor.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${servidor.address().port}/panel.html`;
    const perfil=fs.mkdtempSync(path.join(os.tmpdir(),'haiku-insumos-durable-'));
    let contexto;
    const errores=[];
    const abrirNavegador=async () => {
        contexto=await chromium.launchPersistentContext(perfil,{
            executablePath:process.env.HAIKU_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            headless:true,viewport:{width:1440,height:1000},timezoneId:'America/Santiago'
        });
        await contexto.route('**/*',ruta=>new URL(ruta.request().url()).hostname==='127.0.0.1' ? ruta.continue() : ruta.abort());
    };
    const prepararPagina=async page => {
        page.on('pageerror',error=>errores.push(error.message));
        await page.goto(url); await page.waitForFunction(()=>window.__insumosDemoListo);
        if (!await page.locator('[data-saco-agregar]').isVisible()) await page.locator('[data-cb-open="1"]').first().click();
        return page;
    };
    const pendientes=page=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('haikuSacosPendientesV2:'))
        .map(k=>JSON.parse(localStorage.getItem(k))));
    const esperarTotal=(page,texto)=>page.waitForFunction(texto=>document.querySelector('[data-insumos-total=lena]').textContent===texto
        && document.getElementById('cabinsReplenishment').getAttribute('aria-busy')==='false',texto);
    const altaConRespuestaPerdida=async (page,peso) => {
        await page.evaluate(()=>{
            window.__insumosDemo.control.respuestaPerdida=true;
            window.__insumosDemo.control.pausaVerificacion=new Promise(()=>{});
        });
        await page.locator('[data-saco-peso]').fill(String(peso)); await page.locator('[data-saco-agregar]').click();
        await page.waitForFunction(()=>document.querySelector('[data-saco-agregar]').textContent==='Verificando registro…');
        const intentos=await pendientes(page); assert.equal(intentos.length,1);
        const id=intentos[0].id;
        assert.equal(await page.evaluate(id=>window.__insumosDemo.filas.movimientos_insumos_unidades.filter(s=>s.id===id).length,id),1);
        return id;
    };
    try {
        await abrirNavegador(); let page=await prepararPagina(await contexto.newPage());
        const primero=await altaConRespuestaPerdida(page,18.4);
        await page.reload(); await page.waitForFunction(()=>window.__insumosDemoListo);
        await esperarTotal(page,'1 saco · 18.4 kg');
        assert.equal((await pendientes(page)).length,0);
        assert.equal(await page.evaluate(()=>window.__insumosDemo.control.escrituras.length),0,'Reload sólo reconcilia por lectura');
        if (!await page.locator('[data-saco-agregar]').isVisible()) await page.locator('[data-cb-open="1"]').first().click();
        await page.locator('[data-saco-peso]').fill('18.4'); await page.locator('[data-saco-agregar]').click();
        await esperarTotal(page,'2 sacos · 36.8 kg');
        assert.notEqual(await page.evaluate(()=>window.__insumosDemo.control.escrituras.at(-1).p.p_unidad_id),primero);

        // No llegó al servidor: el UUID debe sobrevivir al cierre de esta pestaña.
        await page.evaluate(()=>{
            window.__insumosDemo.control.respuestaPerdidaSinCommit=true;
            window.__insumosDemo.control.fallarVerificacion=true;
        });
        await page.locator('[data-saco-peso]').fill('17.9'); await page.locator('[data-saco-agregar]').click();
        await page.waitForFunction(()=>document.querySelector('[data-saco-agregar]').textContent==='Verificar registro'
            && !document.querySelector('[data-saco-agregar]').disabled);
        const sinCommit=(await pendientes(page))[0].id;
        await page.close(); page=await prepararPagina(await contexto.newPage());
        await esperarTotal(page,'2 sacos · 36.8 kg');
        assert.equal(await page.locator('[data-saco-agregar]').textContent(),'Reintentar saco');
        assert.equal((await pendientes(page))[0].id,sinCommit);
        assert.equal(await page.evaluate(()=>window.__insumosDemo.control.escrituras.length),0);
        await page.locator('[data-saco-agregar]').click(); await esperarTotal(page,'3 sacos · 54.7 kg');
        assert.equal(await page.evaluate(()=>window.__insumosDemo.control.escrituras.at(-1).p.p_unidad_id),sinCommit);
        assert.equal((await pendientes(page)).length,0);

        // Commit confirmado por el simulador, respuesta perdida; cerrar todo el navegador.
        const ultimo=await altaConRespuestaPerdida(page,18.3);
        await contexto.close(); contexto=null;
        await abrirNavegador(); page=await prepararPagina(await contexto.newPage());
        await esperarTotal(page,'4 sacos · 73 kg');
        assert.equal((await pendientes(page)).length,0);
        assert.equal(await page.evaluate(id=>window.__insumosDemo.filas.movimientos_insumos_unidades.filter(s=>s.id===id).length,ultimo),1);
        assert.equal(await page.evaluate(()=>window.__insumosDemo.control.escrituras.length),0,'Reabrir navegador no repite altas');
        assert.deepEqual(errores,[]);
        console.log('Persistencia durable: reload, cerrar/reabrir pestaña y navegador, retry con UUID original y limpieza OK.');
    } finally {
        await contexto?.close(); await new Promise(resolve=>servidor.close(resolve));
        // Perfil creado exclusivamente para esta prueba; nunca borrar un perfil del usuario.
        const destino=path.resolve(perfil), temporal=path.resolve(os.tmpdir());
        if (path.dirname(destino)===temporal && path.basename(destino).startsWith('haiku-insumos-durable-')) {
            fs.rmSync(destino,{recursive:true,force:true});
        }
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
