const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_SEMANTICA = S;
const Q = require('../js/haiku-libro-consultas-v1.js');
const tarifa = require('../js/haiku-fullday-tarifa-v1.js');

function leer(huespedes, tipo = 'FULLDAY') {
  return S.normalizarHoja({celdas: [
    {r:1,c:2,valor:'2 oct',fechaISO:'2026-10-02'},
    {r:1,c:6,valor:'3 oct',fechaISO:'2026-10-03'},
    {r:2,c:0,valor:'cabaña 1'},
    {r:2,c:2,valor:`Esperanza Aranda // ${tipo} // ${huespedes} // 02/10/26`},
    {r:24,c:2,valor:'Pagos de arriendos de hoy'}
  ],combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}}]}, 'Oct26').reservas[0];
}
const cliente = {auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})}, from() {
  const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range:async()=>({data:[]})};
  return b;
}};
async function plan(r) {
  const comp = await Q.compararSistema([r],cliente,{desde:'2026-10-02',hasta:'2026-10-03'});
  return Q.crearPlanIncorporacion([r],comp);
}

for (const [adl,ninos,total] of [[2,0,120000],[3,0,180000],[4,0,240000],[2,1,120000],[3,2,180000],[1,0,null],[1,2,null],[null,0,null]]) {
  test(`Libro FULLDAY ${adl ?? '?'} ADL + ${ninos} niños => ${total ?? 'revisión'}`, async () => {
    const r=leer(`${adl === null ? 'ADL por confirmar' : `${adl} ADL`} + ${ninos} niños`);
    assert.equal(r.tipo_estadia,'full_day');
    assert.equal(r.adultos,adl);
    assert.equal(r.ninos,ninos);
    const p=await plan(r), item=p.items.find(x=>x.categoria==='nuevas' || x.categoria==='pendientes');
    assert.ok(item);
    if(adl===null) {
      assert.equal(item.seleccionado,false);
      assert.match(item.motivos.join(' '),/ADL|adultos/);
      assert.deepEqual(Q.serializarIncorporacion(p),[]);
      return;
    }
    assert.equal(item.payload.estadias[0].datos.adultos,adl);
    assert.equal(item.payload.estadias[0].datos.ninos,ninos);
    assert.equal(item.payload.estadias[0].tarifas?.['2026-10-02'] ?? null,total);
    assert.equal(item.seleccionado,total!==null);
    if(total!==null) {
      assert.deepEqual(item.motivos,[]);
      const payload=Q.serializarIncorporacion(p);
      assert.equal(payload[0].tipo,'reserva_nueva');
      assert.equal(payload[0].estadias[0].tarifas['2026-10-02'],total);
    } else {
      assert.match(item.motivos.join(' '),/ADL|adultos/);
      assert.deepEqual(Q.serializarIncorporacion(p),[]);
    }
  });
}
test('ADL ambiguos, decimales, negativos y solo total de huéspedes no generan tarifa', async () => {
  for(const texto of ['2 ADL + 3 ADL','2.5 ADL','-2 ADL','3 huéspedes','2 PAX']) {
    const r=leer(texto), p=await plan(r), item=p.items.find(x=>x.categoria==='nuevas' || x.categoria==='pendientes');
    assert.equal(item.seleccionado,false,texto);
    assert.deepEqual(Q.serializarIncorporacion(p),[],texto);
  }
  for(const adultos of [undefined,null,'2',true,1,2.5,Infinity,32768]) assert.equal(tarifa.resolverLibro({adultos}).tarifa,null);
});
test('alojamiento conserva payload sin tarifa Full Day; regla de otras rutas intacta', async () => {
  const r=leer('1 ADL + 2 niños','1 noche'), p=await plan(r), item=p.items.find(x=>x.categoria==='nuevas');
  assert.equal(r.tipo_estadia,'alojamiento');
  assert.equal(item.seleccionado,true);
  assert.equal(item.payload.estadias[0].tarifas,undefined);
  assert.equal(item.payload.estadias[0].noches,1);
  assert.equal(tarifa.resolver({adultos:1,ninos:0}).tarifa,120000);
  assert.equal(tarifa.resolver({adultos:2,ninos:1}).bloqueada,true);
});
