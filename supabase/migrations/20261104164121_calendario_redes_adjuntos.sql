-- Additive social calendar. No reservation or financial tables are modified.
insert into public.permisos (codigo,nombre,descripcion,categoria)
values ('redes.gestionar','Gestionar calendario de redes','Preparar contenido y archivos del calendario social','redes')
on conflict (codigo) do nothing;
insert into public.rol_permisos (rol_id,permiso_id)
select r.id,p.id from public.roles r cross join public.permisos p
where r.codigo in ('recepcion','manager','administrador') and p.codigo='redes.gestionar'
on conflict do nothing;

create table public.haiku_redes_posts (
 id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
 title text not null check (length(btrim(title)) between 1 and 200),
 publish_date date not null,
 content_type text not null check (content_type in ('historia','publicacion','reel')),
 format text not null check (format in ('Foto','Carrusel','Video')),
 story_kind text check (story_kind in ('diaria','comercial','refuerzo')),
 channels text[] not null default array['facebook','instagram'] check (cardinality(channels)>0 and channels <@ array['facebook','instagram']),
 copy text not null default '' check (length(copy)<=10000),
 owner text not null default '' check (length(owner)<=150),
 publish_time time,
 campaign_id text,
 workflow_status text not null default 'material_pendiente' check (workflow_status in ('material_pendiente','en_revision','listo','programado','publicado')),
 revision integer not null default 1,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((content_type='reel' and format='Video' and story_kind is null) or
        (content_type='publicacion' and format in ('Foto','Carrusel') and story_kind is null) or
        (content_type='historia' and format in ('Foto','Video') and story_kind is not null))
);
create table public.haiku_redes_assets (
 id uuid primary key default gen_random_uuid(),
 post_id text not null references public.haiku_redes_posts(id),
 filename text not null check (length(filename) between 1 and 255),
 mime text not null check (mime in ('image/jpeg','image/png','image/webp','video/mp4','video/webm')),
 bytes bigint not null check (bytes>0 and bytes<=52428800 and (mime like 'video/%' or bytes<=10485760)),
 kind text not null default 'media' check (kind in ('media','cover')),
 captured_on date,
 state text not null default 'uploading' check (state in ('uploading','ready')),
 position integer not null default 0 check (position>=0),
 storage_path text generated always as (post_id||'/'||id::text||'.'||case mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' else 'webm' end) stored unique,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 check (kind<>'cover' or mime like 'image/%')
);
create index haiku_redes_posts_date_idx on public.haiku_redes_posts(publish_date);
create index haiku_redes_posts_creator_idx on public.haiku_redes_posts(created_by);
create index haiku_redes_assets_post_idx on public.haiku_redes_assets(post_id,position,created_at);
create index haiku_redes_assets_creator_idx on public.haiku_redes_assets(created_by);
alter table public.haiku_redes_posts enable row level security;
alter table public.haiku_redes_assets enable row level security;
revoke all on public.haiku_redes_posts, public.haiku_redes_assets from anon, authenticated;
grant select,insert,update on public.haiku_redes_posts to authenticated;
grant select,insert,update,delete on public.haiku_redes_assets to authenticated;
create policy redes_posts_read on public.haiku_redes_posts for select to authenticated using ((select private.haiku_tiene_permiso('redes.gestionar')));
create policy redes_posts_insert on public.haiku_redes_posts for insert to authenticated with check ((select private.haiku_tiene_permiso('redes.gestionar')) and created_by=(select auth.uid()));
create policy redes_posts_update on public.haiku_redes_posts for update to authenticated using ((select private.haiku_tiene_permiso('redes.gestionar'))) with check ((select private.haiku_tiene_permiso('redes.gestionar')));
create policy redes_assets_read on public.haiku_redes_assets for select to authenticated using ((select private.haiku_tiene_permiso('redes.gestionar')));
create policy redes_assets_insert on public.haiku_redes_assets for insert to authenticated with check ((select private.haiku_tiene_permiso('redes.gestionar')) and created_by=(select auth.uid()));
create policy redes_assets_update on public.haiku_redes_assets for update to authenticated using ((select private.haiku_tiene_permiso('redes.gestionar'))) with check ((select private.haiku_tiene_permiso('redes.gestionar')));
create policy redes_assets_delete on public.haiku_redes_assets for delete to authenticated using ((select private.haiku_tiene_permiso('redes.gestionar')));

create function public.haiku_redes_post_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if (new.id,new.created_by,new.created_at) is distinct from (old.id,old.created_by,old.created_at) then raise exception 'La identidad del contenido no se puede modificar'; end if;
  if (new.publish_date,new.content_type,new.format,new.story_kind) is distinct from (old.publish_date,old.content_type,old.format,old.story_kind)
     and exists(select 1 from public.haiku_redes_assets where post_id=old.id) then
   raise exception 'Retira los adjuntos antes de cambiar la fecha o el formato';
  end if;
  new.revision:=old.revision+1;
 else new.revision:=1;
 end if;
 if new.workflow_status in ('listo','programado','publicado') and not exists(
  select 1 from public.haiku_redes_assets a where a.post_id=new.id and a.state='ready' and a.kind='media'
  and ((new.format='Video' and a.mime like 'video/%') or (new.format<>'Video' and a.mime like 'image/%'))
 ) then raise exception 'Adjunta el material antes de marcar este estado'; end if;
 new.updated_at:=now(); return new;
end $$;
create trigger haiku_redes_post_guard before insert or update on public.haiku_redes_posts for each row execute function public.haiku_redes_post_guard();

create function public.haiku_redes_asset_guard() returns trigger language plpgsql set search_path='' as $$
declare p public.haiku_redes_posts; obj storage.objects;
begin
 select * into p from public.haiku_redes_posts where id=coalesce(new.post_id,old.post_id) for update;
 if p.id is null then raise exception 'Contenido no disponible'; end if;
 if TG_OP='DELETE' then
  if exists(select 1 from storage.objects where bucket_id='haiku-redes' and name=old.storage_path) then raise exception 'Elimina primero el archivo almacenado'; end if;
  update public.haiku_redes_posts set workflow_status='material_pendiente' where id=p.id;
  return old;
 end if;
 if TG_OP='UPDATE' and (new.id,new.post_id,new.filename,new.mime,new.bytes,new.kind,new.captured_on,new.created_by,new.created_at)
   is distinct from (old.id,old.post_id,old.filename,old.mime,old.bytes,old.kind,old.captured_on,old.created_by,old.created_at) then raise exception 'Los datos del archivo son inmutables; reemplaza el adjunto'; end if;
 if TG_OP='INSERT' and new.state<>'uploading' then raise exception 'El archivo debe comenzar en estado de carga'; end if;
 if TG_OP='INSERT' or new.state is distinct from old.state then
  if p.story_kind='diaria' and (p.publish_date<>(now() at time zone 'America/Santiago')::date or new.captured_on is distinct from p.publish_date) then raise exception 'Las Historias del día requieren material capturado y adjuntado en su fecha'; end if;
  if (new.kind='cover' and p.content_type<>'reel') or
     (new.kind='media' and ((p.format='Video')<>(new.mime like 'video/%'))) then raise exception 'El archivo no corresponde al formato del contenido'; end if;
  if new.state='ready' then
   select * into obj from storage.objects where bucket_id='haiku-redes' and name=old.storage_path;
   if obj.id is null or (obj.metadata->>'size')::bigint<>new.bytes or obj.metadata->>'mimetype'<>new.mime then raise exception 'El archivo no se ha guardado correctamente'; end if;
  end if;
  update public.haiku_redes_posts set workflow_status='material_pendiente' where id=p.id;
 end if;
 return new;
end $$;
create trigger haiku_redes_asset_guard before insert or update or delete on public.haiku_redes_assets for each row execute function public.haiku_redes_asset_guard();
revoke all on function public.haiku_redes_post_guard(),public.haiku_redes_asset_guard() from public, anon, authenticated;

create function public.haiku_redes_ordenar(p_post text,p_ids uuid[]) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.haiku_redes_posts where id=p_post for update;
 if not found then raise exception 'Contenido no disponible'; end if;
 if cardinality(p_ids)<>(select count(*) from public.haiku_redes_assets where post_id=p_post and state='ready')
 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id)
 or exists(select 1 from unnest(p_ids) x(asset_id) where not exists(select 1 from public.haiku_redes_assets a where a.id=x.asset_id and a.post_id=p_post and a.state='ready')) then raise exception 'Los archivos cambiaron; vuelve a abrir el contenido'; end if;
 update public.haiku_redes_assets a set position=o.n::integer-1 from unnest(p_ids) with ordinality o(id,n) where a.id=o.id and a.post_id=p_post;
end $$;
revoke all on function public.haiku_redes_ordenar(text,uuid[]) from public,anon;
grant execute on function public.haiku_redes_ordenar(text,uuid[]) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('haiku-redes','haiku-redes',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/webm']);
create policy redes_storage_read on storage.objects for select to authenticated using (
 bucket_id='haiku-redes' and (select private.haiku_tiene_permiso('redes.gestionar'))
 and exists(select 1 from public.haiku_redes_assets a where a.storage_path=name));
create policy redes_storage_insert on storage.objects for insert to authenticated with check (
 bucket_id='haiku-redes' and (select private.haiku_tiene_permiso('redes.gestionar'))
 and exists(select 1 from public.haiku_redes_assets a join public.haiku_redes_posts p on p.id=a.post_id
 where a.storage_path=name and a.created_by=(select auth.uid()) and a.state='uploading'
 and (p.story_kind is distinct from 'diaria' or p.publish_date=(now() at time zone 'America/Santiago')::date)));
create policy redes_storage_delete on storage.objects for delete to authenticated using (
 bucket_id='haiku-redes' and (select private.haiku_tiene_permiso('redes.gestionar'))
 and exists(select 1 from public.haiku_redes_assets a where a.storage_path=name));
