// ========================================
// HAKU · PAGOS RELACIONADOS V1
// Recupera, de forma conservadora, movimientos del bloque financiero que
// pertenecen al titular/fecha solicitados pero que el parser no pudo unir a
// una reserva por discrepancias de CAB/concepto. No los marca como seguros:
// los deja en pagos_sin_asociacion para revisión humana.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_LIBRO_PAGOS_RELACIONADOS_V1) return;

    function normalizar(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function mismaPersona(a, b) {
        const na = normalizar(a), nb = normalizar(b);
        if (!na || !nb) return false;
        if (na === nb) return true;
        const ta = na.split(" ").filter(x => x.length > 1);
        const tb = nb.split(" ").filter(x => x.length > 1);
        return ta.length >= 2 && tb.length >= 2 && (ta.every(x => tb.includes(x)) || tb.every(x => ta.includes(x)));
    }

    function fechaCanon(valor) {
        const s = String(valor || "").trim();
        const mIso = s.match(/^(20\d{2})-(\d{2})-(\d{2})/);
        if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
        const mLocal = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/);
        if (!mLocal) return null;
        const y = Number(mLocal[3]) < 100 ? 2000 + Number(mLocal[3]) : Number(mLocal[3]);
        return `${String(y).padStart(4, "0")}-${String(Number(mLocal[2])).padStart(2, "0")}-${String(Number(mLocal[1])).padStart(2, "0")}`;
    }

    function fechaPagoObservada(pago) {
        return fechaCanon(pago?.fecha_comprobante) ||
            fechaCanon(pago?.fecha_pago) ||
            // El parser conserva la celda de fecha visible al comienzo del texto_original.
            // Esto cubre libros donde Excel guardó 3-9-2026 como texto y no como fecha tipada.
            fechaCanon(pago?.texto_original) ||
            fechaCanon(pago?.fecha_bloque) ||
            null;
    }

    function clavePago(pago) {
        const origen = pago?.origen || {};
        if (origen.hoja && origen.celda) return `src:${origen.hoja}|${origen.celda}`;
        const aut = normalizar(pago?.codigo_autorizacion).replace(/\s+/g, "");
        if (aut) return `aut:${aut}`;
        const folio = normalizar(pago?.folio).replace(/\s+/g, "");
        const bovtar = normalizar(pago?.bovtar).replace(/\s+/g, "");
        if (folio && bovtar) return `fb:${folio}|${bovtar}`;
        return `weak:${[
            normalizar(pago?.titular),
            Number(pago?.monto) || 0,
            fechaPagoObservada(pago) || "",
            normalizar(pago?.concepto),
            normalizar(pago?.texto_original)
        ].join("|")}`;
    }

    function pagoYaPresente(reservas, pago) {
        const clave = clavePago(pago);
        return (reservas || []).some(r => [...(r?.pagos || []), ...(r?.pagos_sin_asociacion || [])]
            .some(p => clavePago(p) === clave));
    }

    function fechaDentroReserva(reserva, fecha) {
        if (!fecha) return false;
        if (fechaCanon(reserva?.fecha_checkin) === fecha) return true;
        if ((reserva?.fechas_ocupadas || []).map(fechaCanon).includes(fecha)) return true;
        const entrada = fechaCanon(reserva?.fecha_checkin);
        const salida = fechaCanon(reserva?.fecha_checkout);
        return Boolean(entrada && salida && fecha >= entrada && fecha < salida);
    }

    function esConsultaIndividual(scope) {
        return Boolean(scope?.fecha && scope?.objetivos?.length === 1 && !scope.objetivos[0]?.cabana);
    }

    function fechaEsExacta(scope) {
        if (!esConsultaIndividual(scope)) return false;
        const texto = normalizar(scope?.texto);
        return !/\btodos\s+(?:los\s+)?pagos\b|\btodos\s+sus\s+pagos\b|\btodos\s+(?:los\s+)?movimientos\b/.test(texto);
    }

    function pagoDelDiaYTitular(pago, scope) {
        if (!mismaPersona(pago?.titular, scope.objetivos[0].nombre)) return false;
        return fechaPagoObservada(pago) === scope.fecha;
    }

    function normalizarMovimiento(pago) {
        const copia = { ...pago };
        // Si la fecha visible estaba guardada como texto por Excel, la promovemos
        // a fecha_comprobante para que la UI y la conciliación muestren la fecha real.
        if (!fechaCanon(copia.fecha_comprobante)) {
            const observada = fechaCanon(copia.texto_original);
            if (observada) copia.fecha_comprobante = observada;
        }
        const concepto = normalizar(copia.concepto);
        if (/\bearly\s*check\s*in\b|\bearly\s*checkin\b/.test(concepto)) {
            copia.tipo_movimiento = "servicio";
            copia.servicio_tipo = "early_checkin";
        }
        return copia;
    }

    function filtrarFechaSolicitada(data, scope) {
        if (!fechaEsExacta(scope)) return data;
        return {
            ...data,
            reservas: (data.reservas || []).map(r => ({
                ...r,
                pagos: (r.pagos || []).filter(p => fechaPagoObservada(p) === scope.fecha),
                pagos_sin_asociacion: (r.pagos_sin_asociacion || []).filter(p => fechaPagoObservada(p) === scope.fecha)
            }))
        };
    }

    function enriquecer(data) {
        const scope = window.HAIKU_LIBRO_PAGOS_FOCALIZADOS_V1?.estado?.();
        if (!esConsultaIndividual(scope) || !Array.isArray(data?.reservas) || !Array.isArray(data?.pagos)) return data;

        const reservas = data.reservas.filter(r => mismaPersona(r?.titular, scope.objetivos[0].nombre));
        if (!reservas.length) return filtrarFechaSolicitada(data, scope);

        // La fecha de la pregunta identifica la estadía objetivo. Sólo si hay una
        // única estadía compatible podemos adjuntar movimientos huérfanos sin adivinar.
        const destinos = reservas.filter(r => fechaDentroReserva(r, scope.fecha));
        let salida = data;

        if (destinos.length === 1) {
            const destino = destinos[0];
            const recuperados = data.pagos
                .filter(p => pagoDelDiaYTitular(p, scope))
                .filter(p => !pagoYaPresente(reservas, p))
                .map(normalizarMovimiento);

            if (recuperados.length) {
                const nuevasReservas = data.reservas.map(r => {
                    if (r !== destino) return r;
                    return {
                        ...r,
                        pagos_sin_asociacion: [...(r.pagos_sin_asociacion || []), ...recuperados.map(p => ({
                            ...p,
                            relacion_focal: {
                                motivo: "Titular y fecha de comprobante coinciden con la consulta; CAB/concepto no bastan para asociarlo automáticamente.",
                                confianza: "revision"
                            }
                        }))]
                    };
                });

                console.info("HAKU · Pagos relacionados recuperados para revisión:",
                    scope.objetivos[0].nombre, scope.fecha, recuperados.map(p => ({ monto: p.monto, concepto: p.concepto, fecha: p.fecha_comprobante, origen: p.origen })));

                salida = { ...data, reservas: nuevasReservas };
            }
        }

        return filtrarFechaSolicitada(salida, scope);
    }

    function instalar() {
        const original = window.HAIKU_LIBRO_RESERVA_V1;
        if (!original || original.__pagosRelacionadosProxy) return Boolean(original);
        if (typeof original.consultarHoja !== "function") return false;

        const consultarOriginal = original.consultarHoja.bind(original);
        window.HAIKU_LIBRO_RESERVA_V1 = Object.freeze({
            ...original,
            __pagosRelacionadosProxy: true,
            consultarHoja: async (...args) => enriquecer(await consultarOriginal(...args))
        });
        return true;
    }

    window.HAIKU_LIBRO_PAGOS_RELACIONADOS_V1 = Object.freeze({
        version: "1.1.0",
        instalar,
        enriquecer
    });

    instalar();
    if (!window.HAIKU_LIBRO_RESERVA_V1) {
        document.addEventListener("DOMContentLoaded", instalar, { once: true });
    }
})();
