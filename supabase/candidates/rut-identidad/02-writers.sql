-- CANDIDATA LOCAL; sólo tras 01, con revisión y autorización independiente.
-- No altera pagos, estados, cancelaciones, ni el índice textual existente.
begin;
do $patch$
declare f record; despues record; original text; nuevo text; antiguo text; reemplazo text;
begin
  select * into f from pg_proc where oid=to_regprocedure('public.haiku_crear_reserva(text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb,text,text)');
  if not found or md5(replace(f.prosrc,E'\r',''))<>'da4196b1493aa6c996ce59e8ae09c2c9'
    or f.proowner<>'postgres'::regrole or f.prosecdef is distinct from true
    or f.proacl is distinct from '{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]
    or regexp_replace(array_to_string(f.proconfig,','),'\s','','g') is distinct from 'search_path=pg_catalog,public,private' then
    raise exception 'Writer haiku_crear_reserva no coincide con cuerpo auditado; detener y revisar';
  end if;
  original:=replace(pg_get_functiondef(f.oid),E'\r',''); nuevo:=original;
  antiguo:=$old$  if p_rut is not null and btrim(p_rut) <> '' then
    v_rut_normalizado := regexp_replace(upper(btrim(p_rut)), '[^0-9K]', '', 'g');
    select id into v_titular_huesped_id
    from public.huespedes
    where tipo_documento = 'rut'
      and numero_documento = v_rut_normalizado
    limit 1;
  end if;$old$; reemplazo:=$new$  if p_rut is not null and btrim(p_rut) <> '' then
    v_rut_normalizado := private.haiku_rut_clave_v1(p_rut);
    v_titular_huesped_id := private.haiku_rut_resolver_v1(p_rut,p_titular_nombre);
  end if;$new$;
  antiguo:=replace(antiguo,E'\r',''); reemplazo:=replace(reemplazo,E'\r','');
  if (length(nuevo)-length(replace(nuevo,antiguo,'')))/length(antiguo)<>1 then
    raise exception 'Punto de parche inesperado en haiku_crear_reserva';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  execute nuevo;
  select * into despues from pg_proc where oid=f.oid;
  if (despues.proowner,despues.proacl,despues.prosecdef,despues.proconfig) is distinct from
     (f.proowner,f.proacl,f.prosecdef,f.proconfig) then raise exception 'Cambio inesperado de permisos'; end if;

  select * into f from pg_proc where oid=to_regprocedure('public.haiku_actualizar_reserva(uuid,text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb)');
  if not found or md5(replace(f.prosrc,E'\r',''))<>'787b9b6cdf45d99257d5a6ff251f533c'
    or f.proowner<>'postgres'::regrole or f.prosecdef is distinct from false
    or f.proacl is distinct from '{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]
    or regexp_replace(array_to_string(f.proconfig,','),'\s','','g') is distinct from 'search_path=public,pg_temp' then
    raise exception 'Writer haiku_actualizar_reserva no coincide con cuerpo auditado; detener y revisar';
  end if;
  original:=replace(pg_get_functiondef(f.oid),E'\r',''); nuevo:=original;
  antiguo:=$old$v_rut_normalizado := regexp_replace(upper(btrim(p_rut)), '[^0-9K]', '', 'g');$old$; reemplazo:=$new$v_rut_normalizado := private.haiku_rut_clave_v1(p_rut);
        if v_rut_normalizado is null then
          raise exception 'RUT inválido; requiere revisión manual' using errcode='HLI03';
        end if;$new$;
  antiguo:=replace(antiguo,E'\r',''); reemplazo:=replace(reemplazo,E'\r','');
  if (length(nuevo)-length(replace(nuevo,antiguo,'')))/length(antiguo)<>1 then
    raise exception 'Punto de parche inesperado en haiku_actualizar_reserva';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  execute nuevo;
  select * into despues from pg_proc where oid=f.oid;
  if (despues.proowner,despues.proacl,despues.prosecdef,despues.proconfig) is distinct from
     (f.proowner,f.proacl,f.prosecdef,f.proconfig) then raise exception 'Cambio inesperado de permisos'; end if;

  select * into f from pg_proc where oid=to_regprocedure('public.haiku_incorporar_libro_v1(uuid,jsonb)');
  if not found or md5(replace(f.prosrc,E'\r',''))<>'558000300cf1a0b41c7e0bc714435d48'
    or f.proowner<>'postgres'::regrole or f.prosecdef is distinct from true
    or f.proacl is distinct from '{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]
    or regexp_replace(array_to_string(f.proconfig,','),'\s','','g') is distinct from 'search_path=pg_catalog,public,private' then
    raise exception 'Writer haiku_incorporar_libro_v1 no coincide con cuerpo auditado; detener y revisar';
  end if;
  original:=replace(pg_get_functiondef(f.oid),E'\r',''); nuevo:=original;
  antiguo:=$old$when v_documento ~* '^[0-9]{1,2}(\.?[0-9]{3}){2}-?[0-9k]$' then v_documento$old$; reemplazo:=$new$when v_reserva->>'titular_tipo_documento'='rut' then v_documento
      when nullif(v_reserva->>'titular_tipo_documento','') is null
        and v_documento ~* '^[0-9]{1,2}(\.?[0-9]{3}){2}-?[0-9k]$' then v_documento$new$;
  antiguo:=replace(antiguo,E'\r',''); reemplazo:=replace(reemplazo,E'\r','');
  if (length(nuevo)-length(replace(nuevo,antiguo,'')))/length(antiguo)<>1 then
    raise exception 'Punto de parche inesperado en haiku_incorporar_libro_v1';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  antiguo:=$old$case when v_documento ~* '[a-z]' then 'pasaporte' else 'documento' end$old$; reemplazo:=$new$coalesce(nullif(v_reserva->>'titular_tipo_documento',''),case when v_documento ~* '[a-z]' then 'pasaporte' else 'documento' end)$new$;
  antiguo:=replace(antiguo,E'\r',''); reemplazo:=replace(reemplazo,E'\r','');
  if (length(nuevo)-length(replace(nuevo,antiguo,'')))/length(antiguo)<>2 then
    raise exception 'Punto de parche inesperado en haiku_incorporar_libro_v1';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  antiguo:=$old$    v_rut := case$old$; reemplazo:=$new$    if v_reserva->>'titular_tipo_documento'='rut' and v_documento is not null
      and private.haiku_rut_clave_v1(v_documento) is null then
      raise exception 'RUT inválido; requiere revisión manual' using errcode='HLI03';
    end if;
    v_rut := case$new$;
  antiguo:=replace(antiguo,E'\r',''); reemplazo:=replace(reemplazo,E'\r','');
  if (length(nuevo)-length(replace(nuevo,antiguo,'')))/length(antiguo)<>1 then
    raise exception 'Punto de parche inesperado en haiku_incorporar_libro_v1';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  execute nuevo;
  select * into despues from pg_proc where oid=f.oid;
  if (despues.proowner,despues.proacl,despues.prosecdef,despues.proconfig) is distinct from
     (f.proowner,f.proacl,f.prosecdef,f.proconfig) then raise exception 'Cambio inesperado de permisos'; end if;

  select * into f from pg_proc where oid=to_regprocedure('public.haiku_modificar_reserva_completa_core(uuid,text,smallint,date,date,text,smallint,smallint,smallint,text,text,text,text,jsonb,bigint,jsonb)');
  if not found or md5(replace(f.prosrc,E'\r',''))<>'3b0e3eaffe7774e6c295fedff01bfe53'
    or f.proowner<>'postgres'::regrole or f.prosecdef is distinct from true
    or f.proacl is distinct from '{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]
    or regexp_replace(array_to_string(f.proconfig,','),'\s','','g') is distinct from 'search_path=pg_catalog,public,private' then
    raise exception 'Writer haiku_modificar_reserva_completa_core no coincide con cuerpo auditado; detener y revisar';
  end if;
  original:=replace(pg_get_functiondef(f.oid),E'\r',''); nuevo:=original;
  antiguo:=$old$v_rut_normalizado := regexp_replace(upper(btrim(p_rut)),'[^0-9K]','','g');$old$; reemplazo:=$new$v_rut_normalizado := private.haiku_rut_clave_v1(p_rut);
        if v_rut_normalizado is null then
          raise exception 'RUT inválido; requiere revisión manual' using errcode='HLI03';
        end if;$new$;
  antiguo:=replace(antiguo,E'\r',''); reemplazo:=replace(reemplazo,E'\r','');
  if (length(nuevo)-length(replace(nuevo,antiguo,'')))/length(antiguo)<>1 then
    raise exception 'Punto de parche inesperado en haiku_modificar_reserva_completa_core';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  execute nuevo;
  select * into despues from pg_proc where oid=f.oid;
  if (despues.proowner,despues.proacl,despues.prosecdef,despues.proconfig) is distinct from
     (f.proowner,f.proacl,f.prosecdef,f.proconfig) then raise exception 'Cambio inesperado de permisos'; end if;

  select * into f from pg_proc where oid=to_regprocedure('private.haiku_libro_actualizar_v1(jsonb)');
  if not found or md5(replace(f.prosrc,E'\r',''))<>'7214c9af409d4c7e04bdc06341c7e68f'
    or f.proowner<>'postgres'::regrole or f.prosecdef is distinct from false
    or f.proacl is distinct from '{postgres=X/postgres}'::aclitem[]
    or regexp_replace(array_to_string(f.proconfig,','),'\s','','g') is distinct from 'search_path=pg_catalog,public,private' then
    raise exception 'Writer haiku_libro_actualizar_v1 no coincide con cuerpo auditado; detener y revisar';
  end if;
  original:=replace(pg_get_functiondef(f.oid),E'\r',''); nuevo:=original;
  antiguo:=$old$h.numero_documento=v_nr.titular_numero_documento and h.id is distinct from v_r.titular_huesped_id$old$; reemplazo:=$new$(case when h.tipo_documento='rut' then
          private.haiku_rut_clave_v1(h.numero_documento)=private.haiku_rut_clave_v1(v_nr.titular_numero_documento)
          else h.numero_documento=v_nr.titular_numero_documento end)
        and not exists(select 1 from private.haiku_huesped_alias_v1 a where a.redundante_id=h.id and a.revertido_en is null)
        and h.id is distinct from v_r.titular_huesped_id$new$;
  antiguo:=replace(antiguo,E'\r',''); reemplazo:=replace(reemplazo,E'\r','');
  if (length(nuevo)-length(replace(nuevo,antiguo,'')))/length(antiguo)<>1 then
    raise exception 'Punto de parche inesperado en haiku_libro_actualizar_v1';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  antiguo:=$old$or v_h.numero_documento is distinct from v_nr.titular_numero_documento) then$old$; reemplazo:=$new$or (case when v_h.tipo_documento='rut' and v_nr.titular_tipo_documento='rut'
        and private.haiku_rut_clave_v1(v_h.numero_documento) is not null then
        private.haiku_rut_clave_v1(v_h.numero_documento) is distinct from private.haiku_rut_clave_v1(v_nr.titular_numero_documento)
        else v_h.numero_documento is distinct from v_nr.titular_numero_documento end)) then$new$;
  antiguo:=replace(antiguo,E'\r',''); reemplazo:=replace(reemplazo,E'\r','');
  if (length(nuevo)-length(replace(nuevo,antiguo,'')))/length(antiguo)<>1 then
    raise exception 'Punto de parche inesperado en haiku_libro_actualizar_v1';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  antiguo:=$old$    v_nr:=jsonb_populate_record(v_r,p_item->'reserva'->'despues');$old$; reemplazo:=$new$    v_nr:=jsonb_populate_record(v_r,p_item->'reserva'->'despues');
    if v_nr.titular_tipo_documento='rut'
      and v_nr.titular_numero_documento is distinct from v_r.titular_numero_documento
      and private.haiku_rut_clave_v1(v_nr.titular_numero_documento) is null then
      raise exception 'RUT inválido; requiere revisión manual' using errcode='HLI03';
    end if;$new$;
  antiguo:=replace(antiguo,E'\r',''); reemplazo:=replace(reemplazo,E'\r','');
  if (length(nuevo)-length(replace(nuevo,antiguo,'')))/length(antiguo)<>1 then
    raise exception 'Punto de parche inesperado en haiku_libro_actualizar_v1';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  execute nuevo;
  select * into despues from pg_proc where oid=f.oid;
  if (despues.proowner,despues.proacl,despues.prosecdef,despues.proconfig) is distinct from
     (f.proowner,f.proacl,f.prosecdef,f.proconfig) then raise exception 'Cambio inesperado de permisos'; end if;
end;
$patch$;
commit;
