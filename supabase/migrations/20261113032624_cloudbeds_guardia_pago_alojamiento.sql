begin;

-- La incorporación del Libro conserva su idempotencia y sus permisos. Para
-- Cloudbeds se verifica además el destino y el saldo dentro de esa transacción.
create function private.haiku_libro_validar_alojamiento_cloudbeds_v1(
  p_reserva uuid, p_argumentos jsonb, p_origen jsonb, p_existente uuid
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_contexto jsonb := p_origen->'alojamiento_cloudbeds_v1';
  v_estadia uuid := (v_contexto->>'estadia_id')::uuid;
  v_fecha date := (p_argumentos->>'p_fecha_pago')::date;
  v_monto bigint := (p_argumentos->>'p_monto')::bigint;
  v_medio text := p_argumentos->>'p_medio_pago';
  v_codaut text := nullif(ltrim(p_argumentos->>'p_codigo_autorizacion','0'),'');
  v_folio text := nullif(ltrim(p_argumentos->>'p_folio','0'),'');
  v_bovtar text := nullif(ltrim(p_origen->>'bovtar','0'),'');
  v_pago uuid;
  v_coincidencias integer;
  v_mismo_comprobante boolean;
  v_saldo bigint;
  v_cargos jsonb;
begin
  if auth.uid() is null or private.haiku_tiene_permiso('pagos.registrar') is distinct from true then
    raise exception 'Tu sesión no tiene permiso para registrar pagos' using errcode='42501';
  end if;
  if jsonb_typeof(v_contexto) is distinct from 'object' or v_estadia is null
     or p_argumentos->>'p_modo_aplicacion' is distinct from 'alojamiento'
     or p_origen->>'tipo_movimiento' is distinct from 'alojamiento'
     or (p_argumentos->>'p_reserva_id')::uuid is distinct from p_reserva
     or v_monto is null or v_monto <= 0 or v_fecha is null or v_fecha > (now() at time zone 'America/Santiago')::date
     or not coalesce((
       v_medio in ('webpay_credito','webpay_debito') and v_codaut ~ '^[0-9]+$' and v_folio is null and v_bovtar is null
       or v_medio in ('tarjeta_credito','tarjeta_debito') and v_folio ~ '^[0-9]+$' and v_bovtar ~ '^[0-9]+$'
     ),false) then
    raise exception 'Comprueba los datos del pago de alojamiento de Cloudbeds' using errcode='HLC01';
  end if;
  if not pg_try_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_reserva::text)) then
    raise exception 'La reserva tiene otra operación financiera en curso. Vuelve a preparar el pago' using errcode='HLC01';
  end if;
  perform 1 from public.reservas r
    join public.reserva_estadias e on e.reserva_id=r.id
    join public.cabanas b on b.id=e.cabana_id
    where r.id=p_reserva and e.id=v_estadia
      and r.estado_reserva not in ('cancelada','no_show') and e.estado_estadia not in ('cancelada','no_show')
      and e.fecha_ingreso=(p_origen->>'fecha_bloque')::date
      and e.fecha_salida=(v_contexto->>'salida')::date and b.numero=(p_origen->>'cabana')::integer
    for update of r nowait;
  if not found then
    raise exception 'La estadía del pago de alojamiento cambió. Vuelve a preparar el pago' using errcode='HLC01';
  end if;

  -- Las tablas de pagos y estadías ya están bloqueadas por el incorporador.
  -- Incluir variantes numéricas con ceros iniciales en la detección global.
  select count(*),(array_agg(recibo.id))[1],coalesce(bool_and(recibo.misma_referencia),false)
    into v_coincidencias,v_pago,v_mismo_comprobante
    from (
      select p.id,
        v_medio in ('webpay_credito','webpay_debito') and
          ltrim(regexp_replace(coalesce(p.codigo_autorizacion,''),'[^0-9a-zA-Z]','','g'),'0')=v_codaut
        or v_medio in ('tarjeta_credito','tarjeta_debito') and
          ltrim(regexp_replace(coalesce(p.folio,''),'[^0-9a-zA-Z]','','g'),'0')=v_folio and
          ltrim(regexp_replace(coalesce(p.datos_origen->>'bovtar',p.bove,
            case when p.medio_pago in ('tarjeta_credito','tarjeta_debito') then p.codigo_autorizacion end,''),'[^0-9a-zA-Z]','','g'),'0')=v_bovtar
        as misma_referencia
      from public.pagos p where p.tipo_movimiento='pago' and p.estado<>'anulado'
    ) recibo
    where recibo.id=p_existente or recibo.misma_referencia;
  if v_coincidencias>0 then
    if v_coincidencias<>1 or not v_mismo_comprobante or not exists (
      select 1 from public.pagos p
      join public.pago_aplicaciones a on a.pago_id=p.id
      join public.cargos c on c.id=a.cargo_id
      where p.id=v_pago and p.reserva_id=p_reserva and p.estado='confirmado' and p.moneda='CLP'
        and p.monto=v_monto and p.medio_pago=v_medio
        and v_fecha in (p.fecha_pago::date,(p.fecha_pago at time zone 'America/Santiago')::date)
      group by p.id
      having sum(a.monto_aplicado)=v_monto and bool_and(
        c.estadia_id is not distinct from v_estadia and c.reserva_id=p_reserva and c.tipo_cargo='alojamiento' and c.estado='activo')
    ) then
      raise exception 'El comprobante coincide con otro movimiento. Revisa el pago y su aplicación' using errcode='HLC01';
    end if;
    return v_pago;
  end if;

  select coalesce(sum(c.saldo_cargo),0),
    jsonb_agg(jsonb_build_object('id',c.cargo_id,'saldo',c.saldo_cargo) order by c.cargo_id)
    into v_saldo,v_cargos
    from public.vista_estado_cargos c
    where c.reserva_id=p_reserva and c.tipo_cargo='alojamiento' and c.estado='activo' and c.saldo_cargo>0;
  if v_saldo<v_monto or v_cargos is distinct from v_contexto->'cargos' or exists (
    select 1 from public.vista_estado_cargos c
    where c.reserva_id=p_reserva and c.tipo_cargo='alojamiento' and c.estado='activo' and c.saldo_cargo>0
      and c.estadia_id is distinct from v_estadia
  ) then
    raise exception 'Cambió el saldo o los cargos de alojamiento. Vuelve a preparar el pago' using errcode='HLC01';
  end if;
  return null;
exception when lock_not_available then
  raise exception 'La reserva está siendo actualizada. Vuelve a preparar el pago' using errcode='HLC01';
end;
$$;

revoke all on function private.haiku_libro_validar_alojamiento_cloudbeds_v1(uuid,jsonb,jsonb,uuid)
from public, anon, authenticated;

do $$
declare
  v_cuerpo text := replace(pg_get_functiondef('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure),E'\r','');
  v_duplicado text := '    if v_pago_existente is not null then';
  v_aplicado text := '    v_pago_id := (v_pago ->> ''pago_id'')::uuid;';
begin
  if length(v_cuerpo)-length(replace(v_cuerpo,v_duplicado,''))<>length(v_duplicado)
     or length(v_cuerpo)-length(replace(v_cuerpo,v_aplicado,''))<>length(v_aplicado) then
    raise exception 'No se encontró el punto de validación del pago de alojamiento';
  end if;
  v_cuerpo := replace(v_cuerpo,v_duplicado,$guard$
    if v_origen ? 'alojamiento_cloudbeds_v1' then
      v_pago_existente := private.haiku_libro_validar_alojamiento_cloudbeds_v1(v_reserva_id,v_argumentos,v_origen,v_pago_existente);
    end if;
$guard$ || v_duplicado);
  v_cuerpo := replace(v_cuerpo,v_aplicado,$guard$
    if v_origen ? 'alojamiento_cloudbeds_v1' and (
      (v_pago->>'aplicado')::bigint is distinct from v_monto or (v_pago->>'sin_aplicar')::bigint is distinct from 0
    ) then
      raise exception 'El pago de Cloudbeds debe aplicarse íntegramente al alojamiento' using errcode='HLC01';
    end if;
$guard$ || v_aplicado);
  execute v_cuerpo;
end;
$$;

commit;
