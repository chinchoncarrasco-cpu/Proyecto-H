const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../js/haiku-redes-core-v1'),{create}=require('../js/haiku-redes-api-v1');
const {create:createPublic}=require('../js/haiku-redes-public-v1');
const token='a'.repeat(64),assetId='00000000-0000-0000-0000-000000000011';
function service(){
 const db={haiku_redes_share:[],haiku_redes_posts:[],haiku_redes_assets:[]},calls=[];
 class Query{
  constructor(table){this.table=table;this.filters=[];this.action='read';calls.push(table);}
  select(){return this;}eq(k,v){this.filters.push(x=>x[k]===v);return this;}order(){return this;}range(a,b){this.bounds=[a,b];return this;}
  maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}
  insert(value){this.value=value;this.action='insert';return this;}update(value){this.value=value;this.action='update';return this;}
  then(resolve,reject){try{let rows=db[this.table].filter(x=>this.filters.every(f=>f(x))),error=null;
   if(this.action==='insert'){if(db[this.table].some(x=>x.id===this.value.id))error={code:'23505'};else{const r={...this.value};db[this.table].push(r);rows=[r];}}
   if(this.action==='update')rows.forEach(x=>Object.assign(x,this.value));
   if(this.bounds)rows=rows.slice(this.bounds[0],this.bounds[1]+1);
   resolve({data:structuredClone(this.one?rows[0]||null:rows),error});
  }catch(e){reject(e);}}
 }
 return {db,calls,client:{from:t=>new Query(t),storage:{from:bucket=>({createSignedUrl:async(p,seconds)=>{calls.push({bucket,p,seconds});return{data:{signedUrl:'https://storage.example/signed'}};}})}}};
}
const req=(body,method='POST')=>new Request('https://edge.example',{method,headers:{'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('enlace se activa, rota, rechaza cambios simultáneos y se desactiva',async()=>{
 const s=service(),api=create(s.client,C);assert.equal(await api.getShare(),null);
 const first=await api.changeShare(null,true);assert.match(first.token,/^[a-f0-9]{64}$/);assert.ok(first.enabled);
 await assert.rejects(api.changeShare(null,true),/Otra persona/);
 const rotated=await api.changeShare(first,true);assert.notEqual(rotated.token,first.token);
 await assert.rejects(api.changeShare(first,false),/otro equipo/);
 const disabled=await api.changeShare(rotated,false);assert.equal(disabled.enabled,false);
 const again=await api.changeShare(disabled,true);assert.notEqual(again.token,disabled.token);
});
test('endpoint niega enlaces ausentes, falsos o desactivados antes de leer contenido',async()=>{
 const {createHandler}=await import('../supabase/functions/redes-calendar-share/handler.mjs');const s=service(),h=createHandler(s.client);
 assert.equal((await h(req({},'GET'))).status,405);
 for(const t of ['',token])assert.equal((await h(req({token:t,action:'calendar'}))).status,404);
 s.db.haiku_redes_share.push({id:'redes',token,enabled:false});assert.equal((await h(req({token,action:'calendar'}))).status,404);
 assert.ok(s.calls.every(t=>t==='haiku_redes_share'));
});
test('endpoint pagina y devuelve solo campos sociales, sin responsables, autoría ni rutas privadas',async()=>{
 const {createHandler}=await import('../supabase/functions/redes-calendar-share/handler.mjs');const s=service(),h=createHandler(s.client);
 s.db.haiku_redes_share.push({id:'redes',token,enabled:true});
 s.db.haiku_redes_posts=Array.from({length:501},(_,i)=>({id:'post-'+i,title:'Actualizado',owner:'Privado',created_by:'privado',revision:2,copy:'Texto revisado'}));
 s.db.haiku_redes_assets.push({id:assetId,post_id:'post-0',state:'ready',storage_path:'privado',created_by:'privado'},{id:'incompleto',state:'uploading'});
 const response=await h(req({token,action:'calendar',table:'reservas'})),data=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(data.posts.length,501);assert.equal(data.assets.length,1);
 assert.equal(data.posts[0].owner,undefined);assert.equal(data.posts[0].created_by,undefined);assert.equal(data.assets[0].storage_path,undefined);
 assert.ok(s.calls.every(t=>['haiku_redes_share','haiku_redes_posts','haiku_redes_assets'].includes(t)));
});
test('archivos requieren enlace activo y un adjunto listo del bucket social',async()=>{
 const {createHandler}=await import('../supabase/functions/redes-calendar-share/handler.mjs');const s=service(),h=createHandler(s.client);
 s.db.haiku_redes_share.push({id:'redes',token,enabled:true});s.db.haiku_redes_assets.push({id:assetId,state:'ready',storage_path:'post-1/'+assetId+'.jpg',mime:'image/jpeg'});
 assert.equal((await h(req({token,action:'media',asset_id:assetId,path:'reservas/secret'}))).status,200);
 assert.deepEqual(s.calls.find(c=>typeof c==='object'),{bucket:'haiku-redes',p:'post-1/'+assetId+'.jpg',seconds:300});
 s.db.haiku_redes_share[0].enabled=false;assert.equal((await h(req({token,action:'media',asset_id:assetId}))).status,404);
 s.db.haiku_redes_share[0].enabled=true;s.db.haiku_redes_assets[0].state='uploading';assert.equal((await h(req({token,action:'media',asset_id:assetId}))).status,404);
 assert.equal((await h(req({token,action:'delete'}))).status,400);
});
test('cliente visitante no usa sesión, no permite escrituras y no coloca clave en URL',async()=>{
 const calls=[],api=createPublic({token,endpoint:'https://edge.example',fetcher:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({posts:[],assets:[],url:'https://storage.example/signed'}));}});
 await api.load();await api.signed({id:assetId});assert.deepEqual(Object.keys(api).sort(),['load','signed']);
 assert.ok(calls.every(c=>!c.url.includes(token)&&c.options.credentials==='omit'&&!c.options.headers.Authorization));
 const html=fs.readFileSync(path.join(__dirname,'../calendario-redes.html'),'utf8');
 assert.doesNotMatch(html,/supabase-auth|supabase-client|haiku-redes-api|panel\.html|iframe/);assert.match(html,/noindex,nofollow/);
});
