// Contrato del pago de alojamiento sobre una base efímera, con datos ficticios.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const leer = archivo => readFileSync(path.join(__dirname, "..", archivo), "utf8");

async function probar() {
    const db = new PGlite();
    try {
        await db.exec(leer("tests/fixtures/libro-distribucion-schema.sql"));
        await db.exec(`
            alter table public.servicios add column total bigint default 0, add column tipo_cobro text;
            drop view public.vista_estado_cargos;
            create view public.vista_estado_cargos as
            select c.id cargo_id,c.reserva_id,c.estadia_id,c.tipo_cargo,c.estado,
                c.monto-coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a
                    join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) saldo_cargo
            from public.cargos c;
        `);
        for (const archivo of [
            "tests/fixtures/registrar-pago-supabase.sql",
            "supabase/migrations/20260908164059_haku_libro_estado_confirmado.sql",
            "supabase/migrations/20260916041430_haku_libro_aplicaciones_servicio_seguras.sql",
            "supabase/migrations/20261113032624_cloudbeds_guardia_pago_alojamiento.sql"
        ]) await db.exec(leer(archivo));

        const reserva = randomUUID(), estadia = randomUUID(), otraReserva = randomUUID(), otraEstadia = randomUUID();
        const cabana = randomUUID(), cargo = randomUUID(), cargoServicio = randomUUID();
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [randomUUID()]);
        await db.query("insert into reservas values ($1,'Huésped Uno','confirmada'),($2,'Huésped Dos','confirmada')", [reserva,otraReserva]);
        await db.query("insert into cabanas values ($1,4)", [cabana]);
        await db.query(`insert into reserva_estadias values
            ($1,$2,$3,'2027-01-03','2027-01-05','confirmada'),($4,$5,$3,'2027-01-07','2027-01-09','confirmada')`,
        [estadia,reserva,cabana,otraEstadia,otraReserva]);
        await db.query(`insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto) values
            ($1,$2,$3,'alojamiento','activo',320000),($4,$2,$3,'servicio','activo',35000)`, [cargo,reserva,estadia,cargoServicio]);
        const item = {
            tipo:"pago",item_id:"cloudbeds-pago-ficticio",reserva_id:reserva,argumentos:{
                p_reserva_id:reserva,p_monto:159840,p_medio_pago:"webpay_credito",p_fecha_pago:"2026-11-02",
                p_codigo_autorizacion:"012031",p_modo_aplicacion:"alojamiento"
            },
            datos_origen:{
                tipo_movimiento:"alojamiento",cabana:4,fecha_bloque:"2027-01-03",origen:{hoja:"Ene27",celda:"K27:N27"},
                alojamiento_cloudbeds_v1:{estadia_id:estadia,salida:"2027-01-05",cargos:[{id:cargo,saldo:320000}]}
            }
        };
        const guardar = async (propuesta = item, operacion = randomUUID()) =>
            (await db.query("select public.haiku_incorporar_libro_v1($1,$2::jsonb) as resultado",
                [operacion,JSON.stringify([propuesta])])).rows[0].resultado;
        const contar = async () => (await db.query("select count(*)::int as n from pagos")).rows[0].n;

        const desfasado = structuredClone(item);
        desfasado.datos_origen.alojamiento_cloudbeds_v1.cargos[0].saldo = 319000;
        await assert.rejects(guardar(desfasado), /Cambió el saldo/);
        const cambiado = structuredClone(item);
        cambiado.datos_origen.alojamiento_cloudbeds_v1.estadia_id = otraEstadia;
        await assert.rejects(guardar(cambiado), /estadía del pago/);
        await db.exec("select set_config('haku.test_permit','off',false)");
        await assert.rejects(guardar(), /permiso/);
        await db.exec("select set_config('haku.test_permit','on',false)");
        assert.equal(await contar(),0);

        const duplicado = (await db.query(`insert into pagos(reserva_id,monto,moneda,tipo_movimiento,
            medio_pago,estado,fecha_pago,codigo_autorizacion)
            values ($1,159840,'CLP','pago','webpay_credito','confirmado','2026-11-02','12031') returning id`, [otraReserva])).rows[0].id;
        await assert.rejects(guardar(), /coincide con otro movimiento/);
        await db.query("delete from pagos where id=$1", [duplicado]);

        const operacion = randomUUID();
        assert.equal((await guardar(item,operacion)).pagos_creados,1);
        assert.equal((await guardar(item,operacion)).reintento,true);
        assert.equal((await guardar()).omitidos,1);
        assert.equal(await contar(),1);
        const aplicaciones = (await db.query("select cargo_id,monto_aplicado from pago_aplicaciones")).rows;
        assert.deepEqual(aplicaciones.map(a=>[a.cargo_id,Number(a.monto_aplicado)]),[[cargo,159840]]);
        const saldo = (await db.query("select saldo_cargo from vista_estado_cargos where cargo_id=$1",[cargo])).rows[0].saldo_cargo;
        assert.equal(Number(saldo),160160);
        console.log("Pago de alojamiento verificado en PostgreSQL aislado");
    } finally {
        await db.close();
    }
}

probar().catch(error => { console.error(error); process.exitCode = 1; });
