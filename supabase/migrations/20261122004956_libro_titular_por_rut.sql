-- Ofrece la ficha registrada únicamente cuando el RUT es válido, el registro
-- canónico está activo y la revisión del Libro detecta un nombre distinto.
create function public.haiku_libro_sugerir_titular_rut_v1(p_altas jsonb)
returns table(posicion integer, titular_id uuid, titular_nombre text)
language plpgsql stable security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null
     or private.haiku_tiene_permiso('reservas.crear') is not true
     or private.haiku_tiene_permiso('huespedes.ver') is not true then
    raise exception 'Sin permiso para consultar la ficha por RUT' using errcode = '42501';
  end if;

  return query
  select revision.posicion, h.id, h.nombre
  from public.haiku_libro_revisar_rut_altas_v1(p_altas) revision
  join private.haiku_rut_registro_v1 registro
    on registro.clave = private.haiku_rut_clave_v1(p_altas->(revision.posicion - 1)->>'rut')
  join public.huespedes h on h.id = registro.huesped_id
  where revision.motivo = 'nombre_distinto' and not registro.bloqueado
    and h.tipo_documento = 'rut'
    and private.haiku_rut_clave_v1(h.numero_documento) = registro.clave
    and not exists (
      select 1 from private.haiku_huesped_alias_v1 alias
      where alias.redundante_id = h.id and alias.revertido_en is null
    )
  order by revision.posicion;
end;
$$;

-- El guard existente valida el nombre canónico y el RUT bajo lock. La sesión
-- comprueba además el UUID confirmado antes de hacer commit, incluso cuando
-- el writer identifica una reserva ya existente o devuelve un reintento.
create function public.haiku_libro_incorporar_titular_rut_v1(p_operacion_id uuid, p_items jsonb)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public, private
as $$
declare
  resultado jsonb;
  item jsonb;
begin
  if auth.uid() is null
     or private.haiku_tiene_permiso('reservas.crear') is not true
     or private.haiku_tiene_permiso('huespedes.ver') is not true then
    raise exception 'Sin permiso para confirmar la ficha por RUT' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Los elementos deben enviarse como un arreglo';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'La incorporación admite como máximo 100 elementos';
  end if;
  for item in
    select dato from jsonb_array_elements(p_items) entrada(dato) where dato ? 'titular_existente_v1'
  loop
    if item->>'tipo' is distinct from 'reserva_nueva'
       or item->'reserva'->>'titular_tipo_documento' is distinct from 'rut'
       or private.haiku_rut_clave_v1(item->'reserva'->>'titular_numero_documento') is null
       or coalesce(item->>'titular_existente_v1','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
      raise exception 'La ficha confirmada requiere un alta con RUT válido' using errcode = 'HLI02';
    end if;
  end loop;

  resultado := public.haiku_incorporar_libro_v1(p_operacion_id,p_items);
  if exists (
    select 1 from jsonb_array_elements(p_items) entrada(dato)
    where dato ? 'titular_existente_v1'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(resultado->'resultados','[]'::jsonb) ||
                                  coalesce(resultado->'detalle_omitidos','[]'::jsonb)) salida(registro)
        join public.reservas r on r.id = (registro->>'reserva_id')::uuid
        where registro->>'item_id' = dato->>'item_id'
          and registro->>'tipo' = 'reserva_nueva'
          and r.titular_huesped_id = (dato->>'titular_existente_v1')::uuid
          and r.titular_tipo_documento = 'rut'
          and private.haiku_rut_clave_v1(r.titular_numero_documento) =
              private.haiku_rut_clave_v1(dato->'reserva'->>'titular_numero_documento')
      )
  ) then
    raise exception 'La ficha del titular cambió desde la revisión' using errcode = 'HLI02';
  end if;
  return resultado;
end;
$$;

revoke all on function public.haiku_libro_sugerir_titular_rut_v1(jsonb),
  public.haiku_libro_incorporar_titular_rut_v1(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.haiku_libro_sugerir_titular_rut_v1(jsonb),
  public.haiku_libro_incorporar_titular_rut_v1(uuid,jsonb) to authenticated;
