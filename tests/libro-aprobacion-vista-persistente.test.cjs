const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
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
    assert.equal((source.match(/aprobar\.manualPago = async \(planActual,id,accion\)/g)||[]).length,2);
    assert.equal((source.match(/const vista=capturarVistaAprobaciones\(out\), desbloquear=bloquearVistaMientrasRevalida\(out\)/g)||[]).length,4);
});

test('respeta estados inerte y busy que ya estaban activos',()=>{
    const f=fake({inerte:true,busy:'preexistente'});
    const desbloquear=vista.bloquearVistaMientrasRevalida(f.out);
    desbloquear();
    assert.equal(f.out.inert,true);
    assert.equal(f.out.getAttribute('aria-busy'),'preexistente');
});
