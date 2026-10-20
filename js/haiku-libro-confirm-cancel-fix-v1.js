// HAKU · guardas seguras para importar servicios/notas del Libro
// V4: mantiene visible el detalle de la revisión después de guardar y permite
// volver a consultar sin perder la confirmación de incorporación.
(function (root) {
    "use strict";
    if (!root.document || root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4) return;

    const confirmarNativo = root.confirm.bind(root);
    let ultimoTextoServicios = "";
    // Sólo la selección directa de la tarjeta está bloqueada. Las casillas
    // dentro del formulario manual confirman la decisión del administrador.
    const selectorRevision = ".haku-libro-servicios__item--revisar > input[type='checkbox']," +
        ".haku-libro-servicios__item--existente > input[type='checkbox']";
    const selectorSeleccionados = "input.haku-libro-servicios__check[type='checkbox']:checked:not(:disabled)";

    function esConfirmacionLibro(texto) {
        const t = String(texto || "");
        return /^Se incorporarán\s+\d+\s+servicio(?:s)?\s+y\s+\d+\s+nota(?:s)?\s+desde el Libro\./i.test(t)
            && /operación será atómica/i.test(t);
    }

    function bloquearRevision(scope = document) {
        scope.querySelectorAll?.(selectorRevision).forEach(check => {
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
                const seleccionados = card.querySelectorAll(selectorSeleccionados).length;
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
            const vistos = new Set();
            return checksConId.filter(check => check.checked && !check.disabled).flatMap(check => {
                if (vistos.has(check.dataset.hakuItemId)) throw new Error('La selección contiene un origen repetido. Vuelve a revisar antes de guardar.');
                vistos.add(check.dataset.hakuItemId);
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
        aviso.setAttribute("role", "alert");
        aviso.textContent = String(texto || "No se pudo completar la incorporación.");
        card.append(aviso);
        aviso.scrollIntoView?.({ block: "nearest" });
    }

    function mensajeErrorIncorporacion(error) {
        const texto = String(error?.message || error || "").trim();
        if (/permission denied for table eventos_auditoria/i.test(texto)) {
            return "Proyecto H no pudo registrar la auditoría de la incorporación. No se guardó ningún servicio ni nota; vuelve a intentar después de actualizar la base.";
        }
        return texto || "No se pudo completar la incorporación.";
    }

    function uuid() {
        if (root.crypto?.randomUUID) return root.crypto.randomUUID();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === "x" ? r : (r & 3 | 8)).toString(16);
        });
    }

    // Detalle del recibo: separado por tipo y sólo después del OK del RPC.
    // No consulta ni modifica reservas, servicios, notas o pagos.
    function completarRecibo(card, data, elegidos) {
        if (data?.ok !== true) return;
        const tarjeta = card.querySelector('.haku-libro-resultado-sites__tarjeta');
        const detalle = tarjeta?.querySelector('.haku-libro-resultado-sites__detalle');
        if (!detalle || typeof tarjeta.insertBefore !== 'function') return;
        tarjeta.querySelectorAll('.haku-libro-resultado-sites__incorporados').forEach(n => n.remove());
        const crear = (tag, clase, texto) => {
            const nodo = document.createElement(tag);
            if (clase) nodo.className = clase;
            if (texto !== undefined) nodo.textContent = String(texto);
            return nodo;
        };
        // Sólo el resultado por item_id del RPC acredita una incorporación.
        // No confundir elegidos, ya existentes u omitidos con elementos nuevos.
        const grupoIncorporados = (kind, titulo, cantidad, respuesta, estadoCreado) => {
            const grupo = crear("section", "haku-libro-resultado-sites__incorporados");
            grupo.dataset.tipo = kind;
            grupo.style.padding = '14px 15px';
            grupo.style.borderBottom = '1px solid #dce8e0';
            grupo.style.minWidth = '0';
            grupo.setAttribute("aria-label", titulo);
            const encabezado = crear("div", "haku-libro-resultado-sites__grupo-cabecera");
            encabezado.style.display = 'flex';
            encabezado.style.alignItems = 'center';
            encabezado.style.justifyContent = 'space-between';
            encabezado.style.gap = '8px';
            const heading = crear("h3", "", titulo);
            heading.style.margin = '0'; heading.style.fontSize = '12px';
            heading.style.lineHeight = '1.4'; heading.style.color = '#254531';
            encabezado.append(heading,
                crear("span", "haku-libro-resultado-sites__chip", Number(cantidad || 0)));
            grupo.append(encabezado);
            const totalValido = Number.isSafeInteger(cantidad) && cantidad >= 0;
            const recibidos = Array.isArray(respuesta) ? respuesta : [];
            const nuevos = recibidos.filter(r => r?.estado === estadoCreado);
            const filas = nuevos.map(r => {
                const candidatos = elegidos.filter(i => i.item_id === r.item_id && i.kind === kind && i.estado === 'listo');
                const veces = [...(data.servicios || []), ...(data.notas || [])]
                    .filter(x => x?.item_id === r.item_id).length;
                const item = candidatos.length === 1 && veces === 1 ? candidatos[0] : null;
                if (!r.item_id || !item ||
                    r.reserva_id != null && r.reserva_id !== item.payload?.reserva_id ||
                    r.estadia_id != null && r.estadia_id !== item.payload?.estadia_id) return null;
                return item;
            });
            if (!totalValido || nuevos.length !== cantidad || filas.some(i => !i)) {
                const aviso = crear("p", "haku-libro-resultado-sites__grupo-aviso",
                    "El total fue confirmado, pero no se pudo identificar con seguridad el detalle. Revisa la reserva antes de repetir la operación.");
                aviso.setAttribute("role", "status"); grupo.append(aviso);
            } else if (!cantidad) {
                grupo.append(crear("p", "haku-libro-resultado-sites__grupo-vacio", kind === 'nota'
                    ? "No se incorporaron notas en esta operación."
                    : "No se incorporaron servicios en esta operación."));
            } else for (const item of filas) {
                const fila = crear("div", "haku-libro-resultado-sites__fila");
                fila.dataset.itemId = item.item_id;
                const cabana = item.reserva?.cabana ? `CAB ${item.reserva.cabana} · ` : '';
                const nombre = kind === 'nota' ? 'Nota de la reserva'
                    : item.mapa?.nombre || item.servicio?.concepto || 'Servicio';
                fila.append(crear("strong", "", `${cabana}${item.reserva?.titular || 'Reserva'} · ${nombre}`),
                    crear("span", "haku-libro-resultado-sites__estado", kind === 'nota' ? 'Nota incorporada' : 'Servicio incorporado'));
                const p = item.payload || {};
                if (kind === 'servicio') {
                    const datos = [p.fecha_servicio,
                        p.hora ? `${p.hora}${item.hora_fin ? '–' + item.hora_fin : ''}` : null,
                        p.cantidad != null ? `Cantidad: ${p.cantidad}` : null,
                        p.tipo_cobro === 'cortesia' ? 'Cortesía' : p.tipo_cobro === 'normal' ? 'Cobrable' : null].filter(Boolean);
                    if (datos.length) fila.append(crear("p", "", datos.join(' · ')));
                }
                const descripcion = kind === 'nota' ? p.texto || item.texto : item.servicio?.texto_original;
                if (descripcion) {
                    const texto = crear("p", "haku-libro-resultado-sites__texto-incorporado", descripcion);
                    texto.style.whiteSpace = 'pre-wrap'; fila.append(texto);
                }
                grupo.append(fila);
            }
            grupo.querySelectorAll('.haku-libro-resultado-sites__grupo-aviso,.haku-libro-resultado-sites__grupo-vacio').forEach(p => {
                p.style.margin = '8px 0 0'; p.style.fontSize = '10px'; p.style.lineHeight = '1.5';
                p.style.color = p.className.endsWith('aviso') ? '#805e2e' : '#617267';
            });
            return grupo;
        };
        const serviciosIncorporados = grupoIncorporados('servicio', 'Servicios incorporados',
            data.servicios_creados, data.servicios, 'creado');
        const notasIncorporadas = grupoIncorporados('nota', 'Notas incorporadas',
            data.notas_creadas, data.notas, 'creada');

        tarjeta.insertBefore(serviciosIncorporados, detalle);
        tarjeta.insertBefore(notasIncorporadas, detalle);
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
            api.renderizarResultadoServicios(card, data, actual, elegidos, textoOriginal);
            completarRecibo(card, data, elegidos);
        } catch (error) {
            restaurarControles(estados);
            throw error;
        }
    }

    document.addEventListener("click", event => {
        const checkBloqueado = event.target?.closest?.(selectorRevision);
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
        const texto = root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2?.consultaVista?.(card)||textoAnteriorDelCard(card);
        const etiqueta = boton.textContent;
        boton.disabled = true;
        boton.textContent = "Revalidando…";
        boton.setAttribute("aria-busy", "true");
        importarSeguro(card, texto).catch(error => {
            mostrarError(card, mensajeErrorIncorporacion(error));
            bloquearRevision(card);
        }).finally(() => {
            if (!boton.isConnected || !card.classList.contains("haku-libro-servicios")) return;
            boton.removeAttribute?.("aria-busy");
            boton.textContent = etiqueta;
            boton.disabled = card.querySelectorAll(selectorSeleccionados).length === 0;
        });
    }, true);

    // No observamos atributos ni el DOM completo. Las tarjetas nuevas ya nacen con
    // revisión manual deshabilitada en el módulo V2; este parche sólo refuerza en
    // interacción y recuperación de errores.
    bloquearRevision(document);

    const api = Object.freeze({
        version: "4.0.0",
        reactivar: reactivarBotonLibro,
        bloquearRevision,
        completarRecibo
    });
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V1 = api;
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V2 = api;
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V3 = api;
    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4 = api;
})(typeof window !== "undefined" ? window : globalThis);
