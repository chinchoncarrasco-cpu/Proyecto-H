// Publicación del Resumen del día. Las fuentes registradas preparan datos sin
// tocar su vista; sólo una generación completa puede publicarse.
(() => {
    "use strict";
    if (window.HAIKU_RESUMEN_REFRESH_V1) return;

    const fuentes = new Map();
    const obligatorias = ["reservas", "servicios", "pagos", "checkout",
        "checkoutAutoridad", "operacion", "autoridadVisual", "tablero"];
    const fuentesMedidas = [...obligatorias, "notas", "aseo", "revision"];
    let generacion = 0;
    let ultimo = null;
    let publicando = false;
    let publicaciones = 0;
    let inicioListo = false;
    let enCurso = false;
    let solicitudEnCurso = null;
    let inicioProgramado = false;
    let ultimoPerfil = null;
    const historialGeneraciones = [];
    const solicitudesCoalescidas = [];

    function origenDeSolicitud(origen) {
        const stack = String(new Error().stack || "").split("\n").slice(2, 12)
            .map(linea => linea.trim());
        const caller = stack.find(linea => !linea.includes("supabase-resumen-refresh-v1.js")) || "";
        const archivo = caller.match(/(?:js\/|js\\)[^/:)]+\.js/)?.[0] || "desconocido";
        const funcion = caller.match(/^at\s+([^\s(]+)/)?.[1] || "anónima";
        const categoria = origen?.categoria || (stack.some(linea =>
            linea.includes("calendario.js") && linea.includes("seleccionarDia"))
            ? "navegación usuario" : archivo.includes("supabase-pagos") ? "pagos"
                : archivo.includes("supabase-resumen-tablero") ? "tablero"
                    : archivo.includes("supabase-servicios") ? "servicios"
                        : archivo.includes("supabase-checkout") ? "checkout"
                            : archivo.includes("supabase-aseo") ? "aseo"
                                : archivo.includes("supabase-notas") ? "notas"
                                    : archivo.includes("supabase-revision") ? "revisión"
                                        : archivo.includes("supabase-data") ? "operación"
                                            : archivo.includes("supabase-resumen-refresh")
                                                ? "primera carga / auth" : "otro");
        const evento = origen?.evento || "sin evento declarado";
        const tipo = origen?.tipo || (categoria === "navegación usuario"
            ? "usuario" : "externo");
        return { origen: `${categoria} · ${evento}`, categoria, evento, tipo,
            archivo, funcion, caller, stack: stack.join("\n"),
            timestamp: new Date().toISOString() };
    }

    function registrarSolicitud(id, fecha, origen, resultado, motivo) {
        const registro = { generacion: id, fecha, fechaPublicada: ultimo?.fecha || "ninguna",
            fechaSeleccionada: fechaActiva(), ...origen, resultado, motivo };
        historialGeneraciones.push(registro);
        if (historialGeneraciones.length > 100) historialGeneraciones.shift();
        return registro;
    }

    function reloj() {
        return typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now() : Date.now();
    }

    function registrarTiempo(perfil, nombre, fase, inicio, tiempoInicio, estado) {
        const fin = new Date();
        perfil.fuentes[nombre] ||= {};
        perfil.fuentes[nombre][fase] = {
            inicio: inicio.toISOString(), fin: fin.toISOString(),
            duracionMs: Math.round((reloj() - tiempoInicio) * 10) / 10,
            estado
        };
    }

    function fechaActiva() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function usuarioActual() {
        return String(window.haikuSesion?.auth?.id ||
            window.haikuSesion?.usuario?.id || "");
    }

    function vigente(id, fecha, usuario) {
        return id === generacion && fecha === fechaActiva() &&
            usuario && usuario === usuarioActual();
    }

    function estadoCarga(mensaje = "") {
        const estado = document.getElementById("resumen-refresh-estado");
        if (estado) estado.textContent = mensaje;
    }

    function estadoError() {
        estadoCarga(ultimo
            ? "No fue posible actualizar el Resumen. Se conserva la vista anterior."
            : "No fue posible cargar el Resumen. Reintenta la actualización.");
    }

    function programarInicio() {
        if (inicioProgramado) return;
        inicioProgramado = true;
        queueMicrotask(() => {
            inicioProgramado = false;
            if (!ultimo && !enCurso) solicitar(undefined, {
                categoria: "primera carga", evento: "fuentes completas / inicio"
            });
        });
    }

    function registrar(nombre, fuente) {
        if (!nombre || fuentes.has(nombre) ||
            typeof fuente?.preparar !== "function" ||
            typeof fuente?.publicar !== "function") return false;
        fuentes.set(nombre, fuente);
        if (inicioListo && window.haikuSesion && !ultimo &&
            obligatorias.every(requerida => fuentes.has(requerida))) {
            programarInicio();
        }
        return true;
    }

    function publicarResumen(snapshot) {
        publicando = true;
        try {
            const expansiones = new Map([...document.querySelectorAll(
                "#seccion-resumen .sites-resumen-cabana[data-cabana]")].map(fila => [
                String(fila.dataset.cabana), {
                    reservaId: String(fila.dataset.resumenReservaId || ""),
                    expandida: fila.querySelector("[data-resumen-expandir]")
                        ?.getAttribute("aria-expanded") === "true"
                }
            ]));
            for (const [, fuente] of [...fuentes].sort((a, b) =>
                (a[1].orden || 0) - (b[1].orden || 0))) {
                const resultado = fuente.publicar(snapshot);
                if (resultado && typeof resultado.then === "function") {
                    throw new Error("Una fuente intentó publicar el Resumen de forma asíncrona.");
                }
            }
            document.querySelectorAll("#seccion-resumen .sites-resumen-cabana[data-cabana]")
                .forEach(fila => {
                    const anterior = expansiones.get(String(fila.dataset.cabana));
                    if (!anterior?.expandida) return;
                    const boton = fila.querySelector("[data-resumen-expandir]");
                    const detalle = boton && document.getElementById(boton.getAttribute("aria-controls"));
                    if (anterior.reservaId === String(fila.dataset.resumenReservaId || "")) {
                        if (detalle) detalle.hidden = false;
                        if (boton) {
                            boton.setAttribute("aria-expanded", "true");
                            boton.textContent = "Ocultar detalle ↑";
                        }
                        return;
                    }
                    if (detalle) detalle.hidden = true;
                    if (boton) {
                        boton.setAttribute("aria-expanded", "false");
                        boton.textContent = "Ver detalle ↓";
                    }
                });
            ultimo = snapshot;
            publicaciones++;
            const [anio, mes, dia] = snapshot.fecha.split("-").map(Number);
            const fechaTexto = new Intl.DateTimeFormat("es-CL", {
                weekday: "long", day: "numeric", month: "long", year: "numeric"
            }).format(new Date(anio, mes - 1, dia));
            const fechaTitulo = document.getElementById("fecha-actual");
            if (fechaTitulo) fechaTitulo.textContent =
                fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1);
            document.querySelectorAll(".dia-calendario.seleccionado")
                .forEach(diaActual => diaActual.classList.remove("seleccionado"));
            document.querySelector(`.dia-calendario[data-fecha="${snapshot.fecha}"]`)
                ?.classList.add("seleccionado");
            document.documentElement.classList.remove("haiku-resumen-pendiente");
            estadoCarga("");
        } finally {
            publicando = false;
        }
    }

    async function solicitar(fechaSolicitada = fechaActiva(), origenDeclarado) {
        const fecha = String(fechaSolicitada || "").slice(0, 10);
        const usuario = usuarioActual();
        const origen = origenDeSolicitud(origenDeclarado);
        const motivoRechazo = !inicioListo ? "coordinador aún no iniciado" :
            !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? "fecha inválida" :
            !usuario ? "sesión sin usuario" :
            fecha !== fechaActiva() ? `fecha seleccionada distinta: ${fechaActiva()}` :
            !obligatorias.every(requerida => fuentes.has(requerida))
                ? `faltan fuentes: ${obligatorias.filter(requerida => !fuentes.has(requerida)).join(", ")}`
                : "";
        if (motivoRechazo) {
            registrarSolicitud(null, fecha, origen, "RECHAZADA", motivoRechazo);
            window.HAIKU_RESUMEN_NAV_CARGA_V1?.finalizar(fecha);
            return false;
        }
        if (origen.tipo === "interno_derivado" && enCurso &&
            solicitudEnCurso?.usuario === usuario &&
            solicitudEnCurso?.fecha === fecha) {
            const coalescida = {
                generacion: solicitudEnCurso.id, fecha,
                fechaPublicada: ultimo?.fecha || "ninguna", ...origen,
                resultado: "COALESCIDA", motivo: "misma generación activa"
            };
            solicitudesCoalescidas.push(coalescida);
            if (solicitudesCoalescidas.length > 100) solicitudesCoalescidas.shift();
            return true;
        }
        const id = ++generacion;
        const registro = registrarSolicitud(id, fecha, origen,
            "ACEPTADA", "preparando snapshot");
        window.HAIKU_RESUMEN_NAV_CARGA_V1?.aceptar(fecha, id);
        const t0 = reloj();
        const perfil = { fecha, generacion: id, t0: new Date().toISOString(),
            fuentes: Object.fromEntries(fuentesMedidas.map(nombre =>
                [nombre, { estadoFinal: "no registrada" }])),
            tSnapshot: null, tPublish: null, tVisible: null, snapshotMs: null,
            publicacionMs: null, visibleMs: null, resultado: "en curso" };
        enCurso = true;
        solicitudEnCurso = { id, fecha, usuario };
        if (ultimo && ultimo.fecha !== fecha) {
            const [anio, mes, dia] = fecha.split("-").map(Number);
            const destino = new Intl.DateTimeFormat("es-CL", {
                day: "numeric", month: "long", year: "numeric"
            }).format(new Date(anio, mes - 1, dia));
            estadoCarga(`Cargando Resumen del ${destino}…`);
        }
        try {
        const entradas = [...fuentes];
        const preparaciones = new Map(entradas.map(([nombre, fuente]) => [nombre,
            Promise.resolve().then(async () => {
                const inicio = new Date();
                const tiempoInicio = reloj();
                try {
                    const valor = await fuente.preparar({ fecha, usuario, generacion: id });
                    registrarTiempo(perfil, nombre, "preparar", inicio, tiempoInicio,
                        valor == null ? "sin datos" : "éxito");
                    return valor;
                } catch (error) {
                    registrarTiempo(perfil, nombre, "preparar", inicio, tiempoInicio, "error");
                    throw error;
                }
            })
        ]));
        const tareas = new Map();
        function tarea(nombre) {
            if (tareas.has(nombre)) return tareas.get(nombre);
            const fuente = fuentes.get(nombre);
            const promesa = Promise.resolve().then(async () => {
                const dependencias = fuente.dependencias || [];
                const [base, ...resueltas] = await Promise.all([
                    preparaciones.get(nombre), ...dependencias.map(dependencia => {
                        if (!fuentes.has(dependencia)) {
                            throw new Error(`Falta la dependencia ${dependencia} de ${nombre}`);
                        }
                        return tarea(dependencia);
                    })
                ]);
                if (typeof fuente.completar !== "function") return base;
                const datosDependientes = Object.create(null);
                dependencias.forEach((dependencia, indice) => {
                    datosDependientes[dependencia] = resueltas[indice];
                });
                const inicio = new Date();
                const tiempoInicio = reloj();
                try {
                    const complemento = await fuente.completar(
                        { fecha, usuario, generacion: id, datos: datosDependientes }, base);
                    registrarTiempo(perfil, nombre, "completar", inicio, tiempoInicio,
                        complemento == null ? "sin datos" : "éxito");
                    if (complemento == null) throw new Error(`Sin datos de ${nombre}`);
                    return complemento;
                } catch (error) {
                    if (!perfil.fuentes[nombre]?.completar) {
                        registrarTiempo(perfil, nombre, "completar", inicio, tiempoInicio, "error");
                    }
                    throw error;
                }
            });
            tareas.set(nombre, promesa);
            return promesa;
        }
        const lecturas = await Promise.allSettled(entradas.map(([nombre]) => tarea(nombre)));
        if (!vigente(id, fecha, usuario)) {
            registro.resultado = "DESCARTADA";
            registro.motivo = id !== generacion
                ? `generación sustituida: ${id} → ${generacion}`
                : fecha !== fechaActiva() ? `fecha seleccionada distinta: ${fechaActiva()}`
                    : "usuario de sesión cambió";
            return false;
        }

        const datos = Object.assign(Object.create(null), {
            notas: null, aseo: null, revision: null
        });
        const faltantes = [];
        lecturas.forEach((lectura, indice) => {
            const [nombre, fuente] = entradas[indice];
            perfil.fuentes[nombre] ||= {};
            perfil.fuentes[nombre].estadoFinal = lectura.status === "rejected"
                ? "error" : lectura.value == null ? "sin datos" : "éxito";
            if (lectura.status === "fulfilled" && lectura.value != null) {
                datos[nombre] = lectura.value;
            } else if (fuente.obligatoria !== false) {
                faltantes.push(nombre);
            } else if (ultimo?.fecha === fecha && ultimo.usuario === usuario &&
                Object.hasOwn(ultimo.datos, nombre)) {
                datos[nombre] = ultimo.datos[nombre];
            } else {
                datos[nombre] = null;
            }
        });
        if (faltantes.length) {
            registro.resultado = "NO PUBLICADA";
            registro.motivo = `faltan: ${faltantes.join(", ")}`;
            perfil.resultado = `faltan: ${faltantes.join(", ")}`;
            ultimoPerfil = perfil;
            console.error("HAIKU · Resumen incompleto; se conserva la última vista válida:", faltantes);
            estadoError();
            return false;
        }
        perfil.tSnapshot = new Date().toISOString();
        registro.t3 = perfil.tSnapshot;
        perfil.snapshotMs = Math.round((reloj() - t0) * 10) / 10;
        const snapshot = { fecha, usuario, generacion: id, datos };
        try {
            perfil.tPublish = new Date().toISOString();
            registro.t4 = perfil.tPublish;
            const inicioPublicacion = reloj();
            publicarResumen(snapshot);
            perfil.publicacionMs = Math.round((reloj() - inicioPublicacion) * 10) / 10;
            perfil.tVisible = new Date().toISOString();
            registro.t5 = perfil.tVisible;
            registro.fechaPublicadaFinal = ultimo?.fecha || "ninguna";
            perfil.visibleMs = Math.round((reloj() - t0) * 10) / 10;
            perfil.resultado = "publicado";
            registro.resultado = "PUBLICADA";
            registro.motivo = "T3/T4/T5 completos";
            ultimoPerfil = perfil;
            return true;
        } catch (error) {
            registro.resultado = "ERROR";
            registro.motivo = `publicación: ${error.message}`;
            perfil.resultado = "error de publicación";
            ultimoPerfil = perfil;
            console.error("HAIKU · No fue posible publicar el Resumen:", error);
            estadoError();
            return false;
        }
        } finally {
            if (id === generacion) {
                enCurso = false;
                solicitudEnCurso = null;
            }
            window.HAIKU_RESUMEN_NAV_CARGA_V1?.finalizar(fecha, id);
        }
    }

    function iniciar() {
        inicioListo = true;
        if (window.haikuSesion) programarInicio();
    }

    window.HAIKU_RESUMEN_REFRESH_V1 = Object.freeze({
        registrar, solicitar,
        activo: () => inicioListo,
        enCurso: () => enCurso,
        publicando: () => publicando,
        ultimo: () => ultimo,
        diagnostico: () => ultimoPerfil,
        historialGeneraciones: () => historialGeneraciones.map(item => ({ ...item })),
        solicitudesCoalescidas: () => solicitudesCoalescidas.map(item => ({ ...item })),
        publicaciones: () => publicaciones,
        invalidar: () => {
            generacion++; enCurso = false; solicitudEnCurso = null; ultimo = null;
        }
    });
    window.addEventListener("haiku:auth-ready", () => queueMicrotask(() => {
        if (ultimo && ultimo.usuario !== usuarioActual()) {
            generacion++;
            enCurso = false;
            solicitudEnCurso = null;
            ultimo = null;
            document.documentElement.classList.add("haiku-resumen-pendiente");
            estadoCarga("Cargando Resumen…");
        }
        if (inicioListo) {
            if (ultimo) solicitar(undefined, {
                categoria: "auth", evento: "haiku:auth-ready"
            });
            else programarInicio();
        }
    }));
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
