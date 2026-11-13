const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const raiz = path.join(__dirname, "..");
const estilosInforme = "/css/haku-cloudbeds-informes-v1.css";
const html = `<!doctype html><html lang="es"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/css/haiku-paleta-v1.css">
    <link rel="stylesheet" href="/css/supabase-asistente-v1.css">
    <link rel="stylesheet" href="/css/sites-asistente-v1.css">
    <link rel="stylesheet" href="/css/haku-mobile-assistant-v1.css">
    <style>body.haiku-panel-abierto .haiku-asistente-panel { width: min(470px, 100vw); }</style>
</head><body class="haiku-panel-abierto"><div class="haiku-asistente-root">
    <section class="haiku-asistente-panel"><div class="haiku-asistente-conversacion">
    <div id="mensajes" class="haiku-asistente-mensajes">
        <div id="informe" class="haiku-asistente-mensaje haiku-asistente-mensaje--asistente"></div>
    </div></div></section>
</div>
<script src="/js/haiku-cloudbeds-pdf-v1.js"></script>
<script src="/js/haiku-cloudbeds-informes-v1.js"></script>
<script src="/js/supabase-asistente-cloudbeds-informes-v1.js"></script>
</body></html>`;

const servidor = http.createServer((req, res) => {
    const ruta = new URL(req.url, "http://localhost").pathname;
    if (ruta === "/") return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
    if (!/^\/(js|css)\/[a-z0-9.-]+$/.test(ruta)) return res.writeHead(404).end();
    const tipo = ruta.endsWith(".js") ? "text/javascript" : "text/css";
    try { res.writeHead(200, { "Content-Type": tipo }).end(fs.readFileSync(path.join(raiz, ruta))); }
    catch { res.writeHead(404).end(); }
});

async function preparar(page, tema, movil) {
    await page.evaluate(async ({ tema, movil }) => {
        const html = document.documentElement;
        html.dataset.haikuTema = tema;
        if (movil) {
            html.dataset.hakuMobileAssistant = "1";
            html.classList.add("haku-mobile-assistant-ready");
        }
        window.haikuTienePermiso = permiso => permiso === "pagos.registrar";
        window.operaciones = [];
        window.HAIKU_INSPECTOR_V1 = { abrirReserva: (id, boton, seleccion) => {
            operaciones.push({ id, seleccion });
            return true;
        } };
        window.HAIKU_LIBRO_CONSULTAS = { prepararPagoInformeCloudbeds: async ({ destino }) => ({
            destinos: [{ nombre: "Alojamiento", saldo: 150000 }], medio: "WebPay crédito",
            confirmar: () => new Promise(resolve => {
                operaciones.push({ destino });
                window.resolverPago = () => resolve({ creado: true });
            })
        }) };
        const fecha = "2026-11-07", salida = "2026-11-08";
        const filas = Array.from({ length: 44 }, (_, i) => [0, 1, 2].map(j => {
            const destino = { reservaId: "r"+i, estadiaId: "e"+i, cabana: i%11+1, fecha };
            const estado = ["falta", "por_verificar", "coincide"][j];
            return { tipo: "pago", titular: "Titular de prueba "+(i+1), id: "900000"+i,
                entrada: fecha, salida, cabana: destino.cabana, medio: "webpay crédito", credito: 75000,
                registradoEn: fecha, comprobante: { fecha: "2026-11-0"+(5+j) },
                proyecto: { estado, detalle: "Comparación de prueba" },
                libro: { estado: "coincide", detalle: "Coincide con el comprobante del Libro" },
                origenes: [{ archivo: "Transacciones.xlsx", hoja: "Sheet1", fila: i*3+j+1 }],
                destino, pagoIncorporable: j === 0 ? { destino } : null };
        })).flat();
        await HAIKU_ASISTENTE_CLOUDBEDS_INFORMES_V1.montar(document.querySelector("#informe"), {
            filas, documentos: [], errores: [], hojas: ["Nov26"], proyectoDisponible: true,
            fuenteLibro: { generacion: 1 }, autor: "operador"
        });
    }, { tema, movil });
}

(async () => {
    await new Promise(resolve => servidor.listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:"+servidor.address().port;
    const browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_PATH, args: ["--no-sandbox"] });
    try {
        for (const width of [1440, 360]) for (const tema of ["claro", "oscuro"]) {
            const movil = width < 600;
            const page = await browser.newPage({ viewport: { width, height: 760 }, hasTouch: movil, isMobile: movil });
            const errores = [];
            let cargas = 0;
            page.on("pageerror", error => errores.push(error.message));
            await page.route("**/*", route => {
                if (!route.request().url().startsWith(origin+"/")) return route.abort();
                if (new URL(route.request().url()).pathname === estilosInforme) cargas++;
                return route.continue();
            });
            await page.goto(origin+"/");
            await preparar(page, tema, movil);
            const informe = page.locator("[data-cloudbeds-informes]");
            const grupos = informe.locator(".haku-cloudbeds-informes__grupo");
            const grupo = grupos.first();
            const resumen = grupo.locator(":scope > summary");
            const pagos = grupo.locator(".haku-cloudbeds-informes__fila");
            const filtro = informe.getByRole("combobox", { name: "Resultado de comparación" });
            assert.equal(await grupos.count(), 20);
            assert.equal(await pagos.count(), 0, "las filas cerradas no se construyen al cargar");
            await resumen.press("Enter");
            assert.equal(await pagos.count(), 3);
            assert.equal(await grupo.locator(".haku-cloudbeds-informes__detalle").count(), 0);
            await pagos.first().locator(":scope > summary").press("Space");
            await pagos.first().getByRole("button", { name: "Incorporar pago", exact: true }).click();
            const revision = pagos.first().locator(".haku-cloudbeds-informes__revision-pago");
            assert.match(await revision.innerText(), /Saldo después CLP \$75\.000/);
            assert.equal(await revision.evaluate(e => getComputedStyle(e).backgroundColor),
                tema === "oscuro" ? "rgb(40, 56, 47)" : "rgb(238, 244, 239)");
            assert.equal(await revision.locator(".haku-cloudbeds-informes__pago-resumen").evaluate(e => getComputedStyle(e).display), movil ? "block" : "grid");
            const cambios = await grupo.evaluate(async e => {
                const contenedor = e.querySelector(".haku-cloudbeds-informes__grupo-pagos");
                const pago = contenedor.firstElementChild;
                const cambios = [];
                const medir = new MutationObserver(registros => cambios.push(...registros));
                medir.observe(contenedor, { childList: true, subtree: true });
                for (let i = 0; i < 4; i++) {
                    e.querySelector("summary").click();
                    await new Promise(resolve => requestAnimationFrame(resolve));
                }
                medir.disconnect();
                return { cambios: cambios.length, mismaFila: contenedor.firstElementChild === pago, abierto: e.open };
            });
            assert.deepEqual(cambios, { cambios: 0, mismaFila: true, abierto: true });
            await filtro.selectOption("dudas");
            assert.equal(await pagos.count(), 1);
            await filtro.selectOption("todos");
            assert.equal(await pagos.count(), 3);
            const confirmar = revision.getByRole("button", { name: "Confirmar pago", exact: true });
            await confirmar.click();
            assert.equal(await filtro.isDisabled(), true);
            await resumen.click();
            await page.evaluate(() => resolverPago());
            await page.waitForFunction(() => !document.querySelector("[data-cloudbeds-informes]").shadowRoot.querySelector("select").disabled);
            await resumen.click();
            await pagos.first().getByText("Pago incorporado en Proyecto H.", { exact: true }).first().waitFor();
            assert.equal(await confirmar.count(), 0);
            await pagos.first().getByRole("button", { name: "Ver reserva", exact: true }).click();
            assert.equal(await page.evaluate(() => operaciones.at(-1).seleccion.estadiaId), "e0");
            assert.equal(await page.evaluate(() => operaciones.length), 2);
            while (await informe.getByRole("button", { name: "Mostrar más" }).isVisible()) {
                await informe.getByRole("button", { name: "Mostrar más" }).click();
            }
            assert.equal(await grupos.count(), 44);
            const mensajes = page.locator("#mensajes");
            await mensajes.evaluate(e => { e.scrollTop = 0; });
            const rect = await mensajes.boundingBox();
            assert.ok(rect);
            await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
            await page.mouse.wheel(0, 650);
            await page.waitForFunction(() => document.querySelector("#mensajes").scrollTop > 0);
            await page.mouse.wheel(0, -900);
            await page.waitForFunction(() => document.querySelector("#mensajes").scrollTop === 0);
            assert.equal(await mensajes.evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
            await preparar(page, tema, movil);
            assert.equal(cargas, 1, "el estilo del informe se carga una vez por sesión");
            assert.deepEqual(errores, []);
            await page.close();
            console.log("Cloudbeds · navegación comprobada a "+width+" px en tema "+tema);
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => servidor.close());
