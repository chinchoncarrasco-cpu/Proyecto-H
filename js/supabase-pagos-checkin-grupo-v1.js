// ========================================
// HAIKU · SALDO CHECK-IN · RESERVA CONJUNTA V1
// Fusiona visualmente reservas del mismo grupo y cobra el saldo como una sola unidad.
// ========================================
(() => {
    "use strict";

    const sb = window.haikuSupabase;
    if (!sb) return;

    let procesando = false;
    let guardando = false;
    let timer = 0;
    let observer = null;
    const borradores = new Map();

    const MEDIOS = Object.freeze({
        "Transferencia":"transferencia",
        "WebPay Crédito":"webpay_credito",
        "WebPay Débito":"webpay_debito",
        "Tarjeta Crédito":"tarjeta_credito",
        "Tarjeta Débito":"tarjeta_debito",
        "Airbnb Prepaid Card": "airbnb_prepaid_card", "Efectivo":"efectivo"
    });

    function esc(v){
        return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
    }
    function money(v){ return "$" + Math.round(Number(v||0)).toLocaleString("es-CL"); }
    function fecha(){ try{return String(fechaSeleccionada||"").slice(0,10);}catch{return "";} }
    function opciones(valor=""){
        return `<option value="">Seleccionar...</option>` + Object.keys(MEDIOS).map(x=>`<option value="${valorMedio(x)}" ${(valor === x || valor === valorMedio(x)) ?"selected":""}>${x}</option>`).join("");
    }

    async function ingresosDia(){
        const f=fecha(); if(!f) return [];
        const {data,error}=await sb.rpc("haiku_operacion_dia",{p_fecha:f});
        if(error) throw error;
        return (data||[]).filter(x=>["libre-ingresa","sale-ingresa","fullday"].includes(x.estado_operativo)).map(x=>({
            numero:Number(x.numero),
            titular:x.estado_operativo==="fullday"?x.fullday_titular:x.ingreso_titular,
            reservaId:String(x.estado_operativo==="fullday"?x.fullday_reserva_id:x.ingreso_reserva_id||"")
        })).filter(x=>x.reservaId);
    }

    async function gruposDelDia(){
        const ingresos=await ingresosDia();
        if(!ingresos.length) return [];
        const ids=[...new Set(ingresos.map(x=>x.reservaId))];
        const {data,error}=await sb.from("reservas").select("id,grupo_reserva_id,titular_nombre,bove_cierre,bove_cierre_registrado_en").in("id",ids);
        if(error) throw error;
        const meta=new Map((data||[]).map(r=>[String(r.id),r]));
        const grupos=new Map();
        for(const item of ingresos){
            const r=meta.get(item.reservaId);
            if(!r?.grupo_reserva_id) continue;
            const key=String(r.grupo_reserva_id);
            if(!grupos.has(key)) grupos.set(key,{grupoId:key,titular:r.titular_nombre||item.titular||"Sin titular",miembros:[]});
            grupos.get(key).miembros.push({...item,bove:r.bove_cierre||"",boveEn:r.bove_cierre_registrado_en||null});
        }
        return [...grupos.values()].filter(g=>g.miembros.length>1);
    }

    async function finanzas(reservaId){
        const {data,error}=await sb.rpc("haiku_finanzas_grupo",{p_reserva_id:reservaId});
        if(error) throw error;
        return data||{};
    }

    function requisitos(medio){
        if(medio==="transferencia") return {glosa:true,folio:false,codaut:false};
        if(["webpay_credito","webpay_debito"].includes(medio)) return {glosa:false,folio:false,codaut:true};
        if(["tarjeta_credito","tarjeta_debito"].includes(medio)) return {glosa:false,folio:true,codaut:true};
        return {glosa:false,folio:false,codaut:false};
    }

    function guardarBorrador(card){
        const id=card?.dataset?.grupoId; if(!id) return;
        borradores.set(id,{
            monto:Number(card.querySelector("[data-grupo-saldo-monto]")?.value||0),
            medio:card.querySelector("[data-grupo-saldo-medio]")?.value||"",
            glosa:card.querySelector("[data-grupo-saldo-glosa]")?.value?.trim()||"",
            folio:card.querySelector("[data-grupo-saldo-folio]")?.value?.trim()||"",
            codaut:card.querySelector("[data-grupo-saldo-codaut]")?.value?.trim()||"",
            manager:card.querySelector("[data-grupo-saldo-manager]")?.checked===true
        });
    }

    function ajustarCampos(card){
        const medioUI=card.querySelector("[data-grupo-saldo-medio]")?.value||"";
        const req=requisitos(codigoMedio(medioUI));
        [["glosa",req.glosa],["folio",req.folio],["codaut",req.codaut]].forEach(([k,on])=>{
            const el=card.querySelector(`[data-grupo-campo-${k}]`); if(el) el.hidden=!on; if(k==="glosa") referenciaOpcional(el,card.querySelector("[data-grupo-saldo-glosa]"),codigoMedio(medioUI));
        });
    }

    function htmlGrupo(g, f){
        const total=Number(f.total_alojamiento||0), saldo=Number(f.saldo_alojamiento||0);
        const miembros=(f.miembros||[]).length?(f.miembros||[]):g.miembros.map(m=>({cabana:m.numero,reserva_id:m.reservaId}));
        const cabs=miembros.map(m=>Number(m.cabana)).filter(Boolean).sort((a,b)=>a-b);
        const draft=borradores.get(g.grupoId)||{monto:saldo,medio:"",glosa:"",folio:"",codaut:"",manager:false};
        const boves=g.miembros.map(m=>m.bove).filter(Boolean);
        const boveComun=boves.length===g.miembros.length && new Set(boves).size===1 ? boves[0] : "";
        const servicios=Number(f.servicios_pendientes||0);

        return `<div class="pago-checkin-nuevo haiku-checkin-grupo-cuerpo">
            <div class="pago-checkin-cabecera">
                <div class="pago-checkin-identidad haiku-checkin-grupo-identidad"><strong>↳ ${esc(g.titular)}</strong><span>· ${cabs.map(n=>`CAB ${n}`).join(" + ")}</span></div>
                <span class="pago-checkin-estado">${saldo<=0?"✓ Pagado":"Pendiente"}</span>
            </div>
            <div class="haiku-checkin-grupo-vinculo">Reserva conjunta · ${g.miembros.length} alojamientos</div>
            <div class="pago-checkin-resumen-nuevo">
                <label class="pago-checkin-grupo"><span class="pago-checkin-label">Total grupo</span><div class="pago-checkin-input-monto"><span>$</span><input type="text" value="${Math.round(total).toLocaleString("es-CL")}" readonly></div></label>
                <div class="pago-checkin-saldo-nuevo"><span>Saldo grupo</span><strong>${money(saldo)}</strong></div>
            </div>
            ${saldo>0?`
            <div class="haiku-saldo-formulario haiku-saldo-grupo-formulario">
                <div class="haiku-saldo-form-grid">
                    <label><span>Monto de este pago</span><div class="pago-checkin-input-monto"><span>$</span><input type="number" data-grupo-saldo-monto min="1" step="1000" max="${saldo}" value="${Number(draft.monto||saldo)}"></div></label>
                    <label><span>Medio de pago</span><select data-grupo-saldo-medio>${opciones(draft.medio)}</select></label>
                </div>
                <div class="haiku-saldo-datos-dinamicos">
                    <label data-grupo-campo-glosa hidden><span>Glosa</span><input type="text" data-grupo-saldo-glosa value="${esc(draft.glosa)}" placeholder="Pegar glosa bancaria"></label>
                    <label data-grupo-campo-folio hidden><span>Folio</span><input type="text" data-grupo-saldo-folio value="${esc(draft.folio)}" placeholder="Rellenar"></label>
                    <label data-grupo-campo-codaut hidden><span>CodAut</span><input type="text" data-grupo-saldo-codaut value="${esc(draft.codaut)}" placeholder="Rellenar"></label>
                    <label class="haiku-saldo-manager"><span>Manager</span><span class="haiku-saldo-check-wrap"><input type="checkbox" data-grupo-saldo-manager ${draft.manager?"checked":""}>Revisado</span></label>
                </div>
                <button type="button" class="haiku-saldo-registrar" data-grupo-saldo-registrar>Registrar pago conjunto</button>
            </div>`:`
            <div class="haiku-bove-cierre ${boveComun?"haiku-bove-ok":"haiku-bove-pendiente"}">
                ${boveComun?`<strong>✓ BOVE alojamiento conjunto registrado</strong><span>${esc(boveComun)}</span>`:`<strong>Alojamiento conjunto pagado · falta BOVE</strong><span>Registra un único BOVE por el total de los alojamientos vinculados.</span><div class="haiku-bove-fila"><input type="text" data-grupo-bove placeholder="BOVE alojamiento"><button type="button" data-grupo-bove-registrar>Registrar BOVE</button></div>`}
            </div>`}
            ${servicios>0?`<div class="haiku-checkin-grupo-servicios"><span>Servicios pendientes del grupo</span><strong>${money(servicios)}</strong><small>Se mantienen separados del alojamiento y se gestionan en Check-out.</small></div>`:""}
        </div>`;
    }

    function observar(lista){
        if(!lista) return;
        if(!observer) observer=new MutationObserver(()=>luego(90));
        observer.disconnect();
        observer.observe(lista,{childList:true});
    }

    async function aplicar(){
        if(procesando||!window.haikuSesion) return;
        const lista=document.getElementById("pagos-lista-checkin");
        if(!lista) return;
        procesando=true;
        observer?.disconnect();
        try{
            const grupos=await gruposDelDia();
            lista.querySelectorAll('[data-haiku-oculto-por-grupo="1"]').forEach(el=>{el.hidden=false;delete el.dataset.haikuOcultoPorGrupo;});
            lista.querySelectorAll('.haiku-checkin-grupo-v1').forEach(el=>el.remove());

            for(const g of grupos){
                const ids=g.miembros.map(m=>m.reservaId);
                const originales=ids.map(id=>lista.querySelector(`.pago-checkin-item[data-reserva-id="${CSS.escape(id)}"]`)).filter(Boolean);
                if(originales.length<2) continue;
                const f=await finanzas(ids[0]);
                const card=document.createElement("div");
                card.className="pago-checkin-item haiku-checkin-grupo-v1";
                card.dataset.grupoId=g.grupoId;
                card.dataset.reservaId=ids[0];
                card.dataset.miembros=ids.join(",");
                card.innerHTML=htmlGrupo(g,f);
                originales[0].insertAdjacentElement("beforebegin",card);
                originales.forEach(el=>{el.hidden=true;el.dataset.haikuOcultoPorGrupo="1";});
                ajustarCampos(card);
            }

            const contador=document.getElementById("pagos-contador-checkin");
            if(contador){
                const visibles=[...lista.querySelectorAll(".pago-checkin-item")].filter(x=>!x.hidden);
                contador.textContent=String(visibles.filter(x=>(x.querySelector(".pago-checkin-estado")?.textContent||"").includes("Pendiente")).length);
            }
        }catch(e){
            console.warn("HAIKU · Check-in grupo:",e);
        }finally{
            procesando=false;
            observar(lista);
        }
    }

    function luego(ms=70){ clearTimeout(timer); timer=setTimeout(()=>aplicar(),ms); }

    async function registrarPago(card){
        if(guardando) return;
        const reservaId=card.dataset.reservaId||"";
        const monto=Math.round(Number(card.querySelector("[data-grupo-saldo-monto]")?.value||0));
        const medioUI=card.querySelector("[data-grupo-saldo-medio]")?.value||"";
        const medio=codigoMedio(medioUI);
        const glosa=card.querySelector("[data-grupo-saldo-glosa]")?.value?.trim()||"";
        const folio=card.querySelector("[data-grupo-saldo-folio]")?.value?.trim()||"";
        const codaut=card.querySelector("[data-grupo-saldo-codaut]")?.value?.trim()||"";
        const manager=card.querySelector("[data-grupo-saldo-manager]")?.checked===true;
        if(!reservaId||monto<=0||!medio){alert("Completa monto y medio de pago.");return;}
        if(!manager){alert("El pago debe ser revisado por Manager.");return;}
        const req=requisitos(medio);
        if(req.glosa&&!glosa){alert("Transferencia requiere Glosa.");return;}
        if(req.folio&&!folio){alert("Completa el Folio.");return;}
        if(req.codaut&&!codaut){alert("Completa el CodAut.");return;}
        if(!window.haikuTienePermiso?.("pagos.registrar")||!window.haikuTienePermiso?.("pagos.verificar")){alert("Tu usuario no tiene permiso para registrar/verificar este pago.");return;}

        guardarBorrador(card); guardando=true;
        const btn=card.querySelector("[data-grupo-saldo-registrar]"); if(btn){btn.disabled=true;btn.textContent="Registrando...";}
        try{
            const {error}=await sb.rpc("haiku_registrar_pago_checkin_grupo",{
                p_reserva_id:reservaId,p_monto:monto,p_medio_pago:medio,p_glosa:glosa||null,p_folio:medio === "airbnb_prepaid_card" ? null : (folio||null),p_codigo_autorizacion:medio === "airbnb_prepaid_card" ? null : (codaut||null),p_manager_revisado:true
            });
            if(error) throw error;
            borradores.delete(card.dataset.grupoId||"");
            await Promise.allSettled([
                Promise.resolve().then(()=>window.haikuCargarSaldosCheckinSupabase?.()),
                Promise.resolve().then(()=>window.haikuCargarAbonosSupabase?.()),
                Promise.resolve().then(()=>window.haikuSincronizarReservasSupabase?.())
            ]);
            luego(140);
        }catch(e){console.error("HAIKU · pago check-in conjunto:",e);alert(e?.message||"No fue posible registrar el pago conjunto.");}
        finally{guardando=false;if(btn?.isConnected){btn.disabled=false;btn.textContent="Registrar pago conjunto";}}
    }

    async function registrarBove(card){
        const reservaId=card.dataset.reservaId||"";
        const valor=card.querySelector("[data-grupo-bove]")?.value?.trim()||"";
        if(!reservaId||!valor){alert("Ingresa el BOVE del alojamiento.");return;}
        if(!window.haikuTienePermiso?.("pagos.verificar")){alert("Tu usuario no tiene permiso para registrar BOVE.");return;}
        const btn=card.querySelector("[data-grupo-bove-registrar]"); if(btn){btn.disabled=true;btn.textContent="Registrando...";}
        try{
            const {error}=await sb.rpc("haiku_registrar_bove_reserva_grupo",{p_reserva_id:reservaId,p_bove:valor});
            if(error) throw error;
            await window.haikuCargarSaldosCheckinSupabase?.();
            luego(140);
        }catch(e){console.error("HAIKU · BOVE grupo:",e);alert(e?.message||"No fue posible registrar el BOVE conjunto.");}
        finally{if(btn?.isConnected){btn.disabled=false;btn.textContent="Registrar BOVE";}}
    }

    document.addEventListener("change",e=>{
        const card=e.target.closest?.(".haiku-checkin-grupo-v1"); if(!card) return;
        if(e.target.matches("[data-grupo-saldo-medio]")){guardarBorrador(card);ajustarCampos(card);}
        else if(e.target.matches("[data-grupo-saldo-monto],[data-grupo-saldo-manager]")){guardarBorrador(card);}
    },true);
    document.addEventListener("input",e=>{const card=e.target.closest?.(".haiku-checkin-grupo-v1");if(card&&e.target.matches("[data-grupo-saldo-glosa],[data-grupo-saldo-folio],[data-grupo-saldo-codaut]"))guardarBorrador(card);},true);
    document.addEventListener("click",e=>{
        const card=e.target.closest?.(".haiku-checkin-grupo-v1"); if(!card) return;
        if(e.target.closest("[data-grupo-saldo-registrar]")){e.preventDefault();e.stopPropagation();registrarPago(card);}
        if(e.target.closest("[data-grupo-bove-registrar]")){e.preventDefault();e.stopPropagation();registrarBove(card);}
    },true);

    function instalar(){
        const lista=document.getElementById("pagos-lista-checkin");
        if(lista) observar(lista);
        luego(140);
    }
    document.addEventListener("click",e=>{if(e.target.closest?.('[data-seccion="pagos"]'))setTimeout(instalar,120);});
    window.addEventListener("haiku:auth-ready",()=>setTimeout(instalar,180));
    setTimeout(instalar,260);
    window.haikuAplicarCheckinGrupos=aplicar;
    console.info("HAIKU · Check-in conjunto V1 preparado.");

    function codigoMedio(valor) { return valor === "airbnb_prepaid_card" ? valor : MEDIOS[valor] || ""; }
    function valorMedio(nombre) { return nombre === "Airbnb Prepaid Card" ? "airbnb_prepaid_card" : nombre; }
    function referenciaOpcional(fila, input, medio) {
        if (!fila || !input) return;
        const airbnb = medio === "airbnb_prepaid_card";
        const titulo = fila.querySelector("span");
        if (titulo) titulo.textContent = airbnb ? "Referencia Airbnb / externa (opcional)" : "Glosa";
        input.placeholder = airbnb ? "Referencia real, si existe" : "Pegar glosa bancaria";
        if (airbnb) { fila.hidden = false; input.removeAttribute("required"); }
    }
})();