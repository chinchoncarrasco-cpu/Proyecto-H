-- Extensiones efímeras del esquema existente; refleja el RPC manual desplegado.
alter table public.servicios
  add column cancelado_en timestamptz,
  add column cancelado_por uuid,
  add column motivo_cancelacion text;
alter table public.reserva_estadias
  add column checkout_realizado_en timestamptz;

create or replace function private.haiku_tiene_permiso(p_permiso text) returns boolean
language sql stable as $$
  select p_permiso in ('servicios.editar', 'servicios.cancelar')
    and coalesce(nullif(current_setting('test.servicios_cancelar', true), ''), 'true')::boolean
$$;

create or replace function public.haiku_cancelar_servicio(
  p_servicio_id uuid, p_motivo text default 'Cancelado por solicitud del huésped'
) returns jsonb language plpgsql security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_servicio public.servicios%rowtype;
  v_aplicado bigint := 0;
  v_motivo text := nullif(btrim(coalesce(p_motivo,'')), '');
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para cancelar servicios';
  end if;
  if not private.haiku_tiene_permiso('servicios.cancelar') then
    raise exception 'Tu usuario no tiene permiso para cancelar servicios';
  end if;
  select * into v_servicio from public.servicios
  where id = p_servicio_id for update;
  if not found then raise exception 'No se encontró el servicio'; end if;
  if v_servicio.estado_servicio = 'cancelado' then
    return jsonb_build_object('ok',true,'servicio_id',p_servicio_id,
      'estado','cancelado','ya_cancelado',true);
  end if;
  if v_servicio.estado_servicio = 'realizado' then
    raise exception 'El servicio ya está realizado';
  end if;
  select coalesce(sum(case
    when p.estado = 'confirmado' and p.tipo_movimiento = 'pago' then pa.monto_aplicado
    when p.estado = 'confirmado' and p.tipo_movimiento = 'devolucion' then -pa.monto_aplicado
    else 0 end),0)::bigint into v_aplicado
  from public.cargos c
  left join public.pago_aplicaciones pa on pa.cargo_id = c.id
  left join public.pagos p on p.id = pa.pago_id
  where c.servicio_id = p_servicio_id and c.estado = 'activo';
  if v_aplicado > 0 then raise exception 'Este servicio tiene pagos aplicados'; end if;
  update public.servicios set estado_servicio='cancelado',
    cancelado_en=now(), cancelado_por=auth.uid(),
    motivo_cancelacion=coalesce(v_motivo,'Cancelado por solicitud del huésped'),
    actualizado_en=now()
  where id=p_servicio_id;
  return jsonb_build_object('ok',true,'servicio_id',p_servicio_id,
    'estado','cancelado','cobro_activo',0,
    'total_original',v_servicio.total);
end;
$function$;
