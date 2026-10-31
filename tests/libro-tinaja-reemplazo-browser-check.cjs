const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.HAKU_PLAYWRIGHT_MODULE||'playwright');
const {setup,consulta}=require('./fixtures/libro-servicio-manual.cjs');
const source=fs.readFileSync(path.join(__dirname,'../js/haiku-libro-servicios-scope-v2.js'),'utf8')
    .replace('const api = Object.freeze({','const api = Object.freeze({renderizar,');
(async()=>{
    const browser=await chromium.launch({headless:true});
    try{
        for(const width of [390,1440]){
            const page=await browser.newPage({viewport:{width,height:900}});
            await page.route('http://haku.test/**',route=>route.fulfill({contentType:'text/css',
                body:fs.readFileSync(path.join(__dirname,'../css/haiku-libro-pagos-ui-v1.css'),'utf8')}));
            await page.setContent('<html lang="es"><head><base href="http://haku.test/"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:8px;font:14px Arial;box-sizing:border-box}*{box-sizing:border-box}</style></head><body><main id="salida"></main></body></html>');
            await page.addScriptTag({path:path.join(__dirname,'../js/haiku-libro-semantica-v1.js')});
            await page.addScriptTag({path:path.join(__dirname,'../js/haiku-servicios-identidad-v1.js')});
            await page.evaluate(setup);
            await page.addScriptTag({content:source});
            await page.evaluate(async texto=>{
                const f=window.fixtureServicios,db=f.db,r=f.reservas[0],est=db.reserva_estadias[0];
                f.reservas=[r];r.texto_original='TONEL 19:15 HRS X PAGAR';
                r.servicios=window.HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
                const c=db.catalogo_servicios.find(c=>c.codigo==='tinajaJacuzzi');
                db.servicios=[{id:'tinaja-original',reserva_id:est.reserva_id,estadia_id:est.id,catalogo_servicio_id:c.id,
                    catalogo_servicios:{codigo:c.codigo,nombre:c.nombre},recurso_id:null,fecha_servicio:r.fecha_checkin,
                    hora_inicio:'20:45:00',hora_fin:'21:45:00',cantidad:1,personas:2,total:30000,precio_unitario_aplicado:30000,
                    monto_adicional:0,tipo_cobro:'normal',estado_servicio:'programado',actualizado_en:'2026-10-10T10:00:00Z',
                    observaciones:'Importado desde Libro de Reserva. JACUZZI 20:45 X PAGAR\n[HAKU-LIBRO-SERVICIO:srv:original]'}];
                db.vista_estado_cargos=[{cargo_id:'cargo-original',reserva_id:est.reserva_id,estadia_id:est.id,
                    servicio_id:'tinaja-original',monto:30000,monto_ajustado:30000,aplicado_neto:30000,saldo_cargo:0,estado:'activo'}];
                db.pagos=[{id:'pago-original',reserva_id:est.reserva_id,monto:30000,tipo_movimiento:'pago',estado:'confirmado'}];
                window.antesFinanzas=JSON.stringify([db.vista_estado_cargos,db.pagos]);window.llamadasRevision=[];
                window.haikuSesion={auth:{id:f.usuario},usuario:{activo:true},roles:[{codigo:'administrador'}]};
                window.haikuTienePermiso=()=>true;
                window.haikuSupabase.rpc=async(nombre,p)=>{
                    if(nombre!=='haiku_libro_revision_servicio_admin_v1')throw Error('RPC ajeno a la revisión');
                    window.llamadasRevision.push(p);
                    const s=db.servicios[0],cat=db.catalogo_servicios.find(c=>c.codigo===p.p_codigo);
                    const estado={...p.p_esperado,catalogo_servicio_id:cat.id,hora_inicio:p.p_inicio,hora_fin:p.p_fin};delete estado.actualizado_en;
                    Object.assign(s,{catalogo_servicio_id:cat.id,catalogo_servicios:{codigo:cat.codigo,nombre:cat.nombre},
                        hora_inicio:p.p_inicio+':00',hora_fin:p.p_fin+':00',actualizado_en:'2026-10-10T10:01:00Z'});
                    s.libro_revision_admin_v1={version:1,item_id:p.p_item_id,firma:p.p_firma,estado,modo:p.p_modo,
                        motivo:p.p_motivo,usuario:f.usuario,operacion_id:p.p_operacion_id,fecha:'2026-10-10T10:01:00Z'};
                    return {data:{ok:true,servicio_id:s.id,total:s.total,revision:s.libro_revision_admin_v1}};
                };
                const api=window.HAIKU_LIBRO_SERVICIOS_SCOPE_V2,plan=await api.construir(texto);
                api.renderizar(plan,document.getElementById('salida'),texto);
            },consulta);
            await page.locator('.haku-libro-servicios__seccion--cambios > summary').click();
            await page.getByRole('button',{name:'Ver cambio del Libro',exact:true}).click();
            const panel=page.locator('.haku-libro-servicio-admin');
            await panel.getByRole('heading',{name:'Tinaja modificada en el Libro'}).waitFor();
            assert.match(await panel.innerText(),/20:45–21:45/);assert.match(await panel.innerText(),/19:15–20:15/);
            assert.equal(await panel.locator('[data-revision-admin="modo"]').isVisible(),false);
            assert.equal(await panel.locator('[data-revision-admin="aceptar"]').isVisible(),false);
            const aplicar=panel.getByRole('button',{name:'Aplicar cambio del Libro',exact:true});
            assert.equal(await aplicar.isEnabled(),true);
            const layout=await panel.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:innerWidth}));
            assert.ok(layout.left>=0&&layout.right<=layout.width+1,JSON.stringify(layout));
            if(process.env.HAKU_BROWSER_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.HAKU_BROWSER_SCREENSHOT_DIR,'tinaja-cambio-'+width+'.png'),fullPage:true});
            await aplicar.click();await page.locator('.haku-libro-revision-admin-resultado').waitFor();
            const resultado=await page.evaluate(()=>({servicios:fixtureServicios.db.servicios.length,
                codigo:fixtureServicios.db.servicios[0].catalogo_servicios.codigo,hora:fixtureServicios.db.servicios[0].hora_inicio,
                fin:fixtureServicios.db.servicios[0].hora_fin,operaciones:llamadasRevision.length,
                altas:fixtureServicios.escrituras.length,finanzas:JSON.stringify([fixtureServicios.db.vista_estado_cargos,fixtureServicios.db.pagos])===antesFinanzas}));
            assert.deepEqual(resultado,{servicios:1,codigo:'tinajaTonel',hora:'19:15:00',fin:'20:15:00',operaciones:1,altas:0,finanzas:true});
            console.log('PASS navegador '+width+' px: cambio, mismo servicio y finanzas conservadas');await page.close();
        }
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

