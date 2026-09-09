-- The existing incorporation RPC keeps its locks, permissions, identifier check
-- and operation idempotency. Only explicitly reviewed split receipts use this helper.
create or replace function private.haiku_libro_pago_distribuido_v1(
  p_reserva_id uuid, p_argumentos jsonb, p_origen jsonb, p_manual boolean
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  d jsonb := p_origen->'distribucion_manual';
  partes jsonb := d->'componentes';
  parte jsonb;
  total bigint := 0;
  alojamiento integer := 0;
  early integer := 0;
  estadia uuid := (d->>'estadia_id')::uuid;
  coincidencias integer;
  titular text;
  monto bigint;
  restante bigint;
  aplicado bigint := 0;
  aplicaciones jsonb := '[]'::jsonb;
  pendientes jsonb := '[]'::jsonb;
  cargo record;
  pago jsonb;
begin
  if auth.uid() is null or not private.haiku_tiene_permiso('pagos.registrar') then
    raise exception 'Sin permiso para registrar pagos' using errcode='42501';
  end if;
  if p_manual is distinct from true or jsonb_typeof(partes) is distinct from 'array'
     or jsonb_array_length(partes) <> 2 or nullif(d->>'id','') is null then
    raise exception 'La distribución requiere dos partes aprobadas explícitamente';
  end if;
  if nullif(btrim(p_argumentos->>'p_codigo_autorizacion'),'') is null and
     (nullif(btrim(p_argumentos->>'p_folio'),'') is null or nullif(btrim(p_origen->>'bovtar'),'') is null) then
    raise exception 'La distribución requiere un identificador transaccional fuerte';
  end if;
  select r.titular_nombre into titular from public.reservas r where r.id=p_reserva_id;
  if regexp_replace(translate(lower(titular),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
     is distinct from regexp_replace(translate(lower(d->>'titular'),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g') then
    raise exception 'El titular de la distribución no coincide';
  end if;
  select count(*) into coincidencias from public.reserva_estadias e
    join public.reservas r on r.id=e.reserva_id
    where e.fecha_ingreso=(p_origen->>'fecha_bloque')::date
      and e.estado_estadia not in ('cancelada','no_show') and r.estado_reserva <> 'cancelada'
      and regexp_replace(translate(lower(r.titular_nombre),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
        = regexp_replace(translate(lower(titular),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g');
  if coincidencias <> 1 or not exists (
    select 1 from public.reserva_estadias e join public.cabanas c on c.id=e.cabana_id
    where e.id=estadia and e.reserva_id=p_reserva_id and c.numero=(d->>'cabana')::integer
      and e.fecha_ingreso=(p_origen->>'fecha_bloque')::date and e.estado_estadia not in ('cancelada','no_show')
  ) then raise exception 'La estadía ya no es única o cambió; vuelve a preparar'; end if;
  if (select count(distinct x->>'item_id') from jsonb_array_elements(partes) x) <> 2
     or (select count(distinct x->'origen'->>'celda') from jsonb_array_elements(partes) x) <> 2
     or (select count(distinct x->'origen'->>'hoja') from jsonb_array_elements(partes) x) <> 1 then
    raise exception 'La distribución repite una aplicación o carece de origen';
  end if;
  -- Lock accounting rows too: balances must not change during allocation.
  lock table public.cargos in share row exclusive mode;
  lock table public.pago_aplicaciones in share row exclusive mode;
  for parte in select value from jsonb_array_elements(partes) loop
    if (parte->>'aprobado_manualmente')::boolean is distinct from true
       or coalesce(parte->>'monto','') !~ '^[1-9][0-9]*$'
       or parte->>'moneda' is distinct from 'CLP'
       or (parte->>'pago_recibido')::boolean is distinct from true
       or parte->>'estado_pago' is distinct from 'registrado_en_libro'
       or parte->>'fecha_bloque' is distinct from p_origen->>'fecha_bloque'
       or parte->>'fecha_comprobante' is distinct from p_argumentos->>'p_fecha_pago'
       or (parte->>'cabana')::integer is distinct from (d->>'cabana')::integer
       or parte->>'folio' is distinct from p_argumentos->>'p_folio'
       or parte->>'codigo_autorizacion' is distinct from p_argumentos->>'p_codigo_autorizacion'
       or parte->>'bovtar' is distinct from p_origen->>'bovtar'
       or nullif(parte->>'texto_original','') is null
       or nullif(parte->>'item_id','') is null
       or nullif(parte->'origen'->>'hoja','') is null
       or nullif(parte->'origen'->>'celda','') is null
       or regexp_replace(translate(lower(parte->>'titular'),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
          is distinct from regexp_replace(translate(lower(titular),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g') then
      raise exception 'Datos incompletos o incompatibles en una parte del comprobante';
    end if;
    if (case parte->>'medio_pago' when 'credito' then 'tarjeta_credito' when 'debito' then 'tarjeta_debito'
        else parte->>'medio_pago' end) is distinct from p_argumentos->>'p_medio_pago' then
      raise exception 'Medios incompatibles en la distribución';
    end if;
    monto := (parte->>'monto')::bigint; total := total + monto; restante := monto;
    if parte->>'tipo_movimiento' = 'alojamiento' then
      alojamiento := alojamiento + 1;
      for cargo in select ec.cargo_id,ec.saldo_cargo from public.vista_estado_cargos ec
        join public.cargos c on c.id=ec.cargo_id
        where c.estadia_id=estadia and ec.reserva_id=p_reserva_id and ec.tipo_cargo='alojamiento'
          and ec.estado='activo' and ec.saldo_cargo>0 order by c.creado_en,ec.cargo_id loop
        exit when restante=0;
        monto := least(restante,cargo.saldo_cargo);
        aplicaciones := aplicaciones || jsonb_build_array(jsonb_build_object('cargo_id',cargo.cargo_id,'monto',monto));
        restante := restante-monto;
      end loop;
    elsif parte->>'tipo_movimiento'='servicio' and lower(btrim(parte->>'concepto')) ~ '^early\s*(check\s*)?in$' then
      early := early + 1;
      select count(*) into coincidencias from public.vista_estado_cargos ec
        join public.cargos c on c.id=ec.cargo_id join public.servicios s on s.id=c.servicio_id
        join public.catalogo_servicios cs on cs.id=s.catalogo_servicio_id
        where c.estadia_id=estadia and ec.reserva_id=p_reserva_id and ec.tipo_cargo='servicio'
          and ec.estado='activo' and s.estado_servicio<>'cancelado' and cs.codigo='earlyCheckin'
          and s.fecha_servicio=(p_origen->>'fecha_bloque')::date;
      if coincidencias=1 then
        for cargo in select ec.cargo_id,ec.saldo_cargo from public.vista_estado_cargos ec
          join public.cargos c on c.id=ec.cargo_id join public.servicios s on s.id=c.servicio_id
          join public.catalogo_servicios cs on cs.id=s.catalogo_servicio_id
          where c.estadia_id=estadia and ec.reserva_id=p_reserva_id and ec.tipo_cargo='servicio'
            and ec.estado='activo' and s.estado_servicio<>'cancelado' and cs.codigo='earlyCheckin'
            and s.fecha_servicio=(p_origen->>'fecha_bloque')::date and ec.saldo_cargo>0 loop
          monto := least(restante,cargo.saldo_cargo);
          aplicaciones := aplicaciones || jsonb_build_array(jsonb_build_object('cargo_id',cargo.cargo_id,'monto',monto));
          restante := restante-monto;
        end loop;
      end if;
    else raise exception 'La distribución sólo admite alojamiento y Early Check-In'; end if;
    aplicado := aplicado + (parte->>'monto')::bigint-restante;
    if restante>0 then pendientes := pendientes || jsonb_build_array(jsonb_build_object(
      'item_id',parte->>'item_id','concepto',parte->>'concepto','tipo_movimiento',parte->>'tipo_movimiento','monto',restante)); end if;
  end loop;
  if alojamiento<>1 or early<>1 or total is distinct from (p_argumentos->>'p_monto')::bigint or total is distinct from (d->>'total')::bigint then
    raise exception 'Total o aplicaciones incompatibles en el comprobante';
  end if;
  if exists(select 1 from jsonb_array_elements(partes) x where
    replace(substring(lower(x->>'texto_original') from 'monto\s*:?\s*\$?\s*([0-9.]+)'),'.','')::bigint <> total) then
    raise exception 'El total declarado en el Libro no coincide con la distribución';
  end if;
  pago := public.haiku_registrar_pago(p_reserva_id=>p_reserva_id,p_monto=>total,
    p_medio_pago=>p_argumentos->>'p_medio_pago',p_etapa_operativa=>'abono',
    p_fecha_pago=>(p_argumentos->>'p_fecha_pago')::timestamptz,p_folio=>p_argumentos->>'p_folio',
    p_codigo_autorizacion=>p_argumentos->>'p_codigo_autorizacion',p_bove=>coalesce(p_argumentos->>'p_bove',p_origen->>'bovtar'),
    p_referencia_externa=>p_argumentos->>'p_referencia_externa',p_observaciones=>p_argumentos->>'p_observaciones',
    p_aplicaciones=>aplicaciones,p_modo_aplicacion=>'ninguno');
  update public.pagos set datos_origen=coalesce(datos_origen,'{}'::jsonb)||jsonb_build_object(
    'distribucion_manual',d,'aplicaciones_pendientes',pendientes)
    where id=(pago->>'pago_id')::uuid;
  return pago;
end;
$function$;
revoke all on function private.haiku_libro_pago_distribuido_v1(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;

-- Surgical replacement: refuse an unexpected upstream body instead of overwriting it.
do $migration$
declare
  cuerpo text := replace(pg_get_functiondef('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure),E'\r','');
  inicio text := '    v_pago := public.haiku_registrar_pago(';
  fin text := '    v_pago_id := (v_pago ->> ''pago_id'')::uuid;';
begin
  if position('private.haiku_libro_pago_distribuido_v1' in cuerpo)>0 then return; end if;
  if (length(cuerpo)-length(replace(cuerpo,inicio,'')))/length(inicio)<>1
     or (length(cuerpo)-length(replace(cuerpo,fin,'')))/length(fin)<>1 then
    raise exception 'La RPC de incorporación cambió; revisar la migración antes de aplicar';
  end if;
  cuerpo := replace(cuerpo,inicio,
    E'    if v_origen ? ''distribucion_manual'' then\n      v_pago := private.haiku_libro_pago_distribuido_v1(v_reserva_id,v_argumentos,v_origen,v_manual);\n    else\n' || inicio);
  cuerpo := replace(cuerpo,fin,E'    end if;\n' || fin);
  execute cuerpo;
end;
$migration$;

-- Read-only handshake prevents an old backend from applying the total to lodging.
create or replace function public.haiku_libro_distribucion_capacidad_v1()
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $function$
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  return jsonb_build_object('version',1);
end;
$function$;
revoke all on function public.haiku_libro_distribucion_capacidad_v1() from public,anon;
grant execute on function public.haiku_libro_distribucion_capacidad_v1() to authenticated;
