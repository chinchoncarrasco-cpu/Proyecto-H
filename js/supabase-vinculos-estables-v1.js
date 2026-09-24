// ========================================
// HAIKU · VÍNCULOS ESTABLES V1
// Una sola capa visual para el indicador ↳ en:
// - Resumen
// - Calendario
// - Panel pequeño +N del calendario
// - Ficha rápida
//
// También corrige el contexto visual de una reserva multitramos
// según la CAB y fecha realmente abiertas.
//
// Sin MutationObserver, sin intervalos, sin parches de Supabase,
// fetch, EventTarget ni prototipos globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_VINCULOS_ESTABLES_V1) return;

    const sb = window.haikuSupabase;
    if (!sb) return;

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const ESTADOS_INACTIVOS = new Set(["cancelada", "no_show"]);

    let tokenResumen = 0;
    let tokenCalendario = 0;
    let tokenFicha = 0;
    let refrescoProgramado = false;

    function fechaSeleccionadaActual() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function normalizarReservaId(valor) {
        return String(valor || "").split("::TRAMO::")[0].trim();
    }

    function idsUuid(lista) {
        return [...new Set((lista || []).map(normalizarReservaId).filter(id => UUID_RE.test(id)))];
    }

    function reservaIdDeFila(fila) {
        if (!fila) return "";
        if (["libre-ingresa", "sale-ingresa"].includes(String(fila.estado_operativo || ""))) {
            return fila.ingreso_reserva_id || "";
        }
        if (fila.estado_operativo === "sale-libre") return fila.salida_reserva_id || "";
        if (fila.estado_operativo === "continua") return fila.continua_reserva_id || "";
        if (fila.estado_operativo === "fullday") return fila.fullday_reserva_id || "";
        return "";
    }

    async function operacionDia(fecha) {
        if (!fecha) return [];
        const { data, error } = await sb.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    async function mapaVinculos(reservaIds) {
        const ids = idsUuid(reservaIds);
        const salida = new Map(ids.map(id => [id, false]));
        if (!ids.length) return salida;

        const [reservasR, estadiasR] = await Promise.all([
            sb
                .from("reservas")
                .select("id,grupo_reserva_id,estado_reserva")
                .in("id", ids),
            sb
                .from("reserva_estadias")
                .select("reserva_id,estado_estadia")
                .in("reserva_id", ids)
        ]);

        if (reservasR.error) throw reservasR.error;
        if (estadiasR.error) throw estadiasR.error;

        const conteoEstadias = new Map();
        (estadiasR.data || []).forEach(e => {
            if (ESTADOS_INACTIVOS.has(String(e.estado_estadia || ""))) return;
            const id = String(e.reserva_id || "");
            if (!id) return;
            conteoEstadias.set(id, (conteoEstadias.get(id) || 0) + 1);
        });

        conteoEstadias.forEach((cantidad, id) => {
            if (cantidad >= 2 && salida.has(id)) salida.set(id, true);
        });

        const grupoPorReserva = new Map();
        const grupos = new Set();
        (reservasR.data || []).forEach(r => {
            if (ESTADOS_INACTIVOS.has(String(r.estado_reserva || ""))) return;
            if (!r.grupo_reserva_id) return;
            const id = String(r.id || "");
            const grupoId = String(r.grupo_reserva_id || "");
            if (!id || !grupoId) return;
            grupoPorReserva.set(id, grupoId);
            grupos.add(grupoId);
        });

        if (grupos.size) {
            const { data: miembros, error } = await sb
                .from("reservas")
                .select("id,grupo_reserva_id,estado_reserva")
                .in("grupo_reserva_id", [...grupos]);
            if (error) throw error;

            const conteoGrupo = new Map();
            (miembros || []).forEach(r => {
                if (ESTADOS_INACTIVOS.has(String(r.estado_reserva || ""))) return;
                const grupoId = String(r.grupo_reserva_id || "");
                if (!grupoId) return;
                conteoGrupo.set(grupoId, (conteoGrupo.get(grupoId) || 0) + 1);
            });

            grupoPorReserva.forEach((grupoId, reservaId) => {
                if ((conteoGrupo.get(grupoId) || 0) >= 2 && salida.has(reservaId)) {
                    salida.set(reservaId, true);
                }
            });
        }

        return salida;
    }

    function crearMarca(zona) {
        const marca = document.createElement("span");
        marca.className = "haiku-vinculo-estable-marca";
        marca.dataset.haikuVinculoZona = zona;
        marca.textContent = "↳";
        marca.title = "Reserva vinculada";
        marca.setAttribute("aria-label", "Reserva vinculada");
        return marca;
    }

    function limpiarZona(zona, contenedor = document) {
        contenedor
            .querySelectorAll(`.haiku-vinculo-estable-marca[data-haiku-vinculo-zona="${zona}"]`)
            .forEach(el => el.remove());
    }

    async function pintarResumen() {
        const fecha = fechaSeleccionadaActual();
        if (!fecha || !window.haikuSesion) return;

        const miToken = ++tokenResumen;

        try {
            const filas = await operacionDia(fecha);
            if (miToken !== tokenResumen || fecha !== fechaSeleccionadaActual()) return;

            const pares = filas
                .map(fila => ({
                    numero: Number(fila.numero || 0),
                    reservaId: normalizarReservaId(reservaIdDeFila(fila))
                }))
                .filter(item => item.numero > 0 && UUID_RE.test(item.reservaId));

            const vinculados = await mapaVinculos(pares.map(p => p.reservaId));
            if (miToken !== tokenResumen || fecha !== fechaSeleccionadaActual()) return;

            const seccion = document.getElementById("seccion-resumen") || document;
            limpiarZona("resumen", seccion);

            pares.forEach(({ numero, reservaId }) => {
                if (!vinculados.get(reservaId)) return;

                const fila = seccion.querySelector(`.sites-resumen-cabana[data-cabana="${numero}"]`);
                const titular = fila?.querySelector(".titular-cabana");
                if (!fila || !titular) return;

                const textoTitular = String(titular.textContent || "").trim();
                if (!textoTitular || /^sin titular$/i.test(textoTitular)) return;

                const marca = crearMarca("resumen");
                titular.parentNode?.insertBefore(marca, titular);
            });
        } catch (error) {
            console.warn("HAIKU · No fue posible pintar vínculos estables en Resumen:", error);
        }
    }

    async function pintarCalendarioYPanel() {
        if (!window.haikuSesion) return;
        const miToken = ++tokenCalendario;

        const elementos = [...document.querySelectorAll(
            ".calendario-reserva-barra[data-reserva-id], .calendario-panel-reserva[data-reserva-id]"
        )];

        limpiarZona("calendario");
        limpiarZona("panel-calendario");
        if (!elementos.length) return;

        const ids = idsUuid(elementos.map(el => el.dataset.reservaId));
        if (!ids.length) return;

        try {
            const vinculados = await mapaVinculos(ids);
            if (miToken !== tokenCalendario) return;

            elementos.forEach(el => {
                if (!el.isConnected) return;
                const reservaId = normalizarReservaId(el.dataset.reservaId);
                if (!vinculados.get(reservaId)) return;

                const esPanel = el.classList.contains("calendario-panel-reserva");
                const texto = String(el.textContent || "").trim();

                if (!esPanel && !texto) return;

                const zona = esPanel ? "panel-calendario" : "calendario";
                const marca = crearMarca(zona);
                el.prepend(marca);
            });
        } catch (error) {
            console.warn("HAIKU · No fue posible pintar vínculos estables en Calendario:", error);
        }
    }

    function formatearFecha(fecha) {
        const [a, m, d] = String(fecha || "").slice(0, 10).split("-");
        return a && m && d ? `${d}-${m}-${a.slice(-2)}` : String(fecha || "—");
    }

    function nochesEntre(inicio, fin) {
        const a = new Date(`${String(inicio || "").slice(0, 10)}T12:00:00`);
        const b = new Date(`${String(fin || "").slice(0, 10)}T12:00:00`);
        if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return 0;
        return Math.max(0, Math.round((b - a) / 86400000));
    }

    function estadiasActivas(core) {
        return (Array.isArray(core?.estadias) ? core.estadias : []).filter(
            e => !ESTADOS_INACTIVOS.has(String(e?.estado_estadia || ""))
        );
    }

    function seleccionarEstadia(core, numeroCabana, fecha) {
        const activas = estadiasActivas(core);
        const numero = Number(numeroCabana || 0);
        const dia = String(fecha || "").slice(0, 10);

        return activas.find(e => {
            if (Number(e?.cabana_numero) !== numero) return false;
            const ingreso = String(e?.fecha_ingreso || "").slice(0, 10);
            const salida = String(e?.fecha_salida || "").slice(0, 10);
            return dia && ingreso && salida && dia >= ingreso && dia < salida;
        }) || activas.find(e => Number(e?.cabana_numero) === numero) || null;
    }

    function aplicarContextoFicha(reservaId, estadia, miToken) {
        if (!estadia || miToken !== tokenFicha) return;

        const modal = document.getElementById("ficha-reserva-modal");
        if (!modal || modal.hidden) return;
        if (String(modal.dataset.reservaId || "") !== String(reservaId || "")) return;

        const numero = Number(estadia.cabana_numero || 0);
        const ingreso = String(estadia.fecha_ingreso || "").slice(0, 10);
        const salida = String(estadia.fecha_salida || "").slice(0, 10);
        const cantidadNoches = estadia.tipo_estadia === "fullday" ? 0 : nochesEntre(ingreso, salida);

        const cabana = document.getElementById("ficha-reserva-cabana");
        const campoIngreso = document.getElementById("ficha-reserva-ingreso");
        const campoSalida = document.getElementById("ficha-reserva-salida");
        const campoNoches = document.getElementById("ficha-reserva-noches");

        if (cabana) cabana.textContent = `CAB ${numero}`;
        if (campoIngreso) campoIngreso.textContent = formatearFecha(ingreso);
        if (campoSalida) campoSalida.textContent = formatearFecha(salida);
        if (campoNoches) {
            campoNoches.textContent = estadia.tipo_estadia === "fullday"
                ? "Full Day"
                : cantidadNoches === 1
                    ? "◷ 1 noche"
                    : `◷ ${cantidadNoches} noches`;
        }

        modal.dataset.numeroCabana = String(numero);
        if (estadia.id) modal.dataset.estadiaId = String(estadia.id);
        modal.dataset.haikuContextoTramo = "1";
    }

    async function pintarMarcaFicha(reservaId, miToken) {
        if (miToken !== tokenFicha) return;
        try {
            const vinculados = await mapaVinculos([reservaId]);
            if (miToken !== tokenFicha) return;

            const modal = document.getElementById("ficha-reserva-modal");
            if (!modal || modal.hidden || String(modal.dataset.reservaId || "") !== String(reservaId)) return;

            limpiarZona("ficha", modal);
            if (!vinculados.get(String(reservaId))) return;

            const titulo = modal.querySelector(".ficha-reserva-titulo");
            if (!titulo) return;
            titulo.prepend(crearMarca("ficha"));
        } catch (error) {
            console.warn("HAIKU · No fue posible pintar vínculo estable en ficha:", error);
        }
    }

    async function contextualizarFicha(numeroCabana, fecha) {
        const miToken = ++tokenFicha;
        const numero = Number(numeroCabana || 0);
        const dia = String(fecha || "").slice(0, 10);
        if (!numero || !dia || !window.haikuSesion) return;

        try {
            const filas = await operacionDia(dia);
            if (miToken !== tokenFicha) return;

            const fila = filas.find(item => Number(item.numero) === numero);
            const reservaId = normalizarReservaId(reservaIdDeFila(fila));
            if (!UUID_RE.test(reservaId)) return;

            const { data: core, error } = await sb.rpc("haiku_ficha_reserva_core", {
                p_reserva_id: reservaId
            });
            if (error) throw error;
            if (miToken !== tokenFicha) return;

            const estadia = seleccionarEstadia(core, numero, dia);
            if (!estadia) return;

            const esMultitramo = estadiasActivas(core).length >= 2;
            const inicioEspera = performance.now();

            const esperarFichaLista = () => {
                if (miToken !== tokenFicha) return;

                const modal = document.getElementById("ficha-reserva-modal");
                const modalCorrecto = modal && !modal.hidden &&
                    String(modal.dataset.reservaId || "") === reservaId;

                if (modalCorrecto) {
                    aplicarContextoFicha(reservaId, estadia, miToken);
                    pintarMarcaFicha(reservaId, miToken);

                    if (esMultitramo) {
                        [380, 900].forEach(demora => {
                            setTimeout(() => {
                                if (miToken !== tokenFicha) return;
                                aplicarContextoFicha(reservaId, estadia, miToken);
                                pintarMarcaFicha(reservaId, miToken);
                            }, demora);
                        });
                    }
                    return;
                }

                if (performance.now() - inicioEspera < 5000) {
                    requestAnimationFrame(esperarFichaLista);
                }
            };

            requestAnimationFrame(esperarFichaLista);
        } catch (error) {
            console.warn("HAIKU · No fue posible contextualizar la ficha vinculada:", error);
        }
    }

    function programarRefresco() {
        if (refrescoProgramado) return;
        refrescoProgramado = true;
        requestAnimationFrame(() => {
            refrescoProgramado = false;
            pintarResumen();
            pintarCalendarioYPanel();

            const modal = document.getElementById("ficha-reserva-modal");
            const reservaId = normalizarReservaId(modal?.dataset?.reservaId);
            if (modal && !modal.hidden && UUID_RE.test(reservaId)) {
                pintarMarcaFicha(reservaId, tokenFicha);
            }
        });
    }

    window.addEventListener("click", evento => {
        const boton = evento.target.closest?.("[data-ficha-cabana]");
        if (!boton || !window.haikuSesion) return;

        const numero = Number(boton.dataset.fichaCabana || 0);
        const fecha = fechaSeleccionadaActual();
        if (numero > 0 && fecha) contextualizarFicha(numero, fecha);
    }, true);

    document.addEventListener("click", evento => {
        if (evento.target.closest?.(
            '.menu-item[data-seccion="resumen"], .menu-item[data-seccion="calendario"], #mes-anterior, #mes-siguiente, .dia-calendario, .calendario-mas-reservas, .calendario-panel-cerrar'
        )) {
            programarRefresco();
        }
    });

    document.addEventListener("change", evento => {
        if (evento.target.closest?.(".campo-cabana")) programarRefresco();
    });

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(programarRefresco, 260);
        setTimeout(programarRefresco, 1100);
    });

    window.addEventListener("load", () => {
        setTimeout(programarRefresco, 500);
    });

    window.HAIKU_VINCULOS_ESTABLES_V1 = Object.freeze({
        refrescar: programarRefresco,
        refrescarResumen: pintarResumen,
        refrescarCalendario: pintarCalendarioYPanel,
        contextualizarFicha
    });

    console.info("HAIKU · Vínculos estables V1 preparados.");
})();
