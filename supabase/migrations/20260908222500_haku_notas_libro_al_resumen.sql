create or replace function public.haiku_importar_notas_libro_v1(
  p_operacion_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_reserva_id uuid;
  v_estadia_id uuid;
  v_cabana_id uuid;
  v_fecha date;
  v_texto text;
  v_importante boolean;
  v_nota_id uuid;
  v_creadas integer := 0;
  v_omitidas integer := 0;
  v_resultados jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  if not private.haiku_usuario_activo() then raise exception 'Usuario no activo'; end if;
  if not private.haiku_tiene_permiso('notas.gestionar') then raise exception 'No tiene permiso para gestionar notas'; end if;
  if p_operacion_id is null then raise exception 'Falta el identificador de operación'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'La lista de notas no es válida'; end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then raise exception 'La operación debe contener entre 1 y 100 notas'; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(btrim(v_item->>'item_id'), '');
    if v_item_id is null or length(v_item_id) > 160 or v_item_id !~ '^[A-Za-z0-9:_\-.]+$' then raise exception 'Identificador de nota del Libro no válido'; end if;

    v_reserva_id := nullif(v_item->>'reserva_id', '')::uuid;
    v_estadia_id := nullif(v_item->>'estadia_id', '')::uuid;
    v_fecha := nullif(v_item->>'fecha_operacion', '')::date;
    v_texto := nullif(btrim(v_item->>'texto'), '');
    v_importante := coalesce((v_item->>'importante')::boolean, true);
    v_cabana_id := null;

    if v_reserva_id is null or v_texto is null or v_fecha is null then raise exception 'Nota del Libro incompleta: %', v_item_id; end if;

    if v_estadia_id is not null then
      select re.cabana_id into v_cabana_id
      from public.reserva_estadias re
      where re.id = v_estadia_id
        and re.reserva_id = v_reserva_id
        and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
      limit 1;
      if v_cabana_id is null then raise exception 'La estadía destino cambió o ya no está disponible: %', v_item_id; end if;
    else
      select re.cabana_id into v_cabana_id
      from public.reserva_estadias re
      where re.reserva_id = v_reserva_id
        and re.fecha_ingreso <= v_fecha
        and re.fecha_salida >= v_fecha
        and coalesce(re.estado_estadia, '') not in ('cancelada', 'no_show')
      order by re.fecha_ingreso, re.id
      limit 1;
    end if;

    if v_cabana_id is null then raise exception 'No pude determinar la cabaña de la nota: %', v_item_id; end if;

    select n.id into v_nota_id
    from public.notas n
    where n.reserva_id = v_reserva_id
      and n.cabana_id = v_cabana_id
      and n.fecha_operacion = v_fecha
      and n.tipo = 'operativa_resumen'
      and btrim(n.texto) = v_texto
    limit 1;

    if v_nota_id is not null then
      v_omitidas := v_omitidas + 1;
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'nota_id', v_nota_id, 'estado', 'ya_importada'));
      v_nota_id := null;
      continue;
    end if;

    insert into public.notas(
      reserva_id, estadia_id, cabana_id, fecha_operacion, tipo, texto, importante, creado_por
    ) values (
      v_reserva_id, v_estadia_id, v_cabana_id, v_fecha, 'operativa_resumen', v_texto, v_importante, auth.uid()
    ) returning id into v_nota_id;

    v_creadas := v_creadas + 1;
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'nota_id', v_nota_id, 'estado', 'creada'));
    v_nota_id := null;
  end loop;

  return jsonb_build_object('ok', true, 'operacion_id', p_operacion_id, 'notas_creadas', v_creadas, 'omitidas', v_omitidas, 'resultados', v_resultados);
end;
$$;

comment on function public.haiku_importar_notas_libro_v1(uuid, jsonb) is
'Importa notas operativas del Libro al mismo tipo operativa_resumen usado por Resumen, con deduplicación por reserva+cabaña+fecha+texto.';