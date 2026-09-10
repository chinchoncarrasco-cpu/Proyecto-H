const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../js/haiku-libro-semantica-v1.js');
const reserva=(extra={})=>({id:'Sep26!AQ10',titular:'Mauricio Cepeda',cabana:8,fecha_checkin:'2026-09-11',fecha_checkout:'2026-09-13',tipo_estadia:'alojamiento',noches:2,adultos:2,rut_documento:'12345678-9',correo:'prueba@example.test',telefono:'+56912345678',pagos:[],pagos_sin_asociacion:[],servicios:[],advertencias:[],notas_importantes:[],coordenadas_origen:{hoja:'Sep26',celda:'AQ10'},...extra});
function entorno() {
 class El {
  constructor(tag){this.tag=tag;this.textContent='';this.children=[];this.style={};this.events={};this.dataset={};this.selectedIndex=0;}
  append(...xs){this.children.push(...xs)} appendChild(x){this.append(x)} replaceChildren(...xs){this.children=xs} addEventListener(k,f){this.events[k]=f}
  setAttribute(k,v){this[k]=v} get options(){return this.children} get text(){return this.textContent}
  querySelectorAll(s){return this.children.flatMap(e=>[e,...e.querySelectorAll('*')]).filter(e=>s==='*'||s===e.tag||s==='details[open]'&&e.tag==='details'&&e.open||s.startsWith('.')&&(e.className||'').split(' ').includes(s.slice(1)));}
  querySelector(s){return this.querySelectorAll(s)[0]||null}
 }
 let generacion=1,lecturas=0,writes=0;const rows=[];
 const cliente={auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(table){lecturas++;const data=table==='reserva_estadias'?rows:[];const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range(a,z){return Promise.resolve({data:data.slice(a,z+1)})}};return b;},rpc(){writes++;throw Error('Escritura no autorizada en esta prueba');}};
 const context={structuredClone,HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_RESERVA_V1:{estado:()=>({generacion})},haikuSupabase:cliente,confirm:()=>false,
 document:{createElement:t=>new El(t),querySelector:()=>null},addEventListener(){},Option:function(t,v){const e=new El('option');e.textContent=t;e.value=v;return e;}};
 let source=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
 // Centinelas: cualquier llegada al parser o a consultar(texto) hace fallar la prueba.
 source=source.replace('function interpretar(texto, hojas) {','function interpretar(texto, hojas) { throw Error("PARSER PROHIBIDO");');
 source=source.replace('async function consultar(texto, libro = root.HAIKU_LIBRO_RESERVA_V1, cliente = root.haikuSupabase) {','async function consultar(texto, libro = root.HAIKU_LIBRO_RESERVA_V1, cliente = root.haikuSupabase) { throw Error("TEXTO PROHIBIDO");');
 vm.runInNewContext(source,context);
 const out=new El('div');
 return {context,out,El,rows,Q:context.HAIKU_LIBRO_CONSULTAS,lecturas:()=>lecturas,writes:()=>writes,cambiar:()=>generacion++,
 boton:t=>out.querySelectorAll('button').find(x=>x.textContent===t),texto:()=>out.querySelectorAll('*').map(x=>x.textContent).join(' ')};
}
test('entrada estructurada ejecuta reconciliación sin parser y conserva registros completos',async()=>{
 const h=entorno(),r=reserva();const result=await h.Q.abrirComparacionEstructurada(h.out,{reservas:[r],generacion:1});
 assert.equal(JSON.stringify(result.reservas[0]),JSON.stringify(r));assert.ok(h.lecturas()>0);assert.equal(h.writes(),0);assert.ok(h.boton('Preparar incorporación'));
});
test('revalidación estructurada vuelve a leer Proyecto H sin consultar texto',async()=>{
 const h=entorno();await h.Q.abrirComparacionEstructurada(h.out,{reservas:[reserva()],generacion:1});const antes=h.lecturas();
 await h.boton('Revalidar contra Proyecto H').events.click();assert.ok(h.lecturas()>antes);assert.match(h.texto(),/Revalidación completada/);assert.doesNotMatch(h.texto(),/PROHIBIDO/);
});
test('misma UI prepara decisiones y pagos; confirmación cancelada no escribe',async()=>{
 const h=entorno();await h.Q.abrirComparacionEstructurada(h.out,{reservas:[reserva()],generacion:1});
 await h.boton('Preparar incorporación').events.click();assert.match(h.texto(),/Confirmar incorporación/);assert.match(h.texto(),/Pagos preparados/);
 const continuar=h.out.querySelectorAll('button').find(x=>/^Continuar con/.test(x.textContent));assert.ok(continuar);await continuar.events.click();assert.equal(h.writes(),0);
});
test('generación obsoleta se bloquea antes de lectura y también en revalidación',async()=>{
 const h=entorno();await assert.rejects(h.Q.abrirComparacionEstructurada(h.out,{reservas:[reserva()],generacion:0}),/El Libro cambió/);assert.equal(h.lecturas(),0);
 await h.Q.abrirComparacionEstructurada(h.out,{reservas:[reserva()],generacion:1});h.cambiar();const antes=h.lecturas();await h.boton('Revalidar contra Proyecto H').events.click();assert.equal(h.lecturas(),antes);assert.match(h.texto(),/El Libro cambió/);
});
const cambio=x=>({estado:'ok',nuevas:[],modificadas:[],ya_no_aparecen:[],ambiguas:[],advertencias:[],no_comparables:[],continuidades:[],...x});
const B=require('../js/supabase-asistente-libro-incorporacion-v1.js');
function puente(h){vm.runInNewContext(fs.readFileSync(require.resolve('../js/supabase-asistente-libro-incorporacion-v1.js'),'utf8'),h.context);return h.context.HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1;}
test('puente pasa actual completo, conserva anterior y cambios sólo como contexto',()=>{
 const actual=reserva({pagos:[{folio:'00001',bovtar:'111',monto:100,datos_tarjeta:{tipo:'debito'}}],pagos_sin_asociacion:[{monto:20}],servicios:[{concepto:'Tinaja'}],operador:'OP'});
 const anterior=reserva({cabana:5});const original=cambio({modificadas:[{actual,anterior,cambios:[{campo:'cabana',antes:5,ahora:8}]}]});
 const input=B.adaptar(original,1);assert.deepEqual(input.reservas,[actual]);assert.deepEqual(input.contexto[0].anterior,anterior);assert.notEqual(input.reservas[0],actual);assert.equal(input.noTransferibles[0].tipo,'Servicios');
});
test('deduplicación sólo colapsa repetición completa, no fusiona Macarena ni conflictos',()=>{
 const a=reserva({id:'A',titular:'Macarena Hurtado',cabana:5,fecha_checkin:'2026-09-03',fecha_checkout:'2026-09-04',noches:1});
 const b=reserva({id:'B',titular:'Macarena Hurtado',cabana:10,fecha_checkin:'2026-09-04',fecha_checkout:'2026-09-04',noches:0,tipo_estadia:'full_day'});
 const r=cambio({nuevas:[{actual:a},{actual:structuredClone(a)},{actual:b}],continuidades:[{segmentos:[a,b]}]});
 assert.deepEqual(B.adaptar(r,1).reservas,[a,b]);
 r.nuevas.push({actual:{...a,correo:'distinto@example.test'}});assert.equal(B.adaptar(r,1).reservas.length,3);
});
test('ausencias, ambiguas y advertencias nunca entran como reservas accionables',()=>{
 const r=cambio({ya_no_aparecen:[{anterior:reserva()}],ambiguas:[{actuales:[reserva()]}],advertencias:[{hoja:'Sep26'}],no_comparables:[{hoja:'REEMBOLSOS'}]});
 const a=B.adaptar(r,1);assert.equal(a.reservas.length,0);assert.equal(a.noTransferibles.length,4);assert.match(a.noTransferibles[0].motivo,/no confirma cancelación/);
});
test('sin cambios no prepara ni muestra botón',async()=>{
 const h=entorno(),b=puente(h);b.adjuntar(h.out,cambio({estado:'sin_cambios'}),1);
 assert.equal(h.out.children.length,0);const r=await b.preparar(cambio({estado:'sin_cambios'}),1,h.out);assert.equal(r.result,null);assert.equal(h.lecturas(),0);
});
test('botón recibe el objeto visible y no llama al comparador XLSX',async()=>{
 const h=entorno(),b=puente(h);h.context.HAIKU_LIBRO_DIFERENCIAS_V1={compararUltimasVersiones(){throw Error('No recalcular XLSX');}};
 b.adjuntar(h.out,cambio({nuevas:[{actual:reserva()}]}),1);assert.ok(h.boton('Preparar cambios en Proyecto H'));
 await h.boton('Preparar cambios en Proyecto H').events.click();assert.match(h.texto(),/Preparación para Proyecto H/);assert.ok(h.lecturas()>0);assert.equal(h.writes(),0);
});
test('Mauricio conserva CAB 8 y 11→13 al reconciliar; Proyecto H puede decir que ya existe',async()=>{
 const h=entorno(),b=puente(h),r=reserva();h.rows.push({id:'estadia',reserva_id:'reserva',cabanas:{numero:8},fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,estado_estadia:'confirmada',tipo_estadia:'alojamiento',adultos:2,reservas:{titular_nombre:r.titular,titular_numero_documento:r.rut_documento,correo_contacto:r.correo,telefono_contacto:r.telefono,estado_reserva:'confirmada'}});
 const p=await b.preparar(cambio({nuevas:[{actual:r}]}),1,h.out);
 assert.equal(p.result.reservas[0].fecha_checkin,'2026-09-11');assert.equal(p.result.reservas[0].cabana,8);assert.equal(p.result.comparacion.grupos[0].estado,'asociada');
});
test('Angelo sin cambio y continuidades solas no se inventan como nuevas ni ambiguas',()=>{
 const r=cambio({advertencias:[{tipo:'advertencia_de_origen_conservada',actual:'Sep26!CE8'}],continuidades:[{segmentos:[reserva()]}]});
 const a=B.adaptar(r,1);assert.equal(a.reservas.length,0);assert.equal(a.noTransferibles.length,1);
});
test('puente rechaza generación antigua antes de red',async()=>{
 const h=entorno(),b=puente(h);h.cambiar();await assert.rejects(b.preparar(cambio({nuevas:[{actual:reserva()}]}),1,h.out),/El Libro cambió desde este informe/);assert.equal(h.lecturas(),0);
});
test('error de red no crea vista previa accionable ni estado incorporado',async()=>{
 const h=entorno(),b=puente(h);h.context.haikuSupabase.auth.getSession=async()=>{throw Error('Red no disponible');};
 b.adjuntar(h.out,cambio({nuevas:[{actual:reserva()}]}),1);await h.boton('Preparar cambios en Proyecto H').events.click();
 assert.match(h.texto(),/Red no disponible/);assert.equal(h.boton('Preparar incorporación'),undefined);assert.equal(h.writes(),0);
});
test('confirmación del núcleo mantiene segunda lectura y RPC existente, sólo mock',async()=>{
 const h=entorno(),b=puente(h);const {result}=await b.preparar(cambio({nuevas:[{actual:reserva()}]}),1,h.out);
 const decisiones=new Map(),aprobados=new Set();const plan=await h.Q.prepararIncorporacion(result,decisiones,aprobados,h.context.haikuSupabase);
 const antes=h.lecturas(),rpc=[];h.context.haikuSupabase.rpc=async(n,args)=>{rpc.push({n,args});return {data:{ok:true}};};
 await h.Q.confirmarIncorporacion(result,decisiones,aprobados,plan,h.context.haikuSupabase);
 assert.ok(h.lecturas()>antes);assert.equal(rpc.length,1);assert.equal(rpc[0].n,'haiku_incorporar_libro_v1');assert.equal(rpc[0].args.p_items[0].tipo,'reserva_nueva');
});
test('puente no contiene parser, RPC, SQL ni modificaciones operacionales',()=>{
 const source=fs.readFileSync(require.resolve('../js/supabase-asistente-libro-incorporacion-v1.js'),'utf8');
 assert.doesNotMatch(source,/\.rpc\s*\(|\.from\s*\(|consultar\s*\(|compararUltimasVersiones\s*\(|\.value\s*=|\bDELETE FROM\b|\bUPDATE .* SET\b/i);
});
test('informe manual y Ver informe adjuntan el puente con la generación original del resultado cacheado',async()=>{
 const h=entorno();puente(h);const listeners={};
 h.context.addEventListener=(t,f)=>(listeners[t] ||= []).push(f);
 h.context.Event=class {constructor(type){this.type=type;}};
 const campo={value:'',dispatchEvent(){}},enviar={},mensajes=h.out;
 h.context.document.getElementById=id=>({'haiku-asistente-texto':campo,'haiku-asistente-enviar':enviar,'haiku-asistente-mensajes':mensajes}[id]);
 h.context.document.head=new h.El('head');
 let llamadas=0;const datos=cambio({nuevas:[{actual:reserva()}]});
 h.context.HAIKU_LIBRO_DIFERENCIAS_V1={compararUltimasVersiones:async()=>{llamadas++;return datos;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/supabase-asistente-libro-actualizacion-v1.js'),'utf8'),h.context);
 const E=h.context.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1;
 const obtenido=await E.obtenerResultado();assert.equal(obtenido,datos);E.mostrarResultado(obtenido);
 assert.ok(h.boton('Preparar cambios en Proyecto H'));await h.boton('Preparar cambios en Proyecto H').events.click();assert.match(h.texto(),/Preparación para Proyecto H/);assert.equal(llamadas,1);
 campo.value='Haku, informe de actualización';for(const f of listeners.click)f({type:'click',target:{closest:()=>enviar},preventDefault(){},stopImmediatePropagation(){}});
 await new Promise(r=>setImmediate(r));assert.equal(llamadas,1);assert.equal(h.out.querySelectorAll('button').filter(x=>x.textContent==='Preparar cambios en Proyecto H').length,2);
 h.cambiar();for(const f of listeners['haiku:libro-cambio'])f();
 assert.ok(h.out.querySelectorAll('button').filter(x=>x.textContent==='Preparar cambios en Proyecto H').every(x=>x.disabled));
 E.mostrarResultado(obtenido);const ultimo=h.out.children.at(-1);const boton=ultimo.querySelectorAll('button')[0];await boton.events.click();
 assert.match(ultimo.querySelectorAll('*').map(x=>x.textContent).join(' '),/El Libro cambió desde este informe/);assert.equal(llamadas,1);
});
