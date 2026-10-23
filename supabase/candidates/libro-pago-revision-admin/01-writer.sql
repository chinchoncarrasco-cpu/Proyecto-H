-- Candidata: no modifica pagos, reservas ni servicios existentes.
-- Ejecutar completa: se detiene si difiere alguna definición auditada.
begin;
set local lock_timeout='5s';
do $guard$
declare firma text; esperado text; actual text;
begin
  for firma,esperado in select * from (values
    ('private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean)','63205e23da262e6f76ff44b8a1783e01'),
    ('public.haiku_incorporar_pago_servicios_libro_v1(uuid,jsonb)','a9240c4e91b88ebc1b0091072a9108ca'),
    ('public.haiku_incorporar_libro_v1(uuid,jsonb)','a448127813289c3a2baf5ce4faf6e110'),
    ('public.haiku_libro_aplicaciones_servicio_capacidad_v1()','130d05cdedb77e6be66770426cf0d7e3'),
    ('public.haiku_libro_transferencias_capacidad_v2()','95152ba418de9c956bce97f787e87c10'),
    ('private.haiku_libro_transferencia_validar_v2(uuid,jsonb,jsonb,boolean)','8f7b3cb53ea7a4a64354890b280812c1'),
    ('private.haiku_libro_es_admin_v1()','86045fbe98a4a69f3615c46129ef4c73')
  ) v(firma,esperado) loop
    select md5(prosrc) into actual from pg_proc where oid=to_regprocedure(firma);
    if actual is distinct from esperado then raise exception 'Writer distinto: %',firma; end if;
  end loop;
end;
$guard$;

create function private.haiku_libro_revision_pago_admin_validar_v1(r uuid,a jsonb,o jsonb,manual boolean)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $fn$
declare d jsonb:=o->'revision_pago_admin_v1'; e jsonb:=o->'evidencia_libro'; cab integer; estancia uuid;
begin
  if not o ? 'revision_pago_admin_v1' then return o; end if;
  if auth.uid() is null or not private.haiku_libro_es_admin_v1() or
     not private.haiku_tiene_permiso('pagos.registrar') then
    raise exception 'Sólo un administrador puede confirmar esta revisión de pago' using errcode='42501';
  end if;
  if coalesce(manual is distinct from true or jsonb_typeof(d)<>'object' or jsonb_typeof(e)<>'object'
    or d->>'version'<>'1' or d->>'confirmado'<>'true' or d->>'usuario'<>auth.uid()::text
    or d->>'reserva_id'<>r::text or o->>'reserva_id'<>r::text
    or a->>'p_reserva_id'<>r::text or length(btrim(d->>'motivo')) not between 8 and 500
    or d->>'tipo' not in ('efectivo_servicio','cabana_transferencia')
    or o->>'source_kind'<>'libro_reserva' or nullif(o->>'source_fingerprint','') is null
    or nullif(o->>'item_id','') is null or nullif(o#>>'{origen,hoja}','') is null or nullif(o#>>'{origen,celda}','') is null
    or d->'origen' is distinct from o->'origen' or e->'origen' is distinct from o->'origen'
    or o->>'moneda'<>'CLP' or e->>'moneda'<>'CLP' or (a->>'p_monto')::bigint<=0
    or d->>'monto'<>a->>'p_monto' or e->>'monto'<>a->>'p_monto' or o->>'monto'<>a->>'p_monto'
    or d->>'fecha_pago'<>a->>'p_fecha_pago' or e->>'fecha_comprobante'<>a->>'p_fecha_pago'
    or o->>'fecha'<>a->>'p_fecha_pago' or d->>'fecha_bloque'<>o->>'fecha_bloque'
    or e->>'fecha_bloque'<>o->>'fecha_bloque' or a->>'p_fecha_pago' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or e->>'pago_recibido'<>'true' or e->>'estado_pago'<>'registrado_en_libro'
    or e->>'medio_pago'<>a->>'p_medio_pago' or o->>'medio'<>a->>'p_medio_pago'
    or d->>'concepto_original' is distinct from e->>'concepto'
    or nullif(e->>'texto_original','') is null or e->>'texto_original' is distinct from a->>'p_referencia_externa'
    or nullif(a->>'p_folio','') is not null or nullif(a->>'p_codigo_autorizacion','') is not null
    or nullif(a->>'p_bove','') is not null or nullif(o->>'bovtar','') is not null
    or nullif(e->>'folio','') is not null or nullif(e->>'codigo_autorizacion','') is not null or nullif(e->>'bovtar','') is not null
    or coalesce((e->>'transaccion_distribuida')::boolean,false)
    or coalesce((e->>'conflicto_distribucion')::boolean,false),true) then
    raise exception 'Revisión administrativa incompleta o distinta de la evidencia original';
  end if;
  perform 1 from reservas where id=r and estado_reserva not in ('cancelada','no_show') for update;
  if not found then raise exception 'Reserva no disponible para confirmar el pago'; end if;
  select re.id,c.numero into strict estancia,cab from reserva_estadias re join cabanas c on c.id=re.cabana_id
    where re.reserva_id=r and re.id=(d->>'estadia_id')::uuid and re.fecha_ingreso=(o->>'fecha_bloque')::date
      and re.estado_estadia not in ('cancelada','no_show') for update of re;
  if cab is distinct from (d->>'cabana_confirmada')::integer or cab is distinct from (o->>'cabana')::integer
    or cab is distinct from (e->>'cabana')::integer then raise exception 'La cabaña destino cambió; vuelve a revisar'; end if;
  if d->>'tipo'='efectivo_servicio' then
    if a->>'p_medio_pago' is distinct from 'efectivo' or o->>'tipo_movimiento' is distinct from 'servicio' or e->>'tipo_movimiento' is distinct from 'servicio'
      or jsonb_array_length(o#>'{aplicaciones_servicio_v1,aplicaciones}') is distinct from 1
      or (o#>>'{aplicaciones_servicio_v1,aplicaciones,0,monto}')::bigint is distinct from (a->>'p_monto')::bigint
      or o#>>'{aplicaciones_servicio_v1,aplicaciones,0,concepto_canon}' is distinct from
        private.haiku_libro_concepto_servicio_canon_v1(e->>'concepto') then
      raise exception 'El efectivo necesita un servicio y un cargo compatibles';
    end if;
  else
    if a->>'p_medio_pago' is distinct from 'transferencia' or o->>'tipo_movimiento' is distinct from 'alojamiento' or e->>'tipo_movimiento' is distinct from 'alojamiento'
      or o#>>'{evidencia_transferencia,version}' is distinct from '2'
      or (d->>'cabana_concepto')::integer is distinct from ((regexp_match(e->>'concepto','^cab\s*(\d+)\M','i'))[1])::integer
      or coalesce((d->>'cabana_concepto')::integer,0)<=0 or (d->>'cabana_concepto')::integer=cab then
      raise exception 'La aclaración de cabaña no corresponde al concepto original';
    end if;
  end if;
  return jsonb_set(o,'{revision_pago_admin_v1}',d||jsonb_build_object('usuario',auth.uid(),'validado_en',now()));
end;
$fn$;
revoke all on function private.haiku_libro_revision_pago_admin_validar_v1(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;

do $patch$
declare def text;
begin
  select pg_get_functiondef('private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean)'::regprocedure) into def;
  if (length(def)-length(replace(def,$old$  v_transferencia_late_manual boolean := false;$old$,'')))/length($old$  v_transferencia_late_manual boolean := false;$old$)<>1 then raise exception 'Ancla SQL distinta'; end if;
  def:=replace(def,$old$  v_transferencia_late_manual boolean := false;$old$,$new$  v_transferencia_late_manual boolean := false;
  v_efectivo_admin boolean := false;$new$);
  if (length(def)-length(replace(def,$old$begin
  if auth.uid()$old$,'')))/length($old$begin
  if auth.uid()$old$)<>1 then raise exception 'Ancla SQL distinta'; end if;
  def:=replace(def,$old$begin
  if auth.uid()$old$,$new$begin
  p_origen:=private.haiku_libro_revision_pago_admin_validar_v1(p_reserva_id,p_argumentos,p_origen,p_manual);
  v_efectivo_admin:=p_origen#>>'{revision_pago_admin_v1,tipo}'='efectivo_servicio';
  if auth.uid()$new$);
  if (length(def)-length(replace(def,$old$and v_transferencia_late_manual is distinct from true then$old$,'')))/length($old$and v_transferencia_late_manual is distinct from true then$old$)<>1 then raise exception 'Ancla SQL distinta'; end if;
  def:=replace(def,$old$and v_transferencia_late_manual is distinct from true then$old$,$new$and v_transferencia_late_manual is distinct from true and v_efectivo_admin is distinct from true then$new$);
  if (length(def)-length(replace(def,$old$  with coincidencias as ($old$,'')))/length($old$  with coincidencias as ($old$)<>1 then raise exception 'Ancla SQL distinta'; end if;
  def:=replace(def,$old$  with coincidencias as ($old$,$new$  -- El efectivo no tiene identificador bancario: tampoco se inventa uno.
  -- La reserva ya está bloqueada; otro pago igual o de la misma fuente exige revisión.
  if v_efectivo_admin and exists (
    select 1 from pagos p where p.tipo_movimiento='pago' and p.estado is distinct from 'anulado' and (
      p.datos_origen->>'item_id'=p_origen->>'item_id' or
      (p.reserva_id=p_reserva_id and p.medio_pago='efectivo' and p.monto=monto_total and
        (p.fecha_pago is null or (p.fecha_pago at time zone 'America/Santiago')::date=(p_argumentos->>'p_fecha_pago')::date
         or (p.fecha_pago at time zone 'UTC')::date=(p_argumentos->>'p_fecha_pago')::date)))) then
    raise exception 'Existe efectivo de igual monto y fecha o fuente; vuelve a revisar';
  end if;

  with coincidencias as ($new$);
  execute def;
end;
$patch$;

do $patch$
declare def text;
begin
  select pg_get_functiondef('public.haiku_incorporar_pago_servicios_libro_v1(uuid,jsonb)'::regprocedure) into def;
  if (length(def)-length(replace(def,$old$  v_pago:=private.haiku_libro_pago_servicios_v1$old$,'')))/length($old$  v_pago:=private.haiku_libro_pago_servicios_v1$old$)<>1 then raise exception 'Ancla SQL distinta'; end if;
  def:=replace(def,$old$  v_pago:=private.haiku_libro_pago_servicios_v1$old$,$new$  if v_origen ? 'revision_pago_admin_v1' and p_item->>'item_id' is distinct from v_origen->>'item_id' then
    raise exception 'Identidad de revisión distinta de la fila del Libro';
  end if;
  v_origen:=private.haiku_libro_revision_pago_admin_validar_v1(v_reserva,v_argumentos,v_origen,v_manual);
  v_pago:=private.haiku_libro_pago_servicios_v1$new$);
  if (length(def)-length(replace(def,$old$'aprobado_manualmente',v_manual, 'medio_pago_manual_v1'$old$,'')))/length($old$'aprobado_manualmente',v_manual, 'medio_pago_manual_v1'$old$)<>1 then raise exception 'Ancla SQL distinta'; end if;
  def:=replace(def,$old$'aprobado_manualmente',v_manual, 'medio_pago_manual_v1'$old$,$new$'revision_pago_admin_v1',v_origen->'revision_pago_admin_v1','evidencia_libro',case when v_origen ? 'revision_pago_admin_v1' then v_origen->'evidencia_libro' end,
          'aprobado_manualmente',v_manual, 'medio_pago_manual_v1'$new$);
  execute def;
end;
$patch$;

do $patch$
declare def text;
begin
  select pg_get_functiondef('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure) into def;
  if (length(def)-length(replace(def,$old$    if v_monto is null or v_monto <= 0 or v_fecha_pago is null then$old$,'')))/length($old$    if v_monto is null or v_monto <= 0 or v_fecha_pago is null then$old$)<>1 then raise exception 'Ancla SQL distinta'; end if;
  def:=replace(def,$old$    if v_monto is null or v_monto <= 0 or v_fecha_pago is null then$old$,$new$    if v_origen ? 'revision_pago_admin_v1' and (v_item_id is distinct from v_origen->>'item_id' or
      v_origen#>>'{revision_pago_admin_v1,tipo}' is distinct from 'cabana_transferencia') then
      raise exception 'Identidad o tipo de revisión administrativa inválida';
    end if;
    v_origen:=private.haiku_libro_revision_pago_admin_validar_v1(v_reserva_id,v_argumentos,v_origen,v_manual);
    if v_monto is null or v_monto <= 0 or v_fecha_pago is null then$new$);
  if (length(def)-length(replace(def,$old$'aprobado_manualmente', v_manual, 'medio_pago_manual_v1'$old$,'')))/length($old$'aprobado_manualmente', v_manual, 'medio_pago_manual_v1'$old$)<>1 then raise exception 'Ancla SQL distinta'; end if;
  def:=replace(def,$old$'aprobado_manualmente', v_manual, 'medio_pago_manual_v1'$old$,$new$'revision_pago_admin_v1',v_origen->'revision_pago_admin_v1','evidencia_libro',case when v_origen ? 'revision_pago_admin_v1' then v_origen->'evidencia_libro' end, 'aprobado_manualmente', v_manual, 'medio_pago_manual_v1'$new$);
  execute def;
end;
$patch$;

do $patch$
declare def text;
begin
  select pg_get_functiondef('public.haiku_libro_aplicaciones_servicio_capacidad_v1()'::regprocedure) into def;
  if (length(def)-length(replace(def,$old$'transferencia_late_checkout_sin_identificador_v1',true)$old$,'')))/length($old$'transferencia_late_checkout_sin_identificador_v1',true)$old$)<>1 then raise exception 'Ancla SQL distinta'; end if;
  def:=replace(def,$old$'transferencia_late_checkout_sin_identificador_v1',true)$old$,$new$'transferencia_late_checkout_sin_identificador_v1',true,'revision_pago_admin_v1',true)$new$);
  execute def;
end;
$patch$;

-- Conserva el contrato de transferencias v2 con la nueva huella del mismo writer.
do $cap$
declare def text; huella text;
begin
  select md5(replace(prosrc,chr(13),'')) into huella from pg_proc where oid='public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure;
  select pg_get_functiondef('public.haiku_libro_transferencias_capacidad_v2()'::regprocedure) into def;
  execute replace(def,'a448127813289c3a2baf5ce4faf6e110',huella);
end;
$cap$;
commit;
