-- Checkout V2: all new state is operational. Booking/payment/cleaning state is untouched.
alter table public.revisiones_checkout
  add column reposiciones jsonb not null default '{}'::jsonb check (jsonb_typeof(reposiciones)='object' and octet_length(reposiciones::text)<=12000),
  add column observaciones jsonb not null default '{}'::jsonb check (jsonb_typeof(observaciones)='object' and octet_length(observaciones::text)<=100000),
  add column revision_estado text not null default 'pendiente' check (revision_estado in ('pendiente','en_revision','revisada')),
  add column revision_iniciada_en timestamptz,
  add column revision_finalizada_en timestamptz;
grant update(reposiciones,observaciones,revision_estado,revision_iniciada_en,revision_finalizada_en) on public.revisiones_checkout to authenticated;

-- One FK in the PK: this is deliberately NOT a PostgREST many-to-many bridge.
-- The stay, rather than a day, owns loans. Moving its departure never loses them.
create table public.prestamos_estadia (
  estadia_id uuid primary key references public.reserva_estadias(id) on delete cascade,
  items jsonb not null default '{}'::jsonb check (jsonb_typeof(items)='object' and octet_length(items::text)<=40000),
  revision bigint not null default 1,
  actualizado_en timestamptz not null default clock_timestamp(),
  actualizado_por uuid not null default auth.uid()
);
alter table public.prestamos_estadia enable row level security;
revoke all on public.prestamos_estadia from public,anon;
grant select,insert on public.prestamos_estadia to authenticated;
grant update(items) on public.prestamos_estadia to authenticated;
create policy prestamos_select on public.prestamos_estadia for select to authenticated
  using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.ver'));
create policy prestamos_insert on public.prestamos_estadia for insert to authenticated
  with check (private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.gestionar'));
create policy prestamos_update on public.prestamos_estadia for update to authenticated
  using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.gestionar'))
  with check (private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.gestionar'));

create function private.haiku_validar_prestamos_estadia_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare k text; item jsonb;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para registrar préstamos.' using errcode='42501'; end if;
  if tg_op='UPDATE' and new.estadia_id is distinct from old.estadia_id then raise exception 'No se puede cambiar la estadía del préstamo.' using errcode='23514'; end if;
  if not exists(select 1 from public.reserva_estadias where id=new.estadia_id and estado_estadia not in ('cancelada','no_show')) then
    raise exception 'La estadía ya no está disponible. Actualiza la ficha.' using errcode='40001';
  end if;
  if (select count(*) from jsonb_object_keys(new.items))>64 then raise exception 'Demasiados préstamos.' using errcode='22023'; end if;
  for k,item in select * from jsonb_each(new.items) loop
    if k !~ '^[a-z][a-z0-9_]{0,63}$' or k in ('constructor','prototype','__proto__') or jsonb_typeof(item)<>'object' then raise exception 'Artículo no válido.' using errcode='22023'; end if;
    if item->'descartado'='true'::jsonb then continue; end if;
    if jsonb_typeof(item->'label') is distinct from 'string' or length(btrim(item->>'label')) not between 1 and 80
      or coalesce(item->>'area','') not in ('cocina','bano','living','terraza') or coalesce(item->>'origen','') not in ('manual','notas')
      or jsonb_typeof(item->'cantidad') is distinct from 'number' or (item->>'cantidad') !~ '^[1-9]\d?$'
      or jsonb_typeof(item->'devueltos') is distinct from 'number' or (item->>'devueltos') !~ '^\d{1,2}$'
      or (item->>'devueltos')::integer>(item->>'cantidad')::integer then raise exception 'Cantidad o detalle del préstamo no válido.' using errcode='22023'; end if;
  end loop;
  new.revision:=case when tg_op='INSERT' then 1 else old.revision+1 end;
  new.actualizado_en:=clock_timestamp(); new.actualizado_por:=auth.uid();
  return new;
end $$;
create trigger prestamos_validar before insert or update on public.prestamos_estadia
  for each row execute function private.haiku_validar_prestamos_estadia_v1();

create function private.haiku_notas_prestamos_estadia_v1(p_estadia_id uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(n.texto order by n.creado_en),'[]'::jsonb)
  from public.reserva_estadias e join public.notas n on n.reserva_id=e.reserva_id
  where e.id=p_estadia_id and (n.estadia_id=e.id or (n.estadia_id is null and
    (n.cabana_id=e.cabana_id or (n.cabana_id is null and
      (select count(*) from public.reserva_estadias other where other.reserva_id=e.reserva_id and other.estado_estadia not in ('cancelada','no_show'))=1))))
    and (n.vigente_hasta is null or n.vigente_hasta>=e.fecha_salida::timestamptz)
$$;
revoke all on function private.haiku_notas_prestamos_estadia_v1(uuid) from public,anon;
grant execute on function private.haiku_notas_prestamos_estadia_v1(uuid) to authenticated;

create function public.haiku_prestamos_estadia_v1(p_estadia_id uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not private.haiku_usuario_activo() or not private.haiku_tiene_permiso('revisiones.ver') then
    raise exception 'Tu usuario no puede consultar préstamos.' using errcode='42501';
  end if;
  if not exists(select 1 from public.reserva_estadias where id=p_estadia_id) then raise exception 'No se encontró la estadía.' using errcode='22023'; end if;
  return jsonb_build_object('estadia_id',p_estadia_id,'puede_editar',private.haiku_tiene_permiso('revisiones.gestionar'),'notas',private.haiku_notas_prestamos_estadia_v1(p_estadia_id))
    || coalesce((select to_jsonb(p) from public.prestamos_estadia p where estadia_id=p_estadia_id),jsonb_build_object('items','{}'::jsonb,'revision',0));
end $$;
revoke all on function public.haiku_prestamos_estadia_v1(uuid) from public,anon;
grant execute on function public.haiku_prestamos_estadia_v1(uuid) to authenticated;

create function public.haiku_guardar_prestamo_estadia_v1(p_estadia_id uuid,p_campo text,p_valor jsonb)
returns public.prestamos_estadia language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.prestamos_estadia; v_id text; v_item jsonb; v_old jsonb; v_qty integer; v_total integer;
begin
  if auth.uid() is null or not private.haiku_usuario_activo() or not private.haiku_tiene_permiso('revisiones.gestionar') then
    raise exception 'Tu usuario no puede registrar préstamos.' using errcode='42501';
  end if;
  if p_campo is null or p_campo not in ('prestamo','devolucion') or jsonb_typeof(p_valor) is distinct from 'object' then raise exception 'Préstamo no válido.' using errcode='22023'; end if;
  v_id:=p_valor->>'id';
  if v_id is null or v_id !~ '^[a-z][a-z0-9_]{0,63}$' or v_id in ('constructor','prototype','__proto__') then raise exception 'Artículo no válido.' using errcode='22023'; end if;
  if p_campo='devolucion' or p_valor->'descartado' is distinct from 'true'::jsonb then
    if jsonb_typeof(p_valor->'cantidad') is distinct from 'number' or (p_valor->>'cantidad') !~ '^\d{1,2}$'
      or coalesce(p_valor->>'label','')='' or length(p_valor->>'label')>80
      or coalesce(p_valor->>'area','') not in ('cocina','bano','living','terraza')
      or coalesce(p_valor->>'origen','') not in ('manual','notas') then raise exception 'Completa artículo, cantidad y área.' using errcode='22023'; end if;
    v_qty:=(p_valor->>'cantidad')::integer;
    if p_campo='prestamo' and v_qty<1 then raise exception 'La cantidad prestada debe ser mayor que cero.' using errcode='22023'; end if;
    if p_campo='devolucion' then
      if jsonb_typeof(p_valor->'total') is distinct from 'number' or (p_valor->>'total') !~ '^[1-9]\d?$' then raise exception 'Confirma la cantidad prestada.' using errcode='22023'; end if;
      v_total:=(p_valor->>'total')::integer;
    end if;
  end if;
  insert into public.prestamos_estadia(estadia_id) values(p_estadia_id) on conflict(estadia_id) do nothing;
  select * into r from public.prestamos_estadia where estadia_id=p_estadia_id for update;
  if not found then raise exception 'No se pudo guardar el préstamo.' using errcode='42501'; end if;
  v_old:=coalesce(r.items->v_id,'{}'::jsonb);
  if p_campo='prestamo' then
    if p_valor->'descartado'='true'::jsonb then v_item:=v_old||jsonb_build_object('descartado',true);
    else v_item:=jsonb_build_object('id',v_id,'label',btrim(p_valor->>'label'),'area',p_valor->>'area','cantidad',v_qty,
      'devueltos',least(coalesce((v_old->>'devueltos')::integer,0),v_qty),'origen',p_valor->>'origen','descartado',false); end if;
  else
    if v_old->'descartado'='true'::jsonb then raise exception 'Este préstamo fue quitado. Actualiza la lista.' using errcode='40001'; end if;
    v_total:=coalesce((v_old->>'cantidad')::integer,v_total);
    if v_qty>v_total then raise exception 'La devolución supera la cantidad prestada. Actualiza la lista.' using errcode='22023'; end if;
    v_item:=jsonb_build_object('id',v_id,'label',btrim(p_valor->>'label'),'area',p_valor->>'area','cantidad',v_total,'origen',p_valor->>'origen','descartado',false)
      ||v_old||jsonb_build_object('devueltos',v_qty);
  end if;
  if not (r.items ? v_id) and (select count(*) from jsonb_object_keys(r.items))>=64 then raise exception 'Esta estadía tiene demasiados artículos registrados.' using errcode='22023'; end if;
  update public.prestamos_estadia set items=jsonb_set(items,array[v_id],v_item,true) where estadia_id=p_estadia_id returning * into r;
  return r;
end $$;
revoke all on function public.haiku_guardar_prestamo_estadia_v1(uuid,text,jsonb) from public,anon;
grant execute on function public.haiku_guardar_prestamo_estadia_v1(uuid,text,jsonb) to authenticated;

create function public.haiku_revisiones_checkout_dia_v2(p_fecha date) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
  -- Keep the existing permission/date checks. No second operation/reservation refresh.
  result:=public.haiku_revisiones_checkout_dia_v1(p_fecha);
  return result||jsonb_build_object('prestamos',coalesce((select jsonb_agg(to_jsonb(p)) from public.prestamos_estadia p
    join public.reserva_estadias e on e.id=p.estadia_id
    where e.estado_estadia not in ('cancelada','no_show') and
      ((e.tipo_estadia='alojamiento' and e.fecha_salida=p_fecha) or (e.tipo_estadia='fullday' and e.fecha_ingreso=p_fecha))),'[]'::jsonb),
    'notas_prestamos',coalesce((select jsonb_agg(jsonb_build_object('estadia_id',e.id,'textos',private.haiku_notas_prestamos_estadia_v1(e.id)))
      from public.reserva_estadias e where e.estado_estadia not in ('cancelada','no_show') and
      ((e.tipo_estadia='alojamiento' and e.fecha_salida=p_fecha) or (e.tipo_estadia='fullday' and e.fecha_ingreso=p_fecha))),'[]'::jsonb));
end $$;
revoke all on function public.haiku_revisiones_checkout_dia_v2(date) from public,anon;
grant execute on function public.haiku_revisiones_checkout_dia_v2(date) to authenticated;

create function public.haiku_guardar_revision_checkout_v2(p_fecha date,p_cabana_id uuid,p_estadia_id uuid,p_campo text,p_valor jsonb)
returns public.revisiones_checkout language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.revisiones_checkout; v_id text; v_q jsonb; v_items jsonb; v_obs jsonb; v_text text; v_path text;
begin
  if auth.uid() is null or not private.haiku_usuario_activo() or not private.haiku_tiene_permiso('revisiones.gestionar') then
    raise exception 'Tu usuario no puede editar la revisión de salida.' using errcode='42501';
  end if;
  if p_campo in ('hora_out','encargado','recuperado','chequeado') then
    return public.haiku_guardar_revision_checkout_v1(p_fecha,p_cabana_id,p_estadia_id,p_campo,p_valor);
  end if;
  if p_campo is null or p_campo not in ('reposicion','observacion','revision_estado') then raise exception 'Campo de salida no válido.' using errcode='22023'; end if;
  if p_campo='reposicion' then
    v_items:=p_valor->'items';
    if jsonb_typeof(v_items) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_items)) not between 1 and 3 then raise exception 'Reposición no válida.' using errcode='22023'; end if;
    for v_id,v_q in select * from jsonb_each(v_items) loop
      if v_id not in ('sal','aceite','te','cafe','te_hierbas','azucar','servilletas','champu','jabon','balsamo','jabon_liquido','papel_higienico','lena','diario','carbon')
        or jsonb_typeof(v_q)<>'number' or v_q::text !~ '^\d{1,2}$'
        or (v_id not in ('te','cafe','te_hierbas','champu','jabon','balsamo') and v_q::text not in ('0','1')) then raise exception 'Cantidad de reposición no válida.' using errcode='22023'; end if;
    end loop;
  elsif p_campo='observacion' then
    v_id:=p_valor->>'id';
    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{0,63}$' or v_id in ('constructor','prototype','__proto__') then raise exception 'Observación no válida.' using errcode='22023'; end if;
    if p_valor->'borrar' is distinct from 'true'::jsonb then
      v_text:=btrim(coalesce(p_valor->>'texto','')); v_path:=nullif(p_valor->>'foto_path','');
      if coalesce(p_valor->>'tipo','') not in ('dano','faltante','olvido','mantencion') or
        (p_valor->>'area' is not null and p_valor->>'area' not in ('cocina','bano','living','terraza')) or
        length(v_text)>1000 or (v_text='' and v_path is null) then raise exception 'Completa el detalle o adjunta una foto.' using errcode='22023'; end if;
      if v_path is not null and (length(v_path)>240 or split_part(v_path,'/',2)<>p_estadia_id::text or split_part(v_path,'/',3) !~ ('^'||v_id||'_[a-f0-9]{32}[.]jpg$')) then raise exception 'La foto no corresponde a esta estadía y observación.' using errcode='22023'; end if;
      v_obs:=jsonb_build_object('id',v_id,'tipo',p_valor->>'tipo','area',p_valor->>'area','texto',v_text,'foto_path',v_path);
    end if;
  elsif jsonb_typeof(p_valor) is distinct from 'string' or p_valor#>>'{}' not in ('pendiente','en_revision','revisada') then
    raise exception 'Estado de revisión no válido.' using errcode='22023';
  end if;
  insert into public.revisiones_checkout(fecha_operativa,cabana_id,estadia_id) values(p_fecha,p_cabana_id,p_estadia_id)
    on conflict(fecha_operativa,cabana_id,estadia_id) do nothing;
  select * into r from public.revisiones_checkout where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id for update;
  if not found then raise exception 'No se pudo guardar la revisión.' using errcode='42501'; end if;
  if p_campo='reposicion' then
    update public.revisiones_checkout set reposiciones=reposiciones||v_items
      where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id returning * into r;
  elsif p_campo='observacion' then
    if p_valor->'borrar'='true'::jsonb then
      update public.revisiones_checkout set observaciones=observaciones-v_id where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id returning * into r;
    else
      if not(r.observaciones ? v_id) and (select count(*) from jsonb_object_keys(r.observaciones))>=40 then raise exception 'Hay demasiadas observaciones en esta revisión.' using errcode='22023'; end if;
      if v_path is not null and split_part(v_path,'/',1)<>auth.uid()::text and coalesce(r.observaciones->v_id->>'foto_path','')<>v_path then raise exception 'Adjunta una foto propia o conserva la existente.' using errcode='42501'; end if;
      update public.revisiones_checkout set observaciones=jsonb_set(observaciones,array[v_id],v_obs,true) where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id returning * into r;
    end if;
  else
    if p_valor#>>'{}'='revisada' and not(r.chequeados @> array['cocina','bano','living','terraza']) then raise exception 'Marca los cuatro sectores como revisados.' using errcode='22023'; end if;
    update public.revisiones_checkout set revision_estado=p_valor#>>'{}',
      revision_iniciada_en=case when p_valor#>>'{}'='en_revision' then coalesce(revision_iniciada_en,clock_timestamp()) else revision_iniciada_en end,
      revision_finalizada_en=case when p_valor#>>'{}'='revisada' then clock_timestamp() else null end,
      encargado=case when encargado='' and p_valor#>>'{}'='en_revision' then coalesce((select btrim(concat_ws(' ',nombre,apellido)) from public.usuarios where id=auth.uid()),'') else encargado end
      where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id returning * into r;
  end if;
  return r;
end $$;
revoke all on function public.haiku_guardar_revision_checkout_v2(date,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.haiku_guardar_revision_checkout_v2(date,uuid,uuid,text,jsonb) to authenticated;

-- The same validation applies to direct Data API writes, not only to the RPC.
create function private.haiku_validar_detalle_checkout_v2() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare k text; item jsonb;
begin
  if new.revision_estado='revisada' and not(new.chequeados @> array['cocina','bano','living','terraza']) then raise exception 'Reabre la revisión antes de desmarcar un sector.' using errcode='22023'; end if;
  for k,item in select * from jsonb_each(new.reposiciones) loop
    if k not in ('sal','aceite','te','cafe','te_hierbas','azucar','servilletas','champu','jabon','balsamo','jabon_liquido','papel_higienico','lena','diario','carbon')
      or jsonb_typeof(item)<>'number' or item::text !~ '^\d{1,2}$' or (k not in ('te','cafe','te_hierbas','champu','jabon','balsamo') and item::text not in ('0','1')) then raise exception 'Cantidad de reposición no válida.' using errcode='22023'; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(new.observaciones))>40 then raise exception 'Demasiadas observaciones.' using errcode='22023'; end if;
  for k,item in select * from jsonb_each(new.observaciones) loop
    if k !~ '^[a-z][a-z0-9_]{0,63}$' or k in ('constructor','prototype','__proto__') or jsonb_typeof(item)<>'object'
      or coalesce(item->>'tipo','') not in ('dano','faltante','olvido','mantencion')
      or (item->>'area' is not null and item->>'area' not in ('cocina','bano','living','terraza'))
      or jsonb_typeof(item->'texto') is distinct from 'string' or length(item->>'texto')>1000
      or (btrim(item->>'texto')='' and coalesce(item->>'foto_path','')='') then raise exception 'Observación no válida.' using errcode='22023'; end if;
    if coalesce(item->>'foto_path','')<>'' and (length(item->>'foto_path')>240 or split_part(item->>'foto_path','/',2)<>new.estadia_id::text
      or split_part(item->>'foto_path','/',3) !~ ('^'||k||'_[a-f0-9]{32}[.]jpg$')
      or (split_part(item->>'foto_path','/',1)<>auth.uid()::text and coalesce(old.observaciones->k->>'foto_path','')<>item->>'foto_path')) then raise exception 'La foto no corresponde a esta observación.' using errcode='42501'; end if;
  end loop;
  return new;
end $$;
create trigger checkout_detalle_validar before insert or update on public.revisiones_checkout
  for each row execute function private.haiku_validar_detalle_checkout_v2();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('haiku-checkout','haiku-checkout',false,8388608,array['image/jpeg']) on conflict(id) do nothing;
create policy checkout_fotos_select on storage.objects for select to authenticated
  using(bucket_id='haiku-checkout' and private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.ver'));
create policy checkout_fotos_insert on storage.objects for insert to authenticated
  with check(bucket_id='haiku-checkout' and private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.gestionar') and (storage.foldername(name))[1]=auth.uid()::text
    and exists(select 1 from public.reserva_estadias where id::text=(storage.foldername(name))[2]));
create policy checkout_fotos_delete on storage.objects for delete to authenticated
  using(bucket_id='haiku-checkout' and private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.gestionar') and (storage.foldername(name))[1]=auth.uid()::text);
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.prestamos_estadia; end if;
end $$;
notify pgrst,'reload schema';
