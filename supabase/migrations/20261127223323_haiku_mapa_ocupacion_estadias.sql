begin;

-- Complementa la lectura del mapa con ocupación por estadía y conserva la lectura de estacionamientos.
do $$
declare
    original text := pg_get_functiondef('public.haiku_mapa_dia_v1()'::regprocedure);
    punto constant text := '''cabanas'', v_cabanas,';
    modificado text;
begin
    if strpos(original, '''ocupacion_estadias''') > 0 then return; end if;

    modificado := replace(original, punto, punto || $sql$
        'ocupacion_estadias', (
            select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
                'huespedes', e.adultos + e.ninos,
                'noches', greatest(0, e.fecha_salida - e.fecha_ingreso),
                'por_llegar', e.fecha_ingreso = v_fecha and e.estado_estadia in ('pendiente', 'confirmada')
                    and e.checkin_realizado_en is null and e.checkout_realizado_en is null
            )), '{}'::jsonb)
            from public.reserva_estadias e
            where (select private.haiku_tiene_permiso('reservas.ver')) is true
              and e.id in (
                  select nullif(cabana->>campo, '')::uuid
                  from jsonb_array_elements(v_cabanas) cabana
                  cross join unnest(array['ingreso_estadia_id', 'continua_estadia_id', 'fullday_estadia_id', 'salida_estadia_id']) campo
              )
        ),$sql$);
    if modificado = original then
        raise exception 'No se encontró la lectura de cabañas vigente en el mapa.';
    end if;
    execute modificado;
end
$$;

commit;
