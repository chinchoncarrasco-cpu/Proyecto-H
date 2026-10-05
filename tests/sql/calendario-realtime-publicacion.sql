-- Contrato de presencia; la publicación puede incluir otras tablas.
do $$
declare faltantes text;
begin
    select string_agg(requerida.tabla, ', ' order by requerida.tabla)
    into faltantes
    from (values ('reservas'), ('reserva_estadias'), ('bloqueos_cabana'), ('cabanas')) requerida(tabla)
    where not exists (
        select 1 from pg_catalog.pg_publication_tables p
        where p.pubname = 'supabase_realtime'
          and p.schemaname = 'public'
          and p.tablename = requerida.tabla
    );
    if faltantes is not null then
        raise exception 'Calendario: faltan tablas en supabase_realtime: %', faltantes;
    end if;
end;
$$;
