const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(
  __dirname,
  '../supabase/migrations/20260922141129_haiku_cambiar_servicio_a_cortesia_v1.sql'
), 'utf8');

test('RPC de cortesía conserva un contrato estrecho y permisos explícitos', () => {
  assert.match(migration, /haiku_cambiar_servicio_a_cortesia_v1\s*\(\s*p_operacion_id uuid,\s*p_servicio_id uuid,\s*p_motivo text,\s*p_estado_esperado jsonb/i);
  assert.match(migration, /private\.haiku_usuario_activo\(\)/i);
  assert.match(migration, /private\.haiku_tiene_permiso\('servicios\.editar'\)/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function[^;]+to\s+(?:anon|public)\b/i);
});

test('RPC reutiliza idempotencia, locks y auditoría existentes', () => {
  assert.match(migration, /haiku_servicio_cortesia_operaciones_v1/i);
  assert.match(migration, /solicitud_hash is distinct from v_hash/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended/i);
  assert.match(migration, /haiku_libro_lock_key_v1\('reserva_finanzas'/i);
  assert.match(migration, /set_config\('app\.haiku_origen', 'haku', true\)/i);
  assert.match(migration, /set_config\('app\.haiku_operacion_id'/i);
  assert.doesNotMatch(migration, /insert into public\.eventos_auditoria/i);
});

test('RPC actualiza sólo el servicio y deja el cargo al trigger oficial', () => {
  assert.match(migration, /update public\.servicios\s+set tipo_cobro = 'cortesia',\s+total = 0,\s+monto_adicional = 0,\s+motivo_cortesia = v_motivo/i);
  assert.doesNotMatch(migration, /(?:update|insert into|delete from) public\.cargos/i);
  assert.match(migration, /v_cantidad_aplicaciones <> 0/i);
  assert.match(migration, /v_cantidad_ajustes <> 0/i);
  assert.match(migration, /Falló la postcondición del cargo/i);
});
