-- NO EJECUTAR mientras quede cualquier duplicado, incluidos alias preservados.
-- Es una opción de diseño, separada de la garantía de concurrencia del registro.
-- Conservar documentos históricos en alias impide este índice de toda la tabla.
begin;
set local lock_timeout='5s';
lock table public.huespedes in share row exclusive mode;
do $$begin
  if exists(select 1 from public.huespedes where tipo_documento='rut'
    and private.haiku_rut_clave_v1(numero_documento) is not null
    group by private.haiku_rut_clave_v1(numero_documento) having count(*)>1) then
    raise exception 'Índice aplazado: duplicados históricos o alias preservados; requiere decisión supervisada';
  end if;
end$$;
create unique index huespedes_rut_normalizado_uidx on public.huespedes(private.haiku_rut_clave_v1(numero_documento))
  where tipo_documento='rut' and private.haiku_rut_clave_v1(numero_documento) is not null;
commit;
