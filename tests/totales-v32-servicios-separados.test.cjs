const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260929194050_total_v32_servicios_separados.sql';
const sql = fs.readFileSync(migrationPath, 'utf8');

test('TOTAL v32 es incremental y conserva la firma pública jsonb', () => {
  assert.match(sql, /create or replace function public\.haiku_cambiar_totales_lote_v1\(p_cambios jsonb\)/i);
  assert.match(sql, /comment on function public\.haiku_cambiar_totales_lote_v1\(jsonb\) is 'total1_financiero_v32'/i);
  assert.match(sql, /'version','total1_financiero_v32','servicios_separados',true/i);
  assert.doesNotMatch(sql, /drop function|alter table|drop table/i);
});

test('planner v32 separa físicamente alojamiento y servicios', () => {
  assert.match(sql, /c\.tipo_cargo='alojamiento' and c\.servicio_id is not null/i);
  assert.match(sql, /c\.tipo_cargo is distinct from 'alojamiento' and \(c\.servicio_id is null or s\.reserva_id is distinct from p_id\)/i);
  assert.match(sql, /s\.total is distinct from coalesce\([\s\S]*sum\(ec\.monto_ajustado\)/i);
  assert.match(sql, /Servicios o cargos no separados inequívocamente: requiere revisión/i);
});

test('pagos mixtos, sin destino y devoluciones permanecen bloqueados', () => {
  assert.match(sql, /Pago mezclado entre alojamiento y servicios: requiere revisión/i);
  assert.match(sql, /Pago no elegible o destino ambiguo: requiere revisión/i);
  assert.match(sql, /Pago con devolución vinculada: requiere revisión/i);
  assert.match(sql, /Pago de servicio con remanente ambiguo: requiere revisión/i);
});

test('reconciliación considera sólo aplicaciones y pagos de alojamiento', () => {
  const planner = sql.slice(
    sql.indexOf('create or replace function private.haiku_plan_aplicaciones_total_v32'),
    sql.indexOf('create or replace function private.haiku_plan_total_financiero_v32')
  );
  assert.match(planner, /c\.tipo_cargo='alojamiento' and c\.servicio_id is null and c\.estado='activo'/i);
  assert.match(planner, /pagos_servicio_preservados/i);
  assert.doesNotMatch(planner, /update public\.(?:servicios|cargos|pagos|pago_aplicaciones)/i);
});

test('snapshot v32 protege servicios, cargos, ajustes, aplicaciones y pagos completos', () => {
  const snapshot = sql.slice(
    sql.indexOf('create or replace function private.haiku_snapshot_total_financiero_v32'),
    sql.indexOf('create or replace function public.haiku_cambiar_totales_lote_v1')
  );
  for (const clave of ["'pagos'", "'servicios'", "'aplicaciones_servicio'", "'cargos'", "'ajustes'", "'reserva'", "'estadias'"]) {
    assert.match(snapshot, new RegExp(clave));
  }
});

test('writer no modifica servicios ni pagos y limita cargos/ajustes al plan de alojamiento', () => {
  const writer = sql.slice(sql.indexOf('create or replace function public.haiku_cambiar_totales_lote_v1'));
  assert.doesNotMatch(writer, /(?:update|delete from|insert into) public\.servicios/i);
  assert.doesNotMatch(writer, /(?:update|delete from|insert into) public\.pagos(?:\s|\()/i);
  assert.match(writer, /private\.haiku_ejecutar_aplicaciones_total_v3\(plan->'reconciliacion','liberar'\)/i);
  assert.match(writer, /update public\.estadia_noches set tarifa=/i);
  assert.match(writer, /update public\.cargos set monto=/i);
  assert.match(writer, /update public\.cargo_ajustes set base_calculo=/i);
});

test('resultado y auditoría exponen totales suficientes para UI futura', () => {
  for (const campo of ['servicios_sin_cambios', 'servicios_pendientes', 'total_reserva_anterior', 'total_reserva_esperado']) {
    assert.match(sql, new RegExp(`'${campo}'`));
  }
  assert.match(sql, /Cambio exclusivamente financiero de alojamiento; servicios sin cambios/i);
});

test('ACL mantiene writer autenticado y privadas fuera de roles API', () => {
  assert.match(sql, /returns jsonb language plpgsql security definer set search_path=pg_catalog/i);
  assert.match(sql, /revoke all on function public\.haiku_cambiar_totales_lote_v1\(jsonb\) from public,anon/i);
  assert.match(sql, /grant execute on function public\.haiku_cambiar_totales_lote_v1\(jsonb\) to authenticated/i);
  for (const funcion of ['haiku_plan_total_iva_v32', 'haiku_plan_aplicaciones_total_v32', 'haiku_plan_total_financiero_v32', 'haiku_snapshot_total_financiero_v32']) {
    assert.match(sql, new RegExp(`revoke all on function private\\.${funcion}`));
  }
});
