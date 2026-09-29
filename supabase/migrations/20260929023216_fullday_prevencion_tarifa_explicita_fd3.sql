-- FD-3 · Prevención de altas Full Day con tarifa nocturna heredada.
--
-- Esta migración parte de la candidata validada en Supabase Lab, pero añade
-- guardas sobre la definición efectiva, SECURITY DEFINER, search_path, owner y
-- ACL. Sólo reemplaza el fallback de Full Day; alojamiento conserva literalmente
-- su fallback histórico a cabanas.precio_base.

begin;

do $migration$
declare
  v_signature constant regprocedure :=
    'public.haiku_crear_reserva(text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb,text,text)'::regprocedure;
  v_def text;
  v_after text;
  v_previous_acl aclitem[];
  v_after_acl aclitem[];
  v_previous_owner oid;
  v_after_owner oid;
  v_previous_security boolean;
  v_after_security boolean;
  v_previous_config text[];
  v_after_config text[];
begin
  select pg_get_functiondef(p.oid), p.proacl, p.proowner, p.prosecdef, p.proconfig
    into v_def, v_previous_acl, v_previous_owner, v_previous_security, v_previous_config
  from pg_proc p
  where p.oid = v_signature::oid;

  if v_def is null then
    raise exception 'Migración FD-3 detenida: no existe la firma canónica de haiku_crear_reserva';
  end if;

  v_def := replace(v_def, E'\r\n', E'\n');

  if not v_previous_security then
    raise exception 'Migración FD-3 detenida: haiku_crear_reserva debe conservar SECURITY DEFINER';
  end if;

  if not exists (
    select 1
    from unnest(coalesce(v_previous_config, array[]::text[])) as config(setting)
    where setting like 'search_path=%'
      and setting like '%pg_catalog%'
      and setting like '%public%'
      and setting like '%private%'
  ) then
    raise exception 'Migración FD-3 detenida: search_path efectivo inesperado';
  end if;

  if position($accommodation$
        if v_precio_base is null then
          raise exception 'Falta tarifa para la noche % y la CAB no tiene precio base', v_fecha;
        end if;
        v_tarifa := v_precio_base;
$accommodation$ in v_def) = 0 then
    raise exception 'Migración FD-3 detenida: no se encontró el fallback vigente de alojamiento';
  end if;

  v_after := replace(
    v_def,
$old$
    if v_tarifa_text is null or btrim(v_tarifa_text) = '' then
      if v_precio_base is null then
        raise exception 'Falta tarifa para el Full Day y la CAB no tiene precio base';
      end if;
      v_tarifa := v_precio_base;
    else
$old$,
$new$
    if v_tarifa_text is null or btrim(v_tarifa_text) = '' then
      if greatest(coalesce(p_ninos, 0), 0) > 0 then
        raise exception 'No hay una regla automática definida para la tarifa Full Day con niños. Ingresa la tarifa manualmente.';
      end if;
      raise exception 'Falta tarifa explícita para el Full Day. Ingresa una tarifa válida.';
    else
$new$
  );

  if v_after = v_def then
    raise exception 'Migración FD-3 detenida: no se encontró el fallback Full Day esperado';
  end if;

  if position('Falta tarifa para el Full Day y la CAB no tiene precio base' in v_after) > 0
     or position('Falta tarifa explícita para el Full Day. Ingresa una tarifa válida.' in v_after) = 0 then
    raise exception 'Migración FD-3 detenida: la postcondición de tarifa Full Day no se cumplió';
  end if;

  execute v_after;

  select pg_get_functiondef(p.oid), p.proacl, p.proowner, p.prosecdef, p.proconfig
    into v_after, v_after_acl, v_after_owner, v_after_security, v_after_config
  from pg_proc p
  where p.oid = v_signature::oid;

  if v_after_owner is distinct from v_previous_owner
     or v_after_acl is distinct from v_previous_acl
     or v_after_security is distinct from v_previous_security
     or v_after_config is distinct from v_previous_config then
    raise exception 'Migración FD-3 detenida: owner, permisos o configuración de seguridad cambiaron';
  end if;

  if position('Falta tarifa explícita para el Full Day. Ingresa una tarifa válida.' in v_after) = 0 then
    raise exception 'Migración FD-3 detenida: la definición final no contiene la validación esperada';
  end if;
end
$migration$;

comment on function public.haiku_crear_reserva(
  text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb,text,text
) is 'Crea alojamiento o Full Day. Desde FD-3, Full Day exige tarifa explícita y alojamiento conserva el fallback a precio_base.';

commit;
