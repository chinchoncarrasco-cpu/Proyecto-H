(() => {
    "use strict";

    const raiz = document.getElementById("seccion-cierre");
    const abrir = document.getElementById("sites-cierre-personificar");
    const base = window.HAIKU_CIERRE_PLANTILLA_V1;
    const cliente = window.haikuSupabase;
    if (!raiz || !abrir || !base || !cliente) return;

    const dialogo = document.createElement("dialog");
    dialogo.className = "turno-editor";
    dialogo.setAttribute("aria-labelledby", "turno-editor-titulo");
    dialogo.innerHTML = `
        <header class="turno-editor-header">
            <h2 id="turno-editor-titulo">Personificar cierre de turno</h2>
            <button type="button" class="turno-button turno-editor-icon" data-accion="cancelar" aria-label="Cerrar editor">×</button>
        </header>
        <div class="turno-editor-layout">
            <nav class="turno-editor-nav" aria-label="Secciones del cierre"></nav>
            <div class="turno-editor-body">
                <div class="turno-editor-select">
                    <select aria-label="Sección para editar"></select>
                    <button type="button" class="turno-button" data-accion="agregar-seccion">+ Sección</button>
                </div>
                <div class="turno-editor-contenido"></div>
            </div>
        </div>
        <p class="turno-editor-error" role="alert" hidden></p>
        <footer class="turno-editor-footer">
            <p>Se aplica a los turnos que aún no se han iniciado.</p>
            <div class="turno-actions">
                <button type="button" class="turno-button" data-accion="cancelar">Cancelar</button>
                <button type="button" class="turno-button turno-primary" data-accion="guardar" disabled>Guardar plantilla</button>
            </div>
        </footer>`;
    raiz.append(dialogo);

    const nav = dialogo.querySelector("nav");
    const selector = dialogo.querySelector("select");
    const contenido = dialogo.querySelector(".turno-editor-contenido");
    const error = dialogo.querySelector("[role=alert]");
    const guardar = dialogo.querySelector("[data-accion=guardar]");
    const uuid = () => crypto.randomUUID().replaceAll("-", "");
    const puedeEditar = () => window.haikuTienePermiso?.("configuracion.gestionar") && window.haikuTienePermiso?.("cierres.ver");
    const texto = (tag, valor) => {
        const nodo = document.createElement(tag);
        nodo.textContent = valor;
        return nodo;
    };
    let editor;

    async function rpc(nombre, args) {
        const { data, error } = await cliente.rpc(nombre, args);
        if (error) throw error;
        return data;
    }

    function acceso() {
        abrir.hidden = !puedeEditar();
        if (abrir.hidden && dialogo.open) dialogo.close();
    }

    function boton(accion, valor, etiqueta) {
        const nodo = texto("button", valor);
        nodo.type = "button";
        nodo.className = "turno-button";
        nodo.dataset.accion = accion;
        if (etiqueta) {
            nodo.setAttribute("aria-label", etiqueta);
            nodo.title = etiqueta;
        }
        return nodo;
    }

    function secciones() {
        const { borrador } = editor;
        return [
            { id: "pantalla", titulo: "Pantalla", datos: borrador },
            ...borrador.grupos.map(datos => ({ id: datos.id, titulo: datos.titulo, datos })),
            { id: "cabanas", titulo: borrador.cabanas.titulo, datos: borrador.cabanas },
            { id: "entrega", titulo: borrador.entrega.titulo, datos: borrador.entrega }
        ];
    }

    function seccion() {
        return secciones().find(s => s.id === editor.activa);
    }

    function campo(etiqueta, valor, clave, max, compacto = false) {
        const label = texto("label", "");
        label.className = compacto ? "turno-editor-field compacta" : "turno-editor-field";
        const input = document.createElement("input");
        input.value = valor;
        input.maxLength = max;
        input.dataset.campo = clave;
        input.setAttribute("aria-label", etiqueta);
        if (!compacto) label.append(texto("span", etiqueta));
        label.append(input);
        return label;
    }

    function controlesOrden(tipo, indice, total) {
        const caja = texto("span", "");
        caja.className = "turno-actions";
        const subir = boton(tipo + "-subir", "↑", "Subir " + tipo);
        const bajar = boton(tipo + "-bajar", "↓", "Bajar " + tipo);
        subir.disabled = indice === 0;
        bajar.disabled = indice === total - 1;
        caja.append(subir, bajar);
        return caja;
    }

    function mover(array, item, cambio) {
        const indice = array.indexOf(item);
        const destino = indice + cambio;
        if (indice < 0 || destino < 0 || destino >= array.length) return;
        [array[indice], array[destino]] = [array[destino], array[indice]];
    }

    function destinos(fila, zona) {
        if (zona === "llaves" || zona === "cabanas" || (zona === "entrega" && !fila.id.startsWith("tarea_"))) return null;
        const grupos = editor.borrador.grupos.filter(g => g.id !== zona && g.id !== "llaves");
        if (fila.id.startsWith("tarea_") && zona !== "entrega") grupos.push(editor.borrador.entrega);
        if (!grupos.length) return null;
        const menu = texto("details", "");
        menu.className = "turno-editor-mover";
        const cabecera = texto("summary", "↗");
        cabecera.setAttribute("aria-label", "Mover a otra sección");
        cabecera.title = "Mover a otra sección";
        const select = document.createElement("select");
        select.dataset.destino = "";
        select.setAttribute("aria-label", "Mover a otra sección");
        select.add(new Option("Mover a…", ""));
        grupos.forEach(g => select.add(new Option(g.titulo, g.id)));
        menu.append(cabecera, select);
        return menu;
    }

    function fila(item, zona, indice, total) {
        const nodo = texto("div", "");
        nodo.className = "turno-editor-item";
        nodo.dataset.item = item.id;
        const nombre = texto("div", "");
        nombre.className = "turno-editor-nombres";
        nombre.append(campo(zona === "llaves" ? "Nombre de la llave" : "Texto del control", item.texto, "texto", 160, true));
        if (zona === "llaves") nombre.append(campoDetalle(item));
        const controles = controlesOrden("elemento", indice, total);
        const mover = destinos(item, zona);
        if (mover) controles.append(mover);
        if (base.protegidos.includes(item.id)) {
            const requerido = texto("small", "Requerido");
            requerido.className = "turno-editor-requerido";
            controles.append(requerido);
        } else {
            controles.append(boton("archivar", item.activo ? "Ocultar" : "Restaurar"));
        }
        nodo.append(nombre, controles);
        return nodo;
    }

    function campoDetalle(item) {
        const detalle = document.createElement("input");
        detalle.dataset.campo = "detalle";
        detalle.value = item.detalle;
        detalle.maxLength = 100;
        detalle.placeholder = "Detalle opcional";
        detalle.setAttribute("aria-label", "Detalle de la llave");
        return detalle;
    }

    function actualizarNavegacion() {
        const areas = secciones();
        nav.replaceChildren(...areas.map(area => {
            const nodo = boton("seleccionar", area.titulo || "Sin nombre");
            nodo.dataset.zona = area.id;
            nodo.setAttribute("aria-pressed", String(area.id === editor.activa));
            return nodo;
        }), boton("agregar-seccion", "+ Sección"));
        selector.replaceChildren(...areas.map(a => new Option(a.titulo || "Sin nombre", a.id)));
        selector.value = editor.activa;
    }

    function render(foco) {
        actualizarNavegacion();
        const { id, datos } = seccion();
        const titulo = campo(id === "pantalla" ? "Título de la pantalla" : "Nombre de la sección", datos.titulo, "titulo", 90);
        const encabezado = texto("div", "");
        encabezado.className = "turno-editor-section-heading";
        encabezado.append(titulo);
        const indice = editor.borrador.grupos.indexOf(datos);
        if (indice >= 0) {
            const acciones = controlesOrden("sección", indice, editor.borrador.grupos.length);
            if (id.startsWith("seccion_") && !datos.items.length) acciones.append(boton("quitar-seccion", "Quitar sección"));
            encabezado.append(acciones);
        }
        contenido.replaceChildren(encabezado);
        if (id === "cabanas") contenido.append(campo("Ocupación", datos.ocupada, "ocupada", 160));
        if (id === "entrega") contenido.append(campo("Campo de novedades", datos.novedades, "novedades", 90),
            campo("Campo del resumen", datos.resumen, "resumen", 90));

        if (datos.items) {
            const activos = datos.items.filter(item => item.activo);
            const ocultos = datos.items.filter(item => !item.activo);
            contenido.append(...activos.map((item, i) => fila(item, id, i, activos.length)));
            contenido.append(boton("agregar", id === "llaves" ? "+ Llave" : "+ Control"));
            if (ocultos.length) {
                const detalle = texto("details", "");
                detalle.className = "turno-editor-archivados";
                detalle.append(texto("summary", `Ocultos (${ocultos.length})`),
                    ...ocultos.map(item => fila(item, id, 0, 1)));
                contenido.append(detalle);
            }
        }
        guardar.disabled = editor.ocupado || !cambio();
        if (foco) {
            const row = [...contenido.querySelectorAll("[data-item]")].find(nodo => nodo.dataset.item === foco);
            if (row?.closest("details")) row.closest("details").open = true;
            (row?.querySelector("input") || titulo.querySelector("input")).focus();
        }
    }

    function avisar(mensaje = "") {
        error.hidden = !mensaje;
        error.textContent = mensaje;
    }

    function cambio() {
        return !!editor?.borrador && JSON.stringify(editor.borrador) !== JSON.stringify(editor.original);
    }

    async function cancelar() {
        if (!editor || editor.ocupado) return;
        if (cambio() && !await window.HAIKU_DIALOGOS.confirmar("¿Descartar los cambios de la plantilla?", {
            titulo: "Salir de Personificar", accion: "Descartar"
        })) return;
        dialogo.close();
    }

    function validar(datos) {
        const { titulo, grupos, cabanas, entrega } = datos;
        const etiquetas = [titulo, cabanas.titulo, cabanas.ocupada, entrega.titulo, entrega.novedades, entrega.resumen,
            ...grupos.map(grupo => grupo.titulo)];
        if (etiquetas.some(v => !v.trim()) ||
            [...grupos, cabanas, entrega].some(grupo => grupo.items.some(item => !item.texto.trim()))) {
            return "Completa los nombres y los textos de los controles.";
        }
        if (!grupos.find(grupo => grupo.id === "llaves").items.some(item => item.activo)) {
            return "Deja al menos una llave activa en la lista.";
        }
        return "";
    }

    async function publicar() {
        if (!puedeEditar() || !cambio() || editor.ocupado) return;
        const actual = editor;
        const validacion = validar(actual.borrador);
        avisar(validacion);
        if (validacion) return;

        const firma = JSON.stringify(actual.borrador);
        if (actual.firma !== firma) {
            actual.solicitud = crypto.randomUUID();
            actual.firma = firma;
        }
        actual.ocupado = true;
        guardar.disabled = true;
        guardar.textContent = "Guardando…";
        dialogo.querySelector(".turno-editor-layout").inert = true;
        try {
            const r = await rpc("haiku_cierre_plantilla_publicar_v1", {
                p_version: actual.version, p_solicitud: actual.solicitud, p_plantilla: actual.borrador
            });
            if (!r?.version) throw Error("No se pudo confirmar el guardado.");
            if (editor !== actual) return;
            dialogo.close();
            const fecha = typeof fechaSeleccionada === "string" ? fechaSeleccionada : "";
            const turno = await window.haikuCargarCierreSupabase?.(fecha);
            await window.haikuRefrescarEstadoCierre?.();
            window.HAIKU_DIALOGOS.aviso(turno?.version === r.version
                ? "Plantilla del cierre guardada."
                : "Plantilla guardada para los turnos por iniciar.");
        } catch (err) {
            if (editor === actual) avisar(err.message || "No se pudo guardar la plantilla.");
        } finally {
            actual.ocupado = false;
            guardar.disabled = !cambio();
            guardar.textContent = "Guardar plantilla";
            dialogo.querySelector(".turno-editor-layout").inert = false;
        }
    }

    abrir.addEventListener("click", async () => {
        if (dialogo.open || !puedeEditar()) return;
        const actual = { activa: "pantalla", ocupado: false };
        editor = actual;
        guardar.disabled = true;
        avisar();
        nav.replaceChildren();
        selector.replaceChildren();
        contenido.replaceChildren(texto("p", "Cargando plantilla…"));
        dialogo.showModal();
        try {
            const respuesta = await rpc("haiku_cierre_plantilla_editar_v1");
            if (editor !== actual) return;
            if (!respuesta?.plantilla || !respuesta.version) throw Error("No se pudo cargar la plantilla.");
            Object.assign(actual, { version: respuesta.version, original: respuesta.plantilla,
                borrador: structuredClone(respuesta.plantilla) });
            render();
        } catch (err) {
            if (editor !== actual) return;
            contenido.replaceChildren();
            avisar(err.message || "No se pudo cargar la plantilla.");
        }
    });

    dialogo.addEventListener("input", event => {
        const clave = event.target.dataset.campo;
        if (!clave || !editor?.borrador) return;
        const datos = seccion().datos;
        const fila = event.target.closest("[data-item]");
        const objeto = fila ? datos.items.find(item => item.id === fila.dataset.item) : datos;
        objeto[clave] = event.target.value;
        if (clave === "titulo") actualizarNavegacion();
        guardar.disabled = !cambio();
    });

    dialogo.addEventListener("change", event => {
        if (!editor?.borrador) return;
        if (event.target === selector) {
            editor.activa = selector.value;
            render();
        } else if (event.target.hasAttribute("data-destino") && event.target.value) {
            const { datos } = seccion();
            const destino = secciones().find(s => s.id === event.target.value);
            const codigo = event.target.closest("[data-item]").dataset.item;
            const indice = datos.items.findIndex(item => item.id === codigo);
            destino.datos.items.push(...datos.items.splice(indice, 1));
            editor.activa = destino.id;
            render(codigo);
        }
    });

    dialogo.addEventListener("click", event => {
        const nodo = event.target.closest("[data-accion]");
        const accion = nodo?.dataset.accion;
        if (accion === "cancelar") { void cancelar(); return; }
        if (accion === "guardar") { void publicar(); return; }
        if (!accion || !editor?.borrador || editor.ocupado) return;

        const { id, datos } = seccion();
        const grupos = editor.borrador.grupos;
        let foco = nodo.closest("[data-item]")?.dataset.item;
        const item = datos.items?.find(item => item.id === foco);
        if (accion === "seleccionar") editor.activa = nodo.dataset.zona;
        else if (accion === "agregar-seccion") {
            editor.activa = "seccion_" + uuid();
            grupos.push({ id: editor.activa, titulo: "Nueva sección", items: [] });
            foco = "titulo";
        } else if (accion === "quitar-seccion") {
            grupos.splice(grupos.indexOf(datos), 1);
            editor.activa = "pantalla";
        } else if (accion.startsWith("sección-")) {
            mover(grupos, datos, accion.endsWith("-subir") ? -1 : 1);
            foco = "titulo";
        } else if (accion === "agregar") {
            const llave = id === "llaves";
            foco = (llave ? "llave_" : id === "cabanas" ? "cabana_tarea_" : "tarea_") + uuid();
            datos.items.push({ id: foco, texto: "", activo: true, ...(llave ? { detalle: "" } : {}) });
        } else if (accion === "archivar" && item) item.activo = !item.activo;
        else if (accion.startsWith("elemento-") && item) {
            const activos = datos.items.filter(fila => fila.activo);
            mover(activos, item, accion.endsWith("-subir") ? -1 : 1);
            let i = 0;
            datos.items = datos.items.map(fila => fila.activo ? activos[i++] : fila);
        }
        avisar();
        render(foco);
    });

    dialogo.addEventListener("cancel", event => { event.preventDefault(); void cancelar(); });
    dialogo.addEventListener("close", () => { editor = null; abrir.focus(); });
    window.addEventListener("haiku:auth-ready", acceso);
    acceso();
})();
