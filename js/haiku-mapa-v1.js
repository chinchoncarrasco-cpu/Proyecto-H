(() => {
    "use strict";
    const section = document.getElementById("seccion-mapa");
    const menu = document.querySelector('.menu-item[data-seccion="mapa"]');
    const empty = section?.querySelector(".haiku-mapa-aviso");
    const container = section?.querySelector(".haiku-mapa-viewport");
    const client = window.haikuSupabase;
    if (!container || !menu || !client) return;

    const channel = "haiku:mapa:v1";
    const rpc = Object.freeze({
        snapshot: "haiku_mapa_dia_v1",
        save: "haiku_mapa_guardar_v1",
        guest: "haiku_huesped_guardar_v1",
        profile: "haiku_mapa_huesped_v1",
        service: "haiku_registrar_servicio",
    });
    const identity = () => window.haikuSesion?.auth?.id;
    const allowed = () => Boolean(identity() && window.haikuTienePermiso?.("cabanas.ver"));
    const isPrivate = () => document.documentElement.classList.contains("haiku-privacidad-bloqueada");
    const isOpen = () => Boolean(section.getClientRects().length && !document.hidden);
    const theme = () => document.documentElement.dataset.haikuTema === "oscuro" ? "dark" : "light";
    const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
    let frame = null, user = null, ready = false;

    function post(message) {
        frame?.contentWindow?.postMessage({channel, ...message}, "*");
    }

    function sync() {
        menu.hidden = !allowed();
        if (!allowed() || isPrivate() || identity() !== user) {
            frame?.remove();
            frame = null;
            ready = false;
            user = null;
            empty.hidden = false;
        }
        if (!allowed() || isPrivate() || !isOpen() || frame) return;
        frame = document.createElement("iframe");
        frame.title = "Mapa interactivo del recinto";
        frame.setAttribute("data-haiku-mapa-interno", "");
        frame.setAttribute("sandbox", "allow-scripts allow-forms");
        frame.referrerPolicy = "no-referrer";
        frame.src = "assets/mapa/recinto.html?v=1";
        container.append(frame);
        empty.hidden = true;
        user = identity();
    }

    function refresh() {
        if (ready && allowed() && !isPrivate() && isOpen()) post({type:"refresh"});
    }

    function navigate(method, args) {
        if (method === "guest" && uuid(args.id) && uuid(args.reserva)) {
            if (window.haikuTienePermiso?.("huespedes.ver")) {
                window.HAIKU_HUESPEDES_MAPA_V1?.abrir(args.id, args.reserva, args.estadia);
            }
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
            ready = true;
            post({type:"init", theme:theme()});
            return;
        }
        if (msg.type === "navigate" && msg.args && typeof msg.args === "object" && isOpen()) {
            navigate(msg.method, msg.args);
            return;
        }
        if (msg.type !== "request" || !Number.isSafeInteger(msg.id) || !Object.hasOwn(rpc,msg.method)
            || !msg.args || typeof msg.args !== "object" || !isOpen()) return;
        let result;
        try {
            result = await client.rpc(rpc[msg.method], msg.args);
        } catch {
            result = {error:{message:"Revisa la conexión con Haku e inténtalo nuevamente."}};
        }
        if (source !== frame || user !== identity() || !allowed() || isPrivate()) return;
        const {data,error} = result;
        post({type:"reply",id:msg.id,data,error:error ? {message:error.message,code:error.code} : null});
        if (!error && msg.method === "service") {
            document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {detail:{fecha:msg.args.p_fecha_servicio}}));
        }
    });

    menu.addEventListener("click", () => { sync(); refresh(); });
    window.addEventListener("haiku:auth-ready", sync);
    window.addEventListener("haiku:privacidad-cambio", sync);
    client.auth.onAuthStateChange(event => {
        if (event !== "SIGNED_OUT") return;
        frame?.remove();
        frame = null;
        user = null;
        ready = false;
        menu.hidden = true;
        empty.hidden = false;
    });
    const observer = new MutationObserver(() => { sync(); refresh(); });
    observer.observe(section, {attributes:true,attributeFilter:["class","hidden"]});
    new MutationObserver(() => {
        if (ready) post({type:"theme", theme:theme()});
    }).observe(document.documentElement,{attributes:true,attributeFilter:["data-haiku-tema"]});
    document.addEventListener("visibilitychange", () => { sync(); refresh(); });
    document.addEventListener("haiku:resumen-datos-actualizados", refresh);
    window.setInterval(refresh, 45000);
    sync();
})();
