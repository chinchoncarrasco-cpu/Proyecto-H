const test = require('node:test');
const assert = require('node:assert/strict');
const { entorno, Element } = require('./fixtures/libro-servicio-manual.cjs');
// Standard DOM insertion used by the receipt; this shim is test-only.
Element.prototype.insertBefore = function(nodo, referencia) {
    const indice=this.children.indexOf(referencia);
    assert.ok(indice>=0); nodo.remove();
    this.children.splice(this.children.indexOf(referencia),0,nodo);nodo.parentElement=this;
};

function caso() {
    const e = entorno(), card = new e.Element('div');
    card.replaceChildren = (...hijos) => { card.children = []; card.text = ''; card.append(...hijos); };
    const nota = { item_id:'nota-1', kind:'nota', estado:'listo',
        reserva:{titular:'Huésped Nota',cabana:8}, texto:'Texto anterior a la revalidación',
        payload:{item_id:'nota-1',reserva_id:'reserva-n',estadia_id:'estadia-n',texto:'Agregar cuna en el alojamiento.\nBebé de 1 año.'}, razones:[] };
    const servicio = { item_id:'servicio-1',kind:'servicio',estado:'listo',
        reserva:{titular:'Huésped Servicio',cabana:2}, mapa:{nombre:'Tinaja Tonel de Madera'},
        servicio:{texto_original:'TONEL 19:15 A 20:15'}, hora_fin:'20:15',
        payload:{item_id:'servicio-1',reserva_id:'reserva-s',estadia_id:'estadia-s',
            fecha_servicio:'2026-10-17',hora:'19:15',cantidad:1,tipo_cobro:'cortesia'}, razones:[] };
    const anterior = { ...nota,item_id:'anterior',estado:'existente',
        reserva:{titular:'Huésped Anterior',cabana:1},texto:'Ya estaba guardado',payload:null };
    const omitida = { ...nota,item_id:'omitida',reserva:{titular:'Huésped Omitido',cabana:5},
        payload:{...nota.payload,item_id:'omitida',texto:'No es nueva'} };
    const noElegida = { ...nota,item_id:'no-elegida',reserva:{titular:'Huésped No Elegido',cabana:7} };
    const revision = {items:[anterior,noElegida,servicio,omitida,nota]};
    const elegidos = [servicio,omitida,nota];
    const data = {ok:true,servicios_creados:1,notas_creadas:1,servicios_omitidos:0,notas_omitidas:1,
        servicios:[{item_id:servicio.item_id,servicio_id:'persistido-s',estado:'creado'}],
        notas:[{item_id:nota.item_id,nota_id:'persistida-n',estado:'creada'},
            {item_id:omitida.item_id,nota_id:'persistida-o',estado:'ya_importada'}]};
    e.guard();
    const render = () => {
        e.api.renderizarResultadoServicios(card,data,revision,elegidos,'');
        e.c.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4.completarRecibo(card,data,elegidos);
    };
    const grupos = () => card.querySelectorAll('.haku-libro-resultado-sites__incorporados');
    const grupo = kind => grupos().find(g=>g.dataset.tipo===kind);
    const filas = kind => grupo(kind).querySelectorAll('.haku-libro-resultado-sites__fila');
    return {e,card,nota,servicio,anterior,omitida,noElegida,revision,elegidos,data,render,grupos,grupo,filas};
}

test('Servicios y notas nuevos se muestran en apartados separados, abiertos y antes del historial',()=>{
    const h=caso();h.render();
    assert.deepEqual(h.grupos().map(g=>g.dataset.tipo),['servicio','nota']);
    assert.equal(h.grupo('servicio').tag,'section');assert.equal(h.grupo('nota').tag,'section');
    assert.equal(h.grupo('servicio').querySelector('h3').textContent,'Servicios incorporados');
    assert.equal(h.grupo('nota').querySelector('h3').textContent,'Notas incorporadas');
    assert.equal(h.filas('servicio').length,1);assert.equal(h.filas('nota').length,1);
    assert.match(h.grupo('servicio').textContent,/CAB 2 · Huésped Servicio · Tinaja Tonel de Madera/);
    assert.match(h.grupo('servicio').textContent,/2026-10-17.*19:15–20:15.*Cantidad: 1.*Cortesía/);
    assert.match(h.grupo('nota').textContent,/CAB 8 · Huésped Nota · Nota de la reserva/);
    assert.match(h.grupo('nota').textContent,/Agregar cuna en el alojamiento\.\nBebé de 1 año\./);
    assert.doesNotMatch(h.grupo('nota').textContent,/Texto anterior/);
    assert.doesNotMatch(h.grupo('servicio').textContent,/Huésped Nota|Huésped Anterior|Huésped Omitido/);
    assert.doesNotMatch(h.grupo('nota').textContent,/Huésped Servicio|Huésped Anterior|Huésped Omitido|Huésped No Elegido/);
    const tarjeta=h.card.querySelector('.haku-libro-resultado-sites__tarjeta');
    assert.equal(tarjeta.children[1].className,'haku-libro-resultado-sites__metricas');
    assert.equal(tarjeta.children[2],h.grupo('servicio'));assert.equal(tarjeta.children[3],h.grupo('nota'));
    assert.equal(tarjeta.children[4].className,'haku-libro-resultado-sites__detalle');
    assert.equal(tarjeta.children[4].querySelectorAll('.haku-libro-resultado-sites__fila').length,5);
    assert.equal(h.card.querySelectorAll('input').length,0,'recibo sin controles para volver a incorporar');
    assert.equal(h.e.state.escrituras.length,0);
});

test('Caso de captura: cero servicios y una nota muestra inmediatamente la nota exacta',()=>{
    const h=caso();h.data.servicios=[];h.data.servicios_creados=0;h.data.notas_omitidas=0;
    h.data.notas=h.data.notas.slice(0,1);h.elegidos.splice(0,2);h.render();
    assert.equal(h.filas('servicio').length,0);assert.equal(h.filas('nota').length,1);
    assert.match(h.grupo('servicio').textContent,/No se incorporaron servicios en esta operación/);
    assert.match(h.grupo('nota').textContent,/Agregar cuna/);
});

test('Sólo servicios no agrega las notas antiguas a Notas incorporadas',()=>{
    const h=caso();h.data.notas=[];h.data.notas_creadas=0;h.data.notas_omitidas=0;h.render();
    assert.equal(h.filas('servicio').length,1);assert.equal(h.filas('nota').length,0);
    assert.match(h.grupo('nota').textContent,/No se incorporaron notas en esta operación/);
});

test('Una omisión por concurrencia no se presenta como recién incorporada',()=>{
    const h=caso();h.data.servicios[0].estado='ya_importado';h.data.servicios_creados=0;h.data.servicios_omitidos=1;
    h.data.notas[0].estado='ya_importada';h.data.notas_creadas=0;h.data.notas_omitidas=2;h.render();
    assert.equal(h.filas('servicio').length,0);assert.equal(h.filas('nota').length,0);
    assert.match(h.card.querySelector('.haku-libro-resultado-sites__detalle').textContent,/Ya incorporado · omitido/);
    assert.deepEqual(h.card.querySelector('.haku-libro-resultado-sites__metricas').children.map(x=>x.children[1].textContent),['0','0','3']);
});

for(const casoDe of ['sin-detalle','id-ajeno','tipo-equivocado','duplicado','omitida-y-creada','total-incoherente','sin-id','reserva-distinta','estadia-distinta','sin-seleccion','no-listo'])
    test('No inventa detalle de nota recién creada ante '+casoDe,()=>{
        const h=caso();
        if(casoDe==='sin-detalle')h.data.notas=[];
        if(casoDe==='id-ajeno')h.data.notas[0].item_id='ajeno';
        if(casoDe==='tipo-equivocado')h.data.notas[0].item_id=h.servicio.item_id;
        if(casoDe==='duplicado')h.data.notas.push({...h.data.notas[0]});
        if(casoDe==='omitida-y-creada')h.data.notas.push({...h.data.notas[0],estado:'ya_importada'});
        if(casoDe==='total-incoherente')h.data.notas_creadas=2;
        if(casoDe==='sin-id')delete h.data.notas[0].item_id;
        if(casoDe==='reserva-distinta')h.data.notas[0].reserva_id='otra';
        if(casoDe==='estadia-distinta')h.data.notas[0].estadia_id='otra';
        if(casoDe==='sin-seleccion')h.elegidos.pop();
        if(casoDe==='no-listo')h.nota.estado='existente';
        h.render();assert.equal(h.filas('nota').length,0);
        assert.match(h.grupo('nota').textContent,/no se pudo identificar con seguridad el detalle/);
        assert.doesNotMatch(h.grupo('nota').textContent,/Huésped Nota/);
        assert.equal(h.e.state.escrituras.length,0);
    });

test('El orden del RPC se cruza por identificador y no por posición del historial',()=>{
    const h=caso();h.data.notas.reverse();h.render();assert.equal(h.filas('nota')[0].dataset.itemId,h.nota.item_id);
});

test('Los textos se insertan como texto, sin HTML ejecutable y sin truncar notas',()=>{
    const h=caso(),texto='<img src=x onerror=alert(1)>\n'+ 'Detalle de la nota. '.repeat(100);
    h.nota.payload.texto=texto;h.render();
    assert.equal(h.grupo('nota').querySelector('.haku-libro-resultado-sites__texto-incorporado').textContent,texto);
    assert.equal(h.grupo('nota').querySelectorAll('img').length,0);
});

test('Renderizar la confirmación no muta selección, respuesta, notas, servicios ni controles del historial',()=>{
    const h=caso(),antes=JSON.stringify([h.data,h.revision,h.elegidos]);h.render();h.render();
    assert.equal(JSON.stringify([h.data,h.revision,h.elegidos]),antes);
    assert.equal(h.grupos().length,2);assert.equal(h.card.querySelectorAll('.haku-libro-resultado-sites__detalle').length,1);
    assert.equal(h.e.state.escrituras.length,0);
});

test('Sin confirmación del servidor no se anuncia detalle nuevo',()=>{
    const h=caso();h.data.ok=false;assert.throws(h.render,/no confirmó/);assert.equal(h.card.children.length,0);
});

test('La guardia real entrega al recibo sólo las notas y servicios enviados en esta operación',async()=>{
    const h=caso(),{e,card}=h; e.document.card=card;
    card.className='haku-libro-servicios';card.dataset.haikuHistorialRestaurado='0';
    const est=e.state.db.reserva_estadias[0];
    h.nota.payload.reserva_id=est.reserva_id;h.nota.payload.estadia_id=est.id;
    h.nota.asociacion={sistema:est};
    const fakeApi={esConsultaServicios:()=>true,construir:async()=>({items:[h.nota,h.anterior]}),
        renderizarResultadoServicios:e.api.renderizarResultadoServicios};
    e.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2=fakeApi;
    const check=new e.Element('input');check.type='checkbox';check.checked=true;check.disabled=false;check.dataset.hakuItemId=h.nota.item_id;
    const boton=new e.Element('button');boton.disabled=false;boton.className='haku-libro-servicios__boton';boton.dataset.hakuAccion='incorporar';
    const prev=new e.Element('div');prev.className='haiku-asistente-mensaje--usuario';prev.textContent='Libro servicios de octubre 2026';
    card.previousElementSibling=prev;card.append(check,boton);
    e.c.haikuSupabase.rpc=async(n,a)=>{e.state.escrituras.push({n,a});return {data:{ok:true,
        servicios_creados:0,notas_creadas:1,servicios_omitidos:0,notas_omitidas:0,servicios:[],
        notas:[{item_id:a.p_notas[0].item_id,nota_id:'nota-test',estado:'creada'}]}}};
    e.guard();
    const listeners=e.captures.filter(([tipo])=>tipo==='click');
    for(const [,fn] of listeners)fn({target:boton,preventDefault(){},stopImmediatePropagation(){}});
    await new Promise(r=>setTimeout(r,80));
    assert.equal(e.state.escrituras.length,1);assert.equal(e.state.escrituras[0].a.p_servicios.length,0);
    assert.equal(e.state.escrituras[0].a.p_notas.length,1);assert.equal(h.filas('nota').length,1);
    assert.match(h.grupo('nota').textContent,/Agregar cuna/);assert.doesNotMatch(h.grupo('nota').textContent,/Huésped Anterior/);
});
