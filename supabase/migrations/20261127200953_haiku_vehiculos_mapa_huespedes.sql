-- Huéspedes conserva la ficha del vehículo. El mapa registra su puesto y sus movimientos.
begin;

create function private.haiku_patente_vehiculo_v1(p_patente text) returns text
language sql immutable strict security invoker set search_path = '' as $$
    select nullif(regexp_replace(upper(p_patente), '[[:space:]-]+', '', 'g'), '')
$$;
revoke all on function private.haiku_patente_vehiculo_v1(text) from public, anon, authenticated;

create unique index haiku_huesped_vehiculo_patente_reserva
    on public.haiku_huesped_vehiculos(reserva_id, private.haiku_patente_vehiculo_v1(patente))
    where private.haiku_patente_vehiculo_v1(patente) is not null;

alter table public.haiku_mapa_elementos
    add column vehiculo_id uuid references public.haiku_huesped_vehiculos(id) on delete set null,
    add constraint haiku_mapa_vehiculo_vinculado
        check (vehiculo_id is null or (tipo = 'vehiculo' and reserva_id is not null));
create unique index haiku_mapa_vehiculo_puesto_activo
    on public.haiku_mapa_elementos(vehiculo_id) where activo and vehiculo_id is not null;

create function private.haiku_mapa_datos_vehiculo_v1(p_vehiculo public.haiku_huesped_vehiculos)
returns jsonb language sql immutable strict security invoker set search_path = '' as $$
    select jsonb_build_object('vehiculo', p_vehiculo.tipo, 'patente', private.haiku_patente_vehiculo_v1(p_vehiculo.patente),
        'modelo', coalesce(p_vehiculo.modelo, ''), 'color', coalesce(p_vehiculo.color, ''))
$$;
revoke all on function private.haiku_mapa_datos_vehiculo_v1(public.haiku_huesped_vehiculos)
    from public, anon, authenticated;

create function private.haiku_mapa_vincular_vehiculo_v1(
    p_reserva uuid, p_vehiculo uuid, p_datos jsonb, p_actor uuid, p_version timestamptz default null
) returns public.haiku_huesped_vehiculos language plpgsql security invoker set search_path = '' as $$
declare
    ficha public.haiku_huesped_vehiculos;
    v_tipo text := p_datos->>'vehiculo';
    v_patente text := private.haiku_patente_vehiculo_v1(p_datos->>'patente');
    v_modelo text := nullif(btrim(p_datos->>'modelo'), '');
    v_color text := nullif(btrim(p_datos->>'color'), '');
begin
    if p_vehiculo is not null then
        select * into ficha from public.haiku_huesped_vehiculos v
        where v.id = p_vehiculo and v.reserva_id = p_reserva for update;
        if not found then
            raise exception 'El vehículo seleccionado no pertenece a esta reserva.' using errcode = '22023';
        end if;
        if p_version is not null and ficha.fecha <> p_version then
            raise exception 'La ficha del vehículo cambió. Vuelve a abrir el puesto.' using errcode = '40001';
        end if;
        -- Las fichas anteriores admiten tipos libres. Conserva el tipo al editar un puesto que lo muestra como Otro.
        if v_tipo = 'Otro' and ficha.tipo not in
            ('Sedán','Hatchback','SUV','Camioneta','Station wagon','Van','Furgón','Minibús','Moto','Otro') then
            v_tipo := ficha.tipo;
        end if;
    else
        select * into ficha from public.haiku_huesped_vehiculos v
        where v.reserva_id = p_reserva and private.haiku_patente_vehiculo_v1(v.patente) = v_patente for update;
        if found then
            -- Al asociar por patente, conserva los datos que ya estaban en Huéspedes.
            v_tipo := ficha.tipo;
            v_modelo := coalesce(ficha.modelo, v_modelo);
            v_color := coalesce(ficha.color, v_color);
        end if;
    end if;

    if ficha.id is null then
        insert into public.haiku_huesped_vehiculos(reserva_id,tipo,modelo,color,patente,operador)
        values (p_reserva,v_tipo,v_modelo,v_color,v_patente,p_actor) returning * into ficha;
    elsif row(v_tipo,v_modelo,v_color,v_patente) is distinct from row(ficha.tipo,ficha.modelo,ficha.color,ficha.patente) then
        update public.haiku_huesped_vehiculos v
        set tipo = v_tipo, modelo = v_modelo, color = v_color, patente = v_patente,
            operador = p_actor, fecha = clock_timestamp()
        where v.id = ficha.id returning * into ficha;
    end if;
    return ficha;
end
$$;
revoke all on function private.haiku_mapa_vincular_vehiculo_v1(uuid, uuid, jsonb, uuid, timestamptz)
    from public, anon, authenticated;

-- Recupera las asignaciones vigentes. La reserva y la patente normalizada deben coincidir para reutilizar una ficha.
do $$
declare
    puesto public.haiku_mapa_elementos;
    ficha public.haiku_huesped_vehiculos;
begin
    for puesto in select * from public.haiku_mapa_elementos
        where tipo = 'vehiculo' and activo and reserva_id is not null order by id loop
        ficha := private.haiku_mapa_vincular_vehiculo_v1(puesto.reserva_id, null, puesto.datos, puesto.actualizado_por);
        update public.haiku_mapa_elementos m
        set vehiculo_id = ficha.id, datos = m.datos || private.haiku_mapa_datos_vehiculo_v1(ficha),
            revision = m.revision + 1
        where m.id = puesto.id;
    end loop;
end
$$;

-- Los guardados de ambos módulos serializan sus cambios antes de tomar bloqueos de fila.
-- La proyección del mapa solo cambia si cambian los datos del vehículo; conserva sus movimientos.
create function private.haiku_mapa_actualizar_vehiculo_v1() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
    datos_vehiculo jsonb := private.haiku_mapa_datos_vehiculo_v1(new);
begin
    if not exists (
        select 1 from public.haiku_mapa_elementos m where m.vehiculo_id = new.id and m.activo
          and (m.datos || datos_vehiculo) is distinct from m.datos
    ) then return new; end if;
    if coalesce(datos_vehiculo->>'patente', '') !~ '^[A-Z0-9]{3,12}$' then
        raise exception 'El vehículo tiene un puesto asignado y necesita una patente válida.' using errcode = '22023';
    end if;
    if exists (
        select 1 from public.haiku_mapa_elementos m where m.tipo = 'vehiculo' and m.activo
          and m.vehiculo_id is distinct from new.id and m.datos->>'patente' = datos_vehiculo->>'patente'
    ) then
        raise exception 'Esta patente ya está asignada a otro puesto.' using errcode = '22023';
    end if;
    update public.haiku_mapa_elementos m
    set datos = m.datos || datos_vehiculo, revision = m.revision + 1,
        actualizado_por = new.operador, actualizado_en = clock_timestamp()
    where m.vehiculo_id = new.id and m.activo;
    return new;
end
$$;
revoke all on function private.haiku_mapa_actualizar_vehiculo_v1() from public, anon, authenticated;
create trigger haiku_mapa_actualizar_vehiculo
after update of tipo, modelo, color, patente on public.haiku_huesped_vehiculos
for each row execute function private.haiku_mapa_actualizar_vehiculo_v1();

-- Conserva la lógica, permisos y auditoría de los RPC existentes. Los puntos de inserción están versionados.
do $$
declare
    original text;
    modificado text;
    punto text;
    bloqueo text := $sql$perform pg_advisory_xact_lock(hashtextextended('haiku:vehiculos:mapa', 0));$sql$;
begin
    original := pg_get_functiondef('private.haiku_mapa_guardar_v1(uuid,text,integer,text,jsonb,uuid)'::regprocedure);
    modificado := replace(original, '    v_llegada timestamptz;',
        '    v_llegada timestamptz;' || E'\n    v_vehiculo_id uuid;\n    v_ficha_vehiculo public.haiku_huesped_vehiculos;');
    punto := '    v_solicitud := jsonb_build_object(';
    modificado := replace(modificado, punto,
        '    if p_tipo = ''vehiculo'' then ' || bloqueo || E' end if;\n' || punto);
    punto := E'        elsif p_tipo in (''persona'', ''tarea'') then';
    modificado := replace(modificado, punto, $sql$
            if (v_reserva is not null or v_actual.vehiculo_id is not null)
                and private.haiku_tiene_permiso('reservas.ver') is not true then
                raise exception 'Tu usuario no puede modificar el vehículo de esta reserva.' using errcode = '42501';
            end if;
            if v_reserva is not null then
                v_vehiculo_id := coalesce(nullif(p_datos->>'vehiculo_id', '')::uuid,
                    case when v_reserva = v_actual.reserva_id then v_actual.vehiculo_id end);
                v_ficha_vehiculo := private.haiku_mapa_vincular_vehiculo_v1(v_reserva, v_vehiculo_id,
                    v_datos, v_actor, nullif(p_datos->>'vehiculo_version', '')::timestamptz);
                v_vehiculo_id := v_ficha_vehiculo.id;
                v_datos := v_datos || private.haiku_mapa_datos_vehiculo_v1(v_ficha_vehiculo);
            end if;
$sql$ || punto);
    modificado := replace(modificado, $sql$reserva_id, dia, datos,$sql$, $sql$reserva_id, dia, datos, vehiculo_id,$sql$);
    modificado := replace(modificado, 'end, v_datos, 1, v_actor, v_ahora);',
        'end, v_datos, v_vehiculo_id, 1, v_actor, v_ahora);');
    modificado := replace(modificado, 'reserva_id = v_reserva, datos = v_datos, revision = p_revision + 1,',
        'reserva_id = v_reserva, datos = v_datos, vehiculo_id = v_vehiculo_id, revision = p_revision + 1,');
    -- Usa el mismo límite que la ficha al compartir atributos.
    modificado := replace(modificado, $sql$coalesce(p_datos->>'modelo', '')), 80)$sql$,
        $sql$coalesce(p_datos->>'modelo', '')), 120)$sql$);
    modificado := replace(modificado, $sql$coalesce(p_datos->>'color', '')), 45)$sql$,
        $sql$coalesce(p_datos->>'color', '')), 80)$sql$);
    if strpos(modificado, 'v_vehiculo_id uuid;') = 0 or strpos(modificado, bloqueo) = 0
        or strpos(modificado, 'v_ficha_vehiculo :=') = 0
        or strpos(modificado, 'datos, vehiculo_id,') = 0 or strpos(modificado, 'v_datos, v_vehiculo_id, 1') = 0
        or strpos(modificado, 'vehiculo_id = v_vehiculo_id, revision') = 0 then
        raise exception 'El guardado del mapa difiere de la versión revisada.';
    end if;
    execute modificado;

    original := pg_get_functiondef('private.haiku_huesped_guardar_v1(uuid,uuid,text,jsonb)'::regprocedure);
    punto := '  if p_accion=''crear_etiqueta'' then';
    modificado := replace(original, punto, '  if p_accion = ''vehiculo'' then ' || bloqueo || E' end if;\n' || punto);
    punto := '    insert into public.haiku_huesped_vehiculos as v(';
    modificado := replace(modificado, punto, $sql$
    if exists (
      select 1 from public.haiku_huesped_vehiculos v
      where v.reserva_id = p_reserva and v.id <> objeto_id
        and private.haiku_patente_vehiculo_v1(v.patente) = private.haiku_patente_vehiculo_v1(p_datos->>'patente')
    ) then
      raise exception 'Esta patente ya está registrada en la ficha de la reserva.' using errcode = '22023';
    end if;
    if p_datos ? 'version' and not exists (
      select 1 from public.haiku_huesped_vehiculos v
      where v.id = objeto_id and v.reserva_id = p_reserva and v.fecha = (p_datos->>'version')::timestamptz
    ) then
      raise exception 'La ficha del vehículo cambió. Vuelve a abrirla para editar.' using errcode = '40001';
    end if;
$sql$ || punto);
    modificado := replace(modificado, 'patente=excluded.patente,operador=excluded.operador,fecha=now()',
        'patente=excluded.patente,operador=excluded.operador,fecha=clock_timestamp()');
    if strpos(modificado, bloqueo) = 0 or strpos(modificado, 'v.fecha = (p_datos') = 0 then
        raise exception 'El guardado de Huéspedes difiere de la versión revisada.';
    end if;
    execute modificado;

    original := pg_get_functiondef('public.haiku_mapa_dia_v1()'::regprocedure);
    modificado := replace(original, '''datos'', m.datos, ''revision'', m.revision',
        '''datos'', m.datos, ''revision'', m.revision, ''vehiculo_id'', m.vehiculo_id');
    if modificado = original then raise exception 'La lectura del mapa difiere de la versión revisada.'; end if;
    execute modificado;

    original := pg_get_functiondef('public.haiku_huesped_perfil_v1(uuid,uuid,boolean)'::regprocedure);
    punto := $sql$'vehiculos',coalesce((select jsonb_agg(to_jsonb(v) order by v.fecha,v.id)$sql$;
    modificado := replace(original, punto, $sql$'vehiculos',coalesce((select jsonb_agg(to_jsonb(v) || jsonb_build_object(
      'estacionamiento', (select jsonb_build_object('puesto',m.puesto,'estacionado',m.datos->'estacionado')
        from public.haiku_mapa_elementos m where m.vehiculo_id=v.id and m.activo)
      ) order by v.fecha,v.id)$sql$);
    if modificado = original then raise exception 'La ficha de Huéspedes difiere de la versión revisada.'; end if;
    execute modificado;
end
$$;

notify pgrst, 'reload schema';
commit;
