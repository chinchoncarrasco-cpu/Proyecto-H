const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
test('diagnóstico local conserva exactamente writer e invariante, sólo agrega DETAIL',()=>{
 const original=read('supabase/migrations/20260910210508_haiku_total_writer_atomico_v1.sql');
 const inicio='create or replace function public.haiku_cambiar_totales_lote_v1';
 const writer=original.slice(original.indexOf(inicio),original.indexOf('revoke all on function public.haiku_cambiar_totales_lote_v1')).trim();
 const local=read('supabase/preparadas/haiku_total_diagnostico_invariantes.sql');
 const detalle=" using detail=jsonb_build_object('invariantes',private.haiku_total_diff_paths(antes->rid::text,private.haiku_total_snapshot(rid)))::text";
 assert.ok(local.includes(detalle));assert.equal(local.slice(local.indexOf(inicio)).replace(detalle,'').trim(),writer);
});
