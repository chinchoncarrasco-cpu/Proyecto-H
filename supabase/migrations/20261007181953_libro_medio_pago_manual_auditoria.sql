-- Auditoría al incorporar: no agrega medios ni modifica filas históricas.
-- Conserva las firmas, ACL, owner, locks y validaciones de ambos writers.
begin;

create function private.haiku_libro_medio_pago_manual_validar_v1(
  p_origen jsonb, p_argumentos jsonb, p_manual boolean
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,private
as $function$
declare
  d jsonb := p_origen->'medio_pago_manual_v1';
  evidencia jsonb;
  elegido timestamptz;
begin
  if d is null then return p_origen; end if;
  if auth.uid() is null or p_manual is distinct from true or jsonb_typeof(d) is distinct from 'object'
    or d->>'version' is distinct from '1'
    or d->>'medio' is distinct from p_argumentos->>'p_medio_pago'
    or coalesce(d->>'medio','') not in ('transferencia','tarjeta_credito','tarjeta_debito','webpay_credito',
      'webpay_debito','efectivo','airbnb_prepaid_card')
    or d->>'usuario' is distinct from auth.uid()::text
    or coalesce(d->>'version_libro','') !~ '^[a-fA-F0-9]{64}$'
    or coalesce(d->>'generacion','') !~ '^[0-9]+$'
    or jsonb_typeof(d->'origen') is distinct from 'object'
    or d->'origen' is distinct from p_origen->'origen'
    or jsonb_typeof(d->'origen'->'hoja') is distinct from 'string'
    or jsonb_typeof(d->'origen'->'celda') is distinct from 'string'
    or nullif(btrim(d->'origen'->>'hoja'),'') is null
    or nullif(btrim(d->'origen'->>'celda'),'') is null
    or length(d->'origen'->>'hoja') > 128 or length(d->'origen'->>'celda') > 128
    or jsonb_typeof(d->'evidencia_original') is distinct from 'object' then
    raise exception 'Resolucion manual de medio incompleta o incompatible';
  end if;
  evidencia := d->'evidencia_original';
  if evidencia->>'moneda' is distinct from 'CLP'
    or evidencia->>'monto' is distinct from p_argumentos->>'p_monto'
    or evidencia->>'fecha_bloque' is distinct from p_origen->>'fecha_bloque'
    or coalesce(evidencia->>'medio','') not in ('','webpay') then
    raise exception 'Evidencia original del medio incompatible con el pago';
  end if;
  begin
    elegido := (d->>'elegido_en')::timestamptz;
    if elegido is null or not isfinite(elegido) then raise exception 'Fecha ausente'; end if;
  exception when others then
    raise exception 'Fecha de la eleccion del medio invalida';
  end;
  -- Lista explícita: no persiste nombres/contactos ni campos arbitrarios.
  return p_origen || jsonb_build_object('medio_pago_manual_v1',jsonb_build_object(
    'version',1,'medio',d->>'medio','usuario',auth.uid(),'version_libro',d->>'version_libro',
    'generacion',(d->>'generacion')::bigint,'elegido_en',elegido,'incorporado_en',clock_timestamp(),
    'origen',jsonb_build_object('hoja',d->'origen'->>'hoja','celda',d->'origen'->>'celda'),
    'evidencia_original',jsonb_build_object('monto',(evidencia->>'monto')::bigint,
      'moneda','CLP','medio',evidencia->>'medio','fecha_comprobante',evidencia->>'fecha_comprobante',
      'fecha_bloque',evidencia->>'fecha_bloque')));
end;
$function$;
revoke all on function private.haiku_libro_medio_pago_manual_validar_v1(jsonb,jsonb,boolean) from public,anon,authenticated;

do $migration$
declare
  f record; actual record; original text; nuevo text; marcador text;
begin
  for f in select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('haiku_incorporar_libro_v1','haiku_incorporar_pago_servicios_libro_v1')
  loop
    original := pg_get_functiondef(f.oid);
    if f.proname='haiku_incorporar_libro_v1' then
      marcador := '    if v_monto is null or v_monto <= 0 or v_fecha_pago is null then';
    else
      marcador := '  v_pago:=private.haiku_libro_pago_servicios_v1(v_reserva,v_argumentos,v_origen,v_manual);';
    end if;
    if (length(original)-length(replace(original,marcador,'')))/length(marcador) <> 1
      or (select count(*) from regexp_matches(original,'''aprobado_manualmente''\s*,\s*v_manual','g')) <> 1
      or f.prosecdef is distinct from true then
      raise exception 'Contrato de auditoria inesperado en %; revisar antes de aplicar',f.proname;
    end if;
    nuevo := replace(original,marcador,
      E'  v_origen := private.haiku_libro_medio_pago_manual_validar_v1(v_origen,v_argumentos,v_manual);\n' || marcador);
    nuevo := regexp_replace(nuevo,'(''aprobado_manualmente''\s*,\s*v_manual)',
      '\1, ''medio_pago_manual_v1'', v_origen->''medio_pago_manual_v1''','g');
    execute nuevo;
    select * into actual from pg_proc where oid=f.oid;
    if actual.proacl is distinct from f.proacl or actual.proowner is distinct from f.proowner
      or actual.prosecdef is distinct from f.prosecdef or actual.proconfig is distinct from f.proconfig then
      raise exception 'La auditoria debe conservar la seguridad de %',f.proname;
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('haiku_incorporar_libro_v1','haiku_incorporar_pago_servicios_libro_v1')) <> 2 then
    raise exception 'Faltan los writers unicos de incorporacion del Libro';
  end if;
end;
$migration$;

create function public.haiku_libro_medio_pago_manual_capacidad_v1()
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $function$
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion'; end if;
  return jsonb_build_object('version',1,'auditoria',true);
end;
$function$;
revoke all on function public.haiku_libro_medio_pago_manual_capacidad_v1() from public,anon;
grant execute on function public.haiku_libro_medio_pago_manual_capacidad_v1() to authenticated;
commit;
