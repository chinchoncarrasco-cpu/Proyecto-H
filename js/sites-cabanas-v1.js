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
    const FINALES = Object.freeze({ pendiente: "Pendiente", en_curso: "En curso",
        lista_para_revisar: "Lista para revisar", "con-detalles": "Con detalles",
        lista: "Lista", no_requiere: "No requiere" });
    const estado = { tab: "operation", filtro: "todas", numero: "", origen: "operation", modo: "completa", fecha: "" };
    const CLAVE_CONTEXTO = "haikuCabanasContextoPestanaV1";
    const panelAutenticado = document.documentElement.classList.contains("haiku-cabanas-pendiente");
    let usuarioRestaurado = "";
    let revisionPendiente = null;
    let restaurando = false;
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
        const ciclo = estado.numero ? cabana(fechaActual(), estado.numero)?.[
            estado.modo === "aseo_express" ? "aseoExpressCiclo" : "revisionCompletaCiclo"] : null;
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
    const revision = (dato, fecha = fechaActual()) => {
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
    const estadoFinal = (dato, fecha = fechaActual()) => {
        const aseo = estadoAseo(dato);
        if (aseo === "no_requiere") return "no_requiere";
        const rev = revision(dato, fecha);
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
    const expressReal = (dato, fecha) => dato?.aseoExpressCiclo?.fecha === fecha
        && dato.aseoExpressCiclo.verificado === true && dato.aseoExpressCiclo.existe === true;
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
    function solicitudesHTML(fecha, numero, dato, eliminar = true) {
        const solicitudes = listaSolicitudes(fecha, numero, dato);
        const etiquetas = solicitudes.expresas.map(texto => `<span>${escapar(texto)}${eliminar
            ? ` <button type="button" data-eliminar-solicita="${numero}" aria-label="Eliminar solicitud de cabaña ${numero}">×</button>` : ""}</span>`);
        etiquetas.push(...solicitudes.operativas.map(texto => `<span>${escapar(texto)}</span>`));
        return etiquetas.length ? `<div class="cb-requests">${etiquetas.join("")}</div>` : "";
    }
    function resumen(fecha) {
        const datos = Array.from({ length: 11 }, (_, indice) => cabana(fecha, indice + 1));
        const pendientes = datos.filter(dato => !["lista", "no_requiere"].includes(estadoFinal(dato, fecha))).length;
        const porRevisar = datos.filter(dato => estadoFinal(dato, fecha) === "lista_para_revisar").length;
        const listas = datos.filter(dato => estadoFinal(dato, fecha) === "lista").length;
        $("#cabinsSummary").innerHTML = `<span><strong>${pendientes}</strong> En trabajo o pendientes</span><span><strong>${porRevisar}</strong> Por revisar</span><span><strong>${listas}</strong> Listas para operar</span>`;
    }
    function filtro(fech, numero) {
        const valor = estadoFinal(cabana(fech, numero), fech);
        return estado.filtro === "todas" || (estado.filtro === "pendientes" && !["lista", "no_requiere"].includes(valor))
            || (estado.filtro === "listas" && valor === "lista");
    }
    function pintarFiltros(fecha) {
        const pendientes = Array.from({ length: 11 }, (_, i) => i + 1).filter(n =>
            !["lista", "no_requiere"].includes(estadoFinal(cabana(fecha, n), fecha))).length;
        const listas = Array.from({ length: 11 }, (_, i) => i + 1).filter(n => estadoFinal(cabana(fecha, n), fecha) === "lista").length;
        $("#cabinsFilters").innerHTML = [["todas", "Todas", 11], ["pendientes", "Pendientes", pendientes], ["listas", "Listas", listas]]
            .map(([clave, texto, cantidad]) => `<button type="button" data-cb-filter="${clave}" aria-pressed="${estado.filtro === clave}">${texto} · ${cantidad}</button>`).join("");
    }
    function filaOperacion(fecha, numero) {
        const dato = cabana(fecha, numero);
        const rev = revision(dato, fecha);
        const final = estadoFinal(dato, fecha);
        const solicitudes = listaSolicitudes(fecha, numero, dato);
        const pendiente = [...solicitudes.expresas, ...solicitudes.operativas].join(" · ");
        return `<article class="cb-operation-row aseo-resumen-cabana" data-cb-cabin="${numero}" data-aseo-express-cabana="${numero}" role="listitem">
          <div class="cb-cabin"><strong>Cabaña ${numero}</strong><span title="${escapar(titular(dato, fecha, numero))}">${escapar(titular(dato, fecha, numero))}</span><small>${escapar(trabajo(dato))}</small>${pendiente ? `<div class="cb-pending" title="${escapar(pendiente)}">${solicitudesHTML(fecha, numero, dato)}</div>` : ""}</div>
          <label class="cb-cell"><span>Encargado</span><input type="text" class="aseo-encargado-input" data-aseo-encargado="${numero}" value="${escapar(dato.aseo || "")}" placeholder="Sin asignar" list="cabinsStaff" aria-label="Encargado de cabaña ${numero}"></label>
          <label class="cb-cell"><span>Revisor</span><input type="text" class="aseo-revision-input" data-revision-cabana="${numero}" value="${escapar(dato.revisionAseo || "")}" placeholder="Sin asignar" list="cabinsStaff" aria-label="Revisor de cabaña ${numero}"></label>
          <label class="cb-cell"><span>IN</span><input type="time" class="aseo-hora-input" data-aseo-hora="aseoIn" data-cabana="${numero}" value="${escapar(dato.aseoIn || "")}" aria-label="Hora IN de cabaña ${numero}"></label>
          <label class="cb-cell"><span>OUT</span><input type="time" class="aseo-hora-input" data-aseo-hora="aseoOut" data-cabana="${numero}" value="${escapar(dato.aseoOut || "")}"${!dato.aseoIn && !dato.aseoOut ? " disabled" : ""} aria-label="Hora OUT de cabaña ${numero}"></label>
          <div class="cb-state cb-status cb-aseo-status" aria-live="polite"><small>Estado aseo</small>${aseoHTML(dato, numero)}</div>
          <div class="cb-state cb-status cb-revision-status" aria-live="polite"><small>Estado revisión</small><span class="cb-badge ${tono(rev)}" data-cb-revision-state>${REVISIONES[rev]}</span></div>
          <div class="cb-state cb-status cb-final-status" aria-live="polite"><small>Estado final</small><span class="cb-badge ${tono(final)}" data-cb-final-state>${FINALES[final]}</span></div>
          <button type="button" class="cb-open" data-cb-open="${numero}" aria-label="Abrir ficha de cabaña ${numero}">Abrir <span aria-hidden="true">›</span></button>
        </article>`;
    }
    function pintarOperacion(fecha) {
        if (!fecha) return;
        const enfocado = document.activeElement;
        if (enfocado && $("#aseo-resumen")?.contains(enfocado) && enfocado.matches?.("input, select, textarea")) return;
        const numeros = Array.from({ length: 11 }, (_, i) => i + 1).filter(numero => filtro(fecha, numero));
        $("#cabinsOperationDescription").textContent = `Asignación, horarios y coordinación del turno · ${numeros.length} cabañas visibles`;
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
        const tipo = expressReal(dato, fecha) ? "Revisión completa / Aseo Express" : "Revisión completa";
        const rev = revision(dato, fecha);
        return `<article class="cb-review-row" data-cb-review-cabana="${numero}" role="listitem"><div class="cb-review-ident"><strong>Cabaña ${numero}</strong><span>${escapar(titular(dato, fecha, numero))}</span></div><div class="cb-review-clean"><small>Aseo</small><span class="cb-badge ${tono(aseo)}">${etiqueta(aseo)}</span></div><div class="cb-review-mode"><small>Tipo de revisión</small><span>${tipo}</span></div><div class="cb-review-progress"><small>Checklist</small><strong>${revisadosChecklist(dato)}/${totalChecklist(numero)}</strong> <span>elementos</span></div><div class="cb-review-status"><small>Revisión</small><span class="cb-badge ${tono(rev)}">${REVISIONES[rev]}</span></div><button type="button" class="cb-open" data-cb-open="${numero}" data-cb-origin="review">Abrir revisión <span aria-hidden="true">›</span></button></article>`;
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
        const final = estadoFinal(dato, fecha);
        const hayExpress = expressReal(dato, fecha);
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
        $("#cabinsDetailRequests").innerHTML = solicitudesHTML(fecha, numero, dato) || "<p>Sin solicitudes registradas.</p>";
        $("#cabinsAseoProgress").textContent = etiqueta(aseo);
        $("#cabinsRevisionProgress").textContent = REVISIONES[revision(dato, fecha)];
        $("#cabinsFinalProgress").textContent = FINALES[final];
        $("#cabinsFinalBadge").textContent = $("#cabinsFinalProgress").textContent;
        for (const [id, valor] of [["#cabinsAseoDot", aseo], ["#cabinsRevisionDot", revision(dato, fecha)], ["#cabinsFinalDot", final]]) {
            const punto = $(id); punto.className = `cb-stage-dot ${tono(valor)}`;
        }
        $("#cabinsFinalBadge").className = `cb-badge ${tono(final)}`;
        $("#cabinsFinalStateDisplay").textContent = FINALES[final];
        $("#cabinsExpressFinalStateDisplay").textContent = FINALES[final];
        $("#cabinsExpressAvailability").textContent = hayExpress ? "Solicitado"
            : dato?.aseoExpressCiclo?.fecha === fecha && dato.aseoExpressCiclo.verificado === true
                ? "No solicitado" : "No verificado";
        const modoExpress = $("#cabinsReviewMode").querySelector('option[value="aseo_express"]');
        if (modoExpress) modoExpress.disabled = !hayExpress;
        $("#volver-cabanas").textContent = `‹ Volver a ${estado.origen === "review" ? "Revisión de cabañas" : "Operación de hoy"}`;
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
        const hayExpress = detalle && expressReal(dato, fechaActual());
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
        $("#cabinsExpressToggle").setAttribute("aria-disabled", String(!hayExpress));
        $("#cabinsExpressToggleIcon").textContent = expressAbierto ? "−" : "+";
        $("#cabinsReviewMode").value = estado.modo;
    }
    function pintar(fecha = fechaActual()) {
        if (!fecha) return;
        if (estado.numero && estado.fecha && estado.fecha !== fecha) {
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
        if (estado.numero) pintarDetalle(fecha);
        aplicarVista();
    }
    function abrir(numero, origen = estado.tab, modo = "completa", opciones = {}) {
        if (!numeroValido(numero)) return;
        if (modo === "aseo_express" && !expressReal(cabana(fechaActual(), numero), fechaActual())) modo = "completa";
        estado.numero = String(numero);
        estado.origen = origen;
        estado.modo = modo;
        estado.fecha = fechaActual();
        localStorage.removeItem(modo === "aseo_express" ? "haikuRevisionCabana" : "haikuAseoExpressCabana");
        if (modo === "aseo_express") {
            window.abrirRevisionAseoExpress?.(numero);
            window.HAIKU_CABANAS_FOTOS_V1?.aplicarAseo?.(numero);
        } else {
            window.abrirRevisionCabana?.(numero);
            window.HAIKU_CABANAS_FOTOS_V1?.aplicar?.(numero);
        }
        decorarChecklist();
        pintarDetalle(); aplicarVista();
        guardarContexto();
        if (!opciones.restaurando) raiz.scrollIntoView({ block: "start" });
    }
    function cerrar() {
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
        if (modo === "aseo_express" && !expressReal(cabana(fechaActual(), numero), fechaActual())) {
            $("#cabinsReviewMode").value = estado.modo;
            return;
        }
        localStorage.removeItem(modo === "aseo_express" ? "haikuRevisionCabana" : "haikuAseoExpressCabana");
        if (modo === "completa") {
            $("#volver-aseo")?.click();
            window.abrirRevisionCabana?.(numero);
            window.HAIKU_CABANAS_FOTOS_V1?.aplicar?.(numero);
        } else {
            $("#revision-individual").classList.remove("activa");
            window.abrirRevisionAseoExpress?.(numero);
            window.HAIKU_CABANAS_FOTOS_V1?.aplicarAseo?.(numero);
        }
        estado.modo = modo;
        decorarChecklist(); pintarDetalle(); aplicarVista();
        guardarContexto();
    }
    function volverOperacionRestaurada() {
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
            const cicloExpress = cabana(pendiente.fecha, pendiente.numero)?.aseoExpressCiclo;
            if (cicloExpress?.fecha !== pendiente.fecha || cicloExpress.verificado !== true) return false;
            if (!cicloExpress.existe ||
                (pendiente.revisionId && String(cicloExpress.revisionId || "") !== pendiente.revisionId)) {
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
        if (boton.dataset.cbNoRequiere !== undefined) { cambiarEstadoAseo(boton); return; }
        if (boton.dataset.cabTab) { estado.tab = boton.dataset.cabTab; estado.filtro = "todas"; pintar(); guardarContexto(); return; }
        if (boton.dataset.cbFilter) { estado.filtro = boton.dataset.cbFilter; pintar(); return; }
        if (boton.dataset.cbOpen) { abrir(boton.dataset.cbOpen, boton.dataset.cbOrigin || estado.tab); return; }
        if (boton.id === "volver-cabanas") { cerrar(); return; }
        if (boton.id === "cabinsExpressToggle") {
            if (expressReal(cabana(fechaActual(), estado.numero), fechaActual())) {
                cambiarModo(estado.modo === "aseo_express" ? "completa" : "aseo_express");
            }
            return;
        }
        if (boton.id === "cabinsDetailAddRequest") { $("#agregar-solicita").click(); $("#solicita-cabana").value = estado.numero; return; }
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
    raiz.addEventListener("change", evento => {
        const campo = evento.target;
        if (campo.id === "cabinsReviewMode") { cambiarModo(campo.value); return; }
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
        if (estado.numero) guardarContexto();
    });
    const observador = new MutationObserver(() => {
        if (estado.numero) { decorarChecklist(); window.HAIKU_CHECKLIST_OPTIMISTA_V1?.repintar(); actualizarConteos(); }
    });
    observador.observe($("#revision-checklist"), { childList: true });
    observador.observe($("#aseo-express-checklist"), { childList: true });
    window.HAIKU_CABANAS_SITES_V1 = Object.freeze({ pintar, pintarOperacion, pintarRevision, pintarDetalle, abrir, cerrar,
        actualizarConteos, estadoAseo, estadoFinal, revision, trabajo, titular, expressReal });
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
