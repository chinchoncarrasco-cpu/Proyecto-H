// Estado transitorio de los checklists: Supabase sigue siendo la autoridad persistente.
(() => {
    "use strict";

    const pendientes = new Map();
    let version = 0;
    const clave = (tipo, fecha, numero, item) =>
        [tipo, fecha, String(numero), String(item)].join("::");
    const campo = tipo => tipo === "express" ? "checklistAseoExpress" : "checklist";
    const selector = tipo => tipo === "express" ? "[data-aseo-express-item]" : "[data-checklist-id]";
    const itemDe = (tipo, check) => tipo === "express"
        ? check.dataset.aseoExpressItem : check.dataset.checklistId;

    function actualizarConteos() {
        window.HAIKU_CABANAS_SITES_V1?.actualizarConteos?.();
    }

    function escribirLocal(entrada, valor) {
        if (typeof obtenerDatosDia !== "function") return;
        const cabana = obtenerDatosDia(entrada.fecha)?.cabanas?.[entrada.numero];
        if (!cabana) return;
        cabana[campo(entrada.tipo)] ||= {};
        cabana[campo(entrada.tipo)][entrada.item] = valor;
        if (typeof guardarDatos === "function") guardarDatos();
    }

    function aplicarDOM(entrada, valor) {
        const fechaVisible = typeof fechaSeleccionada !== "undefined"
            ? String(fechaSeleccionada || "").slice(0, 10) : "";
        if (fechaVisible !== entrada.fecha) return;
        const abierto = localStorage.getItem(entrada.tipo === "express"
            ? "haikuAseoExpressCabana" : "haikuRevisionCabana");
        if (String(abierto) !== entrada.numero) return;
        document.querySelectorAll(selector(entrada.tipo)).forEach(check => {
            if (itemDe(entrada.tipo, check) === entrada.item) check.checked = valor;
        });
        actualizarConteos();
    }

    function iniciar(tipo, fecha, numero, item, check) {
        const id = clave(tipo, fecha, numero, item);
        const existente = pendientes.get(id);
        if (existente) {
            check.checked = existente.nuevo;
            actualizarConteos();
            return null;
        }
        const entrada = {
            tipo, fecha, numero: String(numero), item: String(item),
            anterior: !check.checked, nuevo: check.checked
        };
        pendientes.set(id, entrada);
        version++;
        escribirLocal(entrada, entrada.nuevo);
        aplicarDOM(entrada, entrada.nuevo);
        return entrada;
    }

    function terminar(entrada, exito) {
        if (!entrada) return;
        const id = clave(entrada.tipo, entrada.fecha, entrada.numero, entrada.item);
        if (pendientes.get(id) !== entrada) return;
        pendientes.delete(id);
        version++;
        const valor = exito ? entrada.nuevo : entrada.anterior;
        escribirLocal(entrada, valor);
        aplicarDOM(entrada, valor);
    }

    function valor(tipo, fecha, numero, item, remoto) {
        return pendientes.get(clave(tipo, fecha, numero, item))?.nuevo ?? remoto;
    }

    function aplicarCache(tipo, fecha, numero, checklist) {
        const prefijo = [tipo, fecha, String(numero)].join("::") + "::";
        for (const [id, entrada] of pendientes) {
            if (id.startsWith(prefijo)) checklist[entrada.item] = entrada.nuevo;
        }
        return checklist;
    }

    function repintar() {
        for (const entrada of pendientes.values()) aplicarDOM(entrada, entrada.nuevo);
        actualizarConteos();
    }

    // La captura ocurre antes del toggle nativo y evita un segundo cambio
    // contradictorio; otros ítems permanecen interactivos.
    document.addEventListener("click", evento => {
        const check = evento.target?.closest?.("[data-checklist-id], [data-aseo-express-item]");
        if (!check) return;
        const tipo = check.matches("[data-aseo-express-item]") ? "express" : "completa";
        const numero = localStorage.getItem(tipo === "express"
            ? "haikuAseoExpressCabana" : "haikuRevisionCabana");
        const fecha = typeof fechaSeleccionada !== "undefined"
            ? String(fechaSeleccionada || "").slice(0, 10) : "";
        const pendiente = pendientes.get(clave(tipo, fecha, numero, itemDe(tipo, check)));
        if (!pendiente) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        check.checked = pendiente.nuevo;
    }, true);

    window.HAIKU_CHECKLIST_OPTIMISTA_V1 = Object.freeze({
        iniciar, terminar, valor, aplicarCache, repintar,
        version: () => version,
        pendiente: (tipo, fecha, numero, item) =>
            pendientes.has(clave(tipo, fecha, numero, item))
    });
})();
