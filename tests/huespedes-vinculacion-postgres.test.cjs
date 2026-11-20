const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = require('pg');

const config = new URL(process.env.HAKU_GUEST_TEST_DATABASE ?? '');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(config.hostname),
  'Usa una base PostgreSQL local y exclusiva para pruebas, con esquema y migración cargados.');

const editor = 'a0000000-0000-4000-8000-000000000001';
const titular = 'a1000000-0000-4000-8000-000000000001';
const integrante = 'a1000000-0000-4000-8000-000000000002';
const destino = 'a1000000-0000-4000-8000-000000000003';
const reserva = 'a2000000-0000-4000-8000-000000000001';
const reservaConcurrente = 'a2000000-0000-4000-8000-000000000002';
const reservaProvisional = 'a2000000-0000-4000-8000-000000000003';
const memberError = {code:'23514',message:'El huésped ya participa en esta reserva.'};

async function drafts(client, reservation) {
  return (await client.query(
    'select id,plaza from public.haiku_huesped_integrantes_v1 where reserva_id=$1 and plaza is not null order by plaza',
    [reservation],
  )).rows;
}
async function save(client,id,reservation,action,payload) {
  return (await client.query('select public.haiku_huesped_guardar_v1($1,$2,$3,$4) as result',
    [id,reservation,action,payload])).rows[0].result;
}
const link = (client,id,reservation,guest) => save(client,id,reservation,'vincular',{huesped_id:guest});
async function guestData(client,id,reservation) {
  const {persona,registros,etiquetas,mascotas}= (await client.query(
    'select public.haiku_huesped_perfil_v1($1,$2) as profile',[id,reservation],
  )).rows[0].profile;
  return {persona,registros,etiquetas,mascotas};
}

(async()=>{
  const [setup,first,second]=Array.from({length:3},()=>new Client({connectionString:config.href}));
  try {
    await Promise.all([setup.connect(),first.connect(),second.connect()]);
    const seed=fs.readFileSync(path.join(__dirname,'huespedes-v1-postgres.test.sql'),'utf8')
      .split('set local role authenticated;')[0];
    await setup.query(seed+'commit;');
    await setup.query('insert into private.permisos values ($1,$2)',[editor,'reservas.editar']);
    await setup.query("insert into public.reservas(id,titular_nombre) values ($1,'Titular provisional')",[reservaProvisional]);
    await setup.query('insert into public.reserva_huespedes values ($1,$2)',[reservaProvisional,integrante]);
    for(const client of [first,second]){
      await client.query('set role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,false)",[editor]);
      await client.query("set statement_timeout='10s'");
    }

    const initialDrafts=await drafts(first,reserva);
    assert.equal(initialDrafts.length,1);
    const [{id:draft}]=initialDrafts;
    await save(first,draft,reserva,'ficha',{descripcion:'Borrador con descripción'});
    await save(first,draft,reserva,'registro',{categoria:'preferencia',texto:'Nota del borrador',fuente:'Observación'});
    const original=await guestData(first,draft,reserva);
    const originalMembers=await Promise.all([titular,integrante].map(id=>guestData(first,id,reserva)));
    for(const id of [titular,integrante]) await assert.rejects(link(first,draft,reserva,id),memberError);
    assert.deepEqual(await drafts(first,reserva),initialDrafts);
    assert.deepEqual(await guestData(first,draft,reserva),original);
    assert.deepEqual(await Promise.all([titular,integrante].map(id=>guestData(first,id,reserva))),originalMembers);

    const pair=await drafts(first,reservaConcurrente);
    assert.equal(pair.length,2);
    const [winner,loser]=pair;
    const winnerNote='Preferencia del primer borrador';
    await save(first,winner.id,reservaConcurrente,'registro',{categoria:'preferencia',texto:winnerNote,fuente:'Observación'});
    await save(second,loser.id,reservaConcurrente,'registro',{categoria:'preferencia',texto:'Preferencia que debe quedarse',fuente:'Observación'});
    const originalLoser=await guestData(second,loser.id,reservaConcurrente);
    await first.query('begin isolation level read committed');
    assert.deepEqual(await link(first,winner.id,reservaConcurrente,destino),{id:destino});
    const rejected=assert.rejects(link(second,loser.id,reservaConcurrente,destino),memberError).then(
      ()=>null,error=>error,
    );
    const winnerPid=(await first.query('select pg_backend_pid() as pid')).rows[0].pid;
    const timeout=Date.now()+5000;
    let blocking;
    do {
      blocking=(await setup.query('select pg_blocking_pids($1) as pids',[second.processID])).rows[0].pids;
      if(!blocking.includes(winnerPid)) await delay(25);
    } while(!blocking.includes(winnerPid)&&Date.now()<timeout);
    await first.query('commit');
    assert.ok(blocking.includes(winnerPid),'El segundo RPC quedó esperando el bloqueo de la misma reserva.');
    const rejectionFailure=await rejected;
    if(rejectionFailure) throw rejectionFailure;
    assert.deepEqual(await drafts(first,reservaConcurrente),[loser]);
    assert.deepEqual(await guestData(first,loser.id,reservaConcurrente),originalLoser);
    assert.deepEqual((await guestData(first,destino,reservaConcurrente)).registros.map(row=>row.texto),[winnerNote]);

    const [{id:provisional,plaza}]=await drafts(first,reservaProvisional);
    assert.equal(plaza,0);
    await save(first,provisional,reservaProvisional,'registro',{categoria:'preferencia',texto:'Nota del titular provisional',fuente:'Observación'});
    assert.deepEqual(await link(first,provisional,reservaProvisional,integrante),{id:integrante});
    assert.equal((await setup.query('select titular_huesped_id from public.reservas where id=$1',[reservaProvisional]))
      .rows[0].titular_huesped_id,integrante);
    assert.deepEqual(await drafts(first,reservaProvisional),[]);
    assert.deepEqual((await guestData(first,integrante,reservaProvisional)).registros.map(row=>row.texto),['Nota del titular provisional']);

    console.log('Vinculación PostgreSQL: integrantes rechazados, borrador conservado bajo concurrencia real y titular provisional resuelto.');
  } finally {
    await Promise.allSettled([setup.end(),first.end(),second.end()]);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
