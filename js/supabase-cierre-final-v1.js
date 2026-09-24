// ========================================
// HAIKU · CIERRE DEFINITIVO · SUPABASE V1
// Cierra/reabre turno y bloquea edición al cerrar.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const TIPO_TURNO = "cierre_diario";
    let estadoActual = null;
    let refrescando = false;

    function fechaActual() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
        } catch {
            return "";
        }
    }

    function esCerrado(estado) {
        return ["cerrado", "cerrado_con_pendientes"].includes(estado);
    }

    function puedeReabrirLocal() {
        const sesion = window.haikuSesion || {};
        const roles = Array.isArray(sesion.roles) ? sesion.roles : [];
        const permisos = Array.isArray(sesion.permisos) ? sesion.permisos : [];

        const tieneRol = roles.some(rol => {
            const codigo = typeof rol === "string"
                ? rol
                : (rol?.codigo || rol?.nombre || "");
            return ["administrador", "manager"].includes(String(codigo).toLowerCase());
        });

        const tienePermiso = permisos.some(permiso => {
            const codigo = typeof permiso === "string"
                ? permiso
                : (permiso?.codigo || permiso?.nombre || "");
            return String(codigo) === "cierres.reabrir";
        });

        return tieneRol || tienePermiso;
    }

    function formatearFechaHora(valor) {
        if (!valor) return "";
        try {
            return new Intl.DateTimeFormat("es-CL", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Santiago"
            }).format(new Date(valor));
        } catch {
            return String(valor);
        }
    }

    function asegurarPanel() {
        const seccion = document.getElementById("seccion-cierre");
        if (!seccion) return null;

        let panel = document.getElementById("cierre-final-supabase");
        if (panel) return panel;

        panel = document.createElement("section");
        panel.id = "cierre-final-supabase";
        panel.className = "cierre-final-supabase";
        panel.innerHTML = `
            <div class="cierre-final-cabecera">
                <div>
                    <h3>Finalizar turno</h3>
                    <p>Guarda un cierre histórico y congela el estado del turno.</p>
                </div>
                <span class="cierre-final-badge" data-cierre-final-badge>Borrador</span>
            </div>

            <div class="cierre-final-metricas">
                <div class="cierre-final-metrica">
                    <span>Completado</span>
                    <strong data-cierre-final-porcentaje>—</strong>
                </div>
                <div class="cierre-final-metrica">
                    <span>Revisiones OK</span>
                    <strong data-cierre-final-completados>—</strong>
                </div>
                <div class="cierre-final-metrica">
                    <span>Pendientes</span>
                    <strong data-cierre-final-pendientes>—</strong>
                </div>
            </div>

            <div class="cierre-final-resumen-wrap" data-cierre-final-resumen-wrap>
                <label for="cierre-final-resumen">Resumen de entrega</label>
                <textarea
                    id="cierre-final-resumen"
                    class="cierre-final-resumen"
                    placeholder="Si quedan pendientes, indica aquí qué debe saber el siguiente turno."
                ></textarea>
            </div>

            <p class="cierre-final-mensaje" data-cierre-final-mensaje>
                Calculando estado del cierre…
            </p>

            <div class="cierre-final-cerrado-info" data-cierre-final-info hidden></div>

            <div class="cierre-final-acciones">
                <button
                    type="button"
                    class="cierre-final-boton primario"
                    data-cierre-final-cerrar
                >
                    Cerrar turno
                </button>

                <button
                    type="button"
                    class="cierre-final-boton reabrir"
                    data-cierre-final-reabrir
                    hidden
                >
                    Reabrir cierre
                </button>
            </div>
        `;

        (seccion.querySelector("#sites-cierre-final-slot") || seccion).appendChild(panel);

        panel.querySelector("[data-cierre-final-cerrar]")?.addEventListener("click", cerrarTurno);
        panel.querySelector("[data-cierre-final-reabrir]")?.addEventListener("click", reabrirCierre);

        return panel;
    }

    function bloquearEdicion(bloquear) {
        const seccion = document.getElementById("seccion-cierre");
        const panel = document.getElementById("cierre-final-supabase");
        if (!seccion) return;

        seccion.classList.toggle("haiku-cierre-bloqueado", bloquear);

        seccion.querySelectorAll(
            "input[type='checkbox'], input[type='radio'], textarea[data-cierre-campo], input[data-evidencia-input], button[data-evidencia-pegar]"
        ).forEach(el => {
            if (panel?.contains(el)) return;
            el.disabled = bloquear;
        });

        seccion.querySelectorAll("[data-evidencia-zona]").forEach(zona => {
            if (bloquear) {
                zona.dataset.haikuTabindexAnterior = String(zona.getAttribute("tabindex") ?? "0");
                zona.setAttribute("tabindex", "-1");
                zona.style.pointerEvents = "none";
            } else {
                const anterior = zona.dataset.haikuTabindexAnterior;
                zona.setAttribute("tabindex", anterior || "0");
                zona.style.pointerEvents = "";
            }
        });
    }

    async function asegurarCierre(fecha) {
        const { data, error } = await cliente.rpc(
            "haiku_asegurar_cierre_dia",
            {
                p_fecha: fecha,
                p_tipo_turno: TIPO_TURNO
            }
        );
        if (error) throw error;
        return data;
    }

    async function obtenerEstado(fecha) {
        await asegurarCierre(fecha);

        const { data, error } = await cliente.rpc(
            "haiku_estado_cierre_dia",
            {
                p_fecha: fecha,
                p_tipo_turno: TIPO_TURNO
            }
        );
        if (error) throw error;
        return data;
    }

    function renderEstado(estado) {
        estadoActual = estado || null;
        const panel = asegurarPanel();
        if (!panel || !estado) return;

        const cierreEstado = String(estado.cierre_estado || "borrador");
        const cerrado = esCerrado(cierreEstado);
        const pendientes = Number(estado.pendientes || 0);
        const completados = Number(estado.completados || 0);
        const total = Number(estado.total_requeridos || 0);
        const porcentaje = Number(estado.porcentaje || 0);

        panel.classList.toggle("cerrado", cierreEstado === "cerrado");
        panel.classList.toggle("cerrado-con-pendientes", cierreEstado === "cerrado_con_pendientes");

        const badge = panel.querySelector("[data-cierre-final-badge]");
        const porcentajeEl = panel.querySelector("[data-cierre-final-porcentaje]");
        const completadosEl = panel.querySelector("[data-cierre-final-completados]");
        const pendientesEl = panel.querySelector("[data-cierre-final-pendientes]");
        const mensaje = panel.querySelector("[data-cierre-final-mensaje]");
        const resumenWrap = panel.querySelector("[data-cierre-final-resumen-wrap]");
        const resumen = panel.querySelector("#cierre-final-resumen");
        const cerrarBtn = panel.querySelector("[data-cierre-final-cerrar]");
        const reabrirBtn = panel.querySelector("[data-cierre-final-reabrir]");
        const info = panel.querySelector("[data-cierre-final-info]");

        if (porcentajeEl) porcentajeEl.textContent = `${porcentaje}%`;
        if (completadosEl) completadosEl.textContent = `${completados}/${total}`;
        if (pendientesEl) pendientesEl.textContent = String(pendientes);

        if (badge) {
            badge.classList.remove("ok", "pendiente");
            if (cierreEstado === "cerrado") {
                badge.textContent = "✓ Cerrado";
                badge.classList.add("ok");
            } else if (cierreEstado === "cerrado_con_pendientes") {
                badge.textContent = "✓ Cerrado con pendientes";
                badge.classList.add("pendiente");
            } else if (cierreEstado === "reabierto") {
                badge.textContent = "Reabierto";
                badge.classList.add("pendiente");
            } else {
                badge.textContent = "Borrador";
                if (pendientes > 0) badge.classList.add("pendiente");
            }
        }

        if (resumen && document.activeElement !== resumen) {
            resumen.value = estado.resumen_entrega || resumen.value || "";
        }

        if (cerrado) {
            bloquearEdicion(true);
            if (resumenWrap) resumenWrap.hidden = true;
            if (cerrarBtn) cerrarBtn.hidden = true;

            if (reabrirBtn) {
                reabrirBtn.hidden = !puedeReabrirLocal();
            }

            if (mensaje) {
                mensaje.textContent = cierreEstado === "cerrado"
                    ? "El turno quedó cerrado y sus controles están bloqueados."
                    : "El turno quedó cerrado dejando pendientes documentados para el siguiente turno.";
            }

            if (info) {
                const resumenTexto = estado.resumen_entrega
                    ? `<br><strong>Entrega:</strong> ${escaparHtml(estado.resumen_entrega)}`
                    : "";
                info.innerHTML = `
                    <strong>Cierre histórico guardado</strong>
                    ${estado.cerrado_en ? `Cerrado: ${escaparHtml(formatearFechaHora(estado.cerrado_en))}` : ""}
                    ${resumenTexto}
                `;
                info.hidden = false;
            }
        } else {
            bloquearEdicion(false);
            if (resumenWrap) resumenWrap.hidden = false;
            if (cerrarBtn) {
                cerrarBtn.hidden = false;
                cerrarBtn.textContent = pendientes > 0
                    ? `Cerrar con pendientes (${pendientes})`
                    : "Cerrar turno";
            }
            if (reabrirBtn) reabrirBtn.hidden = true;
            if (info) info.hidden = true;

            if (mensaje) {
                mensaje.textContent = pendientes > 0
                    ? "Puedes seguir completando el cierre o cerrarlo con pendientes. En ese caso el resumen de entrega es obligatorio."
                    : "Todos los controles requeridos están completos. El turno puede cerrarse sin pendientes.";
            }
        }
        window.dispatchEvent(new CustomEvent("haiku:cierre-estado-actualizado", { detail: estado }));
    }

    function escaparHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    async function refrescarEstado() {
        const fecha = fechaActual();
        if (!fecha || refrescando) return;

        refrescando = true;
        try {
            asegurarPanel();
            const estado = await obtenerEstado(fecha);
            renderEstado(estado);
            console.info("HAIKU · Estado cierre definitivo:", fecha, estado);
        } catch (error) {
            console.error("HAIKU · No fue posible obtener estado de cierre:", error);
        } finally {
            refrescando = false;
        }
    }

    async function cerrarTurno() {
        const fecha = fechaActual();
        const panel = asegurarPanel();
        if (!fecha || !panel || !estadoActual) return;

        const pendientes = Number(estadoActual.pendientes || 0);
        const resumen = String(
            panel.querySelector("#cierre-final-resumen")?.value || ""
        ).trim();

        if (pendientes > 0 && !resumen) {
            alert("Quedan pendientes. Escribe un resumen de entrega antes de cerrar el turno.");
            panel.querySelector("#cierre-final-resumen")?.focus();
            return;
        }

        const pregunta = pendientes > 0
            ? `Este cierre tiene ${pendientes} pendiente(s). ¿Cerrar igualmente y dejar el resumen para el siguiente turno?`
            : "¿Cerrar definitivamente este turno? Después quedará bloqueado para edición normal.";

        if (!confirm(pregunta)) return;

        const boton = panel.querySelector("[data-cierre-final-cerrar]");
        if (boton) {
            boton.disabled = true;
            boton.textContent = "Cerrando…";
        }

        try {
            const { data, error } = await cliente.rpc(
                "haiku_cerrar_turno_dia",
                {
                    p_fecha: fecha,
                    p_resumen_entrega: resumen || null,
                    p_tipo_turno: TIPO_TURNO
                }
            );

            if (error) throw error;

            renderEstado(data);

            if (typeof window.haikuCargarCierreSupabase === "function") {
                await window.haikuCargarCierreSupabase(fecha, { forzarRender: true });
            }

            await refrescarEstado();

            alert(
                data?.cierre_estado === "cerrado_con_pendientes"
                    ? "Turno cerrado con pendientes y entrega registrada."
                    : "Turno cerrado correctamente."
            );
        } catch (error) {
            console.error("HAIKU · No fue posible cerrar el turno:", error);
            alert(error?.message || "No fue posible cerrar el turno.");
            await refrescarEstado();
        } finally {
            if (boton) boton.disabled = false;
        }
    }

    async function reabrirCierre() {
        const fecha = fechaActual();
        if (!fecha || !estadoActual || !esCerrado(estadoActual.cierre_estado)) return;

        const motivo = prompt(
            "Motivo de reapertura del cierre:",
            "Corrección de cierre"
        );

        if (motivo === null) return;
        if (!motivo.trim()) {
            alert("El motivo de reapertura es obligatorio.");
            return;
        }

        if (!confirm("¿Reabrir este cierre? Los controles volverán a quedar editables.")) return;

        const panel = asegurarPanel();
        const boton = panel?.querySelector("[data-cierre-final-reabrir]");
        if (boton) {
            boton.disabled = true;
            boton.textContent = "Reabriendo…";
        }

        try {
            const { data, error } = await cliente.rpc(
                "haiku_reabrir_cierre_dia",
                {
                    p_fecha: fecha,
                    p_motivo: motivo.trim(),
                    p_tipo_turno: TIPO_TURNO
                }
            );

            if (error) throw error;

            renderEstado(data);
            bloquearEdicion(false);

            if (typeof window.haikuCargarCierreSupabase === "function") {
                await window.haikuCargarCierreSupabase(fecha, { forzarRender: true });
            }

            await refrescarEstado();
            alert("Cierre reabierto correctamente.");
        } catch (error) {
            console.error("HAIKU · No fue posible reabrir el cierre:", error);
            alert(error?.message || "No fue posible reabrir el cierre.");
        } finally {
            if (boton) {
                boton.disabled = false;
                boton.textContent = "Reabrir cierre";
            }
        }
    }

    // Evita mutaciones legacy por pegado/cambio si el cierre está bloqueado.
    document.addEventListener("paste", event => {
        if (!estadoActual || !esCerrado(estadoActual.cierre_estado)) return;
        const seccion = document.getElementById("seccion-cierre");
        if (seccion?.contains(event.target)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    document.addEventListener("click", event => {
        const enlace = event.target?.closest?.('[data-seccion="cierre"], [data-seccion="cierre-turno"]');
        if (enlace) {
            setTimeout(refrescarEstado, 260);
        }
    }, true);

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(refrescarEstado, 450);
    });

    window.addEventListener("haiku:cierre-respuesta-guardada", () => {
        setTimeout(refrescarEstado, 120);
    });

    // Refresco suave cuando el usuario cambia un control de cierre.
    document.addEventListener("change", event => {
        const seccion = document.getElementById("seccion-cierre");
        if (!seccion?.contains(event.target)) return;
        if (esCerrado(estadoActual?.cierre_estado)) return;
        setTimeout(refrescarEstado, 350);
    }, false);

    setTimeout(() => {
        asegurarPanel();
        if (window.haikuSesion) refrescarEstado();
    }, 700);

    window.haikuRefrescarEstadoCierre = refrescarEstado;

    console.info("HAIKU · Cierre definitivo Supabase V1 preparado.");
})();
