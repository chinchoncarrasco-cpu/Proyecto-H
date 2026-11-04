(function (root) {
    'use strict';
    const TYPES = {historia:'Historia', publicacion:'Publicación', reel:'Reel'};
    const STATES = {material_pendiente:'Material pendiente', en_revision:'En revisión', listo:'Listo', programado:'Programado en Meta', publicado:'Publicado'};
    const CATEGORIES = {redes:'Redes sociales',feriados:'Feriados',irrenunciables:'Irrenunciables',festividades:'Festividades',verano:'Vacaciones de verano',invierno:'Vacaciones de invierno',temporadas:'Temporadas',preparacion:'Preparar material',campanias:'Estadías promocionadas'};
    function uuid() {
        if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
        const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
        const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    }
    function today(now = new Date()) {
        const p = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
        const v = Object.fromEntries(p.map(x=>[x.type,x.value]));
        return `${v.year}-${v.month}-${v.day}`;
    }
    function dateLabel(date, options={day:'numeric',month:'long',year:'numeric'}) {
        return new Intl.DateTimeFormat('es-CL', {...options,timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
    }
    function escape(value) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function material(post, assets=[], day=today()) {
        if (post.story_kind==='diaria' && post.date>day) return 'capturar';
        if (!assets.some(a=>a.state==='ready' && a.kind==='media')) return post.story_kind==='diaria'?'capturar':'sin';
        return ['listo','programado','publicado'].includes(post.workflow_status)?'listo':'con';
    }
    function validateFile(file, post, kind='media', captured=false, day=today()) {
        const photo=['image/jpeg','image/png','image/webp'].includes(file.type);
        const video=['video/mp4','video/webm'].includes(file.type);
        if (!photo && !video) throw new Error('Usa JPG, PNG, WebP, MP4 o WebM.');
        if (file.size<=0 || file.size>(photo?10:50)*1024*1024) throw new Error(photo?'Cada foto debe pesar hasta 10 MB.':'Cada video debe pesar hasta 50 MB.');
        if (kind==='cover' ? (post.content_type!=='reel'||!photo) : (post.format==='Video'?!video:!photo)) throw new Error('El archivo no corresponde al formato elegido.');
        if (post.story_kind==='diaria' && (post.date!==day || !captured)) throw new Error('Confirma que el material fue capturado hoy. Las historias del día se adjuntan en su fecha.');
    }
    function row(post) {
        return {id:post.id,title:post.title,publish_date:post.date,content_type:post.content_type,format:post.format,
            story_kind:post.content_type==='historia'?(post.story_kind||'diaria'):null,channels:post.channels||['facebook','instagram'],
            copy:post.copy||'',owner:post.owner||'',publish_time:post.time||null,campaign_id:post.campaign_id||null,
            workflow_status:post.workflow_status||'material_pendiente'};
    }
    function merge(plan, rows) {
        const map=new Map(plan.map(p=>[p.id,{...p}]));
        rows.forEach(r=>map.set(r.id,{...(map.get(r.id)||{categories:['redes'],detail:'Contenido creado por el equipo'}),...r,date:r.publish_date,time:r.publish_time}));
        return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
    }
    function matches(event, filters, assets=[], day=today()) {
        if (!(event.categories||['redes']).some(c=>filters.categories.includes(c))) return false;
        if (filters.search && !`${event.title} ${event.detail||''}`.toLocaleLowerCase('es').includes(filters.search.toLocaleLowerCase('es'))) return false;
        if (filters.campaign && event.campaign_id!==filters.campaign) return false;
        if (!event.content_type) return !['type','format','material','state','channel','execution'].some(k=>filters[k]);
        return (!filters.type || event.content_type===filters.type) && (!filters.format || event.format===filters.format) &&
            (!filters.material || material(event,assets,day)===filters.material) && (!filters.state || event.workflow_status===filters.state) &&
            (!filters.channel || event.channels?.includes(filters.channel)) && (!filters.execution || (event.conditional?'conditional':'fixed')===filters.execution);
    }
    const api={TYPES,STATES,CATEGORIES,uuid,today,dateLabel,escape,material,validateFile,row,merge,matches};
    if (typeof module==='object' && module.exports) module.exports=api;
    else root.HaikuRedesCore=Object.freeze(api);
})(typeof window==='object'?window:globalThis);
