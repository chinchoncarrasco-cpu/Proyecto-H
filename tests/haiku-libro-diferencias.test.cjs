const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/haiku-libro-diferencias-v1.js');
const row = (extra = {}) => ({id:'Sep26!A3', hoja:'Sep26', titular:'Ana Pérez', cabana:5,
    fecha_checkin:'2026-09-03', fecha_checkout:'2026-09-04', noches:1, tipo_estadia:'alojamiento',
    rut_documento:'12.345.678-9', correo:'ana@example.test', telefono:'+56 9 1234 5678', adultos:2, ninos:0, mascotas:0,
    estado_confirmacion:'confirmada_por_color', estado_operativo:'sin_checkin', operador:'CO',
    notas_importantes:[], servicios:[], pagos_pendientes:[], advertencias:[], texto_original:'Ana Pérez // 2 ADLT', ...extra});
const sheet = (reservas, extra = {}) => ({hoja:'Sep26', cobertura:{geometria:true, pagos:true}, fechas:['2026-09-03','2026-09-04'], reservas, ...extra});
const compare = (a,b) => D.comparar([sheet(a)], [sheet(b)]);
const freeze = v => { if(v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };

test('A: primera copia es línea base, nunca todas nuevas', () => {
    assert.equal(D.comparar(null,[sheet([row()])]).estado,'sin_linea_base');
    assert.equal(D.comparar(null,[sheet([row()])]).resumen.nuevas,0);
});
test('B: mismo conjunto no cambia aunque cambien celda y orden; entrada inmutable y salida clonable', () => {
    const a = freeze([sheet([row()])]), b = freeze([sheet([row({id:'Sep26!ZZ90', texto_original:'ANA   PÉREZ\n2 ADLT'})])]);
    const r = D.comparar(a,b);
    assert.equal(r.estado,'sin_cambios'); assert.ok(Object.values(r.resumen).every(n=>n===0));
    assert.deepEqual(structuredClone(r),r); assert.deepEqual(D.comparar(a,b),r);
});
test('C/D: altas y desapariciones inequívocas; desaparición no significa cancelación', () => {
    assert.equal(compare([],[row()]).resumen.nuevas,1);
    const r=compare([row()],[]); assert.equal(r.resumen.ya_no_aparecen,1);
    assert.equal(r.ya_no_aparecen[0].tipo,'ya_no_aparece'); assert.ok(!JSON.stringify(r).includes('cancelada'));
});
for (const [campo, valor] of [['cabana',9],['fecha_checkin','2026-09-02'],['fecha_checkout','2026-09-05'],['noches',2],
    ['adultos',3],['ninos',1],['mascotas',1],['titular','Ana María Pérez'],['operador','DG'],
    ['estado_confirmacion','pendiente_por_color'],['estado_operativo','checked_out'],['notas_importantes',['Llegada tarde']],
    ['pagos_pendientes',['Tinaja por pagar']],['correo','nuevo@example.test'],['telefono','+56987654321'],['rut_documento','11.111.111-1']]) {
    test(`E–H: cambio ${campo} conserva la reserva y los valores originales`, () => {
        const r=compare([row()],[row({[campo]:valor,id:'Sep26!Z90'})]);
        assert.equal(r.resumen.modificadas,1); assert.equal(r.resumen.nuevas,0); assert.equal(r.resumen.ya_no_aparecen,0);
        assert.deepEqual(r.modificadas[0].cambios,[{campo,antes:row()[campo],ahora:valor}]);
    });
}
const service = (extra={}) => ({concepto:'tinaja', pendiente:false, cortesia:false, hora:'18:00', monto:null, texto_original:'TINAJA 18:00',...extra});
test('I: agregar y eliminar servicio detecta diferencias', () => {
    for(const [a,b] of [[[],[service()]],[[service()],[]]]) assert.equal(compare([row({servicios:a})],[row({servicios:b})]).modificadas[0].cambios[0].campo,'servicios');
});
test('J/K: homónimos sin señales distintivas y contactos reutilizados no se desempatan por celda', () => {
    const a=row({rut_documento:null,correo:null,telefono:null});
    const r=compare([a,{...a,id:'B',cabana:6}],[{...a,id:'C',cabana:9}]);
    assert.equal(r.resumen.modificadas,0); assert.equal(r.resumen.ambiguas,1);
    assert.equal(r.ambiguas[0].anteriores.length,2);
    assert.equal(compare([row(),row({id:'B',cabana:6})],[row({cabana:9})]).resumen.ambiguas,1);
});
test('homónimos con documentos y contactos distintos no se cruzan', () => {
    const b=row({id:'B',rut_documento:'99.999.999-9',correo:'b@example.test',telefono:'+56988888888'});
    const r=compare([row(),b],[{...b,cabana:7},row({cabana:9})]);
    assert.equal(r.resumen.modificadas,2);
    assert.ok(r.modificadas.every(x=>x.anterior.rut_documento===x.actual.rut_documento));
});
test('L/M: orden de listas, espacios, mayúsculas, teléfono y documento equivalentes no modifican', () => {
    const a=row({notas_importantes:['Llegada tarde','Sin azúcar'],pagos_pendientes:['Tinaja por pagar','Cena por pagar'],servicios:[service(),service({concepto:'cuna'})]});
    const b={...a,titular:'  ANA   PEREZ ',rut_documento:'12345678-9',telefono:'+56912345678',
        notas_importantes:[' SIN AZÚCAR ','llegada   tarde'],pagos_pendientes:[...a.pagos_pendientes].reverse(),
        servicios:[...a.servicios].reverse().map(s=>({...s,texto_original:'formato irrelevante'}))};
    assert.equal(compare([a],[b]).estado,'sin_cambios');
});
test('sin contacto: nombre y fechas/tipo permiten cambio CAB; nombre solo queda ambiguo', () => {
    const a=row({rut_documento:null,correo:null,telefono:null});
    assert.equal(compare([a],[{...a,cabana:9}]).resumen.modificadas,1);
    assert.equal(compare([a],[{...a,cabana:9,fecha_checkin:'2026-10-01',fecha_checkout:'2026-10-02'}]).resumen.ambiguas,1);
});
test('documento contradictorio sin dos contactos coincidentes requiere revisión', () => {
    assert.equal(compare([row({correo:null,telefono:null})],[row({rut_documento:'99999999-9',correo:null,telefono:null})]).resumen.ambiguas,1);
});
test('misma ubicación con identidad completamente distinta no permite inventar alta/baja', () => {
    const r=compare([row()],[row({titular:'Otra Persona',rut_documento:'99888777-6',correo:'otro@example.test',telefono:'+56999999999'})]);
    assert.equal(r.resumen.ambiguas,1); assert.equal(r.resumen.nuevas,0); assert.equal(r.resumen.ya_no_aparecen,0);
});
test('advertencias de parser no permiten matching ni desaparición segura', () => {
    assert.equal(compare([row({advertencias:['noches inconsistentes']})],[row()]).resumen.ambiguas,1);
    assert.equal(compare([row({advertencias:['noches inconsistentes']})],[]).resumen.ya_no_aparecen,0);
});
test('hoja ilegible o cobertura reducida no produce bajas/altas falsas', () => {
    for(const b of [sheet([],{cobertura:{geometria:false}}),sheet([],{fechas:['2026-09-03']})]) {
        const r=D.comparar([sheet([row()])],[b]); assert.equal(r.resumen.ya_no_aparecen,0); assert.equal(r.resumen.ambiguas,1); assert.ok(r.no_comparables.length);
    }
});
test('movimiento entre hojas mantiene identidad; nombres de hojas no son identidad', () => {
    const r=D.comparar([sheet([row()]),sheet([],{hoja:'Oct26'})],[sheet([]),sheet([row({id:'Oct26!Z3',hoja:'Oct26',cabana:9})],{hoja:'Oct26'})]);
    assert.equal(r.resumen.modificadas,1); assert.equal(r.resumen.nuevas,0);
});
test('campos no determinados advierten, no inventan transición a cero', () => {
    const r=compare([row()],[row({adultos:null,estado_operativo:'no_determinado'})]);
    assert.equal(r.resumen.modificadas,0); assert.equal(r.advertencias.length,2);
});

const macarena = () => [row({titular:'Macarena Hurtado',id:'Sep26!K7'}),
    row({titular:'Macarena Hurtado',id:'Sep26!O12',cabana:10,fecha_checkin:'2026-09-04',fecha_checkout:'2026-09-04',tipo_estadia:'full_day',noches:0})];
test('Macarena: contexto exacto resuelve 2×2 y conserva extensión Full Day sin fusionar segmentos',()=>{
    const a=freeze(macarena()),b=freeze(macarena().reverse());const r=compare(a,b);
    assert.equal(r.estado,'sin_cambios');assert.equal(r.resumen.ambiguas,0);
    assert.equal(r.continuidades.length,2);
    assert.deepEqual(r.continuidades[0].segmentos.map(s=>s.cabana),[5,10]);
    assert.equal(r.continuidades[0].inferida,true);assert.deepEqual(r.continuidades[0].segmentos.map(s=>s.noches),[1,0]);
    assert.deepEqual(structuredClone(r),r);
});
test('segmento exacto primero permite detectar cambio real de CAB en el restante',()=>{
    const a=macarena(),b=macarena();b[1].cabana=9;
    const r=compare(a,b);assert.equal(r.resumen.modificadas,1);assert.equal(r.resumen.ambiguas,0);
    assert.equal(r.modificadas[0].actual.id,'Sep26!O12');assert.deepEqual(r.modificadas[0].cambios,[{campo:'cabana',antes:10,ahora:9}]);
});
test('segmentos con contexto exactamente duplicado siguen ambiguos',()=>{
    const a=row();const r=compare([a,{...a,id:'B'}],[{...a,id:'C'},{...a,id:'D'}]);
    assert.equal(r.resumen.ambiguas,1);assert.equal(r.resumen.modificadas,0);
});
test('continuidad no se infiere sólo por nombre, ni con contactos conflictivos o varios Full Day candidatos',()=>{
    for(const transform of [a=>a.map(r=>({...r,rut_documento:null,correo:null,telefono:null})),
        a=>[a[0],{...a[1],rut_documento:'99999999-9'}],a=>[...a,{...a[1],id:'C',cabana:9}]]) {
        const a=transform(macarena());assert.equal(compare(a,a).continuidades.length,0);
    }
});
const warningNoches='Las noches escritas no coinciden con las fechas combinadas; confirmar ingreso/salida.';
test('Angelo: advertencia de 1 noche escrita y merge de 2 noches idéntica no impide pareja exacta',()=>{
    const a=row({titular:'Angelo Villegas',cabana:6,fecha_checkin:'2026-09-21',fecha_checkout:'2026-09-23',noches:2,noches_texto:1,advertencias:[warningNoches],notas_importantes:['Pidió extender 1 noche']});
    const r=compare([a],[{...a,id:'OtraCelda'}]);assert.equal(r.estado,'sin_cambios');assert.equal(r.resumen.ambiguas,0);
    assert.ok(r.advertencias.some(x=>x.tipo==='advertencia_de_origen_conservada'));
});
test('advertencia de noches sólo admite excepción con contexto y advertencia idénticos',()=>{
    const a=row({noches_texto:2,advertencias:[warningNoches]});
    for(const b of [{...a,cabana:9},{...a,noches_texto:3},{...a,advertencias:['Cronología dudosa']}]) assert.equal(compare([a],[b]).resumen.ambiguas,1);
});
test('Mauricio: cronología imposible queda advertida, no se convierte en nueva ni se inventa salida',()=>{
    const a=freeze(row({titular:'Mauricio Cepeda',cabana:8,fecha_checkin:'2026-09-14',fecha_checkout:'2026-09-13'}));
    const r=compare([],[a]);assert.equal(r.resumen.nuevas,0);assert.equal(r.resumen.ambiguas,1);
    const reserva=r.ambiguas[0].actuales[0];assert.equal(reserva.fecha_checkout,'2026-09-13');
    assert.equal(reserva.advertencias_validacion[0].codigo,'checkout_anterior_al_checkin');
    assert.equal(compare([a],[a]).resumen.ambiguas,1);
});
test('Full Day válido mantiene 14→14 y cero noches; Mauricio 11→13 dos noches es válido',()=>{
    const fd=row({tipo_estadia:'full_day',fecha_checkin:'2026-09-14',fecha_checkout:'2026-09-14',noches:0});
    assert.equal(compare([],[fd]).resumen.nuevas,1);
    assert.equal(compare([],[row({titular:'Mauricio Cepeda',fecha_checkin:'2026-09-11',fecha_checkout:'2026-09-13',noches:2})]).resumen.nuevas,1);
    assert.equal(compare([],[{...fd,fecha_checkout:'2026-09-15'}]).resumen.nuevas,0);
});
test('fechas inexistentes y alojamiento sin noche no son evidencia de matching',()=>{
    for(const a of [row({fecha_checkin:'2026-02-30'}),row({fecha_checkout:'2026-09-03'})]) assert.equal(compare([a],[a]).resumen.ambiguas,1);
});

function reader(before,after,hook=()=>{}) {
    const calls=[]; let generation=1, active=0;
    return {calls,change(){generation++;},listo:async()=>{},estado:()=>({generacion:generation}),
        consultarIndice:async version => {calls.push(['indice',version]);return version==='anterior' && before===null?null:{nombres:Object.keys(version==='anterior'?before:after)};},
        consultarHuellas:async version => {
            calls.push(['huellas',version]); if(version==='anterior' && before===null) return null;
            const data=version==='anterior'?before:after;
            return {version_huella:1,nombres:Object.keys(data),huellas:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,{sha256:JSON.stringify(v)}]))};
        },
        consultarHoja:async (name,version,type) => {
            assert.equal(++active,1); calls.push([name,version,type]); await Promise.resolve(); active--;
            hook(name,version); const data=(version==='anterior'?before:after)[name]; if(data instanceof Error) throw data; return structuredClone(data);
        }};
}
test('API: primera carga no consulta hojas y devuelve sin_linea_base',async()=>{
    const libro=reader(null,{Sep26:sheet([row()])}); const r=await D.compararUltimasVersiones({libro,fechaReferencia:'2026-09-09'});
    assert.equal(r.estado,'sin_linea_base'); assert.equal(libro.calls.length,1);
});
test('API: índices de ambas versiones, hojas retiradas y lecturas secuenciales',async()=>{
    const libro=reader({Sep26:sheet([row()]),Oct26:sheet([])},{Sep26:sheet([row({cabana:9})])});
    const r=await D.compararUltimasVersiones({libro,fechaReferencia:'2026-09-09'}); assert.equal(r.resumen.modificadas,1);
    assert.ok(libro.calls.some(c=>c[0]==='Oct26'&&c[1]==='anterior')); assert.ok(r.generado_en);
});
test('API: error de hoja no es desaparición y cambio de generación descarta resultados',async()=>{
    const libro=reader({Sep26:sheet([row()])},{Sep26:new Error('Falló lectura')});
    const r=await D.compararUltimasVersiones({libro,fechaReferencia:'2026-09-09'}); assert.equal(r.resumen.ya_no_aparecen,0); assert.ok(r.no_comparables.length);
    const changed=reader({Sep26:sheet([row()])},{Sep26:sheet([])},()=>changed.change());
    const invalid=await D.compararUltimasVersiones({libro:changed,fechaReferencia:'2026-09-09'}); assert.equal(invalid.estado,'no_comparable'); assert.ok(Object.values(invalid.resumen).every(n=>n===0));
});
test('API: error de persistencia no se confunde con primera carga',async()=>{
    const libro=reader({},{}); libro.consultarHuellas=async()=>{throw Error('No guardado');};
    assert.equal((await D.compararUltimasVersiones({libro})).estado,'no_comparable');
});
