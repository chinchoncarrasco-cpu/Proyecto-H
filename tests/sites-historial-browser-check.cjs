// Harness opcional con Edge + Playwright. Datos sintéticos; nunca conecta a Supabase.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const start = html.indexOf('<section id="seccion-historial"');
const end = html.indexOf('<section id="seccion-reservas"', start);
const section = html.slice(start, end).replace('class="seccion-app sites-history"', 'class="seccion-app sites-history activa"');
const style = [read('css/styles.css'), read('css/sites-shell-v1.css'), read('css/sites-historial-v1.css')].join('\n');
const script = read('js/supabase-historial-v1.js');
const imageDir = path.join(os.tmpdir(), 'haiku-sites-historial');
fs.mkdirSync(imageDir, { recursive: true });

async function installFakeClient(page, roles = ['administrador']) {
    await page.evaluate(rolesArg => {
        const r1 = '11111111-1111-4111-8111-111111111111';
        const r2 = '22222222-2222-4222-8222-222222222222';
        const c1 = '33333333-3333-4333-8333-333333333333';
        const c2 = '44444444-4444-4444-8444-444444444444';
        const u1 = '55555555-5555-4555-8555-555555555555';
        const uMissing = '66666666-6666-4666-8666-666666666666';
        const s1 = '77777777-7777-4777-8777-777777777777';
        const p1 = '88888888-8888-4888-8888-888888888888';
        window.__historyIds = { r1, r2, c1, c2, u1, uMissing, s1, p1 };
        window.haikuSesion = { roles: rolesArg.map(codigo => ({ codigo })), permisos: [] };
        window.__historyQueries = [];

        const events = Array.from({ length: 20 }, (_, i) => {
            const date = i < 10 ? '2026-09-23' : '2026-09-22';
            const hour = String(22 - (i % 10)).padStart(2, '0');
            const service = i === 0;
            const technical = i === 2;
            const payment = i === 3;
            return {
                id: `event-${i + 1}`,
                usuario_id: i === 1 ? uMissing : u1,
                accion: service ? 'servicio_actualizado' : payment ? 'abono_verificado' : 'reserva_actualizada',
                tipo_evento: technical ? 'actualizacion' : payment ? 'finanzas' : 'actualizacion',
                entidad_tipo: service ? 'servicios' : technical ? 'reserva_estadias' : payment ? 'pagos' : 'reservas',
                entidad_id: service ? s1 : payment ? p1 : `entity-${i + 1}`,
                reserva_id: i % 2 === 0 ? r1 : r2,
                estadia_id: null,
                cabana_id: i % 2 === 0 ? c1 : c2,
                turno_id: null,
                descripcion: service ? 'Servicio especial confirmado.' : `Cambio real de prueba ${i + 1}.`,
                cambios: service ? [
                    { campo: 'estado_servicio', anterior: 'programado', nuevo: 'realizado' },
                    { campo: 'access_token', anterior: 'old-secret', nuevo: 'secret-should-stay-hidden' }
                ] : [],
                datos_contexto: service ? { operacion_id: 'op-test-1', access_token: 'secret-should-stay-hidden' } : {},
                origen: i === 1 ? 'sistema' : 'usuario',
                creado_en: `${date}T${hour}:00:00Z`
            };
        });
        // El cliente simula el orden que garantiza .order() y una página remota.
        events[0].descripcion = 'Servicio especial confirmado. access_token=free-text-secret';
        window.__historyTables = {
            eventos_auditoria: events.reverse(),
            usuarios: [{ id: u1, nombre: 'Actor', apellido: 'Real' }],
            reservas: [
                { id: r1, codigo_haiku: 'H-UNO', titular_nombre: 'Valentina Uno' },
                { id: r2, codigo_haiku: 'H-DOS', titular_nombre: 'Gabriel Dos' }
            ],
            cabanas: [{ id: c1, numero: 1, nombre: 'Uno' }, { id: c2, numero: 2, nombre: 'Dos' }],
            servicios: [{ id: s1, reserva_id: r1, total: 30000, estado_servicio: 'realizado', fecha_servicio: '2026-09-23',
                catalogo_servicios: { nombre: 'Servicio especial', codigo: 'ESP' } }],
            pagos: [{ id: p1, reserva_id: r2, monto: 90000, medio_pago: 'transferencia', estado: 'verificado' }],
            reserva_estadias: []
        };

        window.haikuSupabase = {
            from(table) {
                const q = { table, columns: '', filter: null, orderBy: null, ascending: true };
                window.__historyQueries.push(q);
                const result = () => {
                    let rows = [...(window.__historyTables[table] || [])];
                    if (q.filter) rows = rows.filter(row => q.filter(row));
                    if (q.orderBy) rows.sort((a, b) => String(a[q.orderBy] || '').localeCompare(String(b[q.orderBy] || '')) * (q.ascending ? 1 : -1));
                    return rows;
                };
                const chain = {
                    select(columns, options) { q.columns = columns; q.count = options?.count; return chain; },
                    eq(column, value) { q.eq = [column, value]; q.filter = row => String(row[column]) === String(value); return chain; },
                    in(column, values) { q.in = [column, [...values]]; q.filter = row => values.map(String).includes(String(row[column])); return Promise.resolve({ data: result(), error: null }); },
                    order(column, options = {}) { q.orderBy = column; q.ascending = options.ascending !== false; return chain; },
                    range(first, last) { q.range = [first, last]; const rows = result(); return Promise.resolve({ data: rows.slice(first, last + 1), count: rows.length, error: null }); },
                    limit(count) { q.limit = count; return Promise.resolve({ data: result().slice(0, count), error: null }); }
                };
                return chain;
            }
        };
    }, roles);
}

async function loadPage(browser, roles = ['administrador']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<style>${style}</style>${section}`);
    assert.equal(await page.locator('.sites-history-legacy').evaluate(el => getComputedStyle(el).display), 'none', 'el legacy no debe pintarse antes del JS');
    assert.equal(await page.locator('.sites-history-workspace').isVisible(), true);
    assert.match(await page.locator('[data-historial-lista]').innerText(), /Cargando actividad real/);
    await installFakeClient(page, roles);
    await page.addScriptTag({ content: script });
    await page.evaluate(() => window.HistorialSupabase.cargar());
    await page.locator('.sites-history-event').first().waitFor();
    assert.deepEqual(errors, [], `errores JS: ${errors.join('; ')}`);
    return { page, errors };
}

(async () => {
    const browser = await chromium.launch({
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        headless: true
    });
    try {
        const { page, errors } = await loadPage(browser);
        const events = page.locator('.sites-history-event');
        assert.equal(await events.count(), 14, 'primer lote visual de Sites');
        assert.equal(await page.locator('.sites-history-date-group').count(), 2, 'agrupación por fechas reales');
        assert.match(await page.locator('[data-historial-contador]').innerText(), /14 visibles/);
        const titles = await events.locator('summary').allTextContents();
        assert.match(titles[0], /Servicio/);
        assert.match(titles[0], /Actor Real/);
        assert.match(titles[1], /Gabriel Dos/);
        assert.doesNotMatch(titles[1], /Actor Real|undefined|Martina León/);
        const firstTwoTimes = await page.locator('.sites-history-time').allTextContents();
        assert.ok(firstTwoTimes[0].localeCompare(firstTwoTimes[1]) > 0, 'orden cronológico descendente');
        await page.locator('#seccion-historial').screenshot({ path: path.join(imageDir, 'historial-colapsado-1600.png') });

        await events.first().locator('summary').click();
        assert.equal(await events.first().getAttribute('open'), '');
        assert.match(await events.first().innerText(), /Programado|Realizado|estado|Actor Real/i);
        await events.first().locator('summary').click();
        assert.equal(await events.first().getAttribute('open'), null);

        await page.locator('[data-historial-buscar]').fill('Valentina Uno');
        assert.ok(await events.count() > 0);
        assert.doesNotMatch(await page.locator('[data-historial-lista]').innerText(), /Gabriel Dos/);
        await page.locator('[data-historial-buscar]').fill('');
        await page.locator('[data-historial-desde]').fill('2026-09-23');
        assert.equal(await events.count(), 9, 'Desde aplica a la fecha local real');
        await page.locator('[data-historial-desde]').fill('');
        await page.locator('[data-historial-hasta]').fill('2026-09-22');
        assert.equal(await events.count(), 10, 'Hasta incluye el día elegido');
        await page.locator('[data-historial-hasta]').fill('');
        await page.locator('[data-historial-tipo]').selectOption('pago');
        assert.equal(await events.count(), 1, 'Tipo deriva de la entidad real');
        await page.locator('[data-historial-tipo]').selectOption('servicio');
        await page.locator('[data-historial-desde]').fill('2026-09-23');
        await page.locator('[data-historial-hasta]').fill('2026-09-23');
        await page.locator('[data-historial-buscar]').fill('Servicio especial');
        assert.equal(await events.count(), 1, 'búsqueda, fecha y tipo combinados');
        assert.match(await events.first().innerText(), /Servicio especial/);
        const readsBefore = await page.evaluate(() => window.__historyQueries.filter(q => q.table === 'eventos_auditoria' && q.range).length);
        await page.locator('[data-historial-refresh]').click();
        await page.waitForFunction(before => window.__historyQueries.filter(q => q.table === 'eventos_auditoria' && q.range).length > before, readsBefore);
        assert.equal(await page.locator('[data-historial-buscar]').inputValue(), 'Servicio especial');
        assert.equal(await events.count(), 1, 'refresh no duplica');

        await page.locator('[data-historial-buscar]').fill('');
        await page.locator('[data-historial-desde]').fill('');
        await page.locator('[data-historial-hasta]').fill('');
        await page.locator('[data-historial-tipo]').selectOption('');
        assert.equal(await events.count(), 14);
        assert.equal(await page.locator('[data-historial-mas]').isVisible(), true);
        await page.locator('[data-historial-mas]').click();
        assert.equal(await events.count(), 19, 'Mostrar más expone el resto sin repetir el lote');
        await page.locator('[data-historial-refresh]').click();
        await page.waitForTimeout(60);
        assert.equal(await events.count(), 19, 'Actualizar preserva lote visible sin duplicados');

        await page.locator('[data-historial-modo="auditoria"]').click();
        assert.equal(await page.locator('[data-historial-modo="auditoria"]').getAttribute('aria-selected'), 'true');
        assert.equal(await events.count(), 20, 'Auditoría muestra también el evento técnico real');
        assert.doesNotMatch(await page.locator('[data-historial-lista]').textContent(), /secret-should-stay-hidden/);
        assert.doesNotMatch(await page.locator('[data-historial-lista]').textContent(), /free-text-secret/);
        await page.locator('[data-historial-buscar]').fill('secret-should-stay-hidden');
        assert.equal(await events.count(), 0, 'la búsqueda tampoco revela tokens privados');
        await page.locator('[data-historial-buscar]').fill('free-text-secret');
        assert.equal(await events.count(), 0, 'la búsqueda tampoco revela credenciales en texto libre');
        await page.locator('[data-historial-buscar]').fill('');
        await events.nth(2).locator('summary').click();
        assert.match(await events.nth(2).innerText(), /Origen|Entidad|Identificadores/i);
        await page.locator('#seccion-historial').screenshot({ path: path.join(imageDir, 'auditoria-expandida-1600.png') });

        const reservation = await page.evaluate(() => window.__historyIds.r1);
        await page.evaluate(id => window.HistorialSupabase.abrirReserva(id, { titular: 'Valentina Uno', cabana: '1' }), reservation);
        const modal = page.locator('#sites-history-reservation-modal');
        assert.equal(await modal.isVisible(), true);
        assert.match(await modal.innerText(), /Valentina Uno/);
        assert.doesNotMatch(await modal.innerText(), /Gabriel Dos/);
        const reserveQuery = await page.evaluate(() => window.__historyQueries.find(q => q.table === 'eventos_auditoria' && q.eq));
        assert.deepEqual(reserveQuery.eq, ['reserva_id', reservation]);
        await page.keyboard.press('Escape');
        assert.equal(await modal.isVisible(), false);
        await page.locator('[data-historial-modo="historial"]').click();

        for (const width of [1600, 1440, 1200, 1100, 390]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `scroll horizontal a ${width}px`);
            assert.equal(await page.locator('.sites-history-time').first().isVisible(), true, `hora a ${width}px`);
            assert.equal(await page.locator('.sites-history-event summary').first().isVisible(), true, `fila a ${width}px`);
        }
        await page.locator('#seccion-historial').screenshot({ path: path.join(imageDir, 'historial-movil-390.png') });
        await page.evaluate(() => { window.__historyTables.eventos_auditoria = []; });
        await page.locator('[data-historial-refresh]').click();
        await page.waitForFunction(() => document.querySelectorAll('#seccion-historial [data-historial-lista] .sites-history-event').length === 0);
        assert.match(await page.locator('[data-historial-lista]').innerText(), /No hay|Sin eventos|No se encontraron/i);
        assert.deepEqual(errors, []);
        await page.close();

        const restricted = await loadPage(browser, []);
        const restrictedTab = restricted.page.locator('[data-historial-modo="auditoria"]');
        if (await restrictedTab.isVisible() && !await restrictedTab.isDisabled()) {
            await restrictedTab.click();
        }
        assert.notEqual(await restrictedTab.getAttribute('aria-selected'), 'true', 'sin permiso no entra a Auditoría');
        await restricted.page.close();

        console.log('PASS Sites Historial browser: fuente real simulada, filtros, fechas, actor, detalle, reserva, refresh, más, permisos, first paint y 5 anchos.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
