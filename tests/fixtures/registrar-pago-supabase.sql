-- Read-only schema snapshot from Proyecto H, 2026-09-09. No guest data.
CREATE OR REPLACE FUNCTION public.haiku_registrar_pago(p_reserva_id uuid, p_monto bigint, p_medio_pago text, p_etapa_operativa text DEFAULT 'abono'::text, p_fecha_pago timestamp with time zone DEFAULT now(), p_folio text DEFAULT NULL::text, p_codigo_autorizacion text DEFAULT NULL::text, p_bove text DEFAULT NULL::text, p_referencia_externa text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_aplicaciones jsonb DEFAULT '[]'::jsonb, p_modo_aplicacion text DEFAULT 'alojamiento'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pago_id uuid;
  v_item jsonb;
  v_cargo_id uuid;
  v_monto_aplicar bigint;
  v_restante bigint;
  v_aplicado bigint := 0;
  v_cargo record;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para registrar pagos';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor que cero';
  end if;

  if p_modo_aplicacion not in ('alojamiento','todo','ninguno') then
    raise exception 'Modo de aplicación inválido';
  end if;

  if jsonb_typeof(coalesce(p_aplicaciones, '[]'::jsonb)) <> 'array' then
    raise exception 'Las aplicaciones deben enviarse como arreglo JSON';
  end if;

  insert into public.pagos (
    reserva_id, monto, moneda, tipo_movimiento, etapa_operativa,
    medio_pago, estado, fecha_pago, folio, codigo_autorizacion,
    bove, referencia_externa, observaciones, creado_por
  ) values (
    p_reserva_id,
    p_monto,
    'CLP',
    'pago',
    p_etapa_operativa,
    p_medio_pago,
    'confirmado',
    coalesce(p_fecha_pago, now()),
    nullif(btrim(coalesce(p_folio,'')), ''),
    nullif(btrim(coalesce(p_codigo_autorizacion,'')), ''),
    nullif(btrim(coalesce(p_bove,'')), ''),
    nullif(btrim(coalesce(p_referencia_externa,'')), ''),
    nullif(btrim(coalesce(p_observaciones,'')), ''),
    auth.uid()
  )
  returning id into v_pago_id;

  v_restante := p_monto;

  if jsonb_array_length(coalesce(p_aplicaciones, '[]'::jsonb)) > 0 then
    for v_item in select value from jsonb_array_elements(p_aplicaciones)
    loop
      v_cargo_id := nullif(v_item ->> 'cargo_id', '')::uuid;
      v_monto_aplicar := (v_item ->> 'monto')::bigint;

      if v_cargo_id is null or v_monto_aplicar is null or v_monto_aplicar <= 0 then
        raise exception 'Aplicación de pago inválida';
      end if;

      insert into public.pago_aplicaciones (pago_id, cargo_id, monto_aplicado)
      values (v_pago_id, v_cargo_id, v_monto_aplicar);

      v_aplicado := v_aplicado + v_monto_aplicar;
      v_restante := v_restante - v_monto_aplicar;
    end loop;
  elsif p_modo_aplicacion <> 'ninguno' then
    for v_cargo in
      select ec.cargo_id, ec.saldo_cargo, ec.tipo_cargo, c.creado_en
      from public.vista_estado_cargos ec
      join public.cargos c on c.id = ec.cargo_id
      where ec.reserva_id = p_reserva_id
        and ec.estado = 'activo'
        and ec.saldo_cargo > 0
        and (p_modo_aplicacion = 'todo' or ec.tipo_cargo = 'alojamiento')
      order by
        case when ec.tipo_cargo = 'alojamiento' then 0 else 1 end,
        c.creado_en,
        ec.cargo_id
    loop
      exit when v_restante <= 0;
      v_monto_aplicar := least(v_restante, v_cargo.saldo_cargo);

      insert into public.pago_aplicaciones (pago_id, cargo_id, monto_aplicado)
      values (v_pago_id, v_cargo.cargo_id, v_monto_aplicar);

      v_aplicado := v_aplicado + v_monto_aplicar;
      v_restante := v_restante - v_monto_aplicar;
    end loop;
  end if;

  if p_etapa_operativa = 'abono' then
    update public.reservas
      set estado_reserva = 'confirmada'
    where id = p_reserva_id
      and estado_reserva = 'pendiente';

    update public.reserva_estadias
      set estado_estadia = 'confirmada'
    where reserva_id = p_reserva_id
      and estado_estadia = 'pendiente';
  end if;

  return jsonb_build_object(
    'pago_id', v_pago_id,
    'monto', p_monto,
    'aplicado', v_aplicado,
    'sin_aplicar', greatest(v_restante, 0),
    'etapa_operativa', p_etapa_operativa,
    'medio_pago', p_medio_pago
  );
end;
$function$
