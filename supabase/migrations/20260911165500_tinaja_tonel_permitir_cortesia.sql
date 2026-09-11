-- HAIKU · Tinaja Tonel: permitir cortesía
-- Corrección focalizada e idempotente.
-- La UI ya permite seleccionar Cortesía y haiku_registrar_servicio
-- registra las cortesías con total 0 y sin cargo financiero.

update public.catalogo_servicios
set permite_cortesia = true
where codigo = 'tinajaTonel'
  and permite_cortesia is distinct from true;
