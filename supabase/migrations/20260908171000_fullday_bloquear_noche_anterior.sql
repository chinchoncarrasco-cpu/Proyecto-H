-- HAIKU · FULLDAY: BLOQUEO DE LA NOCHE ANTERIOR
--
-- Regla operativa real:
-- - FULLDAY entra 09:30 y sale 21:30.
-- - Alojamiento nocturno sale a las 12:00.
-- Por lo tanto, un alojamiento cuya fecha de salida sea el mismo día del
-- FULLDAY se superpone entre 09:30 y 12:00 y NO puede venderse.
--
-- El trigger de conflicto ya usa límites inclusivos. Esta migración alinea
-- la consulta de disponibilidad con esa misma regla para que Haku no ofrezca
-- una cabaña que luego sería rechazada al guardar.

create or replace function public.haiku_cabanas_disponibles(
  p_fecha_ingreso date,
  p_fecha_salida date,
  p_tipo_estadia text default 'alojamiento'::text
)
returns table(
  cabana_id uuid,
  numero smallint,
  nombre text,
  capacidad_total smallint,
  precio_base bigint
)
language plpgsql
stable
set search_path to 'pg_catalog', 'public', 'private'
as $function$
begin
  if not private.haiku_usuario_activo() then
    raise exception 'Usuario HAIKU inactivo o no registrado' using errcode = '42501';
  end if;

  if not (
    private.haiku_tiene_permiso('cabanas.ver')
    and private.haiku_tiene_permiso('reservas.ver')
  ) then
    raise exception 'Sin permiso para consultar disponibilidad' using errcode = '42501';
  end if;

  if p_tipo_estadia not in ('alojamiento','fullday') then
    raise exception 'Tipo de estadía no válido';
  end if;

  if p_tipo_estadia = 'alojamiento' and p_fecha_salida <= p_fecha_ingreso then
    raise exception 'La fecha de salida debe ser posterior al ingreso';
  end if;

  if p_tipo_estadia = 'fullday' and p_fecha_salida <> p_fecha_ingreso then
    raise exception 'FULLDAY debe ingresar y salir el mismo día';
  end if;

  return query
  select c.id, c.numero, c.nombre, c.capacidad_total, c.precio_base
  from public.cabanas c
  where c.activa = true
    and not exists (
      select 1
      from public.bloqueos_cabana b
      where b.cabana_id = c.id
        and b.estado = 'activo'
        and tstzrange(
              b.desde,
              coalesce(b.hasta, 'infinity'::timestamptz),
              '[)'
            ) &&
            case
              when p_tipo_estadia = 'fullday' then
                tstzrange(
                  (p_fecha_ingreso::timestamp at time zone 'America/Santiago'),
                  ((p_fecha_ingreso + 1)::timestamp at time zone 'America/Santiago'),
                  '[)'
                )
              else
                tstzrange(
                  (p_fecha_ingreso::timestamp at time zone 'America/Santiago'),
                  (p_fecha_salida::timestamp at time zone 'America/Santiago'),
                  '[)'
                )
            end
    )
    and not exists (
      select 1
      from public.reserva_estadias e
      where e.cabana_id = c.id
        and e.estado_estadia not in ('cancelada','no_show')
        and not (
          e.tipo_estadia = 'fullday'
          and e.fullday_liberado_en is not null
        )
        and (
          (
            p_tipo_estadia = 'alojamiento'
            and e.tipo_estadia = 'alojamiento'
            and daterange(e.fecha_ingreso, e.fecha_salida, '[)')
                && daterange(p_fecha_ingreso, p_fecha_salida, '[)')
          )
          or (
            -- Un FULLDAY existente también bloquea el alojamiento cuya salida
            -- cae ese mismo día: 09:30 del FULLDAY se cruza con checkout 12:00.
            p_tipo_estadia = 'alojamiento'
            and e.tipo_estadia = 'fullday'
            and e.fecha_ingreso >= p_fecha_ingreso
            and e.fecha_ingreso <= p_fecha_salida
          )
          or (
            -- Al consultar un FULLDAY, una estadía que sale ese mismo día
            -- también impide usar la cabaña por el cruce 09:30–12:00.
            p_tipo_estadia = 'fullday'
            and e.tipo_estadia = 'alojamiento'
            and p_fecha_ingreso >= e.fecha_ingreso
            and p_fecha_ingreso <= e.fecha_salida
          )
          or (
            p_tipo_estadia = 'fullday'
            and e.tipo_estadia = 'fullday'
            and e.fecha_ingreso = p_fecha_ingreso
          )
        )
    )
  order by c.orden_visual nulls last, c.numero;
end;
$function$;

comment on function public.haiku_cabanas_disponibles(date,date,text) is
  'Disponibilidad HAIKU. Un FULLDAY (09:30-21:30) bloquea también la noche anterior porque el checkout estándar del alojamiento es 12:00.';
