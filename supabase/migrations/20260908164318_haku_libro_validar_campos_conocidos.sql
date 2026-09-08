
-- Missing Libro occupation does not prevent an unrelated passport correction.
-- The column permits zero (unknown); explicitly provided invalid counts are
-- rejected in the preview and negative stored values remain prohibited.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.haiku_libro_actualizar_v1(jsonb)'::regprocedure);
 if position('if v_ne.adultos<1 or v_ne.ninos<0' in definition)>0 then
   execute replace(definition,'if v_ne.adultos<1 or v_ne.ninos<0','if v_ne.adultos<0 or v_ne.ninos<0');
 elsif position('if v_ne.adultos<0 or v_ne.ninos<0' in definition)=0 then
   raise exception 'La función de actualización cambió; revisar antes de aplicar';
 end if;
end;
$migration$;
