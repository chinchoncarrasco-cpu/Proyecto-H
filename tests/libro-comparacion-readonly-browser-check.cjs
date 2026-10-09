// R1: runtime Web real, sin red remota; datos ficticios y clientes SELECT instrumentados.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), F = require('./fixtures/libro-comparacion-readonly.cjs');
const root = path.resolve(__dirname, '..'), externos = [], errores = [];
const scripts = ['haiku-libro-semantica-v1', 'haiku-fullday-tarifa-v1', 'haiku-libro-pagos-canon-v1',
    'haiku-libro-lenguaje-natural-v1', 'haiku-libro-pagos-destinos-v1', 'haiku-libro-consultas-v1',
    'haiku-libro-cancelaciones-v1', 'haiku-libro-bloqueos-v1', 'haiku-libro-comparacion-readonly-v1'];
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' })
        .end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body></body></html>');
    const name = pathname.match(/^\/js\/([a-z0-9-]+)\.js$/)?.[1];
    if (!scripts.includes(name)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'application/javascript;charset=utf-8', 'Cache-Control': 'no-store' })
        .end(fs.readFileSync(path.join(root, 'js', name + '.js')));
});
const casos = [F.casos().find(x => x.id === 'asociacion_segura'), F.caso('normalizacion_titular', r => {
    r.titular = 'Huésped frecuente'; r.texto_original = 'Huésped frecuente / Ficticiouno Apellidouno / 2 ADL';
}), ...['full_day', 'aplicacion_existente', 'bloqueos_lectura_segura', 'cancelacion_informativa'].map(id => F.casos().find(x => x.id === id))];
(async () => {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok)); let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        const origin = 'http://127.0.0.1:' + server.address().port;
        for (const width of [1100, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 850 } });
            await context.route('**/*', route => {
                if (new URL(route.request().url()).origin === origin) return route.continue();
                externos.push(route.request().url()); return route.abort();
            });
            const page = await context.newPage(); page.on('pageerror', e => errores.push(e.message));
            for (const f of casos) {
                await page.goto(origin);
                await page.addScriptTag({ url: origin + '/js/haiku-libro-semantica-v1.js' });
                await page.evaluate(({ data, libro, cliente }) => {
                    globalThis.copy = structuredClone;
                    globalThis.HAIKU_LIBRO_RESERVA_V1 = (0, eval)('(' + libro + ')')(data);
                    globalThis.crearClienteFixture = (0, eval)('(' + cliente + ')');
                }, { data: f.data, libro: F.libroBase.toString(), cliente: F.cliente.toString() });
                for (const name of scripts.slice(1)) await page.addScriptTag({ url: origin + '/js/' + name + '.js' });
                const result = await page.evaluate(async ({ f, ahora, consulta }) => {
                    const semantica = HAIKU_LIBRO_SEMANTICA, query = HAIKU_LIBRO_CONSULTAS, capturas = [];
                    globalThis.HAIKU_LIBRO_CONSULTAS = { ...query, crearMotorLectura: deps => {
                        capturas.push(deps.semantica); return query.crearMotorLectura(deps);
                    } };
                    const a = HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo();
                    const b = HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo();
                    const c = HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo();
                    const clienteWeb = crearClienteFixture(f.db);
                    const web = await query.consultar(consulta, HAIKU_LIBRO_RESERVA_V1, clienteWeb);
                    const firma = comp => comp.map(x => ({ estado: x.estado, categoria: x.categoria, confianza: x.confianza,
                        titular: x.libro.titular, cabana: x.libro.cabana, ingreso: x.libro.fecha_checkin, salida: x.libro.fecha_checkout,
                        tipo: x.libro.tipo_estadia, diferencias: x.diferencias,
                        pagos: x.pagosComparacion.map(p => p.estado), servicios: x.serviciosComparacion.map(s => s.estado) }));
                    const dtos = [], mutaciones = [...clienteWeb.mutaciones];
                    for (const n of [a, b, c]) {
                        const cliente = crearClienteFixture(f.db);
                        const dto = await n.compararMes({ fuente: { libro: HAIKU_LIBRO_RESERVA_V1 }, cliente, ahora });
                        dtos.push(JSON.parse(JSON.stringify(dto))); mutaciones.push(...cliente.mutaciones);
                    }
                    return { mismaSemantica: capturas.length === 3 && capturas.every(s => s === semantica && s.normalizar === semantica.normalizar),
                        globalIntacto: HAIKU_LIBRO_SEMANTICA === semantica,
                        normalizada: semantica.normalizar(consulta), firma: firma(web.comparacion),
                        meta: web.comparacion.meta, contadores: query.modeloPresentacionComparacion(web).contadores, dtos, mutaciones };
                }, { f, ahora: F.ahora, consulta: 'Libro: comparar reservas en el mes de octubre de 2026 con Proyecto H' });
                assert.ok(result.mismaSemantica); assert.ok(result.globalIntacto); assert.match(result.normalizada, /01-10-2026 31-10-2026/);
                assert.deepEqual(result.mutaciones, []);
                for (const dto of result.dtos) {
                    assert.ok(['ok', 'incompleto'].includes(dto.status), JSON.stringify(dto.error));
                    assert.deepEqual(dto.presentacion, result.contadores);
                    assert.deepEqual(dto.comparacion.meta, { ...result.meta, estadias_libro: result.meta.estadias_libro ?? null });
                    assert.deepEqual(dto.comparacion.items.map(x => ({ estado: x.estado, categoria: x.categoria, confianza: x.confianza,
                        titular: x.libro.titular, cabana: x.libro.cabana, ingreso: x.libro.fecha_checkin, salida: x.libro.fecha_checkout,
                        tipo: x.libro.tipo_estadia, diferencias: x.diferencias,
                        pagos: x.pagoIds.map(id => dto.pagosDetalle.find(p => p.id === id).estado),
                        servicios: x.servicioIds.map(id => dto.serviciosDetalle.find(s => s.id === id).estado) })), result.firma);
                    const allowed = new Set([...dto.comparacion.items, ...dto.comparacion.grupos, ...dto.pagosDetalle, ...dto.serviciosDetalle]);
                    const check = x => { if (!x || typeof x !== 'object') return;
                        for (const [key, value] of Object.entries(x)) {
                            assert.ok(!['reserva_id', 'estadia_id', 'grupo_reserva_id', 'servicio_id', 'cargo_id'].includes(key));
                            if (key === 'id') { assert.ok(allowed.has(x)); assert.match(value, /^(caso|grupo|pago|servicio):[1-9]\d*$/); }
                            check(value);
                        }
                    }; check(dto);
                    if (f.id === 'aplicacion_existente') assert.equal(dto.pagosDetalle[0].destinoFinanciero.estado, 'ya_aplicada');
                    if (f.id === 'full_day') assert.equal(dto.comparacion.items[0].libro.tipo_estadia, 'full_day');
                    if (f.id === 'normalizacion_titular') assert.equal(dto.comparacion.items[0].libro.titular, 'Ficticiouno Apellidouno');
                    if (f.id === 'bloqueos_lectura_segura') assert.equal(dto.contexto.bloqueos.items[0].estado, 'ya_coincide');
                    if (f.id === 'cancelacion_informativa') assert.equal(dto.contexto.cancelaciones.confirmadas.length, 1);
                }
            }
            console.log(`PASS R1 ${width}px: Web inicializado, 6 casos x 3 núcleos, misma semántica/normalizar, paridad, DTO sin IDs persistentes, 0 mutaciones.`);
            await context.close();
        }
        assert.deepEqual(errores, []); assert.deepEqual(externos, []);
    } finally { if (browser) await browser.close(); await new Promise(ok => server.close(ok)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
