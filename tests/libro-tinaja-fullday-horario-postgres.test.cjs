const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const {read}=require('./fixtures/libro-servicio-manual.cjs');
const migration=read('supabase/migrations/20261019230549_libro_tinaja_fullday_reprogramar_v1.sql');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db,esperado;
const ejecutar=(op=randomUUID(),estado=esperado,inicio='18:00',fin='19:00')=>db.query(
    'select public.haiku_libro_reprogramar_tinaja_fullday_v1($1,$2,$3::jsonb,$4::time,$5::time) r',
    [op,id(4),JSON.stringify(estado),inicio,fin]);
async function rechazo(fn,patron) {
    await db.exec('savepoint rechazo');
    try {await assert.rejects(fn,patron);} finally {await db.exec('rollback to savepoint rechazo');}
}
const ledger=async()=> (await db.query(`select jsonb_build_object(
    'reservas',(select jsonb_agg(to_jsonb(x) order by id) from reservas x),
    'estadias',(select jsonb_agg(to_jsonb(x) order by id) from reserva_estadias x),
    'pagos',(select jsonb_agg(to_jsonb(x) order by id) from pagos x),
    'cargos',(select jsonb_agg(to_jsonb(x) order by id) from cargos x),
    'aplicaciones',(select jsonb_agg(to_jsonb(x) order by id) from pago_aplicaciones x),
    'ajustes',(select jsonb_agg(to_jsonb(x) order by id) from cargo_ajustes x)) r`)).rows[0].r;

test.before(async()=>{
    db=new PGlite();
    await db.exec(read('tests/fixtures/servicio-cortesia-schema.sql'));
    await db.exec(`alter table reserva_estadias add column tipo_estadia text,add column fecha_ingreso date,add column fecha_salida date;
      alter table catalogo_servicios add column requiere_horario boolean default true;
      alter table servicios add column libro_resolucion_manual_v1 jsonb;
      insert into reservas(id,titular_nombre,estado_reserva,bove_checkout) values('${id(1)}','Titular prueba','checked_out','BOVE-CONSERVADO');
      insert into reserva_estadias(id,reserva_id,estado_estadia,tipo_estadia,fecha_ingreso,fecha_salida)
        values('${id(2)}','${id(1)}','checked_out','fullday','2026-10-15','2026-10-15');
      insert into catalogo_servicios(id,codigo,nombre,permite_cortesia) values('${id(3)}','tinajaJacuzzi','Tinaja Jacuzzi',true);
      insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,personas,
        precio_unitario_aplicado,monto_adicional,total,tipo_cobro,motivo_cortesia,observaciones,libro_resolucion_manual_v1)
        values('${id(4)}','${id(1)}','${id(2)}','${id(3)}','2026-10-15','17:00','18:00',2,0,0,0,'cortesia',
        'Full Day: 1 hora incluida','Importado: 17hrs jacuzzi','{"version":1,"origen":"conservar"}');
      insert into cargos(id,reserva_id,estadia_id,tipo_cargo,concepto,monto) values('${id(6)}','${id(1)}','${id(2)}','alojamiento','Full Day',120000);
      insert into pagos(id,reserva_id,monto,tipo_movimiento) values('${id(5)}','${id(1)}',120000,'pago');
      insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values('${id(5)}','${id(6)}',120000);
      select set_config('request.jwt.claim.sub','${id(99)}',false);
      truncate eventos_auditoria;`);
    const identidad=read('supabase/migrations/20260916211226_haku_servicios_idempotencia_atomica.sql');
    await db.exec(identidad.match(/create or replace function private\.haiku_servicio_identidad_guard_v1\(\)[\s\S]*?\$function\$;/)[0]);
    await db.exec(`create trigger haiku_servicio_identidad_guard_v1 before insert or update of
      reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,total,tipo_cobro,estado_servicio
      on public.servicios for each row execute function private.haiku_servicio_identidad_guard_v1()`);
    await db.exec(migration);
    esperado=(await db.query('select to_jsonb(s) r from servicios s where id=$1',[id(4)])).rows[0].r;
});
test.after(async()=>{await db?.close();});
test.beforeEach(async()=>{await db.exec('begin');});
test.afterEach(async()=>{await db.exec('rollback');});

test('SQL: reprograma el mismo servicio histórico, conserva cortesía, origen, BOVE y finanzas; audita ambas horas',async()=>{
    const antes=await ledger(),op=randomUUID(),r=(await ejecutar(op)).rows[0].r;
    assert.equal(r.ok,true);assert.equal(r.servicio_id,id(4));assert.equal(r.total,0);assert.equal(r.tipo_cobro,'cortesia');
    const s=(await db.query('select to_jsonb(s) r from servicios s')).rows[0].r;
    assert.equal(s.hora_inicio,'18:00:00');assert.equal(s.hora_fin,'19:00:00');
    for (const k of Object.keys(esperado).filter(k=>!['hora_inicio','hora_fin','actualizado_en'].includes(k)))
        assert.deepEqual(s[k],esperado[k],k);
    assert.deepEqual(await ledger(),antes);
    const eventos=(await db.query('select * from eventos_auditoria')).rows;assert.equal(eventos.length,1);
    assert.equal(eventos[0].usuario_id,id(99));assert.equal(eventos[0].origen,'haku');
    assert.equal(eventos[0].datos_contexto.operacion_id,op);
    assert.deepEqual(eventos[0].cambios.map(c=>c.campo),['hora_fin','hora_inicio']);
});
test('SQL: reintento acredita la misma operación una vez y rechaza reutilizarla con otra solicitud/usuario',async()=>{
    const op=randomUUID();await ejecutar(op);const r=(await ejecutar(op)).rows[0].r;assert.equal(r.reintento,true);
    assert.equal((await db.query('select count(*)::int n from eventos_auditoria')).rows[0].n,1);
    await rechazo(()=>ejecutar(op,esperado,'19:00','20:00'),/otro usuario o solicitud/);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id(98)]);
    await rechazo(()=>ejecutar(op),/otro usuario o solicitud/);
});
test('SQL: dos confirmaciones pendientes conservan una sola tinaja y una auditoría',async()=>{
    const op=randomUUID(),r=await Promise.all([ejecutar(op),ejecutar(op)]);
    assert.equal(r[1].rows[0].r.reintento,true);
    assert.equal((await db.query('select count(*)::int n from servicios')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from eventos_auditoria')).rows[0].n,1);
});
test('SQL: estado esperado obsoleto y valores incompletos no alteran la tinaja',async()=>{
    for (const mod of [x=>x.hora_inicio='16:00',x=>x.actualizado_en='2026-10-01T12:00:00Z',
        x=>x.estadia_id=id(50),x=>delete x.cantidad]) {
        const x={...esperado};mod(x);await rechazo(()=>ejecutar(randomUUID(),x),/cambió desde la revisión|estado completo/);
    }
    assert.equal((await db.query('select hora_inicio from servicios')).rows[0].hora_inicio,'17:00:00');
});
test('SQL: sesión, usuario activo y permisos son obligatorios; anon no puede invocar ni leer operaciones',async()=>{
    for (const [clave,valor] of [['request.jwt.claim.sub',''],['test.usuario_activo','false'],['test.servicios_editar','false']]) {
        await db.exec('savepoint permisos');await db.query('select set_config($1,$2,true)',[clave,valor]);
        await rechazo(()=>ejecutar(),/permiso para editar servicios/);await db.exec('rollback to savepoint permisos');
    }
    const acl=(await db.query(`select has_function_privilege('anon','public.haiku_libro_reprogramar_tinaja_fullday_v1(uuid,uuid,jsonb,time,time)','execute') anon,
      has_function_privilege('authenticated','public.haiku_libro_reprogramar_tinaja_fullday_v1(uuid,uuid,jsonb,time,time)','execute') autenticado,
      has_table_privilege('authenticated','private.haiku_libro_tinaja_horario_operaciones_v1','select') tabla`)).rows[0];
    assert.deepEqual(acl,{anon:false,autenticado:true,tabla:false});
});
test('SQL: una hora válida dentro de Full Day es el único cambio permitido',async()=>{
    for (const [inicio,fin] of [['09:00','10:00'],['21:00','22:00'],['18:00','20:00'],['18:00','17:00'],['17:00','18:00']])
        await rechazo(()=>ejecutar(randomUUID(),esperado,inicio,fin),/una hora dentro|ya tiene ese horario/);
});
test('SQL: alojamiento, cancelación o tinaja realizada permanecen bloqueados aunque se envíe un snapshot actual',async()=>{
    for (const sql of ["update reserva_estadias set tipo_estadia='alojamiento'",
        "update reserva_estadias set estado_estadia='cancelada'","update reservas set estado_reserva='cancelada'",
        "update servicios set estado_servicio='realizado'","update servicios set cantidad=2",
        "update servicios set tipo_cobro='normal',total=30000"]) {
        await db.exec('savepoint caso');await db.exec(sql);
        const x=(await db.query('select to_jsonb(s) r from servicios s where id=$1',[id(4)])).rows[0].r;
        await rechazo(()=>ejecutar(randomUUID(),x),/sólo se reprograma/);await db.exec('rollback to savepoint caso');
    }
});
test('SQL: otra tinaja en la estadía o historial de cargos impide reprogramar automáticamente',async()=>{
    await db.exec(`insert into servicios select '${id(7)}',reserva_id,estadia_id,catalogo_servicio_id,recurso_id,
      fecha_servicio,'19:00','20:00',cantidad,personas,precio_unitario_aplicado,monto_adicional,total,tipo_cobro,
      motivo_ajuste_precio,motivo_cortesia,estado_servicio,observaciones,creado_por,creado_en,actualizado_en,libro_resolucion_manual_v1
      from servicios where id='${id(4)}'`);
    await rechazo(()=>ejecutar(),/Hay más de una tinaja/);
    await db.query('delete from servicios where id=$1',[id(7)]);
    await db.exec(`insert into cargos(reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado)
      values('${id(1)}','${id(2)}','${id(4)}','servicio','Histórico',30000,'anulado')`);
    await rechazo(()=>ejecutar(),/historial de cargos/);
});
test('SQL: una superposición de horario con otra reserva queda en revisión',async()=>{
    await db.exec(`insert into reservas(id,titular_nombre) values('${id(10)}','Otra reserva');
      insert into reserva_estadias(id,reserva_id,tipo_estadia,fecha_ingreso,fecha_salida)
        values('${id(11)}','${id(10)}','fullday','2026-10-15','2026-10-15');
      insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,personas,
        precio_unitario_aplicado,total,tipo_cobro,motivo_cortesia)
        values('${id(12)}','${id(10)}','${id(11)}','${id(3)}','2026-10-15','18:30','19:30',2,0,0,'cortesia','Incluida');`);
    await rechazo(()=>ejecutar(),/se superpone/);
});
test('SQL: si falta auditoría, la actualización completa se revierte',async()=>{
    await db.exec('alter table servicios disable trigger auditoria_servicios');
    await rechazo(()=>ejecutar(),/historial/);
    assert.equal((await db.query('select hora_inicio from servicios')).rows[0].hora_inicio,'17:00:00');
    assert.equal((await db.query('select count(*)::int n from private.haiku_libro_tinaja_horario_operaciones_v1')).rows[0].n,0);
});
