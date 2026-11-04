// Capability-based read-only endpoint. Never accepts a table, bucket or path from callers.
export const POST_FIELDS='id,title,publish_date,content_type,format,story_kind,channels,copy,publish_time,campaign_id,workflow_status';
export const ASSET_FIELDS='id,post_id,filename,mime,bytes,kind,state,position,created_at';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
const pick=(row,fields)=>Object.fromEntries(fields.split(',').map(k=>[k,row[k]]));
export function createHandler(client){
 const send=(status,body)=>new Response(JSON.stringify(body),{status,headers});
 const check=r=>{if(r.error)throw Error('upstream');return r.data;};
 async function pages(table,fields,ready=false){
  const rows=[];
  for(let n=0;n<50000;n+=500){
   let q=client.from(table).select(fields).order('id').range(n,n+499);
   if(ready)q=q.eq('state','ready');
   const page=check(await q);rows.push(...page.map(r=>pick(r,fields)));
   if(page.length<500)return rows;
  }
  throw Error('limit');
 }
 return async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return send(405,{error:'Método no permitido.'});
  let body;
  try{if(Number(req.headers.get('content-length'))>4096)return send(413,{error:'Solicitud demasiado grande.'});const raw=await req.text();if(raw.length>4096)return send(413,{error:'Solicitud demasiado grande.'});body=JSON.parse(raw);}catch{return send(400,{error:'Solicitud inválida.'});}
  if(!body||typeof body.token!=='string'||! /^[a-f0-9]{64}$/.test(body.token))return send(404,{error:'Este enlace no está disponible o fue desactivado.'});
  try{
   const share=check(await client.from('haiku_redes_share').select('id').eq('id','redes').eq('token',body.token).eq('enabled',true).maybeSingle());
   if(!share)return send(404,{error:'Este enlace no está disponible o fue desactivado.'});
   if(body.action==='media'){
    if(typeof body.asset_id!=='string'||! /^[a-f0-9-]{36}$/.test(body.asset_id))return send(400,{error:'Archivo inválido.'});
    const a=check(await client.from('haiku_redes_assets').select('storage_path,mime').eq('id',body.asset_id).eq('state','ready').maybeSingle());
    if(!a||! /^[a-zA-Z0-9_-]{1,100}\/[a-f0-9-]{36}\.(jpg|png|webp|mp4|webm)$/.test(a.storage_path))return send(404,{error:'Archivo no disponible.'});
    const signed=check(await client.storage.from('haiku-redes').createSignedUrl(a.storage_path,300));
    return send(200,{url:signed.signedUrl,expires_in:300});
   }
   if(body.action!=='calendar')return send(400,{error:'Acción no disponible.'});
   const [posts,assets]=await Promise.all([pages('haiku_redes_posts',POST_FIELDS),pages('haiku_redes_assets',ASSET_FIELDS,true)]);
   return send(200,{posts,assets,readonly:true});
  }catch{return send(503,{error:'No se pudo cargar el calendario. Intenta actualizar en un momento.'});}
 };
}
