CREATE OR REPLACE FUNCTION public.haiku_modificar_reserva_completa(p_reserva_id uuid, p_titular_nombre text, p_cabana_numero smallint, p_fecha_ingreso date, p_fecha_salida date, p_tipo_estadia text DEFAULT 'alojamiento'::text, p_adultos smallint DEFAULT 1, p_ninos smallint DEFAULT 0, p_mascotas smallint DEFAULT 0, p_correo_contacto text DEFAULT NULL::text, p_telefono_contacto text DEFAULT NULL::text, p_rut text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_tarifas jsonb DEFAULT '{}'::jsonb, p_tarifa_fullday bigint DEFAULT NULL::bigint, p_acompanantes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
    v_estadia public.reserva_estadias%rowtype;
    v_cabana_id uuid;
    v_salida_objetivo date;
    v_estructura_cambia boolean := false;
    v_reinicio_estado boolean := false;
    v_resultado jsonb;
begin
    if auth.uid() is null then
        raise exception 'Debe iniciar sesión para editar reservas';
    end if;

    if not private.haiku_tiene_permiso('reservas.editar'::text) then
        raise exception 'Sin permiso para editar reservas' using errcode = '42501';
    end if;

    if p_tipo_estadia not in ('alojamiento', 'fullday') then
        raise exception 'Tipo de estadía inválido';
    end if;

    select e.*
    into v_estadia
    from public.reserva_estadias e
    where e.reserva_id = p_reserva_id
      and e.estado_estadia not in ('cancelada', 'no_show')
    order by e.creado_en desc
    limit 1
    for update;

    if not found then
        raise exception 'La reserva no tiene una estadía activa editable';
    end if;

    select c.id
    into v_cabana_id
    from public.cabanas c
    where c.numero = p_cabana_numero
      and c.activa = true;

    if not found then
        raise exception 'La CAB % no existe o está inactiva', p_cabana_numero;
    end if;

    v_salida_objetivo := case
        when p_tipo_estadia = 'fullday' then p_fecha_ingreso
        else p_fecha_salida
    end;

    v_estructura_cambia :=
        v_estadia.cabana_id is distinct from v_cabana_id
        or v_estadia.fecha_ingreso is distinct from p_fecha_ingreso
        or v_estadia.fecha_salida is distinct from v_salida_objetivo
        or v_estadia.tipo_estadia is distinct from p_tipo_estadia;

    if v_estructura_cambia and (
        v_estadia.checkin_realizado_en is not null
        or v_estadia.checkout_realizado_en is not null
        or v_estadia.estado_estadia in ('hospedada', 'checked_out')
    ) then
        perform public.haiku_cambiar_estado_estadia(v_estadia.id, 'confirmada', now());
        v_reinicio_estado := true;
    end if;

    v_resultado := public.haiku_modificar_reserva_completa_core(
        p_reserva_id => p_reserva_id,
        p_titular_nombre => p_titular_nombre,
        p_cabana_numero => p_cabana_numero,
        p_fecha_ingreso => p_fecha_ingreso,
        p_fecha_salida => p_fecha_salida,
        p_tipo_estadia => p_tipo_estadia,
        p_adultos => p_adultos,
        p_ninos => p_ninos,
        p_mascotas => p_mascotas,
        p_correo_contacto => p_correo_contacto,
        p_telefono_contacto => p_telefono_contacto,
        p_rut => p_rut,
        p_observaciones => p_observaciones,
        p_tarifas => p_tarifas,
        p_tarifa_fullday => p_tarifa_fullday,
        p_acompanantes => p_acompanantes
    );

    return v_resultado || jsonb_build_object(
        'estado_operativo_reiniciado', v_reinicio_estado,
        'estado_operativo', case when v_reinicio_estado then 'confirmada' else null end
    );
end;
$function$;
