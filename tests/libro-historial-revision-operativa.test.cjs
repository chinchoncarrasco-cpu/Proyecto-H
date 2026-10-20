const test=require('node:test'),assert=require('node:assert/strict');
const {entorno,read}=require('./fixtures/libro-servicio-manual.cjs');
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
test('el historial antiguo de cuna se reconoce como la nota ya incorporada y deja de estar pendiente',async()=>{
    const e=caso(),r=e.r,est=e.state.db.reserva_estadias[0],texto='AGREGAR CUNA EN EL ALOJAMIENTO BEBE DE 1 AÑO';
    r.texto_original=texto;r.servicios=[{concepto:'cuna',texto_original:texto,semantica:'AMBIGUO',origen_campo:'notas_reserva',pendiente:false}];
    e.state.db.notas=[{id:'nota-cuna',reserva_id:est.reserva_id,tipo:'operativa_resumen',texto}];
    const plan=await e.api.compararReservas([r],{desde:r.fecha_checkin,hasta:r.fecha_checkout});
    assert.equal(plan.items.filter(x=>x.kind==='servicio').length,0);
    assert.equal(plan.items.filter(x=>x.kind==='nota'&&x.texto===texto&&x.estado==='existente').length,1);
    for(const s of e.state.db.reserva_estadias){s.cabanas=e.state.db.cabanas.find(c=>c.id===s.cabana_id);s.reservas=e.state.db.reservas.find(x=>x.id===s.reserva_id);}
    const from=e.c.haikuSupabase.from;e.c.haikuSupabase.from=n=>{const q=from(n);q.order=()=>q;q.range=(a,z)=>Promise.resolve(q).then(x=>({...x,data:x.data.slice(a,z+1)}));return q;};
    e.c.haikuSupabase.auth.getSession=async()=>({data:{session:{user:{id:e.state.usuario}}}});
    e.document.querySelector=()=>null;
    e.c.structuredClone=structuredClone;
    require('node:vm').runInContext(read('js/haiku-libro-consultas-v1.js'),e.c);
    const registro={id:'cuna-historica',tipo:'modificacion',actual:r,anterior:{...r,servicios:[]},cambios:[{campo:'servicios',antes:[],ahora:r.servicios}]};
    const resultado=await e.c.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],e.c.haikuSupabase,{generacion:1});
    assert.equal(resultado.items.length,0);assert.equal(resultado.resueltos[0],registro.id);assert.equal(e.state.escrituras.length,0);
});
test('la corrección de cuna no convierte un servicio estructurado o con cobro en nota',async()=>{
    for(const extra of [{origen_campo:'servicios'},{monto:10000},{intencion_cobro:'cobrable'}]){
        const e=caso();e.r.texto_original='AGREGAR CUNA';
        e.r.servicios=[{concepto:'cuna',texto_original:e.r.texto_original,semantica:'AMBIGUO',origen_campo:'notas_reserva',...extra}];
        const plan=await e.api.compararReservas([e.r],{desde:e.r.fecha_checkin,hasta:e.r.fecha_checkout});
        assert.ok(plan.items.some(x=>x.kind==='servicio'&&x.estado==='revisar'));assert.equal(e.state.escrituras.length,0);
    }
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

test('el bloque de tinaja y batas del 24 conserva aparte la tinaja ya registrada del 25',async()=>{
    const e=caso(),r=e.r,est=e.state.db.reserva_estadias[0];
    r.fecha_checkin='2026-09-24';r.fecha_checkout='2026-09-26';r.noches=2;
    est.fecha_ingreso=r.fecha_checkin;est.fecha_salida=r.fecha_checkout;
    r.texto_original='PROMO HAIKU // Huésped de prueba // 2adl // 2noches // CA // 24-09-26 // WALKIN // '+
        'JACUZZI A LAS 20 HRS; BATAS OK 24-09 // ESPUMANTE + CHOCOLATES X ANIVERSARIO // '+
        'JACUZZI A LAS 19,15 HRS VIERNES 25-09 PAGADA';
    r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
    e.state.db.servicios=[{id:'tinaja-del-25',reserva_id:est.reserva_id,estadia_id:est.id,
        fecha_servicio:'2026-09-25',hora_inicio:'19:15',hora_fin:'20:15',personas:2,cantidad:1,
        tipo_cobro:'normal',total:30000,estado_servicio:'programado',catalogo_servicios:{codigo:'tinajaJacuzzi',nombre:'Jacuzzi'}}];
    const antes=JSON.stringify(e.state.db);
    const plan=await e.api.compararReservas([r],{desde:'2026-09-01',hasta:'2026-09-30'});
    const servicios=plan.items.filter(x=>x.kind==='servicio');assert.equal(servicios.length,2);
    const primera=servicios.find(x=>x.hora==='20:00'),segunda=servicios.find(x=>x.hora==='19:15');
    assert.equal(primera.fecha,'2026-09-24');assert.equal(primera.proveniencia.fecha,'INFERIDA_SEGURA');
    assert.ok(primera.inferencias.some(x=>/BATAS OK 24-09/.test(x)));
    assert.ok(!primera.razones.some(x=>/fecha inequívoca/.test(x)));
    assert.equal(segunda.fecha,'2026-09-25');assert.equal(segunda.estado,'existente');
    assert.equal(segunda.servicio_existente.id,'tinaja-del-25');
    assert.equal(JSON.stringify(e.state.db),antes);assert.equal(e.state.escrituras.length,0);
});
