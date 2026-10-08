-- Servicios del Libro: resolución durable sólo al crear, sin tocar Pagos ni filas históricas.
begin;

alter table public.servicios add column libro_resolucion_manual_v1 jsonb;
comment on column public.servicios.libro_resolucion_manual_v1 is
  'Evidencia y resolución manual V1 validada al incorporar un servicio nuevo del Libro; inmutable.';

-- FOR SHARE requiere privilegio UPDATE. El operador no necesita editar catálogo:
-- este helper privado sólo lee/bloquea siete filas autorizadas, sin escrituras.
create function private.haiku_libro_servicio_manual_catalogo_v1(p_codigo text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $function$
declare c public.catalogo_servicios%rowtype;
begin
  if auth.uid() is null or not private.haiku_usuario_activo() or not private.haiku_tiene_permiso('servicios.crear')
    or p_codigo is null or p_codigo not in ('tinajaTonel','tinajaJacuzzi','masajeTerapeutico30','masajeTerapeutico60',
      'masajeDescontracturante30','masajeDescontracturante60','lateCheckout') then raise exception 'Catálogo no autorizado'; end if;
  select * into c from public.catalogo_servicios where codigo=p_codigo for share;
  if not found or not c.activo then raise exception 'Catálogo inactivo o inexistente'; end if;
  return jsonb_build_object('id',c.id,'codigo',c.codigo,'activo',c.activo,'unidad',c.unidad,
    'precio_base',c.precio_base,'duracion_minutos',c.duracion_minutos,'capacidad_incluida',c.capacidad_incluida,
    'capacidad_maxima',c.capacidad_maxima,'precio_persona_adicional',c.precio_persona_adicional,
    'permite_cortesia',c.permite_cortesia,'requiere_horario',c.requiere_horario);
end;
$function$;
revoke all on function private.haiku_libro_servicio_manual_catalogo_v1(text) from public,anon;
grant execute on function private.haiku_libro_servicio_manual_catalogo_v1(text) to authenticated;

create function private.haiku_libro_servicio_manual_validar_v1(p_item jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private
as $function$
<<manual>>
declare
  d jsonb := p_item->'servicio_manual_v1';
  c public.catalogo_servicios%rowtype;
  r public.reservas%rowtype;
  e public.reserva_estadias%rowtype;
  s public.servicios%rowtype;
  codigo text := p_item->>'codigo_servicio';
  cantidad integer := (p_item->>'cantidad')::integer;
  personas integer := (p_item->>'personas')::integer;
  fecha date := (p_item->>'fecha_servicio')::date;
  hora time := (p_item->>'hora')::time;
  fin time;
  minutos integer;
  unitario bigint;
  adicional bigint := 0;
  total bigint;
  candidatos integer;
  cat jsonb;
  destino jsonb;
  resuelto jsonb;
  elegido timestamptz;
begin
  if not p_item ? 'servicio_manual_v1' then return null; end if;
  if auth.uid() is null or not private.haiku_usuario_activo()
     or not private.haiku_tiene_permiso('servicios.crear') then
    raise exception 'Sin permiso para resolver servicios del Libro';
  end if;
  if jsonb_typeof(d) is distinct from 'object' or d->>'version' is distinct from '1'
     or d->>'usuario' is distinct from auth.uid()::text or d->>'item_id' is distinct from p_item->>'item_id'
     or coalesce(d->>'item_id','') !~ '^srv:[a-z0-9]+$'
     or d->'evidencia_original'->>'semantica' is distinct from 'SERVICIO_REAL'
     or jsonb_typeof(d->'evidencia_original') is distinct from 'object'
     or jsonb_typeof(d->'origen'->'hoja') is distinct from 'string'
     or jsonb_typeof(d->'origen'->'celda') is distinct from 'string'
     or nullif(btrim(d->'evidencia_original'->>'texto'),'') is null
     or length(d->'evidencia_original'->>'texto') > 16000
     or position('[HAKU-LIBRO-SERVICIO:' in d->'evidencia_original'->>'texto')>0
     or nullif(btrim(d->'origen'->>'hoja'),'') is null
     or nullif(btrim(d->'origen'->>'celda'),'') is null
     or length(d->'origen'->>'hoja')>128 or length(d->'origen'->>'celda')>128
     or jsonb_typeof(d->'libro') is distinct from 'object'
     or coalesce(d->'libro'->>'generacion','') !~ '^[0-9]+$'
     or (d->'libro'->>'version' is not null and d->'libro'->>'version' !~ '^[a-fA-F0-9]{64}$')
     or codigo not in ('tinajaTonel','tinajaJacuzzi','masajeTerapeutico30','masajeTerapeutico60',
       'masajeDescontracturante30','masajeDescontracturante60','lateCheckout') then
    raise exception 'Resolución manual de servicio incompleta o incompatible';
  end if;
  if ((d->'evidencia_original'->>'concepto'='tinaja' and codigo in ('tinajaTonel','tinajaJacuzzi'))
    or (d->'evidencia_original'->>'concepto'='tonel' and codigo='tinajaTonel')
    or (d->'evidencia_original'->>'concepto'='jacuzzi' and codigo='tinajaJacuzzi')
    or (d->'evidencia_original'->>'concepto'='lateout' and codigo='lateCheckout')
    or (d->'evidencia_original'->>'concepto'='masaje' and codigo like 'masaje%')) is distinct from true then
    raise exception 'La equivalencia no corresponde a la evidencia original';
  end if;
  if p_item->>'tipo_cobro' not in ('normal','cortesia')
    or (d->'evidencia_original'->>'intencion_cobro'='cortesia' and p_item->>'tipo_cobro'<>'cortesia')
    or (d->'evidencia_original'->>'intencion_cobro'='cobrable' and p_item->>'tipo_cobro'<>'normal') then
    raise exception 'El cobro contradice la evidencia original';
  end if;
  begin
    elegido := (d->>'elegido_en')::timestamptz;
    if elegido is null or not isfinite(elegido) then raise exception 'Fecha ausente'; end if;
  exception when others then raise exception 'Fecha de resolución inválida'; end;

  -- El mismo lock financiero que el registrar, antes de leer destino y duplicados.
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',p_item->>'reserva_id'));
  select * into r from public.reservas where id=(p_item->>'reserva_id')::uuid for update;
  if not found or coalesce(r.estado_reserva,'') ~* 'cancelad|no_show' then raise exception 'La reserva ya no está activa'; end if;
  select * into e from public.reserva_estadias where id=(p_item->>'estadia_id')::uuid for update;
  if not found or e.reserva_id<>r.id or coalesce(e.estado_estadia,'') ~* 'cancelad|no_show'
    or fecha is null or fecha<e.fecha_ingreso or fecha>e.fecha_salida then
    raise exception 'La estadía o fecha del servicio cambió';
  end if;
  destino := jsonb_build_object('reserva_id',r.id,'estadia_id',e.id,'cabana_id',e.cabana_id,
    'fecha_ingreso',e.fecha_ingreso,'fecha_salida',e.fecha_salida,'tipo_estadia',e.tipo_estadia,
    'estado_estadia',e.estado_estadia,'estado_reserva',r.estado_reserva);
  if d->'destino_esperado' is distinct from destino then raise exception 'El destino confirmado quedó obsoleto'; end if;
  -- FOR SHARE conserva el catálogo confirmado hasta terminar el lote y el registrar.
  c := jsonb_populate_record(null::public.catalogo_servicios,private.haiku_libro_servicio_manual_catalogo_v1(codigo));
  cat := jsonb_build_object('id',c.id,'codigo',c.codigo,'activo',c.activo,'unidad',c.unidad,
    'precio_base',c.precio_base,'duracion_minutos',c.duracion_minutos,'capacidad_incluida',c.capacidad_incluida,
    'capacidad_maxima',c.capacidad_maxima,'precio_persona_adicional',c.precio_persona_adicional,
    'permite_cortesia',c.permite_cortesia,'requiere_horario',c.requiere_horario);
  if d->'catalogo_esperado' is distinct from cat then raise exception 'El catálogo o precio confirmado cambió; vuelve a revisar'; end if;
  if cantidad is null or cantidad<1 or personas is null or personas<0 or hora is null
     or (c.capacidad_maxima is not null and personas>c.capacidad_maxima)
     or (codigo like 'tinaja%' and personas<1)
     or (codigo='tinajaTonel' and personas>3) or (codigo='tinajaJacuzzi' and personas>5)
     or (p_item->>'tipo_cobro'='cortesia' and (not c.permite_cortesia or codigo not like 'tinaja%')) then
    raise exception 'Cantidad, capacidad, horario o cortesía inválidos';
  end if;
  if codigo like 'masaje%' and ((d->'evidencia_original'->>'duracion_minutos' is not null
      and (d->'evidencia_original'->>'duracion_minutos')::integer<>c.duracion_minutos)
    or (d->'evidencia_original'->>'tipo' is not null and
      codigo not like case d->'evidencia_original'->>'tipo' when 'terapeutico' then 'masajeTerapeutico%'
        when 'descontracturante' then 'masajeDescontracturante%' else 'incompatible' end)) then
    raise exception 'Tipo o duración contradice el masaje original';
  end if;
  if (codigo like 'tinaja%' or codigo='lateCheckout') and c.unidad is distinct from 'hora' then raise exception 'Unidad horaria incompatible'; end if;
  if codigo='lateCheckout' and fecha<>e.fecha_salida then raise exception 'Late Check-out debe corresponder a la salida'; end if;
  minutos := coalesce(c.duracion_minutos,case when c.unidad='hora' then cantidad*60 else 60 end);
  if ((codigo like 'tinaja%' or codigo='lateCheckout') and minutos<>cantidad*60)
    or (codigo like 'masaje%' and c.duracion_minutos is distinct from right(codigo,2)::integer) then
    raise exception 'La duración del catálogo no coincide con la prestación';
  end if;
  fin := (hora+make_interval(mins=>minutos))::time;
  if fin<=hora or ((e.tipo_estadia='full_day' or e.fecha_ingreso=e.fecha_salida) and (hora<'09:30'::time or fin>'21:30'::time)) then
    raise exception 'Horario fuera de la estadía operativa';
  end if;
  unitario := coalesce((p_item->>'precio_manual')::bigint,c.precio_base,0);
  if p_item->>'precio_manual' is null and c.precio_persona_adicional is not null and c.capacidad_incluida is not null and personas>c.capacidad_incluida then
    adicional := (personas-c.capacidad_incluida)*c.precio_persona_adicional;
  end if;
  total := unitario*cantidad+adicional;
  if p_item->>'tipo_cobro'='cortesia' then total:=0; adicional:=0; end if;
  if d->>'precio_decision'='catalogo' then
    if p_item->>'precio_manual' is not null then raise exception 'El precio de catálogo no admite un precio manual'; end if;
  elsif d->>'precio_decision'='libro' then
    if d->'evidencia_original'->>'monto' is null or unitario<=0
      or total<>(d->'evidencia_original'->>'monto')::bigint
      or (c.precio_persona_adicional is not null and c.capacidad_incluida is not null and personas>c.capacidad_incluida) then
      raise exception 'No se puede derivar un precio unitario seguro del Libro';
    end if;
  else raise exception 'Falta decisión de precio'; end if;
  if total<0 or (p_item->>'tipo_cobro'='normal' and total=0) then raise exception 'Precio contractual inválido'; end if;
  resuelto := jsonb_build_object('item_id',p_item->>'item_id','reserva_id',r.id,'estadia_id',e.id,
    'codigo_servicio',codigo,'fecha_servicio',fecha,'hora',left(hora::text,5),'hora_fin',left(fin::text,5),
    'cantidad',cantidad,'personas',personas,'tipo_cobro',p_item->>'tipo_cobro','precio_manual',(p_item->>'precio_manual')::bigint,
    'total',total,'motivo_cortesia',p_item->>'motivo_cortesia','observaciones',p_item->>'observaciones');
  if d->'resuelto' is distinct from resuelto then raise exception 'Los datos resueltos no coinciden con el servicio'; end if;

  select count(*) into candidatos from public.servicios x
    where x.reserva_id=r.id and x.estadia_id=e.id and coalesce(x.estado_servicio,'') !~* 'cancelad|no_show|anulad'
      and (position('[HAKU-LIBRO-SERVICIO:'||(p_item->>'item_id')||']' in coalesce(x.observaciones,''))>0
        or (x.catalogo_servicio_id=c.id and (codigo='lateCheckout' or (x.fecha_servicio=fecha and x.hora_inicio=hora))));
  if candidatos>1 then raise exception 'Múltiples servicios compatibles; no se creará otro'; end if;
  if candidatos=1 then
    select * into s from public.servicios x where x.reserva_id=r.id and x.estadia_id=e.id
      and coalesce(x.estado_servicio,'') !~* 'cancelad|no_show|anulad'
      and (position('[HAKU-LIBRO-SERVICIO:'||(p_item->>'item_id')||']' in coalesce(x.observaciones,''))>0
        or (x.catalogo_servicio_id=c.id and (codigo='lateCheckout' or (x.fecha_servicio=fecha and x.hora_inicio=hora))));
    if s.catalogo_servicio_id<>c.id or s.tipo_cobro<>p_item->>'tipo_cobro' or s.total<>total
      or s.cantidad is distinct from cantidad
      or s.fecha_servicio is distinct from fecha or s.hora_inicio is distinct from hora or s.hora_fin is distinct from fin
      or (codigo<>'lateCheckout' and s.personas is distinct from personas) then
      raise exception 'El existente contradice la resolución confirmada';
    end if;
  end if;
  return jsonb_build_object('version',1,'item_id',p_item->>'item_id','usuario',auth.uid(),
    'elegido_en',elegido,'incorporado_en',clock_timestamp(),
    'origen',jsonb_build_object('hoja',d->'origen'->>'hoja','celda',d->'origen'->>'celda'),
    'evidencia_original',jsonb_build_object('semantica','SERVICIO_REAL','concepto',d->'evidencia_original'->>'concepto',
      'texto',d->'evidencia_original'->>'texto','tipo',d->'evidencia_original'->>'tipo',
      'duracion_minutos',d->'evidencia_original'->'duracion_minutos','cantidad',d->'evidencia_original'->'cantidad',
      'hora',d->'evidencia_original'->>'hora','hora_fin',d->'evidencia_original'->>'hora_fin',
      'intencion_cobro',d->'evidencia_original'->>'intencion_cobro','monto',d->'evidencia_original'->'monto',
      'origen_campo',d->'evidencia_original'->>'origen_campo'),
    'libro',jsonb_build_object('archivo',d->'libro'->>'archivo','generacion',(d->'libro'->>'generacion')::bigint,'version',d->'libro'->>'version'),
    'catalogo_esperado',cat,'destino_esperado',destino,'precio_decision',d->>'precio_decision','resuelto',resuelto);
end;
$function$;
revoke all on function private.haiku_libro_servicio_manual_validar_v1(jsonb) from public,anon;
grant execute on function private.haiku_libro_servicio_manual_validar_v1(jsonb) to authenticated;

create function private.haiku_libro_servicio_manual_auditar_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,private
as $function$
declare d jsonb := nullif(current_setting('app.haiku_libro_servicio_manual_v1',true),'')::jsonb;
begin
  if tg_op='UPDATE' then
    if new.libro_resolucion_manual_v1 is distinct from old.libro_resolucion_manual_v1 then raise exception 'La resolución del Libro es inmutable'; end if;
  elsif d is not null then
    if d->>'usuario' is distinct from auth.uid()::text
      or new.reserva_id::text is distinct from d->'resuelto'->>'reserva_id'
      or new.estadia_id::text is distinct from d->'resuelto'->>'estadia_id'
      or new.catalogo_servicio_id::text is distinct from d->'catalogo_esperado'->>'id'
      or new.fecha_servicio::text is distinct from d->'resuelto'->>'fecha_servicio'
      or left(new.hora_inicio::text,5) is distinct from d->'resuelto'->>'hora'
      or new.hora_fin is distinct from (d->'resuelto'->>'hora_fin')::time
      or new.cantidad is distinct from (d->'resuelto'->>'cantidad')::integer
      or new.personas is distinct from (d->'resuelto'->>'personas')::integer
      or new.tipo_cobro is distinct from d->'resuelto'->>'tipo_cobro'
      or new.total::text is distinct from d->'resuelto'->>'total'
      or position('[HAKU-LIBRO-SERVICIO:'||(d->>'item_id')||']' in coalesce(new.observaciones,''))=0 then
      raise exception 'Auditoría incompatible con el servicio nuevo';
    end if;
    new.libro_resolucion_manual_v1 := d;
  elsif new.libro_resolucion_manual_v1 is not null then raise exception 'La auditoría requiere el writer del Libro';
  end if;
  return new;
end;
$function$;
revoke all on function private.haiku_libro_servicio_manual_auditar_v1() from public,anon,authenticated;
create trigger libro_servicio_manual_auditoria_v1 before insert or update of libro_resolucion_manual_v1
on public.servicios for each row execute function private.haiku_libro_servicio_manual_auditar_v1();

do $migration$
declare f record; despues record; original text; nuevo text;
  marcador text := '    v_resultado := public.haiku_registrar_servicio(';
  resetear text := '    v_servicio_id := nullif(v_resultado->>''servicio_id'', '''')::uuid;';
  lote text := '  for v_item in select value from jsonb_array_elements(p_items)';
begin
  select p.* into f from pg_proc p where p.oid=to_regprocedure('public.haiku_importar_servicios_libro_v1(uuid,jsonb)');
  if not found then raise exception 'Falta el writer de servicios del Libro'; end if;
  original := pg_get_functiondef(f.oid);
  if f.prosecdef is distinct from false
    or (length(original)-length(replace(original,marcador,'')))/length(marcador)<>1
    or (length(original)-length(replace(original,resetear,'')))/length(resetear)<>1
    or (length(original)-length(replace(original,lote,'')))/length(lote)<>1
    or position('haiku_libro_servicio_manual_validar_v1' in original)>0 then
    raise exception 'Contrato inesperado del writer; revisar antes de aplicar';
  end if;
  nuevo := replace(original,marcador,E'    perform set_config(''app.haiku_libro_servicio_manual_v1'', coalesce(private.haiku_libro_servicio_manual_validar_v1(v_item)::text, ''''), true);\n' || marcador);
  nuevo := replace(nuevo,resetear,E'    perform set_config(''app.haiku_libro_servicio_manual_v1'', '''', true);\n' || resetear);
  -- Orden común para reservas del lote manual, antes de adquirir locks por fila.
  nuevo := replace(nuevo,lote,E'  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1(''reserva_finanzas'', orden.reserva))\n    from (select distinct value->>''reserva_id'' reserva from jsonb_array_elements(p_items)\n      where value ? ''servicio_manual_v1'' order by 1) orden;\n' || lote);
  execute nuevo;
  select * into despues from pg_proc where oid=f.oid;
  if despues.proacl is distinct from f.proacl or despues.proowner is distinct from f.proowner
    or despues.prosecdef is distinct from f.prosecdef or despues.proconfig is distinct from f.proconfig then
    raise exception 'El writer debe conservar ACL, owner, seguridad y search_path';
  end if;
end;
$migration$;

create function public.haiku_libro_servicio_manual_capacidad_v1()
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private
as $function$
begin
  if auth.uid() is null or not private.haiku_usuario_activo() or not private.haiku_tiene_permiso('servicios.crear') then
    raise exception 'Sin permiso para resolver servicios';
  end if;
  return jsonb_build_object('version',1,'auditoria',true);
end;
$function$;
revoke all on function public.haiku_libro_servicio_manual_capacidad_v1() from public,anon;
grant execute on function public.haiku_libro_servicio_manual_capacidad_v1() to authenticated;
commit;
