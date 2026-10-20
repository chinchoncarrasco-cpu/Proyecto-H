// UI y puente de cancelación reales; datos sintéticos y ninguna conexión externa.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ficha = read('js/supabase-reserva-estados-v1.js');
const cancelar = ficha.slice(ficha.indexOf('    async function cancelarReservaSupabase'), ficha.indexOf('    function datosVisualesConFullDay'));
assert.ok(cancelar.includes('haiku_cancelar_reserva'));
const assets = { '/cancelaciones.js': read('js/haiku-libro-cancelaciones-v1.js') };
for (const p of ['css/styles.css', 'css/sites-shell-v1.css', 'css/supabase-asistente-v1.css', 'css/supabase-haku-reconciliacion-v1.css', 'css/sites-asistente-v1.css', 'css/haiku-libro-decision-cards-v1.css']) assets['/' + p] = read(p);
const server = http.createServer((req, res) => {
    if (Object.hasOwn(assets, req.url)) return res.writeHead(200, { 'Content-Type': req.url.endsWith('.css') ? 'text/css;charset=utf-8' : 'application/javascript;charset=utf-8' }).end(assets[req.url]);
    if (req.url === '/captura') return res.writeHead(200, { 'Content-Type':'text/html;charset=utf-8' }).end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        ${Object.keys(assets).filter(p => p.endsWith('.css')).map(p => `<link rel="stylesheet" href="${p}">`).join('')}
        <body style="background:#f5f7f5"><main id="out" style="width:calc(100% - 32px);max-width:486px;margin:16px auto"></main>
        <script src="/cancelaciones.js"></script></body></html>`);
    if (req.url === '/comparacion') return res.writeHead(200, { 'Content-Type':'text/html;charset=utf-8' }).end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        ${Object.keys(assets).filter(p => p.endsWith('.css')).map(p => `<link rel="stylesheet" href="${p}">`).join('')}
        <body style="background:#f5f7f5;font-family:var(--sites-shell-font);color:var(--sites-shell-ink-soft)">
        <main style="width:1100px;padding:32px 48px;margin:auto"><p style="margin:0 0 24px;font-size:12px;color:var(--sites-shell-muted)">Haku · Capturas del componente real en Edge · Datos sintéticos, sin acceso a Supabase</p>
        <div style="display:grid;grid-template-columns:486px 486px;gap:32px">
        <section><h2 style="font-size:14px;font-weight:600;margin:0 0 12px">01 · Revisar cancelación</h2><div id="out"></div></section>
        <section><h2 style="font-size:14px;font-weight:600;margin:0 0 12px">02 · Cancelación completada</h2><div id="out2"></div></section></div></main>
        <script src="/cancelaciones.js"></script></body></html>`);
    if (req.url !== '/') return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        ${Object.keys(assets).filter(p => p.endsWith('.css')).map(p => `<link rel="stylesheet" href="${p}">`).join('')}
        <body><div class="haiku-asistente-root"><div class="haiku-asistente-panel">
        <header class="haiku-asistente-cabecera">Haku · Asistente operativo</header>
        <div class="haiku-asistente-mensajes"><div class="haiku-asistente-preview">
        <label>Filtro <input id="filtro" value="septiembre"></label><details id="progreso" open><summary>Revisión en curso</summary><label><input type="checkbox" id="seleccion" checked> Selección anterior</label></details><div id="out"></div>
        </div></div><footer class="haiku-asistente-compositor">Prueba local con datos ficticios</footer></div></div>
        <script src="/cancelaciones.js"></script></body></html>`);
});

async function iniciar(page, escenario) {
    await page.evaluate(({ cancelar, escenario }) => {
        const row = { id:'11111111-1111-4111-8111-111111111111', titular_nombre:'Huésped de prueba sintética', correo_contacto:'fixture@example.test', estado_reserva:'confirmada',
            estadias:[{ id:'s1', fecha_ingreso:'2026-09-01', fecha_salida:'2026-09-03', estado_estadia:'confirmada', cabanas:{ numero:7 } }] };
        const evidencia = { bloque:'CANCELACIONES', titular:row.titular_nombre, fecha_checkin:'2026-09-01', noches:2, correo:row.correo_contacto, origen:{ hoja:'Sep26', celda:'D16' } };
        const hoja = { hoja:'Sep26', reservas:[], cancelaciones:[evidencia], cobertura:{ geometria:true } };
        const f = window.__fixture = { row, hoja, generacion:1, permitido:true, aceptar:true, rpc:0, confirmaciones:0, abiertas:[], escenario };
        window.confirm = () => { f.confirmaciones++; return f.aceptar; };
        window.haikuTienePermiso = () => f.permitido;
        window.HAIKU_LIBRO_RESERVA_V1 = { estado:() => ({ generacion:f.generacion }), consultarHoja:async() => structuredClone(hoja) };
        const cliente = window.haikuSupabase = {
            auth:{ getSession:async() => ({ data:{ session:{ user:{ id:'ficticio' } } } }) },
            from(tabla) { const q = { select:() => q, eq:() => q, in:() => q, order:() => q, range:async() => ({ data:tabla === 'reservas' ? [structuredClone(row)] : [{ id:'s1', reserva_id:row.id }] }) }; return q; },
            async rpc(nombre, argumentos) {
                f.rpc++; f.ultimoRpc = { nombre, argumentos };
                if (f.escenario === 'pendiente') await new Promise(ok => { f.liberar = ok; });
                if (f.escenario === 'error') return { error:{ message:'Error sintético al guardar' } };
                row.estado_reserva = 'cancelada'; row.estadias[0].estado_estadia = 'cancelada';
                return { data:{ ok:true, reserva_id:row.id } };
            }
        };
        // Ejecuta el mismo confirm, hook de revalidación y RPC que utiliza la ficha.
        const crear = new Function('cliente', 'window', `let cancelando=false;
            const cerrarMenuEstado=()=>{},cerrarFicha=()=>{},retirarReservaDelCache=()=>{},renderCalendarioInmediato=()=>{},refrescarFuentesSupabase=async()=>{};
            ${cancelar}
            return cancelarReservaSupabase;`);
        window.HAIKU_RESERVA_ESTADOS_SUPABASE_V2 = { cancelar:crear(cliente, window) };
        window.HAIKU_INSPECTOR_V1 = { abrirReserva:async id => { f.abiertas.push(id); return true; } };
    }, { cancelar, escenario });
    await page.evaluate(async () => {
        const api = window.HAIKU_LIBRO_CANCELACIONES_V1, f = window.__fixture;
        const detectadas = await api.detectarActual(f.hoja);
        api.adjuntar(document.getElementById('out'), detectadas, f.generacion);
        f.nodoFiltro = document.getElementById('filtro'); f.nodoProgreso = document.getElementById('progreso'); f.nodoSeleccion = document.getElementById('seleccion');
    });
}

async function contextoConservado(page) {
    assert.equal(await page.evaluate(() => {
        const f = window.__fixture;
        return f.nodoFiltro === document.getElementById('filtro') && f.nodoFiltro.value === 'septiembre' &&
            f.nodoProgreso === document.getElementById('progreso') && f.nodoProgreso.open &&
            f.nodoSeleccion === document.getElementById('seleccion') && f.nodoSeleccion.checked;
    }), true);
}

async function geometria(page) {
    const medidas = await page.locator('.haiku-cancelacion-pantalla').evaluate(panel => {
        const r = panel.getBoundingClientRect();
        return { overflow:panel.scrollWidth - panel.clientWidth, pagina:document.documentElement.scrollWidth - innerWidth,
            controles:[...panel.querySelectorAll('button')].map(b => { const x = b.getBoundingClientRect(); return x.width > 0 && x.left >= r.left && x.right <= r.right + 1; }) };
    });
    assert.ok(medidas.overflow <= 1); assert.ok(medidas.pagina <= 1); assert.ok(medidas.controles.every(Boolean));
}

(async () => {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok)); let browser;
    try {
        browser = await chromium.launch({ executablePath:process.env.HAIKU_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true });
        const origin = 'http://127.0.0.1:' + server.address().port;
        for (const width of [320, 390, 1100]) for (const escenario of ['exito', 'rechazo', 'error', 'permiso', 'conflicto', 'invalida', 'ya-cancelada', 'pendiente']) {
            const context = await browser.newContext({ viewport:{ width, height:850 }, deviceScaleFactor:2 }), externos = [], errores = [];
            await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); externos.push(route.request().url()); return route.abort(); });
            const page = await context.newPage(); page.on('pageerror', e => errores.push(e.message)); await page.goto(origin); await iniciar(page, escenario);
            const preparar = () => page.getByRole('button', { name:/^Preparar cancelación/ }).click();
            await preparar(); await page.getByRole('heading', { name:'Revisar cancelación', exact:true }).waitFor();
            const panel = page.locator('.haiku-cancelacion-pantalla');
            assert.match(await panel.innerText(), /SEPTIEMBRE 2026/); assert.match(await panel.innerText(), /2 noches/); assert.match(await panel.innerText(), /CANCELACIONES · Sep26 · D16/);
            assert.equal(await page.evaluate(() => window.__fixture.rpc), 0); await geometria(page);
            assert.match(await panel.innerText(), /Pendiente de confirmar/);
            if (process.env.HAKU_CANCELACION_CAPTURAS && escenario === 'exito') {
                fs.mkdirSync(process.env.HAKU_CANCELACION_CAPTURAS, { recursive:true });
                await panel.screenshot({ path:path.join(process.env.HAKU_CANCELACION_CAPTURAS, `revision-${width}.png`), scale:'css' });
            }
            if (escenario === 'exito') {
                await page.getByRole('button', { name:'Volver', exact:true }).click(); await contextoConservado(page);
                await preparar(); await page.getByRole('button', { name:'Cerrar revisión de cancelación' }).click(); await contextoConservado(page);
                await preparar(); await page.getByRole('button', { name:'Ver reserva', exact:true }).click();
                const color = await panel.getByRole('button', { name:'Confirmar cancelación', exact:true }).evaluate(b => getComputedStyle(b).backgroundColor);
                assert.equal(color, 'rgb(170, 78, 68)');
            }
            if (escenario === 'rechazo') await page.evaluate(() => { window.__fixture.aceptar = false; });
            if (escenario === 'permiso') await page.evaluate(() => { window.__fixture.permitido = false; });
            if (escenario === 'conflicto') await page.evaluate(() => { window.__fixture.hoja.cancelaciones.push(structuredClone(window.__fixture.hoja.cancelaciones[0])); });
            if (escenario === 'ya-cancelada') await page.evaluate(() => { window.__fixture.row.estado_reserva = 'cancelada'; });
            if (escenario === 'invalida') {
                await page.evaluate(() => { window.__fixture.generacion++; window.dispatchEvent(new Event('haiku:libro-cambio')); });
                assert.ok(await panel.getByRole('button', { name:'Confirmar cancelación', exact:true }).isDisabled());
            } else {
                await page.getByRole('button', { name:'Confirmar cancelación', exact:true }).click();
            }
            if (escenario === 'pendiente') {
                await page.waitForFunction(() => window.__fixture.liberar);
                assert.ok(await panel.getByRole('button', { name:'Confirmando…', exact:true }).isDisabled());
                assert.ok(await panel.getByRole('button', { name:'Volver', exact:true }).isDisabled());
                assert.equal(await page.getByRole('heading', { name:'Cancelación completada', exact:true }).count(), 0);
                await panel.getByRole('button', { name:'Confirmando…', exact:true }).dispatchEvent('click');
                assert.equal(await page.evaluate(() => window.__fixture.rpc), 1); await page.evaluate(() => window.__fixture.liberar());
            }
            if (['exito', 'pendiente'].includes(escenario)) {
                await page.getByRole('heading', { name:'Cancelación completada', exact:true }).waitFor(); await geometria(page);
                assert.match(await panel.innerText(), /Cambio confirmado/); assert.match(await panel.innerText(), /ESTADO ACTUAL EN HAKU/);
                await page.getByRole('button', { name:'Ver reserva', exact:true }).click();
                assert.equal(await page.evaluate(() => window.__fixture.row.estado_reserva), 'cancelada');
                assert.deepEqual(await page.evaluate(() => window.__fixture.ultimoRpc), { nombre:'haiku_cancelar_reserva', argumentos:{ p_reserva_id:'11111111-1111-4111-8111-111111111111' } });
                if (process.env.HAKU_CANCELACION_CAPTURAS) {
                    fs.mkdirSync(process.env.HAKU_CANCELACION_CAPTURAS, { recursive:true });
                    await panel.screenshot({ path:path.join(process.env.HAKU_CANCELACION_CAPTURAS, `completada-${width}.png`), scale:'css' });
                }
                await page.getByRole('button', { name:'Volver a la revisión', exact:true }).click();
                assert.equal(await page.getByRole('button', { name:/^Preparar cancelación/ }).count(), 0);
            } else {
                assert.equal(await page.getByRole('heading', { name:'Cancelación completada', exact:true }).count(), 0);
                assert.match(await panel.innerText(), { rechazo:/Cancelación no confirmada/, error:/Error sintético al guardar/, permiso:/No tienes permiso/, conflicto:/conflictos/, invalida:/El Libro cambió/, 'ya-cancelada':/Ya coincide/ }[escenario]);
                await page.getByRole('button', { name:escenario === 'ya-cancelada' ? 'Volver a la revisión' : 'Volver', exact:true }).click();
            }
            await contextoConservado(page);
            const resultado = await page.evaluate(() => ({ rpc:window.__fixture.rpc, confirmaciones:window.__fixture.confirmaciones, abiertas:window.__fixture.abiertas }));
            assert.equal(resultado.rpc, ['exito', 'error', 'pendiente'].includes(escenario) ? 1 : 0);
            if (escenario === 'exito') assert.deepEqual(resultado.abiertas, ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111']);
            assert.deepEqual(externos, []); assert.deepEqual(errores, []);
            console.log(JSON.stringify({ width, escenario, resultado:'PASS', rpc:resultado.rpc, externos:0 })); await context.close();
        }
        if (process.env.HAKU_CANCELACION_CAPTURAS) {
            const context = await browser.newContext({ viewport:{ width:1100, height:940 }, deviceScaleFactor:2 });
            await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
            const page = await context.newPage(); await page.goto(origin + '/comparacion'); await iniciar(page, 'exito');
            await page.evaluate(async () => {
                const f=window.__fixture,api=window.HAIKU_LIBRO_CANCELACIONES_V1;
                api.adjuntar(document.getElementById('out2'),await api.detectarActual(f.hoja),f.generacion);
            });
            await page.locator('#out').getByRole('button', { name:/^Preparar cancelación/ }).click();
            await page.locator('#out2').getByRole('button', { name:/^Preparar cancelación/ }).click();
            await page.locator('#out2').getByRole('button', { name:'Confirmar cancelación', exact:true }).click();
            await page.locator('#out2').getByRole('heading', { name:'Cancelación completada', exact:true }).waitFor();
            await page.locator('#out .haiku-cancelacion-pantalla').screenshot({ path:path.join(process.env.HAKU_CANCELACION_CAPTURAS, 'revision-escritorio.png'), scale:'css' });
            await page.locator('#out2 .haiku-cancelacion-pantalla').screenshot({ path:path.join(process.env.HAKU_CANCELACION_CAPTURAS, 'completada-escritorio.png'), scale:'css' });
            await page.screenshot({ path:path.join(process.env.HAKU_CANCELACION_CAPTURAS, 'escritorio.png'), fullPage:true, scale:'css' });
            const medidas=await page.locator('.haiku-cancelacion-pantalla').evaluateAll(paneles=>paneles.map(p=>({
                pantalla:p.getAttribute('aria-label'),ancho:p.clientWidth+2,alto:p.clientHeight+2,titulo:getComputedStyle(p.querySelector('h3')).fontSize,
                pieDesdeArriba:p.querySelector('footer').getBoundingClientRect().top-p.getBoundingClientRect().top,
                cabeceraAlto:p.querySelector('header').getBoundingClientRect().height,
                tarjetaDesdeArriba:p.querySelector('.haiku-cancelacion-pantalla__reserva').getBoundingClientRect().top-p.getBoundingClientRect().top,
                overflow:p.scrollWidth-p.clientWidth
            })));
            fs.writeFileSync(path.join(process.env.HAKU_CANCELACION_CAPTURAS,'medidas.json'),JSON.stringify(medidas,null,2)+'\n');
            await context.close();
            // Capturas completas sin que el compositor del asistente tape los extremos
            // al capturar un elemento mayor que su contenedor desplazable.
            for (const width of [320,390,1100]) {
                const context=await browser.newContext({viewport:{width,height:850},deviceScaleFactor:2});
                await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
                const page=await context.newPage();await page.goto(origin+'/captura');await iniciar(page,'exito');
                await page.getByRole('button',{name:/^Preparar cancelación/}).click();await geometria(page);
                const panel=page.locator('.haiku-cancelacion-pantalla');
                await panel.screenshot({path:path.join(process.env.HAKU_CANCELACION_CAPTURAS,`revision-${width}.png`),scale:'css'});
                await panel.getByRole('button',{name:'Confirmar cancelación',exact:true}).click();
                await page.getByRole('heading',{name:'Cancelación completada',exact:true}).waitFor();await geometria(page);
                await panel.screenshot({path:path.join(process.env.HAKU_CANCELACION_CAPTURAS,`completada-${width}.png`),scale:'css'});
                await context.close();
            }
        }
    } finally { await browser?.close(); await new Promise(ok => server.close(ok)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
