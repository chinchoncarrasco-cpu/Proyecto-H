// ========================================
// HAIKU · VERIFICAR ABONOS · V3
// Solo lectura: los pagos nacen en "Añadir pago".
// Agrupa todos los abonos del mismo titular/unidad en una sola tarjeta.
// Cada movimiento conserva su verificación independiente.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let cargando = false;
    let verificando = false;
    let temporizador = 0;
    let observador = null;

    const MEDIOS = Object.freeze({
        transferencia: "Transferencia",
        webpay_credito: "WebPay Crédito",
        webpay_debito: "WebPay Débito",
        tarjeta_credito: "Tarjeta Crédito",
        tarjeta_debito: "Tarjeta Débito",
        efectivo: "Efectivo",
        otro: "Otro"
    });

    function escapar(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function dinero(valor) {
        return `$${Math.round(Number(valor || 0)).toLocaleString("es-CL")}`;
    }

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    async function ingresosDia(fecha) {
        const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error) throw error;

        return (data || [])
            .filter(fila => ["libre-ingresa", "sale-ingresa", "fullday"].includes(fila.estado_operativo))
            .map(fila => ({
                numero: Number(fila.numero || 0),
                titular: fila.estado_operativo === "fullday"
                    ? (fila.fullday_titular || "")
                    : (fila.ingreso_titular || ""),
                reservaId: fila.estado_operativo === "fullday"
                    ? fila.fullday_reserva_id
                    : fila.ingreso_reserva_id
            }))
            .filter(item => item.reservaId);
    }

    async function metadatosReservas(ids) {
        if (!ids.length) return [];
        const { data, error } = await cliente
            .from("reservas")
            .select("id,grupo_reserva_id,titular_nombre")
            .in("id", ids);
        if (error) throw error;
        return data || [];
    }

    async function abonos(ids) {
        if (!ids.length) return [];
        const { data, error } = await cliente
            .from("pagos")
            .select("id,reserva_id,pago_grupo_id,monto,medio_pago,folio,codigo_autorizacion,bove,referencia_externa,fecha_pago,verificado_por,verificado_en,pagador_nombre,observaciones")
            .in("reserva_id", ids)
            .eq("tipo_movimiento", "pago")
            .eq("etapa_operativa", "abono")
            .eq("estado", "confirmado")
            .order("fecha_pago", { ascending: true });
        if (error) throw error;
        return data || [];
    }

    function construirUnidades(ingresos, metadatos) {
        const meta = new Map((metadatos || []).map(item => [String(item.id), item]));
        const unidades = new Map();
        const unidadPorReserva = new Map();

        ingresos.forEach(item => {
            const reservaId = String(item.reservaId);
            const r = meta.get(reservaId) || {};
            const grupoId = r.grupo_reserva_id ? String(r.grupo_reserva_id) : "";
            const key = grupoId ? `grupo:${grupoId}` : `reserva:${reservaId}`;

            if (!unidades.has(key)) {
                unidades.set(key, {
                    key,
                    grupoId,
                    reservaIds: [],
                    cabs: [],
                    titular: r.titular_nombre || item.titular || "Sin titular"
                });
            }

            const unidad = unidades.get(key);
            if (!unidad.reservaIds.includes(reservaId)) unidad.reservaIds.push(reservaId);
            if (item.numero && !unidad.cabs.includes(item.numero)) unidad.cabs.push(item.numero);
            if ((!unidad.titular || unidad.titular === "Sin titular") && item.titular) unidad.titular = item.titular;
            unidadPorReserva.set(reservaId, key);
        });

        unidades.forEach(unidad => unidad.cabs.sort((a, b) => a - b));
        return { unidades, unidadPorReserva };
    }

    function construirPagosLogicos(filas, unidadPorReserva) {
        const mapa = new Map();

        (filas || []).forEach(pago => {
            const reservaId = String(pago.reserva_id || "");
            const unidadKey = unidadPorReserva.get(reservaId);
            if (!unidadKey) return;

            const key = pago.pago_grupo_id
                ? `pago-grupo:${pago.pago_grupo_id}`
                : `pago:${pago.id}`;

            if (!mapa.has(key)) {
                mapa.set(key, {
                    key,
                    unidadKey,
                    pagoId: String(pago.id),
                    pagoGrupoId: pago.pago_grupo_id ? String(pago.pago_grupo_id) : "",
                    reservaIds: [],
                    monto: 0,
                    medio: pago.medio_pago || "",
                    folio: pago.folio || "",
                    codAut: pago.codigo_autorizacion || "",
                    bove: pago.bove || "",
                    glosa: pago.referencia_externa || "",
                    fechaPago: pago.fecha_pago || "",
                    verificado: true,
                    pagador: pago.pagador_nombre || "",
                    observacion: pago.observaciones || ""
                });
            }

            const logico = mapa.get(key);
            logico.monto += Number(pago.monto || 0);
            if (!logico.reservaIds.includes(reservaId)) logico.reservaIds.push(reservaId);
            if (!logico.medio && pago.medio_pago) logico.medio = pago.medio_pago;
            if (!logico.folio && pago.folio) logico.folio = pago.folio;
            if (!logico.codAut && pago.codigo_autorizacion) logico.codAut = pago.codigo_autorizacion;
            if (!logico.bove && pago.bove) logico.bove = pago.bove;
            if (!logico.glosa && pago.referencia_externa) logico.glosa = pago.referencia_externa;
            if (!logico.fechaPago && pago.fecha_pago) logico.fechaPago = pago.fecha_pago;
            if (!pago.verificado_en) logico.verificado = false;
        });

        return [...mapa.values()].sort((a, b) => {
            const fa = new Date(a.fechaPago || 0).getTime();
            const fb = new Date(b.fechaPago || 0).getTime();
            return fa - fb;
        });
    }

    function identidad(unidad) {
        const cabs = unidad.cabs.map(numero => `CAB ${numero}`).join(" + ");
        if (unidad.grupoId && unidad.cabs.length > 1) {
            return `<strong>↳ ${escapar(unidad.titular)}</strong><span>· ${escapar(cabs)}</span>`;
        }
        return `<strong>${escapar(cabs || "CAB —")}</strong><span>· ${escapar(unidad.titular || "Sin titular")}</span>`;
    }

    function detallePago(pago) {
        if (pago.medio === "transferencia") {
            return `Glosa: ${escapar(pago.glosa || "No registrada")}`;
        }
        if (["webpay_credito", "webpay_debito"].includes(pago.medio)) {
            return `CodAut: ${escapar(pago.codAut || "No registrado")}`;
        }
        if (["tarjeta_credito", "tarjeta_debito"].includes(pago.medio)) {
            return `Folio: ${escapar(pago.folio || "No registrado")} · BOVTAR: ${escapar(pago.bove || "No registrado")}`;
        }
        return "";
    }

    function filaPago(pago) {
        const detalle = detallePago(pago);
        const medio = MEDIOS[pago.medio] || pago.medio || "Sin medio";

        return `
            <div class="haiku-abono-v2-movimiento ${pago.verificado ? "verificado" : "pendiente"}"
                data-pago-id="${escapar(pago.pagoId)}">
                <div class="haiku-abono-v2-movimiento-superior">
                    <div class="haiku-abono-v2-resumen">
                        <span><small>Abono</small><strong>${dinero(pago.monto)}</strong></span>
                        <span><small>Medio</small><strong>${escapar(medio)}</strong></span>
                    </div>

                    <label class="haiku-abono-v2-confirmar">
                        <input type="checkbox"
                            data-haiku-verificar-abono-v2="${escapar(pago.pagoId)}"
                            ${pago.verificado ? "checked disabled" : ""}>
                        <span>${pago.verificado ? "Verificado" : "Confirmar abono"}</span>
                    </label>
                </div>

                ${detalle ? `<div class="haiku-abono-v2-detalle"><small>${detalle}</small></div>` : ""}
            </div>`;
    }

    function tarjetaPagos(unidad, movimientos) {
        const tarjeta = document.createElement("div");
        const pendientes = movimientos.filter(pago => !pago.verificado).length;
        const todosVerificados = pendientes === 0;
        const cantidad = movimientos.length;

        tarjeta.className = "haiku-abono-verificacion-v2 haiku-abono-v2-unidad" +
            (todosVerificados ? " verificado" : " pendiente");
        tarjeta.dataset.unidadKey = unidad.key;
        tarjeta.dataset.reservaId = unidad.reservaIds[0] || "";

        const estado = todosVerificados
            ? `✓ ${cantidad === 1 ? "Verificado" : `${cantidad} abonos verificados`}`
            : pendientes === 1
                ? "1 pendiente de revisión"
                : `${pendientes} pendientes de revisión`;

        tarjeta.innerHTML = `
            <div class="haiku-abono-v2-cabecera">
                <div class="haiku-abono-v2-identidad">${identidad(unidad)}</div>
                <span class="haiku-abono-v2-estado">${estado}</span>
            </div>
            <div class="haiku-abono-v2-movimientos">
                ${movimientos.map(filaPago).join("")}
            </div>`;

        return tarjeta;
    }

    function tarjetaSinAbono(unidad) {
        const tarjeta = document.createElement("div");
        tarjeta.className = "haiku-abono-verificacion-v2 sin-abono";
        tarjeta.innerHTML = `
            <div class="haiku-abono-v2-cabecera">
                <div class="haiku-abono-v2-identidad">${identidad(unidad)}</div>
                <span class="haiku-abono-v2-estado">Sin abono</span>
            </div>
            <div class="haiku-abono-v2-vacio">Sin abono registrado desde <strong>Añadir pago</strong>.</div>`;
        return tarjeta;
    }

    async function cargarAbonosVerificacion() {
        const fecha = fechaActual();
        const lista = document.getElementById("pagos-lista-abonos");
        const contador = document.getElementById("pagos-contador-abonos");
        if (!fecha || !lista || !contador || !window.haikuSesion || cargando) return;

        cargando = true;
        try {
            const ingresos = await ingresosDia(fecha);
            const ids = [...new Set(ingresos.map(item => String(item.reservaId)).filter(Boolean))];

            if (!ids.length) {
                lista.innerHTML = `<p class="pagos-checkout-vacio sites-pagos-vacio-canonico">No hay ingresos para esta fecha.</p>`;
                contador.textContent = "0";
                return;
            }

            const [metadatos, pagos] = await Promise.all([
                metadatosReservas(ids),
                abonos(ids)
            ]);

            const { unidades, unidadPorReserva } = construirUnidades(ingresos, metadatos);
            const pagosLogicos = construirPagosLogicos(pagos, unidadPorReserva);
            const pagosPorUnidad = new Map();

            pagosLogicos.forEach(pago => {
                if (!pagosPorUnidad.has(pago.unidadKey)) pagosPorUnidad.set(pago.unidadKey, []);
                pagosPorUnidad.get(pago.unidadKey).push(pago);
            });

            const unidadesOrdenadas = [...unidades.values()].sort((a, b) =>
                (a.cabs[0] || 999) - (b.cabs[0] || 999)
            );

            lista.innerHTML = "";
            let pendientes = 0;

            unidadesOrdenadas.forEach(unidad => {
                const movimientos = pagosPorUnidad.get(unidad.key) || [];
                if (!movimientos.length) {
                    lista.appendChild(tarjetaSinAbono(unidad));
                    pendientes++;
                    return;
                }

                lista.appendChild(tarjetaPagos(unidad, movimientos));
                pendientes += movimientos.filter(pago => !pago.verificado).length;
            });

            contador.textContent = String(pendientes);
            console.info("HAIKU · Verificar abonos V3 agrupado:", fecha, pagosLogicos.length);
        } catch (error) {
            console.error("HAIKU · No fue posible cargar Verificar abonos V3:", error);
        } finally {
            cargando = false;
        }
    }

    async function verificarPago(check) {
        const pagoId = String(check?.dataset?.haikuVerificarAbonoV2 || "");
        if (!pagoId || verificando || !check.checked) return;

        if (typeof window.haikuTienePermiso === "function" && !window.haikuTienePermiso("pagos.verificar")) {
            check.checked = false;
            alert("Tu usuario no tiene permiso para verificar abonos.");
            return;
        }

        verificando = true;
        check.disabled = true;
        try {
            const { error } = await cliente.rpc("haiku_verificar_abono", { p_pago_id: pagoId });
            if (error) throw error;
            await cargarAbonosVerificacion();
        } catch (error) {
            console.error("HAIKU · No fue posible verificar el abono:", error);
            check.checked = false;
            check.disabled = false;
            alert(error?.message || "No fue posible verificar el abono.");
        } finally {
            verificando = false;
        }
    }

    document.addEventListener("change", evento => {
        const check = evento.target.closest?.("[data-haiku-verificar-abono-v2]");
        if (!check) return;
        evento.preventDefault();
        evento.stopPropagation();
        verificarPago(check);
    }, true);

    document.addEventListener("click", evento => {
        if (!evento.target.closest?.('[data-seccion="pagos"]')) return;
        setTimeout(cargarAbonosVerificacion, 65);
    });

    function programar() {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
            const lista = document.getElementById("pagos-lista-abonos");
            if (!lista) return;
            if (lista.querySelector(".pago-abono-item") && !lista.querySelector(".haiku-abono-verificacion-v2")) {
                cargarAbonosVerificacion();
            }
        }, 70);
    }

    function instalarObservador() {
        const lista = document.getElementById("pagos-lista-abonos");
        if (!lista || observador) return;
        observador = new MutationObserver(programar);
        observador.observe(lista, { childList: true });
    }

    function instalar() {
        try { window.cargarAbonosPagos = cargarAbonosVerificacion; } catch {}
        window.haikuCargarAbonosSupabase = cargarAbonosVerificacion;
        instalarObservador();

        const seccion = document.getElementById("seccion-pagos");
        if (seccion?.classList.contains("activa")) setTimeout(cargarAbonosVerificacion, 90);
    }

    window.addEventListener("haiku:auth-ready", () => setTimeout(instalar, 120));
    window.addEventListener("load", () => setTimeout(instalar, 160));
    setTimeout(instalar, 220);

    window.HAIKU_ABONOS_VERIFICACION_V2 = Object.freeze({
        refrescar: cargarAbonosVerificacion
    });

    console.info("HAIKU · Verificar abonos V3 agrupado preparado.");
})();
