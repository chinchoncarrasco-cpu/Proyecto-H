begin;

create function public.haiku_libro_registrar_dos_masajes_v1(
  p_reserva_id uuid, p_estadia_id uuid, p_fecha date, p_origen text,
  p_importe bigint, p_evidencia text, p_precio_confirmado boolean, p_masajes jsonb
)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $func$
declare
  fila jsonb;
  codigo_masaje text;
  precio bigint;
  base bigint;
  total numeric := 0;
  origen text;
  marcas text[];
  posicion integer := 0;
  servicio jsonb;
  ids jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or private.haiku_tiene_permiso('servicios.crear') is not true
     or private.haiku_tiene_permiso('pagos.registrar') is not true then
    raise exception 'Sin permisos para resolver los servicios del comprobante';
  end if;
  if p_reserva_id is null or p_estadia_id is null or p_importe is null or p_importe <= 0
     or length(p_origen) > 300 or coalesce(p_origen,'') !~ '^[A-Za-z0-9:_\-.]+$'
     or nullif(btrim(p_evidencia),'') is null or length(p_evidencia) > 16000
     or position('[HAKU-LIBRO-SERVICIO:' in p_evidencia) > 0
     or jsonb_typeof(p_masajes) is distinct from 'array' then
    raise exception 'El origen y el importe del comprobante son obligatorios';
  end if;
  if jsonb_array_length(p_masajes) <> 2 or
     p_masajes->0->>'codigo' is not distinct from p_masajes->1->>'codigo' then
    raise exception 'Selecciona dos masajes distintos';
  end if;

  for fila in select value from jsonb_array_elements(p_masajes) loop
    codigo_masaje := fila->>'codigo';
    if coalesce(codigo_masaje,'') !~ '^masaje(Terapeutico|Descontracturante)(30|60)$'
       or coalesce(fila->>'precio','') !~ '^[1-9][0-9]{0,15}$'
       or coalesce(fila->>'hora','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Indica el tipo, precio y hora de cada masaje';
    end if;
    precio := (fila->>'precio')::bigint;
    select c.precio_base into base from public.catalogo_servicios c where c.codigo = codigo_masaje and c.activo;
    if not found or (precio is distinct from base and p_precio_confirmado is not true) then
      raise exception 'Verifica el catálogo y confirma los precios cobrados';
    end if;
    total := total + precio;
  end loop;
  if total <> p_importe then raise exception 'La suma de ambos masajes debe coincidir con el Libro'; end if;

  -- Comparte el bloqueo del registrador de servicios e impide un alta doble
  -- si otro operador agregó un masaje mientras se revisaba el comprobante.
  perform pg_advisory_xact_lock(('x' || substr(md5('reserva_finanzas:' || p_reserva_id::text), 1, 16))::bit(64)::bigint);
  if not exists (
    select 1 from public.reserva_estadias e
    where e.id = p_estadia_id and e.reserva_id = p_reserva_id
      and p_fecha between e.fecha_ingreso and e.fecha_salida
  ) then raise exception 'La fecha de los masajes debe pertenecer a la estadía'; end if;
  origen := '[HAKU-LIBRO-SERVICIO:pago_manual:' || p_origen || ':doble:';
  marcas := array[origen || '1]', origen || '2]'];
  if exists (
    select 1 from public.servicios s join public.catalogo_servicios c on c.id = s.catalogo_servicio_id
    where s.reserva_id = p_reserva_id and (c.codigo like 'masaje%' or c.categoria = 'masaje')
      and coalesce(s.estado_servicio,'') not in ('cancelado','no_show')
      and position(marcas[1] in coalesce(s.observaciones,'')) = 0
      and position(marcas[2] in coalesce(s.observaciones,'')) = 0
  ) then raise exception 'Ya hay un masaje activo en la reserva. Vuelve a revisar los cargos'; end if;

  for fila in select value from jsonb_array_elements(p_masajes) loop
    posicion := posicion + 1;
    servicio := public.haiku_registrar_servicio(
      p_reserva_id, fila->>'codigo', p_fecha, (fila->>'hora')::time, 1, 1::smallint, 'normal',
      (fila->>'precio')::bigint, null, marcas[posicion] || E'\n' || p_evidencia, p_estadia_id
    );
    if servicio->>'servicio_id' is null then raise exception 'Proyecto H no confirmó ambos servicios'; end if;
    ids := ids || jsonb_build_array(servicio->>'servicio_id');
  end loop;
  return jsonb_build_object('servicio_ids',ids);
end;
$func$;

revoke all on function public.haiku_libro_registrar_dos_masajes_v1(uuid,uuid,date,text,bigint,text,boolean,jsonb) from public, anon;
grant execute on function public.haiku_libro_registrar_dos_masajes_v1(uuid,uuid,date,text,bigint,text,boolean,jsonb) to authenticated;

do $cap$
declare definicion text;
begin
  definicion := pg_get_functiondef('public.haiku_libro_aplicaciones_servicio_capacidad_v1()'::regprocedure);
  if position($a$'version',1,$a$ in definicion) = 0 then raise exception 'Capacidad del Libro incompatible'; end if;
  execute replace(definicion,$a$'version',1,$a$,$a$'version',1,'doble_masaje_manual_v1',true,$a$);
end;
$cap$;

commit;
