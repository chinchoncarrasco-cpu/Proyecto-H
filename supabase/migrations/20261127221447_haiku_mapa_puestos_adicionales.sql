begin;

-- 12–14 son los puestos en fila detrás de 7–9. 15 es Adicional y 16 es Dueña.
alter table public.haiku_mapa_elementos drop constraint haiku_mapa_elementos_puesto_check,
    add constraint haiku_mapa_elementos_puesto_check check (puesto between 1 and 16),
    add constraint haiku_mapa_puesto_duena check (puesto is distinct from 16 or reserva_id is null);

do $$
declare
    original text;
    modificado text;
    punto text := '            if v_reserva is not null and not exists (';
begin
    original := pg_get_functiondef('private.haiku_mapa_guardar_v1(uuid,text,integer,text,jsonb,uuid)'::regprocedure);
    if strpos(original, 'v_puesto not between 1 and 11') = 0 or strpos(original, punto) = 0 then
        raise exception 'No se encontró la validación vigente de puestos.';
    end if;
    modificado := replace(original, 'v_puesto not between 1 and 11', 'v_puesto not between 1 and 16');
    modificado := replace(modificado, punto, $sql$            if v_puesto = 16 and v_reserva is not null then
                raise exception 'El puesto de la dueña no se vincula a estadías.' using errcode = '22023';
            end if;
$sql$ || punto);
    execute modificado;

    original := pg_get_functiondef('public.haiku_huesped_perfil_v1(uuid,uuid,boolean)'::regprocedure);
    punto := $sql$jsonb_build_object('puesto',m.puesto,'estacionado',m.datos->'estacionado')$sql$;
    modificado := replace(original, punto, punto || $sql$ || jsonb_strip_nulls(jsonb_build_object(
        'etiqueta', case m.puesto when 12 then 'Puesto 7B' when 13 then 'Puesto 8B'
            when 14 then 'Puesto 9B' when 15 then 'Adicional' end))$sql$);
    if modificado = original then raise exception 'No se encontró el puesto en la ficha de Huéspedes.'; end if;
    execute modificado;
end
$$;

commit;
