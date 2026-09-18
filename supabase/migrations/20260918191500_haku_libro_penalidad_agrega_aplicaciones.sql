-- Un comprobante de una reserva conjunta puede incluir el alojamiento de cada
-- cabaña y la penalidad 10% que ya está distribuida como ajustes activos.
-- La operación sólo procede cuando el comprobante salda exactamente el grupo.
create or replace function private.haiku_libro_pago_grupo_distribuido_v1(
  p_reserva_id uuid, p_argumentos jsonb, p_origen jsonb, p_manual boolean
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  d jsonb := p_origen->'distribucion_manual';
  partes jsonb := d->'componentes';
  parte jsonb;
  cantidad integer;
  cantidad_alojamiento integer := 0;
  cantidad_penalidad integer := 0;
  grupo uuid;
  grupo_real uuid;
  titular text;
  reserva_parte uuid;
  estadia_parte uuid;
  cabana_parte integer;
  coincidencias integer;
  total bigint := 0;
  monto bigint;
  monto_penalidad bigint := 0;
  restante bigint;
  aplicado bigint := 0;
  saldo_grupo bigint := 0;
  ajuste_total bigint := 0;
  operaciones_ajuste integer := 0;
  aplicaciones jsonb := '[]'::jsonb;
  aplicaciones_agrupadas jsonb := '[]'::jsonb;
  pendientes jsonb := '[]'::jsonb;
  cargo record;
  pago jsonb;
begin
  if auth.uid() is null or not private.haiku_tiene_permiso('pagos.registrar') then
    raise exception 'Sin permiso para registrar pagos';
  end if;
  cantidad := case when jsonb_typeof(partes)='array' then jsonb_array_length(partes) else 0 end;
  if p_manual is distinct from true
     or d->>'tipo' not in ('grupo_alojamiento','grupo_alojamiento_penalidad')
     or cantidad not in (2,3) or nullif(d->>'id','') is null then
    raise exception 'El comprobante de grupo requiere todas sus partes aprobadas explícitamente';
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
  if (select count(distinct x->>'item_id') from jsonb_array_elements(partes) x) <> cantidad
     or (select count(distinct concat(x->'origen'->>'hoja','!',x->'origen'->>'celda')) from jsonb_array_elements(partes) x) <> cantidad
     or (select count(distinct x->>'reserva_id') from jsonb_array_elements(partes) x) <> 2
     or (select count(distinct x->>'estadia_id') from jsonb_array_elements(partes) x) <> 2
     or (select count(distinct x->>'cabana') from jsonb_array_elements(partes) x) <> 2 then
    raise exception 'El comprobante repite una cabaña, reserva, estadía o fuente';
  end if;

  lock table public.cargos in share row exclusive mode;
  lock table public.cargo_ajustes in share row exclusive mode;
  lock table public.pago_aplicaciones in share row exclusive mode;
  for parte in select value from jsonb_array_elements(partes) loop
    if (parte->>'aprobado_manualmente')::boolean is distinct from true
       or coalesce(parte->>'monto','') !~ '^[1-9][0-9]*$'
       or parte->>'moneda' is distinct from 'CLP'
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
       or regexp_replace(translate(lower(parte->>'titular_reserva'),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
          is distinct from regexp_replace(translate(lower(titular),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
       or regexp_replace(translate(lower(parte->>'titular'),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
          is distinct from regexp_replace(translate(lower(d->>'titular_pago'),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g') then
      raise exception 'Datos incompletos o incompatibles en una parte del comprobante de grupo';
    end if;
    if (case parte->>'medio_pago' when 'credito' then 'tarjeta_credito' when 'debito' then 'tarjeta_debito'
        else parte->>'medio_pago' end) is distinct from p_argumentos->>'p_medio_pago' then
      raise exception 'Medios incompatibles en el comprobante de grupo';
    end if;
    monto := (parte->>'monto')::bigint;
    if parte->>'tipo_movimiento' = 'alojamiento' then
      if (parte->>'pago_recibido')::boolean is distinct from true
         or parte->>'estado_pago' is distinct from 'registrado_en_libro' then
        raise exception 'El Libro no confirma una parte de alojamiento como pagada';
      end if;
      cantidad_alojamiento := cantidad_alojamiento+1;
    elsif parte->>'tipo_movimiento' = 'penalidad' then
      if d->>'tipo' is distinct from 'grupo_alojamiento_penalidad'
         or coalesce(parte->>'penalidad_porcentaje','') <> '10'
         or coalesce(parte->>'monto_penalidad','') !~ '^[1-9][0-9]*$'
         or (parte->>'monto_penalidad')::bigint is distinct from monto
         or lower(parte->>'texto_original') not like '%penalidad%' then
        raise exception 'La parte de penalidad no coincide con el cargo 10%% del Libro';
      end if;
      cantidad_penalidad := cantidad_penalidad+1;
      monto_penalidad := monto_penalidad+monto;
    else
      raise exception 'El comprobante grupal contiene un concepto no permitido';
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
    total := total+monto;
    if parte->>'tipo_movimiento' = 'alojamiento' then
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
    end if;
  end loop;
  if cantidad_alojamiento<>2
     or d->>'tipo'='grupo_alojamiento' and (cantidad<>2 or cantidad_penalidad<>0)
     or d->>'tipo'='grupo_alojamiento_penalidad' and (cantidad<>3 or cantidad_penalidad<>1) then
    raise exception 'La composición del comprobante grupal no es válida';
  end if;
  if total is distinct from (p_argumentos->>'p_monto')::bigint or total is distinct from (d->>'total')::bigint then
    raise exception 'El total del comprobante no coincide con sus partes';
  end if;
  if exists(select 1 from jsonb_array_elements(partes) x where
    replace(substring(lower(x->>'texto_original') from 'monto\s*:?\s*\$?\s*([0-9.]+)'),'.','')::bigint <> total) then
    raise exception 'El total declarado en el Libro no coincide con el comprobante de grupo';
  end if;

  if d->>'tipo'='grupo_alojamiento_penalidad' then
    if jsonb_array_length(pendientes)>0 or monto_penalidad is distinct from (d->>'penalidad_monto')::bigint
       or coalesce(d->>'penalidad_porcentaje','')<>'10' then
      raise exception 'El alojamiento o la penalidad del comprobante no pueden distribuirse por completo';
    end if;
    select count(distinct ca.operacion_id),coalesce(sum(ca.monto),0)
      into operaciones_ajuste,ajuste_total
    from public.cargo_ajustes ca
    join public.cargos c on c.id=ca.cargo_id
    join public.reservas r on r.id=c.reserva_id
    where r.grupo_reserva_id=grupo and c.tipo_cargo='alojamiento' and c.estado='activo'
      and ca.estado='activo' and ca.signo=1 and ca.tipo_ajuste='cargo_modificacion' and ca.porcentaje=10;
    select coalesce(sum(ec.saldo_cargo),0) into saldo_grupo
    from public.vista_estado_cargos ec
    join public.reservas r on r.id=ec.reserva_id
    where r.grupo_reserva_id=grupo and ec.tipo_cargo='alojamiento' and ec.estado='activo' and ec.saldo_cargo>0;
    if operaciones_ajuste<>1 or ajuste_total is distinct from monto_penalidad
       or saldo_grupo is distinct from total or saldo_grupo-aplicado is distinct from monto_penalidad then
      raise exception 'La penalidad o el saldo del grupo cambió; vuelve a preparar antes de aprobar';
    end if;
    restante := monto_penalidad;
    for cargo in
      select ec.cargo_id,ec.saldo_cargo-coalesce((
        select sum((x->>'monto')::bigint) from jsonb_array_elements(aplicaciones) x
        where (x->>'cargo_id')::uuid=ec.cargo_id
      ),0) as saldo_cargo
      from public.vista_estado_cargos ec
      join public.cargos c on c.id=ec.cargo_id
      join public.reservas r on r.id=ec.reserva_id
      where r.grupo_reserva_id=grupo and ec.tipo_cargo='alojamiento' and ec.estado='activo' and ec.saldo_cargo>0
      order by c.creado_en,ec.cargo_id
    loop
      exit when restante=0;
      if cargo.saldo_cargo<=0 then continue; end if;
      monto := least(restante,cargo.saldo_cargo);
      aplicaciones := aplicaciones || jsonb_build_array(jsonb_build_object('cargo_id',cargo.cargo_id,'monto',monto));
      restante := restante-monto;
      aplicado := aplicado+monto;
    end loop;
    if restante<>0 or aplicado<>total then
      raise exception 'No fue posible distribuir exactamente la penalidad existente';
    end if;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('cargo_id',agrupada.cargo_id,'monto',agrupada.monto)
    order by agrupada.cargo_id::text
  ),'[]'::jsonb)
    into aplicaciones_agrupadas
  from (
    select (x->>'cargo_id')::uuid as cargo_id, sum((x->>'monto')::bigint)::bigint as monto
    from jsonb_array_elements(aplicaciones) x
    group by (x->>'cargo_id')::uuid
  ) agrupada;
  aplicaciones := aplicaciones_agrupadas;

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

do $migration$
declare
  cuerpo text := replace(pg_get_functiondef('private.haiku_libro_pago_distribuido_v1(uuid,jsonb,jsonb,boolean)'::regprocedure),E'\r','');
  anterior text := E'if d->>''tipo'' = ''grupo_alojamiento'' then';
  nuevo text := E'if d->>''tipo'' in (''grupo_alojamiento'',''grupo_alojamiento_penalidad'') then';
begin
  if position(nuevo in cuerpo)>0 then return; end if;
  if position(anterior in cuerpo)=0 then
    raise exception 'El despacho de comprobantes grupales cambió; revisar antes de aplicar';
  end if;
  execute replace(cuerpo,anterior,nuevo);
end;
$migration$;

create or replace function public.haiku_libro_distribucion_capacidad_v1()
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $function$
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  return jsonb_build_object('version',3,'modos',jsonb_build_array(
    'estadia_partes','grupo_alojamiento','grupo_alojamiento_penalidad'));
end;
$function$;
revoke all on function public.haiku_libro_distribucion_capacidad_v1() from public,anon;
grant execute on function public.haiku_libro_distribucion_capacidad_v1() to authenticated;
