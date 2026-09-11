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
 await db.exec(read('supabase/preparadas/haiku_totales_lote_v1.sql'));await db.exec(read('supabase/preparadas/haiku_totales_iva_v1.sql'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(99)]);
 await db.query('insert into cabanas(id,numero) values($1,5)',[id(10)]);
 await db.query("insert into reservas(id,titular_nombre,estado_reserva,bove_cierre,bove_checkout) values($1,'Bruno Borge','checked_out','16989','19890')",[id(1)]);
 await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia) values($1,$2,$3,'2026-09-04','2026-09-07','alojamiento','checked_out')",[id(20),id(1),id(10)]);
 await db.query("insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) select $1,d::date,170000,'manual' from generate_series('2026-09-04'::date,'2026-09-06'::date,'1 day') d",[id(20)]);
 await db.query("select haiku_aplicar_ajuste_reserva($1,'iva_exento',null)",[id(1)]);
 await db.query("insert into pagos(id,reserva_id,monto,estado,tipo_movimiento) values($1,$2,100000,'confirmado','pago')",[id(40),id(1)]);
 await db.query("insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) select $1,id,100000 from cargos where reserva_id=$2 order by id limit 1",[id(40),id(1)]);
 await db.query("insert into servicios values($1,$2,20000,'activo')",[id(30),id(1)]);
 const plan=async n=>(await db.query('select haiku_previsualizar_total_iva_v1($1,$2) p',[id(1),n])).rows[0].p;
 const ejecutar=p=>db.query('select haiku_cambiar_totales_lote_v1($1::jsonb)',[JSON.stringify([{reserva_id:id(1),total_actual:p.total_actual,total_objetivo:p.total_objetivo,firma_iva:p.firma}])]);
 const snapshot=async()=>JSON.stringify((await db.query("select (select jsonb_agg(n order by id) from estadia_noches n) noches,(select jsonb_agg(c order by id) from cargos c) cargos,(select jsonb_agg(a order by id) from cargo_ajustes a) ajustes,(select jsonb_agg(e order by id) from eventos_auditoria e) eventos,(select jsonb_agg(p order by id) from pago_aplicaciones p) apps")).rows);
 const originales=await snapshot(),p=await plan(459000);assert.equal(await snapshot(),originales);checks++;
 assert.equal(p.base_actual,510000);assert.equal(p.total_actual,428571);assert.equal(p.iva_actual,81429);checks++;
 assert.equal(p.base_nueva,546210);assert.equal(p.iva_nuevo,87210);assert.equal(p.total_final_esperado,459000);assert.ok(p.filas.every(f=>f.base_nueva===182070));checks++;
 const residuo=await plan(459001);assert.equal(residuo.filas.reduce((a,f)=>a+f.base_nueva,0),546211);assert.equal(residuo.total_final_esperado,459001);assert.equal(residuo.filas.filter(f=>f.base_nueva===182071).length,1);checks++;
 // Plan y revisión en una transacción que luego se revierte para probar ambos casos.
 const protegidos=JSON.stringify((await db.query('select private.haiku_total_snapshot($1) s',[id(1)])).rows);
 const metadatos=async()=>JSON.stringify((await db.query("select jsonb_agg(to_jsonb(a)-'base_calculo'-'monto' order by id) s from cargo_ajustes a")).rows);
 const metadata=await metadatos();await db.exec('begin');await ejecutar(residuo);assert.equal((await db.query('select total_alojamiento from vista_saldos_alojamiento_reserva')).rows[0].total_alojamiento,459001);await db.exec('rollback');checks++;
 await ejecutar(p);assert.equal(await metadatos(),metadata);assert.equal(JSON.stringify((await db.query('select private.haiku_total_snapshot($1) s',[id(1)])).rows),protegidos);assert.equal((await db.query('select count(*)::int n from eventos_auditoria')).rows[0].n,3);checks++;
 assert.equal((await db.query('select total_alojamiento from vista_saldos_alojamiento_reserva')).rows[0].total_alojamiento,459000);checks++;
 const igual=await plan(459000),antes=await snapshot();await ejecutar(igual);assert.equal(await snapshot(),antes);checks++;
 await assert.rejects(ejecutar(p),/cambió/);checks++;
 const vuelta=await plan(460000);await db.exec("create function fallo_iva_fixture() returns trigger language plpgsql as $$begin if (select count(*) from eventos_auditoria)>3 then raise exception 'fallo intermedio IVA';end if;return new;end;$$;create trigger fallo_iva before insert on eventos_auditoria for each row execute function fallo_iva_fixture();");
 await assert.rejects(ejecutar(vuelta),/fallo intermedio/);assert.equal(await snapshot(),antes);checks++;
 await db.exec('drop trigger fallo_iva on eventos_auditoria');
 for(const tipo of ['cargo_modificacion','cargo_cancelacion']){await db.query('update cargo_ajustes set tipo_ajuste=$1',[tipo]);await assert.rejects(plan(460000),/Sólo se admite/);checks++;}
 await db.exec("update cargo_ajustes set tipo_ajuste='iva_exento'");
 await db.query('update cargo_ajustes set operacion_id=$1 where id=(select id from cargo_ajustes order by id limit 1)',[id(90)]);await assert.rejects(plan(460000),/Sólo se admite/);checks++;
 console.log(`PASS IVA SQL: ${checks} escenarios; fórmula compartida, residuo exacto, auditoría conservada y rollback local.`);
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
