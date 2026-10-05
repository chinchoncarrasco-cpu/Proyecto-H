-- Completa el fixture efímero para ejecutar el actualizador real de estadías.
alter table public.reservas add column titular_tipo_documento text;
alter table public.reservas add column correo_contacto text;
alter table public.reservas add column telefono_contacto text;
alter table public.reservas add column observaciones text;
alter table public.reservas add column titular_huesped_id uuid;
alter table public.reserva_estadias add column checkin_realizado_en timestamptz;
alter table public.reserva_estadias add column checkin_realizado_por uuid;
alter table public.reserva_estadias add column checkout_realizado_en timestamptz;
alter table public.reserva_estadias add column checkout_realizado_por uuid;
alter table public.pagos add column pago_origen_id uuid;
alter table public.pago_aplicaciones add column id uuid default gen_random_uuid();
alter table public.pago_aplicaciones add column creado_en timestamptz default now();
alter table public.estadia_noches add column id uuid default gen_random_uuid();
create table public.huespedes(id uuid,nombre text,numero_documento text,tipo_documento text,correo text,telefono text);
