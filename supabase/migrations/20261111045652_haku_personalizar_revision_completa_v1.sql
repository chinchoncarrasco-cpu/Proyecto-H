-- Las plantillas de Revisión completa son versiones inmutables por cabaña.
-- El catálogo y las revisiones existentes conservan sus identificadores y datos.

create table private.haku_revision_versiones (
    id uuid primary key references public.checklist_plantillas(id) on delete restrict,
    cabana_id uuid not null references public.cabanas(id) on delete restrict,
    version integer not null check (version > 0),
    grupos jsonb not null check (jsonb_typeof(grupos) = 'array'),
    publicado_por uuid not null references public.usuarios(id) on delete restrict,
    publicado_en timestamptz not null default clock_timestamp(),
    huella bytea not null,
    unique (cabana_id, version)
);

alter table private.haku_revision_versiones enable row level security;
revoke all on table private.haku_revision_versiones from public, anon, authenticated;

create function private.haku_revision_grupos_base_v1(p_cabana_id uuid)
returns jsonb language sql stable set search_path = ''
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'label', g.label, 'items', g.items
    ) order by g.orden, g.id), '[]'::jsonb)
    from (
        select regexp_replace(c.legacy_checklist_id, '-[0-9]+$', '') as id,
               min(c.subarea) as label, min(c.orden_visual) as orden,
               jsonb_agg(jsonb_build_object(
                   'id', c.legacy_checklist_id, 'label', i.nombre, 'active', true,
                   'itemId', c.checklist_item_id, 'expected', c.cantidad_esperada,
                   'required', c.obligatorio
               ) order by c.orden_visual, c.legacy_checklist_id) as items
        from public.cabana_checklist_config c
        join public.checklist_items i on i.id = c.checklist_item_id
        where c.cabana_id = p_cabana_id and c.activo
          and c.legacy_checklist_id ~ '^[0-3](-[0-9]+){1,2}$'
        group by 1
    ) g
$$;

create function private.haku_revision_puede_editar_v1()
returns boolean language sql stable set search_path = ''
as $$
    select auth.uid() is not null
       and private.haiku_usuario_activo() is true
       and private.haiku_tiene_permiso('configuracion.gestionar') is true
       and private.haiku_tiene_permiso('cabanas.ver') is true
       and private.haiku_tiene_permiso('revisiones.ver') is true
$$;

create function private.haku_revision_plantillas_v1(p_fecha date, p_cabana_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
    if auth.uid() is null or private.haiku_usuario_activo() is not true
       or private.haiku_tiene_permiso('cabanas.ver') is not true
       or private.haiku_tiene_permiso('revisiones.ver') is not true then
        raise exception 'No tienes permiso para ver las revisiones.' using errcode = '42501';
    end if;

    return jsonb_build_object(
        'can_edit', private.haku_revision_puede_editar_v1(),
        'templates', coalesce((
            select jsonb_agg(jsonb_build_object(
                'cabana_id', c.id, 'numero', c.numero, 'revision_id', r.id,
                'version_id', v.id, 'groups', v.grupos
            ) order by c.numero)
            from public.cabanas c
            left join lateral (
                select rev.id, rev.plantilla_id
                from public.revisiones_cabana rev
                where rev.cabana_id = c.id and rev.fecha = p_fecha
                  and rev.tipo_revision = 'completa' and rev.estado <> 'cancelada'
                order by rev.creado_en desc, rev.id desc
                limit 1
            ) r on true
            join lateral (
                select ver.id, ver.grupos
                from private.haku_revision_versiones ver
                where ver.cabana_id = c.id
                  and ((r.id is not null and ver.id = r.plantilla_id)
                      or (r.id is null and p_fecha >= timezone('America/Santiago', ver.publicado_en)::date))
                order by ver.version desc
                limit 1
            ) v on true
            where c.activa and (p_cabana_id is null or c.id = p_cabana_id)
        ), '[]'::jsonb)
    );
end;
$$;

create function private.haku_revision_plantilla_editar_v1(p_cabana_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
    v_head private.haku_revision_versiones%rowtype;
    v_groups jsonb;
begin
    if private.haku_revision_puede_editar_v1() is not true then
        raise exception 'Solo un administrador puede personalizar la revisión.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.cabanas c where c.id = p_cabana_id and c.activa) then
        raise exception 'La cabaña seleccionada no está disponible.' using errcode = '22023';
    end if;

    select v.* into v_head from private.haku_revision_versiones v
    where v.cabana_id = p_cabana_id order by v.version desc limit 1;
    v_groups := coalesce(v_head.grupos, private.haku_revision_grupos_base_v1(p_cabana_id));
    if jsonb_array_length(v_groups) = 0 then
        raise exception 'La cabaña no tiene una lista de revisión completa.' using errcode = '22023';
    end if;

    return jsonb_build_object('version_id', v_head.id, 'request_id', gen_random_uuid(), 'groups', v_groups);
end;
$$;

create function private.haku_revision_plantilla_guardar_v1(
    p_cabana_id uuid, p_version_id uuid, p_request_id uuid, p_groups jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
    v_user uuid := auth.uid();
    v_head private.haku_revision_versiones%rowtype;
    v_request private.haku_revision_versiones%rowtype;
    v_hash bytea;
    v_base jsonb;
    v_group jsonb;
    v_base_group jsonb;
    v_item jsonb;
    v_old_item jsonb;
    v_groups jsonb := '[]'::jsonb;
    v_items jsonb;
    v_group_index integer := 0;
    v_key text;
    v_label text;
    v_group_label text;
    v_active boolean;
    v_seen text[] := array[]::text[];
    v_item_id uuid;
    v_published_at timestamptz;
    v_author text;
begin
    if private.haku_revision_puede_editar_v1() is not true then
        raise exception 'Solo un administrador puede personalizar la revisión.' using errcode = '42501';
    end if;
    if p_request_id is null or jsonb_typeof(p_groups) is distinct from 'array'
       or pg_column_size(p_groups) > 262144 then
        raise exception 'El borrador de revisión no es válido.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.cabanas c where c.id = p_cabana_id and c.activa) then
        raise exception 'La cabaña seleccionada no está disponible.' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_cabana_id::text, 61111));
    v_hash := sha256(convert_to(p_groups::text, 'UTF8'));
    select v.* into v_request from private.haku_revision_versiones v where v.id = p_request_id;
    if found then
        if v_request.cabana_id is distinct from p_cabana_id
           or v_request.publicado_por is distinct from v_user
           or v_request.huella is distinct from v_hash then
            raise exception 'Esta solicitud de guardado ya fue utilizada.' using errcode = '23505';
        end if;
        select u.nombre into v_author from public.usuarios u where u.id = v_user;
        return jsonb_build_object('version_id', v_request.id, 'published_at', v_request.publicado_en, 'author', v_author);
    end if;

    select v.* into v_head from private.haku_revision_versiones v
    where v.cabana_id = p_cabana_id order by v.version desc limit 1;
    if p_version_id is distinct from v_head.id then
        raise exception 'La lista cambió en otro dispositivo. Abre el editor nuevamente para ver la última versión.'
            using errcode = '40001';
    end if;

    v_base := coalesce(v_head.grupos, private.haku_revision_grupos_base_v1(p_cabana_id));
    if jsonb_array_length(v_base) = 0 or jsonb_array_length(p_groups) <> jsonb_array_length(v_base) then
        raise exception 'La estructura de áreas de la revisión cambió.' using errcode = '22023';
    end if;

    for v_group in select value from jsonb_array_elements(p_groups) loop
        v_base_group := v_base -> v_group_index;
        v_group_index := v_group_index + 1;
        if v_group->>'id' is distinct from v_base_group->>'id'
           or jsonb_typeof(v_group->'items') is distinct from 'array' then
            raise exception 'Las áreas y el orden de sus subáreas se conservan.' using errcode = '22023';
        end if;

        v_group_label := null;
        if v_base_group->>'label' is not null then
            v_group_label := btrim(v_group->>'label');
            if jsonb_typeof(v_group->'label') is distinct from 'string'
               or char_length(v_group_label) not between 1 and 120 or v_group_label ~ '[[:cntrl:]]' then
                raise exception 'Escribe un nombre válido para la subárea.' using errcode = '22023';
            end if;
        elsif v_group->>'label' is not null then
            raise exception 'El nombre de un área principal no se puede editar.' using errcode = '22023';
        end if;

        v_items := '[]'::jsonb;
        for v_item in select value from jsonb_array_elements(v_group->'items') loop
            v_key := v_item->>'id';
            v_label := btrim(v_item->>'label');
            if v_key is null or v_key = any(v_seen)
               or jsonb_typeof(v_item->'label') is distinct from 'string'
               or char_length(v_label) not between 1 and 120 or v_label ~ '[[:cntrl:]]'
               or jsonb_typeof(v_item->'active') is distinct from 'boolean' then
                raise exception 'Revisa los nombres y los identificadores de los elementos.' using errcode = '22023';
            end if;
            v_seen := array_append(v_seen, v_key);
            v_active := (v_item->>'active')::boolean;

            select value into v_old_item from jsonb_array_elements(v_base_group->'items') where value->>'id' = v_key;
            if found then
                v_item := v_old_item || jsonb_build_object('label', v_label, 'active', v_active);
            else
                if v_key !~ ('^nuevo-' || p_request_id::text || '-[1-9][0-9]*$') or not v_active then
                    raise exception 'Un elemento existente debe conservar su subárea e identificador.' using errcode = '22023';
                end if;
                insert into public.checklist_items (nombre, categoria)
                values (v_label, 'REVISIÓN COMPLETA PERSONALIZADA')
                returning id into v_item_id;
                v_item := jsonb_build_object('id', v_key, 'label', v_label, 'active', true,
                    'itemId', v_item_id, 'expected', null, 'required', true);
            end if;
            v_items := v_items || jsonb_build_array(v_item);
        end loop;

        if exists (select 1 from jsonb_array_elements(v_base_group->'items') b where not (b.value->>'id' = any(v_seen))) then
            raise exception 'Desactiva los elementos existentes para conservar su historial.' using errcode = '22023';
        end if;

        v_groups := v_groups || jsonb_build_array(jsonb_build_object(
            'id', v_base_group->>'id', 'label', v_group_label, 'items', v_items));
    end loop;

    insert into public.checklist_plantillas (id, codigo, nombre, tipo)
    select p_request_id, 'haku-completa-' || p_request_id::text, 'Revisión completa · Cabaña ' || c.numero, 'completa'
    from public.cabanas c where c.id = p_cabana_id;

    insert into public.checklist_plantilla_items (plantilla_id, checklist_item_id, obligatorio, orden_visual)
    select p_request_id, (i.value->>'itemId')::uuid, (i.value->>'required')::boolean,
           row_number() over (order by g.orden, i.orden)::integer
    from jsonb_array_elements(v_groups) with ordinality g(value, orden)
    cross join lateral jsonb_array_elements(g.value->'items') with ordinality i(value, orden)
    where (i.value->>'active')::boolean;

    insert into private.haku_revision_versiones (id, cabana_id, version, grupos, publicado_por, huella)
    values (p_request_id, p_cabana_id, coalesce(v_head.version, 0) + 1, v_groups, v_user, v_hash)
    returning publicado_en into v_published_at;
    select u.nombre into v_author from public.usuarios u where u.id = v_user;
    return jsonb_build_object('version_id', p_request_id, 'published_at', v_published_at, 'author', v_author);
end;
$$;

create function private.haku_revision_fijar_plantilla_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        if new.plantilla_id is distinct from old.plantilla_id
           and exists (select 1 from private.haku_revision_versiones v
                       where v.id in (old.plantilla_id, new.plantilla_id)) then
            raise exception 'Una revisión conserva la plantilla con la que fue creada.' using errcode = '22023';
        end if;
        return new;
    end if;

    if new.plantilla_id is not null then
        if exists (select 1 from private.haku_revision_versiones v where v.id = new.plantilla_id) then
            raise exception 'Haku selecciona la versión al iniciar la revisión.' using errcode = '22023';
        end if;
        return new;
    end if;
    if new.tipo_revision is distinct from 'completa' then
        return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(new.cabana_id::text, 61111));
    select v.id into new.plantilla_id from private.haku_revision_versiones v
    where v.cabana_id = new.cabana_id
      and new.fecha >= timezone('America/Santiago', v.publicado_en)::date
    order by v.version desc limit 1;
    return new;
end;
$$;

create trigger haku_revision_fijar_plantilla_v1
before insert or update of plantilla_id on public.revisiones_cabana
for each row execute function private.haku_revision_fijar_plantilla_v1();

create function public.haku_revision_plantillas_v1(p_fecha date, p_cabana_id uuid default null)
returns jsonb language sql stable set search_path = ''
as $$ select private.haku_revision_plantillas_v1(p_fecha, p_cabana_id) $$;

create function public.haku_revision_plantilla_editar_v1(p_cabana_id uuid)
returns jsonb language sql volatile set search_path = ''
as $$ select private.haku_revision_plantilla_editar_v1(p_cabana_id) $$;

create function public.haku_revision_plantilla_guardar_v1(
    p_cabana_id uuid, p_version_id uuid, p_request_id uuid, p_groups jsonb
)
returns jsonb language sql volatile set search_path = ''
as $$ select private.haku_revision_plantilla_guardar_v1(p_cabana_id, p_version_id, p_request_id, p_groups) $$;

revoke all on function private.haku_revision_grupos_base_v1(uuid),
    private.haku_revision_puede_editar_v1(), private.haku_revision_fijar_plantilla_v1()
from public, anon, authenticated;

revoke all on function private.haku_revision_plantillas_v1(date, uuid),
    private.haku_revision_plantilla_editar_v1(uuid),
    private.haku_revision_plantilla_guardar_v1(uuid, uuid, uuid, jsonb),
    public.haku_revision_plantillas_v1(date, uuid),
    public.haku_revision_plantilla_editar_v1(uuid),
    public.haku_revision_plantilla_guardar_v1(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;

grant execute on function private.haku_revision_plantillas_v1(date, uuid),
    private.haku_revision_plantilla_editar_v1(uuid),
    private.haku_revision_plantilla_guardar_v1(uuid, uuid, uuid, jsonb),
    public.haku_revision_plantillas_v1(date, uuid),
    public.haku_revision_plantilla_editar_v1(uuid),
    public.haku_revision_plantilla_guardar_v1(uuid, uuid, uuid, jsonb)
to authenticated;
