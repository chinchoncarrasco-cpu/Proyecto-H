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

function leerHoja(buffer, nombreHoja) {
    const libro = self.XLSX.read(buffer, {
        type: "array",
        sheets: [nombreHoja],
        cellDates: true,
        cellStyles: false,
        cellFormula: true
    });
    const hoja = libro.Sheets[nombreHoja];
    if (!hoja?.["!ref"]) return { rango: null, celdas: [], combinaciones: [] };

    const celdas = [];
    Object.keys(hoja).forEach((direccion) => {
        if (direccion.startsWith("!")) return;
        const celda = hoja[direccion];
        if (!celda || (celda.w == null && celda.v == null && celda.f == null)) return;
        const posicion = self.XLSX.utils.decode_cell(direccion);
        const valor = celda.w != null ? String(celda.w) : (celda.v == null ? "" : String(celda.v));
        celdas.push({ r: posicion.r, c: posicion.c, valor });
    });

    return {
        rango: self.XLSX.utils.decode_range(hoja["!ref"]),
        celdas,
        combinaciones: (hoja["!merges"] || []).map((rango) => ({
            s: { r: rango.s.r, c: rango.s.c },
            e: { r: rango.e.r, c: rango.e.c }
        }))
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
