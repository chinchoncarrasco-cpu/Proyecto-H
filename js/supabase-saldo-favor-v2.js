// ========================================
// HAIKU · SALDO A FAVOR V2
// Excedentes de alojamiento reutilizables en cargos de servicios.
// ========================================
(() => {
    "use strict";
    const sb = window.haikuSupabase;
    if (!sb) return;

    const cache = new Map();
    let timer = 0;
    let registrando = false;
    let aplicando = false;
    let resumenModal = null;

    const MEDIOS = Object.freeze({
        transferencia: "Transferencia",
        webpay_credito: "WebPay Crédito",
        webpay_debito: "WebPay Débito",
        tarjeta_credito: "Tarjeta Crédito",
        tarjeta_debito: "Tarjeta Débito",
        efectivo: "Efectivo",
        otro: "Otro"
    });
    const money = v => `$${Math.round(Number(v || 0)).toLocaleString("es-CL")}`;
    const esc = v => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
    const fechaISO = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? `${v}T12:00:00.000Z` : "";
    const hora = v => v ? String(v).slice(0,5) : "";
    function fecha(v){if(!v)return"";try{return new Intl.DateTimeFormat("es-CL",{timeZone:"America/Santiago",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(v))}catch{return String(v).slice(0,10)}}
    function numeroTexto(id){return Number(String(document.getElementById(id)?.textContent||"0").replace(/[^0-9-]/g,""))||0}
    function medio(v){return MEDIOS[v]||v||"Sin medio"}
    function origen(f, disponible=true){const p=[medio(f?.medio_pago)];if(f?.glosa)p.push(`Glosa: ${f.glosa}`);if(f?.codigo_autorizacion)p.push(`CodAut: ${f.codigo_autorizacion}`);if(f?.folio)p.push(`Folio: ${f.folio}`);if(f?.bovtar)p.push(`BOVTAR: ${f.bovtar}`);if(f?.fecha_pago)p.push(fecha(f.fecha_pago));if(disponible)p.push(`Disponible ${money(f?.disponible)}`);return p.join(" · ")}

    async function resumen(reservaId, fresco=false, cachear=true, estricto=false){
        const id=String(reservaId||"");if(!id)return null;
        const previo=cache.get(id);if(!fresco&&previo&&Date.now()-previo.ts<10000)return previo.data;
        const{data,error}=await sb.rpc("haiku_saldo_favor_unidad",{p_reserva_id:id});if(error)throw error;if(estricto&&data==null)throw new Error("Saldo a favor no disponible.");
        const r=data||{saldo_a_favor:0,fuentes:[],cargos_servicio:[]};if(cachear)cache.set(id,{ts:Date.now(),data:r});return r;
    }
    function limpiarCache(id=""){if(id)cache.delete(String(id));else cache.clear()}
    function programar(ms=80){if(window.HAIKU_PAGOS_REFRESH_V1?.interceptar("credito"))return;clearTimeout(timer);timer=setTimeout(decorar,ms)}

    // ---------- Añadir pago ----------
    function estadoPago(texto,tipo=""){const el=document.getElementById("haiku-pago-estado");if(!el)return;el.className="haiku-pago-grupo-estado"+(tipo?` ${tipo}`:"");el.textContent=texto}
    function datosModal(){const val=id=>document.getElementById(id)?.value?.trim()||"";return{reservaId:val("haiku-pago-reserva"),monto:Math.round(Number(val("haiku-pago-monto")||0)),medio:val("haiku-pago-medio"),fecha:fechaISO(val("haiku-pago-fecha")),glosa:val("haiku-pago-glosa"),codaut:val("haiku-pago-codaut"),folio:val("haiku-pago-folio"),bovtar:val("haiku-pago-bove"),observacion:val("haiku-pago-observacion")}}
    function basicoValido(d){return Boolean(d.reservaId&&d.monto>0&&d.medio&&d.fecha)}
    function asegurarResumenCredito(){
        const box=document.getElementById("haiku-pago-resumen");if(!box)return;
        if(!box.querySelector(".haiku-pago-saldo-favor-celda")){const d=document.createElement("div");d.className="haiku-pago-saldo-favor-celda";d.innerHTML='<span>Saldo a favor</span><strong id="haiku-pago-saldo-favor">$0</strong>';box.appendChild(d)}
        if(!document.getElementById("haiku-pago-excedente-preview")){const p=document.createElement("div");p.id="haiku-pago-excedente-preview";p.className="haiku-pago-excedente-preview";p.hidden=true;box.insertAdjacentElement("afterend",p)}
    }
    function ajustarModalPago(){
        const select=document.getElementById("haiku-pago-reserva"),input=document.getElementById("haiku-pago-monto"),boton=document.getElementById("haiku-pago-confirmar");
        if(!select?.value||!input||!boton||document.getElementById("haiku-abono-edicion-aviso"))return;
        input.removeAttribute("max");input.disabled=false;
        const d=datosModal(),saldo=numeroTexto("haiku-pago-saldo"),extra=Math.max(0,d.monto-Math.max(0,saldo));
        const preview=document.getElementById("haiku-pago-excedente-preview");
        if(preview){if(extra>0){preview.hidden=false;preview.innerHTML=`<strong>${money(extra)} quedarán como saldo a favor</strong><span>${Math.min(d.monto,Math.max(0,saldo))>0?`${money(Math.min(d.monto,Math.max(0,saldo)))} se aplicarán al alojamiento. `:""}El excedente podrá utilizarse en servicios.</span>`}else{preview.hidden=true;preview.textContent=""}}
        if((d.monto>saldo||saldo<=0)&&basicoValido(d))boton.disabled=false;
    }
    async function decorarModalPago(){
        const overlay=document.getElementById("haiku-pago-grupo-overlay"),select=document.getElementById("haiku-pago-reserva");if(!overlay||overlay.hidden||!select?.value)return;
        asegurarResumenCredito();ajustarModalPago();
        try{const r=await resumen(select.value);if(select.value!==document.getElementById("haiku-pago-reserva")?.value)return;const el=document.getElementById("haiku-pago-saldo-favor");if(el)el.textContent=money(r?.saldo_a_favor)}catch(e){console.warn("HAIKU · saldo a favor en Añadir pago:",e)}
    }
    async function registrarExcedente(){
        if(registrando||document.getElementById("haiku-abono-edicion-aviso"))return;
        const d=datosModal(),saldo=numeroTexto("haiku-pago-saldo");if(!(d.monto>saldo||saldo<=0)||!basicoValido(d))return;
        if(d.medio==="transferencia"&&!d.glosa)return estadoPago("Ingresa la glosa de la transferencia.","error");
        if(["webpay_credito","webpay_debito"].includes(d.medio)&&!d.codaut)return estadoPago("Ingresa el CodAut de WebPay.","error");
        if(["tarjeta_credito","tarjeta_debito"].includes(d.medio)&&(!d.folio||!d.bovtar))return estadoPago("Ingresa Folio y BOVTAR.","error");
        if(!window.haikuTienePermiso?.("pagos.registrar"))return estadoPago("Tu usuario no tiene permiso para registrar pagos.","error");
        registrando=true;const btn=document.getElementById("haiku-pago-confirmar"),txt=btn?.textContent||"Registrar pago";if(btn){btn.disabled=true;btn.textContent="Registrando..."}estadoPago("Registrando pago y saldo a favor...");
        try{
            // El parámetro RPC `p_bove` es un nombre heredado: en pagos de
            // tarjeta transporta BOVTAR. El BOVE SII se registra por su flujo propio.
            const{data,error}=await sb.rpc("haiku_registrar_pago_grupo",{p_reserva_id:d.reservaId,p_monto:d.monto,p_medio_pago:d.medio,p_etapa_operativa:"abono",p_fecha_pago:d.fecha,p_folio:["tarjeta_credito","tarjeta_debito"].includes(d.medio)?d.folio||null:null,p_codigo_autorizacion:["webpay_credito","webpay_debito"].includes(d.medio)?d.codaut||null:null,p_bove:["tarjeta_credito","tarjeta_debito"].includes(d.medio)?d.bovtar||null:null,p_referencia_externa:d.medio==="transferencia"?d.glosa||null:null,p_observaciones:d.observacion||null});if(error)throw error;
            window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("registrar pago con excedente");
            limpiarCache();await Promise.allSettled([window.haikuCargarAbonosSupabase?.(),window.haikuCargarSaldosCheckinSupabase?.(),window.haikuSincronizarReservasSupabase?.(),window.haikuCargarCheckoutSupabase?.(),window.HAIKU_EDITAR_ABONOS_V1?.refrescar?.()]);
            ["haiku-pago-monto","haiku-pago-glosa","haiku-pago-codaut","haiku-pago-folio","haiku-pago-bove","haiku-pago-observacion"].forEach(id=>{const el=document.getElementById(id);if(el)el.value=""});
            document.getElementById("haiku-pago-reserva")?.dispatchEvent(new Event("change",{bubbles:true}));
            const credito=Number(data?.saldo_a_favor_generado||0);setTimeout(()=>{estadoPago(credito>0?`Pago de ${money(d.monto)} registrado · ${money(credito)} quedaron como saldo a favor.`:`Pago de ${money(d.monto)} registrado.`,"exito");programar(50)},350);
        }catch(e){console.error("HAIKU · pago con excedente:",e);estadoPago(e?.message||"No fue posible registrar el pago.","error")}finally{registrando=false;if(btn?.isConnected){btn.textContent=txt;setTimeout(ajustarModalPago,30)}}
    }

    // ---------- Check-in ----------
    async function decorarCheckin(){
        const cards=[...document.querySelectorAll("#pagos-lista-checkin .haiku-saldo-v5[data-reserva-id],#pagos-lista-checkin .haiku-checkin-grupo-v2[data-reserva-id]")].filter(x=>!x.hidden);
        cards.forEach(card=>card.querySelectorAll("[data-haiku-saldo-monto],[data-grupo-saldo-monto]").forEach(i=>i.removeAttribute("max")));
        await Promise.allSettled(cards.map(async card=>{const id=card.dataset.reservaId;if(!id)return;const r=await resumen(id);if(window.HAIKU_PAGOS_REFRESH_V1?.interceptar("credito-en-vuelo"))return;const credito=Number(r?.saldo_a_favor||0);let b=card.querySelector(".haiku-checkin-saldo-favor");if(credito<=0){b?.remove();return}if(!b){b=document.createElement("div");b.className="haiku-checkin-saldo-favor";card.querySelector(".pago-checkin-resumen-nuevo")?.insertAdjacentElement("afterend",b)}const firma=String(credito);if(b.dataset.firma!==firma){b.dataset.firma=firma;b.innerHTML=`<span>Saldo a favor disponible</span><strong>${money(credito)}</strong>`}}));
    }

    // ---------- Check-out ----------
    function crearModal(){
        if(document.getElementById("haiku-saldo-favor-overlay"))return;
        const o=document.createElement("div");o.id="haiku-saldo-favor-overlay";o.className="haiku-saldo-favor-overlay";o.hidden=true;o.innerHTML=`<div class="haiku-saldo-favor-modal" role="dialog" aria-modal="true"><div class="haiku-saldo-favor-modal-head"><div><small>Control financiero</small><h3>Usar saldo a favor</h3></div><button type="button" data-credito-cerrar>×</button></div><div class="haiku-saldo-favor-modal-body"><div class="haiku-saldo-favor-total"><span>Disponible</span><strong id="credito-disponible">$0</strong></div><label class="haiku-saldo-favor-campo"><span>Aplicar a</span><select id="credito-cargo"></select></label><label class="haiku-saldo-favor-campo"><span>Monto a usar</span><div class="haiku-saldo-favor-monto"><span>$</span><input id="credito-monto" type="number" min="1" step="1000" inputmode="numeric"></div></label><div id="credito-preview" class="haiku-saldo-favor-preview"></div><div class="haiku-saldo-favor-origenes"><div class="haiku-saldo-favor-origenes-head"><span>Origen del saldo a favor</span><small>Se conservan los datos del pago original</small></div><div id="credito-fuentes"></div></div><div id="credito-estado" class="haiku-saldo-favor-estado"></div><div class="haiku-saldo-favor-actions"><button type="button" class="secundario" data-credito-cerrar>Cancelar</button><button type="button" id="credito-aplicar">Usar saldo a favor</button></div></div></div>`;document.body.appendChild(o);
        o.addEventListener("click",e=>{if(e.target===o)cerrarModal()});o.querySelectorAll("[data-credito-cerrar]").forEach(b=>b.addEventListener("click",cerrarModal));o.querySelector("#credito-cargo")?.addEventListener("change",actualizarModal);o.querySelector("#credito-monto")?.addEventListener("input",preview);o.querySelector("#credito-aplicar")?.addEventListener("click",aplicarCredito);
    }
    function cerrarModal(){const o=document.getElementById("haiku-saldo-favor-overlay");if(!o||aplicando)return;o.hidden=true;document.body.style.overflow="";resumenModal=null}
    function cargoActual(){const id=document.getElementById("credito-cargo")?.value||"";return(resumenModal?.cargos_servicio||[]).find(c=>String(c.cargo_id)===id)}
    function actualizarModal(){const c=cargoActual(),i=document.getElementById("credito-monto");if(!c||!i||!resumenModal)return;const max=Math.max(0,Math.min(Number(c.saldo||0),Number(resumenModal.saldo_a_favor||0)));i.max=String(max);i.value=String(max);preview()}
    function preview(){const c=cargoActual(),p=document.getElementById("credito-preview"),i=document.getElementById("credito-monto");if(!c||!p||!i||!resumenModal)return;const credito=Number(resumenModal.saldo_a_favor||0),saldo=Number(c.saldo||0),m=Math.max(0,Math.min(Math.round(Number(i.value||0)),credito,saldo));p.innerHTML=`<div><span>Saldo servicio después</span><strong>${money(saldo-m)}</strong></div><div><span>Saldo a favor después</span><strong>${money(credito-m)}</strong></div>`}
    async function abrirModal(reservaId){
        crearModal();const o=document.getElementById("haiku-saldo-favor-overlay");o.hidden=false;o.dataset.reservaId=String(reservaId);document.body.style.overflow="hidden";document.getElementById("credito-estado").textContent="Cargando...";document.getElementById("credito-aplicar").disabled=true;
        try{resumenModal=await resumen(reservaId,true);const credito=Number(resumenModal?.saldo_a_favor||0),cargos=(resumenModal?.cargos_servicio||[]).filter(c=>Number(c.saldo||0)>0);if(credito<=0)throw new Error("La reserva ya no tiene saldo a favor disponible.");if(!cargos.length)throw new Error("No hay servicios pendientes donde aplicar el saldo a favor.");document.getElementById("credito-disponible").textContent=money(credito);document.getElementById("credito-cargo").innerHTML=cargos.map(c=>`<option value="${esc(c.cargo_id)}">${esc(`${c.cabana?`CAB ${c.cabana} · `:""}${c.hora?`${hora(c.hora)} · `:""}${c.concepto} · Pend. ${money(c.saldo)}`)}</option>`).join("");document.getElementById("credito-fuentes").innerHTML=(resumenModal.fuentes||[]).map(f=>`<div class="haiku-saldo-favor-fuente"><div><strong>${money(f.disponible)}</strong><span>${esc(medio(f.medio_pago))}</span></div><small>${esc(origen(f,false))}</small></div>`).join("");document.getElementById("credito-estado").textContent="";document.getElementById("credito-aplicar").disabled=false;actualizarModal()}catch(e){console.error("HAIKU · modal saldo a favor:",e);document.getElementById("credito-estado").textContent=e?.message||"No fue posible cargar el saldo a favor."}
    }
    async function aplicarCredito(){
        if(aplicando||!resumenModal)return;const c=cargoActual(),o=document.getElementById("haiku-saldo-favor-overlay"),reservaId=o?.dataset.reservaId||"",m=Math.round(Number(document.getElementById("credito-monto")?.value||0)),max=Math.min(Number(c?.saldo||0),Number(resumenModal.saldo_a_favor||0));if(!c||!reservaId||m<=0||m>max)return document.getElementById("credito-estado").textContent="Revisa el monto a utilizar.";if(!window.haikuTienePermiso?.("pagos.registrar"))return document.getElementById("credito-estado").textContent="Tu usuario no tiene permiso para aplicar pagos.";
        aplicando=true;const b=document.getElementById("credito-aplicar"),txt=b.textContent;b.disabled=true;b.textContent="Aplicando...";document.getElementById("credito-estado").textContent="Aplicando saldo a favor...";
        try{const{data,error}=await sb.rpc("haiku_usar_saldo_favor",{p_reserva_id:reservaId,p_cargo_id:c.cargo_id,p_monto:m});if(error)throw error;window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("usar saldo a favor");limpiarCache();document.getElementById("credito-estado").textContent=`Se usaron ${money(data?.monto_usado||m)} · saldo del servicio ${money(data?.saldo_servicio_restante||0)}.`;await Promise.allSettled([window.haikuCargarCheckoutSupabase?.(),window.haikuCargarSaldosCheckinSupabase?.(),window.haikuCargarAbonosSupabase?.()]);setTimeout(()=>{aplicando=false;cerrarModal();programar(80)},420);return}catch(e){console.error("HAIKU · usar saldo a favor:",e);document.getElementById("credito-estado").textContent=e?.message||"No fue posible usar el saldo a favor."}finally{if(aplicando){aplicando=false;b.disabled=false;b.textContent=txt}}
    }
    async function decorarCheckout(){
        const cards=[...document.querySelectorAll("#pagos-lista-checkout .haiku-checkout-v1[data-reserva-id]")];
        await Promise.allSettled(cards.map(async card=>{const id=card.dataset.reservaId;if(!id)return;const r=await resumen(id);if(window.HAIKU_PAGOS_REFRESH_V1?.interceptar("credito-en-vuelo"))return;const credito=Number(r?.saldo_a_favor||0),cargos=(r?.cargos_servicio||[]).filter(c=>Number(c.saldo||0)>0);let p=card.querySelector(".haiku-checkout-saldo-favor");if(credito<=0||!cargos.length){p?.remove();return}if(!p){p=document.createElement("div");p.className="haiku-checkout-saldo-favor";const form=card.querySelector("[data-haiku-checkout-formulario]"),res=card.querySelector(".haiku-checkout-resumen");form?form.insertAdjacentElement("beforebegin",p):res?.insertAdjacentElement("afterend",p)}const fuentes=(r.fuentes||[]).slice(0,2),firma=JSON.stringify([credito,...fuentes.map(f=>[f.pago_id,f.disponible])]);if(p.dataset.firma===firma)return;p.dataset.firma=firma;p.innerHTML=`<div class="haiku-checkout-saldo-favor-head"><div><span>Saldo a favor</span><strong>${money(credito)}</strong></div><button type="button" data-usar-credito="${esc(id)}">Usar saldo a favor</button></div><div class="haiku-checkout-saldo-favor-origen">${fuentes.map(f=>`<small>${esc(origen(f))}</small>`).join("")}${(r.fuentes||[]).length>2?`<small>+ ${(r.fuentes||[]).length-2} origen(es) adicional(es)</small>`:""}</div>`}));
    }

    async function decorar(){
        if(window.HAIKU_PAGOS_REFRESH_V1?.interceptar("credito-decorar"))return decorarModalPago();
        await Promise.allSettled([decorarModalPago(),decorarCheckin(),decorarCheckout()]);
    }
    async function preparar(listaCheckin,listaCheckout){
        const cards=[...listaCheckin.querySelectorAll(".haiku-saldo-v5[data-reserva-id]"),...listaCheckout.querySelectorAll(".haiku-checkout-v1[data-reserva-id]")].filter(card=>!card.hidden);
        const ids=[...new Set(cards.map(card=>card.dataset.reservaId).filter(Boolean))];
        const resultados=await Promise.all(ids.map(async id=>{try{return[id,{data:await resumen(id,true,false,true)}]}catch(error){return[id,{error}]}}));
        return new Map(resultados);
    }
    function publicar(preparados,listaCheckin,listaCheckout){
        const checkin=[...listaCheckin.querySelectorAll(".haiku-saldo-v5[data-reserva-id]")].filter(card=>!card.hidden);
        for(const card of checkin){
            card.querySelectorAll("[data-haiku-saldo-monto],[data-grupo-saldo-monto]").forEach(input=>input.removeAttribute("max"));
            const resultado=preparados.get(card.dataset.reservaId);
            if(!resultado||resultado.error){const b=document.createElement("div");b.className="haiku-checkin-saldo-favor";b.textContent="Saldo a favor no disponible";card.querySelector(".pago-checkin-resumen-nuevo")?.insertAdjacentElement("afterend",b);continue}
            const credito=Number(resultado.data?.saldo_a_favor||0);if(credito<=0)continue;
            const b=document.createElement("div");b.className="haiku-checkin-saldo-favor";b.innerHTML=`<span>Saldo a favor disponible</span><strong>${money(credito)}</strong>`;
            card.querySelector(".pago-checkin-resumen-nuevo")?.insertAdjacentElement("afterend",b);
        }
        for(const card of listaCheckout.querySelectorAll(".haiku-checkout-v1[data-reserva-id]")){
            const id=card.dataset.reservaId,resultado=preparados.get(id);
            if(!resultado||resultado.error){const p=document.createElement("div");p.className="haiku-checkout-saldo-favor";p.textContent="Saldo a favor no disponible";card.querySelector(".haiku-checkout-resumen")?.insertAdjacentElement("afterend",p);continue}
            const r=resultado.data,credito=Number(r?.saldo_a_favor||0),cargos=(r?.cargos_servicio||[]).filter(c=>Number(c.saldo||0)>0);if(credito<=0||!cargos.length)continue;
            const fuentes=(r.fuentes||[]).slice(0,2),p=document.createElement("div");p.className="haiku-checkout-saldo-favor";
            p.innerHTML=`<div class="haiku-checkout-saldo-favor-head"><div><span>Saldo a favor</span><strong>${money(credito)}</strong></div><button type="button" data-usar-credito="${esc(id)}">Usar saldo a favor</button></div><div class="haiku-checkout-saldo-favor-origen">${fuentes.map(f=>`<small>${esc(origen(f))}</small>`).join("")}${(r.fuentes||[]).length>2?`<small>+ ${(r.fuentes||[]).length-2} origen(es) adicional(es)</small>`:""}</div>`;
            const form=card.querySelector("[data-haiku-checkout-formulario]"),res=card.querySelector(".haiku-checkout-resumen");form?form.insertAdjacentElement("beforebegin",p):res?.insertAdjacentElement("afterend",p);
        }
    }

    // Sólo captura el caso excedente; el pago normal queda a cargo del módulo existente.
    document.addEventListener("click",e=>{const b=e.target.closest?.("#haiku-pago-confirmar");if(!b||document.getElementById("haiku-abono-edicion-aviso"))return;const d=datosModal(),saldo=numeroTexto("haiku-pago-saldo");if(!(d.monto>saldo||saldo<=0))return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();registrarExcedente()},true);
    document.addEventListener("click",e=>{const b=e.target.closest?.("[data-usar-credito]");if(!b)return;e.preventDefault();abrirModal(b.dataset.usarCredito||"")});
    document.addEventListener("input",e=>{if(e.target.matches?.("#haiku-pago-monto"))setTimeout(ajustarModalPago,0);if(e.target.matches?.("[data-haiku-saldo-monto],[data-grupo-saldo-monto]"))e.target.removeAttribute("max")});
    document.addEventListener("change",e=>{if(e.target.matches?.("#haiku-pago-reserva,#haiku-pago-medio,#haiku-pago-fecha")){if(e.target.matches("#haiku-pago-reserva"))limpiarCache(e.target.value);setTimeout(()=>{decorarModalPago();ajustarModalPago()},220);setTimeout(ajustarModalPago,650)}});
    document.addEventListener("haiku:servicio-supabase-cambiado",()=>{limpiarCache();programar(140)});
    document.addEventListener("click",e=>{if(e.target.closest?.('[data-seccion="pagos"],.menu-item[data-seccion="pagos"]'))programar(180)});
    window.addEventListener("haiku:auth-ready",()=>{limpiarCache();programar(320)});

    // Sólo observamos reemplazos directos de las listas; no nuestros propios bloques internos.
    const checkin=document.getElementById("pagos-lista-checkin"),checkout=document.getElementById("pagos-lista-checkout");
    if(checkin)new MutationObserver(()=>programar(80)).observe(checkin,{childList:true});
    if(checkout)new MutationObserver(()=>programar(80)).observe(checkout,{childList:true});

    const css=document.createElement("style");css.id="haiku-saldo-favor-v2-css";css.textContent=`
      #haiku-pago-resumen{grid-template-columns:repeat(4,minmax(0,1fr))}.haiku-pago-saldo-favor-celda strong,#haiku-pago-saldo-favor{color:#18724a}
      .haiku-pago-excedente-preview{margin:-4px 0 13px;padding:10px 12px;border:1px solid #bee0ca;border-radius:10px;background:#f2faf5;display:grid;gap:3px}.haiku-pago-excedente-preview strong{font-size:10px;color:#1b6b45}.haiku-pago-excedente-preview span{font-size:9px;color:#607067;line-height:1.4}
      .haiku-checkin-saldo-favor{margin:9px 0;padding:9px 11px;border:1px solid #bee0ca;border-radius:9px;background:#f2faf5;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:10px;color:#557064}.haiku-checkin-saldo-favor strong{color:#176a43;font-size:13px}
      .haiku-checkout-saldo-favor{margin:12px 0;padding:11px 12px;border:1px solid #b8ddc5;border-radius:10px;background:#f2faf5;display:grid;gap:8px}.haiku-checkout-saldo-favor-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.haiku-checkout-saldo-favor-head>div{display:flex;align-items:baseline;gap:8px}.haiku-checkout-saldo-favor-head span{font-size:11px;color:#537063}.haiku-checkout-saldo-favor-head strong{font-size:15px;color:#176a43}.haiku-checkout-saldo-favor-head button{border:0;border-radius:8px;background:#287b55;color:#fff;padding:8px 11px;font:inherit;font-size:10px;font-weight:750;cursor:pointer}.haiku-checkout-saldo-favor-origen{display:grid;gap:3px;padding-top:7px;border-top:1px solid #d7eadf}.haiku-checkout-saldo-favor-origen small{font-size:9px;line-height:1.35;color:#65766d;overflow-wrap:anywhere}
      .haiku-saldo-favor-overlay{position:fixed;inset:0;z-index:100000;background:rgba(19,31,25,.48);display:grid;place-items:center;padding:18px}.haiku-saldo-favor-overlay[hidden]{display:none!important}.haiku-saldo-favor-modal{width:min(560px,calc(100vw - 28px));max-height:calc(100vh - 36px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.24);color:#26332c}.haiku-saldo-favor-modal-head{padding:20px 22px 15px;border-bottom:1px solid #e5eae7;display:flex;align-items:flex-start;justify-content:space-between;gap:15px}.haiku-saldo-favor-modal-head small{text-transform:uppercase;letter-spacing:.16em;color:#24704d;font-size:9px;font-weight:800}.haiku-saldo-favor-modal-head h3{margin:4px 0 0;font-size:21px}.haiku-saldo-favor-modal-head button{width:34px;height:34px;border:1px solid #dbe2dd;border-radius:50%;background:#fff;font-size:18px;cursor:pointer}.haiku-saldo-favor-modal-body{padding:18px 22px 22px;display:grid;gap:14px}.haiku-saldo-favor-total{border:1px solid #bde0ca;background:#f2faf5;border-radius:11px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between}.haiku-saldo-favor-total span{font-size:11px;color:#5a7165}.haiku-saldo-favor-total strong{font-size:18px;color:#176a43}.haiku-saldo-favor-campo{display:grid;gap:6px;font-size:10px;color:#5a675f}.haiku-saldo-favor-campo select,.haiku-saldo-favor-campo input{width:100%;box-sizing:border-box;min-height:40px;border:1px solid #d8e0db;border-radius:9px;background:#fff;padding:0 10px;font:inherit;color:#26332c}.haiku-saldo-favor-monto{display:flex;align-items:center;border:1px solid #d8e0db;border-radius:9px;overflow:hidden}.haiku-saldo-favor-monto>span{padding-left:10px;color:#5e6b64}.haiku-saldo-favor-monto input{border:0!important}.haiku-saldo-favor-preview{display:grid;grid-template-columns:1fr 1fr;gap:8px}.haiku-saldo-favor-preview>div{border:1px solid #e0e6e2;border-radius:9px;padding:9px 10px;display:grid;gap:3px}.haiku-saldo-favor-preview span{font-size:9px;color:#68746d}.haiku-saldo-favor-preview strong{font-size:12px}.haiku-saldo-favor-origenes{border:1px solid #e0e6e2;border-radius:10px;padding:10px 11px}.haiku-saldo-favor-origenes-head{display:grid;gap:2px;padding-bottom:8px;border-bottom:1px solid #edf1ee}.haiku-saldo-favor-origenes-head span{font-size:10px;font-weight:750}.haiku-saldo-favor-origenes-head small{font-size:8px;color:#78827c}.haiku-saldo-favor-fuente{padding:8px 0;display:grid;gap:4px}.haiku-saldo-favor-fuente+.haiku-saldo-favor-fuente{border-top:1px solid #edf1ee}.haiku-saldo-favor-fuente>div{display:flex;gap:7px;align-items:baseline}.haiku-saldo-favor-fuente strong{font-size:12px;color:#176a43}.haiku-saldo-favor-fuente span{font-size:10px}.haiku-saldo-favor-fuente small{font-size:8.5px;color:#6d7871;overflow-wrap:anywhere}.haiku-saldo-favor-estado{min-height:14px;font-size:9px;color:#617068}.haiku-saldo-favor-actions{display:flex;justify-content:flex-end;gap:9px;border-top:1px solid #e6ebe8;padding-top:13px}.haiku-saldo-favor-actions button{min-height:39px;border:0;border-radius:9px;padding:0 14px;background:#287b55;color:#fff;font:inherit;font-size:10px;font-weight:750;cursor:pointer}.haiku-saldo-favor-actions button.secundario{border:1px solid #d9e0dc;background:#fff;color:#44534b}.haiku-saldo-favor-actions button:disabled{opacity:.6;cursor:wait}
      @media(max-width:700px){#haiku-pago-resumen{grid-template-columns:repeat(2,minmax(0,1fr))}.haiku-checkout-saldo-favor-head{align-items:flex-start;flex-direction:column}.haiku-checkout-saldo-favor-head button{width:100%}.haiku-saldo-favor-preview{grid-template-columns:1fr}.haiku-saldo-favor-modal-body{padding:15px}.haiku-saldo-favor-modal-head{padding:17px 15px 13px}}
    `;if(!document.getElementById(css.id))document.head.appendChild(css);

    crearModal();setInterval(()=>programar(0),30000);setTimeout(()=>programar(0),950);
    window.HAIKU_SALDO_FAVOR_V2=Object.freeze({refrescar:()=>{limpiarCache();return decorar()},resumen,abrir:abrirModal,preparar,publicar});
    console.info("HAIKU · Saldo a favor V2 preparado.");
})();
