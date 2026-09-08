create or replace function public.haiku_importar_notas_libro_v1(
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
  v_tipo text;
  v_reserva_id uuid;
  v_estadia_id uuid;
  v_fecha date;
  v_texto text;
  v_importante boolean;
  v_nota_id uuid;
  v_creadas integer := 0;
  v_omitidas integer := 0;
  v_resultados jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión';
  end if;

  if not private.haiku_usuario_activo() then
    raise exception 'Usuario no activo';
  end if;

  if not private.haiku_tiene_permiso('notas.gestionar') then
    raise exception 'No tiene permiso para gestionar notas';
  end if;

  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'La lista de notas no es válida';
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'La operación debe contener entre 1 y 100 notas';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(btrim(v_item->>'item_id'), '');
    if v_item_id is null or length(v_item_id) > 160 or v_item_id !~ '^[A-Za-z0-9:_\-.]+$' then
      raise exception 'Identificador de nota del Libro no válido';
    end if;

    v_tipo := 'libro_reserva:' || v_item_id;
    v_reserva_id := nullif(v_item->>'reserva_id', '')::uuid;
    v_estadia_id := nullif(v_item->>'estadia_id', '')::uuid;
    v_fecha := nullif(v_item->>'fecha_operacion', '')::date;
    v_texto := nullif(btrim(v_item->>'texto'), '');
    v_importante := coalesce((v_item->>'importante')::boolean, true);

    if v_reserva_id is null or v_texto is null then
      raise exception 'Nota del Libro incompleta: %', v_item_id;
    end if;

    if not exists (
      select 1 from public.reservas r
      where r.id = v_reserva_id
        and coalesce(r.estado_reserva, '') not in ('cancelada', 'no_show')
    ) then
      raise exception 'La reserva destino cambió o ya no está disponible: %', v_item_id;
    end if;

    if v_estadia_id is not null and not exists (
      select 1 from public.reserva_estadias re
      where re.id = v_estadia_id
        and re.reserva_id = v_reserva_id
        and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
    ) then
      raise exception 'La estadía destino cambió o ya no está disponible: %', v_item_id;
    end if;

    select n.id into v_nota_id
    from public.notas n
    where n.reserva_id = v_reserva_id
      and n.tipo = v_tipo
    limit 1;

    if v_nota_id is not null then
      v_omitidas := v_omitidas + 1;
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id,
        'nota_id', v_nota_id,
        'estado', 'ya_importada'
      ));
      v_nota_id := null;
      continue;
    end if;

    insert into public.notas (
      reserva_id,
      estadia_id,
      fecha_operacion,
      tipo,
      texto,
      importante,
      creado_por
    ) values (
      v_reserva_id,
      v_estadia_id,
      v_fecha,
      v_tipo,
      v_texto,
      v_importante,
      auth.uid()
    )
    returning id into v_nota_id;

    v_creadas := v_creadas + 1;
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'item_id', v_item_id,
      'nota_id', v_nota_id,
      'estado', 'creada'
    ));
    v_nota_id := null;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'operacion_id', p_operacion_id,
    'notas_creadas', v_creadas,
    'omitidas', v_omitidas,
    'resultados', v_resultados
  );
end;
$$;

comment on function public.haiku_importar_notas_libro_v1(uuid, jsonb) is
'Importa notas operativas del Libro ya validadas por Haku. Usa tipo libro_reserva:<item_id> para que reintentos no dupliquen notas.';

revoke all on function public.haiku_importar_notas_libro_v1(uuid, jsonb) from public, anon;
grant execute on function public.haiku_importar_notas_libro_v1(uuid, jsonb) to authenticated;

create or replace function public.haiku_importar_libro_operaciones_v2(
  p_operacion_id uuid,
  p_servicios jsonb default '[]'::jsonb,
  p_notas jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_servicios jsonb := coalesce(p_servicios, '[]'::jsonb);
  v_notas jsonb := coalesce(p_notas, '[]'::jsonb);
  v_res_servicios jsonb := jsonb_build_object('ok', true, 'servicios_creados', 0, 'omitidos', 0, 'resultados', '[]'::jsonb);
  v_res_notas jsonb := jsonb_build_object('ok', true, 'notas_creadas', 0, 'omitidas', 0, 'resultados', '[]'::jsonb);
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión';
  end if;

  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación';
  end if;

  if jsonb_typeof(v_servicios) <> 'array' or jsonb_typeof(v_notas) <> 'array' then
    raise exception 'La operación del Libro no es válida';
  end if;

  if jsonb_array_length(v_servicios) = 0 and jsonb_array_length(v_notas) = 0 then
    raise exception 'No hay servicios ni notas para incorporar';
  end if;

  if jsonb_array_length(v_servicios) > 0 then
    v_res_servicios := public.haiku_importar_servicios_libro_v1(p_operacion_id, v_servicios);
  end if;

  if jsonb_array_length(v_notas) > 0 then
    v_res_notas := public.haiku_importar_notas_libro_v1(p_operacion_id, v_notas);
  end if;

  return jsonb_build_object(
    'ok', true,
    'operacion_id', p_operacion_id,
    'servicios_creados', coalesce((v_res_servicios->>'servicios_creados')::integer, 0),
    'notas_creadas', coalesce((v_res_notas->>'notas_creadas')::integer, 0),
    'servicios_omitidos', coalesce((v_res_servicios->>'omitidos')::integer, 0),
    'notas_omitidas', coalesce((v_res_notas->>'omitidas')::integer, 0),
    'servicios', coalesce(v_res_servicios->'resultados', '[]'::jsonb),
    'notas', coalesce(v_res_notas->'resultados', '[]'::jsonb)
  );
end;
$$;

comment on function public.haiku_importar_libro_operaciones_v2(uuid, jsonb, jsonb) is
'Incorpora servicios y notas del Libro en una sola transacción. Si falla cualquier parte, no se guarda ninguna.';

revoke all on function public.haiku_importar_libro_operaciones_v2(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.haiku_importar_libro_operaciones_v2(uuid, jsonb, jsonb) to authenticated;