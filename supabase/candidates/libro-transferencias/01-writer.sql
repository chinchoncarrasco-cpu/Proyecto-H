-- CANDIDATA: revisión y aplicación separadas. No ejecutada en Supabase.
-- No migra ni actualiza datos históricos. Sólo afecta nuevas confirmaciones del Libro.
begin;
set local lock_timeout='5s';

create function private.haiku_libro_operacion_bancaria_v2(t text)
returns text language sql immutable set search_path=pg_catalog as $fn$
  select case when count(*)=0 then null
    when count(distinct op)=1 and count(*)=count(op) then min(op) else '!REVISION!' end
  from (select case when valor ~ '[0-9]' then valor end op from (
    select upper((regexp_match(btrim(campo),
    '^(?:n(?:ro|umero|úmero)?\.?\s*(?:de\s*)?)?operaci[oó]n\s*(?:bancaria\s*)?[:#.]?\s*([a-z0-9-]{1,64})$', 'i'))[1]) valor
    from regexp_split_to_table(t,'\s*(?:/+|\r?\n)\s*') campo
    where btrim(campo) ~* '^(?:n(?:ro|umero|úmero)?\.?\s*(?:de\s*)?)?operaci[oó]n\M') x) s;
$fn$;
revoke all on function private.haiku_libro_operacion_bancaria_v2(text) from public,anon,authenticated;

create function private.haiku_libro_transferencia_validar_v2(r uuid, a jsonb, o jsonb, final boolean)
returns uuid language plpgsql set search_path=pg_catalog,public,private as $fn$
declare e jsonb:=o->'evidencia_transferencia'; op text:=nullif(e->>'operacion_bancaria','');
  candidato record; existente uuid; cantidad integer:=0;
begin
  if coalesce(auth.uid() is null or final is distinct from true or a->>'p_medio_pago'<>'transferencia'
    or e->>'version'<>'2' or o->>'tipo_movimiento'<>'alojamiento'
    or nullif(e->>'glosa_original','') is null or nullif(e->>'numero_remitente','') is null
    or jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(o->'pagador') is distinct from 'object'
    or nullif(o#>>'{pagador,nombre}','') is null
    or o#>>'{pagador,numero_remitente}' is distinct from e->>'numero_remitente'
    or position(e->>'numero_remitente' in e->>'glosa_original')=0
    or position(o#>>'{pagador,nombre}' in e->>'glosa_original')=0
    or position(e->>'glosa_original' in coalesce(a->>'p_referencia_externa',''))=0
    or op is distinct from private.haiku_libro_operacion_bancaria_v2(a->>'p_referencia_externa')
    or nullif(o#>>'{origen,hoja}','') is null or nullif(o#>>'{origen,celda}','') is null
    or o->>'medio'<>'transferencia' or o->>'moneda'<>'CLP'
    or (o->>'monto')::bigint is distinct from (a->>'p_monto')::bigint
    or (o->>'monto')::bigint<=0
    or (e->>'fecha_recepcion')::date is distinct from (a->>'p_fecha_pago')::date
    or nullif(a->>'p_codigo_autorizacion','') is not null
    or nullif(a->>'p_folio','') is not null or nullif(a->>'p_bove','') is not null
    or nullif(o->>'bovtar','') is not null, true) then
    raise exception 'Transferencia incompleta o contradictoria; vuelve a revisar' using errcode='HLC01';
  end if;
  if (select count(*) from reserva_estadias re join cabanas c on c.id=re.cabana_id
      where re.reserva_id=r and re.fecha_ingreso=(o->>'fecha_bloque')::date
        and c.numero=(o->>'cabana')::integer and re.estado_estadia not in ('cancelada','no_show'))<>1 then
    raise exception 'Destino de transferencia no inequívoco; vuelve a revisar' using errcode='HLC01';
  end if;
  -- Serializa las confirmaciones bancarias del Libro antes de consultar candidatos.
  -- No convierte el remitente ni las coordenadas en una clave de transacción.
  perform pg_advisory_xact_lock(hashtext('haku-libro-transferencias-v2'));
  for candidato in select p.* from pagos p
    where p.tipo_movimiento='pago' and (
      (op is not null and coalesce(p.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}',private.haiku_libro_operacion_bancaria_v2(p.referencia_externa))=op)
      or (p.monto=(a->>'p_monto')::bigint and coalesce(p.moneda,'CLP')='CLP'
        and (p.fecha_pago is null or (p.fecha_pago at time zone 'America/Santiago')::date=(a->>'p_fecha_pago')::date
          or (p.fecha_pago at time zone 'UTC')::date=(a->>'p_fecha_pago')::date)
        and (p.reserva_id=r and p.medio_pago='transferencia'
          or p.datos_origen#>>'{pagador,numero_remitente}'=e->>'numero_remitente'
          or position(e->>'numero_remitente' in coalesce(p.referencia_externa,''))>0)
        and not (op is not null and coalesce(p.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}',private.haiku_libro_operacion_bancaria_v2(p.referencia_externa)) is not null
          and coalesce(p.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}',private.haiku_libro_operacion_bancaria_v2(p.referencia_externa))<>'!REVISION!'
          and op<>coalesce(p.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}',private.haiku_libro_operacion_bancaria_v2(p.referencia_externa)))))
  loop
    cantidad:=cantidad+1;
    if op is null or candidato.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}' is distinct from op
      or candidato.reserva_id<>r or candidato.estado<>'confirmado' or candidato.medio_pago<>'transferencia'
      or candidato.monto<>(a->>'p_monto')::bigint or candidato.moneda<>'CLP'
      or ((candidato.fecha_pago at time zone 'America/Santiago')::date is distinct from (a->>'p_fecha_pago')::date
        and (candidato.fecha_pago at time zone 'UTC')::date is distinct from (a->>'p_fecha_pago')::date)
      or candidato.datos_origen#>>'{pagador,numero_remitente}' is distinct from e->>'numero_remitente'
      or candidato.datos_origen#>>'{pagador,nombre}' is distinct from o#>>'{pagador,nombre}' then
      raise exception 'Transferencia posiblemente duplicada o contradictoria; vuelve a revisar' using errcode='HLC01';
    end if;
    existente:=candidato.id;
  end loop;
  if cantidad>1 then raise exception 'Múltiples candidatos bancarios; vuelve a revisar' using errcode='HLC01'; end if;
  return existente;
end;
$fn$;
revoke all on function private.haiku_libro_transferencia_validar_v2(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;

do $patch$
declare f record; despues record; original text; nuevo text; ancla text;
begin
  select * into f from pg_proc where oid=to_regprocedure('public.haiku_incorporar_libro_v1(uuid,jsonb)');
  if not found or md5(replace(f.prosrc,E'\r','')) not in
    ('1898d46805d4d65f582dada43909b745','005385ccd81ea8b30f67adace1ac45f2')
    or f.proowner<>'postgres'::regrole or f.prosecdef is distinct from true
    or f.proacl is distinct from '{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]
    or regexp_replace(array_to_string(f.proconfig,','),'\s','','g') is distinct from 'search_path=pg_catalog,public,private' then
    raise exception 'Writer distinto del baseline revisado (con o sin candidata RUT); detener y revisar';
  end if;
  original:=replace(pg_get_functiondef(f.oid),E'\r',''); nuevo:=original;
  nuevo:=replace(nuevo,'v_origen,v_argumentos,v_manual);',
    'v_origen,v_argumentos,v_manual or (v_medio=''transferencia'' and v_origen#>>''{evidencia_transferencia,version}''=''2'' and coalesce((v_item->>''confirmacion_final'')::boolean,false)));');
  nuevo:=replace(nuevo,'    if not v_fuerte and not v_manual then',
    '    if not v_fuerte and not v_manual and not (v_medio=''transferencia'' and coalesce(v_origen#>>''{evidencia_transferencia,version}''=''2'',false) and coalesce((v_item->>''confirmacion_final'')::boolean,false)) then');
  ancla:='    v_pago_existente := null;';
  nuevo:=replace(nuevo,ancla,$new$    v_pago_existente := null;
    if v_medio='transferencia' and v_origen#>>'{evidencia_transferencia,version}'='2' then
      -- La fecha de recepción del Libro es un día civil de Chile, no medianoche UTC.
      v_fecha_pago:=((v_argumentos->>'p_fecha_pago')::date + time '12:00') at time zone 'America/Santiago';
      v_pago_existente:=private.haiku_libro_transferencia_validar_v2(v_reserva_id,v_argumentos,v_origen,
        coalesce((v_item->>'confirmacion_final')::boolean,false));
    else$new$);
  nuevo:=replace(nuevo,E'    limit 1;\n\n    if v_pago_existente',E'    limit 1;\n    end if;\n\n    if v_pago_existente');
  nuevo:=replace(nuevo,'set pagador_nombre = coalesce((select r.titular_nombre',
    'set pagador_nombre = coalesce(case when v_medio=''transferencia'' and v_origen#>>''{evidencia_transferencia,version}''=''2'' then v_origen#>>''{pagador,nombre}'' end, (select r.titular_nombre');
  nuevo:=replace(nuevo,'''aprobado_manualmente'', v_manual, ''medio_pago_manual_v1''',
    '''pagador'', case when v_medio=''transferencia'' then v_origen->''pagador'' end, ''evidencia_transferencia'', case when v_medio=''transferencia'' then v_origen->''evidencia_transferencia'' end, ''confirmacion_final'', case when v_medio=''transferencia'' and v_origen#>>''{evidencia_transferencia,version}''=''2'' then coalesce((v_item->>''confirmacion_final'')::boolean,false) end, ''aprobado_manualmente'', v_manual, ''medio_pago_manual_v1''');
  if nuevo=original or position('haiku_libro_transferencia_validar_v2(v_reserva_id' in nuevo)=0 then raise exception 'Anclas inesperadas'; end if;
  execute nuevo;
  select * into despues from pg_proc where oid=f.oid;
  if (despues.proowner,despues.proacl,despues.prosecdef,despues.proconfig) is distinct from
    (f.proowner,f.proacl,f.prosecdef,f.proconfig) then raise exception 'Permisos alterados'; end if;
  -- La capacidad deja de anunciarse si otra revisión sustituye el writer.
  execute format($ddl$create function public.haiku_libro_transferencias_capacidad_v2() returns jsonb
    language sql stable security invoker set search_path=pg_catalog,public as $body$
    select jsonb_build_object('version',2,'confirmacion_final',md5(replace(prosrc,chr(13),''))=%L)
    from pg_proc where oid='public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure $body$$ddl$,
    md5(replace(despues.prosrc,E'\r','')));
end;
$patch$;
revoke all on function public.haiku_libro_transferencias_capacidad_v2() from public,anon;
grant execute on function public.haiku_libro_transferencias_capacidad_v2() to authenticated;
commit;
