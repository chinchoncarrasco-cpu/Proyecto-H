const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const leer=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const sql=leer('supabase/preparadas/haiku_totales_iva_v1.sql');
const finalPath=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_haiku_total_writer_atomico_v1.sql'));
const finalSql=leer(finalPath?'supabase/migrations/'+finalPath:'supabase/preparadas/haiku_total_writer_atomico_v1.sql');
test('writer final conserva editor general y publica capacidad vinculada a la RPC',()=>{
 assert.doesNotMatch(finalSql,/create or replace function public\.haiku_modificar_reserva_completa/i);
 assert.match(finalSql,/obj_description\(p.oid,'pg_proc'\)='total1_atomico_v1'/);
 assert.match(finalSql,/has_function_privilege\('authenticated',p.oid,'EXECUTE'\)/);
 assert.match(finalSql,/private\.haiku_total_iva_snapshot\(rid\) is distinct from antes_iva/);
 assert.ok(finalSql.indexOf('for rid in select')<finalSql.indexOf('total<>esperado'));
 assert.ok(finalSql.indexOf('total<>esperado')<finalSql.indexOf('perform private.haiku_guardar_plan_iva'));
});
test('migración desplegada contiene sólo preview STABLE, sin dependencia del writer',()=>{
 const s=leer('supabase/migrations/20260910205010_haiku_total_iva_preview_solo_lectura.sql');
 assert.equal((s.match(/create or replace function/gi)||[]).length,1);
 assert.match(s,/language plpgsql stable security definer set search_path=pg_catalog/);
 assert.doesNotMatch(s.slice(0,s.indexOf('revoke all')),/\b(insert|update|delete|truncate|alter|drop|execute)\b/i);
 assert.doesNotMatch(s,/haiku_cambiar_totales_lote_v1/);
 assert.doesNotMatch(s,/haiku_guardar_plan_iva|private\.haiku_iva_incluido|private\.haiku_plan_total_iva/);
 assert.match(s,/'solo_lectura',true/);
});
for(const nombre of ['haiku_aplicar_ajuste_reserva','haiku_aplicar_ajuste_unidad'])test(nombre+' conserva contrato y distribución; sólo extrae fórmula IVA',()=>{
 const original=leer('tests/fixtures/'+nombre+'-original.sql').trim();
 const esperado=original.replace(/v_total_original\s*- round\(v_total_original::numeric \/ 1\.19\)::bigint/g,'private.haiku_iva_incluido(v_total_original)').replace(/v_cargo\.monto\s*- round\(v_cargo.monto::numeric \/ 1\.19\)::bigint/g,'private.haiku_iva_incluido(v_cargo.monto)');
 assert.ok(sql.includes(esperado),'El cuerpo debe conservarse salvo extracción literal de IVA');
 assert.ok(finalSql.includes(esperado),'El SQL a desplegar mantiene también el contrato existente');
});
test('guard del editor original permanece; helpers privados no son escritores públicos',()=>{
 assert.match(leer('tests/fixtures/total-core-original.sql'),/La reserva tiene un ajuste de cargo activo/);
 assert.doesNotMatch(sql,/create or replace function public\.haiku_modificar_reserva_completa/i);
 assert.match(sql,/revoke all on function private\.haiku_guardar_plan_iva\(jsonb\) from public,anon,authenticated/);
 const plan=sql.slice(sql.indexOf('create or replace function private.haiku_plan_total_iva'),sql.indexOf('-- Sólo invocado'));
 assert.doesNotMatch(plan,/\b(update|insert|delete)\b/i);
});
