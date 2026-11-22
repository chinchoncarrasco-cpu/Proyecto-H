const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const guest = n => 'a1000000-0000-4000-8000-00000000000' + n;
const stay = n => 'a4000000-0000-4000-8000-00000000000' + n;
const actor = n => 'a0000000-0000-4000-8000-00000000000' + n;

test('directorio por estadía, asociaciones, filtros y permisos', async () => {
  const db = new PGlite();
  try {
    for (const file of [
      'tests/fixtures/huespedes-schema.sql',
      'supabase/migrations/20261120205010_haku_huespedes_v1_1.sql',
      'supabase/migrations/20261121003000_haku_huespedes_directorio_foto.sql',
      'supabase/migrations/20261122014301_huespedes_directorio_estadias.sql',
    ]) await db.exec(read(file));
    await db.exec(read('tests/huespedes-v1-postgres.test.sql').split('set local role authenticated;')[0] + 'commit;');
    await db.exec(read('tests/fixtures/huespedes-directorio.sql'));
    await db.exec('set role authenticated');
    const login = id => db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor(id)]);
    const directory = async (state='todos', query=null, type=null, origin=null, offset=0) =>
      (await db.query('select public.haiku_huesped_directorio_estadias_v1($1,$2,$3,$4,null,$5) as data',
        [state,query,type,origin,offset])).rows[0].data;
    await login(1);
    const all = await directory();
    assert.deepEqual(all.filas.map(row => row.estado), [
      'hospedados', 'hospedados', 'por_ingresar', 'por_ingresar', 'por_ingresar', 'historial',
    ]);
    assert.deepEqual(all.filas.map(row => row.estadia_id), [stay(1), stay(6), stay(3), stay(2), stay(4), stay(5)]);
    assert.deepEqual(all.grupos.hospedados,{titulares:2,estadias:2});
    assert.deepEqual(all.grupos.historial,{titulares:1,estadias:1});
    assert.equal(all.titulares,3);
    assert.equal(all.filas.filter(row=>row.id===guest(1)).length,3);
    assert.equal(all.filas.some(row=>row.id===guest(4)),false);
    assert.equal(all.filas[0].acompanantes[0].id,guest(2));
    assert.equal(all.filas[0].por_asignar,true,'el cupo sin cabaña queda disponible en la ficha de reserva');
    assert.equal(all.filas.find(row=>row.estadia_id===stay(2)).acompanantes.length,0,'el vínculo explícito prevalece');
    assert.equal(all.filas.find(row=>row.estadia_id===stay(5)).acompanantes[0].id,guest(4));
    assert.equal(all.filas.find(row=>row.estadia_id===stay(6)).acompanantes[0].rol,'borrador');
    assert.equal(all.filas[0].documento,'••••78-5');
    assert.equal('numero_documento' in all.filas[0],false);
    assert.equal('numero_documento' in all.filas[0].acompanantes[0],false);
    assert.equal(all.puede_editar,true);
    const search = await directory('hospedados','XY789');
    assert.deepEqual(search.filas.map(row=>row.estadia_id),[stay(1)]);
    assert.equal(search.filas[0].abrir_acompanantes,true);
    const historical = await directory('historial', 'Ciro', 'Loft');
    assert.deepEqual(historical.filas.map(row=>row.estadia_id),[stay(5)]);
    assert.equal(historical.filas[0].abrir_acompanantes,true);
    assert.deepEqual((await directory('hospedados',null,null,'Uruguay')).filas.map(row=>row.estadia_id),[stay(1)]);
    assert.ok((await directory('pendientes')).filas.some(row=>row.estadia_id===stay(6)));
    assert.deepEqual((await directory('todos',null,null,null,4)).filas.map(row=>row.estadia_id),[stay(4),stay(5)]);
    const legacy = (await db.query("select public.haiku_huesped_directorio_v1('todos','XY790') data")).rows[0].data;
    assert.equal(legacy.filas[0].id,guest(3),'el buscador de vinculación admite perfiles sin estadía');
    await login(2);
    assert.equal((await directory()).puede_editar,false);
    await login(3);
    await assert.rejects(directory(), /No tienes permiso/);
  } finally {
    await db.close();
  }
});
