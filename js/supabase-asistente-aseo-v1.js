// ========================================
// HAKU · CONSULTAS DE ASEO V1
// Proyecto H primero; Libro de Reserva sólo como respaldo.
// Sólo lectura: no modifica Supabase ni el XLSX.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_ASEO_V1) return;
    window.HAIKU_ASISTENTE_ASEO_V1 = true;

    const ZONA = "America/Santiago";
    const TOLERANCIA_MINUTOS = 5;
    const MESES = Object.freeze({
        enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6,
        julio:7, agosto:8, septiembre:9, setiembre:9, octubre:10,
        noviembre:11, diciembre:12
    });
    const PREFIJOS = [
        ["jan","ene"],["feb"],["mar"],["apr","abr"],["may"],["jun"],
        ["jul"],["aug","ago"],["sep"],["oct"],["nov"],["dec","dic"]
    ];

    function instalar() {
        if (window.HAIKU_ASISTENTE_ASEO_INSTALADO_V1) return true;

        const db = window.haikuSupabase;
        const campo = document.getElementById("haiku-asistente-texto");
        const enviar = document.getElementById("haiku-asistente-enviar");
        const mensajes = document.getElementById("haiku-asistente-mensajes");
        if (!db || !campo || !enviar || !mensajes) return false;

        window.HAIKU_ASISTENTE_ASEO_INSTALADO_V1 = true;
        let ocupado = false;
        const cacheCabanas = new Map();

        function css() {
            if (document.getElementById("haku-aseo-consultas-v1-css")) return;
            const style = document.createElement("style");
            style.id = "haku-aseo-consultas-v1-css";
            style.textContent = `
                .haku-aseo-card{--ac:#277352;--soft:#edf7f1;--bd:#cadfd2;border:1px solid var(--bd);border-radius:16px;background:linear-gradient(180deg,#fbfdfb,#f7faf8);padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:0 5px 16px rgba(28,69,47,.055)}
                .haku-aseo-card--libro{--ac:#80652c;--soft:#fff8e8;--bd:#e8d9ad}
                .haku-aseo-card--alerta{--ac:#9a5147;--soft:#fff1ef;--bd:#e8cbc6}
                .haku-aseo-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding-bottom:9px;border-bottom:1px solid #deebe2}
                .haku-aseo-kicker{margin:0 0 2px;font-size:10px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:var(--ac)}
                .haku-aseo-title{margin:0;font-size:18px;line-height:1.15;color:#17251c}
                .haku-aseo-badge{flex:0 0 auto;display:inline-flex;align-items:center;min-height:25px;padding:4px 9px;border:1px solid var(--bd);border-radius:999px;background:var(--soft);color:var(--ac);font-size:9px;font-weight:900;white-space:nowrap}
                .haku-aseo-resumen{display:flex;gap:7px;flex-wrap:wrap}
                .haku-aseo-chip{display:inline-flex;align-items:center;padding:5px 8px;border-radius:8px;background:var(--soft);color:var(--ac);font-size:10px;font-weight:850}
                .haku-aseo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
                .haku-aseo-dato{min-width:0;padding:8px 9px;border:1px solid #e0e9e3;border-radius:10px;background:#fff}
                .haku-aseo-dato span{display:block;margin-bottom:3px;color:#7a867e;font-size:8px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
                .haku-aseo-dato strong{display:block;overflow-wrap:anywhere;color:#29362e;font-size:11px;line-height:1.3}
                .haku-aseo-seccion{padding-top:8px;border-top:1px solid #e0e9e3}
                .haku-aseo-seccion h4{margin:0 0 6px;color:#3d5848;font-size:10px}
                .haku-aseo-lista{margin:0;padding-left:17px;color:#47564d;font-size:10px;line-height:1.5}
                .haku-aseo-nota{padding:8px 9px;border-radius:10px;background:var(--soft);color:#53645a;font-size:10px;line-height:1.4;white-space:pre-wrap}
                .haku-aseo-pie{padding-top:7px;border-top:1px solid #e0e9e3;color:#748078;font-size:9px;line-height:1.35}
                .haku-aseo-ok{color:#277352;font-weight:850}.haku-aseo-diff{color:#a04e43;font-weight:850}
                @media(max-width:620px){.haku-aseo-card{padding:11px}.haku-aseo-grid{grid-template-columns:1fr 1fr}.haku-aseo-title{font-size:16px}}
            `;
            document.head.appendChild(style);
        }
        css();

        function quitarVocativo(v) {
            const fn = window.haikuQuitarVocativoAsistente;
            if (typeof fn === "function") return fn(v);
            return String(v || "").replace(/^\s*(?:asistente\s+)?haku\b\s*[,;:!¡¿?\-–—]*\s*/i, "");
        }
        function norm(v) {
            return quitarVocativo(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
        }
        function normNombre(v) {
            return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
        }
        function hoyChile() {
            const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:ZONA,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
            return `${p.year}-${p.month}-${p.day}`;
        }
        function iso(y,m,d) {
            const dt = new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
            if (dt.getUTCFullYear()!==Number(y)||dt.getUTCMonth()!==Number(m)-1||dt.getUTCDate()!==Number(d)) return null;
            return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        }
        function mover(fecha,dias) {
            const [y,m,d]=fecha.split("-").map(Number); const dt=new Date(Date.UTC(y,m-1,d)); dt.setUTCDate(dt.getUTCDate()+dias);
            return iso(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate());
        }
        function fechaTexto(v, defectoHoy=false) {
            const t=norm(v), hoy=hoyChile(), year=Number(hoy.slice(0,4));
            if (/\bpasado manana\b/.test(t)) return mover(hoy,2);
            if (/\bmanana\b/.test(t)) return mover(hoy,1);
            if (/\bhoy\b/.test(t)) return hoy;
            if (/\bayer\b/.test(t)) return mover(hoy,-1);
            let m=t.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
            if (m) { let yy=m[3]?Number(m[3]):year; if(yy<100) yy+=2000; return iso(yy,Number(m[2]),Number(m[1])); }
            const meses=Object.keys(MESES).join("|");
            m=t.match(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${meses})(?:\\s+(?:de\\s+)?(20\\d{2}))?\\b`));
            if(m) return iso(m[3]?Number(m[3]):year,MESES[m[2]],Number(m[1]));
            return defectoHoy?hoy:null;
        }
        function cabanaTexto(v) {
            const m=norm(v).match(/\b(?:cab|cabana|c)\s*\.?\s*(\d{1,2})\b/);
            const n=m?Number(m[1]):null;
            return n>=1&&n<=11?n:null;
        }
        function fechaVisible(v) {
            const m=String(v||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
            return m?`${m[3]}-${m[2]}-${m[1]}`:String(v||"—");
        }
        function horaChile(ts) {
            if(!ts) return null;
            try{return new Intl.DateTimeFormat("en-GB",{timeZone:ZONA,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(ts));}catch(_){return null;}
        }
        function limpiarEncargado(v) {
            const s=String(v||"").trim();
            const m=s.match(/^(Full|Exp|Rep)\s*\((.+)\)$/i);
            return m?{nombre:m[2].trim(),tipo:m[1].toLowerCase()==="full"?"Full":m[1].toLowerCase()==="exp"?"Express":"Repaso"}:{nombre:s||null,tipo:null};
        }
        function valorLibro(v) {
            const s=String(v||"").trim();
            return !s||/^(?:\?|\-\s*|sin dato)$/i.test(s)?null:s;
        }
        function minutos(h) {
            const m=String(h||"").match(/\b([0-2]?\d)[:.]([0-5]\d)\b/);
            return m?Number(m[1])*60+Number(m[2]):null;
        }
        function diferenciaMin(a,b) {
            const x=minutos(a),y=minutos(b); if(x==null||y==null)return null;
            return Math.abs(x-y);
        }
        function mismoNombre(a,b) {
            const limpio=x=>normNombre(String(x||"").replace(/^(full|exp|rep)\s*\(|\)$/gi,""));
            return Boolean(limpio(a)&&limpio(a)===limpio(b));
        }

        function tipoConsulta(original) {
            const t=norm(original);
            if(!t) return null;
            if(/\b(?:marca|marcar|cambia|cambiar|pon|poner|crea|crear|agrega|agregar|registra|registrar|elimina|eliminar|borra|borrar|actualiza|actualizar)\b/.test(t)) return null;

            const cab=cabanaTexto(original);
            const antes=/\b(?:antes que|antes de que|anterior a)\b/.test(t)&&/\b(?:huesped|hospedad|alojamiento|estuvo|estubo)\b/.test(t);
            if(antes&&cab) return "huesped_anterior";
            if(/\b(?:ultimo|ultima)\s+(?:huesped|persona|reserva)\b/.test(t)&&/\b(?:hosped|cab)\b/.test(t)&&cab) return "ultimo_huesped";

            const contextoAseo=/\b(?:aseo|limpieza|limpio|camarero|encargado|revision|reviso|checklist|express|checkout|check out|tiempos|detalles?|cabana)\b/.test(t);
            if(!contextoAseo||!cab) return null;
            if(/\b(?:compara|comparar|diferencias?|inconsisten)\b/.test(t)&&/\b(?:aseo|limpieza|camarero|revision|tiempos)\b/.test(t)) return "comparar";
            if(/\bchecklist\b/.test(t)||/\b(?:aseo\s+express|express\s+de\s+aseo)\b/.test(t)) return /\bexpress\b/.test(t)?"checklist_express":"checklist";
            if(/\bdetalles?\b/.test(t)&&/\bcab/.test(t)) return "detalles";
            if(/\b(?:quien|quienes)\b/.test(t)&&/\b(?:checkout|check out)\b/.test(t)) return "checkout_revisor";
            if(/\b(?:quien|quienes)\b/.test(t)&&/\b(?:reviso|revision|check\b)\b/.test(t)) return "revisor";
            if(/\b(?:quien|quienes)\b/.test(t)&&/\b(?:limpio|limpieza|aseo|camarero|realizo)\b/.test(t)) return "camarero";
            if(/\b(?:hora|horario|tiempo|tiempos|cuanto)\b/.test(t)&&/\b(?:aseo|limpieza|camarero|inicio|termino|finalizo|in\b|out\b)\b/.test(t)) return "tiempos";
            if(/\b(?:hora|cuando)\b/.test(t)&&/\b(?:ingreso|entro|check in|checkin)\b/.test(t)) return "ingreso";
            if(/\b(?:aseo|limpieza)\b/.test(t)) return "aseo";
            return null;
        }
        function nombreObjetivo(original) {
            const m=String(original||"").match(/(?:antes\s+que|antes\s+de\s+que|anterior\s+a)\s+(.+?)(?=\s+en\s+(?:la\s+)?(?:cab|cabaña|cabana)\s*\d|\s*,|$)/i);
            return m?m[1].replace(/[*_]/g,"").trim():null;
        }

        async function cabanaId(numero) {
            if(cacheCabanas.has(numero)) return cacheCabanas.get(numero);
            const {data,error}=await db.from("cabanas").select("id,numero,nombre").eq("numero",numero).maybeSingle();
            if(error) throw error; if(data) cacheCabanas.set(numero,data); return data||null;
        }
        async function aseoProyecto(fecha,cid) {
            const {data,error}=await db.from("aseos").select("id,fecha,cabana_id,tipo_aseo,estado,encargado_nombre,revisor_nombre,iniciado_en,completado_en,observaciones").eq("fecha",fecha).eq("cabana_id",cid).order("actualizado_en",{ascending:false}).limit(1).maybeSingle();
            if(error) throw error; return data||null;
        }
        async function estadiasCabana(cid, limite=120) {
            const {data,error}=await db.from("reserva_estadias")
                .select("id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia,checkin_realizado_en,checkout_realizado_en,checkin_realizado_por,checkout_realizado_por,tipo_estadia,reservas(titular_nombre,estado_reserva)")
                .eq("cabana_id",cid).order("fecha_ingreso",{ascending:false}).limit(limite);
            if(error) throw error; return data||[];
        }
        function reservaFila(e){return Array.isArray(e?.reservas)?e.reservas[0]:e?.reservas;}
        function validaEstadia(e) {
            const s=norm(`${e?.estado_estadia||""} ${reservaFila(e)?.estado_reserva||""}`);
            return !/\b(?:cancelad|anulad|no show|noshow)\b/.test(s);
        }
        async function usuarioNombre(id) {
            if(!id) return null;
            const {data,error}=await db.from("usuarios").select("nombre,apellido").eq("id",id).maybeSingle();
            if(error) return null;
            return [data?.nombre,data?.apellido].filter(Boolean).join(" ").trim()||null;
        }
        async function infoIngresoCheckout(fecha,cid) {
            const estadias=await estadiasCabana(cid,80);
            const ingreso=estadias.find(e=>validaEstadia(e)&&e.fecha_ingreso===fecha)||null;
            const salida=estadias.find(e=>validaEstadia(e)&&e.fecha_salida===fecha)||null;
            return {
                ingreso,
                salida,
                horaIngreso: ingreso?.checkin_realizado_en?horaChile(ingreso.checkin_realizado_en):null,
                checkoutPor: salida?.checkout_realizado_por?await usuarioNombre(salida.checkout_realizado_por):null,
                horaCheckout: salida?.checkout_realizado_en?horaChile(salida.checkout_realizado_en):null
            };
        }
        async function revisionProyecto(fecha,cid,tipo) {
            let q=db.from("revisiones_cabana").select("id,fecha,cabana_id,tipo_revision,estado,resultado,observaciones,iniciado_en,finalizado_en,revisado_por").eq("fecha",fecha).eq("cabana_id",cid).neq("estado","cancelada");
            if(tipo) q=q.eq("tipo_revision",tipo);
            const {data,error}=await q.order("creado_en",{ascending:false}).limit(1).maybeSingle();
            if(error) throw error; return data||null;
        }
        async function itemsRevision(id) {
            if(!id) return [];
            const {data,error}=await db.from("revision_items").select("estado,cantidad_esperada,cantidad_encontrada,observacion,revisado_en,checklist_items(nombre,categoria,criticidad)").eq("revision_id",id).order("creado_en",{ascending:true});
            if(error) throw error; return data||[];
        }
        async function solicitudesProyecto(fecha,cid) {
            const {data,error}=await db.from("solicitudes").select("categoria,descripcion,prioridad,estado,observacion_cierre").eq("fecha_operativa",fecha).eq("cabana_id",cid).neq("estado","cancelada").order("creado_en",{ascending:true});
            if(error) throw error; return data||[];
        }

        function hojaFecha(api,fecha) {
            const m=String(fecha||"").match(/^(\d{4})-(\d{2})-/); if(!m)return null;
            const yy=m[1].slice(2), prefs=PREFIJOS[Number(m[2])-1]||[];
            return (api.listarHojas?.()||[]).find(n=>{
                const s=normNombre(n).replace(/\s/g,"");
                return prefs.some(p=>s===`${p}${yy}`||s.startsWith(`${p}${yy}`));
            })||null;
        }
        async function aseoLibro(fecha,numero) {
            const api=window.HAIKU_LIBRO_RESERVA_V1;
            if(!api?.consultarHoja||!api?.listarHojas) return null;
            const hoja=hojaFecha(api,fecha); if(!hoja)return null;
            try{
                const d=await api.consultarHoja(hoja);
                const fila=(d?.aseos||[]).find(a=>String(a.fecha)===fecha&&Number(a.cabana)===Number(numero));
                return fila?{...fila,hoja}:null;
            }catch(_){return null;}
        }

        function datoProyecto(aseo,extra,campoSolicitado) {
            const encargado=limpiarEncargado(aseo?.encargado_nombre);
            const base={
                camarero:encargado.nombre,
                tipoAseo:encargado.tipo,
                inicio:horaChile(aseo?.iniciado_en),
                fin:horaChile(aseo?.completado_en),
                revisor:aseo?.revisor_nombre||null,
                ingreso:extra?.horaIngreso||null,
                checkoutPor:extra?.checkoutPor||null,
                checkoutHora:extra?.horaCheckout||null
            };
            if(campoSolicitado==="camarero") return base.camarero;
            if(campoSolicitado==="revisor") return base.revisor;
            if(campoSolicitado==="checkout_revisor") return base.checkoutPor;
            if(campoSolicitado==="ingreso") return base.ingreso;
            if(campoSolicitado==="tiempos") return base.inicio||base.fin;
            return aseo && [base.camarero,base.inicio,base.fin,base.revisor].some(Boolean)?base:null;
        }
        function datoLibro(a,campoSolicitado) {
            if(!a)return null;
            const base={
                camarero:valorLibro(a.camarero),
                tipoAseo:null,
                inicio:valorLibro(a.hora_inicio),
                fin:valorLibro(a.hora_fin),
                revisor:valorLibro(a.revisado_por),
                ingreso:valorLibro(a.ingreso),
                checkoutPor:valorLibro(a.checkout_por),
                checkoutHora:null
            };
            if(campoSolicitado==="camarero") return base.camarero;
            if(campoSolicitado==="revisor") return base.revisor;
            if(campoSolicitado==="checkout_revisor") return base.checkoutPor;
            if(campoSolicitado==="ingreso") return base.ingreso;
            if(campoSolicitado==="tiempos") return base.inicio||base.fin;
            return Object.values(base).some(Boolean)?base:null;
        }

        function mensaje(tipo,texto) {
            const d=document.createElement("div"); d.className=`haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`; d.textContent=texto; mensajes.appendChild(d);
            requestAnimationFrame(()=>{mensajes.scrollTop=mensajes.scrollHeight;});
        }
        function el(tag,clase,texto) {
            const x=document.createElement(tag); if(clase)x.className=clase; if(texto!=null)x.textContent=texto; return x;
        }
        function cardBase(titulo,fecha,numero,fuente,clase="") {
            const card=el("div",`haku-aseo-card ${clase}`.trim());
            const head=el("div","haku-aseo-head");
            const izq=el("div"); izq.append(el("div","haku-aseo-kicker","CONSULTA · SÓLO LECTURA"),el("h3","haku-aseo-title",titulo));
            head.append(izq,el("span","haku-aseo-badge",fuente));
            const resumen=el("div","haku-aseo-resumen");
            if(numero)resumen.append(el("span","haku-aseo-chip",`CAB ${numero}`));
            if(fecha)resumen.append(el("span","haku-aseo-chip",fechaVisible(fecha)));
            card.append(head,resumen); return card;
        }
        function datoCard(nombre,valor) {
            const d=el("div","haku-aseo-dato"); d.append(el("span","",nombre),el("strong","",valor||"Sin dato")); return d;
        }
        function renderAseo(info,{titulo,fecha,numero,fuente,libro=false,pie=""}) {
            const card=cardBase(titulo,fecha,numero,fuente,libro?"haku-aseo-card--libro":"");
            const grid=el("div","haku-aseo-grid");
            grid.append(
                datoCard("Camarero",info?.camarero||"Sin dato"),
                datoCard("Tipo",info?.tipoAseo||"Sin dato"),
                datoCard("Tiempos aseo",info?.inicio||info?.fin?`${info.inicio||"—"} → ${info.fin||"—"}`:"Sin dato"),
                datoCard("Revisión aseo",info?.revisor||"Sin dato"),
                datoCard("IN / ingreso",info?.ingreso||"Sin dato"),
                datoCard("Check-out revisado por",info?.checkoutPor||"Sin dato")
            );
            card.append(grid);
            if(pie)card.append(el("div","haku-aseo-pie",pie));
            mensajes.appendChild(card); requestAnimationFrame(()=>{mensajes.scrollTop=mensajes.scrollHeight;});
        }
        function renderSimple(titulo,fecha,numero,fuente,etiqueta,valor,libro=false,nota="") {
            const card=cardBase(titulo,fecha,numero,fuente,libro?"haku-aseo-card--libro":"");
            const grid=el("div","haku-aseo-grid"); grid.append(datoCard(etiqueta,valor||"Sin dato")); card.append(grid);
            if(nota)card.append(el("div","haku-aseo-pie",nota));
            mensajes.appendChild(card); requestAnimationFrame(()=>{mensajes.scrollTop=mensajes.scrollHeight;});
        }
        function checklistInfo(items) {
            const unwrap=x=>Array.isArray(x?.checklist_items)?x.checklist_items[0]:x?.checklist_items;
            const mapped=items.map(x=>({...x,item:unwrap(x)}));
            const ok=mapped.filter(x=>norm(x.estado)==="ok");
            const pendientes=mapped.filter(x=>norm(x.estado)!=="ok");
            return {mapped,ok,pendientes};
        }
        function renderChecklist(rev,items,fecha,numero,express) {
            const info=checklistInfo(items);
            const card=cardBase(express?"Checklist Aseo Express":"Checklist de aseo",fecha,numero,"Proyecto H");
            const grid=el("div","haku-aseo-grid");
            grid.append(datoCard("Estado",rev?.estado||"Sin dato"),datoCard("Resultado",rev?.resultado||"Sin dato"),datoCard("Checklist",`${info.ok.length}/${info.mapped.length} OK`));
            card.append(grid);
            if(rev?.observaciones) card.append(el("div","haku-aseo-nota",rev.observaciones));
            const lista=express?info.mapped:info.pendientes;
            if(lista.length){
                const sec=el("div","haku-aseo-seccion"); sec.append(el("h4","",express?"Ítems registrados":"Ítems que requieren atención"));
                const ul=el("ul","haku-aseo-lista");
                lista.slice(0,30).forEach(x=>ul.append(el("li","",`${x.item?.nombre||"Ítem"} · ${x.estado||"sin estado"}${x.observacion?` · ${x.observacion}`:""}`)));
                sec.append(ul); card.append(sec);
            }
            card.append(el("div","haku-aseo-pie","Fuente primaria: Proyecto H. No se consultó el Libro porque Proyecto H tenía información para esta revisión."));
            mensajes.appendChild(card); requestAnimationFrame(()=>{mensajes.scrollTop=mensajes.scrollHeight;});
        }
        function renderDetalles(fecha,numero,fuente,detalles,libro=false) {
            const card=cardBase("Detalles de la cabaña",fecha,numero,fuente,libro?"haku-aseo-card--libro":"");
            if(!detalles.length) card.append(el("div","haku-aseo-nota","No encontré detalles registrados para esa fecha."));
            else {
                const ul=el("ul","haku-aseo-lista");
                detalles.forEach(x=>ul.append(el("li","",x)));
                const sec=el("div","haku-aseo-seccion");sec.append(el("h4","","Detalles registrados"),ul);card.append(sec);
            }
            card.append(el("div","haku-aseo-pie",libro?"Proyecto H no tenía detalles suficientes; se usó el Libro de Reserva sólo como respaldo.":"Fuente primaria: Proyecto H."));
            mensajes.appendChild(card);requestAnimationFrame(()=>{mensajes.scrollTop=mensajes.scrollHeight;});
        }
        function renderComparacion(fecha,numero,p,l) {
            const diferencias=[];
            if(p?.camarero&&l?.camarero&&!mismoNombre(p.camarero,l.camarero)) diferencias.push(`Camarero: Proyecto H “${p.camarero}” · Libro “${l.camarero}”`);
            if(p?.revisor&&l?.revisor&&!mismoNombre(p.revisor,l.revisor)) diferencias.push(`Revisión: Proyecto H “${p.revisor}” · Libro “${l.revisor}”`);
            for(const [k,label] of [["inicio","Inicio"],["fin","Fin"]]){
                if(p?.[k]&&l?.[k]){
                    const d=diferenciaMin(p[k],l[k]);
                    if(d!=null&&d>TOLERANCIA_MINUTOS) diferencias.push(`${label}: Proyecto H ${p[k]} · Libro ${l[k]} · diferencia ${d} min`);
                }
            }
            const card=cardBase("Comparación de aseo",fecha,numero,"Proyecto H ↔ Libro",diferencias.length?"haku-aseo-card--alerta":"");
            const nota=el("div","haku-aseo-nota",diferencias.length?`Encontré ${diferencias.length} diferencia(s) material(es).`:`Sin inconsistencias materiales. Diferencias de ${TOLERANCIA_MINUTOS} minutos o menos en tiempos de aseo se consideran equivalentes.`);
            card.append(nota);
            if(diferencias.length){const ul=el("ul","haku-aseo-lista");diferencias.forEach(x=>ul.append(el("li","haku-aseo-diff",x)));card.append(ul);}
            card.append(el("div","haku-aseo-pie","Esta comparación es sólo lectura. Proyecto H mantiene prioridad operativa; el Libro funciona como respaldo."));
            mensajes.appendChild(card);requestAnimationFrame(()=>{mensajes.scrollTop=mensajes.scrollHeight;});
        }
        function renderHuesped(titulo,numero,estadia,extra=[]) {
            const r=reservaFila(estadia);
            const card=cardBase(titulo,null,numero,"Proyecto H");
            const grid=el("div","haku-aseo-grid");
            grid.append(datoCard("Huésped",r?.titular_nombre||"Sin dato"),datoCard("Ingreso",fechaVisible(estadia?.fecha_ingreso)),datoCard("Salida",fechaVisible(estadia?.fecha_salida)));
            card.append(grid);
            if(extra.length){const sec=el("div","haku-aseo-seccion");const ul=el("ul","haku-aseo-lista");extra.forEach(x=>ul.append(el("li","",x)));sec.append(ul);card.append(sec);}
            card.append(el("div","haku-aseo-pie","Fuente: historial de estadías de Proyecto H."));
            mensajes.appendChild(card);requestAnimationFrame(()=>{mensajes.scrollTop=mensajes.scrollHeight;});
        }

        async function procesarAseo(tipo,texto,numero,fecha) {
            const cab=await cabanaId(numero); if(!cab){mensaje("asistente",`No encontré la CAB ${numero} en Proyecto H.`);return;}
            if(tipo==="checklist"||tipo==="checklist_express"){
                const rev=await revisionProyecto(fecha,cab.id,tipo==="checklist_express"?"aseo_express":"completa");
                if(rev){renderChecklist(rev,await itemsRevision(rev.id),fecha,numero,tipo==="checklist_express");return;}
                const libro=await aseoLibro(fecha,numero);
                if(libro) renderDetalles(fecha,numero,"Libro de Reserva · respaldo",[libro.texto_original].filter(Boolean),true);
                else mensaje("asistente",`No encontré checklist de ${tipo==="checklist_express"?"Aseo Express":"aseo"} para CAB ${numero} el ${fechaVisible(fecha)}.`);
                return;
            }
            if(tipo==="detalles"){
                const [rev,exp,sol,aseo]=await Promise.all([revisionProyecto(fecha,cab.id,"completa"),revisionProyecto(fecha,cab.id,"aseo_express"),solicitudesProyecto(fecha,cab.id),aseoProyecto(fecha,cab.id)]);
                const det=[];
                if(rev?.observaciones)det.push(`Revisión completa: ${rev.observaciones}`);
                if(exp?.observaciones)det.push(`Aseo Express: ${exp.observaciones}`);
                for(const s of sol||[]) if(s.descripcion)det.push(`${s.categoria||"Solicitud"}: ${s.descripcion}${s.estado?` · ${s.estado}`:""}`);
                if(aseo?.observaciones)det.push(`Aseo: ${aseo.observaciones}`);
                if(det.length){renderDetalles(fecha,numero,"Proyecto H",det,false);return;}
                const libro=await aseoLibro(fecha,numero);
                if(libro){renderDetalles(fecha,numero,"Libro de Reserva · respaldo",[libro.texto_original].filter(Boolean),true);return;}
                renderDetalles(fecha,numero,"Proyecto H",[],false);return;
            }

            const [aseo,extra]=await Promise.all([aseoProyecto(fecha,cab.id),infoIngresoCheckout(fecha,cab.id)]);
            const p=datoProyecto(aseo,extra,tipo);
            if(tipo==="comparar"){
                const libro=await aseoLibro(fecha,numero), l=datoLibro(libro,"aseo");
                renderComparacion(fecha,numero,datoProyecto(aseo,extra,"aseo"),l);return;
            }
            if(p){
                if(tipo==="camarero") renderSimple("Quién realizó el aseo",fecha,numero,"Proyecto H","Camarero",limpiarEncargado(aseo?.encargado_nombre).nombre,false,limpiarEncargado(aseo?.encargado_nombre).tipo?`Tipo de aseo: ${limpiarEncargado(aseo.encargado_nombre).tipo}. No se consultó el Libro porque Proyecto H respondió la pregunta.`:"No se consultó el Libro porque Proyecto H respondió la pregunta.");
                else if(tipo==="revisor") renderSimple("Quién revisó el aseo",fecha,numero,"Proyecto H","Revisión",aseo?.revisor_nombre,false,"No se consultó el Libro porque Proyecto H respondió la pregunta.");
                else if(tipo==="checkout_revisor") renderSimple("Revisión de Check-out",fecha,numero,"Proyecto H","Check-out",extra?.checkoutPor,false,extra?.horaCheckout?`Check-out registrado a las ${extra.horaCheckout}.`:"");
                else if(tipo==="ingreso") renderSimple("Hora de ingreso",fecha,numero,"Proyecto H","IN / ingreso",extra?.horaIngreso,false,"Hora real de check-in registrada en Proyecto H.");
                else if(tipo==="tiempos") renderSimple("Tiempos de aseo",fecha,numero,"Proyecto H","Inicio → fin",`${horaChile(aseo?.iniciado_en)||"—"} → ${horaChile(aseo?.completado_en)||"—"}`,false,"No se consultó el Libro porque Proyecto H respondió la pregunta.");
                else renderAseo(datoProyecto(aseo,extra,"aseo"),{titulo:"Aseo de la cabaña",fecha,numero,fuente:"Proyecto H",pie:"Fuente primaria: Proyecto H. El Libro no fue consultado porque Proyecto H contenía información."});
                return;
            }

            const libro=await aseoLibro(fecha,numero);
            const l=datoLibro(libro,tipo);
            if(l){
                if(tipo==="camarero") renderSimple("Quién realizó el aseo",fecha,numero,"Libro de Reserva · respaldo","Camarero",l,true,"Proyecto H no tenía este dato; se consultó el Libro como respaldo.");
                else if(tipo==="revisor") renderSimple("Quién revisó el aseo",fecha,numero,"Libro de Reserva · respaldo","Revisión",l,true,"Proyecto H no tenía este dato; se consultó el Libro como respaldo.");
                else if(tipo==="checkout_revisor") renderSimple("Revisión de Check-out",fecha,numero,"Libro de Reserva · respaldo","Check-out",l,true,"Proyecto H no tenía este dato; se consultó el Libro como respaldo.");
                else if(tipo==="ingreso") renderSimple("Hora de ingreso",fecha,numero,"Libro de Reserva · respaldo","IN / ingreso",l,true,"Proyecto H no tenía este dato; se consultó el Libro como respaldo.");
                else if(tipo==="tiempos") {
                    const b=datoLibro(libro,"aseo"); renderSimple("Tiempos de aseo",fecha,numero,"Libro de Reserva · respaldo","Inicio → fin",`${b?.inicio||"—"} → ${b?.fin||"—"}`,true,"Proyecto H no tenía tiempos de aseo; se usó el Libro como respaldo.");
                } else renderAseo(datoLibro(libro,"aseo"),{titulo:"Aseo de la cabaña",fecha,numero,fuente:"Libro de Reserva · respaldo",libro:true,pie:"Proyecto H no tenía información suficiente para esta consulta."});
                return;
            }
            mensaje("asistente",`No encontré información de aseo para CAB ${numero} el ${fechaVisible(fecha)} ni en Proyecto H ni en el Libro disponible.`);
        }

        async function procesarHistorial(tipo,texto,numero) {
            const cab=await cabanaId(numero); if(!cab){mensaje("asistente",`No encontré la CAB ${numero}.`);return;}
            const est=(await estadiasCabana(cab.id,160)).filter(validaEstadia);
            if(tipo==="ultimo_huesped"){
                const hoy=hoyChile();
                const ultimo=est.filter(e=>e.fecha_ingreso<=hoy).sort((a,b)=>String(b.fecha_ingreso).localeCompare(String(a.fecha_ingreso))||String(b.fecha_salida).localeCompare(String(a.fecha_salida)))[0];
                if(!ultimo){mensaje("asistente",`No encontré una estadía anterior o actual en CAB ${numero}.`);return;}
                renderHuesped("Último huésped registrado",numero,ultimo,[`Consulta resuelta usando la fecha actual de Chile: ${fechaVisible(hoy)}.`]);return;
            }

            const nombre=nombreObjetivo(texto);
            if(!nombre){mensaje("asistente","Indícame el nombre del huésped de referencia.");return;}
            const objetivoNorm=normNombre(nombre);
            let objetivo=est.find(e=>normNombre(reservaFila(e)?.titular_nombre)===objetivoNorm);
            if(!objetivo) objetivo=est.find(e=>normNombre(reservaFila(e)?.titular_nombre).includes(objetivoNorm)||objetivoNorm.includes(normNombre(reservaFila(e)?.titular_nombre)));
            if(!objetivo){mensaje("asistente",`No encontré a “${nombre}” en CAB ${numero} dentro del historial de Proyecto H.`);return;}

            const previos=est.filter(e=>e.id!==objetivo.id&&e.fecha_ingreso<objetivo.fecha_ingreso&&e.fecha_salida<=objetivo.fecha_ingreso)
                .sort((a,b)=>String(b.fecha_salida).localeCompare(String(a.fecha_salida))||String(b.fecha_ingreso).localeCompare(String(a.fecha_ingreso)));
            const previo=previos[0];
            if(!previo){mensaje("asistente",`No encontré una estadía anterior a ${reservaFila(objetivo)?.titular_nombre||nombre} en CAB ${numero}.`);return;}

            const extras=[`Antes de ${reservaFila(objetivo)?.titular_nombre||nombre} (${fechaVisible(objetivo.fecha_ingreso)}), la estadía inmediatamente anterior registrada fue ésta.`];
            if(/\b(?:quien\s+reviso|y\s+quien\s+reviso|revision)\b/.test(norm(texto))){
                const fechaPrep=previo.fecha_ingreso;
                const aseo=await aseoProyecto(fechaPrep,cab.id);
                let revisor=aseo?.revisor_nombre||null, fuente="Proyecto H";
                if(!revisor){
                    const lib=await aseoLibro(fechaPrep,numero);
                    revisor=valorLibro(lib?.revisado_por); if(revisor)fuente="Libro de Reserva · respaldo";
                }
                extras.push(revisor?`Revisión del alojamiento para el ingreso de ese huésped: ${revisor} (${fuente}, ${fechaVisible(fechaPrep)}).`:`No encontré quién revisó el alojamiento para su ingreso el ${fechaVisible(fechaPrep)}.`);
            }
            renderHuesped(`Huésped anterior a ${reservaFila(objetivo)?.titular_nombre||nombre}`,numero,previo,extras);
        }

        async function procesar(texto) {
            if(ocupado)return;
            const tipo=tipoConsulta(texto); if(!tipo)return;
            const numero=cabanaTexto(texto);
            ocupado=true; enviar.disabled=true;
            mensaje("usuario",texto); campo.value="";
            try{
                if(tipo==="huesped_anterior"||tipo==="ultimo_huesped") await procesarHistorial(tipo,texto,numero);
                else await procesarAseo(tipo,texto,numero,fechaTexto(texto,true));
            }catch(error){
                console.error("HAKU · Consulta de aseo:",error);
                mensaje("asistente",`No pude completar la consulta de aseo: ${error?.message||"error inesperado"}.`);
            }finally{
                ocupado=false; enviar.disabled=false; campo.focus();
            }
        }

        function interceptarClick(ev) {
            const texto=String(campo.value||"").trim(); if(!tipoConsulta(texto))return;
            ev.preventDefault();ev.stopImmediatePropagation();procesar(texto);
        }
        function interceptarTecla(ev) {
            if(ev.key!=="Enter"||ev.shiftKey)return;
            const texto=String(campo.value||"").trim(); if(!tipoConsulta(texto))return;
            ev.preventDefault();ev.stopImmediatePropagation();procesar(texto);
        }
        enviar.addEventListener("click",interceptarClick,true);
        campo.addEventListener("keydown",interceptarTecla,true);
        console.info("HAKU · Consultas de aseo V1 preparadas.");
        return true;
    }

    if(!instalar()){
        let n=0;
        const timer=setInterval(()=>{n+=1;if(instalar()||n>80)clearInterval(timer);},50);
        document.addEventListener("DOMContentLoaded",instalar,{once:true});
    }
})();
