-- Cloudbeds Writer W1.3. Transicion compatible entre TOTAL v31 y TOTAL v32.
-- Migracion incremental: W1.1 y W1.2 permanecen historicas e inmutables.
begin;

create or replace function public.haiku_previsualizar_tarifa_cloudbeds_v1(
    p_reserva_id uuid,
    p_estadia_id uuid,
    p_total_objetivo bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
    v_reserva public.reservas%rowtype;
    v_estadia public.reserva_estadias%rowtype;
    v_activas integer;
    v_cabana_numero smallint;
    v_cabana_activa boolean;
    v_actual bigint;
    v_pagado bigint;
    v_saldo bigint;
    v_plan jsonb;
    v_motivo text;
    v_autoridad_version text;
begin
    if auth.uid() is null or private.haiku_usuario_activo() is distinct from true then
        raise exception 'RESERVA_NO_ELEGIBLE'
            using errcode = '42501', detail = 'Se requiere una sesión de usuario activa.';
    end if;
    if private.haiku_tiene_permiso('reservas.editar') is distinct from true
       or private.haiku_tiene_permiso('pagos.ver') is distinct from true
       or private.haiku_tiene_permiso('pagos.registrar') is distinct from true then
        raise exception 'RESERVA_NO_ELEGIBLE'
            using errcode = '42501', detail = 'Se requieren reservas.editar, pagos.ver y pagos.registrar.';
    end if;
    if p_reserva_id is null or p_estadia_id is null
       or p_total_objetivo is null or p_total_objetivo <= 0
       or p_total_objetivo > 7000000000000000 then
        raise exception 'RESERVA_NO_ELEGIBLE'
            using detail = 'Reserva, estadía u objetivo inválidos.';
    end if;
    v_autoridad_version := pg_catalog.obj_description(
        pg_catalog.to_regprocedure('public.haiku_cambiar_totales_lote_v1(jsonb)'),
        'pg_proc'
    );
    if pg_catalog.to_regprocedure('public.haiku_cambiar_totales_lote_v1(jsonb)') is null
       or v_autoridad_version is null
       or v_autoridad_version not in ('total1_financiero_v31', 'total1_financiero_v32') then
        raise exception 'CONFLICTO_FINANCIERO'
            using detail = 'La autoridad financiera vigente no pertenece a la whitelist W1.3.';
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id;
    if not found then
        return pg_catalog.jsonb_build_object(
            'solo_lectura', true, 'reserva_id', p_reserva_id, 'estadia_id', p_estadia_id,
            'autoridad_financiera_version', v_autoridad_version,
            'total_objetivo', p_total_objetivo, 'elegible', false,
            'motivo_bloqueo', 'La reserva ya no existe en Proyecto H.'
        );
    end if;

    select pg_catalog.count(*)::integer into v_activas
    from public.reserva_estadias
    where reserva_id = p_reserva_id and estado_estadia not in ('cancelada', 'no_show');
    select * into v_estadia
    from public.reserva_estadias
    where id = p_estadia_id and reserva_id = p_reserva_id
      and estado_estadia not in ('cancelada', 'no_show');
    select c.numero, c.activa into v_cabana_numero, v_cabana_activa
    from public.cabanas c where c.id = v_estadia.cabana_id;
    select total_alojamiento, pagado_alojamiento, saldo_alojamiento
      into v_actual, v_pagado, v_saldo
    from public.vista_saldos_alojamiento_reserva where reserva_id = p_reserva_id;

    if v_reserva.estado_reserva in ('cancelada', 'no_show')
       or v_reserva.grupo_reserva_id is not null then
        v_motivo := 'La reserva no está en un estado elegible.';
    elsif v_activas <> 1 or v_estadia.id is null then
        v_motivo := 'La reserva no tiene una única estadía operativa coincidente.';
    elsif v_estadia.tipo_estadia not in ('alojamiento', 'fullday') then
        v_motivo := 'El tipo de estadía vigente no es compatible.';
    elsif v_estadia.cabana_id is null or v_cabana_numero is null then
        v_motivo := 'La cabaña vigente no está disponible.';
    elsif v_estadia.tipo_estadia = 'alojamiento'
          and (v_estadia.fecha_ingreso is null or v_estadia.fecha_salida is null
               or v_estadia.fecha_salida <= v_estadia.fecha_ingreso) then
        v_motivo := 'El alojamiento no tiene fechas vigentes compatibles.';
    elsif v_estadia.tipo_estadia = 'fullday'
          and (v_estadia.fecha_ingreso is null
               or v_estadia.fecha_salida is distinct from v_estadia.fecha_ingreso
               or v_cabana_activa is distinct from true
               or exists (select 1 from public.estadia_noches where estadia_id = p_estadia_id)) then
        v_motivo := 'La estadía Full Day ya no conserva su estructura D a D.';
    elsif v_actual is null or v_pagado is null or v_saldo is null then
        v_motivo := 'El estado financiero vigente no está disponible.';
    elsif v_pagado > p_total_objetivo then
        v_motivo := 'El alojamiento pagado supera el total objetivo.';
    end if;

    if v_motivo is null then
        begin
            -- El nombre estable v3 conserva los guards v31 y es adaptado por TOTAL v32.
            v_plan := private.haiku_plan_total_financiero_v3(p_reserva_id, p_total_objetivo);
        exception when others then
            v_motivo := sqlerrm;
        end;
    end if;

    return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'solo_lectura', true,
        'version', 'cloudbeds_writer_w1_preview_v1',
        'autoridad_financiera_version', v_autoridad_version,
        'reserva_id', p_reserva_id,
        'estadia_id', p_estadia_id,
        'tipo_estadia', v_estadia.tipo_estadia,
        'cabana_id', v_estadia.cabana_id,
        'cabana_numero', v_cabana_numero,
        'fecha_ingreso', v_estadia.fecha_ingreso,
        'fecha_salida', v_estadia.fecha_salida,
        'ocupacion', pg_catalog.jsonb_build_object(
            'adultos', v_estadia.adultos,
            'ninos', v_estadia.ninos,
            'mascotas', v_estadia.mascotas
        ),
        'estado_reserva', v_reserva.estado_reserva,
        'estado_estadia', v_estadia.estado_estadia,
        'total_actual', v_actual,
        'total_objetivo', p_total_objetivo,
        'pagado_actual', coalesce(v_pagado, 0),
        'saldo_actual', v_saldo,
        'saldo_esperado', case when v_actual is not null
                               then p_total_objetivo - coalesce(v_pagado, 0) end,
        'capacidad_financiera', pg_catalog.jsonb_build_object(
            'autoridad', 'public.haiku_cambiar_totales_lote_v1',
            'objetivo_cubre_pagado', coalesce(v_pagado, 0) <= p_total_objetivo
        ),
        'firma_iva', case when v_plan ? 'firma' then v_plan->>'firma' end,
        'servicios_sin_cambios', case
            when v_plan#>>'{separacion_servicios,segura}' = 'true' then true
        end,
        'total_servicios_sin_cambio', case
            when v_plan#>>'{separacion_servicios,segura}' = 'true'
            then (v_plan#>>'{separacion_servicios,servicios_sin_cambios}')::bigint
        end,
        'total_reserva_actual', case
            when v_plan#>>'{separacion_servicios,segura}' = 'true'
            then (v_plan#>>'{separacion_servicios,total_reserva_actual}')::bigint
        end,
        'total_reserva_esperado', case
            when v_plan#>>'{separacion_servicios,segura}' = 'true'
            then (v_plan#>>'{separacion_servicios,total_reserva_esperado}')::bigint
        end,
        'elegible', v_motivo is null,
        'motivo_bloqueo', v_motivo
    ));
end;
$function$;

revoke all on function public.haiku_previsualizar_tarifa_cloudbeds_v1(uuid, uuid, bigint)
from public, anon;
grant execute on function public.haiku_previsualizar_tarifa_cloudbeds_v1(uuid, uuid, bigint)
to authenticated;
comment on function public.haiku_previsualizar_tarifa_cloudbeds_v1(uuid, uuid, bigint) is
'Cloudbeds W1.3 preview: relee Proyecto H y usa el planner financiero v3 para TOTAL v31/v32 sin escrituras.';

create or replace function public.haiku_aplicar_tarifas_cloudbeds_v1(p_operaciones jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_item jsonb;
    v_reserva public.reservas%rowtype;
    v_estadia public.reserva_estadias%rowtype;
    v_reserva_id uuid;
    v_estadia_id uuid;
    v_tipo text;
    v_esperado bigint;
    v_objetivo bigint;
    v_actual bigint;
    v_pagado bigint;
    v_saldo bigint;
    v_activas integer;
    v_cloudbeds_numero text;
    v_cloudbeds_id text;
    v_cabana_numero smallint;
    v_cabana_activa boolean;
    v_financieras jsonb := '[]'::jsonb;
    v_invariantes_antes jsonb := '{}'::jsonb;
    v_snapshot_antes jsonb;
    v_snapshot_despues jsonb;
    v_resultados jsonb := '[]'::jsonb;
    v_operacion_id uuid := pg_catalog.gen_random_uuid();
    v_respuesta jsonb;
    v_error text;
    v_cambios integer := 0;
    v_autoridad_version text;
begin
    if auth.uid() is null or private.haiku_usuario_activo() is distinct from true then
        raise exception 'RESERVA_NO_ELEGIBLE'
            using errcode = '42501', detail = 'Se requiere una sesión de usuario activa.';
    end if;
    if private.haiku_tiene_permiso('reservas.editar') is distinct from true
       or private.haiku_tiene_permiso('pagos.ver') is distinct from true
       or private.haiku_tiene_permiso('pagos.registrar') is distinct from true then
        raise exception 'RESERVA_NO_ELEGIBLE'
            using errcode = '42501', detail = 'Se requieren reservas.editar, pagos.ver y pagos.registrar.';
    end if;
    if pg_catalog.jsonb_typeof(p_operaciones) is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_operaciones) not between 1 and 20 then
        raise exception 'RESERVA_NO_ELEGIBLE'
            using detail = 'El lote debe contener entre 1 y 20 operaciones.';
    end if;
    v_autoridad_version := pg_catalog.obj_description(
        pg_catalog.to_regprocedure('public.haiku_cambiar_totales_lote_v1(jsonb)'),
        'pg_proc'
    );
    if pg_catalog.to_regprocedure('public.haiku_cambiar_totales_lote_v1(jsonb)') is null
       or v_autoridad_version is null
       or v_autoridad_version not in ('total1_financiero_v31', 'total1_financiero_v32') then
        raise exception 'CONFLICTO_FINANCIERO'
            using detail = 'La autoridad financiera vigente no pertenece a la whitelist W1.3.';
    end if;

    -- Validación de forma antes de convertir valores o adquirir locks.
    for v_item in select value from pg_catalog.jsonb_array_elements(p_operaciones) loop
        if coalesce(v_item->>'reserva_id', '') !~
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
           or coalesce(v_item->>'estadia_id', '') !~
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
           or coalesce(v_item->>'tipo_estadia', '') not in ('alojamiento', 'fullday')
           or coalesce(v_item->>'total_actual_esperado', '') !~ '^[0-9]+$'
           or coalesce(v_item->>'total_objetivo', '') !~ '^[0-9]+$'
           or pg_catalog.jsonb_typeof(v_item->'certeza') is distinct from 'string'
           or nullif(pg_catalog.btrim(v_item->>'certeza'), '') is null
           or not (v_item ? 'evidencia')
           or pg_catalog.jsonb_typeof(v_item->'evidencia') in ('null', 'number', 'boolean')
           or (v_item ? 'firma_iva' and (
                pg_catalog.jsonb_typeof(v_item->'firma_iva') is distinct from 'string'
                or nullif(pg_catalog.btrim(v_item->>'firma_iva'), '') is null
           )) then
            raise exception 'RESERVA_NO_ELEGIBLE'
                using detail = 'Operación incompleta o metadata inválida.';
        end if;
        v_esperado := (v_item->>'total_actual_esperado')::bigint;
        v_objetivo := (v_item->>'total_objetivo')::bigint;
        v_cloudbeds_numero := nullif(pg_catalog.btrim(v_item->>'cloudbeds_reservation_number'), '');
        v_cloudbeds_id := nullif(pg_catalog.btrim(v_item->>'cloudbeds_reservation_id'), '');
        if v_esperado > 9007199254740991
           or v_objetivo <= 0 or v_objetivo > 7000000000000000
           or (v_cloudbeds_numero is null and v_cloudbeds_id is null)
           or pg_catalog.length(coalesce(v_cloudbeds_numero, '')) > 200
           or pg_catalog.length(coalesce(v_cloudbeds_id, '')) > 200
           or pg_catalog.length(v_item->>'certeza') > 120
           or pg_catalog.length(coalesce(v_item->>'firma_iva', '')) > 1024
           or pg_catalog.length((v_item->'evidencia')::text) > 16000 then
            raise exception 'RESERVA_NO_ELEGIBLE'
                using detail = 'Totales, referencias Cloudbeds o evidencia fuera de rango.';
        end if;
    end loop;

    if (select pg_catalog.count(distinct (value->>'reserva_id')::uuid)
        from pg_catalog.jsonb_array_elements(p_operaciones))
       <> pg_catalog.jsonb_array_length(p_operaciones)
       or (select pg_catalog.count(distinct (value->>'estadia_id')::uuid)
           from pg_catalog.jsonb_array_elements(p_operaciones))
          <> pg_catalog.jsonb_array_length(p_operaciones) then
        raise exception 'RESERVA_NO_ELEGIBLE'
            using detail = 'Una reserva o estadía aparece más de una vez en el lote.';
    end if;

    if exists (
        with referencias as (
            select distinct entrada.ordinalidad, ref.valor
            from pg_catalog.jsonb_array_elements(p_operaciones) with ordinality entrada(item, ordinalidad)
            cross join lateral pg_catalog.unnest(array[
                nullif(pg_catalog.btrim(entrada.item->>'cloudbeds_reservation_number'), ''),
                nullif(pg_catalog.btrim(entrada.item->>'cloudbeds_reservation_id'), '')
            ]) ref(valor)
            where ref.valor is not null
        )
        select 1 from referencias group by valor having pg_catalog.count(*) > 1
    ) then
        raise exception 'RESERVA_NO_ELEGIBLE'
            using detail = 'Una referencia Cloudbeds apunta a más de una operación.';
    end if;

    -- Todas las entidades relevantes quedan bloqueadas en orden estable antes de releer.
    for v_reserva_id in
        select (value->>'reserva_id')::uuid
        from pg_catalog.jsonb_array_elements(p_operaciones)
        order by 1
    loop
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_reserva_id::text, 0));
        perform 1 from public.reservas where id = v_reserva_id for update;
        perform 1 from public.reserva_estadias where reserva_id = v_reserva_id order by id for update;
        perform 1 from public.cargos where reserva_id = v_reserva_id order by id for update;
        perform 1 from public.pagos where reserva_id = v_reserva_id order by id for update;
        perform 1 from public.pago_aplicaciones
          where cargo_id in (select id from public.cargos where reserva_id = v_reserva_id)
             or pago_id in (select id from public.pagos where reserva_id = v_reserva_id)
          order by id for update;
        perform 1 from public.servicios where reserva_id = v_reserva_id order by id for update;
        perform 1 from public.cargo_ajustes where reserva_id = v_reserva_id order by id for update;
        perform 1 from public.estadia_noches
          where estadia_id in (select id from public.reserva_estadias where reserva_id = v_reserva_id)
          order by id for update;
        perform 1 from public.reserva_huespedes where reserva_id = v_reserva_id order by huesped_id for update;
        perform 1 from public.estadia_huespedes
          where estadia_id in (select id from public.reserva_estadias where reserva_id = v_reserva_id)
          order by estadia_id, huesped_id for update;
        perform 1 from public.huespedes
          where id in (
            select r.titular_huesped_id from public.reservas r
              where r.id = v_reserva_id and r.titular_huesped_id is not null
            union
            select rh.huesped_id from public.reserva_huespedes rh where rh.reserva_id = v_reserva_id
            union
            select eh.huesped_id from public.estadia_huespedes eh
              where eh.estadia_id in (select id from public.reserva_estadias where reserva_id = v_reserva_id)
          ) order by id for update;
    end loop;
    perform 1 from public.cabanas
      where id in (
        select e.cabana_id from public.reserva_estadias e
        where e.reserva_id in (
            select (value->>'reserva_id')::uuid from pg_catalog.jsonb_array_elements(p_operaciones)
        )
      ) order by id for key share;

    -- Revalida el lote completo, preserva invariantes y arma un único lote financiero.
    for v_item in
        select value from pg_catalog.jsonb_array_elements(p_operaciones)
        order by (value->>'reserva_id')::uuid
    loop
        v_reserva_id := (v_item->>'reserva_id')::uuid;
        v_estadia_id := (v_item->>'estadia_id')::uuid;
        v_tipo := v_item->>'tipo_estadia';
        v_esperado := (v_item->>'total_actual_esperado')::bigint;
        v_objetivo := (v_item->>'total_objetivo')::bigint;
        v_cloudbeds_numero := nullif(pg_catalog.btrim(v_item->>'cloudbeds_reservation_number'), '');
        v_cloudbeds_id := nullif(pg_catalog.btrim(v_item->>'cloudbeds_reservation_id'), '');

        select * into v_reserva from public.reservas where id = v_reserva_id;
        if not found or v_reserva.estado_reserva in ('cancelada', 'no_show')
           or v_reserva.grupo_reserva_id is not null then
            raise exception 'RESERVA_NO_ELEGIBLE'
                using detail = 'Reserva inexistente, cerrada o perteneciente a un grupo.';
        end if;
        select pg_catalog.count(*)::integer into v_activas
        from public.reserva_estadias
        where reserva_id = v_reserva_id and estado_estadia not in ('cancelada', 'no_show');
        if v_activas <> 1 then
            raise exception 'RESERVA_NO_ELEGIBLE'
                using detail = 'La reserva no tiene exactamente una estadía operativa.';
        end if;
        select * into v_estadia from public.reserva_estadias
        where reserva_id = v_reserva_id and estado_estadia not in ('cancelada', 'no_show');
        select c.numero, c.activa into v_cabana_numero, v_cabana_activa
        from public.cabanas c where c.id = v_estadia.cabana_id;
        if v_estadia.id is distinct from v_estadia_id
           or v_estadia.tipo_estadia is distinct from v_tipo
           or v_estadia.cabana_id is null or v_cabana_numero is null
           or (v_tipo = 'fullday' and (
                v_estadia.fecha_ingreso is null
                or v_estadia.fecha_ingreso is distinct from v_estadia.fecha_salida
                or v_cabana_activa is distinct from true
                or exists (select 1 from public.estadia_noches where estadia_id = v_estadia_id)
           ))
           or (v_tipo = 'alojamiento' and (v_estadia.fecha_ingreso is null
                or v_estadia.fecha_salida is null or v_estadia.fecha_salida <= v_estadia.fecha_ingreso)) then
            raise exception 'RESERVA_NO_ELEGIBLE'
                using detail = 'La estadía, su tipo, cabaña o estructura ya no coinciden.';
        end if;

        if nullif(pg_catalog.btrim(coalesce(v_reserva.cloudbeds_id, '')), '') is not null
           and v_reserva.cloudbeds_id is distinct from v_cloudbeds_numero
           and v_reserva.cloudbeds_id is distinct from v_cloudbeds_id then
            raise exception 'RESERVA_NO_ELEGIBLE'
                using detail = 'La reserva tiene un vínculo Cloudbeds incompatible.';
        end if;
        if exists (
            select 1 from public.reservas otra
            where otra.id <> v_reserva_id
              and nullif(pg_catalog.btrim(coalesce(otra.cloudbeds_id, '')), '')
                  = any(array[v_cloudbeds_numero, v_cloudbeds_id])
        ) then
            raise exception 'RESERVA_NO_ELEGIBLE'
                using detail = 'La referencia Cloudbeds pertenece a otra reserva de Proyecto H.';
        end if;

        select total_alojamiento, pagado_alojamiento, saldo_alojamiento
          into v_actual, v_pagado, v_saldo
        from public.vista_saldos_alojamiento_reserva where reserva_id = v_reserva_id;
        if not found or v_actual is null then
            raise exception 'RESERVA_NO_ELEGIBLE'
                using detail = 'No existe un total de alojamiento verificable.';
        end if;
        if v_actual is distinct from v_esperado then
            raise exception 'ESTADO_DESACTUALIZADO'
                using errcode = '40001', detail = 'El total actual no coincide con total_actual_esperado.';
        end if;
        if coalesce(v_pagado, 0) > v_objetivo then
            raise exception 'PAGO_SUPERA_NUEVO_TOTAL'
                using detail = 'El alojamiento pagado supera el nuevo total.';
        end if;
        if v_tipo = 'fullday' and (
            (select pg_catalog.count(*) from public.cargos
             where reserva_id = v_reserva_id and tipo_cargo = 'alojamiento' and estado = 'activo') <> 1
            or exists (
                select 1 from public.cargos c
                where c.reserva_id = v_reserva_id and c.tipo_cargo = 'alojamiento' and c.estado = 'activo'
                  and (c.estadia_id is distinct from v_estadia_id
                       or c.estadia_noche_id is not null or c.monto is distinct from v_actual)
            )
        ) then
            raise exception 'RESERVA_NO_ELEGIBLE'
                using detail = 'La estructura financiera Full Day ya no es inequívoca.';
        end if;

        select pg_catalog.jsonb_build_object(
            'reserva', (select pg_catalog.to_jsonb(r) from public.reservas r where r.id = v_reserva_id),
            'estadias', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id)
                from public.reserva_estadias e where e.reserva_id = v_reserva_id), '[]'::jsonb),
            'huespedes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(h) order by h.id)
                from public.huespedes h where h.id in (
                    select r.titular_huesped_id from public.reservas r
                      where r.id = v_reserva_id and r.titular_huesped_id is not null
                    union
                    select rh.huesped_id from public.reserva_huespedes rh where rh.reserva_id = v_reserva_id
                    union
                    select eh.huesped_id from public.estadia_huespedes eh
                      where eh.estadia_id in (select id from public.reserva_estadias where reserva_id = v_reserva_id)
                )), '[]'::jsonb),
            'reserva_huespedes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rh) order by rh.huesped_id)
                from public.reserva_huespedes rh where rh.reserva_id = v_reserva_id), '[]'::jsonb),
            'estadia_huespedes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(eh) order by eh.estadia_id, eh.huesped_id)
                from public.estadia_huespedes eh
                where eh.estadia_id in (select id from public.reserva_estadias where reserva_id = v_reserva_id)), '[]'::jsonb),
            'pagos', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id)
                from public.pagos p where p.reserva_id = v_reserva_id), '[]'::jsonb),
            'servicios', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.id)
                from public.servicios s where s.reserva_id = v_reserva_id), '[]'::jsonb),
            'cargos_servicio', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.id)
                from public.cargos c where c.reserva_id = v_reserva_id and c.servicio_id is not null), '[]'::jsonb)
        ) into v_snapshot_antes;
        v_invariantes_antes := v_invariantes_antes ||
            pg_catalog.jsonb_build_object(v_reserva_id::text, v_snapshot_antes);

        if v_esperado <> v_objetivo then
            v_financieras := v_financieras || pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'reserva_id', v_reserva_id,
                    'total_actual', v_esperado,
                    'total_objetivo', v_objetivo
                ) || case when v_item ? 'firma_iva'
                          then pg_catalog.jsonb_build_object('firma_iva', v_item->>'firma_iva')
                          else '{}'::jsonb end
            );
        end if;
    end loop;

    perform pg_catalog.set_config('app.haiku_origen', 'cloudbeds', true);
    perform pg_catalog.set_config('app.haiku_operacion_id', v_operacion_id::text, true);

    -- Una sola autoridad y una sola llamada para el lote mixto completo.
    if pg_catalog.jsonb_array_length(v_financieras) > 0 then
        begin
            v_respuesta := public.haiku_cambiar_totales_lote_v1(v_financieras);
            if v_respuesta->>'ok' is distinct from 'true'
               or pg_catalog.jsonb_array_length(v_respuesta->'resultados')
                  is distinct from pg_catalog.jsonb_array_length(v_financieras) then
                raise exception 'Respuesta no verificable de TOTAL vigente.';
            end if;
        exception when others then
            v_error := sqlerrm;
            if v_error ilike '%por debajo%' or v_error ilike '%sobrepago%'
               or v_error ilike '%supera objetivo%' or v_error ilike '%confirmado% supera%' then
                raise exception 'PAGO_SUPERA_NUEVO_TOTAL' using detail = v_error;
            elsif v_error ilike '%plan IVA cambió desde%'
               or v_error ilike '%operación IVA ya no está disponible%' then
                raise exception 'PLAN_IVA_DESACTUALIZADO' using errcode = '40001', detail = v_error;
            elsif v_error ilike '%cambió desde%' or v_error ilike '%total cambió%' then
                raise exception 'ESTADO_DESACTUALIZADO' using errcode = '40001', detail = v_error;
            else
                raise exception 'CONFLICTO_FINANCIERO' using detail = v_error;
            end if;
        end;
    end if;

    -- Las entidades no financieras deben permanecer byte/lógicamente idénticas.
    for v_item in
        select value from pg_catalog.jsonb_array_elements(p_operaciones)
        order by (value->>'reserva_id')::uuid
    loop
        v_reserva_id := (v_item->>'reserva_id')::uuid;
        v_estadia_id := (v_item->>'estadia_id')::uuid;
        v_tipo := v_item->>'tipo_estadia';
        v_esperado := (v_item->>'total_actual_esperado')::bigint;
        v_objetivo := (v_item->>'total_objetivo')::bigint;

        select total_alojamiento, pagado_alojamiento, saldo_alojamiento
          into v_actual, v_pagado, v_saldo
        from public.vista_saldos_alojamiento_reserva where reserva_id = v_reserva_id;
        if v_actual is distinct from v_objetivo then
            raise exception 'CONFLICTO_FINANCIERO'
                using detail = 'El total final no coincide con el objetivo; lote revertido.';
        end if;

        select pg_catalog.jsonb_build_object(
            'reserva', (select pg_catalog.to_jsonb(r) from public.reservas r where r.id = v_reserva_id),
            'estadias', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id)
                from public.reserva_estadias e where e.reserva_id = v_reserva_id), '[]'::jsonb),
            'huespedes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(h) order by h.id)
                from public.huespedes h where h.id in (
                    select r.titular_huesped_id from public.reservas r
                      where r.id = v_reserva_id and r.titular_huesped_id is not null
                    union
                    select rh.huesped_id from public.reserva_huespedes rh where rh.reserva_id = v_reserva_id
                    union
                    select eh.huesped_id from public.estadia_huespedes eh
                      where eh.estadia_id in (select id from public.reserva_estadias where reserva_id = v_reserva_id)
                )), '[]'::jsonb),
            'reserva_huespedes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rh) order by rh.huesped_id)
                from public.reserva_huespedes rh where rh.reserva_id = v_reserva_id), '[]'::jsonb),
            'estadia_huespedes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(eh) order by eh.estadia_id, eh.huesped_id)
                from public.estadia_huespedes eh
                where eh.estadia_id in (select id from public.reserva_estadias where reserva_id = v_reserva_id)), '[]'::jsonb),
            'pagos', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id)
                from public.pagos p where p.reserva_id = v_reserva_id), '[]'::jsonb),
            'servicios', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.id)
                from public.servicios s where s.reserva_id = v_reserva_id), '[]'::jsonb),
            'cargos_servicio', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.id)
                from public.cargos c where c.reserva_id = v_reserva_id and c.servicio_id is not null), '[]'::jsonb)
        ) into v_snapshot_despues;
        if v_snapshot_despues is distinct from v_invariantes_antes->v_reserva_id::text then
            raise exception 'CONFLICTO_FINANCIERO'
                using detail = 'TOTAL vigente alteró datos ajenos a la corrección financiera; lote revertido.';
        end if;

        if v_esperado <> v_objetivo then
            v_cambios := v_cambios + 1;
            select * into v_estadia from public.reserva_estadias where id = v_estadia_id;
            insert into public.eventos_auditoria(
                usuario_id, accion, tipo_evento, entidad_tipo, entidad_id,
                reserva_id, estadia_id, cabana_id, descripcion, cambios, datos_contexto, origen
            ) values (
                auth.uid(), 'Tarifa Cloudbeds aplicada', 'actualizacion', 'reserva_estadias', v_estadia_id,
                v_reserva_id, v_estadia_id, v_estadia.cabana_id,
                'Tarifa de alojamiento confirmada desde un PDF Cloudbeds',
                pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                    'campo', 'total_alojamiento', 'anterior', v_esperado, 'nuevo', v_objetivo
                )),
                pg_catalog.jsonb_build_object(
                    'operacion_id', v_operacion_id,
                    'tipo_estadia', v_tipo,
                    'total_anterior', v_esperado,
                    'total_nuevo', v_objetivo,
                    'diferencia', v_objetivo - v_esperado,
                    'fuente', 'cloudbeds_pdf',
                    'autoridad_financiera_version', v_autoridad_version,
                    'cloudbeds_reservation_number', nullif(pg_catalog.btrim(v_item->>'cloudbeds_reservation_number'), ''),
                    'cloudbeds_reservation_id', nullif(pg_catalog.btrim(v_item->>'cloudbeds_reservation_id'), ''),
                    'certeza', v_item->>'certeza',
                    'evidencia', v_item->'evidencia',
                    'autorizado_por', auth.uid(),
                    'confirmado_en', pg_catalog.clock_timestamp(),
                    'pagos_originales_sin_cambios', true,
                    'vinculo_cloudbeds_persistido', false
                ),
                'cloudbeds'
            );
        end if;
        v_resultados := v_resultados || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'reserva_id', v_reserva_id,
            'estadia_id', v_estadia_id,
            'tipo_estadia', v_tipo,
            'total_anterior', v_esperado,
            'total_nuevo', v_objetivo,
            'pagado_alojamiento', coalesce(v_pagado, 0),
            'saldo_alojamiento', coalesce(v_saldo, v_objetivo - coalesce(v_pagado, 0)),
            'sin_cambios', v_esperado = v_objetivo
        ));
    end loop;

    return pg_catalog.jsonb_build_object(
        'ok', true,
        'operacion_id', v_operacion_id,
        'cambios', v_cambios,
        'autoridad_financiera_version', v_autoridad_version,
        'resultados', v_resultados
    );
end;
$function$;

revoke all on function public.haiku_aplicar_tarifas_cloudbeds_v1(jsonb) from public, anon;
grant execute on function public.haiku_aplicar_tarifas_cloudbeds_v1(jsonb) to authenticated;
comment on function public.haiku_aplicar_tarifas_cloudbeds_v1(jsonb) is
'Cloudbeds Writer W1.3: acepta sólo TOTAL v31/v32, delega el lote completo en la autoridad pública, preserva invariantes y audita atómicamente.';

commit;
