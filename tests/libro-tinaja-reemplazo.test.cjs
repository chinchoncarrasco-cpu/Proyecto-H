const test=require('node:test'),assert=require('node:assert/strict');
const {entorno,consulta}=require('./fixtures/libro-servicio-manual.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
function caso(anterior='JACUZZI 20:45 X PAGAR',actual='TONEL DE MADERA 19:15 HRS X PAGAR'){
    const e=entorno(),r=e.state.reservas[0],est=e.state.db.reserva_estadias[0];
    e.state.reservas=[r];r.texto_original=actual;
    r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(actual,{origen_campo:'notas_reserva'});
    const codigo=/jacuzzi/i.test(anterior)?'tinajaJacuzzi':'tinajaTonel';
    const catalogo=e.state.db.catalogo_servicios.find(c=>c.codigo===codigo);
    const hora=anterior.match(/\b(\d{2}):(\d{2})\b/)[0],fin=String(Number(hora.slice(0,2))+1).padStart(2,'0')+hora.slice(2);
    const s={id:'tinaja-original',reserva_id:est.reserva_id,estadia_id:est.id,
        catalogo_servicio_id:catalogo.id,recurso_id:null,fecha_servicio:r.fecha_checkin,
        hora_inicio:hora+':00',hora_fin:fin+':00',cantidad:1,personas:2,total:30000,
        precio_unitario_aplicado:30000,monto_adicional:0,tipo_cobro:'normal',estado_servicio:'programado',
        observaciones:'Importado desde Libro de Reserva. '+anterior+'\n[HAKU-LIBRO-SERVICIO:srv:original]',
        actualizado_en:'2026-10-10T10:00:00Z',catalogo_servicios:{codigo,nombre:catalogo.nombre}};
    e.state.db.servicios=[s];
    e.state.db.vista_estado_cargos=[{cargo_id:'cargo-original',reserva_id:est.reserva_id,estadia_id:est.id,
        servicio_id:s.id,monto:30000,monto_ajustado:30000,aplicado_neto:30000,saldo_cargo:0,estado:'activo'}];
    e.state.db.pagos=[{id:'pago-original',reserva_id:est.reserva_id,monto:30000,tipo_movimiento:'pago',estado:'confirmado'}];
    e.c.haikuSesion={auth:{id:e.state.usuario},usuario:{activo:true},roles:[{codigo:'administrador'}]};
    e.c.haikuTienePermiso=()=>true;
    const cambiar=texto=>{r.texto_original=texto;r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto,{origen_campo:'notas_reserva'});};
    return {...e,r,s,cambiar,item:async()=>((await e.construir()).items.find(i=>i.kind==='servicio'))};
}
function writer(e,{perder=false}={}){
    const operaciones=new Map(),llamadas=[];let perdido=false;
    e.c.haikuSupabase.rpc=async(nombre,p)=>{
        assert.equal(nombre,'haiku_libro_revision_servicio_admin_v1');llamadas.push(copy(p));
        if(operaciones.has(p.p_operacion_id))return {data:operaciones.get(p.p_operacion_id)};
        assert.equal(p.p_modo,'actualizar');assert.equal(p.p_conservar_importe,true);assert.equal(p.p_servicio_id,e.s.id);
        const catalogo=e.state.db.catalogo_servicios.find(c=>c.codigo===p.p_codigo);
        const estado={...p.p_esperado,catalogo_servicio_id:catalogo.id,hora_inicio:p.p_inicio,hora_fin:p.p_fin};
        delete estado.actualizado_en;
        Object.assign(e.s,{catalogo_servicio_id:catalogo.id,catalogo_servicios:{codigo:catalogo.codigo,nombre:catalogo.nombre},
            hora_inicio:p.p_inicio+':00',hora_fin:p.p_fin+':00',actualizado_en:'2026-10-10T10:01:00Z'});
        e.s.libro_revision_admin_v1={version:1,item_id:p.p_item_id,firma:p.p_firma,modo:p.p_modo,
            motivo:p.p_motivo,usuario:e.state.usuario,operacion_id:p.p_operacion_id,fecha:'2026-10-10T10:01:00Z',estado};
        const data={ok:true,operacion_id:p.p_operacion_id,servicio_id:e.s.id,total:e.s.total,revision:e.s.libro_revision_admin_v1};
        operaciones.set(p.p_operacion_id,copy(data));
        if(perder&&!perdido){perdido=true;return {error:{message:'Respuesta perdida'}};}
        return {data};
    };
    return llamadas;
}
async function abrir(e){
    const out=new e.Element('div');e.document.card=out;e.api.renderizar(await e.construir(),out,consulta);
    const boton=out.querySelectorAll('button').find(b=>b.textContent==='Ver cambio del Libro');assert.ok(boton,'debe ofrecer el cambio del existente');
    await boton.listeners.click();
    const panel=out.querySelector('.haku-libro-servicio-manual');assert.ok(panel);
    const confirmar=panel.querySelectorAll('button').find(b=>b.dataset.hakuAccion==='confirmar-revision-admin');
    return {out,panel,confirmar};
}

for(const [anterior,actual,codigo,inicio,fin] of [
    ['JACUZZI 20:45 X PAGAR','TONEL DE MADERA 19:15 HRS X PAGAR','tinajaTonel','19:15','20:15'],
    ['JACUZZI 20:45 X PAGAR','JACUZZI 19:15 X PAGAR','tinajaJacuzzi','19:15','20:15'],
    ['TONEL 19:15 X PAGAR','JACUZZI 20:45 X PAGAR','tinajaJacuzzi','20:45','21:45']
])test('borrado y reemplazo se reconoce sin duplicar: '+anterior+' → '+actual,async()=>{
    const e=caso(anterior,actual),antes=JSON.stringify(e.state.db),i=await e.item();
    assert.equal(i.estado,'revisar');assert.equal(i.payload,null);assert.equal(i.identidad,'MISMO_SERVICIO_MODIFICADO');
    assert.equal(i.servicio_existente.id,e.s.id);assert.equal(i.reemplazoLibro.aplicable,true);
    assert.deepEqual(copy([i.reemplazoLibro.codigo,i.reemplazoLibro.hora,i.reemplazoLibro.fin]),[codigo,inicio,fin]);
    assert.match(i.razones.join(' '),/Tinaja modificada en el Libro/);assert.doesNotMatch(i.razones.join(' '),/Posible modificación/);
    assert.equal(JSON.stringify(e.state.db),antes);assert.equal(e.state.escrituras.length,0);
});

test('si el anterior sigue escrito, la nueva tinaja es adicional y el anterior sigue existente',async()=>{
    const anterior='JACUZZI 20:45 X PAGAR',e=caso(anterior,anterior+' // TONEL 19:15 X PAGAR');
    const items=(await e.construir()).items.filter(i=>i.kind==='servicio');
    assert.equal(items.length,2);assert.equal(items.find(i=>i.mapa.codigo==='tinajaJacuzzi').estado,'existente');
    const nuevo=items.find(i=>i.mapa.codigo==='tinajaTonel');
    assert.equal(nuevo.estado,'listo');assert.ok(nuevo.payload);assert.equal(nuevo.reemplazoLibro,undefined);
});

test('una referencia del Libro incoherente o dos anteriores no eligen un reemplazo ni habilitan un alta',async()=>{
    for(const mutar of [
        e=>e.s.observaciones='Importado desde Libro de Reserva. JACUZZI 22:15 X PAGAR\n[HAKU-LIBRO-SERVICIO:srv:otra]',
        e=>e.state.db.servicios.push({...copy(e.s),id:'otro-anterior',hora_inicio:'22:15:00',hora_fin:'23:15:00'})
    ]){
        const e=caso();mutar(e);const i=await e.item();
        assert.equal(i.estado,'revisar');assert.equal(i.payload,null);assert.equal(i.reemplazoLibro,undefined);
        assert.equal(e.state.escrituras.length,0);
    }
});

test('un servicio agregado fuera del Libro no se considera descartado por una edición del Libro',async()=>{
    const e=caso();e.s.observaciones='Servicio agregado desde recepción';
    const i=await e.item();
    assert.equal(i.reemplazoLibro,undefined);assert.equal(i.estado,'listo');
    assert.equal(e.s.hora_inicio,'20:45:00');assert.equal(e.state.escrituras.length,0);
});

test('dos propuestas nuevas y una anterior requieren revisión sin anunciar una relación única',async()=>{
    const e=caso(undefined,'TONEL 19:15 X PAGAR // JACUZZI 22:15 X PAGAR');
    const items=(await e.construir()).items.filter(i=>i.kind==='servicio');
    assert.equal(items.length,2);
    for(const i of items){assert.equal(i.estado,'revisar');assert.equal(i.payload,null);assert.equal(i.reemplazoLibro,undefined);}
});

test('una tinaja conservada no impide reconocer el único reemplazo de la otra',async()=>{
    const e=caso(undefined,'TONEL 19:15 X PAGAR // TONEL 22:15 X PAGAR');
    const catalogo=e.state.db.catalogo_servicios.find(c=>c.codigo==='tinajaTonel');
    e.state.db.servicios.push({...copy(e.s),id:'tinaja-conservada',catalogo_servicio_id:catalogo.id,
        catalogo_servicios:{codigo:'tinajaTonel'},hora_inicio:'22:15:00',hora_fin:'23:15:00',
        observaciones:'Importado desde Libro de Reserva. TONEL 22:15 X PAGAR\n[HAKU-LIBRO-SERVICIO:srv:conservada]'});
    const items=(await e.construir()).items.filter(i=>i.kind==='servicio');
    assert.equal(items.find(i=>i.hora==='22:15').estado,'existente');
    assert.equal(items.find(i=>i.hora==='19:15').reemplazoLibro.servicio_id,'tinaja-original');
});

test('un cambio de precio, cortesía, personas, duración o estado no usa la aplicación directa',async()=>{
    for(const mutar of [
        e=>e.cambiar('TONEL 19:15 CORTESÍA'),
        e=>e.cambiar('TONEL 19:15 X PAGAR $40.000'),
        e=>e.s.personas=3,
        e=>e.cambiar('TONEL 19:15 2 HORAS X PAGAR'),
        e=>e.s.estado_servicio='realizado'
    ]){
        const e=caso();mutar(e);const i=await e.item();
        assert.equal(i.estado,'revisar');assert.equal(i.payload,null);assert.equal(i.reemplazoLibro?.aplicable,false);
        assert.equal(e.state.escrituras.length,0);
    }
});

test('aplicar cambia tipo y horario del mismo registro pagado sin agregar servicio, cargo ni pago',async()=>{
    const e=caso(),llamadas=writer(e),finanzas=copy([e.state.db.vista_estado_cargos,e.state.db.pagos]),f=await abrir(e);
    assert.match(f.out.textContent,/Tinajas modificadas en el Libro/);assert.match(f.panel.textContent,/Tinaja modificada en el Libro/);
    assert.match(f.panel.textContent,/Pagado \$30\.000/);assert.equal(f.confirmar.disabled,false);
    await Promise.all([f.confirmar.listeners.click(),f.confirmar.listeners.click()]);
    assert.equal(llamadas.length,1);assert.equal(llamadas[0].p_fin,'20:15');
    assert.equal(e.state.db.servicios.length,1);assert.equal(e.s.id,'tinaja-original');
    assert.equal(e.s.catalogo_servicios.codigo,'tinajaTonel');assert.equal(e.s.hora_inicio,'19:15:00');assert.equal(e.s.hora_fin,'20:15:00');
    assert.equal(e.s.total,30000);assert.equal(e.s.cantidad,1);assert.equal(e.s.precio_unitario_aplicado,30000);
    assert.deepEqual([e.state.db.vista_estado_cargos,e.state.db.pagos],finanzas);
    assert.equal((await e.item()).estado,'existente');assert.equal(e.state.escrituras.length,0);
});

test('un segundo cambio usa el último texto confirmado, aunque la observación conserve el primero',async()=>{
    const e=caso();writer(e);const f=await abrir(e);await f.confirmar.listeners.click();
    assert.match(e.s.observaciones,/JACUZZI 20:45/);
    e.cambiar('JACUZZI 22:15 X PAGAR');const i=await e.item();
    assert.equal(i.reemplazoLibro.aplicable,true);assert.match(i.reemplazoLibro.fuente_anterior.texto,/TONEL DE MADERA 19:15/);
    const segunda=await abrir(e);await segunda.confirmar.listeners.click();
    assert.equal(e.state.db.servicios.length,1);assert.equal(e.s.catalogo_servicios.codigo,'tinajaJacuzzi');
    assert.equal(e.s.hora_inicio,'22:15:00');assert.equal((await e.item()).estado,'existente');
});

test('respuesta perdida reintenta la misma operación y nunca crea otra tinaja',async()=>{
    const e=caso(),llamadas=writer(e,{perder:true}),f=await abrir(e);
    await f.confirmar.listeners.click();assert.match(f.panel.textContent,/Respuesta perdida/);
    await f.confirmar.listeners.click();assert.equal(llamadas.length,2);assert.deepEqual(llamadas[0],llamadas[1]);
    assert.equal(e.state.db.servicios.length,1);assert.equal((await e.item()).estado,'existente');
});

test('otra edición del Libro, servicio, cobro o sesión bloquea la vista anterior',async()=>{
    for(const mutar of [
        e=>e.cambiar('TONEL 17:45 X PAGAR'),
        e=>e.s.total=40000,
        e=>e.state.db.vista_estado_cargos[0].saldo_cargo=10000,
        e=>e.s.observaciones='Referencia anterior retirada',
        e=>e.c.haikuSesion.roles=[]
    ]){
        const e=caso(),llamadas=writer(e),f=await abrir(e);mutar(e);await f.confirmar.listeners.click();
        assert.equal(llamadas.length,0);assert.match(f.panel.textContent,/cambió|cambiaron/);
    }
});

test('roles sin edición no aplican el cambio y no se reemplazan tinajas de otra estadía',async()=>{
    const e=caso();e.c.haikuTienePermiso=p=>p==='pagos.ver';const f=await abrir(e);
    assert.equal(f.confirmar.disabled,true);assert.match(f.panel.textContent,/permiso para editar/);
    e.s.estadia_id='otra-estadia';const i=await e.item();
    assert.equal(i.reemplazoLibro,undefined);assert.equal(e.state.escrituras.length,0);
});

