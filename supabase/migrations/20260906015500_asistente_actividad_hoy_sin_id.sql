-- HAKU · Actividad de hoy: permitir reservas SIN ID Cloudbeds sólo cuando
-- el elemento del lote no contiene pagos. El flujo con pagos conserva la
-- exigencia de ID Cloudbeds para mantener la protección anti-duplicados.

create or replace function public.haiku_crear_lote_reservas_asistente(p_reservas jsonb)
returns jsonb
language plpgsql
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_item jsonb;
  v_pagos jsonb;
  v_resultado jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_indice integer := 0;
  v_total_pagos integer := 0;
  v_cantidad integer := 0;
  v_titular text;
  v_cloudbeds_id text;
  v_cabana smallint;
  v_fecha_ingreso date;
  v_fecha_salida date;
  v_adultos smallint;
  v_ninos smallint;
  v_mascotas smallint;
  v_correo text;
  v_telefono text;
  v_observaciones text;
  v_tarifas jsonb;
  v_acompanantes jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para crear reservas';
  end if;

  if not private.haiku_tiene_permiso('reservas.crear') then
    raise exception 'Tu usuario no tiene permiso para crear reservas';
  end if;

  if jsonb_typeof(coalesce(p_reservas, '[]'::jsonb)) <> 'array' then
    raise exception 'El lote de reservas debe enviarse como arreglo';
  end if;

  v_cantidad := jsonb_array_length(coalesce(p_reservas, '[]'::jsonb));
  if v_cantidad < 2 then
    raise exception 'El modo lote requiere al menos 2 reservas';
  end if;
  if v_cantidad > 11 then
    raise exception 'Se admiten como máximo 11 reservas por lote';
  end if;

  for v_item in select value from jsonb_array_elements(p_reservas)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada reserva del lote debe ser un objeto';
    end if;

    v_titular := nullif(btrim(coalesce(v_item ->> 'titular_nombre', '')), '');
    if v_titular is null then
      raise exception 'Cada reserva del lote requiere titular';
    end if;

    if coalesce(v_item ->> 'cabana_numero', '') !~ '^[0-9]+$' then
      raise exception 'Cada reserva del lote requiere una cabaña válida';
    end if;
    v_cabana := (v_item ->> 'cabana_numero')::smallint;
    if v_cabana < 1 or v_cabana > 99 then
      raise exception 'Cabaña fuera de rango en el lote';
    end if;

    begin
      v_fecha_ingreso := nullif(v_item ->> 'fecha_ingreso', '')::date;
      v_fecha_salida := nullif(v_item ->> 'fecha_salida', '')::date;
    exception when others then
      raise exception 'Cada reserva del lote requiere fechas válidas';
    end;
    if v_fecha_ingreso is null or v_fecha_salida is null or v_fecha_salida <= v_fecha_ingreso then
      raise exception 'Cada reserva del lote requiere un rango de fechas válido';
    end if;

    v_pagos := coalesce(v_item -> 'pagos', '[]'::jsonb);
    if jsonb_typeof(v_pagos) <> 'array' then
      raise exception 'Los pagos de cada reserva deben enviarse como arreglo';
    end if;
    if jsonb_array_length(v_pagos) > 10 then
      raise exception 'Se admiten como máximo 10 abonos por reserva';
    end if;
    v_total_pagos := v_total_pagos + jsonb_array_length(v_pagos);

    v_cloudbeds_id := nullif(btrim(coalesce(v_item ->> 'cloudbeds_id', '')), '');
    if v_cloudbeds_id is null and jsonb_array_length(v_pagos) > 0 then
      raise exception 'Las reservas del lote con pagos requieren ID Cloudbeds';
    end if;

    if jsonb_typeof(coalesce(v_item -> 'acompanantes', '[]'::jsonb)) <> 'array' then
      raise exception 'Los acompañantes de cada reserva deben enviarse como arreglo';
    end if;
    if jsonb_typeof(coalesce(v_item -> 'tarifas', '{}'::jsonb)) <> 'object' then
      raise exception 'Las tarifas de cada reserva deben enviarse como objeto';
    end if;
  end loop;

  if v_total_pagos > 0 then
    if not private.haiku_tiene_permiso('pagos.registrar') then
      raise exception 'Tu usuario no tiene permiso para registrar pagos';
    end if;
    if not private.haiku_tiene_permiso('pagos.verificar') then
      raise exception 'Tu usuario no tiene permiso para verificar pagos';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_reservas)
  loop
    v_indice := v_indice + 1;
    v_titular := btrim(v_item ->> 'titular_nombre');
    v_cabana := (v_item ->> 'cabana_numero')::smallint;
    v_fecha_ingreso := (v_item ->> 'fecha_ingreso')::date;
    v_fecha_salida := (v_item ->> 'fecha_salida')::date;
    v_adultos := greatest(0, coalesce(nullif(v_item ->> 'adultos', '')::smallint, 1));
    v_ninos := greatest(0, coalesce(nullif(v_item ->> 'ninos', '')::smallint, 0));
    v_mascotas := greatest(0, coalesce(nullif(v_item ->> 'mascotas', '')::smallint, 0));
    v_correo := nullif(btrim(coalesce(v_item ->> 'correo_contacto', '')), '');
    v_telefono := nullif(btrim(coalesce(v_item ->> 'telefono_contacto', '')), '');
    v_observaciones := nullif(btrim(coalesce(v_item ->> 'observaciones', '')), '');
    v_cloudbeds_id := nullif(btrim(coalesce(v_item ->> 'cloudbeds_id', '')), '');
    v_tarifas := coalesce(v_item -> 'tarifas', '{}'::jsonb);
    v_acompanantes := coalesce(v_item -> 'acompanantes', '[]'::jsonb);
    v_pagos := coalesce(v_item -> 'pagos', '[]'::jsonb);

    if jsonb_array_length(v_pagos) > 0 then
      v_resultado := public.haiku_crear_reserva_con_abonos(
        p_titular_nombre => v_titular,
        p_cabana_numero => v_cabana,
        p_fecha_ingreso => v_fecha_ingreso,
        p_fecha_salida => v_fecha_salida,
        p_adultos => v_adultos,
        p_ninos => v_ninos,
        p_mascotas => v_mascotas,
        p_correo_contacto => v_correo,
        p_telefono_contacto => v_telefono,
        p_observaciones => v_observaciones,
        p_tarifas => v_tarifas,
        p_acompanantes => v_acompanantes,
        p_cloudbeds_id => v_cloudbeds_id,
        p_pagos => v_pagos
      );
    else
      v_resultado := public.haiku_crear_reserva(
        p_titular_nombre => v_titular,
        p_cabana_numero => v_cabana,
        p_fecha_ingreso => v_fecha_ingreso,
        p_fecha_salida => v_fecha_salida,
        p_adultos => v_adultos,
        p_ninos => v_ninos,
        p_mascotas => v_mascotas,
        p_correo_contacto => v_correo,
        p_telefono_contacto => v_telefono,
        p_rut => null,
        p_observaciones => v_observaciones,
        p_tarifas => v_tarifas,
        p_acompanantes => v_acompanantes,
        p_tipo_estadia => 'alojamiento',
        p_cloudbeds_id => v_cloudbeds_id
      );
    end if;

    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'indice', v_indice,
      'titular_nombre', v_titular,
      'cabana_numero', v_cabana,
      'cloudbeds_id', v_cloudbeds_id,
      'cantidad_pagos', jsonb_array_length(v_pagos),
      'resultado', v_resultado
    ));
  end loop;

  return jsonb_build_object(
    'cantidad_reservas', v_cantidad,
    'cantidad_pagos', v_total_pagos,
    'resultados', v_resultados
  );
end;
$function$;