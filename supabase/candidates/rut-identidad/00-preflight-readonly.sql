-- Sólo lectura, sin datos personales. Ejecutar antes de decidir cualquier instalación.
begin isolation level repeatable read read only;
with expected(signature,body_md5) as (values
 ('public.haiku_crear_reserva(text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb,text,text)','da4196b1493aa6c996ce59e8ae09c2c9'),
 ('public.haiku_actualizar_reserva(uuid,text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb)','787b9b6cdf45d99257d5a6ff251f533c'),
 ('public.haiku_modificar_reserva_completa_core(uuid,text,smallint,date,date,text,smallint,smallint,smallint,text,text,text,text,jsonb,bigint,jsonb)','3b0e3eaffe7774e6c295fedff01bfe53'),
 ('public.haiku_incorporar_libro_v1(uuid,jsonb)','558000300cf1a0b41c7e0bc714435d48'),
 ('private.haiku_libro_actualizar_v1(jsonb)','7214c9af409d4c7e04bdc06341c7e68f')
), groups as (
 select translate(upper(btrim(numero_documento)),'.-','') k,count(*) n from public.huespedes
 where tipo_documento='rut' group by 1 having count(*)>1
)
select jsonb_build_object(
 'server_version',current_setting('server_version'),
 'writers',(select jsonb_agg(jsonb_build_object('signature',e.signature,'expected_md5',e.body_md5,
   'actual_md5',md5(replace(p.prosrc,E'\r','')),'matches',coalesce(md5(replace(p.prosrc,E'\r',''))=e.body_md5,false),
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig))
   from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)),
 'rut_duplicate_groups',(select count(*) from groups),'rut_duplicate_rows',(select coalesce(sum(n),0) from groups),
 'guest_foreign_keys',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)))
   from pg_constraint where confrelid='public.huespedes'::regclass),
 'guest_indexes',(select jsonb_agg(indexdef) from pg_indexes where schemaname='public' and tablename='huespedes'),
 'guest_writers',(select jsonb_agg(p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','private') and p.prokind='f' and p.prosrc ~* '(insert into|update|delete from) (public\.)?huespedes'),
 'migrations',(select jsonb_agg(jsonb_build_object('version',version,'name',name)) from supabase_migrations.schema_migrations
   where name in ('haiku_modificacion_reserva_completa_v1','crear_reserva_fullday_con_cargo','fullday_prevencion_tarifa_explicita_fd3','libro_identidad_documento_guard'))
) preflight;
commit;
