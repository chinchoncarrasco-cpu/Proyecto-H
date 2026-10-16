const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
const from=source.indexOf('            actualizarPrecio = () => {',source.indexOf('Guardar servicio y continuar'));
const to=source.indexOf('            for (const input of [parte,selector',from);
assert.ok(from>=0 && to>from,'El formulario de servicios está disponible');
const codigo=source.slice(from,to);
function formulario({cantidadValor='1',precioValor='15000',unidad='hora',confirmado=true}={}) {
    const campo=valor=>({value:valor,disabled:false,required:false,parentElement:{hidden:false,style:{}}});
    const parte=campo('0'),selector=campo('lateCheckout'),cantidad=campo(cantidadValor);
    const precio=campo(precioValor),personas=campo('2'),fecha=campo('2026-10-12');
    const hora=campo('13:30'),cobro=campo('normal'),confirmarPrecio=campo('');
    confirmarPrecio.checked=confirmado;
    const detallePrecio={textContent:''},aviso={textContent:''};
    const notaPersonas={hidden:false};
    const totalServicio={querySelector(){return {set textContent(v){totalServicio.total=v}}}};
    const totalPie={querySelector(){return {set textContent(v){totalPie.total=v}}}};
    const guardar={disabled:false};
    const catalogo={codigo:'lateCheckout',nombre:'Late Check-out',unidad,precio_base:10000,
        requiere_horario:true,capacidad_maxima:null};
    const p={ingreso:'2026-10-11',salida:'2026-10-12',
        aplicaciones:[{indice:0,estado:'sin_destino',monto:15000}]};
    const actualizado=new Function('p','parte','productoElegido','personasNoAplicanPagoManual',
        'mostrarCampo','personas','notaPersonas','hora','precio','cantidad','confirmarPrecio',
        'detallePrecio','precioCatalogoExactoPagoManual','totalServicio','totalPie',
        'guardar','aviso','fecha','cobro','money',
        'let actualizarPrecio;\n'+codigo+'\nreturn actualizarPrecio;')(
            p,parte,()=>catalogo,c=>c.unidad==='unidad',
            (input,visible)=>{input.disabled=!visible;input.parentElement.hidden=!visible;},
            personas,notaPersonas,hora,precio,cantidad,confirmarPrecio,
            detallePrecio,()=>false,totalServicio,totalPie,guardar,aviso,fecha,cobro,
            n=>'$'+Number(n).toLocaleString('es-CL'));
    actualizado();
    return {guardar,aviso,detallePrecio,totalServicio,totalPie};
}
test('Late Check-out: fracción 1,5 se explica y bloquea',()=>{
    const x=formulario({cantidadValor:'1.5',precioValor:'10000'});
    assert.equal(x.guardar.disabled,true);
    assert.match(x.aviso.textContent,/Cantidad 1\.5 no se puede guardar/);
    assert.match(x.aviso.textContent,/horas enteras/);
    assert.match(x.aviso.textContent,/\$15\.000/);
    assert.match(x.aviso.textContent,/La duración fraccionaria no quedará representada/);
});
test('Cantidad 1 y precio manual 15.000 sí habilitan guardar',()=>{
    const x=formulario({cantidadValor:'1',precioValor:'15000',confirmado:true});
    assert.equal(x.guardar.disabled,false);
    assert.equal(x.aviso.textContent,'');
    assert.equal(x.totalServicio.total,'$15.000');
});
test('Cantidad 1 con importe manual sin confirmar permanece bloqueada',()=>{
    const x=formulario({cantidadValor:'1',precioValor:'15000',confirmado:false});
    assert.equal(x.guardar.disabled,true);
});
test('No admitir decimales de otros servicios como unidades',()=>{
    const x=formulario({cantidadValor:'1.5',precioValor:'10000',unidad:'unidad'});
    assert.equal(x.guardar.disabled,true);
    assert.match(x.aviso.textContent,/número entero mayor que cero/);
});
test('Restricciones visibles coherentes con servicio entero del backend',()=>{
    assert.match(source,/cantidad\.min = '1'/);
    assert.match(source,/cantidad\.step = '1'/);
    assert.match(source,/Number\.isSafeInteger\(cantidad\) \|\| cantidad <= 0/);
});
