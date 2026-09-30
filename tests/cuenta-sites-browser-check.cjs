// Verificación visual/funcional local de Cuenta con Edge + CDP nativo.
// Usa datos ficticios y no conecta con Supabase.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const fixture = path.join(root, 'tests', 'fixtures', 'cuenta-sites', 'index.html');
const artifacts = process.env.HAIKU_CUENTA_ARTIFACTS || path.join(root, 'tests', 'artifacts', 'cuenta-sites');

class CdpClient {
    constructor(url) {
        this.url = url;
        this.socket = null;
        this.sequence = 0;
        this.pending = new Map();
        this.listeners = new Map();
    }

    async connect() {
        this.socket = new WebSocket(this.url);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Timeout conectando CDP: ${this.url}`)), 10000);
            this.socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
            this.socket.addEventListener('error', error => { clearTimeout(timeout); reject(error); }, { once: true });
        });
        this.socket.addEventListener('message', event => this.receive(JSON.parse(String(event.data))));
    }

    receive(message) {
        if (message.id) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            clearTimeout(pending.timeout);
            if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
            else pending.resolve(message.result || {});
            return;
        }
        for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    }

    call(method, params = {}) {
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Timeout CDP durante ${method}`));
            }, 30000);
            this.pending.set(id, { method, resolve, reject, timeout });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    on(method, listener) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(listener);
    }

    close() { this.socket?.close(); }
}

function launchEdge(profile) {
    assert.equal(fs.existsSync(edge), true, `Edge disponible en ${edge}`);
    const process = childProcess.spawn(edge, [
        '--headless', '--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox',
        '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
        '--allow-file-access-from-files', '--no-first-run', '--remote-debugging-port=0',
        `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

    const endpoint = new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error(`Edge no publicó CDP. ${output}`)), 15000);
        process.stderr.setEncoding('utf8');
        process.stderr.on('data', chunk => {
            output += chunk;
            const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) { clearTimeout(timeout); resolve(match[1]); }
        });
        process.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`Edge terminó antes de iniciar CDP (${code}). ${output}`));
        });
    });
    return { process, endpoint };
}

async function pageEndpoint(browserEndpoint) {
    const { port } = new URL(browserEndpoint);
    const deadline = Date.now() + 5000;
    do {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
        const page = targets.find(target => target.type === 'page');
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        await new Promise(resolve => setTimeout(resolve, 30));
    } while (Date.now() < deadline);
    throw new Error('Edge no expuso una página CDP');
}

async function evaluate(client, expression) {
    const result = await client.call('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description
            || result.exceptionDetails.text
            || 'Error evaluando JavaScript en la fixture');
    }
    return result.result?.value;
}

async function waitFor(client, expression, message) {
    const deadline = Date.now() + 5000;
    do {
        if (await evaluate(client, `Boolean(${expression})`)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new Error(`Timeout: ${message}`);
}

async function viewport(client, width, height) {
    await client.call('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width <= 600
    });
    await evaluate(client, "window.dispatchEvent(new Event('resize'))");
}

async function click(client, selector) {
    const clicked = await evaluate(client, `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        if (typeof element.focus === 'function') element.focus();
        element.click();
        return true;
    })()`);
    assert.equal(clicked, true, `elemento disponible para click: ${selector}`);
}

async function escape(client) {
    await evaluate(client, `document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true
    }))`);
}

async function wheel(client, selector, deltaY) {
    const point = await evaluate(client, `(() => {
        const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
        return rect && { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(point, `elemento disponible para rueda: ${selector}`);
    await client.call('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY, pointerType: 'mouse'
    });
}

async function screenshot(client, name) {
    if (!process.env.HAIKU_CUENTA_ARTIFACTS) return;
    fs.mkdirSync(artifacts, { recursive: true });
    const result = await client.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(artifacts, name), Buffer.from(result.data, 'base64'));
}

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-cuenta-cdp-'));
    const launched = launchEdge(profile);
    let browser;
    let page;
    try {
        const browserEndpoint = await launched.endpoint;
        browser = new CdpClient(browserEndpoint);
        await browser.connect();
        page = new CdpClient(await pageEndpoint(browserEndpoint));
        await page.connect();
        await Promise.all([page.call('Page.enable'), page.call('Runtime.enable')]);
        await viewport(page, 1440, 900);

        const errors = [];
        page.on('Runtime.exceptionThrown', params => errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text));
        await page.call('Page.navigate', { url: pathToFileURL(fixture).href });
        await waitFor(page, "document.readyState === 'complete' && Boolean(document.getElementById('haiku-cuenta-menu-boton'))", 'Cuenta instalada');

        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-menu-panel').hidden"), true);
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-menu-boton').getAttribute('aria-expanded')"), 'false');

        await click(page, '#haiku-cuenta-menu-boton');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-menu-panel').hidden"), false);
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-fondo').hidden"), false);
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-menu-boton').getAttribute('aria-expanded')"), 'true');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-nombre').textContent"), 'Felipe Revisión');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-email').textContent"), 'felipe.fixture@example.invalid');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-badge-rol').textContent"), 'Operador de turno');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-badge-estado').textContent"), 'Activo');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-avatar').textContent"), 'FR');
        assert.equal(await evaluate(page, "document.querySelectorAll('#haiku-cuenta-permisos-lista > span').length"), 12);

        const desktop = await evaluate(page, `(() => {
            const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
            const drawer = document.getElementById('haiku-cuenta-menu-panel').getBoundingClientRect();
            const fondo = document.getElementById('haiku-cuenta-fondo').getBoundingClientRect();
            return {
                sidebarRight: sidebar.right, drawerLeft: drawer.left, drawerHeight: drawer.height,
                fondoLeft: fondo.left,
                fondoColor: getComputedStyle(document.getElementById('haiku-cuenta-fondo')).backgroundColor,
                viewportHeight: innerHeight, bodyLocked: getComputedStyle(document.body).overflow
            };
        })()`);
        assert.ok(Math.abs(desktop.drawerLeft - desktop.sidebarRight) <= 1, JSON.stringify(desktop));
        assert.ok(Math.abs(desktop.fondoLeft - desktop.sidebarRight) <= 1, JSON.stringify(desktop));
        assert.ok(Math.abs(desktop.drawerHeight - desktop.viewportHeight) <= 1, JSON.stringify(desktop));
        assert.notEqual(desktop.fondoColor, 'rgba(0, 0, 0, 0)');
        assert.equal(desktop.bodyLocked, 'hidden');
        await screenshot(page, 'cuenta-desktop-1440x900.png');

        await click(page, '#haiku-cuenta-volver');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-menu-panel').hidden"), true);
        await click(page, '#haiku-cuenta-menu-boton');
        await escape(page);
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-menu-panel').hidden"), true);
        assert.equal(await evaluate(page, 'document.activeElement?.id'), 'haiku-cuenta-menu-boton');

        await evaluate(page, `(() => {
            window.haikuSesion.usuario = { nombre: 'Catalina', apellido: 'Dinámica', activo: true };
            window.haikuSesion.auth.email = 'catalina.dynamic@example.invalid';
            window.dispatchEvent(new CustomEvent('haiku:auth-ready', { detail: window.haikuSesion }));
        })()`);
        await click(page, '#haiku-cuenta-menu-boton');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-nombre').textContent"), 'Catalina Dinámica');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-email').textContent"), 'catalina.dynamic@example.invalid');
        await click(page, '#haiku-cuenta-fondo');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-menu-panel').hidden"), true);

        await viewport(page, 980, 620);
        await click(page, '#haiku-cuenta-menu-boton');
        const scroll = await evaluate(page, `(() => {
            const element = document.getElementById('haiku-cuenta-scroll');
            return { top: element.scrollTop, client: element.clientHeight, total: element.scrollHeight,
                overflow: getComputedStyle(element).overflowY };
        })()`);
        assert.ok(scroll.total > scroll.client, JSON.stringify(scroll));
        assert.equal(scroll.overflow, 'auto');
        await wheel(page, '#haiku-cuenta-scroll', 700);
        await waitFor(page, "document.getElementById('haiku-cuenta-scroll').scrollTop > 0", 'scroll interno de Cuenta');
        await screenshot(page, 'cuenta-desktop-angosto-980x620.png');
        await click(page, '#haiku-cuenta-volver');

        await viewport(page, 390, 844);
        await evaluate(page, 'window.HAIKU_AUTH_MENU_V1.abrir()');
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-scroll').scrollTop"), 0);
        const mobile = await evaluate(page, `(() => {
            const drawer = document.getElementById('haiku-cuenta-menu-panel').getBoundingClientRect();
            const title = document.getElementById('haiku-cuenta-titulo');
            const titleRect = title.getBoundingClientRect();
            const top = document.elementFromPoint(8, 120);
            return { left: drawer.left, top: drawer.top, width: drawer.width, height: drawer.height,
                viewportWidth: innerWidth, viewportHeight: innerHeight,
                ownsViewport: Boolean(top?.closest('#haiku-cuenta-menu-panel')),
                documentWidth: document.documentElement.scrollWidth,
                title: { text: title.textContent, top: titleRect.top, height: titleRect.height,
                    color: getComputedStyle(title).color, display: getComputedStyle(title).display } };
        })()`);
        assert.ok(Math.abs(mobile.left) <= 1 && Math.abs(mobile.top) <= 1, JSON.stringify(mobile));
        assert.ok(Math.abs(mobile.width - mobile.viewportWidth) <= 1, JSON.stringify(mobile));
        assert.ok(Math.abs(mobile.height - mobile.viewportHeight) <= 1, JSON.stringify(mobile));
        assert.equal(mobile.ownsViewport, true);
        assert.ok(mobile.documentWidth <= mobile.viewportWidth + 1, JSON.stringify(mobile));
        assert.equal(mobile.title.text, 'Cuenta');
        assert.ok(mobile.title.top >= 0 && mobile.title.height > 10, JSON.stringify(mobile));
        await screenshot(page, 'cuenta-mobile-390x844.png');
        await click(page, '#haiku-cuenta-volver');

        await viewport(page, 1440, 900);
        await click(page, '#haiku-cuenta-menu-boton');
        await click(page, '#haiku-cuenta-menu-salir');
        assert.equal(await evaluate(page, 'window.__logoutClicks'), 1);
        assert.equal(await evaluate(page, "document.getElementById('haiku-cuenta-menu-panel').hidden"), true);
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-panel-fixture').dataset.estado"), 'conservado');
        assert.equal(await evaluate(page, "document.getElementById('sites-resumen-reserva-drawer-fixture').dataset.estado"), 'conservado');
        assert.deepEqual(errors, []);

        console.log('Cuenta Sites: datos dinámicos, drawer, scroll, cierre, logout, desktop y móvil OK');
    } finally {
        try { await browser?.call('Browser.close'); } catch { launched.process.kill(); }
        page?.close();
        browser?.close();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
