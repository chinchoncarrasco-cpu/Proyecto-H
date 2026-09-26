// Panel real con Supabase simulado: no usa credenciales ni escribe en producción.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const raiz = path.resolve(__dirname, '..');
const modulos = new Set([
    'js/historial.js', 'js/calendario.js', 'js/checklist.js', 'js/app.js',
    'js/cabanas.js', 'js/sites-cabanas-v1.js', 'js/supabase-aseo-operacion-v1.js'
]);

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.HAIKU_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        headless: true
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Santiago' });
        const errores = [], avisos = [];
        page.on('pageerror', error => errores.push(error.message));
        page.on('dialog', async dialog => { avisos.push(dialog.message()); await dialog.accept(); });
        await page.addInitScript(() => {
            window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: 'visible', armado: true }) };
            window.HAIKU_REVISION_SUPABASE_V1 = {};
        });
        await page.route('**/*', ruta => {
            const url = new URL(ruta.request().url());
            if (url.hostname === 'cdn.jsdelivr.net') return ruta.fulfill({
                contentType: 'application/javascript', body: 'window.supabase={createClient:()=>({})}'
            });
            if (url.hostname !== 'haiku-aseo.test') return ruta.abort();
            const nombre = decodeURIComponent(url.pathname.slice(1));
            if (nombre.includes('..')) return ruta.abort();
            const archivo = path.join(raiz, nombre);
            if (!fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) return ruta.abort();
            if (nombre.endsWith('.js') && !modulos.has(nombre)) {
                return ruta.fulfill({ contentType: 'application/javascript', body: '' });
            }
            return ruta.fulfill({ contentType: nombre.endsWith('.html') ? 'text/html' :
                nombre.endsWith('.js') ? 'application/javascript' :
                    nombre.endsWith('.css') ? 'text/css' : 'application/octet-stream',
            body: fs.readFileSync(archivo) });
        });
        await page.goto('http://haiku-aseo.test/panel.html');
        await page.waitForFunction(() => document.readyState === 'complete' && window.HAIKU_CABANAS_SITES_V1);
        assert.equal(await page.evaluate(() => Boolean(window.HAIKU_ASEO_OPERACION_V1)), false);
        await page.evaluate(async () => {
            fechaSeleccionada = '2026-09-26';
            window.HAIKU_CONTEXTO_FECHAS_V1.guardarFechaActual();
            const filas = {
                cabanas: Array.from({ length: 11 }, (_, i) => ({ id: 'cab-' + (i + 1), numero: i + 1, activa: true })),
                checklist_items: [], solicitudes: [], revisiones_cabana: [], revision_items: [],
                aseos: [
                    { cabana_id: 'cab-1', encargado_nombre: 'Aura', estado: 'asignado' },
                    { cabana_id: 'cab-2', iniciado_en: '2026-09-26T12:00:00Z', estado: 'pendiente' },
                    { cabana_id: 'cab-3', iniciado_en: '2026-09-26T12:00:00Z', completado_en: '2026-09-26T13:00:00Z', estado: 'en_proceso' },
                    { cabana_id: 'cab-4', iniciado_en: '2026-09-26T12:00:00Z', completado_en: '2026-09-26T13:00:00Z', estado: 'completado' },
                    { cabana_id: 'cab-5', estado: 'no_requiere' }
                ].map(fila => ({ ...fila, id: 'aseo-' + fila.cabana_id, fecha: fechaSeleccionada }))
            };
            window.__escriturasAseo = [];
            window.haikuSupabase = {
                from(tabla) {
                    const filtros = [];
                    let payload;
                    const leer = () => filas[tabla].filter(fila => filtros.every(fn => fn(fila)));
                    const consulta = {
                        select() { return consulta; }, order() { return consulta; }, limit() { return consulta; },
                        eq(campo, valor) { filtros.push(fila => fila[campo] === valor); return consulta; },
                        is(campo, valor) { filtros.push(fila => (fila[campo] ?? null) === valor); return consulta; },
                        neq(campo, valor) { filtros.push(fila => fila[campo] !== valor); return consulta; },
                        in(campo, valores) { filtros.push(fila => valores.includes(fila[campo])); return consulta; },
                        upsert(valor) { payload = valor; window.__escriturasAseo.push({ tabla, payload: { ...valor } }); return consulta; },
                        insert(valor) { return consulta.upsert(valor); },
                        update(valor) { return consulta.upsert(valor); },
                        single() {
                            let fila = payload.cabana_id ? filas[tabla].find(fila => fila.cabana_id === payload.cabana_id) : leer()[0];
                            if (!fila && !payload.cabana_id) return Promise.resolve({ data: null, error: new Error('Ciclo cambiado') });
                            if (!fila) { fila = { id: 'nuevo-' + payload.cabana_id }; filas[tabla].push(fila); }
                            Object.assign(fila, payload);
                            return Promise.resolve({ data: fila, error: null });
                        },
                        maybeSingle() { return Promise.resolve({ data: leer()[0] || null, error: null }); },
                        then(resolve, reject) { return Promise.resolve({ data: leer(), error: null }).then(resolve, reject); }
                    };
                    return consulta;
                }
            };
            // El módulo se evaluó antes del cliente y después de DOMContentLoaded.
            document.dispatchEvent(new CustomEvent('haiku:supabase-ready'));
            window.haikuSesion = { usuario: { id: 'prueba-aseo' }, auth: { id: 'prueba-aseo' } };
            window.dispatchEvent(new CustomEvent('haiku:auth-ready'));
            await window.HAIKU_ASEO_OPERACION_V1.hidratar(fechaSeleccionada);
            for (const [numero, resultado] of [[3, 'lista'], [4, 'con_detalles']]) {
                obtenerDatosDia(fechaSeleccionada).cabanas[numero].revisionCompletaCiclo = {
                    fecha: fechaSeleccionada, verificado: true, estado: 'completada', resultado
                };
            }
            window.HAIKU_CABANAS_SITES_V1.pintar();
        });
        await page.locator('.menu-item[data-seccion="cabanas"]').click();
        const fila = numero => page.locator('#aseo-resumen [data-cb-cabin="' + numero + '"]');
        const aseo = numero => fila(numero).locator('[data-cb-aseo-state]');
        const esperarAseo = (numero, texto) => page.waitForFunction(({ numero, texto }) =>
            document.querySelector('#aseo-resumen [data-cb-cabin="' + numero + '"] [data-cb-aseo-state]')?.textContent === texto,
        { numero, texto });
        for (const [numero, estado] of [[1, 'Pendiente'], [2, 'En curso'], [3, 'Lista para revisar'], [5, 'No requiere']]) {
            assert.equal(await aseo(numero).textContent(), estado);
        }
        assert.equal(await fila(3).locator('[data-cb-revision-state]').textContent(), 'Lista');
        assert.equal(await fila(3).locator('[data-cb-final-state]').textContent(), 'Lista');
        assert.equal(await fila(4).locator('[data-cb-final-state]').textContent(), 'Con detalles');
        assert.equal(await fila(1).locator('select').count(), 0);
        assert.equal(await fila(1).locator('[data-aseo-hora="aseoOut"]').isDisabled(), true);
        await fila(1).locator('.aseo-encargado-input').fill('Rodolfo');
        await fila(1).locator('.aseo-encargado-input').blur();
        await page.waitForFunction(() => window.__escriturasAseo.length === 1);
        assert.equal(await aseo(1).textContent(), 'Pendiente');
        await fila(1).locator('[data-aseo-hora="aseoIn"]').fill('09:00');
        await fila(1).locator('[data-aseo-hora="aseoIn"]').blur();
        await esperarAseo(1, 'En curso');
        await fila(1).locator('[data-aseo-hora="aseoOut"]').fill('10:00');
        await fila(1).locator('[data-aseo-hora="aseoOut"]').blur();
        await esperarAseo(1, 'Lista para revisar');
        assert.equal(await fila(1).locator('[data-cb-no-requiere]').count(), 0);
        // Intentar borrar IN con OUT debe conservar ambas horas, incluido el caché legacy.
        await fila(1).locator('[data-aseo-hora="aseoIn"]').fill('');
        await fila(1).locator('[data-aseo-hora="aseoIn"]').blur();
        await page.waitForFunction(() => document.querySelector('[data-cb-cabin="1"] [data-aseo-hora="aseoIn"]').value === '09:00');
        assert.match(avisos.at(-1), /IN antes de OUT/);
        await fila(5).locator('[data-cb-no-requiere]').click();
        await esperarAseo(5, 'Pendiente');
        await fila(5).locator('[data-cb-no-requiere]').click();
        await esperarAseo(5, 'No requiere');
        assert.equal(await page.evaluate(() => window.__escriturasAseo.length), 5);
        await page.evaluate(() => {
            for (let i = 0; i < 4; i++) {
                document.dispatchEvent(new CustomEvent('haiku:supabase-ready'));
                window.dispatchEvent(new CustomEvent('haiku:auth-ready'));
            }
        });
        await fila(6).locator('.aseo-encargado-input').fill('Aura');
        await fila(6).locator('.aseo-encargado-input').blur();
        await page.waitForFunction(() => window.__escriturasAseo.length === 6);
        await page.evaluate(() => window.HAIKU_ASEO_OPERACION_V1.esperarEscrituras());
        assert.equal(await page.evaluate(() => window.__escriturasAseo.length), 6);
        for (const width of [1600, 1440, 1280, 1100, 1000, 900, 781, 768, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('aseo-resumen').scrollLeft = 0; });
            for (const selector of ['[data-cb-revision-state]', '[data-cb-aseo-state]', '[data-cb-final-state]']) {
                assert.equal(await fila(1).locator(selector).isVisible(), true, width + ': ' + selector);
            }
            const geometria = await fila(1).evaluate(nodo => {
                const estados = ['[data-cb-revision-state]', '[data-cb-aseo-state]', '[data-cb-final-state]']
                    .map(selector => nodo.querySelector(selector));
                return { ancho: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
                    altura: nodo.getBoundingClientRect().height,
                    alturas: [...nodo.parentElement.querySelectorAll('.cb-operation-row')].map(fila => fila.getBoundingClientRect().height),
                    columnas: [...nodo.children].map(celda => getComputedStyle(celda).gridRowStart),
                    centros: estados.map(estado => { const r = estado.getBoundingClientRect(); return r.y + r.height / 2; }),
                    fuentes: estados.map(estado => parseFloat(getComputedStyle(estado).fontSize)),
                    cajas: estados.map(estado => { const r = estado.getBoundingClientRect(); return { x: r.x, right: r.right }; }) };
            });
            assert.ok(geometria.fuentes[0] > geometria.fuentes[1] && geometria.fuentes[0] > geometria.fuentes[2]);
            if (width >= 1100 || width <= 780) {
                assert.ok(geometria.cajas.every(caja => caja.x >= 0 && caja.right <= width), JSON.stringify({ width, geometria }));
            } else {
                // Desktop angosto conserva columnas y permite desplazar sólo la tabla.
                await fila(1).locator('[data-cb-final-state]').scrollIntoViewIfNeeded();
                const final = await fila(1).locator('[data-cb-final-state]').boundingBox();
                assert.ok(final.x >= 0 && final.x + final.width <= width);
            }
            assert.ok(geometria.scroll <= geometria.ancho + 1, JSON.stringify({ width, geometria }));
            if (width > 780) {
                assert.ok(geometria.altura <= 74, 'Fila compacta: ' + JSON.stringify({ width, geometria }));
                assert.ok(geometria.alturas.every(altura => altura <= 74), 'No requiere tampoco aumenta la altura');
                assert.equal(geometria.columnas.length, 9);
                assert.ok(geometria.columnas.every(fila => fila === '1'));
                assert.ok(Math.max(...geometria.centros) - Math.min(...geometria.centros) < 2,
                    'Estados alineados horizontalmente: ' + JSON.stringify({ width, geometria }));
            }
            if (process.env.HAIKU_ASEO_SCREENSHOTS && [1440, 390].includes(width)) {
                fs.mkdirSync(process.env.HAIKU_ASEO_SCREENSHOTS, { recursive: true });
                await page.screenshot({ path: path.join(process.env.HAIKU_ASEO_SCREENSHOTS, 'aseo-' + width + '.png') });
            }
        }
        await fila(1).locator('[data-cb-open]').click();
        assert.equal(await page.locator('#cabinsDetailAseo select').count(), 0);
        assert.equal(await page.locator('#cabinsDetailAseo [data-cb-aseo-state]').textContent(), 'Lista para revisar');
        assert.deepEqual(errores, []);
        console.log('Panel Aseo: arranque tardío, estados, IN/OUT, No requiere, escritura única y diseño 390–1600px OK.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
