-- Constructor de la fotografía propuesta para el PostgreSQL efímero.
-- Debe conservar las mismas claves y agregados que el RPC de producción.
create function private.haiku_realizado_estado_prueba(p_id uuid) returns jsonb
language sql stable as $function$
  select jsonb_build_object(
    'version', 1,
    'servicio', to_jsonb(s),
    'reserva', to_jsonb(r),
    'estadia', to_jsonb(re),
    'catalogo', to_jsonb(cs),
    'checkout_realizado_en', (select max(e.checkout_realizado_en)
      from public.reserva_estadias e where e.reserva_id = s.reserva_id),
    'cargos', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
      from public.cargos c where c.servicio_id = s.id),
    'finanzas', (select coalesce(jsonb_agg(jsonb_build_object(
      'cargo_id', ec.cargo_id, 'estado', ec.estado, 'monto', ec.monto,
      'monto_ajustado', ec.monto_ajustado, 'aplicado_neto', ec.aplicado_neto,
      'saldo_cargo', ec.saldo_cargo,
      'estado_pago', to_jsonb(ec) -> 'estado_pago',
      'ajuste_neto', to_jsonb(ec) -> 'ajuste_neto'
    ) order by ec.cargo_id), '[]'::jsonb)
      from public.vista_estado_cargos ec where ec.servicio_id = s.id),
    'aplicaciones', (select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id), '[]'::jsonb)
      from public.pago_aplicaciones pa join public.cargos c on c.id = pa.cargo_id
      where c.servicio_id = s.id),
    'pagos', (select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
      from public.pagos p where p.reserva_id = s.reserva_id),
    'ajustes', (select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id), '[]'::jsonb)
      from public.cargo_ajustes ca join public.cargos c on c.id = ca.cargo_id
      where c.servicio_id = s.id)
  ) from public.servicios s
    join public.reservas r on r.id = s.reserva_id
    left join public.reserva_estadias re on re.id = s.estadia_id
    join public.catalogo_servicios cs on cs.id = s.catalogo_servicio_id
  where s.id = p_id;
$function$;
