-- Sólo definiciones: no incorpora pagos ni modifica registros históricos.
-- Baseline cotejado por SELECT. Aborta atómicamente si cambió alguna función.
begin;
set local lock_timeout='5s';
do $patch$
declare firma text; esperado text; f record; antes jsonb; despues jsonb;
  def text; ancla text; writer_hash text; validador_hash text;
  firmas text[]:=array[
    'private.haiku_libro_transferencia_validar_v2(uuid,jsonb,jsonb,boolean)',
    'public.haiku_incorporar_libro_v1(uuid,jsonb)',
    'public.haiku_libro_transferencias_capacidad_v2()'];
begin
  for firma,esperado in select * from (values
    (firmas[1],'8f7b3cb53ea7a4a64354890b280812c1'),
    (firmas[2],'6b3ffdc6e8ce5b376eb3df7a00d1ad2c'),
    (firmas[3],'54aa5878d74a868adf9fa5aac1ac06ea')
  ) v(firma,esperado) loop
    select * into f from pg_proc where oid=to_regprocedure(firma);
    if not found or md5(replace(f.prosrc,chr(13),'')) is distinct from esperado
      or f.proowner<>'postgres'::regrole then
      raise exception 'Definición distinta del baseline revisado: %',firma;
    end if;
  end loop;
  select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl::text,p.prosecdef,p.proconfig) order by p.oid)
    into antes from pg_proc p where p.oid in (select to_regprocedure(unnest(firmas)));

  select pg_get_functiondef(to_regprocedure(firmas[1])) into def;
  ancla:=$old$    or nullif(o#>>'{pagador,nombre}','') is null$old$;
  if (length(def)-length(replace(def,ancla,'')))/length(ancla)<>1 then raise exception 'Ancla de nombre inesperada'; end if;
  def:=replace(def,ancla,$new$    or (nullif(o#>>'{pagador,nombre}','') is null and
      (regexp_match(btrim(e->>'glosa_original'),
        '^(?:transf(?:erencia)?\.?\s+)?([0-9]{7,12}[kK]?)(?:\s+transf(?:erencia)?\.?)?$', 'i'))[1]
        is distinct from e->>'numero_remitente')$new$);
  ancla:=$old$    or position(o#>>'{pagador,nombre}' in e->>'glosa_original')=0$old$;
  if (length(def)-length(replace(def,ancla,'')))/length(ancla)<>1 then raise exception 'Ancla de glosa inesperada'; end if;
  def:=replace(def,ancla,$new$    or (nullif(o#>>'{pagador,nombre}','') is not null and
      position(o#>>'{pagador,nombre}' in e->>'glosa_original')=0)$new$);
  execute def;

  select pg_get_functiondef(to_regprocedure(firmas[2])) into def;
  ancla:=$old$set pagador_nombre = coalesce(case when v_medio='transferencia' and v_origen#>>'{evidencia_transferencia,version}'='2' then v_origen#>>'{pagador,nombre}' end, (select r.titular_nombre from public.reservas r where r.id = v_reserva_id), pagador_nombre),$old$;
  if (length(def)-length(replace(def,ancla,'')))/length(ancla)<>1 then raise exception 'Ancla de pagador inesperada'; end if;
  def:=replace(def,ancla,$new$set pagador_nombre = case when v_medio='transferencia' and v_origen#>>'{evidencia_transferencia,version}'='2'
          then nullif(v_origen#>>'{pagador,nombre}','')
          else coalesce((select r.titular_nombre from public.reservas r where r.id = v_reserva_id), pagador_nombre) end,$new$);
  execute def;

  select md5(replace(prosrc,chr(13),'')) into writer_hash from pg_proc where oid=to_regprocedure(firmas[2]);
  select md5(replace(prosrc,chr(13),'')) into validador_hash from pg_proc where oid=to_regprocedure(firmas[1]);
  -- Los clientes anteriores conservan v2. El nuevo caso sólo se anuncia si
  -- writer y validador siguen siendo exactamente los que soportan nombre nulo.
  execute format($ddl$create or replace function public.haiku_libro_transferencias_capacidad_v2() returns jsonb
    language sql stable security invoker set search_path=pg_catalog,public as $body$
    select jsonb_build_object('version',2,
      'confirmacion_final',md5(replace(prosrc,chr(13),''))=%L,
      'glosa_sin_nombre',md5(replace(prosrc,chr(13),''))=%L and
        (select md5(replace(prosrc,chr(13),''))=%L from pg_proc
          where oid='private.haiku_libro_transferencia_validar_v2(uuid,jsonb,jsonb,boolean)'::regprocedure))
    from pg_proc where oid='public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure $body$$ddl$,
    writer_hash,writer_hash,validador_hash);

  select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl::text,p.prosecdef,p.proconfig) order by p.oid)
    into despues from pg_proc p where p.oid in (select to_regprocedure(unnest(firmas)));
  if antes is distinct from despues then raise exception 'Cambió la identidad o los permisos de las funciones'; end if;
end;
$patch$;
commit;
