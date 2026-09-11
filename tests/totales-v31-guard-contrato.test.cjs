const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('V3.1 reemplaza exclusivamente el guard de servicios; resto del planner idéntico a V3',()=>{
 const anterior=fs.readFileSync('supabase/migrations/20260910233821_haiku_total_financiero_v3.sql','utf8');
 const nueva=fs.readFileSync('supabase/migrations/20260910235134_haiku_total_financiero_v31_guard_servicios.sql','utf8');
 const inicio='create or replace function private.haiku_plan_aplicaciones_total_v3(';
 const fin='revoke all on function private.haiku_plan_aplicaciones_total_v3(uuid,jsonb) from public,anon,authenticated;';
 const extraer=s=>s.slice(s.indexOf(inicio),s.indexOf(fin)+fin.length).replace(/\r/g,'');
 const esperado=extraer(anterior).replace('or exists(select 1 from public.servicios where reserva_id=p_id)',`or exists(
  select 1 from public.servicios s
  where s.reserva_id=p_id and (
   s.total is distinct from 0
   or exists(select 1 from public.cargos c where c.servicio_id=s.id)
  )
 )`);
 assert.equal(extraer(nueva),esperado);
 assert.equal((nueva.match(/create or replace function/g)||[]).length,3);
 const writer='create or replace function public.haiku_cambiar_totales_lote_v1(';
 assert.equal(nueva.slice(nueva.indexOf(writer)).replace(/\r/g,'').trim(),anterior.slice(anterior.indexOf(writer)).replace(/\r/g,'').trim().replaceAll('total1_financiero_v3','total1_financiero_v31'));
});
