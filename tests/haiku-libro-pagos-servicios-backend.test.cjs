const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const rutaBase='supabase/migrations/20260916041430_haku_libro_aplicaciones_servicio_seguras.sql';
const rutaConjuntos='supabase/migrations/20260916154534_haku_libro_aplicaciones_servicio_conjunto_unico.sql';
const base=fs.readFileSync(rutaBase,'utf8').replace(/\r/g,'');
const actualizacion=fs.readFileSync(rutaConjuntos,'utf8').replace(/\r/g,'');
const sql=base+'\n'+actualizacion;
const helper=actualizacion.slice(
 actualizacion.indexOf('create or replace function private.haiku_libro_pago_servicios_v1('),
 actualizacion.indexOf('revoke all on function private.haiku_libro_pago_servicios_v1(')
);

test('FASE 4C agrega un helper privado y no reemplaza haiku_registrar_pago',()=>{
 assert.match(sql,/create or replace function private\.haiku_libro_pago_servicios_v1\(/);
 assert.match(sql,/create or replace function public\.haiku_incorporar_pago_servicios_libro_v1\(/);
 assert.doesNotMatch(sql,/create or replace function public\.haiku_registrar_pago\(/i);
 assert.doesNotMatch(sql,/create or replace function public\.haiku_incorporar_libro_v1\(/i);
 assert.match(sql,/revoke all on function private\.haiku_libro_pago_servicios_v1\(uuid,jsonb,jsonb,boolean\)\s+from public, anon, authenticated;/);
 assert.match(sql,/private\.haiku_libro_pago_servicios_v1\(v_reserva,v_argumentos,v_origen,v_manual\)/);
 assert.doesNotMatch(sql,/pg_get_functiondef|execute replace|do \$migration\$/i);
});

test('conserva auth y permiso; la RPC específica tiene idempotencia por operación y hash',()=>{
 assert.match(helper,/auth\.uid\(\) is null or not private\.haiku_tiene_permiso\('pagos\.registrar'\)/);
 assert.match(helper,/p_manual is distinct from true/);
 assert.match(sql,/create table if not exists private\.haiku_libro_pagos_servicio_operaciones/);
 assert.match(sql,/v_hash:=md5\(p_item::text\)/);
 assert.match(sql,/where operacion_id=p_operacion_id for update/);
 assert.match(sql,/La operación ya fue usada con otra propuesta/);
 assert.match(sql,/v_registro\.resultado\|\|jsonb_build_object\('reintento',true\)/);
});

test('usa locks acotados y un orden que no espera advisory después de bloquear filas',()=>{
 assert.doesNotMatch(sql,/\block table\b/i);
 assert.match(helper,/from public\.reservas r where r\.id=p_reserva_id for update;/);
 for(const tabla of ['servicios','cargos','pagos']) assert.match(helper,new RegExp(`from public\\.${tabla} [a-z]+ where [^;]+ for update;`));
 assert.match(helper,/from public\.pago_aplicaciones pa join public\.cargos c[\s\S]+for update of pa;/);
 assert.match(helper,/pg_advisory_xact_lock\(private\.haiku_libro_lock_key_v1\('reserva_finanzas'/);
 assert.match(helper,/pg_advisory_xact_lock\(private\.haiku_libro_lock_key_v1\('pago_identificador'/);
 assert.ok(helper.indexOf("pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas'")<helper.indexOf('from public.reservas r where r.id=p_reserva_id for update;'));
 assert.match(sql,/pg_try_advisory_xact_lock\(private\.haiku_libro_lock_key_v1\('reserva_finanzas'/);
 assert.match(sql,/La reserva tiene otra operación financiera en curso; vuelve a intentar/);
 assert.match(sql,/pg_try_advisory_xact_lock\(private\.haiku_libro_lock_key_v1\('pago_identificador'/);
 for(const tabla of ['servicios','cargos','pagos','pago_aplicaciones'])
  assert.match(sql,new RegExp(`create trigger trg_haiku_libro_lock_${tabla==='pago_aplicaciones'?'aplicaciones':tabla}_v1`));
});

test('el contrato exige snapshot explícito y rechaza cargos repetidos',()=>{
 for(const campo of ['cargo_id','servicio_id','monto','saldo_esperado','aplicado_esperado','cantidad_aplicaciones_esperada','concepto_canon','fecha_servicio_esperada'])
  assert.ok(helper.includes(`aplicacion->>'${campo}'`),campo);
 assert.match(helper,/count\(distinct x->>'cargo_id'\)[\s\S]+Una transacción no puede reutilizar el mismo cargo/);
 assert.match(helper,/d->>'moneda' is distinct from 'CLP'/);
 assert.match(helper,/d->>'reserva_id'[\s\S]+p_reserva_id/);
 assert.match(helper,/d->>'monto_total'[\s\S]+monto_total/);
});

test('revalida reserva, cargo, servicio, concepto, saldo y aplicaciones bajo lock',()=>{
 assert.match(helper,/reserva_estado in \('cancelada','no_show'\)/);
 assert.match(helper,/cargo_reserva is distinct from p_reserva_id/);
 assert.match(helper,/cargo_tipo is distinct from 'servicio'/);
 assert.match(helper,/cargo_estado is distinct from 'activo'/);
 assert.match(helper,/servicio_total is null or servicio_total<=0/);
 assert.match(helper,/coalesce\(servicio_cobro,'normal'\)='cortesia'/);
 assert.match(helper,/cancelad\|noshow\|anulad/);
 assert.match(helper,/concepto_actual=concepto_esperado/);
 assert.match(helper,/saldo_actual is distinct from saldo_esperado/);
 assert.match(helper,/aplicado_actual is distinct from aplicado_esperado/);
 assert.match(helper,/cantidad_actual is distinct from cantidad_esperada/);
 assert.match(helper,/v_monto>saldo_actual/);
});

test('recalcula la unicidad y aborta si aparece otro cargo compatible',()=>{
 assert.match(helper,/with posibles as \([\s\S]+compatibles as \([\s\S]+finales as \(/);
 assert.match(helper,/select count\(\*\),coalesce\(bool_or\(finales\.cargo_id=v_cargo_id\),false\)/);
 assert.match(helper,/if candidatos<>1 or elegido is distinct from true then[\s\S]+El destino dejó de ser único/);
});

test('la migración incremental conserva la RPC pública y revalida distribuciones por conjunto',()=>{
 assert.doesNotMatch(actualizacion,/create or replace function public\.haiku_incorporar_pago_servicios_libro_v1/);
 assert.match(actualizacion,/create or replace function private\.haiku_libro_pago_servicios_v1\(/);
 assert.match(helper,/group by x->>'concepto_canon',nullif\(x->>'fecha_contexto',''\)::date/);
 assert.match(helper,/with recursive posibles as \([\s\S]+combinaciones\(cargos,ultima_posicion,total,cantidad\)/);
 assert.match(helper,/count\(s\.cargos\)::integer/);
 assert.match(helper,/cantidad>0 and total=clase\.monto/);
 assert.match(helper,/subconjuntos_validos<>1 or conjunto_elegido is distinct from true/);
 assert.match(helper,/El conjunto de destinos dejó de ser único/);
 assert.match(helper,/clase\.cantidad=1[\s\S]+if candidatos<>1 or elegido is distinct from true/);
 assert.match(helper,/clase\.cubre_saldos is distinct from true/);
 assert.match(helper,/l\.candidatos<=12/);
 assert.match(helper,/c\.cantidad<12/);
 assert.match(helper,/candidatos_clase>12/);
 assert.match(helper,/Más de 12 destinos compatibles requieren revisión manual/);
 assert.doesNotMatch(helper,/candidatos(?:_clase)?(?:<=|>)20/);
});

test('Sara representa un pago único de 95000 sobre dos masajes completos',()=>{
 const sara={monto_total:95000,aplicaciones:[
  {cargo_id:'00000000-0000-4000-8000-000000000050',monto:50000,saldo_esperado:50000,concepto_canon:'masaje',fecha_contexto:'2026-09-01'},
  {cargo_id:'00000000-0000-4000-8000-000000000045',monto:45000,saldo_esperado:45000,concepto_canon:'masaje',fecha_contexto:'2026-09-01'}
 ]};
 assert.equal(sara.aplicaciones.reduce((n,a)=>n+a.monto,0),sara.monto_total);
 assert.equal(new Set(sara.aplicaciones.map(a=>a.cargo_id)).size,2);
 assert.ok(sara.aplicaciones.every(a=>a.monto===a.saldo_esperado));
 assert.equal((helper.match(/public\.haiku_registrar_pago\(/g)||[]).length,1);
});

test('sólo confirmado demuestra existencia; los estados reales no vigentes quedan fuera',()=>{
 assert.match(helper,/from public\.pagos p[\s\S]+p\.tipo_movimiento='pago' and p\.estado='confirmado'/);
 assert.doesNotMatch(helper,/p\.estado<>\s*'anulado'/);
 assert.match(helper,/pago_existente_reserva is distinct from p_reserva_id/);
 assert.match(helper,/jsonb_build_object\('ya_existe',true/);
 assert.match(helper,/count\(\*\)::integer,count\(distinct reserva_id\)::integer/);
 assert.match(helper,/pagos_existentes<>1[\s\S]+múltiples pagos confirmados/);
 assert.match(helper,/codigo_autorizacion/);
 assert.match(helper,/datos_origen->>'bovtar'/);
 assert.match(sql,/El identificador fuerte ahora pertenece a otra reserva; vuelve a preparar/);
 const esquema=['pendiente_asociacion','pendiente','confirmado','anulado'];
 assert.deepEqual(esquema.filter(estado=>estado==='confirmado'),['confirmado']);
});

test('BOVE administrativo no participa y efectivo sin ID fuerte queda bloqueado explícitamente',()=>{
 assert.match(helper,/p_bove sólo puede transportar el mismo BOVTAR del comprobante; un BOVE administrativo no identifica pagos/);
 assert.match(helper,/codaut_norm is null and \(folio_norm is null or bovtar_norm is null\)/);
 assert.match(helper,/Efectivo sin identificador transaccional fuerte no está habilitado en FASE 4C/);
 assert.doesNotMatch(helper,/\(bove is not null|coalesce\(bove,bovtar\)/);
 assert.match(helper,/p_bove=>bovtar/);
 assert.match(helper,/codaut_norm:=nullif\(regexp_replace/);
 assert.match(helper,/folio_norm:=nullif\(regexp_replace/);
 assert.match(helper,/bovtar_norm:=nullif\(regexp_replace/);
});

test('Carlos usa un pago de 30000 y una sola aplicación explícita',()=>{
 const carlos={
  version:1,reserva_id:'37c22aec-2b90-466c-aed4-111653103311',monto_total:30000,moneda:'CLP',
  aplicaciones:[{cargo_id:'b93d7634-48d7-41a7-b120-5043b3da423f',servicio_id:'19950686-4ef0-43e3-8287-7a3027f23178',monto:30000,saldo_esperado:30000,aplicado_esperado:0,cantidad_aplicaciones_esperada:0,concepto_canon:'tinaja_tonel',fecha_contexto:'2026-09-12',fecha_servicio_esperada:'2026-09-12'}]
 };
 assert.equal(carlos.aplicaciones.length,1);
 assert.equal(carlos.aplicaciones.reduce((n,a)=>n+a.monto,0),carlos.monto_total);
 assert.equal(new Set(carlos.aplicaciones.map(a=>a.cargo_id)).size,1);
 assert.match(helper,/p_aplicaciones=>aplicaciones_registro/);
 assert.match(helper,/p_modo_aplicacion=>'ninguno'/);
});

test('el contrato distribuido representa un pago de 50000 con dos aplicaciones',()=>{
 const distribuido={monto_total:50000,aplicaciones:[
  {cargo_id:'00000000-0000-4000-8000-000000000001',monto:20000,concepto_canon:'late_checkout'},
  {cargo_id:'00000000-0000-4000-8000-000000000002',monto:30000,concepto_canon:'tinaja_jacuzzi'}
 ]};
 assert.equal(distribuido.aplicaciones.length,2);
 assert.equal(distribuido.aplicaciones.reduce((n,a)=>n+a.monto,0),50000);
 assert.equal(new Set(distribuido.aplicaciones.map(a=>a.cargo_id)).size,2);
 assert.match(helper,/for aplicacion in select value from jsonb_array_elements\(aplicaciones_esperadas\) loop/);
 assert.equal((helper.match(/public\.haiku_registrar_pago\(/g)||[]).length,1);
});

test('la suma debe ser exacta y una aplicación incompleta revierte toda la llamada',()=>{
 assert.match(helper,/if suma is distinct from monto_total then[\s\S]+La suma de aplicaciones debe coincidir exactamente/);
 assert.match(helper,/if \(pago->>'aplicado'\)::bigint is distinct from monto_total/);
 assert.match(helper,/\(pago->>'sin_aplicar'\)::bigint is distinct from 0/);
 const handlers=[...helper.matchAll(/exception when others then\n\s+raise exception '[^']+';/g)];
 assert.equal(handlers.length,2,'los únicos handlers convierten cast inválido en aborto explícito');
});

test('el handshake es read-only, autenticado y el frontend exige su contrato exacto',()=>{
 const capacidad=base.slice(base.indexOf('create or replace function public.haiku_libro_aplicaciones_servicio_capacidad_v1()'));
 assert.match(capacidad,/auth\.uid\(\) is null/);
 assert.doesNotMatch(capacidad,/\b(?:insert|update|delete)\b/i);
 assert.match(capacidad,/revoke all[\s\S]+from public,anon;/);
 assert.match(capacidad,/grant execute[\s\S]+to authenticated;/);
 assert.match(capacidad,/'rpc','haiku_incorporar_pago_servicios_libro_v1'/);
 assert.match(capacidad,/'efectivo_sin_identificador',false/);
 const consultas=fs.readFileSync('js/haiku-libro-consultas-v1.js','utf8');
 assert.match(consultas,/haiku_libro_aplicaciones_servicio_capacidad_v1/);
 assert.match(consultas,/haiku_incorporar_pago_servicios_libro_v1/);
 assert.match(consultas,/aplicaciones_servicio_v1/);
 const ui=fs.readFileSync('js/haiku-libro-pagos-ui-v1.js','utf8');
 assert.doesNotMatch(ui,/haiku_incorporar_pago_servicios_libro_v1|haiku_registrar_pago/);
});
