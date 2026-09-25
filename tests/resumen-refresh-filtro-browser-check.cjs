// El filtro real Sites permanece sobre A y cambia con B en una publicación.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const leer = ruta => fs.readFileSync(path.join(root, ruta), 'utf8');
const html = leer('index.html');
const inicio = html.indexOf('<section id="seccion-resumen"');
const fin = html.indexOf('<section id="seccion-calendario"', inicio);
assert.ok(inicio >= 0 && fin > inicio);
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 },
            timezoneId: 'America/Santiago' });
        page.on('pageerror', error => console.error('Página:', error.message));
        await page.route('http://haiku.test/**', ruta => ruta.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><body>${html.slice(inicio, fin)}</body></html>`
        }));
        await page.goto('http://haiku.test/panel.html');
        await page.evaluate(() => {
            document.querySelector('#seccion-resumen').insertAdjacentHTML('afterbegin',
                '<p id="resumen-refresh-estado"></p>');
            Object.defineProperty(window, 'localStorage', {
                configurable: true, value: { setItem() {}, getItem() { return null; } }
            });
            window.haikuSesion = { auth: { id: 'usuario-prueba' } };
            window.datosPorFecha = {};
            window.haikuTienePermiso = () => false;
            window.__pendientes = [];
            window.__resuelvePagos = {};
            window.__consultas = [];
            window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1 = {
                estaListo: () => true,
                obtener: () => window.__pendientes
            };
            window.haikuSupabase = {
                rpc: async (_nombre, parametros) => {
                    window.__consultas.push(parametros.p_fecha);
                    if (parametros.p_fecha === '2026-09-11') {
                        return { data: null, error: new Error('Contexto anterior no disponible') };
                    }
                    return { data: [], error: null };
                },
                from: () => { throw Error('Sites no debe consultar otra fuente de cargos'); }
            };
        });
        const calendario = leer('js/calendario.js');
        await page.addScriptTag({ content: `let fechaSeleccionada = '2026-09-12';\n${calendario.slice(
            calendario.indexOf('function seleccionarDia('))}\nwindow.__fechaSeleccionada = () => fechaSeleccionada;` });
        await page.addScriptTag({ content: leer('js/supabase-resumen-refresh-v1.js') });
        await page.evaluate(() => {
            const coordinador = window.HAIKU_RESUMEN_REFRESH_V1;
            const numeroPendiente = gen => gen % 2 ? '1' : '2';
            const filas = gen => Array.from({ length: 11 }, (_, i) => {
                const numero = String(i + 1);
                const ingresa = numero === numeroPendiente(gen);
                return { numero, estado_operativo: ingresa ? 'libre-ingresa' : 'libre-libre',
                    ingreso_reserva_id: ingresa ? `reserva-${numero}` : null,
                    ingreso_titular: ingresa ? `Huésped ${numero}` : null };
            });
            coordinador.registrar('reservas', { orden: 10,
                preparar: () => true, publicar: () => {} });
            coordinador.registrar('servicios', { orden: 20,
                preparar: () => [], publicar: () => {} });
            coordinador.registrar('pagos', { orden: 30,
                dependencias: ['operacion'],
                preparar: () => true,
                completar: ({ generacion }) => new Promise(resolve => {
                    window.__resuelvePagos[generacion] = () => {
                        const numero = numeroPendiente(generacion);
                        resolve({ pendientes: [{ tipo: 'checkin', numeroCabana: numero,
                            reservaId: `reserva-${numero}`, monto: generacion * 10000 }],
                            cargos: [{ reserva_id: `reserva-${numero}`, tipo_cargo: 'alojamiento',
                                estado: 'activo', saldo_cargo: generacion * 10000,
                                monto_ajustado: 160000 }] });
                    };
                }),
                publicar: snapshot => {
                    window.__pendientes = snapshot.datos.pagos.pendientes;
                    document.getElementById('contador-pagos').textContent =
                        String(window.__pendientes.length);
                } });
            for (const nombre of ['checkout', 'checkoutAutoridad', 'notas', 'aseo', 'revision']) {
                coordinador.registrar(nombre, { orden: 40,
                    preparar: () => true, publicar: () => {} });
            }
            coordinador.registrar('operacion', { orden: 80,
                preparar: ({ generacion }) => ({ filas: filas(generacion) }),
                publicar: snapshot => {
                    for (const fila of snapshot.datos.operacion.filas) {
                        const article = document.querySelector(
                            `.sites-resumen-cabana[data-cabana="${fila.numero}"]`);
                        article.dataset.resumenFecha = snapshot.fecha;
                        article.dataset.resumenReservaId = fila.ingreso_reserva_id || '';
                        article.dataset.ingresoReservaId = fila.ingreso_reserva_id || '';
                        article.dataset.resumenTitularReservaId = fila.ingreso_reserva_id || '';
                        article.dataset.resumenTitular = fila.ingreso_titular || '';
                        article.querySelector('[data-campo="estado"]').value = fila.estado_operativo;
                    }
                } });
            coordinador.registrar('autoridadVisual', { orden: 90,
                preparar: () => true, publicar: () => {} });
        });
        await page.addScriptTag({ content: leer('js/supabase-resumen-tablero-v1.js') });
        await page.waitForFunction(() => Object.keys(window.__resuelvePagos).length > 0);
        await page.waitForTimeout(100);
        const generacionA = await page.evaluate(() => Math.max(...Object.keys(window.__resuelvePagos).map(Number)));
        const cabanaA = generacionA % 2 ? '1' : '2';
        const cabanaB = cabanaA === '1' ? '2' : '1';
        await page.evaluate(generacion => window.__resuelvePagos[generacion](), generacionA);
        await page.waitForFunction(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === 1);
        await page.locator('[data-resumen-filtro="pagos"]').click();
        assert.equal(await page.locator(`.sites-resumen-cabana[data-cabana="${cabanaA}"]`).isVisible(), true);
        assert.equal(await page.locator(`.sites-resumen-cabana[data-cabana="${cabanaB}"]`).isVisible(), false);
        await page.evaluate(() => {
            window.__segunda = window.HAIKU_RESUMEN_REFRESH_V1.solicitar();
            return true;
        });
        const generacionB = generacionA + 1;
        await page.waitForFunction(generacion => Boolean(window.__resuelvePagos[generacion]), generacionB);
        assert.equal(await page.locator(`.sites-resumen-cabana[data-cabana="${cabanaA}"]`).isVisible(), true);
        assert.equal(await page.locator(`.sites-resumen-cabana[data-cabana="${cabanaB}"]`).isVisible(), false);
        assert.equal(await page.locator('#contador-pagos').textContent(), '1');
        await page.evaluate(generacion => window.__resuelvePagos[generacion](), generacionB);
        await page.waitForFunction(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === 2);
        assert.equal(await page.locator(`.sites-resumen-cabana[data-cabana="${cabanaA}"]`).isVisible(), false);
        assert.equal(await page.locator(`.sites-resumen-cabana[data-cabana="${cabanaB}"]`).isVisible(), true);
        assert.match(await page.locator(`.sites-resumen-cabana[data-cabana="${cabanaB}"] .sites-resumen-celda--cobros`).textContent(),
            /Saldo \$/);
        assert.equal(await page.locator('[data-resumen-filtro="pagos"]').getAttribute('aria-pressed'), 'true');
        const detalle = page.locator(`.sites-resumen-cabana[data-cabana="${cabanaB}"] [data-resumen-expandir]`);
        await detalle.click();
        assert.equal(await detalle.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator(`#sites-resumen-detalle-${cabanaB}`).isVisible(), true);
        assert.equal(await page.evaluate(() => window.__consultas.includes('2026-09-12')), false);
        const fechaVisibleA = await page.locator('#fecha-actual').textContent();
        await page.locator('#resumen-dia-anterior').click();
        const generacionAnterior = generacionB + 1;
        await page.waitForFunction(generacion => Boolean(window.__resuelvePagos[generacion]), generacionAnterior);
        assert.equal(await page.evaluate(() => window.__fechaSeleccionada()), '2026-09-11');
        assert.equal(await page.locator('#fecha-actual').textContent(), fechaVisibleA);
        assert.equal(await page.locator('#resumen-dia-anterior').getAttribute('aria-busy'), 'true');
        assert.match(await page.locator('#resumen-dia-anterior').getAttribute('aria-label'), /cargando/);
        const origenNavegacion = await page.evaluate(() =>
            window.HAIKU_RESUMEN_REFRESH_V1.historialGeneraciones().at(-1));
        assert.equal(origenNavegacion.categoria, 'navegación usuario');
        assert.equal(origenNavegacion.evento, 'Día anterior');
        assert.equal(origenNavegacion.fecha, '2026-09-11');
        assert.equal(origenNavegacion.fechaPublicada, '2026-09-12');
        assert.match(origenNavegacion.stack, /seleccionarDia/);
        assert.equal(origenNavegacion.t3, undefined);
        assert.equal(origenNavegacion.generacion, generacionAnterior);
        assert.equal(origenNavegacion.resultado, 'ACEPTADA');
        await page.locator('#resumen-dia-siguiente').click();
        const generacionVuelta = generacionAnterior + 1;
        await page.waitForFunction(generacion => Boolean(window.__resuelvePagos[generacion]), generacionVuelta);
        assert.equal(await page.evaluate(() => window.__fechaSeleccionada()), '2026-09-12');
        assert.equal(await page.locator('#resumen-dia-anterior').getAttribute('aria-busy'), null);
        assert.equal(await page.locator('#resumen-dia-siguiente').getAttribute('aria-busy'), 'true');
        assert.equal(await page.evaluate(() =>
            window.HAIKU_RESUMEN_REFRESH_V1.historialGeneraciones().at(-1).evento),
        'Día siguiente');
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones()), 2);
        await page.evaluate(generacion => window.__resuelvePagos[generacion](), generacionVuelta);
        await page.waitForFunction(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === 3);
        assert.equal(await page.locator('#resumen-dia-siguiente').getAttribute('aria-busy'), null);
        const terminado = await page.evaluate(() =>
            window.HAIKU_RESUMEN_REFRESH_V1.historialGeneraciones().at(-1));
        assert.equal(terminado.resultado, 'PUBLICADA');
        assert.ok(terminado.t3 && terminado.t4 && terminado.t5);
        assert.ok(Date.parse(terminado.t3) <= Date.parse(terminado.t4));
        assert.ok(Date.parse(terminado.t4) <= Date.parse(terminado.t5));
        await page.evaluate(generacion => window.__resuelvePagos[generacion](), generacionAnterior);
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones()), 3);
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.ultimo().fecha), '2026-09-12');
        let generacion = generacionVuelta;
        let publicaciones = 3;
        for (const filtro of ['continuan', 'ingresan', 'salen', 'servicios', 'pagos']) {
            await page.locator(`[data-resumen-filtro="${filtro}"]`).click();
            const visiblesA = await page.locator('.sites-resumen-cabana:visible')
                .evaluateAll(filas => filas.map(fila => fila.dataset.cabana));
            await page.evaluate(() => {
                window.HAIKU_RESUMEN_REFRESH_V1.solicitar();
                return true;
            });
            generacion++;
            await page.waitForFunction(id => Boolean(window.__resuelvePagos[id]), generacion);
            assert.deepEqual(await page.locator('.sites-resumen-cabana:visible')
                .evaluateAll(filas => filas.map(fila => fila.dataset.cabana)), visiblesA);
            await page.evaluate(id => window.__resuelvePagos[id](), generacion);
            publicaciones++;
            await page.waitForFunction(total =>
                window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === total, publicaciones);
            assert.equal(await page.locator(`[data-resumen-filtro="${filtro}"]`)
                .getAttribute('aria-pressed'), 'true');
        }
        const visiblesAntesDeEvento = await page.locator('.sites-resumen-cabana:visible')
            .evaluateAll(filas => filas.map(fila => fila.dataset.cabana));
        await page.evaluate(() => document.dispatchEvent(
            new CustomEvent('haiku:resumen-datos-actualizados')));
        generacion++;
        await page.waitForFunction(id => Boolean(window.__resuelvePagos[id]), generacion);
        assert.deepEqual(await page.locator('.sites-resumen-cabana:visible')
            .evaluateAll(filas => filas.map(fila => fila.dataset.cabana)), visiblesAntesDeEvento);
        await page.evaluate(id => window.__resuelvePagos[id](), generacion);
        publicaciones++;
        await page.waitForFunction(total =>
            window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === total, publicaciones);
        const hoyChile = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());
        await page.locator('#resumen-dia-anterior').click();
        generacion++;
        await page.waitForFunction(id => Boolean(window.__resuelvePagos[id]), generacion);
        assert.equal(await page.evaluate(() => window.__fechaSeleccionada()), '2026-09-11');
        assert.match(await page.locator('#resumen-refresh-estado').textContent(), /11 de septiembre/);
        const generacionAntesDeHoy = generacion;
        await page.locator('#resumen-dia-hoy').click();
        generacion++;
        await page.waitForFunction(id => Boolean(window.__resuelvePagos[id]), generacion);
        assert.equal(await page.locator('#resumen-dia-hoy').getAttribute('aria-busy'), 'true');
        assert.equal(await page.evaluate(() => window.__fechaSeleccionada()), hoyChile);
        assert.equal(await page.evaluate(() =>
            window.HAIKU_RESUMEN_REFRESH_V1.historialGeneraciones().at(-1).evento), 'Hoy');
        assert.equal(await page.evaluate(() =>
            window.HAIKU_RESUMEN_REFRESH_V1.historialGeneraciones().at(-1).fecha), hoyChile);
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones()), publicaciones);
        await page.evaluate(id => window.__resuelvePagos[id](), generacion);
        publicaciones++;
        await page.waitForFunction(total =>
            window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === total, publicaciones);
        assert.equal(await page.locator('#resumen-dia-hoy').getAttribute('aria-busy'), null);
        await page.evaluate(id => window.__resuelvePagos[id](), generacionAntesDeHoy);
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.ultimo().fecha), hoyChile);
        assert.equal(await page.locator('[data-resumen-filtro="pagos"]').getAttribute('aria-pressed'), 'true');
        const cabanaActual = generacion % 2 ? '1' : '2';
        assert.equal(await page.locator(`.sites-resumen-cabana[data-cabana="${cabanaActual}"]`)
            .getAttribute('data-resumen-reserva-id'), `reserva-${cabanaActual}`);
        await page.locator('#resumen-dia-anterior').click();
        generacion++;
        const generacionAyer = generacion;
        await page.waitForFunction(id => Boolean(window.__resuelvePagos[id]), generacionAyer);
        await page.locator('#resumen-dia-hoy').click();
        generacion++;
        await page.waitForFunction(id => Boolean(window.__resuelvePagos[id]), generacion);
        await page.evaluate(id => window.__resuelvePagos[id](), generacion);
        publicaciones++;
        await page.waitForFunction(total =>
            window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === total, publicaciones);
        await page.evaluate(id => window.__resuelvePagos[id](), generacionAyer);
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.ultimo().fecha), hoyChile);
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones()), publicaciones);
        await page.locator('#resumen-dia-anterior').click();
        generacion++;
        const generacionAnteriorAHoy = generacion;
        await page.waitForFunction(id => Boolean(window.__resuelvePagos[id]), generacionAnteriorAHoy);
        await page.locator('#resumen-dia-siguiente').click();
        generacion++;
        await page.waitForFunction(id => Boolean(window.__resuelvePagos[id]), generacion);
        assert.equal(await page.evaluate(() => window.__fechaSeleccionada()), hoyChile);
        await page.evaluate(id => window.__resuelvePagos[id](), generacion);
        publicaciones++;
        await page.waitForFunction(total =>
            window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === total, publicaciones);
        await page.evaluate(id => window.__resuelvePagos[id](), generacionAnteriorAHoy);
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.ultimo().fecha), hoyChile);
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones()), publicaciones);
        console.log('Resumen Sites: botones reales ±1/Hoy, cinco filtros, IDs y carreras de fechas correctos.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
