begin;

-- El mapa lee las indicaciones de Resumen del mismo día con los permisos de notas.
do $$
declare
    original text := pg_get_functiondef('public.haiku_mapa_dia_v1()'::regprocedure);
    punto constant text := '''cabanas'', v_cabanas,';
begin
    if strpos(original, '''notas_resumen''') > 0 then return; end if;
    if strpos(original, punto) = 0 then
        raise exception 'No se encontró la lectura de cabañas vigente en el mapa.';
    end if;

    execute replace(original, punto, punto || $sql$
        'notas_resumen', (
            select coalesce(jsonb_object_agg(agrupadas.numero, agrupadas.textos), '{}'::jsonb)
            from (
                select c.numero, jsonb_agg(n.texto order by n.creado_en, n.id) as textos
                from public.notas n
                left join public.reserva_estadias directa on directa.id = n.estadia_id
                -- Una nota de una reserva grupal conserva su cabaña si hay varias estadías candidatas.
                left join lateral (
                    select e.cabana_id, count(*) over () as cantidad
                    from public.reserva_estadias e
                    where directa.id is null and e.reserva_id = n.reserva_id
                      and n.fecha_operacion between e.fecha_ingreso and e.fecha_salida
                      and e.estado_estadia not in ('cancelada', 'no_show')
                    order by (e.cabana_id = n.cabana_id) desc nulls last, e.id
                    limit 1
                ) candidata on true
                join public.cabanas c on c.activa and c.id = coalesce(
                    directa.cabana_id,
                    case when candidata.cantidad = 1 or candidata.cabana_id = n.cabana_id then candidata.cabana_id end,
                    n.cabana_id
                )
                where (select private.haiku_tiene_permiso('notas.ver')) is true
                  and n.tipo = 'operativa_resumen' and n.fecha_operacion = v_fecha
                  and nullif(btrim(n.texto), '') is not null
                group by c.numero
            ) agrupadas
        ),$sql$);
end
$$;

commit;
