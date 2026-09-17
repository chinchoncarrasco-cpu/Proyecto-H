create schema if not exists auth;
create schema if not exists private;

do $block$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end
$block$;

create or replace function auth.uid() returns uuid
language sql stable
as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;

create or replace function private.haiku_usuario_activo() returns boolean
language sql stable as $$select true$$;
create or replace function private.haiku_tiene_permiso(text) returns boolean
language sql stable as $$select true$$;

create or replace function private.haiku_libro_lock_key_v1(p_scope text,p_value text)
returns bigint language sql immutable
as $$select ('x'||substr(md5(coalesce(p_scope,'')||':'||coalesce(p_value,'')),1,16))::bit(64)::bigint$$;

create table public.reservas(id uuid primary key);
create table public.reserva_estadias(
  id uuid primary key,
  reserva_id uuid not null references public.reservas(id),
  estado_estadia text not null default 'confirmada'
);
create table public.catalogo_servicios(
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  categoria text not null default 'fixture',
  nombre text not null,
  unidad text,
  precio_base bigint not null default 0,
  duracion_minutos smallint,
  capacidad_incluida smallint,
  capacidad_maxima smallint,
  precio_persona_adicional bigint,
  permite_cortesia boolean not null default false,
  requiere_horario boolean not null default false,
  activo boolean not null default true
);
create table public.recursos_servicio(
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true
);
create table public.servicios(
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservas(id),
  estadia_id uuid references public.reserva_estadias(id),
  catalogo_servicio_id uuid not null references public.catalogo_servicios(id),
  recurso_id uuid references public.recursos_servicio(id),
  fecha_servicio date not null,
  hora_inicio time,
  hora_fin time,
  cantidad integer not null default 1,
  personas smallint not null default 0,
  precio_unitario_aplicado bigint not null,
  monto_adicional bigint not null default 0,
  total bigint not null,
  tipo_cobro text not null default 'normal',
  motivo_ajuste_precio text,
  motivo_cortesia text,
  estado_servicio text not null default 'programado',
  observaciones text,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create table public.cargos(
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservas(id),
  estadia_id uuid references public.reserva_estadias(id),
  servicio_id uuid references public.servicios(id),
  tipo_cargo text not null,
  concepto text not null,
  monto bigint not null,
  moneda text not null default 'CLP',
  estado text not null default 'activo',
  creado_por uuid,
  creado_en timestamptz not null default now()
);

create or replace function private.haiku_libro_lock_reserva_write_v1()
returns trigger language plpgsql
as $$
begin
  if not pg_try_advisory_xact_lock(
    private.haiku_libro_lock_key_v1('reserva_finanzas',coalesce(new.reserva_id,old.reserva_id)::text)
  ) then
    raise exception 'La reserva tiene otra operacion financiera en curso; vuelve a intentar';
  end if;
  return coalesce(new,old);
end
$$;

create trigger trg_haiku_libro_lock_servicios_v1
before insert or update or delete on public.servicios
for each row execute function private.haiku_libro_lock_reserva_write_v1();

create or replace function public.haiku_sincronizar_cargo_servicio_fixture()
returns trigger language plpgsql
as $$
declare v_nombre text;
begin
  select nombre into v_nombre from public.catalogo_servicios where id=new.catalogo_servicio_id;
  if new.tipo_cobro='normal' and new.total>0 and new.estado_servicio not in ('cancelado','no_show') then
    if exists(select 1 from public.cargos where servicio_id=new.id and estado='activo') then
      update public.cargos set monto=new.total where servicio_id=new.id and estado='activo';
    else
      insert into public.cargos(reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,creado_por)
      values(new.reserva_id,new.estadia_id,new.id,'servicio',v_nombre,new.total,new.creado_por);
    end if;
  else
    update public.cargos set estado='anulado' where servicio_id=new.id and estado='activo';
  end if;
  return null;
end
$$;

create trigger servicios_sincronizar_cargo
after insert or update of total,tipo_cobro,estado_servicio,reserva_id,estadia_id,catalogo_servicio_id
on public.servicios for each row execute function public.haiku_sincronizar_cargo_servicio_fixture();

insert into public.catalogo_servicios(codigo,nombre,precio_base,duracion_minutos,requiere_horario,permite_cortesia) values
 ('lateCheckout','Late Check-out',20000,60,true,true),
 ('tinajaJacuzzi','Tinaja Jacuzzi',30000,60,true,true),
 ('masaje','Masaje',45000,60,true,true),
 ('cuna','Cuna',10000,null,false,true);
insert into public.recursos_servicio(nombre) values('Tinaja Jacuzzi'),('Tinaja Tonel de Madera');
