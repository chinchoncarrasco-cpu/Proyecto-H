(() => {
    "use strict";

    const area = document.getElementById("haiku-area-trabajo");
    const cabecera = document.querySelector(".haiku-cereza-cabecera");
    const dividir = document.getElementById("haiku-vista-dividir");
    if (!area || !cabecera || !dividir || document.documentElement.dataset.hakuMobileAssistant === "1") return;

    const navegacion = cabecera.querySelector(".haiku-cereza-navegacion");
    const controles = document.getElementById("haiku-vista-controles");
    const separador = document.getElementById("haiku-vista-separador");
    const intercambiar = document.getElementById("haiku-vista-intercambiar");
    const alternar = document.getElementById("haiku-vista-alternar");
    const selectores = ["izquierda", "derecha"].map(lado => document.getElementById("haiku-vista-" + lado));
    const rutas = new Map();
    for (const boton of navegacion.querySelectorAll(".menu-item[data-seccion]")) {
        const id = boton.dataset.seccion;
        const seccion = document.getElementById("seccion-" + id);
        if (seccion?.parentElement === area) rutas.set(id, { boton, seccion });
    }

    const ANCHO_DOBLE = 960;
    const ANCHO_MINIMO_PANEL = 320;
    const ANCHO_SEPARADOR = 12;
    const SELECTOR_PANEL = ".seccion-app[data-haiku-vista-lado]";
    let paneles = [];
    let ladoEnFoco = 0;
    let proporcion = 50;
    let visibles = [];
    const posiciones = new Map();

    function disponible(id) {
        const ruta = rutas.get(id);
        return Boolean(ruta && !ruta.boton.closest("[hidden]") && !ruta.boton.disabled && !ruta.seccion.hidden);
    }

    function nombre(id) {
        return rutas.get(id).boton.textContent.trim();
    }

    function seccionEnFoco() {
        return rutas.get(paneles[ladoEnFoco])?.seccion;
    }

    function contenerRueda(evento) {
        if (evento.ctrlKey || evento.metaKey) return;
        const seccion = evento.target.closest(SELECTOR_PANEL);
        // El panel seleccionado y sus visores conservan el desplazamiento nativo.
        if (seccion && seccion !== seccionEnFoco()) evento.preventDefault();
    }

    function modo() {
        return area.clientWidth >= ANCHO_DOBLE ? "doble" : "alternada";
    }

    function actualizarAncho() {
        if (area.dataset.haikuVista !== "doble") return;
        const util = area.clientWidth - ANCHO_SEPARADOR;
        const minimo = Math.max(25, Math.ceil(ANCHO_MINIMO_PANEL * 100 / util));
        const maximo = 100 - minimo;
        const valor = Math.max(minimo, Math.min(maximo, proporcion));
        area.style.setProperty("--haiku-vista-izquierda", valor + "fr");
        area.style.setProperty("--haiku-vista-derecha", (100 - valor) + "fr");
        separador.setAttribute("aria-valuemin", minimo);
        separador.setAttribute("aria-valuemax", maximo);
        separador.setAttribute("aria-valuenow", valor);
        separador.setAttribute("aria-valuetext", valor + " % para el panel izquierdo");
    }

    function pintar() {
        const focoAnterior = area.querySelector(".seccion-app[data-haiku-vista-foco]");
        const foco = seccionEnFoco();
        const modoVista = modo();
        const compacto = modoVista === "alternada";
        for (const id of visibles) {
            const { seccion } = rutas.get(id);
            posiciones.set(id, { top: seccion.scrollTop, left: seccion.scrollLeft });
        }

        area.dataset.haikuVista = modoVista;
        if (compacto) area.removeEventListener("wheel", contenerRueda);
        else area.addEventListener("wheel", contenerRueda, { passive: false });
        area.style.setProperty("--haiku-vista-cabecera", cabecera.offsetHeight + "px");
        controles.hidden = false;
        separador.hidden = intercambiar.hidden = compacto;
        alternar.hidden = !compacto;
        alternar.textContent = "Ver " + nombre(paneles[1 - ladoEnFoco]);
        dividir.setAttribute("aria-pressed", "true");
        dividir.title = "Volver a una sola sección";

        for (const [id, { boton, seccion }] of rutas) {
            const lado = paneles.indexOf(id);
            seccion.classList.toggle("activa", lado !== -1);
            if (lado === -1) delete seccion.dataset.haikuVistaLado;
            else seccion.dataset.haikuVistaLado = lado;
            seccion.toggleAttribute("data-haiku-vista-foco", seccion === foco);
            boton.classList.toggle("activo", seccion === foco);
        }
        selectores.forEach((selector, lado) => {
            selector.hidden = compacto && lado !== ladoEnFoco;
            selector.toggleAttribute("data-haiku-vista-foco", lado === ladoEnFoco);
            selector.setAttribute("aria-label", compacto ? "Sección mostrada" :
                (lado === 0 ? "Sección del panel izquierdo" : "Sección del panel derecho"));
            for (const opcion of selector.options) opcion.disabled = opcion.value === paneles[1 - lado];
            selector.value = paneles[lado];
        });

        separador.setAttribute("aria-controls", rutas.get(paneles[0]).seccion.id);
        actualizarAncho();
        const siguientes = compacto ? [paneles[ladoEnFoco]] : paneles.slice();
        for (const id of siguientes) {
            if (!visibles.includes(id) && posiciones.has(id)) rutas.get(id).seccion.scrollTo(posiciones.get(id));
        }
        visibles = siguientes;
        if (foco !== focoAnterior) window.dispatchEvent(new Event("haiku:vista-dividida-foco"));
    }

    function cerrar() {
        const id = disponible(paneles[ladoEnFoco]) ? paneles[ladoEnFoco] : [...rutas.keys()].find(disponible);
        const scroll = seccionEnFoco()?.scrollTop || 0;
        paneles = [];
        visibles = [];
        posiciones.clear();
        area.removeEventListener("wheel", contenerRueda);
        delete area.dataset.haikuVista;
        delete area.dataset.haikuVistaArrastre;
        controles.hidden = separador.hidden = true;
        dividir.setAttribute("aria-pressed", "false");
        dividir.title = "Dividir pantalla";

        for (const [clave, { boton, seccion }] of rutas) {
            delete seccion.dataset.haikuVistaLado;
            seccion.removeAttribute("data-haiku-vista-foco");
            seccion.classList.toggle("activa", clave === id);
            boton.classList.toggle("activo", clave === id);
        }
        if (id) localStorage.setItem("haikuSeccionActual", id);
        window.scrollTo({ top: scroll, behavior: "instant" });
        window.dispatchEvent(new Event("haiku:vista-dividida-foco"));
    }

    function actualizarOpciones() {
        const opciones = [...rutas.keys()].filter(disponible);
        dividir.hidden = opciones.length < 2;
        if (!paneles.length) return;
        if (opciones.length < 2) {
            cerrar();
            return;
        }
        const libres = opciones.filter(id => !paneles.includes(id));
        paneles = paneles.map(id => opciones.includes(id) ? id : libres.shift());
        for (const selector of selectores) {
            selector.replaceChildren(...opciones.map(id => new Option(nombre(id), id)));
        }
        pintar();
    }

    function abrir() {
        const opciones = [...rutas.keys()].filter(disponible);
        if (opciones.length < 2) return;
        const actual = opciones.find(id => rutas.get(id).seccion.classList.contains("activa")) || opciones[0];
        const sugerida = actual === "libro-reserva" ? "resumen" : "libro-reserva";
        paneles = [actual, opciones.includes(sugerida) ? sugerida : opciones.find(id => id !== actual)];
        ladoEnFoco = 0;
        proporcion = 50;
        posiciones.set(actual, { top: window.scrollY, left: 0 });
        actualizarOpciones();
    }

    function enfocar(lado) {
        if (lado === ladoEnFoco) return;
        ladoEnFoco = lado;
        pintar();
    }

    function navegar(id) {
        if (!paneles.length) return false;
        if (!disponible(id)) return true;
        const lado = paneles.indexOf(id);
        if (lado === -1) {
            paneles[ladoEnFoco] = id;
            pintar();
        } else {
            enfocar(lado);
        }
        return true;
    }

    dividir.addEventListener("click", () => paneles.length ? cerrar() : abrir());
    intercambiar.addEventListener("click", () => {
        paneles.reverse();
        ladoEnFoco = 1 - ladoEnFoco;
        pintar();
    });
    alternar.addEventListener("click", () => enfocar(1 - ladoEnFoco));
    selectores.forEach((selector, lado) => {
        selector.addEventListener("focus", () => enfocar(lado));
        selector.addEventListener("change", () => {
            const id = selector.value;
            enfocar(lado);
            if (disponible(id)) rutas.get(id).boton.click();
        });
    });
    function elegirPanel(evento) {
        const seccion = evento.target.closest(SELECTOR_PANEL);
        if (seccion) enfocar(Number(seccion.dataset.haikuVistaLado));
    }
    area.addEventListener("pointerdown", elegirPanel);
    area.addEventListener("focusin", elegirPanel);

    separador.addEventListener("pointerdown", evento => {
        if (evento.button !== 0) return;
        evento.preventDefault();
        separador.focus({ preventScroll: true });
        separador.setPointerCapture(evento.pointerId);
        area.dataset.haikuVistaArrastre = "";
    });
    separador.addEventListener("pointermove", evento => {
        if (!separador.hasPointerCapture(evento.pointerId)) return;
        const { left, width } = area.getBoundingClientRect();
        proporcion = Math.round((evento.clientX - left - ANCHO_SEPARADOR / 2) * 100 / (width - ANCHO_SEPARADOR));
        actualizarAncho();
    });
    separador.addEventListener("lostpointercapture", () => { delete area.dataset.haikuVistaArrastre; });
    separador.addEventListener("dblclick", () => {
        proporcion = 50;
        actualizarAncho();
    });
    separador.addEventListener("keydown", evento => {
        const actual = Number(separador.getAttribute("aria-valuenow"));
        const valores = {
            ArrowLeft: actual - 5,
            ArrowRight: actual + 5,
            Home: Number(separador.getAttribute("aria-valuemin")),
            End: Number(separador.getAttribute("aria-valuemax")),
            Enter: 50
        };
        if (!Object.hasOwn(valores, evento.key)) return;
        evento.preventDefault();
        proporcion = valores[evento.key];
        actualizarAncho();
    });

    const ajustarAlEspacio = new ResizeObserver(() => {
        if (!paneles.length) return;
        if (modo() !== area.dataset.haikuVista) pintar();
        else {
            area.style.setProperty("--haiku-vista-cabecera", cabecera.offsetHeight + "px");
            actualizarAncho();
        }
    });
    ajustarAlEspacio.observe(area);
    ajustarAlEspacio.observe(cabecera);
    new MutationObserver(actualizarOpciones).observe(navegacion, {
        subtree: true, attributes: true, attributeFilter: ["hidden", "disabled"]
    });
    window.haikuSupabase?.auth?.onAuthStateChange?.(evento => {
        if (evento === "SIGNED_OUT" && paneles.length) cerrar();
    });
    window.HAIKU_VISTA_DIVIDIDA_V1 = Object.freeze({ navegar, seccionEnFoco });
    actualizarOpciones();
})();
