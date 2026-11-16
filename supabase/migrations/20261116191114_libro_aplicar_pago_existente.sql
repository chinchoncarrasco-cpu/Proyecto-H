-- Aplicación manual de un pago YA registrado: nunca crea, sustituye ni edita pagos.
-- Reutiliza el ledger, sus validadores/locks y el registro privado de idempotencia.
create or replace function public.haiku_libro_aplicar_pago_existente_v1(p_operacion_id uuid,p_propuesta jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $fn$
declare
 u uuid:=auth.uid(); h text:=md5(jsonb_build_array('aplicar_pago_existente_v1',p_propuesta)::text);
 op private.haiku_libro_pagos_servicio_operaciones%rowtype;
 r uuid:=(p_propuesta->>'reserva_id')::uuid; e uuid:=(p_propuesta->>'estadia_id')::uuid;
 pago public.pagos%rowtype; c record; identidad jsonb; candidatos jsonb;
 v_pago_id uuid:=(p_propuesta->>'pago_id')::uuid; v_cargo_id uuid:=(p_propuesta->>'cargo_id')::uuid;
 monto bigint:=(p_propuesta->>'monto_aplicar')::bigint;
 devuelto bigint; aplicado bigint; disponible bigint; previo bigint; objetivo bigint; saldo bigint; restante bigint;
 v_resultado jsonb; repetido boolean:=false;
begin
 if u is null or not private.haiku_tiene_permiso('pagos.registrar') then
  raise exception 'Sin permiso para aplicar pagos' using errcode='42501';
 end if;
 if coalesce(p_operacion_id is null or r is null or e is null or v_pago_id is null or v_cargo_id is null
  or monto<=0 or p_propuesta->>'confirmado' is distinct from 'true'
  or jsonb_typeof(p_propuesta->'pago_esperado') is distinct from 'object'
  or jsonb_typeof(p_propuesta->'candidatos_esperados') is distinct from 'array'
  or nullif(btrim(p_propuesta->>'version_libro'),'') is null
  or nullif(p_propuesta->'origen_libro'->>'hoja','') is null or nullif(p_propuesta->'origen_libro'->>'celda','') is null,true) then
  raise exception 'Aplicación incompleta o sin confirmación explícita';
 end if;
 insert into private.haiku_libro_pagos_servicio_operaciones(operacion_id,usuario_id,solicitud_hash)
 values(p_operacion_id,u,h) on conflict do nothing;
 select * into op from private.haiku_libro_pagos_servicio_operaciones where operacion_id=p_operacion_id for update;
 if op.usuario_id is distinct from u or op.solicitud_hash is distinct from h then
  raise exception 'La operación ya pertenece a otro usuario o propuesta';
 end if;
 if op.resultado is not null then return op.resultado||jsonb_build_object('reintento',true); end if;

 perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',r::text));
 perform 1 from public.reservas where id=r and estado_reserva not in ('cancelada','no_show') for update;
 if not found then raise exception 'La reserva cambió; vuelve a comparar'; end if;
 perform 1 from public.reserva_estadias re join public.cabanas cab on cab.id=re.cabana_id
 where re.id=e and re.reserva_id=r and re.fecha_ingreso=(p_propuesta->>'ingreso')::date
  and re.fecha_salida=(p_propuesta->>'salida')::date and cab.numero=(p_propuesta->>'cabana')::integer
  and re.estado_estadia not in ('cancelada','no_show') for share of re;
 if not found then raise exception 'La reserva reprogramada, cabaña o fechas cambiaron; vuelve a comparar'; end if;
 -- Orden compatible con el escritor financiero: reserva, cargos, aplicaciones, pagos.
 perform 1 from public.cargos where reserva_id=r order by id for update;
 perform 1 from public.pago_aplicaciones pa join public.cargos x on x.id=pa.cargo_id
 where x.reserva_id=r order by pa.id for update of pa;
 perform 1 from public.pagos p where p.id=v_pago_id or p.pago_origen_id=v_pago_id order by p.id for update;
 select * into pago from public.pagos p where p.id=v_pago_id;
 if not found or pago.reserva_id is distinct from r or pago.estado is distinct from 'confirmado'
  or pago.tipo_movimiento is distinct from 'pago' or pago.moneda is distinct from 'CLP' then
  raise exception 'El pago original no pertenece a esta reserva o dejó de estar confirmado';
 end if;
 identidad:=jsonb_build_object('id',pago.id,'reserva_id',pago.reserva_id,'monto',pago.monto,'moneda',pago.moneda,
  'estado',pago.estado,'tipo_movimiento',pago.tipo_movimiento,'medio_pago',pago.medio_pago,'folio',pago.folio,
  'codigo_autorizacion',pago.codigo_autorizacion,'bove',pago.bove,'datos_origen',pago.datos_origen);
 if identidad is distinct from p_propuesta->'pago_esperado'
  or pago.fecha_pago is distinct from (p_propuesta->>'fecha_pago_esperada')::timestamptz then
  raise exception 'La identidad o trazabilidad del pago cambió; vuelve a comparar';
 end if;
 select ec.* into c from public.vista_estado_cargos ec
 where ec.cargo_id=v_cargo_id and ec.reserva_id=r and ec.estadia_id=e and ec.tipo_cargo='alojamiento' and ec.estado='activo';
 if not found then raise exception 'El destino ya no es un cargo de alojamiento de esta estadía'; end if;
 select coalesce(sum(p.monto),0) into devuelto from public.pagos p
 where p.pago_origen_id=v_pago_id and p.tipo_movimiento='devolucion' and p.estado='confirmado';
 select coalesce(sum(case when p.id=v_pago_id then pa.monto_aplicado else -pa.monto_aplicado end),0)
 into aplicado from public.pago_aplicaciones pa join public.pagos p on p.id=pa.pago_id
 where p.estado='confirmado' and (p.id=v_pago_id or p.pago_origen_id=v_pago_id and p.tipo_movimiento='devolucion');
 disponible:=pago.monto-devuelto-aplicado;
 select coalesce(sum(pa.monto_aplicado),0) into previo from public.pago_aplicaciones pa where pa.pago_id=v_pago_id and pa.cargo_id=v_cargo_id;
 objetivo:=(p_propuesta->>'aplicacion_previa_esperada')::bigint+monto;
 -- Un reenvío con otro UUID también reconoce un objetivo ya satisfecho; no suma otra vez.
 repetido:=previo=objetivo and disponible=(p_propuesta->>'disponible_esperado')::bigint-monto
  and c.saldo_cargo=(p_propuesta->>'saldo_cargo_esperado')::bigint-monto
  and c.monto_ajustado=(p_propuesta->>'monto_ajustado_esperado')::bigint
  and c.aplicado_neto=(p_propuesta->>'aplicado_cargo_esperado')::bigint+monto
  and devuelto=(p_propuesta->>'devuelto_esperado')::bigint
  and aplicado=(p_propuesta->>'aplicado_pago_esperado')::bigint+monto;
 if repetido is not true then
  select coalesce(jsonb_agg(ec.cargo_id order by ec.cargo_id),'[]'::jsonb) into candidatos
  from public.vista_estado_cargos ec where ec.reserva_id=r and ec.estadia_id=e
   and ec.tipo_cargo='alojamiento' and ec.estado='activo' and ec.saldo_cargo>0;
  if candidatos is distinct from p_propuesta->'candidatos_esperados'
   or c.saldo_cargo is distinct from (p_propuesta->>'saldo_cargo_esperado')::bigint
   or c.monto_ajustado is distinct from (p_propuesta->>'monto_ajustado_esperado')::bigint
   or c.aplicado_neto is distinct from (p_propuesta->>'aplicado_cargo_esperado')::bigint
   or disponible is distinct from (p_propuesta->>'disponible_esperado')::bigint
   or aplicado is distinct from (p_propuesta->>'aplicado_pago_esperado')::bigint
   or devuelto is distinct from (p_propuesta->>'devuelto_esperado')::bigint
   or previo is distinct from (p_propuesta->>'aplicacion_previa_esperada')::bigint then
   raise exception 'El destino, saldo o monto disponible del pago cambió; vuelve a revisar';
  end if;
  if monto>disponible or monto>c.saldo_cargo or objetivo is null or objetivo<=0 then
   raise exception 'La aplicación supera el pago disponible o el saldo del alojamiento';
  end if;
  insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values(v_pago_id,v_cargo_id,objetivo)
  on conflict (pago_id,cargo_id) do update set monto_aplicado=excluded.monto_aplicado;
  select saldo_cargo into saldo from public.vista_estado_cargos ec where ec.cargo_id=v_cargo_id;
  restante:=disponible-monto;
  if saldo is distinct from c.saldo_cargo-monto then raise exception 'No se confirmó el saldo esperado; se revierte la aplicación'; end if;
 else saldo:=c.saldo_cargo;restante:=disponible; end if;
 v_resultado:=jsonb_build_object('ok',true,'pago_id',v_pago_id,'cargo_id',v_cargo_id,'estadia_id',e,'reserva_id',r,
  'monto_aplicado',case when repetido then 0 else monto end,'aplicado_total_cargo',objetivo,
  'sin_aplicar',restante,'saldo_cargo',saldo,'ya_aplicado',repetido,'version_libro',p_propuesta->>'version_libro',
  'origen_libro',p_propuesta->'origen_libro','operacion_id',p_operacion_id);
 update private.haiku_libro_pagos_servicio_operaciones set resultado=v_resultado,completado_en=now() where operacion_id=p_operacion_id;
 return v_resultado;
end;
$fn$;
revoke all on function public.haiku_libro_aplicar_pago_existente_v1(uuid,jsonb) from public,anon;
grant execute on function public.haiku_libro_aplicar_pago_existente_v1(uuid,jsonb) to authenticated;

do $cap$
declare src text;
begin
 src:=pg_get_functiondef('public.haiku_libro_aplicaciones_servicio_capacidad_v1()'::regprocedure);
 if position($a$'version',1,$a$ in src)=0 then raise exception 'Capacidad del Libro incompatible'; end if;
 execute replace(src,$a$'version',1,$a$,$a$'version',1,'aplicar_pago_existente_v1',true,$a$);
end;
$cap$;
