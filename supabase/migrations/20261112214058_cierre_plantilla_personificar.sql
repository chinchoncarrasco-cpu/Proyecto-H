-- Una versión por publicación y una referencia fija al empezar cada turno.
create table private.haiku_cierre_plantillas (
    version integer generated always as identity primary key,
    aplica_desde date not null,
    plantilla jsonb not null check (jsonb_typeof(plantilla) = 'object'),
    solicitud uuid unique,
    publicado_por uuid,
    publicado_en timestamptz not null default now()
);

create table private.haiku_cierre_plantilla_turnos (
    cierre_id uuid primary key references public.cierres_turno(id) on delete cascade,
    version integer not null references private.haiku_cierre_plantillas(version)
);

alter table private.haiku_cierre_plantillas enable row level security;
alter table private.haiku_cierre_plantilla_turnos enable row level security;
revoke all on table private.haiku_cierre_plantillas, private.haiku_cierre_plantilla_turnos from public, anon, authenticated;

insert into private.haiku_cierre_plantillas(aplica_desde, plantilla)
values ('-infinity', $plantilla$
{
  "titulo": "Cierre de turno",
  "grupos": [
    {
      "id": "recepcion",
      "titulo": "Recepción y reservas",
      "items": [
        {
          "id": "salida_temprana",
          "texto": "¿Se confirmó la hora de salida temprana?",
          "activo": true
        },
        {
          "id": "salio_antes",
          "texto": "¿Hubo salidas antes de lo previsto?",
          "activo": true
        },
        {
          "id": "registro_guardado",
          "texto": "Registro de huéspedes guardado",
          "activo": true
        },
        {
          "id": "reserva_marcada",
          "texto": "Entradas y salidas actualizadas",
          "activo": true
        }
      ]
    },
    {
      "id": "llaves",
      "titulo": "Llaves y accesos",
      "items": [
        {
          "id": "tonel",
          "texto": "Tonel",
          "activo": true,
          "detalle": "Negra"
        },
        {
          "id": "jacuzzi",
          "texto": "Jacuzzi",
          "activo": true,
          "detalle": "Azul"
        },
        {
          "id": "lavanderia",
          "texto": "Lavandería",
          "activo": true,
          "detalle": ""
        },
        {
          "id": "masajes",
          "texto": "Sala de masajes",
          "activo": true,
          "detalle": "Verde claro"
        },
        {
          "id": "generadores",
          "texto": "Generadores y camas adicionales",
          "activo": true,
          "detalle": "Madera redonda"
        },
        {
          "id": "jardineria",
          "texto": "Jardinería",
          "activo": true,
          "detalle": "Verde claro"
        },
        {
          "id": "marcelo",
          "texto": "Llave de Marcelo",
          "activo": true,
          "detalle": "Verde oscuro"
        },
        {
          "id": "cisterna",
          "texto": "Cisterna",
          "activo": true,
          "detalle": ""
        },
        {
          "id": "internet",
          "texto": "Caja de internet",
          "activo": true,
          "detalle": "Naranja"
        },
        {
          "id": "gas11",
          "texto": "Gas CAB 11",
          "activo": true,
          "detalle": "Azul oscuro"
        },
        {
          "id": "torreon",
          "texto": "Torreón",
          "activo": true,
          "detalle": "Azul oscuro"
        }
      ]
    },
    {
      "id": "caja",
      "titulo": "Caja y pagos",
      "items": [
        {
          "id": "pago_registrado",
          "texto": "Pagos registrados con su respaldo",
          "activo": true
        },
        {
          "id": "manager_pagos",
          "texto": "Pagos verificados contra el registro de caja",
          "activo": true
        },
        {
          "id": "manager_caja",
          "texto": "Revisión de caja completada",
          "activo": true
        },
        {
          "id": "manager_vale_salida",
          "texto": "Cortesías del turno respaldadas",
          "activo": true
        }
      ]
    },
    {
      "id": "instalaciones",
      "titulo": "Instalaciones",
      "items": [
        {
          "id": "tinaja_tonel_apagado",
          "texto": "Eyectores y luces del Tonel apagados",
          "activo": true
        },
        {
          "id": "tinaja_tonel_funcionamiento",
          "texto": "Temperatura y funcionamiento del Tonel revisados",
          "activo": true
        },
        {
          "id": "tinaja_jacuzzi_apagado",
          "texto": "Eyectores y luces del Jacuzzi apagados",
          "activo": true
        },
        {
          "id": "tinaja_jacuzzi_funcionamiento",
          "texto": "Temperatura y funcionamiento del Jacuzzi revisados",
          "activo": true
        },
        {
          "id": "tinaja_cojines_retirados",
          "texto": "Cojines del área de tinajas retirados",
          "activo": true
        }
      ]
    }
  ],
  "cabanas": {
    "titulo": "Cabañas",
    "ocupada": "Ocupada · no requiere revisión",
    "items": [
      {
        "id": "cabana_perillas",
        "texto": "Perillas de cocina",
        "activo": true
      },
      {
        "id": "cabana_gas",
        "texto": "Llave de gas",
        "activo": true
      },
      {
        "id": "cabana_refri",
        "texto": "Nivel del refrigerador",
        "activo": true
      },
      {
        "id": "cabana_calefactor",
        "texto": "Calefactor",
        "activo": true
      },
      {
        "id": "cabana_tv",
        "texto": "TV",
        "activo": true
      },
      {
        "id": "cabana_ac",
        "texto": "Aire acondicionado",
        "activo": true
      },
      {
        "id": "cabana_luces",
        "texto": "Luces",
        "activo": true
      }
    ]
  },
  "entrega": {
    "id": "entrega",
    "titulo": "Entrega del turno",
    "items": [
      {
        "id": "detalles_cabanas",
        "texto": "¿Se revisaron las cabañas y sus observaciones?",
        "activo": true
      },
      {
        "id": "pendientes_hacer",
        "texto": "¿Quedan tareas para el siguiente turno?",
        "activo": true
      },
      {
        "id": "hay_novedades",
        "texto": "¿Hay novedades que informar?",
        "activo": true
      }
    ],
    "novedades": "Novedades del turno",
    "resumen": "Resumen de entrega"
  }
}
$plantilla$::jsonb);

create function private.haiku_cierre_filas_v1(p_plantilla jsonb)
returns table(zona text, grupo text, item jsonb)
language sql immutable
set search_path = ''
as $$
    select case when g->>'id' = 'llaves' then 'llaves' else 'global' end, g->>'id', i
    from jsonb_array_elements(p_plantilla->'grupos') g
    cross join lateral jsonb_array_elements(g->'items') i
    union all
    select 'cabana', 'cabanas', i from jsonb_array_elements(p_plantilla->'cabanas'->'items') i
    union all
    select 'entrega', 'entrega', i from jsonb_array_elements(p_plantilla->'entrega'->'items') i
$$;

create function private.haiku_cierre_contexto_v1(
    p_cierre_id uuid, p_fijar boolean default false, p_version integer default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
    v_fecha date;
    v_estado text;
    v_novedades text;
    v_version integer;
    v_plantilla jsonb;
    v_fijada boolean;
begin
    if auth.uid() is null or private.haiku_tiene_permiso('cierres.ver') is not true then
        raise exception 'Sin permiso para ver el cierre' using errcode = '42501';
    end if;

    if p_fijar then
        if private.haiku_tiene_permiso('cierres.realizar') is not true then
            raise exception 'Sin permiso para realizar cierres' using errcode = '42501';
        end if;
        perform 1 from public.cierres_turno where id = p_cierre_id for update;
    end if;

    select t.fecha_operativa, c.estado, c.novedades, f.version
    into v_fecha, v_estado, v_novedades, v_version
    from public.cierres_turno c
    join public.turnos t on t.id = c.turno_id
    left join private.haiku_cierre_plantilla_turnos f on f.cierre_id = c.id
    where c.id = p_cierre_id;
    if not found then raise exception 'No se encontró el cierre'; end if;
    if p_fijar and v_estado not in ('borrador','reabierto') then
        raise exception 'El cierre ya no admite edición normal';
    end if;

    v_fijada := v_version is not null
        or v_estado <> 'borrador'
        or nullif(btrim(v_novedades), '') is not null
        or exists (select 1 from public.cierre_respuestas where cierre_id = p_cierre_id)
        or exists (select 1 from public.evidencias where cierre_id = p_cierre_id);
    if v_fijada then
        v_version := coalesce(v_version, 1);
    else
        select version into v_version from private.haiku_cierre_plantillas
        where aplica_desde <= v_fecha order by version desc limit 1;
    end if;

    if p_version is not null and p_version <> v_version then
        raise exception 'La plantilla del turno cambió. Recarga el cierre e inténtalo de nuevo.' using errcode = '40001';
    end if;
    if p_fijar then
        insert into private.haiku_cierre_plantilla_turnos(cierre_id, version)
        values (p_cierre_id, v_version) on conflict (cierre_id) do nothing;
        v_fijada := true;
    end if;
    select plantilla into v_plantilla from private.haiku_cierre_plantillas where version = v_version;
    return jsonb_build_object('version', v_version, 'plantilla', v_plantilla, 'fijada', v_fijada);
end
$$;

create function private.haiku_cierre_plantilla_editar_v1()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
    v_resultado jsonb;
begin
    if auth.uid() is null or private.haiku_tiene_permiso('configuracion.gestionar') is not true
        or private.haiku_tiene_permiso('cierres.ver') is not true then
        raise exception 'Sin permiso para personificar el cierre' using errcode = '42501';
    end if;
    select jsonb_build_object('version', version, 'plantilla', plantilla)
    into v_resultado from private.haiku_cierre_plantillas order by version desc limit 1;
    return v_resultado;
end
$$;

create function private.haiku_cierre_texto_valido_v1(p_texto jsonb, p_max integer)
returns boolean
language sql immutable
set search_path = ''
as $$
    select coalesce(jsonb_typeof(p_texto) = 'string' and char_length(btrim(p_texto #>> '{}')) between 1 and p_max, false)
$$;

create function private.haiku_cierre_plantilla_publicar_v1(
    p_version integer, p_solicitud uuid, p_plantilla jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
    v_base jsonb;
    v_anterior private.haiku_cierre_plantillas%rowtype;
    v_guardada private.haiku_cierre_plantillas%rowtype;
    v_version integer;
begin
    if auth.uid() is null or private.haiku_tiene_permiso('configuracion.gestionar') is not true
        or private.haiku_tiene_permiso('cierres.ver') is not true then
        raise exception 'Sin permiso para personificar el cierre' using errcode = '42501';
    end if;
    if p_solicitud is null or p_version is null or p_plantilla is null
        or jsonb_typeof(p_plantilla) <> 'object' or octet_length(p_plantilla::text) > 100000 then
        raise exception 'La plantilla del cierre no es válida';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('haiku:cierre:plantilla', 0));
    select * into v_guardada from private.haiku_cierre_plantillas where solicitud = p_solicitud;
    if found then
        if v_guardada.publicado_por <> auth.uid() or v_guardada.plantilla is distinct from p_plantilla then
            raise exception 'Esta solicitud ya se utilizó para otra publicación';
        end if;
        return jsonb_build_object('version', v_guardada.version);
    end if;
    select * into v_anterior from private.haiku_cierre_plantillas order by version desc limit 1;
    if v_anterior.version <> p_version then
        raise exception 'La plantilla cambió en otra sesión. Cierra y vuelve a abrir Personificar.' using errcode = '40001';
    end if;

    if not private.haiku_cierre_texto_valido_v1(p_plantilla->'titulo', 90)
        or not private.haiku_cierre_texto_valido_v1(p_plantilla->'cabanas'->'titulo', 90)
        or not private.haiku_cierre_texto_valido_v1(p_plantilla->'cabanas'->'ocupada', 160)
        or not private.haiku_cierre_texto_valido_v1(p_plantilla->'entrega'->'titulo', 90)
        or not private.haiku_cierre_texto_valido_v1(p_plantilla->'entrega'->'novedades', 90)
        or not private.haiku_cierre_texto_valido_v1(p_plantilla->'entrega'->'resumen', 90)
        or jsonb_typeof(p_plantilla->'grupos') is distinct from 'array'
        or jsonb_typeof(p_plantilla->'entrega'->'items') is distinct from 'array'
        or jsonb_typeof(p_plantilla->'cabanas'->'items') is distinct from 'array' then
        raise exception 'Completa los títulos y campos de la plantilla';
    end if;

    if jsonb_array_length(p_plantilla->'grupos') not between 4 and 30
        or exists (
            select 1 from jsonb_array_elements(p_plantilla->'grupos') g
            where not private.haiku_cierre_texto_valido_v1(g->'titulo', 90)
                or coalesce(g->>'id','') !~ '^(recepcion|llaves|caja|instalaciones|seccion_[a-f0-9]{32})$'
                or jsonb_typeof(g->'items') is distinct from 'array'
        ) or exists (
            select 1 from jsonb_array_elements(p_plantilla->'grupos') g group by g->>'id' having count(*) > 1
        ) or not (select array_agg(g->>'id') from jsonb_array_elements(p_plantilla->'grupos') g)
              @> array['recepcion','llaves','caja','instalaciones'] then
        raise exception 'Revisa las secciones de la plantilla';
    end if;

    select plantilla into v_base from private.haiku_cierre_plantillas where version = 1;
    if (select count(*) from private.haiku_cierre_filas_v1(p_plantilla)) > 250
        or exists (
            select 1 from private.haiku_cierre_filas_v1(p_plantilla) f
            where not private.haiku_cierre_texto_valido_v1(f.item->'texto', 160)
                or jsonb_typeof(f.item->'activo') is distinct from 'boolean'
                or (f.zona = 'llaves' and (jsonb_typeof(f.item->'detalle') is distinct from 'string'
                    or char_length(f.item->>'detalle') > 100))
                or (f.item->>'id' in ('pago_registrado','manager_pagos','manager_caja','manager_vale_salida','hay_novedades')
                    and f.item->'activo' <> 'true'::jsonb)
                or (not exists (
                    select 1 from private.haiku_cierre_filas_v1(v_base) b
                    where b.item->>'id' = f.item->>'id' and b.zona = f.zona
                ) and coalesce(f.item->>'id','') !~
                    case f.zona when 'llaves' then '^llave_[a-f0-9]{32}$'
                        when 'cabana' then '^cabana_tarea_[a-f0-9]{32}$'
                        else '^tarea_[a-f0-9]{32}$' end)
        ) or exists (
            select 1 from private.haiku_cierre_filas_v1(p_plantilla) f group by f.item->>'id' having count(*) > 1
        ) or exists (
            select 1 from private.haiku_cierre_filas_v1(v_anterior.plantilla) a
            where not exists (
                select 1 from private.haiku_cierre_filas_v1(p_plantilla) n
                where n.item->>'id' = a.item->>'id'
                  and (n.zona = a.zona or (a.item->>'id' like 'tarea_%' and n.zona in ('global','entrega')))
            )
        ) or not exists (
            select 1 from private.haiku_cierre_filas_v1(p_plantilla) f where f.zona = 'llaves' and f.item->'activo' = 'true'::jsonb
        ) then
        raise exception 'Revisa las tareas y deja al menos una llave activa';
    end if;
    if p_plantilla = v_anterior.plantilla then
        return jsonb_build_object('version', v_anterior.version);
    end if;

    -- El catálogo conserva los identificadores que consumen las respuestas web y Mobile.
    insert into public.cierre_checklist_items(codigo,nombre,categoria,obligatorio,bloquea_cierre,activo,orden_visual,alcance,tipo_respuesta)
    select f.item->>'id', btrim(f.item->>'texto'), 'personificado', true, false, true, 1000,
           case when f.zona = 'cabana' then 'cabana' else 'global' end, 'booleano'
    from private.haiku_cierre_filas_v1(p_plantilla) f
    where f.zona <> 'llaves' and f.item->>'id' ~ '^(cabana_)?tarea_[a-f0-9]{32}$'
    on conflict (codigo) do nothing;

    insert into private.haiku_cierre_plantillas(aplica_desde, plantilla, solicitud, publicado_por)
    values ((now() at time zone 'America/Santiago')::date, p_plantilla, p_solicitud, auth.uid())
    returning version into v_version;
    return jsonb_build_object('version', v_version);
end
$$;

create function public.haiku_cierre_plantilla_turno_v1(p_cierre_id uuid)
returns jsonb language sql set search_path = ''
as $$ select private.haiku_cierre_contexto_v1(p_cierre_id) $$;

create function public.haiku_cierre_plantilla_editar_v1()
returns jsonb language sql set search_path = ''
as $$ select private.haiku_cierre_plantilla_editar_v1() $$;

create function public.haiku_cierre_plantilla_publicar_v1(p_version integer, p_solicitud uuid, p_plantilla jsonb)
returns jsonb language sql set search_path = ''
as $$ select private.haiku_cierre_plantilla_publicar_v1(p_version, p_solicitud, p_plantilla) $$;

create or replace function private.haiku_evaluar_cierre(p_cierre_id uuid)
returns table(total_requeridos integer, completados integer, pendientes integer, bloqueo_global boolean, bloqueo_cabana boolean, puede_cerrar_limpio boolean)
language sql
set search_path = ''
as $$
    with plantilla as materialized (
        select private.haiku_cierre_contexto_v1(p_cierre_id)->'plantilla' as valor
    ),
    activos as (
        select f.item->>'id' as codigo from plantilla p
        cross join lateral private.haiku_cierre_filas_v1(p.valor) f
        where f.zona <> 'llaves' and f.item->'activo' = 'true'::jsonb
    ),
    respuestas as materialized (
        select r.* from public.cierre_respuestas r where r.cierre_id = p_cierre_id
    ),
    controles as (
        select i.* from public.cierre_checklist_items i
        where i.activo and (i.codigo in ('llaves_retiradas','cabana_ocupada')
            or exists (select 1 from activos a where a.codigo = i.codigo))
    ),
    unidades as (
        select c.id,
            coalesce(r.estado = 'no_corresponde' or (r.estado = 'confirmado' and r.valor = 'true'::jsonb), false) as ocupada,
            coalesce(r.estado = 'confirmado' and r.valor = 'true'::jsonb, false) as exime_bloqueo
        from public.cabanas c
        left join respuestas r on r.cabana_id = c.id and r.item_id = (
            select i.id from public.cierre_checklist_items i where i.codigo = 'cabana_ocupada'
        )
        where c.activa
    ),
    esperados as (
        select i.id, null::uuid as unidad, i.tipo_respuesta, i.obligatorio, i.bloquea_cierre
        from controles i where i.alcance = 'global'
        union all
        select i.id, c.id, i.tipo_respuesta,
            case when i.codigo = 'cabana_ocupada' then c.ocupada else i.obligatorio and not c.ocupada end,
            i.bloquea_cierre and (i.codigo = 'cabana_ocupada' or not c.exime_bloqueo)
        from controles i cross join unidades c where i.alcance = 'cabana'
    ),
    estado as (
        select count(*) filter (where e.obligatorio)::integer as total,
            count(*) filter (where e.obligatorio and (r.estado = 'no_corresponde' or (
                r.estado = 'confirmado' and (e.tipo_respuesta <> 'booleano' or r.valor = 'true'::jsonb)
            )))::integer as hechos,
            coalesce(bool_or(e.bloquea_cierre and e.unidad is null
                and not coalesce(r.estado in ('confirmado','no_corresponde'), false)), false) as bg,
            coalesce(bool_or(e.bloquea_cierre and e.unidad is not null
                and not coalesce(r.estado in ('confirmado','no_corresponde'), false)), false) as bc
        from esperados e
        left join respuestas r on r.item_id = e.id and r.cabana_id is not distinct from e.unidad
    )
    select total, hechos, total - hechos, bg, bc, total = hechos and not bg and not bc from estado
$$;

CREATE OR REPLACE FUNCTION public.haiku_estado_cierre_dia(p_fecha date, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_turno public.turnos%rowtype;
    v_cierre public.cierres_turno%rowtype;
    v_evaluacion record;

begin
    if p_fecha is null then
        raise exception 'La fecha es obligatoria';
    end if;

    if not private.haiku_tiene_permiso('cierres.ver') then
        raise exception 'Sin permiso para ver cierres';
    end if;

    select t.* into v_turno
    from public.turnos t
    where t.fecha_operativa = p_fecha
      and t.tipo_turno = coalesce(nullif(btrim(p_tipo_turno), ''), 'cierre_diario')
    limit 1;

    if v_turno.id is null then
        raise exception 'No existe turno para la fecha indicada';
    end if;

    select c.* into v_cierre
    from public.cierres_turno c
    where c.turno_id = v_turno.id
    limit 1;

    if v_cierre.id is null then
        raise exception 'No existe cierre para la fecha indicada';
    end if;

    select * into v_evaluacion from private.haiku_evaluar_cierre(v_cierre.id);

    return jsonb_build_object(
        'turno_id', v_turno.id,
        'cierre_id', v_cierre.id,
        'fecha_operativa', v_turno.fecha_operativa,
        'plantilla_version', private.haiku_cierre_contexto_v1(v_cierre.id)->'version',
        'turno_estado', v_turno.estado,
        'cierre_estado', v_cierre.estado,
        'total_requeridos', v_evaluacion.total_requeridos,
        'completados', v_evaluacion.completados,
        'pendientes', v_evaluacion.pendientes,
        'porcentaje', case when v_evaluacion.total_requeridos = 0 then 100 else round((v_evaluacion.completados::numeric / v_evaluacion.total_requeridos::numeric) * 100)::integer end,
        'puede_cerrar_limpio', v_evaluacion.puede_cerrar_limpio,
        'resumen_entrega', v_cierre.resumen_entrega,
        'novedades', v_cierre.novedades,
        'cerrado_en', v_cierre.cerrado_en,
        'cerrado_por', v_cierre.cerrado_por,
        'reabierto_en', v_cierre.reabierto_en,
        'reabierto_por', v_cierre.reabierto_por
    );
end;
$function$;

create function private.haiku_cierre_responder_v1(
    p_fecha date, p_codigo text, p_estado text, p_valor jsonb, p_observacion text,
    p_cabana_numero smallint, p_tipo_turno text, p_version integer
) RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
declare
    v_base jsonb;
    v_cierre_id uuid;
    v_item public.cierre_checklist_items%rowtype;
    v_cabana_id uuid;
    v_respuesta_id uuid;
    v_confirmado_por uuid;
    v_confirmado_en timestamptz;
    v_plantilla jsonb;
    v_llaves_completas boolean;
begin
    if p_fecha is null or nullif(btrim(p_codigo), '') is null then
        raise exception 'Fecha y código son obligatorios';
    end if;

    if p_codigo = 'llaves_retiradas' then
        raise exception 'Confirma las llaves en el inventario del turno';
    end if;

    if p_estado not in ('pendiente', 'confirmado', 'no_corresponde') then
        raise exception 'Estado de respuesta inválido';
    end if;

    if not private.haiku_tiene_permiso('cierres.realizar') then
        raise exception 'Sin permiso para realizar cierres';
    end if;

    select * into v_item
    from public.cierre_checklist_items
    where codigo = p_codigo
      and activo = true
    limit 1;

    if v_item.id is null then
        raise exception 'Ítem de cierre inexistente: %', p_codigo;
    end if;

    if v_item.permiso_requerido is not null
       and p_estado = 'confirmado'
       and not private.haiku_tiene_permiso(v_item.permiso_requerido) then
        raise exception 'Sin permiso para confirmar %', p_codigo;
    end if;

    if v_item.alcance = 'cabana' then
        if p_cabana_numero is null then
            raise exception 'El ítem % requiere cabaña', p_codigo;
        end if;

        select id into v_cabana_id
        from public.cabanas
        where numero = p_cabana_numero
          and activa = true
        limit 1;

        if v_cabana_id is null then
            raise exception 'Cabaña no encontrada: %', p_cabana_numero;
        end if;
    else
        v_cabana_id := null;
    end if;

    v_base := public.haiku_asegurar_cierre_dia(p_fecha, p_tipo_turno);
    v_cierre_id := (v_base->>'cierre_id')::uuid;

    v_plantilla := private.haiku_cierre_contexto_v1(v_cierre_id, true, p_version)->'plantilla';

    if p_codigo not in ('llaves_recepcion','cabana_ocupada')
       and (p_version is not null or p_codigo ~ '^(cabana_)?tarea_[a-f0-9]{32}$')
       and not exists (
           select 1 from private.haiku_cierre_filas_v1(v_plantilla) f
           where f.zona <> 'llaves' and f.item->>'id' = p_codigo and f.item->'activo' = 'true'::jsonb
       ) then
        raise exception 'Este control no está activo en la plantilla del turno';
    end if;

    if p_codigo = 'llaves_recepcion' then
        if jsonb_typeof(p_valor) is distinct from 'object' or exists (
            select 1 from jsonb_each(p_valor) v where jsonb_typeof(v.value) <> 'boolean'
        ) then
            raise exception 'Las llaves del turno deben guardarse como confirmaciones';
        end if;
        -- Los clientes anteriores envían sus once llaves. La escritura parcial conserva las demás.
        p_valor := coalesce((
            select r.valor from public.cierre_respuestas r
            where r.cierre_id = v_cierre_id and r.item_id = v_item.id and r.cabana_id is null
              and jsonb_typeof(r.valor) = 'object'
        ), '{}'::jsonb) || p_valor;
    end if;

    if p_estado = 'pendiente' then
        v_confirmado_por := null;
        v_confirmado_en := null;
    else
        v_confirmado_por := auth.uid();
        v_confirmado_en := now();
    end if;

    if v_cabana_id is null then
        insert into public.cierre_respuestas (
            cierre_id, item_id, cabana_id, estado, valor,
            observacion, confirmado_por, confirmado_en, origen
        ) values (
            v_cierre_id, v_item.id, null, p_estado, p_valor,
            p_observacion, v_confirmado_por, v_confirmado_en, 'usuario'
        )
        on conflict (cierre_id, item_id) where cabana_id is null
        do update set
            estado = excluded.estado,
            valor = excluded.valor,
            observacion = excluded.observacion,
            confirmado_por = excluded.confirmado_por,
            confirmado_en = excluded.confirmado_en,
            origen = 'usuario',
            actualizado_en = now()
        returning id into v_respuesta_id;
    else
        insert into public.cierre_respuestas (
            cierre_id, item_id, cabana_id, estado, valor,
            observacion, confirmado_por, confirmado_en, origen
        ) values (
            v_cierre_id, v_item.id, v_cabana_id, p_estado, p_valor,
            p_observacion, v_confirmado_por, v_confirmado_en, 'usuario'
        )
        on conflict (cierre_id, item_id, cabana_id) where cabana_id is not null
        do update set
            estado = excluded.estado,
            valor = excluded.valor,
            observacion = excluded.observacion,
            confirmado_por = excluded.confirmado_por,
            confirmado_en = excluded.confirmado_en,
            origen = 'usuario',
            actualizado_en = now()
        returning id into v_respuesta_id;
    end if;

    if p_codigo = 'llaves_recepcion' then
        v_llaves_completas := p_estado = 'confirmado' and not exists (
            select 1 from private.haiku_cierre_filas_v1(v_plantilla) f
            where f.zona = 'llaves' and f.item->'activo' = 'true'::jsonb
                and p_valor->(f.item->>'id') is distinct from 'true'::jsonb
        );
        insert into public.cierre_respuestas (
            cierre_id,item_id,estado,valor,confirmado_por,confirmado_en,origen
        )
        select v_cierre_id, i.id,
            case when v_llaves_completas then 'confirmado' else 'pendiente' end,
            case when v_llaves_completas then '"si"'::jsonb else 'null'::jsonb end,
            case when v_llaves_completas then auth.uid() end,
            case when v_llaves_completas then now() end, 'sistema'
        from public.cierre_checklist_items i where i.codigo = 'llaves_retiradas'
        on conflict (cierre_id,item_id) where cabana_id is null do update
        set estado = excluded.estado, valor = excluded.valor, observacion = null,
            confirmado_por = excluded.confirmado_por, confirmado_en = excluded.confirmado_en,
            origen = excluded.origen, actualizado_en = now();
    end if;

    return jsonb_build_object(
        'respuesta_id', v_respuesta_id,
        'cierre_id', v_cierre_id,
        'codigo', p_codigo,
        'estado', p_estado,
        'cabana_numero', p_cabana_numero
    );
end;
$function$;

create function private.haiku_cierre_finalizar_v1(
    p_fecha date, p_resumen_entrega text, p_tipo_turno text, p_version integer
) RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
declare
    v_estado jsonb;
    v_turno public.turnos%rowtype;
    v_cierre public.cierres_turno%rowtype;
    v_nuevo_estado text;
    v_respuestas jsonb := '[]'::jsonb;
    v_evidencias jsonb := '[]'::jsonb;
    v_snapshot jsonb := '{}'::jsonb;
    v_pendientes integer := 0;
    v_resumen text;
    v_contexto jsonb;
begin
    if p_fecha is null then
        raise exception 'La fecha es obligatoria';
    end if;

    if not private.haiku_tiene_permiso('cierres.realizar') then
        raise exception 'Sin permiso para cerrar el turno';
    end if;

    select t.* into v_turno
    from public.turnos t
    where t.fecha_operativa = p_fecha
      and t.tipo_turno = coalesce(nullif(btrim(p_tipo_turno), ''), 'cierre_diario')
    for update;

    if v_turno.id is null then
        raise exception 'No existe turno para la fecha indicada';
    end if;

    select c.* into v_cierre
    from public.cierres_turno c
    where c.turno_id = v_turno.id
    for update;

    if v_cierre.id is null then
        raise exception 'No existe cierre para la fecha indicada';
    end if;

    if v_cierre.estado in ('cerrado', 'cerrado_con_pendientes') then
        return public.haiku_estado_cierre_dia(p_fecha, p_tipo_turno);
    end if;

    if v_cierre.estado not in ('borrador', 'reabierto') then
        raise exception 'Estado de cierre no editable: %', v_cierre.estado;
    end if;

    v_contexto := private.haiku_cierre_contexto_v1(v_cierre.id, true, p_version);
    v_estado := public.haiku_estado_cierre_dia(p_fecha, p_tipo_turno);
    v_pendientes := coalesce((v_estado->>'pendientes')::integer, 0);
    v_resumen := nullif(btrim(coalesce(p_resumen_entrega, '')), '');

    if v_pendientes > 0 and v_resumen is null then
        raise exception 'Hay % pendientes: indique un resumen de entrega', v_pendientes;
    end if;

    v_nuevo_estado := case when v_pendientes = 0 then 'cerrado' else 'cerrado_con_pendientes' end;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'codigo', i.codigo,
            'nombre', coalesce(f.item->>'texto', i.nombre),
            'categoria', i.categoria,
            'cabana_numero', cb.numero,
            'estado', r.estado,
            'valor', r.valor,
            'observacion', r.observacion,
            'confirmado_por', r.confirmado_por,
            'confirmado_en', r.confirmado_en,
            'origen', r.origen
        ) order by i.orden_visual nulls last, cb.numero nulls first
    ), '[]'::jsonb)
    into v_respuestas
    from public.cierre_respuestas r
    join public.cierre_checklist_items i on i.id = r.item_id
    left join private.haiku_cierre_filas_v1(v_contexto->'plantilla') f
        on f.zona <> 'llaves' and f.item->>'id' = i.codigo
    left join public.cabanas cb on cb.id = r.cabana_id
    where r.cierre_id = v_cierre.id;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', e.id,
            'storage_bucket', e.storage_bucket,
            'storage_path', e.storage_path,
            'mime_type', e.mime_type,
            'tamano_bytes', e.tamano_bytes,
            'descripcion', e.descripcion,
            'subido_por', e.subido_por,
            'creado_en', e.creado_en
        ) order by e.creado_en
    ), '[]'::jsonb)
    into v_evidencias
    from public.evidencias e
    where e.cierre_id = v_cierre.id;

    v_snapshot := jsonb_build_object(
        'version', 1,
        'plantilla_version', v_contexto->'version',
        'fecha_operativa', p_fecha,
        'tipo_turno', v_turno.tipo_turno,
        'evaluacion', v_estado,
        'novedades', v_cierre.novedades,
        'resumen_entrega', v_resumen,
        'respuestas', v_respuestas,
        'evidencias', v_evidencias,
        'capturado_en', now(),
        'capturado_por', auth.uid()
    );

    update public.cierres_turno
    set estado = v_nuevo_estado,
        resumen_entrega = v_resumen,
        snapshot = v_snapshot,
        cerrado_por = auth.uid(),
        cerrado_en = now(),
        actualizado_en = now()
    where id = v_cierre.id;

    update public.turnos
    set estado = 'cerrado',
        finalizado_por = auth.uid(),
        finalizado_en = now(),
        actualizado_en = now()
    where id = v_turno.id;

    return public.haiku_estado_cierre_dia(p_fecha, p_tipo_turno);
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_guardar_novedades_cierre(p_fecha date, p_novedades text, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_base jsonb;
    v_cierre_id uuid;
begin
    if not private.haiku_tiene_permiso('cierres.realizar') then
        raise exception 'Sin permiso para realizar cierres';
    end if;

    v_base := public.haiku_asegurar_cierre_dia(p_fecha, p_tipo_turno);
    v_cierre_id := (v_base->>'cierre_id')::uuid;

    perform private.haiku_cierre_contexto_v1(v_cierre_id, true);

    update public.cierres_turno
    set novedades = nullif(p_novedades, ''),
        actualizado_en = now()
    where id = v_cierre_id;

    return jsonb_build_object('cierre_id', v_cierre_id, 'guardado', true);
end;
$function$;


-- Se mantienen las firmas que consume la aplicación nativa.
create or replace function public.haiku_guardar_respuesta_cierre(
    p_fecha date, p_codigo text, p_estado text, p_valor jsonb default null,
    p_observacion text default null, p_cabana_numero smallint default null, p_tipo_turno text default 'cierre_diario'
)
returns jsonb language sql set search_path = ''
as $$ select private.haiku_cierre_responder_v1(p_fecha,p_codigo,p_estado,p_valor,p_observacion,p_cabana_numero,p_tipo_turno,null) $$;

create function public.haiku_guardar_respuesta_cierre_personificado_v1(
    p_fecha date, p_codigo text, p_estado text, p_valor jsonb, p_observacion text,
    p_cabana_numero smallint, p_tipo_turno text, p_version integer
)
returns jsonb language sql set search_path = ''
as $$ select private.haiku_cierre_responder_v1(p_fecha,p_codigo,p_estado,p_valor,p_observacion,p_cabana_numero,p_tipo_turno,p_version) $$;

create or replace function public.haiku_cerrar_turno_dia(
    p_fecha date, p_resumen_entrega text default null, p_tipo_turno text default 'cierre_diario'
)
returns jsonb language sql set search_path = ''
as $$ select private.haiku_cierre_finalizar_v1(p_fecha,p_resumen_entrega,p_tipo_turno,null) $$;

create function public.haiku_cerrar_turno_personificado_v1(
    p_fecha date, p_resumen_entrega text, p_tipo_turno text, p_version integer
)
returns jsonb language sql set search_path = ''
as $$ select private.haiku_cierre_finalizar_v1(p_fecha,p_resumen_entrega,p_tipo_turno,p_version) $$;

revoke all on function private.haiku_cierre_texto_valido_v1(jsonb,integer) from public, anon, authenticated;
revoke all on function private.haiku_cierre_filas_v1(jsonb),
    private.haiku_cierre_contexto_v1(uuid,boolean,integer),
    private.haiku_cierre_plantilla_editar_v1(),
    private.haiku_cierre_plantilla_publicar_v1(integer,uuid,jsonb),
    private.haiku_cierre_responder_v1(date,text,text,jsonb,text,smallint,text,integer),
    private.haiku_cierre_finalizar_v1(date,text,text,integer),
    public.haiku_cierre_plantilla_turno_v1(uuid),
    public.haiku_cierre_plantilla_editar_v1(),
    public.haiku_cierre_plantilla_publicar_v1(integer,uuid,jsonb),
    public.haiku_guardar_respuesta_cierre_personificado_v1(date,text,text,jsonb,text,smallint,text,integer),
    public.haiku_cerrar_turno_personificado_v1(date,text,text,integer)
from public, anon, authenticated;
grant execute on function private.haiku_cierre_filas_v1(jsonb),
    private.haiku_cierre_contexto_v1(uuid,boolean,integer),
    private.haiku_cierre_plantilla_editar_v1(),
    private.haiku_cierre_plantilla_publicar_v1(integer,uuid,jsonb),
    private.haiku_cierre_responder_v1(date,text,text,jsonb,text,smallint,text,integer),
    private.haiku_cierre_finalizar_v1(date,text,text,integer),
    public.haiku_cierre_plantilla_turno_v1(uuid),
    public.haiku_cierre_plantilla_editar_v1(),
    public.haiku_cierre_plantilla_publicar_v1(integer,uuid,jsonb),
    public.haiku_guardar_respuesta_cierre_personificado_v1(date,text,text,jsonb,text,smallint,text,integer),
    public.haiku_cerrar_turno_personificado_v1(date,text,text,integer)
to authenticated;
