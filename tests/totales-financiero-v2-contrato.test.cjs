const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260910225553_haiku_total_financiero_v2.sql','utf8');
test('writer financiero no llama editor completo ni reconstruye cargos/aplicaciones',()=>{
 assert.doesNotMatch(sql,/haiku_modificar_reserva_completa|delete\s+from|truncate\s|insert\s+into\s+public\.(cargos|pago_aplicaciones|cargo_ajustes)/i);
 const updates=[...sql.matchAll(/update public\.(\w+) set ([^;]+);/gi)].map(m=>[m[1],m[2].split(' where ')[0]]);
 assert.deepEqual(updates,[['estadia_noches',"tarifa=(fila->>'base_nueva')::bigint"],['cargos',"monto=(fila->>'base_nueva')::bigint"],['cargo_ajustes',"base_calculo=(fila->>'base_nueva')::bigint,monto=(fila->>'iva_nuevo')::bigint"]]);
});
test('IVA reutiliza autoridad y se conserva una sola RPC pública de escritura',()=>{
 assert.match(sql,/plan:=private\.haiku_plan_total_iva\(p_id,p_objetivo\)/);assert.doesNotMatch(sql,/1\.19|regexp_replace/);
 const publicas=[...sql.matchAll(/create or replace function public\.(\w+)/gi)].map(m=>m[1]);
 assert.deepEqual(publicas,['haiku_cambiar_totales_lote_v1','haiku_capacidad_totales_v1']);
 assert.match(sql,/total1_financiero_v2/);assert.doesNotMatch(sql,/total1_atomico_v1/);
});
test('snapshot protege representación completa de personas y aplicaciones',()=>{
 for(const campo of ['reserva','huespedes','aplicaciones','pagos','servicios','notas','solicitudes'])assert.ok(sql.includes("'"+campo+"'"));
 assert.doesNotMatch(sql,/-'titular_numero_documento'|-'numero_documento'|-'origen_tarifa'/);
 assert.match(sql,/if actual is distinct from esperado/);assert.match(sql,/aplicado_neto<=/);
});
