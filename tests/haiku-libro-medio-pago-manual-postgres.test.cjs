const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {preparar,read}=require('./fixtures/airbnb-libro-writers-sql.cjs');
const migration=read('supabase/migrations/20261007181953_libro_medio_pago_manual_auditoria.sql');
async function entorno() {
    const h=await preparar();
    try {await h.db.exec(migration);return h;} catch(e) {await h.db.close();throw e;}
}
function item(h,{servicio=false}={}) {
    const auditoria={version:1,medio:'tarjeta_credito',usuario:h.usuario,version_libro:'a'.repeat(64),generacion:1,
        elegido_en:'2026-10-07T12:00:00Z',origen:{hoja:'Oct26',celda:'C20:F20'},
        evidencia_original:{monto:30000,moneda:'CLP',medio:null,fecha_comprobante:'2026-10-03',fecha_bloque:'2026-10-03'}};
    return {tipo:servicio?'pago_servicios_4c':'pago',item_id:'original-evidencia-TDC',reserva_id:h.reserva,aprobado_manualmente:true,
        argumentos:{p_reserva_id:h.reserva,p_monto:30000,p_medio_pago:'tarjeta_credito',p_fecha_pago:'2026-10-03',p_codigo_autorizacion:'TDC-REAL-1'},
        datos_origen:{origen:auditoria.origen,fecha_bloque:'2026-10-03',medio_pago_manual_v1:auditoria}};
}
async function estancia(h) {
    const cabana=randomUUID(),estadia=randomUUID();
    await h.db.query('insert into cabanas values($1,2)',[cabana]);
    await h.db.query("insert into reserva_estadias values($1,$2,$3,'2026-10-03','2026-10-04','confirmada')",[estadia,h.reserva,cabana]);
    return estadia;
}
const batch=(h,i,op=randomUUID())=>h.db.query('select haiku_incorporar_libro_v1($1,$2::jsonb) r',[op,JSON.stringify([i])]);
test('migration conserva ACL/owner/search_path/definer y agrega handshake autenticado',async()=>{
    const h=await preparar();try {
        const antes=await h.seguridad();await h.db.exec(migration);
        const existentes=new Set(antes.map(x=>x.oid));assert.deepEqual((await h.seguridad()).filter(x=>existentes.has(x.oid)),antes);
        assert.deepEqual((await h.db.query('select haiku_libro_medio_pago_manual_capacidad_v1() r')).rows[0].r,{version:1,auditoria:true});
        await h.db.query("select set_config('request.jwt.claim.sub','',false)");
        await assert.rejects(h.db.query('select haiku_libro_medio_pago_manual_capacidad_v1()'),/iniciar sesion/);
    } finally {await h.db.close();}
});
test('writer general persiste elección saneada al incorporar; retry no duplica ni modifica auditoría',async()=>{
    const h=await entorno();try {
        const estadia=await estancia(h);await h.db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto) values($1,$2,$3,'alojamiento','activo',30000)",[randomUUID(),h.reserva,estadia]);
        const i=item(h);i.datos_origen.medio_pago_manual_v1.contacto='dato que debe omitirse';const op=randomUUID();
        await batch(h,i,op);const p=(await h.db.query('select * from pagos')).rows[0];
        assert.equal(p.medio_pago,'tarjeta_credito');assert.equal(p.datos_origen.medio_pago_manual_v1.medio,'tarjeta_credito');
        assert.equal(p.datos_origen.medio_pago_manual_v1.usuario,h.usuario);assert.ok(p.datos_origen.medio_pago_manual_v1.incorporado_en);
        assert.equal(p.datos_origen.medio_pago_manual_v1.contacto,undefined);
        await batch(h,i,op);assert.equal((await h.db.query('select count(*)::int n from pagos')).rows[0].n,1);
        assert.deepEqual((await h.db.query('select datos_origen from pagos')).rows[0].datos_origen,p.datos_origen);
    } finally {await h.db.close();}
});
test('los siete medios previos sin decisión de medio mantienen el contrato de incorporación',async()=>{
    const h=await entorno();try {
        const estadia=await estancia(h);await h.db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto) values($1,$2,$3,'alojamiento','activo',30000)",[randomUUID(),h.reserva,estadia]);
        for(const medio of ['transferencia','tarjeta_credito','tarjeta_debito','webpay_credito','webpay_debito','efectivo','airbnb_prepaid_card']) {
            await h.db.exec('begin');try {
                const i=item(h);delete i.datos_origen.medio_pago_manual_v1;i.argumentos.p_medio_pago=medio;
                await batch(h,i);const pagos=(await h.db.query('select * from pagos')).rows;
                assert.equal(pagos.length,1);assert.equal(pagos[0].medio_pago,medio);
                assert.equal(pagos[0].datos_origen.medio_pago_manual_v1,undefined);
            } finally {await h.db.exec('rollback');}
        }
    } finally {await h.db.close();}
});
test('auditoría incompatible, usuario ajeno, origen cambiado y ausencia de aprobación abortan sin pagos',async()=>{
    const h=await entorno();try {
        await estancia(h);
        for(const cambiar of [i=>i.aprobado_manualmente=false,i=>i.datos_origen.medio_pago_manual_v1.medio='otro',
            i=>i.argumentos.p_medio_pago=i.datos_origen.medio_pago_manual_v1.medio='otro',
            i=>i.datos_origen.medio_pago_manual_v1=null,
            i=>i.datos_origen.medio_pago_manual_v1.usuario=randomUUID(),i=>i.datos_origen.medio_pago_manual_v1.origen={hoja:'Otra',celda:'A1'},
            i=>i.datos_origen.medio_pago_manual_v1.evidencia_original.monto++,i=>i.datos_origen.medio_pago_manual_v1.version_libro='desconocida',
            i=>i.datos_origen.medio_pago_manual_v1.elegido_en='invalido',
            i=>i.datos_origen.origen.celda={invalida:'C20'},i=>i.datos_origen.medio_pago_manual_v1.generacion=-1]) {
            const i=item(h);cambiar(i);await assert.rejects(batch(h,i),/medio|eleccion/);
        }
        assert.equal((await h.db.query('select count(*)::int n from pagos')).rows[0].n,0);
    } finally {await h.db.close();}
});
test('comprobante distribuido conserva un padre, suma exacta, aplicaciones y auditoría del medio',async()=>{
    const h=await entorno();try {
        const estadia=await estancia(h),catalogo=randomUUID(),servicio=randomUUID();
        await h.db.query("insert into catalogo_servicios(id,codigo,nombre) values($1,'earlyCheckin','Early Check-In')",[catalogo]);
        await h.db.query("insert into servicios values($1,$2,$3,$4,'2026-10-03','programado',30000,'normal')",[servicio,h.reserva,estadia,catalogo]);
        for(const [tipo,monto,s] of [['alojamiento',20000,null],['servicio',30000,servicio]])
            await h.db.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto) values($1,$2,$3,$4,$5,'activo',$6)",[randomUUID(),h.reserva,estadia,s,tipo,monto]);
        const i=item(h);i.argumentos.p_monto=50000;i.datos_origen.medio_pago_manual_v1.evidencia_original.monto=50000;
        i.datos_origen.distribucion_manual={id:'padre-TDC',titular:'Agustin Rampa Spinelli',cabana:2,estadia_id:estadia,total:50000,
            componentes:[['alojamiento',20000,'cab2/1noche'],['servicio',30000,'early check in']].map(([tipo,monto,concepto],n)=>({
                item_id:'original-parte-'+n,monto,moneda:'CLP',medio_pago:'tarjeta_credito',tipo_movimiento:tipo,
                aprobado_manualmente:true,pago_recibido:true,estado_pago:'registrado_en_libro',fecha_bloque:'2026-10-03',
                fecha_comprobante:'2026-10-03',folio:null,codigo_autorizacion:'TDC-REAL-1',bovtar:null,
                titular:'Agustin Rampa Spinelli',cabana:2,concepto,texto_original:'Comprobante TDC revisado',
                origen:{hoja:'Oct26',celda:'C'+(20+n)+':F'+(20+n)}}))};
        const op=randomUUID();await batch(h,i,op);await batch(h,i,op);
        const pagos=(await h.db.query('select * from pagos')).rows;assert.equal(pagos.length,1);assert.equal(Number(pagos[0].monto),50000);
        assert.equal(pagos[0].datos_origen.distribucion_manual.componentes.length,2);
        assert.equal(pagos[0].datos_origen.medio_pago_manual_v1.medio,'tarjeta_credito');
        assert.equal((await h.db.query('select count(*)::int n,sum(monto_aplicado)::int suma from pago_aplicaciones')).rows[0].suma,50000);
        assert.equal((await h.db.query('select count(*)::int n from pago_aplicaciones')).rows[0].n,2);
    } finally {await h.db.close();}
});
test('writer de servicios mantiene guardas de cargo/saldo y persiste medio manual sólo al incorporar',async()=>{
    const h=await entorno();try {
        const estadia=await estancia(h),catalogo=randomUUID(),servicio=randomUUID(),cargo=randomUUID();
        await h.db.query("insert into catalogo_servicios(id,codigo,nombre) values($1,'tinajaTonel','Tinaja Tonel')",[catalogo]);
        await h.db.query("insert into servicios values($1,$2,$3,$4,'2026-10-03','programado',30000,'normal')",[servicio,h.reserva,estadia,catalogo]);
        await h.db.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto) values($1,$2,$3,$4,'servicio','activo',30000)",[cargo,h.reserva,estadia,servicio]);
        const i=item(h,{servicio:true});i.datos_origen.aplicaciones_servicio_v1={version:1,reserva_id:h.reserva,monto_total:30000,moneda:'CLP',aplicaciones:[{
            cargo_id:cargo,servicio_id:servicio,concepto_canon:'tinaja_tonel',monto:30000,saldo_esperado:30000,aplicado_esperado:0,
            cantidad_aplicaciones_esperada:0,fecha_contexto:'2026-10-03',fecha_servicio_esperada:'2026-10-03'}]};
        const op=randomUUID(),call=()=>h.db.query('select haiku_incorporar_pago_servicios_libro_v1($1,$2::jsonb) r',[op,JSON.stringify(i)]);
        await call();const p=(await h.db.query('select * from pagos')).rows[0];assert.equal(p.datos_origen.medio_pago_manual_v1.medio,'tarjeta_credito');
        assert.equal((await h.db.query('select count(*)::int n from pago_aplicaciones')).rows[0].n,1);await call();
        assert.equal((await h.db.query('select count(*)::int n from pagos')).rows[0].n,1);
    } finally {await h.db.close();}
});
