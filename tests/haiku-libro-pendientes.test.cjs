const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const S=require('../js/haiku-libro-semantica-v1.js');

const context={structuredClone,console,Intl,Date,HAIKU_LIBRO_SEMANTICA:S};
vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8'),context);
const libro=(extra={})=>({id:'Sep26!A3',titular:'Persona Ejemplo',cabana:10,fecha_checkin:'2026-09-19',fecha_checkout:'2026-09-20',
    noches:1,tipo_estadia:'alojamiento',adultos:2,ninos:0,mascotas:0,estado_confirmacion:'confirmada_por_color',estado_operativo:'sin_checkin',
    rut_documento:null,correo:null,telefono:null,texto_original:'',notas_importantes:[],pagos_pendientes:[],pagos:[],pagos_sin_asociacion:[],servicios:[],advertencias:[],...extra});
function cliente(tablas){
    return {auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},from(nombre){
        const q={select(){return q},in(){return q},order(){return q},range:async()=>({data:tablas[nombre]||[]})};return q;
    }};
}
test('compararSistema completo detecta Libro hospedada frente a Proyecto H confirmada',async()=>{
    const r=libro({estado_operativo:'hospedada'});
    const estadia={id:'e1',reserva_id:'r1',fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,estado_estadia:'confirmada',tipo_estadia:'alojamiento',adultos:2,ninos:0,mascotas:0,
        cabanas:{numero:10},reservas:{id:'r1',grupo_reserva_id:null,titular_nombre:r.titular,titular_tipo_documento:null,titular_numero_documento:null,correo_contacto:null,telefono_contacto:null,estado_reserva:'confirmada',observaciones:''}};
    const comp=await context.HAIKU_LIBRO_CONSULTAS.compararSistema([r],cliente({reserva_estadias:[estadia],pagos:[],servicios:[]}));
    assert.equal(comp[0].estado,'asociada');assert.equal(comp[0].libro.estado_operativo,'hospedada');assert.equal(comp[0].sistema.estado_operativo,'confirmada');
});
test('servicios coincidentes se omiten y los faltantes o distintos explican la causa',async()=>{
    const r=libro({servicios:[{concepto:'tonel',hora:'19:15',pendiente:false,texto_original:'TONEL 19:15'}]});
    const estadia={id:'e1',reserva_id:'r1',fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,estado_estadia:'confirmada',tipo_estadia:'alojamiento',adultos:2,ninos:0,mascotas:0,
        cabanas:{numero:10},reservas:{id:'r1',grupo_reserva_id:null,titular_nombre:r.titular,estado_reserva:'confirmada',observaciones:''}};
    const servicioSistema=hora=>({id:'s1',reserva_id:'r1',estadia_id:'e1',fecha_servicio:r.fecha_checkin,hora_inicio:hora,total:30000,estado_servicio:'programado',catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tinaja Tonel'}});
    const ejecutar=servicios=>context.HAIKU_LIBRO_CONSULTAS.compararSistema([r],cliente({reserva_estadias:[estadia],pagos:[],servicios}));
    const igual=await ejecutar([servicioSistema('19:15:00')]);assert.equal(igual.serviciosDetalle[0].estado,'en_sistema');
    const distinto=await ejecutar([servicioSistema('18:00:00')]);assert.equal(distinto.serviciosDetalle[0].estado,'diferente');
    assert.match(distinto.serviciosDetalle[0].razon,/Horario: Proyecto H 18:00 \/ Libro 19:15/);
    const faltante=await ejecutar([]);assert.equal(faltante.serviciosDetalle[0].estado,'faltante');assert.equal(faltante.serviciosDetalle[0].razon,'Falta en Proyecto H.');
});
function clienteFocal(tablas,llamadas){
    return {auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},from(nombre){
        llamadas.push(nombre);const q={select(){return q},in(){return q},lte(){return q},gte(){return q},order(){return q},range:async()=>({data:tablas[nombre]||[]})};return q;
    }};
}
function cambioEstado(id='hist-1'){
    const anterior=libro({estado_operativo:'sin_checkin'}),actual=libro({estado_operativo:'hospedada'});
    return {id,tipo:'modificacion',detectado_generacion:2,anterior,actual,cambios:[{campo:'estado_operativo',antes:'sin_checkin',ahora:'hospedada'}]};
}
function filaSistema(estado,extra={}){
    const r=libro();return {id:'e1',reserva_id:'r1',fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,estado_estadia:estado,tipo_estadia:'alojamiento',adultos:2,ninos:0,mascotas:0,
        cabanas:{numero:10},reservas:{id:'r1',grupo_reserva_id:null,titular_nombre:r.titular,titular_tipo_documento:null,titular_numero_documento:null,correo_contacto:null,telefono_contacto:null,estado_reserva:'confirmada',observaciones:''},...extra};
}
test('cambio histórico hospedada sigue pendiente si Proyecto H continúa confirmada',async()=>{
    const llamadas=[],registro=cambioEstado();
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[filaSistema('confirmada')]},llamadas),{generacion:3});
    assert.equal(out.items.length,1);assert.equal(out.items[0].estado,'pendiente');assert.equal(out.items[0].cambios[0].proyecto,'confirmada');
    assert.equal(out.reservas.length,1);assert.equal(out.comparacion.length,1);
    const plan=context.HAIKU_LIBRO_CONSULTAS.crearPlanIncorporacion(out.reservas,out.comparacion);
    const actualizacion=plan.items.find(x=>x.categoria==='actualizaciones');
    assert.ok(actualizacion?.seleccionado);assert.deepEqual(Array.from(actualizacion.cambios,x=>x.campo),['Estado de estadía']);
    assert.deepEqual(llamadas,['reserva_estadias']);
});
test('cambio histórico hospedada queda resuelto si Proyecto H ya está hospedada',async()=>{
    const llamadas=[],registro=cambioEstado();
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[filaSistema('hospedada')]},llamadas),{generacion:3});
    assert.equal(out.items.length,0);assert.deepEqual(Array.from(out.resueltos),[registro.id]);assert.equal(out.reservas.length,0);
    assert.deepEqual(llamadas,['reserva_estadias']);
});
test('cambio actual de adultos se revalida y prepara sin auditar el mes',async()=>{
    const llamadas=[],anterior=libro({adultos:2}),actual=libro({adultos:3});
    const registro={id:'actual-adultos',tipo:'modificacion',detectado_generacion:3,anterior,actual,
        cambios:[{campo:'adultos',antes:2,ahora:3}]};
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[filaSistema('confirmada')]},llamadas),{generacion:3});
    assert.equal(out.items.length,1);assert.equal(out.items[0].accionable,true);assert.equal(out.items[0].cambios[0].proyecto,2);
    const plan=context.HAIKU_LIBRO_CONSULTAS.crearPlanIncorporacion(out.reservas,out.comparacion);
    const actualizacion=plan.items.find(x=>x.categoria==='actualizaciones');
    assert.ok(actualizacion?.seleccionado);assert.deepEqual(Array.from(actualizacion.cambios,x=>x.campo),['Adultos']);
    assert.deepEqual(llamadas,['reserva_estadias']);
});
test('cambio histórico de CAB usa de forma segura la instantánea anterior como destino',async()=>{
    const llamadas=[],anterior=libro({cabana:10}),actual=libro({cabana:11});
    const registro={id:'cambio-cab',tipo:'modificacion',detectado_generacion:2,anterior,actual,
        cambios:[{campo:'cabana',antes:10,ahora:11}]};
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[filaSistema('confirmada')]},llamadas),{generacion:3});
    assert.equal(out.items.length,1);assert.equal(out.items[0].accionable,true);assert.equal(out.items[0].cambios[0].proyecto,10);
    const plan=context.HAIKU_LIBRO_CONSULTAS.crearPlanIncorporacion(out.reservas,out.comparacion);
    const actualizacion=plan.items.find(x=>x.categoria==='actualizaciones');
    assert.ok(actualizacion?.seleccionado);assert.deepEqual(Array.from(actualizacion.cambios,x=>x.campo),['Cabaña']);
    assert.deepEqual(llamadas,['reserva_estadias']);
});
test('cambio histórico de CAB ambiguo queda en revisión y no prepara',async()=>{
    const llamadas=[],anterior=libro({cabana:10}),actual=libro({cabana:11});
    const registro={id:'cambio-cab-ambiguo',tipo:'modificacion',detectado_generacion:2,anterior,actual,
        cambios:[{campo:'cabana',antes:10,ahora:11}]};
    const duplicada=filaSistema('confirmada',{id:'e2',reserva_id:'r2',reservas:{...filaSistema('confirmada').reservas,id:'r2'}});
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[filaSistema('confirmada'),duplicada]},llamadas),{generacion:3});
    assert.equal(out.items.length,1);assert.equal(out.items[0].estado,'revision');assert.equal(out.items[0].accionable,false);
    assert.equal(out.reservas.length,0);assert.deepEqual(llamadas,['reserva_estadias']);
});
test('una diferencia aislada en noches se informa pero no habilita preparación',async()=>{
    const llamadas=[],anterior=libro({noches:1}),actual=libro({noches:2});
    const registro={id:'solo-noches',tipo:'modificacion',detectado_generacion:3,anterior,actual,
        cambios:[{campo:'noches',antes:1,ahora:2}]};
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[filaSistema('confirmada')]},llamadas),{generacion:3});
    assert.equal(out.items.length,1);assert.equal(out.items[0].estado,'revision');assert.equal(out.items[0].accionable,false);
    assert.equal(out.reservas.length,0);assert.deepEqual(llamadas,['reserva_estadias']);
});
test('sin historial no consulta Proyecto H ni ofrece preparación',async()=>{
    const llamadas=[];
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([],clienteFocal({},llamadas),{generacion:3});
    assert.equal(out.total,0);assert.equal(out.reservas.length,0);assert.deepEqual(llamadas,[]);
});
function cambioConfirmacion(extra={}) {
    const anterior=libro({estado_confirmacion:'pendiente_por_color'}),actual=libro({estado_confirmacion:'confirmada_por_color',...extra});
    return {id:'hist-confirmacion',tipo:'modificacion',detectado_generacion:2,anterior,actual,
        cambios:[{campo:'estado_confirmacion',antes:'pendiente_por_color',ahora:'confirmada_por_color'}]};
}
test('historial: confirmación por color ya aplicada o superada no queda como cambio imposible de comprobar',async()=>{
    for(const estado of ['confirmada','hospedada','checked_out']){
        const llamadas=[],out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([cambioConfirmacion()],
            clienteFocal({reserva_estadias:[filaSistema(estado)]},llamadas),{generacion:3});
        assert.equal(out.items.length,0,estado);assert.equal(out.resueltos.length,1,estado);assert.equal(out.reservas.length,0);
        assert.deepEqual(llamadas,['reserva_estadias']);
    }
});
test('historial: pendiente frente a confirmada por color prepara sólo la confirmación, sin adelantar check-in o checkout',async()=>{
    const registro=cambioConfirmacion({estado_operativo:'checked_out'});
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],
        clienteFocal({reserva_estadias:[filaSistema('pendiente')]},[]),{generacion:3});
    assert.equal(out.items.length,1);assert.equal(out.items[0].accionable,true);
    assert.equal(out.items[0].cambios[0].proyecto,'pendiente');assert.equal(out.reservas.length,1);
    const plan=context.HAIKU_LIBRO_CONSULTAS.crearPlanIncorporacion(out.reservas,out.comparacion);
    const update=plan.items.find(x=>x.payload?.tipo==='reserva_actualizar');assert.ok(update?.seleccionado);
    assert.equal(update.payload.estadia.despues.estado_estadia,'confirmada');
    assert.deepEqual(Object.keys(update.payload.estadia.despues),['estado_estadia']);
});
test('historial: un cambio de adultos no arrastra una confirmación por color ajena al cambio',async()=>{
    const anterior=libro({adultos:2}),actual=libro({adultos:3}),registro={id:'adultos-sin-color',tipo:'modificacion',anterior,actual,
        cambios:[{campo:'adultos',antes:2,ahora:3}]};
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],
        clienteFocal({reserva_estadias:[filaSistema('pendiente')]},[]),{generacion:3});
    const plan=context.HAIKU_LIBRO_CONSULTAS.crearPlanIncorporacion(out.reservas,out.comparacion);
    const update=plan.items.find(x=>x.payload?.tipo==='reserva_actualizar');assert.ok(update?.seleccionado);
    assert.deepEqual(Object.keys(update.payload.estadia.despues),['adultos']);
});
test('historial: el contador seguro exige una propuesta seleccionable del plan de incorporación',async()=>{
    const actual=libro({adultos:0}),registro={id:'adultos-no-validos',tipo:'modificacion',anterior:libro(),actual,
        cambios:[{campo:'adultos',antes:2,ahora:0}]};
    const llamadas=[],out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],
        clienteFocal({reserva_estadias:[filaSistema('confirmada')]},llamadas),{generacion:3});
    assert.equal(out.items.length,1);assert.equal(out.items[0].accionable,false);assert.equal(out.reservas.length,0);
    assert.deepEqual(llamadas,['reserva_estadias']);
});
test('historial: sin motor operativo, una comparación antigua no acredita un faltante ni habilita preparación',async()=>{
    const actual=libro({servicios:[{concepto:'tinaja',texto_original:'1 HORA DE TINAJA DE CORTESÍA'}]}),registro={id:'motor-ausente',tipo:'modificacion',
        anterior:libro(),actual,cambios:[{campo:'servicios',antes:[],ahora:actual.servicios}]};
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],
        clienteFocal({reserva_estadias:[filaSistema('confirmada')]},[]),{generacion:3});
    assert.equal(out.items.length,1);assert.equal(out.items[0].accionable,false);assert.equal(out.reservas.length,0);
    assert.match(out.items[0].cambios[0].proyecto,/no acredita un faltante/);
});
test('operador ya conservado en el último bloque del Libro no queda pendiente por carecer de una columna propia',async()=>{
    const actual=libro({operador:'CO'}),registro={id:'operador',tipo:'modificacion',anterior:libro({operador:'CA'}),actual,
        cambios:[{campo:'operador',antes:'CA',ahora:'CO'}]};
    const s=filaSistema('checked_out');s.reservas.observaciones='Dato anterior // CA\n[DATOS DEL LIBRO]\nPersona Ejemplo // 2adl // CO // 19-09-26\n[/DATOS DEL LIBRO]';
    const db=clienteFocal({reserva_estadias:[s]},[]),out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],db,{generacion:3});
    assert.equal(out.items.length,0);assert.equal(out.resueltos.length,1);
    s.reservas.observaciones='Persona Ejemplo // CO';
    const sinBloque=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],db,{generacion:3});
    assert.equal(sinBloque.items.length,1);assert.equal(sinBloque.items[0].accionable,false);
});
test('una estadía cancelada se identifica como tal y no habilita su reactivación desde el historial',async()=>{
    const r=libro(),registro={id:'cancelada',tipo:'modificacion',anterior:r,actual:r,cambios:[{campo:'adultos',antes:3,ahora:2}]};
    const s=filaSistema('cancelada');s.reservas.estado_reserva='cancelada';
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[s]},[]),{generacion:3});
    assert.equal(out.items[0].accionable,false);assert.match(out.items[0].proyecto,/cancelada o No Show/);
    assert.equal(out.reservas.length,0);assert.equal(out.revisionServicios.reservas.length,0);
});

test('operador CO → CO del historial se resuelve aunque el último bloque sólo contenga servicios',async()=>{
    const r=libro({operador:'CO'}),registro={id:'operador-sin-cambio',tipo:'modificacion',anterior:r,actual:r,
        cambios:[{campo:'operador',antes:'CO',ahora:' co '}]};
    const s=filaSistema('checked_out');s.reservas.observaciones='Persona Ejemplo // CO\n[DATOS DEL LIBRO]\n2 MASAJES 19:00\n[/DATOS DEL LIBRO]';
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[s]},[]),{generacion:3});
    assert.equal(out.items.length,0);assert.deepEqual(Array.from(out.resueltos),[registro.id]);assert.equal(out.reservas.length,0);
});
test('checkout y noches coherentes abren una preparación individual sin arrastrar ocupación ni otros campos',async()=>{
    const anterior=libro({fecha_checkin:'2026-09-12',fecha_checkout:'2026-09-14',noches:2});
    const actual={...anterior,fecha_checkout:'2026-09-13',noches:1,ninos:1};
    const registro={id:'salida-una-noche',tipo:'modificacion',anterior,actual,cambios:[
        {campo:'fecha_checkout',antes:anterior.fecha_checkout,ahora:actual.fecha_checkout},{campo:'noches',antes:2,ahora:1}]};
    const s=filaSistema('checked_out',{fecha_ingreso:anterior.fecha_checkin,fecha_salida:anterior.fecha_checkout});
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[s]},[]),{generacion:3});
    assert.equal(out.items.length,1);assert.equal(out.items[0].accionable,true);assert.equal(out.reservas.length,1);
    const prep=out.items[0].preparacion;assert.equal(prep.reservas.length,1);assert.equal(prep.generacion,3);
    const plan=context.HAIKU_LIBRO_CONSULTAS.crearPlanIncorporacion(prep.reservas,prep.comparacion);
    const update=plan.items.find(x=>x.payload?.tipo==='reserva_actualizar');assert.ok(update?.seleccionado);
    assert.deepEqual({...update.payload.estadia.despues},{fecha_salida:'2026-09-13'});
    assert.match(update.aviso,/cargos de alojamiento/);assert.ok(update.permisos.includes('pagos.verificar'));
    actual.noches=3;
    const incoherente=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[s]},[]),{generacion:3});
    assert.equal(incoherente.items[0].accionable,false);assert.equal(incoherente.items[0].preparacion,undefined);
});
test('un alta histórica que ya existe cancelada se resuelve sin recrearla ni reactivarla; identidades ambiguas siguen pendientes',async()=>{
    const r=libro(),registro={id:'alta-cancelada',tipo:'nueva',anterior:null,actual:r,cambios:[]};
    const s=filaSistema('cancelada');s.reservas.estado_reserva='cancelada';
    const db=clienteFocal({reserva_estadias:[s]},[]),antes=JSON.stringify(s);
    const out=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],db,{generacion:3});
    assert.equal(out.items.length,0);assert.deepEqual(Array.from(out.resueltos),[registro.id]);assert.equal(out.reservas.length,0);
    assert.equal(JSON.stringify(s),antes);
    const duplicada={...s,id:'otra-estadia',reserva_id:'otra-reserva',reservas:{...s.reservas,id:'otra-reserva'}};
    const ambigua=await context.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],clienteFocal({reserva_estadias:[s,duplicada]},[]),{generacion:3});
    assert.equal(ambigua.items.length,1);assert.equal(ambigua.items[0].accionable,false);
});
