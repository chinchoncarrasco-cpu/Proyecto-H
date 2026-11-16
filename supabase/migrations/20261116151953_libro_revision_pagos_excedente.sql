-- Candidato local: no ejecutar en producción sin revisión y autorización.
-- Extiende el escritor idempotente 4C; conserva sus locks, permisos y guardas.
create or replace function private.haiku_libro_pago_alojamiento_verificado_v1(
 p_reserva_id uuid,p_argumentos jsonb,p_origen jsonb,p_manual boolean)
returns jsonb language plpgsql set search_path=pg_catalog,public,private as $fn$
declare
 d jsonb:=p_origen->'destino_alojamiento_libro_v1';
 c record; existente public.pagos%rowtype; n integer; aplicado bigint;
 monto bigint:=(p_argumentos->>'p_monto')::bigint;
 v_folio text:=regexp_replace(upper(coalesce(p_argumentos->>'p_folio','')),'[^0-9A-Z]','','g');
 v_bovtar text:=regexp_replace(upper(coalesce(p_origen->>'bovtar','')),'[^0-9A-Z]','','g');
 v_codaut text:=regexp_replace(upper(coalesce(p_argumentos->>'p_codigo_autorizacion','')),'[^0-9A-Z]','','g');
 v_token text;
 v_transferencia boolean:=p_argumentos->>'p_medio_pago'='transferencia';
 v_pago_bancario uuid;
begin
 if auth.uid() is null or not private.haiku_tiene_permiso('pagos.registrar') then
  raise exception 'Sin permiso para registrar pagos' using errcode='42501';
 end if;
 if p_manual is distinct from true or d->>'version' is distinct from '1' or monto<=0
  or p_origen->>'source_kind' is distinct from 'libro_reserva'
  or p_origen->>'reserva_id' is distinct from p_reserva_id::text
  or nullif(p_origen->'origen'->>'hoja','') is null or nullif(p_origen->'origen'->>'celda','') is null
  or nullif(p_origen->>'source_fingerprint','') is null or nullif(p_origen->>'item_id','') is null
  or p_origen->>'moneda' is distinct from 'CLP' or p_origen->>'monto' is distinct from monto::text
  or p_origen->>'fecha' is distinct from p_argumentos->>'p_fecha_pago'
  or p_origen ? 'aplicaciones_servicio_v1' or p_origen ? 'excedente_servicio_libro_v1'
  or coalesce(p_origen->>'tipo_movimiento','') not in ('penalidad','alojamiento')
  or coalesce(p_argumentos->>'p_medio_pago','') not in ('tarjeta_credito','tarjeta_debito','webpay_credito','webpay_debito','transferencia')
  or (not v_transferencia and (v_folio='' or v_bovtar='' or regexp_replace(upper(coalesce(p_argumentos->>'p_bove','')),'[^0-9A-Z]','','g')<>v_bovtar)) then
  raise exception 'Comprobante de alojamiento incompleto o sin aprobación explícita';
 end if;
 if v_transferencia then
  -- Mismo orden del escritor bancario vigente: tabla de pagos, validación global
  -- y después finanzas de la reserva. No usa el remitente como ID de transacción.
  lock table public.pagos in share row exclusive mode;
  v_pago_bancario:=private.haiku_libro_transferencia_validar_v2(p_reserva_id,p_argumentos,p_origen,p_manual);
 end if;
 perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_reserva_id::text));
 for v_token in select token from unnest(array[case when v_codaut<>'' then 'codaut:'||v_codaut end,case when v_folio<>'' and v_bovtar<>'' then 'voucher:'||v_folio||':'||v_bovtar end]) t(token) where token is not null order by token loop
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('pago_identificador',v_token));
 end loop;
 perform 1 from public.reservas where id=p_reserva_id and estado_reserva not in ('cancelada','no_show') for update;
 if not found then raise exception 'La reserva destino cambió; vuelve a preparar'; end if;
 if v_transferencia then
  n:=case when v_pago_bancario is null then 0 else 1 end;
 else
 select count(*) into n from public.pagos p where p.estado='confirmado' and p.tipo_movimiento='pago'
  and ((regexp_replace(upper(coalesce(p.folio,'')),'[^0-9A-Z]','','g')=v_folio
  and regexp_replace(upper(coalesce(p.datos_origen->>'bovtar',p.bove,'')),'[^0-9A-Z]','','g')=v_bovtar)
  or v_codaut<>'' and regexp_replace(upper(coalesce(p.codigo_autorizacion,'')),'[^0-9A-Z]','','g')=v_codaut);
 end if;
 if n>0 then
  if v_transferencia then select * into existente from public.pagos where id=v_pago_bancario;
  else
  select * into existente from public.pagos p where p.estado='confirmado' and p.tipo_movimiento='pago'
   and ((regexp_replace(upper(coalesce(p.folio,'')),'[^0-9A-Z]','','g')=v_folio
   and regexp_replace(upper(coalesce(p.datos_origen->>'bovtar',p.bove,'')),'[^0-9A-Z]','','g')=v_bovtar)
   or v_codaut<>'' and regexp_replace(upper(coalesce(p.codigo_autorizacion,'')),'[^0-9A-Z]','','g')=v_codaut);
  end if;
  if n<>1 or existente.reserva_id is distinct from p_reserva_id or existente.monto is distinct from monto
   or existente.moneda is distinct from 'CLP' or existente.medio_pago is distinct from p_argumentos->>'p_medio_pago'
   or existente.fecha_pago::date is distinct from (p_argumentos->>'p_fecha_pago')::date then
   raise exception 'El comprobante ya existe con datos diferentes; requiere revisión';
  end if;
  select coalesce(sum(a.monto_aplicado),0) into aplicado from public.pago_aplicaciones a where a.pago_id=existente.id;
  return jsonb_build_object('ya_existe',true,'pago_id',existente.id,'monto',monto,'aplicado',aplicado,'sin_aplicar',monto-aplicado);
 end if;
 perform 1 from public.cargos where reserva_id=p_reserva_id order by id for update;
 select count(*) into n from public.cargos where reserva_id=p_reserva_id and tipo_cargo='alojamiento' and estado='activo';
 select ec.* into c from public.vista_estado_cargos ec join public.cargos x on x.id=ec.cargo_id
  join public.reserva_estadias e on e.id=x.estadia_id and e.reserva_id=x.reserva_id
  join public.cabanas cab on cab.id=e.cabana_id
  where ec.cargo_id=(d->>'cargo_id')::uuid and ec.reserva_id=p_reserva_id and ec.tipo_cargo='alojamiento' and ec.estado='activo'
   and x.estadia_id=(d->>'estadia_id')::uuid and e.fecha_ingreso=(p_origen->>'fecha_bloque')::date
   and cab.numero=(p_origen->>'cabana')::integer and e.estado_estadia not in ('cancelada','no_show');
 if n<>1 or not found or c.saldo_cargo is distinct from (d->>'saldo_esperado')::bigint
  or c.monto_ajustado is distinct from (d->>'monto_ajustado')::bigint
  or c.aplicado_neto is distinct from (d->>'aplicado_esperado')::bigint or c.saldo_cargo<monto then
  raise exception 'El destino, saldo o aplicaciones del alojamiento cambiaron; vuelve a preparar';
 end if;
 return public.haiku_registrar_pago(p_reserva_id=>p_reserva_id,p_monto=>monto,p_medio_pago=>p_argumentos->>'p_medio_pago',
  p_etapa_operativa=>'abono',p_fecha_pago=>(p_argumentos->>'p_fecha_pago')::timestamptz,
  p_folio=>p_argumentos->>'p_folio',p_codigo_autorizacion=>p_argumentos->>'p_codigo_autorizacion',p_bove=>p_argumentos->>'p_bove',
  p_referencia_externa=>p_argumentos->>'p_referencia_externa',p_observaciones=>p_argumentos->>'p_observaciones',
  p_aplicaciones=>jsonb_build_array(jsonb_build_object('cargo_id',c.cargo_id,'monto',monto)),p_modo_aplicacion=>'ninguno');
end;
$fn$;
revoke all on function private.haiku_libro_pago_alojamiento_verificado_v1(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;

do $patch$
declare src text; anterior text; firma regprocedure:='private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean)'::regprocedure;
begin
 src:=pg_get_functiondef(firma); anterior:=src;
 if to_regprocedure('private.haiku_libro_transferencia_validar_v2(uuid,jsonb,jsonb,boolean)') is null then
  raise exception 'Falta la validación bancaria existente; no instalar esta extensión';
 end if;
 if position('  suma bigint := 0;' in src)=0 or position('  if suma is distinct from monto_total then' in src)=0
  or position('  if (pago->>''aplicado'')::bigint is distinct from monto_total' in src)=0 then
  raise exception 'Escritor 4C incompatible: revisar manualmente antes de instalar';
 end if;
 src:=replace(src,'  suma bigint := 0;','  suma bigint := 0; v_excedente bigint := 0;');
 src:=replace(src,'  if auth.uid()',E'  if p_origen ? ''destino_alojamiento_libro_v1'' then\n    return private.haiku_libro_pago_alojamiento_verificado_v1(p_reserva_id,p_argumentos,p_origen,p_manual);\n  end if;\n  if auth.uid()');
 src:=replace(src,'  if suma is distinct from monto_total then',$new$
  if p_origen ? 'excedente_servicio_libro_v1' then
    v_excedente:=(p_origen->'excedente_servicio_libro_v1'->>'monto_sin_aplicar')::bigint;
    if v_excedente is null or v_excedente<=0 or p_manual is distinct from true
      or p_origen->'excedente_servicio_libro_v1'->>'version' is distinct from '1'
      or p_origen->'excedente_servicio_libro_v1'->>'confirmado' is distinct from 'true'
      or (d->>'monto_sin_aplicar')::bigint is distinct from v_excedente
      or jsonb_array_length(aplicaciones_esperadas)<>1
      or not exists(select 1 from public.cargos x join public.servicios s on s.id=x.servicio_id
        join public.reserva_estadias e on e.id=x.estadia_id and e.reserva_id=x.reserva_id
        join public.cabanas cab on cab.id=e.cabana_id
        where x.id=(aplicaciones_esperadas->0->>'cargo_id')::uuid and x.reserva_id=p_reserva_id
         and s.estadia_id=e.id and s.reserva_id=p_reserva_id and e.fecha_ingreso=(p_origen->>'fecha_bloque')::date
         and cab.numero=(p_origen->>'cabana')::integer and e.estado_estadia not in ('cancelada','no_show'))
      or (aplicaciones_esperadas->0->>'monto')::bigint is distinct from (aplicaciones_esperadas->0->>'saldo_esperado')::bigint
      or (codaut_norm is null and (folio_norm is null or bovtar_norm is null)) then
      raise exception 'Excedente sin aprobación explícita o destino único verificable';
    end if;
  end if;
  if suma+v_excedente is distinct from monto_total then$new$);
 src:=replace(src,'    return jsonb_build_object(''ya_existe'',true,','    if p_origen ? ''excedente_servicio_libro_v1'' and exists(select 1 from public.pagos p where p.id=pago_existente and (p.monto is distinct from monto_total or p.medio_pago is distinct from p_argumentos->>''p_medio_pago'' or p.fecha_pago::date is distinct from (p_argumentos->>''p_fecha_pago'')::date)) then raise exception ''El comprobante ya existe con datos diferentes; requiere revisión''; end if; return jsonb_build_object(''ya_existe'',true,');
 src:=replace(src,$a$  if (pago->>'aplicado')::bigint is distinct from monto_total$a$, $a$  if (pago->>'aplicado')::bigint is distinct from suma$a$);
 src:=replace(src,$a$     or (pago->>'sin_aplicar')::bigint is distinct from 0 then$a$, $a$     or (pago->>'sin_aplicar')::bigint is distinct from v_excedente then$a$);
 if src=anterior or position('return private.haiku_libro_pago_alojamiento_verificado_v1' in src)=0 then
  raise exception 'No fue posible extender el escritor 4C con seguridad';
 end if;
 execute src;
 src:=pg_get_functiondef('public.haiku_incorporar_pago_servicios_libro_v1(uuid,jsonb)'::regprocedure);
 if position($a$'aplicaciones_servicio_v1',v_origen->'aplicaciones_servicio_v1',$a$ in src)=0 then
  raise exception 'Auditoría 4C incompatible';
 end if;
 src:=replace(src,$a$'aplicaciones_servicio_v1',v_origen->'aplicaciones_servicio_v1',$a$,
  $a$'aplicaciones_servicio_v1',v_origen->'aplicaciones_servicio_v1','excedente_servicio_libro_v1',v_origen->'excedente_servicio_libro_v1','destino_alojamiento_libro_v1',v_origen->'destino_alojamiento_libro_v1','pagador',v_origen->'pagador','evidencia_transferencia',v_origen->'evidencia_transferencia','source_fingerprint',v_origen->'source_fingerprint','source_kind',v_origen->'source_kind',$a$);
 execute src;
 src:=pg_get_functiondef('public.haiku_libro_aplicaciones_servicio_capacidad_v1()'::regprocedure);
 if position($a$'version',1,$a$ in src)=0 then raise exception 'Capacidad 4C incompatible'; end if;
 execute replace(src,$a$'version',1,$a$,$a$'version',1,'excedente_servicio_libro_v1',true,'destino_alojamiento_libro_v1',true,'precio_cargo_libro_v1',true,$a$);
end;
$patch$;

-- Un precio final autorizado se registra como ajuste de UN cargo. Nunca cambia
-- el catálogo, el servicio original ni el comprobante. La referencia no es el pago.
create or replace function public.haiku_libro_ajustar_precio_cargo_v1(p_operacion_id uuid,p_propuesta jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $fn$
declare
 u uuid:=auth.uid(); h text:=md5(jsonb_build_array('precio_cargo_libro_v1',p_propuesta)::text);
 op private.haiku_libro_pagos_servicio_operaciones%rowtype; c record;
 r uuid:=(p_propuesta->>'reserva_id')::uuid; delta bigint;
 final bigint:=(p_propuesta->>'precio_final')::bigint; v_resultado jsonb;
begin
 if u is null or not private.haiku_tiene_permiso('pagos.registrar') then
  raise exception 'Sin permiso para ajustar cargos' using errcode='42501';
 end if;
 if p_operacion_id is null or p_propuesta->>'confirmado' is distinct from 'true'
  or length(btrim(coalesce(p_propuesta->>'motivo','')))<8
  or length(btrim(coalesce(p_propuesta->>'autorizacion','')))<8
  or p_propuesta->>'autorizacion' = p_propuesta->>'comprobante'
  or nullif(p_propuesta->'origen'->>'hoja','') is null or nullif(p_propuesta->'origen'->>'celda','') is null
  or nullif(p_propuesta->>'version_libro','') is null or final is null or final<=0 then
  raise exception 'Falta confirmar motivo y evidencia independiente del precio final autorizado';
 end if;
 insert into private.haiku_libro_pagos_servicio_operaciones(operacion_id,usuario_id,solicitud_hash)
 values(p_operacion_id,u,h) on conflict do nothing;
 select * into op from private.haiku_libro_pagos_servicio_operaciones where operacion_id=p_operacion_id for update;
 if op.usuario_id is distinct from u or op.solicitud_hash is distinct from h then
  raise exception 'Operación de ajuste usada con otros datos o usuario';
 end if;
 if op.resultado is not null then return op.resultado||jsonb_build_object('reintento',true); end if;
 perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',r::text));
 perform 1 from public.reservas where id=r and estado_reserva not in ('cancelada','no_show') for update;
 if not found then raise exception 'La reserva cambió; vuelve a revisar'; end if;
 perform 1 from public.cargos where id=(p_propuesta->>'cargo_id')::uuid and reserva_id=r for update;
 select ec.* into c from public.vista_estado_cargos ec join public.cargos x on x.id=ec.cargo_id
 join public.servicios s on s.id=x.servicio_id
 join public.reserva_estadias e on e.id=x.estadia_id and e.reserva_id=x.reserva_id
 join public.cabanas cab on cab.id=e.cabana_id
 where ec.cargo_id=(p_propuesta->>'cargo_id')::uuid and ec.reserva_id=r and ec.estado='activo' and ec.tipo_cargo='servicio'
  and s.id=(p_propuesta->>'servicio_id')::uuid and s.estadia_id=e.id and s.reserva_id=r
  and s.fecha_servicio=(p_propuesta->>'fecha_servicio')::date and s.hora_inicio::text is not distinct from p_propuesta->>'hora_inicio'
  and cab.numero=(p_propuesta->>'cabana')::integer
  and e.id=(p_propuesta->>'estadia_id')::uuid and e.fecha_ingreso=(p_propuesta->>'ingreso')::date
  and e.fecha_salida=(p_propuesta->>'salida')::date and e.estado_estadia not in ('cancelada','no_show')
  and coalesce(s.tipo_cobro,'normal')<>'cortesia' and s.total>0
  and coalesce(s.estado_servicio,'') !~* '(cancelad|noshow|anulad)';
 if not found or c.monto_ajustado is distinct from (p_propuesta->>'monto_ajustado')::bigint
  or c.saldo_cargo is distinct from (p_propuesta->>'saldo_esperado')::bigint or c.aplicado_neto<>0
  or exists(select 1 from public.pago_aplicaciones a join public.pagos p on p.id=a.pago_id where a.cargo_id=c.cargo_id and p.estado='confirmado') then
  raise exception 'El cargo o sus aplicaciones cambiaron; requiere nueva revisión';
 end if;
 delta:=final-c.monto_ajustado;
 if delta<=0 or c.monto_ajustado<=0 or final>c.monto_ajustado*10 then raise exception 'Diferencia de precio inválida'; end if;
 insert into public.cargo_ajustes(operacion_id,reserva_id,cargo_id,tipo_ajuste,signo,porcentaje,base_calculo,monto,concepto,observaciones,creado_por)
 values(p_operacion_id,r,c.cargo_id,'cargo_modificacion',1,round(delta*100.0/c.monto_ajustado,2),c.monto_ajustado,delta,
  'Precio final autorizado del servicio · Libro',p_propuesta->>'motivo'||E'\nAutorización independiente: '||(p_propuesta->>'autorizacion')||E'\nEvidencia Libro: '||p_propuesta::text,u);
 v_resultado:=jsonb_build_object('ok',true,'cargo_id',c.cargo_id,'ajuste',delta,'precio_final',final);
 update private.haiku_libro_pagos_servicio_operaciones set resultado=v_resultado,completado_en=now() where operacion_id=p_operacion_id;
 return v_resultado;
end;
$fn$;
revoke all on function public.haiku_libro_ajustar_precio_cargo_v1(uuid,jsonb) from public,anon;
grant execute on function public.haiku_libro_ajustar_precio_cargo_v1(uuid,jsonb) to authenticated;
