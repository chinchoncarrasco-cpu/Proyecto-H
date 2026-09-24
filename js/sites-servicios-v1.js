// Servicios Sites: proyección de la hidratación y de las autoridades existentes.
// Los botones de estado conservan los handlers reales de Servicios.
(() => {
    "use strict";
    if (window.HAIKU_SITES_SERVICIOS_V1) return;

    const raiz = document.getElementById("sites-servicios-root");
    const contenido = document.getElementById("sites-servicios-contenido");
    if (!raiz || !contenido) return;
    const estado = { fecha: "", hidratado: false, error: "", eligiendo: false,
        realizado: null, realizadoOcupado: false, realizadoVersion: 0,
        cancelarId: "", cancelarOcupado: false };
    const $ = id => document.getElementById(id);
    const esc = valor => String(valor ?? "").replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    const moneda = valor => `$${Math.round(Number(valor)).toLocaleString("es-CL")}`;
    const fechaValida = valor => /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""));
    const fechaServicio = servicio => String(servicio?.fechaServicio || servicio?.fecha || "").slice(0, 10);
    const operativo = servicio => String(servicio?.estadoServicioDb || servicio?.estadoServicio || "");
    const cancelado = servicio => ["cancelado", "cancelada", "no_show"].includes(operativo(servicio));
    const realizado = servicio => ["realizado", "realizada", "completado"].includes(operativo(servicio));
    const cortesia = servicio => servicio?.tipoCobro === "cortesia";
    const programable = servicio => ["tinaja", "masaje"].includes(String(servicio?.categoria || ""));
    const saldo = servicio => servicio?.saldoPendienteVerificado === null ||
        servicio?.saldoPendienteVerificado === undefined ? null :
        Number(servicio.saldoPendienteVerificado);

    function relojChile() {
        const partes = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hourCycle: "h23"
        }).formatToParts(new Date());
        const p = Object.fromEntries(partes.map(x => [x.type, x.value]));
        return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
    }

    function listaReal() {
        if (!estado.hidratado || !window.haikuSesion) return [];
        try { return Array.isArray(serviciosRegistrados) ? serviciosRegistrados : []; }
        catch { return []; }
    }

    function proyectar(lista, fecha, reloj = relojChile()) {
        const dia = lista.filter(s => fechaServicio(s) === fecha).sort((a, b) =>
            String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")) ||
            String(a.id || "").localeCompare(String(b.id || "")));
        const vigentes = dia.filter(s => !cancelado(s));
        const pendientes = vigentes.filter(s => !realizado(s));
        const cobrables = vigentes.filter(s => !cortesia(s));
        const finanzasCompletas = cobrables.every(s => saldo(s) !== null &&
            Number.isFinite(saldo(s)) && saldo(s) >= 0);
        const dePago = finanzasCompletas ? cobrables.filter(s => saldo(s) > 0) : [];
        const proximo = pendientes.find(s => s.hora &&
            (fecha > reloj.fecha || (fecha === reloj.fecha && s.hora >= reloj.hora))) || null;
        return {
            dia, vigentes, pendientes, proximo,
            pagos: finanzasCompletas ? {
                cantidad: dePago.length, monto: dePago.reduce((n, s) => n + saldo(s), 0)
            } : null,
            agenda: dia.filter(s => programable(s)),
            extras: dia.filter(s => !programable(s))
        };
    }

    function fechaVisible(fecha) {
        if (!fechaValida(fecha)) return "—";
        return new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", dateStyle: "full" })
            .format(new Date(`${fecha}T12:00:00Z`));
    }

    function metricas(p) {
        const proximo = p.proximo;
        return `<div class="sv-metrics" aria-label="Resumen del día">
            <div><span>Próximo servicio</span><strong>${proximo ?
                `${esc(proximo.hora)} · ${esc(proximo.nombre || "Servicio")}` : "Sin próximos servicios"}</strong>
                <small>${proximo ? `CAB ${esc(proximo.numeroCabana || "—")} · ${esc(proximo.titular || "Titular no disponible")}` : "Agenda al día"}</small></div>
            <div><span>Servicios del día</span><strong>${p.vigentes.length}</strong>
                <small>${p.pendientes.length} por realizar · ${p.vigentes.length - p.pendientes.length} realizados</small></div>
            <div><span>Pendientes de pago</span><strong>${p.pagos ? p.pagos.cantidad : "—"}</strong>
                <small>${p.pagos ? `${moneda(p.pagos.monto)} por cobrar` : "Finanzas por verificar"}</small></div>
        </div>`;
    }

    function disponibilidad(fecha) {
        const api = window.HAIKU_SERVICIOS_TINAJAS_HORARIOS_V1;
        const horarios = api?.horarios || [];
        const servicios = api?.serviciosTinajaDelDia?.(fecha) || [];
        const celda = (tipo, horario) => {
            const info = api?.estadoHorario?.(tipo, horario, servicios);
            if (!info) return '<span class="sv-slot-unknown">Por verificar</span>';
            if (info.estado === "libre") return '<span class="sv-slot-free">Libre</span>';
            if (info.estado === "conflicto") return '<span class="sv-slot-conflict">Conflicto · revisar</span>';
            const cabana = info.activos?.[0]?.numeroCabana;
            return `<span class="sv-slot-occupied">Ocupado${cabana ? ` <small>· CAB ${esc(cabana)}</small>` : ""}</span>`;
        };
        const libres = tipo => horarios.filter(h =>
            api.estadoHorario(tipo, h, servicios).estado === "libre").length;
        return `<section class="sv-surface sv-availability"><div class="sv-section-top"><div>
            <div class="sites-servicios-eyebrow">DISPONIBILIDAD OPERATIVA</div><h2>Horarios de tinajas</h2>
            <p>Tonel y Jacuzzi · ${horarios.length ? `${horarios.length} turnos por día` : "horarios por verificar"}</p></div>
            <div class="sv-availability-actions"><label class="sv-date-control">Fecha
                <input id="sites-servicios-fecha" type="date" value="${esc(fecha)}" aria-label="Fecha de disponibilidad y agenda"></label>
                <div class="sv-copy-actions"><button type="button" data-sites-servicios-copiar="tonel">Copiar Tonel</button>
                <button type="button" data-sites-servicios-copiar="jacuzzi">Copiar Jacuzzi</button>
                <button type="button" data-sites-servicios-copiar="ambos">Copiar ambos</button></div></div></div>
            <div class="sv-slot-table"><div class="sv-slot-head"><span>Horario</span>
                <span>Tinaja Tonel <small>${api ? `${libres("tonel")}/${horarios.length} libres` : "Por verificar"}</small></span>
                <span>Tinaja Jacuzzi <small>${api ? `${libres("jacuzzi")}/${horarios.length} libres` : "Por verificar"}</small></span></div>
                ${horarios.map(h => `<div class="sv-slot-row"><strong>${esc(h.inicio)}–${esc(h.fin)}</strong>
                    ${celda("tonel", h)}${celda("jacuzzi", h)}</div>`).join("")}
                ${horarios.length ? "" : '<p class="sv-empty">No fue posible verificar los horarios.</p>'}
            </div><p id="sites-servicios-copia-estado" class="sites-servicios-copia-estado" role="status"></p></section>`;
    }

    function estadoVisual(servicio) {
        if (operativo(servicio) === "no_show") return { clave: "cancelado", texto: "No se presentó" };
        if (cancelado(servicio)) return { clave: "cancelado", texto: "Cancelado" };
        if (realizado(servicio)) return { clave: "realizado", texto: "Realizado" };
        const temporal = window.haikuEstadoTemporalServicio?.(servicio);
        if (temporal?.clave === "actual") return { clave: "pendiente", texto: "Actual" };
        if (temporal?.clave === "proxima") return { clave: "pendiente", texto: "Próximo" };
        return { clave: "pendiente", texto: "Pendiente" };
    }

    function cobro(servicio) {
        if (cancelado(servicio)) return `<span class="sv-payment annulled">${saldo(servicio) === 0 ?
            "Sin cobro activo" : "Cobro por verificar"}<small>Valor histórico ${moneda(servicio.total || 0)}</small></span>`;
        if (cortesia(servicio)) return '<span class="sv-payment courtesy">Cortesía</span>';
        const restante = saldo(servicio);
        if (restante === null || !Number.isFinite(restante)) {
            return '<span class="sv-payment">Cobro por verificar</span>';
        }
        if (restante === 0) return `<span class="sv-payment paid"><strong>${moneda(servicio.total || 0)}</strong> · Pagado</span>`;
        return `<span class="sv-payment due"><strong>${moneda(restante)}</strong> · Pendiente de pago</span>`;
    }

    function acciones(servicio) {
        if (!window.haikuSesion) return "";
        const id = esc(servicio.id);
        const opciones = [];
        const editar = window.haikuTienePermiso?.("servicios.editar") === true;
        const cancelarPermitido = window.haikuTienePermiso?.("servicios.cancelar") === true;
        if (cancelado(servicio)) {
            if (programable(servicio) && editar) opciones.push(["haiku-reactivar-servicio", "Reactivar"]);
        } else if (realizado(servicio)) {
            if (editar) opciones.push(["haiku-deshacer-realizado", "Deshacer realizado"]);
        } else {
            if (editar) opciones.push(["sites-servicios-realizar", "Marcar realizado"]);
            if (programable(servicio) && cancelarPermitido) opciones.push(["sites-servicios-cancelar", "Cancelar"]);
            else if (!programable(servicio) && cancelarPermitido) opciones.push(["haiku-eliminar-servicio", "Eliminar"]);
        }
        if (!opciones.length) return "";
        const principal = opciones[0];
        return `<div class="sv-row-actions"><button type="button" class="sv-done-action" data-${principal[0]}="${id}">${principal[1]}</button>
            ${opciones.length > 1 ? `<details class="sv-more"><summary aria-label="Más acciones para ${esc(servicio.nombre)}">···</summary>
            <div class="sv-menu">${opciones.slice(1).map(([atributo, texto]) =>
                `<button type="button" data-${atributo}="${id}">${texto}</button>`).join("")}</div></details>` : ""}</div>`;
    }

    function fila(servicio) {
        const estadoFila = estadoVisual(servicio);
        return `<article class="sv-agenda-row ${estadoFila.clave}" data-servicio-id="${esc(servicio.id)}">
            <time>${esc(servicio.hora || "—")}</time><div class="sv-service-main">
                <strong>${esc(servicio.nombre || "Servicio")}</strong>
                <span>CAB ${esc(servicio.numeroCabana || "—")} · ${esc(servicio.titular || "Titular no disponible")}</span>
                ${servicio.observaciones ? `<small title="${esc(servicio.observaciones)}">${esc(servicio.observaciones)}</small>` : ""}</div>
            <div class="sv-charge">${cobro(servicio)}</div>
            <span class="sv-status ${estadoFila.clave}">${estadoFila.texto}</span>${acciones(servicio)}</article>`;
    }

    function bloqueAgenda(titulo, subtitulo, lista, clase, registrar = false) {
        return `<section class="sv-surface ${clase}"><div class="sv-section-top"><div><h2>${titulo}</h2><p>${subtitulo}</p></div>
            ${registrar && window.haikuSesion && window.haikuTienePermiso?.("servicios.crear") === true ?
                '<button type="button" class="sv-register" data-sites-servicios-registrar>+ Registrar servicio</button>' :
                '<span class="sv-agenda-hint">Hora · servicio · cobro · estado</span>'}</div>
            ${lista.length ? `<div class="sv-agenda-list">${lista.map(fila).join("")}</div>` :
                '<div class="sv-empty">No hay servicios registrados para esta fecha.</div>'}</section>`;
    }

    function renderizar() {
        if (!fechaValida(estado.fecha)) estado.fecha = relojChile().fecha;
        $("sites-servicios-fecha-label").textContent = fechaVisible(estado.fecha);
        if (!estado.hidratado || !window.haikuSesion) {
            contenido.innerHTML = `<div class="sites-servicios-cargando">${esc(estado.error || "Comprobando servicios de Proyecto H…")}</div>`;
            return;
        }
        const p = proyectar(listaReal(), estado.fecha);
        contenido.innerHTML = metricas(p) + disponibilidad(estado.fecha) +
            bloqueAgenda("Agenda del día", `${p.agenda.length} registros · ordenados por hora`, p.agenda, "sv-agenda") +
            bloqueAgenda("Consumos adicionales", `${p.extras.length} registros asociados a cabañas`, p.extras, "sv-extras", true);
    }

    async function refrescar() {
        if (!window.haikuSesion || !window.HAIKU_SERVICIOS_HIDRATACION_V2?.sincronizar) return;
        const lista = await window.HAIKU_SERVICIOS_HIDRATACION_V2.sincronizar();
        if (Array.isArray(lista)) { estado.hidratado = true; estado.error = ""; }
        else if (!estado.hidratado) estado.error = "No fue posible comprobar los servicios. Vuelve a intentar.";
        renderizar();
    }

    async function copiar(tipo) {
        const api = window.HAIKU_SERVICIOS_TINAJAS_HORARIOS_V1;
        const texto = tipo === "ambos" ? api?.textoWhatsApp?.(estado.fecha) :
            window.HAIKU_SERVICIOS_TINAJAS_COPIAR_V2?.textoTipo?.(
                tipo, tipo === "tonel" ? "Tinaja Tónel" : "Tinaja Jacuzzi", estado.fecha);
        const mensaje = $("sites-servicios-copia-estado");
        if (!texto || !navigator.clipboard?.writeText) {
            mensaje.textContent = "No fue posible preparar la copia de disponibilidad.";
            return;
        }
        try { await navigator.clipboard.writeText(texto); mensaje.textContent = "Disponibilidad copiada."; }
        catch { mensaje.textContent = "No se pudo copiar la disponibilidad."; }
    }

    function cerrarSelector() { $("sites-servicios-selector").hidden = true; estado.eligiendo = false; }
    function cerrarCancelar() {
        if (estado.cancelarOcupado) return;
        estado.cancelarId = "";
        $("sites-servicios-cancelar").hidden = true;
    }

    function abrirCancelar(id) {
        if (estado.cancelarOcupado || window.haikuTienePermiso?.("servicios.cancelar") !== true) return;
        const servicio = listaReal().find(s => String(s.id) === String(id));
        if (!servicio || cancelado(servicio) || !programable(servicio)) return;
        estado.cancelarId = String(id);
        $("sites-servicios-cancelar-confirmar").hidden = false;
        $("sites-servicios-cancelar-contenido").innerHTML =
            `<p>Confirma la cancelación de esta solicitud en Proyecto H.</p>
            <div class="sites-servicios-realizado-resumen"><strong>${esc(servicio.nombre)} · CAB ${esc(servicio.numeroCabana)}</strong>
            <small>${esc(servicio.titular || "Titular no disponible")} · ${esc(fechaServicio(servicio))} ${esc(servicio.hora || "")}</small>
            <span>${esc(estadoVisual(servicio).texto)} → Cancelado</span></div>
            <p>El RPC real revalidará el servicio y actualizará el cargo según las reglas vigentes.</p>`;
        $("sites-servicios-cancelar").hidden = false;
    }

    async function confirmarCancelar() {
        if (estado.cancelarOcupado || !estado.cancelarId || !window.haikuCancelarServicio) return;
        const id = estado.cancelarId;
        const boton = $("sites-servicios-cancelar-confirmar");
        const cuerpo = $("sites-servicios-cancelar-contenido");
        estado.cancelarOcupado = true;
        boton.disabled = true;
        cuerpo.textContent = "Revalidando y cancelando en Proyecto H…";
        try {
            await window.haikuCancelarServicio(id, { confirmadoDesdeSites: true });
            await refrescar();
            const actual = listaReal().find(s => String(s.id) === id);
            cuerpo.textContent = actual && cancelado(actual)
                ? "Servicio cancelado en Proyecto H. Su cargo e historial permanecen bajo la autoridad financiera real."
                : "No se pudo acreditar la cancelación. Comprueba el servicio antes de volver a intentar.";
            if (actual && cancelado(actual)) boton.hidden = true;
        } catch {
            cuerpo.textContent = "No se pudo comprobar la cancelación. Revisa el servicio antes de volver a intentar.";
        } finally {
            estado.cancelarOcupado = false;
            boton.disabled = false;
        }
    }

    function cerrarRealizado() {
        if (estado.realizadoOcupado) return;
        estado.realizadoVersion++;
        estado.realizado = null;
        $("sites-servicios-realizado").hidden = true;
    }

    async function abrirRealizado(id) {
        if (estado.realizadoOcupado || window.haikuTienePermiso?.("servicios.editar") !== true) return;
        const servicio = listaReal().find(s => String(s.id) === String(id));
        const api = window.HAIKU_ASISTENTE_SERVICIOS_REALIZADO_V1;
        if (!servicio || !api?.prepararManual) return;
        const version = ++estado.realizadoVersion;
        estado.realizado = null;
        $("sites-servicios-realizado").hidden = false;
        $("sites-servicios-realizado-confirmar").hidden = true;
        $("sites-servicios-realizado-confirmar").textContent = "Marcar servicio como realizado";
        const cuerpo = $("sites-servicios-realizado-contenido");
        cuerpo.textContent = "Comprobando servicio, horario y finanzas en Proyecto H…";
        try {
            const propuesta = await api.prepararManual(id);
            if (version !== estado.realizadoVersion) return;
            estado.realizado = propuesta;
            if (propuesta.estado !== "propuesta") {
                const razones = propuesta.evaluacion?.razones || [];
                cuerpo.innerHTML = `<p>${esc(propuesta.mensaje || "No se puede marcar este servicio como realizado.")}</p>
                    ${razones.length ? `<ul>${razones.map(razon => `<li>${esc(razon)}</li>`).join("")}</ul>` : ""}`;
                return;
            }
            const finanzas = api.finanzasVisuales(propuesta.lectura);
            const persistido = propuesta.lectura.servicio;
            cuerpo.innerHTML = `<p>Esta acción modificará el estado operativo en Proyecto H.</p>
                <div class="sites-servicios-realizado-resumen"><strong>${esc(propuesta.lectura.catalogo.nombre)} · CAB ${esc(servicio.numeroCabana)}</strong>
                <small>${esc(propuesta.lectura.reserva.titular_nombre || servicio.titular || "Titular no disponible")} · ${esc(persistido.fecha_servicio)} ${esc(persistido.hora_inicio || "")}${persistido.hora_fin ? `–${esc(persistido.hora_fin)}` : ""}</small>
                <span>${esc(persistido.estado_servicio === "en_proceso" ? "En proceso" : "Programado")} → Realizado</span><span>${esc(finanzas.titulo)} · ${esc(finanzas.detalle)}</span>
                <small>${esc(finanzas.explicacion)}</small></div><p>Confirmar revalidará el servicio antes de ejecutar el RPC.</p>`;
            $("sites-servicios-realizado-confirmar").hidden = false;
        } catch (error) {
            if (version === estado.realizadoVersion) cuerpo.textContent =
                error?.message || "No fue posible comprobar este servicio.";
        }
    }

    async function confirmarRealizado() {
        const api = window.HAIKU_ASISTENTE_SERVICIOS_REALIZADO_V1;
        const propuesta = estado.realizado;
        const boton = $("sites-servicios-realizado-confirmar");
        const cuerpo = $("sites-servicios-realizado-contenido");
        if (!api || !propuesta || estado.realizadoOcupado || boton.hidden) return;
        estado.realizadoOcupado = true;
        boton.disabled = true;
        boton.hidden = true;
        cuerpo.textContent = "Revalidando servicio, finanzas y hora del servidor…";
        try {
            const resultado = propuesta.estado === "propuesta"
                ? await api.confirmar(propuesta, { onEstado: texto => { cuerpo.textContent = texto; } })
                : await api.verificarEstado(propuesta.propuesta || propuesta);
            estado.realizado = resultado;
            cuerpo.textContent = resultado.mensaje || "Comprueba el estado del servicio en Proyecto H.";
            if (resultado.estado === "realizado") await refrescar();
            else if (["incierto", "sincronizando"].includes(resultado.estado)) {
                boton.textContent = "Comprobar estado";
                boton.hidden = false;
            }
        } catch {
            cuerpo.textContent = "No se pudo comprobar el resultado. Reabre el servicio y verifica su estado antes de repetir.";
        } finally {
            estado.realizadoOcupado = false;
            boton.disabled = false;
        }
    }

    async function abrirSelector() {
        if (estado.eligiendo || window.haikuTienePermiso?.("servicios.crear") !== true) return;
        estado.eligiendo = true;
        const selector = $("sites-servicios-selector");
        const opciones = $("sites-servicios-cabanas");
        const mensaje = $("sites-servicios-selector-estado");
        selector.hidden = false;
        opciones.replaceChildren();
        mensaje.textContent = "Comprobando reservas vigentes…";
        try {
            const { data, error } = await window.haikuSupabase.rpc("haiku_operacion_dia", { p_fecha: estado.fecha });
            if (error) throw error;
            if (!estado.eligiendo) return;
            const filas = (Array.isArray(data) ? data : []).map(fila =>
                window.HAIKU_RESUMEN_SERVICIO_SITES_V1?.identidadOperacion?.(fila)).filter(Boolean);
            opciones.innerHTML = filas.map(f => `<button type="button" data-sites-servicios-cabana="${esc(f.numeroCabana)}">
                Cabaña ${esc(f.numeroCabana)}</button>`).join("");
            mensaje.textContent = filas.length ? "Elige una cabaña para continuar con el formulario real." :
                "No hay cabañas con reserva vigente en esta fecha.";
        } catch (error) { mensaje.textContent = error?.message || "No fue posible comprobar las reservas."; }
    }

    raiz.addEventListener("change", evento => {
        if (evento.target.id !== "sites-servicios-fecha") return;
        if (!fechaValida(evento.target.value)) return;
        estado.fecha = evento.target.value;
        cerrarSelector();
        cerrarRealizado();
        cerrarCancelar();
        renderizar();
    });
    raiz.addEventListener("click", evento => {
        const copiarBoton = evento.target.closest?.("[data-sites-servicios-copiar]");
        if (copiarBoton) { copiar(copiarBoton.dataset.sitesServiciosCopiar); return; }
        if (evento.target.closest?.("[data-sites-servicios-registrar]")) { abrirSelector(); return; }
        if (evento.target.closest?.("[data-sites-servicios-cerrar]")) { cerrarSelector(); return; }
        if (evento.target.closest?.("[data-sites-servicios-cancelar-cerrar]")) { cerrarCancelar(); return; }
        if (evento.target.closest?.("#sites-servicios-cancelar-confirmar")) { confirmarCancelar(); return; }
        const cancelarBoton = evento.target.closest?.("[data-sites-servicios-cancelar]");
        if (cancelarBoton) { abrirCancelar(cancelarBoton.dataset.sitesServiciosCancelar); return; }
        if (evento.target.closest?.("[data-sites-servicios-realizado-cerrar]")) { cerrarRealizado(); return; }
        if (evento.target.closest?.("#sites-servicios-realizado-confirmar")) { confirmarRealizado(); return; }
        const realizadoBoton = evento.target.closest?.("[data-sites-servicios-realizar]");
        if (realizadoBoton) { abrirRealizado(realizadoBoton.dataset.sitesServiciosRealizar); return; }
        const cabana = evento.target.closest?.("[data-sites-servicios-cabana]");
        if (cabana) {
            const numero = cabana.dataset.sitesServiciosCabana;
            cerrarSelector();
            window.HAIKU_RESUMEN_SERVICIO_SITES_V1?.abrirDesdeServicios?.(numero, estado.fecha);
        }
    });
    document.addEventListener("haiku:servicios-hidratados", () => {
        estado.hidratado = true; estado.error = ""; renderizar();
    });
    document.addEventListener("haiku:servicios-finanzas-actualizadas", renderizar);
    document.addEventListener("haiku:servicio-supabase-cambiado", () => setTimeout(refrescar, 70));
    document.addEventListener("click", evento => {
        if (evento.target.closest?.('[data-seccion="servicios"], [data-ir-seccion="servicios"]')) {
            setTimeout(refrescar, 80);
        }
    });
    window.addEventListener("haiku:auth-ready", () => setTimeout(refrescar, 80));
    window.addEventListener("focus", () => {
        if (!$("seccion-servicios")?.classList.contains("oculto")) refrescar();
    });
    window.HAIKU_SITES_SERVICIOS_V1 = Object.freeze({ proyectar, renderizar, refrescar, estado });
    estado.fecha = relojChile().fecha;
    renderizar();
    setTimeout(refrescar, 900);
})();
