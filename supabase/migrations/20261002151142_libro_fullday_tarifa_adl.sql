-- Solo incorporacion del Libro: 60000 CLP por ADL, minimo real de 2 ADL.
-- No aplicar al remoto en esta tarea. No altera el creador general ni pagos.
begin;

create or replace function private.haiku_libro_tarifa_fullday_adl(p_adultos jsonb)
returns bigint language plpgsql immutable
set search_path = pg_catalog
as $function$
declare
  v_adultos numeric;
begin
  if jsonb_typeof(p_adultos) is distinct from 'number' then
    raise exception 'Full Day del Libro requiere una cantidad explicita de ADL';
  end if;
  v_adultos := (p_adultos #>> '{}')::numeric;
  if v_adultos <> trunc(v_adultos) or v_adultos < 2 or v_adultos > 32767 then
    raise exception 'Full Day del Libro requiere al menos 2 ADL validos; los ninos no cuentan';
  end if;
  return v_adultos::bigint * 60000;
end;
$function$;
revoke all on function private.haiku_libro_tarifa_fullday_adl(jsonb) from public, anon, authenticated;

-- Parche acotado con guardas: conserva las revisiones posteriores de pagos,
-- permisos, idempotencia, owner, ACL y SECURITY de las funciones existentes.
do $migration$
declare
  v_signature regprocedure;
  v_before text;
  v_after text;
  v_old text;
  v_new text;
begin
  for v_signature, v_old, v_new in
    select * from (values
      ('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure,
       $old$p_tarifas => '{}'::jsonb,$old$,
       $new$p_tarifas => case when lower(v_datos ->> 'tipo_estadia') = 'fullday'
        then jsonb_build_object(v_datos ->> 'fecha_ingreso',
          private.haiku_libro_tarifa_fullday_adl(v_datos -> 'adultos'))
        else '{}'::jsonb end,$new$),
      ('private.haiku_libro_agregar_estadia_v1(uuid,jsonb)'::regprocedure,
       $old$  if coalesce(v_precio_base, 0) <= 0 then$old$,
       $new$  if v_tipo = 'fullday' then
    v_precio_base := private.haiku_libro_tarifa_fullday_adl(p_estadia -> 'datos' -> 'adultos');
  end if;
  if coalesce(v_precio_base, 0) <= 0 then$new$)
    ) as patches(signature, old_text, new_text)
  loop
    v_before := pg_get_functiondef(v_signature);
    if position(v_new in v_before) > 0 then continue; end if;
    if (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'Migration Full Day detenida: cuerpo inesperado de %; revisar localmente', v_signature;
    end if;
    v_after := replace(v_before, v_old, v_new);
    execute v_after;
  end loop;
end;
$migration$;

commit;
