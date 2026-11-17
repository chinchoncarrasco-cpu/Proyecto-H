const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const test = require('node:test');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {PGlite} = require('@electric-sql/pglite');

const leer = nombre => readFileSync(join(__dirname,'../supabase/migrations',nombre),'utf8');

test('gestión de ajustes conserva pagos e historial al corregir y anular', async t => {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(`
        create role authenticated;
        create role anon;
        create schema auth;
        create schema private;
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('fixture.actor',true),'')::uuid
        $$;
        create function private.haiku_tiene_permiso(p text) returns boolean language sql stable as $$
            select current_setting('fixture.sin_permiso',true) is distinct from p
        $$;
        create table reservas(id uuid primary key, grupo_reserva_id uuid, titular_nombre text);
        create table cabanas(id uuid primary key, numero int);
        create table reserva_estadias(reserva_id uuid, cabana_id uuid);
        create table cargos(id uuid primary key, reserva_id uuid references reservas, monto bigint,
            estado text default 'activo', tipo_cargo text default 'alojamiento', creado_en timestamptz default now());
        create table cargo_ajustes(id uuid primary key default gen_random_uuid(), operacion_id uuid,
            reserva_id uuid, cargo_id uuid, tipo_ajuste text, signo int, porcentaje numeric,
            base_calculo bigint, monto bigint, concepto text, observaciones text, creado_por uuid,
            estado text default 'activo', creado_en timestamptz default now(), anulado_por uuid, anulado_en timestamptz);
        create table pago_aplicaciones(cargo_id uuid primary key, monto_aplicado bigint);
        create view vista_estado_cargos as
            select c.*, c.id as cargo_id, x.ajustado as monto_ajustado,
                coalesce(p.monto_aplicado,0) as aplicado_neto, x.ajustado-coalesce(p.monto_aplicado,0) as saldo_cargo
            from cargos c
            cross join lateral (select c.monto+coalesce(sum(a.monto*a.signo),0) as ajustado
                from cargo_ajustes a where a.cargo_id=c.id and a.estado='activo') x
            left join pago_aplicaciones p on p.cargo_id=c.id;
    `);
    const bloqueos = leer('20260916041430_haku_libro_aplicaciones_servicio_seguras.sql');
    await db.exec(bloqueos.slice(0,bloqueos.indexOf('-- Todos los writers')));
    const resumen = leer('20260903183000_ajustes_cargo_reserva_conjunta.sql');
    await db.exec(resumen.slice(0,resumen.indexOf('create or replace function public.haiku_aplicar_ajuste_unidad(')));
    await db.exec(leer('20260903191500_ajustes_cargo_manual_10.sql'));
    await db.exec(leer('20261117050000_gestion_ajustes_reserva.sql'));

    const actor = randomUUID(), reserva = randomUUID(), otra = randomUUID(), cargo = randomUUID();
    await db.query("select set_config('fixture.actor',$1,false)",[actor]);
    await db.query("insert into reservas(id,titular_nombre) values($1,'Reserva ficticia'),($2,'Otra reserva')",[reserva,otra]);
    await db.query("insert into cargos(id,reserva_id,monto) values($1,$2,144000)",[cargo,reserva]);
    const {rows:[{ajuste}]} = await db.query("select haiku_aplicar_ajuste_unidad_manual($1,'cargo_modificacion',14400) ajuste",[reserva]);
    const gestionar = async (op=ajuste.operacion_id,esperado=14400,nuevo=null,id=reserva) =>
        (await db.query('select haiku_gestionar_ajuste_reserva_v1($1,$2,$3,$4,$5) dato',
            [id,op,esperado,nuevo,nuevo ? 'Corrección de prueba' : null])).rows[0].dato;

    await assert.rejects(() => gestionar(ajuste.operacion_id,14400,null,otra), /cambió/);
    await assert.rejects(() => gestionar(ajuste.operacion_id,16000), /cambió/);
    await db.exec("select set_config('fixture.sin_permiso','pagos.anular',false)");
    await assert.rejects(() => gestionar(), /permiso/);
    await db.exec("select set_config('fixture.sin_permiso','pagos.registrar',false)");
    await assert.rejects(() => gestionar(ajuste.operacion_id,14400,16000), /permiso/);
    await db.exec("select set_config('fixture.sin_permiso','',false)");

    await db.query('insert into pago_aplicaciones values($1,154000)',[cargo]);
    await assert.rejects(() => gestionar(), /pagos aplicados/);
    const pagos = (await db.query('select * from pago_aplicaciones')).rows;
    const corregido = await gestionar(ajuste.operacion_id,14400,16000);
    assert.equal(corregido.resumen.total_cargos_ajustado,160000);
    assert.deepEqual((await db.query('select * from pago_aplicaciones')).rows,pagos);
    const anterior = (await db.query('select estado,anulado_por from cargo_ajustes where operacion_id=$1',[ajuste.operacion_id])).rows[0];
    assert.deepEqual(anterior,{estado:'anulado',anulado_por:actor});
    const vigente = (await db.query("select monto,observaciones from cargo_ajustes where estado='activo'")).rows[0];
    assert.deepEqual(vigente,{monto:16000,observaciones:'Corrección de prueba'});
    await assert.rejects(() => gestionar(ajuste.operacion_id,14400,16000), /cambió/);
    await db.exec('delete from pago_aplicaciones');
    const anulado = await gestionar(corregido.nuevo_ajuste,16000);
    assert.equal(anulado.resumen.total_cargos_ajustado,144000);
    assert.ok(anulado.resumen.ajustes.every(a => a.estado === 'anulado'));
});
