-- FASE 4C: writer privado y atómico para pagos del Libro con destinos de servicio explícitos.
-- No cambia haiku_registrar_pago ni haiku_incorporar_libro_v1. Usa una RPC idempotente separada.

create or replace function private.haiku_libro_lock_key_v1(p_scope text,p_value text)
returns bigint language sql immutable security invoker
set search_path=pg_catalog
as $function$
  select ('x'||substr(md5(coalesce(p_scope,'')||':'||coalesce(p_value,'')),1,16))::bit(64)::bigint
$function$;
revoke all on function private.haiku_libro_lock_key_v1(text,text)
  from public,anon,authenticated;

-- Todos los writers actuales participan sin cambiar sus contratos. Los triggers
-- nunca esperan un advisory lock después de que PostgreSQL pudo bloquear la fila:
-- si otra operación financiera de la misma reserva está activa, abortan con un
-- mensaje reintentable. Esto evita el ciclo fila -> advisory / advisory -> fila.
create or replace function private.haiku_libro_lock_reserva_write_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $function$
declare
  v_ids uuid[]:=array[]::uuid[];
  v_id uuid;
begin
  if tg_op<>'INSERT' and old.reserva_id is not null then v_ids:=array_append(v_ids,old.reserva_id); end if;
  if tg_op<>'DELETE' and new.reserva_id is not null then v_ids:=array_append(v_ids,new.reserva_id); end if;
  for v_id in select distinct unnest(v_ids) order by 1 loop
    if not pg_try_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',v_id::text)) then
      raise exception 'La reserva tiene otra operación financiera en curso; vuelve a intentar';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

create or replace function private.haiku_libro_lock_pago_write_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $function$
declare
  v_ids uuid[]:=array[]::uuid[];
  v_tokens text[]:=array[]::text[];
  v_id uuid;
  v_token text;
begin
  if tg_op<>'INSERT' then
    if old.reserva_id is not null then v_ids:=array_append(v_ids,old.reserva_id); end if;
    if nullif(regexp_replace(upper(coalesce(old.codigo_autorizacion,'')),'[^0-9A-Z]','','g'),'') is not null then
      v_tokens:=array_append(v_tokens,'codaut:'||regexp_replace(upper(old.codigo_autorizacion),'[^0-9A-Z]','','g'));
    end if;
    if nullif(regexp_replace(upper(coalesce(old.folio,'')),'[^0-9A-Z]','','g'),'') is not null
       and nullif(regexp_replace(upper(coalesce(old.datos_origen->>'bovtar',old.bove,'')),'[^0-9A-Z]','','g'),'') is not null then
      v_tokens:=array_append(v_tokens,'voucher:'||regexp_replace(upper(old.folio),'[^0-9A-Z]','','g')||':'||
        regexp_replace(upper(coalesce(old.datos_origen->>'bovtar',old.bove)),'[^0-9A-Z]','','g'));
    end if;
  end if;
  if tg_op<>'DELETE' then
    if new.reserva_id is not null then v_ids:=array_append(v_ids,new.reserva_id); end if;
    if nullif(regexp_replace(upper(coalesce(new.codigo_autorizacion,'')),'[^0-9A-Z]','','g'),'') is not null then
      v_tokens:=array_append(v_tokens,'codaut:'||regexp_replace(upper(new.codigo_autorizacion),'[^0-9A-Z]','','g'));
    end if;
    if nullif(regexp_replace(upper(coalesce(new.folio,'')),'[^0-9A-Z]','','g'),'') is not null
       and nullif(regexp_replace(upper(coalesce(new.datos_origen->>'bovtar',new.bove,'')),'[^0-9A-Z]','','g'),'') is not null then
      v_tokens:=array_append(v_tokens,'voucher:'||regexp_replace(upper(new.folio),'[^0-9A-Z]','','g')||':'||
        regexp_replace(upper(coalesce(new.datos_origen->>'bovtar',new.bove)),'[^0-9A-Z]','','g'));
    end if;
  end if;
  for v_id in select distinct unnest(v_ids) order by 1 loop
    if not pg_try_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',v_id::text)) then
      raise exception 'La reserva tiene otra operación financiera en curso; vuelve a intentar';
    end if;
  end loop;
  for v_token in select distinct unnest(v_tokens) order by 1 loop
    if not pg_try_advisory_xact_lock(private.haiku_libro_lock_key_v1('pago_identificador',v_token)) then
      raise exception 'El identificador de pago tiene otra operación en curso; vuelve a intentar';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

create or replace function private.haiku_libro_lock_aplicacion_write_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $function$
declare
  v_cargos uuid[]:=array[]::uuid[];
  v_id uuid;
begin
  if tg_op<>'INSERT' and old.cargo_id is not null then v_cargos:=array_append(v_cargos,old.cargo_id); end if;
  if tg_op<>'DELETE' and new.cargo_id is not null then v_cargos:=array_append(v_cargos,new.cargo_id); end if;
  for v_id in
    select distinct c.reserva_id from public.cargos c
    where c.id=any(v_cargos) and c.reserva_id is not null order by 1
  loop
    if not pg_try_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',v_id::text)) then
      raise exception 'La reserva tiene otra operación financiera en curso; vuelve a intentar';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.haiku_libro_lock_reserva_write_v1() from public,anon,authenticated;
revoke all on function private.haiku_libro_lock_pago_write_v1() from public,anon,authenticated;
revoke all on function private.haiku_libro_lock_aplicacion_write_v1() from public,anon,authenticated;

drop trigger if exists trg_haiku_libro_lock_servicios_v1 on public.servicios;
create trigger trg_haiku_libro_lock_servicios_v1 before insert or update or delete on public.servicios
for each row execute function private.haiku_libro_lock_reserva_write_v1();
drop trigger if exists trg_haiku_libro_lock_cargos_v1 on public.cargos;
create trigger trg_haiku_libro_lock_cargos_v1 before insert or update or delete on public.cargos
for each row execute function private.haiku_libro_lock_reserva_write_v1();
drop trigger if exists trg_haiku_libro_lock_pagos_v1 on public.pagos;
create trigger trg_haiku_libro_lock_pagos_v1 before insert or update or delete on public.pagos
for each row execute function private.haiku_libro_lock_pago_write_v1();
drop trigger if exists trg_haiku_libro_lock_aplicaciones_v1 on public.pago_aplicaciones;
create trigger trg_haiku_libro_lock_aplicaciones_v1 before insert or update or delete on public.pago_aplicaciones
for each row execute function private.haiku_libro_lock_aplicacion_write_v1();

create or replace function private.haiku_libro_concepto_servicio_canon_v1(p_texto text)
returns text language plpgsql immutable security invoker
set search_path = pg_catalog
as $function$
declare
  t text := regexp_replace(translate(lower(coalesce(p_texto,'')),
    'áéíóúüñ','aeiouun'),'[^a-z0-9]+',' ','g');
begin
  t := btrim(t);
  if t = '' then return null; end if;
  if t ~ '\mlate[[:space:]]*(check[[:space:]]*)?out\M' or t ~ '\mlateout\M' then return 'late_checkout'; end if;
  if t ~ '\mearly[[:space:]]*(check[[:space:]]*)?in\M' or t ~ '\mearlyin\M' then return 'early_checkin'; end if;
  if t ~ '\mcama[[:space:]]+adicional\M' then return 'cama_adicional'; end if;
  if t ~ '\mlena\M' then return 'lena'; end if;
  if t ~ '\mmasaj' then return 'masaje'; end if;
  if t ~ '\mtonel\M' then return 'tinaja_tonel'; end if;
  if t ~ '\mjacuzzi\M' then return 'tinaja_jacuzzi'; end if;
  if t ~ '\mtinaja\M' then return 'tinaja'; end if;
  if t ~ '\mcuna\M' then return 'cuna'; end if;
  return null;
end;
$function$;
revoke all on function private.haiku_libro_concepto_servicio_canon_v1(text)
  from public, anon, authenticated;

create or replace function private.haiku_libro_pago_servicios_v1(
  p_reserva_id uuid,
  p_argumentos jsonb,
  p_origen jsonb,
  p_manual boolean
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  d jsonb := p_origen->'aplicaciones_servicio_v1';
  aplicaciones_esperadas jsonb := d->'aplicaciones';
  aplicacion jsonb;
  aplicaciones_registro jsonb := '[]'::jsonb;
  pago jsonb;
  reserva_estado text;
  v_cargo_id uuid;
  v_servicio_id uuid;
  v_monto bigint;
  monto_total bigint;
  suma bigint := 0;
  saldo_esperado bigint;
  aplicado_esperado bigint;
  cantidad_esperada integer;
  fecha_contexto date;
  fecha_servicio_esperada date;
  concepto_esperado text;
  concepto_actual text;
  saldo_actual bigint;
  aplicado_actual bigint;
  cantidad_actual integer;
  cargo_estado text;
  cargo_tipo text;
  cargo_reserva uuid;
  servicio_actual uuid;
  servicio_fecha date;
  servicio_total bigint;
  servicio_cobro text;
  servicio_estado text;
  candidatos integer;
  elegido boolean;
  pago_existente uuid;
  pago_existente_reserva uuid;
  pagos_existentes integer;
  reservas_existentes integer;
  v_token text;
  codaut text := nullif(btrim(coalesce(p_argumentos->>'p_codigo_autorizacion','')), '');
  folio text := nullif(btrim(coalesce(p_argumentos->>'p_folio','')), '');
  argumento_bove text := nullif(btrim(coalesce(p_argumentos->>'p_bove','')), '');
  bovtar text := nullif(btrim(coalesce(p_origen->>'bovtar','')), '');
  codaut_norm text;
  folio_norm text;
  bovtar_norm text;
begin
  if auth.uid() is null or not private.haiku_tiene_permiso('pagos.registrar') then
    raise exception 'Sin permiso para registrar pagos' using errcode='42501';
  end if;
  if p_manual is distinct from true then
    raise exception 'Las aplicaciones de servicio requieren aprobación explícita';
  end if;
  if coalesce((d->>'version')::integer,0) <> 1
     or jsonb_typeof(aplicaciones_esperadas) is distinct from 'array'
     or jsonb_array_length(aplicaciones_esperadas) < 1
     or jsonb_array_length(aplicaciones_esperadas) > 20 then
    raise exception 'Contrato de aplicaciones de servicio inválido';
  end if;
  begin
    monto_total := (p_argumentos->>'p_monto')::bigint;
  exception when others then
    raise exception 'Monto total inválido';
  end;
  if monto_total <= 0 or d->>'moneda' is distinct from 'CLP'
     or (d->>'reserva_id')::uuid is distinct from p_reserva_id
     or (d->>'monto_total')::bigint is distinct from monto_total then
    raise exception 'Reserva, moneda o total incompatibles con la propuesta';
  end if;
  codaut_norm:=nullif(regexp_replace(upper(coalesce(codaut,'')),'[^0-9A-Z]','','g'),'');
  folio_norm:=nullif(regexp_replace(upper(coalesce(folio,'')),'[^0-9A-Z]','','g'),'');
  bovtar_norm:=nullif(regexp_replace(upper(coalesce(bovtar,'')),'[^0-9A-Z]','','g'),'');
  if argumento_bove is not null and (bovtar_norm is null or
     nullif(regexp_replace(upper(argumento_bove),'[^0-9A-Z]','','g'),'') is distinct from bovtar_norm) then
    raise exception 'p_bove sólo puede transportar el mismo BOVTAR del comprobante; un BOVE administrativo no identifica pagos';
  end if;
  if codaut_norm is null and (folio_norm is null or bovtar_norm is null) then
    if p_argumentos->>'p_medio_pago'='efectivo' then
      raise exception 'Efectivo sin identificador transaccional fuerte no está habilitado en FASE 4C';
    end if;
    raise exception 'El pago requiere CodAut o Folio + BOVTAR como identificador transaccional fuerte';
  end if;
  if (select count(distinct x->>'cargo_id') from jsonb_array_elements(aplicaciones_esperadas) x)
       <> jsonb_array_length(aplicaciones_esperadas) then
    raise exception 'Una transacción no puede reutilizar el mismo cargo';
  end if;

  -- Orden único del helper: advisory de reserva -> advisory de identificadores
  -- -> filas. Los triggers de writers ya iniciados no esperan: usan try-lock y
  -- abortan, liberando cualquier fila que hubieran alcanzado a bloquear.
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_reserva_id::text));
  for v_token in
    select token from unnest(array[
      case when codaut_norm is not null then 'codaut:'||codaut_norm end,
      case when folio_norm is not null and bovtar_norm is not null then 'voucher:'||folio_norm||':'||bovtar_norm end
    ]) as t(token) where token is not null order by token
  loop
    perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('pago_identificador',v_token));
  end loop;

  select r.estado_reserva into reserva_estado
  from public.reservas r where r.id=p_reserva_id for update;
  if not found or reserva_estado in ('cancelada','no_show') then
    raise exception 'La reserva destino cambió o dejó de estar disponible; vuelve a preparar';
  end if;

  perform 1 from public.catalogo_servicios cs join public.servicios s on s.catalogo_servicio_id=cs.id
    where s.reserva_id=p_reserva_id order by cs.id for share of cs;
  perform 1 from public.servicios s where s.reserva_id=p_reserva_id order by s.id for update;
  perform 1 from public.cargos c where c.reserva_id=p_reserva_id order by c.id for update;
  perform 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id
    where c.reserva_id=p_reserva_id order by pa.id for update of pa;
  perform 1 from public.pagos p where p.reserva_id=p_reserva_id order by p.id for update;

  -- Defensa adicional a la deduplicación que haiku_incorporar_libro_v1 ya
  -- ejecuta con los mismos identificadores. Sólo confirmado acredita existencia.
  with coincidencias as (
    select p.* from public.pagos p
    where p.tipo_movimiento='pago' and p.estado='confirmado' and (
      (codaut_norm is not null and regexp_replace(upper(coalesce(p.codigo_autorizacion,'')),'[^0-9A-Z]','','g')=codaut_norm)
      or (folio_norm is not null and bovtar_norm is not null
        and regexp_replace(upper(coalesce(p.folio,'')),'[^0-9A-Z]','','g')=folio_norm
        and regexp_replace(upper(coalesce(p.datos_origen->>'bovtar',p.bove,'')),'[^0-9A-Z]','','g')=bovtar_norm)
    )
  )
  select (array_agg(id order by creado_en,id))[1],
         (array_agg(reserva_id order by creado_en,id))[1],
         count(*)::integer,count(distinct reserva_id)::integer
    into pago_existente,pago_existente_reserva,pagos_existentes,reservas_existentes
  from coincidencias;
  if pagos_existentes>0 then
    if reservas_existentes<>1 or pago_existente_reserva is distinct from p_reserva_id then
      raise exception 'El identificador fuerte ahora pertenece a otra reserva; vuelve a preparar';
    end if;
    if pagos_existentes<>1 then
      raise exception 'El identificador fuerte coincide con múltiples pagos confirmados; requiere revisión';
    end if;
    return jsonb_build_object('ya_existe',true,'pago_id',pago_existente,'monto',monto_total,'aplicado',0,'sin_aplicar',0);
  end if;

  for aplicacion in select value from jsonb_array_elements(aplicaciones_esperadas) loop
    begin
      v_cargo_id := (aplicacion->>'cargo_id')::uuid;
      v_servicio_id := (aplicacion->>'servicio_id')::uuid;
      v_monto := (aplicacion->>'monto')::bigint;
      saldo_esperado := (aplicacion->>'saldo_esperado')::bigint;
      aplicado_esperado := (aplicacion->>'aplicado_esperado')::bigint;
      cantidad_esperada := (aplicacion->>'cantidad_aplicaciones_esperada')::integer;
      fecha_contexto := nullif(aplicacion->>'fecha_contexto','')::date;
      fecha_servicio_esperada := (aplicacion->>'fecha_servicio_esperada')::date;
    exception when others then
      raise exception 'Aplicación de servicio incompleta o inválida';
    end;
    concepto_esperado := aplicacion->>'concepto_canon';
    if v_cargo_id is null or v_servicio_id is null or v_monto<=0 or saldo_esperado<=0
       or aplicado_esperado<0 or cantidad_esperada<0
       or concepto_esperado not in ('late_checkout','early_checkin','cama_adicional','lena','masaje','tinaja_tonel','tinaja_jacuzzi','tinaja','cuna') then
      raise exception 'Aplicación de servicio incompleta o incompatible';
    end if;

    select c.reserva_id,c.tipo_cargo,c.estado,s.id,s.fecha_servicio,s.total,s.tipo_cobro,s.estado_servicio,
           ec.saldo_cargo,ec.aplicado_neto,
           private.haiku_libro_concepto_servicio_canon_v1(concat_ws(' ',ec.concepto,cs.codigo,cs.nombre,cs.categoria))
      into cargo_reserva,cargo_tipo,cargo_estado,servicio_actual,servicio_fecha,servicio_total,
           servicio_cobro,servicio_estado,saldo_actual,aplicado_actual,concepto_actual
    from public.cargos c
    join public.vista_estado_cargos ec on ec.cargo_id=c.id
    join public.servicios s on s.id=c.servicio_id
    left join public.catalogo_servicios cs on cs.id=s.catalogo_servicio_id
    where c.id=v_cargo_id
    for update of c,s;
    if not found or cargo_reserva is distinct from p_reserva_id or cargo_tipo is distinct from 'servicio'
       or cargo_estado is distinct from 'activo' or servicio_actual is distinct from v_servicio_id
       or servicio_fecha is distinct from fecha_servicio_esperada
       or servicio_total is null or servicio_total<=0
       or coalesce(servicio_cobro,'normal')='cortesia'
       or regexp_replace(lower(coalesce(servicio_estado,'')),'[^a-z0-9]+','','g') ~ '(cancelad|noshow|anulad)'
       or not (concepto_actual=concepto_esperado or
         (concepto_esperado='tinaja' and concepto_actual in ('tinaja','tinaja_tonel','tinaja_jacuzzi'))) then
      raise exception 'El cargo o servicio cambió y ya no corresponde a la propuesta; vuelve a preparar';
    end if;
    select count(*) into cantidad_actual
    from public.pago_aplicaciones pa join public.pagos p on p.id=pa.pago_id
    where pa.cargo_id=v_cargo_id and p.estado='confirmado';
    if saldo_actual is distinct from saldo_esperado or aplicado_actual is distinct from aplicado_esperado
       or cantidad_actual is distinct from cantidad_esperada then
      raise exception 'El saldo o las aplicaciones del cargo cambiaron; vuelve a preparar';
    end if;
    if v_monto>saldo_actual then
      raise exception 'La aplicación supera el saldo actual del cargo';
    end if;

    -- Misma regla que FASE 4: si existe algún candidato en la fecha de contexto,
    -- sólo esos compiten; en caso contrario compiten todos los del concepto.
    with posibles as (
      select ec2.cargo_id,s2.fecha_servicio,
        private.haiku_libro_concepto_servicio_canon_v1(concat_ws(' ',ec2.concepto,cs2.codigo,cs2.nombre,cs2.categoria)) canon
      from public.vista_estado_cargos ec2
      join public.cargos c2 on c2.id=ec2.cargo_id
      join public.servicios s2 on s2.id=c2.servicio_id
      left join public.catalogo_servicios cs2 on cs2.id=s2.catalogo_servicio_id
      where ec2.reserva_id=p_reserva_id and ec2.tipo_cargo='servicio'
        and ec2.estado='activo' and ec2.saldo_cargo>0
        and s2.total>0 and coalesce(s2.tipo_cobro,'normal')<>'cortesia'
        and regexp_replace(lower(coalesce(s2.estado_servicio,'')),'[^a-z0-9]+','','g') !~ '(cancelad|noshow|anulad)'
    ), compatibles as (
      select * from posibles p where p.canon=concepto_esperado or
        (concepto_esperado='tinaja' and p.canon in ('tinaja','tinaja_tonel','tinaja_jacuzzi'))
    ), fecha as (
      select count(*) filter(where fecha_contexto is not null and fecha_servicio=fecha_contexto) exactos
      from compatibles
    ), finales as (
      select c.* from compatibles c cross join fecha f
      where f.exactos=0 or c.fecha_servicio=fecha_contexto
    )
    select count(*),coalesce(bool_or(finales.cargo_id=v_cargo_id),false)
      into candidatos,elegido from finales;
    if candidatos<>1 or elegido is distinct from true then
      raise exception 'El destino dejó de ser único; vuelve a preparar';
    end if;

    suma := suma+v_monto;
    aplicaciones_registro := aplicaciones_registro ||
      jsonb_build_array(jsonb_build_object('cargo_id',v_cargo_id,'monto',v_monto));
  end loop;

  if suma is distinct from monto_total then
    raise exception 'La suma de aplicaciones debe coincidir exactamente con el monto del pago';
  end if;
  pago := public.haiku_registrar_pago(
    p_reserva_id=>p_reserva_id,
    p_monto=>monto_total,
    p_medio_pago=>p_argumentos->>'p_medio_pago',
    p_etapa_operativa=>'abono',
    p_fecha_pago=>(p_argumentos->>'p_fecha_pago')::timestamptz,
    p_folio=>folio,
    p_codigo_autorizacion=>codaut,
    p_bove=>bovtar,
    p_referencia_externa=>p_argumentos->>'p_referencia_externa',
    p_observaciones=>p_argumentos->>'p_observaciones',
    p_aplicaciones=>aplicaciones_registro,
    p_modo_aplicacion=>'ninguno'
  );
  if (pago->>'aplicado')::bigint is distinct from monto_total
     or (pago->>'sin_aplicar')::bigint is distinct from 0 then
    raise exception 'Proyecto H no aplicó el total completo; se revierte la operación';
  end if;
  return pago;
end;
$function$;
revoke all on function private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean)
  from public, anon, authenticated;

-- RPC separada: evita reescribir haiku_incorporar_libro_v1 y conserva una
-- idempotencia propia por operación, usuario y hash de la propuesta exacta.
create table if not exists private.haiku_libro_pagos_servicio_operaciones(
  operacion_id uuid primary key,
  usuario_id uuid not null,
  solicitud_hash text not null,
  resultado jsonb,
  completado_en timestamptz
);
revoke all on table private.haiku_libro_pagos_servicio_operaciones from public,anon,authenticated;

create or replace function public.haiku_incorporar_pago_servicios_libro_v1(
  p_operacion_id uuid,
  p_item jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private
as $function$
declare
  v_usuario uuid:=auth.uid();
  v_hash text;
  v_registro private.haiku_libro_pagos_servicio_operaciones%rowtype;
  v_reserva uuid;
  v_argumentos jsonb;
  v_origen jsonb;
  v_manual boolean;
  v_pago jsonb;
  v_pago_id uuid;
  v_resultado jsonb;
begin
  if v_usuario is null then raise exception 'Debe iniciar sesión' using errcode='42501'; end if;
  if p_operacion_id is null or jsonb_typeof(p_item) is distinct from 'object'
     or nullif(p_item->>'item_id','') is null then
    raise exception 'Operación o propuesta de pago inválida';
  end if;
  v_hash:=md5(p_item::text);
  insert into private.haiku_libro_pagos_servicio_operaciones(operacion_id,usuario_id,solicitud_hash)
    values(p_operacion_id,v_usuario,v_hash) on conflict(operacion_id) do nothing;
  select * into v_registro from private.haiku_libro_pagos_servicio_operaciones
    where operacion_id=p_operacion_id for update;
  if v_registro.usuario_id is distinct from v_usuario then
    raise exception 'La operación pertenece a otro usuario' using errcode='42501';
  end if;
  if v_registro.solicitud_hash is distinct from v_hash then
    raise exception 'La operación ya fue usada con otra propuesta';
  end if;
  if v_registro.resultado is not null then
    return v_registro.resultado||jsonb_build_object('reintento',true);
  end if;

  begin
    v_reserva:=(p_item->>'reserva_id')::uuid;
    v_argumentos:=p_item->'argumentos';
    v_origen:=p_item->'datos_origen';
    v_manual:=(p_item->>'aprobado_manualmente')::boolean;
  exception when others then
    raise exception 'Propuesta de pago incompleta o inválida';
  end;
  if v_reserva is null or jsonb_typeof(v_argumentos) is distinct from 'object'
     or jsonb_typeof(v_origen) is distinct from 'object' then
    raise exception 'Propuesta de pago incompleta o inválida';
  end if;

  v_pago:=private.haiku_libro_pago_servicios_v1(v_reserva,v_argumentos,v_origen,v_manual);
  v_pago_id:=nullif(v_pago->>'pago_id','')::uuid;
  if coalesce((v_pago->>'ya_existe')::boolean,false) then
    v_resultado:=jsonb_build_object('ok',true,'operacion_id',p_operacion_id,'reintento',false,
      'pagos_creados',0,'omitidos',1,'pago_id',v_pago_id,'motivo','El pago confirmado ya existe en la misma reserva');
  else
    update public.pagos
    set pagador_nombre=coalesce((select r.titular_nombre from public.reservas r where r.id=v_reserva),pagador_nombre),
        datos_origen=coalesce(datos_origen,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
          'contexto','haku_libro_pago_servicios_v1','operacion_id',p_operacion_id,
          'item_id',p_item->>'item_id','bovtar',v_origen->>'bovtar',
          'fecha_bloque',v_origen->>'fecha_bloque','origen_libro',v_origen->'origen',
          'aplicaciones_servicio_v1',v_origen->'aplicaciones_servicio_v1',
          'aprobado_manualmente',v_manual))
    where id=v_pago_id;
    v_resultado:=jsonb_build_object('ok',true,'operacion_id',p_operacion_id,'reintento',false,
      'pagos_creados',1,'omitidos',0,'pago_id',v_pago_id,
      'monto',(v_pago->>'monto')::bigint,'aplicado',(v_pago->>'aplicado')::bigint,'sin_aplicar',(v_pago->>'sin_aplicar')::bigint);
  end if;
  update private.haiku_libro_pagos_servicio_operaciones
    set resultado=v_resultado,completado_en=now() where operacion_id=p_operacion_id;
  return v_resultado;
end;
$function$;
revoke all on function public.haiku_incorporar_pago_servicios_libro_v1(uuid,jsonb) from public,anon;
grant execute on function public.haiku_incorporar_pago_servicios_libro_v1(uuid,jsonb) to authenticated;

-- Un frontend futuro debe comprobar esta capacidad antes de habilitar Confirmar.
create or replace function public.haiku_libro_aplicaciones_servicio_capacidad_v1()
returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public
as $function$
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  return jsonb_build_object('version',1,'contrato','aplicaciones_servicio_v1',
    'rpc','haiku_incorporar_pago_servicios_libro_v1','efectivo_sin_identificador',false);
end;
$function$;
revoke all on function public.haiku_libro_aplicaciones_servicio_capacidad_v1() from public,anon;
grant execute on function public.haiku_libro_aplicaciones_servicio_capacidad_v1() to authenticated;

comment on function private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean) is
  'Registra un pago del Libro con aplicaciones explícitas sólo después de revalidar y bloquear reserva, servicios, cargos, saldos, aplicaciones e identificadores.';
comment on function public.haiku_incorporar_pago_servicios_libro_v1(uuid,jsonb) is
  'Writer idempotente FASE 4C: un pago confirmado con CodAut o Folio+BOVTAR y N aplicaciones explícitas de servicio.';
comment on function public.haiku_libro_aplicaciones_servicio_capacidad_v1() is
  'Handshake read-only para el contrato backend aplicaciones_servicio_v1.';
