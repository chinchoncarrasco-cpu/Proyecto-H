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
        fecha_servicio:r.fecha_checkin,hora_inicio:'16:15:00',hora_fin:'18:15:00',cantidad:2,personas:2,
        tipo_cobro:'normal',total:30000,estado_servicio:'programado',
        catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera'}}];
    e.db.vista_estado_cargos=[{cargo_id:'cargo-adicional',reserva_id:est.reserva_id,estadia_id:est.id,
        servicio_id:'tinaja-registrada',monto:30000,monto_ajustado:30000,aplicado_neto:30000,saldo_cargo:0,estado:'activo'}];
    e.inspecciones=[];window.HAIKU_INSPECTOR_V1={abrirReserva:id=>e.inspecciones.push(id)};
    e.antes=JSON.stringify(e.db);
    HAIKU_LIBRO_SERVICIOS_SCOPE_V2.renderizar(await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.construir(q),document.getElementById('out'),q);
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
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),0);await page.close();
        }
        assert.deepEqual(errores,[]);assert.deepEqual(externos,[]);
        console.log('PASS: promo a 1100/390/320 px, 10% + 1h, cambio de tinaja, pago preservado, sin pedir cobro ni desbordes.');
    }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
