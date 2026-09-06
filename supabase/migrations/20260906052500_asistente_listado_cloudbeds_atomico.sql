-- HAKU · LISTADO DE RESERVAS CLOUDBEDS
-- Crea de 1 a 11 reservas a partir de la tabla de Cloudbeds.
-- Este flujo NO acepta pagos: Precio Total es sólo el cargo de alojamiento.
-- Admite Alojamiento y Full Day en un mismo lote y conserva ID Cloudbeds.

create or replace function public.haiku_crear_lote_listado_cloudbeds_asistente(p_reservas jsonb)
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

  -- Validación cerrada antes de escribir nada.
  for v_item in select value from jsonb_array_elements(p_reservas)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada reserva del listado debe ser un objeto';
    end if;

    v_titular := nullif(btrim(coalesce(v_item ->> 'titular_nombre', '')), '');
    if v_titular is null then
      raise exception 'Cada reserva requiere titular';
    end if;

    v_cloudbeds_id := nullif(btrim(coalesce(v_item ->> 'cloudbeds_id', '')), '');
    if v_cloudbeds_id is null then
      raise exception 'Cada reserva del listado requiere ID Cloudbeds';
    end if;

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
      raise exception 'Full Day debe ingresar y salir el mismo día en Proyecto H';
    end if;

    v_tarifas := coalesce(v_item -> 'tarifas', '{}'::jsonb);
    if jsonb_typeof(v_tarifas) <> 'object' then
      raise exception 'Las tarifas de cada reserva deben enviarse como objeto';
    end if;

    v_estado := lower(btrim(coalesce(v_item ->> 'estado_reserva', '')));
    if v_estado not in ('pendiente', 'confirmada') then
      raise exception 'Estado Cloudbeds no admitido automáticamente: %', coalesce(v_item ->> 'estado_reserva', '');
    end if;
  end loop;

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
  where r.cloudbeds_id in (
    select nullif(btrim(value ->> 'cloudbeds_id'), '')
    from jsonb_array_elements(p_reservas)
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

  -- Todo el lote se ejecuta dentro de la misma transacción: si una falla,
  -- PostgreSQL revierte también las anteriores.
  for v_item in select value from jsonb_array_elements(p_reservas)
  loop
    v_indice := v_indice + 1;
    v_titular := btrim(v_item ->> 'titular_nombre');
    v_cloudbeds_id := btrim(v_item ->> 'cloudbeds_id');
    v_cabana := (v_item ->> 'cabana_numero')::smallint;
    v_fecha_ingreso := (v_item ->> 'fecha_ingreso')::date;
    v_fecha_salida := (v_item ->> 'fecha_salida')::date;
    v_tipo := lower(btrim(v_item ->> 'tipo_estadia'));
    v_estado := lower(btrim(v_item ->> 'estado_reserva'));
    v_tarifas := coalesce(v_item -> 'tarifas', '{}'::jsonb);

    v_resultado := public.haiku_crear_reserva(
      p_titular_nombre => v_titular,
      p_cabana_numero => v_cabana,
      p_fecha_ingreso => v_fecha_ingreso,
      p_fecha_salida => v_fecha_salida,
      p_adultos => 1,
      p_ninos => 0,
      p_mascotas => 0,
      p_correo_contacto => null,
      p_telefono_contacto => null,
      p_rut => null,
      p_observaciones => null,
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
        p_estado => 'confirmada',
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

revoke all on function public.haiku_crear_lote_listado_cloudbeds_asistente(jsonb) from public;
revoke all on function public.haiku_crear_lote_listado_cloudbeds_asistente(jsonb) from anon;
grant execute on function public.haiku_crear_lote_listado_cloudbeds_asistente(jsonb) to authenticated;