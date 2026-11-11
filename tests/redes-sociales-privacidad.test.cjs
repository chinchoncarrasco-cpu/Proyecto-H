const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('./fixtures/dialogos.cjs').vm;
const {parseHTML}=require('linkedom');
const C=require('../js/haiku-redes-core-v1');
const source=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const tick=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
async function fixture(){
 const {window}=parseHTML('<html><body><section id="seccion-calendario"><div id="haiku-calendario-modo"><button data-calendar-mode="redes">Redes</button></div><div id="haiku-redes"></div></section></body></html>');
 const document=window.document,callbacks=[],timers=new Map();let timerId=0,shareResolve=null;
 const storage=()=>{const data=new Map();return{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}};
 const createElement=document.createElement.bind(document);document.createElement=(name)=>{const el=createElement(name);if(name==='dialog'){el.open=false;el.showModal=()=>{el.open=true;el.setAttribute('open','');};el.close=()=>{el.open=false;el.removeAttribute('open');};}return el;};
 window.haikuSesion={auth:{id:'staff'}};window.HaikuRedesCore=C;window.confirm=()=>true;
 window.haikuSupabase={auth:{onAuthStateChange:cb=>callbacks.push(cb)},rpc:async(name,args)=>({data:name==='haiku_bloqueo_visual_estado'?{configurado:true}:{ok:args?.p_codigo==='1234'}})};
 window.HaikuRedesApi={create:()=>({load:async()=>({posts:[],assets:[]}),getShare:()=>shareResolve?new Promise(r=>shareResolve(r)):Promise.resolve(null)})};
 const context=vm.createContext({window,document,console:{info(){},error(){}},Date,Intl,URL,URLSearchParams,location:{href:'https://example.test/panel.html'},navigator:{},CustomEvent:window.CustomEvent,MutationObserver:window.MutationObserver,localStorage:storage(),sessionStorage:storage(),queueMicrotask,requestAnimationFrame:fn=>fn(),setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),fetch:async()=>({ok:true,json:async()=>({posts:[],months:[],campaigns:[],events:[],sources:[]})})});
 vm.runInContext(source('js/supabase-bloqueo-privacidad-v1.js'),context);
 vm.runInContext(source('js/haiku-redes-ui-v1.js'),context);
 for(const [id,t] of timers)if(t.ms===0){timers.delete(id);t.fn();}await tick();
 const click=selector=>{const el=document.querySelector(selector);assert.ok(el,selector);el.click();};
 click('[data-calendar-mode="redes"]');await tick();
 const dialog=document.querySelector('.hr-dialog'),overlay=document.querySelector('.haiku-privacidad-overlay');
 async function unlock(){document.querySelector('#haiku-privacidad-pin').value='1234';document.querySelector('#haiku-privacidad-form-pin').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();}
 return{window,document,dialog,overlay,click,unlock,timers,callbacks,delayShare(fn){shareResolve=fn;}};
}
test('Compartir cierra con X; perder foco suspende la ventana y volver antes del minuto la restaura',async()=>{
 const f=await fixture();f.click('[data-action="share"]');await tick();assert.ok(f.dialog.open);
 f.click('[data-close]');assert.equal(f.dialog.open,false);
 f.click('[data-action="share"]');await tick();
 f.window.dispatchEvent(new f.window.Event('blur'));assert.equal(f.dialog.open,false);assert.equal(f.overlay.hidden,false);assert.equal(f.dialog.hasAttribute('inert'),true);
 f.window.dispatchEvent(new f.window.Event('focus'));assert.ok(f.dialog.open);assert.equal(f.overlay.hidden,true);assert.equal(f.dialog.hasAttribute('inert'),false);
 f.click('[data-close]');assert.equal(f.dialog.open,false);
});
test('tras el minuto el PIN queda accesible; PIN erróneo no restaura el modal y el correcto sí',async()=>{
 const f=await fixture();f.click('[data-action="share"]');await tick();f.window.dispatchEvent(new f.window.Event('blur'));
 const timeout=[...f.timers.values()].find(t=>t.ms===60030);assert.ok(timeout);timeout.fn();
 assert.equal(f.window.HAIKU_PRIVACIDAD.estado().modo,'pin');assert.equal(f.dialog.open,false);assert.equal(f.overlay.hasAttribute('inert'),false);assert.equal(f.document.querySelector('#haiku-privacidad-form-pin').hidden,false);
 f.document.querySelector('#haiku-privacidad-pin').value='9999';f.document.querySelector('#haiku-privacidad-form-pin').dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(f.dialog.open,false);assert.equal(f.overlay.hidden,false);
 await f.unlock();assert.equal(f.overlay.hidden,true);assert.ok(f.dialog.open);f.click('[data-close]');assert.equal(f.dialog.open,false);
});
test('ficha conserva texto sin guardar y una respuesta tardía no abre Compartir sobre el bloqueo',async()=>{
 const f=await fixture();f.click('[data-action="new"]');const field=f.dialog.querySelector('[name="title"]');field.value='Borrador pendiente';field.dispatchEvent(new f.window.Event('input',{bubbles:true}));
 f.window.HAIKU_PRIVACIDAD.bloquearAhora();assert.equal(f.dialog.open,false);await f.unlock();assert.equal(f.dialog.querySelector('[name="title"]').value,'Borrador pendiente');assert.ok(f.dialog.open);f.click('[data-close]');
 let resolve;f.delayShare(r=>{resolve=r;});f.click('[data-action="share"]');f.window.HAIKU_PRIVACIDAD.bloquearAhora();resolve(null);await tick();assert.equal(f.dialog.open,false);await f.unlock();assert.ok(f.dialog.open);
});
test('cerrar sesión con un diálogo suspendido no lo vuelve a abrir',async()=>{
 const f=await fixture();f.click('[data-action="share"]');await tick();f.window.HAIKU_PRIVACIDAD.bloquearAhora();
 f.window.haikuSesion=null;f.callbacks.forEach(cb=>cb('SIGNED_OUT',null));await tick();assert.equal(f.dialog.open,false);assert.equal(f.dialog.textContent,'');
});
