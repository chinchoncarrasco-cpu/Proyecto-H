-- CANDIDATA LOCAL. Requiere revisión y autorización independiente antes de aplicar.
-- Los conflictos históricos se registran bloqueados; no se elige una persona.
begin;
set local lock_timeout='5s';
lock table public.huespedes in share row exclusive mode;

create function private.haiku_rut_clave_v1(p_numero text) returns text
language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare s text:=upper(btrim(p_numero)); n text; total integer:=0; factor integer:=2; dv text;
begin
  if s is null or s='' then return null; end if;
  -- No descartar letras o símbolos arbitrarios: eso convertiría entradas inválidas.
  if s !~ '^([0-9]{1,8}-?[0-9K]|[0-9]{1,3}(\.[0-9]{3}){1,2}-[0-9K])$' then return null; end if;
  s:=translate(s,'.-',''); n:=left(s,length(s)-1);
  if length(n)>8 or n ~ '^0' then return null; end if;
  for i in reverse length(n)..1 loop
    total:=total+substr(n,i,1)::integer*factor; factor:=case when factor=7 then 2 else factor+1 end;
  end loop;
  dv:=case 11-total%11 when 11 then '0' when 10 then 'K' else (11-total%11)::text end;
  if right(s,1)<>dv then return null; end if;
  return s;
end $$;

create table private.haiku_rut_registro_v1(
  clave text primary key,
  huesped_id uuid references public.huespedes(id),
  bloqueado boolean not null,
  check ((bloqueado and huesped_id is null) or (not bloqueado and huesped_id is not null))
);
create table private.haiku_huesped_alias_v1(
  redundante_id uuid primary key references public.huespedes(id),
  canonico_id uuid not null references public.huespedes(id),
  operacion_id uuid not null unique,
  evidencia_sha256 text not null check(evidencia_sha256 ~ '^[0-9a-f]{64}$'),
  creado_en timestamptz not null default now(),
  revertido_en timestamptz,
  check(redundante_id<>canonico_id)
);
alter table private.haiku_rut_registro_v1 enable row level security;
alter table private.haiku_huesped_alias_v1 enable row level security;
revoke all on private.haiku_rut_registro_v1,private.haiku_huesped_alias_v1 from public,anon,authenticated;
insert into private.haiku_rut_registro_v1(clave,huesped_id,bloqueado)
select k,case when count(*)=1 then (array_agg(id))[1] else null end,count(*)>1
-- RUT usa módulo 11; los demás documentos conservan exactamente tipo y texto.
-- JSON evita colisiones entre pares de tipo/número que contengan separadores.
from (select id,case when tipo_documento='rut' then private.haiku_rut_clave_v1(numero_documento)
  else jsonb_build_array(tipo_documento,numero_documento)::text end k from public.huespedes
  where tipo_documento is not null and numero_documento is not null) x
where k is not null group by k;

-- Funciones definer nuevas limitadas a triggers o invocaciones desde writers auditados.
create function private.haiku_huesped_guard_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare k text; oldk text; oldclaim text; owner_id uuid; blocked boolean; refs integer;
begin
  if exists(select 1 from private.haiku_huesped_alias_v1 where redundante_id=new.id and revertido_en is null) then
    raise exception 'Identidad retirada; requiere revisión manual' using errcode='HLI02';
  end if;
  if tg_op='UPDATE' then
    oldk:=case when old.tipo_documento='rut' then private.haiku_rut_clave_v1(old.numero_documento) end;
    oldclaim:=case when old.tipo_documento='rut' then oldk when old.tipo_documento is not null
      and old.numero_documento is not null then jsonb_build_array(old.tipo_documento,old.numero_documento)::text end;
    -- Una variante equivalente no necesita reescribir la representación visible.
    -- Conserva además el índice textual cuando el alias guarda la otra variante.
    if oldk is not null and new.tipo_documento='rut'
      and private.haiku_rut_clave_v1(new.numero_documento)=oldk then
      new.numero_documento:=old.numero_documento;
    end if;
    -- No cambia una identidad compartida aunque el editor no sea el Libro.
    select count(*) into refs from (
      select id from public.reservas where titular_huesped_id=old.id
      union select reserva_id from public.reserva_huespedes where huesped_id=old.id
      union select e.reserva_id from public.estadia_huespedes eh join public.reserva_estadias e on e.id=eh.estadia_id where eh.huesped_id=old.id
    ) r;
    if refs>1 and (new.nombre is distinct from old.nombre or to_jsonb(new)->'apellido' is distinct from to_jsonb(old)->'apellido'
      or new.tipo_documento is distinct from old.tipo_documento
      or (new.numero_documento is distinct from old.numero_documento and
        (oldk is null or private.haiku_rut_clave_v1(new.numero_documento) is distinct from oldk))) then
      raise exception 'Identidad compartida incompatible; requiere revisión manual' using errcode='HLI02';
    end if;
    if (new.tipo_documento,new.numero_documento) is not distinct from (old.tipo_documento,old.numero_documento) then return new; end if;
  end if;
  if new.tipo_documento is null and new.numero_documento is null then
    k:=null;
  elsif new.tipo_documento is null or new.numero_documento is null or btrim(new.tipo_documento)='' or btrim(new.numero_documento)='' then
    raise exception 'Documento incompleto o inválido; requiere revisión manual' using errcode='HLI03';
  elsif lower(btrim(new.tipo_documento))='rut' then
    if new.tipo_documento<>'rut' then
      raise exception 'Tipo de documento inválido; requiere revisión manual' using errcode='HLI03';
    end if;
    k:=private.haiku_rut_clave_v1(new.numero_documento);
    if k is null then raise exception 'RUT inválido; requiere revisión manual' using errcode='HLI03'; end if;
  else
    k:=jsonb_build_array(new.tipo_documento,new.numero_documento)::text;
  end if;
  if k is not null then
    -- La PK serializa incluso REPEATABLE READ: no depende de un SELECT tras un advisory lock.
    insert into private.haiku_rut_registro_v1 as r(clave,huesped_id,bloqueado) values(k,new.id,false)
    on conflict(clave) do update set clave=excluded.clave
    returning r.huesped_id,r.bloqueado into owner_id,blocked;
    if blocked or owner_id is distinct from new.id then
      raise exception 'Documento ocupado o pendiente de revisión manual' using errcode='HLI01';
    end if;
  end if;
  if tg_op='UPDATE' and oldclaim is not null and oldclaim is distinct from k then
    delete from private.haiku_rut_registro_v1 where clave=oldclaim and huesped_id=old.id and not bloqueado;
  end if;
  return new;
end $$;
-- La referencia del registro se comprueba al final: BEFORE INSERT aún no tiene huésped.
alter table private.haiku_rut_registro_v1 drop constraint haiku_rut_registro_v1_huesped_id_fkey;
alter table private.haiku_rut_registro_v1 add foreign key(huesped_id) references public.huespedes(id) deferrable initially deferred;
create trigger haiku_identidad_guard_v1 before insert or update on public.huespedes
for each row execute function private.haiku_huesped_guard_v1();

create function private.haiku_huesped_referencia_guard_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare gid uuid;
begin
  gid:=case when tg_table_name='reservas' then (to_jsonb(new)->>'titular_huesped_id')::uuid else (to_jsonb(new)->>'huesped_id')::uuid end;
  if exists(select 1 from private.haiku_huesped_alias_v1 where redundante_id=gid and revertido_en is null) then
    raise exception 'Asociación a identidad retirada; requiere revisión manual' using errcode='HLI02';
  end if;
  return new;
end $$;
do $$declare t text; begin
  foreach t in array array['reservas','reserva_huespedes','estadia_huespedes','notas','solicitudes'] loop
    execute format('create trigger haiku_identidad_referencia_v1 before insert or update on public.%I for each row execute function private.haiku_huesped_referencia_guard_v1()',t);
  end loop;
end $$;

create function private.haiku_rut_resolver_v1(p_numero text,p_nombre text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare k text; r private.haiku_rut_registro_v1%rowtype; h public.huespedes%rowtype;
begin
  if p_numero is null or btrim(p_numero)='' then return null; end if;
  k:=private.haiku_rut_clave_v1(p_numero);
  if k is null then raise exception 'RUT inválido; requiere revisión manual' using errcode='HLI03'; end if;
  select * into r from private.haiku_rut_registro_v1 where clave=k for update;
  if not found then return null; end if;
  if r.bloqueado then raise exception 'Identidad pendiente de revisión manual' using errcode='HLI01'; end if;
  select * into strict h from public.huespedes where id=r.huesped_id;
  if btrim(h.nombre) is distinct from btrim(p_nombre) then
    raise exception 'Documento existente con identidad incompatible; requiere revisión manual' using errcode='HLI02';
  end if;
  return h.id;
end $$;
revoke all on function private.haiku_rut_clave_v1(text),private.haiku_huesped_guard_v1(),
  private.haiku_huesped_referencia_guard_v1(),private.haiku_rut_resolver_v1(text,text) from public,anon,authenticated;
-- El editor invoker necesita sólo validar el formato; no puede consultar el registro privado.
grant execute on function private.haiku_rut_clave_v1(text) to authenticated;
commit;
