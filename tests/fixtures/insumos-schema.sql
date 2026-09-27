-- Esquema mínimo local, basado en metadatos de Proyecto H (sin datos de huéspedes).
create schema auth;
create schema private;
create role anon;
create role authenticated;
grant usage on schema public, private, auth to authenticated;
create function auth.uid() returns uuid language sql stable as $$
select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function private.haiku_usuario_activo() returns boolean language sql stable as $$
select coalesce(current_setting('test.activo', true), 'true') = 'true' $$;
create function private.haiku_tiene_permiso(permiso text) returns boolean language sql stable as $$
select permiso = any(string_to_array(current_setting('test.permisos', true), ',')) $$;
create table usuarios(id uuid primary key);
create table cabanas(id uuid primary key, numero smallint not null, activa boolean default true);
create table reservas(id uuid primary key, estado_reserva text not null default 'confirmada');
create table reserva_estadias(id uuid primary key, reserva_id uuid not null references reservas,
    cabana_id uuid not null references cabanas, fecha_ingreso date not null, fecha_salida date not null,
    estado_estadia text not null default 'confirmada');
create table solicitudes(id uuid primary key, descripcion text);
create table aseos(id uuid primary key default gen_random_uuid(), fecha date not null,
    cabana_id uuid not null references cabanas, tipo_aseo text not null, estado text not null default 'pendiente',
    asignado_a uuid references usuarios, creado_por uuid references usuarios, encargado_nombre text,
    revisor_nombre text, iniciado_en timestamptz, completado_en timestamptz);
create unique index aseos_fecha_cabana_unica on aseos(fecha,cabana_id);
create table revisiones_cabana(id uuid primary key, fecha date, cabana_id uuid references cabanas,
    tipo_revision text, estado text, resultado text);
grant select on usuarios, cabanas, reservas, reserva_estadias, solicitudes, revisiones_cabana to authenticated;
grant select, insert, update on aseos to authenticated;
alter table aseos enable row level security;
create policy aseos_select on aseos for select to authenticated using (
    private.haiku_usuario_activo() and (private.haiku_tiene_permiso('aseos.ver_todos') or
    (private.haiku_tiene_permiso('aseos.ver_asignados') and asignado_a = (select auth.uid()))));
create policy aseos_insert on aseos for insert to authenticated with check (private.haiku_tiene_permiso('aseos.gestionar_todos'));
create policy aseos_update on aseos for update to authenticated using (
    private.haiku_tiene_permiso('aseos.gestionar_todos') or
    (private.haiku_tiene_permiso('aseos.gestionar_asignados') and asignado_a = (select auth.uid()))) with check (
    private.haiku_tiene_permiso('aseos.gestionar_todos') or
    (private.haiku_tiene_permiso('aseos.gestionar_asignados') and asignado_a = (select auth.uid())));
alter table reservas enable row level security;
alter table reserva_estadias enable row level security;
create policy reservas_select on reservas for select to authenticated using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('reservas.ver'));
create policy estadias_select on reserva_estadias for select to authenticated using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('reservas.ver'));
create publication supabase_realtime;
