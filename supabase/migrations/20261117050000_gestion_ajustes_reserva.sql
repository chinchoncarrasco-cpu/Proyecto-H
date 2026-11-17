create or replace function public.haiku_gestionar_ajuste_reserva_v1(
    p_reserva_id uuid,
    p_operacion_id uuid,
    p_monto_esperado bigint,
    p_nuevo_monto bigint default null,
    p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
    v_grupo uuid;
    v_miembro uuid;
    v_tipo text;
    v_monto bigint;
    v_valido boolean;
    v_cargos uuid[];
    v_reemplazo jsonb;
begin
    if auth.uid() is null or private.haiku_tiene_permiso('pagos.anular') is distinct from true
        or (p_nuevo_monto is not null and private.haiku_tiene_permiso('pagos.registrar') is distinct from true) then
        raise exception 'No tienes permiso para gestionar este ajuste' using errcode = '42501';
    end if;
    if p_nuevo_monto is not null and (
        p_nuevo_monto <= 0 or p_nuevo_monto = p_monto_esperado or nullif(btrim(p_motivo),'') is null
    ) then
        raise exception 'Indica un monto distinto y el motivo de la corrección';
    end if;

    select grupo_reserva_id into v_grupo from public.reservas where id = p_reserva_id;
    if not found then raise exception 'Reserva no encontrada'; end if;

    -- Mismo bloqueo de unidad que usa el alta normal de ajustes.
    perform pg_advisory_xact_lock(hashtextextended(coalesce(v_grupo,p_reserva_id)::text,0));
    for v_miembro in
        select id from public.reservas
        where id = p_reserva_id or grupo_reserva_id = v_grupo
        order by id
    loop
        perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',v_miembro::text));
    end loop;
    perform 1 from public.reservas
    where id = p_reserva_id and grupo_reserva_id is not distinct from v_grupo for update;
    if not found then raise exception 'Cambió la unidad de la reserva. Vuelve a abrir los ajustes.'; end if;

    perform 1 from public.cargo_ajustes where operacion_id = p_operacion_id order by id for update;
    select min(a.tipo_ajuste), sum(a.monto), array_agg(a.cargo_id),
        count(distinct a.tipo_ajuste) = 1 and bool_and(coalesce(
            a.estado = 'activo' and c.estado = 'activo' and c.tipo_cargo = 'alojamiento'
            and a.reserva_id = c.reserva_id
            and (r.id = p_reserva_id or (v_grupo is not null and r.grupo_reserva_id = v_grupo))
            and ((a.tipo_ajuste = 'iva_exento' and a.signo = -1) or
                (a.tipo_ajuste in ('cargo_cancelacion','cargo_modificacion') and a.signo = 1
                 and a.concepto in ('Cargo 10% · Cancelación','Cargo 10% · Modificación'))), false))
      into v_tipo, v_monto, v_cargos, v_valido
      from public.cargo_ajustes a
      left join public.reservas r on r.id = a.reserva_id
      left join public.cargos c on c.id = a.cargo_id
     where a.operacion_id = p_operacion_id;
    if v_valido is distinct from true or v_monto is distinct from p_monto_esperado then
        raise exception 'El ajuste cambió o requiere revisión. Vuelve a abrir los ajustes.';
    end if;
    if p_nuevo_monto is not null and v_tipo not in ('cargo_cancelacion','cargo_modificacion') then
        raise exception 'Sólo se puede corregir el monto de una penalidad';
    end if;

    update public.cargo_ajustes
       set estado = 'anulado', anulado_por = auth.uid(), anulado_en = now()
     where operacion_id = p_operacion_id and estado = 'activo';

    if p_nuevo_monto is not null then
        v_reemplazo := public.haiku_aplicar_ajuste_unidad_manual(
            p_reserva_id,v_tipo,p_nuevo_monto,btrim(p_motivo)
        );
    end if;
    -- Se comprueba el resultado final de la operación completa, por cargo.
    if exists (
        select 1 from public.vista_estado_cargos
        where cargo_id = any(v_cargos) and (monto_ajustado < 0 or aplicado_neto > monto_ajustado)
    ) then
        raise exception 'Hay pagos aplicados que superarían el nuevo cargo. Revisa sus aplicaciones.';
    end if;

    return jsonb_build_object(
        'operacion_id',p_operacion_id,
        'nuevo_ajuste',v_reemplazo->'operacion_id',
        'resumen', public.haiku_resumen_ajustes_unidad(p_reserva_id)
    );
end;
$function$;

revoke all on function public.haiku_gestionar_ajuste_reserva_v1(uuid,uuid,bigint,bigint,text) from public, anon;
grant execute on function public.haiku_gestionar_ajuste_reserva_v1(uuid,uuid,bigint,bigint,text) to authenticated;
