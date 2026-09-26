alter table public.revisiones_cabana
    add column if not exists detalle_cocina text,
    add column if not exists detalle_bano text,
    add column if not exists detalle_living_cama text,
    add column if not exists detalle_terraza text;
