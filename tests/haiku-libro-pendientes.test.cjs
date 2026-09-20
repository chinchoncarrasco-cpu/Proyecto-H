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
