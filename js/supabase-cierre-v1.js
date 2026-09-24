// ========================================
// HAIKU · CIERRE DE TURNO · SUPABASE V1
// Mantiene la UI actual, pero Supabase pasa a ser la fuente persistente.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const TIPO_TURNO = "cierre_diario";
    const originalCargarCierreDia = window.cargarCierreDia;
    let cargandoDesdeSupabase = false;
    let timerNovedades = null;

    const MAPA_GLOBAL = {
        salida_temprana: "salidaTemprana",
        salio_antes: "salioAntes",
        llaves_retiradas: "llavesRetiradas",
        registro_guardado: "registroGuardado",
        reserva_marcada: "reservaMarcada",
        pago_registrado: "pagoRegistrado",
        llaves_recepcion: "llavesRecepcion",
        manager_pagos: "managerPagos",
        manager_caja: "managerCaja",
        manager_vale_salida: "managerValeSalida",
        detalles_cabanas: "detallesCabanas",
        pendientes_hacer: "pendientesHacer",
        hay_novedades: "hayNovedades",
        tinaja_tonel_apagado: "tinajaTonelApagado",
        tinaja_jacuzzi_apagado: "tinajaJacuzziApagado",
        tinaja_tonel_funcionamiento: "tinajaTonelFuncionamiento",
        tinaja_jacuzzi_funcionamiento: "tinajaJacuzziFuncionamiento",
        tinaja_cojines_retirados: "tinajaCojinesRetirados"
    };

    const MAPA_CABANA = {
        cabana_ocupada: "ocupada",
        cabana_perillas: "perillas",
        cabana_gas: "gas",
        cabana_refri: "refri",
        cabana_calefactor: "calefactor",
        cabana_tv: "tv",
        cabana_ac: "ac",
        cabana_luces: "luces"
    };

    function fechaActual() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
        } catch {
            return "";
        }
    }

    function valorJson(valor) {
        return valor === undefined ? null : valor;
    }

    async function asegurarCierre(fecha) {
        const { data, error } = await cliente.rpc(
            "haiku_asegurar_cierre_dia",
            {
                p_fecha: fecha,
                p_tipo_turno: TIPO_TURNO
            }
        );

        if (error) throw error;
        return data;
    }

    async function guardarRespuesta({
        codigo,
        estado,
        valor,
        observacion = null,
        cabanaNumero = null
    }) {
        if (cargandoDesdeSupabase) return;

        const fecha = fechaActual();
        if (!fecha || !codigo) return;

        const { error } = await cliente.rpc(
            "haiku_guardar_respuesta_cierre",
            {
                p_fecha: fecha,
                p_codigo: codigo,
                p_estado: estado,
                p_valor: valorJson(valor),
                p_observacion: observacion,
                p_cabana_numero: cabanaNumero,
                p_tipo_turno: TIPO_TURNO
            }
        );

        if (error) {
            console.error("HAIKU · No se guardó respuesta de cierre:", codigo, error);
            alert(`No fue posible guardar “${codigo}” en Supabase.`);
            await cargarCierreSupabase(fecha, { forzarRender: true });
            throw error;
        }

        console.info("HAIKU · Cierre guardado en Supabase:", fecha, codigo, cabanaNumero || "global");
        window.dispatchEvent(new CustomEvent("haiku:cierre-respuesta-guardada", {
            detail: { fecha, codigo, cabanaNumero }
        }));
    }

    function limpiarObjetoLegacy(cierre) {
        if (!cierre) return;

        Object.values(MAPA_GLOBAL).forEach(campo => {
            if (campo === "llavesRecepcion") {
                cierre[campo] = {};
                return;
            }

            const esBooleano = [
                "registroGuardado",
                "reservaMarcada",
                "pagoRegistrado",
                "managerPagos",
                "managerCaja",
                "managerValeSalida",
                "tinajaTonelApagado",
                "tinajaJacuzziApagado",
                "tinajaTonelFuncionamiento",
                "tinajaJacuzziFuncionamiento",
                "tinajaCojinesRetirados"
            ].includes(campo);

            cierre[campo] = esBooleano ? false : "";
        });

        cierre.novedades = "";
        cierre.cabanasCierre = {};
    }

    function aplicarRespuestaLegacy(cierre, respuesta) {
        const codigo = respuesta?.cierre_checklist_items?.codigo;
        if (!codigo) return;

        const valor = respuesta.valor;

        if (MAPA_GLOBAL[codigo]) {
            cierre[MAPA_GLOBAL[codigo]] = valor ?? (
                respuesta.estado === "confirmado" ? true : false
            );
            return;
        }

        if (MAPA_CABANA[codigo]) {
            const numero = Number(respuesta?.cabanas?.numero || 0);
            if (!numero) return;

            if (!cierre.cabanasCierre[numero]) {
                cierre.cabanasCierre[numero] = {};
            }

            cierre.cabanasCierre[numero][MAPA_CABANA[codigo]] =
                valor === true || respuesta.estado === "confirmado";
        }
    }

    async function cargarCierreSupabase(fecha, opciones = {}) {
        fecha = String(fecha || "").slice(0, 10);
        if (!fecha || cargandoDesdeSupabase) return null;

        cargandoDesdeSupabase = true;

        try {
            const base = await asegurarCierre(fecha);
            const cierreId = base?.cierre_id;
            if (!cierreId) throw new Error("Supabase no devolvió cierre_id.");

            const [respuestasResp, cierreResp] = await Promise.all([
                cliente
                    .from("cierre_respuestas")
                    .select("estado,valor,observacion,cabana_id,cierre_checklist_items(codigo),cabanas(numero)")
                    .eq("cierre_id", cierreId),
                cliente
                    .from("cierres_turno")
                    .select("estado,novedades,resumen_entrega")
                    .eq("id", cierreId)
                    .single()
            ]);

            if (respuestasResp.error) throw respuestasResp.error;
            if (cierreResp.error) throw cierreResp.error;

            if (typeof obtenerCierreDia !== "function") return base;

            const cierreLegacy = obtenerCierreDia(fecha);
            limpiarObjetoLegacy(cierreLegacy);

            for (const respuesta of (respuestasResp.data || [])) {
                aplicarRespuestaLegacy(cierreLegacy, respuesta);
            }

            cierreLegacy.novedades = cierreResp.data?.novedades || "";
            cierreLegacy._supabaseCierreId = cierreId;
            cierreLegacy._supabaseEstado = cierreResp.data?.estado || "borrador";

            try {
                if (typeof guardarDatos === "function") guardarDatos();
            } catch {}

            if (opciones.forzarRender !== false && typeof originalCargarCierreDia === "function") {
                originalCargarCierreDia(fecha);
                if (typeof actualizarCierreTurno === "function") actualizarCierreTurno();
            }

            console.info(
                "HAIKU · Cierre cargado desde Supabase:",
                fecha,
                cierreResp.data?.estado,
                (respuestasResp.data || []).length,
                "respuestas"
            );

            return {
                ...base,
                cierre: cierreResp.data,
                respuestas: respuestasResp.data || []
            };
        } catch (error) {
            console.error("HAIKU · No fue posible cargar Cierre desde Supabase:", error);
            return null;
        } finally {
            cargandoDesdeSupabase = false;
        }
    }

    // -------------------------------------------------
    // GUARDADO DE CONTROLES GLOBALES
    // -------------------------------------------------

    const RADIO_CODIGOS = {
        "salida-temprana": "salida_temprana",
        "salio-antes": "salio_antes",
        "llaves-retiradas": "llaves_retiradas",
        "detalles-cabanas": "detalles_cabanas",
        "pendientes-hacer": "pendientes_hacer",
        "hay-novedades": "hay_novedades"
    };

    const CAMPO_CODIGOS = {
        "registro-guardado": "registro_guardado",
        "reserva-marcada": "reserva_marcada",
        "pago-registrado": "pago_registrado",
        "manager-pagos": "manager_pagos",
        "manager-caja": "manager_caja",
        "manager-vale-salida": "manager_vale_salida",
        "tinaja-tonel-apagado": "tinaja_tonel_apagado",
        "tinaja-jacuzzi-apagado": "tinaja_jacuzzi_apagado",
        "tinaja-tonel-funcionamiento": "tinaja_tonel_funcionamiento",
        "tinaja-jacuzzi-funcionamiento": "tinaja_jacuzzi_funcionamiento",
        "tinaja-cojines-retirados": "tinaja_cojines_retirados"
    };

    document.addEventListener("change", event => {
        if (cargandoDesdeSupabase) return;

        const el = event.target;
        if (!(el instanceof HTMLElement)) return;

        if (el.matches("input[type='radio'][name]")) {
            const codigo = RADIO_CODIGOS[el.getAttribute("name")];
            if (codigo && el.checked) {
                guardarRespuesta({
                    codigo,
                    estado: "confirmado",
                    valor: el.value
                }).catch(() => {});
            }
            return;
        }

        const campo = el.getAttribute("data-cierre-campo");
        if (campo && CAMPO_CODIGOS[campo] && el instanceof HTMLInputElement && el.type === "checkbox") {
            guardarRespuesta({
                codigo: CAMPO_CODIGOS[campo],
                estado: el.checked ? "confirmado" : "pendiente",
                valor: el.checked
            }).catch(() => {});
            return;
        }

        if (el.hasAttribute("data-cierre-llave")) {
            const llaves = {};
            document.querySelectorAll("[data-cierre-llave]").forEach(check => {
                llaves[check.dataset.cierreLlave] = check.checked === true;
            });

            guardarRespuesta({
                codigo: "llaves_recepcion",
                estado: "confirmado",
                valor: llaves
            }).catch(() => {});
            return;
        }

        if (el.hasAttribute("data-cierre-cabana-ocupada")) {
            const numero = Number(el.getAttribute("data-cierre-cabana-ocupada"));
            guardarRespuesta({
                codigo: "cabana_ocupada",
                estado: el.checked ? "confirmado" : "pendiente",
                valor: el.checked,
                cabanaNumero: numero
            }).catch(() => {});
            return;
        }

        if (el.hasAttribute("data-cierre-cabana") && el.hasAttribute("data-item")) {
            const numero = Number(el.getAttribute("data-cierre-cabana"));
            const item = String(el.getAttribute("data-item") || "");
            const codigo = `cabana_${item}`;

            if (MAPA_CABANA[codigo]) {
                guardarRespuesta({
                    codigo,
                    estado: el.checked ? "confirmado" : "pendiente",
                    valor: el.checked,
                    cabanaNumero: numero
                }).catch(() => {});
            }
        }
    }, true);

    // Novedades es texto libre del cierre, no un check.
    document.addEventListener("input", event => {
        const el = event.target;
        if (!(el instanceof HTMLElement)) return;
        if (el.getAttribute("data-cierre-campo") !== "novedades") return;

        clearTimeout(timerNovedades);
        timerNovedades = setTimeout(async () => {
            const fecha = fechaActual();
            if (!fecha || cargandoDesdeSupabase) return;

            const { error } = await cliente.rpc(
                "haiku_guardar_novedades_cierre",
                {
                    p_fecha: fecha,
                    p_novedades: el.value || "",
                    p_tipo_turno: TIPO_TURNO
                }
            );

            if (error) {
                console.error("HAIKU · No se guardaron novedades de cierre:", error);
                alert("No fue posible guardar las novedades del cierre en Supabase.");
            }
        }, 450);
    }, true);

    // -------------------------------------------------
    // CARGA DESDE SUPABASE
    // -------------------------------------------------

    if (typeof originalCargarCierreDia === "function") {
        window.cargarCierreDia = function cargarCierreDiaSupabase(fecha) {
            const resultado = originalCargarCierreDia.apply(this, arguments);
            setTimeout(() => cargarCierreSupabase(fecha, { forzarRender: true }), 0);
            return resultado;
        };
    }

    window.haikuCargarCierreSupabase = cargarCierreSupabase;

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(() => {
            const fecha = fechaActual();
            if (fecha) cargarCierreSupabase(fecha, { forzarRender: true });
        }, 180);
    });

    document.addEventListener("click", event => {
        const enlace = event.target?.closest?.('[data-seccion="cierre"], [data-seccion="cierre-turno"]');
        if (!enlace) return;

        setTimeout(() => {
            const fecha = fechaActual();
            if (fecha) cargarCierreSupabase(fecha, { forzarRender: true });
        }, 80);
    }, true);

    setTimeout(() => {
        if (!window.haikuSesion) return;
        const fecha = fechaActual();
        if (fecha) cargarCierreSupabase(fecha, { forzarRender: true });
    }, 500);

    console.info("HAIKU · Cierre Supabase V1 preparado.");
})();
