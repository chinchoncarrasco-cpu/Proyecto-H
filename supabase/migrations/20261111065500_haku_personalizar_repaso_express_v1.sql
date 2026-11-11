-- Repaso y Revisión Express tienen listas compartidas e independientes.
-- Las revisiones existentes conservan el identificador de plantilla que ya tienen.
create table private.haku_revision_modalidad_versiones (
    id uuid primary key references public.checklist_plantillas(id) on delete restrict,
    tipo text not null check (tipo in ('repaso', 'aseo_express')),
    version integer not null check (version > 0),
    grupos jsonb not null check (jsonb_typeof(grupos) = 'array'),
    publicado_por uuid not null references public.usuarios(id) on delete restrict,
    publicado_en timestamptz not null default clock_timestamp(),
    huella bytea not null,
    unique (tipo, version)
);
alter table private.haku_revision_modalidad_versiones enable row level security;
revoke all on private.haku_revision_modalidad_versiones from public, anon, authenticated;

create function private.haku_revision_modalidad_base_v1(p_tipo text)
returns jsonb language sql stable set search_path = ''
as $$
    with catalogo(tipo, grupo, orden, clave, nombre, categoria) as (values
        ('repaso','living',1,'repaso-living-cama','Cama','REPASO · LIVING / CAMA'),
        ('repaso','living',2,'repaso-living-cajones','Cajones','REPASO · LIVING / CAMA'),
        ('repaso','living',3,'repaso-living-lamparas','Lámparas','REPASO · LIVING / CAMA'),
        ('repaso','living',4,'repaso-living-controles','Controles','REPASO · LIVING / CAMA'),
        ('repaso','living',5,'repaso-living-tv','TV','REPASO · LIVING / CAMA'),
        ('repaso','living',6,'repaso-living-ac','AC','REPASO · LIVING / CAMA'),
        ('repaso','living',7,'repaso-living-luces','Luces','REPASO · LIVING / CAMA'),
        ('repaso','living',8,'repaso-living-salamandra','Salamandra','REPASO · LIVING / CAMA'),
        ('repaso','living',9,'repaso-living-manilla','Manilla','REPASO · LIVING / CAMA'),
        ('repaso','living',10,'repaso-living-piso','Piso','REPASO · LIVING / CAMA'),
        ('repaso','kitchen',11,'repaso-kitchen-perillas','Perillas','REPASO · COCINA'),
        ('repaso','kitchen',12,'repaso-kitchen-llave-gas','Llave de gas','REPASO · COCINA'),
        ('repaso','kitchen',13,'repaso-kitchen-implementos','Implementos','REPASO · COCINA'),
        ('repaso','kitchen',14,'repaso-kitchen-refri','Refri','REPASO · COCINA'),
        ('repaso','bathroom',15,'repaso-bathroom-amenities','Amenities','REPASO · BAÑO'),
        ('repaso','bathroom',16,'repaso-bathroom-wc','WC','REPASO · BAÑO'),
        ('repaso','bathroom',17,'repaso-bathroom-papel-h','P.H.','REPASO · BAÑO'),
        ('repaso','bathroom',18,'repaso-bathroom-toallas','Toallas','REPASO · BAÑO'),
        ('repaso','bathroom',19,'repaso-bathroom-basurero','Basurero','REPASO · BAÑO'),
        ('repaso','bathroom',20,'repaso-bathroom-ducha','Ducha','REPASO · BAÑO'),
        ('repaso','bathroom',21,'repaso-bathroom-piso','Piso','REPASO · BAÑO'),
        ('repaso','terrace',22,'repaso-terrace-fogon','Fogón','REPASO · TERRAZA'),
        ('repaso','terrace',23,'repaso-terrace-atizador','Atizador','REPASO · TERRAZA'),
        ('repaso','terrace',24,'repaso-terrace-jardineras','Jardineras','REPASO · TERRAZA'),
        ('repaso','terrace',25,'repaso-terrace-cojines','Cojines','REPASO · TERRAZA'),
        ('repaso','terrace',26,'repaso-terrace-piso','Piso','REPASO · TERRAZA'),
        ('aseo_express','kitchen',1,null,'Losa','🧹 ASEO EXPRESS'),
        ('aseo_express','kitchen',2,null,'Llave de gas','🧹 ASEO EXPRESS'),
        ('aseo_express','kitchen',3,null,'Té','🧹 ASEO EXPRESS'),
        ('aseo_express','kitchen',4,null,'Café','🧹 ASEO EXPRESS'),
        ('aseo_express','kitchen',5,null,'Té Hierbas','🧹 ASEO EXPRESS'),
        ('aseo_express','living',6,null,'Cama','🧹 ASEO EXPRESS'),
        ('aseo_express','living',7,null,'Salamandra','🧹 ASEO EXPRESS'),
        ('aseo_express','living',8,null,'Leña','🧹 ASEO EXPRESS'),
        ('aseo_express','living',9,null,'Diario','🧹 ASEO EXPRESS'),
        ('aseo_express','bathroom',10,null,'Amenities','🧹 ASEO EXPRESS'),
        ('aseo_express','bathroom',11,null,'Papel H.','🧹 ASEO EXPRESS'),
        ('aseo_express','bathroom',12,null,'Toallas','🧹 ASEO EXPRESS'),
        ('aseo_express','bathroom',13,null,'WC','🧹 ASEO EXPRESS'),
        ('aseo_express','terrace',14,null,'Carbón','🧹 ASEO EXPRESS'),
        ('aseo_express','terrace',15,null,'Fogón','🧹 ASEO EXPRESS'),
        ('aseo_express','terrace',16,null,'Ventanas','🧹 ASEO EXPRESS')
    ), resueltos as (
        select k.*, i.id as item_id
        from catalogo k
        left join public.checklist_items i on i.categoria = k.categoria and i.nombre = k.nombre and i.activo
        where k.tipo = p_tipo
    ), grupos as (
        select grupo, min(orden) as orden,
               jsonb_agg(jsonb_build_object(
                   'id', coalesce(clave, item_id::text), 'label', nombre, 'active', true,
                   'itemId', item_id, 'expected', case when p_tipo = 'aseo_express' then 1 end, 'required', true
               ) order by orden) as items
        from resueltos group by grupo
    )
    select case when
        (select count(item_id) = count(distinct orden) and count(*) = count(distinct orden) from resueltos)
        then coalesce(jsonb_agg(jsonb_build_object('id', grupo, 'label', null, 'items', items) order by orden), '[]')
        else '[]'::jsonb end
    from grupos
$$;

create function private.haku_revision_modalidades_v1(p_fecha date, p_tipo text)
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
                'tipo', t.tipo, 'cabana_id', c.id, 'numero', c.numero, 'revision_id', r.id,
                'version_id', v.id, 'groups', v.grupos
            ) order by t.tipo, c.numero)
            from public.cabanas c
            cross join (values ('repaso'), ('aseo_express')) t(tipo)
            left join lateral (
                select rev.id, rev.plantilla_id
                from public.revisiones_cabana rev
                where rev.cabana_id = c.id and rev.fecha = p_fecha
                  and rev.tipo_revision = t.tipo and rev.estado <> 'cancelada'
                order by rev.creado_en desc, rev.id desc limit 1
            ) r on true
            join lateral (
                select ver.id, ver.grupos from private.haku_revision_modalidad_versiones ver
                where ver.tipo = t.tipo and (ver.id = r.plantilla_id or
                    (r.id is null and p_fecha >= timezone('America/Santiago', ver.publicado_en)::date))
                order by ver.version desc limit 1
            ) v on true
            where c.activa and (p_tipo is null or t.tipo = p_tipo)
        ), '[]'::jsonb)
    );
end;
$$;

create function private.haku_revision_modalidad_editar_v1(p_tipo text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
    v_head private.haku_revision_modalidad_versiones%rowtype;
    v_grupos jsonb;
begin
    if private.haku_revision_puede_editar_v1() is not true then
        raise exception 'Solo un administrador puede personalizar la revisión.' using errcode = '42501';
    end if;
    select v.* into v_head from private.haku_revision_modalidad_versiones v
    where v.tipo = p_tipo order by v.version desc limit 1;
    v_grupos := coalesce(v_head.grupos, private.haku_revision_modalidad_base_v1(p_tipo));
    if jsonb_array_length(v_grupos) = 0 then
        raise exception 'La lista base de este tipo de revisión no está disponible.' using errcode = '22023';
    end if;
    return jsonb_build_object('version_id', v_head.id, 'request_id', gen_random_uuid(), 'groups', v_grupos);
end;
$$;

create function private.haku_revision_modalidad_guardar_v1(
    p_tipo text, p_version_id uuid, p_request_id uuid, p_groups jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
    v_user uuid := auth.uid();
    v_head private.haku_revision_modalidad_versiones%rowtype;
    v_request private.haku_revision_modalidad_versiones%rowtype;
    v_hash bytea;
    v_base jsonb;
    v_group jsonb;
    v_base_group jsonb;
    v_item jsonb;
    v_old jsonb;
    v_items jsonb;
    v_groups jsonb := '[]';
    v_index integer := 0;
    v_seen text[] := array[]::text[];
    v_id text;
    v_label text;
    v_item_id uuid;
    v_author text;
begin
    if private.haku_revision_puede_editar_v1() is not true then
        raise exception 'Solo un administrador puede personalizar la revisión.' using errcode = '42501';
    end if;
    if p_tipo is null or p_tipo not in ('repaso', 'aseo_express') or p_request_id is null
       or jsonb_typeof(p_groups) is distinct from 'array' or pg_column_size(p_groups) > 262144 then
        raise exception 'El borrador de revisión no es válido.' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('haku-revision:' || p_tipo, 61111));
    v_hash := sha256(convert_to(p_groups::text, 'UTF8'));
    select nombre into v_author from public.usuarios where id = v_user;
    select v.* into v_request from private.haku_revision_modalidad_versiones v where v.id = p_request_id;
    if found then
        if v_request.tipo is distinct from p_tipo or v_request.publicado_por is distinct from v_user
           or v_request.huella is distinct from v_hash then
            raise exception 'Esta solicitud de guardado ya fue utilizada.' using errcode = '23505';
        end if;
        return jsonb_build_object('version_id', v_request.id, 'published_at', v_request.publicado_en, 'author', v_author);
    end if;

    select v.* into v_head from private.haku_revision_modalidad_versiones v
    where v.tipo = p_tipo order by v.version desc limit 1;
    if v_head.id is distinct from p_version_id then
        raise exception 'La lista cambió en otro dispositivo. Abre el editor nuevamente.' using errcode = '40001';
    end if;
    v_base := coalesce(v_head.grupos, private.haku_revision_modalidad_base_v1(p_tipo));
    if jsonb_array_length(v_base) = 0 or jsonb_array_length(v_base) <> jsonb_array_length(p_groups) then
        raise exception 'Conserva las áreas de la lista de revisión.' using errcode = '22023';
    end if;

    for v_group in select value from jsonb_array_elements(p_groups) loop
        v_base_group := v_base -> v_index;
        v_index := v_index + 1;
        if v_group->>'id' is distinct from v_base_group->>'id' or v_group->>'label' is not null
           or jsonb_typeof(v_group->'items') is distinct from 'array' then
            raise exception 'Conserva las áreas de la lista de revisión.' using errcode = '22023';
        end if;
        v_items := '[]';
        for v_item in select value from jsonb_array_elements(v_group->'items') loop
            v_id := v_item->>'id';
            v_label := btrim(v_item->>'label');
            if v_id is null or v_id = any(v_seen) or jsonb_typeof(v_item->'label') is distinct from 'string'
               or char_length(v_label) not between 1 and 120 or v_label ~ '[[:cntrl:]]'
               or jsonb_typeof(v_item->'active') is distinct from 'boolean' then
                raise exception 'Revisa los nombres y los identificadores de los elementos.' using errcode = '22023';
            end if;
            v_seen := array_append(v_seen, v_id);
            select value into v_old from jsonb_array_elements(v_base_group->'items') where value->>'id' = v_id;
            if found then
                v_item := v_old || jsonb_build_object('label', v_label, 'active', (v_item->>'active')::boolean);
            else
                if v_id !~ ('^nuevo-' || p_request_id::text || '-[1-9][0-9]*$') or v_item->>'active' <> 'true' then
                    raise exception 'Un elemento existente debe conservar su área e identificador.' using errcode = '22023';
                end if;
                insert into public.checklist_items(nombre, categoria)
                values (v_label, case p_tipo when 'repaso' then 'REVISIÓN PERSONALIZADA · REPASO' else 'REVISIÓN PERSONALIZADA · EXPRESS' end)
                returning id into v_item_id;
                v_item := jsonb_build_object('id', v_id, 'label', v_label, 'active', true, 'itemId', v_item_id,
                    'expected', case when p_tipo = 'aseo_express' then 1 end, 'required', true);
            end if;
            v_items := v_items || jsonb_build_array(v_item);
        end loop;
        if exists (select 1 from jsonb_array_elements(v_base_group->'items') b where not (b.value->>'id' = any(v_seen))) then
            raise exception 'Desactiva los elementos existentes para conservar su historial.' using errcode = '22023';
        end if;
        v_groups := v_groups || jsonb_build_array(jsonb_build_object('id', v_group->>'id', 'label', null, 'items', v_items));
    end loop;

    insert into public.checklist_plantillas(id, codigo, nombre, tipo)
    values (p_request_id, 'haku-' || p_tipo || '-' || p_request_id::text,
        case p_tipo when 'repaso' then 'Repaso · Todas las cabañas' else 'Revisión Express · Todas las cabañas' end, p_tipo);
    insert into public.checklist_plantilla_items(plantilla_id, checklist_item_id, obligatorio, orden_visual)
    select p_request_id, (i.value->>'itemId')::uuid, (i.value->>'required')::boolean,
        row_number() over (order by g.orden, i.orden)::integer
    from jsonb_array_elements(v_groups) with ordinality g(value, orden)
    cross join lateral jsonb_array_elements(g.value->'items') with ordinality i(value, orden)
    where (i.value->>'active')::boolean;
    insert into private.haku_revision_modalidad_versiones(id, tipo, version, grupos, publicado_por, huella)
    values (p_request_id, p_tipo, coalesce(v_head.version, 0) + 1, v_groups, v_user, v_hash)
    returning * into v_request;
    return jsonb_build_object('version_id', v_request.id, 'published_at', v_request.publicado_en, 'author', v_author);
end;
$$;

create function private.haku_revision_modalidad_fijar_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        if (new.plantilla_id is distinct from old.plantilla_id or new.tipo_revision is distinct from old.tipo_revision)
           and exists (select 1 from private.haku_revision_modalidad_versiones where id in (old.plantilla_id, new.plantilla_id)) then
            raise exception 'Una revisión conserva la lista con la que fue creada.' using errcode = '22023';
        end if;
        return new;
    end if;
    if new.plantilla_id is not null then
        if exists (select 1 from private.haku_revision_modalidad_versiones where id = new.plantilla_id) then
            raise exception 'Haku selecciona la versión al iniciar la revisión.' using errcode = '22023';
        end if;
        return new;
    end if;
    if new.tipo_revision in ('repaso', 'aseo_express') then
        perform pg_advisory_xact_lock(hashtextextended('haku-revision:' || new.tipo_revision, 61111));
        select id into new.plantilla_id from private.haku_revision_modalidad_versiones
        where tipo = new.tipo_revision and new.fecha >= timezone('America/Santiago', publicado_en)::date
        order by version desc limit 1;
    end if;
    return new;
end;
$$;

create trigger haku_revision_modalidad_fijar_v1
before insert or update of plantilla_id, tipo_revision on public.revisiones_cabana
for each row execute function private.haku_revision_modalidad_fijar_v1();

create function public.haku_revision_modalidades_v1(p_fecha date, p_tipo text default null)
returns jsonb language sql stable set search_path = ''
as $$ select private.haku_revision_modalidades_v1(p_fecha, p_tipo) $$;

create function public.haku_revision_modalidad_editar_v1(p_tipo text)
returns jsonb language sql volatile set search_path = ''
as $$ select private.haku_revision_modalidad_editar_v1(p_tipo) $$;

create function public.haku_revision_modalidad_guardar_v1(p_tipo text, p_version_id uuid, p_request_id uuid, p_groups jsonb)
returns jsonb language sql volatile set search_path = ''
as $$ select private.haku_revision_modalidad_guardar_v1(p_tipo, p_version_id, p_request_id, p_groups) $$;

revoke all on function private.haku_revision_modalidad_base_v1(text), private.haku_revision_modalidad_fijar_v1(),
    private.haku_revision_modalidades_v1(date, text), private.haku_revision_modalidad_editar_v1(text),
    private.haku_revision_modalidad_guardar_v1(text, uuid, uuid, jsonb),
    public.haku_revision_modalidades_v1(date, text), public.haku_revision_modalidad_editar_v1(text),
    public.haku_revision_modalidad_guardar_v1(text, uuid, uuid, jsonb)
from public, anon, authenticated;

grant execute on function private.haku_revision_modalidades_v1(date, text), private.haku_revision_modalidad_editar_v1(text),
    private.haku_revision_modalidad_guardar_v1(text, uuid, uuid, jsonb),
    public.haku_revision_modalidades_v1(date, text), public.haku_revision_modalidad_editar_v1(text),
    public.haku_revision_modalidad_guardar_v1(text, uuid, uuid, jsonb)
to authenticated;
