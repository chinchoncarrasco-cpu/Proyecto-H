const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sql=fs.readFileSync('supabase/migrations/20261016165354_libro_transferencia_late_manual_v1.sql','utf8');
test('excepción acotada a transferencia Late Check-out y usuario autenticado',()=>{
 assert.match(sql,/v_transferencia_late_manual\s*:=/);
 assert.match(sql,/p_argumentos->>'p_medio_pago'='transferencia' and p_manual is true/);
 assert.match(sql,/v_transferencia_prueba->>'usuario'=auth\.uid\(\)::text/);
 assert.match(sql,/aplicaciones_esperadas->0->>'concepto_canon'='late_checkout'/);
 assert.match(sql,/jsonb_array_length\(aplicaciones_esperadas\)=1/);
 assert.match(sql,/and v_transferencia_late_manual is distinct from true then/);
 assert.doesNotMatch(sql,/create or replace function public\.haiku_registrar_pago\(/i);
 assert.doesNotMatch(sql,/create or replace function public\.haiku_registrar_servicio\(/i);
});
test('origen estable, revisión de duplicados y auditoría de pago manual',()=>{
 assert.match(sql,/libro_origen:/);
 assert.match(sql,/p\.datos_origen->>'item_id'/);
 assert.match(sql,/p\.monto=monto_total/);
 assert.match(sql,/p\.fecha_pago::date=/);
 assert.match(sql,/p\.datos_origen->'transferencia_late_checkout_sin_identificador_v1'/);
 assert.match(sql,/'transferencia_late_checkout_sin_identificador_v1',v_origen->'transferencia_late_checkout_sin_identificador_v1'/);
 assert.match(sql,/'transferencia_late_checkout_sin_identificador_v1',true/);
});
