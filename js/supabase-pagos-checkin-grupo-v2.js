// ========================================
// HAIKU · SALDO CHECK-IN · RESERVA CONJUNTA V2
// Fusiona visualmente reservas del mismo grupo y cobra el saldo como una sola unidad.
// Compatibilidad V5: evita re-render cruzado y hereda el diseño actual de Pagos.
// ========================================
(() => {
    "use strict";
    const sb=window.haikuSupabase;if(!sb)return;
    let procesando=false,guardando=false,timer=0,observer=null;
    const borradores=new Map();
    const MEDIOS=Object.freeze({"Transferencia":"transferencia","WebPay Crédito":"webpay_credito","WebPay Débito":"webpay_debito","Tarjeta Crédito":"tarjeta_credito","Tarjeta Débito":"tarjeta_debito","Efectivo":"efectivo"});
    const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
    const money=v=>"$"+Math.round(Number(v||0)).toLocaleString("es-CL");
    const fecha=()=>{try{return String(fechaSeleccionada||"").slice(0,10)}catch{return""}};
    const opciones=(v="")=>`<option value="">Seleccionar...</option>`+Object.keys(MEDIOS).map(x=>`<option value="${x}" ${v===x?"selected":""}>${x}</option>`).join("");

    async function ingresosDia(operacion){
        const f=fecha();if(!f)return[];
        const{data,error}=operacion?{data:operacion,error:null}:await sb.rpc("haiku_operacion_dia",{p_fecha:f});if(error)throw error;
        return(data||[]).filter(x=>["libre-ingresa","sale-ingresa","fullday"].includes(x.estado_operativo)).map(x=>({numero:Number(x.numero),titular:x.estado_operativo==="fullday"?x.fullday_titular:x.ingreso_titular,reservaId:String(x.estado_operativo==="fullday"?x.fullday_reserva_id:x.ingreso_reserva_id||"")})).filter(x=>x.reservaId);
    }
    async function gruposDelDia(operacion){
        const ingresos=await ingresosDia(operacion);if(!ingresos.length)return[];
        const ids=[...new Set(ingresos.map(x=>x.reservaId))];
        const{data,error}=await sb.from("reservas").select("id,grupo_reserva_id,titular_nombre,bove_cierre,bove_cierre_registrado_en").in("id",ids);if(error)throw error;
        const meta=new Map((data||[]).map(r=>[String(r.id),r])),grupos=new Map();
        for(const item of ingresos){const r=meta.get(item.reservaId);if(!r?.grupo_reserva_id)continue;const key=String(r.grupo_reserva_id);if(!grupos.has(key))grupos.set(key,{grupoId:key,titular:r.titular_nombre||item.titular||"Sin titular",miembros:[]});grupos.get(key).miembros.push({...item,bove:r.bove_cierre||"",boveEn:r.bove_cierre_registrado_en||null});}
        return[...grupos.values()].filter(g=>g.miembros.length>1);
    }
    async function finanzas(id){const{data,error}=await sb.rpc("haiku_finanzas_grupo",{p_reserva_id:id});if(error)throw error;return data||{}}
    function requisitos(m){if(m==="transferencia")return{glosa:true,folio:false,codaut:false};if(["webpay_credito","webpay_debito"].includes(m))return{glosa:false,folio:false,codaut:true};if(["tarjeta_credito","tarjeta_debito"].includes(m))return{glosa:false,folio:true,codaut:true};return{glosa:false,folio:false,codaut:false}}
    function guardar(card){const id=card?.dataset?.grupoId;if(!id)return;borradores.set(id,{monto:Number(card.querySelector("[data-grupo-saldo-monto]")?.value||0),medio:card.querySelector("[data-grupo-saldo-medio]")?.value||"",glosa:card.querySelector("[data-grupo-saldo-glosa]")?.value?.trim()||"",folio:card.querySelector("[data-grupo-saldo-folio]")?.value?.trim()||"",codaut:card.querySelector("[data-grupo-saldo-codaut]")?.value?.trim()||"",manager:card.querySelector("[data-grupo-saldo-manager]")?.checked===true});}
    function campos(card){const ui=card.querySelector("[data-grupo-saldo-medio]")?.value||"",r=requisitos(MEDIOS[ui]||"");[["glosa",r.glosa],["folio",r.folio],["codaut",r.codaut]].forEach(([k,on])=>{const el=card.querySelector(`[data-grupo-campo-${k}]`);if(el)el.hidden=!on});}

    function htmlGrupo(g,f){
        const total=Number(f.total_alojamiento||0),saldo=Number(f.saldo_alojamiento||0),miembros=(f.miembros||[]).length?f.miembros:g.miembros.map(m=>({cabana:m.numero,reserva_id:m.reservaId})),cabs=miembros.map(m=>Number(m.cabana)).filter(Boolean).sort((a,b)=>a-b),d=borradores.get(g.grupoId)||{monto:saldo,medio:"",glosa:"",folio:"",codaut:"",manager:false},boves=g.miembros.map(m=>m.bove).filter(Boolean),boveComun=boves.length===g.miembros.length&&new Set(boves).size===1?boves[0]:"",servicios=Number(f.servicios_pendientes||0);
        return `<div class="pago-checkin-nuevo haiku-checkin-grupo-cuerpo">
        <div class="pago-checkin-cabecera"><div class="pago-checkin-identidad haiku-checkin-grupo-identidad"><strong>↳ ${esc(g.titular)}</strong><span>· ${cabs.map(n=>`CAB ${n}`).join(" + ")}</span></div><span class="pago-checkin-estado">${saldo<=0?"✓ Pagado":"Pendiente"}</span></div>
        <div class="haiku-checkin-grupo-vinculo">Reserva conjunta · ${g.miembros.length} alojamientos</div>
        <div class="pago-checkin-resumen-nuevo"><div class="haiku-saldo-resumen-celda"><span>Total grupo</span><strong>${money(total)}</strong></div><div class="haiku-saldo-resumen-celda"><span>Saldo grupo</span><strong>${money(saldo)}</strong></div></div>
        ${saldo>0?`<div class="haiku-saldo-formulario haiku-saldo-grupo-formulario"><div class="haiku-saldo-form-grid"><label><span>Monto de este pago</span><div class="pago-checkin-input-monto"><span>$</span><input type="number" data-grupo-saldo-monto min="1" step="1000" max="${saldo}" value="${Number(d.monto||saldo)}"></div></label><label><span>Medio de pago</span><select data-grupo-saldo-medio>${opciones(d.medio)}</select></label></div><div class="haiku-saldo-datos-dinamicos"><label data-grupo-campo-glosa hidden><span>Glosa</span><input type="text" data-grupo-saldo-glosa value="${esc(d.glosa)}" placeholder="Pegar glosa bancaria"></label><label data-grupo-campo-folio hidden><span>Folio</span><input type="text" data-grupo-saldo-folio value="${esc(d.folio)}" placeholder="Rellenar"></label><label data-grupo-campo-codaut hidden><span>CodAut</span><input type="text" data-grupo-saldo-codaut value="${esc(d.codaut)}" placeholder="Rellenar"></label><label class="haiku-saldo-manager"><span>Manager</span><span class="haiku-saldo-check-wrap"><input type="checkbox" data-grupo-saldo-manager ${d.manager?"checked":""}>Revisado</span></label></div><button type="button" class="haiku-saldo-registrar" data-grupo-saldo-registrar>Registrar pago conjunto</button></div>`:`<div class="haiku-bove-cierre ${boveComun?"haiku-bove-ok":"haiku-bove-pendiente"}">${boveComun?`<strong>✓ BOVE alojamiento conjunto registrado</strong><span>${esc(boveComun)}</span>`:`<strong>Alojamiento conjunto pagado · falta BOVE</strong><span>Registra un único BOVE por el total de los alojamientos vinculados.</span><div class="haiku-bove-fila"><input type="text" data-grupo-bove placeholder="BOVE alojamiento"><button type="button" data-grupo-bove-registrar>Registrar BOVE</button></div>`}</div>`}
        ${servicios>0?`<div class="haiku-checkin-grupo-servicios"><span>Servicios pendientes del grupo</span><strong>${money(servicios)}</strong><small>Se mantienen separados del alojamiento y se gestionan en Check-out.</small></div>`:""}</div>`;
    }
    function observar(lista){if(!lista)return;if(!observer)observer=new MutationObserver(()=>luego(100));observer.disconnect();observer.observe(lista,{childList:true});}
    async function preparar({operacion}={}){
        const grupos=await gruposDelDia(operacion);
        return Promise.all(grupos.map(async g=>{const f=await finanzas(g.miembros[0].reservaId);if(!f||f.saldo_alojamiento==null||f.total_alojamiento==null||!Number.isFinite(Number(f.saldo_alojamiento)))throw new Error("No está disponible la autoridad financiera del grupo.");return{g,f}}));
    }
    function publicar(preparados,lista,contador){
            lista.querySelectorAll('[data-haiku-oculto-por-grupo="1"]').forEach(el=>{el.hidden=false;delete el.dataset.haikuOcultoPorGrupo});
            lista.querySelectorAll(".haiku-checkin-grupo-v1,.haiku-checkin-grupo-v2").forEach(el=>el.remove());
            for(const {g,f} of preparados){const ids=g.miembros.map(m=>m.reservaId),originales=ids.map(id=>lista.querySelector(`.pago-checkin-item[data-reserva-id="${CSS.escape(id)}"]`)).filter(Boolean);if(originales.length<2)continue;const card=document.createElement("div");card.className="pago-checkin-item haiku-saldo-v4 haiku-saldo-v5 haiku-checkin-grupo-v2";card.dataset.grupoId=g.grupoId;card.dataset.reservaId=ids[0];card.dataset.miembros=ids.join(",");card.dataset.haikuSaldoV4="1";card.dataset.haikuSaldoV5="1";card.innerHTML=htmlGrupo(g,f);originales[0].insertAdjacentElement("beforebegin",card);originales.forEach(el=>{el.hidden=true;el.dataset.haikuOcultoPorGrupo="1"});campos(card);}
            if(contador){const vis=[...lista.querySelectorAll(".pago-checkin-item")].filter(x=>!x.hidden);contador.textContent=String(vis.filter(x=>(x.querySelector(".pago-checkin-estado")?.textContent||"").includes("Pendiente")).length)}
    }
    async function aplicar(){
        if(window.HAIKU_PAGOS_REFRESH_V1?.interceptar("grupo"))return;
        if(procesando||!window.haikuSesion)return;const lista=document.getElementById("pagos-lista-checkin");if(!lista)return;procesando=true;observer?.disconnect();
        try{
            const preparados=await preparar();
            if(window.HAIKU_PAGOS_REFRESH_V1?.interceptar("grupo-en-vuelo"))return;
            publicar(preparados,lista,document.getElementById("pagos-contador-checkin"));
        }catch(e){console.warn("HAIKU · Check-in grupo V2:",e)}finally{procesando=false;observar(lista)}
    }
    function luego(ms=80){clearTimeout(timer);timer=setTimeout(aplicar,ms)}
    async function contextoPagoResumen(reservaId, fechaEsperada){
        const id=String(reservaId||"");
        if(!id||fechaEsperada!==fecha())return null;
        const grupo=(await gruposDelDia()).find(g=>g.miembros.some(m=>m.reservaId===id));
        if(!grupo)return null;
        const representante=grupo.miembros[0].reservaId;
        const estado=await finanzas(representante);
        if(fechaEsperada!==fecha()||!estado.es_grupo)return null;
        return{
            reservaId:id,rpcReservaId:representante,grupoId:grupo.grupoId,titular:grupo.titular,
            cabanas:grupo.miembros.map(m=>m.numero),
            miembros:grupo.miembros.map(m=>m.reservaId).sort(),
            total:Number(estado.total_alojamiento||0),
            saldo:Number(estado.saldo_alojamiento||0)
        };
    }
    async function registrarPagoControlado(reservaId,datos,fechaEsperada){
        if(guardando)throw new Error("Ya se está registrando un pago.");
        guardando=true;
        try{
            if(!window.haikuSesion)throw new Error("Debes iniciar sesión para registrar pagos.");
            if(!window.haikuTienePermiso?.("pagos.registrar")||!window.haikuTienePermiso?.("pagos.verificar")){
                throw new Error("Tu usuario no tiene permiso para registrar/verificar este pago.");
            }
            const contexto=await contextoPagoResumen(reservaId,fechaEsperada);
            if(!contexto||contexto.saldo<=0)throw new Error("La reserva conjunta ya no tiene saldo cobrable en esta fecha.");
            const monto=Math.round(Number(datos.monto||0)),medio=MEDIOS[datos.medio]||"",r=requisitos(medio);
            if(!Number.isFinite(monto)||monto<=0||monto>contexto.saldo)throw new Error(`El monto debe estar entre $1 y ${money(contexto.saldo)}.`);
            if(!medio)throw new Error("Selecciona el medio de pago.");
            if(!datos.manager)throw new Error("El pago debe ser revisado por Manager.");
            if(r.glosa&&!datos.glosa)throw new Error("Transferencia requiere Glosa.");
            if(r.folio&&!datos.folio)throw new Error("Completa el Folio.");
            if(r.codaut&&!datos.codaut)throw new Error("Completa el CodAut.");
            if(fechaEsperada!==fecha())throw new Error("La fecha seleccionada cambió. Vuelve a abrir el pago.");
            const{data,error}=await sb.rpc("haiku_registrar_pago_checkin_grupo",{
                p_reserva_id:contexto.rpcReservaId,p_monto:monto,p_medio_pago:medio,
                p_glosa:datos.glosa||null,p_folio:datos.folio||null,
                p_codigo_autorizacion:datos.codaut||null,p_manager_revisado:true
            });
            if(error)throw error;
            borradores.delete(contexto.grupoId);
            await window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("registrar pago check-in grupo");
            await Promise.allSettled([
                Promise.resolve().then(()=>window.haikuCargarSaldosCheckinSupabase?.()),
                Promise.resolve().then(()=>window.haikuCargarAbonosSupabase?.()),
                Promise.resolve().then(()=>window.haikuSincronizarReservasSupabase?.())
            ]);
            luego(160);
            return data;
        }finally{guardando=false;}
    }
    async function registrarPago(card){
        if(guardando)return;
        const id=card.dataset.reservaId||"";
        const datos={
            monto:Math.round(Number(card.querySelector("[data-grupo-saldo-monto]")?.value||0)),
            medio:card.querySelector("[data-grupo-saldo-medio]")?.value||"",
            glosa:card.querySelector("[data-grupo-saldo-glosa]")?.value?.trim()||"",
            folio:card.querySelector("[data-grupo-saldo-folio]")?.value?.trim()||"",
            codaut:card.querySelector("[data-grupo-saldo-codaut]")?.value?.trim()||"",
            manager:card.querySelector("[data-grupo-saldo-manager]")?.checked===true
        };
        guardar(card);
        const btn=card.querySelector("[data-grupo-saldo-registrar]");
        if(btn){btn.disabled=true;btn.textContent="Registrando..."}
        try{await registrarPagoControlado(id,datos,fecha());}
        catch(e){console.error("HAIKU · pago Check-in conjunto:",e);alert(e?.message||"No fue posible registrar el pago conjunto.")}
        finally{if(btn?.isConnected){btn.disabled=false;btn.textContent="Registrar pago conjunto"}}
    }
    async function registrarBove(card){const id=card.dataset.reservaId||"",v=card.querySelector("[data-grupo-bove]")?.value?.trim()||"";if(!id||!v){alert("Ingresa el BOVE del alojamiento.");return}if(!window.haikuTienePermiso?.("pagos.verificar")){alert("Tu usuario no tiene permiso para registrar BOVE.");return}const btn=card.querySelector("[data-grupo-bove-registrar]");if(btn){btn.disabled=true;btn.textContent="Registrando..."}try{const{error}=await sb.rpc("haiku_registrar_bove_reserva_grupo",{p_reserva_id:id,p_bove:v});if(error)throw error;await window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("registrar BOVE grupo");await window.haikuCargarSaldosCheckinSupabase?.();luego(160)}catch(e){console.error("HAIKU · BOVE conjunto:",e);alert(e?.message||"No fue posible registrar el BOVE conjunto.")}finally{if(btn?.isConnected){btn.disabled=false;btn.textContent="Registrar BOVE"}}}
    document.addEventListener("change",e=>{const card=e.target.closest?.(".haiku-checkin-grupo-v2");if(!card)return;if(e.target.matches("[data-grupo-saldo-medio]")){guardar(card);campos(card)}else if(e.target.matches("[data-grupo-saldo-monto],[data-grupo-saldo-manager]"))guardar(card)},true);
    document.addEventListener("input",e=>{const card=e.target.closest?.(".haiku-checkin-grupo-v2");if(card&&e.target.matches("[data-grupo-saldo-glosa],[data-grupo-saldo-folio],[data-grupo-saldo-codaut]"))guardar(card)},true);
    document.addEventListener("click",e=>{const card=e.target.closest?.(".haiku-checkin-grupo-v2");if(!card)return;if(e.target.closest("[data-grupo-saldo-registrar]")){e.preventDefault();e.stopPropagation();registrarPago(card)}if(e.target.closest("[data-grupo-bove-registrar]")){e.preventDefault();e.stopPropagation();registrarBove(card)}},true);
    function instalar(){const lista=document.getElementById("pagos-lista-checkin");if(lista)observar(lista);luego(160)}
    document.addEventListener("click",e=>{if(e.target.closest?.('[data-seccion="pagos"]'))setTimeout(instalar,120)});window.addEventListener("haiku:auth-ready",()=>setTimeout(instalar,200));setTimeout(instalar,300);window.haikuAplicarCheckinGrupos=aplicar;
    window.HAIKU_PAGO_CHECKIN_GRUPO_RESUMEN_V1=Object.freeze({
        preparar,
        publicar,
        contexto:contextoPagoResumen,
        registrar:registrarPagoControlado,
        requisitos:medio=>requisitos(MEDIOS[medio]||"")
    });
    console.info("HAIKU · Check-in conjunto V2 preparado.");
})();
