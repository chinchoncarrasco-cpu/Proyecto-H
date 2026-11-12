// Formulario real del servicio desde el historial; Libro y RPC sólo de prueba.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const {read,setup}=require('./fixtures/libro-servicio-manual.cjs');
const root=path.resolve(__dirname,'..'),errors=[],externos=[];
const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        ['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-tema-oscuro-v1','haiku-tema-v1','haiku-tema-finanzas-compactas-v1']
            .map(s=>`<link rel="stylesheet" href="/css/${s}.css">`).join('')+
        '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel" id="haiku-asistente-panel">'+
        '<header class="haiku-asistente-cabecera">Haku<button id="haiku-asistente-cerrar" aria-label="Cerrar Haku">×</button></header><div class="haiku-asistente-mensajes">'+
        '<details class="haku-actualizacion-sites__pendiente" open><summary>CAB 4 · Reserva de prueba</summary>'+
        '<div class="haku-pendiente-detalle"><button id="aprobar" type="button">Aprobación manual</button></div></details></div></div></div></body></html>');
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    try{res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':'image/svg+xml'}).end(fs.readFileSync(file));}
    catch{res.writeHead(404).end();}
});
(async()=>{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const browser=await chromium.launch({executablePath:process.env.HAKU_CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
    try{
        for(const width of [1100,390,320])for(const tema of ['claro','oscuro']){
            const page=await browser.newPage({viewport:{width,height:950}});
        await require('./fixtures/dialogos.cjs').prepararNavegador(page);
            page.on('pageerror',e=>errors.push(e.message));
            await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(externos.push(r.request().url()),r.abort()));
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            for(const f of ['haiku-libro-semantica-v1','haiku-servicios-identidad-v1'])await page.addScriptTag({content:read(`js/${f}.js`)});
            await page.evaluate(setup);
            await page.addScriptTag({content:read('js/haiku-libro-servicios-scope-v2.js')});
            await page.addScriptTag({content:read('js/haiku-libro-confirm-cancel-fix-v1.js')});
            await page.evaluate(async tema=>{
                document.documentElement.dataset.haikuTema=tema;
                window.haikuSesion={usuario:{activo:true},roles:[{codigo:'administrador'}]};
                window.haikuTienePermiso=p=>p==='pagos.ver';
                fixtureServicios.db.pagos=[];fixtureServicios.db.vista_estado_cargos=[];
                const r=fixtureServicios.reservas[0];r.texto_original='PROMO HAIKU // 18hrs jacuzzi // DEJAR BATAS';
                r.servicios=HAIKU_LIBRO_SEMANTICA.servicios('18hrs jacuzzi',{origen_campo:'notas_reserva'});
                const asistente=document.getElementById('haiku-asistente-panel');
                document.getElementById('haiku-asistente-cerrar').onclick=()=>{asistente.hidden=true;};
                window.abrirManualHistorial=()=>{
                    const aprobar=document.getElementById('aprobar'),destino=aprobar.parentElement;
                    destino.querySelector('.haku-libro-preparacion-zona')?.remove();
                    const zona=document.createElement('div'),out=document.createElement('div');
                    zona.className='haku-libro-preparacion-zona';out.id='out';zona.append(out);destino.append(zona);
                    return HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial(out,{
                        reservas:[r],generacion:1,aprobacionManual:true,alVolver:()=>{
                            zona.remove();aprobar.focus({preventScroll:true});
                        }
                    });
                };
                await abrirManualHistorial();
            },tema);
            const out=page.locator('#out'),panel=out.locator('.haku-libro-servicio-manual');
            await panel.waitFor();
            await page.waitForFunction(()=>[...document.styleSheets].some(s=>s.href?.includes('haiku-libro-pagos-ui-v1.css')));
            assert.equal(await panel.count(),1);
            assert.doesNotMatch(await out.innerText(),/Interpretación operativa|Reglas de lectura|DEJAR BATAS|Seleccionados:/);
            assert.equal(await panel.evaluate(el=>getComputedStyle(el).backgroundColor),tema==='oscuro'?'rgb(27, 36, 32)':'rgb(255, 255, 255)');
            const desbordes=await out.evaluate(el=>[el,...el.querySelectorAll('*')].filter(x=>x.getClientRects().length&&x.scrollWidth>x.clientWidth+1).map(x=>x.className));
            assert.deepEqual(desbordes,[],`${width}/${tema}: sin desbordes`);
            if(process.env.HAKU_HISTORIAL_MANUAL_SCREENSHOT_DIR){
                fs.mkdirSync(process.env.HAKU_HISTORIAL_MANUAL_SCREENSHOT_DIR,{recursive:true});
                await out.screenshot({path:path.join(process.env.HAKU_HISTORIAL_MANUAL_SCREENSHOT_DIR,`manual-${tema}-${width}.png`)});
            }
            await panel.getByRole('button',{name:'Cancelar',exact:true}).click();
            assert.equal(await panel.count(),0);assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),0);
            await page.evaluate(()=>abrirManualHistorial());
            await page.evaluate(()=>window.confirm=()=>{throw Error('No corresponde otro diálogo');});
            await panel.getByRole('button',{name:'Confirmar servicio',exact:true}).click();
            await page.waitForFunction(()=>fixtureServicios.escrituras.length===1);
            const payload=await page.evaluate(()=>fixtureServicios.escrituras[0]);
            assert.equal(payload.p_servicios.length,1);assert.equal(payload.p_notas.length,0);assert.equal(payload.p_servicios[0].tipo_cobro,'cortesia');
            await out.getByText('Incorporación completada',{exact:true}).waitFor();
            assert.equal(await page.locator('details.haku-actualizacion-sites__pendiente').evaluate(el=>el.open),true);
            await out.locator('.haku-libro-resultado-sites__cerrar').click();
            assert.equal(await page.locator('#haiku-asistente-panel').isVisible(),true);
            assert.equal(await page.locator('.haku-libro-preparacion-zona').count(),0);
            assert.equal(await page.locator('details.haku-actualizacion-sites__pendiente').evaluate(el=>el.open),true);
            assert.equal(await page.evaluate(()=>document.activeElement.id),'aprobar');
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),1);

            await page.evaluate(()=>{
                const r=fixtureServicios.reservas[0];r.fecha_checkout='2026-10-12';r.noches=2;
                fixtureServicios.db.reserva_estadias[0].fecha_salida=r.fecha_checkout;
                r.texto_original='1 HORA TINAJA TONEL A LAS 17:15 X PAGAR';
                r.servicios=HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
                return abrirManualHistorial();
            });
            const fecha=panel.getByLabel('¿Qué día será?'),confirmar=panel.getByRole('button',{name:'Confirmar servicio',exact:true});
            assert.equal(await confirmar.isDisabled(),true);
            await fecha.fill('0202-10-11');
            assert.equal(await confirmar.isDisabled(),true);
            const input=await fecha.elementHandle();
            await fecha.click({position:{x:16,y:15}});
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            await page.keyboard.type('2026');
            assert.equal(await fecha.inputValue(),'2026-10-11');
            assert.ok(await input.evaluate(el=>el.isConnected&&document.activeElement===el),'el año conserva el mismo campo y foco');
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),1);
            await confirmar.click();
            await out.getByText('Incorporación completada',{exact:true}).waitFor();
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras[1].p_servicios[0].fecha_servicio),'2026-10-11');

            await page.evaluate(()=>{
                const r=fixtureServicios.reservas[0];r.texto_original='CORTESÍA LATE OUT HASTA LAS 15.00 HRS';
                r.servicios=HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
                fixtureServicios.db.catalogo_servicios.find(x=>x.codigo==='lateCheckout').permite_cortesia=true;
                return abrirManualHistorial();
            });
            assert.equal(await panel.locator('.haku-servicio-compacto__horario').innerText(),'12:00–15:00');
            assert.equal(await panel.locator('.haku-servicio-compacto__importe').innerText(),'$0');
            assert.equal(await panel.locator('.haku-servicio-compacto__cobro').innerText(),'Cortesía');
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),2);
            await confirmar.click();
            await out.getByText('Incorporación completada',{exact:true}).waitFor();
            assert.deepEqual(await page.evaluate(()=>{
                const p=fixtureServicios.escrituras[2].p_servicios[0];
                return [p.codigo_servicio,p.fecha_servicio,p.tipo_cobro,p.hora,p.cantidad];
            }),['lateCheckout','2026-10-12','cortesia','12:00',3]);

            await page.evaluate(()=>{
                const f=fixtureServicios,r=f.reservas[0],e=f.db.reserva_estadias[0];
                r.texto_original='Late check out hasta las 18:00 hrs; x cobrar $30.000';
                r.servicios=HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
                f.db.servicios.push({id:'late-registrado',reserva_id:e.reserva_id,estadia_id:e.id,fecha_servicio:e.fecha_salida,
                    hora_inicio:'18:00:00',hora_fin:'19:00:00',total:10000,cantidad:1,personas:0,tipo_cobro:'normal',
                    estado_servicio:'programado',catalogo_servicios:{codigo:'lateCheckout',nombre:'Late Check-out'}});
                return abrirManualHistorial();
            });
            const diferencias=out.getByRole('table',{name:'Diferencias entre el Libro y Proyecto H'});
            assert.deepEqual(await diferencias.getByRole('columnheader').allTextContents(),['Dato','En el Libro','En Proyecto H']);
            assert.deepEqual(await diferencias.locator('tbody td').allInnerTexts(),['18:00','19:00','$30.000','$10.000']);
            assert.ok(await diferencias.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
            assert.equal(await out.getByRole('button',{name:'Confirmar servicio',exact:true}).count(),0);
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),3);
            await page.close();
        }
        assert.deepEqual(errors,[]);assert.deepEqual(externos,[]);
        console.log('Historial manual: formulario directo, claro/oscuro 1100/390/320, cancelación y confirmación aislada OK');
    }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
