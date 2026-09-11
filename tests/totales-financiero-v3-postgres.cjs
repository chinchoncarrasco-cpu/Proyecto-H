// Sólo PostgreSQL efímero; IDs y datos de prueba, sin conexión remota.
const assert=require('node:assert/strict'),init=require('./fixtures/total-v3-runtime.cjs');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=await init();let checks=0;
const v31=process.argv.includes('--v31');
if(v31)await db.exec(require('node:fs').readFileSync('supabase/migrations/20260910235134_haiku_total_financiero_v31_guard_servicios.sql','utf8'));
const q=(s,p=[])=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
const snap=async()=>{const o={};for(const t of ['reservas','huespedes','reserva_estadias','estadia_noches','cargos','cargo_ajustes','pagos','pago_aplicaciones','servicios','notas','solicitudes','eventos_auditoria'])o[t]=(await one('select coalesce(jsonb_agg(to_jsonb(t) order by id),\'[]\') v from '+t+' t')).v;return o;};
const call=items=>q('select haiku_cambiar_totales_lote_v1($1::jsonb)',[JSON.stringify(items)]);
const test=async(name,fn)=>{await q('begin');try{await fn();checks++;console.log('OK '+name);}finally{await q('rollback');}};
const fail=async(items,re)=>{const b=await snap();await q('savepoint falla');await assert.rejects(call(items),re);await q('rollback to falla');assert.deepEqual(await snap(),b);};
const cargos=async(n)=>(await q('select c.id,n.fecha from cargos c join estadia_noches n on n.id=c.estadia_noche_id where c.reserva_id=$1 order by n.fecha,c.id',[id(n)])).rows;
const crear=async(n=2,iva=true)=>{
 await q('insert into cabanas(id,numero) values($1,$2)',[id(100+n),n+10]);
 await q("insert into reservas(id,titular_nombre,estado_reserva,titular_numero_documento,bove_cierre,bove_checkout) values($1,'Titular sintético','checked_out','12.345.678-9','BOVE A','BOVE B')",[id(n)]);
 await q("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia) values($1,$2,$3,'2026-09-04','2026-09-07','alojamiento','checked_out')",[id(200+n),id(n),id(100+n)]);
 await q("insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) select $1,'2026-09-04'::date+i,170000,'libro' from generate_series(0,2)i",[id(200+n)]);
 if(iva)await q("select haiku_aplicar_ajuste_reserva($1,'iva_exento',null)",[id(n)]);
 return cargos(n);
};
const pago=async(p,n,monto,apps)=>{await q("insert into pagos(id,reserva_id,monto,estado,tipo_movimiento,etapa_operativa,medio_pago,bove,folio,codigo_autorizacion,observaciones,datos_origen) values($1,$2,$3,'confirmado','pago','abono','tarjeta','BOVTAR prueba','folio prueba','aut prueba','glosa intacta','{}')",[id(p),id(n),monto]);for(const [c,m]of apps)await q('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,$3)',[id(p),c,m]);};
const item=async(n=2,total=459000)=>{const a=(await one('select total_alojamiento t from vista_saldos_alojamiento_reserva where reserva_id=$1',[id(n)])).t;const r={reserva_id:id(n),total_actual:a,total_objetivo:total};if((await one("select count(*) n from cargo_ajustes where reserva_id=$1 and estado='activo'",[id(n)])).n>0)r.firma_iva=(await one('select private.haiku_plan_total_iva_v3($1,$2) p',[id(n),total])).p.firma;return r;};
const bruno=async()=>{const c=await crear();await pago(501,2,173571,[[c[2].id,170000],[c[0].id,3571]]);await pago(502,2,285429,[[c[0].id,112143],[c[1].id,142857]]);return c;};
const fisico=async(n=2)=>(await q('select coalesce(sum(pa.monto_aplicado),0)::bigint aplicado,(c.monto+coalesce((select sum(signo*monto) from cargo_ajustes where cargo_id=c.id),0))::bigint efectivo from cargos c join estadia_noches en on en.id=c.estadia_noche_id left join pago_aplicaciones pa on pa.cargo_id=c.id where c.reserva_id=$1 group by c.id,en.fecha order by en.fecha',[id(n)])).rows;
try{
await test('Bruno exacto: IVA, 459000 aplicados, metadata/documentos/BOVE/estados intactos',async()=>{await bruno();const b=await snap();await call([await item()]);const a=await snap();assert.deepEqual(await fisico(),Array(3).fill({aplicado:153000,efectivo:153000}));for(const t of ['pagos','reservas','huespedes','reserva_estadias','servicios','notas','solicitudes'])assert.deepEqual(a[t],b[t]);assert.equal(a.pago_aplicaciones.length,b.pago_aplicaciones.length);assert.equal(a.cargos.filter(c=>c.reserva_id===id(2)).reduce((s,c)=>s+c.monto,0),546210);assert.equal(a.cargo_ajustes.reduce((s,c)=>s+c.monto,0),87210);const ev=a.eventos_auditoria.at(-1).datos_contexto;assert.equal(ev.reconciliacion_aplicaciones.incremento,30429);});
await test('confirmado menor: redistribuye exceso y deja saldo real',async()=>{const c=await crear(2,false);await pago(501,2,170000,[[c[2].id,170000]]);await call([await item(2,300000)]);const f=await fisico();assert.equal(f.reduce((s,c)=>s+c.aplicado,0),170000);assert.ok(f.every(c=>c.aplicado<=c.efectivo));assert.equal(f.reduce((s,c)=>s+c.efectivo-c.aplicado,0),130000);});
await test('saldo sin aplicar llena nueva capacidad',async()=>{const c=await crear(2,false);await pago(501,2,300000,[[c[0].id,100000]]);await call([await item(2,300000)]);assert.deepEqual(await fisico(),Array(3).fill({aplicado:100000,efectivo:100000}));});
await test('sobrepago bloquea',async()=>{await bruno();await q('update pagos set monto=monto+1 where id=$1',[id(502)]);await fail([await item()],/Sobrepago/);});
await test('servicio no se toca ni se toma su dinero',async()=>{const c=await bruno();await q("insert into servicios(id,reserva_id,total,estado_servicio) values($1,$2,1000,'pendiente')",[id(900),id(2)]);await q("insert into cargos(id,reserva_id,servicio_id,tipo_cargo,monto,estado) values($1,$2,$3,'servicio',1000,'activo')",[id(901),id(2),id(900)]);await pago(503,2,1000,[[id(901),1000]]);await fail([await item()],/Servicios/);});
await test('devolución no se usa',async()=>{await bruno();await q("insert into pagos(id,reserva_id,monto,estado,tipo_movimiento,pago_origen_id) values($1,$2,1,'confirmado','devolucion',$3)",[id(503),id(2),id(501)]);await fail([await item()],/no elegible/);});
await test('otra reserva no se usa',async()=>{await bruno();await q('update pagos set reserva_id=$1 where id=$2',[id(1),id(501)]);await fail([await item()],/ajenas/);});
await test('dinero ambiguo sin aplicación previa bloquea',async()=>{await crear(2,false);await pago(501,2,10,[]);await fail([await item(2,300000)],/no elegible/);});
await test('residuo de un peso exacto',async()=>{const c=await crear(2,false);await pago(501,2,300001,[[c[0].id,170000]]);await call([await item(2,300001)]);assert.deepEqual(await fisico(),[{aplicado:100001,efectivo:100001},{aplicado:100000,efectivo:100000},{aplicado:100000,efectivo:100000}]);});
await test('varios pagos y aplicaciones: conservación por pago',async()=>{await bruno();await call([await item()]);const r=(await q('select p.monto,sum(pa.monto_aplicado)::bigint aplicado from pagos p join pago_aplicaciones pa on pa.pago_id=p.id where p.reserva_id=$1 group by p.id',[id(2)])).rows;assert.ok(r.every(p=>p.monto===p.aplicado));});
await test('lote Bruno + Constanza',async()=>{await bruno();await call([{reserva_id:id(1),total_actual:180000,total_objetivo:160000},await item()]);assert.equal((await item(1,160000)).total_actual,160000);assert.deepEqual(await fisico(),Array(3).fill({aplicado:153000,efectivo:153000}));});
await test('fallo durante escritura Bruno revierte Constanza',async()=>{await bruno();await db.exec("create function fallo_v3() returns trigger language plpgsql as $$begin raise exception 'fallo forzado';end;$$;create trigger fallo before update on cargo_ajustes for each row execute function fallo_v3();");await fail([{reserva_id:id(1),total_actual:180000,total_objetivo:160000},await item()],/fallo forzado/);});
await test('metadata pago alterada por trigger revierte todo',async()=>{await bruno();await db.exec("create function lateral_v3() returns trigger language plpgsql as $$begin update public.pagos set observaciones='alterado';return new;end;$$;create trigger efecto_lateral after update on pago_aplicaciones for each row execute function lateral_v3();");await fail([await item()],/datos ajenos/);});
await test('aplicación nueva legítima, misma reserva, sin pagos nuevos',async()=>{const c=await crear(2,false);await pago(501,2,300000,[[c[2].id,170000]]);const b=await snap();await call([await item(2,300000)]);const a=await snap();assert.deepEqual(a.pagos,b.pagos);assert.equal(a.pago_aplicaciones.length,b.pago_aplicaciones.length+2);});
await test('expected_total obsoleto bloquea lote',async()=>{await bruno();await fail([{...await item(),total_actual:428570}],/cambió/);});
await test('idempotente no vuelve a escribir ni auditar',async()=>{await bruno();await call([await item()]);const b=await snap();await call([await item()]);assert.deepEqual(await snap(),b);});
await test('destino desconocido en metadata bloquea',async()=>{await bruno();await q("update pagos set datos_origen='{\"reservado_servicios\":true}' where id=$1",[id(502)]);await fail([await item()],/no elegible/);});
await test('pago no confirmado bloquea',async()=>{await bruno();await q("update pagos set estado='pendiente' where id=$1",[id(502)]);await fail([await item()],/no elegible/);});
await test('permisos bloquean',async()=>{await bruno();const i=await item();await q("select set_config('haku.test_permit','off',true)");await fail([i],/permisos/);});
await test('capacidad insuficiente en plan impide reconciliación',async()=>{await bruno();const p=(await one('select private.haiku_plan_total_financiero_v3($1,459000) p',[id(2)])).p;p.filas=p.filas.map(f=>({...f,base_nueva:29071}));const b=await snap();await q('savepoint imposible');await assert.rejects(q('select private.haiku_plan_aplicaciones_total_v3($1,$2)',[id(2),JSON.stringify(p)]),/imposible/);await q('rollback to imposible');assert.deepEqual(await snap(),b);});
await test('RUT alterado por efecto lateral revierte',async()=>{await bruno();await db.exec("create function documento_v3() returns trigger language plpgsql as $$begin update public.reservas set titular_numero_documento='123456789';return new;end;$$;create trigger documento after update on pago_aplicaciones for each row execute function documento_v3();");await fail([await item()],/datos ajenos/);});
if(v31){
 const servicio=(total,estado='pendiente')=>q('insert into servicios(id,reserva_id,total,estado_servicio) values($1,$2,$3,$4)',[id(900),id(2),total,estado]);
 const cargoServicio=(tipo='servicio',monto=1000)=>q("insert into cargos(id,reserva_id,servicio_id,tipo_cargo,monto,estado) values($1,$2,$3,$4,$5,'activo')",[id(901),id(2),id(900),tipo,monto]);
 for(const estado of ['pendiente','realizado'])await test('V3.1 servicio cero sin cargo '+estado+': Bruno exacto y servicio intacto',async()=>{
  await bruno();await servicio(0,estado);const b=await snap();await call([await item()]);const a=await snap();
  for(const t of ['pagos','servicios','reservas','huespedes','reserva_estadias'])assert.deepEqual(a[t],b[t]);
  assert.deepEqual(await fisico(),Array(3).fill({aplicado:153000,efectivo:153000}));
  assert.equal(a.cargos.filter(c=>c.reserva_id===id(2)).reduce((s,c)=>s+c.monto,0),546210);
  assert.equal(a.cargo_ajustes.reduce((s,c)=>s+c.monto,0),87210);
  assert.equal((await one('select sum(p.monto-(select coalesce(sum(monto_aplicado),0) from pago_aplicaciones where pago_id=p.id))::bigint saldo from pagos p where reserva_id=$1',[id(2)])).saldo,0);
 });
 await test('V3.1 servicio positivo con cargo bloquea',async()=>{await bruno();await servicio(1000);await cargoServicio();await fail([await item()],/Servicios/);});
 await test('V3.1 cargo servicio activo incluso cero bloquea',async()=>{await bruno();await servicio(0);await cargoServicio('servicio',0);await fail([await item()],/Servicios/);});
 await test('V3.1 aplicación a servicio bloquea',async()=>{await bruno();await servicio(0);await cargoServicio();await pago(503,2,1000,[[id(901),1000]]);await fail([await item()],/Servicios/);});
 await test('V3.1 aplicación a otro tipo bloquea',async()=>{await bruno();await q("insert into cargos(id,reserva_id,tipo_cargo,monto,estado) values($1,$2,'otro',1000,'activo')",[id(901),id(2)]);await pago(503,2,1000,[[id(901),1000]]);await fail([await item()],/Servicios/);});
 await test('V3.1 servicio positivo sin cargo bloquea',async()=>{await bruno();await servicio(1000,'realizado');await fail([await item()],/Servicios/);});
 await test('V3.1 importe desconocido bloquea',async()=>{await bruno();await servicio(null);await fail([await item()],/Servicios/);});
 await test('V3.1 servicio cero con cargo vinculado fuera de reserva bloquea',async()=>{await bruno();await servicio(0);await q("insert into cargos(id,reserva_id,servicio_id,tipo_cargo,monto,estado) values($1,$2,$3,'servicio',1000,'activo')",[id(901),id(1),id(900)]);await fail([await item()],/Servicios/);});
 await test('V3.1 impacto financiero aparecido durante escritura revierte lote',async()=>{await bruno();await servicio(0,'realizado');await db.exec("create function impacto_v31() returns trigger language plpgsql as $$begin update public.servicios set total=1000;return new;end;$$;create trigger impacto after update on pago_aplicaciones for each row execute function impacto_v31();");await fail([{reserva_id:id(1),total_actual:180000,total_objetivo:160000},await item()],/datos ajenos/);});
}
console.log('PASS FINANCIERO '+(v31?'V3.1':'V3')+': '+checks+' escenarios locales, cero escrituras remotas.');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});




