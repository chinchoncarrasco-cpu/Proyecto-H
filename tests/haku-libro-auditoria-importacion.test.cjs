const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ruta = 'supabase/migrations/20260919023558_haku_libro_auditoria_importacion_segura.sql';
const sql = fs.readFileSync(ruta, 'utf8');

function cuerpo(nombre) {
  const inicio = sql.indexOf(`create or replace function ${nombre}`);
  assert.notEqual(inicio, -1, nombre);
  const fin = sql.indexOf('$function$;', inicio);
  assert.notEqual(fin, -1, `${nombre} sin cierre`);
  return sql.slice(inicio, fin + '$function$;'.length);
}

test('las notas del Libro reutilizan el trigger oficial sin abrir escritura directa', () => {
  assert.match(sql, /create trigger auditoria_notas_libro[\s\S]*?after insert on public\.notas/i);
  assert.match(sql, /when \(new\.tipo = 'operativa_resumen'\)/i);
  assert.match(sql, /execute function public\.haiku_auditar_cambio\(\)/i);
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete|truncate)[\s\S]*?eventos_auditoria/i);
  assert.doesNotMatch(sql, /security definer/i);
});

test('el RPC publico sigue como invoker y revalida estadias antes de escribir', () => {
  const rpc = cuerpo('public.haiku_importar_libro_operaciones_v2');
  assert.match(rpc, /security invoker/i);
  assert.match(rpc, /set_config\('app\.haiku_origen', 'haku', true\)/i);
  assert.match(rpc, /cardinality\(v_candidatas\).*<> 1/is);
  assert.match(rpc, /public\.haiku_importar_servicios_libro_v1\(/i);
  assert.match(rpc, /public\.haiku_importar_notas_libro_v1\(/i);
  assert.doesNotMatch(rpc, /insert into public\.eventos_auditoria/i);
  assert.match(sql, /revoke all on function public\.haiku_importar_libro_operaciones_v2\([\s\S]*?from public, anon/i);
  assert.match(sql, /grant execute on function public\.haiku_importar_libro_operaciones_v2\([\s\S]*?to authenticated/i);
});

test('el RPC conserva la atomicidad y los writers con sus limites actuales', () => {
  const rpc = cuerpo('public.haiku_importar_libro_operaciones_v2');
  assert.match(rpc, /if jsonb_array_length\(v_servicios_ok\) > 0[\s\S]*?haiku_importar_servicios_libro_v1/i);
  assert.match(rpc, /if jsonb_array_length\(v_notas_ok\) > 0[\s\S]*?haiku_importar_notas_libro_v1/i);
  assert.match(rpc, /'servicios_creados', v_servicios_creados/i);
  assert.match(rpc, /'notas_creadas', v_notas_creadas/i);
});
