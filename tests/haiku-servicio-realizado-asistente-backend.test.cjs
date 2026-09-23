const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..',
  'supabase/migrations/20260923133205_haiku_marcar_servicio_realizado_asistente_v1.sql'), 'utf8');

test('RPC asistido de realizado usa la firma y seguridad previstas', () => {
  assert.match(migration, /create function public\.haiku_marcar_servicio_realizado_asistente_v1\(\s*p_operacion_id uuid,\s*p_servicio_id uuid,\s*p_estado_esperado jsonb\s*\) returns jsonb/i);
  assert.match(migration, /security definer\s+set search_path = pg_catalog, public, private/i);
  assert.match(migration, /private\.haiku_usuario_activo\(\)/i);
  assert.match(migration, /private\.haiku_tiene_permiso\('servicios\.editar'\)/i);
  assert.match(migration, /revoke all on function public\.haiku_marcar_servicio_realizado_asistente_v1\(uuid,uuid,jsonb\)\s+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.haiku_marcar_servicio_realizado_asistente_v1\(uuid,uuid,jsonb\)\s+to authenticated/i);
});

test('única escritura de negocio es el estado del mismo servicio', () => {
  assert.match(migration, /update public\.servicios set estado_servicio = 'realizado', actualizado_en = now\(\)\s+where id = p_servicio_id/i);
  assert.doesNotMatch(migration, /\b(?:insert into|update|delete from) public\.(?:cargos|pagos|pago_aplicaciones|cargo_ajustes|reservas|reserva_estadias)\b/i);
  assert.match(migration, /servicios_sincronizar_cargo|FOR UPDATE sobre cargos/i);
  assert.match(migration, /Falló la postcondición financiera/i);
  assert.match(migration, /Falló la postcondición de reserva\/BOVE/i);
});

test('idempotencia, estado esperado, reloj Chile y auditoría siguen presentes', () => {
  assert.match(migration, /solicitud_hash text not null/i);
  assert.match(migration, /on conflict \(operacion_id\) do nothing/i);
  assert.match(migration, /v_operacion\.resultado \|\| jsonb_build_object\('reintento', true\)/i);
  assert.match(migration, /p_estado_esperado is distinct from v_estado_actual/i);
  assert.match(migration, /America\/Santiago/i);
  assert.match(migration, /set_config\('app\.haiku_origen', 'haku', true\)/i);
  assert.match(migration, /set_config\('app\.haiku_operacion_id', p_operacion_id::text, true\)/i);
  assert.match(migration, /ea\.origen = 'haku'/i);
});
