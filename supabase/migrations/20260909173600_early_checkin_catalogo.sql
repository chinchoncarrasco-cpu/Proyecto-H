-- Early Check-In: servicio programable con precio manual por hora.
insert into public.catalogo_servicios (
  codigo,
  categoria,
  nombre,
  descripcion,
  unidad,
  precio_base,
  moneda,
  duracion_minutos,
  capacidad_incluida,
  capacidad_maxima,
  precio_persona_adicional,
  permite_cortesia,
  requiere_horario,
  activo,
  orden_visual
)
values (
  'earlyCheckin',
  'checkin',
  'Early Check-In',
  'Ingreso anticipado. Precio manual por hora.',
  'hora',
  0,
  'CLP',
  null,
  null,
  null,
  null,
  false,
  true,
  true,
  65
)
on conflict (codigo) do update set
  categoria = excluded.categoria,
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  unidad = excluded.unidad,
  precio_base = excluded.precio_base,
  moneda = excluded.moneda,
  permite_cortesia = excluded.permite_cortesia,
  requiere_horario = excluded.requiere_horario,
  activo = excluded.activo,
  orden_visual = excluded.orden_visual,
  actualizado_en = now();
