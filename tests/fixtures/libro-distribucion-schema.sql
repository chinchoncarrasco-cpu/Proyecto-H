-- Minimal isolated accounting schema. Production RPC bodies run unchanged on it.
create role anon; create role authenticated;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function private.haiku_tiene_permiso(text) returns boolean language sql as $$select current_setting('haku.test_permit',true) is distinct from 'off'$$;
create table public.reservas(id uuid primary key,titular_nombre text,estado_reserva text);
create table public.cabanas(id uuid primary key,numero integer);
create table public.reserva_estadias(id uuid primary key,reserva_id uuid references reservas,cabana_id uuid references cabanas,
 fecha_ingreso date,fecha_salida date,estado_estadia text);
create table public.catalogo_servicios(id uuid primary key,codigo text);
create table public.servicios(id uuid primary key,reserva_id uuid references reservas,estadia_id uuid references reserva_estadias,
 catalogo_servicio_id uuid references catalogo_servicios,fecha_servicio date,estado_servicio text);
create table public.cargos(id uuid primary key,reserva_id uuid references reservas,estadia_id uuid references reserva_estadias,
 servicio_id uuid references servicios,tipo_cargo text,estado text,monto bigint,creado_en timestamptz default now());
create table public.pagos(id uuid primary key default gen_random_uuid(),reserva_id uuid references reservas,monto bigint check(monto>0),
 moneda text,tipo_movimiento text,etapa_operativa text,medio_pago text,estado text,fecha_pago timestamptz,
 folio text,codigo_autorizacion text,bove text,referencia_externa text,observaciones text,creado_por uuid,
 pagador_nombre text,datos_origen jsonb,creado_en timestamptz default now());
create table public.pago_aplicaciones(pago_id uuid references pagos,cargo_id uuid references cargos,monto_aplicado bigint check(monto_aplicado>0));
create view public.vista_estado_cargos as select c.id cargo_id,c.reserva_id,c.tipo_cargo,c.estado,
 c.monto-coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a where a.cargo_id=c.id),0) saldo_cargo from cargos c;
create table private.haiku_libro_incorporaciones(operacion_id uuid primary key,usuario_id uuid,solicitud_hash text,resultado jsonb,completado_en timestamptz);
