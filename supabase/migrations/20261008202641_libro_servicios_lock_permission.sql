-- Incremental sobre 20261007225155: los dos callers INVOKER calculan la
-- misma llave que el registrar sin abrir el helper privado ni elevar privilegios.
begin;

do $migration$
declare
  llave pg_proc%rowtype;
  f pg_proc%rowtype;
  despues pg_proc%rowtype;
  destino record;
  original text;
  nuevo text;
begin
  select * into llave from pg_proc
    where oid=to_regprocedure('private.haiku_libro_lock_key_v1(text,text)');
  if not found or has_function_privilege('authenticated',llave.oid,'EXECUTE')
    or has_function_privilege('anon',llave.oid,'EXECUTE') then
    raise exception 'Contrato inesperado del helper de locks: debe permanecer privado';
  end if;
  -- Fallar cerrado si la fórmula registrada cambió: todos los writers deben
  -- coordinarse con exactamente la misma llave, incluidos los triggers existentes.
  if regexp_replace(llave.prosrc,'[[:space:];]','','g') is distinct from
    $key$select('x'||substr(md5(coalesce(p_scope,'')||':'||coalesce(p_value,'')),1,16))::bit(64)::bigint$key$ then
    raise exception 'La fórmula del lock cambió; revisar antes de aplicar';
  end if;

  for destino in select * from (values
    ('public.haiku_importar_servicios_libro_v1(uuid,jsonb)',
      $old$private.haiku_libro_lock_key_v1('reserva_finanzas', orden.reserva)$old$,
      $new$('x'||pg_catalog.substr(pg_catalog.md5('reserva_finanzas:'||coalesce(orden.reserva,'')),1,16))::bit(64)::bigint$new$),
    ('private.haiku_libro_servicio_manual_validar_v1(jsonb)',
      $old$private.haiku_libro_lock_key_v1('reserva_finanzas',p_item->>'reserva_id')$old$,
      $new$('x'||pg_catalog.substr(pg_catalog.md5('reserva_finanzas:'||coalesce(p_item->>'reserva_id','')),1,16))::bit(64)::bigint$new$)
  ) cambios(firma,marcador,reemplazo)
  loop
    select * into f from pg_proc where oid=to_regprocedure(destino.firma);
    if not found then raise exception 'Falta el caller de servicios: %',destino.firma; end if;
    original := pg_get_functiondef(f.oid);
    if f.prosecdef is distinct from false or f.proowner <> 'postgres'::regrole
      or (length(original)-length(replace(original,destino.marcador,'')))/length(destino.marcador)<>1
      or position('auth.uid()' in f.prosrc)=0
      or position('private.haiku_usuario_activo()' in f.prosrc)=0
      or position('private.haiku_tiene_permiso(''servicios.crear'')' in f.prosrc)=0 then
      raise exception 'Contrato inesperado del caller de servicios: %',destino.firma;
    end if;
    nuevo := replace(original,destino.marcador,destino.reemplazo);
    execute nuevo;
    select * into despues from pg_proc where oid=f.oid;
    if despues.proacl is distinct from f.proacl or despues.proowner is distinct from f.proowner
      or despues.prosecdef is distinct from f.prosecdef or despues.proconfig is distinct from f.proconfig
      or despues.prosrc is distinct from replace(f.prosrc,destino.marcador,destino.reemplazo) then
      raise exception 'El caller debe conservar ACL, owner, seguridad, search_path y resto del cuerpo: %',destino.firma;
    end if;
  end loop;
end;
$migration$;

commit;
