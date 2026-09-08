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
    if v_tipo not in ('reserva_nueva', 'estadia', 'pago') then
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
      set titular_tipo_documento = null,
          titular_numero_documento = v_documento
      where id = v_reserva_id;
      update public.huespedes h
      set tipo_documento = null,
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

  v_respuesta := jsonb_build_object(
    'ok', true,
    'operacion_id', p_operacion_id,
    'reintento', false,
    'reservas_creadas', v_creadas,
    'estadias_agregadas', v_estadias_agregadas,
    'pagos_creados', v_pagos_creados,
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
