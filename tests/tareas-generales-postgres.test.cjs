const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('tareas generales: PostgreSQL, permisos, concurrencia e historial compartido', async t => {
    const db = new PGlite();
    let numero = 100;
    const read = async (fecha = '2026-01-19') => (await db.query('select public.haiku_tareas_generales_dia_v1($1) d', [fecha])).rows[0].d;
    const guardar = async (accion, revision, datos = {}, fecha = '2026-01-19', tipo = 'jardines_terraza', operacion = id(numero++)) =>
        (await db.query('select public.haiku_guardar_tarea_general_v1($1,$2,$3,$4,$5,$6) d', [fecha, tipo, revision, accion, JSON.stringify(datos), operacion])).rows[0].d;
    const sesion = async (permisos = 'aseos.ver_todos,aseos.gestionar_todos,revisiones.gestionar', activo = true, sub = id(1)) => {
        await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.permisos',$2,false),set_config('test.activo',$3,false)", [sub, permisos, String(activo)]);
    };
    const rechaza = async (fn, patron) => {
        await db.exec('savepoint rechazo');
        await assert.rejects(fn, patron);
        await db.exec('rollback to savepoint rechazo');
    };
    const caso = async (nombre, fn) => t.test(nombre, async () => {
        await db.exec('begin');
        try { await sesion(); await fn(); } finally { await db.exec('rollback'); }
    });
    try {
        await db.exec(`create schema auth; create schema private; create role authenticated; create role anon;
          grant usage on schema public,auth,private to authenticated;
          create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
          create function private.haiku_usuario_activo() returns boolean language sql stable as $$select current_setting('test.activo',true)='true'$$;
          create function private.haiku_tiene_permiso(codigo text) returns boolean language sql stable as $$select codigo=any(string_to_array(current_setting('test.permisos',true),','))$$;
          create table public.usuarios(id uuid primary key,nombre text,apellido text);
          insert into public.usuarios values('${id(1)}','Felipe','Prueba'),('${id(2)}','Revisora','Prueba');
          create publication supabase_realtime;`);
        const migration = fs.readdirSync(path.join(__dirname, '../supabase/migrations')).find(f => f.endsWith('_tareas_generales_seguimiento_v1.sql'));
        await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', migration), 'utf8'));
        await db.exec('set role authenticated');
        await caso('consultar cinco tareas no crea trabajo ni movimientos ficticios', async () => {
            const d = await read();
            assert.equal(d.tareas.length, 5);
            assert.deepEqual(d.anteriores, []);
            assert.equal(d.tareas.find(t => t.tipo === 'jardines_terraza').descripcion, 'Jardines y terraza Sra. Naifi.');
            assert.equal((await db.query('select count(*)::int n from tareas_generales')).rows[0].n, 0);
            assert.equal(d.puede_editar, true);
        });
        await caso('realizar queda por verificar y la identidad del revisor viene de la sesión', async () => {
            await guardar('asignar', 0, { encargado: 'Camila', revisor: 'Revisora prevista' });
            const inicio = (await guardar('iniciar', 1)).tarea;
            assert.equal(inicio.estado, 'en_curso'); assert.ok(inicio.iniciada_en);
            const realizada = (await guardar('realizar', 2)).tarea;
            assert.equal(realizada.estado, 'realizada'); assert.equal(realizada.verificada_en, null);
            await sesion(undefined, true, id(2));
            const verificada = (await guardar('verificar', 3, { verificada_por_nombre: 'Nombre falso' })).tarea;
            assert.equal(verificada.estado, 'verificada'); assert.equal(verificada.verificada_por, id(2));
            assert.equal(verificada.verificada_por_nombre, 'Revisora Prueba'); assert.ok(verificada.verificada_en);
            const historial = (await db.query("select public.haiku_tareas_generales_historial_v1('2026-01-19','jardines_terraza') d")).rows[0].d;
            assert.equal(historial.length, 4); assert.equal(historial[0].actor_nombre, 'Revisora Prueba');
        });
        await caso('dos dispositivos no pueden guardar sobre una revisión obsoleta', async () => {
            await guardar('asignar', 0, { encargado: 'A' });
            await guardar('asignar', 1, { encargado: 'B' });
            await rechaza(() => guardar('asignar', 1, { encargado: 'A obsoleto' }), /otro dispositivo/);
            const d = await read(); assert.equal(d.tareas.find(t => t.tipo === 'jardines_terraza').encargado, 'B');
            assert.equal((await db.query('select count(*)::int n from tareas_generales_movimientos')).rows[0].n, 2);
        });
        await caso('reintentar un UUID confirma el mismo cambio sin duplicar el historial', async () => {
            const uuid = id(numero++);
            const a = await guardar('asignar', 0, { encargado: 'Camila' }, undefined, undefined, uuid);
            const b = await guardar('asignar', 0, { encargado: 'Camila' }, undefined, undefined, uuid);
            assert.equal(a.tarea.id, b.tarea.id); assert.equal(b.repetida, true); assert.equal(b.tarea.revision, 1);
            await rechaza(() => guardar('asignar', 0, { encargado: 'Otra' }, undefined, undefined, uuid), /otro cambio/);
            assert.equal((await db.query('select count(*)::int n from tareas_generales_movimientos')).rows[0].n, 1);
        });
        await caso('un pendiente anterior conserva su fecha y no se fabrica en días no trabajados', async () => {
            await guardar('asignar', 0, { encargado: 'Camila' });
            await guardar('nota', 1, { nota: 'Revisar limpieza de jardines antes del cierre' });
            const dia = await read('2026-01-22');
            assert.equal(dia.tareas.length, 5); assert.equal(dia.anteriores.length, 1);
            assert.equal(dia.anteriores[0].fecha_operativa, '2026-01-19');
            await guardar('realizar', 2); await guardar('verificar', 3);
            assert.equal((await read('2026-01-22')).anteriores.length, 0);
            assert.equal((await read('2026-01-19')).tareas.find(t => t.tipo === 'jardines_terraza').estado, 'verificada');
        });
        await caso('pedir corrección exige motivo y conserva la revisión previa en auditoría', async () => {
            await guardar('asignar', 0, { encargado: 'Camila' }); await guardar('realizar', 1); await guardar('verificar', 2);
            await rechaza(() => guardar('corregir', 3, { nota: '  ' }), /Escribe una nota/);
            const corregida = (await guardar('corregir', 3, { nota: 'Falta barrer terraza' })).tarea;
            assert.equal(corregida.estado, 'con_detalles'); assert.equal(corregida.verificada_en, null);
            const movimiento = (await db.query("select anterior,resultado from tareas_generales_movimientos where accion='corregir'")).rows[0];
            assert.equal(movimiento.anterior.estado, 'verificada'); assert.equal(movimiento.resultado.nota, 'Falta barrer terraza');
        });
        await caso('validación de responsable, estados, tipos, fechas y textos revierte altas incompletas', async () => {
            await rechaza(() => guardar('iniciar', 0), /responsable/);
            await rechaza(() => guardar('verificar', 0), /Primero marca/);
            await rechaza(() => guardar('asignar', 0, { encargado: 'x'.repeat(121) }), /válido/);
            await rechaza(() => guardar('nota', 0, { nota: ['inválido'] }), /nota/);
            await rechaza(() => guardar('asignar', 0, { encargado: 'A' }, undefined, 'otra'), /no es válido/);
            await rechaza(() => guardar('realizar', 0, {}, '2099-01-01'), /futura/);
            assert.equal((await db.query('select count(*)::int n from tareas_generales')).rows[0].n, 0);
        });
        await caso('recepción puede coordinar; lectura y gestión de aseo no otorgan verificación', async () => {
            await sesion('revisiones.ver,revisiones.gestionar');
            await guardar('asignar', 0, { encargado: 'Camila' });
            await sesion('aseos.ver_todos,aseos.gestionar_todos'); await guardar('realizar', 1);
            assert.equal((await read()).puede_verificar, false);
            await rechaza(() => guardar('verificar', 2), /permiso para verificar/);
            await sesion('revisiones.ver'); assert.equal((await read()).puede_editar, false);
            await rechaza(() => guardar('asignar', 2, { encargado: 'Otro' }), /permiso para modificar/);
        });
        await caso('ni usuarios inactivos, ni sin permiso, ni anónimos leen o escriben', async () => {
            await sesion('', true); await rechaza(() => read(), /permiso/);
            await sesion(undefined, false); await rechaza(() => guardar('asignar', 0, { encargado: 'A' }), /permiso/);
            await sesion(undefined, true, ''); await rechaza(() => read(), /permiso/);
            await db.exec('reset role; set role anon');
            await rechaza(() => read(), /permission denied/);
            await db.exec('reset role; set role authenticated');
        });
        await caso('REST directo no puede cambiar el estado, el revisor ni el historial', async () => {
            await guardar('asignar', 0, { encargado: 'A' });
            await rechaza(() => db.exec("update tareas_generales set estado='verificada'"), /permission denied/);
            await rechaza(() => db.exec('delete from tareas_generales_movimientos'), /permission denied/);
            await sesion('', true);
            assert.equal((await db.query('select count(*)::int n from tareas_generales')).rows[0].n, 0);
            assert.equal((await db.query('select count(*)::int n from tareas_generales_movimientos')).rows[0].n, 0);
        });
    } finally { await db.close(); }
});
