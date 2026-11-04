/* Social planning is independent from the reservation calendar and never writes reservations. */
(() => {
    'use strict';
    const C=window.HaikuRedesCore, section=document.getElementById('seccion-calendario');
    if(!C || !section) return;
    const readOnly=section.dataset.redesPublic==='true';
    const E=C.escape, host=document.getElementById('haiku-redes'), mode=document.getElementById('haiku-calendario-modo');
    const dialog=document.createElement('dialog'); dialog.className='hr-dialog'; dialog.setAttribute('aria-label','Contenido de redes sociales'); document.body.append(dialog);
    const day=C.today(); let cursor=day.slice(0,7), view='mes', plan=null, rows=[], assets=[], api=null, selected=null, dirty=false, busy=false, generation=0, opening=0, lastFocus=null, signedTimer=null;
    let filters=defaults(), loaded=false;
    let shareState=null;
    let privacySuspended=false,privacyFocus=null;
    const privacyBlocked=()=>!readOnly&&document.documentElement.classList.contains('haiku-privacidad-bloqueada');
    function showDialog(){
        if(privacyBlocked()){privacySuspended=true;return;}
        privacySuspended=false;dialog.showModal();
    }
    function syncPrivacy(){
        if(readOnly)return;
        if(privacyBlocked()){
            if(dialog.open){privacySuspended=true;privacyFocus=document.activeElement;dialog.close();clearTimeout(signedTimer);}
            return;
        }
        if(privacySuspended){
            privacySuspended=false;
            if(!window.haikuSesion)return;
            dialog.showModal();
            if(privacyFocus?.isConnected&&dialog.contains(privacyFocus))privacyFocus.focus({preventScroll:true});
            privacyFocus=null;
            if(selected)renderGallery();
        }
    }
    if(!readOnly){
        window.addEventListener('haiku:privacidad-cambio',syncPrivacy);
        // Also supports a privacy script from the previous cached panel version.
        new MutationObserver(syncPrivacy).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    }
    if(readOnly&&window.matchMedia('(max-width:600px)').matches)view='agenda';
    function defaults(){return {categories:['redes'],search:'',type:'',format:'',material:'',state:'',channel:'',campaign:'',execution:''};}
    const months=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const assetList=id=>assets.filter(a=>a.post_id===id).sort((a,b)=>a.position-b.position||a.created_at.localeCompare(b.created_at));
    const posts=()=>C.merge(plan?.posts||[],rows);
    const allEvents=()=>[...posts(),...(plan?.events||[]),...(plan?.preparation_tasks||[]),...(plan?.campaign_periods||[])];
    const getPost=id=>posts().find(p=>p.id===id);
    const matches=p=>C.matches(p,filters,assetList(p.id));
    function note(message,error=false){const n=host.querySelector('[data-notice]');if(n){n.textContent=message;n.classList.toggle('hr-error',error);}}
    function drawerNote(message,error=false){const n=dialog.querySelector('[data-drawer-notice]');if(n){n.textContent=message;n.classList.toggle('hr-error',error);}}
    function select(name,label,items,value){return `<label>${E(label)}<select data-filter="${name}"><option value="">Todos</option>${Object.entries(items).map(([v,t])=>`<option value="${E(v)}" ${value===v?'selected':''}>${E(t)}</option>`).join('')}</select></label>`;}
    function shell(){
        host.innerHTML=`<div class="hr-top"><div><p class="hr-eyebrow">PLAN EDITORIAL · ${readOnly?'HAIKU':'EQUIPO HAKU'}</p><h3>Redes sociales</h3><p>${readOnly?'Calendario compartido · Consulta las fechas, indicaciones y material adjunto.':'Prepara el contenido; las historias del día se capturan en su fecha.'}</p></div>${readOnly?'':'<div class="hr-top-actions"><button data-action="share">Compartir</button><button class="hr-primary" data-action="new">+ Nuevo contenido</button></div>'}</div>
        <p data-notice role="status" aria-live="polite"></p>
        <div class="hr-controls"><div class="hr-segment" aria-label="Vista del calendario">${['mes','ano','agenda','campanas'].map(v=>`<button data-view="${v}" aria-pressed="${view===v}">${{mes:'Mes',ano:'Año',agenda:'Agenda',campanas:'Campañas'}[v]}</button>`).join('')}</div>
        <div class="hr-period"><button data-action="previous" aria-label="Período anterior">‹</button><label><span class="hr-sr">Mes y año</span><input type="month" data-cursor value="${cursor}" min="2020-01" max="2100-12"></label><button data-action="next" aria-label="Período siguiente">›</button><button data-action="today">Hoy</button></div><button data-action="refresh">Actualizar</button></div>
        <div class="hr-layers" aria-label="Capas del calendario"><button data-action="all" aria-pressed="${filters.categories.length===Object.keys(C.CATEGORIES).length}">Todos</button>${Object.entries(C.CATEGORIES).map(([v,t])=>`<button data-category="${v}" aria-pressed="${filters.categories.includes(v)}">${t}</button>`).join('')}</div>
        <details class="hr-filters" ${Object.entries(filters).some(([k,v])=>k!=='categories'&&v)?'open':''}><summary>Filtrar contenido <span>Tipo, material, estado y más</span></summary><div class="hr-filter-grid">
        ${select('type','Tipo',C.TYPES,filters.type)}${select('format','Formato',{Foto:'Foto',Carrusel:'Carrusel',Video:'Video'},filters.format)}
        ${select('material','Material',{sin:'Sin material',con:'Con material',listo:'Material listo',capturar:'Por capturar'},filters.material)}${select('state','Estado',C.STATES,filters.state)}
        ${select('channel','Red',{facebook:'Facebook',instagram:'Instagram'},filters.channel)}${select('campaign','Campaña',Object.fromEntries((plan?.campaigns||[]).map(c=>[c.id,c.title])),filters.campaign)}
        ${select('execution','Ejecución',{fixed:'Planificada',conditional:'Sujeta a disponibilidad'},filters.execution)}<label>Buscar<input data-filter="search" type="search" value="${E(filters.search)}" placeholder="Título o tema"></label></div><p>Las capas se combinan. Los filtros de contenido muestran solo tareas de redes sociales.</p></details>
        <div data-summary class="hr-summary"></div><div data-calendar></div><div data-pending class="hr-pending"></div>`;
        renderCalendar();
    }
    function filtered(){return allEvents().filter(matches);}
    function inMonth(e,month=cursor){return e.date && e.date<=month+'-31' && (e.end_date||e.date)>=month+'-01';}
    function eventButton(e,compact=false){
        const list=assetList(e.id), count=list.filter(a=>a.state==='ready').length;
        const label=e.content_type?`${e.content_type==='historia'?({diaria:'Historia del día',comercial:'Historia comercial',refuerzo:'Historia de refuerzo'}[e.story_kind]||'Historia'):C.TYPES[e.content_type]}${e.content_type==='publicacion'?' · '+e.format:''}`:e.categories?.includes('preparacion')?'Preparar material':e.categories?.includes('campanias')?'Estadía':e.categories?.includes('feriados')?'Feriado':'Fecha importante';
        const mat=e.content_type?C.material(e,list):null;
        const status=mat==='capturar'?(e.date===C.today()?'Por capturar hoy':e.date<C.today()?'Sin captura registrada':'Capturar en la fecha'):count?`${count} adjunto${count===1?'':'s'}`:'Sin material';
        return `<button class="hr-event hr-event--${E(e.content_type||'context')}" data-event="${E(e.id)}"><span class="hr-event-type">${E(label)}${e.conditional?' · Condicional':''}</span><strong>${E(e.title)}</strong>${e.content_type?`<span class="hr-event-meta">${E(status)}${compact?'':' · '+E(C.STATES[e.workflow_status]||'Material pendiente')}</span>`:''}</button>`;
    }
    function renderCalendar(){
        const area=host.querySelector('[data-calendar]');if(!area)return;
        if(readOnly&&!loaded){area.innerHTML='';return;}
        const events=filtered(), current=events.filter(e=>inMonth(e)), year=cursor.slice(0,4);
        const content=current.filter(p=>p.content_type);
        host.querySelector('[data-summary]').textContent=`${months[Number(cursor.slice(5))-1]} ${year} · ${content.length} contenidos · ${content.filter(p=>assetList(p.id).some(a=>a.state==='ready')).length} con material adjunto`;
        const m=C.monthContext(plan,cursor);
        let html=m?`<div class="hr-season"><strong>${E(m.season)} · ${E(m.content)}</strong><span>${E(m.weather_rule)}</span></div>`:'';
        if(year!=='2027')html+=`<p class="hr-muted">${year==='2026'?'La rutina comienza el 4 de noviembre de 2026: historia diaria, publicaciones de martes y viernes y refuerzos comerciales. Los días anteriores quedan sin tareas retroactivas.':'La rutina está programada desde el 4 de noviembre de 2026 hasta diciembre de 2027. También se muestran las estadías objetivo de comienzos de 2028; puedes crear contenido en cualquier fecha.'}</p>`;
        if(view==='mes'){
            const first=new Date(cursor+'-01T12:00:00Z'),offset=(first.getUTCDay()+6)%7, days=new Date(Number(year),Number(cursor.slice(5)),0).getDate();
            html+=`<div class="hr-month-scroll"><div class="hr-month"><div class="hr-weekdays">${['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'].map(d=>`<span>${d}</span>`).join('')}</div><div class="hr-grid">`;
            for(let i=0;i<Math.ceil((offset+days)/7)*7;i++){
                const n=i-offset+1;if(n<1||n>days){html+='<div class="hr-day hr-day--outside" aria-hidden="true"></div>';continue;}
                const date=`${cursor}-${String(n).padStart(2,'0')}`;
                const items=current.filter(e=>e.date<=date&&(e.end_date||e.date)>=date);
                html+=`<div class="hr-day ${date===C.today()?'hr-day--today':''}"><div class="hr-day-head"><time datetime="${date}">${n}</time>${readOnly?'':`<button data-new-date="${date}" aria-label="Crear contenido para ${E(C.dateLabel(date))}">+</button>`}</div>${items.map(e=>eventButton(e,true)).join('')}</div>`;
            }html+='</div></div></div>';
        }else if(view==='ano'){
            html+='<div class="hr-year">';
            for(let n=1;n<=12;n++){
                const month=`${year}-${String(n).padStart(2,'0')}`, es=events.filter(e=>inMonth(e,month));
                const social=es.filter(e=>e.content_type);
                html+=`<button class="hr-year-month" data-month="${month}"><strong>${months[n-1]}</strong><span>${social.length} contenidos · ${es.length-social.length} fechas de contexto</span><span class="hr-year-types">${Object.entries(C.TYPES).map(([t,l])=>`${social.filter(p=>p.content_type===t).length} ${l}`).join(' · ')}</span><small>${social.filter(p=>assetList(p.id).some(a=>a.state==='ready')).length} con material</small></button>`;
            }html+='</div>';
        }else if(view==='agenda'){
            html+=current.length?`<div class="hr-agenda">${current.sort((a,b)=>a.date.localeCompare(b.date)).map(e=>`<div><time>${E(C.dateLabel(e.date,{day:'numeric',month:'short',weekday:'short'}))}</time>${eventButton(e)}</div>`).join('')}</div>`:'<div class="hr-empty">No hay contenido con estos filtros. Prueba «Todos» o crea una tarea.</div>';
        }else{
            const campaigns=(plan?.campaigns||[]).filter(c=>(!filters.campaign||c.id===filters.campaign)&&(!filters.search||c.title.toLowerCase().includes(filters.search.toLowerCase()))&&C.campaignInYear(c,year));
            html+=`<p class="hr-muted">Campañas del año ${year}. Las etapas respetan los filtros de contenido seleccionados.</p><div class="hr-campaigns">${campaigns.map(c=>`<article><p class="hr-eyebrow">${E(c.priority||'Planificación')} · ${c.planned_lead_days||c.lead_days||'—'} días de anticipación</p><h4>${E(c.title)}</h4><p>${c.target_start?E(C.dateLabel(c.target_start))+' – '+E(C.dateLabel(c.target_end)):'Fechas por confirmar'}</p><p>${E(c.detail||'')}</p><p class="hr-muted">Material: ${E(c.assets||'Por definir')}</p>${events.filter(e=>e.campaign_id===c.id&&e.content_type).map(e=>`<div class="hr-campaign-stage"><time>${E(C.dateLabel(e.date,{day:'numeric',month:'short'}))}</time>${eventButton(e)}</div>`).join('')}</article>`).join('')}</div>`;
        }
        area.innerHTML=html;
        const pending=(plan?.pending||[]).filter(e=>e.categories.some(c=>filters.categories.includes(c)));
        host.querySelector('[data-pending]').innerHTML=pending.length?`<strong>Fechas por confirmar</strong>${pending.map(p=>`<p>${E(p.title)}: ${E(p.detail)}</p>`).join('')}`:'';
    }
    async function refresh(quiet=false){
        if(!api)return;const g=generation; if(!quiet)note('Actualizando contenido compartido…');
        try{const data=await api.load();if(g!==generation)return;rows=data.posts;assets=data.assets;loaded=true;shell();if(!quiet)note(readOnly?'Solo lectura · Los cambios guardados por el equipo se actualizan aquí.':'Contenido compartido actualizado. La publicación en Meta se realiza por separado.');}
        catch(e){if(g===generation){if(readOnly){loaded=false;rows=[];assets=[];dialog.close();selected=null;++opening;clearTimeout(signedTimer);host.querySelector('[data-calendar]').innerHTML='';host.querySelector('[data-summary]').textContent='';host.querySelector('[data-pending]').innerHTML='';}note(e.message,true);}}
    }
    async function init(){
        if(readOnly){
            const publicGeneration=++generation;
            const params=new URLSearchParams(location.hash.slice(1)),token=params.get('enlace')||'';
            const month=params.get('mes');if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))cursor=month;
            api=window.HaikuRedesPublic.create({token,endpoint:'https://zqfegylkylxsuoejomow.supabase.co/functions/v1/redes-calendar-share'});
            shell();note('Abriendo calendario compartido…');
            try{const data=await api.load();const r=await fetch('data/haiku-redes-2027.json',{cache:'no-cache'});if(!r.ok)throw new Error('No se pudo cargar el plan.');const p=await r.json();if(publicGeneration!==generation)return;plan=p;rows=data.posts;assets=data.assets;loaded=true;shell();}
            catch(e){if(publicGeneration===generation)note(e.message,true);}return;
        }
        if(!window.haikuSesion||!window.haikuSupabase){shell();note('Inicia sesión en Haku para preparar y guardar contenido.',true);return;}
        if(typeof window.haikuTienePermiso==='function'&&!window.haikuTienePermiso('redes.gestionar')){shell();note('Tu rol no tiene acceso a la gestión de redes sociales.',true);return;}
        const g=++generation; api=window.HaikuRedesApi.create(window.haikuSupabase,C);shell();note('Cargando plan y archivos…');
        try{
            if(!plan){const r=await fetch('data/haiku-redes-2027.json',{cache:'no-cache'});if(!r.ok)throw new Error('No se pudo abrir el plan anual.');const p=await r.json();if(g!==generation)return;plan=p;}
            await refresh();
        }catch(e){if(g===generation)note(e.message,true);}
    }
    mode?.addEventListener('click',e=>{
        const b=e.target.closest('[data-calendar-mode]');if(!b||busy)return;
        const social=b.dataset.calendarMode==='redes';section.classList.toggle('hr-social-active',social);host.hidden=!social;
        mode.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
        if(social&&!loaded)init();
    });
    host.addEventListener('change',e=>{
        if(e.target.dataset.filter){filters[e.target.dataset.filter]=e.target.value;renderCalendar();}
        if(e.target.hasAttribute('data-cursor')&&/^\d{4}-\d{2}$/.test(e.target.value)){cursor=e.target.value;renderCalendar();}
    });
    host.addEventListener('input',e=>{if(e.target.dataset.filter==='search'){filters.search=e.target.value;renderCalendar();}});
    host.addEventListener('click',e=>{
        const b=e.target.closest('button');if(!b||busy)return;
        if(readOnly&&!loaded){if(b.dataset.action==='refresh')init();return;}
        if(b.dataset.category){const c=b.dataset.category;filters.categories=filters.categories.includes(c)?filters.categories.filter(x=>x!==c):[...filters.categories,c];shell();return;}
        if(b.dataset.view){view=b.dataset.view;shell();return;}
        if(b.dataset.month){cursor=b.dataset.month;view='mes';shell();return;}
        if(b.dataset.event){openEvent(b.dataset.event);return;}
        if(b.dataset.newDate){if(!readOnly)newPost(b.dataset.newDate);return;}
        switch(b.dataset.action){
            case 'all':filters={...defaults(),categories:Object.keys(C.CATEGORIES)};shell();break;
            case 'today':cursor=C.today().slice(0,7);shell();break;
            case 'refresh':refresh();break;
            case 'new':if(!readOnly)newPost(C.today());break;
            case 'share':if(!readOnly)openShare();break;
            case 'previous':case 'next':{
                const d=new Date(cursor+'-01T12:00:00Z'),delta=b.dataset.action==='next'?1:-1;
                if(view==='ano'||view==='campanas')d.setUTCFullYear(d.getUTCFullYear()+delta);else d.setUTCMonth(d.getUTCMonth()+delta);
                cursor=d.toISOString().slice(0,7);shell();break;
            }
        }
    });
    async function openEvent(id){
        const event=allEvents().find(p=>p.id===id);if(!event)return;
        lastFocus=document.activeElement; const o=++opening,g=generation;
        if(!event.content_type){
            selected=null;dirty=false;dialog.innerHTML=`<div class="hr-drawer-head"><div><p class="hr-eyebrow">PLANIFICACIÓN</p><h3>${E(event.title)}</h3></div><button data-close aria-label="Cerrar">×</button></div><div class="hr-drawer-body"><p>${E(C.dateLabel(event.date))}${event.end_date?' – '+E(C.dateLabel(event.end_date)):''}</p><p>${E(event.detail)}</p><p>${E(event.status)}</p>${event.asset?`<p>Material sugerido: ${E(event.asset)}</p>`:''}${event.campaign_id?`<button data-campaign="${E(event.campaign_id)}">Ver contenidos de esta campaña</button>`:''}<p class="hr-muted">${(event.source_ids||[]).map(id=>{const s=plan.sources.find(s=>s.id===id);return s&&/^https:\/\//.test(s.url)?`<a href="${E(s.url)}" target="_blank" rel="noopener">${E(s.title)}</a>`:'';}).join(' · ')}</p></div>`;showDialog();return;
        }
        if(!loaded){note('Espera a que termine de cargar el contenido compartido.',true);return;}
        if(readOnly){selected={...event};dirty=false;drawReadOnly();showDialog();return;}
        try{const d=await api.get(id);if(o!==opening||g!==generation)return;updateData(id,d);selected={...getPost(id)};dirty=false;drawPost();showDialog();}
        catch(e){note(e.message,true);}
    }
    function newPost(date){
        if(readOnly)return;
        if(!loaded){note('Espera a que termine la conexión con Haku y pulsa «Actualizar» si hubo un error.',true);return;}
        lastFocus=document.activeElement;selected={id:'manual-'+C.uuid(),date,title:'',content_type:'publicacion',format:'Foto',story_kind:null,channels:['facebook','instagram'],workflow_status:'material_pendiente',categories:['redes']};dirty=false;++opening;drawPost();showDialog();
    }
    function fieldOptions(items,value){return Object.entries(items).map(([v,t])=>`<option value="${E(v)}" ${v===value?'selected':''}>${E(t)}</option>`).join('');}
    function shareURL(){const url=new URL('calendario-redes.html',location.href);url.search='';url.hash=new URLSearchParams({enlace:shareState.token,mes:cursor}).toString();return url.href;}
    async function openShare(){
        if(!loaded||!api){note('Espera a que termine de cargar el calendario.',true);return;}
        lastFocus=document.activeElement;selected=null;dirty=false;const o=++opening,g=generation;
        try{const state=await api.getShare();if(o!==opening||g!==generation)return;shareState=state;drawShare();showDialog();}catch(e){note(e.message,true);}
    }
    function drawShare(){
        const enabled=!!shareState?.enabled,url=enabled?shareURL():'';
        dialog.innerHTML=`<div class="hr-drawer-head"><div><p class="hr-eyebrow">CALENDARIO DE REDES SOCIALES</p><h3>Compartir calendario</h3></div><button data-close aria-label="Cerrar">×</button></div><div class="hr-drawer-body"><p data-drawer-notice role="status" aria-live="polite"></p><p>Cualquier persona con el enlace podrá consultar todas las fechas del calendario, sus indicaciones, textos en preparación, estados y fotos o videos adjuntos, sin iniciar sesión.</p><p>Es una vista de solo lectura. No incluye reservas, datos de huéspedes, responsables internos ni acceso al panel de Haku.</p><p class="hr-muted">Los cambios que guarden en Haku se reflejan en este mismo enlace. Comparte con las personas que deban revisar el contenido.</p>${enabled?`<label>Enlace para compartir<input data-share-url readonly value="${E(url)}"></label><div class="hr-top-actions"><button class="hr-primary" data-share-copy>Copiar enlace</button><a class="hr-share-link" href="${E(url)}" target="_blank" rel="noopener noreferrer">Abrir calendario</a></div><p class="hr-muted">El enlace abre el mes seleccionado; permite recorrer todos los meses y usar filtros.</p><button data-share-change="disable">Desactivar enlace</button><button data-share-change="rotate">Cambiar enlace</button><p class="hr-muted">Al desactivarlo o cambiarlo, el enlace anterior dejará de abrir el calendario. Los archivos ya abiertos pueden seguir visibles durante unos minutos; las copias descargadas no se retiran.</p>`:'<p>El enlace está desactivado.</p><button class="hr-primary" data-share-change="enable">Activar enlace de solo lectura</button>'}</div>`;
    }
    function drawReadOnly(){
        const p=selected;
        dialog.innerHTML=`<div class="hr-drawer-head"><div><p class="hr-eyebrow">${E(C.TYPES[p.content_type])} · SOLO LECTURA</p><h3>${E(p.title)}</h3><p>${E(C.dateLabel(p.date))}${p.time?' · '+E(p.time.slice(0,5)):''}</p></div><button data-close aria-label="Cerrar">×</button></div><div class="hr-drawer-body"><p>${E(p.format)} · ${E((p.channels||[]).map(c=>c==='facebook'?'Facebook':'Instagram').join(' / '))} · ${E(C.STATES[p.workflow_status]||'Material pendiente')}</p>${p.detail?`<p>${E(p.detail)}</p>`:''}${p.time_window?`<p>Momento sugerido: ${E(p.time_window)}</p>`:''}${p.conditional?`<p class="hr-warning">${E(p.condition||'Confirmar disponibilidad antes de publicar.')}</p>`:''}${p.story_kind==='diaria'?'<p class="hr-capture">Historia del día: la foto se toma durante el turno de esa fecha.</p>':''}${p.asset_brief||p.asset?`<p>Material: ${E(p.asset_brief||p.asset)}</p>`:''}<h4>Texto de la publicación</h4><div class="hr-read-copy">${E(p.copy||'Texto por preparar.')}</div><h4>Fotos y videos</h4><div class="hr-gallery" data-read-gallery></div></div>`;
        readGallery();
    }
    async function readGallery(){
        if(!selected)return;const id=selected.id,o=opening,g=generation,gallery=dialog.querySelector('[data-read-gallery]');if(!gallery)return;
        const list=assetList(id).filter(a=>a.state==='ready');
        gallery.innerHTML=list.length?list.map(a=>`<figure data-read-asset="${E(a.id)}"><div class="hr-preview"><span>Cargando…</span></div><figcaption><strong>${E(a.filename)}</strong><span>${a.kind==='cover'?'Portada':'Material'}</span></figcaption></figure>`).join(''):'<p class="hr-empty">Todavía no hay material adjunto.</p>';
        for(const a of list){try{
            const url=await api.signed(a);if(g!==generation||o!==opening||selected?.id!==id||!gallery.isConnected)return;
            const wrap=gallery.querySelector(`[data-read-asset="${a.id}"] .hr-preview`);if(!wrap)continue;
            const media=document.createElement(a.mime.startsWith('video/')?'video':'img');media.src=url;
            if(media.tagName==='VIDEO'){media.controls=true;media.preload='metadata';}else{media.alt=a.filename;media.loading='lazy';}wrap.replaceChildren(media);
        }catch(e){if(g!==generation||o!==opening)return;if(e.unavailable){dialog.close();refresh();return;}const wrap=gallery.querySelector(`[data-read-asset="${a.id}"] .hr-preview`);if(wrap)wrap.textContent='No se pudo cargar el archivo. Cierra y vuelve a abrir la ficha.';}}
        clearTimeout(signedTimer);signedTimer=setTimeout(()=>{if(dialog.open&&selected?.id===id)readGallery();},4*60*1000);
    }
    function drawPost(){
        const p=selected, list=assetList(p.id),locked=list.length>0, daily=p.story_kind==='diaria',canCapture=!daily||p.date===C.today();
        const material=C.material(p,list); const caption=material==='capturar'?(p.date===C.today()?'Por capturar hoy':p.date>C.today()?'Capturar en la fecha':'Sin captura registrada'):{sin:'Sin material',con:'Material adjunto',listo:'Material listo'}[material];
        dialog.innerHTML=`<form class="hr-form"><div class="hr-drawer-head"><div><p class="hr-eyebrow">${E(C.TYPES[p.content_type])} · ${E(caption)}</p><h3>${E(p.title||'Nuevo contenido')}</h3><p>${E(C.dateLabel(p.date))} · Facebook / Instagram</p></div><button type="button" data-close aria-label="Cerrar">×</button></div>
        <div class="hr-drawer-body"><p data-drawer-notice role="status" aria-live="polite"></p>
        ${p.detail?`<p class="hr-brief">${E(p.detail)}</p>`:''}${p.conditional?`<p class="hr-warning">Publicar solo si corresponde: ${E(p.condition||'confirmar disponibilidad y condiciones antes de ofrecer cupos.')}</p>`:''}
        <div class="hr-form-grid"><label class="hr-full">Título<input name="title" required maxlength="200" value="${E(p.title)}" placeholder="Ej.: Vista de la terraza"></label>
        <label>Fecha<input name="date" required type="date" value="${E(p.date)}" ${locked?'disabled':''}></label><label>Hora de publicación (Chile)<input name="time" type="time" value="${E((p.time||'').slice(0,5))}"></label>
        <label>Tipo<select name="content_type" ${locked?'disabled':''}>${fieldOptions(C.TYPES,p.content_type)}</select></label>
        <label>Formato<select name="format" ${locked?'disabled':''}>${fieldOptions(p.content_type==='reel'?{Video:'Video'}:p.content_type==='historia'?{Foto:'Foto',Video:'Video'}:{Foto:'Foto',Carrusel:'Carrusel'},p.format)}</select></label>
        ${p.content_type==='historia'?`<label class="hr-full">Historia<select name="story_kind" ${locked?'disabled':''}>${fieldOptions({diaria:'Del día · capturar en la fecha',comercial:'Comercial · se puede preparar antes',refuerzo:'Refuerzo · se puede preparar antes'},p.story_kind)}</select></label>`:''}
        <label>Responsable<input name="owner" maxlength="150" value="${E(p.owner)}" placeholder="Nombre del encargado"></label><label>Estado<select name="workflow_status">${fieldOptions(C.STATES,p.workflow_status)}</select></label>
        <fieldset class="hr-full hr-channels"><legend>Publicar en</legend>${['facebook','instagram'].map(c=>`<label><input type="checkbox" name="channels" value="${c}" ${p.channels?.includes(c)?'checked':''}>${c==='facebook'?'Facebook':'Instagram'}</label>`).join('')}</fieldset>
        <label class="hr-full">Texto de la publicación<textarea name="copy" rows="5" maxlength="10000" placeholder="Prepara aquí el texto que acompañará la foto o el video…">${E(p.copy)}</textarea></label></div>
        ${locked?'<p class="hr-muted">Para cambiar fecha o formato, retira primero los adjuntos.</p>':''}
        <div class="hr-material-head"><h4>${p.content_type==='reel'?'Video y portada':'Fotos y material'}</h4><button type="button" data-copy>Copiar texto</button></div>
        <p>${E(p.asset_brief||p.asset||'Adjunta el material que usará el equipo.')}</p>
        ${daily?`<div class="hr-capture"><strong>${canCapture?'Captura del día':'Captura en la fecha de la historia'}</strong><p>${canCapture?'La imagen o el video debe mostrar cómo está el lugar hoy.':'Puedes preparar el texto y las indicaciones ahora. Los archivos se adjuntan únicamente el '+E(C.dateLabel(p.date))+'.'}</p>${canCapture?'<label><input type="checkbox" data-captured> Confirmo que este material fue capturado hoy, en horario de Chile.</label>':''}</div>`:''}
        <label class="hr-upload ${!canCapture?'hr-disabled':''}"><strong>+ ${p.format==='Video'?'Agregar video':'Agregar fotos'}</strong><span>${p.format==='Video'?'MP4 o WebM · hasta 50 MB por archivo':'JPG, PNG o WebP · hasta 10 MB por foto'}</span><input type="file" data-upload="media" ${p.format==='Carrusel'?'multiple':''} accept="${p.format==='Video'?'video/mp4,video/webm':'.jpg,.jpeg,.png,.webp'}" ${!canCapture?'disabled':''}></label>
        ${p.content_type==='reel'?'<label class="hr-cover-upload">+ Agregar portada (opcional)<input type="file" data-upload="cover" accept=".jpg,.jpeg,.png,.webp"></label>':''}
        <div data-gallery class="hr-gallery"></div><p class="hr-muted">Los archivos se guardan de forma privada y compartida para el equipo autorizado. Los formatos finales de exportación se revisan antes de publicar.</p>
        </div><div class="hr-drawer-footer"><span>Guardar aquí no publica en Meta.</span><button type="button" data-close>Cerrar</button><button type="submit" class="hr-primary">Guardar contenido</button></div></form>`;
        if(busy){dialog.querySelector('.hr-drawer-body').inert=true;dialog.querySelector('.hr-drawer-footer').inert=true;}
        renderGallery();
    }
    function readForm(){
        const form=dialog.querySelector('form');if(!form)return selected;
        const value=name=>form.elements.namedItem(name)?.value;
        const channels=[...form.querySelectorAll('[name="channels"]:checked')].map(x=>x.value);
        return {...selected,title:value('title').trim(),date:value('date'),time:value('time')||null,content_type:value('content_type'),format:value('format'),story_kind:value('content_type')==='historia'?value('story_kind')||'diaria':null,owner:value('owner').trim(),copy:value('copy'),workflow_status:value('workflow_status'),channels};
    }
    function updateData(id,data){rows=rows.filter(r=>r.id!==id);if(data.post)rows.push(data.post);assets=assets.filter(a=>a.post_id!==id).concat(data.assets);}
    async function persist(){
        if(!dialog.querySelector('form').reportValidity())throw new Error('Completa los campos obligatorios.');
        const p=readForm();if(!p.channels.length)throw new Error('Selecciona Facebook, Instagram o ambos.');
        const g=generation, o=opening;
        const r=await api.save(p,selected.revision);
        if(g!==generation||o!==opening)throw new Error('La sesión cambió; vuelve a abrir el contenido.');
        selected={...p,...r,date:r.publish_date,time:r.publish_time};rows=rows.filter(x=>x.id!==r.id).concat(r);dirty=false;renderCalendar();return selected;
    }
    async function run(action){
        if(busy)return;busy=true;const g=generation,o=opening;dialog.setAttribute('aria-busy','true');dialog.classList.add('hr-busy');dialog.querySelectorAll('.hr-drawer-body,.hr-drawer-footer').forEach(el=>el.inert=true);drawerNote('Guardando…');
        try{await action();}catch(e){if(g===generation&&o===opening)drawerNote(e.message,true);}
        finally{if(g===generation&&o===opening){busy=false;dialog.removeAttribute('aria-busy');dialog.classList.remove('hr-busy');dialog.querySelectorAll('.hr-drawer-body,.hr-drawer-footer').forEach(el=>el.inert=false);}}
    }
    async function reloadSelected(){
        const id=selected.id,g=generation,o=opening;const data=await api.get(id);if(g!==generation||o!==opening)return false;
        updateData(id,data);selected={...selected,...getPost(id)};renderCalendar();drawPost();return true;
    }
    async function renderGallery(){
        if(!selected)return;const id=selected.id,o=opening,g=generation, gallery=dialog.querySelector('[data-gallery]');if(!gallery)return;
        const list=assetList(id);
        gallery.innerHTML=list.length?list.map((a,i)=>`<figure data-asset="${E(a.id)}"><div class="hr-preview">${a.state==='ready'?'<span>Cargando vista previa…</span>':'<span>Carga incompleta</span>'}</div><figcaption><strong>${E(a.filename)}</strong><span>${a.kind==='cover'?'Portada · ':''}${(a.bytes/1024/1024).toFixed(1)} MB</span></figcaption><div class="hr-asset-actions">${a.state==='ready'?`<button type="button" data-download="${E(a.id)}">Descargar</button><label class="hr-replace">Reemplazar<input type="file" data-replace="${E(a.id)}" accept="${a.mime.startsWith('video/')?'video/mp4,video/webm':'.jpg,.jpeg,.png,.webp'}"></label><button type="button" data-up="${E(a.id)}" aria-label="Mover antes" ${i===0?'disabled':''}>↑</button><button type="button" data-down="${E(a.id)}" aria-label="Mover después" ${i===list.length-1?'disabled':''}>↓</button>`:''}<button type="button" data-remove="${E(a.id)}">${a.state==='ready'?'Retirar':'Retirar carga incompleta'}</button></div></figure>`).join(''):'<div class="hr-empty">Todavía no hay archivos adjuntos.</div>';
        for(const a of list.filter(a=>a.state==='ready')){
            try{
                const url=await api.signed(a);if(g!==generation||o!==opening||selected?.id!==id||!gallery.isConnected)return;
                const wrap=gallery.querySelector(`[data-asset="${a.id}"] .hr-preview`);if(!wrap)continue;
                const media=document.createElement(a.mime.startsWith('video/')?'video':'img');media.src=url;
                if(media.tagName==='VIDEO'){media.controls=true;media.preload='metadata';}else{media.alt=a.filename;media.loading='lazy';}
                wrap.replaceChildren(media);
            }catch(e){const wrap=gallery.querySelector(`[data-asset="${a.id}"] .hr-preview`);if(wrap)wrap.textContent='Vista previa no disponible. Cierra y vuelve a abrir la ficha.';}
        }
        clearTimeout(signedTimer);signedTimer=setTimeout(()=>{if(dialog.open&&selected?.id===id&&!busy)renderGallery();},12*60*1000);
    }
    async function addFiles(input){
        const files=[...input.files];if(!files.length)return;
        const old=input.dataset.replace?assets.find(a=>a.id===input.dataset.replace):null,kind=old?.kind||input.dataset.upload||'media';
        const captured=!!dialog.querySelector('[data-captured]')?.checked;
        await run(async()=>{
            const p=readForm();files.forEach(f=>C.validateFile(f,p,kind,captured));
            // Uploading material reopens review, including replacement of previously ready content.
            dialog.querySelector('[name="workflow_status"]').value='material_pendiente';
            await persist();const g=generation,o=opening;let completed=0;
            try{
                for(const file of files){
                    if(g!==generation||o!==opening)return;
                    drawerNote(`Subiendo ${++completed} de ${files.length}: ${file.name}`);
                    await api.upload(selected,file,{kind,captured,position:old?.position??assetList(selected.id).length+completed-1});
                }
                if(old)await api.remove(old);
            }catch(e){if(g===generation&&o===opening){await reloadSelected();throw new Error(`${e.message} Los archivos que ya se guardaron permanecen en la ficha.`);}return;}
            if(g===generation&&o===opening&&await reloadSelected())drawerNote('Archivos guardados. Ya están disponibles para el equipo.');
        });input.value='';
    }
    function close(){if(busy)return;if(dirty&&!window.confirm('Hay cambios de texto sin guardar. ¿Cerrar y descartarlos?'))return;privacySuspended=false;privacyFocus=null;dialog.close();selected=null;dirty=false;++opening;clearTimeout(signedTimer);lastFocus?.focus();}
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.addEventListener('submit',e=>{e.preventDefault();if(!readOnly)run(async()=>{await persist();drawPost();drawerNote('Contenido guardado.');});});
    dialog.addEventListener('input',e=>{if(!readOnly&&e.target.name)dirty=true;});
    dialog.addEventListener('change',e=>{
        if(readOnly)return;
        if(e.target.matches('[data-upload],[data-replace]')){addFiles(e.target);return;}
        if(['content_type','format','story_kind','date'].includes(e.target.name)){
            const p=readForm();if(e.target.name==='content_type'){p.format=p.content_type==='reel'?'Video':'Foto';p.story_kind=p.content_type==='historia'?'diaria':null;}
            selected=p;dirty=true;drawPost();
        }else if(e.target.name)dirty=true;
    });
    dialog.addEventListener('click',e=>{
        const b=e.target.closest('button');if(!b||busy)return;
        if(b.hasAttribute('data-close')){close();return;}
        if(b.dataset.campaign){filters={...defaults(),campaign:b.dataset.campaign};view='campanas';close();shell();return;}
        if(readOnly)return;
        if(b.hasAttribute('data-share-copy')){navigator.clipboard?.writeText(shareURL()).then(()=>drawerNote('Enlace copiado. Puedes enviarlo por WhatsApp o correo.')).catch(()=>drawerNote('Selecciona el enlace y cópialo manualmente.',true));if(!navigator.clipboard)drawerNote('Selecciona el enlace y cópialo manualmente.',true);return;}
        if(b.dataset.shareChange){
            const action=b.dataset.shareChange;
            if(action==='rotate'&&!window.confirm('¿Cambiar el enlace? El anterior dejará de funcionar.'))return;
            const g=generation,o=opening;run(async()=>{const state=await api.changeShare(shareState,action!=='disable');if(g!==generation||o!==opening)return;shareState=state;drawShare();drawerNote(action==='disable'?'Enlace desactivado.':'Enlace de solo lectura activado.');});return;
        }
        if(b.hasAttribute('data-copy')){const text=readForm().copy||'';if(!navigator.clipboard){drawerNote('Selecciona el texto y cópialo manualmente.',true);return;}navigator.clipboard.writeText(text).then(()=>drawerNote('Texto copiado.')).catch(()=>drawerNote('No se pudo copiar. Selecciona el texto y cópialo manualmente.',true));return;}
        const id=b.dataset.remove||b.dataset.download||b.dataset.up||b.dataset.down,a=assets.find(a=>a.id===id);if(!a)return;
        if(b.dataset.download){run(async()=>{const url=await api.signed(a,true);const link=document.createElement('a');link.href=url;link.download=a.filename;link.rel='noopener';link.target='_blank';document.body.append(link);link.click();link.remove();drawerNote('Descarga solicitada.');});}
        else if(b.dataset.remove){if(!window.confirm(`¿Retirar «${a.filename}» de este contenido?`))return;run(async()=>{if(dirty)await persist();await api.remove(a);if(await reloadSelected())drawerNote('Archivo retirado. El contenido vuelve a material pendiente.');});}
        else{run(async()=>{if(dirty)await persist();const list=assetList(a.post_id).filter(a=>a.state==='ready'),n=list.findIndex(x=>x.id===a.id),to=n+(b.dataset.up?-1:1);if(to<0||to>=list.length)return;[list[n],list[to]]=[list[to],list[n]];await api.reorder(a.post_id,list.map(a=>a.id));if(await reloadSelected())drawerNote('Orden guardado.');});}
    });
    function reset(){generation++;opening++;rows=[];assets=[];api=null;loaded=false;selected=null;shareState=null;privacySuspended=false;privacyFocus=null;dirty=false;busy=false;clearTimeout(signedTimer);dialog.close();dialog.innerHTML='';dialog.classList.remove('hr-busy');dialog.removeAttribute('aria-busy');shell();note('Inicia sesión para acceder al contenido compartido.');}
    window.addEventListener('haiku:auth-ready',()=>{if(!readOnly&&section.classList.contains('hr-social-active'))init();});
    let subscribed=false;
    function subscribe(){if(subscribed||!window.haikuSupabase)return;subscribed=true;let user=window.haikuSesion?.auth?.id||null;window.haikuSupabase.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(user&&session?.user?.id!==user))reset();user=session?.user?.id||null;});}
    if(!readOnly){document.addEventListener('haiku:supabase-ready',subscribe);subscribe();shell();}
    else{init();setInterval(()=>{if(loaded&&!document.hidden)refresh(true);},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&loaded)refresh(true);});window.addEventListener('hashchange',()=>{loaded=false;rows=[];assets=[];selected=null;++opening;dialog.close();clearTimeout(signedTimer);init();});}
    window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
})();
