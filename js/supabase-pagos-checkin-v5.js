// ========================================
// HAIKU · SUPABASE · SALDO CHECK-IN V5
// Alojamiento separado de servicios + BOVE Check-out informativo
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const borradores = new Map();
    let renderizando = false;
    let guardandoPago = false;
    let guardandoBove = false;
    let guardandoEdicionPago = false;
    let timerRender = null;

    const MEDIOS = Object.freeze({
        "Transferencia": "transferencia",
        "WebPay Crédito": "webpay_credito",
        "WebPay Débito": "webpay_debito",
        "Tarjeta Crédito": "tarjeta_credito",
        "Tarjeta Débito": "tarjeta_debito",
        "Efectivo": "efectivo"
    });

    const MEDIOS_UI = Object.freeze({
        transferencia: "Transferencia",
        webpay_credito: "WebPay Crédito",
        webpay_debito: "WebPay Débito",
        tarjeta_credito: "Tarjeta Crédito",
        tarjeta_debito: "Tarjeta Débito",
        efectivo: "Efectivo"
    });

    function escapar(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function dinero(valor) {
        return "$" + Number(valor || 0).toLocaleString("es-CL");
    }

    function fechaHora(valor) {
        if (!valor) return "";
        try {
            return new Intl.DateTimeFormat("es-CL", {
                timeZone: "America/Santiago",
                dateStyle: "short",
                timeStyle: "short"
            }).format(new Date(valor));
        } catch {
            return String(valor);
        }
    }

    function opcionesMedio(valor = "") {
        return `
            <option value="" ${!valor ? "selected" : ""}>Seleccionar...</option>
            ${Object.keys(MEDIOS).map(nombre =>
                `<option value="${nombre}" ${valor === nombre ? "selected" : ""}>${nombre}</option>`
            ).join("")}
        `;
    }

    async function ingresosDia(fecha) {
        const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error) throw error;
        return (data || [])
            .filter(f => ["libre-ingresa", "sale-ingresa", "fullday"].includes(f.estado_operativo))
            .map(f => ({
                numero: Number(f.numero),
                titular: f.estado_operativo === "fullday" ? f.fullday_titular : f.ingreso_titular,
                reservaId: f.estado_operativo === "fullday" ? f.fullday_reserva_id : f.ingreso_reserva_id
            }))
            .filter(x => x.reservaId);
    }

    async function saldosAlojamiento(ids) {
        if (!ids.length) return new Map();
        const { data, error } = await cliente
            .from("vista_saldos_alojamiento_reserva")
            .select("reserva_id,total_alojamiento,pagado_alojamiento,saldo_alojamiento")
            .in("reserva_id", ids);
        if (error) throw error;
        return new Map((data || []).map(x => [x.reserva_id, x]));
    }

    async function totalesServicios(ids) {
        if (!ids.length) return new Map();
        const { data, error } = await cliente
            .from("vista_estado_cargos")
            .select("reserva_id,monto,tipo_cargo,estado")
            .in("reserva_id", ids)
            .eq("tipo_cargo", "servicio")
            .eq("estado", "activo");
        if (error) throw error;

        const mapa = new Map();
        (data || []).forEach(cargo => {
            mapa.set(
                cargo.reserva_id,
                Number(mapa.get(cargo.reserva_id) || 0) + Number(cargo.monto || 0)
            );
        });
        return mapa;
    }

    async function pagosSaldo(ids) {
        if (!ids.length) return [];
        const { data, error } = await cliente
            .from("pagos")
            .select("id,reserva_id,monto,medio_pago,folio,codigo_autorizacion,bove,referencia_externa,fecha_pago,verificado_por,verificado_en,estado,observaciones")
            .in("reserva_id", ids)
            .eq("tipo_movimiento", "pago")
            .in("etapa_operativa", ["saldo", "abono"])
            .eq("estado", "confirmado")
            .order("fecha_pago", { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async function cierresBove(ids) {
        if (!ids.length) return new Map();
        const { data, error } = await cliente
            .from("reservas")
            .select("id,bove_cierre,bove_cierre_registrado_por,bove_cierre_registrado_en,bove_checkout,bove_checkout_registrado_por,bove_checkout_registrado_en")
            .in("id", ids);
        if (error) throw error;
        return new Map((data || []).map(x => [x.id, x]));
    }

    async function usuariosPorId(ids) {
        const unicos = [...new Set(ids.filter(Boolean))];
        if (!unicos.length) return new Map();
        const { data, error } = await cliente
            .from("usuarios")
            .select("id,nombre,apellido")
            .in("id", unicos);
        if (error) throw error;
        return new Map((data || []).map(u => [u.id, [u.nombre, u.apellido].filter(Boolean).join(" ")]));
    }

    function agruparPagos(pagos) {
        const mapa = new Map();
        pagos.forEach(pago => {
            if (!mapa.has(pago.reserva_id)) mapa.set(pago.reserva_id, []);
            mapa.get(pago.reserva_id).push(pago);
        });
        return mapa;
    }

    function requisitosMedio(medioDB) {
        if (medioDB === "transferencia") {
            return { glosa: true, folio: false, bovtar: false, codAut: false };
        }
        if (["webpay_credito", "webpay_debito"].includes(medioDB)) {
            return { glosa: false, folio: false, bovtar: false, codAut: true };
        }
        if (["tarjeta_credito", "tarjeta_debito"].includes(medioDB)) {
            return { glosa: false, folio: true, bovtar: true, codAut: false };
        }
        return { glosa: false, folio: false, bovtar: false, codAut: false };
    }

    function htmlEditorPago(pago) {
        const medioUI = MEDIOS_UI[pago.medio_pago] || "";
        return `
            <div class="haiku-pago-editor" data-haiku-pago-editor hidden>
                <div class="haiku-pago-editor-grid">
                    <label>
                        <span>Medio de pago</span>
                        <select data-haiku-editar-pago-medio>${opcionesMedio(medioUI)}</select>
                    </label>
                    <div class="haiku-pago-editor-monto">
                        <span>Monto registrado</span>
                        <strong>${dinero(pago.monto)}</strong>
                        <small>El monto no se modifica.</small>
                    </div>
                </div>
                <div class="haiku-pago-editor-datos">
                    <label data-haiku-editar-campo-glosa hidden><span>Glosa</span><input type="text" data-haiku-editar-pago-glosa value="${escapar(pago.referencia_externa || "")}" placeholder="Pegar glosa bancaria"></label>
                    <label data-haiku-editar-campo-folio hidden><span>Folio</span><input type="text" data-haiku-editar-pago-folio value="${escapar(pago.folio || "")}" placeholder="Rellenar"></label>
                    <label data-haiku-editar-campo-bovtar hidden><span>BOVTAR</span><input type="text" data-haiku-editar-pago-bovtar value="${escapar(pago.bove || "")}" placeholder="Rellenar"></label>
                    <label data-haiku-editar-campo-codaut hidden><span>CodAut</span><input type="text" data-haiku-editar-pago-codaut value="${escapar(pago.codigo_autorizacion || "")}" placeholder="Rellenar"></label>
                </div>
                <div class="haiku-pago-editor-acciones">
                    <button type="button" class="haiku-pago-editor-cancelar" data-haiku-editar-pago-cancelar>Cancelar</button>
                    <button type="button" class="haiku-pago-editor-guardar" data-haiku-editar-pago-guardar>Guardar corrección</button>
                </div>
            </div>`;
    }

    function htmlPagoConfirmado(pago, usuarios) {
        const medio = MEDIOS_UI[pago.medio_pago] || pago.medio_pago || "Sin medio";
        const revisor = pago.verificado_por
            ? (usuarios.get(pago.verificado_por) || "Usuario HAIKU")
            : "Sin revisión registrada";
        const registradoPorHaku = /asistente\s+haiku/i.test(String(pago.observaciones || ""));
        const extras = [];
        if (pago.referencia_externa) extras.push(`Glosa: ${escapar(pago.referencia_externa)}`);
        if (pago.bove) extras.push(`BOVTAR: ${escapar(pago.bove)}`);
        if (pago.folio) extras.push(`Folio: ${escapar(pago.folio)}`);
        if (pago.codigo_autorizacion) extras.push(`CodAut: ${escapar(pago.codigo_autorizacion)}`);

        return `
            <div class="haiku-saldo-pago-confirmado" data-haiku-pago-id="${pago.id}">
                <div class="haiku-saldo-pago-principal">
                    <strong>${dinero(pago.monto)}</strong>
                    <span>${escapar(medio)}</span>
                    <span class="haiku-pago-ok">✓</span>
                    <button type="button" class="haiku-pago-editar" data-haiku-pago-editar>Editar</button>
                </div>
                <div class="haiku-saldo-pago-meta">
                    ${extras.length ? `<span>${extras.join(" · ")}</span>` : ""}
                    ${registradoPorHaku ? `<span>Registrado por: Asistente Haku</span>` : ""}
                    <span>Manager: ${escapar(revisor)}</span>
                    ${pago.verificado_en || pago.fecha_pago ? `<span>${escapar(fechaHora(pago.verificado_en || pago.fecha_pago))}</span>` : ""}
                </div>
                ${htmlEditorPago(pago)}
            </div>`;
    }

    function actualizarCamposEditorPago(editor) {
        const medioUI = editor?.querySelector("[data-haiku-editar-pago-medio]")?.value || "";
        const req = requisitosMedio(MEDIOS[medioUI] || "");
        [
            ["glosa", req.glosa],
            ["folio", req.folio],
            ["bovtar", req.bovtar],
            ["codaut", req.codAut]
        ].forEach(([campo, visible]) => {
            const fila = editor?.querySelector(`[data-haiku-editar-campo-${campo}]`);
            const input = editor?.querySelector(`[data-haiku-editar-pago-${campo}]`);
            if (fila) fila.hidden = !visible;
            input?.toggleAttribute("required", visible);
        });
    }

    function leerEditorPago(editor) {
        return {
            medio: editor?.querySelector("[data-haiku-editar-pago-medio]")?.value || "",
            glosa: editor?.querySelector("[data-haiku-editar-pago-glosa]")?.value.trim() || "",
            folio: editor?.querySelector("[data-haiku-editar-pago-folio]")?.value.trim() || "",
            bovtar: editor?.querySelector("[data-haiku-editar-pago-bovtar]")?.value.trim() || "",
            codAut: editor?.querySelector("[data-haiku-editar-pago-codaut]")?.value.trim() || ""
        };
    }

    function borradorInicial(saldo) {
        return {
            monto: Number(saldo || 0),
            medio: "",
            glosa: "",
            folio: "",
            bovtar: "",
            codAut: "",
            manager: false
        };
    }

    function leerFormulario(tarjeta) {
        return {
            monto: Number(tarjeta.querySelector("[data-haiku-saldo-monto]")?.value || 0),
            medio: tarjeta.querySelector("[data-haiku-saldo-medio]")?.value || "",
            glosa: tarjeta.querySelector("[data-haiku-saldo-glosa]")?.value.trim() || "",
            folio: tarjeta.querySelector("[data-haiku-saldo-folio]")?.value.trim() || "",
            bovtar: tarjeta.querySelector("[data-haiku-saldo-bovtar]")?.value.trim() || "",
            codAut: tarjeta.querySelector("[data-haiku-saldo-codaut]")?.value.trim() || "",
            manager: tarjeta.querySelector("[data-haiku-saldo-manager]")?.checked === true
        };
    }

    function guardarBorrador(tarjeta) {
        const reservaId = tarjeta?.dataset?.reservaId;
        if (reservaId) borradores.set(reservaId, leerFormulario(tarjeta));
    }

    function actualizarCamposPorMedio(tarjeta) {
        const medioUI = tarjeta.querySelector("[data-haiku-saldo-medio]")?.value || "";
        const req = requisitosMedio(MEDIOS[medioUI] || "");
        [
            ["glosa", req.glosa],
            ["folio", req.folio],
            ["bovtar", req.bovtar],
            ["codaut", req.codAut]
        ].forEach(([campo, visible]) => {
            const fila = tarjeta.querySelector(`[data-haiku-campo-${campo}]`);
            const input = tarjeta.querySelector(`[data-haiku-saldo-${campo}]`);
            if (fila) fila.hidden = !visible;
            input?.toggleAttribute("required", visible);
        });
    }

    function htmlFormulario(saldo, borrador) {
        return `
            <div class="haiku-saldo-formulario" data-haiku-saldo-formulario>
                <div class="haiku-saldo-form-grid">
                    <label><span>Monto de este pago</span><div class="pago-checkin-input-monto"><span>$</span><input type="number" data-haiku-saldo-monto min="1" step="1000" max="${saldo}" value="${Number(borrador.monto || saldo)}"></div></label>
                    <label><span>Medio de pago</span><select data-haiku-saldo-medio>${opcionesMedio(borrador.medio)}</select></label>
                </div>
                <div class="haiku-saldo-datos-dinamicos">
                    <label data-haiku-campo-glosa hidden><span>Glosa</span><input type="text" data-haiku-saldo-glosa value="${escapar(borrador.glosa)}" placeholder="Pegar glosa bancaria"></label>
                    <label data-haiku-campo-folio hidden><span>Folio</span><input type="text" data-haiku-saldo-folio value="${escapar(borrador.folio)}" placeholder="Rellenar"></label>
                    <label data-haiku-campo-bovtar hidden><span>BOVTAR</span><input type="text" data-haiku-saldo-bovtar value="${escapar(borrador.bovtar)}" placeholder="Rellenar"></label>
                    <label data-haiku-campo-codaut hidden><span>CodAut</span><input type="text" data-haiku-saldo-codaut value="${escapar(borrador.codAut)}" placeholder="Rellenar"></label>
                    <label class="haiku-saldo-manager"><span>Manager</span><span class="haiku-saldo-check-wrap"><input type="checkbox" data-haiku-saldo-manager ${borrador.manager ? "checked" : ""}>Revisado</span></label>
                </div>
                <button type="button" class="haiku-saldo-registrar" data-haiku-saldo-registrar>Registrar pago</button>
            </div>`;
    }

    function htmlBove(cierre, usuarios) {
        if (cierre?.bove_cierre) {
            const usuario = cierre.bove_cierre_registrado_por
                ? (usuarios.get(cierre.bove_cierre_registrado_por) || "Usuario HAIKU")
                : "Usuario HAIKU";
            return `
                <div class="haiku-bove-cierre haiku-bove-ok">
                    <strong>✓ BOVE alojamiento registrado</strong>
                    <span>${escapar(cierre.bove_cierre)}</span>
                    <small>${escapar(usuario)}${cierre.bove_cierre_registrado_en ? ` · ${escapar(fechaHora(cierre.bove_cierre_registrado_en))}` : ""}</small>
                </div>`;
        }
        return `
            <div class="haiku-bove-cierre haiku-bove-pendiente">
                <strong>Alojamiento pagado · falta BOVE</strong>
                <span>Registra el BOVE emitido por el total del alojamiento.</span>
                <div class="haiku-bove-fila"><input type="text" data-haiku-bove-total placeholder="BOVE alojamiento"><button type="button" data-haiku-bove-registrar>Registrar BOVE</button></div>
            </div>`;
    }

    function htmlServiciosCheckout(totalServicios, cierre, usuarios) {
        if (Number(totalServicios || 0) <= 0) return "";

        const registrado = Boolean(cierre?.bove_checkout);
        const usuario = cierre?.bove_checkout_registrado_por
            ? (usuarios.get(cierre.bove_checkout_registrado_por) || "Usuario HAIKU")
            : "";

        return `
            <div class="haiku-checkin-servicios-separados ${registrado ? "haiku-checkin-servicios-ok" : ""}">
                <div class="haiku-checkin-servicios-cabecera">
                    <span>Servicios Check-out</span>
                    <strong>${dinero(totalServicios)}</strong>
                </div>
                ${registrado ? `
                    <div class="haiku-checkin-servicios-bove">
                        <strong>✓ BOVE Check-out registrado</strong>
                        <span>${escapar(cierre.bove_checkout)}</span>
                        <small>${escapar(usuario)}${cierre.bove_checkout_registrado_en ? ` · ${escapar(fechaHora(cierre.bove_checkout_registrado_en))}` : ""}</small>
                    </div>` : `
                    <small class="haiku-checkin-servicios-pendiente">BOVE Check-out pendiente</small>
                `}
            </div>`;
    }

    async function cargarSaldosCheckinMixto() {
        if (renderizando || !window.haikuSesion) return;
        const fecha = fechaActual();
        const lista = document.getElementById("pagos-lista-checkin");
        const contador = document.getElementById("pagos-contador-checkin");
        if (!fecha || !lista || !contador) return;

        renderizando = true;
        try {
            const ingresos = await ingresosDia(fecha);
            const ids = [...new Set(ingresos.map(i => i.reservaId))];
            const [saldos, pagos, cierres, servicios] = await Promise.all([
                saldosAlojamiento(ids), pagosSaldo(ids), cierresBove(ids), totalesServicios(ids)
            ]);

            const idsUsuarios = pagos.map(p => p.verificado_por);
            cierres.forEach(c => {
                idsUsuarios.push(c.bove_cierre_registrado_por);
                idsUsuarios.push(c.bove_checkout_registrado_por);
            });
            const usuarios = await usuariosPorId(idsUsuarios);
            const pagosPorReserva = agruparPagos(pagos);

            lista.innerHTML = "";
            let pendientes = 0;

            ingresos.forEach(item => {
                const estado = saldos.get(item.reservaId) || {
                    total_alojamiento: 0,
                    saldo_alojamiento: 0
                };
                const total = Number(estado.total_alojamiento || 0);
                const saldo = Number(estado.saldo_alojamiento || 0);
                const pagosCompletos = saldo <= 0;
                const cierre = cierres.get(item.reservaId) || null;
                const cierreCompleto = pagosCompletos && Boolean(cierre?.bove_cierre);
                const pagosReserva = pagosPorReserva.get(item.reservaId) || [];
                const totalServicios = Number(servicios.get(item.reservaId) || 0);
                if (!cierreCompleto) pendientes++;

                const tarjeta = document.createElement("div");
                tarjeta.className = "pago-checkin-item haiku-saldo-v4 haiku-saldo-v5" +
                    (cierreCompleto ? " pago-checkin-completo" : pagosCompletos ? " haiku-bove-falta" : "");
                tarjeta.dataset.reservaId = item.reservaId;
                tarjeta.dataset.haikuSaldoV4 = "1";
                tarjeta.dataset.haikuSaldoV5 = "1";

                const pagosHtml = pagosReserva.map(p => htmlPagoConfirmado(p, usuarios)).join("");
                const borrador = borradores.get(item.reservaId) || borradorInicial(saldo);
                if (!borradores.has(item.reservaId) && !pagosCompletos) borradores.set(item.reservaId, borrador);

                tarjeta.innerHTML = `
                    <div class="pago-checkin-nuevo">
                        <div class="pago-checkin-cabecera">
                            <div class="pago-checkin-identidad"><strong>CAB ${item.numero}</strong><span>· ${escapar(item.titular || "Sin titular")}</span></div>
                            <span class="pago-checkin-estado">${cierreCompleto ? "✓ Completo" : pagosCompletos ? "BOVE pendiente" : "Pendiente"}</span>
                        </div>
                        <div class="pago-checkin-resumen-nuevo">
                            <div class="haiku-saldo-resumen-celda"><span>Total reserva</span><strong>${dinero(total)}</strong></div>
                            <div class="haiku-saldo-resumen-celda"><span>Saldo pendiente</span><strong>${dinero(saldo)}</strong></div>
                        </div>
                        ${pagosReserva.length ? `<details class="haiku-saldo-detalle" ${cierreCompleto ? "" : "open"}><summary>${cierreCompleto ? "Ver detalle de pagos" : `Pagos registrados (${pagosReserva.length})`}</summary><div class="haiku-saldo-pagos-lista">${pagosHtml}</div></details>` : ""}
                        ${pagosCompletos ? htmlBove(cierre, usuarios) : htmlFormulario(saldo, borrador)}
                        ${cierreCompleto ? htmlServiciosCheckout(totalServicios, cierre, usuarios) : ""}
                    </div>`;

                lista.appendChild(tarjeta);
                if (!pagosCompletos) actualizarCamposPorMedio(tarjeta);
            });

            contador.textContent = String(pendientes);
            if (!ingresos.length) lista.innerHTML = `<p class="pagos-checkout-vacio">No hay ingresos para esta fecha.</p>`;
            console.info("HAIKU · Saldo Check-in V5 separado:", fecha, ingresos.length);
        } catch (error) {
            console.error("HAIKU · Error cargando Saldo Check-in V5:", error);
        } finally {
            renderizando = false;
        }
    }

    function programarRender(ms = 40) {
        clearTimeout(timerRender);
        timerRender = setTimeout(cargarSaldosCheckinMixto, ms);
    }

    document.addEventListener("input", evento => {
        const tarjeta = evento.target.closest?.(".haiku-saldo-v5[data-reserva-id]");
        if (
            tarjeta &&
            evento.target.matches(
                "[data-haiku-saldo-monto],[data-haiku-saldo-glosa],[data-haiku-saldo-folio],[data-haiku-saldo-bovtar],[data-haiku-saldo-codaut]"
            )
        ) {
            guardarBorrador(tarjeta);
        }
    }, true);

    document.addEventListener("change", evento => {
        const tarjeta = evento.target.closest?.(".haiku-saldo-v5[data-reserva-id]");
        if (!tarjeta) return;
        if (evento.target.matches("[data-haiku-saldo-medio],[data-haiku-saldo-manager]")) {
            guardarBorrador(tarjeta);
            if (evento.target.matches("[data-haiku-saldo-medio]")) actualizarCamposPorMedio(tarjeta);
        }
    }, true);

    document.addEventListener("change", evento => {
        const select = evento.target.closest?.("[data-haiku-editar-pago-medio]");
        if (!select) return;
        actualizarCamposEditorPago(select.closest("[data-haiku-pago-editor]"));
    }, true);

    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.("[data-haiku-pago-editar]");
        if (!boton) return;
        evento.preventDefault();
        const contenedor = boton.closest("[data-haiku-pago-id]");
        const editor = contenedor?.querySelector("[data-haiku-pago-editor]");
        if (!editor) return;
        const abrir = editor.hidden;
        document.querySelectorAll("[data-haiku-pago-editor]:not([hidden])").forEach(otro => {
            if (otro !== editor) otro.hidden = true;
        });
        editor.hidden = !abrir;
        boton.textContent = abrir ? "Cerrar" : "Editar";
        if (abrir) actualizarCamposEditorPago(editor);
    }, true);

    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.("[data-haiku-editar-pago-cancelar]");
        if (!boton) return;
        evento.preventDefault();
        const editor = boton.closest("[data-haiku-pago-editor]");
        const contenedor = boton.closest("[data-haiku-pago-id]");
        if (editor) editor.hidden = true;
        const abrir = contenedor?.querySelector("[data-haiku-pago-editar]");
        if (abrir) abrir.textContent = "Editar";
    }, true);

    document.addEventListener("click", async evento => {
        const boton = evento.target.closest?.("[data-haiku-editar-pago-guardar]");
        if (!boton || guardandoEdicionPago) return;
        const contenedor = boton.closest("[data-haiku-pago-id]");
        const editor = boton.closest("[data-haiku-pago-editor]");
        const pagoId = contenedor?.dataset?.haikuPagoId || "";
        if (!pagoId || !editor) return;

        evento.preventDefault();
        evento.stopPropagation();

        const d = leerEditorPago(editor);
        const medioDB = MEDIOS[d.medio] || "";
        const req = requisitosMedio(medioDB);
        if (!medioDB) return alert("Selecciona el medio de pago.");
        if (req.glosa && !d.glosa) return alert("Transferencia requiere Glosa.");
        if (req.folio && !d.folio) return alert("Tarjeta requiere Folio.");
        if (req.bovtar && !d.bovtar) return alert("Tarjeta requiere BOVTAR.");
        if (req.codAut && !d.codAut) return alert("WebPay requiere CodAut.");
        if (!window.haikuTienePermiso?.("pagos.registrar") || !window.haikuTienePermiso?.("pagos.verificar")) {
            return alert("Tu usuario no tiene permiso para editar pagos confirmados.");
        }

        guardandoEdicionPago = true;
        const texto = boton.textContent;
        boton.disabled = true;
        boton.textContent = "Guardando…";
        try {
            const { data, error } = await cliente.rpc("haiku_editar_pago_confirmado_saldo", {
                p_pago_id: pagoId,
                p_medio_pago: medioDB,
                p_glosa: d.glosa || null,
                p_folio: d.folio || null,
                p_bovtar: d.bovtar || null,
                p_codigo_autorizacion: d.codAut || null
            });
            if (error) throw error;
            console.info("HAIKU · Pago confirmado corregido:", data);
            await cargarSaldosCheckinMixto();
            await window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1?.refrescar(fechaActual());
            await window.haikuSincronizarReservasSupabase?.();
        } catch (error) {
            console.error("HAIKU · No fue posible corregir pago confirmado:", error);
            alert(error?.message || "No fue posible guardar la corrección.");
        } finally {
            guardandoEdicionPago = false;
            boton.disabled = false;
            boton.textContent = texto;
        }
    }, true);

    document.addEventListener("click", async evento => {
        const boton = evento.target.closest?.(".haiku-saldo-v5 [data-haiku-saldo-registrar]");
        if (!boton || guardandoPago) return;
        const tarjeta = boton.closest(".haiku-saldo-v5[data-reserva-id]");
        const reservaId = tarjeta?.dataset?.reservaId;
        if (!tarjeta || !reservaId) return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        const d = leerFormulario(tarjeta);
        const medioDB = MEDIOS[d.medio] || "";
        const req = requisitosMedio(medioDB);
        if (d.monto <= 0) return alert("Ingresa el monto de este pago.");
        if (!medioDB) return alert("Selecciona el medio de pago.");
        if (req.glosa && !d.glosa) return alert("Transferencia requiere Glosa.");
        if (req.folio && !d.folio) return alert("Tarjeta requiere Folio.");
        if (req.bovtar && !d.bovtar) return alert("Tarjeta requiere BOVTAR.");
        if (req.codAut && !d.codAut) return alert("WebPay requiere CodAut.");
        if (!d.manager) return alert("Manager debe revisar el pago antes de registrarlo.");
        if (!window.haikuTienePermiso?.("pagos.registrar")) return alert("Tu usuario no tiene permiso para registrar pagos.");
        if (!window.haikuTienePermiso?.("pagos.verificar")) return alert("Tu usuario no tiene permiso para validar pagos como Manager.");

        guardandoPago = true;
        const textoAnterior = boton.textContent;
        boton.disabled = true;
        boton.textContent = "Registrando…";
        try {
            const { data, error } = await cliente.rpc("haiku_registrar_pago_checkin_v2", {
                p_reserva_id: reservaId,
                p_monto: d.monto,
                p_medio_pago: medioDB,
                p_glosa: d.glosa || null,
                p_folio: d.folio || null,
                p_bovtar: d.bovtar || null,
                p_codigo_autorizacion: d.codAut || null,
                p_manager_revisado: true
            });
            if (error) throw error;
            console.info("HAIKU · Pago parcial Check-in V5 registrado:", data);
            borradores.delete(reservaId);
            await cargarSaldosCheckinMixto();
            await window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1
                ?.refrescar(fechaActual());
            await window.haikuSincronizarReservasSupabase?.();
        } catch (error) {
            console.error("HAIKU · No fue posible registrar pago Check-in V5:", error);
            alert(error?.message || "No fue posible registrar el pago.");
        } finally {
            guardandoPago = false;
            boton.disabled = false;
            boton.textContent = textoAnterior;
        }
    }, true);

    document.addEventListener("click", async evento => {
        const boton = evento.target.closest?.(".haiku-saldo-v5 [data-haiku-bove-registrar]");
        if (!boton || guardandoBove) return;
        const tarjeta = boton.closest(".haiku-saldo-v5[data-reserva-id]");
        const reservaId = tarjeta?.dataset?.reservaId;
        const bove = tarjeta?.querySelector("[data-haiku-bove-total]")?.value.trim() || "";
        if (!reservaId) return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
        if (!bove) return alert("Ingresa el BOVE del alojamiento.");

        guardandoBove = true;
        boton.disabled = true;
        const texto = boton.textContent;
        boton.textContent = "Guardando…";
        try {
            const { data, error } = await cliente.rpc("haiku_registrar_bove_reserva", {
                p_reserva_id: reservaId,
                p_bove: bove
            });
            if (error) throw error;
            console.info("HAIKU · BOVE alojamiento V5 registrado:", data);
            window.dispatchEvent(new CustomEvent('haiku:bove-actualizado', {detail:{reservaId,tipo:'alojamiento'}}));
            await cargarSaldosCheckinMixto();
            await window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1
                ?.refrescar(fechaActual());
        } catch (error) {
            console.error("HAIKU · No fue posible registrar BOVE alojamiento V5:", error);
            alert(error?.message || "No fue posible registrar el BOVE.");
        } finally {
            guardandoBove = false;
            boton.disabled = false;
            boton.textContent = texto;
        }
    }, true);

    function instalarObservador() {
        const lista = document.getElementById("pagos-lista-checkin");
        if (!lista || lista.dataset.haikuSaldoObserverV5 === "1") return false;
        lista.dataset.haikuSaldoObserverV5 = "1";
        new MutationObserver(() => {
            if (renderizando) return;
            if (lista.querySelector(".pago-checkin-item:not([data-haiku-saldo-v5])")) programarRender(15);
        }).observe(lista, { childList: true, subtree: true });
        return true;
    }

    function activar() {
        try { window.cargarSaldosCheckin = cargarSaldosCheckinMixto; } catch {}
        window.haikuCargarSaldosCheckinSupabase = cargarSaldosCheckinMixto;
        instalarObservador();
        const seccion = document.getElementById("seccion-pagos");
        if (seccion?.classList.contains("activa")) programarRender(10);
    }

    document.addEventListener("click", evento => {
        if (!evento.target.closest?.('[data-seccion="pagos"]')) return;
        setTimeout(activar, 40);
        programarRender(90);
    });

    window.addEventListener("haiku:auth-ready", () => setTimeout(activar, 100));
    setTimeout(activar, 180);

    const estilo = document.createElement("style");
    estilo.textContent = `
        .haiku-saldo-v5 .pago-checkin-resumen-nuevo { gap: 8px; }
        .haiku-saldo-resumen-celda { flex:1; padding:11px 12px; border:1px solid #e2e6e3; border-radius:10px; background:#fafbfa; display:flex; flex-direction:column; gap:4px; }
        .haiku-saldo-resumen-celda span { font-size:11px; color:#66736b; } .haiku-saldo-resumen-celda strong { font-size:15px; }
        .haiku-saldo-detalle { margin-top:10px; border-top:1px solid #e2e6e3; padding-top:8px; } .haiku-saldo-detalle summary { cursor:pointer; font-size:12px; font-weight:700; color:#315c47; }
        .haiku-saldo-pagos-lista { display:grid; gap:7px; margin-top:8px; } .haiku-saldo-pago-confirmado { border:1px solid #dbe9df; background:#f5fbf7; border-radius:9px; padding:9px 10px; }
        .haiku-saldo-pago-principal { display:flex; gap:8px; align-items:center; flex-wrap:wrap; } .haiku-saldo-pago-principal strong { font-size:13px; } .haiku-saldo-pago-principal span { font-size:12px; }
        .haiku-pago-ok { margin-left:auto; color:#18834c; font-weight:800; } .haiku-saldo-pago-meta { margin-top:5px; display:grid; gap:2px; color:#6e786f; font-size:10px; }
        .haiku-pago-editar { border:1px solid #bfd8c7; background:#fff; color:#285b43; border-radius:7px; padding:4px 8px; font-size:10px; font-weight:700; cursor:pointer; }
        .haiku-pago-editor { margin-top:9px; padding-top:9px; border-top:1px solid #dbe9df; }
        .haiku-pago-editor[hidden] { display:none !important; }
        .haiku-pago-editor-grid,.haiku-pago-editor-datos { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
        .haiku-pago-editor-grid label,.haiku-pago-editor-datos label { display:grid; gap:4px; font-size:10px; color:#58645d; }
        .haiku-pago-editor-grid select,.haiku-pago-editor-datos input { width:100%; min-width:0; box-sizing:border-box; }
        .haiku-pago-editor-datos { margin-top:8px; }
        .haiku-pago-editor-monto { border:1px solid #dce6df; border-radius:8px; padding:7px 9px; display:grid; gap:2px; background:#fbfdfb; }
        .haiku-pago-editor-monto span,.haiku-pago-editor-monto small { font-size:9px; color:#738078; } .haiku-pago-editor-monto strong { font-size:13px; color:#26352d; }
        .haiku-pago-editor-acciones { margin-top:8px; display:flex; justify-content:flex-end; gap:7px; }
        .haiku-pago-editor-acciones button { min-height:32px; border-radius:8px; padding:0 10px; font-size:10px; font-weight:700; cursor:pointer; }
        .haiku-pago-editor-cancelar { border:1px solid #d7dfda; background:#fff; color:#536159; }
        .haiku-pago-editor-guardar { border:0; background:#255f43; color:#fff; }
        .haiku-pago-editor-guardar:disabled { opacity:.6; cursor:wait; }
        .haiku-saldo-formulario { margin-top:12px; border-top:1px solid #e2e6e3; padding-top:12px; }
        .haiku-saldo-form-grid,.haiku-saldo-datos-dinamicos { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
        .haiku-saldo-form-grid label,.haiku-saldo-datos-dinamicos label { display:grid; gap:5px; font-size:11px; color:#58645d; }
        .haiku-saldo-form-grid input,.haiku-saldo-form-grid select,.haiku-saldo-datos-dinamicos input { width:100%; min-width:0; box-sizing:border-box; }
        .haiku-saldo-datos-dinamicos { margin-top:9px; } .haiku-saldo-manager { align-content:end; }
        .haiku-saldo-check-wrap { min-height:38px; border:1px solid #dce2de; border-radius:9px; padding:0 10px; display:flex; align-items:center; gap:7px; color:#26352d; }
        .haiku-saldo-registrar { width:100%; margin-top:11px; min-height:39px; border:0; border-radius:9px; background:#255f43; color:white; font-weight:700; cursor:pointer; }
        .haiku-saldo-registrar:disabled { opacity:.6; cursor:wait; }
        .haiku-saldo-v5.pago-checkin-completo { background:#f0faf3; border-color:#b9dfc6; }
        .haiku-saldo-v5.haiku-bove-falta { background:#fffaf0; border-color:#ead9a5; }
        .haiku-bove-cierre { margin-top:12px; padding:10px; border-radius:9px; display:grid; gap:5px; font-size:11px; }
        .haiku-bove-pendiente { border:1px solid #ead9a5; background:#fffdf7; } .haiku-bove-ok { border:1px solid #c6e4cf; background:#f4fbf6; }
        .haiku-bove-fila { display:flex; gap:7px; margin-top:3px; } .haiku-bove-fila input { flex:1; min-width:0; } .haiku-bove-fila button { border:0; border-radius:8px; padding:0 11px; background:#255f43; color:#fff; font-weight:700; }
        .haiku-checkin-servicios-separados { margin-top:9px; padding:10px; border:1px solid #e1e5e2; border-radius:9px; background:#fafbfa; display:grid; gap:7px; }
        .haiku-checkin-servicios-cabecera { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:11px; color:#5d6861; }
        .haiku-checkin-servicios-cabecera strong { color:#27332c; font-size:13px; }
        .haiku-checkin-servicios-bove { border-top:1px solid #e2e7e3; padding-top:7px; display:grid; gap:3px; font-size:10px; }
        .haiku-checkin-servicios-bove strong { color:#1d6942; font-size:11px; }
        .haiku-checkin-servicios-bove small,.haiku-checkin-servicios-pendiente { color:#68736c; font-size:10px; }
        .haiku-checkin-servicios-ok { border-color:#c6e4cf; background:#f6fbf7; }
        @media (max-width:650px) { .haiku-saldo-form-grid,.haiku-saldo-datos-dinamicos,.haiku-pago-editor-grid,.haiku-pago-editor-datos { grid-template-columns:1fr; } .haiku-bove-fila { flex-direction:column; } .haiku-bove-fila button { min-height:38px; } }
    `;
    document.head.appendChild(estilo);

    console.info("HAIKU · Saldo Check-in V5 separado preparado.");
})();
