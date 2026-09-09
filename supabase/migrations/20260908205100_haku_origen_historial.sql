-- Distingue las escrituras ejecutadas por Haku de las acciones manuales del usuario.
-- El usuario autenticado se conserva como quien autorizó la operación.

alter table public.eventos_auditoria
  drop constraint if exists eventos_auditoria_origen_valido;

alter table public.eventos_auditoria
  add constraint eventos_auditoria_origen_valido
  check (origen = any (array['usuario'::text,'sistema'::text,'importacion'::text,'cloudbeds'::text,'haku'::text]));

create or replace function public.haiku_auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_data jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_cambios jsonb := '[]'::jsonb;
  v_entidad_id uuid;
  v_reserva_id uuid;
  v_estadia_id uuid;
  v_cabana_id uuid;
  v_usuario_id uuid := auth.uid();
  v_accion text;
  v_tipo text;
  v_origen text;
  v_query text := lower(coalesce(current_query(), ''));
  v_contexto_haku text := nullif(current_setting('app.haiku_origen', true), '');
  v_operacion_id text := nullif(current_setting('app.haiku_operacion_id', true), '');
  v_es_haku boolean := false;
begin
  v_es_haku := v_contexto_haku = 'haku'
    or v_query ~ 'haiku_[a-z0-9_]*(asistente|libro)';

  if tg_op = 'UPDATE' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'campo', q.campo,
          'anterior', v_old -> q.campo,
          'nuevo', v_new -> q.campo
        ) order by q.campo
      ),
      '[]'::jsonb
    )
    into v_cambios
    from (
      select key as campo
      from jsonb_object_keys(v_old || v_new) as key
      where key <> 'actualizado_en'
        and (v_old -> key) is distinct from (v_new -> key)
    ) q;

    if v_cambios = '[]'::jsonb then
      return null;
    end if;
  end if;

  v_entidad_id := nullif(v_data ->> 'id', '')::uuid;

  if tg_table_name = 'reservas' then
    v_reserva_id := v_entidad_id;
  else
    v_reserva_id := nullif(v_data ->> 'reserva_id', '')::uuid;
  end if;

  if tg_table_name = 'reserva_estadias' then
    v_estadia_id := v_entidad_id;
    v_cabana_id := nullif(v_data ->> 'cabana_id', '')::uuid;
  else
    v_estadia_id := nullif(v_data ->> 'estadia_id', '')::uuid;
    v_cabana_id := nullif(v_data ->> 'cabana_id', '')::uuid;
  end if;

  if v_estadia_id is not null and (v_reserva_id is null or v_cabana_id is null) then
    select coalesce(v_reserva_id, re.reserva_id),
           coalesce(v_cabana_id, re.cabana_id)
      into v_reserva_id, v_cabana_id
    from public.reserva_estadias re
    where re.id = v_estadia_id;
  end if;

  if tg_op = 'INSERT' then
    v_accion := 'Registro creado';
    v_tipo := 'creacion';
  elsif tg_op = 'UPDATE' then
    v_accion := 'Registro actualizado';
    v_tipo := 'actualizacion';
  else
    v_accion := 'Registro eliminado';
    v_tipo := 'eliminacion';
  end if;

  if v_es_haku then
    v_origen := 'haku';
  elsif v_usuario_id is null then
    v_origen := 'sistema';
  else
    v_origen := 'usuario';
  end if;

  insert into public.eventos_auditoria (
    usuario_id,
    accion,
    tipo_evento,
    entidad_tipo,
    entidad_id,
    reserva_id,
    estadia_id,
    cabana_id,
    descripcion,
    cambios,
    datos_contexto,
    origen
  ) values (
    v_usuario_id,
    v_accion,
    v_tipo,
    tg_table_name,
    v_entidad_id,
    v_reserva_id,
    v_estadia_id,
    v_cabana_id,
    (case when v_es_haku then 'Haku · ' else '' end) ||
      case
        when tg_op = 'INSERT' then 'Creación en ' || tg_table_name
        when tg_op = 'UPDATE' then 'Actualización en ' || tg_table_name
        else 'Eliminación en ' || tg_table_name
      end,
    v_cambios,
    jsonb_strip_nulls(jsonb_build_object(
      'operacion_sql', tg_op,
      'ejecutor', case when v_es_haku then 'haku' else null end,
      'operacion_id', v_operacion_id
    )),
    v_origen
  );

  return null;
end;
$function$;

create or replace function public.haiku_importar_libro_operaciones_v2(
  p_operacion_id uuid,
  p_servicios jsonb default '[]'::jsonb,
  p_notas jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'private', 'pg_temp'
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
    raise exception 'Debe iniciar sesión';
  end if;

  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación';
  end if;

  perform set_config('app.haiku_origen', 'haku', true);
  perform set_config('app.haiku_operacion_id', p_operacion_id::text, true);

  if jsonb_typeof(v_servicios) <> 'array' or jsonb_typeof(v_notas) <> 'array' then
    raise exception 'La operación del Libro no es válida';
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
      raise exception 'Servicio del Libro sin reserva o fecha válida: %', coalesce(v_item->>'item_id', 'sin-id');
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
        raise exception 'No pude revalidar una estadía única para el servicio %; no se guardó nada.', coalesce(v_item->>'item_id', 'sin-id');
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
      raise exception 'Nota del Libro sin reserva o fecha válida: %', coalesce(v_item->>'item_id', 'sin-id');
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
        raise exception 'No pude revalidar una estadía única para la nota %; no se guardó nada.', coalesce(v_item->>'item_id', 'sin-id');
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

  insert into public.eventos_auditoria (
    usuario_id, accion, tipo_evento, entidad_tipo, descripcion,
    cambios, datos_contexto, origen
  ) values (
    auth.uid(),
    'Haku incorporó datos del Libro de Reserva',
    'haku',
    'haku',
    format(
      'Haku incorporó %s servicio%s y %s nota%s desde el Libro de Reserva',
      v_servicios_creados, case when v_servicios_creados = 1 then '' else 's' end,
      v_notas_creadas, case when v_notas_creadas = 1 then '' else 's' end
    ),
    '[]'::jsonb,
    jsonb_build_object(
      'operacion_id', p_operacion_id,
      'modulo', 'libro_reserva',
      'servicios_creados', v_servicios_creados,
      'notas_creadas', v_notas_creadas,
      'servicios_omitidos', v_servicios_omitidos,
      'notas_omitidas', v_notas_omitidas,
      'autorizado_por', auth.uid()
    ),
    'haku'
  );

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
