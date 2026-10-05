-- Local only. Append-only field decisions; no XLSX/canonical interpretation writes.
begin;

create table if not exists private.haiku_libro_resoluciones (
  id uuid primary key,
  revision bigint generated always as identity,
  usuario_id uuid not null,
  clave text not null,
  identidad jsonb not null,
  campo text not null check (campo = 'ocupacion'),
  valor_original jsonb not null,
  valor_confirmado jsonb not null,
  anterior uuid references private.haiku_libro_resoluciones(id),
  confirmado_en timestamptz not null default clock_timestamp()
);
create index if not exists haiku_libro_resoluciones_ultima
  on private.haiku_libro_resoluciones(usuario_id, clave, revision desc);
alter table private.haiku_libro_resoluciones enable row level security;
revoke all on private.haiku_libro_resoluciones from public, anon, authenticated;
revoke all on sequence private.haiku_libro_resoluciones_revision_seq from public, anon, authenticated;

create or replace function private.haiku_libro_validar_ocupacion_v1(p_valor jsonb, p_tipo text)
returns void language plpgsql set search_path = '' as $fn$
declare k text; n numeric;
begin
  foreach k in array array['adultos','ninos','mascotas'] loop
    if jsonb_typeof(p_valor -> k) is distinct from 'number' then
      raise exception 'Ocupacion invalida: % debe ser entero numerico', k;
    end if;
    n := (p_valor ->> k)::numeric;
    if n <> trunc(n) or n < (case when k = 'adultos' then 1 else 0 end) or n > 32767 then
      raise exception 'Ocupacion invalida: % fuera de rango smallint', k;
    end if;
  end loop;
  if p_tipo = 'fullday' then
    perform private.haiku_libro_tarifa_fullday_adl(p_valor -> 'adultos');
  end if;
end;
$fn$;
revoke all on function private.haiku_libro_validar_ocupacion_v1(jsonb,text) from public, anon, authenticated;

-- Narrow authenticated gateways are SECURITY DEFINER because the audit store
-- is private and has no client table privileges or policies permitting writes.
create or replace function public.haiku_libro_confirmar_resolucion_v1(
  p_operacion_id uuid, p_identidad jsonb, p_campo text, p_valor jsonb,
  p_anterior uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  u uuid := auth.uid(); c text; e jsonb; orig jsonb;
  previo private.haiku_libro_resoluciones%rowtype;
  fila private.haiku_libro_resoluciones%rowtype;
begin
  if u is null or private.haiku_tiene_permiso('reservas.crear') is not true then
    raise exception 'Sin permiso para resolver reservas' using errcode = '42501';
  end if;
  e := p_identidad -> 'evidencia';
  -- SHA, coordinates and evidence are authenticated client declarations.
  -- The server does not receive or independently verify the XLSX.
  if p_operacion_id is null or p_campo is distinct from 'ocupacion'
    or jsonb_typeof(p_identidad) is distinct from 'object'
    or coalesce(p_identidad ->> 'version','') !~ '^[a-f0-9]{64}$'
    or nullif(p_identidad ->> 'elemento','') is null
    or nullif(p_identidad -> 'origen' ->> 'hoja','') is null
    or nullif(p_identidad -> 'origen' ->> 'celda','') is null
    or e ->> 'id' is distinct from p_identidad ->> 'elemento'
    or e -> 'coordenadas_origen' is distinct from p_identidad -> 'origen'
    or e ->> 'tipo_estadia' not in ('alojamiento','full_day')
    or e ->> 'tipo_estadia' is null
    or octet_length(p_identidad::text) > 262144 then
    raise exception 'Identidad, version o evidencia de resolucion invalida';
  end if;
  if jsonb_typeof(p_valor) is distinct from 'object' or not (p_valor ?& array['adultos','ninos','mascotas'])
    or (p_valor - array['adultos','ninos','mascotas']) <> '{}'::jsonb
    or p_valor -> 'ninos' = 'null'::jsonb or p_valor -> 'mascotas' = 'null'::jsonb then
    raise exception 'La resolucion requiere adultos, ninos y mascotas';
  end if;
  perform private.haiku_libro_validar_ocupacion_v1(p_valor,case when e ->> 'tipo_estadia' = 'full_day' then 'fullday' else 'alojamiento' end);
  c := md5(p_identidad::text);
  -- Same lock at edit and incorporation: an edit cannot race an old preview.
  perform pg_advisory_xact_lock(hashtextextended(u::text || c, 0));
  select * into fila from private.haiku_libro_resoluciones where id = p_operacion_id;
  if found then
    if fila.usuario_id is distinct from u or fila.identidad is distinct from p_identidad or fila.valor_confirmado is distinct from p_valor
      or fila.anterior is distinct from p_anterior then
      raise exception 'Identificador de resolucion ya usado con otros datos' using errcode = 'HLC01';
    end if;
    return to_jsonb(fila);
  end if;
  select * into previo from private.haiku_libro_resoluciones
    where usuario_id = u and clave = c and identidad = p_identidad order by revision desc limit 1;
  if previo.id is distinct from p_anterior then
    raise exception 'La resolucion cambio; vuelve a abrir el informe antes de editar' using errcode = 'HLC01';
  end if;
  orig := jsonb_build_object('adultos',e -> 'adultos','ninos',e -> 'ninos','mascotas',e -> 'mascotas');
  insert into private.haiku_libro_resoluciones(id,usuario_id,clave,identidad,campo,valor_original,valor_confirmado,anterior)
    values(p_operacion_id,u,c,p_identidad,p_campo,orig,p_valor,p_anterior) returning * into fila;
  return to_jsonb(fila);
end;
$fn$;

create or replace function public.haiku_libro_leer_resoluciones_v1(p_identidades jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare u uuid := auth.uid(); resultado jsonb;
begin
  if u is null or private.haiku_tiene_permiso('reservas.crear') is not true then
    raise exception 'Sin permiso para leer resoluciones' using errcode = '42501';
  end if;
  if jsonb_typeof(p_identidades) is distinct from 'array' or jsonb_array_length(p_identidades) > 500
    or octet_length(p_identidades::text) > 4194304 then raise exception 'Consulta de resoluciones invalida'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into resultado
  from jsonb_array_elements(p_identidades) i
  cross join lateral (
    select * from private.haiku_libro_resoluciones r
    where r.usuario_id = u and r.clave = md5(i::text) and r.identidad = i
    order by r.revision desc limit 1
  ) r;
  return resultado;
end;
$fn$;
revoke all on function public.haiku_libro_confirmar_resolucion_v1(uuid,jsonb,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.haiku_libro_leer_resoluciones_v1(jsonb) from public, anon, authenticated;
grant execute on function public.haiku_libro_confirmar_resolucion_v1(uuid,jsonb,text,jsonb,uuid) to authenticated;
grant execute on function public.haiku_libro_leer_resoluciones_v1(jsonb) to authenticated;

create or replace function private.haiku_libro_validar_resolucion_v1(p_ref jsonb, p_origen jsonb, p_datos jsonb, p_cabana jsonb, p_titular text)
returns void language plpgsql set search_path = '' as $fn$
declare r private.haiku_libro_resoluciones%rowtype; e jsonb; k text; c text;
begin
  if jsonb_typeof(p_ref) is distinct from 'object' or jsonb_typeof(p_origen) is distinct from 'object' then
    raise exception 'La ocupacion manual requiere referencia y origen de la resolucion persistida' using errcode = 'HLC01';
  end if;
  c := md5(p_origen::text);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || c, 0));
  select * into r from private.haiku_libro_resoluciones
    where usuario_id = auth.uid() and clave = c and identidad = p_origen
    order by revision desc limit 1;
  if not found or r.id::text is distinct from p_ref ->> 'id'
    or r.identidad is distinct from p_ref -> 'identidad'
    or r.valor_confirmado is distinct from p_ref -> 'valor_confirmado' then
    raise exception 'Resolucion ajena, obsoleta o no confirmada; vuelve a comparar y preparar' using errcode = 'HLC01';
  end if;
  foreach k in array array['adultos','ninos','mascotas'] loop
    if p_datos -> k is distinct from r.valor_confirmado -> k then
      raise exception 'La ocupacion no coincide con la resolucion confirmada' using errcode = 'HLC01';
    end if;
  end loop;
  e := r.identidad -> 'evidencia';
  if e -> 'cabana' is distinct from p_cabana or e ->> 'titular' is distinct from p_titular
    or e ->> 'fecha_checkin' is distinct from p_datos ->> 'fecha_ingreso'
    or e ->> 'fecha_checkout' is distinct from p_datos ->> 'fecha_salida'
    or (case when e ->> 'tipo_estadia' = 'full_day' then 'fullday' else e ->> 'tipo_estadia' end) is distinct from p_datos ->> 'tipo_estadia' then
    raise exception 'La resolucion pertenece a otro elemento del Libro' using errcode = 'HLC01';
  end if;
end;
$fn$;
revoke all on function private.haiku_libro_validar_resolucion_v1(jsonb,jsonb,jsonb,jsonb,text) from public, anon, authenticated;

-- Only explicit manual references enter V1. Ordinary main payloads are unchanged.
create or replace function private.haiku_libro_validar_ocupaciones_lote_v1(p_items jsonb)
returns void language plpgsql security invoker set search_path = '' as $fn$
declare i jsonb; e jsonb; v_tipo text; c text;
begin
  -- Importer canonicalizes tipo before hashing/execution. Use that same value.
  -- Lock all referenced decisions in a stable order before validating latest revisions.
  for c in select distinct md5((e.value -> 'libro_origen')::text)
    from jsonb_array_elements(p_items) i
    cross join lateral jsonb_array_elements(coalesce(i.value -> 'estadias','[]'::jsonb)) e
    where i.value ->> 'tipo' = 'reserva_nueva' and e.value ? 'resolucion_manual'
    order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || c,0));
  end loop;
  for i in select value from jsonb_array_elements(p_items) loop
    v_tipo := i ->> 'tipo';
    if i ?| array['resolucion_manual','ocupacion_manual','libro_origen']
      or coalesce((i -> 'estadia') ?| array['resolucion_manual','ocupacion_manual','libro_origen'],false) then
      raise exception 'Ocupacion manual V1 solo permite crear reservas nuevas; requiere revision manual'
        using errcode = 'HLC02';
    end if;
    for e in select value from jsonb_array_elements(coalesce(i -> 'estadias','[]'::jsonb)) loop
      continue when not (e ?| array['resolucion_manual','ocupacion_manual','libro_origen']);
      if v_tipo is distinct from 'reserva_nueva' then
        raise exception 'Ocupacion manual V1 solo permite crear reservas nuevas; requiere revision manual'
          using errcode = 'HLC02';
      end if;
      if auth.uid() is null or private.haiku_tiene_permiso('reservas.crear') is not true then
        raise exception 'Sin permiso para crear reservas con ocupacion manual' using errcode = '42501';
      end if;
      perform private.haiku_libro_validar_resolucion_v1(
        e -> 'resolucion_manual',e -> 'libro_origen',e -> 'datos',e -> 'cabana_numero',
        i -> 'reserva' ->> 'titular_nombre');
      perform private.haiku_libro_validar_ocupacion_v1(e -> 'datos',e -> 'datos' ->> 'tipo_estadia');
    end loop;
  end loop;
end;
$fn$;
revoke all on function private.haiku_libro_validar_ocupaciones_lote_v1(jsonb) from public, anon, authenticated;

-- Preserve the current importer, financial logic, ACL/owner and completed retries.
-- Canonicalize each operation type once, before hashing, so every execution loop
-- (including existing updates) receives exactly the type checked by V1.
do $migration$
declare sig regprocedure := 'public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure;
  body text; anchor text := '  -- Primero crea las reservas nuevas para resolver las referencias simbolicas.';
  added text := '  perform private.haiku_libro_validar_ocupaciones_lote_v1(p_items);';
  hash_anchor text := '  v_hash := md5(p_items::text);';
  normalizar text := $normalization$  -- Canonical operation types for validation, hashing and every execution path.
  select jsonb_agg(item || jsonb_build_object(
      'tipo', lower(btrim(coalesce(item ->> 'tipo', '')))) order by posicion)
    into p_items from jsonb_array_elements(p_items) with ordinality as entrada(item,posicion);
$normalization$;
begin
  body := pg_get_functiondef(sig);
  if position(normalizar in body) = 0 then
    if (length(body) - length(replace(body,hash_anchor,''))) / length(hash_anchor) <> 1 then
      raise exception 'Migration detenida: normalizacion del importador inesperada; revisar localmente';
    end if;
    body := replace(body,hash_anchor,normalizar || hash_anchor);
  end if;
  if position(added in body) = 0 then
    if (length(body) - length(replace(body,anchor,''))) / length(anchor) <> 1 then
      raise exception 'Migration detenida: importador inesperado; revisar localmente';
    end if;
    body := replace(body,anchor,added || E'\n' || anchor);
  end if;
  execute body;
end;
$migration$;
commit;
