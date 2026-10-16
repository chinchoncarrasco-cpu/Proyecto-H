const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../js/haiku-libro-semantica-v1.js');
const {entorno,consulta}=require('./fixtures/libro-servicio-manual.cjs');
const MASAJE='X PAGAR 2 MASAJES RELAJANTES DE 30 MINS COMENZANDO A LAS 19,00 HRS EL 03.10.26 CON MONICA';
const CABECERA='Huésped de prueba // 2adl // CO // 22-09-26';
const CUNA='AGREGAR CUNA EN EL ALOJAMIENTO BEBE DE 1 AÑO';
const servicios=t=>S.servicios(t,{origen_campo:'notas_reserva'});
function caso(texto=CABECERA+' // '+MASAJE){
    const e=entorno(),r=e.state.reservas[0],est=e.state.db.reserva_estadias[0];
    e.state.reservas=[r];r.fecha_checkin='2026-10-03';r.fecha_checkout='2026-10-04';
    est.fecha_ingreso=r.fecha_checkin;est.fecha_salida=r.fecha_checkout;
    const cambiar=t=>{r.texto_original=t;r.servicios=servicios(t);};cambiar(texto);
    e.c.haikuTienePermiso=p=>p==='pagos.ver';
    const abrir=[];e.c.HAIKU_INSPECTOR_V1={abrirReserva:id=>abrir.push(id)};
    const registrar=()=>{
        const s={id:'masaje-existente',reserva_id:est.reserva_id,estadia_id:est.id,
            catalogo_servicios:{codigo:'masajeDescontracturante30',nombre:'Masaje Descontracturante 30 min'},
            fecha_servicio:'2026-10-03',hora_inicio:'19:00:00',hora_fin:'19:30:00',
            cantidad:2,personas:2,tipo_cobro:'normal',total:70000,estado_servicio:'programado'};
        const c={cargo_id:'cargo-masaje',servicio_id:s.id,reserva_id:s.reserva_id,estadia_id:s.estadia_id,
            monto:70000,monto_ajustado:70000,aplicado_neto:70000,saldo_cargo:0,estado:'activo'};
        e.state.db.servicios=[s];e.state.db.vista_estado_cargos=[c];return {s,c};
    };
    const ver=async()=>{const plan=await e.construir(),out=new e.Element('div');e.document.card=out;
        e.api.renderizar(plan,out,consulta);return {plan,out};};
    return {e,r,est,cambiar,registrar,ver,abrir};
}
for(const operador of ['CO','FC','GO'])test('Fecha de registro tras '+operador+' no contamina los dos masajes',async()=>{
    const texto=CABECERA.replace('CO',operador)+' // '+MASAJE;
    const original=servicios(texto);assert.equal(original.length,1);
    const s=original[0];assert.equal(s.semantica,'SERVICIO_REAL');assert.equal(s.cantidad,2);
    assert.equal(s.tipo,'terapeutico');assert.equal(s.duracion_minutos,30);assert.equal(s.hora,'19:00');
    assert.equal(s.texto_original,MASAJE);assert.doesNotMatch(s.texto_fuente_completo,/22-09/);
    const {e,r}=caso(texto),snapshot=JSON.stringify(r);
    const item=(await e.construir()).items.find(x=>x.kind==='servicio');
    assert.equal(item.fecha,'2026-10-03');assert.equal(item.hora,'19:00');assert.equal(item.servicio.cantidad,2);
    assert.equal(JSON.stringify(r),snapshot);assert.equal(e.state.escrituras.length,0);
});
test('La fecha de servicio previa no se descarta si no es una cabecera de reserva',()=>{
    assert.equal(servicios('22-09-26 // '+MASAJE).find(s=>s.concepto==='masaje').semantica,'AMBIGUO');
    assert.equal(servicios('PARA EL 22-09-26 // '+MASAJE).find(s=>s.concepto==='masaje').semantica,'AMBIGUO');
});
test('Dos fechas de masaje explícitas siguen protegidas, aunque exista fecha de registro anterior',()=>{
    const s=servicios(CABECERA+' // '+MASAJE+' // PARA EL 04-10-26').find(x=>x.concepto==='masaje');
    assert.equal(s.semantica,'AMBIGUO');
});
test('Complementos posteriores de tipo, fecha y profesional conservan agrupación',()=>{
    const s=servicios(CABECERA+' // 2 MASAJES // RELAJANTES DE 30 MINS // EL 03.10.26 A LAS 19,00 HRS CON MONICA');
    assert.equal(s.length,1);assert.equal(s[0].cantidad,2);assert.equal(s[0].tipo,'terapeutico');
    assert.equal(s[0].duracion_minutos,30);assert.equal(s[0].hora,'19:00');assert.equal(s[0].semantica,'SERVICIO_REAL');
});
for(const accion of ['AGREGAR','DEJAR','PREPARAR','PONER','COLOCAR'])test(accion+' cuna es nota sin cargo, con acceso a reserva',async()=>{
    const texto=CUNA.replace('AGREGAR',accion),{e,r,est,ver,abrir}=caso(texto);
    const {plan,out}=await ver();assert.equal(plan.items.filter(i=>i.kind==='servicio').length,0);
    const n=plan.items.find(i=>i.kind==='nota'&&i.texto===texto);assert.ok(n);assert.equal(n.payload.texto,texto);
    const fila=out.querySelectorAll('.haku-libro-servicios__item').find(x=>x.textContent.includes(texto));
    const botones=fila.querySelectorAll('button');assert.ok(!botones.some(x=>x.textContent==='Aprobación manual'));
    const b=botones.find(x=>x.textContent==='Ver reserva');assert.ok(b);assert.equal(b.disabled,false);
    b.listeners.click();assert.deepEqual(abrir,[est.reserva_id]);assert.equal(e.state.escrituras.length,0);
});
test('Cuna con cobro explícito o campo Servicios no se disfraza de nota',()=>{
    assert.equal(S.clasificarFragmentoServicio(CUNA+' X PAGAR CLP$10.000',{origen_campo:'notas_reserva'}).semantica,'SERVICIO_REAL');
    assert.notEqual(S.clasificarFragmentoServicio(CUNA,{origen_campo:'servicios'}).semantica,'NO_SERVICIO');
});
test('Misma persona con reserva cancelada y reprogramada conserva el destino exacto de la cuna',async()=>{
    const {e,est,ver,abrir}=caso(CUNA);
    e.state.db.reservas.push({...e.state.db.reservas[0],id:'reserva-cancelada',estado_reserva:'cancelada'});
    e.state.db.reserva_estadias.push({...est,id:'estadia-cancelada',reserva_id:'reserva-cancelada',
        fecha_ingreso:'2026-10-01',fecha_salida:'2026-10-02',estado_estadia:'cancelada'});
    const {out}=await ver();out.querySelectorAll('button').find(b=>b.textContent==='Ver reserva').listeners.click();
    assert.deepEqual(abrir,[est.reserva_id]);assert.equal(e.state.escrituras.length,0);
});
test('Ambigüedad real deja consultar reserva sin habilitar aprobación ni escrituras',async()=>{
    const {e,est,ver,abrir}=caso('22-09-26 // '+MASAJE);
    const {plan,out}=await ver();const i=plan.items.find(x=>x.kind==='servicio');assert.equal(i.semantica,'AMBIGUO');
    const b=out.querySelectorAll('button').find(b=>b.textContent==='Ver reserva');assert.ok(b);b.listeners.click();
    assert.deepEqual(abrir,[est.reserva_id]);assert.ok(!out.querySelectorAll('button').some(b=>b.textContent==='Aprobación manual'));
    assert.equal(e.state.escrituras.length,0);
});
test('Sin asociación inequívoca, Ver reserva está deshabilitado y no abre otra',async()=>{
    const {e,ver,abrir}=caso('22-09-26 // '+MASAJE);e.state.db.reservas=[];
    const {out}=await ver();const b=out.querySelectorAll('button').find(b=>b.textContent==='Ver reserva');
    assert.ok(b);assert.equal(b.disabled,true);b.listeners.click();assert.equal(abrir.length,0);
});
test('Dos masajes ya pagados de otro subtipo no autorizan recrearlos ni cobrar otra vez',async()=>{
    const {e,registrar,ver}=caso();const {s,c}=registrar(),anterior=JSON.stringify([s,c]);
    const {plan,out}=await ver();const i=plan.items.find(x=>x.kind==='servicio');
    assert.equal(i.semantica,'SERVICIO_REAL');assert.equal(i.servicio.cantidad,2);assert.equal(i.estado,'revisar');
    assert.equal(i.payload,null);assert.equal(i.conflicto_tipo_masaje,true);
    assert.equal(i.finanzas_existente.estado,'pagado');assert.equal(i.finanzas_existente.aplicado,70000);
    assert.equal(i.finanzas_existente.saldo,0);assert.match(out.textContent,/Descontracturante.*Pagado.*70/);
    assert.match(out.textContent,/Terapéutico/);assert.ok(!i.razones.some(x=>x.includes('fecha del masaje')));
    assert.equal(JSON.stringify([s,c]),anterior);assert.equal(e.state.escrituras.length,0);
    const manual=out.querySelectorAll('button').find(b=>b.textContent==='Aprobación manual');assert.ok(manual);
    await manual.listeners.click();const panel=out.querySelector('.haku-libro-servicio-manual');assert.ok(panel);
    assert.match(panel.textContent,/19:00/);assert.match(panel.textContent,/Confirmar aquí sólo revalida/);
    assert.match(panel.textContent,/Pagado/);
});
test('Aprobación manual revalida el conflicto de tipo, pero no crea ningún servicio',async()=>{
    const {e,registrar}=caso();registrar();
    const p=await e.resolver(0,{}),i=p.items.find(x=>x.kind==='servicio');
    assert.equal(i.estado,'revisar');assert.equal(i.payload,null);assert.equal(e.state.escrituras.length,0);
    assert.equal(e.state.db.servicios.length,1);
});
test('Masajes coincidentes tras corregir la fuente se omiten y mantienen el pago histórico',async()=>{
    const {e,cambiar,registrar}=caso();registrar();
    cambiar(CABECERA+' // '+MASAJE.replace('RELAJANTES','DESCONTRACTURANTES'));
    const i=(await e.construir()).items.find(x=>x.kind==='servicio');assert.equal(i.estado,'existente');
    assert.equal(i.payload,null);assert.equal(i.finanzas_existente.estado,'pagado');
    assert.equal(e.state.escrituras.length,0);
});
test('Otro masaje de otra hora o estadía no se asocia por mera cantidad',async()=>{
    for(const tipo of ['hora','estadia']){
        const {e,registrar}=caso();const {s}=registrar();
        if(tipo==='hora')s.hora_inicio='16:00:00';else s.estadia_id='otra-estadia';
        const i=(await e.construir()).items.find(x=>x.kind==='servicio');
        assert.equal(i.conflicto_tipo_masaje,undefined,tipo);assert.equal(i.estado,'listo',tipo);
    }
});
