-- Candidata local: no ejecutar contra datos reales sin revisión independiente.
-- Sólo modifica el guardado de reservas nuevas del Libro, nunca registros históricos.
begin;
set local lock_timeout='5s';
do $patch$
declare f record; despues record; original text; nuevo text;
  ancla text := $old$    v_reserva_id := (v_resultado ->> 'reserva_id')::uuid;$old$;
  reemplazo text := $new$    v_reserva_id := (v_resultado ->> 'reserva_id')::uuid;
    -- La clave para identificar huéspedes conserva su semántica y validación.
    -- El documento visible de esta reserva nueva usa el formato canónico.
    if v_rut is not null then
      update public.reservas
      set titular_numero_documento = lower(
        left(private.haiku_rut_clave_v1(v_rut), -1) || '-' ||
        right(private.haiku_rut_clave_v1(v_rut), 1))
      where id = v_reserva_id and titular_tipo_documento = 'rut';
    end if;$new$;
begin
  select * into f from pg_proc where oid=to_regprocedure('public.haiku_incorporar_libro_v1(uuid,jsonb)');
  if not found or to_regprocedure('private.haiku_rut_clave_v1(text)') is null then
    raise exception 'Falta el contrato de identidad del Libro; detener y revisar';
  end if;
  original := replace(pg_get_functiondef(f.oid), E'\r', '');
  if (length(original)-length(replace(original,ancla,'')))/length(ancla) <> 1
    or position('El documento visible de esta reserva nueva' in original)>0 then
    raise exception 'Punto de parche inesperado en incorporación del Libro';
  end if;
  nuevo := replace(original,ancla,reemplazo);
  execute nuevo;
  select * into despues from pg_proc where oid=f.oid;
  if (despues.proowner,despues.proacl,despues.prosecdef,despues.proconfig) is distinct from
     (f.proowner,f.proacl,f.prosecdef,f.proconfig) then
    raise exception 'Cambio inesperado de permisos';
  end if;
end;
$patch$;
commit;
