begin;

alter table public.pagos drop constraint pagos_medio_pago_valido;
alter table public.pagos add constraint pagos_medio_pago_valido check (
  medio_pago in ('transferencia','webpay_credito','webpay_debito',
    'tarjeta_credito','tarjeta_debito','tarjeta_sin_especificar',
    'efectivo','otro','airbnb_prepaid_card')
);

do $migration$
declare
  ruta record;
  fn record;
  definicion text;
  pos constant text := '(''tarjeta_credito'',[[:space:]]*''tarjeta_debito'')';
begin
  -- Ampliar las listas de admisión y las ramas que conservan Folio/BOVTAR.
  -- Los writers generales y de servicios usan el CHECK y sus propias guardas de identidad.
  for ruta in select * from (values
    ('private.haiku_libro_medio_pago_manual_validar_v1(jsonb,jsonb,boolean)',1),
    ('private.haiku_libro_pago_alojamiento_verificado_v1(uuid,jsonb,jsonb,boolean)',1),
    ('private.haiku_pago_asistente_impl_v1(uuid,timestamptz,text,jsonb,text)',1),
    ('public.haiku_crear_reserva_con_abonos(text,smallint,date,date,smallint,smallint,smallint,text,text,text,jsonb,jsonb,text,jsonb)',7),
    ('public.haiku_editar_pago_confirmado_saldo(uuid,text,text,text,text,text)',2),
    ('public.haiku_registrar_abonos_reserva_existente_asistente(uuid,jsonb)',6),
    ('public.haiku_registrar_pago_checkin(uuid,bigint,text,text,text,text,boolean)',2),
    ('public.haiku_registrar_pago_checkin_grupo(uuid,bigint,text,text,text,text,boolean)',2),
    ('public.haiku_registrar_pago_checkin_v2(uuid,bigint,text,text,text,text,text,boolean)',2),
    ('public.haiku_registrar_pago_checkout(uuid,bigint,text,text,text,text,boolean)',2)
  ) as contrato(firma, listas) loop
    select p.oid, p.prosrc into strict fn from pg_proc p where p.oid = ruta.firma::regprocedure;
    if (select count(*) from regexp_matches(fn.prosrc, pos, 'g')) <> ruta.listas then
      raise exception 'Listas de medios inesperadas en %', ruta.firma;
    end if;

    if (select count(*) from regexp_matches(fn.prosrc, pos || ',[[:space:]]*''tarjeta_sin_especificar''', 'g')) = ruta.listas then
      continue;
    end if;
    if strpos(fn.prosrc, '''tarjeta_sin_especificar''') > 0 then
      raise exception 'Ampliación parcial del medio de pago en %', ruta.firma;
    end if;

    definicion := regexp_replace(pg_get_functiondef(fn.oid), pos,
      '\1,''tarjeta_sin_especificar''', 'g');
    -- Estos dos RPC conservan el nombre histórico del argumento de entrada.
    -- Guardar la autorización del POS en BOVTAR para el nuevo medio.
    if ruta.firma in (
      'public.haiku_registrar_pago_checkin(uuid,bigint,text,text,text,text,boolean)',
      'public.haiku_registrar_pago_checkin_grupo(uuid,bigint,text,text,text,text,boolean)'
    ) then
      if definicion !~ 'p_codigo_autorizacion => v_codaut,[[:space:]]*p_bove => null,' then
        raise exception 'Argumentos del voucher inesperados en %', ruta.firma;
      end if;
      definicion := regexp_replace(definicion,
        'p_codigo_autorizacion => v_codaut,([[:space:]]*)p_bove => null,',
        'p_codigo_autorizacion => case when p_medio_pago <> ''tarjeta_sin_especificar'' then v_codaut end,\1p_bove => case when p_medio_pago = ''tarjeta_sin_especificar'' then v_codaut end,');
    elsif ruta.firma = 'public.haiku_registrar_pago_checkout(uuid,bigint,text,text,text,text,boolean)' then
      if definicion !~ 'v_folio,[[:space:]]*v_codaut,[[:space:]]*v_glosa,' then
        raise exception 'Argumentos del voucher inesperados en %', ruta.firma;
      end if;
      definicion := regexp_replace(definicion,
        'v_folio,([[:space:]]*)v_codaut,([[:space:]]*)v_glosa,',
        'v_folio,\1case when p_medio_pago <> ''tarjeta_sin_especificar'' then v_codaut end,\2v_glosa,');
      definicion := replace(definicion,
        'jsonb_build_object(''contexto'',''checkout'',''manager_revisado'',true),',
        'jsonb_build_object(''contexto'',''checkout'',''manager_revisado'',true) || case when p_medio_pago = ''tarjeta_sin_especificar'' then jsonb_build_object(''bovtar'',v_codaut) else ''{}''::jsonb end,');
    end if;
    execute definicion;
  end loop;
end;
$migration$;

commit;
