-- Fixture SINTÉTICO, sólo para PGlite en memoria. No es un baseline desplegable.
create schema auth;
create schema private;
create role anon;
create role authenticated;
create function auth.uid() returns uuid language sql stable as
$$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function private.haiku_usuario_activo() returns boolean language sql stable as
$$select coalesce(nullif(current_setting('test.activo',true),''),'true')::boolean$$;
create function private.haiku_tiene_permiso(p text) returns boolean language sql stable as
$$select case when p=current_setting('test.null_permiso',true) then null
    else p <> coalesce(current_setting('test.sin_permiso',true),'') end$$;
create table cabanas(id uuid primary key,numero smallint,activa boolean default true);
create table reservas(id uuid primary key,estado_reserva text, titular_nombre text,
    observaciones text, bove_cierre text, bove_checkout text, actualizado_en timestamptz default now());
create table reserva_estadias(id uuid primary key,reserva_id uuid references reservas,
    cabana_id uuid references cabanas,estado_estadia text,fecha_ingreso date,fecha_salida date,
    tipo_estadia text default 'alojamiento',checkin_realizado_en timestamptz,checkout_realizado_en timestamptz,
    fullday_liberado_en timestamptz,fullday_liberado_por uuid,
    actualizado_en timestamptz default now(),creado_en timestamptz default now());
create table pagos(id uuid primary key default gen_random_uuid(),reserva_id uuid,monto bigint,
    estado text default 'confirmado',tipo_movimiento text default 'pago',etapa_operativa text default 'abono');
create table bloqueos_cabana(id uuid primary key default gen_random_uuid(),cabana_id uuid,
    estado text default 'activo',desde timestamptz,hasta timestamptz);
create table eventos_auditoria(id uuid primary key default gen_random_uuid(),usuario_id uuid,
    accion text,tipo_evento text,entidad_tipo text,entidad_id uuid,reserva_id uuid,
    estadia_id uuid,cabana_id uuid,descripcion text,cambios jsonb,datos_contexto jsonb,origen text);
create table test_rutas(nombre text,estadia_id uuid,estado text);
create table test_datos_ajenos(tipo text,datos jsonb);
-- Doble explícito: la definición real de esta RPC NO está versionada en el repo.
-- Acredita delegación, rechazo/rollback y reversión, no las reglas reales ausentes.
create function public.haiku_cambiar_estado_estadia(p_estadia_id uuid,p_estado text,p_hora timestamptz default now())
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare rid uuid;
begin
    if current_setting('test.error_rpc',true)='true' then raise exception 'Protección de RPC oficial'; end if;
    insert into test_rutas values('operativa',p_estadia_id,p_estado);
    update reserva_estadias set estado_estadia=p_estado,
      checkin_realizado_en=case when p_estado='confirmada' then null else coalesce(checkin_realizado_en,p_hora) end,
      checkout_realizado_en=case when p_estado='checked_out' then p_hora else null end
      where id=p_estadia_id returning reserva_id into rid;
    update reservas set estado_reserva=case
      when exists(select 1 from reserva_estadias where reserva_id=rid and estado_estadia='hospedada') then 'hospedada'
      when exists(select 1 from reserva_estadias where reserva_id=rid and estado_estadia='confirmada') then 'confirmada'
      when exists(select 1 from reserva_estadias where reserva_id=rid and estado_estadia='pendiente') then 'pendiente'
      else 'checked_out' end where id=rid;
    return jsonb_build_object('ok',true);
end$$;
