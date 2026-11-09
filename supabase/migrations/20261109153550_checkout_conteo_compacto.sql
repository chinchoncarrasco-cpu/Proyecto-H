-- Counts are separate from human notes. Sector completion is derived atomically.
alter table public.revisiones_checkout
  add column conteos jsonb not null default '{}'::jsonb check (jsonb_typeof(conteos)='object' and octet_length(conteos::text)<=4000),
  add column recorrido_version smallint not null default 2 check (recorrido_version in (2,3));
grant update(conteos,recorrido_version) on public.revisiones_checkout to authenticated;

create function private.haiku_validar_recorrido_checkout_v3() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare k text; item jsonb; n integer; expected integer; area text; required text[];
  inventory text[]:=array['platos','tazas','vasos','copas_flauta','copas_vino','tenedores','cuchillos','cucharas_grandes','cucharas_chicas'];
begin
  if tg_op='UPDATE' and old.recorrido_version=3 and new.recorrido_version<>3 then
    raise exception 'No se puede retirar el detalle de esta revisión.' using errcode='22023'; end if;
  if tg_op='UPDATE' and old.revision_estado='revisada' and new.revision_estado='revisada'
    and (new.conteos is distinct from old.conteos or new.chequeados is distinct from old.chequeados or new.recorrido_version is distinct from old.recorrido_version) then
    raise exception 'Reabre la revisión antes de cambiar los checks.' using errcode='22023'; end if;
  if new.conteos<>'{}'::jsonb and new.recorrido_version<>3 then raise exception 'Versión de conteo no válida.' using errcode='22023'; end if;
  if new.conteos<>'{}'::jsonb then
    select numero into n from public.cabanas where id=new.cabana_id;
    expected:=case when n between 1 and 6 then 3 when n between 7 and 9 then 5 when n=10 then 2 when n=11 then 4 end;
    if expected is null then raise exception 'La cabaña no tiene dotación definida.' using errcode='22023'; end if;
    for k,item in select * from jsonb_each(new.conteos) loop
      if not(k=any(inventory)) or jsonb_typeof(item) is distinct from 'object'
        or jsonb_typeof(item->'encontrados') is distinct from 'number' or (item->>'encontrados') !~ '^\d{1,2}$'
        or item->'esperados' is distinct from to_jsonb(expected)
        or (select count(*) from jsonb_object_keys(item))<>2 then
        raise exception 'Cantidad o dotación no válida para esta cabaña.' using errcode='22023'; end if;
    end loop;
  end if;
  if new.recorrido_version=3 then
    foreach area in array array['cocina','bano','living','terraza'] loop
      required:=case area
        when 'cocina' then array['cocina_refri','cocina_perillas','cocina_gas','cocina_piso']
        when 'bano' then array['bano_secador','bano_toallas','bano_ducha','bano_wc','bano_cortina','bano_piso']
        when 'living' then array['living_cama','living_cajones','living_controles','living_tv','living_ac','living_manilla','living_ventanales','living_piso']
        else array['terraza_atizador','terraza_escobillon','terraza_mesa','terraza_cojines','terraza_jardineras','terraza_piso'] end;
      new.chequeados:=array_remove(new.chequeados,area);
      if new.chequeados @> required and (area<>'cocina' or new.conteos ?& inventory) then new.chequeados:=new.chequeados||area; end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function private.haiku_validar_recorrido_checkout_v3() from public,anon;
-- Runs before the existing revision guards, which also protect direct Data API writes.
create trigger checkout_00_recorrido_validar before insert or update on public.revisiones_checkout
  for each row execute function private.haiku_validar_recorrido_checkout_v3();

create function public.haiku_guardar_recorrido_checkout_v3(p_fecha date,p_cabana_id uuid,p_estadia_id uuid,p_campo text,p_valor jsonb)
returns public.revisiones_checkout language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.revisiones_checkout; item_id text; n integer; expected integer;
begin
  if auth.uid() is null or not private.haiku_usuario_activo() or not private.haiku_tiene_permiso('revisiones.gestionar') then
    raise exception 'Tu usuario no puede editar la revisión de salida.' using errcode='42501'; end if;
  if p_campo is null or p_campo not in ('punto','conteo') or jsonb_typeof(p_valor) is distinct from 'object' then
    raise exception 'Campo de revisión no válido.' using errcode='22023'; end if;
  item_id:=p_valor->>'id';
  if p_campo='punto' then
    if item_id is null or item_id not in ('cocina_refri','cocina_perillas','cocina_gas','cocina_piso',
      'bano_secador','bano_toallas','bano_ducha','bano_wc','bano_cortina','bano_piso',
      'living_cama','living_cajones','living_controles','living_tv','living_ac','living_manilla','living_ventanales','living_piso',
      'terraza_atizador','terraza_escobillon','terraza_mesa','terraza_cojines','terraza_jardineras','terraza_piso')
      or jsonb_typeof(p_valor->'checked') is distinct from 'boolean' then raise exception 'Punto de revisión no válido.' using errcode='22023'; end if;
  else
    if item_id is null or item_id not in ('platos','tazas','vasos','copas_flauta','copas_vino','tenedores','cuchillos','cucharas_grandes','cucharas_chicas')
      or (p_valor->'encontrados' is distinct from 'null'::jsonb and
        (jsonb_typeof(p_valor->'encontrados') is distinct from 'number' or (p_valor->>'encontrados') !~ '^\d{1,2}$')) then
      raise exception 'Cantidad encontrada no válida.' using errcode='22023'; end if;
    select numero into n from public.cabanas where id=p_cabana_id;
    expected:=case when n between 1 and 6 then 3 when n between 7 and 9 then 5 when n=10 then 2 when n=11 then 4 end;
    if expected is null then raise exception 'La cabaña no tiene dotación definida.' using errcode='22023'; end if;
    if p_valor->'encontrados' is distinct from 'null'::jsonb and p_valor->'esperados' is distinct from to_jsonb(expected) then
      raise exception 'La dotación cambió. Abre nuevamente la revisión.' using errcode='22023'; end if;
  end if;
  insert into public.revisiones_checkout(fecha_operativa,cabana_id,estadia_id,recorrido_version)
    values(p_fecha,p_cabana_id,p_estadia_id,3) on conflict(fecha_operativa,cabana_id,estadia_id) do nothing;
  select * into r from public.revisiones_checkout where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id for update;
  if not found then raise exception 'No se pudo guardar la revisión.' using errcode='42501'; end if;
  if r.revision_estado='revisada' then raise exception 'Reabre la revisión para cambiar los checks.' using errcode='22023'; end if;
  if p_campo='punto' then
    update public.revisiones_checkout set recorrido_version=3,chequeados=case when (p_valor->>'checked')::boolean
      then array(select distinct unnest(chequeados||array[item_id])) else array_remove(chequeados,item_id) end
      where revision_id=r.revision_id returning * into r;
  else
    update public.revisiones_checkout set recorrido_version=3,conteos=case when p_valor->'encontrados'='null'::jsonb then conteos-item_id
      else jsonb_set(conteos,array[item_id],jsonb_build_object('encontrados',(p_valor->>'encontrados')::integer,'esperados',expected),true) end
      where revision_id=r.revision_id returning * into r;
  end if;
  return r;
end $$;
revoke all on function public.haiku_guardar_recorrido_checkout_v3(date,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.haiku_guardar_recorrido_checkout_v3(date,uuid,uuid,text,jsonb) to authenticated;
