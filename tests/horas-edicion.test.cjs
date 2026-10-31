const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const raiz = path.resolve(__dirname, "..");
const fuente = fs.readFileSync(path.join(raiz, "js/haiku-horas-edicion-v1.js"), "utf8");

// Propagación DOM y semántica básica de input time. El writer mantiene el campo
// deshabilitado hasta recibir respuesta, como el guardado real de Aseo.
function arnes() {
    const listeners = [], guardados = [];
    let activo = null;
    const document = {
        addEventListener(tipo, fn) { listeners.push({ tipo, fn }); },
        createElement(tag) { return nodo(tag); }
    };
    function emitir(input, tipo, opciones = {}) {
        const evento = {
            target: input, type: tipo, ...opciones,
            preventDefault() { this.defaultPrevented = true; },
            stopImmediatePropagation() { this.detenido = true; }
        };
        for (const { tipo: nombre, fn } of listeners) {
            if (nombre !== tipo) continue;
            fn(evento);
            if (evento.detenido) break;
        }
        return evento;
    }
    function nodo(tag = "input") {
        const attrs = new Map();
        let valor = "", deshabilitado = false, mensaje = "";
        const input = {
            tag, type: "time", clase: "aseo-hora-input", readOnly: false,
            required: false, min: "", max: "", style: {}, dataset: {}, children: [], isConnected: true,
            matches(selector) {
                return tag === "input" && selector.split(",").some(s =>
                    s.includes(`type="${this.type}"`) && s.includes(`.${this.clase}`));
            },
            get value() { return valor; },
            set value(nuevo) { valor = this.type !== "time" || !nuevo || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(nuevo) ? nuevo : ""; },
            get disabled() { return deshabilitado; },
            set disabled(v) { deshabilitado = v; if (v && activo === this) this.blur(); },
            get validity() {
                return { customError: !!mensaje, valid: !mensaje && (!this.required || !!valor)
                    && (!valor || !this.min || valor >= this.min) && (!valor || !this.max || valor <= this.max) };
            },
            get validationMessage() { return mensaje; },
            setCustomValidity(texto) { mensaje = texto; },
            getAttribute(nombre) { return attrs.get(nombre) ?? null; },
            setAttribute(nombre, valor) { attrs.set(nombre, valor); },
            removeAttribute(nombre) { attrs.delete(nombre); },
            getBoundingClientRect() { return { left: 100, top: 100, width: 85, height: 40 }; },
            append(hijo) { this.children.push(hijo); hijo.parentElement = this; },
            remove() { this.isConnected = false; this.parentElement.children = this.parentElement.children.filter(x => x !== this); },
            dispatchEvent(evento) { return emitir(this, evento.type); },
            focus() { if (activo && activo !== this) activo.blur(); if (!this.disabled) activo = this; },
            blur() { if (activo === this) { activo = null; emitir(this, "focusout"); } }
        };
        return input;
    }
    document.head = nodo("head"); document.body = nodo("body");
    const contexto = {
        document, window: { addEventListener() {} },
        Event: class { constructor(type) { this.type = type; } },
        getComputedStyle() { return { paddingLeft: "8px", borderLeftWidth: "1px", font: "14px sans-serif", color: "white", letterSpacing: "normal" }; }
    };
    vm.runInNewContext(fuente, contexto);
    document.addEventListener("change", evento => {
        guardados.push(evento.target.value);
        evento.target.disabled = true;
    });
    function campo(valor = "") { const input = nodo(); input.value = valor; return input; }
    function tecla(input, key, opciones = {}) { return emitir(input, "keydown", { key, ...opciones }); }
    function escribir(input, texto) { for (const key of texto) tecla(input, key); }
    function pegar(input, texto) { emitir(input, "paste", { clipboardData: { getData() { return texto; } } }); }
    function borrador() { return document.body.children[0]?.textContent ?? null; }
    return { campo, tecla, escribir, pegar, emitir, guardados, borrador, document, listeners, contexto,
        activo: () => activo };
}

test("1,1,3 no guarda ni pierde el foco; el cuarto dígito guarda 11:37 una vez", () => {
    const a = arnes(), input = a.campo(); input.focus();
    for (const [key, visible] of [["1", "1_:__"], ["1", "11:__"], ["3", "11:3_"]]) {
        assert.equal(a.tecla(input, key).defaultPrevented, true);
        assert.equal(a.borrador(), visible);
        assert.equal(input.value, "");
        assert.equal(input.disabled, false);
        assert.equal(a.activo(), input);
        assert.deepEqual(a.guardados, []);
    }
    a.tecla(input, "7");
    assert.equal(input.value, "11:37");
    assert.deepEqual(a.guardados, ["11:37"]);
    assert.equal(input.disabled, true);
    assert.equal(a.borrador(), null);
});

test("cuatro teclas reemplazan una hora existente sin confirmar cada segmento", () => {
    const a = arnes(), input = a.campo("21:05"); input.focus();
    a.escribir(input, "093");
    assert.equal(input.value, "21:05");
    a.tecla(input, "0");
    assert.deepEqual(a.guardados, ["09:30"]);
});

test("acepta escribir los dos puntos y usar el teclado numérico", () => {
    const a = arnes(), input = a.campo(); input.focus();
    a.escribir(input, "11:");
    a.tecla(input, "3", { code: "Numpad3" });
    a.tecla(input, "7", { code: "Numpad7" });
    assert.deepEqual(a.guardados, ["11:37"]);
});

test("una hora fuera de rango conserva lo guardado y permite corregirla", () => {
    const a = arnes(), input = a.campo("10:00"); input.focus();
    a.escribir(input, "2567");
    assert.deepEqual(a.guardados, []);
    assert.equal(input.value, "10:00");
    assert.equal(input.validity.valid, false);
    a.escribir(input, "2359");
    assert.deepEqual(a.guardados, ["23:59"]);
});

test("00:00 es válido y 24:00 nunca borra la hora anterior", () => {
    const a = arnes(), input = a.campo("11:37"); input.focus();
    a.escribir(input, "2400");
    assert.deepEqual(a.guardados, []);
    assert.equal(input.value, "11:37");
    a.escribir(input, "0000");
    assert.deepEqual(a.guardados, ["00:00"]);
});

test("Backspace corrige el borrador sin modificar la hora persistida", () => {
    const a = arnes(), input = a.campo("10:00"); input.focus();
    a.escribir(input, "119"); a.tecla(input, "Backspace");
    assert.equal(a.borrador(), "11:__");
    assert.deepEqual(a.guardados, []);
    a.escribir(input, "37");
    assert.deepEqual(a.guardados, ["11:37"]);
});

test("Delete borra explícitamente la hora con un solo guardado", () => {
    const a = arnes(), input = a.campo("11:37"); input.focus();
    a.tecla(input, "Delete");
    assert.deepEqual(a.guardados, [""]);
});

test("salir con tres dígitos o pulsar Escape conserva la hora anterior", () => {
    const a = arnes(), input = a.campo("11:37"); input.focus();
    a.escribir(input, "093"); input.blur();
    assert.equal(input.value, "11:37");
    assert.deepEqual(a.guardados, []);
    assert.equal(a.borrador(), null);
    input.focus(); a.escribir(input, "12"); a.tecla(input, "Escape");
    assert.equal(input.validity.valid, true);
    assert.equal(a.borrador(), null);
    assert.deepEqual(a.guardados, []);
});

test("Enter y blur después del cuarto dígito no duplican la escritura", () => {
    const a = arnes(), input = a.campo(); input.focus(); a.escribir(input, "1137");
    input.disabled = false; input.focus(); a.tecla(input, "Enter"); input.blur();
    assert.deepEqual(a.guardados, ["11:37"]);
});

test("volver a escribir la misma hora no produce otra escritura", () => {
    const a = arnes(), input = a.campo("11:37"); input.focus(); a.escribir(input, "1137");
    assert.deepEqual(a.guardados, []);
    assert.equal(a.borrador(), null);
});

test("pegar HHMM o HH:MM confirma una vez; otros textos no se truncan", () => {
    for (const texto of ["1137", "11:37"]) {
        const a = arnes(), input = a.campo(); input.focus(); a.pegar(input, texto);
        assert.deepEqual(a.guardados, ["11:37"]);
    }
    const a = arnes(), input = a.campo("10:00"); input.focus(); a.pegar(input, "11379");
    assert.deepEqual(a.guardados, []);
    assert.equal(input.value, "10:00");
});

test("el reloj nativo y los campos creados después conservan su funcionamiento", () => {
    const a = arnes(), input = a.campo(); input.focus(); a.escribir(input, "12");
    a.emitir(input, "pointerdown");
    input.value = "13:30"; a.emitir(input, "change");
    assert.deepEqual(a.guardados, ["13:30"]);
    const otro = a.campo(); otro.focus(); a.escribir(otro, "1420");
    assert.deepEqual(a.guardados, ["13:30", "14:20"]);
});

test("un evento nativo intermedio no alcanza al writer durante el borrador", () => {
    const a = arnes(), input = a.campo("10:00"); input.focus(); a.escribir(input, "113");
    input.value = "11:03"; a.emitir(input, "input"); a.emitir(input, "change");
    assert.equal(input.value, "10:00");
    assert.deepEqual(a.guardados, []);
    a.tecla(input, "7");
    assert.deepEqual(a.guardados, ["11:37"]);
});

test("respeta min/max y los controles deshabilitados, de solo lectura y ajenos", () => {
    const a = arnes(), input = a.campo("10:00"); input.min = "09:00"; input.max = "18:00";
    input.focus(); a.escribir(input, "1900");
    assert.deepEqual(a.guardados, []);
    input.blur(); input.disabled = true;
    assert.equal(a.tecla(input, "1").defaultPrevented, undefined);
    input.disabled = false; input.readOnly = true;
    assert.equal(a.tecla(input, "1").defaultPrevented, undefined);
    const otro = a.campo(); otro.clase = "otro";
    assert.equal(a.tecla(otro, "1").defaultPrevented, undefined);
});

test("Enter con tres dígitos no confirma; completar el cuarto sí", () => {
    const a = arnes(), input = a.campo(); input.focus(); a.escribir(input, "113");
    a.tecla(input, "Enter");
    assert.deepEqual(a.guardados, []);
    a.tecla(input, "7");
    assert.deepEqual(a.guardados, ["11:37"]);
});

test("el módulo se carga antes de los writers y no duplica listeners", () => {
    const a = arnes(), antes = a.listeners.length;
    vm.runInNewContext(fuente, a.contexto);
    assert.equal(a.listeners.length, antes);
    const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
    const posicion = html.indexOf('src="js/haiku-horas-edicion-v1.js"');
    assert.ok(posicion > 0 && posicion < html.indexOf("</head>"));
    assert.match(fs.readFileSync(path.join(raiz, "panel.html"), "utf8"), /for \(const modulo of \["haiku-horas-edicion-v1"/);
});
