// Sólo identidades ficticias; construye los cinco writers con huellas auditadas.
const {preparar:base}=require('./libro-identidad-documento-sql.cjs');
const {read,rpc}=require('./airbnb-libro-writers-sql.cjs');
async function preparar({instalar=true,historicos=false,db}={}) {
  const h=await base({db});
  try {
    await h.db.exec(read('supabase/migrations/20260902054034_asegurar_creacion_reserva_fullday_con_cargo.sql'));
    await h.db.exec(read('supabase/migrations/20260929023216_fullday_prevencion_tarifa_explicita_fd3.sql'));
    await h.db.exec(read('tests/fixtures/total-core-original.sql'));
    await h.db.exec(read('tests/fixtures/rut-actualizar-reserva-baseline.sql'));
    await h.db.exec(read('tests/fixtures/rut-incorporar-baseline.sql'));
    await h.db.exec(rpc('20261002151142_libro_fullday_tarifa_adl.sql','haiku_libro_tarifa_fullday_adl','private'));
    await h.db.exec(read('supabase/migrations/20261005191959_libro_resoluciones_ocupacion.sql'));
    for(const signature of [
      'public.haiku_crear_reserva(text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb,text,text)',
      'public.haiku_actualizar_reserva(uuid,text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb)',
      'public.haiku_modificar_reserva_completa_core(uuid,text,smallint,date,date,text,smallint,smallint,smallint,text,text,text,text,jsonb,bigint,jsonb)',
      'public.haiku_incorporar_libro_v1(uuid,jsonb)']) {
      await h.db.exec(`revoke all on function ${signature} from public,anon,authenticated; grant execute on function ${signature} to authenticated;`);
    }
    await h.db.exec(`alter table huespedes add column creado_en timestamptz default now();
      alter table huespedes add constraint huespedes_documento_consistente check(
        (tipo_documento is null and numero_documento is null) or
        (tipo_documento is not null and numero_documento is not null and btrim(tipo_documento)<>'' and btrim(numero_documento)<>''));
      alter table huespedes enable row level security;
      create policy huespedes_fixture on huespedes to authenticated using(private.haiku_tiene_permiso('huespedes.ver'))
        with check(private.haiku_tiene_permiso('huespedes.gestionar'));
      grant usage on schema private,auth to authenticated;
      grant select,insert,update on huespedes to authenticated;
      alter function auditar_identidad_fixture() security definer;
      alter function auditar_identidad_fixture() set search_path=pg_catalog,public;
      alter table reserva_huespedes add column id uuid not null default gen_random_uuid() unique,add column creado_en timestamptz default now();
      alter table estadia_huespedes add column id uuid not null default gen_random_uuid() unique,add column creado_en timestamptz default now();
      alter table reserva_estadias add column creado_en timestamptz default now();
      alter table cargo_ajustes add column reserva_id uuid references reservas;
      alter table cargos add column actualizado_en timestamptz;
      create table notas(id uuid primary key default gen_random_uuid(),huesped_id uuid references huespedes,
        reserva_id uuid references reservas,estadia_id uuid references reserva_estadias,texto text);
      create table solicitudes(id uuid primary key default gen_random_uuid(),huesped_id uuid references huespedes,
        reserva_id uuid references reservas,estadia_id uuid references reserva_estadias,descripcion text);
      create function haiku_validar_huesped_en_estadia() returns trigger language plpgsql as $$begin
        if not exists(select 1 from reserva_huespedes rh join reserva_estadias e on e.reserva_id=rh.reserva_id
          where e.id=new.estadia_id and rh.huesped_id=new.huesped_id) then raise exception 'Asociación inválida'; end if;
        return new;end$$;
      create trigger estadia_huespedes_validar_reserva before insert or update on estadia_huespedes
        for each row execute function haiku_validar_huesped_en_estadia();`);
    if(historicos) {
      // Número sintético generado, módulo 11; nunca usar datos del incidente.
      await h.db.query(`update huespedes set nombre='Persona Sintética',tipo_documento='rut',
        numero_documento=case when id=$1 then '12.345.670-K' else '12345670K' end`,[h.ids.guest]);
      await h.db.query(`update reservas set codigo_haiku='FICTICIA-ANTERIOR',titular_nombre='Persona Sintética',
        titular_tipo_documento='rut',titular_numero_documento='12.345.670-K',estado_reserva='cancelada' where id=$1`,[h.ids.reserva]);
      await h.db.query(`update reserva_estadias set estado_estadia='cancelada' where id=$1`,[h.ids.estadia]);
    }
    if(instalar) await instalarCandidata(h.db);
    return h;
  } catch(e) {await h.db.close();throw e;}
}
async function instalarCandidata(db) {
  await require('../../tools/rut-identidad-instalar.cjs').install(db,{authorized:true});
}
module.exports={preparar,instalarCandidata,read};
