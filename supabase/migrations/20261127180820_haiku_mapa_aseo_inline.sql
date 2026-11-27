-- El mapa trabaja sobre el mismo aseo diario y permisos de Cabañas.
begin;

create function public.haiku_mapa_aseo_v1(
    p_numero integer, p_fecha date, p_cambios jsonb default null, p_version timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_cabana uuid;
    v_aseo public.aseos;
    v_leer boolean;
    v_editar boolean;
    v_inicio timestamptz;
    v_fin timestamptz;
    v_no_requiere boolean;
    v_estado text;
begin
    if v_actor is null or private.haiku_usuario_activo() is not true
        or private.haiku_tiene_permiso('cabanas.ver') is not true then
        raise exception 'Tu sesión no tiene acceso al mapa.' using errcode = '42501';
    end if;
    if p_fecha is distinct from (now() at time zone 'America/Santiago')::date then
        raise exception 'El día operativo cambió. Actualiza el mapa.' using errcode = '22023';
    end if;
    select c.id into v_cabana from public.cabanas c where c.numero = p_numero and c.activa;
    if v_cabana is null then
        raise exception 'Cabaña no disponible.' using errcode = 'P0002';
    end if;

    select a.* into v_aseo from public.aseos a where a.fecha = p_fecha and a.cabana_id = v_cabana;
    v_leer := v_aseo.id is not null or private.haiku_tiene_permiso('aseos.ver_todos') is true;
    v_editar := v_leer and (private.haiku_tiene_permiso('aseos.gestionar_todos') is true
        or (v_aseo.asignado_a is not distinct from v_actor
            and private.haiku_tiene_permiso('aseos.gestionar_asignados') is true));

    if p_cambios is not null and p_cambios <> '{}'::jsonb then
        if not v_editar then
            raise exception 'Tu sesión puede consultar el mapa. La edición de este aseo requiere permiso.'
                using errcode = '42501';
        end if;
        if v_aseo.actualizado_en is distinct from p_version then
            raise exception 'El aseo cambió en otro dispositivo. Actualiza el detalle antes de guardar.'
                using errcode = '40001';
        end if;
        if jsonb_typeof(p_cambios) <> 'object' then
            raise exception 'Revisa los campos de aseo.' using errcode = '22023';
        end if;
        if p_cambios - array['encargado','revisor','inicio','fin','no_requiere','observacion'] <> '{}'::jsonb
            or exists (select 1 from jsonb_each(p_cambios) f
                where jsonb_typeof(f.value) <> case when f.key = 'no_requiere' then 'boolean' else 'string' end) then
            raise exception 'Revisa los campos de aseo.' using errcode = '22023';
        end if;
        if exists (select 1 from jsonb_each_text(p_cambios) f
                where f.key in ('inicio','fin') and f.value <> '' and f.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
            raise exception 'Registra las horas de aseo en formato de 24 horas.' using errcode = '22023';
        end if;
        if length(p_cambios->>'encargado') > 80 or length(p_cambios->>'revisor') > 80 or length(p_cambios->>'observacion') > 1000 then
            raise exception 'Revisa la longitud de los nombres y la observación.' using errcode = '22023';
        end if;

        v_inicio := case when p_cambios ? 'inicio' then
            (p_fecha + nullif(p_cambios->>'inicio', '')::time) at time zone 'America/Santiago'
            else v_aseo.iniciado_en end;
        v_fin := case when p_cambios ? 'fin' then
            (p_fecha + nullif(p_cambios->>'fin', '')::time) at time zone 'America/Santiago'
            else v_aseo.completado_en end;
        v_no_requiere := coalesce((p_cambios->>'no_requiere')::boolean, v_aseo.estado = 'no_requiere', false);
        v_estado := coalesce(v_aseo.estado, 'pendiente');
        if p_cambios ?| array['inicio','fin','no_requiere'] then
            if v_fin is not null and (v_inicio is null or v_fin < v_inicio) then
                raise exception 'Registra IN antes de OUT y revisa el orden de las horas.' using errcode = '22023';
            end if;
            if v_no_requiere and (v_inicio is not null or v_fin is not null) then
                raise exception 'No requiere es incompatible con horas de aseo.' using errcode = '22023';
            end if;
            v_estado := case when v_no_requiere then 'no_requiere' when v_fin is not null then 'completado'
                when v_inicio is not null then 'en_proceso' else 'pendiente' end;
        end if;

        if v_aseo.id is null then
            insert into public.aseos (
                fecha, cabana_id, tipo_aseo, estado, creado_por, estadia_salida_id, estadia_ingreso_id,
                encargado_nombre, revisor_nombre, iniciado_en, completado_en, observaciones
            )
            select p_fecha, v_cabana, 'salida', v_estado, v_actor,
                case when private.haiku_tiene_permiso('reservas.ver') is true then o.salida_estadia_id end,
                case when private.haiku_tiene_permiso('reservas.ver') is true then o.ingreso_estadia_id end,
                nullif(btrim(p_cambios->>'encargado'), ''), nullif(btrim(p_cambios->>'revisor'), ''),
                v_inicio, v_fin, nullif(btrim(p_cambios->>'observacion'), '')
            from public.haiku_operacion_dia(p_fecha) o where o.cabana_id = v_cabana
            on conflict (fecha, cabana_id) do nothing
            returning * into v_aseo;
        else
            update public.aseos a set
                estado = v_estado,
                encargado_nombre = case when p_cambios ? 'encargado' then nullif(btrim(p_cambios->>'encargado'), '') else a.encargado_nombre end,
                revisor_nombre = case when p_cambios ? 'revisor' then nullif(btrim(p_cambios->>'revisor'), '') else a.revisor_nombre end,
                iniciado_en = v_inicio, completado_en = v_fin,
                observaciones = case when p_cambios ? 'observacion' then nullif(btrim(p_cambios->>'observacion'), '') else a.observaciones end
            where a.id = v_aseo.id and a.actualizado_en = p_version
            returning * into v_aseo;
        end if;
        if not found then
            raise exception 'El aseo cambió en otro dispositivo. Actualiza el detalle antes de guardar.'
                using errcode = '40001';
        end if;
    end if;

    return jsonb_build_object(
        'puede_leer', v_leer, 'puede_editar', v_editar, 'version', v_aseo.actualizado_en,
        'estado', v_aseo.estado, 'encargado', v_aseo.encargado_nombre, 'revisor', v_aseo.revisor_nombre,
        'inicio', v_aseo.iniciado_en, 'fin', v_aseo.completado_en, 'observacion', v_aseo.observaciones
    );
end
$$;

revoke all on function public.haiku_mapa_aseo_v1(integer, date, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.haiku_mapa_aseo_v1(integer, date, jsonb, timestamptz) to authenticated;

commit;
