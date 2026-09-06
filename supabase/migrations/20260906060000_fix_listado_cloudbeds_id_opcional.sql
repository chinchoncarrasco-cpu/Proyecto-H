-- HAKU · FIX LISTADO CLOUDBEDS V2
-- El ID Cloudbeds deja de ser requisito. Si está visible se conserva y protege
-- contra duplicados; si no está visible, la reserva puede crearse igualmente.
-- El flujo sigue registrando 0 pagos.

create or replace function public.haiku_crear_lote_listado_cloudbeds_asistente_v2(p_reservas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_item jsonb;
  v_resultado jsonb;
  v_estado_resultado jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_indice integer := 0;
  v_cantidad integer := 0;
  v_titular text;
  v_cloudbeds_id text;
  v_cabana smallint;
  v_fecha_ingreso date;
  v_fecha_salida date;
  v_tipo text;
  v_estado text;
  v_tarifas jsonb;
  v_estadia_id uuid;
  v_ids_existentes text;
  v_adultos smallint;
  v_ninos smallint;
  v_correo text;
  v_telefono text;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para crear reservas';
  end if;

  if not private.haiku_tiene_permiso('reservas.crear') then
    raise exception 'Tu usuario no tiene permiso para crear reservas' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_reservas, '[]'::jsonb)) <> 'array' then
    raise exception 'El listado de reservas debe enviarse como arreglo';
  end if;

  v_cantidad := jsonb_array_length(coalesce(p_reservas, '[]'::jsonb));
  if v_cantidad < 1 then
    raise exception 'El listado no contiene reservas';
  end if;
  if v_cantidad > 11 then
    raise exception 'Se admiten como máximo 11 reservas por lote';
  end if;

  -- Validación completa antes de escribir nada. La transacción es atómica.
  for v_item in select value from jsonb_array_elements(p_reservas)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada reserva del listado debe ser un objeto';
    end if;

    v_titular := nullif(btrim(coalesce(v_item ->> 'titular_nombre', '')), '');
    if v_titular is null then
      raise exception 'Cada reserva requiere titular';
    end if;

    -- ID Cloudbeds OPCIONAL. Cuando existe, se valida más abajo contra duplicados.
    v_cloudbeds_id := nullif(btrim(coalesce(v_item ->> 'cloudbeds_id', '')), '');

    if coalesce(v_item ->> 'cabana_numero', '') !~ '^[0-9]+$' then
      raise exception 'Cada reserva requiere una cabaña válida';
    end if;
    v_cabana := (v_item ->> 'cabana_numero')::smallint;
    if v_cabana < 1 or v_cabana > 11 then
      raise exception 'Cabaña fuera de rango en el listado: %', v_cabana;
    end if;

    v_tipo := lower(btrim(coalesce(v_item ->> 'tipo_estadia', '')));
    if v_tipo not in ('alojamiento', 'fullday') then
      raise exception 'Tipo de estadía inválido en el listado';
    end if;

    begin
      v_fecha_ingreso := nullif(v_item ->> 'fecha_ingreso', '')::date;
      v_fecha_salida := nullif(v_item ->> 'fecha_salida', '')::date;
    exception when others then
      raise exception 'Cada reserva requiere fechas válidas';
    end;

    if v_fecha_ingreso is null or v_fecha_salida is null then
      raise exception 'Cada reserva requiere fechas válidas';
    end if;
    if v_tipo = 'alojamiento' and v_fecha_salida <= v_fecha_ingreso then
      raise exception 'Alojamiento requiere salida posterior al ingreso';
    end if;
    if v_tipo = 'fullday' and v_fecha_salida <> v_fecha_ingreso then
      raise exception 'Full Day requiere ingreso y salida el mismo día';
    end if;

    v_tarifas := coalesce(v_item -> 'tarifas', '{}'::jsonb);
    if jsonb_typeof(v_tarifas) <> 'object' then
      raise exception 'Las tarifas de cada reserva deben enviarse como objeto';
    end if;

    v_estado := lower(btrim(coalesce(v_item ->> 'estado_reserva', '')));
    if v_estado not in ('pendiente', 'confirmada') then
      raise exception 'Estado Cloudbeds no admitido automáticamente: %', coalesce(v_item ->> 'estado_reserva', '');
    end if;

    if coalesce(v_item ->> 'adultos', '') <> '' and coalesce(v_item ->> 'adultos', '') !~ '^[0-9]+$' then
      raise exception 'Adultos inválido en una reserva del listado';
    end if;
    if coalesce(v_item ->> 'ninos', '') <> '' and coalesce(v_item ->> 'ninos', '') !~ '^[0-9]+$' then
      raise exception 'Niños inválido en una reserva del listado';
    end if;
  end loop;

  -- Sólo los IDs realmente presentes participan en la protección anti-duplicados.
  if exists (
    select 1
    from (
      select nullif(btrim(value ->> 'cloudbeds_id'), '') as cloudbeds_id, count(*)
      from jsonb_array_elements(p_reservas)
      group by 1
      having count(*) > 1
    ) d
    where d.cloudbeds_id is not null
  ) then
    raise exception 'El listado contiene un ID Cloudbeds repetido';
  end if;

  select string_agg(r.cloudbeds_id, ', ' order by r.cloudbeds_id)
    into v_ids_existentes
  from public.reservas r
  where r.cloudbeds_id is not null
    and r.cloudbeds_id in (
      select nullif(btrim(value ->> 'cloudbeds_id'), '')
      from jsonb_array_elements(p_reservas)
      where nullif(btrim(value ->> 'cloudbeds_id'), '') is not null
    );

  if v_ids_existentes is not null then
    raise exception 'Ya existe en Proyecto H una reserva con ID Cloudbeds: %', v_ids_existentes;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_reservas) x
    where lower(btrim(coalesce(x ->> 'estado_reserva', ''))) = 'confirmada'
  ) and not private.haiku_tiene_permiso('reservas.editar') then
    raise exception 'Tu usuario necesita permiso para confirmar reservas importadas' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_reservas)
  loop
    v_indice := v_indice + 1;
    v_titular := btrim(v_item ->> 'titular_nombre');
    v_cloudbeds_id := nullif(btrim(coalesce(v_item ->> 'cloudbeds_id', '')), '');
    v_cabana := (v_item ->> 'cabana_numero')::smallint;
    v_fecha_ingreso := (v_item ->> 'fecha_ingreso')::date;
    v_fecha_salida := (v_item ->> 'fecha_salida')::date;
    v_tipo := lower(btrim(v_item ->> 'tipo_estadia'));
    v_estado := lower(btrim(v_item ->> 'estado_reserva'));
    v_tarifas := coalesce(v_item -> 'tarifas', '{}'::jsonb);
    v_adultos := greatest(0, coalesce(nullif(v_item ->> 'adultos', '')::smallint, 1::smallint));
    v_ninos := greatest(0, coalesce(nullif(v_item ->> 'ninos', '')::smallint, 0::smallint));
    v_correo := nullif(btrim(coalesce(v_item ->> 'correo_contacto', '')), '');
    v_telefono := nullif(btrim(coalesce(v_item ->> 'telefono_contacto', '')), '');

    v_resultado := public.haiku_crear_reserva(
      p_titular_nombre => v_titular,
      p_cabana_numero => v_cabana,
      p_fecha_ingreso => v_fecha_ingreso,
      p_fecha_salida => v_fecha_salida,
      p_adultos => v_adultos,
      p_ninos => v_ninos,
      p_mascotas => 0::smallint,
      p_correo_contacto => v_correo,
      p_telefono_contacto => v_telefono,
      p_rut => null::text,
      p_observaciones => null::text,
      p_tarifas => v_tarifas,
      p_acompanantes => '[]'::jsonb,
      p_tipo_estadia => v_tipo,
      p_cloudbeds_id => v_cloudbeds_id
    );

    v_estadia_id := nullif(v_resultado ->> 'estadia_id', '')::uuid;
    v_estado_resultado := null;

    if v_estado = 'confirmada' then
      v_estado_resultado := public.haiku_cambiar_estado_estadia(
        p_estadia_id => v_estadia_id,
        p_estado => 'confirmada'::text,
        p_hora => now()
      );
    end if;

    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'indice', v_indice,
      'titular_nombre', v_titular,
      'cabana_numero', v_cabana,
      'cloudbeds_id', v_cloudbeds_id,
      'tipo_estadia', v_tipo,
      'estado_solicitado', v_estado,
      'adultos', v_adultos,
      'ninos', v_ninos,
      'cantidad_pagos', 0,
      'resultado', v_resultado,
      'estado_resultado', v_estado_resultado
    ));
  end loop;

  return jsonb_build_object(
    'cantidad_reservas', v_cantidad,
    'cantidad_pagos', 0,
    'resultados', v_resultados
  );
end;
$function$;

revoke all on function public.haiku_crear_lote_listado_cloudbeds_asistente_v2(jsonb) from public;
revoke all on function public.haiku_crear_lote_listado_cloudbeds_asistente_v2(jsonb) from anon;
grant execute on function public.haiku_crear_lote_listado_cloudbeds_asistente_v2(jsonb) to authenticated;