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
    let proporcionVisible;
    let anchoArea = 0;
    let altoCabecera = 0;
    let minimo = 25;
    let visibles = [];
    let panelSinRueda;
    let arrastre;
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

    function bloquearRueda(evento) {
        if (!evento.ctrlKey && !evento.metaKey) evento.preventDefault();
    }

    function sincronizarRueda(panel) {
        if (panel === panelSinRueda) return;
        // Mantener la rueda nativa en el panel activo y en sus visores.
        panelSinRueda?.removeEventListener("wheel", bloquearRueda);
        panel?.addEventListener("wheel", bloquearRueda, { passive: false });
        panelSinRueda = panel;
    }

    function limitarProporcion(valor) {
        return Math.max(minimo, Math.min(100 - minimo, valor));
    }

    function aplicarAncho(valor = proporcion) {
        if (area.dataset.haikuVista !== "doble") return;
        const acotado = limitarProporcion(valor);
        if (acotado === proporcionVisible) return;
        proporcionVisible = acotado;
        area.style.gridTemplateColumns = `minmax(0, ${acotado}fr) ${ANCHO_SEPARADOR}px minmax(0, ${100 - acotado}fr)`;
        const porcentaje = String(Math.round(acotado));
        if (separador.getAttribute("aria-valuenow") !== porcentaje || !separador.hasAttribute("aria-valuetext")) {
            separador.setAttribute("aria-valuenow", porcentaje);
            separador.setAttribute("aria-valuetext", porcentaje + " % para el panel izquierdo");
        }
    }

    function pintar(modoVista = area.dataset.haikuVista) {
        const focoAnterior = area.querySelector(".seccion-app[data-haiku-vista-foco]");
        const foco = seccionEnFoco();
        const compacto = modoVista === "alternada";
        const siguientes = compacto ? [paneles[ladoEnFoco]] : paneles.slice();
        for (const id of visibles) {
            if (siguientes.includes(id)) continue;
            const { seccion } = rutas.get(id);
            const { scrollTop: top, scrollLeft: left } = seccion;
            if (top || left) posiciones.set(id, { top, left });
            else posiciones.delete(id);
        }

        if (area.dataset.haikuVista !== modoVista) {
            area.dataset.haikuVista = modoVista;
            if (compacto) {
                area.style.removeProperty("grid-template-columns");
                proporcionVisible = undefined;
            }
            controles.hidden = false;
            separador.hidden = intercambiar.hidden = compacto;
            alternar.hidden = !compacto;
            dividir.setAttribute("aria-pressed", "true");
            dividir.title = "Volver a una sola sección";
        }
        sincronizarRueda(compacto ? undefined : rutas.get(paneles[1 - ladoEnFoco]).seccion);
        if (compacto) {
            const texto = "Ver " + nombre(paneles[1 - ladoEnFoco]);
            if (alternar.textContent !== texto) alternar.textContent = texto;
        }

        for (const [id, { boton, seccion }] of rutas) {
            const lado = paneles.indexOf(id);
            seccion.classList.toggle("activa", lado !== -1);
            if (lado === -1) delete seccion.dataset.haikuVistaLado;
            else if (seccion.dataset.haikuVistaLado !== String(lado)) seccion.dataset.haikuVistaLado = lado;
            seccion.toggleAttribute("data-haiku-vista-foco", seccion === foco);
            boton.classList.toggle("activo", seccion === foco);
        }
        selectores.forEach((selector, lado) => {
            const oculto = compacto && lado !== ladoEnFoco;
            if (selector.hidden !== oculto) selector.hidden = oculto;
            selector.toggleAttribute("data-haiku-vista-foco", lado === ladoEnFoco);
            const etiqueta = compacto ? "Sección mostrada" :
                (lado === 0 ? "Sección del panel izquierdo" : "Sección del panel derecho");
            if (selector.getAttribute("aria-label") !== etiqueta) selector.setAttribute("aria-label", etiqueta);
            for (const opcion of selector.options) {
                const ocupada = opcion.value === paneles[1 - lado];
                if (opcion.disabled !== ocupada) opcion.disabled = ocupada;
            }
            if (selector.value !== paneles[lado]) selector.value = paneles[lado];
        });

        const izquierdo = rutas.get(paneles[0]).seccion.id;
        if (separador.getAttribute("aria-controls") !== izquierdo) separador.setAttribute("aria-controls", izquierdo);
        for (const id of siguientes) {
            if (visibles.includes(id) || !posiciones.has(id)) continue;
            rutas.get(id).seccion.scrollTo({ ...posiciones.get(id), behavior: "instant" });
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
        terminarArrastre();
        sincronizarRueda();
        delete area.dataset.haikuVista;
        area.style.removeProperty("grid-template-columns");
        proporcionVisible = undefined;
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
            if (selector.length !== opciones.length || opciones.some((id, i) => selector.options[i].value !== id)) {
                selector.replaceChildren(...opciones.map(id => new Option(nombre(id), id)));
            }
        }
        if (area.dataset.haikuVista) pintar();
        else medirVista();
    }

    function abrir() {
        const opciones = [...rutas.keys()].filter(disponible);
        if (opciones.length < 2) return;
        const actual = opciones.find(id => rutas.get(id).seccion.classList.contains("activa")) || opciones[0];
        const sugerida = actual === "libro-reserva" ? "resumen" : "libro-reserva";
        paneles = [actual, opciones.includes(sugerida) ? sugerida : opciones.find(id => id !== actual)];
        ladoEnFoco = 0;
        proporcion = 50;
        if (window.scrollY) posiciones.set(actual, { top: window.scrollY, left: 0 });
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
        selector.addEventListener("change", () => {
            const id = selector.value;
            if (!disponible(id)) return;
            ladoEnFoco = lado;
            rutas.get(id).boton.click();
        });
    });
    function elegirPanel(evento) {
        const seccion = evento.target.closest(SELECTOR_PANEL);
        if (seccion) enfocar(Number(seccion.dataset.haikuVistaLado));
    }
    area.addEventListener("pointerdown", elegirPanel);
    area.addEventListener("focusin", elegirPanel);

    function proporcionArrastrada(clientX) {
        const delta = (clientX - arrastre.inicioX) * 100 / arrastre.espacio;
        return limitarProporcion(arrastre.inicial + delta);
    }

    function terminarArrastre(confirmar = false) {
        if (!arrastre) return;
        const { puntero, cuadro, inicial, valor } = arrastre;
        arrastre = undefined;
        if (cuadro) cancelAnimationFrame(cuadro);
        if (confirmar && valor !== inicial) proporcion = valor;
        aplicarAncho();
        delete area.dataset.haikuVistaArrastre;
        if (separador.hasPointerCapture(puntero)) separador.releasePointerCapture(puntero);
    }

    separador.addEventListener("pointerdown", evento => {
        if (evento.button !== 0 || arrastre || area.dataset.haikuVista !== "doble") return;
        evento.preventDefault();
        separador.focus({ preventScroll: true });
        separador.setPointerCapture(evento.pointerId);
        const espacio = anchoArea - ANCHO_SEPARADOR;
        const inicial = limitarProporcion(proporcion);
        arrastre = {
            puntero: evento.pointerId, inicioX: evento.clientX, espacio,
            inicial, valor: inicial, cuadro: 0
        };
        area.dataset.haikuVistaArrastre = "";
    });
    separador.addEventListener("pointermove", evento => {
        if (arrastre?.puntero !== evento.pointerId) return;
        arrastre.valor = proporcionArrastrada(evento.clientX);
        if (arrastre.cuadro) return;
        // Una sola escritura por cuadro ajusta a la vez los dos paneles y el divisor.
        arrastre.cuadro = requestAnimationFrame(() => {
            arrastre.cuadro = 0;
            aplicarAncho(arrastre.valor);
        });
    });
    separador.addEventListener("pointerup", evento => {
        if (arrastre?.puntero !== evento.pointerId) return;
        arrastre.valor = proporcionArrastrada(evento.clientX);
        terminarArrastre(true);
    });
    for (const evento of ["pointercancel", "lostpointercapture"]) {
        separador.addEventListener(evento, e => {
            if (arrastre?.puntero === e.pointerId) terminarArrastre();
        });
    }
    window.addEventListener("blur", () => terminarArrastre());
    separador.addEventListener("dblclick", () => {
        proporcion = 50;
        aplicarAncho();
    });
    separador.addEventListener("keydown", evento => {
        if (evento.key === "Escape" && arrastre) {
            evento.preventDefault();
            terminarArrastre();
            return;
        }
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
        terminarArrastre();
        proporcion = valores[evento.key];
        aplicarAncho();
    });

    function medirVista() {
        const ancho = area.clientWidth;
        const alto = cabecera.offsetHeight;
        const vista = ancho >= ANCHO_DOBLE ? "doble" : "alternada";
        const cambiaModo = vista !== area.dataset.haikuVista;
        if (ancho !== anchoArea) {
            terminarArrastre();
            anchoArea = ancho;
        }
        if (alto !== altoCabecera) {
            altoCabecera = alto;
            area.style.setProperty("--haiku-vista-cabecera", alto + "px");
        }
        if (cambiaModo) pintar(vista);
        if (vista === "doble") {
            const limite = Math.max(25, Math.ceil(ANCHO_MINIMO_PANEL * 100 / (ancho - ANCHO_SEPARADOR)));
            if (limite !== minimo) {
                minimo = limite;
                separador.setAttribute("aria-valuemin", minimo);
                separador.setAttribute("aria-valuemax", 100 - minimo);
            }
            if (!arrastre) aplicarAncho();
        }
    }

    const ajustarAlEspacio = new ResizeObserver(() => {
        if (paneles.length) medirVista();
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
