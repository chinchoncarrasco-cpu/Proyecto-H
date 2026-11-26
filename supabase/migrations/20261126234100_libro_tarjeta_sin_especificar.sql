begin;

do $migration$
declare
  definicion text := pg_get_functiondef('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure);
  antes constant text := 'if v_medio not in (''transferencia'', ''webpay_credito'', ''webpay_debito'', ''tarjeta_credito'', ''tarjeta_debito'', ''efectivo'',''airbnb_prepaid_card'') then';
  despues constant text := replace(antes, '''tarjeta_debito'',', '''tarjeta_debito'', ''tarjeta_sin_especificar'',');
begin
  if strpos(definicion, despues) > 0 then return; end if;
  if strpos(definicion, antes) = 0 or
    strpos(substr(definicion, strpos(definicion, antes) + length(antes)), antes) > 0 then
    raise exception 'Lista de medios inesperada en haiku_incorporar_libro_v1';
  end if;
  execute replace(definicion, antes, despues);
end;
$migration$;

commit;
