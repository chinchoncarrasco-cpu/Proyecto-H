const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const fuente = fs.readFileSync(require.resolve("../js/sites-resumen-drawer-v1.js"), "utf8");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const estilos = fs.readFileSync(require.resolve("../css/sites-resumen-v1.css"), "utf8");
const app = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
const cabanas = fs.readFileSync(require.resolve("../js/cabanas.js"), "utf8");

function montar() {
    const listeners = new Map();
    const observadores = new Map();
    const animaciones = [];
    const documento = {
        activeElement: null,
        body: { style: { overflow: "scroll" } },
        getElementById(id) {
            return id === "panel-agregar-nota" ? nota
                : id === "resumen-servicio-modal" ? servicio : null;
        },
        addEventListener(tipo, callback) { listeners.set(tipo, callback); }
    };
    const foco = (id, panel = null) => ({
        id, panel, disabled: false, tabIndex: 0, isConnected: true,
        getClientRects: () => [{}],
        focus() { documento.activeElement = this; }
    });
    function panel(id, campoId, cerrarId) {
        const elementos = [foco(cerrarId), foco(campoId), foco(`${id}-cancelar`), foco(`${id}-guardar`)];
        const controles = new Map(elementos.map(elemento => [elemento.id, elemento]));
        const resultado = {
            id, elementos, cierre: elementos[0], campo: elementos[1],
            clicksCierre: 0, _hidden: id === "resumen-servicio-modal",
            querySelector(selector) { return controles.get(selector.slice(1)) || null; },
            querySelectorAll() { return elementos; },
            contains(elemento) { return elementos.includes(elemento); },
            addEventListener(tipo, callback) { this[`on${tipo}`] = callback; }
        };
        for (const elemento of elementos) elemento.panel = resultado;
        let activo = false;
        resultado.classList = {
            contains(nombre) { return nombre === "activo" && activo; },
            add(nombre) { if (nombre === "activo") { activo = true; observadores.get(resultado)?.(); } },
            remove(nombre) { if (nombre === "activo") { activo = false; observadores.get(resultado)?.(); } }
        };
        Object.defineProperty(resultado, "hidden", {
            get() { return this._hidden; },
            set(valor) { this._hidden = valor; observadores.get(this)?.(); }
        });
        resultado.cierre.click = () => {
            resultado.clicksCierre++;
            if (resultado.id === "panel-agregar-nota") resultado.classList.remove("activo");
            else resultado.hidden = true;
        };
        return resultado;
    }
    const nota = panel("panel-agregar-nota", "nota-texto", "cerrar-panel-nota");
    const servicio = panel("resumen-servicio-modal", "resumen-servicio-producto", "resumen-servicio-cerrar");
    class MutationObserverFalso {
        constructor(callback) { this.callback = callback; }
        observe(elemento) { observadores.set(elemento, this.callback); }
    }
    const ventana = {};
    vm.runInNewContext(fuente, {
        window: ventana, document: documento, MutationObserver: MutationObserverFalso,
        requestAnimationFrame: callback => animaciones.push(callback)
    });
    function animar() { while (animaciones.length) animaciones.shift()(); }
    function abrir(tipo) {
        const objetivo = tipo === "nota" ? nota : servicio;
        const disparador = foco(`abrir-${tipo}`);
        disparador.hasAttribute = atributo => tipo === "nota" && atributo === "data-agregar-nota-cabana";
        disparador.closest = () => disparador;
        listeners.get("click")({ target: disparador });
        if (tipo === "nota") objetivo.classList.add("activo");
        else objetivo.hidden = false;
        animar();
        return { panel: objetivo, disparador };
    }
    function tecla(key, shiftKey = false) {
        const evento = {
            key, shiftKey, prevented: false, stopped: false,
            preventDefault() { this.prevented = true; },
            stopImmediatePropagation() { this.stopped = true; }
        };
        listeners.get("keydown")(evento);
        animar();
        return evento;
    }
    function registrarDinamico() {
        const dinamico = panel("sites-resumen-pago-drawer", "pago-monto", "pago-cerrar");
        dinamico.hidden = true;
        let cierres = 0;
        ventana.HAIKU_SITES_RESUMEN_DRAWER_V1.registrar(dinamico, {
            cerrar() { cierres++; dinamico.hidden = true; },
            focoInicial: () => dinamico.campo
        });
        const disparador = foco("abrir-pago");
        ventana.HAIKU_SITES_RESUMEN_DRAWER_V1.marcarDisparador(dinamico, disparador);
        return { panel: dinamico, disparador, cierres: () => cierres };
    }
    return { nota, servicio, documento, abrir, tecla, animar, ventana, registrarDinamico };
}

test("un drawer dinámico conserva foco, Escape y fondo sin duplicar el gestor", () => {
    const caso = montar();
    const dinamico = caso.registrarDinamico();
    dinamico.panel.hidden = false;
    caso.animar();
    assert.equal(caso.documento.activeElement, dinamico.panel.campo);
    assert.equal(caso.documento.body.style.overflow, "hidden");
    assert.equal(caso.tecla("Escape").prevented, true);
    assert.equal(dinamico.cierres(), 1);
    assert.equal(caso.documento.activeElement, dinamico.disparador);
    assert.equal(caso.documento.body.style.overflow, "scroll");

    dinamico.panel.hidden = false;
    caso.animar();
    dinamico.panel.onclick({ target: dinamico.panel });
    caso.animar();
    assert.equal(dinamico.cierres(), 2);
    assert.equal(caso.documento.activeElement, dinamico.disparador);
});

test("Nota y Servicio conservan un solo drawer real, con IDs y acciones existentes", () => {
    for (const id of ["panel-agregar-nota", "resumen-servicio-modal"]) {
        assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
    }
    assert.equal((html.match(/src="js\/sites-resumen-drawer-v1\.js"/g) || []).length, 1);
    for (const id of ["cerrar-panel-nota", "cancelar-nota", "guardar-nota",
        "resumen-servicio-cerrar", "resumen-servicio-cancelar", "resumen-servicio-guardar"]) {
        assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
    }
    assert.equal((html.match(/class="[^"]*sites-resumen-drawer-panel" role="dialog" aria-modal="true"/g) || []).length, 2);
    assert.ok(app.includes('botonCerrarNota.addEventListener("click"'));
    assert.ok(app.includes('botonCancelarNota.addEventListener("click"'));
    assert.ok(app.includes("cerrarPanelNota();"));
    assert.ok(cabanas.includes('document.getElementById("resumen-servicio-cerrar")'));
    assert.ok(cabanas.includes('document.getElementById("resumen-servicio-cancelar")'));
    const cierreServicio = cabanas.slice(cabanas.indexOf("if (btnCerrarServicioResumen) {"),
        cabanas.indexOf("if (btnCancelarServicioResumen) {") + 180);
    assert.equal((cierreServicio.match(/"click",\s*cerrarModalServicioResumen/g) || []).length, 2);
});

for (const tipo of ["nota", "servicio"]) {
    test(`${tipo}: foco inicial, Escape, fondo y X cierran y devuelven foco`, () => {
        const caso = montar();
        const primera = caso.abrir(tipo);
        assert.equal(caso.documento.body.style.overflow, "hidden");
        assert.equal(caso.documento.activeElement, primera.panel.campo);

        const escape = caso.tecla("Escape");
        assert.equal(escape.prevented, true);
        assert.equal(escape.stopped, true);
        assert.equal(primera.panel.clicksCierre, 1);
        assert.equal(caso.documento.activeElement, primera.disparador);
        assert.equal(caso.documento.body.style.overflow, "scroll");

        const segunda = caso.abrir(tipo);
        segunda.panel.onclick({ target: segunda.panel });
        caso.animar();
        assert.equal(segunda.panel.clicksCierre, 2);
        assert.equal(caso.documento.activeElement, segunda.disparador);

        const tercera = caso.abrir(tipo);
        tercera.panel.cierre.click();
        caso.animar();
        assert.equal(tercera.panel.clicksCierre, 3);
        assert.equal(caso.documento.activeElement, tercera.disparador);
    });

    test(`${tipo}: Tab queda dentro del drawer en ambos extremos`, () => {
        const caso = montar();
        const { panel } = caso.abrir(tipo);
        panel.elementos.at(-1).focus();
        const adelante = caso.tecla("Tab");
        assert.equal(adelante.prevented, true);
        assert.equal(caso.documento.activeElement, panel.elementos[0]);
        const atras = caso.tecla("Tab", true);
        assert.equal(atras.prevented, true);
        assert.equal(caso.documento.activeElement, panel.elementos.at(-1));
    });
}

test("La capa visual comparte panel lateral y cubre el ancho móvil", () => {
    assert.ok(estilos.includes("#panel-agregar-nota.sites-resumen-drawer,"));
    assert.ok(estilos.includes("#resumen-servicio-modal.sites-resumen-drawer"));
    assert.ok(estilos.includes("width: min(420px, 100vw)"));
    assert.ok(estilos.includes("height: 100dvh"));
    assert.ok(estilos.includes("@media (max-width: 600px)"));
    assert.ok(estilos.includes(".sites-resumen-drawer .sites-resumen-drawer-panel { width: 100vw; }"));
});
