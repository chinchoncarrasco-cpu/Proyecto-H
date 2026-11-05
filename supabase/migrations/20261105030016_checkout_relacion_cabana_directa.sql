-- Una revisión de salida registra trabajo sobre una estadía. Incluir ambas
-- claves foráneas en su PK hace que PostgREST la interprete como otra
-- relación entre estadías y cabañas, y vuelve ambiguas las lecturas existentes.
alter table public.revisiones_checkout
    add column revision_id uuid not null default gen_random_uuid(),
    drop constraint revisiones_checkout_pkey,
    add primary key (revision_id),
    add constraint revisiones_checkout_fecha_cabana_estadia_key
        unique (fecha_operativa, cabana_id, estadia_id);

-- Realtime sigue identificando los cambios con la misma clave operativa.
alter table public.revisiones_checkout
    replica identity using index revisiones_checkout_fecha_cabana_estadia_key;

notify pgrst, 'reload schema';
