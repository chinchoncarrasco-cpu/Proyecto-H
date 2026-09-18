-- El Libro puede corregir el titular de una reserva mientras el detalle del
-- comprobante todavía conserva el nombre anterior. Se validan ambas identidades
-- por separado dentro de la misma operación atómica.
do $migration$
declare
  cuerpo text := replace(pg_get_functiondef('private.haiku_libro_pago_grupo_distribuido_v1(uuid,jsonb,jsonb,boolean)'::regprocedure),E'\r','');
  anterior text := E'       or regexp_replace(translate(lower(parte->>''titular''),''áéíóúüñ'',''aeiouun''),''[^a-z0-9]'','''',''g'')\n          is distinct from regexp_replace(translate(lower(titular),''áéíóúüñ'',''aeiouun''),''[^a-z0-9]'','''',''g'') then';
  nuevo text := E'       or regexp_replace(translate(lower(parte->>''titular_reserva''),''áéíóúüñ'',''aeiouun''),''[^a-z0-9]'','''',''g'')\n          is distinct from regexp_replace(translate(lower(titular),''áéíóúüñ'',''aeiouun''),''[^a-z0-9]'','''',''g'')\n       or regexp_replace(translate(lower(parte->>''titular''),''áéíóúüñ'',''aeiouun''),''[^a-z0-9]'','''',''g'')\n          is distinct from regexp_replace(translate(lower(d->>''titular_pago''),''áéíóúüñ'',''aeiouun''),''[^a-z0-9]'','''',''g'') then';
begin
  if position('titular_reserva' in cuerpo)>0 and position('titular_pago' in cuerpo)>0 then return; end if;
  if position(anterior in cuerpo)=0 then
    raise exception 'El helper de comprobante grupal cambió; revisar la migración antes de aplicar';
  end if;
  cuerpo := replace(cuerpo,anterior,nuevo);
  execute cuerpo;
end;
$migration$;
