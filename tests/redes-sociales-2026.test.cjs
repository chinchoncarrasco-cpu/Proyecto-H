const test=require('node:test');
const assert=require('node:assert/strict');
const plan=require('../data/haiku-redes-2027.json');
const C=require('../js/haiku-redes-core-v1');
test('rutina continua desde el 4 de noviembre, sin huecos ni tareas retroactivas',()=>{
 for(let d=new Date('2026-11-04T12:00:00Z');d<=new Date('2026-12-31T12:00:00Z');d.setUTCDate(d.getUTCDate()+1)){
  const iso=d.toISOString().slice(0,10),ps=plan.posts.filter(p=>p.date===iso),dow=d.getUTCDay();
  assert.equal(ps.filter(p=>p.story_kind==='diaria').length,1,iso+' historia diaria');
  assert.equal(ps.filter(p=>p.content_type!=='historia').length,[2,5].includes(dow)?1:0,iso+' publicación permanente');
  const commercial=ps.filter(p=>['comercial','refuerzo'].includes(p.story_kind));
  assert.equal(commercial.length,[4,6].includes(dow)?1:0,iso+' apoyo comercial');
  assert.ok(commercial.every(p=>p.conditional&&p.condition&&p.target_start&&p.campaign_id));
 }
 assert.equal(plan.posts.filter(p=>p.date<'2026-11-04').length,0);
 assert.equal(new Set(plan.posts.map(p=>p.id)).size,plan.posts.length);
});
test('totales mensuales y Reels respetan el ciclo de cuatro semanas hasta enero',()=>{
 for(const [month,total,daily,permanent,commercial] of [['2026-11',42,27,7,8],['2026-12',49,31,9,9]]){
  const ps=plan.posts.filter(p=>p.date.startsWith(month));
  assert.equal(ps.length,total);assert.equal(ps.filter(p=>p.story_kind==='diaria').length,daily);
  assert.equal(ps.filter(p=>p.content_type!=='historia').length,permanent);
  assert.equal(ps.filter(p=>['comercial','refuerzo'].includes(p.story_kind)).length,commercial);
 }
 const reels=plan.posts.filter(p=>p.content_type==='reel'&&p.date<'2027-01-09').map(p=>p.date);
 assert.deepEqual(reels,['2026-11-13','2026-11-27','2026-12-11','2026-12-25','2027-01-08']);
 for(const d of ['2026-11-06','2026-11-10','2026-11-27','2026-12-01','2026-12-18','2026-12-22','2026-12-25','2026-12-29'])assert.equal(plan.posts.filter(p=>p.id==='rs-'+d).length,1);
});
test('campañas enlazan tareas existentes y se ven durante su preparación en 2026',()=>{
 for(const c of plan.campaigns){for(const s of c.stage_dates||[])assert.ok(plan.posts.some(p=>p.id===s.post_id&&p.date===s.date),'etapa '+s.post_id);}
 for(const id of ['ano-nuevo-2027','verano-2027','navidad-2026','diciembre-2026'])assert.equal(C.campaignInYear(plan.campaigns.find(c=>c.id===id),'2026'),true,id);
 assert.equal(C.campaignInYear(plan.campaigns.find(c=>c.id==='semana-santa'),'2026'),false);
 assert.match(C.monthContext(plan,'2026-12').sell,/2027/);assert.doesNotMatch(C.monthContext(plan,'2026-12').sell,/2028/);
 assert.match(C.monthContext(plan,'2027-12').sell,/2028/);
});
test('material semanal se prepara antes y las capturas diarias siguen siendo del día',()=>{
 const prep=plan.preparation_tasks.filter(p=>p.id.startsWith('preparar-semana-2026-'));
 assert.equal(prep.length,9);
 assert.ok(prep.every(p=>/fotografían en su fecha/.test(p.detail)));
 const story=plan.posts.find(p=>p.id==='historia-dia-2026-12-25');
 assert.throws(()=>C.validateFile({name:'x.jpg',type:'image/jpeg',size:100},story,'media',true,'2026-12-24'),/historias/);
 const navidad=plan.campaigns.find(c=>c.id==='navidad-2026');
 assert.equal((new Date(navidad.target_start)-new Date(navidad.launch_post_date))/86400000,38);
 const feria=plan.events.find(e=>e.id==='cl-2026-12-08');assert.match(feria.detail,/lunes 7 no es feriado/);
 assert.ok(plan.events.find(e=>e.id==='cl-2026-12-25').categories.includes('irrenunciables'));
});
