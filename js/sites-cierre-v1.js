// Presentación del Cierre. El estado definitivo proviene de Supabase.
(() => {
    "use strict";

    const root = document.getElementById("seccion-cierre");
    const plantilla = window.HAIKU_CIERRE_PLANTILLA_V1;
    if (!root || !plantilla) return;

    const $ = selector => root.querySelector(selector);
    const $$ = selector => [...root.querySelectorAll(selector)];
    const fechaActual = () => typeof fechaSeleccionada === "string" ? fechaSeleccionada.slice(0, 10) : "";
    const filtros = { todas: "Todas", pendientes: "Pendientes", observaciones: "Observaciones", completas: "Revisadas" };
    const evidencias = new Map();
    const revisiones = [];
    let filtro = "todas";
    let fechaVista = "";
    let listaUnidades = "";

    function crear(tag, clase, texto) {
        const elemento = document.createElement(tag);
        if (clase) elemento.className = clase;
        if (texto) elemento.textContent = texto;
        return elemento;
    }

    function boton(texto, clase = "turno-button") {
        const elemento = crear("button", clase, texto);
        elemento.type = "button";
        return elemento;
    }

    function panel(titulo, abierto = false) {
        const elemento = crear("details", "turno-panel");
        elemento.open = Boolean(abierto);
        const cabecera = crear("summary", "turno-panel-heading");
        const contador = crear("small", "turno-count");
        cabecera.append(crear("strong", "", titulo), contador);
        const cuerpo = crear("div", "turno-panel-body");
        elemento.append(cabecera, cuerpo);
        return { elemento, contador, cuerpo };
    }

    function check(texto, datos, detalle) {
        const label = crear("label", "turno-check");
        const input = crear("input");
        input.type = "checkbox";
        Object.assign(input.dataset, datos);
        const nombre = crear("span", "", texto);
        if (detalle) nombre.append(crear("small", "turno-detail", detalle));
        label.append(input, nombre);
        return label;
    }

    function evidencia(config, control) {
        const bloque = crear("div", "turno-evidence");
        bloque.dataset.evidencia = config.id;
        bloque.hidden = true;
        const status = crear("small", "turno-evidence-status", "Sin adjuntos");
        const titulo = crear("div", "turno-evidence-title");
        titulo.append(crear("strong", "", config.titulo), status);
        const acciones = crear("div", "turno-actions");
        const input = crear("input");
        input.type = "file";
        input.accept = "image/*";
        input.hidden = true;
        input.dataset.evidenciaInput = config.id;
        const adjuntar = boton("Adjuntar imagen");
        adjuntar.dataset.evidenciaAdjuntar = config.id;
        adjuntar.addEventListener("click", () => input.click());
        const pegar = boton("Pegar imagen");
        pegar.dataset.evidenciaPegar = config.id;
        pegar.title = "Con el botón enfocado, pega una imagen desde el portapapeles";
        const ver = boton("Ver respaldo", "turno-link");
        ver.hidden = true;
        ver.setAttribute("aria-expanded", "false");
        const vista = crear("div", "turno-evidence-preview");
        vista.hidden = true;
        ver.addEventListener("click", () => {
            vista.hidden = !vista.hidden;
            ver.setAttribute("aria-expanded", String(!vista.hidden));
            ver.textContent = vista.hidden ? "Ver respaldo" : "Ocultar respaldo";
        });
        acciones.append(input, adjuntar, pegar, ver);
        bloque.append(titulo, acciones, vista);
        evidencias.set(config.id, { bloque, control, status, ver, vista, cantidad: 0, solicitud: 0 });
        return bloque;
    }

    function control(item) {
        const fila = crear("div", "turno-control");
        fila.dataset.turnoControl = item.codigo;
        if (item.opciones) {
            fila.classList.add("turno-choice-row");
            const label = crear("span", "turno-question", item.texto);
            label.id = `turno-label-${item.codigo}`;
            const opciones = crear("div", "turno-choices");
            opciones.setAttribute("role", "radiogroup");
            opciones.setAttribute("aria-labelledby", label.id);
            item.opciones.forEach(([valor, texto]) => {
                const opcion = crear("label");
                const input = crear("input");
                input.type = "radio";
                input.name = item.codigo.replaceAll("_", "-");
                input.value = valor;
                input.dataset.cierreCodigo = item.codigo;
                opcion.append(input, crear("span", "", texto));
                opciones.append(opcion);
            });
            fila.append(label, opciones);
        } else {
            const opcion = check(item.texto, { cierreCodigo: item.codigo, cierreCampo: item.codigo.replaceAll("_", "-") });
            fila.append(opcion);
            if (item.evidencia) fila.append(evidencia(item.evidencia, opcion.querySelector("input")));
        }
        const noAplica = crear("small", "turno-detail", "No aplica");
        noAplica.dataset.turnoNoAplica = "";
        noAplica.hidden = true;
        fila.append(noAplica);
        return fila;
    }

    function abrirSeccion(id) {
        document.querySelector(`.menu-item[data-seccion="${id}"]`)?.click();
    }

    function abrirCabana(numero, volverAFoco) {
        if (!window.HAIKU_CABANAS_SITES_V1?.abrir) return;
        abrirSeccion("cabanas");
        window.HAIKU_CABANAS_SITES_V1.abrir(numero);
        const detalle = document.getElementById("cabinsDetail");
        if (!detalle) return;
        let volver = document.getElementById("sites-cierre-volver");
        if (!volver) {
            volver = boton("‹ Volver a Cierre de turno", "sites-cierre-back turno-button");
            volver.id = "sites-cierre-volver";
            detalle.prepend(volver);
        }
        volver.onclick = () => {
            volver.hidden = true;
            window.HAIKU_CABANAS_SITES_V1.cerrar?.();
            abrirSeccion("cierre");
            volverAFoco.focus();
        };
        volver.hidden = false;
    }

    const escritorio = matchMedia("(min-width: 760px)").matches;
    const cabanas = panel(plantilla.unidades.titulo, escritorio);
    cabanas.elemento.id = "sites-cierre-cabanas";
    const barraFiltros = crear("div", "turno-filters");
    barraFiltros.setAttribute("role", "group");
    barraFiltros.setAttribute("aria-label", "Filtrar cabañas");
    const lista = crear("div", "turno-cabins");
    const sinUnidades = crear("p", "turno-empty");
    cabanas.cuerpo.append(barraFiltros, lista, sinUnidades);
    const botonesFiltro = Object.entries(filtros).map(([id, texto]) => {
        const item = boton(texto);
        item.dataset.sitesCierreFilter = id;
        item.addEventListener("click", () => {
            filtro = id;
            actualizarCabanas();
        });
        barraFiltros.append(item);
        return [id, item];
    });

    function cargarUnidades(unidades) {
        const firma = JSON.stringify(unidades);
        if (listaUnidades === firma) return;
        listaUnidades = firma;
        const modelo = plantilla.unidades;
        lista.replaceChildren(...unidades.map(({ numero, nombre }) => {
            const ficha = panel(nombre || `Cabaña ${numero}`);
            ficha.elemento.className = "turno-cabin";
            ficha.elemento.dataset.sitesCierreCabin = numero;
            ficha.contador.classList.add("turno-cabin-count");
            const operativo = crear("small", "turno-cabin-operativo");
            const estado = crear("span", "turno-badge");
            ficha.contador.before(operativo, estado);

            const opciones = crear("div", "turno-cabin-checks");
            modelo.items.forEach(([id, texto]) => opciones.append(check(texto, {
                cierreCodigo: `cabana_${id}`, cierreCabana: numero, item: id
            })));
            ficha.cuerpo.append(check(modelo.ocupada[1], {
                cierreCodigo: "cabana_ocupada", cierreCabana: numero, cierreCabanaOcupada: numero
            }), opciones);
            if (numero <= plantilla.unidades.respaldo.length) {
                const ver = boton("Abrir ficha operativa", "turno-link");
                ver.addEventListener("click", () => abrirCabana(numero, ver));
                ficha.cuerpo.append(ver);
            }
            return ficha.elemento;
        }));
    }

    const procedimientos = crear("div", "turno-procedures");
    const inventario = panel(plantilla.inventario.titulo);
    inventario.elemento.className = "turno-inventory";
    const llaves = crear("div", "turno-inventory-list");
    plantilla.inventario.llaves.forEach(([id, texto, detalle]) => llaves.append(check(texto, {
        cierreCodigo: plantilla.inventario.codigo, cierreLlave: id
    }, detalle)));
    inventario.cuerpo.append(llaves);

    plantilla.controles.forEach(grupo => {
        const vista = panel(grupo.titulo, grupo.abrir || (escritorio && grupo.abrirEnEscritorio));
        vista.elemento.dataset.turnoGrupo = grupo.id;
        const filas = grupo.items.map(control);
        vista.cuerpo.append(...filas);
        if (grupo.inventario) vista.cuerpo.append(inventario.elemento);
        if (grupo.seccion) {
            const acceso = boton(grupo.enlace, "turno-link");
            acceso.addEventListener("click", () => abrirSeccion(grupo.seccion));
            vista.cuerpo.append(acceso);
        }
        revisiones.push({ ...vista, filas });
        procedimientos.append(vista.elemento);
    });

    const entrega = crear("section", "turno-panel turno-handover");
    entrega.id = "sites-cierre-entrega";
    entrega.tabIndex = -1;
    entrega.setAttribute("aria-labelledby", "sites-cierre-entrega-titulo");
    const tituloEntrega = crear("h2", "turno-handover-heading", plantilla.entrega.titulo);
    tituloEntrega.id = "sites-cierre-entrega-titulo";
    const columnas = crear("div", "turno-handover-grid");
    const pendientes = crear("div", "turno-handover-notes");
    pendientes.append(...plantilla.entrega.items.map(control));
    const notas = crear("label", "turno-field");
    const novedades = crear("textarea");
    novedades.dataset.cierreCampo = "novedades";
    novedades.rows = 3;
    novedades.placeholder = "Ej. Revisar calefactor de la cabaña 4";
    notas.append(crear("span", "", "Novedades del turno"), novedades);
    pendientes.append(notas);
    const final = crear("div", "turno-final-slot");
    final.id = "sites-cierre-final-slot";
    columnas.append(pendientes, final);
    entrega.append(tituloEntrega, columnas);

    $("#sites-cierre-stages").replaceChildren(cabanas.elemento, procedimientos, entrega);
    $("#sites-cierre-ir-entrega").addEventListener("click", () => {
        entrega.scrollIntoView({ block: "start" });
        entrega.focus({ preventScroll: true });
    });

    function estadoCabana(numero) {
        const datos = typeof obtenerDatosDia === "function" ? obtenerDatosDia(fechaActual())?.cabanas?.[numero] : null;
        return window.HAIKU_CABANAS_SITES_V1?.estadoFinal?.(datos || {}, fechaActual()) || "pendiente";
    }

    function revisado(input) {
        return input.checked || input.dataset.cierreExento === "true";
    }

    function actualizarCabanas() {
        const cuenta = { todas: 0, pendientes: 0, observaciones: 0, completas: 0 };
        lista.querySelectorAll(".turno-cabin").forEach(ficha => {
            const numero = Number(ficha.dataset.sitesCierreCabin);
            const exencion = ficha.querySelector("[data-cierre-cabana-ocupada]");
            const ocupada = revisado(exencion);
            const checks = [...ficha.querySelectorAll("[data-item]")];
            const hechos = checks.filter(revisado).length;
            const completa = ocupada || hechos === checks.length;
            const estadoOperativo = estadoCabana(numero);
            const operacion = {
                lista: "Lista", "con-detalles": "Con observaciones", en_curso: "En curso",
                lista_para_revisar: "Lista para revisar", no_requiere: "No requiere"
            }[estadoOperativo] || "Pendiente";

            ficha.querySelector(".turno-cabin-count").textContent = ocupada ? "" : `${hechos}/${checks.length}`;
            const badge = ficha.querySelector(".turno-badge");
            badge.textContent = ocupada ? (exencion.checked ? "Ocupada" : "No requiere")
                : completa ? "Revisada" : "Por revisar";
            badge.dataset.tono = completa ? "ok" : "pendiente";
            const statusOperativo = ficha.querySelector(".turno-cabin-operativo");
            statusOperativo.textContent = `Operación · ${operacion}`;
            statusOperativo.dataset.observada = String(estadoOperativo === "con-detalles");
            ficha.querySelector(".turno-cabin-checks").hidden = ocupada;
            cuenta.todas++;
            cuenta[completa ? "completas" : "pendientes"]++;
            if (estadoOperativo === "con-detalles") cuenta.observaciones++;
            ficha.hidden = filtro !== "todas" &&
                (filtro === "observaciones" ? estadoOperativo !== "con-detalles" : completa !== (filtro === "completas"));
        });
        cabanas.contador.textContent = `${cuenta.completas}/${cuenta.todas} revisadas`;
        botonesFiltro.forEach(([id, item]) => {
            item.textContent = `${filtros[id]} ${cuenta[id]}`;
            item.setAttribute("aria-pressed", String(filtro === id));
        });
        sinUnidades.hidden = cuenta[filtro] > 0;
        sinUnidades.textContent = cuenta.todas ? "No hay cabañas en este filtro." : "Sin cabañas activas.";
    }

    function actualizar() {
        actualizarCabanas();
        const checksLlaves = $$("[data-cierre-llave]");
        const devueltas = checksLlaves.filter(revisado).length;
        inventario.contador.textContent = `${devueltas}/${checksLlaves.length} devueltas`;
        revisiones.forEach(({ contador, filas }) => {
            const hechos = filas.filter(fila => [...fila.querySelectorAll("[data-cierre-codigo]")].some(revisado)).length;
            contador.textContent = `${hechos}/${filas.length}`;
        });
        const cerrado = root.classList.contains("haiku-cierre-bloqueado");
        const puede = window.haikuTienePermiso;
        $$("[data-turno-control]").forEach(fila => {
            const codigo = fila.dataset.turnoControl;
            const permiso = plantilla.campos[codigo].permiso;
            const exento = !!fila.querySelector('[data-cierre-exento="true"]');
            const restringido = permiso && typeof puede === "function" && !puede(permiso);
            const detalle = fila.querySelector("[data-turno-no-aplica]");
            detalle.hidden = !exento && (!restringido || cerrado || !!fila.querySelector("input:checked"));
            detalle.textContent = exento ? "No aplica" : "Requiere permiso de validación";
            if (permiso) {
                fila.querySelector("input").disabled = cerrado || restringido;
            }
        });
        notas.hidden = !novedades.value.trim() && !$('input[name="hay-novedades"][value="si"]:checked');
        evidencias.forEach(item => {
            item.bloque.hidden = !item.control.checked && !item.cantidad;
        });
    }

    async function refrescarEvidencia(id, abrir = false) {
        const item = evidencias.get(id);
        const fecha = fechaActual();
        if (!fecha) return;
        const solicitud = ++item.solicitud;
        const api = window.HAIKU_CIERRE_EVIDENCIAS_V1;
        let archivos = [];
        let fallo = false;
        try {
            archivos = await api?.listar(fecha, id) || [];
        } catch {
            fallo = true;
        }
        if (!archivos.length) {
            try {
                const local = await (api?.obtenerLocal || window.obtenerEvidencia)?.(fecha, id);
                if (local) archivos = [{ url: local }];
            } catch {
                fallo = true;
            }
        }
        if (item.solicitud !== solicitud || fecha !== fechaActual()) return;
        item.cantidad = archivos.length;
        item.status.textContent = archivos.length
            ? `${archivos.length} ${archivos.length === 1 ? "adjunto" : "adjuntos"}`
            : fallo ? "No se pudo cargar el respaldo" : "Sin adjuntos";
        item.vista.replaceChildren();
        const primera = archivos.find(archivo => archivo.url);
        if (primera) {
            const img = crear("img");
            img.src = primera.url;
            img.alt = "Último respaldo del control";
            img.loading = "lazy";
            item.vista.append(img);
            const enlaces = crear("div", "turno-actions");
            archivos.forEach(({ url }, index) => {
                if (!url || url.startsWith("data:")) return;
                const enlace = crear("a", "turno-link", `Adjunto ${index + 1}`);
                enlace.href = url;
                enlace.target = "_blank";
                enlace.rel = "noopener noreferrer";
                enlaces.append(enlace);
            });
            item.vista.append(enlaces);
        }
        item.ver.hidden = !primera;
        item.vista.hidden = !primera || (!abrir && item.vista.hidden);
        item.ver.textContent = item.vista.hidden ? "Ver respaldo" : "Ocultar respaldo";
        item.ver.setAttribute("aria-expanded", String(!item.vista.hidden));
        item.bloque.hidden = !item.control.checked && !archivos.length;
    }

    function refrescarEvidencias() {
        if (root.classList.contains("activa")) evidencias.forEach((_, id) => refrescarEvidencia(id));
    }

    function mostrarEstado(estado) {
        const badge = $("#sites-cierre-estado");
        const progreso = $("#cierre-barra-progreso");
        if (!estado) {
            badge.textContent = "Preparando cierre…";
            badge.dataset.tono = "";
            $("#cierre-porcentaje").textContent = "—";
            $("#sites-cierre-resumen").textContent = "Cargando controles del turno";
            progreso.removeAttribute("value");
            return;
        }
        const pendientes = Number(estado.pendientes);
        const porcentaje = Number(estado.porcentaje);
        const etiqueta = {
            cerrado: "Cerrado", cerrado_con_pendientes: "Cerrado con pendientes", reabierto: "Reabierto"
        }[estado.cierre_estado];
        badge.textContent = etiqueta || (pendientes ? "En revisión" : "Listo para cerrar");
        badge.dataset.tono = estado.cierre_estado === "cerrado" || !pendientes ? "ok" : "pendiente";
        $("#cierre-porcentaje").textContent = `${porcentaje}%`;
        $("#sites-cierre-resumen").textContent = `${estado.completados}/${estado.total_requeridos} controles · ${pendientes} pendientes`;
        progreso.value = porcentaje;
    }

    function mostrarFecha(fecha) {
        if (!fecha || fecha === fechaVista) return;
        fechaVista = fecha;
        $("#sites-cierre-fecha").textContent = new Intl.DateTimeFormat("es-CL", {
            weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago"
        }).format(new Date(`${fecha}T12:00:00`));
        mostrarEstado(null);
        if (!window.haikuSupabase) {
            $("#sites-cierre-estado").textContent = "Modo local";
            $("#sites-cierre-resumen").textContent = "Conecta el panel para consultar el cierre guardado";
        }
        evidencias.forEach(item => {
            item.solicitud++;
            item.cantidad = 0;
            item.status.textContent = "Sin adjuntos";
            item.ver.hidden = true;
            item.ver.setAttribute("aria-expanded", "false");
            item.vista.hidden = true;
            item.vista.replaceChildren();
        });
        window.dispatchEvent(new CustomEvent("haiku:cierre-fecha-cambiada", { detail: { fecha } }));
        refrescarEvidencias();
    }

    window.addEventListener("haiku:cierre-estado-actualizado", event => {
        const estado = event.detail;
        if (estado?.fecha_operativa && estado.fecha_operativa !== fechaActual()) return;
        mostrarEstado(estado);
        actualizar();
    });
    window.addEventListener("haiku:auth-ready", actualizar);
    window.addEventListener("haiku:cierre-evidencia-guardada", event => {
        if (event.detail?.fecha === fechaActual() && evidencias.has(event.detail.nombre)) {
            refrescarEvidencia(event.detail.nombre, true);
        }
    });
    document.querySelector('.menu-item[data-seccion="cierre"]')?.addEventListener("click", () => {
        window.cargarCierreDia?.(fechaActual());
        refrescarEvidencias();
    });
    document.addEventListener("click", event => {
        const volver = document.getElementById("sites-cierre-volver");
        if (volver && event.target.closest(".menu-item[data-seccion]")) volver.hidden = true;
    });
    document.addEventListener("haiku:revision-estado-guardado", actualizarCabanas);
    cargarUnidades(plantilla.unidades.respaldo);
    window.HAIKU_SITES_CIERRE_V1 = Object.freeze({ actualizar, cargarUnidades, mostrarFecha, estadoCabana });
})();
