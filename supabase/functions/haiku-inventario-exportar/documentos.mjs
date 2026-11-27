const tiposArchivo = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};
export const mimeInventario = (formato) => tiposArchivo[formato];

const columnasStock = ["Código","Descripción","Categoría","Entradas","Salidas","Stock","Stock mínimo",".","Estado"];
const columnasMovimiento = ["Código","Descripción","Categoría","Fecha","Cantidad","Comentario","Responsable"];
const titulo = (nombre) => nombre.toLocaleUpperCase("es-CL");
const fechaCorta = (iso) => iso.split("-").reverse().join("/");
const anchoStock = [12,40,30,12,12,10,15,5,16];
const anchoMovimientos = [12,36,28,14,11,35,22];

function hojasInventario(datos) {
  return [
    {
      nombre: "Inventario", columnas: columnasStock,
      filas: datos.articulos.map(a => [
        a.codigo,a.descripcion,a.categoria,a.entradas,a.salidas,a.stock,a.stock_minimo,
        a.estado === "Crítico" ? "!" : a.estado === "Agotado" ? "×" : "",a.estado,
      ]),
    },
    ...["Entradas","Salidas"].map(nombre => ({
      nombre, columnas: columnasMovimiento,
      filas: datos.movimientos.filter(m => m.tipo === (nombre === "Entradas" ? "entrada" : "salida"))
        .map(m => [m.codigo,m.descripcion,m.categoria,m.fecha,m.cantidad,m.comentario ?? "",m.responsable ?? ""]),
    })),
  ];
}

const solid = (argb) => ({type:"pattern",pattern:"solid",fgColor:{argb}});
const borde = {style:"thin",color:{argb:"FFB7B7B7"}};

export async function exportarExcel(datos, Workbook) {
  const libro = new Workbook();
  libro.creator = "HAIKU";
  for (const {nombre,columnas,filas} of hojasInventario(datos)) {
    const stock = nombre === "Inventario";
    const hoja = libro.addWorksheet(nombre,{
      views:[{state:"frozen",ySplit:8,showGridLines:false}],
      pageSetup:{paperSize:9,orientation:"portrait",fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:"8:8"},
    });
    hoja.getColumn(1).width = 4;
    for (const [i,ancho] of (stock ? anchoStock : anchoMovimientos).entries()) hoja.getColumn(i+2).width = ancho;
    if (stock) {
      hoja.getColumn("E").hidden = true;
      hoja.getColumn("F").hidden = true;
    }
    hoja.mergeCells(3,2,3,columnas.length+1);
    hoja.getRow(3).height = 47;
    hoja.getCell("B3").value = titulo(nombre);
    hoja.getCell("B3").font = {name:"Arial",size:32,bold:true,color:{argb:"FF000000"}};
    const cabecera = hoja.getRow(8);
    cabecera.height = 21;
    for (const [i,label] of columnas.entries()) {
      const celda = cabecera.getCell(i+2);
      celda.value = label;
      const estado = stock && label === "Estado";
      celda.fill = solid(estado ? "FFFFFFFF" : "FF000000");
      celda.font = {name:"Arial",size:10,bold:true,color:{argb:estado ? "FF000000" : "FFFFFFFF"}};
      celda.alignment = {vertical:"middle"};
      celda.border = {top:borde,left:borde,bottom:borde,right:borde};
    }
    for (const [fila,valores] of filas.entries()) {
      const row = hoja.getRow(fila+9);
      for (const [i,valor] of valores.entries()) {
        const celda = row.getCell(i+2);
        celda.value = !stock && i===3 ? new Date(valor+"T00:00:00Z") : valor;
        if (!stock && i===3) celda.numFmt = "dd/mm/yyyy";
        celda.fill = solid(fila % 2 === 0 ? "FFEBEBEB" : "FFFFFFFF");
        const indicador = stock && i===7;
        const argb = indicador ? (valor==="!" ? "FFB56E10" : "FFC43A3E") : "FF1E1E1E";
        celda.font = {name:"Arial",size:10,bold:indicador,color:{argb}};
        celda.alignment = {vertical:"middle",wrapText:true,...(indicador ? {horizontal:"center"} : {})};
        celda.border = {left:borde,bottom:borde,right:borde};
      }
    }
    hoja.autoFilter = {from:{row:8,column:2},to:{row:Math.max(8,filas.length+8),column:columnas.length+1}};
  }
  return new Uint8Array(await libro.xlsx.writeBuffer());
}

function textoPdf(value,font) {
  return Array.from(String(value ?? "").replace(/\s+/gu," ").trim(), c => {
    try { font.encodeText(c); return c; }
    catch { return c.normalize("NFKD").replace(/[^\x20-\x7e]/g,"") || "?"; }
  }).join("");
}

function lineas(value,max,font,size) {
  const salida = [];
  let actual = "";
  for (const palabra of textoPdf(value,font).split(" ")) {
    const siguiente = actual ? actual+" "+palabra : palabra;
    if (font.widthOfTextAtSize(siguiente,size) <= max) { actual = siguiente; continue; }
    if (actual) salida.push(actual);
    actual = "";
    for (const c of palabra) {
      if (font.widthOfTextAtSize(actual+c,size)>max && actual) {
        salida.push(actual);
        actual = "";
      }
      actual += c;
    }
  }
  salida.push(actual);
  return salida;
}

export async function exportarPdf(datos,{PDFDocument,StandardFonts,rgb}) {
  const doc = await PDFDocument.create();
  doc.setTitle("Inventario HAIKU");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const negro=rgb(0,0,0), blanco=rgb(1,1,1), gris=rgb(.92,.92,.92), linea=rgb(.68,.68,.68);
  const w=842, h=595, m=32, size=9;
  for (const {nombre,columnas,filas} of hojasInventario(datos)) {
    const stock = nombre === "Inventario";
    const visibles = stock ? [0,1,2,5,6,7,8] : [0,1,2,3,4,5,6];
    const anchos = stock ? [64,245,171,62,84,31,121] : [64,188,136,78,58,149,105];
    let pagina,y;
    function cabecera() {
      pagina = doc.addPage([w,h]);
      pagina.drawText(titulo(nombre),{x:m,y:h-m-32,size:32,font:bold,color:negro});
      y = h-m-64;
      let x=m;
      for (const [i,idx] of visibles.entries()) {
        const estado = stock && idx===8;
        pagina.drawRectangle({x,y:y-20,width:anchos[i],height:20,color:estado?blanco:negro,borderColor:linea,borderWidth:.45});
        pagina.drawText(columnas[idx],{x:x+6,y:y-13,size,font:bold,color:estado?negro:blanco});
        x+=anchos[i];
      }
      y-=20;
    }
    cabecera();
    for (const [r,fila] of filas.entries()) {
      const celdas=visibles.map((idx,i)=>lineas(!stock&&idx===3?fechaCorta(fila[idx]):fila[idx],anchos[i]-12,font,size));
      const alto=Math.max(19,Math.max(...celdas.map(c=>c.length))*11+8);
      if (y-alto<m) cabecera();
      let x=m;
      for (const [i,idx] of visibles.entries()) {
        pagina.drawRectangle({x,y:y-alto,width:anchos[i],height:alto,color:r%2===0?gris:blanco,borderColor:linea,borderWidth:.4});
        if (stock&&idx===7&&fila[idx]) {
          const cx=x+anchos[i]/2, cy=y-alto/2;
          pagina.drawCircle({x:cx,y:cy,size:5,color:fila[idx]==="!"?rgb(.73,.44,.08):rgb(.73,.2,.24)});
          pagina.drawText(fila[idx],{x:cx-bold.widthOfTextAtSize(fila[idx],7)/2,y:cy-2.5,size:7,font:bold,color:blanco});
        } else {
          for (const [n,parte] of celdas[i].entries()) {
            const numero=typeof fila[idx]==="number";
            pagina.drawText(parte,{x:numero?x+anchos[i]-6-font.widthOfTextAtSize(parte,size):x+6,y:y-12-n*11,size,font,color:negro});
          }
        }
        x+=anchos[i];
      }
      y-=alto;
    }
  }
  return await doc.save();
}
