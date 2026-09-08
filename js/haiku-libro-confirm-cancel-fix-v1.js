// HAKU · guardas seguras para importar servicios/notas del Libro
// V3: sin MutationObserver. Evita el bucle de atributos que podía congelar la página.
(function (root) {
    "use strict";
    if (!root.document || root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V3) return;

    const confirmarNativo = root.confirm.bind(root);
    let ultimoTextoServicios = "";

    function esConfirmacionLibro(texto) {
        const t = String(texto || "");
        return /^Se incorporarán\s+\d+\s+servicio(?:s)?\s+y\s+\d+\s+nota(?:s)?\s+desde el Libro\./i.test(t)
            && /operación será atómica/i.test(t);
    }

    function bloquearRevision(scope = document) {
        scope.querySelectorAll?.(
            ".haku-libro-servicios__item--revisar input[type='checkbox']," +
            ".haku-libro-servicios__item--existente input[type='checkbox']"
        ).forEach(check => {
            check.checked = false;
            check.disabled = true;
            check.setAttribute("aria-disabled", "true");
        });
    }

    function reactivarBotonLibro() {
        queueMicrotask(() => {
            document.querySelectorAll(".haku-libro-servicios__boton").forEach(boton => {
                if (!boton.isConnected) return;
                const card = boton.closest(".haku-libro-servicios");
                if (!card || /Incorporación completada/i.test(card.textContent || "")) return;
                bloquearRevision(card);
                const seleccionados = card.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)').length;
                boton.disabled = seleccionados === 0;
            });
        });
    }

    root.confirm = function (mensaje) {
        const resultado = confirmarNativo(mensaje);
        if (!resultado && esConfirmacionLibro(mensaje)) reactivarBotonLibro();
        return resultado;
    };

    function esConsultaServiciosTexto(texto) {
        const api = root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
        if (api?.esConsultaServicios) {
            try { return Boolean(api.esConsultaServicios(texto)); } catch (_) {}
        }
        const t = String(texto || "").toLowerCase();
        return /libro/.test(t) && /servicio|tinaja|jacuzzi|masaje|late\s*check|cama\s+adicional|cuna/.test(t);
    }

    function recordarTexto() {
        const campo = document.getElementById("haiku-asistente-texto");
        const texto = String(campo?.value || "").trim();
        if (texto && esConsultaServiciosTexto(texto)) ultimoTextoServicios = texto;
    }

    document.addEventListener("input", event => {
        if (event.target?.id === "haiku-asistente-texto") recordarTexto();
    }, true);

    document.addEventListener("keyup", event => {
        if (event.target?.id === "haiku-asistente-texto") recordarTexto();
    }, true);

    function textoAnteriorDelCard(card) {
        let nodo = card?.previousElementSibling || null;
        while (nodo) {
            if (nodo.classList?.contains("haiku-asistente-mensaje--usuario")) {
                const texto = String(nodo.textContent || "").trim();
                if (esConsultaServiciosTexto(texto)) return texto;
            }
            nodo = nodo.previousElementSibling;
        }
        return ultimoTextoServicios;
    }

    function itemsSeleccionados(card, resultado) {
        const listosServicios = resultado.items.filter(x => x.estado === "listo" && x.kind === "servicio");
        const listosNotas = resultado.items.filter(x => x.estado === "listo" && x.kind === "nota");
        const details = [...card.querySelectorAll(":scope > details")];
        const elegidos = [];

        const checksServicios = [...(details[0]?.querySelectorAll("input[type='checkbox']") || [])];
        checksServicios.forEach((check, i) => {
            if (check.checked && !check.disabled && listosServicios[i]) elegidos.push(listosServicios[i]);
        });

        const checksNotas = [...(details[1]?.querySelectorAll("input[type='checkbox']") || [])];
        checksNotas.forEach((check, i) => {
            if (check.checked && !check.disabled && listosNotas[i]) elegidos.push(listosNotas[i]);
        });

        return elegidos;
    }

    async function resolverEstadia(item, cache) {
        const payload = item?.payload ? { ...item.payload } : null;
        const sistema = item?.asociacion?.sistema || null;
        if (!payload || !payload.reserva_id || !sistema?.cabana_id || !sistema?.fecha_ingreso || !sistema?.fecha_salida) {
            throw new Error(`No pude revalidar de forma segura la estadía de ${item?.item_id || "un elemento"}; no se guardó nada.`);
        }

        const clave = `${payload.reserva_id}|${sistema.cabana_id}|${sistema.fecha_ingreso}|${sistema.fecha_salida}`;
        let promesa = cache.get(clave);
        if (!promesa) {
            promesa = (async () => {
                const { data, error } = await root.haikuSupabase
                    .from("reserva_estadias")
                    .select("id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia")
                    .eq("reserva_id", payload.reserva_id)
                    .eq("cabana_id", sistema.cabana_id)
                    .eq("fecha_ingreso", sistema.fecha_ingreso)
                    .eq("fecha_salida", sistema.fecha_salida);
                if (error) throw error;
                const activas = (data || []).filter(x => !/cancelad|no_show/i.test(String(x.estado_estadia || "")));
                if (activas.length !== 1) {
                    throw new Error(`No pude identificar una estadía única para CAB ${item?.reserva?.cabana || "?"} · ${item?.reserva?.titular || "reserva"}; no se guardó nada.`);
                }
                return activas[0].id;
            })();
            cache.set(clave, promesa);
        }

        payload.estadia_id = await promesa;
        return payload;
    }

    function guardarEstadosControles(card) {
        return [...card.querySelectorAll("button,input[type='checkbox']")].map(el => ({ el, disabled: Boolean(el.disabled) }));
    }

    function deshabilitarControles(estados) {
        estados.forEach(({ el }) => { el.disabled = true; });
    }

    function restaurarControles(estados) {
        estados.forEach(({ el, disabled }) => {
            if (el.isConnected) el.disabled = disabled;
        });
        bloquearRevision(document);
    }

    function mostrarError(card, texto) {
        card.querySelectorAll(".haku-libro-servicios__error-guard").forEach(x => x.remove());
        const aviso = document.createElement("div");
        aviso.className = "haku-libro-servicios__razones haku-libro-servicios__error-guard";
        aviso.textContent = String(texto || "No se pudo completar la incorporación.");
        card.append(aviso);
    }

    function mostrarExito(card, data) {
        card.replaceChildren();
        const head = document.createElement("div"); head.className = "haku-libro-servicios__head";
        const left = document.createElement("div");
        const kicker = document.createElement("div"); kicker.className = "haku-libro-servicios__kicker"; kicker.textContent = "LIBRO → PROYECTO H";
        const titulo = document.createElement("div"); titulo.className = "haku-libro-servicios__title"; titulo.textContent = "Incorporación completada";
        left.append(kicker, titulo);
        const chip = document.createElement("span"); chip.className = "haku-libro-servicios__chip"; chip.textContent = "Guardado";
        head.append(left, chip);
        const resumen = document.createElement("div"); resumen.className = "haku-libro-servicios__texto";
        const omitidos = Number(data?.servicios_omitidos || 0) + Number(data?.notas_omitidas || 0);
        resumen.textContent = `Proyecto H confirmó ${Number(data?.servicios_creados || 0)} servicio${Number(data?.servicios_creados || 0) === 1 ? "" : "s"} y ${Number(data?.notas_creadas || 0)} nota${Number(data?.notas_creadas || 0) === 1 ? "" : "s"}. Se omitieron ${omitidos} elementos que ya existían. El Libro original no fue modificado.`;
        card.append(head, resumen);
    }

    function uuid() {
        if (root.crypto?.randomUUID) return root.crypto.randomUUID();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === "x" ? r : (r & 3 | 8)).toString(16);
        });
    }

    async function importarSeguro(card, textoOriginal) {
        const api = root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
        if (!api?.construir) throw new Error("La comparación de servicios del Libro no está disponible.");
        if (!textoOriginal) throw new Error("No pude recuperar la consulta original. Vuelve a pedir la revisión del Libro.");

        bloquearRevision(card);
        const actual = await api.construir(textoOriginal);
        const elegidos = itemsSeleccionados(card, actual);
        if (!elegidos.length) throw new Error("No hay servicios ni notas listos seleccionados para incorporar.");

        const cache = new Map();
        const corregidos = await Promise.all(elegidos.map(item => resolverEstadia(item, cache)));
        const servicios = [];
        const notas = [];
        elegidos.forEach((item, i) => {
            if (item.kind === "servicio") servicios.push(corregidos[i]);
            else if (item.kind === "nota") notas.push(corregidos[i]);
        });

        const confirmar = root.confirm(`Se incorporarán ${servicios.length} servicio${servicios.length === 1 ? "" : "s"} y ${notas.length} nota${notas.length === 1 ? "" : "s"} desde el Libro. Haku revalidó la información y la operación será atómica. ¿Confirmas?`);
        if (!confirmar) return;

        const estados = guardarEstadosControles(card);
        deshabilitarControles(estados);
        try {
            const { data, error } = await root.haikuSupabase.rpc("haiku_importar_libro_operaciones_v2", {
                p_operacion_id: uuid(),
                p_servicios: servicios,
                p_notas: notas
            });
            if (error) throw error;
            if (!data?.ok) throw new Error("Proyecto H no confirmó la incorporación.");
            mostrarExito(card, data);
        } catch (error) {
            restaurarControles(estados);
            throw error;
        }
    }

    document.addEventListener("click", event => {
        const checkBloqueado = event.target?.closest?.(
            ".haku-libro-servicios__item--revisar input[type='checkbox']," +
            ".haku-libro-servicios__item--existente input[type='checkbox']"
        );
        if (checkBloqueado) {
            event.preventDefault();
            event.stopImmediatePropagation();
            checkBloqueado.checked = false;
            checkBloqueado.disabled = true;
            checkBloqueado.setAttribute("aria-disabled", "true");
            return;
        }

        const boton = event.target?.closest?.(".haku-libro-servicios__boton");
        if (!boton || boton.disabled) return;
        const card = boton.closest(".haku-libro-servicios");
        if (!card || card.dataset.haikuHistorialRestaurado === "1" || /Incorporación completada/i.test(card.textContent || "")) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        const texto = textoAnteriorDelCard(card);
        boton.disabled = true;
        importarSeguro(card, texto).catch(error => {
            mostrarError(card, error?.message || "No se pudo completar la incorporación.");
            bloquearRevision(card);
            if (boton.isConnected) boton.disabled = false;
        });
    }, true);

    // No observamos atributos ni el DOM completo. Las tarjetas nuevas ya nacen con
    // revisión manual deshabilitada en el módulo V2; este parche sólo refuerza en
    // interacción y recuperación de errores.
    bloquearRevision(document);

    const api = Object.freeze({
        version: "3.0.0",
        reactivar: reactivarBotonLibro,
        bloquearRevision
    });
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V1 = api;
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V2 = api;
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V3 = api;
})(typeof window !== "undefined" ? window : globalThis);
