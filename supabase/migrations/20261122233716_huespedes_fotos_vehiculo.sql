begin;

alter table public.haiku_huesped_vehiculos
  add column foto_posicion_y smallint not null default 50 check (foto_posicion_y between 0 and 100),
  add column fotos_adicionales text[] not null default '{}';

-- El perfil ya devuelve la fila del vehículo. Tanto las fotos existentes como
-- las nuevas usan el bucket privado y la autorización de la reserva.
alter policy huesped_foto_lectura on storage.objects using (
  bucket_id='haiku-huespedes' and (select private.haiku_huesped_puede_leer()) and (
    (split_part(name,'/',1)=(select auth.uid())::text and (select private.haiku_huesped_puede_editar()))
    or exists (select 1 from public.haiku_huesped_fichas f where f.foto=name)
    or exists (select 1 from public.haiku_huesped_vehiculos v where v.foto=name or name=any(v.fotos_adicionales))
    or exists (select 1 from public.haiku_huesped_mascotas m where m.foto=name)
  )
);

create or replace function private.haiku_huesped_foto_libre(p_ruta text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.haiku_huesped_puede_editar() and not exists (
    select 1 from public.haiku_huesped_fichas where foto=p_ruta
    union all select 1 from public.haiku_huesped_vehiculos where foto=p_ruta or p_ruta=any(fotos_adicionales)
    union all select 1 from public.haiku_huesped_mascotas where foto=p_ruta
  )
$$;

create function private.haiku_huesped_vehiculo_fotos_v1(
  p_id uuid,p_reserva uuid,p_fotos jsonb,p_operador uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actual public.haiku_huesped_vehiculos%rowtype;
  principal text;
  posicion smallint;
  adicionales text[];
  anteriores text[];
  nuevas text[];
  ruta text;
begin
  if jsonb_typeof(p_fotos) is distinct from 'object'
    or not (p_fotos ?& array['principal','posicion_y','adicionales','esperadas'])
    or jsonb_typeof(p_fotos->'principal') not in ('string','null')
    or jsonb_typeof(p_fotos->'posicion_y') is distinct from 'number'
    or jsonb_typeof(p_fotos->'adicionales') is distinct from 'array'
    or exists (select 1 from jsonb_array_elements(p_fotos->'adicionales') a where jsonb_typeof(a) <> 'string') then
    raise exception 'Las fotos del vehículo no tienen un formato válido.' using errcode='22023';
  end if;
  principal := p_fotos->>'principal';
  posicion := (p_fotos->>'posicion_y')::smallint;
  adicionales := array(select jsonb_array_elements_text(p_fotos->'adicionales'));
  nuevas := array_remove(array[principal] || adicionales,null);
  if posicion not between 0 and 100
    or cardinality(nuevas) <> (select count(distinct f) from unnest(nuevas) f) then
    raise exception 'Revisa el encuadre y las fotos repetidas.' using errcode='22023';
  end if;
  select v.* into strict actual from public.haiku_huesped_vehiculos v
    where v.id=p_id and v.reserva_id=p_reserva for update;
  if (p_fotos->'esperadas') is distinct from jsonb_build_object(
    'principal',actual.foto,'posicion_y',actual.foto_posicion_y,'adicionales',actual.fotos_adicionales) then
    raise exception 'Las fotos cambiaron. Vuelve a abrir el vehículo para revisar la versión actual.' using errcode='40001';
  end if;
  anteriores := array_remove(array[actual.foto] || actual.fotos_adicionales,null);
  -- Los objetos recién subidos deben pertenecer al operador de esta sesión.
  -- Los ya asociados al vehículo pueden conservarse por cualquier editor.
  foreach ruta in array nuevas loop
    if ruta=any(anteriores) then continue; end if;
    if split_part(ruta,'/',1)<>p_operador::text then
      raise exception 'Ruta de foto no autorizada.' using errcode='42501';
    end if;
    perform 1 from storage.objects o where o.bucket_id='haiku-huespedes' and o.name=ruta for update;
    if not found then raise exception 'La foto todavía no está disponible.' using errcode='P0002'; end if;
  end loop;
  update public.haiku_huesped_vehiculos
     set foto=principal,foto_posicion_y=posicion,fotos_adicionales=adicionales
   where id=p_id and reserva_id=p_reserva;
  return jsonb_build_object('id',p_id,'fotos_guardadas',true,
    'fotos_retiradas',array(select f from unnest(anteriores) f where not f=any(nuevas)));
end $$;
revoke all on function private.haiku_huesped_vehiculo_fotos_v1(uuid,uuid,jsonb,uuid) from public, anon, authenticated;

-- Reusa el guardado autorizado de Huéspedes y su transacción. El bloque
-- explícito permite distinguir el operador local de la columna homónima.
do $$
declare
  origen text := pg_get_functiondef('private.haiku_huesped_guardar_v1(uuid,uuid,text,jsonb)'::regprocedure);
  destino text;
  antes text := E'    if not found then raise exception ''El vehículo pertenece a otra reserva.'' using errcode=''22023''; end if;\n';
begin
  if strpos(origen,E'$function$\ndeclare\n')=0 or strpos(origen,antes)=0
    or (length(origen)-length(replace(origen,'haiku_huesped_guardar_v1.operador',''))) <> 2*length('haiku_huesped_guardar_v1.operador') then
    raise exception 'La función de Huéspedes difiere de la versión revisada.';
  end if;
  destino := replace(origen,E'$function$\ndeclare\n',E'$function$\n<<edicion>>\ndeclare\n');
  destino := replace(destino,'haiku_huesped_guardar_v1.operador','edicion.operador');
  destino := replace(destino,antes,antes ||
    E'    if p_datos ? ''fotos'' then\n' ||
    E'      return private.haiku_huesped_vehiculo_fotos_v1(objeto_id,p_reserva,p_datos->''fotos'',operador);\n' ||
    E'    end if;\n');
  execute destino;
end $$;

commit;
