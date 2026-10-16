const test = require('node:test'), assert = require('node:assert/strict');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const servicios = r => r.items.filter(i => i.kind === 'servicio');
const listos = r => servicios(r).filter(i => i.estado === 'listo');
const a = { codigo_servicio: 'tinajaTonel', hora: '18:00' }, b = { hora: '12:20' }, c = { codigo_servicio: 'masajeTerapeutico60', hora: '17:00' };
async function todos(e) { await e.resolver(0, a); await e.resolver(1, b); return e.resolver(2, c); }
test('tres glosas reales preservan duración, cobro, origen y preparación acumulativa sin escrituras', async () => {
    const e = entorno(), antes = servicios(await e.construir()).map(i => i.item_id);
    assert.equal(listos(await e.resolver(0, a)).length, 1);
    assert.equal(listos(await e.resolver(1, b)).length, 2);
    const r = await e.resolver(2, c); assert.equal(listos(r).length, 3);
    assert.deepEqual(servicios(r).map(i => i.item_id), antes);
    const [A, B, C] = servicios(r);
    assert.equal(A.payload.tipo_cobro, 'cortesia'); assert.equal(A.payload.servicio_manual_v1.resuelto.total, 0);
    assert.equal(B.payload.servicio_manual_v1.resuelto.total, 10000); assert.equal(B.hora_fin, '13:20');
    assert.equal(B.payload.precio_manual, null); assert.equal(C.servicio.duracion_minutos, 60);
    assert.equal(C.payload.codigo_servicio, 'masajeTerapeutico60'); assert.equal(C.payload.cantidad, 1);
    assert.equal(e.state.escrituras.length, 0);
});
test('revalidar y cambiar B conserva A y C; evidencia propia invalida sólo A', async () => {
    const e = entorno(); await todos(e); assert.equal(listos(await e.resolver(1, { hora: '12:45' })).length, 3);
    assert.equal(listos(await e.construir()).length, 3);
    e.state.reservas[0].servicios[0].texto_original += ' evidencia modificada';
    const r = await e.construir(); assert.equal(listos(r).length, 2); assert.equal(servicios(r)[0].estado, 'revisar');
});
test('cancelación/no_show compartido bloquea sus servicios sin invalidar otra estadía', async () => {
    for (const estado of ['cancelada', 'no_show']) {
        const e = entorno(); await todos(e); e.state.db.reserva_estadias[0].estado_estadia = estado;
        assert.equal(listos(await e.construir()).length, 1);
    }
});
test('catálogo/precio obsoleto invalida sólo decisiones que dependen de esa fila', async () => {
    const e = entorno(); await todos(e); e.state.db.catalogo_servicios.find(x => x.codigo === 'lateCheckout').precio_base++;
    const r = await e.construir(); assert.equal(listos(r).length, 2); assert.match(servicios(r)[1].razones.join(' '), /obsoleta/);
});
test('precio distinto exige decisión explícita y deriva unitario con cantidad contractual', async () => {
    const e = entorno(); e.state.reservas[0].servicios[1].texto_original = 'X PAGAR LATE OUT CLP$10,000 2 HORAS';
    assert.equal(servicios(await e.resolver(1, b))[1].estado, 'revisar');
    const B = servicios(await e.resolver(1, { ...b, precio_decision: 'libro' }))[1];
    assert.equal(B.estado, 'listo'); assert.equal(B.payload.cantidad, 2); assert.equal(B.payload.precio_manual, 5000);
    assert.equal(B.payload.servicio_manual_v1.resuelto.total, 10000);
});
test('inactivo, cortesía prohibida, capacidad y Full Day permanecen bloqueados', async () => {
    const e = entorno(); e.state.db.catalogo_servicios.find(x => x.codigo === 'tinajaTonel').activo = false;
    await assert.rejects(e.resolver(0, a), /activa/);
    for (const change of [e => e.state.db.catalogo_servicios[0].permite_cortesia = false,
        e => e.state.reservas[0].adultos = 9,
        e => { e.state.reservas[0].tipo_estadia = 'full_day'; e.state.reservas[0].fecha_checkout = '2026-10-10'; e.state.db.reserva_estadias[0].fecha_salida = '2026-10-10'; }]) {
        const e = entorno(); change(e); assert.equal(servicios(await e.resolver(0, { ...a, hora: '22:00' }))[0].estado, 'revisar');
    }
});
test('existente único se omite; múltiples y contradicción jamás autorizan un tercero', async () => {
    for (const modo of ['uno', 'varios', 'contradiccion']) {
        const e = entorno(); await e.resolver(0, a);
        const s = { id: 'existente', reserva_id: e.state.db.reservas[0].id, estadia_id: e.state.db.reserva_estadias[0].id,
            fecha_servicio: '2026-10-10', hora_inicio: '18:00', hora_fin: '19:00', personas: 2, cantidad: 1,
            tipo_cobro: modo === 'contradiccion' ? 'normal' : 'cortesia', total: modo === 'contradiccion' ? 30000 : 0,
            catalogo_servicios: { codigo: 'tinajaTonel' }, estado_servicio: 'programado' };
        e.state.db.servicios.push(s); if (modo === 'varios') e.state.db.servicios.push({ ...s, id: 'otro' });
        const A = servicios(await e.construir())[0]; assert.equal(A.estado, modo === 'uno' ? 'existente' : 'revisar'); assert.equal(A.payload, null);
    }
});
test('deselección persiste y el guard final incorpora cada seleccionado una sola vez', async () => {
    const e = entorno(), r = await todos(e), out = new e.Element('div'); e.document.card = out;
    e.api.estadosPorVista.set(out, { manuales: e.manuales, selecciones: new Map(), apertura: 0 });
    e.api.renderizar(r, out, consulta);
    const A = out.querySelectorAll('input[data-haku-item-id]')[0]; A.checked = false; A.listeners.change();
    e.api.renderizar(await e.construir(), out, consulta); assert.equal(out.querySelectorAll('input[data-haku-item-id]')[0].checked, false);
    const todosChecks = out.querySelectorAll('input[data-haku-item-id]'); todosChecks[0].checked = true; todosChecks[0].listeners.change();
    e.guard(); out.previousElementSibling = new e.Element('div'); out.previousElementSibling.className = 'haiku-asistente-mensaje--usuario'; out.previousElementSibling.textContent = consulta;
    const boton = out.querySelectorAll('button').find(x => x.dataset.hakuAccion === 'incorporar');
    const ev = { target: boton, preventDefault() {}, stopImmediatePropagation() {} };
    e.captures.filter(([t]) => t === 'click').forEach(([, fn]) => fn(ev));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(e.state.escrituras.length, 1); const payload = e.state.escrituras[0].p_servicios;
    assert.equal(payload.length, 3); assert.equal(new Set(payload.map(x => x.item_id)).size, 3);
    assert.ok(payload.every(x => x.servicio_manual_v1.usuario === e.state.usuario));
});
test('notas y AMBIGUO conservan semántica y no reciben resolución manual', async () => {
    const e = entorno(); e.state.reservas[0].texto_original += ' / Dejar batas en cabaña';
    e.state.reservas[0].servicios.push({ concepto: 'tinaja', texto_original: 'tinaja pendiente especial', semantica: 'AMBIGUO' });
    const r = await e.construir(), ambiguo = r.items.find(x => x.semantica === 'AMBIGUO');
    assert.equal(ambiguo.estado, 'revisar'); assert.equal(ambiguo.payload, null);
    await assert.rejects(e.api.confirmarServicioManual(consulta, ambiguo.item_id, a, e.manuales, ambiguo.firmaManual), /evidencia/);
    assert.ok(r.items.some(x => x.kind === 'nota' && x.estado === 'listo'));
});
test('otra glosa de la misma reserva no invalida la evidencia de A', async () => {
    const e = entorno(); await todos(e);
    e.state.reservas[0].texto_original += ' nota nueva';
    assert.equal(listos(await e.construir()).length, 3);
});
test('fecha pendiente se completa sin cambiar el origen ni los preparados anteriores', async () => {
    const e = entorno(); await e.resolver(0, a); await e.resolver(1, b);
    e.state.reservas[1].fecha_checkout = '2026-10-12'; e.state.reservas[1].noches = 2;
    e.state.db.reserva_estadias[1].fecha_salida = '2026-10-12';
    const pendiente = servicios(await e.resolver(2, c))[2]; assert.equal(pendiente.estado, 'revisar');
    const resultado = await e.resolver(2, { ...c, fecha: '2026-10-11' }); assert.equal(listos(resultado).length, 3);
    assert.equal(servicios(resultado)[2].item_id, pendiente.item_id);
});
test('ningún cambio de usuario, contrato o origen habilita decisiones ajenas/obsoletas', async () => {
    const e = entorno(); await todos(e); e.state.usuario = 'otra-sesion'; assert.equal(listos(await e.construir()).length, 0);
    e.state.contrato = false; await assert.rejects(e.construir(), /contrato/);
});
test('precio de existente contradictorio permanece en revisión aunque sea Late único', async () => {
    const e = entorno(); await e.resolver(1, b);
    e.state.db.servicios.push({ id: 'late', reserva_id: e.state.db.reservas[0].id, estadia_id: e.state.db.reserva_estadias[0].id,
        catalogo_servicios: { codigo: 'lateCheckout' }, fecha_servicio: '2026-10-11', hora_inicio: '14:00', total: 20000,
        tipo_cobro: 'normal', cantidad: 1, estado_servicio: 'programado' });
    const B = servicios(await e.construir())[1]; assert.equal(B.estado, 'revisar'); assert.equal(B.payload, null);
    assert.match(B.razones.join(' '), /precio confirmado/);
});
test('catálogo permitido no abre alimentos/cuna y tipo/duración explícitos no se sustituyen', async () => {
    const e = entorno(); await assert.rejects(e.resolver(2, { codigo_servicio: 'masajeTerapeutico30', hora: '17:00' }), /prestación/);
    await assert.rejects(e.resolver(0, { codigo_servicio: 'cuna', hora: '18:00' }), /prestación/);
});
test('personas adicionales no convierten un total escrito en precio manual del Jacuzzi', async () => {
    const e = entorno(); e.state.reservas[0].adultos = 4;
    e.state.reservas[0].servicios[0] = { ...e.state.reservas[0].servicios[0], intencion_cobro: 'cobrable',
        texto_original: 'JACUZZI X PAGAR CLP$35,000 1 HORA', concepto: 'jacuzzi', cortesia: false };
    const A = servicios(await e.resolver(0, { codigo_servicio: 'tinajaJacuzzi', hora: '18:00', precio_decision: 'libro' }))[0];
    assert.equal(A.estado, 'revisar'); assert.match(A.razones.join(' '), /precio unitario seguro/);
});
test('una evidencia invalidada no revive al reaparecer el texto anterior', async () => {
    const e = entorno(); await todos(e); const s = e.state.reservas[0].servicios[0], original = s.texto_original;
    s.texto_original += ' cambió'; await e.construir(); s.texto_original = original;
    assert.equal(listos(await e.construir()).length, 2);
    assert.equal(listos(await e.resolver(0, a)).length, 3);
});
test('importes múltiples o formato monetario inseguro no se convierten en precio automático', async () => {
    for (const precio of ['CLP$10,00', 'CLP$10,000 CLP$20,000', 'USD$10,000']) {
        const e = entorno(); e.state.reservas[0].servicios[1].texto_original = `X PAGAR LATE OUT ${precio} 1 HORA`;
        const original = servicios(await e.construir())[1];
        const B = servicios(await e.resolver(1, { hora: original.hora || b.hora }))[1]; assert.equal(B.estado, 'revisar'); assert.equal(B.payload, null);
        assert.match(B.razones.join(' '), /CLP inequívoco/);
    }
});
test('Jacuzzi con seis participantes y duración horaria incompatible siguen bloqueados', async () => {
    const e = entorno(); e.state.reservas[0].adultos = 6;
    const A = servicios(await e.resolver(0, { codigo_servicio: 'tinajaJacuzzi', hora: '18:00' }))[0];
    assert.equal(A.estado, 'revisar'); assert.match(A.razones.join(' '), /personas|capacidad/);
    const h = entorno(); h.state.db.catalogo_servicios.find(x => x.codigo === 'lateCheckout').duracion_minutos = 30;
    const B = servicios(await h.resolver(1, b))[1]; assert.equal(B.estado, 'revisar'); assert.match(B.razones.join(' '), /horas contratadas/);
});

test('mismo precio no oculta contradicciones de cantidad, personas y horario del existente', async () => {
    for (const cambio of [{ cantidad: 2 }, { personas: 1 }, { hora_fin: '19:30' }, { fecha_servicio: '2026-10-11' }, { hora_inicio: '17:00' }]) {
        const e = entorno(), A = servicios(await e.resolver(0, a))[0];
        e.state.db.servicios.push({ id: 'existente', reserva_id: A.payload.reserva_id, estadia_id: A.payload.estadia_id,
            catalogo_servicios: { codigo: 'tinajaTonel' }, fecha_servicio: A.fecha, hora_inicio: A.hora, hora_fin: A.hora_fin,
            cantidad: 1, personas: A.personas, tipo_cobro: 'cortesia', total: 0, estado_servicio: 'programado',
            observaciones: `[HAKU-LIBRO-SERVICIO:${A.item_id}]`, ...cambio });
        const actual = servicios(await e.construir())[0]; assert.equal(actual.estado, 'revisar'); assert.equal(actual.payload, null);
    }
    const e = entorno(), A = servicios(await e.resolver(0, a))[0];
    e.state.db.servicios.push({ id: 'existente', reserva_id: A.payload.reserva_id, estadia_id: A.payload.estadia_id,
        catalogo_servicios: { codigo: 'tinajaTonel' }, fecha_servicio: A.fecha, hora_inicio: A.hora, hora_fin: A.hora_fin,
        cantidad: 2, personas: A.personas, tipo_cobro: 'cortesia', total: 0, estado_servicio: 'programado' });
    assert.equal(servicios(await e.construir())[0].estado, 'revisar');
});

test('Late manual con fecha o horario existente distinto queda bloqueado aunque coincida el cobro', async () => {
    for (const conMarca of [false, true]) {
        for (const cambio of [{ hora_inicio: '14:00', hora_fin: '15:00' }, { fecha_servicio: '2026-10-10' },
            { hora_fin: '13:45' }, { hora_inicio: '12:20:01' }, { hora_fin: '13:20:01' }]) {
            const e = entorno(); await todos(e); const B = servicios(await e.construir())[1];
            e.state.db.servicios.push({ id: 'late-existente', reserva_id: B.payload.reserva_id, estadia_id: B.payload.estadia_id,
                catalogo_servicios: { codigo: 'lateCheckout' }, fecha_servicio: B.fecha, hora_inicio: B.hora, hora_fin: B.hora_fin,
                cantidad: B.payload.cantidad, personas: 0, tipo_cobro: B.payload.tipo_cobro, total: B.precio.total,
                estado_servicio: 'programado', observaciones: conMarca ? `[HAKU-LIBRO-SERVICIO:${B.item_id}]` : '', ...cambio });
            const actual = await e.construir(), bloqueado = servicios(actual)[1];
            assert.equal(bloqueado.estado, 'revisar'); assert.equal(bloqueado.payload, null);
            assert.match(bloqueado.razones.join(' '), /contradice/); assert.equal(listos(actual).length, 2);
            assert.equal(e.state.escrituras.length, 0);
        }
    }
});

test('Late manual omite existente con checkout e inicio/término exactos sin exigir personas', async () => {
    for (const conMarca of [false, true]) {
        const e = entorno(); await todos(e); const B = servicios(await e.construir())[1];
        e.state.db.servicios.push({ id: 'late-compatible', reserva_id: B.payload.reserva_id, estadia_id: B.payload.estadia_id,
            catalogo_servicios: { codigo: 'lateCheckout' }, fecha_servicio: B.fecha, hora_inicio: '12:20:00', hora_fin: '13:20:00',
            cantidad: B.payload.cantidad, personas: 3, tipo_cobro: B.payload.tipo_cobro, total: B.precio.total,
            estado_servicio: 'programado', observaciones: conMarca ? `[HAKU-LIBRO-SERVICIO:${B.item_id}]` : '' });
        const actual = await e.construir(), omitido = servicios(actual)[1];
        assert.equal(omitido.estado, 'existente'); assert.equal(omitido.payload, null);
        assert.equal(omitido.servicio_existente.id, 'late-compatible'); assert.equal(omitido.fecha, e.state.reservas[0].fecha_checkout);
        assert.equal(listos(actual).length, 2); assert.equal(e.state.escrituras.length, 0);
    }
});


async function escenarioCortesiaExistente() {
    const e = entorno(), r = e.state.reservas[0];
    r.servicios[0] = e.c.HAIKU_LIBRO_SEMANTICA.servicios(
        '1 HORA DE CORTESIA TINAJA TONEL DE MADERA 18:00 A 19:00',
        { origen_campo:'notas_reserva' })[0];
    e.state.db.servicios.push({
        id:'tinaja-unica',reserva_id:e.state.db.reservas[0].id,
        estadia_id:e.state.db.reserva_estadias[0].id,
        fecha_servicio:'2026-10-10',hora_inicio:'18:00:00',hora_fin:'19:00:00',
        cantidad:1,personas:2,tipo_cobro:'normal',total:30000,
        estado_servicio:'programado',catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tonel de madera'}
    });
    return e;
}

test('Ana: aprobación manual identifica misma tinaja, sólo contradicción tipo_cobro, sin preparar otra',async()=>{
    const e=await escenarioCortesiaExistente(),r=await e.construir(),item=servicios(r)[0];
    assert.equal(item.estado,'revisar');assert.equal(item.payload,null);
    assert.deepEqual(Array.from(item.razones),['El servicio existente contradice datos explícitos del Libro: tipo_cobro.']);
    assert.equal(item.cambioCortesiaExistente?.servicioId,'tinaja-unica');
    assert.equal(item.cambioCortesiaExistente.total,30000);
    assert.equal(item.cambioCortesiaExistente.codigo,'tinajaTonel');
    assert.equal(item.cambioCortesiaExistente.hora,'18:00');
    assert.equal(item.cambioCortesiaExistente.fin,'19:00');
    assert.equal(e.state.escrituras.length,0,'la comparación no cambia dinero ni servicios');
});

test('otras diferencias, múltiples candidatos o cobro ya correcto no ofrecen conversión manual',async()=>{
    for(const tipo of ['hora_fin','cantidad','personas','varios','ya_cortesia','libro_cobrable']){
        const e=await escenarioCortesiaExistente(),s=e.state.db.servicios[0];
        if(tipo==='hora_fin')s.hora_fin='19:30:00';
        if(tipo==='cantidad')s.cantidad=2;
        if(tipo==='personas')s.personas=3;
        if(tipo==='varios')e.state.db.servicios.push({...s,id:'segunda-tinaja'});
        if(tipo==='ya_cortesia'){s.tipo_cobro='cortesia';s.total=0;}
        if(tipo==='libro_cobrable')e.state.reservas[0].servicios[0] =
            e.c.HAIKU_LIBRO_SEMANTICA.servicios('1 HORA DE TINAJA TONEL POR PAGAR 18:00 A 19:00',
                {origen_campo:'notas_reserva'})[0];
        const item=servicios(await e.construir())[0];
        assert.equal(item.cambioCortesiaExistente ?? null,null,tipo);
        assert.equal(e.state.escrituras.length,0,tipo);
    }
});

test('Aprobación manual queda dentro de su ficha y cambia de tarjeta sin duplicar paneles',async()=>{
    const e=entorno(),out=new e.Element('div');e.document.card=out;
    e.api.renderizar(await e.construir(),out,consulta);
    const filas=out.querySelectorAll('.haku-libro-servicios__item')
        .filter(f=>f.querySelectorAll('button').some(b=>b.textContent==='Aprobación manual'));
    assert.equal(filas.length,3);
    for(const fila of filas){
        const boton=fila.querySelectorAll('button').find(b=>b.textContent==='Aprobación manual');
        await boton.listeners.click();
        const panel=out.querySelector('.haku-libro-servicio-manual');
        assert.ok(panel);
        assert.equal(panel.parentElement,fila,'no se agrega al pie del resultado');
        assert.equal(fila.children.at(-1),panel,'se abre después de los datos y botones de su ficha');
        assert.equal(panel.style.gridColumn,'1 / -1','ocupa el ancho completo de la ficha');
        assert.equal(out.querySelectorAll('.haku-libro-servicio-manual').length,1);
        assert.equal(out.children.includes(panel),false);
    }
    const cerrar=out.querySelector('.haku-libro-servicio-manual').querySelectorAll('button')
        .find(b=>b.textContent==='Cancelar');
    cerrar.listeners.click();
    assert.equal(out.querySelector('.haku-libro-servicio-manual'),null);
    assert.equal(e.state.escrituras.length,0);
});

test('cortesía existente: su aprobación manual se muestra debajo de la misma tinaja sin escribir',async()=>{
    const e=entorno();
    e.state.reservas[0].servicios[0]=e.c.HAIKU_LIBRO_SEMANTICA.servicios(
        '1 HORA DE CORTESIA TINAJA TONEL DE MADERA 18:00 A 19:00',
        {origen_campo:'notas_reserva'})[0];
    e.state.db.servicios.push({id:'tonel-existente',reserva_id:e.state.db.reservas[0].id,
        estadia_id:e.state.db.reserva_estadias[0].id,fecha_servicio:'2026-10-10',
        hora_inicio:'18:00:00',hora_fin:'19:00:00',cantidad:1,personas:2,
        tipo_cobro:'normal',total:30000,estado_servicio:'programado',
        catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tonel de madera'}});
    let lecturas=0,escrituras=0;
    e.c.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1={
        preparar:async()=>{lecturas++;return {estado:'bloqueada',mensaje:'Simulación sin escritura'};},
        confirmar:()=>{escrituras++;throw Error('No se debe ejecutar la escritura al abrir');},
        verificarEstado:async()=>({estado:'incierto'}),
        renderizar:()=>''};
    const out=new e.Element('div');e.document.card=out;
    const resultado=await e.construir();
    assert.ok(resultado.items.some(i=>i.cambioCortesiaExistente?.servicioId==='tonel-existente'));
    e.api.renderizar(resultado,out,consulta);
    const fila=out.querySelectorAll('.haku-libro-servicios__item')
        .find(f=>f.querySelectorAll('button').some(b=>b.textContent==='Aprobación manual'));
    await fila.querySelectorAll('button').find(b=>b.textContent==='Aprobación manual').listeners.click();
    const panel=out.querySelector('.haku-libro-servicio-manual');
    assert.ok(panel);assert.equal(panel.parentElement,fila);assert.equal(panel.style.gridColumn,'1 / -1');
    assert.equal(lecturas,1);assert.equal(escrituras,0);assert.equal(e.state.escrituras.length,0);
});


function casoFullDayTinaja(texto='TIN AJA TONEL DE MADERA 18:00 A 19:00') {
    const e=entorno(),r=e.state.reservas[0],estadia=e.state.db.reserva_estadias[0];
    r.tipo_estadia='full_day';r.fecha_checkout=r.fecha_checkin;
    estadia.tipo_estadia='fullday';estadia.fecha_salida=estadia.fecha_ingreso;
    r.servicios[0]=e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto,{origen_campo:'notas_reserva'})[0];
    e.state.db.pagos=[];e.state.db.vista_estado_cargos=[];
    e.c.haikuTienePermiso = permiso => permiso === 'pagos.ver';
    return e;
}
const primeraTinaja = r=>r.items.find(i=>i.kind==='servicio' && ['tonel','jacuzzi','tinaja'].includes(i.servicio.concepto));

test('Full Day: Tonel o Jacuzzi único de 1 hora sin pago se clasifica cortesía sin preguntar',async()=>{
    for(const texto of ['TINAJA TONEL DE MADERA 18:00 A 19:00',
        'JACUZZI 18:00 A 19:00','TINAJA TONEL DE MADERA 1 HORA A LAS 18:00']) {
        const e=casoFullDayTinaja(texto),original=JSON.stringify(e.state.reservas);
        const item=primeraTinaja(await e.construir());
        assert.equal(item.intencion_cobro,'cortesia',texto);
        assert.equal(item.proveniencia.tipo_cobro,'INFERIDO_FULLDAY_VERIFICADO',texto);
        assert.equal(item.reglaFullDay.pagosRevisados,true,texto);
        assert.equal(item.payload?.tipo_cobro,'cortesia',texto);
        assert.match(item.payload?.motivo_cortesia,/Full Day/);
        assert.equal(item.estado,'listo',texto);
        assert.deepEqual(JSON.stringify(e.state.reservas),original,'el Libro original no cambia');
        assert.equal(e.state.escrituras.length,0);
    }
});

test('Full Day: una tinaja sin tipo mantiene selección de Tonel/Jacuzzi, sin pedir tipo de cobro',async()=>{
    const e=casoFullDayTinaja('1 HORA DE TINAJA CALIENTE 18:00 A 19:00');
    const res=await e.construir(),item=primeraTinaja(res);
    assert.equal(item.intencion_cobro,'cortesia');
    assert.equal(item.estado,'revisar','todavía falta escoger Tonel o Jacuzzi');
    assert.ok(!item.razones.some(x=>/definir si el servicio es cobrable/i.test(x)));
    const out=new e.Element('div');e.document.card=out;
    e.api.renderizar(res,out,consulta);
    const btn=out.querySelectorAll('button').find(b=>b.textContent==='Aprobación manual');
    assert.ok(btn);
    await btn.listeners.click();
    const panel=out.querySelector('.haku-libro-servicio-manual');
    assert.ok(panel);
    const inputs=panel.querySelectorAll('input,select');
    assert.ok(inputs.some(x=>x.dataset.campoManual==='codigo_servicio'));
    assert.ok(!inputs.some(x=>x.dataset.campoManual==='tipo_cobro'));
    assert.equal(e.state.escrituras.length,0);
});

test('Full Day: cobro de tinaja en Pagos o Libro impide inferir gratuidad',async()=>{
    for(const origen of ['pagos','libro','aplicaciones']) {
        const e=casoFullDayTinaja('TINAJA TONEL DE MADERA 18:00 A 19:00');
        const reservaId=e.state.db.reservas[0].id,estadia=e.state.db.reserva_estadias[0];
        if(origen==='pagos')e.state.db.pagos.push({id:'p-1',reserva_id:reservaId,
            estado:'confirmado',tipo_movimiento:'pago',monto:30000,observaciones:'Pago Jacuzzi'});
        if(origen==='libro')e.state.reservas[0].pagos=[{monto:30000,concepto:'Tinaja Tonel',tipo_movimiento:'servicio'}];
        if(origen==='aplicaciones'){
            e.state.db.servicios.push({id:'s-1',reserva_id:reservaId,estadia_id:estadia.id,
                fecha_servicio:'2026-10-10',hora_inicio:'18:00:00',hora_fin:'19:00:00',
                cantidad:1,personas:2,tipo_cobro:'normal',total:30000,estado_servicio:'programado',
                catalogo_servicios:{codigo:'tinajaTonel'}});
            e.state.db.vista_estado_cargos.push({cargo_id:'cargo-1',reserva_id:reservaId,
                servicio_id:'s-1',aplicado_neto:30000,tipo_cargo:'servicio',estado:'activo'});
        }
        const item=primeraTinaja(await e.construir());
        assert.equal(item.reglaFullDay??null,null,origen);
        assert.notEqual(item.intencion_cobro,'cortesia',origen);
        assert.equal(e.state.escrituras.length,0,origen);
    }
});

test('Full Day: no se regala una segunda tinaja, un tiempo adicional ni una reserva normal',async()=>{
    for(const tipo of ['2horas','extra','2servicios','no_full_day','estadia_distinta','tres_adultos_extra','sin_permiso_pagos','lectura_financiera_fallida']) {
        const e=casoFullDayTinaja(tipo==='2horas'?'TINAJA TONEL 2 HORAS 18:00':
            tipo==='extra'?'TINAJA TONEL EXTRA 18:00 A 19:00':'TINAJA TONEL 18:00 A 19:00');
        if(tipo==='2servicios')e.state.reservas[0].servicios.push(
            e.c.HAIKU_LIBRO_SEMANTICA.servicios('JACUZZI 19:00 A 20:00',{origen_campo:'notas_reserva'})[0]);
        if(tipo==='no_full_day')e.state.reservas[0].tipo_estadia='alojamiento';
        if(tipo==='estadia_distinta')e.state.db.reserva_estadias[0].tipo_estadia='alojamiento';
        if(tipo==='tres_adultos_extra')e.state.reservas[0].adultos=4;
        if(tipo==='sin_permiso_pagos')e.c.haikuTienePermiso = () => false;
        if(tipo==='lectura_financiera_fallida'){
            const old=e.c.haikuSupabase.from.bind(e.c.haikuSupabase);
            e.c.haikuSupabase.from=nombre=>nombre==='pagos'
                ?{select(){return this;},in(){return Promise.resolve({data:null,error:{message:'Sin acceso'}});}}
                :old(nombre);
        }
        const item=primeraTinaja(await e.construir());
        assert.equal(item.reglaFullDay??null,null,tipo);
        assert.notEqual(item.intencion_cobro,'cortesia',tipo);
        assert.equal(e.state.escrituras.length,0,tipo);
    }
});

test('Full Day: el abono del paquete con tinaja incluida no es un segundo pago de tinaja',async()=>{
    const e=casoFullDayTinaja('TINAJA TONEL 18:00 A 19:00');
    const id=e.state.db.reservas[0].id;
    e.state.db.pagos.push({id:'alojamiento',reserva_id:id,tipo_movimiento:'pago',
        estado:'confirmado',monto:120000,observaciones:'Full Day incluye 1 hora de tinaja tonel'});
    assert.equal(primeraTinaja(await e.construir()).intencion_cobro,'cortesia');
    e.state.db.pagos[0].observaciones='Full Day incluye tinaja, abono adicional Jacuzzi $20.000';
    assert.equal(primeraTinaja(await e.construir()).reglaFullDay??null,null);
});

test('Full Day: un servicio existente cobrable solo ofrece el cambio protegido, nunca duplica',async()=>{
    const e=casoFullDayTinaja('TINAJA TONEL 18:00 A 19:00');
    const id=e.state.db.reservas[0].id,estad=e.state.db.reserva_estadias[0].id;
    e.state.db.servicios.push({id:'tinaja-existente',reserva_id:id,estadia_id:estad,
        fecha_servicio:'2026-10-10',hora_inicio:'18:00:00',hora_fin:'19:00:00',
        cantidad:1,personas:2,tipo_cobro:'normal',total:30000,estado_servicio:'programado',
        catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tonel de madera'}});
    const item=primeraTinaja(await e.construir());
    assert.equal(item.estado,'revisar');
    assert.equal(item.payload,null);
    assert.equal(item.intencion_cobro,'cortesia');
    assert.equal(item.cambioCortesiaExistente?.servicioId,'tinaja-existente');
    assert.equal(item.cambioCortesiaExistente?.total,30000);
    assert.equal(e.state.escrituras.length,0);
});

test('Full Day: pago con concepto canónico o servicio_id vinculado bloquea cortesía',async()=>{
    for(const tipo of ['canonico','servicio_id']){
        const e=casoFullDayTinaja('TINAJA TONEL 18:00 A 19:00'),id=e.state.db.reservas[0].id;
        e.state.db.pagos.push({id:'pago-ext',reserva_id:id,tipo_movimiento:'pago',
            estado:'confirmado',monto:30000,datos_origen:{
                aplicaciones_servicio_v1:{aplicaciones:[{servicio_id:'servicio-ya-existente',
                    ...(tipo==='canonico'?{concepto_canon:'tinaja_tonel'}:{})}]}}});
        if(tipo==='servicio_id'){
            e.state.db.servicios.push({id:'servicio-ya-existente',reserva_id:id,
                estadia_id:e.state.db.reserva_estadias[0].id,fecha_servicio:'2026-10-10',
                hora_inicio:'18:00:00',hora_fin:'19:00:00',cantidad:1,personas:2,
                tipo_cobro:'normal',total:30000,estado_servicio:'programado',
                catalogo_servicios:{codigo:'tinajaTonel'}});
        }
        const item=primeraTinaja(await e.construir());
        assert.equal(item.reglaFullDay??null,null,tipo);
    }
});

test('Full Day: un pago nuevo después de la vista previa invalida la cortesía antes de incorporar',async()=>{
    const e=casoFullDayTinaja('TINAJA TONEL 18:00 A 19:00'),id=e.state.db.reservas[0].id;
    const primero=primeraTinaja(await e.construir());
    assert.equal(primero.estado,'listo');assert.equal(primero.payload.tipo_cobro,'cortesia');
    e.state.db.pagos.push({id:'nuevo-pago',reserva_id:id,tipo_movimiento:'pago',
        estado:'confirmado',monto:30000,observaciones:'Cobro por tinaja tonel'});
    const segundo=primeraTinaja(await e.construir());
    assert.equal(segundo.reglaFullDay??null,null);
    assert.equal(segundo.estado,'revisar');assert.equal(segundo.payload,null);
    assert.equal(e.state.escrituras.length,0);
});

test('Full Day: evidencia explícita cobrable o de cortesía conserva su autoridad',async()=>{
    const cobro=casoFullDayTinaja('TINAJA TONEL X PAGAR CLP$30.000 18:00 A 19:00');
    const pago=primeraTinaja(await cobro.construir());
    assert.equal(pago.intencion_cobro,'cobrable');
    assert.equal(pago.reglaFullDay??null,null);
    const cortesia=casoFullDayTinaja('1 HORA DE CORTESIA TINAJA TONEL 18:00 A 19:00');
    const gratis=primeraTinaja(await cortesia.construir());
    assert.equal(gratis.intencion_cobro,'cortesia');
    assert.equal(gratis.reglaFullDay??null,null,'cortesía original explícita, no inferida');
});
