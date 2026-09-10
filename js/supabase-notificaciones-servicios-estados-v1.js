// ========================================
// HAIKU · NOTIFICACIONES · SERVICIOS DEL DÍA V1
// Hace visible en la campana la dinámica completa:
// Actual / Próxima / Pendiente / Completada / Cancelada.
// + Acceso directo al servicio y cierre rápido de tinajas finalizadas.
// ========================================
(() => {
    "use strict";

    let timer = null;

    function listaServicios() {
        try {
            if (typeof serviciosRegistrados !== "undefined" && Array.isArray(serviciosRegistrados)) {
                return serviciosRegistrados;
            }
        } catch {}

        try {
            const lista = JSON.parse(localStorage.getItem("haikuServicios") || "[]");
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function fechaVista() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function esc(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function estado(servicio, listaDia) {
        try {
            if (typeof window.haikuEstadoTemporalServicio === "function") {
                return window.haikuEstadoTemporalServicio(servicio, listaDia);
            }
        } catch {}

        const bruto = String(servicio?.estadoServicioDb || servicio?.estadoServicio || "");
        if (["cancelado", "cancelada", "no_show"].includes(bruto)) {
            return { clave: "cancelada", etiqueta: "Cancelada" };
        }
        if (["realizado", "completada"].includes(bruto)) {
            return { clave: "completada", etiqueta: "Completada" };
        }
        return { clave: "pendiente", etiqueta: "Pendiente" };
    }

    function relojChile() {
        const partes = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Santiago",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).formatToParts(new Date());

        const datos = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
        return {
            fecha: `${datos.year}-${datos.month}-${datos.day}`,
            minutos: Number(datos.hour || 0) * 60 + Number(datos.minute || 0)
        };
    }

    function minutosHora(hora) {
        const [h, m] = String(hora || "").slice(0, 5).split(":").map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        return h * 60 + m;
    }

    function duracionTinaja(servicio) {
        const inicio = minutosHora(servicio?.hora);
        const fin = minutosHora(servicio?.horaFin);
        if (inicio !== null && fin !== null && fin > inicio) return fin - inicio;

        const directa = Number(servicio?.duracionMinutos || 0);
        if (directa > 0) return directa;

        return Math.max(1, Number(servicio?.cantidad || 1)) * 60;
    }

    function tinajaFinalizada(servicio) {
        if (String(servicio?.categoria || "").toLowerCase() !== "tinaja") return false;

        const estadoDb = String(servicio?.estadoServicioDb || servicio?.estadoServicio || "").toLowerCase();
        if (["cancelado", "cancelada", "no_show", "realizado", "completada"].includes(estadoDb)) {
            return false;
        }

        const fecha = String(servicio?.fechaServicio || servicio?.fecha || "").slice(0, 10);
        const inicio = minutosHora(servicio?.hora);
        if (!fecha || inicio === null) return false;

        const reloj = relojChile();
        if (fecha < reloj.fecha) return true;
        if (fecha > reloj.fecha) return false;

        return reloj.minutos >= inicio + duracionTinaja(servicio);
    }

    function buscarServicioPorId(id) {
        return listaServicios().find(servicio => String(servicio?.id || "") === String(id || "")) || null;
    }

    function cerrarNotificaciones() {
        try {
            if (typeof cerrarPanelNotificaciones === "function") {
                cerrarPanelNotificaciones();
                return;
            }
        } catch {}

        const panel = document.getElementById("panel-notificaciones");
        if (panel) panel.hidden = true;
    }

    function buscarTarjetaAgenda(servicioId) {
        return [...document.querySelectorAll("#servicios-agenda [data-haiku-servicio-id]")]
            .find(elemento => String(elemento.dataset.haikuServicioId || "") === String(servicioId || "")) || null;
    }

    function enfocarTarjetaAgenda(servicioId, intento = 0) {
        const tarjeta = buscarTarjetaAgenda(servicioId);
        if (!tarjeta) {
            if (intento < 14) {
                setTimeout(() => enfocarTarjetaAgenda(servicioId, intento + 1), 90);
            }
            return;
        }

        tarjeta.scrollIntoView({ behavior: "smooth", block: "center" });
        tarjeta.classList.add("haiku-servicio-enfocado-desde-notificacion");
        setTimeout(() => tarjeta.classList.remove("haiku-servicio-enfocado-desde-notificacion"), 2600);
    }

    function abrirServicioEnAgenda(item) {
        const servicioId = item?.dataset?.servicioId || "";
        if (!servicioId) return;

        cerrarNotificaciones();

        const botonServicios = document.querySelector('.menu-item[data-seccion="servicios"]');
        botonServicios?.click();

        try { window.renderizarAgendaServicios?.(); } catch {}
        setTimeout(() => enfocarTarjetaAgenda(servicioId), 60);
    }

    function inyectarEstilosAcciones() {
        if (document.getElementById("haiku-notif-servicios-acciones-style")) return;

        const estilo = document.createElement("style");
        estilo.id = "haiku-notif-servicios-acciones-style";
        estilo.textContent = `
            #notificaciones-contenido .haiku-notif-servicio-acciones {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 12px;
                margin: 2px 7px 8px;
                padding: 0 2px;
                line-height: 1.2;
            }

            #notificaciones-contenido .haiku-notif-servicio-accion {
                appearance: none;
                border: 0;
                background: transparent;
                padding: 2px 0;
                font: inherit;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: .01em;
                cursor: pointer;
                opacity: .84;
            }

            #notificaciones-contenido .haiku-notif-servicio-accion:hover,
            #notificaciones-contenido .haiku-notif-servicio-accion:focus-visible {
                opacity: 1;
                text-decoration: underline;
                text-underline-offset: 2px;
            }

            #notificaciones-contenido .haiku-notif-servicio-realizado {
                color: #2f7350;
            }

            #notificaciones-contenido .haiku-notif-servicio-cancelar {
                color: #8b5a5a;
            }

            #notificaciones-contenido .haiku-notif-servicio-finalizado .haiku-notif-servicio-etiqueta {
                color: #765a20;
                font-weight: 700;
            }

            #servicios-agenda .haiku-servicio-enfocado-desde-notificacion {
                outline: 2px solid rgba(47, 115, 80, .42);
                outline-offset: 3px;
                box-shadow: 0 0 0 5px rgba(47, 115, 80, .08);
                transition: outline-color .2s ease, box-shadow .2s ease;
            }
        `;
        document.head.appendChild(estilo);
    }

    function decorarAccionesFinalizadas() {
        const contenedor = document.getElementById("notificaciones-contenido");
        if (!contenedor) return;

        const lista = listaServicios();
        const porId = new Map(lista.map(servicio => [String(servicio?.id || ""), servicio]));

        contenedor.querySelectorAll(".haiku-notif-servicio-acciones").forEach(fila => {
            const item = fila.previousElementSibling;
            if (!item?.matches?.(".notificacion-reserva.haiku-notif-servicio-estado")) {
                fila.remove();
                return;
            }

            if (String(item.dataset.servicioId || "") !== String(fila.dataset.servicioId || "")) {
                fila.remove();
            }
        });

        contenedor
            .querySelectorAll(".notificacion-reserva.haiku-notif-servicio-estado")
            .forEach(item => {
                const id = String(item.dataset.servicioId || "");
                const servicio = porId.get(id);
                if (!servicio) return;

                const listaDia = lista.filter(s =>
                    String(s?.fechaServicio || s?.fecha || "").slice(0, 10) ===
                    String(servicio?.fechaServicio || servicio?.fecha || "").slice(0, 10)
                );
                const est = estado(servicio, listaDia);
                const finalizo = tinajaFinalizada(servicio) && est.clave === "pendiente";
                const etiqueta = item.querySelector(".haiku-notif-servicio-etiqueta");
                let fila = item.nextElementSibling;
                if (!fila?.classList?.contains("haiku-notif-servicio-acciones")) fila = null;

                if (!finalizo) {
                    item.classList.remove("haiku-notif-servicio-finalizado");
                    if (etiqueta && etiqueta.dataset.haikuFinalizado === "1") {
                        etiqueta.textContent = est.etiqueta;
                        delete etiqueta.dataset.haikuFinalizado;
                    }
                    fila?.remove();
                    return;
                }

                item.classList.add("haiku-notif-servicio-finalizado");
                if (etiqueta) {
                    etiqueta.textContent = "Finalizó";
                    etiqueta.dataset.haikuFinalizado = "1";
                }

                if (!fila) {
                    fila = document.createElement("div");
                    fila.className = "haiku-notif-servicio-acciones";
                    fila.dataset.servicioId = id;
                    fila.innerHTML = `
                        <button type="button" class="haiku-notif-servicio-accion haiku-notif-servicio-realizado"
                            data-haiku-notif-realizar="${esc(id)}">✓ Realizado</button>
                        <button type="button" class="haiku-notif-servicio-accion haiku-notif-servicio-cancelar"
                            data-haiku-notif-cancelar="${esc(id)}">Cancelar</button>
                    `;
                    item.insertAdjacentElement("afterend", fila);
                }
            });
    }

    function crearSeccion(contenedor) {
        contenedor.querySelector(".notificaciones-vacias")?.remove();

        let seccion = contenedor.querySelector(".notificaciones-seccion");
        if (seccion) return seccion;

        seccion = document.createElement("div");
        seccion.className = "notificaciones-seccion";

        const titulo = document.createElement("div");
        titulo.className = "notificaciones-seccion-titulo";
        titulo.textContent = "Ahora";
        seccion.appendChild(titulo);
        contenedor.appendChild(seccion);
        return seccion;
    }

    function buscarBloqueServicio(seccion) {
        const propio = seccion.querySelector('[data-haiku-servicios-dia="1"]');
        if (propio) {
            const resumen = propio.matches(".notificacion-item")
                ? propio
                : seccion.querySelector('.notificacion-item[data-haiku-servicios-dia="1"]');
            const detalle = seccion.querySelector('.notificacion-detalle[data-haiku-servicios-dia="1"]');
            if (resumen && detalle) return { resumen, detalle, creado: true };
        }

        const resumen = [...seccion.querySelectorAll(".notificacion-item")].find(item => {
            const texto = String(item.textContent || "").toLowerCase();
            return texto.includes("servicio próximo") || texto.includes("servicios próximos");
        });

        if (!resumen) return null;
        const detalle = resumen.nextElementSibling;
        if (!detalle?.classList?.contains("notificacion-detalle")) return null;
        return { resumen, detalle, creado: false };
    }

    function crearBloque(seccion) {
        const resumen = document.createElement("button");
        resumen.type = "button";
        resumen.className = "notificacion-item";
        resumen.dataset.haikuServiciosDia = "1";

        const detalle = document.createElement("div");
        detalle.className = "notificacion-detalle";
        detalle.dataset.haikuServiciosDia = "1";
        detalle.hidden = true;

        resumen.addEventListener("click", () => {
            detalle.hidden = !detalle.hidden;
            const flecha = resumen.querySelector(".notificacion-flecha");
            if (flecha) flecha.textContent = detalle.hidden ? "›" : "⌄";
        });

        detalle.addEventListener("click", evento => {
            const item = evento.target.closest(".notificacion-reserva");
            if (item) abrirServicioEnAgenda(item);
        });

        const titulo = seccion.querySelector(".notificaciones-seccion-titulo");
        if (titulo?.nextSibling) {
            seccion.insertBefore(detalle, titulo.nextSibling);
            seccion.insertBefore(resumen, detalle);
        } else {
            seccion.append(resumen, detalle);
        }

        return { resumen, detalle, creado: true };
    }

    function renderizar() {
        const contenedor = document.getElementById("notificaciones-contenido");
        if (!contenedor) return;

        const fecha = fechaVista();
        if (!fecha) return;

        const listaDia = listaServicios()
            .filter(s => String(s?.fechaServicio || s?.fecha || "").slice(0, 10) === fecha)
            .sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));

        if (!listaDia.length) {
            contenedor.querySelectorAll('[data-haiku-servicios-dia="1"]').forEach(el => el.remove());
            delete contenedor.dataset.haikuFirmaServiciosDia;
            return;
        }

        const estados = listaDia.map(s => estado(s, listaDia));
        const firma = `${fecha}|${listaDia.map((s, i) => `${s.id}:${estados[i].clave}:${tinajaFinalizada(s) ? "fin" : "curso"}`).join("|")}`;

        let seccion = crearSeccion(contenedor);
        let bloque = buscarBloqueServicio(seccion);

        const bloqueCompleto =
            bloque?.resumen?.isConnected &&
            bloque?.detalle?.isConnected &&
            bloque.resumen.dataset.haikuServiciosDia === "1" &&
            bloque.detalle.dataset.haikuServiciosDia === "1";

        if (
            contenedor.dataset.haikuFirmaServiciosDia === firma &&
            bloqueCompleto
        ) {
            decorarAccionesFinalizadas();
            return;
        }

        if (!bloque) bloque = crearBloque(seccion);

        bloque.resumen.dataset.haikuServiciosDia = "1";
        bloque.detalle.dataset.haikuServiciosDia = "1";

        bloque.resumen.innerHTML = `
            <span class="notificacion-icono">⏰</span>
            <span class="notificacion-contenido">
                <strong>${listaDia.length} ${listaDia.length === 1 ? "servicio del día" : "servicios del día"}</strong>
                <small>Ver estados</small>
            </span>
            <span class="notificacion-flecha">${bloque.detalle.hidden ? "›" : "⌄"}</span>
        `;

        bloque.detalle.innerHTML = "";

        listaDia.forEach((servicio, indice) => {
            const est = estados[indice];
            const item = document.createElement("button");
            item.type = "button";
            item.className = `notificacion-reserva haiku-notif-servicio-estado haiku-notif-servicio-${est.clave}`;
            item.dataset.cabana = servicio.numeroCabana || "";
            item.dataset.fecha = servicio.fechaServicio || servicio.fecha || "";
            item.dataset.servicioId = servicio.id || "";
            item.innerHTML = `
                <strong>${esc(servicio.hora || "--:--")} · ${esc(servicio.nombre || "Servicio")}</strong>
                <span>CAB ${esc(servicio.numeroCabana || "—")}${servicio.titular ? ` · ${esc(servicio.titular)}` : ""}</span>
                <span class="haiku-notif-servicio-etiqueta">${esc(est.etiqueta)}</span>
            `;
            bloque.detalle.appendChild(item);
        });

        contenedor.dataset.haikuFirmaServiciosDia = firma;
        decorarAccionesFinalizadas();
    }

    function programar(delay = 20) {
        clearTimeout(timer);
        timer = setTimeout(renderizar, delay);
    }

    inyectarEstilosAcciones();

    const contenedor = document.getElementById("notificaciones-contenido");
    if (contenedor) {
        new MutationObserver(() => programar(0)).observe(contenedor, {
            childList: true,
            subtree: true
        });

        contenedor.addEventListener("click", async evento => {
            const realizar = evento.target.closest?.("[data-haiku-notif-realizar]");
            if (realizar) {
                evento.preventDefault();
                evento.stopPropagation();

                const id = realizar.dataset.haikuNotifRealizar || "";
                const servicio = buscarServicioPorId(id);
                if (!servicio || !tinajaFinalizada(servicio)) return;

                realizar.disabled = true;
                try {
                    await Promise.resolve(window.marcarServicioRealizado?.(id));
                } finally {
                    setTimeout(() => {
                        programar(0);
                        try { window.renderizarAgendaServicios?.(); } catch {}
                    }, 120);
                }
                return;
            }

            const cancelar = evento.target.closest?.("[data-haiku-notif-cancelar]");
            if (cancelar) {
                evento.preventDefault();
                evento.stopPropagation();

                const id = cancelar.dataset.haikuNotifCancelar || "";
                const servicio = buscarServicioPorId(id);
                if (!servicio || !tinajaFinalizada(servicio)) return;

                cancelar.disabled = true;
                try {
                    await Promise.resolve(window.haikuCancelarServicio?.(id));
                } finally {
                    cancelar.disabled = false;
                    setTimeout(() => programar(0), 120);
                }
                return;
            }

            const item = evento.target.closest?.(".notificacion-reserva.haiku-notif-servicio-estado");
            if (item) {
                evento.preventDefault();
                evento.stopPropagation();
                abrirServicioEnAgenda(item);
            }
        }, true);
    }

    document.addEventListener("haiku:servicios-hidratados", () => programar(20));
    document.addEventListener("haiku:servicio-supabase-cambiado", () => programar(80));
    document.addEventListener("click", evento => {
        if (evento.target.closest?.("#boton-notificaciones")) programar(30);
    });

    setInterval(() => {
        const panel = document.getElementById("panel-notificaciones");
        if (panel && !panel.hidden) programar(0);
    }, 15000);

    window.haikuRenderNotificacionesServiciosDia = renderizar;

    setTimeout(() => programar(0), 800);

    console.info("HAIKU · Notificaciones de Servicios del día V1 preparadas.");
})();