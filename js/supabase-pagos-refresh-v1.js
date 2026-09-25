// Pagos: preparar la vista completa fuera del DOM visible y publicarla en un turno.
(() => {
    "use strict";
    if (window.HAIKU_PAGOS_REFRESH_V1) return;

    const nombres = ["abonos", "checkin", "checkout", "webpay", "grupo", "credito"];
    let generationId = 0;
    let enCurso = null;
    let ultimo = null;
    let publicando = false;
    let entrando = false;
    let publicaciones = 0;
    let coalescidas = 0;
    let ultimoPerfil = null;
    let errorInicial = false;
    let canal = null;
    let canalUsuario = "";
    let timerRealtime = 0;
    let escrituraReciente = 0;

    const reloj = () => performance?.now?.() ?? Date.now();
    const fechaActual = () => {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    };
    const usuarioActual = () => String(window.haikuSesion?.auth?.id ||
        window.haikuSesion?.usuario?.id || "");
    const seccion = () => document.getElementById("seccion-pagos");
    const activa = () => entrando || Boolean(seccion()?.classList.contains("activa"));
    const contexto = () => ({ usuario: usuarioActual(), fecha: fechaActual() });
    const vigente = solicitud => solicitud.id === generationId &&
        solicitud.usuario === usuarioActual() && solicitud.fecha === fechaActual();
    const apiFuentes = () => ({
        abonos: window.HAIKU_ABONOS_VERIFICACION_V2,
        checkin: window.HAIKU_PAGO_CHECKIN_RESUMEN_V1,
        checkout: window.HAIKU_PAGO_CHECKOUT_RESUMEN_V1,
        webpay: window.HAIKU_WEBPAY_PAGOS_V1,
        grupo: window.HAIKU_PAGO_CHECKIN_GRUPO_RESUMEN_V1,
        credito: window.HAIKU_SALDO_FAVOR_V2
    });
    function estado(mensaje) {
        const nodo = document.getElementById("pagos-refresh-estado");
        if (nodo) nodo.textContent = mensaje;
    }
    function shell() {
        document.documentElement.classList.toggle("haiku-pagos-pendiente", !ultimo);
    }
    function medir(perfil, nombre, promesa) {
        const inicio = reloj();
        return Promise.resolve().then(promesa).then(valor => {
            perfil.fuentes[nombre] = { estado: "listo", duracionMs: reloj() - inicio };
            return valor;
        }, error => {
            perfil.fuentes[nombre] = { estado: "error", duracionMs: reloj() - inicio,
                motivo: error?.message || String(error) };
            throw error;
        });
    }
    async function prepararPagos(solicitud, perfil) {
        const fuentes = apiFuentes();
        if (nombres.some(nombre => typeof fuentes[nombre]?.preparar !== "function") ||
            typeof fuentes.grupo.publicar !== "function" ||
            typeof fuentes.credito.publicar !== "function" ||
            typeof window.HAIKU_SITES_PAGOS_V1?.publicar !== "function") {
            throw new Error("Los lectores de Pagos aún no están disponibles.");
        }
        const operacion = await medir(perfil, "operacion", async () => {
            const { data, error } = await window.haikuSupabase.rpc(
                "haiku_operacion_dia", { p_fecha: solicitud.fecha });
            if (error) throw error;
            return data || [];
        });
        const contextoLectura = { fecha: solicitud.fecha, operacion };
        const [abonos, checkin, checkout, webpay, grupo] = await Promise.all([
            medir(perfil, "abonos", () => fuentes.abonos.preparar(contextoLectura)),
            medir(perfil, "checkin", () => fuentes.checkin.preparar(contextoLectura)),
            medir(perfil, "checkout", () => fuentes.checkout.preparar(contextoLectura)),
            medir(perfil, "webpay", () => fuentes.webpay.preparar(contextoLectura)),
            medir(perfil, "grupo", () => fuentes.grupo.preparar(contextoLectura))
        ]);
        if (!abonos || !checkin || !checkout || !webpay || !grupo) {
            throw new Error("Una fuente obligatoria de Pagos no devolvió datos.");
        }
        // Las tarjetas de grupo y crédito se completan sobre listas desconectadas.
        fuentes.grupo.publicar(grupo, checkin.lista, checkin.contador);
        const credito = await medir(perfil, "credito", () =>
            fuentes.credito.preparar(checkin.lista, checkout.lista))
            .catch(() => new Map());
        fuentes.credito.publicar(credito, checkin.lista, checkout.lista);
        return {
            contexto: { usuario: solicitud.usuario, fecha: solicitud.fecha,
                generationId: solicitud.id, origen: solicitud.origen },
            operacion,
            abonos, checkin, checkout, webpay,
            webpayScope: "global", grupo, credito
        };
    }
    function publicarPagos(snapshot) {
        const anteriores = new Map();
        const cuentas = new Map();
        const contadoresSites = new Map([...document.querySelectorAll(
            "#seccion-pagos [data-sites-pagos-count]")].map(nodo => [nodo, nodo.textContent]));
        const fechaSites = document.getElementById("sites-pagos-fecha");
        const fechaAnterior = fechaSites?.textContent;
        publicando = true;
        try {
            for (const nombre of ["abonos", "checkin", "checkout", "webpay"]) {
                const lista = document.getElementById(`pagos-lista-${nombre}`);
                const contador = document.getElementById(`pagos-contador-${nombre}`);
                if (!lista || !contador) throw new Error(`Falta el bloque ${nombre} de Pagos.`);
                anteriores.set(nombre, [...lista.childNodes]);
                cuentas.set(nombre, contador.textContent);
                lista.replaceChildren(...snapshot[nombre].lista.childNodes);
                contador.textContent = snapshot[nombre].contador.textContent;
            }
            window.HAIKU_SITES_PAGOS_V1.publicar(snapshot.operacion);
            ultimo = snapshot;
            errorInicial = false;
            publicaciones++;
            shell();
            estado("");
        } catch (error) {
            for (const [nombre, nodos] of anteriores) {
                document.getElementById(`pagos-lista-${nombre}`)?.replaceChildren(...nodos);
                const contador = document.getElementById(`pagos-contador-${nombre}`);
                if (contador) contador.textContent = cuentas.get(nombre);
            }
            for (const [nodo, texto] of contadoresSites) nodo.textContent = texto;
            if (fechaSites) fechaSites.textContent = fechaAnterior;
            throw error;
        } finally {
            publicando = false;
        }
    }
    async function solicitar(origen = { tipo: "interno_derivado", nombre: "lector" }, fecha = fechaActual()) {
        if (!activa() || !window.haikuSesion || !fecha) return { estado: "inactivo" };
        const usuario = usuarioActual();
        if (!usuario) return { estado: "sin-sesion" };
        if (ultimo && ultimo.contexto.usuario !== usuario) {
            ultimo = null;
            errorInicial = false;
            shell();
        }
        const tipo = origen.tipo || "interno_derivado";
        if (tipo === "interno_derivado" && enCurso?.usuario === usuario &&
            enCurso.fecha === fecha) {
            coalescidas++;
            return enCurso.promesa;
        }
        if (tipo === "interno_derivado" && ultimo?.contexto.usuario === usuario &&
            ultimo.contexto.fecha === fecha && !enCurso) {
            coalescidas++;
            return { estado: "coalescida", generationId };
        }
        const id = ++generationId;
        const solicitud = { id, usuario, fecha, origen, promesa: null };
        const perfil = { generationId: id, origen, usuario, fecha, t0: reloj(),
            fuentes: {}, publicacionesAntes: publicaciones, coalescidasAntes: coalescidas };
        ultimoPerfil = perfil;
        estado(ultimo ? "Haku · Actualizando Pagos…" : "Cargando Pagos…");
        shell();
        const promesa = (async () => {
            try {
                const snapshot = await prepararPagos(solicitud, perfil);
                perfil.tSnapshotMs = reloj() - perfil.t0;
                if (!vigente(solicitud)) return { estado: "descartada", generationId: id };
                publicarPagos(snapshot);
                perfil.tPublishMs = reloj() - perfil.t0;
                requestAnimationFrame(() => { perfil.tVisibleMs = reloj() - perfil.t0; });
                return { estado: "publicada", generationId: id };
            } catch (error) {
                perfil.error = error?.message || String(error);
                if (vigente(solicitud)) {
                    if (!ultimo) errorInicial = true;
                    estado(ultimo ? "No fue posible actualizar Pagos. Se conserva la vista anterior." :
                        "No fue posible cargar Pagos. Reintenta la actualización.");
                    shell();
                }
                return { estado: "error", generationId: id, error };
            } finally {
                if (enCurso?.id === id) enCurso = null;
                perfil.totalMs = reloj() - perfil.t0;
                perfil.publicaciones = publicaciones - perfil.publicacionesAntes;
                perfil.coalescidas = coalescidas - perfil.coalescidasAntes;
            }
        })();
        solicitud.promesa = promesa;
        enCurso = solicitud;
        return promesa;
    }
    function interceptar(nombre) {
        if (!activa()) return false;
        if (entrando) {
            coalescidas++;
            return true;
        }
        if (errorInicial && !ultimo) return true;
        if (!publicando && !enCurso &&
            (!ultimo || ultimo.contexto.usuario !== usuarioActual() ||
                ultimo.contexto.fecha !== fechaActual())) {
            solicitar({ tipo: "interno_derivado", nombre });
        } else if (enCurso?.usuario === usuarioActual() && enCurso.fecha === fechaActual()) {
            coalescidas++;
        } else if (ultimo?.contexto.usuario === usuarioActual() &&
            ultimo.contexto.fecha === fechaActual()) {
            coalescidas++;
        }
        return true;
    }
    function escrituraConfirmada(nombre) {
        escrituraReciente = Date.now();
        return solicitar({ tipo: "externo", nombre: nombre || "escritura confirmada" });
    }
    function instalarRealtime() {
        if (!window.haikuSesion || !window.haikuSupabase) return;
        if (canal && canalUsuario === usuarioActual()) return;
        if (canal) window.haikuSupabase.removeChannel?.(canal);
        canalUsuario = usuarioActual();
        canal = window.haikuSupabase.channel("haiku-pagos-vista-atomica-v1");
        for (const tabla of ["pagos", "pago_aplicaciones", "cargos", "reservas", "reserva_estadias"]) {
            canal.on("postgres_changes", { event: "*", schema: "public", table: tabla }, () => {
                if (!activa()) return;
                clearTimeout(timerRealtime);
                timerRealtime = setTimeout(() => {
                    if (Date.now() - escrituraReciente < 500) return;
                    solicitar({ tipo: "externo", nombre: `realtime ${tabla}` });
                }, 120);
            });
        }
        canal.subscribe();
    }
    document.addEventListener("click", evento => {
        if (evento.target.closest?.('[data-seccion="pagos"]')) {
            entrando = true;
            queueMicrotask(() => {
                solicitar({ tipo: "usuario", nombre: "entrar a Pagos" });
                entrando = false;
            });
            return;
        }
        if (activa()) queueMicrotask(() => {
            if (ultimo && ultimo.contexto.fecha !== fechaActual())
                solicitar({ tipo: "usuario", nombre: "cambio de fecha" });
        });
    }, true);
    window.addEventListener("haiku:auth-ready", () => {
        instalarRealtime();
        if (activa()) solicitar({ tipo: "externo", nombre: "sesión" });
    });
    if (window.haikuSesion) instalarRealtime();
    shell();
    window.HAIKU_PAGOS_REFRESH_V1 = Object.freeze({ solicitar, interceptar,
        escrituraConfirmada, activo: activa, publicando: () => publicando,
        snapshot: () => ultimo, perfil: () => ultimoPerfil,
        publicaciones: () => publicaciones, coalescidas: () => coalescidas });
})();
