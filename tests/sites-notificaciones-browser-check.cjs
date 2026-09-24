// Contrato visual/funcional del Centro de notificaciones con fuentes deterministas.
// No hay conexión ni escrituras a Supabase.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const html = read("index.html");
const css = read("css/sites-notificaciones-v1.css");
assert.match(html, /id="panel-notificaciones"[^>]*\bhidden\b[^>]*\binert\b/);
assert.match(html, /id="sites-notificaciones-drawer"[^>]*role="dialog"[^>]*\bhidden\b/);
assert.match(css, /#panel-notificaciones\s*\{\s*display:\s*none\s*!important/);
assert.ok(html.indexOf('src="js/sites-pagos-v1.js"') < html.indexOf('src="js/sites-notificaciones-v1.js"'));
const panel = read("panel.html");
assert.match(panel, /scriptsSupabaseV2\}\\n<script src="js\/sites-pagos-v1\.js\?v=\$\{version\}/);
assert.match(panel, /sites-pagos-v1\.js\?v=\$\{version\}[\s\S]*sites-notificaciones-v1\.js\?v=\$\{version\}/);
assert.doesNotThrow(() => new Function(panel.match(/<script>([\s\S]*?)<\/script>/)[1]), "bootstrap válido");

const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) && file !== path.join(root, "index.html")) {
        response.writeHead(403).end(); return;
    }
    try {
        const content = fs.readFileSync(file);
        response.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
        response.end(content);
    } catch (_) { response.writeHead(404).end(); }
});

(async () => {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.route("**/js/**", route => route.abort());
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        assert.equal(await page.locator("#panel-notificaciones").isVisible(), false, "legacy oculto sin JS");
        assert.equal(await page.locator("#sites-notificaciones-drawer").isVisible(), false, "drawer cerrado sin JS");

        await page.evaluate(() => {
            window.fechaSeleccionada = "2026-09-23";
            window.__legacyClicks = 0;
            document.getElementById("boton-notificaciones").addEventListener("click", () => {
                window.__legacyClicks++;
                document.getElementById("panel-notificaciones").hidden = false;
            });
            window.__payments = [{ tipo: "checkin", reservaId: "R-pay", numeroCabana: "2", titular: "Pago real", monto: 16000 }];
            window.__boves = [{ tipo: "bove", reservaId: "R-bove", numeroCabana: "3", titular: "BOVE real" }];
            window.__calls = [];
            window.haikuSesion = { id: "user-test" };
            window.haikuTienePermiso = () => true;
            window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1 = {
                estaListo: () => true, obtener: () => window.__payments,
                refrescar: async () => { document.dispatchEvent(new Event("haiku:resumen-pagos-actualizados")); }
            };
            window.HAIKU_BOVES_PENDIENTES_SUPABASE_V1 = {
                estaListo: () => true, obtener: () => window.__boves, refrescar: async () => {}
            };
            const pagoDrawer = document.createElement("div");
            pagoDrawer.className = "sites-resumen-pago-drawer"; pagoDrawer.hidden = true;
            document.body.append(pagoDrawer);
            window.HAIKU_RESUMEN_PAGO_SITES_V1 = { abrirPagoReserva: async (...args) => {
                window.__calls.push(["pago", ...args.slice(0, 3)]); pagoDrawer.hidden = false;
            } };
            window.HAIKU_SITES_PAGOS_V1 = { refrescar: () => window.__calls.push(["refrescarPagos"]) };
            window.HAIKU_SITES_SERVICIOS_V1 = { refrescar: () => window.__calls.push(["refrescarServicios"]) };
            window.obtenerCheckinsPendientes = () => [{ numeroCabana: "4", titular: "Ingreso real", hora: "15:00", reservaId: "R-in" }];
            window.datosPorFecha = { "2026-09-23": { cabanas: { 4: { codigoHaiku: "H-2844", adultos: 2, ninos: 1 } } } };
            const servicios = [
                { id: "s1", fechaServicio: "2026-09-23", numeroCabana: "6", titular: "Servicio actual", nombre: "Masaje", hora: "17:00", categoria: "masaje", estadoServicio: "pendiente" },
                { id: "s2", fechaServicio: "2026-09-23", numeroCabana: "7", titular: "Servicio futuro", nombre: "Tinaja", hora: "19:00", categoria: "tinaja", estadoServicio: "pendiente" },
                { id: "s3", fechaServicio: "2026-09-23", numeroCabana: "8", titular: "Servicio realizado", nombre: "Desayuno", hora: "09:00", categoria: "desayuno", estadoServicio: "realizado" }
            ];
            localStorage.setItem("haikuServicios", JSON.stringify(servicios));
            window.haikuEstadoTemporalServicio = item => ({ clave: item.id === "s1" && item.estadoServicio === "pendiente" ? "actual" :
                item.estadoServicio === "realizado" ? "completada" : item.estadoServicio === "cancelado" ? "cancelada" : "pendiente" });
            function cambiarServicio(id, nuevoEstado) {
                const lista = JSON.parse(localStorage.getItem("haikuServicios"));
                lista.find(item => item.id === id).estadoServicio = nuevoEstado;
                localStorage.setItem("haikuServicios", JSON.stringify(lista));
                document.dispatchEvent(new Event("haiku:servicio-supabase-cambiado"));
            }
            window.__cambiarServicio = cambiarServicio;
            for (const id of ["sites-servicios-realizado", "sites-servicios-cancelar"]) {
                const modal = document.createElement("div"); modal.id = id; modal.hidden = true;
                document.body.append(modal);
            }
            const servicioMenu = document.createElement("button");
            servicioMenu.className = "menu-item"; servicioMenu.dataset.seccion = "servicios";
            servicioMenu.addEventListener("click", () => window.__calls.push(["menuServicios"]));
            document.body.append(servicioMenu);
            for (const [atributo, id, estado] of [
                ["data-sites-servicios-realizar", "s1", "realizado"],
                ["data-sites-servicios-cancelar", "s2", "cancelado"]
            ]) {
                const accion = document.createElement("button");
                accion.setAttribute(atributo, id);
                accion.addEventListener("click", () => {
                    window.__calls.push([atributo, id, estado]);
                    document.getElementById(estado === "realizado" ? "sites-servicios-realizado" : "sites-servicios-cancelar").hidden = false;
                });
                document.body.append(accion);
            }
            const menu = document.createElement("button");
            menu.className = "menu-item"; menu.dataset.seccion = "pagos";
            menu.addEventListener("click", () => window.__calls.push(["menuPagos"]));
            document.body.append(menu);
            const lista = document.createElement("div"); lista.id = "pagos-lista-checkin";
            lista.innerHTML = '<div class="haiku-saldo-v5" data-reserva-id="R-bove"><details class="sites-pagos-detalle"></details><button class="sites-pagos-abrir-bove">Registrar BOVE</button></div>';
            const boveDrawer = document.createElement("div");
            boveDrawer.className = "sites-pagos-bove"; boveDrawer.hidden = true;
            document.body.append(boveDrawer);
            lista.querySelector("button").addEventListener("click", () => {
                window.__calls.push(["bove", "R-bove"]); boveDrawer.hidden = false;
            });
            document.body.append(lista);
        });
        await page.addScriptTag({ content: read("js/sites-notificaciones-v1.js") });
        await page.addScriptTag({ content: read("js/sites-notificaciones-v1.js") }); // guardia contra listeners duplicados
        assert.equal(await page.locator("#contador-notificaciones").textContent(), "4");
        assert.equal(await page.locator("#contador-notificaciones").isVisible(), true);

        await page.locator("#boton-notificaciones").click();
        assert.equal(await page.locator("#sites-notificaciones-drawer").isVisible(), true);
        assert.equal(await page.locator("#sites-notificaciones-overlay").isVisible(), true);
        assert.equal(await page.locator("#panel-notificaciones").isVisible(), false);
        assert.equal(await page.evaluate(() => window.__legacyClicks), 0);
        assert.match(await page.locator("#sites-notificaciones-turno").textContent(), /23-09-26/);
        assert.match(await page.locator(".sites-notificaciones-total").textContent(), /4 asuntos/);
        assert.deepEqual(await page.locator(".sites-notificaciones-group-count").allTextContents(), ["3", "1", "1", "1"]);
        if (process.env.HAIKU_NOTIF_SCREENSHOT) {
            await page.screenshot({ path: process.env.HAIKU_NOTIF_SCREENSHOT });
        }

        await page.locator('[data-sites-noti-grupo="servicios"] summary').click();
        assert.equal(await page.locator('[data-sites-noti-grupo="servicios"]').getAttribute("open"), "");
        await page.locator('[data-sites-noti-accion="realizar"][data-sites-noti-clave="s1"]').first().click();
        await page.waitForFunction(() => !document.getElementById("sites-servicios-realizado").hidden);
        assert.equal(await page.locator("#sites-notificaciones-drawer").isVisible(), false);
        await page.evaluate(() => {
            window.__cambiarServicio("s1", "realizado");
            document.getElementById("sites-servicios-realizado").hidden = true;
        });
        await page.waitForFunction(() => document.getElementById("contador-notificaciones").textContent === "3" &&
            !document.getElementById("sites-notificaciones-drawer").hidden);
        assert.equal(await page.locator('[data-sites-noti-grupo="servicios"]').getAttribute("open"), "");
        assert.ok((await page.locator('[data-sites-noti-grupo="servicios"]').textContent()).includes("✓ Realizado"));
        await page.locator('[data-sites-noti-accion="cancelar"][data-sites-noti-clave="s2"]').click();
        await page.waitForFunction(() => !document.getElementById("sites-servicios-cancelar").hidden);
        await page.evaluate(() => {
            window.__cambiarServicio("s2", "cancelado");
            document.getElementById("sites-servicios-cancelar").hidden = true;
        });
        await page.waitForFunction(() => !document.getElementById("sites-notificaciones-drawer").hidden);
        assert.ok((await page.locator('[data-sites-noti-grupo="servicios"]').textContent()).includes("Cancelado"));

        await page.locator('[data-sites-noti-grupo="checkin"] summary').click();
        assert.match(await page.locator('[data-sites-noti-grupo="checkin"]').textContent(), /H-2844.*2 adultos.*1 niños/s);
        await page.locator('[data-sites-noti-grupo="pagos"] summary').click();
        await page.locator('[data-sites-noti-grupo="pagos"] [data-sites-noti-accion="pago"]').click();
        assert.equal(await page.locator("#sites-notificaciones-drawer").isVisible(), false);
        assert.deepEqual((await page.evaluate(() => window.__calls)).find(call => call[0] === "pago"), ["pago", "R-pay", "checkin", "2"]);
        await page.evaluate(() => { document.querySelector(".sites-resumen-pago-drawer").hidden = true; });
        await page.waitForFunction(() => !document.getElementById("sites-notificaciones-drawer").hidden);
        await page.locator('[data-sites-noti-grupo="bove"] summary').click();
        await page.locator('[data-sites-noti-grupo="bove"] [data-sites-noti-accion="bove"]').click();
        await page.waitForFunction(() => window.__calls.some(call => call[0] === "bove"));
        assert.equal(await page.locator("#sites-notificaciones-drawer").isVisible(), false);
        await page.evaluate(() => { document.querySelector(".sites-pagos-bove").hidden = true; });
        await page.waitForFunction(() => !document.getElementById("sites-notificaciones-drawer").hidden);

        await page.evaluate(() => {
            window.__payments = [];
            window.__boves = [];
            document.dispatchEvent(new Event("haiku:resumen-pagos-actualizados"));
        });
        await page.waitForFunction(() => document.getElementById("contador-notificaciones").textContent === "1"); // check-in solamente
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#sites-notificaciones-drawer").isVisible(), false);
        await page.locator("#boton-notificaciones").click();
        await page.locator("#sites-notificaciones-cerrar").click();
        assert.equal(await page.locator("#sites-notificaciones-drawer").isVisible(), false);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator("#boton-notificaciones").click();
        const sizes = await page.evaluate(() => ({
            drawer: document.getElementById("sites-notificaciones-drawer").getBoundingClientRect().width,
            viewport: document.documentElement.clientWidth,
            bodyOverflow: getComputedStyle(document.getElementById("sites-notificaciones-contenido")).overflowY
        }));
        assert.ok(sizes.drawer <= sizes.viewport + 1, JSON.stringify(sizes));
        assert.equal(sizes.bodyOverflow, "auto");
        assert.equal(await page.locator("#panel-notificaciones").isVisible(), false);
        console.log("Centro Sites: first paint, badge, secciones, acciones, refresh, cierre y móvil OK");
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
