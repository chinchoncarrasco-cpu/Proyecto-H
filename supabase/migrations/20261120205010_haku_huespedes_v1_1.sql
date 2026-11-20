
-- Huéspedes V1.1. Las identidades y sus vínculos siguen en las tablas operativas.
create table public.haiku_huesped_fichas (
  id uuid primary key,
  huesped_id uuid unique references public.huespedes(id),
  reserva_id uuid references public.reservas(id),
  plaza integer,
  enlazado_huesped_id uuid references public.huespedes(id),
  cupo_revisado_en timestamptz,
  descripcion text check (length(descripcion) <= 4000),
  idioma text check (length(idioma) <= 80),
  pais_manual text check (length(pais_manual) <= 80),
  telefono_manual text check (length(telefono_manual) <= 100),
  correo_manual text check (length(correo_manual) <= 200),
  foto text,
  actualizado_por uuid not null references public.usuarios(id),
  actualizado_en timestamptz not null default now(),
  unique (reserva_id, plaza),
  check ((huesped_id is not null and huesped_id = id and reserva_id is null and plaza is null and enlazado_huesped_id is null)
      or (huesped_id is null and reserva_id is not null and plaza is not null and plaza >= 0))
);

create table public.haiku_huesped_etiquetas (
  id uuid primary key default gen_random_uuid(),
  grupo text not null check (grupo in ('Motivo','Compañía','Intereses','Atención')),
  nombre text not null check (length(btrim(nombre)) between 1 and 80)
);
create unique index haiku_huesped_etiqueta_nombre on public.haiku_huesped_etiquetas (grupo, lower(nombre));
insert into public.haiku_huesped_etiquetas(grupo,nombre)
select grupo, unnest(nombres) from (values
 ('Motivo', array['Descanso','Escapada romántica','Luna de miel','Celebración','Trabajo','Trabajo y descanso','Evento o retiro','Visita familiar']),
 ('Compañía', array['Solo','En pareja','Familia','Amigos','Con mascota']),
 ('Intereses', array['Turismo aventura','Rafting','Senderismo','Naturaleza','Fotografía','Gastronomía','Vino','Cultura local','Bienestar','Tinajas','Piscina','Fogón y parrilla','Ecoturismo']),
 ('Atención', array['Sociable','Networking','Prefiere privacidad','Autónomo','Prefiere orientación'])
) catalogo(grupo,nombres);
create table public.haiku_huesped_etiquetados (
  ficha_id uuid references public.haiku_huesped_fichas(id) on delete cascade,
  etiqueta_id uuid references public.haiku_huesped_etiquetas(id),
  operador uuid not null references public.usuarios(id),
  fecha timestamptz not null default now(),
  primary key (ficha_id, etiqueta_id)
);
create index haiku_huesped_etiquetados_etiqueta on public.haiku_huesped_etiquetados(etiqueta_id, ficha_id);

create table public.haiku_huesped_registros (
  id uuid primary key default gen_random_uuid(),
  ficha_id uuid not null references public.haiku_huesped_fichas(id),
  reserva_id uuid references public.reservas(id),
  estadia_id uuid references public.reserva_estadias(id),
  categoria text not null check (categoria in ('preferencia','actividad','nota','vestimenta')),
  texto text check (length(texto) <= 4000),
  superior text check (length(superior) <= 160),
  inferior text check (length(inferior) <= 160),
  fuente text not null check (fuente in ('Observación','Lo comentó','Confirmado por huésped')),
  nombre_operador text not null,
  operador uuid not null references public.usuarios(id),
  fecha timestamptz not null default now(),
  modificado_por uuid not null references public.usuarios(id),
  modificado_en timestamptz not null default now(),
  check (categoria not in ('actividad','vestimenta') or reserva_id is not null),
  check (categoria <> 'preferencia' or reserva_id is null),
  check (texto is not null or (categoria = 'vestimenta' and (superior is not null or inferior is not null)))
);
create index haiku_huesped_registros_ficha_fecha on public.haiku_huesped_registros(ficha_id,fecha desc);
create index haiku_huesped_registros_reserva on public.haiku_huesped_registros(reserva_id) where reserva_id is not null;

create table public.haiku_huesped_vehiculos (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservas(id),
  estadia_id uuid references public.reserva_estadias(id),
  tipo text not null check (length(btrim(tipo)) between 1 and 80),
  modelo text check (length(modelo) <= 120),
  color text check (length(color) <= 80),
  patente text check (length(patente) <= 30),
  foto text,
  operador uuid not null references public.usuarios(id),
  fecha timestamptz not null default now()
);
create index haiku_huesped_vehiculos_reserva on public.haiku_huesped_vehiculos(reserva_id);

create table public.haiku_huesped_mascotas (
  id uuid primary key default gen_random_uuid(),
  ficha_id uuid not null references public.haiku_huesped_fichas(id),
  nombre text not null check (length(btrim(nombre)) between 1 and 100),
  especie text not null check (length(btrim(especie)) between 1 and 80),
  raza text check (length(raza) <= 100),
  tamano text check (length(tamano) <= 50),
  color text check (length(color) <= 80),
  cuidados text check (length(cuidados) <= 4000),
  foto text,
  operador uuid not null references public.usuarios(id),
  fecha timestamptz not null default now()
);
create index haiku_huesped_mascotas_ficha on public.haiku_huesped_mascotas(ficha_id);
create table public.haiku_huesped_mascota_visitas (
  mascota_id uuid references public.haiku_huesped_mascotas(id),
  reserva_id uuid references public.reservas(id),
  estadia_id uuid references public.reserva_estadias(id),
  operador uuid not null references public.usuarios(id),
  fecha timestamptz not null default now(),
  primary key (mascota_id,reserva_id)
);
create index haiku_huesped_mascota_visitas_reserva on public.haiku_huesped_mascota_visitas(reserva_id, mascota_id);

create function private.haiku_huesped_puede_leer() returns boolean
language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and private.haiku_usuario_activo() and private.haiku_tiene_permiso('huespedes.ver')
$$;

create function private.haiku_huesped_puede_editar() returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.haiku_huesped_puede_leer() and private.haiku_tiene_permiso('huespedes.gestionar')
$$;
revoke all on function private.haiku_huesped_puede_leer(), private.haiku_huesped_puede_editar() from public, anon;
grant execute on function private.haiku_huesped_puede_leer(), private.haiku_huesped_puede_editar() to authenticated;

do $$
declare tabla text;
begin
  foreach tabla in array array['fichas','etiquetas','etiquetados','registros','vehiculos','mascotas','mascota_visitas'] loop
    tabla := 'haiku_huesped_' || tabla;
    execute format('alter table public.%I enable row level security',tabla);
    execute format('revoke all on public.%I from public, anon, authenticated',tabla);
    execute format('grant select on public.%I to authenticated',tabla);
    execute format('create policy huesped_lectura on public.%I for select to authenticated using ((select private.haiku_huesped_puede_leer()))',tabla);
  end loop;
end $$;

-- Los tramos sucesivos cuentan una vez. Las cabañas simultáneas sí suman plazas.
create view public.haiku_huesped_estadias_v1 with (security_invoker = true) as
select e.id, e.reserva_id, e.cabana_id, c.numero, c.nombre as cabana, c.tipo,
       e.fecha_ingreso, e.fecha_salida, e.adultos, e.ninos, e.mascotas, e.estado_estadia,
       greatest(e.fecha_salida,e.fecha_ingreso+1) as hasta
from public.reserva_estadias e left join public.cabanas c on c.id = e.cabana_id
where e.estado_estadia not in ('cancelada','no_show')
  and (select private.haiku_huesped_puede_leer());

create view public.haiku_huesped_ocupacion_v1 with (security_invoker = true) as
with eventos as (
  select reserva_id, fecha_ingreso as dia from public.haiku_huesped_estadias_v1
  union
  select reserva_id, hasta from public.haiku_huesped_estadias_v1
), simultaneos as (
  select v.reserva_id,v.dia,e.cabana_id,max(e.adultos) adultos,max(e.ninos) ninos,max(e.mascotas) mascotas
  from eventos v join public.haiku_huesped_estadias_v1 e on e.reserva_id=v.reserva_id
    and e.fecha_ingreso<=v.dia and v.dia<e.hasta
  group by v.reserva_id,v.dia,e.cabana_id
), dias as (
  select reserva_id,dia,sum(adultos)::integer adultos,sum(ninos)::integer ninos,sum(mascotas)::integer mascotas
  from simultaneos group by reserva_id,dia
), mayor as (
  select distinct on (reserva_id) * from dias order by reserva_id,adultos+ninos desc,dia
)
select e.reserva_id,
  coalesce(m.adultos,0) as adultos,coalesce(m.ninos,0) as ninos,
  coalesce(m.mascotas,0) as mascotas,
  min(e.fecha_ingreso) as ingreso,max(e.fecha_salida) as salida,
  bool_or(e.estado_estadia='hospedada') as hospedada,
  case when count(*)=1 then (array_agg(e.id))[1] end as estadia_id,
  case when count(distinct e.cabana_id)=1 then min(e.numero) end as numero,
  case when count(distinct e.cabana_id)=1 then min(e.tipo) end as tipo,
  coalesce(array_agg(distinct e.tipo) filter (where e.tipo is not null),array[]::text[]) as tipos
from public.haiku_huesped_estadias_v1 e left join mayor m using(reserva_id)
group by e.reserva_id,m.adultos,m.ninos,m.mascotas;

create view public.haiku_huesped_integrantes_v1 with (security_invoker = true) as
with vinculados as (
  select r.id as reserva_id,r.titular_huesped_id as id from public.reservas r where r.titular_huesped_id is not null
  union select h.reserva_id,h.huesped_id from public.reserva_huespedes h
  union select e.reserva_id,h.huesped_id from public.estadia_huespedes h join public.haiku_huesped_estadias_v1 e on e.id=h.estadia_id
), personas as (
  select v.reserva_id,h.id,h.nombre,h.apellido,h.tipo_documento,h.numero_documento,h.nacionalidad,
    case when r.titular_huesped_id=h.id then 'titular' else 'acompanante' end as rol,
    null::integer as plaza,false as excedente
  from vinculados v join public.huespedes h on h.id=v.id join public.reservas r on r.id=v.reserva_id
  union all
  select r.id,md5('haku-huesped:'||r.id::text||':0')::uuid,
    r.titular_nombre,null,r.titular_tipo_documento,r.titular_numero_documento,null,'titular',0,false
  from public.reservas r where r.titular_huesped_id is null
), faltantes as (
  select o.reserva_id,g.plaza
  from public.haiku_huesped_ocupacion_v1 o join public.reservas r on r.id=o.reserva_id
  left join (select reserva_id,count(*)::integer cantidad from personas group by reserva_id) p using (reserva_id)
  cross join lateral generate_series(1, greatest(0,o.adultos+o.ninos-coalesce(p.cantidad,1))) g(plaza)
  where o.hospedada or r.estado_reserva in ('pendiente','confirmada')
), candidatos as (
  select reserva_id,plaza from faltantes
  union
  select reserva_id,plaza from public.haiku_huesped_fichas where plaza>0 and enlazado_huesped_id is null
), plazas as (
  -- Las plazas activas se eligen primero entre los borradores guardados.
  select c.reserva_id,c.plaza,f.id as ficha_id,
    row_number() over (partition by c.reserva_id order by f.id is null,c.plaza) as prioridad,
    coalesce(t.cantidad,0) as necesarias
  from candidatos c
  left join public.haiku_huesped_fichas f on (f.reserva_id,f.plaza)=(c.reserva_id,c.plaza)
  left join (select reserva_id,count(*) cantidad from faltantes group by reserva_id) t on t.reserva_id=c.reserva_id
  where f.enlazado_huesped_id is null
), suplentes as (
  -- Un ordinal ya completado nunca se reutiliza mientras haya otro cupo pendiente.
  select t.reserva_id,g.plaza,null::uuid as ficha_id
  from (select reserva_id,max(necesarias)-count(*) filter (where prioridad<=necesarias) faltan,
        max(plaza) ultima from plazas group by reserva_id
        union all select f.reserva_id,count(*),max(f.plaza) from faltantes f
        where not exists (select 1 from plazas p where p.reserva_id=f.reserva_id) group by f.reserva_id) t
  cross join lateral generate_series(1,t.faltan::integer) s(n)
  cross join lateral (select greatest(t.ultima,coalesce((select max(f.plaza) from public.haiku_huesped_fichas f where f.reserva_id=t.reserva_id),0))+s.n as plaza) g
), integrantes as (
  select * from personas
  union all
  select p.reserva_id,coalesce(p.ficha_id,md5('haku-huesped:'||p.reserva_id::text||':'||p.plaza)::uuid),
    null,null,null,null,null,'borrador',p.plaza,p.prioridad>p.necesarias
  from plazas p where p.prioridad<=p.necesarias or p.ficha_id is not null
  union all
  select p.reserva_id,md5('haku-huesped:'||p.reserva_id::text||':'||p.plaza)::uuid,
    null,null,null,null,null,'borrador',p.plaza,false from suplentes p
)
select i.* from integrantes i where (select private.haiku_huesped_puede_leer());

create view public.haiku_huesped_visitas_v1 with (security_invoker = true) as
select i.id,i.reserva_id,i.rol,i.plaza,i.excedente,r.codigo_haiku,
  coalesce(r.grupo_reserva_id,r.id) as visita_grupo,
  o.ingreso,o.salida,o.adultos,o.ninos,o.mascotas,
  case when a.estadia_id is not null then a.hospedada else coalesce(o.hospedada,false) end as hospedada,
  coalesce(a.estadia_id,o.estadia_id) as estadia_id,
  case when a.estadia_id is not null then a.numero else o.numero end as numero,
  case when a.estadia_id is not null then a.tipo else o.tipo end as tipo,
  case when a.estadia_id is not null then a.tipos when cardinality(o.tipos)=1 then o.tipos else array[]::text[] end as tipos
from public.haiku_huesped_integrantes_v1 i
join public.reservas r on r.id=i.reserva_id
left join public.haiku_huesped_ocupacion_v1 o on o.reserva_id=i.reserva_id
left join lateral (
  select (array_agg(e.id order by (e.estado_estadia='hospedada') desc,e.fecha_ingreso desc,e.id))[1] as estadia_id,
    bool_or(e.estado_estadia='hospedada') as hospedada,
    (array_agg(e.numero order by (e.estado_estadia='hospedada') desc,e.fecha_ingreso desc,e.id))[1] as numero,
    (array_agg(e.tipo order by (e.estado_estadia='hospedada') desc,e.fecha_ingreso desc,e.id))[1] as tipo,
    coalesce(array_agg(distinct e.tipo) filter (where e.tipo is not null),array[]::text[]) as tipos
  from public.estadia_huespedes eh join public.haiku_huesped_estadias_v1 e on e.id=eh.estadia_id
  where eh.huesped_id=i.id and e.reserva_id=i.reserva_id
) a on i.plaza is null;

revoke all on public.haiku_huesped_estadias_v1, public.haiku_huesped_ocupacion_v1,
  public.haiku_huesped_integrantes_v1, public.haiku_huesped_visitas_v1 from public, anon, authenticated;
grant select on public.haiku_huesped_estadias_v1, public.haiku_huesped_ocupacion_v1,
  public.haiku_huesped_integrantes_v1, public.haiku_huesped_visitas_v1 to authenticated;


alter policy huesped_lectura on public.haiku_huesped_fichas using (
  (select private.haiku_huesped_puede_leer()) and (reserva_id is null or (select private.haiku_tiene_permiso('reservas.ver')))
);
alter policy huesped_lectura on public.haiku_huesped_registros using (
  (select private.haiku_huesped_puede_leer()) and (reserva_id is null or (select private.haiku_tiene_permiso('reservas.ver')))
  and exists (select 1 from public.haiku_huesped_fichas f where f.id=ficha_id)
);
alter policy huesped_lectura on public.haiku_huesped_etiquetados using (
  (select private.haiku_huesped_puede_leer()) and exists (select 1 from public.haiku_huesped_fichas f where f.id=ficha_id)
);
alter policy huesped_lectura on public.haiku_huesped_mascotas using (
  (select private.haiku_huesped_puede_leer()) and exists (select 1 from public.haiku_huesped_fichas f where f.id=ficha_id)
);
alter policy huesped_lectura on public.haiku_huesped_vehiculos using (
  (select private.haiku_huesped_puede_leer()) and (select private.haiku_tiene_permiso('reservas.ver'))
);
alter policy huesped_lectura on public.haiku_huesped_mascota_visitas using (
  (select private.haiku_huesped_puede_leer()) and (select private.haiku_tiene_permiso('reservas.ver'))
);

create view public.haiku_huesped_personas_v1 with (security_invoker = true) as
select h.id,h.nombre,h.apellido,h.tipo_documento,h.numero_documento,
       coalesce(f.pais_manual,h.nacionalidad) as nacionalidad,
       coalesce(f.telefono_manual,h.telefono) as telefono,
       coalesce(f.correo_manual,h.correo) as correo,false as borrador
from public.huespedes h left join public.haiku_huesped_fichas f on f.id=h.id
where (select private.haiku_huesped_puede_leer())
union all
select i.id,i.nombre,i.apellido,i.tipo_documento,i.numero_documento,
       coalesce(f.pais_manual,i.nacionalidad),
       coalesce(f.telefono_manual,case when i.plaza=0 then r.telefono_contacto end),
       coalesce(f.correo_manual,case when i.plaza=0 then r.correo_contacto end),i.plaza>0
from public.haiku_huesped_integrantes_v1 i join public.reservas r on r.id=i.reserva_id
left join public.haiku_huesped_fichas f on f.id=i.id
where i.plaza is not null;
revoke all on public.haiku_huesped_personas_v1 from public, anon, authenticated;
grant select on public.haiku_huesped_personas_v1 to authenticated;

create function public.haiku_huesped_directorio_v1(
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
      p.nacionalidad,p.borrador,
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

create function public.haiku_huesped_perfil_v1(p_id uuid,p_reserva uuid default null,p_historial boolean default false)
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

revoke all on function public.haiku_huesped_directorio_v1(text,text,text,text,uuid,integer),
  public.haiku_huesped_perfil_v1(uuid,uuid,boolean) from public, anon;
grant execute on function public.haiku_huesped_directorio_v1(text,text,text,text,uuid,integer),
  public.haiku_huesped_perfil_v1(uuid,uuid,boolean) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('haiku-huespedes','haiku-huespedes',false,5242880,array['image/jpeg']);
create policy huesped_foto_lectura on storage.objects for select to authenticated using (
  bucket_id='haiku-huespedes' and (select private.haiku_huesped_puede_leer()) and (
    (split_part(name,'/',1)=(select auth.uid())::text and (select private.haiku_huesped_puede_editar()))
    or exists (select 1 from public.haiku_huesped_fichas f where f.foto=name)
    or exists (select 1 from public.haiku_huesped_vehiculos v where v.foto=name)
    or exists (select 1 from public.haiku_huesped_mascotas m where m.foto=name)
  )
);
create policy huesped_foto_subida on storage.objects for insert to authenticated with check (
  bucket_id='haiku-huespedes' and (select private.haiku_huesped_puede_editar())
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.jpg$'
  and split_part(name,'/',1)=(select auth.uid())::text
);
-- Los objetos son inmutables. Sólo se eliminan objetos que no estén referenciados.
create function private.haiku_huesped_foto_libre(p_ruta text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.haiku_huesped_puede_editar() and not exists (
    select 1 from public.haiku_huesped_fichas where foto=p_ruta
    union all select 1 from public.haiku_huesped_vehiculos where foto=p_ruta
    union all select 1 from public.haiku_huesped_mascotas where foto=p_ruta
  )
$$;
revoke all on function private.haiku_huesped_foto_libre(text) from public, anon;
grant execute on function private.haiku_huesped_foto_libre(text) to authenticated;
create policy huesped_foto_retiro on storage.objects for delete to authenticated using (
  bucket_id='haiku-huespedes' and private.haiku_huesped_foto_libre(name)
);


create function private.haiku_huesped_guardar_v1(p_id uuid,p_reserva uuid,p_accion text,p_datos jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  operador uuid := auth.uid();
  actor_nombre text;
  miembro record;
  ficha public.haiku_huesped_fichas%rowtype;
  visita public.haiku_huesped_visitas_v1%rowtype;
  registro public.haiku_huesped_registros%rowtype;
  objeto_id uuid := nullif(p_datos->>'id','')::uuid;
  destino uuid;
  etiqueta uuid;
  alcance uuid;
  estadia uuid;
  categoria text;
  fuente text;
  v_nombre text;
  documento text;
  tipo_documento text;
  ruta text;
  anterior text;
  clase text;
  cantidad integer;
begin
  if operador is null or private.haiku_huesped_puede_editar() is distinct from true then
    raise exception 'No tienes permiso para modificar Huéspedes.' using errcode='42501';
  end if;
  if p_accion='crear_etiqueta' then
    v_nombre:=nullif(btrim(p_datos->>'nombre'),'');
    insert into public.haiku_huesped_etiquetas(grupo,nombre) values(p_datos->>'grupo',v_nombre)
      on conflict (grupo,lower(nombre)) do update set nombre=haiku_huesped_etiquetas.nombre
      returning id into etiqueta;
    return jsonb_build_object('id',etiqueta);
  end if;

  if p_reserva is not null then
    if private.haiku_tiene_permiso('reservas.ver') is distinct from true then
      raise exception 'No tienes permiso para modificar información de esta reserva.' using errcode='42501';
    end if;
    -- Los cambios de ocupación y las operaciones de una misma reserva se serializan.
    perform 1 from public.reservas where id=p_reserva for update;
    if not found then raise exception 'La reserva ya no existe.' using errcode='P0002'; end if;
    select * into visita from public.haiku_huesped_visitas_v1 where id=p_id and reserva_id=p_reserva;
    if not found then raise exception 'La persona ya no participa en esta reserva. Actualiza el directorio.' using errcode='P0002'; end if;
    if p_datos ? 'estadia_id' then
      estadia:=nullif(p_datos->>'estadia_id','')::uuid;
      if estadia is not null and not exists (select 1 from public.haiku_huesped_estadias_v1 where id=estadia and reserva_id=p_reserva) then
        raise exception 'La estadía no corresponde a la reserva.' using errcode='22023';
      end if;
    else
      estadia:=visita.estadia_id;
    end if;
  end if;

  if exists (select 1 from public.huespedes h where h.id=p_id) then
    insert into public.haiku_huesped_fichas(id,huesped_id,actualizado_por)
      values(p_id,p_id,operador) on conflict (id) do nothing;
  else
    select * into miembro from public.haiku_huesped_integrantes_v1 where id=p_id and reserva_id=p_reserva and plaza is not null;
    if not found then raise exception 'El borrador ya fue resuelto o el cupo dejó de estar disponible.' using errcode='P0002'; end if;
    insert into public.haiku_huesped_fichas(id,reserva_id,plaza,actualizado_por)
      values(p_id,p_reserva,miembro.plaza,operador) on conflict (id) do nothing;
  end if;
  select * into strict ficha from public.haiku_huesped_fichas where id=p_id for update;
  if ficha.enlazado_huesped_id is not null then
    raise exception 'Este borrador ya está vinculado a un perfil.' using errcode='40001';
  end if;

  select concat_ws(' ',u.nombre,u.apellido) into strict actor_nombre from public.usuarios u where u.id=operador;

  case p_accion
  when 'ficha' then
    update public.haiku_huesped_fichas set
      descripcion=case when p_datos ? 'descripcion' then nullif(btrim(p_datos->>'descripcion'),'') else descripcion end,
      idioma=case when p_datos ? 'idioma' then nullif(btrim(p_datos->>'idioma'),'') else idioma end,
      pais_manual=coalesce(nullif(btrim(p_datos->>'nacionalidad'),''),pais_manual),
      telefono_manual=coalesce(nullif(btrim(p_datos->>'telefono'),''),telefono_manual),
      correo_manual=coalesce(nullif(btrim(p_datos->>'correo'),''),correo_manual),
      actualizado_por=operador,actualizado_en=now() where id=p_id;

  when 'revisar_cupo' then
    if ficha.plaza is null or ficha.plaza=0 or visita.excedente is distinct from true then
      raise exception 'El cupo sigue pendiente en la ocupación vigente.' using errcode='22023';
    end if;
    update public.haiku_huesped_fichas set cupo_revisado_en=now(),actualizado_por=operador,actualizado_en=now() where id=p_id;

  when 'identificar', 'vincular' then
    if ficha.plaza is null or ficha.reserva_id is distinct from p_reserva then
      raise exception 'Selecciona un borrador de esta reserva.' using errcode='22023';
    end if;
    if ficha.plaza=0 and private.haiku_tiene_permiso('reservas.editar') is distinct from true then
      raise exception 'Para vincular al titular necesitas permiso de edición de reservas.' using errcode='42501';
    end if;
    if p_accion='identificar' then
      v_nombre:=nullif(btrim(p_datos->>'nombre'),'');
      documento:=nullif(btrim(p_datos->>'numero_documento'),'');
      tipo_documento:=nullif(btrim(p_datos->>'tipo_documento'),'');
      if v_nombre is null then raise exception 'Ingresa el nombre o guarda el borrador.' using errcode='22023'; end if;
      if (documento is null)<>(tipo_documento is null) then
        raise exception 'Indica el tipo y número de documento.' using errcode='22023';
      end if;
      if tipo_documento='rut' and private.haiku_rut_clave_v1(documento) is null then
        raise exception 'El RUT ingresado no es válido.' using errcode='22023';
      end if;
      insert into public.huespedes(nombre,apellido,tipo_documento,numero_documento,nacionalidad,telefono,correo)
      values(v_nombre,nullif(btrim(p_datos->>'apellido'),''),tipo_documento,documento,
        nullif(btrim(p_datos->>'nacionalidad'),''),nullif(btrim(p_datos->>'telefono'),''),nullif(btrim(p_datos->>'correo'),''))
      returning id into destino;
    else
      select h.id into destino from public.huespedes h where h.id=(p_datos->>'huesped_id')::uuid;
      if destino is null then raise exception 'El perfil seleccionado ya no existe.' using errcode='P0002'; end if;
      if ficha.plaza>0 and exists (
        select 1 from public.haiku_huesped_integrantes_v1 i where i.reserva_id=p_reserva and i.id=destino
      ) then
        raise exception 'El huésped ya participa en esta reserva.' using errcode='23514';
      end if;
    end if;
    insert into public.haiku_huesped_fichas as f(id,huesped_id,descripcion,idioma,foto,pais_manual,telefono_manual,correo_manual,actualizado_por)
      values(destino,destino,ficha.descripcion,ficha.idioma,ficha.foto,ficha.pais_manual,ficha.telefono_manual,ficha.correo_manual,operador)
      on conflict (id) do update set descripcion=coalesce(f.descripcion,excluded.descripcion),
        idioma=coalesce(f.idioma,excluded.idioma),foto=coalesce(f.foto,excluded.foto),
        pais_manual=coalesce(f.pais_manual,excluded.pais_manual),
        telefono_manual=coalesce(f.telefono_manual,excluded.telefono_manual),
        correo_manual=coalesce(f.correo_manual,excluded.correo_manual),
        actualizado_por=operador,actualizado_en=now();
    if ficha.descripcion is not null and exists (select 1 from public.haiku_huesped_fichas
      where id=destino and descripcion is distinct from ficha.descripcion) then
      insert into public.haiku_huesped_registros(ficha_id,reserva_id,estadia_id,categoria,texto,fuente,operador,nombre_operador,fecha,modificado_por)
        values(destino,p_reserva,estadia,'nota',ficha.descripcion,'Observación',ficha.actualizado_por,
          (select concat_ws(' ',u.nombre,u.apellido) from public.usuarios u where u.id=ficha.actualizado_por),
          ficha.actualizado_en,operador);
    end if;
    insert into public.haiku_huesped_etiquetados(ficha_id,etiqueta_id,operador,fecha)
      select destino,etiqueta_id,e.operador,e.fecha from public.haiku_huesped_etiquetados e where ficha_id=p_id
      on conflict do nothing;
    update public.haiku_huesped_registros set ficha_id=destino where ficha_id=p_id;
    update public.haiku_huesped_mascotas set ficha_id=destino where ficha_id=p_id;
    insert into public.reserva_huespedes(reserva_id,huesped_id) values(p_reserva,destino) on conflict do nothing;
    if estadia is not null then
      insert into public.estadia_huespedes(estadia_id,huesped_id) values(estadia,destino) on conflict do nothing;
    end if;
    if ficha.plaza=0 then update public.reservas set titular_huesped_id=destino where id=p_reserva; end if;
    update public.haiku_huesped_fichas set enlazado_huesped_id=destino,
      foto=case when exists (select 1 from public.haiku_huesped_fichas d where d.id=destino and d.foto=ficha.foto) then null else ficha.foto end,
      actualizado_por=operador,actualizado_en=now() where id=p_id;
    return jsonb_build_object('id',destino);

  when 'etiquetas' then
    if jsonb_typeof(p_datos->'ids') is distinct from 'array' then
      raise exception 'La selección de etiquetas no es válida.' using errcode='22023';
    end if;
    delete from public.haiku_huesped_etiquetados x where ficha_id=p_id
      and not exists (select 1 from jsonb_array_elements_text(p_datos->'ids') x_id where x.etiqueta_id=x_id::uuid);
    insert into public.haiku_huesped_etiquetados(ficha_id,etiqueta_id,operador)
      select p_id,x_id::uuid,operador from jsonb_array_elements_text(p_datos->'ids') x_id on conflict do nothing;

  when 'registro' then
    categoria := p_datos->>'categoria';
    fuente := p_datos->>'fuente';
    alcance := case when categoria in ('actividad','vestimenta') or coalesce((p_datos->>'solo_estadia')::boolean,false)
      then p_reserva end;
    if categoria in ('actividad','vestimenta') and alcance is null
      or p_datos->>'solo_estadia'='true' and alcance is null then
      raise exception 'Selecciona una estadía para este registro.' using errcode='22023';
    end if;
    objeto_id := coalesce(objeto_id,gen_random_uuid());
    insert into public.haiku_huesped_registros as n(id,ficha_id,reserva_id,estadia_id,categoria,texto,superior,inferior,fuente,operador,nombre_operador,modificado_por)
      values(objeto_id,p_id,alcance,case when alcance is not null then estadia end,categoria,
        nullif(btrim(p_datos->>'texto'),''),nullif(btrim(p_datos->>'superior'),''),nullif(btrim(p_datos->>'inferior'),''),fuente,operador,actor_nombre,operador)
      on conflict (id) do update set texto=excluded.texto,superior=excluded.superior,inferior=excluded.inferior,
        fuente=excluded.fuente,categoria=excluded.categoria,reserva_id=excluded.reserva_id,
        estadia_id=excluded.estadia_id,modificado_por=excluded.modificado_por,modificado_en=now()
      where n.ficha_id=p_id and (n.reserva_id is null or n.reserva_id=p_reserva)
        and (not (p_datos ? 'version') or n.modificado_en::text=(p_datos->>'version')
             or n.modificado_en=(p_datos->>'version')::timestamptz)
      returning * into registro;
    if not found then raise exception 'El registro cambió. Actualiza la ficha para editarlo.' using errcode='40001'; end if;

  when 'vehiculo' then
    if p_reserva is null then raise exception 'Selecciona una estadía.' using errcode='22023'; end if;
    objeto_id := coalesce(objeto_id,gen_random_uuid());
    insert into public.haiku_huesped_vehiculos as v(id,reserva_id,estadia_id,tipo,modelo,color,patente,operador)
    values(objeto_id,p_reserva,estadia,nullif(btrim(p_datos->>'tipo'),''),nullif(btrim(p_datos->>'modelo'),''),
      nullif(btrim(p_datos->>'color'),''),nullif(btrim(p_datos->>'patente'),''),operador)
    on conflict (id) do update set tipo=excluded.tipo,modelo=excluded.modelo,color=excluded.color,
      patente=excluded.patente,operador=excluded.operador,fecha=now()
    where v.reserva_id=p_reserva;
    if not found then raise exception 'El vehículo pertenece a otra reserva.' using errcode='22023'; end if;

  when 'mascota' then
    objeto_id := coalesce(objeto_id,gen_random_uuid());
    insert into public.haiku_huesped_mascotas as m(id,ficha_id,nombre,especie,raza,tamano,color,cuidados,operador)
    values(objeto_id,p_id,nullif(btrim(p_datos->>'nombre'),''),nullif(btrim(p_datos->>'especie'),''),
      nullif(btrim(p_datos->>'raza'),''),nullif(btrim(p_datos->>'tamano'),''),nullif(btrim(p_datos->>'color'),''),
      nullif(btrim(p_datos->>'cuidados'),''),operador)
    on conflict (id) do update set nombre=excluded.nombre,especie=excluded.especie,raza=excluded.raza,
      tamano=excluded.tamano,color=excluded.color,cuidados=excluded.cuidados,operador=excluded.operador,fecha=now()
    where m.ficha_id=p_id;
    if not found then raise exception 'La mascota pertenece a otro perfil.' using errcode='22023'; end if;
    if p_reserva is not null and p_datos ? 'presente' then
      if (p_datos->>'presente')::boolean then
        insert into public.haiku_huesped_mascota_visitas(mascota_id,reserva_id,estadia_id,operador)
          values(objeto_id,p_reserva,estadia,operador) on conflict do nothing;
      else
        delete from public.haiku_huesped_mascota_visitas where mascota_id=objeto_id and reserva_id=p_reserva;
      end if;
    end if;

  when 'foto' then
    ruta := nullif(p_datos->>'ruta','');
    clase := p_datos->>'clase';
    if ruta is not null then
      if split_part(ruta,'/',1)<>operador::text then raise exception 'Ruta de foto no autorizada.' using errcode='42501'; end if;
      perform 1 from storage.objects where bucket_id='haiku-huespedes' and name=ruta for update;
      if not found then raise exception 'La foto todavía no está disponible.' using errcode='P0002'; end if;
    end if;
    case clase
    when 'persona' then
      anterior:=ficha.foto;
      update public.haiku_huesped_fichas set foto=ruta,actualizado_por=operador,actualizado_en=now()
        where id=p_id and foto is not distinct from (p_datos->>'esperada');
    when 'vehiculo' then
      select foto into anterior from public.haiku_huesped_vehiculos where id=objeto_id and reserva_id=p_reserva for update;
      update public.haiku_huesped_vehiculos set foto=ruta,operador=haiku_huesped_guardar_v1.operador,fecha=now()
        where id=objeto_id and reserva_id=p_reserva and foto is not distinct from (p_datos->>'esperada');
    when 'mascota' then
      select foto into anterior from public.haiku_huesped_mascotas where id=objeto_id and ficha_id=p_id for update;
      update public.haiku_huesped_mascotas set foto=ruta,operador=haiku_huesped_guardar_v1.operador,fecha=now()
        where id=objeto_id and ficha_id=p_id and foto is not distinct from (p_datos->>'esperada');
    else raise exception 'Destino de la foto no válido.' using errcode='22023';
    end case;
    get diagnostics cantidad = row_count;
    if cantidad<>1 then raise exception 'La foto cambió. Actualiza la ficha antes de continuar.' using errcode='40001'; end if;
    return jsonb_build_object('id',coalesce(objeto_id,p_id),'foto',ruta,'anterior',anterior);
  else
    raise exception 'Operación de Huéspedes no válida.' using errcode='22023';
  end case;
  return jsonb_build_object('id',coalesce(objeto_id,p_id));
end $$;

create function public.haiku_huesped_guardar_v1(p_id uuid,p_reserva uuid,p_accion text,p_datos jsonb)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.haiku_huesped_guardar_v1(p_id,p_reserva,p_accion,p_datos)
$$;
revoke all on function private.haiku_huesped_guardar_v1(uuid,uuid,text,jsonb),
  public.haiku_huesped_guardar_v1(uuid,uuid,text,jsonb) from public, anon;
grant execute on function private.haiku_huesped_guardar_v1(uuid,uuid,text,jsonb),
  public.haiku_huesped_guardar_v1(uuid,uuid,text,jsonb) to authenticated;
