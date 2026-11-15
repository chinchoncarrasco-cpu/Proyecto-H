const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const fs=require('node:fs'),vm=require('node:vm');
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
 assert.equal(h.reservas[0].estado_operativo,'no_determinado');
});

test('versiones XLSX consecutivas negro/blanco/azul con notas y separadores, compartido e inline',async()=>{
 const lector=crearLector({XLSX,JSZip}),D=require('../js/haiku-libro-diferencias-v1.js');
 const resultados=[];
 for(const compartido of [false,true]){
  let previo=null;
  for(const [rgb,estado] of [['000000','sin_checkin'],['FFFFFF','hospedada'],['0000FF','checked_out']]){
   const z=await JSZip.loadAsync(await archivo());
   const rich=`<r><rPr><color rgb="${rgb}"/></rPr><t>Ana Pérez // 2 ADL // 1 noche</t></r>`+
    '<r><rPr><color rgb="000000"/></rPr><t> // </t></r><r><rPr><color rgb="FF0000"/></rPr><t>Nota: llaves</t></r>'+
    '<r><rPr><color rgb="FFFF00"/></rPr><t> // Jacuzzi por pagar</t></r>';
   let xml=await z.file('xl/worksheets/sheet1.xml').async('text');
   xml=xml.replace(/<c r="C3"[^>]*>[\s\S]*?<\/c>/,compartido?'<c r="C3" t="s"><v>0</v></c>':`<c r="C3" t="inlineStr"><is>${rich}</is></c>`);
   z.file('xl/worksheets/sheet1.xml',xml);
   if(compartido){
    z.file('xl/sharedStrings.xml',`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si>${rich}</si></sst>`);
    z.file('[Content_Types].xml',(await z.file('[Content_Types].xml').async('text')).replace('</Types>',
     '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'));
    z.file('xl/_rels/workbook.xml.rels',(await z.file('xl/_rels/workbook.xml.rels').async('text')).replace('</Relationships>',
     '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'));
   }
   const bytes=await z.generateAsync({type:'nodebuffer'}),d=await lector.leerHoja(bytes,'Nov26'),h=S.normalizarHoja(d,'Nov26');
   const r=h.reservas[0];assert.equal(r.estado_operativo,estado);assert.ok(r.notas_importantes.length);assert.ok(r.pagos_pendientes.length);
   if(previo){const diff=D.comparar([previo],[h]);assert.ok(diff.modificadas.some(x=>x.cambios.some(c=>c.campo==='estado_operativo'&&c.ahora===estado)));}
   previo=h;resultados.push(estado);
  }
 }
 assert.equal(resultados.length,6);
});

test('un estilo inválido o una cobertura rich text incompleta no acredita estado aun con valores legibles',async()=>{
 const z=await JSZip.loadAsync(await archivo());
 z.file('xl/worksheets/sheet1.xml',(await z.file('xl/worksheets/sheet1.xml').async('text')).replace('<c r="C3"','<c s="999" r="C3"'));
 const d=await crearLector({XLSX,JSZip}).leerHoja(await z.generateAsync({type:'nodebuffer'}),'Nov26');
 assert.equal(d.celdas.find(c=>c.r===2&&c.c===2).formatoVerificado,false);
 const r=S.normalizarHoja(d,'Nov26').reservas[0];assert.equal(r.estado_operativo,'no_determinado');
 assert.match(r.notas_interpretacion.join(' '),/formato original/);
});

test('formato condicional de una reserva no se presenta como color operativo verificado',async()=>{
 const z=await JSZip.loadAsync(await archivo());
 z.file('xl/worksheets/sheet1.xml',(await z.file('xl/worksheets/sheet1.xml').async('text')).replace('</worksheet>',
  '<conditionalFormatting sqref="C3:E3"><cfRule type="expression" priority="1"><formula>1</formula></cfRule></conditionalFormatting></worksheet>'));
 const d=await crearLector({XLSX,JSZip}).leerHoja(await z.generateAsync({type:'nodebuffer'}),'Nov26');
 const r=S.normalizarHoja(d,'Nov26').reservas[0];assert.equal(r.estado_operativo,'no_determinado');
 assert.match(r.notas_interpretacion.join(' '),/formato condicional/);
});

test('el índice de titulares encuentra variantes en cadenas compartidas, directas e inline',async()=>{
 const entorno={XLSX,JSZip,addEventListener:(_,fn)=>{entorno.procesar=fn;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/supabase-libro-reserva-worker-v1.js'),'utf8'),
  {self:entorno,Uint8Array,ArrayBuffer});
 const buscar=(buffer,nombreHoja)=>new Promise(resolve=>{
  entorno.postMessage=resolve;
  entorno.procesar({data:{id:1,tipo:'buscar',buffer,nombreHoja}});
 });
 const w=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Vera Marta Solís']]),'Nov26');
 for(const bookSST of [true,false]){
  const bytes=XLSX.write(w,{type:'buffer',bookType:'xlsx',bookSST});
  const literal=await buscar(bytes,'marta solis vera');
  assert.equal(literal.ok,true,literal.error);assert.deepEqual([...literal.resultado.hojas],[]);
  const alternativas=await buscar(bytes,['marta solis vera','marta','solis','vera']);
  assert.equal(alternativas.ok,true,alternativas.error);assert.deepEqual([...alternativas.resultado.hojas],['Nov26']);
 }
 const inline=await buscar(await archivo(),['perez ana','perez','ana']);
 assert.equal(inline.ok,true,inline.error);assert.deepEqual([...inline.resultado.hojas],['Nov26']);
});
