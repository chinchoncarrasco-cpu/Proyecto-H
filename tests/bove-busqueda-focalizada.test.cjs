const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const B=require('../js/supabase-asistente-bove-consultas-v1.js');
async function buscar(textos,numero='16968'){
 const files={'xl/workbook.xml':'<workbook><sheets>'+textos.map((_,i)=>`<sheet name="Hoja${i}" r:id="r${i}"/>`).join('')+'</sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships>'+textos.map((_,i)=>`<Relationship Id="r${i}" Target="worksheets/s${i}.xml"/>`).join('')+'</Relationships>',
 'xl/sharedStrings.xml':'<sst>'+textos.map(t=>`<si><t>${t}</t></si>`).join('')+'</sst>'};
 textos.forEach((_,i)=>files[`xl/worksheets/s${i}.xml`]=`<worksheet><c r="Z1" s="0"/><c r="L27" t="s"><v>${i}</v></c></worksheet>`);
 files['xl/workbook.xml']=files['xl/workbook.xml'].replace('</sheets>','<sheet name="Inline" r:id="inline"/></sheets>');
 files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels'].replace('</Relationships>','<Relationship Id="inline" Target="worksheets/inline.xml"/></Relationships>');
 files['xl/worksheets/inline.xml']='<worksheet><c r="A1" t="inlineStr"><is><r><t>BOVE: </t></r><r><t>16.968</t></r></is></c></worksheet>';
 let handler,result,opens=0;const reads=[];
 const c={addEventListener(_,f){handler=f;},postMessage(m){result=m;},importScripts(){throw Error('No debe abrir SheetJS ni semántica');},JSZip:{loadAsync:async()=>{opens++;return {file:p=>p in files?{async:async()=>{reads.push(p);return files[p];}}:null};}}};c.self=c;vm.createContext(c);
 vm.runInContext(fs.readFileSync('js/supabase-libro-reserva-worker-v1.js','utf8'),c);
 await handler({data:{id:1,tipo:'buscar_bove',nombreHoja:numero,buffer:new ArrayBuffer(0)}});
 assert.equal(result.ok,true);assert.equal(opens,1);assert.ok(!reads.includes('xl/styles.xml'));
 return Array.from(result.resultado.hojas);
}
test('worker exacto: variantes, inline/rich text, sin BOVTAR ni subnúmeros',async()=>{
 assert.deepEqual(await buscar(['BOVE 16968','BOVE: 16.968','BOVE: 16,968','BOVTAR 16968','BOVE: 116968','BOVE: 169680','PEND BOVE']),['Hoja0','Hoja1','Hoja2','Inline']);
});
test('worker inexistente no produce candidatos',async()=>assert.deepEqual(await buscar(['BOVE: 16968'],'99999'),[]));
test('63 hojas: sólo candidato exacto pasa a semántica; caché evita repetir búsqueda',async()=>{
 const leidas=[],busquedas=[];
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>Array.from({length:63},(_,i)=>'Hoja'+i),buscarHojas(){throw Error('Prohibida búsqueda genérica');},buscarHojasBove:async n=>{busquedas.push(n);return {hojas:['Sep26']};},consultarHoja:async h=>{leidas.push(h);return {evidencias_bove:[{numero:'16968',estado:'registrado',origen:{hoja:h,celda:'L27'}}]};}};
 for(let i=0;i<2;i++){const r=await B.consultar('Haku, busca el BOVE 16968 en el Libro por favor',{libro});assert.equal(r.libro[0].origen.celda,'L27');}
 assert.deepEqual(leidas,['Sep26']);assert.deepEqual(busquedas,['16968']);
});
test('lector antiguo no recurre a barrido semántico global',async()=>{
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Sep26'],buscarHojas(){throw Error('No debe usarse');}};
 const r=await B.consultar('busca BOVE 16968 en el Libro',{libro});assert.equal(r.incompleto,true);assert.match(r.avisos[0],/búsqueda BOVE focalizada/);
});
test('timeout incluye selección y no agenda semántica tras vencer',async()=>{
 let terminar,semanticas=0;const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>[],buscarHojasBove:()=>new Promise(r=>terminar=r),consultarHoja:async()=>{semanticas++;return {evidencias_bove:[]};}};
 await assert.rejects(B.consultar('busca BOVE 16968 en el Libro',{libro,timeoutMs:10}),/tiempo de espera/);
 terminar({hojas:['Sep26']});await new Promise(r=>setImmediate(r));assert.equal(semanticas,0);
});
test('error de búsqueda no significa BOVE inexistente',async()=>{
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>[],buscarHojasBove:async()=>{throw Error('Fallo de lectura');}};
 const r=await B.consultar('busca BOVE 16968 en el Libro',{libro});assert.equal(r.incompleto,true);assert.match(B.renderizar(r),/Lectura no disponible/);
});
