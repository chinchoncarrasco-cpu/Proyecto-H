const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker() {
 const context=vm.createContext({console,addEventListener(){},postMessage(){},importScripts(){}});
 context.self=context;
 vm.runInContext(fs.readFileSync(require.resolve('../js/supabase-libro-reserva-worker-v1.js'),'utf8'),context);
 return context;
}

const theme=`<a:theme><a:themeElements><a:clrScheme>
 <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
 <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
 <a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:dk2><a:srgbClr val="1F497D"/></a:dk2>
 <a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2>
 <a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>
 <a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>
 <a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink>
 </a:clrScheme></a:themeElements></a:theme>`;

test('worker resolves Excel theme white and blue before operational state interpretation',()=>{
 const w=worker(),themes=vm.runInContext(`coloresTemaXml(${JSON.stringify(theme)})`,w);
 vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-semantica-v1.js'),'utf8'),w);
 const styles='<styleSheet><fonts><font><color theme="0"/></font><font><color theme="10"/></font></fonts><fills><fill/></fills><borders><border/></borders><cellXfs><xf fontId="0"/><xf fontId="1"/></cellXfs></styleSheet>';
 const parsed=structuredClone(w.parsearEstilosXml(styles,themes));
 assert.equal(parsed[0].font.color.rgb,'FFFFFFFF');
 assert.equal(parsed[1].font.color.rgb,'FF0000FF');
 assert.equal(w.HAIKU_LIBRO_SEMANTICA.fuente({valor:'Marco Iturrieta Rojas',estiloId:0},parsed).estado,'hospedada');
 assert.equal(w.HAIKU_LIBRO_SEMANTICA.fuente({valor:'Marco Iturrieta Rojas',estiloId:1},parsed).estado,'checked_out');
});

test('worker resolves theme colors inside rich text guest details',()=>{
 const w=worker(),themes=vm.runInContext(`coloresTemaXml(${JSON.stringify(theme)})`,w);
 const runs=structuredClone(w.parsearTextoEnriquecido('<r><rPr><color theme="0"/></rPr><t>Marco Iturrieta Rojas</t></r>',themes));
 assert.equal(runs[0].font.color.rgb,'FFFFFFFF');
});

test('worker resolves white theme in inline rich text before classifying a hosted stay',()=>{
 const w=worker();
 const sheet='<worksheet><sheetData><row r="3"><c r="C3" s="0" t="inlineStr"><is>'+
  '<r><rPr><color theme="0"/></rPr><t>Karina Cruz // 3 noches</t></r>'+
  '<r><rPr><color rgb="FFFF0000"/></rPr><t> // NO MOVER</t></r>'+
  '</is></c></row></sheetData></worksheet>';
 const cell=structuredClone(vm.runInContext(`(()=>[...parsearCeldasXml(${JSON.stringify(sheet)}, [], coloresTemaXml(${JSON.stringify(theme)})).values()][0])()`,w));
 cell.valor=cell.runs.map(r=>r.texto).join('');
 vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-semantica-v1.js'),'utf8'),w);
 assert.equal(cell.runs[0].font.color.rgb,'FFFFFFFF');
 assert.equal(w.HAIKU_LIBRO_SEMANTICA.fuente(cell,[{}]).estado,'hospedada');
});

test('herencia de cellStyleXfs y applyFont conserva blanco y azul exactos',()=>{
 const w=worker();vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-semantica-v1.js'),'utf8'),w);
 const xml='<styleSheet><fonts><font><color rgb="000000"/></font><font><color theme="0"/></font><font><color theme="10"/></font></fonts>'+
  '<fills><fill/></fills><cellStyleXfs><xf fontId="1" fillId="0"/><xf fontId="2" fillId="0"/></cellStyleXfs>'+
  '<cellXfs><xf xfId="0"/><xf xfId="1" fontId="0" applyFont="0"/></cellXfs></styleSheet>';
 const estilos=w.parsearEstilosXml(xml,w.coloresTemaXml(theme));
 for(const [estiloId,estado] of [[0,'hospedada'],[1,'checked_out']])
  assert.equal(w.HAIKU_LIBRO_SEMANTICA.fuente({valor:'Ana Pérez',estiloId},estilos).estado,estado);
});

test('indexados estándar, personalizados y sistema se resuelven sin aproximar',()=>{
 const w=worker();vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-semantica-v1.js'),'utf8'),w);
 const styles=(indices,paleta='')=>'<styleSheet><fonts>'+indices.map(i=>`<font><color indexed="${i}"/></font>`).join('')+
  '</fonts><fills><fill/></fills><cellXfs>'+indices.map((_,i)=>`<xf fontId="${i}"/>`).join('')+'</cellXfs>'+paleta+'</styleSheet>';
 const indices=[0,1,4,39,64,65],esperados=['sin_checkin','hospedada','checked_out','checked_out','no_determinado','no_determinado'];
 const parsed=w.parsearEstilosXml(styles(indices));
 indices.forEach((_,i)=>assert.equal(w.HAIKU_LIBRO_SEMANTICA.fuente({valor:'Ana Pérez',estiloId:i},parsed).estado,esperados[i]));
 const custom=w.parsearEstilosXml(styles([0,1],'<colors><indexedColors><rgbColor rgb="FF0000FF"/><rgbColor rgb="FFF3F3F3"/></indexedColors></colors>'));
 assert.equal(w.HAIKU_LIBRO_SEMANTICA.fuente({valor:'Ana Pérez',estiloId:0},custom).estado,'checked_out');
 assert.equal(w.HAIKU_LIBRO_SEMANTICA.fuente({valor:'Ana Pérez',estiloId:1},custom).estado,'no_determinado');
});

test('fragmento sin color hereda estilo y tema teñido/desconocido no se aproxima',()=>{
 const w=worker();vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-semantica-v1.js'),'utf8'),w);
 const estilos=w.parsearEstilosXml('<styleSheet><fonts><font><color theme="0"/></font></fonts><fills><fill/></fills><cellXfs><xf/></cellXfs></styleSheet>',w.coloresTemaXml(theme));
 const f=w.HAIKU_LIBRO_SEMANTICA.fuente;
 assert.equal(f({valor:'Ana Pérez',estiloId:0,runs:[{texto:'Ana ',font:{bold:true}},{texto:'Pérez'}]},estilos).estado,'hospedada');
 for(const color of [{theme:0,tint:0.01},{theme:99},{theme:1}]) {
  const xml=`<r><rPr><color ${Object.entries(color).map(([k,v])=>`${k}="${v}"`).join(' ')}/></rPr><t>Ana Pérez</t></r>`;
  const runs=w.parsearTextoEnriquecido(xml,w.coloresTemaXml(theme));
  assert.equal(f({valor:'Ana Pérez',runs},[]).estado,color.theme===1?'sin_checkin':'no_determinado');
 }
});

test('atributos de color malformados no se convierten en tema cero o tinte cero',()=>{
 const w=worker();vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-semantica-v1.js'),'utf8'),w);
 for(const attrs of ['theme=""','indexed=""','rgb="FFFFFF" tint="error"','rgb="FFFFFF" auto="quizás"']){
  const runs=w.parsearTextoEnriquecido(`<r><rPr><color ${attrs}/></rPr><t>Ana Pérez</t></r>`,w.coloresTemaXml(theme));
  assert.equal(w.HAIKU_LIBRO_SEMANTICA.fuente({valor:'Ana Pérez',runs}).estado,'no_determinado',attrs);
 }
});
