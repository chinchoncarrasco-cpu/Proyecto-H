// Validación visual local y determinista con Edge + CDP nativo. No conecta a Supabase.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const fixture = path.join(__dirname, "fixtures", "reserva-estados-colores", "index.html");

class CdpClient {
    constructor(url) { this.url = url; this.sequence = 0; this.pending = new Map(); }
    async connect() {
        this.socket = new WebSocket(this.url);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout conectando CDP")), 10000);
            this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
            this.socket.addEventListener("error", error => { clearTimeout(timeout); reject(error); }, { once: true });
        });
        this.socket.addEventListener("message", evento => {
            const mensaje = JSON.parse(String(evento.data));
            if (!mensaje.id || !this.pending.has(mensaje.id)) return;
            const pendiente = this.pending.get(mensaje.id);
            this.pending.delete(mensaje.id);
            clearTimeout(pendiente.timeout);
            if (mensaje.error) pendiente.reject(new Error(`${pendiente.method}: ${mensaje.error.message}`));
            else pendiente.resolve(mensaje.result || {});
        });
    }
    call(method, params = {}) {
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 30000);
            this.pending.set(id, { method, resolve, reject, timeout });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }
    close() { this.socket?.close(); }
}

function iniciarEdge(profile) {
    assert.equal(fs.existsSync(edge), true, `Edge disponible en ${edge}`);
    const proceso = childProcess.spawn(edge, ["--headless", "--no-sandbox", "--disable-gpu",
        "--allow-file-access-from-files", "--no-first-run", "--remote-debugging-port=0",
        `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const endpoint = new Promise((resolve, reject) => {
        let salida = "";
        const timeout = setTimeout(() => reject(new Error(`Edge no publicó CDP. ${salida}`)), 15000);
        proceso.stderr.setEncoding("utf8");
        proceso.stderr.on("data", tramo => {
            salida += tramo;
            const hallado = salida.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (hallado) { clearTimeout(timeout); resolve(hallado[1]); }
        });
    });
    return { proceso, endpoint };
}

async function paginaEndpoint(browserEndpoint) {
    const { port } = new URL(browserEndpoint);
    const objetivos = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    return objetivos.find(objetivo => objetivo.type === "page").webSocketDebuggerUrl;
}

async function evaluar(client, expression) {
    const resultado = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (resultado.exceptionDetails) throw new Error(resultado.exceptionDetails.exception?.description || "Error en fixture");
    return resultado.result?.value;
}

async function viewport(client, width) {
    await client.call("Emulation.setDeviceMetricsOverride", {
        width, height: 844, deviceScaleFactor: 1, mobile: width <= 600
    });
    await evaluar(client, "window.dispatchEvent(new Event('resize'))");
}

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "haiku-estados-cdp-"));
    const edgeProceso = iniciarEdge(profile);
    let client;
    try {
        client = new CdpClient(await paginaEndpoint(await edgeProceso.endpoint));
        await client.connect();
        await client.call("Page.enable");
        await client.call("Runtime.enable");
        await client.call("Page.navigate", { url: pathToFileURL(fixture).href });
        const limite = Date.now() + 5000;
        while (!(await evaluar(client, "document.readyState === 'complete'"))) {
            if (Date.now() > limite) throw new Error("Timeout cargando fixture");
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(await evaluar(client, "document.querySelectorAll('.demo-badges .ficha-estado').length"), 6);
        assert.deepEqual(await evaluar(client, `(() => { const e=document.querySelector('.ficha-estado-checkout');
            return {fondo:getComputedStyle(e).backgroundColor,texto:getComputedStyle(e).color}; })()`),
        { fondo: "rgb(160, 160, 160)", texto: "rgb(255, 255, 255)" });
        assert.equal(await evaluar(client, `(() => { const s=document.getElementById('demo-estado');
            s.value='no_show'; s.dispatchEvent(new Event('change',{bubbles:true}));
            const b=document.getElementById('demo-badge'); return b.className+'|'+b.textContent; })()`),
        "ficha-estado ficha-estado-no-show|● No Show");
        const flujo = await evaluar(client, `(() => { const e=document.querySelector('.demo-caso .sites-resumen-flujo');
            const s=getComputedStyle(e); return {slant:s.getPropertyValue('--flow-slant').trim(),
                overflow:s.overflow,isolation:s.isolation}; })()`);
        assert.deepEqual(flujo, { slant: "8px", overflow: "hidden", isolation: "isolate" });
        const geometria = await evaluar(client, `(() => { const n=[...document.querySelector('.demo-caso')
            .querySelectorAll('.sites-resumen-dia')]; return n.map(e => { const caja=getComputedStyle(e);
            const antes=getComputedStyle(e,'::before'); const despues=getComputedStyle(e,'::after');
            const rect=e.getBoundingClientRect(); return {fondo:caja.backgroundImage+caja.backgroundColor,
                clip:caja.clipPath,z:caja.zIndex,margen:caja.marginLeft,ancho:rect.width,
                izquierda:rect.left,derecha:rect.right,bordeClip:antes.clipPath,
                bordeAncho:antes.width,bordePointer:antes.pointerEvents,
                despuesContenido:despues.content,despuesTransform:despues.transform}; }); })()`);
        assert.equal(new Set(geometria.map(item => item.fondo)).size, 3);
        assert.deepEqual(geometria.map(item => item.clip.startsWith("polygon(")), [true, true, true]);
        assert.deepEqual(geometria.map(item => item.z), ["3", "2", "1"]);
        assert.deepEqual(geometria.map(item => item.margen), ["0px", "-8px", "-8px"]);
        assert.ok(Math.abs((geometria[0].derecha - geometria[1].izquierda) - 8) < 0.1,
            "HOY solapa AYER exactamente 8 px");
        assert.ok(Math.abs((geometria[1].derecha - geometria[2].izquierda) - 8) < 0.1,
            "MANANA solapa HOY exactamente 8 px");
        assert.deepEqual(geometria.map(item => item.bordeClip.startsWith("polygon(")), [false, true, true]);
        assert.deepEqual(geometria.slice(1).map(item => item.bordeAncho), ["9px", "9px"]);
        assert.deepEqual(geometria.slice(1).map(item => item.bordePointer), ["none", "none"]);
        assert.deepEqual(geometria.map(item => item.despuesTransform), ["none", "none", "none"]);
        assert.equal(await evaluar(client, "document.querySelector('.sites-resumen-flujo-fondos') === null"), true);
        const continuidad = await evaluar(client, `(() => [...[...document.querySelectorAll('.demo-caso')][1]
            .querySelectorAll('.sites-resumen-dia')].map(e => { const p=getComputedStyle(e);
            return p.backgroundImage+p.backgroundColor; }))()`);
        assert.equal(new Set(continuidad).size, 1, "una reserva continua conserva el mismo fondo en los tres segmentos originales");
        const recambio = await evaluar(client, `(() => { const caso=[...document.querySelectorAll('.demo-caso')][2];
            const hoy=caso.querySelector('.sites-resumen-dia--actual');
            const manana=caso.querySelector('.sites-resumen-dia--siguiente');
            return {texto:hoy.querySelector('.sites-resumen-dia-valor').textContent,
                estado:hoy.dataset.reservaEstado,secundario:hoy.hasAttribute('data-reserva-estado-secundario'),
                fondoHoy:getComputedStyle(hoy).backgroundImage+getComputedStyle(hoy).backgroundColor,
                fondoManana:getComputedStyle(manana).backgroundImage+getComputedStyle(manana).backgroundColor}; })()`);
        assert.equal(recambio.texto, "Ingresa · Sofía");
        assert.equal(recambio.estado, "pendiente");
        assert.equal(recambio.secundario, false);
        assert.equal(recambio.fondoHoy, recambio.fondoManana);
        assert.equal(await evaluar(client, "document.querySelector('.demo-caso:last-child [data-reserva-estado]') === null"), true);
        for (const width of [1440, 980, 390]) {
            await viewport(client, width);
            const medidas = await evaluar(client, `({ancho:document.documentElement.clientWidth,
                scroll:document.documentElement.scrollWidth,bandas:[...document.querySelectorAll('.sites-resumen-flujo')]
                .every(e=>e.getBoundingClientRect().width<=e.parentElement.getBoundingClientRect().width+1)})`);
            assert.ok(medidas.scroll <= medidas.ancho, `${width}px: sin scroll horizontal global`);
            assert.equal(medidas.bandas, true, `${width}px: franjas contenidas`);
        }
        console.log("Estados de reserva: desktop 1440/980 y móvil 390 px correctos; recambio con un único ingreso y color aprobado.");
        if (process.env.HAIKU_CAPTURE_ESTADOS === "1") {
            await viewport(client, 1440);
            const capturaDesktop = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
            const destinoDesktop = path.join(__dirname, "artifacts", "reserva-estados-colores-diagonales.png");
            fs.mkdirSync(path.dirname(destinoDesktop), { recursive: true });
            fs.writeFileSync(destinoDesktop, Buffer.from(capturaDesktop.data, "base64"));
            await viewport(client, 390);
            const capturaMobile = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
            const destinoMobile = path.join(__dirname, "artifacts", "reserva-estados-colores-diagonales-mobile.png");
            fs.writeFileSync(destinoMobile, Buffer.from(capturaMobile.data, "base64"));
            console.log(`Capturas visuales: ${destinoDesktop} | ${destinoMobile}`);
        }
    } finally {
        try { await client?.call("Browser.close"); } catch { edgeProceso.proceso.kill(); }
        client?.close();
        if (edgeProceso.proceso.exitCode == null) {
            await Promise.race([
                new Promise(resolve => edgeProceso.proceso.once("exit", resolve)),
                new Promise(resolve => setTimeout(resolve, 1500))
            ]);
        }
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
