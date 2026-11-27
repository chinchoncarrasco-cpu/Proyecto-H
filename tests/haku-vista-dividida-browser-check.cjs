const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const origin = "http://haiku-vista.test";
const scripts = new Set([
    "haiku-vista-dividida-v1", "haiku-cereza-nav-v1", "haiku-tema-v1",
    "app", "calendario", "supabase-libro-reserva-v1"
].map(name => "js/" + name + ".js"));
const sections = ["resumen", "calendario", "cabanas", "servicios", "pagos", "cierre",
    "historial", "reservas", "huespedes", "libro-reserva"];

async function abrir(browser, width) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: "America/Santiago" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
        window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: "visible", armado: true }) };
        window.cargarAbonosPagos = () => {};
        window.cargarSaldosCheckin = () => {};
        window.cargarCabanasDia = () => {};
        const cambiosSesion = [];
        window.haikuSupabase = {
            auth: { onAuthStateChange: callback => cambiosSesion.push(callback) }
        };
        window.__cerrarSesion = () => cambiosSesion.forEach(callback => callback("SIGNED_OUT"));
    });
    await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.hostname === "cdn.jsdelivr.net") {
            return route.fulfill({ contentType: "text/javascript", body: "window.supabase={createClient:()=>({})}" });
        }
        if (url.origin !== origin) return route.abort();
        const name = url.pathname.slice(1);
        if (name.endsWith(".js") && !scripts.has(name)) {
            return route.fulfill({ contentType: "text/javascript", body: "" });
        }
        const file = path.resolve(root, name);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
        const contentType = {
            ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"
        }[path.extname(file)];
        return route.fulfill({ contentType, body: fs.readFileSync(file) });
    });
    await page.goto(origin + "/panel.html");
    await page.waitForFunction(() => window.HAIKU_VISTA_DIVIDIDA_V1);
    await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
    await page.evaluate(() => {
        document.documentElement.classList.remove("haiku-resumen-pendiente", "haiku-cabanas-pendiente", "haiku-pagos-pendiente");
        window.__entradas = [];
        for (const boton of document.querySelectorAll(".haiku-cereza-navegacion .menu-item[data-seccion]")) {
            boton.addEventListener("click", () => window.__entradas.push(boton.dataset.seccion));
        }
    });
    return { page, errors };
}

const seccion = (page, id) => page.locator("#seccion-" + id);

async function comprobarRueda(page, resumen, libro, visor) {
    const encabezadoResumen = resumen.locator(".resumen-estado-cabecera h2");
    const encabezadoLibro = libro.locator(".libro-reserva-cabecera h2");
    const moverRueda = async destino => {
        const caja = await destino.boundingBox();
        await page.mouse.move(caja.x + caja.width / 2, caja.y + Math.min(caja.height / 2, 16));
        await page.mouse.wheel(0, 240);
    };
    for (const panel of [resumen, libro]) {
        await panel.evaluate(el => {
            const relleno = document.createElement("div");
            relleno.dataset.pruebaRueda = "";
            relleno.style.height = "900px";
            el.append(relleno);
        });
    }
    const origen = await page.evaluate(() => window.scrollY);
    await encabezadoResumen.click();
    await moverRueda(encabezadoResumen);
    await page.waitForFunction(() => document.getElementById("seccion-resumen").scrollTop > 0);
    const desplazamientoResumen = await resumen.evaluate(el => el.scrollTop);
    assert.equal(await libro.evaluate(el => el.scrollTop), 0);

    await page.evaluate(() => {
        window.__ruedaVistaCancelada = null;
        window.addEventListener("wheel", evento => {
            window.__ruedaVistaCancelada = evento.defaultPrevented;
        }, { once: true, passive: true });
    });
    await moverRueda(encabezadoLibro);
    await page.waitForFunction(() => typeof window.__ruedaVistaCancelada === "boolean");
    assert.equal(await page.evaluate(() => window.__ruedaVistaCancelada), true,
        "la rueda no desplaza el panel que aún no se seleccionó");
    assert.equal(await libro.evaluate(el => el.scrollTop), 0);
    assert.equal(await resumen.evaluate(el => el.scrollTop), desplazamientoResumen);

    await encabezadoLibro.click();
    await moverRueda(encabezadoLibro);
    await page.waitForFunction(() => document.getElementById("seccion-libro-reserva").scrollTop > 0);
    assert.equal(await resumen.evaluate(el => el.scrollTop), desplazamientoResumen);
    await libro.evaluate(el => { el.scrollTop = 0; });
    await moverRueda(visor);
    await page.waitForFunction(() => document.getElementById("libro-reserva-visor").scrollTop > 130);
    assert.equal(await libro.evaluate(el => el.scrollTop), 0, "la planilla sigue desplazándose dentro de su visor");
    assert.equal(await resumen.evaluate(el => el.scrollTop), desplazamientoResumen);
    assert.equal(await page.evaluate(() => window.scrollY), origen);

    await page.evaluate(() => {
        for (const el of document.querySelectorAll("[data-prueba-rueda]")) {
            el.parentElement.scrollTop = 0;
            el.remove();
        }
        document.getElementById("libro-reserva-visor").scrollTop = 130;
    });
}

async function escritorio(browser) {
    const { page, errors } = await abrir(browser, 1440);
    const boton = page.getByRole("button", { name: "Vista dividida", exact: true });
    const izquierda = page.getByRole("combobox", { name: "Sección del panel izquierdo" });
    const derecha = page.getByRole("combobox", { name: "Sección del panel derecho" });
    const resumen = seccion(page, "resumen");
    const libro = seccion(page, "libro-reserva");
    const separador = page.getByRole("separator", { name: "Ancho del panel izquierdo" });
    const intercambio = page.getByRole("button", { name: "Intercambiar paneles" });
    assert.equal(await boton.getAttribute("aria-pressed"), "false");
    await boton.click();

    assert.equal(await izquierda.inputValue(), "resumen");
    assert.equal(await derecha.inputValue(), "libro-reserva");
    const ri = await resumen.boundingBox();
    const ld = await libro.boundingBox();
    assert.ok(Math.abs(ri.width - ld.width) <= 1);
    assert.ok(ri.x + ri.width < ld.x);
    assert.ok(await resumen.locator(".sites-resumen-fila").first().evaluate(fila =>
        fila.querySelector(".sites-resumen-celda--final").getBoundingClientRect().right <=
        fila.getBoundingClientRect().right), "el estado final cabe junto al Libro");
    assert.equal(await derecha.locator('option[value="huespedes"]').count(), 0);

    await libro.evaluate(el => {
        const visor = el.querySelector("#libro-reserva-visor");
        const tabla = document.createElement("table");
        const fila = tabla.insertRow();
        const celda = fila.insertCell();
        celda.textContent = "Ejemplo sintético";
        tabla.style.minWidth = "1600px";
        tabla.style.height = "900px";
        visor.replaceChildren(tabla);
        visor.scrollLeft = 220;
        visor.scrollTop = 130;
    });
    const visor = libro.locator("#libro-reserva-visor");
    await comprobarRueda(page, resumen, libro, visor);
    await page.evaluate(() => {
        window.__opcionesModificadas = 0;
        const observer = new MutationObserver(cambios => { window.__opcionesModificadas += cambios.length; });
        for (const selector of document.querySelectorAll("#haiku-vista-controles select")) {
            observer.observe(selector, { attributes: true, childList: true, subtree: true });
        }
    });
    await izquierda.click();
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.__opcionesModificadas), 0,
        "abrir el desplegable no modifica las opciones ni cambia el panel en foco");
    assert.equal(await page.evaluate(() => window.HAIKU_VISTA_DIVIDIDA_V1.seccionEnFoco().id), "seccion-libro-reserva");

    const divisor = await separador.boundingBox();
    await page.mouse.move(divisor.x + divisor.width / 2, divisor.y + divisor.height / 2);
    await page.mouse.down();
    await page.mouse.move(930, divisor.y + divisor.height / 2, { steps: 8 });
    await page.waitForFunction(x => {
        const rect = document.getElementById("haiku-vista-separador").getBoundingClientRect();
        return Math.abs(rect.x + rect.width / 2 - x) <= 1;
    }, 930);
    const guia = await separador.boundingBox();
    const izquierdaDurante = await resumen.boundingBox();
    const derechaDurante = await libro.boundingBox();
    assert.ok(Math.abs(guia.x + guia.width / 2 - 930) <= 1, "la guía sigue al puntero");
    assert.ok(izquierdaDurante.width > ri.width && derechaDurante.width < ld.width,
        "las ventanas cambian de tamaño mientras se arrastra");
    assert.ok(Math.abs(izquierdaDurante.x + izquierdaDurante.width - guia.x) <= 1);
    assert.ok(Math.abs(derechaDurante.x - guia.x - guia.width) <= 1);
    await page.mouse.up();
    assert.ok(Math.abs((await separador.boundingBox()).x - guia.x) <= 1, "los paneles conservan el ancho elegido");
    assert.equal((await resumen.boundingBox()).width, izquierdaDurante.width, "soltar no reajusta el panel");
    assert.ok(Number(await separador.getAttribute("aria-valuenow")) > 60);

    const anchoConfirmado = await resumen.boundingBox();
    await page.mouse.move(guia.x + guia.width / 2, guia.y + guia.height / 2);
    await page.mouse.down();
    await page.mouse.move(700, guia.y + guia.height / 2, { steps: 4 });
    await page.waitForFunction(() => Number(document.getElementById("haiku-vista-separador").getAttribute("aria-valuenow")) < 50);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal((await resumen.boundingBox()).width, anchoConfirmado.width, "cancelar conserva el último ancho");
    assert.equal(await separador.evaluate(el => el.style.transform), "");

    await separador.press("End");
    assert.equal(await separador.getAttribute("aria-valuenow"), await separador.getAttribute("aria-valuemax"));
    assert.ok((await libro.boundingBox()).width >= 320);
    await separador.press("Enter");
    await separador.press("ArrowLeft");
    assert.equal(await separador.getAttribute("aria-valuenow"), "45");
    await separador.dblclick();
    assert.equal(await separador.getAttribute("aria-valuenow"), "50");
    await intercambio.click();
    assert.equal(await izquierda.inputValue(), "libro-reserva");
    assert.equal(await derecha.inputValue(), "resumen");
    assert.ok((await libro.boundingBox()).x < (await resumen.boundingBox()).x);
    assert.deepEqual(await visor.evaluate(el => [el.scrollLeft, el.scrollTop]), [220, 130]);
    assert.deepEqual(await page.evaluate(() => window.__entradas), [], "dividir, ajustar e intercambiar no vuelven a entrar al menú");
    assert.equal(await page.locator("#libro-reserva-visor").count(), 1);

    await libro.locator("h2").click();
    const buscador = page.getByRole("searchbox", { name: "Buscar palabra en la sección" });
    await buscador.fill("Ejemplo sintético");
    await libro.locator(".busqueda-palabra-marca").waitFor();
    assert.equal(await resumen.locator(".busqueda-palabra-marca").count(), 0);
    await buscador.fill("");

    await page.locator('.haiku-cereza-navegacion [data-seccion="huespedes"]').evaluate(el => { el.hidden = false; });
    for (const id of sections.filter(id => id !== "libro-reserva")) {
        await derecha.selectOption(id);
        assert.equal(await seccion(page, id).isVisible(), true, id);
        assert.equal(await libro.isVisible(), true, "el Libro sigue abierto junto a " + id);
    }
    await izquierda.selectOption("cabanas");
    await derecha.selectOption("calendario");
    await seccion(page, "calendario").locator(".dia-calendario[data-fecha]").first().click();
    assert.equal(await derecha.inputValue(), "resumen");
    assert.equal(await seccion(page, "cabanas").isVisible(), true);

    await derecha.selectOption("huespedes");
    await page.locator('.haiku-cereza-navegacion [data-seccion="huespedes"]').evaluate(el => { el.hidden = true; });
    await page.waitForFunction(() => !document.querySelector("#seccion-huespedes").classList.contains("activa"));
    assert.equal(await derecha.locator('option[value="huespedes"]').count(), 0);

    await derecha.selectOption("libro-reserva");
    await page.locator("#haiku-tema-boton").evaluate(el => el.click());
    await page.waitForFunction(() => document.documentElement.dataset.haikuTema === "oscuro");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1440);
    const separadorOscuro = await separador.boundingBox();
    const xOscuro = separadorOscuro.x + separadorOscuro.width / 2;
    const yOscuro = separadorOscuro.y + separadorOscuro.height / 2;
    await page.mouse.move(xOscuro, yOscuro);
    await page.mouse.down();
    await page.mouse.move(xOscuro + 80, yOscuro);
    await page.waitForFunction(x => {
        const rect = document.getElementById("haiku-vista-separador").getBoundingClientRect();
        return Math.abs(rect.x + rect.width / 2 - x) <= 1;
    }, xOscuro + 80);
    await page.setViewportSize({ width: 850, height: 800 });
    await page.getByRole("button", { name: "Ver Cabañas", exact: true }).waitFor();
    await page.mouse.up();
    assert.equal(await page.locator("#haiku-area-trabajo").getAttribute("data-haiku-vista-arrastre"), null);
    assert.equal(await page.locator("#haiku-vista-separador").evaluate(el => el.style.transform), "");
    assert.equal(await libro.isVisible(), true);
    assert.equal(await seccion(page, "cabanas").isVisible(), false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await intercambio.waitFor();
    assert.equal(await seccion(page, "cabanas").isVisible(), true);
    await boton.click();
    assert.equal(await libro.isVisible(), true);
    assert.equal(await page.locator(".seccion-app.activa").count(), 1);
    assert.equal(await boton.getAttribute("aria-pressed"), "false");
    await boton.click();
    await page.evaluate(() => window.__cerrarSesion());
    assert.equal(await boton.getAttribute("aria-pressed"), "false");
    assert.deepEqual(errors, []);
    await page.close();
    console.log("OK escritorio · secciones disponibles, ajuste, intercambio, foco, permisos y temas");
}

async function movil(browser, width) {
    const { page, errors } = await abrir(browser, width);
    const boton = page.getByRole("button", { name: "Vista dividida", exact: true });
    const selector = page.getByRole("combobox", { name: "Sección mostrada" });
    for (const tema of ["claro", "oscuro"]) {
        await boton.click();
        assert.equal(await selector.inputValue(), "resumen");
        assert.equal(await page.getByRole("separator", { name: "Ancho del panel izquierdo" }).count(), 0);
        await page.getByRole("button", { name: "Ver Libro de Reserva", exact: true }).click();
        assert.equal(await selector.inputValue(), "libro-reserva");
        assert.equal(await seccion(page, "libro-reserva").isVisible(), true);
        assert.equal(await seccion(page, "resumen").isVisible(), false);
        await selector.selectOption("cierre");
        await page.getByRole("button", { name: "Ver Resumen", exact: true }).click();
        assert.equal(await selector.inputValue(), "resumen");
        assert.equal(await page.getByRole("button", { name: "Ver Cierre de turno", exact: true }).isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await boton.click();
        assert.equal(await seccion(page, "resumen").isVisible(), true);
        if (tema === "claro") await page.locator("#haiku-tema-boton").evaluate(el => el.click());
        console.log("OK " + width + " px " + tema + " · alternancia en una columna");
    }
    assert.deepEqual(errors, []);
    await page.close();
}

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.HAKU_CHROMIUM_PATH });
    try {
        await escritorio(browser);
        await movil(browser, 390);
        await movil(browser, 320);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
