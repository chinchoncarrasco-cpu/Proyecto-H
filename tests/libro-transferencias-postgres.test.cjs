// Writer real reconstruido localmente; nunca conecta a Supabase.
const test=require('node:test'),assert=require('node:assert/strict');
const {preparar,read}=require('./fixtures/rut-identidad-sql.cjs');
const F=require('./fixtures/libro-transferencias-bancarias.cjs');
global.HAIKU_LIBRO_SEMANTICA=F.S;
const Q=require('../js/haiku-libro-consultas-v1.js');
const script='supabase/candidates/libro-transferencias/01-writer.sql';
async function entorno({rut=false,instalar=true}={}) {
 const h=await preparar();
 try {
  await h.db.exec("update reserva_estadias set fecha_ingreso='2026-10-30',fecha_salida='2026-10-31'");
  if(rut) await h.db.exec(read('supabase/candidates/libro-rut-formato/01-incorporacion.sql'));
  // Dependencia vigente del writer capturado; se instala sólo en PostgreSQL efímero.
  await h.db.exec(read('supabase/migrations/20261007181953_libro_medio_pago_manual_auditoria.sql')
   .match(/create function private\.haiku_libro_medio_pago_manual_validar_v1[\s\S]*?\$function\$;/)[0]);
  if(instalar) await h.db.exec(read(script));
  h.pago=async(op='901',extra={})=>{
   const glosa=F.glosa+(op?' // Operacion '+op:'');
   const libro=F.leer([{cabana:1,pagos:[{glosa}]}]),db=F.cliente(libro.reservas);
   const c=await Q.compararSistema(libro.reservas,db,{desde:'2026-10-01',hasta:'2026-10-31'});
   const plan=await Q.prepararIncorporacion({reservas:libro.reservas,q:{},comparacion:c},new Map(),new Set(),db);
   const item=Q.serializarIncorporacion(plan).find(i=>i.tipo==='pago');
   assert.ok(item);item.reserva_id=h.ids.reserva;item.argumentos.p_reserva_id=h.ids.reserva;
   return {...item,confirmacion_final:true,...extra};
  };
  return h;
 } catch(e){await h.db.close();throw e;}
}
for(const rut of [false,true]) test('candidata conserva históricos y permisos; persiste pagador y dos operaciones sin aprobación intermedia, RUT='+rut,async()=>{
 const h=await entorno({rut,instalar:false});
 try {
  const antes=await h.snapshot(),permisos=await h.db.query("select proowner,proacl,prosecdef,proconfig from pg_proc where oid='haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure");
  await h.db.exec(read(script));assert.deepEqual(await h.snapshot(),antes);
  assert.deepEqual(await h.db.query("select proowner,proacl,prosecdef,proconfig from pg_proc where oid='haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure"),permisos);
  const a=await h.pago('901'),b=await h.pago('902');
  assert.equal(a.aprobado_manualmente,false);
  await h.lote([a,b]);
  const pagos=(await h.db.query('select * from pagos order by creado_en,id')).rows;
  assert.equal(pagos.length,2);assert.ok(pagos.every(p=>p.pagador_nombre==='ALMONACID ERICES EXEQUIEL IGNACIO'));
  assert.deepEqual(new Set(pagos.map(p=>p.datos_origen.evidencia_transferencia.operacion_bancaria)),new Set(['901','902']));
  assert.ok(pagos.every(p=>p.datos_origen.confirmacion_final===true&&p.datos_origen.aprobado_manualmente===false));
  assert.equal((await h.db.query('select titular_nombre from reservas where id=$1',[h.ids.reserva])).rows[0].titular_nombre,'Persona Ficticia A');
  a.item_id='fila-movida';a.datos_origen.origen.celda='Z99:AC99';
  await h.lote([a]);assert.equal((await h.db.query('select count(*)::int n from pagos')).rows[0].n,2);
 } finally{await h.db.close();}
});
test('writer exige confirmación final y rechaza candidatos indistinguibles o contradictorios atómicamente',async()=>{
 const h=await entorno();
 try {
  await assert.rejects(h.lote([await h.pago('901',{confirmacion_final:false})]),/identificador fuerte|confirmación|confirmacion/i);
  const a=await h.pago(null),b=await h.pago(null);b.item_id='otra-fila';
  for(const sufijo of [' // Operacion pendiente',' // Operacion 901 // Operacion 902']) {
   const incompleto=await h.pago(null);incompleto.argumentos.p_referencia_externa+=sufijo;
   await assert.rejects(h.lote([incompleto]),/incompleta|contradictoria/);
  }
  await assert.rejects(h.lote([a,b]),/duplicada/);
  assert.equal((await h.db.query('select count(*)::int n from pagos')).rows[0].n,0);
  await h.lote([await h.pago('901')]);
  await assert.rejects(h.lote([await h.pago(null)]),/duplicada/);
  const cambio=await h.pago('901');cambio.argumentos.p_monto=70000;cambio.datos_origen.monto=70000;
  await assert.rejects(h.lote([cambio]),/contradictoria/);
  assert.equal((await h.db.query('select count(*)::int n from pagos')).rows[0].n,1);
 } finally{await h.db.close();}
});
test('writer sin candidata rechaza la selección sin aprobación; candidata se detiene ante writer desconocido',async()=>{
 const h=await entorno({instalar:false});
 try {
  await assert.rejects(h.lote([await h.pago()]),/identificador fuerte/);
  const def=(await h.db.query("select pg_get_functiondef('haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure) d")).rows[0].d;
  await h.db.exec(def.replace('\ndeclare','\n-- cambio ajeno\ndeclare'));
  await assert.rejects(h.db.exec(read(script)),/Writer distinto/);await h.db.exec('rollback');
 } finally{await h.db.close();}
});
test('la candidata conserva las guardias de efectivo y tarjetas y no acepta confirmación sin evidencia v2',async()=>{
 const h=await entorno();
 try {
  const incompleto=await h.pago();delete incompleto.datos_origen.evidencia_transferencia;
  await assert.rejects(h.lote([incompleto]),/identificador fuerte/);
  for(const medio of ['efectivo','webpay_credito']) {
   const item=await h.pago();delete item.datos_origen.evidencia_transferencia;
   item.argumentos.p_medio_pago=medio;item.item_id=medio;
   await assert.rejects(h.lote([item]),/identificador fuerte/);
   if(medio==='efectivo') item.aprobado_manualmente=true;
   else item.argumentos.p_codigo_autorizacion='TARJETA-SINTETICA-901';
   await h.lote([item]);
  }
  assert.equal((await h.db.query('select count(*)::int n from pagos')).rows[0].n,2);
 } finally{await h.db.close();}
});
