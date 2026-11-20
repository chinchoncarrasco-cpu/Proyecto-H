
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
    const name = p=>[p.nombre,p.apellido].filter(Boolean).join(" ") || "Acompañante por identificar";
    const day = value=>value ? dateFormat.format(new Date(value.slice(0,10)+"T12:00:00Z")) : "";
    const dates = v=>[day(v?.ingreso),day(v?.salida)].filter(Boolean).join(" – ");
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
        if (big && p.foto) api.signed(p.foto).then(src=>{
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
            const input = select([["",label+": Todos"],...values],filtersState[key]);
            input.setAttribute("aria-label",label);
            input.dataset.huControl=key;
            input.addEventListener("change",()=>change(key,input.value||null));
            const prior = filters.querySelector('[data-hu-control="'+key+'"]');
            if (prior) prior.replaceWith(input); else filters.append(input);
        }
        if (focused) root.querySelector('[data-hu-control="'+focused+'"]')?.focus({preventScroll:true});
        const count = data.conteos[filtersState.p_estado];
        totals.textContent = count+" personas · "+data.cabanas+" cabañas";
        const heading = box("hu-fila hu-lista-cabecera",el("span","","HUÉSPED"),el("span","","ESTADÍA Y CABAÑA"),el("span","","PERFIL E INFORMACIÓN"));
        const rows = data.filas.map(p=>{
            const tags = p.etiquetas.join(" · ") || (p.excedente ? "Ocupación modificada" : p.pendiente ? "Por completar" : "");
            const where = p.reserva_id ? cabin(p) : "Sin estadía vinculada";
            const row = el("button","hu-fila",box("hu-identidad",avatar(p),box("",el("strong","hu-nombre",name(p)),
                muted([roles[p.rol],p.documento].filter(Boolean).join(" · ")),el("span","hu-destacado hu-mini-movil",where),el("span","hu-muted hu-mini-movil",tags))),
                box("hu-columna",el("strong","",where),muted(dates(p))),box("hu-columna",el("span","hu-destacado",tags),muted(p.visitas+" estadías")),icon("chevron"));
            row.type="button";
            row.dataset.personId=p.id;
            row.setAttribute("aria-current",String(selected?.id===p.id));
            row.onclick=()=>{scrollY=window.scrollY;openProfile(p.id,p.reserva_id);};
            return row;
        });
        directory.replaceChildren(...(rows.length?[heading,...rows]:[message("No hay huéspedes para estos filtros.")]));
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
        return box("hu-separador hu-bloque",box("hu-subtitulo",el("h4","",title),action),...rows);
    }
    function recordRow(record) {
        const content=[record.superior,record.inferior,record.texto].filter(Boolean).join(" · ");
        return row(content,[record.fuente,record.nombre_operador?.trim()||"Operador de Haku",day(record.fecha)].join(" · "),
            profile.puede_editar&&btn("Editar",()=>editRecord(record),{cls:"hu-plano"}),record.categoria==="vestimenta"?"shirt":null);
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
        const header=box("hu-linea",box("hu-identidad",avatar(p,true),box("",el("h3","",name(p)),muted(profile.visitas+" estadías"),el("span","hu-destacado",roles[v?.rol]||""))),
            edit&&btn(p.foto?"Cambiar foto":"Agregar foto",()=>editPhoto({kind:"persona",path:p.foto}),{glyph:"camera",iconOnly:true}));
        const visits=v&&box("hu-contexto",box("hu-linea",muted(v.hospedada?"ESTADÍA ACTUAL":"ESTADÍA"),
            btn("Ver reserva",e=>window.HAIKU_RESUMEN_RESERVA_SITES_V1?.abrirPorId(v.reserva_id,e.currentTarget),{cls:"hu-plano hu-link"})),
            el("strong","",cabin(v)),
            muted([dates(v),v.adultos!==null&&(v.adultos+v.ninos)+" personas",v.mascotas&&v.mascotas+" mascotas"].filter(Boolean).join(" · ")),
            muted(integrantes.filter(x=>x.rol!=="borrador").length+" identificados · "+integrantes.filter(x=>x.rol==="borrador"&&!x.excedente).length+" por identificar"),
            !v.numero&&profile.estadias.length>1&&muted("Asignación pendiente · "+profile.estadias.map(x=>x.numero&&"Cab. "+x.numero).filter(Boolean).join(", ")));
        const companions=integrantes.filter(x=>x.id!==p.id).map(x=>row(name(x),roles[x.rol]+(x.excedente?" · Fuera de la ocupación actual":""),
            btn(x.rol==="borrador"&&edit?"Completar":"Ver perfil",()=>openProfile(x.id,v.reserva_id)),null,x));
        const draft=(p.borrador||v?.plaza===0)&&box("hu-bloque",
            el("p","hu-aviso",v.excedente?(p.cupo_revisado_en?"Cupo revisado. Se conserva el borrador.":"La ocupación cambió. Este borrador conserva lo registrado."):"Por completar"),
            edit&&box("hu-chips",btn("Completar datos",editDraft,{primary:true}),btn("Vincular perfil existente",linkDraft),v.excedente&&!p.cupo_revisado_en&&btn("Marcar cupo revisado",()=>formDialog("Revisar cupo",[muted("Se conservará el borrador en el directorio.")],()=>save("revisar_cupo",{})))));
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
        const content=[
            btn("Huéspedes",back,{cls:"hu-movil hu-plano hu-icono-boton",glyph:"back"}),header,
            box("hu-linea",muted(p.numero_documento?(p.tipo_documento==="rut"?"RUT ":"Documento ")+"••••"+p.numero_documento.slice(-4):"Sin documento"),
                muted([p.nacionalidad,p.idioma].filter(Boolean).join(" · "))),visits,draft,
            companions.length&&group((v.rol==="titular"?"Acompañantes":"Integrantes de la reserva")+" · "+companions.length,null,...companions),
            group("Perfil y etiquetas",edit&&btn("Editar",editTags,buttonOptions),tags,p.descripcion&&muted(p.descripcion)),
            group("Para atenderle mejor",edit&&btn("Agregar",()=>editRecord({categoria:"preferencia"}),buttonOptions),...registros.filter(x=>!x.reserva_id).map(recordRow)),
            v&&group("Durante esta estadía",edit&&btn("Registrar",()=>editRecord({categoria:"actividad"}),buttonOptions),...local.filter(x=>x.categoria!=="vestimenta").map(recordRow)),
            v&&group("Vestimenta",edit&&btn("Registrar",()=>editRecord({categoria:"vestimenta"}),buttonOptions),...local.filter(x=>x.categoria==="vestimenta").map(recordRow)),
            v&&group("Vehículos",edit&&btn("Agregar",()=>editEntity("vehiculo"),buttonOptions),...profile.vehiculos.map(x=>row(x.modelo||x.tipo,x.color,btn("Ver perfil",()=>editEntity("vehiculo",x)),"vehicle"))),
            group("Mascotas",edit&&btn("Agregar",()=>editEntity("mascota"),buttonOptions),...profile.mascotas.map(x=>row(x.nombre,
                [x.especie,x.tamano,x.presente?"En la estadía":""].filter(Boolean).join(" · "),btn("Ver perfil",()=>editEntity("mascota",x)),"pet"))),
            accordion("Datos base",baseOpen,open=>{baseOpen=open;},box("",base,edit&&btn("Editar contacto e idioma",editBase))),
            accordion("Historial de estadías · "+profile.visitas,historyOpen,history,box("hu-bloque")),
            save,edit&&btn("Registrar información",()=>editRecord({}),{primary:true,cls:"hu-ancho"})];
        detail.replaceChildren(...content.filter(Boolean));
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
    function formDialog(title,fields,save,label="Guardar") {
        const status=el("div","hu-resultado");
        status.setAttribute("role","status");
        const closer=btn("Cerrar",()=>dialog.close(),{glyph:"close",iconOnly:true});
        const confirm=el("button","hu-boton",label);
        confirm.dataset.primario="";
        confirm.type="submit";
        const form=el("form","hu-formulario",box("hu-linea",el("h3","",title),closer),...fields,status,
            el("footer","",btn("Volver",()=>dialog.close()),save&&confirm));
        form.onsubmit=async event=>{
            event.preventDefault();
            if(!save||confirm.disabled) return;
            closer.disabled=confirm.disabled=true;
            status.textContent="Guardando…";
            const values=Object.fromEntries(new FormData(form));
            for(const input of form.querySelectorAll('[type="checkbox"]')) values[input.name]=input.checked;
            try { await save(values,form); } catch(error) {status.textContent=errorText(error);}
            finally {closer.disabled=confirm.disabled=false;}
        };
        dialog.replaceChildren(form);
        if(!dialog.open) dialog.showModal();
        return form;
    }
    function write(action,payload,ctx=selected) {
        return api.rpc("guardar",{p_id:ctx?.id??null,p_reserva:ctx?.res??null,p_accion:action,p_datos:payload});
    }
    async function refresh(id,res) {
        dialog.close();
        await openProfile(id,res,id===selected?.id);
        const status=detail.querySelector("[data-save]");
        if(status&&!status.textContent) status.textContent="Guardado.";
        filtersState.p_desde=0;
        void list(true);
    }
    async function save(action,payload) {
        const {id,res}=selected;
        const ack=await write(action,payload);
        await refresh(["identificar","vincular"].includes(action)?ack.id:id,res);
    }
    function editBase() {
        const p=profile.persona;
        formDialog("Datos del huésped",[field("País","nacionalidad",p.nacionalidad),field("Idioma","idioma",p.idioma),
            field("Teléfono","telefono",p.telefono,"tel"),field("Correo","correo",p.correo,"email"),
            field("Descripción","descripcion",p.descripcion,"textarea")],v=>save("ficha",v));
    }
    function editDraft() {
        const p=profile.persona;
        const form=formDialog(name(p),[field("Nombre","nombre",p.nombre),field("Apellidos","apellido",p.apellido),
            field("Tipo de documento","tipo_documento",p.tipo_documento,[["","Sin documento"],["rut","RUT"],["pasaporte","Pasaporte"],["otro","Otro"]]),
            field("Número de documento","numero_documento",p.numero_documento),field("Cómo reconocerlo hoy","descripcion",p.descripcion,"textarea"),
            field("Información y gustos","texto","","textarea")],async(values,form)=>{
            if(!values.nombre.trim()&&values.numero_documento.trim()) throw new Error("Ingresa el nombre para completar la identificación.");
            await write("ficha",{descripcion:values.descripcion});
            if(values.texto.trim()) await write("registro",{id:form.dataset.note,categoria:"preferencia",texto:values.texto,fuente:"Observación"});
            if(values.nombre.trim()) await save("identificar",values);
            else await refresh(selected.id,selected.res);
        },"Guardar");
        form.dataset.note=crypto.randomUUID();
    }


    function linkDraft() {
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
                    const rows=found.filas.filter(p=>!p.borrador&&p.plaza==null).map(p=>row(name(p),p.documento,
                        btn("Vincular",()=>formDialog("Vincular a "+name(p),[muted("Se conservará la información del borrador.")],
                            ()=>save("vincular",{huesped_id:p.id}),"Vincular"))));
                    listBox.replaceChildren(...(rows.length?rows:[muted("Sin coincidencias.")]));
                }catch(error){if(call===turn) listBox.replaceChildren(muted(errorText(error)));}
            },230);
        };
    }
    function editTags() {
        const picked=new Set(profile.etiquetas.map(x=>x.id));
        const sections=groups.map(group=>{
            const options=(data?.etiquetas||[]).filter(x=>x.grupo===group).map(e=>{
                const input=el("input","");
                input.type="checkbox";
                input.checked=picked.has(e.id);
                input.onchange=()=>input.checked?picked.add(e.id):picked.delete(e.id);
                return el("label","hu-mini",input,e.nombre);
            });
            return el("fieldset","",el("legend","",group),box("hu-chips",...options));
        });
        formDialog("Etiquetas del huésped",[...sections,btn("Nueva etiqueta",addTag)],()=>save("etiquetas",{ids:[...picked]}));
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
        const cat=field("Tipo de información","categoria",record.categoria||"preferencia",kinds);
        const scope=field("Solo en esta estadía","solo_estadia",record.reserva_id,"checkbox");
        const upper=field("Prenda superior","superior",record.superior);
        const lower=field("Prenda inferior","inferior",record.inferior);
        const words=field("Información o detalles","texto",record.texto,"textarea");
        const sources=["Observación","Lo comentó","Confirmado por huésped"];
        const form=formDialog(record.id?"Editar información":"Registrar información",[
            cat,scope,upper,lower,words,field("Fuente","fuente",record.fuente||sources[0],sources.map(s=>[s,s]))
        ],(values,f)=>save("registro",{...values,id:record.id||f.dataset.id,
            ...(record.modificado_en?{version:record.modificado_en}:{})}));
        form.dataset.id=crypto.randomUUID();
        const type=cat.querySelector("select");
        function adjust(){
            scope.hidden=!hasStay||type.value!=="nota";
            if(scope.hidden) scope.querySelector("input").checked=false;
            upper.hidden=lower.hidden=type.value!=="vestimenta";
            words.querySelector("textarea").required=type.value!=="vestimenta";
        }
        type.onchange=adjust;adjust();
    }
    function editEntity(kind,item={}) {
        const vehicle=kind==="vehiculo", edit=profile.puede_editar;
        const entries=vehicle?[["Tipo","tipo",true],["Marca / modelo","modelo"],["Color","color"],["Patente","patente"]]
            :[["Nombre","nombre",true],["Especie","especie",true],["Raza","raza"],["Tamaño","tamano"],["Color","color"],["Cuidados","cuidados"]];
        const fields=entries.map(([label,key,needed])=>field(label,key,item[key],key==="cuidados"?"textarea":"text",needed));
        if(!vehicle&&profile.visita) fields.push(field("Presente en esta estadía","presente",item.presente,"checkbox"));
        const media=box("hu-bloque");
        if(item.foto) api.signed(item.foto).then(src=>{
            if(!media.isConnected) return;
            const img=el("img","hu-foto-previa");img.alt=vehicle?"Foto del vehículo":"Foto de la mascota";img.src=src;media.prepend(img);
        }).catch(error=>media.prepend(muted(errorText(error))));
        if(item.id&&edit) media.append(btn(item.foto?"Cambiar foto":"Agregar foto",()=>editPhoto({kind,id:item.id,path:item.foto}),{glyph:"camera",cls:"hu-icono-boton"}));
        const form=formDialog(vehicle?"Vehículo de la estadía":"Perfil de la mascota",[media,...fields],edit
            ? (v,f)=>save(kind,{...v,id:item.id||f.dataset.id}) : null);
        form.dataset.id=crypto.randomUUID();
        if(!edit) form.querySelectorAll("input,select,textarea").forEach(x=>{x.disabled=true;});
    }
    function editPhoto(target) {
        const p=profile, ctx=selected;
        const picker=field("Elegir imagen","imagen",null,"file",true);
        const input=picker.querySelector("input");
        input.accept="image/*";
        const canvas=el("canvas","hu-foto-previa");canvas.width=canvas.height=800;canvas.hidden=true;
        let picture, angle=0;
        const controls=[["Acercar","zoom",1,3,.05,1],["Ajustar horizontal","dx",-100,100,1,0],["Ajustar vertical","dy",-100,100,1,0]]
            .map(([label,key,min,max,step,value])=>{
                const control=field(label,key,value,"range");
                const range=control.querySelector("input");
                Object.assign(range,{min,max,step,value});
                range.oninput=draw;
                return control;
            });
        const actions=box("hu-chips",btn("Girar",()=>{angle=(angle+90)%360;draw();},{glyph:"rotate",cls:"hu-icono-boton"}),
            btn("Acercar",()=>{form.elements.zoom.stepUp(5);draw();},{glyph:"zoom",cls:"hu-icono-boton"}));
        if(target.path) actions.append(btn("Eliminar foto",()=>formDialog("Eliminar foto",[muted("Confirma el retiro de la foto de esta ficha.")],async()=>{
            await api.photo(p,target,null);await refresh(ctx.id,ctx.res);
        },"Eliminar")));
        const state=el("span","hu-muted");state.setAttribute("role","status");
        const form=formDialog("Foto · Vista previa",[canvas,picker,state,...controls,actions],async()=>{
            if(!picture) throw new Error("Selecciona una imagen válida.");
            const image=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("No se pudo preparar la imagen.")),"image/jpeg",.85));
            await api.photo(p,target,image);await refresh(ctx.id,ctx.res);
        },"Usar foto");
        input.onchange=()=>{
            picture=null;canvas.hidden=true;
            const file=input.files[0];
            if(!file) return;
            const url=URL.createObjectURL(file);
            const img=new Image();
            img.onload=()=>{
                URL.revokeObjectURL(url);
                if(input.files[0]!==file) return;
                picture=img;angle=0;state.textContent="";draw();
            };
            img.onerror=()=>{URL.revokeObjectURL(url);state.textContent="No se pudo leer esta imagen.";};
            img.src=url;
        };
        function draw(){
            if(!picture) return;
            const ctx2d=canvas.getContext("2d"), size=canvas.width;
            const scale=size*Number(form.elements.zoom.value)/Math.min(picture.naturalWidth,picture.naturalHeight);
            const w=picture.naturalWidth*scale,h=picture.naturalHeight*scale;
            const [cw,ch]=angle%180?[h,w]:[w,h];
            const dx=(cw-size)/2*Number(form.elements.dx.value)/100,dy=(ch-size)/2*Number(form.elements.dy.value)/100;
            ctx2d.setTransform(1,0,0,1,0,0);ctx2d.fillStyle="#fff";ctx2d.fillRect(0,0,size,size);
            ctx2d.translate(size/2+dx,size/2+dy);ctx2d.rotate(angle*Math.PI/180);
            ctx2d.drawImage(picture,-w/2,-h/2,w,h);
            canvas.hidden=false;
        }
    }
    const searchIcon=root.querySelector("[data-hu-search-icon]");
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
