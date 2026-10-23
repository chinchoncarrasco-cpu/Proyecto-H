const test=require('node:test'),assert=require('node:assert/strict');
const {caso,abrir}=require('./fixtures/libro-tinaja-cambio-color.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));

for(const color of ['FFFF0000','FF0000','ffff0000',{indexed:2},{indexed:10}])
test('letra roja reconoce cortesía de la tinaja desde el lector: '+JSON.stringify(color),async()=>{
    const e=caso(color);e.state.db.servicios=[];const i=await e.leer();
    assert.equal(i.intencion_cobro,'cortesia');assert.equal(i.payload.tipo_cobro,'cortesia');
    assert.equal(i.estado,'listo');assert.equal(i.evidencia_origen.cobro_color.regla,'LETRA_ROJA_CORTESIA');
    assert.equal(i.fecha,'2026-10-23');assert.equal(i.hora,'19:15');
    assert.equal(i.evidencia_origen.cobro_color.origen.celda,'C7');
    assert.equal(e.state.escrituras.length,0);
});
for(const color of ['FFFF0000','FFFFFF00','FF000000'])test('Tonel a las 19:15 y Libro Jacuzzi: revisión del existente con cualquier cobro: '+color,async()=>{
    const e=caso(color),antes=copy(e.state.db),i=await e.leer();
    assert.equal(i.estado,'revisar');assert.equal(i.payload,null);assert.equal(i.conflicto_tinaja_existente,true);
    assert.equal(i.servicio_existente.id,'tinaja-existente');assert.equal(i.finanzas_existente.saldo,30000);
    assert.match(i.razones.join(' '),/Posible modificación.*Tonel.*19:15.*Jacuzzi.*19:15/);
    assert.deepEqual(copy(e.state.db),antes);assert.equal(e.state.escrituras.length,0);
});
test('panel del caso muestra cambio y discrepancia financiera, sin preguntar un cobro desconocido',async()=>{
    const e=caso(),f=await abrir(e);
    assert.match(f.panel.textContent,/Registrado en Haku.*Tonel.*19:15–20:15/);
    assert.match(f.panel.textContent,/Indicado en el Libro.*Jacuzzi.*19:15/);
    assert.match(f.panel.textContent,/Libro indica cortesía.*cobro previo/);
    assert.doesNotMatch(e.out.textContent,/cobro por definir|Falta definir si el servicio es cobrable/);
    assert.equal(f.campo('tipo_cobro'),undefined);assert.equal(f.confirmar.disabled,true);
    assert.equal(e.state.revisiones.length,0);assert.equal(e.state.escrituras.length,0);
});
for(const importe of [0,30000])test('confirmar cambio conserva el mismo ID, importe e historial: '+importe,async()=>{
    const e=caso();if(!importe){Object.assign(e.state.db.servicios[0],{tipo_cobro:'cortesia',total:0});e.state.db.vista_estado_cargos=[];}
    const finanzas=copy(e.state.db.vista_estado_cargos),f=await abrir(e);
    f.campo('modo').value='actualizar';f.campo('modo').listeners.change();
    f.campo('motivo').value='Traslado por reparación de la banca del Tonel';
    f.campo('aceptar').checked=true;f.campo('aceptar').listeners.change();
    await Promise.all([f.confirmar.listeners.click(),f.confirmar.listeners.click()]);
    assert.equal(e.state.revisiones.length,1);assert.equal(e.state.db.servicios.length,1);
    assert.equal(e.state.db.servicios[0].id,'tinaja-existente');assert.equal(e.state.db.servicios[0].catalogo_servicios.codigo,'tinajaJacuzzi');
    assert.equal(e.state.db.servicios[0].total,importe);assert.deepEqual(copy(e.state.db.vista_estado_cargos),finanzas);
    assert.equal(e.state.escrituras.length,0);assert.equal((await e.leer()).estado,'existente');
    assert.match(e.out.textContent,/Aprobación guardada/);
    assert.equal(e.state.db.servicios[0].observaciones,'Libro: Tonel original');
});
test('varios candidatos no se eligen por precio y no abren el alta de otro servicio',async()=>{
    const e=caso();e.state.db.servicios.push({...e.state.db.servicios[0],id:'otra-tinaja',tipo_cobro:'cortesia',total:0});
    const i=await e.leer();assert.equal(i.estado,'revisar');assert.equal(i.payload,null);
    assert.equal(i.candidatosRevision.length,2);assert.equal(i.servicio_existente,undefined);
    const f=await abrir(e);assert.match(f.panel.textContent,/Revisar evidencia/);assert.equal(f.confirmar,undefined);
    assert.equal(e.state.escrituras.length,0);
});
for(const [campo,valor] of [['reserva_id','otra'],['estadia_id','otra'],['fecha_servicio','2026-10-24'],
    ['estado_servicio','cancelado'],['estado_servicio','anulado'],['estado_servicio','no_show']])
test('no confunde una tinaja ajena, de otro día o cancelada: '+campo+'/'+valor,async()=>{
    const e=caso();e.state.db.servicios[0][campo]=valor;
    const i=await e.leer();assert.equal(i.estado,'listo');assert.ok(i.payload);assert.equal(i.conflicto_tinaja_existente,undefined);
});
test('segunda hora contigua es un servicio distinto y el solapamiento exige revisión',async()=>{
    const e=caso();e.state.leerColor('FFFF0000','JACUZZI 1 HORA PARA EL 23/10 A LAS 20:15 HRS');
    assert.equal((await e.leer()).estado,'listo');
    e.state.leerColor('FFFF0000','JACUZZI 1 HORA PARA EL 23/10 A LAS 19:45 HRS');
    assert.equal((await e.leer()).conflicto_tinaja_existente,true);
    e.state.leerColor('FFFF0000','JACUZZI PARA EL 23/10 DE 18:45 A 19:30 HRS');
    assert.equal((await e.leer()).conflicto_tinaja_existente,true);
    e.state.leerColor('FFFF0000','JACUZZI 1 HORA PARA EL 23/10 A LAS 19:00 HRS');
    assert.equal((await e.leer()).conflicto_tinaja_existente,true);
    e.state.leerColor('FFFF0000','JACUZZI 1 HORA PARA EL 23/10 A LAS 18:15 HRS');
    assert.equal((await e.leer()).estado,'listo');
});
test('Jacuzzi ya registrado se omite y el cambio inverso a Tonel también se detecta',async()=>{
    const e=caso('FFFFFF00'),s=e.state.db.servicios[0];s.catalogo_servicios.codigo='tinajaJacuzzi';
    assert.equal((await e.leer()).estado,'existente');
    e.state.leerColor('FFFFFF00','TINAJA TONEL 1 HORA PARA EL 23/10 A LAS 19:15 HRS');
    assert.equal((await e.leer()).conflicto_tinaja_existente,true);
});
test('HRS del reloj no se interpreta como duración de quince horas',async()=>{
    const e=caso();Object.assign(e.state.db.servicios[0],{hora_inicio:'21:15:00',hora_fin:'22:15:00'});
    e.state.leerColor('FFFF0000','JACUZZI PARA EL 23/10 A LAS 19:15 HRS');
    assert.equal((await e.leer()).estado,'listo');
});
test('cambiar sólo amarillo a rojo no queda oculto por el marcador del mismo origen',async()=>{
    const e=caso('FFFFFF00'),s=e.state.db.servicios[0];s.catalogo_servicios.codigo='tinajaJacuzzi';
    const original=await e.leer();s.observaciones=`[HAKU-LIBRO-SERVICIO:${original.item_id}]`;
    e.state.leerColor('FFFF0000');const i=await e.leer();
    assert.equal(i.item_id,original.item_id);assert.equal(i.estado,'revisar');assert.equal(i.payload,null);
    assert.match(i.razones.join(' '),/color.*cobro/);assert.equal(s.total,30000);
});
test('nunca prepara un alta manual cuando corresponde revisar el traslado',async()=>{
    const e=caso();await assert.rejects(()=>e.resolver(0,{codigo_servicio:'tinajaJacuzzi',tipo_cobro:'cortesia'}),/tinaja existente/);
    assert.equal(e.state.escrituras.length,0);
});
test('recepción ve el conflicto, sin alta manual del servicio duplicado',async()=>{
    const e=caso();e.c.haikuSesion.roles=[{codigo:'recepcion'}];
    e.api.renderizar(await e.construir(),e.out,'Libro: compara servicios de octubre 2026 con Proyecto H');
    assert.ok(!e.out.querySelectorAll('button').some(b=>b.textContent==='Aprobación manual'));
    assert.match(e.out.textContent,/Posible modificación/);assert.equal(e.state.escrituras.length,0);
});
test('cambio de color mientras está abierto el panel impide confirmar una revisión obsoleta',async()=>{
    const e=caso(),f=await abrir(e);f.campo('motivo').value='Revisado';f.campo('aceptar').checked=true;f.campo('aceptar').listeners.change();
    e.state.leerColor('FFFFFF00');await f.confirmar.listeners.click();
    assert.equal(e.state.revisiones.length,0);assert.match(f.panel.textContent,/cambió/);
});
test('rojo no agenda notas por coordinar ni convierte masajes en cortesías',async()=>{
    const e=caso();e.state.leerColor('FFFF0000','TINAJA TONEL POR COORDINAR');
    assert.equal(e.state.reservas[0].servicios.length,0);
    e.state.leerColor('FFFF0000','1 MASAJE DESCONTRACTURANTE DE 1 HORA PARA EL 24/10 A LAS 11:00');
    assert.notEqual(e.state.reservas[0].servicios[0].intencion_cobro,'cortesia');
    assert.equal(e.state.reservas[0].servicios[0].evidencia_origen.cobro_color,undefined);
});
