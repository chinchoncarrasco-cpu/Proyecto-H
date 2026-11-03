-- Repaso conserva el inventario y el ciclo de revisión estándar de cada día.
-- La revisión Express mantiene su registro, solicitud y estado propios.
alter table public.revisiones_cabana
    add column if not exists es_repaso boolean not null default false;

alter table public.revisiones_cabana
    add constraint revisiones_repaso_solo_completa
    check (not es_repaso or (tipo_revision is not distinct from 'completa'));

comment on column public.revisiones_cabana.es_repaso is
    'Modalidad Repaso de la revisión completa. Conserva checklist, observaciones y estado; no aplica a Aseo Express.';
