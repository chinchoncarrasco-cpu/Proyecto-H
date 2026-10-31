// Teclas reales sobre input type=time. Sólo usa fixtures en memoria.
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.HAIKU_BROWSER_PATH ? { executablePath: process.env.HAIKU_BROWSER_PATH } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errores = [];
        page.on("pageerror", error => errores.push(error.message));
        async function preparar(valor = "", clase = "aseo-hora-input") {
            await page.setContent(`<!doctype html><html lang="es"><head><style>
                body { background:#1b2822; color:#e5eee8; font:14px system-ui; padding:40px; }
                input { width:85px; height:40px; box-sizing:border-box; padding:8px;
                    color-scheme:dark; color:inherit; background:inherit; border:1px solid #48604f; border-radius:6px; }
            </style></head><body><label>Hora IN <input id="hora" class="${clase}" type="time"
                data-campo="aseoIn" data-aseo-hora="aseoIn" data-cabana="1" value="${valor}"></label>
                <button id="otro">Otro campo</button><output id="guardado"></output></body></html>`);
            await page.addScriptTag({ path: path.join(__dirname, "../js/haiku-horas-edicion-v1.js") });
            await page.evaluate(() => {
                window.__guardados = [];
                document.addEventListener("change", evento => {
                    if (evento.target.id !== "hora") return;
                    const input = evento.target;
                    window.__guardados.push(input.value);
                    input.disabled = true;
                    document.getElementById("guardado").textContent = input.value;
                    setTimeout(() => { input.disabled = false; }, 50);
                }, true);
            });
            return page.locator("#hora");
        }

        for (const [inicial, clase] of [["", "aseo-hora-input"], ["10:00", "campo-cabana"]]) {
            const input = await preparar(inicial, clase);
            await input.click();
            for (const [tecla, borrador] of [["1", "1_:__"], ["1", "11:__"], ["3", "11:3_"]]) {
                await input.press(tecla);
                assert.equal(await input.inputValue(), inicial);
                assert.equal(await input.isEnabled(), true);
                assert.equal(await input.evaluate(el => document.activeElement === el), true);
                assert.equal(await page.locator("[data-haiku-hora-borrador]").textContent(), borrador);
                assert.deepEqual(await page.evaluate(() => window.__guardados), []);
            }
            await input.press("7");
            assert.equal(await input.inputValue(), "11:37");
            assert.deepEqual(await page.evaluate(() => window.__guardados), ["11:37"]);
            await page.waitForFunction(() => !document.getElementById("hora").disabled);
            await input.press("Enter");
            await page.locator("#otro").click();
            assert.deepEqual(await page.evaluate(() => window.__guardados), ["11:37"]);
            assert.equal(await page.locator("[data-haiku-hora-borrador]").count(), 0);
            assert.equal(await input.getAttribute("type"), "time");
        }

        let input = await preparar("10:00");
        await input.click(); await input.pressSequentially("2400");
        assert.equal(await input.inputValue(), "10:00");
        assert.deepEqual(await page.evaluate(() => window.__guardados), []);
        assert.equal(await input.getAttribute("aria-invalid"), "true");
        await input.pressSequentially("1137");
        assert.deepEqual(await page.evaluate(() => window.__guardados), ["11:37"]);

        input = await preparar("10:00");
        await input.click(); await input.pressSequentially("113");
        await page.locator("#otro").click();
        assert.equal(await input.inputValue(), "10:00");
        assert.deepEqual(await page.evaluate(() => window.__guardados), []);

        input = await preparar("10:00");
        await input.click(); await input.pressSequentially("119"); await input.press("Backspace");
        await input.pressSequentially("37");
        assert.deepEqual(await page.evaluate(() => window.__guardados), ["11:37"]);
        assert.deepEqual(errores, []);
        console.log("Chromium: cuatro teclas en Aseo/Resumen, foco, escritura única, rangos, cancelación y Backspace OK.");
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
