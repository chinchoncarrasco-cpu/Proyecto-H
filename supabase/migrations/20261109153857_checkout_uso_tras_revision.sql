-- Keep key receipt and usage editable after completion, as before. Only inspection checks and counts require reopening.
create or replace function private.haiku_validar_recorrido_checkout_v3() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare k text; item jsonb; n integer; expected integer; area text; required text[];
  inventory text[]:=array['platos','tazas','vasos','copas_flauta','copas_vino','tenedores','cuchillos','cucharas_grandes','cucharas_chicas'];
begin
  if tg_op='UPDATE' and old.recorrido_version=3 and new.recorrido_version<>3 then
    raise exception 'No se puede retirar el detalle de esta revisión.' using errcode='22023'; end if;
  if tg_op='UPDATE' and old.revision_estado='revisada' and new.revision_estado='revisada'
    and (new.conteos is distinct from old.conteos or array(select distinct x from unnest(new.chequeados) x where x ~ '^(cocina|bano|living|terraza)_' order by x)
      is distinct from array(select distinct x from unnest(old.chequeados) x where x ~ '^(cocina|bano|living|terraza)_' order by x) or new.recorrido_version is distinct from old.recorrido_version) then
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
