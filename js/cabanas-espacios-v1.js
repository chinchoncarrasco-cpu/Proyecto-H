/* Cabañas: Insumos y control operativo de salidas. Reutiliza los escritores de insumos. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const destinations = [['aseo_full','Aseo Full'],['aseo_express','Aseo Express'],['venta_huesped','Venta / compra huésped']];
  const timeChile = iso => { try { return iso ? new Intl.DateTimeFormat('en-GB',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)) : ''; } catch (_) { return ''; } };
  function create(config) {
    const root=config.root, $=s=>root.querySelector(s);
    let checkoutUI=null, checkoutDirty=false, departuresDirty=false;
    let currentTab='operation', scope='', core=null, departures=[], selected='', listSignature='', channel=null, readVersion=0, timer=null;
    let supply=null, supplySaving=false, previousFocus=null;
    const api=()=>window.HAIKU_INSUMOS_ASEO_V1;
    const scopeKey=()=>config.user()+':'+config.date();
    const target=d=>({day:config.date(),cabinId:d.cabana_id,stayId:d.salida_estadia_id});
    const find=key=>departures.find(d=>window.HAIKU_CHECKOUT_CORE_V1.key(target(d))===key);
    function contextHTML(d,detailed=false) {
      const day=config.dayData(config.date())||{}, cabin=day.cabanas?.[String(d.numero)]||{}, types=window.HAIKU_ASEO_OPERACION_V1?.tiposSolicitud||{};
      const belongs=value=>!value||value===d.salida_reserva_id;
      const requests=Array.isArray(cabin.solicitudesTipos)?cabin.solicitudesTipos.filter(r=>r.estado!=='cancelada'&&types[r.categoria]&&belongs(r.reserva_id||r.reservaId)).map(r=>({title:types[r.categoria],detail:r.descripcion||types[r.categoria]}))
        : cabin.solicitudAseoExpress?[{title:'Solicita Express',detail:cabin.solicitudAseoExpress}]:[];
      const notes=(day.notasOperativas||[]).filter(n=>String(n.cabana)===String(d.numero)&&belongs(n.reservaId||n.reserva_id)
        &&(!(n.estadiaId||n.estadia_id)||(n.estadiaId||n.estadia_id)===d.salida_estadia_id)).map(n=>String(n.texto||'').trim()).filter(Boolean);
      return (requests.length?`<div class="cb-request-summary">${requests.map((r,i)=>`<span class="cb-request-summary-item">${i?'· ':''}${esc(r.title)}${detailed&&r.detail!==r.title?': '+esc(r.detail):''}</span>`).join('')}</div>`:'')
        +(notes.length?`<div class="cb-note-summary">${notes.map(n=>`<span class="cb-note-summary-item">${esc(n)}</span>`).join('')}</div>`:'');
    }
    async function loadDepartures() {
      const ownScope=scope, request=++readVersion, client=window.haikuSupabase;
      if(!client||!config.user())return;
      try {
        const {data,error}=await client.rpc('haiku_operacion_dia',{p_fecha:config.date()});
        if(error)throw error;
        if(ownScope!==scope||request!==readVersion)return;
        if(!Array.isArray(data))throw new Error('La lectura de salidas no es válida.');
        departures=data.filter(d=>d.fecha===config.date()&&d.salida_estadia_id&&d.cabana_id).sort((a,b)=>a.numero-b.numero);
        if(selected&&!find(selected))selected='';
        renderCheckout();
      } catch(e){if(ownScope===scope)$('#cabinsCheckoutError').textContent=e.message||String(e);}
    }
    function ensureCheckout() {
      if(scope===scopeKey()&&core){if(checkoutDirty){checkoutDirty=false;void core.refresh();}if(departuresDirty){departuresDirty=false;void loadDepartures();}return;}
      checkoutUI?.reset();checkoutDirty=false;departuresDirty=false;
      scope=scopeKey(); departures=[]; selected=''; listSignature=''; readVersion++;
      core?.dispose(); if(channel)void window.haikuSupabase?.removeChannel(channel);
      const ownScope=scope, day=config.date();
      core=window.HAIKU_CHECKOUT_CORE_V1.createCheckoutStore({day,isCurrent:()=>scope===ownScope&&scopeKey()===ownScope,
        async read(date){const {data,error}=await window.haikuSupabase.rpc('haiku_revisiones_checkout_dia_v2',{p_fecha:date});if(error)throw error;return data;},
        async write(t,field,value){const loan=field==='prestamo'||field==='devolucion';const {data,error}=await window.haikuSupabase.rpc(loan?'haiku_guardar_prestamo_estadia_v1':field==='detalle'||field==='detalle_foto'?'haiku_guardar_detalle_checkout_v1':field==='punto'||field==='conteo'?'haiku_guardar_recorrido_checkout_v3':'haiku_guardar_revision_checkout_v2',loan?{p_estadia_id:t.stayId,p_campo:field,p_valor:value}:{p_fecha:t.day,p_cabana_id:t.cabinId,p_estadia_id:t.stayId,p_campo:field,p_valor:value});if(error)throw error;return data;},
      });
      core.subscribe(renderCheckout); void core.ensure(); void loadDepartures();
      const refresh=(reviews,source)=>{
        checkoutDirty=checkoutDirty||reviews;departuresDirty=departuresDirty||source;
        if(currentTab!=='checkout')return;
        clearTimeout(timer);timer=setTimeout(()=>{if(scope===ownScope&&scopeKey()===ownScope&&currentTab==='checkout'){
          if(checkoutDirty){checkoutDirty=false;void core.refresh();}
          if(departuresDirty){departuresDirty=false;void loadDepartures();}
        }},180);
      };
      if(window.haikuSupabase?.channel)channel=window.haikuSupabase.channel('checkout-operativo-web:'+scope)
        .on('postgres_changes',{event:'*',schema:'public',table:'revisiones_checkout',filter:'fecha_operativa=eq.'+day},payload=>{if(scope===ownScope)core.receive(payload.new);})
        .on('postgres_changes',{event:'*',schema:'public',table:'prestamos_estadia'},payload=>{if(scope===ownScope)core.receiveLoans(payload.new);})
        .on('postgres_changes',{event:'*',schema:'public',table:'notas'},()=>refresh(true,false))
        .on('postgres_changes',{event:'*',schema:'public',table:'reserva_estadias'},()=>refresh(true,true))
        .on('postgres_changes',{event:'*',schema:'public',table:'reservas'},()=>refresh(false,true)).subscribe();
    }
    function checkoutNotes(d) {
      return (config.dayData(config.date())?.notasOperativas||[]).filter(n=>String(n.cabana)===String(d.numero)
        &&(!(n.reservaId||n.reserva_id)||(n.reservaId||n.reserva_id)===d.salida_reserva_id)
        &&(!(n.estadiaId||n.estadia_id)||(n.estadiaId||n.estadia_id)===d.salida_estadia_id))
        .map(n=>String(n.texto||'').trim()).filter(Boolean);
    }
    function renderCheckout() {
      if(currentTab!=='checkout'||!core)return;
      if(!checkoutUI)checkoutUI=window.HAIKU_CHECKOUT_UI_V2.create({root,date:config.date,user:config.user,notes:checkoutNotes,
        context:contextHTML,time:timeChile,
        renderContext(d, detail) {
          const host=detail.querySelector('[data-checkout-context]');
          if(!window.HAIKU_CABIN_CONTEXT_UI_V1){host.innerHTML=contextHTML(d,true);return;}
          const cabin=config.dayData(config.date())?.cabanas?.[String(d.numero)]||{};
          const requests=(cabin.solicitudesTipos||[]).filter(row=>row.estado!=='cancelada'&&(!(row.reserva_id||row.reservaId)||(row.reserva_id||row.reservaId)===d.salida_reserva_id));
          window.HAIKU_CABIN_CONTEXT_UI_V1.render(host, {
            client:window.haikuSupabase,user:config.user,date:config.date,
            occupancy:detail.querySelector('[data-checkout-party]'), fallbackHTML:contextHTML(d,true),
            fallback:{notes:checkoutNotes(d),requests},
            target:{scope:'stay',day:config.date(),cabinNumber:d.numero,cabinId:d.cabana_id,stayId:d.salida_estadia_id,reservationId:d.salida_reserva_id}
          });
        },back(){selected='';renderCheckout();}});
      checkoutUI.render({core,departures,selected});
    }
    function renderSupplies() {
      if(currentTab!=='supplies')return;
      const html=Array.from({length:11},(_,i)=>{const n=i+1,r=api()?.obtener(config.date(),n);return `<article class="cb-supply-cabin"><div><strong>Cabaña ${n}</strong><p>Leña ${r?.listo?r.lena.cantidad+' sacos · '+r.lena.pesoKg+' kg':'—'}</p><p>Carbón ${r?.listo?r.carbon.cantidad+' sacos':'—'}</p></div><button type="button" class="cb-outline" data-supply-open="${n}">+ Insumo</button></article>`;}).join('');
      $('#cabinsSuppliesCabins').innerHTML=html;
    }
    function closeSupply() {
      if(supplySaving)return;
      supply=null;$('#cabinsSupplyPanel').classList.remove('activo');previousFocus?.focus?.();
    }
    function renderSupplyModal() {
      if(!supply)return;
      const r=api()?.obtener(supply.day,supply.number), type=$('#cabinsSupplyType').value;
      $('#cabinsSupplyWeightField').hidden=type!=='lena';
      $('#cabinsSupplySave').textContent=supplySaving?'Guardando…':type==='lena'?'+ Agregar saco':'+ Agregar saco de carbón';
      $('#cabinsSupplySave').disabled=supplySaving||!r?.listo;
      $('#cabinsSupplyClose').disabled=supplySaving;
      $('#cabinsSupplyStatus').textContent=r?.error||(!r?.listo?'Cargando insumos…':`Leña ${r.lena.cantidad} sacos · ${r.lena.pesoKg} kg · Carbón ${r.carbon.cantidad} sacos`);
    }
    async function openSupply(number) {
      if(!/^(?:[1-9]|10|11)$/.test(String(number)))return;
      previousFocus=document.activeElement;supply={number:String(number),day:config.date(),owner:config.user()};
      $('#cabinsSupplyTitle').textContent='Insumos · Cabaña '+number;
      $('#cabinsSupplyError').textContent='';$('#cabinsSupplyWeight').value='';$('#cabinsSupplyDestination').value='';$('#cabinsSupplyType').value='lena';
      $('#cabinsSupplyPanel').classList.add('activo');renderSupplyModal();$('#cabinsSupplyClose').focus();
      try { if(!api())throw new Error('Insumos aún no está disponible. Vuelve a intentar.');await api().hidratar(supply.day,{forzar:false});renderSupplyModal(); }
      catch(e){$('#cabinsSupplyError').textContent=e.message||String(e);}
    }
    async function saveSupply() {
      if(!supply||supplySaving)return;
      const t={...supply}, type=$('#cabinsSupplyType').value,destination=$('#cabinsSupplyDestination').value,weight=Number($('#cabinsSupplyWeight').value.replace(',','.'));
      if(t.day!==config.date()||t.owner!==config.user()){$('#cabinsSupplyError').textContent='La fecha o la sesión cambió. Abre nuevamente Insumos.';return;}
      if(!destinations.some(d=>d[0]===destination)){$('#cabinsSupplyError').textContent='Selecciona un destino.';return;}
      if(type==='lena'&&(!Number.isFinite(weight)||weight<=0)){$('#cabinsSupplyError').textContent='Escribe el peso del saco en kilos.';return;}
      supplySaving=true;$('#cabinsSupplyError').textContent='';renderSupplyModal();
      try {
        if(type==='lena')await api().agregarSaco(t.day,t.number,weight,destination);
        else await api().cambiar(t.day,t.number,'carbon',1,destination);
        if(supply&&t.day===supply.day&&t.owner===supply.owner){$('#cabinsSupplyWeight').value='';$('#cabinsSupplyError').textContent='Insumo guardado.';}
        config.afterSupply();
      } catch(e){if(supply)$('#cabinsSupplyError').textContent=e.message||String(e);}
      finally{supplySaving=false;renderSupplyModal();renderSupplies();}
    }
    root.addEventListener('click',e=>{
      if(e.target===$('#cabinsSupplyPanel')){closeSupply();return;}
      const b=e.target.closest('button');if(!b)return;
      if(b.dataset.supplyOpen){void openSupply(b.dataset.supplyOpen);return;}
      if(b.id==='cabinsSupplyClose'){closeSupply();return;}
      if(b.id==='cabinsSupplySave'){void saveSupply();return;}
      if(b.hasAttribute('data-checkout-back')){const d=find(selected);if(d)void core.flushDetails(target(d)).catch(error=>{$('#cabinsCheckoutError').textContent=error.message;});selected='';renderCheckout();return;}
      if(b.hasAttribute('data-checkout-retry')){void core?.refresh();void loadDepartures();return;}
      if(b.dataset.checkoutOpen){const d=find(b.dataset.checkoutOpen);if(!d)return;const open=()=>{selected=b.dataset.checkoutOpen;renderCheckout();$('#cabinsCheckoutDetail').scrollIntoView?.({block:'start'});};if(core.state.canEdit&&core.view(target(d)).revision_estado==='pendiente')void core.set(target(d),'revision_estado','en_revision').then(open).catch(()=>undefined);else open();return;}
      if(b.dataset.checkoutCheck){const d=find(b.dataset.checkoutTarget);if(d)void core.set(target(d),b.dataset.checkoutCheck,{id:b.dataset.checkoutItem,checked:b.getAttribute('aria-checked')!=='true'}).catch(()=>undefined);}
    });
    root.addEventListener('change',e=>{if(['cabinsSupplyType','cabinsSupplyDestination'].includes(e.target.id))renderSupplyModal();});
    root.addEventListener('focusin',e=>{if(e.target.dataset.checkoutField&&!e.target.dataset.dirty)e.target.dataset.initial=e.target.value;});
    root.addEventListener('input',e=>{if(e.target.dataset.checkoutField){e.target.dataset.dirty='true';e.target.dataset.editVersion=String(Number(e.target.dataset.editVersion||0)+1);}});
    root.addEventListener('focusout',async e=>{
      const input=e.target;if(!input.dataset.checkoutField)return;
      const d=find(input.dataset.checkoutTarget);if(!d||!input.dataset.dirty)return;
      const version=input.dataset.editVersion;
      if(input.value===input.dataset.initial){delete input.dataset.dirty;renderCheckout();return;}
      try{const value=input.dataset.checkoutField==='hora_out'?window.HAIKU_CHECKOUT_CORE_V1.normalizeTime(input.value):input.value.trim();await core.set(target(d),input.dataset.checkoutField,value);if(input.dataset.editVersion===version)delete input.dataset.dirty;renderCheckout();}
      catch(error){$('#cabinsCheckoutError').textContent=error.message||String(error);}
    });
    root.addEventListener('keydown',e=>{
      if(e.target.dataset.checkoutField&&e.key==='Enter'){e.preventDefault();e.target.blur();}
      if(supply&&e.key==='Escape'){e.preventDefault();closeSupply();}
      if(supply&&e.key==='Tab'){
        const controls=[...$('#cabinsSupplyPanel').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(el=>el.getClientRects().length);
        if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1)?.focus();}
        else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0]?.focus();}
      }
    });
    return { openSupply, render(tab,date) {
      if(currentTab==='checkout'&&tab!=='checkout')checkoutUI?.close();
      if(currentTab!==tab&&tab==='checkout')selected='';currentTab=tab;
      $('#cabinsSupplies').hidden=tab!=='supplies';$('#cabinsCheckout').hidden=tab!=='checkout';
      if(supply&&(supply.day!==date||supply.owner!==config.user())){supply=null;$('#cabinsSupplyPanel').classList.remove('activo');}
      if(tab==='checkout'){ensureCheckout();renderCheckout();}
      renderSupplies();renderSupplyModal();
    }};
  }
  window.HAIKU_CABANAS_ESPACIOS_V1=Object.freeze({create});
})();
