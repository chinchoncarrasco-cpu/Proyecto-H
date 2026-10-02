-- Solo PostgreSQL local desechable: esquema minimo de Storage, sin servidor de archivos.
-- Auth usa claims sinteticos; activo/foldername y policies de evidencias capturados
-- en READ ONLY el 2026-10-02. No contiene usuarios ni objetos productivos.
create schema auth;
create schema private;
create schema storage;
create role authenticated nologin;
create role anon nologin;
create table public.usuarios (
 id uuid primary key, nombre text, apellido text, telefono text,
 activo boolean not null default true,
 creado_en timestamptz default now(), actualizado_en timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE OR REPLACE FUNCTION private.haiku_usuario_activo()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.usuarios u
       where u.id = (select auth.uid())
         and u.activo = true
     );
$function$;
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;
-- Doble de permisos SOLO para verificar aislamiento respecto de evidencias.
create function private.haiku_tiene_permiso(p text) returns boolean language sql stable as $$
 select coalesce(p = any(string_to_array(current_setting('test.permisos',true),',')), false)
$$;
create function private.haiku_sesion_actual_impl() returns jsonb language sql stable as $$
 select jsonb_build_object('usuario',jsonb_build_object('id',auth.uid()))
$$;
CREATE OR REPLACE FUNCTION public.haiku_sesion_actual()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.haiku_sesion_actual_impl();
$function$;
create table storage.buckets (
 id text primary key, name text unique not null, public boolean default false,
 file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
 id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
 name text not null, metadata jsonb default '{}', unique(bucket_id,name)
);
alter table storage.objects enable row level security;
grant usage on schema public, auth, private, storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated, anon;
grant select on storage.buckets to authenticated, anon;
-- Sin grants de tablas de usuarios: se usa el helper activo existente.
insert into storage.buckets values ('haiku-evidencias','haiku-evidencias',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']);
create policy haiku_evidencias_storage_select on storage.objects for SELECT to authenticated using (((bucket_id = 'haiku-evidencias'::text) AND private.haiku_usuario_activo() AND private.haiku_tiene_permiso('evidencias.ver'::text)));
create policy haiku_evidencias_storage_insert on storage.objects for INSERT to authenticated with check (((bucket_id = 'haiku-evidencias'::text) AND private.haiku_usuario_activo() AND private.haiku_tiene_permiso('evidencias.subir'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
