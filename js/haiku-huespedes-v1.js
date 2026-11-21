
(() => {
    "use strict";
    const root = document.getElementById("seccion-huespedes");
    const menu = document.querySelector('.menu-item[data-seccion="huespedes"]');
    const api = window.HAIKU_HUESPEDES_API;
    if (!root || !menu || !api) return;

    const tabs = root.querySelector(".hu-tabs");
    const filters = root.querySelector(".hu-filtros");
    const totals = root.querySelector(".hu-resumen");
    const directory = root.querySelector(".hu-lista");
    const detail = root.querySelector(".hu-ficha");
    const dialog = root.querySelector("dialog");
    const roles = {titular:"Titular", acompanante:"Acompañante", borrador:"Borrador"};
    const labels = {hospedados:"Hospedados", todos:"Todos", pendientes:"Por completar"};
    const groups = ["Motivo","Compañía","Intereses","Atención"];
    const filtersState = {p_estado:"hospedados",p_busqueda:null,p_tipo:null,p_origen:null,p_etiqueta:null,p_desde:0};
    const dateFormat = new Intl.DateTimeFormat("es-CL",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
    const dualIcons = ["back","chevron","close","expand","search"];
    let data, profile, selected, listRequest = 0, detailRequest = 0, timer, scrollY = 0;
    let historyOpen = false, baseOpen = false, sessionKey;

    function el(tag,cls,...children) {
        const item = document.createElement(tag);
        if (cls) item.className = cls;
        item.append(...children.filter(child=>child !== false && child != null));
        return item;
    }
    const box = (cls,...children)=>el("div",cls,...children);
    const muted = text=>el("span","hu-muted",text);
    const name = p=>[p.nombre,p.apellido].filter(Boolean).join(" ") || (p.plaza>0?"Acompañante "+p.plaza:"Acompañante por identificar");
    const day = value=>value ? dateFormat.format(new Date(value.slice(0,10)+"T12:00:00Z")) : "";
    const quantity = (count,single,plural)=>count+" "+(count===1?single:plural);
    const dates = v=>v?.ingreso&&v?.salida&&v.ingreso.slice(0,7)===v.salida.slice(0,7)
        ?Number(v.ingreso.slice(8,10))+"–"+day(v.salida):[day(v?.ingreso),day(v?.salida)].filter(Boolean).join(" – ");
    const cabin = v=>v?.numero ? "Cabaña "+v.numero+(v.tipo?" · "+v.tipo:"") : "Sin cabaña asignada";
    function icon(key) {
        const fragment = document.createDocumentFragment();
        for (const suffix of dualIcons.includes(key) ? ["-light",""] : [""]) {
            const img = el("img","hu-icono"+(dualIcons.includes(key) ? suffix ? " hu-icono-claro" : " hu-icono-oscuro" : ""));
            img.src = "assets/huespedes/"+key+suffix+".svg";
            img.alt = "";
            fragment.append(img);
        }
        return fragment;
    }
    function btn(label, action, {cls="", glyph, iconOnly=false, primary=false}={}) {
        const button = el("button","hu-boton "+cls,glyph&&icon(glyph),!iconOnly&&label);
        button.type = "button";
        if (iconOnly) button.setAttribute("aria-label",label);
        if (primary) button.dataset.primario = "";
        button.addEventListener("click",action);
        return button;
    }
    function select(options, value) {
        const input = el("select","hu-select",...options.map(([v,k])=>{
            const option = el("option","",k);
            option.value = v;
            return option;
        }));
        input.value = value ?? "";
        return input;
    }
    function avatar(p, big=false) {
        const initials = p.nombre ? name(p).split(/\s+/).slice(0,2).map(s=>s[0]).join("").toLocaleUpperCase("es") : "AP";
        const result = el("span","hu-avatar"+(big ? " hu-avatar-perfil" : ""),initials);
        if (p.foto) api.signed(p.foto).then(src=>{
            if (!result.isConnected) return;
            const image = el("img","");
            image.alt = "";
            image.onload=()=>result.replaceChildren(image);
            image.src=src;
        }).catch(()=>{});
        return result;
    }
    function errorText(error) {
        if (error?.code==="PGRST202") return "Huéspedes requiere la migración del servidor.";
        if (["23505","HLI01"].includes(error?.code)) return "El documento ya está registrado. Busca y vincula el perfil correcto.";
        return error?.message || "No se pudo conectar con Proyecto H.";
    }
    function message(text,retry) { return box("hu-empty",el("p","",text),retry&&btn("Reintentar",retry)); }
    function allowed() {
        const ok = Boolean(window.haikuSesion && window.haikuTienePermiso?.("huespedes.ver"));
        menu.hidden = !ok;
        const supplies=document.querySelector(".hu-shell-supplies");
        if(supplies)supplies.hidden=!window.haikuTienePermiso?.("cabanas.ver");
        return ok;
    }
    function change(key,value) {
        Object.assign(filtersState,{[key]:value,p_desde:0});
        void list();
    }
    async function list(preserve=false, append=false) {
        if (!allowed()) return;
        const call = ++listRequest;
        if (!preserve && !append) directory.replaceChildren(message("Cargando huéspedes…"));
        try {
            const next = await api.rpc("directorio",{...filtersState});
            if (call !== listRequest || !allowed()) return;
            data = append ? {...next,filas:data.filas.concat(next.filas)} : next;
            renderList(preserve);
        } catch(error) {
            if (call === listRequest) {
                if (preserve && data) totals.textContent = errorText(error);
                else directory.replaceChildren(message(errorText(error),()=>list()));
            }
        }
    }
    function renderList(preserve) {
        const y = window.scrollY;
        const focused = document.activeElement?.dataset?.huControl;
        tabs.replaceChildren(...Object.entries(labels).map(([key,label])=>{
            const button = btn(label+" · "+data.conteos[key],()=>change("p_estado",key),{cls:"hu-chip"});
            button.setAttribute("aria-pressed",String(filtersState.p_estado===key));
            button.dataset.huControl=key;
            return button;
        }));
        for (const [key,label,values] of [["p_tipo","Tipo de cabaña",data.tipos.map(s=>[s,s])],
            ["p_etiqueta","Etiquetas",data.etiquetas.map(o=>[o.id,o.nombre])],["p_origen","Origen",data.origenes.map(s=>[s,s])]]) {
            const input = select([["",key==="p_tipo"?label+": Todos":label],...values],filtersState[key]);
            input.setAttribute("aria-label",label);
            input.dataset.huControl=key;
            input.addEventListener("change",()=>change(key,input.value||null));
            const prior = filters.querySelector('[data-hu-control="'+key+'"]');
            if (prior) prior.replaceWith(input); else filters.append(input);
        }
        if (focused) root.querySelector('[data-hu-control="'+focused+'"]')?.focus({preventScroll:true});
        const count = data.conteos[filtersState.p_estado];
        totals.textContent = quantity(count,"persona","personas")+" · "+quantity(data.cabanas,"cabaña","cabañas");
        const heading = box("hu-fila hu-lista-cabecera",el("span","","HUÉSPED"),el("span","","ESTADÍA Y CABAÑA"),el("span","","PERFIL E INFORMACIÓN"));
        const rows = data.filas.map(p=>{
            const tags = p.etiquetas.join(" · ") || (p.excedente ? "Ocupación modificada" : p.pendiente ? "Por completar" : "");
            const where = p.reserva_id ? (p.numero ? "Cabaña "+p.numero : "Sin cabaña asignada") : "Sin estadía vinculada";
            const row = el("button","hu-fila",box("hu-identidad",avatar(p),box("",el("strong","hu-nombre",name(p)),
                muted([roles[p.rol],p.documento].filter(Boolean).join(" · ")),el("span","hu-destacado hu-mini-movil",where),el("span","hu-muted hu-mini-movil",tags))),
                box("hu-columna",el("strong","",where),muted([p.tipo,dates(p)].filter(Boolean).join(" · "))),box("hu-columna",el("span","hu-destacado",tags),muted(quantity(p.visitas,"estadía","estadías")+(p.registros?" · "+quantity(p.registros,"registro","registros"):""))),icon("chevron"));
            row.type="button";
            row.dataset.personId=p.id;
            row.setAttribute("aria-current",String(selected?.id===p.id));
            row.onclick=()=>{scrollY=window.scrollY;openProfile(p.id,p.reserva_id);};
            return row;
        });
        directory.replaceChildren(...(rows.length?[heading,...rows]:[message("No hay huéspedes para estos filtros.")]));
        if(rows.length) directory.append(box("hu-lista-pie",muted(totals.textContent),muted("Orden: cabaña")));
        if (data.filas.length < count) directory.append(btn("Cargar más",()=>{
            filtersState.p_desde=data.filas.length;
            void list(true,true);
        },{cls:"hu-ancho"}));
        if (!selected && rows.length && !matchMedia("(max-width:760px)").matches) {
            const first = data.filas[0];
            void openProfile(first.id,first.reserva_id);
        }
        if (preserve) window.scrollTo(0,y);
    }
    function back() {
        ++detailRequest;
        root.dataset.ficha="false";
        window.scrollTo(0,scrollY);
    }
    async function openProfile(id,res,keep=false) {
        if (!allowed()) return;
        const call = ++detailRequest;
        if (!keep) {
            selected={id,res};
            profile=undefined;
            historyOpen=baseOpen=false;
            root.dataset.ficha="true";
            directory.querySelectorAll("[data-person-id]").forEach(row=>row.setAttribute("aria-current",String(row.dataset.personId===id)));
            detail.replaceChildren(message("Cargando perfil…"));
            if (matchMedia("(max-width:760px)").matches) detail.scrollIntoView({block:"start"});
        }
        try {
            const next = await api.rpc("perfil",{p_id:id,p_reserva:res??null});
            if (call !== detailRequest || !allowed()) return;
            profile=next;
            selected={id,res:next.visita?.reserva_id??null};
            renderProfile();
        } catch(error) {
            if (call !== detailRequest) return;
            if (keep) detail.querySelector("[data-save]").textContent=errorText(error);
            else detail.replaceChildren(btn("Huéspedes",back,{cls:"hu-movil",glyph:"back"}),message(errorText(error),()=>openProfile(id,res)));
        }
    }


    function row(title, subtitle, action, glyph, person) {
        return box("hu-integrante",box("hu-identidad",person ? avatar(person) : glyph&&box("hu-tipo-icono",icon(glyph)),
            box("",el("strong","hu-nombre",title),subtitle&&muted(subtitle))),action);
    }
    function group(title,action,...rows) {
        return box("hu-separador hu-bloque"+(/^(Acompañantes|Integrantes|Perfil de esta)/.test(title)?" hu-sin-borde":""),box("hu-subtitulo",el("h4","",title),action),
            ...(/^(Acompañantes|Integrantes)/.test(title)?[box("hu-miembros",...rows)]:rows));
    }
    function recordRow(record) {
        const content=[record.superior,record.inferior,record.texto].filter(Boolean).join(" · ");
        const item=box("hu-registro",el("span","",content),muted([record.fuente,record.nombre_operador?.trim()||"Operador de Haku",day(record.fecha)].join(" · ")));
        if(profile.puede_editar){
            item.tabIndex=0;item.setAttribute("role","button");item.setAttribute("aria-label","Editar información: "+content);
            item.onclick=()=>editRecord(record);
            item.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();editRecord(record);}};
        }
        return item;
    }
    function accordion(title,open,toggle,content) {
        const panel=el("details","hu-separador",el("summary","",title,icon("expand")),content);
        panel.open=open;
        panel.ontoggle=()=>toggle(panel.open,content);
        return panel;
    }
    async function history(open,target) {
        if (!target.isConnected) return;
        historyOpen=open;
        if (!open || target.dataset.loaded) return;
        const ctx=selected;
        target.replaceChildren(muted("Cargando historial…"));
        try {
            const result=await api.rpc("perfil",{p_id:ctx.id,p_reserva:ctx.res,p_historial:true});
            if (!target.isConnected) return;
            target.dataset.loaded="true";
            target.replaceChildren(...(result.historial.length ? result.historial.map(v=>row(cabin(v),dates(v),
                btn("Ver estadía",()=>openProfile(ctx.id,v.reserva_id)))) : [muted("Sin estadías anteriores.")]));
        } catch(error) {target.replaceChildren(message(errorText(error),()=>history(true,target)));}
    }
    function renderProfile() {
        const {persona:p,visita:v,integrantes,registros,puede_editar:edit}=profile;
        const options=edit&&el("details","hu-opciones",el("summary","","···"),box("",
            btn("Agregar vehículo",()=>editEntity("vehiculo"),{cls:"hu-plano"}),btn("Agregar mascota",()=>editEntity("mascota"),{cls:"hu-plano"}),
            btn("Editar contacto e idioma",editBase,{cls:"hu-plano"})));
        if(options)options.querySelector("summary").setAttribute("aria-label","Más opciones del huésped");
        const header=box("hu-linea hu-perfil-identidad",box("hu-identidad",avatar(p,true),box("",el("h3","",name(p)),muted([quantity(profile.visitas,"estadía","estadías"),profile.tipos_visitados?.join(" y ")||v?.tipo].filter(Boolean).join(" · ")),el("span","hu-rol",v?.rol==="titular"?"Titular de la reserva":roles[v?.rol]||""))),
            edit&&btn(p.foto?"Cambiar foto":"Agregar foto",()=>editPhoto({kind:"persona",path:p.foto}),{cls:"hu-plano",glyph:"camera",iconOnly:true}),options);
        const visits=v&&box("hu-contexto",box("hu-linea",muted(v.hospedada?"ESTADÍA ACTUAL":"ESTADÍA"),
            btn("Ver reserva",e=>window.HAIKU_RESUMEN_RESERVA_SITES_V1?.abrirPorId(v.reserva_id,e.currentTarget),{cls:"hu-plano hu-link"})),
            el("strong","",cabin(v)),
            muted([dates(v),v.adultos!==null&&(v.adultos+v.ninos)+" personas"].filter(Boolean).join(" · ")),
            el("span","hu-estadia-info",integrantes.filter(x=>x.rol!=="borrador").length+" identificados · "+integrantes.filter(x=>x.rol==="borrador"&&!x.excedente).length+" pendiente de identificar"),
            !v.numero&&profile.estadias.length>1&&muted("Asignación pendiente · "+profile.estadias.map(x=>x.numero&&"Cab. "+x.numero).filter(Boolean).join(", ")));
        const companions=integrantes.filter(x=>x.id!==p.id).map(x=>row(name(x),roles[x.rol]+(x.excedente?" · Fuera de la ocupación actual":x.rol==="borrador"?" · Datos por completar":" · Perfil propio"),
            btn(x.rol==="borrador"&&edit?"Completar":"Ver perfil",()=>openProfile(x.id,v.reserva_id)),null,x));
        const draft=(p.borrador||v?.plaza===0)&&box("hu-bloque",
            el("p","hu-aviso",v.excedente?(p.cupo_revisado_en?"Cupo revisado. Se conserva el borrador.":"La ocupación cambió. Este borrador conserva lo registrado."):"Por completar"),
            edit&&box("hu-chips",btn("Completar datos",editDraft,{primary:true}),btn("Vincular perfil existente",linkDraft),v.excedente&&!p.cupo_revisado_en&&btn("Marcar cupo revisado",()=>formDialog("Revisar cupo",[muted("Se conservará el borrador en el directorio.")],(_v,form,ctx)=>save("revisar_cupo",{},ctx,form)))));
        const tags=box("hu-chips",...profile.etiquetas.map(x=>el("span","hu-mini",x.nombre)));
        const base=el("dl","hu-base");
        for(const [k,val] of [["Nombre",p.nombre],["Apellidos",p.apellido],["Documento",[p.tipo_documento,p.numero_documento].filter(Boolean).join(" ")],
            ["Teléfono",p.telefono],["Correo",p.correo],["País",p.nacionalidad],["Idioma",p.idioma]]) {
            if(val) base.append(box("",el("dt","",k),el("dd","",val)));
        }
        const save=el("div","hu-resultado");
        save.setAttribute("role","status");save.dataset.save="";
        const local=registros.filter(x=>x.reserva_id);
        const buttonOptions={cls:"hu-plano"};
        const clothing=local.filter(x=>x.categoria==="vestimenta");
        const related=box("hu-relacionados",
            v&&row("Vestimenta de hoy",clothing.length?[clothing[0].superior,clothing[0].inferior,clothing[0].texto].filter(Boolean).join(" · "):"Sin registrar",edit&&btn("Editar",()=>editPhoto({kind:"persona",path:p.foto})),"shirt"),
            ...profile.vehiculos.map(x=>row(x.modelo||x.tipo,["Vehículo",x.tipo,x.color].filter(Boolean).join(" · "),btn("Ver perfil",()=>editEntity("vehiculo",x)),"vehicle")),
            ...profile.mascotas.map(x=>row(x.nombre,["Mascota",x.especie,x.tamano].filter(Boolean).join(" · "),btn("Ver perfil",()=>editEntity("mascota",x)),"pet")));
        const content=[header,
            box("hu-linea",muted(p.numero_documento?(p.tipo_documento==="rut"?"RUT ":"Documento ")+"••••"+p.numero_documento.slice(-4):"Sin documento"),
                muted([p.nacionalidad,p.idioma].filter(Boolean).join(" · "))),visits,draft,
            companions.length&&group((v.rol==="titular"?"Acompañantes":"Integrantes de la reserva")+" · "+companions.length,muted(quantity(integrantes.filter(x=>x.rol==="borrador"&&!x.excedente).length,"por identificar","por identificar")),...companions),
            group("Perfil de esta visita",edit&&btn("Editar",editTags,buttonOptions),tags,p.descripcion&&muted(p.descripcion)),
            group("Para atender mejor",edit&&btn("Editar",()=>editRecord({categoria:"preferencia"}),buttonOptions),...registros.filter(x=>!x.reserva_id).map(recordRow)),
            v&&group("Durante esta estadía",btn("Ver todo",()=>formDialog("Durante esta estadía",[...local.filter(x=>x.categoria!=="vestimenta").map(recordRow),edit&&btn("Registrar información",()=>editRecord({categoria:"actividad"}),{primary:true})]),buttonOptions),...local.filter(x=>x.categoria!=="vestimenta").slice(0,2).map(recordRow)),
            related,
            accordion("Datos base",baseOpen,open=>{baseOpen=open;},box("",base,edit&&btn("Editar contacto e idioma",editBase))),
            accordion("Historial de estadías · "+profile.visitas,historyOpen,history,box("hu-bloque")),
            save,edit&&btn("Registrar información",()=>editRecord({}),{primary:true,cls:"hu-ancho"})];
        detail.replaceChildren(...content.filter(Boolean));
        let backControl=root.querySelector(".hu-volver");
        if(!backControl){backControl=btn("Huéspedes",back,{cls:"hu-volver hu-movil hu-plano hu-icono-boton",glyph:"back"});detail.before(backControl);}
    }
    function field(label,key,value,type="text",required=false) {
        const input=Array.isArray(type)?select(type,value):el(type==="textarea"?"textarea":"input","hu-campo");
        if(input.tagName==="INPUT") input.type=type;
        input.name=key;
        input.required=required;
        if(type==="checkbox") {
            input.checked=Boolean(value);
            return el("label","hu-checkbox",input,label);
        }
        if(type!=="file") input.value=value??"";
        return el("label","",label,input);
    }
    function viewContext() {
        return {...selected,revision:detailRequest,session:sessionKey};
    }
    function sameView(ctx) {
        return ctx.revision===detailRequest&&ctx.session===sessionKey;
    }
    dialog.addEventListener("cancel",event=>{
        if(dialog.firstElementChild?.getAttribute("aria-busy")==="true") event.preventDefault();
    });
    function formDialog(title,fields,save,label="Guardar",subtitle="") {
        const ctx=viewContext();
        const status=el("div","hu-resultado");
        status.setAttribute("role","status");
        const closer=btn("Cerrar",()=>dialog.close(),{glyph:"close",iconOnly:true});
        const backButton=btn("Volver",()=>dialog.close());
        const confirm=el("button","hu-boton",label);
        confirm.dataset.primario="";
        confirm.type="submit";
        const form=el("form","hu-formulario",box("hu-linea",box("",el("h3","",title),subtitle&&el("p","hu-form-subtitle",subtitle)),closer),...fields.filter(Boolean),status,
            el("footer","",backButton,save&&confirm));
        form.onsubmit=async event=>{
            event.preventDefault();
            if(!save||confirm.disabled) return;
            form.setAttribute("aria-busy","true");
            closer.disabled=backButton.disabled=confirm.disabled=true;
            status.textContent="Guardando…";
            const values=Object.fromEntries(new FormData(form));
            for(const input of form.querySelectorAll('[type="checkbox"]')) values[input.name]=input.checked;
            try { await save(values,form,ctx); } catch(error) {status.textContent=errorText(error);}
            finally {
                form.removeAttribute("aria-busy");
                closer.disabled=backButton.disabled=confirm.disabled=false;
            }
        };
        dialog.replaceChildren(form);
        if(!dialog.open) dialog.showModal();
        return form;
    }
    function write(action,payload,ctx) {
        if(ctx&&ctx.session!==sessionKey) throw new Error("La sesión cambió. Vuelve a abrir la ficha.");
        return api.rpc("guardar",{p_id:ctx?.id??null,p_reserva:ctx?.res??null,p_accion:action,p_datos:payload});
    }
    async function refresh(ctx,form,id=ctx.id) {
        if(dialog.open&&dialog.firstElementChild===form) dialog.close();
        if(!sameView(ctx)) return;
        const loading=openProfile(id,ctx.res,id===ctx.id);
        const revision=detailRequest;
        await loading;
        if(revision!==detailRequest) return;
        const status=detail.querySelector("[data-save]");
        if(status&&!status.textContent) status.textContent="Guardado.";
        filtersState.p_desde=0;
        void list(true);
    }
    async function save(action,payload,ctx,form) {
        const ack=await write(action,payload,ctx);
        await refresh(ctx,form,["identificar","vincular"].includes(action)?ack.id:ctx.id);
    }
    function editBase() {
        const p=profile.persona;
        formDialog("Datos del huésped",[field("País","nacionalidad",p.nacionalidad),field("Idioma","idioma",p.idioma),
            field("Teléfono","telefono",p.telefono,"tel"),field("Correo","correo",p.correo,"email"),
            field("Descripción","descripcion",p.descripcion,"textarea")],(v,form,ctx)=>save("ficha",v,ctx,form));
    }
    function editDraft() {
        const p=profile.persona;
        const photo=photoEditor({kind:"persona",path:p.foto},"hu-pet-photo");
        const form=formDialog(name(p),[el("p","hu-aviso","Cupo de la reserva · Puedes guardar un borrador e identificarlo después."),
            box("hu-media hu-pet-media",photo.preview,box("hu-media-copy",el("strong","","Foto del acompañante"),muted("Opcional · Ayuda a reconocerlo."),btn("Agregar foto",photo.choose,{cls:"hu-plano"}))),
            box("hu-form-grid",field("Nombre","nombre",p.nombre),field("Apellidos","apellido",p.apellido),
            field("Tipo de documento","tipo_documento",p.tipo_documento,[["","Sin documento"],["rut","RUT"],["pasaporte","Pasaporte"],["otro","Otro"]]),
            field("Número de documento","numero_documento",p.numero_documento)),btn("Vincular perfil existente",linkDraft,{cls:"hu-plano"}),field("Cómo reconocerlo hoy","descripcion",p.descripcion,"textarea"),
            field("Información y gustos","texto","","textarea")],async(values,form,ctx)=>{
            if(!values.nombre.trim()&&values.numero_documento.trim()) throw new Error("Ingresa el nombre para completar la identificación.");
            await write("ficha",{descripcion:values.descripcion},ctx);
            await photo.persist();
            if(values.texto.trim()) await write("registro",{id:form.dataset.note,categoria:"preferencia",texto:values.texto,fuente:"Observación"},ctx);
            if(values.nombre.trim()) await save("identificar",values,ctx,form);
            else await refresh(ctx,form);
        },"Guardar",cabin(profile.visita));
        form.dataset.note=crypto.randomUUID();
    }


    function linkDraft() {
        const ctx=viewContext();
        const participants=new Set(profile.visita?.plaza>0 ? profile.integrantes.map(p=>p.id) : []);
        const search=field("Nombre o documento","buscar","");
        const listBox=box("hu-bloque",muted("Escribe el nombre o documento del perfil."));
        formDialog("Vincular a un perfil existente",[search,listBox]);
        let turn=0, pending;
        search.querySelector("input").oninput=event=>{
            const query=event.target.value.trim();
            const call=++turn;
            clearTimeout(pending);
            if(!query) return listBox.replaceChildren(muted("Escribe el nombre o documento del perfil."));
            pending=setTimeout(async()=>{
                try{
                    const found=await api.rpc("directorio",{p_estado:"todos",p_busqueda:query});
                    if(call!==turn||!listBox.isConnected) return;
                    const rows=found.filas.filter(p=>!p.borrador&&p.plaza==null&&!participants.has(p.id)).map(p=>row(name(p),p.documento,
                        btn("Vincular",()=>formDialog("Vincular a "+name(p),[muted("Se conservará la información del borrador.")],
                            (_v,form)=>save("vincular",{huesped_id:p.id},ctx,form),"Vincular"))));
                    listBox.replaceChildren(...(rows.length?rows:[muted("Sin coincidencias.")]));
                }catch(error){if(call===turn) listBox.replaceChildren(muted(errorText(error)));}
            },230);
        };
    }
    function editTags() {
        const picked=new Set(profile.etiquetas.map(x=>x.id));
        const search=field("Buscar o crear etiqueta","buscar_etiqueta","");
        const groupTitles={Motivo:"Motivo de la estadía",Compañía:"Forma de viajar",Intereses:"Intereses",Atención:"Cómo prefiere la atención"};
        const sections=groups.map(group=>{
            const options=(data?.etiquetas||[]).filter(x=>x.grupo===group).map(e=>{
                const input=el("input","");
                input.type="checkbox";
                input.checked=picked.has(e.id);
                input.onchange=()=>input.checked?picked.add(e.id):picked.delete(e.id);
                const label=el("label","hu-etiqueta",input,e.nombre);label.dataset.tagName=e.nombre.toLocaleLowerCase("es");return label;
            });
            return el("fieldset","",el("legend","",groupTitles[group]),box("hu-chips",...options));
        });
        formDialog("Etiquetas del huésped",[search,...sections,btn("Nueva etiqueta",addTag,{cls:"hu-plano"}),muted("Origen e idioma · "+[profile.persona.nacionalidad,profile.persona.idioma].filter(Boolean).join(" · "))],(_v,form,ctx)=>save("etiquetas",{ids:[...picked]},ctx,form),"Guardar",name(profile.persona));
        search.querySelector("input").oninput=e=>sections.forEach(section=>{
            section.querySelectorAll("[data-tag-name]").forEach(label=>{label.hidden=!label.dataset.tagName.includes(e.target.value.trim().toLocaleLowerCase("es"));});
        });
    }
    function addTag() {
        formDialog("Nueva etiqueta",[field("Grupo","grupo","Motivo",groups.map(g=>[g,g])),field("Nombre","nombre","","text",true)],async v=>{
            await write("crear_etiqueta",v,null);
            dialog.close();
            await list(true);
            if(profile?.puede_editar) editTags();
        });
    }
    function editRecord(record) {
        const hasStay=Boolean(profile.visita);
        const kinds=[["preferencia","Preferencia"],["nota","Nota"]];
        if(hasStay) kinds.push(["actividad","Actividad de la estadía"],["vestimenta","Vestimenta"]);
        const cat=choices("Tipo de información","categoria",record.categoria||"preferencia",kinds);
        const scope=field("Solo en esta estadía","solo_estadia",record.reserva_id,"checkbox");
        scope.hidden=true;
        const upper=field("Prenda superior","superior",record.superior);
        const lower=field("Prenda inferior","inferior",record.inferior);
        const words=field("Información o detalles","texto",record.texto,"textarea");
        const sources=["Observación","Lo comentó","Confirmado por huésped"];
        const storage=box("hu-bloque");
        const form=formDialog(record.id?"Editar información":"Registrar información",[
            el("strong","","¿Qué aprendimos del huésped?"),cat,box("hu-form-grid",upper,lower),words,
            el("strong","","¿Dónde conservarlo?"),scope,storage,choices("Fuente","fuente",record.fuente||sources[0],sources.map(s=>[s,s]),true)
        ],(values,f,ctx)=>save("registro",{...values,id:record.id||f.dataset.id,
            ...(record.modificado_en?{version:record.modificado_en}:{})},ctx,f),"Guardar",[name(profile.persona),profile.visita?.numero&&"Cabaña "+profile.visita.numero].filter(Boolean).join(" · "));
        form.dataset.id=crypto.randomUUID();
        const type=cat.querySelector("input");
        function adjust(){
            if(!hasStay||type.value!=="nota")scope.querySelector("input").checked=false;
            upper.hidden=lower.hidden=type.value!=="vestimenta";
            upper.parentElement.hidden=upper.hidden;
            words.querySelector("textarea").required=type.value!=="vestimenta";
            const local=["actividad","vestimenta"].includes(type.value)||scope.querySelector("input").checked;
            storage.replaceChildren(...[false,...(hasStay?[true]:[])].map(value=>{
                const choice=btn("",()=>{scope.querySelector("input").checked=value;adjust();},{cls:"hu-radio-row hu-plano"});
                choice.append(el("span","hu-radio-dot",local===value?"◉":"○"),box("",el("span","",value?"Solo en esta estadía":"Conservar en el perfil"),
                    muted(value?"Actividades, vestimenta y detalles de esta visita.":"Preferencias útiles para futuras visitas.")));
                choice.setAttribute("role","radio");choice.setAttribute("aria-checked",String(local===value));choice.disabled=type.value!=="nota";
                return choice;
            }));
        }
        type.onchange=adjust;adjust();
    }
    function choices(label,key,value,options,stack=false){
        const input=el("input","");input.type="hidden";input.name=key;input.value=value;
        const controls=box(stack?"hu-choice-stack":"hu-chips");
        const sync=()=>controls.querySelectorAll("button").forEach(b=>{b.setAttribute("aria-checked",String(input.value===b.dataset.value));});
        controls.append(...options.map(([v,text])=>{
            const button=btn(text,()=>{input.value=v;sync();input.dispatchEvent(new Event("change"));},{cls:"hu-choice"});
            button.dataset.value=v;button.setAttribute("role","radio");button.setAttribute("aria-label",text);return button;
        }));
        sync();const result=el("fieldset","hu-choice-field",el("legend","",label),input,controls);return result;
    }
    function editEntity(kind,item={}) {
        const vehicle=kind==="vehiculo", edit=profile.puede_editar;
        const id=item.id||crypto.randomUUID();
        const entries=vehicle?[["Tipo de vehículo","tipo",true],["Marca y modelo","modelo"],["Color","color"],["Patente (opcional)","patente"]]
            :[["Nombre","nombre",true],["Especie","especie",true],["Raza (opcional)","raza"],["Tamaño","tamano"],["Color","color"]];
        const fields=entries.map(([label,key,needed])=>field(label,key,item[key],key==="cuidados"?"textarea":"text",needed));
        if(!vehicle)fields.at(-1).classList.add("hu-full");
        const photo=photoEditor({kind,id,path:item.foto},vehicle?"hu-vehicle-photo":"hu-pet-photo",vehicle?"vehicle":"pet");
        const context=box("hu-media-copy",el("span","hu-media-context",vehicle?"Vehículo de esta estadía":"Mascota del huésped"),
            el("span","",[name(profile.persona),profile.visita?.numero&&"Cabaña "+profile.visita.numero].filter(Boolean).join(" · ")),muted(dates(profile.visita)),
            edit&&btn(item.foto?"Cambiar foto":"Cargar foto",photo.choose));
        const media=box("hu-media"+(!vehicle?" hu-pet-media":""),photo.preview,context);
        const form=formDialog(vehicle?(item.modelo||"Vehículo de la estadía"):(item.nombre||"Perfil de mascota"),[
            media,edit&&photo.controls,box("hu-form-grid",...fields),
            !vehicle&&profile.visita&&field("Acompaña en esta estadía","presente",item.presente,"checkbox"),
            !vehicle&&field("Para su cuidado","cuidados",item.cuidados),
            vehicle&&muted("Ligado a esta estadía; puede cambiar en otra visita.")],edit?async(v,f,ctx)=>{
                await write(kind,{...v,id},ctx);
                await photo.persist();
                await refresh(ctx,f);
            }:null,vehicle?"Guardar vehículo":"Guardar mascota",vehicle?"Perfil del vehículo"+(item.tipo?" · "+item.tipo:""):"Perfil de mascota"+(item.especie?" · "+item.especie:""));
        form.querySelector("footer button").textContent="Volver al huésped";
        if(!edit) form.querySelectorAll("input,select,textarea").forEach(x=>{x.disabled=true;});
    }
    function photoEditor(target,cls="hu-person-photo",glyph="camera") {
        const p=profile;
        const input=el("input","hu-file-input");input.type="file";
        input.setAttribute("aria-label","Elegir imagen");
        input.accept="image/*";
        input.hidden=true;
        const canvas=el("canvas","");canvas.width=canvas.height=800;canvas.hidden=true;
        const empty=box("hu-media-copy",icon(glyph),el("span","hu-media-context","Agregar foto"));
        const preview=box("hu-media-preview "+cls,empty,canvas);
        let picture, angle=0,changed=false,removed=false;
        const ranges={};
        if(target.path)api.signed(target.path).then(src=>{
            if(!preview.isConnected||changed)return;
            const image=el("img","");image.alt="Foto de la ficha";image.src=src;preview.prepend(image);empty.hidden=true;
        }).catch(()=>{});
        const controls=[["Acercar","zoom",1,3,.05,1],["Ajustar horizontal","dx",-100,100,1,0],["Ajustar vertical","dy",-100,100,1,0]]
            .map(([label,key,min,max,step,value])=>{
                const control=field(label,key,value,"range");
                const range=control.querySelector("input");
                Object.assign(range,{min,max,step,value});
                ranges[key]=range;
                range.oninput=draw;
                return control;
            });
        const adjustments=el("details","hu-photo-adjustments",el("summary","","Ajustar encuadre"),...controls);
        const actions=box("hu-photo-controls",input,btn(target.path?"Cambiar foto":"Cargar foto",()=>input.click()),
            btn("Quitar",()=>{changed=true;removed=true;picture=null;canvas.hidden=true;preview.querySelector("img")?.remove();empty.hidden=false;state.textContent="Se quitará al guardar.";},{cls:"hu-plano"}),
            btn("Girar",()=>{angle=(angle+90)%360;draw();},{glyph:"rotate",cls:"hu-icono-boton hu-plano"}));
        const state=el("span","hu-muted");state.setAttribute("role","status");
        input.onchange=()=>{
            picture=null;canvas.hidden=true;
            const file=input.files[0];
            if(!file) return;
            const url=URL.createObjectURL(file);
            const img=new Image();
            img.onload=()=>{
                URL.revokeObjectURL(url);
                if(input.files[0]!==file) return;
                picture=img;angle=0;changed=true;removed=false;ranges.zoom.value=1;ranges.dx.value=ranges.dy.value=0;
                preview.querySelector("img")?.remove();empty.hidden=true;state.textContent="";draw();
            };
            img.onerror=()=>{URL.revokeObjectURL(url);state.textContent="No se pudo leer esta imagen.";};
            img.src=url;
        };
        function draw(){
            if(!picture) return;
            const ctx2d=canvas.getContext("2d"), size=canvas.width;
            const scale=size*Number(ranges.zoom.value)/Math.min(picture.naturalWidth,picture.naturalHeight);
            const w=picture.naturalWidth*scale,h=picture.naturalHeight*scale;
            const [cw,ch]=angle%180?[h,w]:[w,h];
            const dx=(cw-size)/2*Number(ranges.dx.value)/100,dy=(ch-size)/2*Number(ranges.dy.value)/100;
            ctx2d.setTransform(1,0,0,1,0,0);ctx2d.fillStyle="#fff";ctx2d.fillRect(0,0,size,size);
            ctx2d.translate(size/2+dx,size/2+dy);ctx2d.rotate(angle*Math.PI/180);
            ctx2d.drawImage(picture,-w/2,-h/2,w,h);
            canvas.hidden=false;
        }
        return {preview,controls:box("hu-bloque",actions,adjustments,state),choose:()=>input.click(),persist:async()=>{
            if(!changed)return;
            if(!removed&&!picture)throw new Error("Selecciona una imagen válida.");
            const image=removed?null:await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("No se pudo preparar la imagen.")),"image/jpeg",.85));
            await api.photo(p,target,image);
            changed=false;
        }};
    }
    function editPhoto(target) {
        const clothing=target.kind==="persona"&&profile.registros.find(x=>x.reserva_id&&x.categoria==="vestimenta");
        const photo=photoEditor(target);
        const grid=box("hu-form-grid",field("Prenda superior","superior",clothing?.superior),field("Prenda inferior","inferior",clothing?.inferior));
        const other=field("Otros detalles","texto",clothing?.texto);
        const initial=[clothing?.superior||"",clothing?.inferior||"",clothing?.texto||""];
        const clothingId=clothing?.id||crypto.randomUUID();
        const fields=[box("hu-media hu-person-media",photo.preview,box("hu-media-copy",el("strong","","Foto del huésped"),muted("Puedes subir una imagen guardada de WhatsApp."),photo.controls))];
        if(target.kind==="persona"&&profile.visita)fields.push(el("strong","","Vestimenta de hoy"),muted(clothing?day(clothing.fecha)+" · Solo para esta estadía":"Solo para esta estadía"),grid,other);
        formDialog("Foto y reconocimiento",fields,async(v,form,ctx)=>{
            await photo.persist();
            if(target.kind==="persona"&&ctx.res&&[v.superior||"",v.inferior||"",v.texto||""].some((x,i)=>x!==initial[i])){
                await write("registro",{id:clothingId,categoria:"vestimenta",superior:v.superior,inferior:v.inferior,texto:v.texto,fuente:clothing?.fuente||"Observación",...(clothing?.modificado_en?{version:clothing.modificado_en}:{})},ctx);
            }
            await refresh(ctx,form);
        },"Guardar cambios",[name(profile.persona),profile.visita?.numero&&"Cabaña "+profile.visita.numero].filter(Boolean).join(" · "));
    }
    const searchIcon=root.querySelector("[data-hu-search-icon]");
    // Guests uses the approved shell treatment, retaining the real navigation buttons.
    const shellNav=document.querySelector(".sites-shell-sidebar nav.menu");
    if(shellNav){
        const more=btn("Más",()=>{
            const open=shellNav.classList.toggle("hu-nav-extra-open");more.setAttribute("aria-expanded",String(open));
        },{cls:"hu-shell-more"});
        more.setAttribute("aria-expanded","false");
        const supplies=btn("Insumos",()=>{
            document.querySelector('.menu-item[data-seccion="cabanas"]')?.click();
            document.querySelector('#cabinsTabs [data-cab-tab="supplies"]')?.click();
        },{cls:"hu-shell-supplies"});
        const suppliesIcon=document.querySelector('.menu-item[data-seccion="cierre"] svg')?.cloneNode(true);
        if(suppliesIcon)supplies.prepend(suppliesIcon);
        const moreIcon=el("img","hu-icono");moreIcon.src="assets/huespedes/nav-more.svg";moreIcon.alt="";more.prepend(moreIcon);
        shellNav.append(supplies,more);
        const logo=document.querySelector(".sites-shell-sidebar .logo");
        logo?.after(box("hu-shell-brand",el("strong","","HAKU"),muted("Operación")));
    }
    searchIcon.append(icon("search"));
    root.querySelector("[name=hu-buscar]").oninput=event=>{
        clearTimeout(timer);
        const value=event.target.value.trim();
        timer=setTimeout(()=>change("p_busqueda",value||null),230);
    };
    root.querySelector("[data-hu-etiquetas]").onclick=()=>{
        if(profile?.puede_editar) return editTags();
        if(data?.puede_editar) return addTag();
        filters.querySelector('[data-hu-control="p_etiqueta"]')?.focus();
    };
    root.querySelector("[data-hu-registrar]").onclick=()=>{
        if(profile?.puede_editar) editRecord({});
    };
    dialog.addEventListener("close",()=>{if(!dialog.open) dialog.replaceChildren();});
    menu.addEventListener("click",()=>{if(allowed()) void list(Boolean(data));});
    function session(){
        const user=window.haikuSesion?.auth?.id;
        const enabled=allowed();
        const identity=enabled&&user ? user+":"+Boolean(window.haikuTienePermiso("huespedes.gestionar")) : null;
        if (identity&&identity===sessionKey) return;
        sessionKey=identity;
        clearTimeout(timer);
        root.querySelector("[name=hu-buscar]").value="";
        Object.assign(filtersState,{p_estado:"hospedados",p_busqueda:null,p_tipo:null,p_origen:null,p_etiqueta:null,p_desde:0});
        ++listRequest;++detailRequest;
        data=profile=selected=undefined;
        directory.replaceChildren();detail.replaceChildren(message("Selecciona un huésped."));
        totals.textContent="";root.dataset.ficha="false";
        if(dialog.open) dialog.close();
        if(allowed()&&root.classList.contains("activa")) void list();
        else if(menu.hidden&&root.classList.contains("activa")) document.querySelector('[data-seccion="resumen"]')?.click();
    }
    window.addEventListener("haiku:auth-ready",session);
    window.haikuSupabase.auth.onAuthStateChange(event=>{
        if(event==="SIGNED_OUT"){
            menu.hidden=true;sessionKey=null;clearTimeout(timer);
            root.querySelector("[name=hu-buscar]").value="";
            ++listRequest;++detailRequest;
            data=profile=selected=undefined;
            directory.replaceChildren();detail.replaceChildren();totals.textContent="";
            if(dialog.open) dialog.close();
        }
    });
    if(window.haikuSesion) session();
})();
