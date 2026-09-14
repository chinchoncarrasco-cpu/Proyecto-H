-- Liberación individual desde la reconciliación del Libro. No sustituye al calendario.
create function public.haiku_liberar_bloqueo_libro_seguro(
    p_bloqueo_id uuid,
    p_cabana_numero integer,
    p_desde date,
    p_hasta date,
    p_motivo text,
    p_actualizado_en timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
    v_bloqueo record;
    v_resultado text;
begin
    if auth.uid() is null or not private.haiku_usuario_activo() then
        raise exception 'Debe iniciar sesión con un usuario HAIKU activo';
    end if;
    if not private.haiku_tiene_permiso('cabanas.liberar'::text) then
        raise exception 'No tiene permiso para liberar cabañas';
    end if;
    if p_bloqueo_id is null then
        raise exception 'Falta identificar el bloqueo';
    end if;

    select b.id, b.cabana_id, b.estado, b.desde, b.hasta, b.motivo,
           b.actualizado_en, c.numero
      into v_bloqueo
      from public.bloqueos_cabana b
      join public.cabanas c on c.id = b.cabana_id
     where b.id = p_bloqueo_id
     for update of b, c;

    if not found then
        return jsonb_build_object('bloqueo_id', p_bloqueo_id,
            'cabana_numero', null, 'desde', null, 'hasta', null,
            'estado', null, 'resultado', 'ya_no_existe');
    end if;
    if v_bloqueo.estado <> 'activo' then
        v_resultado := 'ya_liberado';
    else
        if p_cabana_numero is null or p_desde is null or p_hasta is null
           or p_hasta <= p_desde or p_motivo is null or p_actualizado_en is null
           or v_bloqueo.numero is distinct from p_cabana_numero
           or (v_bloqueo.desde at time zone 'America/Santiago')::date is distinct from p_desde
           or (v_bloqueo.hasta at time zone 'America/Santiago')::date is distinct from p_hasta
           or v_bloqueo.motivo is distinct from p_motivo
           or v_bloqueo.actualizado_en is distinct from p_actualizado_en then
            raise exception using errcode = '40001',
                message = 'El bloqueo cambió desde la vista previa. Requiere revisión.';
        end if;
        update public.bloqueos_cabana
           set estado = 'liberado', liberado_por = auth.uid(),
               liberado_en = now(), actualizado_en = now()
         where id = v_bloqueo.id;
        v_bloqueo.estado := 'liberado';
        v_resultado := 'liberado';
    end if;
    return jsonb_build_object('bloqueo_id', v_bloqueo.id,
        'cabana_numero', v_bloqueo.numero,
        'desde', (v_bloqueo.desde at time zone 'America/Santiago')::date,
        'hasta', (v_bloqueo.hasta at time zone 'America/Santiago')::date,
        'estado', v_bloqueo.estado, 'resultado', v_resultado);
end;
$function$;

revoke all on function public.haiku_liberar_bloqueo_libro_seguro(uuid,integer,date,date,text,timestamptz) from public, anon;
grant execute on function public.haiku_liberar_bloqueo_libro_seguro(uuid,integer,date,date,text,timestamptz) to authenticated;
comment on function public.haiku_liberar_bloqueo_libro_seguro(uuid,integer,date,date,text,timestamptz)
    is 'Libera un bloqueo con control optimista bajo lock; la ausencia en el Libro se revalida en Haku. No modifica la RPC del calendario.';
