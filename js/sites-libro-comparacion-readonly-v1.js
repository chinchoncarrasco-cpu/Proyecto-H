/* Orquestación de informe: autorización canónica, fuente 4B.2C y DTO 4B.1. Sin writers. */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else {
        root.HAIKU_LIBRO_INFORME_READONLY_V1 = api;
        const iniciar = () => api.instalar(root);
        if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", iniciar, { once: true });
        else iniciar();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const permisos = Object.freeze(["reservas.ver", "pagos.ver", "servicios.ver"]);
    const mensajes = Object.freeze({
        sin_sesion: "Sin sesión. Ingresa en Proyecto H para continuar.",
        error_sesion: "No fue posible validar la sesión de Proyecto H. Comprueba el acceso y reintenta.",
        permisos: "Tu usuario no está habilitado o no tiene permisos de lectura de reservas, pagos y servicios.",
        google_desconectado: "Google no conectado. Conecta explícitamente tu cuenta autorizada.",
        listo: "Listo para comparar el mes actual.",
        verificando: "Verificando Libro oficial…", comparando: "Comparando con Proyecto H…",
        vigencia: "Verificando vigencia final…", completo: "Resultado completo.",
        incompleto: "Resultado incompleto: revisa la cobertura y las advertencias.",
        error_fuente: "No fue posible verificar el Libro oficial. Revisa Google y vuelve a comparar.",
        archivo_modificado: "Archivo modificado o procedencia perdida. Vuelve a verificar y comparar.",
        obsoleta: "Consulta obsoleta. El resultado anterior fue descartado.",
        error_comparacion: "No fue posible completar la comparación. No se concluye que falten registros.",
        destruido: "Consulta cerrada; no se conserva el informe."
    });
    const fallo = code => Object.assign(new Error(mensajes[code] || mensajes.error_comparacion), { code });
    function crearControlador({ cliente, google, lector, nucleo, emitir = () => {}, ahora = () => new Date().toISOString() }) {
        let revision = 0, propietario = null, acceso = false, ocupado = false, destruido = false;
        let handle = null, resultado = null, fase = "sin_sesion", limpiando = false, inicioFuente = false;
        const pintar = () => emitir({ fase, mensaje: mensajes[fase], acceso, ocupado, resultado });
        const estado = () => ({ fase, acceso, ocupado, tieneResultado: !!resultado });
        const comprobar = (id, owner) => {
            if (destruido || id !== revision || owner && owner !== propietario) throw fallo("obsoleta");
        };
        function invalidar(code = "obsoleta", cerrarGoogle = false) {
            if (limpiando) return;
            revision++; ocupado = false; handle = null; resultado = null; fase = code;
            if (cerrarGoogle) { acceso = false; propietario = null; }
            // Limpiar antes de publicar cualquier nuevo estado; callbacks recursivos no reentran.
            limpiando = true;
            try {
                if (cerrarGoogle) google?.desconectar?.();
                Promise.resolve(lector?.limpiar?.()).catch(() => {});
            } finally { limpiando = false; }
            pintar();
        }
        async function validarAcceso(id, owner) {
            try {
                const s = await cliente.auth.getSession(); comprobar(id, owner);
                const user = s?.data?.session?.user?.id;
                if (s?.error) throw fallo("error_sesion");
                if (!user) throw fallo("sin_sesion");
                if (owner && user !== owner) throw fallo("obsoleta");
                const u = await cliente.auth.getUser(); comprobar(id, owner);
                if (u?.error || u?.data?.user?.id !== user) throw fallo("error_sesion");
                const r = await cliente.rpc("haiku_sesion_actual"); comprobar(id, owner);
                if (r?.error) throw fallo("error_sesion");
                if (r?.data?.usuario?.activo !== true || !Array.isArray(r.data.permisos) || !permisos.every(p => r.data.permisos.includes(p))) throw fallo("permisos");
                const final = await cliente.auth.getSession(); comprobar(id, owner);
                if (final?.error || final?.data?.session?.user?.id !== user) throw fallo("obsoleta");
                return user;
            } catch (e) { throw fallo(Object.hasOwn(mensajes, e?.code) ? e.code : "error_sesion"); }
        }
        async function comprobarSesion() {
            if (destruido || ocupado) return;
            const id = ++revision;
            resultado = null; handle = null; acceso = false; ocupado = true; fase = "error_sesion"; pintar();
            try {
                const user = await validarAcceso(id); comprobar(id);
                if (propietario && user !== propietario) { invalidar("obsoleta", true); return; }
                propietario = user; acceso = true; ocupado = false;
                fase = google?.estado?.().conectado ? "listo" : "google_desconectado"; pintar();
            } catch (e) { if (id === revision) invalidar(e.code, true); }
        }
        async function comparar() {
            if (destruido || ocupado) return;
            const id = ++revision, owner = propietario;
            resultado = null; handle = null; ocupado = true; fase = "verificando"; pintar();
            try {
                const user = await validarAcceso(id, owner); comprobar(id, owner);
                propietario = user; acceso = true;
                if (lector?.modo !== "informe-readonly-solo-memoria") throw fallo("error_fuente");
                if (!google.estado().conectado) throw fallo("google_desconectado");
                let descarga;
                inicioFuente = true;
                try { descarga = google.obtenerFuenteVerificada(); } finally { inicioFuente = false; }
                const recibido = await descarga; comprobar(id, user); handle = recibido;
                const fuente = google.fuenteVerificada(handle);
                if (fuente?.tipo !== "google-drive-oficial-verificado" || !fuente.libro) throw fallo("error_fuente");
                fase = "comparando"; pintar();
                // El núcleo 4B.1 construye su fachada SELECT; esta envoltura además detiene nuevas lecturas obsoletas.
                const clienteConsulta = Object.freeze({ auth: { getSession: async () => { comprobar(id, user); return cliente.auth.getSession(); } },
                    from: tabla => { comprobar(id, user); return cliente.from(tabla); } });
                const dto = await nucleo.compararMes({ fuente, cliente: clienteConsulta, ahora: ahora() }); comprobar(id, user);
                if (dto?.status === "error") throw fallo(dto.error?.code === "SESION_PERMISOS" ? "permisos" : dto.error?.code === "FUENTE_CAMBIADA" ? "archivo_modificado" : "error_comparacion");
                if (!["ok", "incompleto"].includes(dto?.status) || dto.schemaVersion !== 1 || dto.mode !== "read-only" ||
                    !dto.presentacion || !Array.isArray(dto.comparacion?.items) || !Array.isArray(dto.comparacion?.grupos) ||
                    dto.fuente?.version !== fuente.version || dto.fuente?.generacion !== fuente.generacion) throw fallo("error_comparacion");
                fase = "vigencia"; pintar();
                await google.verificarVigencia(handle); comprobar(id, user);
                await validarAcceso(id, user); comprobar(id, user);
                google.fuenteVerificada(handle);
                resultado = dto; ocupado = false; fase = dto.status === "ok" ? "completo" : "incompleto"; pintar();
            } catch (e) {
                if (id !== revision || destruido) return;
                const code = Object.hasOwn(mensajes, e?.code) ? e.code : e?.code === "GOOGLE_NO_AUTORIZADO" ? "google_desconectado" :
                    ["FUENTE_CAMBIADA", "SOLICITUD_OBSOLETA"].includes(e?.code) ? "archivo_modificado" : "error_fuente";
                invalidar(code, ["sin_sesion", "error_sesion", "permisos", "obsoleta"].includes(code));
            }
        }
        function fuenteInvalidada(code) {
            if (inicioFuente && code === "SOLICITUD_OBSOLETA") return;
            if (limpiando || destruido || !ocupado && !resultado) return;
            invalidar(code === "GOOGLE_NO_AUTORIZADO" ? "google_desconectado" : "archivo_modificado");
        }
        function cambioSesion(event, session) {
            if (destruido || event === "INITIAL_SESSION") return;
            const otraCuenta = !session?.user?.id || session.user.id !== propietario;
            acceso = false;
            invalidar(session?.user?.id ? "obsoleta" : "sin_sesion", otraCuenta);
        }
        function revisarLocal() {
            if (destruido) return;
            if (handle && resultado) { try { google.fuenteVerificada(handle); } catch (_) { invalidar("archivo_modificado"); } }
            else if (acceso && !ocupado && ["listo", "google_desconectado"].includes(fase)) {
                const siguiente = google.estado().conectado ? "listo" : "google_desconectado";
                if (fase !== siguiente) { fase = siguiente; pintar(); }
                else pintar(); // El botón espera también al fin de la sincronización normal.
            }
        }
        return Object.freeze({ comparar, comprobarSesion, invalidar, fuenteInvalidada, cambioSesion, revisarLocal, estado,
            destruir: () => { if (destruido) return; invalidar("destruido", true); destruido = true; },
            cerrarSesion: async () => { invalidar("sin_sesion", true); try { const r = await cliente.auth.signOut(); if (r?.error) throw fallo("error_sesion"); } catch (_) { fase = "error_sesion"; pintar(); } } });
    }

    const lista = x => Array.isArray(x) ? x : [];
    const conocido = x => Number.isFinite(x) && x >= 0 ? String(x) : "—";
    const visible = x => x === null || x === undefined || x === "" ? "No disponible" : String(x);
    function renderizar(document, contenedor, dto) {
        contenedor.replaceChildren();
        if (!dto || !["ok", "incompleto"].includes(dto.status)) { contenedor.hidden = true; return; }
        const el = (tag, clase, texto) => { const x = document.createElement(tag); if (clase) x.className = clase; if (texto !== undefined) x.textContent = String(texto); return x; };
        const p = dto.presentacion || {}, items = lista(dto.comparacion?.items), grupos = lista(dto.comparacion?.grupos);
        const resumen = el("div", "informe-resumen");
        const hero = el("div", "informe-fraccion"); hero.append(el("strong", "", `${conocido(p.estadiasAsociadas)} / ${conocido(p.estadiasValidas)}`), el("span", "", "estadías asociadas / válidas del Libro"));
        const metricas = el("div", "informe-metricas");
        for (const [label, value] of [["Asociadas", p.estadiasAsociadas], ["Faltantes", p.faltantes], ["Ambiguas", p.ambiguas]]) {
            const x = el("div", "informe-metrica"); x.append(el("strong", "", conocido(value)), el("span", "", label)); metricas.append(x);
        }
        resumen.append(hero, metricas, el("p", "informe-contexto", `${conocido(p.gruposAsociados)} grupos asociados · ${conocido(p.gruposLibro)} grupos Libro · ${conocido(p.gruposConDiferencias)} grupos con diferencias. Registros accesibles con tu sesión.`));
        if (dto.status === "incompleto") resumen.append(el("p", "informe-aviso", "Cobertura incompleta. Los resultados no demuestran ausencia en todo el Libro o Proyecto H."));
        if (p.pagosRevisar !== 0) resumen.append(el("p", "informe-aviso", `⚠ ${conocido(p.pagosRevisar)} pagos requieren revisión`));
        contenedor.append(resumen);
        const tecnicos = (parent, origenes) => {
            const os = lista(origenes).filter(Boolean); if (!os.length) return;
            const detalle = el("details", "informe-tecnico"); detalle.append(el("summary", "", "Evidencia XLSX"));
            for (const o of os) detalle.append(el("p", "", [o.hoja, o.celda || o.rango, o.fila != null ? "fila " + o.fila : null].filter(Boolean).join(" · ")));
            parent.append(detalle);
        };
        const valores = (parent, entries) => { const dl = el("dl", ""); for (const [k, v] of entries) dl.append(el("dt", "", k), el("dd", "", visible(v))); parent.append(dl); };
        const texto = (parent, xs) => lista(xs).forEach(t => parent.append(el("p", "", t)));
        const titulo = r => `CAB ${visible(r?.cabana || lista(r?.cabanas).join(", "))} · ${visible(r?.titular)}`;
        const caso = (parent, i) => {
            parent.append(el("h3", "", titulo(i.libro)), el("p", "", `${visible(i.libro?.fecha_checkin)} – ${visible(i.libro?.fecha_checkout)}`));
            valores(parent, [["Estado", i.estado], ["Clasificación", i.categoria], ["Referencia visible", i.libro?.fecha_ingreso_libro || i.libro?.estado_confirmacion]]);
            if (i.motivo) parent.append(el("p", "", i.motivo));
            texto(parent, i.libro?.notasImportantes); texto(parent, i.libro?.notasInterpretacion);
            texto(parent, i.libro?.pagosPendientes); texto(parent, i.libro?.advertencias);
            for (const d of lista(i.diferencias)) {
                const row = el("div", ""); row.append(el("p", "", d));
                // Presentación de valores disponibles; la diferencia la determina exclusivamente el motor.
                const key = String(d).split(":")[0], labels = { telefono: "telefono", correo: "correo", "RUT/documento": "rut_documento", "estado de estadía": "estado_operativo" };
                const field = labels[key] || key;
                if (Object.hasOwn(i.libro || {}, field) || Object.hasOwn(i.proyecto || {}, field)) valores(row, [["Campo", key], ["Libro", i.libro?.[field]], ["Proyecto H", i.proyecto?.[field]]]);
                parent.append(row);
            }
            lista(i.candidatos).forEach(c => parent.append(el("p", "", `Candidato: ${titulo(c)} · ${visible(c.fecha_checkin)} – ${visible(c.fecha_checkout)} · ${visible(c.estado_reserva)}`)));
            tecnicos(parent, [i.libro?.origen]);
        };
        const categorias = el("div", "informe-categorias");
        const seccion = (nombre, count, rows, dibujar) => {
            const d = el("details", "informe-categoria"), s = el("summary", ""); s.append(el("span", "", nombre), el("span", "", conocido(count))); d.append(s);
            const body = el("div", "informe-detalles");
            if (!rows.length) body.append(el("p", "", "Sin elementos en esta categoría del resultado."));
            rows.forEach(row => { const card = el("article", "informe-item"); dibujar(card, row); body.append(card); });
            d.append(body); categorias.append(d);
        };
        seccion("Coincidencias", p.gruposAsociados, grupos.filter(g => g.estado === "asociada"), (parent, g) => {
            parent.append(el("p", "", `Grupo asociado · ${lista(g.cabanas).map(c => "CAB " + c).join(", ")}`));
            items.filter(i => lista(g.itemIds).includes(i.id)).forEach(i => caso(parent, i));
        });
        seccion("Diferencias", p.gruposConDiferencias, grupos.filter(g => g.estado === "asociada" && lista(g.diferencias).length), (parent, g) => {
            texto(parent, g.diferencias); items.filter(i => lista(g.itemIds).includes(i.id)).forEach(i => caso(parent, i));
        });
        for (const [label, status, count] of [["Faltantes", "sin_coincidencia", p.faltantes], ["Ambiguas", "ambigua", p.ambiguas]])
            seccion(label, count, grupos.filter(g => g.estado === status), (parent, g) => {
                if (g.pregunta) parent.append(el("p", "", g.pregunta)); items.filter(i => lista(g.itemIds).includes(i.id)).forEach(i => caso(parent, i));
            });
        const relacion = row => items.find(i => lista(row.itemIds).includes(i.id))?.libro;
        seccion("Pagos", p.pagosRevisar, lista(dto.pagosDetalle), (parent, row) => {
            parent.append(el("h3", "", titulo(relacion(row))));
            valores(parent, [["Estado canónico", row.estado], ["Monto Libro", row.libro?.monto], ["Moneda", row.libro?.moneda], ["Medio Libro", row.libro?.medio_pago], ["Fecha Libro", row.libro?.fecha_comprobante], ["Monto Proyecto H", row.proyecto?.monto], ["Estado Proyecto H", row.proyecto?.estado], ["Medio Proyecto H", row.proyecto?.medio_pago], ["Fecha Proyecto H", row.proyecto?.fecha_pago], ["Comprobante", row.libro?.folio || row.libro?.bovtar || row.libro?.codigo_autorizacion]]);
            texto(parent, row.diferencias); texto(parent, row.motivos);
            if (row.resolucionSemantica) valores(parent, [["Resolución canónica", row.resolucionSemantica.estado], ["Evidencia", row.resolucionSemantica.evidencia]]);
            lista(row.libro?.aplicaciones).forEach(a => { valores(parent, [["Concepto Libro", a.concepto], ["Movimiento", a.tipo_movimiento], ["Monto", a.monto], ["Moneda", a.moneda]]); tecnicos(parent, [a.origen]); });
            if (row.destinoFinanciero) valores(parent, [["Destino", row.destinoFinanciero.estado], ["Motivo", row.destinoFinanciero.motivo], ["Total destino", row.destinoFinanciero.monto_total]]);
            lista(row.destinoFinanciero?.aplicaciones).forEach(a => { valores(parent, [["Aplicación", a.concepto], ["Estado", a.estado], ["Monto", a.monto], ["Cargo", a.cargo?.concepto], ["Saldo", a.cargo?.saldo_cargo], ["Motivo", a.motivo]]); tecnicos(parent, [a.origen]); });
            tecnicos(parent, [row.libro?.origen, ...lista(row.libro?.origenes)]);
        });
        seccion("Servicios", p.serviciosRevisar, lista(dto.serviciosDetalle), (parent, row) => {
            parent.append(el("h3", "", `${titulo(relacion(row))} · ${visible(row.libro?.concepto)}`));
            valores(parent, [["Estado canónico", row.estado], ["Fecha Libro", row.libro?.fecha], ["Hora Libro", row.libro?.hora], ["Cantidad", row.libro?.cantidad], ["Monto Libro", row.libro?.monto], ["Cobro", row.libro?.intencion_cobro], ["Proyecto H", row.proyecto?.catalogo?.nombre], ["Fecha Proyecto H", row.proyecto?.fecha_servicio], ["Hora Proyecto H", row.proyecto?.hora_inicio], ["Monto Proyecto H", row.proyecto?.total], ["Estado Proyecto H", row.proyecto?.estado_servicio]]);
            valores(parent, [["Personas", row.libro?.personas], ["Duración (minutos)", row.libro?.duracion_minutos], ["Clasificación", row.libro?.clasificacion], ["Evidencia Libro", row.libro?.texto_original]]);
            texto(parent, row.diferencias); texto(parent, row.libro?.advertencias); if (row.motivo) parent.append(el("p", "", row.motivo)); tecnicos(parent, [row.libro?.origen]);
        });
        const avisos = [...lista(dto.advertencias).map(motivo => ({ clase: "Advertencia", motivo })), ...lista(dto.contexto?.advertenciasInformativas).map(motivo => ({ clase: "Informativa", motivo }))];
        seccion("Advertencias", p.advertencias, avisos, (parent, row) => valores(parent, [["Clasificación", row.clase], ["Motivo", row.motivo]]));
        if (p.advertenciasInformativas !== 0) categorias.lastChild.querySelector(".informe-detalles").prepend(el("p", "", `${conocido(p.advertenciasInformativas)} advertencias informativas del DTO.`));
        // Cobertura, bloqueos y cancelaciones también forman parte del DTO; no se omiten al compactar.
        const contexto = el("details", "informe-categoria"); contexto.append(el("summary", "", "Cobertura, bloqueos y cancelaciones"));
        const cuerpo = el("div", "informe-detalles");
        lista(dto.cobertura?.hojas).forEach(h => {
            const detalle = el("details", "informe-tecnico"); detalle.append(el("summary", "", "Cobertura XLSX"));
            valores(detalle, [["Hoja", h.hoja], ["Geometría segura", h.geometria], ["Pagos seguros", h.pagos]]); cuerpo.append(detalle);
        });
        valores(cuerpo, [["Bloqueos: lectura segura", dto.cobertura?.bloqueosLecturaSegura], ["CAB por revisar", lista(dto.cobertura?.cabanasRevision).join(", ") || "No declaradas"]]);
        lista(dto.cobertura?.pagosPorCaso).forEach(c => {
            const i = items.find(i => i.id === c.itemId);
            valores(cuerpo, [["Reserva", titulo(i?.libro)], ["Cobertura de pagos", c.cobertura]]);
        });
        for (const key of ["items", "soloProyectoH", "revisionInversa"]) lista(dto.contexto?.bloqueos?.[key]).forEach(b => {
            valores(cuerpo, [["Bloqueo", key], ["CAB", b.cabana], ["Desde", b.fecha_inicio], ["Hasta", b.fecha_fin], ["Estado", b.estado], ["Motivo", b.mensaje || b.nota]]); tecnicos(cuerpo, [b.origen]);
        });
        if (dto.contexto?.bloqueos?.errorInversa) cuerpo.append(el("p", "", dto.contexto.bloqueos.errorInversa));
        for (const key of ["confirmadas", "yaCoinciden", "revision"]) lista(dto.contexto?.cancelaciones?.[key]).forEach(c => {
            valores(cuerpo, [["Cancelación", key], ["Reserva", c.actual ? titulo(c.actual) : c.motivo], ["Estado Proyecto H", c.estado_proyecto], ["Motivo", c.tipo]]); tecnicos(cuerpo, [c.evidencia?.origen, c.actual?.origen]);
            if (c.evidencia) valores(cuerpo, [["Evidencia Libro", titulo(c.evidencia)], ["Entrada", c.evidencia.fecha_checkin], ["Salida", c.evidencia.fecha_checkout]]);
        });
        contexto.append(cuerpo); categorias.append(contexto); contenedor.append(categorias); contenedor.hidden = false;
    }

    function instalar(root) {
        const d = root.document, target = d.getElementById("informe-resultado"); if (!target) return;
        const google = root.HAIKU_LIBRO_GOOGLE_V1, lector = root.HAIKU_LIBRO_RESERVA_V1;
        const boton = d.getElementById("informe-comparar"), aviso = d.getElementById("informe-estado");
        const periodo = d.getElementById("informe-periodo"), ahora = () => new Date().toISOString();
        periodo.textContent = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", month: "long", year: "numeric" }).format(new Date());
        let control;
        try {
            control = crearControlador({ cliente: root.haikuSupabase, google, lector, nucleo: root.HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo(), ahora,
                emitir: s => {
                    aviso.textContent = s.mensaje; aviso.dataset.estado = s.fase;
                    boton.disabled = !s.acceso || s.ocupado || !google?.estado().conectado || google.estado().sincronizando;
                    d.getElementById("seccion-libro-reserva").hidden = !s.acceso;
                    d.getElementById("informe-login").hidden = s.acceso;
                    d.getElementById("informe-salir").hidden = !s.acceso;
                    d.getElementById("informe-reintentar").disabled = s.ocupado;
                    renderizar(d, target, s.resultado);
                    if (s.resultado) {
                        const fecha = value => new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "2-digit", month: "short" }).format(new Date(value + "T12:00:00Z"));
                        periodo.textContent = `${s.resultado.periodo.etiqueta} · ${fecha(s.resultado.periodo.desde)} – ${fecha(s.resultado.periodo.hasta)}`;
                    }
                } });
        } catch (_) { aviso.textContent = mensajes.error_fuente; return; }
        const click = () => void control.comparar(), reintentar = () => void control.comprobarSesion();
        boton.addEventListener("click", click); d.getElementById("informe-reintentar").addEventListener("click", reintentar);
        d.getElementById("informe-salir").addEventListener("click", () => void control.cerrarSesion());
        const fuente = e => control.fuenteInvalidada(e.detail?.code);
        root.addEventListener("haiku:libro-fuente-invalidada", fuente);
        const capturar = e => {
            const id = e.target.closest?.("button")?.id;
            if (!id?.startsWith("haiku-libro-google-")) return;
            if (!control.estado().acceso) { e.preventDefault(); e.stopImmediatePropagation(); return; }
            control.invalidar(id.endsWith("desconectar") || !google.estado().conectado ? "google_desconectado" : "listo");
        };
        d.addEventListener("click", capturar, true);
        let authTimer;
        const subscription = root.haikuSupabase?.auth.onAuthStateChange((event, session) => {
            control.cambioSesion(event, session);
            if (event !== "INITIAL_SESSION" && session?.user?.id) { clearTimeout(authTimer); authTimer = setTimeout(reintentar, 0); }
        })?.data?.subscription;
        const timer = setInterval(() => control.revisarLocal(), 1000);
        const destruir = () => {
            control.destruir(); clearInterval(timer); clearTimeout(authTimer); subscription?.unsubscribe();
            root.removeEventListener("haiku:libro-fuente-invalidada", fuente); d.removeEventListener("click", capturar, true);
            boton.removeEventListener("click", click); d.getElementById("informe-reintentar").removeEventListener("click", reintentar);
        };
        root.addEventListener("pagehide", destruir, { once: true });
        root.addEventListener("pageshow", e => { if (e.persisted) root.location.reload(); });
        reintentar();
    }
    return Object.freeze({ crearControlador, renderizar, instalar });
});
