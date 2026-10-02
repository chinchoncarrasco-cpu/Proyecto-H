-- No aplicar al remoto sin revision. Append-only; sin cambios de catalogo/RLS.
begin;

-- Unica evaluacion de cierre limpio; invoker conserva RLS.
create or replace function private.haiku_evaluar_cierre(p_cierre_id uuid)
returns table(total_requeridos integer, completados integer, pendientes integer,
              bloqueo_global boolean, bloqueo_cabana boolean, puede_cerrar_limpio boolean)
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
    v_global_total integer := 0;
    v_global_ok integer := 0;
    v_cab_total integer := 0;
    v_cab_ok integer := 0;
    v_total integer := 0;
    v_ok integer := 0;
    v_pendientes integer := 0;
    v_cab record;
    v_ocupada boolean := false;
    v_tmp_total integer := 0;
    v_tmp_ok integer := 0;
    v_bloqueo_global boolean := false;
    v_bloqueo_cabana boolean := false;
begin
    select count(*) into v_global_total
    from public.cierre_checklist_items i
    where i.activo = true
      and i.obligatorio = true
      and i.alcance = 'global';

    select count(*) into v_global_ok
    from public.cierre_checklist_items i
    join public.cierre_respuestas r
      on r.item_id = i.id
     and r.cierre_id = p_cierre_id
     and r.cabana_id is null
    where i.activo = true
      and i.obligatorio = true
      and i.alcance = 'global'
      and (
        r.estado = 'no_corresponde'
        or (
          r.estado = 'confirmado'
          and (
            i.tipo_respuesta <> 'booleano'
            or r.valor = 'true'::jsonb
          )
        )
      );

    for v_cab in
        select c.id, c.numero
        from public.cabanas c
        where c.activa = true
        order by c.numero
    loop
        select exists (
            select 1
            from public.cierre_respuestas r
            join public.cierre_checklist_items i on i.id = r.item_id
            where r.cierre_id = p_cierre_id
              and r.cabana_id = v_cab.id
              and i.codigo = 'cabana_ocupada'
              and (
                r.estado = 'no_corresponde'
                or (r.estado = 'confirmado' and r.valor = 'true'::jsonb)
              )
        ) into v_ocupada;

        if v_ocupada then
            v_cab_total := v_cab_total + 1;
            v_cab_ok := v_cab_ok + 1;
        else
            select count(*) into v_tmp_total
            from public.cierre_checklist_items i
            where i.activo = true
              and i.obligatorio = true
              and i.alcance = 'cabana'
              and i.codigo <> 'cabana_ocupada';

            select count(*) into v_tmp_ok
            from public.cierre_checklist_items i
            join public.cierre_respuestas r
              on r.item_id = i.id
             and r.cierre_id = p_cierre_id
             and r.cabana_id = v_cab.id
            where i.activo = true
              and i.obligatorio = true
              and i.alcance = 'cabana'
              and i.codigo <> 'cabana_ocupada'
              and (
                r.estado = 'no_corresponde'
                or (
                  r.estado = 'confirmado'
                  and (
                    i.tipo_respuesta <> 'booleano'
                    or r.valor = 'true'::jsonb
                  )
                )
              );

            v_cab_total := v_cab_total + v_tmp_total;
            v_cab_ok := v_cab_ok + v_tmp_ok;
        end if;
    end loop;

    v_total := v_global_total + v_cab_total;
    v_ok := v_global_ok + v_cab_ok;
    v_pendientes := greatest(v_total - v_ok, 0);


    -- Estas reglas bloqueantes conservan exactamente la semantica del trigger previo:
    -- no_corresponde satisface el item, pero solo ocupada confirmada true exime otros bloqueantes.
    -- Controles globales bloqueantes.
    if exists (
      select 1
      from public.cierre_checklist_items i
      where i.activo=true and i.alcance='global' and i.bloquea_cierre=true
        and not exists (
          select 1 from public.cierre_respuestas r
          where r.cierre_id=p_cierre_id and r.item_id=i.id and r.cabana_id is null
            and r.estado in ('confirmado','no_corresponde')
        )
    ) then
      v_bloqueo_global := true;
    end if;

    -- Controles de CAB bloqueantes. Si la CAB está marcada ocupada=true, se omiten los demás.
    if exists (
      select 1
      from public.cabanas c
      cross join public.cierre_checklist_items i
      where c.activa=true and i.activo=true and i.alcance='cabana' and i.bloquea_cierre=true
        and not (
          i.codigo <> 'cabana_ocupada'
          and exists (
            select 1 from public.cierre_respuestas ro
            join public.cierre_checklist_items io on io.id=ro.item_id
            where ro.cierre_id=p_cierre_id and ro.cabana_id=c.id
              and io.codigo='cabana_ocupada' and ro.estado='confirmado'
              and coalesce((ro.valor #>> '{}')::boolean,false)=true
          )
        )
        and not exists (
          select 1 from public.cierre_respuestas r
          where r.cierre_id=p_cierre_id and r.item_id=i.id and r.cabana_id=c.id
            and r.estado in ('confirmado','no_corresponde')
        )
    ) then
      v_bloqueo_cabana := true;
    end if;


    return query select v_total, v_ok, v_pendientes,
        v_bloqueo_global, v_bloqueo_cabana,
        v_pendientes = 0 and not v_bloqueo_global and not v_bloqueo_cabana;
end;
$function$;
revoke all on function private.haiku_evaluar_cierre(uuid) from public, anon;
grant execute on function private.haiku_evaluar_cierre(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.haiku_estado_cierre_dia(p_fecha date, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_turno public.turnos%rowtype;
    v_cierre public.cierres_turno%rowtype;
    v_evaluacion record;

begin
    if p_fecha is null then
        raise exception 'La fecha es obligatoria';
    end if;

    if not private.haiku_tiene_permiso('cierres.ver') then
        raise exception 'Sin permiso para ver cierres';
    end if;

    select t.* into v_turno
    from public.turnos t
    where t.fecha_operativa = p_fecha
      and t.tipo_turno = coalesce(nullif(btrim(p_tipo_turno), ''), 'cierre_diario')
    limit 1;

    if v_turno.id is null then
        raise exception 'No existe turno para la fecha indicada';
    end if;

    select c.* into v_cierre
    from public.cierres_turno c
    where c.turno_id = v_turno.id
    limit 1;

    if v_cierre.id is null then
        raise exception 'No existe cierre para la fecha indicada';
    end if;

    select * into v_evaluacion from private.haiku_evaluar_cierre(v_cierre.id);

    return jsonb_build_object(
        'turno_id', v_turno.id,
        'cierre_id', v_cierre.id,
        'fecha_operativa', v_turno.fecha_operativa,
        'turno_estado', v_turno.estado,
        'cierre_estado', v_cierre.estado,
        'total_requeridos', v_evaluacion.total_requeridos,
        'completados', v_evaluacion.completados,
        'pendientes', v_evaluacion.pendientes,
        'porcentaje', case when v_evaluacion.total_requeridos = 0 then 100 else round((v_evaluacion.completados::numeric / v_evaluacion.total_requeridos::numeric) * 100)::integer end,
        'puede_cerrar_limpio', v_evaluacion.puede_cerrar_limpio,
        'resumen_entrega', v_cierre.resumen_entrega,
        'novedades', v_cierre.novedades,
        'cerrado_en', v_cierre.cerrado_en,
        'cerrado_por', v_cierre.cerrado_por,
        'reabierto_en', v_cierre.reabierto_en,
        'reabierto_por', v_cierre.reabierto_por
    );
end;
$function$;

create or replace function public.haiku_validar_cierre_turno()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
    v_evaluacion record;
begin
    if new.estado in ('cerrado', 'cerrado_con_pendientes') then
        select * into v_evaluacion from private.haiku_evaluar_cierre(new.id);
        if v_evaluacion.bloqueo_global then
            raise exception 'No se puede cerrar el turno: existen controles globales bloqueantes pendientes';
        end if;
        if v_evaluacion.bloqueo_cabana then
            raise exception 'No se puede cerrar el turno: existen controles de cabaña bloqueantes pendientes';
        end if;
        if new.estado = 'cerrado' and not v_evaluacion.puede_cerrar_limpio then
            raise exception 'Use cerrado_con_pendientes o resuelva todos los controles obligatorios';
        end if;
    end if;
    return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_guardar_respuesta_cierre(p_fecha date, p_codigo text, p_estado text, p_valor jsonb DEFAULT NULL::jsonb, p_observacion text DEFAULT NULL::text, p_cabana_numero smallint DEFAULT NULL::smallint, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_base jsonb;
    v_cierre_id uuid;
    v_item public.cierre_checklist_items%rowtype;
    v_cabana_id uuid;
    v_respuesta_id uuid;
    v_confirmado_por uuid;
    v_confirmado_en timestamptz;
    v_cierre_estado text;
    v_llaves_completas boolean;
begin
    if p_fecha is null or nullif(btrim(p_codigo), '') is null then
        raise exception 'Fecha y código son obligatorios';
    end if;

    if p_estado not in ('pendiente', 'confirmado', 'no_corresponde') then
        raise exception 'Estado de respuesta inválido';
    end if;

    if not private.haiku_tiene_permiso('cierres.realizar') then
        raise exception 'Sin permiso para realizar cierres';
    end if;

    select * into v_item
    from public.cierre_checklist_items
    where codigo = p_codigo
      and activo = true
    limit 1;

    if v_item.id is null then
        raise exception 'Ítem de cierre inexistente: %', p_codigo;
    end if;

    if v_item.permiso_requerido is not null
       and p_estado = 'confirmado'
       and not private.haiku_tiene_permiso(v_item.permiso_requerido) then
        raise exception 'Sin permiso para confirmar %', p_codigo;
    end if;

    if v_item.alcance = 'cabana' then
        if p_cabana_numero is null then
            raise exception 'El ítem % requiere cabaña', p_codigo;
        end if;

        select id into v_cabana_id
        from public.cabanas
        where numero = p_cabana_numero
          and activa = true
        limit 1;

        if v_cabana_id is null then
            raise exception 'Cabaña no encontrada: %', p_cabana_numero;
        end if;
    else
        v_cabana_id := null;
    end if;

    v_base := public.haiku_asegurar_cierre_dia(p_fecha, p_tipo_turno);
    v_cierre_id := (v_base->>'cierre_id')::uuid;

    -- Serializa detalle + derivacion y coordina con el lock de cerrar_turno_dia.
    select estado into v_cierre_estado
    from public.cierres_turno where id = v_cierre_id for update;
    if v_cierre_estado not in ('borrador', 'reabierto') then
        raise exception 'El cierre ya no admite edición normal';
    end if;

    if p_estado = 'pendiente' then
        v_confirmado_por := null;
        v_confirmado_en := null;
    else
        v_confirmado_por := auth.uid();
        v_confirmado_en := now();
    end if;

    if v_cabana_id is null then
        insert into public.cierre_respuestas (
            cierre_id, item_id, cabana_id, estado, valor,
            observacion, confirmado_por, confirmado_en, origen
        ) values (
            v_cierre_id, v_item.id, null, p_estado, p_valor,
            p_observacion, v_confirmado_por, v_confirmado_en, 'usuario'
        )
        on conflict (cierre_id, item_id) where cabana_id is null
        do update set
            estado = excluded.estado,
            valor = excluded.valor,
            observacion = excluded.observacion,
            confirmado_por = excluded.confirmado_por,
            confirmado_en = excluded.confirmado_en,
            origen = 'usuario',
            actualizado_en = now()
        returning id into v_respuesta_id;
    else
        insert into public.cierre_respuestas (
            cierre_id, item_id, cabana_id, estado, valor,
            observacion, confirmado_por, confirmado_en, origen
        ) values (
            v_cierre_id, v_item.id, v_cabana_id, p_estado, p_valor,
            p_observacion, v_confirmado_por, v_confirmado_en, 'usuario'
        )
        on conflict (cierre_id, item_id, cabana_id) where cabana_id is not null
        do update set
            estado = excluded.estado,
            valor = excluded.valor,
            observacion = excluded.observacion,
            confirmado_por = excluded.confirmado_por,
            confirmado_en = excluded.confirmado_en,
            origen = 'usuario',
            actualizado_en = now()
        returning id into v_respuesta_id;
    end if;

    -- 11 llaves completas -> llaves_retiradas satisfecho.
    -- Mismo mecanismo canonico, permisos, upsert y transaccion; sin segunda pregunta.
    if p_codigo = 'llaves_recepcion' then
        v_llaves_completas := p_estado = 'confirmado' and coalesce(
            p_valor @> '{"tonel":true,"jacuzzi":true,"lavanderia":true,"masajes":true,
                "generadores":true,"jardineria":true,"marcelo":true,"cisterna":true,
                "internet":true,"gas11":true,"torreon":true}'::jsonb, false);
        perform public.haiku_guardar_respuesta_cierre(
            p_fecha, 'llaves_retiradas',
            case when v_llaves_completas then 'confirmado' else 'pendiente' end,
            case when v_llaves_completas then '"si"'::jsonb else 'null'::jsonb end,
            null, null::smallint, p_tipo_turno
        );
    end if;

    return jsonb_build_object(
        'respuesta_id', v_respuesta_id,
        'cierre_id', v_cierre_id,
        'codigo', p_codigo,
        'estado', p_estado,
        'cabana_numero', p_cabana_numero
    );
end;
$function$;

commit;
