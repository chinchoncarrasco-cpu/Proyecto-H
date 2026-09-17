-- HAKU · endurecimiento del trigger de tarifa por cambio de cabaña
-- La función sólo debe ejecutarse como trigger interno, nunca como RPC pública.

create or replace function private.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
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

revoke all on function private.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana() from public;
revoke all on function private.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana() from anon;
revoke all on function private.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana() from authenticated;

drop trigger if exists reserva_estadias_sincronizar_tarifa_cambio_cabana on public.reserva_estadias;
create trigger reserva_estadias_sincronizar_tarifa_cambio_cabana
after update of cabana_id on public.reserva_estadias
for each row
execute function private.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana();

drop function if exists public.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana();
