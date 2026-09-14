create schema auth;
create schema private;
create role anon;
create role authenticated;
create function auth.uid() returns uuid language sql as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function private.haiku_usuario_activo() returns boolean language sql as $$
 select coalesce(nullif(current_setting('test.activo',true),''),'true')::boolean
$$;
create function private.haiku_tiene_permiso(text) returns boolean language sql as $$
 select $1='cabanas.liberar' and coalesce(nullif(current_setting('test.permiso',true),''),'true')::boolean
$$;
create table public.cabanas(id uuid primary key, numero integer unique not null);
create table public.bloqueos_cabana(
 id uuid primary key, cabana_id uuid not null references cabanas(id), estado text not null,
 desde timestamptz not null, hasta timestamptz, motivo text not null,
 actualizado_en timestamptz not null, liberado_por uuid, liberado_en timestamptz
);
