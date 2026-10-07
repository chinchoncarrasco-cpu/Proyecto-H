// Flujo del asistente completo: consulta focalizada -> comparación -> preparar
// -> Pagos para revisar -> resolver. Cliente local; conexiones externas bloqueadas.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const api = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const source = read('js/haiku-libro-consultas-v1.js').replace(api, api.replace(' })', ', resolucionManualDisponible })'))
    .replace('contextoVisualPlanes.set(plan, comp);', 'contextoVisualPlanes.set(plan, comp); root.__plan = plan; root.__comparacion = comp;');
const fixture = read('tests/fixtures/libro-airbnb-confirmacion-manual.cjs');
const datos = read('tests/fixtures/libro-airbnb-agustin-focalizado.cjs');
const runtime = read('tests/fixtures/libro-airbnb-agustin-runtime.cjs');
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') return res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        ['styles', 'supabase-asistente-v1', 'supabase-haku-reconciliacion-v1', 'sites-asistente-v1', 'haiku-libro-pagos-ui-v1']
            .map(n => `<link rel="stylesheet" href="/css/${n}.css">`).join('') +
        '</head><body><div class="haiku-asistente-root"><div class="haiku-asistente-panel"><header class="haiku-asistente-cabecera">Haku</header>' +
        '<div id="haiku-asistente-mensajes" class="haiku-asistente-mensajes"></div><footer class="haiku-asistente-compositor">' +
        '<textarea id="haiku-asistente-texto"></textarea><button id="haiku-asistente-enviar">Enviar</button></footer></div></div></body></html>');
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { res.writeHead(200, {'Content-Type': pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'}).end(fs.readFileSync(file)); }
    catch { res.writeHead(404).end(); }
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true});
    try {
        for (const width of [1000, 390]) {
            const page = await browser.newPage({viewport: {width, height: 900}}), errors = [], external = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', route => {
                if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
                external.push(route.request().url()); return route.abort();
            });
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            await page.addScriptTag({content: read('js/haiku-libro-semantica-v1.js')});
            await page.addScriptTag({content: read('js/haiku-libro-pagos-destinos-v1.js')});
            await page.addScriptTag({content: fixture.slice(fixture.indexOf('const id ='), fixture.indexOf('module.exports='))});
            await page.addScriptTag({content: datos.slice(0, datos.indexOf('module.exports ='))});
            await page.addScriptTag({content: runtime.slice(0, runtime.indexOf('module.exports ='))});
            await page.evaluate(() => {
                const h = entorno(); window.__h = h; window.haikuSupabase = h.db;
                const stay = h.tablas.reserva_estadias[0]; stay.fecha_ingreso = '2026-10-14'; stay.fecha_salida = '2026-10-15';
                const raw = resultadoAgustinRuntime(window.HAIKU_LIBRO_SEMANTICA, hojaAgustinFocalizado());
                if (raw.pagos[0].titular !== 'El viajero ha pagado' || raw.reservas[0].pagos.length ||
                    raw.reservas[0].pagos_sin_asociacion[0] !== raw.pagos[0]) throw Error('El fixture perdió la asociación real del aviso sin nombre.');
                window.__raw = raw; window.__original = JSON.stringify(raw);
                window.HAIKU_LIBRO_RESERVA_V1 = {...window.HAIKU_LIBRO_RESERVA_V1, listo: async () => {}, listarHojas: () => ['Oct26'],
                    consultarHoja: async () => structuredClone(raw)};
            });
            // Mismo orden que la aplicación: proxy focalizado antes del interceptor.
            for (const name of ['haiku-libro-pagos-canon-v1', 'haiku-libro-lenguaje-natural-v1', 'haiku-libro-pagos-focalizados-v1'])
                await page.addScriptTag({content: read('js/' + name + '.js')});
            await page.addScriptTag({content: source});
            await page.locator('#haiku-asistente-texto').fill(await page.evaluate(() => SOLICITUD_AGUSTIN));
            await page.getByRole('button', {name: 'Enviar', exact: true}).click();
            await page.waitForFunction(() => document.getElementById('haiku-asistente-texto').disabled === false);
            assert.equal(await page.getByRole('button', {name: 'Preparar incorporación', exact: true}).count(), 1,
                await page.locator('#haiku-asistente-mensajes').innerText());
            await page.getByRole('button', {name: 'Preparar incorporación', exact: true}).click();
            const revisar = page.locator('.haiku-incorporacion-seccion--dudosos');
            assert.match(await revisar.locator(':scope > summary').innerText(), /Pagos para revisar/);
            await revisar.locator(':scope > summary').click();
            const tarjeta = revisar.locator('article').filter({hasText: 'Agustin Rampa Spinelli'});
            const diagnostico = await page.evaluate(() => {
                const item = window.__plan.items.find(i => i.pagoLibro), x = window.__comparacion.pagosDetalle.find(x => x.pago === item.pagoLibro);
                return {categoria: item.categoria, medio: item.payload.argumentos.p_medio_pago, motivos: item.motivos,
                    reserva_id: item.payload.argumentos.p_reserva_id, estadia_id: window.__comparacion.find(r => r.libro === x.reserva)?.sistema?.id,
                    monto: item.payload.argumentos.p_monto, fecha_pago: item.payload.argumentos.p_fecha_pago,
                    tipo_estadia_libro: x.reserva.tipo_estadia, tipo_estadia_destino: window.__comparacion.find(r => r.libro === x.reserva)?.sistema?.tipo_estadia,
                    evidencia: window.HAIKU_LIBRO_PAGOS_CANON_V1.medioDesdeTexto({...item.pagoLibro, medio_pago: null}),
                    titular_pago: item.pagoLibro.titular, texto_original: item.pagoLibro.texto_original,
                    origen: item.pagoLibro.origen,
                    asociadoAutomaticamente: x.reserva.pagos.includes(item.pagoLibro),
                    pendienteAsociacion: x.reserva.pagos_sin_asociacion.includes(item.pagoLibro),
                    aprobable: item.aprobable, seleccionado: item.seleccionado, conflicto: item.pagoLibro.conflicto_distribucion || false,
                    destinoFinanciero: item.destinoFinanciero, manualPago: item.manualPago?.tipo || null,
                    resolucionManualDisponible: window.HAIKU_LIBRO_CONSULTAS.resolucionManualDisponible(item)};
            });
            console.log('Item producido por la ruta focalizada:', JSON.stringify(diagnostico));
            assert.deepEqual(diagnostico.motivos, ['Requiere aprobación manual de la asociación y el pago.',
                'Falta la fecha del comprobante; no se usa la fecha del bloque como fecha de pago.']);
            assert.equal(diagnostico.tipo_estadia_libro, null); assert.equal(diagnostico.tipo_estadia_destino, 'alojamiento');
            assert.equal(diagnostico.aprobable, false); assert.equal(diagnostico.seleccionado, false);
            assert.equal(diagnostico.evidencia, 'airbnb_prepaid_card');
            assert.equal(diagnostico.titular_pago, 'El viajero ha pagado');
            assert.equal(diagnostico.texto_original, require('./fixtures/libro-airbnb-agustin-runtime.cjs').PAGO_AGUSTIN_RUNTIME.texto_original);
            assert.deepEqual(diagnostico.origen, {hoja: 'Oct26', celda: 'BC41:BF41'});
            assert.equal(diagnostico.asociadoAutomaticamente, false);
            assert.equal(diagnostico.pendienteAsociacion, true);
            assert.equal(diagnostico.resolucionManualDisponible, true);
            assert.match(await tarjeta.evaluate(el => el.outerHTML), /Aprobación manual/);
            assert.match(await tarjeta.innerText(), /CAB 4[\s\S]*165\.598[\s\S]*14\/10\/26[\s\S]*Airbnb Prepaid Card/);
            await tarjeta.getByRole('button', {name: 'Aprobación manual', exact: true}).click();
            const panel = tarjeta.locator('.haiku-incorporacion-manual-pago-panel:not([hidden])');
            assert.match(await panel.innerText(), /Completar confirmación Airbnb/);
            assert.equal(await panel.getByLabel('Fecha real del pago *', {exact: true}).inputValue(), '');
            assert.equal(await revisar.locator('.haiku-incorporacion-atajo--aprobar').count(), 0);
            assert.deepEqual(await page.evaluate(() => {
                const i = window.__plan.items.find(i => i.pagoLibro);
                return {seleccionado: i.seleccionado, categoria: i.categoria, fecha: i.payload.argumentos.p_fecha_pago,
                    pagos: window.__h.tablas.pagos.length, writes: window.__h.llamadas.filter(x => x.nombre).length,
                    original: window.__original === JSON.stringify(window.__raw)};
            }), {seleccionado: false, categoria: 'dudosos', fecha: null, pagos: 0, writes: 0, original: true});
            assert.equal(await page.locator('.haiku-incorporacion-item--pagos').count(), 0);
            if (process.env.HAKU_AIRBNB_SCREENSHOT_DIR) {
                fs.mkdirSync(process.env.HAKU_AIRBNB_SCREENSHOT_DIR, {recursive: true});
                await tarjeta.screenshot({path: path.join(process.env.HAKU_AIRBNB_SCREENSHOT_DIR, `agustin-focalizado-${width}.png`)});
            }
            await panel.getByLabel('Fecha real del pago *', {exact: true}).fill('2026-10-12');
            await panel.getByLabel('He recibido la confirmación de pago de Airbnb', {exact: true}).check();
            await panel.getByRole('button', {name: 'Completar confirmación Airbnb', exact: true}).click();
            await page.waitForFunction(() => window.__plan.items.find(i => i.pagoLibro)?.categoria === 'pagos');
            assert.deepEqual(await page.evaluate(() => {
                const item = window.__plan.items.find(i => i.pagoLibro);
                return {categoria: item.categoria, fecha: item.payload.argumentos.p_fecha_pago,
                    medio: item.payload.argumentos.p_medio_pago, motivos: item.motivos,
                    writes: window.__h.llamadas.filter(x => x.nombre).length};
            }), {categoria: 'pagos', fecha: '2026-10-12', medio: 'airbnb_prepaid_card', motivos: [], writes: 0});
            assert.deepEqual(errors, []); assert.deepEqual(external, []); await page.close();
        }
        console.log('OK · ruta focalizada real 14/10/26: item.aprobable=false, resolver disponible, botón dentro de Pagos para revisar, fecha vacía y cero escrituras.');
    } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error); process.exitCode = 1;});
