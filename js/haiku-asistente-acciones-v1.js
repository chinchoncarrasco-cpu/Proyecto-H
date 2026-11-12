// Comandos que abren las herramientas de Proyecto H con la identidad y los datos comprobados.
(function (root) {
    "use strict";

    const L = root.HAIKU_ASISTENTE_LENGUAJE_V1 ||
        (typeof module !== "undefined" && module.exports ? require("./haiku-asistente-lenguaje-v1.js") : null);
    if (!L || root.HAIKU_ASISTENTE_ACCIONES_V1) return;

    const servicios = [
        {palabra:/\b(?:tinaja[s]?|tonel|jacuzzi)\b/,nombre:"Tinaja",tipo:"tinaja"},
        {palabra:/\bmasaje[s]?\b/,nombre:"Masaje",tipo:"masaje"},
        {palabra:/\blate\s*(?:check[\s-]*)?out\b/,nombre:"Late Check-out",codigo:"lateCheckout"},
        {palabra:/\bearly\s*(?:check[\s-]*)?in\b/,nombre:"Early Check-In",codigo:"earlyCheckin"},
        {palabra:/\bcarbon\b/,nombre:"Carga de carbón",codigo:"carbon"},
        {palabra:/\blena\b/,nombre:"Carga de leña",codigo:"lena"},
        {palabra:/\bpan(?:\s+de)?\s+masa\s+madre\b/,nombre:"Pan masa madre",codigo:"panMasaMadre"},
        {palabra:/\bhuevos?\b/,nombre:"Huevo",codigo:"huevo"},
        {palabra:/\bqueque\s+entero\b/,nombre:"Queque entero",codigo:"quequeEntero"},
        {palabra:/\btrozo\s+(?:de\s+)?queque\b/,nombre:"Trozo de queque",codigo:"trozoQueque"},
        {palabra:/\batencion\s+especial\b/,nombre:"Atención especial",codigo:"atencionEspecial"}
    ];

    function horaServicio(texto) {
        const t=L.normalizar(texto);
        const horas=[...t.matchAll(/\b(?:a\s+las?|las|hora)\s+(\d{1,2})(?:\s*[:.h,]\s*(\d{2})|\s+(\d{2})\b)?(?![\d.:h])\s*(am|pm)?\b|(?<![\d.$])\b(\d{1,2})[:.h](\d{2})(?![\d.])\s*(am|pm)?\b/g)];
        if (horas.length > 1) return {error:"Indica una sola hora para el servicio."};
        if (!horas.length) {
            if (/\b(?:a\s+las?|hora)\s+\d{1,2}[:.h,]\d+\b/.test(t)) return {error:"Revisa la hora. Ejemplo: 20:45."};
            return {hora:""};
        }
        const m=horas[0], hora=Number(m[1] || m[5]), minutos=Number(m[2] || m[3] || m[6] || 0), periodo=m[4] || m[7];
        if (hora>23 || minutos>59 || periodo && (hora<1 || hora>12)) return {error:"Revisa la hora. Ejemplo: 20:45."};
        const hh=periodo ? hora%12+(periodo==="pm"?12:0) : hora;
        return {hora:String(hh).padStart(2,"0")+":"+String(minutos).padStart(2,"0")};
    }

    function detalleServicio(producto,t) {
        if (producto?.tipo === "tinaja") {
            const tonel = /\b(?:tonel|madera)\b/.test(t), jacuzzi = /\bjacuzzi\b/.test(t);
            if (tonel && jacuzzi) return {error:"Elige una tinaja, Tónel o Jacuzzi."};
            if (tonel) return {nombre:"Tinaja Tónel de Madera",codigo:"tinajaTonel"};
            if (jacuzzi) return {nombre:"Tinaja Jacuzzi",codigo:"tinajaJacuzzi"};
        }
        if (producto?.tipo === "masaje") {
            const minutos = t.match(/\b(30|60)\s*(?:min(?:utos?)?)\b/)?.[1];
            const terapeutico = /\bterapeutico\b/.test(t), descontracturante = /\bdescontracturante\b/.test(t);
            if (terapeutico && descontracturante) return {error:"Indica un solo tipo de masaje."};
            if (minutos && (terapeutico || descontracturante)) {
                return {nombre:"Masaje " + (terapeutico ? "Terapéutico" : "Descontracturante") + " " + minutos + " min",
                    codigo:"masaje" + (terapeutico ? "Terapeutico" : "Descontracturante") + minutos};
            }
        }
        return {nombre:producto?.nombre || "Servicio",codigo:producto?.codigo || ""};
    }

    function interpretarServicio(texto,{diaActual=L.hoy()}={}) {
        const {verbo,resto}=L.orden(texto,true);
        if (!["ingresa","registra","agrega","anota","agenda","reserva","crea"].includes(verbo)) return null;
        const solicitud=L.corregirEntidadInicial(resto.split(/\b(?:motivo|observaciones?)\s*:/i)[0]), t=L.normalizar(solicitud);
        const primero=t.replace(/^(?:(?:el|la|un|una|este|esta|nuevo|nueva|\d+)\s+)+/,"");
        if (/\b(?:realizad[oa]s?|completad[oa]s?|ya se (?:hizo|realizo)|libro)\b/.test(t)) return null;
        const dominio = /^servicios?\b/.test(primero) || servicios.some(p=>primero.match(p.palabra)?.index===0);
        if (!dominio) return null;
        const coincidencias=servicios.filter(p=>p.palabra.test(t));
        if (coincidencias.length>1) return {error:"Prepara un servicio por solicitud. Indica cuál quieres agendar primero."};
        const producto=detalleServicio(coincidencias[0],t);
        if (producto.error) return producto;
        const f=L.extraerFecha(solicitud,diaActual);
        if (f.error) return f;
        const cab=L.extraerCabana(f.resto);
        if (cab.error || !cab.cabana) return {error:cab.error || "Indica en qué cabaña quieres agendar el servicio."};
        const h=horaServicio(cab.resto);
        if (h.error) return h;
        const cantidad=t.match(/\b(\d+)\s+(?:horas?|masajes?|cargas?|unidades?)\b/)?.[1];
        const personas=t.match(/\b(\d+)\s*(?:personas?|pers|pax)\b/)?.[1];
        if ([cantidad,personas].some(n=>n!=null && (!Number.isSafeInteger(Number(n)) || Number(n)<1)))
            return {error:"Indica una cantidad o un número de personas válido."};
        const etiquetaTitular=cab.resto.match(/\b(?:a nombre de|titular)\s*[:·]?\s+(.+?)(?=\s+(?:a\s+las?|las\s+\d|hora|para\s+\d|cortesia|cortesía|motivo)\b|[,;]|$)/i);
        const titular=etiquetaTitular ? L.limpiarTitular(etiquetaTitular[1]) : null;
        if (titular && !L.nombreValido(titular)) return {error:"Escribe el titular después de «a nombre de»."};
        const motivo=resto.match(/\bmotivo\s*:\s*(.+?)(?=\s+\bobservaciones?\s*:|$)/i)?.[1] || "";
        const observaciones=resto.match(/\bobservaciones?\s*:\s*(.+?)(?=\s+\bmotivo\s*:|$)/i)?.[1] || "";
        return {...producto,titular,cabana:cab.cabana,fecha:f.fecha || diaActual,hora:h.hora,cantidad:Number(cantidad || 0),personas:Number(personas || 0),
            cortesia:/\bcortesia\b/.test(t),motivo,observaciones};
    }

    function interpretarFicha(texto,{diaActual=L.hoy()}={}) {
        const {verbo,resto}=L.orden(texto);
        const consulta=["abre","busca","ver","muestra"].includes(verbo);
        const editar=["edita","modifica","cambia","cancela","reactiva"].includes(verbo);
        if (!consulta && !editar) return null;
        const contenido=L.corregirEntidadInicial(resto);
        const directo=contenido.match(/^(?:(?:la|esta|una)\s+)?(?:reserva|ficha)(?:\s+|$)([\s\S]*)$/i);
        const campo=editar && contenido.match(/^(?:(?:la|el|los|las)\s+)?(?:fecha|cabaña|cabana|titular|correo|tel[eé]fono|contacto|ocupaci[oó]n)\s+de\s+(?:la\s+)?reserva\s+(.+)$/i);
        const objeto=directo || campo;
        if (!objeto) return null;
        const m=objeto[1].match(/\bH-\d{8}-\d{2}-[a-z0-9]+\b/i)?.[0];
        const codigo=m?.toUpperCase() || null;
        const f=L.extraerFecha(m ? objeto[1].replace(m,"") : objeto[1],diaActual);
        if (f.error) return f;
        const cab=L.extraerCabana(f.resto);
        if (cab.error) return cab;
        const titular=L.limpiarTitular(cab.resto);
        if (titular && !L.nombreValido(titular)) return {error:"Indica el titular y la fecha de la reserva que quieres abrir."};
        if (!titular && !cab.cabana && !codigo) return {error:"Indica el titular, la cabaña y el día, o el código de reserva."};
        return {editar,accion:verbo,titular:titular || null,cabana:cab.cabana,codigo,modoFecha:f.modoFecha,
            fecha:f.fecha || (!titular && cab.cabana ? diaActual : null)};
    }

    const camposFicha="id,reserva_id,fecha_ingreso,fecha_salida,estado_estadia,cabanas!inner(numero),reservas!inner(id,codigo_haiku,titular_nombre,estado_reserva)";
    async function buscarFichas(q,cliente=root.haikuSupabase) {
        if (!cliente || root.haikuTienePermiso?.("reservas.ver") !== true) throw new Error("Tu cuenta necesita permiso para ver reservas.");
        const filas=[];
        for (let inicio=0;;inicio+=250) {
            let consulta=cliente.from("reserva_estadias").select(camposFicha).order("id");
            if (q.cabana) consulta=consulta.eq("cabanas.numero",q.cabana);
            if (q.codigo) consulta=consulta.eq("reservas.codigo_haiku",q.codigo);
            if (q.fecha) consulta=consulta.lte("fecha_ingreso",q.fecha).gte("fecha_salida",q.fecha);
            const {data,error}=await consulta.range(inicio,inicio+249);
            if (error) throw error;
            filas.push(...data || []);
            if (!data || data.length<250) break;
        }
        const candidatas=filas.filter(f=>f.id && f.reserva_id && f.reservas?.id===f.reserva_id && Number(f.cabanas?.numero)>0 &&
            (!q.cabana || Number(f.cabanas.numero)===q.cabana) && (!q.codigo || f.reservas.codigo_haiku===q.codigo) &&
            L.coincideFecha(f,q.fecha,q.modoFecha));
        if (!q.titular) return candidatas;
        const exactas=candidatas.filter(f=>L.coincideNombre(f.reservas.titular_nombre,q.titular));
        return exactas.length || !(q.cabana && q.fecha) ? exactas :
            candidatas.filter(f=>L.coincideNombre(f.reservas.titular_nombre,q.titular,true));
    }

    const doc=root.document;
    const elemento=(tag,texto,clase) => {
        const el=doc.createElement(tag);
        if (clase) el.className=clase;
        if (texto) el.textContent=texto;
        return el;
    };
    const fechaVisible=f=>String(f || "").split("-").reverse().join("/");
    function mensaje(tipo,texto) {
        const el=elemento("div",texto,"haiku-asistente-mensaje haiku-asistente-mensaje--"+tipo);
        doc.getElementById("haiku-asistente-mensajes")?.append(el);
        return el;
    }
    function prepararRespuesta(campo,texto,titulo) {
        campo.value="";
        campo.dispatchEvent(new root.Event("input",{bubbles:true}));
        mensaje("usuario",texto);
        const out=mensaje("asistente");
        const articulo=elemento("article","","haku-orden");
        articulo.append(elemento("h3",titulo));
        out.append(articulo);
        return {out,articulo};
    }
    function botonAccion(texto,accion,estado) {
        const boton=elemento("button",texto);
        boton.type="button";
        boton.addEventListener("click",async () => {
            boton.disabled=true;
            estado.textContent="";
            try { await accion(boton); }
            catch (e) { estado.textContent=e?.message || "La acción no se pudo abrir."; }
            finally { boton.disabled=false; }
        });
        return boton;
    }

    function responderServicio(q, campo, texto) {
        const {out,articulo}=prepararRespuesta(campo,texto,"Agendar servicio");
        if (q.error) articulo.append(elemento("p",q.error));
        else {
            articulo.append(elemento("strong",q.nombre+" · CAB "+q.cabana),
                elemento("p",[fechaVisible(q.fecha),q.hora,q.titular].filter(Boolean).join(" · ")));
            if (!q.codigo) articulo.append(elemento("p","Elige el servicio del catálogo en el formulario."));
            const estado=elemento("p");
            estado.setAttribute("role","status");
            const boton=botonAccion("Revisar servicio",async () => {
                const formulario=root.HAIKU_RESUMEN_SERVICIO_SITES_V1;
                if (!formulario?.abrirDesdeHaku) throw new Error("El formulario de servicios no está disponible. Recarga Proyecto H.");
                if (await formulario.abrirDesdeHaku(q)) estado.textContent="Formulario abierto. Revisa la reserva y el cobro.";
            },estado);
            articulo.append(boton,estado);
        }
        out.scrollIntoView?.({block:"nearest"});
    }

    let buscandoFicha=false;
    let preparandoOperacion=false;

    async function responderOperacion(q, campo, texto, api) {
        preparandoOperacion=!q.error;
        const {out,articulo}=prepararRespuesta(campo,texto,api.titulos[q.accion] || "Acción en Proyecto H");
        articulo.dataset.hakuOperacion="1";
        const cuerpo=elemento("div");
        const estado=elemento("p",q.error || "Comprobando en Proyecto H…");
        estado.setAttribute("role","status");
        articulo.append(cuerpo,estado);
        if (q.error) {
            out.scrollIntoView?.({block:"nearest"});
            return;
        }
        const usuario=api.usuario();
        let ejecutando=false;
        const mismaSesion=()=>Boolean(usuario && usuario===api.usuario() && articulo.isConnected);
        const seguir=async (accion, textoEspera) => {
            if (ejecutando) return;
            if (!mismaSesion()) {estado.textContent="La sesión cambió. Pide la acción de nuevo.";return;}
            ejecutando=true;
            const botones=[...cuerpo.querySelectorAll("button")];
            botones.forEach(b=>{b.disabled=true;});
            estado.textContent=textoEspera;
            try {await accion();}
            catch (error) {estado.textContent=error?.message || "No se pudo completar la acción. Revisa Proyecto H.";}
            finally {ejecutando=false;botones.forEach(b=>{b.disabled=false;});}
        };
        function mostrar(p) {
            if (!mismaSesion()) return;
            cuerpo.replaceChildren();
            estado.textContent="";
            if (p.identidad) cuerpo.append(elemento("strong",p.identidad));
            if (p.filas?.length) {
                const dl=elemento("dl","","haku-orden__datos");
                for (const [k,v] of p.filas) {
                    const fila=elemento("div");
                    fila.append(elemento("dt",k),elemento("dd",v));
                    dl.append(fila);
                }
                cuerpo.append(dl);
            }
            if (p.texto) cuerpo.append(elemento("blockquote",p.texto,"haku-orden__texto"));
            if (p.detalle) cuerpo.append(elemento("p",p.detalle));
            const acciones=elemento("div","","haku-orden__acciones");
            acciones.dataset.hakuOperacionAcciones="1";
            const boton=(etiqueta,ejecutar,principal=false)=>{
                const b=elemento("button",etiqueta,principal ? "haku-orden__principal" : "");
                b.type="button";
                b.addEventListener("click",ejecutar);
                acciones.append(b);
            };
            for (const o of p.opciones || []) {
                boton(o.etiqueta,()=>void seguir(async()=>mostrar(await o.cargar()),"Comprobando selección…"));
            }
            if (p.guardar) {
                boton(p.etiqueta,()=>void seguir(async()=>{
                    const resultado=await p.guardar();
                    acciones.remove();
                    estado.textContent=resultado;
                    estado.dataset.guardado="1";
                },"Guardando…"),true);
                boton("Descartar",()=>{
                    if (ejecutando) return;
                    acciones.remove();
                    estado.textContent="Propuesta descartada.";
                });
            }
            if (p.copiar) boton(p.etiqueta,()=>void seguir(async()=>{
                await root.navigator.clipboard.writeText(p.copiar);
                estado.textContent="Copiado.";
            },"Copiando…"));
            if (p.enlace) {
                const enlace=elemento("a",p.enlace.etiqueta,"haku-orden__principal");
                enlace.href=p.enlace.url;
                if (enlace.protocol==="https:") {
                    enlace.target="_blank";
                    enlace.rel="noopener noreferrer";
                }
                enlace.addEventListener("click",event=>{
                    if (mismaSesion()) return;
                    event.preventDefault();
                    estado.textContent="La sesión cambió. Pide la acción de nuevo.";
                });
                acciones.append(enlace);
            }
            if (acciones.childElementCount) cuerpo.append(acciones);
            out.scrollIntoView?.({block:"nearest"});
        }
        try {
            const propuesta=await api.preparar(q,buscarFichas);
            if (!mismaSesion()) throw new Error("La sesión cambió. Pide la acción de nuevo.");
            mostrar(propuesta);
        } catch (error) {
            estado.textContent=error?.message || "No se pudo comprobar la acción.";
        } finally {
            preparandoOperacion=false;
            campo.dispatchEvent(new root.Event("input",{bubbles:true}));
            out.scrollIntoView?.({block:"nearest"});
        }
    }

    async function responderFicha(q,campo,texto) {
        buscandoFicha=true;
        const {out,articulo}=prepararRespuesta(campo,texto,q.editar?"Ubicar reserva para editar":"Buscar reserva");
        const estado=elemento("p",q.error || "Buscando en Proyecto H…");
        estado.setAttribute("role","status");
        articulo.append(estado);
        try {
            if (q.error) return;
            const candidatas=await buscarFichas(q);
            if (!candidatas.length) {estado.textContent="No encontré esa reserva. Comprueba el titular, la cabaña y la fecha.";return;}
            estado.textContent=candidatas.length===1 ?
                (q.editar ? "Abre la ficha y pulsa Editar reserva o elige el estado." : "Reserva encontrada.") :
                "Encontré varias estadías. Elige la cabaña y las fechas que corresponden.";
            const lista=elemento("ul");
            for (const f of candidatas) {
                const cab=String(f.cabanas.numero);
                const titulo=[f.reservas.titular_nombre,"CAB "+cab,fechaVisible(f.fecha_ingreso)+" → "+fechaVisible(f.fecha_salida)].join(" · ");
                const li=elemento("li");
                li.append(botonAccion(titulo,async boton => {
                    const seleccion={estadiaId:f.id,numeroCabana:cab,...(q.fecha?{fecha:q.fecha}:{})};
                    const inspector=root.HAIKU_INSPECTOR_V1;
                    const abierta=inspector?.abrirReserva ? await inspector.abrirReserva(f.reserva_id,boton,seleccion) :
                        await root.HAIKU_RESUMEN_RESERVA_SITES_V1?.abrirPorId?.(f.reserva_id,boton,seleccion);
                    if (!abierta) throw new Error("No pude abrir la estadía verificada. Actualiza la consulta.");
                },estado));
                lista.append(li);
            }
            articulo.append(lista);
        } catch (e) {estado.textContent=e?.message || "No pude comprobar las reservas.";}
        finally {
            buscandoFicha=false;
            campo.dispatchEvent(new root.Event("input",{bubbles:true}));
            out.scrollIntoView?.({block:"nearest"});
        }
    }

    const esAyuda=texto=>/^(?:ayuda|ayudame|que puedes hacer|que sabes hacer|que te puedo pedir|comandos|ver ayuda)$/.test(L.normalizar(L.limpiarOrden(texto)).replace(/[¿?!.]+/g,"").trim());

    function interceptar(evento) {
        const campo=doc.getElementById("haiku-asistente-texto");
        if (!campo || evento.defaultPrevented) return;
        const clic=evento.type==="click" && evento.target?.closest?.("#haiku-asistente-enviar");
        const tecla=evento.type==="keydown" && evento.target===campo && evento.key==="Enter" && !evento.isComposing && !evento.shiftKey;
        if (!clic && !tecla || campo.disabled || root.HAIKU_ASISTENTE?.procesando?.()) return;
        const original=campo.value;
        const texto=original.trim();
        if (!texto || root.HAIKU_CLOUDBEDS_INFORMES_V1?.esSolicitud(texto) ||
            doc.querySelector("#haiku-asistente-adjuntos [data-documento]") ||
            root.HAIKU_ASISTENTE?.adjuntos?.().some(a=>a.tipo==="application/pdf")) return;
        const adjuntos=doc.getElementById("haiku-asistente-adjuntos")?.querySelector(".haiku-asistente-adjunto");
        const envio=Boolean(clic || evento.ctrlKey || evento.metaKey);
        const reclamar=()=>{evento.preventDefault();evento.stopImmediatePropagation();};
        if (envio && esAyuda(texto) && !adjuntos && root.HAIKU_ASISTENTE?.mostrarAyuda) {
            reclamar();campo.value="";campo.dispatchEvent(new root.Event("input",{bubbles:true}));root.HAIKU_ASISTENTE.mostrarAyuda();return;
        }
        const operativa=root.HAIKU_ASISTENTE_OPERACIONES_SUPABASE_V1;
        const operacion=operativa && root.HAIKU_ASISTENTE_OPERACIONES_V1?.interpretar(texto);
        if (envio && operacion) {
            reclamar();
            if (adjuntos) {mensaje("asistente","Retira los adjuntos para usar este comando con los datos del texto.");return;}
            if (!preparandoOperacion) void responderOperacion(operacion,campo,texto,operativa);
            return;
        }
        if (!envio && operacion) return;
        const servicio=interpretarServicio(texto);
        const ficha=servicio || L.interpretarTotal(texto) ? null : interpretarFicha(texto);
        if (envio && (servicio || ficha)) {
            reclamar();
            if (adjuntos) {mensaje("asistente","Retira los adjuntos para usar este comando con los datos del texto.");return;}
            if (servicio) responderServicio(servicio,campo,texto);
            else if (!buscandoFicha) void responderFicha(ficha,campo,texto);
            return;
        }
        if (!envio && (servicio || ficha)) return;
        const adaptado=L.adaptarOrden(texto);
        if (envio && !adjuntos && /^registra\s+(?:(?:este|un|el)\s+)?(?:pago|abono)\.?$/i.test(L.limpiarOrden(adaptado))) {
            reclamar();
            mensaje("asistente","Adjunta el comprobante o agrega titular, cabaña, fecha del pago, monto y medio.");
            campo.focus();
            return;
        }
        if (adaptado===texto) return;
        const inicio=campo.selectionStart,fin=campo.selectionEnd;
        campo.value=adaptado;
        // Un clic del usuario puede ejecutar microtareas entre listeners.
        // Restaurar después del evento deja que el módulo elegido lea la orden.
        root.setTimeout(()=>{
            if (campo.value!==adaptado) return;
            campo.value=original;
            if (inicio!==null && fin!==null) campo.setSelectionRange?.(inicio,fin);
        },0);
    }

    const api=Object.freeze({interpretarServicio,interpretarFicha,buscarFichas,esAyuda,
        procesando:()=>buscandoFicha || preparandoOperacion});
    root.HAIKU_ASISTENTE_ACCIONES_V1=api;
    if (typeof module!=="undefined") module.exports=api;
    if (doc) for (const tipo of ["click","keydown"]) root.addEventListener(tipo,interceptar,true);
})(typeof window!=="undefined"?window:globalThis);
