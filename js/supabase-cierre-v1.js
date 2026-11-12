// HAIKU · Cierre de turno. Persistencia de las respuestas y de las novedades.
(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    const plantilla = window.HAIKU_CIERRE_PLANTILLA_V1;
    const seccion = document.getElementById("seccion-cierre");
    if (!cliente || !plantilla || !seccion) return;

    const TIPO_TURNO = "cierre_diario";
    const cargarLocal = window.cargarCierreDia;
    const cargas = new Map();
    const guardados = new Map();
    const notasPendientes = new Map();
    let revisionLocal = 0;

    const fechaActual = () => typeof fechaSeleccionada === "string" ? fechaSeleccionada.slice(0, 10) : "";

    function encolarGuardado(fecha, operacion) {
        const anterior = guardados.get(fecha) || Promise.resolve();
        const actual = anterior.catch(() => {}).then(operacion);
        guardados.set(fecha, actual);
        const liberar = () => {
            if (guardados.get(fecha) === actual) guardados.delete(fecha);
        };
        actual.then(liberar, liberar);
        return actual;
    }

    function guardarRespuesta(fecha, { codigo, estado, valor, cabanaNumero }) {
        return encolarGuardado(fecha, async () => {
            const { error } = await cliente.rpc("haiku_guardar_respuesta_cierre", {
                p_fecha: fecha,
                p_codigo: codigo,
                p_estado: estado,
                p_valor: valor,
                p_observacion: null,
                p_cabana_numero: cabanaNumero,
                p_tipo_turno: TIPO_TURNO
            });
            if (error) throw error;
            window.dispatchEvent(new CustomEvent("haiku:cierre-respuesta-guardada", {
                detail: { fecha, codigo, cabanaNumero }
            }));
        });
    }

    function guardarNovedades(fecha) {
        const pendiente = notasPendientes.get(fecha);
        if (!pendiente) return Promise.resolve();
        if (pendiente.guardado) return pendiente.guardado;
        clearTimeout(pendiente.timer);
        pendiente.guardado = encolarGuardado(fecha, async () => {
            const { error } = await cliente.rpc("haiku_guardar_novedades_cierre", {
                p_fecha: fecha, p_novedades: pendiente.valor, p_tipo_turno: TIPO_TURNO
            });
            if (error) throw error;
            if (notasPendientes.get(fecha) === pendiente) notasPendientes.delete(fecha);
        }).catch(error => {
            pendiente.guardado = null;
            console.error("HAIKU · No se guardaron las novedades del turno:", error);
            window.HAIKU_DIALOGOS.aviso("No fue posible guardar las novedades del turno.");
            throw error;
        });
        return pendiente.guardado;
    }

    function aplicarRespuestas(fecha, cierreId, cierreRemoto, respuestas) {
        const cierre = obtenerCierreDia(fecha);
        Object.values(plantilla.campos).forEach(item => delete cierre[item.campo]);
        cierre.llavesRecepcion = {};
        cierre.cabanasCierre = {};
        cierre._cierreExentos = [];
        for (const respuesta of respuestas) {
            const codigo = respuesta.cierre_checklist_items?.codigo;
            if (!codigo) continue;
            const numero = Number(respuesta.cabanas?.numero) || null;
            const item = plantilla.campos[codigo];
            if (respuesta.estado === "no_corresponde") {
                cierre._cierreExentos.push(claveRespuestaCierre(codigo, numero));
            }
            if (item) {
                cierre[item.campo] = respuesta.valor ?? (respuesta.estado === "confirmado");
            } else if (numero && codigo.startsWith("cabana_")) {
                const datos = cierre.cabanasCierre[numero] ||= {};
                datos[codigo.slice(7)] = respuesta.valor === true;
            }
        }
        if (!notasPendientes.has(fecha)) cierre.novedades = cierreRemoto.novedades || "";
        cierre._supabaseEstado = cierreRemoto.estado || "borrador";
        cierre._supabaseCierreId = cierreId;
        guardarDatos();
    }

    async function cargar(fecha, forzarRender) {
        await guardados.get(fecha)?.catch(() => {});
        const revision = revisionLocal;
        const { data: base, error } = await cliente.rpc("haiku_asegurar_cierre_dia", {
            p_fecha: fecha, p_tipo_turno: TIPO_TURNO
        });
        if (error) throw error;
        const cierreId = base?.cierre_id;
        if (!cierreId) throw new Error("No se encontró el cierre del día.");

        const [respuestas, cierre, unidades] = await Promise.all([
            cliente.from("cierre_respuestas")
                .select("estado,valor,observacion,cabana_id,cierre_checklist_items(codigo),cabanas(numero,nombre)")
                .eq("cierre_id", cierreId),
            cliente.from("cierres_turno").select("estado,novedades,resumen_entrega").eq("id", cierreId).single(),
            cliente.from("cabanas").select("numero,nombre").eq("activa", true).order("numero")
        ]);
        if (respuestas.error) throw respuestas.error;
        if (cierre.error) throw cierre.error;
        const filas = respuestas.data || [];
        if (revision !== revisionLocal) return null;
        aplicarRespuestas(fecha, cierreId, cierre.data, filas);

        if (forzarRender && fecha === fechaActual()) {
            const puedeVerUnidades = typeof window.haikuTienePermiso !== "function" || window.haikuTienePermiso("cabanas.ver");
            if (!unidades.error && puedeVerUnidades) {
                const visibles = new Map((unidades.data || []).map(unidad => [unidad.numero, unidad]));
                // Los cierres previos también muestran las respuestas de cabañas desactivadas después.
                if (["cerrado", "cerrado_con_pendientes"].includes(cierre.data.estado)) {
                    filas.forEach(({ cabanas }) => {
                        if (cabanas?.numero && !visibles.has(cabanas.numero)) visibles.set(cabanas.numero, cabanas);
                    });
                }
                window.HAIKU_SITES_CIERRE_V1?.cargarUnidades([...visibles.values()].sort((a, b) => a.numero - b.numero));
            }
            cargarLocal(fecha);
        }
        return { ...base, cierre: cierre.data, respuestas: filas };
    }

    function cargarCierreSupabase(fecha, opciones = {}) {
        fecha = String(fecha || "").slice(0, 10);
        if (!fecha) return Promise.resolve(null);
        if (fecha === fechaActual()) window.HAIKU_SITES_CIERRE_V1?.mostrarFecha(fecha);
        if (cargas.has(fecha)) return cargas.get(fecha);
        const carga = cargar(fecha, opciones.forzarRender !== false).catch(error => {
            console.error("HAIKU · No fue posible cargar Cierre desde Supabase:", error);
            return null;
        }).finally(() => cargas.delete(fecha));
        cargas.set(fecha, carga);
        return carga;
    }

    seccion.addEventListener("change", event => {
        const fecha = fechaActual();
        const respuesta = respuestaDeControlCierre(event.target);
        if (!fecha || !respuesta) return;
        revisionLocal++;
        guardarRespuesta(fecha, respuesta).catch(async error => {
            console.error("HAIKU · No se guardó un control del cierre:", respuesta.codigo, error);
            const fila = event.target.closest("[data-turno-control]");
            const texto = plantilla.campos[respuesta.codigo]?.texto || fila?.textContent.trim() || "el control de cierre";
            window.HAIKU_DIALOGOS.aviso(`No fue posible guardar «${texto}».`);
            await cargas.get(fecha);
            await cargarCierreSupabase(fecha);
        });
    });

    seccion.addEventListener("input", event => {
        const input = event.target;
        const fecha = fechaActual();
        if (!fecha || input.disabled || !input.matches('textarea[data-cierre-campo="novedades"]')) return;
        revisionLocal++;
        clearTimeout(notasPendientes.get(fecha)?.timer);
        const pendiente = { valor: input.value };
        notasPendientes.set(fecha, pendiente);
        pendiente.timer = setTimeout(() => guardarNovedades(fecha).catch(() => {}), 450);
    });

    window.cargarCierreDia = function cargarCierreDiaSupabase(fecha) {
        cargarLocal(fecha);
        if (seccion.classList.contains("activa")) cargarCierreSupabase(fecha);
    };
    window.haikuCargarCierreSupabase = cargarCierreSupabase;
    window.haikuEsperarGuardadosCierre = async fecha => {
        await guardarNovedades(fecha);
        await guardados.get(fecha);
    };
})();
