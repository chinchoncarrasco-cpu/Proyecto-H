begin;

-- Lectura compacta para el selector del mapa. Usa el RPC manual existente para escribir.
create function public.haiku_mapa_reservas_cabana_v1(p_numero integer, p_fecha date, p_estadias uuid[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
    v_inicio timestamptz := p_fecha::timestamp at time zone 'America/Santiago';
    v_fin timestamptz := (p_fecha + 1)::timestamp at time zone 'America/Santiago';
    v_fichas jsonb;
begin
    if auth.uid() is null or private.haiku_usuario_activo() is not true
      or private.haiku_tiene_permiso('cabanas.ver') is not true
      or private.haiku_tiene_permiso('reservas.ver') is not true then
        raise exception 'Tu sesión no puede consultar las reservas del mapa.' using errcode = '42501';
    end if;
    if p_numero is null or p_numero not between 1 and 11
      or p_fecha is distinct from (now() at time zone 'America/Santiago')::date
      or cardinality(p_estadias) > 2 then
        raise exception 'Actualiza el mapa antes de consultar esta cabaña.' using errcode = '22023';
    end if;

    with objetivos as (
        select e.id, e.reserva_id, array_position(p_estadias,e.id) as prioridad, e.checkout_realizado_en
        from public.reserva_estadias e join public.cabanas c on c.id=e.cabana_id
        where c.numero=p_numero and (
            (e.id=any(p_estadias) and e.fecha_ingreso<=p_fecha and e.fecha_salida>=p_fecha)
            or (e.checkout_realizado_en>=v_inicio and e.checkout_realizado_en<v_fin
                and e.estado_estadia not in ('cancelada','no_show'))
        )
        order by prioridad nulls last, e.checkout_realizado_en desc nulls last, e.id
        limit 2
    ), fichas as (
        select r.id, jsonb_build_object(
            'reserva', jsonb_build_object('id',r.id,'estado_reserva',r.estado_reserva,'titular_nombre',r.titular_nombre),
            'tiene_abono_confirmado', coalesce((
                select sum(p.monto)>0 from public.pagos p
                where p.reserva_id=r.id and p.estado='confirmado'
                  and p.tipo_movimiento='pago' and p.etapa_operativa='abono'
            ),false),
            'estadias', (
                select jsonb_agg(jsonb_build_object('id',e.id,'cabana_numero',c.numero,
                    'estado_estadia',e.estado_estadia,'fecha_ingreso',e.fecha_ingreso,'fecha_salida',e.fecha_salida,
                    'tipo_estadia',e.tipo_estadia,'checkin_realizado_en',e.checkin_realizado_en,
                    'checkout_realizado_en',e.checkout_realizado_en) order by e.id)
                from public.reserva_estadias e join public.cabanas c on c.id=e.cabana_id where e.reserva_id=r.id
            )
        ) as ficha
        from public.reservas r
        where r.id in (select reserva_id from objetivos)
    )
    select coalesce(jsonb_agg(f.ficha || jsonb_build_object('estadia_id',o.id)
      order by o.prioridad nulls last,o.checkout_realizado_en desc nulls last,o.id),'[]')
    into v_fichas from objetivos o join fichas f on f.id=o.reserva_id;

    return jsonb_build_object('fichas',v_fichas,
        'puede_editar',private.haiku_tiene_permiso('reservas.editar') is true,
        'puede_cancelar',private.haiku_tiene_permiso('reservas.cancelar') is true);
end
$$;

revoke all on function public.haiku_mapa_reservas_cabana_v1(integer,date,uuid[]) from public, anon, authenticated;
grant execute on function public.haiku_mapa_reservas_cabana_v1(integer,date,uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
