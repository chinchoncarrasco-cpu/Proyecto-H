(function (root) {
    "use strict";
    if (!root.document) return;

    function textoDirecto(label) {
        return Array.from(label.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent || "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
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
        if (label) label.classList.toggle("haiku-reconciliacion-resuelta", Boolean(select.value));
        actualizarMeta(bloque);
    });
})(typeof window !== "undefined" ? window : globalThis);
