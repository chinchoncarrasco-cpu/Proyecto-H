(function(root){
    'use strict';
    function create(client, core, uuid=()=>core.uuid()) {
        const bucket=client.storage.from('haiku-redes');
        const check=r=>{if(r.error) throw new Error(r.error.message||'No se pudo guardar. Vuelve a intentarlo.'); return r.data;};
        async function pages(table) {
            const all=[];
            for(let start=0;;start+=500){
                const rows=check(await client.from(table).select('*').order('id').range(start,start+499));
                all.push(...rows); if(rows.length<500) return all;
            }
        }
        async function load() { const [posts,assets]=await Promise.all([pages('haiku_redes_posts'),pages('haiku_redes_assets')]); return {posts,assets}; }
        async function get(id) {
            const [p,a]=await Promise.all([client.from('haiku_redes_posts').select('*').eq('id',id).maybeSingle(),client.from('haiku_redes_assets').select('*').eq('post_id',id).order('position').order('created_at')]);
            return {post:check(p),assets:check(a)};
        }
        async function ensure(post) {
            check(await client.from('haiku_redes_posts').upsert({...core.row(post),workflow_status:'material_pendiente'},{onConflict:'id',ignoreDuplicates:true}));
            return (await get(post.id)).post;
        }
        async function save(post, revision) {
            if (!revision) {
                // A simultaneous first edit must not silently overwrite another receptionist.
                const result=await client.from('haiku_redes_posts').insert(core.row(post)).select().single();
                if(result.error?.code==='23505') throw new Error('Otra persona guardó este contenido. Cierra y vuelve a abrir la ficha.');
                return check(result);
            }
            const patch=core.row(post); delete patch.id;
            const rows=check(await client.from('haiku_redes_posts').update(patch).eq('id',post.id).eq('revision',revision).select());
            if(!rows.length) throw new Error('El contenido cambió en otro equipo. Cierra y vuelve a abrir la ficha antes de guardar.');
            return rows[0];
        }
        async function remove(asset) {
            check(await bucket.remove([asset.storage_path]));
            check(await client.from('haiku_redes_assets').delete().eq('id',asset.id));
        }
        async function upload(post,file,{kind='media',captured=false,position=0}={}) {
            core.validateFile(file,post,kind,captured);
            // The caller saves the current form before uploads; never upsert stale form data here.
            const asset=check(await client.from('haiku_redes_assets').insert({id:uuid(),post_id:post.id,filename:file.name.slice(0,255),mime:file.type,bytes:file.size,kind,position,captured_on:post.story_kind==='diaria'?core.today():null}).select().single());
            try {
                check(await bucket.upload(asset.storage_path,file,{contentType:file.type,upsert:false,cacheControl:'3600'}));
                return check(await client.from('haiku_redes_assets').update({state:'ready'}).eq('id',asset.id).select().single());
            } catch(error) {
                try { await remove(asset); } catch(cleanup) { throw new Error(`${error.message} La carga quedó incompleta: vuelve a abrir la ficha y pulsa «Retirar carga incompleta».`); }
                throw error;
            }
        }
        async function signed(asset,download=false) {
            return check(await bucket.createSignedUrl(asset.storage_path,900,download?{download:asset.filename}:undefined)).signedUrl;
        }
        async function reorder(postId, ids) {check(await client.rpc('haiku_redes_ordenar',{p_post:postId,p_ids:ids}));}
        async function getShare(){return check(await client.from('haiku_redes_share').select('id,token,enabled').eq('id','redes').maybeSingle());}
        async function changeShare(previous,enabled){
            const token=enabled?Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join(''):previous?.token;
            if(!previous){
                const result=await client.from('haiku_redes_share').insert({id:'redes',token,enabled}).select('id,token,enabled').single();
                if(result.error?.code==='23505')throw new Error('Otra persona cambió el enlace. Cierra y vuelve a abrir Compartir.');
                return check(result);
            }
            const data=check(await client.from('haiku_redes_share').update({token,enabled}).eq('id','redes').eq('token',previous.token).eq('enabled',previous.enabled).select('id,token,enabled'));
            if(!data.length)throw new Error('El enlace cambió en otro equipo. Cierra y vuelve a abrir Compartir.');
            return data[0];
        }
        return {load,get,ensure,save,upload,remove,signed,reorder,getShare,changeShare};
    }
    if(typeof module==='object'&&module.exports) module.exports={create}; else root.HaikuRedesApi=Object.freeze({create});
})(typeof window==='object'?window:globalThis);
