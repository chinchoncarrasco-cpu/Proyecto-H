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
 vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-semantica-v1.js'),'utf8'),w);
 assert.equal(cell.runs[0].font.color.rgb,'FFFFFFFF');
 assert.equal(w.HAIKU_LIBRO_SEMANTICA.fuente(cell,[{}]).estado,'hospedada');
});
