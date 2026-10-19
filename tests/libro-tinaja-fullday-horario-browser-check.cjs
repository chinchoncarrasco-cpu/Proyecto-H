// Navegador local con el Libro y el cliente simulados; sin acceso a datos reales.
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
    const e=fixtureServicios,r=e.reservas[0],est=e.db.reserva_estadias[0];
    r.tipo_estadia='full_day';r.fecha_checkout=r.fecha_checkin;r.noches=0;
    r.texto_original='FULLDAY // 2adl // 18hrs jacuzzi';
    r.servicios=HAIKU_LIBRO_SEMANTICA.servicios('18hrs jacuzzi',{origen_campo:'notas_reserva'});
    est.tipo_estadia='fullday';est.fecha_salida=est.fecha_ingreso;
    window.haikuTienePermiso=p=>['pagos.ver','servicios.editar'].includes(p);
    e.db.pagos=[{id:'paquete',reserva_id:est.reserva_id,monto:120000,tipo_movimiento:'pago',estado:'confirmado',observaciones:'FULLDAY'}];
    e.db.vista_estado_cargos=[];
    e.db.servicios=[{id:'tinaja-existente',reserva_id:est.reserva_id,estadia_id:est.id,
        catalogo_servicio_id:e.db.catalogo_servicios.find(c=>c.codigo==='tinajaJacuzzi').id,
        fecha_servicio:r.fecha_checkin,hora_inicio:'17:00:00',hora_fin:'18:00:00',cantidad:1,personas:2,
        tipo_cobro:'cortesia',total:0,estado_servicio:'programado',actualizado_en:'2026-10-16T18:24:30+00:00',
        catalogo_servicios:{codigo:'tinajaJacuzzi',nombre:'Tinaja Jacuzzi'}}];
    e.horarios=[];haikuSupabase.rpc=async(nombre,args)=>{
        e.horarios.push({nombre,args});const s=e.db.servicios[0];
        s.hora_inicio=args.p_hora_inicio+':00';s.hora_fin=args.p_hora_fin+':00';s.actualizado_en='2026-10-19T22:00:00+00:00';
        return{data:{ok:true,servicio_id:s.id,tipo_cobro:'cortesia',total:0,hora_inicio:s.hora_inicio,hora_fin:s.hora_fin}};
    };
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
            const fila=page.locator('.haku-libro-servicios__item').filter({hasText:'18hrs jacuzzi'});
            assert.doesNotMatch(await fila.innerText(),/cobro por definir|Falta definir si el servicio es cobrable/);
            await fila.getByRole('button',{name:'Revisar horario',exact:true}).click();
            const panel=fila.locator('.haku-libro-servicio-manual');await panel.waitFor({state:'visible'});
            assert.match(await panel.innerText(),/¿Se modificó el horario de esta misma tinaja\?/);
            assert.equal(await panel.locator('input,select').count(),0);
            await page.waitForFunction(()=>[...document.styleSheets].some(s=>s.href?.includes('haiku-libro-pagos-ui-v1.css')));
            const desbordes=await page.evaluate(()=>[...document.querySelectorAll('.haku-libro-servicios,.haku-libro-servicios__item,.haku-libro-servicio-manual')]
                .filter(el=>el.getBoundingClientRect().width&&el.scrollWidth>el.clientWidth+1).map(el=>el.className));
            assert.deepEqual(desbordes,[],`${width}: sin desbordes internos`);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
            if(process.env.HAKU_HORARIO_SCREENSHOT_DIR){fs.mkdirSync(process.env.HAKU_HORARIO_SCREENSHOT_DIR,{recursive:true});
                await panel.screenshot({path:path.join(process.env.HAKU_HORARIO_SCREENSHOT_DIR,`cambio-horario-${width}.png`)});}
            assert.equal(await page.evaluate(()=>fixtureServicios.horarios.length),0);
            await panel.getByRole('button',{name:'Sí, actualizar horario',exact:true}).click();
            await page.waitForFunction(()=>fixtureServicios.horarios.length===1&&!document.querySelector('.haku-libro-servicio-manual'));
            const actual=await page.evaluate(()=>({s:fixtureServicios.db.servicios,creados:fixtureServicios.escrituras.length}));
            assert.equal(actual.s.length,1);assert.equal(actual.s[0].hora_inicio,'18:00:00');assert.equal(actual.s[0].total,0);assert.equal(actual.creados,0);
            await page.close();
        }
        assert.deepEqual(errores,[]);assert.deepEqual(externos,[]);
        console.log('PASS: cambio de horario a 1100/390/320 px, confirmación, cortesía $0, sin duplicados ni desbordes.');
    }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
