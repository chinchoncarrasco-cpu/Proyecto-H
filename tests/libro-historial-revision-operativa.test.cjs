const test=require('node:test'),assert=require('node:assert/strict');
const {entorno}=require('./fixtures/libro-servicio-manual.cjs');
function caso(){
    const e=entorno(),r=e.state.reservas[0];
    r.texto_original='PROMO HAIKU // 18hrs jacuzzi // DEJAR BATAS';
    r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios('18hrs jacuzzi',{origen_campo:'notas_reserva'});
    r.pagos=[];r.pagos_sin_asociacion=[];e.state.db.pagos=[];e.state.db.vista_estado_cargos=[];
    e.c.haikuTienePermiso=p=>p==='pagos.ver';
    const out=new e.Element('div');e.document.card=out;
    const abrir=(extra={})=>e.api.abrirRevisionHistorial(out,{reservas:[{...r,texto_original:'Evidencia antigua',servicios:[]}],generacion:1,...extra});
    return {...e,r,out,abrir};
}
test('auditoría focal usa el Libro actual, conserva la promo y excluye las otras fichas del mismo mes',async()=>{
    const e=caso(),plan=await e.abrir();
    assert.equal(plan.reservas.length,1);assert.equal(plan.reservas[0].titular,e.r.titular);
    const servicio=plan.items.find(x=>x.kind==='servicio');assert.equal(servicio.hora,'18:00');assert.equal(servicio.estado,'listo');
    assert.equal(servicio.payload.tipo_cobro,'cortesia');assert.equal(servicio.promocion.descuento_porcentaje,10);
    assert.ok(plan.items.every(x=>x.reserva.titular===e.r.titular));assert.ok(e.api.consultaVista(e.out));
    assert.equal(e.state.escrituras.length,0);assert.equal(e.state.llamadas.length,0);
});
test('registros históricos repetidos abren una sola ficha y una sola prestación',async()=>{
    const e=caso(),plan=await e.abrir({reservas:[e.r,{...e.r}]});
    assert.equal(plan.reservas.length,1);assert.equal(plan.items.filter(x=>x.kind==='servicio').length,1);
});
test('revalidación del guard mantiene el alcance focal y detecta lo ya incorporado',async()=>{
    const e=caso();await e.abrir();const est=e.state.db.reserva_estadias[0];
    e.state.db.servicios.push({id:'ya-creado',reserva_id:est.reserva_id,estadia_id:est.id,
        fecha_servicio:e.r.fecha_checkin,hora_inicio:'18:00',hora_fin:'19:00',personas:2,cantidad:1,
        tipo_cobro:'cortesia',total:0,estado_servicio:'programado',catalogo_servicios:{codigo:'tinajaJacuzzi',nombre:'Jacuzzi'}});
    const plan=await e.api.revalidarVista(e.out,'');
    assert.equal(plan.reservas.length,1);assert.equal(plan.items.find(x=>x.kind==='servicio').estado,'existente');
    assert.equal(e.state.escrituras.length,0);
});
test('cambios de generación o fichas duplicadas/ausentes bloquean la auditoría antes de incorporar',async()=>{
    for(const modo of ['generacion','duplicada','ausente']){
        const e=caso(),seleccion={...e.r};
        if(modo==='generacion')e.state.generacion=2;
        if(modo==='duplicada')e.state.reservas.push({...e.r});
        if(modo==='ausente')e.r.fecha_checkin='2026-10-09';
        await assert.rejects(e.abrir({reservas:[seleccion]}),/Libro cambió|no es única/);
        assert.equal(e.state.escrituras.length,0);
    }
});
test('confirmación del flujo focal funciona sin una consulta de servicios anterior y conserva el writer existente',async()=>{
    const e=caso();await e.abrir();e.guard();
    const boton=e.out.querySelectorAll('button').find(x=>x.dataset.hakuAccion==='incorporar');
    const ev={target:boton,preventDefault(){},stopImmediatePropagation(){}};
    e.captures.filter(([t])=>t==='click').forEach(([,fn])=>fn(ev));
    await new Promise(r=>setTimeout(r,30));
    assert.equal(e.state.escrituras.length,1);const payload=e.state.escrituras[0];
    assert.equal(payload.p_servicios.length,1);assert.equal(payload.p_servicios[0].tipo_cobro,'cortesia');
    assert.ok(payload.p_notas.every(n=>n.reserva_id===e.state.db.reservas[0].id));
});
test('Tinaja CORTESIA sin agenda desde Notas es una nota preparable, sin crear prestación ni cargo',async()=>{
    const e=caso();e.r.texto_original='Tinaja CORTESIA';e.r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(e.r.texto_original,{origen_campo:'notas_reserva'});
    const plan=await e.abrir();assert.equal(plan.items.filter(x=>x.kind==='servicio').length,0);
    assert.ok(plan.items.some(x=>x.kind==='nota'&&x.texto==='Tinaja CORTESIA'&&x.estado==='listo'));
    assert.equal(e.state.escrituras.length,0);
});
test('la compensación por TV y el único Jacuzzi con horario forman una sola cortesía; sólo queda definir el día',async()=>{
    const e=caso();e.r.noches=2;e.r.fecha_checkout='2026-10-12';e.state.db.reserva_estadias[0].fecha_salida=e.r.fecha_checkout;
    e.r.texto_original='tinaja x cortesia por tv malo // JACUZZI 16:15';
    e.r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(e.r.texto_original,{origen_campo:'notas_reserva'});
    const plan=await e.abrir(),servicios=plan.items.filter(x=>x.kind==='servicio');assert.equal(servicios.length,1);
    assert.equal(servicios[0].intencion_cobro,'cortesia');assert.equal(servicios[0].mapa.codigo,'tinajaJacuzzi');
    assert.match(servicios[0].razones.join(' '),/fecha/i);assert.doesNotMatch(servicios[0].razones.join(' '),/definir si.*cobrable|equivalencia segura/);
    assert.equal(e.state.escrituras.length,0);
});
test('la compensación no regala un rango de tres horas ni decide entre dos horarios',async()=>{
    for(const texto of ['tinaja x cortesia por tv malo // JACUZZI 16:15 A 19:15',
        'tinaja x cortesia por tv malo // JACUZZI 16:15 // TONEL 19:15']){
        const e=caso();e.r.texto_original=texto;e.r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto,{origen_campo:'notas_reserva'});
        const plan=await e.abrir();assert.ok(plan.items.filter(x=>x.kind==='servicio').length>=2);
        assert.equal(e.state.escrituras.length,0);
    }
});
