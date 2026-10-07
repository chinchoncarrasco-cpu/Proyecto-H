// Reconstruye los cuerpos de producción desde migrations locales; PGlite efímero.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const rpc=(file,name,schema='public')=>read('supabase/migrations/'+file).match(new RegExp(
    `create or replace function ${schema}\\.${name}\\([\\s\\S]*?(\\$[a-z_]+\\$);`,'i'))[0];
async function preparar({aplicar=true}={}) {
    const db=new PGlite();
    try {
        await db.exec(read('tests/fixtures/libro-distribucion-schema.sql'));
        await db.exec(`alter table pagos add column verificado_por uuid,add column verificado_en timestamptz,
          add column actualizado_en timestamptz,add column pago_grupo_id uuid,add column pagador_documento text,
          add column pago_origen_id uuid;
          alter table reservas add column grupo_reserva_id uuid,add column titular_numero_documento text;
          alter table catalogo_servicios add column nombre text,add column categoria text;
          alter table servicios add column total bigint default 0,add column tipo_cobro text default 'normal';
          alter table pago_aplicaciones add column id uuid default gen_random_uuid(),add column creado_en timestamptz default now(),
            add primary key(pago_id,cargo_id);
          alter table pagos add constraint pagos_medio_pago_valido check(medio_pago in
            ('transferencia','webpay_credito','webpay_debito','tarjeta_credito','tarjeta_debito','efectivo','otro'));
          create table cargo_ajustes(id uuid primary key default gen_random_uuid(),cargo_id uuid references cargos,
            operacion_id uuid,monto bigint,estado text,signo integer,tipo_ajuste text,porcentaje numeric);
          drop view vista_estado_cargos;
          create view vista_estado_cargos as select c.id cargo_id,c.reserva_id,c.tipo_cargo,c.estado,
            coalesce(cs.nombre,cs.codigo,c.tipo_cargo) concepto,
            coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) aplicado_neto,
            c.monto-coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) saldo_cargo
            from cargos c left join servicios s on s.id=c.servicio_id left join catalogo_servicios cs on cs.id=s.catalogo_servicio_id;
          create view vista_saldos_alojamiento_reserva as select r.id reserva_id,1000000::bigint saldo_alojamiento from reservas r;
          create function haiku_saldo_favor_unidad(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
          create function haiku_crear_reserva(text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb,text,text)
            returns jsonb language plpgsql as $$declare rid uuid:=gen_random_uuid();begin
              insert into reservas(id,titular_nombre,estado_reserva) values(rid,$1,'confirmada');return jsonb_build_object('reserva_id',rid);end$$;`);
        await db.exec(read('tests/fixtures/registrar-pago-supabase.sql'));
        for(const name of ['haiku_registrar_pago_grupo','haiku_registrar_pago_checkin','haiku_registrar_pago_checkin_grupo'])
            await db.exec(rpc('20260903194500_saldo_a_favor_huesped.sql',name));
        for(const file of ['20260903174500_corregir_abonos_registrados.sql','20260903195800_corregir_abono_saldo_favor.sql',
            '20260905031000_pagos_checkin_medios_correctos.sql','20260905035000_editar_pago_confirmado_abono_o_saldo.sql',
            '20260904211500_asistente_abonos_tarjeta_efectivo.sql','20260904145500_asistente_reserva_webpay_atomico.sql'])
            await db.exec(read('supabase/migrations/'+file));
        // El cuerpo checkout desplegado no está en el repo: mismo límite representativo de la suite previa.
        await db.exec(rpc('20260905031000_pagos_checkin_medios_correctos.sql','haiku_registrar_pago_checkin_v2')
            .replace('haiku_registrar_pago_checkin_v2','haiku_registrar_pago_checkout'));
        await db.exec(rpc('20260904_asistente_pagos_reservas_existentes_v2.sql','haiku_registrar_abonos_reserva_existente_asistente'));
        for(const name of ['haiku_libro_validar_parche_v1','haiku_libro_actualizar_v1'])
            await db.exec(rpc('20260908162301_haku_libro_prioridad_confirmada.sql',name,'private'));
        await db.exec(read('supabase/migrations/20260908164318_haku_libro_validar_campos_conocidos.sql'));
        for(const file of ['20260908164059_haku_libro_estado_confirmado.sql','20260909215808_haku_libro_aprobacion_distribucion_manual.sql',
            '20260916041430_haku_libro_aplicaciones_servicio_seguras.sql','20260916191841_haku_libro_aplicaciones_servicio_conjunto_unico.sql',
            '20260918161000_haku_libro_comprobante_grupo_multicabana.sql','20260918191500_haku_libro_penalidad_agrega_aplicaciones.sql',
            '20260918203000_haku_libro_penalidad_manual_exacta.sql','20261006174307_libro_pagos_conceptos_alimentos.sql'])
            await db.exec(read('supabase/migrations/'+file));
        await db.exec(`revoke all on function haiku_registrar_pago_checkout(uuid,bigint,text,text,text,text,text,boolean) from public;
            grant execute on function haiku_registrar_pago_checkout(uuid,bigint,text,text,text,text,text,boolean) to authenticated;
            revoke all on function private.haiku_libro_actualizar_v1(jsonb),private.haiku_libro_validar_parche_v1(jsonb,jsonb,text[]) from public,anon,authenticated;`);
        const seguridad=async()=>(await db.query(`select p.oid,n.nspname,p.proname,p.proowner,p.proacl::text,p.prosecdef,p.proconfig
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
            and p.proname like 'haiku_%' order by p.oid`)).rows;
        const antes=await seguridad();
        const cuerpos=new Map((await db.query(`select n.nspname||'.'||p.proname nombre,p.prosrc from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')`)).rows.map(r=>[r.nombre,r.prosrc]));
        if(aplicar) {
            await db.exec(read('supabase/migrations/20261006203958_airbnb_prepaid_card.sql'));
            assert.deepEqual(await seguridad(),antes,'owner/ACL/security/search_path preservados en public y private');
        }
        const usuario=randomUUID(),reserva=randomUUID();
        await db.query("select set_config('request.jwt.claim.sub',$1,false)",[usuario]);
        await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Agustin Rampa Spinelli','confirmada')",[reserva]);
        return {db,reserva,usuario,cuerpos,antes,seguridad};
    } catch(e) {await db.close();throw e;}
}
module.exports={preparar,read,rpc};
