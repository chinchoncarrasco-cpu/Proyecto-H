-- HAKU · consulta de reservas confirmadas sin abono.
-- Sólo lectura. Usa el mismo saldo de alojamiento que la ficha/Pagos.
-- Por defecto devuelve reservas vigentes o futuras; puede incluir pasadas si se solicita.

create or replace function public.haiku_confirmadas_sin_abono_asistente(
  p_incluir_pasadas boolean default false
)
returns table(
  reserva_id uuid,
  codigo_haiku text,
  cloudbeds_id text,
  titular_nombre text,
  telefono_contacto text,
  cabana_numero smallint,
  fecha_ingreso date,
  fecha_salida date,
  tipo_estadia text,
  total_alojamiento bigint,
  pagado_alojamiento bigint,
  saldo_alojamiento bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para consultar reservas sin abono';
  end if;

  if not private.haiku_tiene_permiso('pagos.ver') then
    raise exception 'Tu usuario no tiene permiso para consultar pagos' using errcode = '42501';
  end if;

  return query
  select
    r.id as reserva_id,
    r.codigo_haiku,
    r.cloudbeds_id,
    r.titular_nombre,
    r.telefono_contacto,
    c.numero as cabana_numero,
    re.fecha_ingreso,
    re.fecha_salida,
    re.tipo_estadia,
    coalesce(s.total_alojamiento, 0)::bigint as total_alojamiento,
    coalesce(s.pagado_alojamiento, 0)::bigint as pagado_alojamiento,
    coalesce(s.saldo_alojamiento, 0)::bigint as saldo_alojamiento
  from public.reservas r
  join public.reserva_estadias re on re.reserva_id = r.id
  join public.cabanas c on c.id = re.cabana_id
  left join public.vista_saldos_alojamiento_reserva s on s.reserva_id = r.id
  where r.estado_reserva = 'confirmada'
    and coalesce(s.total_alojamiento, 0) > 0
    and coalesce(s.pagado_alojamiento, 0) = 0
    and coalesce(s.saldo_alojamiento, 0) > 0
    and (coalesce(p_incluir_pasadas, false) or re.fecha_salida >= current_date)
  order by re.fecha_ingreso asc, c.numero asc, r.titular_nombre asc;
end;
$function$;
