const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../js/supabase-asistente-libro-auto-v1.js');
const E=require('../js/supabase-asistente-libro-actualizacion-v1.js');
const res=x=>({estado:'ok',nuevas:[],modificadas:[],ya_no_aparecen:[],ambiguas:[],advertencias:[],...x});
const row={titular:'Persona Prueba',cabana:8,fecha_checkin:'2026-09-11',fecha_checkout:'2026-09-13'};
const tick=()=>new Promise(r=>setImmediate(r));
function cargador({pc=true}={}) {
    const store=new Map(),eventos=[],timers=[];let fail=false,invalid=false;
    const el={replaceChildren(){},style:{}};
    const ctx=vm.createContext({ArrayBuffer,Uint8Array,URL,console:{error(){}},
        document:{readyState:'loading',addEventListener(){},getElementById:()=>el,currentScript:{src:'https://test.invalid/libro.js'}},
        matchMedia:()=>({matches:pc}),dispatchEvent:e=>eventos.push(e),CustomEvent:class {constructor(type,opt){this.type=type;this.detail=opt?.detail;}},
        setTimeout:f=>{timers.push(f);},clearTimeout(){},
        indexedDB:{open(){const req={};queueMicrotask(()=>{req.result={close(){},transaction(){
            const writes=[];const tx={objectStore:()=>({get(k){const read={result:store.get(k)};queueMicrotask(()=>{
                read.onsuccess?.();if(fail){tx.onabort();return;}for(const [key,value] of writes)store.set(key,value);tx.oncomplete();
            });return read;},put(v,k){writes.push([k,v]);},clear(){const read={};queueMicrotask(()=>{store.clear();tx.oncomplete();});return read;}})};return tx;
        }};req.onsuccess();});return req;}}});ctx.window=ctx;
    const hook=`
        mostrarVacio=mostrarCargando=actualizarEstado=actualizarPaginacion=poblarSelector=renderizarHoja=()=>{};
        leerEnSegundoPlano=async()=>({nombres:window.invalido?[]:['Sep26'],hojas:[]});
        window.cargarTest=(archivo,restaurado=false)=>(cargaLista=cargarArchivo(archivo,restaurado));
        window.restaurarTest=()=>cargaLista=restaurarLibro();
        window.quitarTest=quitarLibro;
    `;
    const source=fs.readFileSync(require.resolve('../js/supabase-libro-reserva-v1.js'),'utf8');
    vm.runInContext(source.replace(/\}\)\(\);\s*$/,hook+'})();'),ctx);
    return {store,eventos,ctx,fallar:()=>fail=true,invalidar:()=>ctx.invalido=true,
        cargar:(bytes,name='Libro.xlsx',restaurado=false)=>ctx.cargarTest({name,size:bytes.length,arrayBuffer:async()=>new Uint8Array(bytes).buffer},restaurado),
        flush:()=>{while(timers.length)timers.shift()();},avisos:()=>eventos.filter(e=>e.type==='haiku:libro-version-cargada')};
}
test('cargador real: primera carga no emite; segunda distinta emite después de finalizar y guardar',async()=>{
    const h=cargador();await h.cargar([1]);h.flush();assert.equal(h.avisos().length,0);
    await h.cargar([2]);assert.equal(h.avisos().length,0);h.flush();assert.equal(h.avisos().length,1);
    assert.equal(h.avisos()[0].detail.carga_manual,true);assert.equal(h.avisos()[0].detail.tenia_anterior,true);
    assert.equal(new Uint8Array(h.store.get('anterior').buffer)[0],1);
});
test('mismos bytes aunque cambie nombre no emiten ni rotan anterior',async()=>{
    const h=cargador();await h.cargar([1]);await h.cargar([2]);h.flush();const anterior=h.store.get('anterior');
    await h.cargar([2],'Otro nombre.xlsx');h.flush();assert.equal(h.avisos().length,1);assert.equal(h.store.get('anterior'),anterior);
});
test('F5/restauración real no emite',async()=>{
    const h=cargador();await h.cargar([1]);await h.cargar([2]);h.flush();await h.ctx.restaurarTest();h.flush();assert.equal(h.avisos().length,1);
});
test('archivo sin hojas, lectura fallida y extensión inválida no emiten',async()=>{
    const h=cargador();await h.cargar([1]);h.invalidar();await h.cargar([2]);
    await h.ctx.cargarTest({name:'Error.xlsx',arrayBuffer:async()=>{throw Error('Lectura');}});
    await h.cargar([3],'invalido.txt');h.flush();assert.equal(h.avisos().length,0);assert.equal(new Uint8Array(h.store.get('actual').buffer)[0],1);
});
test('fallo de persistencia no emite ni reemplaza las copias',async()=>{
    const h=cargador();await h.cargar([1]);h.fallar();await h.cargar([2]);h.flush();assert.equal(h.avisos().length,0);assert.equal(new Uint8Array(h.store.get('actual').buffer)[0],1);
});
test('quitar invalida el evento diferido; móvil sin anterior no emite',async()=>{
    const h=cargador();await h.cargar([1]);await h.cargar([2]);await h.ctx.quitarTest();h.flush();assert.equal(h.avisos().length,0);
    const m=cargador({pc:false});await m.cargar([1]);await m.cargar([2]);m.flush();assert.equal(m.avisos().length,0);
});
const evento=g=>({generacion:g,carga_manual:true,tenia_anterior:true});
test('evento duplicado: una comparación y un aviso final',async()=>{
    let calls=0;const mensajes=[];const c=A.crearControlador({generacion:()=>2,obtener:async()=>{calls++;return res();},mostrar:x=>mensajes.push(x),limpiar(){}});
    await c.cargar(evento(2));await c.cargar(evento(2));assert.equal(calls,1);assert.equal(mensajes.filter(x=>!x.pendiente).length,1);
});
test('generación nueva descarta B silenciosamente y procesa C sin paralelo',async()=>{
    let g=2,resolveB,calls=0;const mensajes=[];
    const cache=E.crearCache(()=>{calls++;return calls===1?new Promise(r=>resolveB=r):Promise.resolve(res({nuevas:[{actual:row}]}));},()=>g);
    const c=A.crearControlador({generacion:()=>g,obtener:()=>cache.obtener(),mostrar:x=>mensajes.push(x),limpiar(){}});
    const b=c.cargar(evento(g));await tick();g=3;cache.invalidar();c.invalidar();const siguiente=c.cargar(evento(g));await tick();assert.equal(calls,1);
    resolveB(res());await Promise.all([b,siguiente]);assert.equal(calls,2);assert.equal(mensajes.filter(x=>!x.pendiente).length,1);assert.match(mensajes.at(-1).texto,/Persona Prueba/);
});
test('sin cambios, nuevas, modificadas y contadores son resúmenes seguros',()=>{
    assert.match(A.resumir(res({estado:'sin_cambios'})).texto,/No detecté cambios operacionales/);
    assert.match(A.resumir(res({nuevas:[{actual:row}]})).texto,/Persona Prueba · CAB 8 · 11-09-2026 → 13-09-2026/);
    assert.match(A.resumir(res({modificadas:[{actual:row,cambios:[{campo:'fecha_checkout',antes:'2026-09-12',ahora:'2026-09-13'}]}]})).texto,/Check-out 12-09-2026 → 13-09-2026/);
    assert.match(A.resumir(res({nuevas:[{},{}],modificadas:[{},{}],ya_no_aparecen:[{}]})).texto,/5 cambios.*2 nuevas · 2 modificadas · 1 ya no aparece/);
});
test('ausencias, ambigüedad, parcial y advertencias nunca se mezclan',()=>{
    assert.doesNotMatch(A.resumir(res({ya_no_aparecen:[{}]})).texto,/cancelada/i);
    assert.match(A.resumir(res({ambiguas:[{}],advertencias:[{}]})).texto,/1 caso que requiere revisión.*1 advertencia de interpretación/);
    assert.match(A.resumir(res({estado:'parcial'})).texto,/una parte requiere revisión/);
});
test('resumen no expone contactos ni cambios financieros',()=>{
    const datos={...row,rut_documento:'12345678',correo:'secret@example.test',telefono:'999999999'};
    for(const r of [res({nuevas:[{actual:datos}]}),res({modificadas:[{actual:datos,cambios:[{campo:'correo',antes:'secret@example.test',ahora:'new@example.test'},{campo:'pagos_pendientes',antes:'$999',ahora:'$888'}]}]})])
        assert.doesNotMatch(A.resumir(r).texto,/12345678|example.test|999999999|\$999|\$888/);
});
function interfaz(comparar) {
    class El {
        constructor(){this.children=[];this.listeners={};this.value='';this.textContent='';}
        appendChild(x){x.parent=this;this.children.push(x);return x;}
        remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
        setAttribute(){}
        addEventListener(t,f){(this.listeners[t] ||= []).push(f);}
        dispatchEvent(e){for(const f of this.listeners[e.type] || [])f(e);}
        querySelector(){return null;}
    }
    const ids=Object.fromEntries(['texto','enviar','mensajes','adjuntos'].map(n=>['haiku-asistente-'+n,new El()]));
    const document={body:new El(),head:new El(),getElementById:id=>ids[id] || document.head.children.find(x=>x.id===id),createElement:()=>new El()};
    const listeners={};let calls=0,g=2,abierto=0;
    const prohibido=new Proxy({},{get(){throw Error('No se permite acceso a datos operacionales');}});
    const window={document,haikuSupabase:prohibido,indexedDB:prohibido,localStorage:prohibido,HAIKU_ASISTENTE:{abrir:()=>abierto++},
        Event:class {constructor(type){this.type=type;}},
        addEventListener(t,f){(listeners[t] ||= []).push(f);},
        HAIKU_LIBRO_RESERVA_V1:{estado:()=>({generacion:g})},
        HAIKU_LIBRO_DIFERENCIAS_V1:{compararUltimasVersiones(){calls++;return comparar();}}};
    const ctx={window};
    for(const file of ['supabase-asistente-libro-actualizacion-v1','supabase-asistente-libro-auto-v1'])vm.runInNewContext(fs.readFileSync(require.resolve('../js/'+file+'.js'),'utf8'),ctx);
    const emitir=(type,detail)=>{for(const f of listeners[type] || []) f({type,detail});};
    const manual=()=>{
        ids['haiku-asistente-texto'].value='Haku, informe de actualización';
        const e={type:'click',target:{closest:()=>ids['haiku-asistente-enviar']},preventDefault(){},stopImmediatePropagation(){this.stop=true;}};
        for(const f of listeners.click || []){f(e);if(e.stop)break;}
    };
    return {window,document,ids,emitir,manual,calls:()=>calls,abierto:()=>abierto,cambiar:()=>{g++;emitir('haiku:libro-cambio');},
        botones:()=>document.body.children.flatMap(x=>x.children).filter(x=>x.textContent==='Ver informe')};
}
test('módulo al cargar y evento genérico no comparan ni notifican; primera carga no inicia',async()=>{
    const h=interfaz(async()=>res());h.emitir('haiku:libro-cambio');h.emitir('haiku:libro-version-cargada',{...evento(2),tenia_anterior:false});
    await tick();assert.equal(h.calls(),0);assert.equal(h.document.body.children.length,0);
});
test('auto y consulta manual comparten la instancia real de caché; Ver informe no recalcula',async()=>{
    let resolver;const r=res({nuevas:[{actual:row}]});const h=interfaz(()=>new Promise(r=>resolver=r));
    h.emitir('haiku:libro-version-cargada',evento(2));h.manual();await tick();assert.equal(h.calls(),1);
    resolver(r);await tick();assert.equal(h.botones().length,1);
    h.botones()[0].dispatchEvent({type:'click'});assert.equal(h.abierto(),1);assert.equal(h.calls(),1);
    assert.match(h.ids['haiku-asistente-mensajes'].children.at(-1).innerHTML,/Persona Prueba/);
    h.manual();await tick();assert.equal(h.calls(),1);
});
test('aviso queda en Haku y sus acciones antiguas se desactivan al cambiar Libro',async()=>{
    const h=interfaz(async()=>res());h.emitir('haiku:libro-version-cargada',evento(2));await tick();
    const mensaje=h.ids['haiku-asistente-mensajes'].children[0];assert.match(mensaje.textContent,/Libro actualizado/);
    const boton=mensaje.children[0];h.cambiar();assert.equal(boton.disabled,true);assert.equal(h.document.body.children.length,0);
});
test('error obsoleto no se notifica; error vigente es breve y permite una carga posterior',async()=>{
    let rechazar,calls=0;const h=interfaz(()=>{calls++;return calls===1?new Promise((_,r)=>rechazar=r):Promise.resolve(res());});
    h.emitir('haiku:libro-version-cargada',evento(2));await tick();h.cambiar();rechazar(Error('cancelado antiguo'));await tick();assert.equal(h.ids['haiku-asistente-mensajes'].children.length,0);
    h.emitir('haiku:libro-version-cargada',evento(3));await tick();assert.equal(h.calls(),2);assert.match(h.ids['haiku-asistente-mensajes'].children[0].textContent,/No detecté cambios/);
    const fallo=interfaz(async()=>{throw Error('detalle técnico secreto');});fallo.emitir('haiku:libro-version-cargada',evento(2));await tick();
    assert.match(fallo.ids['haiku-asistente-mensajes'].children[0].textContent,/No pude completar/);assert.doesNotMatch(fallo.ids['haiku-asistente-mensajes'].children[0].textContent,/secreto/);
});
