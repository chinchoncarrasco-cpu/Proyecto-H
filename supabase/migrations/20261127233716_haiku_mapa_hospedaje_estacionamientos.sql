begin;

-- Expone el hospedaje vigente por estadía en la lectura que ya usa el mapa.
do $$
declare
    original text := pg_get_functiondef('public.haiku_mapa_dia_v1()'::regprocedure);
    punto constant text := $sql$'por_llegar', e.fecha_ingreso = v_fecha$sql$;
begin
    if strpos(original, $sql$'hospedada', coalesce(e.estado_estadia$sql$) > 0 then return; end if;
    if strpos(original, '''ocupacion_estadias''') = 0 or strpos(original, punto) = 0 then
        raise exception 'No se encontró la ocupación vigente del mapa.';
    end if;

    execute replace(original, punto, $sql$'hospedada', coalesce(e.estado_estadia = 'hospedada'
                    and e.checkout_realizado_en is null and v_fecha between e.fecha_ingreso and e.fecha_salida, false),
                $sql$ || punto);
end
$$;

commit;
