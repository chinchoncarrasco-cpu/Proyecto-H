"use strict";

const XLSX_CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

function asegurarLector() {
    if (self.XLSX?.read) return;
    importScripts(XLSX_CDN);
    if (!self.XLSX?.read) throw new Error("El lector XLSX no quedó disponible");
}

function indiceLibro(buffer) {
    const libro = self.XLSX.read(buffer, {
        type: "array",
        bookSheets: true,
        bookProps: true
    });
    return {
        nombres: libro.SheetNames || [],
        hojas: libro.Workbook?.Sheets || []
    };
}

function numeroFinito(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
}

function colorSeguro(color) {
    if (!color || typeof color !== "object") return null;
    const salida = {};
    if (color.rgb != null) salida.rgb = String(color.rgb);
    if (color.indexed != null) salida.indexed = numeroFinito(color.indexed);
    if (color.theme != null) salida.theme = numeroFinito(color.theme);
    if (color.tint != null) salida.tint = numeroFinito(color.tint);
    if (color.auto != null) salida.auto = !!color.auto;
    return Object.keys(salida).length ? salida : null;
}

function bordeSeguro(borde) {
    if (!borde || typeof borde !== "object") return null;
    const salida = {};
    ["left", "right", "top", "bottom"].forEach((lado) => {
        const item = borde[lado];
        if (!item || typeof item !== "object") return;
        const limpio = {};
        if (item.style) limpio.style = String(item.style);
        const color = colorSeguro(item.color);
        if (color) limpio.color = color;
        if (Object.keys(limpio).length) salida[lado] = limpio;
    });
    return Object.keys(salida).length ? salida : null;
}

function estiloSeguro(estilo) {
    if (!estilo || typeof estilo !== "object") return null;

    // Algunas versiones de SheetJS exponen fill/font/alignment/border como
    // objetos anidados y otras dejan las propiedades de fill en la raíz.
    const fillOriginal = estilo.fill && typeof estilo.fill === "object"
        ? estilo.fill
        : estilo;
    const fill = {};
    if (fillOriginal.patternType) fill.patternType = String(fillOriginal.patternType);
    const fg = colorSeguro(fillOriginal.fgColor);
    const bg = colorSeguro(fillOriginal.bgColor);
    if (fg) fill.fgColor = fg;
    if (bg) fill.bgColor = bg;

    const fontOriginal = estilo.font && typeof estilo.font === "object" ? estilo.font : null;
    const font = {};
    if (fontOriginal) {
        if (fontOriginal.name) font.name = String(fontOriginal.name);
        if (fontOriginal.sz != null) font.sz = numeroFinito(fontOriginal.sz);
        if (fontOriginal.bold != null) font.bold = !!fontOriginal.bold;
        if (fontOriginal.italic != null) font.italic = !!fontOriginal.italic;
        if (fontOriginal.underline != null) font.underline = fontOriginal.underline;
        if (fontOriginal.strike != null) font.strike = !!fontOriginal.strike;
        const color = colorSeguro(fontOriginal.color);
        if (color) font.color = color;
    }

    const alineacionOriginal = estilo.alignment && typeof estilo.alignment === "object"
        ? estilo.alignment
        : null;
    const alignment = {};
    if (alineacionOriginal) {
        if (alineacionOriginal.horizontal) alignment.horizontal = String(alineacionOriginal.horizontal);
        if (alineacionOriginal.vertical) alignment.vertical = String(alineacionOriginal.vertical);
        if (alineacionOriginal.wrapText != null) alignment.wrapText = !!alineacionOriginal.wrapText;
        if (alineacionOriginal.shrinkToFit != null) alignment.shrinkToFit = !!alineacionOriginal.shrinkToFit;
        if (alineacionOriginal.textRotation != null) alignment.textRotation = numeroFinito(alineacionOriginal.textRotation);
        if (alineacionOriginal.indent != null) alignment.indent = numeroFinito(alineacionOriginal.indent);
    }

    const border = bordeSeguro(estilo.border);
    const salida = {};
    if (Object.keys(fill).length) salida.fill = fill;
    if (Object.keys(font).length) salida.font = font;
    if (Object.keys(alignment).length) salida.alignment = alignment;
    if (border) salida.border = border;
    return Object.keys(salida).length ? salida : null;
}

function dimensionesColumnas(hoja) {
    return (hoja["!cols"] || []).map((columna) => ({
        wpx: numeroFinito(columna?.wpx),
        wch: numeroFinito(columna?.wch),
        width: numeroFinito(columna?.width),
        hidden: !!columna?.hidden
    }));
}

function dimensionesFilas(hoja) {
    return (hoja["!rows"] || []).map((fila) => ({
        hpx: numeroFinito(fila?.hpx),
        hpt: numeroFinito(fila?.hpt),
        hidden: !!fila?.hidden
    }));
}

function leerHoja(buffer, nombreHoja) {
    const libro = self.XLSX.read(buffer, {
        type: "array",
        sheets: [nombreHoja],
        cellDates: true,
        cellStyles: true,
        cellNF: true,
        cellFormula: true,
        cellHTML: true,
        sheetStubs: true
    });
    const hoja = libro.Sheets[nombreHoja];
    if (!hoja?.["!ref"]) {
        return {
            rango: null,
            celdas: [],
            estilos: [],
            combinaciones: [],
            columnas: [],
            filas: []
        };
    }

    const estilos = [];
    const estilosPorClave = new Map();

    function idEstilo(estilo) {
        const limpio = estiloSeguro(estilo);
        if (!limpio) return -1;
        const clave = JSON.stringify(limpio);
        let id = estilosPorClave.get(clave);
        if (id != null) return id;
        id = estilos.length;
        estilosPorClave.set(clave, id);
        estilos.push(limpio);
        return id;
    }

    const celdas = [];
    Object.keys(hoja).forEach((direccion) => {
        if (direccion.startsWith("!")) return;
        const celda = hoja[direccion];
        if (!celda) return;

        const posicion = self.XLSX.utils.decode_cell(direccion);
        const valor = celda.w != null
            ? String(celda.w)
            : (celda.v == null ? "" : String(celda.v));
        const estiloId = idEstilo(celda.s);

        // Conservamos también celdas vacías con estilo. Son fundamentales para
        // recrear bandas de color y la distribución visual del Libro original.
        if (!valor && estiloId < 0 && celda.f == null && celda.t !== "z") return;

        celdas.push({
            r: posicion.r,
            c: posicion.c,
            valor,
            estiloId
        });
    });

    return {
        rango: self.XLSX.utils.decode_range(hoja["!ref"]),
        celdas,
        estilos,
        combinaciones: (hoja["!merges"] || []).map((rango) => ({
            s: { r: rango.s.r, c: rango.s.c },
            e: { r: rango.e.r, c: rango.e.c }
        })),
        columnas: dimensionesColumnas(hoja),
        filas: dimensionesFilas(hoja)
    };
}

self.addEventListener("message", (evento) => {
    const { id, tipo, nombreHoja, buffer } = evento.data || {};
    try {
        asegurarLector();
        const resultado = tipo === "indice"
            ? indiceLibro(buffer)
            : leerHoja(buffer, nombreHoja);
        self.postMessage({ id, ok: true, resultado });
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            error: error instanceof Error ? error.message : "No fue posible leer el XLSX"
        });
    }
});
