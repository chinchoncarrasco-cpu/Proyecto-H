// Panel real, datos locales y toda conexión externa bloqueada.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const {PAGO_AGUSTIN_RUNTIME} = require('./fixtures/libro-airbnb-agustin-runtime.cjs');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const exportsBase = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const source = read('js/haiku-libro-consultas-v1.js').replace(exportsBase,
    exportsBase.replace(' })',', renderizarIncorporacion, continuarVistaManualPago })'));
const fixture = read('tests/fixtures/libro-airbnb-confirmacion-manual.cjs');
const fixtures = fixture.slice(fixture.indexOf('const id ='),fixture.indexOf('module.exports='));
assert.ok(fixtures.includes('function entorno('));
const styles = ['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-libro-pagos-ui-v1'];
const missing = [];
const server = http.createServer((request,response) => {
    const pathname = new URL(request.url,'http://localhost').pathname;
    if (pathname === '/') {
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(
            '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            styles.map(name=>`<link rel="stylesheet" href="/css/${name}.css">`).join('') +
            '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel">' +
            '<header class="haiku-asistente-cabecera">Haku</header><div id="haiku-asistente-mensajes" class="haiku-asistente-mensajes"></div>' +
            '<footer class="haiku-asistente-compositor">Acciones rápidas</footer></div></div></body></html>');
        return;
    }
    const file = path.resolve(root,'.'+pathname);
    if (!file.startsWith(root+path.sep)) {response.writeHead(403).end();return;}
    try {
        const content = fs.readFileSync(file);
        response.writeHead(200,{'Content-Type':pathname.endsWith('.css')?'text/css':pathname.endsWith('.svg')?'image/svg+xml':'text/javascript'}).end(content);
    } catch {missing.push(pathname);response.writeHead(404).end();}
});

(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser = await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
    try {
        const page = await browser.newPage({viewport:{width:1000,height:900}});
        const errors = [],external = [];
        page.on('pageerror',error=>errors.push(error.message));
        await page.route('**/*',route=>{
            if (new URL(route.request().url()).hostname==='127.0.0.1') return route.continue();
            external.push(route.request().url());return route.abort();
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(()=>{window.HAIKU_LIBRO_RESERVA_V1={consultarHoja:async data=>data};});
        for (const name of ['haiku-libro-semantica-v1','haiku-libro-pagos-destinos-v1','haiku-libro-pagos-canon-v1'])
            await page.addScriptTag({content:read('js/'+name+'.js')});
        await page.addScriptTag({content:source});
        await page.addScriptTag({content:fixtures});
        await page.evaluate(()=>{
            const Q=window.HAIKU_LIBRO_CONSULTAS;
            window.__start=async(options={})=>{
                const h=entorno(options);window.__h=h;window.haikuSupabase=h.db;
                if (options.ambigua) h.tablas.reserva_estadias.push({...structuredClone(h.tablas.reserva_estadias[0]),id:id(3)});
                if (options.pagoExistente) h.tablas.pagos.push({id:id(50),reserva_id:id(1),monto:165598,moneda:'CLP',
                    medio_pago:'airbnb_prepaid_card',estado:'confirmado',tipo_movimiento:'pago',fecha_pago:'2026-10-12',datos_origen:{}});
                window.__original=JSON.stringify(h.r);window.__pagosOriginal=JSON.stringify(h.tablas.pagos);
                window.__actions=0;window.__incorporaciones=0;window.__volver=0;
                const aprobar=async()=>{throw Error('Aprobación genérica inesperada')};
                const render=plan=>{
                    window.__plan=plan;
                    const out=document.createElement('div');
                    document.getElementById('haiku-asistente-mensajes').replaceChildren(out);
                    Q.renderizarIncorporacion(out,plan,()=>{window.__volver++},aprobar,async plan=>{
                        await h.incorporar(plan);window.__incorporaciones++;
                    });
                };
                aprobar.manualPago=async(plan,id,action)=>{
                    window.__actions++;
                    const next=await h.resolver(plan,plan.items.find(i=>i.id===id),action);
                    Q.continuarVistaManualPago(plan,next,id,action);render(next);
                };
                const plan=await h.preparar();
                if (options.motivo) plan.items.find(i=>i.pagoLibro).motivos.push(options.motivo);
                render(plan);
            };
        });
        const panel=page.locator('.haiku-incorporacion-manual-pago-panel:not([hidden])');
        const noWrites=async()=>assert.deepEqual(await page.evaluate(()=>({
            writes:window.__h.llamadas.filter(x=>x.nombre).length,
            pagosSinCambios:window.__pagosOriginal===JSON.stringify(window.__h.tablas.pagos),
            unchanged:window.__original===JSON.stringify(window.__h.r)
        })),{writes:0,pagosSinCambios:true,unchanged:true});
        for (const width of [1000,390]) {
            await page.setViewportSize({width,height:900});
            await page.evaluate(options=>window.__start(options), {pagoExtra: PAGO_AGUSTIN_RUNTIME});
            await noWrites();
            await page.locator('.haiku-incorporacion-seccion--dudosos > summary').click();
            const tarjeta=page.locator('.haiku-incorporacion-item--dudosos').filter({hasText:'Agustin Rampa Spinelli'});
            assert.match(await tarjeta.innerText(),/CAB 4[\s\S]*165\.598[\s\S]*Airbnb Prepaid Card/);
            assert.match(await tarjeta.innerText(),/Falta la fecha del comprobante; no se usa la fecha del bloque como fecha de pago\./);
            const estadoPendiente=async()=>assert.deepEqual(await page.evaluate(()=>{
                const item=window.__plan.items.find(i=>i.pagoLibro);
                return {aprobable:item.aprobable,seleccionado:item.seleccionado,categoria:item.categoria,
                    fecha:item.payload.argumentos.p_fecha_pago,aprobados:window.__h.aprobados.size,
                    decisiones:window.__h.decisiones.size,acciones:window.__actions};
            }),{aprobable:false,seleccionado:false,categoria:'dudosos',fecha:null,aprobados:0,decisiones:0,acciones:0});
            await estadoPendiente();
            assert.equal(await page.locator('.haiku-incorporacion-item--pagos').count(),0);
            assert.equal(await page.locator('.haiku-incorporacion-atajo--aprobar').count(),0,'sin aprobación masiva');
            await page.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            await panel.waitFor({state:'visible'});
            await estadoPendiente();await noWrites();
            assert.match(await panel.innerText(),/Completar confirmación Airbnb[\s\S]*Agustin Rampa Spinelli[\s\S]*CAB 4[\s\S]*165\.598[\s\S]*Airbnb Prepaid Card/);
            const date=panel.getByLabel('Fecha real del pago *',{exact:true});
            const check=panel.getByLabel('He recibido la confirmación de pago de Airbnb',{exact:true});
            const ref=panel.getByLabel('Referencia Airbnb / externa (opcional, sólo si existe en el correo)',{exact:true});
            const completar=panel.getByRole('button',{name:'Completar confirmación Airbnb',exact:true});
            assert.equal(await date.inputValue(),'','sin fecha del bloque/check-in/reloj');
            assert.equal(await ref.inputValue(),'','sin referencia inventada');
            assert.equal(await completar.isDisabled(),true);
            await check.check();assert.equal(await completar.isDisabled(),true,'fecha obligatoria');
            await check.uncheck();await date.fill('2026-10-12');
            assert.equal(await completar.isDisabled(),true,'confirmación obligatoria');
            await check.check();assert.equal(await completar.isEnabled(),true);
            await ref.fill('BORRADOR');
            await panel.getByRole('button',{name:'Cancelar revisión',exact:true}).click();
            assert.equal(await panel.count(),0);
            assert.equal(await page.evaluate(()=>window.__h.decisiones.size),0);await noWrites();
            await page.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            assert.equal(await date.inputValue(),'');assert.equal(await check.isChecked(),false);assert.equal(await ref.inputValue(),'');
            await panel.locator('.haiku-manual-evidencia > summary').click();
            assert.match(await panel.innerText(),/Oct26.*BC41:BF41[\s\S]*El viajero ha pagado[\s\S]*Comisión de servicio del viajero/);
            const geometry=await panel.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,
                title:getComputedStyle(e.querySelector('h3')).fontSize,input:getComputedStyle(e.querySelector('input')).height}));
            assert.ok(geometry.scroll<=geometry.width+1,'sin overflow horizontal');
            assert.equal(geometry.title,'16px');assert.equal(geometry.input,'36px');
            if (process.env.HAKU_AIRBNB_SCREENSHOT_DIR) {
                fs.mkdirSync(process.env.HAKU_AIRBNB_SCREENSHOT_DIR,{recursive:true});
                await panel.screenshot({path:path.join(process.env.HAKU_AIRBNB_SCREENSHOT_DIR,`airbnb-${width}.png`)});
            }
            await date.fill('2026-10-12');await check.check();
            if (width===390) await ref.fill('AIR-REAL');
            await completar.click();
            await page.waitForFunction(()=>document.querySelector('.haiku-incorporacion-manual-pago-panel')?.dataset.paso==='aprobado');
            await noWrites();
            assert.match(await panel.innerText(),/Confirmación Airbnb completada[\s\S]*12 oct 2026[\s\S]*Pagos preparados/);
            const payload=await page.evaluate(()=>window.__plan.items.find(i=>i.pagoLibro).payload.argumentos);
            assert.equal(payload.p_fecha_pago,'2026-10-12');assert.equal(payload.p_medio_pago,'airbnb_prepaid_card');
            assert.equal(payload.p_monto,165598);assert.equal(payload.p_referencia_externa,width===390?'AIR-REAL':null);
            for (const k of ['p_folio','p_bove','p_codigo_autorizacion'])assert.equal(payload[k],null);
            assert.equal(await page.locator('.haiku-incorporacion-item--pagos').count(),1);
            assert.match(await page.locator('.haiku-incorporacion-item--pagos > .haiku-incorporacion-meta-item').innerText(),/Fecha pago[\s\S]*12\/10\/26/i);
            assert.equal(await page.evaluate(()=>window.__actions),1);
            await panel.getByRole('button',{name:'Volver a revisión',exact:true}).click();
            await page.getByRole('button',{name:'Volver',exact:true}).click();
            assert.equal(await page.evaluate(()=>window.__volver),1);await noWrites();
            page.once('dialog',dialog=>dialog.accept());
            await page.getByRole('button',{name:'Continuar con 1 elemento listo',exact:true}).click();
            await page.waitForFunction(()=>window.__incorporaciones===1);
            const stored=await page.evaluate(()=>window.__h.tablas.pagos);
            assert.equal(stored.length,1);assert.equal(stored[0].fecha_pago,'2026-10-12');
            assert.equal(stored[0].medio_pago,'airbnb_prepaid_card');assert.equal(stored[0].monto,165598);
        }
        for (const options of [{ambigua:true},{pagoExtra:{monto:0}},
            {pagoExtra:{texto_original:'Airbnb'}},{pagoExistente:true},
            {motivo:'Conflicto de identidad.'},{motivo:'Destino no verificable.'},
            {motivo:'Otro bloqueo que la fecha no puede resolver.'}]) {
            await page.evaluate(options=>window.__start(options),options);
            assert.equal(await page.getByRole('button',{name:'Aprobación manual',exact:true}).count(),0,JSON.stringify(options));
            assert.equal(await panel.count(),0);await noWrites();
        }
        for (const medio of ['airbnb_prepaid_card','transferencia','efectivo','debito','webpay_credito']) {
            await page.evaluate(options=>window.__start(options),{pagoExtra:{medio_pago:medio,fecha_comprobante:'2026-10-12'}});
            await page.locator('.haiku-incorporacion-seccion--dudosos > summary').click();
            assert.equal(await page.getByRole('button',{name:'Aprobación manual',exact:true}).count(),0);
            assert.equal(await page.getByRole('button',{name:'Aprobar este pago',exact:true}).count(),1,'flujo normal con fecha');
            await noWrites();
        }
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(missing,[]);
        console.log('OK · Agustin CAB 4/$165.598: resolver con aprobable=false, fecha vacía, sin selección/aprobación masiva/escrituras al abrir; conflictos bloqueados y medios tradicionales intactos. Escritorio/móvil, Pagos preparados sólo tras confirmar. Cero conexiones remotas.');
    } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
