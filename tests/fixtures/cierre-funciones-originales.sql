-- Solo fixture local: funciones capturadas en modo read-only el 2026-10-01.
CREATE OR REPLACE FUNCTION public.haiku_validar_cierre_turno()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.estado in ('cerrado','cerrado_con_pendientes') then

    -- Controles globales bloqueantes.
    if exists (
      select 1
      from public.cierre_checklist_items i
      where i.activo=true and i.alcance='global' and i.bloquea_cierre=true
        and not exists (
          select 1 from public.cierre_respuestas r
          where r.cierre_id=new.id and r.item_id=i.id and r.cabana_id is null
            and r.estado in ('confirmado','no_corresponde')
        )
    ) then
      raise exception 'No se puede cerrar el turno: existen controles globales bloqueantes pendientes';
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
            where ro.cierre_id=new.id and ro.cabana_id=c.id
              and io.codigo='cabana_ocupada' and ro.estado='confirmado'
              and coalesce((ro.valor #>> '{}')::boolean,false)=true
          )
        )
        and not exists (
          select 1 from public.cierre_respuestas r
          where r.cierre_id=new.id and r.item_id=i.id and r.cabana_id=c.id
            and r.estado in ('confirmado','no_corresponde')
        )
    ) then
      raise exception 'No se puede cerrar el turno: existen controles de cabaña bloqueantes pendientes';
    end if;

    if new.estado='cerrado' then
      -- Globales obligatorios.
      if exists (
        select 1 from public.cierre_checklist_items i
        where i.activo=true and i.alcance='global' and i.obligatorio=true
          and not exists (
            select 1 from public.cierre_respuestas r
            where r.cierre_id=new.id and r.item_id=i.id and r.cabana_id is null
              and r.estado in ('confirmado','no_corresponde')
          )
      ) then
        raise exception 'Use cerrado_con_pendientes o resuelva todos los controles globales obligatorios';
      end if;

      -- Por CAB: exigir primero CAB ocupada/no revisar; si es false, exigir los siete controles.
      if exists (
        select 1
        from public.cabanas c
        where c.activa=true
          and (
            not exists (
              select 1 from public.cierre_respuestas ro
              join public.cierre_checklist_items io on io.id=ro.item_id
              where ro.cierre_id=new.id and ro.cabana_id=c.id
                and io.codigo='cabana_ocupada'
                and ro.estado in ('confirmado','no_corresponde')
            )
            or (
              not exists (
                select 1 from public.cierre_respuestas ro
                join public.cierre_checklist_items io on io.id=ro.item_id
                where ro.cierre_id=new.id and ro.cabana_id=c.id
                  and io.codigo='cabana_ocupada' and ro.estado='confirmado'
                  and coalesce((ro.valor #>> '{}')::boolean,false)=true
              )
              and exists (
                select 1 from public.cierre_checklist_items i
                where i.activo=true and i.alcance='cabana' and i.obligatorio=true
                  and i.codigo <> 'cabana_ocupada'
                  and not exists (
                    select 1 from public.cierre_respuestas r
                    where r.cierre_id=new.id and r.item_id=i.id and r.cabana_id=c.id
                      and r.estado in ('confirmado','no_corresponde')
                  )
              )
            )
          )
      ) then
        raise exception 'Use cerrado_con_pendientes o complete la revisión de todas las cabañas';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_validar_respuesta_cierre()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_alcance text;
  v_permiso text;
begin
  select alcance, permiso_requerido
    into v_alcance, v_permiso
  from public.cierre_checklist_items
  where id = new.item_id;

  if v_alcance = 'global' and new.cabana_id is not null then
    raise exception 'Este control de cierre es global y no admite cabaña';
  end if;

  if v_alcance = 'cabana' and new.cabana_id is null then
    raise exception 'Este control de cierre requiere una cabaña';
  end if;

  if auth.uid() is not null and v_permiso is not null and new.estado <> 'pendiente' then
    if not private.haiku_tiene_permiso(v_permiso) then
      raise exception 'No posee el permiso requerido para confirmar este control' using errcode='42501';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_asegurar_cierre_dia(p_fecha date, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_turno public.turnos%rowtype;
    v_cierre public.cierres_turno%rowtype;
begin
    if p_fecha is null then
        raise exception 'La fecha es obligatoria';
    end if;

    if not private.haiku_tiene_permiso('cierres.realizar') then
        raise exception 'Sin permiso para realizar cierres';
    end if;

    insert into public.turnos (
        fecha_operativa,
        tipo_turno,
        estado,
        iniciado_por,
        iniciado_en
    ) values (
        p_fecha,
        coalesce(nullif(btrim(p_tipo_turno), ''), 'cierre_diario'),
        'abierto',
        auth.uid(),
        now()
    )
    on conflict (fecha_operativa, tipo_turno)
    do nothing;

    select * into v_turno
    from public.turnos
    where fecha_operativa = p_fecha
      and tipo_turno = coalesce(nullif(btrim(p_tipo_turno), ''), 'cierre_diario')
    limit 1;

    if v_turno.id is null then
        raise exception 'No fue posible obtener el turno del día';
    end if;

    insert into public.cierres_turno (
        turno_id,
        estado,
        snapshot
    ) values (
        v_turno.id,
        'borrador',
        '{}'::jsonb
    )
    on conflict (turno_id)
    do nothing;

    select * into v_cierre
    from public.cierres_turno
    where turno_id = v_turno.id
    limit 1;

    if v_cierre.id is null then
        raise exception 'No fue posible obtener el cierre del día';
    end if;

    return jsonb_build_object(
        'turno_id', v_turno.id,
        'cierre_id', v_cierre.id,
        'turno_estado', v_turno.estado,
        'cierre_estado', v_cierre.estado,
        'fecha_operativa', v_turno.fecha_operativa,
        'tipo_turno', v_turno.tipo_turno
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_guardar_novedades_cierre(p_fecha date, p_novedades text, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_base jsonb;
    v_cierre_id uuid;
begin
    if not private.haiku_tiene_permiso('cierres.realizar') then
        raise exception 'Sin permiso para realizar cierres';
    end if;

    v_base := public.haiku_asegurar_cierre_dia(p_fecha, p_tipo_turno);
    v_cierre_id := (v_base->>'cierre_id')::uuid;

    if (v_base->>'cierre_estado') not in ('borrador', 'reabierto') then
        raise exception 'El cierre ya no admite edición normal';
    end if;

    update public.cierres_turno
    set novedades = nullif(p_novedades, ''),
        actualizado_en = now()
    where id = v_cierre_id;

    return jsonb_build_object('cierre_id', v_cierre_id, 'guardado', true);
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

    if (v_base->>'cierre_estado') not in ('borrador', 'reabierto') then
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

    return jsonb_build_object(
        'respuesta_id', v_respuesta_id,
        'cierre_id', v_cierre_id,
        'codigo', p_codigo,
        'estado', p_estado,
        'cabana_numero', p_cabana_numero
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_estado_cierre_dia(p_fecha date, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_turno public.turnos%rowtype;
    v_cierre public.cierres_turno%rowtype;
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

    select count(*) into v_global_total
    from public.cierre_checklist_items i
    where i.activo = true
      and i.obligatorio = true
      and i.alcance = 'global';

    select count(*) into v_global_ok
    from public.cierre_checklist_items i
    join public.cierre_respuestas r
      on r.item_id = i.id
     and r.cierre_id = v_cierre.id
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
            where r.cierre_id = v_cierre.id
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
             and r.cierre_id = v_cierre.id
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

    return jsonb_build_object(
        'turno_id', v_turno.id,
        'cierre_id', v_cierre.id,
        'fecha_operativa', v_turno.fecha_operativa,
        'turno_estado', v_turno.estado,
        'cierre_estado', v_cierre.estado,
        'total_requeridos', v_total,
        'completados', v_ok,
        'pendientes', v_pendientes,
        'porcentaje', case when v_total = 0 then 100 else round((v_ok::numeric / v_total::numeric) * 100)::integer end,
        'puede_cerrar_limpio', v_pendientes = 0,
        'resumen_entrega', v_cierre.resumen_entrega,
        'novedades', v_cierre.novedades,
        'cerrado_en', v_cierre.cerrado_en,
        'cerrado_por', v_cierre.cerrado_por,
        'reabierto_en', v_cierre.reabierto_en,
        'reabierto_por', v_cierre.reabierto_por
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_reabrir_cierre_dia(p_fecha date, p_motivo text, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_turno public.turnos%rowtype;
    v_cierre public.cierres_turno%rowtype;
    v_motivo text;
begin
    if p_fecha is null then
        raise exception 'La fecha es obligatoria';
    end if;

    if not private.haiku_tiene_permiso('cierres.reabrir') then
        raise exception 'Sin permiso para reabrir cierres';
    end if;

    v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
    if v_motivo is null then
        raise exception 'El motivo de reapertura es obligatorio';
    end if;

    select t.* into v_turno
    from public.turnos t
    where t.fecha_operativa = p_fecha
      and t.tipo_turno = coalesce(nullif(btrim(p_tipo_turno), ''), 'cierre_diario')
    for update;

    if v_turno.id is null then
        raise exception 'No existe turno para la fecha indicada';
    end if;

    select c.* into v_cierre
    from public.cierres_turno c
    where c.turno_id = v_turno.id
    for update;

    if v_cierre.id is null then
        raise exception 'No existe cierre para la fecha indicada';
    end if;

    if v_cierre.estado not in ('cerrado', 'cerrado_con_pendientes') then
        raise exception 'El cierre no está cerrado';
    end if;

    update public.cierres_turno
    set estado = 'reabierto',
        reabierto_por = auth.uid(),
        reabierto_en = now(),
        motivo_reapertura = v_motivo,
        actualizado_en = now()
    where id = v_cierre.id;

    update public.turnos
    set estado = 'abierto',
        finalizado_por = null,
        finalizado_en = null,
        actualizado_en = now()
    where id = v_turno.id;

    return public.haiku_estado_cierre_dia(p_fecha, p_tipo_turno);
end;
$function$;

CREATE OR REPLACE FUNCTION private.haiku_auditar_estado_cierre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_fecha date;
    v_accion text;
    v_descripcion text;
begin
    if old.estado is not distinct from new.estado then
        return new;
    end if;

    select t.fecha_operativa into v_fecha
    from public.turnos t
    where t.id = new.turno_id;

    if new.estado = 'reabierto' then
        v_accion := 'reabrir_cierre';
        v_descripcion := 'Cierre de turno reabierto';
    elsif new.estado in ('cerrado', 'cerrado_con_pendientes') then
        v_accion := 'cerrar_turno';
        v_descripcion := case
            when new.estado = 'cerrado' then 'Cierre de turno completado'
            else 'Cierre de turno realizado con pendientes'
        end;
    else
        v_accion := 'cambiar_estado_cierre';
        v_descripcion := 'Estado de cierre modificado';
    end if;

    insert into public.eventos_auditoria (
        usuario_id, accion, tipo_evento, entidad_tipo, entidad_id,
        turno_id, descripcion, cambios, datos_contexto, origen
    ) values (
        auth.uid(),
        v_accion,
        'cierre_turno',
        'cierre_turno',
        new.id,
        new.turno_id,
        v_descripcion,
        jsonb_build_array(jsonb_build_object(
            'campo', 'estado',
            'antes', old.estado,
            'despues', new.estado
        )),
        jsonb_build_object(
            'fecha_operativa', v_fecha,
            'resumen_entrega', new.resumen_entrega,
            'motivo_reapertura', new.motivo_reapertura
        ),
        'usuario'
    );

    return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.haiku_cerrar_turno_dia(p_fecha date, p_resumen_entrega text DEFAULT NULL::text, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_estado jsonb;
    v_turno public.turnos%rowtype;
    v_cierre public.cierres_turno%rowtype;
    v_nuevo_estado text;
    v_respuestas jsonb := '[]'::jsonb;
    v_evidencias jsonb := '[]'::jsonb;
    v_snapshot jsonb := '{}'::jsonb;
    v_pendientes integer := 0;
    v_resumen text;
begin
    if p_fecha is null then
        raise exception 'La fecha es obligatoria';
    end if;

    if not private.haiku_tiene_permiso('cierres.realizar') then
        raise exception 'Sin permiso para cerrar el turno';
    end if;

    select t.* into v_turno
    from public.turnos t
    where t.fecha_operativa = p_fecha
      and t.tipo_turno = coalesce(nullif(btrim(p_tipo_turno), ''), 'cierre_diario')
    for update;

    if v_turno.id is null then
        raise exception 'No existe turno para la fecha indicada';
    end if;

    select c.* into v_cierre
    from public.cierres_turno c
    where c.turno_id = v_turno.id
    for update;

    if v_cierre.id is null then
        raise exception 'No existe cierre para la fecha indicada';
    end if;

    if v_cierre.estado in ('cerrado', 'cerrado_con_pendientes') then
        return public.haiku_estado_cierre_dia(p_fecha, p_tipo_turno);
    end if;

    if v_cierre.estado not in ('borrador', 'reabierto') then
        raise exception 'Estado de cierre no editable: %', v_cierre.estado;
    end if;

    v_estado := public.haiku_estado_cierre_dia(p_fecha, p_tipo_turno);
    v_pendientes := coalesce((v_estado->>'pendientes')::integer, 0);
    v_resumen := nullif(btrim(coalesce(p_resumen_entrega, '')), '');

    if v_pendientes > 0 and v_resumen is null then
        raise exception 'Hay % pendientes: indique un resumen de entrega', v_pendientes;
    end if;

    v_nuevo_estado := case when v_pendientes = 0 then 'cerrado' else 'cerrado_con_pendientes' end;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'codigo', i.codigo,
            'nombre', i.nombre,
            'categoria', i.categoria,
            'cabana_numero', cb.numero,
            'estado', r.estado,
            'valor', r.valor,
            'observacion', r.observacion,
            'confirmado_por', r.confirmado_por,
            'confirmado_en', r.confirmado_en,
            'origen', r.origen
        ) order by i.orden_visual nulls last, cb.numero nulls first
    ), '[]'::jsonb)
    into v_respuestas
    from public.cierre_respuestas r
    join public.cierre_checklist_items i on i.id = r.item_id
    left join public.cabanas cb on cb.id = r.cabana_id
    where r.cierre_id = v_cierre.id;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', e.id,
            'storage_bucket', e.storage_bucket,
            'storage_path', e.storage_path,
            'mime_type', e.mime_type,
            'tamano_bytes', e.tamano_bytes,
            'descripcion', e.descripcion,
            'subido_por', e.subido_por,
            'creado_en', e.creado_en
        ) order by e.creado_en
    ), '[]'::jsonb)
    into v_evidencias
    from public.evidencias e
    where e.cierre_id = v_cierre.id;

    v_snapshot := jsonb_build_object(
        'version', 1,
        'fecha_operativa', p_fecha,
        'tipo_turno', v_turno.tipo_turno,
        'evaluacion', v_estado,
        'novedades', v_cierre.novedades,
        'resumen_entrega', v_resumen,
        'respuestas', v_respuestas,
        'evidencias', v_evidencias,
        'capturado_en', now(),
        'capturado_por', auth.uid()
    );

    update public.cierres_turno
    set estado = v_nuevo_estado,
        resumen_entrega = v_resumen,
        snapshot = v_snapshot,
        cerrado_por = auth.uid(),
        cerrado_en = now(),
        actualizado_en = now()
    where id = v_cierre.id;

    update public.turnos
    set estado = 'cerrado',
        finalizado_por = auth.uid(),
        finalizado_en = now(),
        actualizado_en = now()
    where id = v_turno.id;

    return public.haiku_estado_cierre_dia(p_fecha, p_tipo_turno);
end;
$function$;
