-- Estructura observada por SELECT, con IDs, RUT y contactos ficticios.
-- Se conserva el RUT CON GUION en reserva y huésped: es la causa a reproducir.
insert into cabanas(id,numero) values('00000000-0000-4000-8000-000000000009',9);
insert into huespedes(id,nombre,tipo_documento,numero_documento,telefono,correo)
values('00000000-0000-4000-8000-000000000002','Constanza Kutscher','rut','12345678-5','+56900000000','constanza@example.invalid');
insert into reservas(id,titular_nombre,estado_reserva,titular_huesped_id,titular_tipo_documento,titular_numero_documento,correo_contacto,telefono_contacto,observaciones)
values('00000000-0000-4000-8000-000000000001','Constanza Kutscher','confirmada','00000000-0000-4000-8000-000000000002','rut','12345678-5','constanza@example.invalid','+56900000000','Constanza Kutscher // 12345678-5 // 2adl + 2chld // CO // 08-09-2026');
insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,adultos,ninos,mascotas)
values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000009','2026-09-11','2026-09-12','alojamiento','confirmada',2,2,0);
insert into reserva_huespedes values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
insert into estadia_huespedes values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002');
insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa)
values('00000000-0000-4000-8000-000000000003','2026-09-11',180000,'manual');
alter table pagos add medio_pago text,add codigo_autorizacion text,add bove text,add folio text,add observaciones text;
insert into pagos(id,reserva_id,monto,estado,tipo_movimiento,fecha_pago,medio_pago,codigo_autorizacion,observaciones)
values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001',160000,'confirmado','pago','2026-09-08T00:00:00Z','webpay_credito','TEST123','Webpay por confirmar, PEND BOVE MANAGER');
insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado)
select '00000000-0000-4000-8000-000000000004',id,160000 from cargos where reserva_id='00000000-0000-4000-8000-000000000001' and estado='activo';
