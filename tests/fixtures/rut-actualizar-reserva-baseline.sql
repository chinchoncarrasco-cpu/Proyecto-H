-- Cuerpo sin datos capturado por consulta de catálogo de sólo lectura; MD5 787b9b6cdf45d99257d5a6ff251f533c.
CREATE OR REPLACE FUNCTION public.haiku_actualizar_reserva(p_reserva_id uuid, p_titular_nombre text, p_cabana_numero smallint, p_fecha_ingreso date, p_fecha_salida date, p_adultos smallint DEFAULT 1, p_ninos smallint DEFAULT 0, p_mascotas smallint DEFAULT 0, p_correo_contacto text DEFAULT NULL::text, p_telefono_contacto text DEFAULT NULL::text, p_rut text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_tarifas jsonb DEFAULT '{}'::jsonb, p_acompanantes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_reserva public.reservas%rowtype;
  v_estadia public.reserva_estadias%rowtype;
  v_cabana_id uuid;
  v_cabana_numero smallint;
  v_titular_huesped_id uuid;
  v_rut_normalizado text;
  v_noche record;
  v_tarifa_text text;
  v_tarifa bigint;
  v_companion_ids uuid[] := '{}'::uuid[];
  v_companion_id uuid;
  v_nombre text;
  v_idx integer := 0;
  v_existentes integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para editar reservas';
  end if;

  if p_titular_nombre is null or btrim(p_titular_nombre) = '' then
    raise exception 'El titular es obligatorio';
  end if;

  if jsonb_typeof(coalesce(p_tarifas, '{}'::jsonb)) <> 'object' then
    raise exception 'Las tarifas deben enviarse como objeto JSON fecha → monto';
  end if;

  if jsonb_typeof(coalesce(p_acompanantes, '[]'::jsonb)) <> 'array' then
    raise exception 'Los acompañantes deben enviarse como arreglo JSON';
  end if;

  select * into v_reserva
  from public.reservas
  where id = p_reserva_id
  for update;

  if not found then
    raise exception 'La reserva no existe';
  end if;

  if v_reserva.estado_reserva in ('cancelada','no_show') then
    raise exception 'No se puede editar una reserva cancelada o no-show';
  end if;

  select * into v_estadia
  from public.reserva_estadias
  where reserva_id = p_reserva_id
    and estado_estadia not in ('cancelada','no_show')
  order by creado_en desc
  limit 1
  for update;

  if not found then
    raise exception 'La reserva no tiene una estadía activa editable';
  end if;

  select id, numero
    into v_cabana_id, v_cabana_numero
  from public.cabanas
  where numero = p_cabana_numero
    and activa = true;

  if not found then
    raise exception 'La CAB % no existe o está inactiva', p_cabana_numero;
  end if;

  -- Primera versión segura: los cambios estructurales se harán en una operación
  -- específica para no mezclar pagos/historial con un simple UPDATE.
  if v_cabana_id <> v_estadia.cabana_id
     or p_fecha_ingreso <> v_estadia.fecha_ingreso
     or p_fecha_salida <> v_estadia.fecha_salida then
    raise exception 'Por seguridad, cambiar cabaña o fechas se hará con la función de reasignación. Puedes editar titular, contacto, ocupación, acompañantes y tarifas.';
  end if;

  v_rut_normalizado := null;
  if p_rut is not null and btrim(p_rut) <> '' then
    v_rut_normalizado := regexp_replace(upper(btrim(p_rut)), '[^0-9K]', '', 'g');
  end if;

  update public.reservas
  set titular_nombre = btrim(p_titular_nombre),
      titular_tipo_documento = case when v_rut_normalizado is null then null else 'rut' end,
      titular_numero_documento = v_rut_normalizado,
      correo_contacto = nullif(btrim(coalesce(p_correo_contacto,'')), ''),
      telefono_contacto = nullif(btrim(coalesce(p_telefono_contacto,'')), ''),
      observaciones = nullif(btrim(coalesce(p_observaciones,'')), '')
  where id = p_reserva_id;

  v_titular_huesped_id := v_reserva.titular_huesped_id;

  if v_titular_huesped_id is not null then
    update public.huespedes
    set nombre = btrim(p_titular_nombre),
        tipo_documento = case when v_rut_normalizado is null then null else 'rut' end,
        numero_documento = v_rut_normalizado,
        telefono = nullif(btrim(coalesce(p_telefono_contacto,'')), ''),
        correo = nullif(btrim(coalesce(p_correo_contacto,'')), '')
    where id = v_titular_huesped_id;
  end if;

  update public.reserva_estadias
  set adultos = greatest(coalesce(p_adultos,0),0),
      ninos = greatest(coalesce(p_ninos,0),0),
      mascotas = greatest(coalesce(p_mascotas,0),0)
  where id = v_estadia.id;

  -- Actualizar tarifas de las noches existentes. El trigger financiero mantiene
  -- sincronizado el cargo de alojamiento correspondiente.
  for v_noche in
    select id, fecha, tarifa
    from public.estadia_noches
    where estadia_id = v_estadia.id
    order by fecha
  loop
    v_tarifa_text := coalesce(p_tarifas, '{}'::jsonb) ->> to_char(v_noche.fecha, 'YYYY-MM-DD');
    if v_tarifa_text is not null and btrim(v_tarifa_text) <> '' then
      begin
        v_tarifa := v_tarifa_text::bigint;
      exception when others then
        raise exception 'Tarifa inválida para la noche %', v_noche.fecha;
      end;

      if v_tarifa < 0 then
        raise exception 'La tarifa de la noche % no puede ser negativa', v_noche.fecha;
      end if;

      if v_tarifa <> v_noche.tarifa then
        update public.estadia_noches
        set tarifa = v_tarifa,
            origen_tarifa = 'manual'
        where id = v_noche.id;
      end if;
    end if;
  end loop;

  -- Reutilizar los huéspedes acompañantes existentes por orden de creación.
  select coalesce(array_agg(h.id order by h.creado_en, h.id), '{}'::uuid[])
    into v_companion_ids
  from public.reserva_huespedes rh
  join public.huespedes h on h.id = rh.huesped_id
  where rh.reserva_id = p_reserva_id
    and rh.huesped_id is distinct from v_titular_huesped_id;

  v_existentes := coalesce(array_length(v_companion_ids, 1), 0);

  for v_nombre in
    select btrim(value)
    from jsonb_array_elements_text(coalesce(p_acompanantes, '[]'::jsonb))
    where btrim(value) <> ''
  loop
    v_idx := v_idx + 1;

    if v_idx <= v_existentes then
      v_companion_id := v_companion_ids[v_idx];
      update public.huespedes
      set nombre = v_nombre
      where id = v_companion_id;

      insert into public.estadia_huespedes(estadia_id, huesped_id)
      values (v_estadia.id, v_companion_id)
      on conflict (estadia_id, huesped_id) do nothing;
    else
      insert into public.huespedes(nombre)
      values (v_nombre)
      returning id into v_companion_id;

      insert into public.reserva_huespedes(reserva_id, huesped_id)
      values (p_reserva_id, v_companion_id)
      on conflict (reserva_id, huesped_id) do nothing;

      insert into public.estadia_huespedes(estadia_id, huesped_id)
      values (v_estadia.id, v_companion_id)
      on conflict (estadia_id, huesped_id) do nothing;
    end if;
  end loop;

  if v_idx < v_existentes then
    for i in (v_idx + 1)..v_existentes loop
      delete from public.estadia_huespedes
      where estadia_id = v_estadia.id
        and huesped_id = v_companion_ids[i];

      delete from public.reserva_huespedes
      where reserva_id = p_reserva_id
        and huesped_id = v_companion_ids[i];
    end loop;
  end if;

  return jsonb_build_object(
    'reserva_id', p_reserva_id,
    'estadia_id', v_estadia.id,
    'cabana_numero', p_cabana_numero,
    'fecha_ingreso', p_fecha_ingreso,
    'fecha_salida', p_fecha_salida,
    'actualizada', true
  );
end;
$function$
