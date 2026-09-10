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

    // Desktop-only, binary storage scoped to this site's browser profile.
    const persistenciaPC = window.matchMedia("(min-width: 901px)").matches;
    let operacionLibro = 0;
    let colaLocal = Promise.resolve();
    let cargaLista = Promise.resolve();
    let persistenciaConfirmada = false;
    let colaConsulta = Promise.resolve();
    const cacheConsultas = new Map();

    function copiaLocal(accion, registro) {
        const tarea = colaLocal.then(() => new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error("Almacenamiento local no disponible"));
            const apertura = window.indexedDB.open("haiku-libro-reserva-local", 1);
            let terminada = false;
            apertura.onupgradeneeded = () => {
                if (!apertura.result.objectStoreNames.contains("libro")) apertura.result.createObjectStore("libro");
            };
            apertura.onerror = () => reject(apertura.error);
            apertura.onblocked = () => {
                terminada = true;
                reject(new Error("Almacenamiento bloqueado por otra pestaña"));
            };
            apertura.onsuccess = () => {
                const db = apertura.result;
                if (terminada) { db.close(); return; }
                db.onversionchange = () => db.close();
                try {
                    const tx = db.transaction("libro", accion.startsWith("leer") ? "readonly" : "readwrite");
                    const almacen = tx.objectStore("libro");
                    const solicitud = accion.startsWith("leer") ? almacen.get(accion === "leer_anterior" ? "anterior" : "actual")
                        : accion === "borrar" ? almacen.clear() : almacen.get("actual");
                    let actualizacion = false;
                    if (accion === "guardar") solicitud.onsuccess = () => {
                        const anterior = solicitud.result;
                        const a = anterior?.buffer ? new Uint8Array(anterior.buffer) : null;
                        const b = new Uint8Array(registro.buffer);
                        const identico = a && a.length === b.length && a.every((valor, i) => valor === b[i]);
                        if (identico) return; // Re-uploading the same bytes must not discard the previous version.
                        actualizacion = Boolean(anterior?.buffer);
                        if (anterior) almacen.put(anterior, "anterior");
                        almacen.put(registro, "actual");
                    };
                    // A request's success alone does not guarantee that the write committed.
                    tx.oncomplete = () => { db.close(); resolve(accion === "guardar" ? {actualizacion} : solicitud.result); };
                    tx.onabort = () => { db.close(); reject(tx.error || new Error("Operación local cancelada")); };
                    tx.onerror = () => {};
                } catch (error) { db.close(); reject(error); }
            };
        }));
        colaLocal = tarea.catch(() => {});
        return tarea;
    }

    async function quitarLibro() {
        const id = ++operacionLibro;
        limpiarMemoria();
        if (!persistenciaPC) return;
        actualizarEstado("Quitando libro…", "Borrando la copia de este navegador.");
        try {
            await copiaLocal("borrar");
            if (id === operacionLibro) actualizarEstado("Sin archivo cargado", "Libro actual y anterior eliminados de la memoria y de este navegador.");
        } catch (_) {
            if (id !== operacionLibro) return;
            actualizarEstado("No se pudo borrar la copia local", "Vuelve a pulsar Quitar libro de memoria antes de recargar.");
            $("libro-reserva-quitar").disabled = false;
        }
    }

    async function restaurarLibro() {
        const id = operacionLibro;
        try {
            const registro = await copiaLocal("leer");
            if (id !== operacionLibro || !registro) return;
            if (!(registro.buffer instanceof ArrayBuffer) || !registro.buffer.byteLength || !/\.xlsx$/i.test(registro.nombre)) {
                throw new Error("Copia local inválida");
            }
            await cargarArchivo({ name: registro.nombre, size: registro.buffer.byteLength,
                arrayBuffer: async () => registro.buffer }, true);
        } catch (_) {
            if (id !== operacionLibro) return;
            actualizarEstado("No se pudo recuperar el libro", "Carga el XLSX otra vez o pulsa Quitar libro de memoria para borrar la copia local.");
            $("libro-reserva-quitar").disabled = false;
        }
    }

    let archivoBuffer = null;
    let archivoNombre = "";
    let libroIndice = null;
    let hojaActual = "";
    let hojaCargada = null;
    let estilosCargados = [];
    let columnasCargadas = [];
    let filasCargadas = [];
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
        persistenciaConfirmada = false;
        cacheConsultas.clear();
        window.dispatchEvent(new CustomEvent("haiku:libro-cambio"));
        renderId += 1;
        destruirLector();
        archivoBuffer = null;
        archivoNombre = "";
        libroIndice = null;
        hojaActual = "";
        hojaCargada = null;
        estilosCargados = [];
        columnasCargadas = [];
        filasCargadas = [];
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
        actualizarEstado("Sin archivo cargado", persistenciaPC ? "La copia se guarda sólo en este navegador; nunca en Supabase." : "Nada queda guardado en el navegador ni en Supabase.");
        const meta = $("libro-reserva-meta");
        if (meta) meta.textContent = "Selecciona un XLSX para detectar sus hojas reales.";
        mostrarVacio(
            "El libro se abrirá aquí, sólo para lectura",
            persistenciaPC ? "Carga un XLSX: seguirá disponible tras recargar hasta que pulses Quitar libro de memoria. Borrar los datos del sitio o usar navegación privada puede eliminar la copia." : "Descarga una copia XLSX del archivo oficial y selecciónala. El contenido se mantiene únicamente en la memoria temporal de esta pestaña."
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

    function celdaCargada(fila, columna) {
        return hojaCargada?.get(`${fila}:${columna}`) || null;
    }

    function valorCelda(fila, columna) {
        return celdaCargada(fila, columna)?.valor || "";
    }

    function estiloCelda(fila, columna) {
        const id = celdaCargada(fila, columna)?.estiloId;
        return Number.isInteger(id) && id >= 0 ? (estilosCargados[id] || null) : null;
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

    const COLORES_INDICE = {
        0: "000000", 1: "FFFFFF", 2: "FF0000", 3: "00FF00",
        4: "0000FF", 5: "FFFF00", 6: "FF00FF", 7: "00FFFF",
        8: "000000", 9: "FFFFFF", 10: "FF0000", 11: "00FF00",
        12: "0000FF", 13: "FFFF00", 14: "FF00FF", 15: "00FFFF",
        16: "800000", 17: "008000", 18: "000080", 19: "808000",
        20: "800080", 21: "008080", 22: "C0C0C0", 23: "808080",
        24: "9999FF", 25: "993366", 26: "FFFFCC", 27: "CCFFFF",
        28: "660066", 29: "FF8080", 30: "0066CC", 31: "CCCCCC",
        32: "000080", 33: "FF00FF", 34: "FFFF00", 35: "00FFFF",
        36: "800080", 37: "800000", 38: "008080", 39: "0000FF",
        40: "00CCFF", 41: "CCFFFF", 42: "CCFFCC", 43: "FFFF99",
        44: "99CCFF", 45: "FF99CC", 46: "CC99FF", 47: "FFCC99",
        48: "3366FF", 49: "33CCCC", 50: "99CC00", 51: "FFCC00",
        52: "FF9900", 53: "FF6600", 54: "666699", 55: "969696",
        56: "003366", 57: "339966", 58: "003300", 59: "333300",
        60: "993300", 61: "993366", 62: "333399", 63: "333333"
    };

    const COLORES_TEMA = {
        0: "FFFFFF",
        1: "000000",
        2: "E7E6E6",
        3: "44546A",
        4: "4472C4",
        5: "ED7D31",
        6: "A5A5A5",
        7: "FFC000",
        8: "5B9BD5",
        9: "70AD47",
        10: "0563C1",
        11: "954F72"
    };

    function hexNormalizado(valor) {
        const limpio = String(valor || "").replace(/[^0-9a-f]/gi, "");
        if (limpio.length >= 6) return limpio.slice(-6).toUpperCase();
        return null;
    }

    function aplicarTint(hex, tint) {
        if (!hex || !Number.isFinite(tint) || tint === 0) return hex;
        const canales = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const ajustados = canales.map((canal) => {
            const valor = tint > 0
                ? canal + (255 - canal) * tint
                : canal * (1 + tint);
            return Math.max(0, Math.min(255, Math.round(valor)));
        });
        return ajustados.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    }

    function colorCss(color) {
        if (!color || color.auto) return null;
        let hex = hexNormalizado(color.rgb);
        if (!hex && Number.isInteger(color.indexed)) hex = COLORES_INDICE[color.indexed] || null;
        if (!hex && Number.isInteger(color.theme)) hex = COLORES_TEMA[color.theme] || null;
        if (!hex) return null;
        hex = aplicarTint(hex, Number(color.tint));
        return `#${hex}`;
    }

    function estiloBordeCss(borde) {
        if (!borde?.style) return null;
        const estilos = {
            hair: ["1px", "solid"],
            thin: ["1px", "solid"],
            medium: ["2px", "solid"],
            thick: ["3px", "solid"],
            double: ["3px", "double"],
            dashed: ["1px", "dashed"],
            dotted: ["1px", "dotted"],
            dashDot: ["1px", "dashed"],
            dashDotDot: ["1px", "dashed"],
            mediumDashed: ["2px", "dashed"],
            mediumDashDot: ["2px", "dashed"],
            mediumDashDotDot: ["2px", "dashed"]
        };
        const [ancho, tipo] = estilos[borde.style] || ["1px", "solid"];
        return `${ancho} ${tipo} ${colorCss(borde.color) || "#cfcfcf"}`;
    }

    function aplicarFuente(elemento, font) {
        if (!font) return;
        const color = colorCss(font.color);
        if (color) elemento.style.color = color;
        if (font.name) elemento.style.fontFamily = `"${String(font.name).replaceAll('"', "")}", Arial, sans-serif`;
        if (Number.isFinite(font.sz)) elemento.style.fontSize = `${Math.max(6, font.sz)}pt`;
        if (Object.prototype.hasOwnProperty.call(font, "bold")) elemento.style.fontWeight = font.bold ? "700" : "400";
        if (Object.prototype.hasOwnProperty.call(font, "italic")) elemento.style.fontStyle = font.italic ? "italic" : "normal";
        const decoraciones = [];
        if (font.underline) decoraciones.push("underline");
        if (font.strike) decoraciones.push("line-through");
        if (decoraciones.length) elemento.style.textDecoration = decoraciones.join(" ");
    }

    function aplicarEstiloCelda(elemento, estilo) {
        if (!estilo) return;

        const fill = estilo.fill;
        if (fill) {
            const patron = String(fill.patternType || "").toLowerCase();
            const fondo = colorCss(fill.fgColor) || colorCss(fill.bgColor);
            if (fondo && patron !== "none") elemento.style.backgroundColor = fondo;
        }

        aplicarFuente(elemento, estilo.font);

        const alineacion = estilo.alignment;
        if (alineacion) {
            if (["left", "center", "right", "justify"].includes(alineacion.horizontal)) {
                elemento.style.textAlign = alineacion.horizontal;
            }
            if (["top", "center", "bottom"].includes(alineacion.vertical)) {
                elemento.style.verticalAlign = alineacion.vertical === "center" ? "middle" : alineacion.vertical;
            }
            if (alineacion.wrapText) {
                elemento.style.whiteSpace = "pre-wrap";
                elemento.style.overflowWrap = "break-word";
            } else {
                elemento.style.whiteSpace = "nowrap";
            }
            if (Number.isFinite(alineacion.indent) && alineacion.indent > 0) {
                elemento.style.paddingLeft = `${4 + alineacion.indent * 8}px`;
            }
        }

        const border = estilo.border;
        if (border) {
            ["left", "right", "top", "bottom"].forEach((lado) => {
                const valor = estiloBordeCss(border[lado]);
                if (valor) elemento.style[`border${lado[0].toUpperCase()}${lado.slice(1)}`] = valor;
            });
        }
    }

    function dibujarContenidoCelda(elemento, datos) {
        const runs = Array.isArray(datos?.runs) ? datos.runs : [];
        if (!runs.length) {
            elemento.textContent = datos?.valor || "";
            return;
        }

        let agregados = 0;
        runs.forEach((run) => {
            const texto = String(run?.texto ?? "");
            if (!texto) return;
            const span = document.createElement("span");
            span.textContent = texto;
            aplicarFuente(span, run?.font || null);
            elemento.appendChild(span);
            agregados += 1;
        });

        if (!agregados) elemento.textContent = datos?.valor || "";
    }

    function anchoColumnaPx(columna) {
        if (!columna) return 72;
        if (Number.isFinite(columna.wpx) && columna.wpx > 0) return Math.max(2, columna.wpx);
        if (Number.isFinite(columna.wch) && columna.wch > 0) return Math.max(2, Math.round(columna.wch * 7 + 5));
        if (Number.isFinite(columna.width) && columna.width > 0) return Math.max(2, Math.round(columna.width * 7 + 5));
        return 72;
    }

    function altoFilaPx(fila) {
        if (!fila) return null;
        if (Number.isFinite(fila.hpx) && fila.hpx > 0) return fila.hpx;
        if (Number.isFinite(fila.hpt) && fila.hpt > 0) return Math.round(fila.hpt * 96 / 72);
        return null;
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
        tabla.className = "libro-reserva-tabla libro-reserva-tabla--fiel";
        tabla.setAttribute("aria-label", `Hoja ${hojaActual}`);

        const grupoColumnas = document.createElement("colgroup");
        for (let columna = rango.s.c; columna <= rango.e.c; columna += 1) {
            const col = document.createElement("col");
            const config = columnasCargadas[columna];
            const ancho = anchoColumnaPx(config);
            col.style.width = `${ancho}px`;
            col.style.minWidth = `${ancho}px`;
            if (config?.hidden) {
                col.style.width = "0px";
                col.style.minWidth = "0px";
                col.style.visibility = "collapse";
            }
            grupoColumnas.appendChild(col);
        }
        tabla.appendChild(grupoColumnas);

        const cuerpo = document.createElement("tbody");

        for (let fila = filaInicio; fila <= filaFin; fila += 1) {
            const tr = document.createElement("tr");
            const configFila = filasCargadas[fila];
            const alto = altoFilaPx(configFila);
            if (alto) tr.style.height = `${alto}px`;
            if (configFila?.hidden) tr.hidden = true;

            for (let columna = rango.s.c; columna <= rango.e.c; columna += 1) {
                const clave = `${fila}:${columna}`;
                if (omitidas.has(clave)) continue;

                const celda = document.createElement("td");
                const datos = celdaCargada(fila, columna);
                celda.dataset.fila = String(fila);
                celda.dataset.columna = String(columna);
                dibujarContenidoCelda(celda, datos);
                aplicarEstiloCelda(celda, estiloCelda(fila, columna));

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
            meta.textContent = `${libroIndice.SheetNames.length} hojas detectadas · “${hojaActual}” · ${filas.toLocaleString("es-CL")} filas × ${columnas.toLocaleString("es-CL")} columnas · formato visual del XLSX`;
        }
    }

    async function renderizarHoja(nombre) {
        if (!archivoBuffer || !nombre) return;
        const miRender = ++renderId;
        hojaActual = nombre;
        mostrarCargando(`Abriendo “${nombre}” y recuperando su formato…`);

        try {
            const resultado = await leerEnSegundoPlano("hoja", nombre);
            if (miRender !== renderId || !archivoBuffer) return;
            if (!resultado?.rango) {
                mostrarVacio("Hoja vacía", `“${nombre}” no contiene celdas visibles.`);
                return;
            }

            hojaCargada = new Map((resultado.celdas || []).map((celda) => [
                `${celda.r}:${celda.c}`,
                {
                    valor: celda.valor || "",
                    estiloId: Number(celda.estiloId),
                    runs: Array.isArray(celda.runs) ? celda.runs : null
                }
            ]));
            estilosCargados = resultado.estilos || [];
            columnasCargadas = resultado.columnas || [];
            filasCargadas = resultado.filas || [];
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

    async function cargarArchivo(archivo, restaurado = false) {
        if (!archivo) return;
        if (!/\.xlsx$/i.test(archivo.name)) {
            mostrarVacio("Formato no compatible", "Selecciona una copia descargada en formato .xlsx.");
            return;
        }

        limpiarMemoria();
        const cargaId = ++operacionLibro;
        $("libro-reserva-quitar").disabled = false;
        mostrarCargando("Leyendo la copia local del libro…");
        try {
            const buffer = await archivo.arrayBuffer();
            if (cargaId !== operacionLibro) return;
            archivoBuffer = buffer;
            archivoNombre = archivo.name;
            const indice = await leerEnSegundoPlano("indice");
            if (cargaId !== operacionLibro) return;
            libroIndice = {
                SheetNames: indice.nombres || [],
                Workbook: { Sheets: indice.hojas || [] }
            };
            if (!libroIndice.SheetNames?.length) throw new Error("El archivo no contiene hojas");
            let estadoLocal = "";
            let actualizacion = false;
            if (persistenciaPC) {
                persistenciaConfirmada = restaurado;
                estadoLocal = " · copia local restaurada";
                if (!restaurado) {
                    actualizarEstado(archivoNombre, "Guardando copia en este navegador…");
                    try {
                        const guardado = await copiaLocal("guardar", { nombre: archivoNombre, buffer, guardado_en: new Date().toISOString() });
                        actualizacion = guardado.actualizacion;
                        if (cargaId === operacionLibro) persistenciaConfirmada = true;
                        estadoLocal = " · guardado en este navegador";
                    } catch (_) {
                        if (cargaId !== operacionLibro) return;
                        // A failed transaction leaves both previous snapshots intact.
                        estadoLocal = " · NO guardado: al recargar volverá la copia previamente guardada. Libera espacio y vuelve a cargar el XLSX";
                    }
                    if (cargaId !== operacionLibro) return;
                }
            }
            poblarSelector();
            const quitar = $("libro-reserva-quitar");
            if (quitar) quitar.disabled = false;
            actualizarEstado(
                archivoNombre,
                `${bytesLegibles(archivo.size)} · leído localmente ${fechaHoraActual()}${estadoLocal}`
            );
            renderizarHoja(hojaActual);
            if (!restaurado && actualizacion && persistenciaConfirmada) {
                const detalle = {generacion:cargaId, nombre:archivoNombre, tenia_anterior:true, carga_manual:true};
                // Siguiente tarea: cargarArchivo y listo() pueden finalizar antes del consumidor.
                setTimeout(() => {
                    if (cargaId === operacionLibro && persistenciaConfirmada && libroIndice) {
                        window.dispatchEvent(new CustomEvent("haiku:libro-version-cargada", {detail:detalle}));
                    }
                }, 0);
            }
        } catch (error) {
            if (cargaId !== operacionLibro) return;
            console.error("LIBRO RESERVA · Archivo no válido:", error);
            limpiarMemoria();
            mostrarVacio("No fue posible leer el archivo", "Verifica que sea la copia XLSX correcta e inténtalo otra vez.");
            if (persistenciaPC) {
                actualizarEstado("No fue posible leer el archivo", "La copia guardada anteriormente no se reemplazó. Puedes quitarla con el botón.");
                $("libro-reserva-quitar").disabled = false;
            }
        }
    }

    function asegurarCssFidelidad() {
        if (document.getElementById("haiku-libro-reserva-fidelidad-v1")) return;
        const link = document.createElement("link");
        link.id = "haiku-libro-reserva-fidelidad-v1";
        link.rel = "stylesheet";
        link.href = `css/supabase-libro-reserva-fidelidad-v1.css${VERSION_QUERY}`;
        document.head.appendChild(link);
    }

    function consultarHoja(nombre, version = "actual", tipo = "semantica") {
        if (!["semantica", "buscar", "indice", "indice_nombres", "huellas"].includes(tipo)) return Promise.reject(new Error("Consulta no válida"));
        if (!["actual", "anterior"].includes(version)) return Promise.reject(new Error("Versión no válida"));
        const consulta = colaConsulta.then(async () => {
            await cargaLista;
            const id = operacionLibro;
            if (!archivoBuffer || !libroIndice) throw new Error("Carga primero un XLSX en Libro de Reserva.");
            if (version === "anterior" && ["indice", "indice_nombres", "huellas"].includes(tipo) && !persistenciaPC) return null;
            if (version === "anterior" && !persistenciaConfirmada) throw new Error("El Libro actual no está guardado; no se puede comparar con la versión anterior.");
            const key = `${id}:${version}:${tipo}:${JSON.stringify(nombre)}`;
            if (cacheConsultas.has(key)) return structuredClone(cacheConsultas.get(key));
            const registro = version === "anterior" && persistenciaPC ? await copiaLocal("leer_anterior") : null;
            if (id !== operacionLibro) throw new Error("El Libro cambió durante la consulta. Vuelve a preguntar.");
            if (version === "anterior" && !registro?.buffer) {
                if (["indice", "indice_nombres", "huellas"].includes(tipo)) return null;
                throw new Error("Todavía no hay un Libro anterior. Carga una versión diferente para compararlas.");
            }
            const copia = (version === "anterior" ? registro.buffer : archivoBuffer).slice(0);
            const worker = new Worker(`js/supabase-libro-reserva-worker-v1.js${VERSION_QUERY}`);
            const resultado = await new Promise((resolve, reject) => {
                const cancelar = () => terminar(new Error("El Libro cambió durante la consulta. Vuelve a preguntar."));
                const timer = setTimeout(() => terminar(new Error("La lectura tardó demasiado. Intenta una hoja más pequeña.")), 90000);
                function terminar(error, value) {
                    clearTimeout(timer); window.removeEventListener("haiku:libro-cambio", cancelar); worker.terminate();
                    if (error) reject(error); else resolve(value);
                }
                window.addEventListener("haiku:libro-cambio", cancelar, { once: true });
                worker.onmessage = event => event.data?.ok ? terminar(null, event.data.resultado) : terminar(new Error(event.data?.error || "No se pudo interpretar la hoja."));
                worker.onerror = () => terminar(new Error("No se pudo iniciar el lector del Libro."));
                worker.postMessage({ id: 1, tipo, nombreHoja: nombre, nombresHojas: tipo === "huellas" ? nombre : undefined, buffer: copia }, [copia]);
            });
            if (id !== operacionLibro) throw new Error("El Libro cambió durante la consulta.");
            if (cacheConsultas.size >= 3) cacheConsultas.delete(cacheConsultas.keys().next().value);
            cacheConsultas.set(key, resultado);
            return structuredClone(resultado);
        });
        colaConsulta = consulta.catch(() => {});
        return consulta;
    }

    function iniciar() {
        if (!$("seccion-libro-reserva") || window.HAIKU_LIBRO_RESERVA_V1) return;
        asegurarCssFidelidad();
        window.HAIKU_LIBRO_RESERVA_V1 = Object.freeze({
            version: "1.4.0",
            modo: "archivo-local-solo-lectura-estilo-xlsx-richtext",
            limpiar: quitarLibro,
            listo: () => cargaLista,
            listarHojas: () => [...(libroIndice?.SheetNames || [])],
            consultarIndice: (version = "actual") => consultarHoja("", version, "indice_nombres"),
            consultarHuellas: (version = "actual", nombres = []) => consultarHoja([...nombres], version, "huellas"),
            consultarHoja,
            buscarHojas: nombre => consultarHoja(nombre, "actual", "buscar"),
            estado: () => ({ nombre: archivoNombre, generacion: operacionLibro, cargado: !!libroIndice })
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
        entrada?.addEventListener("change", () => { cargaLista = cargarArchivo(entrada.files?.[0]); });
        selector?.addEventListener("change", () => renderizarHoja(selector.value));
        quitar?.addEventListener("click", quitarLibro);
        if (persistenciaPC) cargaLista = restaurarLibro();
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
