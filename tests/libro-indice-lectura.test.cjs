const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Instrumentación sólo de test: expone el método privado y fija un Libro ya cargado.
// La implementación de consultas, worker y transacciones se ejecuta sin reemplazos.
function lector({pc=true, anterior=true, guardado=true}={}) {
    const transactions=[], requests=[], workers=[];
    const previous = {buffer: new Uint8Array([2]).buffer};
    const context = vm.createContext({ArrayBuffer, Uint8Array, structuredClone, URL, setTimeout, clearTimeout,
        document:{readyState:'loading',addEventListener(){},currentScript:{src:'https://example.test/js/lector.js?v=test'}},
        matchMedia:()=>({matches:pc}), addEventListener(){}, removeEventListener(){},
        indexedDB:{open(){
            const req={};
            queueMicrotask(()=>{
                req.result={close(){}, transaction(store,mode){
                    transactions.push({store,mode}); assert.equal(mode,'readonly');
                    const tx={objectStore(){return {get(key){
                        requests.push(key); const read={result:anterior?previous:undefined};
                        queueMicrotask(()=>tx.oncomplete()); return read;
                    },put(){throw Error('Prohibido escribir');},clear(){throw Error('Prohibido borrar');}};}};
                    return tx;
                }}; req.onsuccess();
            }); return req;
        }},
        Worker:class {
            constructor(url){this.url=url;workers.push(this);}
            postMessage(message){this.message=message;queueMicrotask(()=>this.onmessage({data:{ok:true,resultado:{nombres:['Sep26'],hojas:[]}}}));}
            terminate(){this.terminated=true;}
        }
    });
    context.window=context;
    const source=fs.readFileSync(path.join(__dirname,'../js/supabase-libro-reserva-v1.js'),'utf8');
    const hook=`
        archivoBuffer = new Uint8Array([1]).buffer;
        libroIndice = {SheetNames:['Sep26']};
        persistenciaConfirmada = ${guardado};
        window.consultaTest = consultarHoja;
    `;
    vm.runInContext(source.replace(/\}\)\(\);\s*$/,hook+'})();'),context);
    return {context,transactions,requests,workers};
}
test('índice anterior usa sólo readonly y el worker existente con copia del buffer',async()=>{
    const h=lector();const r=await h.context.consultaTest('','anterior','indice');
    assert.equal(r.nombres[0],'Sep26');assert.deepEqual(h.requests,['anterior']);
    assert.equal(h.transactions.length,1);assert.equal(h.workers[0].message.tipo,'indice');
    assert.equal(new Uint8Array(h.workers[0].message.buffer)[0],2);assert.ok(h.workers[0].terminated);
    await h.context.consultaTest('','anterior','indice');assert.equal(h.transactions.length,1);
});
test('sin anterior: índice devuelve null, semántica mantiene su error compatible',async()=>{
    const h=lector({anterior:false}); assert.equal(await h.context.consultaTest('','anterior','indice'),null);
    await assert.rejects(h.context.consultaTest('Sep26','anterior','semantica'),/Todavía no hay/);
    assert.equal(h.workers.length,0);
});
test('celular no abre IndexedDB al pedir índice anterior; índice actual funciona',async()=>{
    const h=lector({pc:false,guardado:false});assert.equal(await h.context.consultaTest('','anterior','indice'),null);
    await h.context.consultaTest('','actual','indice');assert.equal(h.transactions.length,0);
    assert.equal(new Uint8Array(h.workers[0].message.buffer)[0],1);
});
test('PC sin guardado confirmado no devuelve falsa línea base',async()=>{
    const h=lector({guardado:false});await assert.rejects(h.context.consultaTest('','anterior','indice'),/no está guardado/);
    assert.equal(h.transactions.length,0);
});
test('huellas mantiene sólo lectura, detección de primera carga y compatibilidad celular',async()=>{
    const h=lector();await h.context.consultaTest(['Sep26'],'anterior','huellas');
    assert.equal(h.transactions[0].mode,'readonly');assert.equal(h.workers[0].message.tipo,'huellas');
    assert.deepEqual(Array.from(h.workers[0].message.nombresHojas),['Sep26']);
    assert.equal(await lector({anterior:false}).context.consultaTest('','anterior','huellas'),null);
    const mobile=lector({pc:false,guardado:false});assert.equal(await mobile.context.consultaTest('','anterior','huellas'),null);
    assert.equal(mobile.transactions.length,0);
});
test('índice de nombres nuevo conserva ausencia de línea base y readonly',async()=>{
    const h=lector();await h.context.consultaTest('','anterior','indice_nombres');
    assert.equal(h.transactions[0].mode,'readonly');assert.equal(h.workers[0].message.tipo,'indice_nombres');
    assert.equal(await lector({anterior:false}).context.consultaTest('','anterior','indice_nombres'),null);
});
