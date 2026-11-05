/* Checkout UI. Scoped to its panel; never publishes application-wide refresh events. */
(() => {
  'use strict';
  const V=window.HAIKU_CHECKOUT_WORKFLOW_V2;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cameraIcon='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5l1.5-2h5L16 5h4a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2h4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="4" stroke="currentColor" stroke-width="1.5"/></svg>';
  const chevron='<svg width="11" height="7" viewBox="0 0 12 8" fill="none" aria-hidden="true"><path d="M1 1l5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const photoSources=()=>'<div class="co-photo-sources" data-photo-sources hidden><button type="button" class="co-button" data-take-photo>Tomar foto</button><button type="button" class="co-button" data-attach-photo>Adjuntar foto</button></div><input type="file" name="foto" accept="image/*" hidden><div data-camera-preview hidden><video autoplay playsinline muted class="co-photo"></video><button type="button" class="co-button" data-capture-photo>Capturar</button><button type="button" class="co-link" data-camera-stop>Cancelar cámara</button></div><p class="co-small" data-photo-name></p>';
  const stamp=()=> 'obs_'+crypto.randomUUID().replace(/-/g,'');
  const counter=(name,value,min=0,max=99)=>`<div class="co-counter"><button type="button" data-step="-1" data-counter="${esc(name)}" aria-label="Restar ${esc(name)}">−</button><input aria-label="Cantidad de ${esc(name)}" name="${esc(name)}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${value}"><button type="button" data-step="1" data-counter="${esc(name)}" aria-label="Sumar ${esc(name)}">+</button></div>`;
  const chip=(label,attrs='',selected=false)=>`<button type="button" class="co-chip${selected?' is-selected':''}" aria-pressed="${selected}" ${attrs}>${esc(label)}</button>`;
  const areas=()=>V.sectors.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('');
  function number(input,min=0,max=99){const n=Number(input?.value);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`Escribe una cantidad entre ${min} y ${max}.`);return n;}
  function dialog(ctx,kind,initial={}) {
    const el=document.createElement('dialog');el.className='co-dialog';el.setAttribute('aria-label','Revisión de salida');
    let busy=false,formKind=kind,chosen=initial.loan||null,observation=initial.observation||null,photo=null,stream=null,cameraRequest=0;
    const originalUser=ctx.user();
    function assertCurrent(){if(!originalUser||ctx.user()!==originalUser||!ctx.current())throw new Error('La fecha, la estadía o la sesión cambió. Abre nuevamente la ficha.');}
    function stopCamera(){cameraRequest++;stream?.getTracks().forEach(t=>t.stop());stream=null;const preview=el.querySelector('[data-camera-preview]');if(preview)preview.hidden=true;}
    function close(){if(busy)return;stopCamera();el.close?.();el.remove();ctx.closed?.();}
    function fail(e){const node=el.querySelector('[data-dialog-error]');if(node)node.textContent=e.message||String(e);}
    function form(){return el.querySelector('form');}
    function input(name){return form().querySelector('[name="'+name+'"]');}
    async function submit(action,done=close){if(busy)return;busy=true;for(const b of el.querySelectorAll('button'))b.disabled=true;try{assertCurrent();await action();assertCurrent();busy=false;done();}catch(e){fail(e);}finally{busy=false;for(const b of el.querySelectorAll('button'))b.disabled=b.hasAttribute('data-locked');}}
    function render(next=formKind,options={}) {
      formKind=next;if(options.loan!==undefined)chosen=options.loan;
      const row=ctx.record();let title='',html='';
      if(next==='quantity'){
        const group=initial.id==='amenities',keys=group?V.amenities:[initial.id];title=group?'Amenities':V.supplies.find(i=>i.id===initial.id)?.label||'Cantidad';
        html=group?keys.map(id=>`<div class="co-form-row"><label>${esc(V.supplies.find(i=>i.id===id).label)}</label>${counter(id,row.reposiciones[id]||0)}</div>`).join('')+`<div class="co-form-row"><div class="co-chips">${[1,2].map(q=>chip(q+' de cada',`data-all-qty="${q}"`)).join('')}</div><span class="co-small" data-total></span></div>`
          :`<p class="co-small">Unidades a reponer</p><div class="co-form-row"><div class="co-chips">${[1,2,3,4].map(q=>chip(q,`data-qty="${q}"`,(row.reposiciones[initial.id]||1)===q)).join('')}</div>${counter(initial.id,row.reposiciones[initial.id]||1)}</div>`;
        html+='<div class="co-actions"><button type="button" class="co-button" data-remove-quantity>Quitar</button><button class="co-button co-primary" type="submit">Listo</button></div>';
      }else if(next==='loans'){
        title='Préstamos · CAB '+ctx.cabin;
        const loans=ctx.loans();html=loans.length?loans.map(l=>`<div class="co-loan-manage"><div><strong>${esc(l.label)}</strong><span>${l.cantidad===null?'Cantidad por confirmar':l.devueltos+' / '+l.cantidad}</span></div><div><small>${l.origen==='manual'?'Manual':'Notas'}</small><button type="button" class="co-link" data-edit-loan="${esc(l.id)}">Editar</button></div></div>`).join(''):'<p class="co-small">Sin préstamos detectados. Puedes añadir uno.</p>';
        html+='<button type="button" class="co-button co-primary" data-add-loan>+ Préstamo</button><p class="co-small">Puedes corregir cantidad o quitar una detección.</p>';
      }else if(next==='loan'){
        title=chosen?'Editar préstamo':'+ Préstamo';
        html=`<p class="co-small">CAB ${esc(ctx.cabin)} · esta reserva</p><label class="co-form-label">Artículo<input name="label" maxlength="80" required placeholder="Buscar o escribir artículo" value="${esc(chosen?.label||'')}"></label><input name="item_id" type="hidden" value="${esc(chosen?.id||'')}">`
          +(!chosen?`<div class="co-chips" data-catalog>${V.catalog.slice(0,6).map(l=>chip(l.label,`data-pick-loan="${l.id}"`)).join('')}</div>`:'')
          +`<p class="co-small" data-existing></p><div class="co-form-row"><label>Cantidad</label>${counter('cantidad',chosen?.cantidad||1,1)}</div><label class="co-form-label">Área<select name="area">${areas()}</select></label><p class="co-small">${chosen?.origen==='notas'?'El ajuste conserva las notas originales.':'Queda guardado como préstamo manual.'}</p><div class="co-actions"><button type="button" class="co-button" ${chosen?'data-remove-loan':'data-loans-back'}>${chosen?'Quitar':'Cancelar'}</button><button class="co-button co-primary" type="submit">${chosen?'Guardar':'Añadir'}</button></div>`;
      }else if(next==='return'){
        title=chosen.label+' · devolución';html=`<div class="co-form-row"><label>Devueltos de ${chosen.cantidad}</label>${counter('devueltos',chosen.devueltos,0,chosen.cantidad)}</div><div class="co-actions"><button type="button" class="co-button" data-return-all>Todo devuelto</button><button class="co-button co-primary" type="submit">Listo</button></div>`;
      }else if(next==='observation'){
        observation=observation||{id:stamp(),tipo:initial.type||'dano',area:initial.area||null,texto:'',foto_path:null};title='Observación';
        html=`<div class="co-form-row"><label class="co-form-label">Tipo<select name="tipo">${V.observationTypes.map(t=>`<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select></label><label class="co-form-label">Área<select name="area"><option value="">General</option>${areas()}</select></label></div><div class="co-evidence-input"><textarea name="texto" aria-label="Nota de observación" maxlength="1000" rows="3" placeholder="Nota breve, solo si hace falta…">${esc(observation.texto)}</textarea><button type="button" class="co-camera" data-photo-options aria-label="Añadir evidencia fotográfica">${cameraIcon}</button></div>${photoSources()}${observation.foto_path?'<button type="button" class="co-link" data-download-photo>Descargar foto</button>':''}<div class="co-actions"><button type="button" class="co-button" ${initial.observation?'data-remove-observation':'data-dialog-close'}>${initial.observation?'Quitar':'Cancelar'}</button><button class="co-button co-primary" type="submit">Guardar</button></div>`;
      }else if(next==='detailPhoto'){
        title='Foto · '+V.sectors.find(s=>s.id===initial.area).title;
        const saved=ctx.record().detalles?.[initial.area]?.foto_path;
        html=`<div class="co-evidence-input co-photo-picker"><small>Evidencia de la nota</small><button type="button" class="co-camera" data-photo-options aria-label="Añadir evidencia fotográfica">${cameraIcon}</button></div>${photoSources()}${saved?'<div class="co-actions"><button type="button" class="co-button" data-download-photo>Descargar foto</button><button type="button" class="co-button" data-remove-area-photo>Quitar foto</button></div>':''}<div class="co-actions"><button type="button" class="co-button" data-dialog-close>Cancelar</button><button type="submit" class="co-button co-primary">Guardar foto</button></div>`;
      }else if(next==='photo'){
        title='Foto';html=`<img class="co-photo" src="${esc(initial.uri)}" alt="Foto de observación">`;
      }
      el.innerHTML=`<div class="co-dialog-head"><h3>${esc(title)}</h3><button type="button" class="co-close" data-dialog-close aria-label="Cerrar ${esc(title)}">×</button></div><form novalidate>${html}<p class="co-error" role="alert" data-dialog-error></p></form>`;
      if(next==='loan')input('area').value=chosen?.area||'cocina';
      if(next==='observation'){input('tipo').value=observation.tipo;input('area').value=observation.area||'';}
      if(next==='detailPhoto')el.querySelector('[data-photo-sources]').hidden=false;
      if(next==='quantity')updateTotal();
      if(ctx.editable?.()===false)for(const b of el.querySelectorAll('[data-add-loan],[data-edit-loan]')){b.disabled=true;b.setAttribute('data-locked','');}
    }
    function updateTotal(){const t=el.querySelector('[data-total]');if(t)t.textContent='Total '+V.amenities.reduce((sum,id)=>sum+(Number(input(id)?.value)||0),0);}
    function chooseLoan(item){input('item_id').value=item?.id||'';if(item){input('label').value=item.label;const old=ctx.loans().find(l=>l.id===item.id);input('cantidad').value=String(old?.cantidad||1);input('area').value=old?.area||item.area;el.querySelector('[data-existing]').textContent=old?'Ya existe: se actualizará su cantidad.':'';}}
    async function saveObservation(remove=false){let uploaded=null;try{
      if(remove){await ctx.save('observacion',{id:observation.id,borrar:true});if(observation.foto_path)void removePhoto(observation.foto_path,ctx.user()).catch(()=>undefined);return;}
      if(photo)uploaded=await uploadPhoto(ctx,observation.id,photo,assertCurrent);
      const value={id:observation.id,tipo:input('tipo').value,area:input('area').value||null,texto:input('texto').value.trim(),foto_path:uploaded||observation.foto_path};
      V.validateMutation('observacion',value);await ctx.save('observacion',value);
      if(observation.foto_path&&uploaded&&observation.foto_path!==uploaded)void removePhoto(observation.foto_path,ctx.user()).catch(()=>undefined);
    }catch(e){if(uploaded)void removePhoto(uploaded,ctx.user()).catch(()=>undefined);throw e;}}
    async function saveAreaPhoto(remove=false){let uploaded=null;const old=ctx.record().detalles?.[initial.area]?.foto_path;try{
      if(!remove&&!photo)throw new Error('Toma o adjunta una foto.');
      if(!remove)uploaded=await uploadPhoto(ctx,'detalle_'+initial.area,photo,assertCurrent);
      assertCurrent();await ctx.save('detalle_foto',{id:initial.area,foto_path:uploaded});
      if(old)void removePhoto(old,ctx.user()).catch(()=>undefined);
    }catch(e){if(uploaded)void removePhoto(uploaded,ctx.user()).catch(()=>undefined);throw e;}}
    async function startCamera(){
      stopCamera();const request=cameraRequest;
      try{assertCurrent();if(!navigator.mediaDevices?.getUserMedia)throw new Error('La cámara no está disponible en este navegador. Puedes adjuntar una foto.');
        const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
        if(request!==cameraRequest||!el.isConnected||!ctx.current()){media.getTracks().forEach(t=>t.stop());return;}
        stream=media;const preview=el.querySelector('[data-camera-preview]');preview.hidden=false;preview.querySelector('video').srcObject=stream;
      }catch(e){fail(e);}
    }
    el.addEventListener('submit',e=>{e.preventDefault();if(busy)return;
      try{
        if(formKind==='quantity'){const ids=initial.id==='amenities'?V.amenities:[initial.id],value={items:Object.fromEntries(ids.map(id=>[id,number(input(id))]))};void submit(()=>ctx.save('reposicion',value));}
        else if(formKind==='loan'){
          const label=input('label').value.trim(),id=input('item_id').value||'otro_'+V.normalize(label).replace(/[^a-z0-9]+/g,'_').slice(0,56),existing=chosen||ctx.loans().find(l=>l.id===id);
          const value={id,label,cantidad:number(input('cantidad'),1),area:input('area').value,origen:existing?.origen||'manual'};V.validateMutation('prestamo',value);void submit(()=>ctx.save('prestamo',value),()=>render('loans'));
        }else if(formKind==='return'){const value={id:chosen.id,label:chosen.label,area:chosen.area,origen:chosen.origen,total:chosen.cantidad,cantidad:number(input('devueltos'),0,chosen.cantidad)};void submit(()=>ctx.save('devolucion',value));}
        else if(formKind==='observation')void submit(()=>saveObservation());
        else if(formKind==='detailPhoto')void submit(()=>saveAreaPhoto());
      }catch(error){fail(error);}
    });
    el.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||busy)return;
      if(b.hasAttribute('data-dialog-close'))close();
      else if(b.hasAttribute('data-photo-options')){const sources=el.querySelector('[data-photo-sources]');sources.hidden=!sources.hidden;}
      else if(b.hasAttribute('data-attach-photo'))input('foto').click();
      else if(b.hasAttribute('data-take-photo'))void startCamera();
      else if(b.hasAttribute('data-camera-stop'))stopCamera();
      else if(b.hasAttribute('data-capture-photo')){
        const video=el.querySelector('video');if(!video.videoWidth){fail(new Error('Espera a que la cámara esté lista.'));return;}
        const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
        canvas.toBlob(blob=>{if(!blob||!el.isConnected)return;photo=new File([blob],'Evidencia.jpg',{type:'image/jpeg'});el.querySelector('[data-photo-name]').textContent='Foto tomada';stopCamera();},'image/jpeg',0.9);
      }
      else if(b.hasAttribute('data-download-photo'))void downloadPhoto(ctx,formKind==='detailPhoto'?ctx.record().detalles?.[initial.area]?.foto_path:observation.foto_path).catch(fail);
      else if(b.hasAttribute('data-remove-area-photo'))void submit(()=>saveAreaPhoto(true));
      else if(b.dataset.counter){const n=input(b.dataset.counter),q=(Number(n.value)||0)+Number(b.dataset.step);n.value=String(Math.min(Number(n.max),Math.max(Number(n.min),q)));updateTotal();}
      else if(b.dataset.qty){input(initial.id).value=b.dataset.qty;for(const p of el.querySelectorAll('[data-qty]')){p.classList.toggle('is-selected',p===b);p.setAttribute('aria-pressed',String(p===b));}}
      else if(b.dataset.allQty){for(const id of V.amenities)input(id).value=b.dataset.allQty;updateTotal();}
      else if(b.hasAttribute('data-remove-quantity')){const ids=initial.id==='amenities'?V.amenities:[initial.id];void submit(()=>ctx.save('reposicion',{items:Object.fromEntries(ids.map(id=>[id,0]))}));}
      else if(b.hasAttribute('data-add-loan')){chosen=null;render('loan');}
      else if(b.dataset.editLoan)render('loan',{loan:ctx.loans().find(l=>l.id===b.dataset.editLoan)});
      else if(b.hasAttribute('data-loans-back'))render('loans');
      else if(b.hasAttribute('data-remove-loan'))void submit(()=>ctx.save('prestamo',{id:chosen.id,descartado:true}),()=>render('loans'));
      else if(b.dataset.pickLoan)chooseLoan(V.catalog.find(i=>i.id===b.dataset.pickLoan));
      else if(b.hasAttribute('data-return-all'))input('devueltos').value=String(chosen.cantidad);
      else if(b.hasAttribute('data-remove-observation'))void submit(()=>saveObservation(true));
    });
    el.addEventListener('input',e=>{if(formKind==='quantity')updateTotal();if(formKind==='loan'&&e.target.name==='label'&&!chosen){const value=V.normalize(e.target.value),known=V.catalog.find(l=>V.normalize(l.label)===value);input('item_id').value=known?.id||'';const list=el.querySelector('[data-catalog]');list.innerHTML=V.catalog.filter(l=>!value||V.normalize(l.label).includes(value)).slice(0,6).map(l=>chip(l.label,`data-pick-loan="${l.id}"`)).join('');}});
    el.addEventListener('change',e=>{if(e.target.name==='foto'){stopCamera();photo=e.target.files?.[0]||null;el.querySelector('[data-photo-name]').textContent=photo?.name||'';}});
    el.addEventListener('cancel',e=>{e.preventDefault();close();});
    el.addEventListener('click',e=>{if(e.target===el)close();});
    document.body.appendChild(el);render();if(el.showModal)el.showModal();else el.setAttribute('open','');
    return {close,element:el};
  }
  async function uploadPhoto(ctx,id,file,assertCurrent){
    if(!file.type.startsWith('image/')||file.size>20*1024*1024)throw new Error('Elige una imagen de menos de 20 MB.');
    const image=await createImageBitmap(file);const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();
    const bytes=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));if(!bytes||bytes.size>8*1024*1024)throw new Error('La foto debe pesar menos de 8 MB.');
    assertCurrent();const path=ctx.user()+'/'+ctx.target.stayId+'/'+id+'_'+crypto.randomUUID().replace(/-/g,'')+'.jpg';
    const {data,error}=await window.haikuSupabase.storage.from('haiku-checkout').upload(path,bytes,{contentType:'image/jpeg',upsert:false,cacheControl:'0'});if(error)throw error;if(data.path!==path)throw new Error('No pudimos confirmar la foto.');return path;
  }
  async function removePhoto(path,user){if(!path.startsWith(user+'/'))return;const {error}=await window.haikuSupabase.storage.from('haiku-checkout').remove([path]);if(error)throw error;}
  async function downloadPhoto(ctx,path){
    if(!path||path.split('/')[1]!==ctx.target.stayId||!ctx.current())throw new Error('La foto no corresponde a esta estadía o la sesión cambió.');
    const owner=ctx.user(),filename='Haku-'+path.split('/').pop();
    const {data,error}=await window.haikuSupabase.storage.from('haiku-checkout').createSignedUrl(path,120,{download:filename});if(error)throw error;
    const response=await fetch(data.signedUrl);if(!response.ok)throw new Error('No pudimos descargar la foto.');const blob=await response.blob();
    if(!ctx.current()||owner!==ctx.user())throw new Error('La sesión cambió.');
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function areaDetail(s){return `<details class="co-area-detail" data-co-area-detail="${s.id}"><summary aria-label="Nota de ${esc(s.title)}"><span data-co-detail-mark></span>${chevron}</summary><div class="co-detail-body"><div class="co-evidence-input"><textarea aria-label="Nota de ${esc(s.title)}" data-co-detail="${s.id}" maxlength="1000" rows="3" placeholder="Nota de ${esc(s.title)}"></textarea><button type="button" class="co-camera" data-co-area-camera="${s.id}" aria-label="Añadir evidencia de ${esc(s.title)}">${cameraIcon}</button></div><div class="co-actions-inline" data-co-area-photo="${s.id}" hidden><button type="button" class="co-link" data-co-view-area-photo="${s.id}">Ver foto</button><button type="button" class="co-link" data-co-download-area-photo="${s.id}">Descargar</button></div></div></details>`;}
  function create(options){
    const root=options.root,$=selector=>root.querySelector(selector);
    let current=null,detailKey='',activeDialog=null,copied='';
    const target=d=>({day:options.date(),cabinId:d.cabana_id,stayId:d.salida_estadia_id});
    const key=d=>window.HAIKU_CHECKOUT_CORE_V1.key(target(d));
    const find=k=>current?.departures.find(d=>key(d)===k);
    function context(d){const t=target(d),owner=options.user();return {target:t,cabin:d.numero,user:options.user,current:()=>owner===options.user()&&options.date()===t.day&&Boolean(find(window.HAIKU_CHECKOUT_CORE_V1.key(t))),
      editable:()=>Boolean(current.core.state.canEdit),record:()=>current.core.view(t),loans:()=>{const row=current.core.view(t);return V.loansFor([...new Set([...(row.notas_prestamos||[]),...options.notes(d)])],row.prestamos,row.recuperados);},save:(field,value)=>current.core.set(t,field,value)};}
    function show(d,kind,initial){activeDialog?.close();const ctx=context(d);activeDialog=dialog({...ctx,closed:()=>{activeDialog=null;}},kind,initial);activeDialog.element.dataset.target=key(d);}
    function group(d){const r=current.core.view(target(d));return r.revision_estado==='revisada'?3:r.revision_estado==='en_revision'?1:r.chequeados.includes('llaves')?0:2;}
    function out(d,r){return r.hora_out_definida?(r.hora_out||'').slice(0,5):options.time(d.salida_checkout_en);}
    function field(d,name,placeholder){return `<input aria-label="${name==='hora_out'?'OUT':'Encargado'} de Check out de cabaña ${d.numero}" data-checkout-target="${esc(key(d))}" data-checkout-field="${name}" type="text" ${name==='hora_out'?'inputmode="numeric" maxlength="5"':'maxlength="120"'} placeholder="${placeholder}">`;}
    function card(d){return `<article class="co-list-row" data-checkout-card="${esc(key(d))}"><div class="co-cabin-cell"><div><strong>CAB ${d.numero}</strong><button class="co-keys" type="button" data-co-keys="${esc(key(d))}">Llaves</button></div><small data-checkout-guest></small></div><div><strong data-co-status></strong><small data-co-status-detail></small></div><div><span data-co-loans></span></div><div class="co-list-field">${field(d,'encargado','Sin asignar')}</div><div class="co-list-field co-out">${field(d,'hora_out','—')}</div><button type="button" class="co-button" data-checkout-open="${esc(key(d))}">Revisar</button><small class="co-row-saving" data-checkout-saving></small></article>`;}
    function updateFields(el,d,r){for(const input of el.querySelectorAll('[data-checkout-field]')){if(document.activeElement!==input&&!input.dataset.dirty)input.value=input.dataset.checkoutField==='hora_out'?out(d,r):r.encargado;input.disabled=!current.core.state.ready||!current.core.state.canEdit;}}
    function renderList(){const list=$('#cabinsCheckoutList'),ordered=[...current.departures].sort((a,b)=>group(a)-group(b)||a.numero-b.numero);
      if(!list.querySelector('.co-list-head'))list.innerHTML='<div class="co-list-head"><span>Cabaña</span><span>Revisión</span><span>Préstamos</span><span>Responsable</span><span>OUT</span><span></span></div><div data-co-list-rows></div>';
      const rows=list.querySelector('[data-co-list-rows]'),alive=new Set(ordered.map(key));for(const node of [...rows.children])if(!alive.has(node.dataset.checkoutCard))node.remove();
      const hasFocus=Boolean(document.activeElement?.matches?.('input,textarea')&&document.activeElement.closest('.co-list-row'));
      for(const d of ordered){const k=key(d);let el=[...rows.children].find(n=>n.dataset.checkoutCard===k);if(!el){const holder=document.createElement('div');holder.innerHTML=card(d);el=holder.firstElementChild;rows.appendChild(el);}else if(!hasFocus)rows.appendChild(el);
        const r=current.core.view(target(d)),s=V.loanSummary(context(d).loans()),status=r.revision_estado==='revisada'?'Revisada':r.revision_estado==='en_revision'?'En revisión':r.chequeados.includes('llaves')?'Llaves recibidas':'Pendiente';
        el.querySelector('[data-checkout-guest]').textContent=d.salida_titular||'Titular no informado';el.querySelector('[data-co-status]').textContent=status;
        el.querySelector('[data-co-status-detail]').textContent=r.revision_estado==='revisada'?Object.keys(r.observaciones).length+' observaciones':r.revision_estado==='en_revision'?(r.encargado||'Revisión en curso'):r.chequeados.includes('llaves')?'Por revisar':'Aún no entrega llaves';
        const loanText=el.querySelector('[data-co-loans]');loanText.textContent=s.unknown?s.unknown+' cantidad por confirmar':s.pending.length?(s.total-s.returned)+' por recuperar':s.total?'Todo devuelto':'Sin préstamos detectados';loanText.classList.toggle('co-amber',Boolean(s.pending.length));
        const keys=el.querySelector('[data-co-keys]');keys.classList.toggle('is-selected',r.chequeados.includes('llaves'));keys.setAttribute('aria-pressed',String(r.chequeados.includes('llaves')));keys.setAttribute('aria-label','Llaves recibidas de CAB '+d.numero);keys.disabled=!current.core.state.ready||!current.core.state.canEdit;
        const open=el.querySelector('[data-checkout-open]');open.disabled=!current.core.state.ready;open.textContent=r.revision_estado==='revisada'?'Abrir':r.revision_estado==='en_revision'?'Ver':'Revisar';open.classList.toggle('co-primary',r.chequeados.includes('llaves')&&r.revision_estado==='pendiente');
        updateFields(el,d,r);el.querySelector('[data-checkout-saving]').textContent=current.core.saving(target(d))?'Guardando…':'';
      }
      if(!ordered.length)rows.innerHTML='<p class="co-small co-empty">No hay salidas para esta fecha.</p>';
    }
    function detailHTML(d){const k=esc(key(d));return `<button type="button" class="co-link" data-checkout-back>‹ Todas las salidas</button><header class="co-review-head"><div><h2>CAB ${d.numero} · Revisión de salida</h2><p data-checkout-guest></p></div></header><div class="co-layout"><div class="co-route"><div class="co-route-heading"><strong>Tu recorrido</strong><small>4 sectores · objetivo 3–5 min</small></div><div class="co-route-heading"><span data-co-loan-count></span><div class="co-actions-inline"><button type="button" class="co-button" data-co-manage="${k}">Ver</button><button type="button" class="co-button" data-co-add="${k}">+ Préstamo</button></div></div>${V.sectors.map((s,i)=>`<section class="co-sector" data-co-sector="${s.id}"><header><h3>${String(i+1).padStart(2,'0')} ${s.label}</h3><button type="button" role="checkbox" data-checkout-target="${k}" data-checkout-check="chequeado" data-checkout-item="${s.id}" aria-checked="false"><span class="cb-check-square" aria-hidden="true"></span>Revisado</button></header><div class="co-chips"><small class="co-reponer">REPONER</small>${V.usageItems.filter(u=>u.area===s.id).map(u=>chip(u.label,`data-co-usage="${u.checkId}"`)).join('')}${s.supplies.map(id=>chip(V.replenishmentLabel(id,{}),`data-co-supply="${id}"`)).join('')}</div><div class="co-sector-points"><p>${esc(s.points)}</p></div><div class="co-sector-loans" data-co-area-loans></div>${areaDetail(s)}</section>`).join('')}<p class="co-small">Reponer: marca faltantes; añade unidades si aplica. Préstamos: marca lo devuelto.</p><details class="co-source-notes"><summary>Notas y solicitudes</summary><div data-checkout-context></div></details></div><aside class="co-sidebar"><section class="co-panel co-warning" data-co-warning><strong>Antes de despedir</strong><p data-co-missing></p><small data-co-returned></small></section><section class="co-panel"><h3>Para aseo</h3><small>Reposiciones, uso, préstamos y notas.</small><pre data-co-message></pre><button type="button" class="co-button co-primary" data-co-copy>Copiar para aseo</button><button type="button" class="co-button" data-co-copy-maintenance>Copiar para mantención</button></section><section class="co-panel"><h3>Observaciones</h3><div class="co-observation-types">${V.observationTypes.map(o=>`<button type="button" class="co-link co-problem" data-co-observation="${o.id}">+ ${esc(o.label)}</button>`).join('')}</div><div data-co-observations></div><button type="button" class="co-observation-placeholder" data-co-observation="dano">Nota breve, solo si hace falta…</button></section><section class="co-panel"><strong data-co-progress></strong><button type="button" class="co-button" data-co-finish>Terminar revisión</button><small>Los préstamos pendientes seguirán visibles.</small></section><section class="co-panel"><h3>Salida</h3><div class="co-exit-fields"><label>OUT${field(d,'hora_out','hh:mm')}</label><label>Encargado${field(d,'encargado','Sin asignar')}</label></div><small>OUT se registra al despedir al huésped.</small></section></aside></div>`;}
    function renderDetail(d){const detail=$('#cabinsCheckoutDetail'),k=key(d);if(detailKey!==k){detail.innerHTML=detailHTML(d);detailKey=k;}
      const r=current.core.view(target(d)),ctx=context(d),loans=ctx.loans(),s=V.loanSummary(loans),editable=current.core.state.ready&&current.core.state.canEdit;
      detail.querySelector('[data-checkout-guest]').textContent=(d.salida_titular||'Titular no informado')+' · Sale';detail.querySelector('[data-checkout-context]').innerHTML=options.context(d,true);
      detail.querySelector('[data-co-loan-count]').textContent=loans.length?'Préstamos · '+s.returned+'/'+s.total:'Sin préstamos detectados';
      for(const sector of detail.querySelectorAll('[data-co-sector]')){
        const id=sector.dataset.coSector,button=sector.querySelector('[data-checkout-check]'),checked=r.chequeados.includes(id);button.setAttribute('aria-checked',String(checked));button.querySelector('.cb-check-square').textContent=checked?'✓':'';button.disabled=!editable||r.revision_estado==='revisada';
        for(const b of sector.querySelectorAll('[data-co-supply]')){const selected=V.selectedSupply(b.dataset.coSupply,r.reposiciones);b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));b.textContent=(selected?'✓ ':'')+V.replenishmentLabel(b.dataset.coSupply,r.reposiciones);b.disabled=!editable;}
        for(const b of sector.querySelectorAll('[data-co-usage]')){const selected=r.chequeados.includes(b.dataset.coUsage),usage=V.usageItems.find(u=>u.checkId===b.dataset.coUsage);b.classList.toggle('is-selected',selected);b.classList.add('co-usage');b.setAttribute('aria-pressed',String(selected));b.textContent=(selected?'✓ ':'')+usage.label;b.disabled=!editable;}
        const editor=sector.querySelector('[data-co-detail]'),note=r.detalles?.[id];if(document.activeElement!==editor)editor.value=note?.texto||'';editor.disabled=!editable;sector.querySelector('[data-co-area-camera]').disabled=!editable;sector.querySelector('[data-co-area-photo]').hidden=!note?.foto_path;sector.querySelector('[data-co-detail-mark]').textContent=note?.texto||note?.foto_path?'•':'';
        const items=loans.filter(l=>l.area===id),html=items.map(l=>{const complete=l.cantidad!==null&&l.devueltos===l.cantidad;return `<button type="button" class="co-loan${complete?' is-returned':''}" data-co-return="${esc(l.id)}" ${editable?'':'disabled'}><span>${complete?'☑':'☐'} ${esc(l.label)}</span><strong>${l.cantidad===null?'?':l.devueltos+'/'+l.cantidad}</strong></button>`;}).join('');
        const holder=sector.querySelector('[data-co-area-loans]');if(holder.dataset.html!==html){holder.innerHTML=html;holder.dataset.html=html;}
      }
      const warning=detail.querySelector('[data-co-warning]');warning.hidden=!s.pending.length;detail.querySelector('[data-co-missing]').textContent=(s.unknown?'Confirmar: ':'Falta recuperar: ')+s.pending.map(l=>l.label).join(' · ');detail.querySelector('[data-co-returned]').textContent=s.returned+' / '+s.total+' devueltos'+(s.unknown?' · '+s.unknown+' cantidad por confirmar':'');
      const message=V.housekeepingMessage(d.numero,r,loans);detail.querySelector('[data-co-message]').innerHTML=message.split('\n').map(line=>line.startsWith('*')&&line.endsWith('*')?'<strong>'+esc(line.slice(1,-1))+'</strong>':esc(line)).join('\n');const copy=detail.querySelector('[data-co-copy]');copy.textContent=copied===message?'Copiado':'Copiar para aseo';copy.disabled=!current.core.state.ready;const maintenance=detail.querySelector('[data-co-copy-maintenance]');maintenance.disabled=!Object.values(r.observaciones).some(o=>o.tipo==='mantencion');maintenance.textContent=copied==='mantencion'?'Mantención copiada':'Copiar para mantención';
      const observations=detail.querySelector('[data-co-observations]'),signature=JSON.stringify(r.observaciones);if(observations.dataset.value!==signature){observations.innerHTML=Object.values(r.observaciones).map(o=>`<article class="co-observation"><div><strong>${esc(V.observationTypes.find(t=>t.id===o.tipo)?.label||o.tipo)}${o.area?' · '+esc(V.sectors.find(a=>a.id===o.area)?.title||o.area):''}</strong><button type="button" class="co-link" data-co-edit-observation="${esc(o.id)}">Editar</button></div><p>${esc(o.texto)}</p>${o.foto_path?`<button type="button" class="co-link" data-co-photo="${esc(o.id)}">Ver foto</button> <button type="button" class="co-link" data-co-download-photo="${esc(o.id)}">Descargar</button>`:''}</article>`).join('');observations.dataset.value=signature;}
      detail.querySelector('.co-observation-placeholder').hidden=Boolean(Object.keys(r.observaciones).length);
      const n=V.sectors.filter(s=>r.chequeados.includes(s.id)).length;detail.querySelector('[data-co-progress]').textContent=n+'/4 sectores revisados'+(current.core.saving(target(d))?' · Guardando…':'');const finish=detail.querySelector('[data-co-finish]');finish.textContent=r.revision_estado==='revisada'?'Reabrir revisión':'Terminar revisión';finish.disabled=!editable||current.core.saving(target(d))||(r.revision_estado!=='revisada'&&n!==4);
      for(const b of detail.querySelectorAll('[data-co-add],[data-co-observation],[data-co-edit-observation]'))b.disabled=!editable;
      updateFields(detail,d,r);
    }
    root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!current)return;const d=find(b.dataset.coKeys||b.dataset.coManage||b.dataset.coAdd||current.selected);if(!d)return;
      const ctx=context(d),r=ctx.record(),run=fn=>void Promise.resolve().then(fn).catch(error=>{$('#cabinsCheckoutError').textContent=error.message||String(error);});
      if(b.dataset.coKeys)run(()=>ctx.save('chequeado',{id:'llaves',checked:!r.chequeados.includes('llaves')}));
      else if(b.dataset.coManage)show(d,'loans');else if(b.dataset.coAdd)show(d,'loan');
      else if(b.dataset.coSupply){const id=b.dataset.coSupply;if(id==='amenities'||V.supplies.find(i=>i.id===id)?.countable)show(d,'quantity',{id});else run(()=>ctx.save('reposicion',{items:{[id]:r.reposiciones[id]>0?0:1}}));}
      else if(b.dataset.coReturn){const loan=ctx.loans().find(l=>l.id===b.dataset.coReturn);if(!loan)return;if(loan.cantidad===null)show(d,'loan',{loan});else if(loan.cantidad===1)run(()=>ctx.save('devolucion',{id:loan.id,label:loan.label,area:loan.area,origen:loan.origen,total:1,cantidad:loan.devueltos?0:1}));else show(d,'return',{loan});}
      else if(b.dataset.coUsage)run(()=>ctx.save('chequeado',{id:b.dataset.coUsage,checked:!r.chequeados.includes(b.dataset.coUsage)}));
      else if(b.dataset.coAreaCamera)show(d,'detailPhoto',{area:b.dataset.coAreaCamera});
      else if(b.dataset.coDownloadAreaPhoto)run(()=>downloadPhoto(ctx,r.detalles?.[b.dataset.coDownloadAreaPhoto]?.foto_path));
      else if(b.dataset.coDownloadPhoto)run(()=>downloadPhoto(ctx,r.observaciones[b.dataset.coDownloadPhoto]?.foto_path));
      else if(b.dataset.coObservation)show(d,'observation',{type:b.dataset.coObservation});else if(b.dataset.coEditObservation)show(d,'observation',{observation:r.observaciones[b.dataset.coEditObservation]});
      else if(b.hasAttribute('data-co-copy'))run(async()=>{await current.core.flushDetails(ctx.target);const message=V.housekeepingMessage(d.numero,ctx.record(),ctx.loans());if(!navigator.clipboard?.writeText)throw new Error('Selecciona y copia el texto del mensaje.');await navigator.clipboard.writeText(message);copied=message;renderDetail(d);});
      else if(b.hasAttribute('data-co-copy-maintenance'))run(async()=>{await current.core.flushDetails(ctx.target);if(!navigator.clipboard?.writeText)throw new Error('No pudimos copiar el mensaje.');await navigator.clipboard.writeText(V.maintenanceMessage(d.numero,ctx.record()));copied='mantencion';renderDetail(d);});
      else if(b.hasAttribute('data-co-finish'))run(async()=>{await current.core.flushDetails(ctx.target);const phase=r.revision_estado==='revisada'?'en_revision':'revisada';await ctx.save('revision_estado',phase);if(phase==='revisada')options.back();});
      else if(b.dataset.coPhoto||b.dataset.coViewAreaPhoto)run(async()=>{const path=b.dataset.coPhoto?r.observaciones[b.dataset.coPhoto]?.foto_path:r.detalles?.[b.dataset.coViewAreaPhoto]?.foto_path;if(!path||path.split('/')[1]!==ctx.target.stayId)throw new Error('La foto no corresponde a esta estadía.');const {data,error}=await window.haikuSupabase.storage.from('haiku-checkout').createSignedUrl(path,120);if(error)throw error;show(d,'photo',{uri:data.signedUrl});});
    });
    root.addEventListener('input',e=>{if(!e.target.dataset.coDetail||!current?.selected)return;const d=find(current.selected);if(d)current.core.editDetail(target(d),e.target.dataset.coDetail,e.target.value);});
    root.addEventListener('focusin',e=>{if(e.target.dataset.coDetail&&current?.selected){const d=find(current.selected);if(d)current.core.focusDetail(target(d),e.target.dataset.coDetail);}});
    root.addEventListener('focusout',e=>{if(e.target.dataset.coDetail&&current?.selected){const d=find(current.selected);if(d)void current.core.blurDetail(target(d),e.target.dataset.coDetail).catch(error=>{$('#cabinsCheckoutError').textContent=error.message;});}});
    root.addEventListener('toggle',e=>{if(e.target.matches?.('[data-co-area-detail]')&&!e.target.open&&current?.selected){const d=find(current.selected);if(d)void current.core.flushDetail(target(d),e.target.dataset.coAreaDetail).catch(error=>{$('#cabinsCheckoutError').textContent=error.message;});}},true);
    return {render(state){current=state;if(activeDialog&&(!state.selected||activeDialog.element.dataset.target!==state.selected)){activeDialog.close();}
      const stats=$('#cabinsCheckoutCount');stats.textContent=state.departures.length+' salidas · '+state.departures.filter(d=>group(d)===0||group(d)===2).length+' por revisar · '+state.departures.filter(d=>group(d)===1).length+' en revisión · '+state.departures.filter(d=>group(d)===3).length+' revisadas';
      $('#cabinsCheckoutError').textContent=state.core.state.error||'';$('#cabinsCheckoutList').hidden=Boolean(state.selected);$('#cabinsCheckoutDetail').hidden=!state.selected;
      if(state.selected){const d=find(state.selected);if(d)renderDetail(d);}else renderList();
    },close(){activeDialog?.close();},reset(){activeDialog?.close();detailKey='';copied='';$('#cabinsCheckoutList').innerHTML='';$('#cabinsCheckoutDetail').innerHTML='';}};
  }
  function mountStayLoans(container,stayOrStays){
    const stays=Array.isArray(stayOrStays)?stayOrStays:[stayOrStays];
    if(!container||!stays[0]?.id)return;
    const old=container.querySelector('[data-stay-loans]');let stay=stays.find(s=>s.id===old?.dataset.stayLoans)||stays[0];if(old)old.remove();
    const widget=document.createElement('div');widget.dataset.stayLoans=stay.id;widget.className='co-stay-widget';widget.innerHTML=`<strong>Préstamos</strong>${stays.length>1?`<select aria-label="Cabaña de los préstamos">${stays.map(s=>`<option value="${esc(s.id)}">CAB ${esc(s.number)}</option>`).join('')}</select>`:`<span>CAB ${esc(stay.number)}</span>`}<button type="button" class="co-button">Ver / + Préstamo</button><small role="status"></small>`;container.appendChild(widget);
    const selector=widget.querySelector('select');if(selector){selector.value=stay.id;selector.addEventListener('change',()=>{stay=stays.find(s=>s.id===selector.value)||stays[0];widget.dataset.stayLoans=stay.id;});}
    widget.querySelector('button').addEventListener('click',async()=>{
      const selectedStay=stay,b=widget.querySelector('button'),status=widget.querySelector('small'),client=window.haikuSupabase;b.disabled=true;status.textContent='Cargando…';
      try{
        const session=await client.auth.getSession(),user=session.data.session?.user.id;if(!user)throw new Error('Inicia sesión para consultar préstamos.');
        const {data,error}=await client.rpc('haiku_prestamos_estadia_v1',{p_estadia_id:selectedStay.id});if(error)throw error;if(data.estadia_id!==selectedStay.id)throw new Error('La estadía cambió.');let record=data;
        const current=()=>widget.isConnected&&container.querySelector('[data-stay-loans]')===widget&&widget.dataset.stayLoans===selectedStay.id;
        if(!current())return;status.textContent='';
        dialog({cabin:selectedStay.number,target:{stayId:selectedStay.id},user:()=>window.haikuSesion?.user?.id||null,current,
          editable:()=>Boolean(data.puede_editar),record:()=>({prestamos:record.items}),loans:()=>V.loansFor(record.notas||[],record.items),
          save:async(field,value)=>{if(!data.puede_editar)throw new Error('Tu usuario no puede registrar préstamos.');const active=await client.auth.getSession();if(active.data.session?.user.id!==user||!current())throw new Error('La sesión o la estadía cambió.');const result=await client.rpc('haiku_guardar_prestamo_estadia_v1',{p_estadia_id:selectedStay.id,p_campo:field,p_valor:value});if(result.error)throw result.error;if(result.data.estadia_id!==selectedStay.id)throw new Error('El préstamo no corresponde a esta estadía.');record={...record,...result.data};},
        },'loans');
      }catch(error){status.textContent=error.message||String(error);}finally{b.disabled=false;}
    });
  }
  window.HAIKU_CHECKOUT_UI_V2=Object.freeze({create,mountStayLoans});
})();
