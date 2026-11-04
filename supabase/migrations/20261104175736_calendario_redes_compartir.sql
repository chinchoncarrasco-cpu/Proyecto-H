-- No anonymous access to tables or storage. Sharing is activated explicitly in Haku.
create table public.haiku_redes_share (
 id text primary key check (id='redes'),
 token text not null unique check (token ~ '^[a-f0-9]{64}$'),
 enabled boolean not null default false,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now()
);
create index haiku_redes_share_creator_idx on public.haiku_redes_share(created_by);
alter table public.haiku_redes_share enable row level security;
revoke all on public.haiku_redes_share from public,anon,authenticated;
grant select,insert on public.haiku_redes_share to authenticated;
grant update(token,enabled) on public.haiku_redes_share to authenticated;
grant select on public.haiku_redes_share to service_role;
-- Only the columns used by the share reader; no author IDs or internal responsible names.
grant select(id,title,publish_date,content_type,format,story_kind,channels,copy,publish_time,campaign_id,workflow_status)
 on public.haiku_redes_posts to service_role;
grant select(id,post_id,filename,mime,bytes,kind,state,position,created_at,storage_path)
 on public.haiku_redes_assets to service_role;
create policy redes_share_read on public.haiku_redes_share for select to authenticated
 using ((select private.haiku_tiene_permiso('redes.gestionar')));
create policy redes_share_insert on public.haiku_redes_share for insert to authenticated
 with check ((select private.haiku_tiene_permiso('redes.gestionar')) and created_by=(select auth.uid()));
create policy redes_share_update on public.haiku_redes_share for update to authenticated
 using ((select private.haiku_tiene_permiso('redes.gestionar')))
 with check ((select private.haiku_tiene_permiso('redes.gestionar')));
