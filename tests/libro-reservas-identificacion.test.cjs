const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../js/haiku-libro-semantica-v1.js');
const F=require('./fixtures/libro-comparacion-readonly.cjs');
const {Element}=require('./fixtures/libro-servicio-manual.cjs');
const consulta='Libro: compara reservas de noviembre 2026 con Proyecto H';
const nombre='Héctor del Valle Rojas';
// Estructura de CAB 5, X7:AD7; todos los datos personales son ficticios.
const nota='WALK IN// TINAJA DE CORTESIA TONEL SAB 07//11/2026 DE 17:45 A 18:45 BATAS ENTREGADAS';
const texto=`${nombre}//rut:12345678-5//prueba@example.invalid//+56900000001//2 adl+2noches//myr//06-11-2026//${nota}`;
function hoja(valor=texto){return {celdas:[
 {r:1,c:23,valor:'6 nov',fechaISO:'2026-11-06'},{r:1,c:27,valor:'7 nov',fechaISO:'2026-11-07'},
 {r:1,c:31,valor:'8 nov',fechaISO:'2026-11-08'},
 {r:6,c:0,valor:'cabaña 5'},{r:6,c:23,valor,estiloId:0,
  ...(valor===texto?{runs:[{texto:valor.slice(0,valor.indexOf(nota)),font:{color:{rgb:'FFFFFFFF'}}},{texto:nota,font:{color:{rgb:'FFFF0000'}}}]}:{})},
 {r:24,c:23,valor:'Pagos de arriendos de hoy'}],
 combinaciones:[{s:{r:6,c:23},e:{r:6,c:29}}],estilos:[{font:{color:{rgb:'FFFFFFFF'}}}]};}
function pagina(valor=texto){
 const data=S.normalizarHoja(hoja(valor),'Nov26'),w=F.web(data);
 w.HAIKU_LIBRO_RESERVA_V1={...w.HAIKU_LIBRO_RESERVA_V1,listarHojas:()=>['Nov26']};
 const cliente=F.cliente({reserva_estadias:[],pagos:[],cabanas:[],bloqueos_cabana:[]});
 const Q=w.HAIKU_LIBRO_CONSULTAS;
 return {data,w,cliente,Q,consultar:t=>Q.consultar(t||consulta,w.HAIKU_LIBRO_RESERVA_V1,cliente)};
}
function vista(w){
 w.document.createElement=t=>new Element(t);w.document.getElementById=()=>null;
 const codigo=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
 vm.runInContext(codigo.replace('const apiConsultas = Object.freeze({ interpretar,',
  'const apiConsultas = Object.freeze({ renderizarComparacion, renderizarConsultaLibro, interpretar,'),w);
 const out=new Element('div');return {out,render:r=>w.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out,r),
  consulta:r=>w.HAIKU_LIBRO_CONSULTAS.renderizarConsultaLibro(out,r)};
}
test('CAB 5: texto, celdas y estado conservan una reserva WALK IN de dos noches',()=>{
 const d=pagina().data;assert.equal(d.reservas.length,1);const r=d.reservas[0];
 assert.equal(r.titular,nombre);assert.equal(r.cabana,5);assert.equal(r.adultos,2);
 assert.equal(r.fecha_checkin,'2026-11-06');assert.equal(r.fecha_checkout,'2026-11-08');assert.equal(r.noches,2);
 assert.deepEqual(r.fechas_ocupadas,['2026-11-06','2026-11-07']);assert.equal(r.estado_operativo,'hospedada');
 assert.equal(r.texto_original,texto);assert.equal(r.coordenadas_origen.celda,'X7');
 assert.ok(r.notas_importantes.includes(nota));
 assert.ok(r.servicios.some(s=>s.concepto==='tonel'));assert.equal(d.anotaciones.filter(a=>a.tipo==='reserva_por_identificar').length,0);
});
test('consulta → comparación → preparación ofrece CAB 5 faltante sin registrar nada',async()=>{
 const h=pagina(),r=await h.consultar();assert.equal(r.comparacion.meta.faltantes,1);
 assert.equal(r.comparacion.grupos[0].principal.titular,nombre);
 const plan=await h.Q.prepararIncorporacion(r,new Map(),new Set(),h.cliente);
 const nuevas=plan.items.filter(i=>i.categoria==='nuevas');assert.equal(nuevas.length,1);assert.equal(nuevas[0].seleccionado,true);
 assert.equal(nuevas[0].payload.estadias[0].datos.fecha_salida,'2026-11-08');
 assert.deepEqual(h.cliente.mutaciones,[]);
 const v=vista(h.w);v.render(r);assert.match(v.out.textContent,/Reservas que faltan/);assert.ok(v.out.textContent.includes(nombre));
});
test('dos titulares reales permanecen visibles, sin crear una reserva arbitraria',async()=>{
 const h=pagina('Ana Pérez // Juan Soto // 2 ADL // 2 noches // WALK IN'),r=await h.consultar();
 assert.equal(r.reservas.length,0);assert.equal(r.reservas_por_identificar.length,1);
 const a=r.reservas_por_identificar[0];assert.equal(a.cabana,5);assert.equal(a.origen.celda,'X7');
 assert.deepEqual(Array.from(a.titulares_posibles),['Ana Pérez','Juan Soto']);
 assert.equal(h.Q.modeloPresentacionComparacion(r).contadores.reservasPorIdentificar,1);
 const mensaje=h.Q.respuesta(r);assert.match(mensaje,/RESERVAS POR IDENTIFICAR/);assert.match(mensaje,/Ana Pérez \/ Juan Soto/);
 assert.doesNotMatch(mensaje,/No encontré reservas claramente faltantes/);
 const v=vista(h.w);v.render(r);
 const aviso=v.out.querySelectorAll('details').find(d=>d.querySelector('summary')?.['aria-label']==='Reservas por identificar (1)');
 assert.ok(aviso?.open);assert.match(aviso.textContent,/CAB 5/);assert.match(aviso.textContent,/Falta aclarar quién es el titular/);
 assert.match(v.out.textContent,/comparación está incompleta/);
 const plan=await h.Q.prepararIncorporacion(r,new Map(),new Set(),h.cliente);
 assert.equal(plan.items.filter(i=>i.categoria==='nuevas').length,0);assert.deepEqual(h.cliente.mutaciones,[]);
});
test('las dudas respetan titular, CAB y todos los días ocupados, no sólo el ingreso',async()=>{
 const h=pagina('Ana Pérez // Juan Soto // 2 ADL // 2 noches');
 for(const [texto,cantidad] of [
  ['Libro: CAB 5 el 07-11-2026',1],['Libro: CAB 5 el 08-11-2026',0],['Libro: CAB 4 el 07-11-2026',0],
  ['Libro: reserva de Ana Pérez',1],['Libro: reserva de Otra Persona',0]]){
  const r=await h.consultar(texto);assert.equal(r.reservas_por_identificar.length,cantidad,texto);
  if(cantidad){const v=vista(h.w);v.consulta(r);assert.match(v.out.textContent,/Reservas por identificar/);}
 }
});
test('el informe mensual exporta la reserva sin identificar y declara cobertura incompleta',async()=>{
 const h=pagina('Ana Pérez // Juan Soto // 2 ADL // 2 noches');
 vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-comparacion-readonly-v1.js'),'utf8'),h.w);
 const d=await h.w.HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo().compararMes({
  fuente:{libro:h.w.HAIKU_LIBRO_RESERVA_V1},cliente:h.cliente,ahora:'2026-11-07T12:00:00Z'});
 assert.equal(d.status,'incompleto');assert.equal(d.presentacion.reservasPorIdentificar,1);
 assert.equal(d.contexto.reservasPorIdentificar[0].cabana,5);assert.equal(d.contexto.reservasPorIdentificar[0].origen.celda,'X7');
 assert.deepEqual(Array.from(d.contexto.reservasPorIdentificar[0].titularesPosibles),['Ana Pérez','Juan Soto']);
 assert.deepEqual(h.cliente.mutaciones,[]);
});
