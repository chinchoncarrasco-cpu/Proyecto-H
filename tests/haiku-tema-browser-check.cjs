// Chromium local, datos sintéticos y red externa bloqueada. No requiere sesión ni Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const { chromium } = require('playwright');
const setups = require('./fixtures/haiku-tema-v1.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const output = process.env.TEMA_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-tema-'));

async function panelSinDatos() {
    let html;
    const document = { createElement: () => ({}), head: { appendChild: s => s.onload() },
        open() {}, write: s => { html = s; }, close() {} };
    await vm.runInNewContext(read('panel.html').match(/<script>([\s\S]*)<\/script>/)[1], {
        document, window: { supabase: { createClient() {} } },
        fetch: async () => ({ ok: true, text: async () => read('index.html') }), Date, console
    });
    assert.equal((html.match(/src="js\/haiku-tema-v1.js/g) || []).length, 1);
    assert.equal((html.match(/href="css\/haiku-tema-oscuro-v1.css/g) || []).length, 1);
    assert.ok(html.indexOf('css/haiku-tema-oscuro') > html.indexOf('css/haiku-cuenta-redesign'));
    return html.replace(/<script\b[\s\S]*?<\/script>/g, '')
        .replace(/class="haiku-privacidad-arranque[^"]*"/, '')
        .replace('</head>', '<script src="/js/haiku-tema-v1.js"></script></head>')
        .replace('</body>', '<script src="/tests/fixtures/haiku-tema-resumen-v1.js"></script></body>');
}

function estadoVisual() {
    const visible = e => {
        const s = getComputedStyle(e), r = e.getBoundingClientRect();
        const cerrado = e.closest('details:not([open])');
        return !e.closest('.haiku-tema-control') && s.display !== 'none' && s.visibility !== 'hidden' &&
            r.width > 0 && r.height > 0 && (!cerrado || e === cerrado || e.closest('summary'));
    };
    return {
        cajas: [...document.querySelectorAll('body *')].filter(visible).map(e => {
            const r = e.getBoundingClientRect();
            return [e.id || e.className?.baseVal || e.className || e.tagName, ...['x','y','width','height'].map(k => Math.round(r[k]*100)/100)];
        }),
        campos: [...document.querySelectorAll('input,select,textarea')].map(e => [e.id,e.value,e.checked,e.disabled]),
        desplegables: [...document.querySelectorAll('details')].map(e => e.open),
        scroll: [...document.querySelectorAll('*')].filter(e => e.scrollTop || e.scrollLeft).map(e => [e.id,e.scrollTop,e.scrollLeft]),
        libro: [...document.querySelectorAll('#libro-reserva-visor table *')].map(e => {
            const s = getComputedStyle(e); return [e.textContent,s.color,s.backgroundColor,s.borderColor];
        })
    };
}

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const html = await panelSinDatos();
    const server = http.createServer((req,res) => {
        const u = new URL(req.url, 'http://localhost').pathname;
        if (u === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); return; }
        const file = path.resolve(root, '.' + decodeURIComponent(u));
        if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        try {
            res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
            res.end(fs.readFileSync(file));
        } catch (_) { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const results = [];
    try {
        for (const viewport of [{width:1600,height:1000},{width:390,height:844}]) {
            for (const [key, setup] of Object.entries(setups)) {
                const context = await browser.newContext({ viewport, timezoneId: 'America/Santiago' });
                await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
                const page = await context.newPage(), control = await context.newPage();
                const errors = []; page.on('pageerror', e => errors.push(e.message));
                await page.goto(url); await control.goto(url);
                if (!results.length) {
                    const invalid = await page.evaluate(() => {
                        const allowed = new Set(['color','background-color','background-image','border-color',
                            'border-top-color','border-right-color','border-bottom-color','border-left-color',
                            'outline-color','box-shadow','text-shadow','accent-color','fill','stroke','scrollbar-color']);
                        const errors = [];
                        function check(rules) { for (const r of rules) {
                            if (r.style) {
                                if (!r.selectorText.startsWith('html[data-haiku-tema="oscuro"]')) errors.push(r.selectorText);
                                for (const prop of r.style) if (!allowed.has(prop)) errors.push(prop);
                            }
                            if (r.cssRules) check(r.cssRules);
                        } }
                        const sheet = [...document.styleSheets].find(s => s.href?.includes('haiku-tema-oscuro-v1.css'));
                        check(sheet.cssRules); return errors;
                    });
                    assert.deepEqual(invalid, [], 'la hoja generada contiene sólo colores del tema oscuro');
                }
                await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' });
                await page.evaluate(key => {
                    const section = ['haku-inicio','haku-respuesta','notificaciones','cuenta','ficha-reserva'].includes(key) ? 'resumen' : key;
                    document.querySelectorAll('.seccion-app').forEach(e => { e.classList.toggle('activa',e.id === 'seccion-'+section); e.classList.remove('oculto'); });
                    document.querySelectorAll('.menu-item[data-seccion]').forEach(e => e.classList.toggle('activo',e.dataset.seccion === section));
                    window.fechaSeleccionada = '2026-10-22';
                }, key);
                await setup(page); await page.waitForTimeout(1200);
                const before = await page.evaluate(estadoVisual);
                await page.screenshot({ path: path.join(output, `${viewport.width}-${key}-claro.png`) });
                // Cambiar desde otra pestaña también cubre los diálogos modales: no se
                // fuerza un clic detrás de su overlay ni se modifica su gestión de foco.
                await (viewport.width === 1600 && key === 'cuenta' ? page : control).locator('#haiku-tema-boton').click();
                await page.waitForFunction(() => document.documentElement.dataset.haikuTema === 'oscuro');
                const after = await page.evaluate(estadoVisual);
                assert.deepEqual(after, before, `${viewport.width}/${key}: contenido, geometría, Libro y estado intactos`);
                const contrast = await page.evaluate(auditarContraste);
                assert.deepEqual(contrast, [], `${viewport.width}/${key}: contraste del texto visible`);
                await page.screenshot({ path: path.join(output, `${viewport.width}-${key}-oscuro.png`) });
                await control.locator('#haiku-tema-boton').click();
                await page.waitForFunction(() => document.documentElement.dataset.haikuTema === 'claro');
                assert.deepEqual(await page.evaluate(estadoVisual), before, `${key}: regreso a claro`);
                assert.deepEqual(errors, [], `${key}: errores del navegador`);
                results.push({ viewport: viewport.width, section: key, elements: before.cajas.length });
                console.log(`OK ${viewport.width} ${key}`);
                await context.close();
            }
        }
        const context = await browser.newContext({ timezoneId: 'America/Santiago' });
        const page = await context.newPage();
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
        for (const viewport of [{width:320,height:568},{width:1280,height:600}]) {
            await page.setViewportSize(viewport); await page.goto(url);
            const button = page.locator('#haiku-tema-boton');
            const rect = await button.boundingBox();
            assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x+rect.width <= viewport.width && rect.y+rect.height <= viewport.height);
            await button.focus(); await page.keyboard.press('Enter');
            assert.equal(await page.locator('html').getAttribute('data-haiku-tema'),'oscuro');
            await page.reload();
            assert.equal(await page.locator('html').getAttribute('data-haiku-tema'),'oscuro');
            await button.focus(); await page.keyboard.press('Space');
            assert.equal(await page.locator('html').getAttribute('data-haiku-tema'),'claro');
        }
        // Impresión: el tema oscuro queda fuera del medio print.
        await page.locator('#haiku-tema-boton').click();
        await page.emulateMedia({media:'print'});
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'normal');
        await context.close();
        fs.writeFileSync(path.join(output,'resultados.json'), JSON.stringify(results,null,2));
        console.log(`Aprobadas ${results.length} vistas + teclado, persistencia, tamaños reducidos e impresión. ${output}`);
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

function auditarContraste() {
    const rgb = s => {
        const a = s.match(/[\d.]+/g)?.map(Number) || [0,0,0,0];
        return s.startsWith('color(') ? a.map((v,i) => i < 3 ? v*255 : v) : a;
    };
    const mix = (a,b) => a.slice(0,3).map((v,i) => v*(a[3]??1)+b[i]*(1-(a[3]??1)));
    const luminance = a => a.slice(0,3).map(v => { v/=255; return v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4; })
        .reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
    const failures = [];
    for (const e of document.querySelectorAll('body *')) {
        if (e.closest('script,style,#libro-reserva-visor table') || !e.getClientRects().length || e.closest('details:not([open])') && !e.closest('summary')) continue;
        const s = getComputedStyle(e), r = e.getBoundingClientRect();
        if (s.visibility !== 'visible' || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !['INPUT','SELECT','TEXTAREA'].includes(e.tagName)) continue;
        const chain = []; let parent = e, disabled = false;
        while (parent) { const t = getComputedStyle(parent); if (+t.opacity < 1 || parent.disabled) disabled = true; chain.unshift(rgb(t.backgroundColor)); parent = parent.parentElement; }
        if (disabled) continue;
        let bg = [255,255,255]; for (const c of chain) bg = mix(c,bg);
        const a = luminance(mix(rgb(s.color),bg)), b = luminance(bg), ratio = (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        const size = parseFloat(s.fontSize), threshold = size >= 24 || size >= 18.66 && +s.fontWeight >= 700 ? 3 : 4.5;
        if (ratio < threshold-.05) failures.push({element:e.id || e.className, text:(e.innerText || e.value || '').slice(0,60), ratio});
    }
    return failures;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
