-- Additive directory fields for the approved guest rows. Existing RLS and invoker grants are preserved.
begin;
create or replace function public.haiku_huesped_directorio_v1(
  p_estado text default 'hospedados', p_busqueda text default null, p_tipo text default null,
  p_origen text default null, p_etiqueta uuid default null, p_desde integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare resultado jsonb;
begin
  if private.haiku_huesped_puede_leer() is distinct from true then
    raise exception 'No tienes permiso para consultar Huéspedes.' using errcode='42501';
  end if;
  if p_estado is null or p_estado not in ('hospedados','todos','pendientes') then
    raise exception 'Vista de huéspedes no válida.' using errcode='22023';
  end if;
  with visitas as materialized (select * from public.haiku_huesped_visitas_v1),
  ultima as (
    select distinct on (id) * from visitas
    order by id,hospedada desc,(ingreso<=timezone('America/Santiago',now())::date) desc nulls last,
      ingreso desc nulls last,reserva_id
  ), historial as (
    select id,count(distinct visita_grupo) filter (where ingreso is not null)::integer visitas,
      bool_or(p_tipo=any(tipos)) coincide_tipo from visitas group by id
  ), etiquetas as (
    select x.ficha_id,jsonb_agg(e.nombre order by e.grupo,e.nombre) etiquetas
    from public.haiku_huesped_etiquetados x join public.haiku_huesped_etiquetas e on e.id=x.etiqueta_id
    group by x.ficha_id
  ), fichas as (
    select p.id,p.nombre,p.apellido,p.tipo_documento,
      case when p.numero_documento is not null then '••••' || right(p.numero_documento,4) end as documento,
      p.nacionalidad,p.borrador,f.foto,
      (select count(*) from public.haiku_huesped_registros rr where rr.ficha_id=p.id) as registros,
      (u.plaza=0 or (p.borrador and (not u.excedente or f.cupo_revisado_en is null)) or (not p.borrador and nullif(btrim(p.numero_documento),'') is null)) is true as pendiente,
      coalesce(u.hospedada,false) and not coalesce(u.excedente,false) as hospedado,
      coalesce(u.excedente,false) as excedente,u.rol,u.plaza,u.numero,u.tipo,u.ingreso,u.salida,u.reserva_id,
      coalesce(h.visitas,0) as visitas,coalesce(t.etiquetas,'[]'::jsonb) as etiquetas
    from public.haiku_huesped_personas_v1 p left join ultima u using (id)
      left join historial h using (id) left join etiquetas t on t.ficha_id=p.id
      left join public.haiku_huesped_fichas f on f.id=p.id
    where (p_tipo is null or h.coincide_tipo)
      and (p_origen is null or p.nacionalidad=p_origen)
      and (p_etiqueta is null or exists (select 1 from public.haiku_huesped_etiquetados x where x.ficha_id=p.id and x.etiqueta_id=p_etiqueta))
      and (nullif(btrim(p_busqueda),'') is null
        or strpos(lower(concat_ws(' ',p.nombre,p.apellido)),lower(btrim(p_busqueda)))>0
        or strpos(lower(p.numero_documento),lower(btrim(p_busqueda)))>0
        or (regexp_replace(lower(btrim(p_busqueda)),'[^a-z0-9]','','g') <> ''
          and strpos(regexp_replace(lower(p.numero_documento),'[^a-z0-9]','','g'),
                     regexp_replace(lower(btrim(p_busqueda)),'[^a-z0-9]','','g'))>0))
  ), visibles as (
    select * from fichas where p_estado='todos' or (p_estado='hospedados' and hospedado)
      or (p_estado='pendientes' and pendiente)
  ), pagina as (
    select * from visibles order by numero nulls last,borrador,nombre nulls last,apellido nulls last,id
    offset greatest(coalesce(p_desde,0),0) limit 40
  )
  select jsonb_build_object(
    'filas',coalesce((select jsonb_agg(to_jsonb(p) order by p.numero nulls last,p.borrador,p.nombre nulls last,p.apellido nulls last,p.id) from pagina p),'[]'),
    'conteos',(select jsonb_build_object('hospedados',count(*) filter(where hospedado),
      'todos',count(*),'pendientes',count(*) filter(where pendiente)) from fichas),
    'cabanas',(select count(distinct numero) from visibles),
    'puede_editar',private.haiku_huesped_puede_editar(),
    'tipos',coalesce((select jsonb_agg(t.tipo order by t.tipo)
      from (select distinct tipo from public.haiku_huesped_estadias_v1 where tipo is not null) t),'[]'),
    'origenes',coalesce((select jsonb_agg(t.nacionalidad order by t.nacionalidad)
      from (select distinct nacionalidad from public.haiku_huesped_personas_v1 where nullif(btrim(nacionalidad),'') is not null) t),'[]'),
    'etiquetas',(select coalesce(jsonb_agg(to_jsonb(e) order by e.grupo,e.nombre),'[]') from public.haiku_huesped_etiquetas e)
  ) into resultado;
  return resultado;
end $$;

create or replace function public.haiku_huesped_perfil_v1(p_id uuid,p_reserva uuid default null,p_historial boolean default false)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare persona record; visita record; resultado jsonb;
begin
  if private.haiku_huesped_puede_leer() is distinct from true then
    raise exception 'No tienes permiso para consultar Huéspedes.' using errcode='42501';
  end if;
  select p.*, f.descripcion,f.idioma,f.foto,f.cupo_revisado_en into persona
  from public.haiku_huesped_personas_v1 p left join public.haiku_huesped_fichas f using (id) where p.id=p_id;
  if not found then raise exception 'El perfil ya no está disponible.' using errcode='P0002'; end if;
  select * into visita from public.haiku_huesped_visitas_v1 v where v.id=p_id
    and (p_reserva is null or v.reserva_id=p_reserva)
    order by hospedada desc,(ingreso<=timezone('America/Santiago',now())::date) desc nulls last,
      ingreso desc nulls last,reserva_id limit 1;
  if p_reserva is not null and not found then
    raise exception 'La persona no participa en esta reserva.' using errcode='P0002';
  end if;
  select jsonb_build_object(
    'persona',to_jsonb(persona),
    'tipos_visitados',(select coalesce(jsonb_agg(t.tipo order by t.tipo),'[]') from
      (select distinct unnest(v.tipos) as tipo from public.haiku_huesped_visitas_v1 v where v.id=p_id) t where t.tipo is not null),
    'visita',case when visita.reserva_id is not null then to_jsonb(visita) end,
    'visitas',(select count(distinct v.visita_grupo) from public.haiku_huesped_visitas_v1 v where v.id=p_id and v.ingreso is not null),
    'historial',case when p_historial then coalesce((select jsonb_agg(to_jsonb(v) order by v.ingreso desc,v.reserva_id)
      from (select distinct on (h.visita_grupo) h.* from public.haiku_huesped_visitas_v1 h
        where h.id=p_id and h.ingreso is not null order by h.visita_grupo,h.hospedada desc,h.ingreso desc,h.reserva_id) v),'[]') end,
    'estadias',coalesce((select jsonb_agg(to_jsonb(e)-'hasta' order by e.fecha_ingreso,e.numero)
      from public.haiku_huesped_estadias_v1 e where e.reserva_id=visita.reserva_id
        and (visita.estadia_id is null or visita.plaza is not null or e.id=visita.estadia_id
          or exists (select 1 from public.estadia_huespedes eh where eh.estadia_id=e.id and eh.huesped_id=p_id))),'[]'),
    'integrantes',coalesce((select jsonb_agg(to_jsonb(i)-'numero_documento'-'tipo_documento'-'nacionalidad'
      order by (i.rol='titular') desc,i.plaza nulls first,i.nombre,i.id)
      from public.haiku_huesped_integrantes_v1 i where i.reserva_id=visita.reserva_id),'[]'),
    'registros',coalesce((select jsonb_agg(to_jsonb(n) order by n.fecha desc,n.id) from public.haiku_huesped_registros n
      where n.ficha_id=p_id and (n.reserva_id is null or n.reserva_id=visita.reserva_id)),'[]'),
    'vehiculos',coalesce((select jsonb_agg(to_jsonb(v) order by v.fecha,v.id)
      from public.haiku_huesped_vehiculos v where v.reserva_id=visita.reserva_id),'[]'),
    'mascotas',coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('presente', mv.mascota_id is not null)
      order by m.nombre,m.id) from public.haiku_huesped_mascotas m
      left join public.haiku_huesped_mascota_visitas mv on mv.mascota_id=m.id and mv.reserva_id=visita.reserva_id where m.ficha_id=p_id),'[]'),
    'etiquetas',coalesce((select jsonb_agg(to_jsonb(e) order by e.grupo,e.nombre)
      from public.haiku_huesped_etiquetados x join public.haiku_huesped_etiquetas e on e.id=x.etiqueta_id where x.ficha_id=p_id),'[]'),
    'puede_editar',private.haiku_huesped_puede_editar()
  ) into resultado;
  return resultado;
end $$;

commit;
