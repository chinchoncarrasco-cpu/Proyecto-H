-- Completados evalúa la ficha del titular. Pendientes sigue mostrando la identificación de la estadía.
begin;

create or replace function public.haiku_huesped_directorio_estadias_v1(
  p_estado text default 'todos', p_busqueda text default null, p_tipo text default null,
  p_origen text default null, p_etiqueta uuid default null, p_desde integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  resultado jsonb;
  hoy date := timezone('America/Santiago',now())::date;
begin
  if private.haiku_huesped_puede_leer() is distinct from true then
    raise exception 'No tienes permiso para consultar Huéspedes.' using errcode='42501';
  end if;
  if p_estado is null or p_estado not in ('todos','hospedados','historial','pendientes','completados') then
    raise exception 'Vista de huéspedes no válida.' using errcode='22023';
  end if;

  with buscar as (
    select lower(nullif(btrim(p_busqueda),'')) texto,
      regexp_replace(lower(btrim(p_busqueda)),'[^a-z0-9]','','g') documento
  ), estadias as materialized (
    select e.id as estadia_id,e.reserva_id,e.numero,e.tipo,e.fecha_ingreso ingreso,e.fecha_salida salida,
      count(*) over (partition by e.reserva_id) tramos,
      case when e.hospedada_vigente then 'hospedados'
        when e.salida_confirmada or e.hasta<=hoy then 'historial'
        else 'por_ingresar' end estado
    from public.haiku_huesped_estadias_v1 e join public.reservas r on r.id=e.reserva_id
    where r.estado_reserva not in ('cancelada','no_show')
  ), integrantes as materialized (
    select i.id,i.reserva_id,i.nombre,i.apellido,i.rol,i.plaza,i.excedente,f.foto,i.tipo_documento,
      coalesce(f.pais_manual,i.nacionalidad) nacionalidad,
      case when nullif(btrim(i.numero_documento),'') is not null then '••••' || right(i.numero_documento,4) end documento,
      (i.plaza is not null or nullif(btrim(i.numero_documento),'') is null) pendiente,
      (p_origen is null or coalesce(f.pais_manual,i.nacionalidad)=p_origen)
      and (p_etiqueta is null or exists (
        select 1 from public.haiku_huesped_etiquetados t where t.ficha_id=i.id and t.etiqueta_id=p_etiqueta
      ))
      and (b.texto is null
        or strpos(lower(concat_ws(' ',i.nombre,i.apellido)),b.texto)>0
        or (i.rol='borrador' and strpos('acompañante '||i.plaza,b.texto)>0)
        or strpos(lower(i.numero_documento),b.texto)>0
        or (b.documento<>'' and strpos(regexp_replace(lower(i.numero_documento),'[^a-z0-9]','','g'),b.documento)>0)
      ) coincide
    from public.haiku_huesped_integrantes_v1 i
    left join public.haiku_huesped_fichas f on f.id=i.id
    cross join buscar b
    where exists(select 1 from estadias e where e.reserva_id=i.reserva_id)
  ), asignaciones as materialized (
    select e.estadia_id,i.id,i.reserva_id,i.nombre,i.apellido,i.rol,i.plaza,i.foto,i.pendiente,i.coincide
    from estadias e join integrantes i on i.reserva_id=e.reserva_id
    where i.rol<>'titular' and not i.excedente
      and (exists (
        select 1 from public.estadia_huespedes h where h.estadia_id=e.estadia_id and h.huesped_id=i.id
      ) or (e.tramos=1 and not exists (
        select 1 from public.estadia_huespedes h join public.reserva_estadias otra on otra.id=h.estadia_id
        where otra.reserva_id=e.reserva_id and h.huesped_id=i.id
      )))
  ), sin_asignar as (
    select i.reserva_id,bool_or(i.coincide) coincide
    from integrantes i
    where i.rol<>'titular' and not i.excedente
      and not exists(select 1 from asignaciones a where (a.reserva_id,a.id)=(i.reserva_id,i.id))
    group by i.reserva_id
  ), resumen_acompanantes as (
    select estadia_id,bool_or(pendiente) pendiente,bool_or(coincide) coincide
    from asignaciones group by estadia_id
  ), filas as materialized (
    select e.estadia_id,e.reserva_id,e.numero,e.tipo,e.ingreso,e.salida,e.estado,
      case e.estado when 'hospedados' then 1 when 'por_ingresar' then 2 else 3 end orden,
      i.id,i.nombre,i.apellido,i.documento,i.tipo_documento,i.plaza,i.foto,
      (i.pendiente or coalesce(a.pendiente,false) or s.reserva_id is not null) pendiente,
      (not i.pendiente
        and exists (
          select 1 from public.haiku_huesped_etiquetados t where t.ficha_id=i.id
        )
        and exists (
          select 1 from public.haiku_huesped_registros r
          where r.ficha_id=i.id and r.categoria='preferencia' and r.texto ~ '[^[:space:]]'
        )
        and exists (
          select 1 from public.haiku_huesped_registros r
          where r.ficha_id=i.id and r.categoria='nota' and r.texto ~ '[^[:space:]]'
        )
      ) ficha_completa,
      (s.reserva_id is not null) por_asignar,
      (b.texto is not null and coalesce(a.coincide,false)) abrir_acompanantes
    from estadias e join integrantes i on i.reserva_id=e.reserva_id and i.rol='titular'
    left join resumen_acompanantes a using (estadia_id)
    left join sin_asignar s on s.reserva_id=e.reserva_id
    cross join buscar b
    where (p_tipo is null or p_tipo=e.tipo) and (i.coincide or a.coincide or s.coincide)
  ), visibles as (
    select * from filas
    where p_estado='todos' or p_estado=estado
      or (p_estado='pendientes' and pendiente)
      or (p_estado='completados' and ficha_completa)
  ), pagina as (
    select * from visibles order by orden,ingreso desc nulls last,numero nulls last,estadia_id
    offset greatest(coalesce(p_desde,0),0) limit 40
  )
  select jsonb_build_object(
    'filas',coalesce((select jsonb_agg(to_jsonb(p)-'orden'-'ficha_completa'||jsonb_build_object('acompanantes',coalesce((
      select jsonb_agg(to_jsonb(a)-'coincide'-'pendiente'-'estadia_id'-'reserva_id'
        order by (a.rol='borrador'),a.plaza nulls last,a.nombre,a.id)
      from asignaciones a where a.estadia_id=p.estadia_id
    ),'[]'::jsonb)) order by p.orden,p.ingreso desc nulls last,p.numero nulls last,p.estadia_id) from pagina p),'[]'),
    'conteos',(select jsonb_build_object('todos',count(*),'hospedados',count(*) filter(where estado='hospedados'),
      'historial',count(*) filter(where estado='historial'),'pendientes',count(*) filter(where pendiente),
      'completados',count(*) filter(where ficha_completa)) from filas),
    'grupos',coalesce((select jsonb_object_agg(v.estado,jsonb_build_object('estadias',v.estadias,'titulares',v.titulares))
      from (select estado,count(*) estadias,count(distinct id) titulares from visibles group by estado) v),'{}'),
    'titulares',(select count(distinct id) from visibles),
    'cabanas',(select count(distinct numero) from visibles),
    'puede_editar',private.haiku_huesped_puede_editar(),
    'tipos',coalesce((select jsonb_agg(t.tipo order by t.tipo)
      from (select distinct tipo from estadias where tipo is not null) t),'[]'),
    'origenes',coalesce((select jsonb_agg(t.nacionalidad order by t.nacionalidad)
      from (select distinct nacionalidad from integrantes where nullif(btrim(nacionalidad),'') is not null) t),'[]'),
    'etiquetas',(select coalesce(jsonb_agg(to_jsonb(e) order by e.grupo,e.nombre),'[]') from public.haiku_huesped_etiquetas e)
  ) into resultado;
  return resultado;
end $$;

commit;
