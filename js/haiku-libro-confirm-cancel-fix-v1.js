// HAKU · guardas seguras para importar servicios/notas del Libro
// V4: mantiene visible el detalle de la revisión después de guardar y permite
// volver a consultar sin perder la confirmación de incorporación.
(function (root) {
    "use strict";
    if (!root.document || root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4) return;

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
                if (boton.dataset.hakuAccion !== 'incorporar') return;
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
        const checksConId = [...card.querySelectorAll('input[data-haku-item-id]')];
        if (checksConId.length) {
            const porId = new Map(resultado.items.map(item => [item.item_id, item]));
            return checksConId.filter(check => check.checked && !check.disabled).flatMap(check => {
                const item = porId.get(check.dataset.hakuItemId);
                if (item?.estado === 'existente') return [];
                if (!item || item.estado !== 'listo') throw new Error('Uno o más elementos cambiaron desde la vista previa. Vuelve a revisar antes de guardar.');
                return [item];
            });
        }
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

    function mensajeErrorIncorporacion(error) {
        const texto = String(error?.message || error || "").trim();
        if (/permission denied for table eventos_auditoria/i.test(texto)) {
            return "Proyecto H no pudo registrar la auditoría de la incorporación. No se guardó ningún servicio ni nota; vuelve a intentar después de actualizar la base.";
        }
        return texto || "No se pudo completar la incorporación.";
    }

    function prepararDetalleAnterior(card) {
        const copia = card.cloneNode(true);
        copia.querySelectorAll(".haku-libro-servicios__acciones,.haku-libro-servicios__error-guard").forEach(x => x.remove());
        copia.querySelectorAll("button,input,select,textarea").forEach(control => {
            control.disabled = true;
            control.setAttribute("aria-disabled", "true");
        });
        const wrap = document.createElement("div");
        wrap.className = "haku-libro-servicios__revision-anterior haku-libro-servicios haku-comparacion-compacta";
        [...copia.children].forEach(child => wrap.append(child));
        return wrap;
    }

    function botonSecundario(texto) {
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "libro-reserva-boton secundario";
        boton.textContent = texto;
        return boton;
    }

    function mostrarExito(card, data, textoOriginal, detalleAnterior) {
        card.replaceChildren();
        card.className = "haiku-asistente-preview haiku-incorporacion haku-incorporacion-resultado haku-incorporacion-resultado--servicios";
        const cabecera = document.createElement("div"); cabecera.className = "haiku-incorporacion-cabecera haku-incorporacion-resultado-cabecera";
        const titulo = document.createElement("div");
        const kicker = document.createElement("span"); kicker.textContent = "LIBRO ↔ PROYECTO H";
        const nombre = document.createElement("strong"); nombre.textContent = "Incorporación completada";
        titulo.append(kicker, nombre);
        const estado = document.createElement("span"); estado.className = "haiku-incorporacion-modo"; estado.textContent = "Guardado";
        cabecera.append(titulo, estado);
        const mensaje = document.createElement("p"); mensaje.className = "haiku-incorporacion-aviso haku-incorporacion-resultado-mensaje";
        const omitidos = Number(data?.servicios_omitidos || 0) + Number(data?.notas_omitidas || 0);
        mensaje.textContent = `Proyecto H confirmó la incorporación completa. El Libro original no fue modificado.`;
        const resumen = document.createElement("div"); resumen.className = "haiku-incorporacion-resumen haku-incorporacion-resultado-resumen";
        for (const [cantidad, etiqueta] of [
            [Number(data?.servicios_creados || 0), "Servicios"],
            [Number(data?.notas_creadas || 0), "Notas"],
            [omitidos, "Omitidos"]
        ]) {
            const indicador = document.createElement("div"); indicador.className = "haiku-incorporacion-indicador haku-incorporacion-resultado-indicador";
            const valor = document.createElement("strong"); valor.textContent = String(cantidad);
            const label = document.createElement("span"); label.textContent = etiqueta;
            indicador.append(valor, label); resumen.append(indicador);
        }
        card.append(cabecera, mensaje, resumen);

        if (detalleAnterior) {
            const detalle = document.createElement("details");
            detalle.className = "haiku-comparacion-acordeon haku-franja--normal haku-icono--servicio haku-incorporacion-resultado-detalle";
            const summary = document.createElement("summary");
            summary.textContent = "Ver detalle de la revisión anterior";
            detalle.append(summary, detalleAnterior);
            card.append(detalle);
        }

        const acciones = document.createElement("div");
        acciones.className = "haiku-incorporacion-acciones";
        const revisar = botonSecundario("Revisar de nuevo");
        revisar.addEventListener("click", () => {
            const api = root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
            if (!api?.procesar || !textoOriginal) return;
            revisar.disabled = true;
            Promise.resolve(api.procesar(textoOriginal)).finally(() => {
                if (revisar.isConnected) {
                    revisar.disabled = false;
                }
            });
        });
        acciones.append(revisar);
        card.append(acciones);
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
        const actual = await (api.revalidarVista ? api.revalidarVista(card, textoOriginal) : api.construir(textoOriginal));
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

        const detalleAnterior = prepararDetalleAnterior(card);
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
            mostrarExito(card, data, textoOriginal, detalleAnterior);
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
        if (!boton || boton.disabled || boton.dataset.hakuAccion !== 'incorporar') return;
        const card = boton.closest(".haku-libro-servicios");
        if (!card || card.dataset.haikuHistorialRestaurado === "1" || /Incorporación completada/i.test(card.textContent || "")) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        const texto = textoAnteriorDelCard(card);
        boton.disabled = true;
        importarSeguro(card, texto).catch(error => {
            mostrarError(card, mensajeErrorIncorporacion(error));
            bloquearRevision(card);
            if (boton.isConnected) boton.disabled = false;
        });
    }, true);

    // No observamos atributos ni el DOM completo. Las tarjetas nuevas ya nacen con
    // revisión manual deshabilitada en el módulo V2; este parche sólo refuerza en
    // interacción y recuperación de errores.
    bloquearRevision(document);

    const api = Object.freeze({
        version: "4.0.0",
        reactivar: reactivarBotonLibro,
        bloquearRevision
    });
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V1 = api;
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V2 = api;
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V3 = api;
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4 = api;
})(typeof window !== "undefined" ? window : globalThis);
