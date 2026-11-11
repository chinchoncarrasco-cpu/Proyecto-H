// Recorre la ficha real con un Supabase simulado que separa revisiones y plantillas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const scripts = new Set([
    'js/calendario.js', 'js/historial.js', 'js/app.js', 'js/cabanas.js', 'js/checklist.js',
    'js/checklist-optimista-v1.js', 'js/sites-cabanas-v1.js', 'js/supabase-aseo-revision-v1.js',
    'js/revision-plantilla-core-v1.js', 'js/revision-plantilla-v1.js',
]);
const oldDay = '2026-11-10', newDay = '2026-11-11';

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.HAIKU_BROWSER_PATH || undefined });
    try {
        for (const width of [1440, 390]) for (const theme of ['claro', 'oscuro']) {
            const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: 'America/Santiago' });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(({ oldDay, newDay }) => {
                const qa = window.__templateQA = { version: null, writes: [], publications: [], admin: true, base: [] };
                window.haikuSesion = { auth: { id: 'qa-admin' } };
                window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: 'visible', armado: true }) };
                window.HAIKU_DIALOGOS = { aviso: message => { qa.message = message; } };
                qa.tables = {
                    cabanas: Array.from({ length: 11 }, (_, index) => ({ id: 'cab-' + (index + 1), numero: index + 1, activa: true })),
                    revisiones_cabana: [{ id: 'old', fecha: oldDay, cabana_id: 'cab-1', estado: 'en_proceso',
                        plantilla_id: null, tipo_revision: 'completa', observaciones: 'Observación existente', creado_en: oldDay }],
                    cabana_checklist_config: [],
                    revision_items: [{ revision_id: 'old', checklist_item_id: 'db-0-0-0', estado: 'ok' }],
                };
                window.haikuSupabase = {
                    auth: { getUser: async () => ({ data: { user: { id: 'qa-admin' } }, error: null }) },
                    async rpc(name, args) {
                        if (name === 'haku_revision_plantillas_v1') {
                            const record = qa.tables.revisiones_cabana.find(row => row.cabana_id === 'cab-1' && row.fecha === args.p_fecha);
                            const visible = qa.version && args.p_fecha === newDay && (!args.p_cabana_id || args.p_cabana_id === 'cab-1');
                            return { data: { can_edit: qa.admin, templates: visible ? [{
                                cabana_id: 'cab-1', numero: 1, revision_id: record?.id ?? null, version_id: qa.version, groups: qa.groups,
                            }] : [] }, error: null };
                        }
                        if (name === 'haku_revision_plantilla_editar_v1') return { data: { version_id: qa.version,
                            request_id: 'qa-request', groups: structuredClone(qa.groups ?? qa.base) }, error: null };
                        if (name === 'haku_revision_plantilla_guardar_v1') {
                            qa.publications.push(args);
                            qa.version = args.p_request_id;
                            qa.groups = args.p_groups.map(group => ({ ...group, items: group.items.map(item => ({
                                ...item, itemId: 'db-' + item.id, expected: item.id.startsWith('nuevo-') ? null : 1,
                            })) }));
                            return { data: { version_id: qa.version, author: 'Administrador QA', published_at: newDay + 'T18:00:00Z' }, error: null };
                        }
                        return { data: null, error: { code: 'PGRST202' } };
                    },
                    from(table) {
                        let mutation = null, single = false, limit = Infinity;
                        const filters = [];
                        const chain = {
                            select() { return chain; }, eq(k, v) { filters.push(row => row[k] === v); return chain; },
                            neq(k, v) { filters.push(row => row[k] !== v); return chain; },
                            not(k) { filters.push(row => row[k] != null); return chain; },
                            in(k, v) { filters.push(row => v.includes(row[k])); return chain; },
                            order() { return chain; }, limit(n) { limit = n; return chain; },
                            single() { single = true; return chain; }, maybeSingle() { single = true; return chain; },
                            insert(value) { mutation = ['insert', value]; return chain; },
                            upsert(value) { mutation = ['upsert', value]; return chain; },
                            update(value) { mutation = ['update', value]; return chain; },
                            then(resolve, reject) {
                                try {
                                    const all = qa.tables[table] ?? [];
                                    let rows = all.filter(row => filters.every(filter => filter(row))).slice(0, limit);
                                    if (mutation) {
                                        const [op, value] = mutation;
                                        qa.writes.push({ table, op, value });
                                        if (op === 'insert') {
                                            rows = [{ id: 'new-' + qa.writes.length, creado_en: newDay, ...value,
                                                plantilla_id: value.tipo_revision === 'completa' ? qa.version : null }];
                                            all.push(...rows);
                                        } else if (op === 'update') rows.forEach(row => Object.assign(row, value));
                                        else {
                                            const existing = all.find(row => row.revision_id === value.revision_id && row.checklist_item_id === value.checklist_item_id);
                                            if (existing) Object.assign(existing, value); else all.push(value);
                                            rows = [value];
                                        }
                                    }
                                    resolve({ data: structuredClone(single ? rows[0] ?? null : rows), error: null });
                                } catch (error) { reject(error); }
                            },
                        };
                        return chain;
                    },
                };
            }, { oldDay, newDay });
            await page.route('**/*', route => {
                const url = new URL(route.request().url());
                if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({
                    contentType: 'application/javascript', body: 'window.supabase={createClient:()=>({})}',
                });
                if (url.hostname !== 'haku-personalizar.test') return route.abort();
                const name = decodeURIComponent(url.pathname.slice(1));
                if (name.includes('..')) return route.abort();
                const file = path.join(root, name);
                if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
                if (name.endsWith('.js') && !scripts.has(name)) return route.fulfill({ contentType: 'application/javascript', body: '' });
                const contentType = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(name)];
                return route.fulfill({ path: file, contentType });
            });
            await page.goto('http://haku-personalizar.test/panel.html');
            await page.waitForFunction(() => Boolean(window.HAIKU_REVISION_SUPABASE_V1 && window.HAIKU_CABANAS_SITES_V1));
            await page.evaluate(({ theme, oldDay }) => {
                document.documentElement.dataset.haikuTema = theme;
                fechaSeleccionada = oldDay;
                const qa = window.__templateQA;
                qa.base = checklistsCabanas[1].flatMap((area, index) => {
                    const groups = area.subareas?.map((group, sub) => [index + '-' + sub, group.nombre, group.items]) ?? [[String(index), null, area.items]];
                    return groups.map(([id, label, items]) => ({ id, label, items: items.map((name, itemIndex) => {
                        const key = id + '-' + itemIndex;
                        return { id: key, label: name, active: true, itemId: 'db-' + key, expected: 1 };
                    }) }));
                });
                qa.tables.cabana_checklist_config = qa.base.flatMap(group => group.items.map(item => ({
                    cabana_id: 'cab-1', checklist_item_id: item.itemId, legacy_checklist_id: item.id, cantidad_esperada: 1, activo: true,
                })));
                window.HAIKU_CABANAS_SITES_V1.pintar(oldDay);
            }, { theme, oldDay });
            await page.locator('.menu-item[data-seccion="cabanas"]').click();
            await page.locator('#cabinsOperation [data-cb-open="1"]').click();
            const customize = page.getByRole('button', { name: 'Personalizar', exact: true });
            await customize.waitFor();
            const first = page.locator('#revision-checklist input[data-checklist-id="0-0-0"]');
            assert.equal(await first.isChecked(), true);
            await customize.click();
            const editor = page.locator('#cabinsReviewEditor');
            await editor.getByText('Casillas de vista previa').waitFor();
            assert.equal(await page.locator('#revision-individual').isVisible(), false);
            assert.equal(await page.locator('#revision-individual').evaluate(node => node.inert), true);
            await editor.getByRole('button', { name: 'Bajar Cocina', exact: true }).click();
            await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
            assert.equal(await page.locator('#revision-individual').evaluate(node => node.inert), false);
            assert.equal(await first.isChecked(), true);
            assert.deepEqual(await page.evaluate(() => window.__templateQA.writes), []);
            assert.deepEqual(await page.evaluate(() => window.__templateQA.publications), []);
            await customize.click();
            await editor.getByRole('button', { name: 'Bajar Cocina', exact: true }).click();
            await editor.locator('summary[aria-label="Opciones de Cocina"]').click();
            await editor.getByRole('button', { name: 'Renombrar', exact: true }).click();
            await editor.getByRole('textbox', { name: 'Nombre del elemento' }).fill('Cocina y quemadores');
            await editor.getByRole('button', { name: 'Aceptar' }).click();
            assert.equal(await editor.locator('[data-checklist-id]').count(), 0);
            if (process.env.HAKU_UI_SHOTS) {
                fs.mkdirSync(process.env.HAKU_UI_SHOTS, { recursive: true });
                await page.screenshot({ path: path.join(process.env.HAKU_UI_SHOTS, width + '-' + theme + '-editor.png') });
            }
            await editor.getByRole('button', { name: 'Guardar cambios' }).click();
            const dialog = page.getByRole('dialog', { name: 'Guardar cambios' });
            await dialog.getByText('Cocina y quemadores').waitFor();
            if (process.env.HAKU_UI_SHOTS) await page.screenshot({
                path: path.join(process.env.HAKU_UI_SHOTS, width + '-' + theme + '-confirmar.png'),
            });
            await dialog.getByRole('button', { name: 'Aplicar a Cabaña 1' }).click();
            await page.getByText('Cambios guardados', { exact: true }).waitFor();
            assert.equal(await first.isChecked(), true);
            assert.match(await first.locator('..').textContent(), /^Cocina$/);
            assert.equal(await page.locator('#revision-detalles').inputValue(), 'Observación existente');
            assert.equal(await page.evaluate(() => window.__templateQA.publications.length), 1);
            assert.deepEqual(await page.evaluate(() => window.__templateQA.writes), []);

            await page.evaluate(newDay => {
                fechaSeleccionada = newDay;
                window.HAIKU_CABANAS_SITES_V1.pintar(newDay);
            }, newDay);
            await page.locator('#cabinsOperation [data-cb-open="1"]').click();
            await page.waitForFunction(() => document.querySelector('#revision-checklist').dataset.templateVersion === 'qa-request');
            assert.match(await first.locator('..').textContent(), /Cocina y quemadores/);
            assert.equal(await first.isChecked(), false);
            await first.check();
            await page.waitForFunction(() => window.__templateQA.writes.some(write => write.table === 'revision_items'));
            const write = await page.evaluate(() => window.__templateQA.writes.find(row => row.table === 'revision_items'));
            assert.equal(write.value.checklist_item_id, 'db-0-0-0');
            assert.notEqual(write.value.revision_id, 'old');
            await page.evaluate(() => {
                window.__templateQA.admin = false;
                return window.HAIKU_REVISION_SUPABASE_V1.prepararRevision('1');
            });
            assert.equal(await customize.isVisible(), false);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            assert.deepEqual(errors, []);
            console.log(width + 'px ' + theme + ': cancelar, confirmar, revisión previa y check con identidad estable.');
            await page.close();
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
