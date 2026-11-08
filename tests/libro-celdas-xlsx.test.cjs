const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const assets=process.env.HAIKU_LIBRO_WORKER_ASSETS||'/tmp/haku-lectura-assets';
const XLSX=require(path.join(assets,'xlsx.full.min.js')),JSZip=require(path.join(assets,'jszip.min.js'));
const {crearLector}=require('../js/supabase-libro-reserva-worker-v1.js');
const S=require('../js/haiku-libro-semantica-v1.js');

// Paquete OOXML mínimo de prueba, sin datos operacionales ni archivos externos.
async function archivo({sinEstilos=false}={}) {
 const z=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
 z.file('[Content_Types].xml',(await z.file('[Content_Types].xml').async('text')).replace('</Types>','<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'));
 z.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 z.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Nov26" sheetId="1" r:id="rId1"/></sheets></workbook>`);
 z.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
 if(!sinEstilos)z.file('xl/styles.xml',`<styleSheet xmlns="${ns}"><fonts count="1"><font><name val="Arial"/><sz val="11"/><color rgb="FF000000"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`);
 const serial=fecha=>(Date.parse(fecha+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;
 const str=(r,t)=>`<c r="${r}" t="inlineStr"><is><t>${t}</t></is></c>`;
 z.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><dimension ref="A1:K30"/><sheetData>
 <row r="2"><c r="C2" s="1"><v>${serial('2026-11-06')}</v></c><c r="G2" s="1"><v>${serial('2026-11-07')}</v></c></row>
 <row r="3">${str('A3','cabaña 3')}<c r="C3" t="inlineStr"><is><r><rPr><color rgb="FFFFFFFF"/></rPr><t>Ana Pérez // 2 ADL // 1 noche // </t></r><r><rPr><color rgb="FFFF0000"/></rPr><t>Tinaja 06-11-2026 17:00 cortesía</t></r></is></c></row>
 <row r="25">${str('C25','Pagos de arriendos de hoy')}${str('G25','Pagos de arriendos de hoy')}</row>
 <row r="26">${str('A26','cabaña 3')}<c r="C26" s="1"><v>${serial('2026-11-05')}</v></c>${str('D26','Ana Pérez // Efectivo')}${str('E26','Alojamiento')}<c r="F26"><f>40000+10000</f><v>50000</v></c></row>
 <row r="27"><c r="F27" t="e"><v>#VALUE!</v></c></row>
 </sheetData><mergeCells count="4"><mergeCell ref="C2:E2"/><mergeCell ref="G2:I2"/><mergeCell ref="C3:E3"/><mergeCell ref="A26:A30"/></mergeCells></worksheet>`);
 return z.generateAsync({type:'nodebuffer'});
}

test('XLSX real conserva coordenadas, fechas, colores por fragmento, valores y fórmulas',async()=>{
 const bytes=await archivo(),lector=crearLector({XLSX,JSZip}),d=await lector.leerHoja(bytes,'Nov26');
 assert.equal(d.fidelidad.formato,true);assert.equal(d.fidelidad.texto_enriquecido,true);
 const celda=(r,c)=>d.celdas.find(x=>x.r===r&&x.c===c);
 assert.equal(celda(1,2).fechaISO,'2026-11-06');
 assert.equal(celda(25,5).valorNumero,50000);assert.equal(celda(25,5).valorCrudo,50000);
 assert.equal(celda(25,5).formula,'40000+10000');assert.equal(celda(26,5).errorExcel,'#VALUE!');
 assert.equal(celda(2,2).runs.map(r=>r.texto).join(''),celda(2,2).valor);
 const h=S.normalizarHoja(d,'Nov26');assert.equal(h.reservas[0].titular,'Ana Pérez');
 assert.equal(h.reservas[0].servicios[0].cortesia,true);assert.equal(h.reservas[0].estado_operativo,'hospedada');
 assert.equal(h.pagos[0].fecha_comprobante,'2026-11-05');assert.equal(h.pagos[0].monto,50000);
 assert.match(h.pagos[1].advertencias.join(' '),/F27.*#VALUE!/);
 const [lote]=await lector.leerHojas(bytes,['Nov26']);assert.deepEqual(lote.datos,d);
});

test('el fallo OOXML conserva valores pero declara lectura parcial y evita aparentar formato verificado',async()=>{
 const bytes=await archivo(),zipFalla={loadAsync:async()=>{throw Error('zip no disponible');}};
 const d=await crearLector({XLSX,JSZip:zipFalla}).leerHoja(bytes,'Nov26');
 assert.equal(d.fidelidad.formato,false);assert.equal(d.fidelidad.texto_enriquecido,false);
 const h=S.normalizarHoja(d,'Nov26');assert.equal(h.cobertura.geometria,false);
 assert.equal(h.reservas[0].titular,'Ana Pérez');
 assert.match(h.reservas[0].advertencias.join(' '),/formato original/);
 assert.ok(h.pagos.every(p=>p.advertencias.some(a=>/formato original/.test(a))));
});
