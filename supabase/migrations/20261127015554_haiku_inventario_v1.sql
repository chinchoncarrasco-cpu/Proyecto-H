begin;

insert into public.permisos (codigo,nombre,descripcion,categoria) values
  ('inventario.ver','Consultar inventario','Consultar y descargar existencias y movimientos','inventario'),
  ('inventario.gestionar','Gestionar inventario','Agregar y retirar artículos y registrar movimientos','inventario');

insert into public.rol_permisos (rol_id,permiso_id)
select r.id,p.id from public.roles r cross join public.permisos p
where r.codigo in ('administrador','manager','recepcion')
  and p.codigo in ('inventario.ver','inventario.gestionar')
on conflict do nothing;

create table private.haiku_inventario_categorias (
  nombre text primary key,
  orden integer not null unique
);

insert into private.haiku_inventario_categorias values
  ('Menaje cabañas',1),('Insumos comestibles / cabañas',2),('Productos de limpieza',3),
  ('Mantención',4),('Amenities de baño',5),('Lencería',6),('Electrodomésticos',7);

create table private.haiku_inventario_articulos (
  codigo text primary key check (codigo ~ '^[A-Z0-9][A-Z0-9._-]{0,23}$'),
  descripcion text not null check (length(btrim(descripcion)) between 1 and 200),
  categoria text not null references private.haiku_inventario_categorias(nombre),
  stock_minimo integer not null check (stock_minimo >= 0),
  entradas bigint not null default 0 check (entradas >= 0),
  salidas bigint not null default 0 check (salidas between 0 and entradas),
  stock bigint generated always as (entradas - salidas) stored,
  creado_en timestamptz not null default now(),
  retirado_en timestamptz,
  retirado_por uuid
);

create table private.haiku_inventario_movimientos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null references private.haiku_inventario_articulos(codigo),
  tipo text not null check (tipo in ('entrada','salida')),
  cantidad integer not null check (cantidad > 0),
  fecha date not null check (fecha between date '1900-01-01' and date '9999-12-31'),
  comentario text check (length(comentario) <= 1000),
  responsable text check (length(responsable) <= 120),
  autor uuid,
  creado_en timestamptz not null default now()
);
create index haiku_inventario_movimientos_fecha
  on private.haiku_inventario_movimientos (fecha desc,creado_en desc,id desc);
create index haiku_inventario_movimientos_articulo
  on private.haiku_inventario_movimientos (codigo,fecha desc,creado_en desc,id desc);

create table private.haiku_inventario_operaciones (
  solicitud uuid primary key,
  autor uuid not null,
  accion text not null,
  datos jsonb not null,
  resultado jsonb not null
);

alter table private.haiku_inventario_categorias enable row level security;
alter table private.haiku_inventario_articulos enable row level security;
alter table private.haiku_inventario_movimientos enable row level security;
alter table private.haiku_inventario_operaciones enable row level security;
revoke all on private.haiku_inventario_categorias,private.haiku_inventario_articulos,
  private.haiku_inventario_movimientos,private.haiku_inventario_operaciones from public,anon,authenticated;

create function private.haiku_inventario_leer_v1(p_vista text,p_filtros jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  datos jsonb;
  pagina integer := greatest(coalesce((p_filtros->>'pagina')::integer,0),0);
  limite integer := least(greatest(coalesce((p_filtros->>'limite')::integer,25),1),100);
  busqueda text := translate(lower(btrim(coalesce(p_filtros->>'busqueda',''))),'áéíóúüñ','aeiouun');
  desde date := nullif(p_filtros->>'desde','')::date;
  hasta date := nullif(p_filtros->>'hasta','')::date;
begin
  if auth.uid() is null or not coalesce(private.haiku_usuario_activo(),false)
     or not coalesce(private.haiku_tiene_permiso('inventario.ver'),false) then
    raise exception using errcode='42501',message='No tienes acceso a Inventario.';
  end if;

  if p_vista in ('existencias','exportar') then
    select jsonb_build_object(
      'categorias',(select jsonb_agg(c.nombre order by c.orden) from private.haiku_inventario_categorias c),
      'articulos',coalesce(jsonb_agg(jsonb_build_object(
        'codigo',a.codigo,'descripcion',a.descripcion,'categoria',a.categoria,
        'stock_minimo',a.stock_minimo,'stock',a.stock,'entradas',a.entradas,'salidas',a.salidas,
        'estado',case when a.stock=0 then 'Agotado' when a.stock<a.stock_minimo then 'Crítico' else 'Disponible' end
      ) order by c.orden,a.codigo),'[]'::jsonb),
      'ultimo_movimiento',(select max(m.fecha) from private.haiku_inventario_movimientos m),
      'puede_gestionar',coalesce(private.haiku_tiene_permiso('inventario.gestionar'),false)
    ) into datos
    from private.haiku_inventario_articulos a
    join private.haiku_inventario_categorias c on c.nombre=a.categoria
    where a.retirado_en is null;
    if p_vista='existencias' then return datos; end if;
  elsif p_vista is distinct from 'movimientos' then
    raise exception using errcode='22023',message='Vista de inventario no válida.';
  end if;

  if p_vista='exportar' then
    return datos || jsonb_build_object('movimientos',coalesce((
      select jsonb_agg(jsonb_build_object(
        'codigo',m.codigo,'descripcion',a.descripcion,'categoria',a.categoria,
        'tipo',m.tipo,'cantidad',m.cantidad,'fecha',m.fecha,'comentario',m.comentario,'responsable',m.responsable
      ) order by m.fecha,m.creado_en,m.id)
      from private.haiku_inventario_movimientos m join private.haiku_inventario_articulos a using(codigo)
    ),'[]'::jsonb));
  end if;

  select jsonb_build_object(
    'movimientos',coalesce(jsonb_agg(to_jsonb(fila) - 'creado_en' - 'total' order by fecha desc,creado_en desc,id desc),'[]'::jsonb),
    'total',coalesce(max(fila.total),0)
  ) into datos
  from (
    select m.id,m.codigo,a.descripcion,a.categoria,m.tipo,m.cantidad,m.fecha,m.comentario,m.responsable,m.creado_en,
      count(*) over () as total
    from private.haiku_inventario_movimientos m join private.haiku_inventario_articulos a using(codigo)
    where (nullif(p_filtros->>'codigo','') is null or m.codigo=p_filtros->>'codigo')
      and (nullif(p_filtros->>'tipo','') is null or m.tipo=p_filtros->>'tipo')
      and (desde is null or m.fecha>=desde) and (hasta is null or m.fecha<=hasta)
      and (busqueda='' or strpos(translate(lower(m.codigo || ' ' || a.descripcion),'áéíóúüñ','aeiouun'),busqueda)>0)
    order by m.fecha desc,m.creado_en desc,m.id desc
    limit limite offset (pagina::bigint * limite)
  ) fila;
  return datos;
end;
$$;

create function private.haiku_inventario_guardar_v1(p_accion text,p_datos jsonb,p_solicitud uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  usuario uuid := auth.uid();
  cod text := upper(btrim(p_datos->>'codigo'));
  articulo private.haiku_inventario_articulos%rowtype;
  previa private.haiku_inventario_operaciones%rowtype;
  unidades integer;
  tipo_mov text;
  dia date := (now() at time zone 'America/Santiago')::date;
  id_mov uuid;
  respuesta jsonb;
begin
  if usuario is null or not coalesce(private.haiku_usuario_activo(),false)
     or not coalesce(private.haiku_tiene_permiso('inventario.ver'),false)
     or not coalesce(private.haiku_tiene_permiso('inventario.gestionar'),false) then
    raise exception using errcode='42501',message='No tienes permiso para modificar Inventario.';
  end if;
  if p_solicitud is null or p_accion is null or p_accion not in ('agregar','movimiento','retirar')
     or jsonb_typeof(p_datos) is distinct from 'object' or cod is null or cod !~ '^[A-Z0-9][A-Z0-9._-]{0,23}$' then
    raise exception using errcode='22023',message='Revisa el código del artículo y vuelve a intentar.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('haiku_inventario:' || p_solicitud::text,0));
  select * into previa from private.haiku_inventario_operaciones where solicitud=p_solicitud;
  if found then
    if previa.autor=usuario and previa.accion=p_accion and previa.datos=p_datos then return previa.resultado; end if;
    raise exception using errcode='22023',message='La solicitud ya se utilizó para otro cambio.';
  end if;

  if p_accion='agregar' then
    unidades := coalesce((p_datos->>'stock_inicial')::integer,0);
    if unidades<0 then raise exception using errcode='22023',message='El stock inicial debe ser cero o mayor.'; end if;
    insert into private.haiku_inventario_articulos (codigo,descripcion,categoria,stock_minimo,entradas)
    values (cod,btrim(p_datos->>'descripcion'),p_datos->>'categoria',(p_datos->>'stock_minimo')::integer,unidades)
    on conflict (codigo) do nothing returning * into articulo;
    if not found then raise exception using errcode='23505',message='El código ya pertenece a un artículo.'; end if;
    if unidades>0 then
      insert into private.haiku_inventario_movimientos (codigo,tipo,cantidad,fecha,comentario,autor)
      values (cod,'entrada',unidades,dia,'Stock inicial',usuario) returning id into id_mov;
    end if;
  else
    select * into articulo from private.haiku_inventario_articulos where codigo=cod for update;
    if not found or articulo.retirado_en is not null then
      raise exception using errcode='P0001',message='El artículo ya no está en Existencias.';
    end if;
    if p_accion='retirar' then
      if articulo.stock is distinct from (p_datos->>'stock')::bigint then
        raise exception using errcode='P0001',message='Cambió el stock. Actualiza y confirma el retiro nuevamente.';
      end if;
      update private.haiku_inventario_articulos set retirado_en=now(),retirado_por=usuario
      where codigo=cod returning * into articulo;
    else
      unidades := (p_datos->>'cantidad')::integer;
      tipo_mov := p_datos->>'tipo';
      if unidades is null or unidades<=0 or tipo_mov is null or tipo_mov not in ('entrada','salida') then
        raise exception using errcode='22023',message='Selecciona Entrada o Salida e ingresa una cantidad positiva.';
      end if;
      if tipo_mov='salida' and unidades>articulo.stock then
        raise exception using errcode='P0001',message='La cantidad supera el stock disponible.';
      end if;
      insert into private.haiku_inventario_movimientos (codigo,tipo,cantidad,fecha,comentario,responsable,autor)
      values (cod,tipo_mov,unidades,coalesce(nullif(p_datos->>'fecha','')::date,dia),
        nullif(btrim(p_datos->>'comentario'),''),nullif(btrim(p_datos->>'responsable'),''),usuario)
      returning id into id_mov;
      update private.haiku_inventario_articulos set
        entradas=entradas+case when tipo_mov='entrada' then unidades else 0 end,
        salidas=salidas+case when tipo_mov='salida' then unidades else 0 end
      where codigo=cod returning * into articulo;
    end if;
  end if;

  respuesta := jsonb_build_object('codigo',cod,'stock',articulo.stock,'movimiento_id',id_mov);
  insert into private.haiku_inventario_operaciones values (p_solicitud,usuario,p_accion,p_datos,respuesta);
  return respuesta;
end;
$$;

create function public.haiku_inventario_leer_v1(p_vista text default 'existencias',p_filtros jsonb default '{}')
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.haiku_inventario_leer_v1(p_vista,p_filtros)
$$;
create function public.haiku_inventario_guardar_v1(p_accion text,p_datos jsonb,p_solicitud uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.haiku_inventario_guardar_v1(p_accion,p_datos,p_solicitud)
$$;
revoke all on function private.haiku_inventario_leer_v1(text,jsonb),public.haiku_inventario_leer_v1(text,jsonb),
  private.haiku_inventario_guardar_v1(text,jsonb,uuid),public.haiku_inventario_guardar_v1(text,jsonb,uuid) from public,anon;
grant execute on function private.haiku_inventario_leer_v1(text,jsonb),public.haiku_inventario_leer_v1(text,jsonb),
  private.haiku_inventario_guardar_v1(text,jsonb,uuid),public.haiku_inventario_guardar_v1(text,jsonb,uuid) to authenticated;

commit;
