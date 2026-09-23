const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname,
  '../supabase/migrations/20260923054859_haiku_reactivar_servicio_asistente_v1.sql'),'utf8');

test('RPC asistido separado del manual y con permisos limitados',()=>{
  assert.match(migration,/haiku_reactivar_servicio_asistente_v1\s*\(\s*p_operacion_id uuid,\s*p_servicio_id uuid,\s*p_estado_esperado jsonb/i);
  assert.match(migration,/security definer\s+set search_path = pg_catalog, public, private/i);
  assert.match(migration,/private\.haiku_usuario_activo\(\)/i);
  assert.match(migration,/private\.haiku_tiene_permiso\('servicios\.editar'\)/i);
  assert.match(migration,/revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration,/grant execute on function[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration,/create or replace function public\.haiku_reactivar_servicio\s*\(/i);
});

test('una sola escritura de negocio: el servicio; cargos mediante trigger',()=>{
  assert.match(migration,/update public\.servicios set\s+estado_servicio = 'programado'/i);
  assert.match(migration,/cancelado_en = null,\s*cancelado_por = null,\s*motivo_cancelacion = null/i);
  assert.doesNotMatch(migration,/(?:update|insert into|delete from) public\.(?:cargos|pagos|pago_aplicaciones|cargo_ajustes|reservas|eventos_auditoria)\b/i);
  assert.match(migration,/set_config\('app\.haiku_origen', 'haku', true\)/i);
  assert.match(migration,/set_config\('app\.haiku_operacion_id'/i);
});

test('estado esperado, idempotencia y postcondiciones financieras',()=>{
  assert.match(migration,/solicitud_hash is distinct from v_hash/i);
  assert.match(migration,/p_estado_esperado is distinct from v_estado_actual/i);
  assert.match(migration,/jsonb_array_length\(v_aplicaciones_antes\) <> 0/i);
  assert.match(migration,/jsonb_array_length\(v_ajustes_antes\) <> 0/i);
  assert.match(migration,/v_reserva\.bove_cierre is not null/i);
  assert.match(migration,/HORARIO_OCUPADO/i);
  assert.match(migration,/Falló la postcondición del cargo nuevo/i);
  assert.match(migration,/No se pudo acreditar la auditoría/i);
});
