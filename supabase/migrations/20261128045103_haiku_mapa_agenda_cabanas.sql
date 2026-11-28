begin;

-- La agenda del mapa suma servicios con hora y cabaña sin cambiar las zonas de tinajas y masajes.
do $$
declare
    definicion text := pg_get_functiondef('public.haiku_mapa_dia_v1()'::regprocedure);
    agenda_del_dia constant text := $f$where s.fecha_servicio = v_fecha and s.estado_servicio not in ('cancelado', 'no_show')
          $f$;
    filtro_anterior constant text := agenda_del_dia || $f$and (c.codigo in ('tinajaTonel', 'tinajaJacuzzi') or c.codigo ilike 'masaje%');$f$;
    filtro_nuevo constant text := agenda_del_dia || $f$and (
              c.codigo in ('tinajaTonel', 'tinajaJacuzzi') or c.codigo ilike 'masaje%'
              or (s.hora_inicio is not null and s.estado_servicio = 'programado' and b.numero is not null)
          );$f$;
begin
    if strpos(definicion, filtro_nuevo) > 0 then return; end if;
    if strpos(definicion, filtro_anterior) = 0 then
        raise exception 'No se encontró el filtro de la agenda del mapa.';
    end if;
    execute replace(definicion, filtro_anterior, filtro_nuevo);
end
$$;

commit;
