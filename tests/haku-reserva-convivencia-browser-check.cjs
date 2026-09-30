// Browser check local con Edge + CDP nativo. No instala dependencias ni conecta con Supabase.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const fixture = path.join(root, "tests", "fixtures", "haku-reserva-convivencia", "index.html");
const cloudbedsFixture = path.join(root, "tests", "fixtures", "cloudbeds-haku-tarifas-2e", "index.html");
const coordinator = fs.readFileSync(path.join(root, "js", "haiku-panel-coordinacion-v1.js"), "utf8");
const artifacts = process.env.HAIKU_BROWSER_ARTIFACTS
    || path.join(root, "tests", "artifacts", "haku-reserva-convivencia");

class CdpClient {
    constructor(url) {
        this.url = url;
        this.socket = null;
        this.sequence = 0;
        this.pending = new Map();
        this.waiters = new Map();
        this.listeners = new Map();
    }

    async connect() {
        this.socket = new WebSocket(this.url);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Timeout conectando CDP: ${this.url}`)), 10000);
            this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
            this.socket.addEventListener("error", error => { clearTimeout(timeout); reject(error); }, { once: true });
        });
        this.socket.addEventListener("message", event => this.receive(JSON.parse(String(event.data))));
        this.socket.addEventListener("close", () => {
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timeout);
                pending.reject(new Error(`CDP cerró la conexión durante ${pending.method}`));
            }
            this.pending.clear();
        });
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
        const waiter = this.waiters.get(message.method)?.shift();
        if (waiter) waiter(message.params || {});
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

function launchEdge(profile) {
    assert.equal(fs.existsSync(edge), true, `Edge disponible en ${edge}`);
    const process = childProcess.spawn(edge, [
        "--headless", "--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox",
        "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
        "--allow-file-access-from-files",
        "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

    const endpoint = new Promise((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(() => reject(new Error(`Edge no publicó CDP. ${output}`)), 15000);
        process.stderr.setEncoding("utf8");
        process.stderr.on("data", chunk => {
            output += chunk;
            const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) { clearTimeout(timeout); resolve(match[1]); }
        });
        process.once("exit", code => {
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
        const page = targets.find(target => target.type === "page");
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        await new Promise(resolve => setTimeout(resolve, 30));
    } while (Date.now() < deadline);
    throw new Error("Edge no expuso una página CDP");
}

async function evaluate(client, expression) {
    const result = await client.call("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description
            || result.exceptionDetails.text
            || "Error evaluando JavaScript en la fixture");
    }
    return result.result?.value;
}

async function waitFor(client, expression, message) {
    const deadline = Date.now() + 4000;
    do {
        if (await evaluate(client, `Boolean(${expression})`)) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error(`Timeout: ${message}`);
}

async function viewport(client, width, height) {
    await client.call("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 1, mobile: width <= 600
    });
    await evaluate(client, "window.dispatchEvent(new Event('resize'))");
}

async function click(client, selector) {
    const clicked = await evaluate(client, `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        element.click();
        return true;
    })()`);
    assert.equal(clicked, true, `elemento disponible para click: ${selector}`);
}

async function pointerClick(client, selector) {
    const point = await evaluate(client, `(() => {
        const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
        return rect && { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(point, `elemento visible para click real: ${selector}`);
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function wheel(client, selector, deltaY) {
    const point = await evaluate(client, `(() => {
        const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
        return rect && { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(point, `elemento visible para rueda: ${selector}`);
    await client.call("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY, pointerType: "mouse"
    });
}

async function dragScrollbar(client, selector) {
    const track = await evaluate(client, `(() => {
        const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
        return rect && {
            x: rect.right - 3,
            fromY: rect.top + 12,
            toY: rect.top + rect.height * .72
        };
    })()`);
    assert.ok(track, `scrollbar disponible para arrastre: ${selector}`);
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: track.x, y: track.fromY });
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: track.x, y: track.fromY, button: "left", clickCount: 1 });
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: track.x, y: track.toY, button: "left" });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: track.x, y: track.toY, button: "left", clickCount: 1 });
}

async function escape(client) {
    await evaluate(client, `document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true
    }))`);
}

async function openHaku(client) {
    if (!await evaluate(client, "window.HAIKU_ASISTENTE.abierta()")) {
        await click(client, "#haiku-asistente-boton");
    }
    await waitFor(client, "document.body.classList.contains('haiku-panel-abierto')", "Haku abierto");
}

async function openReservation(client, id) {
    await evaluate(client, `window.HAIKU_PANELES_V1.abrirReserva(${JSON.stringify(id)})`);
    await waitFor(client, "document.body.classList.contains('haiku-ficha-reserva-abierta')", "ficha abierta");
}

async function closeReservation(client) {
    await click(client, "[data-reserva-cerrar]");
    await waitFor(client, "!document.body.classList.contains('haiku-ficha-reserva-abierta')", "ficha cerrada");
}

async function sideBySide(client, label) {
    const boxes = await evaluate(client, `(() => {
        const haku = document.getElementById("haiku-asistente-panel").getBoundingClientRect();
        const wrapper = document.getElementById("sites-resumen-reserva-drawer");
        const ficha = wrapper.querySelector(":scope > .sites-resumen-drawer-panel").getBoundingClientRect();
        const principal = document.getElementById("contenido-principal").getBoundingClientRect();
        const point = document.elementFromPoint(haku.left + 20, 80);
        const puntoPrincipal = document.elementFromPoint(Math.max(4, principal.right - 20), 120);
        const estilosWrapper = getComputedStyle(wrapper);
        const estilosPrincipal = getComputedStyle(document.getElementById("contenido-principal"));
        return {
            haku: { left: haku.left, right: haku.right, width: haku.width },
            ficha: { left: ficha.left, right: ficha.right, width: ficha.width },
            principal: { left: principal.left, right: principal.right, width: principal.width },
            hakuReceivesPointer: Boolean(point?.closest("#haiku-asistente-panel")),
            principalReceivesPointer: Boolean(puntoPrincipal?.closest("#contenido-principal")),
            wrapperBackground: estilosWrapper.backgroundColor,
            wrapperOpacity: estilosWrapper.opacity,
            wrapperBackdrop: estilosWrapper.backdropFilter || estilosWrapper.webkitBackdropFilter,
            principalBackground: estilosPrincipal.backgroundColor,
            bodyOverflow: document.body.style.overflow,
            mode: window.HAIKU_PANELES_V1.estado().modo
        };
    })()`);
    assert.equal(boxes.mode, "lado-a-lado", `${label}: modo coordinado`);
    assert.ok(boxes.ficha.right <= boxes.haku.left + 1,
        `${label}: ficha (${boxes.ficha.right}) a la izquierda de Haku (${boxes.haku.left})`);
    assert.ok(boxes.principal.right <= boxes.ficha.left + 1,
        `${label}: contenido (${boxes.principal.right}) termina antes de la ficha (${boxes.ficha.left})`);
    assert.ok(boxes.ficha.width >= 260, `${label}: ficha con ancho útil`);
    assert.ok(boxes.principal.width >= 300, `${label}: contenido principal conserva espacio útil`);
    assert.equal(boxes.hakuReceivesPointer, true, `${label}: backdrop no cubre Haku`);
    assert.equal(boxes.principalReceivesPointer, true, `${label}: ningún backdrop intercepta el contenido`);
    assert.equal(boxes.wrapperBackground, "rgb(255, 255, 255)", `${label}: sin capa oscura`);
    assert.equal(boxes.wrapperOpacity, "1", `${label}: sin atenuación por opacity`);
    assert.ok(boxes.wrapperBackdrop === "none" || boxes.wrapperBackdrop === "",
        `${label}: sin backdrop-filter`);
    assert.equal(boxes.principalBackground, "rgb(238, 243, 239)", `${label}: colores normales del contenido`);
    assert.notEqual(boxes.bodyOverflow, "hidden", `${label}: scroll principal desbloqueado`);
    assert.equal(await evaluate(client,
        "document.querySelector('#sites-resumen-reserva-drawer > [role=dialog]').getAttribute('aria-modal')"),
    "false", `${label}: ambas superficies siguen accesibles`);
}

async function screenshot(client, name) {
    fs.mkdirSync(artifacts, { recursive: true });
    const result = await client.call("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: false
    });
    fs.writeFileSync(path.join(artifacts, name), Buffer.from(result.data, "base64"));
}

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "haiku-paneles-cdp-"));
    const launched = launchEdge(profile);
    let page;
    let browser;
    const runtimeErrors = [];
    try {
        const browserUrl = await launched.endpoint;
        browser = new CdpClient(browserUrl);
        await browser.connect();
        page = new CdpClient(await pageEndpoint(browserUrl));
        await page.connect();
        page.on("Runtime.exceptionThrown", params => runtimeErrors.push(
            params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Error de página"
        ));
        await page.call("Runtime.enable");
        await page.call("Page.enable");
        await viewport(page, 1500, 900);

        const loaded = page.waitEvent("Page.loadEventFired");
        await page.call("Page.navigate", { url: pathToFileURL(fixture).href });
        await loaded;
        await waitFor(page, "window.HAIKU_PANELES_V1 && window.HAIKU_ASISTENTE", "módulos cargados");
        assert.equal(await evaluate(page, "window.HAIKU_INSPECTOR_V1 === window.HAIKU_PANELES_V1"), true,
            "la API general y el alias compatible comparten una sola autoridad");
        assert.deepEqual(await evaluate(page, "[...window.HAIKU_PANELES_V1.TIPOS_INSPECTOR]"),
            ["reserva", "pago", "servicio", "solicitud", "aseo"]);

        // La ficha sola también se acopla: contenido activo, sin backdrop oscuro.
        await openReservation(page, "SIN-HAKU");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().modo"), "independiente");
        assert.equal(await evaluate(page, "document.querySelector('[data-haiku-volver-haku]').getClientRects().length"), 0);
        assert.equal(await evaluate(page,
            "document.querySelector('#sites-resumen-reserva-drawer > [role=dialog]').getAttribute('aria-modal')"), "false");
        const fichaSola = await evaluate(page, `(() => {
            const ficha = document.getElementById("sites-resumen-reserva-drawer").getBoundingClientRect();
            const principal = document.getElementById("contenido-principal").getBoundingClientRect();
            const style = getComputedStyle(document.getElementById("sites-resumen-reserva-drawer"));
            return {
                ficha: { left: ficha.left, right: ficha.right, width: ficha.width },
                principal: { left: principal.left, right: principal.right, width: principal.width },
                background: style.backgroundColor,
                overflow: document.body.style.overflow
            };
        })()`);
        assert.ok(fichaSola.ficha.width >= 500 && fichaSola.ficha.width <= 571);
        assert.ok(fichaSola.principal.right <= fichaSola.ficha.left + 1);
        assert.equal(fichaSola.background, "rgb(255, 255, 255)");
        assert.notEqual(fichaSola.overflow, "hidden");
        await pointerClick(page, "#demo-accion-principal");
        assert.equal(await evaluate(page, "document.getElementById('demo-accion-conteo').value"), "1");
        assert.equal(await evaluate(page, "!document.getElementById('sites-resumen-reserva-drawer').hidden"), true);
        await closeReservation(page);

        // Haku fijado no intercepta el contenido principal.
        await openHaku(page);
        await pointerClick(page, "#demo-accion-principal");
        assert.equal(await evaluate(page, "document.getElementById('demo-accion-conteo').value"), "2");
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-overlay').hidden"), true);

        await waitFor(page, "document.getElementById('haiku-asistente-mensajes').textContent.includes('Contexto ficticio de Haku 28')",
            "contexto ficticio de Haku preparado");
        const hakuCorto = await evaluate(page, `(() => {
            const messages = document.getElementById("haiku-asistente-mensajes");
            [...messages.children].slice(1).forEach(child => { child.hidden = true; });
            messages.scrollTop = 0;
            return { scrollHeight: messages.scrollHeight, clientHeight: messages.clientHeight };
        })()`);
        assert.ok(hakuCorto.scrollHeight <= hakuCorto.clientHeight + 1,
            "el contenido corto no crea un segundo desplazamiento");
        await evaluate(page, `[...document.getElementById("haiku-asistente-mensajes").children]
            .forEach(child => { child.hidden = false; })`);
        const hakuScrollLayout = await evaluate(page, `(() => {
            const messages = document.getElementById("haiku-asistente-mensajes");
            const panel = document.getElementById("haiku-asistente-panel").getBoundingClientRect();
            const header = document.querySelector(".haiku-asistente-cabecera").getBoundingClientRect();
            const footer = document.querySelector(".haiku-asistente-pie").getBoundingClientRect();
            const style = getComputedStyle(messages);
            return {
                overflowY: style.overflowY,
                scrollbarWidth: style.scrollbarWidth,
                scrollHeight: messages.scrollHeight,
                clientHeight: messages.clientHeight,
                panelTop: panel.top,
                panelBottom: panel.bottom,
                headerTop: header.top,
                footerBottom: footer.bottom,
                pageTop: window.scrollY
            };
        })()`);
        assert.equal(hakuScrollLayout.overflowY, "auto");
        assert.equal(hakuScrollLayout.scrollbarWidth, "thin");
        assert.ok(hakuScrollLayout.scrollHeight > hakuScrollLayout.clientHeight + 500,
            "la conversaciÃ³n larga excede el scrollport de Haku");
        assert.ok(hakuScrollLayout.panelTop >= 0 && hakuScrollLayout.panelBottom <= 900,
            "Haku respeta el viewport de escritorio");

        await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop = 0");
        await wheel(page, "#haiku-asistente-mensajes", 620);
        await waitFor(page, "document.getElementById('haiku-asistente-mensajes').scrollTop > 100", "rueda desplaza Haku");
        assert.equal(await evaluate(page, "window.scrollY"), hakuScrollLayout.pageTop,
            "la rueda sobre Haku no desplaza la pÃ¡gina principal");
        assert.equal(await evaluate(page, "document.querySelector('.haiku-asistente-cabecera').getBoundingClientRect().top"), hakuScrollLayout.headerTop,
            "el encabezado permanece fijo al desplazar Haku");
        assert.equal(await evaluate(page, "document.querySelector('.haiku-asistente-pie').getBoundingClientRect().bottom"), hakuScrollLayout.footerBottom,
            "acciones rÃ¡pidas y compositor permanecen accesibles");
        await wheel(page, "#haiku-asistente-mensajes", -620);
        await waitFor(page, "document.getElementById('haiku-asistente-mensajes').scrollTop < 100", "rueda vuelve al inicio de Haku");

        await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop = 0");
        await dragScrollbar(page, "#haiku-asistente-mensajes");
        await waitFor(page, "document.getElementById('haiku-asistente-mensajes').scrollTop > 100", "barra arrastrable desplaza Haku");
        await evaluate(page, `(() => {
            const messages = document.getElementById("haiku-asistente-mensajes");
            document.getElementById("haiku-asistente-texto").value = "Borrador ficticio conservado";
            document.querySelector('[data-demo-haku-reserva="A"]').scrollIntoView({ block: "center" });
        })()`);
        const initialScroll = await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop");

        // El buscador superior abre la reserva histórica exacta, no la reserva actual de la misma CAB 1.
        await evaluate(page, `(() => {
            const input = document.getElementById("busqueda-reservas");
            input.value = "Antonia";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        assert.equal(await evaluate(page, "!document.querySelector('[data-demo-buscador=\"A\"]').hidden"), true);
        assert.equal(await evaluate(page, "document.querySelector('[data-demo-buscador=\"ACTUAL\"]').hidden"), true);
        await pointerClick(page, "[data-demo-buscador='A']");
        await waitFor(page, `window.HAIKU_PANELES_V1.estado().entidadInspector === ${JSON.stringify("11111111-1111-4111-8111-111111111111")}`,
            "reserva histórica abierta desde el buscador");
        assert.deepEqual(await evaluate(page, "window.__demoOpenArgs.at(-1)"), {
            id: "11111111-1111-4111-8111-111111111111",
            seleccion: { estadiaId:"22222222-2222-4222-8222-222222222222", numeroCabana:"1" },
            origenHaku: false
        });
        assert.match(await evaluate(page, "document.getElementById('demo-reserva-id').textContent"), /febrero 2024/);
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-texto').value"), "Borrador ficticio conservado");
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop"), initialScroll);
        await screenshot(page, "desktop-buscador-historico-1500x900.png");

        // A -> B desde el buscador reutiliza la ficha y deja la multiestadía al selector seguro.
        await evaluate(page, `(() => {
            const input = document.getElementById("busqueda-reservas");
            input.value = "Bruno";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        await pointerClick(page, "[data-demo-buscador='B']");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().entidadInspector"),
            "33333333-3333-4333-8333-333333333333");
        assert.equal(await evaluate(page, "document.getElementById('sites-resumen-reserva-drawer') === window.__demoDrawerIdentity"), true);
        assert.equal(await evaluate(page, "document.querySelectorAll('[data-haiku-inspector-superficie]:not([hidden])').length"), 1);
        assert.equal(await evaluate(page, "document.getElementById('demo-reserva-selector').hidden"), false);
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop"), initialScroll);

        // La reserva actual de la misma CAB 1 también abre por su propio UUID, nunca por la cabaña compartida.
        await evaluate(page, `(() => {
            const input = document.getElementById("busqueda-reservas");
            input.value = "Carolina";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        await pointerClick(page, "[data-demo-buscador='ACTUAL']");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().entidadInspector"),
            "66666666-6666-4666-8666-666666666666");
        assert.deepEqual(await evaluate(page, "window.__demoOpenArgs.at(-1)"), {
            id: "66666666-6666-4666-8666-666666666666",
            seleccion: { estadiaId:"77777777-7777-4777-8777-777777777777", numeroCabana:"1" },
            origenHaku: false
        });
        assert.equal(await evaluate(page, "document.getElementById('sites-resumen-reserva-drawer') === window.__demoDrawerIdentity"), true);
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-texto').value"), "Borrador ficticio conservado");
        await closeReservation(page);

        // El pago ficticio abre por reserva_id aunque no exista fila activa del Resumen.
        assert.equal(await evaluate(page, "document.querySelectorAll('.sites-resumen-cabana').length"), 0);
        await pointerClick(page, "[data-demo-haku-reserva='A']");
        const reservaHakuA = await evaluate(page, "window.__demoReservasHaku.A");
        await waitFor(page, `window.HAIKU_PANELES_V1.estado().entidadInspector === ${JSON.stringify("11111111-1111-4111-8111-111111111111")}`,
            "reserva A abierta desde el pago de Haku");
        assert.deepEqual(reservaHakuA, {
            reservaId: "11111111-1111-4111-8111-111111111111",
            estadiaId: "22222222-2222-4222-8222-222222222222",
            numeroCabana: "1",
            etiqueta: "Antonia Histórica · febrero 2024"
        });
        assert.deepEqual(await evaluate(page, "window.__demoOpenArgs.at(-1)"), {
            id: reservaHakuA.reservaId,
            seleccion: { estadiaId:reservaHakuA.estadiaId, numeroCabana:"1" },
            origenHaku: true
        });
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-texto').value"), "Borrador ficticio conservado");
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop"), initialScroll);
        assert.equal(await evaluate(page, "document.querySelectorAll('[data-haiku-inspector-superficie]:not([hidden])').length"), 1);

        // A -> B reemplaza contenido en la misma instancia; B conserva el selector multiestadía.
        await evaluate(page, "document.querySelector('[data-demo-haku-reserva=\"B\"]').scrollIntoView({ block: 'center' })");
        const scrollAntesB = await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop");
        await pointerClick(page, "[data-demo-haku-reserva='B']");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().entidadInspector"),
            "33333333-3333-4333-8333-333333333333");
        assert.equal(await evaluate(page, "document.getElementById('sites-resumen-reserva-drawer') === window.__demoDrawerIdentity"), true);
        assert.equal(await evaluate(page, "document.querySelectorAll('[data-haiku-inspector-superficie]:not([hidden])').length"), 1);
        assert.equal(await evaluate(page, "document.getElementById('demo-reserva-selector').hidden"), false);
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop"), scrollAntesB);
        await closeReservation(page);
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);
        await evaluate(page, `document.getElementById('haiku-asistente-mensajes').scrollTop = ${initialScroll}`);

        await pointerClick(page, "[data-demo-reserva='A']");
        await waitFor(page, "document.body.classList.contains('haiku-ficha-reserva-abierta')", "reserva A abierta desde contenido");
        await sideBySide(page, "escritorio ancho");
        assert.equal(await evaluate(page, "document.body.classList.contains('haiku-inspector-abierto')"), true);
        assert.deepEqual(await evaluate(page, "window.HAIKU_PANELES_V1.estado().inspector"),
            { tipo: "reserva", entidadId: "A" });
        const superficiesAntesScrollHaku = await evaluate(page, `(() => ({
            pagina: window.scrollY,
            inspector: document.querySelector(".sites-resumen-drawer-body").scrollTop
        }))()`);
        await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop = 0");
        await wheel(page, "#haiku-asistente-mensajes", 420);
        await waitFor(page, "document.getElementById('haiku-asistente-mensajes').scrollTop > 80", "Haku desplaza con Inspector abierto");
        assert.deepEqual(await evaluate(page, `(() => ({
            pagina: window.scrollY,
            inspector: document.querySelector(".sites-resumen-drawer-body").scrollTop
        }))()`), superficiesAntesScrollHaku, "principal e Inspector no se desplazan con la rueda sobre Haku");
        assert.equal(await evaluate(page, "!document.getElementById('sites-resumen-reserva-drawer').hidden"), true);
        await evaluate(page, `document.getElementById('haiku-asistente-mensajes').scrollTop = ${initialScroll}`);
        await pointerClick(page, "#demo-accion-principal");
        assert.equal(await evaluate(page, "document.getElementById('demo-accion-conteo').value"), "3");
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);
        assert.equal(await evaluate(page, "!document.getElementById('sites-resumen-reserva-drawer').hidden"), true);
        const mensajePagoNoDisponible = await evaluate(page, `window.HAIKU_PANELES_V1
            .abrirInspector({ tipo: "pago", entidadId: "PAGO-DEMO" })
            .then(() => "").catch(error => error.message)`);
        assert.match(mensajePagoNoDisponible, /todavía no tiene una vista registrada/,
            "pago está preparado sin inventar un detalle financiero");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().entidadInspector"), "A");

        // La navegación principal cambia sólo la zona izquierda y conserva Inspector + Haku.
        await pointerClick(page, "[data-demo-seccion='pagos']");
        assert.equal(await evaluate(page, "document.getElementById('demo-seccion-actual').textContent"), "Pagos");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().entidadInspector"), "A");
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);
        await screenshot(page, "desktop-pagos-inspector-1500x900.png");
        await pointerClick(page, "[data-demo-vista='pagos'] [data-demo-accion-seccion]");
        await pointerClick(page, "[data-demo-seccion='servicios']");
        assert.equal(await evaluate(page, "document.getElementById('demo-seccion-actual').textContent"), "Servicios");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().entidadInspector"), "A");
        await pointerClick(page, "[data-demo-vista='servicios'] [data-demo-accion-seccion]");
        await pointerClick(page, "[data-demo-seccion='libro']");
        assert.equal(await evaluate(page, "document.getElementById('demo-seccion-actual').textContent"), "Libro");
        assert.equal(await evaluate(page, "document.getElementById('demo-accion-conteo').value"), "5");
        assert.equal(await evaluate(page, "document.querySelectorAll('[data-haiku-inspector-superficie]:not([hidden])').length"), 1);
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-texto').value"), "Borrador ficticio conservado");
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop"), initialScroll);

        await evaluate(page, `(() => {
            const libro = document.getElementById("demo-libro-scroll");
            libro.scrollTop = 210;
            libro.scrollLeft = 320;
            window.scrollTo(0, 130);
            document.querySelector("[data-demo-fila='R-03']").click();
        })()`);
        assert.ok(await evaluate(page, "document.getElementById('demo-libro-scroll').scrollTop") > 100,
            "scroll vertical del Libro disponible");
        assert.ok(await evaluate(page, "document.getElementById('demo-libro-scroll').scrollLeft") > 100,
            "scroll horizontal del Libro disponible");
        assert.ok(await evaluate(page, "window.scrollY") > 50, "scroll vertical principal disponible");
        assert.match(await evaluate(page, "document.getElementById('demo-seleccion').textContent"), /R-03/);
        assert.equal(await evaluate(page, `(() => {
            const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
            document.dispatchEvent(event);
            return event.defaultPrevented;
        })()`), false, "Tab queda libre entre ficha y Haku en escritorio");
        await screenshot(page, "desktop-1500x900.png");

        // A -> B reutiliza el mismo drawer y no altera conversación, borrador ni scroll de Haku.
        await pointerClick(page, "[data-demo-reserva='B']");
        assert.match(await evaluate(page, "document.getElementById('demo-reserva-id').textContent"), /B/);
        assert.equal(await evaluate(page, "document.getElementById('sites-resumen-reserva-drawer') === window.__demoDrawerIdentity"), true);
        assert.equal(await evaluate(page, "document.querySelectorAll('[data-haiku-inspector-superficie]:not([hidden])').length"), 1);
        assert.deepEqual(await evaluate(page, "window.HAIKU_PANELES_V1.estado().inspector"),
            { tipo: "reserva", entidadId: "B" });
        assert.match(await evaluate(page, "document.getElementById('haiku-asistente-mensajes').textContent"), /Contexto ficticio de Haku 28/);
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-texto').value"), "Borrador ficticio conservado");
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop"), initialScroll);
        await evaluate(page, "window.HAIKU_PANELES_V1.abrirInspector({ tipo: 'reserva', entidadId: 'C' }, { recordarActual: true })");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().entidadInspector"), "C");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().historialInspector"), 1);
        await evaluate(page, "window.HAIKU_PANELES_V1.volverInspector()");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().entidadInspector"), "B");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().historialInspector"), 0);
        assert.equal(await evaluate(page, "document.getElementById('sites-resumen-reserva-drawer') === window.__demoDrawerIdentity"), true);
        await closeReservation(page);
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);

        // Cerrar Haku conserva la ficha, expande el contenido y mantiene ambas superficies activas.
        await openReservation(page, "C");
        const anchoPrincipalConAmbos = await evaluate(page, "document.getElementById('contenido-principal').getBoundingClientRect().width");
        await click(page, "#haiku-asistente-cerrar");
        assert.equal(await evaluate(page, "!document.getElementById('sites-resumen-reserva-drawer').hidden"), true);
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().modo"), "independiente");
        assert.ok(await evaluate(page, "document.getElementById('sites-resumen-reserva-drawer').getBoundingClientRect().width") >= 500);
        assert.ok(await evaluate(page, "document.getElementById('contenido-principal').getBoundingClientRect().width") > anchoPrincipalConAmbos);
        await pointerClick(page, "#demo-accion-principal");
        assert.equal(await evaluate(page, "!document.getElementById('sites-resumen-reserva-drawer').hidden"), true);

        // Escape cierra primero la ficha. Otro modal activo protege a Haku.
        await openHaku(page);
        await escape(page);
        assert.equal(await evaluate(page, "document.getElementById('sites-resumen-reserva-drawer').hidden"), true);
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);
        await escape(page);
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), false);

        await openHaku(page);
        await evaluate(page, `(() => {
            const modal = document.createElement("div");
            modal.id = "modal-prioritario-prueba";
            modal.setAttribute("role", "dialog");
            modal.setAttribute("aria-modal", "true");
            Object.assign(modal.style, { position: "fixed", inset: "20px", display: "block" });
            document.body.appendChild(modal);
        })()`);
        await escape(page);
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);
        await evaluate(page, "document.getElementById('modal-prioritario-prueba').remove()");

        // Reinserción defensiva: un solo retorno y un solo listener de Escape.
        await evaluate(page, coordinator);
        assert.equal(await evaluate(page, "document.querySelectorAll('[data-haiku-volver-haku]').length"), 1);
        await openReservation(page, "ESCAPE-UNICO");
        const closuresBefore = await evaluate(page, "window.__demoCloseCalls");
        await escape(page);
        assert.equal(await evaluate(page, "window.__demoCloseCalls"), closuresBefore + 1);

        // Escritorio angosto conserva dos superficies reales sin solaparlas.
        await viewport(page, 1024, 768);
        await openReservation(page, "ANGOSTA");
        await sideBySide(page, "escritorio angosto");
        await pointerClick(page, "#demo-accion-principal");
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);
        assert.equal(await evaluate(page, "!document.getElementById('sites-resumen-reserva-drawer').hidden"), true);
        await closeReservation(page);

        // Móvil abre desde el pago de Haku, alterna vistas y ofrece retorno claro.
        await viewport(page, 390, 844);
        await evaluate(page, "document.querySelector('[data-demo-haku-reserva=\"A\"]').scrollIntoView({ block: 'center' })");
        await pointerClick(page, "[data-demo-haku-reserva='A']");
        await waitFor(page, "window.HAIKU_PANELES_V1.estado().inspectorAbierto", "reserva abierta desde Haku en móvil");
        assert.equal(await evaluate(page, "window.HAIKU_PANELES_V1.estado().modo"), "alternado");
        assert.equal(await evaluate(page,
            "document.querySelector('#sites-resumen-reserva-drawer > [role=dialog]').getAttribute('aria-modal')"), "true");
        assert.equal(await evaluate(page, `(() => {
            const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
            document.dispatchEvent(event);
            return event.defaultPrevented;
        })()`), true, "Tab permanece dentro de la ficha modal en móvil");
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-panel').hidden"), false);
        assert.equal(await evaluate(page, "getComputedStyle(document.getElementById('haiku-asistente-panel')).visibility"), "hidden");
        assert.equal(await evaluate(page, "document.querySelector('[data-haiku-volver-haku]').getClientRects().length > 0"), true);
        assert.match(await evaluate(page, "document.getElementById('haiku-asistente-mensajes').textContent"), /Contexto ficticio de Haku 28/);
        await screenshot(page, "mobile-390x844.png");
        await click(page, "[data-haiku-volver-haku]");
        await waitFor(page, "getComputedStyle(document.getElementById('haiku-asistente-panel')).visibility === 'visible'", "retorno a Haku");
        await waitFor(page, "document.activeElement === document.getElementById('haiku-asistente-texto')", "foco devuelto a Haku");
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), true);

        await openReservation(page, "MOVIL-SIN-HAKU");
        await evaluate(page, "window.HAIKU_ASISTENTE.cerrar()");
        await waitFor(page, "!document.body.classList.contains('haiku-paneles-convivencia')", "Haku cerrado con ficha activa");
        assert.equal(await evaluate(page, "!document.getElementById('sites-resumen-reserva-drawer').hidden"), true);
        assert.equal(await evaluate(page, "window.HAIKU_ASISTENTE.abierta()"), false);
        assert.equal(await evaluate(page, "document.querySelector('[data-haiku-volver-haku]').getClientRects().length"), 0);

        // Fixture Cloudbeds real del encargo: contenido largo, Inspector simultÃ¡neo y retorno mÃ³vil.
        await viewport(page, 1500, 900);
        const cloudbedsLoaded = page.waitEvent("Page.loadEventFired");
        await page.call("Page.navigate", { url: `${pathToFileURL(cloudbedsFixture).href}?inspector=1` });
        await cloudbedsLoaded;
        await waitFor(page, "window.DEMO_CLOUDBEDS_2E && window.HAIKU_ASISTENTE?.abierta()", "fixture Cloudbeds preparada");
        await waitFor(page, "document.body.classList.contains('haiku-inspector-abierto')", "Inspector Cloudbeds abierto");
        const cloudbedsScroll = await evaluate(page, `(() => {
            const messages = document.getElementById("haiku-asistente-mensajes");
            const panel = document.getElementById("haiku-asistente-panel").getBoundingClientRect();
            return {
                overflowY: getComputedStyle(messages).overflowY,
                scrollHeight: messages.scrollHeight,
                clientHeight: messages.clientHeight,
                panelTop: panel.top,
                panelBottom: panel.bottom,
                pageTop: window.scrollY,
                draft: document.getElementById("haiku-asistente-texto").value
            };
        })()`);
        assert.equal(cloudbedsScroll.overflowY, "auto");
        assert.ok(cloudbedsScroll.scrollHeight > cloudbedsScroll.clientHeight + 500,
            "la propuesta Cloudbeds extensa desborda el scrollport");
        assert.ok(cloudbedsScroll.panelTop >= 0 && cloudbedsScroll.panelBottom <= 900,
            "Haku Cloudbeds respeta la altura visible");
        assert.match(cloudbedsScroll.draft, /Borrador ficticio/);
        await evaluate(page, "document.getElementById('haiku-asistente-mensajes').scrollTop = 0");
        await screenshot(page, "cloudbeds-redesign-overview-desktop-1500x900.png");
        for (let index = 0; index < 10; index++) await wheel(page, "#haiku-asistente-mensajes", 900);
        await waitFor(page, `(() => {
            const messages = document.getElementById("haiku-asistente-mensajes");
            return messages.scrollTop >= messages.scrollHeight - messages.clientHeight - 2;
        })()`, "Cloudbeds llega al final de Haku");
        assert.equal(await evaluate(page, "window.scrollY"), cloudbedsScroll.pageTop);
        assert.equal(await evaluate(page, "!document.getElementById('sites-resumen-reserva-drawer').hidden"), true);
        assert.equal(await evaluate(page, "document.querySelector('.haiku-asistente-pie').getClientRects().length > 0"), true);
        for (let index = 0; index < 10; index++) await wheel(page, "#haiku-asistente-mensajes", -900);
        await waitFor(page, "document.getElementById('haiku-asistente-mensajes').scrollTop <= 1", "Cloudbeds vuelve al inicio de Haku");
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-texto').value"), cloudbedsScroll.draft);

        // W1: la preview simulada habilita la confirmación; cancelar no ejecuta el writer.
        await evaluate(page, "document.querySelector('[data-cloudbeds-seleccionar]').scrollIntoView({ block: 'center' })");
        await pointerClick(page, "[data-cloudbeds-seleccionar]");
        await evaluate(page, "document.querySelector('[data-cloudbeds-abrir-confirmacion]').scrollIntoView({ block: 'center' })");
        await pointerClick(page, "[data-cloudbeds-abrir-confirmacion]");
        assert.equal(await evaluate(page, "document.querySelector('[data-cloudbeds-confirmacion]').hidden"), false);
        assert.match(await evaluate(page, "document.querySelector('[data-cloudbeds-confirmacion]').textContent"),
            /Actualizar tarifa[\s\S]*Alojamiento actual[\s\S]*Alojamiento Cloudbeds[\s\S]*Pagado actual[\s\S]*Saldo esperado/);
        assert.equal(await evaluate(page, "document.querySelector('[data-cloudbeds-confirmar]').disabled"), false);
        assert.equal(await evaluate(page, "window.CLOUDBEDS_TARIFAS_WRITER_HABILITADO"), true);
        await evaluate(page, "document.querySelector('[data-cloudbeds-confirmacion]').scrollIntoView({ block: 'center' })");
        await screenshot(page, "cloudbeds-w1-confirmacion-desktop-1500x900.png");
        await pointerClick(page, "[data-cloudbeds-cancelar]");

        // Post-write: usa la reconsulta real del fixture, conserva un único Inspector y persiste hasta cerrar.
        await evaluate(page, "document.querySelector('[data-cloudbeds-item=\"r-fd-a\"] [data-cloudbeds-actualizar]').scrollIntoView({ block: 'center' })");
        await pointerClick(page, "[data-cloudbeds-item=\"r-fd-a\"] [data-cloudbeds-actualizar]");
        await waitFor(page, `(() => {
            const confirmacion = document.querySelector("[data-cloudbeds-confirmacion]");
            const confirmar = document.querySelector("[data-cloudbeds-confirmar]");
            return confirmacion && !confirmacion.hidden && confirmar && !confirmar.disabled;
        })()`, "preview Full Day lista para confirmar");
        const escritoresAntes = await evaluate(page, "window.DEMO_CLOUDBEDS_2E.llamadas.filter(item => item === 'rpc:haiku_aplicar_tarifas_cloudbeds_v1').length");
        await evaluate(page, `(() => {
            const confirmar = document.querySelector("[data-cloudbeds-confirmar]");
            confirmar.click();
            confirmar.click();
            return true;
        })()`);
        await waitFor(page, "document.querySelector('[data-cloudbeds-post-write].haiku-cloudbeds-tarifas-post-write--exito')", "confirmación post-write visible");
        const postWrite = await evaluate(page, `(() => {
            const tarjeta = document.querySelector("[data-cloudbeds-post-write]");
            const panel = document.getElementById("haiku-asistente-panel").getBoundingClientRect();
            const rect = tarjeta.getBoundingClientRect();
            const saldo = window.DEMO_CLOUDBEDS_2E.saldos.find(item => item.reserva_id === "r-fd-a");
            return {
                texto: tarjeta.textContent,
                panelLeft: panel.left,
                panelRight: panel.right,
                left: rect.left,
                right: rect.right,
                total: saldo.total_alojamiento,
                pagado: saldo.pagado_alojamiento,
                saldo: saldo.saldo_alojamiento,
                escritores: window.DEMO_CLOUDBEDS_2E.llamadas.filter(item => item === "rpc:haiku_aplicar_tarifas_cloudbeds_v1").length,
                coincide: Boolean(document.querySelector('[data-cloudbeds-categoria="SIN_CAMBIO"] [data-cloudbeds-item="r-fd-a"]')),
                drawers: document.querySelectorAll("#sites-resumen-reserva-drawer").length
            };
        })()`);
        assert.match(postWrite.texto, /Tarifa actualizada correctamente/);
        assert.match(postWrite.texto, /Proyecto H[\s\S]*\$160\.000[\s\S]*\$120\.000/);
        assert.match(postWrite.texto, /Pagado[\s\S]*\$120\.000/);
        assert.match(postWrite.texto, /Saldo[\s\S]*\$0/);
        assert.match(postWrite.texto, /La reserva fue reconsultada y el cambio quedó registrado/);
        assert.equal(postWrite.total, 120000);
        assert.equal(postWrite.pagado, 120000);
        assert.equal(postWrite.saldo, 0);
        assert.equal(postWrite.escritores, escritoresAntes + 1, "el doble clic ejecuta una sola escritura");
        assert.equal(postWrite.coincide, true, "SIN_CAMBIO proviene de la reconstrucción del informe");
        assert.equal(postWrite.drawers, 1, "se conserva el Inspector único");
        assert.ok(postWrite.left >= postWrite.panelLeft && postWrite.right <= postWrite.panelRight,
            "la tarjeta de éxito cabe dentro de Haku");
        await evaluate(page, "document.querySelector('[data-cloudbeds-post-write]').scrollIntoView({ block: 'center' })");
        await screenshot(page, "cloudbeds-w1-exito-desktop-1500x900.png");

        await pointerClick(page, "[data-cloudbeds-post-write-ver-reserva]");
        await waitFor(page, "document.getElementById('sites-resumen-reserva-drawer').dataset.haikuInspectorEntidadId === 'r-fd-a'", "éxito abre el Inspector existente");

        await viewport(page, 980, 850);
        const postWriteAngosto = await evaluate(page, `(() => {
            const tarjeta = document.querySelector("[data-cloudbeds-post-write]");
            return { clientWidth: tarjeta.clientWidth, scrollWidth: tarjeta.scrollWidth, visible: tarjeta.getClientRects().length > 0 };
        })()`);
        assert.equal(postWriteAngosto.visible, true);
        assert.ok(postWriteAngosto.scrollWidth <= postWriteAngosto.clientWidth + 1,
            "la tarjeta no desborda en panel angosto");
        await screenshot(page, "cloudbeds-redesign-panel-angosto-980x850.png");

        await viewport(page, 390, 844);
        assert.equal(await evaluate(page, "getComputedStyle(document.getElementById('haiku-asistente-panel')).visibility"), "hidden");
        assert.equal(await evaluate(page, "document.querySelector('[data-haiku-volver-haku]').getClientRects().length > 0"), true);
        await click(page, "[data-haiku-volver-haku]");
        await waitFor(page, "getComputedStyle(document.getElementById('haiku-asistente-panel')).visibility === 'visible'", "Cloudbeds vuelve a Haku en mÃ³vil");
        assert.equal(await evaluate(page, "document.querySelector('[data-cloudbeds-post-write]').getClientRects().length > 0"), true);
        const postWriteMobile = await evaluate(page, `(() => {
            const tarjeta = document.querySelector("[data-cloudbeds-post-write]");
            return { clientWidth: tarjeta.clientWidth, scrollWidth: tarjeta.scrollWidth };
        })()`);
        assert.ok(postWriteMobile.scrollWidth <= postWriteMobile.clientWidth + 1,
            "la tarjeta no desborda en móvil");
        await evaluate(page, "document.querySelector('[data-cloudbeds-post-write]').scrollIntoView({ block: 'center' })");
        await screenshot(page, "cloudbeds-w1-exito-mobile-390x844.png");
        await pointerClick(page, "[data-cloudbeds-post-write-cerrar]");
        assert.equal(await evaluate(page, "Boolean(document.querySelector('[data-cloudbeds-post-write]'))"), false);
        const cloudbedsMobile = await evaluate(page, `(() => {
            const panel = document.getElementById("haiku-asistente-panel").getBoundingClientRect();
            return { top: panel.top, bottom: panel.bottom, viewport: innerHeight };
        })()`);
        assert.ok(cloudbedsMobile.top >= 0 && cloudbedsMobile.bottom <= cloudbedsMobile.viewport,
            "Haku mÃ³vil queda dentro del viewport");
        await wheel(page, "#haiku-asistente-mensajes", 500);
        await waitFor(page, "document.getElementById('haiku-asistente-mensajes').scrollTop > 50", "Cloudbeds desplaza Haku en mÃ³vil");
        assert.equal(await evaluate(page, "document.getElementById('haiku-asistente-texto').value"), cloudbedsScroll.draft);

        assert.deepEqual(runtimeErrors, []);
        console.log("Inspector + Haku: navegación persistente, desktop ancho/angosto, móvil y estado OK");
    } finally {
        try { await browser?.call("Browser.close"); } catch { launched.process.kill(); }
        page?.close();
        browser?.close();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
