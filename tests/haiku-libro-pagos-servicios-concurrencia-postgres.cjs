// Prueba manual sobre PostgreSQL local desechable con DOS conexiones reales.
// No se ejecuta en la suite JS. Requiere explícitamente:
//   HAKU_4C_TEST_DATABASE_URL=postgres://... (base local vacía y desechable)
//   HAKU_4C_ALLOW_DISPOSABLE_DB=YES
//   node tests/haiku-libro-pagos-servicios-concurrencia-postgres.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

if(process.env.HAKU_4C_ALLOW_DISPOSABLE_DB!=='YES'||!process.env.HAKU_4C_TEST_DATABASE_URL){
 throw new Error('Esta prueba sólo acepta una base PostgreSQL local desechable autorizada con HAKU_4C_ALLOW_DISPOSABLE_DB=YES.');
}
let Client;
try{({Client}=require('pg'));}
catch{throw new Error('Falta el paquete pg. No instalarlo automáticamente; deja pendiente esta prueba concurrente.');}

const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const url=process.env.HAKU_4C_TEST_DATABASE_URL;
const setup=new Client({connectionString:url});
const a=new Client({connectionString:url});
const b=new Client({connectionString:url});

(async()=>{
 await setup.connect();await a.connect();await b.connect();
 await setup.query(read('tests/fixtures/libro-distribucion-schema.sql'));
 await setup.query(`
  alter table public.catalogo_servicios add column nombre text, add column categoria text;
  alter table public.servicios add column total bigint default 0, add column tipo_cobro text default 'normal';
  alter table public.pago_aplicaciones add column id uuid default gen_random_uuid(), add primary key(pago_id,cargo_id);
  drop view public.vista_estado_cargos;
  create view public.vista_estado_cargos as
   select c.id cargo_id,c.reserva_id,c.tipo_cargo,c.estado,
    coalesce(cs.nombre,cs.codigo,c.tipo_cargo) concepto,
    coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) aplicado_neto,
    c.monto-coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) saldo_cargo
   from cargos c left join servicios s on s.id=c.servicio_id left join catalogo_servicios cs on cs.id=s.catalogo_servicio_id;
 `);
 await setup.query(read('tests/fixtures/registrar-pago-supabase.sql'));
 await setup.query(read('supabase/migrations/20260908164059_haku_libro_estado_confirmado.sql'));
 await setup.query(read('supabase/migrations/20260915233506_haku_libro_aplicaciones_servicio_seguras.sql'));

 const reservaA=randomUUID(),reservaB=randomUUID(),estadiaA=randomUUID(),cabana=randomUUID(),catalogo=randomUUID();
 const servicioA=randomUUID(),cargoA=randomUUID();
 await setup.query("insert into reservas values($1,'Reserva A','confirmada'),($2,'Reserva B','confirmada')",[reservaA,reservaB]);
 await setup.query('insert into cabanas values($1,1)',[cabana]);
 await setup.query("insert into reserva_estadias values($1,$2,$3,'2026-09-01','2026-09-02','confirmada')",[estadiaA,reservaA,cabana]);
 await setup.query("insert into catalogo_servicios(id,codigo,nombre) values($1,'jacuzzi','Jacuzzi')",[catalogo]);
 await setup.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,estado_servicio,total,tipo_cobro) values($1,$2,$3,$4,'2026-09-01','pendiente',30000,'normal')",[servicioA,reservaA,estadiaA,catalogo]);
 await setup.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto) values($1,$2,$3,$4,'servicio','activo',30000)",[cargoA,reservaA,estadiaA,servicioA]);

 // Reservas distintas: ambas llaves se pueden poseer a la vez.
 await a.query('begin');await b.query('begin');
 await a.query("select pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',$1))",[reservaA]);
 const otra=(await b.query("select pg_try_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',$1)) ok",[reservaB])).rows[0].ok;
 assert.equal(otra,true);
 await b.query('rollback');

 // Misma reserva: el helper de la segunda conexión espera hasta que termina la primera.
 await b.query('begin');let termino=false;
 const segunda=b.query("select pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',$1))",[reservaA]).then(()=>{termino=true;});
 await wait(150);assert.equal(termino,false,'la segunda operación no debe atravesar el lock de la misma reserva');
 await a.query('rollback');await segunda;assert.equal(termino,true);await b.query('rollback');

 // Writer iniciado mientras el helper posee la reserva: falla cerrado, sin esperar/deadlock.
 await a.query('begin');
 await a.query("select pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',$1))",[reservaA]);
 await b.query('begin');const inicio=Date.now();
 await assert.rejects(()=>b.query('update servicios set total=31000 where id=$1',[servicioA]),/otra operación financiera en curso/i);
 assert.ok(Date.now()-inicio<2000,'el trigger debe abortar sin quedar esperando un advisory lock');
 await b.query('rollback');

 // Un candidato compatible tampoco puede aparecer durante la ventana protegida.
 const servicioFantasma=randomUUID();
 await b.query('begin');
 await assert.rejects(()=>b.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,estado_servicio,total,tipo_cobro) values($1,$2,$3,$4,'2026-09-01','pendiente',30000,'normal')",[servicioFantasma,reservaA,estadiaA,catalogo]),/otra operación financiera en curso/i);
 await b.query('rollback');await a.query('rollback');

 // Terminada la primera operación, el candidato sí puede entrar; una preview nueva debe verlo.
 await b.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,estado_servicio,total,tipo_cobro) values($1,$2,$3,$4,'2026-09-01','pendiente',30000,'normal')",[servicioFantasma,reservaA,estadiaA,catalogo]);
 assert.equal(Number((await b.query('select count(*) n from servicios where reserva_id=$1',[reservaA])).rows[0].n),2);

 console.log('PASS concurrencia PostgreSQL: reservas distintas, serialización por reserva, sin espera fila/advisory y phantom bloqueado.');
})().finally(async()=>{await Promise.allSettled([a.end(),b.end(),setup.end()]);}).catch(e=>{console.error(e);process.exitCode=1;});
