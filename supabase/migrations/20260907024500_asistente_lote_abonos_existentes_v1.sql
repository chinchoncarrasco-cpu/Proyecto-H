-- HAIKU · cierre nocturno · pagos sobre reservas existentes V1
-- Registra varias reservas con uno o más abonos en una sola transacción.
-- Reutiliza la función oficial por reserva para conservar validaciones,
-- anti-duplicados, permisos, aplicación a alojamiento y verificación.

create or replace function public.haiku_registrar_lote_abonos_reservas_existentes_asistente(
  p_operaciones jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_item jsonb;
  v_reserva_id uuid;
  v_pagos jsonb;
  v_resultado jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_cantidad_reservas integer := 0;
  v_cantidad_pagos integer := 0;
  v_indice integer := 0;
  v_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para registrar pagos';
  end if;

  if not private.haiku_tiene_permiso('pagos.registrar') then
    raise exception 'Tu usuario no tiene permiso para registrar pagos' using errcode = '42501';
  end if;

  if not private.haiku_tiene_permiso('pagos.verificar') then
    raise exception 'Tu usuario no tiene permiso para verificar pagos' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_operaciones, '[]'::jsonb)) <> 'array' then
    raise exception 'El lote de pagos debe enviarse como arreglo';
  end if;

  v_cantidad_reservas := jsonb_array_length(coalesce(p_operaciones, '[]'::jsonb));
  if v_cantidad_reservas < 1 then
    raise exception 'Debe existir al menos una reserva destino';
  end if;
  if v_cantidad_reservas > 11 then
    raise exception 'Se admiten como máximo 11 reservas por lote';
  end if;

  -- Primera pasada: validar TODO antes de escribir nada.
  for v_item in select value from jsonb_array_elements(p_operaciones)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada operación del lote debe ser un objeto';
    end if;

    begin
      v_reserva_id := nullif(btrim(coalesce(v_item ->> 'reserva_id', '')), '')::uuid;
    exception when others then
      raise exception 'Cada operación requiere una reserva válida';
    end;
    if v_reserva_id is null then
      raise exception 'Cada operación requiere una reserva válida';
    end if;

    if v_reserva_id = any(v_ids) then
      raise exception 'Una reserva no puede repetirse dentro del mismo lote';
    end if;
    v_ids := array_append(v_ids, v_reserva_id);

    if not exists (select 1 from public.reservas where id = v_reserva_id) then
      raise exception 'Una de las reservas seleccionadas ya no existe';
    end if;

    v_pagos := coalesce(v_item -> 'pagos', '[]'::jsonb);
    if jsonb_typeof(v_pagos) <> 'array' then
      raise exception 'Los pagos de cada reserva deben enviarse como arreglo';
    end if;
    if jsonb_array_length(v_pagos) < 1 then
      raise exception 'Cada reserva del lote requiere al menos un abono';
    end if;
    if jsonb_array_length(v_pagos) > 10 then
      raise exception 'Se admiten como máximo 10 abonos por reserva';
    end if;

    v_cantidad_pagos := v_cantidad_pagos + jsonb_array_length(v_pagos);
    if v_cantidad_pagos > 50 then
      raise exception 'Se admiten como máximo 50 abonos por lote';
    end if;
  end loop;

  -- Segunda pasada: cada llamada conserva todas las validaciones oficiales.
  -- Si una falla, PostgreSQL revierte automáticamente el lote completo.
  for v_item in select value from jsonb_array_elements(p_operaciones)
  loop
    v_indice := v_indice + 1;
    v_reserva_id := (v_item ->> 'reserva_id')::uuid;
    v_pagos := v_item -> 'pagos';

    v_resultado := public.haiku_registrar_abonos_reserva_existente_asistente(
      p_reserva_id => v_reserva_id,
      p_pagos => v_pagos
    );

    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'indice', v_indice,
      'reserva_id', v_reserva_id,
      'cantidad_pagos', jsonb_array_length(v_pagos),
      'resultado', v_resultado
    ));
  end loop;

  return jsonb_build_object(
    'cantidad_reservas', v_cantidad_reservas,
    'cantidad_pagos', v_cantidad_pagos,
    'resultados', v_resultados
  );
end;
$function$;

revoke all on function public.haiku_registrar_lote_abonos_reservas_existentes_asistente(jsonb) from public;
revoke all on function public.haiku_registrar_lote_abonos_reservas_existentes_asistente(jsonb) from anon;
grant execute on function public.haiku_registrar_lote_abonos_reservas_existentes_asistente(jsonb) to authenticated;