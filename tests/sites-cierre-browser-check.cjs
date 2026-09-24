// Comprobación local opcional con Edge; no forma parte de la suite portable.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
    const root = path.resolve(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const start = html.indexOf('<section id="seccion-cierre"');
    const end = html.indexOf('<section id="seccion-pagos"', start);
    const section = html.slice(start, end).replace('sites-cierre-pending"', 'sites-cierre-pending activa"');
    const baseStyle = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
    const closingFinalStyle = fs.readFileSync(path.join(root, 'css/supabase-cierre-final-v1.css'), 'utf8');
    const closingLegacyStyle = fs.readFileSync(path.join(root, 'css/supabase-cierre-modern-v1.css'), 'utf8');
    const style = fs.readFileSync(path.join(root, 'css/sites-cierre-v1.css'), 'utf8');
    const script = fs.readFileSync(path.join(root, 'js/sites-cierre-v1.js'), 'utf8');
    const closingScript = fs.readFileSync(path.join(root, 'js/cierre.js'), 'utf8');
    const evidenceHandlers = closingScript.slice(closingScript.indexOf('const checksEvidencia ='),
        closingScript.indexOf('// ACTUALIZAR PROGRESO DEL CIERRE', closingScript.indexOf('const checksEvidencia =')));
    const evidenceToggle = closingScript.slice(closingScript.indexOf('function prepararToggleEvidencia(preview)'));
    const radioHandler = closingScript.slice(closingScript.indexOf('function guardarRadioCierre(nombre, campo)'),
        closingScript.indexOf('function guardarCheckCierre(elemento, campo)'));
    const noveltyHandler = closingScript.slice(closingScript.indexOf('if (novedadesInput) {'),
        closingScript.indexOf('// ACTIVAR GUARDADO ETAPA 3', closingScript.indexOf('if (novedadesInput) {')));
    const finalScript = fs.readFileSync(path.join(root, 'js/supabase-cierre-final-v1.js'), 'utf8');
    const browser = await chromium.launch({
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        headless: true
    });
    try {
        for (const width of [1600, 1440, 1200, 1100, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setContent(`<style>${baseStyle}\n${closingFinalStyle}\n${closingLegacyStyle}\n${style}</style><button class="menu-item" data-seccion="cabanas">Cabañas</button><button class="menu-item" data-seccion="cierre">Cierre</button><div id="cabinsDetail"></div>${section}`);
            const before = await page.locator('.sites-cierre-legacy').evaluate(el => getComputedStyle(el).display);
            assert.equal(before, 'none', `legacy visible antes de JS a ${width}px`);
            await page.evaluate(() => {
                window.fechaSeleccionada = '2026-09-24';
                window.obtenerDatosDia = () => ({ cabanas: Object.fromEntries(
                    Array.from({ length: 11 }, (_, i) => [String(i + 1), { estadoRevision: i === 0 ? 'lista' : 'pendiente' }])
                ) });
                window.__openedCabins = [];
                window.HAIKU_CABANAS_SITES_V1 = { estadoFinal: dato => dato.estadoRevision,
                    abrir(n) { window.__openedCabins.push(n); }, cerrar() { window.__closedCabin = true; } };
                window.__cierreModel = { detallesCabanas: '', pendientesHacer: '', hayNovedades: '', novedades: '' };
                window.__closingWrites = 0;
                window.obtenerCierreDia = () => window.__cierreModel;
                window.guardarDatos = () => { window.__closingWrites++; };
                window.actualizarCierreTurno = () => {};
                window.cargarCierreDia = () => {
                    for (const [name, field] of [['detalles-cabanas', 'detallesCabanas'],
                        ['pendientes-hacer', 'pendientesHacer'], ['hay-novedades', 'hayNovedades']]) {
                        document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
                            input.checked = input.value === window.__cierreModel[field];
                        });
                    }
                    document.querySelector('textarea[data-cierre-campo="novedades"]').value = window.__cierreModel.novedades;
                };
                window.__evidenceRows = {};
                window.guardarEvidencia = async (fecha, key) => {
                    const list = window.__evidenceRows[key] ||= [];
                    list.unshift({ url: `https://evidence.invalid/${key}/${list.length + 1}.png` });
                };
                window.HAIKU_CIERRE_EVIDENCIAS_V1 = { listar: async (fecha, key) => window.__evidenceRows[key] || [] };
            });
            await page.addScriptTag({ content: evidenceToggle });
            await page.addScriptTag({ content: evidenceHandlers });
            await page.addScriptTag({ content: radioHandler + '\n' +
                'guardarRadioCierre("detalles-cabanas", "detallesCabanas");\n' +
                'guardarRadioCierre("pendientes-hacer", "pendientesHacer");\n' +
                'guardarRadioCierre("hay-novedades", "hayNovedades");\n' +
                'const novedadesInput = document.querySelector("[data-cierre-campo=novedades]");\n' + noveltyHandler });
            await page.addScriptTag({ content: script });
            assert.deepEqual(errors, [], `errores JS a ${width}px`);
            assert.equal(await page.locator('.sites-cierre-stage').count(), 4);
            assert.equal(await page.locator('.sites-cierre-cabin').count(), 11);
            assert.equal(await page.locator('.sites-cierre-stage-body:not([hidden])').count(), 1);
            const pendingStage = page.locator('.sites-cierre-stage').nth(1);
            await pendingStage.locator('.sites-cierre-stage-head').click();
            assert.equal(await pendingStage.locator('.sites-cierre-pending-item').count(), 3);
            assert.equal(await pendingStage.locator('.sites-cierre-pending-body:not([hidden])').count(), 3);
            assert.equal(await pendingStage.locator('.sites-cierre-stage-count').textContent(), '0/3 revisados');
            assert.deepEqual(await pendingStage.locator('.sites-cierre-pending-count').allTextContents(),
                ['0/1 revisados', '0/1 revisados', '0/1 revisados']);
            assert.equal(await pendingStage.locator('[data-sites-pending="hay-novedades"] .sites-cierre-pending-field').isHidden(), true);
            const columns = await pendingStage.locator('.sites-cierre-pending-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
            assert.equal(columns, width >= 1200 ? 3 : width > 740 ? 2 : 1, `columnas de Pendientes a ${width}px`);
            if (width === 1600) await page.evaluate(() => window.dispatchEvent(new CustomEvent('haiku:cierre-estado-actualizado', {
                detail: { pendientes: 3, completados: 27, total_requeridos: 30, porcentaje: 90, cierre_estado: 'borrador' }
            })));
            await pendingStage.locator('input[name="detalles-cabanas"][value="si"]').check();
            assert.equal(await pendingStage.locator('.sites-cierre-stage-count').textContent(), '1/3 revisados');
            assert.equal(await page.evaluate(() => window.__cierreModel.detallesCabanas), 'si');
            await pendingStage.locator('input[name="detalles-cabanas"][value="pendientes"]').check();
            assert.equal(await pendingStage.locator('.sites-cierre-stage-count').textContent(), '1/3 revisados');
            assert.equal(await page.evaluate(() => window.__cierreModel.detallesCabanas), 'pendientes');
            await pendingStage.locator('input[name="pendientes-hacer"][value="no"]').check();
            assert.equal(await pendingStage.locator('.sites-cierre-stage-count').textContent(), '2/3 revisados');
            await pendingStage.locator('input[name="pendientes-hacer"][value="si"]').check();
            assert.equal(await page.evaluate(() => window.__cierreModel.pendientesHacer), 'si');
            await pendingStage.locator('input[name="pendientes-hacer"][value="no"]').check();
            await pendingStage.locator('input[name="hay-novedades"][value="si"]').check();
            assert.equal(await pendingStage.locator('.sites-cierre-pending-field').isVisible(), true);
            await pendingStage.locator('textarea[data-cierre-campo="novedades"]').fill('Novedad real del turno');
            assert.equal(await page.evaluate(() => window.__cierreModel.novedades), 'Novedad real del turno');
            assert.equal(await pendingStage.locator('.sites-cierre-stage-count').textContent(), '3/3 revisados');
            assert.deepEqual(await pendingStage.locator('.sites-cierre-pending-count').allTextContents(),
                ['1/1 revisados', '1/1 revisados', '1/1 revisados']);
            if (width === 1600) {
                assert.equal(await page.locator('#cierre-porcentaje').textContent(), '100%');
                assert.equal(await page.locator('#sites-cierre-pendientes').textContent(), '0');
            }
            await pendingStage.locator('input[name="hay-novedades"][value="no"]').check();
            assert.equal(await pendingStage.locator('.sites-cierre-pending-field').isHidden(), true);
            assert.equal(await page.evaluate(() => window.__cierreModel.hayNovedades), 'no');
            await page.evaluate(() => {
                document.querySelectorAll('input[name="detalles-cabanas"],input[name="pendientes-hacer"],input[name="hay-novedades"]')
                    .forEach(input => { input.checked = false; });
                document.querySelector('textarea[data-cierre-campo="novedades"]').value = '';
                window.cargarCierreDia('2026-09-24');
            });
            assert.equal(await pendingStage.locator('input[name="detalles-cabanas"][value="pendientes"]').isChecked(), true);
            assert.equal(await pendingStage.locator('input[name="pendientes-hacer"][value="no"]').isChecked(), true);
            assert.equal(await pendingStage.locator('input[name="hay-novedades"][value="no"]').isChecked(), true);
            assert.equal(await pendingStage.locator('textarea[data-cierre-campo="novedades"]').inputValue(), 'Novedad real del turno');
            assert.equal(await pendingStage.locator('.sites-cierre-pending-field').isHidden(), true);
            await pendingStage.locator('.sites-cierre-pending-head').first().click();
            assert.equal(await pendingStage.locator('.sites-cierre-pending-body').first().isHidden(), true);
            await pendingStage.locator('.sites-cierre-pending-head').first().click();
            assert.equal(await pendingStage.locator('.sites-cierre-pending-body').first().isVisible(), true);
            const stageOne = page.locator('.sites-cierre-stage').first();
            await stageOne.locator('input[name="salida-temprana"][value="si"]').check();
            assert.equal(await stageOne.locator('.sites-cierre-stage-count').textContent(), '1/19 revisados');
            await stageOne.locator('.cierre-llaves-recepcion .sites-cierre-sub-head').click();
            await stageOne.locator('input[data-cierre-llave="tonel"]').check();
            assert.match(await stageOne.locator('.cierre-llaves-recepcion .sites-cierre-sub-count').textContent(), /1\/11 devueltas/);
            await page.locator('.sites-cierre-stage-head').nth(2).click();
            await page.locator('input[data-cierre-campo="tinaja-tonel-apagado"]').check();
            assert.equal(await page.locator('.sites-cierre-stage').nth(2).locator('.sites-cierre-stage-count').textContent(), '1/5 revisados');
            await page.locator('.sites-cierre-stage-head').nth(3).click();
            await page.locator('[data-sites-cierre-filter="completas"]').click();
            assert.equal(await page.locator('.sites-cierre-cabin:visible').count(), 1);
            await page.locator('.sites-cierre-cabin .sites-cierre-cabin-open').first().click();
            assert.deepEqual(await page.evaluate(() => window.__openedCabins), [1]);
            assert.equal(await page.locator('#sites-cierre-volver').isVisible(), true);
            await page.locator('#sites-cierre-volver').click();
            assert.equal(await page.evaluate(() => window.__closedCabin), true);
            assert.equal(await page.locator('#sites-cierre-volver').isVisible(), false);
            await page.evaluate(() => window.dispatchEvent(new CustomEvent('haiku:cierre-estado-actualizado', {
                detail: { pendientes: 2, total_requeridos: 30, porcentaje: 93, cierre_estado: 'borrador' }
            })));
            assert.equal(await page.locator('#sites-cierre-pendientes').textContent(), '2');
            assert.equal(await page.locator('#cierre-porcentaje').textContent(), '93%');
            await page.locator('.sites-cierre-cabin').first().locator('.sites-cierre-cabin-head button').first().click();
            await page.locator('input[data-cierre-cabana="1"][data-item="perillas"]').check();
            assert.equal(await page.locator('.sites-cierre-cabin').first().locator('.sites-cierre-cabin-fraction').textContent(), '1/7 checks');
            await page.evaluate(() => window.cargarCierreDia());
            assert.equal(await page.locator('.sites-cierre-stage').count(), 4);
            assert.equal(await page.locator('[data-evidencia-zona]').count(), 0);
            assert.equal(await page.locator('.sites-cierre-evidence-status').count(), 5);
            assert.equal(await page.locator('.sites-cierre-evidence-status').first().textContent(), 'Sin adjuntos');
            assert.equal(await page.locator('[data-evidencia="registro"] .cierre-evidencia-toggle').isHidden(), true);
            if (width === 1600 || width === 390) {
                const record = page.locator('[data-evidencia="registro"]');
                await page.locator('.cierre-bloque:has([data-evidencia="registro"]) .sites-cierre-sub-head').click();
                await page.locator('[data-evidencia-check="registro"]').check();
                assert.equal(await record.locator('.sites-cierre-evidence-status').textContent(), 'Sin adjuntos');
                assert.ok((await record.boundingBox()).height < 115, `franja vacía demasiado alta a ${width}px`);
                await record.locator('[data-evidencia-pegar="registro"]').click();
                assert.equal(await record.locator('[data-evidencia-pegar="registro"]').evaluate(el => document.activeElement === el), true);
                await record.locator('[data-evidencia-input="registro"]').setInputFiles({
                    name: 'primera.png', mimeType: 'image/png',
                    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aP8AAAAASUVORK5CYII=', 'base64')
                });
                await record.locator('.sites-cierre-evidence-status').getByText('1 adjunto').waitFor();
                assert.equal(await record.locator('.cierre-evidencia-toggle').isVisible(), true);
                assert.equal(await record.locator('.cierre-evidencia-preview img').isVisible(), true);
                assert.equal(await record.locator('.sites-cierre-evidence-links a').count(), 1);
                await record.locator('.cierre-evidencia-toggle').click();
                assert.equal(await record.locator('.cierre-evidencia-preview img').isVisible(), false);
                await page.evaluate(() => {
                    const button = document.querySelector('[data-evidencia-pegar="registro"]');
                    const transfer = new DataTransfer();
                    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'segunda.png', { type: 'image/png' }));
                    button.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
                });
                await record.locator('.sites-cierre-evidence-status').getByText('2 adjuntos').waitFor();
                assert.equal(await record.locator('.sites-cierre-evidence-links a').count(), 2);
                assert.equal(await record.locator('.sites-cierre-evidence-links').isVisible(), true);
                await record.locator('.cierre-evidencia-toggle').click();
                assert.equal(await record.locator('.sites-cierre-evidence-links').isVisible(), false);
                await record.locator('.cierre-evidencia-toggle').click();
                assert.equal(await record.locator('.sites-cierre-evidence-links').isVisible(), true);
                assert.equal(await record.locator('.sites-cierre-evidence-links a').first().getAttribute('target'), '_blank');
                assert.equal(await page.evaluate(() => window.__evidenceRows.registro.length), 2);
            }
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
            assert.equal(overflow, false, `scroll horizontal a ${width}px`);
            if (width === 1600) {
                await page.evaluate(() => {
                    window.__rpcCalls = [];
                    window.__rpcState = { cierre_estado: 'borrador', pendientes: 2,
                        completados: 28, total_requeridos: 30, porcentaje: 93, resumen_entrega: '' };
                    window.haikuSesion = { roles: ['recepcion'] };
                    window.haikuSupabase = { rpc: async (name, args) => {
                        window.__rpcCalls.push({ name, args });
                        if (name === 'haiku_asegurar_cierre_dia') return { data: { cierre_id: 'c1' }, error: null };
                        if (name === 'haiku_estado_cierre_dia') return { data: window.__rpcState, error: null };
                        if (name === 'haiku_cerrar_turno_dia') {
                            window.__rpcState = { ...window.__rpcState, cierre_estado: 'cerrado_con_pendientes' };
                            return { data: window.__rpcState, error: null };
                        }
                        return { data: null, error: new Error('RPC inesperado') };
                    } };
                    window.haikuCargarCierreSupabase = async () => {};
                    window.alert = () => {};
                    window.confirm = () => false;
                });
                await page.addScriptTag({ content: finalScript });
                await page.evaluate(() => window.haikuRefrescarEstadoCierre());
                assert.equal(await page.locator('[data-cierre-final-cerrar]').textContent(), 'Cerrar con pendientes (2)');
                await page.evaluate(async () => {
                    window.__rpcState = { ...window.__rpcState, pendientes: 0, completados: 30, porcentaje: 100 };
                    await window.haikuRefrescarEstadoCierre();
                });
                assert.equal(await page.locator('[data-cierre-final-cerrar]').textContent(), 'Cerrar turno');
                await page.evaluate(async () => {
                    window.__rpcState = { ...window.__rpcState, pendientes: 2, completados: 28, porcentaje: 93 };
                    await window.haikuRefrescarEstadoCierre();
                });
                await page.locator('[data-cierre-final-cerrar]').click();
                assert.equal(await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'haiku_cerrar_turno_dia').length), 0);
                await page.locator('#cierre-final-resumen').fill('Entregar pendientes al siguiente turno');
                await page.locator('[data-cierre-final-cerrar]').click();
                assert.equal(await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'haiku_cerrar_turno_dia').length), 0);
                await page.evaluate(() => { window.confirm = () => true; });
                await page.locator('[data-cierre-final-cerrar]').click();
                assert.equal(await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'haiku_cerrar_turno_dia').length), 1);
                assert.equal(await page.locator('[data-cierre-final-badge]').textContent(), '✓ Cerrado con pendientes');
                assert.equal(await page.locator('input[name="salida-temprana"][value="si"]').isDisabled(), true);
            }
            const screenshot = path.join(process.env.TEMP || root, `sites-cierre-${width}.png`);
            await page.screenshot({ path: screenshot, fullPage: true });
            console.log(`${width}px OK ${screenshot}`);
            await page.close();
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
