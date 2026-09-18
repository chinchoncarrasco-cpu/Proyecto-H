-- Un comprobante real puede cubrir dos reservas hijas del mismo grupo. Se guarda
-- como un solo pago y conserva la distribución aprobada de cada cabaña.
create or replace function private.haiku_libro_pago_grupo_distribuido_v1(
  p_reserva_id uuid, p_argumentos jsonb, p_origen jsonb, p_manual boolean
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  d jsonb := p_origen->'distribucion_manual';
  partes jsonb := d->'componentes';
  parte jsonb;
  grupo uuid;
  grupo_real uuid;
  titular text;
  reserva_parte uuid;
  estadia_parte uuid;
  cabana_parte integer;
  coincidencias integer;
  total bigint := 0;
  monto bigint;
  restante bigint;
  aplicado bigint := 0;
  aplicaciones jsonb := '[]'::jsonb;
  pendientes jsonb := '[]'::jsonb;
  cargo record;
  pago jsonb;
begin
  if auth.uid() is null or not private.haiku_tiene_permiso('pagos.registrar') then
    raise exception 'Sin permiso para registrar pagos';
  end if;
  if p_manual is distinct from true or d->>'tipo' is distinct from 'grupo_alojamiento'
     or jsonb_typeof(partes) is distinct from 'array' or jsonb_array_length(partes) <> 2
     or nullif(d->>'id','') is null then
    raise exception 'El comprobante de grupo requiere dos partes aprobadas explícitamente';
  end if;
  if nullif(btrim(p_argumentos->>'p_codigo_autorizacion'),'') is null and
     (nullif(btrim(p_argumentos->>'p_folio'),'') is null or nullif(btrim(p_origen->>'bovtar'),'') is null) then
    raise exception 'El comprobante de grupo requiere un identificador transaccional fuerte';
  end if;
  begin
    grupo := (d->>'grupo_reserva_id')::uuid;
  exception when others then
    raise exception 'El grupo del comprobante no es válido';
  end;
  select r.grupo_reserva_id,r.titular_nombre into grupo_real,titular
  from public.reservas r where r.id=p_reserva_id and r.estado_reserva not in ('cancelada','no_show');
  if not found or grupo is null or grupo_real is distinct from grupo then
    raise exception 'La reserva ancla ya no pertenece al grupo elegido';
  end if;
  if regexp_replace(translate(lower(titular),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
     is distinct from regexp_replace(translate(lower(d->>'titular'),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g') then
    raise exception 'El titular del comprobante de grupo no coincide';
  end if;
  if (select count(distinct x->>'item_id') from jsonb_array_elements(partes) x) <> 2
     or (select count(distinct concat(x->'origen'->>'hoja','!',x->'origen'->>'celda')) from jsonb_array_elements(partes) x) <> 2
     or (select count(distinct x->>'reserva_id') from jsonb_array_elements(partes) x) <> 2
     or (select count(distinct x->>'estadia_id') from jsonb_array_elements(partes) x) <> 2
     or (select count(distinct x->>'cabana') from jsonb_array_elements(partes) x) <> 2 then
    raise exception 'El comprobante repite una cabaña, reserva, estadía o fuente';
  end if;

  lock table public.cargos in share row exclusive mode;
  lock table public.pago_aplicaciones in share row exclusive mode;
  for parte in select value from jsonb_array_elements(partes) loop
    if (parte->>'aprobado_manualmente')::boolean is distinct from true
       or coalesce(parte->>'monto','') !~ '^[1-9][0-9]*$'
       or parte->>'moneda' is distinct from 'CLP'
       or (parte->>'pago_recibido')::boolean is distinct from true
       or parte->>'estado_pago' is distinct from 'registrado_en_libro'
       or parte->>'tipo_movimiento' is distinct from 'alojamiento'
       or parte->>'fecha_bloque' is distinct from p_origen->>'fecha_bloque'
       or parte->>'fecha_comprobante' is distinct from p_argumentos->>'p_fecha_pago'
       or parte->>'folio' is distinct from p_argumentos->>'p_folio'
       or parte->>'codigo_autorizacion' is distinct from p_argumentos->>'p_codigo_autorizacion'
       or parte->>'bovtar' is distinct from p_origen->>'bovtar'
       or parte->>'grupo_reserva_id' is distinct from d->>'grupo_reserva_id'
       or nullif(parte->>'texto_original','') is null
       or nullif(parte->>'item_id','') is null
       or nullif(parte->'origen'->>'hoja','') is null
       or nullif(parte->'origen'->>'celda','') is null
       or regexp_replace(translate(lower(parte->>'titular'),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
          is distinct from regexp_replace(translate(lower(titular),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g') then
      raise exception 'Datos incompletos o incompatibles en una parte del comprobante de grupo';
    end if;
    if (case parte->>'medio_pago' when 'credito' then 'tarjeta_credito' when 'debito' then 'tarjeta_debito'
        else parte->>'medio_pago' end) is distinct from p_argumentos->>'p_medio_pago' then
      raise exception 'Medios incompatibles en el comprobante de grupo';
    end if;
    begin
      reserva_parte := (parte->>'reserva_id')::uuid;
      estadia_parte := (parte->>'estadia_id')::uuid;
      cabana_parte := (parte->>'cabana')::integer;
    exception when others then
      raise exception 'Destino inválido en una parte del comprobante de grupo';
    end;
    select count(*) into coincidencias
    from public.reserva_estadias e
    join public.reservas r on r.id=e.reserva_id
    join public.cabanas c on c.id=e.cabana_id
    where e.id=estadia_parte and e.reserva_id=reserva_parte and r.grupo_reserva_id=grupo
      and r.estado_reserva not in ('cancelada','no_show') and e.estado_estadia not in ('cancelada','no_show')
      and c.numero=cabana_parte and e.fecha_ingreso=(parte->>'fecha_bloque')::date;
    if coincidencias <> 1 then
      raise exception 'Una cabaña del comprobante cambió de reserva o estadía; vuelve a preparar';
    end if;
    monto := (parte->>'monto')::bigint;
    total := total+monto;
    restante := monto;
    for cargo in
      select ec.cargo_id,ec.saldo_cargo
      from public.vista_estado_cargos ec
      join public.cargos c on c.id=ec.cargo_id
      where c.estadia_id=estadia_parte and ec.reserva_id=reserva_parte
        and ec.tipo_cargo='alojamiento' and ec.estado='activo' and ec.saldo_cargo>0
      order by c.creado_en,ec.cargo_id
    loop
      exit when restante=0;
      monto := least(restante,cargo.saldo_cargo);
      aplicaciones := aplicaciones || jsonb_build_array(jsonb_build_object('cargo_id',cargo.cargo_id,'monto',monto));
      restante := restante-monto;
    end loop;
    aplicado := aplicado+(parte->>'monto')::bigint-restante;
    if restante>0 then
      pendientes := pendientes || jsonb_build_array(jsonb_build_object(
        'item_id',parte->>'item_id','reserva_id',reserva_parte,'estadia_id',estadia_parte,
        'cabana',cabana_parte,'concepto',parte->>'concepto','monto',restante));
    end if;
  end loop;
  if total is distinct from (p_argumentos->>'p_monto')::bigint or total is distinct from (d->>'total')::bigint then
    raise exception 'El total del comprobante no coincide con sus partes';
  end if;
  if exists(select 1 from jsonb_array_elements(partes) x where
    replace(substring(lower(x->>'texto_original') from 'monto\s*:?\s*\$?\s*([0-9.]+)'),'.','')::bigint <> total) then
    raise exception 'El total declarado en el Libro no coincide con el comprobante de grupo';
  end if;
  pago := public.haiku_registrar_pago(p_reserva_id=>p_reserva_id,p_monto=>total,
    p_medio_pago=>p_argumentos->>'p_medio_pago',p_etapa_operativa=>'abono',
    p_fecha_pago=>(p_argumentos->>'p_fecha_pago')::timestamptz,p_folio=>p_argumentos->>'p_folio',
    p_codigo_autorizacion=>p_argumentos->>'p_codigo_autorizacion',p_bove=>coalesce(p_argumentos->>'p_bove',p_origen->>'bovtar'),
    p_referencia_externa=>p_argumentos->>'p_referencia_externa',p_observaciones=>p_argumentos->>'p_observaciones',
    p_aplicaciones=>aplicaciones,p_modo_aplicacion=>'ninguno');
  update public.pagos set datos_origen=coalesce(datos_origen,'{}'::jsonb)||jsonb_build_object(
    'distribucion_manual',d,'aplicaciones_pendientes',pendientes,'aplicado_grupo',aplicado)
    where id=(pago->>'pago_id')::uuid;
  return pago;
end;
$function$;
revoke all on function private.haiku_libro_pago_grupo_distribuido_v1(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;

-- La RPC existente ya deriva toda distribución manual al helper instalado. Se
-- agrega un despacho cerrado para el nuevo tipo y se conserva intacta la rama
-- anterior de alojamiento + Early Check-In.
do $migration$
declare
  cuerpo text := replace(pg_get_functiondef('private.haiku_libro_pago_distribuido_v1(uuid,jsonb,jsonb,boolean)'::regprocedure),E'\r','');
  marca text := E'begin\n  if auth.uid() is null or not private.haiku_tiene_permiso(''pagos.registrar'') then';
begin
  if position('haiku_libro_pago_grupo_distribuido_v1' in cuerpo)>0 then return; end if;
  if position(marca in cuerpo)=0 then
    raise exception 'El helper de distribución cambió; revisar la migración antes de aplicar';
  end if;
  cuerpo := replace(cuerpo,marca,E'begin\n  if d->>''tipo'' = ''grupo_alojamiento'' then\n    return private.haiku_libro_pago_grupo_distribuido_v1(p_reserva_id,p_argumentos,p_origen,p_manual);\n  end if;\n  if auth.uid() is null or not private.haiku_tiene_permiso(''pagos.registrar'') then');
  execute cuerpo;
end;
$migration$;

create or replace function public.haiku_libro_distribucion_capacidad_v1()
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $function$
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  return jsonb_build_object('version',2,'modos',jsonb_build_array('estadia_partes','grupo_alojamiento'));
end;
$function$;
revoke all on function public.haiku_libro_distribucion_capacidad_v1() from public,anon;
grant execute on function public.haiku_libro_distribucion_capacidad_v1() to authenticated;
