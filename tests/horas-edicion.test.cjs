const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const raiz = path.resolve(__dirname, "..");
const fuente = fs.readFileSync(path.join(raiz, "js/haiku-horas-edicion-v1.js"), "utf8");

// Modelo de propagación DOM. El writer reproduce la deshabilitación y el repintado
// que interrumpían la escritura; no se usan red, cuentas ni datos reales.
function arnes() {
    const listeners = [];
    const guardados = [];
    let enfocado = null;
    const document = {
        addEventListener(tipo, fn, captura) { listeners.push({ tipo, fn, captura }); }
    };
    class Evento {
        constructor(type, opciones = {}) { this.type = type; Object.assign(this, opciones); }
        stopImmediatePropagation() { this.detenido = true; }
        preventDefault() { this.defaultPrevented = true; }
    }
    const contexto = { document, window: {}, Event: Evento, WeakMap };
    vm.runInNewContext(fuente, contexto);
    document.addEventListener("change", evento => {
        const input = evento.target;
        input.disabled = true;
        guardados.push(input.value);
        input.disabled = false;
    }, true);
    function emitir(input, tipo, opciones = {}) {
        const evento = new Evento(tipo, { target: input, ...opciones });
        for (const { tipo: nombre, fn } of listeners) {
            if (nombre !== tipo) continue;
            fn(evento);
            if (evento.detenido) break;
        }
        return evento;
    }
    function campo(valor = "", gestionado = true) {
        return {
            value: valor, disabled: false, validity: { valid: true },
            matches() { return gestionado; },
            dispatchEvent(evento) { return emitir(this, evento.type); },
            focus() { if (enfocado && enfocado !== this) enfocado.blur(); enfocado = this; emitir(this, "focusin"); },
            blur() {
                if (enfocado !== this) return;
                // En Chromium el change nativo del blur llega antes de focusout.
                emitir(this, "change");
                enfocado = null;
                emitir(this, "focusout");
            }
        };
    }
    function escribir(input, valor, valido = true) {
        input.value = valor;
        input.validity.valid = valido;
        emitir(input, "input");
        emitir(input, "change");
    }
    return { campo, escribir, emitir, guardados, listeners, contexto };
}

test("11:37 no guarda 11:03 ni interrumpe los minutos; blur confirma una vez", () => {
    const a = arnes(), input = a.campo();
    input.focus();
    a.escribir(input, "", false);
    a.escribir(input, "11:03");
    assert.deepEqual(a.guardados, []);
    assert.equal(input.disabled, false);
    a.escribir(input, "11:37");
    assert.deepEqual(a.guardados, []);
    input.blur();
    assert.deepEqual(a.guardados, ["11:37"]);
});

test("Enter confirma una edición una sola vez", () => {
    const a = arnes(), input = a.campo("10:00");
    input.focus();
    a.escribir(input, "11:37");
    assert.equal(a.emitir(input, "keydown", { key: "Enter" }).defaultPrevented, true);
    a.emitir(input, "keydown", { key: "Enter" });
    assert.deepEqual(a.guardados, ["11:37"]);
});

test("borrar una hora confirma vacío, mientras un segmento incompleto no borra", () => {
    const a = arnes(), input = a.campo("11:37");
    input.focus();
    a.escribir(input, "", false);
    a.emitir(input, "keydown", { key: "Enter" });
    input.blur();
    assert.deepEqual(a.guardados, []);
    input.focus();
    a.escribir(input, "", true);
    input.blur();
    assert.deepEqual(a.guardados, [""]);
});

test("visitar un campo o restaurar la misma hora no vuelve a guardar", () => {
    const a = arnes(), input = a.campo("11:37");
    input.focus(); input.blur();
    input.focus();
    a.escribir(input, "12:00");
    a.escribir(input, "11:37");
    input.blur();
    assert.deepEqual(a.guardados, []);
});

test("cada campo dinámico confirma su propio valor al cambiar de foco", () => {
    const a = arnes(), entrada = a.campo(), salida = a.campo();
    entrada.focus();
    a.escribir(entrada, "11:37");
    salida.focus();
    a.escribir(salida, "12:45");
    assert.deepEqual(a.guardados, ["11:37"]);
    salida.blur();
    assert.deepEqual(a.guardados, ["11:37", "12:45"]);
});

test("los cambios programáticos sin edición y otros controles mantienen sus eventos", () => {
    const a = arnes(), input = a.campo(), otro = a.campo("", false);
    a.escribir(input, "09:30");
    otro.focus();
    a.escribir(otro, "texto");
    assert.deepEqual(a.guardados, ["09:30", "texto"]);
});

test("cargar el módulo dos veces no duplica listeners", () => {
    const a = arnes(), antes = a.listeners.length;
    vm.runInNewContext(fuente, a.contexto);
    assert.equal(a.listeners.length, antes);
});

test("index y panel cargan la protección antes de cualquier writer", () => {
    const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
    const posicion = html.indexOf('src="js/haiku-horas-edicion-v1.js"');
    assert.ok(posicion > 0 && posicion < html.indexOf("</head>"));
    const panel = fs.readFileSync(path.join(raiz, "panel.html"), "utf8");
    assert.match(panel, /for \(const modulo of \["haiku-horas-edicion-v1"/);
});
