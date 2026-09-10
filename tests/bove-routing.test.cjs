const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../js/haiku-libro-semantica-v1.js');
const bove=fs.readFileSync('js/supabase-asistente-bove-consultas-v1.js','utf8');
const general=fs.readFileSync('js/haiku-libro-consultas-v1.js','utf8');

function entorno(conBove=true,timeoutCorto=false){
 const listeners=[],nodos=new Map();
 const elemento=()=>({dataset:{},children:[],value:'',textContent:'',innerHTML:'',append(...xs){this.children.push(...xs);},appendChild(x){this.append(x);},dispatchEvent(){},scrollIntoView(){},querySelector(){return null;}});
 const doc={readyState:'loading',head:elemento(),createElement:elemento,getElementById:id=>nodos.get(id),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){throw Error('El routing no debe esperar al DOM');}};
 const w={document:doc,HAIKU_LIBRO_SEMANTICA:S,__generalCalls:0,__boveCalls:[],addEventListener:(tipo,fn,capture)=>listeners.push({tipo,fn,capture}),Event:class{},
  HAIKU_LIBRO_RESERVA_V1:{listo:async()=>{},estado:()=>({generacion:1,cargado:true,nombre:'fixture'}),listarHojas:()=>['Sep26'],buscarHojasBove:async()=>({hojas:['Sep26']}),buscarHojas:async()=>({hojas:['Sep26']}),consultarHoja:async()=>({reservas:[],pagos:[],aseos:[],espacios:[],anotaciones:[],advertencias:[],evidencias_bove:[{numero:'16968',estado:'registrado',origen:{hoja:'Sep26',celda:'L27'}}]})},
  haikuSupabase:{from(){const q={select(){return q;},order(){return q;},eq(){return q;},or(){return q;},range:async()=>({data:[]})};return q;}}};
 const contexto=vm.createContext({window:w,document:doc,Event:w.Event,Intl,console,setTimeout:timeoutCorto?(fn,ms)=>setTimeout(fn,ms===20000?10:ms):setTimeout,clearTimeout});
 // Instrumentación sólo de observación: ejecuta los dos handlers reales.
 if(conBove)vm.runInContext(bove.replace('const q=interpretar(texto);','const q=interpretar(texto);root.__boveCalls.push(q);'),contexto);
 vm.runInContext(general.replace(/(async function consultar\(texto,[^\n]+\{)/,'$1 root.__generalCalls++;'),contexto);
 // La UI aparece DESPUÉS de registrar ambos módulos, como el script async real.
 const campo=elemento(),mensajes=elemento(),boton=elemento();
 nodos.set('haiku-asistente-texto',campo);nodos.set('haiku-asistente-mensajes',mensajes);nodos.set('haiku-asistente-enviar',boton);
 campo.id='haiku-asistente-texto';boton.closest=selector=>selector==='#haiku-asistente-enviar'?boton:null;
 return {w,mensajes,async enviar(texto,tipo='click'){
  campo.value=texto;const event={type:tipo,target:tipo==='click'?boton:campo,key:'Enter',ctrlKey:true,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  for(const l of listeners.filter(l=>l.tipo===tipo)){assert.equal(l.capture,true);l.fn(event);if(event.stopped)break;}
  await new Promise(resolve=>setImmediate(resolve));return event;
 }};
}

for(const tipo of ['click','keydown'])for(const [texto,fuente,accion] of [
 ['Haku, busca el BOVE 16968 en el Libro por favor','libro','buscar'],
 ['busca BOVE 16968','ambas','buscar'],
 ['Haku, busca en Proyecto H el BOVE 16968','proyecto_h','buscar'],
 ['Haku, qué BOVE está pendiente completar para hoy','ambas','pendientes'],
 ['Haku, qué BOVE existe en Proyecto H que no esté en el Libro','ambas','comparar'],
 ['Haku, qué BOVE existe en el Libro que no esté en Proyecto H','ambas','comparar'],
 ['Haku, cuál es el último BOVE registrado','ambas','ultimo']
])test(`routing tardío ${tipo}: ${texto}`,async()=>{
 const e=entorno(),event=await e.enviar(texto,tipo);
 assert.equal(event.prevented,true);assert.equal(e.w.__generalCalls,0);assert.equal(e.w.__boveCalls.length,1);
 assert.equal(e.w.__boveCalls[0].fuente,fuente);assert.equal(e.w.__boveCalls[0].accion,accion);
 const respuestas=e.mensajes.children.filter(x=>x.className.endsWith('--asistente'));assert.equal(respuestas.length,1);
 assert.ok(respuestas[0].innerHTML.includes('haku-bove-consulta'));
 if(fuente==='libro')assert.match(respuestas[0].innerHTML,/Sep26.*L27/);
});

for(const texto of ['Libro: CAB 6 el 05-09-26','Libro: CAB 5 el 03-09-26','Libro: pendientes BOVE'])test(`flujo general conserva respuesta: ${texto}`,async()=>{
 const nuevo=entorno(),anterior=entorno(false);await nuevo.enviar(texto);await anterior.enviar(texto);
 assert.equal(nuevo.w.__boveCalls.length,0);assert.equal(nuevo.w.__generalCalls,1);
 assert.deepEqual(nuevo.mensajes.children.map(x=>x.textContent),anterior.mensajes.children.map(x=>x.textContent));
});
test('UI termina la espera y libera el envío después del timeout',async()=>{
 const e=entorno(true,true);e.w.HAIKU_LIBRO_RESERVA_V1.buscarHojasBove=()=>new Promise(()=>{});
 await e.enviar('busca BOVE 16968 en el Libro');await new Promise(r=>setTimeout(r,30));
 const respuesta=e.mensajes.children.find(x=>x.className.endsWith('--asistente'));
 assert.match(respuesta.textContent,/superó el tiempo de espera/);assert.equal(e.w.__generalCalls,0);
 await e.enviar('busca en Proyecto H el BOVE 16968');
 assert.equal(e.mensajes.children.filter(x=>x.className.endsWith('--asistente')).length,2);
});
