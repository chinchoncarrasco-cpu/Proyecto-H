// Comprueba la vista Sites con los módulos reales de informe, prioridad y aviso automático.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { auditarContraste } = require('./haiku-tema-browser-check.cjs');
const { setup: setupServicios } = require('./fixtures/libro-servicio-manual.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
            '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/haiku-paleta-v1.css"><link rel="stylesheet" href="/css/supabase-asistente-v1.css">' +
            '<link rel="stylesheet" href="/css/supabase-haku-reconciliacion-v1.css"><link rel="stylesheet" href="/css/sites-asistente-v1.css">' +
            '<link rel="stylesheet" href="/css/haiku-libro-pagos-ui-v1.css"><link rel="stylesheet" href="/css/haiku-tema-oscuro-v1.css">' +
            '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel">' +
            '<header class="haiku-asistente-cabecera"><span>Haku</span><button id="haiku-asistente-cerrar" type="button">Cerrar</button></header>' +
            '<div id="haiku-asistente-mensajes" class="haiku-asistente-mensajes"></div>' +
            '<footer class="haiku-asistente-compositor">Acciones rápidas <input id="haiku-asistente-texto"><button id="haiku-asistente-enviar">Enviar</button></footer>' +
            '</div></div></body></html>'
        );
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try { const content = fs.readFileSync(file); response.writeHead(200, { 'Content-Type': file.endsWith('.svg')?'image/svg+xml':'text/css' }).end(content); }
    catch { response.writeHead(404).end(); }
});

async function comprobarNavegacionAvisoLargo(browser,url) {
    const total=60;
    for(const [width,height] of [[1280,850],[390,844]]){
        const movil=width<720;
        const page=await browser.newPage({viewport:{width,height},hasTouch:movil,isMobile:movil});
        const errores=[];
        page.on('pageerror',e=>errores.push(e.message));
        try{
            await page.goto(url);
            await page.evaluate(total=>{
                const mensajes=document.getElementById('haiku-asistente-mensajes');
                document.querySelector('.haiku-asistente-panel').hidden=true;
                document.getElementById('haiku-asistente-texto').value='Borrador de prueba';
                mensajes.textContent='Conversación conservada';
                const modificadas=Array.from({length:total},(_,i)=>({actual:{id:'r'+i,titular:`Reserva ficticia ${i+1}`,
                    cabana:i%11+1,fecha_checkin:'2099-11-13',fecha_checkout:'2099-11-15'},
                    cambios:[{campo:'noches',antes:3,ahora:2},{campo:'notas_importantes',antes:[],
                        ahora:['Nota ficticia de la reserva para comprobar el desplazamiento.']}]}));
                const listos=modificadas.map(({actual:r})=>({titular:r.titular,cabana:r.cabana,
                    fechaIngreso:r.fecha_checkin,fechaSalida:r.fecha_checkout,resumen:['Actualizar reserva','Noches'],
                    vista:{accion:'Actualizar reserva',campos:[{etiqueta:'Noches',anterior:'3',propuesto:'2'}]}}));
                const pendientes=modificadas.map(({actual:r},i)=>({titular:`Pendiente ficticio ${i+1}`,cabana:r.cabana,
                    tipo:'servicio',fechaIngreso:r.fecha_checkin,servicios:[{nombre:'Masaje',hora:'16:00',
                        motivos:['Falta duración del masaje.'],texto:'Evidencia ficticia de la ficha '+(i+1)}]}));
                const resultado={estado:'ok',libro_actual:{generacion:1},generado_en:'2026-11-13T20:00:00.000Z',
                    modificadas,incorporacion:{listos,pendientes}};
                window.__navegacionAviso={lecturas:0,chat:0,escrituras:0};
                window.HAIKU_LIBRO_RESERVA_V1={estado:()=>({generacion:1})};
                window.HAIKU_ASISTENTE={abrir:()=>__navegacionAviso.chat++};
                window.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1={
                    obtenerResultadoAviso:async()=>{__navegacionAviso.lecturas++;return resultado;},
                    puedeIncorporar:()=>true,incorporarDesdeAviso:async()=>{__navegacionAviso.escrituras++;},
                    mostrarResultado:()=>__navegacionAviso.chat++
                };
            },total);
            for(const file of ['supabase-asistente-libro-prioridad-v1','supabase-asistente-libro-auto-v1'])
                await page.addScriptTag({content:read('js/'+file+'.js')});
            await page.evaluate(()=>dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{
                detail:{carga_automatica:true,tenia_anterior:true,generacion:1}})));
            const aviso=page.locator('body > .haku-libro-auto');
            await aviso.getByText(`Listos para incorporar (${total})`,{exact:true}).waitFor();
            assert.equal(await aviso.locator('.haku-libro-casos__fila').count(),0);
            const fichas=aviso.locator('.haku-libro-auto__ver-detalle');
            assert.equal(await fichas.count(),2);
            await aviso.getByText(/^Ver más casos listos/).press('Space');
            await page.waitForFunction(n=>document.querySelectorAll('body > .haku-libro-auto .haku-libro-auto__ver-detalle').length===n,total);
            assert.equal(await fichas.count(),total);
            await fichas.nth(2).evaluate(el=>{window.__primeraFichaExtra=el;});
            if(!movil){
                // Pasar por varias filas durante el desplazamiento no monta ninguna vista previa.
                await fichas.evaluateAll(filas=>{
                    for(const el of filas.slice(2,10)){
                        el.parentElement.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
                        el.parentElement.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));
                    }
                });
            }
            const primera=fichas.nth(2);
            if(movil)await primera.tap();
            else await primera.hover();
            const cambio=aviso.locator('.haku-libro-auto__detalle-listo:visible');
            await cambio.getByText('Se guardará',{exact:false}).first().waitFor({state:'attached'});
            await cambio.waitFor();
            assert.match(await cambio.textContent(),/Noches.*3.*2/s);
            assert.equal(await aviso.locator('.haku-libro-auto__detalle-operacion').count(),1);
            if(movil)await primera.tap();
            else await primera.press('Escape');
            const extras=aviso.getByText(/^Ver más casos listos/);
            await extras.click();
            await extras.click();
            assert.equal(await primera.evaluate(el=>el===window.__primeraFichaExtra),true);
            await extras.click();

            await aviso.getByText('Cambios detectados por fecha',{exact:true}).click();
            const info=aviso.locator('.haku-libro-auto__prioridad').last();
            await info.click();
            const categoria=aviso.locator('.haku-libro-auto__categoria');
            assert.equal(await categoria.locator('.haku-libro-auto__caso').count(),total);
            await categoria.evaluate(el=>{window.__categoriaAviso=el;});
            await info.click();
            await info.press('Enter');
            assert.equal(await categoria.evaluate(el=>el===window.__categoriaAviso),true);
            const cuerpo=aviso.locator('.haku-libro-auto__cuerpo');
            const ultima=categoria.locator('.haku-libro-auto__caso').last();
            assert.equal(await ultima.locator('dd').first().evaluate(el=>el.checkVisibility({contentVisibilityAuto:true})),false);
            const area=await cuerpo.boundingBox();
            const anterior=await cuerpo.evaluate(el=>el.scrollTop);
            const x=Math.round(area.x+area.width*.55),y=Math.round(area.y+area.height*.75);
            if(movil){
                const cdp=await page.context().newCDPSession(page);
                await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
                for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*22}]});
                await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
                await cdp.detach();
            }else{
                await page.mouse.move(x,y);
                await page.mouse.wheel(0,220);
            }
            await page.waitForFunction(top=>document.querySelector('.haku-libro-auto__cuerpo').scrollTop>top+30,anterior);
            await ultima.evaluate(el=>el.scrollIntoView({block:'center'}));
            await page.waitForFunction(()=>[...document.querySelectorAll('.haku-libro-auto__categoria .haku-libro-auto__caso')]
                .at(-1).querySelector('dd').checkVisibility({contentVisibilityAuto:true}));

            const pendientes=aviso.getByRole('button',{name:`${total} casos pendientes`});
            const posicion=await pendientes.evaluate(async el=>{
                el.scrollIntoView({block:'center'});
                await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                const top=el.closest('.haku-libro-auto__cuerpo').scrollTop;
                el.click();
                return top;
            });
            const filas=aviso.locator('.haku-libro-casos__fila');
            assert.equal(await filas.count(),total);
            if(movil)assert.equal(await aviso.locator('.haku-libro-casos__fila[aria-expanded="true"]').count(),0);
            const ultimaFila=filas.last();
            await ultimaFila.evaluate(el=>el.parentElement.scrollIntoView({block:'center'}));
            await ultimaFila.click();
            const detalle=aviso.locator('.haku-libro-casos__detalle');
            assert.match(await detalle.textContent(),new RegExp(`Evidencia ficticia de la ficha ${total}`));
            assert.equal(await ultimaFila.getAttribute('aria-expanded'),'true');
            if(movil)assert.equal(await ultimaFila.evaluate(el=>{
                const fila=el.getBoundingClientRect(),lista=el.closest('.haku-libro-casos__lista').getBoundingClientRect();
                return fila.bottom>lista.top&&fila.top<lista.bottom;
            }),true);
            await aviso.getByRole('button',{name:'Volver al aviso'}).click();
            const restaurada=await cuerpo.evaluate(el=>el.scrollTop);
            assert.ok(Math.abs(restaurada-posicion)<=2,`${width}: la burbuja conserva su posición al volver (${posicion} → ${restaurada})`);
            assert.equal(await page.locator('#haiku-asistente-mensajes').textContent(),'Conversación conservada');
            assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Borrador de prueba');
            assert.deepEqual(await page.evaluate(()=>__navegacionAviso),{lecturas:1,chat:0,escrituras:0});
            assert.deepEqual(errores,[]);
        }finally{await page.close();}
    }
}

async function comprobarCasosDelAviso(browser, url) {
    const page = await browser.newPage({viewport:{width:1280,height:850}});
    const errores = [], iconos = new Set();
    page.on('pageerror',error=>errores.push(error.message));
    page.on('response',response=>{
        const recurso = new URL(response.url()).pathname;
        if(response.ok()&&recurso.endsWith('.svg'))iconos.add(path.basename(recurso));
    });
    try {
        await page.goto(url);
        await page.evaluate(()=>{
            const fecha='2026-11-07';
            const reserva=(i,titular,cabana)=>({id:'Nov26!AB'+(40+i),titular,cabana,fecha_checkin:fecha,
                fecha_checkout:'2026-11-08',coordenadas_origen:{hoja:'Nov26',celda:'AB'+(40+i)}});
            const faltaDia='Falta una fecha inequívoca del servicio; con estas noches/horario no se puede inferir sin adivinar.';
            const faltaDato='Falta fecha u hora para comprobar el servicio existente sin adivinar.';
            const nombres=['Amelia Torres','Iván Mella','Nicolás Rojas','Elena Salas','Rocío Vidal','Rocío Vidal','Martín Vega','Paula Rivas'];
            const servicios=[
                ['Tonel',[faltaDia,faltaDato]],['Tinaja',['No hay una equivalencia segura con el catálogo de servicios de Proyecto H.']],
                ['Servicio',['No hay una equivalencia segura con el catálogo de servicios de Proyecto H.']],
                ['Masajes',['Falta duración del masaje.','Falta horario del masaje.',faltaDia,faltaDato]],
                ['Masaje',['Semántica ambigua: Información contradictoria de fecha del masaje.']],
                ['Late Check-out',['Haku no puede preparar automáticamente una cortesía para Late Check-out; requiere revisión.']]
            ];
            const pendientes=nombres.map((nombre,i)=>{
                const actual=reserva(i,nombre,[3,1,10,4,9,11,9,1][i]);
                const [concepto,motivos]=servicios[i]||['Reserva',[i===6?'Elige cómo tratar esta reserva en la comparación.':'No se pudo asociar de forma única']];
                const cambio={campo:i<6?'servicios':'adultos',antes:[],ahora:[{concepto}],proyecto:motivos.join(' · ')};
                const contexto={servicios:i<6?[{estado:'revisar',concepto,razon:motivos.join(' · '),razones:motivos,
                    texto:i===3?'Masajes para 2 · Pend. horario contacto@example.test':''}]:[]};
                return {tipo:'modificacion',actual,cambios:[cambio],contexto,revision:{motivos:i===3?['Falta indicar el día.']:[]}};
            });
            const listaCompleta={tipo:'modificacion',actual:{...reserva(8,'Reserva completa',2),adultos:3},accionable:true,
                cambios:[{campo:'adultos',antes:5,ahora:3,proyecto:2,accionable:true}],
                vistaIncorporacion:{campos:[{etiqueta:'Adultos',anterior:'2',propuesto:'3'}],
                    notas:{retiradas:['Llegada a las 18:00'],añadidas:['Llegada a las 20:00 · contacto@example.test · DNI AB123456']}}};
            let generacion=0,informe,registro={version:1,cambios:[]},guardada=false;
            const panel=document.querySelector('.haiku-asistente-panel');
            panel.hidden=true;
            document.getElementById('haiku-asistente-texto').value='Mi consulta sigue aquí';
            window.__abiertosCasos=0;window.__guardadosCasos=0;
            window.HAIKU_ASISTENTE={abrir:()=>window.__abiertosCasos++};
            window.HAIKU_LIBRO_RESERVA_V1={estado:()=>({generacion}),leerCambiosDetectados:async()=>registro,
                guardarCambiosDetectados:async value=>{registro=value;}};
            window.HAIKU_LIBRO_DIFERENCIAS_V1={compararUltimasVersiones:async()=>informe};
            window.HAIKU_LIBRO_CONTEXTO_V1={actualizarDesdeLibro:async x=>x,enriquecer:async x=>x,fraseHistorial:()=>''};
            window.haikuSesion={usuario:{activo:true},roles:['administrador']};
            window.haikuSupabase={auth:{getUser:async()=>({data:{user:{id:'admin-sintetico'}}})}};
            window.HAIKU_LIBRO_CONSULTAS={
                revalidarCambiosDetectados:async cambios=>{
                    const porId=new Map([...pendientes,listaCompleta].map(x=>[x.actual.id,x]));
                    const items=cambios.map(x=>({...x,...porId.get(x.actual.id)}));
                    const listos=items.filter(x=>x.accionable);
                    return {items:guardada?items.filter(x=>!x.accionable):items,
                        resueltos:guardada?listos.map(x=>x.id):[],reservas:guardada?[]:listos.map(x=>x.actual),comparacion:[],q:{}};
                },
                prepararIncorporacion:async()=>({items:[{categoria:'nuevas',seleccionado:true,payload:{tipo:'reserva_actualizar'}}]}),
                confirmarIncorporacion:async()=>{
                    guardada=true;window.__guardadosCasos++;
                    return {resultado:{ok:true,actualizaciones:1},detalle:{actualizaciones:[{titular:listaCompleta.actual.titular,cabana:'CAB 2'}]}};
                }
            };
            window.__publicarCasos=()=>{
                generacion++;
                window.dispatchEvent(new Event('haiku:libro-cambio'));
                informe={estado:'ok',libro_actual:{generacion},modificadas:[...pendientes,listaCompleta].map(({actual,cambios})=>({actual,cambios}))};
                window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{
                    detail:{carga_automatica:true,tenia_anterior:true,generacion}}));
            };
        });
        for(const file of ['supabase-asistente-libro-prioridad-v1','supabase-asistente-libro-incorporacion-v1',
            'supabase-asistente-libro-actualizacion-v1','supabase-asistente-libro-auto-v1'])
            await page.addScriptTag({content:read('js/'+file+'.js')});
        await page.evaluate(()=>__publicarCasos());
        const aviso=page.locator('.haku-libro-auto');
        await aviso.getByText('Listos para incorporar (1)',{exact:true}).waitFor();
        assert.match(await aviso.innerText(),/Reserva completa · CAB 2/);
        assert.doesNotMatch(await aviso.innerText(),/Elena Salas|Amelia Torres/);
        const ficha=aviso.getByRole('button',{name:'Ver cambios de Reserva completa · CAB 2'});
        const vista=aviso.locator('.haku-libro-auto__detalle-listo');
        assert.equal(await ficha.getAttribute('aria-expanded'),'false');
        await ficha.hover();
        await vista.waitFor();
        assert.match(await vista.innerText(),/Antes.*Se guardará.*Adultos.*2.*3/s);
        assert.match(await vista.innerText(),/Notas que se retirarán.*18:00.*Notas que se añadirán.*20:00/s);
        assert.doesNotMatch(await vista.innerText(),/contacto@example\.test|AB123456/);
        const posicion=await vista.evaluate(el=>{
            const caja=el.getBoundingClientRect(),aviso=el.closest('.haku-libro-auto').getBoundingClientRect();
            return {flotante:getComputedStyle(el).position==='fixed',alCostado:caja.right<=aviso.left,
                visible:caja.top>=0&&caja.left>=0&&caja.right<=innerWidth&&caja.bottom<=innerHeight};
        });
        assert.deepEqual(posicion,{flotante:true,alCostado:true,visible:true});
        const capturas=process.env.HAKU_RESUMEN_CAPTURES;
        if(capturas){
            fs.mkdirSync(capturas,{recursive:true});
            for(const tema of ['claro','oscuro']){
                await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
                const a=await aviso.boundingBox(),b=await vista.boundingBox();
                await page.screenshot({path:path.join(capturas,`listos-${tema}-1280.png`),
                    clip:{x:b.x-5,y:a.y-5,width:a.x+a.width-b.x+10,height:Math.max(a.height,b.y+b.height-a.y)+10}});
            }
        }
        await vista.hover();
        assert.equal(await vista.isVisible(),true,'el mouse puede entrar al detalle sin cerrarlo');
        await page.mouse.move(2,2);
        await vista.waitFor({state:'hidden'});
        await page.keyboard.press('Tab');
        await ficha.focus();
        await vista.waitFor();
        await ficha.press('Escape');
        assert.equal(await ficha.getAttribute('aria-expanded'),'false');
        assert.equal(await ficha.evaluate(el=>el===document.activeElement),true);

        const tactil=await page.context().newCDPSession(page);
        await tactil.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
        await page.setViewportSize({width:320,height:568});
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            await ficha.click();
            const compacto=await vista.evaluate(el=>{
                const estilos=window.getComputedStyle(el),fila=el.querySelector('.haku-libro-auto__detalle-campo:not(.haku-libro-auto__detalle-columnas)');
                const anterior=fila.querySelector('.haku-libro-auto__antes'),nuevo=fila.querySelector('.haku-libro-auto__propuesto');
                return {integrado:estilos.position!=='fixed',tipografia:parseFloat(estilos.fontSize),
                    legible:getComputedStyle(anterior).color!==getComputedStyle(nuevo).color,
                    apilado:anterior.getBoundingClientRect().top<nuevo.getBoundingClientRect().top,
                    sinDesborde:el.scrollWidth<=el.clientWidth+1};
            });
            assert.deepEqual(compacto,{integrado:true,tipografia:10.08,legible:true,apilado:true,sinDesborde:true});
            if(capturas)await aviso.screenshot({path:path.join(capturas,`listos-${tema}-320.png`)});
            await ficha.click();
            assert.equal(await vista.isVisible(),false);
        }
        await tactil.send('Emulation.setTouchEmulationEnabled',{enabled:false});
        await tactil.detach();
        await page.setViewportSize({width:1280,height:850});
        assert.equal(await page.evaluate(()=>__guardadosCasos),0);
        const abrir=aviso.getByRole('button',{name:/8 casos pendientes/});
        assert.equal(await abrir.getAttribute('aria-expanded'),'false');
        await abrir.click();
        assert.equal(await aviso.locator('.haku-libro-casos__fila').count(),8);
        assert.equal(await aviso.getByRole('button',{name:'Incorporar',exact:true}).count(),0);
        await aviso.getByRole('button',{name:'Volver al aviso'}).click();
        await aviso.getByRole('button',{name:'Incorporar',exact:true}).click();
        const recibo=aviso.locator('.haku-libro-auto__recibo');
        const encabezadoRecibo=recibo.locator('summary');
        await encabezadoRecibo.getByText('1 actualización',{exact:true}).waitFor();
        assert.equal(await recibo.getAttribute('open'),null);
        assert.doesNotMatch(await recibo.innerText(),/Reserva completa/);
        await encabezadoRecibo.click();
        await recibo.getByText('Reserva completa · CAB 2',{exact:true}).waitFor();
        assert.ok(await abrir.evaluate(el=>el.offsetHeight<=40),'pendientes se presentan en una fila compacta');
        assert.match(await recibo.innerText(),/Reserva completa · CAB 2/);
        assert.doesNotMatch(await aviso.innerText(),/Listos para incorporar|Elena Salas/);
        assert.equal(await aviso.getByRole('button',{name:'Incorporar',exact:true}).count(),0);
        await abrir.click();
        const panel=aviso.locator('.haku-libro-casos'),detalle=panel.locator('.haku-libro-casos__detalle');
        const masaje=panel.getByRole('button',{name:/Elena Salas.*Faltan 3 datos/});
        assert.equal(await panel.locator('.haku-libro-casos__fila').count(),8);
        assert.match(await panel.locator('.haku-libro-casos__encabezado').innerText(),/6 de servicios · 2 de reservas/);
        await masaje.click();
        assert.deepEqual(await detalle.locator('li').allTextContents(),['Fecha del servicio','Horario','Duración']);
        assert.match(await detalle.innerText(),/Nov26, AB43/);
        assert.doesNotMatch(await detalle.innerText(),/sin adivinar|contacto@example\.test|Otros datos por revisar/);

        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const [width,height] of [[1280,850],[390,844],[320,568]]){
                await page.setViewportSize({width,height});
                await page.waitForFunction(movil=>{
                    const lista=document.querySelector('.haku-libro-casos__lista');
                    return lista.contains(document.querySelector('.haku-libro-casos__detalle'))===movil;
                },width<720);
                const medidas=await panel.evaluate(el=>{
                    const aviso=el.parentElement.getBoundingClientRect();
                    const pie=el.querySelector('footer').getBoundingClientRect();
                    const lista=el.querySelector('.haku-libro-casos__lista');
                    const detalle=el.querySelector('.haku-libro-casos__detalle');
                    return {visible:aviso.top>=0&&aviso.left>=0&&aviso.right<=innerWidth&&pie.bottom<=innerHeight,
                        sinDesborde:lista.scrollWidth<=lista.clientWidth+1,
                        movil:lista.contains(detalle),altoBoton:el.querySelector('.haku-libro-casos__completar').offsetHeight,
                        color:getComputedStyle(el.parentElement).backgroundColor};
                });
                assert.deepEqual(medidas,{visible:true,sinDesborde:true,movil:width<720,altoBoton:width<720?44:38,
                    color:tema==='oscuro'?'rgb(32, 45, 38)':'rgb(255, 255, 255)'},tema+' '+width);
                if(capturas)await aviso.screenshot({path:path.join(capturas,'casos-'+tema+'-'+width+'.png')});
            }
        }
        await masaje.click();
        assert.equal(await masaje.getAttribute('aria-expanded'),'false');
        assert.equal(await detalle.isVisible(),false);
        await masaje.click();
        assert.match(await detalle.innerText(),/Confirma la fecha, la hora y la duración\./);
        const sesionTactil=await page.context().newCDPSession(page);
        await sesionTactil.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
        await page.setViewportSize({width:850,height:530});
        assert.equal(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches),true);
        await page.waitForFunction(()=>document.querySelector('.haku-libro-casos__lista')
            .contains(document.querySelector('.haku-libro-casos__detalle')));
        await sesionTactil.send('Emulation.setTouchEmulationEnabled',{enabled:false});
        await sesionTactil.detach();
        await page.setViewportSize({width:320,height:568});
        await page.evaluate(()=>{
            document.querySelector('.haiku-asistente-panel').hidden=false;
            window.dispatchEvent(new Event('haiku:panel-estado'));
        });
        assert.equal(await aviso.getAttribute('data-junto-haku'),'compacto');
        assert.equal(await panel.evaluate(el=>el.querySelector('footer').getBoundingClientRect().bottom<=el.parentElement.getBoundingClientRect().bottom),true);
        await page.setViewportSize({width:1440,height:850});
        await page.waitForFunction(()=>document.querySelector('.haku-libro-auto').dataset.juntoHaku==='1');
        assert.equal(await aviso.evaluate(el=>el.getBoundingClientRect().right<document.querySelector('.haiku-asistente-panel').getBoundingClientRect().left),true);
        await panel.getByRole('button',{name:'Volver al aviso'}).press('Escape');
        assert.equal(await abrir.isVisible(),true);
        assert.equal(await abrir.evaluate(el=>el===document.activeElement),true);
        await abrir.click();
        await page.evaluate(()=>__publicarCasos());
        assert.equal(await panel.isVisible(),true,'una versión nueva conserva la revisión abierta');
        await panel.getByRole('button',{name:'Completar pendientes',exact:true}).click();
        await panel.waitFor({state:'hidden'});
        assert.equal(await page.locator('.haku-incorporacion-aviso').count(),1);
        assert.equal(await page.evaluate(()=>__abiertosCasos),1);
        assert.equal(await page.evaluate(()=>__guardadosCasos),1);
        assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Mi consulta sigue aquí');
        await abrir.waitFor();
        assert.equal(await aviso.getByRole('button',{name:'Incorporar',exact:true}).count(),0);
        assert.doesNotMatch(await aviso.innerText(),/Reserva completa|Amelia Torres/);
        await abrir.click();
        await panel.getByRole('button',{name:'Ver informe',exact:true}).click();
        await panel.waitFor({state:'hidden'});
        assert.equal(await page.locator('.haku-actualizacion-sites').count(),1);
        assert.equal(await page.evaluate(()=>__guardadosCasos),1);
        // Una ficha con cuatro cabañas y otra ficha homónima del mismo lote.
        await page.evaluate(()=>{
            let generacion=100;
            const fecha='2026-11-25',salida='2026-11-26',periodo='25/11/26 → 26/11/26';
            const titular='Camila Ficticia',reservaId='11111111-1111-4111-8111-111111111111';
            const nuevas=[7,8,9,11,10].map(cabana=>({actual:{id:'cab'+cabana,titular,cabana,fecha_checkin:fecha,fecha_checkout:salida}}));
            const informe={estado:'ok',libro_actual:{generacion},nuevas};
            const items=HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.extraerCambiosDetectados(informe,generacion).map(x=>({...x,accionable:true}));
            let guardada=false;
            Object.assign(HAIKU_LIBRO_RESERVA_V1,{estado:()=>({generacion}),leerCambiosDetectados:async()=>({version:1,cambios:[]})});
            HAIKU_LIBRO_DIFERENCIAS_V1.compararUltimasVersiones=async()=>informe;
            HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados=async()=>({items:guardada?[]:items,
                resueltos:guardada?items.map(x=>x.id):[],reservas:guardada?[]:nuevas.map(x=>x.actual),comparacion:[],q:{}});
            HAIKU_LIBRO_CONSULTAS.confirmarIncorporacion=async()=>{
                guardada=true;
                const fila=(cabana,id)=>({titular,cabana:'CAB '+cabana,periodo,fechaIngreso:fecha,identidad:{reservaId:id}});
                return {resultado:{ok:true,reservas_creadas:2,estadias_agregadas:3},detalle:{
                    reservas:[{...fila(7,reservaId),conEstadiasAdicionales:true},
                        fila(10,'22222222-2222-4222-8222-222222222222')],
                    estadias:[8,9,11].map(cabana=>fila(cabana,reservaId))
                }};
            };
            window.dispatchEvent(new Event('haiku:libro-cambio'));
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{carga_manual:true,tenia_anterior:true,generacion}}));
        });
        await aviso.getByRole('button',{name:'Incorporar',exact:true}).click();
        await recibo.locator('summary').getByText('2 reservas · 3 estadías añadidas',{exact:true}).waitFor();
        const detalleGrupo=recibo.locator('.haku-libro-auto__recibo-detalle');
        assert.equal(await detalleGrupo.locator('li').count(),0,'el detalle se construye al abrirlo');
        await encabezadoRecibo.click();
        await detalleGrupo.getByText('Principal · CAB 7',{exact:true}).waitFor();
        const filasGuardadas=detalleGrupo.locator('li');
        assert.equal(await filasGuardadas.count(),2,'los homónimos con distinta ficha no se agrupan');
        assert.equal(await filasGuardadas.first().locator('strong').innerText(),'Camila Ficticia');
        assert.match(await filasGuardadas.first().innerText(),/Añadidas · CAB 8, 9 y 11/);
        assert.equal((await filasGuardadas.first().innerText()).match(/25\/11\/26/g).length,1);
        assert.match(await filasGuardadas.last().innerText(),/Camila Ficticia · CAB 10/);
        if(capturas){
            for(const tema of ['claro','oscuro']){
                await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
                for(const width of [1280,390]){
                    await page.setViewportSize({width,height:850});
                    await aviso.screenshot({path:path.join(capturas,`aviso-grupo-${tema}-${width}.png`)});
                }
            }
        }
        assert.deepEqual(errores,[]);
        for(const icono of ['back.svg','close.svg','check.svg','right.svg','down.svg'])assert.ok(iconos.has(icono),icono);
    } finally {
        await page.close();
    }
}

async function comprobarNotaTinaja(browser,url){
    const page=await browser.newPage({viewport:{width:1100,height:900}}),errores=[];
    page.on('pageerror',error=>errores.push(error.message));
    try{
        await page.goto(url);
        await page.addScriptTag({content:read('js/haiku-libro-semantica-v1.js')});
        await page.evaluate(setupServicios);
        for(const nombre of ['haiku-libro-servicios-scope-v2','haiku-libro-confirm-cancel-fix-v1','supabase-asistente-libro-actualizacion-v1'])
            await page.addScriptTag({content:read(`js/${nombre}.js`)});
        await page.evaluate(()=>{
            const f=fixtureServicios,r=f.reservas[0],e=f.db.reserva_estadias[0];
            r.titular='Huésped sintético';f.db.reservas[0].titular_nombre=r.titular;
            r.texto_original='TINAJA 22:00 // CamaAdicional';r.servicios=HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
            e.estado_estadia='checked_out';f.db.notas.push({reserva_id:e.reserva_id,texto:'CamaAdicional'});
            window.haikuSesion={usuario:{activo:true},roles:['administrador']};window.haikuTienePermiso=p=>p==='notas.gestionar';
            const rpc=haikuSupabase.rpc;
            haikuSupabase.rpc=async(nombre,args)=>{
                const respuesta=await rpc(nombre,args);
                f.db.notas.push(...args.p_notas);
                return {data:{...respuesta.data,servicios_omitidos:0,notas_omitidas:0}};
            };
            window.HAIKU_LIBRO_CONSULTAS={revalidarCambiosDetectados:async registros=>{
                const plan=await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.prepararHistorial({reservas:[r],generacion:1});
                const notas=plan.items.filter(i=>i.kind==='nota').map(i=>({estado:i.estado==='existente'?'en_sistema':'faltante',texto:i.texto}));
                const pendiente=notas.some(n=>n.estado==='faltante');
                return {items:pendiente?registros.map(x=>({...x,sistema:e,estado:'revision',accionable:false,
                    contexto:{servicios:[],notas,hechos:['Esta estadía ya terminó.']}})):[],resueltos:pendiente?[]:registros.map(x=>x.id),
                    resueltosDetalle:pendiente?[]:registros.map(x=>({...x,sistema:e,motivo:'ya_coincide'}))};
            }};
            HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.mostrarResultado({estado:'ok',libro_actual:{generacion:1},
                modificadas:[{anterior:{...r,servicios:[]},actual:r,cambios:[{campo:'servicios',antes:[],ahora:r.servicios}]}]});
        });
        const caso=page.locator('.haku-pendiente-item'),fila=caso.locator('.haku-libro-nota-directa');
        await caso.locator(':scope > summary').click();
        assert.match(await caso.innerText(),/Nota · falta guardar\s*TINAJA 22:00/);
        await caso.getByRole('button',{name:'Aprobación manual',exact:true}).click();
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1100,390,320]){
                await page.setViewportSize({width,height:900});await fila.scrollIntoViewIfNeeded();
                assert.equal(await fila.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
                assert.deepEqual(await page.evaluate(auditarContraste,'.haku-libro-servicio-directo'),[]);
                if(process.env.HAKU_RESUMEN_CAPTURES&&width===390)await fila.screenshot({path:path.join(process.env.HAKU_RESUMEN_CAPTURES,`tinaja-nota-${tema}.png`)});
            }
        }
        assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),0);
        await fila.getByRole('button',{name:'Guardar nota',exact:true}).click();
        await fila.getByText('Nota guardada.',{exact:true}).waitFor();
        assert.deepEqual(await page.evaluate(()=>fixtureServicios.escrituras.map(x=>[x.p_servicios.length,x.p_notas.map(n=>n.texto)])),[[0,['TINAJA 22:00']]]);
        await page.getByText('No quedan cambios pendientes en este informe.',{exact:true}).waitFor();
        await caso.getByRole('button',{name:'Volver a la revisión',exact:true}).click();
        assert.equal(await fila.count(),0);
        assert.deepEqual(errores,[]);
    }finally{await page.close();}
}

async function comprobarPendientesTrasConfirmar(browser,url){
    const page=await browser.newPage({viewport:{width:1100,height:900}}),errores=[];
    page.on('pageerror',error=>errores.push(error.message));
    try{
        await page.goto(url);
        for(const nombre of ['haiku-libro-semantica-v1','haiku-servicios-identidad-v1'])
            await page.addScriptTag({content:read(`js/${nombre}.js`)});
        await page.evaluate(setupServicios);
        for(const nombre of ['haiku-libro-servicios-scope-v2','haiku-libro-confirm-cancel-fix-v1','supabase-asistente-libro-actualizacion-v1'])
            await page.addScriptTag({content:read(`js/${nombre}.js`)});
        await page.evaluate(()=>{
            const f=fixtureServicios,[r,otra]=f.reservas;
            r.texto_original='1 HORA DE CORTESIA TINAJA CONFIRMADA A LAS 22:00 // MASAJE TERAPÉUTICO DE 1 HORA A LAS 10:00 X PAGAR';
            r.servicios=HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
            f.db.reserva_estadias[0].estado_estadia='checked_out';
            window.haikuSesion={usuario:{activo:true},roles:['administrador']};
            window.haikuTienePermiso=p=>p==='servicios.crear';
            window.__cierresHaku=0;
            document.getElementById('haiku-asistente-cerrar').onclick=()=>window.__cierresHaku++;
            const rpc=haikuSupabase.rpc;
            haikuSupabase.rpc=async(nombre,args)=>{
                const respuesta=await rpc(nombre,args);
                for(const p of args?.p_servicios||[]){
                    const c=f.db.catalogo_servicios.find(x=>x.codigo===p.codigo_servicio);
                    f.db.servicios.push({id:p.item_id,reserva_id:p.reserva_id,estadia_id:p.estadia_id,fecha_servicio:p.fecha_servicio,
                        hora_inicio:p.hora,hora_fin:p.servicio_manual_v1.resuelto.hora_fin,catalogo_servicios:c,tipo_cobro:p.tipo_cobro,
                        total:p.servicio_manual_v1.resuelto.total,cantidad:p.cantidad,personas:p.personas,estado_servicio:'programado',
                        observaciones:`[HAKU-LIBRO-SERVICIO:${p.item_id}]`});
                }
                return respuesta;
            };
            window.HAIKU_LIBRO_CONSULTAS={revalidarCambiosDetectados:async registros=>{
                if(window.__fallarActualizacion)throw Error('Lectura temporalmente no disponible');
                const plan=await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.prepararHistorial({reservas:[r,otra],generacion:1});
                const items=[],resueltosDetalle=[];
                for(const registro of registros){
                    const servicios=plan.items.filter(i=>i.kind==='servicio'&&i.reserva.cabana===registro.actual.cabana)
                        .map(i=>({estado:i.estado==='existente'?'en_sistema':i.estado==='listo'?'faltante':'revisar',
                            concepto:i.mapa.nombre||i.servicio.concepto,fecha:i.fecha,hora:i.hora,razones:i.razones}));
                    const sistema=f.db.reserva_estadias.find(e=>f.db.cabanas.some(c=>c.id===e.cabana_id&&c.numero===registro.actual.cabana));
                    if(servicios.every(s=>s.estado==='en_sistema'))resueltosDetalle.push({...registro,sistema,motivo:'ya_coincide'});
                    else items.push({...registro,sistema,estado:'revision',contexto:{servicios}});
                }
                return {items,resueltosDetalle,resueltos:resueltosDetalle.map(x=>x.id)};
            }};
            HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.mostrarResultado({estado:'ok',libro_actual:{generacion:1},
                modificadas:[r,otra].map(actual=>({actual,cambios:[{campo:'servicios',antes:[],ahora:actual.servicios}]}))});
        });
        const history=page.locator('.haku-actualizacion-sites__historial');
        const caso=history.locator('[data-haku-caso]').filter({hasText:'CAB 4'});
        const otro=history.locator('[data-haku-caso]').filter({hasText:'CAB 5'});
        await otro.locator(':scope > summary').click();
        await otro.getByRole('button',{name:'Aprobación manual',exact:true}).click();
        const borrador=await otro.locator('.haku-libro-servicio-manual').elementHandle();
        assert.ok(borrador);
        await caso.locator(':scope > summary').click();
        await caso.getByRole('button',{name:'Aprobación manual',exact:true}).click();
        await caso.getByRole('button',{name:/tinaja.*22:00/i}).click();
        await caso.getByLabel('Tipo de tinaja').selectOption('tinajaTonel');
        await caso.getByRole('button',{name:'Confirmar servicio',exact:true}).click();
        await caso.locator('.haku-pendiente-contexto p').filter({hasText:'Ya registrado.'}).waitFor();
        const recibo=caso.locator('.haku-libro-resultado-sites');
        await recibo.getByText('Incorporación completada',{exact:true}).waitFor();
        assert.equal(await recibo.getByRole('button',{name:'Revisar de nuevo',exact:true}).count(),0);
        assert.equal(await borrador.evaluate(el=>el.isConnected&&el.closest('details').open),true);
        assert.deepEqual(await history.locator('.haku-actualizacion-sites__historial-metricas strong').allInnerTexts(),['2','0']);
        for(const [tema,width] of [['claro',1100],['oscuro',1100],['claro',390],['oscuro',390],['claro',320],['oscuro',320]]){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            await page.setViewportSize({width,height:900});
            assert.equal(await recibo.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
        }
        await recibo.getByRole('button',{name:'Cerrar confirmación'}).click();
        assert.equal(await caso.locator(':scope > summary').evaluate(el=>el.parentElement.open),true);
        await caso.getByRole('button',{name:'Aprobación manual',exact:true}).click();
        await page.evaluate(()=>window.__fallarActualizacion=true);
        await caso.getByRole('button',{name:'Confirmar servicio',exact:true}).click();
        await recibo.getByText('Incorporación completada',{exact:true}).waitFor();
        await history.getByText('Por comprobar',{exact:true}).waitFor();
        await page.evaluate(()=>window.__fallarActualizacion=false);
        await history.getByRole('button',{name:'Volver a revisar',exact:true}).click();
        const resuelto=history.locator('.haku-pendientes-resueltos').locator('[data-haku-caso]').filter({hasText:'CAB 4'});
        await resuelto.getByText('Incorporación completada',{exact:true}).waitFor();
        assert.equal(await resuelto.getByRole('button',{name:'Aprobación manual',exact:true}).count(),0);
        assert.deepEqual(await history.locator('.haku-actualizacion-sites__historial-metricas strong').allInnerTexts(),['1','0']);
        await resuelto.getByRole('button',{name:'Cerrar confirmación'}).click();
        assert.match(await resuelto.innerText(),/El aviso anterior ya no requiere cambios/);
        assert.equal(await page.evaluate(()=>window.__cierresHaku),0);
        assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),2);
        assert.deepEqual(errores,[]);
    }finally{await page.close();}
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: process.env.HAKU_CHROMIUM_PATH || edge, headless: true, args:['--no-sandbox'] });
    try {
        const contexto = await browser.newContext({ viewport: { width: 600, height: 900 } });
        const page = await contexto.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(() => {
            window.__generation = 1;
            window.__closed = 0;
            window.__opened = 0;
            window.__revalidations = 0;
            window.__preparations = 0;
            window.__preparationScopes=[];
            window.__registration = { version: 1, cambios: [] };
            window.__pending = null;
            window.__revalidationMode = 'ready';
            window.__sawLegacy = false;
            window.__reservasAbiertas=[];
            window.HAIKU_INSPECTOR_V1={abrirReserva:id=>window.__reservasAbiertas.push(id)};
            window.__revisionesServicios=[];
            window.HAIKU_LIBRO_SERVICIOS_SCOPE_V2={abrirRevisionHistorial:async(el,scope)=>{
                window.__revisionesServicios.push(scope);el.className='haku-libro-servicios';el.textContent='Servicios y notas auditados';
            }};
            document.getElementById('haiku-asistente-cerrar').addEventListener('click', () => window.__closed++);
            new MutationObserver(() => {
                window.__sawLegacy ||= Boolean(document.querySelector('.haku-actualizacion-compacta'));
            }).observe(document.getElementById('haiku-asistente-mensajes'), { childList: true, subtree: true });
            window.HAIKU_ASISTENTE = { abrir: () => window.__opened++ };
            window.HAIKU_LIBRO_RESERVA_V1 = {
                estado: () => ({ generacion: window.__generation }),
                leerCambiosDetectados: async () => window.__registration,
                guardarCambiosDetectados: async value => { window.__registration = value; }
            };
            window.HAIKU_LIBRO_DIFERENCIAS_V1 = { compararUltimasVersiones: async () => window.__resultadoActual };
            window.HAIKU_LIBRO_CONSULTAS = {
                revalidarCambiosDetectados: async () => {
                    window.__revalidations++;
                    if (window.__revalidationMode === 'pending') return new Promise((resolve, reject) => { window.__pending = { resolve, reject }; });
                    if (window.__revalidationMode === 'error') throw new Error('Fallo focal de prueba');
                    return structuredClone(window.__pendientesActual);
                },
                abrirPreparacionComparacion: async (element,scope) => { window.__preparations++;window.__preparationScopes.push(structuredClone(scope));element.textContent = 'Preparación canónica abierta'; }
            };
            const empty = { estado: 'sin_cambios', nuevas: [], modificadas: [], ya_no_aparecen: [], ambiguas: [],
                cancelaciones_confirmadas: [], advertencias: [], no_comparables: [], libro_actual: { generacion: 1 } };
            window.__resultadoActual = empty;
            window.__pendientesActual = { items: [], resueltos: [], reservas: [], comparacion: [], q: null };
        });
        for (const file of [
            'js/supabase-asistente-libro-prioridad-v1.js',
            'js/supabase-asistente-libro-incorporacion-v1.js',
            'js/supabase-asistente-libro-actualizacion-v1.js',
            'js/supabase-asistente-libro-auto-v1.js'
        ]) await page.addScriptTag({ content: read(file) });

        await page.evaluate(() => window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada', {
            detail: { carga_manual: true, tenia_anterior: true, generacion: 1 }
        })));
        const announcement = page.locator('#haiku-asistente-mensajes .haiku-asistente-mensaje').filter({ hasText: 'Ver informe' }).last();
        await announcement.locator('button').click();
        const first = page.locator('.haku-actualizacion-sites').last();
        assert.equal(await first.count(), 1);
        assert.equal(await page.evaluate(() => window.__opened), 1);
        assert.match(await first.locator('.haku-actualizacion-sites__mensaje').innerText(), /Las reservas no cambiaron respecto de la copia anterior del Libro/);
        assert.deepEqual(await first.locator('.haku-actualizacion-sites__metricas strong').allInnerTexts(), ['0', '0', '0', '0']);
        assert.deepEqual(await first.locator('.haku-prioridad-fila > .haku-actualizacion-sites__fila-vacia strong').allInnerTexts(), ['0', '0', '0', '0']);
        assert.equal(await first.locator('.haku-actualizacion-sites__sin-cambios').count(), 1);
        await page.waitForFunction(() => document.querySelector('.haku-actualizacion-sites__historial')?.textContent.includes('No quedan cambios pendientes en este informe'));
        assert.equal(await announcement.count(), 0, 'el aviso previo se integra en el informe abierto');
        assert.equal(await page.locator('.haku-actualizacion-sites').count(), 1);

        await page.evaluate(() => {
            const base = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
            const date = delta => {
                const value = new Date(`${base}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + delta);
                return value.toISOString().slice(0, 10);
            };
            const row = (id, day, titular) => ({ id, cabana: 2, titular, fecha_checkin: date(day), fecha_checkout: date(day + 1), noches: 1 });
            const nueva = row('new', 0, 'Yervic Enrique');
            const antes = row('changed-old', 1, 'Camila Ortega');
            const ahora = { ...antes, id: 'changed-new', adultos: 3 };
            window.haikuSesion={usuario:{activo:true},roles:[{codigo:'administrador'}]};
            const ausente = row('gone', 2, 'Martín López');
            const candidato = row('candidate', 10, 'Titular pendiente');
            window.__resultadoActual = {
                estado: 'ok', nuevas: [{ actual: nueva }], modificadas: [{ anterior: antes, actual: ahora, cambios: [{ campo: 'adultos', antes: 2, ahora: 3 }] }],
                ya_no_aparecen: [{ anterior: ausente }], ambiguas: [{ motivo: 'Asociación no determinada.', anteriores: [], actuales: [candidato] }],
                cancelaciones_confirmadas: [], advertencias: [], no_comparables: [], libro_actual: { generacion: 2 }
            };
            window.__pendientesActual = {
                items: [{ tipo: 'modificacion', actual: ahora, detectado_generacion: 2, estado: 'pendiente', accionable: true,
                    sistema:{reserva_id:'reserva-sintetica'},cambios: [{ campo: 'adultos', antes: 2, ahora: 3, proyecto: 2 }],
                    preparacion:{reservas:[ahora],comparacion:[],generacion:2,q:{desde:ahora.fecha_checkin,hasta:ahora.fecha_checkout}} }],
                resueltos: [], reservas: [ahora], comparacion: [], q: { texto: 'informe' },revisionServicios:{reservas:[ahora],generacion:2}
            };
            window.__generation = 2;
            window.dispatchEvent(new Event('haiku:libro-cambio'));
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada', {
                detail: { carga_manual: true, tenia_anterior: true, generacion: 2 }
            }));
        });
        const secondAnnouncement = page.locator('.haku-libro-auto').filter({hasText:'Ver informe'});
        await secondAnnouncement.getByRole('button',{name:'Ver informe',exact:true}).click();
        assert.equal(await page.locator('.haku-actualizacion-sites').count(),2,'el aviso de fondo conserva el informe abierto');
        assert.equal(await page.locator('#haiku-asistente-mensajes .haiku-asistente-mensaje').filter({hasText:'Ver informe'}).count(),0,
            'una consulta abierta recibe la burbuja sin insertar otro mensaje');
        const report = page.locator('.haku-actualizacion-sites').last();
        assert.deepEqual(await report.locator('.haku-actualizacion-sites__metricas strong').allInnerTexts(), ['1', '1', '1', '1']);
        assert.deepEqual(await report.locator('.haku-prioridad-fila > summary strong').allInnerTexts(), ['1', '1', '1', '1']);
        assert.equal(await report.locator('.haku-actualizacion-sites__sin-cambios').count(), 0);
        if (process.env.HAKU_ACTUALIZACION_SCREENSHOT) {
            await report.evaluate(element => element.scrollIntoView({ block: 'start' }));
            await page.screenshot({ path: process.env.HAKU_ACTUALIZACION_SCREENSHOT });
        }
        for (const category of await report.locator('details.haku-prioridad-fila').all()) {
            await category.locator('summary').click();
            assert.equal(await category.getAttribute('open'), '');
            assert.match(await category.innerText(), /CAB 2/);
            await category.locator('summary').click();
            assert.equal(await category.getAttribute('open'), null);
        }
        const modified = report.locator('.haku-actualizacion-sites__grupo--modificadas');
        await modified.locator(':scope > summary').click();
        await modified.locator('.haku-pregunta-caso > summary').click();
        assert.match(await modified.innerText(), /Antes: 2\s+Ahora: 3/);
        await page.waitForFunction(() => document.querySelectorAll('.haku-actualizacion-sites__historial').length === 2);
        const history = report.locator('.haku-actualizacion-sites__historial');
        assert.match(await history.innerText(), /Qué falta resolver en Proyecto H/);
        await history.locator('.haku-actualizacion-sites__pendiente > summary').click();
        const comparacion = history.getByText('Ver comparación de datos (1)', { exact: true });
        await comparacion.click();
        assert.match(await history.innerText(), /En Proyecto H: 2/);
        await comparacion.click();
        await history.getByRole('button',{name:'Ver reserva',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>window.__reservasAbiertas),['reserva-sintetica']);
        assert.equal(await history.locator('[data-haku-preparar-pendientes]').count(), 1);
        await history.locator('[data-haku-preparar-pendientes]').click();
        await page.waitForFunction(() => window.__preparations === 1);
        assert.equal(await page.getByRole('button',{name:'Preparar cambios en Proyecto H',exact:true}).count(),0);
        const manual=history.getByRole('button',{name:'Aprobación manual',exact:true});
        for(const width of [1100,390,320]){
            await page.setViewportSize({width,height:900});await manual.click();
            assert.equal(await history.locator('.haku-pendiente-detalle .haku-libro-preparacion-zona').count(),1);
            assert.match(await history.locator('.haku-pendiente-detalle .haku-libro-preparacion-zona').innerText(),/Preparación canónica abierta/);
            assert.equal(await history.locator('.haku-pendiente-detalle').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
            if(process.env.HAKU_PENDIENTES_SCREENSHOT_DIR){
                fs.mkdirSync(process.env.HAKU_PENDIENTES_SCREENSHOT_DIR,{recursive:true});
                await history.locator('.haku-actualizacion-sites__pendiente').screenshot({path:path.join(process.env.HAKU_PENDIENTES_SCREENSHOT_DIR,`revision-${width}.png`)});
            }
        }
        assert.equal(await page.evaluate(()=>__preparationScopes.slice(1).every(x=>x.reservas.length===1&&x.reservas[0].id==='changed-new'&&x.generacion===2)),true);
        const prev=await page.evaluate(()=>__preparations);
        await page.evaluate(()=>haikuSesion.roles=[]);await manual.click();assert.equal(await page.evaluate(()=>__preparations),prev,'revalida el rol al abrir');
        await page.evaluate(()=>haikuSesion.roles=[{codigo:'administrador'}]);
        await page.setViewportSize({width:600,height:900});
        await history.getByRole('button',{name:'Revisar servicios y notas',exact:true}).click();
        await page.waitForFunction(()=>window.__revisionesServicios.length===1);
        assert.equal(await page.evaluate(()=>window.__revisionesServicios[0].reservas.length),1);
        await history.getByRole('button',{name:'Revisar servicios y notas',exact:true}).click();
        assert.equal(await report.locator('.haku-libro-revision-servicios-zona').count(),1,'reabrir sustituye la revisión focal previa');

        const before = await page.evaluate(() => window.__revalidations);
        await page.evaluate(() => { window.__revalidationMode = 'pending'; });
        const refresh = await history.locator('[data-haku-revalidar-proyecto]').elementHandle();
        await refresh.click();
        await page.waitForFunction(count => window.__revalidations === count + 1, before);
        assert.deepEqual(await refresh.evaluate(element => [element.disabled, element.textContent, element.getAttribute('aria-busy')]),
            [true, 'Revisando…', 'true']);
        await refresh.evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await page.evaluate(() => window.__revalidations), before + 1, 'doble clic no duplica revalidación');
        await page.evaluate(() => window.__pending.reject(new Error('Fallo focal de prueba')));
        await history.getByText('Conservé los pendientes. Falta comprobarlos en Proyecto H.',{exact:true}).waitFor();
        assert.ok(await history.locator('.haku-actualizacion-sites__pendiente').count()>0);
        assert.equal(await history.locator('[data-haku-preparar-pendientes]').count(),0);
        await page.evaluate(() => { window.__revalidationMode = 'ready'; });
        await history.getByRole('button',{name:'Volver a revisar',exact:true}).click();
        await history.locator('[data-haku-preparar-pendientes]').waitFor();
        // Otro operador aplicó el cambio antes de preparar. Refrescar el
        // informe conserva la revisión de servicios y retira el contador viejo.
        await page.evaluate(()=>{
            window.__pendientesActual={items:[{tipo:'modificacion',actual:{titular:'Reserva de horario',cabana:1,
                fecha_checkin:'2026-10-15',fecha_checkout:'2026-10-15'},estado:'revision',accionable:false,
                sistema:{reserva_id:'tinaja-sintetica'},cambios:[{campo:'servicios',antes:[],ahora:[{concepto:'jacuzzi',hora:'18:00'}],
                    proyecto:'Ya existe a las 17:00. Confirma si se modificó el horario.'}]}],resueltos:[],reservas:[],comparacion:[],q:null};
            window.HAIKU_LIBRO_CONSULTAS.abrirPreparacionComparacion=async()=>{throw Object.assign(Error('No quedan cambios de reservas'),{haikuSinCambiosPreparables:true});};
        });
        await report.locator('[data-haku-preparar-pendientes]').click();
        await page.waitForFunction(()=>document.querySelectorAll('.haku-actualizacion-sites__historial')[1]?.textContent.includes('Reserva de horario'));
        assert.deepEqual(await history.locator('.haku-actualizacion-sites__historial-metricas strong').allInnerTexts(),['1','0']);
        assert.equal(await history.locator('[data-haku-preparar-pendientes]').count(),0);
        assert.doesNotMatch(await history.innerText(),/No quedan cambios pendientes en este informe|No quedan cambios de reservas/);
        await history.locator('.haku-actualizacion-sites__pendiente > summary').click();
        await history.getByRole('button',{name:'Ver reserva',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>window.__reservasAbiertas),['reserva-sintetica','tinaja-sintetica']);
        const manualServicio=history.getByRole('button',{name:'Aprobación manual',exact:true});
        const revisionesAntes=await page.evaluate(()=>window.__revisionesServicios.length);
        const preparacionesAntes=await page.evaluate(()=>window.__preparations);
        for(const width of [1100,390,320]){
            await page.setViewportSize({width,height:900});await manualServicio.click();
            const medidas=await history.locator('.haku-pendiente-detalle > .haku-actualizacion-sites__historial-acciones > button').evaluateAll(bs=>bs.map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})));
            assert.ok(Math.abs(medidas[0].width-medidas[1].width)<1,'ambos botones tienen el mismo ancho');
            assert.ok(Math.abs(medidas[0].height-medidas[1].height)<1,'ambos botones tienen el mismo alto');
            const panel=history.locator('.haku-pendiente-detalle .haku-libro-preparacion-zona');
            assert.equal(await panel.count(),1,'reabrir conserva un único panel dentro de la tarjeta');
            assert.match(await panel.innerText(),/Servicios y notas auditados/);
            assert.equal(await history.locator('.haku-actualizacion-sites__pendiente').getAttribute('open'),'');
            assert.equal(await history.locator('.haku-pendiente-detalle').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
        }
        assert.equal(await page.evaluate(()=>window.__preparations),preparacionesAntes,'servicios nunca abre el writer de reservas');
        const scopesServicios=await page.evaluate(n=>window.__revisionesServicios.slice(n),revisionesAntes);
        assert.equal(scopesServicios.length,3);
        assert.ok(scopesServicios.every(s=>s.aprobacionManual===true&&s.generacion===2&&s.reservas.length===1&&s.reservas[0].titular==='Reserva de horario'));
        await page.evaluate(()=>haikuSesion.roles=[]);await manualServicio.click();
        assert.equal(await page.evaluate(()=>window.__revisionesServicios.length),revisionesAntes+3,'revalida administrador al pulsar');
        await page.evaluate(()=>{
            haikuSesion.roles=[{codigo:'administrador'}];
            window.__serviciosOriginal=HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial;
            HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial=()=>new Promise((resolve,reject)=>{window.__revisionServicioPendiente={resolve,reject};});
        });
        await manualServicio.click();
        assert.equal(await manualServicio.isDisabled(),true);
        await page.evaluate(()=>window.__revisionServicioPendiente.reject(Error('El Libro cambió; vuelve a revisar el informe.')));
        await page.waitForFunction(()=>!document.querySelectorAll('[data-haku-aprobar-pendiente]')[0]?.disabled);
        assert.match(await history.locator('.haku-libro-preparacion-zona').innerText(),/El Libro cambió/);
        await page.evaluate(()=>HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial=window.__serviciosOriginal);
        await manualServicio.click();
        assert.equal(await history.locator('.haku-pendiente-detalle .haku-libro-preparacion-zona').count(),1);
        assert.match(await history.locator('.haku-libro-preparacion-zona').innerText(),/Servicios y notas auditados/);
        assert.equal(await page.evaluate(() => window.__sawLegacy), false);
        assert.doesNotMatch(await report.innerText(), /Vista de ejemplo basada en captura|datos de muestra|prototipo|demostración/);
        await report.locator('[data-haku-cerrar-actualizacion]').click();
        assert.equal(await page.evaluate(() => window.__closed), 1);
        await page.setViewportSize({ width: 390, height: 420 });
        const fit = await report.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, overflow: getComputedStyle(element).overflowY }));
        assert.ok(fit.scroll <= fit.client + 1, `móvil sin scroll horizontal: ${fit.scroll}/${fit.client}`);
        assert.equal(fit.overflow, 'visible');
        for(const width of [1100,390,320]){
            await page.setViewportSize({width,height:900});
            const fitHistory=await history.evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));
            assert.ok(fitHistory.scroll<=fitHistory.client+1,`${width}: historial sin desborde`);
            if(process.env.HAKU_HISTORIAL_SCREENSHOT_DIR){fs.mkdirSync(process.env.HAKU_HISTORIAL_SCREENSHOT_DIR,{recursive:true});
                await history.screenshot({path:path.join(process.env.HAKU_HISTORIAL_SCREENSHOT_DIR,`historial-${width}.png`)});}
        }
        await page.setViewportSize({width:390,height:420});
        assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('haiku-asistente-mensajes')).scrollbarWidth), 'thin');
        const area = page.locator('#haiku-asistente-mensajes');
        await area.evaluate(element => { element.scrollTop = 0; });
        const box = await report.boundingBox();
        await page.mouse.move(box.x + 30, Math.min(box.y + 180, 320));
        await page.mouse.wheel(0, 300);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 0);
        await area.evaluate(element => { element.scrollTop = 0; });
        const touch = await page.context().newCDPSession(page);
        await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        for (const [type, y] of [['touchStart', 330], ['touchMove', 270], ['touchMove', 210], ['touchMove', 150], ['touchEnd', 150]]) {
            await touch.send('Input.dispatchTouchEvent', {
                type, touchPoints: type === 'touchEnd' ? [] : [{ x: 190, y, id: 1 }]
            });
        }
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 0);
        await touch.detach();
        await page.evaluate(()=>{
            window.__generation=3;window.dispatchEvent(new Event('haiku:libro-cambio'));
            window.__pendientesActual={items:[],resueltos:[],reservas:[],comparacion:[],q:null};
            window.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.mostrarResultado({estado:'sin_cambios',libro_actual:{generacion:3},
                nuevas:[],modificadas:[],ya_no_aparecen:[],ambiguas:[],no_comparables:[],
                advertencias:['anterior','actual'].map(version=>({hoja:'Oct26',version,
                    detalles:['Las noches escritas no coinciden con las fechas combinadas; confirmar ingreso/salida.']}))});
        });
        const avisos=page.locator('.haku-actualizacion-sites').last().locator('.haku-prioridad--informativos');
        await avisos.locator(':scope > summary').click();
        assert.equal(await avisos.locator('.haku-actualizacion-sites__caso').count(),2);
        const textoAvisos=await avisos.innerText();
        assert.match(textoAvisos,/Versión anterior · Oct26/);assert.match(textoAvisos,/Versión actual · Oct26/);
        assert.equal((textoAvisos.match(/La cantidad de noches escrita no coincide/g)||[]).length,2);
        assert.doesNotMatch(textoAvisos,/Titular no disponible|CAB —|Fechas no determinadas/);
        await page.waitForFunction(()=>document.querySelectorAll('.haku-libro-pendientes-zona')[
            document.querySelectorAll('.haku-libro-pendientes-zona').length-1]?.textContent.includes('No quedan cambios pendientes'));
        assert.doesNotMatch(await page.locator('.haku-actualizacion-sites').last().innerText(),/Llegó una versión nueva del Libro/,
            'un resultado directo con generación explícita no depende de un WeakMap privado');
        for(const width of [1100,390,320]){
            await page.setViewportSize({width,height:900});
            assert.equal(await avisos.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`${width}: avisos sin desbordes`);
            if(process.env.HAKU_AVISOS_SCREENSHOT_DIR){fs.mkdirSync(process.env.HAKU_AVISOS_SCREENSHOT_DIR,{recursive:true});
                await avisos.screenshot({path:path.join(process.env.HAKU_AVISOS_SCREENSHOT_DIR,`avisos-${width}.png`)});}
        }
        // Conservar el informe, incluso si el Libro avanzó antes de abrirlo y
        // otra vez antes de pulsar su acción. La preparación recibe lo vigente.
        await page.evaluate(()=>{
            window.__generation=4;window.dispatchEvent(new Event('haiku:libro-cambio'));
            window.haikuSesion={usuario:{activo:true},roles:['administrador']};
            const actual={id:'Nov26!X7',titular:'Reserva de continuidad',cabana:5,fecha_checkin:'2026-11-06',fecha_checkout:'2026-11-08',adultos:3};
            window.__pendientesActual={items:[{id:'caso-continuidad',tipo:'modificacion',actual,accionable:true,
                sistema:{reserva_id:'reserva-continuidad'},
                cambios:[{campo:'adultos',antes:2,ahora:3,proyecto:2}],preparacion:{reservas:[actual],comparacion:[],generacion:4,q:{}}}],
                resueltos:[],reservas:[actual],comparacion:[],q:{}};
            window.HAIKU_LIBRO_CONTEXTO_V1={actualizarDesdeLibro:async x=>x,enriquecer:async x=>x,fraseHistorial:()=>''};
            window.HAIKU_LIBRO_CONSULTAS.abrirPreparacionComparacion=async(el,scope)=>{
                window.__preparationScopes.push(structuredClone(scope));el.textContent='Continuidad comprobada';
            };
            window.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.mostrarResultado({estado:'ok',libro_actual:{generacion:3},
                modificadas:[{actual:{...actual,adultos:2},cambios:[{campo:'adultos',antes:1,ahora:2}]}]});
            document.getElementById('haiku-asistente-texto').value='Mi consulta sigue aquí';
        });
        const conservado=page.locator('.haku-actualizacion-sites').last();
        await page.waitForFunction(()=>{
            const zonas=document.querySelectorAll('.haku-libro-pendientes-zona'),ultima=zonas[zonas.length-1];
            return ultima?.querySelector('.haku-actualizacion-sites__historial,.haku-libro-pendientes-error');
        });
        const estadoConservado=await conservado.locator('.haku-libro-pendientes-zona').innerText();
        assert.match(estadoConservado,/Revisar cambios/,'el informe conservado ofrece acciones: '+estadoConservado+'; errores: '+JSON.stringify(errors));
        await conservado.getByRole('button',{name:'Revisar cambios',exact:true}).click();
        assert.equal(await page.evaluate(()=>__preparationScopes.at(-1).generacion),4);
        await conservado.locator('.haku-actualizacion-sites__pendiente > summary').click();
        await page.evaluate(()=>{
            __generation=5;window.dispatchEvent(new Event('haiku:libro-cambio'));
            __pendientesActual.items[0].actual.adultos=4;
            __pendientesActual.items[0].preparacion.generacion=5;
        });
        await conservado.getByRole('button',{name:'Aprobación manual',exact:true}).click();
        await page.waitForFunction(()=>__preparationScopes.at(-1).generacion===5);
        assert.equal(await page.evaluate(()=>__preparationScopes.at(-1).reservas[0].adultos),4);
        assert.equal(await conservado.locator('.haku-actualizacion-sites__pendiente').getAttribute('open'),'');
        assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Mi consulta sigue aquí');
        assert.match(await conservado.innerText(),/Continuidad comprobada/);
        assert.doesNotMatch(await conservado.innerText(),/Llegó una versión nueva|Genera el informe nuevamente/);
        // Guardado directo desde la burbuja, sin abrir Haku ni reemplazar la consulta.
        const informesAntes=await page.locator('.haku-actualizacion-sites').count();
        const abiertosAntes=await page.evaluate(()=>__opened);
        await page.evaluate(()=>{
            __registration={version:1,cambios:[]};
            __generation=6;window.dispatchEvent(new Event('haiku:libro-cambio'));
            const actual={id:'Nov26!AB10',titular:'Cristian Sintético',cabana:8,
                fecha_checkin:'2026-11-07',fecha_checkout:'2026-11-09',adultos:2};
            const jacuzzi={concepto:'jacuzzi',hora:'19:15'};
            const masaje={concepto:'masaje',hora:'16:00'};
            const cambios=[{campo:'servicios',antes:[],ahora:[jacuzzi,masaje]}];
            __resultadoActual={estado:'ok',libro_actual:{generacion:6},modificadas:[{actual,
                cambios}]};
            const [detectado]=HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.extraerCambiosDetectados(__resultadoActual,6);
            const razon='El Libro indica coordinación pendiente para un masaje que figura programado.';
            const revisar={...detectado,sistema:{reserva_id:'r-cristian'},contexto:{servicios:[
                {estado:'revisar',concepto:'Masaje',hora:'16:00',razon}
            ]}};
            const campo={canonico:true,reserva:actual};
            __pendientesActual={items:[revisar],resueltos:[],reservas:[],comparacion:[],revisionServicios:{reservas:[actual],generacion:6},
                serviciosContexto:[
                    {...campo,estado:'faltante',item_id:'srv:jacuzzi',servicio:jacuzzi,lectura:{nombre:'Jacuzzi',fecha:'2026-11-07',hora:'19:15'}},
                    {...campo,estado:'revisar',item_id:'srv:masaje',servicio:masaje,lectura:{nombre:'Masaje',hora:'16:00'},razon}
                ],
                notasContexto:[{...campo,estado:'faltante',item_id:'nota:batas',texto:'Dejar batas'}]};
            window.haikuTienePermiso=()=>true;
            window.__scopesAviso=[];window.__escriturasAviso=0;
            HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados=async cambios=>{
                __scopesAviso.push(structuredClone(cambios));return structuredClone(__pendientesActual);
            };
            window.haikuSupabase={auth:{getUser:async()=>({data:{user:{id:'u-sintetico'}}})}};
            window.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4={crearIncorporacionAviso:scope=>{
                window.__scopeServicio=scope;
                return ()=>new Promise(resolve=>{__escriturasAviso++;window.__resolverGuardado=()=>{
                    __pendientesActual={...__pendientesActual,items:[{...revisar,cambios:[{campo:'servicios',ahora:[masaje],proyecto:razon}]}],
                        serviciosContexto:__pendientesActual.serviciosContexto.filter(x=>x.estado==='revisar'),notasContexto:[]};
                    resolve({ok:true,servicios_creados:1,notas_creadas:1,confirmados:[
                        {titular:actual.titular,cabana:8,reservaId:'r-cristian',fechaIngreso:actual.fecha_checkin,detalles:[['Jacuzzi','2026-11-07','19:15']]},
                        {titular:actual.titular,cabana:8,reservaId:'r-cristian',fechaIngreso:actual.fecha_checkin,detalles:[['Nota de la reserva','Dejar batas']]}
                    ]});
                };});
            }};
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{
                detail:{carga_automatica:true,origen:'google',tenia_anterior:true,generacion:6}
            }));
        });
        const burbuja=page.locator('.haku-libro-auto');
        await burbuja.getByText('Listos para incorporar (1)',{exact:true}).waitFor();
        const pendienteMixto=burbuja.getByRole('button',{name:/1 caso pendiente/});
        assert.equal(await pendienteMixto.getAttribute('aria-expanded'),'false');
        const fichaMixta=burbuja.getByRole('button',{name:/Ver cambios de Cristian Sintético/});
        await fichaMixta.click();
        const vistaMixta=burbuja.locator('.haku-libro-auto__detalle-listo');
        assert.match(await vistaMixta.innerText(),/Añadir a la reserva.*Dejar batas.*Jacuzzi.*19:15/s);
        assert.doesNotMatch(await burbuja.innerText(),/Masaje|coordinación pendiente/);
        await burbuja.getByRole('button',{name:'Incorporar',exact:true}).click();
        await page.waitForFunction(()=>typeof __resolverGuardado==='function');
        const incorporando=burbuja.getByRole('button',{name:'Incorporando…',exact:true});
        assert.equal(await incorporando.isDisabled(),true);
        await incorporando.dispatchEvent('click');
        await burbuja.getByText('Cambios detectados por fecha',{exact:true}).click();
        const categoriasGuardando=burbuja.locator('.haku-libro-auto__prioridad');
        await categoriasGuardando.last().click();
        assert.equal(await incorporando.getAttribute('aria-busy'),'true','filtrar no interrumpe la incorporación');
        await categoriasGuardando.last().click();
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1100,390,320]){
                await page.setViewportSize({width,height:900});
                assert.equal(await burbuja.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`${tema} ${width}: aviso sin desbordes`);
                assert.equal(await incorporando.evaluate(el=>getComputedStyle(el,'::before').animationName),'haku-aviso-incorporando');
            }
        }
        await page.evaluate(()=>{
            __generation=7;window.dispatchEvent(new Event('haiku:libro-cambio'));
            __resultadoActual={estado:'sin_cambios',libro_actual:{generacion:7},nuevas:[],modificadas:[]};
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{
                detail:{carga_automatica:true,origen:'google',tenia_anterior:true,generacion:7}
            }));
        });
        assert.equal(await incorporando.count(),1,'otra versión no oculta el guardado');
        await page.evaluate(()=>__resolverGuardado());
        await incorporando.waitFor({state:'detached'});
        const reciboMixto=burbuja.locator('.haku-libro-auto__recibo');
        const encabezadoMixto=reciboMixto.locator('summary');
        assert.match(await encabezadoMixto.innerText(),/Incorporado\s*1 servicio · 1 nota/,
            'recibo conservado al llegar otro aviso; errores: '+JSON.stringify(errors));
        assert.equal(await reciboMixto.getAttribute('open'),null);
        await encabezadoMixto.click();
        await reciboMixto.getByText('Cristian Sintético · CAB 8',{exact:true}).waitFor();
        assert.match(await reciboMixto.innerText(),/Cristian Sintético · CAB 8[\s\S]+Jacuzzi[\s\S]+Dejar batas/);
        assert.equal(await reciboMixto.getByText('Cristian Sintético · CAB 8',{exact:true}).count(),1);
        assert.equal(await pendienteMixto.getAttribute('aria-expanded'),'false');
        assert.doesNotMatch(await burbuja.innerText(),/Listos para incorporar|Masaje|coordinación pendiente/);
        await encabezadoMixto.click();
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1280,390,320]){
                await page.setViewportSize({width,height:900});
                assert.equal(await burbuja.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`${tema} ${width}: recibo sin desbordes`);
                assert.equal(await pendienteMixto.isVisible(),true);
                if(process.env.HAKU_RESUMEN_CAPTURES)
                    await burbuja.screenshot({path:path.join(process.env.HAKU_RESUMEN_CAPTURES,`aviso-guardado-${tema}-${width}.png`)});
            }
        }
        await pendienteMixto.click();
        assert.equal(await burbuja.locator('.haku-libro-casos__detalle').isVisible(),false,'móvil abre la lista plegada');
        await burbuja.locator('.haku-libro-casos__fila').first().click();
        assert.match(await burbuja.locator('.haku-libro-casos__detalle').innerText(),/coordinación pendiente/);
        assert.doesNotMatch(await burbuja.locator('.haku-libro-casos__detalle').innerText(),/Jacuzzi|Dejar batas/);
        await burbuja.getByRole('button',{name:'Volver al aviso'}).click();
        assert.equal(await page.evaluate(()=>__escriturasAviso),1);
        assert.equal(await page.evaluate(()=>__scopeServicio.reservas[0].id),'Nov26!AB10');
        assert.equal(await page.evaluate(()=>__scopesAviso.every(rows=>rows.length===1&&rows[0].actual.id==='Nov26!AB10')),true);
        assert.equal(await page.evaluate(()=>__opened),abiertosAntes);
        assert.equal(await page.locator('.haku-actualizacion-sites').count(),informesAntes);
        assert.equal(await page.locator('.haku-incorporacion-aviso').count(),0);
        assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Mi consulta sigue aquí');
        await burbuja.getByRole('button',{name:'Seguir con mi consulta',exact:true}).click();
        await burbuja.getByRole('button',{name:'Ver informe',exact:true}).waitFor();
        assert.equal(await burbuja.getByRole('button',{name:'Incorporar',exact:true}).count(),0,'el siguiente aviso llega después del resultado');
        await burbuja.getByRole('button',{name:'Seguir con mi consulta',exact:true}).click();
        // Un fallo conserva el aviso y reintenta la misma operación desde ahí.
        await page.evaluate(()=>{
            __generation=8;window.dispatchEvent(new Event('haiku:libro-cambio'));
            const actual={id:'alta-sintetica',titular:'Alta Sintética',cabana:8,fecha_checkin:'2026-11-07',fecha_checkout:'2026-11-08'};
            __resultadoActual={estado:'ok',libro_actual:{generacion:8},nuevas:[{actual}]};
            const [detectado]=HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.extraerCambiosDetectados(__resultadoActual,8);
            __pendientesActual={items:[{...detectado,accionable:true}],reservas:[actual],comparacion:[],q:{}};
            HAIKU_LIBRO_CONSULTAS.prepararIncorporacion=async()=>({items:[{id:'alta',categoria:'nuevas',payload:{reserva:actual},seleccionado:true}]});
            window.__intentosAviso=0;
            HAIKU_LIBRO_CONSULTAS.confirmarIncorporacion=async(_r,_d,_a,plan)=>{
                if(++__intentosAviso===1){plan.solicitudPendiente={operacionId:'op-sintetica'};throw Error('Respuesta perdida. Reintenta para comprobar el guardado.');}
                if(plan.solicitudPendiente?.operacionId!=='op-sintetica')throw Error('Operación duplicada');
                __pendientesActual={items:[],resueltos:[detectado.id],reservas:[],comparacion:[]};
                return {resultado:{ok:true,reservas_creadas:1}};
            };
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{carga_manual:true,tenia_anterior:true,generacion:8}}));
        });
        await burbuja.getByRole('button',{name:'Incorporar',exact:true}).click();
        await burbuja.getByRole('button',{name:'Reintentar',exact:true}).click();
        await burbuja.locator('.haku-libro-auto__recibo > summary').getByText('1 reserva',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>__intentosAviso),2);
        assert.equal(await page.evaluate(()=>__opened),abiertosAntes);
        assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Mi consulta sigue aquí');
        await burbuja.getByRole('button',{name:'Seguir con mi consulta',exact:true}).click();
        // Los dos informativos se pueden leer en el aviso, sin entrar al informe.
        await page.evaluate(()=>{
            __registration={version:1,cambios:[]};
            __generation=9;window.dispatchEvent(new Event('haiku:libro-cambio'));
            __resultadoActual={estado:'sin_cambios',libro_actual:{generacion:9},
                advertencias:['anterior','actual'].map(version=>({version,hoja:'Oct26',
                    detalles:['Las noches escritas no coinciden con las fechas combinadas; confirmar ingreso/salida.']}))};
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{carga_automatica:true,tenia_anterior:true,generacion:9}}));
        });
        const categorias=burbuja.locator('.haku-libro-auto__prioridad'),filtrado=burbuja.locator('.haku-libro-auto__filtrado');
        await categorias.last().waitFor();
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1100,390,320]){
                await page.setViewportSize({width,height:900});
                await categorias.last().click();
                assert.equal(await filtrado.locator('.haku-libro-auto__caso').count(),2);
                assert.match(await filtrado.innerText(),/Versión anterior.*Oct26/s);
                assert.match(await filtrado.innerText(),/Versión actual.*Oct26/s);
                assert.match(await filtrado.innerText(),/La cantidad de noches escrita no coincide/);
                assert.equal(await burbuja.locator('.haku-libro-auto__resumen').isVisible(),false,'sin duplicar el resumen');
                assert.equal(await burbuja.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`${tema} ${width}: filtro sin desbordes`);
                assert.ok((await burbuja.locator('.haku-libro-auto__prioridades').boundingBox()).height<=30,'contadores compactos');
                assert.notEqual(await categorias.last().evaluate(el=>getComputedStyle(el).boxShadow),'none','categoría seleccionada visible');
                await categorias.first().click();
                assert.match(await filtrado.innerText(),/No hay cambios ni avisos/);
                assert.equal(await categorias.last().getAttribute('aria-expanded'),'false');
                await categorias.first().press('Enter');
                assert.equal(await filtrado.isVisible(),false);
                assert.equal(await burbuja.locator('.haku-libro-auto__resumen').isVisible(),true);
                await categorias.last().focus();await categorias.last().press('Space');
                assert.equal(await filtrado.isVisible(),true,'acceso con teclado');
                await categorias.last().press('Space');
                assert.equal(await filtrado.isVisible(),false);
            }
        }
        assert.equal(await page.evaluate(()=>__opened),abiertosAntes);
        assert.equal(await page.locator('.haku-actualizacion-sites').count(),informesAntes);
        assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Mi consulta sigue aquí');
        // El mensaje de actualización usa el diseño aprobado, con categorías locales.
        await burbuja.getByRole('button',{name:'Seguir con mi consulta',exact:true}).click();
        await page.evaluate(()=>{
            document.getElementById('haiku-asistente-texto').value='';
            document.getElementById('haiku-asistente-mensajes').replaceChildren();
            __generation=10;window.dispatchEvent(new Event('haiku:libro-cambio'));
            const actual={titular:'Huésped Sintético',cabana:3,fecha_checkin:'2030-11-20',fecha_checkout:'2030-11-22'};
            __resultadoActual={estado:'ok',libro_actual:{generacion:10},
                nuevas:Array.from({length:5},(_,i)=>({actual:{...actual,cabana:i+1,id:'alta-'+i}})),
                modificadas:Array.from({length:2},(_,i)=>({actual:{...actual,cabana:i+6,id:'cambio-'+i},cambios:[{campo:'adultos',antes:2,ahora:3}]})),
                advertencias:Array.from({length:3},()=>({version:'actual',hoja:'Nov30',motivo:'Aviso sintético de lectura'}))};
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{carga_automatica:true,tenia_anterior:true,generacion:10}}));
        });
        const resumen=page.locator('#haiku-asistente-mensajes > .haku-libro-resumen');
        await resumen.waitFor();
        await burbuja.getByRole('button',{name:'Cerrar',exact:true}).click();
        assert.equal(await resumen.locator('.haku-libro-resumen__titulo').innerText(),'7 cambios en el Libro');
        assert.deepEqual(await resumen.locator('.haku-libro-resumen__cifras > span').allInnerTexts(),['5 agregadas','2 modificadas','0 no aparecen']);
        assert.match(await resumen.locator('.haku-libro-resumen__aviso').innerText(),/3 datos por revisar/);
        assert.doesNotMatch(await resumen.innerText(),/Encontré|Para organizar la revisión/);
        const prioridades=resumen.locator('.haku-libro-resumen__prioridad'),region=resumen.locator('.haku-libro-auto__filtrado');
        const informesAntesResumen=await page.locator('.haku-actualizacion-sites').count();
        const lecturasAntes=await page.evaluate(()=>__revalidations);
        const capturas=process.env.HAKU_RESUMEN_CAPTURES;
        if(capturas)fs.mkdirSync(capturas,{recursive:true});
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1100,390,360,320]){
                await page.setViewportSize({width,height:900});
                const medidas=await resumen.evaluate(el=>{
                    const s=getComputedStyle(el),box=el.getBoundingClientRect(),parent=el.parentElement;
                    return {width:box.width,height:box.height,scroll:el.scrollWidth,client:el.clientWidth,
                        text:s.color,accent:s.borderLeftColor,available:parent.clientWidth-parseFloat(getComputedStyle(parent).paddingLeft)-parseFloat(getComputedStyle(parent).paddingRight),
                        button:el.querySelector('.haku-libro-resumen__informe').getBoundingClientRect().height};
                });
                assert.ok(medidas.scroll<=medidas.client+1,`${tema} ${width}: sin desborde`);
                assert.ok(Math.abs(medidas.width-medidas.available)<=2,`${tema} ${width}: ancho completo del panel`);
                assert.ok(medidas.height<=150,`${tema} ${width}: resumen compacto (${medidas.height})`);
                assert.ok(medidas.button>=32,'Ver informe conserva un objetivo de toque cómodo');
                assert.equal(medidas.text,tema==='oscuro'?'rgb(232, 239, 234)':'rgb(23, 32, 25)');
                assert.equal(medidas.accent,tema==='oscuro'?'rgb(159, 210, 179)':'rgb(40, 108, 78)');
                await page.waitForFunction(()=>[...document.querySelectorAll('.haku-libro-resumen img')].every(img=>img.complete&&img.naturalWidth===6));
                const puntos=await resumen.locator('img:visible').evaluateAll(xs=>xs.map(x=>({w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height,src:x.getAttribute('src')})));
                assert.equal(puntos.length,4);
                assert.ok(puntos.every(x=>x.w===6&&x.h===6&&x.src.endsWith('-'+tema+'.svg')),'activos Figma locales en sus cuatro lugares');
                if(capturas)await resumen.screenshot({path:path.join(capturas,`resumen-${tema}-${width}.png`)});
                await prioridades.last().press('Enter');
                assert.equal(await region.isVisible(),true);
                assert.equal(await region.locator('.haku-libro-auto__caso').count(),10);
                assert.equal(await prioridades.last().getAttribute('aria-expanded'),'true');
                await prioridades.last().press('Space');
                assert.equal(await region.isVisible(),false);
                await prioridades.first().click();
                assert.match(await region.innerText(),/No hay cambios ni avisos/);
                await prioridades.first().click();
            }
        }
        assert.equal(await page.evaluate(()=>__revalidations),lecturasAntes,'filtrar no consulta ni prepara otra vez');
        assert.equal(await page.locator('.haku-actualizacion-sites').count(),informesAntesResumen);
        await page.locator('#haiku-asistente-texto').fill('Conservar mi borrador');
        await prioridades.last().click();
        assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Conservar mi borrador');
        await prioridades.last().click();
        await resumen.getByRole('button',{name:'Ver informe',exact:true}).click();
        assert.equal(await resumen.count(),0,'el resumen se integra en el informe al abrirlo');
        assert.equal(await page.locator('.haku-actualizacion-sites').count(),informesAntesResumen+1);
        assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Conservar mi borrador');
        // Un mensaje antiguo conserva sus cifras y deja de ofrecer acciones vigentes.
        await page.evaluate(()=>{
            document.getElementById('haiku-asistente-texto').value='';
            document.getElementById('haiku-asistente-mensajes').replaceChildren();
            __generation=11;window.dispatchEvent(new Event('haiku:libro-cambio'));
            __resultadoActual.libro_actual.generacion=11;
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{carga_manual:true,tenia_anterior:true,generacion:11}}));
        });
        await resumen.waitFor();
        await page.evaluate(()=>{__generation=12;window.dispatchEvent(new Event('haiku:libro-cambio'));});
        assert.equal(await resumen.getByRole('button',{name:'Informe anterior',exact:true}).isDisabled(),true);
        assert.equal(await prioridades.count(),4);
        for(const b of await prioridades.all())assert.equal(await b.isDisabled(),true);
        assert.deepEqual(await prioridades.locator('span').allInnerTexts(),['Hoy','Mañana','Próximos','Info']);
        await resumen.getByRole('button',{name:'3 datos por revisar',exact:true}).click();
        assert.equal(await region.locator('.haku-libro-auto__caso').count(),3,'un aviso anterior permite leer su instantánea');
        await page.evaluate(()=>{
            __registration={version:1,cambios:[]};
            document.getElementById('haiku-asistente-mensajes').replaceChildren();
            __generation=13;window.dispatchEvent(new Event('haiku:libro-cambio'));
            __resultadoActual={estado:'ok',libro_actual:{generacion:13},nuevas:[{actual:{titular:'Persona de prueba',cabana:2,fecha_checkin:'2030-11-27',fecha_checkout:'2030-11-30'}}],
                advertencias:['anterior','actual'].map(version=>({version,hoja:'Nov30',detalles:['Las noches escritas no coinciden con las fechas combinadas; confirmar ingreso/salida.']}))};
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{carga_automatica:true,tenia_anterior:true,generacion:13}}));
        });
        await resumen.waitFor();await burbuja.getByRole('button',{name:'Cerrar',exact:true}).click();
        const principal=resumen.locator('.haku-libro-resumen__caso'),botonDatos=resumen.locator('.haku-libro-resumen__ver-datos');
        const hora=await resumen.locator('.haku-libro-resumen__hora').getAttribute('datetime');
        const lecturasAntesDatos=await page.evaluate(()=>__revalidations);
        await page.locator('#haiku-asistente-texto').fill('Conservar mi consulta');
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1100,390,320]){
                await page.setViewportSize({width,height:900});
                await botonDatos.press('Enter');
                assert.equal(await principal.isVisible(),false);assert.equal(await region.isVisible(),true);
                assert.equal(await region.locator('.haku-libro-auto__caso').count(),2);
                assert.match(await region.innerText(),/Versión anterior[\s\S]*Versión actual/);
                assert.match(await region.innerText(),/La cantidad de noches escrita no coincide/);
                assert.doesNotMatch(await region.innerText(),/Se agregó una reserva/);
                assert.equal(await botonDatos.innerText(),'Volver al resumen');
                assert.equal(await botonDatos.getAttribute('aria-expanded'),'true');
                assert.equal(await resumen.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
                if(capturas)await resumen.screenshot({path:path.join(capturas,`datos-revisar-${tema}-${width}.png`)});
                await botonDatos.press('Space');
                assert.equal(await principal.isVisible(),true);assert.equal(await region.isVisible(),false);
                assert.equal(await botonDatos.getAttribute('aria-expanded'),'false');
            }
        }
        await botonDatos.click();await prioridades.last().click();
        assert.equal(await region.locator('.haku-libro-auto__caso').count(),3);
        assert.equal(await botonDatos.innerText(),'2 datos por revisar');
        assert.equal(await principal.isVisible(),false,'la categoría también reemplaza el detalle sin duplicarlo');
        await botonDatos.click();assert.equal(await region.locator('.haku-libro-auto__caso').count(),2);
        assert.equal(await prioridades.last().getAttribute('aria-expanded'),'false');
        await botonDatos.click();assert.equal(await principal.isVisible(),true);
        assert.equal(await resumen.locator('.haku-libro-resumen__hora').getAttribute('datetime'),hora);
        assert.equal(await page.evaluate(()=>__revalidations),lecturasAntesDatos);
        assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Conservar mi consulta');

        // Recorrer el aviso y su preparación con los comparadores reales y una base ficticia.
        for (const file of ['js/haiku-libro-semantica-v1.js','js/haiku-libro-diferencias-v1.js','js/haiku-libro-consultas-v1.js']) {
            await page.addScriptTag({ content: read(file) });
        }
        await page.evaluate(({reservas,estadias}) => {
            const [existente,,,,nueva] = reservas;
            existente.tipo_documento = nueva.tipo_documento = 'pasaporte';
            estadias[0].reservas.titular_nombre = existente.titular;
            estadias[0].reservas.titular_numero_documento = existente.rut_documento;
            const actual = {...existente.pagos[0], cabana:existente.cabana};
            const anterior = {...actual, codigo_autorizacion:'FICTICIO-ANTERIOR', origen:{hoja:'Oct26',celda:'P22'}};
            existente.pagos = [anterior,actual];
            nueva.pagos = [{...actual, cabana:nueva.cabana, codigo_autorizacion:'FICTICIO-ALTA', origen:{hoja:'Oct26',celda:'P25'}}];
            const sinReserva = {...actual, monto:31000, cabana:12, codigo_autorizacion:'FICTICIO-SIN-RESERVA', origen:{hoja:'Oct26',celda:'P28'}};
            const hoja = (reservas,pagos) => ({hoja:'Oct26',cobertura:{geometria:true,pagos:true},fechas:['2026-10-13','2026-10-14'],reservas,pagos});
            window.__generation = 14;
            window.__registration = {version:1,cambios:[]};
            window.haikuSesion = {usuario:{activo:true},roles:['admin']};
            window.haikuTienePermiso = () => true;
            window.__escriturasAbonos = 0;
            window.haikuSupabase = {
                auth:{getSession:async()=>({data:{session:{user:{id:'operador-ficticio'}}}})},
                from(tabla) {
                    const filas = tabla==='reserva_estadias' ? estadias : [];
                    const q = {select:()=>q, order:()=>q, in:()=>q, range:async(a,b)=>({data:filas.slice(a,b+1)})};
                    return q;
                },
                rpc:async nombre=>{
                    if (nombre==='haiku_incorporar_libro_v1') window.__escriturasAbonos++;
                    return {data:null};
                }
            };
            window.HAIKU_LIBRO_DIFERENCIAS_V1 = {...window.HAIKU_LIBRO_DIFERENCIAS_V1,
                compararUltimasVersiones:async()=>({...window.HAIKU_LIBRO_DIFERENCIAS_V1.comparar(
                    [hoja([{...existente,pagos:[anterior]}],[anterior])],
                    [hoja([existente,nueva],[...existente.pagos,...nueva.pagos,sinReserva])]),libro_actual:{generacion:14}})};
            window.dispatchEvent(new CustomEvent('haiku:libro-cambio'));
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{carga_automatica:true,tenia_anterior:true,generacion:14}}));
        }, require('./fixtures/libro-identidad-documento.cjs')());
        const avisoAbonos = page.locator('.haku-libro-auto');
        const revisarAbonos = avisoAbonos.getByRole('button',{name:'Revisar abonos'});
        await revisarAbonos.waitFor({state:'visible'});
        const contextoAbonos=avisoAbonos.getByText('Cambios detectados por fecha',{exact:true});
        if(await contextoAbonos.isVisible()){
            await contextoAbonos.click();
            const filtros=avisoAbonos.locator('.haku-libro-auto__prioridad');
            for(const filtro of await filtros.all()){
                await filtro.click();
                if((await avisoAbonos.locator('.haku-libro-auto__filtrado').innerText()).includes('Abono nuevo'))break;
            }
        }
        for (const tema of ['claro','oscuro']) {
            await page.evaluate(tema=>document.documentElement.setAttribute('data-haiku-tema',tema),tema);
            for (const width of [1280,390]) {
                await page.setViewportSize({width,height:900});
                const texto = await avisoAbonos.innerText();
                assert.match(texto,/Reserva nueva · 1 abono asociado/);
                assert.match(texto,/Abono nuevo/);
                assert.match(texto,/Pago por vincular/);
                assert.equal(await avisoAbonos.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
                assert.equal(await revisarAbonos.isVisible(),true);
            }
        }
        await revisarAbonos.click();
        await page.getByRole('button',{name:'Preparar incorporación',exact:true}).click();
        await page.waitForFunction(() => document.querySelector('.haiku-incorporacion')?.textContent.includes('Persona Ficticia Libro 5'));
        assert.equal(await page.evaluate(()=>__escriturasAbonos),0);

        // El aviso acumula pendientes; cada caso conserva su fecha y se retira sólo si Proyecto H lo confirma.
        await page.evaluate(()=>{
            __registration={version:1,cambios:[]};
            const anterior={id:'reserva-por-actualizar',titular:'Reserva para actualizar',cabana:6,
                fecha_checkin:'2026-11-17',fecha_checkout:'2026-11-19',adultos:2};
            const cambio={...anterior,adultos:3};
            const movida={...cambio,fecha_checkin:'2026-11-18'};
            const nueva={id:'reserva-por-crear',titular:'Reserva para crear',cabana:2,
                fecha_checkin:'2026-11-24',fecha_checkout:'2026-11-25'};
            const mod=(anterior,actual,campo)=>({anterior,actual,cambios:[{campo,antes:anterior[campo],ahora:actual[campo]}]});
            const versiones=[
                {modificadas:[mod(anterior,cambio,'adultos')]},
                {nuevas:[{actual:nueva}]},
                {modificadas:[mod(cambio,movida,'fecha_checkin')]},
                {advertencias:[{motivo:'Dato del Libro por revisar'}]},
                {}
            ];
            window.__confirmadasAviso=new Set();
            window.__fallaAviso=false;
            window.HAIKU_LIBRO_CONSULTAS={...HAIKU_LIBRO_CONSULTAS,revalidarCambiosDetectados:async cambios=>{
                if(__fallaAviso)throw Error('Fallo de consulta simulado');
                const ya=x=>__confirmadasAviso.has(x.actual?.id);
                return {items:cambios.filter(x=>!ya(x)).map(x=>({...x,estado:'revision',accionable:false})),
                    resueltos:cambios.filter(ya).map(x=>x.id),reservas:[],comparacion:[]};
            }};
            window.HAIKU_LIBRO_DIFERENCIAS_V1={...HAIKU_LIBRO_DIFERENCIAS_V1,
                compararUltimasVersiones:async()=>__resultadoActual};
            window.__publicarPendientes=paso=>{
                __generation=15+paso;window.dispatchEvent(new Event('haiku:libro-cambio'));
                const generado_en=new Date().toISOString();
                __resultadoActual={estado:paso<3?'ok':'sin_cambios',libro_actual:{generacion:__generation},generado_en,...versiones[paso]};
                window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{
                    carga_automatica:true,tenia_anterior:true,generacion:__generation}}));
                return generado_en;
            };
        });
        const primerSello=await page.evaluate(()=>__publicarPendientes(0));
        const pendientesAviso=burbuja.getByRole('button',{name:/casos? pendientes?/});
        const casosPendientes=burbuja.locator('.haku-libro-casos__fila');
        const casoAnterior=casosPendientes.filter({hasText:'Reserva para actualizar'});
        const detalleCaso=burbuja.locator('.haku-libro-casos__detalle');
        const ingreso=detalleCaso.locator('time').first();
        const deteccion=detalleCaso.locator('.haku-libro-auto__hora');
        await pendientesAviso.waitFor();
        assert.equal(await pendientesAviso.getAttribute('aria-expanded'),'false');
        assert.equal(await burbuja.getByRole('button',{name:'Incorporar',exact:true}).count(),0);
        assert.doesNotMatch(await burbuja.innerText(),/Reserva para actualizar/);
        await pendientesAviso.click();
        if(await casoAnterior.getAttribute('aria-expanded')!=='true')await casoAnterior.click();
        assert.equal(await ingreso.innerText(),'IN 17/11/2026');
        assert.equal(await ingreso.getAttribute('datetime'),'2026-11-17');
        assert.equal(await deteccion.getAttribute('datetime'),primerSello);
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1280,390,320]){
                await page.setViewportSize({width,height:900});
                const medidas=await detalleCaso.locator('.haku-libro-casos__identidad').evaluate(el=>{
                    const [entrada,deteccion]=el.querySelectorAll('time');
                    return {entrada:entrada.dateTime,deteccion:deteccion.dateTime,
                        sinDesborde:el.scrollWidth<=el.clientWidth+1};
                });
                assert.deepEqual(medidas,{entrada:'2026-11-17',deteccion:primerSello,sinDesborde:true},`${tema} ${width}`);
            }
        }
        await burbuja.getByRole('button',{name:'Cerrar burbuja',exact:true}).click();
        await page.evaluate(()=>__publicarPendientes(1));
        await pendientesAviso.click();
        await casosPendientes.filter({hasText:'Reserva para crear'}).waitFor();
        assert.equal(await casosPendientes.count(),2);
        if(await casoAnterior.getAttribute('aria-expanded')!=='true')await casoAnterior.click();
        assert.equal(await deteccion.getAttribute('datetime'),primerSello);
        await burbuja.getByRole('button',{name:'Ver informe',exact:true}).click();
        const pendientesNormales=page.locator('.haku-actualizacion-sites').last().locator('.haku-libro-pendientes-zona');
        await pendientesNormales.getByText(/Reserva para actualizar/).waitFor();
        assert.match(await pendientesNormales.innerText(),/Reserva para crear/);

        await page.evaluate(()=>{__confirmadasAviso.add('reserva-por-crear');__publicarPendientes(2);});
        await pendientesAviso.click();
        if(await casoAnterior.getAttribute('aria-expanded')!=='true')await casoAnterior.click();
        await detalleCaso.getByText('IN 18/11/2026',{exact:true}).waitFor();
        assert.equal(await casosPendientes.count(),1,'un cambio encadenado usa la última reserva y retira el caso confirmado');
        assert.equal(await page.evaluate(()=>__registration.cambios.length),1);
        await burbuja.getByRole('button',{name:'Cerrar burbuja',exact:true}).click();
        await page.evaluate(()=>{__fallaAviso=true;__publicarPendientes(3);});
        await burbuja.getByText('Conservé los pendientes.',{exact:false}).waitFor();
        assert.equal(await burbuja.getByRole('button',{name:'Incorporar',exact:true}).count(),0);
        await pendientesAviso.click();
        if(await casoAnterior.getAttribute('aria-expanded')!=='true')await casoAnterior.click();
        assert.equal(await ingreso.innerText(),'IN 18/11/2026');
        assert.match(await detalleCaso.innerText(),/Falta comprobar este cambio en Proyecto H/);
        await burbuja.getByRole('button',{name:'Ver informe',exact:true}).click();
        await pendientesNormales.getByText(/Reserva para actualizar/).waitFor();
        assert.match(await pendientesNormales.innerText(),/Falta comprobarlos en Proyecto H/);

        await page.evaluate(()=>{__fallaAviso=false;__confirmadasAviso.add('reserva-por-actualizar');__publicarPendientes(4);});
        await burbuja.getByText('Sin cambios pendientes',{exact:true}).waitFor();
        assert.equal(await casosPendientes.count(),0);
        assert.equal(await page.evaluate(()=>__registration.cambios.length),0);

        await page.evaluate(()=>{
            const hoja=texto=>HAIKU_LIBRO_SEMANTICA.normalizarHoja({celdas:[
                {r:1,c:2,valor:'12 sep',fechaISO:'2026-09-12'},{r:1,c:6,valor:'13 sep',fechaISO:'2026-09-13'},
                {r:2,c:0,valor:'cabaña 2'},{r:2,c:2,valor:texto},{r:24,c:2,valor:'Pagos de arriendos de hoy'}
            ],combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}}]},'Sep26');
            const anterior=hoja('Lidia Salas // 1 NOCHE // contacto@example.test // Marta López');
            const actual=hoja('Marta López // 1 NOCHE // Lidia Salas');
            __generation=20;window.dispatchEvent(new Event('haiku:libro-cambio'));
            __resultadoActual={...HAIKU_LIBRO_DIFERENCIAS_V1.comparar([anterior],[actual]),libro_actual:{generacion:20}};
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{
                carga_automatica:true,tenia_anterior:true,generacion:20}}));
        });
        const infoTitular=burbuja.locator('.haku-libro-auto__prioridad').last();
        await infoTitular.waitFor();
        assert.equal(await infoTitular.locator('strong').innerText(),'1');
        await infoTitular.click();
        const dudaTitular=burbuja.locator('.haku-libro-auto__filtrado .haku-libro-auto__caso');
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1280,390,320]){
                await page.setViewportSize({width,height:900});
                assert.equal(await dudaTitular.count(),1);
                const texto=await dudaTitular.innerText();
                assert.match(texto,/Titular por confirmar/);
                assert.match(texto,/Sep26 · C3 · CAB 2 · Ambas versiones/);
                assert.match(texto,/IN: 12\/09\/2026/);
                assert.match(texto,/«Lidia Salas» · «Marta López»/);
                assert.doesNotMatch(texto,/contacto@example\.test|Sep26:\s*Sep26/);
                assert.equal(await burbuja.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
            }
        }
        await burbuja.getByRole('button',{name:'Ver informe',exact:true}).click();
        const informeTitular=page.locator('.haku-actualizacion-sites').last();
        await informeTitular.getByText('Datos del Libro por revisar (1)',{exact:true}).click();
        assert.match(await informeTitular.innerText(),/Sep26 · C3 · CAB 2 · Ambas versiones/);
        assert.match(await informeTitular.innerText(),/«Lidia Salas» · «Marta López»/);

        await page.addStyleTag({url:`http://127.0.0.1:${server.address().port}/css/haiku-libro-decision-cards-v1.css`});
        await page.addStyleTag({url:`http://127.0.0.1:${server.address().port}/css/haiku-dialogos-v1.css`});
        await page.addScriptTag({content:read('js/haiku-libro-cancelaciones-v1.js')});
        await page.addScriptTag({content:read('js/haiku-dialogos-v1.js')});
        const cargarLectorCierres=async target=>{
            await target.setViewportSize({width:1100,height:900});
            await target.evaluate(()=>{
                const seccion=document.createElement('section');seccion.id='seccion-libro-reserva';seccion.hidden=true;
                document.body.append(seccion);
            });
            await target.addScriptTag({content:read('js/supabase-libro-reserva-v1.js')});
            await target.evaluate(()=>HAIKU_LIBRO_RESERVA_V1.listo());
        };
        await page.evaluate(()=>{window.__lectorAviso=window.HAIKU_LIBRO_RESERVA_V1;delete window.HAIKU_LIBRO_RESERVA_V1;});
        await cargarLectorCierres(page);
        await page.evaluate(()=>{
            const lectorReal=HAIKU_LIBRO_RESERVA_V1;
            window.HAIKU_LIBRO_RESERVA_V1=Object.assign(__lectorAviso,{
                leerAvisosCancelacionCerrados:lectorReal.leerAvisosCancelacionCerrados,
                cerrarAvisoCancelacion:async firma=>{
                    if(__cancelacionAviso.fallarCierre)throw Error('No pude guardar el cierre en este navegador.');
                    await lectorReal.cerrarAvisoCancelacion(firma);
                }
            });
            const reserva={id:'Dic26!C3',hoja:'Dic26',titular:'Persona cancelación de prueba',cabana:1,
                fecha_checkin:'2026-12-11',fecha_checkout:'2026-12-12',noches:1,tipo_estadia:'alojamiento'};
            const evidencia={bloque:'CANCELACIONES',titular:reserva.titular,fecha_checkin:reserva.fecha_checkin,
                noches:1,origen:{hoja:'Dic26',celda:'C20'}};
            const anterior={tipo:'cancelacion_confirmada',anterior:reserva,evidencia};
            const sinIngreso={...reserva,id:'Dic26!F3',titular:'Persona sin ingreso de prueba',
                fecha_checkin:'2026-12-13',fecha_checkout:'2026-12-14'};
            const evidenciaSinIngreso={...evidencia,titular:sinIngreso.titular,fecha_checkin:sinIngreso.fecha_checkin,
                origen:{hoja:'Dic26',celda:'C32'}};
            const api=HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1;
            const caso=api.extraerCambiosDetectados({cancelaciones_confirmadas:[anterior]},19)[0];
            const proyecto={id:'reserva-cancelacion-prueba',titular_nombre:reserva.titular,estado_reserva:'confirmada',
                estadias:[{id:'estadia-cancelacion-prueba',fecha_ingreso:reserva.fecha_checkin,
                    fecha_salida:reserva.fecha_checkout,estado_estadia:'confirmada',cabanas:{numero:1}}]};
            __generation=21;window.dispatchEvent(new Event('haiku:libro-cambio'));
            __registration={version:1,cambios:[caso]};
            window.__cancelacionAviso={candidatas:0,escrituras:[],lecturas:[],inspecciones:[],pausar:true,
                sinIngreso:{tipo:'cancelacion_confirmada',anterior:sinIngreso,evidencia:evidenciaSinIngreso}};
            HAIKU_LIBRO_RESERVA_V1.consultarHoja=async(hoja,version)=>{
                __cancelacionAviso.lecturas.push([hoja,version]);
                if(__cancelacionAviso.pausar)await new Promise(resolve=>{__cancelacionAviso.continuar=resolve;});
                return {hoja:'Dic26',cobertura:{geometria:true},reservas:[],cancelaciones:[{...evidencia,origen:{hoja:'Dic26',celda:'C22'}},evidenciaSinIngreso]};
            };
            window.HAIKU_LIBRO_CONTEXTO_V1={actualizarDesdeLibro:async xs=>xs,enriquecer:async xs=>xs,fraseHistorial:()=>''};
            HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados=async registros=>{
                const resueltos=proyecto.estado_reserva==='cancelada'?registros.filter(x=>x.anterior?.fecha_checkin===reserva.fecha_checkin).map(x=>x.id):[];
                return {items:registros.filter(x=>!resueltos.includes(x.id)).map(x=>({...x,estado:'revision',accionable:false,
                    proyecto:'No se pudo asociar de forma única'})),resueltos,reservas:[],comparacion:[]};
            };
            window.haikuSesion={usuario:{activo:true},roles:['administrador']};
            window.haikuTienePermiso=permiso=>permiso==='reservas.cancelar';
            window.haikuSupabase={
                auth:{getSession:async()=>({data:{session:{user:{id:'admin-prueba'}}}})},
                from(tabla){
                    const copia={...proyecto,id:'otra-reserva-prueba'};
                    const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,range:async()=>({data:tabla==='reservas'
                        ?[proyecto,copia].slice(0,__cancelacionAviso.candidatas)
                        :__cancelacionAviso.sinEstadias?[]:[{id:proyecto.estadias[0].id,reserva_id:proyecto.id}]})};
                    return q;
                }
            };
            window.HAIKU_INSPECTOR_V1={abrirReserva:async id=>__cancelacionAviso.inspecciones.push(id)};
            window.HAIKU_RESERVA_ESTADOS_SUPABASE_V2={cancelar:async(id,{antesDeCancelar})=>{
                if(__cancelacionAviso.declinar)return;
                if(await antesDeCancelar()===false)return {estado:'sin_cambios'};
                __cancelacionAviso.escrituras.push(id);proyecto.estado_reserva='cancelada';return {estado:'cancelada'};
            }};
            api.mostrarResultado({estado:'sin_cambios',libro_actual:{generacion:21}}).id='aviso-cancelacion-prueba';
        });
        const historialCancelacion=page.locator('#aviso-cancelacion-prueba .haku-libro-pendientes-zona');
        const casoCancelacion=historialCancelacion.locator('.haku-pendiente-item').filter({hasText:'Persona cancelación de prueba'});
        await casoCancelacion.locator('summary').click();
        assert.match(await casoCancelacion.innerText(),/PENDIENTE DE UNA ACTUALIZACIÓN ANTERIOR/);
        const aprobarCancelacion=casoCancelacion.getByRole('button',{name:'Aprobación manual',exact:true});
        const revisionCancelacion=casoCancelacion.locator('.haiku-cancelacion-informe');
        const confirmarCancelacion=revisionCancelacion.getByRole('button',{name:'Confirmar cancelación',exact:true});
        const verCancelacion=revisionCancelacion.getByRole('button',{name:'Ver reserva',exact:true});
        const dialogoCierre=page.getByRole('dialog');
        const aceptarCierre=dialogoCierre.getByRole('button',{name:'Cerrar aviso',exact:true});
        const medirCancelacion=async(vista,estado,alturaMaxima,fila=casoCancelacion)=>{
            for(const tema of ['claro','oscuro']){
                await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
                for(const width of [1100,390,320]){
                    await page.setViewportSize({width,height:900});
                    await vista.scrollIntoViewIfNeeded();
                    const contexto=`Cancelación ${estado} · ${tema} ${width}`;
                    assert.ok((await vista.boundingBox()).height<=alturaMaxima,contexto+' · altura');
                    assert.equal(await vista.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,contexto+' · ancho');
                    assert.deepEqual(await page.evaluate(auditarContraste,'.haku-pendiente-detalle:has(> .haku-libro-preparacion-zona--cancelacion)'),[],contexto+' · contraste');
                    if(capturas&&(width===390||width===1100))await fila.screenshot({path:path.join(capturas,`cancelacion-${estado}-${tema}-${width}.png`)});
                }
            }
        };
        await aprobarCancelacion.click();
        await page.waitForFunction(()=>typeof __cancelacionAviso.continuar==='function');
        const cargaCancelacion=casoCancelacion.locator('.haiku-cancelacion-status');
        assert.equal(await cargaCancelacion.innerText(),'Comprobando la cancelación…');
        await medirCancelacion(cargaCancelacion,'carga',48);
        assert.equal(await cargaCancelacion.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(37, 53, 45)');
        await page.evaluate(()=>{__cancelacionAviso.pausar=false;__cancelacionAviso.continuar();});
        await revisionCancelacion.getByText('No encontré una reserva compatible con este aviso en Proyecto H.',{exact:true}).waitFor();
        assert.equal(await confirmarCancelacion.count(),0);
        assert.equal(await verCancelacion.count(),0);
        assert.equal(await aprobarCancelacion.isVisible(),false);
        assert.doesNotMatch(await revisionCancelacion.innerText(),/Sin verificar|Asistente operativo/);
        await medirCancelacion(revisionCancelacion,'por-revisar',180);
        assert.equal(await revisionCancelacion.getByRole('alert').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(53, 41, 30)');
        const cerrarPendiente=revisionCancelacion.getByRole('button',{name:'Cerrar aviso',exact:true});
        await cerrarPendiente.click();
        await dialogoCierre.getByRole('button',{name:'Cancelar',exact:true}).click();
        assert.equal(await cerrarPendiente.isEnabled(),true);
        await cerrarPendiente.click();
        await page.evaluate(()=>{__cancelacionAviso.candidatas=1;});
        await aceptarCierre.click();
        await confirmarCancelacion.waitFor();
        assert.deepEqual(await page.evaluate(async()=>await HAIKU_LIBRO_RESERVA_V1.leerAvisosCancelacionCerrados()||[]),[]);
        await revisionCancelacion.getByRole('button',{name:'Volver',exact:true}).click();
        assert.equal(await aprobarCancelacion.evaluate(el=>document.activeElement===el),true);
        assert.deepEqual(await page.evaluate(()=>__cancelacionAviso.escrituras),[]);
        await page.evaluate(()=>{__cancelacionAviso.candidatas=2;});
        await aprobarCancelacion.click();
        await revisionCancelacion.getByText('La reserva no se identifica de forma única; requiere revisión.',{exact:true}).waitFor();
        assert.equal(await confirmarCancelacion.count(),0);
        assert.equal(await cerrarPendiente.count(),0);
        await revisionCancelacion.getByRole('button',{name:'Volver',exact:true}).click();
        await page.evaluate(()=>{__cancelacionAviso.candidatas=1;});
        await aprobarCancelacion.click();
        await revisionCancelacion.getByRole('heading',{name:'Revisar cancelación'}).waitFor();
        assert.equal(await confirmarCancelacion.isEnabled(),true);
        assert.match(await revisionCancelacion.innerText(),/Libro · Dic26 · C22/);
        assert.match(await revisionCancelacion.innerText(),/Activa\s*→\s*Cancelada/);
        await medirCancelacion(revisionCancelacion,'confirmar',200);
        await verCancelacion.click();
        assert.deepEqual(await page.evaluate(()=>__cancelacionAviso.inspecciones),['reserva-cancelacion-prueba']);
        await page.evaluate(()=>{__cancelacionAviso.declinar=true;});
        await confirmarCancelacion.click();
        await revisionCancelacion.getByText('Pendiente de confirmación.',{exact:true}).waitFor();
        assert.equal(await confirmarCancelacion.isEnabled(),true);
        assert.deepEqual(await page.evaluate(()=>__cancelacionAviso.escrituras),[]);
        await page.evaluate(()=>{__cancelacionAviso.declinar=false;});
        await confirmarCancelacion.click();
        await revisionCancelacion.getByRole('heading',{name:'Cancelación completada'}).waitFor();
        await medirCancelacion(revisionCancelacion,'completada',150);
        assert.deepEqual(await page.evaluate(()=>__cancelacionAviso.escrituras),['reserva-cancelacion-prueba']);
        assert.ok(await page.evaluate(()=>__cancelacionAviso.lecturas.every(([hoja,version])=>hoja==='Dic26'&&version==='actual')));
        await revisionCancelacion.getByRole('button',{name:'Volver a la revisión',exact:true}).click();
        await historialCancelacion.getByText('No quedan cambios pendientes en este informe.',{exact:true}).waitFor();

        await page.evaluate(()=>{
            __cancelacionAviso.sinEstadias=true;
            const informe={estado:'ok',libro_actual:{generacion:21},cancelaciones_confirmadas:[__cancelacionAviso.sinIngreso]};
            HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.mostrarResultado(informe).id='aviso-nunca-ingresada';
        });
        const historialCierre=page.locator('#aviso-nunca-ingresada .haku-libro-pendientes-zona');
        const casoCierre=historialCierre.locator('.haku-pendiente-item');
        await casoCierre.locator('summary').click();
        await casoCierre.getByRole('button',{name:'Aprobación manual',exact:true}).click();
        const revisionCierre=casoCierre.locator('.haiku-cancelacion-informe');
        const cerrarAviso=revisionCierre.getByRole('button',{name:'Cerrar aviso',exact:true});
        await revisionCierre.getByText('No encontré la reserva exacta en Proyecto H.',{exact:true}).waitFor();
        await page.evaluate(()=>{__cancelacionAviso.fallarCierre=true;});
        await cerrarAviso.click();await aceptarCierre.click();
        await revisionCierre.getByText('No pude guardar el cierre en este navegador.',{exact:true}).waitFor();
        assert.equal(await cerrarAviso.isEnabled(),true);
        await page.evaluate(()=>{__cancelacionAviso.fallarCierre=false;});
        await cerrarAviso.click();await aceptarCierre.click();
        await revisionCierre.getByRole('heading',{name:'Aviso cerrado',exact:true}).waitFor();
        await medirCancelacion(revisionCierre,'aviso-cerrado',180,casoCierre);
        assert.deepEqual(await page.evaluate(()=>__cancelacionAviso.escrituras),['reserva-cancelacion-prueba']);
        await revisionCierre.getByRole('button',{name:'Volver a la revisión',exact:true}).click();
        await historialCierre.getByText('No quedan cambios pendientes en este informe.',{exact:true}).waitFor();
        await historialCierre.getByText('Ya resueltos (1)',{exact:true}).click();
        await casoCierre.locator('summary').click();
        await casoCierre.getByText('Reserva nunca ingresada en Proyecto H.',{exact:true}).waitFor();

        const cierres=await page.evaluate(()=>HAIKU_LIBRO_RESERVA_V1.leerAvisosCancelacionCerrados());
        assert.equal(cierres.length,1);
        const otraPestana=await page.context().newPage();
        await otraPestana.goto(`http://127.0.0.1:${server.address().port}/`);
        await cargarLectorCierres(otraPestana);
        assert.deepEqual(await otraPestana.evaluate(()=>HAIKU_LIBRO_RESERVA_V1.leerAvisosCancelacionCerrados()),cierres);
        await otraPestana.close();
        const pendientesTrasActualizar=await page.evaluate(async()=>{
            const caso=__cancelacionAviso.sinIngreso;
            const movido={...caso,evidencia:{...caso.evidencia,origen:{hoja:'Dic26',celda:'C36'}}};
            const otro={...caso,anterior:{...caso.anterior,fecha_checkin:'2026-12-18',fecha_checkout:'2026-12-19'},
                evidencia:{...caso.evidencia,fecha_checkin:'2026-12-18',origen:{hoja:'Dic26',celda:'C38'}}};
            __generation++;window.dispatchEvent(new Event('haiku:libro-cambio'));
            __resultadoActual={estado:'ok',libro_actual:{generacion:__generation},cancelaciones_confirmadas:[movido,otro]};
            const aviso=await HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.obtenerResultadoAviso();
            return aviso.cancelaciones_confirmadas.map(x=>x.anterior.fecha_checkin);
        });
        assert.deepEqual(pendientesTrasActualizar,['2026-12-18']);
        assert.deepEqual(errors, []);
        await comprobarNavegacionAvisoLargo(browser,`http://127.0.0.1:${server.address().port}/`);
        await comprobarCasosDelAviso(browser,`http://127.0.0.1:${server.address().port}/`);
        await comprobarNotaTinaja(browser,`http://127.0.0.1:${server.address().port}/`);
        await comprobarPendientesTrasConfirmar(browser,`http://127.0.0.1:${server.address().port}/`);
        console.log('Actualización Sites: informe real, categorías, historial, controles, error, scroll y móvil OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
