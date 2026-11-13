-- La validación bancaria sigue en el writer. La guardia Cloudbeds cambió su huella.
-- Actualiza sólo el anuncio de capacidad para las dos versiones del writer revisadas.
create or replace function public.haiku_libro_transferencias_capacidad_v2()
returns jsonb
language sql stable security invoker
set search_path = pg_catalog, public
as $function$
    with comprobacion as (
      select (
        select md5(replace(p.prosrc, chr(13), '')) in (
          'dee0c048c20f4e90819ed276f2c83636',
          '93dd21495da22d3ed1cda96a42f3d588'
        )
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'haiku_incorporar_libro_v1'
          and oidvectortypes(p.proargtypes) = 'uuid, jsonb'
      ) is true and (
        select md5(replace(p.prosrc, chr(13), '')) = '74968363d6a1a149989db66634b0dd12'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'haiku_libro_transferencia_validar_v2'
          and oidvectortypes(p.proargtypes) = 'uuid, jsonb, jsonb, boolean'
      ) is true as disponible
    )
    select jsonb_build_object('version', 2, 'confirmacion_final', disponible, 'glosa_sin_nombre', disponible)
    from comprobacion
$function$;

revoke execute on function public.haiku_libro_transferencias_capacidad_v2() from public, anon;
grant execute on function public.haiku_libro_transferencias_capacidad_v2() to authenticated;
