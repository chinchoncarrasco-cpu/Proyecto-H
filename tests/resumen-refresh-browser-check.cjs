// Comprueba publicaciones visibles sobre el markup real del Resumen.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inicio = html.indexOf('<section id="seccion-resumen"');
const fin = html.indexOf('<section id="seccion-calendario"', inicio);
assert.ok(inicio >= 0 && fin > inicio);
const seccion = html.slice(inicio, fin);
const codigo = fs.readFileSync(path.join(root, 'js/supabase-resumen-refresh-v1.js'), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.setContent(`<!doctype html><html class="haiku-resumen-pendiente"><head><style>
            html.haiku-resumen-pendiente #seccion-resumen > .resumen,
            html.haiku-resumen-pendiente #seccion-resumen > .sites-resumen-tabla-cabecera,
            html.haiku-resumen-pendiente #seccion-resumen > .sites-resumen-tablero-panel
            {visibility:hidden}
        </style></head><body>${seccion}</body></html>`);
        await page.evaluate(() => {
            window.fechaSeleccionada = '2026-09-12';
            window.haikuSesion = { auth: { id: 'usuario-test' } };
            window.__esperas = {};
            window.__resolutores = {};
            window.__preparar = (nombre, generacion) => {
                const clave = `${generacion}:${nombre}`;
                if (!window.__esperas[clave]) {
                    window.__esperas[clave] = new Promise(resolve => {
                        window.__resolutores[clave] = resolve;
                    });
                }
                return window.__esperas[clave];
            };
        });
        await page.addScriptTag({ content: codigo });
        await page.evaluate(() => {
            const nombres = ['reservas', 'servicios', 'pagos', 'checkout',
                'checkoutAutoridad', 'notas', 'aseo', 'revision', 'operacion',
                'autoridadVisual', 'tablero'];
            nombres.forEach((nombre, orden) =>
                window.HAIKU_RESUMEN_REFRESH_V1.registrar(nombre, {
                    orden,
                    preparar: ({ generacion }) => window.__preparar(nombre, generacion),
                    publicar: snapshot => {
                        const valor = snapshot.datos[nombre];
                        if (nombre === 'operacion') {
                            document.getElementById('contador-ingresan').textContent = valor;
                            const fila = document.querySelector('.sites-resumen-cabana[data-cabana="1"]');
                            fila.dataset.resumenReservaId = `reserva-${valor}`;
                            fila.querySelector('.titular-cabana').textContent = `Huésped ${valor}`;
                            const boton = fila.querySelector('[data-resumen-expandir]');
                            document.getElementById(boton.getAttribute('aria-controls')).hidden = true;
                            boton.setAttribute('aria-expanded', 'false');
                        }
                        if (nombre === 'servicios') {
                            document.getElementById('contador-servicios').textContent = valor;
                        }
                        if (nombre === 'pagos') {
                            document.getElementById('contador-pagos').textContent = valor;
                        }
                        if (nombre === 'tablero') {
                            document.getElementById('resumen-cabanas-conteo').textContent = `${valor} de 11 cabañas`;
                        }
                    }
                }));
        });
        await page.waitForFunction(() => Boolean(window.__resolutores['1:tablero']));
        assert.equal(await page.locator('#seccion-resumen > .resumen').evaluate(
            el => getComputedStyle(el).visibility), 'hidden');
        await page.evaluate(() => {
            for (const nombre of ['operacion', 'reservas', 'checkout', 'checkoutAutoridad',
                'notas', 'aseo', 'revision', 'autoridadVisual', 'tablero']) {
                window.__resolutores[`1:${nombre}`]('1');
            }
        });
        assert.equal(await page.locator('#contador-ingresan').textContent(), '—');
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones()), 0);
        await page.evaluate(() => window.__resolutores['1:servicios']('2'));
        assert.equal(await page.locator('#contador-servicios').textContent(), '—');
        await page.evaluate(() => window.__resolutores['1:pagos']('3'));
        await page.waitForFunction(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === 1);
        assert.equal(await page.locator('#contador-ingresan').textContent(), '1');
        assert.equal(await page.locator('#contador-servicios').textContent(), '2');
        assert.equal(await page.locator('#contador-pagos').textContent(), '3');
        assert.equal(await page.locator('.sites-resumen-cabana[data-cabana="1"] .titular-cabana').textContent(), 'Huésped 1');
        assert.equal(await page.locator('#seccion-resumen > .resumen').evaluate(
            el => getComputedStyle(el).visibility), 'visible');

        await page.evaluate(() => {
            const boton = document.querySelector('[data-resumen-expandir="1"]');
            boton.setAttribute('aria-expanded', 'true');
            document.getElementById(boton.getAttribute('aria-controls')).hidden = false;
        });

        const segunda = page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.solicitar());
        await page.waitForFunction(() => Boolean(window.__resolutores['2:tablero']));
        await page.evaluate(() => {
            for (const nombre of ['operacion', 'reservas', 'checkout', 'checkoutAutoridad',
                'notas', 'aseo', 'revision', 'autoridadVisual', 'tablero']) {
                window.__resolutores[`2:${nombre}`]('4');
            }
        });
        assert.equal(await page.locator('#contador-ingresan').textContent(), '1');
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones()), 1);
        await page.evaluate(() => window.__resolutores['2:servicios']('5'));
        await page.evaluate(() => window.__resolutores['2:pagos']('6'));
        assert.equal(await segunda, true);
        assert.equal(await page.locator('#contador-ingresan').textContent(), '4');
        assert.equal(await page.locator('#contador-servicios').textContent(), '5');
        assert.equal(await page.locator('#contador-pagos').textContent(), '6');
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones()), 2);
        assert.equal(await page.locator('[data-resumen-expandir="1"]')
            .getAttribute('aria-expanded'), 'false', 'otra reserva cierra el detalle anterior');

        await page.evaluate(() => {
            const boton = document.querySelector('[data-resumen-expandir="1"]');
            boton.setAttribute('aria-expanded', 'true');
            document.getElementById(boton.getAttribute('aria-controls')).hidden = false;
            window.__tercera = window.HAIKU_RESUMEN_REFRESH_V1.solicitar();
            return true;
        });
        await page.waitForFunction(() => Boolean(window.__resolutores['3:tablero']));
        await page.evaluate(() => {
            for (const nombre of ['operacion', 'reservas', 'servicios', 'pagos', 'checkout',
                'checkoutAutoridad', 'notas', 'aseo', 'revision', 'autoridadVisual', 'tablero']) {
                window.__resolutores[`3:${nombre}`]('4');
            }
        });
        await page.waitForFunction(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() === 3);
        assert.equal(await page.locator('[data-resumen-expandir="1"]')
            .getAttribute('aria-expanded'), 'true', 'la misma reserva conserva el detalle abierto');
        assert.equal(await page.locator('#sites-resumen-detalle-1').isVisible(), true);
        console.log('Resumen atómico: A estable, una publicación por generación y estado de detalle ligado a identidad.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
