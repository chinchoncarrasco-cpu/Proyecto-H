// Revisión local de la promoción con tinaja registrada; sin acceso a datos reales.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const {read,source,setup,consulta}=require('./fixtures/libro-servicio-manual.cjs');
const root=path.resolve(__dirname,'..'),errores=[],externos=[];
const server=http.createServer((req,res)=>{
    const p=new URL(req.url,'http://localhost').pathname;
    if(p==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        ['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1'].map(x=>`<link rel="stylesheet" href="/css/${x}.css">`).join('')+
        '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel"><header class="haiku-asistente-cabecera">Haku</header>'+
        '<div class="haiku-asistente-mensajes"><div id="out"></div></div></div></div></body></html>');
    const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();
    try{res.writeHead(200,{'Content-Type':'text/css'}).end(fs.readFileSync(f));}catch{res.writeHead(404).end();}
});
async function configurar(q) {
    const e=fixtureServicios,r=e.reservas[0],est=e.db.reserva_estadias[0];e.reservas=[r];
    r.titular='Huésped de prueba';e.db.reservas[0].titular_nombre=r.titular;
    r.texto_original='PROMO HAIKU // Huésped de prueba // JACUZZI A LAS 17:15 HASTA LAS 20:30';
    r.servicios=HAIKU_LIBRO_SEMANTICA.servicios('JACUZZI A LAS 17:15 HASTA LAS 20:30',{origen_campo:'notas_reserva'});
    r.pagos=[];r.pagos_sin_asociacion=[];e.db.pagos=[];window.haikuTienePermiso=p=>p==='pagos.ver';
    e.db.servicios=[{id:'tinaja-registrada',reserva_id:est.reserva_id,estadia_id:est.id,
        catalogo_servicio_id:e.db.catalogo_servicios.find(c=>c.codigo==='tinajaTonel').id,recurso_id:null,
        fecha_servicio:r.fecha_checkin,hora_inicio:'16:15:00',hora_fin:'18:15:00',cantidad:2,personas:2,
        precio_unitario_aplicado:15000,monto_adicional:0,actualizado_en:'2026-10-10T10:00:00Z',
        tipo_cobro:'normal',total:30000,estado_servicio:'programado',
        catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera'}}];
    e.db.vista_estado_cargos=[{cargo_id:'cargo-adicional',reserva_id:est.reserva_id,estadia_id:est.id,
        servicio_id:'tinaja-registrada',monto:30000,monto_ajustado:30000,aplicado_neto:30000,saldo_cargo:0,estado:'activo'}];
    e.inspecciones=[];window.HAIKU_INSPECTOR_V1={abrirReserva:id=>e.inspecciones.push(id)};
    e.antes=JSON.stringify(e.db);
    await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial(document.getElementById('out'),{reservas:e.reservas,generacion:e.generacion});
}
(async()=>{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
    try{
        browser=await chromium.launch({headless:true,...(process.env.HAKU_CHROMIUM_PATH?{executablePath:process.env.HAKU_CHROMIUM_PATH}:{}),args:['--no-sandbox']});
        for(const width of [1100,390,320]) {
            const page=await browser.newPage({viewport:{width,height:1000}});
            page.on('pageerror',e=>errores.push(e.message));
            await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(externos.push(r.request().url()),r.abort()));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for(const f of ['haiku-libro-semantica-v1','haiku-servicios-identidad-v1'])await page.addScriptTag({content:read(`js/${f}.js`)});
            await page.evaluate(setup);await page.addScriptTag({content:source});await page.evaluate(configurar,consulta);
            await page.locator('.haku-libro-servicios__seccion--revision > summary').click();
            const fila=page.locator('.haku-libro-servicios__item').filter({hasText:'JACUZZI A LAS 17:15'}),texto=await fila.innerText();
            assert.equal(await fila.locator('.haku-libro-servicios__ingreso').innerText(),'IN: 10.10.26');
            assert.match(texto,/Promo Haku: 10% de descuento y 1 hora.*Jacuzzi o Tonel/);
            assert.match(texto,/Tinaja Tonel de Madera 16:15–18:15/);
            assert.match(texto,/¿Se modificó la tinaja registrada\?/);
            assert.match(texto,/Pagado \$30\.000 · saldo \$0/);
            assert.doesNotMatch(texto,/cobro por definir|Tipo de cobro|Falta definir si el servicio es cobrable/);
            assert.equal(await fila.getByRole('button',{name:'Aprobación manual',exact:true}).count(),0);
            await fila.getByRole('button',{name:'Ver reserva',exact:true}).click();
            assert.equal(await page.evaluate(()=>fixtureServicios.inspecciones.length),1);
            const desbordes=await page.evaluate(()=>[...document.querySelectorAll('.haku-libro-servicios,.haku-libro-servicios__item')]
                .filter(el=>el.getBoundingClientRect().width&&el.scrollWidth>el.clientWidth+1).map(el=>el.className));
            assert.deepEqual(desbordes,[],`${width}: sin desbordes internos`);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
            if(process.env.HAKU_PROMO_SCREENSHOT_DIR){fs.mkdirSync(process.env.HAKU_PROMO_SCREENSHOT_DIR,{recursive:true});
                await fila.screenshot({path:path.join(process.env.HAKU_PROMO_SCREENSHOT_DIR,`promo-haku-${width}.png`)});}
            assert.equal(await page.evaluate(()=>JSON.stringify(fixtureServicios.db)===fixtureServicios.antes),true);
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),0);
            await page.evaluate(async()=>{
                const e=fixtureServicios;window.haikuSesion={auth:{id:e.usuario},usuario:{activo:true},roles:[{codigo:'administrador'}]};
                window.haikuTienePermiso=()=>true;e.adminCalls=[];const anterior=haikuSupabase.rpc;
                haikuSupabase.rpc=async(nombre,p)=>{
                    if(nombre!=='haiku_libro_revision_servicio_admin_v1')return anterior(nombre,p);
                    e.adminCalls.push(p);const s=e.db.servicios[0],estado={...p.p_esperado};delete estado.actualizado_en;
                    if(p.p_modo==='actualizar'){
                        const c=e.db.catalogo_servicios.find(c=>c.codigo===p.p_codigo);
                        Object.assign(s,{catalogo_servicio_id:c.id,catalogo_servicios:{codigo:c.codigo,nombre:c.nombre},hora_inicio:p.p_inicio+':00',hora_fin:p.p_fin+':00'});
                        Object.assign(estado,{catalogo_servicio_id:c.id,hora_inicio:p.p_inicio,hora_fin:p.p_fin});
                    }
                    s.libro_revision_admin_v1={version:1,item_id:p.p_item_id,firma:p.p_firma,motivo:p.p_motivo,estado};
                    s.actualizado_en='2026-10-20T06:00:00Z';return {data:{ok:true,servicio_id:s.id,total:s.total}};
                };
                await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial(document.getElementById('out'),{reservas:e.reservas,generacion:e.generacion});
            });
            await page.locator('.haku-libro-servicios__seccion--revision > summary').click();
            await page.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            const manual=page.locator('.haku-libro-servicio-manual');assert.match(await manual.innerText(),/Pagado \$30\.000 · saldo \$0/);
            assert.equal(await page.locator('[data-haku-accion="incorporar"]').isVisible(),false,'la incorporación general no tapa la confirmación administrativa');
            if(width!==1100)await manual.locator('[data-revision-admin="modo"]').selectOption('actualizar');
            await manual.locator('[data-revision-admin="motivo"]').fill('Verificado por el administrador');
            await manual.locator('[data-revision-admin="aceptar"]').check();
            const encaja=await manual.evaluate(el=>el.scrollWidth<=el.clientWidth+1);assert.equal(encaja,true,`${width}: aprobación manual sin desborde`);
            if(process.env.HAKU_PROMO_SCREENSHOT_DIR)await manual.screenshot({path:path.join(process.env.HAKU_PROMO_SCREENSHOT_DIR,`admin-${width}.png`)});
            await manual.getByRole('button',{name:'Confirmar decisión',exact:true}).click();
            await page.waitForFunction(()=>!document.querySelector('.haku-libro-servicio-manual'));
            assert.equal(await page.locator('[data-haku-accion="incorporar"]').isVisible(),true);
            assert.equal(await page.evaluate(()=>fixtureServicios.adminCalls.length),1);
            assert.equal(await page.evaluate(()=>fixtureServicios.db.servicios.length),1);
            assert.equal(await page.evaluate(()=>fixtureServicios.db.servicios[0].total),30000);
            assert.equal(await page.evaluate(()=>fixtureServicios.db.servicios[0].cantidad),2);
            assert.equal(await page.evaluate(()=>fixtureServicios.db.vista_estado_cargos[0].aplicado_neto),30000);
            assert.equal(await page.evaluate(()=>fixtureServicios.db.vista_estado_cargos[0].saldo_cargo),0);
            await page.locator('.haku-libro-servicios__seccion--existentes > summary').click();
            assert.equal(await page.getByRole('button',{name:'Aprobación manual',exact:true}).isVisible(),true);
            // El check-in permite ubicar la ficha aunque no se conozca el día del servicio.
            await page.evaluate(async()=>{
                const e=fixtureServicios,r=e.reservas[0];r.noches=2;r.fecha_checkout='2026-10-12';
                e.db.reserva_estadias[0].fecha_salida=r.fecha_checkout;e.db.servicios=[];e.db.vista_estado_cargos=[];
                r.texto_original='PROMO HAIKU // JACUZZI 20 HRS // DEJAR BATAS';
                r.servicios=HAIKU_LIBRO_SEMANTICA.servicios('JACUZZI 20 HRS',{origen_campo:'notas_reserva'});
                await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial(document.getElementById('out'),{reservas:[r],generacion:e.generacion});
            });
            await page.locator('.haku-libro-servicios__seccion--revision > summary').click();
            const sinFecha=page.locator('.haku-libro-servicios__item').filter({hasText:'JACUZZI 20 HRS'});
            assert.match(await sinFecha.innerText(),/Fecha por definir/);
            assert.equal(await sinFecha.locator('.haku-libro-servicios__ingreso').innerText(),'IN: 10.10.26');
            assert.equal(await page.locator('.haku-libro-servicios__ingreso').count(),await page.locator('.haku-libro-servicios__item').count());
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),0);
            if(process.env.HAKU_PROMO_SCREENSHOT_DIR)await sinFecha.screenshot({path:path.join(process.env.HAKU_PROMO_SCREENSHOT_DIR,`fecha-in-${width}.png`)});
            await page.evaluate(async()=>{
                const e=fixtureServicios,r=e.reservas[0];
                r.texto_original=r.texto_original.replace('JACUZZI 20 HRS','JACUZZI 20 HRS; BATAS OK 10-10');
                await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial(document.getElementById('out'),{reservas:[r],generacion:e.generacion});
            });
            await page.locator('.haku-libro-servicios__seccion--servicios > summary').click();
            const contextual=page.locator('.haku-libro-servicios__item').filter({hasText:'JACUZZI 20 HRS'});
            assert.match(await contextual.innerText(),/Fecha 2026-10-10/);
            assert.match(await contextual.innerText(),/mismo bloque de tinaja y batas.*BATAS OK 10-10/);
            assert.doesNotMatch(await contextual.innerText(),/Fecha por definir|Falta una fecha inequívoca/);
            assert.equal(await contextual.locator('.haku-libro-servicios__ingreso').innerText(),'IN: 10.10.26');
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),0);
            if(process.env.HAKU_PROMO_SCREENSHOT_DIR)await contextual.screenshot({path:path.join(process.env.HAKU_PROMO_SCREENSHOT_DIR,`fecha-contextual-${width}.png`)});
            // Otra ficha de la auditoría sí está lista: usa el mismo guard y
            // writer con la fuente focal, sin depender de un mensaje anterior.
            await page.evaluate(async()=>{
                const e=fixtureServicios,r=e.reservas[0];e.db.servicios=[];e.db.vista_estado_cargos=[];
                r.noches=1;r.fecha_checkout='2026-10-11';e.db.reserva_estadias[0].fecha_salida=r.fecha_checkout;
                r.texto_original='PROMO HAIKU // Huésped de prueba // 18hrs jacuzzi';
                r.servicios=HAIKU_LIBRO_SEMANTICA.servicios('18hrs jacuzzi',{origen_campo:'notas_reserva'});
                await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial(document.getElementById('out'),{reservas:[r],generacion:e.generacion});
            });
            await page.addScriptTag({content:read('js/haiku-libro-confirm-cancel-fix-v1.js')});
            await page.locator('[data-haku-accion="incorporar"]').click();
            await page.waitForFunction(()=>fixtureServicios.escrituras.length===1);
            const guardado=await page.evaluate(()=>fixtureServicios.escrituras[0]);
            assert.equal(guardado.p_servicios.length,1);assert.equal(guardado.p_servicios[0].tipo_cobro,'cortesia');
            assert.ok(guardado.p_notas.every(n=>n.reserva_id===guardado.p_servicios[0].reserva_id));
            await page.waitForFunction(()=>document.getElementById('out').textContent.includes('Incorporación completada'));
            await page.locator('.haku-libro-resultado-sites__detalle > summary').click();
            const ingresos=await page.locator('.haku-libro-resultado-sites__ingreso').allInnerTexts();
            assert.ok(ingresos.length>0);assert.ok(ingresos.every(x=>x==='IN: 10.10.26'));
            assert.doesNotMatch(await page.locator('#out').innerText(),/\[object Object\]/);await page.close();
        }
        assert.deepEqual(errores,[]);assert.deepEqual(externos,[]);
        console.log('PASS: auditoría focal a 1100/390/320 px, promo, pago preservado, confirmación con guard existente, sin duplicados ni desbordes.');
    }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
