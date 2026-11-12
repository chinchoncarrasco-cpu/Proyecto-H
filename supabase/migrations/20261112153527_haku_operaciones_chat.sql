-- Cambios confirmados en el chat con la misma autoridad de Proyecto H.
begin;

create function private.haiku_autorizar_operacion_chat_v1(p_permiso text)
returns void language plpgsql security invoker set search_path=pg_catalog,public,private
as $$
begin
  if auth.uid() is null or private.haiku_usuario_activo() is distinct from true
     or private.haiku_tiene_permiso(p_permiso) is distinct from true then
    raise exception 'Tu cuenta no tiene permiso para esta operación' using errcode='42501';
  end if;
  perform set_config('app.haiku_origen','haku',true);
  perform set_config('app.haiku_operacion_id',gen_random_uuid()::text,true);
end;
$$;
revoke all on function private.haiku_autorizar_operacion_chat_v1(text) from public,anon,authenticated;

create function private.haiku_editar_reserva_asistente_impl_v1(
  p_reserva_id uuid,p_estadia_id uuid,p_esperado jsonb,p_datos jsonb,p_tarifa_base bigint
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare
  v_actual jsonb;
  v_final jsonb;
  v_respuesta jsonb;
  v_r public.reservas%rowtype;
  v_e public.reserva_estadias%rowtype;
  v_cabana public.cabanas%rowtype;
  v_acompanantes jsonb;
  v_campo text:=p_datos->>'campo';
  v_valor text:=nullif(btrim(p_datos->>'valor'),'');
begin
  perform private.haiku_autorizar_operacion_chat_v1('reservas.editar');
  if private.haiku_tiene_permiso('reservas.ver') is distinct from true then
    raise exception 'Tu cuenta necesita permiso para ver reservas' using errcode='42501';
  end if;

  -- El editor normal bloquea la estadía antes de entrar a su operación de reserva.
  select * into v_e from public.reserva_estadias
    where id=p_estadia_id and reserva_id=p_reserva_id and estado_estadia not in ('cancelada','no_show') for update;
  if not found then raise exception 'La estadía ya no está disponible para editar'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(p_reserva_id::text,0)) or
     not pg_try_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_reserva_id::text)) then
    raise exception 'La reserva tiene otra operación en curso. Vuelve a consultar' using errcode='40001';
  end if;
  select * into v_r from public.reservas where id=p_reserva_id for update;
  if not found or v_r.estado_reserva in ('cancelada','no_show') then
    raise exception 'La reserva ya no está disponible para editar';
  end if;
  if (select count(*) from public.reserva_estadias where reserva_id=p_reserva_id
        and estado_estadia not in ('cancelada','no_show')) <> 1 then
    raise exception 'La reserva requiere revisar sus estadías antes de editar';
  end if;

  v_actual:=public.haiku_ficha_reserva_core(p_reserva_id);
  if v_actual is null or v_actual is distinct from p_esperado then
    raise exception 'La reserva cambió. Vuelve a pedir la edición' using errcode='40001';
  end if;
  -- El contacto y el nombre operativo pertenecen a la reserva. La ficha
  -- personal de un huésped puede estar compartida con otras reservas.
  if v_campo in ('titular_nombre','correo_contacto','telefono_contacto') then
    if v_valor is null or
       (v_campo='titular_nombre' and length(v_valor)>180) or
       (v_campo='correo_contacto' and (length(v_valor)>254 or v_valor !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$')) or
       (v_campo='telefono_contacto' and (v_valor !~ '^[+0-9][0-9 ()-]{6,22}$' or length(regexp_replace(v_valor,'[^0-9]','','g'))<8)) then
      raise exception 'Revisa el nuevo dato de contacto o titular';
    end if;
    update public.reservas set
      titular_nombre=case when v_campo='titular_nombre' then v_valor else titular_nombre end,
      correo_contacto=case when v_campo='correo_contacto' then v_valor else correo_contacto end,
      telefono_contacto=case when v_campo='telefono_contacto' then v_valor else telefono_contacto end
      where id=p_reserva_id;
    return jsonb_build_object('reserva_id',p_reserva_id,'estadia_id',p_estadia_id);
  end if;
  if v_campo='ocupacion' then
    if jsonb_array_length(v_actual->'estadias')<>1 then raise exception 'Revisa la ocupación de cada estadía en la ficha'; end if;
    return public.haiku_actualizar_ocupacion_reserva(
      p_reserva_id,(p_datos->>'adultos')::smallint,(p_datos->>'ninos')::smallint,(p_datos->>'mascotas')::smallint);
  end if;
  if v_campo is not null then raise exception 'Indica un campo editable de la reserva'; end if;

  select * into v_cabana from public.cabanas where numero=(p_datos->>'cabana_numero')::smallint and activa for share;
  if not found or (p_tarifa_base is not null and v_cabana.precio_base is distinct from p_tarifa_base) then
    raise exception 'Cambió la cabaña o su tarifa base. Revisa nuevamente la edición' using errcode='40001';
  end if;

  select coalesce(jsonb_agg(h.nombre order by h.creado_en,h.id),'[]'::jsonb) into v_acompanantes
    from public.reserva_huespedes rh join public.huespedes h on h.id=rh.huesped_id
    where rh.reserva_id=p_reserva_id and h.id is distinct from v_r.titular_huesped_id;
  v_respuesta:=public.haiku_modificar_reserva_completa(
    p_reserva_id,v_r.titular_nombre,v_cabana.numero,
    (p_datos->>'fecha_ingreso')::date,(p_datos->>'fecha_salida')::date,v_e.tipo_estadia,
    v_e.adultos,v_e.ninos,v_e.mascotas,v_r.correo_contacto,v_r.telefono_contacto,v_r.titular_numero_documento,v_r.observaciones,
    p_datos->'tarifas',(p_datos->>'tarifa_fullday')::bigint,v_acompanantes
  );
  v_final:=public.haiku_ficha_reserva_core(p_reserva_id);
  if (v_final->'reserva')-'estado_reserva' is distinct from (v_actual->'reserva')-'estado_reserva' or
     v_final->'huespedes' is distinct from v_actual->'huespedes' then
    raise exception 'La reserva tiene datos de identidad que requieren revisión en la ficha';
  end if;
  return v_respuesta;
end;
$$;
revoke all on function private.haiku_editar_reserva_asistente_impl_v1(uuid,uuid,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function private.haiku_editar_reserva_asistente_impl_v1(uuid,uuid,jsonb,jsonb,bigint) to authenticated;
create function public.haiku_editar_reserva_asistente_v1(
  p_reserva_id uuid,p_estadia_id uuid,p_esperado jsonb,p_datos jsonb,p_tarifa_base bigint
) returns jsonb language sql security invoker set search_path=pg_catalog,public,private
as $$ select private.haiku_editar_reserva_asistente_impl_v1(p_reserva_id,p_estadia_id,p_esperado,p_datos,p_tarifa_base); $$;
revoke all on function public.haiku_editar_reserva_asistente_v1(uuid,uuid,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.haiku_editar_reserva_asistente_v1(uuid,uuid,jsonb,jsonb,bigint) to authenticated;

create function private.haiku_reprogramar_servicio_asistente_impl_v1(
  p_servicio_id uuid,p_estadia_id uuid,p_version timestamptz,p_fecha date,p_hora time
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare
  v_reserva_id uuid;
  v_s public.servicios%rowtype;
  v_e public.reserva_estadias%rowtype;
  v_r public.reservas%rowtype;
  v_c public.catalogo_servicios%rowtype;
  v_recurso_id uuid;
  v_fin time;
begin
  perform private.haiku_autorizar_operacion_chat_v1('servicios.editar');
  select reserva_id into v_reserva_id from public.servicios where id=p_servicio_id;
  if not found or p_fecha is null or p_version is null then raise exception 'Identifica el servicio y su nuevo horario'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_reserva_id::text,0));
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',v_reserva_id::text));
  select * into v_r from public.reservas where id=v_reserva_id for update;
  select * into v_s from public.servicios where id=p_servicio_id for update;
  select * into v_e from public.reserva_estadias where id=p_estadia_id for update;
  select * into v_c from public.catalogo_servicios where id=v_s.catalogo_servicio_id and activo;
  if v_s.actualizado_en is distinct from p_version or v_s.estadia_id is distinct from p_estadia_id or
     v_s.reserva_id is distinct from v_reserva_id or v_e.reserva_id is distinct from v_reserva_id or
     v_s.estado_servicio is distinct from 'programado' or v_r.estado_reserva in ('cancelada','no_show') or
     v_e.estado_estadia in ('cancelada','no_show') or v_c.id is null then
    raise exception 'El servicio o la reserva cambiaron. Revisa la agenda' using errcode='40001';
  end if;
  if p_fecha<v_e.fecha_ingreso or p_fecha>v_e.fecha_salida or
     (v_c.codigo='lateCheckout' and p_fecha<>v_e.fecha_salida) or
     (v_c.codigo='earlyCheckin' and p_fecha<>v_e.fecha_ingreso) then
    raise exception 'La fecha del servicio debe corresponder a la estadía';
  end if;
  if (p_hora is null) <> (v_s.hora_inicio is null) then
    raise exception 'Se requiere conservar la duración del servicio original';
  end if;
  if p_hora is not null then
    v_fin:=p_hora+(v_s.hora_fin-v_s.hora_inicio);
    if v_fin<=p_hora then raise exception 'El servicio debe terminar el mismo día'; end if;
  end if;

  v_recurso_id:=v_s.recurso_id;
  if v_c.codigo in ('tinajaTonel','tinajaJacuzzi') then
    if p_hora is null or p_hora<time '08:00' or v_fin>time '23:15' or
       (v_e.tipo_estadia='fullday' and (p_hora<time '09:30' or v_fin>time '21:30')) then
      raise exception 'El horario está fuera del rango operativo de la tinaja';
    end if;
    if v_recurso_id is null then
      select id into strict v_recurso_id from public.recursos_servicio where activo and nombre=
        case v_c.codigo when 'tinajaTonel' then 'Tinaja Tonel de Madera' else 'Tinaja Jacuzzi' end;
    end if;
    perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('tinaja_horario',v_recurso_id::text||':'||p_fecha::text));
    if exists(select 1 from public.servicios s where s.id<>v_s.id and s.fecha_servicio=p_fecha
       and s.estado_servicio not in ('cancelado','no_show')
       and (s.recurso_id=v_recurso_id or (s.recurso_id is null and s.catalogo_servicio_id=v_c.id))
       and s.hora_inicio<v_fin and s.hora_fin>p_hora) then
      raise exception 'La tinaja está ocupada en ese horario';
    end if;
  end if;
  if v_recurso_id is not null and not exists(select 1 from public.recursos_servicio where id=v_recurso_id and activo) then
    raise exception 'El recurso del servicio ya no está activo';
  end if;

  update public.servicios set fecha_servicio=p_fecha,hora_inicio=p_hora,hora_fin=v_fin,recurso_id=v_recurso_id
    where id=p_servicio_id;
  return jsonb_build_object('servicio_id',p_servicio_id,'fecha_servicio',p_fecha,'hora_inicio',p_hora,'hora_fin',v_fin);
end;
$$;
revoke all on function private.haiku_reprogramar_servicio_asistente_impl_v1(uuid,uuid,timestamptz,date,time) from public,anon,authenticated;
grant execute on function private.haiku_reprogramar_servicio_asistente_impl_v1(uuid,uuid,timestamptz,date,time) to authenticated;
create function public.haiku_reprogramar_servicio_asistente_v1(
  p_servicio_id uuid,p_estadia_id uuid,p_version timestamptz,p_fecha date,p_hora time
) returns jsonb language sql security invoker set search_path=pg_catalog,public,private
as $$ select private.haiku_reprogramar_servicio_asistente_impl_v1(p_servicio_id,p_estadia_id,p_version,p_fecha,p_hora); $$;
revoke all on function public.haiku_reprogramar_servicio_asistente_v1(uuid,uuid,timestamptz,date,time) from public,anon,authenticated;
grant execute on function public.haiku_reprogramar_servicio_asistente_v1(uuid,uuid,timestamptz,date,time) to authenticated;

create function private.haiku_pago_asistente_impl_v1(
  p_pago_id uuid,p_version timestamptz,p_accion text,p_datos jsonb,p_motivo text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare
  v_reserva uuid;
  v_pago public.pagos%rowtype;
  v_r public.reservas%rowtype;
  v_resultado jsonb;
  v_devolucion uuid;
  v_fecha timestamptz;
  v_medio text;
  v_comprobante text;
  v_glosa text;
  v_folio text;
  v_bovtar text;
  v_codaut text;
  v_monto bigint;
  v_saldo bigint;
  v_motivo text:=nullif(btrim(p_motivo),'');
begin
  if p_accion is null or p_accion not in ('corregir','anular','devolucion') or jsonb_typeof(p_datos) is distinct from 'object' then
    raise exception 'Indica una operación de pago válida';
  end if;
  perform private.haiku_autorizar_operacion_chat_v1(case p_accion when 'anular' then 'pagos.anular'
    when 'devolucion' then 'pagos.reembolsar' else 'pagos.registrar' end);
  if private.haiku_tiene_permiso('pagos.ver') is distinct from true then
    raise exception 'Tu cuenta necesita permiso para ver pagos' using errcode='42501';
  end if;
  if p_accion in ('anular','devolucion') and (v_motivo is null or length(v_motivo)>1000) then
    raise exception 'Indica el motivo del movimiento';
  end if;

  select reserva_id into v_reserva from public.pagos where id=p_pago_id;
  if v_reserva is null or p_version is null then raise exception 'El pago confirmado no está disponible'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_reserva::text,0));
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',v_reserva::text));
  select * into v_r from public.reservas where id=v_reserva for update;
  select * into v_pago from public.pagos where id=p_pago_id for update;
  if v_pago.actualizado_en is distinct from p_version or v_pago.reserva_id is distinct from v_reserva or
     v_pago.estado is distinct from 'confirmado' or v_pago.tipo_movimiento is distinct from 'pago' or v_pago.moneda<>'CLP' then
    raise exception 'El pago cambió. Vuelve a pedir la acción' using errcode='40001';
  end if;
  if v_pago.pago_grupo_id is not null or v_r.grupo_reserva_id is not null or exists (
    select 1 from public.pago_aplicaciones a join public.cargos c on c.id=a.cargo_id
    where a.pago_id=p_pago_id and c.reserva_id is distinct from v_reserva
  ) then raise exception 'El pago conjunto requiere revisar la distribución en Pagos'; end if;
  if exists (select 1 from public.pagos where pago_origen_id=p_pago_id and estado<>'anulado') then
    raise exception 'Este pago tiene una devolución registrada o en revisión';
  end if;
  if p_accion in ('anular','devolucion') or p_datos ? 'monto' then
    if nullif(btrim(v_r.bove_cierre),'') is not null or nullif(btrim(v_r.bove_checkout),'') is not null then
      raise exception 'La reserva tiene un BOVE emitido. Revisa el documento antes de cambiar el saldo';
    end if;
  end if;

  if p_accion='anular' then
    update public.pagos set estado='anulado',
      datos_origen=coalesce(datos_origen,'{}'::jsonb)||jsonb_build_object('anulado_por',auth.uid(),'anulado_en',now(),'motivo_anulacion',v_motivo)
      where id=p_pago_id;
    return jsonb_build_object('ok',true,'pago_id',p_pago_id);
  end if;

  if p_accion='devolucion' then
    v_fecha:=((p_datos->>'fecha_pago')::date + time '12:00') at time zone 'America/Santiago';
    v_medio:=p_datos->>'medio_pago';
    v_comprobante:=nullif(btrim(p_datos->>'comprobante'),'');
    if v_fecha is null or (v_fecha at time zone 'America/Santiago')::date not between
       (v_pago.fecha_pago at time zone 'America/Santiago')::date and (now() at time zone 'America/Santiago')::date or
       v_medio is null or v_comprobante is null or length(v_comprobante)>160 then
      raise exception 'Comprueba fecha, medio y comprobante de la devolución realizada';
    end if;
    if exists (select 1 from public.pago_aplicaciones a join public.cargos c on c.id=a.cargo_id
       where a.pago_id=p_pago_id and c.estado<>'activo') then
      raise exception 'El pago tiene aplicaciones históricas que requieren revisión contable';
    end if;
    insert into public.pagos(reserva_id,pago_origen_id,monto,moneda,tipo_movimiento,etapa_operativa,
      medio_pago,estado,fecha_pago,referencia_externa,observaciones,creado_por,verificado_por,verificado_en,datos_origen)
    values(v_reserva,p_pago_id,v_pago.monto,v_pago.moneda,'devolucion',v_pago.etapa_operativa,
      v_medio,'confirmado',v_fecha,v_comprobante,v_motivo,auth.uid(),auth.uid(),now(),
      jsonb_build_object('origen','haku','comprobante_devolucion',v_comprobante))
    returning id into v_devolucion;
    insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado)
      select v_devolucion,cargo_id,monto_aplicado from public.pago_aplicaciones where pago_id=p_pago_id;
    return jsonb_build_object('ok',true,'pago_id',p_pago_id,'devolucion_id',v_devolucion);
  end if;

  if p_datos='{}'::jsonb or (p_datos-array['monto','fecha_pago','medio_pago','folio','bove','codigo_autorizacion','referencia_externa'])<>'{}'::jsonb then
    raise exception 'Revisa los campos que quieres corregir';
  end if;
  v_monto:=coalesce((p_datos->>'monto')::bigint,v_pago.monto);
  v_fecha:=coalesce(((p_datos->>'fecha_pago')::date + time '12:00') at time zone 'America/Santiago',v_pago.fecha_pago);
  v_medio:=coalesce(p_datos->>'medio_pago',v_pago.medio_pago);
  v_glosa:=nullif(btrim(coalesce(p_datos->>'referencia_externa',v_pago.referencia_externa)),'');
  v_folio:=nullif(btrim(coalesce(p_datos->>'folio',v_pago.folio)),'');
  v_bovtar:=nullif(btrim(coalesce(p_datos->>'bove',v_pago.bove,v_pago.datos_origen->>'bovtar')),'');
  v_codaut:=nullif(btrim(coalesce(p_datos->>'codigo_autorizacion',v_pago.codigo_autorizacion)),'');
  if v_medio not in ('transferencia','webpay_credito','webpay_debito','tarjeta_credito','tarjeta_debito','efectivo','airbnb_prepaid_card') or
     (v_medio='transferencia' and v_glosa is null) or (v_medio like 'webpay_%' and v_codaut is null) or
     (v_medio like 'tarjeta_%' and (v_folio is null or v_bovtar is null)) or
     (p_datos ? 'referencia_externa' and v_medio not in ('transferencia','airbnb_prepaid_card')) or
     (p_datos ?| array['folio','bove'] and v_medio not like 'tarjeta_%') or
     (p_datos ? 'codigo_autorizacion' and v_medio not like 'tarjeta_%' and v_medio not like 'webpay_%') then
    raise exception 'Revisa el medio y los datos del comprobante';
  end if;
  if v_fecha is null or (v_fecha at time zone 'America/Santiago')::date>(now() at time zone 'America/Santiago')::date then
    raise exception 'Indica la fecha real del pago';
  end if;
  if (p_datos ? 'monto' or p_datos ? 'fecha_pago') then
    if private.haiku_tiene_permiso('pagos.anular') is distinct from true then
      raise exception 'Tu cuenta necesita permiso para reemplazar el abono' using errcode='42501';
    end if;
    if v_pago.etapa_operativa is distinct from 'abono' or exists(
      select 1 from public.pago_aplicaciones a join public.cargos c on c.id=a.cargo_id
      where a.pago_id=p_pago_id and (c.tipo_cargo<>'alojamiento' or c.estado<>'activo')
    ) then raise exception 'El abono requiere revisar sus aplicaciones antes de corregirlo'; end if;
    select saldo_alojamiento into v_saldo from public.vista_saldos_alojamiento_reserva where reserva_id=v_reserva;
    if v_saldo is null or v_monto<=0 or v_monto>v_saldo+v_pago.monto then
      raise exception 'El importe requiere revisar el saldo a favor en Pagos';
    end if;
    v_resultado:=public.haiku_corregir_abono(p_pago_id,v_monto,v_medio,v_fecha,
      case when v_medio like 'tarjeta_%' then v_folio end,
      case when v_medio like 'tarjeta_%' or v_medio like 'webpay_%' then v_codaut end,
      case when v_medio like 'tarjeta_%' then v_bovtar end,
      case when v_medio in ('transferencia','airbnb_prepaid_card') then v_glosa end,v_pago.observaciones);
  else
    v_resultado:=public.haiku_editar_pago_confirmado_saldo(p_pago_id,v_medio,v_glosa,v_folio,v_bovtar,v_codaut);
  end if;
  return jsonb_build_object('ok',true,'pago_id',p_pago_id,'resultado',v_resultado);
end;
$$;
revoke all on function private.haiku_pago_asistente_impl_v1(uuid,timestamptz,text,jsonb,text) from public,anon,authenticated;
grant execute on function private.haiku_pago_asistente_impl_v1(uuid,timestamptz,text,jsonb,text) to authenticated;
create function public.haiku_pago_asistente_v1(
  p_pago_id uuid,p_version timestamptz,p_accion text,p_datos jsonb,p_motivo text
) returns jsonb language sql security invoker set search_path=pg_catalog,public,private
as $$ select private.haiku_pago_asistente_impl_v1(p_pago_id,p_version,p_accion,p_datos,p_motivo); $$;
revoke all on function public.haiku_pago_asistente_v1(uuid,timestamptz,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.haiku_pago_asistente_v1(uuid,timestamptz,text,jsonb,text) to authenticated;

create function private.haiku_guardar_bove_asistente_impl_v1(
  p_reserva_id uuid,p_version timestamptz,p_estadias jsonb,p_tipo text,p_bove text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare
  v_r public.reservas%rowtype;
  v_estadias jsonb;
  v_total bigint;
begin
  perform private.haiku_autorizar_operacion_chat_v1('pagos.verificar');
  if p_tipo is null or p_tipo not in ('alojamiento','servicios') or p_bove is null or p_bove !~ '^[0-9]{1,30}$' then
    raise exception 'Indica un número BOVE y su alcance';
  end if;
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_reserva_id::text));
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('bove',p_bove));
  select * into v_r from public.reservas where id=p_reserva_id for update;
  if not found or v_r.actualizado_en is distinct from p_version or v_r.estado_reserva in ('cancelada','no_show') then
    raise exception 'La reserva cambió. Revalida el BOVE' using errcode='40001';
  end if;
  if v_r.grupo_reserva_id is not null then
    raise exception 'Registra el BOVE conjunto desde Pagos por titular';
  end if;
  select jsonb_agg(jsonb_build_object('id',e.id,'cabana_numero',c.numero,'fecha_ingreso',e.fecha_ingreso,
    'fecha_salida',e.fecha_salida,'tipo_estadia',e.tipo_estadia,'estado_estadia',e.estado_estadia) order by e.id)
    into v_estadias from public.reserva_estadias e join public.cabanas c on c.id=e.cabana_id where e.reserva_id=p_reserva_id;
  if v_estadias is null or v_estadias is distinct from p_estadias then
    raise exception 'La estadía cambió. Revalida el BOVE' using errcode='40001';
  end if;
  if exists(select 1 from public.reservas where id<>p_reserva_id and
    (btrim(bove_cierre)=p_bove or btrim(bove_checkout)=p_bove)) then
    raise exception 'Este BOVE ya está asociado a otra reserva';
  end if;
  if p_tipo='servicios' then
    if nullif(btrim(v_r.bove_checkout),'') is not null then raise exception 'Los servicios ya tienen BOVE'; end if;
    return public.haiku_registrar_bove_checkout(p_reserva_id,p_bove);
  end if;
  if nullif(btrim(v_r.bove_cierre),'') is not null then raise exception 'El alojamiento ya tiene BOVE'; end if;
  select total_alojamiento into v_total from public.vista_saldos_alojamiento_reserva where reserva_id=p_reserva_id;
  if coalesce(v_total,0)<=0 then raise exception 'No se acredita un total positivo de alojamiento'; end if;
  return public.haiku_registrar_bove_reserva(p_reserva_id,p_bove);
end;
$$;
revoke all on function private.haiku_guardar_bove_asistente_impl_v1(uuid,timestamptz,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.haiku_guardar_bove_asistente_impl_v1(uuid,timestamptz,jsonb,text,text) to authenticated;
create function public.haiku_guardar_bove_asistente_v1(
  p_reserva_id uuid,p_version timestamptz,p_estadias jsonb,p_tipo text,p_bove text
) returns jsonb language sql security invoker set search_path=pg_catalog,public,private
as $$ select private.haiku_guardar_bove_asistente_impl_v1(p_reserva_id,p_version,p_estadias,p_tipo,p_bove); $$;
revoke all on function public.haiku_guardar_bove_asistente_v1(uuid,timestamptz,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.haiku_guardar_bove_asistente_v1(uuid,timestamptz,jsonb,text,text) to authenticated;

commit;
