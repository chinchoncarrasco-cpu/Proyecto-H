create schema if not exists auth;
create schema if not exists private;

do $block$
begin
  if not exists(select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end
$block$;

create or replace function auth.uid() returns uuid
language sql stable
as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;

create or replace function private.haiku_usuario_activo() returns boolean
language sql stable
as $$select coalesce(nullif(current_setting('test.usuario_activo', true), ''), 'true')::boolean$$;

create or replace function private.haiku_tiene_permiso(p_permiso text) returns boolean
language sql stable
as $$
  select p_permiso = 'servicios.editar'
    and coalesce(nullif(current_setting('test.servicios_editar', true), ''), 'true')::boolean
$$;

create or replace function private.haiku_libro_lock_key_v1(p_scope text, p_value text)
returns bigint language sql immutable
as $$select ('x' || substr(md5(coalesce(p_scope, '') || ':' || coalesce(p_value, '')), 1, 16))::bit(64)::bigint$$;

create table public.reservas (
  id uuid primary key,
  titular_nombre text not null,
  estado_reserva text not null default 'confirmada',
  bove_checkout text,
  bove_checkout_registrado_por uuid,
  bove_checkout_registrado_en timestamptz,
  actualizado_en timestamptz not null default now()
);

create table public.reserva_estadias (
  id uuid primary key,
  reserva_id uuid not null references public.reservas(id),
  cabana_id uuid,
  estado_estadia text not null default 'confirmada'
);

create table public.catalogo_servicios (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  activo boolean not null default true,
  permite_cortesia boolean not null default false
);

create table public.recursos_servicio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true
);

create table public.servicios (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservas(id),
  estadia_id uuid references public.reserva_estadias(id),
  catalogo_servicio_id uuid not null references public.catalogo_servicios(id),
  recurso_id uuid references public.recursos_servicio(id),
  fecha_servicio date not null,
  hora_inicio time,
  hora_fin time,
  cantidad integer not null default 1 check (cantidad > 0),
  personas smallint not null default 0 check (personas >= 0),
  precio_unitario_aplicado bigint not null check (precio_unitario_aplicado >= 0),
  monto_adicional bigint not null default 0 check (monto_adicional >= 0),
  total bigint not null check (total >= 0),
  tipo_cobro text not null default 'normal' check (tipo_cobro in ('normal', 'cortesia')),
  motivo_ajuste_precio text,
  motivo_cortesia text,
  estado_servicio text not null default 'programado'
    check (estado_servicio in ('programado', 'en_proceso', 'realizado', 'cancelado', 'no_show')),
  observaciones text,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (tipo_cobro <> 'cortesia' or (total = 0 and nullif(btrim(motivo_cortesia), '') is not null))
);

create table public.cargos (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservas(id),
  estadia_id uuid references public.reserva_estadias(id),
  servicio_id uuid references public.servicios(id),
  estadia_noche_id uuid,
  tipo_cargo text not null,
  concepto text not null,
  monto bigint not null check (monto > 0),
  moneda text not null default 'CLP',
  estado text not null default 'activo' check (estado in ('activo', 'anulado')),
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index cargos_servicio_activo_uidx
  on public.cargos(servicio_id)
  where servicio_id is not null and estado = 'activo';

create table public.pagos (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid references public.reservas(id),
  monto bigint not null,
  tipo_movimiento text not null check (tipo_movimiento in ('pago', 'devolucion')),
  estado text not null default 'confirmado'
);

create table public.pago_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  pago_id uuid not null references public.pagos(id),
  cargo_id uuid not null references public.cargos(id),
  monto_aplicado bigint not null,
  creado_en timestamptz not null default now()
);

create table public.cargo_ajustes (
  id uuid primary key default gen_random_uuid(),
  cargo_id uuid not null references public.cargos(id),
  signo smallint not null default -1,
  monto bigint not null,
  estado text not null default 'activo',
  creado_en timestamptz not null default now()
);

create view public.vista_estado_cargos as
select c.id as cargo_id,
       c.reserva_id,
       c.estadia_id,
       c.servicio_id,
       c.estadia_noche_id,
       c.tipo_cargo,
       c.concepto,
       c.monto,
       c.estado,
       coalesce((
         select sum(case
           when p.estado = 'confirmado' and p.tipo_movimiento = 'pago' then pa.monto_aplicado
           when p.estado = 'confirmado' and p.tipo_movimiento = 'devolucion' then -pa.monto_aplicado
           else 0 end)
         from public.pago_aplicaciones pa
         join public.pagos p on p.id = pa.pago_id
         where pa.cargo_id = c.id
       ), 0)::bigint as aplicado_neto,
       (c.monto
         + coalesce((select sum(ca.signo * ca.monto) from public.cargo_ajustes ca
                     where ca.cargo_id = c.id and ca.estado = 'activo'), 0)
         - coalesce((
           select sum(case
             when p.estado = 'confirmado' and p.tipo_movimiento = 'pago' then pa.monto_aplicado
             when p.estado = 'confirmado' and p.tipo_movimiento = 'devolucion' then -pa.monto_aplicado
             else 0 end)
           from public.pago_aplicaciones pa
           join public.pagos p on p.id = pa.pago_id
           where pa.cargo_id = c.id
         ), 0))::bigint as saldo_cargo,
       coalesce((select sum(ca.signo * ca.monto) from public.cargo_ajustes ca
                 where ca.cargo_id = c.id and ca.estado = 'activo'), 0)::bigint as ajuste_neto,
       (c.monto + coalesce((select sum(ca.signo * ca.monto) from public.cargo_ajustes ca
                            where ca.cargo_id = c.id and ca.estado = 'activo'), 0))::bigint as monto_ajustado
from public.cargos c;

create table public.eventos_auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid,
  accion text,
  tipo_evento text,
  entidad_tipo text,
  entidad_id uuid,
  reserva_id uuid,
  estadia_id uuid,
  cabana_id uuid,
  turno_id uuid,
  descripcion text,
  cambios jsonb,
  datos_contexto jsonb,
  origen text,
  creado_en timestamptz not null default now()
);

create or replace function public.haiku_set_updated_at()
returns trigger language plpgsql
as $$begin new.actualizado_en := clock_timestamp(); return new; end$$;

create trigger servicios_set_updated_at before update on public.servicios
for each row execute function public.haiku_set_updated_at();
create trigger cargos_set_updated_at before update on public.cargos
for each row execute function public.haiku_set_updated_at();

create or replace function public.haiku_auditar_cambio()
returns trigger language plpgsql
as $function$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := to_jsonb(new);
  v_cambios jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'campo', key, 'anterior', v_old -> key, 'nuevo', v_new -> key
  ) order by key), '[]'::jsonb)
  into v_cambios
  from jsonb_object_keys(v_old || v_new) key
  where key <> 'actualizado_en' and (v_old -> key) is distinct from (v_new -> key);

  if tg_op = 'UPDATE' and v_cambios = '[]'::jsonb then return null; end if;
  insert into public.eventos_auditoria(
    usuario_id, accion, tipo_evento, entidad_tipo, entidad_id,
    reserva_id, estadia_id, descripcion, cambios, datos_contexto, origen
  ) values (
    auth.uid(),
    case when tg_op = 'INSERT' then 'Registro creado' else 'Registro actualizado' end,
    case when tg_op = 'INSERT' then 'creacion' else 'actualizacion' end,
    tg_table_name, new.id, new.reserva_id, new.estadia_id,
    case when current_setting('app.haiku_origen', true) = 'haku' then 'Haku · ' else '' end ||
      case when tg_op = 'INSERT' then 'Creación en servicios' else 'Actualización en servicios' end,
    v_cambios,
    jsonb_strip_nulls(jsonb_build_object(
      'operacion_sql', tg_op,
      'ejecutor', case when current_setting('app.haiku_origen', true) = 'haku' then 'haku' end,
      'operacion_id', nullif(current_setting('app.haiku_operacion_id', true), '')
    )),
    case when current_setting('app.haiku_origen', true) = 'haku' then 'haku' else 'usuario' end
  );
  return null;
end
$function$;

create trigger auditoria_servicios after insert or update on public.servicios
for each row execute function public.haiku_auditar_cambio();

create or replace function public.haiku_invalidar_bove_checkout_cargo()
returns trigger language plpgsql
as $$
begin
  if new.tipo_cargo = 'servicio' then
    update public.reservas
       set bove_checkout = null,
           bove_checkout_registrado_por = null,
           bove_checkout_registrado_en = null,
           actualizado_en = clock_timestamp()
     where id = new.reserva_id and bove_checkout is not null;
  end if;
  return new;
end
$$;

create trigger trg_haiku_invalidar_bove_checkout_cargo
after insert or update of monto, estado, reserva_id, tipo_cargo on public.cargos
for each row execute function public.haiku_invalidar_bove_checkout_cargo();

create or replace function public.haiku_sincronizar_cargo_servicio()
returns trigger language plpgsql
as $function$
declare
  v_nombre text;
  v_cargo_id uuid;
begin
  select nombre into v_nombre from public.catalogo_servicios where id = new.catalogo_servicio_id;
  select id into v_cargo_id from public.cargos
   where servicio_id = new.id and estado = 'activo' limit 1;
  if new.tipo_cobro = 'normal' and new.total > 0
     and new.estado_servicio not in ('cancelado', 'no_show') then
    if v_cargo_id is null then
      insert into public.cargos(
        reserva_id, estadia_id, servicio_id, tipo_cargo, concepto, monto, creado_por
      ) values (
        new.reserva_id, new.estadia_id, new.id, 'servicio', v_nombre, new.total, new.creado_por
      );
    else
      update public.cargos set monto = new.total where id = v_cargo_id;
    end if;
  elsif v_cargo_id is not null then
    update public.cargos set estado = 'anulado' where id = v_cargo_id;
  end if;
  return null;
end
$function$;

create trigger servicios_sincronizar_cargo
after insert or update of total, tipo_cobro, estado_servicio, reserva_id, estadia_id, catalogo_servicio_id
on public.servicios for each row execute function public.haiku_sincronizar_cargo_servicio();
