// Reposición de Aseo: sólo Supabase es autoridad; sin caché legacy ni canal propio.
(() => {
    "use strict";
    if (window.HAIKU_INSUMOS_ASEO_V1) return;

    const INSUMOS = ["lena", "carbon"];
    const dias = new Map();
    const lecturas = new Map();
    const pendientes = new Map();
    const altas = new Map(); // Identidades de intentos pendientes, nunca cantidades canónicas.
    const verificaciones = new Map();
    const ANTIGUEDAD_ALTA_MS = 7 * 24 * 60 * 60 * 1000;
    let errorAltas = "";
    const referencias = new Map();
    let referenciasActuales = null;
    let usuario = "";
    let generacionSesion = 0;
    let authInstalado = false;
    const cliente = () => window.haikuSupabase;
    const usuarioActual = () => window.haikuSesion?.usuario?.id || window.haikuSesion?.auth?.id || "";
    const fechaActual = () => typeof fechaSeleccionada !== "undefined" ? String(fechaSeleccionada).slice(0, 10) : "";
    const clave = (fecha, numero, insumo) => `${fecha}:${numero}:${insumo}`;
    const prefijoAltas = () => `haikuSacosPendientesV2:${encodeURIComponent(usuarioActual())}:`;
    const claveAlta = alta => `haikuSacosPendientesV2:${[alta.usuario, alta.fecha, alta.cabanaId,
        alta.aseoId || "sin-aseo", "lena", alta.id].map(encodeURIComponent).join(":")}`;
    const altaAntigua = alta => Date.now() - Date.parse(alta.creadoEn) >= ANTIGUEDAD_ALTA_MS;
    function guardarAlta(alta) {
        // Una clave por intento evita sobrescribir pendientes de otra fecha/pestaña.
        const valor = JSON.stringify({ id: alta.id, usuario: alta.usuario, fecha: alta.fecha, numero: alta.numero,
            cabanaId: alta.cabanaId, aseoId: alta.aseoId, movimientoId: alta.movimientoId,
            insumo: "lena", pesoKg: alta.pesoKg, creadoEn: alta.creadoEn });
        try {
            window.localStorage.setItem(claveAlta(alta), valor);
            if (window.localStorage.getItem(claveAlta(alta)) !== valor) throw new Error("Persistencia no confirmada");
        } catch (_) {
            throw new Error("No se pudo conservar el intento en este navegador. Habilita el almacenamiento local antes de registrar el saco.");
        }
    }
    function quitarAlta(alta) {
        try {
            window.localStorage.removeItem(claveAlta(alta));
            if (window.localStorage.getItem(claveAlta(alta)) !== null) throw new Error("Limpieza no confirmada");
        } catch (_) {
            alta.estado = "incierto";
            throw new Error("El saco está confirmado, pero no se pudo limpiar el intento local. Vuelve a verificar antes de agregar otro.");
        }
        const id = clave(alta.fecha, alta.numero, "lena");
        if (altas.get(id)?.id === alta.id) altas.delete(id);
    }
    function altaValida(alta) {
        return alta && alta.usuario === usuarioActual() && typeof alta.id === "string" && alta.id &&
            typeof alta.cabanaId === "string" && alta.cabanaId && /^[1-9]\d*$/.test(alta.numero) &&
            /^\d{4}-\d{2}-\d{2}$/.test(alta.fecha) && alta.insumo === "lena" &&
            Number.isFinite(Number(alta.pesoKg)) && Number(alta.pesoKg) > 0 && Number.isFinite(Date.parse(alta.creadoEn));
    }
    function restaurarAltas() {
        try {
            // Conservar también un intento de la versión anterior que siga en esta pestaña.
            const claveAnterior = `haikuSacosPendientesV1:${usuarioActual()}`;
            const anterior = window.sessionStorage?.getItem(claveAnterior);
            if (anterior) {
                for (const guardada of JSON.parse(anterior)) {
                    const alta = { ...guardada, insumo: "lena", creadoEn: guardada.creadoEn || "1970-01-01T00:00:00.000Z" };
                    if (!altaValida(alta)) throw new Error("Intento anterior inválido");
                    guardarAlta(alta);
                }
                window.sessionStorage.removeItem(claveAnterior);
            }
            const guardadas = [], almacenamiento = window.localStorage;
            for (let i = 0; i < almacenamiento.length; i++) {
                const llave = almacenamiento.key(i);
                if (!llave?.startsWith(prefijoAltas())) continue;
                const alta = JSON.parse(almacenamiento.getItem(llave));
                if (!altaValida(alta) || llave !== claveAlta(alta)) throw new Error("Contexto de intento inválido");
                guardadas.push(alta);
            }
            guardadas.sort((a, b) => Date.parse(a.creadoEn) - Date.parse(b.creadoEn) || a.id.localeCompare(b.id));
            for (const alta of guardadas) {
                const id = clave(alta.fecha, alta.numero, "lena");
                if (!altas.has(id)) altas.set(id, { ...alta, estado: "incierto" });
            }
            errorAltas = "";
            return true;
        } catch (_) {
            errorAltas = "No se pudieron recuperar los intentos pendientes. Revisa el almacenamiento local antes de registrar otro saco.";
            return false;
        }
    }
    const dia = fecha => {
        if (!dias.has(fecha)) dias.set(fecha, { filas: [], listo: false, obsoleto: false, error: "", version: 0 });
        return dias.get(fecha);
    };
    function avisar(fecha) {
        document.dispatchEvent(new CustomEvent("haiku:insumos-actualizados", { detail: { fecha } }));
    }
    function comprobar(error) { if (error) throw error; }
    async function cargarReferencias() {
        if (referencias.size) return;
        if (referenciasActuales) return referenciasActuales;
        const sesion = generacionSesion;
        referenciasActuales = (async () => {
            const { data, error } = await cliente().from("cabanas").select("id,numero");
            comprobar(error);
            if (sesion !== generacionSesion) return;
            for (const fila of data || []) referencias.set(String(fila.numero), String(fila.id));
        })().finally(() => { if (sesion === generacionSesion) referenciasActuales = null; });
        return referenciasActuales;
    }
    function filaActual(fecha, numero, insumo) {
        const cabanaId = referencias.get(String(numero));
        return dia(fecha).filas.find(fila => String(fila.cabana_id) === cabanaId && fila.insumo === insumo);
    }
    function obtener(fecha, numero) {
        const datos = dia(fecha);
        const cantidades = {};
        for (const insumo of INSUMOS) {
            const pendiente = pendientes.get(clave(fecha, numero, insumo));
            const fila = filaActual(fecha, numero, insumo);
            const confirmada = Number((insumo === "lena" ? fila?.cantidad_actual : fila?.cantidad) || 0);
            cantidades[insumo] = { cantidad: pendiente?.cantidad ?? confirmada, confirmada,
                guardando: Boolean(pendiente), error: datos[clave(fecha, numero, insumo)] || "" };
            if (insumo === "lena") {
                cantidades.lena.pesoKg = Number(fila?.peso_total_kg || 0);
                cantidades.lena.sacos = (fila?.sacos || []).map(saco => ({ ...saco }));
                const alta = altas.get(clave(fecha, numero, "lena"));
                cantidades.lena.alta = alta ? { estado: alta.estado, pesoKg: alta.pesoKg } : null;
                cantidades.lena.guardando ||= verificaciones.has(clave(fecha, numero, "lena"));
                cantidades.lena.error ||= errorAltas;
            }
        }
        return { listo: datos.listo, error: datos.error, ...cantidades };
    }
    function total(fecha) {
        const datos = dia(fecha);
        const resultado = { listo: datos.listo, error: datos.error, lena: 0, lenaKg: 0, carbon: 0 };
        // Sumar únicamente filas confirmadas por Supabase, incluso mientras la ficha es optimista.
        for (const fila of datos.filas) {
            if (fila.origen === "aseo" && fila.fecha_operativa === fecha && INSUMOS.includes(fila.insumo)) {
                resultado[fila.insumo] += Number(fila.insumo === "lena" ? fila.cantidad_actual : fila.cantidad);
                if (fila.insumo === "lena") resultado.lenaKg += Number(fila.peso_total_kg);
            }
        }
        return resultado;
    }
    function fechaMovimiento(id) {
        for (const [fecha, datos] of dias) if (datos.filas.some(fila => fila.id === id)) return fecha;
    }
    function invalidar(fecha) {
        // Sin fecha (p. ej. DELETE con sólo PK), invalidar las fotografías conocidas.
        for (const [claveFecha, datos] of dias) {
            if (fecha && claveFecha !== fecha) continue;
            datos.obsoleto = true;
            datos.version++;
            const lectura = lecturas.get(claveFecha);
            if (lectura) lectura.repetir = true;
        }
    }
    function hidratar(fecha = fechaActual(), { forzar = true } = {}) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !cliente() || !usuarioActual()) return Promise.resolve();
        if (lecturas.has(fecha)) {
            if (forzar) lecturas.get(fecha).repetir = true;
            return lecturas.get(fecha).promesa;
        }
        const datos = dia(fecha);
        restaurarAltas();
        if (!forzar && !datos.obsoleto && (datos.listo || datos.error) && !altas.size) return Promise.resolve();
        const sesion = generacionSesion;
        const lectura = { repetir: false };
        lecturas.set(fecha, lectura);
        lectura.promesa = (async () => {
            await Promise.allSettled([...pendientes.values()].filter(p => p.fecha === fecha).map(p => p.promesa));
            await cargarReferencias();
            if (sesion !== generacionSesion) return;
            await reconciliarAltas();
            if (sesion !== generacionSesion) return;
            do {
                lectura.repetir = false;
                await Promise.allSettled([...pendientes.values()].filter(p => p.fecha === fecha).map(p => p.promesa));
                const version = datos.version;
                await cargarReferencias();
                const { data, error } = await cliente().from("movimientos_insumos_resumen")
                    .select("id,fecha_operativa,cabana_id,aseo_id,insumo,cantidad,cantidad_actual,peso_total_kg,sacos,unidad,origen,actualizado_en")
                    .eq("fecha_operativa", fecha).eq("origen", "aseo");
                comprobar(error);
                if (sesion !== generacionSesion) return;
                if (datos.version !== version) { lectura.repetir = true; continue; }
                datos.filas = (data || []).filter(f => f.fecha_operativa === fecha && f.origen === "aseo");
                datos.listo = true;
                datos.obsoleto = false;
                datos.error = "";
                avisar(fecha);
            } while (lectura.repetir);
        })().catch(error => {
            if (sesion !== generacionSesion) return;
            datos.listo = false;
            datos.error = "No fue posible cargar la reposición. Reintenta para verificar los valores.";
            avisar(fecha);
            console.error("HAIKU · No fue posible leer insumos:", error);
        }).finally(() => {
            if (lecturas.get(fecha) !== lectura) return;
            lecturas.delete(fecha);
            // Un evento puede llegar después de salir del bucle pero antes de
            // esta microtarea. No perder esa invalidación de otro dispositivo.
            if (lectura.repetir && sesion === generacionSesion) return hidratar(fecha);
        });
        return lectura.promesa;
    }
    function cambiar(fecha, numero, insumo, delta) {
        if (insumo !== "carbon" || ![-1, 1].includes(delta)) return Promise.reject(new Error("Leña requiere registrar cada saco con su peso."));
        const anterior = Number(filaActual(fecha, numero, insumo)?.cantidad || 0);
        if (anterior + delta < 0) return Promise.resolve();
        return escribir(fecha, numero, insumo, "haiku_reponer_insumo_aseo_v1", {
            p_fecha: fecha, p_cabana_id: referencias.get(String(numero)), p_insumo: insumo,
            p_delta: delta, p_cantidad_esperada: anterior
        }, anterior + delta);
    }
    function agregarSaco(fecha, numero, pesoKg, unidadId) {
        const id = clave(fecha, numero, "lena");
        if (pendientes.has(id)) return pendientes.get(id).promesa;
        if (verificaciones.has(id)) return verificaciones.get(id).promesa;
        if (!Number.isFinite(Number(pesoKg)) || Number(pesoKg) <= 0) return Promise.reject(new Error("Ingresa un peso mayor que cero."));
        if (!restaurarAltas()) { avisar(fecha); return Promise.reject(new Error(errorAltas)); }
        let alta = altas.get(id);
        if (alta && (Number(alta.pesoKg) !== Number(pesoKg) || (unidadId && alta.id !== unidadId))) {
            return Promise.reject(new Error("Primero verifica el saco pendiente antes de registrar otro."));
        }
        if (!alta) {
            if (!cliente() || !usuarioActual() || !dia(fecha).listo || !referencias.has(String(numero))) {
                return Promise.reject(new Error("Espera a que se verifique la reposición antes de editar."));
            }
            const fila = filaActual(fecha, numero, "lena");
            alta = { id: unidadId || window.crypto.randomUUID(), fecha, numero: String(numero), pesoKg,
                cabanaId: referencias.get(String(numero)), movimientoId: fila?.id || null,
                aseoId: fila?.aseo_id || null, usuario: usuarioActual(), estado: "nuevo", insumo: "lena", creadoEn: new Date().toISOString() };
            try { guardarAlta(alta); }
            catch (error) { dia(fecha)[id] = error.message; avisar(fecha); return Promise.reject(error); }
            altas.set(id, alta);
        }
        return escribir(fecha, numero, "lena", null, null, undefined, () => resolverAlta(alta));
    }
    async function buscarAlta(alta) {
        // Consultar por UUID, incluyendo anulados: la lista activa no demuestra ausencia.
        const { data: saco, error } = await cliente().from("movimientos_insumos_unidades")
            .select("id,movimiento_id,peso_kg,version,anulado_en").eq("id", alta.id).maybeSingle();
        comprobar(error);
        if (!saco) { await validarContextoAlta(alta); return null; }
        const { data: movimiento, error: errorMovimiento } = await cliente().from("movimientos_insumos")
            .select("id,fecha_operativa,cabana_id,aseo_id,insumo,origen").eq("id", saco.movimiento_id).maybeSingle();
        comprobar(errorMovimiento);
        validarFila(alta.fecha, alta.numero, "lena", movimiento);
        if (movimiento.cabana_id !== alta.cabanaId || (alta.movimientoId && alta.movimientoId !== movimiento.id) ||
            (alta.aseoId && alta.aseoId !== movimiento.aseo_id)) throw new Error("Movimiento incompatible con el intento pendiente.");
        let pesoInicial = saco.peso_kg;
        if (saco.version > 1) {
            const { data: cambio, error: errorHistorial } = await cliente().from("movimientos_insumos_unidades_historial")
                .select("peso_anterior").eq("saco_id", alta.id).eq("version_anterior", 1).maybeSingle();
            comprobar(errorHistorial);
            if (cambio) pesoInicial = cambio.peso_anterior;
        }
        if (Number(pesoInicial) !== Number(alta.pesoKg)) throw new Error("Peso incompatible con el intento pendiente.");
        const { data: resumen, error: errorResumen } = await cliente().from("movimientos_insumos_resumen")
            .select("*").eq("id", movimiento.id).maybeSingle();
        comprobar(errorResumen);
        validarFila(alta.fecha, alta.numero, "lena", resumen);
        return resumen;
    }
    async function validarContextoAlta(alta) {
        if (alta.usuario !== usuarioActual() || referencias.get(String(alta.numero)) !== alta.cabanaId) {
            throw new Error("Contexto incompatible con el intento pendiente.");
        }
        if (!alta.movimientoId) return;
        const { data: movimiento, error } = await cliente().from("movimientos_insumos")
            .select("id,fecha_operativa,cabana_id,aseo_id,insumo,origen").eq("id", alta.movimientoId).maybeSingle();
        comprobar(error);
        validarFila(alta.fecha, alta.numero, "lena", movimiento);
        if (alta.aseoId && movimiento.aseo_id !== alta.aseoId) throw new Error("Aseo incompatible con el intento pendiente.");
    }
    async function resolverAlta(alta, soloVerificar = false) {
        const sesion = generacionSesion;
        const verificar = soloVerificar || alta.estado === "incierto";
        const confirmar = fila => {
            if (sesion !== generacionSesion) return;
            validarFila(alta.fecha, alta.numero, "lena", fila);
            quitarAlta(alta);
            return fila;
        };
        if (!verificar) {
            try {
                await validarContextoAlta(alta);
                if (sesion !== generacionSesion) return;
                const { data, error } = await cliente().rpc("haiku_agregar_saco_lena_v1", {
                    p_fecha: alta.fecha, p_cabana_id: alta.cabanaId, p_unidad_id: alta.id, p_peso_kg: alta.pesoKg
                });
                comprobar(error);
                return confirmar(Array.isArray(data) ? data[0] : data);
            } catch (_) {
                if (sesion !== generacionSesion) return;
            }
        }
        alta.estado = "verificando";
        avisar(alta.fecha);
        let fila;
        try { fila = await buscarAlta(alta); }
        catch (error) {
            if (sesion !== generacionSesion) return;
            alta.estado = "incierto";
            if (/incompatible|verificar el movimiento/.test(error.message)) {
                throw new Error("Conflicto con el registro del saco pendiente. Revisa su contexto y peso antes de volver a verificar.");
            }
            throw new Error("No se pudo verificar el registro. Vuelve a verificar este saco.");
        }
        if (sesion !== generacionSesion) return;
        if (fila) return confirmar(fila);
        alta.estado = "reintentar";
        throw new Error(altaAntigua(alta)
            ? "Intento antiguo verificado: no se encontró el saco. Reintenta este mismo saco; su UUID se conserva."
            : "No se confirmó el registro. Reintenta este mismo saco.");
    }
    function verificarPersistida(alta) {
        const id = clave(alta.fecha, alta.numero, "lena");
        if (verificaciones.has(id)) return verificaciones.get(id).promesa;
        const sesion = generacionSesion, datos = dia(alta.fecha), verificacion = {};
        verificaciones.set(id, verificacion);
        datos.version++;
        verificacion.promesa = Promise.resolve().then(() => {
            if (sesion === generacionSesion) return resolverAlta(alta, true);
        }).then(fila => {
            if (sesion !== generacionSesion || !fila) return;
            datos.filas = datos.filas.filter(f => f.id !== fila.id && !(f.cabana_id === fila.cabana_id && f.insumo === "lena"));
            datos.filas.push(fila);
            datos[id] = "";
            return fila;
        }).catch(error => {
            if (sesion === generacionSesion) datos[id] = error.message;
            throw error;
        }).finally(() => {
            if (verificaciones.get(id) !== verificacion) return;
            verificaciones.delete(id);
            datos.version++;
            avisar(alta.fecha);
        });
        return verificacion.promesa;
    }
    async function reconciliarAltas() {
        // También revisar fechas antiguas del usuario, sin RPC ni expiración ciega.
        const sesion = generacionSesion, revisadas = new Set();
        while (sesion === generacionSesion && restaurarAltas()) {
            const candidatas = [...altas.values()].filter(alta => !revisadas.has(alta.id) &&
                !pendientes.has(clave(alta.fecha, alta.numero, "lena")));
            if (!candidatas.length) break;
            await Promise.allSettled(candidatas.map(alta => { revisadas.add(alta.id); return verificarPersistida(alta); }));
        }
    }
    function editarSaco(fecha, numero, unidadId, pesoKg, versionEsperada) {
        if (!Number.isFinite(Number(pesoKg)) || Number(pesoKg) <= 0 || !Number.isInteger(versionEsperada) || versionEsperada < 1) {
            return Promise.reject(new Error("Ingresa un peso mayor que cero y una versión válida."));
        }
        if (!filaActual(fecha, numero, "lena")?.sacos?.some(saco => saco.id === unidadId)) {
            return Promise.reject(new Error("No se pudo verificar el saco de esta cabaña."));
        }
        return escribir(fecha, numero, "lena", "haiku_editar_peso_saco_lena_v1", {
            p_unidad_id: unidadId, p_peso_kg: pesoKg, p_version_esperada: versionEsperada
        });
    }
    function anularSaco(fecha, numero, unidadId) {
        if (!filaActual(fecha, numero, "lena")?.sacos?.some(saco => saco.id === unidadId)) {
            return Promise.reject(new Error("No se pudo verificar el saco de esta cabaña."));
        }
        return escribir(fecha, numero, "lena", "haiku_anular_saco_lena_v1", { p_unidad_id: unidadId });
    }
    function validarFila(fecha, numero, insumo, fila) {
        if (!fila?.id || fila.fecha_operativa !== fecha || fila.insumo !== insumo ||
            String(fila.cabana_id) !== referencias.get(String(numero)) || fila.origen !== "aseo") {
            throw new Error("No fue posible verificar el movimiento guardado.");
        }
    }
    function escribir(fecha, numero, insumo, rpc, parametros, cantidad, ejecutar) {
        const id = clave(fecha, numero, insumo);
        if (pendientes.has(id)) return pendientes.get(id).promesa;
        if (verificaciones.has(id)) return Promise.reject(new Error("Espera a que termine la verificación del saco pendiente."));
        const datos = dia(fecha);
        if (!cliente() || !usuarioActual() || (!datos.listo && !ejecutar) || !referencias.has(String(numero)) ||
            !INSUMOS.includes(insumo)) {
            return Promise.reject(new Error("Espera a que se verifique la reposición antes de editar."));
        }
        const sesion = generacionSesion;
        const pendiente = { fecha, cantidad, promesa: null };
        pendientes.set(id, pendiente);
        datos[id] = "";
        datos.version++;
        pendiente.promesa = Promise.resolve().then(async () => {
            if (sesion !== generacionSesion) return;
            let data;
            if (ejecutar) data = await ejecutar();
            else {
                const respuesta = await cliente().rpc(rpc, parametros);
                comprobar(respuesta.error);
                data = respuesta.data;
            }
            if (sesion !== generacionSesion) return;
            const fila = Array.isArray(data) ? data[0] : data;
            validarFila(fecha, numero, insumo, fila);
            datos.filas = datos.filas.filter(f => f.id !== fila.id &&
                !(f.cabana_id === fila.cabana_id && f.insumo === fila.insumo));
            datos.filas.push(fila);
            return fila;
        }).catch(error => {
            if (sesion === generacionSesion) datos[id] = ejecutar ? error.message : error.code === "40001"
                ? "El registro cambió en otro dispositivo. Revisa el valor actualizado antes de guardar."
                : "No se confirmó el cambio. Revisa el valor e intenta nuevamente.";
            throw error;
        }).finally(() => {
            if (pendientes.get(id) !== pendiente) return;
            pendientes.delete(id);
            datos.version++;
            avisar(fecha); // Al quitar la superposición optimista reaparece el último valor confirmado.
            // También resuelve respuestas perdidas o conflictos con otro dispositivo, sin repetir escrituras.
            hidratar(fecha);
        });
        avisar(fecha);
        return pendiente.promesa;
    }
    function limpiar() {
        generacionSesion++;
        dias.clear(); lecturas.clear(); pendientes.clear(); referencias.clear(); altas.clear(); verificaciones.clear();
        errorAltas = "";
        referenciasActuales = null;
        avisar(fechaActual());
    }
    function iniciar() {
        if (!cliente()) return;
        if (!authInstalado && cliente().auth?.onAuthStateChange) {
            authInstalado = true;
            cliente().auth.onAuthStateChange(evento => {
                if (evento === "SIGNED_OUT") { usuario = ""; limpiar(); }
            });
        }
        if (!usuarioActual()) return;
        if (usuario !== usuarioActual()) { usuario = usuarioActual(); limpiar(); restaurarAltas(); }
        hidratar(fechaActual(), { forzar: false });
    }
    window.HAIKU_INSUMOS_ASEO_V1 = Object.freeze({ obtener, total, cambiar, agregarSaco, editarSaco, anularSaco, hidratar, invalidar, fechaMovimiento });
    document.addEventListener("haiku:supabase-ready", iniciar);
    window.addEventListener("haiku:auth-ready", iniciar);
    document.addEventListener("haiku:resumen-datos-actualizados", evento => {
        if (evento.detail?.fecha === fechaActual()) hidratar(fechaActual(), { forzar: false });
    });
    document.querySelector?.('.menu-item[data-seccion="cabanas"]')?.addEventListener("click", () => {
        hidratar(fechaActual(), { forzar: false });
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    else iniciar();
})();
