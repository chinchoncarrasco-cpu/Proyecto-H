const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
const manual=fs.readFileSync(require.resolve('../js/supabase-ajustes-cargo-manual-v1.js'),'utf8');
const a=source.indexOf('    function conciliarPenalidadActiva(item, resumen) {');
const b=source.indexOf('    async function prepararIncorporacion(',a);
assert.ok(a>=0&&b>a);
const f=new Function('money',source.slice(a,b)+'\nreturn {conciliarPenalidadActiva,conciliarPenalidadesEnPlan};')(n=>'$'+n.toLocaleString('es-CL'));
const reservaId='11111111-1111-4111-8111-111111111111';
const resumen={reserva_id:reservaId,ajustes:[{estado:'activo',tipo_ajuste:'cargo_modificacion',monto:16000,porcentaje:10,signo:1,operacion_id:'op1'}]};
const item=()=>({categoria:'dudosos',penalidadManual:{reservaId,montoLibro:16000},pagoLibro:{tipo_movimiento:'penalidad',pago_recibido:null},seleccionado:false,aprobable:false,motivos:['pendiente'],payload:null});

test('penalidad activa pasa a registrada, sin crear ni confirmar abono',()=>{
 const x=item();assert.equal(f.conciliarPenalidadActiva(x,resumen),true);
 assert.equal(x.categoria,'omitidos');assert.equal(x.penalidadManual,null);
 assert.equal(x.penalidadRegistrada.monto,16000);
 assert.equal(x.pagoLibro.pago_recibido,null);assert.equal(x.payload,null);
 assert.match(x.aviso,/no se añadirá otra vez ni se marcará como pago recibido/);
});

test('sin ajuste registrado se conserva la revisión pendiente',()=>{
 const x=item();assert.equal(f.conciliarPenalidadActiva(x,{...resumen,ajustes:[]}),false);
 assert.equal(x.categoria,'dudosos');assert.ok(x.penalidadManual);
});

test('ajuste anulado se distingue del activo',()=>{
 const x=item();assert.equal(f.conciliarPenalidadActiva(x,{...resumen,ajustes:[{...resumen.ajustes[0],estado:'anulado'}]}),false);
 assert.equal(x.categoria,'dudosos');
});

test('importe diferente y duplicidad del 10% bloquean registrar otro cargo',()=>{
 for(const ajustes of [
  [{...resumen.ajustes[0],monto:18000}],
  [resumen.ajustes[0],{...resumen.ajustes[0],operacion_id:'op2'}]
 ]) {
  const x=item();assert.equal(f.conciliarPenalidadActiva(x,{...resumen,ajustes}),false);
  assert.equal(x.penalidadManual,null);assert.match(x.motivos[0],/otro ajuste de penalidad activo/);
 }
});

test('no concilia otra reserva ni porcentaje distinto',()=>{
 for(const doc of [
  {...resumen,reserva_id:'otra'},
  {...resumen,ajustes:[{...resumen.ajustes[0],porcentaje:15}]}
 ]) {
  const x=item();assert.equal(f.conciliarPenalidadActiva(x,doc),false);
  assert.notEqual(x.categoria,'omitidos');
 }
});

test('consulta el RPC existente sólo con penalidades y agrupa por reserva',async()=>{
 let llamadas=0;
 const cliente={async rpc(nombre,args){
  llamadas++;assert.equal(nombre,'haiku_resumen_ajustes_unidad');
  assert.equal(args.p_reserva_id,reservaId);return {data:resumen};
 }};
 await f.conciliarPenalidadesEnPlan({items:[{categoria:'pagos'}]},cliente);assert.equal(llamadas,0);
 const primero=item(),segundo=item();
 await f.conciliarPenalidadesEnPlan({items:[primero,segundo]},cliente);
 assert.equal(llamadas,1);assert.equal(primero.categoria,'omitidos');assert.equal(segundo.categoria,'omitidos');
});

test('error de consulta no inventa la confirmación ni registra pago',async()=>{
 const x=item();await f.conciliarPenalidadesEnPlan({items:[x]},{async rpc(){throw Error('sin red')}});
 assert.equal(x.categoria,'dudosos');assert.ok(x.penalidadManual);
 assert.doesNotMatch(source.slice(a,b),/haiku_registrar_pago|haiku_aplicar_ajuste|haiku_incorporar_libro_v1/);
});

test('evento sólo se emite tras éxito del RPC con contexto Libro',()=>{
 const i=manual.indexOf('// Sólo tras confirmar Supabase: revalidar la tarjeta del Libro.');
 const j=manual.indexOf('            await Promise.allSettled([',i);
 assert.ok(i>=0&&j>i);
 const sourceEvent=manual.slice(i,j);
 const eventos=[];
 const FakeEvent=function(tipo,opciones){this.type=tipo;this.detail=opciones.detail};
 const ejecutar=dataset=>{
  const ventana={CustomEvent:FakeEvent,dispatchEvent:evento=>eventos.push(evento)};
  const capa={dataset},reserva={value:reservaId},datos={monto_ajuste:16000},monto=16000;
  new Function('window','overlay','reserva','data','monto',sourceEvent)(ventana,capa,reserva,datos,monto);
 };
 ejecutar({});assert.equal(eventos.length,0);
 ejecutar({haikuLibroMonto:'16000'});
 assert.equal(eventos.length,1);
 assert.equal(eventos[0].type,'haiku:libro-penalidad-registrada');
 assert.deepEqual(eventos[0].detail,{reservaId,monto:16000});
});

test('ambas vistas revalidan sin volver a aprobar pagos',()=>{
 assert.equal((source.match(/aprobar\.refrescarTrasPenalidad = async/g)||[]).length,2);
 assert.match(source,/restaurarVistaAprobaciones\(out,vista\)/);
 assert.match(source,/haiku:libro-penalidad-registrada/);
 assert.match(source,/Penalidad registrada/);
});