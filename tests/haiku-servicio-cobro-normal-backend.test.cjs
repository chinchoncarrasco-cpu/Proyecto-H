const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname,
  '../supabase/migrations/20260923002858_haiku_cambiar_servicio_a_cobro_normal_v1.sql'), 'utf8');

test('RPC inverso tiene firma estrecha, sesión y permisos explícitos', () => {
  assert.match(migration, /haiku_cambiar_servicio_a_cobro_normal_v1\s*\(\s*p_operacion_id uuid,\s*p_servicio_id uuid,\s*p_personas smallint,\s*p_estado_esperado jsonb/i);
  assert.match(migration, /security definer\s+set search_path = pg_catalog, public, private/i);
  assert.match(migration, /private\.haiku_usuario_activo\(\)/i);
  assert.match(migration, /private\.haiku_tiene_permiso\('servicios\.editar'\)/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function[^;]+to\s+(?:anon|public)\b/i);
});

test('precio depende de catálogo, cantidad persistida y personas explícitas', () => {
  assert.match(migration, /v_precio_hora := v_catalogo\.precio_base/i);
  assert.match(migration, /v_total := v_servicio\.cantidad::bigint \* v_precio_hora/i);
  assert.match(migration, /v_adicional := v_servicio\.cantidad::bigint/i);
  assert.match(migration, /v_catalogo\.capacidad_maxima/i);
  assert.match(migration, /p_estado_esperado is distinct from v_estado_actual/i);
  assert.doesNotMatch(migration, /p_precio|p_total/i);
});

test('RPC hereda locks e idempotencia y sólo actualiza servicios', () => {
  assert.match(migration, /solicitud_hash is distinct from v_hash/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended/i);
  assert.match(migration, /haiku_libro_lock_key_v1\('reserva_finanzas'/i);
  assert.match(migration, /set_config\('app\.haiku_origen', 'haku', true\)/i);
  assert.match(migration, /set_config\('app\.haiku_operacion_id'/i);
  assert.match(migration, /update public\.servicios set/i);
  assert.doesNotMatch(migration, /(?:update|insert into|delete from) public\.(?:cargos|pagos|pago_aplicaciones|cargo_ajustes|reservas|eventos_auditoria)\b/i);
});
