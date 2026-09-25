// ========================================
// HAIKU · BLOQUEOS CALENDARIO SUPABASE V2
// Supabase = fuente real de bloqueos.
// Migra legacy, materializa rangos y permite liberar sin romper calendario.js.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let sincronizando = false;
    let liberando = false;
    let canal = null;
    let temporizador = null;
    let bloqueoModalId = "";

    const bloqueosActivos = new Map();

    const CAMPOS_BLOQUEO = [
        "bloqueoId",
        "bloqueoLegacyId",
        "bloqueoAutomatico",
        "bloqueoFechaInicio",
        "bloqueoFechaFin",
        "bloqueoMotivo",
        "bloqueoCreadoEn",
        "bloqueoEstadoAnterior",
        "bloqueoSincronizadoSupabase",
        "bloqueoSupabaseId"
    ];

    function fechaActual() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
        } catch (_) {
            return "";
        }
    }

    function leerDatosLegacy() {
        try {
            return JSON.parse(localStorage.getItem("haikuDatos") || "{}") || {};
        } catch (_) {
            return {};
        }
    }

    function escribirDatosLegacy(datos) {
        try {
            localStorage.setItem("haikuDatos", JSON.stringify(datos));
        } catch (_) {}

        try {
            if (typeof datosPorFecha !== "undefined") {
                datosPorFecha = datos;
            }
        } catch (_) {}
    }

    function crearDiaVacio() {
        return {
            encargado: "",
            notas: "",
            notasOperativas: [],
            cabanas: {},
            servicios: [],
            pagos: [],
            mantencion: [],
            lavanderia: []
        };
    }

    function sumarDia(fecha) {
        const [a, m, d] = String(fecha).slice(0, 10).split("-").map(Number);
        const base = new Date(a, m - 1, d, 12, 0, 0);
        base.setDate(base.getDate() + 1);
        return [
            base.getFullYear(),
            String(base.getMonth() + 1).padStart(2, "0"),
            String(base.getDate()).padStart(2, "0")
        ].join("-");
    }

    function fechaChileDesdeTimestamp(valor) {
        if (!valor) return "";

        try {
            const partes = new Intl.DateTimeFormat("en-US", {
                timeZone: "America/Santiago",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).formatToParts(new Date(valor));

            const mapa = Object.fromEntries(
                partes.filter(p => p.type !== "literal").map(p => [p.type, p.value])
            );

            return `${mapa.year}-${mapa.month}-${mapa.day}`;
        } catch (_) {
            return String(valor).slice(0, 10);
        }
    }

    function formatearFecha(fecha) {
        if (!fecha) return "Sin fecha";

        try {
            const [a, m, d] = String(fecha).slice(0, 10).split("-").map(Number);
            return new Intl.DateTimeFormat("es-CL", {
                day: "numeric",
                month: "short",
                year: "numeric"
            }).format(new Date(a, m - 1, d, 12, 0, 0));
        } catch (_) {
            return fecha;
        }
    }

    function numeroDesdeRelacion(relacion) {
        if (Array.isArray(relacion)) {
            return Number(relacion[0]?.numero || 0);
        }
        return Number(relacion?.numero || 0);
    }

    function extraerBloqueosLegacy(datos) {
        const mapa = new Map();

        Object.entries(datos || {}).forEach(([fecha, dia]) => {
            if (!dia?.cabanas) return;

            Object.entries(dia.cabanas).forEach(([numero, cabana]) => {
                if (String(cabana?.estado || "").toLowerCase() !== "bloqueada") {
                    return;
                }

                // Lo que ya nació o fue materializado desde Supabase no se vuelve a insertar.
                if (
                    cabana.bloqueoSincronizadoSupabase === true ||
                    cabana.bloqueoSupabaseId
                ) {
                    return;
                }

                const desde = String(cabana.bloqueoFechaInicio || fecha).slice(0, 10);
                const hasta = String(
                    cabana.bloqueoFechaFin || sumarDia(fecha)
                ).slice(0, 10);

                const idLegacy = String(
                    cabana.bloqueoId || `BLQ-LEGACY-${numero}-${desde}-${hasta}`
                );

                const clave = `${idLegacy}::${numero}`;

                if (!mapa.has(clave)) {
                    mapa.set(clave, {
                        clave,
                        idLegacy,
                        numero: Number(numero),
                        desde,
                        hasta,
                        motivo: String(cabana.bloqueoMotivo || "").trim(),
                        fechas: []
                    });
                }

                mapa.get(clave).fechas.push(fecha);
            });
        });

        return [...mapa.values()].filter(item =>
            item.numero > 0 && item.desde && item.hasta && item.hasta > item.desde
        );
    }

    function marcarSincronizado(datos, bloqueo, resultado) {
        const idSupabase = String(resultado?.bloqueo_id || "");
        if (!idSupabase) return;

        (bloqueo.fechas || []).forEach(fecha => {
            const cabana = datos?.[fecha]?.cabanas?.[String(bloqueo.numero)];
            if (!cabana) return;

            cabana.bloqueoLegacyId = cabana.bloqueoId || bloqueo.idLegacy || "";
            cabana.bloqueoSincronizadoSupabase = true;
            cabana.bloqueoSupabaseId = idSupabase;
            cabana.bloqueoId = `BLQ-SB-${idSupabase}`;
        });
    }

    function limpiarBloqueoLocal(cabana) {
        if (!cabana) return cabana;

        const copia = { ...cabana };
        const anterior = String(copia.bloqueoEstadoAnterior || "").trim();

        CAMPOS_BLOQUEO.forEach(campo => delete copia[campo]);

        if (String(copia.estado || "").toLowerCase() === "bloqueada") {
            copia.estado = anterior || "libre-libre";
        }

        return copia;
    }

    function limpiarBloqueosSupabaseObsoletos(datos, idsActivos) {
        Object.values(datos || {}).forEach(dia => {
            if (!dia?.cabanas) return;

            Object.entries(dia.cabanas).forEach(([numero, cabana]) => {
                const id = String(cabana?.bloqueoSupabaseId || "");
                if (!id || idsActivos.has(id)) return;

                dia.cabanas[numero] = limpiarBloqueoLocal(cabana);
            });
        });
    }

    function materializarBloqueo(datos, bloqueo) {
        const numero = String(bloqueo.numero || "");
        if (!numero || !bloqueo.desde || !bloqueo.hasta) return;

        let fecha = bloqueo.desde;

        while (fecha < bloqueo.hasta) {
            if (!datos[fecha]) datos[fecha] = crearDiaVacio();
            if (!datos[fecha].cabanas) datos[fecha].cabanas = {};

            const anterior = datos[fecha].cabanas[numero] || {};
            const yaEraEsteBloqueo =
                String(anterior.bloqueoSupabaseId || "") === String(bloqueo.id);

            const estadoAnterior = yaEraEsteBloqueo
                ? (anterior.bloqueoEstadoAnterior || "libre-libre")
                : (
                    String(anterior.estado || "").toLowerCase() === "bloqueada"
                        ? (anterior.bloqueoEstadoAnterior || "libre-libre")
                        : (anterior.estado || "libre-libre")
                );

            datos[fecha].cabanas[numero] = {
                ...anterior,
                estado: "bloqueada",
                bloqueoId: `BLQ-SB-${bloqueo.id}`,
                bloqueoLegacyId: anterior.bloqueoLegacyId || "",
                bloqueoAutomatico: true,
                bloqueoFechaInicio: bloqueo.desde,
                bloqueoFechaFin: bloqueo.hasta,
                bloqueoMotivo: bloqueo.motivo || "",
                bloqueoEstadoAnterior: estadoAnterior,
                bloqueoSincronizadoSupabase: true,
                bloqueoSupabaseId: bloqueo.id
            };

            fecha = sumarDia(fecha);
        }
    }

    async function obtenerBloqueosActivosSupabase() {
        const { data, error } = await cliente
            .from("bloqueos_cabana")
            .select("id,cabana_id,motivo,desde,hasta,estado,cabanas(numero)")
            .eq("estado", "activo")
            .order("desde", { ascending: true });

        if (error) throw error;

        return (data || []).map(item => ({
            id: String(item.id || ""),
            numero: numeroDesdeRelacion(item.cabanas),
            motivo: String(item.motivo || ""),
            desde: fechaChileDesdeTimestamp(item.desde),
            hasta: item.hasta ? fechaChileDesdeTimestamp(item.hasta) : ""
        })).filter(item => item.id && item.numero > 0 && item.desde && item.hasta);
    }

    function refrescarInterfazLocal() {
        const fecha = fechaActual();

        try {
            if (typeof generarCalendario === "function") {
                generarCalendario();
            }
        } catch (_) {}

        try {
            if (fecha && typeof cargarCabanasDia === "function") {
                cargarCabanasDia(fecha, {
                    evento: "bloqueos sincronizados", tipo: "externo"
                });
            }
        } catch (_) {}
    }

    async function sincronizarDesdeSupabase() {
        if (!window.haikuSesion) return [];

        const activos = await obtenerBloqueosActivosSupabase();
        const idsActivos = new Set(activos.map(item => item.id));
        const datos = leerDatosLegacy();

        bloqueosActivos.clear();
        activos.forEach(item => bloqueosActivos.set(item.id, item));

        limpiarBloqueosSupabaseObsoletos(datos, idsActivos);
        activos.forEach(item => materializarBloqueo(datos, item));

        escribirDatosLegacy(datos);
        refrescarInterfazLocal();

        return activos;
    }

    async function sincronizarBloqueosLegacy() {
        if (sincronizando || !window.haikuSesion) return;
        sincronizando = true;

        try {
            const datos = leerDatosLegacy();
            const bloqueos = extraerBloqueosLegacy(datos);

            for (const bloqueo of bloqueos) {
                const { data, error } = await cliente.rpc(
                    "haiku_registrar_bloqueo_calendario",
                    {
                        p_cabana_numero: bloqueo.numero,
                        p_desde: bloqueo.desde,
                        p_hasta: bloqueo.hasta,
                        p_motivo: bloqueo.motivo || null
                    }
                );

                if (error) {
                    console.warn(
                        `HAIKU · No fue posible sincronizar bloqueo CAB ${bloqueo.numero}:`,
                        error
                    );
                    continue;
                }

                marcarSincronizado(datos, bloqueo, data || {});
            }

            escribirDatosLegacy(datos);
            await sincronizarDesdeSupabase();

            console.info("HAIKU · Bloqueos de Calendario sincronizados con Supabase.");
        } catch (error) {
            console.error("HAIKU · Error sincronizando bloqueos de Calendario:", error);
        } finally {
            sincronizando = false;
        }
    }

    function instalarEstilosLiberacion() {
        if (document.getElementById("haiku-bloqueo-liberar-estilos")) return;

        const style = document.createElement("style");
        style.id = "haiku-bloqueo-liberar-estilos";
        style.textContent = `
            .haiku-bloqueo-liberar-backdrop {
                position: fixed;
                inset: 0;
                z-index: 10030;
                background: rgba(0, 0, 0, .42);
                display: grid;
                place-items: center;
                padding: 18px;
            }
            .haiku-bloqueo-liberar-backdrop[hidden] { display: none !important; }
            .haiku-bloqueo-liberar-modal {
                width: min(420px, calc(100vw - 36px));
                max-height: min(650px, calc(100vh - 36px));
                overflow: auto;
                background: #fff;
                border: 1px solid #dedede;
                border-radius: 16px;
                box-shadow: 0 22px 60px rgba(0,0,0,.24);
                color: #1f2924;
            }
            .haiku-bloqueo-liberar-head {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 14px;
                padding: 18px 18px 14px;
                border-bottom: 1px solid #ecefea;
            }
            .haiku-bloqueo-liberar-head small {
                display: block;
                margin-bottom: 4px;
                color: #6a746e;
                font-size: 11px;
                letter-spacing: .08em;
                text-transform: uppercase;
            }
            .haiku-bloqueo-liberar-head strong {
                display: block;
                font-size: 18px;
            }
            .haiku-bloqueo-liberar-cerrar {
                border: 0;
                background: transparent;
                font-size: 24px;
                line-height: 1;
                cursor: pointer;
                color: #536059;
            }
            .haiku-bloqueo-liberar-body { padding: 16px 18px 18px; }
            .haiku-bloqueo-liberar-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-bottom: 12px;
            }
            .haiku-bloqueo-liberar-dato,
            .haiku-bloqueo-liberar-motivo {
                border: 1px solid #e2e7e3;
                border-radius: 12px;
                padding: 11px 12px;
                background: #fafbf9;
            }
            .haiku-bloqueo-liberar-dato span,
            .haiku-bloqueo-liberar-motivo span {
                display: block;
                color: #748078;
                font-size: 11px;
                margin-bottom: 4px;
            }
            .haiku-bloqueo-liberar-dato strong,
            .haiku-bloqueo-liberar-motivo strong {
                font-size: 13px;
                overflow-wrap: anywhere;
            }
            .haiku-bloqueo-liberar-aviso {
                margin: 13px 0 0;
                font-size: 12px;
                line-height: 1.45;
                color: #5e6962;
            }
            .haiku-bloqueo-liberar-estado {
                min-height: 18px;
                margin-top: 10px;
                font-size: 12px;
                color: #6a746e;
            }
            .haiku-bloqueo-liberar-estado.error { color: #a73d36; }
            .haiku-bloqueo-liberar-estado.ok { color: #23734d; }
            .haiku-bloqueo-liberar-actions {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                padding: 0 18px 18px;
            }
            .haiku-bloqueo-liberar-actions button {
                min-height: 42px;
                border-radius: 10px;
                border: 1px solid #d8ded9;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
            }
            .haiku-bloqueo-liberar-cancelar { background: #fff; color: #33413a; }
            .haiku-bloqueo-liberar-confirmar {
                background: #8f3f39;
                color: #fff;
                border-color: #8f3f39 !important;
            }
            .haiku-bloqueo-liberar-confirmar:disabled { opacity: .55; cursor: default; }
            @media (max-width: 520px) {
                .haiku-bloqueo-liberar-grid { grid-template-columns: 1fr; }
            }
        `;
        document.head.appendChild(style);
    }

    function crearModalLiberacion() {
        if (document.getElementById("haiku-bloqueo-liberar-backdrop")) return;

        const backdrop = document.createElement("div");
        backdrop.id = "haiku-bloqueo-liberar-backdrop";
        backdrop.className = "haiku-bloqueo-liberar-backdrop";
        backdrop.hidden = true;

        backdrop.innerHTML = `
            <div class="haiku-bloqueo-liberar-modal" role="dialog" aria-modal="true" aria-labelledby="haiku-bloqueo-liberar-titulo">
                <div class="haiku-bloqueo-liberar-head">
                    <div>
                        <small>Calendario · Bloqueo activo</small>
                        <strong id="haiku-bloqueo-liberar-titulo">Liberar bloqueo</strong>
                    </div>
                    <button type="button" class="haiku-bloqueo-liberar-cerrar" aria-label="Cerrar">×</button>
                </div>
                <div class="haiku-bloqueo-liberar-body">
                    <div class="haiku-bloqueo-liberar-grid">
                        <div class="haiku-bloqueo-liberar-dato">
                            <span>Cabaña</span>
                            <strong data-haiku-bloqueo-cabana>—</strong>
                        </div>
                        <div class="haiku-bloqueo-liberar-dato">
                            <span>Rango</span>
                            <strong data-haiku-bloqueo-rango>—</strong>
                        </div>
                    </div>
                    <div class="haiku-bloqueo-liberar-motivo">
                        <span>Motivo</span>
                        <strong data-haiku-bloqueo-motivo>Sin motivo registrado</strong>
                    </div>
                    <p class="haiku-bloqueo-liberar-aviso">
                        Al liberar, HAIKU quitará el bloqueo completo y recalculará el estado normal de la cabaña. No elimina reservas ni otros datos.
                    </p>
                    <div class="haiku-bloqueo-liberar-estado" data-haiku-bloqueo-estado></div>
                </div>
                <div class="haiku-bloqueo-liberar-actions">
                    <button type="button" class="haiku-bloqueo-liberar-cancelar">Cancelar</button>
                    <button type="button" class="haiku-bloqueo-liberar-confirmar">Liberar bloqueo</button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);

        backdrop.querySelector(".haiku-bloqueo-liberar-cerrar")?.addEventListener("click", cerrarModalLiberacion);
        backdrop.querySelector(".haiku-bloqueo-liberar-cancelar")?.addEventListener("click", cerrarModalLiberacion);
        backdrop.querySelector(".haiku-bloqueo-liberar-confirmar")?.addEventListener("click", liberarBloqueoSeleccionado);

        backdrop.addEventListener("click", evento => {
            if (evento.target === backdrop) cerrarModalLiberacion();
        });
    }

    function mostrarEstadoModal(texto = "", tipo = "") {
        const estado = document.querySelector("[data-haiku-bloqueo-estado]");
        if (!estado) return;
        estado.textContent = texto;
        estado.className = `haiku-bloqueo-liberar-estado${tipo ? ` ${tipo}` : ""}`;
    }

    function cerrarModalLiberacion() {
        if (liberando) return;
        const backdrop = document.getElementById("haiku-bloqueo-liberar-backdrop");
        if (backdrop) backdrop.hidden = true;
        bloqueoModalId = "";
        mostrarEstadoModal("");
    }

    async function abrirModalLiberacion(id) {
        if (!id) return;

        if (!bloqueosActivos.has(id)) {
            try {
                await sincronizarDesdeSupabase();
            } catch (_) {}
        }

        const bloqueo = bloqueosActivos.get(id);
        if (!bloqueo) {
            alert("Este bloqueo ya no está activo. HAIKU actualizará el calendario.");
            try { await sincronizarDesdeSupabase(); } catch (_) {}
            return;
        }

        instalarEstilosLiberacion();
        crearModalLiberacion();

        bloqueoModalId = id;
        const backdrop = document.getElementById("haiku-bloqueo-liberar-backdrop");
        if (!backdrop) return;

        const cabana = backdrop.querySelector("[data-haiku-bloqueo-cabana]");
        const rango = backdrop.querySelector("[data-haiku-bloqueo-rango]");
        const motivo = backdrop.querySelector("[data-haiku-bloqueo-motivo]");
        const confirmar = backdrop.querySelector(".haiku-bloqueo-liberar-confirmar");

        if (cabana) cabana.textContent = `CAB ${bloqueo.numero}`;
        if (rango) rango.textContent = `${formatearFecha(bloqueo.desde)} → ${formatearFecha(bloqueo.hasta)}`;
        if (motivo) motivo.textContent = bloqueo.motivo || "Sin motivo registrado";

        const puedeLiberar =
            typeof window.haikuTienePermiso !== "function" ||
            window.haikuTienePermiso("cabanas.liberar");

        if (confirmar) {
            confirmar.disabled = !puedeLiberar;
            confirmar.textContent = puedeLiberar ? "Liberar bloqueo" : "Sin permiso para liberar";
        }

        mostrarEstadoModal("");
        backdrop.hidden = false;
    }

    async function liberarBloqueoSeleccionado() {
        const id = bloqueoModalId;
        if (!id || liberando) return;

        const bloqueo = bloqueosActivos.get(id);
        if (!bloqueo) return;

        const confirmar = document.querySelector(".haiku-bloqueo-liberar-confirmar");
        liberando = true;

        if (confirmar) {
            confirmar.disabled = true;
            confirmar.textContent = "Liberando...";
        }
        mostrarEstadoModal("Guardando liberación en Supabase...");

        try {
            const { data, error } = await cliente.rpc(
                "haiku_liberar_bloqueo_calendario",
                { p_bloqueo_id: id }
            );

            if (error) throw error;

            await sincronizarDesdeSupabase();

            try {
                if (typeof window.haikuSincronizarReservasSupabase === "function") {
                    await window.haikuSincronizarReservasSupabase();
                }
            } catch (_) {}

            refrescarInterfazLocal();
            mostrarEstadoModal("✓ Bloqueo liberado. Estado operativo recalculado.", "ok");

            console.info("HAIKU · Bloqueo liberado:", data || { bloqueo_id: id });

            setTimeout(() => {
                liberando = false;
                if (confirmar) confirmar.textContent = "Liberar bloqueo";
                cerrarModalLiberacion();
            }, 650);
        } catch (error) {
            console.error("HAIKU · No fue posible liberar bloqueo:", error);
            liberando = false;
            if (confirmar) {
                confirmar.disabled = false;
                confirmar.textContent = "Liberar bloqueo";
            }
            mostrarEstadoModal(error?.message || "No fue posible liberar el bloqueo.", "error");
        }
    }

    function idBloqueoDesdeElemento(elemento) {
        if (!elemento) return "";

        const reservaId = String(elemento.dataset?.reservaId || "");
        const match = reservaId.match(/BLQ-SB-([0-9a-f-]{36})/i);
        if (match?.[1]) return match[1];

        const numero = String(elemento.dataset?.cabana || "");
        if (!numero) return "";

        const fecha = fechaActual();
        const cabana = leerDatosLegacy()?.[fecha]?.cabanas?.[numero];
        return String(cabana?.bloqueoSupabaseId || "");
    }

    function idBloqueoActualCabana(numero) {
        const fecha = fechaActual();
        if (!fecha || !numero) return "";
        const cabana = leerDatosLegacy()?.[fecha]?.cabanas?.[String(numero)];
        return String(cabana?.bloqueoSupabaseId || "");
    }

    function programar(retraso = 80) {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
            sincronizarBloqueosLegacy();
        }, retraso);
    }

    function instalarRealtime() {
        if (canal || !window.haikuSesion) return;

        canal = cliente
            .channel("haiku-bloqueos-calendario-v2")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "bloqueos_cabana"
                },
                () => setTimeout(() => {
                    sincronizarDesdeSupabase().catch(() => {});
                }, 100)
            );

        canal.subscribe(estado => {
            if (estado === "SUBSCRIBED") {
                console.info("HAIKU · Bloqueos Calendario Realtime conectado.");
            }
        });
    }

    function instalarInteraccionesLiberacion() {
        // Click en barra roja del Calendario: abre Liberar, no una ficha de reserva falsa.
        document.addEventListener(
            "click",
            evento => {
                const bloqueo = evento.target?.closest?.(".calendario-bloqueo-barra");
                if (!bloqueo) return;

                const id = idBloqueoDesdeElemento(bloqueo);
                if (!id) return;

                evento.preventDefault();
                evento.stopPropagation();
                abrirModalLiberacion(id);
            },
            true
        );

        // Si se intenta cambiar BLQ manualmente desde Resumen,
        // interceptamos antes del legacy y convertimos la acción en liberación real.
        document.addEventListener(
            "change",
            evento => {
                const selector = evento.target?.closest?.(
                    '#seccion-resumen [data-campo="estado"]'
                );
                if (!selector) return;

                const fila = selector.closest("[data-cabana]");
                const numero = String(fila?.dataset?.cabana || "");
                const id = idBloqueoActualCabana(numero);

                if (!id || selector.value === "bloqueada") return;

                evento.preventDefault();
                evento.stopPropagation();
                selector.value = "bloqueada";
                abrirModalLiberacion(id);
            },
            true
        );
    }

    function iniciar() {
        if (!window.haikuSesion) return;

        instalarEstilosLiberacion();
        crearModalLiberacion();
        instalarRealtime();
        programar(30);
    }

    instalarInteraccionesLiberacion();

    document.addEventListener(
        "click",
        evento => {
            if (evento.target?.closest?.("#confirmar-bloqueo-calendario")) {
                programar(40);
                return;
            }

            if (
                evento.target?.closest?.('[data-seccion="resumen"]') ||
                evento.target?.closest?.('[data-seccion="calendario"]') ||
                evento.target?.closest?.(".dia-calendario")
            ) {
                setTimeout(() => {
                    sincronizarDesdeSupabase().catch(() => {});
                }, 120);
            }
        },
        true
    );

    window.addEventListener("haiku:auth-ready", () => setTimeout(iniciar, 60));
    window.addEventListener("pageshow", () => setTimeout(iniciar, 40));
    window.addEventListener("focus", () => setTimeout(() => {
        sincronizarDesdeSupabase().catch(() => {});
    }, 80));

    setTimeout(iniciar, 150);

    window.HAIKU_BLOQUEOS_CALENDARIO_SUPABASE_V1 = Object.freeze({
        sincronizar: sincronizarBloqueosLegacy,
        refrescar: sincronizarDesdeSupabase,
        liberar: abrirModalLiberacion
    });
})();
