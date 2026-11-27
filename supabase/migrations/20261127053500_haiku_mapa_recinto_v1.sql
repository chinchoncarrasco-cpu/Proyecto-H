-- Haku · Operación compartida del mapa. Las estadías, fichas y agendas siguen en su fuente.
begin;

create table public.haiku_mapa_elementos (
    id uuid primary key,
    tipo text not null check (tipo in ('vehiculo', 'persona', 'tarea', 'lavanderia')),
    puesto smallint check (puesto between 1 and 11),
    posicion point,
    reserva_id uuid references public.reservas(id) on delete set null,
    dia date,
    datos jsonb not null check (jsonb_typeof(datos) = 'object'),
    revision integer not null check (revision > 0),
    activo boolean not null default true,
    actualizado_por uuid not null,
    actualizado_en timestamptz not null default clock_timestamp(),
    check ((tipo = 'vehiculo') = (puesto is not null)),
    check ((tipo in ('persona', 'tarea')) = (posicion is not null)),
    check ((tipo = 'lavanderia') = (dia is not null))
);

create unique index haiku_mapa_puesto_activo
    on public.haiku_mapa_elementos(puesto) where activo and tipo = 'vehiculo';
create unique index haiku_mapa_patente_activa
    on public.haiku_mapa_elementos((datos->>'patente')) where activo and tipo = 'vehiculo';
create unique index haiku_mapa_persona_activa
    on public.haiku_mapa_elementos(reserva_id, (datos->>'persona_id')) where activo and tipo = 'persona';
create unique index haiku_mapa_lavanderia_dia
    on public.haiku_mapa_elementos(dia) where activo and tipo = 'lavanderia';

create table private.haiku_mapa_cambios (
    operacion uuid primary key,
    elemento_id uuid not null references public.haiku_mapa_elementos(id),
    actor uuid not null,
    tipo text not null,
    accion text not null,
    solicitud jsonb not null,
    revision integer not null,
    hecho_en timestamptz not null default clock_timestamp()
);

alter table public.haiku_mapa_elementos enable row level security;
alter table private.haiku_mapa_cambios enable row level security;
revoke all on public.haiku_mapa_elementos, private.haiku_mapa_cambios from public, anon, authenticated;
grant select on public.haiku_mapa_elementos to authenticated;

create function private.haiku_mapa_permiso_v1(p_tipo text, p_editar boolean)
returns boolean language sql stable security invoker set search_path = '' as $$
    select auth.uid() is not null
        and private.haiku_usuario_activo() is true
        and private.haiku_tiene_permiso('cabanas.ver') is true
        and case
            when p_tipo in ('vehiculo', 'persona') then
                private.haiku_tiene_permiso('huespedes.ver') is true and
                (not p_editar or private.haiku_tiene_permiso('huespedes.gestionar') is true)
            when p_tipo in ('tarea', 'lavanderia') then
                (private.haiku_tiene_permiso('aseos.ver_todos') is true or private.haiku_tiene_permiso('revisiones.ver') is true)
                and (not p_editar or private.haiku_tiene_permiso('aseos.gestionar_todos') is true
                    or private.haiku_tiene_permiso('revisiones.gestionar') is true)
            else false
        end
$$;
revoke all on function private.haiku_mapa_permiso_v1(text, boolean) from public, anon;
grant execute on function private.haiku_mapa_permiso_v1(text, boolean) to authenticated;

create policy haiku_mapa_elementos_lectura on public.haiku_mapa_elementos
    for select to authenticated using (activo and private.haiku_mapa_permiso_v1(tipo, false));

create function public.haiku_mapa_dia_v1()
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
              select 1 from public.estadias e
              where e.cabana_id = prev.cabana_id and
                (e.checkin_realizado_en >= prev.completado_en or e.checkout_realizado_en >= prev.completado_en)
          )
        order by prev.completado_en desc limit 1
    ) listo on private.haiku_tiene_permiso('reservas.ver') is true
        and o.estado_operativo in ('libre-libre', 'libre-ingresa')
        and o.ingreso_checkin_en is null and (o.aseo_estado is null or o.aseo_estado = 'no_requiere');

    if private.haiku_mapa_permiso_v1('persona', false) then
        select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'reserva_id', i.reserva_id,
            'nombre', concat_ws(' ', nullif(btrim(i.nombre), ''), nullif(btrim(i.apellido), '')),
            'rol', i.rol, 'hospedado', exists (
                select 1 from public.estadias e
                where e.reserva_id = i.reserva_id and e.estado_estadia = 'hospedada'
                    and e.fecha_ingreso <= v_fecha and e.fecha_salida >= v_fecha
                    and e.checkout_realizado_en is null
            )) order by i.nombre, i.id), '[]') into v_personas
        from public.haiku_huesped_integrantes_v1 i
        where i.rol in ('titular', 'acompanante') and nullif(btrim(i.nombre), '') is not null
          and i.reserva_id in (
              select nullif(a->>campo, '')::uuid
              from jsonb_array_elements(v_cabanas) a
              cross join unnest(array['ingreso_reserva_id', 'continua_reserva_id', 'fullday_reserva_id', 'salida_reserva_id']) campo
          );
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
        left join public.estadias e on e.id = s.estadia_id
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
                  select 1 from public.estadias e
                  where e.reserva_id = m.reserva_id and e.estado_estadia = 'hospedada'
                    and e.fecha_ingreso <= v_fecha and e.fecha_salida >= v_fecha
                    and e.checkout_realizado_en is null
              ))
        )
    );
end
$$;

revoke all on function public.haiku_mapa_dia_v1() from public, anon, authenticated;
grant execute on function public.haiku_mapa_dia_v1() to authenticated;

create function private.haiku_mapa_guardar_v1(
    p_id uuid, p_tipo text, p_revision integer, p_accion text, p_datos jsonb, p_operacion uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_actual public.haiku_mapa_elementos;
    v_repetido private.haiku_mapa_cambios;
    v_fecha date := (now() at time zone 'America/Santiago')::date;
    v_ahora timestamptz := clock_timestamp();
    v_actor uuid := auth.uid();
    v_puesto smallint;
    v_posicion point;
    v_reserva uuid;
    v_persona uuid;
    v_datos jsonb;
    v_estado text;
    v_patente text;
    v_llegada timestamptz;
    v_solicitud jsonb;
begin
    if private.haiku_mapa_permiso_v1(p_tipo, true) is not true then
        raise exception 'Tu usuario no puede editar este elemento.' using errcode = '42501';
    end if;
    if p_id is null or p_revision is null or p_revision < 0 or p_operacion is null
        or p_accion is null or p_accion not in ('guardar', 'retirar', 'entrada', 'salida')
        or jsonb_typeof(p_datos) is distinct from 'object' or octet_length(p_datos::text) > 6000 then
        raise exception 'El cambio del mapa no es válido.' using errcode = '22023';
    end if;

    v_solicitud := jsonb_build_object('revision', p_revision, 'datos', p_datos);
    perform pg_advisory_xact_lock(hashtextextended(p_operacion::text, 0));
    select * into v_repetido from private.haiku_mapa_cambios where operacion = p_operacion;
    if found then
        if v_repetido.actor <> v_actor or v_repetido.elemento_id <> p_id
            or v_repetido.tipo <> p_tipo or v_repetido.accion <> p_accion
            or v_repetido.solicitud <> v_solicitud then
            raise exception 'El cambio corresponde a otro intento.' using errcode = '22023';
        end if;
        return jsonb_build_object('id', p_id, 'revision', v_repetido.revision, 'repetido', true);
    end if;

    select * into v_actual from public.haiku_mapa_elementos where id = p_id for update;
    if found then
        if v_actual.tipo <> p_tipo or not v_actual.activo or v_actual.revision <> p_revision
            or (p_tipo = 'lavanderia' and v_actual.dia <> v_fecha) then
            raise exception 'El elemento cambió. Actualiza el mapa antes de editar.' using errcode = '40001';
        end if;
    elsif p_revision <> 0 or p_accion <> 'guardar' then
        raise exception 'El elemento ya no está disponible.' using errcode = '40001';
    end if;

    if p_accion = 'retirar' then
        update public.haiku_mapa_elementos set activo = false, revision = p_revision + 1,
            actualizado_en = v_ahora, actualizado_por = v_actor where id = p_id;
    elsif p_accion in ('entrada', 'salida') then
        if p_tipo <> 'vehiculo' then
            raise exception 'Selecciona un vehículo.' using errcode = '22023';
        end if;
        v_datos := case when p_accion = 'entrada' then
            jsonb_build_object('estacionado', true, 'ultima_entrada', v_ahora,
                'llegada', coalesce(v_actual.datos->'llegada', to_jsonb(v_ahora)))
        else jsonb_build_object('estacionado', false, 'ultima_salida', v_ahora) end;
        update public.haiku_mapa_elementos set datos = datos || v_datos, revision = p_revision + 1,
            actualizado_en = v_ahora, actualizado_por = v_actor where id = p_id;
    else
        v_reserva := nullif(p_datos->>'reserva_id', '')::uuid;
        if p_tipo = 'vehiculo' then
            v_puesto := (p_datos->>'puesto')::smallint;
            v_patente := regexp_replace(upper(coalesce(p_datos->>'patente', '')), '[[:space:]-]+', '', 'g');
            if v_puesto is null or v_puesto not between 1 and 11 or v_patente !~ '^[A-Z0-9]{3,12}$'
                or coalesce(p_datos->>'vehiculo', '') not in
                    ('Sedán', 'Hatchback', 'SUV', 'Camioneta', 'Station wagon', 'Van', 'Furgón', 'Minibús', 'Moto', 'Otro') then
                raise exception 'Revisa el puesto, el tipo de vehículo y la patente.' using errcode = '22023';
            end if;
            if v_reserva is not null and not exists (
                select 1 from public.estadias e where e.reserva_id = v_reserva
                  and e.fecha_ingreso <= v_fecha and e.fecha_salida >= v_fecha
                  and e.estado_estadia in ('confirmada', 'hospedada')
            ) and v_reserva is distinct from v_actual.reserva_id then
                raise exception 'Selecciona una estadía de hoy.' using errcode = '22023';
            end if;
            v_estado := coalesce(p_datos->>'estacionado', 'false');
            if p_revision = 0 and v_estado not in ('true', 'false') then
                raise exception 'Selecciona el estado del vehículo.' using errcode = '22023';
            end if;
            if nullif(p_datos->>'llegada','') is not null then
                if (p_datos->>'llegada') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
                    raise exception 'Ingresa la fecha y hora de llegada de Chile.' using errcode = '22023';
                end if;
                v_llegada := (p_datos->>'llegada')::timestamp at time zone 'America/Santiago';
                if v_llegada > v_ahora then
                    raise exception 'La hora de llegada no puede ser futura.' using errcode = '22023';
                end if;
            end if;
            v_datos := coalesce(v_actual.datos, jsonb_build_object(
                'estacionado', v_estado = 'true',
                'llegada', coalesce(v_llegada, case when v_estado = 'true' then v_ahora end),
                'ultima_entrada', case when v_estado = 'true' then coalesce(v_llegada, v_ahora) end
            )) || jsonb_build_object('vehiculo', p_datos->>'vehiculo', 'patente', v_patente,
                'modelo', left(btrim(coalesce(p_datos->>'modelo', '')), 80),
                'color', left(btrim(coalesce(p_datos->>'color', '')), 45),
                'nota', left(btrim(coalesce(p_datos->>'nota', '')), 500));
            if v_llegada is not null then
                v_datos := v_datos || jsonb_build_object('llegada', v_llegada);
            end if;
        elsif p_tipo in ('persona', 'tarea') then
            if jsonb_typeof(p_datos->'x') is distinct from 'number' or jsonb_typeof(p_datos->'y') is distinct from 'number'
                or (p_datos->>'x')::numeric not between 0 and 1136
                or (p_datos->>'y')::numeric not between 0 and 1578 then
                raise exception 'Elige una ubicación en el mapa.' using errcode = '22023';
            end if;
            v_posicion := point((p_datos->>'x')::double precision, (p_datos->>'y')::double precision);
            if p_tipo = 'persona' then
                v_persona := nullif(p_datos->>'persona_id', '')::uuid;
                if v_persona is null or not exists (
                    select 1 from public.haiku_huesped_integrantes_v1 i
                    where i.id = v_persona and i.reserva_id = v_reserva and i.rol in ('titular', 'acompanante')
                ) or not exists (
                    select 1 from public.estadias e where e.reserva_id = v_reserva
                      and e.estado_estadia = 'hospedada' and e.fecha_ingreso <= v_fecha
                      and e.fecha_salida >= v_fecha and e.checkout_realizado_en is null
                ) then
                    raise exception 'La persona debe estar hospedada.' using errcode = '22023';
                end if;
                v_datos := jsonb_build_object('persona_id', v_persona);
            else
                v_reserva := null;
                if coalesce(p_datos->>'categoria', '') not in ('mantencion', 'aseo', 'peligro', 'areas_verdes', 'general')
                    or coalesce(p_datos->>'estado', '') not in ('pendiente', 'en_curso', 'lista')
                    or nullif(btrim(p_datos->>'nota'), '') is null then
                    raise exception 'Indica la categoría, el estado y la nota de la tarea.' using errcode = '22023';
                end if;
                v_datos := jsonb_build_object('categoria', p_datos->>'categoria', 'estado', p_datos->>'estado',
                    'nota', left(btrim(p_datos->>'nota'), 500),
                    'responsable', left(btrim(coalesce(p_datos->>'responsable', '')), 80));
            end if;
        else
            v_reserva := null;
            select jsonb_object_agg(campo, left(btrim(coalesce(p_datos->>campo, '')), 500))
            into v_datos from unnest(array['encargado', 'canastas', 'lenceria', 'lavando', 'faltantes']) campo;
        end if;
        if p_revision = 0 then
            insert into public.haiku_mapa_elementos(id, tipo, puesto, posicion, reserva_id, dia, datos,
                revision, actualizado_por, actualizado_en)
            values (p_id, p_tipo, v_puesto, v_posicion, v_reserva,
                case when p_tipo = 'lavanderia' then v_fecha end, v_datos, 1, v_actor, v_ahora);
        else
            update public.haiku_mapa_elementos set puesto = v_puesto, posicion = v_posicion,
                reserva_id = v_reserva, datos = v_datos, revision = p_revision + 1,
                actualizado_por = v_actor, actualizado_en = v_ahora where id = p_id;
        end if;
    end if;

    insert into private.haiku_mapa_cambios(operacion, elemento_id, actor, tipo, accion, solicitud, revision)
    values (p_operacion, p_id, v_actor, p_tipo, p_accion, v_solicitud, p_revision + 1);
    return jsonb_build_object('id', p_id, 'revision', p_revision + 1);
exception when unique_violation then
    raise exception 'Este puesto, patente o persona ya figura en el mapa. Actualiza antes de guardar.'
        using errcode = '23505';
end
$$;

create function public.haiku_mapa_guardar_v1(
    p_id uuid, p_tipo text, p_revision integer, p_accion text, p_datos jsonb, p_operacion uuid
) returns jsonb language sql security invoker set search_path = '' as $$
    select private.haiku_mapa_guardar_v1(p_id, p_tipo, p_revision, p_accion, p_datos, p_operacion)
$$;

revoke all on function private.haiku_mapa_guardar_v1(uuid, text, integer, text, jsonb, uuid),
    public.haiku_mapa_guardar_v1(uuid, text, integer, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.haiku_mapa_guardar_v1(uuid, text, integer, text, jsonb, uuid),
    public.haiku_mapa_guardar_v1(uuid, text, integer, text, jsonb, uuid) to authenticated;


create function public.haiku_mapa_huesped_v1(p_id uuid, p_reserva uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_perfil jsonb;
begin
    if private.haiku_mapa_permiso_v1('persona', false) is not true or p_reserva is null then
        raise exception 'Selecciona un huésped de una estadía.' using errcode = '42501';
    end if;
    v_perfil := public.haiku_huesped_perfil_v1(p_id, p_reserva, false);
    return coalesce((
        select jsonb_agg(jsonb_build_object('tipo', n->>'categoria', 'texto', n->>'texto') order by n->>'fecha' desc)
        from (
            select n
            from jsonb_array_elements(v_perfil->'registros') n
            where n->>'categoria' in ('preferencia','nota','actividad') and nullif(n->>'texto','') is not null
            order by n->>'fecha' desc limit 6
        ) registros
    ), '[]');
end
$$;

revoke all on function public.haiku_mapa_huesped_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.haiku_mapa_huesped_v1(uuid, uuid) to authenticated;

commit;
