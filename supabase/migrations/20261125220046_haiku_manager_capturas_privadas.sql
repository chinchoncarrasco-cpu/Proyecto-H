-- Los ejemplos contienen datos operativos. En Git y Pages sólo se publica la guía.
create table public.haiku_manager_capturas_v1 (
    clave text primary key check (clave ~ '^(recortes/[a-z-]+|fotos/m[13]-[0-9]{2})$'),
    tipo text not null check (tipo in ('image/png', 'image/jpeg')),
    contenido text not null check (octet_length(contenido) between 4 and 1048576)
);

alter table public.haiku_manager_capturas_v1 enable row level security;
revoke all on public.haiku_manager_capturas_v1 from public, anon, authenticated;
grant select on public.haiku_manager_capturas_v1 to authenticated;

create policy manager_capturas_lectura on public.haiku_manager_capturas_v1
for select to authenticated using (
    (select private.haiku_huesped_puede_leer())
    and (select private.haiku_tiene_permiso('pagos.ver'))
);

notify pgrst, 'reload schema';
