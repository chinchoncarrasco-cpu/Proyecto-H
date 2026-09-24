// Browser check for the real Resumen markup, CSS and filter module.
// All operation, service and payment authorities are deterministic and read-only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const begin = html.indexOf('<section id="seccion-resumen"');
const end = html.indexOf('<section id="seccion-calendario"', begin);
assert.ok(begin >= 0 && end > begin, "Existe la sección real de Resumen");
const section = html.slice(begin, end);
const styles = ["css/styles.css", "css/sites-shell-v1.css", "css/sites-resumen-v1.css"]
    .map(read).join("\n");
const moduleSource = read("js/supabase-resumen-tablero-v1.js");
const cabinsSource = read("js/cabanas.js");
assert.doesNotMatch(cabinsSource, /inicializarResumenRapido\s*\(/,
    "El antiguo panel por pulsación sostenida debe estar retirado");

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const documentHTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}\nbody{margin:0}.browser-check{min-width:0;max-width:1800px;margin:auto}</style></head><body><main class="contenido sites-shell-main browser-check">${section}</main></body></html>`;

function serve() {
    const server = http.createServer((_request, response) => {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(documentHTML);
    });
    return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function installAuthorities(page) {
    await page.evaluate(() => {
        const current = "2026-09-23";
        const next = "2026-09-24";
        window.fechaSeleccionada = current;
        window.datosPorFecha = {};
        window.haikuSesion = { usuario: { id: "usuario-prueba" } };
        window.haikuTienePermiso = () => false;
        window.__readCalls = [];
        window.__writes = [];
        window.__operation = {
            [current]: { 1: "continua", 2: "libre-ingresa", 3: "sale-libre",
                4: "sale-ingresa", 5: "libre-libre" },
            [next]: { 1: "libre-libre", 2: "continua", 3: "libre-libre",
                4: "libre-libre", 5: "libre-ingresa" }
        };
        window.__payments = [{ numeroCabana: "3", monto: 18000 }];
        localStorage.setItem("haikuServicios", JSON.stringify([
            { id: "s1", fechaServicio: current, numeroCabana: "6", estadoServicio: "pendiente" },
            { id: "s2", fechaServicio: current, numeroCabana: "6", estadoServicio: "realizado" },
            { id: "s3", fechaServicio: current, numeroCabana: "7", estadoServicio: "cancelado" },
            { id: "s4", fechaServicio: next, numeroCabana: "8", estadoServicio: "pendiente" }
        ]));
        window.HAIKU_OPERACION_DIA_IDENTIDAD_V1 = {
            obtener(fecha, numero) {
                const estado = window.__operation[fecha]?.[numero] || "libre-libre";
                return { estado,
                    ingresaHoy: ["libre-ingresa", "sale-ingresa", "fullday"].includes(estado),
                    saleHoy: ["sale-libre", "sale-ingresa", "fullday", "sale-bloqueada"].includes(estado) };
            }
        };
        window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1 = {
            estaListo: () => true,
            obtener: fecha => fecha === current ? window.__payments.map(item => ({ ...item })) : []
        };
        window.haikuSupabase = {
            rpc(name, payload) {
                window.__readCalls.push({ name, fecha: payload.p_fecha });
                assertRead(name === "haiku_operacion_dia");
                const data = Object.entries(window.__operation[payload.p_fecha] || {})
                    .map(([numero, estado]) => ({ numero, estado_operativo: estado,
                        salida_estadia_id: estado === "sale-bloqueada" ? "salida-real" : null }));
                return Promise.resolve({ data, error: null });
            },
            from() { window.__writes.push("from"); throw Error("El filtro no consulta ni escribe tablas"); }
        };
        function assertRead(condition) { if (!condition) throw Error("RPC no autorizada en el harness"); }
        window.seleccionarDia = (_year, _month, _day, iso) => {
            window.fechaSeleccionada = iso;
            document.querySelectorAll("#seccion-resumen .sites-resumen-cabana[data-cabana]")
                .forEach(row => { row.dataset.resumenFecha = iso; });
            document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", { detail: { fecha: iso } }));
        };
        document.querySelectorAll("#seccion-resumen .sites-resumen-cabana[data-cabana]")
            .forEach(row => {
                row.dataset.resumenFecha = current;
                const state = row.querySelector('[data-campo="estado"]');
                if (state) state.value = "libre-libre"; // Deliberately misleading DOM text.
            });
    });
}

async function visibleNumbers(page) {
    return page.locator("#seccion-resumen .sites-resumen-cabana:visible")
        .evaluateAll(rows => rows.map(row => Number(row.dataset.cabana)));
}

async function assertFilter(page, type, expected) {
    await page.locator(`[data-resumen-filtro="${type}"]`).click();
    assert.deepEqual(await visibleNumbers(page), expected, type);
    assert.equal(await page.locator("#resumen-cabanas-conteo").innerText(),
        `${expected.length} de 11 cabañas`);
    assert.equal(await page.locator(`[data-resumen-filtro="${type}"]`).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('[data-resumen-filtro][aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator(".tarjeta-resumen-rapido-panel:visible").count(), 0);
    assert.equal(await page.locator('[role="dialog"]:visible').count(), 0);
}

(async () => {
    const server = await serve();
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, hasTouch: true });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        assert.equal(await page.locator("#seccion-resumen .sites-resumen-cabana").count(), 11);
        assert.deepEqual(await visibleNumbers(page), Array.from({ length: 11 }, (_, i) => i + 1));
        await installAuthorities(page);
        await page.addScriptTag({ content: moduleSource });
        await page.waitForFunction(() => window.HAIKU_RESUMEN_SITES_V1);
        await page.waitForFunction(() => window.__readCalls.some(call => call.fecha === "2026-09-23"));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => document.dispatchEvent(new CustomEvent("haiku:servicios-hidratados",
            { detail: { fecha: window.fechaSeleccionada } })));
        await page.evaluate(() => document.dispatchEvent(new CustomEvent("haiku:resumen-pagos-actualizados",
            { detail: { fecha: window.fechaSeleccionada } })));

        await assertFilter(page, "continuan", [1]);
        const activeBackground = await page.locator('[data-resumen-filtro="continuan"]')
            .evaluate(element => getComputedStyle(element).backgroundColor);
        assert.equal(activeBackground, "rgb(240, 246, 242)", "la tarjeta seleccionada usa el tinte Sites");
        await assertFilter(page, "ingresan", [2, 4]);
        await assertFilter(page, "salen", [3, 4]);
        await assertFilter(page, "servicios", [6]);
        await assertFilter(page, "pagos", [3]);
        await page.evaluate(() => {
            window.__payments = [{ tipo: "checkin", numeroCabana: "2", monto: 16000 }];
            document.dispatchEvent(new CustomEvent("haiku:resumen-pagos-actualizados",
                { detail: { fecha: window.fechaSeleccionada } }));
        });
        await page.waitForFunction(() => document.querySelector(
            '.sites-resumen-cabana[data-cabana="2"] .sites-resumen-celda--cobros .sites-resumen-valor'
        )?.textContent === "Saldo $16.000");
        assert.deepEqual(await visibleNumbers(page), [2], "el filtro y COBROS siguen el mismo pendiente");
        assert.equal(await page.locator('.sites-resumen-cabana[data-cabana="2"] .sites-resumen-celda--cobros .sites-resumen-subvalor')
            .innerText(), "Cobro pendiente de ingreso");

        await page.locator("#resumen-mostrar-todas").click();
        assert.deepEqual(await visibleNumbers(page), Array.from({ length: 11 }, (_, i) => i + 1));
        assert.equal(await page.locator("#resumen-cabanas-conteo").innerText(), "11 de 11 cabañas");
        assert.equal(await page.locator('[data-resumen-filtro][aria-pressed="true"]').count(), 0);
        assert.equal(await page.locator("#resumen-mostrar-todas").isHidden(), true);

        const incoming = page.locator('[data-resumen-filtro="ingresan"]');
        await incoming.focus();
        await incoming.press("Enter");
        assert.deepEqual(await visibleNumbers(page), [2, 4], "Enter activa la tarjeta");
        await incoming.press("Space");
        assert.deepEqual(await visibleNumbers(page), Array.from({ length: 11 }, (_, i) => i + 1),
            "Space desactiva la tarjeta activa");
        await page.locator('[data-resumen-filtro="salen"]').tap();
        assert.deepEqual(await visibleNumbers(page), [3, 4], "touch filtra las mismas filas");

        const rowFour = page.locator('.sites-resumen-cabana[data-cabana="4"]');
        await rowFour.locator('[data-resumen-expandir="4"]').click();
        assert.equal(await rowFour.locator("#sites-resumen-detalle-4").isVisible(), true,
            "Ver detalle conserva su comportamiento en una fila filtrada");
        assert.equal(await page.locator("#seccion-resumen .sites-resumen-cabana").count(), 11,
            "los filtros no duplican artículos");

        for (const width of [1600, 1200, 390]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.locator("#seccion-resumen").isVisible(), true, `Resumen ${width}px`);
            assert.deepEqual(await visibleNumbers(page), [3, 4], `filas visibles a ${width}px`);
            const geometry = await page.evaluate(() => ({
                viewport: innerWidth,
                page: document.documentElement.scrollWidth,
                metrics: [...document.querySelectorAll("#seccion-resumen [data-resumen-filtro]")]
                    .map(card => card.getBoundingClientRect().width)
            }));
            assert.ok(geometry.metrics.every(value => value > 0), `cinco tarjetas visibles a ${width}px`);
            assert.ok(geometry.page <= geometry.viewport + 1, `sin scroll horizontal a ${width}px`);
        }
        assert.deepEqual(await page.evaluate(() => window.__writes), []);
        assert.deepEqual(errors, []);
        console.log("Resumen métricas: Edge 1600/1200/390, clic, teclado, touch, CSS y detalle correctos.");
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
