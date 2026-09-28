-- Coordinador manual. Depende del schema base y de la RPC operativa existente;
-- no sustituye sus reglas de check-in/check-out ni las rutas de reactivación.
create function public.haiku_cambiar_estado_reserva_manual_v1(
    p_reserva_id uuid, p_estadia_id uuid, p_estado text, p_esperado jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
    r public.reservas%rowtype;
    e public.reserva_estadias%rowtype;
    v_actual jsonb;
    v_esperado jsonb;
    v_anterior text;
    v_abono bigint;
    v_operacion uuid := gen_random_uuid();
begin
    if auth.uid() is null or private.haiku_usuario_activo() is distinct from true then
        raise exception 'Debe iniciar sesión con un usuario activo' using errcode = '42501';
    end if;
    if p_estado is null or p_estado not in ('pendiente','confirmada','hospedada','checked_out','cancelada','no_show') then
        raise exception 'Estado no válido';
    end if;
    if private.haiku_tiene_permiso('reservas.ver') is distinct from true or
       private.haiku_tiene_permiso(case when p_estado='cancelada' then 'reservas.cancelar' else 'reservas.editar' end) is distinct from true then
        raise exception 'No tiene permiso para cambiar este estado' using errcode = '42501';
    end if;
    select * into r from public.reservas where id=p_reserva_id for update;
    if not found then raise exception 'La reserva no existe'; end if;
    -- Bloqueo estable de TODAS las estadías: cancelación/No Show son globales.
    perform 1 from public.reserva_estadias where reserva_id=r.id order by id for update;
    select * into e from public.reserva_estadias where id=p_estadia_id and reserva_id=r.id;
    if not found then raise exception 'La estadía no pertenece a esta reserva'; end if;
    if p_esperado is null or jsonb_typeof(p_esperado->'estadias') <> 'array' then
        raise exception 'Falta el estado que se confirmó';
    end if;
    select jsonb_build_object('estado_reserva', r.estado_reserva, 'estadias', jsonb_agg(
        jsonb_build_object('id', s.id, 'cabana_numero', c.numero, 'estado_estadia', s.estado_estadia,
            'fecha_ingreso', s.fecha_ingreso, 'fecha_salida', s.fecha_salida, 'tipo_estadia', s.tipo_estadia,
            'checkin_realizado_en', s.checkin_realizado_en, 'checkout_realizado_en', s.checkout_realizado_en) order by s.id))
      into v_actual from public.reserva_estadias s join public.cabanas c on c.id=s.cabana_id where s.reserva_id=r.id;
    -- Normaliza fechas y timestamps antes de comparar el snapshot del cliente.
    select jsonb_build_object('estado_reserva', p_esperado->>'estado_reserva', 'estadias', jsonb_agg(
        jsonb_build_object('id', s.id, 'cabana_numero', s.cabana_numero, 'estado_estadia', s.estado_estadia,
            'fecha_ingreso', s.fecha_ingreso, 'fecha_salida', s.fecha_salida, 'tipo_estadia', s.tipo_estadia,
            'checkin_realizado_en', s.checkin_realizado_en, 'checkout_realizado_en', s.checkout_realizado_en) order by s.id))
      into v_esperado from jsonb_to_recordset(p_esperado->'estadias') as s(
        id uuid, cabana_numero smallint, estado_estadia text, fecha_ingreso date, fecha_salida date,
        tipo_estadia text, checkin_realizado_en timestamptz, checkout_realizado_en timestamptz);
    if v_actual is distinct from v_esperado then
        raise exception 'La reserva cambió desde la confirmación. Reabra la ficha' using errcode = '40001';
    end if;
    v_anterior := case when r.estado_reserva in ('cancelada','no_show') then r.estado_reserva
        when e.checkout_realizado_en is not null or e.estado_estadia='checked_out' then 'checked_out'
        when e.checkin_realizado_en is not null or e.estado_estadia='hospedada' then 'hospedada'
        else e.estado_estadia end;
    if v_anterior=p_estado then
        return jsonb_build_object('ok',true,'estado',p_estado,'sin_cambios',true);
    end if;
    select coalesce(sum(monto),0) into v_abono from public.pagos
      where reserva_id=r.id and estado='confirmado' and tipo_movimiento='pago' and etapa_operativa='abono';
    if p_estado='pendiente' and v_abono>0 then
        raise exception 'Tiene abono confirmado; no puede quedar pendiente';
    end if;
    perform set_config('app.haiku_origen','usuario',true);
    perform set_config('app.haiku_operacion_id',v_operacion::text,true);
    if p_estado='cancelada' then
        perform public.haiku_cancelar_reserva(r.id);
    elsif r.estado_reserva='cancelada' then
        if p_estado not in ('pendiente','confirmada') then
            raise exception 'Primero debe reactivar como Pendiente o Confirmada';
        end if;
        if (select count(*) from public.reserva_estadias where reserva_id=r.id)<>1 then
            raise exception 'La reactivación de varias estadías requiere revisión';
        end if;
        perform public.haiku_reactivar_reserva_cancelada(r.id,p_estado);
    elsif r.estado_reserva='no_show' or e.estado_estadia in ('cancelada','no_show') then
        raise exception 'No existe una ruta segura de reactivación de esta estadía; requiere revisión';
    elsif p_estado='no_show' then
        if exists(select 1 from public.reserva_estadias where reserva_id=r.id and
            (checkin_realizado_en is not null or checkout_realizado_en is not null or estado_estadia in ('hospedada','checked_out'))) then
            raise exception 'Una reserva con check-in o check-out no puede ser No Show';
        end if;
        if exists(select 1 from public.reserva_estadias where reserva_id=r.id and
            (fecha_ingreso is null or clock_timestamp() < (fecha_ingreso::timestamp at time zone 'America/Santiago'))) then
            raise exception 'No Show se habilita desde las 00:00 de la fecha de ingreso en Chile';
        end if;
        update public.reserva_estadias set estado_estadia='no_show' where reserva_id=r.id;
        update public.reservas set estado_reserva='no_show' where id=r.id;
    else
        -- La RPC oficial aplica timestamps, reversión y protección temporal.
        -- Si no está disponible o rechaza el cambio, toda esta transacción falla.
        perform public.haiku_cambiar_estado_estadia(p_estadia_id => e.id,
            p_estado => case when p_estado='pendiente' then 'confirmada' else p_estado end);
        if p_estado='pendiente' then
            update public.reserva_estadias set estado_estadia='pendiente' where id=e.id;
            update public.reservas set estado_reserva=case
                when exists(select 1 from public.reserva_estadias where reserva_id=r.id and estado_estadia='hospedada') then 'hospedada'
                when exists(select 1 from public.reserva_estadias where reserva_id=r.id and estado_estadia='confirmada') then 'confirmada'
                when exists(select 1 from public.reserva_estadias where reserva_id=r.id and estado_estadia='pendiente') then 'pendiente'
                else 'checked_out' end where id=r.id;
        end if;
    end if;
    if not exists(select 1 from public.reserva_estadias where id=e.id and estado_estadia=p_estado and
        case when p_estado='checked_out' then checkout_realizado_en is not null
            when p_estado='hospedada' then checkin_realizado_en is not null and checkout_realizado_en is null
            when p_estado in ('pendiente','confirmada') then checkin_realizado_en is null and checkout_realizado_en is null
            else true end) then
        raise exception 'No se pudo verificar el estado solicitado; operación revertida';
    end if;
    -- Reutiliza eventos_auditoria; los triggers oficiales permanecen intactos.
    -- Este evento acredita el cambio MANUAL incluso si falta algún trigger base.
    insert into public.eventos_auditoria(usuario_id,accion,tipo_evento,entidad_tipo,entidad_id,
        reserva_id,estadia_id,cabana_id,descripcion,cambios,datos_contexto,origen)
    values(auth.uid(),'Cambio manual de estado','actualizacion',
        case when p_estado in ('cancelada','no_show') then 'reservas' else 'reserva_estadias' end,
        case when p_estado in ('cancelada','no_show') then r.id else e.id end,r.id,e.id,e.cabana_id,
        'Cambio manual confirmado en Ver reserva',
        jsonb_build_array(jsonb_build_object('campo','estado','anterior',v_anterior,'nuevo',p_estado)),
        jsonb_build_object('operacion_id',v_operacion,'estado_previo',v_actual,
            'alcance',case when p_estado in ('cancelada','no_show') then 'reserva' else 'estadia' end),'usuario');
    return jsonb_build_object('ok',true,'estado',p_estado,'estado_anterior',v_anterior,
        'reserva_id',r.id,'estadia_id',e.id,'operacion_id',v_operacion);
end;
$function$;
revoke all on function public.haiku_cambiar_estado_reserva_manual_v1(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.haiku_cambiar_estado_reserva_manual_v1(uuid,uuid,text,jsonb) to authenticated;
comment on function public.haiku_cambiar_estado_reserva_manual_v1(uuid,uuid,text,jsonb) is
'Cambio manual confirmado con identidad exacta, estado esperado, permisos y auditoría existente. Delega las reglas operativas y de reactivación a las RPC oficiales.';
