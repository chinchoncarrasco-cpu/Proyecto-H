
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema private;
create schema auth;
create schema storage;
create function auth.uid() returns uuid language sql stable as $$
select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.usuarios(id uuid primary key,nombre text not null,apellido text,activo boolean not null default true);
create table private.permisos(usuario uuid references public.usuarios(id), permiso text,primary key(usuario,permiso));
create function private.haiku_usuario_activo() returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.usuarios where id=auth.uid() and activo)
$$;
create function private.haiku_tiene_permiso(p text) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from private.permisos where usuario=auth.uid() and permiso=p)
$$;
create table public.huespedes (
 id uuid primary key default gen_random_uuid(), nombre text not null check (btrim(nombre)<>''), apellido text,
 tipo_documento text,numero_documento text,nacionalidad text,telefono text,correo text,
 check ((tipo_documento is null)=(numero_documento is null)),unique(tipo_documento,numero_documento)
);
create table public.reservas (
 id uuid primary key default gen_random_uuid(), titular_huesped_id uuid references public.huespedes(id),
 titular_nombre text not null, titular_tipo_documento text, titular_numero_documento text,
 correo_contacto text,telefono_contacto text,codigo_haiku text,grupo_reserva_id uuid,estado_reserva text not null default 'confirmada'
);
create table public.cabanas (id uuid primary key default gen_random_uuid(),numero smallint not null,nombre text,tipo text);
create table public.reserva_estadias (
 id uuid primary key default gen_random_uuid(),reserva_id uuid not null references public.reservas(id),
 cabana_id uuid not null references public.cabanas(id),fecha_ingreso date not null,fecha_salida date not null,
 adultos smallint not null,ninos smallint not null default 0,mascotas smallint not null default 0,estado_estadia text not null default 'confirmada',
 checkout_realizado_en timestamptz
);
create table public.reserva_huespedes (reserva_id uuid references public.reservas(id),huesped_id uuid references public.huespedes(id),primary key(reserva_id,huesped_id));
create table public.estadia_huespedes (estadia_id uuid references public.reserva_estadias(id),huesped_id uuid references public.huespedes(id),primary key(estadia_id,huesped_id));
create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects (bucket_id text references storage.buckets(id),name text,primary key(bucket_id,name));
alter table public.usuarios enable row level security;
create policy usuarios_select on public.usuarios for select to authenticated using (
  private.haiku_usuario_activo() and (id=(select auth.uid()) or private.haiku_tiene_permiso('usuarios.ver'))
);
alter table public.huespedes enable row level security;
alter table public.reservas enable row level security;
alter table public.reserva_estadias enable row level security;
alter table public.reserva_huespedes enable row level security;
alter table public.estadia_huespedes enable row level security;
alter table public.cabanas enable row level security;
alter table storage.objects enable row level security;
create policy guests on public.huespedes for select to authenticated using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('huespedes.ver'));
create policy reservations on public.reservas for select to authenticated using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('reservas.ver'));
create policy stays on public.reserva_estadias for select to authenticated using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('reservas.ver'));
create policy cabins on public.cabanas for select to authenticated using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('cabanas.ver'));
create policy members on public.reserva_huespedes for select to authenticated using (private.haiku_usuario_activo() and (private.haiku_tiene_permiso('huespedes.ver') or private.haiku_tiene_permiso('reservas.ver')));
create policy members on public.estadia_huespedes for select to authenticated using (private.haiku_usuario_activo() and (private.haiku_tiene_permiso('huespedes.ver') or private.haiku_tiene_permiso('reservas.ver')));
grant usage on schema auth,private,storage to authenticated,anon;
grant select on all tables in schema public to authenticated;
grant select,insert,delete on storage.objects to authenticated,anon;
create function private.haiku_rut_clave_v1(p_numero text) returns text
language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare s text:=upper(btrim(p_numero)); n text; total integer:=0; factor integer:=2; dv text;
begin
  if s is null or s='' then return null; end if;
  -- No descartar letras o símbolos arbitrarios: eso convertiría entradas inválidas.
  if s !~ '^([0-9]{1,8}-?[0-9K]|[0-9]{1,3}(\.[0-9]{3}){1,2}-[0-9K])$' then return null; end if;
  s:=translate(s,'.-',''); n:=left(s,length(s)-1);
  if length(n)>8 or n ~ '^0' then return null; end if;
  for i in reverse length(n)..1 loop
    total:=total+substr(n,i,1)::integer*factor; factor:=case when factor=7 then 2 else factor+1 end;
  end loop;
  dv:=case 11-total%11 when 11 then '0' when 10 then 'K' else (11-total%11)::text end;
  if right(s,1)<>dv then return null; end if;
  return s;
end $$;
