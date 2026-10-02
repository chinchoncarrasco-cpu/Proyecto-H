-- Avatar personal: objeto unico sin extension; Content-Type explicito al subir.
-- Solo preparar localmente. No modifica usuarios, sesion ni evidencias.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('haiku-avatares', 'haiku-avatares', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists haiku_avatares_select_propio on storage.objects;
create policy haiku_avatares_select_propio on storage.objects
for select to authenticated
using (
  bucket_id = 'haiku-avatares'
  and (select private.haiku_usuario_activo())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name = (select auth.uid())::text || '/avatar'
);

drop policy if exists haiku_avatares_insert_propio on storage.objects;
create policy haiku_avatares_insert_propio on storage.objects
for insert to authenticated
with check (
  bucket_id = 'haiku-avatares'
  and (select private.haiku_usuario_activo())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name = (select auth.uid())::text || '/avatar'
);

drop policy if exists haiku_avatares_update_propio on storage.objects;
create policy haiku_avatares_update_propio on storage.objects
for update to authenticated
using (
  bucket_id = 'haiku-avatares'
  and (select private.haiku_usuario_activo())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name = (select auth.uid())::text || '/avatar'
)
with check (
  bucket_id = 'haiku-avatares'
  and (select private.haiku_usuario_activo())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name = (select auth.uid())::text || '/avatar'
);

drop policy if exists haiku_avatares_delete_propio on storage.objects;
create policy haiku_avatares_delete_propio on storage.objects
for delete to authenticated
using (
  bucket_id = 'haiku-avatares'
  and (select private.haiku_usuario_activo())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name = (select auth.uid())::text || '/avatar'
);

commit;
