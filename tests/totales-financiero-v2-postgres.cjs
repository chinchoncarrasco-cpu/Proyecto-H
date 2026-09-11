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


 await db.exec("create table notas(id uuid default gen_random_uuid(),reserva_id uuid,estadia_id uuid,huesped_id uuid,texto text);create table solicitudes(id uuid default gen_random_uuid(),reserva_id uuid,estadia_id uuid,huesped_id uuid,descripcion text,estado text);");
 await db.exec(read('tests/fixtures/total-constanza-anonimizada.sql'));
 await db.exec("update reservas set titular_numero_documento='12.345.678-9';update huespedes set numero_documento='12.345.678-9';insert into notas(reserva_id,texto) values('"+id(1)+"','Nota protegida');insert into solicitudes(reserva_id,descripcion,estado) values('"+id(1)+"','Solicitud protegida','pendiente');");
 await db.exec('alter function auditar_total_fixture() set search_path=public');
 await db.exec(read('supabase/migrations/20260910225553_haiku_total_financiero_v2.sql'));
 const item={reserva_id:id(1),total_actual:180000,total_objetivo:160000};
 const call=items=>db.query('select haiku_cambiar_totales_lote_v1($1::jsonb) r',[JSON.stringify(items)]);
 const snap=async()=>{const o={};for(const t of ['reservas','huespedes','reserva_estadias','reserva_huespedes','estadia_huespedes','estadia_noches','cargos','cargo_ajustes','pagos','pago_aplicaciones','servicios','solicitudes','notas','eventos_auditoria','auditoria_total'])o[t]=(await db.query('select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) a from '+t+' t')).rows[0].a;return o;};
 const before=await snap();const cap=(await db.query('select haiku_capacidad_totales_v1() c')).rows[0].c;assert.equal(cap.version,'total1_financiero_v2');assert.equal(cap.writer_disponible,true);checks++;
 await call([item]);const after=await snap();assert.equal((await db.query('select total_alojamiento from vista_saldos_alojamiento_reserva')).rows[0].total_alojamiento,160000);checks++;
 for(const t of ['reservas','huespedes','reserva_estadias','reserva_huespedes','estadia_huespedes','pagos','pago_aplicaciones','servicios','solicitudes','notas'])assert.deepEqual(after[t],before[t]);
 assert.equal(after.reservas[0].titular_numero_documento,'12.345.678-9');assert.equal(after.huespedes[0].numero_documento,'12.345.678-9');assert.equal(after.cargos[0].id,before.cargos[0].id);assert.equal(after.estadia_noches[0].id,before.estadia_noches[0].id);checks++;
 await call([{...item,total_actual:160000}]);assert.deepEqual(await snap(),after);checks++;
 await assert.rejects(call([item]),/cambió/);assert.deepEqual(await snap(),after);checks++;
 await assert.rejects(call([{...item,total_actual:160000,total_objetivo:159999}]),/aplicad/);assert.deepEqual(await snap(),after);checks++;
 const crear=async(n,cab,tarifa,dias=3)=>{
  await db.query('insert into cabanas(id,numero) values($1,$2)',[id(100+n),cab]);
  await db.query("insert into reservas(id,titular_nombre,estado_reserva,bove_cierre,bove_checkout) values($1,$2,'checked_out','BOVE A','BOVE S')",[id(n),n===2?'Bruno Borge':'Reserva de prueba']);
  await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,checkin_realizado_en,checkout_realizado_en) values($1,$2,$3,'2026-09-04','2026-09-04'::date+$4::int,'alojamiento','checked_out','2026-09-04T14:00:00Z','2026-09-07T10:00:00Z')",[id(200+n),id(n),id(100+n),dias]);
  await db.query("insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) select $1,'2026-09-04'::date+i,$2,'libro' from generate_series(0,$3::int-1)i",[id(200+n),tarifa,dias]);
 };
 await crear(2,5,170000);await db.query("select haiku_aplicar_ajuste_reserva($1,'iva_exento',null)",[id(2)]);
 const plan=async(total=459000)=>(await db.query('select haiku_previsualizar_total_iva_v1($1,$2) p',[id(2),total])).rows[0].p;
 const p=await plan(),bruno={reserva_id:id(2),total_actual:428571,total_objetivo:459000,firma_iva:p.firma};
 await db.query('update estadia_noches set tarifa=180000 where estadia_id=$1',[id(3)]);
 const antesMixto=await snap();
 // Falla IVA después de modificar Constanza: rollback completo, incluida auditoría.
 await db.exec("create function fallo_iva_v2() returns trigger language plpgsql as $$begin raise exception 'fallo IVA';end;$$;create trigger fallo_iva before update on cargo_ajustes for each row execute function fallo_iva_v2();");
 await assert.rejects(call([item,bruno]),/fallo IVA/);assert.deepEqual(await snap(),antesMixto);await db.exec('drop trigger fallo_iva on cargo_ajustes');checks++;
 await call([item,bruno]);const exito=await snap();
 assert.equal((await db.query('select total_alojamiento from vista_saldos_alojamiento_reserva where reserva_id=$1',[id(2)])).rows[0].total_alojamiento,459000);
 assert.equal(exito.cargos.filter(c=>c.reserva_id===id(2)).reduce((n,c)=>n+c.monto,0),546210);
 assert.equal(exito.cargo_ajustes.reduce((n,a)=>n+a.monto,0),87210);
 const meta=rows=>rows.map(a=>{const b={...a};delete b.monto;delete b.base_calculo;return b;}).sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(meta(exito.cargo_ajustes),meta(antesMixto.cargo_ajustes));
 for(const t of ['reservas','huespedes','reserva_estadias','pagos','pago_aplicaciones','notas','solicitudes'])assert.deepEqual(exito[t],antesMixto[t]);checks++;
 const pi=await plan();await call([{...item,total_actual:160000},{...bruno,total_actual:459000,firma_iva:pi.firma}]);assert.deepEqual(await snap(),exito);checks++;
 for(const tipo of ['cargo_cancelacion','cargo_modificacion']){
  await db.exec('begin');await db.query('update cargo_ajustes set tipo_ajuste=$1',[tipo]);
  await assert.rejects(call([{...bruno,total_actual:459000,total_objetivo:460000}]),/Sólo se admite/);await db.exec('rollback');assert.deepEqual(await snap(),exito);checks++;
 }
 await db.exec('begin');await db.query('update cargo_ajustes set operacion_id=$1 where id=(select id from cargo_ajustes limit 1)',[id(99)]);
 await assert.rejects(call([{...bruno,total_actual:459000,total_objetivo:460000}]),/Sólo se admite/);await db.exec('rollback');checks++;
 // Per-cargo: el total propuesto soporta el pago, pero su cargo individual no.
 await crear(10,10,200000);
 await db.query("insert into pagos(id,reserva_id,monto,estado,tipo_movimiento) values($1,$2,200000,'confirmado','pago')",[id(500),id(10)]);
 await db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) select $1,id,200000 from cargos where reserva_id=$2 order by id limit 1',[id(500),id(10)]);
 const multi={reserva_id:id(10),total_actual:600000,total_objetivo:500002},prev=await snap();
 await assert.rejects(call([multi]),/aplicad/);assert.deepEqual(await snap(),prev);checks++;
 await db.query('update pagos set monto=100000 where id=$1',[id(500)]);await db.query('update pago_aplicaciones set monto_aplicado=100000 where pago_id=$1',[id(500)]);
 const antesResiduo=await snap();await call([multi]);const residuo=await snap();
 assert.deepEqual(residuo.estadia_noches.filter(n=>n.estadia_id===id(210)).sort((a,b)=>a.fecha.localeCompare(b.fecha)).map(n=>n.tarifa),[166668,166667,166667]);
 assert.deepEqual(residuo.pago_aplicaciones,antesResiduo.pago_aplicaciones);assert.deepEqual(residuo.pagos,antesResiduo.pagos);checks++;
 await assert.rejects(call([{...multi,total_actual:500002,total_objetivo:510000}]),/variables/);assert.deepEqual(await snap(),residuo);checks++;
 // Fallo en la reserva normal posterior a IVA: tampoco se guarda Bruno.
 const pv=await plan(460000),b2={...bruno,total_actual:459000,total_objetivo:460000,firma_iva:pv.firma};await crear(11,11,180000,1);
 const antesFallo=await snap();await db.exec("create function fallo_normal_v2() returns trigger language plpgsql as $$begin if new.estadia_id='"+id(211)+"' then raise exception 'fallo normal';end if;return new;end;$$;create trigger fallo_normal before update on estadia_noches for each row execute function fallo_normal_v2();");
 await assert.rejects(call([b2,{reserva_id:id(11),total_actual:180000,total_objetivo:160000}]),/fallo normal/);assert.deepEqual(await snap(),antesFallo);await db.exec('drop trigger fallo_normal on estadia_noches');checks++;
 // Efecto lateral simulado: un trigger no puede normalizar documentos ni tocar pagos.
 for(const [tabla,cambio] of [['reservas',"titular_numero_documento='123456789'"],['huespedes',"numero_documento='123456789'"],['pagos',"medio_pago='otro'"]]){
  await db.exec("create or replace function lateral_v2() returns trigger language plpgsql as $$begin update public."+tabla+" set "+cambio+";return new;end;$$;create trigger efecto_lateral before update on estadia_noches for each row execute function lateral_v2();");
  const b=await snap();await assert.rejects(call([{...item,total_actual:160000,total_objetivo:170000}]),/datos ajenos/);assert.deepEqual(await snap(),b);await db.exec('drop trigger efecto_lateral on estadia_noches');checks++;
 }
 // Full Day conserva el único cargo y no crea noches.
 await db.query('insert into cabanas(id,numero) values($1,12)',[id(112)]);
 // Se usa una reserva nueva, sin depender de borrar una noche enlazada.
 await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Full Day','confirmada')",[id(13)]);
 await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia) values($1,$2,$3,'2026-09-10','2026-09-10','fullday','confirmada')",[id(213),id(13),id(112)]);
 await db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,monto,estado,concepto) values($1,$2,$3,'alojamiento',180000,'activo','Full Day')",[id(600),id(13),id(213)]);
 await call([{reserva_id:id(13),total_actual:180000,total_objetivo:160000}]);assert.equal((await db.query('select monto from cargos where id=$1',[id(600)])).rows[0].monto,160000);checks++;
 console.log('PASS FINANCIERO V2: '+checks+' escenarios; RUT literal, normal/IVA, residuo exacto, aplicaciones intactas, lote y rollback.');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
