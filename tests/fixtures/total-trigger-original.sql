CREATE OR REPLACE FUNCTION public.haiku_sincronizar_cargo_noche()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reserva_id uuid;
  v_cargo_id uuid;
  v_pagado_neto bigint := 0;
begin
  select reserva_id into v_reserva_id
  from public.reserva_estadias
  where id = new.estadia_id;

  if not found then
    raise exception 'No se encontró la reserva asociada a la estadía';
  end if;

  select id into v_cargo_id
  from public.cargos
  where estadia_noche_id = new.id
    and estado = 'activo'
  limit 1;

  if v_cargo_id is not null then
    select coalesce(sum(
      case
        when p.estado <> 'confirmado' then 0
        when p.tipo_movimiento = 'pago' then pa.monto_aplicado
        when p.tipo_movimiento = 'devolucion' then -pa.monto_aplicado
        else 0
      end
    ), 0)
    into v_pagado_neto
    from public.pago_aplicaciones pa
    join public.pagos p on p.id = pa.pago_id
    where pa.cargo_id = v_cargo_id;
  end if;

  if new.tarifa < v_pagado_neto then
    raise exception 'La tarifa no puede quedar por debajo del monto neto ya aplicado al cargo (% CLP)', v_pagado_neto;
  end if;

  if new.tarifa = 0 then
    if v_cargo_id is not null then
      update public.cargos
      set estado = 'anulado',
          actualizado_en = now()
      where id = v_cargo_id;
    end if;
    return new;
  end if;

  if v_cargo_id is null then
    insert into public.cargos (
      reserva_id,
      estadia_id,
      estadia_noche_id,
      tipo_cargo,
      concepto,
      monto,
      moneda,
      estado,
      creado_por
    ) values (
      v_reserva_id,
      new.estadia_id,
      new.id,
      'alojamiento',
      'Alojamiento · ' || to_char(new.fecha, 'DD-MM-YYYY'),
      new.tarifa,
      'CLP',
      'activo',
      auth.uid()
    );
  else
    update public.cargos
    set monto = new.tarifa,
        concepto = 'Alojamiento · ' || to_char(new.fecha, 'DD-MM-YYYY'),
        actualizado_en = now()
    where id = v_cargo_id;
  end if;

  return new;
end;
$function$;
