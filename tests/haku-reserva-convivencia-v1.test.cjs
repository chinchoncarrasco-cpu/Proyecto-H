const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const assistant = read("js/supabase-asistente-v1.js");
const coordinator = read("js/haiku-panel-coordinacion-v1.js");
const drawer = read("js/sites-resumen-drawer-v1.js");
const reservation = read("js/sites-resumen-reserva-v1.js");
const payment = read("js/sites-resumen-pago-v1.js");
const navigation = read("js/app.js");
const css = read("css/haiku-panel-coordinacion-v1.css");
const panel = read("panel.html");
const fixture = read("tests/fixtures/haku-reserva-convivencia/index.html");

assert.doesNotThrow(() => new Function(assistant), "el asistente conserva sintaxis válida");
assert.doesNotThrow(() => new Function(coordinator), "el coordinador conserva sintaxis válida");
assert.doesNotThrow(() => new Function(panel.match(/<script>([\s\S]*?)<\/script>/)[1]),
    "el bootstrap del panel conserva sintaxis válida");

assert.match(assistant, /aria-modal="false"/, "Haku deja de anunciarse como modal");
assert.doesNotMatch(assistant, /overlay\.addEventListener\("click",\s*cerrarPanel\)/,
    "el fondo ya no cierra Haku");
assert.doesNotMatch(assistant, /document\.body\.style\.overflow\s*=\s*"hidden"/,
    "Haku no bloquea el contenido mediante estilos inline");
assert.match(assistant, /puedeCerrarConEscape\(\)/,
    "Escape consulta si existe otra superficie prioritaria");

assert.match(coordinator, /HAIKU_PANELES_V1/);
assert.match(coordinator, /#sites-resumen-reserva-drawer/,
    "el coordinador usa la ficha Sites abierta por Ver reserva");
assert.match(coordinator, /abrirReserva/,
    "se mantiene compatible el puente para abrir una reserva desde Haku");
assert.match(coordinator, /abrirInspector/,
    "existe una API general para la superficie central");
assert.match(coordinator, /registrarTipoInspector/,
    "los tipos futuros pueden registrar su adaptador sin acoplar el coordinador");
for (const tipo of ["reserva", "pago", "servicio", "solicitud", "aseo"]) {
    assert.match(coordinator, new RegExp(`\\b${tipo}\\b`), `tipo ${tipo} preparado`);
}
assert.match(coordinator, /volverInspector/,
    "queda preparada una pila interna sencilla para volver al inspector anterior");
assert.match(coordinator, /activarSuperficie/,
    "el coordinador impide dos superficies de inspector visibles");
assert.match(coordinator, /stopImmediatePropagation\(\)/,
    "Escape sólo se consume para el inspector activo");
assert.match(drawer, /comparteEscritorio/,
    "el drawer libera Tab y scroll cuando comparte el escritorio");
assert.match(drawer, /evento\.target === panel && !comparteEscritorio\(panel\)/,
    "el clic exterior no cierra la ficha acoplada en escritorio");
assert.match(drawer, /sincronizarBloqueoScroll/,
    "el inspector acoplado no bloquea el scroll principal");
assert.match(drawer, /data-haiku-inspector-superficie/,
    "el gestor diferencia inspectores acoplados de drawers modales");
assert.match(coordinator, /data\.haikuVolverHaku|dataset\.haikuVolverHaku/,
    "móvil recibe un retorno explícito a Haku");
assert.match(reservation, /haikuInspectorSuperficie\s*=\s*"reserva"/,
    "la ficha real se registra como superficie del inspector");
assert.match(reservation, /haikuInspectorEntidadId/,
    "la ficha publica la identidad vigente incluso si se abre desde la página principal");
assert.doesNotMatch(payment, /registrarTipoInspector|haikuInspectorSuperficie/,
    "el formulario transaccional de pagos no se convierte falsamente en ficha de detalle");
assert.doesNotMatch(navigation, /cerrarInspector|cerrarReserva|HAIKU_PANELES_V1/,
    "la navegación principal no cierra ni reinicia el inspector");

assert.match(css, /@media \(min-width: 901px\)/);
assert.match(css, /data-haiku-inspector-superficie/);
assert.match(css, /inset:\s*0 var\(--haiku-panel-coordinado-ancho\) 0 auto/,
    "el inspector reserva espacio real a la izquierda de Haku");
assert.match(css, /padding-right:\s*var\(--haiku-superficies-ancho\)/,
    "el contenido reduce su ancho por layout para las superficies abiertas");
assert.match(css, /background:\s*#ffffff/,
    "la ficha de escritorio no crea una capa oscura sobre el contenido");
assert.match(css, /backdrop-filter:\s*none/,
    "no existe atenuación visual en el modo de trabajo");
assert.match(css, /@media \(max-width: 900px\)/);
assert.match(css, /visibility:\s*hidden/,
    "en vista compacta la ficha y Haku no compiten por la pantalla");
assert.match(css, /haiku-volver-haku/);
assert.match(css, /pointer-events:\s*none !important/,
    "el overlay inactivo no intercepta clics");

assert.match(panel, /css\/haiku-panel-coordinacion-v1\.css/);
assert.match(panel, /js\/haiku-panel-coordinacion-v1\.js/);
for (const seccion of ["libro", "pagos", "servicios"]) {
    assert.match(fixture, new RegExp(`data-demo-seccion="${seccion}"`),
        `la demo permite navegar a ${seccion}`);
}

console.log("Inspector central + Haku: contratos, navegación y carga OK");
