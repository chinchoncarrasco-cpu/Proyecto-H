-- Reposición de Aseo. Preparada para revisión; no aplicar automáticamente.
-- No modifica estados, horarios, checklists, reservas ni solicitudes existentes.
begin;

-- La FK compuesta impide atribuir un movimiento a otra fecha/cabaña del aseo.
create unique index aseos_id_fecha_cabana_insumos_uq on public.aseos(id, fecha, cabana_id);

create table public.movimientos_insumos (
    id uuid primary key default gen_random_uuid(),
    fecha_operativa date not null,
    cabana_id uuid not null references public.cabanas(id) on delete restrict,
    reserva_id uuid references public.reservas(id) on delete restrict,
    aseo_id uuid,
    solicitud_id uuid references public.solicitudes(id) on delete restrict,
    insumo text not null check (insumo ~ '^[a-z][a-z0-9_]{0,49}$'),
    -- Sin escala fija: una fracción pequeña tampoco se redondea antes del CHECK.
    cantidad numeric default 0 constraint movimientos_insumos_cantidad_v1
        check ((insumo = 'lena' and cantidad is null) or
            (insumo <> 'lena' and cantidad is not null and cantidad between 0 and 999999999 and cantidad = trunc(cantidad))),
    unidad text not null default 'unidad' constraint movimientos_insumos_unidad_v1 check (unidad = 'unidad'),
    origen text not null,
    registrado_por uuid not null references public.usuarios(id) on delete restrict,
    actualizado_por uuid not null references public.usuarios(id) on delete restrict,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    constraint movimientos_insumos_aseo_fk foreign key (aseo_id, fecha_operativa, cabana_id)
        references public.aseos(id, fecha, cabana_id) on delete restrict,
    constraint movimientos_insumos_origen_v1 check (origen = 'aseo' and aseo_id is not null and solicitud_id is null),
    constraint movimientos_insumos_aseo_uq unique (fecha_operativa, cabana_id, aseo_id, insumo, origen)
);
comment on table public.movimientos_insumos is
    'Cabecera canónica. Carbón conserva cantidad entera; Leña usa cantidad NULL y deriva sacos/kg de unidades activas.';
comment on column public.movimientos_insumos.insumo is
    'Código extensible: inicialmente lena y carbon; agregar otros no requiere columnas nuevas.';
comment on column public.movimientos_insumos.solicitud_id is
    'Reservado para una segunda etapa. El CHECK y las políticas actuales sólo autorizan origen aseo.';

create index movimientos_insumos_dia_idx on public.movimientos_insumos(fecha_operativa, origen);
create index movimientos_insumos_cabana_idx on public.movimientos_insumos(cabana_id);
create index movimientos_insumos_aseo_idx on public.movimientos_insumos(aseo_id);
create index movimientos_insumos_reserva_idx on public.movimientos_insumos(reserva_id) where reserva_id is not null;
create index movimientos_insumos_solicitud_idx on public.movimientos_insumos(solicitud_id) where solicitud_id is not null;
create index movimientos_insumos_registrado_idx on public.movimientos_insumos(registrado_por);
create index movimientos_insumos_actualizado_idx on public.movimientos_insumos(actualizado_por);

alter table public.movimientos_insumos enable row level security;
revoke all on public.movimientos_insumos from public, anon, authenticated;
grant select on public.movimientos_insumos to authenticated;

-- Mismos permisos operativos que aseos, incluida la asignación del usuario.
create policy movimientos_insumos_select on public.movimientos_insumos
for select to authenticated using (
    (select private.haiku_usuario_activo()) and origen = 'aseo' and exists (
        select 1 from public.aseos a where a.id = aseo_id and (
            (select private.haiku_tiene_permiso('aseos.ver_todos')) or
            ((select private.haiku_tiene_permiso('aseos.ver_asignados')) and a.asignado_a = (select auth.uid()))
        )
    )
);
-- Sin policies de escritura: sólo la RPC canónica puede modificar cantidades.

create table public.movimientos_insumos_unidades (
    id uuid primary key default gen_random_uuid(),
    movimiento_id uuid not null references public.movimientos_insumos(id) on delete restrict,
    peso_kg numeric not null constraint movimientos_insumos_unidades_peso_v1
        check (peso_kg > 0 and peso_kg < 'Infinity'::numeric),
    registrado_por uuid not null references public.usuarios(id) on delete restrict,
    creado_en timestamptz not null default now(),
    actualizado_por uuid not null references public.usuarios(id) on delete restrict,
    actualizado_en timestamptz not null default now(),
    version integer not null default 1 check (version > 0),
    anulado_en timestamptz
);
create index movimientos_insumos_unidades_movimiento_idx on public.movimientos_insumos_unidades(movimiento_id);
create index movimientos_insumos_unidades_registrado_idx on public.movimientos_insumos_unidades(registrado_por);
create index movimientos_insumos_unidades_actualizado_idx on public.movimientos_insumos_unidades(actualizado_por);
alter table public.movimientos_insumos_unidades enable row level security;
revoke all on public.movimientos_insumos_unidades from public, anon, authenticated;
grant select on public.movimientos_insumos_unidades to authenticated;
create policy movimientos_insumos_unidades_select on public.movimientos_insumos_unidades
for select to authenticated using (exists (
    select 1 from public.movimientos_insumos m where m.id = movimiento_id and m.insumo = 'lena' and m.origen = 'aseo'
));

create table public.movimientos_insumos_unidades_historial (
    id uuid primary key default gen_random_uuid(),
    saco_id uuid not null references public.movimientos_insumos_unidades(id) on delete restrict,
    peso_anterior numeric not null check (peso_anterior > 0 and peso_anterior < 'Infinity'::numeric),
    peso_nuevo numeric not null check (peso_nuevo > 0 and peso_nuevo < 'Infinity'::numeric),
    version_anterior integer not null check (version_anterior > 0),
    version_nueva integer not null check (version_nueva = version_anterior + 1),
    corregido_por uuid not null references public.usuarios(id) on delete restrict,
    corregido_en timestamptz not null,
    check (peso_anterior <> peso_nuevo),
    unique (saco_id, version_nueva)
);
create index movimientos_insumos_historial_autor_idx on public.movimientos_insumos_unidades_historial(corregido_por);
alter table public.movimientos_insumos_unidades_historial enable row level security;
revoke all on public.movimientos_insumos_unidades_historial from public, anon, authenticated;
grant select on public.movimientos_insumos_unidades_historial to authenticated;
create policy movimientos_insumos_historial_select on public.movimientos_insumos_unidades_historial
for select to authenticated using (exists (
    select 1 from public.movimientos_insumos_unidades s where s.id = saco_id
));

-- Una única lectura consistente: la cantidad de Leña nunca se almacena por separado.
create view public.movimientos_insumos_resumen with (security_invoker = true) as
select m.*, case when m.insumo = 'lena' then u.sacos else m.cantidad end as cantidad_actual,
    case when m.insumo = 'lena' then u.peso_kg else null end as peso_total_kg,
    u.unidades as sacos
from public.movimientos_insumos m
cross join lateral (
    select count(*)::numeric as sacos, coalesce(sum(s.peso_kg), 0) as peso_kg,
        coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'peso_kg', s.peso_kg, 'creado_en', s.creado_en,
            'version', s.version, 'actualizado_en', s.actualizado_en)
            order by s.creado_en, s.id), '[]'::jsonb) as unidades
    from public.movimientos_insumos_unidades s
    where s.movimiento_id = m.id and s.anulado_en is null
) u;
revoke all on public.movimientos_insumos_resumen from public, anon, authenticated;
grant select on public.movimientos_insumos_resumen to authenticated;

create function private.haiku_validar_saco_lena_v1() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_mov public.movimientos_insumos;
begin
    if auth.uid() is null then raise exception 'Se requiere una sesión autenticada'; end if;
    select * into v_mov from public.movimientos_insumos where id = new.movimiento_id for update;
    if v_mov.id is null or v_mov.insumo <> 'lena' or v_mov.origen <> 'aseo' then
        raise exception 'Sólo Leña admite sacos con peso';
    end if;
    if tg_op = 'INSERT' then
        new.registrado_por := auth.uid();
        new.creado_en := clock_timestamp();
        new.version := 1;
        if new.anulado_en is not null then raise exception 'Un saco nuevo debe estar activo'; end if;
    else
        if (new.id, new.movimiento_id, new.registrado_por, new.creado_en)
            is distinct from (old.id, old.movimiento_id, old.registrado_por, old.creado_en)
            or old.anulado_en is not null then
            raise exception 'La identidad del saco es inmutable y un saco anulado no se puede modificar';
        end if;
        if new.anulado_en is not null then
            if new.peso_kg is distinct from old.peso_kg then raise exception 'Anular no permite cambiar el peso'; end if;
            new.anulado_en := clock_timestamp();
        elsif new.peso_kg is not distinct from old.peso_kg then
            raise exception 'No hay una corrección de peso';
        end if;
        new.version := old.version + 1;
    end if;
    new.actualizado_por := auth.uid();
    new.actualizado_en := clock_timestamp();
    return new;
end;
$$;
revoke all on function private.haiku_validar_saco_lena_v1() from public, anon, authenticated;
create trigger validar_saco_lena before insert or update on public.movimientos_insumos_unidades
for each row execute function private.haiku_validar_saco_lena_v1();

-- AFTER garantiza que sólo quede evidencia de cambios que realmente se guardaron.
create function private.haiku_auditar_peso_saco_v1() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
    insert into public.movimientos_insumos_unidades_historial
        (saco_id, peso_anterior, peso_nuevo, version_anterior, version_nueva, corregido_por, corregido_en)
    values (new.id, old.peso_kg, new.peso_kg, old.version, new.version, new.actualizado_por, new.actualizado_en);
    return new;
end;
$$;
revoke all on function private.haiku_auditar_peso_saco_v1() from public, anon, authenticated;
create trigger auditar_peso_saco after update on public.movimientos_insumos_unidades
for each row when (old.peso_kg is distinct from new.peso_kg) execute function private.haiku_auditar_peso_saco_v1();

create function private.haiku_preservar_historial_saco_v1() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
    raise exception 'El historial de correcciones es inmutable';
end;
$$;
revoke all on function private.haiku_preservar_historial_saco_v1() from public, anon, authenticated;
create trigger preservar_historial_saco before update or delete on public.movimientos_insumos_unidades_historial
for each row execute function private.haiku_preservar_historial_saco_v1();

create function private.haiku_validar_movimiento_insumo_v1() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_reservas uuid[];
begin
    if auth.uid() is null then raise exception 'Se requiere una sesión autenticada'; end if;
    if tg_op = 'INSERT' then
        new.registrado_por := auth.uid();
        new.creado_en := now();
        -- Ambos extremos son inclusivos: salida + ingreso de huéspedes distintos
        -- en el día producen ambigüedad. Nunca se toma una reserva del DOM/cache.
        -- Sin permiso para ver TODAS las estadías no se puede probar unicidad.
        new.reserva_id := null;
        if private.haiku_tiene_permiso('reservas.ver') then
            select array_agg(distinct e.reserva_id) into v_reservas
            from public.reserva_estadias e join public.reservas r on r.id = e.reserva_id
            where e.cabana_id = new.cabana_id
              and new.fecha_operativa between e.fecha_ingreso and e.fecha_salida
              and e.estado_estadia not in ('cancelada', 'no_show')
              and r.estado_reserva not in ('cancelada', 'no_show');
            if cardinality(v_reservas) = 1 then new.reserva_id := v_reservas[1]; end if;
        end if;
    else
        if (new.id, new.fecha_operativa, new.cabana_id, new.aseo_id, new.solicitud_id,
            new.insumo, new.origen, new.unidad, new.reserva_id, new.registrado_por, new.creado_en)
           is distinct from
           (old.id, old.fecha_operativa, old.cabana_id, old.aseo_id, old.solicitud_id,
            old.insumo, old.origen, old.unidad, old.reserva_id, old.registrado_por, old.creado_en) then
            raise exception 'La identidad del movimiento no se puede modificar';
        end if;
    end if;
    new.actualizado_por := auth.uid();
    new.actualizado_en := clock_timestamp();
    return new;
end;
$$;
revoke all on function private.haiku_validar_movimiento_insumo_v1() from public, anon, authenticated;
create trigger validar_movimiento_insumo before insert or update on public.movimientos_insumos
for each row execute function private.haiku_validar_movimiento_insumo_v1();

create function private.haiku_movimiento_aseo_autorizado_v1(p_fecha date, p_cabana_id uuid, p_insumo text)
returns public.movimientos_insumos
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare
    v_aseo public.aseos;
    v_mov public.movimientos_insumos;
    v_usuario uuid := auth.uid();
begin
    if v_usuario is null or private.haiku_usuario_activo() is not true then
        raise exception 'Se requiere un usuario activo';
    end if;
    if p_fecha is null or p_cabana_id is null or p_insumo is null or p_insumo not in ('lena', 'carbon') then
        raise exception 'Reposición no válida';
    end if;
    -- Mantener estable la asignación mientras se comprueban permisos y se escribe.
    select * into v_aseo from public.aseos where fecha = p_fecha and cabana_id = p_cabana_id for share;
    if v_aseo.id is null then
        -- Un aseo nuevo no tiene asignado: se requieren gestión y visibilidad globales.
        if (private.haiku_tiene_permiso('aseos.gestionar_todos') and
            private.haiku_tiene_permiso('aseos.ver_todos')) is not true then
            raise exception 'Sin permiso para reponer insumos de este aseo' using errcode = '42501';
        end if;
        -- Sólo una acción explícita crea el aseo. No actualiza uno ya existente.
        insert into public.aseos(fecha, cabana_id, tipo_aseo, estado, creado_por)
        values (p_fecha, p_cabana_id, 'salida', 'pendiente', v_usuario)
        on conflict (fecha, cabana_id) do nothing;
        select * into v_aseo from public.aseos where fecha = p_fecha and cabana_id = p_cabana_id for share;
    end if;
    if v_aseo.id is null then raise exception 'No se pudo verificar el aseo de esta fecha'; end if;
    -- SECURITY DEFINER exige reproducir tanto SELECT como gestión, sin confiar
    -- en identidades/asignaciones enviadas por el cliente ni aceptar NULL como permiso.
    if ((private.haiku_tiene_permiso('aseos.ver_todos') or
         (private.haiku_tiene_permiso('aseos.ver_asignados') and v_aseo.asignado_a = v_usuario)) and
        (private.haiku_tiene_permiso('aseos.gestionar_todos') or
         (private.haiku_tiene_permiso('aseos.gestionar_asignados') and v_aseo.asignado_a = v_usuario))) is not true then
        raise exception 'Sin permiso para reponer insumos de este aseo' using errcode = '42501';
    end if;
    -- INSERT ON CONFLICT + bloqueo de fila serializan tanto la creación como los cambios.
    insert into public.movimientos_insumos(fecha_operativa, cabana_id, aseo_id, insumo, cantidad, unidad, origen, registrado_por, actualizado_por)
    values (p_fecha, p_cabana_id, v_aseo.id, p_insumo, case when p_insumo = 'lena' then null else 0 end, 'unidad', 'aseo', v_usuario, v_usuario)
    on conflict on constraint movimientos_insumos_aseo_uq do nothing;
    select * into v_mov from public.movimientos_insumos
    where fecha_operativa = p_fecha and cabana_id = p_cabana_id and aseo_id = v_aseo.id and insumo = p_insumo
    for update;
    if v_mov.id is null then raise exception 'No se pudo verificar la reposición'; end if;
    return v_mov;
end;
$$;
revoke all on function private.haiku_movimiento_aseo_autorizado_v1(date, uuid, text) from public, anon, authenticated;

create function public.haiku_reponer_insumo_aseo_v1(
    p_fecha date, p_cabana_id uuid, p_insumo text, p_delta integer, p_cantidad_esperada numeric
) returns public.movimientos_insumos_resumen
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_mov public.movimientos_insumos; v_resumen public.movimientos_insumos_resumen;
begin
    if p_insumo is distinct from 'carbon' or p_delta is null or p_delta not in (-1, 1) or p_cantidad_esperada is null
        or p_cantidad_esperada not between 0 and 999999999 or p_cantidad_esperada <> trunc(p_cantidad_esperada) then
        raise exception 'Reposición no válida: Leña requiere registrar cada saco con su peso';
    end if;
    v_mov := private.haiku_movimiento_aseo_autorizado_v1(p_fecha, p_cabana_id, p_insumo);
    if v_mov.cantidad <> p_cantidad_esperada then
        raise exception 'La reposición cambió en otro dispositivo. Actualiza el valor antes de continuar.' using errcode = '40001';
    end if;
    if v_mov.unidad <> 'unidad' or v_mov.cantidad <> trunc(v_mov.cantidad) or v_mov.cantidad + p_delta < 0 then
        raise exception 'Cantidad o unidad incompatible con esta interfaz';
    end if;
    update public.movimientos_insumos set cantidad = cantidad + p_delta where id = v_mov.id returning * into v_mov;
    if not found then raise exception 'Sin permiso para actualizar la reposición'; end if;
    select * into v_resumen from public.movimientos_insumos_resumen where id = v_mov.id;
    return v_resumen;
end;
$$;
revoke all on function public.haiku_reponer_insumo_aseo_v1(date, uuid, text, integer, numeric) from public, anon, authenticated;
grant execute on function public.haiku_reponer_insumo_aseo_v1(date, uuid, text, integer, numeric) to authenticated;

create function public.haiku_agregar_saco_lena_v1(p_fecha date, p_cabana_id uuid, p_unidad_id uuid, p_peso_kg numeric)
returns public.movimientos_insumos_resumen
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_mov public.movimientos_insumos; v_saco public.movimientos_insumos_unidades; v_resumen public.movimientos_insumos_resumen;
begin
    if p_unidad_id is null or p_peso_kg is null or not (p_peso_kg > 0 and p_peso_kg < 'Infinity'::numeric) then
        raise exception 'El peso del saco debe ser mayor que cero';
    end if;
    v_mov := private.haiku_movimiento_aseo_autorizado_v1(p_fecha, p_cabana_id, 'lena');
    insert into public.movimientos_insumos_unidades(id, movimiento_id, peso_kg)
    values (p_unidad_id, v_mov.id, p_peso_kg) on conflict (id) do nothing;
    select * into v_saco from public.movimientos_insumos_unidades where id = p_unidad_id;
    -- Un retry del alta original sigue siendo idempotente aunque luego se corrigiera el peso.
    if v_saco.movimiento_id <> v_mov.id or coalesce(
        (select h.peso_anterior from public.movimientos_insumos_unidades_historial h
         where h.saco_id = v_saco.id and h.version_anterior = 1), v_saco.peso_kg) <> p_peso_kg then
        raise exception 'La identidad del saco ya corresponde a otro registro';
    end if;
    select * into v_resumen from public.movimientos_insumos_resumen where id = v_mov.id;
    return v_resumen;
end;
$$;
revoke all on function public.haiku_agregar_saco_lena_v1(date, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.haiku_agregar_saco_lena_v1(date, uuid, uuid, numeric) to authenticated;

create function public.haiku_anular_saco_lena_v1(p_unidad_id uuid)
returns public.movimientos_insumos_resumen
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_mov public.movimientos_insumos; v_resumen public.movimientos_insumos_resumen;
begin
    if auth.uid() is null or private.haiku_usuario_activo() is not true then raise exception 'Se requiere un usuario activo'; end if;
    select m.* into v_mov from public.movimientos_insumos m
        join public.movimientos_insumos_unidades s on s.movimiento_id = m.id where s.id = p_unidad_id;
    if v_mov.id is null then raise exception 'No se pudo verificar el saco'; end if;
    v_mov := private.haiku_movimiento_aseo_autorizado_v1(v_mov.fecha_operativa, v_mov.cabana_id, 'lena');
    update public.movimientos_insumos_unidades set anulado_en = clock_timestamp()
        where id = p_unidad_id and movimiento_id = v_mov.id and anulado_en is null;
    select * into v_resumen from public.movimientos_insumos_resumen where id = v_mov.id;
    return v_resumen;
end;
$$;
revoke all on function public.haiku_anular_saco_lena_v1(uuid) from public, anon, authenticated;
grant execute on function public.haiku_anular_saco_lena_v1(uuid) to authenticated;

create function public.haiku_editar_peso_saco_lena_v1(p_unidad_id uuid, p_peso_kg numeric, p_version_esperada integer)
returns public.movimientos_insumos_resumen
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_mov public.movimientos_insumos; v_saco public.movimientos_insumos_unidades; v_resumen public.movimientos_insumos_resumen;
begin
    if auth.uid() is null or private.haiku_usuario_activo() is not true then raise exception 'Se requiere un usuario activo'; end if;
    if p_peso_kg is null or not (p_peso_kg > 0 and p_peso_kg < 'Infinity'::numeric)
        or p_version_esperada is null or p_version_esperada < 1 then
        raise exception 'Peso o versión no válidos';
    end if;
    select m.* into v_mov from public.movimientos_insumos m
        join public.movimientos_insumos_unidades s on s.movimiento_id = m.id where s.id = p_unidad_id;
    if v_mov.id is null or v_mov.insumo <> 'lena' then raise exception 'No se pudo verificar el saco de Leña'; end if;
    v_mov := private.haiku_movimiento_aseo_autorizado_v1(v_mov.fecha_operativa, v_mov.cabana_id, 'lena');
    select * into v_saco from public.movimientos_insumos_unidades where id = p_unidad_id for update;
    if v_saco.anulado_en is not null then raise exception 'El saco está anulado'; end if;
    if v_saco.version <> p_version_esperada then
        raise exception 'El saco cambió en otro dispositivo. Revisa el peso actualizado.' using errcode = '40001';
    end if;
    if v_saco.peso_kg <> p_peso_kg then
        update public.movimientos_insumos_unidades set peso_kg = p_peso_kg where id = v_saco.id;
    end if;
    select * into v_resumen from public.movimientos_insumos_resumen where id = v_mov.id;
    return v_resumen;
end;
$$;
revoke all on function public.haiku_editar_peso_saco_lena_v1(uuid, numeric, integer) from public, anon, authenticated;
grant execute on function public.haiku_editar_peso_saco_lena_v1(uuid, numeric, integer) to authenticated;

-- Usa la publicación y el canal de Aseo existentes.
alter publication supabase_realtime add table public.movimientos_insumos;
alter publication supabase_realtime add table public.movimientos_insumos_unidades;
commit;
