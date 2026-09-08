create or replace function public.haiku_buscar_operacion_fecha_asistente(
  p_fecha date,
  p_tipo text
)
returns table(
  estadia_id uuid,
  reserva_id uuid,
  titular_nombre text,
  cabana_numero smallint,
  fecha_ingreso date,
  fecha_salida date,
  estado_estadia text,
  estado_reserva text,
  checkin_realizado_en timestamptz,
  checkout_realizado_en timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo text := lower(btrim(coalesce(p_tipo, '')));
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión';
  end if;

  if p_fecha is null then
    raise exception 'Fecha requerida';
  end if;

  if v_tipo not in ('ingresan', 'salen', 'continuan') then
    raise exception 'Tipo de consulta no válido';
  end if;

  return query
  select
    re.id,
    re.reserva_id,
    coalesce(nullif(btrim(r.titular_nombre), ''), 'Sin titular')::text,
    c.numero,
    re.fecha_ingreso,
    re.fecha_salida,
    re.estado_estadia,
    r.estado_reserva,
    re.checkin_realizado_en,
    re.checkout_realizado_en
  from public.reserva_estadias re
  join public.reservas r on r.id = re.reserva_id
  join public.cabanas c on c.id = re.cabana_id
  where re.tipo_estadia = 'alojamiento'
    and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
    and coalesce(r.estado_reserva, '') not in ('cancelada', 'no_show')
    and (
      (v_tipo = 'ingresan' and re.fecha_ingreso = p_fecha)
      or
      (v_tipo = 'salen' and re.fecha_salida = p_fecha)
      or
      (
        v_tipo = 'continuan'
        and re.fecha_ingreso < p_fecha
        and re.fecha_salida > p_fecha
      )
    )
  order by c.numero, r.titular_nombre;
end;
$$;

comment on function public.haiku_buscar_operacion_fecha_asistente(date, text) is
'Consulta de solo lectura para Haku: alojamientos que ingresan, salen o continúan en una fecha. Excluye canceladas y No Show.';

revoke all on function public.haiku_buscar_operacion_fecha_asistente(date, text) from public, anon;
grant execute on function public.haiku_buscar_operacion_fecha_asistente(date, text) to authenticated;
