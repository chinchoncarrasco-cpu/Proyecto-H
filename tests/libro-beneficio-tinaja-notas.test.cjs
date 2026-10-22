const test = require('node:test');
const assert = require('node:assert/strict');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const BENEFICIO = '1 HORA DE TINAJA DE CORTESÍA';
const BENEFICIO_PROMO = '+ 1 hora de tinaja caliente';
function caso(texto = BENEFICIO, noches = 1) {
    const e = entorno(), r = e.state.reservas[0], estadia = e.state.db.reserva_estadias[0];
    r.titular = 'Huésped de prueba'; e.state.db.reservas[0].titular_nombre = r.titular;
    e.state.reservas = [r];
    r.noches = noches; r.fecha_checkout = '2026-10-' + (10 + noches);
    estadia.fecha_salida = r.fecha_checkout;
    const cambiar = texto => {
        r.texto_original = 'PROMO HAIKU // ' + texto + '; DEJAR BATAS EN CAB';
        r.servicios = e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto, { origen_campo:'notas_reserva' });
    };
    cambiar(texto);
    const deTinaja = plan => plan.items.filter(i => i.kind === 'servicio');
    const notas = plan => plan.items.filter(i => i.kind === 'nota' && /tinaja|jacuzzi|tonel/i.test(i.texto));
    const registrar = (campos = {}) => e.state.db.servicios.push({
        id:'tinaja-previa',reserva_id:estadia.reserva_id,estadia_id:estadia.id,
        catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera'},
        fecha_servicio:r.fecha_checkin,hora_inicio:'19:15:00',hora_fin:'20:15:00',
        cantidad:1,personas:2,tipo_cobro:'cortesia',total:0,estado_servicio:'programado',...campos
    });
    return { e, r, estadia, cambiar, deTinaja, notas, registrar };
}
for (const noches of [1,2]) test('Beneficio sin coordinación es nota de reserva: ' + noches + ' noche(s)', async () => {
    const { e,r,notas,deTinaja } = caso(BENEFICIO,noches), antes = JSON.stringify(r);
    const plan = await e.construir(), [nota] = notas(plan);
    assert.equal(deTinaja(plan).length,0); assert.equal(notas(plan).length,1);
    assert.equal(nota.kind,'nota'); assert.equal(nota.semantica,'NO_SERVICIO');
    assert.equal(nota.estado,'listo'); assert.equal(nota.payload.texto,BENEFICIO);
    assert.equal(nota.payload.reserva_id,e.state.db.reservas[0].id);
    assert.equal(nota.payload.estadia_id,e.state.db.reserva_estadias[0].id);
    assert.equal(nota.payload.codigo_servicio,undefined);
    assert.equal(nota.payload.servicio_manual_v1,undefined);
    assert.equal(nota.firmaManual,undefined);
    assert.equal(JSON.stringify(r),antes); assert.equal(e.state.escrituras.length,0);
    assert.match(nota.inferencias.join(' '),/pendiente de coordinar/);
});
for (const texto of [BENEFICIO_PROMO,'+1 HORA DE TINAJA CALIENTE','+ 1 hora de jacuzzi','+ 1 hora de tinaja tonel'])
test('Beneficio sumado a la promoción sin agenda es nota: '+texto,async()=>{
    const {e,r,notas,deTinaja}=caso(texto),antes=JSON.stringify(r);
    const plan=await e.construir(),[nota]=notas(plan);
    assert.equal(deTinaja(plan).length,0);assert.equal(notas(plan).length,1);
    assert.equal(nota.semantica,'NO_SERVICIO');assert.equal(nota.estado,'listo');
    assert.equal(nota.payload.texto,texto);assert.match(nota.inferencias.join(' '),/Beneficio de la promoción pendiente de coordinar/);
    assert.equal(JSON.stringify(r),antes);assert.equal(e.state.escrituras.length,0);
});
for(const texto of ['+ 1 hora de tinaja caliente 19:15','+ 1 hora de tinaja caliente confirmada',
    '+ 1 hora de tinaja caliente x pagar $30.000','+ 1 hora adicional de tinaja caliente'])
test('La promoción no oculta una prestación con agenda, confirmación o cobro: '+texto,async()=>{
    const {e,notas,deTinaja}=caso(texto),plan=await e.construir();
    assert.equal(notas(plan).length,0);assert.equal(deTinaja(plan).length,1);
    assert.equal(e.state.escrituras.length,0);
});
test('El signo + sin contexto promocional o desde Servicios explícitos no basta para tratarlo como beneficio',async()=>{
    for(const tipo of ['sin_promo','campo_servicios']){
        const {e,r,notas,deTinaja}=caso(BENEFICIO_PROMO);
        if(tipo==='sin_promo')r.texto_original='Reserva // '+BENEFICIO_PROMO;
        else r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(BENEFICIO_PROMO,{origen_campo:'servicios'});
        const plan=await e.construir();assert.equal(notas(plan).length,0,tipo);
        assert.equal(deTinaja(plan).length,1,tipo);
    }
});
test('Una tinaja ya registrada conserva autoridad al releer el beneficio de la promoción',async()=>{
    const {e,registrar,notas,deTinaja}=caso(BENEFICIO_PROMO);registrar();
    const plan=await e.construir();assert.equal(notas(plan).length,0);
    assert.equal(deTinaja(plan).length,1);assert.equal(deTinaja(plan)[0].estado,'existente');
    assert.equal(deTinaja(plan)[0].servicio_existente.id,'tinaja-previa');
    assert.equal(e.state.escrituras.length,0);
});
for (const texto of [
    '1 HORA DE TINAJA DE CORTESÍA X COORDINAR',
    '1 HORA DE TINAJA DE CORTESÍA POR COORDINAR',
    '1 HORA DE TINAJA DE CORTESÍA POR CONFIRMAR',
    '1 HORA DE TINAJA DE CORTESÍA PENDIENTE DE CONFIRMACIÓN',
    '1 HORA DE TINAJA DE CORTESÍA A LAS 19:15 X COORDINAR',
    '1 HORA DE TINAJA DE CORTESÍA // POR COORDINAR'
]) test('Coordinación pendiente no recibe aprobación manual: ' + texto, async () => {
    const {e,deTinaja,notas} = caso(texto);
    const plan = await e.construir(); assert.equal(deTinaja(plan).length,0);
    assert.equal(notas(plan).length,1); assert.equal(notas(plan)[0].estado,'listo');
    assert.equal(e.state.escrituras.length,0);
});
for(const texto of [
    '1 HORA DE CORTESIA TINAJA', 'UNA HORA DE TINAJA DE CORTESÍA',
    '1 HORA DE TINAJA TONEL DE CORTESÍA','1 HORA DE JACUZZI DE CORTESÍA',
    '1 HORA DE TINAJA DE CORTESÍA PARA EL 11/10'
])test('Sin agendamiento, el beneficio no depende del subtipo ni de una fecha aislada: '+texto,async()=>{
    const {e,notas,deTinaja}=caso(texto,2);const plan=await e.construir();
    assert.equal(deTinaja(plan).length,0);assert.equal(notas(plan).length,1);
});
test('No confunde horario de otro servicio con la tinaja incluida',async()=>{
    const {e,r,deTinaja,notas}=caso(BENEFICIO+' // 1 MASAJE DESCONTRACTURANTE 60 MIN 19:00');
    const plan=await e.construir();
    assert.equal(deTinaja(plan).length,1);assert.equal(deTinaja(plan)[0].servicio.concepto,'masaje');
    assert.equal(notas(plan).length,1);assert.equal(notas(plan)[0].texto,BENEFICIO);
});
test('Una tinaja con horario sigue siendo servicio y conserva la cortesía',async()=>{
    const {e,deTinaja,notas}=caso('1 HORA DE TINAJA TONEL DE CORTESÍA 19:15 A 20:15');
    const plan=await e.construir(), [s]=deTinaja(plan);
    assert.equal(notas(plan).length,0);assert.equal(s.estado,'listo');
    assert.equal(s.payload.codigo_servicio,'tinajaTonel');assert.equal(s.payload.tipo_cobro,'cortesia');
    assert.equal(s.hora,'19:15');assert.equal(s.hora_fin,'20:15');
});
test('Prestación expresamente confirmada conserva revisión de datos faltantes',async()=>{
    const {e,deTinaja,notas}=caso('1 HORA DE CORTESIA TINAJA CONFIRMADA');
    const plan=await e.construir();assert.equal(notas(plan).length,0);
    assert.equal(deTinaja(plan).length,1);assert.equal(deTinaja(plan)[0].estado,'revisar');
});
test('Ya agendada en Proyecto H: conservar servicio existente y no generar una nota nueva',async()=>{
    const {e,registrar,deTinaja,notas}=caso();registrar();
    const plan=await e.construir(), [s]=deTinaja(plan);
    assert.equal(notas(plan).length,0);assert.equal(s.estado,'existente');
    assert.equal(s.servicio_existente.id,'tinaja-previa');assert.equal(s.hora,'19:15');
    assert.equal(s.payload,null);assert.equal(e.state.escrituras.length,0);
});
for(const modo of ['cobrable','multiples'])test('No oculta una discrepancia o identidad ambigua bajo una nota: '+modo,async()=>{
    const {e,registrar,deTinaja,notas}=caso();
    if(modo==='cobrable')registrar({tipo_cobro:'normal',total:30000});
    else {registrar();registrar({id:'segunda-tinaja',hora_inicio:'20:45:00',hora_fin:'21:45:00'});}
    const plan=await e.construir();assert.equal(notas(plan).length,0);
    assert.equal(deTinaja(plan)[0].estado,'revisar');assert.equal(deTinaja(plan)[0].payload,null);
});
test('Nota ya incorporada: se omite sin crear otra ni revivir un servicio',async()=>{
    const {e,notas,deTinaja}=caso();const nota=notas(await e.construir())[0];
    e.state.db.notas.push({id:'nota-previa',reserva_id:nota.payload.reserva_id,
        tipo:'libro_reserva:'+nota.item_id,texto:nota.texto});
    const plan=await e.construir();assert.equal(deTinaja(plan).length,0);
    assert.equal(notas(plan).length,1);assert.equal(notas(plan)[0].estado,'existente');
});
test('Glosa repetida en la misma evidencia genera sólo una nota',async()=>{
    const {e,r,notas}=caso();r.servicios.push({...r.servicios[0],unidad_indice:22});
    assert.equal(notas(await e.construir()).length,1);
});
test('Al coordinar después, la nueva lectura prepara el servicio sin borrar la nota histórica',async()=>{
    const {e,cambiar,notas,deTinaja}=caso(), n=notas(await e.construir())[0];
    e.state.db.notas.push({id:'historica',reserva_id:n.payload.reserva_id,tipo:'libro_reserva:'+n.item_id,texto:n.texto});
    cambiar('1 HORA DE TINAJA TONEL DE CORTESÍA 19:15 A 20:15');
    const plan=await e.construir();assert.equal(deTinaja(plan).length,1);
    assert.equal(deTinaja(plan)[0].estado,'listo');assert.equal(e.state.db.notas.length,1);
    assert.equal(e.state.escrituras.length,0);
});
test('No permite confirmar una nota por la API de aprobación de servicios',async()=>{
    const {e,notas}=caso();const n=notas(await e.construir())[0];
    await assert.rejects(e.api.confirmarServicioManual(consulta,n.item_id,
        {codigo_servicio:'tinajaTonel',hora:'19:15'},e.manuales,n.firmaManual),/evidencia/i);
    assert.equal(e.state.escrituras.length,0);
});
test('Preparación vieja no convierte el beneficio en servicio ni conserva una selección obsoleta',async()=>{
    const {e,cambiar,notas,deTinaja}=caso('1 HORA DE CORTESIA TINAJA CONFIRMADA');
    await e.resolver(0,{codigo_servicio:'tinajaTonel',hora:'19:15'});
    const [id,decision]=[...e.manuales][0];cambiar(BENEFICIO);
    const plan=await e.construir();assert.equal(deTinaja(plan).length,0);
    assert.equal(notas(plan).length,1);assert.equal(decision.invalidada,true);
    assert.notEqual(notas(plan)[0].item_id,id);
});
test('Full Day también conserva el beneficio sin horario como nota, sin cobros automáticos',async()=>{
    const {e,r,estadia,deTinaja,notas}=caso();
    r.tipo_estadia='full_day';r.fecha_checkout=r.fecha_checkin;
    estadia.tipo_estadia='fullday';estadia.fecha_salida=estadia.fecha_ingreso;
    const plan=await e.construir();assert.equal(deTinaja(plan).length,0);
    assert.equal(notas(plan).length,1);assert.equal(e.state.escrituras.length,0);
});
test('Promo mixta de Julián sigue agrupada como una tinaja de dos horas',async()=>{
    const {e,notas,deTinaja}=caso('1 HORA DE TINAJA CORTESIA // tinaja de 16:15 a 18:15 hrs DOS HORAS // TINAJA X PAGAR 30.000');
    const plan=await e.construir();assert.equal(notas(plan).length,0);
    assert.equal(deTinaja(plan).length,1);assert.equal(deTinaja(plan)[0].servicio.promoTinajaMixta.version,1);
});
for (const texto of [BENEFICIO,BENEFICIO_PROMO]) test('La nota sale en Notas de la reserva, sin Aprobación manual ni formulario de servicios: '+texto,async()=>{
    const {e,notas}=caso(texto),plan=await e.construir(),out=new e.Element('div');e.document.card=out;
    e.api.renderizar(plan,out,consulta);
    const seccion=out.querySelector('.haku-libro-servicios__seccion--notas');
    assert.ok(seccion.textContent.includes(texto));
    assert.match(seccion.textContent,/no genera servicio ni cargo/);
    const fila=seccion.querySelectorAll('.haku-libro-servicios__item').find(f=>f.textContent.includes(texto));
    assert.equal(fila.querySelectorAll('button').some(b=>b.textContent==='Aprobación manual'),false);
    assert.equal(fila.querySelector('input').disabled,false);
    assert.equal(out.querySelectorAll('.haku-libro-servicio-manual').length,0);
    assert.equal(e.state.escrituras.length,0);
});
for (const texto of [BENEFICIO,BENEFICIO_PROMO]) test('Confirmación final usa sólo p_notas: cero servicios y cero cargos en el simulador: '+texto,async()=>{
    const {e,notas}=caso(texto),plan=await e.construir(),n=notas(plan)[0],out=new e.Element('div');
    e.document.card=out;e.api.renderizar(plan,out,consulta);
    for(const check of out.querySelectorAll('input[data-haku-item-id]')){
        check.checked=check.dataset.hakuItemId===n.item_id;check.listeners.change();
    }
    e.guard();out.previousElementSibling=new e.Element('div');
    out.previousElementSibling.className='haiku-asistente-mensaje--usuario';out.previousElementSibling.textContent=consulta;
    const btn=out.querySelectorAll('button').find(b=>b.dataset.hakuAccion==='incorporar');
    for(const [t,fn] of e.captures)if(t==='click')fn({target:btn,preventDefault(){},stopImmediatePropagation(){}});
    await new Promise(r=>setTimeout(r,70));
    assert.equal(e.state.escrituras.length,1);const args=e.state.escrituras[0];
    assert.equal(args.p_servicios.length,0);assert.equal(args.p_notas.length,1);
    assert.equal(args.p_notas[0].texto,texto);
    assert.equal(e.state.db.servicios.length,0);
});

for (const modo of ['cobrable','multiples']) test('Nota de beneficio ya guardada no revive como servicio por otras tinajas: '+modo,async()=>{
    const {e,notas,deTinaja,registrar}=caso(BENEFICIO,2);
    const nota=notas(await e.construir())[0];
    e.state.db.notas.push({id:'nota-operativa-previa',reserva_id:nota.payload.reserva_id,
        tipo:'operativa_resumen',texto:BENEFICIO});
    registrar({tipo_cobro:'normal',total:30000});
    if(modo==='multiples')registrar({id:'segunda-tinaja',hora_inicio:'22:15:00',hora_fin:'23:15:00'});
    const antes=JSON.stringify(e.state.db),plan=await e.construir();
    assert.equal(deTinaja(plan).length,0);assert.equal(notas(plan).length,1);
    assert.equal(notas(plan)[0].estado,'existente');
    const out=new e.Element('div');e.document.card=out;e.api.renderizar(plan,out,consulta);
    assert.doesNotMatch(out.querySelector('.haku-libro-servicios__seccion--revision').textContent,/1 HORA DE TINAJA/);
    assert.ok(!out.querySelector('.haku-libro-servicios__seccion--notas')?.textContent.includes(BENEFICIO));
    assert.equal(JSON.stringify(e.state.db),antes);assert.equal(e.state.escrituras.length,0);
});
test('Una nota de otra reserva no resuelve el beneficio con varias tinajas',async()=>{
    const {e,notas,deTinaja,registrar}=caso();
    e.state.db.notas.push({id:'nota-ajena',reserva_id:'otra-reserva',tipo:'operativa_resumen',texto:BENEFICIO});
    registrar();registrar({id:'segunda-tinaja',hora_inicio:'22:15:00'});
    const plan=await e.construir();assert.equal(notas(plan).length,0);
    assert.equal(deTinaja(plan)[0].estado,'revisar');assert.equal(e.state.escrituras.length,0);
});
test('La nota guardada no oculta el Tonel cobrable descrito por separado en el Libro',async()=>{
    const {e,notas,deTinaja,cambiar,registrar}=caso(BENEFICIO,2);
    const nota=notas(await e.construir())[0];
    e.state.db.notas.push({id:'beneficio-previo',reserva_id:nota.payload.reserva_id,tipo:'operativa_resumen',texto:BENEFICIO});
    registrar({tipo_cobro:'normal',total:30000,fecha_servicio:'2026-10-11'});
    registrar({id:'tinaja-cortesia',hora_inicio:'22:15:00',fecha_servicio:'2026-10-11'});
    cambiar(BENEFICIO+' // TONEL DOMINGO 11-10 X PAGAR');
    const plan=await e.construir();
    assert.equal(notas(plan).find(n=>n.texto===BENEFICIO).estado,'existente');
    assert.equal(deTinaja(plan).length,1);assert.match(deTinaja(plan)[0].servicio.texto_original,/TONEL DOMINGO/);
    assert.equal(deTinaja(plan)[0].intencion_cobro,'cobrable');assert.equal(e.state.escrituras.length,0);
});
