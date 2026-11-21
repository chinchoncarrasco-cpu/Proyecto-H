-- Comprobación de altas del Libro. Conserva el criterio del resolutor de RUT
-- y devuelve sólo la posición y el motivo, sin exponer la ficha registrada.
create function public.haiku_libro_revisar_rut_altas_v1(p_altas jsonb)
returns table(posicion integer, motivo text)
language plpgsql stable security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null
    or private.haiku_tiene_permiso('reservas.crear') is not true
    or private.haiku_tiene_permiso('huespedes.ver') is not true then
    raise exception 'Sin permiso para comprobar identidad de altas' using errcode = '42501';
  end if;
  if jsonb_typeof(p_altas) is distinct from 'array' then
    raise exception 'Se esperaba una lista de altas';
  end if;
  if jsonb_array_length(p_altas) > 100 then
    raise exception 'La comprobación admite como máximo 100 altas';
  end if;

  return query
  with altas as materialized (
    select ordinal::integer as indice,
      private.haiku_rut_clave_v1(alta->>'rut') as clave, btrim(alta->>'nombre') as nombre
    from jsonb_array_elements(p_altas) with ordinality as entrada(alta, ordinal)
  ), incompatibles as (
    select a.clave from altas a
    group by a.clave having count(distinct a.nombre) > 1
  ), revisadas as (
    select a.indice, case
      when a.clave is null then 'rut_invalido'
      when d.bloqueado then 'rut_en_revision'
      when d.clave is not null and btrim(h.nombre) is distinct from a.nombre then 'nombre_distinto'
      when d.clave is null and i.clave is not null then 'nombres_distintos_en_lote'
    end as estado
    from altas a
    left join lateral (
      select r.clave, r.huesped_id, r.bloqueado
      from private.haiku_rut_registro_v1 r where r.clave = a.clave limit 1
    ) d on true
    left join public.huespedes h on h.id = d.huesped_id
    left join incompatibles i on i.clave = a.clave
  )
  select r.indice, r.estado from revisadas r where r.estado is not null order by r.indice;
end
$$;

revoke all on function public.haiku_libro_revisar_rut_altas_v1(jsonb) from public, anon, authenticated;
grant execute on function public.haiku_libro_revisar_rut_altas_v1(jsonb) to authenticated;
