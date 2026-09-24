// Harness local opcional: Edge con RPC simulada. No conecta con Supabase real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const start = html.indexOf('<section id="seccion-reservas"');
const end = html.indexOf('<section id="seccion-libro-reserva"', start);
const section = html.slice(start, end).replace(/(<section id="seccion-reservas"[^>]*class=")([^"]+)/, '$1$2 activa');
const staticStyles = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"?]+\.css)">/g)]
    .map(match => match[1]);
const style = [...staticStyles, 'css/supabase-reservas-v1.css',
    'css/supabase-reservas-compact-v1.css', 'css/sites-reservas-v1.css']
    .map(read).join('\n');
const script = read('js/supabase-reservas-v1.js');
const copyScript = read('js/supabase-reservas-copiar-v1.js');

async function installFakeClient(page) {
    await page.evaluate(() => {
        window.__reservationCalls = [];
        window.__openedReservations = [];
        window.HAIKU_RESUMEN_RESERVA_SITES_V1 = {
            abrirPorId(id) { window.__openedReservations.push(id); }
        };
        window.haikuSesion = { usuario: { id: 'usuario-prueba' } };
        window.haikuTienePermiso = permiso => ['reservas.ver', 'pagos.ver'].includes(permiso);
        window.__reservationRows = Array.from({ length: 32 }, (_, index) => {
            const id = String(index + 1).padStart(12, '0');
            const number = index + 1;
            return {
                reserva_id: `00000000-0000-4000-8000-${id}`,
                fecha_reserva: `2026-09-${String(24 - (index % 20)).padStart(2, '0')}`,
                creado_en: `2026-09-${String(24 - (index % 20)).padStart(2, '0')}T14:30:00Z`,
                codigo_haiku: `H-COD-${number}`,
                nombre: index === 0 ? 'Valentina' : `Titular ${number}`,
                apellido: index === 0 ? 'Araya' : 'Prueba',
                cabanas: index === 1 ? 'CAB 2 → CAB 3' : `CAB ${(index % 11) + 1}`,
                cabana_numeros: [(index % 11) + 1],
                categorias: [index % 2 ? 'Suite' : 'Estándar'],
                plan_tarifario: index <= 1 ? 'Full Day' : null,
                es_fullday: index <= 1,
                check_in: '2026-10-20',
                check_out: index === 0 ? '2026-10-20' : '2026-10-22',
                adultos: index === 0 ? 3 : index === 1 ? 4 : 2,
                ninos: index === 0 ? 1 : index === 1 ? 2 : 0,
                precio_total: index === 0 ? 100000 : 200000 + index,
                abono: index === 0 ? 120000 : 50000 + index,
                saldo_pendiente: index === 0 ? 73000 : 150000 + index,
                estado: index === 0 ? 'hospedada' : index % 2 ? 'pendiente' : 'confirmada',
                correo: `guest${number}@example.invalid`,
                telefono: `+569000${String(number).padStart(4, '0')}`,
                documento: `DOC-${number}`,
                fuente: null,
                pais: index === 0 ? 'Chile' : null
            };
        });
        window.haikuSupabase = {
            rpc(name, params) {
                const snapshot = structuredClone(params);
                window.__reservationCalls.push({ name, params: snapshot });
                if (name !== 'haiku_listar_reservas_v1') return Promise.resolve({ data: null, error: new Error('RPC inesperada') });
                let rows = [...window.__reservationRows];
                if (params.p_busqueda) {
                    const needle = params.p_busqueda.toLowerCase();
                    rows = rows.filter(row => [row.nombre, row.apellido, row.cabanas, row.correo, row.telefono, row.documento]
                        .some(value => String(value || '').toLowerCase().includes(needle)));
                }
                if (params.p_estado) rows = rows.filter(row => row.estado === params.p_estado);
                if (params.p_categoria) rows = rows.filter(row => row.categorias.includes(params.p_categoria));
                if (params.p_adultos !== null && params.p_adultos !== undefined) rows = rows.filter(row => row.adultos === params.p_adultos);
                if (params.p_ninos !== null && params.p_ninos !== undefined) rows = rows.filter(row => row.ninos === params.p_ninos);
                if (params.p_checkin_desde) rows = rows.filter(row => row.check_in >= params.p_checkin_desde);
                if (params.p_checkin_hasta) rows = rows.filter(row => row.check_in <= params.p_checkin_hasta);
                const key = params.p_orden || 'fecha_reserva';
                rows.sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) * (params.p_asc ? 1 : -1));
                const total = rows.length;
                const page = rows.slice(params.p_offset || 0, (params.p_offset || 0) + (params.p_limite || 25));
                return Promise.resolve({ data: {
                    total,
                    reservas: page.map(({ codigo_haiku, ...row }) => row),
                    estados_disponibles: ['pendiente', 'confirmada', 'hospedada'],
                    categorias_disponibles: ['Estándar', 'Suite']
                }, error: null });
            },
            from(table) {
                const q = { table, select: '', filter: null };
                const rows = () => {
                    const all = table === 'reservas' ? window.__reservationRows.map(row => ({
                        id: row.reserva_id,
                        codigo_haiku: row.codigo_haiku,
                        titular_nombre: `${row.nombre} ${row.apellido}`
                    })) : [];
                    return q.filter ? all.filter(q.filter) : all;
                };
                const chain = {
                    select(columns) { q.select = columns; return chain; },
                    in(column, values) { q.filter = row => values.includes(row[column]); return chain; },
                    eq(column, value) { q.filter = row => row[column] === value; return chain; },
                    then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); }
                };
                return chain;
            }
        };
    });
}

async function waitForCalls(page, count) {
    await page.waitForFunction(expected => window.__reservationCalls.length >= expected, count);
}

(async () => {
    const browser = await chromium.launch({
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        headless: true
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(`<style>${style}</style><button class="menu-item" data-seccion="reservas">Reservas</button>${section}`);
        assert.equal(await page.locator('.sites-reservas-workspace').isVisible(), true, 'shell visible antes del JS');
        assert.match(await page.locator('#seccion-reservas').innerText(), /Cargando reservas/);
        assert.equal(await page.locator('.reservas-cabecera').count(), 0, 'cabecera legacy ausente');
        assert.equal(await page.locator('.sites-reservas-legacy:visible').count(), 0, 'legacy invisible en first paint');

        await installFakeClient(page);
        await page.addScriptTag({ content: script });
        await page.locator('#reservas-tabla-cuerpo tr').first().waitFor();
        await page.waitForFunction(() => document.querySelector('#reservas-tabla-cuerpo tr')?.textContent.includes('H-COD-1'));
        assert.equal(await page.locator('#reservas-tabla-cuerpo tr').count(), 25);
        assert.match(await page.locator('#reservas-contador').innerText(), /32 reservas/);
        assert.match(await page.locator('#reservas-tabla-cuerpo tr').first().innerText(), /Valentina Araya/);
        assert.match(await page.locator('#reservas-tabla-cuerpo tr').first().innerText(), /H-COD-1/);
        assert.match(await page.locator('#reservas-tabla-cuerpo tr').first().innerText(), /100\.000/);
        assert.match(await page.locator('#reservas-tabla-cuerpo tr').first().innerText(), /120\.000/);
        assert.match(await page.locator('#reservas-tabla-cuerpo tr').first().innerText(), /73\.000/, 'saldo proviene de la RPC, no de una resta');
        assert.match(await page.locator('#reservas-tabla-cuerpo tr').first().innerText(), /3 adultos|3 adulto/);
        assert.match(await page.locator('#reservas-tabla-cuerpo tr').first().innerText(), /1 niñ/);
        const grupo = page.locator('#reservas-tabla-cuerpo tr[data-reserva-id="00000000-0000-4000-8000-000000000002"]');
        assert.match(await grupo.locator('[data-columna="cabin"]').innerText(), /Incluye Full Day/);
        assert.match(await grupo.locator('[data-columna="stay"]').innerText(), /Varias estadías/);
        assert.match(await grupo.locator('[data-columna="pax"]').innerText(), /hasta 4 adultos.*hasta 2 niños por estadía/);
        const firstId = await page.locator('#reservas-tabla-cuerpo tr').first().getAttribute('data-reserva-id');
        assert.equal(firstId, '00000000-0000-4000-8000-000000000001');
        const firstCall = await page.evaluate(() => window.__reservationCalls[0]);
        assert.equal(firstCall.name, 'haiku_listar_reservas_v1');
        assert.equal(firstCall.params.p_limite, 25);
        assert.equal(firstCall.params.p_offset, 0);
        await page.locator('#reservas-tabla-cuerpo tr').first().locator('[data-abrir-reserva]').first().click();
        assert.deepEqual(await page.evaluate(() => window.__openedReservations), [firstId], 'detalle con el ID exacto');

        await page.locator('#reservas-pagina-siguiente').click();
        await waitForCalls(page, 2);
        assert.equal(await page.locator('#reservas-tabla-cuerpo tr').count(), 7);
        assert.equal(await page.evaluate(() => window.__reservationCalls.at(-1).params.p_offset), 25);
        await page.locator('#reservas-pagina-anterior').click();
        await waitForCalls(page, 3);

        await page.locator('#reservas-buscar').fill('Valentina');
        await page.locator('#reservas-buscar').press('Enter');
        await waitForCalls(page, 4);
        assert.equal(await page.locator('#reservas-tabla-cuerpo tr').count(), 1);
        assert.equal(await page.evaluate(() => window.__reservationCalls.at(-1).params.p_busqueda), 'Valentina');
        await page.locator('#reservas-buscar').fill('');
        await page.locator('#reservas-buscar').press('Enter');
        await waitForCalls(page, 5);

        await page.locator('#reservas-abrir-filtros').click();
        await page.locator('[data-filtro-activa="estado"]').check();
        await page.locator('#reservas-filtro-estado').selectOption('pendiente');
        await page.locator('#reservas-aplicar-filtros').click();
        await waitForCalls(page, 6);
        assert.equal(await page.evaluate(() => window.__reservationCalls.at(-1).params.p_estado), 'pendiente');
        assert.match(await page.locator('#reservas-contador').innerText(), /16 reservas/);
        await page.locator('#reservas-abrir-filtros').click();
        await page.locator('#reservas-quitar-filtros').click();
        await waitForCalls(page, 7);

        await page.locator('#reservas-configurar-columnas').click();
        assert.equal(await page.locator('#reservas-panel-columnas').isVisible(), true);
        const visibleBefore = await page.locator('#reservas-tabla-cabecera th').count();
        await page.locator('[data-columna-visible="email"]').check();
        await page.locator('[data-columna-visible="email"]').uncheck();
        const visibleAfter = await page.locator('#reservas-tabla-cabecera th').count();
        assert.ok(visibleAfter <= visibleBefore);
        await page.locator('#reservas-columnas-mostrar-todas').click();
        assert.ok(await page.locator('#reservas-tabla-cabecera th').count() > visibleBefore);
        await page.locator('#reservas-columnas-restablecer').click();
        assert.equal(await page.locator('#reservas-tabla-cabecera th').count(), visibleBefore);
        await page.locator('#reservas-cerrar-columnas').click();

        const orderBefore = await page.evaluate(() => window.__reservationCalls.length);
        await page.locator('[data-reservas-orden="precio_total"]').click();
        await waitForCalls(page, orderBefore + 1);
        assert.equal(await page.evaluate(() => window.__reservationCalls.at(-1).params.p_orden), 'precio_total');

        assert.equal(await page.locator('[data-reservas-seleccionar]').count(), 0, 'sin selección real, no crear estado ficticio');
        const bulk = page.locator('.reservas-accion-masiva');
        if (await bulk.count()) assert.equal(await bulk.isDisabled(), true, 'sin backend masivo, no habilitar');

        await page.addScriptTag({ content: copyScript });
        await page.addScriptTag({ content: copyScript });
        assert.equal(await page.locator('#reservas-copiar-tabla').count(), 1, 'sin botón duplicado');
        assert.equal(await page.locator('#reservas-copiar-tabla').isEnabled(), true);
        const copied = await page.evaluate(() => {
            const drawn = [];
            const prototype = CanvasRenderingContext2D.prototype;
            const original = prototype.fillText;
            prototype.fillText = function (value, ...args) {
                drawn.push(String(value));
                return original.call(this, value, ...args);
            };
            try {
                const canvas = window.HAIKU_RESERVAS_COPIAR_V1.crearImagen();
                return { width: canvas.width, height: canvas.height, drawn: drawn.join(' ') };
            } finally {
                prototype.fillText = original;
            }
        });
        assert.ok(copied.width > 0 && copied.height > 0, 'se genera la imagen desde la tabla visible');
        assert.match(copied.drawn, /Valentina/);
        assert.doesNotMatch(copied.drawn, /guest1@example\.invalid|00000000-0000-4000-8000|Titular 32/,
            'copia sólo columnas visibles y filas de página actual, sin IDs internos');

        const callsBeforeRefresh = await page.evaluate(() => window.__reservationCalls.length);
        await page.addScriptTag({ content: script });
        await page.locator('#reservas-recargar').click();
        await waitForCalls(page, callsBeforeRefresh + 1);
        await page.waitForTimeout(60);
        assert.equal(await page.evaluate(() => window.__reservationCalls.length), callsBeforeRefresh + 1,
            'reinyectar módulo no duplica listeners');
        assert.equal(await page.locator('#reservas-tabla-cuerpo tr').count(), 25);
        assert.deepEqual(errors, []);

        await page.locator('#reservas-configurar-columnas').click();
        await page.locator('[data-columna-visible="email"]').check();
        await page.locator('#reservas-cerrar-columnas').click();

        for (const width of [1600, 1440, 1200, 1100, 390]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `scroll horizontal ${width}`);
            assert.equal(await page.locator('#seccion-reservas').isVisible(), true);
            if (width === 390) {
                assert.equal(await page.locator('.sites-reservas-mobile').isVisible(), true);
                await page.locator('.sites-reservas-mobile [data-abrir-reserva]').first().click();
                assert.equal(await page.evaluate(() => window.__openedReservations.length), 2,
                    'en móvil se conserva el acceso a la misma ficha');
                const mobileCopy = await page.evaluate(() => {
                    const drawn = [];
                    const prototype = CanvasRenderingContext2D.prototype;
                    const original = prototype.fillText;
                    prototype.fillText = function (value, ...args) {
                        drawn.push(String(value));
                        return original.call(this, value, ...args);
                    };
                    try {
                        window.HAIKU_RESERVAS_COPIAR_V1.crearImagen();
                        return drawn.join(' ');
                    } finally {
                        prototype.fillText = original;
                    }
                });
                assert.match(mobileCopy, /Titular/);
                assert.doesNotMatch(mobileCopy, /guest\d+@example\.invalid|00000000-0000-4000-8000/,
                    'la copia móvil excluye columnas opcionales que sólo tiene la tabla de escritorio');
            }
        }

        await page.evaluate(async () => {
            const rpcOriginal = window.haikuSupabase.rpc;
            window.haikuSupabase.rpc = () => new Promise(resolve => { window.__resolverRpcTardia = resolve; });
            const carga = window.HAIKU_RESERVAS_V1.recargar();
            window.haikuSesion = null;
            window.haikuTienePermiso = () => false;
            window.__resolverRpcTardia({ data: { total: 1, reservas: [window.__reservationRows[0]] }, error: null });
            await carga;
            window.haikuSupabase.rpc = rpcOriginal;
        });
        assert.equal(await page.locator('#reservas-tabla-cuerpo tr').count(), 0,
            'una respuesta tardía no repinta datos después de perder la sesión');
        await page.evaluate(() => {
            window.haikuSesion = { usuario: { id: 'usuario-prueba' } };
            window.haikuTienePermiso = permiso => ['reservas.ver', 'pagos.ver'].includes(permiso);
        });

        await page.evaluate(() => { window.__reservationRows = []; });
        await page.locator('#reservas-recargar').click();
        await page.waitForFunction(() => document.querySelectorAll('#reservas-tabla-cuerpo tr').length === 0);
        assert.match(await page.locator('#reservas-vacio').innerText(), /No se encontraron|No hay/);
        assert.match(await page.locator('#reservas-contador').innerText(), /0 reservas/);
        await page.close();
        console.log('PASS Sites Reservas browser: RPC real simulada, finanzas canónicas, filtros, paginación, columnas, detalle, copia, refresh, empty y 5 anchos.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
