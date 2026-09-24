// ========================================
// HAIKU · SERVICIOS · ESTADOS V1
// Actual · Próxima · Pendiente · Completada · Cancelada
// + cancelación/reactivación segura contra Supabase.
// ========================================
(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const originalObtenerServiciosProximos = window.obtenerServiciosProximos;
    const originalActualizarNotificaciones = window.actualizarNotificaciones;

    let procesando = false;
    let timerDecoracion = null;

    const ESTADOS = Object.freeze({
        actual: { etiqueta: "Actual", clase: "haiku-servicio-actual" },
        proxima: { etiqueta: "Próxima", clase: "haiku-servicio-proxima" },
        pendiente: { etiqueta: "Pendiente", clase: "haiku-servicio-pendiente" },
        completada: { etiqueta: "Completada", clase: "haiku-servicio-completada" },
        cancelada: { etiqueta: "Cancelada", clase: "haiku-servicio-cancelada" }
    });

    function esc(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function money(valor) {
        return `$${Math.round(Number(valor || 0)).toLocaleString("es-CL")}`;
    }

    function esUuid(valor) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(String(valor || ""));
    }

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

        const m = Object.fromEntries(partes.map(p => [p.type, p.value]));
        return {
            fecha: `${m.year}-${m.month}-${m.day}`,
            minutos: Number(m.hour || 0) * 60 + Number(m.minute || 0)
        };
    }

    function minutosHora(hora) {
        const [h, m] = String(hora || "").slice(0, 5).split(":").map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        return h * 60 + m;
    }

    function duracionServicio(servicio) {
        const inicio = minutosHora(servicio?.hora);
        const fin = minutosHora(servicio?.horaFin);
        if (inicio !== null && fin !== null && fin > inicio) return fin - inicio;

        const directa = Number(servicio?.duracionMinutos || 0);
        if (directa > 0) return directa;

        try {
            if (typeof CATALOGO_SERVICIOS !== "undefined") {
                const catalogo = CATALOGO_SERVICIOS[servicio?.tipoServicio];
                const minutos = Number(catalogo?.duracionMinutos || 0);
                if (minutos > 0) return minutos;
                if (catalogo?.unidad === "hora") {
                    return Math.max(1, Number(servicio?.cantidad || 1)) * 60;
                }
            }
        } catch {}

        if (String(servicio?.categoria || "") === "tinaja") {
            return Math.max(1, Number(servicio?.cantidad || 1)) * 60;
        }

        return 60;
    }

    function estadoBase(servicio, reloj) {
        const operativo = String(servicio?.estadoServicioDb || servicio?.estadoServicio || "");

        if (["cancelado", "cancelada", "no_show"].includes(operativo)) {
            return "cancelada";
        }

        if (["realizado", "completada"].includes(operativo)) {
            return "completada";
        }

        if (operativo === "en_proceso") {
            return "actual";
        }

        const fecha = String(servicio?.fechaServicio || servicio?.fecha || "").slice(0, 10);
        const inicio = minutosHora(servicio?.hora);

        if (fecha === reloj.fecha && inicio !== null) {
            const fin = inicio + duracionServicio(servicio);
            if (reloj.minutos >= inicio && reloj.minutos < fin) return "actual";
        }

        return "pendiente";
    }

    function claveFutura(servicio, reloj) {
        const fecha = String(servicio?.fechaServicio || servicio?.fecha || "").slice(0, 10);
        const inicio = minutosHora(servicio?.hora);
        if (!fecha || inicio === null) return null;

        if (fecha < reloj.fecha) return null;
        if (fecha === reloj.fecha && inicio <= reloj.minutos) return null;

        return `${fecha}T${String(Math.floor(inicio / 60)).padStart(2, "0")}:${String(inicio % 60).padStart(2, "0")}`;
    }

    function calcularEstados(lista) {
        const reloj = relojChile();
        const estados = new Map();

        lista.forEach(servicio => {
            estados.set(String(servicio.id), estadoBase(servicio, reloj));
        });

        const futuras = lista
            .filter(s => estados.get(String(s.id)) === "pendiente")
            .map(s => ({ servicio: s, clave: claveFutura(s, reloj) }))
            .filter(x => x.clave)
            .sort((a, b) => a.clave.localeCompare(b.clave));

        if (futuras.length) {
            const primera = futuras[0].clave;
            futuras
                .filter(x => x.clave === primera)
                .forEach(x => estados.set(String(x.servicio.id), "proxima"));
        }

        return estados;
    }

    function estadoServicio(servicio, listaDia = null) {
        const fecha = String(servicio?.fechaServicio || servicio?.fecha || "").slice(0, 10);
        const lista = listaDia || listaServicios().filter(s =>
            String(s?.fechaServicio || s?.fecha || "").slice(0, 10) === fecha
        );
        const clave = calcularEstados(lista).get(String(servicio?.id || "")) || "pendiente";
        return { clave, ...ESTADOS[clave] };
    }

    function htmlCobro(servicio, estado) {
        if (estado === "cancelada") {
            return `
                <div class="haiku-servicio-cancelada-resumen">
                    <span><strong>Cobro $0</strong> · cargo anulado</span>
                    ${Number(servicio.total || 0) > 0
                        ? `<span>Valor original ${money(servicio.total)}</span>`
                        : ""}
                </div>
            `;
        }

        const esCortesia = servicio.cortesia === true || servicio.tipoCobro === "cortesia";
        if (esCortesia) {
            return `<div class="servicio-agenda-cobro"><span class="servicios-cortesia">🎁 CORTESÍA</span></div>`;
        }

        const pagado = servicio.estadoPago === "pagado";
        return `
            <div class="servicio-agenda-cobro">
                <strong class="servicio-agenda-precio">${money(servicio.total)}</strong>
                ${pagado
                    ? `<span class="servicios-pago-ok">✓ Pagado</span>`
                    : `<span class="servicios-pago-pendiente">Pendiente de pago</span>`}
            </div>
        `;
    }

    function htmlAcciones(servicio, estado) {
        const id = esc(servicio.id);
        const esProgramable = ["tinaja", "masaje"].includes(String(servicio.categoria || ""));

        if (estado === "cancelada") {
            if (!esProgramable) return "";
            return `
                <div class="servicio-agenda-acciones">
                    <button type="button" class="servicio-btn haiku-servicio-btn-reactivar"
                        data-haiku-reactivar-servicio="${id}">↻ Reactivar</button>
                </div>
            `;
        }

        if (estado === "completada") {
            return `
                <div class="servicio-agenda-acciones">
                    <button type="button" class="servicio-btn servicio-btn-secundario"
                        data-haiku-deshacer-realizado="${id}">↶ Deshacer realizado</button>
                </div>
            `;
        }

        if (esProgramable) {
            return `
                <div class="servicio-agenda-acciones haiku-servicio-acciones-principales">
                    <button type="button" class="servicio-btn servicio-btn-ok"
                        data-haiku-realizar-servicio="${id}">✓ Marcar realizado</button>
                    <button type="button" class="servicio-btn haiku-servicio-btn-cancelar"
                        data-haiku-cancelar-servicio="${id}">× Marcar cancelada</button>
                </div>
            `;
        }

        return `
            <div class="servicio-agenda-acciones">
                <button type="button" class="servicio-btn servicio-btn-ok"
                    data-haiku-realizar-servicio="${id}">✓ Marcar realizado</button>
                <button type="button" class="servicio-btn servicio-btn-eliminar"
                    data-haiku-eliminar-servicio="${id}">Eliminar</button>
            </div>
        `;
    }

    function renderizarAgenda() {
        const agenda = document.getElementById("servicios-agenda");
        if (!agenda) return;

        const fecha = fechaVista();
        const listaDia = listaServicios()
            .filter(s => String(s?.fechaServicio || s?.fecha || "").slice(0, 10) === fecha)
            .sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));

        const estados = calcularEstados(listaDia);
        const activas = listaDia.filter(s => estados.get(String(s.id)) !== "cancelada");

        const contadorHoy = document.getElementById("servicios-contador-hoy");
        if (contadorHoy) contadorHoy.textContent = String(activas.length);

        const contadorPendientes = document.getElementById("servicios-contador-pendientes");
        if (contadorPendientes) {
            contadorPendientes.textContent = String(
                activas.filter(s => s.estadoPago === "pendiente").length
            );
        }

        if (!listaDia.length) {
            agenda.innerHTML = `<p class="servicios-agenda-vacia">No hay servicios programados para este día.</p>`;
            return;
        }

        listaDia.sort((a, b) => {
            const ca = estados.get(String(a.id)) === "cancelada" ? 1 : 0;
            const cb = estados.get(String(b.id)) === "cancelada" ? 1 : 0;
            if (ca !== cb) return ca - cb;
            return (a.hora || "99:99").localeCompare(b.hora || "99:99");
        });

        agenda.innerHTML = listaDia.map(servicio => {
            const estado = estados.get(String(servicio.id)) || "pendiente";
            const cfg = ESTADOS[estado];
            const cancelada = estado === "cancelada";

            return `
                <div class="servicios-agenda-item haiku-servicio-estado ${cfg.clase} ${cancelada ? "haiku-servicio-cancelada-min" : ""}"
                    data-haiku-servicio-id="${esc(servicio.id)}" data-haiku-servicio-estado="${estado}">
                    <div class="servicio-agenda-cabecera">
                        <div class="servicio-agenda-principal">
                            <span class="servicio-agenda-hora">${esc(servicio.hora || "--:--")}</span>
                            <strong class="servicio-agenda-nombre">${esc(servicio.nombre || "Servicio")}</strong>
                        </div>
                        <span class="haiku-servicio-estado-badge">${cfg.etiqueta}</span>
                    </div>

                    <div class="servicio-agenda-huesped">
                        CAB ${esc(servicio.numeroCabana || "—")}${servicio.titular ? ` · ${esc(servicio.titular)}` : ""}
                    </div>

                    ${htmlCobro(servicio, estado)}
                    ${cancelada && servicio.motivoCancelacion
                        ? `<div class="haiku-servicio-cancelada-resumen"><span>${esc(servicio.motivoCancelacion)}</span></div>`
                        : ""}
                    ${htmlAcciones(servicio, estado)}
                </div>
            `;
        }).join("");
    }

    async function resolverIdSupabase(servicio) {
        if (esUuid(servicio?.supabaseId)) return servicio.supabaseId;
        if (esUuid(servicio?.id)) return servicio.id;

        if (typeof window.haikuMigrarServicioLegacySupabase === "function") {
            return window.haikuMigrarServicioLegacySupabase(servicio);
        }
        return null;
    }

    async function refrescarDespuesDeCambio() {
        try { await window.haikuSincronizarServiciosDesdeSupabase?.(); } catch {}
        try { await window.haikuSincronizarFinanzasServicios?.(); } catch {}
        try { window.cargarCobrosCheckout?.(); } catch {}
        try { window.actualizarNotificaciones?.(); } catch {}
        renderizarAgenda();
        programarDecoracion(20);
    }

    async function cancelarServicio(id, opciones = {}) {
        if (procesando) return;
        const servicio = listaServicios().find(s => String(s.id) === String(id));
        if (!servicio) return;

        if (!opciones.confirmadoDesdeSites && !confirm(
            `¿Marcar como CANCELADA esta solicitud?\n\n${servicio.hora || ""} · ${servicio.nombre || "Servicio"}\nCAB ${servicio.numeroCabana || ""} · ${servicio.titular || ""}\n\nEl cobro pendiente pasará a $0, dejará de aparecer en Check-out y el horario quedará disponible.`
        )) return;

        procesando = true;
        try {
            const servicioId = await resolverIdSupabase(servicio);
            if (!servicioId) throw new Error("No fue posible identificar el servicio en Supabase.");

            const { data, error } = await cliente.rpc("haiku_cancelar_servicio", {
                p_servicio_id: servicioId,
                p_motivo: "Cancelado por solicitud del huésped"
            });
            if (error) throw error;

            servicio.estadoServicio = "cancelado";
            servicio.estadoServicioDb = "cancelado";
            servicio.estadoPago = "no-corresponde";
            servicio.motivoCancelacion = "Cancelado por solicitud del huésped";
            try { localStorage.setItem("haikuServicios", JSON.stringify(listaServicios())); } catch {}

            await refrescarDespuesDeCambio();
            console.info("HAIKU · Servicio cancelado:", data);
        } catch (error) {
            console.error("HAIKU · No fue posible cancelar servicio:", error);
            alert(error?.message || "No fue posible cancelar el servicio.");
        } finally {
            procesando = false;
        }
    }

    async function reactivarServicio(id) {
        if (procesando) return;
        const servicio = listaServicios().find(s => String(s.id) === String(id));
        if (!servicio) return;

        procesando = true;
        try {
            const servicioId = await resolverIdSupabase(servicio);
            if (!servicioId) throw new Error("No fue posible identificar el servicio en Supabase.");

            const { data, error } = await cliente.rpc("haiku_reactivar_servicio", {
                p_servicio_id: servicioId
            });
            if (error) throw error;

            if (data?.ok === false && data?.motivo === "horario_ocupado") {
                const sugerencias = Array.isArray(data.sugerencias) ? data.sugerencias : [];
                alert(
                    `No se puede reactivar a las ${data.hora_original || servicio.hora || ""}: ese horario ya fue ocupado.\n\n` +
                    (sugerencias.length
                        ? `Horarios libres cercanos: ${sugerencias.join(" · ")}`
                        : "No encontré otro horario libre cercano para ese día.")
                );
                return;
            }

            servicio.estadoServicio = "pendiente";
            servicio.estadoServicioDb = "programado";
            servicio.estadoPago = Number(servicio.total || 0) > 0 ? "pendiente" : "no-corresponde";

            await refrescarDespuesDeCambio();
            console.info("HAIKU · Servicio reactivado:", data);
        } catch (error) {
            console.error("HAIKU · No fue posible reactivar servicio:", error);
            alert(error?.message || "No fue posible reactivar el servicio.");
        } finally {
            procesando = false;
        }
    }

    function programarDecoracion(delay = 30) {
        clearTimeout(timerDecoracion);
        timerDecoracion = setTimeout(decorarNotificaciones, delay);
    }

    function decorarNotificaciones() {
        const contenedor = document.getElementById("notificaciones-contenido");
        if (!contenedor) return;

        const lista = listaServicios();
        const porFecha = new Map();
        lista.forEach(s => {
            const f = String(s?.fechaServicio || s?.fecha || "").slice(0, 10);
            if (!porFecha.has(f)) porFecha.set(f, []);
            porFecha.get(f).push(s);
        });

        contenedor.querySelectorAll(".notificacion-reserva[data-fecha][data-cabana]")
            .forEach(item => {
                const fecha = String(item.dataset.fecha || "").slice(0, 10);
                const cabana = String(item.dataset.cabana || "");
                const texto = item.textContent || "";
                const listaDia = porFecha.get(fecha) || [];

                const servicio = listaDia.find(s =>
                    String(s.numeroCabana || "") === cabana &&
                    (!s.hora || texto.includes(String(s.hora))) &&
                    texto.includes(String(s.nombre || "Servicio"))
                );

                if (!servicio) return;

                const estado = estadoServicio(servicio, listaDia);
                item.classList.remove(
                    "haiku-notif-servicio-actual",
                    "haiku-notif-servicio-proxima",
                    "haiku-notif-servicio-pendiente",
                    "haiku-notif-servicio-completada",
                    "haiku-notif-servicio-cancelada"
                );
                item.classList.add(
                    "haiku-notif-servicio-estado",
                    `haiku-notif-servicio-${estado.clave}`
                );

                let etiqueta = item.querySelector(".haiku-notif-servicio-etiqueta");
                if (!etiqueta) {
                    etiqueta = document.createElement("span");
                    etiqueta.className = "haiku-notif-servicio-etiqueta";
                    item.appendChild(etiqueta);
                }
                if (etiqueta.textContent !== estado.etiqueta) {
                    etiqueta.textContent = estado.etiqueta;
                }
            });
    }

    if (typeof originalObtenerServiciosProximos === "function") {
        window.obtenerServiciosProximos = function obtenerServiciosProximosEstados() {
            const lista = originalObtenerServiciosProximos.apply(this, arguments) || [];
            return lista.filter(s => !["cancelado", "cancelada", "no_show"].includes(
                String(s?.estadoServicioDb || s?.estadoServicio || "")
            ));
        };
    }

    if (typeof originalActualizarNotificaciones === "function") {
        window.actualizarNotificaciones = function actualizarNotificacionesEstados() {
            const resultado = originalActualizarNotificaciones.apply(this, arguments);
            programarDecoracion(0);
            return resultado;
        };
    }

    document.addEventListener("click", evento => {
        const cancelar = evento.target.closest?.("[data-haiku-cancelar-servicio]");
        if (cancelar) {
            evento.preventDefault();
            cancelarServicio(cancelar.dataset.haikuCancelarServicio);
            return;
        }

        const reactivar = evento.target.closest?.("[data-haiku-reactivar-servicio]");
        if (reactivar) {
            evento.preventDefault();
            reactivarServicio(reactivar.dataset.haikuReactivarServicio);
            return;
        }

        const realizar = evento.target.closest?.("[data-haiku-realizar-servicio]");
        if (realizar) {
            evento.preventDefault();
            window.marcarServicioRealizado?.(realizar.dataset.haikuRealizarServicio);
            setTimeout(() => {
                renderizarAgenda();
                programarDecoracion();
            }, 80);
            return;
        }

        const deshacer = evento.target.closest?.("[data-haiku-deshacer-realizado]");
        if (deshacer) {
            evento.preventDefault();
            window.deshacerServicioRealizado?.(deshacer.dataset.haikuDeshacerRealizado);
            setTimeout(() => {
                renderizarAgenda();
                programarDecoracion();
            }, 80);
            return;
        }

        const eliminar = evento.target.closest?.("[data-haiku-eliminar-servicio]");
        if (eliminar) {
            evento.preventDefault();
            window.eliminarServicio?.(eliminar.dataset.haikuEliminarServicio);
        }
    });

    document.addEventListener("haiku:servicios-hidratados", () => {
        renderizarAgenda();
        try { window.actualizarNotificaciones?.(); } catch {}
        programarDecoracion();
    });

    document.addEventListener("haiku:servicio-supabase-cambiado", () => {
        setTimeout(renderizarAgenda, 80);
        programarDecoracion(100);
    });

    document.addEventListener("click", evento => {
        if (
            evento.target.closest?.('[data-seccion="servicios"]') ||
            evento.target.closest?.("#boton-notificaciones")
        ) {
            setTimeout(renderizarAgenda, 20);
            programarDecoracion(40);
        }
    });

    const notif = document.getElementById("notificaciones-contenido");
    if (notif) {
        new MutationObserver(() => programarDecoracion(0))
            .observe(notif, { childList: true, subtree: true });
    }

    setInterval(() => {
        renderizarAgenda();
        programarDecoracion(0);
    }, 30000);

    window.renderizarAgendaServicios = renderizarAgenda;
    window.haikuEstadoTemporalServicio = estadoServicio;
    window.haikuCancelarServicio = cancelarServicio;
    window.haikuReactivarServicio = reactivarServicio;

    setTimeout(() => {
        renderizarAgenda();
        programarDecoracion();
    }, 700);

    console.info("HAIKU · Estados de Servicios V1 preparados.");
})();
