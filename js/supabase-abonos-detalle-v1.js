(() => {
"use strict";
const sb=window.haikuSupabase;if(!sb)return;
const M={"Transferencia":"transferencia","WebPay Crédito":"webpay_credito","WebPay Débito":"webpay_debito","Tarjeta Crédito":"tarjeta_credito","Tarjeta Débito":"tarjeta_debito","Airbnb Prepaid Card": "airbnb_prepaid_card", "Efectivo":"efectivo"};
const busy=new Set();let timer=0,seq=0;
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const money=v=>"$"+Number(v||0).toLocaleString("es-CL");
function req(m){
 if(m==="airbnb_prepaid_card")return[["glosa","Referencia Airbnb / externa (opcional)","Referencia real, si existe"]];
 if(m==="transferencia")return[["glosa","Glosa","Pegar glosa bancaria"]];
 if(["webpay_credito","webpay_debito"].includes(m))return[["codaut","CodAut","Código de autorización WebPay"]];
 if(["tarjeta_credito","tarjeta_debito"].includes(m))return[["folio","Folio","Folio de la transacción"],["bovtar","BOVTAR","Código BOVTAR"]];
 return[];
}
function medio(card){return codigoMedio(card?.querySelector(".pago-abono-medio")?.value||"")}
function box(card){
 let b=card.querySelector("[data-haiku-abono-detalles-v1]");
 if(!b){b=document.createElement("div");b.className="haiku-abono-detalles-v1";b.dataset.haikuAbonoDetallesV1="1";card.querySelector(".pago-abono-grid")?.insertAdjacentElement("afterend",b)}
 return b;
}
function form(card){
 if(!card||card.classList.contains("abono-verificado"))return;
 const b=box(card),m=medio(card),fields=req(m);
 if(!fields.length){if(!b.hidden||b.childElementCount){b.innerHTML="";b.hidden=true}return}
 if(b.dataset.medio===m&&b.childElementCount){b.hidden=false;return}
 const old={};b.querySelectorAll("[data-haiku-abono-extra]").forEach(x=>old[x.dataset.haikuAbonoExtra]=x.value);
 b.dataset.medio=m;
 b.innerHTML=fields.map(([k,l,p])=>`<label class="haiku-abono-extra-grupo"><span>${esc(l)}</span><input type="text" data-haiku-abono-extra="${k}" value="${esc(old[k]||"")}" placeholder="${esc(p)}" autocomplete="off"></label>`).join("");
 b.hidden=false;
}
function extras(card,m){
 const v=k=>card.querySelector(`[data-haiku-abono-extra="${k}"]`)?.value?.trim()||"";
 const x={glosa:v("glosa"),codAut:v("codaut"),folio:v("folio"),bovtar:v("bovtar")};
 if(m==="transferencia"&&!x.glosa)throw Error("Para una transferencia debes ingresar la Glosa antes de confirmar el abono.");
 if(["webpay_credito","webpay_debito"].includes(m)&&!x.codAut)throw Error("Para WebPay debes ingresar el CodAut antes de confirmar el abono.");
 if(["tarjeta_credito","tarjeta_debito"].includes(m)&&(!x.folio||!x.bovtar))throw Error("Para pago con tarjeta debes ingresar Folio y BOVTAR antes de confirmar el abono.");
 return x;
}
async function saldo(id){
 const{data,error}=await sb.from("vista_saldos_reserva").select("saldo").eq("reserva_id",id).maybeSingle();
 if(error)throw error;return Number(data?.saldo||0);
}
async function save(id,amount,m,x,cab){
 const{data,error}=await sb.rpc("haiku_registrar_pago",{p_reserva_id:id,p_monto:amount,p_medio_pago:m,p_etapa_operativa:"abono",p_fecha_pago:new Date().toISOString(),p_folio:x.folio||null,p_codigo_autorizacion:x.codAut||null,p_bove:x.bovtar||null,p_referencia_externa:x.glosa||null,p_observaciones:`Abono registrado desde HAIKU · CAB ${cab||""}`,p_aplicaciones:[],p_modo_aplicacion:"alojamiento"});
 if(error)throw error;return data;
}
function detail(p){
 if(p.medio_pago==="airbnb_prepaid_card")return p.referencia_externa?`Referencia Airbnb / externa: ${esc(p.referencia_externa)}`:"";
 if(p.medio_pago==="transferencia")return p.referencia_externa?`Glosa: ${esc(p.referencia_externa)}`:"Glosa: no registrada en este abono";
 if(["webpay_credito","webpay_debito"].includes(p.medio_pago))return p.codigo_autorizacion?`CodAut: ${esc(p.codigo_autorizacion)}`:"CodAut: no registrado en este abono";
 if(["tarjeta_credito","tarjeta_debito"].includes(p.medio_pago))return`Folio: ${p.folio?esc(p.folio):"no registrado"} · BOVTAR: ${p.bove?esc(p.bove):"no registrado"}`;
 return"";
}
async function verified(){
 const list=document.getElementById("pagos-lista-abonos");if(!list||!window.haikuSesion)return;
 const cards=[...list.querySelectorAll(".pago-abono-item.abono-verificado[data-reserva-id]")];
 const ids=[...new Set(cards.map(c=>c.dataset.reservaId).filter(Boolean))];if(!ids.length)return;
 const turn=++seq;
 const{data,error}=await sb.from("pagos").select("id,reserva_id,monto,medio_pago,folio,codigo_autorizacion,bove,referencia_externa,fecha_pago").in("reserva_id",ids).eq("tipo_movimiento","pago").eq("etapa_operativa","abono").eq("estado","confirmado").order("fecha_pago",{ascending:true});
 if(error){console.warn("HAIKU · detalle abonos:",error);return}if(turn!==seq)return;
 const map=new Map();(data||[]).forEach(p=>{if(!map.has(p.reserva_id))map.set(p.reserva_id,[]);map.get(p.reserva_id).push(p)});
 cards.forEach(card=>{
  const arr=map.get(card.dataset.reservaId)||[];if(!arr.length)return;
  const detalles=arr.map(detail).filter(Boolean);
  let b=card.querySelector("[data-haiku-abonos-verificados-v1]");
  if(!detalles.length){b?.remove();return}
  const html=detalles.map(texto=>`<div class="haiku-abono-registro-v1"><small>${texto}</small></div>`).join("");
  if(b&&b.dataset.html===html)return;
  if(!b){b=document.createElement("div");b.className="haiku-abonos-verificados-v1";b.dataset.haikuAbonosVerificadosV1="1";const v=card.querySelector(".pago-abono-verificacion");v?v.insertAdjacentElement("beforebegin",b):card.appendChild(b)}
  b.dataset.html=html;b.innerHTML=html;
 });
}
function prep(){
 const list=document.getElementById("pagos-lista-abonos");if(!list)return;
 list.querySelectorAll(".pago-abono-item").forEach(c=>c.classList.contains("abono-verificado")?c.querySelector("[data-haiku-abono-detalles-v1]")?.remove():form(c));
 verified().catch(e=>console.warn("HAIKU · detalle verificados:",e));
}
function later(){clearTimeout(timer);timer=setTimeout(prep,45)}
window.addEventListener("change",e=>{const s=e.target?.closest?.(".pago-abono-medio");if(s)form(s.closest(".pago-abono-item"))},true);
window.addEventListener("change",async e=>{
 const ch=e.target?.closest?.("[data-pago-abono]");if(!ch||!ch.dataset.reservaId||!ch.checked)return;
 e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
 const card=ch.closest(".pago-abono-item"),id=String(ch.dataset.reservaId||"");if(!card||!id||busy.has(id))return;
 const amount=Number(card.querySelector(".pago-abono-monto")?.value||0),m=medio(card);
 if(amount<=0||!m){ch.checked=false;alert("Ingresa un monto de abono y selecciona el medio de pago.");return}
 if(!window.haikuTienePermiso?.("pagos.registrar")){ch.checked=false;alert("Tu usuario no tiene permiso para registrar pagos.");return}
 let x;try{x=extras(card,m)}catch(err){ch.checked=false;alert(err.message);return}
 busy.add(id);ch.disabled=true;
 try{
  const s=await saldo(id);if(amount>s)throw Error(`El abono supera el saldo actual (${money(s)}).`);
  await save(id,amount,m,x,ch.dataset.pagoAbono);
  await Promise.allSettled([Promise.resolve().then(()=>window.haikuCargarAbonosSupabase?.()),Promise.resolve().then(()=>window.haikuCargarSaldosCheckinSupabase?.()),Promise.resolve().then(()=>window.haikuSincronizarReservasSupabase?.())]);
  setTimeout(later,80);
 }catch(err){console.error("HAIKU · registrar abono con detalle:",err);ch.checked=false;alert(err?.message||"No fue posible registrar el abono.")}
 finally{busy.delete(id);if(ch.isConnected&&!ch.checked)ch.disabled=false}
},true);
const list=document.getElementById("pagos-lista-abonos");if(list)new MutationObserver(later).observe(list,{childList:true});
window.addEventListener("haiku:auth-ready",()=>setTimeout(later,120));setTimeout(later,160);
const style=document.createElement("style");style.textContent=`
.haiku-abono-detalles-v1{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(47,118,83,.12)}
.haiku-abono-detalles-v1[hidden]{display:none!important}.haiku-abono-extra-grupo{display:flex;flex-direction:column;gap:5px;min-width:0}.haiku-abono-extra-grupo span{font-size:10px;color:#68716d}.haiku-abono-extra-grupo input{width:100%;min-width:0;height:38px;padding:0 10px;border:1px solid #ccd3cf;border-radius:7px;background:#fff;font:inherit;box-sizing:border-box}
.haiku-abonos-verificados-v1{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(47,118,83,.12)}.haiku-abono-registro-v1{display:flex;align-items:center;padding:7px 9px;border:1px solid rgba(47,118,83,.14);border-radius:8px;background:rgba(255,255,255,.48)}.haiku-abono-registro-v1 small{font-size:10px;color:#65706a;text-align:left;overflow-wrap:anywhere}
@media(max-width:700px){.haiku-abono-detalles-v1{grid-template-columns:1fr;gap:7px}}`;
document.head.appendChild(style);
window.HAIKU_ABONOS_DETALLE_V1=Object.freeze({refrescar:later});
console.info("HAIKU · Detalle de verificación de abonos V1 preparado.");

    function codigoMedio(valor) { return valor === "airbnb_prepaid_card" ? valor : M[valor] || ""; }
})();