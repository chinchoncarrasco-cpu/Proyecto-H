-- Una reserva trasladada puede dejar referencias antiguas en un aseo existente.
-- El trabajo y sus horas pertenecen a la cabaña física: no se trasladan ni borran.
-- Sólo se desvincula una referencia obsoleta que la edición no intentó cambiar.
-- Insertar una referencia ajena o cambiar cabaña/fecha sigue siendo un error.
create or replace function public.haiku_validar_aseo_estadias()
returns trigger
language plpgsql
set search_path to public
as $function$
declare v_cabana uuid; v_edicion_misma_cabana boolean := false;
begin
  if tg_op='UPDATE' then
    v_edicion_misma_cabana := new.cabana_id is not distinct from old.cabana_id
      and new.fecha is not distinct from old.fecha;
  end if;
  if new.estadia_salida_id is not null then
    select cabana_id into v_cabana from public.reserva_estadias where id=new.estadia_salida_id;
    if not found or v_cabana is distinct from new.cabana_id then
      if v_edicion_misma_cabana and new.estadia_salida_id is not distinct from old.estadia_salida_id then
        new.estadia_salida_id := null;
      else
        raise exception 'La estadía de salida no corresponde a la cabaña del aseo';
      end if;
    end if;
  end if;
  if new.estadia_ingreso_id is not null then
    select cabana_id into v_cabana from public.reserva_estadias where id=new.estadia_ingreso_id;
    if not found or v_cabana is distinct from new.cabana_id then
      if v_edicion_misma_cabana and new.estadia_ingreso_id is not distinct from old.estadia_ingreso_id then
        new.estadia_ingreso_id := null;
      else
        raise exception 'La estadía de ingreso no corresponde a la cabaña del aseo';
      end if;
    end if;
  end if;
  return new;
end;
$function$;
