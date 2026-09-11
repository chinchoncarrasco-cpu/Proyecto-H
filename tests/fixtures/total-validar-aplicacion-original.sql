-- Trigger existente, sin datos de clientes.
CREATE OR REPLACE FUNCTION public.haiku_validar_pago_aplicacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_tipo_pago text;
  v_estado_pago text;
  v_reserva_pago uuid;
  v_pago_origen uuid;
  v_monto_pago bigint;
  v_reserva_cargo uuid;
  v_estado_cargo text;
  v_monto_cargo bigint;
  v_grupo_pago uuid;
  v_grupo_cargo uuid;
  v_suma_pago bigint;
  v_neto_cargo bigint;
  v_aplicado_original bigint;
  v_devuelto_mismo_origen bigint;
begin
  select tipo_movimiento, estado, reserva_id, pago_origen_id, monto
    into v_tipo_pago, v_estado_pago, v_reserva_pago, v_pago_origen, v_monto_pago
  from public.pagos
  where id = new.pago_id;

  if not found then
    raise exception 'El pago de la aplicación no existe';
  end if;

  if v_estado_pago <> 'confirmado' then
    raise exception 'Sólo los pagos o devoluciones confirmados pueden aplicarse a cargos';
  end if;

  select reserva_id, estado, monto
    into v_reserva_cargo, v_estado_cargo, v_monto_cargo
  from public.cargos
  where id = new.cargo_id;

  if not found then
    raise exception 'El cargo de la aplicación no existe';
  end if;

  if v_reserva_pago is distinct from v_reserva_cargo then
    select grupo_reserva_id into v_grupo_pago
      from public.reservas where id = v_reserva_pago;
    select grupo_reserva_id into v_grupo_cargo
      from public.reservas where id = v_reserva_cargo;

    if v_grupo_pago is null
       or v_grupo_cargo is null
       or v_grupo_pago is distinct from v_grupo_cargo then
      raise exception 'El pago y el cargo deben pertenecer a la misma reserva o reserva conjunta';
    end if;
  end if;

  if v_estado_cargo <> 'activo' then
    raise exception 'No se puede aplicar dinero a un cargo anulado';
  end if;

  select coalesce(sum(pa.monto_aplicado), 0)
    into v_suma_pago
  from public.pago_aplicaciones pa
  where pa.pago_id = new.pago_id
    and pa.id <> new.id;

  if v_suma_pago + new.monto_aplicado > v_monto_pago then
    raise exception 'Las aplicaciones superan el monto disponible del pago/devolución';
  end if;

  if v_tipo_pago = 'pago' then
    select coalesce(sum(
      case when p.tipo_movimiento = 'pago' then pa.monto_aplicado
           when p.tipo_movimiento = 'devolucion' then -pa.monto_aplicado
           else 0 end
    ), 0)
      into v_neto_cargo
    from public.pago_aplicaciones pa
    join public.pagos p on p.id = pa.pago_id
    where pa.cargo_id = new.cargo_id
      and p.estado = 'confirmado'
      and pa.id <> new.id;

    if v_neto_cargo + new.monto_aplicado > v_monto_cargo then
      raise exception 'La aplicación supera el saldo disponible del cargo';
    end if;

  elsif v_tipo_pago = 'devolucion' then
    if v_pago_origen is null then
      raise exception 'La devolución no tiene pago original';
    end if;

    select coalesce(max(pa.monto_aplicado), 0)
      into v_aplicado_original
    from public.pago_aplicaciones pa
    where pa.pago_id = v_pago_origen
      and pa.cargo_id = new.cargo_id;

    if v_aplicado_original = 0 then
      raise exception 'El pago original no fue aplicado a este cargo';
    end if;

    select coalesce(sum(pa.monto_aplicado), 0)
      into v_devuelto_mismo_origen
    from public.pago_aplicaciones pa
    join public.pagos p on p.id = pa.pago_id
    where p.pago_origen_id = v_pago_origen
      and p.tipo_movimiento = 'devolucion'
      and p.estado = 'confirmado'
      and pa.cargo_id = new.cargo_id
      and pa.id <> new.id;

    if v_devuelto_mismo_origen + new.monto_aplicado > v_aplicado_original then
      raise exception 'La devolución aplicada al cargo supera lo cubierto por el pago original';
    end if;
  end if;

  return new;
end;
$function$
