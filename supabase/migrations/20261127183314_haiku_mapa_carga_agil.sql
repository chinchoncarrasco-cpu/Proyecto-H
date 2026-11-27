-- Resolve named guests from the reservations on the map for the current day.
begin;

create or replace function public.haiku_mapa_dia_v1()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
    v_fecha date := (now() at time zone 'America/Santiago')::date;
    v_cabanas jsonb;
    v_personas jsonb := '[]';
    v_agenda jsonb := '[]';
    v_catalogo jsonb := '[]';
    v_lavanderia jsonb;
begin
    if auth.uid() is null or private.haiku_usuario_activo() is not true
        or private.haiku_tiene_permiso('cabanas.ver') is not true then
        raise exception 'Tu sesión no tiene acceso al mapa.' using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object(
        'aseo_ultimo_listo', listo.completado_en,
        'aseo_inicio', a.iniciado_en,
        'aseo_fin', a.completado_en,
        'aseo_nota', coalesce(to_jsonb(a)->>'observaciones', to_jsonb(a)->>'nota')
    ) order by o.numero), '[]') into v_cabanas
    from public.haiku_operacion_dia(v_fecha) o
    left join public.aseos a on a.id = o.aseo_id
    left join lateral (
        select prev.completado_en
        from public.aseos prev
        where prev.cabana_id = o.cabana_id and prev.fecha < v_fecha
          and prev.completado_en is not null and prev.estado in ('completado', 'verificado')
          and not exists (
              select 1 from public.reserva_estadias e
              where e.cabana_id = prev.cabana_id and
                (e.checkin_realizado_en >= prev.completado_en or e.checkout_realizado_en >= prev.completado_en)
          )
        order by prev.completado_en desc limit 1
    ) listo on private.haiku_tiene_permiso('reservas.ver') is true
        and o.estado_operativo in ('libre-libre', 'libre-ingresa')
        and o.ingreso_checkin_en is null and (o.aseo_estado is null or o.aseo_estado = 'no_requiere');

    if private.haiku_mapa_permiso_v1('persona', false) then
        -- Match the named members of the guest directory for today's reservations.
        with reservas_dia as materialized (
            select r.id, r.titular_huesped_id, r.titular_nombre, exists (
                select 1 from public.reserva_estadias e
                where e.reserva_id = r.id and e.estado_estadia = 'hospedada'
                    and e.fecha_ingreso <= v_fecha and e.fecha_salida >= v_fecha
                    and e.checkout_realizado_en is null
            ) as hospedado
            from public.reservas r
            where (select private.haiku_huesped_puede_leer())
                and r.id in (
                    select nullif(a->>campo, '')::uuid
                    from jsonb_array_elements(v_cabanas) a
                    cross join unnest(array['ingreso_reserva_id', 'continua_reserva_id', 'fullday_reserva_id', 'salida_reserva_id']) campo
                )
        ), vinculados as (
            select r.id as reserva_id, r.titular_huesped_id as huesped_id
            from reservas_dia r where r.titular_huesped_id is not null
            union
            select h.reserva_id, h.huesped_id
            from public.reserva_huespedes h join reservas_dia r on r.id = h.reserva_id
            union
            select e.reserva_id, h.huesped_id
            from public.estadia_huespedes h
            join public.haiku_huesped_estadias_v1 e on e.id = h.estadia_id
            join reservas_dia r on r.id = e.reserva_id
        ), personas as (
            select h.id, r.id as reserva_id, h.nombre, h.apellido, r.hospedado,
                case when r.titular_huesped_id = h.id then 'titular' else 'acompanante' end as rol
            from vinculados v
            join public.huespedes h on h.id = v.huesped_id
            join reservas_dia r on r.id = v.reserva_id
            union all
            select md5('haku-huesped:' || r.id::text || ':0')::uuid, r.id,
                r.titular_nombre, null, r.hospedado, 'titular'
            from reservas_dia r where r.titular_huesped_id is null
        )
        select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'reserva_id', i.reserva_id,
            'nombre', concat_ws(' ', nullif(btrim(i.nombre), ''), nullif(btrim(i.apellido), '')),
            'rol', i.rol, 'hospedado', i.hospedado
        ) order by i.nombre, i.id), '[]') into v_personas
        from personas i where nullif(btrim(i.nombre), '') is not null;
    end if;

    if private.haiku_tiene_permiso('servicios.ver') is true
        or private.haiku_tiene_permiso('servicios.crear') is true then
        select coalesce(jsonb_agg(jsonb_build_object(
            'codigo', c.codigo, 'nombre', c.nombre, 'minutos', c.duracion_minutos,
            'personas_max', c.capacidad_maxima
        ) order by c.orden_visual, c.nombre), '[]') into v_catalogo
        from public.catalogo_servicios c
        where c.activo and (c.codigo in ('tinajaTonel', 'tinajaJacuzzi') or c.codigo ilike 'masaje%');

        select coalesce(jsonb_agg(jsonb_build_object(
            'codigo', c.codigo, 'nombre', c.nombre, 'hora', s.hora_inicio, 'fin', s.hora_fin,
            'estado', s.estado_servicio, 'numero', b.numero
        ) order by s.hora_inicio, s.id), '[]') into v_agenda
        from public.servicios s
        join public.catalogo_servicios c on c.id = s.catalogo_servicio_id
        left join public.reserva_estadias e on e.id = s.estadia_id
        left join public.cabanas b on b.id = e.cabana_id
        where s.fecha_servicio = v_fecha and s.estado_servicio not in ('cancelado', 'no_show')
          and (c.codigo in ('tinajaTonel', 'tinajaJacuzzi') or c.codigo ilike 'masaje%');
    end if;

    if private.haiku_mapa_permiso_v1('lavanderia', false) then
        select t into v_lavanderia
        from jsonb_array_elements(public.haiku_tareas_generales_dia_v1(v_fecha)->'tareas') t
        where t->>'tipo' = 'lavanderia';
    end if;

    return jsonb_build_object(
        'fecha', v_fecha, 'cabanas', v_cabanas, 'personas', v_personas,
        'agenda', v_agenda, 'catalogo', v_catalogo, 'lavanderia', v_lavanderia,
        'permisos', jsonb_build_object(
            'vehiculo', private.haiku_mapa_permiso_v1('vehiculo', true),
            'persona', private.haiku_mapa_permiso_v1('persona', true),
            'tarea', private.haiku_mapa_permiso_v1('tarea', true),
            'lavanderia', private.haiku_mapa_permiso_v1('lavanderia', true),
            'huesped', private.haiku_huesped_puede_editar(),
            'agenda', private.haiku_tiene_permiso('servicios.ver') is true
                or private.haiku_tiene_permiso('servicios.crear') is true,
            'servicio', private.haiku_tiene_permiso('servicios.crear') is true
        ),
        'elementos', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'id', m.id, 'tipo', m.tipo, 'puesto', m.puesto,
                'x', m.posicion[0], 'y', m.posicion[1], 'reserva_id', m.reserva_id,
                'datos', m.datos, 'revision', m.revision
            ) order by m.actualizado_en), '[]')
            from public.haiku_mapa_elementos m
            where (m.dia is null or m.dia = v_fecha)
              and (m.tipo <> 'persona' or exists (
                  select 1 from public.reserva_estadias e
                  where e.reserva_id = m.reserva_id and e.estado_estadia = 'hospedada'
                    and e.fecha_ingreso <= v_fecha and e.fecha_salida >= v_fecha
                    and e.checkout_realizado_en is null
              ))
        )
    );
end
$$;

commit;
