create or replace function public.haiku_listar_reservas_v1(
  p_busqueda text default null,
  p_fecha_reserva_desde date default null,
  p_fecha_reserva_hasta date default null,
  p_checkin_desde date default null,
  p_checkin_hasta date default null,
  p_checkout_desde date default null,
  p_checkout_hasta date default null,
  p_estadia_desde date default null,
  p_estadia_hasta date default null,
  p_estado text default null,
  p_categoria text default null,
  p_adultos smallint default null,
  p_ninos smallint default null,
  p_orden text default 'fecha_reserva',
  p_asc boolean default false,
  p_limite integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $function$
with estadias_agrupadas as (
  select
    re.reserva_id,
    min(re.fecha_ingreso) as check_in,
    max(re.fecha_salida) as check_out,
    max(re.adultos)::smallint as adultos,
    max(re.ninos)::smallint as ninos,
    bool_or(re.tipo_estadia = 'fullday') as es_fullday,
    string_agg(
      'CAB ' || c.numero::text,
      ' → '
      order by re.fecha_ingreso, re.creado_en, c.numero
    ) as cabanas,
    array_agg(distinct c.numero order by c.numero)::smallint[] as cabana_numeros,
    array_agg(distinct c.tipo order by c.tipo)
      filter (where nullif(btrim(c.tipo), '') is not null) as categorias
  from public.reserva_estadias re
  join public.cabanas c on c.id = re.cabana_id
  group by re.reserva_id
),
base as (
  select
    r.id as reserva_id,
    r.creado_en,
    (r.creado_en at time zone 'America/Santiago')::date as fecha_reserva,
    case when e.es_fullday then 'Full Day'::text else null::text end as plan_tarifario,
    e.cabanas,
    e.cabana_numeros,
    coalesce(e.categorias, array[]::text[]) as categorias,
    coalesce(nullif(btrim(h.nombre), ''), nullif(btrim(r.titular_nombre), '')) as nombre,
    nullif(btrim(h.apellido), '') as apellido,
    e.check_in,
    e.check_out,
    e.adultos,
    e.ninos,
    coalesce(s.total_alojamiento, 0::bigint) as precio_total,
    coalesce(s.pagado_alojamiento, 0::bigint) as abono,
    coalesce(s.saldo_alojamiento, 0::bigint) as saldo_pendiente,
    r.estado_reserva as estado,
    nullif(btrim(coalesce(r.correo_contacto, h.correo)), '') as correo,
    nullif(btrim(coalesce(r.telefono_contacto, h.telefono)), '') as telefono,
    nullif(btrim(coalesce(r.titular_numero_documento, h.numero_documento)), '') as documento,
    null::text as fuente,
    nullif(btrim(h.nacionalidad), '') as pais,
    e.es_fullday as es_fullday
  from public.reservas r
  join estadias_agrupadas e on e.reserva_id = r.id
  left join public.huespedes h on h.id = r.titular_huesped_id
  left join public.vista_saldos_alojamiento_reserva s on s.reserva_id = r.id
  where private.haiku_usuario_activo()
    and private.haiku_tiene_permiso('reservas.ver')
    and private.haiku_tiene_permiso('pagos.ver')
    and (
      p_fecha_reserva_desde is null
      or (r.creado_en at time zone 'America/Santiago')::date >= p_fecha_reserva_desde
    )
    and (
      p_fecha_reserva_hasta is null
      or (r.creado_en at time zone 'America/Santiago')::date <= p_fecha_reserva_hasta
    )
    and (p_checkin_desde is null or e.check_in >= p_checkin_desde)
    and (p_checkin_hasta is null or e.check_in <= p_checkin_hasta)
    and (p_checkout_desde is null or e.check_out >= p_checkout_desde)
    and (p_checkout_hasta is null or e.check_out <= p_checkout_hasta)
    and (
      p_estadia_desde is null
      or greatest(e.check_out, e.check_in + 1) > p_estadia_desde
    )
    and (
      p_estadia_hasta is null
      or e.check_in <= p_estadia_hasta
    )
    and (nullif(btrim(p_estado), '') is null or r.estado_reserva = p_estado)
    and (
      nullif(btrim(p_categoria), '') is null
      or p_categoria = any(coalesce(e.categorias, array[]::text[]))
    )
    and (p_adultos is null or e.adultos = p_adultos)
    and (p_ninos is null or e.ninos = p_ninos)
),
filtradas as (
  select b.*
  from base b
  where nullif(btrim(p_busqueda), '') is null
     or strpos(
       lower(concat_ws(
         ' ',
         b.nombre,
         b.apellido,
         b.cabanas,
         b.correo,
         b.telefono,
         b.documento,
         b.estado,
         b.plan_tarifario
       )),
       lower(btrim(p_busqueda))
     ) > 0
),
numeradas as (
  select
    f.*,
    row_number() over (
      order by
        case when p_asc and p_orden = 'fecha_reserva' then f.fecha_reserva end asc nulls last,
        case when not p_asc and p_orden = 'fecha_reserva' then f.fecha_reserva end desc nulls last,
        case when p_asc and p_orden = 'plan_tarifario' then lower(coalesce(f.plan_tarifario, '')) end asc,
        case when not p_asc and p_orden = 'plan_tarifario' then lower(coalesce(f.plan_tarifario, '')) end desc,
        case when p_asc and p_orden = 'cabanas' then lower(coalesce(f.cabanas, '')) end asc,
        case when not p_asc and p_orden = 'cabanas' then lower(coalesce(f.cabanas, '')) end desc,
        case when p_asc and p_orden = 'nombre' then lower(coalesce(f.nombre, '')) end asc,
        case when not p_asc and p_orden = 'nombre' then lower(coalesce(f.nombre, '')) end desc,
        case when p_asc and p_orden = 'apellido' then lower(coalesce(f.apellido, '')) end asc,
        case when not p_asc and p_orden = 'apellido' then lower(coalesce(f.apellido, '')) end desc,
        case when p_asc and p_orden = 'check_in' then f.check_in end asc nulls last,
        case when not p_asc and p_orden = 'check_in' then f.check_in end desc nulls last,
        case when p_asc and p_orden = 'check_out' then f.check_out end asc nulls last,
        case when not p_asc and p_orden = 'check_out' then f.check_out end desc nulls last,
        case when p_asc and p_orden = 'adultos' then f.adultos end asc nulls last,
        case when not p_asc and p_orden = 'adultos' then f.adultos end desc nulls last,
        case when p_asc and p_orden = 'ninos' then f.ninos end asc nulls last,
        case when not p_asc and p_orden = 'ninos' then f.ninos end desc nulls last,
        case when p_asc and p_orden = 'precio_total' then f.precio_total end asc,
        case when not p_asc and p_orden = 'precio_total' then f.precio_total end desc,
        case when p_asc and p_orden = 'abono' then f.abono end asc,
        case when not p_asc and p_orden = 'abono' then f.abono end desc,
        case when p_asc and p_orden = 'saldo_pendiente' then f.saldo_pendiente end asc,
        case when not p_asc and p_orden = 'saldo_pendiente' then f.saldo_pendiente end desc,
        case when p_asc and p_orden = 'estado' then lower(coalesce(f.estado, '')) end asc,
        case when not p_asc and p_orden = 'estado' then lower(coalesce(f.estado, '')) end desc,
        case when p_asc and p_orden = 'correo' then lower(coalesce(f.correo, '')) end asc,
        case when not p_asc and p_orden = 'correo' then lower(coalesce(f.correo, '')) end desc,
        case when p_asc and p_orden = 'telefono' then lower(coalesce(f.telefono, '')) end asc,
        case when not p_asc and p_orden = 'telefono' then lower(coalesce(f.telefono, '')) end desc,
        case when p_asc and p_orden = 'documento' then lower(coalesce(f.documento, '')) end asc,
        case when not p_asc and p_orden = 'documento' then lower(coalesce(f.documento, '')) end desc,
        case when p_asc and p_orden = 'fuente' then lower(coalesce(f.fuente, '')) end asc,
        case when not p_asc and p_orden = 'fuente' then lower(coalesce(f.fuente, '')) end desc,
        case when p_asc and p_orden = 'pais' then lower(coalesce(f.pais, '')) end asc,
        case when not p_asc and p_orden = 'pais' then lower(coalesce(f.pais, '')) end desc,
        f.creado_en desc,
        f.reserva_id
    ) as orden_interno
  from filtradas f
),
pagina as (
  select *
  from numeradas
  order by orden_interno
  limit least(greatest(coalesce(p_limite, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
)
select jsonb_build_object(
  'total', (select count(*) from filtradas),
  'reservas', coalesce(
    (
      select jsonb_agg(to_jsonb(p) - 'orden_interno' order by p.orden_interno)
      from pagina p
    ),
    '[]'::jsonb
  ),
  'categorias_disponibles', coalesce(
    (
      select jsonb_agg(x.tipo order by x.tipo)
      from (
        select distinct c.tipo
        from public.cabanas c
        where c.activa
          and nullif(btrim(c.tipo), '') is not null
      ) x
    ),
    '[]'::jsonb
  ),
  'estados_disponibles', coalesce(
    (
      select jsonb_agg(x.estado_reserva order by x.estado_reserva)
      from (
        select distinct r.estado_reserva
        from public.reservas r
        where private.haiku_usuario_activo()
          and private.haiku_tiene_permiso('reservas.ver')
      ) x
    ),
    '[]'::jsonb
  ),
  'campos_sin_fuente', jsonb_build_array(
    'nombre_plan_tarifa_interno_exacto',
    'fuente',
    'plan_comidas',
    'etiquetas'
  )
);
$function$;

comment on function public.haiku_listar_reservas_v1(
  text, date, date, date, date, date, date, date, date,
  text, text, smallint, smallint, text, boolean, integer, integer
) is
'Listado operativo paginado y de solo lectura para la sección Reservas. Respeta RLS y permisos existentes; no modifica reservas.';

revoke all on function public.haiku_listar_reservas_v1(
  text, date, date, date, date, date, date, date, date,
  text, text, smallint, smallint, text, boolean, integer, integer
) from public;

revoke all on function public.haiku_listar_reservas_v1(
  text, date, date, date, date, date, date, date, date,
  text, text, smallint, smallint, text, boolean, integer, integer
) from anon;

grant execute on function public.haiku_listar_reservas_v1(
  text, date, date, date, date, date, date, date, date,
  text, text, smallint, smallint, text, boolean, integer, integer
) to authenticated;
