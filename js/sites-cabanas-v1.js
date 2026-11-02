// Presentación Sites de Cabañas. La operación sigue en las autoridades existentes.
(() => {
    "use strict";

    const raiz = document.getElementById("seccion-cabanas");
    if (!raiz) return;

    const ESTADOS = Object.freeze([
        ["pendiente", "Pendiente"],
        ["en_curso", "En curso"],
        ["lista_para_revisar", "Lista para revisar"],
        ["no_requiere", "No requiere"]
    ]);
    const REVISIONES = Object.freeze({ pendiente: "Pendiente", en_revision: "En revisión",
        "con-detalles": "Con detalles", lista: "Lista" });
    const revisionesGuardando = new Set();
    const FINALES = Object.freeze({ pendiente: "Pendiente", en_curso: "En curso",
        lista_para_revisar: "Lista para revisar", "con-detalles": "Con detalles",
        lista: "Lista", no_requiere: "No requiere" });
    const estado = { tab: "operation", filtro: "todas", numero: "", origen: "operation", modo: "completa", fecha: "" };
    const CLAVE_CONTEXTO = "haikuCabanasContextoPestanaV1";
    const panelAutenticado = document.documentElement.classList.contains("haiku-cabanas-pendiente");
    let usuarioRestaurado = "";
    let revisionPendiente = null;
    let aperturaExpress = null;
    let restaurando = false;
    let solicitudEditada = null;
    let contextoSolicitud = null;
    let solicitudGuardando = false;
    const expressAutomaticos = new Set();
    const $ = selector => raiz.querySelector(selector);
    const escapar = valor => String(valor ?? "").replace(/[&<>"']/g, caracter => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[caracter]);
    const fechaActual = () => {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch (_) { return ""; }
    };
    const dia = fecha => {
        try { return typeof obtenerDatosDia === "function" ? obtenerDatosDia(fecha) : null; }
        catch (_) { return null; }
    };
    const cabana = (fecha, numero) => dia(fecha)?.cabanas?.[String(numero)] || {};
    const numeroValido = numero => /^(?:[1-9]|10|11)$/.test(String(numero));
    const usuarioActual = () => String(window.haikuSesion?.auth?.id || "");
    function guardarContexto() {
        if (restaurando || !usuarioActual() || !fechaActual() || typeof sessionStorage === "undefined") return;
        const dato = cabana(fechaActual(), estado.numero);
        const ciclo = estado.numero ? estado.modo === "aseo_express"
            ? cicloExpress(dato, fechaActual(), estado.numero) : dato.revisionCompletaCiclo : null;
        try {
            sessionStorage.setItem(CLAVE_CONTEXTO, JSON.stringify({
                usuarioId: usuarioActual(), fecha: fechaActual(), tab: estado.tab,
                numero: estado.numero, origen: estado.origen, modo: estado.modo,
                revisionId: ciclo?.verificado === true && ciclo.fecha === fechaActual()
                    ? String(estado.modo === "aseo_express" ? ciclo.revisionId || "" : ciclo.id || "") : ""
            }));
        } catch (_) {}
    }
    function leerContexto() {
        try {
            const guardado = sessionStorage.getItem(CLAVE_CONTEXTO);
            if (!guardado) return null;
            const contexto = JSON.parse(guardado);
            if (contexto?.usuarioId === usuarioActual() && contexto.fecha === fechaActual() &&
                ["operation", "review"].includes(contexto.tab) &&
                (!contexto.numero || numeroValido(contexto.numero)) &&
                ["operation", "review"].includes(contexto.origen) &&
                ["completa", "aseo_express"].includes(contexto.modo)) return contexto;
        } catch (_) {}
        try { sessionStorage.removeItem(CLAVE_CONTEXTO); } catch (_) {}
        return null;
    }
    function mostrarContexto() {
        document.documentElement.classList.remove("haiku-cabanas-pendiente");
    }
    const revision = (dato, fecha = fechaActual(), numero = "") => {
        if (expressReal(dato, fecha, numero)) {
            const ciclo = cicloExpress(dato, fecha, numero);
            if (ciclo.estadoRevision === "en_proceso") return "en_revision";
            if (ciclo.estadoRevision === "completada" && ciclo.resultadoRevision === "lista") return "lista";
            if (ciclo.estadoRevision === "completada" && ["con_detalles", "no_lista"].includes(ciclo.resultadoRevision)) return "con-detalles";
            return "pendiente";
        }
        const ciclo = dato?.revisionCompletaCiclo;
        if (ciclo?.fecha === fecha && ciclo.verificado === false) return "pendiente";
        if (window.haikuSesion && ciclo?.fecha === fecha) {
            if (ciclo.estado === "en_proceso") return "en_revision";
            if (ciclo.estado === "completada" && ciclo.resultado === "lista") return "lista";
            if (ciclo.estado === "completada" && ciclo.resultado === "con_detalles") return "con-detalles";
            return "pendiente";
        }
        if (window.haikuSesion && (!ciclo || ciclo.fecha !== fecha)) return "pendiente";
        return Object.hasOwn(REVISIONES, dato?.estadoRevision) ? dato.estadoRevision : "pendiente";
    };
    const estadoAseo = dato => {
        if (dato?.aseoIn) return dato.aseoOut ? "lista_para_revisar" : "en_curso";
        if (!dato?.aseoOut && dato?.aseoEstado === "no_requiere") return "no_requiere";
        return "pendiente";
    };
    const estadoFinal = (dato, fecha = fechaActual(), numero = "") => {
        const aseo = estadoAseo(dato);
        if (aseo === "no_requiere" && !expressReal(dato, fecha, numero)) return "no_requiere";
        const rev = revision(dato, fecha, numero);
        if (rev === "lista" || rev === "con-detalles") return rev;
        if (aseo === "lista_para_revisar" || aseo === "en_curso") return aseo;
        return "pendiente";
    };
    const tono = valor => valor === "lista" || valor === "LISTA" || valor === "no_requiere" ? "ready"
        : valor === "en_curso" || valor === "lista_para_revisar" || valor === "en_revision" ? "progress"
        : valor === "con-detalles" || valor === "CON DETALLES" || valor === "cancelado" ? "issue" : "pending";
    const etiqueta = valor => valor === "cancelado" ? "Cancelado (histórico)"
        : ESTADOS.find(([codigo]) => codigo === valor)?.[1] || "Pendiente";
    function aseoHTML(dato, numero) {
        const aseo = estadoAseo(dato);
        const accion = !dato.aseoIn && !dato.aseoOut
            ? `<button type="button" class="cb-text-action cb-no-requiere" data-cb-no-requiere data-cabana="${numero}" aria-label="${aseo === "no_requiere" ? "Restablecer a Pendiente" : "Marcar No requiere"} · Cabaña ${numero}">${aseo === "no_requiere" ? "Restablecer" : "No requiere"}</button>` : "";
        const conflicto = dato.aseoOut && !dato.aseoIn ? "Revisar: OUT sin IN"
            : dato.aseoEstado === "no_requiere" && (dato.aseoIn || dato.aseoOut) ? "Revisar: No requiere con horas" : "";
        return `<span class="cb-aseo-indicator"><span class="cb-badge ${tono(aseo)}" data-cb-aseo-state>${etiqueta(aseo)}</span>${accion}</span>${conflicto ? `<small class="cb-aseo-conflict">${conflicto}</small>` : ""}`;
    }
    const cicloExpress = (dato, fecha, numero) => window.HAIKU_ASEO_OPERACION_V1?.obtenerCicloExpress
        ? window.HAIKU_ASEO_OPERACION_V1.obtenerCicloExpress(fecha, numero)
        : panelAutenticado || window.haikuSesion ? null : dato?.aseoExpressCiclo;
    const expressReal = (dato, fecha, numero) => {
        const ciclo = cicloExpress(dato, fecha, numero);
        return ciclo?.fecha === fecha && ciclo.verificado === true && ciclo.existe === true;
    };
    const fechaLarga = fecha => fecha ? new Intl.DateTimeFormat("es-CL", {
        timeZone: "America/Santiago", weekday: "long", day: "numeric", month: "long", year: "numeric"
    }).format(new Date(`${fecha}T12:00:00`)) : "";
    const reservaId = dato => String(dato?.estado === "sale-libre" ?
        (dato?.salidaReservaId || "") : (dato?.reservaId || dato?.reserva_id || "")).trim();
    function titular(dato, fecha = fechaActual(), numero = "") {
        if (dato?.estado === "bloqueada") return "Sin reserva";
        const id = reservaId(dato);
        const proyectada = window.HAIKU_OPERACION_DIA_IDENTIDAD_V1?.obtener?.(fecha, numero);
        if (proyectada) {
            if (proyectada.estado !== dato?.estado || !proyectada.reservaId) return "Sin reserva";
            if (id && proyectada.reservaId !== id) return "Sin titular";
            if (proyectada.titular && !/^(?:sin titular|sin reserva|bloqueada)$/i.test(proyectada.titular)) {
                return proyectada.titular;
            }
        }
        if (!id) return proyectada ? "Sin titular" : "Sin reserva";
        const resumen = String(dato?.resumenTitular || "").trim();
        const resumenId = String(dato?.resumenTitularReservaId || "").trim();
        if (resumen && resumenId === id) return resumen;
        return String(dato?.titular || "").trim() || String(dato?.codigoHaiku || "").trim() || "Sin titular";
    }
    function trabajo(dato) {
        const clave = String(dato?.estado || "").toLowerCase();
        if (clave === "sale-ingresa") return "Recambio";
        if (clave === "sale-libre") return "Salida";
        if (clave === "libre-ingresa") return "Ingreso";
        if (clave === "continua") return "Arrumación";
        if (clave === "fullday") return "Full Day";
        if (clave === "bloqueada") return "Bloqueada";
        return dato?.aseo || dato?.aseoIn || dato?.aseoOut ? "Preparación" : "Sin reserva";
    }
    function listaSolicitudes(fecha, numero, dato) {
        const operativas = (dia(fecha)?.notasOperativas || []).filter(nota =>
            String(nota.cabana) === String(numero)).map(nota => String(nota.texto || "").trim()).filter(Boolean);
        const expresa = String(dato?.solicitudAseoExpress || "").trim();
        return { expresas: expresa ? [expresa] : [], operativas };
    }
    function solicitudesHTML(fecha, numero, dato, eliminar = true, detalle = false) {
        if (Array.isArray(dato?.solicitudesTipos)) return solicitudesTiposHTML(numero, dato.solicitudesTipos, eliminar, detalle);
        const solicitudes = listaSolicitudes(fecha, numero, dato);
        const etiquetas = solicitudes.expresas.map(texto => `<span>${escapar(texto)}${eliminar
            ? ` <button type="button" data-eliminar-solicita="${numero}" aria-label="Eliminar solicitud de cabaña ${numero}">×</button>` : ""}</span>`);
        etiquetas.push(...solicitudes.operativas.map(texto => `<span>${escapar(texto)}</span>`));
        return etiquetas.length ? `<div class="cb-requests">${etiquetas.join("")}</div>` : "";
    }
    function tiposSolicitud() { return window.HAIKU_ASEO_OPERACION_V1?.tiposSolicitud || {}; }
    function solicitudesTiposHTML(numero, solicitudes, eliminar, enFicha) {
        const tipos = tiposSolicitud();
        return solicitudes.filter(solicitud => solicitud.estado !== "cancelada" && tipos[solicitud.categoria]).map(solicitud => {
            const titulo = tipos[solicitud.categoria], detalle = solicitud.descripcion === titulo ? "" : solicitud.descripcion;
            const atributos = `data-cb-request-category="${escapar(solicitud.categoria)}"`;
            if (!enFicha) return `<span class="cb-typed-request-chip" title="${escapar(detalle || titulo)}">${escapar(titulo)}</span>`;
            return `<div class="cb-typed-request"><div><strong>${escapar(titulo)}</strong>${detalle ? `<small>${escapar(detalle)}</small>` : ""}</div><span class="cb-badge pending">${solicitud.estado === "completada" ? "Completada" : solicitud.estado === "en_proceso" ? "En curso" : "Pendiente"}</span>${eliminar ? `<button type="button" data-cb-request-edit="${numero}" ${atributos} aria-label="Editar ${escapar(titulo)}">Editar</button><button type="button" data-cb-request-cancel="${numero}" ${atributos} aria-label="Cancelar ${escapar(titulo)}">×</button>` : ""}</div>`;
        }).join("");
    }
    function abrirSolicitud(numero = "", solicitud = null) {
        solicitudEditada = solicitud;
        const numeroFijo = numeroValido(numero) ? String(numero) : numeroValido(estado.numero) ? estado.numero : "";
        contextoSolicitud = { fecha: fechaActual(), usuario: usuarioActual(), numero: numeroFijo };
        const panel = $("#panel-agregar-solicita");
        const select = $("#solicita-cabana");
        if (!panel || !select) return;
        select.value = numeroFijo || "1";
        select.disabled = Boolean(numeroFijo || solicitud);
        $("#solicita-cabana-campo").hidden = Boolean(numeroFijo);
        const cabanaFija = $("#solicita-cabana-fija");
        cabanaFija.hidden = !numeroFijo;
        cabanaFija.textContent = numeroFijo ? `Cabaña ${numeroFijo}` : "";
        $("#cabinsRequestTitle").textContent = solicitud ? "Editar solicitud" : "Agregar solicitud";
        const tipos = tiposSolicitud();
        $("#solicita-texto").value = solicitud && solicitud.descripcion !== tipos[solicitud.categoria] ? solicitud.descripcion : "";
        for (const radio of panel.querySelectorAll('[name="solicita-tipo"]')) {
            radio.checked = radio.value === (solicitud?.categoria || "aseo_express");
            radio.disabled = Boolean(solicitud);
        }
        $("#solicita-error").textContent = "";
        panel.classList.add("activo");
    }
    async function guardarSolicitudDesdeFormulario() {
        if (solicitudGuardando) return;
        const api = window.HAIKU_ASEO_OPERACION_V1;
        const numero = contextoSolicitud?.numero || $("#solicita-cabana").value;
        const categoria = $("#solicita-tipos").querySelector('input:checked')?.value;
        const descripcion = $("#solicita-texto").value.trim();
        const error = $("#solicita-error");
        if (!contextoSolicitud || contextoSolicitud.fecha !== fechaActual() || contextoSolicitud.usuario !== usuarioActual()) {
            error.textContent = "La fecha o la sesión cambió. Abre nuevamente la solicitud."; return;
        }
        if (!api?.guardarSolicitudTipo || !tiposSolicitud()[categoria]) {
            error.textContent = "Espera a que termine de cargar la operación e intenta nuevamente."; return;
        }
        solicitudGuardando = true; error.textContent = "";
        const panel = $("#panel-agregar-solicita");
        panel.setAttribute("aria-busy", "true");
        for (const boton of panel.querySelectorAll("button")) boton.disabled = true;
        for (const control of panel.querySelectorAll('input, select')) control.disabled = true;
        $("#solicita-texto").readOnly = true;
        try {
            await api.guardarSolicitudTipo(contextoSolicitud.fecha, numero, categoria, descripcion);
            panel.classList.remove("activo");
            pintar();
            if (categoria === "aseo_express" && estado.numero === String(numero)) await cambiarModo("aseo_express");
        } catch (causa) {
            error.textContent = causa.message || "No fue posible guardar. El detalle se conserva para reintentar.";
        } finally {
            solicitudGuardando = false;
            panel.setAttribute("aria-busy", "false");
            for (const boton of panel.querySelectorAll("button")) boton.disabled = false;
            for (const control of panel.querySelectorAll('input, select')) {
                control.disabled = Boolean(solicitudEditada) || (control.id === "solicita-cabana" && Boolean(contextoSolicitud?.numero));
            }
            $("#solicita-texto").readOnly = false;
        }
    }
    async function cancelarSolicitudTipo(numero, categoria) {
        if (!tiposSolicitud()[categoria] || !window.confirm(`¿Cancelar ${tiposSolicitud()[categoria]} de Cabaña ${numero}?`)) return;
        try {
            await window.HAIKU_ASEO_OPERACION_V1.guardarSolicitudTipo(fechaActual(), numero, categoria, "", true);
            pintar();
        } catch (error) { window.alert(error.message || "No fue posible cancelar la solicitud."); }
    }
    function seleccionarExpressAutomatico() {
        if (!estado.numero || aperturaExpress || revisionPendiente || restaurando) return;
        const ciclo = cicloExpress(cabana(fechaActual(), estado.numero), fechaActual(), estado.numero);
        if (!ciclo?.verificado || ciclo.fecha !== fechaActual()) return;
        const prefijo = `${usuarioActual()}:${ciclo.fecha}:${estado.numero}:`;
        if (!ciclo.existe) {
            for (const clave of expressAutomaticos) if (clave.startsWith(prefijo)) expressAutomaticos.delete(clave);
            return;
        }
        const clave = `${usuarioActual()}:${ciclo.fecha}:${estado.numero}:${ciclo.solicitudId}`;
        if (expressAutomaticos.has(clave)) return;
        expressAutomaticos.add(clave);
        const numero = estado.numero, fecha = fechaActual(), usuario = usuarioActual();
        // El evento se emite dentro de hidratar. Esperar su cierre permite que
        // el puente haga una lectura nueva, sin reutilizar la misma verificación.
        setTimeout(() => {
            if (estado.numero !== numero || fechaActual() !== fecha || usuarioActual() !== usuario) return;
            if (estado.modo === "aseo_express" || aperturaExpress) return;
            Promise.resolve(cambiarModo("aseo_express")).then(abierto => {
                if (abierto === false) expressAutomaticos.delete(clave);
            }).catch(() => expressAutomaticos.delete(clave));
        }, 0);
    }
    function grupoCabana(dato, fecha, numero) {
        if (dato?.aseoIn && !dato.aseoOut) return "en_curso";
        const final = estadoFinal(dato, fecha, numero);
        if (["lista", "no_requiere"].includes(final)) return "listas";
        return final === "lista_para_revisar" ? "por_revisar" : "pendientes";
    }
    function gruposCabanas(fecha) {
        const grupos = { todas: [], pendientes: [], en_curso: [], por_revisar: [], listas: [], trabajo: [] };
        for (let numero = 1; numero <= 11; numero++) {
            const grupo = grupoCabana(cabana(fecha, numero), fecha, numero);
            grupos.todas.push(numero); grupos[grupo].push(numero);
            if (grupo === "pendientes" || grupo === "en_curso") grupos.trabajo.push(numero);
        }
        return grupos;
    }
    function resumen(fecha) {
        const grupos = gruposCabanas(fecha);
        $("#cabinsSummary").innerHTML = [["trabajo", "En trabajo o pendientes"], ["por_revisar", "Por revisar"], ["listas", "Listas para operar"]]
            .map(([clave, texto]) => {
                const numeros = grupos[clave];
                const activo = estado.filtro === clave || (clave === "trabajo" && ["pendientes", "en_curso"].includes(estado.filtro));
                return `<button type="button" class="cb-summary-group" data-cb-filter="${clave}" aria-pressed="${activo}" aria-label="${texto}: ${numeros.length}. Cabañas: ${numeros.join(", ") || "ninguna"}"><strong class="cb-summary-count">${numeros.length}</strong><span class="cb-summary-label">${texto}</span><span class="cb-summary-numbers">${numeros.map(n => `<span class="cb-cabin-number">${n}</span>`).join("") || '<span class="cb-summary-none">—</span>'}</span></button>`;
            }).join("");
    }
    const pesoTexto = valor => String(Number(Number(valor || 0).toPrecision(12)));
    const sacosTexto = cantidad => `${cantidad} ${cantidad === 1 ? "saco" : "sacos"}`;
    const lenaTexto = (cantidad, peso) => `${sacosTexto(cantidad)} · ${pesoTexto(peso)} kg`;
    const destinosInsumos = { aseo_full: "Aseo Full", aseo_express: "Aseo Express", venta_huesped: "Venta / compra huésped", sin_especificar: "Sin especificar" };
    const destinoTexto = destino => destinosInsumos[destino] || destinosInsumos.sin_especificar;
    const desgloseTexto = destinos => Object.entries(destinosInsumos).filter(([destino]) => destinos?.[destino] > 0)
        .map(([destino, nombre]) => `${nombre}: ${sacosTexto(destinos[destino])}`).join(" · ");
    let edicionSaco = null;
    let contextoInsumos = "";
    function textoInsumos(fecha, numero) {
        const dato = window.HAIKU_INSUMOS_ASEO_V1?.obtener(fecha, numero);
        if (!dato?.listo) return "";
        return [["lena", "Leña"], ["carbon", "Carbón"]].filter(([insumo]) => dato[insumo].confirmada > 0)
            .map(([insumo, nombre]) => `${nombre} ${insumo === "lena" ? lenaTexto(dato.lena.confirmada, dato.lena.pesoKg) : sacosTexto(dato.carbon.confirmada)}`).join(" · ");
    }
    function pintarInsumos(fecha = fechaActual()) {
        const api = window.HAIKU_INSUMOS_ASEO_V1;
        const totales = api?.total(fecha);
        const resumenInsumos = $("#cabinsSuppliesSummary");
        if (resumenInsumos) {
            resumenInsumos.querySelector("[data-insumos-total=lena]").textContent = totales?.listo ? lenaTexto(totales.lena, totales.lenaKg) : "—";
            resumenInsumos.querySelector("[data-insumos-total=carbon]").textContent = totales?.listo ? sacosTexto(totales.carbon) : "—";
            resumenInsumos.querySelector("[data-insumos-error]").textContent = totales?.error ? "No se pudieron actualizar los insumos." : "";
            resumenInsumos.querySelector(".cb-supplies-feedback").hidden = !totales?.error;
            resumenInsumos.querySelector("[data-insumos-reintentar]").hidden = !totales?.error;
            const detalle = resumenInsumos.querySelector("[data-insumos-destinos]");
            detalle.hidden = !totales?.listo || !(totales.lena || totales.carbon);
            for (const insumo of ["lena", "carbon"]) {
                const linea = resumenInsumos.querySelector(`[data-insumos-desglose=${insumo}]`);
                const filas = destinosPorCabana(fecha, insumo);
                const texto = desgloseTexto(totales?.destinos?.[insumo]);
                linea.innerHTML = filas.length ? filas.map(fila => `<div class="cb-supply-destination"><span class="cb-cabin-number">${fila.numero}</span><span><strong>Cabaña ${fila.numero} · ${destinoTexto(fila.destino)}</strong><small>${insumo === "lena" ? "Leña" : "Carbón"} · ${fila.peso === null ? sacosTexto(fila.cantidad) : lenaTexto(fila.cantidad, fila.peso)}</small></span></div>`).join("") : escapar(`${insumo === "lena" ? "Leña" : "Carbón"} · ${texto}`);
                linea.hidden = (!filas.length && !texto) || !totales?.listo;
            }
        }
        raiz.querySelectorAll("[data-cb-insumos]").forEach(nodo => {
            const texto = textoInsumos(fecha, nodo.dataset.cbInsumos);
            nodo.textContent = texto ? ` · ${texto}` : "";
            nodo.parentElement.title = nodo.parentElement.textContent;
        });
        const bloque = $("#cabinsReplenishment");
        if (!bloque || !estado.numero) return;
        const datos = api?.obtener(fecha, estado.numero);
        const contexto = `${fecha}:${estado.numero}`;
        const entradaSaco = bloque.querySelector("[data-saco-peso]");
        const destinoSaco = bloque.querySelector("[data-saco-destino]");
        if (contextoInsumos !== contexto) { edicionSaco = null; entradaSaco.value = ""; destinoSaco.value = ""; contextoInsumos = contexto; }
        for (const insumo of ["carbon"]) {
            const valor = datos?.[insumo];
            bloque.querySelector(`[data-insumo-cantidad=${insumo}]`).textContent = datos?.listo ? valor.cantidad : "—";
            bloque.querySelectorAll(`[data-insumo=${insumo}]`).forEach(boton => {
                boton.disabled = !datos?.listo || valor.guardando || (boton.dataset.insumoDelta === "-1" && !(valor.destinos[boton.dataset.insumoDestino] > 0));
            });
            bloque.querySelectorAll("[data-carbon-destino]").forEach(nodo => {
                nodo.textContent = datos?.listo ? valor.destinos[nodo.dataset.carbonDestino] : "—";
            });
            bloque.querySelector("[data-carbon-historico]").hidden = !datos?.listo || !valor.destinos.sin_especificar;
        }
        bloque.querySelector("[data-insumo-cantidad=lena]").textContent = datos?.listo ? lenaTexto(datos.lena.confirmada, datos.lena.pesoKg) : "—";
        const alta = datos?.lena.alta;
        entradaSaco.disabled = !datos?.listo || datos.lena.guardando || Boolean(alta);
        if (alta) entradaSaco.value = alta.pesoKg;
        destinoSaco.disabled = !datos?.listo || datos.lena.guardando || Boolean(alta && (alta.destino || alta.estado !== "reintentar"));
        if (alta?.destino) destinoSaco.value = alta.destino;
        const agregar = bloque.querySelector("[data-saco-agregar]");
        agregar.disabled = (!datos?.listo && !alta) || datos?.lena.guardando;
        agregar.textContent = alta?.estado === "verificando" ? "Verificando registro…" : alta?.estado === "incierto"
            ? "Verificar registro" : alta?.estado === "reintentar" ? "Reintentar saco" : "Agregar saco";
        const listaSacos = bloque.querySelector("[data-sacos-lena]");
        if (datos?.listo && edicionSaco && !datos.lena.sacos.some(saco => saco.id === edicionSaco.id)) edicionSaco = null;
        const listaHTML = (datos?.lena.sacos || []).map((saco, i) => {
            const deshabilitado = !datos.listo || datos.lena.guardando ? "disabled" : "";
            if (edicionSaco?.id === saco.id) return `<li><span>Saco ${i + 1}<small class="cb-sack-destination">${destinoTexto(saco.destino)}</small></span><div class="cb-sack-actions">
                <label class="cb-sack-edit">kg<input type="number" min="0" step="any" inputmode="decimal" data-saco-editar-peso
                    aria-label="Peso de saco ${i + 1} en kg" value="${escapar(edicionSaco.peso)}" ${deshabilitado}></label>
                <button type="button" class="cb-text-action" data-saco-guardar="${escapar(saco.id)}" ${deshabilitado}>Guardar</button>
                <button type="button" class="cb-text-action" data-saco-cancelar ${deshabilitado}>Cancelar</button></div></li>`;
            return `<li><span>Saco ${i + 1} · ${escapar(pesoTexto(saco.peso_kg))} kg<small class="cb-sack-destination">${destinoTexto(saco.destino)}</small></span><div class="cb-sack-actions">
                <button type="button" class="cb-text-action" data-saco-editar="${escapar(saco.id)}" ${deshabilitado}>Corregir</button>
                <button type="button" class="cb-text-action" data-saco-anular="${escapar(saco.id)}" ${deshabilitado}>Anular</button></div></li>`;
        }).join("");
        if (listaSacos.innerHTML !== listaHTML) {
            const enfocada = document.activeElement?.matches?.("[data-saco-editar-peso]");
            listaSacos.innerHTML = listaHTML;
            if (enfocada) listaSacos.querySelector("[data-saco-editar-peso]")?.focus();
        }
        bloque.setAttribute("aria-busy", String(Boolean(datos?.lena.guardando || datos?.carbon.guardando)));
        bloque.querySelector("[data-insumos-error]").textContent = alta?.estado === "verificando" ? "Verificando registro…"
            : datos?.error || datos?.lena.error || datos?.carbon.error || "";
        bloque.querySelector("[data-insumos-reintentar]").hidden = !datos?.error;
    }
    async function cambiarInsumo(boton) {
        if (boton.disabled || !estado.numero || estado.fecha !== fechaActual()) return;
        try {
            await window.HAIKU_INSUMOS_ASEO_V1?.cambiar(fechaActual(), estado.numero,
                boton.dataset.insumo, Number(boton.dataset.insumoDelta), boton.dataset.insumoDestino);
        } catch (error) {
            console.error("HAIKU · No fue posible confirmar la reposición:", error);
        }
    }
    async function cambiarSaco(boton) {
        if (boton.disabled || !estado.numero || estado.fecha !== fechaActual()) return;
        const entrada = $("#cabinsReplenishment [data-saco-peso]");
        const destino = $("#cabinsReplenishment [data-saco-destino]");
        const fecha = fechaActual(), numero = estado.numero;
        try {
            if (boton.dataset.sacoAnular) {
                await window.HAIKU_INSUMOS_ASEO_V1.anularSaco(fecha, numero, boton.dataset.sacoAnular);
            } else {
                entrada.setCustomValidity(Number(entrada.value) > 0 ? "" : "Ingresa un peso mayor que cero.");
                if (!entrada.reportValidity()) return;
                if (!destino.disabled && !destino.reportValidity()) return;
                const resultado = await window.HAIKU_INSUMOS_ASEO_V1.agregarSaco(fecha, numero, entrada.value, destino.value);
                if (resultado && fecha === fechaActual() && numero === estado.numero) entrada.value = "";
            }
        } catch (error) {
            console.error("HAIKU · No fue posible confirmar el saco:", error);
        }
    }
    async function corregirSaco(boton) {
        if (boton.disabled || !estado.numero || estado.fecha !== fechaActual()) return;
        const api = window.HAIKU_INSUMOS_ASEO_V1, fecha = fechaActual(), numero = estado.numero;
        if (boton.dataset.sacoCancelar !== undefined) { edicionSaco = null; pintarInsumos(fecha); return; }
        if (boton.dataset.sacoEditar) {
            const saco = api.obtener(fecha, numero).lena.sacos.find(s => s.id === boton.dataset.sacoEditar);
            if (!saco) return;
            edicionSaco = { id: saco.id, peso: String(saco.peso_kg), version: saco.version };
            pintarInsumos(fecha);
            $("#cabinsReplenishment [data-saco-editar-peso]")?.focus();
            return;
        }
        const edicion = edicionSaco, entrada = $("#cabinsReplenishment [data-saco-editar-peso]");
        if (!edicion || !entrada) return;
        entrada.setCustomValidity(Number(entrada.value) > 0 ? "" : "Ingresa un peso mayor que cero.");
        if (!entrada.reportValidity()) return;
        try {
            await api.editarSaco(fecha, numero, edicion.id, entrada.value, edicion.version);
            if (edicionSaco === edicion) edicionSaco = null;
        } catch (error) {
            await api.hidratar(fecha);
            if (edicionSaco === edicion) {
                const actual = api.obtener(fecha, numero).lena.sacos.find(s => s.id === edicion.id);
                edicionSaco = actual ? { id: actual.id, peso: String(actual.peso_kg), version: actual.version } : null;
            }
            console.error("HAIKU · No fue posible corregir el peso:", error);
        }
        if (fecha === fechaActual() && numero === estado.numero) pintarInsumos(fecha);
    }
    function destinosPorCabana(fecha, insumo) {
        const filas = [];
        for (let numero = 1; numero <= 11; numero++) {
            const dato = window.HAIKU_INSUMOS_ASEO_V1?.obtener?.(fecha, numero);
            if (!dato?.listo) continue;
            const valor = dato[insumo];
            if (!valor?.confirmada) continue;
            for (const destino of Object.keys(destinosInsumos)) {
                const cantidad = Number((valor.destinosConfirmados || valor.destinos)?.[destino] || 0);
                if (!(cantidad > 0)) continue;
                const sacos = insumo === "lena" ? (valor.sacos || []).filter(s => (s.destino || "sin_especificar") === destino) : [];
                const peso = insumo === "lena" && sacos.length === cantidad ? sacos.reduce((suma, s) => suma + Number(s.peso_kg || 0), 0) : null;
                filas.push({ numero, destino, cantidad, peso });
            }
        }
        return filas;
    }
    function filtro(fech, numero) {
        return gruposCabanas(fech)[estado.filtro]?.includes(numero) || false;
    }
    function pintarFiltros(fecha) {
        const grupos = gruposCabanas(fecha);
        $("#cabinsFilters").innerHTML = [["todas", "Todas", grupos.todas.length], ["pendientes", "Pendientes", grupos.pendientes.length], ["en_curso", "En curso", grupos.en_curso.length], ["por_revisar", "Por revisar", grupos.por_revisar.length], ["listas", "Listas", grupos.listas.length]]
            .map(([clave, texto, cantidad]) => `<button type="button" data-cb-filter="${clave}" aria-pressed="${estado.filtro === clave}">${texto} · ${cantidad}</button>`).join("");
    }
    function selectorRevisionHTML(fecha, numero, dato) {
        const actual = revision(dato, fecha, numero);
        const guardando = revisionesGuardando.has(`${fecha}:${numero}`);
        return `<label class="cb-badge cb-revision-picker ${tono(actual)}" title="${guardando ? "Guardando revisión…" : "Cambiar estado de revisión"}">
          <span data-cb-revision-state>${REVISIONES[actual]}</span><span class="cb-revision-chevron cb-chevron" aria-hidden="true"></span>
          <select data-cb-revision-select="${numero}" data-cb-revision-fecha="${escapar(fecha)}" aria-label="Estado de revisión de cabaña ${numero}"${guardando ? ' disabled aria-busy="true"' : ""}>
            ${Object.entries(REVISIONES).map(([valor, texto]) => `<option value="${valor}"${valor === actual ? " selected" : ""}>${texto}</option>`).join("")}
          </select></label>`;
    }
    function filaOperacion(fecha, numero) {
        const dato = cabana(fecha, numero);
        const final = estadoFinal(dato, fecha, numero);
        const solicitudes = listaSolicitudes(fecha, numero, dato);
        const pendiente = [...solicitudes.expresas, ...solicitudes.operativas].join(" · ");
        return `<article class="cb-operation-row aseo-resumen-cabana" data-cb-cabin="${numero}" data-aseo-express-cabana="${numero}" role="listitem">
          <div class="cb-cabin"><strong>Cabaña ${numero}</strong><span title="${escapar(titular(dato, fecha, numero))}">${escapar(titular(dato, fecha, numero))}</span><small class="cb-work-supplies" title="${escapar([trabajo(dato), textoInsumos(fecha, numero)].filter(Boolean).join(" · "))}">${escapar(trabajo(dato))}<span data-cb-insumos="${numero}">${textoInsumos(fecha, numero) ? ` · ${textoInsumos(fecha, numero)}` : ""}</span></small>${pendiente ? `<div class="cb-pending" title="${escapar(pendiente)}">${solicitudesHTML(fecha, numero, dato)}</div>` : ""}</div>
          <label class="cb-cell"><span>Encargado</span><input type="text" class="aseo-encargado-input" data-aseo-encargado="${numero}" value="${escapar(dato.aseo || "")}" placeholder="Sin asignar" list="cabinsStaff" aria-label="Encargado de cabaña ${numero}"></label>
          <label class="cb-cell"><span>Revisor</span><input type="text" class="aseo-revision-input" data-revision-cabana="${numero}" value="${escapar(dato.revisionAseo || "")}" placeholder="Sin asignar" list="cabinsStaff" aria-label="Revisor de cabaña ${numero}"></label>
          <label class="cb-cell"><span>IN</span><input type="time" class="aseo-hora-input" data-aseo-hora="aseoIn" data-cabana="${numero}" value="${escapar(dato.aseoIn || "")}" aria-label="Hora IN de cabaña ${numero}"></label>
          <label class="cb-cell"><span>OUT</span><input type="time" class="aseo-hora-input" data-aseo-hora="aseoOut" data-cabana="${numero}" value="${escapar(dato.aseoOut || "")}"${!dato.aseoIn && !dato.aseoOut ? " disabled" : ""} aria-label="Hora OUT de cabaña ${numero}"></label>
          <div class="cb-state cb-status cb-aseo-status" aria-live="polite"><small>Estado aseo</small>${aseoHTML(dato, numero)}</div>
          <div class="cb-state cb-status cb-revision-status" aria-live="polite"><small>Estado revisión</small>${selectorRevisionHTML(fecha, numero, dato)}</div>
          <div class="cb-state cb-status cb-final-status" aria-live="polite"><small>Estado final</small><span class="cb-badge ${tono(final)}" data-cb-final-state>${FINALES[final]}</span></div>
          <button type="button" class="cb-open" data-cb-open="${numero}" aria-label="Abrir ficha de cabaña ${numero}">Abrir <span aria-hidden="true">›</span></button>
        </article>`;
    }
    function tiempoTranscurrido(fecha, hora, ahora = Date.now()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return "—";
        const [ano, mes, dia] = fecha.split("-").map(Number), [h, m] = hora.split(":").map(Number);
        if (h > 23 || m > 59) return "—";
        const deseado = Date.UTC(ano, mes - 1, dia, h, m);
        let inicio = deseado;
        const formateador = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
        const pared = instante => {
            const p = Object.fromEntries(formateador.formatToParts(new Date(instante)).map(x => [x.type, x.value]));
            return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
        };
        for (let i = 0; i < 3; i++) inicio += deseado - pared(inicio);
        if (pared(inicio) !== deseado) return "—";
        const minutos = Math.max(0, Math.floor((ahora - inicio) / 60000));
        return minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
    }
    function filaSeguimiento(fecha, numero) {
        const dato = cabana(fecha, numero), nombre = String(dato.aseo || "").trim() || "Sin asignar";
        return `<article class="cb-tracking-row" data-cb-cabin="${numero}" role="listitem"><strong>Cabaña ${numero}</strong><span class="cb-tracking-person"><span class="cb-tracking-avatar" aria-hidden="true">${escapar(Array.from(nombre)[0])}</span>${escapar(nombre)}</span><span class="cb-tracking-type">${expressReal(dato, fecha, numero) ? "Aseo Exprés" : "Aseo Full"}</span><span class="cb-tracking-in" data-label="IN">${escapar(dato.aseoIn)}</span><span class="cb-tracking-out" data-label="OUT">—</span><strong class="cb-tracking-time" data-label="Tiempo" data-cb-elapsed data-cb-day="${escapar(fecha)}" data-cb-in="${escapar(dato.aseoIn)}">${tiempoTranscurrido(fecha, dato.aseoIn)}</strong><span class="cb-badge progress">En curso</span><button type="button" class="cb-open" data-cb-open="${numero}">Abrir cabaña</button></article>`;
    }
    function actualizarTiempos() {
        raiz.querySelectorAll("[data-cb-elapsed]").forEach(n => {
            n.textContent = tiempoTranscurrido(n.dataset.cbDay, n.dataset.cbIn);
        });
    }
    if (typeof setInterval === "function") setInterval(actualizarTiempos, 60000);
    document.addEventListener("visibilitychange", actualizarTiempos);
    function pintarOperacion(fecha) {
        if (!fecha) return;
        const enfocado = document.activeElement;
        if (enfocado && $("#aseo-resumen")?.contains(enfocado) && enfocado.matches?.("input, select, textarea")) return;
        const numeros = Array.from({ length: 11 }, (_, i) => i + 1).filter(numero => filtro(fecha, numero));
        const seguimiento = estado.filtro === "en_curso";
        const titulo = $("#cabinsOperation h2");
        if (titulo) titulo.textContent = seguimiento ? "Seguimiento de camareros" : "Operación de hoy";
        $("#cabinsOperationDescription").textContent = seguimiento
            ? `${numeros.length} cabañas en curso · ${new Set(numeros.map(n => String(cabana(fecha, n).aseo || "").trim().toLocaleLowerCase("es-CL")).filter(Boolean)).size} camareros trabajando`
            : `Asignación, horarios y coordinación del turno · ${numeros.length} cabañas visibles`;
        if (seguimiento) {
            $("#aseo-resumen").innerHTML = `<div class="cb-tracking-head" aria-hidden="true"><span>Cabaña</span><span>Camarero</span><span>Tipo de aseo</span><span>IN</span><span>OUT</span><span>Tiempo</span><span>Estado</span><span></span></div>${numeros.map(n => filaSeguimiento(fecha, n)).join("") || '<p class="cb-empty">No hay cabañas en curso.</p>'}`;
            return;
        }
        $("#aseo-resumen").innerHTML = `<div class="cb-operation-head" aria-hidden="true"><span>Cabaña / trabajo</span><span>Encargado</span><span>Revisor</span><span>IN</span><span>OUT</span><span>Estado aseo</span><span>Estado revisión</span><span>Estado final</span><span>Abrir</span></div>${numeros.map(n => filaOperacion(fecha, n)).join("") || '<p class="cb-empty">No hay cabañas con este filtro.</p>'}`;
    }
    function totalChecklist(numero) {
        try {
            const config = typeof checklistsCabanas !== "undefined" ? checklistsCabanas?.[numero] : null;
            return (config || []).reduce((total, area) => total + (area.items?.length || 0)
                + (area.subareas || []).reduce((suma, sub) => suma + (sub.items?.length || 0), 0), 0);
        } catch (_) { return 0; }
    }
    function revisadosChecklist(dato) { return Object.values(dato?.checklist || {}).filter(Boolean).length; }
    function filaRevision(fecha, numero) {
        const dato = cabana(fecha, numero);
        const aseo = estadoAseo(dato);
        const tipo = expressReal(dato, fecha, numero) ? "Revisión completa / Aseo Express" : "Revisión completa";
        return `<article class="cb-review-row" data-cb-review-cabana="${numero}" role="listitem"><div class="cb-review-ident"><strong>Cabaña ${numero}</strong><span>${escapar(titular(dato, fecha, numero))}</span></div><div class="cb-review-clean"><small>Aseo</small><span class="cb-badge ${tono(aseo)}">${etiqueta(aseo)}</span></div><div class="cb-review-mode"><small>Tipo de revisión</small><span>${tipo}</span></div><div class="cb-review-progress"><small>Checklist</small><strong>${revisadosChecklist(dato)}/${totalChecklist(numero)}</strong> <span>elementos</span></div><div class="cb-review-status"><small>Revisión</small>${selectorRevisionHTML(fecha, numero, dato)}</div><button type="button" class="cb-open" data-cb-open="${numero}" data-cb-origin="review">Abrir revisión <span aria-hidden="true">›</span></button></article>`;
    }
    function pintarRevision(fecha) {
        if (!fecha) return;
        const numeros = Array.from({ length: 11 }, (_, i) => i + 1).filter(numero => filtro(fecha, numero));
        $(".lista-revision-cabanas").innerHTML = `<div class="cb-review-head" aria-hidden="true"><span>Cabaña / huésped</span><span>Aseo</span><span>Tipo de revisión</span><span>Checklist</span><span>Estado revisión</span><span></span></div>${numeros.map(n => filaRevision(fecha, n)).join("") || '<p class="cb-empty">No hay cabañas con este filtro.</p>'}`;
    }
    function pintarPersonal(fecha) {
        const nombres = new Set();
        for (let numero = 1; numero <= 11; numero++) {
            const dato = cabana(fecha, numero);
            [dato.aseo, dato.revisionAseo].forEach(nombre => { if (String(nombre || "").trim()) nombres.add(String(nombre).trim()); });
        }
        $("#cabinsStaff").innerHTML = [...nombres].sort((a, b) => a.localeCompare(b, "es"))
            .map(nombre => `<option value="${escapar(nombre)}"></option>`).join("");
    }
    function pintarDetalle(fecha = fechaActual()) {
        if (!estado.numero || !fecha) return;
        const numero = estado.numero;
        const dato = cabana(fecha, numero);
        const aseo = estadoAseo(dato);
        const final = estadoFinal(dato, fecha, numero);
        const hayExpress = expressReal(dato, fecha, numero);
        const ciclo = cicloExpress(dato, fecha, numero);
        $("#revision-titulo").textContent = `Cabaña ${numero}`;
        $("#cabinsDetailSubtitle").textContent = `${titular(dato, fecha, numero)} · ${trabajo(dato)}`;
        $("#cabinsDetailDate").textContent = `Operación · ${fecha}`;
        for (const [selector, valor] of [["#cabinsDetailCleaner", dato.aseo],
            ["#cabinsDetailReviewer", dato.revisionAseo], ["#cabinsDetailIn", dato.aseoIn],
            ["#cabinsDetailOut", dato.aseoOut]]) {
            const campo = $(selector);
            if (document.activeElement !== campo) campo.value = valor || "";
        }
        for (const selector of ["#cabinsDetailCleaner", "#cabinsDetailReviewer", "#cabinsDetailIn", "#cabinsDetailOut", "#cabinsDetailAseo"]) {
            const campo = $(selector);
            if (campo?.dataset.aseoEncargado !== undefined) campo.dataset.aseoEncargado = numero;
            if (campo?.dataset.revisionCabana !== undefined) campo.dataset.revisionCabana = numero;
            if (campo?.dataset.cabana !== undefined) campo.dataset.cabana = numero;
        }
        $("#cabinsDetailAseo").innerHTML = aseoHTML(dato, numero);
        $("#cabinsDetailOut").disabled = !dato.aseoIn && !dato.aseoOut;
        $("#cabinsDetailRequests").innerHTML = solicitudesHTML(fecha, numero, dato, true, true) || "<p>Sin solicitudes registradas.</p>";
        $("#cabinsAseoProgress").textContent = etiqueta(aseo);
        $("#cabinsRevisionProgress").textContent = REVISIONES[revision(dato, fecha, numero)];
        $("#cabinsFinalProgress").textContent = FINALES[final];
        $("#cabinsFinalBadge").textContent = $("#cabinsFinalProgress").textContent;
        for (const [id, valor] of [["#cabinsAseoDot", aseo], ["#cabinsRevisionDot", revision(dato, fecha, numero)], ["#cabinsFinalDot", final]]) {
            const punto = $(id); punto.className = `cb-stage-dot ${tono(valor)}`;
        }
        $("#cabinsFinalBadge").className = `cb-badge ${tono(final)}`;
        $("#cabinsFinalStateDisplay").textContent = FINALES[final];
        $("#cabinsExpressFinalStateDisplay").textContent = FINALES[final];
        $("#cabinsExpressAvailability").textContent = aperturaExpress ? "Verificando…" : hayExpress ? "Solicitado"
            : ciclo?.fecha === fecha && ciclo.verificado === true
                ? "No solicitado" : "No verificado";
        const modoExpress = $("#cabinsReviewMode").querySelector('option[value="aseo_express"]');
        if (modoExpress) modoExpress.disabled = !hayExpress;
        $("#volver-cabanas").textContent = `‹ Volver a ${estado.origen === "review" ? "Revisión de cabañas" : "Operación de hoy"}`;
        pintarInsumos(fecha);
        actualizarConteos();
    }
    function actualizarConteos() {
        const checks = [...raiz.querySelectorAll("#revision-checklist [data-checklist-id]")];
        $("#cabinsChecklistCount").textContent = `${checks.filter(check => check.checked).length}/${checks.length}`;
        const express = [...raiz.querySelectorAll("#aseo-express-checklist [data-aseo-express-item]")];
        $("#cabinsExpressCount").textContent = `${express.filter(check => check.checked).length}/${express.length}`;
        for (const area of raiz.querySelectorAll("#revision-checklist .checklist-area, #aseo-express-checklist .revision-area")) {
            const etiqueta = area.querySelector(".cb-sector-head small");
            if (!etiqueta) continue;
            const items = [...area.querySelectorAll('input[type="checkbox"]')];
            etiqueta.textContent = `${items.filter(item => item.checked).length}/${items.length} revisados`;
        }
    }
    function decorarChecklist() {
        for (const area of raiz.querySelectorAll("#revision-checklist .checklist-area, #aseo-express-checklist .revision-area")) {
            if (area.dataset.cbDecorated === "1") continue;
            area.dataset.cbDecorated = "1";
            area.classList.add("cb-sector");
            const titulo = area.querySelector("h4");
            if (!titulo) continue;
            titulo.hidden = true;
            const cuerpo = document.createElement("div");
            cuerpo.className = "cb-sector-body";
            while (titulo.nextSibling) cuerpo.appendChild(titulo.nextSibling);
            area.appendChild(cuerpo);
            const cabecera = document.createElement("button");
            cabecera.type = "button";
            cabecera.className = "cb-sector-head";
            const abiertos = area.parentElement?.id === "aseo-express-checklist" || area === area.parentElement?.firstElementChild;
            cabecera.setAttribute("aria-expanded", String(abiertos));
            cabecera.innerHTML = `<span><strong>${escapar(titulo.textContent)}</strong><small>0/0 revisados</small></span><span aria-hidden="true">${abiertos ? "−" : "+"}</span>`;
            area.insertBefore(cabecera, titulo);
            cuerpo.hidden = !abiertos;
            area.querySelectorAll(".checklist-items").forEach(lista => lista.classList.add("cb-group"));
            area.querySelectorAll(".checklist-item").forEach(item => item.classList.add("cb-check"));
            area.querySelectorAll("h5").forEach(sub => sub.classList.add("cb-group-name"));
        }
        actualizarConteos();
    }
    function aplicarVista() {
        const detalle = Boolean(estado.numero);
        const dato = detalle ? cabana(fechaActual(), estado.numero) : null;
        const hayExpress = detalle && expressReal(dato, fechaActual(), estado.numero);
        if (detalle && estado.modo === "aseo_express" && !hayExpress) {
            estado.modo = "completa";
            localStorage.removeItem("haikuAseoExpressCabana");
            window.abrirRevisionCabana?.(estado.numero);
        }
        $("#cabinsTabs").hidden = detalle;
        $("#cabinsList").hidden = detalle;
        $("#cabinsDetail").hidden = !detalle;
        $("#cabinsIntro").textContent = detalle ? "Aseo, revisión y cierre de la cabaña seleccionada." : "Aseo, revisión y estado final en un solo lugar.";
        $("#cabinsOperation").hidden = estado.tab !== "operation";
        $("#cabinsReview").hidden = estado.tab !== "review";
        raiz.querySelectorAll("[data-cab-tab]").forEach(boton => {
            const activo = boton.dataset.cabTab === estado.tab;
            boton.classList.toggle("active", activo);
            boton.setAttribute("aria-current", activo ? "page" : "false");
        });
        $("#revision-individual").classList.toggle("activa", detalle && estado.modo === "completa");
        const expressAbierto = detalle && hayExpress && estado.modo === "aseo_express";
        $("#aseo-express-individual").classList.toggle("activa", expressAbierto);
        $("#cabinsExpressToggle").setAttribute("aria-expanded", String(expressAbierto));
        $("#cabinsExpressToggle").setAttribute("aria-disabled", String(!hayExpress || Boolean(aperturaExpress)));
        $("#cabinsExpressToggleIcon").textContent = expressAbierto ? "−" : "+";
        $("#cabinsReviewMode").value = estado.modo;
        $("#cabinsReviewMode").disabled = Boolean(aperturaExpress);
        $("#cabinsReviewMode").setAttribute("aria-busy", String(Boolean(aperturaExpress)));
    }
    function pintar(fecha = fechaActual()) {
        if (!fecha) return;
        if (estado.numero && estado.fecha && estado.fecha !== fecha) {
            aperturaExpress = null;
            // Los checkboxes existentes cierran sobre la fecha en que se abrió
            // la ficha. Salir antes de mostrar otra fecha evita editar ese día.
            estado.numero = "";
            estado.modo = "completa";
            localStorage.removeItem("haikuRevisionCabana");
            localStorage.removeItem("haikuAseoExpressCabana");
            $("#cabinsList").style.display = "";
            $(".lista-revision-cabanas").style.display = "";
            $("#revision-individual").classList.remove("activa");
            $("#aseo-express-individual").classList.remove("activa");
            if (revisionPendiente) {
                revisionPendiente = null;
                estado.tab = "operation";
                estado.origen = "operation";
                mostrarContexto();
            }
            guardarContexto();
        }
        estado.fecha = fecha;
        $("#cabinsDate").textContent = fechaLarga(fecha);
        pintarPersonal(fecha); resumen(fecha); pintarFiltros(fecha);
        pintarOperacion(fecha); pintarRevision(fecha);
        pintarInsumos(fecha);
        window.HAIKU_INSUMOS_ASEO_V1?.hidratar(fecha, { forzar: false });
        if (estado.numero) pintarDetalle(fecha);
        aplicarVista();
    }
    function abrir(numero, origen = estado.tab, modo = "completa", opciones = {}) {
        if (!numeroValido(numero)) return;
        if (!opciones.restaurando) {
            const prefijo = `${usuarioActual()}:${fechaActual()}:${numero}:`;
            for (const clave of expressAutomaticos) if (clave.startsWith(prefijo)) expressAutomaticos.delete(clave);
        }
        aperturaExpress = null;
        if (modo === "aseo_express" && !expressReal(cabana(fechaActual(), numero), fechaActual(), numero)) modo = "completa";
        estado.numero = String(numero);
        estado.origen = origen;
        estado.modo = "completa";
        estado.fecha = fechaActual();
        localStorage.removeItem(modo === "aseo_express" ? "haikuRevisionCabana" : "haikuAseoExpressCabana");
        if (modo === "aseo_express") {
            localStorage.removeItem("haikuAseoExpressCabana");
            const apertura = cambiarModo(modo);
            if (!opciones.restaurando) raiz.scrollIntoView({ block: "start" });
            return apertura;
        } else {
            window.abrirRevisionCabana?.(numero);
            window.HAIKU_CABANAS_FOTOS_V1?.aplicar?.(numero);
        }
        decorarChecklist();
        pintarDetalle(); aplicarVista();
        guardarContexto();
        seleccionarExpressAutomatico();
        if (!opciones.restaurando) raiz.scrollIntoView({ block: "start" });
    }
    function cerrar() {
        aperturaExpress = null;
        if (estado.modo === "aseo_express") $("#volver-aseo")?.click();
        estado.numero = "";
        estado.modo = "completa";
        estado.tab = estado.origen;
        localStorage.removeItem("haikuRevisionCabana");
        localStorage.removeItem("haikuAseoExpressCabana");
        $("#cabinsList").style.display = "";
        $(".lista-revision-cabanas").style.display = "";
        $("#revision-individual").classList.remove("activa");
        $("#aseo-express-individual").classList.remove("activa");
        pintar();
        guardarContexto();
    }
    async function cambiarEstadoRevision(control) {
        const numero = String(control.dataset.cbRevisionSelect || "");
        const fecha = String(control.dataset.cbRevisionFecha || "");
        const dato = cabana(fecha, numero);
        const previo = revision(dato, fecha, numero);
        const nuevo = control.value;
        const clave = `${fecha}:${numero}`;
        if (!numeroValido(numero) || fecha !== fechaActual() ||
            !Object.hasOwn(REVISIONES, nuevo) || revisionesGuardando.has(clave)) {
            control.value = previo;
            return;
        }
        if (nuevo === previo) return;
        const guardar = expressReal(dato, fecha, numero)
            ? window.HAIKU_ASEO_OPERACION_V1?.guardarEstadoRevisionExpress
            : window.HAIKU_REVISION_SUPABASE_V1?.guardarEstadoRevision;
        if (!guardar) {
            control.value = previo;
            alert("No fue posible guardar la revisión. Vuelve a intentarlo.");
            return;
        }
        revisionesGuardando.add(clave);
        control.disabled = true;
        try {
            await guardar(numero, nuevo, fecha);
        } catch (error) {
            control.value = previo;
            console.error("HAKU · No fue posible cambiar la revisión:", error);
            alert("No fue posible guardar el estado de revisión. Se conservó el estado anterior.");
        } finally {
            revisionesGuardando.delete(clave);
            control.disabled = false;
            pintar();
        }
    }
    async function cambiarEstadoAseo(control) {
        const numero = String(control.dataset.cabana || "");
        const fecha = fechaActual();
        const dato = cabana(fecha, numero);
        const previo = estadoAseo(dato);
        if (control.disabled) return;
        const nuevo = previo === "no_requiere" ? "pendiente" : "no_requiere";
        const api = window.HAIKU_ASEO_OPERACION_V1;
        if (!api?.guardarEstadoAseo) { alert("No fue posible verificar la autoridad de Aseo. Intenta nuevamente."); return; }
        if (dato.aseoIn || dato.aseoOut) {
            alert("La cabaña ya tiene horas de aseo registradas. Revisa IN/OUT antes de cambiar No requiere."); return;
        }
        control.disabled = true;
        try {
            await api.guardarEstadoAseo(numero, nuevo);
            pintar();
        } catch (error) {
            console.error("HAIKU · No fue posible cambiar el estado de aseo:", error);
            await api.hidratar?.(fecha, { pintar: true });
            alert("No fue posible guardar el estado de aseo. Se releyeron los datos.");
        } finally { control.disabled = false; }
    }
    function cambiarModo(modo) {
        if (!estado.numero || !["completa", "aseo_express"].includes(modo)) return;
        const numero = estado.numero;
        if (modo === "completa") {
            aperturaExpress = null;
            localStorage.removeItem("haikuAseoExpressCabana");
            $("#volver-aseo")?.click();
            window.abrirRevisionCabana?.(numero);
            window.HAIKU_CABANAS_FOTOS_V1?.aplicar?.(numero);
            estado.modo = modo;
            decorarChecklist(); pintarDetalle(); aplicarVista(); guardarContexto();
            return;
        }
        if (aperturaExpress) { aplicarVista(); return aperturaExpress.promesa; }
        const fecha = fechaActual();
        if (!expressReal(cabana(fecha, numero), fecha, numero) ||
            typeof window.abrirRevisionAseoExpress !== "function") {
            aplicarVista();
            return false;
        }
        const pendiente = { numero, fecha, usuarioId: usuarioActual() };
        aperturaExpress = pendiente;
        const vigente = () => aperturaExpress === pendiente && estado.numero === numero &&
            fechaActual() === fecha && usuarioActual() === pendiente.usuarioId;
        const liberar = () => {
            if (aperturaExpress !== pendiente) return;
            aperturaExpress = null;
            pintarDetalle(); aplicarVista(); guardarContexto();
        };
        const confirmar = resultado => {
            try {
                if (!vigente() || resultado === false || !expressReal(cabana(fecha, numero), fecha, numero)) return false;
                localStorage.removeItem("haikuRevisionCabana");
                estado.modo = "aseo_express";
                window.HAIKU_CABANAS_FOTOS_V1?.aplicarAseo?.(numero);
                decorarChecklist();
                return true;
            } finally { liberar(); }
        };
        const fallar = error => {
            if (vigente()) {
                console.error("HAIKU · No fue posible abrir Aseo Express:", error);
                alert("No fue posible verificar Aseo Express. Intenta nuevamente.");
            }
            liberar();
            return false;
        };
        pintarDetalle(); aplicarVista();
        try {
            const resultado = window.abrirRevisionAseoExpress(numero, { puedeAbrir: vigente });
            if (resultado && typeof resultado.then === "function") {
                pendiente.promesa = Promise.resolve(resultado).then(confirmar).catch(fallar);
                return pendiente.promesa;
            }
            return confirmar(resultado);
        } catch (error) { return fallar(error); }
    }
    function volverOperacionRestaurada() {
        aperturaExpress = null;
        revisionPendiente = null;
        estado.tab = "operation";
        estado.origen = "operation";
        estado.numero = "";
        estado.modo = "completa";
        estado.fecha = fechaActual();
        localStorage.removeItem("haikuRevisionCabana");
        localStorage.removeItem("haikuAseoExpressCabana");
        $("#cabinsList").style.display = "";
        $(".lista-revision-cabanas").style.display = "";
        pintar();
        guardarContexto();
        mostrarContexto();
    }
    function confirmarRevisionRestaurada() {
        const pendiente = revisionPendiente;
        if (!pendiente) return false;
        if (pendiente.fecha !== fechaActual() ||
            (estado.numero && estado.numero !== pendiente.numero)) {
            volverOperacionRestaurada();
            return true;
        }
        if (pendiente.modo === "aseo_express") {
            if (!window.HAIKU_ASEO_OPERACION_V1) return false;
            const ciclo = cicloExpress(cabana(pendiente.fecha, pendiente.numero), pendiente.fecha, pendiente.numero);
            if (ciclo?.fecha !== pendiente.fecha || ciclo.verificado !== true) return false;
            if (!ciclo.existe ||
                (pendiente.revisionId && String(ciclo.revisionId || "") !== pendiente.revisionId)) {
                volverOperacionRestaurada();
                return true;
            }
            revisionPendiente = null;
            abrir(pendiente.numero, estado.origen, "aseo_express", { restaurando: true });
            pintar(); guardarContexto(); mostrarContexto();
            return true;
        }
        if (!window.HAIKU_REVISION_SUPABASE_V1) return false;
        if (!estado.numero) {
            abrir(pendiente.numero, estado.origen, "completa", { restaurando: true });
            pintar();
        }
        const ciclo = cabana(pendiente.fecha, pendiente.numero)?.revisionCompletaCiclo;
        if (ciclo?.fecha !== pendiente.fecha || ciclo.verificado !== true) return false;
        if (pendiente.revisionId && String(ciclo.id || "") !== pendiente.revisionId) {
            volverOperacionRestaurada();
            return true;
        }
        revisionPendiente = null;
        pintar();
        guardarContexto();
        mostrarContexto();
        return true;
    }
    function restaurarContexto() {
        const usuarioId = usuarioActual();
        if (!usuarioId || usuarioRestaurado === usuarioId) return;
        usuarioRestaurado = usuarioId;
        const contexto = leerContexto();
        restaurando = true;
        revisionPendiente = null;
        aperturaExpress = null;
        // Estas llaves identifican el writer legacy; nunca autorizan por sí
        // solas a reabrir una ficha después de F5.
        localStorage.removeItem("haikuRevisionCabana");
        localStorage.removeItem("haikuAseoExpressCabana");
        estado.fecha = fechaActual();
        estado.tab = contexto?.tab || "operation";
        estado.origen = contexto?.origen || "operation";
        estado.numero = "";
        estado.modo = "completa";
        if (contexto?.numero) {
            revisionPendiente = {
                fecha: contexto.fecha, numero: String(contexto.numero),
                revisionId: String(contexto.revisionId || ""), modo: contexto.modo
            };
            if (contexto.modo === "completa" && window.HAIKU_REVISION_SUPABASE_V1) {
                abrir(contexto.numero, contexto.origen, "completa", { restaurando: true });
            }
        }
        pintar();
        restaurando = false;
        if (!revisionPendiente) { guardarContexto(); mostrarContexto(); return; }
        if (confirmarRevisionRestaurada()) return;
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                if (revisionPendiente) confirmarRevisionRestaurada();
            }, { once: true });
        }
        const pendiente = revisionPendiente;
        // Sólo protege el arranque ante una lectura fallida; no retrasa una
        // revisión que ya quedó verificada por la autoridad existente.
        setTimeout(() => {
            if (revisionPendiente === pendiente) volverOperacionRestaurada();
        }, 15000);
    }
    raiz.addEventListener("click", evento => {
        const boton = evento.target.closest("button");
        if (!boton) return;
        if (boton.dataset.sacoEditar || boton.dataset.sacoGuardar || boton.dataset.sacoCancelar !== undefined) { corregirSaco(boton); return; }
        if (boton.dataset.sacoAgregar !== undefined || boton.dataset.sacoAnular) { cambiarSaco(boton); return; }
        if (boton.dataset.insumoDelta) { cambiarInsumo(boton); return; }
        if (boton.dataset.insumosReintentar !== undefined) { window.HAIKU_INSUMOS_ASEO_V1?.hidratar(fechaActual()); return; }
        if (boton.dataset.cbNoRequiere !== undefined) { cambiarEstadoAseo(boton); return; }
        if (boton.dataset.cabTab) { estado.tab = boton.dataset.cabTab; estado.filtro = "todas"; pintar(); guardarContexto(); return; }
        if (boton.dataset.cbFilter) { estado.filtro = boton.dataset.cbFilter; pintar(); return; }
        if (boton.dataset.cbOpen) { abrir(boton.dataset.cbOpen, boton.dataset.cbOrigin || estado.tab); return; }
        if (boton.id === "volver-cabanas") { cerrar(); return; }
        if (boton.id === "cabinsExpressToggle") {
            if (!aperturaExpress && expressReal(cabana(fechaActual(), estado.numero), fechaActual(), estado.numero)) {
                return cambiarModo(estado.modo === "aseo_express" ? "completa" : "aseo_express");
            }
            return;
        }
        if (boton.id === "cabinsDetailAddRequest") { abrirSolicitud(estado.numero); return; }
        if (boton.id === "agregar-solicita") { abrirSolicitud(); return; }
        if (boton.dataset.cbRequestEdit) {
            const numero = boton.dataset.cbRequestEdit;
            const solicitud = cabana(fechaActual(), numero).solicitudesTipos?.find(item => item.categoria === boton.dataset.cbRequestCategory);
            if (solicitud) abrirSolicitud(numero, solicitud);
            return;
        }
        if (boton.dataset.cbRequestCancel) { cancelarSolicitudTipo(boton.dataset.cbRequestCancel, boton.dataset.cbRequestCategory); return; }
        if (boton.dataset.eliminarSolicita) {
            const dato = cabana(fechaActual(), boton.dataset.eliminarSolicita);
            dato.solicitudAseoExpress = "";
            if (typeof guardarDatos === "function") guardarDatos();
            setTimeout(() => pintar(), 0);
            return;
        }
        if (boton.classList.contains("cb-sector-head")) {
            const cuerpo = boton.parentElement.querySelector(".cb-sector-body");
            cuerpo.hidden = !cuerpo.hidden;
            boton.setAttribute("aria-expanded", String(!cuerpo.hidden));
            boton.lastElementChild.textContent = cuerpo.hidden ? "+" : "−";
        }
    });
    $("#panel-agregar-solicita")?.addEventListener("click", evento => {
        if (!evento.target.closest?.("#guardar-solicita")) return;
        evento.preventDefault(); evento.stopImmediatePropagation();
        void guardarSolicitudDesdeFormulario();
    }, true);
    raiz.addEventListener("input", evento => {
        if (evento.target.matches("[data-saco-editar-peso]") && edicionSaco) edicionSaco.peso = evento.target.value;
        if (evento.target.matches("[data-saco-editar-peso], [data-saco-peso]")) evento.target.setCustomValidity("");
    });
    raiz.addEventListener("keydown", evento => {
        if (evento.key !== "Enter" || !evento.target.matches("[data-saco-editar-peso], [data-saco-peso]")) return;
        evento.preventDefault();
        if (evento.repeat) return;
        const selector = evento.target.matches("[data-saco-peso]") ? "[data-saco-agregar]" : "[data-saco-guardar]";
        $("#cabinsReplenishment")?.querySelector(selector)?.click();
    });
    raiz.addEventListener("change", evento => {
        const campo = evento.target;
        if (campo.dataset?.cbRevisionSelect) { void cambiarEstadoRevision(campo); return; }
        if (campo.id === "cabinsReviewMode") return cambiarModo(campo.value);
        if (campo.matches(".aseo-encargado-input, .aseo-revision-input, .aseo-hora-input")) {
            setTimeout(() => {
                const numero = campo.dataset.aseoEncargado || campo.dataset.revisionCabana || campo.dataset.cabana;
                const dato = cabana(fechaActual(), numero);
                if (campo.classList.contains("aseo-encargado-input")) dato.aseo = campo.value.trim();
                if (campo.classList.contains("aseo-revision-input")) dato.revisionAseo = campo.value.trim();
                if (campo.dataset.aseoHora) dato[campo.dataset.aseoHora] = campo.value;
                pintar();
            }, 0);
        }
        if (campo.matches('[data-checklist-id], [data-aseo-express-item]')) {
            actualizarConteos();
            setTimeout(() => { window.HAIKU_CHECKLIST_OPTIMISTA_V1?.repintar(); pintarRevision(fechaActual()); pintarDetalle(); }, 0);
        } else if (campo.matches('#revision-estado, #aseo-express-estado')) {
            setTimeout(() => { actualizarConteos(); pintarRevision(fechaActual()); pintarDetalle(); }, 0);
        }
    });
    raiz.addEventListener("focusout", evento => {
        if (evento.target.closest("#aseo-resumen")) setTimeout(() => pintar(), 20);
    });
    document.querySelector('.menu-item[data-seccion="cabanas"]')?.addEventListener("click", () => {
        if (estado.numero) cerrar();
    });
    document.addEventListener("haiku:resumen-datos-actualizados", evento => {
        if (evento.detail?.fecha !== fechaActual()) return;
        if (revisionPendiente && confirmarRevisionRestaurada()) return;
        pintar(evento.detail.fecha);
        seleccionarExpressAutomatico();
        if (estado.numero) guardarContexto();
    });
    document.addEventListener("haiku:insumos-actualizados", evento => {
        if (evento.detail?.fecha === fechaActual()) pintarInsumos(evento.detail.fecha);
    });
    const observador = new MutationObserver(() => {
        if (estado.numero) { decorarChecklist(); window.HAIKU_CHECKLIST_OPTIMISTA_V1?.repintar(); actualizarConteos(); }
    });
    observador.observe($("#revision-checklist"), { childList: true });
    observador.observe($("#aseo-express-checklist"), { childList: true });
    window.HAIKU_CABANAS_SITES_V1 = Object.freeze({ pintar, pintarOperacion, pintarRevision, pintarDetalle, abrir, cerrar,
        actualizarConteos, estadoAseo, estadoFinal, revision, trabajo, titular, expressReal,
        grupoCabana, gruposCabanas, destinosPorCabana, tiempoTranscurrido });
    if (panelAutenticado) {
        window.addEventListener("haiku:auth-ready", restaurarContexto, true);
        if (window.haikuSesion) restaurarContexto();
    } else {
        const completaGuardada = localStorage.getItem("haikuRevisionCabana");
        const expressGuardada = localStorage.getItem("haikuAseoExpressCabana");
        if (completaGuardada && expressGuardada && completaGuardada !== expressGuardada) {
            localStorage.removeItem("haikuRevisionCabana");
            localStorage.removeItem("haikuAseoExpressCabana");
        } else {
            const guardada = expressGuardada || completaGuardada;
            if (numeroValido(guardada || "")) {
                estado.numero = guardada;
                estado.modo = "completa";
                localStorage.removeItem("haikuAseoExpressCabana");
                window.abrirRevisionCabana?.(guardada);
                decorarChecklist();
            }
        }
        pintar();
    }
})();

