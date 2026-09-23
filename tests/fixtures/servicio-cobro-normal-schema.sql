-- Extiende únicamente el esquema efímero compartido con el RPC inverso.
alter table public.catalogo_servicios
  add column unidad text,
  add column precio_base bigint,
  add column capacidad_incluida smallint,
  add column capacidad_maxima smallint,
  add column precio_persona_adicional bigint;
