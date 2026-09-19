// ========================================
// HAKU · LIBRO · CANON DE PAGOS V1
// Capa conservadora previa a la conciliación Libro ↔ Proyecto H.
//
// Reglas:
// - BOVTAR sí identifica una transacción de tarjeta.
// - BOVE es un dato administrativo/tributario y NO demuestra un pago nuevo.
// - Conserva conjuntamente el canal WebPay y el tipo de tarjeta.
// - Reconstruye una transacción distribuida cuando sus aplicaciones comparten
//   identidad fuerte y contexto inequívoco. Si hay total declarado, exige suma exacta.
// - No inventa identidad para efectivo/transferencia sin referencia transaccional.
//
// Esta capa no escribe en Supabase ni modifica el XLSX. Sólo normaliza la
// copia semántica devuelta por Libro de Reserva antes de que Haku compare.
// ========================================
(function (root) {
    "use strict";

    let instalado = false;

    function asegurarUiPagos() {
        if (!root.document) return;
        if (!document.getElementById("haiku-libro-pagos-ui-v1-script")) {
            const script = document.createElement("script");
            script.id = "haiku-libro-pagos-ui-v1-script";
            script.src = "js/haiku-libro-pagos-ui-v1.js?v=2";
            script.defer = true;
            document.head.appendChild(script);
        }
        if (!document.getElementById("haiku-libro-pagos-seleccion-v1-script")) {
            const seleccion = document.createElement("script");
            seleccion.id = "haiku-libro-pagos-seleccion-v1-script";
            seleccion.src = "js/haiku-libro-pagos-seleccion-v1.js?v=1";
            seleccion.defer = true;
            document.head.appendChild(seleccion);
        }
        if (!document.getElementById("haiku-libro-pagos-duplicados-v1-script")) {
            const duplicados = document.createElement("script");
            duplicados.id = "haiku-libro-pagos-duplicados-v1-script";
            duplicados.src = "js/haiku-libro-pagos-duplicados-v1.js?v=1";
            duplicados.defer = true;
            document.head.appendChild(duplicados);
        }
    }

    function normalizarTexto(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function canonId(valor) {
        return String(valor || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    }

    function medioDesdeTexto(pago) {
        const t = normalizarTexto(`${pago?.texto_original || ""} ${pago?.concepto || ""}`);
        const webpay = /\bweb\s*pay\b|\bwebpay\b/.test(t);
        if (webpay && /\bdebito\b/.test(t)) return "webpay_debito";
        if (webpay && /\bcredito\b/.test(t)) return "webpay_credito";
        if (/\bdebito\b/.test(t)) return "debito";
        if (/\bcredito\b/.test(t)) return "credito";
        if (/\btransf(?:erencia)?\b/.test(t)) return "transferencia";
        if (/\befectivo\b/.test(t)) return "efectivo";
        if (webpay) return "webpay";
        return pago?.medio_pago || null;
    }

    function claveTransaccionFuerte(pago) {
        const codAut = canonId(pago?.codigo_autorizacion);
        if (codAut) return `codaut:${codAut}`;
        const folio = canonId(pago?.folio), bovtar = canonId(pago?.bovtar);
        return folio && bovtar ? `voucher:${folio}:${bovtar}` : null;
    }

    function montoTotalDeclarado(pago) {
        const texto = String(pago?.texto_original || "");
        const coincidencia = texto.match(/\b(?:monto|total)\b\s*:?[ \t]*(?:clp)?[ \t]*\$?[ \t]*([\d.,]+)/i);
        if (!coincidencia) return null;
        const numero = Number(coincidencia[1].replace(/[.,]/g, ""));
        return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
    }

    function notaFinanciera(pago) {
        const texto = normalizarTexto(`${pago?.texto_original || ""} ${pago?.concepto || ""}`);
        return pago?.clasificacion_financiera === "nota_financiera" || pago?.tipo_movimiento === "penalidad" ||
            /\b(?:reembolso|reembolsar|devolucion|nota de credito)\b|\b(?:por|x) pagar\b|\bsaldo (?:restante|pendiente)\b|\bpor gestionar\b/.test(texto);
    }

    function pagoVigenteLibro(pago) {
        const estado = normalizarTexto(pago?.estado || pago?.estado_pago);
        return !/\b(?:anulado|cancelado|invalido)\b/.test(estado);
    }

    function conflicto(grupo, motivo, reemplazo) {
        for (const { pago, indice } of grupo) reemplazo.set(indice, { ...pago, conflicto_distribucion: motivo });
    }

    function agruparTransaccionesDistribuidas(pagos) {
        if (!Array.isArray(pagos) || pagos.length < 2) return pagos || [];
        const porId = new Map();
        pagos.forEach((pago, indice) => {
            if (!pagoVigenteLibro(pago) || notaFinanciera(pago)) return;
            const clave = claveTransaccionFuerte(pago);
            if (!clave) return;
            if (!porId.has(clave)) porId.set(clave, []);
            porId.get(clave).push({ pago, indice });
        });
        const reemplazo = new Map(), omitidos = new Set();
        for (const grupo of porId.values()) {
            if (grupo.length < 2) continue;
            const declarados = [...new Set(grupo.map(x => montoTotalDeclarado(x.pago)).filter(Number.isSafeInteger))];
            const suma = grupo.reduce((n, x) => n + (Number.isSafeInteger(Number(x.pago.monto)) ? Number(x.pago.monto) : 0), 0);
            const mismos = campo => {
                const valores = grupo.map(x => normalizarTexto(x.pago[campo])).filter(Boolean);
                return valores.length === grupo.length && new Set(valores).size === 1;
            };
            const conceptos = grupo.map(x => normalizarTexto(x.pago.concepto));
            const origenes = grupo.map(x => `${x.pago.origen?.hoja || ""}!${x.pago.origen?.celda || ""}`);
            const estados = grupo.map(x => normalizarTexto(x.pago.estado_pago));
            const estadoCompartido = estados.length === grupo.length && new Set(estados).size === 1 &&
                (estados[0] === 'registrado_en_libro' || estados[0] === 'por_confirmar');
            const recepcionCompatible = estados[0] === 'registrado_en_libro'
                ? grupo.every(x => x.pago.pago_recibido === true)
                : grupo.every(x => x.pago.pago_recibido !== true);
            const compatibles = ['titular','cabana','fecha_bloque','fecha_comprobante','moneda','medio_pago'].every(mismos) &&
                grupo.every(x => Number.isSafeInteger(Number(x.pago.monto)) && Number(x.pago.monto) > 0 &&
                    x.pago.origen?.hoja && x.pago.origen?.celda && normalizarTexto(x.pago.concepto)) &&
                estadoCompartido && recepcionCompatible &&
                new Set(grupo.map(x => x.pago.origen.hoja)).size === 1 && new Set(origenes).size === grupo.length &&
                new Set(conceptos).size === grupo.length;
            if (!compatibles) { conflicto(grupo, 'Identificador compartido con contexto o aplicaciones incompatibles.', reemplazo); continue; }
            if (declarados.length > 1 || declarados.length === 1 && declarados[0] !== suma) {
                conflicto(grupo, 'La suma de aplicaciones no coincide con el total explícito del comprobante.', reemplazo); continue;
            }
            const total = declarados[0] || suma;
            const aplicaciones = grupo.map(({ pago }) => ({
                monto: Number(pago.monto), concepto: pago.concepto || null,
                tipo_movimiento: pago.tipo_movimiento || null, cabana: pago.cabana || null,
                fecha_bloque: pago.fecha_bloque || null, fecha_comprobante:pago.fecha_comprobante || null,
                origen: pago.origen || null, metadata_servicio: pago.servicio || pago.metadata_servicio || null
            }));
            const base = grupo[0].pago;
            const conceptosVisibles = [...new Set(aplicaciones.map(x => x.concepto).filter(Boolean))];
            const clave = claveTransaccionFuerte(base);
            reemplazo.set(grupo[0].indice, {
                ...base,
                monto: total,
                monto_total: total,
                total_declarado: declarados[0] || null,
                total_inferido: declarados.length === 0,
                concepto: conceptosVisibles.length ? conceptosVisibles.join(' + ') : base.concepto,
                tipo_movimiento: 'distribuido',
                texto_original: [...new Set(grupo.map(x => x.pago.texto_original).filter(Boolean))].join('\n'),
                origenes: grupo.map(x => x.pago.origen).filter(Boolean),
                aplicaciones_libro: aplicaciones,
                transaccion_distribuida: true,
                identificador_transaccion: clave,
                evidencia_agrupacion: { identificador_fuerte:clave, misma_reserva_contextual:true, fecha_compatible:true,
                    moneda_compatible:true, medio_compatible:true, origenes_distintos:true,
                    confirmacion_pago:estados[0] === 'registrado_en_libro' ? 'confirmado_en_libro' : 'requiere_pago_existente_en_proyecto_h',
                    total: declarados.length ? 'explicito_verificado' : 'suma_inferida_por_identidad_fuerte' }
            });
            grupo.slice(1).forEach(x => omitidos.add(x.indice));
        }
        return pagos.flatMap((pago, indice) => omitidos.has(indice) ? [] : [reemplazo.get(indice) || pago]);
    }

    function corregirPago(pago) {
        if (!pago || typeof pago !== "object") return pago;

        const copia = { ...pago };
        const bovtar = canonId(pago.bovtar);

        // El Libro usa tres identificadores con significados distintos:
        // BOVE es la boleta SII, BOVTAR es la autorización del voucher físico
        // y CodAut es la autorización de WebPay. Nunca copiamos uno sobre otro.
        copia.bove = pago.bove || null;
        copia.bove_administrativo = pago.bove || null;
        copia.medio_pago = medioDesdeTexto(pago);
        copia.identificador_pago = bovtar ? "bovtar" : (canonId(pago.codigo_autorizacion) ? "codigo_autorizacion" : null);

        return copia;
    }

    function corregirResultado(resultado) {
        if (!resultado || typeof resultado !== "object") return resultado;

        const copia = typeof structuredClone === "function"
            ? structuredClone(resultado)
            : JSON.parse(JSON.stringify(resultado));

        if (Array.isArray(copia.pagos)) {
            copia.pagos = agruparTransaccionesDistribuidas(copia.pagos.map(corregirPago));
        }

        if (Array.isArray(copia.reservas)) {
            copia.reservas = copia.reservas.map(reserva => ({
                ...reserva,
                pagos: Array.isArray(reserva?.pagos) ? agruparTransaccionesDistribuidas(reserva.pagos.map(corregirPago)) : [],
                pagos_sin_asociacion: Array.isArray(reserva?.pagos_sin_asociacion)
                    ? agruparTransaccionesDistribuidas(reserva.pagos_sin_asociacion.map(corregirPago))
                    : []
            }));
        }

        return copia;
    }

    function instalar() {
        if (instalado) return true;
        const api = root.HAIKU_LIBRO_RESERVA_V1;
        if (!api) return false;
        if (api.__haikuPagosCanonV1) {
            instalado = true;
            asegurarUiPagos();
            return true;
        }

        const consultarOriginal = api.consultarHoja?.bind(api);
        if (typeof consultarOriginal !== "function") return false;

        const envuelto = {
            ...api,
            __haikuPagosCanonV1: true,
            version: `${api.version || "1"}+pagos-canon-v1`,
            consultarHoja: async (...args) => corregirResultado(await consultarOriginal(...args))
        };

        root.HAIKU_LIBRO_RESERVA_V1 = Object.freeze(envuelto);
        root.HAIKU_LIBRO_PAGOS_CANON_V1 = Object.freeze({
            corregirPago,
            corregirResultado,
            medioDesdeTexto,
            agruparTransaccionesDistribuidas,
            montoTotalDeclarado
        });
        instalado = true;
        asegurarUiPagos();
        console.info("HAKU · Canon de pagos del Libro V1 preparado.");
        return true;
    }

    // `supabase-libro-reserva-v1.js` puede crear su API recién en
    // DOMContentLoaded. Este módulo se carga inmediatamente después; por eso no
    // debe rendirse si la API todavía no existe. Se instala en cuanto el Libro
    // termina de inicializarse y deja un retry corto como defensa adicional.
    if (!instalar()) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", instalar, { once: true });
        }
        let intentos = 0;
        const timer = setInterval(() => {
            intentos += 1;
            if (instalar() || intentos >= 40) clearInterval(timer);
        }, 50);
    }
})(typeof window !== "undefined" ? window : globalThis);
