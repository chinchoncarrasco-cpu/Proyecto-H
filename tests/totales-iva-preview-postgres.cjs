const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8'),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;
try{
 await db.exec(read('tests/fixtures/total-schema.sql'));
 await db.exec(`alter table cargo_ajustes add operacion_id uuid,add cargo_id uuid references cargos,add tipo_ajuste text,add signo smallint,add porcentaje numeric,add base_calculo bigint,add monto bigint check(monto>0),add concepto text,add observaciones text,add creado_por uuid,add creado_en timestamptz default now();
 alter table cargo_ajustes alter column id set default gen_random_uuid(),alter column estado set default 'activo';
 create table eventos_auditoria(id uuid default gen_random_uuid(),usuario_id uuid,accion text,tipo_evento text,entidad_tipo text,entidad_id uuid,reserva_id uuid,descripcion text,cambios jsonb,datos_contexto jsonb,origen text);
 create function public.haiku_resumen_ajustes(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function public.haiku_resumen_ajustes_unidad(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 drop view vista_saldos_alojamiento_reserva;drop view vista_estado_cargos;
 create view vista_estado_cargos as select c.*,c.id cargo_id,
 c.monto+coalesce((select sum(a.signo*a.monto) from cargo_ajustes a where a.cargo_id=c.id and a.estado='activo'),0) monto_ajustado,
 coalesce((select sum(case when p.tipo_movimiento='pago' then pa.monto_aplicado else -pa.monto_aplicado end) from pago_aplicaciones pa join pagos p on p.id=pa.pago_id where pa.cargo_id=c.id and p.estado='confirmado'),0) aplicado_neto,
 c.monto-coalesce((select sum(pa.monto_aplicado) from pago_aplicaciones pa where pa.cargo_id=c.id),0) saldo_cargo from cargos c;
 create view vista_saldos_alojamiento_reserva as select reserva_id,sum(monto_ajustado)::bigint total_alojamiento,sum(aplicado_neto)::bigint pagado_alojamiento from vista_estado_cargos where tipo_cargo='alojamiento' and estado='activo' group by reserva_id;`);
 for(const f of ['total-trigger-original.sql','total-core-original.sql','total-editor-original.sql'])await db.exec(read('tests/fixtures/'+f));
 await db.exec('create trigger sincronizar after insert or update on estadia_noches for each row execute function haiku_sincronizar_cargo_noche();');
 await db.exec(read('tests/fixtures/haiku_aplicar_ajuste_reserva-original.sql'));
 const migration=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_haiku_total_iva_preview_solo_lectura.sql'));
 await db.exec(read(migration?'supabase/migrations/'+migration:'supabase/preparadas/haiku_total_iva_preview_solo_lectura.sql'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(99)]);
 await db.query('insert into cabanas(id,numero) values($1,5)',[id(10)]);
 await db.query("insert into reservas(id,titular_nombre,estado_reserva,bove_cierre,bove_checkout) values($1,'Bruno Borge','checked_out','16989','19890')",[id(1)]);
 await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia) values($1,$2,$3,'2026-09-04','2026-09-07','alojamiento','checked_out')",[id(20),id(1),id(10)]);
 await db.query("insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) select $1,d::date,170000,'manual' from generate_series('2026-09-04'::date,'2026-09-06'::date,'1 day') d",[id(20)]);
 await db.query("select haiku_aplicar_ajuste_reserva($1,'iva_exento',null)",[id(1)]);
 await db.query("insert into pagos(id,reserva_id,monto,estado,tipo_movimiento) values($1,$2,100000,'confirmado','pago')",[id(40),id(1)]);
 await db.query("insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) select $1,id,100000 from cargos where reserva_id=$2 order by id limit 1",[id(40),id(1)]);
 await db.query("insert into servicios values($1,$2,20000,'activo')",[id(30),id(1)]);

 const preview=async(idReserva=id(1),target=459000)=>(await db.query('select haiku_previsualizar_total_iva_v1($1,$2) p',[idReserva,target])).rows[0].p;
 const snapshot=async()=>JSON.stringify((await db.query("select (select jsonb_agg(t order by id) from reservas t) reservas,(select jsonb_agg(t order by id) from cargos t) cargos,(select jsonb_agg(t order by id) from cargo_ajustes t) ajustes,(select jsonb_agg(t order by id) from estadia_noches t) noches,(select jsonb_agg(t order by id) from pagos t) pagos,(select jsonb_agg(t order by id) from servicios t) servicios,(select jsonb_agg(t order by id) from eventos_auditoria t) auditoria")).rows);
 const before=await snapshot();await db.exec('begin read only');const p=await preview();await db.exec('commit');
 assert.equal(await snapshot(),before);assert.equal(p.solo_lectura,true);assert.deepEqual([p.base_actual,p.iva_actual,p.total_actual,p.base_nueva,p.iva_nuevo,p.total_final_esperado],[510000,81429,428571,546210,87210,459000]);checks++;
 assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('haiku_cambiar_totales_lote_v1','haiku_guardar_plan_iva','haiku_plan_total_iva','haiku_iva_incluido')")).rows[0].n,0);checks++;
 const acl=(await db.query("select has_function_privilege('anon','public.haiku_previsualizar_total_iva_v1(uuid,bigint)','execute') anon,has_function_privilege('authenticated','public.haiku_previsualizar_total_iva_v1(uuid,bigint)','execute') usuario,provolatile from pg_proc where proname='haiku_previsualizar_total_iva_v1'")).rows[0];assert.deepEqual(acl,{anon:false,usuario:true,provolatile:'s'});checks++;
 await db.query("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(preview(),/requieren/);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(99)]);checks++;
 await db.exec("set haku.test_permit='off'");await assert.rejects(preview(),/requieren/);await db.exec("set haku.test_permit='on'");checks++;
 await assert.rejects(preview(id(999)),/no rows/);checks++;
 await db.exec("update reservas set estado_reserva='cancelada'");await assert.rejects(preview(),/compatible/);await db.exec("update reservas set estado_reserva='checked_out'");checks++;
 for(const tipo of ['cargo_modificacion','cargo_cancelacion']){await db.query('update cargo_ajustes set tipo_ajuste=$1',[tipo]);await assert.rejects(preview(),/Sólo se admite/);checks++;}await db.exec("update cargo_ajustes set tipo_ajuste='iva_exento'");
 await db.exec('begin');await db.query('update cargo_ajustes set operacion_id=$1 where id=(select id from cargo_ajustes limit 1)',[id(98)]);await assert.rejects(preview(),/Sólo se admite/);await db.exec('rollback');checks++;
 await db.exec('begin');await db.exec('update estadia_noches set tarifa=170001 where id=(select id from estadia_noches limit 1)');await assert.rejects(preview(),/uniformes/);await db.exec('rollback');checks++;
 assert.equal(await snapshot(),before);checks++;
 console.log('PASS PREVIEW SQL: '+checks+' escenarios, sólo lectura sin instalar writer.');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
