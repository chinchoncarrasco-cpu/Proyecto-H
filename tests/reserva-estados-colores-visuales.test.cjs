const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const estilos = fs.readFileSync(require.resolve("../css/styles.css"), "utf8");
const sites = fs.readFileSync(require.resolve("../css/sites-resumen-v1.css"), "utf8");
const resumenReal = fs.readFileSync(require.resolve("../index.html"), "utf8");
const fixture = fs.readFileSync(require.resolve("./fixtures/reserva-estados-colores/index.html"), "utf8");

test("la paleta recuperada conserva los valores históricos exactos", () => {
    for (const [variable, color] of [
        ["pendiente-fondo", "#8ec2df"], ["confirmada-fondo", "#2349b8"],
        ["hospedada-fondo", "#dff0e4"], ["hospedada-texto", "#205d3a"],
        ["checkout-fondo", "#a0a0a0"], ["cancelada-fondo", "#fde2e2"],
        ["cancelada-texto", "#b42318"], ["no-show-fondo", "#eee9e4"],
        ["no-show-texto", "#694b3b"]
    ]) assert.match(estilos, new RegExp(`--haiku-reserva-${variable}:\\s*${color}`, "i"));
});

test("cada segmento aplica la paleta como fondo de su misma forma", () => {
    assert.match(sites, /\.sites-resumen-dia\[data-reserva-estado="hospedada"\]\s*\{\s*--franja-estado-acento:/is);
    assert.match(sites, /\.sites-resumen-dia\[data-reserva-estado\]\s*\{[^}]*--franja-estado-bg:\s*color-mix/is);
    assert.match(sites, /\.sites-resumen-dia\[data-reserva-estado\]\s*\{[^}]*background:\s*var\(--franja-estado-bg\)/is);
    assert.match(sites, /12%/);
    assert.doesNotMatch(sites, /data-reserva-estado="libre"/);
    assert.doesNotMatch(sites, /data-reserva-estado="bloqueada"/);
});

test("la franja trasplanta exactamente la geometria Sites de clip y solape", () => {
    assert.match(sites, /\.sites-resumen-flujo\s*\{[^}]*--flow-slant:\s*8px[^}]*overflow:\s*hidden[^}]*isolation:\s*isolate/is);
    assert.match(sites, /\.sites-resumen-dia--anterior\s*\{[^}]*z-index:\s*3[^}]*clip-path:\s*polygon\(\s*0 0,\s*calc\(100% - var\(--flow-slant\)\) 0,\s*100% 100%,\s*0 100%\s*\)/is);
    assert.match(sites, /:is\(\.sites-resumen-dia--actual, \.sites-resumen-dia--siguiente\)\s*\{[^}]*width:\s*calc\(100% \+ var\(--flow-slant\)\)[^}]*margin-left:\s*calc\(0px - var\(--flow-slant\)\)/is);
    assert.match(sites, /\.sites-resumen-dia--actual\s*\{[^}]*z-index:\s*2[^}]*clip-path:\s*polygon\(\s*0 0,\s*calc\(100% - var\(--flow-slant\)\) 0,\s*100% 100%,\s*var\(--flow-slant\) 100%\s*\)/is);
    assert.match(sites, /\.sites-resumen-dia--siguiente\s*\{[^}]*z-index:\s*1[^}]*clip-path:\s*polygon\(\s*0 0,\s*100% 0,\s*100% 100%,\s*var\(--flow-slant\) 100%\s*\)/is);
});

test("la frontera usa una sola linea alineada y no conserva separadores experimentales", () => {
    assert.match(sites, /:is\(\.sites-resumen-dia--actual, \.sites-resumen-dia--siguiente\)::before\s*\{[^}]*width:\s*calc\(var\(--flow-slant\) \+ 1px\)[^}]*clip-path:\s*polygon\(0 0, 1px 0, 100% 100%, calc\(100% - 1px\) 100%\)[^}]*pointer-events:\s*none/is);
    assert.doesNotMatch(sites, /skewX\(18deg\)|sites-resumen-dia--(?:anterior|actual)::after/);
    assert.doesNotMatch(sites, /sites-resumen-flujo-fondo|--ayer-estado-bg|--hoy-estado-bg|--manana-estado-bg|<svg/i);
});

test("fixture y Resumen real conservan el markup original de tres segmentos", () => {
    assert.doesNotMatch(resumenReal, /sites-resumen-flujo-fondos/);
    assert.doesNotMatch(fixture, /sites-resumen-flujo-fondos/);
    assert.equal((resumenReal.match(/class="sites-resumen-dia sites-resumen-dia--/g) || []).length, 33);
    assert.equal((fixture.match(/class="sites-resumen-dia sites-resumen-dia--/g) || []).length, 12);
    assert.doesNotMatch(fixture, /#seccion-resumen \.sites-resumen-flujo\s*\{\s*grid-template-columns/);
});

test("HOY admite un solo estado y un solo fondo incluso durante un recambio", () => {
    assert.doesNotMatch(sites, /data-reserva-estado-secundario|franja-estado-acento-secundario|linear-gradient\(90deg/i);
    assert.doesNotMatch(fixture, /data-reserva-estado-secundario|Sale Andrés|divide Hoy en mitades/i);
    assert.match(fixture, /sites-resumen-dia--actual" data-reserva-estado="pendiente"[^>]*>[\s\S]*?Ingresa · Sofía/);
});

test("el fixture cubre seis estados, recambio, continuidad, libre y bloqueo", () => {
    for (const clase of ["confirmacion-pendiente", "confirmada", "hospedado", "checkout",
        "cancelada", "no-show"]) assert.match(fixture, new RegExp(`ficha-estado-${clase}`));
    assert.match(fixture, /data-reserva-estado="pendiente"[^>]*>[\s\S]*?Ingresa · Sofía/);
    assert.match(fixture, /Una reserva confirmada continúa varios días/);
    assert.match(fixture, /Libre y bloqueo sin reserva: sin color de estado/);
    assert.match(fixture, /No consulta ni escribe Supabase/);
});
