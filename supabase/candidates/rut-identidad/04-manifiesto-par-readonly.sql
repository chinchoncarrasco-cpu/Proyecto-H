-- Sólo hashes, sin documentos ni identificadores en el resultado.
-- Parametrizar EN LA SESIÓN PRIVADA, sin editar este archivo:
-- select set_config('haiku.review.original_code', <código verificado>, false);
-- select set_config('haiku.review.subsequent_code', <código verificado>, false);
begin isolation level repeatable read read only;
with pair as (
 select r.*,case when codigo_haiku=current_setting('haiku.review.original_code',true) then 'original' else 'subsequent' end label
 from public.reservas r where codigo_haiku in(current_setting('haiku.review.original_code',true),current_setting('haiku.review.subsequent_code',true))
), hashes as (
 select label,md5(jsonb_build_object(
 'reservation',to_jsonb(r)-'label','guest',(select to_jsonb(h) from public.huespedes h where h.id=r.titular_huesped_id),
 'stays',(select jsonb_agg(to_jsonb(e) order by e.id) from public.reserva_estadias e where reserva_id=r.id),
 'reservation_links',(select jsonb_agg(to_jsonb(x) order by x.id) from public.reserva_huespedes x where reserva_id=r.id),
 'stay_links',(select jsonb_agg(to_jsonb(x) order by x.id) from public.estadia_huespedes x where estadia_id in(select id from public.reserva_estadias where reserva_id=r.id)),
 'nights',(select jsonb_agg(to_jsonb(x) order by x.id) from public.estadia_noches x where estadia_id in(select id from public.reserva_estadias where reserva_id=r.id)),
 'payments',(select jsonb_agg(to_jsonb(x) order by x.id) from public.pagos x where reserva_id=r.id),
 'charges',(select jsonb_agg(to_jsonb(x) order by x.id) from public.cargos x where reserva_id=r.id),
 'applications',(select jsonb_agg(to_jsonb(x) order by x.id) from public.pago_aplicaciones x where pago_id in(select id from public.pagos where reserva_id=r.id) or cargo_id in(select id from public.cargos where reserva_id=r.id)),
 'notes',(select jsonb_agg(to_jsonb(x) order by x.id) from public.notas x where reserva_id=r.id or huesped_id=r.titular_huesped_id),
 'requests',(select jsonb_agg(to_jsonb(x) order by x.id) from public.solicitudes x where reserva_id=r.id or huesped_id=r.titular_huesped_id),
 'services',(select jsonb_agg(to_jsonb(x) order by x.id) from public.servicios x where reserva_id=r.id),
 'adjustments',(select jsonb_agg(to_jsonb(x) order by x.id) from public.cargo_ajustes x where reserva_id=r.id),
 'audit',(select jsonb_agg(to_jsonb(x) order by x.id) from public.eventos_auditoria x where reserva_id=r.id or entidad_id in(r.id,r.titular_huesped_id))
 )::text) snapshot_md5 from pair r
)
select jsonb_build_object('pair_count',(select count(*) from pair),'hashes',(select jsonb_agg(to_jsonb(h) order by label) from hashes h)) manifest;
commit;
