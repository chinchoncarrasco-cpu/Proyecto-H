const test=require('node:test'),assert=require('node:assert/strict');
const {entornoAcumulado}=require('./fixtures/libro-medio-pago-manual.cjs');
const listo=(h,plan,caso)=>{
    const i=h.itemCaso(plan,caso);assert.equal(i.categoria,'pagos',caso+' permanece preparado');
    assert.equal(i.motivos.length,0);assert.equal(i.payload.aprobado_manualmente,true);return i;
};
const crearB=(h,plan)=>h.resolver(plan,h.itemCaso(plan,'B'),{tipo:'crear_servicio_faltante',indice:0,
    codigo:h.casos.codigoB,fecha:'2026-10-03',cantidad:1,personas:h.casos.codigoB==='lena'?0:2,
    precio:40000,tipoCobro:'normal',precioManualConfirmado:true});
async function prepararAmbos(h){
    let plan=await h.definirCaso(await h.preparar(),'A','tarjeta_credito');plan=await h.aprobarCaso(plan,'A');
    plan=await h.definirCaso(plan,'B','tarjeta_debito');
    if(h.itemCaso(plan,'B').manualPago?.tipo==='crear_servicio_faltante')plan=await crearB(h,plan);
    return h.aprobarCaso(plan,'B');
}
for(const mismaReserva of [false,true])test('definir B acumula A sin reemplazar decisiones; misma reserva='+mismaReserva,async()=>{
    const h=entornoAcumulado({servicioB:false,mismaReserva});
    let plan=await h.definirCaso(await h.preparar(),'A','tarjeta_credito');plan=await h.aprobarCaso(plan,'A');
    const a=listo(h,plan,'A'),original=JSON.stringify(h.result.reservas);
    plan=await h.definirCaso(plan,'B','tarjeta_debito');listo(h,plan,'A');
    assert.equal(h.itemCaso(plan,'A').id,a.id);assert.equal(h.itemCaso(plan,'B').categoria,'dudosos');
    plan=await h.aprobarCaso(plan,'B');listo(h,plan,'A');listo(h,plan,'B');
    assert.equal(plan.items.filter(i=>i.categoria==='pagos').length,2);assert.equal(JSON.stringify(h.result.reservas),original);
});
test('crear y asociar servicio de Joseph conserva a Kyleigh preparada',async()=>{
    const h=entornoAcumulado();let plan=await h.definirCaso(await h.preparar(),'A','tarjeta_credito');
    plan=await h.aprobarCaso(plan,'A');const a=listo(h,plan,'A');
    plan=await h.definirCaso(plan,'B','tarjeta_debito');listo(h,plan,'A');
    assert.equal(h.itemCaso(plan,'B').manualPago.tipo,'crear_servicio_faltante');
    plan=await h.resolver(plan,h.itemCaso(plan,'B'),{tipo:'crear_servicio_faltante',indice:0,codigo:'tinajaTonel',
        fecha:'2026-10-03',cantidad:1,personas:2,precio:40000,tipoCobro:'normal',precioManualConfirmado:true});
    listo(h,plan,'A');assert.equal(h.itemCaso(plan,'A').id,a.id);assert.equal(h.itemCaso(plan,'B').manualPago.tipo,'asociacion_pago');
    plan=await h.aprobarCaso(plan,'B');listo(h,plan,'A');listo(h,plan,'B');
    assert.equal(plan.items.filter(i=>i.categoria==='pagos').length,2);
});
test('dos servicios independientes de la misma reserva acumulan decisiones de asociación',async()=>{
    const h=entornoAcumulado({mismaReserva:true,servicioA:true});const plan=await prepararAmbos(h);
    listo(h,plan,'A');listo(h,plan,'B');assert.equal(h.decisiones.size,2);
});
for(const mismaReserva of [false,true])test('cambiar medio de B invalida sólo B; misma reserva='+mismaReserva,async()=>{
    const h=entornoAcumulado({servicioB:false,mismaReserva}),previo=await prepararAmbos(h),a=listo(h,previo,'A');
    const auditoria=JSON.stringify(a.payload.datos_origen.medio_pago_manual_v1);
    const plan=await h.definirCaso(previo,'B','webpay_debito');listo(h,plan,'A');
    assert.equal(h.itemCaso(plan,'B').categoria,'dudosos');assert.equal(h.aprobados.has(a.id),true);
    assert.equal(JSON.stringify(h.itemCaso(plan,'A').payload.datos_origen.medio_pago_manual_v1),auditoria);
    const final=await h.aprobarCaso(plan,'B');listo(h,final,'A');listo(h,final,'B');
});
test('abrir/cerrar y cancelar B no cambia A ni su decisión',async()=>{
    const h=entornoAcumulado({servicioB:false}),plan=await prepararAmbos(h),a=listo(h,plan,'A');
    const decisiones=JSON.stringify([...h.decisiones]),fila=h.render(plan,h.itemCaso(plan,'B'));
    const boton=t=>fila.querySelectorAll('button').find(b=>b.textContent===t);
    await boton('Cambiar medio de pago').events.click();await boton('Cambiar medio de pago').events.click();
    await boton('Cambiar medio de pago').events.click();const selector=fila.querySelector('select');
    selector.value='efectivo';selector.events.change();await boton('Cancelar revisión').events.click();
    await assert.rejects(h.definirCaso(plan,'B','efectivo',{vigente:()=>false}),/cancelada/);
    const next=await h.preparar();listo(h,next,'A');listo(h,next,'B');
    assert.equal(JSON.stringify([...h.decisiones]),decisiones);assert.equal(h.itemCaso(next,'A').id,a.id);
    assert.equal(h.registrados.length,0);
});
test('cambiar medio de A recalcula A y conserva B',async()=>{
    const h=entornoAcumulado({servicioB:false}),previo=await prepararAmbos(h),a=listo(h,previo,'A');
    const plan=await h.definirCaso(previo,'A','webpay_credito');listo(h,plan,'B');
    assert.equal(h.itemCaso(plan,'A').id,a.id);assert.equal(h.itemCaso(plan,'A').categoria,'dudosos');
    assert.equal(h.aprobados.has(a.id),false);assert.equal(h.itemCaso(plan,'A').pagoLibro.medio_pago,'webpay_credito');
});
for(const cambio of ['evidencia','importe','origen','destino'])test('cambio real de A invalida sólo A: '+cambio,async()=>{
    const h=entornoAcumulado({servicioB:false}),previo=await prepararAmbos(h),a=listo(h,previo,'A');
    if(cambio==='evidencia')h.casos.pa.texto_original+=' evidencia corregida';
    if(cambio==='importe')h.casos.pa.monto++;
    if(cambio==='origen')h.casos.pa.origen.celda='C99:F99';
    if(cambio==='destino')h.tablas.reserva_estadias[0].reserva_id='00000000-0000-4000-8000-000000000099';
    const plan=await h.preparar();listo(h,plan,'B');assert.equal(h.aprobados.has(a.id),false);
    assert.equal(h.itemCaso(plan,'A').medioPagoManual,null);assert.equal(h.registrados.length,0);
});
test('cambio de cargo/saldo de A invalida A y conserva el servicio independiente B',async()=>{
    const h=entornoAcumulado({servicioA:true,mismaReserva:true}),plan=await prepararAmbos(h),a=listo(h,plan,'A');
    const servicioA=h.tablas.servicios.find(s=>s.catalogo_servicios.codigo==='tinajaTonel');
    h.tablas.vista_estado_cargos.find(c=>c.servicio_id===servicioA.id).saldo_cargo--;
    const next=await h.preparar();assert.equal(h.aprobados.has(a.id),false);assert.equal(h.itemCaso(next,'A').categoria,'dudosos');
    listo(h,next,'B');
});
test('un cargo compartido real invalida las dos decisiones que dependen de su saldo',async()=>{
    const h=entornoAcumulado({servicioA:true,mismaReserva:true});
    h.casos.pb.concepto='Tinaja Tonel';
    const cargo=h.tablas.vista_estado_cargos[0],servicio=h.tablas.servicios[0];
    cargo.monto=cargo.monto_ajustado=cargo.saldo_cargo=70000;servicio.total=servicio.precio_unitario_aplicado=70000;
    const plan=await prepararAmbos(h);listo(h,plan,'A');listo(h,plan,'B');
    cargo.saldo_cargo--;const next=await h.preparar();
    for(const caso of ['A','B']){
        assert.equal(h.aprobados.has(h.itemCaso(plan,caso).id),false);
        assert.equal(h.itemCaso(next,caso).categoria,'dudosos');
    }
});
for(const mismaReserva of [false,true])test('pago de sistema independiente de B no invalida A; misma reserva='+mismaReserva,async()=>{
    const h=entornoAcumulado({servicioB:false,mismaReserva}),plan=await prepararAmbos(h);
    h.tablas.pagos.push({id:'00000000-0000-4000-8000-000000000190',reserva_id:h.casos.reservaB,
        codigo_autorizacion:'OTRO40',monto:40000,medio_pago:'transferencia',moneda:'CLP',estado:'confirmado',tipo_movimiento:'pago'});
    const next=await h.preparar();listo(h,next,'A');
    assert.equal(h.itemCaso(next,'A').id,h.itemCaso(plan,'A').id);
});
test('identificador duplicado global continúa invalidando A; no permite payload viejo',async()=>{
    const h=entornoAcumulado({servicioB:false}),plan=await prepararAmbos(h),a=listo(h,plan,'A');
    h.tablas.pagos.push({id:'00000000-0000-4000-8000-000000000190',reserva_id:h.casos.reservaB,
        codigo_autorizacion:'KYLEIGH30',monto:30000,medio_pago:'webpay_credito',moneda:'CLP',estado:'confirmado',tipo_movimiento:'pago'});
    const next=await h.preparar();assert.equal(h.aprobados.has(a.id),false);assert.equal(h.itemCaso(next,'A').categoria,'dudosos');
    await assert.rejects(h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db),/cambió/);
    assert.equal(h.registrados.length,0);
});
test('pago de B con identificador diferente y mismo importe que A conserva A',async()=>{
    const h=entornoAcumulado({servicioB:false,mismaReserva:true}),plan=await prepararAmbos(h);
    h.tablas.pagos.push({id:'00000000-0000-4000-8000-000000000190',reserva_id:h.casos.reservaB,
        codigo_autorizacion:'JOSEPH40',monto:30000,medio_pago:'webpay_debito',moneda:'CLP',estado:'confirmado',tipo_movimiento:'pago'});
    const next=await h.preparar();listo(h,next,'A');assert.equal(h.aprobados.has(h.itemCaso(plan,'B').id),false);
});
test('nuevo candidato sin identificador del mismo importe invalida A para revisar duplicados',async()=>{
    const h=entornoAcumulado({servicioB:false}),plan=await prepararAmbos(h),a=listo(h,plan,'A');
    h.tablas.pagos.push({id:'00000000-0000-4000-8000-000000000190',reserva_id:h.tablas.reserva_estadias[0].reserva_id,
        monto:30000,medio_pago:'tarjeta_credito',moneda:'CLP',estado:'confirmado',tipo_movimiento:'pago'});
    const next=await h.preparar();assert.equal(h.aprobados.has(a.id),false);listo(h,next,'B');
});
test('payload final e incorporación contienen A+B una vez con auditorías independientes',async()=>{
    const h=entornoAcumulado(),plan=await prepararAmbos(h),a=listo(h,plan,'A'),b=listo(h,plan,'B');
    const payload=h.Q.serializarIncorporacion(plan).filter(i=>i.tipo==='pago'||i.tipo==='pago_servicios_4c');
    assert.equal(payload.length,2);assert.equal(new Set(payload.map(i=>i.item_id)).size,2);
    for(const [i,p,medio] of [[a,h.casos.pa,'tarjeta_credito'],[b,h.casos.pb,'tarjeta_debito']]){
        const d=i.payload.datos_origen.medio_pago_manual_v1;assert.equal(d.medio,medio);assert.deepEqual({...d.origen},{...p.origen});
        assert.equal(d.evidencia_original.monto,p.monto);assert.ok(i.id.endsWith(JSON.stringify(p)));
    }
    await h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db);
    assert.equal(h.registrados.length,2);assert.equal(h.tablas.pagos.length,2);
    await assert.rejects(h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db),/cambió/);
    assert.equal(h.registrados.length,2);assert.equal(new Set(h.registrados.map(i=>i.item_id)).size,2);
});
