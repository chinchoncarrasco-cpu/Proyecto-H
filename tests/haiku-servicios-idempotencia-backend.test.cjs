const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260916211226_haku_servicios_idempotencia_atomica.sql','utf8');

test('RPC conserva firma, invocador, autenticacion y grants existentes',()=>{
 assert.match(sql,/create or replace function public\.haiku_registrar_servicio\([\s\S]*p_estadia_id uuid default null::uuid[\s\S]*returns jsonb[\s\S]*security invoker/i);
 assert.match(sql,/if auth\.uid\(\) is null/i);
 assert.match(sql,/grant execute on function public\.haiku_registrar_servicio\([\s\S]*to authenticated/i);
 assert.match(sql,/revoke all on function public\.haiku_registrar_servicio\([\s\S]*from public, anon/i);
});

test('lock por reserva ocurre antes de revalidar y antes del insert',()=>{
 const lock=sql.indexOf('perform pg_advisory_xact_lock');
 const read=sql.indexOf("v_marca_libro := substring");
 const insert=sql.indexOf('insert into public.servicios');
 assert.ok(lock>=0&&lock<read&&read<insert);
 assert.match(sql,/md5\('reserva_finanzas:' \|\| p_reserva_id::text\)/i);
});

test('Late Check-out es unico activo por estadia y cancelados no bloquean',()=>{
 assert.match(sql,/v_codigo = 'lateCheckout'[\s\S]*s\.estadia_id = new\.estadia_id[\s\S]*cs\.codigo = 'lateCheckout'/i);
 assert.match(sql,/p_codigo_servicio = 'lateCheckout'[\s\S]*s\.estadia_id = p_estadia_id[\s\S]*cs\.codigo = 'lateCheckout'/i);
 assert.match(sql,/not in \('cancelado', 'no_show'\)/i);
 assert.match(sql,/Late Check-out requiere una estadia unica/i);
});

test('servicios repetibles usan identidad horaria exacta y no un UNIQUE global',()=>{
 assert.match(sql,/v_requiere_horario[\s\S]*s\.fecha_servicio = new\.fecha_servicio[\s\S]*s\.hora_inicio = new\.hora_inicio[\s\S]*s\.total = new\.total/i);
 assert.match(sql,/v_catalogo\.requiere_horario[\s\S]*s\.fecha_servicio = p_fecha_servicio[\s\S]*s\.hora_inicio = p_hora[\s\S]*s\.total = v_total/i);
 assert.doesNotMatch(sql,/create\s+unique\s+index|unique\s*\(/i);
});

test('ambiguedad falla cerrada y retry devuelve el mismo servicio',()=>{
 assert.match(sql,/cardinality\(v_coincidentes\) > 1[\s\S]*requiere revision/i);
 assert.doesNotMatch(sql,/if v_servicio_id is null and p_codigo_servicio = 'lateCheckout'/i);
 assert.doesNotMatch(sql,/elsif v_servicio_id is null[\s\S]*v_catalogo\.requiere_horario/i);
 assert.match(sql,/v_servicio_id is not null and v_servicio_id <> v_coincidentes\[1\][\s\S]*identifican servicios distintos/i);
 assert.match(sql,/'estado', 'ya_existente'[\s\S]*'reutilizado', true/i);
 assert.match(sql,/'estado', 'creado'[\s\S]*'reutilizado', false/i);
});

test('trigger protege tambien clientes antiguos y wrapper refleja omitidos',()=>{
 assert.match(sql,/create trigger haiku_servicio_identidad_guard_v1[\s\S]*before insert or update/i);
 assert.match(sql,/if not pg_try_advisory_xact_lock[\s\S]*otra operacion financiera en curso/i);
 assert.match(sql,/create or replace function public\.haiku_importar_servicios_libro_v1/i);
 assert.match(sql,/v_resultado->>'reutilizado'[\s\S]*v_omitidos := v_omitidos \+ 1/i);
});
