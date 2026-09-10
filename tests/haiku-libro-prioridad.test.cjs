const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../js/supabase-asistente-libro-prioridad-v1.js');
const row=(a='2026-09-10',b='2026-09-12',extra={})=>({id:'Sep26!A1',titular:'Persona',cabana:8,fecha_checkin:a,fecha_checkout:b,...extra});
const result=x=>({estado:'ok',nuevas:[],modificadas:[],ya_no_aparecen:[],ambiguas:[],advertencias:[],...x});
const opciones={fechaActual:'2026-09-10'};
const clasificar=r=>P.clasificar(r,opciones).grupos;
for(const [fecha,grupo] of [['2026-09-10','hoy'],['2026-09-11','manana'],['2026-09-12','proximos'],['2026-09-17','proximos'],['2026-09-18','informativos']])test('nueva '+fecha+' → '+grupo,()=>{
    const g=clasificar(result({nuevas:[{actual:row(fecha,fecha,{tipo_estadia:'full_day',noches:0})}]}));assert.equal(g[grupo].length,1);
});
test('modificación usa ambas fechas, incluyendo salida de hoy y traslado al futuro',()=>{
    const g=clasificar(result({modificadas:[{anterior:row('2026-09-08','2026-09-10'),actual:row('2026-09-20','2026-09-22')}]}));
    assert.equal(g.hoy.length,1);assert.equal(g.hoy[0].segmentos.length,2);assert.match(g.hoy[0].explicacion,/Salida hoy/);
});
test('cambio de cabaña en estadía en curso tiene prioridad hoy',()=>{
    const g=clasificar(result({modificadas:[{anterior:row('2026-09-08'),actual:row('2026-09-08',undefined,{cabana:5}),cambios:[{campo:'cabana',antes:8,ahora:5}]}]}));assert.equal(g.hoy.length,1);
});
test('ausencia y ambigua conservan tipo y candidatos',()=>{
    const g=clasificar(result({ya_no_aparecen:[{anterior:row()}],ambiguas:[{anteriores:[row()],actuales:[row('2026-09-20','2026-09-21')]}]}));
    assert.deepEqual(g.hoy.map(x=>x.tipo),['ausencia','ambigua']);assert.equal(g.hoy[1].segmentos.length,2);
    assert.doesNotMatch(P.renderizar(result({ya_no_aparecen:[{anterior:row()}]}),opciones),/cancelada/i);
});
test('fechas faltantes, imposibles y pasado son informativos con explicación',()=>{
    for(const s of [row(null,null),row('2026-09-12','2026-09-10'),row('2026-02-30','2026-03-01'),row('2026-09-01','2026-09-02')]){
        const g=clasificar(result({nuevas:[{actual:s}]}));assert.equal(g.informativos.length,1);assert.ok(g.informativos[0].explicacion);
    }
});
test('advertencia con referencia exacta usa fechas disponibles, no se convierte en modificación',()=>{
    const g=clasificar(result({nuevas:[{actual:row()}],advertencias:[{actual:'Sep26!A1',tipo:'advertencia_de_origen_conservada'},{hoja:'Sep26',tipo:'huella_no_disponible'}]}));
    assert.deepEqual(g.hoy.map(x=>x.tipo),['nueva','advertencia']);assert.equal(g.informativos[0].tipo,'advertencia');
});
test('segmentos distintos siguen separados y continuidad sola no inventa cambios',()=>{
    const g=clasificar(result({nuevas:[{actual:row()},{actual:row('2026-09-11','2026-09-11',{cabana:10,tipo_estadia:'full_day'})}],continuidades:[{segmentos:[row()]}]}));
    assert.equal(g.hoy.length,1);assert.equal(g.manana.length,1);
    assert.equal(Object.values(clasificar(result({continuidades:[{segmentos:[row()]}]}))).flat().length,0);
});
test('Mauricio 11→13 es mañana; no usa hoja ni archivo para priorizar',()=>{
    const r=result({nuevas:[{actual:row('2026-09-11','2026-09-13',{titular:'Mauricio Cepeda',hoja:'Ene20'})}],archivo:'ayer.xlsx'});
    assert.equal(clasificar(r).manana.length,1);
});
test('clasificación no muta entrada y se actualiza con el día aunque resultado siga en caché',()=>{
    const r=result({nuevas:[{actual:row('2026-09-11','2026-09-13')}]}),original=JSON.stringify(r);
    Object.freeze(r.nuevas[0].actual);Object.freeze(r);
    assert.equal(clasificar(r).manana.length,1);assert.equal(P.clasificar(r,{fechaActual:'2026-09-11'}).grupos.hoy.length,1);assert.equal(JSON.stringify(r),original);
});
test('presentación escapa texto y no muestra contactos',()=>{
    const html=P.renderizar(result({nuevas:[{actual:row(undefined,undefined,{titular:'<img src=x>',telefono:'999999999',correo:'secreto@test.cl'})}]}),opciones);
    assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|999999999|secreto@test/);assert.match(html,/Prioridad de los cambios detectados/); assert.ok(html.includes("Esta sección clasifica únicamente los cambios de esta actualización. No representa todas las reservas, ingresos o salidas de los próximos días."));
});
test('integración manual, Ver informe y resumen automático consumen proyección sin comparar',()=>{
    const root={HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1:P};
    for(const file of ['supabase-asistente-libro-actualizacion-v1','supabase-asistente-libro-auto-v1'])vm.runInNewContext(fs.readFileSync(require.resolve('../js/'+file+'.js'),'utf8'),{window:root});
    assert.match(root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.renderizar(result({nuevas:[{actual:row()}]})),/Prioridad de los cambios detectados/);
    assert.match(root.HAIKU_ASISTENTE_LIBRO_AUTO_V1.resumir(result()).texto,/Prioridad operativa/);
    const panel=fs.readFileSync(require.resolve('../panel.html'),'utf8');assert.ok(panel.indexOf("'supabase-asistente-libro-prioridad-v1'")<panel.indexOf("'supabase-asistente-libro-actualizacion-v1'"));
});
