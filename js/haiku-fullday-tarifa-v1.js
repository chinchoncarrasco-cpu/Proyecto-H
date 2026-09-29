/* HAIKU · Regla preventiva de tarifa Full Day. Sin acceso a datos ni escrituras. */
(function (root) {
    "use strict";

    if (root.HAIKU_FULLDAY_TARIFA_V1) return;

    const TARIFA_PERSONA_CLP = 60000;
    const MINIMO_PERSONAS = 2;
    const MENSAJE_NINOS = "No hay una regla automática definida para la tarifa Full Day con niños. Ingresa la tarifa manualmente.";
    const MENSAJE_SIN_REGLA = "Ingresa una tarifa manual para este Full Day.";

    const enteroPositivo = valor => {
        const numero = Number(valor);
        return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
    };

    function resolver({ adultos = 0, ninos = 0, tarifaManual = null } = {}) {
        const explicita = enteroPositivo(tarifaManual);
        if (explicita !== null) {
            return Object.freeze({
                tarifa: explicita,
                fuente: "manual",
                automatica: false,
                bloqueada: false,
                mensaje: "Tarifa Full Day ingresada manualmente."
            });
        }

        const cantidadNinos = Math.max(0, Number(ninos) || 0);
        if (cantidadNinos > 0) {
            return Object.freeze({
                tarifa: null,
                fuente: null,
                automatica: false,
                bloqueada: true,
                mensaje: MENSAJE_NINOS
            });
        }

        const cantidadAdultos = Math.max(0, Number(adultos) || 0);
        if (cantidadAdultos < 1) {
            return Object.freeze({
                tarifa: null,
                fuente: null,
                automatica: false,
                bloqueada: true,
                mensaje: MENSAJE_SIN_REGLA
            });
        }

        const personasTarifadas = Math.max(cantidadAdultos, MINIMO_PERSONAS);
        const tarifa = TARIFA_PERSONA_CLP * personasTarifadas;
        return Object.freeze({
            tarifa,
            fuente: "regla_adultos",
            automatica: true,
            bloqueada: false,
            personasTarifadas,
            mensaje: `${personasTarifadas} personas × $${TARIFA_PERSONA_CLP.toLocaleString("es-CL")} = $${tarifa.toLocaleString("es-CL")}`
        });
    }

    const api = Object.freeze({
        TARIFA_PERSONA_CLP,
        MINIMO_PERSONAS,
        MENSAJE_NINOS,
        MENSAJE_SIN_REGLA,
        enteroPositivo,
        resolver
    });

    root.HAIKU_FULLDAY_TARIFA_V1 = api;
    if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
