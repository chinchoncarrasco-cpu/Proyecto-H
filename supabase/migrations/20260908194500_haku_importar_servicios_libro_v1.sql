create or replace function public.haiku_importar_servicios_libro_v1(
  p_operacion_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_marca text;
  v_reserva_id uuid;
  v_estadia_id uuid;
  v_codigo text;
  v_fecha date;
  v_hora time;
  v_cantidad integer;
  v_personas smallint;
  v_tipo_cobro text;
  v_precio_manual bigint;
  v_motivo_cortesia text;
  v_observaciones text;
  v_resultado jsonb;
  v_servicio_id uuid;
  v_creados integer := 0;
  v_omitidos integer := 0;
  v_ids jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión';
  end if;

  if not private.haiku_usuario_activo() then
    raise exception 'Usuario no activo';
  end if;

  if not private.haiku_tiene_permiso('servicios.crear') then
    raise exception 'No tiene permiso para crear servicios';
  end if;

  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'La lista de servicios no es válida';
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'La operación debe contener entre 1 y 50 servicios';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(btrim(v_item->>'item_id'), '');
    if v_item_id is null or length(v_item_id) > 180 or v_item_id !~ '^[A-Za-z0-9:_\-.]+$' then
      raise exception 'Identificador de servicio del Libro no válido';
    end if;

    v_marca := '[HAKU-LIBRO-SERVICIO:' || v_item_id || ']';
    v_reserva_id := nullif(v_item->>'reserva_id', '')::uuid;
    v_estadia_id := nullif(v_item->>'estadia_id', '')::uuid;
    v_codigo := nullif(btrim(v_item->>'codigo_servicio'), '');
    v_fecha := nullif(v_item->>'fecha_servicio', '')::date;
    v_hora := nullif(v_item->>'hora', '')::time;
    v_cantidad := coalesce((v_item->>'cantidad')::integer, 1);
    v_personas := coalesce((v_item->>'personas')::smallint, 0);
    v_tipo_cobro := coalesce(nullif(btrim(v_item->>'tipo_cobro'), ''), 'normal');
    v_precio_manual := nullif(v_item->>'precio_manual', '')::bigint;
    v_motivo_cortesia := nullif(btrim(v_item->>'motivo_cortesia'), '');
    v_observaciones := nullif(btrim(v_item->>'observaciones'), '');

    if v_reserva_id is null or v_estadia_id is null or v_codigo is null or v_fecha is null then
      raise exception 'Servicio del Libro incompleto: %', v_item_id;
    end if;

    if not exists (
      select 1
      from public.reserva_estadias re
      where re.id = v_estadia_id
        and re.reserva_id = v_reserva_id
        and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
    ) then
      raise exception 'La estadía destino cambió o ya no está disponible: %', v_item_id;
    end if;

    select s.id into v_servicio_id
    from public.servicios s
    where s.reserva_id = v_reserva_id
      and position(v_marca in coalesce(s.observaciones, '')) > 0
    limit 1;

    if v_servicio_id is not null then
      v_omitidos := v_omitidos + 1;
      v_ids := v_ids || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id,
        'servicio_id', v_servicio_id,
        'estado', 'ya_importado'
      ));
      v_servicio_id := null;
      continue;
    end if;

    v_resultado := public.haiku_registrar_servicio(
      p_reserva_id => v_reserva_id,
      p_codigo_servicio => v_codigo,
      p_fecha_servicio => v_fecha,
      p_hora => v_hora,
      p_cantidad => v_cantidad,
      p_personas => v_personas,
      p_tipo_cobro => v_tipo_cobro,
      p_precio_manual => v_precio_manual,
      p_motivo_cortesia => v_motivo_cortesia,
      p_observaciones => concat_ws(E'\n', v_observaciones, v_marca),
      p_estadia_id => v_estadia_id
    );

    v_servicio_id := nullif(v_resultado->>'servicio_id', '')::uuid;
    v_creados := v_creados + 1;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object(
      'item_id', v_item_id,
      'servicio_id', v_servicio_id,
      'estado', 'creado'
    ));
    v_servicio_id := null;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'operacion_id', p_operacion_id,
    'servicios_creados', v_creados,
    'omitidos', v_omitidos,
    'resultados', v_ids
  );
end;
$$;

comment on function public.haiku_importar_servicios_libro_v1(uuid, jsonb) is
'Importa en una sola transacción servicios del Libro ya validados por Haku. Cada item conserva una marca de origen para que los reintentos no dupliquen servicios.';

revoke all on function public.haiku_importar_servicios_libro_v1(uuid, jsonb) from public, anon;
grant execute on function public.haiku_importar_servicios_libro_v1(uuid, jsonb) to authenticated;
