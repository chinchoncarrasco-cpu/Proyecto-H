-- HAKU · cambio de cabaña: tarifa de catálogo + compatibilidad de abonos verificados
-- 1) Si cambia la cabaña de una estadía de alojamiento, las noches cuya tarifa
--    proviene del catálogo adoptan el precio base de la nueva cabaña.
--    Las tarifas manuales se preservan.
-- 2) La verificación manual de un abono deja además la marca histórica que la
--    reconciliación conservadora ya reconoce, sin relajar sus reglas de unicidad.

create or replace function public.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_precio_base bigint;
begin
  if old.cabana_id is not distinct from new.cabana_id then
    return new;
  end if;

  if coalesce(new.tipo_estadia, '') <> 'alojamiento' then
    return new;
  end if;

  select c.precio_base
    into v_precio_base
  from public.cabanas c
  where c.id = new.cabana_id
    and c.activa = true;

  if v_precio_base is null or v_precio_base < 0 then
    raise exception 'La nueva cabaña no tiene una tarifa base válida';
  end if;

  update public.estadia_noches n
     set tarifa = v_precio_base,
         origen_tarifa = 'catalogo'
   where n.estadia_id = new.id
     and n.origen_tarifa = 'catalogo'
     and n.tarifa is distinct from v_precio_base;

  return new;
end;
$function$;

drop trigger if exists reserva_estadias_sincronizar_tarifa_cambio_cabana on public.reserva_estadias;
create trigger reserva_estadias_sincronizar_tarifa_cambio_cabana
after update of cabana_id on public.reserva_estadias
for each row
execute function public.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana();

create or replace function public.haiku_verificar_abono(p_pago_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
    v_pago public.pagos%rowtype;
    v_cantidad integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Debe iniciar sesión para verificar abonos';
    end if;

    if not private.haiku_tiene_permiso('pagos.verificar') then
        raise exception 'Tu usuario no tiene permiso para verificar abonos';
    end if;

    select *
      into v_pago
      from public.pagos
     where id = p_pago_id
     for update;

    if not found then
        raise exception 'El abono no existe';
    end if;

    if v_pago.tipo_movimiento <> 'pago'
       or v_pago.etapa_operativa <> 'abono'
       or v_pago.estado <> 'confirmado' then
        raise exception 'El movimiento seleccionado no es un abono confirmado';
    end if;

    if v_pago.pago_grupo_id is not null then
        update public.pagos
           set verificado_por = auth.uid(),
               verificado_en = coalesce(verificado_en, now()),
               datos_origen = coalesce(datos_origen,'{}'::jsonb) || jsonb_build_object(
                   'verificacion_abono', true,
                   'verificacion_abono_en', now(),
                   'verificacion_migrada', true
               )
         where pago_grupo_id = v_pago.pago_grupo_id
           and tipo_movimiento = 'pago'
           and etapa_operativa = 'abono'
           and estado = 'confirmado';
        get diagnostics v_cantidad = row_count;
    else
        update public.pagos
           set verificado_por = auth.uid(),
               verificado_en = coalesce(verificado_en, now()),
               datos_origen = coalesce(datos_origen,'{}'::jsonb) || jsonb_build_object(
                   'verificacion_abono', true,
                   'verificacion_abono_en', now(),
                   'verificacion_migrada', true
               )
         where id = p_pago_id;
        get diagnostics v_cantidad = row_count;
    end if;

    return jsonb_build_object(
        'pago_id', p_pago_id,
        'pago_grupo_id', v_pago.pago_grupo_id,
        'verificados', v_cantidad,
        'verificado_por', auth.uid(),
        'verificado_en', now()
    );
end;
$function$;

-- Compatibilidad hacia atrás: sólo pagos ya confirmados y previamente verificados
-- por el flujo de abonos reciben la marca que usa la conciliación histórica.
update public.pagos
   set datos_origen = coalesce(datos_origen,'{}'::jsonb) || jsonb_build_object('verificacion_migrada', true)
 where tipo_movimiento = 'pago'
   and etapa_operativa = 'abono'
   and estado = 'confirmado'
   and coalesce((datos_origen ->> 'verificacion_abono')::boolean, false) = true
   and coalesce((datos_origen ->> 'verificacion_migrada')::boolean, false) = false;
