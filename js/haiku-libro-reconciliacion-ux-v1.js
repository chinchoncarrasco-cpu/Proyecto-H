(function (root) {
    "use strict";
    if (!root.document) return;

    const STORAGE_KEY = "haiku-libro-reconciliacion-decisiones-v1";
    const MAX_DECISIONES = 80;

    function textoDirecto(label) {
        return Array.from(label.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent || "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function normalizarHuella(valor) {
        return String(valor || "").replace(/\s+/g, " ").trim();
    }

    function hashHuella(texto) {
        let h = 2166136261;
        for (const ch of String(texto || "")) {
            h ^= ch.codePointAt(0);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36);
    }

    function huellaDecision(label, select, rawDirecto = "") {
        const textos = [rawDirecto || textoDirecto(label)];
        label.querySelectorAll("p, th, td").forEach(el => textos.push(el.textContent || ""));
        Array.from(select.options).forEach(o => textos.push(`${o.value}=>${o.textContent || ""}`));
        return `d:${hashHuella(textos.map(normalizarHuella).join("||"))}`;
    }

    function leerDecisiones() {
        try {
            const data = JSON.parse(root.localStorage?.getItem(STORAGE_KEY) || "{}");
            return data && typeof data === "object" && !Array.isArray(data) ? data : {};
        } catch (_) {
            return {};
        }
    }

    function guardarDecision(clave, valor) {
        if (!clave) return;
        try {
            const data = leerDecisiones();
            if (valor) data[clave] = { valor, guardado_en: Date.now() };
            else delete data[clave];
            const entradas = Object.entries(data).sort((a, b) => Number(b[1]?.guardado_en || 0) - Number(a[1]?.guardado_en || 0)).slice(0, MAX_DECISIONES);
            root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entradas)));
        } catch (_) {}
    }

    function marcarRecordada(label) {
        if (label.querySelector(":scope > .haiku-reconciliacion-recordada")) return;
        const aviso = document.createElement("div");
        aviso.className = "haiku-reconciliacion-recordada";
        aviso.textContent = "Decisión recordada · se reutilizó porque la comparación es idéntica a la que ya confirmaste.";
        aviso.style.margin = "7px 0 0";
        aviso.style.padding = "6px 8px";
        aviso.style.borderRadius = "8px";
        aviso.style.background = "#eef7f1";
        aviso.style.color = "#356047";
        aviso.style.fontSize = ".62rem";
        aviso.style.fontWeight = "700";
        label.append(aviso);
    }

    function restaurarDecision(label, select) {
        const clave = label.dataset.haikuDecisionKey;
        if (!clave || select.value) return;
        const guardada = leerDecisiones()[clave]?.valor;
        if (!guardada || !Array.from(select.options).some(o => o.value === guardada)) return;
        select.value = guardada;
        marcarRecordada(label);
        // El listener original de Haku actualiza su Map de decisiones. No se escribe
        // nada en Proyecto H: sólo se recupera la selección para esta vista previa.
        select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function clasificarPregunta(texto) {
        const t = String(texto || "").toLowerCase();
        if (/un solo grupo|multicabaña|multicabana|son reservas independientes o un solo grupo/.test(t)) {
            return { etiqueta: "Multicabaña", clase: "haiku-reconciliacion-tag--grupo" };
        }
        if (/cambió de cabaña|cambio de cabaña|añadir la cabaña|anadir la cabana|estadía adicional|estadia adicional/.test(t)) {
            return { etiqueta: "Cabaña / estadía", clase: "haiku-reconciliacion-tag--cambio" };
        }
        if (/cambió el titular|cambio el titular/.test(t)) {
            return { etiqueta: "Identidad", clase: "haiku-reconciliacion-tag--identidad" };
        }
        if (/modificaron las fechas|modificación de fechas|modificacion de fechas/.test(t)) {
            return { etiqueta: "Fechas", clase: "haiku-reconciliacion-tag--cambio" };
        }
        return { etiqueta: "Revisión", clase: "" };
    }

    function mejorarLabel(label) {
        if (!label || label.dataset.haikuReconciliacionUx === "1") return;
        const select = label.querySelector("select");
        if (!select) return;

        const raw = textoDirecto(label);
        label.dataset.haikuDecisionKey = huellaDecision(label, select, raw);
        const corte = raw.search(/\.\s*¿/);
        const titulo = corte >= 0 ? raw.slice(0, corte).trim() : raw;
        const pregunta = corte >= 0 ? raw.slice(corte + 1).trim() : "Revisa esta posible asociación antes de continuar.";
        const categoria = clasificarPregunta(raw);

        Array.from(label.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .forEach(n => n.remove());

        const top = document.createElement("div");
        top.className = "haiku-reconciliacion-decision-top";

        const tituloEl = document.createElement("div");
        tituloEl.className = "haiku-reconciliacion-decision-titulo";
        tituloEl.textContent = titulo;

        const tag = document.createElement("span");
        tag.className = `haiku-reconciliacion-tag${categoria.clase ? ` ${categoria.clase}` : ""}`;
        tag.textContent = categoria.etiqueta;
        top.append(tituloEl, tag);

        const preguntaEl = document.createElement("div");
        preguntaEl.className = "haiku-reconciliacion-decision-pregunta";
        preguntaEl.textContent = pregunta;

        label.insertBefore(top, select);
        label.insertBefore(preguntaEl, select);
        select.setAttribute("aria-label", `${titulo}. ${pregunta}`);
        label.dataset.haikuReconciliacionUx = "1";
        label.classList.toggle("haiku-reconciliacion-resuelta", Boolean(select.value));
        restaurarDecision(label, select);
    }

    function actualizarMeta(bloque) {
        if (!bloque) return;
        const labels = Array.from(bloque.querySelectorAll(":scope > label"));
        if (!labels.length) return;
        const resueltas = labels.filter(l => Boolean(l.querySelector("select")?.value)).length;
        const pendientes = labels.length - resueltas;
        let meta = bloque.querySelector(":scope > .haiku-reconciliacion-meta");
        if (!meta) {
            meta = document.createElement("span");
            meta.className = "haiku-reconciliacion-meta";
            const strong = bloque.querySelector(":scope > strong");
            strong?.insertAdjacentElement("afterend", meta);
        }
        meta.textContent = `${resueltas} resuelta${resueltas === 1 ? "" : "s"} · ${pendientes} pendiente${pendientes === 1 ? "" : "s"}`;
    }

    function mejorarBloque(bloque) {
        if (!bloque) return;
        Array.from(bloque.querySelectorAll(":scope > label")).forEach(mejorarLabel);
        actualizarMeta(bloque);
    }

    function bloqueDesde(target) {
        const bloque = target?.closest?.(".haiku-asistente-preview-lista");
        if (!bloque || !bloque.querySelector(":scope > label")) return null;
        return bloque;
    }

    function tarjetaResumen(etiqueta, valor) {
        const box = document.createElement("div");
        box.className = "haiku-reconciliacion-resumen-accion";
        const label = document.createElement("span");
        const strong = document.createElement("strong");
        label.textContent = etiqueta;
        strong.textContent = String(valor);
        box.append(label, strong);
        return box;
    }

    function mejorarVistaPreparada(boton) {
        const vista = boton?.nextElementSibling;
        if (!vista || vista.dataset.haikuReconciliacionResumen === "1") return;
        const items = Array.from(vista.querySelectorAll("li")).map(li => (li.textContent || "").trim());
        if (!items.length) return;

        const conteo = {
            nuevas: 0,
            estadias: 0,
            modificaciones: 0,
            pagos: 0,
            pendientes: 0
        };

        for (const item of items) {
            if (/^Nueva reserva propuesta:/i.test(item) || /Es una reserva independiente/i.test(item)) conteo.nuevas += 1;
            if (/Añadir estadía a:/i.test(item)) conteo.estadias += 1;
            if (/Modificar:/i.test(item)) conteo.modificaciones += 1;
            if (/^Pago propuesto:/i.test(item)) conteo.pagos += 1;
            if (/Pendiente: no incorporar/i.test(item)) conteo.pendientes += 1;
        }

        const resumen = document.createElement("div");
        resumen.className = "haiku-reconciliacion-resumen-acciones";
        resumen.append(
            tarjetaResumen("Reservas nuevas", conteo.nuevas),
            tarjetaResumen("Estadías a añadir", conteo.estadias),
            tarjetaResumen("Modificaciones", conteo.modificaciones),
            tarjetaResumen("Pagos seguros", conteo.pagos),
            tarjetaResumen("Pendientes", conteo.pendientes)
        );
        vista.prepend(resumen);
        vista.dataset.haikuReconciliacionResumen = "1";
    }

    document.addEventListener("click", event => {
        const strong = event.target?.closest?.(".haiku-asistente-preview-lista > strong");
        const bloque = bloqueDesde(strong);
        if (bloque) {
            event.preventDefault();
            mejorarBloque(bloque);
            bloque.classList.toggle("haiku-reconciliacion-abierto");
            return;
        }

        const boton = event.target?.closest?.("button.libro-reserva-boton");
        if (boton && /Preparar vista previa/i.test(boton.textContent || "")) {
            requestAnimationFrame(() => mejorarVistaPreparada(boton));
        }
    });

    document.addEventListener("change", event => {
        const select = event.target?.matches?.(".haiku-asistente-preview-lista select") ? event.target : null;
        if (!select) return;
        const label = select.closest("label");
        const bloque = bloqueDesde(select);
        if (label) {
            label.classList.toggle("haiku-reconciliacion-resuelta", Boolean(select.value));
            const clave = label.dataset.haikuDecisionKey || huellaDecision(label, select);
            label.dataset.haikuDecisionKey = clave;
            guardarDecision(clave, select.value);
            if (!select.value) label.querySelector(":scope > .haiku-reconciliacion-recordada")?.remove();
        }
        actualizarMeta(bloque);
    });
})(typeof window !== "undefined" ? window : globalThis);
