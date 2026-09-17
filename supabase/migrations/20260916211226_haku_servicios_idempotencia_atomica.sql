-- Haku · Idempotencia atomica de servicios.
-- Serializa por reserva antes de comprobar identidad y conserva servicios
-- legitimos distintos por fecha/hora. No modifica datos existentes.

create or replace function private.haiku_servicio_identidad_guard_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_reservas uuid[] := array[]::uuid[];
  v_reserva_id uuid;
  v_codigo text;
  v_requiere_horario boolean;
begin
  if tg_op = 'UPDATE' and old.reserva_id is not null then
    v_reservas := array_append(v_reservas, old.reserva_id);
  end if;
  if new.reserva_id is not null then
    v_reservas := array_append(v_reservas, new.reserva_id);
  end if;

  -- Un trigger de UPDATE puede ejecutarse cuando PostgreSQL ya retuvo una fila.
  -- Por eso nunca espera aqui: la RPC toma antes el lock bloqueante y los
  -- writers directos/antiguos abortan si otra transaccion posee la reserva.
  for v_reserva_id in
    select distinct unnest(v_reservas) order by 1
  loop
    if not pg_try_advisory_xact_lock(
      private.haiku_libro_lock_key_v1('reserva_finanzas', v_reserva_id::text)
    ) then
      raise exception 'La reserva tiene otra operacion financiera en curso; vuelve a intentar';
    end if;
  end loop;

  if coalesce(new.estado_servicio, '') in ('cancelado', 'no_show') then
    return new;
  end if;

  select cs.codigo, cs.requiere_horario
    into v_codigo, v_requiere_horario
  from public.catalogo_servicios cs
  where cs.id = new.catalogo_servicio_id;

  if not found then
    raise exception 'El servicio de catalogo no existe';
  end if;

  if v_codigo = 'lateCheckout' then
    if new.estadia_id is null then
      raise exception 'Late Check-out requiere una estadia unica';
    end if;

    if exists (
      select 1
      from public.servicios s
      join public.catalogo_servicios cs on cs.id = s.catalogo_servicio_id
      where s.estadia_id = new.estadia_id
        and cs.codigo = 'lateCheckout'
        and coalesce(s.estado_servicio, '') not in ('cancelado', 'no_show')
        and s.id is distinct from new.id
    ) then
      raise exception 'Ya existe un Late Check-out activo para esta estadia';
    end if;

    return new;
  end if;

  -- Para conceptos repetibles la identidad solo es concluyente si el catalogo
  -- exige horario. Otra fecha u otra hora siguen siendo hechos distintos.
  if coalesce(v_requiere_horario, false)
     and new.estadia_id is not null
     and new.hora_inicio is not null
     and exists (
       select 1
       from public.servicios s
       where s.estadia_id = new.estadia_id
         and s.catalogo_servicio_id = new.catalogo_servicio_id
         and s.fecha_servicio = new.fecha_servicio
         and s.hora_inicio = new.hora_inicio
         and s.total = new.total
         and s.tipo_cobro = new.tipo_cobro
         and coalesce(s.estado_servicio, '') not in ('cancelado', 'no_show')
         and s.id is distinct from new.id
     ) then
    raise exception 'Ya existe un servicio activo con la misma identidad operativa';
  end if;

  return new;
end;
$function$;

revoke all on function private.haiku_servicio_identidad_guard_v1()
  from public, anon, authenticated;

drop trigger if exists haiku_servicio_identidad_guard_v1 on public.servicios;
create trigger haiku_servicio_identidad_guard_v1
before insert or update of reserva_id, estadia_id, catalogo_servicio_id,
  fecha_servicio, hora_inicio, total, tipo_cobro, estado_servicio
on public.servicios
for each row execute function private.haiku_servicio_identidad_guard_v1();

create or replace function public.haiku_registrar_servicio(
  p_reserva_id uuid,
  p_codigo_servicio text,
  p_fecha_servicio date,
  p_hora time without time zone default null::time without time zone,
  p_cantidad integer default 1,
  p_personas smallint default 1,
  p_tipo_cobro text default 'normal'::text,
  p_precio_manual bigint default null::bigint,
  p_motivo_cortesia text default null::text,
  p_observaciones text default null::text,
  p_estadia_id uuid default null::uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_catalogo record;
  v_servicio_id uuid;
  v_recurso_id uuid;
  v_hora_fin time;
  v_precio_unitario bigint;
  v_adicional bigint := 0;
  v_total bigint;
  v_coincidentes uuid[] := array[]::uuid[];
  v_marca_libro text;
  v_marca_legacy text;
  v_existente record;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesion para registrar servicios';
  end if;

  if p_reserva_id is null then
    raise exception 'Falta la reserva del servicio';
  end if;

  select * into v_catalogo
  from public.catalogo_servicios
  where codigo = p_codigo_servicio
    and activo = true;

  if not found then
    raise exception 'Servicio % no existe o esta inactivo', p_codigo_servicio;
  end if;

  if p_fecha_servicio is null then
    raise exception 'Falta la fecha del servicio';
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  if p_personas is null or p_personas < 0 then
    raise exception 'Cantidad de personas invalida';
  end if;

  if v_catalogo.capacidad_maxima is not null and p_personas > v_catalogo.capacidad_maxima then
    raise exception 'El servicio admite maximo % personas', v_catalogo.capacidad_maxima;
  end if;

  if p_tipo_cobro = 'cortesia' and not v_catalogo.permite_cortesia then
    raise exception 'Este servicio no permite cortesia';
  end if;

  if p_tipo_cobro = 'cortesia' and (p_motivo_cortesia is null or btrim(p_motivo_cortesia) = '') then
    raise exception 'La cortesia requiere motivo';
  end if;

  if v_catalogo.requiere_horario and p_hora is null then
    raise exception 'Este servicio requiere horario';
  end if;

  if p_hora is not null then
    if v_catalogo.duracion_minutos is not null then
      v_hora_fin := (p_hora + make_interval(mins => v_catalogo.duracion_minutos))::time;
    elsif v_catalogo.unidad = 'hora' then
      v_hora_fin := (p_hora + make_interval(hours => p_cantidad))::time;
    else
      v_hora_fin := (p_hora + interval '1 hour')::time;
    end if;
  end if;

  v_precio_unitario := coalesce(p_precio_manual, v_catalogo.precio_base, 0);

  if p_precio_manual is null
     and v_catalogo.precio_persona_adicional is not null
     and v_catalogo.capacidad_incluida is not null
     and p_personas > v_catalogo.capacidad_incluida then
    v_adicional := (p_personas - v_catalogo.capacidad_incluida) * v_catalogo.precio_persona_adicional;
  end if;

  v_total := (v_precio_unitario * p_cantidad) + v_adicional;

  if p_tipo_cobro = 'cortesia' then
    v_total := 0;
    v_adicional := 0;
  end if;

  -- Esta llave coincide con private.haiku_libro_lock_key_v1 sin exponer el
  -- helper privado al rol authenticated. Se toma antes de toda revalidacion.
  perform pg_advisory_xact_lock(
    ('x' || substr(md5('reserva_finanzas:' || p_reserva_id::text), 1, 16))::bit(64)::bigint
  );

  perform 1 from public.reservas r where r.id = p_reserva_id for update;
  if not found then
    raise exception 'La reserva del servicio no existe';
  end if;

  if p_estadia_id is not null then
    perform 1
    from public.reserva_estadias re
    where re.id = p_estadia_id
      and re.reserva_id = p_reserva_id
      and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
    for update;
    if not found then
      raise exception 'La estadia seleccionada no pertenece a la reserva o no esta activa';
    end if;
  elsif p_codigo_servicio = 'lateCheckout' then
    raise exception 'Late Check-out requiere una estadia unica';
  end if;

  v_marca_libro := substring(
    coalesce(p_observaciones, '')
    from '(\[HAKU-LIBRO-SERVICIO:[A-Za-z0-9:_\-.]+\])'
  );
  v_marca_legacy := substring(
    coalesce(p_observaciones, '')
    from '(HAIKU-LEGACY-ID:[A-Za-z0-9:_\-.]+)'
  );

  if v_marca_libro is not null or v_marca_legacy is not null then
    select coalesce(array_agg(s.id order by s.id), array[]::uuid[])
      into v_coincidentes
    from public.servicios s
    where s.reserva_id = p_reserva_id
      and coalesce(s.estado_servicio, '') not in ('cancelado', 'no_show')
      and (
        (v_marca_libro is not null and position(v_marca_libro in coalesce(s.observaciones, '')) > 0)
        or
        (v_marca_legacy is not null and position(v_marca_legacy in coalesce(s.observaciones, '')) > 0)
      );

    if cardinality(v_coincidentes) > 1 then
      raise exception 'El origen estable identifica multiples servicios activos; requiere revision';
    elsif cardinality(v_coincidentes) = 1 then
      select s.id, s.estadia_id, s.catalogo_servicio_id, s.total,
             s.hora_inicio, s.hora_fin, s.tipo_cobro
        into v_existente
      from public.servicios s
      where s.id = v_coincidentes[1];

      if v_existente.catalogo_servicio_id <> v_catalogo.id
         or (p_estadia_id is not null and v_existente.estadia_id is distinct from p_estadia_id) then
        raise exception 'El origen estable ya pertenece a otro servicio; requiere revision';
      end if;

      v_servicio_id := v_existente.id;
    end if;
  end if;

  if p_codigo_servicio = 'lateCheckout' then
    select coalesce(array_agg(s.id order by s.id), array[]::uuid[])
      into v_coincidentes
    from public.servicios s
    join public.catalogo_servicios cs on cs.id = s.catalogo_servicio_id
    where s.estadia_id = p_estadia_id
      and cs.codigo = 'lateCheckout'
      and coalesce(s.estado_servicio, '') not in ('cancelado', 'no_show');

    if cardinality(v_coincidentes) > 1 then
      raise exception 'Existen multiples Late Check-out activos en la estadia; requiere revision';
    elsif cardinality(v_coincidentes) = 1 then
      if v_servicio_id is not null and v_servicio_id <> v_coincidentes[1] then
        raise exception 'El origen estable y el Late Check-out activo identifican servicios distintos; requiere revision';
      end if;
      v_servicio_id := v_coincidentes[1];
    end if;
  elsif p_estadia_id is not null
        and coalesce(v_catalogo.requiere_horario, false)
        and p_hora is not null then
    select coalesce(array_agg(s.id order by s.id), array[]::uuid[])
      into v_coincidentes
    from public.servicios s
    where s.estadia_id = p_estadia_id
      and s.catalogo_servicio_id = v_catalogo.id
      and s.fecha_servicio = p_fecha_servicio
      and s.hora_inicio = p_hora
      and s.total = v_total
      and s.tipo_cobro = p_tipo_cobro
      and coalesce(s.estado_servicio, '') not in ('cancelado', 'no_show');

    if cardinality(v_coincidentes) > 1 then
      raise exception 'Existen multiples servicios con la misma identidad operativa; requiere revision';
    elsif cardinality(v_coincidentes) = 1 then
      if v_servicio_id is not null and v_servicio_id <> v_coincidentes[1] then
        raise exception 'El origen estable y la identidad operativa identifican servicios distintos; requiere revision';
      end if;
      v_servicio_id := v_coincidentes[1];
    end if;
  end if;

  if v_servicio_id is not null then
    select s.id, s.total, s.hora_inicio, s.hora_fin, s.tipo_cobro
      into v_existente
    from public.servicios s
    where s.id = v_servicio_id;

    return jsonb_build_object(
      'servicio_id', v_existente.id,
      'codigo', p_codigo_servicio,
      'total', v_existente.total,
      'hora_inicio', v_existente.hora_inicio,
      'hora_fin', v_existente.hora_fin,
      'tipo_cobro', v_existente.tipo_cobro,
      'estado', 'ya_existente',
      'reutilizado', true
    );
  end if;

  if p_codigo_servicio = 'tinajaTonel' then
    select id into v_recurso_id from public.recursos_servicio
    where nombre = 'Tinaja Tonel de Madera' and activo = true limit 1;
  elsif p_codigo_servicio = 'tinajaJacuzzi' then
    select id into v_recurso_id from public.recursos_servicio
    where nombre = 'Tinaja Jacuzzi' and activo = true limit 1;
  end if;

  insert into public.servicios (
    reserva_id, estadia_id, catalogo_servicio_id, recurso_id,
    fecha_servicio, hora_inicio, hora_fin, cantidad, personas,
    precio_unitario_aplicado, monto_adicional, total, tipo_cobro,
    motivo_ajuste_precio, motivo_cortesia, estado_servicio,
    observaciones, creado_por
  ) values (
    p_reserva_id, p_estadia_id, v_catalogo.id, v_recurso_id,
    p_fecha_servicio, p_hora, v_hora_fin, p_cantidad, p_personas,
    v_precio_unitario, v_adicional, v_total, p_tipo_cobro,
    case when p_precio_manual is not null then 'Precio manual' else null end,
    nullif(btrim(coalesce(p_motivo_cortesia, '')), ''), 'programado',
    nullif(btrim(coalesce(p_observaciones, '')), ''), auth.uid()
  )
  returning id into v_servicio_id;

  return jsonb_build_object(
    'servicio_id', v_servicio_id,
    'codigo', p_codigo_servicio,
    'total', v_total,
    'hora_inicio', p_hora,
    'hora_fin', v_hora_fin,
    'tipo_cobro', p_tipo_cobro,
    'estado', 'creado',
    'reutilizado', false
  );
end;
$function$;

comment on function public.haiku_registrar_servicio(
  uuid, text, date, time without time zone, integer, smallint,
  text, bigint, text, text, uuid
) is 'Registra servicios con revalidacion atomica por reserva. Late Check-out es unico por estadia; servicios horarios reutilizan una identidad operativa exacta.';

revoke all on function public.haiku_registrar_servicio(
  uuid, text, date, time without time zone, integer, smallint,
  text, bigint, text, text, uuid
) from public, anon;
grant execute on function public.haiku_registrar_servicio(
  uuid, text, date, time without time zone, integer, smallint,
  text, bigint, text, text, uuid
) to authenticated;

-- El wrapper del Libro conserva su contrato y ahora refleja correctamente si
-- la RPC base reutilizo un servicio tras esperar el lock.
create or replace function public.haiku_importar_servicios_libro_v1(
  p_operacion_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $function$
declare
  v_item jsonb;
  v_item_id text;
  v_marca text;
  v_reserva_id uuid;
  v_estadia_id uuid;
  v_codigo text;
  v_fecha date;
  v_hora time;
  v_cantidad integer;
  v_personas smallint;
  v_tipo_cobro text;
  v_precio_manual bigint;
  v_motivo_cortesia text;
  v_observaciones text;
  v_resultado jsonb;
  v_servicio_id uuid;
  v_creados integer := 0;
  v_omitidos integer := 0;
  v_ids jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion'; end if;
  if not private.haiku_usuario_activo() then raise exception 'Usuario no activo'; end if;
  if not private.haiku_tiene_permiso('servicios.crear') then
    raise exception 'No tiene permiso para crear servicios';
  end if;
  if p_operacion_id is null then raise exception 'Falta el identificador de operacion'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'La lista de servicios no es valida'; end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'La operacion debe contener entre 1 y 50 servicios';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(btrim(v_item->>'item_id'), '');
    if v_item_id is null or length(v_item_id) > 180 or v_item_id !~ '^[A-Za-z0-9:_\-.]+$' then
      raise exception 'Identificador de servicio del Libro no valido';
    end if;

    v_marca := '[HAKU-LIBRO-SERVICIO:' || v_item_id || ']';
    v_reserva_id := nullif(v_item->>'reserva_id', '')::uuid;
    v_estadia_id := nullif(v_item->>'estadia_id', '')::uuid;
    v_codigo := nullif(btrim(v_item->>'codigo_servicio'), '');
    v_fecha := nullif(v_item->>'fecha_servicio', '')::date;
    v_hora := nullif(v_item->>'hora', '')::time;
    v_cantidad := coalesce((v_item->>'cantidad')::integer, 1);
    v_personas := coalesce((v_item->>'personas')::smallint, 0);
    v_tipo_cobro := coalesce(nullif(btrim(v_item->>'tipo_cobro'), ''), 'normal');
    v_precio_manual := nullif(v_item->>'precio_manual', '')::bigint;
    v_motivo_cortesia := nullif(btrim(v_item->>'motivo_cortesia'), '');
    v_observaciones := nullif(btrim(v_item->>'observaciones'), '');

    if v_reserva_id is null or v_estadia_id is null or v_codigo is null or v_fecha is null then
      raise exception 'Servicio del Libro incompleto: %', v_item_id;
    end if;

    if not exists (
      select 1 from public.reserva_estadias re
      where re.id = v_estadia_id and re.reserva_id = v_reserva_id
        and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
    ) then
      raise exception 'La estadia destino cambio o ya no esta disponible: %', v_item_id;
    end if;

    v_resultado := public.haiku_registrar_servicio(
      p_reserva_id => v_reserva_id,
      p_codigo_servicio => v_codigo,
      p_fecha_servicio => v_fecha,
      p_hora => v_hora,
      p_cantidad => v_cantidad,
      p_personas => v_personas,
      p_tipo_cobro => v_tipo_cobro,
      p_precio_manual => v_precio_manual,
      p_motivo_cortesia => v_motivo_cortesia,
      p_observaciones => concat_ws(E'\n', v_observaciones, v_marca),
      p_estadia_id => v_estadia_id
    );

    v_servicio_id := nullif(v_resultado->>'servicio_id', '')::uuid;
    if coalesce((v_resultado->>'reutilizado')::boolean, false) then
      v_omitidos := v_omitidos + 1;
      v_ids := v_ids || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id, 'servicio_id', v_servicio_id,
        'estado', 'ya_importado'
      ));
    else
      v_creados := v_creados + 1;
      v_ids := v_ids || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id, 'servicio_id', v_servicio_id,
        'estado', 'creado'
      ));
    end if;
    v_servicio_id := null;
  end loop;

  return jsonb_build_object(
    'ok', true, 'operacion_id', p_operacion_id,
    'servicios_creados', v_creados, 'omitidos', v_omitidos,
    'resultados', v_ids
  );
end;
$function$;

comment on function public.haiku_importar_servicios_libro_v1(uuid, jsonb) is
'Importa servicios del Libro en una transaccion y refleja la reutilizacion atomica de la RPC base.';

revoke all on function public.haiku_importar_servicios_libro_v1(uuid, jsonb)
  from public, anon;
grant execute on function public.haiku_importar_servicios_libro_v1(uuid, jsonb)
  to authenticated;
