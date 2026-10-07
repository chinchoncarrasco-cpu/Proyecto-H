-- Airbnb is a distinct payment method. No historical rows or WebPay-only
-- contracts are converted. Patch the deployed general RPC bodies in place:
-- later Libro migrations have extended them and must not be overwritten.
begin;

alter table public.pagos drop constraint pagos_medio_pago_valido;
alter table public.pagos add constraint pagos_medio_pago_valido check (
  medio_pago in ('transferencia','webpay_credito','webpay_debito',
    'tarjeta_credito','tarjeta_debito','efectivo','otro','airbnb_prepaid_card')
);

do $migration$
declare
  f record;
  actual record;
  original text;
  nuevo text;
  lista text[];
  campos text;
  vistos text[] := array[]::text[];
  nombre text;
begin
  -- Exact, CR/LF-normalized bodies reconstructed from the audited local chain.
  -- This is a deployment-shape guard, never payment identity/authorization.
  -- A different deployed body must be reviewed instead of partially patched.
  for f in select * from (values
    ('private.haiku_libro_pago_distribuido_v1(uuid,jsonb,jsonb,boolean)','a7a602f3a1cdbddbde166046c1d576bf',false),
    ('private.haiku_libro_pago_grupo_distribuido_v1(uuid,jsonb,jsonb,boolean)','8ef5d17a95a6e91638cd7d0411a43596',false),
    ('private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean)','de74c864d9e72ffadb4df0e5807cddc2',false),
    ('private.haiku_libro_actualizar_v1(jsonb)','e36fe60c3ec1602ad4dec0a0f8ec1679',false),
    ('public.haiku_incorporar_pago_servicios_libro_v1(uuid,jsonb)','d424a8b1e54882d4700174b69645b7ac',true)
  ) auditado(firma,huella,definer) loop
    select p.*,l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=to_regprocedure(f.firma);
    if not found or actual.prokind<>'f' or actual.lanname<>'plpgsql'
      or actual.prorettype<>'jsonb'::regtype or actual.proretset or actual.proisstrict
      or actual.pronargdefaults<>0 or actual.proargmodes is not null
      or actual.provolatile<>'v' or actual.proparallel<>'u'
      or actual.proargnames is distinct from (case
        when actual.proname='haiku_libro_actualizar_v1' then array['p_item']
        when actual.proname='haiku_incorporar_pago_servicios_libro_v1' then array['p_operacion_id','p_item']
        else array['p_reserva_id','p_argumentos','p_origen','p_manual'] end)
      or actual.prosecdef is distinct from f.definer
      or regexp_replace(array_to_string(actual.proconfig,','),'\s','','g') is distinct from 'search_path=pg_catalog,public,private'
      or md5(replace(actual.prosrc,E'\r','')) is distinct from f.huella then
      raise exception 'Definicion auditada inesperada en %; revisar antes de aplicar Airbnb',f.firma;
    end if;
    if exists(select 1 from pg_proc p where p.pronamespace=actual.pronamespace
      and p.proname=actual.proname and p.oid<>actual.oid) then
      raise exception 'Sobrecarga no auditada en %; revisar antes de aplicar Airbnb',f.firma;
    end if;
  end loop;

  for f in
    select p.*, n.nspname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname=any(array[
      'haiku_registrar_pago','haiku_registrar_pago_grupo',
      'haiku_registrar_pago_checkin','haiku_registrar_pago_checkin_v2',
      'haiku_registrar_pago_checkin_grupo','haiku_registrar_pago_checkout',
      'haiku_crear_reserva_con_abonos',
      'haiku_registrar_abonos_reserva_existente_asistente',
      'haiku_editar_pago_confirmado_saldo','haiku_corregir_abono',
      'haiku_corregir_abono_saldo_favor','haiku_incorporar_libro_v1',
      'haiku_incorporar_pago_servicios_libro_v1'
    ])) or (n.nspname='private' and p.proname=any(array[
      'haiku_libro_actualizar_v1','haiku_libro_pago_distribuido_v1',
      'haiku_libro_pago_grupo_distribuido_v1','haiku_libro_pago_servicios_v1'
    ]))
  loop
    vistos := array_append(vistos,f.proname);
    original := pg_get_functiondef(f.oid);
    nuevo := original;
    if f.proname in ('haiku_libro_actualizar_v1','haiku_libro_pago_distribuido_v1',
      'haiku_libro_pago_grupo_distribuido_v1','haiku_libro_pago_servicios_v1',
      'haiku_incorporar_pago_servicios_libro_v1') then
      nuevo := replace(nuevo,E'\r','');
    end if;

    if f.proname='haiku_registrar_pago' then
      if not array['p_medio_pago','p_folio','p_codigo_autorizacion','p_bove'] <@ coalesce(f.proargnames,array[]::text[])
        or nuevo !~* E'\n[ \t]*begin[ \t]*\r?\n' then
        raise exception 'Contrato del writer base inesperado; revisar antes de ampliar';
      end if;
      nuevo := regexp_replace(nuevo,E'(\n[ \t]*begin[ \t]*\r?\n)',
        '\1'||E'  if p_medio_pago=''airbnb_prepaid_card'' then\n    p_folio:=null; p_codigo_autorizacion:=null; p_bove:=null;\n  end if;\n','i');
    end if;

    if f.proname='haiku_incorporar_libro_v1' then
      -- Transbank identifiers are not authority for an Airbnb transaction.
      -- Keep existing manual approval and operation/origin idempotency guards.
      if nuevo !~ 'v_fuerte := v_codaut is not null or v_bove is not null or \(v_folio is not null and v_bovtar is not null\);' then
        raise exception 'Contrato de identidad Libro inesperado; revisar antes de ampliar';
      end if;
      nuevo := replace(nuevo,
        'v_fuerte := v_codaut is not null or v_bove is not null or (v_folio is not null and v_bovtar is not null);',
        'v_fuerte := v_codaut is not null or v_bove is not null or (v_folio is not null and v_bovtar is not null);'||
        E'\n    if v_medio=''airbnb_prepaid_card'' then\n'||
        E'      v_fuerte:=false; v_folio:=null; v_codaut:=null; v_bovtar:=null; v_bove:=null;\n'||
        E'      v_argumentos:=v_argumentos||jsonb_build_object(''p_folio'',null,''p_codigo_autorizacion'',null,''p_bove'',null);\n'||
        E'      v_origen:=v_origen-array[''folio'',''codigo_autorizacion'',''bovtar'',''bove''];\n    end if;');
    end if;

    if f.proname in ('haiku_libro_pago_distribuido_v1','haiku_libro_pago_grupo_distribuido_v1') then
      -- Both helpers already require p_manual=true and all reviewed components.
      -- The upper RPC owns the item/operation duplicate check under reservation lock.
      nuevo := replace(nuevo,
        E'  if nullif(btrim(p_argumentos->>''p_codigo_autorizacion''),'''') is null and',
        E'  if p_argumentos->>''p_medio_pago'' is distinct from ''airbnb_prepaid_card'' and\n'||
        E'     nullif(btrim(p_argumentos->>''p_codigo_autorizacion''),'''') is null and');
      -- Clean local inputs too, including a private invocation by another protected writer.
      nuevo := replace(nuevo,
        E'  if p_argumentos->>''p_medio_pago'' is distinct from ''airbnb_prepaid_card'' and',
        E'  if p_argumentos->>''p_medio_pago''=''airbnb_prepaid_card'' then\n'||
        E'    if p_manual is distinct from true or nullif(btrim(p_argumentos->>''p_fecha_pago''),'''') is null then\n'||
        E'      raise exception ''Airbnb requiere aprobacion manual y fecha real del pago'';\n    end if;\n'||
        E'    p_argumentos:=p_argumentos||jsonb_build_object(''p_folio'',null,''p_codigo_autorizacion'',null,''p_bove'',null);\n'||
        E'    p_origen:=p_origen-array[''folio'',''codigo_autorizacion'',''bovtar'',''bove''];\n  end if;\n'||
        E'  if p_argumentos->>''p_medio_pago'' is distinct from ''airbnb_prepaid_card'' and');
    end if;

    if f.proname='haiku_incorporar_pago_servicios_libro_v1' then
      -- Bind identity to the RPC item; do not trust a different nested item_id.
      nuevo := replace(nuevo,
        '  v_pago:=private.haiku_libro_pago_servicios_v1(v_reserva,v_argumentos,v_origen,v_manual);',
        E'  if v_argumentos->>''p_medio_pago''=''airbnb_prepaid_card'' then\n'||
        E'    if v_manual is distinct from true or jsonb_typeof(p_item->''item_id'') is distinct from ''string''\n'||
        E'      or nullif(btrim(p_item->>''item_id''),'''') is null then\n'||
        E'      raise exception ''Airbnb requiere aprobacion manual e identidad estable del Libro'';\n    end if;\n'||
        E'    v_argumentos:=v_argumentos||jsonb_build_object(''p_folio'',null,''p_codigo_autorizacion'',null,''p_bove'',null);\n'||
        E'    v_origen:=(v_origen-array[''folio'',''codigo_autorizacion'',''bovtar'',''bove''])\n'||
        E'      ||jsonb_build_object(''item_id'',btrim(p_item->>''item_id''));\n  end if;\n'||
        '  v_pago:=private.haiku_libro_pago_servicios_v1(v_reserva,v_argumentos,v_origen,v_manual);');
    end if;

    if f.proname='haiku_libro_pago_servicios_v1' then
      nuevo := replace(nuevo,'  codaut_norm:=nullif(',
        E'  if p_argumentos->>''p_medio_pago''=''airbnb_prepaid_card'' then\n'||
        E'    if nullif(btrim(p_origen->>''item_id''),'''') is null\n'||
        E'      or jsonb_typeof(p_origen->''item_id'') is distinct from ''string''\n'||
        E'      or jsonb_typeof(p_origen->''origen'') is distinct from ''object''\n'||
        E'      or jsonb_typeof(p_origen->''origen''->''hoja'') is distinct from ''string''\n'||
        E'      or jsonb_typeof(p_origen->''origen''->''celda'') is distinct from ''string''\n'||
        E'      or nullif(btrim(p_origen->''origen''->>''hoja''),'''') is null\n'||
        E'      or nullif(btrim(p_origen->''origen''->>''celda''),'''') is null\n'||
        E'      or nullif(btrim(p_argumentos->>''p_fecha_pago''),'''') is null then\n'||
        E'      raise exception ''Airbnb requiere item/origen estable del Libro y fecha real'';\n    end if;\n'||
        E'    codaut:=null; folio:=null; argumento_bove:=null; bovtar:=null;\n  end if;\n'||
        '  codaut_norm:=nullif(');
      nuevo := replace(nuevo,'  if codaut_norm is null and (folio_norm is null or bovtar_norm is null) then',
        E'  if p_argumentos->>''p_medio_pago'' is distinct from ''airbnb_prepaid_card''\n'||
        '     and codaut_norm is null and (folio_norm is null or bovtar_norm is null) then');
      nuevo := replace(nuevo,E'    select token from unnest(array[\n',
        E'    select token from unnest(array[\n'||
        E'      case when p_argumentos->>''p_medio_pago''=''airbnb_prepaid_card'' then ''libro_item:''||btrim(p_origen->>''item_id'') end,\n'||
        E'      case when p_argumentos->>''p_medio_pago''=''airbnb_prepaid_card'' then ''libro_origen:''||\n'||
        E'        jsonb_build_array(p_reserva_id,btrim(p_origen->''origen''->>''hoja''),btrim(p_origen->''origen''->>''celda''))::text end,\n');
      nuevo := replace(nuevo,
        E'    where p.tipo_movimiento=''pago'' and p.estado=''confirmado'' and (',
        E'    where p.tipo_movimiento=''pago''\n'||
        E'      and (p.estado=''confirmado'' or p_argumentos->>''p_medio_pago''=''airbnb_prepaid_card'') and (\n'||
        E'      (p_argumentos->>''p_medio_pago''=''airbnb_prepaid_card'' and (\n'||
        E'        btrim(p.datos_origen->>''item_id'')=btrim(p_origen->>''item_id'') or (\n'||
        E'          p.reserva_id=p_reserva_id and p.medio_pago=''airbnb_prepaid_card''\n'||
        E'          and btrim(p.datos_origen->''origen_libro''->>''hoja'')=btrim(p_origen->''origen''->>''hoja'')\n'||
        E'          and btrim(p.datos_origen->''origen_libro''->>''celda'')=btrim(p_origen->''origen''->>''celda'')\n'||
        E'        ))) or');
      nuevo := replace(nuevo,
        E'    return jsonb_build_object(''ya_existe'',true,''pago_id'',pago_existente,',
        E'    if p_argumentos->>''p_medio_pago''=''airbnb_prepaid_card'' and exists (\n'||
        E'      select 1 from public.pagos p where p.id=pago_existente and (\n'||
        E'        p.estado is distinct from ''confirmado'' or p.medio_pago is distinct from ''airbnb_prepaid_card''\n'||
        E'        or p.monto is distinct from monto_total\n'||
        E'        or p.moneda is distinct from ''CLP'' or p.fecha_pago is distinct from (p_argumentos->>''p_fecha_pago'')::timestamptz\n'||
        E'        or p.referencia_externa is distinct from nullif(btrim(p_argumentos->>''p_referencia_externa''),'''')\n'||
        E'        or btrim(p.datos_origen->''origen_libro''->>''hoja'') is distinct from btrim(p_origen->''origen''->>''hoja'')\n'||
        E'        or btrim(p.datos_origen->''origen_libro''->>''celda'') is distinct from btrim(p_origen->''origen''->>''celda'')\n'||
        E'        or p.datos_origen->''aplicaciones_servicio_v1'' is distinct from d\n'||
        E'      )) then\n      raise exception ''El item/origen Airbnb ya existe con datos distintos; vuelve a revisar'';\n    end if;\n'||
        E'    return jsonb_build_object(''ya_existe'',true,''pago_id'',pago_existente,');
    end if;

    if f.proname='haiku_libro_actualizar_v1' then
      -- Validate the original reviewed patch first. Normalize the resulting record
      -- before any UPDATE; retain historical identifiers only inside the audit snapshot.
      nuevo := replace(nuevo,
        E'    if v_np.monto<=0 or v_np.moneda<>''CLP''',
        E'    if v_np.medio_pago=''airbnb_prepaid_card'' then\n'||
        E'      v_np.folio:=null; v_np.codigo_autorizacion:=null; v_np.bove:=null;\n'||
        E'      v_np.referencia_externa:=case when v_patch ? ''referencia_externa'' then nullif(btrim(v_patch->>''referencia_externa''),'''')\n'||
        E'        when v_p.medio_pago=''airbnb_prepaid_card'' then nullif(btrim(v_p.referencia_externa),'''') else null end;\n'||
        E'      v_patch:=v_patch||jsonb_build_object(''bovtar'',null);\n    end if;\n'||
        E'    if v_np.monto<=0 or v_np.moneda<>''CLP''');
      nuevo := replace(nuevo,
        E'      datos_origen=coalesce(v_p.datos_origen,''{}''::jsonb)||',
        E'      datos_origen=(case when v_np.medio_pago=''airbnb_prepaid_card''\n'||
        E'        then coalesce(v_p.datos_origen,''{}''::jsonb)-array[''folio'',''bovtar'',''bove'',''codigo_autorizacion'']\n'||
        E'        else coalesce(v_p.datos_origen,''{}''::jsonb) end)||');
    end if;

    -- Only admission whitelists containing ALL six general methods. Never
    -- expand the two-method WebPay branches or checks for card identifiers.
    for lista in select regexp_matches(nuevo,
      '((?:p_medio_pago|v_medio)\s+not\s+in\s*\()([^)]*)(\))','gi')
    loop
      if lista[2] ~ '''transferencia''' and lista[2] ~ '''efectivo'''
        and lista[2] ~ '''webpay_credito''' and lista[2] ~ '''webpay_debito'''
        and lista[2] ~ '''tarjeta_credito''' and lista[2] ~ '''tarjeta_debito'''
        and lista[2] !~ '''airbnb_prepaid_card''' then
        nuevo := replace(nuevo,lista[1]||lista[2]||lista[3],
          lista[1]||lista[2]||',''airbnb_prepaid_card'''||lista[3]);
      elsif lista[2] ~ '''transferencia''' and lista[2] !~ '''airbnb_prepaid_card''' then
        raise exception 'Whitelist general inesperada en %.%; revisar antes de ampliar',f.nspname,f.proname;
      end if;
    end loop;

    -- Check-in/out and confirmed edits normalize unrelated card identifiers.
    -- The new branch preserves the caller's optional, trimmed v_glosa, while
    -- the original transfer/card/WebPay/other branches remain byte-for-byte.
    if 'p_medio_pago'=any(coalesce(f.proargnames,array[]::text[]))
      and nuevo ~* 'else\s+v_glosa\s*:=\s*null;'
      and nuevo !~ 'p_medio_pago\s*=\s*''airbnb_prepaid_card''' then
      campos := '';
      if nuevo ~ '\mv_folio\M' then campos := campos||'v_folio := null; '; end if;
      if nuevo ~ '\mv_bovtar\M' then campos := campos||'v_bovtar := null; '; end if;
      if nuevo ~ '\mv_codaut\M' then campos := campos||'v_codaut := null; '; end if;
      nuevo := regexp_replace(nuevo,'else(\s+v_glosa\s*:=\s*null;)',
        'elsif p_medio_pago = ''airbnb_prepaid_card'' then '||campos||E'\n  else'||'\1','gi');
    end if;
    if f.proname in ('haiku_registrar_pago_checkin','haiku_registrar_pago_checkin_v2',
      'haiku_registrar_pago_checkin_grupo','haiku_registrar_pago_checkout','haiku_editar_pago_confirmado_saldo')
      and original ~* 'v_glosa\s*:=\s*null;'
      and nuevo !~ 'p_medio_pago\s*=\s*''airbnb_prepaid_card''' then
      raise exception 'Normalizacion de referencia inesperada en %; revisar antes de aplicar',f.proname;
    end if;

    if f.proname in ('haiku_crear_reserva_con_abonos',
      'haiku_registrar_abonos_reserva_existente_asistente') then
      -- Same JSON/glosa contract, with optional referencia_externa accepted
      -- only for Airbnb. Existing methods keep their exact extraction rules.
      nuevo := regexp_replace(nuevo,
        '(v_glosa\s*:=\s*)nullif\(btrim\(coalesce\(v_item\s*->>\s*''glosa'',\s*''''\)\),\s*''''\)',
        '\1case when v_medio=''airbnb_prepaid_card'' then coalesce(nullif(btrim(v_item->>''referencia_externa''),''''),nullif(btrim(v_item->>''glosa''),'''')) else nullif(btrim(coalesce(v_item->>''glosa'','''')) ,'''') end','gi');
      nuevo := regexp_replace(nuevo,
        '(case\s+when\s+)v_medio\s*=\s*''transferencia''(\s+then\s+v_glosa\s+else\s+null\s+end)',
        '\1v_medio in (''transferencia'',''airbnb_prepaid_card'')\2','gi');
      if f.proname='haiku_crear_reserva_con_abonos' then
        if nuevo !~ 'p_referencia_externa\s*=>\s*null' then
          raise exception 'Contrato de referencia inesperado en %',f.proname;
        end if;
        nuevo := regexp_replace(nuevo,'p_referencia_externa\s*=>\s*null',
          'p_referencia_externa => case when v_medio=''airbnb_prepaid_card'' then v_glosa else null end','gi');
        nuevo := replace(nuevo,
          'when v_medio = ''efectivo'' then ''Efectivo confirmado desde asistente HAIKU''',
          'when v_medio = ''airbnb_prepaid_card'' then ''Airbnb Prepaid Card confirmado desde asistente HAIKU'' '||
          'when v_medio = ''efectivo'' then ''Efectivo confirmado desde asistente HAIKU''');
      end if;
    end if;

    if nuevo is distinct from original then
      execute nuevo;
      select * into actual from pg_proc where oid=f.oid;
      if actual.prosecdef is distinct from f.prosecdef
        or actual.proconfig is distinct from f.proconfig
        or actual.proacl is distinct from f.proacl
        or actual.proowner is distinct from f.proowner then
        raise exception 'La ampliacion debe conservar seguridad, search_path y ACL de %.%',f.nspname,f.proname;
      end if;
    end if;
  end loop;

  -- Detect additional deployed general admission lists rather than silently
  -- leaving a payment writer unsupported. No unknown RPC is rewritten.
  for f in select p.proname,n.nspname,p.prosrc from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f'
  loop
    for lista in select regexp_matches(f.prosrc,
      '([[:alnum:]_]+\s+not\s+in\s*\()([^)]*)(\))','gi')
    loop
      if lista[2] ~ '''transferencia''' and lista[2] ~ '''efectivo'''
        and lista[2] ~ '''webpay_credito''' and lista[2] ~ '''webpay_debito'''
        and lista[2] ~ '''tarjeta_credito''' and lista[2] ~ '''tarjeta_debito'''
        and lista[2] !~ '''airbnb_prepaid_card''' then
        raise exception 'Whitelist general aun sin Airbnb en %.%; revisar ese contrato antes de aplicar',f.nspname,f.proname;
      end if;
    end loop;
  end loop;

  foreach nombre in array array['haiku_registrar_pago_checkin_v2',
    'haiku_registrar_pago_checkout','haiku_crear_reserva_con_abonos',
    'haiku_registrar_abonos_reserva_existente_asistente',
    'haiku_editar_pago_confirmado_saldo','haiku_incorporar_libro_v1',
    'haiku_incorporar_pago_servicios_libro_v1','haiku_libro_actualizar_v1',
    'haiku_libro_pago_distribuido_v1','haiku_libro_pago_grupo_distribuido_v1',
    'haiku_libro_pago_servicios_v1'] loop
    if not nombre=any(vistos) then
      raise exception 'Falta RPC esperado %; revisar el contrato antes de aplicar',nombre;
    end if;
  end loop;
end;
$migration$;

commit;
