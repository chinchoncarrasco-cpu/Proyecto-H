(() => {
    "use strict";
    const section = document.getElementById("seccion-mapa");
    const menu = document.querySelector('.menu-item[data-seccion="mapa"]');
    const empty = section?.querySelector(".haiku-mapa-aviso");
    const container = section?.querySelector(".haiku-mapa-viewport");
    const client = window.haikuSupabase;
    if (!container || !menu || !client) return;
    const root = document.documentElement;

    const channel = "haiku:mapa:v1";
    const rpc = Object.freeze({
        snapshot: "haiku_mapa_dia_v1",
        save: "haiku_mapa_guardar_v1",
        guest: "haiku_huesped_guardar_v1",
        profile: "haiku_mapa_huesped_v1",
        guestDetail: "haiku_huesped_perfil_v1",
        guestSearch: "haiku_huesped_directorio_v1",
        cleaning: "haiku_mapa_aseo_v1",
        service: "haiku_registrar_servicio",
        reservationState: "haiku_mapa_reservas_cabana_v1",
        reservationChange: "haiku_cambiar_estado_reserva_manual_v1",
    });
    const identity = () => window.haikuSesion?.auth?.id;
    const allowed = () => Boolean(identity() && window.haikuTienePermiso?.("cabanas.ver"));
    const isPrivate = () => root.classList.contains("haiku-privacidad-bloqueada")
        || root.classList.contains("haiku-privacidad-arranque");
    const isOpen = () => !document.hidden && section.getClientRects().length > 0;
    const theme = () => root.dataset.haikuTema === "oscuro" ? "dark" : "light";
    const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
    const guestMethods = new Set(["guestTags","guestSigned","guestPhoto","guestVehiclePhotos"]);
    const canReadGuest = () => window.haikuTienePermiso?.("huespedes.ver");
    let frame = null, user = null, ready = false, initialSnapshot = null;

    function post(message) {
        frame?.contentWindow?.postMessage({channel, ...message}, "*");
    }

    function clearFrame() {
        frame?.remove();
        frame = null;
        ready = false;
        user = null;
        initialSnapshot = null;
        empty.hidden = false;
    }

    async function query(method, args) {
        try {
            return await client.rpc(rpc[method], args);
        } catch {
            return {error:{message:"Revisa la conexión con Haku e inténtalo nuevamente."}};
        }
    }

    function photoPath(value) {
        if (typeof value !== "string" || !value.endsWith(".jpg")) return false;
        const parts = value.slice(0,-4).split("/");
        return parts.length === 2 && parts.every(uuid);
    }

    function readPhoto(value) {
        if (value === null || photoPath(value)) return value;
        const jpeg = value?.jpeg;
        if (typeof jpeg !== "string" || !jpeg.startsWith("/9j/") || jpeg.length > Math.ceil(5242880 / 3) * 4) {
            throw new Error("La foto no tiene un formato válido.");
        }
        const bytes = Uint8Array.from(atob(jpeg), character => character.charCodeAt(0));
        return new Blob([bytes], {type:"image/jpeg"});
    }

    async function guestQuery(method, args) {
        try {
            if (method === "guestTags") return await client.from("haiku_huesped_etiquetas").select("id,grupo,nombre").order("nombre");
            const api = window.HAIKU_HUESPEDES_API;
            if (!api) throw new Error("La ficha se está iniciando. Vuelve a intentar.");
            if (method === "guestSigned" && photoPath(args.path)) return {data:await api.signed(args.path)};
            if (method === "guestPhoto" && uuid(args.id) && (args.reserva === null || uuid(args.reserva))
                && ["persona","mascota"].includes(args.target?.kind)
                && (args.target.kind === "persona" || uuid(args.target.id))) {
                const image = readPhoto(args.image);
                if (typeof image === "string") throw new Error("La foto no tiene un formato válido.");
                return {data:await api.photo({persona:{id:args.id},visita:{reserva_id:args.reserva}}, args.target, image)};
            }
            if (method === "guestVehiclePhotos" && args.args?.p_accion === "vehiculo" && uuid(args.args.p_id)
                && uuid(args.args.p_reserva) && Array.isArray(args.additional)) {
                const save = fotos => api.rpc("guardar", {...args.args,p_datos:{...args.args.p_datos,fotos}});
                return {data:await api.vehiclePhotos(save, {
                    primary:readPhoto(args.primary), additional:args.additional.map(readPhoto),
                    positionY:args.positionY, expected:args.expected,
                })};
            }
            throw new Error("La solicitud de la ficha no tiene un formato válido.");
        } catch (error) {
            return {error:{message:error.message || "No se pudo completar el cambio.",code:error.code}};
        }
    }

    function sync() {
        const permitted = allowed(), unlocked = !isPrivate(), open = isOpen();
        menu.hidden = !permitted;
        if (frame && (!permitted || !unlocked || identity() !== user || (!ready && !open))) clearFrame();
        if (!permitted || !unlocked || !open || frame) return;
        frame = document.createElement("iframe");
        frame.title = "Mapa interactivo del recinto";
        frame.setAttribute("data-haiku-mapa-interno", "");
        frame.setAttribute("sandbox", "allow-scripts allow-forms");
        frame.referrerPolicy = "no-referrer";
        frame.src = "assets/mapa/recinto.html?v=11";
        user = identity();
        // Read today's map while the sandboxed document loads.
        initialSnapshot = query("snapshot", {});
        container.append(frame);
        empty.hidden = true;
    }

    function refresh() {
        if (ready && allowed() && !isPrivate() && isOpen()) post({type:"refresh"});
    }

    function navigate(method, args) {
        if (method === "guest" && uuid(args.id) && uuid(args.reserva)) {
            if (canReadGuest()) {
                window.HAIKU_HUESPEDES_MAPA_V1?.abrir(args.id, args.reserva, args.estadia);
            }
        } else if (method === "reservation" && uuid(args.id) && canReadGuest()) {
            window.HAIKU_RESUMEN_RESERVA_SITES_V1?.abrirPorId(args.id, frame);
        } else if (method === "cleaning" && Number.isInteger(args.number) && args.number >= 1 && args.number <= 11
            && typeof args.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.fecha)) {
            if (typeof fechaSeleccionada !== "undefined" && fechaSeleccionada !== args.fecha) {
                fechaSeleccionada = args.fecha;
                window.HAIKU_CONTEXTO_FECHAS_V1?.guardarFechaActual();
            }
            document.querySelector('.menu-item[data-seccion="cabanas"]')?.click();
            window.HAIKU_CABANAS_SITES_V1?.abrir(args.number, "operation");
        }
    }

    window.addEventListener("message", async event => {
        const msg = event.data, source = frame;
        if (!source || event.source !== source.contentWindow || event.origin !== "null"
            || msg?.channel !== channel || user !== identity() || !allowed() || isPrivate()) return;
        if (msg.type === "focus-lost") {
            window.HAIKU_PRIVACIDAD?.verificarFocoMapa?.();
            return;
        }
        if (msg.type === "ready") {
            if (!isOpen()) { clearFrame(); return; }
            ready = true;
            post({type:"init", theme:theme()});
            return;
        }
        if (msg.type === "navigate" && msg.args && typeof msg.args === "object" && isOpen()) {
            navigate(msg.method, msg.args);
            return;
        }
        const guestMethod = guestMethods.has(msg.method);
        if (msg.type !== "request" || !Number.isSafeInteger(msg.id) || (!Object.hasOwn(rpc,msg.method) && !guestMethod)
            || !msg.args || typeof msg.args !== "object" || !isOpen()) return;
        if ((guestMethod || ["guestDetail","guestSearch"].includes(msg.method)) && !canReadGuest()) {
            post({type:"reply",id:msg.id,error:{message:"Esta ficha requiere permiso para ver Huéspedes.",code:"42501"}});
            return;
        }
        if (["reservationState","reservationChange"].includes(msg.method) && !window.haikuTienePermiso?.("reservas.ver")) {
            post({type:"reply",id:msg.id,error:{message:"Esta ficha requiere permiso para ver Reservas.",code:"42501"}});
            return;
        }
        const first = msg.method === "snapshot" ? initialSnapshot : null;
        if (first) initialSnapshot = null;
        const result = await (first || (guestMethod ? guestQuery(msg.method, msg.args) : query(msg.method, msg.args)));
        if (source !== frame || user !== identity() || !allowed() || isPrivate()) return;
        const {data,error} = result;
        post({type:"reply",id:msg.id,data,error:error ? {message:error.message,code:error.code} : null});
        const fecha = msg.method === "service" ? msg.args.p_fecha_servicio
            : msg.method === "cleaning" && msg.args.p_cambios ? msg.args.p_fecha : null;
        if (!error && fecha) {
            document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {detail:{fecha}}));
        }
        if (!error && data?.ok && msg.method === "reservationChange") {
            void window.HAIKU_RESUMEN_RESERVA_SITES_V1?.refrescarTrasEstado?.();
        }
    });

    menu.addEventListener("click", () => { sync(); refresh(); });
    window.addEventListener("haiku:auth-ready", sync);
    window.addEventListener("haiku:privacidad-cambio", sync);
    client.auth.onAuthStateChange(event => {
        if (event !== "SIGNED_OUT") return;
        clearFrame();
        menu.hidden = true;
    });
    if (root.classList.contains("haiku-privacidad-arranque")) {
        const startup = new MutationObserver(() => {
            if (root.classList.contains("haiku-privacidad-arranque")) return;
            startup.disconnect();
            sync();
        });
        startup.observe(root, {attributes:true, attributeFilter:["class"]});
    }
    const observer = new MutationObserver(() => { sync(); refresh(); });
    observer.observe(section, {attributes:true,attributeFilter:["class","hidden"]});
    new MutationObserver(() => {
        if (ready) post({type:"theme", theme:theme()});
    }).observe(root,{attributes:true,attributeFilter:["data-haiku-tema"]});
    document.addEventListener("visibilitychange", () => { sync(); refresh(); });
    document.addEventListener("haiku:resumen-datos-actualizados", refresh);
    window.setInterval(refresh, 45000);
    sync();
})();
