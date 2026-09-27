-- Extensión pendiente de aplicación. Conserva los datos históricos sin clasificarlos.
begin;

alter table public.movimientos_insumos_unidades
    add column destino text constraint movimientos_insumos_unidades_destino_v1
        check (destino in ('aseo_full', 'aseo_express', 'venta_huesped'));
comment on column public.movimientos_insumos_unidades.destino is
    'Destino obligatorio para altas nuevas; NULL identifica exclusivamente sacos históricos.';

-- Carbón mantiene una única cabecera y su cantidad canónica. El remanente sin
-- clasificar es cantidad - suma de los tres destinos; no se inventa un backfill.
alter table public.movimientos_insumos
    add column carbon_aseo_full integer not null default 0,
    add column carbon_aseo_express integer not null default 0,
    add column carbon_venta_huesped integer not null default 0,
    add constraint movimientos_insumos_carbon_destinos_v1 check (
        carbon_aseo_full >= 0 and carbon_aseo_express >= 0 and carbon_venta_huesped >= 0
        and case when insumo = 'carbon' then
            carbon_aseo_full::bigint + carbon_aseo_express + carbon_venta_huesped <= cantidad
        else carbon_aseo_full = 0 and carbon_aseo_express = 0 and carbon_venta_huesped = 0 end
    );

-- Mantener orden/tipos de las columnas existentes de la vista y añadir destinos
-- al final: las RPC de corrección/anulación conservan su tipo de retorno.
create or replace view public.movimientos_insumos_resumen with (security_invoker = true) as
select m.id, m.fecha_operativa, m.cabana_id, m.reserva_id, m.aseo_id, m.solicitud_id,
    m.insumo, m.cantidad, m.unidad, m.origen, m.registrado_por, m.actualizado_por,
    m.creado_en, m.actualizado_en,
    case when m.insumo = 'lena' then u.sacos else m.cantidad end as cantidad_actual,
    case when m.insumo = 'lena' then u.peso_kg else null end as peso_total_kg,
    u.unidades as sacos,
    case when m.insumo = 'lena' then u.destinos else jsonb_build_object(
        'aseo_full', m.carbon_aseo_full,
        'aseo_express', m.carbon_aseo_express,
        'venta_huesped', m.carbon_venta_huesped,
        'sin_especificar', m.cantidad - m.carbon_aseo_full - m.carbon_aseo_express - m.carbon_venta_huesped
    ) end as destinos
from public.movimientos_insumos m
cross join lateral (
    select count(*)::numeric as sacos, coalesce(sum(s.peso_kg), 0) as peso_kg,
        coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'peso_kg', s.peso_kg, 'creado_en', s.creado_en,
            'version', s.version, 'actualizado_en', s.actualizado_en, 'destino', s.destino)
            order by s.creado_en, s.id), '[]'::jsonb) as unidades,
        jsonb_build_object(
            'aseo_full', count(*) filter (where s.destino = 'aseo_full'),
            'aseo_express', count(*) filter (where s.destino = 'aseo_express'),
            'venta_huesped', count(*) filter (where s.destino = 'venta_huesped'),
            'sin_especificar', count(*) filter (where s.destino is null)
        ) as destinos
    from public.movimientos_insumos_unidades s
    where s.movimiento_id = m.id and s.anulado_en is null
) u;

create or replace function private.haiku_validar_saco_lena_v1() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_mov public.movimientos_insumos;
begin
    if auth.uid() is null then raise exception 'Se requiere una sesión autenticada'; end if;
    select * into v_mov from public.movimientos_insumos where id = new.movimiento_id for update;
    if v_mov.id is null or v_mov.insumo <> 'lena' or v_mov.origen <> 'aseo' then
        raise exception 'Sólo Leña admite sacos con peso';
    end if;
    if tg_op = 'INSERT' then
        if new.destino is null or new.destino not in ('aseo_full', 'aseo_express', 'venta_huesped') then
            raise exception 'Selecciona un destino válido para el saco';
        end if;
        new.registrado_por := auth.uid();
        new.creado_en := clock_timestamp();
        new.version := 1;
        if new.anulado_en is not null then raise exception 'Un saco nuevo debe estar activo'; end if;
    else
        if (new.id, new.movimiento_id, new.registrado_por, new.creado_en, new.destino)
            is distinct from (old.id, old.movimiento_id, old.registrado_por, old.creado_en, old.destino)
            or old.anulado_en is not null then
            raise exception 'La identidad y el destino del saco son inmutables; un saco anulado no se puede modificar';
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

create function public.haiku_agregar_saco_lena_v2(
    p_fecha date, p_cabana_id uuid, p_unidad_id uuid, p_peso_kg numeric, p_destino text
) returns public.movimientos_insumos_resumen
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_mov public.movimientos_insumos; v_saco public.movimientos_insumos_unidades; v_resumen public.movimientos_insumos_resumen;
begin
    if p_unidad_id is null or p_peso_kg is null or not (p_peso_kg > 0 and p_peso_kg < 'Infinity'::numeric) then
        raise exception 'El peso del saco debe ser mayor que cero';
    end if;
    if p_destino is null or p_destino not in ('aseo_full', 'aseo_express', 'venta_huesped') then
        raise exception 'Selecciona un destino válido para el saco';
    end if;
    v_mov := private.haiku_movimiento_aseo_autorizado_v1(p_fecha, p_cabana_id, 'lena');
    insert into public.movimientos_insumos_unidades(id, movimiento_id, peso_kg, destino)
    values (p_unidad_id, v_mov.id, p_peso_kg, p_destino) on conflict (id) do nothing;
    select * into v_saco from public.movimientos_insumos_unidades where id = p_unidad_id;
    -- La identidad del intento incluye su destino, incluso después de corregir/anular.
    if v_saco.movimiento_id <> v_mov.id or v_saco.destino is distinct from p_destino or coalesce(
        (select h.peso_anterior from public.movimientos_insumos_unidades_historial h
         where h.saco_id = v_saco.id and h.version_anterior = 1), v_saco.peso_kg) <> p_peso_kg then
        raise exception 'La identidad del saco ya corresponde a otro registro';
    end if;
    select * into v_resumen from public.movimientos_insumos_resumen where id = v_mov.id;
    return v_resumen;
end;
$$;
revoke all on function public.haiku_agregar_saco_lena_v2(date, uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.haiku_agregar_saco_lena_v2(date, uuid, uuid, numeric, text) to authenticated;

create function public.haiku_reponer_insumo_aseo_v2(
    p_fecha date, p_cabana_id uuid, p_insumo text, p_delta integer,
    p_cantidad_esperada numeric, p_destino text, p_cantidad_destino_esperada numeric
) returns public.movimientos_insumos_resumen
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_mov public.movimientos_insumos; v_resumen public.movimientos_insumos_resumen; v_destino numeric;
begin
    if p_insumo is distinct from 'carbon' or p_delta is null or p_delta not in (-1, 1)
        or p_cantidad_esperada is null or p_cantidad_esperada not between 0 and 999999999
        or p_cantidad_esperada <> trunc(p_cantidad_esperada)
        or p_cantidad_destino_esperada is null or p_cantidad_destino_esperada not between 0 and 999999999
        or p_cantidad_destino_esperada <> trunc(p_cantidad_destino_esperada) then
        raise exception 'Reposición no válida: Leña requiere registrar cada saco con su peso';
    end if;
    if p_destino is null or p_destino not in ('aseo_full', 'aseo_express', 'venta_huesped', 'sin_especificar')
        or (p_destino = 'sin_especificar' and p_delta <> -1) then
        raise exception 'Selecciona un destino válido; Sin especificar sólo permite reducir registros históricos';
    end if;
    v_mov := private.haiku_movimiento_aseo_autorizado_v1(p_fecha, p_cabana_id, p_insumo);
    v_destino := case p_destino
        when 'aseo_full' then v_mov.carbon_aseo_full
        when 'aseo_express' then v_mov.carbon_aseo_express
        when 'venta_huesped' then v_mov.carbon_venta_huesped
        else v_mov.cantidad - v_mov.carbon_aseo_full - v_mov.carbon_aseo_express - v_mov.carbon_venta_huesped end;
    if v_mov.cantidad <> p_cantidad_esperada or v_destino <> p_cantidad_destino_esperada then
        raise exception 'La reposición cambió en otro dispositivo. Actualiza el valor antes de continuar.' using errcode = '40001';
    end if;
    if v_mov.unidad <> 'unidad' or v_destino + p_delta < 0 then
        raise exception 'Cantidad o destino incompatible con esta reposición';
    end if;
    update public.movimientos_insumos set
        cantidad = cantidad + p_delta,
        carbon_aseo_full = carbon_aseo_full + case when p_destino = 'aseo_full' then p_delta else 0 end,
        carbon_aseo_express = carbon_aseo_express + case when p_destino = 'aseo_express' then p_delta else 0 end,
        carbon_venta_huesped = carbon_venta_huesped + case when p_destino = 'venta_huesped' then p_delta else 0 end
    where id = v_mov.id;
    select * into v_resumen from public.movimientos_insumos_resumen where id = v_mov.id;
    return v_resumen;
end;
$$;
revoke all on function public.haiku_reponer_insumo_aseo_v2(date, uuid, text, integer, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.haiku_reponer_insumo_aseo_v2(date, uuid, text, integer, numeric, text, numeric) to authenticated;

-- Los clientes antiguos no pueden generar nuevas reposiciones sin destino.
-- La corrección/anulación de sacos conserva sus RPC v1 y los históricos NULL.
revoke all on function public.haiku_agregar_saco_lena_v1(date, uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.haiku_reponer_insumo_aseo_v1(date, uuid, text, integer, numeric) from public, anon, authenticated;

-- Sin cambios en RLS, grants de tablas ni publication: las mismas dos tablas
-- publicadas ya emiten los cambios necesarios para releer el resumen.
commit;
