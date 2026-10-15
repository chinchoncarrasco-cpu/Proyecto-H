// Biblioteca administrativa, sin CLI, credenciales ni conexión automática.
// Los manifiestos contienen respaldo privado: nunca imprimirlos ni versionarlos.
'use strict';
const {createHash}=require('node:crypto');
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(canon(x))).digest('hex');
const quote=s=>'"'+s.replace(/"/g,'""')+'"';
const table=t=>t.split('.').map(quote).join('.');
function requireThat(ok){if(!ok)throw Object.assign(new Error('Precondición o preservación no satisfecha; requiere revisión manual'),{code:'HLR01'});}
const refs={'public.reservas':'titular_huesped_id','public.reserva_huespedes':'huesped_id',
  'public.estadia_huespedes':'huesped_id','public.notas':'huesped_id','public.solicitudes':'huesped_id'};
const metadata=['private.haiku_rut_registro_v1','private.haiku_huesped_alias_v1'];
const audit=t=>['public.eventos_auditoria','public.auditoria_identidad_fixture'].includes(t);
const sorted=rows=>rows.map(canon).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
async function catalog(db){
  // Cierre de dependencias real, no una lista supuesta de tablas financieras.
  const tables=(await db.query(`with recursive dep(oid) as (
    select unnest(array['public.huespedes'::regclass,'public.reservas'::regclass,'public.reserva_estadias'::regclass])::oid
    union select c.conrelid from pg_constraint c join dep d on d.oid=c.confrelid where c.contype='f'
  ) select n.nspname||'.'||c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname in ('public','private')
    and (c.oid in(select oid from dep) or c.relname in ('eventos_auditoria','auditoria_identidad_fixture','cabanas')) order by 1`)).rows.map(r=>r.t);
  const fk=(await db.query(`select c.conrelid::regclass::text t,a.attname col from pg_constraint c
    cross join lateral unnest(c.conkey) k join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k
    where c.contype='f' and c.confrelid='public.huespedes'::regclass order by 1,2`)).rows;
  for(const r of fk){const t=r.t.includes('.')?r.t:'public.'+r.t;
    requireThat(refs[t]===r.col || metadata.includes(t));}
  const schema=(await db.query(`select jsonb_build_object(
    'constraints',(select jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid)) order by conrelid::regclass::text,conname) from pg_constraint where connamespace in ('public'::regnamespace,'private'::regnamespace)),
    'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgrelid::regclass::text,tgname) from pg_trigger where not tgisinternal),
    'functions',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
    'rls',(select jsonb_agg(jsonb_build_array(c.oid::regclass::text,c.relrowsecurity,c.relforcerowsecurity,c.relowner,c.relacl::text) order by c.oid::regclass::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p')),
    'policies',(select jsonb_agg(to_jsonb(x) order by schemaname,tablename,policyname) from pg_policies x where schemaname in ('public','private')),
    'indexes',(select jsonb_agg(to_jsonb(x) order by schemaname,tablename,indexname) from pg_indexes x where schemaname in ('public','private'))
  ) s`)).rows[0].s;
  return {tables,schema};
}
async function snapshot(db,c){const rows={};for(const t of c.tables)
  rows[t]=(await db.query(`select coalesce(jsonb_agg(x order by x::text),'[]') r from (select to_jsonb(t) x from ${table(t)} t) s`)).rows[0].r;
  return {catalog:c,rows};
}
async function manifest(db,selection){
  await db.query('begin isolation level repeatable read read only');
  try{const s=await snapshot(db,await catalog(db));await db.query('commit');
    const m={selection,snapshot:s};return {...m,sha256:hash(m)};
  }catch(e){await db.query('rollback');throw Object.assign(new Error('Preflight incompleto; requiere revisión manual'),{code:'HLR01'});}
}
function validateManifest(m,approval,action){
  requireThat(m.sha256===hash({selection:m.selection,snapshot:m.snapshot}));
  requireThat(approval?.samePerson===true && approval?.authorized===true && approval.action===action && approval.manifestHash===m.sha256
    && /^[0-9a-f]{64}$/.test(approval.evidenceHash||'') && /^[0-9a-f-]{36}$/.test(approval.operationId||''));
  const p=m.selection;
  requireThat(p.canonicalId!==p.redundantId && p.original.id!==p.subsequent.id);
}
function validateSelection(s,p){
  const guests=s.rows['public.huespedes'].filter(h=>[p.canonicalId,p.redundantId].includes(h.id));
  requireThat(guests.length===2 && guests.every(h=>h.tipo_documento==='rut'));
  for(const [which,gid] of [[p.original,p.canonicalId],[p.subsequent,p.redundantId]]){
    const r=s.rows['public.reservas'].find(r=>r.id===which.id);
    requireThat(r && r.codigo_haiku===which.code && r.estado_reserva===which.status && r.titular_huesped_id===gid);
    const stays=s.rows['public.reserva_estadias'].filter(e=>e.reserva_id===r.id);
    requireThat(stays.length===1 && stays[0].fecha_ingreso===which.arrival && stays[0].fecha_salida===which.departure
      && stays[0].estado_estadia===which.status && s.rows['public.cabanas'].some(c=>c.id===stays[0].cabana_id && c.numero===which.cabin));
    requireThat(s.rows['public.pagos'].filter(x=>x.reserva_id===r.id).length===which.payments);
    requireThat(s.rows['public.reserva_huespedes'].filter(x=>x.reserva_id===r.id&&x.huesped_id===gid).length===1);
    requireThat(s.rows['public.estadia_huespedes'].filter(x=>x.estadia_id===stays[0].id&&x.huesped_id===gid).length===1);
  }
  requireThat(p.original.status==='cancelada'&&p.subsequent.status==='confirmada'&&p.original.payments===1&&p.subsequent.payments===0);
  // Cualquier referencia adicional cambia el alcance aprobado: abortar.
  for(const [t,col] of Object.entries(refs))for(const r of s.rows[t]||[]){
    if(![p.canonicalId,p.redundantId].includes(r[col]))continue;
    if(t==='public.reservas') requireThat([p.original.id,p.subsequent.id].includes(r.id));
    else if(t==='public.estadia_huespedes')requireThat(s.rows['public.reserva_estadias'].some(e=>e.id===r.estadia_id&&[p.original.id,p.subsequent.id].includes(e.reserva_id)));
    else if(r.reserva_id)requireThat([p.original.id,p.subsequent.id].includes(r.reserva_id));
    if(r.estadia_id)requireThat(s.rows['public.reserva_estadias'].some(e=>e.id===r.estadia_id&&[p.original.id,p.subsequent.id].includes(e.reserva_id)));
  }
}
function preserve(before,after,p,restoreFrom){
  requireThat(hash(before.catalog)===hash(after.catalog));
  for(const t of before.catalog.tables){
    if(metadata.includes(t))continue;
    const expected=structuredClone(before.rows[t]);
    if(audit(t)){
      const counts=new Map();for(const r of after.rows[t])counts.set(hash(r),(counts.get(hash(r))||0)+1);
      for(const r of expected){requireThat((counts.get(hash(r))||0)>0);counts.set(hash(r),counts.get(hash(r))-1);}continue;
    }
    const col=refs[t];
    if(col)for(const r of expected){
      if(restoreFrom){
        const original=restoreFrom.rows[t].find(x=>r.id?x.id===r.id:
          x.reserva_id===r.reserva_id&&x.estadia_id===r.estadia_id);
        requireThat(original);r[col]=original[col];
      }else if(r[col]===p.redundantId)r[col]=p.canonicalId;
    }
    const actual=structuredClone(after.rows[t]);
    // Sólo las filas cuyo FK cambió pueden recibir el timestamp del trigger existente.
    if(col)for(let i=0;i<expected.length;i++){
      const original=before.rows[t][i];if(original[col]===expected[i][col])continue;
      const row=actual.find(r=>original.id?r.id===original.id:
        (r.reserva_id===original.reserva_id&&r.estadia_id===original.estadia_id&&r[col]===expected[i][col]));
      if(row){delete row.actualizado_en;delete expected[i].actualizado_en;}
    }
    requireThat(hash(sorted(expected))===hash(sorted(actual)));
  }
}
async function locked(db,m){
  await db.query('begin');await db.query("set local lock_timeout='5s'");
  const c=await catalog(db);
  requireThat(hash(c)===hash(m.snapshot.catalog));
  await db.query(`lock table ${c.tables.map(table).join(',')} in share row exclusive mode`);
  requireThat(hash(await catalog(db))===hash(c));
  return snapshot(db,c);
}
async function apply(db,m,approval,receipt){
  validateManifest(m,approval,'apply');
  let committing=false,candidateReceipt;
  try{
    const before=await locked(db,m),p=m.selection;
    const alias=before.rows[metadata[1]].find(x=>x.redundante_id===p.redundantId);
    if(alias){requireThat(!alias.revertido_en&&alias.operacion_id===approval.operationId&&alias.evidencia_sha256===approval.evidenceHash
      && receipt?.afterHash===hash(before)&&receipt?.manifestHash===m.sha256);
      await db.query('rollback');return {...receipt,retry:true};}
    requireThat(hash(before)===hash(m.snapshot));validateSelection(before,p);
    const keys=(await db.query('select id,private.haiku_rut_clave_v1(numero_documento) k from public.huespedes where id=any($1::uuid[])',[[p.canonicalId,p.redundantId]])).rows;
    requireThat(keys.length===2&&keys[0].k&&keys[0].k===keys[1].k);
    const key=keys[0].k;
    requireThat(before.rows[metadata[0]].some(r=>r.clave===key&&r.bloqueado&&r.huesped_id===null));
    requireThat(before.rows['public.huespedes'].filter(h=>h.tipo_documento==='rut').length>=2);
    const active=(await db.query(`select count(*)::int n from public.huespedes h where tipo_documento='rut'
      and private.haiku_rut_clave_v1(numero_documento)=$1`,[key])).rows[0].n;requireThat(active===2);
    await db.query("select set_config('app.haiku_operacion_id',$1,true)",[approval.operationId]);
    for(const [t,col] of Object.entries(refs))await db.query(`update ${table(t)} set ${quote(col)}=$1 where ${quote(col)}=$2`,[p.canonicalId,p.redundantId]);
    await db.query(`insert into private.haiku_huesped_alias_v1(redundante_id,canonico_id,operacion_id,evidencia_sha256) values($1,$2,$3,$4)`,
      [p.redundantId,p.canonicalId,approval.operationId,approval.evidenceHash]);
    await db.query(`update private.haiku_rut_registro_v1 set huesped_id=$1,bloqueado=false where clave=$2`,[p.canonicalId,key]);
    await db.query('set constraints all immediate');
    const after=await snapshot(db,before.catalog);preserve(before,after,p);
    for(const [t,col] of Object.entries(refs))requireThat(!after.rows[t].some(x=>x[col]===p.redundantId));
    const untouchedRegistry=rows=>rows.filter(x=>x.clave!==key);
    requireThat(hash(untouchedRegistry(before.rows[metadata[0]]))===hash(untouchedRegistry(after.rows[metadata[0]])));
    candidateReceipt={manifestHash:m.sha256,afterHash:hash(after),operationId:approval.operationId};
    committing=true;await db.query('commit');return candidateReceipt;
  }catch(e){try{await db.query('rollback')}catch(_){}
    throw Object.assign(new Error(committing?'Resultado de COMMIT no confirmado; consultar operación antes de reintentar':
      'Reparación abortada íntegramente; requiere revisión manual'),{code:committing?'HLR03':'HLR01',...(committing?{receipt:candidateReceipt}:{})});}
}
async function revert(db,m,approval,receipt){
  validateManifest(m,approval,'revert');
  let committing=false;
  try{
    const current=await locked(db,m),p=m.selection;
    requireThat(receipt?.manifestHash===m.sha256&&receipt?.operationId===approval.operationId&&hash(current)===receipt.afterHash);
    const a=current.rows[metadata[1]].find(x=>x.redundante_id===p.redundantId);
    requireThat(a&&!a.revertido_en&&a.operacion_id===approval.operationId);
    await db.query('update private.haiku_huesped_alias_v1 set revertido_en=now() where redundante_id=$1',[p.redundantId]);
    // Restaurar por las claves de cada fila respaldada, nunca por todo el huésped canónico.
    for(const [t,col] of Object.entries(refs))for(const row of m.snapshot.rows[t].filter(r=>r[col]===p.redundantId)){
      const keys=row.id?['id']:Object.keys(row).filter(k=>k.endsWith('_id')&&k!==col);
      requireThat(keys.length>0);
      await db.query(`update ${table(t)} set ${quote(col)}=$1 where ${keys.map((k,i)=>quote(k)+'=$'+(i+2)).join(' and ')}`,
        [p.redundantId,...keys.map(k=>row[k])]);
    }
    await db.query(`update private.haiku_rut_registro_v1 set huesped_id=null,bloqueado=true where huesped_id=$1
      and clave=private.haiku_rut_clave_v1((select numero_documento from public.huespedes where id=$2))`,[p.canonicalId,p.redundantId]);
    await db.query('set constraints all immediate');
    const restored=await snapshot(db,current.catalog);
    // Reusa el verificador en dirección inversa; el historial de auditoría sólo crece.
    preserve(current,restored,{},m.snapshot);
    for(const [t,col] of Object.entries(refs))for(const row of m.snapshot.rows[t]){
      const actual=restored.rows[t].find(r=>row.id?r.id===row.id:
        r.reserva_id===row.reserva_id&&r.estadia_id===row.estadia_id&&r[col]===row[col]);
      requireThat(actual&&actual[col]===row[col]);
    }
    committing=true;await db.query('commit');return {reverted:true,manifestHash:m.sha256};
  }catch(e){try{await db.query('rollback')}catch(_){}
    throw Object.assign(new Error(committing?'Resultado de reversión no confirmado; consultar operación antes de reintentar':
      'Reversión abortada íntegramente; requiere revisión manual'),{code:committing?'HLR03':'HLR01'});}
}
module.exports={manifest,apply,revert,hash};
