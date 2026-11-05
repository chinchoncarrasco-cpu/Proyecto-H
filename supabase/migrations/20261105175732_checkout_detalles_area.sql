-- Area notes are independent of typed observations. Existing RLS, departure and revision guards stay active.
alter table public.revisiones_checkout add column detalles jsonb not null default '{}'::jsonb
  check (jsonb_typeof(detalles)='object' and octet_length(detalles::text)<=20000);
grant update(detalles) on public.revisiones_checkout to authenticated;

create function private.haiku_validar_detalles_checkout_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare k text; item jsonb; v_path text; v_old_path text;
begin
  if (select count(*) from jsonb_object_keys(new.detalles))>4 then raise exception 'Demasiados detalles de área.' using errcode='22023'; end if;
  for k,item in select * from jsonb_each(new.detalles) loop
    if k not in ('cocina','bano','living','terraza') or jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'texto') is distinct from 'string' or length(item->>'texto')>1000
      or (item->'foto_path' is distinct from 'null'::jsonb and jsonb_typeof(item->'foto_path') is distinct from 'string')
      then raise exception 'Detalle de área no válido.' using errcode='22023'; end if;
    v_path:=item->>'foto_path';
    if v_path is not null then
      if length(v_path)>240 or split_part(v_path,'/',1) !~ '^[a-f0-9-]{36}$'
        or split_part(v_path,'/',2)<>new.estadia_id::text
        or split_part(v_path,'/',3) !~ ('^detalle_'||k||'_[a-f0-9]{32}[.]jpg$')
        or array_length(string_to_array(v_path,'/'),1)<>3 then raise exception 'La foto no corresponde a esta estadía y área.' using errcode='22023'; end if;
      v_old_path:=case when tg_op='UPDATE' then old.detalles->k->>'foto_path' else null end;
      if v_path is distinct from v_old_path and split_part(v_path,'/',1) is distinct from auth.uid()::text then
        raise exception 'La foto debe pertenecer al usuario actual.' using errcode='42501'; end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.haiku_validar_detalles_checkout_v1() from public,anon;
create trigger checkout_detalles_area_validar before insert or update on public.revisiones_checkout
  for each row execute function private.haiku_validar_detalles_checkout_v1();

create function public.haiku_guardar_detalle_checkout_v1(p_fecha date,p_cabana_id uuid,p_estadia_id uuid,p_campo text,p_valor jsonb)
returns public.revisiones_checkout language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.revisiones_checkout; v_id text; v_item jsonb; v_next jsonb;
begin
  if auth.uid() is null or not private.haiku_usuario_activo() or not private.haiku_tiene_permiso('revisiones.gestionar') then
    raise exception 'Tu usuario no puede editar la revisión de salida.' using errcode='42501'; end if;
  if p_campo is null or p_campo not in ('detalle','detalle_foto') or jsonb_typeof(p_valor) is distinct from 'object'
    then raise exception 'Detalle de área no válido.' using errcode='22023'; end if;
  v_id:=p_valor->>'id';
  if v_id is null or v_id not in ('cocina','bano','living','terraza') then raise exception 'Área no válida.' using errcode='22023'; end if;
  if p_campo='detalle' and (jsonb_typeof(p_valor->'texto') is distinct from 'string' or length(p_valor->>'texto')>1000)
    then raise exception 'El detalle debe tener hasta 1000 caracteres.' using errcode='22023'; end if;
  if p_campo='detalle_foto' and p_valor->'foto_path' is distinct from 'null'::jsonb and jsonb_typeof(p_valor->'foto_path') is distinct from 'string'
    then raise exception 'Foto no válida.' using errcode='22023'; end if;
  insert into public.revisiones_checkout(fecha_operativa,cabana_id,estadia_id) values(p_fecha,p_cabana_id,p_estadia_id)
    on conflict(fecha_operativa,cabana_id,estadia_id) do nothing;
  select * into r from public.revisiones_checkout where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id for update;
  if not found then raise exception 'No se pudo guardar el detalle.' using errcode='42501'; end if;
  v_item:=coalesce(r.detalles->v_id,jsonb_build_object('texto','','foto_path',null));
  v_item:=v_item||case when p_campo='detalle' then jsonb_build_object('texto',btrim(p_valor->>'texto')) else jsonb_build_object('foto_path',p_valor->'foto_path') end;
  v_next:=case when btrim(v_item->>'texto')='' and v_item->>'foto_path' is null then r.detalles-v_id else jsonb_set(r.detalles,array[v_id],v_item,true) end;
  update public.revisiones_checkout set detalles=v_next where revision_id=r.revision_id returning * into r;
  return r;
end $$;
revoke all on function public.haiku_guardar_detalle_checkout_v1(date,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.haiku_guardar_detalle_checkout_v1(date,uuid,uuid,text,jsonb) to authenticated;
