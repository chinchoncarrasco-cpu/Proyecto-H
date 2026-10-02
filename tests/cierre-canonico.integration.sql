-- SOLO base local desechable con cierre-schema, funciones originales, triggers y migration.
-- No ejecutar contra produccion, ni siquiera con ROLLBACK.
begin;
set local test.permisos = 'cierres.ver,cierres.realizar,cierres.reabrir,cierres.validar_pagos,cierres.validar_caja,cierres.validar_vale_salida';

create function pg_temp.check_cierre(ok boolean, mensaje text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', mensaje; end if;
end $$;
create function pg_temp.error_cierre(comando text, esperado text) returns void language plpgsql as $$
begin
  begin
    execute comando;
  exception when others then
    if position(esperado in sqlerrm) = 0 then raise; end if;
    return;
  end;
  raise exception 'FAIL: no se rechazo %', comando;
end $$;

insert into public.cabanas(numero, nombre) values (1, 'CAB prueba'), (2, 'CAB inactiva');
update public.cabanas set activa = false where numero = 2;
select public.haiku_asegurar_cierre_dia('2099-01-01');

do $$
declare
  llaves jsonb := '{"tonel":true,"jacuzzi":true,"lavanderia":true,"masajes":true,"generadores":true,"jardineria":true,"marcelo":true,"cisterna":true,"internet":true,"gas11":true,"torreon":true}';
  cid uuid;
  item record;
  resultado jsonb;
  snap jsonb;
  llave_codigo text;
  estado_ocupada text;
  valor_ocupada jsonb;
  completos integer;
  acepta boolean;
  estado jsonb;
begin
  select id into cid from public.cierres_turno;

  -- 1-4: derivacion atomica, JSON completo, revocacion y upsert sin duplicados.
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','llaves_recepcion','confirmado',llaves);
  perform pg_temp.check_cierre((select r.estado='confirmado' and r.valor='"si"'::jsonb
    from public.cierre_respuestas r join public.cierre_checklist_items i on i.id=r.item_id
    where r.cierre_id=cid and i.codigo='llaves_retiradas'), '11 llaves satisfacen llaves_retiradas');
  perform pg_temp.check_cierre((select r.valor=llaves and (select count(*) from jsonb_object_keys(r.valor))=11
    from public.cierre_respuestas r join public.cierre_checklist_items i on i.id=r.item_id
    where r.cierre_id=cid and i.codigo='llaves_recepcion'), 'JSON conserva las 11 claves');
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','llaves_recepcion','confirmado',llaves || '{"gas11":false}');
  perform pg_temp.check_cierre((select r.estado='pendiente' from public.cierre_respuestas r
    join public.cierre_checklist_items i on i.id=r.item_id where r.cierre_id=cid and i.codigo='llaves_retiradas'), 'una llave false deja pendiente');
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','llaves_recepcion','confirmado',llaves);
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','llaves_recepcion','confirmado',llaves);
  perform pg_temp.check_cierre((select count(*)=2 from public.cierre_respuestas where cierre_id=cid), 'sin duplicados');
  -- Cada clave es necesaria; ni strings truthy ni claves ausentes equivalen a true.
  for llave_codigo in select jsonb_object_keys(llaves) loop
    perform public.haiku_guardar_respuesta_cierre('2099-01-01','llaves_recepcion','confirmado',llaves - llave_codigo);
    perform pg_temp.check_cierre((select r.estado='pendiente' from public.cierre_respuestas r
      join public.cierre_checklist_items i on i.id=r.item_id where r.cierre_id=cid and i.codigo='llaves_retiradas'), 'falta ' || llave_codigo);
  end loop;
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','llaves_recepcion','confirmado',llaves || '{"gas11":"true"}');
  perform pg_temp.check_cierre((select r.estado='pendiente' from public.cierre_respuestas r
    join public.cierre_checklist_items i on i.id=r.item_id where r.cierre_id=cid and i.codigo='llaves_retiradas'), 'booleano estricto');
  -- Si falla la respuesta derivada no queda un detalle nuevo parcialmente guardado.
  update public.cierre_checklist_items set activo=false where codigo='llaves_retiradas';
  perform pg_temp.error_cierre(format('select public.haiku_guardar_respuesta_cierre(%L,%L,%L,%L::jsonb)',
    '2099-01-01','llaves_recepcion','confirmado',llaves), 'Ítem de cierre inexistente');
  perform pg_temp.check_cierre((select r.valor->>'gas11'='true' and jsonb_typeof(r.valor->'gas11')='string'
    from public.cierre_respuestas r join public.cierre_checklist_items i on i.id=r.item_id
    where r.cierre_id=cid and i.codigo='llaves_recepcion'), 'rollback de detalle si falla derivacion');
  update public.cierre_checklist_items set activo=true where codigo='llaves_retiradas';
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','llaves_recepcion','confirmado',llaves);

  -- Completar globales mediante RPC real, incluyendo permisos especificos de Manager.
  for item in select * from public.cierre_checklist_items where alcance='global' and obligatorio loop
    perform public.haiku_guardar_respuesta_cierre('2099-01-01',item.codigo,'confirmado',
      case when item.tipo_respuesta='booleano' then 'true'::jsonb else '"si"'::jsonb end);
  end loop;

  -- 5: ocupada confirmada true => 1/1 sin siete checks.
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_ocupada','confirmado','true',null,1::smallint);
  estado := public.haiku_estado_cierre_dia('2099-01-01');
  perform pg_temp.check_cierre((estado->>'pendientes')::int=0 and (estado->>'puede_cerrar_limpio')::boolean, 'ocupada satisfecha');
  perform pg_temp.check_cierre((estado->>'total_requeridos')::int=(select count(*)+1 from public.cierre_checklist_items where alcance='global' and obligatorio and activo), 'ocupada cuenta 1/1');
  perform public.haiku_cerrar_turno_dia('2099-01-01');
  perform pg_temp.error_cierre('select public.haiku_guardar_respuesta_cierre(''2099-01-01'',''llaves_recepcion'',''confirmado'',''{}'')', 'no admite edición');
  perform pg_temp.error_cierre('select public.haiku_guardar_novedades_cierre(''2099-01-01'',''No guardar'')', 'no admite edición');
  perform public.haiku_reabrir_cierre_dia('2099-01-01','Iniciar matriz');

  -- 6-9: matriz explicita estado/trigger, sin respuesta artificial de ocupacion.
  foreach estado_ocupada in array array['ausente','pendiente','confirmado','no_corresponde'] loop
    foreach valor_ocupada in array array['false'::jsonb,'true'::jsonb] loop
      for completos in 0..7 loop
        delete from public.cierre_respuestas r using public.cierre_checklist_items i
          where r.item_id=i.id and r.cierre_id=cid and i.alcance='cabana';
        if estado_ocupada <> 'ausente' then
          perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_ocupada',estado_ocupada,valor_ocupada,'Caso de prueba',1::smallint);
        end if;
        for item in select * from public.cierre_checklist_items where alcance='cabana' and codigo<>'cabana_ocupada' order by codigo limit completos loop
          perform public.haiku_guardar_respuesta_cierre('2099-01-01',item.codigo,'confirmado','true',null,1::smallint);
        end loop;
        estado := public.haiku_estado_cierre_dia('2099-01-01');
        acepta := completos=7 or estado_ocupada='no_corresponde' or (estado_ocupada='confirmado' and valor_ocupada='true'::jsonb);
        perform pg_temp.check_cierre((estado->>'puede_cerrar_limpio')::boolean=acepta, 'semantica CAB matriz');
        perform pg_temp.check_cierre(((estado->>'pendientes')::int=0)=acepta, 'pendientes matriz');
        if acepta then
          -- Invariante requerida: estado limpio => RPC real y trigger aceptan cerrado.
          resultado := public.haiku_cerrar_turno_dia('2099-01-01');
          perform pg_temp.check_cierre(resultado->>'cierre_estado'='cerrado', 'estado limpio permite cerrado');
          perform public.haiku_reabrir_cierre_dia('2099-01-01','Siguiente caso');
        else
          perform pg_temp.error_cierre(format('update public.cierres_turno set estado=%L,cerrado_por=auth.uid(),cerrado_en=now() where id=%L', 'cerrado',cid), 'controles obligatorios');
        end if;
      end loop;
    end loop;
  end loop;

  -- Booleanos confirmados false no satisfacen controles normales; no_corresponde si.
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_ocupada','pendiente','false',null,1::smallint);
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_luces','confirmado','false',null,1::smallint);
  perform pg_temp.check_cierre((public.haiku_estado_cierre_dia('2099-01-01')->>'pendientes')::int=1, 'seis de siete pendientes');
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_luces','no_corresponde',null,'Sin equipo',1::smallint);
  perform pg_temp.check_cierre((public.haiku_estado_cierre_dia('2099-01-01')->>'pendientes')::int=0, 'no_corresponde normal valido');

  -- 10-11: cierre con pendientes conserva resumen obligatorio.
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_luces','pendiente','false',null,1::smallint);
  perform pg_temp.error_cierre('select public.haiku_cerrar_turno_dia(''2099-01-01'')', 'indique un resumen');
  perform pg_temp.error_cierre('select public.haiku_cerrar_turno_dia(''2099-01-01'',''   '')', 'indique un resumen');
  resultado := public.haiku_cerrar_turno_dia('2099-01-01','Revisar luces');
  perform pg_temp.check_cierre(resultado->>'cierre_estado'='cerrado_con_pendientes', 'con resumen permite pendientes');

  -- 14-16: snapshot congelado, cierre bloquea edicion y reapertura restaura operacion.
  select snapshot into snap from public.cierres_turno where id=cid;
  perform pg_temp.check_cierre(snap->>'version'='1' and snap->>'resumen_entrega'='Revisar luces'
    and jsonb_array_length(snap->'respuestas')>0 and snap ? 'evidencias', 'snapshot completo');
  perform pg_temp.error_cierre('select public.haiku_guardar_respuesta_cierre(''2099-01-01'',''llaves_recepcion'',''confirmado'',''{}'')', 'no admite edición');
  perform pg_temp.error_cierre('select public.haiku_guardar_novedades_cierre(''2099-01-01'',''No guardar'')', 'no admite edición');
  perform public.haiku_cerrar_turno_dia('2099-01-01','Otro resumen');
  perform pg_temp.check_cierre((select snapshot=snap from public.cierres_turno where id=cid), 'reintento no cambia snapshot');
  perform pg_temp.error_cierre('select public.haiku_reabrir_cierre_dia(''2099-01-01'','''')', 'motivo de reapertura');
  resultado := public.haiku_reabrir_cierre_dia('2099-01-01','Correccion autorizada');
  perform pg_temp.check_cierre(resultado->>'cierre_estado'='reabierto' and resultado->>'turno_estado'='abierto', 'reapertura');
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_luces','confirmado','true',null,1::smallint);
  perform pg_temp.check_cierre((select snapshot=snap from public.cierres_turno where id=cid), 'edicion reabierta conserva snapshot anterior');

  -- 12: bloqueantes futuros globales y CAB, incluso opcionales.
  insert into public.cierre_checklist_items(codigo,nombre,alcance,obligatorio,bloquea_cierre)
    values ('prueba_global','Bloqueante global','global',false,true), ('prueba_cab','Bloqueante CAB','cabana',false,true);
  estado := public.haiku_estado_cierre_dia('2099-01-01');
  perform pg_temp.check_cierre(not (estado->>'puede_cerrar_limpio')::boolean, 'bloqueantes invalidan limpio aunque sean opcionales');
  perform pg_temp.error_cierre('select public.haiku_cerrar_turno_dia(''2099-01-01'',''Resumen'')', 'globales bloqueantes');
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','prueba_global','no_corresponde',null,'No aplica');
  perform pg_temp.error_cierre('select public.haiku_cerrar_turno_dia(''2099-01-01'',''Resumen'')', 'cabaña bloqueantes');
  -- no_corresponde en ocupada NO exime bloqueantes: conserva la regla previa.
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_ocupada','no_corresponde',null,'No revisar',1::smallint);
  perform pg_temp.check_cierre(not (public.haiku_estado_cierre_dia('2099-01-01')->>'puede_cerrar_limpio')::boolean, 'ocupada no_corresponde no exime bloqueantes');
  perform pg_temp.error_cierre('select public.haiku_cerrar_turno_dia(''2099-01-01'',''Resumen'')', 'cabaña bloqueantes');
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_ocupada','confirmado','true',null,1::smallint);
  perform pg_temp.check_cierre((public.haiku_estado_cierre_dia('2099-01-01')->>'puede_cerrar_limpio')::boolean, 'ocupada true exime bloqueantes CAB existentes');
  perform public.haiku_cerrar_turno_dia('2099-01-01');
  perform public.haiku_reabrir_cierre_dia('2099-01-01','Probar bloqueante ocupacion');
  update public.cierre_checklist_items set bloquea_cierre=true where codigo='cabana_ocupada';
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_ocupada','pendiente','false',null,1::smallint);
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','prueba_cab','no_corresponde',null,'No aplica',1::smallint);
  perform pg_temp.check_cierre(not (public.haiku_estado_cierre_dia('2099-01-01')->>'puede_cerrar_limpio')::boolean, 'ocupacion bloqueante explicita conservada');
  perform pg_temp.error_cierre('select public.haiku_cerrar_turno_dia(''2099-01-01'',''Resumen'')', 'cabaña bloqueantes');
  update public.cierre_checklist_items set bloquea_cierre=false where codigo='cabana_ocupada';
  -- Ambos estados de cierre rechazan bloqueantes.
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','prueba_global','pendiente','false');
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','cabana_luces','pendiente','false',null,1::smallint);
  perform pg_temp.error_cierre('select public.haiku_cerrar_turno_dia(''2099-01-01'',''Resumen'')', 'globales bloqueantes');
  perform public.haiku_guardar_respuesta_cierre('2099-01-01','prueba_global','confirmado','false');
  -- El bloqueante opcional conserva su semantica por estado, sin endurecerla.
  resultado := public.haiku_cerrar_turno_dia('2099-01-01','Pendiente luces');
  perform pg_temp.check_cierre(resultado->>'cierre_estado'='cerrado_con_pendientes', 'semantica bloqueante previa');
  perform public.haiku_reabrir_cierre_dia('2099-01-01','Permisos');

  -- 13: permisos Manager; ni confirmado ni no_corresponde saltan el permiso.
  perform set_config('test.permisos','cierres.ver,cierres.realizar,cierres.reabrir',true);
  for item in select * from public.cierre_checklist_items where categoria='manager' loop
    perform pg_temp.error_cierre(format('select public.haiku_guardar_respuesta_cierre(%L,%L,%L,%L::jsonb)',
      '2099-01-01',item.codigo,'confirmado','true'), 'Sin permiso');
    perform pg_temp.error_cierre(format('select public.haiku_guardar_respuesta_cierre(%L,%L,%L,null,%L)',
      '2099-01-01',item.codigo,'no_corresponde','No aplica'), 'permiso requerido');
    perform set_config('test.permisos','cierres.ver,cierres.realizar,cierres.reabrir,' || item.permiso_requerido,true);
    perform public.haiku_guardar_respuesta_cierre('2099-01-01',item.codigo,'confirmado','true');
    perform set_config('test.permisos','cierres.ver,cierres.realizar,cierres.reabrir',true);
  end loop;
  perform set_config('test.permisos','cierres.realizar',true);
  perform pg_temp.error_cierre('select public.haiku_estado_cierre_dia(''2099-01-01'')', 'Sin permiso para ver');
  perform pg_temp.error_cierre('select public.haiku_reabrir_cierre_dia(''2099-01-01'',''Motivo'')', 'Sin permiso para reabrir');
  perform set_config('test.permisos','cierres.ver',true);
  perform pg_temp.error_cierre('select public.haiku_guardar_respuesta_cierre(''2099-01-01'',''llaves_recepcion'',''confirmado'',''{}'')', 'Sin permiso para realizar');
  perform pg_temp.error_cierre('select public.haiku_cerrar_turno_dia(''2099-01-01'')', 'Sin permiso para cerrar');
end $$;
rollback;
