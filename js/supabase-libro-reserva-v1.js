(function () {
    "use strict";

    const MAX_CELDAS_VISOR = 120000;
    const DESCARGA_LIBRO_URL = "";

    let archivoBuffer = null;
    let archivoNombre = "";
    let libroIndice = null;
    let hojaActual = "";
    let renderId = 0;

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

    function limpiarMemoria() {
        renderId += 1;
        archivoBuffer = null;
        archivoNombre = "";
        libroIndice = null;
        hojaActual = "";

        const entrada = $("libro-reserva-archivo");
        const selector = $("libro-reserva-hoja");
        const quitar = $("libro-reserva-quitar");
        if (entrada) entrada.value = "";
        if (selector) {
            selector.replaceChildren();
            selector.disabled = true;
        }
        if (quitar) quitar.disabled = true;
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

    function valorCelda(hoja, fila, columna) {
        const celda = hoja[XLSX.utils.encode_cell({ r: fila, c: columna })];
        if (!celda) return "";
        if (celda.w != null) return String(celda.w);
        if (celda.v == null) return "";
        return String(celda.v);
    }

    function mapaCombinaciones(hoja) {
        const inicios = new Map();
        const omitidas = new Set();
        (hoja["!merges"] || []).forEach((rango) => {
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

    function renderizarHoja(nombre) {
        if (!archivoBuffer || !nombre || !window.XLSX) return;
        const miRender = ++renderId;
        hojaActual = nombre;
        mostrarCargando(`Abriendo “${nombre}”…`);

        window.requestAnimationFrame(() => {
            if (miRender !== renderId || !archivoBuffer) return;
            try {
                const libro = XLSX.read(archivoBuffer, {
                    type: "array",
                    sheets: [nombre],
                    cellDates: true,
                    cellStyles: false,
                    cellFormula: true
                });
                const hoja = libro.Sheets[nombre];
                if (!hoja || !hoja["!ref"]) {
                    mostrarVacio("Hoja vacía", `“${nombre}” no contiene celdas visibles.`);
                    return;
                }

                const rango = XLSX.utils.decode_range(hoja["!ref"]);
                const filas = rango.e.r - rango.s.r + 1;
                const columnas = rango.e.c - rango.s.c + 1;
                const totalCeldas = filas * columnas;
                if (totalCeldas > MAX_CELDAS_VISOR) {
                    mostrarVacio(
                        "Hoja demasiado grande para una vista segura",
                        `“${nombre}” contiene ${filas.toLocaleString("es-CL")} filas por ${columnas.toLocaleString("es-CL")} columnas. No se dibujó para evitar congelar el equipo.`
                    );
                    return;
                }

                const { inicios, omitidas } = mapaCombinaciones(hoja);
                const tabla = document.createElement("table");
                tabla.className = "libro-reserva-tabla";
                tabla.setAttribute("aria-label", `Hoja ${nombre}`);
                const cuerpo = document.createElement("tbody");

                for (let fila = rango.s.r; fila <= rango.e.r; fila += 1) {
                    const tr = document.createElement("tr");
                    for (let columna = rango.s.c; columna <= rango.e.c; columna += 1) {
                        const clave = `${fila}:${columna}`;
                        if (omitidas.has(clave)) continue;
                        const celda = fila === rango.s.r ? document.createElement("th") : document.createElement("td");
                        celda.textContent = valorCelda(hoja, fila, columna);
                        const union = inicios.get(clave);
                        if (union) {
                            if (union.rowSpan > 1) celda.rowSpan = union.rowSpan;
                            if (union.colSpan > 1) celda.colSpan = union.colSpan;
                        }
                        tr.appendChild(celda);
                    }
                    cuerpo.appendChild(tr);
                }

                tabla.appendChild(cuerpo);
                if (miRender !== renderId) return;
                const visor = $("libro-reserva-visor");
                if (!visor) return;
                visor.replaceChildren(tabla);
                visor.scrollTo({ top: 0, left: 0 });
                const meta = $("libro-reserva-meta");
                if (meta) {
                    meta.textContent = `${libroIndice.SheetNames.length} hojas detectadas · “${nombre}” · ${filas.toLocaleString("es-CL")} filas × ${columnas.toLocaleString("es-CL")} columnas`;
                }
            } catch (error) {
                console.error("LIBRO RESERVA · No fue posible abrir la hoja:", error);
                mostrarVacio("No fue posible mostrar esta hoja", "El archivo puede estar protegido, dañado o usar una característica no compatible.");
            }
        }, 0);
    }

    async function cargarArchivo(archivo) {
        if (!archivo) return;
        if (!window.XLSX || typeof window.XLSX.read !== "function") {
            mostrarVacio("Falta el lector XLSX", "Recarga la página con conexión a internet e inténtalo nuevamente.");
            return;
        }
        if (!/\.xlsx$/i.test(archivo.name)) {
            mostrarVacio("Formato no compatible", "Selecciona una copia descargada en formato .xlsx.");
            return;
        }

        limpiarMemoria();
        mostrarCargando("Leyendo la copia local del libro…");
        try {
            archivoBuffer = await archivo.arrayBuffer();
            archivoNombre = archivo.name;
            libroIndice = XLSX.read(archivoBuffer, {
                type: "array",
                bookSheets: true,
                bookProps: true
            });
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

        cargar?.addEventListener("click", () => entrada?.click());
        entrada?.addEventListener("change", () => cargarArchivo(entrada.files?.[0]));
        selector?.addEventListener("change", () => renderizarHoja(selector.value));
        quitar?.addEventListener("click", limpiarMemoria);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
