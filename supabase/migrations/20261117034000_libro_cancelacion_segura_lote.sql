-- Usa el cancelador de ficha sólo si el estado y sus dependencias siguen siendo seguros.
create or replace function public.haiku_libro_cancelacion_segura_lote_v1(
    p_reserva_id uuid, p_esperado jsonb, p_confirmar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
    r public.reservas%rowtype;
    e public.reserva_estadias%rowtype;
    motivo text;
begin
    if auth.uid() is null or private.haiku_tiene_permiso('reservas.cancelar') is distinct from true then
        raise exception 'No tienes permiso para cancelar reservas' using errcode = '42501';
    end if;

    if p_reserva_id is null or jsonb_typeof(p_esperado) is distinct from 'object' then
        raise exception 'Falta el estado esperado de la reserva' using errcode = '22023';
    end if;

    if p_confirmar is true then
        perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_reserva_id::text));
        select * into r from public.reservas where id = p_reserva_id for update;
        perform 1 from public.reserva_estadias where reserva_id = r.id order by id for update;
    else
        select * into r from public.reservas where id = p_reserva_id;
    end if;
    select * into e from public.reserva_estadias where reserva_id = r.id order by id limit 1;

    if r.estado_reserva = 'cancelada' and e.id::text = p_esperado->>'estadia_id'
        and e.estado_estadia = 'cancelada' then
        return jsonb_build_object('estado','ya_coincide');
    end if;

    if r.id is null or e.id is null
        or (select count(*) from public.reserva_estadias where reserva_id = r.id) <> 1
        or p_esperado is distinct from jsonb_build_object(
            'estadia_id',e.id,'titular',r.titular_nombre,'estado_reserva',r.estado_reserva,
            'estado_estadia',e.estado_estadia,'cabana_id',e.cabana_id,
            'entrada',e.fecha_ingreso,'salida',e.fecha_salida
        ) then
        motivo := 'La reserva o sus fechas cambiaron. Vuelve a comparar.';
    elsif coalesce(r.estado_reserva,'') not in ('pendiente','confirmada')
        or coalesce(e.estado_estadia,'') not in ('pendiente','confirmada','sin_checkin')
        or e.checkin_realizado_en is not null or e.checkout_realizado_en is not null then
        motivo := 'La estadía tiene actividad operativa o un estado que requiere revisión.';
    elsif exists (select 1 from public.servicios s where (s.reserva_id = r.id or s.estadia_id = e.id)
            and s.estado_servicio is distinct from 'cancelado') then
        motivo := 'Revisa los servicios asociados antes de cancelar.';
    elsif exists (select 1 from public.pagos p where p.reserva_id = r.id)
        or exists (select 1 from public.cargo_ajustes a where a.reserva_id = r.id)
        or exists (select 1 from public.pago_aplicaciones a
            join public.cargos c on c.id = a.cargo_id where c.reserva_id = r.id or c.estadia_id = e.id) then
        motivo := 'Hay pagos, aplicaciones o ajustes que requieren revisión.';
    end if;
    if motivo is not null then
        return jsonb_build_object('estado','revision','motivo',motivo);
    end if;
    if p_confirmar is not true then
        return jsonb_build_object('estado','listo');
    end if;
    perform public.haiku_cancelar_reserva(r.id);
    return jsonb_build_object('estado','cancelada');
end;
$function$;
revoke all on function public.haiku_libro_cancelacion_segura_lote_v1(uuid,jsonb,boolean) from public,anon;
grant execute on function public.haiku_libro_cancelacion_segura_lote_v1(uuid,jsonb,boolean) to authenticated;
