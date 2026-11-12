// Verificación del panel real con un turno sintético y sin red externa.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { chromium } = require('playwright');
const { prepararCierre } = require('./fixtures/cierre.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const salida = process.env.HAIKU_CIERRE_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-cierre-'));
const origen = 'https://cierre.test';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NgYGD4DwABBAEAXwNrrQAAAABJRU5ErkJggg==', 'base64');

async function htmlDelPanel() {
    let html;
    const document = {
        createElement: () => ({}), head: { appendChild: script => script.onload() },
        open() {}, write: contenido => { html = contenido; }, close() {}
    };
    await vm.runInNewContext(read('panel.html').match(/<script>([\s\S]*?)<\/script>/)[1], {
        document, window: { supabase: { createClient() {} } },
        fetch: async () => ({ ok: true, text: async () => read('index.html') }),
        Date, console, URLSearchParams, location: { search: '' }
    });
    return html.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/class="haiku-privacidad-arranque[^"]*"/, '');
}

async function montar(page, html, tema) {
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origen) return route.abort();
        if (url.pathname === '/panel.html') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname.startsWith('/adjunto-')) return route.fulfill({ contentType: 'image/png', body: png });
        const archivo = path.resolve(root, '.' + url.pathname);
        if (archivo.startsWith(root + path.sep) && fs.existsSync(archivo) && fs.statSync(archivo).isFile()) {
            return route.fulfill({ path: archivo });
        }
        return route.abort();
    });
    await page.goto(origen + '/panel.html');
    await page.evaluate(tema => {
        document.documentElement.dataset.haikuTema = tema;
        const navegar = id => {
            document.querySelectorAll('.seccion-app').forEach(e => e.classList.toggle('activa', e.id === 'seccion-' + id));
            document.querySelectorAll('.menu-item[data-seccion]').forEach(e => e.classList.toggle('activo', e.dataset.seccion === id));
        };
        document.querySelectorAll('.menu-item[data-seccion]').forEach(e => e.addEventListener('click', () => navegar(e.dataset.seccion)));
        navegar('cierre');
    }, tema);
    await prepararCierre(page);
}

async function abrir(panel) {
    if (!(await panel.evaluate(el => el.open))) {
        await panel.locator(':scope > summary').click();
    }
}

async function esperarEstado(page, texto) {
    await page.waitForFunction(texto => document.getElementById('sites-cierre-estado').textContent === texto, texto);
}

async function comprobarFlujo(page) {
    const recepcion = page.locator('[data-turno-grupo="recepcion"]');
    const caja = page.locator('[data-turno-grupo="caja"]');
    const cabanas = page.locator('#sites-cierre-cabanas');
    const entrega = page.locator('#sites-cierre-entrega');

    await esperarEstado(page, 'En revisión');
    assert.equal(await page.locator('#cierre-porcentaje').textContent(), '93%');
    assert.equal(await page.locator('#sites-cierre-resumen').textContent(), '28/30 controles · 2 pendientes');
    await page.locator('#sites-cierre-ir-entrega').click();
    assert.equal(await entrega.evaluate(el => el === document.activeElement), true);

    const llaves = page.locator('[data-turno-grupo="llaves"]');
    assert.equal(await recepcion.locator('[data-cierre-llave]').count(), 0);
    await abrir(llaves);
    await page.locator('[data-cierre-llave="tonel"]').check();
    await page.locator('[data-cierre-llave="jacuzzi"]').check();
    await page.waitForFunction(() => __cierre.llamadas.filter(c => c.args.p_codigo === 'llaves_recepcion').length === 2);
    assert.match(await llaves.locator('.turno-count').textContent(), /2\/11 devueltas/);
    assert.deepEqual(await page.evaluate(() =>
        __cierre.llamadas.filter(c => c.args.p_codigo === 'llaves_recepcion').map(c => c.args.p_valor)
    ), [{ tonel: true }, { jacuzzi: true }]);
    assert.equal(await page.locator('#cierre-porcentaje').textContent(), '93%');

    await abrir(caja);
    const respaldoGuardado = caja.locator('[data-evidencia="manager-caja"]');
    await respaldoGuardado.getByText('1 adjunto', { exact: true }).waitFor();
    assert.equal(await caja.locator('[data-cierre-campo="manager-caja"]').isChecked(), false);
    await respaldoGuardado.getByRole('button', { name: 'Ver respaldo' }).click();
    assert.equal(await respaldoGuardado.locator('a').getAttribute('href'), 'https://cierre.test/adjunto-caja-guardado.png');
    await page.evaluate(() => { __cierre.permitir = false; HAIKU_SITES_CIERRE_V1.actualizar(); });
    assert.equal(await caja.locator('[data-cierre-campo="manager-caja"]').isDisabled(), true);
    assert.equal(await caja.locator('[data-turno-no-aplica]:visible').count(), 3);
    await page.evaluate(() => { __cierre.permitir = true; HAIKU_SITES_CIERRE_V1.actualizar(); });
    await caja.locator('[data-cierre-campo="manager-caja"]').check();
    await page.waitForFunction(() => __cierre.llamadas.some(c => c.args.p_codigo === 'manager_caja' && c.args.p_valor === true));

    await abrir(cabanas);
    await cabanas.locator('[data-sites-cierre-filter="observaciones"]').click();
    assert.equal(await cabanas.locator('.turno-cabin:visible').count(), 1);
    assert.equal(await cabanas.locator('.turno-cabin:visible').getAttribute('data-sites-cierre-cabin'), '2');
    await cabanas.locator('[data-sites-cierre-filter="todas"]').click();
    const primera = cabanas.locator('[data-sites-cierre-cabin="1"]');
    assert.match(await primera.locator('summary').textContent(), /Operación · Lista.*Por revisar/);
    await abrir(primera);
    await primera.locator('[data-item="gas"]').check();
    assert.equal(await primera.locator('.turno-cabin-count').textContent(), '1/7');
    await primera.getByRole('button', { name: 'Abrir ficha operativa' }).click();
    assert.deepEqual(await page.evaluate(() => __cierre.abiertas), [1]);
    await page.locator('#sites-cierre-volver').click();
    await primera.locator('[data-cierre-cabana-ocupada="1"]').check();
    assert.equal(await primera.locator('.turno-badge').textContent(), 'Ocupada');
    assert.equal(await primera.locator('.turno-cabin-checks').isHidden(), true);
    await cabanas.locator('[data-sites-cierre-filter="completas"]').click();
    assert.equal(await cabanas.locator('.turno-cabin:visible').count(), 1);

    await recepcion.locator('[data-cierre-campo="registro-guardado"]').check();
    const respaldo = recepcion.locator('[data-evidencia="registro"]');
    await respaldo.locator('[data-evidencia-input]').setInputFiles({ name: 'registro.png', mimeType: 'image/png', buffer: png });
    await respaldo.getByText('1 adjunto', { exact: true }).waitFor();
    assert.equal(await respaldo.locator('.turno-evidence-preview img').isVisible(), true);
    await respaldo.getByRole('button', { name: 'Ocultar respaldo' }).click();
    assert.equal(await respaldo.locator('.turno-evidence-preview').isHidden(), true);
    await respaldo.locator('[data-evidencia-pegar]').evaluate((button, contenido) => {
        const datos = new DataTransfer();
        datos.items.add(new File([Uint8Array.from(contenido)], 'pegado.png', { type: 'image/png' }));
        button.dispatchEvent(new ClipboardEvent('paste', { clipboardData: datos, bubbles: true, cancelable: true }));
    }, [...png]);
    await respaldo.getByText('2 adjuntos', { exact: true }).waitFor();
    assert.equal(await respaldo.locator('a[target="_blank"]').count(), 2);

    const cerrar = page.locator('[data-cierre-final-cerrar]');
    await cerrar.click();
    await page.waitForFunction(() => __cierre.avisos.some(a => a.includes('resumen de entrega')));
    assert.equal(await page.evaluate(() => __cierre.llamadas.some(c => c.nombre === 'haiku_cerrar_turno_personificado_v1')), false);
    await page.locator('#cierre-final-resumen').fill('Trasladar los pendientes a la mañana');
    await page.evaluate(() => { __cierre.confirmar = false; });
    await cerrar.click();
    await page.waitForFunction(() => __cierre.confirmaciones.length === 1);
    assert.equal(await page.evaluate(() => __cierre.llamadas.some(c => c.nombre === 'haiku_cerrar_turno_personificado_v1')), false);

    await entrega.locator('[name="hay-novedades"][value="si"]').check();
    const notas = entrega.locator('[data-cierre-campo="novedades"]');
    await notas.fill('Novedad registrada antes de cerrar');
    await page.evaluate(() => { __cierre.confirmar = true; });
    await cerrar.click();
    await esperarEstado(page, 'Cerrado con pendientes');
    assert.equal(await recepcion.locator('[data-cierre-campo="registro-guardado"]').isDisabled(), true);
    assert.equal(await respaldo.getByRole('button', { name: 'Adjuntar imagen' }).isDisabled(), true);
    assert.equal(await page.locator('[data-cierre-final-info]').getByText('Trasladar los pendientes a la mañana').isVisible(), true);
    assert.equal(await page.evaluate(() => {
        const guardado = __cierre.llamadas.findIndex(c => c.nombre === 'haiku_guardar_novedades_cierre');
        const cierre = __cierre.llamadas.findIndex(c => c.nombre === 'haiku_cerrar_turno_personificado_v1');
        return guardado >= 0 && guardado < cierre && __cierre.remoto['2026-11-12'].novedades === 'Novedad registrada antes de cerrar';
    }), true);

    await page.evaluate(async () => {
        fechaSeleccionada = '2026-11-11';
        cargarCierreDia(fechaSeleccionada);
        await Promise.all([haikuCargarCierreSupabase(fechaSeleccionada), haikuRefrescarEstadoCierre()]);
    });
    assert.equal(await page.locator('#sites-cierre-fecha').textContent(), 'miércoles, 11 de noviembre de 2026');
    assert.equal(await page.locator('[name="salida-temprana"][value="no-hay"]').isChecked(), true);
    assert.equal(await page.locator('[data-cierre-final-info]').getByText('Entrega de ayer').isVisible(), true);
    assert.equal(await notas.inputValue(), 'Novedad de ayer');
    assert.equal(await respaldo.isHidden(), true);
    assert.equal(await cabanas.locator('[data-sites-cierre-cabin="12"] .turno-badge').textContent(), 'No requiere');

    await page.evaluate(async () => {
        window.haikuSesion = { permisos: [], roles: [] };
        await haikuRefrescarEstadoCierre();
    });
    assert.equal(await page.locator('[data-cierre-final-reabrir]').isHidden(), true);
    await page.evaluate(async () => {
        window.haikuSesion.permisos = ['cierres.reabrir'];
        await haikuRefrescarEstadoCierre();
    });
    await page.locator('[data-cierre-final-reabrir]').click();
    await esperarEstado(page, 'Reabierto');
    assert.equal(await page.locator('[name="salida-temprana"][value="no-hay"]').isDisabled(), false);
    assert.equal(await page.evaluate(() => __cierre.llamadas.some(c => c.nombre === 'haiku_reabrir_cierre_dia' &&
        c.args.p_fecha === '2026-11-11' && c.args.p_motivo === 'Corrección de prueba')), true);

    await page.evaluate(async () => {
        fechaSeleccionada = '2026-11-13';
        cargarCierreDia(fechaSeleccionada);
        await Promise.all([haikuCargarCierreSupabase(fechaSeleccionada), haikuRefrescarEstadoCierre()]);
    });
    assert.equal(await page.locator('[name="salida-temprana"]:checked').count(), 0);
    assert.equal(await notas.inputValue(), '');
    assert.equal(await page.locator('#cierre-final-resumen').inputValue(), '');
    await page.evaluate(async () => {
        __cierre.remoto[fechaSeleccionada].pendientes = 0;
        await haikuRefrescarEstadoCierre();
    });
    await esperarEstado(page, 'Listo para cerrar');
    await cerrar.click();
    await esperarEstado(page, 'Cerrado');
    assert.equal(await page.evaluate(() => __cierre.llamadas.some(c => c.nombre === 'haiku_cerrar_turno_personificado_v1' &&
        c.args.p_fecha === '2026-11-13' && c.args.p_resumen_entrega === null)), true);
}

async function comprobarPersonificar(page, width, tema) {
    const editor = page.locator('.turno-editor');
    const acceso = page.locator('#sites-cierre-personificar');
    const elegir = async id => {
        if (width < 650) await editor.getByRole('combobox', { name: 'Sección para editar' }).selectOption(id);
        else await editor.locator(`[data-zona="${id}"]`).click();
    };
    await page.evaluate(() => {
        __cierre.permitirEditor = false;
        window.dispatchEvent(new Event('haiku:auth-ready'));
    });
    assert.equal(await acceso.isHidden(), true);
    await page.evaluate(() => {
        __cierre.permitirEditor = true;
        window.dispatchEvent(new Event('haiku:auth-ready'));
    });
    await acceso.click();
    await editor.getByRole('textbox', { name: 'Título de la pantalla' }).fill('Cierre de recepción');
    await elegir('llaves');
    assert.equal(await editor.getByRole('textbox', { name: 'Nombre de la llave' }).count(), 11);
    await editor.getByRole('button', { name: '+ Llave' }).click();
    await editor.getByRole('textbox', { name: 'Nombre de la llave' }).last().fill('Bodega del turno');
    await editor.getByRole('textbox', { name: 'Detalle de la llave' }).last().fill('Gris');
    await editor.locator('[data-item^="llave_"]').getByRole('button', { name: 'Subir elemento' }).click();
    assert.equal(await editor.getByRole('textbox', { name: 'Nombre de la llave' }).nth(10).inputValue(), 'Bodega del turno');
    await editor.locator('[data-item="tonel"]').getByRole('button', { name: 'Ocultar' }).click();
    await editor.screenshot({ path: path.join(salida, `personificar-${width}-${tema}.png`) });
    assert.equal(await editor.evaluate(el => el.scrollWidth <= el.clientWidth), true);

    const agregar = width < 650 ? editor.locator('.turno-editor-select [data-accion="agregar-seccion"]')
        : editor.locator('nav [data-accion="agregar-seccion"]');
    await agregar.click();
    await editor.getByRole('textbox', { name: 'Nombre de la sección' }).fill('Áreas comunes');
    await editor.getByRole('button', { name: '+ Control' }).click();
    await editor.getByRole('textbox', { name: 'Texto del control' }).fill('Cerrar portón');
    await elegir('entrega');
    await editor.getByRole('textbox', { name: 'Campo del resumen' }).fill('Entrega a recepción');
    await elegir('cabanas');
    await editor.getByRole('button', { name: '+ Control' }).click();
    await editor.getByRole('textbox', { name: 'Texto del control' }).last().fill('Revisar terraza');

    await editor.getByRole('button', { name: 'Guardar plantilla' }).click();
    await editor.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'Cierre de recepción' }).waitFor();
    const llaves = page.locator('[data-turno-grupo="llaves"]');
    await abrir(llaves);
    assert.equal(await llaves.locator('[data-cierre-llave="tonel"]').count(), 0);
    await llaves.getByRole('checkbox', { name: 'Bodega del turno Gris' }).check();
    const areas = page.locator('[data-turno-grupo^="seccion_"]');
    await abrir(areas);
    await areas.getByRole('checkbox', { name: 'Cerrar portón' }).check();
    await page.waitForFunction(() => __cierre.llamadas.some(c => c.args.p_codigo?.startsWith('tarea_') && c.args.p_version === 2));
    assert.equal(await page.locator('[data-cierre-final-resumen-wrap] > span').textContent(), 'Entrega a recepción');
    await page.evaluate(async () => {
        fechaSeleccionada = '2026-11-11';
        cargarCierreDia(fechaSeleccionada);
        await Promise.all([haikuCargarCierreSupabase(fechaSeleccionada), haikuRefrescarEstadoCierre()]);
    });
    await page.getByRole('heading', { name: 'Cierre de turno' }).waitFor();
    assert.equal(await page.locator('[data-turno-grupo="llaves"] [data-cierre-llave="tonel"]').count(), 1);
    assert.equal(await page.locator('[data-turno-grupo^="seccion_"]').count(), 0);
}

(async () => {
    fs.mkdirSync(salida, { recursive: true });
    const html = await htmlDelPanel();
    const browser = await chromium.launch({ headless: true, executablePath: process.env.HAIKU_BROWSER_PATH });
    try {
        for (const width of [1440, 390, 320]) {
            for (const tema of ['claro', 'oscuro']) {
                const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: 'America/Santiago' });
                page.setDefaultTimeout(6000);
                const errores = [];
                page.on('pageerror', error => errores.push(error.message));
                await montar(page, html, tema);
                await esperarEstado(page, 'En revisión');
                const root = page.locator('#seccion-cierre');
                assert.equal(await root.locator('.turno-cabin').count(), 11);
                assert.doesNotMatch(await root.innerText(), /manager|cloudbeds|impresi[oó]n/i);
                assert.equal(await root.locator('.turno-layout').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length),
                    width > 1000 ? 2 : 1);
                const colores = await root.locator('.turno-panel').first().evaluate(el => {
                    const s = getComputedStyle(el);
                    return [s.backgroundColor, s.color];
                });
                assert.deepEqual(colores, tema === 'oscuro'
                    ? ['rgb(27, 38, 33)', 'rgb(232, 239, 234)']
                    : ['rgb(251, 252, 251)', 'rgb(23, 32, 25)']);
                await abrir(root.locator('[data-turno-grupo="caja"]'));
                assert.equal(await root.evaluate(el => el.scrollWidth <= el.clientWidth), true);
                await page.evaluate(() => window.scrollTo(0, 0));
                await page.screenshot({ path: path.join(salida, `cierre-${width}-${tema}.png`), fullPage: true });
                if (width === 1440) {
                    await page.evaluate(() => document.body.classList.add('haiku-panel-abierto'));
                    assert.equal(await root.locator('.turno-layout').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
                    assert.equal(await root.evaluate(el => el.scrollWidth <= el.clientWidth), true);
                    await page.evaluate(() => document.body.classList.remove('haiku-panel-abierto'));
                    if (tema === 'claro') await comprobarFlujo(page);
                } else {
                    await abrir(root.locator('#sites-cierre-cabanas'));
                    await abrir(root.locator('[data-sites-cierre-cabin="1"]'));
                    await abrir(root.locator('[data-turno-grupo="instalaciones"]'));
                    await abrir(root.locator('[data-turno-grupo="llaves"]'));
                    assert.equal(await root.locator('.turno-cabin-checks').first().evaluate(el =>
                        getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
                    assert.equal(await root.evaluate(el => el.scrollWidth <= el.clientWidth), true);
                }
                if ((width === 1440 && tema === 'oscuro') || width === 390) {
                    await comprobarPersonificar(page, width, tema);
                }
                assert.deepEqual(errores, []);
                await page.close();
                console.log(`Cierre ${width}px · ${tema} OK`);
            }
        }
        console.log(salida);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
