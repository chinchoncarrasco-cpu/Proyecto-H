// Local browser regression: real selectors/controllers, isolated RPC fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname,'..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const rid = '44444444-4444-4444-8444-444444444444';
const server = http.createServer((req,res)=>{
    const pathname = new URL(req.url,'http://localhost').pathname;
    if(pathname==='/') return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="/css/styles.css">'+
        '<link rel="stylesheet" href="/css/sites-resumen-v1.css"></head><body></body></html>');
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)) return res.writeHead(403).end();
    try { const content=fs.readFileSync(file); res.writeHead(200,{'Content-Type':pathname.endsWith('.css')?'text/css':'text/javascript'}).end(content); }
    catch { res.writeHead(404).end(); }
});

(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
    const scenarios=[];
    try {
        for(const [etapa,width] of [['checkin',1000],['checkout',1000],['abono',1000],['checkin',390],['checkout',390],['abono',390]]) {
            const page=await browser.newPage({viewport:{width,height:800}}), errors=[];
            page.on('pageerror',e=>errors.push(e.message));
            await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            await page.evaluate(({etapa,rid})=>{
                window.fechaSeleccionada='2026-10-06'; window.haikuSesion={id:'fixture-user'};
                window.haikuTienePermiso=()=>true; window.__writes=[]; window.__alerts=[];
                window.alert=t=>window.__alerts.push(t);
                const row={numero:4,estado_operativo:etapa==='checkin'?'libre-ingresa':etapa==='checkout'?'sale-libre':'continua',
                    ingreso_reserva_id:rid,ingreso_titular:'Agustin Rampa Spinelli',salida_reserva_id:rid,
                    salida_estadia_id:rid,salida_titular:'Agustin Rampa Spinelli',continua_reserva_id:rid,continua_titular:'Agustin Rampa Spinelli'};
                window.haikuSupabase={
                    rpc:async(name,args)=>{
                        if(name==='haiku_operacion_dia') return {data:[row],error:null};
                        if(name==='haiku_finanzas_grupo') return {data:{es_grupo:false},error:null};
                        if(name.startsWith('haiku_registrar_pago')||name==='haiku_editar_pago_confirmado_saldo') {
                            window.__writes.push({name,args}); return {data:{pago_id:rid},error:null};
                        }
                        throw Error('Unexpected fixture RPC '+name);
                    },
                    from(table){
                        const data=table==='reservas'?[{id:rid,titular_nombre:'Agustin Rampa Spinelli',grupo_reserva_id:null}]:
                            table==='vista_saldos_alojamiento_reserva'?[{reserva_id:rid,total_alojamiento:165598,saldo_alojamiento:165598,pagado_alojamiento:0}]:
                            table==='vista_estado_cargos'?[{cargo_id:rid,reserva_id:rid,estadia_id:rid,
                                tipo_cargo:etapa==='checkout'?'servicio':'alojamiento',estado:'activo',monto:165598,monto_ajustado:165598,
                                aplicado_neto:0,saldo_cargo:165598,estado_pago:'pendiente'}]:[];
                        const b={select(){return b},in(){return b},eq(){return b},order(){return b},
                            maybeSingle:async()=>({data:data[0]||null,error:null}),
                            then(resolve){resolve({data,error:null})}};return b;
                    }
                };
            },{etapa,rid});
            const file=etapa==='checkin'?'supabase-pagos-checkin-v5.js':etapa==='checkout'?'supabase-pagos-checkout-v1.js':'supabase-pago-grupo-v1.js';
            let source=read('js/'+file);
            if(etapa==='checkin') {
                const end=source.lastIndexOf('})();');
                source=source.slice(0,end)+'window.__editorPago=htmlPagoConfirmado;\n'+source.slice(end);
            }
            await page.addScriptTag({content:source});
            if(etapa==='checkin') await page.addScriptTag({content:read('js/supabase-pagos-checkin-grupo-v2.js')});
            await page.addScriptTag({content:read('js/sites-resumen-pago-v1.js')});
            const opened=await page.evaluate(({rid,etapa})=>{
                const boton=document.createElement('button'); boton.textContent='Pago';
                Object.assign(boton.dataset,{resumenPago:'4',resumenPagoReservaId:rid,resumenPagoEtapa:etapa});
                document.body.appendChild(boton);
                return window.HAIKU_RESUMEN_PAGO_SITES_V1.abrirPagoReserva(rid,etapa,4,boton);
            },{rid,etapa});
            assert.equal(opened,true,`${etapa}: ${await page.locator('body').textContent()}`);
            const select=page.locator('[data-pago-medio]');
            assert.equal(await select.locator('option[value="airbnb_prepaid_card"]').textContent(),'Airbnb Prepaid Card');
            await select.selectOption('airbnb_prepaid_card');
            assert.ok(await page.locator('[data-pago-campo="glosa"]').isVisible());
            assert.match(await page.locator('[data-pago-campo="glosa"]').textContent(),/Referencia Airbnb \/ externa \(opcional\)/);
            assert.equal(await page.locator('[data-pago-glosa]').getAttribute('required'),null);
            for(const id of ['folio','bovtar','codaut']) assert.equal(await page.locator(`[data-pago-campo="${id}"]`).isVisible(),false);
            await page.locator('[data-pago-glosa]').fill('AIR-REAL-00004');
            if(etapa!=='abono') await page.locator('[data-pago-manager]').check();
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
            if(etapa==='checkin'&&process.env.HAKU_AIRBNB_SCREENSHOT_DIR) {
                fs.mkdirSync(process.env.HAKU_AIRBNB_SCREENSHOT_DIR,{recursive:true});
                await page.screenshot({path:path.join(process.env.HAKU_AIRBNB_SCREENSHOT_DIR,`airbnb-${width}.png`)});
            }
            assert.equal(await page.evaluate(()=>window.__writes.length),0);
            await page.locator('[data-pago-confirmar]').click();
            await page.waitForFunction(()=>window.__writes.length===1);
            const payload=await page.evaluate(()=>window.__writes[0]);
            assert.equal(payload.args.p_medio_pago,'airbnb_prepaid_card');
            assert.equal(payload.args.p_glosa||payload.args.p_referencia_externa,'AIR-REAL-00004');
            assert.ok(!payload.args.p_folio&&!payload.args.p_bove&&!payload.args.p_bovtar&&!payload.args.p_codigo_autorizacion);
            assert.equal(await page.evaluate(()=>window.fechaSeleccionada),'2026-10-06');
            assert.deepEqual(await page.evaluate(()=>window.__alerts),[]);
            if(etapa==='checkin') {
                await page.locator('[data-pago-estado]').filter({hasText:/registrado\. Cierra/}).waitFor();
                await page.locator('.sites-resumen-drawer-close').click();
                await page.evaluate(rid=>{
                    document.body.insertAdjacentHTML('beforeend',window.__editorPago({id:rid,monto:165598,
                        medio_pago:'airbnb_prepaid_card',referencia_externa:'AIR-REAL-00004'},new Map()));
                },rid);
                assert.match(await page.locator('[data-haiku-pago-id]').textContent(),/Airbnb Prepaid Card/);
                await page.locator('[data-haiku-pago-editar]').click();
                assert.equal(await page.locator('[data-haiku-editar-pago-medio]').inputValue(),'airbnb_prepaid_card');
                assert.equal(await page.locator('[data-haiku-editar-pago-glosa]').getAttribute('required'),null);
                await page.locator('[data-haiku-editar-pago-glosa]').fill('CB-EDIT-00004');
                await page.locator('[data-haiku-editar-pago-guardar]').click();
                await page.waitForFunction(()=>window.__writes.length===2);
                const edit=await page.evaluate(()=>window.__writes[1]);
                assert.equal(edit.name,'haiku_editar_pago_confirmado_saldo');
                assert.equal(edit.args.p_medio_pago,'airbnb_prepaid_card');
                assert.equal(edit.args.p_glosa,'CB-EDIT-00004');
                scenarios.push(`edicion-confirmada-${width}`);
            }
            assert.deepEqual(errors,[]);
            scenarios.push(`${etapa}-${width}`); await page.close();
        }
        console.log(JSON.stringify({ok:true,scenarios,remoteRequests:0,remoteWrites:0}));
    } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
