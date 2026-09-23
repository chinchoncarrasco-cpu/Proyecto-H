-- Sólo para PostgreSQL efímero: columnas ya presentes en producción.
alter table public.reservas add column bove_cierre text;
alter table public.catalogo_servicios
  add column requiere_horario boolean not null default true;

create or replace function private.haiku_tiene_permiso(p_permiso text) returns boolean
language sql stable as $$
  select case p_permiso
    when 'servicios.editar' then
      coalesce(nullif(current_setting('test.servicios_editar', true), ''), 'true')::boolean
    when 'servicios.cancelar' then
      coalesce(nullif(current_setting('test.servicios_cancelar', true), ''), 'true')::boolean
    else false end
$$;

-- Constructor del estado esperado de la futura vista previa, sólo para pruebas.
create function private.haiku_reactivacion_estado_prueba(p_id uuid) returns jsonb
language sql stable as $function$
  select jsonb_build_object(
    'version', 1,
    'servicio_id', s.id,
    'servicio_actualizado_en', s.actualizado_en,
    'estado_servicio', s.estado_servicio,
    'cancelado_en', s.cancelado_en,
    'cancelado_por', s.cancelado_por,
    'motivo_cancelacion', s.motivo_cancelacion,
    'reserva_id', s.reserva_id,
    'estadia_id', s.estadia_id,
    'catalogo_servicio_id', s.catalogo_servicio_id,
    'catalogo_activo', cs.activo,
    'estadia_estado', re.estado_estadia,
    'recurso_id', s.recurso_id,
    'recurso_activo', rs.activo,
    'fecha_servicio', s.fecha_servicio,
    'hora_inicio', s.hora_inicio,
    'hora_fin', s.hora_fin,
    'tipo_cobro', s.tipo_cobro,
    'total', s.total,
    'estado_reserva', r.estado_reserva,
    'reserva_actualizado_en', r.actualizado_en,
    'checkout_realizado_en', (select max(e.checkout_realizado_en)
      from public.reserva_estadias e where e.reserva_id=s.reserva_id),
    'bove_checkout', r.bove_checkout,
    'bove_cierre', r.bove_cierre,
    'cargos', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
      from public.cargos c where c.servicio_id=s.id),
    'cantidad_cargos_activos', (select count(*) from public.cargos c
      where c.servicio_id=s.id and c.estado='activo'),
    'aplicaciones', (select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id), '[]'::jsonb)
      from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id
      where c.servicio_id=s.id),
    'ajustes', (select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id), '[]'::jsonb)
      from public.cargo_ajustes ca join public.cargos c on c.id=ca.cargo_id
      where c.servicio_id=s.id),
    'conflictos', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'estado_servicio', x.estado_servicio,
      'actualizado_en', x.actualizado_en) order by x.id), '[]'::jsonb)
      from public.servicios x where x.id<>s.id and x.recurso_id=s.recurso_id
        and x.fecha_servicio=s.fecha_servicio
        and x.estado_servicio not in ('cancelado','no_show')
        and x.hora_inicio<s.hora_fin and x.hora_fin>s.hora_inicio)
  )
  from public.servicios s
  join public.reservas r on r.id=s.reserva_id
  left join public.reserva_estadias re on re.id=s.estadia_id
  join public.catalogo_servicios cs on cs.id=s.catalogo_servicio_id
  left join public.recursos_servicio rs on rs.id=s.recurso_id
  where s.id=p_id;
$function$;

create function private.haiku_cancelacion_estado_prueba(p_id uuid) returns jsonb
language sql stable as $function$
  select jsonb_build_object(
    'version',1,'servicio_id',s.id,'servicio_actualizado_en',s.actualizado_en,
    'estado_servicio',s.estado_servicio,'tipo_cobro',s.tipo_cobro,'total',s.total,
    'fecha_servicio',s.fecha_servicio,'hora_inicio',s.hora_inicio,'hora_fin',s.hora_fin,
    'reserva_id',s.reserva_id,'estadia_id',s.estadia_id,
    'estado_reserva',r.estado_reserva,'reserva_actualizado_en',r.actualizado_en,
    'checkout_realizado_en',(select max(re.checkout_realizado_en)
      from public.reserva_estadias re where re.reserva_id=s.reserva_id),
    'bove_checkout',r.bove_checkout,
    'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb)
      from public.cargos c where c.servicio_id=s.id),
    'cargo_activo_id',case when (select count(*) from public.cargos c
      where c.servicio_id=s.id and c.estado='activo')=1
      then (select c.id from public.cargos c where c.servicio_id=s.id
        and c.estado='activo' order by c.id limit 1) end,
    'cargo_monto',case when (select count(*) from public.cargos c
      where c.servicio_id=s.id and c.estado='activo')=1
      then (select c.monto from public.cargos c where c.servicio_id=s.id
        and c.estado='activo' order by c.id limit 1) end,
    'cargo_aplicado_neto',case when (select count(*) from public.cargos c
      where c.servicio_id=s.id and c.estado='activo')=1
      then (select ec.aplicado_neto from public.vista_estado_cargos ec
        where ec.servicio_id=s.id and ec.estado='activo' limit 1) end,
    'cargo_saldo',case when (select count(*) from public.cargos c
      where c.servicio_id=s.id and c.estado='activo')=1
      then (select ec.saldo_cargo from public.vista_estado_cargos ec
        where ec.servicio_id=s.id and ec.estado='activo' limit 1) end,
    'cantidad_cargos_activos',(select count(*) from public.cargos c
      where c.servicio_id=s.id and c.estado='activo'),
    'cantidad_aplicaciones',(select count(*) from public.pago_aplicaciones pa
      join public.cargos c on c.id=pa.cargo_id where c.servicio_id=s.id),
    'cantidad_ajustes',(select count(*) from public.cargo_ajustes ca
      join public.cargos c on c.id=ca.cargo_id where c.servicio_id=s.id)
  ) from public.servicios s join public.reservas r on r.id=s.reserva_id
  where s.id=p_id;
$function$;
