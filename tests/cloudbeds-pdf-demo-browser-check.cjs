// Browser check local con Edge + CDP nativo. No instala dependencias ni usa Supabase.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const artifacts = path.join(os.tmpdir(), 'haiku-cloudbeds-pdf-2c-capturas');

class CdpClient {
  constructor(url) { this.url = url; this.socket = null; this.id = 0; this.pending = new Map(); this.waiters = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout CDP: ${this.url}`)), 10000);
      this.socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
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
    const eventKey = message.sessionId ? `${message.method}:${message.sessionId}` : message.method;
    for (const listener of this.listeners.get(eventKey) || []) listener(message.params || {});
    const waiter = this.waiters.get(eventKey)?.shift();
    if (waiter) waiter(message.params || {});
  }
  call(method, params = {}, sessionId = null) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout durante ${method}`)); }, 30000);
      this.pending.set(id, { method, resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  waitEvent(method) {
    return new Promise(resolve => {
      if (!this.waiters.has(method)) this.waiters.set(method, []);
      this.waiters.get(method).push(resolve);
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }
  close() { this.socket?.close(); }
}

class CdpSession {
  constructor(browser, sessionId) { this.browser = browser; this.sessionId = sessionId; }
  call(method, params = {}) { return this.browser.call(method, params, this.sessionId); }
  waitEvent(method) { return this.browser.waitEvent(`${method}:${this.sessionId}`); }
  on(method, listener) { return this.browser.on(`${method}:${this.sessionId}`, listener); }
  close() {}
}

function localServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    const relative = `${pathname.replace(/^\/+/, '')}${pathname.endsWith('/') ? 'index.html' : ''}`;
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return response.writeHead(404).end();
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function launchEdge(profile) {
  assert.equal(fs.existsSync(edge), true, `Edge disponible en ${edge}`);
  const process = childProcess.spawn(edge, [
    '--headless=new', '--disable-gpu', '--disable-gpu-sandbox', '--hide-scrollbars', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
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
    process.once('exit', code => { clearTimeout(timeout); reject(new Error(`Edge terminó antes de iniciar (${code}). ${output}`)); });
  });
  return { process, endpoint };
}

async function pageEndpoint(browserEndpoint, targetId) {
  const { port } = new URL(browserEndpoint);
  const deadline = Date.now() + 5000;
  do {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    const page = targets.find(target => target.id === targetId) || targets.find(target => target.type === 'page');
    if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (Date.now() < deadline);
  throw new Error('Edge no expuso una página CDP');
}

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
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
  await client.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 600 });
  await evaluate(client, "window.dispatchEvent(new Event('resize'))");
}

async function screenshot(client, name) {
  fs.mkdirSync(artifacts, { recursive: true });
  const result = await client.call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(artifacts, name), Buffer.from(result.data, 'base64'));
}

(async () => {
  const server = await localServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-cloudbeds-demo-'));
  const launched = launchEdge(profile);
  let browser, page;
  const runtimeErrors = [];
  try {
    const browserUrl = await launched.endpoint;
    browser = new CdpClient(browserUrl);
    await browser.connect();
    const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.call('Target.attachToTarget', { targetId, flatten: true });
    page = new CdpSession(browser, sessionId);
    page.on('Runtime.exceptionThrown', params => runtimeErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text));
    await page.call('Runtime.enable');
    await page.call('Page.enable');
    await viewport(page, 1440, 1000);
    const loaded = page.waitEvent('Page.loadEventFired');
    await page.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tests/fixtures/cloudbeds-pdf-flexible/` });
    await loaded;
    await waitFor(page, "document.querySelectorAll('#escenario option').length === 10", 'diez escenarios cargados');

    assert.equal(await evaluate(page, "document.getElementById('clase').textContent"), 'ALTA_CERTEZA');
    assert.equal(await evaluate(page, "document.getElementById('diferencia').textContent"), '-$16.000');
    assert.equal(await evaluate(page, "document.querySelector('.haiku-cloudbeds-informe button') === null"), true);
    assert.match(await evaluate(page, "document.getElementById('diagnostico').textContent"), /\"solo_lectura\": true/);
    await screenshot(page, 'desktop-caso-a-1440x1000.png');

    await evaluate(page, `(() => { const select = document.getElementById('escenario'); select.value = '7'; select.dispatchEvent(new Event('change')); })()`);
    assert.match(await evaluate(page, "document.getElementById('titulo').textContent"), /^H/);
    assert.equal(await evaluate(page, "document.getElementById('clase').textContent"), 'REVISION_MANUAL');
    assert.match(await evaluate(page, "document.getElementById('diagnostico').textContent"), /\"productos_columna_presente\": false/);

    await evaluate(page, `(() => { const select = document.getElementById('escenario'); select.value = '8'; select.dispatchEvent(new Event('change')); })()`);
    assert.match(await evaluate(page, "document.getElementById('titulo').textContent"), /^I/);
    assert.ok(await evaluate(page, "document.querySelectorAll('#encabezados th').length") >= 50);
    assert.ok(await evaluate(page, "document.querySelector('table').scrollWidth > document.querySelector('.table-scroll').clientWidth"));

    await viewport(page, 390, 844);
    await evaluate(page, `(() => { const select = document.getElementById('escenario'); select.value = '3'; select.dispatchEvent(new Event('change')); })()`);
    assert.match(await evaluate(page, "document.getElementById('titulo').textContent"), /^D/);
    assert.equal(await evaluate(page, "document.getElementById('clase').textContent"), 'ALTA_CERTEZA');
    assert.equal(await evaluate(page, "getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns"), '358px');
    await screenshot(page, 'mobile-caso-d-390x844.png');

    await evaluate(page, "document.getElementById('siguiente').click()");
    assert.match(await evaluate(page, "document.getElementById('titulo').textContent"), /^E/);
    assert.equal(await evaluate(page, "document.getElementById('clase').textContent"), 'NO_APLICA');
    assert.deepEqual(runtimeErrors, []);
    console.log(`PASS demo Cloudbeds 2C: A–J, desktop, móvil, certeza y PDF ancho. Capturas: ${artifacts}`);
  } finally {
    try { await browser?.call('Browser.close'); } catch { launched.process.kill(); }
    page?.close(); browser?.close();
    await new Promise(resolve => server.close(resolve));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
