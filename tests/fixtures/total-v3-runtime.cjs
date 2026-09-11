const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8'),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
module.exports=async()=>{const db=new PGlite();
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

 await db.exec("alter table pagos add etapa_operativa text default 'abono',add pago_grupo_id uuid,add datos_origen jsonb default '{}';alter table pago_aplicaciones add unique(pago_id,cargo_id),add check(monto_aplicado>0);");
 await db.exec('drop view vista_saldos_alojamiento_reserva;drop view vista_estado_cargos;');
 await db.exec(read('tests/fixtures/total-vista-cargos-original.sql'));
 await db.exec("create view vista_saldos_alojamiento_reserva as select reserva_id,sum(monto_ajustado)::bigint total_alojamiento,sum(aplicado_neto)::bigint pagado_alojamiento,sum(saldo_cargo)::bigint saldo_alojamiento from vista_estado_cargos where tipo_cargo='alojamiento' and estado='activo' group by reserva_id;");
 await db.exec(read('tests/fixtures/total-validar-aplicacion-original.sql'));
 await db.exec('create trigger validar before insert or update on pago_aplicaciones for each row execute function haiku_validar_pago_aplicacion();');
 await db.exec(read('supabase/migrations/20260910233821_haiku_total_financiero_v3.sql'));
 return db;
} catch(e) {await db.close();throw e;}
};
