// ========================================
// HAKU · LIBRO · CANON DE PAGOS V1
// Capa conservadora previa a la conciliación Libro ↔ Proyecto H.
//
// Reglas:
// - BOVTAR sí identifica una transacción de tarjeta.
// - BOVE es un dato administrativo/tributario y NO demuestra un pago nuevo.
// - Conserva conjuntamente el canal WebPay y el tipo de tarjeta.
// - Reconstruye una transacción distribuida sólo cuando sus aplicaciones suman
//   exactamente el monto total declarado y comparten identificador fuerte.
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
        const coincidencia = texto.match(/\bmonto\b\s*:?[ \t]*\$?[ \t]*([\d.]+)/i);
        if (!coincidencia) return null;
        const numero = Number(coincidencia[1].replace(/\./g, ""));
        return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
    }

    function agruparTransaccionesDistribuidas(pagos) {
        if (!Array.isArray(pagos) || pagos.length < 2) return pagos || [];
        const porId = new Map();
        pagos.forEach((pago, indice) => {
            const clave = claveTransaccionFuerte(pago);
            if (!clave) return;
            if (!porId.has(clave)) porId.set(clave, []);
            porId.get(clave).push({ pago, indice });
        });
        const reemplazo = new Map(), omitidos = new Set();
        for (const grupo of porId.values()) {
            if (grupo.length < 2) continue;
            const declarados = [...new Set(grupo.map(x => montoTotalDeclarado(x.pago)).filter(Number.isSafeInteger))];
            if (declarados.length !== 1) continue;
            const total = declarados[0];
            const suma = grupo.reduce((n, x) => n + (Number.isSafeInteger(Number(x.pago.monto)) ? Number(x.pago.monto) : 0), 0);
            const compatibles = ['titular','cabana','fecha_bloque','fecha_comprobante','moneda'].every(campo =>
                new Set(grupo.map(x => normalizarTexto(x.pago[campo])).filter(Boolean)).size <= 1
            );
            if (!compatibles || suma !== total) continue;
            const aplicaciones = grupo.map(({ pago }) => ({
                monto: Number(pago.monto), concepto: pago.concepto || null,
                tipo_movimiento: pago.tipo_movimiento || null, cabana: pago.cabana || null,
                fecha_bloque: pago.fecha_bloque || null, origen: pago.origen || null
            }));
            const base = grupo[0].pago;
            const conceptos = [...new Set(aplicaciones.map(x => x.concepto).filter(Boolean))];
            reemplazo.set(grupo[0].indice, {
                ...base,
                monto: total,
                concepto: conceptos.length ? conceptos.join(' + ') : base.concepto,
                tipo_movimiento: aplicaciones.every(x => x.tipo_movimiento === 'alojamiento') ? 'alojamiento' : 'distribuido',
                texto_original: [...new Set(grupo.map(x => x.pago.texto_original).filter(Boolean))].join('\n'),
                origenes: grupo.map(x => x.pago.origen).filter(Boolean),
                aplicaciones_libro: aplicaciones,
                transaccion_distribuida: true
            });
            grupo.slice(1).forEach(x => omitidos.add(x.indice));
        }
        return pagos.flatMap((pago, indice) => omitidos.has(indice) ? [] : [reemplazo.get(indice) || pago]);
    }

    function corregirPago(pago) {
        if (!pago || typeof pago !== "object") return pago;

        const copia = { ...pago };
        const bovtar = canonId(pago.bovtar);
        const boveAdministrativo = pago.bove || null;

        // Proyecto H histórico guarda el identificador mostrado como BOVTAR en
        // `pagos.bove` para varios pagos de tarjeta. La conciliación antigua
        // compara ese campo, así que exponemos BOVTAR por ese canal únicamente
        // cuando el Libro realmente trae BOVTAR. Un BOVE administrativo sin
        // BOVTAR nunca convierte un movimiento en "nuevo seguro".
        copia.bove_administrativo = boveAdministrativo;
        copia.bove = bovtar ? pago.bovtar : null;
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
