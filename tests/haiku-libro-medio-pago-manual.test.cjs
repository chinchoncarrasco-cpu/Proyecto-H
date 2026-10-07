const test=require('node:test'),assert=require('node:assert/strict');
const {entorno}=require('./fixtures/libro-medio-pago-manual.cjs');
const botones=fila=>fila.querySelectorAll('button');
const boton=(fila,t)=>botones(fila).find(e=>e.textContent===t);
const escrituras=h=>h.llamadas.filter(x=>x.nombre&&!x.nombre.includes('capacidad'));

for(const signal of ['TDC','PrePago','FC','PrePago / FC','TC','TD']) test(signal+' sigue desconocido sin elección explícita',()=>{
    const h=entorno({signal});assert.equal(h.C.medioDesdeTexto({texto_original:signal}),null);assert.equal(h.r.pagos[0].medio_pago,null);
    const celdas=[],combinaciones=[],cell=(r,c,valor,extra={})=>celdas.push({r,c,valor,...extra});
    for(const [c,d] of [[10,'03'],[14,'04']]) {
        cell(1,c,d+'-10-2026',{fechaISO:'2026-10-'+d});cell(24,c,'Pagos de arriendos de hoy');
        combinaciones.push({s:{r:24,c},e:{r:24,c:c+3}});
    }
    for(let cab=1;cab<=11;cab++) {
        cell(cab+1,0,'cabaña '+cab);const r=25+(cab-1)*5;cell(r,0,'cabaña '+cab);
        combinaciones.push({s:{r,c:0},e:{r:r+4,c:0}});
    }
    cell(4,10,'Persona Prueba // 2 ADL // 1 noche');cell(35,10,'3-10-2026',{fechaISO:'2026-10-03'});
    cell(35,11,'Persona Prueba // '+signal);cell(35,12,'cab3/1noche');cell(35,13,'30000',{valorNumero:30000});
    const parseado=require('../js/haiku-libro-semantica-v1.js').normalizarHoja({celdas,combinaciones,estilos:[]},'Oct26');
    assert.equal(parseado.pagos.length,1);assert.equal(parseado.pagos[0].medio_pago,null);
    assert.equal(h.C.corregirResultado(parseado).pagos[0].medio_pago,null);
});
test('medio único faltante y aprobable=false ofrecen formulario con siete medios, sin escrituras',async()=>{
    const h=entorno(),plan=await h.preparar(),i=h.item(plan),original=JSON.stringify(h.r),fila=h.render(plan);
    assert.equal(i.aprobable,false);assert.equal(i.manualPago.tipo,'definir_medio_pago');assert.equal(h.Q.resolucionManualDisponible(i),true);
    await boton(fila,'Aprobación manual').events.click();
    const panel=fila.querySelector('section'),selector=fila.querySelector('select');assert.equal(panel.hidden,false);
    assert.deepEqual(Array.from(selector.children).map(x=>x.value),['','transferencia','tarjeta_credito','tarjeta_debito','webpay_credito','webpay_debito','efectivo','airbnb_prepaid_card']);
    selector.value='tarjeta_credito';selector.events.change();assert.equal(boton(fila,'Confirmar medio y revalidar').disabled,false);
    await boton(fila,'Cancelar revisión').events.click();assert.equal(selector.value,'');assert.equal(panel.hidden,true);
    assert.equal(JSON.stringify(h.r),original);assert.equal(h.aprobados.size,0);assert.equal(escrituras(h).length,0);
});
for(const medio of ['tarjeta_credito','webpay_credito','transferencia','tarjeta_debito','webpay_debito','efectivo','airbnb_prepaid_card']) test('TDC + '+medio+' revalida sin aprobar/seleccionar, con ID original estable',async()=>{
    const h=entorno(),plan=await h.preparar(),id=h.item(plan).id,original=JSON.stringify(h.r);
    const next=await h.definir(plan,medio),i=h.item(next);
    assert.equal(i.id,id);assert.equal(i.pagoLibro.medio_pago,medio);assert.equal(i.categoria,'dudosos');assert.equal(i.seleccionado,false);
    assert.equal(i.payload.argumentos.p_medio_pago,medio);assert.equal(i.payload.aprobado_manualmente,false);
    assert.equal(i.payload.datos_origen.medio_pago_manual_v1.medio,medio);assert.equal(h.aprobados.size,0);
    assert.equal(i.pagoLibro.clasificacion_financiera,'pago_real');
    assert.equal(JSON.stringify(h.r),original);assert.equal(escrituras(h).length,0);
    assert.equal(h.item(await h.preparar()).id,id);assert.ok(!i.motivos.some(m=>/precisar el medio/.test(m)));
});
test('Joseph: definir medio revela servicio faltante; crearlo vuelve a revalidar y requiere asociación explícita',async()=>{
    const h=entorno({alojamiento:false,signal:'PrePago / FC'}),plan=await h.preparar(),original=JSON.stringify(h.r);
    const next=await h.definir(plan,'tarjeta_credito'),i=h.item(next);
    assert.equal(i.manualPago.tipo,'crear_servicio_faltante');assert.equal(escrituras(h).length,0);assert.equal(h.aprobados.size,0);
    const posterior=await h.resolver(next,i,{tipo:'crear_servicio_faltante',indice:0,codigo:'tinajaTonel',fecha:'2026-10-03',cantidad:1,personas:2,precio:30000,tipoCobro:'normal',precioManualConfirmado:true});
    const j=h.item(posterior);assert.equal(j.pagoLibro.medio_pago,'tarjeta_credito');assert.equal(j.manualPago.tipo,'asociacion_pago');
    assert.equal(j.categoria,'dudosos');assert.equal(j.seleccionado,false);assert.equal(h.aprobados.size,0);
    assert.equal(JSON.stringify(h.r),original);assert.deepEqual(Array.from(escrituras(h),x=>x.nombre),['haiku_registrar_servicio']);
});
test('reserva ambigua no ofrece resolver y servicio con identidad débil conserva el bloqueo después de elegir',async()=>{
    const a=entorno();a.tablas.reserva_estadias.push({...a.tablas.reserva_estadias[0],id:'00000000-0000-4000-8000-000000000003',reserva_id:'00000000-0000-4000-8000-000000000004'});
    assert.equal(a.item(await a.preparar()).manualPago,null);
    const h=entorno({alojamiento:false,fuerte:false}),next=await h.definir(await h.preparar(),'transferencia'),i=h.item(next);
    assert.equal(i.categoria,'dudosos');assert.equal(i.manualPago,null);assert.equal(i.aprobable,false);assert.equal(i.seleccionado,false);
    const alojamiento=entorno({fuerte:false}),posterior=await alojamiento.definir(await alojamiento.preparar(),'tarjeta_credito');
    const j=alojamiento.item(posterior);assert.equal(j.aprobable,false);assert.ok(j.motivos.some(m=>/identificador fuerte/.test(m)));
    alojamiento.aprobados.add(j.id);assert.equal(alojamiento.item(await alojamiento.preparar()).categoria,'dudosos');
});
test('distribuido conserva un padre, aplicaciones y suma exacta; elegir medio revela distribución',async()=>{
    const h=entorno({alojamiento:false,distribuido:true}),plan=await h.preparar(),original=JSON.stringify(h.r);
    const next=await h.definir(plan,'tarjeta_debito'),i=h.item(next);
    assert.equal(next.items.filter(i=>i.pagoLibro).length,1);assert.equal(i.pagoLibro.monto,13000);
    assert.equal(i.pagoLibro.aplicaciones_libro.reduce((n,a)=>n+a.monto,0),13000);assert.equal(i.manualPago.tipo,'distribucion_comprobante');
    assert.equal(JSON.stringify(h.r),original);assert.equal(h.aprobados.size,0);
});
for(const cambio of ['monto','origen','evidencia','version','generacion','usuario','destino','saldo','estado_financiero','permiso']) test('invalida elección y aprobación por cambio de '+cambio,async()=>{
    const h=entorno({alojamiento:false,conServicios:true}),plan=await h.definir(await h.preparar(),'webpay_credito'),id=h.item(plan).id;h.aprobados.add(id);
    if(cambio==='monto')h.r.pagos[0].monto++;
    if(cambio==='origen')h.r.pagos[0].origen.celda='C99:F99';
    if(cambio==='evidencia')h.r.pagos[0].texto_original+=' evidencia cambiada';
    if(cambio==='version')h.version='b'.repeat(64);
    if(cambio==='generacion'){h.cambiarLibro();h.result.generacion++;}
    if(cambio==='usuario')h.usuario='00000000-0000-4000-8000-000000000091';
    if(cambio==='destino')h.tablas.reserva_estadias[0].reserva_id='00000000-0000-4000-8000-000000000004';
    if(cambio==='saldo')h.tablas.vista_estado_cargos[0].saldo_cargo--;
    if(cambio==='estado_financiero')h.tablas.servicios[0].estado_servicio='cancelado';
    if(cambio==='permiso')h.ctx.haikuTienePermiso=()=>false;
    const next=await h.preparar();assert.equal(h.aprobados.has(id),false);assert.equal(next.items.some(i=>i.medioPagoManual),false);assert.equal(escrituras(h).length,0);
});
test('cambiar medio invalida aprobación y solicitud anterior; un plan viejo no puede incorporarse',async()=>{
    const h=entorno(),first=await h.definir(await h.preparar(),'tarjeta_credito'),id=h.item(first).id;
    h.aprobados.add(id);const aprobado=await h.preparar();aprobado.solicitudPendiente={items:[],servicios:[]};
    const next=await h.definir(aprobado,'webpay_credito');assert.equal(h.item(next).id,id);assert.equal(h.aprobados.size,0);assert.equal(aprobado.solicitudPendiente,undefined);
    await assert.rejects(h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,aprobado,h.db),/decisión del medio|cambió/);assert.equal(escrituras(h).length,0);
});
test('cancelación durante revalidación y cambio de sesión al confirmar no guardan decisión',async()=>{
    const h=entorno(),plan=await h.preparar();await assert.rejects(h.definir(plan,'tarjeta_credito',{vigente:()=>false}),/cancelada/);
    h.usuario='00000000-0000-4000-8000-000000000091';await assert.rejects(h.definir(plan,'tarjeta_credito'),/sesión/);
    assert.equal(h.item(await h.preparar()).medioPagoManual,null);assert.equal(h.aprobados.size,0);
});
test('pago existente al revalidar no crea otro pago',async()=>{
    const h=entorno(),plan=await h.definir(await h.preparar(),'tarjeta_credito'),p=h.r.pagos[0];
    h.tablas.pagos.push({id:'00000000-0000-4000-8000-000000000050',reserva_id:h.tablas.reserva_estadias[0].reserva_id,monto:p.monto,moneda:'CLP',medio_pago:'tarjeta_credito',codigo_autorizacion:p.codigo_autorizacion,fecha_pago:p.fecha_comprobante,estado:'confirmado',tipo_movimiento:'pago'});
    const next=await h.preparar();assert.equal(h.aprobados.size,0);assert.equal(escrituras(h).length,0);
    assert.ok(next.items.filter(i=>i.pagoLibro).every(i=>i.seleccionado===false));
    assert.equal(h.tablas.pagos.length,1);assert.equal(next.items.some(i=>i.medioPagoManual),false);
});
test('cambio de sesión durante las lecturas de revalidación descarta la elección',async()=>{
    const h=entorno(),plan=await h.preparar(),auth=h.db.auth.getSession;let lecturas=0;
    h.db.auth.getSession=async()=>{if(++lecturas===4)h.usuario='00000000-0000-4000-8000-000000000091';return auth();};
    await assert.rejects(h.definir(plan,'tarjeta_credito'),/sesión|vuelve a definir el medio/);
    assert.equal(h.item(await h.preparar()).medioPagoManual,null);assert.equal(h.aprobados.size,0);assert.equal(escrituras(h).length,0);
});
test('cambio de versión al consultar capacidad impide usar la solicitud pendiente',async()=>{
    const h=entorno(),next=await h.definir(await h.preparar(),'tarjeta_credito');h.aprobados.add(h.item(next).id);
    const plan=await h.preparar(),rpc=h.db.rpc;
    h.db.rpc=async(n,a)=>{const r=await rpc(n,a);if(n==='haiku_libro_medio_pago_manual_capacidad_v1')h.version='b'.repeat(64);return r;};
    await assert.rejects(h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db),/medio o el Libro cambió/);
    assert.equal(escrituras(h).length,0);
});
test('WebPay genérico exige subtipo y nunca ofrece otro; valores inválidos no llegan al writer',async()=>{
    const h=entorno({signal:'WebPay'});h.r.pagos[0].medio_pago='webpay';const plan=await h.preparar();assert.equal(h.item(plan).manualPago.tipo,'definir_medio_pago');
    for(const medio of ['webpay','otro','TDC','inventado','']) await assert.rejects(h.definir(plan,medio),/medio de pago válido/);
    const next=await h.definir(plan,'webpay_debito');assert.equal(h.item(next).pagoLibro.medio_pago,'webpay_debito');assert.equal(escrituras(h).length,0);
});
test('incorporación sólo tras aprobación posterior; requiere capacidad de auditoría y usa medio canónico',async()=>{
    const h=entorno(),next=await h.definir(await h.preparar(),'tarjeta_credito');
    await assert.rejects(h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,next,h.db),/Selecciona/);
    h.aprobados.add(h.item(next).id);const plan=await h.preparar();h.auditoriaDisponible=false;
    await assert.rejects(h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db),/auditoría/);assert.equal(escrituras(h).length,0);
    h.auditoriaDisponible=true;await h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db);
    const item=escrituras(h)[0].args.p_items[0];assert.equal(item.argumentos.p_medio_pago,'tarjeta_credito');assert.equal(item.aprobado_manualmente,true);
    assert.equal(item.datos_origen.medio_pago_manual_v1.medio,'tarjeta_credito');assert.ok(!JSON.stringify(item.datos_origen.medio_pago_manual_v1).includes('Ignacio'));
});
