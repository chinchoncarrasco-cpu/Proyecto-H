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

 await db.exec(read('tests/fixtures/total-constanza-anonimizada.sql'));
 const snap=async()=> (await db.query('select private.haiku_total_snapshot($1) s',[id(1)])).rows[0].s;
 const all=async()=>{const o={};for(const t of ['reservas','huespedes','reserva_estadias','estadia_noches','cargos','cargo_ajustes','pagos','pago_aplicaciones','eventos_auditoria','auditoria_total'])o[t]=(await db.query('select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) a from '+t+' t')).rows[0].a;return o;};
 const call=()=>db.query('select haiku_cambiar_totales_lote_v1($1::jsonb)',[JSON.stringify([{reserva_id:id(1),total_actual:180000,total_objetivo:160000}])]);
 const original=await snap(),antes=await all();
 // PRIMERO reproducir exactamente el rechazo de la versión desplegada, sin alterarla.
 await assert.rejects(call(),/La edición afectaría datos ajenos al total/);assert.deepEqual(await all(),antes);checks++;
 await db.exec(read('supabase/preparadas/haiku_total_diagnostico_invariantes.sql'));
 let error;try{await call();}catch(e){error=e;}assert.ok(error);assert.deepEqual(JSON.parse(error.detail).invariantes,['huespedes[0].numero_documento','reserva.titular_numero_documento']);assert.deepEqual(await all(),antes);checks++;
 // Ejecutar SÓLO EN PGlite el mismo editor para observar el antes/después y revertirlo.
 await db.exec('begin');await db.query("select haiku_modificar_reserva_completa(p_reserva_id=>$1,p_titular_nombre=>'Constanza Kutscher',p_cabana_numero=>9::smallint,p_fecha_ingreso=>'2026-09-11',p_fecha_salida=>'2026-09-12',p_adultos=>2::smallint,p_ninos=>2::smallint,p_mascotas=>0::smallint,p_correo_contacto=>'constanza@example.invalid',p_telefono_contacto=>'+56900000000',p_rut=>'12345678-5',p_observaciones=>'Constanza Kutscher // 12345678-5 // 2adl + 2chld // CO // 08-09-2026',p_tarifas=>jsonb_build_object('2026-09-11',160000))",[id(1)]);
 const despues=await snap(),finanzas=await all();assert.equal(despues.reserva.titular_numero_documento,'123456785');assert.equal(despues.huespedes[0].numero_documento,'123456785');assert.equal(original.reserva.titular_numero_documento,'12345678-5');checks++;
 assert.deepEqual(despues.pagos,original.pagos);assert.equal(finanzas.pago_aplicaciones[0].pago_id,antes.pago_aplicaciones[0].pago_id);assert.equal(finanzas.pago_aplicaciones[0].monto_aplicado,160000);assert.notEqual(finanzas.pago_aplicaciones[0].cargo_id,antes.pago_aplicaciones[0].cargo_id);assert.notEqual(finanzas.pago_aplicaciones[0].id,antes.pago_aplicaciones[0].id);checks++;
 assert.equal(finanzas.cargos.filter(c=>c.estado==='activo')[0].monto,160000);assert.equal(finanzas.cargos.filter(c=>c.estado==='anulado')[0].monto,180000);checks++;
 await db.exec('rollback');assert.deepEqual(await all(),antes);checks++;
 // Prueba de viabilidad, NO implementación de writer: sólo tarifa y trigger oficial.
 // No se ejecuta en Supabase, no se cambia la definición del guard ni se normalizan documentos.
 await db.exec('begin');await db.query('update estadia_noches set tarifa=160000 where estadia_id=$1',[id(3)]);
 assert.deepEqual(await snap(),original);const financiera=await all();assert.deepEqual(financiera.pago_aplicaciones,antes.pago_aplicaciones);assert.equal(financiera.cargos[0].id,antes.cargos[0].id);assert.equal(financiera.cargos[0].monto,160000);assert.equal((await db.query('select total_alojamiento from vista_saldos_alojamiento_reserva')).rows[0].total_alojamiento,160000);checks++;
 await db.exec('rollback');assert.deepEqual(await all(),antes);checks++;
 console.log('PASS CONSTANZA: '+checks+' escenarios; rollback reproducido por dos campos de RUT, sin relajar protección.');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
