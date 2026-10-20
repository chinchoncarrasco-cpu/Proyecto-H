const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8').replace(/\r\n/g,'\n');
const inicio = source.indexOf('    function capturarVistaAprobaciones(out) {');
const fin = source.indexOf('    function renderizarIncorporacion(', inicio);
assert.ok(inicio !== -1 && fin > inicio);
const vista = vm.runInNewContext(source.slice(inicio,fin) +
    '\n({capturarVistaAprobaciones,restaurarVistaAprobaciones,bloquearVistaMientrasRevalida})');

function fake({abiertos=['dudosos'],scrollTop=350,top=175,busy=null,inerte=false}={}) {
    let secciones = ['dudosos','pagos','pendientes'].map(tipo => ({
        className:'haiku-incorporacion-seccion haiku-incorporacion-seccion--'+tipo,
        open:abiertos.includes(tipo)
    }));
    const contenedor={scrollTop,isConnected:true}, atributos=new Map(busy===null?[]:[['aria-busy',busy]]);
    let topActual=top;
    const out={
        inert:inerte,isConnected:true,
        querySelectorAll(selector){assert.equal(selector,'details.haiku-incorporacion-seccion');return secciones;},
        querySelector(selector){return selector.includes('> summary') ? {getBoundingClientRect:()=>({top:topActual})}:null;},
        closest(selector){assert.equal(selector,'.haiku-asistente-mensajes');return contenedor;},
        getAttribute(nombre){return atributos.get(nombre)??null;},
        setAttribute(nombre,valor){atributos.set(nombre,valor);},
        removeAttribute(nombre){atributos.delete(nombre);}
    };
    return {out,contenedor,
        cambiar({top=topActual,abiertos=[],scrollTop=0}={}){
            topActual=top;
            secciones=secciones.map(s=>({...s,open:abiertos.includes(s.className.split('--').at(-1))}));
            contenedor.scrollTop=scrollTop;
        },
        abiertas:()=>secciones.filter(s=>s.open).map(s=>s.className.split('--').at(-1))
    };
}

test('conserva Pagos para revisar y Pagos preparados abiertos',()=>{
    const f=fake({abiertos:['dudosos','pagos']});
    const anterior=vista.capturarVistaAprobaciones(f.out);
    f.cambiar({top:260});
    vista.restaurarVistaAprobaciones(f.out,anterior);
    assert.deepEqual(f.abiertas(),['dudosos','pagos']);
    assert.equal(f.contenedor.scrollTop,435);
});

test('mantiene revisión abierta aunque la cantidad de pagos cambie',()=>{
    const f=fake();
    const anterior=vista.capturarVistaAprobaciones(f.out);
    f.cambiar({top:175});
    vista.restaurarVistaAprobaciones(f.out,anterior);
    assert.deepEqual(f.abiertas(),['dudosos']);
    assert.equal(f.contenedor.scrollTop,350);
});

test('durante revalidación bloquea otras aprobaciones y después las habilita',()=>{
    const f=fake();
    const desbloquear=vista.bloquearVistaMientrasRevalida(f.out);
    assert.equal(f.out.inert,true);
    assert.equal(f.out.getAttribute('aria-busy'),'true');
    desbloquear();
    assert.equal(f.out.inert,false);
    assert.equal(f.out.getAttribute('aria-busy'),null);
});

test('ambas rutas revalidan sin reemplazar prematuramente el listado',()=>{
    const ini=source.indexOf('                const aprobar = async ids => {');
    const fin=source.indexOf('                incorporar = async planActual => {',ini);
    const principal=source.slice(ini,fin);
    assert.doesNotMatch(principal,/avisarConComprobante\(lista\.length/);
    assert.match(principal,/restaurarVistaAprobaciones\(out,vista\)/);
    const i=source.indexOf('        const aprobar=async ids=>{');
    const j=source.indexOf('        incorporar=planActual=>',i);
    const estructurada=source.slice(i,j);
    assert.doesNotMatch(estructurada,/out\.replaceChildren/);
    assert.match(estructurada,/restaurarVistaAprobaciones\(out,vista\)/);
});

// Ejecutar los handlers reales de ambas vistas, sin depender del número de
// llamadas ni del espaciado de las declaraciones de bloqueo.
function handlers(patron) {
    return Array.from(source.matchAll(patron),match=>{
        const fin=source.indexOf('\n'+match[1]+'};',match.index);
        assert.ok(fin>match.index,'handler completo');
        return source.slice(match.index,fin+match[1].length+4);
    });
}
for(const [tipo,patron] of [
    ['aprobar',/^([ ]*)const aprobar\s*=\s*async ids\s*=>\s*\{/gm],
    ['manualPago',/^([ ]*)aprobar\.manualPago\s*=\s*async .*=>\s*\{/gm],
    ['refrescarTrasPenalidad',/^([ ]*)aprobar\.refrescarTrasPenalidad\s*=\s*async .*=>\s*\{/gm]
]) {
    const rutas=handlers(patron);
    assert.equal(rutas.length,2,'handler presente en ambas vistas: '+tipo);
    for(const [ruta,codigo] of rutas.entries()) for(const falla of [false,true])
    test(`${tipo}, vista ${ruta+1}: conserva lista y desbloquea tras ${falla?'error':'éxito'}`,async()=>{
        const f=fake({abiertos:['dudosos','pagos']}),aprobados=new Set();
        let resolver,rechazar,renders=0,lecturas=0;
        const pendiente=new Promise((resolve,reject)=>{resolver=resolve;rechazar=reject;});
        f.out.append=()=>{};
        f.out.replaceChildren=()=>assert.fail('No sustituir la lista durante la revalidación');
        const contexto={...vista,out:f.out,result:{},decisiones:new Map(),aprobados,
            prepararIncorporacion:()=>{lecturas++;return pendiente;},
            resolverAprobacionManualPago:()=>{lecturas++;return pendiente;},
            restaurarSeleccionIncorporacion:nuevo=>nuevo,
            continuarVistaManualPago:()=>{},volver:async()=>{},elemento:()=>({}),
            renderizarIncorporacion:()=>{
                renders++;
                assert.equal(f.out.inert,true);
                f.cambiar({top:260});
            }};
        const cabecera='let planEnVista={items:[]};let identidadActualizada=false;let incorporar;';
        const inicial=tipo==='aprobar'?'':'const aprobar={};';
        const ejecutar=vm.runInNewContext(cabecera+inicial+codigo+
            '\n'+(tipo==='aprobar'?'aprobar':`aprobar.${tipo}`),contexto);
        const terminado=ejecutar(...(tipo==='manualPago'?[{items:[]},'pago',{}]:['pago']))
            .catch(error=>{assert.equal(error.message,'sin red');});
        assert.equal(lecturas,1);
        assert.equal(renders,0);
        assert.deepEqual(f.abiertas(),['dudosos','pagos']);
        assert.equal(f.contenedor.scrollTop,350);
        assert.equal(f.out.inert,true);
        assert.equal(f.out.getAttribute('aria-busy'),'true');
        if(falla) rechazar(Error('sin red'));
        else resolver({items:[{id:'pago',categoria:'pagos',motivos:[],seleccionado:true}]});
        await terminado;
        assert.equal(renders,falla?0:1);
        assert.equal(f.out.inert,false);
        assert.equal(f.out.getAttribute('aria-busy'),null);
        assert.deepEqual(f.abiertas(),['dudosos','pagos']);
        assert.equal(f.contenedor.scrollTop,falla?350:435);
        if(falla) assert.equal(aprobados.size,0);
    });
}

test('respeta estados inerte y busy que ya estaban activos',()=>{
    const f=fake({inerte:true,busy:'preexistente'});
    const desbloquear=vista.bloquearVistaMientrasRevalida(f.out);
    desbloquear();
    assert.equal(f.out.inert,true);
    assert.equal(f.out.getAttribute('aria-busy'),'preexistente');
});
