const test=require('node:test'),assert=require('node:assert/strict');
const {entorno,id,ACCION,AVISO}=require('./fixtures/libro-airbnb-confirmacion-manual.cjs');
const pago=plan=>plan.items.find(i=>i.pagoLibro);
const escrituras=h=>h.llamadas.filter(x=>x.nombre);

test('Airbnb sin fecha permanece en revisión, permite completar confirmación y conserva la evidencia original',async()=>{
    const h=entorno(),original=JSON.stringify(h.r),plan=await h.preparar(),item=pago(plan);
    assert.equal(item.categoria,'dudosos');assert.equal(item.manualPago.tipo,'confirmacion_airbnb');
    assert.ok(item.motivos.some(m=>/fecha del comprobante/.test(m)));
    assert.equal(item.payload.argumentos.p_fecha_pago,null);assert.equal(item.aprobable,false);
    assert.equal(escrituras(h).length,0);assert.equal(JSON.stringify(h.r),original);
});

test('Agustin atraviesa el parser y canon reales, completa sólo la fecha en el plan y conserva ambas representaciones originales',async()=>{
    const sheet={celdas:[
        {r:1,c:2,valor:'6 oct',fechaISO:'2026-10-06'},{r:1,c:6,valor:'7 oct',fechaISO:'2026-10-07'},
        {r:2,c:0,valor:'cabaña 4'},{r:2,c:2,valor:'Agustin Rampa Spinelli // 2 ADL // 0 niños // 0 mascotas'},
        {r:24,c:2,valor:'Pagos de arriendos de hoy'},{r:26,c:0,valor:'cabaña 4'},
        {r:26,c:3,valor:'Agustin Rampa Spinelli // '+AVISO},{r:26,c:4,valor:'cab4/1noche'},
        {r:26,c:5,valor:'$165.598',valorNumero:165598}
    ],combinaciones:[{s:{r:26,c:0},e:{r:28,c:0}}]};
    const original=JSON.stringify(sheet),raw=global.HAIKU_LIBRO_SEMANTICA.normalizarHoja(sheet,'Oct26');
    const rawOriginal=JSON.stringify(raw),canon=global.HAIKU_LIBRO_PAGOS_CANON_V1.corregirResultado(raw);
    const canonicalOriginal=JSON.stringify(canon),h=entorno();h.result.reservas=canon.reservas;
    const first=await h.preparar();assert.equal(pago(first).manualPago.tipo,'confirmacion_airbnb');
    const next=await h.resolver(first,pago(first));assert.equal(pago(next).categoria,'pagos');
    assert.equal(pago(next).payload.argumentos.p_fecha_pago,ACCION.fecha);
    assert.equal(pago(next).payload.argumentos.p_monto,165598);
    assert.equal(pago(next).payload.argumentos.p_medio_pago,'airbnb_prepaid_card');
    assert.equal(JSON.stringify(sheet),original);assert.equal(JSON.stringify(raw),rawOriginal);
    assert.equal(JSON.stringify(canon),canonicalOriginal);assert.equal(escrituras(h).length,0);
});

test('sólo se ofrece para reserva inequívoca, monto válido y evidencia Airbnb válida de alojamiento',async()=>{
    for(const options of [{pagoExtra:{monto:0}},{pagoExtra:{monto:1.5}},
        {pagoExtra:{texto_original:'Airbnb'}},{pagoExtra:{medio_pago:'transferencia'}},
        {pagoExtra:{tipo_movimiento:'servicio'}},{pagoExtra:{fecha_comprobante:'2026-10-05'}},
        {reservaExtra:{tipo_estadia:'full_day'}}]) {
        const h=entorno(options);assert.notEqual(pago(await h.preparar())?.manualPago?.tipo,'confirmacion_airbnb');
    }
    for(const estado of ['cancelada','no_show']) {
        const h=entorno();h.tablas.reserva_estadias[0].reservas.estado_reserva=estado;
        assert.equal(pago(await h.preparar())?.manualPago,null);
    }
    const h=entorno();h.tablas.reserva_estadias.push({...structuredClone(h.tablas.reserva_estadias[0]),id:id(3)});
    assert.equal(pago(await h.preparar())?.manualPago,null);
});

test('fecha válida y confirmación explícita resuelven los dos requisitos, sin escribir ni cambiar el XLSX',async()=>{
    const h=entorno(),original=JSON.stringify(h.r),plan=await h.preparar(),antes=pago(plan);
    const next=await h.resolver(plan,antes),item=pago(next),a=item.payload.argumentos;
    assert.equal(item.id,antes.id,'identidad estable independiente de la fecha manual');
    assert.equal(item.categoria,'pagos');assert.deepEqual(item.motivos,[]);assert.equal(item.seleccionado,true);
    assert.equal(a.p_fecha_pago,ACCION.fecha);assert.equal(a.p_monto,165598);assert.equal(a.p_medio_pago,'airbnb_prepaid_card');
    assert.equal(a.p_referencia_externa,null);for(const k of ['p_folio','p_bove','p_codigo_autorizacion'])assert.equal(a[k],null);
    assert.equal(item.pagoLibro.fecha_comprobante,null);assert.equal(JSON.stringify(h.r),original);
    assert.equal(escrituras(h).length,0);assert.equal(h.decisiones.size,1);assert.equal(h.aprobados.size,1);
    assert.equal(item.payload.datos_origen.source_fingerprint,antes.payload.datos_origen.source_fingerprint);
    assert.equal(item.payload.datos_origen.evidencia_libro.fecha_comprobante,null);
});

test('fecha ausente/imposible y checkbox ausente rechazan sin guardar decisiones',async()=>{
    for(const action of [{...ACCION,fecha:''},{...ACCION,fecha:'2026-02-31'},
        {...ACCION,fecha:'04-10-2026'},{...ACCION,confirmacionRecibida:false},{...ACCION,confirmacionRecibida:undefined}]) {
        const h=entorno(),plan=await h.preparar();await assert.rejects(h.resolver(plan,pago(plan),action),/fecha real|Confirma/);
        assert.equal(h.decisiones.size,0);assert.equal(h.aprobados.size,0);assert.equal(escrituras(h).length,0);
    }
});

test('referencia externa es opcional, sólo se conserva la proporcionada o existente y no sustituye la fecha',async()=>{
    for(const [ref,original,expected] of [[undefined,undefined,null],[' AIR-REAL ',undefined,'AIR-REAL'],['', 'CB-REAL','CB-REAL']]) {
        const h=entorno({pagoExtra:{referencia_externa:original}}),plan=await h.preparar();
        const next=await h.resolver(plan,pago(plan),{...ACCION,referencia:ref});
        assert.equal(pago(next).payload.argumentos.p_referencia_externa,expected);assert.equal(escrituras(h).length,0);
    }
});

test('cancelar durante revalidación no guarda la decisión ni registra pagos',async()=>{
    for(const despuesDeAplicar of [false,true]) {
        const h=entorno(),plan=await h.preparar();let vigente=true;
        h.opciones.antesLectura=async()=>{if(!despuesDeAplicar || h.decisiones.size)vigente=false};
        await assert.rejects(h.resolver(plan,pago(plan),{...ACCION,vigente:()=>vigente}),/cancelada/);
        assert.equal(h.decisiones.size,0);assert.equal(h.aprobados.size,0);assert.equal(escrituras(h).length,0);
    }
});

test('una lectura fallida al reconstruir el plan no deja una aprobación parcial',async()=>{
    const h=entorno(),plan=await h.preparar();
    h.opciones.antesLectura=async()=>{if(h.decisiones.size)throw Error('Lectura interrumpida')};
    await assert.rejects(h.resolver(plan,pago(plan)),/Lectura interrumpida/);
    assert.equal(h.decisiones.size,0);assert.equal(h.aprobados.size,0);assert.equal(escrituras(h).length,0);
    h.opciones.antesLectura=null;assert.equal(pago(await h.preparar()).categoria,'dudosos');
});

test('revalida cambios de reserva, monto, medio, sesión y permisos; no conserva una aprobación vieja',async()=>{
    for(const change of [h=>h.tablas.reserva_estadias[0].reserva_id=id(3),h=>h.p.monto=165599,
        h=>h.p.medio_pago='efectivo',h=>h.tablas.reserva_estadias[0].reservas.estado_reserva='cancelada']) {
        const h=entorno(),plan=await h.preparar();change(h);
        await assert.rejects(h.resolver(plan,pago(plan)),/cambiaron|resolución/);
        assert.equal(h.decisiones.size,0);assert.equal(escrituras(h).length,0);
    }
    for(const change of [h=>h.cambiarUsuario(),h=>h.permisos.delete('pagos.registrar')]) {
        const h=entorno(),first=await h.preparar(),next=await h.resolver(first,pago(first));change(h);
        const revalidated=await h.preparar();assert.equal(pago(revalidated).categoria,'dudosos');
        assert.equal(h.decisiones.size,0);assert.equal(h.aprobados.size,0);assert.equal(escrituras(h).length,0);
    }
});

test('un pago existente por origen o referencia, o un candidato Airbnb compatible, impide aprobar dos veces',async()=>{
    for(const existing of [
        {medio_pago:'airbnb_prepaid_card',monto:165598,datos_origen:{}},
        {medio_pago:'airbnb_prepaid_card',monto:1,datos_origen:{origen:{hoja:'Oct26',celda:'O27:R27'}}},
        {medio_pago:'airbnb_prepaid_card',monto:1,reserva_id:id(88),referencia_externa:'AIR-REAL',datos_origen:{}}
    ]) {
        const h=entorno(),plan=await h.preparar();
        h.tablas.pagos.push({id:id(50),reserva_id:id(1),moneda:'CLP',estado:'confirmado',tipo_movimiento:'pago',fecha_pago:'2026-10-12',...existing});
        await assert.rejects(h.resolver(plan,pago(plan),{...ACCION,referencia:'AIR-REAL'}),/pagos.*cambiaron/);
        assert.equal(h.decisiones.size,0);assert.equal(escrituras(h).length,0);
    }
    const h=entorno();h.tablas.pagos.push({id:id(50),reserva_id:id(1),monto:165598,moneda:'CLP',medio_pago:'efectivo',estado:'confirmado'});
    assert.equal(pago(await h.preparar()).manualPago,null,'el monto parecido queda en revisión; no demuestra identidad Airbnb');
});

test('decisión invalidada al cambiar generación, SHA del Libro o monto, incluso antes de la incorporación final',async()=>{
    for(const change of [h=>h.cambiarLibro(),h=>h.cambiarVersion(),h=>h.p.monto=166000]) {
        const h=entorno(),first=await h.preparar(),next=await h.resolver(first,pago(first));change(h);
        await assert.rejects(h.incorporar(next),/Libro cambió|confirmación Airbnb cambió|aprobación manual/);
        assert.equal(escrituras(h).length,0);
        h.result.generacion=global.HAIKU_LIBRO_RESERVA_V1.estado().generacion;
        const refreshed=await h.preparar();assert.equal(pago(refreshed).categoria,'dudosos');
        assert.equal(h.decisiones.size,0);assert.equal(h.aprobados.size,0);
    }
});

test('incorporación normal conserva medio/fecha y crea sólo un pago por item/origen, sin convertir monto en identidad',async()=>{
    const h=entorno(),first=await h.preparar(),next=await h.resolver(first,pago(first),{...ACCION,referencia:'AIR-REAL'});
    assert.equal(h.tablas.pagos.length,0);await h.incorporar(next);await h.incorporar(next);
    assert.equal(h.tablas.pagos.length,1);const stored=h.tablas.pagos[0];
    assert.equal(stored.reserva_id,id(1));assert.equal(stored.monto,165598);assert.equal(stored.fecha_pago,ACCION.fecha);
    assert.equal(stored.medio_pago,'airbnb_prepaid_card');assert.equal(stored.referencia_externa,'AIR-REAL');
    for(const k of ['folio','bove','codigo_autorizacion'])assert.equal(stored[k],null);
    const refreshed=await h.preparar();assert.equal(pago(refreshed).manualPago,null);
    assert.equal(h.decisiones.size,0);assert.equal(h.aprobados.size,0);
});
