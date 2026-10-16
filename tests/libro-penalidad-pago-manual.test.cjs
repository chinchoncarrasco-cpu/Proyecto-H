const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const S=require('../js/haiku-libro-semantica-v1.js');
const source=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
const a=source.indexOf('    function conciliarPenalidadActiva(item, resumen, contexto = {}) {');
const b=source.indexOf('    async function prepararIncorporacion(',a);
assert.ok(a>=0&&b>a);
const f=new Function('money','medioLibro','medioSistema','pagoTieneIdentificadorFuerte',
 'datosOrigenPago','idMovimientoIncorporacion',
 source.slice(a,b)+'\nreturn {conciliarPenalidadActiva,conciliarPenalidadesEnPlan};')(
 n=>'$'+n.toLocaleString('es-CL'),p=>p?.medio_pago,p=>p?.medio_pago,
 p=>Boolean(p?.codigo_autorizacion||p?.folio&&p?.bovtar),
 (p,d,e)=>({...e,fecha_bloque:p.fecha_bloque,origen:p.origen,monto:p.monto,medio:p.medio_pago}),x=>x.id);
const id='11111111-1111-4111-8111-111111111111';
const adj={reserva_id:id,ajustes:[{operacion_id:'op-1',tipo_ajuste:'cargo_modificacion',
 estado:'activo',signo:1,monto:16000,porcentaje:10}]};
const cargos=[
 {reserva_id:id,tipo_cargo:'alojamiento',estado:'activo',saldo_cargo:16000,monto_ajustado:176000},
 {reserva_id:id,tipo_cargo:'servicio',estado:'activo',saldo_cargo:30000,monto_ajustado:30000}
];
const original=[{reserva_id:id,monto:160000,estado:'confirmado',tipo_movimiento:'pago',
 medio_pago:'transferencia',fecha_pago:'2026-10-07'}];
function filaLibro(){
 const celdas=[
  {r:1,c:2,valor:'16 oct',fechaISO:'2026-10-16'},
  {r:1,c:6,valor:'17 oct',fechaISO:'2026-10-17'},
  {r:2,c:0,valor:'cabaña 1'},
  {r:2,c:2,valor:'Ana Ejemplo // 1 noche // 2 ADL'},
  {r:24,c:2,valor:'Pagos de arriendos de hoy'},
  {r:25,c:0,valor:'cabaña 1'},
  {r:26,c:2,valor:'07-10-2026',fechaISO:'2026-10-07'},
  {r:26,c:3,valor:'Ana Ejemplo // 0157383000 Transf. Ana Maria Ejemplo // CO // PEND BOVE Y MANAGER // penalidad // 16000'},
  {r:26,c:4,valor:'penalidad'},
  {r:26,c:5,valor:'$16.000',valorNumero:16000}
 ];
 const parsed=S.normalizarHoja({celdas,combinaciones:[
  {s:{r:2,c:2},e:{r:2,c:4}},{s:{r:25,c:0},e:{r:29,c:0}}
 ],estilos:[]},'Oct26');
 return {reserva:parsed.reservas[0],pago:parsed.pagos[0]};
}
const {pago}=filaLibro();
const nueva=()=>({id:'pago:ana-c28',categoria:'dudosos',aprobable:false,
 penalidadManual:{reservaId:id,montoLibro:16000},pagoLibro:{...pago},motivos:['pendiente']});
const contexto=()=>({cargos,pagos:original,aprobados:new Set(),fechaIngreso:'2026-10-16'});

test('Libro reconoce los 16.000 como transferencia separada del abono 160.000',()=>{
 assert.equal(pago.tipo_movimiento,'penalidad');
 assert.equal(pago.medio_pago,'transferencia');
 assert.equal(pago.fecha_comprobante,'2026-10-07');
 assert.equal(pago.monto,16000);assert.equal(pago.pago_recibido,null);
 assert.equal(pago.estado_pago,'registrado_en_libro');
 assert.ok(pago.origen?.hoja&&pago.origen?.celda);
});
test('el cargo existe y habilita Aprobar este pago, pero no escribe',()=>{
 const i=nueva();assert.equal(f.conciliarPenalidadActiva(i,adj,contexto()),true);
 assert.equal(i.categoria,'dudosos');assert.equal(i.aprobable,true);
 assert.equal(i.payload,null);assert.equal(i.penalidadPagoPendiente,true);
 assert.equal(i.penalidadManual,null);
});
test('la aprobación prepara pago CLP de 16.000 fechado 07/10 para alojamiento',()=>{
 const i=nueva(),ctx=contexto();ctx.aprobados.add(i.id);
 assert.equal(f.conciliarPenalidadActiva(i,adj,ctx),true);
 assert.equal(i.categoria,'pagos');assert.equal(i.seleccionado,true);
 assert.deepEqual(i.motivos,[]);
 assert.equal(i.payload.aprobado_manualmente,true);
 const args=i.payload.argumentos;
 assert.equal(args.p_reserva_id,id);assert.equal(args.p_monto,16000);
 assert.equal(args.p_medio_pago,'transferencia');assert.equal(args.p_fecha_pago,'2026-10-07');
 assert.equal(args.p_modo_aplicacion,'alojamiento');
 assert.deepEqual(args.p_aplicaciones,[]);assert.equal(args.p_bove,null);
 assert.equal(i.payload.datos_origen.item_id,i.id);
});
test('el abono original de 160.000 no se considera duplicado',()=>{
 const i=nueva();f.conciliarPenalidadActiva(i,adj,contexto());
 assert.equal(i.aprobable,true);
});
test('mismo origen y pago 16.000 confirmado quedan omitidos',()=>{
 const i=nueva(),ctx=contexto();
 ctx.pagos=[...original,{reserva_id:id,estado:'confirmado',tipo_movimiento:'pago',
 monto:16000,datos_origen:{item_id:i.id}}];
 f.conciliarPenalidadActiva(i,adj,ctx);assert.equal(i.categoria,'omitidos');
 assert.equal(i.aprobable,false);assert.match(i.aviso,/ya registrados/);
});
test('pago semejante sin origen bloquea posible duplicado',()=>{
 const i=nueva(),ctx=contexto();
 ctx.pagos=[...original,{reserva_id:id,estado:'confirmado',tipo_movimiento:'pago',
 monto:16000,medio_pago:'transferencia',fecha_pago:'2026-10-07'}];
 f.conciliarPenalidadActiva(i,adj,ctx);
 assert.equal(i.categoria,'dudosos');assert.equal(i.aprobable,false);
});
test('saldo cero del alojamiento bloquea, aunque la tinaja tenga 30.000 pendientes',()=>{
 const i=nueva(),ctx=contexto();
 ctx.cargos=cargos.map(c=>c.tipo_cargo==='alojamiento'?{...c,saldo_cargo:0}:c);
 f.conciliarPenalidadActiva(i,adj,ctx);
 assert.equal(i.aprobable,false);assert.equal(i.payload,null);
});
test('penalidad no instalada o anulada no activa aprobación',()=>{
 for(const ajustes of [[],[{...adj.ajustes[0],estado:'anulado'}]]) {
  const i=nueva();f.conciliarPenalidadActiva(i,{...adj,ajustes},contexto());
  assert.equal(i.aprobable,false);assert.equal(i.penalidadPagoPendiente,undefined);
 }
});
test('monto o fecha distintos no habilitan transferencia',()=>{
 for(const cambios of [{monto:15000},{fecha_comprobante:null},{moneda:'USD'},
  {medio_pago:null},{codigo_autorizacion:'XYZ'}]) {
  const i=nueva();Object.assign(i.pagoLibro,cambios);
  f.conciliarPenalidadActiva(i,adj,contexto());
  assert.equal(i.aprobable,false);
 }
});
test('relee sólo los cargos de la reserva y guarda no escribe',async()=>{
 const i=nueva(),calls=[];
 const cliente={async rpc(nombre,args){calls.push(nombre);
  return{data:adj}},from(tabla){calls.push(tabla);
  const b={select(){return b},async eq(){return{data:cargos}}};return b;}};
 const comp={snapshot:{pagos_todos:original},pagosDetalle:[{id:i.id,reserva:{fecha_checkin:'2026-10-16'}}]};
 await f.conciliarPenalidadesEnPlan({items:[i]},cliente,comp,new Set());
 assert.equal(i.aprobable,true);
 assert.deepEqual(calls,['haiku_resumen_ajustes_unidad','vista_estado_cargos']);
});
test('consulta sin acceso a saldo no inventa pago autorizado',async()=>{
 const i=nueva();
 await f.conciliarPenalidadesEnPlan({items:[i]},{
  async rpc(){return{data:adj}},from(){throw Error('sin red')}
 },{snapshot:{pagos_todos:original}},new Set());
 assert.equal(i.categoria,'omitidos');assert.equal(i.aprobable,false);
});
test('pantalla mantiene confirmación separada y serializer de pagos existente',()=>{
 assert.match(source,/Aprobar este pago/);
 assert.match(source,/aprobar\.refrescarTrasPenalidad = async/);
 assert.match(source,/p_modo_aplicacion:'alojamiento'/);
 assert.match(source,/aprobado_manualmente:true/);
 assert.match(source,/Confirma la incorporación para registrar el abono/);
});
