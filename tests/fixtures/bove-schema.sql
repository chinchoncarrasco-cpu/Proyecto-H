-- Sólo bases desechables locales. No contiene datos reales.
create schema auth;
create schema private;
create role authenticated;
create role anon;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function private.haiku_tiene_permiso(p text) returns boolean language sql as $$
  select p='pagos.verificar' and coalesce(current_setting('haku.test_permit',true),'on') <> 'off'
$$;
create table public.reservas (
 id uuid primary key,
 bove_cierre text, bove_checkout text,
 bove_cierre_registrado_por uuid, bove_cierre_registrado_en timestamptz,
 bove_checkout_registrado_por uuid, bove_checkout_registrado_en timestamptz,
 actualizado_en timestamptz
);
create table public.saldos_fixture(reserva_id uuid, saldo_alojamiento bigint, total_alojamiento bigint);
create view public.vista_saldos_alojamiento_reserva as select * from public.saldos_fixture;
create table public.cargos_fixture(reserva_id uuid,monto bigint,saldo_cargo bigint,tipo_cargo text,estado text);
create view public.vista_estado_cargos as select * from public.cargos_fixture;
create table public.auditoria_fixture(reserva_id uuid);
create function public.auditar_fixture() returns trigger language plpgsql as $$
begin insert into public.auditoria_fixture values(new.id);return new;end
$$;
create trigger auditoria after update on public.reservas for each row execute function public.auditar_fixture();
