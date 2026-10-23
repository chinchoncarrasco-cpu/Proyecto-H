-- Definiciones auditadas, sin registros personales. Sólo pruebas locales.
CREATE OR REPLACE FUNCTION private.haiku_libro_es_admin_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select auth.uid() is not null and coalesce(private.haiku_usuario_activo(),false) and exists(
    select 1 from public.usuario_roles ur join public.roles r on r.id=ur.rol_id
    where ur.usuario_id=auth.uid() and r.codigo='administrador' and r.activo
  );
$function$;

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
    and p_argumentos->>'p_fecha_pago' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
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
     and codaut_norm is null and (folio_norm is null or bovtar_norm is null) and v_transferencia_late_manual is distinct from true then
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
$function$;

CREATE OR REPLACE FUNCTION private.haiku_libro_transferencia_validar_v2(r uuid, a jsonb, o jsonb, final boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare e jsonb:=o->'evidencia_transferencia'; op text:=nullif(e->>'operacion_bancaria','');
  candidato record; existente uuid; cantidad integer:=0;
begin
  if coalesce(auth.uid() is null or final is distinct from true or a->>'p_medio_pago'<>'transferencia'
    or e->>'version'<>'2' or o->>'tipo_movimiento'<>'alojamiento'
    or nullif(e->>'glosa_original','') is null or nullif(e->>'numero_remitente','') is null
    or jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(o->'pagador') is distinct from 'object'
    or nullif(o#>>'{pagador,nombre}','') is null
    or o#>>'{pagador,numero_remitente}' is distinct from e->>'numero_remitente'
    or position(e->>'numero_remitente' in e->>'glosa_original')=0
    or position(o#>>'{pagador,nombre}' in e->>'glosa_original')=0
    or position(e->>'glosa_original' in coalesce(a->>'p_referencia_externa',''))=0
    or op is distinct from private.haiku_libro_operacion_bancaria_v2(a->>'p_referencia_externa')
    or nullif(o#>>'{origen,hoja}','') is null or nullif(o#>>'{origen,celda}','') is null
    or o->>'medio'<>'transferencia' or o->>'moneda'<>'CLP'
    or (o->>'monto')::bigint is distinct from (a->>'p_monto')::bigint
    or (o->>'monto')::bigint<=0
    or (e->>'fecha_recepcion')::date is distinct from (a->>'p_fecha_pago')::date
    or nullif(a->>'p_codigo_autorizacion','') is not null
    or nullif(a->>'p_folio','') is not null or nullif(a->>'p_bove','') is not null
    or nullif(o->>'bovtar','') is not null, true) then
    raise exception 'Transferencia incompleta o contradictoria; vuelve a revisar' using errcode='HLC01';
  end if;
  if (select count(*) from reserva_estadias re join cabanas c on c.id=re.cabana_id
      where re.reserva_id=r and re.fecha_ingreso=(o->>'fecha_bloque')::date
        and c.numero=(o->>'cabana')::integer and re.estado_estadia not in ('cancelada','no_show'))<>1 then
    raise exception 'Destino de transferencia no inequívoco; vuelve a revisar' using errcode='HLC01';
  end if;
  -- Serializa las confirmaciones bancarias del Libro antes de consultar candidatos.
  -- No convierte el remitente ni las coordenadas en una clave de transacción.
  perform pg_advisory_xact_lock(hashtext('haku-libro-transferencias-v2'));
  for candidato in select p.* from pagos p
    where p.tipo_movimiento='pago' and (
      (op is not null and coalesce(p.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}',private.haiku_libro_operacion_bancaria_v2(p.referencia_externa))=op)
      or (p.monto=(a->>'p_monto')::bigint and coalesce(p.moneda,'CLP')='CLP'
        and (p.fecha_pago is null or (p.fecha_pago at time zone 'America/Santiago')::date=(a->>'p_fecha_pago')::date
          or (p.fecha_pago at time zone 'UTC')::date=(a->>'p_fecha_pago')::date)
        and (p.reserva_id=r and p.medio_pago='transferencia'
          or p.datos_origen#>>'{pagador,numero_remitente}'=e->>'numero_remitente'
          or position(e->>'numero_remitente' in coalesce(p.referencia_externa,''))>0)
        and not (op is not null and coalesce(p.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}',private.haiku_libro_operacion_bancaria_v2(p.referencia_externa)) is not null
          and coalesce(p.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}',private.haiku_libro_operacion_bancaria_v2(p.referencia_externa))<>'!REVISION!'
          and op<>coalesce(p.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}',private.haiku_libro_operacion_bancaria_v2(p.referencia_externa)))))
  loop
    cantidad:=cantidad+1;
    if op is null or candidato.datos_origen#>>'{evidencia_transferencia,operacion_bancaria}' is distinct from op
      or candidato.reserva_id<>r or candidato.estado<>'confirmado' or candidato.medio_pago<>'transferencia'
      or candidato.monto<>(a->>'p_monto')::bigint or candidato.moneda<>'CLP'
      or ((candidato.fecha_pago at time zone 'America/Santiago')::date is distinct from (a->>'p_fecha_pago')::date
        and (candidato.fecha_pago at time zone 'UTC')::date is distinct from (a->>'p_fecha_pago')::date)
      or candidato.datos_origen#>>'{pagador,numero_remitente}' is distinct from e->>'numero_remitente'
      or candidato.datos_origen#>>'{pagador,nombre}' is distinct from o#>>'{pagador,nombre}' then
      raise exception 'Transferencia posiblemente duplicada o contradictoria; vuelve a revisar' using errcode='HLC01';
    end if;
    existente:=candidato.id;
  end loop;
  if cantidad>1 then raise exception 'Múltiples candidatos bancarios; vuelve a revisar' using errcode='HLC01'; end if;
  return existente;
end;
$function$;

CREATE OR REPLACE FUNCTION public.haiku_incorporar_libro_v1(p_operacion_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_usuario_id uuid := auth.uid();
  v_hash text;
  v_registro private.haiku_libro_incorporaciones%rowtype;
  v_item jsonb;
  v_tipo text;
  v_item_id text;
  v_reserva jsonb;
  v_estadias jsonb;
  v_estadia jsonb;
  v_datos jsonb;
  v_resultado jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_omitidos jsonb := '[]'::jsonb;
  v_referencias jsonb := '{}'::jsonb;
  v_items_vistos text[] := array[]::text[];
  v_reserva_id uuid;
  v_reserva_existente uuid;
  v_coincidencia uuid;
  v_coincidencias integer;
  v_estadias_coincidentes integer;
  v_indice integer;
  v_cantidad integer;
  v_documento text;
  v_rut text;
  v_pago jsonb;
  v_argumentos jsonb;
  v_origen jsonb;
  v_pago_id uuid;
  v_pago_existente uuid;
  v_monto bigint;
  v_medio text;
  v_fecha_pago timestamptz;
  v_folio text;
  v_codaut text;
  v_bove text;
  v_bovtar text;
  v_fuerte boolean;
  v_manual boolean;
  v_creadas integer := 0;
  v_estadias_agregadas integer := 0;
  v_pagos_creados integer := 0;
  v_actualizaciones integer := 0;
  v_respuesta jsonb;
begin
  if v_usuario_id is null then
    raise exception 'Debe iniciar sesion para incorporar reservas y pagos';
  end if;
  if p_operacion_id is null then
    raise exception 'Falta el identificador de la operacion';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Los elementos deben enviarse como un arreglo';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) < 1 then
    raise exception 'Selecciona al menos una reserva, estadia o pago';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'La incorporacion admite como maximo 100 elementos';
  end if;

  -- Serializa las incorporaciones con cualquier otra escritura sobre estas tablas.
  -- La espera es breve y evita que dos confirmaciones atraviesen la misma revision.
  lock table public.reserva_estadias in share row exclusive mode;
  lock table public.pagos in share row exclusive mode;

  -- Canonical operation types for validation, hashing and every execution path.
  select jsonb_agg(item || jsonb_build_object(
      'tipo', lower(btrim(coalesce(item ->> 'tipo', '')))) order by posicion)
    into p_items from jsonb_array_elements(p_items) with ordinality as entrada(item,posicion);
  v_hash := md5(p_items::text);
  insert into private.haiku_libro_incorporaciones(
    operacion_id, usuario_id, solicitud_hash
  ) values (p_operacion_id, v_usuario_id, v_hash)
  on conflict (operacion_id) do nothing;

  select * into v_registro
  from private.haiku_libro_incorporaciones
  where operacion_id = p_operacion_id
  for update;

  if v_registro.usuario_id is distinct from v_usuario_id then
    raise exception 'La operacion pertenece a otro usuario' using errcode = '42501';
  end if;
  if v_registro.solicitud_hash is distinct from v_hash then
    raise exception 'El identificador ya fue usado con otra seleccion';
  end if;
  if v_registro.resultado is not null then
    return v_registro.resultado || jsonb_build_object('reintento', true);
  end if;

  perform private.haiku_libro_validar_ocupaciones_lote_v1(p_items);
  -- Primero crea las reservas nuevas para resolver las referencias simbolicas.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_tipo := lower(btrim(coalesce(v_item ->> 'tipo', '')));
    v_item_id := nullif(btrim(coalesce(v_item ->> 'item_id', '')), '');
    if v_item_id is null or v_item_id = any(v_items_vistos) then
      raise exception 'Cada elemento requiere un identificador unico';
    end if;
    v_items_vistos := array_append(v_items_vistos, v_item_id);
    if v_tipo not in ('reserva_nueva', 'estadia', 'pago', 'reserva_actualizar', 'pago_actualizar') then
      raise exception 'Tipo de elemento no admitido: %', coalesce(v_tipo, '');
    end if;
    continue when v_tipo <> 'reserva_nueva';

    if not private.haiku_tiene_permiso('reservas.crear') then
      raise exception 'Sin permiso para crear reservas' using errcode = '42501';
    end if;
    v_reserva := coalesce(v_item -> 'reserva', '{}'::jsonb);
    v_estadias := coalesce(v_item -> 'estadias', '[]'::jsonb);
    if jsonb_typeof(v_reserva) <> 'object'
       or nullif(btrim(coalesce(v_reserva ->> 'titular_nombre', '')), '') is null then
      raise exception 'La reserva % requiere titular', v_item_id;
    end if;
    if jsonb_typeof(v_estadias) <> 'array'
       or jsonb_array_length(v_estadias) < 1
       or jsonb_array_length(v_estadias) > 11 then
      raise exception 'La reserva % requiere entre 1 y 11 estadias', v_item_id;
    end if;

    -- Si toda la reserva aparecio entretanto, se reutiliza como destino y se omite.
    v_reserva_existente := null;
    v_estadias_coincidentes := 0;
    for v_estadia in select value from jsonb_array_elements(v_estadias)
    loop
      v_datos := coalesce(v_estadia -> 'datos', '{}'::jsonb);
      select count(distinct re.reserva_id), min(re.reserva_id::text)::uuid
        into v_coincidencias, v_coincidencia
      from public.reserva_estadias re
      join public.cabanas c on c.id = re.cabana_id
      join public.reservas r on r.id = re.reserva_id
      where re.estado_estadia not in ('cancelada', 'no_show')
        and r.estado_reserva <> 'cancelada'
        and c.numero = (v_estadia ->> 'cabana_numero')::smallint
        and re.fecha_ingreso = (v_datos ->> 'fecha_ingreso')::date
        and re.fecha_salida = (v_datos ->> 'fecha_salida')::date
        and re.tipo_estadia = lower(v_datos ->> 'tipo_estadia')
        and regexp_replace(translate(lower(r.titular_nombre), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', '', 'g')
          = regexp_replace(translate(lower(v_reserva ->> 'titular_nombre'), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', '', 'g')
        and (
          nullif(regexp_replace(upper(coalesce(v_reserva ->> 'titular_numero_documento', '')), '[^0-9A-Z]', '', 'g'), '') is null
          or nullif(regexp_replace(upper(coalesce(r.titular_numero_documento, '')), '[^0-9A-Z]', '', 'g'), '') is null
          or regexp_replace(upper(r.titular_numero_documento), '[^0-9A-Z]', '', 'g')
             = regexp_replace(upper(v_reserva ->> 'titular_numero_documento'), '[^0-9A-Z]', '', 'g')
        );
      if v_coincidencias > 1 then
        raise exception 'La reserva % ahora tiene mas de una coincidencia; vuelve a preparar', v_item_id;
      end if;
      if v_coincidencia is not null then
        v_estadias_coincidentes := v_estadias_coincidentes + 1;
        if v_reserva_existente is null then
          v_reserva_existente := v_coincidencia;
        elsif v_reserva_existente is distinct from v_coincidencia then
          raise exception 'Las estadias de % ahora pertenecen a reservas distintas; vuelve a preparar', v_item_id;
        end if;
      end if;
    end loop;

    if v_estadias_coincidentes = jsonb_array_length(v_estadias) then
      v_referencias := v_referencias || jsonb_build_object(v_item_id, v_reserva_existente::text);
      v_omitidos := v_omitidos || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id, 'tipo', v_tipo, 'reserva_id', v_reserva_existente,
        'motivo', 'La reserva ya existe en Proyecto H'
      ));
      continue;
    elsif v_estadias_coincidentes > 0 then
      raise exception 'Parte de la reserva % aparecio entretanto; vuelve a preparar', v_item_id;
    end if;

    v_estadia := v_estadias -> 0;
    v_datos := v_estadia -> 'datos';
    v_documento := nullif(btrim(coalesce(v_reserva ->> 'titular_numero_documento', '')), '');
    if v_reserva->>'titular_tipo_documento'='rut' and v_documento is not null
      and private.haiku_rut_clave_v1(v_documento) is null then
      raise exception 'RUT inválido; requiere revisión manual' using errcode='HLI03';
    end if;
    v_rut := case
      when v_reserva->>'titular_tipo_documento'='rut' then v_documento
      when nullif(v_reserva->>'titular_tipo_documento','') is null
        and v_documento ~* '^[0-9]{1,2}(\.?[0-9]{3}){2}-?[0-9k]$' then v_documento
      else null
    end;

    v_resultado := public.haiku_crear_reserva(
      p_titular_nombre => v_reserva ->> 'titular_nombre',
      p_cabana_numero => (v_estadia ->> 'cabana_numero')::smallint,
      p_fecha_ingreso => (v_datos ->> 'fecha_ingreso')::date,
      p_fecha_salida => (v_datos ->> 'fecha_salida')::date,
      p_adultos => (v_datos ->> 'adultos')::smallint,
      p_ninos => coalesce((v_datos ->> 'ninos')::smallint, 0::smallint),
      p_mascotas => coalesce((v_datos ->> 'mascotas')::smallint, 0::smallint),
      p_correo_contacto => nullif(v_reserva ->> 'correo_contacto', ''),
      p_telefono_contacto => nullif(v_reserva ->> 'telefono_contacto', ''),
      p_rut => v_rut,
      p_observaciones => nullif(v_reserva ->> 'observaciones', ''),
      p_tarifas => case when lower(v_datos ->> 'tipo_estadia') = 'fullday'
        then jsonb_build_object(v_datos ->> 'fecha_ingreso',
          private.haiku_libro_tarifa_fullday_adl(v_datos -> 'adultos'))
        else '{}'::jsonb end,
      p_acompanantes => '[]'::jsonb,
      p_tipo_estadia => lower(v_datos ->> 'tipo_estadia'),
      p_cloudbeds_id => null
    );
    v_reserva_id := (v_resultado ->> 'reserva_id')::uuid;
    -- La clave para identificar huéspedes conserva su semántica y validación.
    -- El documento visible de esta reserva nueva usa el formato canónico.
    if v_rut is not null then
      update public.reservas
      set titular_numero_documento = lower(
        left(private.haiku_rut_clave_v1(v_rut), -1) || '-' ||
        right(private.haiku_rut_clave_v1(v_rut), 1))
      where id = v_reserva_id and titular_tipo_documento = 'rut';
    end if;

    if v_documento is not null and v_rut is null then
      update public.reservas
      set titular_tipo_documento = coalesce(nullif(v_reserva->>'titular_tipo_documento',''),case when v_documento ~* '[a-z]' then 'pasaporte' else 'documento' end),
          titular_numero_documento = v_documento
      where id = v_reserva_id;
      update public.huespedes h
      set tipo_documento = coalesce(nullif(v_reserva->>'titular_tipo_documento',''),case when v_documento ~* '[a-z]' then 'pasaporte' else 'documento' end),
          numero_documento = v_documento
      from public.reservas r
      where r.id = v_reserva_id and h.id = r.titular_huesped_id;
    end if;

    v_referencias := v_referencias || jsonb_build_object(v_item_id, v_reserva_id::text);
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'item_id', v_item_id, 'tipo', v_tipo, 'reserva_id', v_reserva_id,
      'codigo_haiku', v_resultado ->> 'codigo_haiku'
    ));
    v_creadas := v_creadas + 1;

    v_cantidad := jsonb_array_length(v_estadias);
    if v_cantidad > 1 then
      for v_indice in 1..(v_cantidad - 1)
      loop
        v_resultado := private.haiku_libro_agregar_estadia_v1(v_reserva_id, v_estadias -> v_indice);
        if not coalesce((v_resultado ->> 'omitida')::boolean, false) then
          v_estadias_agregadas := v_estadias_agregadas + 1;
        end if;
      end loop;
    end if;
  end loop;

  -- Luego agrega estadias a reservas que ya existian.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_tipo := lower(btrim(coalesce(v_item ->> 'tipo', '')));
    continue when v_tipo <> 'estadia';
    v_item_id := v_item ->> 'item_id';
    if not private.haiku_tiene_permiso('reservas.editar') then
      raise exception 'Sin permiso para editar reservas' using errcode = '42501';
    end if;
    begin
      v_reserva_id := (v_item ->> 'reserva_id')::uuid;
    exception when others then
      raise exception 'La estadia % no tiene una reserva destino valida', v_item_id;
    end;
    v_estadias := coalesce(v_item -> 'estadias', '[]'::jsonb);
    if jsonb_typeof(v_estadias) <> 'array' or jsonb_array_length(v_estadias) < 1 then
      raise exception 'El elemento % no contiene estadias', v_item_id;
    end if;
    for v_estadia in select value from jsonb_array_elements(v_estadias)
    loop
      v_resultado := private.haiku_libro_agregar_estadia_v1(v_reserva_id, v_estadia);
      if coalesce((v_resultado ->> 'omitida')::boolean, false) then
        v_omitidos := v_omitidos || jsonb_build_array(jsonb_build_object(
          'item_id', v_item_id, 'tipo', v_tipo,
          'estadia_id', v_resultado ->> 'estadia_id',
          'motivo', v_resultado ->> 'motivo'
        ));
      else
        v_estadias_agregadas := v_estadias_agregadas + 1;
        v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
          'item_id', v_item_id, 'tipo', v_tipo, 'reserva_id', v_reserva_id,
          'estadia_id', v_resultado ->> 'estadia_id'
        ));
      end if;
    end loop;
  end loop;

  -- Finalmente registra los pagos y resuelve los destinos recien creados.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_tipo := lower(btrim(coalesce(v_item ->> 'tipo', '')));
    continue when v_tipo <> 'pago';
    v_item_id := v_item ->> 'item_id';
    if not private.haiku_tiene_permiso('pagos.registrar') then
      raise exception 'Sin permiso para registrar pagos' using errcode = '42501';
    end if;

    begin
      if nullif(v_item ->> 'reserva_id', '') is not null then
        v_reserva_id := (v_item ->> 'reserva_id')::uuid;
      else
        v_reserva_id := nullif(v_referencias ->> (v_item ->> 'reserva_ref'), '')::uuid;
      end if;
    exception when others then
      raise exception 'El pago % no tiene una reserva destino valida', v_item_id;
    end;
    if v_reserva_id is null or not exists (
      select 1 from public.reservas r
      where r.id = v_reserva_id and r.estado_reserva <> 'cancelada'
    ) then
      raise exception 'La reserva destino del pago % ya no esta disponible', v_item_id;
    end if;

    v_argumentos := coalesce(v_item -> 'argumentos', '{}'::jsonb);
    v_origen := coalesce(v_item -> 'datos_origen', '{}'::jsonb);
    begin
      v_monto := (v_argumentos ->> 'p_monto')::bigint;
      v_fecha_pago := (v_argumentos ->> 'p_fecha_pago')::timestamptz;
    exception when others then
      raise exception 'El pago % tiene monto o fecha invalidos', v_item_id;
    end;
    v_medio := lower(btrim(coalesce(v_argumentos ->> 'p_medio_pago', '')));
    v_folio := nullif(btrim(coalesce(v_argumentos ->> 'p_folio', '')), '');
    v_codaut := nullif(btrim(coalesce(v_argumentos ->> 'p_codigo_autorizacion', '')), '');
    v_bove := nullif(btrim(coalesce(v_argumentos ->> 'p_bove', '')), '');
    v_bovtar := nullif(btrim(coalesce(v_origen ->> 'bovtar', '')), '');
    v_manual := coalesce((v_item ->> 'aprobado_manualmente')::boolean, false);
    v_fuerte := v_codaut is not null or v_bove is not null or (v_folio is not null and v_bovtar is not null);
    if v_medio='airbnb_prepaid_card' then
      v_fuerte:=false; v_folio:=null; v_codaut:=null; v_bovtar:=null; v_bove:=null;
      v_argumentos:=v_argumentos||jsonb_build_object('p_folio',null,'p_codigo_autorizacion',null,'p_bove',null);
      v_origen:=v_origen-array['folio','codigo_autorizacion','bovtar','bove'];
    end if;

  v_origen := private.haiku_libro_medio_pago_manual_validar_v1(v_origen,v_argumentos,v_manual or (v_medio='transferencia' and v_origen#>>'{evidencia_transferencia,version}'='2' and coalesce((v_item->>'confirmacion_final')::boolean,false)));
    if v_monto is null or v_monto <= 0 or v_fecha_pago is null then
      raise exception 'El pago % requiere monto y fecha del comprobante', v_item_id;
    end if;
    if v_medio not in ('transferencia', 'webpay_credito', 'webpay_debito', 'tarjeta_credito', 'tarjeta_debito', 'efectivo','airbnb_prepaid_card') then
      raise exception 'El pago % tiene un medio no admitido', v_item_id;
    end if;
    if not v_fuerte and not v_manual and not (v_medio='transferencia' and coalesce(v_origen#>>'{evidencia_transferencia,version}'='2',false) and coalesce((v_item->>'confirmacion_final')::boolean,false)) then
      raise exception 'El pago % no tiene identificador fuerte ni aprobacion manual', v_item_id;
    end if;
    if nullif(v_origen ->> 'fecha_bloque', '') is null or not exists (
      select 1 from public.reserva_estadias re
      where re.reserva_id = v_reserva_id
        and re.estado_estadia not in ('cancelada', 'no_show')
        and re.fecha_ingreso = (v_origen ->> 'fecha_bloque')::date
    ) then
      raise exception 'El pago % no corresponde al bloque del dia de Check-In', v_item_id;
    end if;

    v_pago_existente := null;
    if v_medio='transferencia' and v_origen#>>'{evidencia_transferencia,version}'='2' then
      -- La fecha de recepción del Libro es un día civil de Chile, no medianoche UTC.
      v_fecha_pago:=((v_argumentos->>'p_fecha_pago')::date + time '12:00') at time zone 'America/Santiago';
      v_pago_existente:=private.haiku_libro_transferencia_validar_v2(v_reserva_id,v_argumentos,v_origen,
        coalesce((v_item->>'confirmacion_final')::boolean,false));
    else
    select p.id into v_pago_existente
    from public.pagos p
    where p.tipo_movimiento = 'pago'
      and p.estado <> 'anulado'
      and (
        (v_codaut is not null and regexp_replace(upper(coalesce(p.codigo_autorizacion, '')), '[^0-9A-Z]', '', 'g')
          = regexp_replace(upper(v_codaut), '[^0-9A-Z]', '', 'g'))
        or (v_bove is not null and regexp_replace(upper(coalesce(p.bove, '')), '[^0-9A-Z]', '', 'g')
          = regexp_replace(upper(v_bove), '[^0-9A-Z]', '', 'g'))
        or (v_folio is not null and v_bovtar is not null
          and regexp_replace(upper(coalesce(p.folio, '')), '[^0-9A-Z]', '', 'g') = regexp_replace(upper(v_folio), '[^0-9A-Z]', '', 'g')
          and regexp_replace(upper(coalesce(p.datos_origen ->> 'bovtar', p.bove, '')), '[^0-9A-Z]', '', 'g') = regexp_replace(upper(v_bovtar), '[^0-9A-Z]', '', 'g'))
        or (coalesce(p.datos_origen ->> 'item_id', '') = v_item_id)
      )
    order by p.creado_en, p.id
    limit 1;
    end if;

    if v_pago_existente is not null then
      v_omitidos := v_omitidos || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id, 'tipo', v_tipo, 'pago_id', v_pago_existente,
        'motivo', 'El pago ya existe por identificador fuerte o corresponde al mismo movimiento ya incorporado por Haku'
      ));
      continue;
    end if;

    if v_origen ? 'distribucion_manual' then
      v_pago := private.haiku_libro_pago_distribuido_v1(v_reserva_id,v_argumentos,v_origen,v_manual);
    else
    v_pago := public.haiku_registrar_pago(
      p_reserva_id => v_reserva_id,
      p_monto => v_monto,
      p_medio_pago => v_medio,
      p_etapa_operativa => 'abono',
      p_fecha_pago => v_fecha_pago,
      p_folio => v_folio,
      p_codigo_autorizacion => v_codaut,
      p_bove => coalesce(v_bove, v_bovtar),
      p_referencia_externa => nullif(v_argumentos ->> 'p_referencia_externa', ''),
      p_observaciones => nullif(v_argumentos ->> 'p_observaciones', ''),
      p_aplicaciones => '[]'::jsonb,
      p_modo_aplicacion => 'alojamiento'
    );
    end if;
    v_pago_id := (v_pago ->> 'pago_id')::uuid;

    update public.pagos
    set pagador_nombre = coalesce(case when v_medio='transferencia' and v_origen#>>'{evidencia_transferencia,version}'='2' then v_origen#>>'{pagador,nombre}' end, (select r.titular_nombre from public.reservas r where r.id = v_reserva_id), pagador_nombre),
        datos_origen = coalesce(datos_origen, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'contexto', 'haku_libro_incorporacion',
          'operacion_id', p_operacion_id,
          'item_id', v_item_id,
          'bovtar', v_bovtar,
          'fecha_bloque', v_origen ->> 'fecha_bloque',
          'origen_libro', v_origen -> 'origen',
          'pagador', case when v_medio='transferencia' then v_origen->'pagador' end, 'evidencia_transferencia', case when v_medio='transferencia' then v_origen->'evidencia_transferencia' end, 'confirmacion_final', case when v_medio='transferencia' and v_origen#>>'{evidencia_transferencia,version}'='2' then coalesce((v_item->>'confirmacion_final')::boolean,false) end, 'aprobado_manualmente', v_manual, 'medio_pago_manual_v1', v_origen->'medio_pago_manual_v1'
        ))
    where id = v_pago_id;

    v_pagos_creados := v_pagos_creados + 1;
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'item_id', v_item_id, 'tipo', v_tipo, 'reserva_id', v_reserva_id,
      'pago_id', v_pago_id, 'monto', v_monto
    ));
  end loop;

  -- Apply the state shown in the preview only to records actually created
  -- by this operation, never to duplicates skipped during revalidation.
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_tipo := v_item->>'tipo';
    continue when v_tipo not in ('reserva_nueva','estadia');
    v_item_id := v_item->>'item_id';
    continue when not exists(select 1 from jsonb_array_elements(v_resultados) x where x->>'item_id'=v_item_id);
    v_reserva_id := case when v_tipo='reserva_nueva' then (v_referencias->>v_item_id)::uuid else (v_item->>'reserva_id')::uuid end;
    for v_estadia in select value from jsonb_array_elements(v_item->'estadias') loop
      v_datos:=v_estadia->'datos';
      continue when not (v_datos ? 'estado_estadia');
      if v_datos->>'estado_estadia' not in ('pendiente','confirmada','hospedada','checked_out') then raise exception 'Estado del Libro no admitido'; end if;
      update public.reserva_estadias e set estado_estadia=v_datos->>'estado_estadia'
      from public.cabanas c where c.id=e.cabana_id and e.reserva_id=v_reserva_id
        and c.numero=(v_estadia->>'cabana_numero')::smallint and e.fecha_ingreso=(v_datos->>'fecha_ingreso')::date
        and e.fecha_salida=(v_datos->>'fecha_salida')::date and e.tipo_estadia=v_datos->>'tipo_estadia'
        and (v_tipo='reserva_nueva' or exists(select 1 from jsonb_array_elements(v_resultados) x where x->>'item_id'=v_item_id and x->>'estadia_id'=e.id::text));
    end loop;
    update public.reservas set estado_reserva=case
      when exists(select 1 from public.reserva_estadias where reserva_id=v_reserva_id and estado_estadia='hospedada') then 'hospedada'
      when not exists(select 1 from public.reserva_estadias where reserva_id=v_reserva_id and estado_estadia not in ('checked_out','cancelada','no_show')) then 'checked_out'
      when exists(select 1 from public.reserva_estadias where reserva_id=v_reserva_id and estado_estadia='confirmada') then 'confirmada' else 'pendiente' end where id=v_reserva_id;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item->>'tipo' in ('reserva_actualizar','pago_actualizar') then
      v_resultado := private.haiku_libro_actualizar_v1(v_item);
      v_resultados := v_resultados || jsonb_build_array(v_resultado);
      v_actualizaciones := v_actualizaciones + 1;
    end if;
  end loop;

  v_respuesta := jsonb_build_object(
    'ok', true,
    'operacion_id', p_operacion_id,
    'reintento', false,
    'reservas_creadas', v_creadas,
    'estadias_agregadas', v_estadias_agregadas,
    'pagos_creados', v_pagos_creados,
    'actualizaciones', v_actualizaciones,
    'omitidos', jsonb_array_length(v_omitidos),
    'detalle_omitidos', v_omitidos,
    'resultados', v_resultados
  );

  update private.haiku_libro_incorporaciones
  set resultado = v_respuesta, completado_en = now()
  where operacion_id = p_operacion_id;

  return v_respuesta;
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

CREATE OR REPLACE FUNCTION public.haiku_libro_transferencias_capacidad_v2()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    select jsonb_build_object('version',2,'confirmacion_final',md5(replace(prosrc,chr(13),''))='a448127813289c3a2baf5ce4faf6e110')
    from pg_proc where oid='public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure $function$;

CREATE OR REPLACE FUNCTION public.haiku_registrar_pago(p_reserva_id uuid, p_monto bigint, p_medio_pago text, p_etapa_operativa text DEFAULT 'abono'::text, p_fecha_pago timestamp with time zone DEFAULT now(), p_folio text DEFAULT NULL::text, p_codigo_autorizacion text DEFAULT NULL::text, p_bove text DEFAULT NULL::text, p_referencia_externa text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_aplicaciones jsonb DEFAULT '[]'::jsonb, p_modo_aplicacion text DEFAULT 'alojamiento'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pago_id uuid;
  v_item jsonb;
  v_cargo_id uuid;
  v_monto_aplicar bigint;
  v_restante bigint;
  v_aplicado bigint := 0;
  v_cargo record;
begin
  if p_medio_pago='airbnb_prepaid_card' then
    p_folio:=null; p_codigo_autorizacion:=null; p_bove:=null;
  end if;
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para registrar pagos';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor que cero';
  end if;

  if p_modo_aplicacion not in ('alojamiento','todo','ninguno') then
    raise exception 'Modo de aplicación inválido';
  end if;

  if jsonb_typeof(coalesce(p_aplicaciones, '[]'::jsonb)) <> 'array' then
    raise exception 'Las aplicaciones deben enviarse como arreglo JSON';
  end if;

  insert into public.pagos (
    reserva_id, monto, moneda, tipo_movimiento, etapa_operativa,
    medio_pago, estado, fecha_pago, folio, codigo_autorizacion,
    bove, referencia_externa, observaciones, creado_por
  ) values (
    p_reserva_id,
    p_monto,
    'CLP',
    'pago',
    p_etapa_operativa,
    p_medio_pago,
    'confirmado',
    coalesce(p_fecha_pago, now()),
    nullif(btrim(coalesce(p_folio,'')), ''),
    nullif(btrim(coalesce(p_codigo_autorizacion,'')), ''),
    nullif(btrim(coalesce(p_bove,'')), ''),
    nullif(btrim(coalesce(p_referencia_externa,'')), ''),
    nullif(btrim(coalesce(p_observaciones,'')), ''),
    auth.uid()
  )
  returning id into v_pago_id;

  v_restante := p_monto;

  if jsonb_array_length(coalesce(p_aplicaciones, '[]'::jsonb)) > 0 then
    for v_item in select value from jsonb_array_elements(p_aplicaciones)
    loop
      v_cargo_id := nullif(v_item ->> 'cargo_id', '')::uuid;
      v_monto_aplicar := (v_item ->> 'monto')::bigint;

      if v_cargo_id is null or v_monto_aplicar is null or v_monto_aplicar <= 0 then
        raise exception 'Aplicación de pago inválida';
      end if;

      insert into public.pago_aplicaciones (pago_id, cargo_id, monto_aplicado)
      values (v_pago_id, v_cargo_id, v_monto_aplicar);

      v_aplicado := v_aplicado + v_monto_aplicar;
      v_restante := v_restante - v_monto_aplicar;
    end loop;
  elsif p_modo_aplicacion <> 'ninguno' then
    for v_cargo in
      select ec.cargo_id, ec.saldo_cargo, ec.tipo_cargo, c.creado_en
      from public.vista_estado_cargos ec
      join public.cargos c on c.id = ec.cargo_id
      where ec.reserva_id = p_reserva_id
        and ec.estado = 'activo'
        and ec.saldo_cargo > 0
        and (p_modo_aplicacion = 'todo' or ec.tipo_cargo = 'alojamiento')
      order by
        case when ec.tipo_cargo = 'alojamiento' then 0 else 1 end,
        c.creado_en,
        ec.cargo_id
    loop
      exit when v_restante <= 0;
      v_monto_aplicar := least(v_restante, v_cargo.saldo_cargo);

      insert into public.pago_aplicaciones (pago_id, cargo_id, monto_aplicado)
      values (v_pago_id, v_cargo.cargo_id, v_monto_aplicar);

      v_aplicado := v_aplicado + v_monto_aplicar;
      v_restante := v_restante - v_monto_aplicar;
    end loop;
  end if;

  if p_etapa_operativa = 'abono' then
    update public.reservas
      set estado_reserva = 'confirmada'
    where id = p_reserva_id
      and estado_reserva = 'pendiente';

    update public.reserva_estadias
      set estado_estadia = 'confirmada'
    where reserva_id = p_reserva_id
      and estado_estadia = 'pendiente';
  end if;

  return jsonb_build_object(
    'pago_id', v_pago_id,
    'monto', p_monto,
    'aplicado', v_aplicado,
    'sin_aplicar', greatest(v_restante, 0),
    'etapa_operativa', p_etapa_operativa,
    'medio_pago', p_medio_pago
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.haiku_libro_validar_ocupaciones_lote_v1(p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare i jsonb; e jsonb; v_tipo text; c text;
begin
  -- Importer canonicalizes tipo before hashing/execution. Use that same value.
  -- Lock all referenced decisions in a stable order before validating latest revisions.
  for c in select distinct md5((e.value -> 'libro_origen')::text)
    from jsonb_array_elements(p_items) i
    cross join lateral jsonb_array_elements(coalesce(i.value -> 'estadias','[]'::jsonb)) e
    where i.value ->> 'tipo' = 'reserva_nueva' and e.value ? 'resolucion_manual'
    order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || c,0));
  end loop;
  for i in select value from jsonb_array_elements(p_items) loop
    v_tipo := i ->> 'tipo';
    if i ?| array['resolucion_manual','ocupacion_manual','libro_origen']
      or coalesce((i -> 'estadia') ?| array['resolucion_manual','ocupacion_manual','libro_origen'],false) then
      raise exception 'Ocupacion manual V1 solo permite crear reservas nuevas; requiere revision manual'
        using errcode = 'HLC02';
    end if;
    for e in select value from jsonb_array_elements(coalesce(i -> 'estadias','[]'::jsonb)) loop
      continue when not (e ?| array['resolucion_manual','ocupacion_manual','libro_origen']);
      if v_tipo is distinct from 'reserva_nueva' then
        raise exception 'Ocupacion manual V1 solo permite crear reservas nuevas; requiere revision manual'
          using errcode = 'HLC02';
      end if;
      if auth.uid() is null or private.haiku_tiene_permiso('reservas.crear') is not true then
        raise exception 'Sin permiso para crear reservas con ocupacion manual' using errcode = '42501';
      end if;
      perform private.haiku_libro_validar_resolucion_v1(
        e -> 'resolucion_manual',e -> 'libro_origen',e -> 'datos',e -> 'cabana_numero',
        i -> 'reserva' ->> 'titular_nombre');
      perform private.haiku_libro_validar_ocupacion_v1(e -> 'datos',e -> 'datos' ->> 'tipo_estadia');
    end loop;
  end loop;
end;
$function$;

