"use strict";

const XLSX_CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
const JSZIP_CDN = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

function asegurarLector() {
    if (!self.XLSX?.read) importScripts(XLSX_CDN);
    if (!self.XLSX?.read) throw new Error("El lector XLSX no quedó disponible");
}

function asegurarZip() {
    if (!self.JSZip?.loadAsync) importScripts(JSZIP_CDN);
    if (!self.JSZip?.loadAsync) throw new Error("El lector OOXML no quedó disponible");
}

function numeroFinito(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
}

function booleanoXml(valor) {
    if (valor == null) return false;
    const t = String(valor).toLowerCase();
    return t === "1" || t === "true";
}

function decodificarXml(valor) {
    return String(valor ?? "")
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

function atributosXml(texto) {
    const salida = {};
    String(texto || "").replace(/([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, nombre, __, doble, simple) => {
        salida[nombre] = decodificarXml(doble != null ? doble : simple);
        return "";
    });
    return salida;
}

function primerTag(contenido, nombre) {
    const re = new RegExp(`<${nombre}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${nombre}>)`, "i");
    const m = String(contenido || "").match(re);
    return m ? { attrs: atributosXml(m[1]), inner: m[2] || "" } : null;
}

function bloques(contenido, nombre) {
    const salida = [];
    const re = new RegExp(`<${nombre}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${nombre}>)`, "gi");
    let m;
    while ((m = re.exec(String(contenido || "")))) {
        salida.push({ attrs: atributosXml(m[1]), inner: m[2] || "" });
    }
    return salida;
}

function colorDesdeAttrs(attrs) {
    if (!attrs) return null;
    const salida = {};
    if (attrs.rgb != null) salida.rgb = String(attrs.rgb);
    if (attrs.indexed != null) salida.indexed = numeroFinito(attrs.indexed);
    if (attrs.theme != null) salida.theme = numeroFinito(attrs.theme);
    if (attrs.tint != null) salida.tint = numeroFinito(attrs.tint);
    if (attrs.auto != null) salida.auto = booleanoXml(attrs.auto);
    return Object.keys(salida).length ? salida : null;
}

function colorDeTag(contenido, nombre) {
    const tag = primerTag(contenido, nombre);
    return tag ? colorDesdeAttrs(tag.attrs) : null;
}

function parsearFuente(inner) {
    const salida = {};
    const name = primerTag(inner, "name") || primerTag(inner, "rFont");
    const sz = primerTag(inner, "sz");
    const color = colorDeTag(inner, "color");
    const b = primerTag(inner, "b");
    const i = primerTag(inner, "i");
    const u = primerTag(inner, "u");
    const strike = primerTag(inner, "strike");
    if (name?.attrs?.val) salida.name = name.attrs.val;
    if (sz?.attrs?.val != null) salida.sz = numeroFinito(sz.attrs.val);
    if (color) salida.color = color;
    if (b) salida.bold = b.attrs.val == null ? true : booleanoXml(b.attrs.val);
    if (i) salida.italic = i.attrs.val == null ? true : booleanoXml(i.attrs.val);
    if (u) salida.underline = u.attrs.val || true;
    if (strike) salida.strike = strike.attrs.val == null ? true : booleanoXml(strike.attrs.val);
    return Object.keys(salida).length ? salida : null;
}

function parsearFill(inner) {
    const pattern = primerTag(inner, "patternFill");
    if (!pattern) return null;
    const salida = {};
    if (pattern.attrs.patternType) salida.patternType = pattern.attrs.patternType;
    const fg = colorDeTag(pattern.inner, "fgColor");
    const bg = colorDeTag(pattern.inner, "bgColor");
    if (fg) salida.fgColor = fg;
    if (bg) salida.bgColor = bg;
    return Object.keys(salida).length ? salida : null;
}

function parsearLadoBorde(inner, lado) {
    const tag = primerTag(inner, lado);
    if (!tag) return null;
    const salida = {};
    if (tag.attrs.style) salida.style = tag.attrs.style;
    const color = colorDeTag(tag.inner, "color");
    if (color) salida.color = color;
    return Object.keys(salida).length ? salida : null;
}

function parsearBorde(inner) {
    const salida = {};
    ["left", "right", "top", "bottom"].forEach((lado) => {
        const valor = parsearLadoBorde(inner, lado);
        if (valor) salida[lado] = valor;
    });
    return Object.keys(salida).length ? salida : null;
}

function parsearAlineacion(inner) {
    const tag = primerTag(inner, "alignment");
    if (!tag) return null;
    const a = tag.attrs;
    const salida = {};
    if (a.horizontal) salida.horizontal = a.horizontal;
    if (a.vertical) salida.vertical = a.vertical;
    if (a.wrapText != null) salida.wrapText = booleanoXml(a.wrapText);
    if (a.shrinkToFit != null) salida.shrinkToFit = booleanoXml(a.shrinkToFit);
    if (a.textRotation != null) salida.textRotation = numeroFinito(a.textRotation);
    if (a.indent != null) salida.indent = numeroFinito(a.indent);
    return Object.keys(salida).length ? salida : null;
}

function parsearEstilosXml(xml) {
    if (!xml) return [];
    const fontsCont = primerTag(xml, "fonts")?.inner || "";
    const fillsCont = primerTag(xml, "fills")?.inner || "";
    const bordersCont = primerTag(xml, "borders")?.inner || "";
    const xfsCont = primerTag(xml, "cellXfs")?.inner || "";

    const fonts = bloques(fontsCont, "font").map((b) => parsearFuente(b.inner));
    const fills = bloques(fillsCont, "fill").map((b) => parsearFill(b.inner));
    const borders = bloques(bordersCont, "border").map((b) => parsearBorde(b.inner));

    return bloques(xfsCont, "xf").map((xf) => {
        const salida = {};
        const fontId = Number(xf.attrs.fontId || 0);
        const fillId = Number(xf.attrs.fillId || 0);
        const borderId = Number(xf.attrs.borderId || 0);
        if (fonts[fontId]) salida.font = fonts[fontId];
        if (fills[fillId]) salida.fill = fills[fillId];
        if (borders[borderId]) salida.border = borders[borderId];
        const alineacion = parsearAlineacion(xf.inner);
        if (alineacion) salida.alignment = alineacion;
        return Object.keys(salida).length ? salida : null;
    });
}

function textoDeTagsT(contenido) {
    return bloques(contenido, "t")
        .map((tag) => decodificarXml(tag.inner))
        .join("");
}

function parsearTextoEnriquecido(contenido) {
    const runs = bloques(contenido, "r");
    if (!runs.length) return [];

    return runs.map((run) => {
        const rPr = primerTag(run.inner, "rPr");
        return {
            texto: textoDeTagsT(run.inner),
            font: rPr ? parsearFuente(rPr.inner) : null
        };
    }).filter((run) => run.texto !== "");
}

async function leerTextosCompartidos(zip) {
    const xml = await zip.file("xl/sharedStrings.xml")?.async("text");
    if (!xml) return [];
    return bloques(xml, "si").map((si) => parsearTextoEnriquecido(si.inner));
}

function rutaNormalizada(base, target) {
    let ruta = String(target || "").replace(/^\/+/, "");
    if (ruta.startsWith("xl/")) return ruta;
    if (ruta.startsWith("../")) {
        ruta = ruta.replace(/^\.\.\//, "");
        return ruta;
    }
    return `${base}/${ruta}`.replace(/\/\.\//g, "/");
}

async function rutaHojaDesdeNombre(zip, nombreHoja) {
    const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
    const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
    if (!workbookXml || !relsXml) return null;

    let rid = null;
    for (const sheet of bloques(workbookXml, "sheet")) {
        if (sheet.attrs.name === nombreHoja) {
            rid = sheet.attrs["r:id"] || sheet.attrs.id || null;
            break;
        }
    }
    if (!rid) return null;

    for (const rel of bloques(relsXml, "Relationship")) {
        if (rel.attrs.Id === rid) return rutaNormalizada("xl", rel.attrs.Target);
    }
    return null;
}

function indiceColumnaDesdeLetras(letras) {
    let n = 0;
    for (const ch of String(letras || "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

function posicionDesdeDireccion(direccion) {
    const m = String(direccion || "").match(/^([A-Z]+)(\d+)$/i);
    if (!m) return null;
    return { r: Number(m[2]) - 1, c: indiceColumnaDesdeLetras(m[1]) };
}

function parsearDimensionesHoja(xml) {
    const columnas = [];
    for (const col of bloques(primerTag(xml, "cols")?.inner || "", "col")) {
        const min = Math.max(1, Number(col.attrs.min || 1));
        const max = Math.max(min, Number(col.attrs.max || min));
        const dato = {
            width: numeroFinito(col.attrs.width),
            hidden: booleanoXml(col.attrs.hidden)
        };
        for (let i = min - 1; i <= max - 1; i += 1) columnas[i] = dato;
    }

    const filas = [];
    for (const row of bloques(xml, "row")) {
        const indice = Number(row.attrs.r || 0) - 1;
        if (indice < 0) continue;
        filas[indice] = {
            hpt: numeroFinito(row.attrs.ht),
            hidden: booleanoXml(row.attrs.hidden)
        };
    }
    return { columnas, filas };
}

function parsearCeldasXml(xml, textosCompartidos = []) {
    const mapa = new Map();
    for (const celda of bloques(xml, "c")) {
        const direccion = celda.attrs.r;
        if (!direccion) continue;
        const pos = posicionDesdeDireccion(direccion);
        if (!pos) continue;
        const estiloId = celda.attrs.s != null ? Number(celda.attrs.s) : 0;
        const tipo = String(celda.attrs.t || "");
        let runs = [];

        if (tipo === "s") {
            const indice = Number((primerTag(celda.inner, "v")?.inner || "").trim());
            if (Number.isInteger(indice) && indice >= 0) runs = textosCompartidos[indice] || [];
        } else if (tipo === "inlineStr") {
            const inline = primerTag(celda.inner, "is");
            if (inline) runs = parsearTextoEnriquecido(inline.inner);
        }

        mapa.set(direccion, {
            r: pos.r,
            c: pos.c,
            estiloId: Number.isInteger(estiloId) ? estiloId : 0,
            runs: runs.length ? runs : null
        });
    }
    return mapa;
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

async function leerHoja(buffer, nombreHoja) {
    asegurarLector();
    asegurarZip();

    // SheetJS resuelve valores, fórmulas, formato visible, merges y rango.
    // OOXML se usa como fuente de verdad para estilos, dimensiones y texto enriquecido.
    const libro = self.XLSX.read(buffer, {
        type: "array",
        sheets: [nombreHoja],
        cellDates: true,
        cellStyles: true,
        cellNF: true,
        cellFormula: true,
        sheetStubs: true
    });
    const hoja = libro.Sheets[nombreHoja];
    if (!hoja?.["!ref"]) {
        return { rango: null, celdas: [], estilos: [], combinaciones: [], columnas: [], filas: [] };
    }

    let estilos = [];
    let columnas = [];
    let filas = [];
    let celdasXml = new Map();

    try {
        const zip = await self.JSZip.loadAsync(buffer);
        const estilosXml = await zip.file("xl/styles.xml")?.async("text");
        estilos = parsearEstilosXml(estilosXml || "");
        const textosCompartidos = await leerTextosCompartidos(zip);
        const rutaHoja = await rutaHojaDesdeNombre(zip, nombreHoja);
        const hojaXml = rutaHoja ? await zip.file(rutaHoja)?.async("text") : null;
        if (hojaXml) {
            const dimensiones = parsearDimensionesHoja(hojaXml);
            columnas = dimensiones.columnas;
            filas = dimensiones.filas;
            celdasXml = parsearCeldasXml(hojaXml, textosCompartidos);
        }
    } catch (error) {
        // Si el complemento OOXML no estuviera disponible, mantenemos la lectura
        // funcional de valores. La vista simplemente cae al estilo básico.
        console.warn("LIBRO RESERVA · Fidelidad OOXML parcial:", error?.message || error);
    }

    const porDireccion = new Map();
    Object.keys(hoja).forEach((direccion) => {
        if (direccion.startsWith("!")) return;
        const celda = hoja[direccion];
        if (!celda) return;
        const posicion = self.XLSX.utils.decode_cell(direccion);
        const valor = celda.w != null ? String(celda.w) : (celda.v == null ? "" : String(celda.v));
        const infoXml = celdasXml.get(direccion);
        const estiloId = infoXml?.estiloId;
        if (!valor && estiloId == null && celda.f == null && celda.t !== "z") return;
        porDireccion.set(direccion, {
            r: posicion.r,
            c: posicion.c,
            valor,
            estiloId: Number.isInteger(estiloId) ? estiloId : -1,
            runs: infoXml?.runs || null
        });
    });

    // Celdas vacías con estilo son parte del diseño (bandas, separadores, bordes).
    celdasXml.forEach((info, direccion) => {
        if (porDireccion.has(direccion)) return;
        if (!info.estiloId) return;
        porDireccion.set(direccion, {
            r: info.r,
            c: info.c,
            valor: "",
            estiloId: info.estiloId,
            runs: null
        });
    });

    return {
        rango: self.XLSX.utils.decode_range(hoja["!ref"]),
        celdas: [...porDireccion.values()],
        estilos,
        combinaciones: (hoja["!merges"] || []).map((rango) => ({
            s: { r: rango.s.r, c: rango.s.c },
            e: { r: rango.e.r, c: rango.e.c }
        })),
        columnas,
        filas
    };
}

self.addEventListener("message", async (evento) => {
    const { id, tipo, nombreHoja, buffer } = evento.data || {};
    try {
        asegurarLector();
        const resultado = tipo === "indice"
            ? indiceLibro(buffer)
            : await leerHoja(buffer, nombreHoja);
        self.postMessage({ id, ok: true, resultado });
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            error: error instanceof Error ? error.message : "No fue posible leer el XLSX"
        });
    }
});
