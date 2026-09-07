(function () {
    "use strict";

    const FILAS_POR_PAGINA = 120;
    const MAX_COLUMNAS_VISOR = 250;
    const DESCARGA_LIBRO_URL = "https://docs.google.com/spreadsheets/d/1ZX4KqcdY6LORafrI6NkqwT3hGxrdK2rk/export?format=xlsx";
    const VERSION_QUERY = (() => {
        try {
            return new URL(document.currentScript?.src || location.href).search;
        } catch (_) {
            return "";
        }
    })();

    let archivoBuffer = null;
    let archivoNombre = "";
    let libroIndice = null;
    let hojaActual = "";
    let hojaCargada = null;
    let combinacionesCargadas = [];
    let rangoCargado = null;
    let paginaActual = 0;
    let renderId = 0;
    let lectorWorker = null;
    let solicitudId = 0;
    const solicitudes = new Map();

    const $ = (id) => document.getElementById(id);

    function bytesLegibles(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return "";
        const unidades = ["B", "KB", "MB", "GB"];
        const indice = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unidades.length - 1);
        const valor = bytes / Math.pow(1024, indice);
        return `${valor.toLocaleString("es-CL", { maximumFractionDigits: indice ? 1 : 0 })} ${unidades[indice]}`;
    }

    function fechaHoraActual() {
        return new Intl.DateTimeFormat("es-CL", {
            dateStyle: "short",
            timeStyle: "short"
        }).format(new Date());
    }

    function mostrarVacio(titulo, texto) {
        const visor = $("libro-reserva-visor");
        if (!visor) return;
        visor.replaceChildren();
        const contenedor = document.createElement("div");
        contenedor.className = "libro-reserva-vacio";
        const interior = document.createElement("div");
        const fuerte = document.createElement("strong");
        const parrafo = document.createElement("p");
        fuerte.textContent = titulo;
        parrafo.textContent = texto;
        interior.append(fuerte, parrafo);
        contenedor.appendChild(interior);
        visor.appendChild(contenedor);
    }

    function mostrarCargando(texto) {
        const visor = $("libro-reserva-visor");
        if (!visor) return;
        visor.replaceChildren();
        const estado = document.createElement("div");
        estado.className = "libro-reserva-cargando";
        estado.textContent = texto;
        visor.appendChild(estado);
    }

    function actualizarEstado(nombre, detalle) {
        const titulo = $("libro-reserva-estado-titulo");
        const texto = $("libro-reserva-estado-detalle");
        if (titulo) titulo.textContent = nombre;
        if (texto) texto.textContent = detalle;
    }

    function configurarDescarga() {
        const boton = $("libro-reserva-descargar");
        if (!boton) return;
        if (!DESCARGA_LIBRO_URL) {
            boton.disabled = true;
            boton.textContent = "Descarga pendiente de enlace";
            boton.title = "Falta configurar el enlace exacto del archivo oficial";
            return;
        }
        boton.disabled = false;
        boton.textContent = "↓ Descargar versión actual";
        boton.addEventListener("click", () => {
            window.open(DESCARGA_LIBRO_URL, "_blank", "noopener,noreferrer");
        });
    }

    function destruirLector() {
        if (lectorWorker) lectorWorker.terminate();
        lectorWorker = null;
        solicitudes.forEach(({ reject }) => reject(new Error("LECTURA_CANCELADA")));
        solicitudes.clear();
    }

    function obtenerLector() {
        if (lectorWorker) return lectorWorker;
        lectorWorker = new Worker(`js/supabase-libro-reserva-worker-v1.js${VERSION_QUERY}`);
        lectorWorker.addEventListener("message", (evento) => {
            const respuesta = evento.data || {};
            const pendiente = solicitudes.get(respuesta.id);
            if (!pendiente) return;
            solicitudes.delete(respuesta.id);
            if (respuesta.ok) pendiente.resolve(respuesta.resultado);
            else pendiente.reject(new Error(respuesta.error || "No fue posible leer el XLSX"));
        });
        lectorWorker.addEventListener("error", (evento) => {
            const error = new Error(evento.message || "No fue posible iniciar el lector XLSX");
            solicitudes.forEach(({ reject }) => reject(error));
            solicitudes.clear();
            lectorWorker?.terminate();
            lectorWorker = null;
        });
        return lectorWorker;
    }

    function leerEnSegundoPlano(tipo, nombreHoja = "") {
        if (!archivoBuffer) return Promise.reject(new Error("No hay archivo cargado"));
        const id = ++solicitudId;
        const copia = archivoBuffer.slice(0);
        return new Promise((resolve, reject) => {
            solicitudes.set(id, { resolve, reject });
            obtenerLector().postMessage({ id, tipo, nombreHoja, buffer: copia }, [copia]);
        });
    }

    function limpiarMemoria() {
        renderId += 1;
        destruirLector();
        archivoBuffer = null;
        archivoNombre = "";
        libroIndice = null;
        hojaActual = "";
        hojaCargada = null;
        combinacionesCargadas = [];
        rangoCargado = null;
        paginaActual = 0;

        const entrada = $("libro-reserva-archivo");
        const selector = $("libro-reserva-hoja");
        const quitar = $("libro-reserva-quitar");
        if (entrada) entrada.value = "";
        if (selector) {
            selector.replaceChildren();
            selector.disabled = true;
        }
        if (quitar) quitar.disabled = true;
        actualizarPaginacion();
        actualizarEstado("Sin archivo cargado", "Nada queda guardado en el navegador ni en Supabase.");
        const meta = $("libro-reserva-meta");
        if (meta) meta.textContent = "Selecciona un XLSX para detectar sus hojas reales.";
        mostrarVacio(
            "El libro se abrirá aquí, sólo para lectura",
            "Descarga una copia XLSX del archivo oficial y selecciónala. El contenido se mantiene únicamente en la memoria temporal de esta pestaña."
        );
    }

    function metadatosHojas() {
        const estados = new Map();
        const hojas = libroIndice?.Workbook?.Sheets || [];
        hojas.forEach((item, indice) => {
            const nombre = item?.name || libroIndice?.SheetNames?.[indice];
            if (nombre) estados.set(nombre, Number(item?.Hidden || 0));
        });
        return estados;
    }

    function poblarSelector() {
        const selector = $("libro-reserva-hoja");
        if (!selector || !libroIndice) return;
        selector.replaceChildren();

        const estados = metadatosHojas();
        const visibles = libroIndice.SheetNames.filter((nombre) => !estados.get(nombre));
        const ocultas = libroIndice.SheetNames.filter((nombre) => estados.get(nombre));

        function agregarGrupo(etiqueta, nombres) {
            if (!nombres.length) return;
            const grupo = document.createElement("optgroup");
            grupo.label = etiqueta;
            nombres.forEach((nombre) => {
                const opcion = document.createElement("option");
                opcion.value = nombre;
                opcion.textContent = nombre;
                grupo.appendChild(opcion);
            });
            selector.appendChild(grupo);
        }

        agregarGrupo("Hojas visibles", visibles);
        agregarGrupo("Ocultas en el archivo", ocultas);
        selector.disabled = false;
        hojaActual = visibles[0] || libroIndice.SheetNames[0] || "";
        selector.value = hojaActual;
    }

    function valorCelda(fila, columna) {
        return hojaCargada?.get(`${fila}:${columna}`) || "";
    }

    function mapaCombinaciones() {
        const inicios = new Map();
        const omitidas = new Set();
        combinacionesCargadas.forEach((rango) => {
            inicios.set(`${rango.s.r}:${rango.s.c}`, {
                rowSpan: rango.e.r - rango.s.r + 1,
                colSpan: rango.e.c - rango.s.c + 1
            });
            for (let fila = rango.s.r; fila <= rango.e.r; fila += 1) {
                for (let columna = rango.s.c; columna <= rango.e.c; columna += 1) {
                    if (fila !== rango.s.r || columna !== rango.s.c) omitidas.add(`${fila}:${columna}`);
                }
            }
        });
        return { inicios, omitidas };
    }

    function actualizarPaginacion() {
        const anterior = $("libro-reserva-pagina-anterior");
        const siguiente = $("libro-reserva-pagina-siguiente");
        const estado = $("libro-reserva-pagina-estado");
        if (!rangoCargado) {
            if (anterior) anterior.disabled = true;
            if (siguiente) siguiente.disabled = true;
            if (estado) estado.textContent = "";
            return;
        }
        const filas = rangoCargado.e.r - rangoCargado.s.r + 1;
        const paginas = Math.max(1, Math.ceil(filas / FILAS_POR_PAGINA));
        paginaActual = Math.min(Math.max(0, paginaActual), paginas - 1);
        const filaInicio = rangoCargado.s.r + paginaActual * FILAS_POR_PAGINA + 1;
        const filaFin = Math.min(rangoCargado.e.r + 1, filaInicio + FILAS_POR_PAGINA - 1);
        if (anterior) anterior.disabled = paginaActual === 0;
        if (siguiente) siguiente.disabled = paginaActual >= paginas - 1;
        if (estado) estado.textContent = `Filas ${filaInicio.toLocaleString("es-CL")}–${filaFin.toLocaleString("es-CL")} de ${(rangoCargado.e.r + 1).toLocaleString("es-CL")}`;
    }

    function dibujarPagina() {
        if (!hojaCargada || !rangoCargado) return;
        const rango = rangoCargado;
        const columnas = rango.e.c - rango.s.c + 1;
        const filas = rango.e.r - rango.s.r + 1;
        if (columnas > MAX_COLUMNAS_VISOR) {
            mostrarVacio(
                "Hoja demasiado ancha para una vista segura",
                `“${hojaActual}” contiene ${columnas.toLocaleString("es-CL")} columnas. No se dibujó para evitar congelar el equipo.`
            );
            return;
        }

        actualizarPaginacion();
        const filaInicio = rango.s.r + paginaActual * FILAS_POR_PAGINA;
        const filaFin = Math.min(rango.e.r, filaInicio + FILAS_POR_PAGINA - 1);
        const { inicios, omitidas } = mapaCombinaciones();
        const tabla = document.createElement("table");
        tabla.className = "libro-reserva-tabla";
        tabla.setAttribute("aria-label", `Hoja ${hojaActual}`);
        const cuerpo = document.createElement("tbody");

        for (let fila = filaInicio; fila <= filaFin; fila += 1) {
            const tr = document.createElement("tr");
            for (let columna = rango.s.c; columna <= rango.e.c; columna += 1) {
                const clave = `${fila}:${columna}`;
                if (omitidas.has(clave)) continue;
                const celda = fila === rango.s.r ? document.createElement("th") : document.createElement("td");
                celda.textContent = valorCelda(fila, columna);
                const union = inicios.get(clave);
                if (union) {
                    if (union.rowSpan > 1) celda.rowSpan = Math.min(union.rowSpan, filaFin - fila + 1);
                    if (union.colSpan > 1) celda.colSpan = union.colSpan;
                }
                tr.appendChild(celda);
            }
            cuerpo.appendChild(tr);
        }

        tabla.appendChild(cuerpo);
        const visor = $("libro-reserva-visor");
        if (!visor) return;
        visor.replaceChildren(tabla);
        visor.scrollTo({ top: 0, left: 0 });
        const meta = $("libro-reserva-meta");
        if (meta) {
            meta.textContent = `${libroIndice.SheetNames.length} hojas detectadas · “${hojaActual}” · ${filas.toLocaleString("es-CL")} filas × ${columnas.toLocaleString("es-CL")} columnas`;
        }
    }

    async function renderizarHoja(nombre) {
        if (!archivoBuffer || !nombre) return;
        const miRender = ++renderId;
        hojaActual = nombre;
        mostrarCargando(`Abriendo “${nombre}”…`);

        try {
            const resultado = await leerEnSegundoPlano("hoja", nombre);
            if (miRender !== renderId || !archivoBuffer) return;
            if (!resultado?.rango) {
                mostrarVacio("Hoja vacía", `“${nombre}” no contiene celdas visibles.`);
                return;
            }
            hojaCargada = new Map((resultado.celdas || []).map((celda) => [`${celda.r}:${celda.c}`, celda.valor]));
            combinacionesCargadas = resultado.combinaciones || [];
            rangoCargado = resultado.rango;
            paginaActual = 0;
            dibujarPagina();
        } catch (error) {
            if (miRender !== renderId) return;
            console.error("LIBRO RESERVA · No fue posible abrir la hoja:", error);
            mostrarVacio("No fue posible mostrar esta hoja", "El archivo puede estar protegido, dañado o usar una característica no compatible.");
        }
    }

    async function cargarArchivo(archivo) {
        if (!archivo) return;
        if (!/\.xlsx$/i.test(archivo.name)) {
            mostrarVacio("Formato no compatible", "Selecciona una copia descargada en formato .xlsx.");
            return;
        }

        limpiarMemoria();
        const cargaId = renderId;
        mostrarCargando("Leyendo la copia local del libro…");
        try {
            archivoBuffer = await archivo.arrayBuffer();
            archivoNombre = archivo.name;
            const indice = await leerEnSegundoPlano("indice");
            libroIndice = {
                SheetNames: indice.nombres || [],
                Workbook: { Sheets: indice.hojas || [] }
            };
            if (!libroIndice.SheetNames?.length) throw new Error("El archivo no contiene hojas");
            poblarSelector();
            const quitar = $("libro-reserva-quitar");
            if (quitar) quitar.disabled = false;
            actualizarEstado(
                archivoNombre,
                `${bytesLegibles(archivo.size)} · leído localmente ${fechaHoraActual()}`
            );
            renderizarHoja(hojaActual);
        } catch (error) {
            if (cargaId !== renderId) return;
            console.error("LIBRO RESERVA · Archivo no válido:", error);
            limpiarMemoria();
            mostrarVacio("No fue posible leer el archivo", "Verifica que sea la copia XLSX correcta e inténtalo otra vez.");
        }
    }

    function iniciar() {
        if (!$("seccion-libro-reserva") || window.HAIKU_LIBRO_RESERVA_V1) return;
        window.HAIKU_LIBRO_RESERVA_V1 = Object.freeze({
            version: "1.0.0",
            modo: "archivo-local-solo-lectura",
            limpiar: limpiarMemoria
        });

        configurarDescarga();
        limpiarMemoria();

        const cargar = $("libro-reserva-cargar");
        const entrada = $("libro-reserva-archivo");
        const selector = $("libro-reserva-hoja");
        const quitar = $("libro-reserva-quitar");
        const anterior = $("libro-reserva-pagina-anterior");
        const siguiente = $("libro-reserva-pagina-siguiente");

        cargar?.addEventListener("click", () => entrada?.click());
        entrada?.addEventListener("change", () => cargarArchivo(entrada.files?.[0]));
        selector?.addEventListener("change", () => renderizarHoja(selector.value));
        quitar?.addEventListener("click", limpiarMemoria);
        anterior?.addEventListener("click", () => {
            if (paginaActual <= 0) return;
            paginaActual -= 1;
            dibujarPagina();
        });
        siguiente?.addEventListener("click", () => {
            if (!rangoCargado) return;
            const paginas = Math.ceil((rangoCargado.e.r - rangoCargado.s.r + 1) / FILAS_POR_PAGINA);
            if (paginaActual >= paginas - 1) return;
            paginaActual += 1;
            dibujarPagina();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
