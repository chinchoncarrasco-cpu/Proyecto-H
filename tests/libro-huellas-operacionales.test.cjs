const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const D = require('../js/haiku-libro-diferencias-v1.js');
const styles = `<styleSheet><fonts><font><color rgb="FF000000"/></font><font><color rgb="FF0000FF"/></font></fonts><fills><fill/></fills><borders><border/></borders><cellStyleXfs><xf fontId="0"/></cellStyleXfs><cellXfs><xf fontId="0" xfId="0"/><xf fontId="1" xfId="0"/></cellXfs></styleSheet>`;
const xmlSheet = (index=0,style=0) => `<worksheet><sheetData><row r="1"><c r="A1" t="s" s="${style}"><v>${index}</v></c></row></sheetData></worksheet>`;
function files() {
    return {'xl/workbook.xml':'<workbook><workbookPr date1904="0"/><sheets><sheet name="Sep26" r:id="r1"/><sheet name="Mar24" r:id="r2"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml':xmlSheet(0), 'xl/worksheets/sheet2.xml':xmlSheet(1),
        'xl/sharedStrings.xml':'<sst><si><t>Ana Pérez</t></si><si><t>Histórico</t></si></sst>', 'xl/styles.xml':styles};
}
async function fingerprint(data, seleccion, tipo) {
    let opens=0,handler,message; const reads=[];
    const context=vm.createContext({TextEncoder,Uint8Array,crypto:webcrypto,addEventListener(_,fn){handler=fn;},postMessage(m){message=m;},
        importScripts(){throw Error('No debe cargar SheetJS ni semántica');},
        JSZip:{loadAsync:async()=>{opens++;return {file(name){return name in data?{async:async()=>{reads.push(name);return data[name];}}:null;}};}}});
    context.self=context;
    vm.runInContext(fs.readFileSync(require.resolve('../js/supabase-libro-reserva-worker-v1.js'),'utf8'),context);
    let result;
    if(tipo) {await handler({data:{id:1,tipo,nombresHojas:seleccion,buffer:new ArrayBuffer(0)}});assert.equal(message.ok,true);result=message.resultado;}
    else result=await context.huellasLibro(new ArrayBuffer(0),seleccion);
    assert.equal(opens,1);
    return {result:structuredClone(result),reads};
}
test('huellas: sin SheetJS/semántica, una apertura ZIP; cambio local no invalida hoja histórica',async()=>{
    const a=files(),b=files();b['xl/sharedStrings.xml']=b['xl/sharedStrings.xml'].replace('Ana Pérez','Ana María Pérez');
    const x=(await fingerprint(a)).result,y=(await fingerprint(b)).result;
    assert.notEqual(x.huellas.Sep26.sha256,y.huellas.Sep26.sha256);assert.equal(x.huellas.Mar24.sha256,y.huellas.Mar24.sha256);
});
test('sharedStrings añadidos o reindexados con idéntico contenido no invalidan hojas',async()=>{
    const a=files(),b=files();b['xl/sharedStrings.xml']='<sst><si><t>Nuevo</t></si><si><t>Histórico</t></si><si><t>Ana Pérez</t></si></sst>';
    b['xl/worksheets/sheet1.xml']=xmlSheet(2);
    assert.deepEqual((await fingerprint(a)).result.huellas,(await fingerprint(b)).result.huellas);
});
test('regresión real: celda vacía autocerrada anterior no deja índices SST sin resolver',async()=>{
    const a=files(),b=files();
    a['xl/worksheets/sheet1.xml']=xmlSheet(0).replace('<c r="A1"','<c r="Z1" s="0"/><c r="A1"');
    b['xl/worksheets/sheet1.xml']=xmlSheet(2).replace('<c r="A1"','<c r="Z1" s="1"/><c r="A1"');
    b['xl/sharedStrings.xml']='<sst><si><t>Nuevo</t></si><si><t>Histórico</t></si><si><t>Ana Pérez</t></si></sst>';
    assert.equal((await fingerprint(a)).result.huellas.Sep26.sha256,(await fingerprint(b)).result.huellas.Sep26.sha256);
});
test('metadata, orden XML, dimensiones y atributos cosméticos no alteran la huella',async()=>{
    const a=files(),b=files();
    a['xl/worksheets/sheet1.xml']='<worksheet><sheetData><row r="1"><c r="A1" t="s" s="0"><v>0</v></c><c r="B1"><v>1.00</v></c></row></sheetData></worksheet>';
    b['xl/worksheets/sheet1.xml']='<worksheet xmlns="urn:test"><dimension ref="A1:ZZ999"/><sheetViews><sheetView zoomScale="120"/></sheetViews><sheetData><row customHeight="1" ht="80" r="1"><c r="B1"><v>1</v></c><c s="0" t="s" r="A1"><v>0</v></c></row></sheetData><pageMargins left="2"/></worksheet>';
    assert.deepEqual((await fingerprint(a)).result.huellas.Sep26,(await fingerprint(b)).result.huellas.Sep26);
});
test('estilos equivalentes pese a flags, tamaño y nombre de fuente no invalidan colores operativos',async()=>{
    const a=files(),b=files();
    b['xl/styles.xml']=b['xl/styles.xml'].replace('<font><color rgb="FF000000"/>','<font><sz val="12"/><name val="Arial"/><color rgb="FF000000"/>').replace('<xf fontId="0" xfId="0"/>','<xf applyFont="1" xfId="0" fontId="0"/>');
    assert.equal((await fingerprint(a)).result.huellas.Sep26.sha256,(await fingerprint(b)).result.huellas.Sep26.sha256);
});
test('texto visible cambia componente valores; color de fondo cambia componente de colores',async()=>{
    const a=files(),b=files();b['xl/sharedStrings.xml']=b['xl/sharedStrings.xml'].replace('Ana Pérez','Ana Pérez // 3 adultos');
    let x=(await fingerprint(a)).result.huellas.Sep26,y=(await fingerprint(b)).result.huellas.Sep26;
    assert.notEqual(x.componentes.valores,y.componentes.valores);
    const c=files();c['xl/styles.xml']=c['xl/styles.xml'].replace('<fill/>','<fill><patternFill patternType="solid"><fgColor rgb="FFB4A7D6"/></patternFill></fill>');
    y=(await fingerprint(c)).result.huellas.Sep26;assert.notEqual(x.componentes.colores_semanticos,y.componentes.colores_semanticos);
});
test('segmentación rich text equivalente no cambia; nota roja o pendiente amarilla sí',async()=>{
    const a=files(),b=files();
    a['xl/sharedStrings.xml']='<sst><si><r><rPr><color rgb="FF000000"/></rPr><t>Ana Pérez</t></r></si></sst>';
    b['xl/sharedStrings.xml']='<sst><si><r><rPr><color rgb="FF000000"/></rPr><t>Ana </t></r><r><rPr><color rgb="FF000000"/></rPr><t>Pérez</t></r></si></sst>';
    const x=(await fingerprint(a)).result.huellas.Sep26;assert.equal(x.sha256,(await fingerprint(b)).result.huellas.Sep26.sha256);
    for(const color of ['FFFF0000','FFFFFF00']) {
        b['xl/sharedStrings.xml']=a['xl/sharedStrings.xml'].replace('FF000000',color);
        assert.notEqual(x.componentes.rich_text,(await fingerprint(b)).result.huellas.Sep26.componentes.rich_text);
    }
});
test('fórmulas, fechas/números y combinaciones relevantes se mantienen como candidatos',async()=>{
    const a=files();a['xl/worksheets/sheet1.xml']='<worksheet><sheetData><row r="1"><c r="A1"><f>SUM(B1:B2)</f><v>45000</v></c></row></sheetData></worksheet>';
    const x=(await fingerprint(a)).result.huellas.Sep26;
    for(const [find,replace,component] of [['SUM(B1:B2)','SUM(B1:B3)','formulas'],['45000','45001','valores'],['</worksheet>','<mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>','estructura']]) {
        const b={...a,'xl/worksheets/sheet1.xml':a['xl/worksheets/sheet1.xml'].replace(find,replace)};
        assert.notEqual(x.componentes[component],(await fingerprint(b)).result.huellas.Sep26.componentes[component]);
    }
});
test('estilo usado y rich text cambian huella aunque worksheet XML sea idéntico',async()=>{
    for(const modify of [a=>a['xl/styles.xml']=a['xl/styles.xml'].replace('FF000000','FFFFFFFF'),
        a=>a['xl/sharedStrings.xml']=a['xl/sharedStrings.xml'].replace('<t>Ana Pérez</t>','<r><rPr><color rgb="FF0000FF"/></rPr><t>Ana Pérez</t></r>')]) {
        const a=files(),b=files();modify(b);
        assert.notEqual((await fingerprint(a)).result.huellas.Sep26.sha256,(await fingerprint(b)).result.huellas.Sep26.sha256);
    }
});
test('estilo no utilizado no obliga a semántica; reindexado equivalente tampoco',async()=>{
    const a=files(),b=files();b['xl/styles.xml']=b['xl/styles.xml'].replace('FF0000FF','FFFF0000');
    assert.equal((await fingerprint(a)).result.huellas.Sep26.sha256,(await fingerprint(b)).result.huellas.Sep26.sha256);
    b['xl/styles.xml']=styles.replace('<cellXfs><xf fontId="0" xfId="0"/><xf fontId="1" xfId="0"/></cellXfs>', '<cellXfs><xf fontId="1" xfId="0"/><xf fontId="0" xfId="0"/></cellXfs>');
    b['xl/worksheets/sheet1.xml']=xmlSheet(0,1);b['xl/worksheets/sheet2.xml']=xmlSheet(1,1);
    assert.deepEqual((await fingerprint(a)).result.huellas,(await fingerprint(b)).result.huellas);
});
test('referencia corrupta genera error de huella, nunca igualdad silenciosa',async()=>{
    const a=files();a['xl/worksheets/sheet1.xml']=xmlSheet(99);
    const r=(await fingerprint(a)).result;assert.ok(r.huellas.Sep26.error);assert.ok(!r.huellas.Sep26.sha256);assert.ok(r.huellas.Mar24.sha256);
});
test('cambio del sistema de fechas modifica huella global',async()=>{
    const a=files(),b=files();b['xl/workbook.xml']=b['xl/workbook.xml'].replace('date1904="0"','date1904="1"');
    assert.notEqual((await fingerprint(a)).result.huellas.Sep26.sha256,(await fingerprint(b)).result.huellas.Sep26.sha256);
});
const catalog = nombres => ({version_huella:1,nombres,huellas:Object.fromEntries(nombres.map(n=>[n,{sha256:'igual'}]))});
test('rango por nombre, nunca posición; enero incluye diciembre anterior',()=>{
    assert.equal(D.mesHoja('Ago26'),'2026-08');assert.equal(D.mesHoja('sep 2026'),'2026-09');
    for(const n of ['REAGENDAR','REEMBOLSOS','Sep26 copia','Septiembre?','Jun99?']) assert.equal(D.mesHoja(n),null);
    const a=catalog(['Feb27','REEMBOLSOS','Nov26','Ene27','Dic26']);
    const d=D.planificarHojas(a,a,'2027-01-02');assert.equal(d.rango_operacional_desde,'2026-12');assert.equal(d.hojas_operacionales,3);
    assert.throws(()=>D.planificarHojas(a,a,'2026-02-30'),/Fecha/);
});
test('63 hojas: sólo Sep26 cambiada causa dos lecturas semánticas',async()=>{
    const historical=Array.from({length:55},(_,i)=>`${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][i%12]}${20+Math.floor(i/12)}`);
    const names=[...historical,'Ago26','Sep26','Oct26','Nov26','Dic26','Ene27','Feb27','Mar27'];
    const a=catalog(names),b=structuredClone(a);b.huellas.Sep26.sha256='cambió';const reads=[];
    const fingerprints=[];
    const libro={listo:async()=>{},estado:()=>({generacion:1}),consultarIndice:async()=>({nombres:names}),consultarHuellas:async(v,selected)=>{fingerprints.push(selected);return v==='anterior'?a:b;},
        consultarHoja:async(n,v,t)=>{reads.push([n,v,t]);return {hoja:n,cobertura:{geometria:true},fechas:['2026-09-01'],reservas:[]};}};
    const r=await D.compararUltimasVersiones({libro,fechaReferencia:'2026-09-09'});
    assert.deepEqual(reads,[['Sep26','anterior','semantica'],['Sep26','actual','semantica']]);
    assert.equal(r.diagnostico.hojas_totales,63);assert.equal(r.diagnostico.hojas_operacionales,8);
    assert.equal(r.diagnostico.hojas_semanticas_procesadas,1);assert.equal(r.diagnostico.lecturas_semanticas,2);
    assert.equal(r.diagnostico.rango_operacional_desde,'2026-08');assert.equal(r.estado,'sin_cambios');
    assert.equal(r.diagnostico.hojas_totales_libro,63);assert.equal(r.diagnostico.hojas_revisadas_actualizacion,8);
    assert.equal(r.diagnostico.hojas_historicas_omitidas,55);
    assert.ok(fingerprints.every(selected=>selected.length===8 && selected.every(n=>!historical.includes(n))));
});
test('sólo especiales vigiladas participan; históricas y desconocidas quedan fuera del informe',async()=>{
    const a=catalog(['Mar24','REEMBOLSOS','REAGENDAR','Mes raro','Sep26']),b=structuredClone(a);
    for(const n of a.nombres.filter(n=>n!=='Sep26'))b.huellas[n].sha256='cambio';
    const libro={listo:async()=>{},estado:()=>({generacion:1}),consultarIndice:async()=>({nombres:a.nombres}),consultarHuellas:async(v,nombres)=>{
        assert.ok(!nombres.includes('Mar24'));assert.ok(!nombres.includes('Mes raro'));return v==='anterior'?a:b;
    },consultarHoja:()=>{throw Error('No debe llamar');}};
    const r=await D.compararUltimasVersiones({libro,fechaReferencia:'2026-09-09'});
    assert.deepEqual(r.diagnostico.hojas_historicas_modificadas,[]);
    assert.deepEqual(r.diagnostico.hojas_especiales_modificadas,['REAGENDAR','REEMBOLSOS']);
    assert.equal(r.diagnostico.lecturas_semanticas,0);assert.equal(r.advertencias.length,2);assert.notEqual(r.estado,'sin_cambios');
});
test('worker de huellas no abre el XML histórico ni cuando está corrupto',async()=>{
    const data=files();data['xl/worksheets/sheet2.xml']='HISTÓRICO CORRUPTO';
    const {result,reads}=await fingerprint(data,['Sep26'],'huellas');
    assert.deepEqual(result.nombres,['Sep26']);assert.ok(result.huellas.Sep26.sha256);
    assert.ok(!reads.includes('xl/worksheets/sheet2.xml'));
});
test('índice para actualización sólo abre workbook.xml, sin SheetJS ni hojas',async()=>{
    const {result,reads}=await fingerprint(files(),undefined,'indice_nombres');
    assert.deepEqual(result.nombres,['Sep26','Mar24']);assert.deepEqual(reads,['xl/workbook.xml']);
});
test('selección vacía no lee hojas, estilos ni sharedStrings',async()=>{
    const {result,reads}=await fingerprint(files(),[]);assert.deepEqual(result.nombres,[]);
    assert.ok(!reads.some(p=>p.includes('worksheets/')||p.includes('sharedStrings')||p.includes('styles')));
});
test('hojas añadidas/eliminadas y huellas fallidas se diagnostican',()=>{
    const a=catalog(['Ago26','Sep26','Mar24']),b=catalog(['Sep26','Oct26']);b.huellas.Sep26={error:'falló'};
    const d=D.planificarHojas(a,b,'2026-09-09');assert.deepEqual(d.hojas_cambiadas_operacionales,['Ago26','Oct26']);
    assert.deepEqual(d.hojas_historicas_modificadas,['Mar24']);assert.deepEqual(d.hojas_huella_no_disponible,['Sep26']);
});
