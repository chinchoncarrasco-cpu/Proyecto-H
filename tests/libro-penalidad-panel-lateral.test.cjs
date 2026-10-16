const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ajustes=fs.readFileSync(require.resolve('../js/supabase-ajustes-cargo-v1.js'),'utf8');
const libro=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
const inicio=ajustes.indexOf('    async function abrirModal(opciones = {}) {');
const fin=ajustes.indexOf('    // Abre el mismo formulario financiero para una reserva del Libro',inicio);
assert.ok(inicio>=0 && fin>inicio);
const apertura=ajustes.slice(inicio,fin);

function entorno(ancha=true) {
    const clases=new Set(), atributos=new Map(),ceja={textContent:''};
    const overlay={
        hidden:true,
        classList:{
            toggle(n,activo){if(activo)clases.add(n);else clases.delete(n);},
            contains:n=>clases.has(n),
            remove:n=>clases.delete(n)
        },
        querySelector(s) {
            if(s==='[role="dialog"]')return{setAttribute:(k,v)=>atributos.set(k,v)};
            if(s==='.haiku-ajuste-cargo-cabecera small')return ceja;
            return null;
        }
    };
    const titulo={textContent:''},select={innerHTML:'',disabled:false};
    const documento={getElementById(id){return({
        'haiku-ajuste-cargo-overlay':overlay,
        'haiku-ajuste-cargo-titulo':titulo,
        'haiku-ajuste-reserva':select
    })[id]},body:{style:{overflow:''}}};
    const ventana={haikuSesion:{user:{id:'prueba'}},haikuTienePermiso:()=>true,
        matchMedia:()=>({matches:ancha})};
    let lecturasDelDia=0;
    const abrir=new Function('window','document','resetModal','cargarReservas','alert',
        apertura+'\nreturn abrirModal;')(
        ventana,documento,()=>{},async()=>{lecturasDelDia++},()=>{throw Error('Alerta inesperada');});
    return {abrir,overlay,clases,atributos,ceja,titulo,select,
        lecturasDelDia:()=>lecturasDelDia};
}

test('Libro abre inmediatamente el formulario lateral, sin consultar reservas del día',async()=>{
    const h=entorno();
    await h.abrir({desdeLibro:true});
    assert.equal(h.lecturasDelDia(),0);
    assert.equal(h.overlay.hidden,false);
    assert.equal(h.clases.has('haiku-ajuste-cargo-overlay--libro'),true);
    assert.equal(h.titulo.textContent,'Revisar penalidad 10%');
    assert.equal(h.select.disabled,true);
    assert.equal(h.atributos.get('aria-modal'),'false');
});
test('Pagos mantiene su ventana original y consulta las reservas del día',async()=>{
    const h=entorno();
    await h.abrir({desdeLibro:true});
    await h.abrir();
    assert.equal(h.lecturasDelDia(),1);
    assert.equal(h.clases.has('haiku-ajuste-cargo-overlay--libro'),false);
    assert.equal(h.titulo.textContent,'Ajustar cargo');
});
test('el panel ocupa el espacio inmediatamente izquierdo de Haku',()=>{
    assert.match(ajustes,/\.haiku-ajuste-cargo-overlay\.haiku-ajuste-cargo-overlay--libro/);
    assert.match(ajustes,/inset:\s*0 var\(--haiku-panel-coordinado-ancho/);
    assert.match(ajustes,/z-index:\s*90020/);
    assert.match(ajustes,/width:\s*clamp\(260px,\s*30vw,\s*500px\)/);
    assert.match(ajustes,/overflow-y:\s*auto/);
});
test('en pantallas compactas el formulario ocupa la pantalla y cerrar devuelve Haku',async()=>{
    const h=entorno(false);
    await h.abrir({desdeLibro:true});
    assert.equal(h.atributos.get('aria-modal'),'true');
    assert.match(ajustes,/@media \(max-width:\s*900px\)/);
    assert.match(ajustes,/width:\s*100vw/);
    assert.match(ajustes,/overlay\.classList\.remove\('haiku-ajuste-cargo-overlay--libro'\)/);
});
test('al abrir desde el Libro sólo se selecciona la reserva revalidada',()=>{
    assert.match(ajustes,/await abrirModal\(\{desdeLibro:true\}\)/);
    assert.match(ajustes,/select\.disabled=true/);
    assert.match(ajustes,/compatibles\.length !== 1/);
    assert.match(ajustes,/await cargarResumenSeleccionado\(\)/);
    assert.match(ajustes,/overlay\.hidden \|\| !overlay\.classList\.contains/);
});
test('el botón de penalidad indica Abriendo ajuste, sin aprobar pago automáticamente',()=>{
    assert.match(libro,/textoProgreso = "Aprobando…"/);
    assert.match(libro,/fila,'Abriendo ajuste…'/);
    assert.match(libro,/HAIKU_AJUSTES_CARGO_V2\?\.abrirParaReserva/);
    assert.doesNotMatch(libro.slice(libro.indexOf("if (item.penalidadManual) {"),libro.indexOf("const revisionManualVisible = item.manualPago",libro.indexOf("if (item.penalidadManual) {"))),/haiku_registrar_pago|haiku_aplicar_ajuste/);
});
