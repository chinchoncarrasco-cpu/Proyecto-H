-- Calendario escucha estas tablas además de reservas y reserva_estadias.
-- Publicación aditiva: conserva miembros, datos, RLS y replica identity.
do $$
begin
    if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'bloqueos_cabana'
    ) then
        alter publication supabase_realtime add table public.bloqueos_cabana;
    end if;

    if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'cabanas'
    ) then
        alter publication supabase_realtime add table public.cabanas;
    end if;
end;
$$;
