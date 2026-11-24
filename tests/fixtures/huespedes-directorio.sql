-- Se aplica sobre los datos ficticios de huespedes-v1-postgres.test.sql.
update public.reserva_estadias
set fecha_ingreso=current_date + case when estado_estadia='hospedada' then -1 else 2 end,
    fecha_salida=current_date + case when estado_estadia='hospedada' then 1 else 3 end;

insert into public.cabanas(id,numero,tipo) values
 ('a3000000-0000-4000-8000-000000000011',11,'Loft');
insert into public.huespedes(id,nombre,apellido,tipo_documento,numero_documento,nacionalidad) values
 ('a1000000-0000-4000-8000-000000000005','Dalia','Prueba','pasaporte','ABC12345','Chile');
update public.huespedes set tipo_documento='pasaporte',numero_documento='CIRO-PRUEBA'
where id='a1000000-0000-4000-8000-000000000004';
insert into public.reservas(id,titular_huesped_id,titular_nombre,estado_reserva) values
 ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','Ada','checked_out'),
 ('a2000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000005','Dalia','hospedada'),
 ('a2000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000005','Dalia','cancelada'),
 ('a2000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000002','Berta','checked_out');
insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,adultos,estado_estadia) values
 ('a4000000-0000-4000-8000-000000000008','a2000000-0000-4000-8000-000000000006','a3000000-0000-4000-8000-000000000002',current_date-4,current_date-2,1,'checked_out'),
 ('a4000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000001',current_date-5,current_date-3,2,'checked_out'),
 ('a4000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000011',current_date-1,current_date+1,2,'hospedada'),
 ('a4000000-0000-4000-8000-000000000007','a2000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000002',current_date-1,current_date+1,2,'confirmada');
insert into public.reserva_huespedes values
 ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004');
delete from public.estadia_huespedes
where estadia_id='a4000000-0000-4000-8000-000000000002';
update public.reserva_estadias set fecha_ingreso=current_date+4,fecha_salida=current_date+5
where id='a4000000-0000-4000-8000-000000000004';

begin;
set local role authenticated;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
do $$
declare
  visita record;
  etiqueta uuid := (select id from public.haiku_huesped_etiquetas where grupo='Motivo' and nombre='Descanso');
begin
  for visita in select id,titular_huesped_id,codigo_haiku from public.reservas
    where codigo_haiku in ('PRUEBA-1','PRUEBA-2')
  loop
    perform public.haiku_huesped_guardar_v1(visita.titular_huesped_id,visita.id,'etiquetas',
      jsonb_build_object('ids',jsonb_build_array(etiqueta)));
    perform public.haiku_huesped_guardar_v1(visita.titular_huesped_id,visita.id,'registro',
      '{"categoria":"preferencia","texto":"Prefiere té","fuente":"Lo comentó"}');
    perform public.haiku_huesped_guardar_v1(visita.titular_huesped_id,visita.id,'registro',
      jsonb_build_object('categoria','nota','texto','Nota de prueba','fuente','Observación',
        'solo_estadia',visita.codigo_haiku='PRUEBA-2'));
  end loop;
end $$;
commit;
