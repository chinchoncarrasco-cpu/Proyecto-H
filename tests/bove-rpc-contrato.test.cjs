const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260910180000_bove_registro_atomico.sql','utf8');
const original=fs.readFileSync('tests/fixtures/bove-rpc-originales.sql','utf8');
function funciones(s){return [...s.replace(/\r/g,'').matchAll(/CREATE OR REPLACE FUNCTION public\.(haiku_registrar_bove_\w+)[\s\S]*?\$function\$;/g)].map(m=>[m[1],m[0]]);}
test('sólo reemplaza las dos RPC existentes, sin grants nuevos ni bypass',()=>{
 assert.deepEqual(funciones(sql).map(x=>x[0]),['haiku_registrar_bove_checkout','haiku_registrar_bove_reserva']);
 assert.doesNotMatch(sql,/\b(?:grant|revoke|create table|create trigger)\s/i);assert.doesNotMatch(sql,/force\s*=|overwrite\s*=/i);
 assert.ok(sql.includes('BEGIN;'));assert.ok(sql.includes('COMMIT;'));
});
for(const [nombre,body] of funciones(sql))test(nombre+': validaciones y escritura original conservadas',()=>{
 const previo=funciones(original).find(x=>x[0]===nombre)[1];
 const sinGuard=body.replace('  v_actual public.reservas%rowtype;\n','').replace(/  -- Serializa todos los intentos[\s\S]*?(?=  update public.reservas)/,'');
 assert.equal(sinGuard,previo);assert.match(body,/for update;/);assert.ok(body.indexOf('for update;')>body.indexOf('if v_saldo <> 0'));
 const guard=body.slice(body.indexOf('for update;'),body.indexOf('  update public.reservas'));
 assert.match(guard,/ya_registrado/);assert.match(guard,/registrado_por/);assert.match(guard,/registrado_en/);assert.doesNotMatch(guard,/\bupdate public/);
});
for(const [file,rpc] of [['js/supabase-pagos-checkin-v5.js','haiku_registrar_bove_reserva'],['js/supabase-pagos-checkout-v1.js','haiku_registrar_bove_checkout']])test('botón manual conserva '+rpc,()=>{
 const fuente=fs.readFileSync(file,'utf8');assert.ok(fuente.includes('"'+rpc+'"'));assert.ok(fuente.includes('haiku:bove-actualizado'));
});

for(const [nombre,body] of funciones(sql))test(nombre+': revisión final de lock, conflicto y auditoría',()=>{
 const campo=nombre.endsWith('checkout')?'bove_checkout':'bove_cierre';
 assert.match(body,/select \* into v_actual\s+from public\.reservas\s+where id = p_reserva_id\s+for update;/);
 assert.match(body,/update public\.reservas[\s\S]+where id = p_reserva_id;/);
 const guard=body.slice(body.indexOf('  -- Serializa'),body.indexOf('  update public.reservas'));
 assert.ok(guard.indexOf('for update;')<guard.indexOf(`v_actual.${campo}`));
 assert.ok(guard.includes(`if btrim(v_actual.${campo}) <> v_bove then\n      raise exception 'BOVE ya registrado con un número diferente.';\n    end if;`));
 assert.doesNotMatch(body,/exception\s+when/i); // no captura que permita seguir tras el conflicto
 assert.ok(guard.includes(`'registrado_por', v_actual.${campo}_registrado_por`));
 assert.ok(guard.includes(`'registrado_en', v_actual.${campo}_registrado_en`));
 assert.doesNotMatch(guard,/now\(\)|auth\.uid\(\)|\bupdate public/);
 assert.equal((body.match(/update public\.reservas/g)||[]).length,1);
 assert.match(body,/v_bove text := nullif\(btrim\(coalesce\(p_bove,''\)\), ''\);/);
 assert.ok(guard.includes(`nullif(btrim(coalesce(v_actual.${campo}, '')), '')`));
});
