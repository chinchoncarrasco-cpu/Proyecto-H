// Presentación Sites del Cierre. Los controles y los RPC existentes conservan la autoridad.
(() => {
    "use strict";
    const root = document.getElementById("seccion-cierre");
    if (!root) return;
    const $ = selector => root.querySelector(selector);
    const $$ = selector => [...root.querySelectorAll(selector)];
    const filters = ["todas", "pendientes", "observaciones", "completas"];
    let filter = "todas";
    let rpcState = null;
    let baselineDone = null;
    let navigatingFromClosing = false;
    const date = () => {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    };
    const dateLabel = value => value ? new Intl.DateTimeFormat("es-CL", {
        weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago"
    }).format(new Date(`${value}T12:00:00`)) : "Fecha operativa no disponible";
    const cabinData = number => {
        try { return obtenerDatosDia(date())?.cabanas?.[String(number)] || {}; }
        catch { return {}; }
    };
    const cabinState = number => window.HAIKU_CABANAS_SITES_V1?.estadoFinal?.(cabinData(number), date()) || "pendiente";
    const cabinCategory = state => state === "con-detalles" ? "observaciones"
        : state === "lista" || state === "no_requiere" ? "completas" : "pendientes";
    const cabinLabel = state => ({ lista: "Completa", "con-detalles": "Con observaciones",
        pendiente: "Por revisar", en_curso: "En curso", lista_para_revisar: "Lista para revisar",
        no_requiere: "No requiere" })[state] || "Por revisar";
    const titleWithoutIcon = text => String(text || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
    const node = (tag, cls, text) => {
        const element = document.createElement(tag);
        if (cls) element.className = cls;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    function assembleSubBlocks(stage) {
        stage.querySelectorAll(".cierre-bloque").forEach((block, index) => {
            const old = block.querySelector(":scope > .cierre-bloque-titulo");
            if (!old) return;
            const title = titleWithoutIcon(old.textContent);
            const body = node("div", "sites-cierre-sub-body");
            while (old.nextSibling) body.appendChild(old.nextSibling);
            if (stage.dataset.cierreEtapa === "1" && (index === 0 || index === 3)) {
                const target = index === 0 ? "resumen" : "pagos";
                const link = node("button", "sites-cierre-source-link", index === 0
                    ? "Ver salidas en Resumen ›" : "Ver pagos y BOVE ›");
                link.type = "button";
                link.addEventListener("click", () => document.querySelector(`.menu-item[data-seccion="${target}"]`)?.click());
                body.appendChild(link);
            }
            const head = node("button", "sites-cierre-sub-head");
            head.type = "button";
            head.setAttribute("aria-expanded", String(stage.dataset.cierreEtapa === "1" && index === 0));
            head.append(node("strong", "", title), node("small", "sites-cierre-sub-count", ""),
                node("span", "", head.getAttribute("aria-expanded") === "true" ? "⌃" : "⌄"));
            body.hidden = head.getAttribute("aria-expanded") !== "true";
            old.replaceWith(head);
            block.appendChild(body);
            head.addEventListener("click", () => {
                const open = body.hidden;
                body.hidden = !open;
                head.setAttribute("aria-expanded", String(open));
                head.lastElementChild.textContent = open ? "⌃" : "⌄";
            });
        });
    }
    function assemblePending(stage) {
        stage.querySelectorAll(".sites-cierre-pending-item").forEach(card => {
            const head = card.querySelector(".sites-cierre-pending-head");
            const body = card.querySelector(".sites-cierre-pending-body");
            if (!head || !body) return;
            head.addEventListener("click", () => {
                body.hidden = !body.hidden;
                head.setAttribute("aria-expanded", String(!body.hidden));
                head.querySelector(".sites-cierre-pending-chevron").textContent = body.hidden ? "⌄" : "⌃";
            });
        });
    }
    function updatePendingFields() {
        const stage = $(".sites-cierre-stage[data-cierre-etapa='2']");
        if (!stage) return;
        const block = stage.querySelector('[data-sites-pending="hay-novedades"]');
        const control = block?.querySelector(".sites-cierre-pending-field");
        if (control) control.hidden = !block.querySelector('input[name="hay-novedades"][value="si"]:checked');
    }
    function assembleCabins(stage) {
        const body = stage.querySelector(".sites-cierre-stage-body");
        const grid = body?.querySelector(".cierre-cabanas-grid");
        if (!grid) return;
        const summary = node("div", "sites-cierre-cabin-summary");
        summary.id = "sites-cierre-cabin-summary";
        const toolbar = node("div", "sites-cierre-filters");
        toolbar.setAttribute("role", "group");
        toolbar.setAttribute("aria-label", "Filtrar cabañas");
        filters.forEach(key => {
            const button = node("button", "", "");
            button.type = "button";
            button.dataset.sitesCierreFilter = key;
            toolbar.appendChild(button);
        });
        grid.before(summary, toolbar);
        grid.querySelectorAll(".cierre-cabana-card").forEach(card => {
            const oldHead = card.querySelector(":scope > .cierre-cabana-header");
            const number = Number(card.querySelector("[data-cierre-cabana-ocupada]")?.dataset.cierreCabanaOcupada);
            if (!number || !oldHead) return;
            card.classList.add("sites-cierre-cabin");
            card.dataset.sitesCierreCabin = String(number);
            const detail = node("div", "sites-cierre-cabin-body");
            while (card.firstChild) detail.appendChild(card.firstChild);
            detail.hidden = true;
            const heading = node("div", "sites-cierre-cabin-head");
            const toggle = node("button", "", "");
            toggle.type = "button";
            toggle.setAttribute("aria-expanded", "false");
            toggle.append(node("strong", "sites-cierre-cabin-name", `⌂ Cabaña ${number}`),
                node("small", "sites-cierre-cabin-fraction", "0/7 checks"),
                node("span", "sites-cierre-badge", "Por revisar"), node("span", "", "⌄"));
            toggle.addEventListener("click", () => {
                detail.hidden = !detail.hidden;
                toggle.setAttribute("aria-expanded", String(!detail.hidden));
                toggle.lastElementChild.textContent = detail.hidden ? "⌄" : "⌃";
            });
            const open = node("button", "sites-cierre-cabin-open", "Abrir ficha ›");
            open.type = "button";
            open.setAttribute("aria-label", `Abrir ficha operativa de cabaña ${number}`);
            open.addEventListener("click", () => openCabin(number));
            heading.append(toggle, open);
            card.append(heading, detail);
        });
        toolbar.addEventListener("click", event => {
            const button = event.target.closest("[data-sites-cierre-filter]");
            if (!button) return;
            filter = button.dataset.sitesCierreFilter;
            update();
        });
    }
    function assembleTinajaNote(stage) {
        const body = stage.querySelector(".sites-cierre-stage-body");
        if (!body) return;
        const note = node("div", "sites-cierre-tinaja-note");
        note.append(node("strong", "", "Observaciones / novedades del turno"),
            node("p", "", "Las anomalías de tinajas se informan en Novedades del turno."));
        const link = node("button", "sites-cierre-cabin-open", "Abrir novedades del turno ›");
        link.type = "button";
        link.addEventListener("click", () => {
            const stageTwo = $(".sites-cierre-stage[data-cierre-etapa='2']");
            if (stageTwo?.querySelector(".sites-cierre-stage-body")?.hidden) stageTwo.querySelector(".sites-cierre-stage-head")?.click();
            const text = stageTwo?.querySelector('textarea[data-cierre-campo="novedades"]');
            const block = text?.closest(".sites-cierre-pending-item");
            if (block?.querySelector(".sites-cierre-pending-body")?.hidden) block.querySelector(".sites-cierre-pending-head")?.click();
            text?.focus();
            text?.scrollIntoView({ block: "center" });
        });
        note.append(link);
        body.appendChild(note);
    }
    function openCabin(number) {
        const link = document.querySelector('.menu-item[data-seccion="cabanas"]');
        if (!link || !window.HAIKU_CABANAS_SITES_V1?.abrir) return;
        navigatingFromClosing = true;
        link.click();
        navigatingFromClosing = false;
        window.HAIKU_CABANAS_SITES_V1.abrir(number);
        const detail = document.getElementById("cabinsDetail");
        if (!detail) return;
        let back = document.getElementById("sites-cierre-volver");
        if (!back) {
            back = node("button", "sites-cierre-back", "‹ Volver a Cierre de turno");
            back.type = "button";
            back.id = "sites-cierre-volver";
            detail.prepend(back);
            back.addEventListener("click", () => {
                back.hidden = true;
                window.HAIKU_CABANAS_SITES_V1?.cerrar?.();
                document.querySelector('.menu-item[data-seccion="cierre"]')?.click();
            });
        }
        back.hidden = false;
    }
    const evidenceLabels = {
        registro: "registros",
        "cloudbeds-reserva": "reserva en CloudBeds",
        "cloudbeds-pago": "pago en CloudBeds",
        "manager-pagos": "pagos de Manager",
        "manager-caja": "caja de Manager"
    };
    const evidenceBlocks = new Map();
    function syncEvidence(block) {
        const preview = block.querySelector("[data-evidencia-preview]");
        const toggle = block.querySelector(".cierre-evidencia-toggle");
        const links = block.querySelector(".sites-cierre-evidence-links");
        const count = Math.max(Number(block.dataset.sitesEvidenceCount || 0), preview?.querySelector("img") ? 1 : 0);
        const status = block.querySelector(".sites-cierre-evidence-status");
        const label = count ? `${count} ${count === 1 ? "adjunto" : "adjuntos"}` : "Sin adjuntos";
        if (status && status.textContent !== label) status.textContent = label;
        if (!toggle) return;
        toggle.hidden = count === 0;
        if (!count) preview.style.display = "none";
        const open = count > 0 && preview.style.display !== "none";
        const buttonLabel = open ? "Ocultar evidencia" : "Ver evidencia";
        if (toggle.textContent !== buttonLabel) toggle.textContent = buttonLabel;
        if (links) links.hidden = !open || !links.childElementCount;
    }
    function assembleEvidence() {
        $$('[data-evidencia]').forEach(block => {
            const key = block.dataset.evidencia;
            const title = block.querySelector(".cierre-evidencia-titulo");
            const actions = block.querySelector(".cierre-evidencia-acciones");
            const preview = block.querySelector("[data-evidencia-preview]");
            if (!title || !actions || !preview) return;
            block.classList.add("sites-cierre-evidence");
            title.replaceChildren(node("strong", "", `Evidencia · ${evidenceLabels[key] || key}`),
                node("small", "sites-cierre-evidence-status", "Sin adjuntos"));
            const upload = actions.querySelector("label.cierre-evidencia-boton");
            const input = upload?.querySelector("[data-evidencia-input]");
            if (upload && input) upload.replaceChildren(document.createTextNode("Adjuntar imágenes"), input);
            const paste = actions.querySelector("[data-evidencia-pegar]");
            if (paste) {
                paste.textContent = "Pegar imagen";
                paste.title = "Haz clic aquí y presiona Ctrl+V para pegar una imagen";
            }
            const links = node("div", "sites-cierre-evidence-links");
            links.hidden = true;
            preview.after(links);
            const toggle = block.querySelector(".cierre-evidencia-toggle");
            toggle?.addEventListener("click", () => syncEvidence(block));
            new MutationObserver(() => syncEvidence(block)).observe(preview, { childList: true });
            evidenceBlocks.set(key, block);
            syncEvidence(block);
        });
    }
    async function refreshEvidence(key) {
        const block = evidenceBlocks.get(key);
        if (!block) return;
        const selectedDate = date();
        const request = String(Number(block.dataset.sitesEvidenceRequest || 0) + 1);
        block.dataset.sitesEvidenceRequest = request;
        const links = block.querySelector(".sites-cierre-evidence-links");
        block.dataset.sitesEvidenceCount = "0";
        links.replaceChildren();
        syncEvidence(block);
        try {
            const list = await window.HAIKU_CIERRE_EVIDENCIAS_V1?.listar?.(selectedDate, key);
            if (block.dataset.sitesEvidenceRequest !== request || date() !== selectedDate || !Array.isArray(list)) return;
            block.dataset.sitesEvidenceCount = String(list.length);
            links.replaceChildren();
            list.forEach((item, index) => {
                if (!item.url) return;
                const link = node("a", "", `Adjunto ${index + 1}`);
                link.href = item.url;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                links.appendChild(link);
            });
            syncEvidence(block);
        } catch (error) {
            console.warn("No fue posible listar las evidencias del cierre:", error);
            syncEvidence(block);
        }
    }
    function refreshAllEvidence() {
        evidenceBlocks.forEach((block, key) => refreshEvidence(key));
    }
    function assemble() {
        const progress = $(".sites-cierre-legacy .cierre-progreso");
        if (progress) $("#sites-cierre-progress-slot").appendChild(progress);
        const slot = $("#sites-cierre-stages");
        slot.replaceChildren();
        const stages = $$(".sites-cierre-legacy .cierre-etapa");
        stages.forEach((stage, index) => {
            stage.dataset.cierreEtapa = String(index + 1);
            stage.classList.add("sites-cierre-stage");
            const old = stage.querySelector(":scope > .cierre-etapa-cabecera, :scope > .cierre-etapa-header");
            const title = old?.querySelector("h2,h3")?.textContent.trim() || `Etapa ${index + 1}`;
            const description = old?.querySelector("p")?.textContent.replace(/\s+/g, " ").trim() || "";
            const body = node("div", "sites-cierre-stage-body");
            while (old?.nextSibling) body.appendChild(old.nextSibling);
            const head = node("button", "sites-cierre-stage-head");
            head.type = "button";
            head.setAttribute("aria-expanded", String(index === 0));
            const titleWrap = node("span", "sites-cierre-stage-title");
            titleWrap.append(node("strong", "", title), node("small", "", description));
            head.append(node("span", "sites-cierre-stage-number", String(index + 1).padStart(2, "0")),
                titleWrap, node("span", "sites-cierre-stage-count", "—"),
                node("span", "sites-cierre-badge", "Pendiente"), node("span", "sites-cierre-chevron", index === 0 ? "⌃" : "⌄"));
            body.hidden = index !== 0;
            old?.replaceWith(head);
            stage.appendChild(body);
            slot.appendChild(stage);
            head.addEventListener("click", () => {
                body.hidden = !body.hidden;
                head.setAttribute("aria-expanded", String(!body.hidden));
                head.lastElementChild.textContent = body.hidden ? "⌄" : "⌃";
            });
            if (index === 0) assembleSubBlocks(stage);
            if (index === 1) assemblePending(stage);
            if (index === 2) {
                stage.querySelectorAll(".cierre-card h3").forEach(title => {
                    title.textContent = titleWithoutIcon(title.textContent);
                });
                assembleTinajaNote(stage);
            }
            if (index === 3) assembleCabins(stage);
        });
        assembleEvidence();
        root.classList.remove("sites-cierre-pending");
        root.classList.add("sites-cierre-ready");
    }
    function radioCount(stage) {
        const names = [...new Set([...stage.querySelectorAll('input[type="radio"][name]')].map(input => input.name))];
        return { done: names.filter(name => !!stage.querySelector(`input[name="${name}"]:checked`)).length, total: names.length };
    }
    function stageCount(stage, index) {
        if (index === 3) {
            const cards = [...stage.querySelectorAll(".sites-cierre-cabin")];
            const done = cards.filter(card => card.querySelector("[data-cierre-cabana-ocupada]")?.checked ||
                [...card.querySelectorAll("[data-cierre-cabana][data-item]")].every(input => input.checked)).length;
            return { done, total: cards.length };
        }
        const radios = radioCount(stage);
        const boxes = [...stage.querySelectorAll('input[type="checkbox"]')];
        return { done: radios.done + boxes.filter(input => input.checked).length,
            total: radios.total + boxes.length };
    }
    function updateCabins() {
        const cards = $$(".sites-cierre-cabin");
        const counts = { todas: cards.length, pendientes: 0, observaciones: 0, completas: 0 };
        cards.forEach(card => {
            const number = Number(card.dataset.sitesCierreCabin);
            const state = cabinState(number);
            const category = cabinCategory(state);
            counts[category]++;
            const checks = [...card.querySelectorAll("[data-cierre-cabana][data-item]")];
            const complete = checks.filter(input => input.checked).length;
            card.querySelector(".sites-cierre-cabin-fraction").textContent = `${complete}/${checks.length} checks`;
            const badge = card.querySelector(".sites-cierre-badge");
            badge.textContent = cabinLabel(state);
            badge.classList.toggle("complete", category === "completas");
            card.hidden = filter !== "todas" && category !== filter;
        });
        const summary = $("#sites-cierre-cabin-summary");
        if (summary) summary.textContent = `${counts.pendientes} pendientes / por revisar · ${counts.observaciones} con observaciones · ${counts.completas} completas`;
        $$("[data-sites-cierre-filter]").forEach(button => {
            const key = button.dataset.sitesCierreFilter;
            const label = ({ todas: "Todas", pendientes: "Pendientes", observaciones: "Observaciones", completas: "Completas" })[key];
            button.textContent = `${label} ${counts[key]}`;
            button.classList.toggle("active", key === filter);
            button.setAttribute("aria-pressed", String(key === filter));
        });
        $("#sites-cierre-cabanas-pendientes").textContent = String(counts.pendientes);
        $("#sites-cierre-observaciones").textContent = String(counts.observaciones);
        return counts;
    }
    function update() {
        $("#sites-cierre-fecha").textContent = dateLabel(date());
        updatePendingFields();
        const stages = $$(".sites-cierre-stage");
        let complete = 0;
        stages.forEach((stage, index) => {
            const { done, total } = stageCount(stage, index);
            const isComplete = total > 0 && done === total;
            if (isComplete) complete++;
            const head = stage.querySelector(".sites-cierre-stage-head");
            head.querySelector(".sites-cierre-stage-count").textContent = `${done}/${total} revisados`;
            const badge = head.querySelector(".sites-cierre-badge");
            badge.textContent = isComplete ? "Completa" : "Pendiente";
            badge.classList.toggle("complete", isComplete);
            stage.querySelectorAll(".cierre-bloque").forEach(block => {
                const count = block.classList.contains("cierre-llaves-recepcion")
                    ? { done: block.querySelectorAll('input[type="checkbox"]:checked').length,
                        total: block.querySelectorAll('input[type="checkbox"]').length }
                    : { done: radioCount(block).done + block.querySelectorAll('input[type="checkbox"]:checked').length,
                        total: radioCount(block).total + block.querySelectorAll('input[type="checkbox"]').length };
                const label = block.querySelector(".sites-cierre-sub-count");
                if (label && count.total) label.textContent = `${count.done}/${count.total} ${block.classList.contains("cierre-llaves-recepcion") ? "devueltas" : "revisados"}`;
            });
            if (index === 1) stage.querySelectorAll(".sites-cierre-pending-item").forEach(card => {
                const count = card.querySelector('input[type="radio"]:checked') ? 1 : 0;
                card.querySelector(".sites-cierre-pending-count").textContent = `${count}/1 revisados`;
            });
        });
        $("#sites-cierre-etapas-completas").textContent = `${complete}/${stages.length}`;
        updateCabins();
        if (rpcState) renderDashboard(rpcState, baselineDone === null ? 0 : localDone() - baselineDone);
    }
    function localDone() {
        return $$(".sites-cierre-stage").reduce((sum, stage, index) => sum + stageCount(stage, index).done, 0);
    }
    function renderWarnings(state) {
        const panel = $("#cierre-final-supabase");
        if (!panel) return;
        let warnings = panel.querySelector(".sites-cierre-warnings");
        if (!warnings) {
            warnings = node("div", "sites-cierre-warnings");
            warnings.append(node("strong", "", "Antes de cerrar"), node("ul"));
            panel.querySelector(".cierre-final-resumen-wrap")?.before(warnings);
        }
        const list = warnings.querySelector("ul");
        list.replaceChildren();
        $$(".sites-cierre-stage").forEach((stage, index) => {
            const count = stageCount(stage, index);
            const missing = count.total - count.done;
            if (missing) {
                const title = stage.querySelector(".sites-cierre-stage-title strong")?.textContent || `Etapa ${index + 1}`;
                list.appendChild(node("li", "", `${title}: ${missing} ${index === 3 ? "cabañas" : "controles"} sin completar`));
            }
        });
        const observed = Number($("#sites-cierre-observaciones")?.textContent || 0);
        if (observed) list.appendChild(node("li", "", `${observed} cabañas con observaciones en su estado final`));
        if (!list.children.length) list.appendChild(node("li", "", Number(state.pendientes || 0)
            ? `${state.pendientes} pendientes según el estado del cierre` : "Controles completos"));
    }
    function renderDashboard(state, change = 0) {
        const pending = Math.max(0, Number(state.pendientes || 0) - change);
        const total = Number(state.total_requeridos || 0);
        const percentage = change === 0 ? Number(state.porcentaje || 0)
            : total ? Math.round(Math.max(0, Math.min(total, Number(state.completados || 0) + change)) / total * 100) : 0;
        const closed = ["cerrado", "cerrado_con_pendientes"].includes(state.cierre_estado);
        $("#sites-cierre-estado").textContent = closed ? "Turno cerrado"
            : pending ? "Cierre con pendientes" : "Cierre listo";
        $("#sites-cierre-resumen").textContent = `${pending} controles pendientes · ${total} controles requeridos`;
        $("#sites-cierre-pendientes").textContent = String(pending);
        $("#sites-cierre-turno").textContent = ({ cerrado: "Cerrado",
            cerrado_con_pendientes: "Cerrado con pendientes", reabierto: "Reabierto" })[state.cierre_estado] || "Borrador";
        const percent = $("#cierre-porcentaje");
        const bar = $("#cierre-barra-progreso");
        if (percent) percent.textContent = `${percentage}%`;
        if (bar) bar.style.width = `${percentage}%`;
        renderWarnings(state);
    }
    function applyRpcState(state) {
        rpcState = state;
        baselineDone = localDone();
        renderDashboard(state);
    }
    assemble();
    const originalLoad = window.cargarCierreDia;
    if (typeof originalLoad === "function") {
        window.cargarCierreDia = function cargarCierreDiaSites() {
            const result = originalLoad.apply(this, arguments);
            queueMicrotask(update);
            refreshAllEvidence();
            return result;
        };
    }
    root.addEventListener("change", event => {
        if (event.target.matches("input[type='checkbox'],input[type='radio']")) queueMicrotask(update);
    });
    root.addEventListener("input", event => {
        if (event.target.matches("textarea[data-cierre-campo]")) queueMicrotask(update);
    });
    window.addEventListener("haiku:cierre-estado-actualizado", event => applyRpcState(event.detail));
    window.addEventListener("haiku:auth-ready", () => setTimeout(() => { update(); refreshAllEvidence(); }, 0));
    window.addEventListener("haiku:cierre-evidencia-guardada", event => {
        if (event.detail?.fecha === date()) refreshEvidence(event.detail.nombre);
    });
    document.querySelector('.menu-item[data-seccion="cierre"]')?.addEventListener("click", () => setTimeout(() => {
        update();
        refreshAllEvidence();
    }, 0));
    document.addEventListener("click", event => {
        if (event.target.closest(".menu-item[data-seccion]") && !navigatingFromClosing) {
            const back = document.getElementById("sites-cierre-volver");
            if (back) back.hidden = true;
        }
    });
    document.addEventListener("haiku:revision-estado-guardado", () => setTimeout(update, 0));
    update();
    window.HAIKU_SITES_CIERRE_V1 = Object.freeze({ actualizar: update, estadoCabana: cabinState });
})();
