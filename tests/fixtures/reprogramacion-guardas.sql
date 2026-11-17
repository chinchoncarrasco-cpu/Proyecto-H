-- Cuerpos existentes leídos en modo consulta. No contienen datos de huéspedes.
CREATE OR REPLACE FUNCTION public.haiku_sincronizar_cargo_servicio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nombre text;
  v_cargo_id uuid;
  v_aplicado_neto bigint := 0;
begin
  select nombre into v_nombre
  from public.catalogo_servicios
  where id = new.catalogo_servicio_id;

  select id into v_cargo_id
  from public.cargos
  where servicio_id = new.id
    and estado = 'activo'
  limit 1;

  if new.tipo_cobro = 'normal'
     and new.total > 0
     and new.estado_servicio not in ('cancelado','no_show') then

    if v_cargo_id is not null then
      select coalesce(sum(
        case
          when p.estado = 'confirmado' and p.tipo_movimiento = 'pago' then pa.monto_aplicado
          when p.estado = 'confirmado' and p.tipo_movimiento = 'devolucion' then -pa.monto_aplicado
          else 0
        end
      ), 0)
      into v_aplicado_neto
      from public.pago_aplicaciones pa
      join public.pagos p on p.id = pa.pago_id
      where pa.cargo_id = v_cargo_id;

      if v_aplicado_neto > new.total then
        raise exception 'No se puede reducir el servicio a $% porque ya tiene $% aplicado', new.total, v_aplicado_neto;
      end if;

      update public.cargos
      set reserva_id = new.reserva_id,
          estadia_id = new.estadia_id,
          concepto = coalesce(v_nombre, 'Servicio'),
          monto = new.total,
          actualizado_en = now()
      where id = v_cargo_id;
    else
      insert into public.cargos (
        reserva_id,
        estadia_id,
        servicio_id,
        tipo_cargo,
        concepto,
        monto,
        moneda,
        estado,
        creado_por
      ) values (
        new.reserva_id,
        new.estadia_id,
        new.id,
        'servicio',
        coalesce(v_nombre, 'Servicio'),
        new.total,
        'CLP',
        'activo',
        new.creado_por
      );
    end if;
  else
    if v_cargo_id is not null then
      update public.cargos
      set estado = 'anulado',
          actualizado_en = now()
      where id = v_cargo_id;
    end if;
  end if;

  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.haiku_validar_servicio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_reserva_estadia uuid;
  v_catalogo_activo boolean;
  v_requiere_horario boolean;
  v_recurso_activo boolean;
begin
  if new.estadia_id is not null then
    select reserva_id into v_reserva_estadia
    from public.reserva_estadias
    where id = new.estadia_id;

    if not found or v_reserva_estadia <> new.reserva_id then
      raise exception 'La estadía seleccionada no pertenece a la reserva del servicio';
    end if;
  end if;

  select activo, requiere_horario
    into v_catalogo_activo, v_requiere_horario
  from public.catalogo_servicios
  where id = new.catalogo_servicio_id;

  if not found then
    raise exception 'El servicio de catálogo no existe';
  end if;

  if tg_op = 'INSERT' or new.catalogo_servicio_id is distinct from old.catalogo_servicio_id then
    if not v_catalogo_activo then
      raise exception 'No se puede contratar un servicio de catálogo inactivo';
    end if;
  end if;

  if v_requiere_horario and (new.hora_inicio is null or new.hora_fin is null) then
    raise exception 'Este servicio requiere hora de inicio y fin';
  end if;

  if new.recurso_id is not null then
    select activo into v_recurso_activo
    from public.recursos_servicio
    where id = new.recurso_id;

    if not found then
      raise exception 'El recurso de servicio no existe';
    end if;

    if (tg_op = 'INSERT' or new.recurso_id is distinct from old.recurso_id) and not v_recurso_activo then
      raise exception 'No se puede asignar un recurso inactivo';
    end if;
  end if;

  return new;
end;
$function$;
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
CREATE OR REPLACE FUNCTION private.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_precio_base bigint;
begin
  if old.cabana_id is not distinct from new.cabana_id then
    return new;
  end if;

  if coalesce(new.tipo_estadia, '') <> 'alojamiento' then
    return new;
  end if;

  select c.precio_base
    into v_precio_base
  from public.cabanas c
  where c.id = new.cabana_id
    and c.activa = true;

  if v_precio_base is null or v_precio_base < 0 then
    raise exception 'La nueva cabaña no tiene una tarifa base válida';
  end if;

  update public.estadia_noches n
     set tarifa = v_precio_base,
         origen_tarifa = 'catalogo'
   where n.estadia_id = new.id
     and n.origen_tarifa = 'catalogo'
     and n.tarifa is distinct from v_precio_base;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.haiku_validar_cambio_rango_estadia()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if exists (
    select 1
    from public.estadia_noches n
    where n.estadia_id = new.id
      and (n.fecha < new.fecha_ingreso or n.fecha >= new.fecha_salida)
      and (
        exists (
          select 1
          from public.cargos c
          where c.estadia_noche_id = n.id
            and c.estado = 'activo'
        )
        or not exists (
          select 1
          from public.cargos c2
          where c2.estadia_noche_id = n.id
        )
      )
  ) then
    raise exception 'No se puede reducir el rango mientras existan noches activas fuera del nuevo rango';
  end if;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.haiku_validar_estadia_noche()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_ingreso date;
  v_salida date;
begin
  select fecha_ingreso, fecha_salida
    into v_ingreso, v_salida
  from public.reserva_estadias
  where id = new.estadia_id;

  if not found then
    raise exception 'La estadía % no existe', new.estadia_id;
  end if;

  if new.fecha < v_ingreso or new.fecha >= v_salida then
    raise exception 'La noche % está fuera del rango de la estadía [% - %)', new.fecha, v_ingreso, v_salida;
  end if;

  return new;
end;
$function$;
