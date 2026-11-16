-- Snapshot de funciones SQL existentes, sin filas ni datos personales.
-- Solo para PostgreSQL local desechable; no sustituye funciones productivas.
CREATE OR REPLACE FUNCTION private.haiku_libro_operacion_bancaria_v2(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when count(*)=0 then null
    when count(distinct op)=1 and count(*)=count(op) then min(op) else '!REVISION!' end
  from (select case when valor ~ '[0-9]' then valor end op from (
    select upper((regexp_match(btrim(campo),
    '^(?:n(?:ro|umero|úmero)?\.?\s*(?:de\s*)?)?operaci[oó]n\s*(?:bancaria\s*)?[:#.]?\s*([a-z0-9-]{1,64})$', 'i'))[1]) valor
    from regexp_split_to_table(t,'\s*(?:/+|\r?\n)\s*') campo
    where btrim(campo) ~* '^(?:n(?:ro|umero|úmero)?\.?\s*(?:de\s*)?)?operaci[oó]n\M') x) s;
$function$;

CREATE OR REPLACE FUNCTION private.haiku_libro_transferencia_validar_v2(r uuid, a jsonb, o jsonb, final boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare e jsonb:=o->'evidencia_transferencia'; op text:=nullif(e->>'operacion_bancaria','');
  candidato record; existente uuid; cantidad integer:=0;
begin
  if coalesce(auth.uid() is null or final is distinct from true or a->>'p_medio_pago'<>'transferencia'
    or e->>'version'<>'2' or o->>'tipo_movimiento'<>'alojamiento'
    or nullif(e->>'glosa_original','') is null or nullif(e->>'numero_remitente','') is null
    or jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(o->'pagador') is distinct from 'object'
    or (nullif(o#>>'{pagador,nombre}','') is null and
      (regexp_match(btrim(e->>'glosa_original'),
        '^(?:transf(?:erencia)?\.?\s+)?([0-9]{7,12}[kK]?)(?:\s+transf(?:erencia)?\.?)?$', 'i'))[1]
        is distinct from e->>'numero_remitente')
    or o#>>'{pagador,numero_remitente}' is distinct from e->>'numero_remitente'
    or position(e->>'numero_remitente' in e->>'glosa_original')=0
    or (nullif(o#>>'{pagador,nombre}','') is not null and
      position(o#>>'{pagador,nombre}' in e->>'glosa_original')=0)
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
$function$;
