do $installation$
begin
 if to_regclass('public.revisiones_checkout') is null then
  execute $schema$
-- Control operativo de salida: independiente de aseos, pagos y estado comercial.
create table public.revisiones_checkout (
  fecha_operativa date not null,
  cabana_id uuid not null references public.cabanas(id),
  estadia_id uuid not null references public.reserva_estadias(id) on delete cascade,
  hora_out time without time zone check (hora_out is null or (hora_out < time '24:00' and extract(second from hora_out)=0)),
  hora_out_definida boolean not null default false,
  encargado text not null default '' check (length(encargado) <= 120),
  recuperados text[] not null default '{}',
  chequeados text[] not null default '{}',
  revision bigint not null default 0,
  actualizado_en timestamptz not null default clock_timestamp(),
  actualizado_por uuid,
  primary key (fecha_operativa, cabana_id, estadia_id),
  check (cardinality(recuperados) <= 64 and array_position(recuperados,null) is null),
  check (cardinality(chequeados) <= 64 and array_position(chequeados,null) is null),
  check (array_to_string(recuperados,',') ~ '^([a-z][a-z0-9_]{0,63}(,[a-z][a-z0-9_]{0,63})*)?$'),
  check (array_to_string(chequeados,',') ~ '^([a-z][a-z0-9_]{0,63}(,[a-z][a-z0-9_]{0,63})*)?$')
);
create index revisiones_checkout_cabana_idx on public.revisiones_checkout(cabana_id);
create index revisiones_checkout_estadia_idx on public.revisiones_checkout(estadia_id);
alter table public.revisiones_checkout enable row level security;
revoke all on public.revisiones_checkout from public, anon;
grant select, insert on public.revisiones_checkout to authenticated;
grant update(hora_out,hora_out_definida,encargado,recuperados,chequeados) on public.revisiones_checkout to authenticated;
create policy checkout_select on public.revisiones_checkout for select to authenticated
  using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.ver'));
create policy checkout_insert on public.revisiones_checkout for insert to authenticated
  with check (private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.gestionar'));
create policy checkout_update on public.revisiones_checkout for update to authenticated
  using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.gestionar'))
  with check (private.haiku_usuario_activo() and private.haiku_tiene_permiso('revisiones.gestionar'));

create function private.haiku_validar_revision_checkout_v1() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión para registrar la revisión de salida.' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.fecha_operativa,new.cabana_id,new.estadia_id) is distinct from (old.fecha_operativa,old.cabana_id,old.estadia_id) then
    raise exception 'No se puede cambiar la identidad de esta revisión.' using errcode='23514';
  end if;
  if not exists(select 1 from public.haiku_operacion_dia(new.fecha_operativa) d
    where d.cabana_id=new.cabana_id and d.salida_estadia_id=new.estadia_id) then
    raise exception 'La estadía ya no corresponde a la salida de esta cabaña y fecha. Actualiza el listado.' using errcode='40001';
  end if;
  new.revision := case when tg_op='INSERT' then 1 else old.revision+1 end;
  new.actualizado_en := clock_timestamp(); new.actualizado_por := auth.uid();
  return new;
end $$;
create trigger checkout_validar before insert or update on public.revisiones_checkout
  for each row execute function private.haiku_validar_revision_checkout_v1();

create function public.haiku_revisiones_checkout_dia_v1(p_fecha date) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not private.haiku_usuario_activo() or not private.haiku_tiene_permiso('revisiones.ver') then
    raise exception 'Tu usuario no tiene permiso para consultar la revisión de salida.' using errcode='42501';
  end if;
  if p_fecha is null then raise exception 'Selecciona una fecha operativa.' using errcode='22023'; end if;
  return jsonb_build_object('fecha',p_fecha,'puede_editar',private.haiku_tiene_permiso('revisiones.gestionar'),
    'revisiones',coalesce((select jsonb_agg(to_jsonb(r) order by r.cabana_id) from public.revisiones_checkout r where r.fecha_operativa=p_fecha),'[]'::jsonb));
end $$;
revoke all on function public.haiku_revisiones_checkout_dia_v1(date) from public,anon;
grant execute on function public.haiku_revisiones_checkout_dia_v1(date) to authenticated;

create function public.haiku_guardar_revision_checkout_v1(p_fecha date,p_cabana_id uuid,p_estadia_id uuid,p_campo text,p_valor jsonb)
returns public.revisiones_checkout language plpgsql security invoker set search_path = public, pg_temp as $$
declare r public.revisiones_checkout; v_texto text; v_item text; v_check boolean;
begin
  if auth.uid() is null or not private.haiku_usuario_activo() or not private.haiku_tiene_permiso('revisiones.gestionar') then
    raise exception 'Tu usuario no tiene permiso para editar la revisión de salida.' using errcode='42501';
  end if;
  if p_campo not in ('hora_out','encargado','recuperado','chequeado') or p_campo is null then raise exception 'Campo de salida no válido.' using errcode='22023'; end if;
  if p_campo in ('hora_out','encargado') then
    if p_valor is not null and jsonb_typeof(p_valor) not in ('string','null') then raise exception 'Texto no válido.' using errcode='22023'; end if;
    v_texto:=btrim(coalesce(p_valor#>>'{}',''));
    if p_campo='hora_out' and v_texto<>'' and v_texto !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Escribe una hora válida: hh:mm.' using errcode='22023'; end if;
    if p_campo='encargado' and length(v_texto)>120 then raise exception 'El nombre es demasiado largo.' using errcode='22023'; end if;
  else
    v_item:=p_valor->>'id';
    if v_item is null or v_item !~ '^[a-z][a-z0-9_]{0,63}$' or jsonb_typeof(p_valor->'checked') is distinct from 'boolean' then
      raise exception 'Ítem de revisión no válido.' using errcode='22023';
    end if;
    v_check:=(p_valor->>'checked')::boolean;
  end if;
  insert into public.revisiones_checkout(fecha_operativa,cabana_id,estadia_id) values(p_fecha,p_cabana_id,p_estadia_id)
    on conflict(fecha_operativa,cabana_id,estadia_id) do nothing;
  if p_campo='hora_out' then
    update public.revisiones_checkout set hora_out=nullif(v_texto,'')::time,hora_out_definida=true
      where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id returning * into r;
  elsif p_campo='encargado' then
    update public.revisiones_checkout set encargado=v_texto
      where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id returning * into r;
  elsif p_campo='recuperado' then
    update public.revisiones_checkout set recuperados=case when v_check then array(select distinct unnest(recuperados||array[v_item])) else array_remove(recuperados,v_item) end
      where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id returning * into r;
  else
    update public.revisiones_checkout set chequeados=case when v_check then array(select distinct unnest(chequeados||array[v_item])) else array_remove(chequeados,v_item) end
      where fecha_operativa=p_fecha and cabana_id=p_cabana_id and estadia_id=p_estadia_id returning * into r;
  end if;
  if r.estadia_id is null then raise exception 'No se pudo guardar la revisión de salida.' using errcode='42501'; end if;
  return r;
end $$;
revoke all on function public.haiku_guardar_revision_checkout_v1(date,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.haiku_guardar_revision_checkout_v1(date,uuid,uuid,text,jsonb) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.revisiones_checkout;
  end if;
end $$;

$schema$;
 else
  if to_regprocedure('public.haiku_revisiones_checkout_dia_v1(date)') is null
    or to_regprocedure('public.haiku_guardar_revision_checkout_v1(date,uuid,uuid,text,jsonb)') is null
    or not (select relrowsecurity from pg_class where oid='public.revisiones_checkout'::regclass)
    or (select count(*) from pg_policies where schemaname='public' and tablename='revisiones_checkout')<>3
    or not exists(select 1 from pg_trigger where tgrelid='public.revisiones_checkout'::regclass and tgname='checkout_validar') then
    raise exception 'La instalación de revisión de salida está incompleta.';
  end if;
 end if;
end $installation$;
