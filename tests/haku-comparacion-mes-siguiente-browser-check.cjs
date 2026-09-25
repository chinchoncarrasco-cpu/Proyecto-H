// Botones reales de Haku con los interceptores reales del Libro y Servicios.
// El lector XLSX se sustituye en memoria; no hay escritura ni red.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const raiz = path.resolve(__dirname, '..');
const leer = nombre => fs.readFileSync(path.join(raiz, 'js', nombre), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function escenario(browser, instante, hojas, acciones, ancho = 1280) {
    const page = await browser.newPage({ timezoneId: 'America/Santiago', viewport: { width: ancho, height: 800 } });
    const errores = [];
    page.on('pageerror', error => errores.push(error.message));
    try {
        await page.clock.install({ time: new Date(instante) });
        await page.goto('about:blank');
        await page.evaluate(nombres => {
            window.haikuSesion = { auth: { id: 'usuario-prueba' } };
            window.haikuSupabase = { auth: { onAuthStateChange: () => ({}) } };
            window.__hojas = nombres;
            window.__lecturas = [];
            window.HAIKU_LIBRO_RESERVA_V1 = {
                listo: async () => {},
                estado: () => ({ cargado: true, nombre: 'Libro de prueba.xlsx', generacion: 1 }),
                listarHojas: () => window.__hojas,
                consultarHoja: async hoja => {
                    window.__lecturas.push({ hoja, ruta: new Error().stack });
                    throw new Error(`LECTURA CONTROLADA ${hoja}`);
                }
            };
        }, hojas);
        for (const nombre of ['haiku-libro-semantica-v1.js', 'supabase-asistente-v1.js',
            'haiku-libro-servicios-scope-v2.js', 'haiku-libro-consultas-v1.js']) {
            await page.addScriptTag({ content: leer(nombre) });
        }
        await page.locator('#haiku-asistente-boton').click();
        for (const accion of acciones) {
            const antes = await page.locator('#haiku-asistente-mensajes .haiku-asistente-mensaje--usuario').count();
            const lecturasAntes = await page.evaluate(() => window.__lecturas.length);
            await page.locator('#haiku-asistente-rapidas summary').click();
            await page.locator(`#haiku-asistente-rapidas [data-haiku-accion-rapida="${accion.id}"]`).click();
            await page.waitForFunction(cantidad => document.querySelectorAll(
                '#haiku-asistente-mensajes .haiku-asistente-mensaje--usuario').length > cantidad, antes);
            const texto = await page.locator('#haiku-asistente-mensajes .haiku-asistente-mensaje--usuario').last().innerText();
            assert.match(texto, accion.texto, accion.id);
            assert.equal(await page.evaluate(valor => window.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.esConsultaServicios(valor), texto),
                accion.tipo === 'servicios');
            if (accion.hoja) {
                const rango = await page.evaluate(({ valor, tipo }) => tipo === 'servicios'
                    ? window.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.rangoDesdeTexto(valor)
                    : window.HAIKU_LIBRO_CONSULTAS.interpretar(valor, window.__hojas),
                { valor: texto, tipo: accion.tipo });
                const fechas = [...texto.matchAll(/\b(\d{2})-(\d{2})-(\d{4})\b/g)]
                    .map(([, dia, mes, anio]) => `${anio}-${mes}-${dia}`);
                assert.equal(rango.desde, fechas[0]);
                assert.equal(rango.hasta, fechas[1]);
                if (accion.tipo === 'libro') assert.deepEqual(rango.hojas, [accion.hoja]);
            }
            await page.waitForFunction(fragmento => document.querySelector(
                '#haiku-asistente-mensajes .haiku-asistente-mensaje--asistente:last-child')?.textContent.includes(fragmento),
            accion.resultado);
            const nuevas = await page.evaluate(inicio => window.__lecturas.slice(inicio), lecturasAntes);
            if (accion.hoja) {
                assert.deepEqual(nuevas.map(x => x.hoja), [accion.hoja], accion.id);
                assert.match(nuevas[0].ruta, accion.tipo === 'servicios' ? /leerLibro/ : /consultar/);
            } else assert.equal(nuevas.length, 0, 'sin hoja no se consulta otro mes');
        }
        assert.deepEqual(errores, []);
    } finally { await page.close(); }
}

(async () => {
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        // Aún es septiembre en Santiago cuando UTC ya pasó a octubre.
        await escenario(browser, '2026-10-01T02:30:00Z', ['Sep26', 'Oct26'], [
            { id: 'libro', tipo: 'libro', texto: /septiembre 2026.*01-09-2026 al 30-09-2026/, hoja: 'Sep26', resultado: 'LECTURA CONTROLADA Sep26' },
            { id: 'libro-siguiente', tipo: 'libro', texto: /octubre 2026.*01-10-2026 al 31-10-2026/, hoja: 'Oct26', resultado: 'LECTURA CONTROLADA Oct26' },
            { id: 'libro', tipo: 'libro', texto: /septiembre 2026.*01-09-2026 al 30-09-2026/, hoja: 'Sep26', resultado: 'LECTURA CONTROLADA Sep26' },
            { id: 'servicios', tipo: 'servicios', texto: /septiembre 2026.*01-09-2026 al 30-09-2026/, hoja: 'Sep26', resultado: 'LECTURA CONTROLADA Sep26' },
            { id: 'servicios-siguiente', tipo: 'servicios', texto: /octubre 2026.*01-10-2026 al 31-10-2026/, hoja: 'Oct26', resultado: 'LECTURA CONTROLADA Oct26' },
            { id: 'servicios', tipo: 'servicios', texto: /septiembre 2026.*01-09-2026 al 30-09-2026/, hoja: 'Sep26', resultado: 'LECTURA CONTROLADA Sep26' }
        ]);
        await escenario(browser, '2026-09-25T12:00:00Z', ['Sep26'], [
            { id: 'libro-siguiente', tipo: 'libro', texto: /octubre 2026.*01-10-2026 al 31-10-2026/, resultado: 'No encuentro la hoja oct26' },
            { id: 'servicios-siguiente', tipo: 'servicios', texto: /octubre 2026.*01-10-2026 al 31-10-2026/, resultado: 'No encuentro la hoja oct26' }
        ]);
        await escenario(browser, '2027-01-01T02:30:00Z', ['Dec26', 'Ene27'], [
            { id: 'libro-siguiente', tipo: 'libro', texto: /enero 2027.*01-01-2027 al 31-01-2027/, hoja: 'Ene27', resultado: 'LECTURA CONTROLADA Ene27' },
            { id: 'servicios-siguiente', tipo: 'servicios', texto: /enero 2027.*01-01-2027 al 31-01-2027/, hoja: 'Ene27', resultado: 'LECTURA CONTROLADA Ene27' }
        ], 390);
        console.log('Haku: botones reales, períodos Chile, hoja correcta, ausencia segura y cambio de año OK');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
