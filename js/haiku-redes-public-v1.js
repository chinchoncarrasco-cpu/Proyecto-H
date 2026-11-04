(function(root){
 'use strict';
 function create({token,endpoint,fetcher=fetch}){
  async function request(action,extra={}){
   if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Abre el enlace completo que te compartieron desde Haku.');
   const response=await fetcher(endpoint,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action,...extra})});
   const data=await response.json();if(!response.ok){const error=new Error(data.error||'No se pudo abrir el calendario.');error.unavailable=response.status===404;throw error;}return data;
  }
  return {load:()=>request('calendar'),signed:async asset=>(await request('media',{asset_id:asset.id})).url};
 }
 if(typeof module==='object'&&module.exports)module.exports={create};else root.HaikuRedesPublic=Object.freeze({create});
})(typeof window==='object'?window:globalThis);
