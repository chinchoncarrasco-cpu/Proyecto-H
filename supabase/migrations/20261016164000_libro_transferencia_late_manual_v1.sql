-- Excepción puntual de transferencia Late Check-out sin identificador bancario.
-- Se preserva la aprobación humana y el contrato 4C en los demás servicios.
CREATE OR REPLACE FUNCTION private.haiku_libro_pago_servicios_v1(p_reserva_id uuid, p_argumentos jsonb, p_origen jsonb, p_manual boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  d jsonb := p_origen->'aplicaciones_servicio_v1';
  aplicaciones_esperadas jsonb := d->'aplicaciones';
  aplicacion jsonb;
  aplicaciones_registro jsonb := '[]'::jsonb;
  pago jsonb;
  reserva_estado text;
  v_cargo_id uuid;
  v_servicio_id uuid;
  v_monto bigint;
  monto_total bigint;
  suma bigint := 0;
  saldo_esperado bigint;
  aplicado_esperado bigint;
  cantidad_esperada integer;
  fecha_contexto date;
  fecha_servicio_esperada date;
  concepto_esperado text;
  concepto_actual text;
  saldo_actual bigint;
  aplicado_actual bigint;
  cantidad_actual integer;
  cargo_estado text;
  cargo_tipo text;
  cargo_reserva uuid;
  servicio_actual uuid;
  servicio_fecha date;
  servicio_total bigint;
  servicio_cobro text;
  servicio_estado text;
  candidatos integer;
  elegido boolean;
  pago_existente uuid;
  pago_existente_reserva uuid;
  pagos_existentes integer;
  reservas_existentes integer;
  v_token text;
  codaut text := nullif(btrim(coalesce(p_argumentos->>'p_codigo_autorizacion','')), '');
  folio text := nullif(btrim(coalesce(p_argumentos->>'p_folio','')), '');
  argumento_bove text := nullif(btrim(coalesce(p_argumentos->>'p_bove','')), '');
  bovtar text := nullif(btrim(coalesce(p_origen->>'bovtar','')), '');
  codaut_norm text;
  folio_norm text;
  bovtar_norm text;
  v_transferencia_late_manual boolean := false;
  v_transferencia_prueba jsonb := p_origen->'transferencia_late_checkout_sin_identificador_v1';
  clase record;
  subconjuntos_validos integer;
  conjunto_elegido boolean;
  candidatos_clase integer;
begin
  if auth.uid() is null or not private.haiku_tiene_permiso('pagos.registrar') then
    raise exception 'Sin permiso para registrar pagos' using errcode='42501';
  end if;
  if p_manual is distinct from true then
    raise exception 'Las aplicaciones de servicio requieren aprobación explícita';
  end if;
  if coalesce((d->>'version')::integer,0) <> 1
     or jsonb_typeof(aplicaciones_esperadas) is distinct from 'array'
     or jsonb_array_length(aplicaciones_esperadas) < 1
     or jsonb_array_length(aplicaciones_esperadas) > 20 then
    raise exception 'Contrato de aplicaciones de servicio inválido';
  end if;
  begin
    monto_total := (p_argumentos->>'p_monto')::bigint;
  exception when others then
    raise exception 'Monto total inválido';
  end;
  if monto_total <= 0 or d->>'moneda' is distinct from 'CLP'
     or (d->>'reserva_id')::uuid is distinct from p_reserva_id
     or (d->>'monto_total')::bigint is distinct from monto_total then
    raise exception 'Reserva, moneda o total incompatibles con la propuesta';
  end if;
  if p_argumentos->>'p_medio_pago'='airbnb_prepaid_card' then
    if nullif(btrim(p_origen->>'item_id'),'') is null
      or jsonb_typeof(p_origen->'item_id') is distinct from 'string'
      or jsonb_typeof(p_origen->'origen') is distinct from 'object'
      or jsonb_typeof(p_origen->'origen'->'hoja') is distinct from 'string'
      or jsonb_typeof(p_origen->'origen'->'celda') is distinct from 'string'
      or nullif(btrim(p_origen->'origen'->>'hoja'),'') is null
      or nullif(btrim(p_origen->'origen'->>'celda'),'') is null
      or nullif(btrim(p_argumentos->>'p_fecha_pago'),'') is null then
      raise exception 'Airbnb requiere item/origen estable del Libro y fecha real';
    end if;
    codaut:=null; folio:=null; argumento_bove:=null; bovtar:=null;
  end if;
  codaut_norm:=nullif(regexp_replace(upper(coalesce(codaut,'')),'[^0-9A-Z]','','g'),'');
  folio_norm:=nullif(regexp_replace(upper(coalesce(folio,'')),'[^0-9A-Z]','','g'),'');
  bovtar_norm:=nullif(regexp_replace(upper(coalesce(bovtar,'')),'[^0-9A-Z]','','g'),'');
  if argumento_bove is not null and (bovtar_norm is null or
     nullif(regexp_replace(upper(argumento_bove),'[^0-9A-Z]','','g'),'') is distinct from bovtar_norm) then
    raise exception 'p_bove sólo puede transportar el mismo BOVTAR del comprobante; un BOVE administrativo no identifica pagos';
  end if;

  -- Sólo Late Check-out: transferencia no identificada por el banco.
  -- Se exige aprobación humana de la misma fila y usuario autenticado.
  v_transferencia_late_manual :=
    p_argumentos->>'p_medio_pago'='transferencia' and p_manual is true
    and codaut_norm is null and folio_norm is null and bovtar_norm is null
    and argumento_bove is null and jsonb_typeof(v_transferencia_prueba)='object'
    and v_transferencia_prueba->>'version'='1'
    and v_transferencia_prueba->>'usuario'=auth.uid()::text
    and nullif(btrim(p_origen->>'item_id'),'') is not null
    and v_transferencia_prueba->>'item_id'=p_origen->>'item_id'
    and v_transferencia_prueba->>'reserva_id'=p_reserva_id::text
    and p_origen->>'reserva_id'=p_reserva_id::text
    and v_transferencia_prueba->>'monto'=p_argumentos->>'p_monto'
    and p_origen->>'monto'=p_argumentos->>'p_monto'
    and p_origen->>'medio'='transferencia' and p_origen->>'moneda'='CLP'
    and p_origen->>'tipo_movimiento'='servicio'
    and p_origen->>'source_kind'='libro_reserva'
    and nullif(btrim(p_origen->>'source_fingerprint'),'') is not null
    and p_argumentos->>'p_fecha_pago' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}
    if p_argumentos->>'p_medio_pago'='efectivo' then
      raise exception 'Efectivo sin identificador transaccional fuerte no está habilitado en FASE 4C';
    end if;
    raise exception 'El pago requiere CodAut o Folio + BOVTAR como identificador transaccional fuerte';
  end if;
  if (select count(distinct x->>'cargo_id') from jsonb_array_elements(aplicaciones_esperadas) x)
       <> jsonb_array_length(aplicaciones_esperadas) then
    raise exception 'Una transacción no puede reutilizar el mismo cargo';
  end if;

  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_reserva_id::text));
  for v_token in
    select token from unnest(array[
      case when p_argumentos->>'p_medio_pago'='airbnb_prepaid_card' or v_transferencia_late_manual then
        'libro_item:'||btrim(p_origen->>'item_id') end,
      case when p_argumentos->>'p_medio_pago'='airbnb_prepaid_card' or v_transferencia_late_manual then
        'libro_origen:'||
        jsonb_build_array(p_reserva_id,btrim(p_origen->'origen'->>'hoja'),btrim(p_origen->'origen'->>'celda'))::text end,
      case when codaut_norm is not null then 'codaut:'||codaut_norm end,
      case when folio_norm is not null and bovtar_norm is not null then 'voucher:'||folio_norm||':'||bovtar_norm end
    ]) as t(token) where token is not null order by token
  loop
    perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('pago_identificador',v_token));
  end loop;

  select r.estado_reserva into reserva_estado
  from public.reservas r where r.id=p_reserva_id for update;
  if not found or reserva_estado in ('cancelada','no_show') then
    raise exception 'La reserva destino cambió o dejó de estar disponible; vuelve a preparar';
  end if;

  perform 1 from public.catalogo_servicios cs join public.servicios s on s.catalogo_servicio_id=cs.id
    where s.reserva_id=p_reserva_id order by cs.id for share of cs;
  perform 1 from public.servicios s where s.reserva_id=p_reserva_id order by s.id for update;
  perform 1 from public.cargos c where c.reserva_id=p_reserva_id order by c.id for update;
  perform 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id
    where c.reserva_id=p_reserva_id order by pa.id for update of pa;
  perform 1 from public.pagos p where p.reserva_id=p_reserva_id order by p.id for update;

  with coincidencias as (
    select p.* from public.pagos p
    where p.tipo_movimiento='pago'
      and (p.estado='confirmado' or p_argumentos->>'p_medio_pago'='airbnb_prepaid_card') and (
      (p_argumentos->>'p_medio_pago'='airbnb_prepaid_card' and (
        btrim(p.datos_origen->>'item_id')=btrim(p_origen->>'item_id') or (
          p.reserva_id=p_reserva_id and p.medio_pago='airbnb_prepaid_card'
          and btrim(p.datos_origen->'origen_libro'->>'hoja')=btrim(p_origen->'origen'->>'hoja')
          and btrim(p.datos_origen->'origen_libro'->>'celda')=btrim(p_origen->'origen'->>'celda')
        ))) or
      (v_transferencia_late_manual and (
        btrim(p.datos_origen->>'item_id')=btrim(p_origen->>'item_id') or (
          p.reserva_id=p_reserva_id
          and btrim(p.datos_origen->'origen_libro'->>'hoja')=btrim(p_origen->'origen'->>'hoja')
          and btrim(p.datos_origen->'origen_libro'->>'celda')=btrim(p_origen->'origen'->>'celda')
        ))) or
      (codaut_norm is not null and regexp_replace(upper(coalesce(p.codigo_autorizacion,'')),'[^0-9A-Z]','','g')=codaut_norm)
      or (folio_norm is not null and bovtar_norm is not null
        and regexp_replace(upper(coalesce(p.folio,'')),'[^0-9A-Z]','','g')=folio_norm
        and regexp_replace(upper(coalesce(p.datos_origen->>'bovtar',p.bove,'')),'[^0-9A-Z]','','g')=bovtar_norm)
    )
  )
  select (array_agg(id order by creado_en,id))[1],
         (array_agg(reserva_id order by creado_en,id))[1],
         count(*)::integer,count(distinct reserva_id)::integer
    into pago_existente,pago_existente_reserva,pagos_existentes,reservas_existentes
  from coincidencias;
  if pagos_existentes>0 then
    if reservas_existentes<>1 or pago_existente_reserva is distinct from p_reserva_id then
      raise exception 'El identificador fuerte ahora pertenece a otra reserva; vuelve a preparar';
    end if;
    if pagos_existentes<>1 then
      raise exception 'El identificador fuerte coincide con múltiples pagos confirmados; requiere revisión';
    end if;
    if p_argumentos->>'p_medio_pago'='airbnb_prepaid_card' and exists (
      select 1 from public.pagos p where p.id=pago_existente and (
        p.estado is distinct from 'confirmado' or p.medio_pago is distinct from 'airbnb_prepaid_card'
        or p.monto is distinct from monto_total
        or p.moneda is distinct from 'CLP' or p.fecha_pago is distinct from (p_argumentos->>'p_fecha_pago')::timestamptz
        or p.referencia_externa is distinct from nullif(btrim(p_argumentos->>'p_referencia_externa'),'')
        or btrim(p.datos_origen->'origen_libro'->>'hoja') is distinct from btrim(p_origen->'origen'->>'hoja')
        or btrim(p.datos_origen->'origen_libro'->>'celda') is distinct from btrim(p_origen->'origen'->>'celda')
        or p.datos_origen->'aplicaciones_servicio_v1' is distinct from d
      )) then
      raise exception 'El item/origen Airbnb ya existe con datos distintos; vuelve a revisar';
    end if;
    if v_transferencia_late_manual and exists (
      select 1 from public.pagos p where p.id=pago_existente and (
        p.estado is distinct from 'confirmado' or p.medio_pago is distinct from 'transferencia'
        or p.monto is distinct from monto_total or p.moneda is distinct from 'CLP'
        or p.fecha_pago is distinct from (p_argumentos->>'p_fecha_pago')::timestamptz
        or p.referencia_externa is distinct from p_argumentos->>'p_referencia_externa'
        or p.datos_origen->>'item_id' is distinct from p_origen->>'item_id'
        or p.datos_origen->'origen_libro' is distinct from p_origen->'origen'
        or p.datos_origen->'aplicaciones_servicio_v1' is distinct from d
        or p.datos_origen->'transferencia_late_checkout_sin_identificador_v1'
           is distinct from v_transferencia_prueba
      )
    ) then
      raise exception 'Transferencia sin ID registrada con datos diferentes; requiere revisión';
    end if;
    return jsonb_build_object('ya_existe',true,'pago_id',pago_existente,'monto',monto_total,'aplicado',0,'sin_aplicar',0);
  end if;

  -- Bloquear otra transferencia de igual monto y fecha, aunque no traiga origen.
  if v_transferencia_late_manual and exists (
    select 1 from public.pagos p where p.reserva_id=p_reserva_id
      and p.tipo_movimiento='pago' and p.estado is distinct from 'anulado'
      and p.medio_pago='transferencia' and p.monto=monto_total
      and p.fecha_pago::date=(p_argumentos->>'p_fecha_pago')::date
  ) then
    raise exception 'Existe transferencia de igual monto y fecha; requiere revisión';
  end if;
  -- Primero se revalida cada cargo explícito y su snapshot bajo los locks.
  for aplicacion in select value from jsonb_array_elements(aplicaciones_esperadas) loop
    begin
      v_cargo_id := (aplicacion->>'cargo_id')::uuid;
      v_servicio_id := (aplicacion->>'servicio_id')::uuid;
      v_monto := (aplicacion->>'monto')::bigint;
      saldo_esperado := (aplicacion->>'saldo_esperado')::bigint;
      aplicado_esperado := (aplicacion->>'aplicado_esperado')::bigint;
      cantidad_esperada := (aplicacion->>'cantidad_aplicaciones_esperada')::integer;
      fecha_contexto := nullif(aplicacion->>'fecha_contexto','')::date;
      fecha_servicio_esperada := (aplicacion->>'fecha_servicio_esperada')::date;
    exception when others then
      raise exception 'Aplicación de servicio incompleta o inválida';
    end;
    concepto_esperado := aplicacion->>'concepto_canon';
    if v_cargo_id is null or v_servicio_id is null or v_monto<=0 or saldo_esperado<=0
       or aplicado_esperado<0 or cantidad_esperada<0
       or concepto_esperado not in ('late_checkout','early_checkin','cama_adicional','lena','masaje','tinaja_tonel','tinaja_jacuzzi','tinaja','cuna','queque','pan','huevos') then
      raise exception 'Aplicación de servicio incompleta o incompatible';
    end if;

    select c.reserva_id,c.tipo_cargo,c.estado,s.id,s.fecha_servicio,s.total,s.tipo_cobro,s.estado_servicio,
           ec.saldo_cargo,ec.aplicado_neto,
           private.haiku_libro_concepto_servicio_canon_v1(concat_ws(' ',ec.concepto,cs.codigo,cs.nombre,cs.categoria))
      into cargo_reserva,cargo_tipo,cargo_estado,servicio_actual,servicio_fecha,servicio_total,
           servicio_cobro,servicio_estado,saldo_actual,aplicado_actual,concepto_actual
    from public.cargos c
    join public.vista_estado_cargos ec on ec.cargo_id=c.id
    join public.servicios s on s.id=c.servicio_id
    left join public.catalogo_servicios cs on cs.id=s.catalogo_servicio_id
    where c.id=v_cargo_id
    for update of c,s;
    if not found or cargo_reserva is distinct from p_reserva_id or cargo_tipo is distinct from 'servicio'
       or cargo_estado is distinct from 'activo' or servicio_actual is distinct from v_servicio_id
       or servicio_fecha is distinct from fecha_servicio_esperada
       or servicio_total is null or servicio_total<=0
       or coalesce(servicio_cobro,'normal')='cortesia'
       or regexp_replace(lower(coalesce(servicio_estado,'')),'[^a-z0-9]+','','g') ~ '(cancelad|noshow|anulad)'
       or not (concepto_actual=concepto_esperado or
         (concepto_esperado='tinaja' and concepto_actual in ('tinaja','tinaja_tonel','tinaja_jacuzzi'))) then
      raise exception 'El cargo o servicio cambió y ya no corresponde a la propuesta; vuelve a preparar';
    end if;
    select count(*) into cantidad_actual
    from public.pago_aplicaciones pa join public.pagos p on p.id=pa.pago_id
    where pa.cargo_id=v_cargo_id and p.estado='confirmado';
    if saldo_actual is distinct from saldo_esperado or aplicado_actual is distinct from aplicado_esperado
       or cantidad_actual is distinct from cantidad_esperada then
      raise exception 'El saldo o las aplicaciones del cargo cambiaron; vuelve a preparar';
    end if;
    if v_monto>saldo_actual then
      raise exception 'La aplicación supera el saldo actual del cargo';
    end if;

    suma := suma+v_monto;
    aplicaciones_registro := aplicaciones_registro ||
      jsonb_build_array(jsonb_build_object('cargo_id',v_cargo_id,'monto',v_monto));
  end loop;

  if suma is distinct from monto_total then
    raise exception 'La suma de aplicaciones debe coincidir exactamente con el monto del pago';
  end if;

  -- Se agrupan los destinos por la misma familia y fecha de contexto que preparó
  -- el frontend. Una sola aplicación conserva la regla histórica; dos o más
  -- deben cubrir el saldo completo y formar el único subconjunto posible.
  for clase in
    select x->>'concepto_canon' concepto_canon,
           nullif(x->>'fecha_contexto','')::date fecha_contexto,
           count(*)::integer cantidad,
           sum((x->>'monto')::bigint)::bigint monto,
           array_agg((x->>'cargo_id')::uuid order by (x->>'cargo_id')::uuid) cargos,
           bool_and((x->>'monto')::bigint=(x->>'saldo_esperado')::bigint) cubre_saldos
    from jsonb_array_elements(aplicaciones_esperadas) x
    group by x->>'concepto_canon',nullif(x->>'fecha_contexto','')::date
  loop
    concepto_esperado:=clase.concepto_canon;
    fecha_contexto:=clase.fecha_contexto;

    if clase.cantidad=1 then
      v_cargo_id:=clase.cargos[1];
      with posibles as (
        select ec2.cargo_id,s2.fecha_servicio,
          private.haiku_libro_concepto_servicio_canon_v1(concat_ws(' ',ec2.concepto,cs2.codigo,cs2.nombre,cs2.categoria)) canon
        from public.vista_estado_cargos ec2
        join public.cargos c2 on c2.id=ec2.cargo_id
        join public.servicios s2 on s2.id=c2.servicio_id
        left join public.catalogo_servicios cs2 on cs2.id=s2.catalogo_servicio_id
        where ec2.reserva_id=p_reserva_id and ec2.tipo_cargo='servicio'
          and ec2.estado='activo' and ec2.saldo_cargo>0
          and s2.total>0 and coalesce(s2.tipo_cobro,'normal')<>'cortesia'
          and regexp_replace(lower(coalesce(s2.estado_servicio,'')),'[^a-z0-9]+','','g') !~ '(cancelad|noshow|anulad)'
      ), compatibles as (
        select * from posibles p where p.canon=concepto_esperado or
          (concepto_esperado='tinaja' and p.canon in ('tinaja','tinaja_tonel','tinaja_jacuzzi'))
      ), fecha as (
        select count(*) filter(where fecha_contexto is not null and fecha_servicio=fecha_contexto) exactos from compatibles
      ), finales as (
        select c.* from compatibles c cross join fecha f where f.exactos=0 or c.fecha_servicio=fecha_contexto
      )
      select count(*),coalesce(bool_or(finales.cargo_id=v_cargo_id),false)
        into candidatos,elegido from finales;
      if candidatos<>1 or elegido is distinct from true then
        raise exception 'El destino dejó de ser único; vuelve a preparar';
      end if;
    else
      if clase.cubre_saldos is distinct from true then
        raise exception 'Una distribución múltiple debe cubrir íntegramente los saldos seleccionados; vuelve a preparar';
      end if;

      with recursive posibles as (
        select ec2.cargo_id,ec2.saldo_cargo::bigint saldo_cargo,s2.fecha_servicio,
          private.haiku_libro_concepto_servicio_canon_v1(concat_ws(' ',ec2.concepto,cs2.codigo,cs2.nombre,cs2.categoria)) canon
        from public.vista_estado_cargos ec2
        join public.cargos c2 on c2.id=ec2.cargo_id
        join public.servicios s2 on s2.id=c2.servicio_id
        left join public.catalogo_servicios cs2 on cs2.id=s2.catalogo_servicio_id
        where ec2.reserva_id=p_reserva_id and ec2.tipo_cargo='servicio'
          and ec2.estado='activo' and ec2.saldo_cargo>0
          and s2.total>0 and coalesce(s2.tipo_cobro,'normal')<>'cortesia'
          and regexp_replace(lower(coalesce(s2.estado_servicio,'')),'[^a-z0-9]+','','g') !~ '(cancelad|noshow|anulad)'
      ), compatibles as (
        select * from posibles p where p.canon=concepto_esperado or
          (concepto_esperado='tinaja' and p.canon in ('tinaja','tinaja_tonel','tinaja_jacuzzi'))
      ), fecha as (
        select count(*) filter(where fecha_contexto is not null and fecha_servicio=fecha_contexto) exactos from compatibles
      ), finales as (
        select c.* from compatibles c cross join fecha f where f.exactos=0 or c.fecha_servicio=fecha_contexto
      ), limite as (
        select count(*)::integer candidatos from finales
      ), ordenados as (
        select f.*,row_number() over(order by f.cargo_id) posicion
        from finales f cross join limite l where l.candidatos<=12
      ), combinaciones(cargos,ultima_posicion,total,cantidad) as (
        select array[]::uuid[],0::bigint,0::bigint,0
        union all
        select c.cargos||o.cargo_id,o.posicion,c.total+o.saldo_cargo,c.cantidad+1
        from combinaciones c
        join ordenados o on o.posicion>c.ultima_posicion
        where c.cantidad<12 and c.total+o.saldo_cargo<=clase.monto
      ), soluciones as (
        select cargos from combinaciones where cantidad>0 and total=clase.monto
      )
      select l.candidatos,
             count(s.cargos)::integer,
             coalesce(bool_or(s.cargos=clase.cargos),false)
        into candidatos_clase,subconjuntos_validos,conjunto_elegido
      from limite l left join soluciones s on true
      group by l.candidatos;

      if candidatos_clase>12 then
        raise exception 'Más de 12 destinos compatibles requieren revisión manual; vuelve a preparar';
      end if;
      if subconjuntos_validos<>1 or conjunto_elegido is distinct from true then
        raise exception 'El conjunto de destinos dejó de ser único; vuelve a preparar';
      end if;
    end if;
  end loop;

  pago := public.haiku_registrar_pago(
    p_reserva_id=>p_reserva_id,
    p_monto=>monto_total,
    p_medio_pago=>p_argumentos->>'p_medio_pago',
    p_etapa_operativa=>'abono',
    p_fecha_pago=>(p_argumentos->>'p_fecha_pago')::timestamptz,
    p_folio=>folio,
    p_codigo_autorizacion=>codaut,
    p_bove=>bovtar,
    p_referencia_externa=>p_argumentos->>'p_referencia_externa',
    p_observaciones=>p_argumentos->>'p_observaciones',
    p_aplicaciones=>aplicaciones_registro,
    p_modo_aplicacion=>'ninguno'
  );
  if (pago->>'aplicado')::bigint is distinct from monto_total
     or (pago->>'sin_aplicar')::bigint is distinct from 0 then
    raise exception 'Proyecto H no aplicó el total completo; se revierte la operación';
  end if;
  return pago;
end;
$function$

    and p_origen->>'fecha'=p_argumentos->>'p_fecha_pago'
    and v_transferencia_prueba->>'fecha_comprobante'=p_argumentos->>'p_fecha_pago'
    and p_origen->>'fecha_bloque' is not null
    and jsonb_array_length(aplicaciones_esperadas)=1
    and aplicaciones_esperadas->0->>'concepto_canon'='late_checkout'
    and aplicaciones_esperadas->0->>'fecha_contexto'=p_origen->>'fecha_bloque'
    and jsonb_typeof(p_origen->'origen')='object'
    and nullif(btrim(p_origen->'origen'->>'hoja'),'') is not null
    and nullif(btrim(p_origen->'origen'->>'celda'),'') is not null
    and length(p_origen->'origen'->>'hoja')<=128
    and length(p_origen->'origen'->>'celda')<=128
    and v_transferencia_prueba->'origen'=p_origen->'origen'
    and jsonb_typeof(p_origen->'evidencia_libro')='object'
    and p_origen->'evidencia_libro'->'origen'=p_origen->'origen'
    and p_origen->'evidencia_libro'->>'monto'=p_argumentos->>'p_monto'
    and p_origen->'evidencia_libro'->>'medio_pago'='transferencia'
    and p_origen->'evidencia_libro'->>'tipo_movimiento'='servicio'
    and p_origen->'evidencia_libro'->>'pago_recibido'='true'
    and p_origen->'evidencia_libro'->>'estado_pago'='registrado_en_libro'
    and p_origen->'evidencia_libro'->>'fecha_comprobante'=p_argumentos->>'p_fecha_pago'
    and lower(p_origen->'evidencia_libro'->>'concepto') like '%late%'
    and lower(p_origen->'evidencia_libro'->>'concepto') like '%out%'
    and p_argumentos->>'p_referencia_externa'=p_origen->'evidencia_libro'->>'texto_original';

  if p_argumentos->>'p_medio_pago' is distinct from 'airbnb_prepaid_card'
     and codaut_norm is null and (folio_norm is null or bovtar_norm is null) and not v_transferencia_late_manual then
    if p_argumentos->>'p_medio_pago'='efectivo' then
      raise exception 'Efectivo sin identificador transaccional fuerte no está habilitado en FASE 4C';
    end if;
    raise exception 'El pago requiere CodAut o Folio + BOVTAR como identificador transaccional fuerte';
  end if;
  if (select count(distinct x->>'cargo_id') from jsonb_array_elements(aplicaciones_esperadas) x)
       <> jsonb_array_length(aplicaciones_esperadas) then
    raise exception 'Una transacción no puede reutilizar el mismo cargo';
  end if;

  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_reserva_id::text));
  for v_token in
    select token from unnest(array[
      case when p_argumentos->>'p_medio_pago'='airbnb_prepaid_card' then 'libro_item:'||btrim(p_origen->>'item_id') end,
      case when p_argumentos->>'p_medio_pago'='airbnb_prepaid_card' then 'libro_origen:'||
        jsonb_build_array(p_reserva_id,btrim(p_origen->'origen'->>'hoja'),btrim(p_origen->'origen'->>'celda'))::text end,
      case when codaut_norm is not null then 'codaut:'||codaut_norm end,
      case when folio_norm is not null and bovtar_norm is not null then 'voucher:'||folio_norm||':'||bovtar_norm end
    ]) as t(token) where token is not null order by token
  loop
    perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('pago_identificador',v_token));
  end loop;

  select r.estado_reserva into reserva_estado
  from public.reservas r where r.id=p_reserva_id for update;
  if not found or reserva_estado in ('cancelada','no_show') then
    raise exception 'La reserva destino cambió o dejó de estar disponible; vuelve a preparar';
  end if;

  perform 1 from public.catalogo_servicios cs join public.servicios s on s.catalogo_servicio_id=cs.id
    where s.reserva_id=p_reserva_id order by cs.id for share of cs;
  perform 1 from public.servicios s where s.reserva_id=p_reserva_id order by s.id for update;
  perform 1 from public.cargos c where c.reserva_id=p_reserva_id order by c.id for update;
  perform 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id
    where c.reserva_id=p_reserva_id order by pa.id for update of pa;
  perform 1 from public.pagos p where p.reserva_id=p_reserva_id order by p.id for update;

  with coincidencias as (
    select p.* from public.pagos p
    where p.tipo_movimiento='pago'
      and (p.estado='confirmado' or p_argumentos->>'p_medio_pago'='airbnb_prepaid_card') and (
      (p_argumentos->>'p_medio_pago'='airbnb_prepaid_card' and (
        btrim(p.datos_origen->>'item_id')=btrim(p_origen->>'item_id') or (
          p.reserva_id=p_reserva_id and p.medio_pago='airbnb_prepaid_card'
          and btrim(p.datos_origen->'origen_libro'->>'hoja')=btrim(p_origen->'origen'->>'hoja')
          and btrim(p.datos_origen->'origen_libro'->>'celda')=btrim(p_origen->'origen'->>'celda')
        ))) or
      (codaut_norm is not null and regexp_replace(upper(coalesce(p.codigo_autorizacion,'')),'[^0-9A-Z]','','g')=codaut_norm)
      or (folio_norm is not null and bovtar_norm is not null
        and regexp_replace(upper(coalesce(p.folio,'')),'[^0-9A-Z]','','g')=folio_norm
        and regexp_replace(upper(coalesce(p.datos_origen->>'bovtar',p.bove,'')),'[^0-9A-Z]','','g')=bovtar_norm)
    )
  )
  select (array_agg(id order by creado_en,id))[1],
         (array_agg(reserva_id order by creado_en,id))[1],
         count(*)::integer,count(distinct reserva_id)::integer
    into pago_existente,pago_existente_reserva,pagos_existentes,reservas_existentes
  from coincidencias;
  if pagos_existentes>0 then
    if reservas_existentes<>1 or pago_existente_reserva is distinct from p_reserva_id then
      raise exception 'El identificador fuerte ahora pertenece a otra reserva; vuelve a preparar';
    end if;
    if pagos_existentes<>1 then
      raise exception 'El identificador fuerte coincide con múltiples pagos confirmados; requiere revisión';
    end if;
    if p_argumentos->>'p_medio_pago'='airbnb_prepaid_card' and exists (
      select 1 from public.pagos p where p.id=pago_existente and (
        p.estado is distinct from 'confirmado' or p.medio_pago is distinct from 'airbnb_prepaid_card'
        or p.monto is distinct from monto_total
        or p.moneda is distinct from 'CLP' or p.fecha_pago is distinct from (p_argumentos->>'p_fecha_pago')::timestamptz
        or p.referencia_externa is distinct from nullif(btrim(p_argumentos->>'p_referencia_externa'),'')
        or btrim(p.datos_origen->'origen_libro'->>'hoja') is distinct from btrim(p_origen->'origen'->>'hoja')
        or btrim(p.datos_origen->'origen_libro'->>'celda') is distinct from btrim(p_origen->'origen'->>'celda')
        or p.datos_origen->'aplicaciones_servicio_v1' is distinct from d
      )) then
      raise exception 'El item/origen Airbnb ya existe con datos distintos; vuelve a revisar';
    end if;
    return jsonb_build_object('ya_existe',true,'pago_id',pago_existente,'monto',monto_total,'aplicado',0,'sin_aplicar',0);
  end if;

  -- Primero se revalida cada cargo explícito y su snapshot bajo los locks.
  for aplicacion in select value from jsonb_array_elements(aplicaciones_esperadas) loop
    begin
      v_cargo_id := (aplicacion->>'cargo_id')::uuid;
      v_servicio_id := (aplicacion->>'servicio_id')::uuid;
      v_monto := (aplicacion->>'monto')::bigint;
      saldo_esperado := (aplicacion->>'saldo_esperado')::bigint;
      aplicado_esperado := (aplicacion->>'aplicado_esperado')::bigint;
      cantidad_esperada := (aplicacion->>'cantidad_aplicaciones_esperada')::integer;
      fecha_contexto := nullif(aplicacion->>'fecha_contexto','')::date;
      fecha_servicio_esperada := (aplicacion->>'fecha_servicio_esperada')::date;
    exception when others then
      raise exception 'Aplicación de servicio incompleta o inválida';
    end;
    concepto_esperado := aplicacion->>'concepto_canon';
    if v_cargo_id is null or v_servicio_id is null or v_monto<=0 or saldo_esperado<=0
       or aplicado_esperado<0 or cantidad_esperada<0
       or concepto_esperado not in ('late_checkout','early_checkin','cama_adicional','lena','masaje','tinaja_tonel','tinaja_jacuzzi','tinaja','cuna','queque','pan','huevos') then
      raise exception 'Aplicación de servicio incompleta o incompatible';
    end if;

    select c.reserva_id,c.tipo_cargo,c.estado,s.id,s.fecha_servicio,s.total,s.tipo_cobro,s.estado_servicio,
           ec.saldo_cargo,ec.aplicado_neto,
           private.haiku_libro_concepto_servicio_canon_v1(concat_ws(' ',ec.concepto,cs.codigo,cs.nombre,cs.categoria))
      into cargo_reserva,cargo_tipo,cargo_estado,servicio_actual,servicio_fecha,servicio_total,
           servicio_cobro,servicio_estado,saldo_actual,aplicado_actual,concepto_actual
    from public.cargos c
    join public.vista_estado_cargos ec on ec.cargo_id=c.id
    join public.servicios s on s.id=c.servicio_id
    left join public.catalogo_servicios cs on cs.id=s.catalogo_servicio_id
    where c.id=v_cargo_id
    for update of c,s;
    if not found or cargo_reserva is distinct from p_reserva_id or cargo_tipo is distinct from 'servicio'
       or cargo_estado is distinct from 'activo' or servicio_actual is distinct from v_servicio_id
       or servicio_fecha is distinct from fecha_servicio_esperada
       or servicio_total is null or servicio_total<=0
       or coalesce(servicio_cobro,'normal')='cortesia'
       or regexp_replace(lower(coalesce(servicio_estado,'')),'[^a-z0-9]+','','g') ~ '(cancelad|noshow|anulad)'
       or not (concepto_actual=concepto_esperado or
         (concepto_esperado='tinaja' and concepto_actual in ('tinaja','tinaja_tonel','tinaja_jacuzzi'))) then
      raise exception 'El cargo o servicio cambió y ya no corresponde a la propuesta; vuelve a preparar';
    end if;
    select count(*) into cantidad_actual
    from public.pago_aplicaciones pa join public.pagos p on p.id=pa.pago_id
    where pa.cargo_id=v_cargo_id and p.estado='confirmado';
    if saldo_actual is distinct from saldo_esperado or aplicado_actual is distinct from aplicado_esperado
       or cantidad_actual is distinct from cantidad_esperada then
      raise exception 'El saldo o las aplicaciones del cargo cambiaron; vuelve a preparar';
    end if;
    if v_monto>saldo_actual then
      raise exception 'La aplicación supera el saldo actual del cargo';
    end if;

    suma := suma+v_monto;
    aplicaciones_registro := aplicaciones_registro ||
      jsonb_build_array(jsonb_build_object('cargo_id',v_cargo_id,'monto',v_monto));
  end loop;

  if suma is distinct from monto_total then
    raise exception 'La suma de aplicaciones debe coincidir exactamente con el monto del pago';
  end if;

  -- Se agrupan los destinos por la misma familia y fecha de contexto que preparó
  -- el frontend. Una sola aplicación conserva la regla histórica; dos o más
  -- deben cubrir el saldo completo y formar el único subconjunto posible.
  for clase in
    select x->>'concepto_canon' concepto_canon,
           nullif(x->>'fecha_contexto','')::date fecha_contexto,
           count(*)::integer cantidad,
           sum((x->>'monto')::bigint)::bigint monto,
           array_agg((x->>'cargo_id')::uuid order by (x->>'cargo_id')::uuid) cargos,
           bool_and((x->>'monto')::bigint=(x->>'saldo_esperado')::bigint) cubre_saldos
    from jsonb_array_elements(aplicaciones_esperadas) x
    group by x->>'concepto_canon',nullif(x->>'fecha_contexto','')::date
  loop
    concepto_esperado:=clase.concepto_canon;
    fecha_contexto:=clase.fecha_contexto;

    if clase.cantidad=1 then
      v_cargo_id:=clase.cargos[1];
      with posibles as (
        select ec2.cargo_id,s2.fecha_servicio,
          private.haiku_libro_concepto_servicio_canon_v1(concat_ws(' ',ec2.concepto,cs2.codigo,cs2.nombre,cs2.categoria)) canon
        from public.vista_estado_cargos ec2
        join public.cargos c2 on c2.id=ec2.cargo_id
        join public.servicios s2 on s2.id=c2.servicio_id
        left join public.catalogo_servicios cs2 on cs2.id=s2.catalogo_servicio_id
        where ec2.reserva_id=p_reserva_id and ec2.tipo_cargo='servicio'
          and ec2.estado='activo' and ec2.saldo_cargo>0
          and s2.total>0 and coalesce(s2.tipo_cobro,'normal')<>'cortesia'
          and regexp_replace(lower(coalesce(s2.estado_servicio,'')),'[^a-z0-9]+','','g') !~ '(cancelad|noshow|anulad)'
      ), compatibles as (
        select * from posibles p where p.canon=concepto_esperado or
          (concepto_esperado='tinaja' and p.canon in ('tinaja','tinaja_tonel','tinaja_jacuzzi'))
      ), fecha as (
        select count(*) filter(where fecha_contexto is not null and fecha_servicio=fecha_contexto) exactos from compatibles
      ), finales as (
        select c.* from compatibles c cross join fecha f where f.exactos=0 or c.fecha_servicio=fecha_contexto
      )
      select count(*),coalesce(bool_or(finales.cargo_id=v_cargo_id),false)
        into candidatos,elegido from finales;
      if candidatos<>1 or elegido is distinct from true then
        raise exception 'El destino dejó de ser único; vuelve a preparar';
      end if;
    else
      if clase.cubre_saldos is distinct from true then
        raise exception 'Una distribución múltiple debe cubrir íntegramente los saldos seleccionados; vuelve a preparar';
      end if;

      with recursive posibles as (
        select ec2.cargo_id,ec2.saldo_cargo::bigint saldo_cargo,s2.fecha_servicio,
          private.haiku_libro_concepto_servicio_canon_v1(concat_ws(' ',ec2.concepto,cs2.codigo,cs2.nombre,cs2.categoria)) canon
        from public.vista_estado_cargos ec2
        join public.cargos c2 on c2.id=ec2.cargo_id
        join public.servicios s2 on s2.id=c2.servicio_id
        left join public.catalogo_servicios cs2 on cs2.id=s2.catalogo_servicio_id
        where ec2.reserva_id=p_reserva_id and ec2.tipo_cargo='servicio'
          and ec2.estado='activo' and ec2.saldo_cargo>0
          and s2.total>0 and coalesce(s2.tipo_cobro,'normal')<>'cortesia'
          and regexp_replace(lower(coalesce(s2.estado_servicio,'')),'[^a-z0-9]+','','g') !~ '(cancelad|noshow|anulad)'
      ), compatibles as (
        select * from posibles p where p.canon=concepto_esperado or
          (concepto_esperado='tinaja' and p.canon in ('tinaja','tinaja_tonel','tinaja_jacuzzi'))
      ), fecha as (
        select count(*) filter(where fecha_contexto is not null and fecha_servicio=fecha_contexto) exactos from compatibles
      ), finales as (
        select c.* from compatibles c cross join fecha f where f.exactos=0 or c.fecha_servicio=fecha_contexto
      ), limite as (
        select count(*)::integer candidatos from finales
      ), ordenados as (
        select f.*,row_number() over(order by f.cargo_id) posicion
        from finales f cross join limite l where l.candidatos<=12
      ), combinaciones(cargos,ultima_posicion,total,cantidad) as (
        select array[]::uuid[],0::bigint,0::bigint,0
        union all
        select c.cargos||o.cargo_id,o.posicion,c.total+o.saldo_cargo,c.cantidad+1
        from combinaciones c
        join ordenados o on o.posicion>c.ultima_posicion
        where c.cantidad<12 and c.total+o.saldo_cargo<=clase.monto
      ), soluciones as (
        select cargos from combinaciones where cantidad>0 and total=clase.monto
      )
      select l.candidatos,
             count(s.cargos)::integer,
             coalesce(bool_or(s.cargos=clase.cargos),false)
        into candidatos_clase,subconjuntos_validos,conjunto_elegido
      from limite l left join soluciones s on true
      group by l.candidatos;

      if candidatos_clase>12 then
        raise exception 'Más de 12 destinos compatibles requieren revisión manual; vuelve a preparar';
      end if;
      if subconjuntos_validos<>1 or conjunto_elegido is distinct from true then
        raise exception 'El conjunto de destinos dejó de ser único; vuelve a preparar';
      end if;
    end if;
  end loop;

  pago := public.haiku_registrar_pago(
    p_reserva_id=>p_reserva_id,
    p_monto=>monto_total,
    p_medio_pago=>p_argumentos->>'p_medio_pago',
    p_etapa_operativa=>'abono',
    p_fecha_pago=>(p_argumentos->>'p_fecha_pago')::timestamptz,
    p_folio=>folio,
    p_codigo_autorizacion=>codaut,
    p_bove=>bovtar,
    p_referencia_externa=>p_argumentos->>'p_referencia_externa',
    p_observaciones=>p_argumentos->>'p_observaciones',
    p_aplicaciones=>aplicaciones_registro,
    p_modo_aplicacion=>'ninguno'
  );
  if (pago->>'aplicado')::bigint is distinct from monto_total
     or (pago->>'sin_aplicar')::bigint is distinct from 0 then
    raise exception 'Proyecto H no aplicó el total completo; se revierte la operación';
  end if;
  return pago;
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_incorporar_pago_servicios_libro_v1(p_operacion_id uuid, p_item jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_usuario uuid:=auth.uid();
  v_hash text;
  v_registro private.haiku_libro_pagos_servicio_operaciones%rowtype;
  v_reserva uuid;
  v_argumentos jsonb;
  v_origen jsonb;
  v_manual boolean;
  v_pago jsonb;
  v_pago_id uuid;
  v_resultado jsonb;
begin
  if v_usuario is null then raise exception 'Debe iniciar sesión' using errcode='42501'; end if;
  if p_operacion_id is null or jsonb_typeof(p_item) is distinct from 'object'
     or nullif(p_item->>'item_id','') is null then
    raise exception 'Operación o propuesta de pago inválida';
  end if;
  v_hash:=md5(p_item::text);
  insert into private.haiku_libro_pagos_servicio_operaciones(operacion_id,usuario_id,solicitud_hash)
    values(p_operacion_id,v_usuario,v_hash) on conflict(operacion_id) do nothing;
  select * into v_registro from private.haiku_libro_pagos_servicio_operaciones
    where operacion_id=p_operacion_id for update;
  if v_registro.usuario_id is distinct from v_usuario then
    raise exception 'La operación pertenece a otro usuario' using errcode='42501';
  end if;
  if v_registro.solicitud_hash is distinct from v_hash then
    raise exception 'La operación ya fue usada con otra propuesta';
  end if;
  if v_registro.resultado is not null then
    return v_registro.resultado||jsonb_build_object('reintento',true);
  end if;

  begin
    v_reserva:=(p_item->>'reserva_id')::uuid;
    v_argumentos:=p_item->'argumentos';
    v_origen:=p_item->'datos_origen';
    v_manual:=(p_item->>'aprobado_manualmente')::boolean;
  exception when others then
    raise exception 'Propuesta de pago incompleta o inválida';
  end;
  if v_reserva is null or jsonb_typeof(v_argumentos) is distinct from 'object'
     or jsonb_typeof(v_origen) is distinct from 'object' then
    raise exception 'Propuesta de pago incompleta o inválida';
  end if;

  if v_argumentos->>'p_medio_pago'='airbnb_prepaid_card' then
    if v_manual is distinct from true or jsonb_typeof(p_item->'item_id') is distinct from 'string'
      or nullif(btrim(p_item->>'item_id'),'') is null then
      raise exception 'Airbnb requiere aprobacion manual e identidad estable del Libro';
    end if;
    v_argumentos:=v_argumentos||jsonb_build_object('p_folio',null,'p_codigo_autorizacion',null,'p_bove',null);
    v_origen:=(v_origen-array['folio','codigo_autorizacion','bovtar','bove'])
      ||jsonb_build_object('item_id',btrim(p_item->>'item_id'));
  end if;
  if v_origen ? 'transferencia_late_checkout_sin_identificador_v1' and (
    p_item->>'item_id' is distinct from v_origen->>'item_id' or
    v_argumentos->>'p_medio_pago' is distinct from 'transferencia') then
    raise exception 'Identidad manual diferente de la fila del Libro';
  end if;
  v_origen := private.haiku_libro_medio_pago_manual_validar_v1(v_origen,v_argumentos,v_manual);
  v_pago:=private.haiku_libro_pago_servicios_v1(v_reserva,v_argumentos,v_origen,v_manual);
  v_pago_id:=nullif(v_pago->>'pago_id','')::uuid;
  if coalesce((v_pago->>'ya_existe')::boolean,false) then
    v_resultado:=jsonb_build_object('ok',true,'operacion_id',p_operacion_id,'reintento',false,
      'pagos_creados',0,'omitidos',1,'pago_id',v_pago_id,'motivo','El pago confirmado ya existe en la misma reserva');
  else
    update public.pagos
    set pagador_nombre=coalesce((select r.titular_nombre from public.reservas r where r.id=v_reserva),pagador_nombre),
        datos_origen=coalesce(datos_origen,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
          'contexto','haku_libro_pago_servicios_v1','operacion_id',p_operacion_id,
          'item_id',p_item->>'item_id','bovtar',v_origen->>'bovtar',
          'fecha_bloque',v_origen->>'fecha_bloque','origen_libro',v_origen->'origen',
          'aplicaciones_servicio_v1',v_origen->'aplicaciones_servicio_v1',
          'transferencia_late_checkout_sin_identificador_v1',v_origen->'transferencia_late_checkout_sin_identificador_v1',
          'aprobado_manualmente',v_manual, 'medio_pago_manual_v1', v_origen->'medio_pago_manual_v1'))
    where id=v_pago_id;
    v_resultado:=jsonb_build_object('ok',true,'operacion_id',p_operacion_id,'reintento',false,
      'pagos_creados',1,'omitidos',0,'pago_id',v_pago_id,
      'monto',(v_pago->>'monto')::bigint,'aplicado',(v_pago->>'aplicado')::bigint,'sin_aplicar',(v_pago->>'sin_aplicar')::bigint);
  end if;
  update private.haiku_libro_pagos_servicio_operaciones
    set resultado=v_resultado,completado_en=now() where operacion_id=p_operacion_id;
  return v_resultado;
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_libro_aplicaciones_servicio_capacidad_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion'; end if;
  return jsonb_build_object('version',1,'contrato','aplicaciones_servicio_v1',
    'rpc','haiku_incorporar_pago_servicios_libro_v1','efectivo_sin_identificador',false,
    'conceptos_adicionales',jsonb_build_array('queque','pan','huevos'),
    'servicio_faltante_manual_v1',true,
    'transferencia_late_checkout_sin_identificador_v1',true);
end;
$function$;
