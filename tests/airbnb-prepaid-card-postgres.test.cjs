const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const migration = read('supabase/migrations/20261006203958_airbnb_prepaid_card.sql');
const rpc = (file, name) => read(`supabase/migrations/${file}`).match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`, 'i'))[0];

async function preparar() {
    return require('./fixtures/airbnb-libro-writers-sql.cjs').preparar();
}
const pago = (extra = {}) => ({ medio:'airbnb_prepaid_card', monto:165598,
    fecha_pago:'2026-10-06T12:00:00Z', ...extra });

test('constraint accepts all previous methods plus Airbnb; unknown values still fail', async () => {
    const { db, reserva } = await preparar();
    try {
        for (const m of ['transferencia','webpay_credito','webpay_debito','tarjeta_credito','tarjeta_debito','efectivo','otro','airbnb_prepaid_card']) {
            await db.query("insert into pagos(reserva_id,monto,medio_pago) values($1,1,$2)", [reserva,m]);
        }
        await assert.rejects(db.query("insert into pagos(reserva_id,monto,medio_pago) values($1,1,'airbnb')", [reserva]), /pagos_medio_pago_valido/);
        const result=(await db.query(`select haiku_registrar_pago($1,1000,'airbnb_prepaid_card',
            p_folio=>'unused',p_codigo_autorizacion=>'unused',p_bove=>'unused',p_referencia_externa=>'AIR-REAL') result`,[reserva])).rows[0].result;
        const stored=(await db.query('select * from pagos where id=$1',[result.pago_id])).rows[0];
        assert.equal(stored.folio,null); assert.equal(stored.bove,null); assert.equal(stored.codigo_autorizacion,null);
        assert.equal(stored.referencia_externa,'AIR-REAL');
    } finally { await db.close(); }
});

test('real legacy/group check-in and both correction RPCs accept Airbnb without Transbank fields and retain optional reference',async()=>{
    const {db,reserva}=await preparar();
    try {
        for(const name of ['haiku_registrar_pago_checkin','haiku_registrar_pago_checkin_grupo']) {
            const result=(await db.query(`select ${name}($1,1000,'airbnb_prepaid_card','AIR-REAL',null,null,true) result`,[reserva])).rows[0].result;
            const row=(await db.query('select * from pagos where id=$1',[result.pago_id])).rows[0];
            assert.equal(row.medio_pago,'airbnb_prepaid_card'); assert.equal(row.referencia_externa,'AIR-REAL');
        }
        for(const name of ['haiku_corregir_abono','haiku_corregir_abono_saldo_favor']) {
            const viejo=(await db.query(`select haiku_registrar_pago($1,1000,'efectivo',p_modo_aplicacion=>'ninguno') result`,[reserva])).rows[0].result.pago_id;
            await assert.rejects(db.query(`select ${name}($1,1200,'airbnb_prepaid_card',null)`,[viejo]),/fecha real/);
            const result=(await db.query(`select ${name}($1,1200,'airbnb_prepaid_card','2026-10-05',p_referencia_externa=>'CB-REAL') result`,[viejo])).rows[0].result;
            const nuevo=result.reemplazo?.pago_id || result.pago_nuevo_id;
            assert.ok(nuevo,JSON.stringify(result));
            const row=(await db.query('select * from pagos where id=$1',[nuevo])).rows[0];
            assert.equal(row.medio_pago,'airbnb_prepaid_card'); assert.equal(row.referencia_externa,'CB-REAL');
            assert.equal(row.folio,null); assert.equal(row.bove,null); assert.equal(row.codigo_autorizacion,null);
            assert.equal((await db.query('select estado from pagos where id=$1',[viejo])).rows[0].estado,'anulado');
        }
    } finally {await db.close();}
});

test('real multi-abono and existing-reservation RPCs preserve optional external references, dates and no card IDs', async () => {
    const { db, reserva } = await preparar();
    try {
        const creado = (await db.query(`select haiku_crear_reserva_con_abonos(
            'Persona Prueba',4::smallint,'2026-10-06'::date,'2026-10-07'::date,
            p_pagos=>$1::jsonb) result`, [JSON.stringify([pago({referencia_externa:'AIR-000004'}),pago({monto:5000})])])).rows[0].result;
        assert.equal(creado.cantidad_pagos, 2);
        const existente = (await db.query('select haiku_registrar_abonos_reserva_existente_asistente($1,$2::jsonb) result',
            [reserva,JSON.stringify([pago({glosa:'CB-009'}),pago({monto:8000})])])).rows[0].result;
        assert.equal(existente.cantidad_pagos, 2);
        const rows = (await db.query('select medio_pago,referencia_externa,folio,bove,codigo_autorizacion,fecha_pago from pagos order by creado_en,id')).rows;
        assert.equal(rows.length,4);
        assert.deepEqual(rows.map(p=>p.referencia_externa).filter(Boolean).sort(),['AIR-000004','CB-009']);
        assert.ok(rows.every(p=>p.medio_pago==='airbnb_prepaid_card'&&!p.folio&&!p.bove&&!p.codigo_autorizacion&&p.fecha_pago));
        for (const dato of [pago({monto:0}),pago({fecha_pago:null}),pago({medio:'airbnb'})]) {
            await assert.rejects(db.query('select haiku_registrar_abonos_reserva_existente_asistente($1,$2::jsonb)',[reserva,JSON.stringify([dato])]));
        }
        assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,4);
        // Existing strong transfer duplicate guard remains exact and operative.
        const transferencia = {medio:'transferencia',monto:1000,fecha_pago:'2026-10-05T12:00:00Z',glosa:'017REAL'};
        await db.query('select haiku_registrar_abonos_reserva_existente_asistente($1,$2::jsonb)',[reserva,JSON.stringify([transferencia])]);
        await assert.rejects(db.query('select haiku_registrar_abonos_reserva_existente_asistente($1,$2::jsonb)',[reserva,JSON.stringify([transferencia])]),/Ya existe una transferencia/);
    } finally { await db.close(); }
});

test('check-in, checkout patch and confirmed edits: Manager guard kept, optional reference kept, Transbank IDs cleared, history kept', async () => {
    const { db, reserva } = await preparar();
    try {
        for (const name of ['haiku_registrar_pago_checkin_v2','haiku_registrar_pago_checkout']) {
            await assert.rejects(db.query(`select ${name}($1,165598,'airbnb_prepaid_card',p_manager_revisado=>false)`, [reserva]), /Manager/);
            const result = (await db.query(`select ${name}($1,165598,'airbnb_prepaid_card',
                ' AIR-REAL ','unused-folio','unused-bovtar','unused-codaut',true) result`,[reserva])).rows[0].result;
            const id = result.pago_id;
            const row = (await db.query('select * from pagos where id=$1',[id])).rows[0];
            assert.equal(row.referencia_externa,'AIR-REAL');
            assert.equal(row.medio_pago,'airbnb_prepaid_card');
            assert.equal(row.folio,null); assert.equal(row.bove,null); assert.equal(row.codigo_autorizacion,null);
            await db.query("select haiku_editar_pago_confirmado_saldo($1,'airbnb_prepaid_card',' CB-EDIT ','F','B','C')",[id]);
            const edit = (await db.query('select * from pagos where id=$1',[id])).rows[0];
            assert.equal(edit.referencia_externa,'CB-EDIT');
            assert.equal(edit.datos_origen.historial_ediciones.length,1);
            assert.equal(edit.folio,null); assert.equal(edit.bove,null); assert.equal(edit.codigo_autorizacion,null);
            await assert.rejects(db.query("select haiku_editar_pago_confirmado_saldo($1,'transferencia')",[id]),/requiere Glosa/);
            await assert.rejects(db.query("select haiku_editar_pago_confirmado_saldo($1,'webpay_credito')",[id]),/requiere CodAut/);
        }
        await db.exec("select set_config('haku.test_permit','off',false)");
        await assert.rejects(db.query("select haiku_registrar_pago_checkin_v2($1,1,'airbnb_prepaid_card',p_manager_revisado=>true)",[reserva]),/permiso/);
    } finally { await db.close(); }
});

test('Libro authority and all existing guards remain in patched RPC; exclusively WebPay bodies are excluded',async()=>{
    const { db,cuerpos } = await preparar();
    try {
        const before = cuerpos.get('public.haiku_incorporar_libro_v1').replace(/\r/g,'');
        const body = (await db.query("select prosrc from pg_proc where proname='haiku_incorporar_libro_v1'")).rows[0].prosrc;
        assert.equal(body.replace(",'airbnb_prepaid_card'",'')
            .replace(/\n    if v_medio='airbnb_prepaid_card' then[\s\S]*?\n    end if;/,''),before);
        assert.match(body,/not v_fuerte and not v_manual/);
        assert.match(body,/v_fecha_pago is null/);
        assert.match(body,/haiku_libro_incorporaciones/);
        assert.doesNotMatch(migration, /'haiku_registrar_webpay_pendiente'|'haiku_crear_reserva_con_webpay'/);
        const webpay=(await db.query("select prosrc from pg_proc where proname='haiku_crear_reserva_con_webpay'")).rows[0].prosrc;
        assert.equal(webpay,rpc('20260904145500_asistente_reserva_webpay_atomico.sql','haiku_crear_reserva_con_webpay')
            .match(/as \$function\$([\s\S]*?)\$function\$/i)[1]);
        await assert.rejects(db.query(`select haiku_crear_reserva_con_webpay('Persona Prueba',4::smallint,
            '2026-10-06'::date,'2026-10-07'::date,p_webpay_monto=>1000,p_webpay_medio=>'airbnb_prepaid_card',p_webpay_codaut=>'0001')`),/medio debe ser WebPay/);
        assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,0);
    } finally { await db.close(); }
});

test('an unexpected deployed general whitelist aborts the entire migration instead of leaving a partial rollout',async()=>{
    const {db}=await preparar();
    try {
        await db.exec(`create function public.otro_writer_no_auditado(p_medio text) returns void language plpgsql as $$begin
          if p_medio not in ('transferencia','webpay_credito','webpay_debito','tarjeta_credito','tarjeta_debito','efectivo')
            then raise exception 'Medio invalido'; end if; end$$;`);
        const before=(await db.query("select pg_get_constraintdef(oid) def from pg_constraint where conname='pagos_medio_pago_valido'")).rows[0].def;
        // The migration is run against the already patched fixture to test the
        // audit/rollback barrier, not to claim migrations must be rerun in prod.
        const audit=migration.slice(migration.indexOf('  -- Detect additional deployed'),migration.indexOf('  foreach nombre'));
        await assert.rejects(db.exec(`begin; alter table pagos drop constraint pagos_medio_pago_valido;
          do $$declare f record;lista text[];begin ${audit} end$$; commit;`),/Whitelist general aun sin Airbnb/);
        await db.exec('rollback');
        assert.equal((await db.query("select pg_get_constraintdef(oid) def from pg_constraint where conname='pagos_medio_pago_valido'")).rows[0].def,before);
    } finally {await db.close();}
});

test('Airbnb Libro requires real date/manual review, ignores Transbank authority, and preserves operation/item idempotency without amount-only identity',async()=>{
    const {db,reserva}=await preparar();
    try {
        const cabana=randomUUID(),estadia=randomUUID();
        await db.query('insert into cabanas values($1,4)',[cabana]);
        await db.query("insert into reserva_estadias values($1,$2,$3,'2026-10-06','2026-10-07','confirmada')",[estadia,reserva,cabana]);
        const item={tipo:'pago',item_id:'Oct26-Airbnb-4-1',reserva_id:reserva,aprobado_manualmente:false,
            argumentos:{p_reserva_id:reserva,p_monto:165598,p_medio_pago:'airbnb_prepaid_card',
                p_fecha_pago:'2026-10-05',p_folio:'unused',p_codigo_autorizacion:'unused',p_bove:'unused',p_referencia_externa:'AIR-REAL'},
            datos_origen:{fecha_bloque:'2026-10-06',origen:{hoja:'Oct26',celda:'O27:R27'}}};
        const call=async(p,op=randomUUID())=>db.query('select haiku_incorporar_libro_v1($1,$2::jsonb)',[op,JSON.stringify([p])]);
        await assert.rejects(call(item),/identificador fuerte ni aprobacion manual/);
        item.aprobado_manualmente=true;
        await assert.rejects(call({...item,argumentos:{...item.argumentos,p_fecha_pago:null}}),/monto y fecha/);
        assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,0);
        const op=randomUUID();
        await call(item,op);await call(item,op);await call(item);
        assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,1);
        const stored=(await db.query('select * from pagos')).rows[0];
        assert.equal(stored.medio_pago,'airbnb_prepaid_card');assert.equal(stored.referencia_externa,'AIR-REAL');
        assert.equal(stored.folio,null);assert.equal(stored.bove,null);assert.equal(stored.codigo_autorizacion,null);
        await call({...item,item_id:'Oct26-Airbnb-4-2',argumentos:{...item.argumentos,p_referencia_externa:'AIR-SECOND'}});
        assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,2,'same amount is not a unique identity');
    } finally {await db.close();}
});

test('manual Airbnb frontend resolution reaches the real Libro RPC only at incorporation and retains the confirmed date/method',async()=>{
    const {entorno,id,ACCION}=require('./fixtures/libro-airbnb-confirmacion-manual.cjs');
    const {db,reserva}=await preparar();
    try {
        const cabana=randomUUID(),estadia=randomUUID();
        await db.query('insert into cabanas values($1,4)',[cabana]);
        await db.query("insert into reserva_estadias values($1,$2,$3,'2026-10-06','2026-10-07','confirmada')",[estadia,reserva,cabana]);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(90)]);
        const h=entorno({reservaId:reserva,estadiaId:estadia});
        h.opciones.escritor=async(nombre,args)=>{
            assert.equal(nombre,'haiku_incorporar_libro_v1');
            return {data:(await db.query('select haiku_incorporar_libro_v1($1,$2::jsonb) result',
                [args.p_operacion_id,JSON.stringify(args.p_items)])).rows[0].result};
        };
        const first=await h.preparar(),item=first.items.find(i=>i.pagoLibro);
        const next=await h.resolver(first,item,{...ACCION,referencia:'AIR-REAL'});
        assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,0,'preparar/aprobar no registra pagos');
        assert.equal(h.llamadas.filter(x=>x.nombre).length,0);
        await h.incorporar(next);await h.incorporar(next);
        const submitted=h.llamadas.find(x=>x.nombre).args.p_items;
        // A new operation for the same source item also uses the existing backend duplicate guard.
        await db.query('select haiku_incorporar_libro_v1($1,$2::jsonb)',[randomUUID(),JSON.stringify(submitted)]);
        const rows=(await db.query('select *,fecha_pago::date::text fecha_real from pagos')).rows;
        assert.equal(rows.length,1);const stored=rows[0];
        assert.equal(stored.reserva_id,reserva);assert.equal(stored.pagador_nombre,'Agustin Rampa Spinelli');
        assert.equal(stored.monto,165598);assert.equal(stored.medio_pago,'airbnb_prepaid_card');
        assert.equal(stored.fecha_real,ACCION.fecha);assert.equal(stored.referencia_externa,'AIR-REAL');
        for(const key of ['folio','bove','codigo_autorizacion'])assert.equal(stored[key],null);
        assert.equal(stored.datos_origen.item_id,item.id);assert.equal(stored.datos_origen.aprobado_manualmente,true);
        assert.deepEqual(stored.datos_origen.origen_libro,h.p.origen);
        assert.equal(h.p.fecha_comprobante,null,'la fecha manual nunca se inserta en el Libro original');
    } finally {await db.close();}
});
