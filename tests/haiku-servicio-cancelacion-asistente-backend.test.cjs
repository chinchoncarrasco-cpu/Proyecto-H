const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname,
  '../supabase/migrations/20260923035510_haiku_cancelar_servicio_asistente_v1.sql'),'utf8');

test('firma estrecha, sesión, permiso y seguridad explícitos',()=>{
  assert.match(migration,/haiku_cancelar_servicio_asistente_v1\s*\(\s*p_operacion_id uuid,\s*p_servicio_id uuid,\s*p_motivo text,\s*p_estado_esperado jsonb/i);
  assert.match(migration,/security definer\s+set search_path = pg_catalog, public, private/i);
  assert.match(migration,/private\.haiku_usuario_activo\(\)/i);
  assert.match(migration,/private\.haiku_tiene_permiso\('servicios\.cancelar'\)/i);
  assert.match(migration,/revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration,/grant execute on function[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration,/grant execute on function[^;]+to\s+(?:anon|public)\b/i);
});

test('única escritura de negocio al servicio; cargo oficial por trigger',()=>{
  assert.match(migration,/update public\.servicios set\s+estado_servicio = 'cancelado'/i);
  assert.doesNotMatch(migration,/(?:update|insert into|delete from) public\.(?:cargos|pagos|pago_aplicaciones|cargo_ajustes|reservas|eventos_auditoria)\b/i);
  assert.match(migration,/motivo_cancelacion = p_motivo/i);
  assert.match(migration,/set_config\('app\.haiku_origen', 'haku', true\)/i);
  assert.match(migration,/set_config\('app\.haiku_operacion_id'/i);
});

test('estado esperado, idempotencia y postcondiciones bloquean cambios inseguros',()=>{
  assert.match(migration,/solicitud_hash is distinct from v_hash/i);
  assert.match(migration,/p_estado_esperado is distinct from v_estado_actual/i);
  assert.match(migration,/v_aplicaciones <> 0/i);
  assert.match(migration,/v_ajustes <> 0/i);
  assert.match(migration,/v_reserva\.bove_checkout is not null/i);
  assert.match(migration,/Falló la postcondición del cargo/i);
  assert.match(migration,/No se pudo acreditar la auditoría/i);
});
