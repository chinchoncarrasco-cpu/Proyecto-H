-- Extension del fixture libro-distribucion-schema.sql. Solo DB efimera local.
alter table public.reservas alter column id set default gen_random_uuid();
alter table public.reservas add column titular_numero_documento text;
alter table public.reserva_estadias alter column id set default gen_random_uuid();
alter table public.reserva_estadias add column tipo_estadia text;
alter table public.reserva_estadias add column adultos smallint;
alter table public.reserva_estadias add column ninos smallint;
alter table public.reserva_estadias add column mascotas smallint;
alter table public.cabanas add column precio_base bigint;
alter table public.cabanas add column activa boolean default true;
alter table public.cargos alter column id set default gen_random_uuid();
alter table public.cargos add column estadia_noche_id uuid;
alter table public.cargos add column concepto text;
alter table public.cargos add column moneda text;
alter table public.cargos add column creado_por uuid;
create table public.reserva_huespedes(reserva_id uuid,huesped_id uuid);
create table public.estadia_huespedes(estadia_id uuid,huesped_id uuid,unique(estadia_id,huesped_id));
create table public.estadia_noches(estadia_id uuid,fecha date,tarifa bigint,origen_tarifa text);
create function public.haiku_cabanas_disponibles(date,date,text) returns table(numero smallint)
language sql as $$ select numero::smallint from public.cabanas where activa $$;
-- Doble explicito del creador general: verifica la tarifa explicita por fecha
-- recibida desde el importador real. No reproduce sus triggers financieros.
create function public.haiku_crear_reserva(
 p_titular_nombre text,p_cabana_numero smallint,p_fecha_ingreso date,p_fecha_salida date,
 p_adultos smallint,p_ninos smallint,p_mascotas smallint,p_correo_contacto text,
 p_telefono_contacto text,p_rut text,p_observaciones text,p_tarifas jsonb,
 p_acompanantes jsonb,p_tipo_estadia text,p_cloudbeds_id text
) returns jsonb language plpgsql as $$
declare rid uuid; eid uuid; cid uuid; importe bigint;
begin
 select id,precio_base into cid,importe from public.cabanas where numero=p_cabana_numero;
 if p_tipo_estadia='fullday' then
   importe := (p_tarifas->>p_fecha_ingreso::text)::bigint;
   if importe is null or importe<=0 then raise exception 'Falta tarifa explicita Full Day'; end if;
 elsif p_tarifas<>'{}'::jsonb then raise exception 'Se altero el contrato de alojamiento';
 end if;
 insert into public.reservas(titular_nombre,estado_reserva) values(p_titular_nombre,'pendiente') returning id into rid;
 insert into public.reserva_estadias(reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,adultos,ninos,mascotas,estado_estadia)
 values(rid,cid,p_fecha_ingreso,p_fecha_salida,p_tipo_estadia,p_adultos,p_ninos,p_mascotas,'pendiente') returning id into eid;
 insert into public.cargos(reserva_id,estadia_id,tipo_cargo,estado,monto) values(rid,eid,'alojamiento','activo',importe);
 return jsonb_build_object('reserva_id',rid,'codigo_haiku','LOCAL');
end $$;
