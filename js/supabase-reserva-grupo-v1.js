// ========================================
// HAIKU · RESERVAS VINCULADAS · V1
// Indicador discreto de grupo en Resumen y ficha de reserva.
// Finanzas agrupadas: todas las CAB del mismo grupo muestran
// el total, abonos y saldo conjunto del titular.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let refrescandoResumen = false;
    let ultimoRefresco = 0;

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function dinero(valor) {
        return `$${Number(valor || 0).toLocaleString("es-CL")}`;
    }

    function reservaIdDeFila(fila) {
        if (!fila) return "";
        if (["libre-ingresa", "sale-ingresa"].includes(fila.estado_operativo)) {
            return fila.ingreso_reserva_id || "";
        }
        if (fila.estado_operativo === "sale-libre") return fila.salida_reserva_id || "";
        if (fila.estado_operativo === "continua") return fila.continua_reserva_id || "";
        if (fila.estado_operativo === "fullday") return fila.fullday_reserva_id || "";
        return "";
    }

    async function operacionDia(fecha) {
        if (!fecha) return [];
        const { data, error } = await cliente.rpc("haiku_operacion_dia", {
            p_fecha: fecha
        });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    async function reservaDeCabana(numeroCabana, fecha) {
        const filas = await operacionDia(fecha);
        const fila = filas.find(item => Number(item.numero) === Number(numeroCabana));
        return {
            fila: fila || null,
            reservaId: reservaIdDeFila(fila)
        };
    }

    async function grupoDeReserva(reservaId) {
        if (!reservaId) return null;

        const { data: actual, error } = await cliente
            .from("reservas")
            .select("id,grupo_reserva_id,titular_nombre")
            .eq("id", reservaId)
            .maybeSingle();

        if (error) throw error;
        if (!actual?.grupo_reserva_id) return null;

        const { data: reservas, error: errorReservas } = await cliente
            .from("reservas")
            .select("id,grupo_reserva_id,titular_nombre,estado_reserva")
            .eq("grupo_reserva_id", actual.grupo_reserva_id)
            .order("creado_en", { ascending: true });

        if (errorReservas) throw errorReservas;

        const ids = (reservas || []).map(r => r.id).filter(Boolean);
        if (ids.length < 2) return null;

        const { data: estadias, error: errorEstadias } = await cliente
            .from("reserva_estadias")
            .select("reserva_id,fecha_ingreso,fecha_salida,cabanas(numero,nombre)")
            .in("reserva_id", ids);

        if (errorEstadias) throw errorEstadias;

        const estadiaPorReserva = new Map();
        (estadias || []).forEach(estadia => {
            if (!estadiaPorReserva.has(estadia.reserva_id)) {
                estadiaPorReserva.set(estadia.reserva_id, estadia);
            }
        });

        const miembros = (reservas || []).map(reserva => {
            const estadia = estadiaPorReserva.get(reserva.id) || {};
            const cabana = estadia.cabanas || {};
            return {
                reservaId: reserva.id,
                titular: reserva.titular_nombre || actual.titular_nombre || "",
                estado: reserva.estado_reserva || "",
                numeroCabana: Number(cabana.numero || 0),
                nombreCabana: cabana.nombre || "",
                fechaIngreso: estadia.fecha_ingreso || "",
                fechaSalida: estadia.fecha_salida || ""
            };
        }).filter(item => item.numeroCabana > 0)
          .sort((a, b) => a.numeroCabana - b.numeroCabana);

        if (miembros.length < 2) return null;

        return {
            id: actual.grupo_reserva_id,
            titular: actual.titular_nombre || "",
            miembros
        };
    }

    async function finanzasDeGrupo(grupo) {
        const ids = (grupo?.miembros || []).map(m => m.reservaId).filter(Boolean);
        if (ids.length < 2) return null;

        const { data, error } = await cliente
            .from("vista_estado_cargos")
            .select("reserva_id,tipo_cargo,estado,monto_ajustado,aplicado_neto,saldo_cargo")
            .in("reserva_id", ids)
            .eq("estado", "activo");

        if (error) throw error;

        const cargos = Array.isArray(data) ? data : [];
        const alojamiento = cargos.filter(c => c.tipo_cargo === "alojamiento");
        const servicios = cargos.filter(c => c.tipo_cargo === "servicio");
        const sumar = (lista, campo) => lista.reduce(
            (total, item) => total + Number(item?.[campo] || 0),
            0
        );

        return {
            total: sumar(alojamiento, "monto_ajustado"),
            abono: sumar(alojamiento, "aplicado_neto"),
            saldo: sumar(alojamiento, "saldo_cargo"),
            servicios: sumar(servicios, "saldo_cargo")
        };
    }

    function etiquetaPago(id, texto) {
        const valor = document.getElementById(id);
        if (!valor) return;
        const contenedor = valor.parentElement;
        const etiqueta = contenedor?.querySelector("span");
        if (etiqueta) etiqueta.textContent = texto;
    }

    function restaurarFinanzasFicha() {
        document.getElementById("haiku-ficha-finanzas-grupo")?.remove();
        etiquetaPago("ficha-pago-total", "Total reserva");
        etiquetaPago("ficha-pago-abono", "Abono");
        etiquetaPago("ficha-pago-saldo", "Saldo");
        etiquetaPago("ficha-pago-servicios", "Servicios pendientes");
    }

    async function pintarFinanzasGrupo(grupo) {
        const finanzas = await finanzasDeGrupo(grupo);
        if (!finanzas) return;

        const valores = {
            "ficha-pago-total": finanzas.total,
            "ficha-pago-abono": finanzas.abono,
            "ficha-pago-saldo": finanzas.saldo,
            "ficha-pago-servicios": finanzas.servicios
        };

        Object.entries(valores).forEach(([id, valor]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = dinero(valor);
        });

        etiquetaPago("ficha-pago-total", "Total grupo");
        etiquetaPago("ficha-pago-abono", "Abono grupo");
        etiquetaPago("ficha-pago-saldo", "Saldo grupo");
        etiquetaPago("ficha-pago-servicios", "Servicios grupo");

        const total = document.getElementById("ficha-pago-total");
        const zona = total?.closest(".ficha-pagos-resumen") || total?.parentElement?.parentElement;
        if (zona && !document.getElementById("haiku-ficha-finanzas-grupo")) {
            const nota = document.createElement("div");
            nota.id = "haiku-ficha-finanzas-grupo";
            nota.style.cssText = "grid-column:1/-1;font-size:10px;color:#66716b;padding:0 2px 3px;text-align:left;";
            nota.textContent = `↳ Totales de ${grupo.miembros.length} alojamientos vinculados`;
            zona.insertAdjacentElement("afterbegin", nota);
        }
    }

    function limpiarMarcasResumen() {
        document.querySelectorAll(".haiku-reserva-grupo-marca").forEach(el => el.remove());
    }

    async function refrescarResumen({ forzar = false } = {}) {
        const ahora = Date.now();
        if (refrescandoResumen) return;
        if (!forzar && ahora - ultimoRefresco < 500) return;

        const fecha = fechaActual();
        if (!fecha || !window.haikuSesion) return;

        refrescandoResumen = true;
        ultimoRefresco = ahora;

        try {
            const filas = await operacionDia(fecha);
            const pares = filas
                .map(fila => ({
                    numero: Number(fila.numero),
                    reservaId: reservaIdDeFila(fila)
                }))
                .filter(item => item.numero && item.reservaId);

            limpiarMarcasResumen();
            if (pares.length === 0) return;

            const ids = [...new Set(pares.map(item => item.reservaId))];
            const { data: reservas, error } = await cliente
                .from("reservas")
                .select("id,grupo_reserva_id")
                .in("id", ids);

            if (error) throw error;

            const grupoPorReserva = new Map(
                (reservas || [])
                    .filter(r => r.grupo_reserva_id)
                    .map(r => [String(r.id), String(r.grupo_reserva_id)])
            );

            pares.forEach(({ numero, reservaId }) => {
                if (!grupoPorReserva.has(String(reservaId))) return;

                const titular = document.querySelector(
                    `#seccion-resumen .sites-resumen-cabana[data-cabana="${numero}"] .titular-cabana`
                );
                if (!titular || titular.previousElementSibling?.classList?.contains("haiku-reserva-grupo-marca")) {
                    return;
                }

                const marca = document.createElement("span");
                marca.className = "haiku-reserva-grupo-marca";
                marca.textContent = "↳";
                marca.title = "Esta cabaña pertenece a una reserva conjunta";
                marca.setAttribute("aria-label", "Reserva conjunta");
                titular.parentNode?.insertBefore(marca, titular);
            });
        } catch (error) {
            console.warn("HAIKU · No fue posible pintar grupos en Resumen:", error);
        } finally {
            refrescandoResumen = false;
        }
    }

    function quitarGrupoFicha() {
        document.getElementById("haiku-ficha-reserva-grupo")?.remove();
    }

    async function pintarGrupoFicha(numeroCabana, fecha) {
        quitarGrupoFicha();
        restaurarFinanzasFicha();
        if (!numeroCabana || !fecha || !window.haikuSesion) return;

        try {
            const { reservaId } = await reservaDeCabana(numeroCabana, fecha);
            if (!reservaId) return;

            const grupo = await grupoDeReserva(reservaId);
            if (!grupo) return;

            const cabecera = document.querySelector("#ficha-reserva-modal .ficha-reserva-cabecera > div");
            const titulo = cabecera?.querySelector(".ficha-reserva-titulo");
            if (!cabecera || !titulo) return;

            const panel = document.createElement("div");
            panel.id = "haiku-ficha-reserva-grupo";
            panel.className = "haiku-ficha-reserva-grupo";

            const etiqueta = document.createElement("span");
            etiqueta.className = "haiku-ficha-reserva-grupo-etiqueta";
            etiqueta.textContent = "↳ Reserva conjunta";
            etiqueta.title = "Alojamientos vinculados al mismo titular";

            const lista = document.createElement("div");
            lista.className = "haiku-ficha-reserva-grupo-lista";

            grupo.miembros.forEach(miembro => {
                if (Number(miembro.numeroCabana) === Number(numeroCabana)) {
                    const actual = document.createElement("span");
                    actual.className = "haiku-ficha-reserva-grupo-cab actual";
                    actual.textContent = `CAB ${miembro.numeroCabana}`;
                    lista.appendChild(actual);
                    return;
                }

                const boton = document.createElement("button");
                boton.type = "button";
                boton.className = "haiku-ficha-reserva-grupo-cab";
                boton.dataset.fichaCabana = String(miembro.numeroCabana);
                boton.textContent = `CAB ${miembro.numeroCabana}`;
                boton.title = `Abrir ficha CAB ${miembro.numeroCabana}`;
                lista.appendChild(boton);
            });

            panel.append(etiqueta, lista);
            titulo.insertAdjacentElement("afterend", panel);
            await pintarFinanzasGrupo(grupo);
        } catch (error) {
            console.warn("HAIKU · No fue posible mostrar reserva conjunta en ficha:", error);
        }
    }

    /* Captura antes del handler de Ficha V2, que usa stopImmediatePropagation. */
    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.("[data-ficha-cabana]");
        if (!boton || !window.haikuSesion) return;
        const numero = boton.dataset.fichaCabana;
        const fecha = fechaActual();
        setTimeout(() => pintarGrupoFicha(numero, fecha), 240);
        /* Segundo pase: garantiza que Ficha V2 haya terminado de pintar pagos. */
        setTimeout(() => pintarGrupoFicha(numero, fecha), 760);
    }, true);

    document.addEventListener("click", evento => {
        if (!evento.target.closest?.('[data-seccion="resumen"], #mes-anterior, #mes-siguiente, .reserva-dia, .boton-calendario')) return;
        setTimeout(() => refrescarResumen({ forzar: true }), 180);
    });

    document.addEventListener("change", evento => {
        if (!evento.target.closest?.(".campo-cabana")) return;
        setTimeout(() => refrescarResumen({ forzar: true }), 180);
    });

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(() => refrescarResumen({ forzar: true }), 260);
    });

    window.addEventListener("load", () => {
        setTimeout(() => refrescarResumen({ forzar: true }), 420);
    });

    window.HAIKU_RESERVA_GRUPO_V1 = {
        refrescarResumen,
        pintarGrupoFicha,
        grupoDeReserva,
        finanzasDeGrupo
    };

    console.info("HAIKU · Reservas vinculadas V1 preparadas.");
})();
