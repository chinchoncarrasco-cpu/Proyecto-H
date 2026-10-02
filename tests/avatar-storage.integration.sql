-- SOLO local, con avatar-storage-schema.sql y migration aplicados.
-- Comprueba RLS con roles sin BYPASSRLS, nunca como owner para operaciones de usuario.
begin;
create temp table avatar_checks (nombre text primary key);
grant select, insert on avatar_checks to authenticated, anon;
create function pg_temp.avatar_check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  insert into pg_temp.avatar_checks values(label);
end $$;
create function pg_temp.avatar_denied(command text, label text) returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when insufficient_privilege then
    perform pg_temp.avatar_check(true,label);
    return;
  end;
  raise exception 'FAIL: operacion permitida: %', label;
end $$;

select pg_temp.avatar_check((select not public from storage.buckets where id='haiku-avatares'), '01 bucket privado');
select pg_temp.avatar_check((select file_size_limit=5242880 from storage.buckets where id='haiku-avatares'), '02 limite 5 MiB');
select pg_temp.avatar_check((select allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif'] from storage.buckets where id='haiku-avatares'), '03 MIME exactos sin PDF ni comodines');
select pg_temp.avatar_check((select relrowsecurity from pg_class where oid='storage.objects'::regclass), 'RLS habilitada');

insert into public.usuarios(id,nombre,activo) values
 ('00000000-0000-0000-0000-000000000001','A',true),
 ('00000000-0000-0000-0000-000000000002','B',true);
insert into storage.objects(bucket_id,name) values
 ('haiku-avatares','00000000-0000-0000-0000-000000000002/avatar'),
 ('haiku-evidencias','00000000-0000-0000-0000-000000000002/evidencia.pdf');

set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set local test.permisos='';
select pg_temp.avatar_check(current_user='authenticated' and not (select rolbypassrls or rolsuper from pg_roles where rolname=current_user), 'rol real sin bypass');
insert into storage.objects(bucket_id,name,metadata) values
 ('haiku-avatares','00000000-0000-0000-0000-000000000001/avatar','{"mimetype":"image/jpeg"}');
select pg_temp.avatar_check((select count(*)=1 from storage.objects where bucket_id='haiku-avatares'), '04 SELECT solo propio sin enumerar B');
select pg_temp.avatar_check((select metadata->>'mimetype'='image/jpeg' from storage.objects where bucket_id='haiku-avatares'), '05 INSERT propio sin permiso gestionar');
update storage.objects set metadata='{"mimetype":"image/png"}' where bucket_id='haiku-avatares';
select pg_temp.avatar_check((select metadata->>'mimetype'='image/png' from storage.objects where bucket_id='haiku-avatares'), '06 UPDATE propio');
delete from storage.objects where bucket_id='haiku-avatares';
select pg_temp.avatar_check((select count(*)=0 from storage.objects where bucket_id='haiku-avatares'), '07 DELETE propio');
insert into storage.objects(bucket_id,name) values ('haiku-avatares','00000000-0000-0000-0000-000000000001/avatar');
insert into storage.objects(bucket_id,name,metadata) values ('haiku-avatares','00000000-0000-0000-0000-000000000001/avatar','{"version":2}')
 on conflict(bucket_id,name) do update set metadata=excluded.metadata;
select pg_temp.avatar_check((select count(*)=1 and bool_and(metadata='{"version":2}'::jsonb) from storage.objects where bucket_id='haiku-avatares'), 'upsert estable sin proliferacion');

-- Se intenta INSERT B sin objeto previo para evitar falso positivo por clave duplicada.
reset role;
delete from storage.objects where bucket_id='haiku-avatares' and name='00000000-0000-0000-0000-000000000002/avatar';
set local role authenticated;
select pg_temp.avatar_denied($q$insert into storage.objects(bucket_id,name) values ('haiku-avatares','00000000-0000-0000-0000-000000000002/avatar')$q$, '08 INSERT ajeno rechazado');
reset role;
insert into storage.objects(bucket_id,name) values ('haiku-avatares','00000000-0000-0000-0000-000000000002/avatar');
set local role authenticated;
with changed as (update storage.objects set metadata='{"ataque":true}' where name='00000000-0000-0000-0000-000000000002/avatar' returning id)
 select pg_temp.avatar_check(count(*)=0,'09 UPDATE ajeno cero filas') from changed;
with changed as (delete from storage.objects where name='00000000-0000-0000-0000-000000000002/avatar' returning id)
 select pg_temp.avatar_check(count(*)=0,'10 DELETE ajeno cero filas') from changed;
select pg_temp.avatar_check((select count(*)=0 from storage.objects where name='00000000-0000-0000-0000-000000000002/avatar'), 'SELECT directo ajeno denegado');
select pg_temp.avatar_denied($q$update storage.objects set name='00000000-0000-0000-0000-000000000002/otro' where bucket_id='haiku-avatares'$q$, 'WITH CHECK impide mover a B');
select pg_temp.avatar_denied($q$update storage.objects set bucket_id='haiku-evidencias' where bucket_id='haiku-avatares'$q$, 'WITH CHECK impide mover a evidencias');
select pg_temp.avatar_denied($q$insert into storage.objects(bucket_id,name) values ('haiku-avatares','00000000-0000-0000-0000-000000000001/avatar.jpg')$q$, 'rechaza extension alternativa');
select pg_temp.avatar_denied($q$insert into storage.objects(bucket_id,name) values ('haiku-avatares','00000000-0000-0000-0000-000000000001/sub/avatar')$q$, 'rechaza subcarpetas');
select pg_temp.avatar_denied($q$insert into storage.objects(bucket_id,name) values ('haiku-avatares','00000000-0000-0000-0000-000000000001/../00000000-0000-0000-0000-000000000002/avatar')$q$, 'rechaza traversal');
select pg_temp.avatar_denied($q$insert into storage.objects(bucket_id,name) values ('haiku-avatares','avatar')$q$, 'rechaza raiz');

-- 11: anon no accede ni siquiera con un sub falsificado coincidente con A.
set local role anon;
select pg_temp.avatar_check((select count(*)=0 from storage.objects), '11 anon SELECT vacio');
select pg_temp.avatar_denied($q$insert into storage.objects(bucket_id,name) values ('haiku-avatares','00000000-0000-0000-0000-000000000001/avatar')$q$, 'anon INSERT rechazado');
with changed as (update storage.objects set metadata='{}' returning id)
 select pg_temp.avatar_check(count(*)=0,'anon UPDATE cero filas') from changed;
with changed as (delete from storage.objects returning id)
 select pg_temp.avatar_check(count(*)=0,'anon DELETE cero filas') from changed;

-- 12: mismo usuario y JWT, pero activo=false consultado desde usuarios.
reset role;
update public.usuarios set activo=false where id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.avatar_check((select count(*)=0 from storage.objects), '12 inactivo SELECT vacio');
select pg_temp.avatar_denied($q$insert into storage.objects(bucket_id,name) values ('haiku-avatares','00000000-0000-0000-0000-000000000001/avatar')$q$, 'inactivo INSERT rechazado');
with changed as (update storage.objects set metadata='{}' returning id)
 select pg_temp.avatar_check(count(*)=0,'inactivo UPDATE cero filas') from changed;
with changed as (delete from storage.objects returning id)
 select pg_temp.avatar_check(count(*)=0,'inactivo DELETE cero filas') from changed;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.avatar_denied($q$insert into storage.objects(bucket_id,name) values ('haiku-avatares','00000000-0000-0000-0000-000000000003/avatar')$q$, 'autenticado no HAKU rechazado');
set local request.jwt.claim.sub='';
select pg_temp.avatar_check((select count(*)=0 from storage.objects), 'sin uid no lee');

-- Seguridad relacionada: permisos de evidencias siguen aislados de avatares.
reset role;
update public.usuarios set activo=true where id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.avatar_check((select count(*)=0 from storage.objects where bucket_id='haiku-evidencias'), 'evidencias sin permiso no lee');
select pg_temp.avatar_denied($q$insert into storage.objects(bucket_id,name) values ('haiku-evidencias','00000000-0000-0000-0000-000000000001/test.pdf')$q$, 'evidencias sin permiso no sube');
set local test.permisos='evidencias.ver,evidencias.subir,usuarios.gestionar';
select pg_temp.avatar_check((select count(*)=1 from storage.objects where bucket_id='haiku-evidencias'), 'evidencias.ver sigue funcionando');
insert into storage.objects(bucket_id,name) values ('haiku-evidencias','00000000-0000-0000-0000-000000000001/test.pdf');
select pg_temp.avatar_check((select count(*)=2 from storage.objects where bucket_id='haiku-evidencias'), 'evidencias.subir sigue funcionando');
select pg_temp.avatar_check((select count(*)=1 from storage.objects where bucket_id='haiku-avatares'), 'gestionar y evidencias no amplian avatares');
reset role;
select pg_temp.avatar_check((select metadata='{}'::jsonb from storage.objects where bucket_id='haiku-avatares' and name='00000000-0000-0000-0000-000000000002/avatar'), 'B sigue intacto');
-- 13-16: el runner compara antes/despues bucket y policies de evidencias,
-- columnas de usuarios y pg_get_functiondef de haiku_sesion_actual.
select nombre from avatar_checks order by nombre;
rollback;
