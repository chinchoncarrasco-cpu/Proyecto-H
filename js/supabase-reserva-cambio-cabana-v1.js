// ========================================
// HAIKU · RESERVA CON CAMBIO DE CABAÑA V1
// Una reserva -> 2+ tramos consecutivos en CAB distintas.
// Flujo manual tipo Cloudbeds: agrega tramo, vuelve a fechas, agrega el siguiente.
// Sin observers, intervalos, parches de clientes ni prototipos globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_RESERVA_CAMBIO_CABANA_V1) return;

    const sb = window.haikuSupabase;
    if (!sb) return;

    const $ = selector => document.querySelector(selector);
    const tramos = [];
    let tramosConfirmacion = [];
    let ocupacionBase = null;
    let guardando = false;
    let calendarioParcheado = false;

    function modoCrearAlojamiento() {
        let modo = "crear";
        try { modo = String(modoFormularioReserva || "crear"); } catch {}
        const fullDay = Boolean(
            document.querySelector('[data-haiku-tipo-estadia="fullday"].activo')
        );
        return modo === "crear" && !fullDay;
    }

    function fmtFecha(fecha) {
        try { return formatearFechaReserva(fecha); }
        catch {
            const [a,m,d] = String(fecha || "").split("-");
            return a && m && d ? `${d}-${m}-${a}` : String(fecha || "—");
        }
    }

    function fmtDinero(valor) {
        try { return formatearPrecioReserva(Number(valor || 0)); }
        catch { return `$${Number(valor || 0).toLocaleString("es-CL")}`; }
    }

    function sumar(fecha, dias) {
        try { return sumarDiasNuevaReserva(fecha, dias); }
        catch {
            const [a,m,d] = String(fecha).split("-").map(Number);
            const dt = new Date(a, m - 1, d, 12, 0, 0);
            dt.setDate(dt.getDate() + dias);
            return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
        }
    }

    function nochesEntre(inicio, fin) {
        try { return calcularNochesReserva(inicio, fin); }
        catch {
            const a = new Date(`${inicio}T12:00:00`);
            const b = new Date(`${fin}T12:00:00`);
            return Math.max(0, Math.round((b-a)/86400000));
        }
    }

    function totalTramo(tramo) {
        return Object.values(tramo?.tarifas || {}).reduce(
            (s, v) => s + Number(v || 0), 0
        );
    }

    function obtenerTramoActual() {
        let llegada = "", salida = "", cabana = "";
        let tarifas = {}, adultos = 1, ninos = 0, mascotas = 0;
        try { llegada = String(fechaLlegadaReserva || ""); } catch {}
        try { salida = String(fechaSalidaReserva || ""); } catch {}
        try { cabana = String(cabanaSeleccionadaReserva || ""); } catch {}
        try { tarifas = { ...(tarifasNochesReserva || {}) }; } catch {}
        try { adultos = Number(adultosReserva || 0); } catch {}
        try { ninos = Number(ninosReserva || 0); } catch {}
        try { mascotas = Number(mascotasReserva || 0); } catch {}

        if (!llegada || !salida || !cabana) {
            throw new Error("Selecciona primero las fechas y una cabaña para este alojamiento.");
        }

        const seleccionadas = document.querySelectorAll(
            "#lista-cabanas-disponibles .reserva-cabana-opcion.seleccionada[data-cabana]"
        );
        if (seleccionadas.length > 1) {
            throw new Error("Para un cambio de cabaña selecciona sólo una CAB por tramo.");
        }

        const n = nochesEntre(llegada, salida);
        if (n < 1) throw new Error("El tramo debe tener al menos una noche.");

        let catalogo = null;
        try { catalogo = catalogoCabanasReserva?.[cabana] || null; } catch {}
        if (!catalogo) throw new Error(`No pude encontrar la información de CAB ${cabana}.`);

        const tarifasFinales = {};
        for (let i=0; i<n; i++) {
            const fecha = sumar(llegada, i);
            const monto = Number(tarifas[fecha] ?? catalogo.precio ?? 0);
            if (!Number.isFinite(monto) || monto <= 0) {
                throw new Error(`Revisa la tarifa de la noche ${fmtFecha(fecha)}.`);
            }
            tarifasFinales[fecha] = Math.round(monto);
        }

        return {
            cabana: Number(cabana),
            nombre: catalogo.nombre || `CAB ${cabana}`,
            fecha_ingreso: llegada,
            fecha_salida: salida,
            noches: n,
            tarifas: tarifasFinales,
            adultos: Math.max(0, adultos),
            ninos: Math.max(0, ninos),
            mascotas: Math.max(0, mascotas)
        };
    }

    function validarContinuidad(nuevo) {
        if (!tramos.length) return;
        const anterior = tramos[tramos.length - 1];
        if (nuevo.fecha_ingreso !== anterior.fecha_salida) {
            throw new Error(
                `El siguiente alojamiento debe comenzar el ${fmtFecha(anterior.fecha_salida)} para no dejar huecos entre noches.`
            );
        }
        if (Number(nuevo.cabana) === Number(anterior.cabana)) {
            throw new Error(
                `El tramo anterior ya está en CAB ${nuevo.cabana}. Si continúa en la misma cabaña, usa un solo rango de fechas.`
            );
        }
    }

    function panelTramos() {
        let panel = $("#haiku-cambio-cabana-tramos");
        if (panel) return panel;
        const pasoFechas = $("#reserva-paso-fechas");
        const titulo = pasoFechas?.querySelector(".nueva-reserva-titulo");
        if (!pasoFechas) return null;

        panel = document.createElement("div");
        panel.id = "haiku-cambio-cabana-tramos";
        panel.className = "haiku-cambio-cabana-tramos";
        if (titulo?.nextSibling) titulo.parentNode.insertBefore(panel, titulo.nextSibling);
        else pasoFechas.prepend(panel);
        return panel;
    }

    function renderTramos() {
        const panel = panelTramos();
        if (!panel) return;
        if (!tramos.length) {
            panel.hidden = true;
            panel.innerHTML = "";
            return;
        }

        const total = tramos.reduce((s,t) => s + totalTramo(t), 0);
        panel.hidden = false;
        panel.innerHTML = `
            <div class="haiku-cambio-cabana-cabecera">
                <div>
                    <small>CAMBIO DE CABAÑA</small>
                    <strong>Alojamientos agregados</strong>
                </div>
                <span>${tramos.length} ${tramos.length === 1 ? "tramo" : "tramos"}</span>
            </div>
            <div class="haiku-cambio-cabana-lista"></div>
            <div class="haiku-cambio-cabana-total"><span>Subtotal guardado</span><strong>${fmtDinero(total)}</strong></div>
        `;

        const lista = panel.querySelector(".haiku-cambio-cabana-lista");
        tramos.forEach((tramo, indice) => {
            const fila = document.createElement("div");
            fila.className = "haiku-cambio-cabana-fila";
            fila.innerHTML = `
                <div>
                    <strong>${indice + 1}. CAB ${tramo.cabana} · ${tramo.nombre}</strong>
                    <span>${fmtFecha(tramo.fecha_ingreso)} → ${fmtFecha(tramo.fecha_salida)} · ${tramo.noches} ${tramo.noches === 1 ? "noche" : "noches"}</span>
                </div>
                <div class="haiku-cambio-cabana-fila-lateral">
                    <strong>${fmtDinero(totalTramo(tramo))}</strong>
                    <button type="button" data-haiku-quitar-tramo="${indice}" aria-label="Quitar tramo ${indice + 1}">Quitar</button>
                </div>`;
            lista.appendChild(fila);
        });
    }

    function asegurarBotonAgregar() {
        if ($("#haiku-agregar-otro-alojamiento")) return;
        const continuar = $("#continuar-reserva-detalles");
        const acciones = continuar?.closest(".nueva-reserva-acciones");
        if (!continuar || !acciones) return;

        const boton = document.createElement("button");
        boton.type = "button";
        boton.id = "haiku-agregar-otro-alojamiento";
        boton.className = "reserva-btn-secundario haiku-agregar-otro-alojamiento";
        boton.textContent = "+ Agregar otro alojamiento";
        acciones.insertBefore(boton, continuar);
    }

    function irASiguienteTramo() {
        const anterior = tramos[tramos.length - 1];
        $("#volver-reserva-fechas")?.click();

        try { fechaLlegadaReserva = anterior.fecha_salida; } catch {}
        try { fechaSalidaReserva = ""; } catch {}
        try { cabanaSeleccionadaReserva = ""; } catch {}
        try { tarifasNochesReserva = {}; } catch {}
        if (ocupacionBase) {
            try { adultosReserva = ocupacionBase.adultos; } catch {}
            try { ninosReserva = ocupacionBase.ninos; } catch {}
            try { mascotasReserva = ocupacionBase.mascotas; } catch {}
        }

        try { actualizarSeleccionCalendarioReserva(); } catch {}
        try { renderizarCalendarioNuevaReserva(); } catch {}
        renderTramos();
    }

    function agregarTramoTemporal() {
        if (!modoCrearAlojamiento()) return;
        try {
            const tramo = obtenerTramoActual();
            validarContinuidad(tramo);
            if (!ocupacionBase) {
                ocupacionBase = {
                    adultos: tramo.adultos,
                    ninos: tramo.ninos,
                    mascotas: tramo.mascotas
                };
            }
            tramos.push(tramo);
            tramosConfirmacion = [];
            renderTramos();
            irASiguienteTramo();
        } catch (error) {
            alert(error?.message || "No fue posible agregar este alojamiento.");
        }
    }

    function resumenDetalle(tramosFinales) {
        const cont = $("#reserva-cabana-seleccionada");
        if (!cont) return;
        const total = tramosFinales.reduce((s,t) => s + totalTramo(t), 0);
        const noches = tramosFinales.reduce((s,t) => s + Number(t.noches || 0), 0);
        const inicio = tramosFinales[0]?.fecha_ingreso;
        const fin = tramosFinales[tramosFinales.length - 1]?.fecha_salida;

        cont.innerHTML = `
            <div class="reserva-detalles-resumen haiku-cambio-cabana-resumen">
                <div class="haiku-cambio-cabana-resumen-titulo">
                    <strong>${tramosFinales.length} alojamientos · cambio de cabaña</strong>
                    <span>${fmtFecha(inicio)} → ${fmtFecha(fin)} · ${noches} ${noches === 1 ? "noche" : "noches"}</span>
                </div>
                <div class="haiku-cambio-cabana-resumen-lista">
                    ${tramosFinales.map((t,i) => `
                        <div>
                            <span>${i + 1}. CAB ${t.cabana} · ${t.nombre}</span>
                            <small>${fmtFecha(t.fecha_ingreso)} → ${fmtFecha(t.fecha_salida)} · ${fmtDinero(totalTramo(t))}</small>
                        </div>`).join("")}
                </div>
                <div class="reserva-detalles-total">
                    <span>Total</span><strong>${fmtDinero(total)}</strong>
                </div>
            </div>`;
    }

    function prepararDetallesFinales() {
        try {
            const ultimo = obtenerTramoActual();
            validarContinuidad(ultimo);
            const finales = [...tramos, ultimo];

            if (ocupacionBase) {
                try { adultosReserva = ocupacionBase.adultos; } catch {}
                try { ninosReserva = ocupacionBase.ninos; } catch {}
                try { mascotasReserva = ocupacionBase.mascotas; } catch {}
            }

            tramosConfirmacion = finales;
            mostrarPasoDetallesReserva();
            resumenDetalle(finales);

            const boton = $("#crear-nueva-reserva");
            if (boton) {
                boton.textContent = "Crear reserva con cambio de cabaña";
                boton.dataset.haikuCambioCabana = "1";
            }
        } catch (error) {
            alert(error?.message || "Revisa los alojamientos antes de continuar.");
        }
    }

    function datosFormulario() {
        return {
            titular: $("#reserva-nuevo-titular")?.value.trim() || "",
            telefono: $("#reserva-nuevo-telefono")?.value.trim() || "",
            rut: $("#reserva-nuevo-rut")?.value.trim() || "",
            correo: $("#reserva-nuevo-correo")?.value.trim() || "",
            observaciones: $("#reserva-nueva-observacion")?.value.trim() || "",
            acompanantes: [...document.querySelectorAll(".reserva-nuevo-acompanante")]
                .map(c => c.value.trim()).filter(Boolean)
        };
    }

    async function crearReservaCambioCabana(boton) {
        if (guardando || tramosConfirmacion.length < 2) return;
        const datos = datosFormulario();
        if (!datos.titular) {
            alert("Ingresa el nombre del titular de la reserva.");
            $("#reserva-nuevo-titular")?.focus();
            return;
        }
        const correo = $("#reserva-nuevo-correo");
        if (correo?.value.trim() && !correo.checkValidity()) {
            alert("Revisa que el correo esté escrito correctamente.");
            correo.focus();
            return;
        }
        if (!window.haikuTienePermiso?.("reservas.crear")) {
            alert("Tu usuario no tiene permiso para crear reservas.");
            return;
        }

        const texto = boton.textContent;
        guardando = true;
        boton.disabled = true;
        boton.textContent = "Creando reserva…";

        try {
            const base = ocupacionBase || { adultos: 1, ninos: 0, mascotas: 0 };
            const payload = tramosConfirmacion.map(t => ({
                cabana: Number(t.cabana),
                fecha_ingreso: t.fecha_ingreso,
                fecha_salida: t.fecha_salida,
                tarifas: { ...(t.tarifas || {}) }
            }));

            const { data, error } = await sb.rpc("haiku_crear_reserva_cambio_cabana", {
                p_titular_nombre: datos.titular,
                p_tramos: payload,
                p_adultos: Number(base.adultos || 0),
                p_ninos: Number(base.ninos || 0),
                p_mascotas: Number(base.mascotas || 0),
                p_correo_contacto: datos.correo || null,
                p_telefono_contacto: datos.telefono || null,
                p_rut: datos.rut || null,
                p_observaciones: datos.observaciones || null,
                p_acompanantes: datos.acompanantes,
                p_cloudbeds_id: null
            });
            if (error) throw error;
            if (!data?.reserva_id || Number(data?.cantidad_tramos || 0) !== payload.length) {
                throw new Error("Supabase no confirmó todos los alojamientos de la reserva.");
            }

            try { reservaCreadaId = String(data.reserva_id); } catch {}
            try { cabanaSeleccionadaReserva = String(payload[0].cabana); } catch {}
            try { fechaLlegadaReserva = String(payload[0].fecha_ingreso); } catch {}
            try { fechaSalidaReserva = String(payload[payload.length - 1].fecha_salida); } catch {}

            if (typeof window.haikuSincronizarReservasSupabase === "function") {
                await window.haikuSincronizarReservasSupabase();
            }
            try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}
            try { if (typeof generarCalendario === "function") generarCalendario(); } catch {}
            try { if (typeof cargarCabanasDia === "function") cargarCabanasDia(fechaSeleccionada, {
                evento: "cambio de cabaña confirmado", tipo: "externo"
            }); } catch {}

            const confirmacion = $("#reserva-paso-confirmacion");
            const resumen = $("#reserva-confirmacion-resumen");
            const paso3 = $("#reserva-paso-detalles");
            const titulo = confirmacion?.querySelector(".reserva-confirmacion-titulo strong");
            const subtitulo = confirmacion?.querySelector(".reserva-confirmacion-titulo span");
            if (titulo) titulo.textContent = "¡Reserva creada!";
            if (subtitulo) subtitulo.textContent = `${payload.length} alojamientos consecutivos fueron registrados en una sola reserva.`;

            if (resumen) {
                resumen.innerHTML = `
                    <div class="reserva-confirmacion-fila"><span>Alojamientos</span><strong>${payload.map(t => `CAB ${t.cabana}`).join(" → ")}</strong></div>
                    <div class="reserva-confirmacion-fila"><span>Fechas</span><strong>${fmtFecha(payload[0].fecha_ingreso)} → ${fmtFecha(payload[payload.length-1].fecha_salida)}</strong></div>
                    <div class="reserva-confirmacion-fila"><span>Titular</span><strong>${datos.titular}</strong></div>
                    <div class="reserva-confirmacion-fila"><span>Total alojamiento</span><strong class="reserva-confirmacion-total">${fmtDinero(data.total_alojamiento)}</strong></div>
                    <div class="reserva-confirmacion-id">${data.codigo_haiku || data.reserva_id}</div>`;
            }

            if (paso3) paso3.hidden = true;
            if (confirmacion) confirmacion.hidden = false;
            document.querySelectorAll(".reserva-paso").forEach(p =>
                p.classList.toggle("activo", p.dataset.paso === "4")
            );

            console.info("HAIKU · Reserva con cambio de cabaña creada:", data);
        } catch (error) {
            console.error("HAIKU · No fue posible crear reserva con cambio de cabaña:", error);
            alert(error?.message || "No fue posible crear la reserva. No se guardó ningún tramo.");
            boton.disabled = false;
            boton.textContent = texto;
        } finally {
            guardando = false;
        }
    }

    function resetear() {
        tramos.length = 0;
        tramosConfirmacion = [];
        ocupacionBase = null;
        guardando = false;
        renderTramos();
        const boton = $("#crear-nueva-reserva");
        if (boton?.dataset.haikuCambioCabana === "1") {
            delete boton.dataset.haikuCambioCabana;
            boton.textContent = "Crear reserva";
            boton.disabled = false;
        }
    }

    // ----------------------------------------
    // CALENDARIO: una misma reserva puede tener
    // varios tramos visuales. La modificación de
    // localStorage es temporal sólo durante render.
    // ----------------------------------------
    function instalarCalendarioMultitramo() {
        if (calendarioParcheado || typeof generarCalendario !== "function") return;
        const original = generarCalendario;

        const generar = function (...args) {
            const respaldo = localStorage.getItem("haikuDatos");
            let alterado = false;
            try {
                const datos = JSON.parse(respaldo || "{}");
                const originales = new Map();

                Object.entries(datos).forEach(([fecha,dia]) => {
                    Object.entries(dia?.cabanas || {}).forEach(([cab,c]) => {
                        if (!c?.reservaId || c.continuidadAutomatica === true) return;
                        const id = String(c.reservaId);
                        const origen = String(c.fechaOrigenReserva || c.fechaIngresoReserva || fecha).slice(0,10);
                        const clave = `${origen}::${cab}`;
                        if (!originales.has(id)) originales.set(id, new Set());
                        originales.get(id).add(clave);
                    });
                });

                const multiples = new Set(
                    [...originales.entries()].filter(([,set]) => set.size > 1).map(([id]) => id)
                );

                if (multiples.size) {
                    Object.entries(datos).forEach(([fecha,dia]) => {
                        Object.entries(dia?.cabanas || {}).forEach(([cab,c]) => {
                            if (!c?.reservaId || !multiples.has(String(c.reservaId))) return;
                            const real = String(c.reservaId);
                            const origen = String(c.fechaOrigenReserva || c.fechaIngresoReserva || fecha).slice(0,10);
                            c.reservaId = `${real}::TRAMO::${origen}::CAB${cab}`;
                        });
                    });
                    localStorage.setItem("haikuDatos", JSON.stringify(datos));
                    alterado = true;
                }
            } catch (error) {
                console.warn("HAIKU · No fue posible preparar tramos para Calendario:", error);
            }

            let resultado;
            try {
                resultado = original.apply(this, args);
            } finally {
                if (alterado) {
                    if (respaldo === null) localStorage.removeItem("haikuDatos");
                    else localStorage.setItem("haikuDatos", respaldo);
                }
            }

            document.querySelectorAll("[data-reserva-id*='::TRAMO::']").forEach(el => {
                const visual = String(el.dataset.reservaId || "");
                el.dataset.reservaId = visual.split("::TRAMO::")[0] || visual;
            });
            return resultado;
        };

        try { generarCalendario = generar; } catch (_) { window.generarCalendario = generar; }
        window.generarCalendario = generar;
        calendarioParcheado = true;
    }

    // ----------------------------------------
    // FICHA: mostrar recorrido completo y bloquear
    // edición antigua que sólo conoce una estadía.
    // ----------------------------------------
    function restaurarGuardFicha() {
        $("#haiku-ficha-cambio-cabana")?.remove();
        const editar = $("#ficha-reserva-editar");
        if (editar?.dataset.haikuCambioCabanaGuard === "1") {
            editar.disabled = editar.dataset.haikuCambioCabanaDisabledPrevio === "1";
            editar.textContent = editar.dataset.haikuCambioCabanaTextoPrevio || "✎ Editar reserva";
            editar.title = editar.dataset.haikuCambioCabanaTituloPrevio || "";
            delete editar.dataset.haikuCambioCabanaGuard;
            delete editar.dataset.haikuCambioCabanaDisabledPrevio;
            delete editar.dataset.haikuCambioCabanaTextoPrevio;
            delete editar.dataset.haikuCambioCabanaTituloPrevio;
        }
    }

    function reservaIdDeOperacion(fila) {
        if (!fila) return "";
        if (["libre-ingresa","sale-ingresa"].includes(fila.estado_operativo)) return fila.ingreso_reserva_id || "";
        if (fila.estado_operativo === "sale-libre") return fila.salida_reserva_id || "";
        if (fila.estado_operativo === "continua") return fila.continua_reserva_id || "";
        if (fila.estado_operativo === "fullday") return fila.fullday_reserva_id || "";
        return "";
    }

    async function leerFichaPorCabana(numero, fecha) {
        const { data: op, error: e1 } = await sb.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (e1) throw e1;
        const fila = (op || []).find(x => Number(x.numero) === Number(numero));
        const reservaId = reservaIdDeOperacion(fila);
        if (!reservaId) return null;
        const { data: core, error: e2 } = await sb.rpc("haiku_ficha_reserva_core", { p_reserva_id: reservaId });
        if (e2) throw e2;
        return core || null;
    }

    function decorarFicha(core) {
        const estadias = Array.isArray(core?.estadias)
            ? [...core.estadias].filter(e => !["cancelada","no_show"].includes(String(e.estado_estadia || "")))
                .sort((a,b) => String(a.fecha_ingreso).localeCompare(String(b.fecha_ingreso)))
            : [];
        if (estadias.length < 2) return;

        const inicio = String(estadias[0].fecha_ingreso).slice(0,10);
        const fin = String(estadias[estadias.length-1].fecha_salida).slice(0,10);
        const noches = estadias.reduce((s,e) => s + nochesEntre(e.fecha_ingreso,e.fecha_salida), 0);
        const ruta = estadias.map(e => `CAB ${e.cabana_numero}`).join(" → ");

        const mapa = {
            "ficha-reserva-cabana": ruta,
            "ficha-reserva-ingreso": fmtFecha(inicio),
            "ficha-reserva-salida": fmtFecha(fin),
            "ficha-reserva-noches": noches === 1 ? "◷ 1 noche" : `◷ ${noches} noches`
        };
        Object.entries(mapa).forEach(([id,texto]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = texto;
        });

        let panel = $("#haiku-ficha-cambio-cabana");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "haiku-ficha-cambio-cabana";
            panel.className = "haiku-ficha-cambio-cabana";
            const cabecera = $("#ficha-reserva-modal .ficha-reserva-cabecera") || $("#ficha-reserva-modal");
            cabecera?.insertAdjacentElement("afterend", panel);
        }
        if (panel) {
            panel.innerHTML = `
                <div><small>CAMBIO DE CABAÑA</small><strong>${ruta}</strong></div>
                <div class="haiku-ficha-cambio-cabana-tramos">
                    ${estadias.map((e,i) => `<span>${i+1}. CAB ${e.cabana_numero} · ${fmtFecha(e.fecha_ingreso)} → ${fmtFecha(e.fecha_salida)}</span>`).join("")}
                </div>`;
        }

        const editar = $("#ficha-reserva-editar");
        if (editar && editar.dataset.haikuCambioCabanaGuard !== "1") {
            editar.dataset.haikuCambioCabanaGuard = "1";
            editar.dataset.haikuCambioCabanaDisabledPrevio = editar.disabled ? "1" : "0";
            editar.dataset.haikuCambioCabanaTextoPrevio = editar.textContent || "✎ Editar reserva";
            editar.dataset.haikuCambioCabanaTituloPrevio = editar.title || "";
            editar.disabled = true;
            editar.textContent = "✎ Edición por tramos protegida";
            editar.title = "Esta reserva tiene varias cabañas. La edición estructural por tramos se habilitará en una etapa posterior.";
        }
    }

    async function prepararSoporteFicha(numero, fecha) {
        try {
            const core = await leerFichaPorCabana(numero, fecha);
            if (!core) return;
            decorarFicha(core);
            setTimeout(() => decorarFicha(core), 320);
        } catch (error) {
            console.warn("HAIKU · No fue posible revisar cambio de cabaña en ficha:", error);
        }
    }

    asegurarBotonAgregar();
    renderTramos();
    instalarCalendarioMultitramo();

    document.addEventListener("click", evento => {
        if (evento.target.closest?.("#haiku-agregar-otro-alojamiento")) {
            evento.preventDefault();
            agregarTramoTemporal();
            return;
        }

        const quitar = evento.target.closest?.("[data-haiku-quitar-tramo]");
        if (quitar) {
            const indice = Number(quitar.dataset.haikuQuitarTramo);
            if (Number.isInteger(indice) && indice >= 0 && indice < tramos.length) {
                tramos.splice(indice, 1);
                if (!tramos.length) ocupacionBase = null;
                tramosConfirmacion = [];
                renderTramos();
            }
            return;
        }

        if (evento.target.closest?.("#boton-nueva-reserva, #crear-otra-reserva, #cerrar-nueva-reserva, #cancelar-nueva-reserva")) {
            resetear();
            return;
        }

        const ficha = evento.target.closest?.("[data-ficha-cabana]");
        if (ficha) {
            restaurarGuardFicha();
            const numero = ficha.dataset.fichaCabana;
            let fecha = "";
            try { fecha = String(fechaSeleccionada || "").slice(0,10); } catch {}
            if (numero && fecha) prepararSoporteFicha(numero, fecha);
        }
    }, true);

    document.addEventListener("click", evento => {
        if (!evento.target.closest?.("#continuar-reserva-detalles")) return;
        if (!modoCrearAlojamiento() || tramos.length < 1) return;
        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
        prepararDetallesFinales();
    }, true);

    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.("#crear-nueva-reserva[data-haiku-cambio-cabana='1']");
        if (!boton || !modoCrearAlojamiento() || tramosConfirmacion.length < 2) return;
        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
        crearReservaCambioCabana(boton);
    }, true);

    window.HAIKU_RESERVA_CAMBIO_CABANA_V1 = Object.freeze({
        estado: () => ({
            tramos: tramos.map(t => ({ ...t, tarifas: { ...t.tarifas } })),
            tramosConfirmacion: tramosConfirmacion.map(t => ({ ...t, tarifas: { ...t.tarifas } }))
        })
    });

    console.info("HAIKU · Reserva con cambio de cabaña V1 preparada.");
})();
