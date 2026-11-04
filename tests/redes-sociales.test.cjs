const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../js/haiku-redes-core-v1');
const {create}=require('../js/haiku-redes-api-v1');
const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/haiku-redes-2027.json')));
const photo={name:'prueba.jpg',type:'image/jpeg',size:100};
const post={id:'manual-test',title:'Terraza',date:'2027-01-05',content_type:'publicacion',format:'Foto',channels:['facebook'],workflow_status:'material_pendiente'};
test('fecha local de Chile y captura diaria no se adelantan por UTC',()=>{
 assert.equal(C.today(new Date('2027-01-05T01:30:00Z')),'2027-01-04');
 assert.throws(()=>C.validateFile(photo,{...post,story_kind:'diaria'},'media',true,'2027-01-04'),/historias/);
 assert.throws(()=>C.validateFile(photo,{...post,story_kind:'diaria'},'media',false,'2027-01-05'),/Confirma/);
 assert.doesNotThrow(()=>C.validateFile(photo,{...post,story_kind:'diaria'},'media',true,'2027-01-05'));
});
test('rechaza formatos erróneos, vacíos y tamaños excesivos antes de guardar',()=>{
 for(const f of [{...photo,type:'image/svg+xml'},{...photo,size:0},{...photo,size:10*1024*1024+1}])assert.throws(()=>C.validateFile(f,post));
 assert.throws(()=>C.validateFile(photo,{...post,format:'Video'}));
 assert.throws(()=>C.validateFile(photo,post,'cover'));
 assert.doesNotThrow(()=>C.validateFile(photo,{...post,content_type:'reel'},'cover'));
});
test('plan 2027 mantiene 105 publicaciones permanentes y 470 historias, con preparativos separados',()=>{
 const ps=plan.posts.filter(p=>p.date.startsWith('2027'));
 assert.equal(ps.filter(p=>p.content_type!=='historia').length,105);
 assert.equal(ps.filter(p=>p.content_type==='historia').length,470);
 assert.equal(new Set(plan.posts.map(p=>p.id)).size,plan.posts.length);
 assert.equal(plan.preparation_tasks.filter(t=>t.extension!=='inicio-2026').length,18);
});
test('filtros combinan capas, diferencian material y no duplican feriados',()=>{
 const f={categories:Object.keys(C.CATEGORIES)};
 assert.equal(plan.events.filter(e=>e.date.startsWith('2027')&&C.matches(e,f)).length,26);
 const daily={...post,story_kind:'diaria',date:'2027-01-05'};
 assert.equal(C.material(daily,[],'2027-01-04'),'capturar');
 assert.equal(C.material(post,[{state:'ready',kind:'cover'}]),'sin');
 assert.equal(C.matches(post,{...f,type:'reel'}),false);
 assert.equal(C.matches(post,{...f,channel:'facebook'}),true);
 assert.equal(C.matches(plan.events[0],{...f,format:'Foto'}),false);
});
test('sobrescrituras compartidas reemplazan el plan sin duplicarlo y conservan contexto',()=>{
 const merged=C.merge([{...post,detail:'Contexto estacional'}],[{...C.row(post),title:'Actualizado',publish_date:'2027-01-08',revision:3}]);
 assert.equal(merged.length,1);assert.equal(merged[0].date,'2027-01-08');assert.equal(merged[0].detail,'Contexto estacional');
 assert.equal(C.escape('<img src=x onerror="1">'),'&lt;img src=x onerror=&quot;1&quot;&gt;');
});
// Shared service fake: multiple API instances see the same rows/objects, as separate reception sessions do.
function service(){
 const db={haiku_redes_posts:[],haiku_redes_assets:[]},objects=new Map(), calls=[];let failUpload=false,failReady=false,failDelete=false;
 class Query{
  constructor(table){this.table=table;this.filters=[];this.action='read';this.singleMode=false;}
  select(){return this;}order(){return this;}range(a,b){this.rangeValue=[a,b];return this;}eq(k,v){this.filters.push(x=>x[k]===v);return this;}single(){this.singleMode=true;return this;}maybeSingle(){this.singleMode=true;return this;}
  insert(v){this.action='insert';this.value=v;return this;}upsert(v){this.action='upsert';this.value=v;return this;}update(v){this.action='update';this.value=v;return this;}delete(){this.action='delete';return this;}
  then(resolve,reject){try{
   let rows=db[this.table].filter(x=>this.filters.every(f=>f(x))),error=null;
   if(this.action==='insert'||this.action==='upsert'){
    const existing=db[this.table].find(x=>x.id===this.value.id);
    if(existing){if(this.action==='insert')error={code:'23505',message:'duplicate'};rows=[];}
    else {const r={...this.value,revision:1,created_at:new Date().toISOString()};if(this.table.endsWith('assets'))Object.assign(r,{state:'uploading',storage_path:r.post_id+'/'+r.id+'.jpg'});db[this.table].push(r);rows=[r];}
   }else if(this.action==='update'){
    if(this.value.state==='ready'&&failReady){error={message:'Falló confirmación'};}
    else rows.forEach(x=>Object.assign(x,this.value,{revision:(x.revision||0)+1}));
   }else if(this.action==='delete'){
    if(failDelete)error={message:'Falló retiro'};else {calls.push('delete-row');db[this.table]=db[this.table].filter(x=>!rows.includes(x));}
   }
   if(this.rangeValue)rows=rows.slice(this.rangeValue[0],this.rangeValue[1]+1);
   resolve({data:structuredClone(this.singleMode?rows[0]||null:rows),error});
  }catch(e){reject(e);}}
 }
 const bucket={async upload(p,f){calls.push('upload');if(failUpload)return{error:{message:'Falló carga'}};objects.set(p,f);return{data:{path:p}};},async remove(paths){calls.push('delete-object');paths.forEach(p=>objects.delete(p));return{data:[]};},async createSignedUrl(p){return objects.has(p)?{data:{signedUrl:'https://private.example/signed/'+p}}:{error:{message:'Archivo inexistente'}};}};
 const client={from:t=>new Query(t),storage:{from:()=>bucket},rpc:async()=>({data:null})};
 return {client,db,objects,calls,setFailure(key,v=true){if(key==='upload')failUpload=v;if(key==='ready')failReady=v;if(key==='delete')failDelete=v;}};
}
test('foto guardada reaparece desde otra sesión y usa enlace privado',async()=>{
 const s=service(),a=create(s.client,C,()=> 'file-1');const saved=await a.save(post);
 await a.upload({...post,...saved},photo);
 const b=create(s.client,C);const loaded=await b.get(post.id);
 assert.equal(loaded.assets.length,1);assert.equal(loaded.assets[0].state,'ready');assert.match(await b.signed(loaded.assets[0]),/signed/);
 await b.remove(loaded.assets[0]);assert.equal(s.objects.size,0);assert.equal((await b.get(post.id)).assets.length,0);
 assert.deepEqual(s.calls.slice(-2),['delete-object','delete-row']);
});
test('fallo de subida o confirmación limpia archivo y metadatos, sin indicar guardado',async()=>{
 for(const kind of ['upload','ready']){
  const s=service(),api=create(s.client,C,()=> 'file-1');await api.save(post);s.setFailure(kind);
  await assert.rejects(api.upload(post,photo),/Falló/);assert.equal(s.objects.size,0);assert.equal(s.db.haiku_redes_assets.length,0);
 }
});
test('fallo de limpieza conserva un registro recuperable y explica cómo retirarlo',async()=>{
 const s=service(),api=create(s.client,C,()=> 'file-1');await api.save(post);s.setFailure('upload');s.setFailure('delete');
 await assert.rejects(api.upload(post,photo),/Retirar carga incompleta/);assert.equal(s.db.haiku_redes_assets.length,1);
});
test('edición simultánea no pisa cambios de otro equipo',async()=>{
 const s=service(),api=create(s.client,C);await api.save(post);await api.save({...post,title:'Otra recepcionista'},1);
 await assert.rejects(api.save({...post,title:'Versión antigua'},1),/cambió en otro equipo/);
 await assert.rejects(api.save(post),/Otra persona guardó/);
 assert.equal((await api.get(post.id)).post.title,'Otra recepcionista');
});
