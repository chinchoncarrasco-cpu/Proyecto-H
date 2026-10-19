const test = require('node:test'), assert = require('node:assert/strict');
const {entorno,consulta} = require('./fixtures/libro-servicio-manual.cjs');

function casoHorario() {
    const e=entorno(), r=e.state.reservas[0], est=e.state.db.reserva_estadias[0];
    r.tipo_estadia='full_day';r.fecha_checkout=r.fecha_checkin;r.noches=0;
    r.texto_original='FULLDAY // 2adl // 18hrs jacuzzi';
    r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios('18hrs jacuzzi',{origen_campo:'notas_reserva'});
    est.tipo_estadia='fullday';est.fecha_salida=est.fecha_ingreso;
    e.c.haikuTienePermiso=p=>['pagos.ver','servicios.editar'].includes(p);
    e.state.db.pagos=[{id:'pago-paquete',reserva_id:est.reserva_id,monto:120000,
        tipo_movimiento:'pago',estado:'confirmado',observaciones:'FULLDAY // 120,000'}];
    e.state.db.vista_estado_cargos=[];
    e.state.db.servicios=[{id:'tinaja-existente',reserva_id:est.reserva_id,estadia_id:est.id,
        catalogo_servicio_id:e.state.db.catalogo_servicios.find(c=>c.codigo==='tinajaJacuzzi').id,
        fecha_servicio:r.fecha_checkin,hora_inicio:'17:00:00',hora_fin:'18:00:00',
        cantidad:1,personas:2,tipo_cobro:'cortesia',total:0,estado_servicio:'programado',
        actualizado_en:'2026-10-16T18:24:30+00:00',catalogo_servicios:{codigo:'tinajaJacuzzi',nombre:'Tinaja Jacuzzi'}}];
    return e;
}
const tinaja=r=>r.items.find(i=>i.servicio?.concepto==='jacuzzi');
async function abrir(e) {
    const out=new e.Element('div');e.document.card=out;
    e.api.renderizar(await e.construir(),out,consulta);
    const boton=out.querySelectorAll('button').find(b=>b.textContent==='Revisar horario');
    assert.ok(boton);await boton.listeners.click();
    return {out,panel:out.querySelector('.haku-libro-servicio-manual'),
        confirmar:out.querySelectorAll('button').find(b=>b.dataset.hakuAccion==='confirmar-cambio-horario')};
}
function rpcHorario(e,{perderRespuesta=false}={}) {
    const llamadas=[], respuestas=new Map();
    e.c.haikuSupabase.rpc=async(nombre,args)=>{
        llamadas.push({nombre,args:JSON.parse(JSON.stringify(args))});
        assert.equal(nombre,'haiku_libro_reprogramar_tinaja_fullday_v1');
        if (respuestas.has(args.p_operacion_id)) return {data:respuestas.get(args.p_operacion_id)};
        const s=e.state.db.servicios.find(s=>s.id===args.p_servicio_id);
        assert.equal(args.p_estado_esperado.hora_inicio,s.hora_inicio);
        s.hora_inicio=args.p_hora_inicio+':00';s.hora_fin=args.p_hora_fin+':00';
        s.actualizado_en='2026-10-19T22:00:00+00:00';
        const data={ok:true,servicio_id:s.id,tipo_cobro:s.tipo_cobro,total:s.total,
            hora_inicio:s.hora_inicio,hora_fin:s.hora_fin};
        respuestas.set(args.p_operacion_id,data);
        if (perderRespuesta) throw Error('Respuesta de red perdida');
        return {data};
    };
    return llamadas;
}

test('Full Day: la cortesía con otra hora pide revisar el horario, conserva $0 y bloquea una nueva incorporación',async()=>{
    const e=casoHorario(),antes=JSON.stringify(e.state),i=tinaja(await e.construir());
    assert.equal(i.estado,'revisar');assert.equal(i.intencion_cobro,'cortesia');
    assert.equal(i.payload,null);assert.equal(i.cambioHorarioExistente.servicioId,'tinaja-existente');
    assert.match(i.razones.join(' '),/17:00–18:00.*18:00–19:00.*modificó el horario/);
    assert.doesNotMatch(i.razones.join(' '),/definir si el servicio es cobrable/);
    assert.equal(JSON.stringify(e.state),antes);
    await assert.rejects(e.api.confirmarServicioManual(consulta,i.item_id,{tipo_cobro:'normal'},e.manuales,i.firmaManual),/Revisar horario/);
    assert.equal(e.state.escrituras.length,0);
});

test('el mismo marcador de origen tampoco acepta silenciosamente el horario distinto',async()=>{
    const e=casoHorario(),i=tinaja(await e.construir());
    e.state.db.servicios[0].observaciones=`[HAKU-LIBRO-SERVICIO:${i.item_id}]`;
    const actual=tinaja(await e.construir());assert.equal(actual.estado,'revisar');assert.ok(actual.cambioHorarioExistente);
});

test('no ofrece reprogramar si cambian catálogo, cantidad, personas, fecha, cobro o duración',async()=>{
    for (const cambiar of [s=>s.tipo_cobro='normal',s=>s.total=30000,s=>s.cantidad=2,
        s=>s.personas=3,s=>s.fecha_servicio='2026-10-11',s=>s.estado_servicio='realizado',
        s=>s.hora_fin='19:00:00',s=>s.catalogo_servicios.codigo='tinajaTonel']) {
        const e=casoHorario();cambiar(e.state.db.servicios[0]);
        assert.equal(tinaja(await e.construir()).cambioHorarioExistente,undefined);
    }
    for (const cambiar of [e=>e.state.reservas[0].tipo_estadia='alojamiento',
        e=>e.state.db.servicios.push({...e.state.db.servicios[0],id:'segunda-tinaja'}),
        e=>e.state.db.pagos.push({id:'extra',reserva_id:e.state.db.reservas[0].id,monto:30000,
            tipo_movimiento:'pago',estado:'confirmado',observaciones:'Pago adicional jacuzzi'})]) {
        const e=casoHorario();cambiar(e);assert.equal(tinaja(await e.construir()).cambioHorarioExistente,undefined);
    }
});

test('sin tinaja conserva primera hora incluida; con el mismo horario reconoce la cortesía existente',async()=>{
    const e=casoHorario(),s=e.state.db.servicios[0];
    s.hora_inicio='18:00:00';s.hora_fin='19:00:00';
    assert.equal(tinaja(await e.construir()).estado,'existente');
    e.state.db.servicios=[];const nuevo=tinaja(await e.construir());
    assert.equal(nuevo.estado,'listo');assert.equal(nuevo.payload.tipo_cobro,'cortesia');
});

test('el panel pregunta por reprogramación y permite posponer sin pedir cobro ni escribir',async()=>{
    const e=casoHorario(),{out,panel}=await abrir(e);
    assert.match(panel.textContent,/¿Se modificó el horario de esta misma tinaja\?/);
    assert.match(panel.textContent,/17:00–18:00/);assert.match(panel.textContent,/18:00–19:00/);
    assert.match(panel.textContent,/total \$0/);assert.equal(panel.querySelectorAll('input,select').length,0);
    panel.querySelectorAll('button').find(b=>b.textContent==='Revisar después').listeners.click();
    assert.equal(out.querySelector('.haku-libro-servicio-manual'),null);assert.equal(e.state.escrituras.length,0);
});

test('confirmar dos veces actualiza sólo el horario del mismo servicio y después lo reconoce existente',async()=>{
    const e=casoHorario(),llamadas=rpcHorario(e),antes=JSON.parse(JSON.stringify(e.state.db));
    const {out,confirmar}=await abrir(e);
    await Promise.all([confirmar.listeners.click(),confirmar.listeners.click()]);
    assert.equal(llamadas.length,1);assert.equal(e.state.db.servicios.length,1);
    const s=e.state.db.servicios[0];assert.equal(s.id,'tinaja-existente');
    assert.equal(s.hora_inicio,'18:00:00');assert.equal(s.hora_fin,'19:00:00');
    for (const key of Object.keys(s).filter(k=>!['hora_inicio','hora_fin','actualizado_en'].includes(k)))
        assert.deepEqual(s[key],antes.servicios[0][key],key);
    assert.deepEqual(e.state.db.pagos,antes.pagos);assert.equal(e.state.escrituras.length,0);
    assert.equal(tinaja(await e.construir()).estado,'existente');assert.doesNotMatch(out.textContent,/cobro por definir/);
});

test('una revisión obsoleta por cambio del Libro o del servicio no llama la escritura',async()=>{
    for (const tipo of ['libro','servicio']) {
        const e=casoHorario(),llamadas=rpcHorario(e),{panel,confirmar}=await abrir(e);
        if(tipo==='libro')e.state.generacion++;
        else e.state.db.servicios[0].actualizado_en='2026-10-19T23:00:00+00:00';
        await confirmar.listeners.click();assert.equal(llamadas.length,0,tipo);
        assert.match(panel.textContent,/vuelve a abrir la revisión/);assert.equal(e.state.db.servicios[0].hora_inicio,'17:00:00');
    }
});

test('respuesta perdida: el reintento conserva operación y solicitud; no crea otra tinaja',async()=>{
    const e=casoHorario(),llamadas=rpcHorario(e,{perderRespuesta:true}),{panel,confirmar}=await abrir(e);
    await confirmar.listeners.click();assert.match(panel.textContent,/Respuesta de red perdida/);
    await confirmar.listeners.click();assert.equal(llamadas.length,2);
    assert.deepEqual(llamadas[0],llamadas[1]);assert.equal(e.state.db.servicios.length,1);
    assert.equal(tinaja(await e.construir()).estado,'existente');
});

test('sin permiso de edición muestra la comparación y mantiene la confirmación deshabilitada',async()=>{
    const e=casoHorario();e.c.haikuTienePermiso=p=>p==='pagos.ver';
    const {panel,confirmar}=await abrir(e);assert.equal(confirmar.disabled,true);
    assert.match(panel.textContent,/permiso para editar servicios/);assert.equal(e.state.escrituras.length,0);
});
