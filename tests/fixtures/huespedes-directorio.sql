-- Se aplica sobre los datos ficticios de huespedes-v1-postgres.test.sql.
update public.reserva_estadias
set fecha_ingreso=current_date + case when estado_estadia='hospedada' then -1 else 2 end,
    fecha_salida=current_date + case when estado_estadia='hospedada' then 1 else 3 end;

insert into public.cabanas(id,numero,tipo) values
 ('a3000000-0000-4000-8000-000000000011',11,'Loft');
insert into public.huespedes(id,nombre,apellido,tipo_documento,numero_documento,nacionalidad) values
 ('a1000000-0000-4000-8000-000000000005','Dalia','Prueba','pasaporte','ABC12345','Chile');
insert into public.reservas(id,titular_huesped_id,titular_nombre,estado_reserva) values
 ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','Ada','checked_out'),
 ('a2000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000005','Dalia','hospedada'),
 ('a2000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000005','Dalia','cancelada');
insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,adultos,estado_estadia) values
 ('a4000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000001',current_date-5,current_date-3,2,'checked_out'),
 ('a4000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000011',current_date-1,current_date+1,2,'hospedada'),
 ('a4000000-0000-4000-8000-000000000007','a2000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000002',current_date-1,current_date+1,2,'confirmada');
insert into public.reserva_huespedes values
 ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004');
delete from public.estadia_huespedes
where estadia_id='a4000000-0000-4000-8000-000000000002';
