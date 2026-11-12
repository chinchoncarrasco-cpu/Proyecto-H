// HAIKU · Finalización de turno. Las decisiones se validan con el estado guardado.
(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    const seccion = document.getElementById("seccion-cierre");
    const montaje = seccion?.querySelector("#sites-cierre-final-slot");
    if (!cliente || !montaje) return;

    const TIPO_TURNO = "cierre_diario";
    const fechaActual = () => typeof fechaSeleccionada === "string" ? fechaSeleccionada.slice(0, 10) : "";
    const esCerrado = estado => ["cerrado", "cerrado_con_pendientes"].includes(estado);
    let estadoActual = null;
    let fechaEstado = "";
    let lectura = null;
    let ocupado = false;
    let fechaResumen = "";
    let timerEstado;

    const panel = document.createElement("section");
    panel.id = "turno-final-supabase";
    panel.className = "turno-final";
    panel.setAttribute("aria-labelledby", "turno-final-titulo");
    panel.innerHTML = `
        <h3 id="turno-final-titulo">Finalizar turno</h3>
        <p class="turno-final-message" data-cierre-final-mensaje role="status">Cargando estado del cierre…</p>
        <label class="turno-field" data-cierre-final-resumen-wrap hidden>
            <span>Resumen de entrega</span>
            <textarea id="cierre-final-resumen" rows="3" placeholder="Deja una indicación para el siguiente turno"></textarea>
        </label>
        <div class="turno-closed-info" data-cierre-final-info hidden></div>
        <div class="turno-actions turno-final-actions">
            <button type="button" class="turno-button turno-primary" data-cierre-final-cerrar hidden>Cerrar turno</button>
            <button type="button" class="turno-button" data-cierre-final-reabrir hidden>Reabrir cierre</button>
            <button type="button" class="turno-link" data-cierre-final-reintentar hidden>Reintentar carga</button>
        </div>`;
    montaje.append(panel);

    const resumen = panel.querySelector("#cierre-final-resumen");
    const mensaje = panel.querySelector("[data-cierre-final-mensaje]");
    const cerrar = panel.querySelector("[data-cierre-final-cerrar]");
    const reabrir = panel.querySelector("[data-cierre-final-reabrir]");
    const reintentar = panel.querySelector("[data-cierre-final-reintentar]");
    const info = panel.querySelector("[data-cierre-final-info]");

    function puedeReabrirLocal() {
        const sesion = window.haikuSesion || {};
        const permisos = Array.isArray(sesion.permisos) ? sesion.permisos : [];
        const roles = Array.isArray(sesion.roles) ? sesion.roles : [];
        return permisos.some(permiso => (permiso?.codigo || permiso?.nombre || permiso) === "cierres.reabrir")
            || roles.some(rol => ["administrador", "manager"]
                .includes(String(rol?.codigo || rol?.nombre || rol).toLowerCase()));
    }

    function bloquearEdicion(bloquear) {
        seccion.classList.toggle("haiku-cierre-bloqueado", bloquear);
        seccion.querySelectorAll(
            "[data-cierre-codigo], textarea[data-cierre-campo], [data-evidencia-input], [data-evidencia-adjuntar], [data-evidencia-pegar]"
        ).forEach(control => { control.disabled = bloquear; });
        window.HAIKU_SITES_CIERRE_V1?.actualizar();
    }

    function prepararFecha() {
        estadoActual = null;
        lectura = null;
        cerrar.hidden = true;
        reabrir.hidden = true;
        reintentar.hidden = true;
        info.hidden = true;
        resumen.closest("label").hidden = true;
        mensaje.textContent = "Cargando estado del cierre…";
        bloquearEdicion(true);
    }

    async function obtenerEstado(fecha) {
        const parametros = { p_fecha: fecha, p_tipo_turno: TIPO_TURNO };
        const base = await cliente.rpc("haiku_asegurar_cierre_dia", parametros);
        if (base.error) throw base.error;
        const { data, error } = await cliente.rpc("haiku_estado_cierre_dia", parametros);
        if (error) throw error;
        return data;
    }

    function renderEstado(estado, fecha) {
        if (!estado || fecha !== fechaActual()) return;
        estadoActual = estado;
        fechaEstado = fecha;
        const cerrado = esCerrado(estado.cierre_estado);
        const pendientes = Number(estado.pendientes || 0);
        if (fechaResumen !== fecha || cerrado) {
            resumen.value = estado.resumen_entrega || "";
            fechaResumen = fecha;
        }
        const lista = window.HAIKU_SITES_CIERRE_V1?.version() === estado.plantilla_version;
        reintentar.hidden = lista;
        resumen.closest("label").hidden = cerrado || !lista;
        resumen.required = !cerrado && pendientes > 0;
        cerrar.hidden = cerrado || !lista;
        cerrar.textContent = pendientes ? `Cerrar con pendientes (${pendientes})` : "Cerrar turno";
        reabrir.hidden = !cerrado || !puedeReabrirLocal();
        info.hidden = !cerrado;
        info.replaceChildren();
        bloquearEdicion(cerrado || !lista);

        if (cerrado) {
            mensaje.textContent = estado.cierre_estado === "cerrado"
                ? "Turno cerrado." : "Turno cerrado con pendientes.";
            if (estado.cerrado_en) {
                const hora = new Intl.DateTimeFormat("es-CL", {
                    dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago"
                }).format(new Date(estado.cerrado_en));
                const cierre = document.createElement("p");
                cierre.textContent = `Registrado el ${hora}`;
                info.append(cierre);
            }
            if (estado.resumen_entrega) {
                const titulo = document.createElement("strong");
                titulo.textContent = resumen.closest("label").querySelector("span").textContent;
                const entrega = document.createElement("p");
                entrega.textContent = estado.resumen_entrega;
                info.append(titulo, entrega);
            }
            info.hidden = !info.childElementCount;
        } else {
            mensaje.textContent = !lista ? "Cargando controles del turno…" : pendientes > 0
                ? "Si cierras con pendientes, escribe un resumen de entrega."
                : "Puedes cerrar el turno. El resumen es opcional.";
        }

        window.dispatchEvent(new CustomEvent("haiku:cierre-estado-actualizado", { detail: estado }));
    }

    function refrescarEstado() {
        const fecha = fechaActual();
        if (!fecha) return Promise.resolve();
        if (lectura?.fecha === fecha) return lectura.promesa;

        const consulta = { fecha };
        lectura = consulta;
        consulta.promesa = obtenerEstado(fecha).then(estado => {
            if (lectura === consulta) renderEstado(estado, fecha);
        }).catch(error => {
            console.error("HAIKU · No fue posible obtener el estado del cierre:", error);
            if (lectura === consulta && !estadoActual) {
                mensaje.textContent = "No se pudo consultar el estado del cierre.";
                reintentar.hidden = false;
            }
        }).finally(() => {
            if (lectura === consulta) lectura = null;
        });
        return consulta.promesa;
    }

    async function cerrarTurno() {
        const fecha = fechaActual();
        if (ocupado || !fecha || fecha !== fechaEstado || !estadoActual || esCerrado(estadoActual.cierre_estado)) return;
        ocupado = true;
        cerrar.disabled = true;

        try {
            await window.haikuEsperarGuardadosCierre?.(fecha);
            if (fecha !== fechaActual()) return;
            const estado = await obtenerEstado(fecha);
            if (fecha !== fechaActual()) return;
            lectura = null;
            renderEstado(estado, fecha);
            if (esCerrado(estado.cierre_estado)) return;
            const version = window.HAIKU_SITES_CIERRE_V1?.version();
            if (version !== estado.plantilla_version) {
                await window.haikuCargarCierreSupabase?.(fecha);
                return;
            }
            const pendientes = Number(estado.pendientes || 0);
            const texto = resumen.value.trim();
            if (pendientes > 0 && !texto) {
                window.HAIKU_DIALOGOS.aviso("Quedan pendientes. Escribe un resumen de entrega antes de cerrar el turno.");
                resumen.focus();
                return;
            }

            const pregunta = pendientes > 0
                ? `Quedan ${pendientes} controles pendientes. ¿Cerrar el turno con el resumen de entrega?`
                : "¿Cerrar este turno?";
            if (!(await window.HAIKU_DIALOGOS.confirmar(pregunta, {
                titulo: "Cerrar el turno", accion: "Cerrar turno", contexto: "Cierre de turno",
                resumen: [["Fecha", fecha], ["Pendientes", pendientes]], advertencia: pendientes > 0
            }))) return;
            if (fecha !== fechaActual()) return;

            cerrar.textContent = "Cerrando…";
            const { data, error } = await cliente.rpc("haiku_cerrar_turno_personificado_v1", {
                p_fecha: fecha, p_resumen_entrega: texto || null, p_tipo_turno: TIPO_TURNO, p_version: version
            });
            if (error) throw error;
            lectura = null;
            renderEstado(data, fecha);
            await window.haikuCargarCierreSupabase?.(fecha);
            window.HAIKU_DIALOGOS.aviso(data?.cierre_estado === "cerrado_con_pendientes"
                ? "Turno cerrado con pendientes y entrega registrada." : "Turno cerrado correctamente.");
        } catch (error) {
            console.error("HAIKU · No fue posible cerrar el turno:", error);
            window.HAIKU_DIALOGOS.aviso(error?.message || "No fue posible cerrar el turno.");
            await refrescarEstado();
        } finally {
            ocupado = false;
            cerrar.disabled = false;
        }
    }

    async function reabrirCierre() {
        const fecha = fechaActual();
        if (ocupado || !fecha || fecha !== fechaEstado || !esCerrado(estadoActual?.cierre_estado) || !puedeReabrirLocal()) return;
        ocupado = true;
        reabrir.disabled = true;
        try {
            const motivo = await window.HAIKU_DIALOGOS.solicitar(
                "Motivo de reapertura del cierre:", "Corrección de cierre", { contexto: `Cierre de turno · ${fecha}` }
            );
            if (motivo === null || fecha !== fechaActual()) return;
            if (!motivo.trim()) {
                window.HAIKU_DIALOGOS.aviso("El motivo de reapertura es obligatorio.");
                return;
            }
            reabrir.textContent = "Reabriendo…";
            const { data, error } = await cliente.rpc("haiku_reabrir_cierre_dia", {
                p_fecha: fecha, p_motivo: motivo.trim(), p_tipo_turno: TIPO_TURNO
            });
            if (error) throw error;
            lectura = null;
            renderEstado(data, fecha);
            await window.haikuCargarCierreSupabase?.(fecha);
            window.HAIKU_DIALOGOS.aviso("Cierre reabierto correctamente.");
        } catch (error) {
            console.error("HAIKU · No fue posible reabrir el turno:", error);
            window.HAIKU_DIALOGOS.aviso(error?.message || "No fue posible reabrir el turno.");
            await refrescarEstado();
        } finally {
            ocupado = false;
            reabrir.disabled = false;
            reabrir.textContent = "Reabrir cierre";
        }
    }

    cerrar.addEventListener("click", cerrarTurno);
    reabrir.addEventListener("click", reabrirCierre);
    reintentar.addEventListener("click", () => {
        prepararFecha();
        window.haikuRefrescarCierreAlEntrar?.();
        refrescarEstado();
    });
    window.addEventListener("haiku:cierre-fecha-cambiada", () => {
        prepararFecha();
        if (seccion.classList.contains("activa")) refrescarEstado();
    });
    window.addEventListener("haiku:cierre-plantilla-cargada", event => {
        if (!estadoActual || event.detail.fecha !== fechaEstado) return;
        if (event.detail.version === estadoActual.plantilla_version) renderEstado(estadoActual, fechaEstado);
        else {
            lectura = null;
            refrescarEstado();
        }
    });
    window.addEventListener("haiku:cierre-respuesta-guardada", event => {
        if (event.detail?.fecha !== fechaActual()) return;
        clearTimeout(timerEstado);
        timerEstado = setTimeout(refrescarEstado, 120);
    });

    window.haikuRefrescarEstadoCierre = refrescarEstado;
    prepararFecha();
    if (seccion.classList.contains("activa") && window.haikuSesion) refrescarEstado();
})();
