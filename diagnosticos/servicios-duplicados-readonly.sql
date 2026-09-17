-- Diagnóstico de posibles servicios duplicados. Sólo lectura.
-- No clasifica ni modifica datos; los resultados requieren revisión humana.
with base as (
  select
    s.id,
    s.reserva_id,
    s.estadia_id,
    r.titular_nombre,
    c.numero as cabana,
    cs.codigo,
    cs.nombre,
    s.fecha_servicio,
    s.hora_inicio,
    s.total,
    s.estado_servicio,
    s.observaciones,
    s.creado_en,
    coalesce(s.observaciones, '') like '%HAIKU-LEGACY-ID:%' as origen_legacy,
    coalesce(s.observaciones, '') like '%[HAKU-LIBRO-SERVICIO:%' as origen_libro
  from public.servicios s
  join public.reservas r on r.id = s.reserva_id
  left join public.reserva_estadias re on re.id = s.estadia_id
  left join public.cabanas c on c.id = re.cabana_id
  join public.catalogo_servicios cs on cs.id = s.catalogo_servicio_id
  where coalesce(s.estado_servicio, '') not in ('cancelado', 'no_show')
    and coalesce(r.estado_reserva, '') not in ('cancelada', 'no_show')
    and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
),
late_duplicados as (
  select reserva_id, estadia_id, count(*) as cantidad,
    jsonb_agg(jsonb_build_object('id', left(id::text, 8), 'titular', titular_nombre,
      'cabana', cabana, 'fecha', fecha_servicio, 'hora', hora_inicio, 'total', total)
      order by creado_en) as ejemplos
  from base where codigo = 'lateCheckout'
  group by reserva_id, estadia_id having count(*) > 1
),
hecho_duplicado as (
  select reserva_id, estadia_id, codigo, fecha_servicio, hora_inicio, total, count(*) as cantidad,
    jsonb_agg(jsonb_build_object('id', left(id::text, 8), 'titular', titular_nombre,
      'cabana', cabana, 'origen_legacy', origen_legacy, 'origen_libro', origen_libro)
      order by creado_en) as ejemplos
  from base
  group by reserva_id, estadia_id, codigo, fecha_servicio, hora_inicio, total
  having count(*) > 1
),
cruce_origenes as (
  select a.reserva_id, a.estadia_id, a.codigo,
    left(a.id::text, 8) as servicio_a_id,
    case when a.origen_legacy then 'legacy' else 'libro' end as origen_a,
    left(b.id::text, 8) as servicio_b_id,
    case when b.origen_legacy then 'legacy' else 'libro' end as origen_b,
    a.titular_nombre, a.cabana,
    a.fecha_servicio as fecha_a, b.fecha_servicio as fecha_b,
    a.hora_inicio as hora_a, b.hora_inicio as hora_b,
    a.total
  from base a join base b
    on b.reserva_id = a.reserva_id and b.estadia_id = a.estadia_id
   and b.codigo = a.codigo and b.total = a.total and b.id > a.id
  where (a.origen_legacy and b.origen_libro)
     or (a.origen_libro and b.origen_legacy)
)
select jsonb_build_object(
  'reservas_con_late_checkout_activo_duplicado', (select count(*) from late_duplicados),
  'grupos_mismo_hecho_exacto', (select count(*) from hecho_duplicado),
  'pares_libro_legacy_misma_estadia_codigo_monto', (select count(*) from cruce_origenes),
  'late_checkout', coalesce((select jsonb_agg(x) from (select * from late_duplicados limit 20) x), '[]'::jsonb),
  'mismo_hecho', coalesce((select jsonb_agg(x) from (select * from hecho_duplicado limit 20) x), '[]'::jsonb),
  'cruce_origenes', coalesce((select jsonb_agg(x) from (select * from cruce_origenes limit 20) x), '[]'::jsonb)
) as auditoria;
