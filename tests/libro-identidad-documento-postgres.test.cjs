const test=require('node:test'),assert=require('node:assert/strict');
const {preparar}=require('./fixtures/libro-identidad-documento-sql.cjs');
const {randomUUID}=require('node:crypto');
const pago=h=>({tipo:'pago',item_id:'pago-ficticio',reserva_id:h.ids.reserva,
    argumentos:{p_monto:10000,p_medio_pago:'webpay_debito',p_codigo_autorizacion:'FICTICIO-AUT-1',p_fecha_pago:'2026-10-13'},
    datos_origen:{fecha_bloque:'2026-10-13',origen:{hoja:'Oct26',celda:'A99'}}});
const nueva={tipo:'reserva_nueva',item_id:'nueva-ficticia',reserva:{titular_nombre:'Persona Nueva Ficticia'},
    estadias:[{cabana_numero:1,datos:{fecha_ingreso:'2026-10-20',fecha_salida:'2026-10-22',tipo_estadia:'alojamiento',adultos:1,ninos:0,mascotas:0}}]};
test('documento de otro huésped: conflicto tipado antes de cualquier escritura, sin reasociar',async()=>{
    const h=await preparar({aplicar:process.env.HAKU_IDENTIDAD_RED!=='1'});
    try {
        const antes=await h.snapshot();
        await assert.rejects(h.actualizar(h.item()),e=>{
            assert.equal(e.code,'HLI01');assert.match(e.message,/otro huésped.*revisión manual/);
            assert.deepEqual(JSON.parse(e.detail),{item_id:'identidad-ficticia',motivo:'documento_otro_huesped'});
            assert.ok(!String(e.message+e.detail).includes('FICTICIO-B'));return true;
        });
        assert.deepEqual(await h.snapshot(),antes);
    } finally {await h.db.close();}
});
test('mismo nombre y documento de otra fila, incluso sin documento anterior: nunca fusionar automáticamente',async()=>{
    const h=await preparar();try {
        await h.db.query(`update huespedes set nombre='Persona Ficticia A' where id=$1`,[h.ids.owner]);
        await h.db.query('update huespedes set tipo_documento=null,numero_documento=null where id=$1',[h.ids.guest]);
        await h.db.query('update reservas set titular_tipo_documento=null,titular_numero_documento=null where id=$1',[h.ids.reserva]);
        const i=h.item({titular_tipo_documento:'pasaporte',titular_numero_documento:'FICTICIO-B'});
        i.reserva.antes={titular_tipo_documento:null,titular_numero_documento:null};
        const antes=await h.snapshot();await assert.rejects(h.actualizar(i),e=>e.code==='HLI01');
        assert.deepEqual(await h.snapshot(),antes);
    } finally {await h.db.close();}
});
test('documento de la misma fila: actualización revisada válida conserva las tres asociaciones',async()=>{
    const h=await preparar();try {
        const antes=await h.snapshot();const r=await h.actualizar(h.item({titular_nombre:'Persona Ficticia A Revisada'}));
        const despues=await h.snapshot();assert.equal(r.anterior.reserva.titular_numero_documento,'FICTICIO-A');
        assert.equal(despues.reservas[0].titular_nombre,'Persona Ficticia A Revisada');
        assert.equal(despues.huespedes.find(g=>g.id===h.ids.guest).nombre,'Persona Ficticia A Revisada');
        assert.equal(despues.reservas[0].titular_huesped_id,h.ids.guest);
        for(const tabla of ['reserva_huespedes','estadia_huespedes','pagos','pago_aplicaciones','cargos']) assert.deepEqual(despues[tabla],antes[tabla]);
        assert.deepEqual(despues.huespedes.find(g=>g.id===h.ids.owner),antes.huespedes.find(g=>g.id===h.ids.owner));
    } finally {await h.db.close();}
});
for(const via of ['titular','reserva_huespedes','estadia_huespedes']) test(`huésped compartido por ${via}: identidad distinta bloqueada y sin alteración ajena`,async()=>{
    const h=await preparar();try {
        const r=randomUUID(),e=randomUUID();
        await h.db.query(`insert into reservas(id,titular_nombre,titular_huesped_id,estado_reserva) values($1,'Otra Persona Ficticia',$2,'confirmada')`,[r,via==='titular'?h.ids.guest:h.ids.owner]);
        if(via==='reserva_huespedes') await h.db.query('insert into reserva_huespedes values($1,$2)',[r,h.ids.guest]);
        if(via==='estadia_huespedes') {
            await h.db.query(`insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia)
              values($1,$2,$3,'2026-10-20','2026-10-22','confirmada')`,[e,r,h.ids.cabana]);
            await h.db.query('insert into estadia_huespedes values($1,$2)',[e,h.ids.guest]);
        }
        const antes=await h.snapshot();await assert.rejects(h.actualizar(h.item({titular_numero_documento:'FICTICIO-C'})),e=>e.code==='HLI02');
        assert.deepEqual(await h.snapshot(),antes);
        // Identidad ya coincidente: sí permite campos de la reserva sin editar el huésped compartido.
        await h.actualizar(h.item({observaciones:'Nota funcional ficticia'}));
        const despues=await h.snapshot();assert.equal(despues.reservas.find(x=>x.id===h.ids.reserva).observaciones,'Nota funcional ficticia');
        assert.deepEqual(despues.huespedes,antes.huespedes);
        assert.deepEqual(despues.reserva_huespedes,antes.reserva_huespedes);assert.deepEqual(despues.estadia_huespedes,antes.estadia_huespedes);
        // Diferencia de nombre histórica sin editar identidad: no ampliar el hotfix
        // a notas/contactos ni modificar el huésped compartido.
        await h.db.query(`update huespedes set nombre='Nombre Completo Ficticio' where id=$1`,[h.ids.guest]);
        await h.actualizar(h.item({observaciones:'Nota funcional ficticia'}));
        assert.equal((await h.snapshot()).huespedes.find(x=>x.id===h.ids.guest).nombre,'Nombre Completo Ficticio');
    } finally {await h.db.close();}
});
test('lote con alta, pago y actualización conflictiva: rollback total, incluido registro idempotente y auditoría',async()=>{
    const h=await preparar();try {
        const op=randomUUID(),antes=await h.snapshot();
        await assert.rejects(h.lote([nueva,pago(h),h.item()],op),e=>e.code==='HLI01');
        assert.deepEqual(await h.snapshot(),antes);
        await assert.rejects(h.lote([nueva,pago(h),h.item()],op),e=>e.code==='HLI01');
        assert.deepEqual(await h.snapshot(),antes);
        const r=await h.lote([nueva]);assert.equal(r.reservas_creadas,1);assert.equal(r.pagos_creados,0);
        const despues=await h.snapshot(),creada=despues.reservas.find(x=>x.id!==h.ids.reserva);
        assert.equal(creada.titular_nombre,nueva.reserva.titular_nombre);assert.ok(creada.titular_huesped_id);
        const e=despues.reserva_estadias.find(x=>x.reserva_id===creada.id);
        assert.ok(despues.reserva_huespedes.some(x=>x.reserva_id===creada.id&&x.huesped_id===creada.titular_huesped_id));
        assert.ok(despues.estadia_huespedes.some(x=>x.estadia_id===e.id&&x.huesped_id===creada.titular_huesped_id));
        assert.equal(despues.reservas.find(x=>x.id===h.ids.reserva).titular_huesped_id,h.ids.guest);
        assert.deepEqual(despues.pagos,antes.pagos);
    } finally {await h.db.close();}
});
test('lote válido de identidad y pago: retry idempotente y segunda operación sin duplicar comprobante',async()=>{
    const h=await preparar();try {
        const op=randomUUID(),items=[h.item({titular_numero_documento:'FICTICIO-C'}),pago(h)];
        const primero=await h.lote(items,op);assert.equal(primero.actualizaciones,1);assert.equal(primero.pagos_creados,1);
        assert.equal(primero.resultados.find(x=>x.tipo==='reserva_actualizar').anterior.reserva.titular_numero_documento,'FICTICIO-A');
        const antes=await h.snapshot(),retry=await h.lote(items,op);assert.equal(retry.reintento,true);
        assert.deepEqual(await h.snapshot(),antes);
        const nuevo=await h.lote(items);assert.equal(nuevo.pagos_creados,0);assert.equal(nuevo.omitidos,1);
        assert.equal((await h.snapshot()).pagos.length,1);
    } finally {await h.db.close();}
});
test('documento ocupado en la ventana de escritura: el índice sigue vigente y el error no revela el documento',async()=>{
    const h=await preparar();try {
        // Interleaving determinista: otra fila ocupa el documento después del guard.
        await h.db.exec(`create function ocupar_documento_fixture() returns trigger language plpgsql as $$begin
          if new.numero_documento='FICTICIO-C' then
            insert into huespedes(nombre,tipo_documento,numero_documento) values('Concurrente Ficticio','pasaporte','FICTICIO-C');
          end if;return new;end$$;
          create trigger ocupar before update on huespedes for each row execute function ocupar_documento_fixture();`);
        const antes=await h.snapshot();await assert.rejects(h.actualizar(h.item({titular_numero_documento:'FICTICIO-C'})),e=>{
            assert.equal(e.code,'HLI01');assert.ok(!e.message.includes('FICTICIO-C'));return true;
        });assert.deepEqual(await h.snapshot(),antes);
    } finally {await h.db.close();}
});
test('otra restricción unique no se enmascara como conflicto de documento',async()=>{
    const h=await preparar();try {
        await h.db.exec(`create unique index huespedes_nombre_fixture on huespedes(nombre);`);
        const antes=await h.snapshot();await assert.rejects(h.actualizar(h.item({titular_nombre:'Persona Ficticia B',titular_numero_documento:'FICTICIO-C'})),e=>e.code==='23505'&&e.constraint==='huespedes_nombre_fixture');
        assert.deepEqual(await h.snapshot(),antes);
    } finally {await h.db.close();}
});
test('migration preserva owner/ACL/invoker/search_path y toda la rama pago_actualizar',async()=>{
    const h=await preparar({aplicar:false});try {
        const {read}=require('./fixtures/airbnb-libro-writers-sql.cjs'),{migration}=require('./fixtures/libro-identidad-documento-sql.cjs');
        const antes=await h.seguridad();await h.db.exec(read('supabase/migrations/'+migration()));
        assert.deepEqual(await h.seguridad(),antes);
        const src=(await h.db.query(`select prosrc from pg_proc where oid='private.haiku_libro_actualizar_v1(jsonb)'::regprocedure`)).rows[0].prosrc;
        const pago=s=>s.slice(s.indexOf("  elsif p_item->>'tipo'='pago_actualizar' then"));
        assert.equal(pago(src),pago(h.original.prosrc));assert.ok(pago(src).includes('airbnb_prepaid_card'));
        const acl=(await h.db.query(`select has_function_privilege('authenticated','private.haiku_libro_actualizar_v1(jsonb)','EXECUTE') a,
          has_function_privilege('anon','private.haiku_libro_actualizar_v1(jsonb)','EXECUTE') b`)).rows[0];
        assert.deepEqual(acl,{a:false,b:false});
    } finally {await h.db.close();}
});
test('sin sesión o sin permiso no hay escrituras de identidad',async()=>{
    const h=await preparar();try {
        const antes=await h.snapshot();await h.db.exec("select set_config('haku.test_permit','off',false)");
        await assert.rejects(h.actualizar(h.item({titular_numero_documento:'FICTICIO-C'})),e=>e.code==='42501');
        await h.db.exec("select set_config('haku.test_permit','on',false);select set_config('request.jwt.claim.sub','',false)");
        await assert.rejects(h.actualizar(h.item({titular_numero_documento:'FICTICIO-C'})),e=>e.code==='42501');
        assert.deepEqual(await h.snapshot(),antes);
    } finally {await h.db.close();}
});
for(const alteracion of ['cuerpo','indice']) test(`migration aborta si cambió ${alteracion}; no reemplaza una definición no auditada`,async()=>{
    const h=await preparar({aplicar:false});try {
        const {read}=require('./fixtures/airbnb-libro-writers-sql.cjs'),{migration}=require('./fixtures/libro-identidad-documento-sql.cjs');
        if(alteracion==='cuerpo') {
            const sql=(await h.db.query(`select pg_get_functiondef('private.haiku_libro_actualizar_v1(jsonb)'::regprocedure) sql`)).rows[0].sql;
            await h.db.exec(sql.replace('v_date_change boolean;','v_date_change boolean; -- Cambio ficticio no auditado'));
        } else await h.db.exec(`drop index huespedes_documento_uidx;
            create unique index huespedes_documento_uidx on huespedes(tipo_documento,numero_documento) where tipo_documento is not null;`);
        const antes=await h.snapshot(),seguridad=await h.seguridad();
        const cuerpo=(await h.db.query(`select prosrc from pg_proc where oid='private.haiku_libro_actualizar_v1(jsonb)'::regprocedure`)).rows[0].prosrc;
        await assert.rejects(h.db.exec(read('supabase/migrations/'+migration())),/no coincide|Índice de documentos inesperado/);
        await h.db.exec('rollback');assert.deepEqual(await h.snapshot(),antes);assert.deepEqual(await h.seguridad(),seguridad);
        assert.equal((await h.db.query(`select prosrc from pg_proc where oid='private.haiku_libro_actualizar_v1(jsonb)'::regprocedure`)).rows[0].prosrc,cuerpo);
    } finally {await h.db.close();}
});
