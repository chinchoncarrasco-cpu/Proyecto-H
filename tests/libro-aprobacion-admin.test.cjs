const test=require('node:test'),assert=require('node:assert/strict');
const {entorno,consulta}=require('./fixtures/libro-servicio-manual.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
function caso(){
    const e=entorno(),r=e.state.reservas[0],est=e.state.db.reserva_estadias[0],catalogo=e.state.db.catalogo_servicios;
    e.state.reservas=[r];
    r.texto_original='PROMO HAKU // JACUZZI A LAS 17:15 HASTA LAS 20:30';
    r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
    r.pagos=[];r.pagos_sin_asociacion=[];e.state.db.pagos=[];
    e.c.haikuSesion={auth:{id:e.state.usuario},usuario:{activo:true},roles:[{codigo:'administrador'}]};
    e.c.haikuTienePermiso=()=>true;
    e.state.db.servicios=[{id:'tinaja-existente',reserva_id:est.reserva_id,estadia_id:est.id,
        catalogo_servicio_id:catalogo[0].id,recurso_id:null,fecha_servicio:r.fecha_checkin,
        hora_inicio:'16:15:00',hora_fin:'18:15:00',cantidad:2,personas:2,total:30000,
        precio_unitario_aplicado:15000,monto_adicional:0,tipo_cobro:'normal',estado_servicio:'programado',
        actualizado_en:'2026-10-10T10:00:00Z',catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tonel de madera'}}];
    e.state.db.vista_estado_cargos=[{cargo_id:'cargo',reserva_id:est.reserva_id,estadia_id:est.id,
        servicio_id:'tinaja-existente',monto:30000,monto_ajustado:30000,aplicado_neto:30000,saldo_cargo:0,estado:'activo'}];
    const out=new e.Element('div');e.document.card=out;
    return {...e,r,out};
}
async function abrir(e){
    e.api.renderizar(await e.construir(),e.out,consulta);
    const boton=e.out.querySelectorAll('button').find(b=>b.textContent==='Aprobación manual');assert.ok(boton);
    await boton.listeners.click();const panel=e.out.querySelector('.haku-libro-servicio-manual');assert.ok(panel);
    return {panel,confirmar:panel.querySelectorAll('button').find(b=>b.dataset.hakuAccion==='confirmar-revision-admin'),
        campo:k=>panel.querySelectorAll('input,select').find(x=>x.dataset.revisionAdmin===k)};
}
function writer(e,{perder=false}={}){
    const operaciones=new Map(),llamadas=[];
    e.c.haikuSupabase.rpc=async(nombre,p)=>{
        assert.equal(nombre,'haiku_libro_revision_servicio_admin_v1');llamadas.push(copy(p));
        if(operaciones.has(p.p_operacion_id))return {data:operaciones.get(p.p_operacion_id)};
        const s=e.state.db.servicios[0],estado={...p.p_esperado};delete estado.actualizado_en;
        if(p.p_modo==='actualizar'){
            const c=e.state.db.catalogo_servicios.find(c=>c.codigo===p.p_codigo);
            Object.assign(s,{catalogo_servicio_id:c.id,catalogo_servicios:{codigo:c.codigo,nombre:c.nombre},hora_inicio:p.p_inicio+':00',hora_fin:p.p_fin+':00'});
            Object.assign(estado,{catalogo_servicio_id:c.id,hora_inicio:p.p_inicio,hora_fin:p.p_fin});
        }
        s.libro_revision_admin_v1={version:1,item_id:p.p_item_id,firma:p.p_firma,motivo:p.p_motivo,estado,
            modo:p.p_modo,operacion_id:p.p_operacion_id,fecha:'2026-10-20T14:16:00Z'};
        s.actualizado_en='2026-10-20T06:00:00Z';
        const resultado={ok:true,servicio_id:s.id,total:s.total,revision:copy(s.libro_revision_admin_v1)};operaciones.set(p.p_operacion_id,resultado);
        if(perder){perder=false;throw Error('Respuesta perdida');}return {data:resultado};
    };return llamadas;
}
function completar(form,modo='conservar'){
    form.campo('modo').value=modo;form.campo('modo').listeners.change();
    form.campo('motivo').value='Verificado por el administrador';form.campo('aceptar').checked=true;form.campo('aceptar').listeners.change();
    assert.equal(form.confirmar.disabled,false);
}
test('administrador siempre ve aprobación y el conflicto pagado abre comparación, importe y decisión',async()=>{
    const e=caso(),antes=JSON.stringify(e.state.db),f=await abrir(e);
    assert.match(f.panel.textContent,/Tonel de madera.*16:15–18:15/);assert.match(f.panel.textContent,/17:15–20:30/);
    assert.match(f.panel.textContent,/Pagado \$30\.000 · saldo \$0/);assert.match(f.panel.textContent,/2 unidades registradas/);
    assert.equal(f.confirmar.disabled,true);assert.equal(JSON.stringify(e.state.db),antes);assert.equal(e.state.escrituras.length,0);
});
test('conservar acepta sólo esa evidencia y no altera servicio ni finanzas; el botón sigue visible',async()=>{
    const e=caso(),llamadas=writer(e),s=copy(e.state.db.servicios[0]),finanzas=copy(e.state.db.vista_estado_cargos),f=await abrir(e);
    completar(f);await f.confirmar.listeners.click();assert.equal(llamadas.length,1);
    const actual=(await e.construir()).items.find(x=>x.kind==='servicio');assert.equal(actual.estado,'existente');
    assert.equal(actual.hora,'16:15');assert.equal(actual.mapa.codigo,'tinajaTonel');
    for(const k of Object.keys(s).filter(k=>k!=='actualizado_en'))assert.deepEqual(e.state.db.servicios[0][k],s[k],k);
    assert.deepEqual(e.state.db.vista_estado_cargos,finanzas);assert.equal(e.state.escrituras.length,0);
    assert.ok(e.out.querySelectorAll('button').some(b=>b.textContent==='Aprobación manual'));
    const recibo=e.out.querySelector('.haku-libro-revision-admin-resultado');assert.ok(recibo);
    assert.match(recibo.textContent,/Aprobación guardada.*Conservar lo registrado/);
    assert.match(recibo.textContent,/IN: 10\.10\.26/);assert.match(recibo.textContent,/16:15–18:15/);
    assert.match(recibo.textContent,/Importe acordado: \$30\.000.*saldo \$0/);
    assert.match(recibo.textContent,/Motivo: Verificado por el administrador/);assert.match(recibo.textContent,/Confirmado:.*11:16.*Chile/);
    assert.equal(recibo.querySelectorAll('input,button').length,0);
    e.r.texto_original='PROMO HAKU // JACUZZI A LAS 18:15 HASTA LAS 21:30';
    e.r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(e.r.texto_original,{origen_campo:'notas_reserva'});
    assert.equal((await e.construir()).items.find(x=>x.kind==='servicio').estado,'revisar','otra evidencia exige revisión nueva');
});
test('corregir cambia tipo y horario del mismo servicio y conserva cantidad, precio y pago',async()=>{
    const e=caso(),llamadas=writer(e),finanzas=copy(e.state.db.vista_estado_cargos),f=await abrir(e);completar(f,'actualizar');
    await Promise.all([f.confirmar.listeners.click(),f.confirmar.listeners.click()]);assert.equal(llamadas.length,1);
    const s=e.state.db.servicios[0];assert.equal(e.state.db.servicios.length,1);assert.equal(s.id,'tinaja-existente');
    assert.equal(s.catalogo_servicios.codigo,'tinajaJacuzzi');assert.equal(s.hora_inicio,'17:15:00');assert.equal(s.hora_fin,'20:30:00');
    assert.equal(s.total,30000);assert.equal(s.cantidad,2);assert.equal(s.precio_unitario_aplicado,15000);
    assert.deepEqual(e.state.db.vista_estado_cargos,finanzas);assert.equal(e.state.escrituras.length,0);
    const recibo=e.out.querySelector('.haku-libro-revision-admin-resultado');
    assert.match(recibo.textContent,/Jacuzzi.*Corregir tipo y horario.*17:15–20:30/);
});
test('reintento tras respuesta perdida usa la misma operación y conserva una sola tinaja',async()=>{
    const e=caso(),llamadas=writer(e,{perder:true}),f=await abrir(e);completar(f,'actualizar');
    await f.confirmar.listeners.click();assert.match(f.panel.textContent,/Respuesta perdida/);
    assert.equal(e.out.querySelectorAll('.haku-libro-revision-admin-resultado').length,0,'sin respuesta no anuncia éxito');
    await f.confirmar.listeners.click();assert.equal(llamadas.length,2);assert.deepEqual(llamadas[0],llamadas[1]);
    assert.equal(e.state.db.servicios.length,1);assert.equal((await e.construir()).items.find(x=>x.kind==='servicio').estado,'existente');
    assert.equal(e.out.querySelectorAll('.haku-libro-revision-admin-resultado').length,1);
});
test('la decisión confirmada reaparece al volver a revisar la ficha y el recibo no provoca otra escritura',async()=>{
    const e=caso(),llamadas=writer(e),f=await abrir(e);completar(f);await f.confirmar.listeners.click();
    const nueva=new e.Element('div');e.api.renderizar(await e.construir(),nueva,consulta);
    assert.equal(nueva.querySelectorAll('.haku-libro-revision-admin-resultado').length,1);
    assert.match(nueva.textContent,/Conservar lo registrado.*16:15–18:15/);assert.equal(llamadas.length,1);
    e.r.texto_original='PROMO HAKU // JACUZZI A LAS 18:15 HASTA LAS 21:30';
    e.r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(e.r.texto_original,{origen_campo:'notas_reserva'});
    const cambiada=new e.Element('div');e.api.renderizar(await e.construir(),cambiada,consulta);
    assert.equal(cambiada.querySelectorAll('.haku-libro-revision-admin-resultado').length,0,'otra evidencia no hereda una aprobación');
    assert.equal(llamadas.length,1);
});
test('un fallo del servidor o un recibo de otra operación nunca muestra aprobación guardada',async()=>{
    for(const respuesta of [{error:{message:'No se guardó'}},{data:{ok:true,servicio_id:'tinaja-existente',total:30000,
        revision:{version:1,operacion_id:'otra-operacion'}}}]){
        const e=caso(),f=await abrir(e);e.c.haikuSupabase.rpc=async()=>respuesta;completar(f);await f.confirmar.listeners.click();
        assert.equal(e.out.querySelectorAll('.haku-libro-revision-admin-resultado').length,0);
        assert.match(f.panel.textContent,/No se guardó|no confirmó/);
    }
});
test('si se guardó pero falla el refresco, muestra el comprobante y reintenta sólo la lectura',async()=>{
    const e=caso(),llamadas=writer(e),f=await abrir(e),rpc=e.c.haikuSupabase.rpc;
    const consultar=e.c.HAIKU_LIBRO_RESERVA_V1.consultarHoja;
    e.c.haikuSupabase.rpc=async(...args)=>{const result=await rpc(...args);
        e.c.HAIKU_LIBRO_RESERVA_V1.consultarHoja=async()=>{throw Error('Lectura interrumpida');};return result;};
    completar(f);await f.confirmar.listeners.click();assert.equal(llamadas.length,1);
    assert.match(f.panel.textContent,/Aprobación guardada\. Falta actualizar la lista/);
    assert.equal(e.out.querySelectorAll('.haku-libro-revision-admin-resultado').length,1);
    e.c.HAIKU_LIBRO_RESERVA_V1.consultarHoja=consultar;
    await f.confirmar.listeners.click();assert.equal(llamadas.length,1);
    assert.equal(e.out.querySelectorAll('.haku-libro-revision-admin-resultado').length,1);
    assert.equal(e.out.querySelectorAll('.haku-libro-servicio-manual').length,0);
});
test('el comprobante conserva visibles los demás servicios que requieren revisión',async()=>{
    const e=caso();e.r.texto_original+=' // 1 MASAJE DE 1 HORA';
    e.r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(e.r.texto_original,{origen_campo:'notas_reserva'});
    writer(e);const f=await abrir(e);completar(f);await f.confirmar.listeners.click();
    assert.equal(e.out.querySelectorAll('.haku-libro-revision-admin-resultado').length,1);
    const pendiente=e.out.querySelector('.haku-libro-servicios__seccion--revision');assert.match(pendiente.textContent,/1 MASAJE DE 1 HORA/);
    assert.ok(pendiente.querySelectorAll('button').some(b=>b.textContent==='Aprobación manual'));
});
test('cambios de evidencia, servicio, pagos o rol impiden confirmar la vista obsoleta',async()=>{
    for(const cambiar of [e=>e.state.generacion++,e=>e.state.db.servicios[0].total=40000,
        e=>e.state.db.vista_estado_cargos[0].saldo_cargo=10000,e=>e.c.haikuSesion.roles=[]]){
        const e=caso(),llamadas=writer(e),f=await abrir(e);completar(f);cambiar(e);await f.confirmar.listeners.click();
        assert.equal(llamadas.length,0);assert.match(f.panel.textContent,/cambió|cambiaron/);
    }
});
test('sin permiso de edición el administrador ve el botón y la comparación, sin poder guardar',async()=>{
    const e=caso();e.c.haikuTienePermiso=p=>p==='pagos.ver';const f=await abrir(e);
    assert.equal(f.confirmar.disabled,true);assert.match(f.panel.textContent,/permiso para editar servicios/);
});
test('recepción conserva el bloqueo del conflicto pagado y un caso ambiguo tiene revisión para administrador',async()=>{
    const e=caso();e.c.haikuSesion.roles=[{codigo:'recepcion'}];e.api.renderizar(await e.construir(),e.out,consulta);
    assert.ok(!e.out.querySelectorAll('button').some(b=>b.textContent==='Aprobación manual'));
    e.c.haikuSesion.roles=[{codigo:'administrador'}];e.state.db.servicios=[];
    e.r.servicios=[{concepto:'jacuzzi',texto_original:'Mención ambigua de Jacuzzi',semantica:'AMBIGUO',origen_campo:'notas_reserva'}];
    const f=await abrir(e);assert.match(f.panel.textContent,/Revisar evidencia/);assert.match(f.panel.textContent,/Mención ambigua de Jacuzzi/);
    assert.ok(f.panel.querySelectorAll('button').some(b=>b.textContent==='Revalidar ficha'));assert.equal(e.state.escrituras.length,0);
});
