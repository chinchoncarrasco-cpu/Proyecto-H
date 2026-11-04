begin;
do $$
declare u record; d record; chosen_day date; operator_id uuid; target record; r public.revisiones_checkout; denied boolean;
begin
  perform set_config('request.jwt.claim.sub','',true);
  denied:=false;
  begin perform public.haiku_revisiones_checkout_dia_v1(current_date); exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Una sesión anónima no puede leer salidas';
  for u in select id from public.usuarios where activo loop
    perform set_config('request.jwt.claim.sub',u.id::text,true);
    if private.haiku_tiene_permiso('revisiones.gestionar') and private.haiku_tiene_permiso('revisiones.ver') then operator_id:=u.id; exit; end if;
  end loop;
  assert operator_id is not null, 'Falta un operador para comprobar los permisos';
  for d in select distinct fecha_salida from public.reserva_estadias where fecha_salida is not null order by fecha_salida desc limit 120 loop
    select * into target from public.haiku_operacion_dia(d.fecha_salida) where salida_estadia_id is not null limit 1;
    if found then chosen_day:=d.fecha_salida; exit; end if;
  end loop;
  assert chosen_day is not null, 'Falta una salida existente para comprobar su identidad';
  execute 'set local role authenticated';
  assert (public.haiku_revisiones_checkout_dia_v1(chosen_day)->>'puede_editar')::boolean, 'El operador no conserva su permiso';
  r:=public.haiku_guardar_revision_checkout_v1(chosen_day,target.cabana_id,target.salida_estadia_id,'hora_out','"12:34"'::jsonb);
  r:=public.haiku_guardar_revision_checkout_v1(chosen_day,target.cabana_id,target.salida_estadia_id,'encargado','"QA de salida, rollback"'::jsonb);
  r:=public.haiku_guardar_revision_checkout_v1(chosen_day,target.cabana_id,target.salida_estadia_id,'recuperado','{"id":"juegos_mesa","checked":true}'::jsonb);
  r:=public.haiku_guardar_revision_checkout_v1(chosen_day,target.cabana_id,target.salida_estadia_id,'chequeado','{"id":"ventanas","checked":true}'::jsonb);
  assert r.hora_out=time '12:34' and r.hora_out_definida, 'Otro campo borró la hora';
  assert r.encargado='QA de salida, rollback' and r.recuperados @> array['juegos_mesa'] and r.chequeados @> array['ventanas'], 'Los parches deben conservar los demás campos';
  assert r.revision>=5 and r.actualizado_por=operator_id, 'La versión y autoría deben avanzar en el servidor';
  denied:=false;
  begin perform public.haiku_guardar_revision_checkout_v1(chosen_day,target.cabana_id,target.salida_estadia_id,'hora_out','"25:00"'::jsonb); exception when invalid_parameter_value then denied:=true; end;
  assert denied, 'Una hora inválida no debe guardarse';
  denied:=false;
  begin perform public.haiku_guardar_revision_checkout_v1(chosen_day+1,target.cabana_id,target.salida_estadia_id,'encargado','"Otra fecha"'::jsonb); exception when serialization_failure then denied:=true; end;
  assert denied, 'La fecha no debe cruzarse con otra salida';
  denied:=false;
  begin perform public.haiku_guardar_revision_checkout_v1(chosen_day,'00000000-0000-0000-0000-000000000000',target.salida_estadia_id,'encargado','"Otra cabaña"'::jsonb); exception when serialization_failure then denied:=true; end;
  assert denied, 'Una cabaña distinta no debe recibir esta revisión';
  r:=public.haiku_guardar_revision_checkout_v1(chosen_day,target.cabana_id,target.salida_estadia_id,'hora_out','""'::jsonb);
  assert r.hora_out is null and r.hora_out_definida, 'Vaciar OUT debe ser explícito';
end $$;
rollback;
select 'checkout: permisos, identidad, parches, versión, fecha y validación OK; sin cambios persistidos' as resultado;
