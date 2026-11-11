(() => {
    "use strict";
    const core = window.HAIKU_REVISION_PLANTILLA_CORE_V1;
    const contextos = new Map();
    const permisosCompartidos = new Map();
    const permisosEdicion = ["configuracion.gestionar", "cabanas.ver", "revisiones.ver"];
    const omitidos = new Set(["PGRST202", "42883", "42501"]);
    const modalidades = {
        completa: { label: "Revisión completa", panel: "revision-individual", areas: [
            ["0", "Cocina", "kitchen"], ["1", "Baño", "shower"], ["2", "Living/C", "bed"], ["3", "Terraza", "mountain"]
        ] },
        repaso: { label: "Repaso", panel: "repaso-individual", areas: [
            ["living", "Living / Cama", "bed"], ["kitchen", "Cocina", "kitchen"],
            ["bathroom", "Baño", "shower"], ["terrace", "Terraza", "mountain"]
        ] },
        aseo_express: { label: "Revisión Express", panel: "aseo-express-individual", areas: [
            ["kitchen", "Cocina", "kitchen"], ["bathroom", "Baño", "shower"],
            ["living", "Living/Cama", "bed"], ["terrace", "Terraza", "mountain"]
        ] }
    };
    let scope = null;
    let editor = null;
    let guardado = null;
    let arrastre = null;
    const indisponibles = new Set();
    const clave = (fecha, numero, modo) => fecha + "::" + numero + "::" + modo;
    const contexto = (fecha, numero, modo = "completa") => contextos.get(clave(fecha, numero, modo));
    const alcance = actual => actual.modo === "completa" ? "Cabaña " + actual.numero : "Todas las cabañas";
    const etiqueta = actual => modalidades[actual.modo].label;
    const $ = id => document.getElementById(id);
    const escapado = value => String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
    function identidadSesion() {
        const sesion = window.haikuSesion;
        if (!sesion?.auth?.id) return "";
        return sesion.auth.id + ":" + permisosEdicion.filter(permiso => sesion.permisos?.includes(permiso)).join(",");
    }
    let sesionEditor = identidadSesion();

    function puedeEditar(actual) {
        if (!actual || !sesionEditor || sesionEditor !== identidadSesion()) return false;
        const permiso = contexto(actual.fecha, actual.numero, actual.modo)?.canEdit;
        return (actual.modo === "completa" ? permiso : permisosCompartidos.get(actual.modo) ?? permiso) === true;
    }

    const icono = name => '<span class="pr-icon pr-icon-' + name + '" aria-hidden="true"></span>';

    async function rpc(nombre, argumentos) {
        const cliente = window.haikuSupabase;
        if (!cliente?.rpc) return null;
        const { data, error } = await cliente.rpc(nombre, argumentos);
        if (error) throw error;
        return data;
    }

    async function leer(fecha, cabanaId = null, modo = "completa") {
        const completa = modo === "completa";
        const nombre = completa ? "haku_revision_plantillas_v1" : "haku_revision_modalidades_v1";
        if (indisponibles.has(nombre)) return null;
        const sesion = identidadSesion();
        try {
            const respuesta = await rpc(nombre, completa
                ? { p_fecha: fecha, p_cabana_id: cabanaId }
                : { p_fecha: fecha, p_tipo: modo });
            if (sesion !== identidadSesion() || !Array.isArray(respuesta?.templates)) return null;
            if (!completa && sesion) {
                // El permiso del editor no depende de la lectura de los checks ni de su catálogo.
                permisosCompartidos.set(modo, respuesta.can_edit === true);
                mostrar();
            }
            return respuesta;
        } catch (error) {
            if (sesion !== identidadSesion()) return null;
            if (error.code === "PGRST202" || error.code === "42883") indisponibles.add(nombre);
            if (!completa && error.code === "42501") {
                permisosCompartidos.set(modo, false);
                mostrar();
            }
            if (!omitidos.has(error.code)) console.warn("HAIKU · Plantillas de revisión:", error.message);
            return null;
        }
    }

    function plantillaDe(respuesta, numero, revision) {
        return respuesta?.templates?.find(item =>
            String(item.numero) === String(numero) && item.revision_id === (revision?.id ?? null)
            && (!revision || item.version_id === revision.plantilla_id)
        ) || null;
    }

    function publicar(fecha, numero, cabanaId, respuesta, plantilla, modo = "completa") {
        if (!respuesta) return false;
        const anterior = contexto(fecha, numero, modo)?.plantilla?.version_id ?? null;
        contextos.set(clave(fecha, numero, modo), { cabanaId, canEdit: respuesta.can_edit === true, plantilla });
        mostrar();
        return anterior !== (plantilla?.version_id ?? null);
    }

    function aplicarChecklist(base, fecha, numero) {
        const grupos = contexto(fecha, numero)?.plantilla?.groups;
        if (!grupos) return base;
        const porId = new Map(grupos.map(grupo => [grupo.id, grupo]));
        const items = grupo => grupo.items.filter(item => item.active);
        return base.map((area, indice) => {
            if (area.subareas) {
                return { ...area, subareas: area.subareas.map((subarea, subIndice) => {
                    const grupo = porId.get(indice + "-" + subIndice);
                    return grupo ? { ...subarea, nombre: grupo.label, items: items(grupo) } : subarea;
                }) };
            }
            const grupo = porId.get(String(indice));
            return grupo ? { ...area, items: items(grupo) } : area;
        });
    }

    function configurarItems(original, plantilla) {
        if (!plantilla) return original;
        return new Map(plantilla.groups.flatMap(grupo => grupo.items.filter(item => item.active).map(item => [
            item.id, { checklist_item_id: item.itemId, legacy_checklist_id: item.id, cantidad_esperada: item.expected }
        ])));
    }

    function actualizarAlcance(fecha, numero, modo) {
        const key = numero && Object.hasOwn(modalidades, modo) ? clave(fecha, numero, modo) : null;
        if (key !== scope?.key && editor) cerrar(false);
        scope = key ? { key, fecha, numero: String(numero), modo } : null;
        mostrar();
    }

    function mostrar() {
        const button = $("cabinsReviewCustomize");
        if (!button) return;
        button.hidden = !puedeEditar(scope) || Boolean(editor);
        const success = $("cabinsReviewTemplateSaved");
        success.hidden = !guardado || guardado.key !== scope?.key || Boolean(editor);
        if (!success.hidden) {
            const fecha = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short",
                timeZone: "America/Santiago" }).format(new Date(guardado.published_at));
            const aviso = scope.modo === "completa" ? "Disponibles para las próximas revisiones completas."
                : "Disponibles para las próximas revisiones de este tipo en todas las cabañas.";
            success.innerHTML = '<strong>Cambios guardados</strong><span>' + aviso + '</span>'
                + '<small>Última edición por ' + escapado(guardado.author) + " · " + escapado(fecha) + "</small>";
        }
    }

    async function abrir() {
        const info = scope && contexto(scope.fecha, scope.numero, scope.modo);
        if (!puedeEditar(scope) || editor) return;
        const actual = { ...scope, cabanaId: info?.cabanaId, loading: true, requestNumber: 0,
            folds: new Set(["area-" + modalidades[scope.modo].areas[0][0], "group-0-0"]), field: null, error: "", saving: false };
        const operativa = $(modalidades[actual.modo].panel);
        actual.inertAnterior = operativa.inert;
        operativa.inert = true;
        editor = actual;
        $("cabinsDetail").classList.add("pr-editing");
        render();
        mostrar();
        try {
            const result = actual.modo === "completa"
                ? await rpc("haku_revision_plantilla_editar_v1", { p_cabana_id: actual.cabanaId })
                : await rpc("haku_revision_modalidad_editar_v1", { p_tipo: actual.modo });
            if (editor !== actual) return;
            if (!Array.isArray(result?.groups) || !result.request_id) throw new Error("No se pudo abrir el editor.");
            Object.assign(actual, { baseline: result.groups, draft: result.groups, version: result.version_id,
                requestId: result.request_id, loading: false });
        } catch (error) {
            if (editor !== actual) return;
            actual.loading = false;
            actual.error = error.message || "No fue posible cargar la lista.";
        }
        render();
        $("cabinsReviewEditorTitle")?.focus();
    }

    function cerrar(foco = true) {
        const anterior = editor;
        editor = null;
        arrastre = null;
        if (anterior) $(modalidades[anterior.modo].panel).inert = anterior.inertAnterior;
        const dialog = $("cabinsReviewTemplateConfirm");
        if (dialog?.open) dialog.close();
        $("cabinsDetail")?.classList.remove("pr-editing");
        const host = $("cabinsReviewEditor");
        if (host) { host.hidden = true; host.replaceChildren(); }
        mostrar();
        if (foco) $("cabinsReviewCustomize")?.focus();
    }

    function accionesFila(group, item, index, count) {
        const data = ' data-group="' + escapado(group.id) + '" data-item="' + escapado(item.id) + '"';
        const nombre = escapado(item.label);
        return '<span class="pr-row-tools"><button type="button" class="pr-grip" draggable="true" data-action="drag"'
            + data + ' aria-label="Arrastrar ' + nombre + '">' + icono("grip") + '</button>'
            + '<button type="button" data-action="up"' + data + (index === 0 ? " disabled" : "")
            + ' aria-label="Subir ' + nombre + '">' + icono("up") + '</button>'
            + '<button type="button" data-action="down"' + data + (index === count - 1 ? " disabled" : "")
            + ' aria-label="Bajar ' + nombre + '">' + icono("move-down") + '</button>'
            + '<details class="pr-options"><summary aria-label="Opciones de ' + nombre + '">' + icono("more") + '</summary>'
            + '<div><button type="button" data-action="rename"' + data + '>Renombrar</button>'
            + '<button type="button" data-action="archive"' + data + '>Desactivar</button></div></details></span>';
    }

    function formulario(field) {
        return '<form class="pr-name-form"><input aria-label="' + (field.item ? "Nombre del elemento" : field.add ? "Nuevo elemento" : "Nombre de la subárea")
            + '" value="' + escapado(field.label) + '" maxlength="120" required>'
            + '<button type="submit">Aceptar</button><button type="button" data-action="cancel-name">Cancelar</button></form>';
    }

    function renderGrupo(group) {
        const groupId = escapado(group.id);
        const activos = group.items.filter(item => item.active);
        const field = editor.field?.group === group.id ? editor.field : null;
        const rows = activos.map((item, index) => '<div class="pr-item" data-drop-group="' + groupId + '" data-drop-item="' + escapado(item.id) + '">'
            + (field?.item === item.id ? formulario(field) : '<span class="pr-item-label"><span class="pr-preview-check" aria-hidden="true"></span>'
                + escapado(item.label) + (item.itemId ? "" : '<small class="pr-new">Nuevo</small>') + '</span>'
                + accionesFila(group, item, index, activos.length)) + "</div>").join("");
        const add = field?.add ? formulario(field) : '<button type="button" class="pr-add" data-action="add" data-group="' + groupId
            + '">' + icono("plus") + ' Agregar elemento</button>';
        if (group.label === null) return rows + add;
        const renaming = field && !field.item && !field.add;
        const name = renaming ? '' : '<button type="button" class="pr-rename-group" data-action="rename-group" data-group="'
            + groupId + '" aria-label="Renombrar ' + escapado(group.label) + '">' + icono("pencil") + '</button>';
        return '<details class="pr-group" data-fold="group-' + groupId + '"' + (editor.folds.has("group-" + group.id) ? " open" : "")
            + '><summary><span class="pr-fold"></span><strong>' + escapado(group.label) + '</strong>' + name + '<small>' + activos.length
            + (activos.length === 1 ? ' elemento' : ' elementos') + '</small></summary><div class="pr-group-body">'
            + (renaming ? formulario(field) : '') + rows + add + '</div></details>';
    }

    function render() {
        if (!editor) return;
        const host = $("cabinsReviewEditor");
        host.hidden = false;
        const cambios = editor.draft ? core.changes(editor.baseline, editor.draft) : [];
        const heading = '<div class="pr-heading"><div><h3 id="cabinsReviewEditorTitle" tabindex="-1">Editor de revisiones</h3>'
            + '<p>' + escapado(alcance(editor)) + ' · ' + etiqueta(editor) + '</p></div></div>';
        const toolbar = '<div class="pr-toolbar"><div class="pr-mode">' + icono("pencil") + '<span><strong>Modo edición</strong>'
            + '<small>' + cambios.length + (cambios.length === 1 ? ' cambio en borrador' : ' cambios en borrador')
            + '</small></span></div><span class="pr-preview">' + icono("eye") + ' Casillas de vista previa</span></div>';
        const groups = editor.draft || [];
        const definiciones = modalidades[editor.modo].areas;
        const areas = definiciones.map(([id, label, icon]) => {
            const areaGroups = groups.filter(group => group.id.split("-")[0] === id);
            if (!areaGroups.length) return "";
            const count = areaGroups.flatMap(group => group.items).filter(item => item.active).length;
            return '<details class="pr-area" data-fold="area-' + id + '"' + (editor.folds.has("area-" + id) ? " open" : "")
                + '><summary>' + icono(icon) + '<strong>' + label + '</strong><small>' + count
                + (count === 1 ? ' elemento' : ' elementos') + '</small><span class="pr-fold"></span></summary><div class="pr-area-body">'
                + areaGroups.map(renderGrupo).join("") + '</div></details>';
        });
        const archived = groups.flatMap(group => group.items.filter(item => !item.active).map(item => (
            '<div class="pr-archived-row"><span><strong>' + escapado(item.label) + '</strong><small>'
            + (definiciones.find(([id]) => id === group.id.split("-")[0])?.[1] || "") + (group.label ? ' · ' + escapado(group.label) : '')
            + '</small></span><button type="button" class="pr-add" data-action="restore" data-group="' + escapado(group.id)
            + '" data-item="' + escapado(item.id) + '">' + icono("recover") + ' Recuperar</button></div>'
        )));
        const archive = archived.length ? '<section class="pr-archive"><strong>' + icono("archive")
            + ' Elementos desactivados <small>' + archived.length + '</small></strong>' + archived.join("") + '</section>' : "";
        const error = editor.error ? '<p class="pr-error" role="alert">' + escapado(editor.error) + '</p>' : "";
        host.innerHTML = heading + toolbar + (editor.loading ? '<p role="status">Cargando lista…</p>' : "")
            + error + '<div class="pr-areas">' + areas.join("") + '</div>' + archive
            + '<div class="pr-footer"><button type="button" data-action="cancel">Cancelar</button>'
            + '<button class="pr-primary" type="button" data-action="confirm"' + (!cambios.length || editor.field ? ' disabled' : '')
            + '>Guardar cambios</button></div>';
        for (const fold of host.querySelectorAll("[data-fold]")) {
            const actual = editor;
            fold.addEventListener("toggle", () => {
                if (editor !== actual || !fold.isConnected) return;
                if (fold.open) editor.folds.add(fold.dataset.fold);
                else editor.folds.delete(fold.dataset.fold);
            });
        }
        if (editor.field) host.querySelector(".pr-name-form input")?.focus();
    }

    function confirmar() {
        const dialog = $("cabinsReviewTemplateConfirm");
        const cambios = core.changes(editor.baseline, editor.draft);
        if (!cambios.length || editor.field || dialog.open) return;
        const changeIcons = { rename: "pencil", add: "plus", archive: "archive", restore: "recover", move: "reorder" };
        dialog.innerHTML = '<div class="pr-confirm-heading">' + icono("clipboard")
            + '<div><h3 id="prConfirmTitle">Guardar cambios</h3><small>' + etiqueta(editor) + ' · ' + escapado(alcance(editor)) + '</small></div>'
            + '<button type="button" data-confirm="back" aria-label="Cerrar confirmación">' + icono("close") + '</button></div>'
            + '<strong class="pr-change-count">' + cambios.length + (cambios.length === 1 ? ' cambio' : ' cambios') + '</strong>'
            + '<ul class="pr-changes">' + cambios.map(change => '<li><span>' + icono(changeIcons[change.kind]) + escapado(change.label)
                + '</span><strong>' + escapado(change.detail) + '</strong></li>').join("") + '</ul>'
            + '<p class="pr-confirm-info">' + icono("info")
            + (editor.modo === "completa" ? 'El equipo verá los cambios en las próximas revisiones completas de esta cabaña.'
                : 'La lista se aplicará a las próximas revisiones de este tipo en todas las cabañas.')
            + ' Las revisiones iniciadas conservan su lista.</p>'
            + '<p class="pr-error" role="alert" hidden></p><div class="pr-confirm-actions"><button type="button" data-confirm="back">Volver</button>'
            + '<button class="pr-primary" type="button" data-confirm="apply">Aplicar a '
            + (editor.modo === "completa" ? escapado(alcance(editor)) : "todas las cabañas") + '</button></div>';
        dialog.showModal();
    }

    async function guardar(dialog) {
        const actual = editor;
        if (!actual?.draft || actual.saving) return;
        actual.saving = true;
        const buttons = dialog.querySelectorAll("button");
        buttons.forEach(button => { button.disabled = true; });
        try {
            const completa = actual.modo === "completa";
            const result = await rpc(completa ? "haku_revision_plantilla_guardar_v1" : "haku_revision_modalidad_guardar_v1", {
                ...(completa ? { p_cabana_id: actual.cabanaId } : { p_tipo: actual.modo }),
                p_version_id: actual.version, p_request_id: actual.requestId, p_groups: core.payload(actual.draft)
            });
            if (editor !== actual) return;
            if (!result?.version_id) throw new Error("No fue posible confirmar el guardado.");
            guardado = { ...result, key: actual.key };
            cerrar();
            if (completa) void window.HAIKU_REVISION_SUPABASE_V1?.prepararRevision(actual.numero);
            else if (actual.modo === "repaso") void window.HAIKU_REPASO_V2?.hidratar(actual.fecha);
            else void window.HAIKU_ASEO_OPERACION_V1?.hidratar(actual.fecha, { pintar: true });
        } catch (error) {
            if (editor !== actual) return;
            const notice = dialog.querySelector('[role="alert"]');
            notice.hidden = false;
            notice.textContent = error.message || "No se pudo guardar. Tu borrador se conserva.";
        } finally {
            actual.saving = false;
            buttons.forEach(button => { button.disabled = false; });
        }
    }

    function click(event) {
        const action = event.target.closest("[data-action]");
        if (!action || !editor) return;
        const { action: tipo, group, item } = action.dataset;
        if (tipo === "rename-group") event.preventDefault();
        if (tipo === "cancel") return cerrar();
        if (tipo === "confirm") return confirmar();
        if (tipo === "drag" || !editor.draft || (editor.field && tipo !== "cancel-name")) return;
        const selected = editor.draft.find(row => row.id === group);
        const entry = selected?.items.find(row => row.id === item);
        if (tipo === "cancel-name") editor.field = null;
        else if (tipo === "rename" || tipo === "rename-group" || tipo === "add") {
            if (tipo === "rename-group") editor.folds.add("group-" + group);
            editor.field = { group, item, add: tipo === "add", label: tipo === "add" ? "" : entry?.label ?? selected.label };
        } else if (tipo === "archive" || tipo === "restore") {
            editor.draft = core.setItemActive(editor.draft, group, item, tipo === "restore", tipo === "archive" && !entry.itemId);
        } else if (tipo === "up" || tipo === "down") {
            editor.draft = core.moveItem(editor.draft, group, item, tipo === "up" ? -1 : 1);
        }
        render();
    }

    function submit(event) {
        event.preventDefault();
        const field = editor?.field;
        const input = event.target.querySelector("input");
        if (!field || !input) return;
        const value = input.value.trim();
        if (!core.validLabel(value)) {
            input.setCustomValidity("Escribe un nombre de hasta 120 caracteres.");
            input.reportValidity();
            input.addEventListener("input", () => input.setCustomValidity(""), { once: true });
            return;
        }
        if (field.add) editor.draft = core.addItem(editor.draft, field.group,
            "nuevo-" + editor.requestId + "-" + ++editor.requestNumber, value);
        else if (field.item) editor.draft = core.renameItem(editor.draft, field.group, field.item, value);
        else editor.draft = core.renameGroup(editor.draft, field.group, value);
        editor.field = null;
        render();
    }

    function iniciar() {
        const host = $("cabinsReviewEditor"), dialog = $("cabinsReviewTemplateConfirm");
        if (!host || !dialog) return;
        $("cabinsReviewCustomize").addEventListener("click", abrir);
        host.addEventListener("click", click);
        host.addEventListener("submit", submit);
        host.addEventListener("dragstart", event => {
            const handle = event.target.closest(".pr-grip");
            if (!handle || !editor?.draft) return;
            arrastre = { group: handle.dataset.group, item: handle.dataset.item };
            event.dataTransfer?.setData("text/plain", arrastre.item);
        });
        host.addEventListener("dragover", event => {
            if (arrastre && event.target.closest("[data-drop-group]")?.dataset.dropGroup === arrastre.group) event.preventDefault();
        });
        host.addEventListener("drop", event => {
            const target = event.target.closest("[data-drop-group]");
            const drag = arrastre;
            arrastre = null;
            if (!editor?.draft || !drag || target?.dataset.dropGroup !== drag.group) return;
            event.preventDefault();
            const active = editor.draft.find(group => group.id === drag.group).items.filter(item => item.active);
            const from = active.findIndex(item => item.id === drag.item);
            const to = active.findIndex(item => item.id === target.dataset.dropItem);
            if (from < 0 || to < 0 || from === to) return;
            const direction = to > from ? 1 : -1;
            for (let i = from; i !== to; i += direction) {
                editor.draft = core.moveItem(editor.draft, drag.group, drag.item, direction);
            }
            render();
        });
        host.addEventListener("dragend", () => { arrastre = null; });
        dialog.addEventListener("click", event => {
            const accion = event.target.closest("[data-confirm]")?.dataset.confirm;
            if (accion === "apply") void guardar(dialog);
            else if (accion === "back" && !editor?.saving) dialog.close();
        });
        dialog.addEventListener("cancel", event => { if (editor?.saving) event.preventDefault(); });
    }

    window.addEventListener("haiku:auth-ready", () => {
        const identidad = identidadSesion();
        if (identidad === sesionEditor) return;
        sesionEditor = identidad;
        contextos.clear();
        permisosCompartidos.clear();
        indisponibles.clear();
        guardado = null;
        if (editor) cerrar(false);
        mostrar();
    });
    window.HAIKU_REVISION_PLANTILLA_V1 = Object.freeze({
        leer, publicar, plantillaDe, contexto, aplicarChecklist, configurarItems, actualizarAlcance
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    else iniciar();
})();
