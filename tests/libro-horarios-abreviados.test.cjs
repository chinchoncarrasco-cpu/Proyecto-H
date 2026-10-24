const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../js/haiku-libro-semantica-v1.js');
const {caso,consulta}=require('./fixtures/libro-tinaja-cambio-color.cjs');
const {entorno,read}=require('./fixtures/libro-servicio-manual.cjs');
const {configurarRocio,masajeReal}=require('./fixtures/libro-masaje-fragmentos.cjs');
const vm=require('node:vm');
const puro={document:{},addEventListener(){},HAIKU_LIBRO_SEMANTICA:S};
vm.createContext(puro);vm.runInContext(read('js/haiku-libro-servicios-scope-v2.js')
    .replace('const api = Object.freeze({','const api = Object.freeze({horaTexto,'),puro);

for(const [texto,horas] of [
    ['18 hra a 19hra tonel sábado 24-10',['18:00','19:00']],
    ['18 HRA. a 19 HRAS.',['18:00','19:00']],
    ['18hra a 19hras',['18:00','19:00']],
    ['18.00 hrs a 19.00 hrs',['18:00','19:00']],
    ['18.07 hra a 19.07 hra',['18:07','19:07']],
    ['18:07 a 19:07',['18:07','19:07']],
    ['18,07 hras a 19,07 hras',['18:07','19:07']]
])test('reloj del Libro: '+texto,()=>assert.deepEqual(S.horasDeServicio(texto),horas));

test('las abreviaturas conservan límites válidos y no convierten fechas ni números sueltos en horas',()=>{
    for(const texto of ['24-10','24/10/2026','18','18 hram','25 hra','18:60 hra','18.5 hra'])
        assert.deepEqual(S.horasDeServicio(texto),[],texto);
    assert.equal(puro.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.horaTexto('DESDE LAS 11 HRA HASTA LAS 13 HRAS',true),'13:00');
});

function preparar(texto){
    const e=caso();e.state.db.servicios=[];e.state.db.vista_estado_cargos=[];
    e.state.leerColor('FFFF0000',texto);return e;
}
for(const [texto,inicio,fin] of [
    ['18 hra a 19hra tonel sábado 24-10','18:00','19:00'],
    ['18.00 hrs a 19.00 hrs tonel sábado 24-10','18:00','19:00'],
    ['18.07 hra a 19.07 hra tonel sábado 24-10','18:07','19:07']
])test('del lector a la preparación: horario explícito fuera de la lista '+inicio,async()=>{
    const e=preparar(texto),i=await e.leer();
    assert.equal(i.fecha,'2026-10-24');assert.equal(i.hora,inicio);assert.equal(i.hora_fin,fin);
    assert.equal(i.estado,'listo');assert.equal(i.razones.length,0);
    assert.equal(i.payload.hora,inicio);assert.equal(i.payload.tipo_cobro,'cortesia');assert.equal(i.payload.cantidad,1);
    assert.equal(i.payload.servicio_manual_v1,undefined);assert.equal(e.state.escrituras.length,0);
    e.api.renderizar(await e.construir(),e.out,consulta);
    const row=e.out.querySelector('.haku-libro-servicios__item');
    assert.doesNotMatch(row.textContent,/Falta un horario|Falta fecha u hora/);
    assert.equal(row.querySelector('input[type=checkbox]').disabled,false);
});

test('la hora leída encuentra el servicio existente y no prepara una segunda tinaja',async()=>{
    const e=caso(),s=e.state.db.servicios[0];
    Object.assign(s,{fecha_servicio:'2026-10-24',hora_inicio:'18:00:00',hora_fin:'19:00:00',tipo_cobro:'cortesia',total:0});
    e.state.db.vista_estado_cargos=[];e.state.leerColor('FFFF0000','18 hra a 19hra tonel sábado 24-10');
    const i=await e.leer();assert.equal(i.estado,'existente');assert.equal(i.payload,null);
    assert.equal(e.state.db.servicios.length,1);assert.equal(e.state.escrituras.length,0);
});

test('un cambio de tipo a la misma hora conserva la revisión del existente',async()=>{
    const e=caso(),s=e.state.db.servicios[0];
    Object.assign(s,{fecha_servicio:'2026-10-24',hora_inicio:'18:00:00',hora_fin:'19:00:00'});
    e.state.leerColor('FFFF0000','18 hra a 19hra jacuzzi sábado 24-10');
    const i=await e.leer();assert.equal(i.estado,'revisar');assert.equal(i.payload,null);
    assert.equal(i.conflicto_tinaja_existente,true);assert.equal(i.servicio_existente.id,s.id);
    assert.equal(e.state.escrituras.length,0);
});

test('la duración 1 HRA de un masaje no crea una cita a la 01:00',async()=>{
    for(const conHora of [true,false]){
        const e=entorno();configurarRocio(e,masajeReal.replace('1 HORA','1 HRA').replace(' A LAS 11 AM',conHora?' A LAS 18 HRAS':''));
        const i=(await e.construir()).items.find(x=>x.kind==='servicio'&&x.servicio.concepto==='masaje');
        assert.equal(i.servicio.duracion_minutos,60);assert.equal(i.hora,conHora?'18:00':null);
        assert.equal(i.hora_fin,null);assert.equal(i.estado,conHora?'listo':'revisar');
        assert.equal(e.state.escrituras.length,0);
    }
});

test('preparar no registra; confirmar envía una sola vez el horario exacto',async()=>{
    const e=preparar('18 hra a 19hra tonel sábado 24-10');
    e.api.renderizar(await e.construir(),e.out,consulta);assert.equal(e.state.escrituras.length,0);
    e.guard();e.out.previousElementSibling=new e.Element('div');
    e.out.previousElementSibling.className='haiku-asistente-mensaje--usuario';e.out.previousElementSibling.textContent=consulta;
    const boton=e.out.querySelectorAll('button').find(x=>x.dataset.hakuAccion==='incorporar');
    const ev={target:boton,preventDefault(){},stopImmediatePropagation(){}};
    e.captures.filter(([t])=>t==='click').forEach(([,fn])=>fn(ev));
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(e.state.escrituras.length,1);const p=e.state.escrituras[0].p_servicios;
    assert.equal(p.length,1);assert.equal(p[0].hora,'18:00');assert.equal(p[0].cantidad,1);
    assert.equal(p[0].tipo_cobro,'cortesia');assert.equal(p[0].fecha_servicio,'2026-10-24');
});
