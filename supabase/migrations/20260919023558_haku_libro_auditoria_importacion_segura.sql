-- Haku · auditoria segura para la incorporacion atomica del Libro.
-- Servicios ya usa el trigger oficial. Las notas operativas del Libro se
-- incorporan al mismo mecanismo, que registra el operacion_id configurado por
-- el wrapper sin conceder escritura directa sobre eventos_auditoria.

drop trigger if exists auditoria_notas_libro on public.notas;
create trigger auditoria_notas_libro
after insert on public.notas
for each row
when (new.tipo = 'operativa_resumen')
execute function public.haiku_auditar_cambio();

create or replace function public.haiku_importar_libro_operaciones_v2(
  p_operacion_id uuid,
  p_servicios jsonb default '[]'::jsonb,
  p_notas jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $function$
declare
  v_servicios jsonb := coalesce(p_servicios, '[]'::jsonb);
  v_notas jsonb := coalesce(p_notas, '[]'::jsonb);
  v_servicios_ok jsonb := '[]'::jsonb;
  v_notas_ok jsonb := '[]'::jsonb;
  v_item jsonb;
  v_reserva_id uuid;
  v_estadia_id uuid;
  v_fecha date;
  v_candidatas uuid[];
  v_res_servicios jsonb := jsonb_build_object('ok', true, 'servicios_creados', 0, 'omitidos', 0, 'resultados', '[]'::jsonb);
  v_res_notas jsonb := jsonb_build_object('ok', true, 'notas_creadas', 0, 'omitidas', 0, 'resultados', '[]'::jsonb);
  v_servicios_creados integer := 0;
  v_notas_creadas integer := 0;
  v_servicios_omitidos integer := 0;
  v_notas_omitidas integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesion';
  end if;

  if p_operacion_id is null then
    raise exception 'Falta el identificador de operacion';
  end if;

  perform set_config('app.haiku_origen', 'haku', true);
  perform set_config('app.haiku_operacion_id', p_operacion_id::text, true);

  if jsonb_typeof(v_servicios) <> 'array' or jsonb_typeof(v_notas) <> 'array' then
    raise exception 'La operacion del Libro no es valida';
  end if;

  if jsonb_array_length(v_servicios) = 0 and jsonb_array_length(v_notas) = 0 then
    raise exception 'No hay servicios ni notas para incorporar';
  end if;

  for v_item in select value from jsonb_array_elements(v_servicios)
  loop
    v_reserva_id := nullif(v_item->>'reserva_id', '')::uuid;
    v_estadia_id := nullif(v_item->>'estadia_id', '')::uuid;
    v_fecha := nullif(v_item->>'fecha_servicio', '')::date;

    if v_reserva_id is null or v_fecha is null then
      raise exception 'Servicio del Libro sin reserva o fecha valida: %', coalesce(v_item->>'item_id', 'sin-id');
    end if;

    if v_estadia_id is null or not exists (
      select 1
      from public.reserva_estadias re
      where re.id = v_estadia_id
        and re.reserva_id = v_reserva_id
        and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
    ) then
      select array_agg(re.id order by re.fecha_ingreso, re.id)
      into v_candidatas
      from public.reserva_estadias re
      where re.reserva_id = v_reserva_id
        and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
        and re.fecha_ingreso <= v_fecha
        and re.fecha_salida >= v_fecha;

      if coalesce(cardinality(v_candidatas), 0) <> 1 then
        raise exception 'No pude revalidar una estadia unica para el servicio %; no se guardo nada.', coalesce(v_item->>'item_id', 'sin-id');
      end if;

      v_estadia_id := v_candidatas[1];
      v_item := jsonb_set(v_item, '{estadia_id}', to_jsonb(v_estadia_id::text), true);
    end if;

    v_servicios_ok := v_servicios_ok || jsonb_build_array(v_item);
    v_candidatas := null;
  end loop;

  for v_item in select value from jsonb_array_elements(v_notas)
  loop
    v_reserva_id := nullif(v_item->>'reserva_id', '')::uuid;
    v_estadia_id := nullif(v_item->>'estadia_id', '')::uuid;
    v_fecha := nullif(v_item->>'fecha_operacion', '')::date;

    if v_reserva_id is null or v_fecha is null then
      raise exception 'Nota del Libro sin reserva o fecha valida: %', coalesce(v_item->>'item_id', 'sin-id');
    end if;

    if v_estadia_id is null or not exists (
      select 1
      from public.reserva_estadias re
      where re.id = v_estadia_id
        and re.reserva_id = v_reserva_id
        and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
    ) then
      select array_agg(re.id order by re.fecha_ingreso, re.id)
      into v_candidatas
      from public.reserva_estadias re
      where re.reserva_id = v_reserva_id
        and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
        and re.fecha_ingreso <= v_fecha
        and re.fecha_salida >= v_fecha;

      if coalesce(cardinality(v_candidatas), 0) <> 1 then
        raise exception 'No pude revalidar una estadia unica para la nota %; no se guardo nada.', coalesce(v_item->>'item_id', 'sin-id');
      end if;

      v_estadia_id := v_candidatas[1];
      v_item := jsonb_set(v_item, '{estadia_id}', to_jsonb(v_estadia_id::text), true);
    end if;

    v_notas_ok := v_notas_ok || jsonb_build_array(v_item);
    v_candidatas := null;
  end loop;

  if jsonb_array_length(v_servicios_ok) > 0 then
    v_res_servicios := public.haiku_importar_servicios_libro_v1(p_operacion_id, v_servicios_ok);
  end if;

  if jsonb_array_length(v_notas_ok) > 0 then
    v_res_notas := public.haiku_importar_notas_libro_v1(p_operacion_id, v_notas_ok);
  end if;

  v_servicios_creados := coalesce((v_res_servicios->>'servicios_creados')::integer, 0);
  v_notas_creadas := coalesce((v_res_notas->>'notas_creadas')::integer, 0);
  v_servicios_omitidos := coalesce((v_res_servicios->>'omitidos')::integer, 0);
  v_notas_omitidas := coalesce((v_res_notas->>'omitidas')::integer, 0);

  return jsonb_build_object(
    'ok', true,
    'operacion_id', p_operacion_id,
    'servicios_creados', v_servicios_creados,
    'notas_creadas', v_notas_creadas,
    'servicios_omitidos', v_servicios_omitidos,
    'notas_omitidas', v_notas_omitidas,
    'servicios', coalesce(v_res_servicios->'resultados', '[]'::jsonb),
    'notas', coalesce(v_res_notas->'resultados', '[]'::jsonb)
  );
end;
$function$;

comment on function public.haiku_importar_libro_operaciones_v2(uuid, jsonb, jsonb) is
'Revalida e incorpora servicios y notas del Libro en una transaccion atomica. Cada alta queda registrada por el trigger oficial de auditoria, agrupada mediante operacion_id.';

revoke all on function public.haiku_importar_libro_operaciones_v2(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.haiku_importar_libro_operaciones_v2(uuid, jsonb, jsonb)
  to authenticated;
