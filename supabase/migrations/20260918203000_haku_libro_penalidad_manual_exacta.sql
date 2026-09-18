-- Permite que el operador clasifique la tercera parte de un comprobante grupal
-- como la penalidad 10% ya existente, aunque el texto del Libro no la nombre.
-- La aceptación sigue cerrada por el servidor: una sola operación de ajuste
-- activa al 10%, importe exacto, saldo grupal exacto y comprobante completo.
do $migration$
declare
  cuerpo text := replace(pg_get_functiondef('private.haiku_libro_pago_grupo_distribuido_v1(uuid,jsonb,jsonb,boolean)'::regprocedure),E'\r','');
  anterior text := E'         or lower(parte->>''texto_original'') not like ''%penalidad%'' then';
  nuevo text := E'         or (coalesce(parte->>''clasificacion_manual_penalidad'',''false'')::boolean is distinct from true\n             and lower(parte->>''texto_original'') not like ''%penalidad%'') then';
begin
  if position(nuevo in cuerpo)>0 then return; end if;
  if position(anterior in cuerpo)=0 then
    raise exception 'La validación de penalidad grupal cambió; revisar antes de aplicar';
  end if;
  execute replace(cuerpo,anterior,nuevo);
end;
$migration$;

create or replace function public.haiku_libro_distribucion_capacidad_v1()
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $function$
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  return jsonb_build_object('version',4,'modos',jsonb_build_array(
    'estadia_partes','grupo_alojamiento','grupo_alojamiento_penalidad',
    'grupo_alojamiento_penalidad_manual'));
end;
$function$;
revoke all on function public.haiku_libro_distribucion_capacidad_v1() from public,anon;
grant execute on function public.haiku_libro_distribucion_capacidad_v1() to authenticated;
