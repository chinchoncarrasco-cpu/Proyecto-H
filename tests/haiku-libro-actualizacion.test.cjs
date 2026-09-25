const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const A = require('../js/supabase-asistente-libro-actualizacion-v1.js');
const resultado = extra => ({estado:'ok',nuevas:[],modificadas:[],ya_no_aparecen:[],ambiguas:[],continuidades:[],advertencias:[],no_comparables:[],...extra});
const reserva = {titular:'Persona Prueba',cabana:8,fecha_checkin:'2026-09-11',fecha_checkout:'2026-09-13',noches:2};
for (const frase of ['Haku, informe de actualización','informe de actualizacion','qué cambió en el libro','que cambio en el libro','Haku, dame los cambios del libro','cambios de la última actualización','ultima actualización del libro','última actualización del libro','qué cambió desde la última carga']) {
    test(`intención: ${frase}`,()=>assert.equal(A.esConsulta(frase),true));
}
for (const frase of ['cambia la reserva','actualiza el libro','modifica los cambios del libro','resumen del día','busca a Juan en el libro','pagos del libro','no quiero informe de actualización','informe de actualización y elimina la reserva']) {
    test(`no intercepta: ${frase}`,()=>assert.equal(A.esConsulta(frase),false));
}
test('primera versión no se presenta como altas',()=>{
    const html=A.renderizar(resultado({estado:'sin_linea_base',nuevas:[{actual:reserva}]}));
    assert.match(html,/primera versión/);assert.doesNotMatch(html,/NUEVA|Persona Prueba/);
});
test('sin cambios',()=>assert.match(A.renderizar(resultado({estado:'sin_cambios'})),/no detectó cambios operacionales/));
test('nueva: fechas y noches legibles, datos personales no visibles',()=>{
    const html=A.renderizar(resultado({nuevas:[{actual:{...reserva,rut_documento:'12345678-9',telefono:'999999999',correo:'privado@example.test'}}]}));
    assert.match(html,/NUEVA/);assert.match(html,/11-09-2026 → 13-09-2026 · 2 noches/);
    assert.doesNotMatch(html,/12345678|999999999|privado@example/);
});
test('modificaciones exclusivamente desde cambios; arrays, servicios y privacidad',()=>{
    const html=A.renderizar(resultado({modificadas:[{actual:{...reserva,texto_original:'NO MOSTRAR'},cambios:[
        {campo:'adultos',antes:2,ahora:3},{campo:'notas_importantes',antes:['Aniversario'],ahora:['Aniversario','Tinaja']},
        {campo:'servicios',antes:[],ahora:[{concepto:'Tinaja',hora:'20:00',pendiente:true}]},
        {campo:'correo',antes:'old@example.test',ahora:'new@example.test'}]}]}));
    for(const text of ['Adultos','2 → 3','Aniversario · Tinaja','Tinaja · 20:00 · Pendiente','valores personales ocultos']) assert.ok(html.includes(text));
    assert.doesNotMatch(html,/NO MOSTRAR|example.test|\[object Object\]/);
});
test('ya no aparece nunca equivale a cancelada',()=>{
    const html=A.renderizar(resultado({ya_no_aparecen:[{anterior:reserva}]}));assert.match(html,/YA NO APARECE/);assert.doesNotMatch(html,/cancelada/i);
});
test('ambigüedad conserva candidatos de ambas versiones para revisión',()=>{
    const html=A.renderizar(resultado({ambiguas:[{anteriores:[reserva],actuales:[{...reserva,cabana:10}]}]}));
    assert.match(html,/Requiere revisión/);assert.match(html,/Versión anterior/);assert.match(html,/Versión actual/);assert.match(html,/CAB 10/);
});
test('continuidad sola no suma modificaciones',()=>{
    const html=A.renderizar(resultado({continuidades:[{segmentos:[reserva,{...reserva,cabana:10}]}]}));
    assert.match(html,/<strong>0<\/strong><span>Modificadas/);assert.doesNotMatch(html,/MODIFICADA/);
});
test('hoja especial se advierte sin inventar contenido',()=>{
    const html=A.renderizar(resultado({diagnostico:{hojas_especiales_modificadas:['REEMBOLSOS']}}));
    assert.match(html,/REEMBOLSOS/);assert.match(html,/todavía no tiene interpretación automática/);
});
test('parcial y no comparable se presentan con incertidumbre',()=>{
    for(const estado of ['parcial','no_comparable']) assert.match(A.renderizar(resultado({estado})),/no pudo compararse con seguridad/);
});
test('contenido del Libro se escapa; no inyecta HTML',()=>{
    const html=A.renderizar(resultado({nuevas:[{actual:{...reserva,titular:'<img src=x onerror=alert(1)>'}}]}));
    assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
test('cache reutiliza generación y vuelve a comparar al cambiarla',async()=>{
    let llamadas=0,g=1;const c=A.crearCache(async()=>{llamadas++;return resultado();},()=>g);
    await c.obtener();await c.obtener();assert.equal(llamadas,1);g++;await c.obtener();assert.equal(llamadas,2);
});
test('cache comparte una comparación en vuelo y descarta generación invalidada',async()=>{
    let llamadas=0,resolver;const c=A.crearCache(()=>{llamadas++;return new Promise(r=>resolver=r);},()=>1);
    const a=c.obtener(),b=c.obtener();await Promise.resolve();assert.equal(llamadas,1);c.invalidar();resolver(resultado());
    const fin=await Promise.allSettled([a,b]);assert.ok(fin.every(x=>x.status==='rejected'));
});
function montar(comparar) {
    class Elemento {
        constructor(){this.value='';this.children=[];this.listeners={};this.textContent='';this.innerHTML='';}
        appendChild(el){this.children.push(el);}
        addEventListener(t,fn,capture){(this.listeners[t] ||= []).push({fn,capture});}
        dispatchEvent(e){for(const x of this.listeners[e.type] || []) x.fn(e);}
        querySelector(){return this.adjunto || null;}
    }
    const ids=Object.fromEntries(['texto','enviar','mensajes','adjuntos'].map(x=>['haiku-asistente-'+x,new Elemento()]));
    const events={};let llamadas=0,g=1;
    const document={getElementById:id=>ids[id],createElement:()=>new Elemento(),head:new Elemento()};
    const captures={};
    const window={document,Event:class {constructor(type){this.type=type;}},addEventListener:(t,f,c)=>{events[t]=f;captures[t]=c;},
        HAIKU_LIBRO_RESERVA_V1:{estado:()=>({generacion:g})},
        HAIKU_LIBRO_DIFERENCIAS_V1:{compararUltimasVersiones:()=>{llamadas++;return comparar();}}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/supabase-asistente-libro-actualizacion-v1.js'),'utf8'),{window});
    const enviar=(texto='Haku, informe de actualización',type='click',extra={})=>{
        ids['haiku-asistente-texto'].value=texto;
        const target=type==='click'?{closest:s=>s==='#haiku-asistente-enviar'?ids['haiku-asistente-enviar']:null}:ids['haiku-asistente-texto'];
        const e={type,target,key:'Enter',preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
        events[type](e);return e;
    };
    return {ids,events,captures,enviar,llamadas:()=>llamadas,mensajes:()=>ids['haiku-asistente-mensajes'].children};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('click capture muestra espera y resultado; evento del Libro invalida cache',async()=>{
    const h=montar(async()=>resultado());assert.equal(h.captures.click,true);
    const e=h.enviar();assert.ok(e.stopped);assert.match(h.mensajes()[1].textContent,/Comparando/);
    await tick();assert.match(h.mensajes()[1].innerHTML,/Actualización del Libro/);
    h.enviar();await tick();assert.equal(h.llamadas(),1);h.events['haiku:libro-cambio']();h.enviar();await tick();assert.equal(h.llamadas(),2);
});
test('doble envío y Enter repetido no crean dos comparaciones ni mensajes duplicados',async()=>{
    let resolver;const h=montar(()=>new Promise(r=>resolver=r));h.enviar();h.enviar(undefined,'keydown');await tick();
    assert.equal(h.llamadas(),1);assert.equal(h.mensajes().length,2);resolver(resultado());await tick();
});
test('error libera ocupado y permite nueva consulta sin romper otras intenciones',async()=>{
    let falla=true;const h=montar(async()=>{if(falla)throw Error('Error de prueba');return resultado();});
    h.enviar();await tick();assert.equal(h.mensajes()[1].textContent,'Error de prueba');
    falla=false;h.enviar();await tick();assert.equal(h.llamadas(),2);
    assert.equal(h.enviar('resumen del día').stopped,undefined);
});
test('adjuntos, Shift Enter y composición no se interceptan',async()=>{
    const h=montar(async()=>resultado());
    assert.equal(h.enviar(undefined,'keydown',{shiftKey:true}).stopped,undefined);
    assert.equal(h.enviar(undefined,'keydown',{isComposing:true}).stopped,undefined);
    h.ids['haiku-asistente-adjuntos'].adjunto={};assert.equal(h.enviar().stopped,undefined);
    await tick();assert.equal(h.llamadas(),0);
});
test('integración: script antes del interceptor amplio del Libro y sólo una inclusión',()=>{
    const panel=fs.readFileSync(require.resolve('../panel.html'),'utf8');
    const modulo="'supabase-asistente-libro-actualizacion-v1'";
    assert.equal(panel.split(modulo).length-1,1);
    assert.ok(panel.indexOf("'haiku-libro-diferencias-v1'")<panel.indexOf(modulo));
    assert.ok(panel.indexOf(modulo)<panel.indexOf("'haiku-libro-consultas-v1'"));
});
test('intenciones del Libro se detienen antes de la ruta general; otros controles siguen libres',async()=>{
    const h=montar(async()=>resultado());
    assert.equal(h.enviar('qué cambió en el libro').stopped,true);
    await tick();
    assert.equal(h.enviar('busca a Juan en el libro').stopped,undefined);
    assert.equal(h.enviar(undefined,'click',{target:{closest:()=>null}}).stopped,undefined);
});
test('advertencia singular muestra el detalle real y no inventa titular',()=>{
    const html=A.renderizar(resultado({advertencias:[{tipo:'advertencia_de_origen_conservada',anterior:'Sep26!CE8',actual:'Sep26!CE8',detalles:['Las noches escritas no coinciden con las fechas combinadas; confirmar ingreso/salida.']}]}));
    assert.match(html,/1 advertencia de interpretación o cobertura requiere revisión\./);
    assert.match(html,/Sep26!CE8 · Advertencia de origen conservada: Las noches escritas no coinciden/);
    assert.doesNotMatch(html,/1 advertencias|Angelo/);
    assert.match(html,/<strong>0<\/strong><span>Por revisar/);
});
test('advertencias plurales conservan contexto explícito y se separan de ambiguas',()=>{
    const html=A.renderizar(resultado({advertencias:[{hoja:'Sep26',titular:'Persona Prueba',motivo:'Noches inconsistentes.'},{hoja:'Oct26',tipo:'huella_no_disponible'}],ambiguas:[{anteriores:[reserva],actuales:[]}]}));
    assert.match(html,/2 advertencias de interpretación o cobertura requieren revisión\./);
    assert.match(html,/Sep26 · Persona Prueba: Noches inconsistentes/);
    assert.match(html,/Oct26 · Huella no disponible/);
    assert.match(html,/<strong>1<\/strong><span>Por revisar/);
});
test('avisos de validación y cobertura muestran código y motivo sin volcar objetos personales',()=>{
    const html=A.renderizar(resultado({estado:'parcial',advertencias:[{hoja:'Sep26',validacion:[{codigo:'checkout_anterior_al_checkin',origen:{hoja:'Sep26'},rut_documento:'12345678-9',correo:'privado@example.test'}]}],no_comparables:[{hoja:'Oct26',motivo:'Geometría no reconocida o lectura incompleta.'}]}));
    assert.match(html,/El check-out es anterior al check-in/);
    assert.match(html,/Oct26: Geometría no reconocida o lectura incompleta/);
    assert.doesNotMatch(html,/12345678|privado@example|\[object Object\]/);
});
test('detalle de advertencia escapa HTML y admite código sin explicación adicional',()=>{
    const html=A.renderizar(resultado({advertencias:[{hoja:'<img src=x>',codigo:'revision_de_origen'},{hoja:'Sep26',detalles:['<script>texto</script>']}]}));
    assert.match(html,/revision de origen/);assert.match(html,/&lt;script&gt;/);
    assert.doesNotMatch(html,/<img|<script/);
});

test('informe compacto conserva cambios y avisos sin mutar ni deduplicar casos',()=>{
    const r=resultado({modificadas:[{actual:reserva,cambios:[{campo:'notas_importantes',antes:['Nota extensa'],ahora:[]}]}],advertencias:[{hoja:'Sep26',motivo:'Revisar origen'},{hoja:'Sep26',motivo:'Revisar origen'}],no_comparables:[{hoja:'Oct26',motivo:'Cobertura parcial'}]});
    const antes=JSON.stringify(r),html=A.renderizar(r);
    assert.equal(JSON.stringify(r),antes);
    assert.match(html,/haku-actualizacion-sites__grupo--modificadas/);
    assert.match(html,/<span>Modificadas \(1\)<\/span>/);
    assert.match(html,/class="haku-libro-item haku-pregunta-caso"/);
    assert.match(html,/Nota extensa → Ninguno/);
    assert.match(html,/<span>Advertencias de interpretación \/ cobertura \(3\)<\/span>/);
    assert.equal((html.match(/Revisar origen/g)||[]).length,2);
    assert.match(html,/Cobertura parcial/);
    assert.doesNotMatch(html,/<details[^>]*\sopen(?:[\s=>])/);
});

test('sin cambios históricos pendientes muestra sincronización y oculta preparar',()=>{
    const html=A.renderizarPendientes({items:[],generacion:7,preparacion:{reservas:[reserva]}});
    assert.match(html,/Cambios detectados aún pendientes de aplicar/);
    assert.match(html,/haku-pendientes-compactos haku-actualizacion-sites__historial/);
    assert.match(html,/Todos los cambios detectados ya están sincronizados con Proyecto H/);
    assert.match(html,/Revalidar contra Proyecto H/);
    assert.doesNotMatch(html,/Preparar incorporación/);
});

test('un cambio histórico accionable muestra valores y habilita preparar sin exponer contacto',()=>{
    const actual={...reserva,correo:'privado@example.test',telefono:'999999999',rut_documento:'12345678-9',estado_operativo:'hospedada'};
    const pendientes={generacion:7,items:[{tipo:'modificacion',actual,detectado_generacion:6,estado:'pendiente',accionable:true,
        cambios:[{campo:'estado_operativo',antes:'confirmada',ahora:'hospedada',proyecto:'confirmada'}]}],preparacion:{reservas:[actual]}};
    const html=A.renderizarPendientes(pendientes);
    assert.match(html,/CAMBIO DETECTADO ANTERIORMENTE · PENDIENTE/);
    assert.match(html,/Anterior: confirmada/);assert.match(html,/Nuevo valor del Libro: hospedada/);assert.match(html,/Proyecto H actual: confirmada/);
    assert.match(html,/class="haku-pendiente-item haku-actualizacion-sites__pendiente/);
    assert.doesNotMatch(html,/<details[^>]*\sopen(?:[\s=>])/);
    assert.match(html,/data-haku-preparar-pendientes/);
    assert.match(html,/Preparar incorporación/);assert.doesNotMatch(html,/privado@example|999999999|12345678/);
});

test('un cambio detectado en la generación actual se distingue como cambio de esta actualización',()=>{
    const actual={...reserva,adultos:3};
    const html=A.renderizarPendientes({generacion:7,items:[{tipo:'modificacion',actual,detectado_generacion:7,estado:'pendiente',accionable:true,
        cambios:[{campo:'adultos',antes:2,ahora:3,proyecto:2}]}],preparacion:{reservas:[actual]}});
    assert.match(html,/CAMBIO DE ESTA ACTUALIZACIÓN/);assert.match(html,/Anterior: 2/);assert.match(html,/Nuevo valor del Libro: 3/);
    assert.match(html,/Proyecto H actual: 2/);assert.match(html,/Preparar incorporación/);
});

test('historial fusiona A→B y B→C sin inventar una auditoría mensual',()=>{
    const a={...reserva,estado_operativo:'confirmada'},b={...reserva,estado_operativo:'hospedada'},c={...b,adultos:3};
    const ab={generado_en:'2026-09-18T10:00:00Z',modificadas:[{anterior:a,actual:b,cambios:[{campo:'estado_operativo',antes:'confirmada',ahora:'hospedada'}]}]};
    const bc={generado_en:'2026-09-19T10:00:00Z',modificadas:[{anterior:b,actual:c,cambios:[{campo:'adultos',antes:2,ahora:3}]}]};
    const uno=A.fusionarHistorialCambios(null,ab,2),dos=A.fusionarHistorialCambios(uno,bc,3);
    assert.equal(dos.cambios.length,1);assert.equal(dos.cambios[0].actual.adultos,3);
    assert.deepEqual(dos.cambios[0].cambios.map(x=>x.campo).sort(),['adultos','estado_operativo']);
});

test('cache histórica no relee XLSX y Revalidar sólo repite la consulta focal',async()=>{
    let lecturas=0,guardados=0,revalidaciones=0,g=7,registro={version:1,cambios:[]};
    const resultadoInforme={libro_actual:{generacion:7},modificadas:[]};
    const cache=A.crearCachePendientes({generacion:()=>g,leer:async()=>{lecturas++;return registro;},guardar:async x=>{guardados++;registro=x;},
        revalidarCambios:async cambios=>{revalidaciones++;assert.equal(cambios.length,0);return {items:[],resueltos:[],reservas:[],comparacion:[],q:null};}});
    await cache.obtener(resultadoInforme);await cache.obtener(resultadoInforme);
    assert.deepEqual([lecturas,guardados,revalidaciones],[1,0,1]);
    await cache.obtener(resultadoInforme,{revalidar:true});
    assert.deepEqual([lecturas,guardados,revalidaciones],[2,0,2]);
    g=8;await assert.rejects(cache.obtener(resultadoInforme),/Libro cambió/);
});

test('un fallo focal conserva el historial y permite reintentar',async()=>{
    let intentos=0,registro={version:1,cambios:[]};
    const cache=A.crearCachePendientes({generacion:()=>3,leer:async()=>registro,guardar:async x=>{registro=x;},
        revalidarCambios:async()=>{intentos++;if(intentos===1)throw Error('Supabase no disponible');return {items:[],resueltos:[],reservas:[],comparacion:[],q:null};}});
    const informe={libro_actual:{generacion:3},modificadas:[]};
    await assert.rejects(cache.obtener(informe),/Supabase no disponible/);
    await cache.obtener(informe,{revalidar:true});assert.equal(intentos,2);
});
