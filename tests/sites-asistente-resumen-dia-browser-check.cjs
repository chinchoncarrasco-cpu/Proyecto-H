// Consulta y render reales del resumen; transporte Supabase simulado, sin red externa.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const capturas = path.join(os.tmpdir(), 'haiku-tareas-hoy-ui');
fs.mkdirSync(capturas, { recursive: true });
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/sites-shell-v1.css"><link rel="stylesheet" href="/css/supabase-asistente-v1.css"><link rel="stylesheet" href="/css/sites-asistente-v1.css"></head><body><main style="height:3000px">Página de fondo</main></body></html>');
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try { response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(fs.readFileSync(file)); }
    catch { response.writeHead(404).end(); }
});

async function setup(page) {
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.addInitScript(() => {
        window.haikuSesion = { usuario: { id: 'resumen-test' } };
        window.__lecturas = [];
        window.__escrituras = [];
        window.__datos = { operacion: [], servicios: [], pagos: [], notas: [], estadias: [] };
        const prohibido = nombre => () => {
            window.__escrituras.push(nombre);
            throw new Error(`Escritura inesperada: ${nombre}`);
        };
        window.haikuSupabase = {
            auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
            rpc(nombre, parametros) {
                if (nombre !== 'haiku_operacion_dia') return prohibido(nombre)();
                window.__lecturas.push({ nombre, parametros });
                return Promise.resolve({ data: window.__datos.operacion, error: null });
            },
            from(tabla) {
                const consulta = { nombre: `leer-${tabla}`, filtros: [] };
                const query = {
                    select(columnas) { consulta.columnas = columnas; return query; },
                    eq(campo, valor) { consulta.filtros.push({ campo, valor, tipo: 'eq' }); return query; },
                    in(campo, valor) { consulta.filtros.push({ campo, valor: [...valor], tipo: 'in' }); return query; },
                    order(campo) { consulta.orden = campo; return query; },
                    then(resolve, reject) {
                        window.__lecturas.push(consulta);
                        const filas = tabla === 'cabanas'
                            ? [{ id: 'cab-4', numero: 4, activa: true }, { id: 'cab-7', numero: 7, activa: true }]
                            : tabla === 'notas' ? window.__datos.notas : window.__datos.estadias;
                        const data = filas.filter(fila => consulta.filtros.every(filtro =>
                            filtro.tipo === 'in' ? filtro.valor.includes(fila[filtro.campo]) : fila[filtro.campo] === filtro.valor
                        ));
                        if (consulta.orden) data.sort((a, b) => String(a[consulta.orden]).localeCompare(String(b[consulta.orden])));
                        return Promise.resolve({ data, error: tabla === 'notas' && window.__datos.errorNotas ? { message: 'Fallo controlado' } : null }).then(resolve, reject);
                    }
                };
                for (const metodo of ['insert', 'update', 'upsert', 'delete']) query[metodo] = prohibido(metodo);
                return query;
            }
        };
        window.HAIKU_SERVICIOS_HIDRATACION_V2 = { async sincronizar() { window.__lecturas.push({ nombre: 'hidratar-servicios' }); } };
        window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1 = {
            async refrescar(fecha) { window.__lecturas.push({ nombre: 'refrescar-pagos', fecha }); },
            obtener(fecha) { window.__lecturas.push({ nombre: 'obtener-pagos', fecha }); return window.__datos.pagos; }
        };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    // Carga el puente sin iniciar el refresh/migración propios del tablero Resumen.
    await page.evaluate(() => { window.__sesionPrevia = window.haikuSesion; window.haikuSesion = null; });
    const notas = read('js/supabase-notas-resumen-v1.js');
    await page.addScriptTag({ content: notas.slice(0, notas.indexOf('// Carga desacoplada')) });
    await page.evaluate(() => { window.haikuSesion = window.__sesionPrevia; delete window.__sesionPrevia; });
    await page.addScriptTag({ content: read('js/supabase-asistente-v1.js') });
    await page.addScriptTag({ content: read('js/supabase-asistente-resumen-dia-v1.js') });
    await page.locator('#haiku-asistente-boton').click();
}

async function consultar(page, texto, datos) {
    await page.evaluate(datosActuales => {
        window.__datos = { notas: [], estadias: [], ...datosActuales };
        localStorage.setItem('haikuServicios', JSON.stringify(datosActuales.servicios));
    }, datos);
    const previos = await page.locator('.haku-dia-sites').count();
    await page.locator('#haiku-asistente-texto').fill(texto);
    await page.locator('#haiku-asistente-enviar').click();
    await page.waitForFunction(anterior => document.querySelectorAll('.haku-dia-sites').length > anterior, previos);
    return page.locator('.haku-dia-sites').last();
}

const fila = (numero, tipo) => ({
    numero,
    ...(tipo === 'ingreso' ? { ingreso_estadia_id: `i-${numero}`, ingreso_titular: `Titular ${numero}` } : {}),
    ...(tipo === 'salida' ? { salida_estadia_id: `s-${numero}`, salida_titular: `Titular ${numero}` } : {}),
    ...(tipo === 'continua' ? { continua_estadia_id: `c-${numero}`, continua_titular: `Titular ${numero}` } : {})
});
const categorias = ['Ingresan', 'Salen', 'Continúan', 'Servicios', 'Pagos', 'Notas de hoy'];
const nota = (campos = {}) => ({
    id: 'nota-1', tipo: 'operativa_resumen', fecha_operacion: '2026-09-12', cabana_id: 'cab-4',
    texto: 'Cama adicional\nCoordinar antes de las 18:00.', creado_en: '2026-09-12T10:00:00Z', ...campos
});

async function verificarBloques(vista, contadores) {
    const lecturasAntes = await vista.page().evaluate(() => window.__lecturas.length);
    assert.deepEqual(await vista.locator('.haku-dia-sites__valor').allInnerTexts(), contadores.map(String));
    assert.deepEqual(await vista.locator('.haku-dia-sites__etiqueta').allTextContents(), categorias);
    assert.deepEqual(await vista.locator('.haku-dia-sites__seccion-nombre').allTextContents(), categorias);
    assert.deepEqual(await vista.locator('.haku-dia-sites__seccion-contador').allTextContents(), contadores.map(String));
    assert.equal(await vista.locator('details[open]').count(), 0, 'los bloques comienzan cerrados');
    for (let i = 0; i < categorias.length; i++) {
        const bloque = vista.locator('details').nth(i);
        const cabecera = bloque.locator('summary');
        await cabecera.click();
        assert.equal(await bloque.evaluate(el => el.open), true);
        assert.equal(await bloque.locator('.haku-dia-sites__fila').count(), Number(contadores[i]) || 0);
        if (contadores[i] === 0 || contadores[i] === '—') assert.equal(await bloque.locator('.haku-dia-sites__vacio').isVisible(), true);
        await cabecera.press('Enter');
        assert.equal(await bloque.evaluate(el => el.open), false, 'teclado colapsa');
        await cabecera.press('Space');
        assert.equal(await bloque.evaluate(el => el.open), true, 'teclado expande');
    }
    assert.equal(await vista.page().evaluate(() => window.__lecturas.length), lecturasAntes, 'desplegar reutiliza los datos contados sin otra consulta');
}

async function verificarDiseno(vista) {
    const layout = await vista.evaluate(el => {
        const card = el.querySelector('.haku-dia-sites__tarjeta');
        const cajas = [...el.querySelectorAll('.haku-dia-sites__metrica')].map(nodo => {
            const caja = nodo.getBoundingClientRect();
            return { x: caja.x, y: caja.y, width: caja.width, height: caja.height };
        });
        return {
            cajas,
            overflow: card.scrollWidth > card.clientWidth + 1,
            paginaOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            tipografia: [...el.querySelectorAll('.haku-dia-sites__etiqueta, .haku-dia-sites__principal > span')].map(nodo => parseFloat(getComputedStyle(nodo).fontSize)),
            filas: [...el.querySelectorAll('.haku-dia-sites__fila')].map(nodo => ({ border: getComputedStyle(nodo).borderTopWidth, radio: getComputedStyle(nodo).borderRadius }))
        };
    });
    assert.equal(layout.overflow, false, 'tarjeta sin overflow');
    assert.equal(layout.paginaOverflow, false, 'página sin overflow');
    assert.equal(layout.cajas.length, 6);
    const primera = layout.cajas[0];
    for (let i = 0; i < 6; i++) {
        assert.ok(Math.abs(layout.cajas[i].width - primera.width) <= 1, 'ancho uniforme de contadores');
        assert.ok(Math.abs(layout.cajas[i].height - primera.height) <= 1, 'alto uniforme de contadores');
        assert.ok(Math.abs(layout.cajas[i].y - layout.cajas[i < 3 ? 0 : 3].y) <= 1, 'grilla de tres columnas');
    }
    assert.ok(layout.cajas[3].y > primera.y, 'dos filas');
    assert.ok(layout.tipografia.every(size => size >= 10), 'texto secundario legible');
    assert.ok(layout.filas.every(fila => fila.border === '0px' && fila.radio === '0px'), 'filas compactas, sin tarjetas individuales');
    assert.equal(await vista.locator('summary > svg[aria-hidden="true"]').count(), 12, 'icono y chevron por categoría');
    assert.equal(await vista.locator('.haku-dia-sites__pie > svg[aria-hidden="true"]').count(), 1, 'candado decorativo');
    assert.match(await vista.locator('.haku-dia-sites__pie').innerText(), /^Consulta de solo lectura\. No modifica reservas, pagos, servicios ni notas\.$/);
}

async function capturar(page, vista, nombre) {
    const viewport = page.viewportSize();
    // Altura suficiente para incluir toda la tarjeta dentro del scroll del asistente.
    await page.setViewportSize({ ...viewport, height: 1200 });
    await vista.locator('.haku-dia-sites__tarjeta').screenshot({ path: path.join(capturas, `${nombre}.png`) });
    await page.setViewportSize(viewport);
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errores = [];
        page.on('pageerror', error => errores.push(error.message));
        await setup(page);
        const fecha = '2026-09-12';
        const datos = {
            operacion: [fila(4, 'ingreso'), fila(2, 'salida'), fila(3, 'continua')],
            servicios: [
                { fechaServicio: fecha, numeroCabana: 5, titular: 'Servicio real', nombre: 'Masaje', hora: '17:00', estadoServicio: 'pendiente' },
                { fechaServicio: fecha, numeroCabana: 6, titular: 'Cancelado', nombre: 'Tinaja', hora: '18:00', estadoServicio: 'cancelado' },
                { fechaServicio: fecha, numeroCabana: 7, titular: 'No show', nombre: 'Jacuzzi', hora: '19:00', estadoServicio: 'no_show' }
            ],
            pagos: [{ numeroCabana: 4, titular: 'Titular 4', titulo: 'Cobro check-in pendiente', monto: 16000 }],
            notas: [
                nota({ id: 'segunda', texto: 'Avisar a recepción <img src=x onerror="window.__xss=true">', creado_en: '2026-09-12T11:00:00Z' }),
                nota({ id: 'primera', estadia_id: '33333333-3333-4333-8333-333333333333', reserva_id: '22222222-2222-4222-8222-222222222222' }),
                nota({ id: 'otra-fecha', texto: 'NO MOSTRAR OTRA FECHA', fecha_operacion: '2026-09-13' }),
                nota({ id: 'otro-tipo', texto: 'NO MOSTRAR OTRO TIPO', tipo: 'interna' })
            ],
            estadias: [{
                id: '33333333-3333-4333-8333-333333333333', reserva_id: '22222222-2222-4222-8222-222222222222',
                cabana_id: 'cab-7', fecha_ingreso: '2026-09-11', fecha_salida: '2026-09-14', estado_estadia: 'confirmada'
            }]
        };
        const vista = await consultar(page, 'Haku, resumen del día 12 de septiembre de 2026', datos);
        assert.equal(await vista.locator('.haku-dia-sites__mensaje-usuario').innerText(), 'Haku, resumen del día 12 de septiembre de 2026');
        assert.equal(await page.locator('#haiku-asistente-titulo').innerText(), 'Tareas de hoy');
        assert.equal(await page.locator('.haiku-asistente-titulo span').innerText(), 'HAKU · ASISTENTE OPERATIVO');
        assert.equal(await page.locator('.haku-dia-sites__cabecera-chip').innerText(), 'Solo lectura');
        assert.equal(await vista.locator('.haku-dia-sites__fecha').innerText(), '12 sep 2026');
        assert.equal(await vista.locator('.haku-dia-sites__tarjeta-titulos > span').innerText(), 'RESUMEN OPERATIVO');
        assert.equal(await vista.locator('h3').innerText(), 'Tareas de hoy');
        assert.equal(await vista.locator('.haku-dia-sites__descripcion').innerText(), 'Tu operación del día, ordenada por categoría.');
        assert.equal(await vista.locator('.haku-dia-sites__ayuda').innerText(), 'Despliega una categoría para ver el detalle.');
        await verificarDiseno(vista);
        assert.equal(await vista.locator('details[open]').count(), 0);
        const pagosAcento = await vista.locator('.haku-dia-sites__metrica--pagos').evaluate(el => getComputedStyle(el).backgroundColor);
        assert.equal(pagosAcento, 'rgb(255, 242, 223)', 'acento ámbar de Sites');
        assert.equal(await vista.locator('.haku-dia-sites__alerta').innerText(), '1 pago pendiente · $16.000 CLP');
        assert.equal(await vista.locator('.haku-dia-sites__alerta > svg').count(), 1);
        assert.equal(await vista.locator('.haku-dia-sites__alerta').evaluate(el => getComputedStyle(el).backgroundColor), pagosAcento);
        await capturar(page, vista, '01-inicial-cerrada');
        const serviciosBloque = vista.locator('details').nth(3);
        await serviciosBloque.locator('summary').click();
        await verificarDiseno(vista);
        assert.match(await serviciosBloque.innerText(), /Servicio real\s+Masaje\s+17:00\s+Pendiente/);
        assert.equal(await serviciosBloque.locator('.haku-dia-sites__meta > strong').innerText(), '17:00');
        const alineacion = await serviciosBloque.locator('.haku-dia-sites__fila').evaluate(el => ({
            texto: el.querySelector('.haku-dia-sites__principal').getBoundingClientRect().top,
            hora: el.querySelector('.haku-dia-sites__meta').getBoundingClientRect().top
        }));
        assert.ok(Math.abs(alineacion.texto - alineacion.hora) <= 1, 'hora alineada con el nombre');
        await capturar(page, vista, '02-servicios-desplegado');
        const pagosBloque = vista.locator('details').nth(4);
        await pagosBloque.locator('summary').click();
        assert.equal(await serviciosBloque.evaluate(el => el.open), true, 'abrir Pagos no cierra Servicios');
        await serviciosBloque.locator('summary').click();
        await capturar(page, vista, '03-pagos-desplegado');
        await pagosBloque.locator('summary').click();
        const notasBloque = vista.locator('details').last();
        await notasBloque.locator('summary').click();
        assert.equal(await notasBloque.locator('.haku-dia-sites__meta').first().innerText(), 'Operativa');
        await capturar(page, vista, '04-notas-desplegado');
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await verificarDiseno(vista);
            await capturar(page, vista, `07-${width}px-notas-desplegado`);
            await notasBloque.locator('summary').click();
            await verificarDiseno(vista);
            await capturar(page, vista, `08-${width}px-inicial-cerrada`);
            await serviciosBloque.locator('summary').click();
            await pagosBloque.locator('summary').click();
            await verificarDiseno(vista);
            const valores = await vista.locator('details[open] .haku-dia-sites__fila').evaluateAll(filas => filas.map(fila => {
                const principal = fila.querySelector('.haku-dia-sites__principal').getBoundingClientRect();
                const meta = fila.querySelector('.haku-dia-sites__meta').getBoundingClientRect();
                return { derecha: meta.left >= principal.right, alineado: Math.abs(meta.top - principal.top) <= 1,
                    principal: { top: principal.top, right: principal.right }, meta: { top: meta.top, left: meta.left } };
            }));
            assert.ok(valores.every(valor => valor.derecha && valor.alineado), `hora/monto a la derecha y alineados en ${width}px: ${JSON.stringify(valores)}`);
            await capturar(page, vista, `09-${width}px-servicios-pagos`);
            await serviciosBloque.locator('summary').click();
            await pagosBloque.locator('summary').click();
            await notasBloque.locator('summary').click();
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await notasBloque.locator('summary').click();
        await verificarBloques(vista, [1, 1, 1, 1, 1, 2]);
        assert.match(await vista.innerText(), /CAB 4\s+Titular 4\s+Ingreso\s+Por ingresar/);
        assert.match(await vista.innerText(), /CAB 2\s+Titular 2\s+Salida\s+Por salir/);
        assert.match(await vista.innerText(), /CAB 3\s+Titular 3\s+Continúa\s+En estadía/);
        assert.match(await vista.innerText(), /CAB 5\s+Servicio real\s+Masaje\s+17:00\s+Pendiente/);
        assert.doesNotMatch(await vista.innerText(), /Cancelado|No show/);
        assert.match(await vista.innerText(), /Cobro check-in pendiente\s+\$16\.000/);
        assert.match(await vista.locator('.haku-dia-sites__alerta').innerText(), /1 pago pendiente.*\$16\.000/);
        const notasVisibles = vista.locator('.haku-dia-sites__fila--nota');
        assert.deepEqual(await notasVisibles.locator('.haku-dia-sites__cab').allInnerTexts(), ['CAB 7', 'CAB 4']);
        assert.equal(await notasVisibles.first().locator('.haku-dia-sites__principal > span').innerText(), nota().texto);
        assert.match(await notasVisibles.last().innerText(), /<img src=x/);
        assert.equal(await notasVisibles.locator('img').count(), 0, 'texto de notas se escapa');
        assert.equal(await page.evaluate(() => !!window.__xss), false);
        assert.doesNotMatch(await vista.innerText(), /NO MOSTRAR/);
        assert.equal(await notasVisibles.first().locator('.haku-dia-sites__principal > span').evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap');
        assert.deepEqual((await page.evaluate(() => window.__lecturas)).filter(x => x.nombre === 'haiku_operacion_dia').map(x => x.parametros.p_fecha), [fecha]);
        assert.equal(await page.locator('#haku-resumen-dia-v1-css').count(), 0, 'sin CSS legacy inyectado');
        assert.equal(await vista.locator('.haku-dia-sites__tarjeta').count(), 1, 'Sites desde el primer render');
        assert.doesNotMatch(await vista.innerText(), /Vista visual|En Haku real|datos de muestra|prototipo|demostración/i);
        assert.match(await vista.locator('.haku-dia-sites__pie').innerText(), /Consulta de solo lectura/);
        await page.screenshot({ path: path.join(os.tmpdir(), 'haku-resumen-dia-sites-desktop.png') });

        const vacio = await consultar(page, 'Haku, resumen del día 13 de septiembre de 2026', { operacion: [fila(2, 'salida')], servicios: [], pagos: [] });
        await verificarBloques(vacio, [0, 1, 0, 0, 0, 0]);
        await verificarDiseno(vacio);
        await vacio.locator('details[open]').evaluateAll(nodos => nodos.forEach(nodo => { nodo.open = false; }));
        await vacio.locator('details').first().locator('summary').click();
        await capturar(page, vacio, '05-categoria-vacia');
        assert.equal(await vacio.locator('.haku-dia-sites__alerta').count(), 0);
        assert.equal(await vacio.locator('.haku-dia-sites__metrica--pagos').count(), 0, 'sin acento de pagos si no hay pendientes');

        const sinDatos = await consultar(page, 'Haku, resumen del día 15 de septiembre de 2026', { operacion: [], servicios: [], pagos: [] });
        await verificarBloques(sinDatos, [0, 0, 0, 0, 0, 0]);
        await verificarDiseno(sinDatos);
        assert.equal(await sinDatos.locator('.haku-dia-sites__tarjeta > .haku-dia-sites__vacio').innerText(), 'No encontré movimientos operativos para esta fecha.');

        const soloNotas = await consultar(page, 'Haku, resumen del día 16 de septiembre de 2026', {
            operacion: [], servicios: [], pagos: [], notas: [nota({ fecha_operacion: '2026-09-16', texto: 'Nota muy larga ' + 'texto'.repeat(70) })]
        });
        await verificarBloques(soloNotas, [0, 0, 0, 0, 0, 1]);
        assert.equal(await soloNotas.locator('.haku-dia-sites__tarjeta > .haku-dia-sites__vacio').count(), 0);
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
            assert.equal(await soloNotas.locator('.haku-dia-sites__tarjeta').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `sin overflow a ${width}px con notas largas`);
            assert.equal(await soloNotas.locator('.haku-dia-sites__fila--nota').isVisible(), true);
        }
        await page.setViewportSize({ width: 1440, height: 900 });

        const falloNotas = await consultar(page, 'Haku, resumen del día 17 de septiembre de 2026', { operacion: [fila(4, 'ingreso')], servicios: [], pagos: [], errorNotas: true });
        await verificarBloques(falloNotas, [1, 0, 0, 0, 0, '—']);
        await verificarDiseno(falloNotas);
        await falloNotas.locator('details[open]').evaluateAll(nodos => nodos.forEach(nodo => { nodo.open = false; }));
        await falloNotas.locator('details').last().locator('summary').click();
        await capturar(page, falloNotas, '06-error-notas');
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await verificarDiseno(falloNotas);
            assert.equal(await falloNotas.locator('details').last().locator('.haku-dia-sites__vacio').isVisible(), true);
            await capturar(page, falloNotas, `10-${width}px-error-notas`);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        assert.match(await falloNotas.locator('details').last().innerText(), /No pude consultar las notas de esta fecha/);
        assert.equal(await falloNotas.locator('.haku-dia-sites__tarjeta > .haku-dia-sites__vacio').count(), 0);
        const reintento = await consultar(page, 'Haku, resumen del día 17 de septiembre de 2026', { operacion: [], servicios: [], pagos: [], notas: [nota({ fecha_operacion: '2026-09-17' })] });
        await verificarBloques(reintento, [0, 0, 0, 0, 0, 1]);

        const hoy = await page.evaluate(() => window.HAIKU_ASISTENTE_RESUMEN_DIA_V1.fechaDesdeTexto('Haku, resumen del día'));
        const resumenHoy = await consultar(page, 'Haku, resumen del día', {
            operacion: [], servicios: [], pagos: [], notas: [nota({ fecha_operacion: hoy, texto: 'Nota de la fecha actual en Chile' })]
        });
        await verificarBloques(resumenHoy, [0, 0, 0, 0, 0, 1]);
        assert.equal(await page.evaluate(() => window.__lecturas.filter(c => c.nombre === 'leer-notas').at(-1).filtros.find(f => f.campo === 'fecha_operacion').valor), hoy);

        const sinCabana = await consultar(page, 'Haku, resumen del día 7 de octubre de 2026', {
            operacion: [], servicios: [
                { fechaServicio: '2026-10-07', titular: 'Servicio sin cabaña', nombre: 'Masaje', estadoServicio: 'realizado', cortesia: true }
            ], pagos: [{ titular: 'Pago sin cabaña', titulo: 'Saldo de check-in', monto: 90000 }]
        });
        assert.equal(await sinCabana.locator('.haku-dia-sites__fecha').innerText(), '07 oct 2026');
        await verificarBloques(sinCabana, [0, 0, 0, 1, 1, 0]);
        assert.equal(await sinCabana.locator('.haku-dia-sites__cab').count(), 0, 'sin badge si no hay cabaña');
        assert.match(await sinCabana.locator('details').nth(3).innerText(), /Masaje\s+Sin hora\s+Realizado · Cortesía/);
        assert.equal(await sinCabana.locator('.haku-dia-sites__alerta').innerText(), '1 pago pendiente · $90.000 CLP');
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await verificarDiseno(sinCabana);
        }
        await page.setViewportSize({ width: 1440, height: 900 });

        await page.evaluate(() => { window.__apiNotas = window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1; delete window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1; });
        const sinPuente = await consultar(page, 'Haku, resumen del día 18 de septiembre de 2026', { operacion: [], servicios: [], pagos: [] });
        await verificarBloques(sinPuente, [0, 0, 0, 0, 0, '—']);
        assert.equal(await sinPuente.locator('.haku-dia-sites__tarjeta > .haku-dia-sites__vacio').count(), 0, 'una fuente no disponible no equivale a un día vacío');
        await page.evaluate(() => { window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1 = window.__apiNotas; delete window.__apiNotas; });

        const fullDay = await consultar(page, 'Haku, resumen del día 19 de septiembre de 2026', {
            operacion: [{ numero: 4, fullday_estadia_id: 'full-day', fullday_titular: 'Full Day real' }], servicios: [], pagos: []
        });
        await verificarBloques(fullDay, [1, 1, 0, 0, 0, 0]);
        assert.equal(await fullDay.locator('.haku-dia-sites__fila').count(), 2, 'conserva Full Day tanto en ingresos como en salidas');

        const muchos = Array.from({ length: 35 }, (_, i) => fila(i + 1, 'ingreso'));
        const largo = await consultar(page, 'Haku, resumen del día 14 de septiembre de 2026', { operacion: muchos, servicios: [], pagos: [] });
        await largo.locator('details').first().locator('summary').click();
        const area = page.locator('#haiku-asistente-mensajes');
        const scroll = await page.evaluate(() => {
            const el = document.getElementById('haiku-asistente-mensajes');
            const lista = document.querySelector('.haku-dia-sites:last-child .haku-dia-sites__lista');
            return { overflow: getComputedStyle(el).overflowY, scrollbar: getComputedStyle(el).scrollbarWidth,
                listaOverflow: getComputedStyle(lista).overflowY, height: el.scrollHeight, client: el.clientHeight };
        });
        assert.equal(scroll.overflow, 'auto');
        assert.equal(scroll.scrollbar, 'thin');
        assert.notEqual(scroll.listaOverflow, 'auto', 'sin scroll anidado en filas');
        assert.ok(scroll.height > scroll.client + 500);
        await area.evaluate(el => { el.scrollTop = 0; });
        const box = await area.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 560);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 100);
        assert.equal(await page.evaluate(() => window.scrollY), 0);
        await page.mouse.wheel(0, -560);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop < 100);
        assert.equal(await largo.locator('.haku-dia-sites__fila').count(), 35);

        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
        assert.equal(await largo.locator('.haku-dia-sites__metrica').count(), 6);
        assert.equal(await page.evaluate(() => {
            const card = document.querySelector('.haku-dia-sites:last-child .haku-dia-sites__tarjeta');
            return card.scrollWidth <= card.clientWidth + 1;
        }), true);
        await page.screenshot({ path: path.join(os.tmpdir(), 'haku-resumen-dia-sites.png') });
        await page.evaluate(() => document.getElementById('haiku-asistente-mensajes').appendChild(document.createElement('div')));
        await page.waitForFunction(() => document.getElementById('haiku-asistente-titulo').textContent === 'Haku');
        await page.evaluate(() => document.getElementById('haiku-asistente-mensajes').lastElementChild.remove());
        await page.waitForFunction(() => document.getElementById('haiku-asistente-titulo').textContent === 'Tareas de hoy');
        await page.locator('#haiku-asistente-cerrar').click();
        assert.equal(await page.locator('#haiku-asistente-panel').isVisible(), false);
        assert.deepEqual([...new Set((await page.evaluate(() => window.__lecturas)).map(x => x.nombre))].sort(),
            ['haiku_operacion_dia', 'hidratar-servicios', 'leer-cabanas', 'leer-notas', 'leer-reserva_estadias', 'obtener-pagos', 'refrescar-pagos']);
        assert.deepEqual(await page.evaluate(() => window.__escrituras), []);
        assert.equal(errores.length, 0, errores.join('\n'));

        const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        try {
            const paginaTactil = await movil.newPage();
            await setup(paginaTactil);
            const vistaTactil = await consultar(paginaTactil, 'Haku, resumen del día 14 de septiembre de 2026', { operacion: muchos, servicios: [], pagos: [] });
            await verificarDiseno(vistaTactil);
            await vistaTactil.locator('details').first().locator('summary').tap();
            assert.equal(await vistaTactil.locator('details').first().evaluate(el => el.open), true);
            await vistaTactil.locator('details').first().locator('summary').tap();
            assert.equal(await vistaTactil.locator('details').first().evaluate(el => el.open), false);
            await vistaTactil.locator('details').first().locator('summary').tap();
            const mensajesMovil = paginaTactil.locator('#haiku-asistente-mensajes');
            await mensajesMovil.evaluate(el => { el.scrollTop = 0; });
            const areaMovil = await mensajesMovil.boundingBox();
            const x = Math.round(areaMovil.x + areaMovil.width / 2);
            const y = Math.round(areaMovil.y + areaMovil.height * .78);
            const cdp = await movil.newCDPSession(paginaTactil);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (let paso = 1; paso <= 8; paso++) await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove', touchPoints: [{ x, y: y - paso * 45 }]
            });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await paginaTactil.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 20);
            assert.equal(await paginaTactil.evaluate(() => window.scrollY), 0);
        } finally { await movil.close(); }
        console.log('Tareas de hoy: UI inicial/Servicios/Pagos/Notas/vacío/error, 3×2, iconos, alineación, ámbar, footer, 390/320px, listas/contadores, teclado/touch y regresiones OK; sin escrituras ni red externa');
        console.log(`Capturas de revisión: ${capturas}`);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
