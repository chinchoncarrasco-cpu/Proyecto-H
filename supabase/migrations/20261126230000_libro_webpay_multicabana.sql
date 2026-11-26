-- Aplica un WebPay ya recibido a varias cabañas de la misma reserva.
-- El total y cada destino se revisan antes de registrar un solo comprobante.
create function private.haiku_libro_webpay_multicabana_v1(
  p_reserva_id uuid, p_argumentos jsonb, p_origen jsonb, p_manual boolean
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  distribucion jsonb := p_origen->'distribucion_manual';
  partes jsonb := distribucion->'componentes';
  parte jsonb;
  cantidad integer;
  ingreso date := (p_origen->>'fecha_bloque')::date;
  fecha_pago date := (p_argumentos->>'p_fecha_pago')::date;
  medio text := p_argumentos->>'p_medio_pago';
  autorizacion text := regexp_replace(upper(coalesce(p_argumentos->>'p_codigo_autorizacion','')),'[^0-9A-Z]','','g');
  titular text;
  estadia uuid;
  total bigint;
  declarados bigint[];
  pendiente bigint;
  importe bigint;
  cargo record;
  aplicaciones jsonb := '[]'::jsonb;
  pago jsonb;
begin
  if auth.uid() is null or private.haiku_tiene_permiso('pagos.registrar') is distinct from true then
    raise exception 'Sin permiso para registrar pagos' using errcode='42501';
  end if;
  if p_manual is distinct from true or distribucion->>'tipo' is distinct from 'webpay_multicabana'
     or jsonb_typeof(partes) is distinct from 'array'
     or (distribucion->>'reserva_id_ancla')::uuid is distinct from p_reserva_id
     or nullif(btrim(distribucion->>'id'),'') is null or ingreso is null
     or fecha_pago is null or not isfinite(fecha_pago) or autorizacion = ''
     or medio is null or medio not in ('webpay_credito','webpay_debito')
     or nullif(btrim(p_argumentos->>'p_folio'),'') is not null
     or nullif(btrim(p_argumentos->>'p_bove'),'') is not null
     or nullif(btrim(p_origen->>'bovtar'),'') is not null then
    raise exception 'El WebPay multicabaña requiere comprobante y reparto aprobados';
  end if;
  cantidad := jsonb_array_length(partes);
  if cantidad not between 2 and 11 or exists (
    select 1 from jsonb_array_elements(partes) p where
       p->>'tipo_movimiento' is distinct from 'alojamiento'
       or p->>'estado_pago' is distinct from 'registrado_en_libro'
       or p->>'clasificacion_financiera' is distinct from 'pago_real'
       or p->'aprobado_manualmente' is distinct from 'true'::jsonb
       or p->'pago_recibido' is distinct from 'true'::jsonb
       or p->>'moneda' is distinct from 'CLP' or p->>'medio_pago' is distinct from medio
       or (p->>'reserva_id')::uuid is distinct from p_reserva_id
       or (p->>'fecha_bloque')::date is distinct from ingreso
       or (p->>'fecha_comprobante')::date is distinct from fecha_pago
       or regexp_replace(upper(coalesce(p->>'codigo_autorizacion','')),'[^0-9A-Z]','','g') <> autorizacion
       or nullif(btrim(p->>'folio'),'') is not null or nullif(btrim(p->>'bovtar'),'') is not null
       or nullif(btrim(p->>'titular'),'') is null or nullif(btrim(p->>'texto_original'),'') is null
       or nullif(btrim(p->>'item_id'),'') is null or nullif(btrim(p->'origen'->>'hoja'),'') is null
       or nullif(btrim(p->'origen'->>'celda'),'') is null
       or coalesce(p->>'monto','') !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Las partes del WebPay multicabaña deben pertenecer al mismo comprobante y reserva';
  end if;
  if exists (
    select 1 from jsonb_array_elements(partes) p
    having count(distinct p->>'item_id') <> cantidad or count(distinct (p->>'cabana')::integer) <> cantidad
       or count(distinct (p->>'estadia_id')::uuid) <> cantidad
       or count(distinct p->'origen'->>'celda') <> cantidad or count(distinct p->'origen'->>'hoja') <> 1
       or count(distinct regexp_replace(translate(lower(p->>'titular'),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')) <> 1
  ) then
    raise exception 'El WebPay repite una cabaña, estadía o fuente del Libro';
  end if;
  select sum((p->>'monto')::bigint) into total from jsonb_array_elements(partes) p;
  select array_agg(distinct replace(m.valor[1],'.','')::bigint) into declarados
    from jsonb_array_elements(partes) p
    cross join lateral regexp_matches(p->>'texto_original','(?:\$[[:space:]]*|\mmonto[[:space:]]*:?[[:space:]]*)([0-9.]+)','gi') m(valor);
  if total is distinct from (p_argumentos->>'p_monto')::bigint
     or total is distinct from (distribucion->>'total')::bigint
     or total is distinct from (distribucion->>'total_confirmado')::bigint
     or cardinality(declarados) > 1 or (declarados is not null and declarados[1] <= 0)
     or declarados[1] is distinct from (distribucion->>'total_declarado')::bigint then
    raise exception 'El total, la glosa del Libro y el reparto del WebPay requieren confirmación';
  end if;

  if not pg_try_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_reserva_id::text))
     or not pg_try_advisory_xact_lock(private.haiku_libro_lock_key_v1('pago_identificador','codaut:'||autorizacion)) then
    raise exception 'Hay otra operación con esta reserva o comprobante. Vuelve a preparar' using errcode='40001';
  end if;
  select r.titular_nombre into titular from public.reservas r where r.id=p_reserva_id
    and r.grupo_reserva_id is null and r.estado_reserva not in ('cancelada','no_show') for update;
  if not found or nullif(btrim(titular),'') is null
     or regexp_replace(translate(lower(titular),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
        is distinct from regexp_replace(translate(lower(distribucion->>'titular'),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g') then
    raise exception 'La reserva del WebPay cambió; vuelve a preparar';
  end if;
  if exists (
    select 1 from public.pagos p where p.tipo_movimiento='pago'
      and p.estado in ('confirmado','pendiente_asociacion')
      and regexp_replace(upper(coalesce(p.codigo_autorizacion,'')),'[^0-9A-Z]','','g')=autorizacion
  ) then
    raise exception 'El WebPay ya existe; revisa su asociación y aplicaciones';
  end if;
  perform 1 from public.cargos where reserva_id=p_reserva_id and tipo_cargo='alojamiento' order by id for update;
  for parte in select value from jsonb_array_elements(partes) order by value->>'estadia_id' loop
    select e.id into estadia from public.reserva_estadias e join public.cabanas c on c.id=e.cabana_id
      where e.id=(parte->>'estadia_id')::uuid and e.reserva_id=p_reserva_id
        and e.tipo_estadia='alojamiento' and e.estado_estadia not in ('cancelada','no_show')
        and c.numero=(parte->>'cabana')::integer and e.fecha_ingreso=ingreso
        and e.fecha_salida=(parte->>'fecha_salida')::date for update of e;
    if not found then raise exception 'Cambió una estadía del WebPay; vuelve a preparar'; end if;
    pendiente := (parte->>'monto')::bigint;
    for cargo in
      select ec.cargo_id,ec.saldo_cargo from public.vista_estado_cargos ec
        join public.cargos c on c.id=ec.cargo_id
        where ec.reserva_id=p_reserva_id and c.estadia_id=estadia
          and ec.estado='activo' and ec.tipo_cargo='alojamiento' and ec.saldo_cargo>0
        order by c.creado_en,ec.cargo_id
    loop
      exit when pendiente=0;
      importe := least(pendiente,cargo.saldo_cargo);
      aplicaciones := aplicaciones || jsonb_build_array(jsonb_build_object('cargo_id',cargo.cargo_id,'monto',importe));
      pendiente := pendiente-importe;
    end loop;
    if pendiente<>0 then raise exception 'La cabaña % no tiene saldo suficiente para su parte del WebPay',parte->>'cabana'; end if;
  end loop;

  pago := public.haiku_registrar_pago(p_reserva_id=>p_reserva_id,p_monto=>total,
    p_medio_pago=>medio,p_etapa_operativa=>'abono',
    p_fecha_pago=>(p_argumentos->>'p_fecha_pago')::timestamptz,
    p_codigo_autorizacion=>p_argumentos->>'p_codigo_autorizacion',
    p_referencia_externa=>p_argumentos->>'p_referencia_externa',
    p_observaciones=>p_argumentos->>'p_observaciones',
    p_aplicaciones=>aplicaciones,p_modo_aplicacion=>'ninguno');
  if (pago->>'aplicado')::bigint is distinct from total or (pago->>'sin_aplicar')::bigint is distinct from 0 then
    raise exception 'No se aplicó el reparto completo del WebPay';
  end if;
  update public.pagos set datos_origen=coalesce(datos_origen,'{}'::jsonb)||
    jsonb_build_object('distribucion_manual',distribucion,'aplicaciones_pendientes','[]'::jsonb)
    where id=(pago->>'pago_id')::uuid;
  return pago;
end;
$function$;
revoke all on function private.haiku_libro_webpay_multicabana_v1(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;

do $migration$
declare
  definicion text := pg_get_functiondef('private.haiku_libro_pago_distribuido_v1(uuid,jsonb,jsonb,boolean)'::regprocedure);
  entrada text := E'\nbegin\n';
begin
  if (length(definicion)-length(replace(definicion,entrada,'')))/length(entrada)<>1 then
    raise exception 'Cambió el writer de comprobantes distribuidos';
  end if;
  execute replace(definicion,entrada,entrada||
    E'  if d->>''tipo'' = ''webpay_multicabana'' then\n'||
    E'    return private.haiku_libro_webpay_multicabana_v1(p_reserva_id,p_argumentos,p_origen,p_manual);\n  end if;\n');
end;
$migration$;

create or replace function public.haiku_libro_distribucion_capacidad_v1()
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $function$
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  return jsonb_build_object('version',5,'modos',jsonb_build_array('estadia_partes',
    'grupo_alojamiento','grupo_alojamiento_penalidad','grupo_alojamiento_penalidad_manual','webpay_multicabana'));
end;
$function$;
