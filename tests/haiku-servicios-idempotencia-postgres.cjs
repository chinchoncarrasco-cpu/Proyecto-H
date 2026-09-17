const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

(async()=>{
 const db=new PGlite();let checks=0;
 await db.exec(read('tests/fixtures/servicios-idempotencia-schema.sql'));

 const reservaA=id(1),estadiaA=id(2),reservaB=id(3),estadiaB=id(4),reservaC=id(5),estadiaC=id(6),usuario=id(90);
 await db.query('insert into reservas(id) values($1),($2),($3)',[reservaA,reservaB,reservaC]);
 await db.query("insert into reserva_estadias(id,reserva_id) values($1,$2),($3,$4),($5,$6)",[estadiaA,reservaA,estadiaB,reservaB,estadiaC,reservaC]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[usuario]);

 // Simula duplicados historicos anteriores a la migracion: la migracion no los limpia.
 const lateCat=(await db.query("select id from catalogo_servicios where codigo='lateCheckout'")).rows[0].id;
 const jacuzziCat=(await db.query("select id from catalogo_servicios where codigo='tinajaJacuzzi'")).rows[0].id;
 await db.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,precio_unitario_aplicado,total,tipo_cobro,estado_servicio,observaciones) values($1,$2,$3,$4,'2026-09-06','14:00','15:00',20000,20000,'normal','programado','HAIKU-LEGACY-ID:late-ambiguo'),($5,$2,$3,$4,'2026-09-05','14:00','15:00',20000,20000,'normal','programado',null)",[id(50),reservaB,estadiaB,lateCat,id(51)]);
 await db.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,precio_unitario_aplicado,total,tipo_cobro,estado_servicio,observaciones) values($1,$2,$3,$4,'2026-09-05','22:15','23:15',30000,30000,'normal','programado','HAIKU-LEGACY-ID:tinaja-ambigua'),($5,$2,$3,$4,'2026-09-05','22:15','23:15',30000,30000,'normal','programado',null)",[id(52),reservaC,estadiaC,jacuzziCat,id(53)]);

 await db.exec(read('supabase/migrations/20260916211226_haku_servicios_idempotencia_atomica.sql'));

 const call=async({reserva=reservaA,estadia=estadiaA,codigo='lateCheckout',fecha='2026-09-06',hora='14:00',precio=null,obs=null}={})=>{
  const q=await db.query(`select public.haiku_registrar_servicio(
   $1::uuid,$2::text,$3::date,$4::time,1::integer,1::smallint,'normal'::text,$5::bigint,null::text,$6::text,$7::uuid
  ) resultado`,[reserva,codigo,fecha,hora,precio,obs,estadia]);
  return q.rows[0].resultado;
 };
 const count=async(table,where='true',params=[])=>Number((await db.query(`select count(*) n from ${table} where ${where}`,params)).rows[0].n);

 const late1=await call();const late2=await call({fecha:'2026-09-05'});
 assert.equal(late1.reutilizado,false);assert.equal(late2.reutilizado,true);
 assert.equal(late1.servicio_id,late2.servicio_id);
 assert.equal(await count('servicios','reserva_id=$1',[reservaA]),1);
 assert.equal(await count('cargos','reserva_id=$1 and estado=\'activo\'',[reservaA]),1);checks++;

 await assert.rejects(()=>db.query(`insert into servicios(reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,precio_unitario_aplicado,total,tipo_cobro) values($1,$2,$3,'2026-09-07','14:00','15:00',20000,20000,'normal')`,[reservaA,estadiaA,lateCat]),/Late Check-out activo/i);checks++;

 await db.query("update servicios set estado_servicio='cancelado' where id=$1",[late1.servicio_id]);
 const lateNuevo=await call({fecha:'2026-09-07'});
 assert.equal(lateNuevo.reutilizado,false);
 assert.equal(await count('servicios',"reserva_id=$1 and estado_servicio not in ('cancelado','no_show')",[reservaA]),1);checks++;

 const tinaja1=await call({codigo:'tinajaJacuzzi',fecha:'2026-09-05',hora:'22:15',precio:30000,obs:'HAIKU-LEGACY-ID:alejandro-tinaja'});
 const tinaja2=await call({codigo:'tinajaJacuzzi',fecha:'2026-09-05',hora:'22:15',precio:30000,obs:'[HAKU-LIBRO-SERVICIO:alejandro-libro]'});
 assert.equal(tinaja2.servicio_id,tinaja1.servicio_id);assert.equal(tinaja2.reutilizado,true);checks++;

 await assert.rejects(()=>db.query(`insert into servicios(reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,precio_unitario_aplicado,total,tipo_cobro) values($1,$2,$3,'2026-09-05','22:15','23:15',30000,30000,'normal')`,[reservaA,estadiaA,jacuzziCat]),/misma identidad operativa/i);checks++;

 const otraHora=await call({codigo:'tinajaJacuzzi',fecha:'2026-09-05',hora:'20:15',precio:30000});
 const otraFecha=await call({codigo:'tinajaJacuzzi',fecha:'2026-09-06',hora:'22:15',precio:30000});
 assert.notEqual(otraHora.servicio_id,tinaja1.servicio_id);assert.notEqual(otraFecha.servicio_id,tinaja1.servicio_id);checks++;

 const masajeA=await call({codigo:'masaje',fecha:'2026-09-05',hora:'18:00',precio:45000});
 const masajeB=await call({codigo:'masaje',fecha:'2026-09-05',hora:'19:00',precio:45000});
 assert.notEqual(masajeA.servicio_id,masajeB.servicio_id);checks++;

 const cunaA=await call({codigo:'cuna',fecha:'2026-09-05',hora:null,precio:10000});
 const cunaB=await call({codigo:'cuna',fecha:'2026-09-05',hora:null,precio:10000});
 assert.notEqual(cunaA.servicio_id,cunaB.servicio_id);checks++;

 const cunaMarcadaA=await call({codigo:'cuna',fecha:'2026-09-06',hora:null,precio:10000,obs:'HAIKU-LEGACY-ID:cuna-estable'});
 const cunaMarcadaB=await call({codigo:'cuna',fecha:'2026-09-07',hora:null,precio:10000,obs:'HAIKU-LEGACY-ID:cuna-estable'});
 assert.equal(cunaMarcadaA.servicio_id,cunaMarcadaB.servicio_id);assert.equal(cunaMarcadaB.reutilizado,true);checks++;

 const lote=JSON.stringify([{item_id:'libro:cuna:1',reserva_id:reservaA,estadia_id:estadiaA,codigo_servicio:'cuna',fecha_servicio:'2026-09-08',cantidad:1,personas:1,tipo_cobro:'normal',precio_manual:10000}]);
 const importar=async()=>{
  const q=await db.query('select public.haiku_importar_servicios_libro_v1($1::uuid,$2::jsonb) resultado',[id(80),lote]);
  return q.rows[0].resultado;
 };
 const lote1=await importar(),lote2=await importar();
 assert.equal(lote1.servicios_creados,1);assert.equal(lote1.omitidos,0);
 assert.equal(lote2.servicios_creados,0);assert.equal(lote2.omitidos,1);
 assert.equal(lote1.resultados[0].servicio_id,lote2.resultados[0].servicio_id);checks++;

 await assert.rejects(()=>call({reserva:reservaB,estadia:estadiaB}),/multiples Late Check-out activos/i);checks++;
 await assert.rejects(()=>call({reserva:reservaB,estadia:estadiaB,obs:'HAIKU-LEGACY-ID:late-ambiguo'}),/multiples Late Check-out activos/i);checks++;
 assert.equal(await count('servicios','reserva_id=$1',[reservaB]),2);checks++;
 await assert.rejects(()=>call({reserva:reservaC,estadia:estadiaC,codigo:'tinajaJacuzzi',fecha:'2026-09-05',hora:'22:15',precio:30000,obs:'HAIKU-LEGACY-ID:tinaja-ambigua'}),/multiples servicios con la misma identidad operativa/i);checks++;
 assert.equal(await count('servicios','reserva_id=$1',[reservaC]),2);checks++;

 console.log(`PASS: ${checks} escenarios PostgreSQL efimero; servicios y cargos idempotentes, casos repetibles conservados.`);
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
