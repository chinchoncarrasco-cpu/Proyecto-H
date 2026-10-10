// Página publicada bajo /Proyecto-H/, código/worker reales y datos anonimizados; toda red externa es falsa.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), { createHash } = require('node:crypto'), { chromium } = require('playwright');
const F = require('./fixtures/libro-comparacion-readonly.cjs');
const Core = require('../js/haiku-libro-comparacion-readonly-v1.js');
const real = require('./fixtures/libro-reconciliacion-oct26-real.json');
const root = path.resolve(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f));
const bytes = read('tests/fixtures/libro-reconciliacion-oct26-real.xlsx');
const fileId = read('js/supabase-libro-google-readonly-v1.js').toString().match(/const FILE_ID = "([^"]+)"/)[1];
const assets = process.env.HAIKU_LIBRO_WORKER_ASSETS || path.join(os.tmpdir(), 'haiku-jonathan-real-xlsx');
const screenshots = path.join(os.tmpdir(), 'haiku-libro-informe-readonly'); fs.mkdirSync(screenshots, { recursive: true });
for (const name of ['xlsx.full.min.js', 'jszip.min.js']) assert.ok(fs.existsSync(path.join(assets, name)), 'Caché requerida: ' + name);
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'), rel = url.pathname.replace(/^\/Proyecto-H\//, '');
    if (rel === 'seed.html') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><html><body></body></html>');
    if (!['libro-comparacion.html', 'panel.html', 'index.html'].includes(rel) && !/^(?:js|css)\/[a-z0-9-]+\.(?:js|css)$/.test(rel)) return res.writeHead(404).end();
    const p = path.join(root, rel); if (!fs.existsSync(p)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': rel.endsWith('.html') ? 'text/html;charset=utf-8' : rel.endsWith('.css') ? 'text/css' : 'application/javascript;charset=utf-8' }).end(fs.readFileSync(p));
});
// Login canónico real; SDK/red de auth ficticios. El resto del panel se aísla para no ejecutar operaciones de negocio.
async function validarLoginCanonico(browser, origin, width) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const audit = { logins: 0, rpc: [], from: 0, oauth: 0, clientes: [], urls: [] };
    let usuario = null;
    await context.exposeBinding('__sesionFicticia', () => usuario);
    await context.exposeBinding('__loginFicticio', (_, credentials) => {
        assert.deepEqual(credentials, { email: 'operador@example.invalid', password: 'clave-ficticia-solo-test' });
        audit.logins++; usuario = { id: 'usuario-ficticio-login', email: credentials.email }; return usuario;
    });
    await context.exposeBinding('__auditarLogin', (_, tipo, valor) => {
        if (tipo === 'cliente') audit.clientes.push(valor);
        else if (tipo === 'rpc') { audit.rpc.push(valor); assert.equal(valor, 'haiku_sesion_actual'); }
        else if (tipo === 'from') { audit.from++; throw Error('Lectura de negocio no permitida en prueba de login'); }
        else if (tipo === 'oauth') audit.oauth++;
    });
    await context.addInitScript(() => {
        const session = async () => { const user = await window.__sesionFicticia(); return user ? { user, access_token: 'TOKEN_FICTICIO_NO_EXPORTAR' } : null; };
        window.__cliente = { auth: {
            getSession: async () => ({ data: { session: await session() }, error: null }),
            getUser: async () => ({ data: { user: await window.__sesionFicticia() }, error: null }),
            signInWithPassword: async credentials => {
                await window.__loginFicticio(credentials); return { data: { session: await session() }, error: null };
            },
            signOut: async () => { throw Error('Logout inesperado en prueba de login'); },
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
        }, rpc: async name => {
            await window.__auditarLogin('rpc', name);
            return { data: { usuario: { activo: true }, roles: [], permisos: ['reservas.ver', 'pagos.ver', 'servicios.ver'] }, error: null };
        }, from: async () => window.__auditarLogin('from') };
        window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken: () => window.__auditarLogin('oauth') }), revoke: (_, cb) => cb() } } };
    });
    await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin) {
            const panel = request.frame().url().endsWith('/panel.html');
            if (panel && request.resourceType() === 'script' && !/\/js\/supabase-(?:client|auth)\.js$/.test(url.pathname))
                return route.fulfill({ contentType: 'application/javascript', body: '/* Módulo de negocio aislado en test de autenticación. */' });
            if (panel && request.resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '' });
            return route.continue();
        }
        if (request.url().includes('@supabase/supabase-js@2')) return route.fulfill({ contentType: 'application/javascript',
            body: 'window.supabase={createClient:(_url,_key,options)=>{window.__auditarLogin("cliente",options.auth);return window.__cliente;}};' });
        return route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) audit.urls.push(frame.url()); });
    try {
        await page.goto(origin + '/Proyecto-H/libro-comparacion.html');
        await page.waitForFunction(() => document.getElementById('informe-estado').dataset.estado === 'sin_sesion');
        assert.equal(await page.locator('#informe-login').isVisible(), true);
        assert.equal(await page.locator('#informe-comparar').isEnabled(), false);
        assert.equal(await page.locator('#informe-resultado').isVisible(), false);
        assert.equal(await page.locator('#seccion-libro-reserva').isVisible(), false);
        assert.deepEqual(audit.rpc, []); assert.equal(audit.oauth, 0); assert.equal(audit.from, 0);
        await page.screenshot({ path: path.join(screenshots, 'login-sin-sesion-' + width + '.png'), fullPage: true });
        await page.locator('#informe-login').click();
        await page.waitForURL(origin + '/Proyecto-H/panel.html');
        await page.waitForFunction(() => document.getElementById('haiku-auth-submit')?.disabled === false);
        assert.equal(await page.locator('.haiku-auth-overlay').isVisible(), true);
        assert.ok((await page.locator('#haiku-auth-estado').innerText()).includes('Ingresa para continuar'));
        await page.locator('#haiku-auth-email').fill('operador@example.invalid');
        await page.locator('#haiku-auth-password').fill('clave-ficticia-solo-test');
        await page.locator('#haiku-auth-submit').click();
        await page.waitForFunction(() => !!window.haikuSesion && document.querySelector('.haiku-auth-overlay').hidden);
        assert.equal(audit.logins, 1);
        await page.goBack();
        await page.waitForURL(origin + '/Proyecto-H/libro-comparacion.html');
        await page.waitForFunction(() => document.getElementById('informe-estado').dataset.estado === 'google_desconectado');
        assert.equal(await page.locator('#informe-login').isVisible(), false);
        assert.equal(await page.locator('#seccion-libro-reserva').isVisible(), true);
        assert.equal(await page.locator('#informe-comparar').isEnabled(), false);
        assert.equal(await page.locator('#informe-resultado').innerText(), '');
        assert.equal(await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.estado().cargado), false);
        assert.ok(audit.clientes.length >= 3);
        assert.ok(audit.clientes.every(a => a.persistSession === true && a.storageKey === 'haiku-supabase-auth'));
        assert.ok(audit.rpc.length >= 2 && audit.rpc.every(n => n === 'haiku_sesion_actual'));
        assert.equal(audit.oauth, 0); assert.equal(audit.from, 0); assert.deepEqual(errors, []);
        for (const value of audit.urls) { const url = new URL(value); assert.equal(url.search, ''); assert.equal(url.hash, ''); assert.ok(!/TOKEN_|clave-ficticia|operador@/.test(value)); }
        console.log('PASS R1 login ' + width + 'px: sesión ausente → panel.html/cliente/auth canónicos → login ficticio → Atrás → informe revalida sesión; 0 tokens en URL, OAuth automático o escrituras de negocio.');
    } finally { await context.close(); }
}
(async () => {
    // DTOs producidos por el núcleo real; se usan sólo para auditar el renderer, no sustituyen el flujo XLSX de la página.
    const dtos = await Promise.all(F.casos().map(async f => ({ id: f.id, dto: await Core.crearNucleo().compararMes({
        fuente: { hojas: { Oct26: f.data }, nombre: 'Fixture ficticio.xlsx' }, cliente: F.cliente(f.db), ahora: F.ahora }) })));
    await new Promise(ok => server.listen(0, '127.0.0.1', ok)); let browser;
    const origin = 'http://127.0.0.1:' + server.address().port, externos = [];
    try {
        browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        for (const width of [390, 1100]) await validarLoginCanonico(browser, origin, width);
        for (const width of [320, 360, 390, 1100]) {
            const context = await browser.newContext({ viewport: { width, height: 850 } });
            await context.route('**/*', route => {
                const url = route.request().url(); if (new URL(url).origin === origin) return route.continue();
                if (url.includes('@supabase/supabase-js@2')) return route.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient:()=>window.__cliente};' });
                if (url === 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js') return route.fulfill({ path: path.join(assets, 'xlsx.full.min.js'), contentType: 'application/javascript' });
                if (url === 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js') return route.fulfill({ path: path.join(assets, 'jszip.min.js'), contentType: 'application/javascript' });
                externos.push(new URL(url).origin); return route.abort();
            });
            await context.addInitScript(({ bytes, hash, md5, fileId, db, clienteCode }) => {
                if (!location.pathname.endsWith('libro-comparacion.html')) return;
                const RealDate = Date, fixed = RealDate.parse('2026-10-09T12:00:00Z');
                window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
                window.copy = structuredClone;
                const base = (0, eval)('(' + clienteCode + ')')(db);
                window.__audit = { dto: null, compares: 0, downloads: 0, metadata: 0, oauth: 0, storage: [], idb: 0, logs: [], sessionUser: 'usuario-ficticio-a',
                    rpc: [], perms: ['reservas.ver', 'pagos.ver', 'servicios.ver'], failM2: false, changeM2: false, blockM2: false, blockDownload: false, callback: null, base };
                const a = window.__audit;
                for (const method of ['log', 'info', 'warn', 'error']) console[method] = (...args) => a.logs.push(args.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
                const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { a.storage.push([k,String(v)]); return set.call(this,k,v); };
                const open = IDBFactory.prototype.open; IDBFactory.prototype.open = function(...args) { a.idb++; return open.apply(this,args); };
                const session = () => ({ data: { session: a.sessionUser ? { user: { id: a.sessionUser }, access_token: 'TOKEN_SUPABASE_FICTICIO' } : null }, error: null });
                window.__cliente = { ...base, auth: { getSession: async () => session(), getUser: async () => ({ data: { user: a.sessionUser ? { id: a.sessionUser } : null }, error: null }),
                    signOut: async () => { a.sessionUser = null; a.callback('SIGNED_OUT', null); },
                    onAuthStateChange: cb => { a.callback = cb; return { data: { subscription: { unsubscribe() {} } } }; } },
                    rpc: async name => { a.rpc.push(name); if (name !== 'haiku_sesion_actual') throw Error('Writer prohibited');
                        return { data: { usuario: { activo: true }, permisos: a.perms }, error: null }; } };
                let api; Object.defineProperty(window, 'HAIKU_LIBRO_COMPARACION_READONLY_V1', { configurable: true,
                    get: () => api, set: real => { api = { ...real, crearNucleo: () => { const n = real.crearNucleo(); return { compararMes: async input => {
                        a.compares++; const dto = await n.compararMes(input); a.dto = dto; return dto; } }; } }; } });
                window.google = { accounts: { oauth2: { initTokenClient() { return { callback: null, requestAccessToken() {
                    a.oauth++; this.callback({ access_token: 'TOKEN_GOOGLE_FICTICIO', expires_in: 3600 }); } }; }, revoke(token, cb) { cb(); } } } };
                window.fetch = async (url, init) => {
                    const u = new URL(String(url));
                    if (u.hostname !== 'www.googleapis.com' || u.pathname !== '/drive/v3/files/' + fileId || init.method !== 'GET' || init.headers.Authorization !== 'Bearer TOKEN_GOOGLE_FICTICIO') throw Error('Unexpected network request');
                    if (u.searchParams.get('alt') === 'media') {
                        a.downloads++;
                        const body = a.blockDownload ? new ReadableStream({ start(c) { a.releaseDownload = () => { c.enqueue(new Uint8Array(bytes)); c.close(); }; } }) : new Uint8Array(bytes);
                        return new Response(body, { headers: { 'Content-Length': String(bytes.length) } });
                    }
                    a.metadata++; const m2 = document.getElementById('informe-estado')?.dataset.estado === 'vigencia';
                    if (m2 && a.blockM2) await new Promise(ok => a.release = ok);
                    if (m2 && a.failM2) return new Response('CONTENIDO_PRIVADO_NO_EXPORTAR', { status: 500 });
                    return Response.json({ id: fileId, name: 'Libro ficticio.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: String(bytes.length),
                        version: m2 && a.changeM2 ? '32' : '31', modifiedTime: '2026-10-09T12:00:00Z', sha256Checksum: hash, md5Checksum: md5, capabilities: { canDownload: true }, trashed: false });
                };
            }, { bytes: [...bytes], hash: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('hex'), fileId, db: real.db, clienteCode: F.cliente.toString() });
            const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
            // Una copia antigua existe en IndexedDB; el informe no debe abrir/restaurar esa base.
            await page.goto(origin + '/Proyecto-H/seed.html');
            await page.evaluate(async bytes => new Promise((ok, no) => {
                const req = indexedDB.open('haiku-libro-reserva-local', 1); req.onupgradeneeded = () => req.result.createObjectStore('libro');
                req.onerror = no; req.onsuccess = () => { const db = req.result, tx = db.transaction('libro','readwrite');
                    tx.objectStore('libro').put({ nombre: 'Copia ficticia antigua.xlsx', buffer: new Uint8Array(bytes).buffer }, 'actual');
                    tx.oncomplete = () => { db.close(); ok(); }; };
            }), [...bytes]);
            await page.goto(origin + '/Proyecto-H/libro-comparacion.html');
            await page.waitForFunction(() => document.getElementById('informe-estado').dataset.estado === 'google_desconectado', null, { timeout: 5000 })
                .catch(async () => { throw Error('Initial state: ' + await page.locator('#informe-estado').innerText() + '; script errors: ' + errors.join('; ')); });
            assert.equal(await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.estado().cargado), false);
            assert.equal(await page.evaluate(() => __audit.idb), 0); assert.equal(await page.evaluate(() => __audit.oauth), 0);
            assert.equal(await page.locator('#informe-comparar').isEnabled(), false);
            await page.locator('#haiku-libro-google-conectar').click();
            await page.waitForFunction(() => !HAIKU_LIBRO_GOOGLE_V1.estado().sincronizando && HAIKU_LIBRO_RESERVA_V1.estado().cargado);
            await page.waitForFunction(() => !document.getElementById('informe-comparar').disabled);
            await page.locator('#informe-comparar').dblclick();
            await page.waitForFunction(() => ['completo','incompleto'].includes(document.getElementById('informe-estado').dataset.estado), null, { timeout: 20000 });
            const check = await page.evaluate(() => ({ dto: __audit.dto, compares: __audit.compares, mutations: __audit.base.mutaciones,
                rpc: __audit.rpc, storage: __audit.storage, idb: __audit.idb, logs: __audit.logs,
                hero: document.querySelector('.informe-fraccion strong').textContent, metrics: [...document.querySelectorAll('.informe-metrica strong')].map(e => e.textContent),
                counts: [...document.querySelectorAll('.informe-categoria > summary > span:nth-child(2)')].map(e => e.textContent),
                heights: [...document.querySelectorAll('.informe-categoria > summary')].map(e => e.getBoundingClientRect().height),
                overflow: document.documentElement.scrollWidth > innerWidth, open: document.querySelectorAll('details[open]').length,
                cssText: getComputedStyle(document.querySelector('.informe-detalles')).overflowY, globalsManual: !!document.getElementById('libro-reserva-archivo') }));
            assert.ok(['ok','incompleto'].includes(check.dto.status)); assert.equal(check.compares, 1); assert.deepEqual(check.mutations, []);
            const p = check.dto.presentacion;
            assert.equal(check.hero, p.estadiasAsociadas + ' / ' + p.estadiasValidas);
            assert.deepEqual(check.metrics, [p.estadiasAsociadas,p.faltantes,p.ambiguas].map(String));
            assert.deepEqual(check.counts, [p.gruposAsociados,p.gruposConDiferencias,p.faltantes,p.ambiguas,p.pagosRevisar,p.serviciosRevisar,p.advertencias].map(String));
            assert.equal(check.open, 0); assert.equal(check.overflow, false); assert.ok(check.heights.every(h => h >= 34 && h <= 38));
            assert.equal(check.idb, 0); assert.deepEqual(check.storage, []); assert.ok(check.rpc.every(n => n === 'haiku_sesion_actual'));
            assert.equal(check.globalsManual, false); assert.ok(check.logs.every(s => !/Ficticio|Apellid|TOKEN_|CONTENIDO_PRIVADO/.test(s)));
            await page.screenshot({ path: path.join(screenshots,'informe-' + width + '.png'), fullPage: true });
            // Este XLSX anonimizado contiene faltantes y servicios; abrir categorías con evidencia real.
            await page.locator('.informe-categoria > summary').nth(2).click(); await page.locator('.informe-categoria > summary').nth(5).click();
            await page.waitForTimeout(1100); assert.equal(await page.locator('.informe-categoria[open]').count(), 2);
            const tecnico = page.locator('.informe-categoria[open] .informe-tecnico').first(); await tecnico.locator('summary').click(); assert.equal(await tecnico.getAttribute('open'), '');
            assert.ok((await tecnico.innerText()).includes('Oct26'));
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            // Además del XLSX real, todos los estados canónicos se presentan sin reinterpretación ni HTML ejecutable.
            for (const { id, dto } of dtos) {
                const rendered = await page.evaluate(dto => {
                    const target = document.createElement('section'); document.querySelector('main').append(target);
                    HAIKU_LIBRO_INFORME_READONLY_V1.renderizar(document, target, dto);
                    const closed = !target.querySelector('details[open]');
                    const technicalClosed = [...target.querySelectorAll('.informe-tecnico')].every(d => !d.open);
                    const hero = target.querySelector('.informe-fraccion strong').textContent;
                    target.querySelectorAll('.informe-categoria > summary').forEach(s => s.click());
                    const categories = [...target.querySelectorAll('.informe-categoria')].map(d => d.innerText);
                    const overflow = document.documentElement.scrollWidth > innerWidth;
                    target.remove(); return { closed, technicalClosed, hero, categories, overflow };
                }, dto);
                assert.equal(rendered.closed, true, id); assert.equal(rendered.technicalClosed, true, id);
                assert.equal(rendered.hero, dto.presentacion.estadiasAsociadas + ' / ' + dto.presentacion.estadiasValidas, id);
                for (const p of dto.pagosDetalle) { assert.ok(rendered.categories[4].includes(p.estado), id); for (const m of p.motivos) assert.ok(rendered.categories[4].includes(m), id); }
                for (const s of dto.serviciosDetalle) { assert.ok(rendered.categories[5].includes(s.estado), id); if (s.motivo) assert.ok(rendered.categories[5].includes(s.motivo), id); }
                for (const a of [...dto.advertencias, ...dto.contexto.advertenciasInformativas]) assert.ok(rendered.categories[6].includes(a), id);
                assert.equal(rendered.overflow, false, id);
            }
            const unknown = structuredClone(dtos[0].dto); unknown.presentacion = {};
            unknown.comparacion.items[0].libro.titular = '<img src=x onerror="window.__htmlEjecutado=true">';
            const safe = await page.evaluate(dto => {
                const target = document.createElement('section'); document.querySelector('main').append(target);
                HAIKU_LIBRO_INFORME_READONLY_V1.renderizar(document, target, dto);
                const result = { hero: target.querySelector('.informe-fraccion strong').textContent, metrics: [...target.querySelectorAll('.informe-metrica strong')].map(e => e.textContent),
                    tags: target.querySelectorAll('img,script,a,button').length, executed: !!window.__htmlEjecutado, literal: target.textContent.includes('<img src=x') };
                target.remove(); return result;
            }, unknown);
            assert.equal(safe.hero, '— / —'); assert.deepEqual(safe.metrics, ['—','—','—']);
            assert.equal(safe.tags, 0); assert.equal(safe.executed, false); assert.equal(safe.literal, true);
            // M2 fallida elimina resultado anterior, sin contadores de éxito.
            await page.evaluate(() => __audit.failM2 = true); await page.locator('#informe-comparar').click();
            await page.waitForFunction(() => ['error_fuente','archivo_modificado'].includes(document.getElementById('informe-estado').dataset.estado));
            assert.equal(await page.locator('#informe-resultado').isVisible(), false);
            assert.equal(await page.locator('#informe-resultado').innerText(), '');
            await page.evaluate(() => { __audit.failM2 = false; __audit.blockM2 = true; });
            await page.locator('#informe-comparar').click(); await page.waitForFunction(() => !!__audit.release);
            await page.evaluate(() => { __audit.sessionUser = 'usuario-ficticio-b'; __audit.callback('SIGNED_IN', { user: { id: __audit.sessionUser } }); __audit.release(); });
            await page.waitForTimeout(150); assert.equal(await page.locator('#informe-resultado').isVisible(), false);
            assert.equal(await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.estado().cargado), false);
            await page.evaluate(() => { __audit.sessionUser = null; __audit.callback('SIGNED_OUT', null); });
            await page.waitForFunction(() => document.getElementById('informe-estado').dataset.estado === 'sin_sesion');
            assert.equal(await page.locator('#seccion-libro-reserva').isVisible(), false);
            // Connect usa la sincronización OAuth existente: tampoco puede cargar un body tardío tras logout.
            await page.evaluate(() => { __audit.sessionUser = 'usuario-ficticio-a'; __audit.blockDownload = true; __audit.callback('SIGNED_IN', { user: { id: __audit.sessionUser } }); });
            await page.waitForFunction(() => document.getElementById('informe-estado').dataset.estado === 'google_desconectado');
            await page.locator('#haiku-libro-google-conectar').click(); await page.waitForFunction(() => !!__audit.releaseDownload);
            await page.evaluate(() => { __audit.sessionUser = null; __audit.callback('SIGNED_OUT', null); __audit.releaseDownload(); });
            await page.waitForFunction(() => !HAIKU_LIBRO_GOOGLE_V1.estado().sincronizando);
            await page.waitForTimeout(100);
            assert.equal(await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.estado().cargado), false, 'body tardío de Connect tras logout');
            assert.equal(await page.locator('#informe-resultado').isVisible(), false);
            assert.deepEqual(errors, []); assert.deepEqual(externos, []);
            assert.equal(await page.evaluate(() => __audit.idb), 0); assert.deepEqual(await page.evaluate(() => __audit.storage), []);
            assert.equal(new URL(page.url()).search, ''); assert.equal(new URL(page.url()).hash, '');
            console.log('PASS 4B.3 ' + width + 'px: página /Proyecto-H/, XLSX/worker/núcleo reales, M2 antes de mostrar, contadores DTO, acordeones, ' + dtos.length + ' casos canónicos de renderer, desconocidos/escape, 0 writers/IDB/storage/PII en logs o URL, error M2 y cambio de usuario descartan resultados.');
            await context.close();
        }
    } finally { await browser?.close(); await new Promise(ok => server.close(ok)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
