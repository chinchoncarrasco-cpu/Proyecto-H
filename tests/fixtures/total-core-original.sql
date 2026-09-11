CREATE OR REPLACE FUNCTION public.haiku_modificar_reserva_completa_core(p_reserva_id uuid, p_titular_nombre text, p_cabana_numero smallint, p_fecha_ingreso date, p_fecha_salida date, p_tipo_estadia text DEFAULT 'alojamiento'::text, p_adultos smallint DEFAULT 1, p_ninos smallint DEFAULT 0, p_mascotas smallint DEFAULT 0, p_correo_contacto text DEFAULT NULL::text, p_telefono_contacto text DEFAULT NULL::text, p_rut text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_tarifas jsonb DEFAULT '{}'::jsonb, p_tarifa_fullday bigint DEFAULT NULL::bigint, p_acompanantes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
    v_reserva public.reservas%rowtype;
    v_estadia public.reserva_estadias%rowtype;
    v_cabana_id uuid;
    v_precio_base bigint;
    v_rut_normalizado text;
    v_titular_huesped_id uuid;
    v_companion_ids uuid[] := '{}'::uuid[];
    v_companion_id uuid;
    v_nombre text;
    v_idx integer := 0;
    v_existentes integer := 0;
    v_fecha date;
    v_tarifa_text text;
    v_tarifa bigint;
    v_total_objetivo bigint := 0;
    v_total_actual bigint := 0;
    v_estructura_cambia boolean := false;
    v_tarifas_cambian boolean := false;
    v_reconstruir boolean := false;
    v_aplicado_bruto bigint := 0;
    v_app record;
    v_cargo record;
    v_restante bigint;
    v_aplicar bigint;
    v_disponible bigint;
    v_origen_aplicado bigint;
    v_devuelto bigint;
    v_nueva_salida date;
begin
    if auth.uid() is null then
        raise exception 'Debe iniciar sesión para editar reservas';
    end if;

    if not private.haiku_tiene_permiso('reservas.editar'::text) then
        raise exception 'Sin permiso para editar reservas' using errcode = '42501';
    end if;

    if p_titular_nombre is null or btrim(p_titular_nombre) = '' then
        raise exception 'El titular es obligatorio';
    end if;

    if p_tipo_estadia not in ('alojamiento','fullday') then
        raise exception 'Tipo de estadía inválido';
    end if;

    if jsonb_typeof(coalesce(p_tarifas, '{}'::jsonb)) <> 'object' then
        raise exception 'Las tarifas deben enviarse como objeto JSON fecha → monto';
    end if;

    if jsonb_typeof(coalesce(p_acompanantes, '[]'::jsonb)) <> 'array' then
        raise exception 'Los acompañantes deben enviarse como arreglo JSON';
    end if;

    if p_tipo_estadia = 'alojamiento' then
        if p_fecha_ingreso is null or p_fecha_salida is null or p_fecha_salida <= p_fecha_ingreso then
            raise exception 'El alojamiento debe tener una fecha de salida posterior al ingreso';
        end if;
        v_nueva_salida := p_fecha_salida;
    else
        if p_fecha_ingreso is null then
            raise exception 'El Full Day requiere una fecha';
        end if;
        v_nueva_salida := p_fecha_ingreso;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_reserva_id::text, 0));

    select * into v_reserva
    from public.reservas
    where id = p_reserva_id
    for update;

    if not found then
        raise exception 'La reserva no existe';
    end if;

    if v_reserva.estado_reserva in ('cancelada','no_show') then
        raise exception 'No se puede editar una reserva cancelada o no-show';
    end if;

    select * into v_estadia
    from public.reserva_estadias
    where reserva_id = p_reserva_id
      and estado_estadia not in ('cancelada','no_show')
    order by creado_en desc
    limit 1
    for update;

    if not found then
        raise exception 'La reserva no tiene una estadía activa editable';
    end if;

    select id, precio_base
      into v_cabana_id, v_precio_base
    from public.cabanas
    where numero = p_cabana_numero
      and activa = true;

    if not found then
        raise exception 'La CAB % no existe o está inactiva', p_cabana_numero;
    end if;

    v_estructura_cambia :=
        v_estadia.cabana_id is distinct from v_cabana_id
        or v_estadia.fecha_ingreso is distinct from p_fecha_ingreso
        or v_estadia.fecha_salida is distinct from v_nueva_salida
        or v_estadia.tipo_estadia is distinct from p_tipo_estadia;

    if v_estadia.checkout_realizado_en is not null and v_estructura_cambia then
        raise exception 'No se puede reubicar o convertir una estadía que ya tiene Check-out';
    end if;

    if v_estadia.checkin_realizado_en is not null and (
        v_estadia.cabana_id is distinct from v_cabana_id
        or v_estadia.fecha_ingreso is distinct from p_fecha_ingreso
        or v_estadia.tipo_estadia is distinct from p_tipo_estadia
    ) then
        raise exception 'Una estadía con Check-in sólo puede extender/reducir salida, huéspedes o tarifa; no mover ingreso, cabaña ni tipo';
    end if;

    create temporary table if not exists haiku_mod_target_noches (
        fecha date primary key,
        tarifa bigint not null
    ) on commit drop;
    truncate table haiku_mod_target_noches;

    if p_tipo_estadia = 'alojamiento' then
        v_fecha := p_fecha_ingreso;
        while v_fecha < v_nueva_salida loop
            v_tarifa_text := coalesce(p_tarifas, '{}'::jsonb) ->> to_char(v_fecha, 'YYYY-MM-DD');
            if v_tarifa_text is null or btrim(v_tarifa_text) = '' then
                if v_precio_base is null or v_precio_base <= 0 then
                    raise exception 'Falta tarifa para la noche %', v_fecha;
                end if;
                v_tarifa := v_precio_base;
            else
                begin
                    v_tarifa := v_tarifa_text::bigint;
                exception when others then
                    raise exception 'Tarifa inválida para la noche %', v_fecha;
                end;
            end if;

            if v_tarifa <= 0 then
                raise exception 'La tarifa de la noche % debe ser mayor que cero', v_fecha;
            end if;

            insert into haiku_mod_target_noches(fecha, tarifa)
            values (v_fecha, v_tarifa);
            v_total_objetivo := v_total_objetivo + v_tarifa;
            v_fecha := v_fecha + 1;
        end loop;
    else
        v_tarifa_text := coalesce(p_tarifas, '{}'::jsonb) ->> to_char(p_fecha_ingreso, 'YYYY-MM-DD');
        if p_tarifa_fullday is not null then
            v_tarifa := p_tarifa_fullday;
        elsif v_tarifa_text is not null and btrim(v_tarifa_text) <> '' then
            begin
                v_tarifa := v_tarifa_text::bigint;
            exception when others then
                raise exception 'Tarifa Full Day inválida';
            end;
        else
            v_tarifa := v_precio_base;
        end if;

        if coalesce(v_tarifa, 0) <= 0 then
            raise exception 'El Full Day requiere una tarifa mayor que cero';
        end if;
        v_total_objetivo := v_tarifa;
    end if;

    select coalesce(sum(c.monto),0)::bigint
      into v_total_actual
    from public.cargos c
    where c.estadia_id = v_estadia.id
      and c.tipo_cargo = 'alojamiento'
      and c.estado = 'activo';

    if p_tipo_estadia = 'alojamiento' and v_estadia.tipo_estadia = 'alojamiento' and not v_estructura_cambia then
        v_tarifas_cambian := exists (
            select 1
            from haiku_mod_target_noches t
            left join public.estadia_noches n
              on n.estadia_id = v_estadia.id and n.fecha = t.fecha
            where n.id is null or n.tarifa <> t.tarifa
        ) or exists (
            select 1
            from public.estadia_noches n
            join public.cargos c on c.estadia_noche_id = n.id and c.estado = 'activo' and c.tipo_cargo='alojamiento'
            where n.estadia_id = v_estadia.id
              and not exists (select 1 from haiku_mod_target_noches t where t.fecha=n.fecha)
        );
    elsif p_tipo_estadia = 'fullday' and v_estadia.tipo_estadia = 'fullday' and not v_estructura_cambia then
        v_tarifas_cambian := v_total_actual <> v_total_objetivo;
    else
        v_tarifas_cambian := true;
    end if;

    v_reconstruir := v_estructura_cambia or v_tarifas_cambian;

    if v_estructura_cambia then
        if p_tipo_estadia = 'alojamiento' then
            if exists (
                select 1
                from public.reserva_estadias e
                where e.id <> v_estadia.id
                  and e.cabana_id = v_cabana_id
                  and e.estado_estadia not in ('cancelada','no_show')
                  and (
                    (e.tipo_estadia='alojamiento' and daterange(e.fecha_ingreso,e.fecha_salida,'[)') && daterange(p_fecha_ingreso,v_nueva_salida,'[)'))
                    or (e.tipo_estadia='fullday' and e.fecha_ingreso between p_fecha_ingreso and v_nueva_salida)
                  )
            ) then
                raise exception 'La CAB % tiene otra reserva que se cruza con el nuevo rango', p_cabana_numero;
            end if;
        else
            if exists (
                select 1
                from public.reserva_estadias e
                where e.id <> v_estadia.id
                  and e.cabana_id = v_cabana_id
                  and e.estado_estadia not in ('cancelada','no_show')
                  and (
                    (e.tipo_estadia='fullday' and e.fecha_ingreso = p_fecha_ingreso)
                    or (e.tipo_estadia='alojamiento' and p_fecha_ingreso between e.fecha_ingreso and e.fecha_salida)
                  )
            ) then
                raise exception 'La CAB % no está disponible para Full Day en esa fecha', p_cabana_numero;
            end if;
        end if;

        if exists (
            select 1
            from public.bloqueos_cabana b
            where b.cabana_id = v_cabana_id
              and b.estado = 'activo'
              and tstzrange(b.desde, coalesce(b.hasta,'infinity'::timestamptz),'[)') &&
                  tstzrange(
                    p_fecha_ingreso::timestamp at time zone 'America/Santiago',
                    (case when p_tipo_estadia='fullday' then p_fecha_ingreso + 1 else v_nueva_salida end)::timestamp at time zone 'America/Santiago',
                    '[)'
                  )
        ) then
            raise exception 'La CAB % tiene un bloqueo activo en la nueva fecha/rango', p_cabana_numero;
        end if;
    end if;

    if v_reconstruir and exists (
        select 1 from public.cargo_ajustes ca
        where ca.reserva_id = p_reserva_id and ca.estado='activo'
    ) then
        raise exception 'La reserva tiene un ajuste de cargo activo. Anúlalo antes de cambiar fechas, cabaña, tipo o tarifas.';
    end if;

    if v_reconstruir then
        create temporary table if not exists haiku_mod_apps_snapshot (
            pago_id uuid primary key,
            tipo_movimiento text not null,
            pago_origen_id uuid,
            fecha_pago timestamptz,
            monto bigint not null
        ) on commit drop;
        truncate table haiku_mod_apps_snapshot;

        insert into haiku_mod_apps_snapshot(pago_id,tipo_movimiento,pago_origen_id,fecha_pago,monto)
        select p.id,p.tipo_movimiento,p.pago_origen_id,p.fecha_pago,sum(pa.monto_aplicado)::bigint
        from public.pago_aplicaciones pa
        join public.pagos p on p.id=pa.pago_id and p.estado='confirmado'
        join public.cargos c on c.id=pa.cargo_id
        where c.estadia_id=v_estadia.id
          and c.tipo_cargo='alojamiento'
          and c.estado='activo'
        group by p.id,p.tipo_movimiento,p.pago_origen_id,p.fecha_pago;

        select coalesce(sum(monto) filter (where tipo_movimiento='pago'),0)::bigint
          into v_aplicado_bruto
        from haiku_mod_apps_snapshot;

        if v_total_objetivo < v_aplicado_bruto then
            raise exception 'El nuevo total (% CLP) no puede quedar por debajo del dinero ya aplicado al alojamiento (% CLP)', v_total_objetivo, v_aplicado_bruto;
        end if;

        delete from public.pago_aplicaciones pa
        using public.cargos c
        where pa.cargo_id=c.id
          and c.estadia_id=v_estadia.id
          and c.tipo_cargo='alojamiento'
          and c.estado='activo';

        update public.cargos
        set estado='anulado', actualizado_en=now()
        where estadia_id=v_estadia.id
          and tipo_cargo='alojamiento'
          and estado='activo';

        update public.reserva_estadias
        set cabana_id=v_cabana_id,
            fecha_ingreso=p_fecha_ingreso,
            fecha_salida=v_nueva_salida,
            tipo_estadia=p_tipo_estadia,
            adultos=greatest(coalesce(p_adultos,0),0),
            ninos=greatest(coalesce(p_ninos,0),0),
            mascotas=greatest(coalesce(p_mascotas,0),0)
        where id=v_estadia.id;

        if p_tipo_estadia='alojamiento' then
            for v_cargo in select fecha,tarifa from haiku_mod_target_noches order by fecha loop
                if exists (select 1 from public.estadia_noches n where n.estadia_id=v_estadia.id and n.fecha=v_cargo.fecha) then
                    update public.estadia_noches
                    set tarifa=v_cargo.tarifa,
                        origen_tarifa='manual'
                    where estadia_id=v_estadia.id and fecha=v_cargo.fecha;
                else
                    insert into public.estadia_noches(estadia_id,fecha,tarifa,origen_tarifa)
                    values(v_estadia.id,v_cargo.fecha,v_cargo.tarifa,'manual');
                end if;
            end loop;
        else
            insert into public.cargos(
                reserva_id,estadia_id,tipo_cargo,concepto,monto,moneda,estado,creado_por
            ) values (
                p_reserva_id,v_estadia.id,'alojamiento',
                'Full Day · '||to_char(p_fecha_ingreso,'DD-MM-YYYY'),
                v_total_objetivo,'CLP','activo',auth.uid()
            );
        end if;

        for v_app in
            select * from haiku_mod_apps_snapshot where tipo_movimiento='pago' order by fecha_pago,pago_id
        loop
            v_restante := v_app.monto;
            for v_cargo in
                select ec.cargo_id,ec.saldo_cargo,c.creado_en
                from public.vista_estado_cargos ec
                join public.cargos c on c.id=ec.cargo_id
                where c.estadia_id=v_estadia.id
                  and ec.tipo_cargo='alojamiento'
                  and ec.estado='activo'
                  and ec.saldo_cargo>0
                order by c.creado_en,ec.cargo_id
            loop
                exit when v_restante<=0;
                v_aplicar := least(v_restante,v_cargo.saldo_cargo);
                if v_aplicar>0 then
                    insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado)
                    values(v_app.pago_id,v_cargo.cargo_id,v_aplicar);
                    v_restante := v_restante-v_aplicar;
                end if;
            end loop;
            if v_restante>0 then
                raise exception 'No fue posible reasignar completamente un pago existente al nuevo alojamiento';
            end if;
        end loop;

        for v_app in
            select * from haiku_mod_apps_snapshot where tipo_movimiento='devolucion' order by fecha_pago,pago_id
        loop
            v_restante := v_app.monto;
            for v_cargo in
                select opa.cargo_id,opa.monto_aplicado
                from public.pago_aplicaciones opa
                join public.cargos oc on oc.id=opa.cargo_id
                where opa.pago_id=v_app.pago_origen_id
                  and oc.estadia_id=v_estadia.id
                order by opa.creado_en,opa.id
            loop
                exit when v_restante<=0;
                v_origen_aplicado := v_cargo.monto_aplicado;
                select coalesce(sum(pa.monto_aplicado),0)::bigint
                  into v_devuelto
                from public.pago_aplicaciones pa
                join public.pagos p on p.id=pa.pago_id
                where pa.cargo_id=v_cargo.cargo_id
                  and p.pago_origen_id=v_app.pago_origen_id
                  and p.tipo_movimiento='devolucion'
                  and p.estado='confirmado';
                v_disponible := greatest(v_origen_aplicado-v_devuelto,0);
                v_aplicar := least(v_restante,v_disponible);
                if v_aplicar>0 then
                    insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado)
                    values(v_app.pago_id,v_cargo.cargo_id,v_aplicar);
                    v_restante := v_restante-v_aplicar;
                end if;
            end loop;
            if v_restante>0 then
                raise exception 'No fue posible reasignar completamente una devolución existente';
            end if;
        end loop;
    else
        update public.reserva_estadias
        set adultos=greatest(coalesce(p_adultos,0),0),
            ninos=greatest(coalesce(p_ninos,0),0),
            mascotas=greatest(coalesce(p_mascotas,0),0)
        where id=v_estadia.id;
    end if;

    v_rut_normalizado := null;
    if p_rut is not null and btrim(p_rut)<>'' then
        v_rut_normalizado := regexp_replace(upper(btrim(p_rut)),'[^0-9K]','','g');
    end if;

    update public.reservas
    set titular_nombre=btrim(p_titular_nombre),
        titular_tipo_documento=case when v_rut_normalizado is null then null else 'rut' end,
        titular_numero_documento=v_rut_normalizado,
        correo_contacto=nullif(btrim(coalesce(p_correo_contacto,'')),''),
        telefono_contacto=nullif(btrim(coalesce(p_telefono_contacto,'')),''),
        observaciones=nullif(btrim(coalesce(p_observaciones,'')),'')
    where id=p_reserva_id;

    v_titular_huesped_id := v_reserva.titular_huesped_id;
    if v_titular_huesped_id is not null then
        update public.huespedes
        set nombre=btrim(p_titular_nombre),
            tipo_documento=case when v_rut_normalizado is null then null else 'rut' end,
            numero_documento=v_rut_normalizado,
            telefono=nullif(btrim(coalesce(p_telefono_contacto,'')),''),
            correo=nullif(btrim(coalesce(p_correo_contacto,'')),'')
        where id=v_titular_huesped_id;
    end if;

    select coalesce(array_agg(h.id order by h.creado_en,h.id),'{}'::uuid[])
      into v_companion_ids
    from public.reserva_huespedes rh
    join public.huespedes h on h.id=rh.huesped_id
    where rh.reserva_id=p_reserva_id
      and rh.huesped_id is distinct from v_titular_huesped_id;

    v_existentes := coalesce(array_length(v_companion_ids,1),0);
    for v_nombre in
        select btrim(value) from jsonb_array_elements_text(coalesce(p_acompanantes,'[]'::jsonb)) where btrim(value)<>''
    loop
        v_idx := v_idx+1;
        if v_idx<=v_existentes then
            v_companion_id:=v_companion_ids[v_idx];
            update public.huespedes set nombre=v_nombre where id=v_companion_id;
            insert into public.estadia_huespedes(estadia_id,huesped_id)
            values(v_estadia.id,v_companion_id)
            on conflict(estadia_id,huesped_id) do nothing;
        else
            insert into public.huespedes(nombre) values(v_nombre) returning id into v_companion_id;
            insert into public.reserva_huespedes(reserva_id,huesped_id)
            values(p_reserva_id,v_companion_id)
            on conflict(reserva_id,huesped_id) do nothing;
            insert into public.estadia_huespedes(estadia_id,huesped_id)
            values(v_estadia.id,v_companion_id)
            on conflict(estadia_id,huesped_id) do nothing;
        end if;
    end loop;

    if v_idx<v_existentes then
        for i in (v_idx+1)..v_existentes loop
            delete from public.estadia_huespedes where estadia_id=v_estadia.id and huesped_id=v_companion_ids[i];
            delete from public.reserva_huespedes where reserva_id=p_reserva_id and huesped_id=v_companion_ids[i];
        end loop;
    end if;

    return jsonb_build_object(
        'reserva_id',p_reserva_id,
        'estadia_id',v_estadia.id,
        'cabana_numero',p_cabana_numero,
        'fecha_ingreso',p_fecha_ingreso,
        'fecha_salida',v_nueva_salida,
        'tipo_estadia',p_tipo_estadia,
        'total_alojamiento',v_total_objetivo,
        'reconstruyo_finanzas',v_reconstruir,
        'actualizada',true
    );
end;
$function$;
