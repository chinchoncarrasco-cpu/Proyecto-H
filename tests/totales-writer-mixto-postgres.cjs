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
 const migration=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_haiku_total_writer_atomico_v1.sql'));
 await db.exec(read(migration?'supabase/migrations/'+migration:'supabase/preparadas/haiku_total_writer_atomico_v1.sql'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(99)]);
 await db.query('insert into cabanas(id,numero) values($1,5)',[id(10)]);
 await db.query("insert into reservas(id,titular_nombre,estado_reserva,bove_cierre,bove_checkout) values($1,'Bruno Borge','checked_out','16989','19890')",[id(1)]);
 await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia) values($1,$2,$3,'2026-09-04','2026-09-07','alojamiento','checked_out')",[id(20),id(1),id(10)]);
 await db.query("insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) select $1,d::date,170000,'manual' from generate_series('2026-09-04'::date,'2026-09-06'::date,'1 day') d",[id(20)]);
 await db.query("select haiku_aplicar_ajuste_reserva($1,'iva_exento',null)",[id(1)]);
 await db.query("insert into pagos(id,reserva_id,monto,estado,tipo_movimiento) values($1,$2,100000,'confirmado','pago')",[id(40),id(1)]);
 await db.query("insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) select $1,id,100000 from cargos where reserva_id=$2 order by id limit 1",[id(40),id(1)]);
 await db.query("insert into servicios values($1,$2,20000,'activo')",[id(30),id(1)]);

 const normal=async(n,cab)=>{await db.query('insert into cabanas(id,numero) values($1,$2)',[id(100+n),cab]);await db.query("insert into reservas(id,titular_nombre,estado_reserva,bove_cierre,observaciones) values($1,'Constanza Kutscher','confirmada','12345','nota protegida')",[id(n)]);await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia) values($1,$2,$3,'2026-09-04','2026-09-05','alojamiento','confirmada')",[id(200+n),id(n),id(100+n)]);await db.query("insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values($1,'2026-09-04',180000,'manual')",[id(200+n)]);};
 await normal(2,9);await normal(0,7);
 const plan=async target=>(await db.query('select haiku_previsualizar_total_iva_v1($1,$2) p',[id(1),target])).rows[0].p;
 const ejecutar=items=>db.query('select haiku_cambiar_totales_lote_v1($1::jsonb) r',[JSON.stringify(items)]);
 const normalItem=n=>({reserva_id:id(n),total_actual:180000,total_objetivo:160000});
 const p=await plan(459000),bruno={reserva_id:id(1),total_actual:428571,total_objetivo:459000,firma_iva:p.firma};
 const snap=async()=>{const r={};for(const t of ['reservas','reserva_estadias','estadia_noches','cargos','cargo_ajustes','pagos','pago_aplicaciones','servicios','eventos_auditoria','huespedes','reserva_huespedes','estadia_huespedes'])r[t]=(await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') a from "+t+' t')).rows[0].a;return JSON.stringify(r);};
 const before=await snap();
 assert.equal((await db.query('select haiku_capacidad_totales_v1() c')).rows[0].c.writer_disponible,true);assert.equal(p.solo_lectura,false);checks++;
 await db.exec('begin');await db.exec('revoke execute on function haiku_cambiar_totales_lote_v1(jsonb) from authenticated');assert.equal((await db.query('select haiku_capacidad_totales_v1() c')).rows[0].c.writer_disponible,false);await db.exec('rollback');checks++;
 await assert.rejects(ejecutar([bruno,{...normalItem(2),total_actual:179999}]),/cambió/);assert.equal(await snap(),before);checks++;
 await assert.rejects(ejecutar([{...bruno,firma_iva:'obsoleta'},normalItem(2)]),/plan IVA cambió/);assert.equal(await snap(),before);checks++;
 // Constanza falla DESPUÉS de procesar Bruno: ambas reservas y auditoría revierten.
 await db.exec("create function fallo_normal_fixture() returns trigger language plpgsql as $$begin if new.reserva_id='"+id(2)+"' then raise exception 'fallo Constanza';end if;return new;end;$$;create trigger fallo_normal before insert on cargos for each row execute function fallo_normal_fixture();");
 await assert.rejects(ejecutar([bruno,normalItem(2)]),/fallo Constanza/);assert.equal(await snap(),before);await db.exec('drop trigger fallo_normal on cargos');checks++;
 // Bruno falla DESPUÉS de una reserva normal con UUID menor: revierte la normal también.
 await db.exec("create function fallo_iva_mixto_fixture() returns trigger language plpgsql as $$begin raise exception 'fallo Bruno';end;$$;create trigger fallo_iva before insert on eventos_auditoria for each row execute function fallo_iva_mixto_fixture();");
 await assert.rejects(ejecutar([normalItem(0),bruno]),/fallo Bruno/);assert.equal(await snap(),before);await db.exec('drop trigger fallo_iva on eventos_auditoria');checks++;
 // Una alteración lateral de la auditoría original del ajuste debe revertir.
 await db.exec("create function alterar_iva_fixture() returns trigger language plpgsql as $$begin new.concepto:='alteración no autorizada';return new;end;$$;create trigger alterar_iva before update on cargo_ajustes for each row execute function alterar_iva_fixture();");
 await assert.rejects(ejecutar([bruno,normalItem(2)]),/identidad/);assert.equal(await snap(),before);await db.exec('drop trigger alterar_iva on cargo_ajustes');checks++;
 const protegidos=(await db.query('select private.haiku_total_snapshot($1) b,private.haiku_total_snapshot($2) c,private.haiku_total_iva_snapshot($1) i',[id(1),id(2)])).rows;
 const ok=await ejecutar([bruno,normalItem(2)]);assert.equal(ok.rows[0].r.ok,true);assert.equal(ok.rows[0].r.resultados.length,2);checks++;
 assert.deepEqual((await db.query('select private.haiku_total_snapshot($1) b,private.haiku_total_snapshot($2) c,private.haiku_total_iva_snapshot($1) i',[id(1),id(2)])).rows,protegidos);checks++;
 const saldos=(await db.query('select reserva_id,total_alojamiento from vista_saldos_alojamiento_reserva')).rows;assert.equal(saldos.find(r=>r.reserva_id===id(1)).total_alojamiento,459000);assert.equal(saldos.find(r=>r.reserva_id===id(2)).total_alojamiento,160000);checks++;
 const despues=await snap(),igual=await plan(459000);await ejecutar([{...bruno,total_actual:459000,firma_iva:igual.firma},{...normalItem(2),total_actual:160000}]);assert.equal(await snap(),despues);checks++;
 await assert.rejects(ejecutar([bruno,normalItem(2)]),/cambió/);assert.equal(await snap(),despues);checks++;
 console.log('PASS WRITER MIXTO SQL: '+checks+' escenarios; capacidad real, éxito, rollback en ambos órdenes, no-op e invariantes.');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
