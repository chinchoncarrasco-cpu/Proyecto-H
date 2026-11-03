-- Catálogo propio de Repaso: no modifica el inventario de revisión completa ni Express.
create unique index if not exists checklist_items_repaso_categoria_nombre_v2
    on public.checklist_items (categoria, nombre)
    where categoria in ('REPASO · LIVING / CAMA', 'REPASO · COCINA', 'REPASO · BAÑO', 'REPASO · TERRAZA');

insert into public.checklist_items (categoria, nombre)
values
    ('REPASO · LIVING / CAMA', 'Cama'),
    ('REPASO · LIVING / CAMA', 'Cajones'),
    ('REPASO · LIVING / CAMA', 'Lámparas'),
    ('REPASO · LIVING / CAMA', 'Controles'),
    ('REPASO · LIVING / CAMA', 'TV'),
    ('REPASO · LIVING / CAMA', 'AC'),
    ('REPASO · LIVING / CAMA', 'Luces'),
    ('REPASO · LIVING / CAMA', 'Salamandra'),
    ('REPASO · LIVING / CAMA', 'Manilla'),
    ('REPASO · LIVING / CAMA', 'Piso'),
    ('REPASO · COCINA', 'Perillas'),
    ('REPASO · COCINA', 'Llave de gas'),
    ('REPASO · COCINA', 'Implementos'),
    ('REPASO · COCINA', 'Refri'),
    ('REPASO · BAÑO', 'Amenities'),
    ('REPASO · BAÑO', 'WC'),
    ('REPASO · BAÑO', 'P.H.'),
    ('REPASO · BAÑO', 'Toallas'),
    ('REPASO · BAÑO', 'Basurero'),
    ('REPASO · BAÑO', 'Ducha'),
    ('REPASO · BAÑO', 'Piso'),
    ('REPASO · TERRAZA', 'Fogón'),
    ('REPASO · TERRAZA', 'Atizador'),
    ('REPASO · TERRAZA', 'Jardineras'),
    ('REPASO · TERRAZA', 'Cojines'),
    ('REPASO · TERRAZA', 'Piso')
on conflict (categoria, nombre) where categoria in ('REPASO · LIVING / CAMA', 'REPASO · COCINA', 'REPASO · BAÑO', 'REPASO · TERRAZA')
    do update set activo = true where checklist_items.activo is distinct from true;
