// Shell real y conversación real, con un backend local sin escrituras.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const origin = "http://haiku-cereza.test";
const scripts = new Set([
    "haiku-cereza-nav-v1", "haiku-tema-v1", "haiku-dialogos-v1", "haiku-panel-coordinacion-v1",
    "app", "calendario", "supabase-auth-menu-v1", "supabase-asistente-v1", "supabase-asistente-historial-v1"
].map(name => `js/${name}.js`));
const colors = {
    claro: { shell: "rgb(255, 253, 251)", primary: "rgb(120, 38, 63)" },
    oscuro: { shell: "rgb(32, 27, 34)", primary: "rgb(145, 59, 87)" }
};

async function run() {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const width of [1440, 390, 320]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            const errors = [];
            page.on("pageerror", e => errors.push(e.message));
            await page.addInitScript(() => {
                window.__calls = [];
                window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: "visible", armado: true }) };
                window.haikuSupabase = {
                    auth: { onAuthStateChange() {} },
                    functions: { invoke: async () => {
                        window.__calls.push("lectura");
                        return { data: { ok: true, respuesta: "Respuesta sintética de Haku" }, error: null };
                    } }
                };
            });
            await page.route("**/*", route => {
                const url = new URL(route.request().url());
                if (url.hostname === "cdn.jsdelivr.net") {
                    return route.fulfill({ contentType: "text/javascript", body: "window.supabase={createClient:()=>({})}" });
                }
                if (url.origin !== origin) return route.abort();
                const name = url.pathname.slice(1);
                const file = path.resolve(root, name);
                if (name.endsWith(".js") && !scripts.has(name)) {
                    return route.fulfill({ contentType: "text/javascript", body: "" });
                }
                if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
                const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(file)];
                return route.fulfill({ contentType, body: fs.readFileSync(file) });
            });
            await page.goto(origin + "/panel.html");
            const chat = page.locator("#haiku-acceso-chat");
            const bubble = page.locator("#haiku-asistente-boton");
            const panel = page.locator("#haiku-asistente-panel");
            const message = page.locator("#haiku-asistente-texto");
            await page.waitForFunction(() => window.HAIKU_ASISTENTE && document.querySelector(".haiku-cereza-cabecera"));
            assert.equal(await chat.isVisible(), false);
            assert.equal(await bubble.isVisible(), false);
            await page.evaluate(() => {
                window.haikuSesion = { usuario: { id: "usuario-sintetico" } };
                window.dispatchEvent(new Event("haiku:auth-ready"));
            });
            await chat.waitFor();
            await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
            await bubble.waitFor();
            const nav = page.getByRole("navigation", { name: "Navegación principal" });
            const group = nav.locator("summary", { hasText: "Gestión" });
            await group.focus();
            await page.keyboard.press("Enter");
            const reservas = nav.getByRole("button", { name: "Reservas", exact: true });
            await reservas.waitFor();
            await page.keyboard.press("Escape");
            assert.equal(await reservas.isVisible(), false);
            await group.click();
            await reservas.click();
            assert.ok(await page.locator("#seccion-reservas").evaluate(n => n.classList.contains("activa")));
            assert.equal(await reservas.isVisible(), false);
            await page.getByRole("link", { name: "Haiku · Resumen" }).click();
            assert.ok(await page.locator("#seccion-resumen").evaluate(n => n.classList.contains("activa")));
            assert.equal(await nav.getByRole("button", { name: "Huéspedes" }).count(), 0);
            for (const [mode, expected] of Object.entries(colors)) {
                const header = page.locator(".haiku-cereza-cabecera");
                if (width >= 1171) assert.ok((await header.boundingBox()).height <= 64, "la navegación comparte una línea");
                assert.equal(await header.evaluate(n => getComputedStyle(n).backgroundColor), expected.shell);
                assert.equal(await page.locator("#boton-nueva-reserva").evaluate(n => getComputedStyle(n).backgroundColor), expected.primary);
                assert.equal(await bubble.evaluate(n => getComputedStyle(n).backgroundColor), expected.primary);
                await bubble.hover();
                assert.equal(await bubble.evaluate(n => getComputedStyle(n).backgroundColor), expected.primary, "la Burbuja mantiene el cereza al pasar el puntero");
                for (const target of [chat, page.locator("#haiku-tema-boton"), nav, group, page.locator("#busqueda-palabra")]) {
                    const box = await target.boundingBox();
                    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, "controles dentro de la ventana");
                }
                await bubble.click();
                await message.fill("Borrador sintético");
                const bubbleBox = await panel.boundingBox();
                await page.getByRole("button", { name: "Cerrar Haku", exact: true }).click();
                assert.equal(await bubble.evaluate(n => document.activeElement === n), true);
                await chat.click();
                assert.equal(await chat.getAttribute("aria-expanded"), "true");
                assert.equal(await panel.locator("textarea").inputValue(), "Borrador sintético");
                assert.equal(await page.locator(".haiku-asistente-root").count(), 1);
                const chatBox = await panel.boundingBox();
                if (width > 780) assert.ok(chatBox.width > bubbleBox.width, "Chat usa el ancho de escritorio");
                else assert.ok(chatBox.x >= 0 && chatBox.width <= width, "Chat compacto en móvil");
                const inspector = page.locator("#ficha-reserva-modal");
                await inspector.evaluate(n => {
                    n.querySelector("#ficha-reserva-cerrar").addEventListener("click", () => { n.hidden = true; }, { once: true });
                    n.hidden = false;
                });
                await page.waitForFunction(() => window.HAIKU_PANELES_V1.estado().inspectorAbierto);
                if (width > 900) {
                    const [haku, ficha] = await Promise.all([panel.boundingBox(), inspector.boundingBox()]);
                    assert.ok(ficha.x + ficha.width <= haku.x + 1, "la ficha y Haku conviven lado a lado");
                    await page.keyboard.press("Escape");
                } else {
                    assert.equal(await panel.isVisible(), false);
                    await page.getByRole("button", { name: "Cerrar el inspector y volver a Haku" }).click();
                }
                await panel.waitFor();
                assert.equal(await message.inputValue(), "Borrador sintético");
                await page.locator("#haiku-asistente-rapidas > summary").click();
                assert.ok(await panel.getByRole("button", { name: "Titulares y cabañas del mes" }).isVisible());
                await page.locator("#haiku-asistente-rapidas > summary").click();
                const dialogPromise = page.evaluate(() => window.HAIKU_DIALOGOS.confirmar("Revisar propuesta sintética", {
                    accion: "Incorporar selección", contexto: "Haku · Libro", peligro: false
                }));
                const confirm = page.locator(".hk-dialogo");
                await confirm.waitFor();
                assert.equal(await confirm.getByRole("button", { name: "Incorporar selección" }).evaluate(n => getComputedStyle(n).backgroundColor), expected.primary);
                await confirm.getByRole("button", { name: "Cancelar" }).click();
                assert.equal(await dialogPromise, false);
                await message.focus();
                await page.keyboard.press("Escape");
                assert.equal(await panel.isVisible(), false);
                assert.equal(await chat.evaluate(n => document.activeElement === n), true);
                assert.deepEqual(await page.evaluate(() => window.__calls), []);
                if (mode === "claro") await page.locator("#haiku-tema-boton").click();
                console.log(`OK ${width} ${mode} · navegación, Chat y Burbuja, diálogo y borrador`);
            }
            assert.deepEqual(errors, []);
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
