const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const {read}=require('./fixtures/libro-servicio-manual.cjs');
const migration=read('supabase/migrations/20261020063659_libro_revision_servicio_admin_v1.sql');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db,esperado;
const ejecutar=(o={})=>db.query('select public.haiku_libro_revision_servicio_admin_v1($1,$2,$3,$4,$5::jsonb,$6,$7,$8::time,$9::time,$10,$11) r',
    [o.op||randomUUID(),id(4),'srv:prueba','evidencia exacta del Libro',JSON.stringify(o.esperado||esperado),o.modo||'conservar',
        o.codigo||(o.modo==='actualizar'?'tinajaJacuzzi':'tinajaTonel'),o.inicio||(o.modo==='actualizar'?'17:15':'16:15'),
        o.fin||(o.modo==='actualizar'?'20:30':'18:15'),o.motivo??'Revisado por administrador',o.conservar??true]);
async function rechazo(fn,re){await db.exec('savepoint rechazo');try{await assert.rejects(fn,re);}finally{await db.exec('rollback to savepoint rechazo');}}
const estado=async()=>(await db.query('select private.haiku_libro_estado_admin_v1(s)||jsonb_build_object(\'actualizado_en\',s.actualizado_en) r from servicios s where id=$1',[id(4)])).rows[0].r;
const finanzas=async()=>(await db.query('select private.haiku_libro_admin_finanzas_v1($1) r',[id(1)])).rows[0].r;
test.before(async()=>{
    db=new PGlite();await db.exec(read('tests/fixtures/servicio-cortesia-schema.sql'));
    await db.exec(`create table roles(id uuid primary key,codigo text,activo boolean);create table usuario_roles(usuario_id uuid,rol_id uuid);
      alter table reserva_estadias add column tipo_estadia text,add column fecha_ingreso date,add column fecha_salida date;
      alter table catalogo_servicios add column capacidad_maxima integer;
      insert into roles values('${id(90)}','administrador',true);insert into usuario_roles values('${id(99)}','${id(90)}');
      insert into reservas(id,titular_nombre,estado_reserva) values('${id(1)}','Reserva de prueba','checked_out');
      insert into reserva_estadias(id,reserva_id,estado_estadia,tipo_estadia,fecha_ingreso,fecha_salida)
        values('${id(2)}','${id(1)}','checked_out','alojamiento','2026-10-16','2026-10-17');
      insert into catalogo_servicios(id,codigo,nombre,capacidad_maxima) values('${id(3)}','tinajaTonel','Tonel de madera',3),('${id(7)}','tinajaJacuzzi','Jacuzzi',5);
      insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,cantidad,personas,
        precio_unitario_aplicado,monto_adicional,total,tipo_cobro,observaciones)
        values('${id(4)}','${id(1)}','${id(2)}','${id(3)}','2026-10-16','16:15','18:15',2,2,15000,0,30000,'normal','Origen conservado');
      insert into pagos(id,reserva_id,monto,tipo_movimiento) values('${id(5)}','${id(1)}',30000,'pago');
      insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) select '${id(5)}',id,30000 from cargos where servicio_id='${id(4)}';
      select set_config('request.jwt.claim.sub','${id(99)}',false);truncate eventos_auditoria;`);
    await db.exec(migration);esperado=await estado();
});
test.after(async()=>{await db?.close();});test.beforeEach(async()=>{await db.exec('begin');});test.afterEach(async()=>{await db.exec('rollback');});
test('SQL conservar registra decisión y auditoría del administrador, sin cambiar agenda, cobro ni BOVE',async()=>{
    await db.exec("update reservas set bove_checkout='BOVE-CONSERVADO'");const antes=await finanzas(),op=randomUUID();
    const r=(await ejecutar({op})).rows[0].r;assert.equal(r.ok,true);assert.equal(r.total,30000);assert.equal(r.revision.usuario,id(99));
    assert.deepEqual(await finanzas(),antes);assert.deepEqual({...await estado(),actualizado_en:esperado.actualizado_en},esperado);
    const a=(await db.query('select * from eventos_auditoria')).rows;assert.equal(a.length,1);
    assert.equal(a[0].origen,'haku');assert.equal(a[0].datos_contexto.operacion_id,op);
    assert.deepEqual(a[0].cambios.map(c=>c.campo),['libro_revision_admin_v1']);
});
test('SQL corregir cambia tipo y horas del mismo servicio conservando cantidad, precio, cargos y aplicaciones',async()=>{
    const antes=await finanzas();const r=(await ejecutar({modo:'actualizar'})).rows[0].r;assert.equal(r.ok,true);
    const s=await estado();assert.equal(s.catalogo_servicio_id,id(7));assert.equal(s.hora_inicio,'17:15');assert.equal(s.hora_fin,'20:30');
    assert.equal(s.cantidad,2);assert.equal(s.total,30000);assert.equal(s.precio_unitario_aplicado,15000);
    assert.deepEqual(await finanzas(),antes);assert.equal((await db.query('select count(*)::int n from servicios')).rows[0].n,1);
});
test('SQL repeticiones de la misma operación son idempotentes y otras solicitudes/usuarios no la reutilizan',async()=>{
    const op=randomUUID();await ejecutar({op,modo:'actualizar'});const r=(await ejecutar({op,modo:'actualizar'})).rows[0].r;
    assert.equal(r.reintento,true);assert.equal((await db.query('select count(*)::int n from eventos_auditoria')).rows[0].n,1);
    await rechazo(()=>ejecutar({op,modo:'actualizar',motivo:'Otro motivo'}),/otro usuario o solicitud/);
    await db.exec(`insert into usuario_roles values('${id(98)}','${id(90)}');select set_config('request.jwt.claim.sub','${id(98)}',true)`);
    await rechazo(()=>ejecutar({op,modo:'actualizar'}),/otro usuario o solicitud/);
});
test('SQL sesión, rol administrador activo y permiso son obligatorios; no hay acceso anon al RPC ni a operaciones',async()=>{
    for(const sql of ["select set_config('request.jwt.claim.sub','',true)","select set_config('test.usuario_activo','false',true)",
        "select set_config('test.servicios_editar','false',true)","update roles set codigo='recepcion'","update roles set activo=false"]){
        await db.exec('savepoint permiso');await db.exec(sql);await rechazo(()=>ejecutar(),/Sólo un administrador/);await db.exec('rollback to savepoint permiso');
    }
    const acl=(await db.query(`select has_function_privilege('anon','public.haiku_libro_revision_servicio_admin_v1(uuid,uuid,text,text,jsonb,text,text,time,time,text,boolean)','execute') anon,
      has_function_privilege('authenticated','public.haiku_libro_revision_servicio_admin_v1(uuid,uuid,text,text,jsonb,text,text,time,time,text,boolean)','execute') autenticado,
      has_table_privilege('authenticated','private.haiku_libro_revision_admin_ops_v1','select') tabla`)).rows[0];
    assert.deepEqual(acl,{anon:false,autenticado:true,tabla:false});
});
test('SQL estado obsoleto, confirmación o motivo ausentes bloquean antes de modificar',async()=>{
    for(const opciones of [{esperado:{...esperado,total:40000}},{esperado:{...esperado,actualizado_en:'2000-01-01T00:00:00Z'}},
        {conservar:false},{motivo:''}])await rechazo(()=>ejecutar(opciones),/cambió desde|Completa la decisión/);
    assert.equal((await db.query('select count(*)::int n from private.haiku_libro_revision_admin_ops_v1')).rows[0].n,0);
});
test('SQL valores fuera de horario, capacidad, estado y superposición conservan la revisión',async()=>{
    await rechazo(()=>ejecutar({modo:'actualizar',inicio:'23:00',fin:'23:45'}),/requieren revisión/);
    await db.exec(`insert into reservas(id,titular_nombre) values('${id(10)}','Otra reserva');
      insert into reserva_estadias(id,reserva_id,tipo_estadia,fecha_ingreso,fecha_salida) values('${id(11)}','${id(10)}','alojamiento','2026-10-16','2026-10-17');
      insert into servicios(reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,personas,precio_unitario_aplicado,total,tipo_cobro)
        values('${id(10)}','${id(11)}','${id(7)}','2026-10-16','18:00','19:00',2,30000,30000,'normal');`);
    await rechazo(()=>ejecutar({modo:'actualizar'}),/se superpone/);
});
test('SQL el trigger impide falsificar la aceptación y una auditoría ausente revierte la operación',async()=>{
    await rechazo(()=>db.exec(`update servicios set libro_revision_admin_v1='{"usuario":"${id(99)}"}'`),/confirmación protegida/);
    await db.exec('alter table servicios disable trigger auditoria_servicios');
    await rechazo(()=>ejecutar(),/acreditar la decisión/);
    assert.equal((await db.query('select libro_revision_admin_v1 from servicios')).rows[0].libro_revision_admin_v1,null);
});
test('SQL la pérdida de BOVE por un trigger de catálogo revierte el cambio completo; un cambio de horario lo conserva',async()=>{
    await db.exec("update reservas set bove_checkout='BOVE-CONSERVADO'");const antes=await finanzas();
    await rechazo(()=>ejecutar({modo:'actualizar'}),/alteraría importes, pagos o comprobantes/);assert.deepEqual(await finanzas(),antes);
    await ejecutar({modo:'actualizar',codigo:'tinajaTonel'});assert.deepEqual(await finanzas(),antes);
});
