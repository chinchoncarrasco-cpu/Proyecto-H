-- Integration regression. Every fixture and audit row is rolled back.
begin;
set local statement_timeout = '20s';
do $test$
declare
 u uuid:=gen_random_uuid(); ro uuid:=gen_random_uuid(); h uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 olddoc text:='OLD'||replace(h::text,'-',''); newdoc text:='PX'||replace(h::text,'-',''); testfolio text:='F'||replace(p::text,'-',''); testbovtar text:='B'||replace(p::text,'-',''); cab uuid; n smallint; op uuid:=gen_random_uuid(); item jsonb; payitem jsonb; result jsonb; charge uuid; failed boolean:=false; nr uuid;
begin
 insert into auth.users(id,email) values(u,'haku-fixture-'||u||'@example.invalid');
 insert into public.usuarios(id,nombre,activo) values(u,'Fixture Haku',true) on conflict(id) do nothing;
 insert into public.roles(id,codigo,nombre) values(ro,'fixture_'||ro,'Fixture Haku');
 insert into public.usuario_roles(usuario_id,rol_id) values(u,ro);
 insert into public.rol_permisos(rol_id,permiso_id) select ro,id from public.permisos where codigo in ('reservas.editar','reservas.crear','pagos.registrar','pagos.verificar','reservas.ver','cabanas.ver');
 perform set_config('request.jwt.claim.sub',u::text,true);
 select id,numero into cab,n from public.cabanas where activa order by numero limit 1;
 insert into public.huespedes(id,nombre,tipo_documento,numero_documento) values(h,'Fixture Yann','rut',olddoc);
 insert into public.reservas(id,titular_nombre,titular_tipo_documento,titular_numero_documento,titular_huesped_id,correo_contacto,estado_reserva)
 values(r,'Fixture Yann','rut',olddoc,h,'old@example.invalid','confirmada');
 insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,adultos,ninos,mascotas,estado_estadia)
 values(e,r,cab,'2098-09-20','2098-09-23','alojamiento',2,0,0,'confirmada');
 item:=jsonb_build_object('tipo','reserva_actualizar','item_id','fixture-passport','reserva_id',r,'estadia_id',e,
 'reserva',jsonb_build_object('antes',jsonb_build_object('titular_numero_documento',olddoc,'titular_tipo_documento','rut','correo_contacto','old@example.invalid'),
 'despues',jsonb_build_object('titular_numero_documento',newdoc,'titular_tipo_documento','pasaporte','correo_contacto','new@example.invalid')),
 'estadia',jsonb_build_object('antes',jsonb_build_object('adultos',2),'despues',jsonb_build_object('adultos',3)));
 result:=public.haiku_incorporar_libro_v1(op,jsonb_build_array(item));
 assert (result->>'actualizaciones')::int=1,'Update count';
 assert (select titular_numero_documento=newdoc and titular_tipo_documento='pasaporte' and correo_contacto='new@example.invalid' from public.reservas where id=r),'Passport/contact';
 assert (select numero_documento=newdoc from public.huespedes where id=h),'Guest passport';
 assert (select adultos=3 from public.reserva_estadias where id=e),'Occupancy';
 result:=public.haiku_incorporar_libro_v1(op,jsonb_build_array(item)); assert (result->>'reintento')::boolean,'Idempotent retry';
 -- A stale preview fails before changing either entity.
 item:=jsonb_set(item,'{reserva,despues,correo_contacto}','"stale@example.invalid"');
 begin
  perform public.haiku_incorporar_libro_v1(gen_random_uuid(),jsonb_build_array(item));
 exception when others then failed:=sqlerrm like '%cambió%'; end;
 assert failed,'Stale preview must fail';
 assert (select correo_contacto='new@example.invalid' from public.reservas where id=r),'No stale write';
 -- Existing payment amount changes without making another payment.
 insert into public.pagos(id,reserva_id,monto,moneda,tipo_movimiento,etapa_operativa,medio_pago,estado,fecha_pago,folio,datos_origen,creado_por)
 values(p,r,200000,'CLP','pago','abono','tarjeta_debito','confirmado','2098-09-10T12:00:00Z',testfolio,jsonb_build_object('bovtar',testbovtar),u);
 payitem:=jsonb_build_object('tipo','pago_actualizar','item_id','fixture-payment','pago_id',p,'reserva_id',r,
 'identificadores',jsonb_build_object('folio',testfolio,'bovtar',testbovtar),
 'pago',jsonb_build_object('antes',jsonb_build_object('monto',200000),'despues',jsonb_build_object('monto',273651)));
 result:=public.haiku_incorporar_libro_v1(gen_random_uuid(),jsonb_build_array(payitem));
 assert (select monto=273651 from public.pagos where id=p),'Payment amount';
 assert (select count(*)=1 from public.pagos where reserva_id=r),'No duplicate payment';
 -- Batch atomicity: valid update is rolled back when a second update fails.
 item:=jsonb_build_object('tipo','reserva_actualizar','item_id','fixture-atomic','reserva_id',r,'estadia_id',e,
 'reserva',jsonb_build_object('antes',jsonb_build_object('correo_contacto','new@example.invalid'),'despues',jsonb_build_object('correo_contacto','atomic@example.invalid')),
 'estadia','{"antes":{},"despues":{}}'::jsonb);
 failed:=false;
 begin perform public.haiku_incorporar_libro_v1(gen_random_uuid(),jsonb_build_array(item,jsonb_set(payitem,'{pago,despues,monto}','1')));
 exception when others then failed:=true; end;
 assert failed,'Atomic batch failure';
 assert (select correo_contacto='new@example.invalid' from public.reservas where id=r),'Atomic rollback';
 -- Reducing a payment corrects allocations without creating or deleting money.
 insert into public.cargos(reserva_id,estadia_id,tipo_cargo,concepto,monto,moneda,estado,creado_por)
 values(r,e,'alojamiento','Fixture allocation',100000,'CLP','activo',u) returning id into charge;
 insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values(p,charge,100000);
 payitem:=jsonb_set(jsonb_set(payitem,'{pago,antes,monto}','273651'),'{pago,despues,monto}','50000');
 perform public.haiku_incorporar_libro_v1(gen_random_uuid(),jsonb_build_array(payitem));
 assert (select monto=50000 from public.pagos where id=p),'Reduced payment';
 assert (select sum(monto_aplicado)=50000 from public.pago_aplicaciones where pago_id=p),'Adjusted allocations';
 -- Missing occupation does not block a separate contact correction.
 update public.reserva_estadias set adultos=0 where id=e;
 perform public.haiku_incorporar_libro_v1(gen_random_uuid(),jsonb_build_array(item));
 assert (select adultos=0 from public.reserva_estadias where id=e),'Preserved unknown adults';
 -- No authenticated identity cannot call the batch.
 perform set_config('request.jwt.claim.sub','',true); failed:=false;
 begin perform public.haiku_incorporar_libro_v1(gen_random_uuid(),jsonb_build_array(item)); exception when others then failed:=true; end;
 assert failed,'Authentication required'; perform set_config('request.jwt.claim.sub',u::text,true);
 -- Correct dates and keep nightly accounting in range.
 insert into public.estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values(e,'2098-09-20',100000,'manual'),(e,'2098-09-21',100000,'manual'),(e,'2098-09-22',100000,'manual');
 item:=jsonb_build_object('tipo','reserva_actualizar','item_id','fixture-dates','reserva_id',r,'estadia_id',e,'reserva','{"antes":{},"despues":{}}'::jsonb,
 'estadia',jsonb_build_object('antes',jsonb_build_object('fecha_ingreso','2098-09-20','fecha_salida','2098-09-23'),'despues',jsonb_build_object('fecha_ingreso','2098-09-21','fecha_salida','2098-09-24')));
 perform public.haiku_incorporar_libro_v1(gen_random_uuid(),jsonb_build_array(item));
 assert (select fecha_ingreso='2098-09-21' and fecha_salida='2098-09-24' from public.reserva_estadias where id=e),'Date correction';
 assert (select count(*)=3 from public.cargos where estadia_id=e and estado='activo'),'Active nightly charges';
 -- A new passport also preserves its letters (legacy creation used a null type).
 item:=jsonb_build_object('tipo','reserva_nueva','item_id','fixture-new-passport','reserva',jsonb_build_object('titular_nombre','Fixture New Passport','titular_numero_documento',newdoc||'NEW'),
 'estadias',jsonb_build_array(jsonb_build_object('cabana_numero',n,'datos',jsonb_build_object('fecha_ingreso','2098-10-01','fecha_salida','2098-10-02','tipo_estadia','alojamiento','adultos',2,'ninos',0,'mascotas',0,'estado_estadia','confirmada'))));
 result:=public.haiku_incorporar_libro_v1(gen_random_uuid(),jsonb_build_array(item)); nr:=(result->'resultados'->0->>'reserva_id')::uuid;
 assert (select titular_numero_documento=newdoc||'NEW' and titular_tipo_documento='pasaporte' from public.reservas where id=nr),'New passport';
 assert (select estado_reserva='confirmada' from public.reservas where id=nr),'New Libro state';
end;
$test$;
rollback;
select 'PASS: passport, contact, occupancy, payment correction, retry, stale preview, atomic rollback, authentication, dates and new passport; fixtures rolled back' as result;
