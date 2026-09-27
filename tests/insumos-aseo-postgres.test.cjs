const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const permisos = 'aseos.ver_todos,aseos.gestionar_todos,reservas.ver';

test('movimientos de insumos: PostgreSQL local, atomicidad e identidad', async t => {
    const db = new PGlite();
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    const run = async (delta = 1, esperada = 0, insumo = 'carbon', cabana = id(1), fecha = '2026-09-26') =>
        (await one('select * from public.haiku_reponer_insumo_aseo_v1($1,$2,$3,$4,$5)', [fecha, cabana, insumo, delta, esperada]));
    const cantidad = async () => (await db.query('select * from movimientos_insumos order by id')).rows;
    const saco = (peso = 18.4, sacoId = id(100), cabana = id(1), fecha = '2026-09-26') =>
        one('select * from public.haiku_agregar_saco_lena_v1($1,$2,$3,$4)', [fecha,cabana,sacoId,peso]);
    const anular = sacoId => one('select * from public.haiku_anular_saco_lena_v1($1)', [sacoId]);
    const editar = (peso = 18.7, version = 1, sacoId = id(100)) =>
        one('select * from public.haiku_editar_peso_saco_lena_v1($1,$2,$3)', [sacoId,peso,version]);
    async function caso(nombre, fn) {
        await t.test(nombre, async () => {
            await db.exec('begin');
            try { await fn(); } finally { await db.exec('rollback'); }
        });
    }
    async function rechaza(fn, regex) {
        await db.exec('savepoint rechazo');
        await assert.rejects(fn, regex);
        await db.exec('rollback to savepoint rechazo');
    }
    try {
        await db.exec(read('tests/fixtures/insumos-schema.sql'));
        await db.exec(read('supabase/migrations/20260926210137_movimientos_insumos_aseo.sql'));
        await db.query('insert into usuarios values($1),($2)', [id(90), id(91)]);
        await db.query('insert into cabanas(id,numero) values($1,1),($2,2)', [id(1), id(2)]);
        await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.permisos',$2,false),set_config('test.activo','true',false)", [id(90), permisos]);
        await db.exec('set role authenticated');
        await caso('incrementos y decrementos conservan una fila canónica y nunca son negativos', async () => {
            const primero = await run();
            assert.equal(Number(primero.cantidad), 1);
            assert.equal((await run(1, 1)).id, primero.id);
            assert.equal(Number((await run(-1, 2)).cantidad), 1);
            assert.equal(Number((await run(-1, 1)).cantidad), 0);
            assert.equal((await cantidad()).length, 1);
            await rechaza(() => run(-1, 0), /incompatible/);
            assert.equal(Number((await cantidad())[0].cantidad), 0);
        });
        await caso('insumos, cabañas, fechas y suma diaria independientes', async () => {
            await run(); await run(1, 1); await saco();
            await run(1, 0, 'carbon', id(2));
            await run(1, 0, 'carbon', id(1), '2026-09-27');
            const sum = () => db.query("select insumo,sum(cantidad_actual)::int total from movimientos_insumos_resumen where fecha_operativa='2026-09-26' and origen='aseo' group by insumo order by insumo");
            assert.deepEqual((await sum()).rows, [{ insumo: 'carbon', total: 3 }, { insumo: 'lena', total: 1 }]);
            await run(-1, 2);
            assert.equal((await sum()).rows[0].total, 2);
            assert.equal((await cantidad()).length, 4);
        });
        await caso('una escritura repetida o con cantidad obsoleta no vuelve a sumar', async () => {
            await run();
            await rechaza(() => run(), /otro dispositivo/);
            assert.equal(Number((await cantidad())[0].cantidad), 1);
            assert.equal((await cantidad()).length, 1);
        });
        await caso('A y B esperan 1: sólo uno guarda 2; A obsoleto no reemplaza el 3 de B', async () => {
            await run();
            assert.equal(Number((await run(1, 1)).cantidad), 2);
            await rechaza(() => run(1, 1), /otro dispositivo/);
            assert.equal(Number((await cantidad())[0].cantidad), 2);
            assert.equal(Number((await run(1, 2)).cantidad), 3);
            await rechaza(() => run(1, 1), /otro dispositivo/);
            assert.equal(Number((await cantidad())[0].cantidad), 3);
        });
        await caso('sin movimiento el primer decremento falla y revierte también la creación de aseo', async () => {
            await rechaza(() => run(-1), /incompatible/);
            assert.equal((await cantidad()).length, 0);
            assert.equal((await db.query('select * from aseos')).rows.length, 0);
        });
        await caso('no modifica aseo, revisión, Express ni solicitudes existentes', async () => {
            await db.exec('reset role');
            await db.query("insert into revisiones_cabana(id,fecha,cabana_id,tipo_revision,estado,resultado) values($1,'2026-09-26',$3,'completa','completada','lista'),($2,'2026-09-26',$3,'aseo_express','en_proceso',null)", [id(30),id(31),id(1)]);
            await db.query("insert into solicitudes values($1,'Aseo Express')", [id(40)]);
            await db.exec('set role authenticated');
            await db.query("insert into aseos(fecha,cabana_id,tipo_aseo,estado,creado_por,encargado_nombre,iniciado_en,completado_en) values('2026-09-26',$1,'salida','completado',$2,'Operador','2026-09-26T15:30:00Z','2026-09-26T16:30:00Z')", [id(1), id(90)]);
            const snapshot = async () => (await one("select jsonb_build_object('aseos',(select jsonb_agg(a) from aseos a),'revisiones',(select jsonb_agg(r) from revisiones_cabana r),'solicitudes',(select jsonb_agg(s) from solicitudes s)) datos")).datos;
            const antes = await snapshot(); await run(); await saco(); await editar(); await anular(id(100));
            assert.deepEqual(await snapshot(), antes);
        });
        await caso('conserva No requiere y horarios vacíos al registrar reposición', async () => {
            await db.query("insert into aseos(fecha,cabana_id,tipo_aseo,estado) values('2026-09-26',$1,'salida','no_requiere')", [id(1)]);
            await run();
            const aseo = await one('select * from aseos');
            assert.equal(aseo.estado, 'no_requiere'); assert.equal(aseo.iniciado_en, null); assert.equal(aseo.completado_en, null);
        });
        await caso('reserva inequívoca se vincula; el recambio queda sin reserva', async () => {
            await db.exec('reset role');
            await db.query('insert into reservas(id) values($1),($2)', [id(10), id(11)]);
            await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida) values($1,$2,$3,'2026-09-25','2026-09-26'),($4,$5,$3,'2026-09-26','2026-09-28')", [id(20), id(10), id(1), id(21), id(11)]);
            await db.exec('set role authenticated');
            assert.equal((await run(1, 0, 'carbon', id(1), '2026-09-25')).reserva_id, id(10));
            assert.equal((await run()).reserva_id, null);
            assert.equal((await run(1, 0, 'carbon', id(1), '2026-09-27')).reserva_id, id(11));
        });
        await caso('sin permiso para leer reservas, conserva null', async () => {
            await db.exec('reset role');
            await db.query('insert into reservas(id) values($1)', [id(10)]);
            await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida) values($1,$2,$3,'2026-09-25','2026-09-28')", [id(20),id(10),id(1)]);
            await db.exec('set role authenticated');
            await db.query("select set_config('test.permisos','aseos.ver_todos,aseos.gestionar_todos',true)");
            assert.equal((await run()).reserva_id, null);
        });
        await caso('RLS: usuario sin permiso no lee ni escribe', async () => {
            await run();
            await db.query("select set_config('test.permisos','',true)");
            assert.equal((await cantidad()).length, 0);
            await rechaza(() => run(), /Sin permiso/);
        });
        await caso('RLS: sólo aseo asignado al usuario autorizado', async () => {
            await db.query("insert into aseos(fecha,cabana_id,tipo_aseo,asignado_a) values('2026-09-26',$1,'salida',$2),('2026-09-26',$3,'salida',$4)", [id(1), id(90), id(2), id(91)]);
            await db.query("select set_config('test.permisos','aseos.ver_asignados,aseos.gestionar_asignados',true)");
            await run();
            await rechaza(() => run(1, 0, 'carbon', id(2)), /Sin permiso/);
            assert.equal((await cantidad()).length, 1);
        });
        await caso('RPC no amplía permisos: lectura, gestión, asignación y NULL se comprueban explícitamente', async () => {
            await run();
            for (const permisosLimitados of ['aseos.ver_todos', 'aseos.gestionar_todos',
                'aseos.ver_asignados,aseos.gestionar_asignados', 'aseos.ver_asignados,aseos.gestionar_todos']) {
                await db.query("select set_config('test.permisos',$1,true)", [permisosLimitados]);
                await rechaza(() => run(1, 1), /Sin permiso/);
                await rechaza(() => run(1, 0, 'carbon', id(2)), /Sin permiso/);
            }
            await db.exec('reset role');
            await db.exec('create or replace function private.haiku_tiene_permiso(permiso text) returns boolean language sql as $$ select null::boolean $$');
            await db.exec('set role authenticated');
            await rechaza(() => run(1, 1), /Sin permiso/);
            await rechaza(() => run(1, 0, 'carbon', id(2)), /Sin permiso/);
            await db.exec('reset role');
            assert.equal((await cantidad()).length, 1);
            assert.equal(Number((await cantidad())[0].cantidad), 1);
            assert.equal((await db.query('select * from aseos')).rows.length, 1);
        });
        await caso('usuario inactivo y anon no pueden invocar la escritura', async () => {
            await db.query("select set_config('test.activo','false',true)");
            await rechaza(() => run(), /usuario activo/);
            await db.exec('reset role; set role anon');
            await rechaza(() => run(), /permission denied/);
        });
        await caso('authenticated sólo lee: INSERT, UPDATE y DELETE directos rechazados; RPC funciona', async () => {
            const mov = await run();
            await rechaza(() => db.query(`insert into movimientos_insumos
                (fecha_operativa,cabana_id,aseo_id,insumo,origen) values('2026-09-26',$1,$2,'carbon','aseo')`,
                [id(1),mov.aseo_id]), /permission denied/);
            await rechaza(() => db.exec('update movimientos_insumos set cantidad=2'), /permission denied/);
            await rechaza(() => db.exec('delete from movimientos_insumos'), /permission denied/);
            assert.equal(Number((await run(1, 1)).cantidad), 2);
            assert.equal((await cantidad()).length, 1);
        });
        await caso('cantidad en la tabla: 1 y 0 válidos; negativos, fracciones y no finitos rechazados', async () => {
            await run();
            await db.exec('reset role'); // Probar CHECK reales, sin confundirlos con la falta de GRANT.
            for (const valor of [1, 0]) {
                await db.query('update movimientos_insumos set cantidad=$1', [valor]);
                assert.equal(Number((await cantidad())[0].cantidad), valor);
            }
            for (const valor of [-1, 1.5, '1.0000000001', '-0.0001', 'NaN', 'Infinity', '-Infinity', '1000000000']) {
                await rechaza(() => db.query('update movimientos_insumos set cantidad=$1', [valor]), /movimientos_insumos_cantidad_v1/);
            }
            assert.equal(Number((await cantidad())[0].cantidad), 0);
        });
        await caso('unidad en la tabla: sólo unidad; vacía, kg, saco, carga y espacios rechazados', async () => {
            const mov = await run();
            assert.equal(mov.unidad, 'unidad');
            await db.exec('reset role');
            const insertar = unidad => db.query(`insert into movimientos_insumos
                (fecha_operativa,cabana_id,aseo_id,insumo,origen,unidad) values('2026-09-26',$1,$2,'papel','aseo',$3) returning unidad`,
                [id(1),mov.aseo_id,unidad]);
            for (const unidad of ['', 'kg', 'saco', 'carga', ' unidad ', '\t']) {
                await rechaza(() => insertar(unidad), /movimientos_insumos_unidad_v1/);
            }
            assert.equal((await insertar('unidad')).rows[0].unidad, 'unidad');
        });
        await caso('identidad inmutable incluso con escritura privilegiada', async () => {
            await run();
            await db.exec('reset role');
            await rechaza(() => db.query('update movimientos_insumos set cabana_id=$1', [id(2)]), /identidad/);
            await rechaza(() => db.exec("update movimientos_insumos set origen='solicitud'"), /identidad/);
            await rechaza(() => db.exec("update movimientos_insumos set unidad='kg'"), /identidad/);
        });
        await caso('RPC definer con search_path cerrado, EXECUTE restringido y publicación existente', async () => {
            const firma = 'public.haiku_reponer_insumo_aseo_v1(date,uuid,text,integer,numeric)';
            const fn = await one('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [firma]);
            assert.equal(fn.prosecdef, true);
            assert.deepEqual(fn.proconfig, ['search_path=pg_catalog, pg_temp']);
            assert.equal((await one("select has_function_privilege('anon',$1,'EXECUTE') permitido", [firma])).permitido, false);
            assert.equal((await one("select has_function_privilege('authenticated',$1,'EXECUTE') permitido", [firma])).permitido, true);
            assert.equal((await one("select count(*)::int n from pg_policies where tablename='movimientos_insumos' and cmd <> 'SELECT'")).n, 0);
            assert.equal((await one("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='movimientos_insumos'")).n, 1);
        });
        await caso('RPC rechaza cantidad esperada inválida e insumos ajenos a esta interfaz', async () => {
            for (const esperada of [-1, 1.5, 'NaN', 'Infinity']) await rechaza(() => run(1, esperada), /no válida/);
            await rechaza(() => run(1, 0, 'papel'), /no válida/);
            assert.equal((await cantidad()).length, 0);
        });
        await caso('FK compuesta y unicidad impiden otra cabaña, otra fecha y movimiento duplicado', async () => {
            const mov = await run();
            await db.exec('reset role');
            const insertar = (fechaNueva,cabana,insumo) => db.query(`insert into movimientos_insumos
                (fecha_operativa,cabana_id,aseo_id,insumo,origen) values($1,$2,$3,$4,'aseo')`, [fechaNueva,cabana,mov.aseo_id,insumo]);
            await rechaza(() => insertar('2026-09-26',id(2),'carbon'), /foreign key/);
            await rechaza(() => insertar('2026-09-27',id(1),'carbon'), /foreign key/);
            await rechaza(() => insertar('2026-09-26',id(1),'carbon'), /unique constraint/);
            await rechaza(() => db.query(`insert into movimientos_insumos
                (fecha_operativa,cabana_id,aseo_id,insumo,origen) values('2026-09-26',$1,null,'carbon','aseo')`, [id(1)]), /movimientos_insumos_origen_v1/);
            await insertar('2026-09-26',id(1),'papel');
            assert.equal((await cantidad()).length,2,'Otro insumo no necesita columnas nuevas');
        });
        await caso('Leña: 18.4 + 17.9 = 2 sacos y 36.3 kg; cabecera sin contador paralelo', async () => {
            const primero = await saco();
            const segundo = await saco(17.9,id(101));
            assert.equal(primero.id, segundo.id);
            assert.equal(segundo.cantidad, null);
            assert.equal(Number(segundo.cantidad_actual), 2);
            assert.equal(Number(segundo.peso_total_kg), 36.3);
            assert.equal(segundo.sacos.length, 2);
            await rechaza(() => run(1,0,'lena'), /Leña requiere/);
            await db.exec('reset role');
            await rechaza(() => db.query('update movimientos_insumos set cantidad=2 where id=$1', [primero.id]), /movimientos_insumos_cantidad_v1/);
        });
        await caso('sacos: peso obligatorio, positivo y finito; decimal válido', async () => {
            const mov = await saco();
            for (const peso of [null,0,-1,'NaN','Infinity','-Infinity']) await rechaza(() => saco(peso,id(101)), /peso/);
            await db.exec('reset role');
            const insertar = peso => db.query('insert into movimientos_insumos_unidades(movimiento_id,peso_kg) values($1,$2)', [mov.id,peso]);
            for (const peso of [null,0,-1,'NaN','Infinity']) await rechaza(() => insertar(peso), /not-null|peso_v1/);
            await insertar('0.125');
            assert.equal(Number((await one('select peso_total_kg from movimientos_insumos_resumen')).peso_total_kg),18.525);
        });
        await caso('Carbón mantiene contador entero, no admite sacos hijos ni devuelve peso', async () => {
            const mov = await run(); await run(1,1);
            assert.equal(mov.peso_total_kg, null); assert.deepEqual(mov.sacos, []);
            assert.equal((await db.query('select * from movimientos_insumos_unidades')).rows.length, 0);
            await db.exec('reset role');
            await rechaza(() => db.query('insert into movimientos_insumos_unidades(movimiento_id,peso_kg) values($1,18.4)', [mov.id]), /Sólo Leña/);
        });
        await caso('anulación conserva auditoría, llega a cero y es idempotente', async () => {
            const mov = await saco(); await saco(17.9,id(101));
            const parcial = await anular(id(100));
            assert.equal(Number(parcial.cantidad_actual),1); assert.equal(Number(parcial.peso_total_kg),17.9);
            const cero = await anular(id(101)); await anular(id(101));
            assert.equal(cero.id,mov.id); assert.equal(cero.cantidad,null);
            assert.equal(Number(cero.cantidad_actual),0); assert.equal(Number(cero.peso_total_kg),0);
            const unidades = (await db.query('select * from movimientos_insumos_unidades')).rows;
            assert.equal(unidades.length,2);
            assert.ok(unidades.every(s => s.anulado_en && s.registrado_por === id(90) && s.actualizado_por === id(90)));
            assert.equal(Number((await saco(18.4,id(100))).cantidad_actual),0, 'Repetir alta antigua no revive saco anulado');
        });
        await caso('alta idempotente por UUID; dos sacos distintos del mismo peso se conservan', async () => {
            await saco(); await saco();
            assert.equal(Number((await saco(18.4,id(101))).cantidad_actual),2);
            await rechaza(() => saco(19,id(100)), /identidad/);
            await rechaza(() => saco(18.4,id(100),id(2)), /identidad/);
            assert.equal((await cantidad()).length,1);
        });
        await caso('sacos y vista respetan RLS; escritura directa y RPC sin permiso rechazadas', async () => {
            await saco();
            await rechaza(() => db.exec('update movimientos_insumos_unidades set peso_kg=5'), /permission denied/);
            await rechaza(() => db.exec('delete from movimientos_insumos_unidades'), /permission denied/);
            await rechaza(() => db.exec('insert into movimientos_insumos_unidades(peso_kg) values(5)'), /permission denied/);
            assert.equal((await one("select has_table_privilege('authenticated','movimientos_insumos_resumen','UPDATE') permiso")).permiso,false);
            await rechaza(() => db.exec('update movimientos_insumos_resumen set cantidad=5'), /permission denied|cannot update view/);
            await rechaza(() => one("select * from private.haiku_movimiento_aseo_autorizado_v1('2026-09-26',$1,'lena')",[id(1)]), /permission denied/);
            await db.query("select set_config('test.permisos','',true)");
            assert.equal((await db.query('select * from movimientos_insumos_unidades')).rows.length,0);
            assert.equal((await db.query('select * from movimientos_insumos_resumen')).rows.length,0);
            await rechaza(() => saco(18,id(101)), /Sin permiso/); await rechaza(() => anular(id(100)), /Sin permiso/);
            await db.exec('reset role; set role anon');
            await rechaza(() => saco(), /permission denied/); await rechaza(() => anular(id(100)), /permission denied/);
        });
        await caso('resumen diario suma 7 sacos de Leña, 126.8 kg y 4 de Carbón, sólo esa fecha', async () => {
            for (const [i,peso] of [18.4,17.9,18.1,18.2,18,18,18.2].entries()) await saco(peso,id(100+i),i < 4 ? id(1) : id(2));
            for (let i=0;i<4;i++) await run(1,i);
            await saco(99,id(110),id(1),'2026-09-27');
            const total = await one("select sum(cantidad_actual) filter(where insumo='lena') sacos, sum(peso_total_kg) kg, sum(cantidad_actual) filter(where insumo='carbon') carbon from movimientos_insumos_resumen where fecha_operativa='2026-09-26' and origen='aseo'");
            assert.equal(Number(total.sacos),7); assert.equal(Number(total.kg),126.8); assert.equal(Number(total.carbon),4);
        });
        await caso('editar conserva UUID, COUNT, cabecera NULL y creación; cambia SUM y audita autor distinto', async () => {
            await saco(); await saco(17.9,id(101));
            const original=await one('select * from movimientos_insumos_unidades where id=$1',[id(100)]);
            await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id(91)]);
            const resultado=await editar();
            const actual=await one('select * from movimientos_insumos_unidades where id=$1',[id(100)]);
            assert.equal(actual.id,original.id); assert.equal(actual.version,2); assert.equal(actual.registrado_por,id(90));
            assert.deepEqual(actual.creado_en,original.creado_en); assert.equal(actual.actualizado_por,id(91));
            assert.equal(Number(actual.peso_kg),18.7); assert.equal(actual.anulado_en,null);
            assert.equal(resultado.cantidad,null); assert.equal(Number(resultado.cantidad_actual),2); assert.equal(Number(resultado.peso_total_kg),36.6);
            const historial=await one('select * from movimientos_insumos_unidades_historial');
            assert.equal(historial.saco_id,original.id); assert.equal(Number(historial.peso_anterior),18.4);
            assert.equal(Number(historial.peso_nuevo),18.7); assert.equal(historial.corregido_por,id(91));
            assert.deepEqual(historial.corregido_en,actual.actualizado_en);
            assert.equal(historial.version_anterior,1); assert.equal(historial.version_nueva,2);
            assert.equal(Number((await saco()).cantidad_actual),2,'Retry del alta original sigue siendo idempotente después de editar');
        });
        await caso('edición: peso positivo y finito; decimal permitido; versión requerida', async () => {
            await saco();
            for (const peso of [null,0,-1,'NaN','Infinity','-Infinity']) await rechaza(()=>editar(peso),/Peso/);
            for (const version of [null,0,-1]) await rechaza(()=>editar(18.7,version),/versión/);
            assert.equal(Number((await editar('0.125')).peso_total_kg),0.125);
        });
        await caso('versión obsoleta y ABA no pisan correcciones nuevas; mismo peso no genera auditoría falsa', async () => {
            await saco(); await editar();
            await rechaza(()=>editar(19,1),/otro dispositivo/);
            assert.equal(Number((await one('select peso_kg from movimientos_insumos_unidades')).peso_kg),18.7);
            await editar(18.7,2);
            assert.equal((await one('select version from movimientos_insumos_unidades')).version,2);
            await editar(18.4,2);
            await rechaza(()=>editar(19,1),/otro dispositivo/);
            assert.equal((await one('select count(*)::int n from movimientos_insumos_unidades_historial')).n,2);
        });
        await caso('anular después de editar conserva peso e historial, y no permite editar ni revivir', async () => {
            await saco(); await editar(); await anular(id(100)); await anular(id(100));
            await rechaza(()=>editar(19,3),/anulado/);
            const actual=await one('select * from movimientos_insumos_unidades');
            assert.equal(Number(actual.peso_kg),18.7); assert.equal(actual.version,3); assert.ok(actual.anulado_en);
            assert.equal((await one('select count(*)::int n from movimientos_insumos_unidades_historial')).n,1);
            const resultado=await saco();
            assert.equal(Number(resultado.cantidad_actual),0); assert.equal(Number(resultado.peso_total_kg),0);
        });
        await caso('edición e historial son atómicos y el historial no se puede reescribir', async () => {
            await saco(); await db.exec('savepoint antes_de_editar'); await editar();
            await db.exec('rollback to savepoint antes_de_editar');
            assert.equal((await one('select version from movimientos_insumos_unidades')).version,1);
            assert.equal((await one('select count(*)::int n from movimientos_insumos_unidades_historial')).n,0);
            await editar();
            await rechaza(()=>db.exec('update movimientos_insumos_unidades set peso_kg=20'),/permission denied/);
            for (const sql of ['update movimientos_insumos_unidades_historial set peso_nuevo=20',
                'delete from movimientos_insumos_unidades_historial',
                'insert into movimientos_insumos_unidades_historial(peso_nuevo) values(20)']) {
                await rechaza(()=>db.exec(sql),/permission denied/);
            }
            await db.exec('reset role');
            await rechaza(()=>db.exec('update movimientos_insumos_unidades_historial set peso_nuevo=20'),/inmutable/);
            await rechaza(()=>db.exec('delete from movimientos_insumos_unidades_historial'),/inmutable/);
        });
        await caso('RPC de edición exige gestión/visibilidad y usuario activo; historial respeta RLS', async () => {
            await saco(); await editar();
            await db.query("select set_config('test.permisos','aseos.ver_todos',true)");
            await rechaza(()=>editar(19,2),/Sin permiso/);
            await db.query("select set_config('test.permisos','',true)");
            assert.equal((await one('select count(*)::int n from movimientos_insumos_unidades_historial')).n,0);
            await rechaza(()=>editar(19,2),/Sin permiso/);
            await db.query("select set_config('test.permisos',$1,true),set_config('test.activo','false',true)",[permisos]);
            await rechaza(()=>editar(19,2),/activo/);
            await db.exec('reset role; set role anon');
            await rechaza(()=>editar(19,2),/permission denied/);
        });
        await caso('RPC de edición: SECURITY DEFINER, search_path fijo y EXECUTE explícito', async () => {
            const funcion=await one("select prosecdef,proconfig from pg_proc where oid='public.haiku_editar_peso_saco_lena_v1(uuid,numeric,integer)'::regprocedure");
            assert.equal(funcion.prosecdef,true); assert.ok(funcion.proconfig.includes('search_path=pg_catalog, pg_temp'));
            for (const rol of ['anon','authenticated']) {
                const p=await one("select has_function_privilege($1,'public.haiku_editar_peso_saco_lena_v1(uuid,numeric,integer)','EXECUTE') permiso",[rol]);
                assert.equal(p.permiso,rol==='authenticated');
            }
        });
    } finally { await db.close(); }
});
