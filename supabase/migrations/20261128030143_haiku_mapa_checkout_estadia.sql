begin;

-- El mapa necesita el check-out de cada estadía, incluso si sale antes de la fecha prevista.
do $$
declare
    original text := pg_get_functiondef('public.haiku_mapa_dia_v1()'::regprocedure);
    punto constant text := $sql$'noches', greatest(0, e.fecha_salida - e.fecha_ingreso),$sql$;
begin
    if strpos(original, $sql$'checked_out', coalesce(e.estado_estadia$sql$) > 0 then return; end if;
    if strpos(original, '''ocupacion_estadias''') = 0 or strpos(original, punto) = 0 then
        raise exception 'No se encontró la ocupación vigente del mapa.';
    end if;

    execute replace(original, punto, punto || $sql$
                'checked_out', coalesce(e.estado_estadia = 'checked_out' or e.checkout_realizado_en is not null, false),$sql$);
end
$$;

commit;
