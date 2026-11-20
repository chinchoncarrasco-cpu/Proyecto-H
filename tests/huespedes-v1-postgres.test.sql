
begin;
insert into public.usuarios(id,nombre) values
 ('a0000000-0000-4000-8000-000000000001','Operadora ficticia'),
 ('a0000000-0000-4000-8000-000000000002','Lector ficticio'),
 ('a0000000-0000-4000-8000-000000000003','Sin acceso');
insert into private.permisos
select v.operador::uuid,p.permiso
from (values ('a0000000-0000-4000-8000-000000000001'),('a0000000-0000-4000-8000-000000000002')) v(operador)
cross join (values ('huespedes.ver'),('reservas.ver'),('cabanas.ver')) p(permiso);
insert into private.permisos values ('a0000000-0000-4000-8000-000000000001','huespedes.gestionar');
insert into public.huespedes(id,nombre,apellido,tipo_documento,numero_documento,nacionalidad) values
 ('a1000000-0000-4000-8000-000000000001','Ada','Prueba','rut','12.345.678-5','Chile'),
 ('a1000000-0000-4000-8000-000000000002','Berta','Prueba','pasaporte','XY789','Uruguay'),
 ('a1000000-0000-4000-8000-000000000003','Berta','Prueba','pasaporte','XY790','Uruguay'),
 ('a1000000-0000-4000-8000-000000000004','Ciro','Prueba',null,null,null);
insert into public.reservas(id,titular_huesped_id,titular_nombre,codigo_haiku) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Ada','PRUEBA-1'),
 ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','Berta','PRUEBA-2');
insert into public.cabanas(id,numero,tipo) values
 ('a3000000-0000-4000-8000-000000000001',1,'Loft'),
 ('a3000000-0000-4000-8000-000000000002',2,'Maxiloft');
insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,adultos,ninos,mascotas,estado_estadia) values
 ('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','2026-11-19','2026-11-21',2,1,1,'hospedada'),
 ('a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002','2026-11-21','2026-11-23',2,1,1,'confirmada'),
 ('a4000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','2026-11-24','2026-11-25',2,0,0,'confirmada'),
 ('a4000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002','2026-11-24','2026-11-25',1,0,0,'confirmada');
insert into public.reserva_huespedes values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001'),
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002');
insert into public.estadia_huespedes values
 ('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001'),
 ('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002'),
 ('a4000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002');
set local role authenticated;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';

do $$
declare
 res constant uuid := 'a2000000-0000-4000-8000-000000000001';
 res2 constant uuid := 'a2000000-0000-4000-8000-000000000002';
 titular constant uuid := 'a1000000-0000-4000-8000-000000000001';
 acomp constant uuid := 'a1000000-0000-4000-8000-000000000002';
 destino constant uuid := 'a1000000-0000-4000-8000-000000000003';
 foto constant text := 'a0000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-000000000001.jpg';
 b uuid;
 b2 uuid;
 listo uuid;
 veh uuid;
 mascota uuid;
 etiqueta uuid;
 perfil jsonb;
 lectura jsonb;
begin
 lectura:=public.haiku_huesped_directorio_v1('hospedados');
 assert (lectura->'conteos'->>'hospedados')::int=3, 'Titular y acompañante se cuentan una vez';
 assert jsonb_array_length(public.haiku_huesped_directorio_v1('todos','12345678-5')->'filas')=1, 'Busca RUT con otra puntuación';
 assert jsonb_array_length(public.haiku_huesped_directorio_v1('todos','Berta')->'filas')=2, 'No fusiona homónimas';
 assert (select count(*) from public.haiku_huesped_integrantes_v1 where reserva_id=res and rol='borrador')=1;
 assert (select count(*) from public.haiku_huesped_integrantes_v1 where reserva_id=res2 and rol='borrador')=2, 'Suma cabañas simultáneas';
 select id into strict b from public.haiku_huesped_integrantes_v1 where reserva_id=res and rol='borrador';
 assert (select estadia_id is null and numero is null from public.haiku_huesped_visitas_v1 where id=b), 'Asignación desconocida';
 assert jsonb_array_length(public.haiku_huesped_perfil_v1(acomp,res,true)->'historial')=2;
 assert public.haiku_huesped_perfil_v1(acomp,res)->'visita'->>'rol'='acompanante';
 assert public.haiku_huesped_perfil_v1(acomp,res2)->'visita'->>'rol'='titular';

 perform public.haiku_huesped_guardar_v1(titular,res,'registro','{"categoria":"preferencia","texto":"Prefiere cacao","fuente":"Lo comentó"}');
 assert jsonb_array_length(public.haiku_huesped_perfil_v1(acomp,res)->'registros')=0, 'Preferencias independientes';

 perform public.haiku_huesped_guardar_v1(titular,res,'ficha','{"telefono":"Contacto manual de prueba"}');
 perform public.haiku_huesped_guardar_v1(titular,res,'ficha','{"telefono":""}');
 assert public.haiku_huesped_perfil_v1(titular,res)->'persona'->>'telefono'='Contacto manual de prueba';
 perform public.haiku_huesped_guardar_v1(acomp,res,'registro','{"categoria":"actividad","texto":"Actividad de prueba","fuente":"Observación"}');
 assert jsonb_array_length(public.haiku_huesped_perfil_v1(acomp,res2)->'registros')=0, 'Actividad limitada a la visita';

 perform public.haiku_huesped_guardar_v1(b,res,'ficha','{"descripcion":"Mochila roja"}');
 perform public.haiku_huesped_guardar_v1(b,res,'ficha','{"descripcion":"Mochila roja"}');
 perform public.haiku_huesped_guardar_v1(b,res,'registro','{"categoria":"preferencia","texto":"Té rojo","fuente":"Confirmado por huésped"}');
 assert (select count(*) from public.haiku_huesped_fichas where reserva_id=res)=1, 'Borrador guardado idempotente';

 insert into storage.objects values ('haiku-huespedes',foto);
 perform public.haiku_huesped_guardar_v1(b,res,'foto',jsonb_build_object('clase','persona','ruta',foto));
 begin
  perform public.haiku_huesped_guardar_v1(b,res,'foto',jsonb_build_object('clase','persona','ruta',foto||'x','esperada',foto));
  raise exception 'Se aceptó una foto ausente';
 exception when no_data_found then null; end;
 assert public.haiku_huesped_perfil_v1(b,res)->'persona'->>'foto'=foto;
 delete from storage.objects where name=foto;
 assert found=false, 'Protege foto referenciada';

 etiqueta:=(public.haiku_huesped_guardar_v1(null,null,'crear_etiqueta','{"grupo":"Intereses","nombre":"Astronomía"}')->>'id')::uuid;
 perform public.haiku_huesped_guardar_v1(b,res,'etiquetas',jsonb_build_object('ids',jsonb_build_array(etiqueta)));
 veh:=(public.haiku_huesped_guardar_v1(titular,res,'vehiculo','{"tipo":"Auto","modelo":"Modelo ficticio","color":"Azul"}')->>'id')::uuid;
 assert public.haiku_huesped_perfil_v1(acomp,res)->'vehiculos'->0->>'id'=veh::text;
 perform public.haiku_huesped_guardar_v1(acomp,res,'vehiculo',jsonb_build_object('id',veh,'tipo','Auto','color','Verde'));
 assert jsonb_array_length(public.haiku_huesped_perfil_v1(titular,res)->'vehiculos')=1;
 mascota:=(public.haiku_huesped_guardar_v1(b,res,'mascota','{"nombre":"Nube","especie":"Perro","presente":true}')->>'id')::uuid;

 select (public.haiku_huesped_guardar_v1(b,res,'vincular',jsonb_build_object('huesped_id',destino))->>'id')::uuid into listo;
 assert listo=destino;
 perfil:=public.haiku_huesped_perfil_v1(destino,res);
 assert perfil->'registros'->0->>'texto'='Té rojo';
 assert perfil->'persona'->>'descripcion'='Mochila roja';
 assert perfil->'persona'->>'foto'=foto;
 assert perfil->'mascotas'->0->>'id'=mascota::text and perfil->'mascotas'->0->>'presente'='true';
 assert perfil->'etiquetas'->0->>'nombre'='Astronomía';

 select id into b2 from public.haiku_huesped_integrantes_v1 where reserva_id=res2 and rol='borrador' order by plaza limit 1;
 perform public.haiku_huesped_guardar_v1(b2,res2,'ficha','{"descripcion":"Borrador para conservar"}');
 begin
  perform public.haiku_huesped_guardar_v1(b2,res2,'identificar','{"nombre":"Lia","tipo_documento":"rut","numero_documento":"12345678-1"}');
  raise exception 'Se aceptó un RUT inválido';
 exception when invalid_parameter_value then null; end;
 select (public.haiku_huesped_guardar_v1(b2,res2,'identificar','{"nombre":"Lia","apellido":"Prueba"}')->>'id')::uuid into listo;
 assert (public.haiku_huesped_perfil_v1(listo,res2)->'persona'->>'descripcion')='Borrador para conservar';
 assert (select count(*) from public.haiku_huesped_integrantes_v1 where reserva_id=res2 and rol='borrador')=1;
 select id into strict b2 from public.haiku_huesped_integrantes_v1 where reserva_id=res2 and rol='borrador';
 perform public.haiku_huesped_guardar_v1(b2,res2,'ficha','{"descripcion":"Queda aunque baje la ocupación"}');
 perform set_config('haku.guests.draft',b2::text,true);
end $$;

reset role;
update public.reserva_estadias set adultos=1 where reserva_id='a2000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000002';
do $$
declare b uuid:=current_setting('haku.guests.draft')::uuid;
begin
 assert (select excedente from public.haiku_huesped_integrantes_v1 where id=b);
 assert public.haiku_huesped_perfil_v1(b)->'persona'->>'descripcion'='Queda aunque baje la ocupación';
 begin
  perform public.haiku_huesped_guardar_v1(b,null,'ficha','{}');
  raise exception 'Lector puede escribir';
 exception when insufficient_privilege then null; end;
 assert (select count(*) from storage.objects)=1;
 assert public.haiku_huesped_perfil_v1('a1000000-0000-4000-8000-000000000001')
   ->'registros'->0->>'nombre_operador'='Operadora ficticia';
end $$;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000003';
do $$
begin
 assert (select count(*) from public.haiku_huesped_fichas)=0;
 assert (select count(*) from storage.objects)=0;
 begin
  perform public.haiku_huesped_directorio_v1();
  raise exception 'Directorios internos visibles sin permiso';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$
begin
 assert (select count(*) from storage.objects)=0;
 begin
  perform public.haiku_huesped_directorio_v1();
  raise exception 'Anónimo puede consultar el directorio';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
