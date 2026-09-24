// RESERVAS · COPIAR LA VISTA SITES COMO PNG
// Sólo columnas y filas visibles; no consulta ni escribe datos.
// ========================================
// RESERVAS · COPIAR TABLA COMO PNG V1
// Genera una imagen de la página actualmente renderizada de Reservas.
// Respeta filtros, filas, columnas visibles y su orden actual.
// No consulta ni modifica Supabase.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_RESERVAS_COPIAR_V1) return;

    const seccion = document.getElementById("seccion-reservas");
    const boton = document.getElementById("reservas-copiar-tabla");
    const tabla = seccion?.querySelector(".rv-table.sites-reservas-tabla");
    const chips = document.getElementById("reservas-chips");
    const contador = document.getElementById("reservas-contador");

    if (!seccion || !boton || !tabla) return;

    const PALETA = Object.freeze({
        fondo: "#f4f7f5",
        tarjeta: "#ffffff",
        cabecera: "#f0f4f2",
        borde: "#dce5df",
        linea: "#edf1ee",
        texto: "#1d2b24",
        secundario: "#66746d",
        verde: "#1f7652",
        verdeOscuro: "#13553a"
    });

    const ESTADOS = Object.freeze({
        confirmada: { fondo: "#e8f2ff", texto: "#2765a5" },
        hospedada: { fondo: "#e6f6ed", texto: "#18704a" },
        hospedado: { fondo: "#e6f6ed", texto: "#18704a" },
        checked_out: { fondo: "#e6f7f6", texto: "#18756f" },
        pendiente: { fondo: "#fff4d8", texto: "#806013" },
        cancelada: { fondo: "#fdebea", texto: "#a23b36" },
        no_show: { fondo: "#fdebea", texto: "#a23b36" }
    });

    function limpiarTexto(valor) {
        return String(valor ?? "")
            .replace(/[\t\r\n]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    function normalizarClave(valor) {
        return limpiarTexto(valor)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[\s-]+/g, "_");
    }

    function encabezadoVisible(th) {
        const clon = th.cloneNode(true);
        clon.querySelectorAll(".reservas-orden, .rv-sort, button span, [aria-hidden='true'], svg").forEach(nodo => nodo.remove());
        return limpiarTexto(clon.textContent);
    }

    function elementoVisible(elemento) {
        if (elemento.hidden || elemento.getAttribute("aria-hidden") === "true") return false;
        const estilo = getComputedStyle(elemento);
        return estilo.display !== "none" && estilo.visibility !== "hidden" && estilo.visibility !== "collapse";
    }

    function textoVisible(elemento) {
        const partes = [];
        function visitar(nodo) {
            if (nodo.nodeType === 3) {
                partes.push(nodo.nodeValue);
                return;
            }
            if (nodo.nodeType !== 1 || !elementoVisible(nodo)) return;
            if (nodo.matches(".sr-only, .visually-hidden")) return;
            nodo.childNodes.forEach(visitar);
        }
        visitar(elemento);
        return limpiarTexto(partes.join(" "));
    }

    function filtrosVisibles() {
        if (!chips || chips.hidden) return [];

        return [...chips.querySelectorAll(".reservas-chip:not(.reservas-chip--limpiar)")]
            .map(chip => {
                const clon = chip.cloneNode(true);
                clon.querySelectorAll("button").forEach(boton => boton.remove());
                return limpiarTexto(clon.textContent);
            })
            .filter(Boolean);
    }

    function redondearRectangulo(ctx, x, y, ancho, alto, radio) {
        const r = Math.min(radio, ancho / 2, alto / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + ancho, y, x + ancho, y + alto, r);
        ctx.arcTo(x + ancho, y + alto, x, y + alto, r);
        ctx.arcTo(x, y + alto, x, y, r);
        ctx.arcTo(x, y, x + ancho, y, r);
        ctx.closePath();
    }

    function textoAjustado(ctx, texto, anchoMaximo) {
        const valor = limpiarTexto(texto);
        if (!valor || ctx.measureText(valor).width <= anchoMaximo) return valor;

        let inicio = 0;
        let fin = valor.length;
        while (inicio < fin) {
            const medio = Math.ceil((inicio + fin) / 2);
            const candidato = `${valor.slice(0, medio)}…`;
            if (ctx.measureText(candidato).width <= anchoMaximo) inicio = medio;
            else fin = medio - 1;
        }
        return `${valor.slice(0, Math.max(0, inicio))}…`;
    }

    function lineasCabecera(ctx, texto, anchoMaximo) {
        const palabras = limpiarTexto(texto).split(" ").filter(Boolean);
        if (!palabras.length) return [""];

        const lineas = [];
        let linea = "";
        palabras.forEach(palabra => {
            const prueba = linea ? `${linea} ${palabra}` : palabra;
            if (!linea || ctx.measureText(prueba).width <= anchoMaximo) {
                linea = prueba;
                return;
            }
            lineas.push(linea);
            linea = palabra;
        });
        if (linea) lineas.push(linea);

        if (lineas.length <= 2) return lineas;
        return [lineas[0], textoAjustado(ctx, lineas.slice(1).join(" "), anchoMaximo)];
    }

    function datosTabla() {
        const listaMovil = seccion.querySelector(".sites-reservas-mobile");
        if (listaMovil && elementoVisible(listaMovil)) {
            return datosListaMovil(listaMovil);
        }

        const encabezados = [...tabla.querySelectorAll("thead th[data-columna]")]
            .filter(elementoVisible)
            .map(th => ({
                label: encabezadoVisible(th),
                id: th.dataset.columna
            }))
            .filter(columna => columna.label);

        const filas = [...tabla.querySelectorAll("tbody tr")]
            .filter(elementoVisible)
            .map(fila => {
                const celdas = [...fila.querySelectorAll("td[data-columna]")]
                    .filter(elementoVisible);
                return encabezados.map(columna => {
                    const celda = celdas.find(td => td.dataset.columna === columna.id);
                    return celda ? { texto: textoVisible(celda), id: columna.id } : null;
                });
            })
            .filter(fila => fila.every(Boolean));

        if (!encabezados.length || !filas.length) {
            throw new Error("No hay reservas visibles para copiar.");
        }

        return { encabezados, filas };
    }

    function datosListaMovil(lista) {
        const etiquetas = Object.freeze({
            guest: "Huésped / reserva", cabin: "Cabaña", stay: "Estadía",
            status: "Estado", pax: "Huéspedes", total: "Precio total",
            deposit: "Depósito / abono", due: "Saldo pendiente"
        });
        const tarjetas = [...lista.querySelectorAll(".rv-mobile-row")].filter(elementoVisible);
        if (!tarjetas.length) throw new Error("No hay reservas visibles para copiar.");

        function campoVisible(campo, tarjeta) {
            for (let nodo = campo; nodo && nodo !== tarjeta; nodo = nodo.parentElement) {
                if (!elementoVisible(nodo)) return false;
            }
            return true;
        }

        const ids = new Set();
        const encabezados = [];
        tarjetas[0].querySelectorAll("[data-columna]").forEach(campo => {
            const id = campo.dataset.columna;
            if (!etiquetas[id] || ids.has(id) || !campoVisible(campo, tarjetas[0])) return;
            ids.add(id);
            encabezados.push({ id, label: etiquetas[id] });
        });
        if (!encabezados.length) throw new Error("No hay columnas visibles para copiar.");

        const filas = tarjetas.map(tarjeta => {
            const campos = [...tarjeta.querySelectorAll("[data-columna]")]
                .filter(campo => campoVisible(campo, tarjeta));
            return encabezados.map(columna => {
                const campo = campos.find(nodo => nodo.dataset.columna === columna.id);
                return { id: columna.id, texto: campo ? textoVisible(campo) : "—" };
            });
        });

        return { encabezados, filas };
    }

    function anchoMinimo(id) {
        if (["guest", "email"].includes(id)) return 210;
        if (["stay", "cabin", "plan", "document"].includes(id)) return 175;
        if (["phone", "status", "pax"].includes(id)) return 145;
        if (["total", "deposit", "due"].includes(id)) return 125;
        return 105;
    }

    function calcularAnchos(ctx, encabezados, filas) {
        return encabezados.map((columna, indice) => {
            ctx.font = "700 12px Arial, sans-serif";
            let mayor = ctx.measureText(columna.label).width + 34;
            ctx.font = "12px Arial, sans-serif";
            filas.forEach(fila => {
                mayor = Math.max(mayor, ctx.measureText(fila[indice]?.texto || "").width + 30);
            });
            return Math.ceil(Math.min(360, Math.max(anchoMinimo(columna.id), mayor)));
        });
    }

    function dibujarBadge(ctx, x, y, anchoCelda, altoFila, texto, fondo, color, conPunto = false) {
        ctx.font = "700 11px Arial, sans-serif";
        const espacioPunto = conPunto ? 15 : 0;
        const ancho = Math.min(anchoCelda - 20, ctx.measureText(texto).width + 22 + espacioPunto);
        const alto = 26;
        const px = x + 10;
        const py = y + (altoFila - alto) / 2;

        ctx.fillStyle = fondo;
        redondearRectangulo(ctx, px, py, ancho, alto, 13);
        ctx.fill();

        let textoX = px + 11;
        if (conPunto) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(px + 12, py + alto / 2, 3.5, 0, Math.PI * 2);
            ctx.fill();
            textoX = px + 22;
        }

        ctx.fillStyle = color;
        ctx.textBaseline = "middle";
        ctx.fillText(textoAjustado(ctx, texto, ancho - (textoX - px) - 9), textoX, py + alto / 2 + 0.5);
    }

    function dibujarCelda(ctx, celda, columna, x, y, ancho, alto) {
        const id = celda.id || columna.id;
        const texto = celda.texto || "—";

        if (id === "status") {
            const clave = normalizarClave(texto);
            const estilo = ESTADOS[clave] || { fondo: "#edf2ef", texto: "#536159" };
            dibujarBadge(ctx, x, y, ancho, alto, texto, estilo.fondo, estilo.texto, true);
            return;
        }

        if (id === "plan" && /full\s*day/i.test(texto)) {
            dibujarBadge(ctx, x, y, ancho, alto, texto, "#fff0c9", "#765006");
            return;
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 9, y + 2, ancho - 18, alto - 4);
        ctx.clip();
        ctx.font = ["guest", "cabin"].includes(id)
            ? "700 12px Arial, sans-serif"
            : "12px Arial, sans-serif";
        ctx.fillStyle = texto === "—" ? "#9aa49f" : PALETA.texto;
        ctx.textBaseline = "middle";
        ctx.textAlign = ["total", "deposit", "due"].includes(id) ? "right" : "left";
        const disponible = ancho - 20;
        const dibujado = textoAjustado(ctx, texto, disponible);
        const textoX = ctx.textAlign === "right" ? x + ancho - 10 : x + 10;
        ctx.fillText(dibujado, textoX, y + alto / 2 + 0.5);
        ctx.restore();
        ctx.textAlign = "left";
    }

    function crearImagen() {
        const { encabezados, filas } = datosTabla();
        const canvasMedida = document.createElement("canvas");
        const medida = canvasMedida.getContext("2d");
        const anchos = calcularAnchos(medida, encabezados, filas);
        const margen = 28;
        const altoTitulo = 66;
        const filtros = filtrosVisibles();
        const altoFiltros = filtros.length ? 38 : 0;
        const altoCabecera = 54;
        const altoFila = 46;
        const anchoTabla = anchos.reduce((suma, valor) => suma + valor, 0);
        const anchoCss = anchoTabla + margen * 2;
        const altoCss = margen + altoTitulo + altoFiltros + altoCabecera + filas.length * altoFila + margen;
        const escalaDeseada = 2;
        const escala = Math.max(1, Math.min(escalaDeseada, 15000 / anchoCss, 15000 / altoCss));

        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(anchoCss * escala);
        canvas.height = Math.ceil(altoCss * escala);
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("El navegador no pudo crear la imagen.");
        ctx.scale(escala, escala);

        ctx.fillStyle = PALETA.fondo;
        ctx.fillRect(0, 0, anchoCss, altoCss);

        const xTabla = margen;
        let y = margen;
        ctx.fillStyle = PALETA.tarjeta;
        redondearRectangulo(ctx, margen, margen, anchoTabla, altoCss - margen * 2, 16);
        ctx.fill();

        ctx.fillStyle = PALETA.verdeOscuro;
        ctx.font = "800 20px Arial, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText("RESERVAS · VISTA ACTUAL", margen + 18, y + 14);

        const totalTexto = limpiarTexto(contador?.textContent) || `${filas.length} reservas`;
        ctx.fillStyle = PALETA.secundario;
        ctx.font = "12px Arial, sans-serif";
        ctx.fillText(totalTexto, margen + 18, y + 41);
        y += altoTitulo;

        if (filtros.length) {
            ctx.fillStyle = "#fbfcfb";
            ctx.fillRect(xTabla, y, anchoTabla, altoFiltros);
            ctx.fillStyle = PALETA.verde;
            ctx.font = "700 11px Arial, sans-serif";
            const resumenFiltros = `Filtros: ${filtros.join(" · ")}`;
            ctx.fillText(textoAjustado(ctx, resumenFiltros, anchoTabla - 36), xTabla + 18, y + 13);
            y += altoFiltros;
        }

        ctx.fillStyle = PALETA.cabecera;
        ctx.fillRect(xTabla, y, anchoTabla, altoCabecera);

        let x = xTabla;
        encabezados.forEach((columna, indice) => {
            const ancho = anchos[indice];
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + 9, y + 2, ancho - 18, altoCabecera - 4);
            ctx.clip();
            ctx.fillStyle = "#34443b";
            ctx.font = "800 11px Arial, sans-serif";
            ctx.textBaseline = "middle";
            const lineas = lineasCabecera(ctx, columna.label, ancho - 20);
            const inicioY = y + altoCabecera / 2 - ((lineas.length - 1) * 7);
            lineas.forEach((linea, lineaIndice) => {
                ctx.fillText(linea, x + 10, inicioY + lineaIndice * 14);
            });
            ctx.restore();
            x += ancho;
        });

        y += altoCabecera;
        filas.forEach((fila, filaIndice) => {
            x = xTabla;
            ctx.fillStyle = filaIndice % 2 === 0 ? "#ffffff" : "#fbfdfc";
            ctx.fillRect(xTabla, y, anchoTabla, altoFila);

            fila.forEach((celda, indice) => {
                dibujarCelda(ctx, celda, encabezados[indice], x, y, anchos[indice], altoFila);
                x += anchos[indice];
            });

            ctx.strokeStyle = PALETA.linea;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(xTabla, y + altoFila - 0.5);
            ctx.lineTo(xTabla + anchoTabla, y + altoFila - 0.5);
            ctx.stroke();
            y += altoFila;
        });

        ctx.strokeStyle = PALETA.borde;
        ctx.lineWidth = 1;
        ctx.strokeRect(xTabla + 0.5, margen + altoTitulo + altoFiltros + 0.5, anchoTabla - 1, altoCabecera + filas.length * altoFila - 1);

        return canvas;
    }

    function canvasABlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error("No fue posible convertir la tabla a PNG."));
            }, "image/png");
        });
    }

    async function copiarPng(blob) {
        if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
            return false;
        }

        await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
        ]);
        return true;
    }

    function descargarPng(blob) {
        const enlace = document.createElement("a");
        const url = URL.createObjectURL(blob);
        const fecha = new Date().toISOString().slice(0, 10);
        enlace.href = url;
        enlace.download = `reservas-haiku-${fecha}.png`;
        enlace.hidden = true;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function generarYCopiar() {
        const canvas = crearImagen();
        const blob = await canvasABlob(canvas);

        try {
            if (await copiarPng(blob)) return "copiado";
        } catch (error) {
            console.warn("RESERVAS · El portapapeles de imágenes no está disponible; se descargará el PNG.", error);
        }

        descargarPng(blob);
        return "descargado";
    }

    boton.addEventListener("click", async () => {
        const textoOriginal = boton.innerHTML;
        boton.disabled = true;

        try {
            const resultado = await generarYCopiar();
            if (resultado === "copiado") {
                boton.innerHTML = "✓ <span>Imagen copiada</span>";
                boton.dataset.estado = "copiado";
            } else {
                boton.innerHTML = "↓ <span>PNG descargado</span>";
                boton.dataset.estado = "descargado";
            }
        } catch (error) {
            console.error("RESERVAS · No fue posible generar la imagen:", error);
            boton.innerHTML = "! <span>Sin datos</span>";
            boton.dataset.estado = "error";
        }

        window.setTimeout(() => {
            boton.innerHTML = textoOriginal;
            boton.disabled = false;
            delete boton.dataset.estado;
        }, 1800);
    });

    window.HAIKU_RESERVAS_COPIAR_V1 = Object.freeze({
        crearImagen,
        generarYCopiar
    });

})();
