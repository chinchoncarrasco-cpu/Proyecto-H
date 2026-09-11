-- Esquema sintético aislado; sin conexiones ni credenciales de Proyecto H.
create role anon; create role authenticated; create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function private.haiku_tiene_permiso(text) returns boolean language sql as $$select current_setting('haku.test_permit',true) is distinct from 'off'$$;
create table huespedes(id uuid primary key default gen_random_uuid(),nombre text,tipo_documento text,numero_documento text,telefono text,correo text,creado_en timestamptz default now(),actualizado_en timestamptz default now());
create table reservas(id uuid primary key,titular_nombre text,estado_reserva text,grupo_reserva_id uuid,titular_huesped_id uuid references huespedes,
 titular_tipo_documento text,titular_numero_documento text,correo_contacto text,telefono_contacto text,observaciones text,
 bove_cierre text,bove_checkout text,actualizado_en timestamptz default now());
create table cabanas(id uuid primary key,numero smallint,activa boolean default true,precio_base bigint default 100000);
create table reserva_estadias(id uuid primary key,reserva_id uuid references reservas,cabana_id uuid references cabanas,
 fecha_ingreso date,fecha_salida date,tipo_estadia text,estado_estadia text,adultos smallint default 1,ninos smallint default 0,mascotas smallint default 0,
 checkin_realizado_en timestamptz,checkout_realizado_en timestamptz,creado_en timestamptz default now(),actualizado_en timestamptz default now());
create table estadia_noches(id uuid primary key default gen_random_uuid(),estadia_id uuid references reserva_estadias,fecha date,tarifa bigint,origen_tarifa text,unique(estadia_id,fecha));
create table reserva_huespedes(reserva_id uuid references reservas,huesped_id uuid references huespedes,primary key(reserva_id,huesped_id));
create table estadia_huespedes(estadia_id uuid references reserva_estadias,huesped_id uuid references huespedes,primary key(estadia_id,huesped_id));
create table servicios(id uuid primary key,reserva_id uuid references reservas,total bigint,estado_servicio text);
create table cargos(id uuid primary key default gen_random_uuid(),reserva_id uuid references reservas,estadia_id uuid references reserva_estadias,estadia_noche_id uuid references estadia_noches,
 servicio_id uuid references servicios,tipo_cargo text,concepto text,monto bigint,moneda text,estado text,creado_por uuid,creado_en timestamptz default now(),actualizado_en timestamptz default now());
create table pagos(id uuid primary key,reserva_id uuid references reservas,monto bigint,estado text,tipo_movimiento text,pago_origen_id uuid references pagos,fecha_pago timestamptz default now());
create table pago_aplicaciones(id uuid primary key default gen_random_uuid(),pago_id uuid references pagos,cargo_id uuid references cargos,monto_aplicado bigint,creado_en timestamptz default now());
create table cargo_ajustes(id uuid primary key,reserva_id uuid references reservas,estado text);
create view vista_estado_cargos as select c.*,c.id cargo_id,c.monto monto_ajustado,
 c.monto-coalesce((select sum(case when p.tipo_movimiento='pago' then pa.monto_aplicado else -pa.monto_aplicado end) from pago_aplicaciones pa join pagos p on p.id=pa.pago_id where pa.cargo_id=c.id and p.estado='confirmado'),0) saldo_cargo from cargos c;
create view vista_saldos_alojamiento_reserva as select reserva_id,sum(monto)::bigint total_alojamiento,sum(saldo_cargo)::bigint saldo_alojamiento from vista_estado_cargos where tipo_cargo='alojamiento' and estado='activo' group by reserva_id;
create table auditoria_total(id bigint generated always as identity,tabla text);
create function auditar_total_fixture() returns trigger language plpgsql as $$begin insert into auditoria_total(tabla) values(tg_table_name);return new;end;$$;
create trigger auditoria_cargos after insert or update on cargos for each row execute function auditar_total_fixture();
