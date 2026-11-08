const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../js/supabase-asistente-libro-auto-v1.js');
const E=require('../js/supabase-asistente-libro-actualizacion-v1.js');
const res=x=>({estado:'ok',nuevas:[],modificadas:[],ya_no_aparecen:[],ambiguas:[],advertencias:[],...x});
const row={titular:'Persona Prueba',cabana:8,fecha_checkin:'2026-09-11',fecha_checkout:'2026-09-13'};
const tick=()=>new Promise(r=>setImmediate(r));
function cargador({pc=true}={}) {
    const store=new Map(),eventos=[],timers=[];let fail=false,invalid=false;
    const el={replaceChildren(){},style:{}};
    const ctx=vm.createContext({ArrayBuffer,Uint8Array,URL,structuredClone,console:{error(){}},
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
        window.cargarTest=(archivo,restaurado=false,origen='manual',avisar=true)=>(cargaLista=cargarArchivo(archivo,restaurado,origen,avisar));
        window.restaurarTest=()=>cargaLista=restaurarLibro();
        window.quitarTest=quitarLibro;
        window.lecturaTest=crearLectura;
    `;
    const source=fs.readFileSync(require.resolve('../js/supabase-libro-reserva-v1.js'),'utf8');
    vm.runInContext(source.replace(/\}\)\(\);\s*$/,hook+'})();'),ctx);
    return {store,eventos,ctx,fallar:()=>fail=true,invalidar:()=>ctx.invalido=true,
        cargar:(bytes,name='Libro.xlsx',restaurado=false)=>ctx.cargarTest({name,size:bytes.length,arrayBuffer:async()=>new Uint8Array(bytes).buffer},restaurado),
        cargarGoogle:(bytes,name='Libro.xlsx')=>ctx.cargarTest({name,size:bytes.length,arrayBuffer:async()=>new Uint8Array(bytes).buffer},false,'google'),
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
test('una versión nueva recibida desde Google emite una actualización automática',async()=>{
    const h=cargador();await h.cargar([1]);await h.cargarGoogle([2]);h.flush();
    assert.equal(h.avisos().length,1);assert.equal(h.avisos()[0].detail.carga_manual,false);
    assert.equal(h.avisos()[0].detail.carga_automatica,true);assert.equal(h.avisos()[0].detail.origen,'google');
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
test('lectura aislada mantiene actual/anterior y hojas en cola durante dos actualizaciones',async()=>{
    const h=cargador();await h.cargar([1]);await h.cargar([2]);
    const workers=[];
    h.ctx.Worker=class {constructor(){workers.push(this);}postMessage(data){this.data=data;}terminate(){this.terminado=true;}};
    const lectura=await h.ctx.lecturaTest(),g=lectura.estado().generacion;
    const primera=lectura.consultarHoja('Sep26'),segunda=lectura.consultarHoja('Oct26');await tick();
    assert.equal(new Uint8Array(workers[0].data.buffer)[0],2);
    await h.cargarGoogle([3]);await h.cargarGoogle([4]);
    assert.equal(workers[0].terminado,undefined);
    workers[0].onmessage({data:{ok:true,resultado:{hoja:'Sep26',valor:2}}});
    assert.equal((await primera).valor,2);await tick();
    assert.equal(new Uint8Array(workers[1].data.buffer)[0],2);
    workers[1].onmessage({data:{ok:true,resultado:{hoja:'Oct26',valor:2}}});await segunda;
    const anterior=lectura.consultarIndice('anterior');await tick();
    assert.equal(new Uint8Array(workers[2].data.buffer)[0],1);
    workers[2].onmessage({data:{ok:true,resultado:{nombres:['Sep26']}}});await anterior;
    assert.equal(lectura.estado().generacion,g);
    const actual=await h.ctx.lecturaTest();assert.notEqual(actual.estado().generacion,g);
    const fresca=actual.consultarHoja('Sep26');await tick();
    assert.equal(new Uint8Array(workers[3].data.buffer)[0],4);
    workers[3].onmessage({data:{ok:true,resultado:{valor:4}}});assert.equal((await fresca).valor,4);
});
test('consulta del lector Haku finaliza con su copia y escrituras antiguas siguen bloqueadas',async()=>{
    const ctx={HAIKU_LIBRO_SEMANTICA:require('../js/haiku-libro-semantica-v1.js')};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8'),ctx);
    const C=ctx.HAIKU_LIBRO_CONSULTAS;
    const h=cargador();await h.cargar([1]);
    let worker;h.ctx.Worker=class {constructor(){worker=this;}postMessage(data){this.data=data;}terminate(){}};
    const vivo={crearLectura:()=>h.ctx.lecturaTest()};
    const consulta=C.consultar('Libro Sep26',vivo);
    await tick();await h.cargarGoogle([2]);
    worker.onmessage({data:{ok:true,resultado:{reservas:[],aseos:[],espacios:[],anotaciones:[],cobertura:{geometria:true}}}});
    const resultado=await consulta;assert.equal(resultado.generacion,1);
    ctx.HAIKU_LIBRO_RESERVA_V1={estado:()=>({generacion:2})};
    await assert.rejects(C.prepararIncorporacion(resultado),/Libro cambió/);
});
test('lectura agrupada reutiliza hojas entre consultas y una nueva versión invalida ese contexto',async()=>{
    const h=cargador();await h.cargar([1]);const workers=[];
    h.ctx.Worker=class {constructor(){workers.push(this);}postMessage(data){this.data=data;}terminate(){}};
    const lectura=await h.ctx.lecturaTest(),p=lectura.consultarHojas(['Sep26','Oct26','Sep26']);await tick();
    assert.equal(workers.length,1);assert.equal(workers[0].data.tipo,'semantica_lote');
    assert.deepEqual(Array.from(workers[0].data.nombresHojas),['Sep26','Oct26']);
    workers[0].onmessage({data:{ok:true,resultado:[{hoja:'Sep26',valor:1},{hoja:'Oct26',valor:1}]}});
    const salida=await p;salida[0].valor=99;
    assert.equal((await lectura.consultarHoja('Sep26')).valor,1);
    assert.equal((await (await h.ctx.lecturaTest()).consultarHojas(['Oct26','Sep26']))[0].valor,1);
    assert.equal(workers.length,1,'no repite lectura ni recibe cambios externos sobre su caché');
    await h.cargarGoogle([2]);const nueva=await h.ctx.lecturaTest();
    const q=nueva.consultarHojas(['Sep26']);await tick();assert.equal(workers.length,2);
    assert.equal(new Uint8Array(workers[1].data.buffer)[0],2);
    workers[1].onmessage({data:{ok:true,resultado:[{hoja:'Sep26',valor:2}]}});assert.equal((await q)[0].valor,2);
});
test('un lote en curso conserva su versión y no contamina la caché del Libro recién cargado',async()=>{
    const h=cargador();await h.cargar([1]);const workers=[];
    h.ctx.Worker=class {constructor(){workers.push(this);}postMessage(data){this.data=data;}terminate(){}};
    const lectura=await h.ctx.lecturaTest(),p=lectura.consultarHojas(['Sep26']);await tick();
    await h.cargarGoogle([2]);workers[0].onmessage({data:{ok:true,resultado:[{hoja:'Sep26',valor:1}]}});
    assert.equal((await p)[0].valor,1);
    const q=(await h.ctx.lecturaTest()).consultarHojas(['Sep26']);await tick();assert.equal(workers.length,2);
    workers[1].onmessage({data:{ok:true,resultado:[{hoja:'Sep26',valor:2}]}});assert.equal((await q)[0].valor,2);
});
const evento=g=>({generacion:g,carga_manual:true,tenia_anterior:true});
const eventoGoogle=g=>({generacion:g,carga_manual:false,carga_automatica:true,origen:'google',tenia_anterior:true});
test('evento duplicado: una comparación y un aviso final',async()=>{
    let calls=0;const mensajes=[];const c=A.crearControlador({generacion:()=>2,obtener:async()=>{calls++;return res();},mostrar:x=>mensajes.push(x),limpiar(){}});
    await c.cargar(evento(2));await c.cargar(evento(2));assert.equal(calls,1);assert.equal(mensajes.filter(x=>!x.pendiente).length,1);
});
test('evento de Google inicia automáticamente la comparación y el aviso',async()=>{
    let calls=0;const mensajes=[];const c=A.crearControlador({generacion:()=>2,obtener:async()=>{calls++;return res();},mostrar:x=>mensajes.push(x),limpiar(){}});
    await c.cargar(eventoGoogle(2));assert.equal(calls,1);assert.equal(mensajes.filter(x=>!x.pendiente).length,1);
});
test('generación nueva descarta B silenciosamente y procesa C sin paralelo',async()=>{
    let g=2,resolveB,calls=0;const mensajes=[];
    const cache=E.crearCache(()=>{calls++;return calls===1?new Promise(r=>resolveB=r):Promise.resolve(res({nuevas:[{actual:row}]}));},()=>g);
    const c=A.crearControlador({generacion:()=>g,obtener:()=>cache.obtener(),mostrar:x=>mensajes.push(x),limpiar(){}});
    const b=c.cargar(evento(g));await tick();g=3;cache.invalidar();c.invalidar();const siguiente=c.cargar(evento(g));await tick();assert.equal(calls,1);
    resolveB(res());await Promise.all([b,siguiente]);assert.equal(calls,2);assert.equal(mensajes.filter(x=>!x.pendiente).length,1);assert.match(mensajes.at(-1).texto,/Persona Prueba/);
});
test('sin cambios, nuevas, modificadas y contadores son resúmenes seguros',()=>{
    assert.match(A.resumir(res({estado:'sin_cambios'})).texto,/no cambiaron respecto de la copia anterior/);
    assert.match(A.resumir(res({nuevas:[{actual:row}]})).texto,/Persona Prueba · CAB 8 · Entrada: 11-09-2026 · Salida: 13-09-2026/);
    assert.match(A.resumir(res({modificadas:[{actual:row,cambios:[{campo:'fecha_checkout',antes:'2026-09-12',ahora:'2026-09-13'}]}]})).texto,/Salida: antes 12-09-2026, ahora 13-09-2026/);
    assert.match(A.resumir(res({nuevas:[{},{}],modificadas:[{},{}],ya_no_aparecen:[{}]})).texto,/5 cambios.*2 reservas agregadas · 2 con cambios · 1 ya no aparece/);
});
test('ausencias, ambigüedad, parcial y advertencias nunca se mezclan',()=>{
    assert.doesNotMatch(A.resumir(res({ya_no_aparecen:[{}]})).texto,/cancelada/i);
    assert.match(A.resumir(res({ambiguas:[{}],advertencias:[{}]})).texto,/1 caso que requiere revisión.*1 aviso sobre datos que necesitan revisión/);
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
        replaceChildren(...xs){for(const x of this.children)x.parent=null;this.children=[];for(const x of xs)this.appendChild(x);}
        remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
        setAttribute(k,v){this[k]=v;}
        removeAttribute(k){delete this[k];}
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
    const nodos=el=>[el,...el.children.flatMap(nodos)];
    return {window,document,ids,emitir,manual,nodos:()=>nodos(document.body),calls:()=>calls,abierto:()=>abierto,cambiar:()=>{g++;emitir('haiku:libro-cambio');},
        botones:()=>nodos(document.body).filter(x=>x.textContent==='Ver informe')};
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
    const mensaje=h.ids['haiku-asistente-mensajes'].children[0];assert.match(mensaje.textContent,/Las reservas no cambiaron respecto de la copia anterior del Libro/);
    const boton=mensaje.children[0];h.cambiar();assert.equal(boton.disabled,true);assert.equal(h.document.body.children.length,0);
});
test('error obsoleto no se notifica; error vigente es breve y permite una carga posterior',async()=>{
    let rechazar,calls=0;const h=interfaz(()=>{calls++;return calls===1?new Promise((_,r)=>rechazar=r):Promise.resolve(res());});
    h.emitir('haiku:libro-version-cargada',evento(2));await tick();h.cambiar();rechazar(Error('cancelado antiguo'));await tick();assert.equal(h.ids['haiku-asistente-mensajes'].children.length,0);
    h.emitir('haiku:libro-version-cargada',evento(3));await tick();assert.equal(h.calls(),2);assert.match(h.ids['haiku-asistente-mensajes'].children[0].textContent,/no cambiaron respecto/);
    const fallo=interfaz(async()=>{throw Error('detalle técnico secreto');});fallo.emitir('haiku:libro-version-cargada',evento(2));await tick();
    assert.match(fallo.ids['haiku-asistente-mensajes'].children[0].textContent,/No pude completar/);assert.doesNotMatch(fallo.ids['haiku-asistente-mensajes'].children[0].textContent,/secreto/);
});
test('aviso en segundo plano conserva conversación, borrador y posición y espera al terminar para abrir',async()=>{
    const h=interfaz(async()=>res({nuevas:[{actual:row}]}));let ocupado=true;
    h.window.HAIKU_ASISTENTE.procesando=()=>ocupado;
    const mensajes=h.ids['haiku-asistente-mensajes'];mensajes.scrollTop=37;
    h.ids['haiku-asistente-texto'].value='Mi consulta pendiente';
    h.emitir('haiku:libro-version-cargada',evento(2));await tick();
    assert.equal(mensajes.children.length,0);assert.equal(mensajes.scrollTop,37);
    assert.equal(h.ids['haiku-asistente-texto'].value,'Mi consulta pendiente');
    const abrir=h.botones()[0];assert.equal(abrir.disabled,true);
    abrir.dispatchEvent({type:'click'});assert.equal(h.abierto(),0);
    ocupado=false;h.ids['haiku-asistente-texto'].dispatchEvent({type:'input'});
    assert.equal(abrir.disabled,false);
    const seguir=h.nodos().find(x=>x.textContent==='Seguir con mi consulta');
    seguir.dispatchEvent({type:'click'});assert.equal(h.document.body.children.length,0);
    assert.equal(h.abierto(),0);assert.equal(mensajes.scrollTop,37);
});

const burbuja=r=>A.resumir(res(r)).burbuja;
test('Incorporar espera a la consulta, entrega el aviso exacto y conserva el borrador',async()=>{
    const resultado=res({nuevas:[{actual:row}]}),h=interfaz(async()=>resultado);
    const entregados=[];let ocupado=true,resolver;
    h.window.haikuSesion={usuario:{activo:true},roles:['administrador']};
    h.window.HAIKU_ASISTENTE.procesando=()=>ocupado;
    h.window.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1={...h.window.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1,
        incorporarDesdeAviso:r=>{entregados.push(r);return new Promise(r=>resolver=r);}};
    h.ids['haiku-asistente-texto'].value='Mi consulta pendiente';
    h.emitir('haiku:libro-version-cargada',evento(2));await tick();
    const boton=h.nodos().find(x=>x.textContent==='Incorporar');assert.ok(boton);assert.equal(boton.disabled,true);
    boton.dispatchEvent({type:'click'});assert.equal(entregados.length,0);
    ocupado=false;h.ids['haiku-asistente-texto'].dispatchEvent({type:'input'});
    assert.equal(boton.disabled,false);boton.dispatchEvent({type:'click'});
    assert.deepEqual(entregados,[resultado]);assert.equal(h.abierto(),0);
    assert.equal(boton.textContent,'Incorporando…');assert.equal(boton['aria-busy'],'true');
    boton.dispatchEvent({type:'click'});assert.equal(entregados.length,1);
    h.cambiar();assert.equal(h.document.body.children.length,1,'no desaparece durante el guardado');
    assert.equal(boton.textContent,'Incorporando…');
    resolver({servicios_creados:1,pendientes:[]});await tick();
    assert.equal(boton.textContent,'Incorporado');assert.equal(boton.disabled,true);
    assert.equal(boton['aria-busy'],undefined);
    assert.equal(h.ids['haiku-asistente-texto'].value,'Mi consulta pendiente');
    assert.equal(h.document.body.children.length,1);assert.equal(h.abierto(),0);
    assert.ok(h.nodos().some(x=>x.textContent==='Incorporado: 1 servicio.'));
});
test('Incorporar se desactiva al llegar otra generación y no aparece para avisos sin cambios',async()=>{
    const h=interfaz(async()=>res({nuevas:[{actual:row}]}));
    h.window.haikuSesion={usuario:{activo:true},roles:['administrador']};
    h.emitir('haiku:libro-version-cargada',evento(2));await tick();
    const boton=h.nodos().find(x=>x.textContent==='Incorporar');assert.ok(boton);
    h.cambiar();assert.equal(boton.disabled,true);
    const vacio=interfaz(async()=>res({advertencias:[{}]}));
    vacio.window.haikuSesion={usuario:{activo:true},roles:['administrador']};
    vacio.emitir('haiku:libro-version-cargada',evento(2));await tick();
    assert.equal(vacio.nodos().some(x=>x.textContent==='Incorporar'),false);
});
const cambio=(campo,antes,ahora)=>burbuja({modificadas:[{actual:row,cambios:[{campo,antes,ahora}]}]}).casos[0].detalles[0];
test('burbuja: fecha breve precisa, incluso al cambiar de mes o año',()=>{
    assert.deepEqual(cambio('fecha_checkout','2026-11-14','2026-11-15'),{etiqueta:'Fecha',texto:'Salida: 14 → 15 nov.'});
    assert.equal(cambio('fecha_checkin','2026-11-30','2026-12-01').texto,'Entrada: 30 nov. → 1 dic.');
    assert.equal(cambio('fecha_checkin','2026-12-31','2027-01-01').texto,'Entrada: 31 dic. 2026 → 1 ene. 2027');
});
test('burbuja: identifica la nota agregada, retirada o sustituida sin repetir las conservadas',()=>{
    const a=['Sin azúcar','Llegada a las 19:00'],b=[' sin azúcar ','Llegada a las 20:00'];
    assert.equal(cambio('notas_importantes',[],['Llegada a las 20:00']).texto,'Se agregó «Llegada a las 20:00»');
    assert.equal(cambio('notas_importantes',['Llegada a las 20:00'],[]).texto,'Se retiró «Llegada a las 20:00»');
    const detalle=cambio('notas_importantes',a,b).texto;
    assert.match(detalle,/Se retiró «Llegada a las 19:00».*Se agregó «Llegada a las 20:00»/);assert.doesNotMatch(detalle,/azúcar/);
});
test('burbuja: nota acotada y sin contactos, documentos o montos',()=>{
    const texto=cambio('notas_importantes',[],['Llamar a test@example.test +56 9 1234 5678 RUT 12.345.678-9, abono $120.000. '+ 'a'.repeat(300)]).texto;
    assert.doesNotMatch(texto,/example\.test|1234 5678|12\.345\.678|120\.000/);assert.ok(texto.length<105);assert.match(texto,/…/);
});
test('burbuja: traslado de tinaja y cambio de horario describen el antes y después',()=>{
    const a={concepto:'tonel',hora:'19:15',cortesia:true,pendiente:false,monto:null};
    assert.deepEqual(cambio('servicios',[a],[{...a,concepto:'jacuzzi'}]),{etiqueta:'Tinaja',texto:'Tonel → Jacuzzi · 19:15'});
    assert.equal(cambio('servicios',[a],[{...a,hora:'20:15'}]).texto,'Tonel · 19:15 → 20:15');
    assert.equal(cambio('servicios',[a],[{...a,pendiente:true,cortesia:false,monto:30000}]).texto,'Tonel: cambió la condición de cobro.');
});
test('burbuja: servicios agregados o retirados no se presentan como un traslado inventado',()=>{
    const a={concepto:'tonel',hora:'19:15'},b={concepto:'masaje',hora:'20:00'};
    assert.equal(cambio('servicios',[a],[a,b]).texto,'Agregado: Masaje · 20:00');
    assert.equal(cambio('servicios',[a,b],[b]).texto,'Retirado: Tonel · 19:15');
    assert.equal(cambio('servicios',[a],[a,a]).texto,'Agregado: Tonel · 19:15');
    assert.equal(cambio('servicios',[{concepto:'otro_a'}],[{concepto:'otro_b'}]).texto,'Cambió el tipo de servicio.');
    assert.match(cambio('servicios',[a,b],[{concepto:'jacuzzi',hora:'19:15'}]).texto,/Agregado: Jacuzzi.*Retirado: Tonel.*Masaje/);
});
test('burbuja: cancelación en el Libro no afirma que esté guardada en Proyecto H',()=>{
    const cancelada=burbuja({cancelaciones_confirmadas:[{anterior:row}]}).casos[0];
    assert.equal(cancelada.titulo,'Cancelada en el Libro');assert.match(cancelada.detalles[0].texto,/Falta confirmarla en Proyecto H/);
    assert.doesNotMatch(JSON.stringify(burbuja({ya_no_aparecen:[{anterior:row}]})),/cancelad/i);
});
test('burbuja: varios cambios y avisos conservan límites, diferencias y estado parcial',()=>{
    const r=burbuja({estado:'parcial',nuevas:[{actual:row},{actual:row},{actual:row}],ya_no_aparecen:[{anterior:row}],ambiguas:[{}],advertencias:[{}]});
    assert.equal(r.casos.length,3);assert.equal(r.restantes,1);assert.match(r.titulo,/4 cambios/);
    assert.deepEqual(r.avisos,['No pude revisar todo el Libro.','1 caso por aclarar.','1 dato por revisar.']);
    assert.equal(burbuja({estado:'sin_cambios'}).detalle,'Esto no compara con Proyecto H.');
});
test('burbuja: usa la clasificación real en una sola franja y texto seguro en el DOM',async()=>{
    const payload='<img src=x onerror=alert(1)>',r=res({modificadas:[{actual:row,cambios:[{campo:'notas_importantes',antes:[],ahora:[payload]}]}]});
    const h=interfaz(async()=>r),P=require('../js/supabase-asistente-libro-prioridad-v1.js');
    h.window.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1=P;h.emitir('haiku:libro-version-cargada',evento(2));await tick();
    const franja=h.nodos().find(n=>n.className==='haku-libro-auto__prioridades');assert.equal(franja.children.length,4);
    const grupos=P.clasificar(r).grupos;
    assert.deepEqual(franja.children.map(n=>n.children[1].textContent),Object.values(grupos).map(g=>String(g.length)));
    assert.deepEqual(franja.children.map(n=>n.children[0].textContent),['Hoy','Mañana','Próximos','Info']);
    const nota=h.nodos().find(n=>n.textContent.includes(payload));assert.ok(nota);assert.equal(nota.innerHTML,undefined);
    assert.doesNotMatch(h.nodos().map(n=>n.textContent).join(' '),/🔴|🟠|🟡|🟢|Abre el informe para ver qué datos/);
});
const textoNodo=n=>[n.textContent,...n.children.map(textoNodo)].join(' ');
const filtroUI=h=>({
    botones:h.nodos().find(n=>n.className==='haku-libro-auto__prioridades').children,
    contenido:h.nodos().find(n=>n.className==='haku-libro-auto__filtrado'),
    resumen:h.nodos().find(n=>n.className==='haku-libro-auto__resumen')
});
test('Info explica ambos avisos, distingue versiones y permite cambiar o cerrar sin releer ni interrumpir',async()=>{
    const r=res({advertencias:['anterior','actual'].map(version=>({version,hoja:'Oct26',
        detalles:['Las noches escritas no coinciden con las fechas combinadas; confirmar ingreso/salida.']}))});
    const h=interfaz(async()=>r);h.window.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1=require('../js/supabase-asistente-libro-prioridad-v1.js');
    h.ids['haiku-asistente-texto'].value='Mi consulta pendiente';h.window.HAIKU_ASISTENTE.procesando=()=>true;
    h.emitir('haiku:libro-version-cargada',evento(2));await tick();
    const {botones,contenido,resumen}=filtroUI(h);assert.equal(contenido.hidden,true);
    botones[3].dispatchEvent({type:'click'});
    assert.equal(contenido.hidden,false);assert.equal(resumen.hidden,true);assert.equal(contenido.children.length,2);
    assert.match(textoNodo(contenido.children[0]),/Versión anterior.*Oct26.*La cantidad de noches escrita no coincide/);
    assert.match(textoNodo(contenido.children[1]),/Versión actual.*Oct26.*La cantidad de noches escrita no coincide/);
    assert.doesNotMatch(textoNodo(contenido),/Nombre no indicado|CAB —|\[object Object\]/);
    for(let i=0;i<3;i++){
        botones[i].dispatchEvent({type:'click'});
        assert.match(textoNodo(contenido),/No hay cambios ni avisos en esta categoría/);
        assert.deepEqual(botones.map(b=>b['aria-expanded']),botones.map((_,j)=>String(j===i)));
    }
    botones[2].dispatchEvent({type:'click'});assert.equal(contenido.hidden,true);assert.equal(resumen.hidden,false);
    assert.equal(contenido.children.length,0);assert.equal(h.calls(),1);assert.equal(h.abierto(),0);
    assert.equal(h.ids['haiku-asistente-texto'].value,'Mi consulta pendiente');
    assert.equal(h.ids['haiku-asistente-mensajes'].children.length,0);
});
test('cada categoría muestra todas sus reservas y diferencias exactas, incluso con el mismo titular',async()=>{
    const P=require('../js/supabase-asistente-libro-prioridad-v1.js');
    const r=res({modificadas:['2026-11-07','2026-11-08','2026-11-10',...Array(5).fill('2026-10-01')].map((dia,i)=>({
        anterior:{...row,fecha_checkin:dia,fecha_checkout:dia},actual:{...row,fecha_checkin:dia,fecha_checkout:dia},
        cambios:[{campo:'servicios',antes:[],ahora:[{concepto:'masaje',hora:`${10+i}:00`}]}]
    }))});
    const original=JSON.stringify(r),h=interfaz(async()=>r);
    h.window.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1={...P,clasificar:(r,opciones)=>P.clasificar(r,{...opciones,fechaActual:'2026-11-07'})};
    h.emitir('haiku:libro-version-cargada',evento(2));await tick();
    const {botones,contenido}=filtroUI(h);
    for(let i=0;i<4;i++){
        botones[i].dispatchEvent({type:'click'});
        assert.equal(contenido.children.length,i===3?5:1);
        assert.match(textoNodo(contenido),new RegExp(`Agregado: Masaje · ${10+i}:00`));
        assert.doesNotMatch(textoNodo(contenido),/más en el informe/);
    }
    assert.match(textoNodo(contenido),/17:00/);assert.equal(h.calls(),1);assert.equal(JSON.stringify(r),original);
});
test('los detalles filtrados conservan texto seguro y ocultan contactos y montos dentro del motivo',async()=>{
    const payload='<img src=x onerror=alert(1)>',h=interfaz(async()=>res({advertencias:[{hoja:'Oct26',
        validacion:[{codigo:'checkout_anterior_al_checkin',motivo:`${payload} privado@example.test $50000 12.345.678-9 +56912345678`}]}]}));
    h.window.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1=require('../js/supabase-asistente-libro-prioridad-v1.js');
    h.emitir('haiku:libro-version-cargada',evento(2));await tick();
    const {botones,contenido}=filtroUI(h);botones[3].dispatchEvent({type:'click'});
    assert.match(textoNodo(contenido),/La salida figura antes de la entrada/);assert.ok(textoNodo(contenido).includes(payload));
    assert.doesNotMatch(textoNodo(contenido),/privado@example|50000|12\.345\.678-9|56912345678/);
    const detalle=contenido.children[0].children.at(-1).children.at(-1);assert.equal(detalle.innerHTML,undefined);
});

test('verificación automática avisa con Haku abierto; cerrado, restaurado o mismos bytes siguen en silencio',async()=>{
    const h=cargador();await h.cargar([1]);h.flush();
    const cargar=bytes=>h.ctx.cargarTest({name:'Libro.xlsx',size:bytes.length,arrayBuffer:async()=>new Uint8Array(bytes).buffer},false,'google',false);
    await cargar([2]);h.flush();assert.equal(h.avisos().length,0);
    h.ctx.HAIKU_ASISTENTE={abierta:()=>true};
    await cargar([3]);h.flush();assert.equal(h.avisos().length,1);
    assert.equal(h.avisos()[0].detail.carga_automatica,true);
    await cargar([3]);h.flush();assert.equal(h.avisos().length,1);
    await h.ctx.restaurarTest();h.flush();assert.equal(h.avisos().length,1);
});
