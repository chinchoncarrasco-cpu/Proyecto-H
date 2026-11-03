// Repaso tiene revisión, ítems y borradores propios. No escribe la revisión completa.
(() => {
    'use strict';
    const profile = window.HAIKU_REPASO_CHECKLIST_V1;
    if (!profile) return;
    const fields = { living: 'detalle_living_cama', kitchen: 'detalle_cocina', bathroom: 'detalle_bano', terrace: 'detalle_terraza', observations: 'observaciones' };
    const columns = 'id,fecha,cabana_id,tipo_revision,estado,resultado,observaciones,detalle_cocina,detalle_bano,detalle_living_cama,detalle_terraza,creado_en';
    const labels = { en_curso:'En curso',lista_para_revisar:'Lista para revisar', pendiente: 'Pendiente', en_revision: 'En revisión', 'con-detalles': 'Con detalles', lista: 'Lista', no_requiere: 'No requiere' };
    const cache = new Map(), queues = new Map(), creating = new Map(), drafts = new Map(), timers = new Map();
    let sessionUser = '', opened = null, catalog = new Map(), cabins = [], epoch = 0, sequence = 0;
    const user = () => String(window.haikuSesion?.auth?.id || '');
    const date = () => { try { return String(fechaSeleccionada || ''); } catch (_) { return ''; } };
    const client = () => window.haikuSupabase;
    const key = (fecha, numero) => `${user()}:${fecha}:${numero}`;
    const root = () => document.getElementById('repaso-individual');
    const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const empty = () => ({ revision: null, checked: [] });
    const status = row => row?.estado === 'en_proceso' ? 'en_revision' : row?.estado === 'completada'
        ? row.resultado === 'lista' ? 'lista' : ['con_detalles', 'no_lista'].includes(row.resultado) ? 'con-detalles' : 'pendiente' : 'pendiente';
    function statusPatch(value) {
        const completed = ['lista', 'con-detalles'].includes(value);
        return { estado: completed ? 'completada' : value === 'en_revision' ? 'en_proceso' : 'pendiente',
            resultado: completed ? value === 'lista' ? 'lista' : 'con_detalles' : null,
            finalizado_en: completed ? new Date().toISOString() : null };
    }
    function record(fecha, numero) { return cache.get(key(fecha, numero)) || empty(); }
    function projected(fecha, numero) {
        const current = record(fecha, numero), copy = { revision: { ...current.revision }, checked: [...current.checked] };
        for (const q of queues.values()) if (q.context.key === key(fecha, numero)) apply(copy, q.field, q.desired);
        for (const draft of drafts.values()) if (draft.context.key === key(fecha, numero)) copy.revision[fields[draft.field]] = draft.value;
        return copy;
    }
    function apply(data, field, value) {
        if (field.startsWith('check:')) {
            const id = field.slice(6); data.checked = data.checked.filter(x => x !== id); if (value) data.checked.push(id);
            Object.assign(data.revision ||= {}, statusPatch('en_revision'));
        } else if (field === 'status') Object.assign(data.revision ||= {}, statusPatch(value));
        else (data.revision ||= {})[fields[field]] = value;
    }
    function publish(fecha, numero) {
        if (fecha !== date() || typeof obtenerDatosDia !== 'function') return;
        const value = projected(fecha, numero), data = obtenerDatosDia(fecha);
        const cabin = data.cabanas[numero] ||= {};
        cabin.repasoRevision = { fecha, verificado: true, ...value.revision, checked: [...value.checked] };
        window.HAIKU_CABANAS_SITES_V1?.actualizarEstadoCabana?.(numero);
        if (opened?.key === key(fecha, numero)) render();
    }
    async function prepare({ fecha }) {
        const version = sequence, currentEpoch = epoch;
        const results = await Promise.all([
            client().from('cabanas').select('id,numero').eq('activa', true),
            client().from('checklist_items').select('id,nombre,categoria').eq('activo', true).in('categoria', profile.sections.map(s => s.category)),
            client().from('revisiones_cabana').select(columns).eq('fecha', fecha).eq('tipo_revision', 'repaso').neq('estado', 'cancelada').order('creado_en', {ascending:false})
        ]);
        results.forEach(r => { if (r.error) throw r.error; });
        const mapping = new Map();
        for (const section of profile.sections) for (const item of section.items) {
            const matches = results[1].data.filter(r => r.categoria === section.category && r.nombre === item.label);
            if (matches.length !== 1) throw new Error('No se pudo cargar la lista de Repaso. Vuelve a intentarlo.');
            mapping.set(item.id, matches[0].id);
        }
        const revisions = results[2].data || [], ids = revisions.map(r => r.id);
        let items = [];
        if (ids.length) {
            const response = await client().from('revision_items').select('revision_id,checklist_item_id,estado').in('revision_id', ids);
            if (response.error) throw response.error;
            items = response.data || [];
        }
        return { version, epoch: currentEpoch, cabins: results[0].data || [], mapping, revisions, items };
    }
    function accept(fecha, data) {
        if (!data || data.epoch !== epoch || data.version !== sequence) return;
        catalog = data.mapping; cabins = data.cabins;
        const reverse = new Map([...catalog].map(([a,b]) => [b,a]));
        for (const cabin of cabins) {
            const revision = data.revisions.find(r => r.cabana_id === cabin.id) || null;
            const checked = revision ? data.items.filter(i => i.revision_id === revision.id && i.estado === 'ok').map(i => reverse.get(i.checklist_item_id)).filter(Boolean) : [];
            cache.set(key(fecha, cabin.numero), { revision, checked });
            publish(fecha, String(cabin.numero));
        }
    }
    async function hydrate(fecha = date()) {
        if (!client() || !user() || !fecha) return;
        accept(fecha, await prepare({fecha}));
    }
    async function ensure(context) {
        if (context.user !== user()) throw new Error('La sesión cambió. Abre nuevamente la revisión.');
        const cached = record(context.fecha, context.numero).revision;
        if (cached?.id) return cached;
        if (creating.has(context.key)) return creating.get(context.key);
        const promise = (async () => {
            if (!cabins.length || !catalog.size) await hydrate(context.fecha);
            const cabin = cabins.find(c => String(c.numero) === context.numero);
            if (!cabin) throw new Error('No se encontró la cabaña para guardar Repaso.');
            const find = () => client().from('revisiones_cabana').select(columns).eq('fecha', context.fecha).eq('cabana_id', cabin.id).eq('tipo_revision','repaso').neq('estado','cancelada').order('creado_en',{ascending:false}).limit(1).maybeSingle();
            let response = await find(); if (response.error) throw response.error;
            if (!response.data) {
                response = await client().from('revisiones_cabana').insert({fecha:context.fecha,cabana_id:cabin.id,tipo_revision:'repaso',estado:'pendiente',revisado_por:context.user}).select(columns).single();
                if (response.error) { const recovered = await find(); if (!recovered.data) throw response.error; response = recovered; }
            }
            if (context.user !== user()) throw new Error('La sesión cambió.');
            const old = record(context.fecha,context.numero);
            cache.set(context.key, { ...old, revision: response.data }); return response.data;
        })();
        creating.set(context.key,promise);
        try { return await promise; } finally { creating.delete(context.key); }
    }
    function context(fecha,numero) { return {fecha,numero:String(numero),user:user(),key:key(fecha,numero),epoch}; }
    function enqueue(ctx,field,value) {
        if (ctx.user !== user() || ctx.epoch !== epoch) return Promise.reject(new Error('La sesión cambió.'));
        const id = `${ctx.key}:${field}`;
        let q = queues.get(id);
        if (q) q.desired = value;
        else { q = {context:ctx,field,desired:value,waiters:[],running:false}; queues.set(id,q); }
        ++sequence;
        const promise = new Promise((resolve,reject) => q.waiters.push({resolve,reject}));
        publish(ctx.fecha,ctx.numero);
        void drain(ctx);
        return promise;
    }
    const draining = new Set();
    async function drain(ctx) {
        if (draining.has(ctx.key)) return;
        draining.add(ctx.key);
        try {
            let q;
            while ((q = [...queues.values()].find(x => x.context.key === ctx.key))) {
                const id = `${ctx.key}:${q.field}`, value = q.desired;
                try {
                    const revision = await ensure(ctx);
                    if (ctx.user !== user() || ctx.epoch !== epoch) throw new Error('La sesión cambió.');
                    if (q.field.startsWith('check:')) {
                        const item = catalog.get(q.field.slice(6));
                        if (!item) throw new Error('El ítem de Repaso aún no está disponible.');
                        const result = await client().from('revision_items').upsert({revision_id:revision.id,checklist_item_id:item,estado:value?'ok':'pendiente',revisado_en:new Date().toISOString()},{onConflict:'revision_id,checklist_item_id'});
                        if (result.error) throw result.error;
                        // El check ya es persistente aunque falle la actualización secundaria.
                        if (ctx.user === user()) { const saved = record(ctx.fecha,ctx.numero); saved.checked = saved.checked.filter(x => x !== q.field.slice(6)); if (value) saved.checked.push(q.field.slice(6)); }
                    }
                    const patch = q.field === 'status' ? statusPatch(value) : q.field.startsWith('check:') ? statusPatch('en_revision') : {[fields[q.field]]:value};
                    const result = await client().from('revisiones_cabana').update({...patch,revisado_por:ctx.user}).eq('id',revision.id).eq('fecha',ctx.fecha).eq('tipo_revision','repaso').select('id').single();
                    if (result.error || result.data?.id !== revision.id) throw result.error || new Error('No se pudo confirmar Repaso.');
                    if (ctx.user !== user() || ctx.epoch !== epoch) throw new Error('La sesión cambió.');
                    const saved = record(ctx.fecha,ctx.numero); Object.assign(saved.revision,patch);
                    if (q.desired !== value) continue;
                    queues.delete(id); q.waiters.forEach(w=>w.resolve());
                } catch (error) {
                    if (q.desired !== value && ctx.user === user() && ctx.epoch === epoch) continue;
                    if (queues.get(id) === q) queues.delete(id);
                    q.waiters.forEach(w=>w.reject(error));
                    if (ctx.user === user() && ctx.epoch === epoch) showError(error);
                }
                ++sequence;
                if (ctx.user === user() && ctx.epoch === epoch) publish(ctx.fecha,ctx.numero);
            }
        } finally {
            draining.delete(ctx.key);
            if (ctx.user === user() && ctx.epoch === epoch && ctx.fecha === date()) {
                void hydrate(ctx.fecha).catch(showError);
            }
        }
    }
    function showError(error) { const message = root()?.querySelector('[data-repaso-error]'); if(message) message.textContent = error.message || 'No fue posible guardar. Intenta nuevamente.'; }
    function render() {
        const host = root(); if (!host || !opened || opened.fecha !== date() || opened.user !== user()) return;
        const ctx = opened, data = projected(ctx.fecha,ctx.numero);
        const list = host.querySelector('#repaso-checklist');
        if (list.dataset.owner !== ctx.key) {
            list.dataset.owner = ctx.key;
            list.innerHTML = profile.sections.map(s => `<section class="checklist-area cb-sector"><button type="button" class="cb-sector-head" aria-expanded="false"><span><strong>${esc(s.title)}</strong><small data-repaso-count="${s.id}"></small></span><span aria-hidden="true">+</span></button><div class="cb-sector-body" hidden><div class="checklist-items cb-group">${s.items.map(i=>`<label class="checklist-item cb-check"><input type="checkbox" data-repaso-item="${i.id}"><span>${esc(i.label)}</span></label>`).join('')}</div><div class="checklist-section-detail"><label class="checklist-section-detail-label" for="repaso-detail-${s.id}">DETALLE:</label><button type="button" class="checklist-section-detail-copy" data-repaso-copy="${s.id}" aria-label="Copiar detalle de ${esc(s.title)}" title="Copiar detalle de ${esc(s.title)}"><svg class="copy-icon copy-icon-default" viewBox="0 0 20 20" aria-hidden="true"><rect x="6.5" y="6.5" width="9" height="10" rx="1.5"></rect><path d="M4.5 13.5h-1a1.5 1.5 0 0 1-1.5-1.5V3.5A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5v1"></path></svg><svg class="copy-icon copy-icon-success" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10.5 3.5 3.5L16 5.5"></path></svg></button><span class="checklist-section-detail-copy-status" aria-live="polite" aria-atomic="true"></span><textarea class="checklist-section-detail-input" id="repaso-detail-${s.id}" data-repaso-text="${s.id}" rows="3"></textarea></div></div></section>`).join('');
        }
        host.querySelector('#repaso-count').textContent = `${data.checked.length}/26`;
        for(const input of list.querySelectorAll('[data-repaso-item]')) input.checked = data.checked.includes(input.dataset.repasoItem);
        for(const s of profile.sections) host.querySelector(`[data-repaso-count="${s.id}"]`).textContent = `${s.items.filter(i=>data.checked.includes(i.id)).length}/${s.items.length} revisados`;
        for(const input of host.querySelectorAll('[data-repaso-text]')) {
            const field = input.dataset.repasoText;
            const stored = readDraft(ctx,field);
            const value = stored ?? data.revision?.[fields[field]] ?? '';
            if(document.activeElement !== input && input.value !== value) input.value = value;
        }
        const cabin = typeof obtenerDatosDia === 'function' ? obtenerDatosDia(ctx.fecha)?.cabanas?.[ctx.numero] || {} : {};
        const api = window.HAIKU_CABANAS_SITES_V1;
        const noNeed = api?.estadoAseo(cabin) === 'no_requiere';
        const selector = host.querySelector('#repaso-status');
        setStatusDisplay(selector,noNeed,status(data.revision));
        host.querySelector('#repaso-final').textContent = labels[api?.estadoFinal(cabin,ctx.fecha,ctx.numero)] || 'Pendiente';
    }
    function setStatusDisplay(selector,noNeed,value) {
        if (!selector) return;
        let option = selector.querySelector('option[value="no_requiere"]');
        if(noNeed && !option) { option = document.createElement('option'); option.value='no_requiere'; option.textContent='No requiere'; selector.appendChild(option); }
        selector.disabled = noNeed;
        selector.value = noNeed ? 'no_requiere' : value;
        if(!noNeed) option?.remove();
    }
    const draftKey = (ctx,field) => `haku:repaso:draft:${ctx.key}:${field}`;
    function readDraft(ctx,field) {
        const own = drafts.get(`${ctx.key}:${field}`); if(own) return own.value;
        try { return localStorage.getItem(draftKey(ctx,field)); } catch (_) { return null; }
    }
    function edit(ctx,field,value) {
        const id = `${ctx.key}:${field}`; const draft = {context:ctx,field,value}; drafts.set(id,draft);
        try { localStorage.setItem(draftKey(ctx,field),value); } catch (_) {}
        clearTimeout(timers.get(id)); timers.set(id,setTimeout(()=>saveDraft(draft),450));
    }
    async function saveDraft(draft) {
        const {context:ctx,field,value} = draft, id = `${ctx.key}:${field}`;
        clearTimeout(timers.get(id)); timers.delete(id);
        try { await enqueue(ctx,field,value); if(drafts.get(id) === draft) { drafts.delete(id); localStorage.removeItem(draftKey(ctx,field)); } }
        catch (_) { /* El borrador se conserva para reintentar, sin borrar la escritura. */ }
    }
    async function open(numero,fecha=date()) {
        opened=context(fecha,numero); render();
        try { await hydrate(fecha); if(opened?.key === key(fecha,numero)) render(); } catch(error) { showError(error); }
    }
    async function copy(text) {
        if(!text.trim()) return;
        try { await navigator.clipboard.writeText(text); }
        catch (_) {
            const focus=document.activeElement, input=document.createElement('textarea'); input.value=text; input.style.position='fixed'; input.style.top='0'; document.body.appendChild(input); input.select();
            const ok=document.execCommand('copy'); input.remove(); focus?.focus({preventScroll:true}); if(!ok) throw new Error('No fue posible copiar. Intenta nuevamente.');
        }
    }
    function install() {
        const host=root(); if(!host) return;
        host.addEventListener('click',async event=>{
            const head=event.target.closest('.cb-sector-head');
            if(head) { const expanded=head.getAttribute('aria-expanded')!=='true'; head.setAttribute('aria-expanded',String(expanded)); head.querySelector('span:last-child').textContent=expanded?'−':'+'; head.parentElement.querySelector('.cb-sector-body').hidden=!expanded; event.stopPropagation(); return; }
            const button=event.target.closest('[data-repaso-copy], [data-repaso-paste]'); if(!button || !opened) return;
            try {
                if(button.hasAttribute('data-repaso-paste')) {
                    const target = {...opened}; const text=await navigator.clipboard.readText(); if (opened?.key !== target.key) return; const input=host.querySelector('[data-repaso-text="observations"]'); input.value=text; edit(target,'observations',text); return;
                }
                const field=button.dataset.repasoCopy, input=host.querySelector(`[data-repaso-text="${field}"]`), heading=profile.sections.find(s=>s.id===field)?.title;
                const text = input?.value || '';
                if (!text.trim()) return;
                await copy(`${heading?`${heading}\n`:''}${text}`);
                if (button.classList.contains('checklist-section-detail-copy')) {
                    mostrarFeedbackCopiaDetalle(button, 'copiado', 'Copiado', `Copiar detalle de ${heading}`, `Detalle de ${heading} copiado`);
                } else { button.textContent='Copiado'; setTimeout(()=>{button.textContent='Copiar';},1300); }
            } catch(error) { showError(error); }
        });
        host.addEventListener('input',event=>{if(opened && event.target.dataset.repasoText) edit({...opened},event.target.dataset.repasoText,event.target.value);});
        host.addEventListener('focusout',event=>{const field=event.target.dataset.repasoText; if(opened&&field){const draft=drafts.get(`${opened.key}:${field}`);if(draft)void saveDraft(draft);}});
        host.addEventListener('change',event=>{
            if(!opened) return;
            const field=event.target.dataset.repasoItem;
            if(field) void enqueue({...opened},`check:${field}`,event.target.checked).catch(()=>{});
            if(event.target.id==='repaso-status') void enqueue({...opened},'status',event.target.value).catch(()=>{});
        });
        window.HAIKU_RESUMEN_REFRESH_V1?.registrar('repaso',{orden:71,obligatoria:false,preparar:prepare,publicar:snapshot=>accept(snapshot.fecha,snapshot.datos.repaso)});
    }
    window.HAIKU_REPASO_V2=Object.freeze({abrir:open,hidratar:hydrate,pintar:render,guardarEstadoRevision:(numero,value,fecha=date())=>enqueue(context(fecha,numero),'status',value),proyectar:projected});
    sessionUser = user();
    window.addEventListener('haiku:auth-ready',()=>{if (sessionUser === user()) return; sessionUser = user(); ++epoch; ++sequence; cache.clear(); catalog.clear(); cabins=[]; opened=null; queues.forEach(q=>q.waiters.forEach(w=>w.reject(new Error('La sesión cambió.'))));queues.clear();drafts.clear();timers.forEach(clearTimeout);timers.clear();});
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
