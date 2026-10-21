const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../js/haiku-libro-semantica-v1.js');
const C=require('../js/haiku-libro-pagos-canon-v1.js');
const L=require('../js/haiku-libro-lenguaje-natural-v1.js').crearSemantica(S,C);
const {entorno}=require('./fixtures/libro-medio-pago-manual.cjs');

const superior='Ioana Katenka // webpay confirmado // cod. aut. 007954 // DÉBITO // GO';
function leer(notas,extraSuperior={}) {
 const celdas=[
  {r:1,c:2,valor:'20 oct',fechaISO:'2026-10-20'},
  {r:1,c:6,valor:'21 oct',fechaISO:'2026-10-21'},
  {r:2,c:0,valor:'cabaña 1'},
  {r:2,c:2,valor:'Ioana Katenka // 1 noche // 2 ADL'},
  {r:24,c:2,valor:'Pagos de arriendos de hoy'},
  {r:25,c:0,valor:'cabaña 1'},
  {r:26,c:2,valor:'19-10-2026',fechaISO:'2026-10-19'},
  {r:26,c:3,valor:superior},
  {r:26,c:4,valor:'cab1/1noche'},
  {r:26,c:5,valor:'160000',valorNumero:160000},
  ...notas.map((texto,i)=>({r:27+i,c:3,valor:texto}))
 ];
 const bruto=S.normalizarHoja({celdas,combinaciones:[
  {s:{r:2,c:2},e:{r:2,c:4}},
  {s:{r:25,c:0},e:{r:27+notas.length,c:0}}
 ],estilos:[]},'Oct26');
 const pago=bruto.pagos.find(p=>p.codigo_autorizacion==='007954');
 Object.assign(pago,extraSuperior);
 return {bruto,resultado:L.corregirResultado(C.corregirResultado(bruto))};
}

test('Ioana: factura y pendiente administrativo se conservan como notas asociadas, sin otro pago',()=>{
 const notas=['PEND BOVE Y MANAGEER','factura info en correo'];
 const {bruto,resultado:r}=leer(notas);
 assert.equal(r.pagos.length,1);
 const p=r.pagos[0];
 assert.equal(p.clasificacion_financiera,'pago_real');
 assert.equal(p.codigo_autorizacion,'007954');
 assert.equal(p.medio_pago,'webpay_debito');
 assert.equal(p.monto,160000);assert.equal(p.fecha_comprobante,'2026-10-19');
 assert.equal(p.texto_original.includes(superior),true);
 assert.equal(r.reservas[0].pagos.length,1);
 assert.equal(r.reservas[0].pagos_sin_asociacion.length,0);
 for(const texto of notas) {
  const nota=r.anotaciones.find(n=>n.texto_original===texto);
  assert.ok(nota);assert.equal(nota.reserva_id,r.reservas[0].id);
  assert.equal(nota.titular,'Ioana Katenka');assert.equal(nota.cabana,1);
  assert.ok(nota.origen.celda);assert.equal(nota.monto_referencial,null);
  assert.equal(nota.advertencias,undefined);
  const original=bruto.pagos.find(x=>x.texto_original===texto);
  assert.equal(original.monto,null);assert.equal(original.fecha_comprobante,null);
  assert.equal(original.medio_pago,null);assert.equal(original.codigo_autorizacion,null);
  assert.equal(original.evidencia_financiera.columnas_ocupadas.monto,false);
 }
 assert.deepEqual(r.evidencias_bove,bruto.evidencias_bove);
});

for(const texto of [
 'factura info en correo','FACTURA: datos enviados por correo',
 'Revisar correo para factura','BOVE en correo','PEND BOVE Y MANAGER',
 'Información de pagos en correo','correo con detalle de pagos Webpay',
 'Enviar boleta y comprobante por correo','factura 12345 en correo'
]) test('nota sin evidencia propia: '+texto,()=>{
 const {resultado:r}=leer([texto]);
 assert.equal(r.pagos.length,1);
 assert.equal(r.reservas[0].pagos_sin_asociacion.length,0);
 const nota=r.anotaciones.find(n=>n.texto_original===texto);
 assert.ok(nota);assert.equal(nota.reserva_id,r.reservas[0].id);
 assert.equal(nota.clasificacion_financiera,'nota_financiera');
});

for(const [campo,valor] of [['monto',null],['fecha_comprobante',null],['medio_pago',null]])
 test('el pago superior conserva revisión si falta '+campo,async()=>{
  const cambios={[campo]:valor};
  // Quitar también la glosa del medio cuando se prueba su ausencia real.
  if(campo==='medio_pago')cambios.texto_original='Ioana Katenka // cod. aut. 007954 // GO';
  const {resultado:r}=leer(['factura info en correo'],cambios);
  assert.equal(r.pagos.length,1);assert.notEqual(r.pagos[0].clasificacion_financiera,'nota_financiera');
  assert.equal(r.pagos[0].codigo_autorizacion,'007954');
  assert.ok(r.anotaciones.some(n=>n.texto_original==='factura info en correo'));
  const h=entorno();
  Object.assign(h.r.pagos[0],{medio_pago:'webpay_debito',codigo_autorizacion:'007954',texto_original:superior},cambios);
  const item=h.item(await h.preparar());
  assert.ok(item);assert.equal(item.categoria,'dudosos');assert.equal(item.seleccionado,false);
  const faltante={monto:/monto/i,fecha_comprobante:/fecha/i,medio_pago:/medio/i}[campo];
  assert.ok(item.motivos.some(m=>faltante.test(m)));
  assert.equal(h.llamadas.filter(x=>x.nombre&&!x.nombre.includes('capacidad')).length,0);
 });

for(const [texto,campos] of [
 ['Pago recibido, falta monto y fecha',{monto:null,fecha_comprobante:null,medio_pago:null,codigo_autorizacion:null}],
 ['Abono de $15.000, fecha por confirmar',{monto:null,fecha_comprobante:null,medio_pago:null,codigo_autorizacion:null}],
 ['Webpay confirmado // PEND BOVE Y MANAGER',{monto:null,fecha_comprobante:null,medio_pago:'webpay',codigo_autorizacion:null}],
 ['cod. aut. 007954 // factura en correo',{monto:null,fecha_comprobante:null,medio_pago:null,codigo_autorizacion:'007954'}],
 ['abono por revisar',{monto:15000,fecha_comprobante:null,medio_pago:null,codigo_autorizacion:null}]
]) test('evidencia de pago incompleto permanece en revisión: '+texto,()=>{
 const {bruto}=leer([]);
 const p={...bruto.pagos[0],...campos,texto_original:texto};
 const r=L.corregirResultado({...bruto,pagos:[p],reservas:[{...bruto.reservas[0],pagos:[p]}]});
 assert.equal(r.pagos.length,1);assert.equal(r.pagos[0].clasificacion_financiera,'dudoso');
});
