CREATE TRIGGER cierres_turno_validar_cierre BEFORE INSERT OR UPDATE ON public.cierres_turno FOR EACH ROW EXECUTE FUNCTION haiku_validar_cierre_turno();
CREATE TRIGGER trg_haiku_auditar_estado_cierre AFTER UPDATE OF estado ON public.cierres_turno FOR EACH ROW WHEN ((old.estado IS DISTINCT FROM new.estado)) EXECUTE FUNCTION private.haiku_auditar_estado_cierre();
CREATE TRIGGER cierre_respuestas_validar_contexto BEFORE INSERT OR UPDATE ON public.cierre_respuestas FOR EACH ROW EXECUTE FUNCTION haiku_validar_respuesta_cierre();
