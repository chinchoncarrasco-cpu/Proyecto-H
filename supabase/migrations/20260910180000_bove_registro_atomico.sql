-- Preparada para revisión. NO aplicada a Proyecto H.
-- CREATE OR REPLACE conserva propietario y ACL; no cambia firmas ni permisos.
BEGIN;

-- No crear accidentalmente funciones nuevas con ACL por defecto en otra base.
DO $precondicion$
BEGIN
  IF to_regprocedure('public.haiku_registrar_bove_reserva(uuid,text)') IS NULL
     OR to_regprocedure('public.haiku_registrar_bove_checkout(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Se requieren las dos RPC BOVE existentes antes de aplicar esta migración';
  END IF;
END;
$precondicion$;

CREATE OR REPLACE FUNCTION public.haiku_registrar_bove_checkout(p_reserva_id uuid, p_bove text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_bove text := nullif(btrim(coalesce(p_bove,'')), '');
  v_saldo bigint;
  v_total bigint;
  v_actual public.reservas%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para registrar el BOVE';
  end if;

  if not private.haiku_tiene_permiso('pagos.verificar') then
    raise exception 'Tu usuario no tiene permiso para registrar el BOVE';
  end if;

  if v_bove is null then
    raise exception 'Ingresa el BOVE de los servicios';
  end if;

  select
    coalesce(sum(monto),0)::bigint,
    coalesce(sum(saldo_cargo),0)::bigint
  into v_total, v_saldo
  from public.vista_estado_cargos
  where reserva_id = p_reserva_id
    and tipo_cargo = 'servicio'
    and estado = 'activo';

  if v_total <= 0 then
    raise exception 'La reserva no tiene cargos de servicio';
  end if;

  if v_saldo <> 0 then
    raise exception 'El BOVE de Check-out sólo puede registrarse cuando los servicios están pagados al 100%%';
  end if;

  -- Serializa todos los intentos sobre esta reserva, incluidos botones manuales.
  select * into v_actual
    from public.reservas
    where id = p_reserva_id
    for update;

  if not found then
    raise exception 'No fue posible actualizar la reserva';
  end if;

  if nullif(btrim(coalesce(v_actual.bove_checkout, '')), '') is not null then
    if btrim(v_actual.bove_checkout) <> v_bove then
      raise exception 'BOVE ya registrado con un número diferente.';
    end if;

    -- Idempotencia: no UPDATE, conserva usuario, fecha y auditoría originales.
    return jsonb_build_object(
      'reserva_id', p_reserva_id,
      'bove_checkout', v_actual.bove_checkout,
      'registrado_por', v_actual.bove_checkout_registrado_por,
      'registrado_en', v_actual.bove_checkout_registrado_en,
      'total_servicios', v_total,
      'ya_registrado', true
    );
  end if;

  update public.reservas
     set bove_checkout = v_bove,
         bove_checkout_registrado_por = auth.uid(),
         bove_checkout_registrado_en = now(),
         actualizado_en = now()
   where id = p_reserva_id;

  if not found then
    raise exception 'No fue posible actualizar la reserva';
  end if;

  return jsonb_build_object(
    'reserva_id', p_reserva_id,
    'bove_checkout', v_bove,
    'registrado_por', auth.uid(),
    'registrado_en', now(),
    'total_servicios', v_total
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.haiku_registrar_bove_reserva(p_reserva_id uuid, p_bove text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_bove text := nullif(btrim(coalesce(p_bove,'')), '');
  v_saldo bigint;
  v_total bigint;
  v_actual public.reservas%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para registrar el BOVE';
  end if;

  if not private.haiku_tiene_permiso('pagos.verificar') then
    raise exception 'Tu usuario no tiene permiso para registrar el BOVE';
  end if;

  if v_bove is null then
    raise exception 'Ingresa el BOVE de la reserva';
  end if;

  select coalesce(saldo_alojamiento,0)::bigint,
         coalesce(total_alojamiento,0)::bigint
    into v_saldo, v_total
  from public.vista_saldos_alojamiento_reserva
  where reserva_id = p_reserva_id;

  if v_saldo is null then
    raise exception 'No se encontró la reserva';
  end if;

  if v_saldo <> 0 then
    raise exception 'El BOVE de alojamiento sólo puede registrarse cuando el alojamiento está pagado al 100%%';
  end if;

  -- Serializa todos los intentos sobre esta reserva, incluidos botones manuales.
  select * into v_actual
    from public.reservas
    where id = p_reserva_id
    for update;

  if not found then
    raise exception 'No fue posible actualizar la reserva';
  end if;

  if nullif(btrim(coalesce(v_actual.bove_cierre, '')), '') is not null then
    if btrim(v_actual.bove_cierre) <> v_bove then
      raise exception 'BOVE ya registrado con un número diferente.';
    end if;

    -- Idempotencia: no UPDATE, conserva usuario, fecha y auditoría originales.
    return jsonb_build_object(
      'reserva_id', p_reserva_id,
      'bove', v_actual.bove_cierre,
      'registrado_por', v_actual.bove_cierre_registrado_por,
      'registrado_en', v_actual.bove_cierre_registrado_en,
      'total_alojamiento', v_total,
      'ya_registrado', true
    );
  end if;

  update public.reservas
     set bove_cierre = v_bove,
         bove_cierre_registrado_por = auth.uid(),
         bove_cierre_registrado_en = now(),
         actualizado_en = now()
   where id = p_reserva_id;

  if not found then
    raise exception 'No fue posible actualizar la reserva';
  end if;

  return jsonb_build_object(
    'reserva_id', p_reserva_id,
    'bove', v_bove,
    'registrado_por', auth.uid(),
    'registrado_en', now(),
    'total_alojamiento', v_total
  );
end;
$function$;


COMMIT;

