const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {preparar,read}=require('./fixtures/airbnb-libro-writers-sql.cjs');
const migration=read('supabase/migrations/20261006231428_airbnb_prepaid_card.sql');
const method='airbnb_prepaid_card',fecha='2026-10-12',bloque='2026-10-06';
const count=async db=>(await db.query('select count(*)::int n from pagos')).rows[0].n;
const batch=async(db,item,op=randomUUID())=>(await db.query('select haiku_incorporar_libro_v1($1,$2::jsonb) r',[op,JSON.stringify([item])])).rows[0].r;
const serviceCall=async(db,item,op=randomUUID())=>(await db.query('select haiku_incorporar_pago_servicios_libro_v1($1,$2::jsonb) r',[op,JSON.stringify(item)])).rows[0].r;
async function estancia(db,reserva,numero=4) {
    const cabana=randomUUID(),estadia=randomUUID();
    await db.query('insert into cabanas values($1,$2)',[cabana,numero]);
    await db.query("insert into reserva_estadias values($1,$2,$3,'2026-10-06','2026-10-07','confirmada')",[estadia,reserva,cabana]);
    return estadia;
}
async function cargo(db,reserva,estadia,monto,tipo='alojamiento',servicio=null) {
    const id=randomUUID();
    await db.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto) values($1,$2,$3,$4,$5,'activo',$6)",[id,reserva,estadia,servicio,tipo,monto]);return id;
}
const argumentos=(reserva,monto)=>({p_reserva_id:reserva,p_monto:monto,p_medio_pago:method,p_fecha_pago:fecha,
    p_folio:null,p_codigo_autorizacion:null,p_bove:null,p_referencia_externa:null});
const normal=reserva=>({tipo:'pago',item_id:'Libro-Oct26-O27-Airbnb',reserva_id:reserva,aprobado_manualmente:true,
    argumentos:argumentos(reserva,165598),datos_origen:{fecha_bloque:bloque,origen:{hoja:'Oct26',celda:'O27:R27'}}});
const componente=(monto,tipo,indice)=>({item_id:'parte-'+indice,monto,moneda:'CLP',medio_pago:method,tipo_movimiento:tipo,
    aprobado_manualmente:true,pago_recibido:true,estado_pago:'registrado_en_libro',fecha_bloque:bloque,fecha_comprobante:fecha,
    folio:null,codigo_autorizacion:null,bovtar:null,titular:'Agustin Rampa Spinelli',cabana:4,
    concepto:tipo==='servicio'?'early check in':'cab4/1noche',texto_original:'Aviso económico Airbnb y confirmación revisados',
    origen:{hoja:'Oct26',celda:'O'+(27+indice)+':R'+(27+indice)}});
async function distribucion(db,reserva) {
    const estadia=await estancia(db,reserva);await cargo(db,reserva,estadia,153000);
    const catalogo=randomUUID(),servicio=randomUUID();
    await db.query("insert into catalogo_servicios(id,codigo) values($1,'earlyCheckin')",[catalogo]);
    await db.query("insert into servicios values($1,$2,$3,$4,'2026-10-06','programado',40000,'normal')",[servicio,reserva,estadia,catalogo]);
    await cargo(db,reserva,estadia,40000,'servicio',servicio);
    return {...normal(reserva),item_id:'Libro-Airbnb-distribucion',argumentos:argumentos(reserva,193000),
        datos_origen:{fecha_bloque:bloque,origen:{hoja:'Oct26',celda:'O27:R28'},distribucion_manual:{
            id:'recibo-distribuido',titular:'Agustin Rampa Spinelli',cabana:4,estadia_id:estadia,total:193000,
            componentes:[componente(153000,'alojamiento',0),componente(40000,'servicio',1)]}}};
}
async function servicio(db,reserva,{indice=0,fechaServicio=bloque}={}) {
    const estadia=(await db.query('select id from reserva_estadias where reserva_id=$1',[reserva])).rows[0]?.id||await estancia(db,reserva);
    const catalogo=randomUUID(),servicio=randomUUID();
    await db.query("insert into catalogo_servicios(id,codigo,nombre) values($1,'tinajaTonel','Tinaja Tonel de Madera')",[catalogo]);
    await db.query("insert into servicios values($1,$2,$3,$4,$5,'programado',30000,'normal')",[servicio,reserva,estadia,catalogo,fechaServicio]);
    const cargoId=await cargo(db,reserva,estadia,30000,'servicio',servicio);
    return {tipo:'pago_servicios_4c',item_id:'Libro-Airbnb-tinaja-'+indice,reserva_id:reserva,aprobado_manualmente:true,
        argumentos:argumentos(reserva,30000),datos_origen:{fecha_bloque:bloque,origen:{hoja:'Oct26',celda:'O'+(35+indice)+':R'+(35+indice)},
            aplicaciones_servicio_v1:{version:1,reserva_id:reserva,monto_total:30000,moneda:'CLP',aplicaciones:[{
                cargo_id:cargoId,servicio_id:servicio,concepto_canon:'tinaja_tonel',monto:30000,saldo_esperado:30000,
                aplicado_esperado:0,cantidad_aplicaciones_esperada:0,fecha_contexto:fechaServicio,fecha_servicio_esperada:fechaServicio}]}}};
}
async function tarjeta(db,reserva,referencia) {
    const row=(await db.query(`select haiku_registrar_pago($1,30000,'tarjeta_debito',p_fecha_pago=>'2026-10-06',
        p_folio=>'OLD-F',p_codigo_autorizacion=>'OLD-C',p_bove=>'OLD-B',p_referencia_externa=>$2,p_modo_aplicacion=>'ninguno') r`,[reserva,referencia])).rows[0].r;
    await db.query(`update pagos set datos_origen='{"bovtar":"OLD-B","folio":"OLD-F","bove":"OLD-B","codigo_autorizacion":"OLD-C","otro":"conservar"}' where id=$1`,[row.pago_id]);
    return row.pago_id;
}
const actualizar=(reserva,pago,medio,referencia)=>({tipo:'pago_actualizar',item_id:'correccion-Airbnb',reserva_id:reserva,pago_id:pago,
    identificadores:{codigo_autorizacion:'OLD-C'},pago:{antes:{medio_pago:'tarjeta_debito',...(referencia?{referencia_externa:'HEREDADA'}:{})},
        despues:{medio_pago:medio,...(referencia?{referencia_externa:referencia}:{})}}});

test('Airbnb alojamiento exige aprobación aunque reciba IDs Transbank y crea un pago sin heredarlos',async()=>{
    const {db,reserva}=await preparar();try {
        await estancia(db,reserva);const item=normal(reserva);
        item.argumentos={...item.argumentos,p_folio:'FAKE',p_codigo_autorizacion:'FAKE',p_bove:'FAKE'};item.datos_origen.bovtar='FAKE';
        await assert.rejects(batch(db,{...item,aprobado_manualmente:false}),/aprobacion manual/);
        await batch(db,item);const p=(await db.query('select * from pagos')).rows[0];
        for(const campo of ['folio','bove','codigo_autorizacion'])assert.equal(p[campo],null);
        assert.equal(p.datos_origen.bovtar,undefined);assert.equal(p.medio_pago,method);
        await batch(db,item);assert.equal(await count(db),1);
    } finally {await db.close();}
});

test('Airbnb distribuido permite la aprobación sin Transbank y conserva composición, suma, cargos y reintentos',async()=>{
    const {db,reserva}=await preparar();try {
        const item=await distribucion(db,reserva);
        await assert.rejects(batch(db,{...item,aprobado_manualmente:false}),/aprobacion manual/);
        for(const cambio of [i=>i.datos_origen.distribucion_manual.componentes[1].aprobado_manualmente=false,
            i=>i.datos_origen.distribucion_manual.total=1,
            i=>i.datos_origen.distribucion_manual.estadia_id=randomUUID()]) {
            const bad=structuredClone(item);cambio(bad);await assert.rejects(batch(db,bad));assert.equal(await count(db),0);
        }
        await batch(db,item);await batch(db,item);
        assert.equal(await count(db),1);assert.equal(Number((await db.query('select sum(monto_aplicado) n from pago_aplicaciones')).rows[0].n),193000);
        assert.ok((await db.query('select saldo_cargo from vista_estado_cargos')).rows.every(r=>Number(r.saldo_cargo)===0));
        assert.equal((await db.query('select datos_origen from pagos')).rows[0].datos_origen.distribucion_manual.componentes.length,2);
    } finally {await db.close();}
});

test('Airbnb distribuido de grupo conserva destinos y aprobación por componente sin exigir Transbank',async()=>{
    const {db,reserva}=await preparar();try {
        const grupo=randomUUID(),otra=randomUUID(),e1=await estancia(db,reserva,4);
        await db.query('update reservas set grupo_reserva_id=$1 where id=$2',[grupo,reserva]);
        await db.query("insert into reservas(id,titular_nombre,estado_reserva,grupo_reserva_id) values($1,'Agustin Rampa Spinelli','confirmada',$2)",[otra,grupo]);
        const e2=await estancia(db,otra,5);await cargo(db,reserva,e1,153000);await cargo(db,otra,e2,40000);
        const item={...normal(reserva),item_id:'Libro-Airbnb-grupo',argumentos:argumentos(reserva,193000),datos_origen:{fecha_bloque:bloque,
            origen:{hoja:'Oct26',celda:'O27:V27'},distribucion_manual:{id:'grupo-recibo',tipo:'grupo_alojamiento',grupo_reserva_id:grupo,
                titular:'Agustin Rampa Spinelli',titular_pago:'Agustin Rampa Spinelli',total:193000,
                componentes:[[reserva,e1,4,153000],[otra,e2,5,40000]].map(([rid,e,cab,monto],i)=>({
                    ...componente(monto,'alojamiento',i),reserva_id:rid,estadia_id:e,cabana:cab,grupo_reserva_id:grupo,titular_reserva:'Agustin Rampa Spinelli'}))}}};
        const bad=structuredClone(item);bad.datos_origen.distribucion_manual.componentes[1].aprobado_manualmente=false;
        await assert.rejects(batch(db,bad),/incompatibles/);assert.equal(await count(db),0);
        await batch(db,item);await batch(db,item);assert.equal(await count(db),1);
        assert.equal(Number((await db.query('select sum(monto_aplicado) n from pago_aplicaciones')).rows[0].n),193000);
    } finally {await db.close();}
});

test('Airbnb servicios exige aprobación, fecha, origen y snapshots completos; los rechazos no dejan pagos/operaciones',async()=>{
    const {db,reserva}=await preparar();try {
        const item=await servicio(db,reserva);
        for(const cambio of [i=>i.aprobado_manualmente=false,i=>i.item_id=' ',i=>i.item_id={falso:'item'},i=>delete i.datos_origen.origen,
            i=>i.datos_origen.origen.celda={falsa:'celda'},
            i=>i.argumentos.p_fecha_pago=null,i=>i.argumentos.p_fecha_pago='imposible',
            i=>i.datos_origen.aplicaciones_servicio_v1.aplicaciones[0].saldo_esperado=1,
            i=>i.datos_origen.aplicaciones_servicio_v1.aplicaciones[0].servicio_id=randomUUID(),
            i=>i.datos_origen.aplicaciones_servicio_v1.aplicaciones[0].monto=29999]) {
            const bad=structuredClone(item);cambio(bad);await assert.rejects(serviceCall(db,bad));assert.equal(await count(db),0);
        }
        const app=item.datos_origen.aplicaciones_servicio_v1.aplicaciones[0];
        for(const [sql,args] of [["update reservas set estado_reserva='cancelada' where id=$1",[reserva]],
            ["update cargos set estado='anulado' where id=$1",[app.cargo_id]],
            ["update servicios set estado_servicio='cancelado' where id=$1",[app.servicio_id]],
            ["update servicios set tipo_cobro='cortesia' where id=$1",[app.servicio_id]],
            ["select set_config('haku.test_permit','off',true)",[]]]) {
            await db.exec('begin');try {await db.query(sql,args);await assert.rejects(serviceCall(db,item));}finally{await db.exec('rollback');}
        }
        assert.equal((await db.query('select count(*)::int n from private.haiku_libro_pagos_servicio_operaciones')).rows[0].n,0);
        await serviceCall(db,item);assert.equal(await count(db),1);
        assert.equal(Number((await db.query('select sum(monto_aplicado) n from pago_aplicaciones')).rows[0].n),30000);
    } finally {await db.close();}
});

test('otra operación del mismo item/origen Airbnb no duplica; cambiar sus datos falla cerrado',async()=>{
    const {db,reserva}=await preparar();try {
        const item=await servicio(db,reserva),op=randomUUID();item.datos_origen.item_id='ID-ANIDADO-AJENO';
        const locks=async()=>(await db.query(`with claves as (
            select private.haiku_libro_lock_key_v1('pago_identificador',token) llave from unnest(array[
                'libro_item:'||$1,'libro_origen:'||jsonb_build_array($2::uuid,$3::text,$4::text)::text]) token
            ) select count(*)::int n from claves c join pg_locks l on l.locktype='advisory'
              and l.classid=((c.llave>>32)&4294967295)::oid and l.objid=(c.llave&4294967295)::oid
              and l.objsubid=1 and l.mode='ExclusiveLock' and l.granted`,
            [item.item_id,reserva,item.datos_origen.origen.hoja,item.datos_origen.origen.celda])).rows[0].n;
        await db.exec('begin');const first=await serviceCall(db,item,op);assert.equal(first.pagos_creados,1);
        assert.equal(await locks(),2,'PostgreSQL mantiene ambos locks de identidad hasta el fin de la transacción');
        await db.exec('commit');assert.equal(await locks(),0,'los locks se liberan al confirmar');
        assert.equal((await serviceCall(db,item,op)).reintento,true);
        const repeated=await serviceCall(db,item);assert.equal(repeated.omitidos,1);assert.equal(repeated.pago_id,first.pago_id);
        assert.equal((await serviceCall(db,{...item,item_id:'otro-id-mismo-origen'})).omitidos,1);
        for(const cambio of [i=>i.argumentos.p_fecha_pago='2026-10-13',i=>i.argumentos.p_referencia_externa='OTRA',
            i=>i.argumentos.p_monto=i.datos_origen.aplicaciones_servicio_v1.monto_total=31000,
            i=>i.datos_origen.origen.celda='O99:R99']) {
            const bad=structuredClone(item);cambio(bad);await assert.rejects(serviceCall(db,bad),/datos distintos/);
        }
        assert.equal(await count(db),1);
        const stored=(await db.query('select * from pagos')).rows[0];assert.equal(stored.datos_origen.item_id,item.item_id);
        assert.equal(stored.referencia_externa,null);assert.equal(stored.datos_origen.bovtar,undefined);
        for(const k of ['folio','bove','codigo_autorizacion'])assert.equal(stored[k],null);
        await db.query("update pagos set estado='anulado' where id=$1",[stored.id]);
        await assert.rejects(serviceCall(db,item),/datos distintos/);assert.equal(await count(db),1,'un ítem procesado y anulado exige nueva revisión');
        const cuerpo=(await db.query("select prosrc from pg_proc where proname='haiku_libro_pago_servicios_v1'")).rows[0].prosrc;
        assert.ok(cuerpo.indexOf("'libro_item:'")<cuerpo.indexOf('with coincidencias'));
        assert.ok(cuerpo.indexOf("'libro_origen:'")<cuerpo.indexOf('with coincidencias'));
    } finally {await db.close();}
});

test('dos items/orígenes distintos con el mismo monto crean pagos diferentes, sin identidad por monto/nombre/fecha',async()=>{
    const {db,reserva}=await preparar();try {
        const a=await servicio(db,reserva,{indice:0}),b=await servicio(db,reserva,{indice:1,fechaServicio:'2026-10-07'});
        await serviceCall(db,a);await serviceCall(db,b);assert.equal(await count(db),2);
        assert.equal(Number((await db.query('select sum(monto_aplicado) n from pago_aplicaciones')).rows[0].n),60000);
    } finally {await db.close();}
});

test('medios tradicionales conservan CodAut o Folio+BOVTAR en distribución, grupo y servicios',async()=>{
    const {db,reserva}=await preparar();try {
        const dist=await distribucion(db,reserva),svc=await servicio(db,reserva);
        for(const medio of ['transferencia','webpay_credito','webpay_debito','tarjeta_credito','tarjeta_debito','efectivo','otro']) {
            const d=structuredClone(dist);d.argumentos.p_medio_pago=medio;d.datos_origen.distribucion_manual.componentes.forEach(p=>p.medio_pago=medio);
            await assert.rejects(batch(db,d),medio==='otro'?/medio no admitido/:/identificador transaccional fuerte/);
            await assert.rejects(db.query('select private.haiku_libro_pago_grupo_distribuido_v1($1,$2::jsonb,$3::jsonb,true)',
                [reserva,JSON.stringify({...d.argumentos}),JSON.stringify({...d.datos_origen,distribucion_manual:{...d.datos_origen.distribucion_manual,tipo:'grupo_alojamiento'}})]),/identificador transaccional fuerte/);
            const s=structuredClone(svc);s.argumentos.p_medio_pago=medio;await assert.rejects(serviceCall(db,s),/identificador transaccional fuerte/);
        }
        const tarjeta=structuredClone(svc);tarjeta.argumentos.p_medio_pago='tarjeta_debito';tarjeta.argumentos.p_folio='REAL-F';
        tarjeta.argumentos.p_bove='REAL-B';tarjeta.datos_origen.bovtar='REAL-B';await serviceCall(db,tarjeta);
        const stored=(await db.query('select * from pagos')).rows[0];assert.equal(stored.folio,'REAL-F');assert.equal(stored.bove,'REAL-B');
    } finally {await db.close();}
});

test('actualizar tarjeta a Airbnb limpia todos los identificadores activos y preserva sólo la referencia explícita real',async()=>{
    const {db,reserva}=await preparar();try {
        for(const referencia of [undefined,'AIR-REAL']) {
            const p=await tarjeta(db,reserva,'HEREDADA');
            await batch(db,actualizar(reserva,p,method,referencia));
            const row=(await db.query('select * from pagos where id=$1',[p])).rows[0];
            assert.equal(row.medio_pago,method);assert.equal(row.referencia_externa,referencia||null);
            for(const k of ['folio','bove','codigo_autorizacion']) {assert.equal(row[k],null);assert.equal(row.datos_origen[k],undefined);}
            assert.equal(row.datos_origen.bovtar,null);assert.equal(row.datos_origen.otro,'conservar');
            assert.equal(row.datos_origen.ultima_actualizacion_libro.anterior.folio,'OLD-F','historial original conservado');
        }
    } finally {await db.close();}
});

test('actualización a otro medio mantiene el contrato anterior y la guardia de preview',async()=>{
    const {db,reserva}=await preparar();try {
        const p=await tarjeta(db,reserva,'HEREDADA');const item=actualizar(reserva,p,'transferencia','017-REAL');
        const bad=structuredClone(item);bad.pago.antes.medio_pago='efectivo';await assert.rejects(batch(db,bad),/cambió/);
        await batch(db,item);const row=(await db.query('select * from pagos where id=$1',[p])).rows[0];
        assert.equal(row.medio_pago,'transferencia');assert.equal(row.referencia_externa,'017-REAL');
        assert.equal(row.folio,'OLD-F');assert.equal(row.codigo_autorizacion,'OLD-C');assert.equal(row.bove,'OLD-B');assert.equal(row.datos_origen.bovtar,'OLD-B');
    } finally {await db.close();}
});

test('seguridad/ACL/search_path/owner de todas las funciones y EXECUTE del helper de permisos quedan idénticos',async()=>{
    const {db,antes,seguridad}=await preparar();try {
        assert.deepEqual(await seguridad(),antes);
        for(const name of ['haiku_libro_pago_distribuido_v1','haiku_libro_pago_grupo_distribuido_v1','haiku_libro_pago_servicios_v1']) {
            assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') autorizado",['private.'+name+'(uuid,jsonb,jsonb,boolean)'])).rows[0].autorizado,false);
        }
        assert.equal((await db.query("select has_function_privilege('authenticated','private.haiku_tiene_permiso(text)','execute') autorizado")).rows[0].autorizado,true);
    } finally {await db.close();}
});

test('forma inesperada, search_path o security cambiados y sobrecargas abortan toda la migration',async()=>{
    const {db}=await preparar({aplicar:false});try {
        for(const firma of ['private.haiku_libro_pago_distribuido_v1(uuid,jsonb,jsonb,boolean)',
            'private.haiku_libro_pago_grupo_distribuido_v1(uuid,jsonb,jsonb,boolean)',
            'private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean)','private.haiku_libro_actualizar_v1(jsonb)',
            'public.haiku_incorporar_pago_servicios_libro_v1(uuid,jsonb)']) {
            const row=(await db.query('select pg_get_functiondef($1::regprocedure) def,prosrc from pg_proc where oid=$1::regprocedure',[firma])).rows[0];
            await db.exec(row.def.replace(row.prosrc,()=>row.prosrc+'\n-- definición diferente\n'));
            await assert.rejects(db.exec(migration),/Definicion auditada inesperada/);await db.exec('rollback');
            assert.equal((await db.query("select pg_get_constraintdef(oid) def from pg_constraint where conname='pagos_medio_pago_valido'")).rows[0].def.includes(method),false);
            await db.exec(row.def);
        }
        const firma='private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean)';
        for(const cambio of ['security definer','set search_path=public','strict','immutable']) {
            await db.exec('begin');await db.exec('alter function '+firma+' '+cambio);
            await assert.rejects(db.exec(migration),/Definicion auditada inesperada/);await db.exec('rollback');
        }
        await db.exec("create function private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean,text) returns jsonb language sql as $$select '{}'::jsonb$$");
        await assert.rejects(db.exec(migration),/Sobrecarga no auditada/);await db.exec('rollback');
        assert.equal(await count(db),0);
    } finally {await db.close();}
});
