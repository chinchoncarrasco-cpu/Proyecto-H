// Casos ficticios: detectar un traslado no autoriza crear una segunda estadía.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('./fixtures/libro-comparacion-readonly.cjs');
const {Element}=require('./fixtures/libro-servicio-manual.cjs');
test('el cambio de CAB muestra origen y destino, exige revisión y no escribe',async()=>{
 const f=F.casos().find(x=>x.id==='cambio_cabana'),w=F.web(f.data),cliente=F.cliente(f.db);
 const original=JSON.stringify(cliente.db);
 const r=await w.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta,w.HAIKU_LIBRO_RESERVA_V1,cliente);
 const [i]=r.comparacion;
 assert.equal(i.estado,'ambigua');assert.equal(i.categoria,'posible_cambio_cabana');
 assert.equal(i.sistema,undefined);assert.equal(i.candidatosDetalle.length,1);
 assert.match(i.pregunta,/de CAB 2 a CAB 1/);
 assert.match(i.pregunta,/requiere confirmación y comprobar disponibilidad/);
 const m=w.HAIKU_LIBRO_CONSULTAS.modeloPresentacionComparacion(r);
 assert.equal(m.cambiosCabana.length,1);assert.equal(m.faltantes.length,0);
 w.document.createElement=t=>new Element(t);w.document.getElementById=()=>null;
 w.Option=function(text,value){const o=new Element('option');o.textContent=text;o.value=value;return o;};
 vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8').replace(
  'const apiConsultas = Object.freeze({ interpretar,','const apiConsultas = Object.freeze({ renderizarComparacion, interpretar,'),w);
 const out=new Element('div');w.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out,r);
 assert.match(out.textContent,/Cambios de cabaña por revisar/);
 assert.match(out.textContent,/Cambio por resolver: Proyecto H CAB 2 → Libro CAB 1/);
 assert.match(out.textContent,/Si es un traslado, elige/);
 assert.match(out.textContent,/Es la misma estadía: corregir CAB\/fechas y datos con el Libro/);
 assert.equal(JSON.stringify(cliente.db),original);assert.deepEqual(cliente.mutaciones,[]);
});
