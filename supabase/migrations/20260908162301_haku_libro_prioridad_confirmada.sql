-- Libro -> Proyecto H: patches reviewed by the user, applied atomically by the
-- existing authenticated batch RPC. No guest or payment data is changed by DDL.
create or replace function private.haiku_libro_validar_parche_v1(p_actual jsonb, p_parche jsonb, p_campos text[])
returns void language plpgsql security invoker set search_path = '' as $fn$
declare k text; v jsonb; a jsonb;
begin
  if jsonb_typeof(p_parche->'antes') is distinct from 'object' or jsonb_typeof(p_parche->'despues') is distinct from 'object' then
    raise exception 'Falta el detalle revisado de la actualización';
  end if;
  for k,v in select key,value from jsonb_each(p_parche->'despues') loop
    if not (k=any(p_campos)) or not ((p_parche->'antes') ? k) or v='null'::jsonb or v='""'::jsonb then
      raise exception 'Campo no admitido o sin valor del Libro: %',k;
    end if;
    a:=coalesce(p_actual->k,'null'::jsonb);
    if k='fecha_pago' and a<>'null'::jsonb then
      if (p_actual->>k)::timestamptz = (p_parche->'antes'->>k)::timestamptz or (p_actual->>k)::timestamptz = (p_parche->'despues'->>k)::timestamptz then continue; end if;
    elsif a=coalesce(p_parche->'antes'->k,'null'::jsonb) or a=v then continue;
    end if;
    raise exception 'Proyecto H cambió en %. Vuelve a preparar y confirmar los valores nuevos.',k;
  end loop;
end;
$fn$;
revoke all on function private.haiku_libro_validar_parche_v1(jsonb,jsonb,text[]) from public,anon,authenticated;

create or replace function private.haiku_libro_actualizar_v1(p_item jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog,public,private as $fn$
declare
  v_r public.reservas%rowtype; v_e public.reserva_estadias%rowtype;
  v_nr public.reservas%rowtype; v_ne public.reserva_estadias%rowtype;
  v_p public.pagos%rowtype; v_np public.pagos%rowtype;
  v_patch jsonb; v_before jsonb; v_cab smallint; v_price bigint;
  v_aplicaciones jsonb := '[]'::jsonb; v_record record; v_exceso bigint; v_devuelto bigint;
  v_count integer; v_fecha date; v_ids jsonb; v_date_change boolean;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión' using errcode='42501'; end if;
  if p_item->>'tipo'='reserva_actualizar' then
    if not private.haiku_tiene_permiso('reservas.editar') then raise exception 'Sin permiso para editar reservas' using errcode='42501'; end if;
    select * into v_r from public.reservas where id=(p_item->>'reserva_id')::uuid for update;
    if not found or v_r.estado_reserva in ('cancelada','no_show') then raise exception 'Reserva destino no editable'; end if;
    select * into v_e from public.reserva_estadias where id=(p_item->>'estadia_id')::uuid and reserva_id=v_r.id for update;
    if not found or v_e.estado_estadia in ('cancelada','no_show') then raise exception 'La estadía no pertenece a la reserva seleccionada'; end if;
    select numero,precio_base into v_cab,v_price from public.cabanas where id=v_e.cabana_id;
    perform private.haiku_libro_validar_parche_v1(to_jsonb(v_r),p_item->'reserva',array['titular_nombre','titular_numero_documento','titular_tipo_documento','correo_contacto','telefono_contacto','observaciones']);
    perform private.haiku_libro_validar_parche_v1(to_jsonb(v_e)||jsonb_build_object('cabana_numero',v_cab),p_item->'estadia',array['cabana_numero','fecha_ingreso','fecha_salida','tipo_estadia','adultos','ninos','mascotas','estado_estadia']);
    v_nr:=jsonb_populate_record(v_r,p_item->'reserva'->'despues');
    v_ne:=jsonb_populate_record(v_e,(p_item->'estadia'->'despues')-'cabana_numero');
    if (p_item->'estadia'->'despues') ? 'cabana_numero' then
      select id,numero,precio_base into v_ne.cabana_id,v_cab,v_price from public.cabanas where numero=(p_item->'estadia'->'despues'->>'cabana_numero')::smallint and activa;
      if not found then raise exception 'La cabaña del Libro no está disponible en el catálogo'; end if;
    end if;
    if v_ne.adultos<1 or v_ne.ninos<0 or v_ne.mascotas<0 then raise exception 'Ocupación inválida'; end if;
    if v_ne.estado_estadia not in ('pendiente','confirmada','hospedada','checked_out') then raise exception 'Estado del Libro no permitido'; end if;
    if not ((v_ne.tipo_estadia='alojamiento' and v_ne.fecha_salida>v_ne.fecha_ingreso) or (v_ne.tipo_estadia='fullday' and v_ne.fecha_salida=v_ne.fecha_ingreso)) then raise exception 'Fechas o tipo de estadía inválidos'; end if;
    if v_ne.fecha_salida-v_ne.fecha_ingreso>366 then raise exception 'Revisa una estadía de más de un año'; end if;
    if exists(select 1 from public.reserva_estadias e where e.id<>v_e.id and e.cabana_id=v_ne.cabana_id and e.estado_estadia not in ('cancelada','no_show') and
      ((e.fecha_ingreso < case when v_ne.tipo_estadia='fullday' then v_ne.fecha_salida+1 else v_ne.fecha_salida end)
       and ((case when e.tipo_estadia='fullday' then e.fecha_salida+1 else e.fecha_salida end)>v_ne.fecha_ingreso))) then
      raise exception 'La cabaña y fechas del Libro se superponen con otra estadía; no se guardó la selección';
    end if;
    v_date_change:=v_e.fecha_ingreso<>v_ne.fecha_ingreso or v_e.fecha_salida<>v_ne.fecha_salida or v_e.tipo_estadia<>v_ne.tipo_estadia;
    v_before:=jsonb_build_object('reserva',to_jsonb(v_r),'estadia',to_jsonb(v_e));
    -- Keep payment records intact. Allocations to nights removed by the reviewed
    -- date correction become available balance; retain their full audit snapshot.
    if v_date_change then
      if not private.haiku_tiene_permiso('pagos.verificar') then raise exception 'Corregir fechas requiere permiso para revisar la distribución de pagos' using errcode='42501'; end if;
      select coalesce(jsonb_agg(to_jsonb(pa)),'[]'::jsonb) into v_aplicaciones from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id
        left join public.estadia_noches n on n.id=c.estadia_noche_id where c.estadia_id=v_e.id and c.tipo_cargo='alojamiento'
        and (v_ne.tipo_estadia='fullday' or n.id is null or n.fecha<v_ne.fecha_ingreso or n.fecha>=v_ne.fecha_salida);
      delete from public.pago_aplicaciones where id in(select (x->>'id')::uuid from jsonb_array_elements(v_aplicaciones) x);
      update public.cargos c set estado='anulado' where c.estadia_id=v_e.id and c.tipo_cargo='alojamiento' and
        (v_ne.tipo_estadia='fullday' or c.estadia_noche_id is null or exists(select 1 from public.estadia_noches n where n.id=c.estadia_noche_id and (n.fecha<v_ne.fecha_ingreso or n.fecha>=v_ne.fecha_salida)));
      -- Rows with no active charge remain as history; the range guard permits them.
    end if;
    update public.reservas set titular_nombre=v_nr.titular_nombre,titular_numero_documento=v_nr.titular_numero_documento,
      titular_tipo_documento=v_nr.titular_tipo_documento,correo_contacto=v_nr.correo_contacto,telefono_contacto=v_nr.telefono_contacto,observaciones=v_nr.observaciones where id=v_r.id;
    -- Do not alter a shared guest record that also belongs to another reservation.
    if v_r.titular_huesped_id is not null and not exists(select 1 from public.reservas where id<>v_r.id and titular_huesped_id=v_r.titular_huesped_id) then
      update public.huespedes set nombre=v_nr.titular_nombre,numero_documento=v_nr.titular_numero_documento,tipo_documento=v_nr.titular_tipo_documento,
        correo=v_nr.correo_contacto,telefono=v_nr.telefono_contacto where id=v_r.titular_huesped_id;
    end if;
    update public.reserva_estadias set cabana_id=v_ne.cabana_id,fecha_ingreso=v_ne.fecha_ingreso,fecha_salida=v_ne.fecha_salida,
      tipo_estadia=v_ne.tipo_estadia,adultos=v_ne.adultos,ninos=v_ne.ninos,mascotas=v_ne.mascotas,estado_estadia=v_ne.estado_estadia,
      checkin_realizado_en=case when v_ne.estado_estadia in ('pendiente','confirmada') then null else checkin_realizado_en end,
      checkin_realizado_por=case when v_ne.estado_estadia in ('pendiente','confirmada') then null else checkin_realizado_por end,
      checkout_realizado_en=case when v_ne.estado_estadia<>'checked_out' then null else checkout_realizado_en end,
      checkout_realizado_por=case when v_ne.estado_estadia<>'checked_out' then null else checkout_realizado_por end where id=v_e.id;
    if v_date_change then
      if v_price is null or v_price<0 then raise exception 'Falta una tarifa base para las fechas nuevas'; end if;
      if v_ne.tipo_estadia='alojamiento' then
        v_fecha:=v_ne.fecha_ingreso;
        while v_fecha<v_ne.fecha_salida loop
          if not exists(select 1 from public.estadia_noches where estadia_id=v_e.id and fecha=v_fecha) then
            insert into public.estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values(v_e.id,v_fecha,v_price,'catalogo');
          else
            update public.estadia_noches set tarifa=tarifa where estadia_id=v_e.id and fecha=v_fecha;
          end if;
          v_fecha:=v_fecha+1;
        end loop;
      else
        insert into public.cargos(reserva_id,estadia_id,tipo_cargo,concepto,monto,moneda,estado,creado_por)
          values(v_r.id,v_e.id,'alojamiento','Full Day - '||v_ne.fecha_ingreso,v_price,'CLP','activo',auth.uid());
      end if;
    end if;
    update public.reservas set estado_reserva=case
      when exists(select 1 from public.reserva_estadias where reserva_id=v_r.id and estado_estadia='hospedada') then 'hospedada'
      when not exists(select 1 from public.reserva_estadias where reserva_id=v_r.id and estado_estadia not in ('checked_out','cancelada','no_show')) then 'checked_out'
      when exists(select 1 from public.reserva_estadias where reserva_id=v_r.id and estado_estadia='confirmada') then 'confirmada' else 'pendiente' end where id=v_r.id;
    return jsonb_build_object('item_id',p_item->>'item_id','tipo','reserva_actualizar','reserva_id',v_r.id,'estadia_id',v_e.id,'anterior',v_before,'cambios',p_item->'cambios','aplicaciones_liberadas',v_aplicaciones);
  elsif p_item->>'tipo'='pago_actualizar' then
    if not private.haiku_tiene_permiso('pagos.registrar') or not private.haiku_tiene_permiso('pagos.verificar') then raise exception 'Sin permiso para actualizar pagos' using errcode='42501'; end if;
    select * into v_p from public.pagos where id=(p_item->>'pago_id')::uuid and reserva_id=(p_item->>'reserva_id')::uuid for update;
    if not found or v_p.tipo_movimiento<>'pago' or v_p.estado='anulado' then raise exception 'Pago destino no editable'; end if;
    v_ids:=p_item->'identificadores';
    select count(*) into v_count from public.pagos p where p.tipo_movimiento='pago' and p.estado<>'anulado' and (
      (nullif(v_ids->>'codigo_autorizacion','') is not null and regexp_replace(lower(p.codigo_autorizacion),'[^a-z0-9]','','g')=regexp_replace(lower(v_ids->>'codigo_autorizacion'),'[^a-z0-9]','','g')) or
      (nullif(v_ids->>'folio','') is not null and nullif(v_ids->>'bovtar','') is not null and regexp_replace(lower(p.folio),'[^a-z0-9]','','g')=regexp_replace(lower(v_ids->>'folio'),'[^a-z0-9]','','g') and regexp_replace(lower(coalesce(p.datos_origen->>'bovtar',p.bove)),'[^a-z0-9]','','g')=regexp_replace(lower(v_ids->>'bovtar'),'[^a-z0-9]','','g')) or
      (nullif(v_ids->>'bove','') is not null and regexp_replace(lower(p.bove),'[^a-z0-9]','','g')=regexp_replace(lower(v_ids->>'bove'),'[^a-z0-9]','','g')));
    if v_count<>1 or not (
      (nullif(v_ids->>'codigo_autorizacion','') is not null and regexp_replace(lower(v_p.codigo_autorizacion),'[^a-z0-9]','','g')=regexp_replace(lower(v_ids->>'codigo_autorizacion'),'[^a-z0-9]','','g')) or
      (nullif(v_ids->>'folio','') is not null and nullif(v_ids->>'bovtar','') is not null and regexp_replace(lower(v_p.folio),'[^a-z0-9]','','g')=regexp_replace(lower(v_ids->>'folio'),'[^a-z0-9]','','g') and regexp_replace(lower(coalesce(v_p.datos_origen->>'bovtar',v_p.bove)),'[^a-z0-9]','','g')=regexp_replace(lower(v_ids->>'bovtar'),'[^a-z0-9]','','g')) or
      (nullif(v_ids->>'bove','') is not null and regexp_replace(lower(v_p.bove),'[^a-z0-9]','','g')=regexp_replace(lower(v_ids->>'bove'),'[^a-z0-9]','','g'))
    ) then raise exception 'El identificador del pago ya no es inequívoco'; end if;
    perform private.haiku_libro_validar_parche_v1(to_jsonb(v_p)||jsonb_build_object('bovtar',v_p.datos_origen->>'bovtar','concepto_libro',v_p.datos_origen->>'concepto_libro'),p_item->'pago',array['monto','moneda','medio_pago','fecha_pago','folio','bovtar','bove','codigo_autorizacion','referencia_externa','concepto_libro']);
    v_patch:=p_item->'pago'->'despues'; v_np:=jsonb_populate_record(v_p,v_patch-array['bovtar','concepto_libro']);
    if v_np.monto<=0 or v_np.moneda<>'CLP' or v_np.medio_pago is null or v_np.fecha_pago is null then raise exception 'El pago requiere monto, moneda, fecha y medio válidos'; end if;
    select coalesce(sum(monto),0) into v_devuelto from public.pagos where pago_origen_id=v_p.id and tipo_movimiento='devolucion' and estado='confirmado';
    if v_np.monto<v_devuelto then raise exception 'El monto del Libro es menor que las devoluciones registradas; revisa la conciliación'; end if;
    select coalesce(sum(monto_aplicado),0)-v_np.monto into v_exceso from public.pago_aplicaciones where pago_id=v_p.id;
    if v_exceso>0 then
      for v_record in select * from public.pago_aplicaciones where pago_id=v_p.id order by creado_en desc,id for update loop
        exit when v_exceso<=0;
        v_aplicaciones:=v_aplicaciones||jsonb_build_array(to_jsonb(v_record));
        if v_record.monto_aplicado<=v_exceso then delete from public.pago_aplicaciones where id=v_record.id;
        else update public.pago_aplicaciones set monto_aplicado=monto_aplicado-v_exceso where id=v_record.id; end if;
        v_exceso:=v_exceso-v_record.monto_aplicado;
      end loop;
    end if;
    update public.pagos set monto=v_np.monto,moneda=v_np.moneda,medio_pago=v_np.medio_pago,fecha_pago=v_np.fecha_pago,folio=v_np.folio,
      codigo_autorizacion=v_np.codigo_autorizacion,bove=v_np.bove,referencia_externa=v_np.referencia_externa,
      verificado_por=auth.uid(),verificado_en=now(),
      datos_origen=coalesce(v_p.datos_origen,'{}'::jsonb)||(v_patch-array['monto','moneda','medio_pago','fecha_pago','folio','bove','codigo_autorizacion','referencia_externa'])
        ||jsonb_build_object('ultima_actualizacion_libro',jsonb_build_object('usuario',auth.uid(),'fecha',now(),'anterior',to_jsonb(v_p)-'datos_origen')) where id=v_p.id;
    return jsonb_build_object('item_id',p_item->>'item_id','tipo','pago_actualizar','reserva_id',v_p.reserva_id,'pago_id',v_p.id,'anterior',to_jsonb(v_p),'cambios',p_item->'pago'->'cambios','aplicaciones_ajustadas',v_aplicaciones);
  end if;
  raise exception 'Actualización no admitida';
end;
$fn$;
revoke all on function private.haiku_libro_actualizar_v1(jsonb) from public,anon,authenticated;

-- Deduplicación de pagos: los identificadores fuertes prevalecen sobre monto/reserva.
-- El item_id de Haku sólo protege reintentos exactos del mismo movimiento del Libro.

create or replace function public.haiku_incorporar_libro_v1(
  p_operacion_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_usuario_id uuid := auth.uid();
  v_hash text;
  v_registro private.haiku_libro_incorporaciones%rowtype;
  v_item jsonb;
  v_tipo text;
  v_item_id text;
  v_reserva jsonb;
  v_estadias jsonb;
  v_estadia jsonb;
  v_datos jsonb;
  v_resultado jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_omitidos jsonb := '[]'::jsonb;
  v_referencias jsonb := '{}'::jsonb;
  v_items_vistos text[] := array[]::text[];
  v_reserva_id uuid;
  v_reserva_existente uuid;
  v_coincidencia uuid;
  v_coincidencias integer;
  v_estadias_coincidentes integer;
  v_indice integer;
  v_cantidad integer;
  v_documento text;
  v_rut text;
  v_pago jsonb;
  v_argumentos jsonb;
  v_origen jsonb;
  v_pago_id uuid;
  v_pago_existente uuid;
  v_monto bigint;
  v_medio text;
  v_fecha_pago timestamptz;
  v_folio text;
  v_codaut text;
  v_bove text;
  v_bovtar text;
  v_fuerte boolean;
  v_manual boolean;
  v_creadas integer := 0;
  v_estadias_agregadas integer := 0;
  v_pagos_creados integer := 0;
  v_actualizaciones integer := 0;
  v_respuesta jsonb;
begin
  if v_usuario_id is null then
    raise exception 'Debe iniciar sesion para incorporar reservas y pagos';
  end if;
  if p_operacion_id is null then
    raise exception 'Falta el identificador de la operacion';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Los elementos deben enviarse como un arreglo';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) < 1 then
    raise exception 'Selecciona al menos una reserva, estadia o pago';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'La incorporacion admite como maximo 100 elementos';
  end if;

  -- Serializa las incorporaciones con cualquier otra escritura sobre estas tablas.
  -- La espera es breve y evita que dos confirmaciones atraviesen la misma revision.
  lock table public.reserva_estadias in share row exclusive mode;
  lock table public.pagos in share row exclusive mode;

  v_hash := md5(p_items::text);
  insert into private.haiku_libro_incorporaciones(
    operacion_id, usuario_id, solicitud_hash
  ) values (p_operacion_id, v_usuario_id, v_hash)
  on conflict (operacion_id) do nothing;

  select * into v_registro
  from private.haiku_libro_incorporaciones
  where operacion_id = p_operacion_id
  for update;

  if v_registro.usuario_id is distinct from v_usuario_id then
    raise exception 'La operacion pertenece a otro usuario' using errcode = '42501';
  end if;
  if v_registro.solicitud_hash is distinct from v_hash then
    raise exception 'El identificador ya fue usado con otra seleccion';
  end if;
  if v_registro.resultado is not null then
    return v_registro.resultado || jsonb_build_object('reintento', true);
  end if;

  -- Primero crea las reservas nuevas para resolver las referencias simbolicas.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_tipo := lower(btrim(coalesce(v_item ->> 'tipo', '')));
    v_item_id := nullif(btrim(coalesce(v_item ->> 'item_id', '')), '');
    if v_item_id is null or v_item_id = any(v_items_vistos) then
      raise exception 'Cada elemento requiere un identificador unico';
    end if;
    v_items_vistos := array_append(v_items_vistos, v_item_id);
    if v_tipo not in ('reserva_nueva', 'estadia', 'pago', 'reserva_actualizar', 'pago_actualizar') then
      raise exception 'Tipo de elemento no admitido: %', coalesce(v_tipo, '');
    end if;
    continue when v_tipo <> 'reserva_nueva';

    if not private.haiku_tiene_permiso('reservas.crear') then
      raise exception 'Sin permiso para crear reservas' using errcode = '42501';
    end if;
    v_reserva := coalesce(v_item -> 'reserva', '{}'::jsonb);
    v_estadias := coalesce(v_item -> 'estadias', '[]'::jsonb);
    if jsonb_typeof(v_reserva) <> 'object'
       or nullif(btrim(coalesce(v_reserva ->> 'titular_nombre', '')), '') is null then
      raise exception 'La reserva % requiere titular', v_item_id;
    end if;
    if jsonb_typeof(v_estadias) <> 'array'
       or jsonb_array_length(v_estadias) < 1
       or jsonb_array_length(v_estadias) > 11 then
      raise exception 'La reserva % requiere entre 1 y 11 estadias', v_item_id;
    end if;

    -- Si toda la reserva aparecio entretanto, se reutiliza como destino y se omite.
    v_reserva_existente := null;
    v_estadias_coincidentes := 0;
    for v_estadia in select value from jsonb_array_elements(v_estadias)
    loop
      v_datos := coalesce(v_estadia -> 'datos', '{}'::jsonb);
      select count(distinct re.reserva_id), min(re.reserva_id::text)::uuid
        into v_coincidencias, v_coincidencia
      from public.reserva_estadias re
      join public.cabanas c on c.id = re.cabana_id
      join public.reservas r on r.id = re.reserva_id
      where re.estado_estadia not in ('cancelada', 'no_show')
        and r.estado_reserva <> 'cancelada'
        and c.numero = (v_estadia ->> 'cabana_numero')::smallint
        and re.fecha_ingreso = (v_datos ->> 'fecha_ingreso')::date
        and re.fecha_salida = (v_datos ->> 'fecha_salida')::date
        and re.tipo_estadia = lower(v_datos ->> 'tipo_estadia')
        and regexp_replace(translate(lower(r.titular_nombre), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', '', 'g')
          = regexp_replace(translate(lower(v_reserva ->> 'titular_nombre'), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', '', 'g')
        and (
          nullif(regexp_replace(upper(coalesce(v_reserva ->> 'titular_numero_documento', '')), '[^0-9A-Z]', '', 'g'), '') is null
          or nullif(regexp_replace(upper(coalesce(r.titular_numero_documento, '')), '[^0-9A-Z]', '', 'g'), '') is null
          or regexp_replace(upper(r.titular_numero_documento), '[^0-9A-Z]', '', 'g')
             = regexp_replace(upper(v_reserva ->> 'titular_numero_documento'), '[^0-9A-Z]', '', 'g')
        );
      if v_coincidencias > 1 then
        raise exception 'La reserva % ahora tiene mas de una coincidencia; vuelve a preparar', v_item_id;
      end if;
      if v_coincidencia is not null then
        v_estadias_coincidentes := v_estadias_coincidentes + 1;
        if v_reserva_existente is null then
          v_reserva_existente := v_coincidencia;
        elsif v_reserva_existente is distinct from v_coincidencia then
          raise exception 'Las estadias de % ahora pertenecen a reservas distintas; vuelve a preparar', v_item_id;
        end if;
      end if;
    end loop;

    if v_estadias_coincidentes = jsonb_array_length(v_estadias) then
      v_referencias := v_referencias || jsonb_build_object(v_item_id, v_reserva_existente::text);
      v_omitidos := v_omitidos || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id, 'tipo', v_tipo, 'reserva_id', v_reserva_existente,
        'motivo', 'La reserva ya existe en Proyecto H'
      ));
      continue;
    elsif v_estadias_coincidentes > 0 then
      raise exception 'Parte de la reserva % aparecio entretanto; vuelve a preparar', v_item_id;
    end if;

    v_estadia := v_estadias -> 0;
    v_datos := v_estadia -> 'datos';
    v_documento := nullif(btrim(coalesce(v_reserva ->> 'titular_numero_documento', '')), '');
    v_rut := case
      when v_documento ~* '^[0-9]{1,2}(\.?[0-9]{3}){2}-?[0-9k]$' then v_documento
      else null
    end;

    v_resultado := public.haiku_crear_reserva(
      p_titular_nombre => v_reserva ->> 'titular_nombre',
      p_cabana_numero => (v_estadia ->> 'cabana_numero')::smallint,
      p_fecha_ingreso => (v_datos ->> 'fecha_ingreso')::date,
      p_fecha_salida => (v_datos ->> 'fecha_salida')::date,
      p_adultos => (v_datos ->> 'adultos')::smallint,
      p_ninos => coalesce((v_datos ->> 'ninos')::smallint, 0::smallint),
      p_mascotas => coalesce((v_datos ->> 'mascotas')::smallint, 0::smallint),
      p_correo_contacto => nullif(v_reserva ->> 'correo_contacto', ''),
      p_telefono_contacto => nullif(v_reserva ->> 'telefono_contacto', ''),
      p_rut => v_rut,
      p_observaciones => nullif(v_reserva ->> 'observaciones', ''),
      p_tarifas => '{}'::jsonb,
      p_acompanantes => '[]'::jsonb,
      p_tipo_estadia => lower(v_datos ->> 'tipo_estadia'),
      p_cloudbeds_id => null
    );
    v_reserva_id := (v_resultado ->> 'reserva_id')::uuid;

    if v_documento is not null and v_rut is null then
      update public.reservas
      set titular_tipo_documento = case when v_documento ~* '[a-z]' then 'pasaporte' else 'documento' end,
          titular_numero_documento = v_documento
      where id = v_reserva_id;
      update public.huespedes h
      set tipo_documento = case when v_documento ~* '[a-z]' then 'pasaporte' else 'documento' end,
          numero_documento = v_documento
      from public.reservas r
      where r.id = v_reserva_id and h.id = r.titular_huesped_id;
    end if;

    v_referencias := v_referencias || jsonb_build_object(v_item_id, v_reserva_id::text);
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'item_id', v_item_id, 'tipo', v_tipo, 'reserva_id', v_reserva_id,
      'codigo_haiku', v_resultado ->> 'codigo_haiku'
    ));
    v_creadas := v_creadas + 1;

    v_cantidad := jsonb_array_length(v_estadias);
    if v_cantidad > 1 then
      for v_indice in 1..(v_cantidad - 1)
      loop
        v_resultado := private.haiku_libro_agregar_estadia_v1(v_reserva_id, v_estadias -> v_indice);
        if not coalesce((v_resultado ->> 'omitida')::boolean, false) then
          v_estadias_agregadas := v_estadias_agregadas + 1;
        end if;
      end loop;
    end if;
  end loop;

  -- Luego agrega estadias a reservas que ya existian.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_tipo := lower(btrim(coalesce(v_item ->> 'tipo', '')));
    continue when v_tipo <> 'estadia';
    v_item_id := v_item ->> 'item_id';
    if not private.haiku_tiene_permiso('reservas.editar') then
      raise exception 'Sin permiso para editar reservas' using errcode = '42501';
    end if;
    begin
      v_reserva_id := (v_item ->> 'reserva_id')::uuid;
    exception when others then
      raise exception 'La estadia % no tiene una reserva destino valida', v_item_id;
    end;
    v_estadias := coalesce(v_item -> 'estadias', '[]'::jsonb);
    if jsonb_typeof(v_estadias) <> 'array' or jsonb_array_length(v_estadias) < 1 then
      raise exception 'El elemento % no contiene estadias', v_item_id;
    end if;
    for v_estadia in select value from jsonb_array_elements(v_estadias)
    loop
      v_resultado := private.haiku_libro_agregar_estadia_v1(v_reserva_id, v_estadia);
      if coalesce((v_resultado ->> 'omitida')::boolean, false) then
        v_omitidos := v_omitidos || jsonb_build_array(jsonb_build_object(
          'item_id', v_item_id, 'tipo', v_tipo,
          'estadia_id', v_resultado ->> 'estadia_id',
          'motivo', v_resultado ->> 'motivo'
        ));
      else
        v_estadias_agregadas := v_estadias_agregadas + 1;
        v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
          'item_id', v_item_id, 'tipo', v_tipo, 'reserva_id', v_reserva_id,
          'estadia_id', v_resultado ->> 'estadia_id'
        ));
      end if;
    end loop;
  end loop;

  -- Finalmente registra los pagos y resuelve los destinos recien creados.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_tipo := lower(btrim(coalesce(v_item ->> 'tipo', '')));
    continue when v_tipo <> 'pago';
    v_item_id := v_item ->> 'item_id';
    if not private.haiku_tiene_permiso('pagos.registrar') then
      raise exception 'Sin permiso para registrar pagos' using errcode = '42501';
    end if;

    begin
      if nullif(v_item ->> 'reserva_id', '') is not null then
        v_reserva_id := (v_item ->> 'reserva_id')::uuid;
      else
        v_reserva_id := nullif(v_referencias ->> (v_item ->> 'reserva_ref'), '')::uuid;
      end if;
    exception when others then
      raise exception 'El pago % no tiene una reserva destino valida', v_item_id;
    end;
    if v_reserva_id is null or not exists (
      select 1 from public.reservas r
      where r.id = v_reserva_id and r.estado_reserva <> 'cancelada'
    ) then
      raise exception 'La reserva destino del pago % ya no esta disponible', v_item_id;
    end if;

    v_argumentos := coalesce(v_item -> 'argumentos', '{}'::jsonb);
    v_origen := coalesce(v_item -> 'datos_origen', '{}'::jsonb);
    begin
      v_monto := (v_argumentos ->> 'p_monto')::bigint;
      v_fecha_pago := (v_argumentos ->> 'p_fecha_pago')::timestamptz;
    exception when others then
      raise exception 'El pago % tiene monto o fecha invalidos', v_item_id;
    end;
    v_medio := lower(btrim(coalesce(v_argumentos ->> 'p_medio_pago', '')));
    v_folio := nullif(btrim(coalesce(v_argumentos ->> 'p_folio', '')), '');
    v_codaut := nullif(btrim(coalesce(v_argumentos ->> 'p_codigo_autorizacion', '')), '');
    v_bove := nullif(btrim(coalesce(v_argumentos ->> 'p_bove', '')), '');
    v_bovtar := nullif(btrim(coalesce(v_origen ->> 'bovtar', '')), '');
    v_manual := coalesce((v_item ->> 'aprobado_manualmente')::boolean, false);
    v_fuerte := v_codaut is not null or v_bove is not null or (v_folio is not null and v_bovtar is not null);

    if v_monto is null or v_monto <= 0 or v_fecha_pago is null then
      raise exception 'El pago % requiere monto y fecha del comprobante', v_item_id;
    end if;
    if v_medio not in ('transferencia', 'webpay_credito', 'webpay_debito', 'tarjeta_credito', 'tarjeta_debito', 'efectivo') then
      raise exception 'El pago % tiene un medio no admitido', v_item_id;
    end if;
    if not v_fuerte and not v_manual then
      raise exception 'El pago % no tiene identificador fuerte ni aprobacion manual', v_item_id;
    end if;
    if nullif(v_origen ->> 'fecha_bloque', '') is null or not exists (
      select 1 from public.reserva_estadias re
      where re.reserva_id = v_reserva_id
        and re.estado_estadia not in ('cancelada', 'no_show')
        and re.fecha_ingreso = (v_origen ->> 'fecha_bloque')::date
    ) then
      raise exception 'El pago % no corresponde al bloque del dia de Check-In', v_item_id;
    end if;

    v_pago_existente := null;
    select p.id into v_pago_existente
    from public.pagos p
    where p.tipo_movimiento = 'pago'
      and p.estado <> 'anulado'
      and (
        (v_codaut is not null and regexp_replace(upper(coalesce(p.codigo_autorizacion, '')), '[^0-9A-Z]', '', 'g')
          = regexp_replace(upper(v_codaut), '[^0-9A-Z]', '', 'g'))
        or (v_bove is not null and regexp_replace(upper(coalesce(p.bove, '')), '[^0-9A-Z]', '', 'g')
          = regexp_replace(upper(v_bove), '[^0-9A-Z]', '', 'g'))
        or (v_folio is not null and v_bovtar is not null
          and regexp_replace(upper(coalesce(p.folio, '')), '[^0-9A-Z]', '', 'g') = regexp_replace(upper(v_folio), '[^0-9A-Z]', '', 'g')
          and regexp_replace(upper(coalesce(p.datos_origen ->> 'bovtar', p.bove, '')), '[^0-9A-Z]', '', 'g') = regexp_replace(upper(v_bovtar), '[^0-9A-Z]', '', 'g'))
        or (coalesce(p.datos_origen ->> 'item_id', '') = v_item_id)
      )
    order by p.creado_en, p.id
    limit 1;

    if v_pago_existente is not null then
      v_omitidos := v_omitidos || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id, 'tipo', v_tipo, 'pago_id', v_pago_existente,
        'motivo', 'El pago ya existe por identificador fuerte o corresponde al mismo movimiento ya incorporado por Haku'
      ));
      continue;
    end if;

    v_pago := public.haiku_registrar_pago(
      p_reserva_id => v_reserva_id,
      p_monto => v_monto,
      p_medio_pago => v_medio,
      p_etapa_operativa => 'abono',
      p_fecha_pago => v_fecha_pago,
      p_folio => v_folio,
      p_codigo_autorizacion => v_codaut,
      p_bove => coalesce(v_bove, v_bovtar),
      p_referencia_externa => nullif(v_argumentos ->> 'p_referencia_externa', ''),
      p_observaciones => nullif(v_argumentos ->> 'p_observaciones', ''),
      p_aplicaciones => '[]'::jsonb,
      p_modo_aplicacion => 'alojamiento'
    );
    v_pago_id := (v_pago ->> 'pago_id')::uuid;

    update public.pagos
    set pagador_nombre = coalesce((select r.titular_nombre from public.reservas r where r.id = v_reserva_id), pagador_nombre),
        datos_origen = coalesce(datos_origen, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'contexto', 'haku_libro_incorporacion',
          'operacion_id', p_operacion_id,
          'item_id', v_item_id,
          'bovtar', v_bovtar,
          'fecha_bloque', v_origen ->> 'fecha_bloque',
          'origen_libro', v_origen -> 'origen',
          'aprobado_manualmente', v_manual
        ))
    where id = v_pago_id;

    v_pagos_creados := v_pagos_creados + 1;
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'item_id', v_item_id, 'tipo', v_tipo, 'reserva_id', v_reserva_id,
      'pago_id', v_pago_id, 'monto', v_monto
    ));
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item->>'tipo' in ('reserva_actualizar','pago_actualizar') then
      v_resultado := private.haiku_libro_actualizar_v1(v_item);
      v_resultados := v_resultados || jsonb_build_array(v_resultado);
      v_actualizaciones := v_actualizaciones + 1;
    end if;
  end loop;

  v_respuesta := jsonb_build_object(
    'ok', true,
    'operacion_id', p_operacion_id,
    'reintento', false,
    'reservas_creadas', v_creadas,
    'estadias_agregadas', v_estadias_agregadas,
    'pagos_creados', v_pagos_creados,
    'actualizaciones', v_actualizaciones,
    'omitidos', jsonb_array_length(v_omitidos),
    'detalle_omitidos', v_omitidos,
    'resultados', v_resultados
  );

  update private.haiku_libro_incorporaciones
  set resultado = v_respuesta, completado_en = now()
  where operacion_id = p_operacion_id;

  return v_respuesta;
end;
$function$;

revoke all on function public.haiku_incorporar_libro_v1(uuid, jsonb)
  from public, anon;
grant execute on function public.haiku_incorporar_libro_v1(uuid, jsonb)
  to authenticated;
