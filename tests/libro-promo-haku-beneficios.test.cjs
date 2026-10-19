const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../js/haiku-libro-semantica-v1.js');
const {entorno,consulta}=require('./fixtures/libro-servicio-manual.cjs');
function caso(texto='JACUZZI 18:00 A 19:00',encabezado='PROMO HAIKU') {
    const e=entorno(),r=e.state.reservas[0];e.state.reservas=[r];
    r.texto_original=encabezado+' // Huésped de prueba // 2 ADL // 1 NOCHE // '+texto;
    r.servicios=S.servicios(texto,{origen_campo:'notas_reserva'});
    r.pagos=[];r.pagos_sin_asociacion=[];
    e.state.db.pagos=[];e.state.db.vista_estado_cargos=[];
    e.c.haikuTienePermiso=p=>p==='pagos.ver';
    return e;
}
const servicios=plan=>plan.items.filter(i=>i.kind==='servicio');
test('PROMO HAIKU y PROMO HAKU al inicio reconocen exactamente 10% y una hora, con ambos tipos de tinaja',()=>{
    for(const texto of ['PROMO HAIKU // Huésped','  promo haku // Huésped','PROMO HAIKU SEGUNDA NOCHE // Huésped']){
        const p=S.promocionReserva(texto);assert.equal(p.codigo,'PROMO_HAKU');
        assert.equal(p.descuento_porcentaje,10);assert.equal(p.horas_tinaja_cortesia,1);
        assert.deepEqual(p.codigos_tinaja,['tinajaJacuzzi','tinajaTonel']);
    }
    for(const texto of ['Huésped // PROMO HAIKU','PROMO OTRA // Huésped','NO PROMO HAIKU','PROMO HAIKUS'])
        assert.equal(S.promocionReserva(texto),null,texto);
});
test('la lectura canónica conserva el encabezado original y adjunta beneficios sin recalcular tarifas',()=>{
    const texto='PROMO HAIKU // Huésped de prueba // 2 ADL // 1 NOCHE';
    const hoja={celdas:[{r:1,c:2,valor:'16 oct',fechaISO:'2026-10-16'},{r:1,c:6,valor:'17 oct',fechaISO:'2026-10-17'},
        {r:2,c:0,valor:'cabaña 3'},{r:2,c:2,valor:texto},{r:24,c:2,valor:'Pagos de arriendos de hoy'}],
        combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}}]};
    const antes=JSON.stringify(hoja),r=S.normalizarHoja(hoja,'Oct26').reservas[0];assert.ok(r);
    assert.equal(r.promocion.descuento_porcentaje,10);assert.equal(r.texto_original,texto);
    assert.equal(r.tarifa,undefined);assert.equal(r.precio_total,undefined);assert.equal(JSON.stringify(hoja),antes);
});
test('la nota de promoción explica los beneficios y preserva su texto de origen',async()=>{
    const e=caso(''),antes=JSON.stringify(e.state.db),plan=await e.construir();
    const nota=plan.items.find(i=>i.kind==='nota'&&i.texto==='PROMO HAIKU');assert.ok(nota);
    assert.match(nota.inferencias.join(' '),/10% de descuento y 1 hora.*Jacuzzi o Tonel/);
    assert.match(nota.inferencias.join(' '),/no se aplica por segunda vez/);
    assert.equal(nota.payload.texto,'PROMO HAIKU');assert.equal(servicios(plan).length,0);
    assert.equal(JSON.stringify(e.state.db),antes);assert.equal(e.state.escrituras.length,0);
});
for(const codigo of ['JACUZZI','TINAJA TONEL'])test('una única hora explícita de '+codigo+' sin cobro se prepara como cortesía de la promo',async()=>{
    const e=caso(codigo+' 18:00 A 19:00'),r=await e.construir(),i=servicios(r)[0];
    assert.equal(i.intencion_cobro,'cortesia');assert.equal(i.estado,'listo');assert.equal(i.payload.tipo_cobro,'cortesia');
    assert.equal(i.reglaPromo.pagosRevisados,true);assert.equal(i.proveniencia.tipo_cobro,'INFERIDO_PROMO_VERIFICADO');
    assert.match(i.payload.motivo_cortesia,/Promo Haku/);assert.equal(e.state.escrituras.length,0);
});
test('una tinaja con inicio conocido usa la hora incluida sin pedir nuevamente el tipo de cobro',async()=>{
    for(const texto of ['18hrs jacuzzi','JACUZZI A LAS 18:00','TONEL 18:00 60 MINUTOS']){
        const e=caso(texto),i=servicios(await e.construir())[0];
        assert.equal(i.estado,'listo',texto);assert.equal(i.payload.tipo_cobro,'cortesia',texto);
        assert.equal(i.payload.cantidad,1,texto);assert.equal(e.state.escrituras.length,0);
    }
    for(const texto of ['JACUZZI 2 HORAS A LAS 18:00','JACUZZI 2 HRS A LAS 18:00',
        'JACUZZI 90 MINUTOS A LAS 18:00','JACUZZI A LAS 23:30','+ 1 hr de tinaja caliente']){
        const i=servicios(await caso(texto).construir())[0];
        assert.equal(i.reglaPromo,null,texto);assert.equal(i.payload,null,texto);
    }
});
test('sin horario conserva la hora incluida como nota, sin agendar una prestación',async()=>{
    const e=caso('+ 1 hora de tinaja caliente'),r=await e.construir();assert.equal(servicios(r).length,0);
    assert.equal(r.items.filter(i=>i.kind==='nota'&&i.texto==='+ 1 hora de tinaja caliente').length,1);
});
test('horas extra, pagos específicos, dos tinajas, falta de acceso y promos ajenas no regalan otra hora',async()=>{
    for(const tipo of ['extra','pago','dos','sin_permiso','otra_promo']){
        const e=caso(tipo==='extra'?'JACUZZI EXTRA 18:00 A 19:00':'JACUZZI 18:00 A 19:00',tipo==='otra_promo'?'PROMO OTRA':'PROMO HAIKU');
        if(tipo==='pago')e.state.db.pagos.push({id:'extra',reserva_id:e.state.db.reservas[0].id,monto:30000,
            tipo_movimiento:'pago',estado:'confirmado',observaciones:'Pago jacuzzi'});
        if(tipo==='dos')e.state.reservas[0].servicios.push(...S.servicios('TONEL 20:00 A 21:00',{origen_campo:'notas_reserva'}));
        if(tipo==='sin_permiso')e.c.haikuTienePermiso=()=>false;
        const i=servicios(await e.construir())[0];assert.equal(i.reglaPromo,null,tipo);
        assert.notEqual(i.intencion_cobro,'cortesia',tipo);assert.equal(i.payload,null,tipo);
    }
});
test('cobro explícito conserva autoridad y un rango extenso no se convierte completo en cortesía',async()=>{
    const cobrable=servicios(await caso('JACUZZI 18:00 A 19:00 X PAGAR $30.000').construir())[0];
    assert.equal(cobrable.intencion_cobro,'cobrable');assert.equal(cobrable.reglaPromo,null);
    const extenso=servicios(await caso('JACUZZI A LAS 17:15 HASTA LAS 20:30').construir())[0];
    assert.equal(extenso.estado,'revisar');assert.equal(extenso.payload,null);assert.equal(extenso.reglaPromo,null);
    assert.match(extenso.razones.join(' '),/promoción incluye 1 hora.*horas adicionales/);
});
test('Julián: otra tinaja ya pagada exige revisar el cambio y conserva descuento y pago sin pedir cobrable o cortesía',async()=>{
    const e=caso('JACUZZI A LAS 17:15 HASTA LAS 20:30'),est=e.state.db.reserva_estadias[0];
    e.state.db.servicios.push({id:'tinaja-pagada',reserva_id:est.reserva_id,estadia_id:est.id,
        catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera'},fecha_servicio:'2026-10-10',
        hora_inicio:'16:15:00',hora_fin:'18:15:00',cantidad:2,personas:2,total:30000,tipo_cobro:'normal',estado_servicio:'programado'});
    e.state.db.vista_estado_cargos.push({cargo_id:'alojamiento',reserva_id:est.reserva_id,estadia_id:est.id,
        tipo_cargo:'alojamiento',monto:144000,monto_ajustado:144000,aplicado_neto:144000,saldo_cargo:0,estado:'activo'},
        {cargo_id:'hora-adicional',reserva_id:est.reserva_id,estadia_id:est.id,servicio_id:'tinaja-pagada',
            monto:30000,monto_ajustado:30000,aplicado_neto:30000,saldo_cargo:0,estado:'activo'});
    const antes=JSON.stringify(e.state.db),r=await e.construir(),i=servicios(r)[0];
    assert.equal(i.estado,'revisar');assert.equal(i.payload,null);
    assert.match(i.razones.join(' '),/Ya existe Tinaja Tonel.*16:15–18:15.*otro tipo u horario/);
    assert.match(i.razones.join(' '),/¿Se modificó la tinaja registrada\?/);
    assert.equal(i.finanzas_existente.estado,'pagado');assert.equal(i.finanzas_existente.saldo,0);
    assert.match(i.inferencias.join(' '),/10% de descuento/);
    const out=new e.Element('div');e.document.card=out;e.api.renderizar(r,out,consulta);
    assert.match(out.textContent,/Promo Haku: 10% de descuento/);
    assert.match(out.textContent,/Pagado \$30\.000 · saldo \$0/);
    assert.doesNotMatch(out.textContent,/cobro por definir|Tipo de cobro/);
    const fila=out.querySelectorAll('.haku-libro-servicios__item').find(x=>x.textContent.includes('JACUZZI A LAS'));
    assert.ok(fila.querySelectorAll('button').some(b=>b.textContent==='Ver reserva'));
    assert.ok(!fila.querySelectorAll('button').some(b=>b.textContent==='Aprobación manual'));
    await assert.rejects(e.resolver(0,{tipo_cobro:'normal'}),/Revisa el cambio de tipo u horario/);
    assert.equal(JSON.stringify(e.state.db),antes);assert.equal(e.state.escrituras.length,0);
});
test('un servicio que aparece después de una aprobación vuelve a revisar el cambio sin habilitar duplicados',async()=>{
    const e=caso('JACUZZI 18:00 A 19:00');
    assert.equal(servicios(await e.resolver(0,{}))[0].estado,'listo');
    const est=e.state.db.reserva_estadias[0];
    e.state.db.servicios.push({id:'registrada-despues',reserva_id:est.reserva_id,estadia_id:est.id,
        catalogo_servicios:{codigo:'tinajaJacuzzi',nombre:'Jacuzzi'},fecha_servicio:'2026-10-10',
        hora_inicio:'17:00:00',hora_fin:'18:00:00',cantidad:1,personas:2,total:0,tipo_cobro:'cortesia',estado_servicio:'programado'});
    const i=servicios(await e.construir())[0];assert.equal(i.estado,'revisar');assert.equal(i.payload,null);
    assert.equal(i.conflicto_tinaja_promo,true);assert.equal(e.state.escrituras.length,0);
});
