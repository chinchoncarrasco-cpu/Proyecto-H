// ========================================
// HAIKU · AJUSTES DE CARGO · SUPABASE V2
// Exención IVA extranjero y cargos 10%.
// Las reservas conjuntas se tratan como una sola unidad financiera.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let canal = null;
    let instalado = false;
    let guardando = false;
    let reservaSeleccionada = "";
    let tipoSeleccionado = "";
    let resumenActual = null;

    const TIPOS = Object.freeze({
        iva_exento: {
            titulo: "Exención IVA extranjero",
            detalle: "Descuenta el IVA incluido del alojamiento.",
            etiqueta: "IVA incluido a descontar",
            signo: -1
        },
        cargo_cancelacion: {
            titulo: "Cargo 10% · Cancelación",
            detalle: "Añade un 10% sobre el total original del alojamiento.",
            etiqueta: "Cargo a añadir",
            signo: 1
        },
        cargo_modificacion: {
            titulo: "Cargo 10% · Modificación",
            detalle: "Añade un 10% sobre el total original del alojamiento.",
            etiqueta: "Cargo a añadir",
            signo: 1
        }
    });

    const dinero = valor => `$${Math.round(Number(valor || 0)).toLocaleString("es-CL")}`;

    function escapar(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function cabsActuales() {
        return (resumenActual?.miembros || [])
            .map(m => Number(m.cabana || 0))
            .filter(Boolean)
            .sort((a,b) => a-b);
    }

    function calcularVistaPrevia() {
        if (!resumenActual || !tipoSeleccionado) return null;

        const original = Number(resumenActual.total_alojamiento_original || 0);
        const actual = Number(resumenActual.total_cargos_ajustado || 0);
        if (original <= 0) return null;

        const monto = tipoSeleccionado === "iva_exento"
            ? original - Math.round(original / 1.19)
            : Math.round(original * 0.10);

        const signo = TIPOS[tipoSeleccionado]?.signo || 1;

        return {
            original,
            actual,
            monto,
            nuevoTotal: actual + signo * monto,
            saldoActual: Number(resumenActual.saldo || 0),
            pagado: Number(resumenActual.total_pagado_neto || 0)
        };
    }

    function instalarEstilos() {
        if (document.getElementById("haiku-ajustes-cargo-estilos")) return;

        const style = document.createElement("style");
        style.id = "haiku-ajustes-cargo-estilos";
        style.textContent = `
            #seccion-pagos .haiku-ajuste-cargo-boton {
                appearance:none; border:1px solid #245f43; background:#2f7653;
                color:#fff; border-radius:9px; padding:10px 15px; font:inherit;
                font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap;
                box-shadow:0 4px 12px rgba(47,118,83,.13);
                transition:transform .14s ease,box-shadow .14s ease,background .14s ease;
            }
            #seccion-pagos .haiku-ajuste-cargo-boton:hover {
                background:#286a49; box-shadow:0 6px 16px rgba(47,118,83,.18);
                transform:translateY(-1px);
            }
            #seccion-pagos .haiku-ajuste-cargo-boton:active { transform:translateY(0); }
            #seccion-pagos .haiku-ajuste-cargo-boton:disabled { opacity:.55; cursor:not-allowed; transform:none; }

            .haiku-ajuste-cargo-overlay {
                position:fixed; inset:0; z-index:2400; display:grid; place-items:center;
                padding:20px; background:rgba(19,28,23,.38); backdrop-filter:blur(2px);
            }
            .haiku-ajuste-cargo-overlay[hidden] { display:none!important; }
            .haiku-ajuste-cargo-modal {
                width:min(620px,100%); max-height:min(780px,calc(100vh - 32px)); overflow-y:auto;
                background:#fff; border:1px solid #dfe5e1; border-radius:16px;
                box-shadow:0 24px 70px rgba(20,35,27,.24); color:#202723;
            }
            .haiku-ajuste-cargo-cabecera {
                display:flex; align-items:flex-start; justify-content:space-between; gap:16px;
                padding:20px 22px 16px; border-bottom:1px solid #e6eae7;
            }
            .haiku-ajuste-cargo-cabecera small {
                display:block; margin-bottom:4px; color:#2f7653; font-size:10px;
                font-weight:800; letter-spacing:1px; text-transform:uppercase;
            }
            .haiku-ajuste-cargo-cabecera h3 { margin:0; font-size:20px; line-height:1.2; }
            .haiku-ajuste-cargo-cerrar {
                width:34px; height:34px; border:1px solid #e1e6e3; border-radius:50%;
                background:#fff; color:#26302b; font-size:20px; line-height:1; cursor:pointer;
            }
            .haiku-ajuste-cargo-cuerpo { padding:20px 22px 22px; }
            .haiku-ajuste-cargo-grupo { margin-bottom:18px; }
            .haiku-ajuste-cargo-label {
                display:block; margin-bottom:7px; color:#68736d; font-size:11px;
                font-weight:700; letter-spacing:.35px; text-transform:uppercase;
            }
            .haiku-ajuste-cargo-select,.haiku-ajuste-cargo-textarea {
                width:100%; box-sizing:border-box; border:1px solid #dce3df; border-radius:9px;
                background:#fff; color:#202723; font:inherit; font-size:13px; outline:none;
            }
            .haiku-ajuste-cargo-select { min-height:42px; padding:0 11px; }
            .haiku-ajuste-cargo-textarea { min-height:72px; padding:10px 11px; resize:vertical; }
            .haiku-ajuste-cargo-select:focus,.haiku-ajuste-cargo-textarea:focus {
                border-color:#6ea58a; box-shadow:0 0 0 3px rgba(47,118,83,.08);
            }
            .haiku-ajuste-cargo-vinculo {
                display:flex; align-items:center; gap:7px; margin:-8px 0 17px;
                color:#2f7653; font-size:10px; font-weight:700;
            }
            .haiku-ajuste-cargo-vinculo[hidden] { display:none!important; }
            .haiku-ajuste-cargo-opciones {
                display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px;
            }
            .haiku-ajuste-cargo-opcion {
                min-height:104px; padding:12px; border:1px solid #dfe5e1; border-radius:11px;
                background:#fbfcfb; color:#27302b; text-align:left; cursor:pointer;
                transition:border-color .14s ease,background .14s ease,box-shadow .14s ease;
            }
            .haiku-ajuste-cargo-opcion strong { display:block; margin-bottom:6px; font-size:12px; line-height:1.3; }
            .haiku-ajuste-cargo-opcion span { display:block; color:#758079; font-size:10px; line-height:1.45; }
            .haiku-ajuste-cargo-opcion.activa {
                border-color:#2f7653; background:#f0f8f3; box-shadow:inset 0 0 0 1px rgba(47,118,83,.12);
            }
            .haiku-ajuste-cargo-resumen {
                display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:12px;
                padding:12px; border:1px solid #e1e7e3; border-radius:11px; background:#f8faf9;
            }
            .haiku-ajuste-cargo-resumen span {
                display:block; margin-bottom:4px; color:#77817c; font-size:9px;
                font-weight:700; letter-spacing:.35px; text-transform:uppercase;
            }
            .haiku-ajuste-cargo-resumen strong { display:block; font-size:13px; overflow-wrap:anywhere; }
            .haiku-ajuste-cargo-impacto {
                margin-top:9px; padding:11px 12px; border-radius:10px; background:#f5f7f6;
                font-size:12px; line-height:1.45;
            }
            .haiku-ajuste-cargo-impacto strong { color:#2f7653; }
            .haiku-ajuste-cargo-nota { margin-top:7px; color:#79837d; font-size:10px; line-height:1.45; }
            .haiku-ajuste-cargo-estado { min-height:18px; margin-top:10px; font-size:11px; line-height:1.4; }
            .haiku-ajuste-cargo-estado.error { color:#a64545; }
            .haiku-ajuste-cargo-estado.exito { color:#2f7653; font-weight:700; }
            .haiku-ajuste-cargo-acciones {
                display:flex; justify-content:flex-end; gap:9px; margin-top:18px;
                padding-top:16px; border-top:1px solid #e7ebe8;
            }
            .haiku-ajuste-cargo-cancelar,.haiku-ajuste-cargo-confirmar {
                border-radius:9px; padding:10px 15px; font:inherit; font-size:12px;
                font-weight:700; cursor:pointer;
            }
            .haiku-ajuste-cargo-cancelar { border:1px solid #dbe2de; background:#fff; color:#4f5a54; }
            .haiku-ajuste-cargo-confirmar { border:1px solid #245f43; background:#2f7653; color:#fff; }
            .haiku-ajuste-cargo-confirmar:disabled { opacity:.48; cursor:not-allowed; }

            @media (max-width:720px) {
                #seccion-pagos .haiku-ajuste-cargo-boton { padding:9px 11px; font-size:11px; }
                .haiku-ajuste-cargo-overlay { padding:10px; align-items:end; }
                .haiku-ajuste-cargo-modal { width:100%; max-height:calc(100vh - 20px); border-radius:16px 16px 10px 10px; }
                .haiku-ajuste-cargo-cabecera,.haiku-ajuste-cargo-cuerpo { padding-left:16px; padding-right:16px; }
                .haiku-ajuste-cargo-opciones { grid-template-columns:1fr; }
                .haiku-ajuste-cargo-opcion { min-height:auto; }
                .haiku-ajuste-cargo-resumen { grid-template-columns:1fr; }
            }
        `;
        document.head.appendChild(style);
    }

    function crearModal() {
        if (document.getElementById("haiku-ajuste-cargo-overlay")) return;

        const overlay = document.createElement("div");
        overlay.id = "haiku-ajuste-cargo-overlay";
        overlay.className = "haiku-ajuste-cargo-overlay";
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="haiku-ajuste-cargo-modal" role="dialog" aria-modal="true" aria-labelledby="haiku-ajuste-cargo-titulo">
                <div class="haiku-ajuste-cargo-cabecera">
                    <div>
                        <small>Control financiero</small>
                        <h3 id="haiku-ajuste-cargo-titulo">Ajustar cargo</h3>
                    </div>
                    <button type="button" class="haiku-ajuste-cargo-cerrar" data-haiku-ajuste-cerrar aria-label="Cerrar">×</button>
                </div>
                <div class="haiku-ajuste-cargo-cuerpo">
                    <div class="haiku-ajuste-cargo-grupo">
                        <label class="haiku-ajuste-cargo-label" for="haiku-ajuste-reserva">Reserva del día</label>
                        <select id="haiku-ajuste-reserva" class="haiku-ajuste-cargo-select">
                            <option value="">Cargando reservas...</option>
                        </select>
                    </div>

                    <div id="haiku-ajuste-vinculo" class="haiku-ajuste-cargo-vinculo" hidden></div>

                    <div class="haiku-ajuste-cargo-grupo">
                        <span class="haiku-ajuste-cargo-label">Tipo de ajuste</span>
                        <div class="haiku-ajuste-cargo-opciones">
                            <button type="button" class="haiku-ajuste-cargo-opcion" data-haiku-ajuste-tipo="iva_exento">
                                <strong>Exención IVA extranjero</strong>
                                <span>Extrae el IVA incluido del alojamiento.</span>
                            </button>
                            <button type="button" class="haiku-ajuste-cargo-opcion" data-haiku-ajuste-tipo="cargo_cancelacion">
                                <strong>Cargo 10% · Cancelación</strong>
                                <span>10% del total original del alojamiento.</span>
                            </button>
                            <button type="button" class="haiku-ajuste-cargo-opcion" data-haiku-ajuste-tipo="cargo_modificacion">
                                <strong>Cargo 10% · Modificación</strong>
                                <span>10% del total original del alojamiento.</span>
                            </button>
                        </div>
                    </div>

                    <div id="haiku-ajuste-cargo-resumen-wrap" hidden>
                        <div class="haiku-ajuste-cargo-resumen">
                            <div><span id="haiku-ajuste-label-total-original">Total original</span><strong id="haiku-ajuste-total-original">$0</strong></div>
                            <div><span id="haiku-ajuste-label-total-actual">Total actual</span><strong id="haiku-ajuste-total-actual">$0</strong></div>
                            <div><span id="haiku-ajuste-label-saldo">Saldo actual</span><strong id="haiku-ajuste-saldo-actual">$0</strong></div>
                        </div>
                        <div class="haiku-ajuste-cargo-impacto" id="haiku-ajuste-impacto"></div>
                        <div class="haiku-ajuste-cargo-nota" id="haiku-ajuste-nota"></div>
                    </div>

                    <div class="haiku-ajuste-cargo-grupo" style="margin-top:16px;">
                        <label class="haiku-ajuste-cargo-label" for="haiku-ajuste-observacion">Observación opcional</label>
                        <textarea id="haiku-ajuste-observacion" class="haiku-ajuste-cargo-textarea" placeholder="Ej: Pasaporte verificado, modificación solicitada por huésped..."></textarea>
                    </div>

                    <div id="haiku-ajuste-estado" class="haiku-ajuste-cargo-estado" aria-live="polite"></div>

                    <div class="haiku-ajuste-cargo-acciones">
                        <button type="button" class="haiku-ajuste-cargo-cancelar" data-haiku-ajuste-cerrar>Cancelar</button>
                        <button type="button" id="haiku-ajuste-confirmar" class="haiku-ajuste-cargo-confirmar" disabled>Aplicar ajuste</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        overlay.addEventListener("click", evento => {
            if (evento.target === overlay) cerrarModal();
        });

        overlay.querySelectorAll("[data-haiku-ajuste-cerrar]")
            .forEach(boton => boton.addEventListener("click", cerrarModal));

        overlay.querySelectorAll("[data-haiku-ajuste-tipo]")
            .forEach(boton => boton.addEventListener("click", () => {
                tipoSeleccionado = boton.dataset.haikuAjusteTipo || "";
                overlay.querySelectorAll("[data-haiku-ajuste-tipo]")
                    .forEach(item => item.classList.toggle("activa", item === boton));
                pintarPrevia();
            }));

        overlay.querySelector("#haiku-ajuste-reserva")
            ?.addEventListener("change", async evento => {
                reservaSeleccionada = evento.target.value || "";
                resumenActual = null;
                await cargarResumenSeleccionado();
            });

        overlay.querySelector("#haiku-ajuste-confirmar")
            ?.addEventListener("click", aplicarAjuste);
    }

    function crearBoton() {
        const cabecera = document.querySelector("#seccion-pagos .cabecera");
        if (!cabecera || cabecera.querySelector(".haiku-ajuste-cargo-boton")) return;

        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "haiku-ajuste-cargo-boton";
        boton.textContent = "Ajustar cargo";
        boton.addEventListener("click", abrirModal);
        cabecera.appendChild(boton);
    }

    function mostrarEstado(texto = "", tipo = "") {
        const nodo = document.getElementById("haiku-ajuste-estado");
        if (!nodo) return;
        nodo.className = "haiku-ajuste-cargo-estado" + (tipo ? ` ${tipo}` : "");
        nodo.textContent = texto;
    }

    function resetModal() {
        reservaSeleccionada = "";
        tipoSeleccionado = "";
        resumenActual = null;
        guardando = false;

        document.querySelectorAll("[data-haiku-ajuste-tipo]")
            .forEach(item => item.classList.remove("activa"));

        const observacion = document.getElementById("haiku-ajuste-observacion");
        if (observacion) observacion.value = "";

        const vinculo = document.getElementById("haiku-ajuste-vinculo");
        if (vinculo) {
            vinculo.textContent = "";
            vinculo.hidden = true;
        }

        const wrap = document.getElementById("haiku-ajuste-cargo-resumen-wrap");
        if (wrap) wrap.hidden = true;

        const confirmar = document.getElementById("haiku-ajuste-confirmar");
        if (confirmar) {
            confirmar.disabled = true;
            confirmar.textContent = "Aplicar ajuste";
        }
        mostrarEstado("");
    }

    function cerrarModal() {
        const overlay = document.getElementById("haiku-ajuste-cargo-overlay");
        if (!overlay || guardando) return;
        overlay.hidden = true;
        document.body.style.overflow = "";
    }

    async function obtenerReservasDia() {
        const fecha = fechaActual();
        if (!fecha) return [];

        const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error) throw error;

        const base = new Map();
        const agregar = (numero, reservaId, titular, contexto) => {
            if (!reservaId || base.has(String(reservaId))) return;
            base.set(String(reservaId), {
                reservaId: String(reservaId),
                numero: Number(numero || 0),
                titular: titular || "Sin titular",
                contexto: contexto || ""
            });
        };

        (data || []).forEach(fila => {
            agregar(fila.numero, fila.ingreso_reserva_id, fila.ingreso_titular, "Ingresa");
            agregar(fila.numero, fila.continua_reserva_id, fila.continua_titular, "Continúa");
            agregar(fila.numero, fila.salida_reserva_id, fila.salida_titular, "Sale");
            agregar(fila.numero, fila.fullday_reserva_id, fila.fullday_titular, "Full Day");
        });

        const items = [...base.values()];
        if (!items.length) return [];

        const { data: reservas, error: eReservas } = await cliente
            .from("reservas")
            .select("id,grupo_reserva_id,titular_nombre")
            .in("id", items.map(i => i.reservaId));

        if (eReservas) throw eReservas;

        const meta = new Map((reservas || []).map(r => [String(r.id), r]));
        const unidades = new Map();

        items.forEach(item => {
            const r = meta.get(item.reservaId) || {};
            const grupoId = r.grupo_reserva_id ? String(r.grupo_reserva_id) : "";
            const clave = grupoId ? `g:${grupoId}` : `r:${item.reservaId}`;

            if (!unidades.has(clave)) {
                unidades.set(clave, {
                    reservaId: item.reservaId,
                    grupoId,
                    titular: r.titular_nombre || item.titular,
                    cabs: [],
                    contextos: []
                });
            }

            const unidad = unidades.get(clave);
            if (item.numero && !unidad.cabs.includes(item.numero)) unidad.cabs.push(item.numero);
            if (item.contexto && !unidad.contextos.includes(item.contexto)) unidad.contextos.push(item.contexto);
        });

        return [...unidades.values()]
            .map(item => {
                item.cabs.sort((a,b) => a-b);
                return item;
            })
            .sort((a,b) => (a.cabs[0] || 999) - (b.cabs[0] || 999));
    }

    async function cargarReservas() {
        const select = document.getElementById("haiku-ajuste-reserva");
        if (!select) return;

        select.innerHTML = `<option value="">Cargando reservas...</option>`;
        select.disabled = true;

        try {
            const reservas = await obtenerReservasDia();
            select.innerHTML = `<option value="">Seleccionar reserva...</option>`;

            reservas.forEach(item => {
                const option = document.createElement("option");
                option.value = item.reservaId;

                const contexto = item.contextos.join(" / ");
                option.textContent = item.grupoId
                    ? `↳ ${item.titular} · ${item.cabs.map(n => `CAB ${n}`).join(" + ")} · ${contexto}`
                    : `CAB ${item.cabs[0] || "—"} · ${item.titular} · ${contexto}`;

                select.appendChild(option);
            });

            if (!reservas.length) {
                select.innerHTML = `<option value="">No hay reservas para esta fecha</option>`;
            }
        } catch (error) {
            console.error("HAIKU · No fue posible cargar reservas para ajustes:", error);
            select.innerHTML = `<option value="">No fue posible cargar reservas</option>`;
            mostrarEstado(error?.message || "No fue posible cargar las reservas.", "error");
        } finally {
            select.disabled = false;
        }
    }

    async function abrirModal() {
        if (!window.haikuSesion) {
            alert("Debes iniciar sesión para ajustar cargos.");
            return;
        }

        if (typeof window.haikuTienePermiso === "function" &&
            !window.haikuTienePermiso("pagos.registrar")) {
            alert("Tu usuario no tiene permiso para ajustar cargos.");
            return;
        }

        const overlay = document.getElementById("haiku-ajuste-cargo-overlay");
        if (!overlay) return;

        resetModal();
        overlay.hidden = false;
        document.body.style.overflow = "hidden";
        await cargarReservas();
    }

    async function cargarResumenSeleccionado() {
        if (!reservaSeleccionada) {
            resumenActual = null;
            const vinculo = document.getElementById("haiku-ajuste-vinculo");
            if (vinculo) vinculo.hidden = true;
            pintarPrevia();
            return;
        }

        mostrarEstado("Cargando saldo del alojamiento...");

        const { data, error } = await cliente.rpc(
            "haiku_resumen_ajustes_unidad",
            { p_reserva_id: reservaSeleccionada }
        );

        if (error) {
            console.error("HAIKU · Error cargando resumen de ajuste:", error);
            resumenActual = null;
            mostrarEstado(error.message || "No fue posible cargar el saldo.", "error");
            pintarPrevia();
            return;
        }

        resumenActual = data || null;

        const vinculo = document.getElementById("haiku-ajuste-vinculo");
        if (vinculo) {
            if (resumenActual?.es_grupo) {
                const cabs = cabsActuales();
                vinculo.textContent = `↳ Reserva conjunta · ${cabs.map(n => `CAB ${n}`).join(" · ")}`;
                vinculo.hidden = false;
            } else {
                vinculo.textContent = "";
                vinculo.hidden = true;
            }
        }

        mostrarEstado("");
        pintarPrevia();
    }

    function pintarPrevia() {
        const wrap = document.getElementById("haiku-ajuste-cargo-resumen-wrap");
        const confirmar = document.getElementById("haiku-ajuste-confirmar");
        const impacto = document.getElementById("haiku-ajuste-impacto");
        const nota = document.getElementById("haiku-ajuste-nota");
        const previa = calcularVistaPrevia();
        const ajustes = Array.isArray(resumenActual?.ajustes) ? resumenActual.ajustes : [];

        if (!previa || !reservaSeleccionada || !tipoSeleccionado) {
            if (wrap) wrap.hidden = true;
            if (confirmar) confirmar.disabled = true;
            return;
        }

        const esGrupo = resumenActual?.es_grupo === true;
        document.getElementById("haiku-ajuste-label-total-original").textContent = esGrupo ? "Total original grupo" : "Total original";
        document.getElementById("haiku-ajuste-label-total-actual").textContent = esGrupo ? "Total actual grupo" : "Total actual";
        document.getElementById("haiku-ajuste-label-saldo").textContent = esGrupo ? "Saldo grupo" : "Saldo actual";

        document.getElementById("haiku-ajuste-total-original").textContent = dinero(previa.original);
        document.getElementById("haiku-ajuste-total-actual").textContent = dinero(previa.actual);
        document.getElementById("haiku-ajuste-saldo-actual").textContent = dinero(previa.saldoActual);

        const tipo = TIPOS[tipoSeleccionado];
        const yaExiste = ajustes.some(item =>
            item?.estado === "activo" && item?.tipo_ajuste === tipoSeleccionado
        );

        if (impacto) {
            impacto.innerHTML = `${escapar(tipo.etiqueta)}: <strong>${dinero(previa.monto)}</strong> · Nuevo total: <strong>${dinero(previa.nuevoTotal)}</strong>`;
        }

        if (nota) {
            const calculo = tipoSeleccionado === "iva_exento"
                ? "El IVA incluido se extrae del precio: total ÷ 1,19. No se resta 19% directamente al total."
                : "El 10% se calcula siempre sobre el total original del alojamiento, sin acumular porcentajes sobre ajustes anteriores.";

            const grupo = esGrupo
                ? ` Se calculará una sola vez sobre ${cabsActuales().map(n => `CAB ${n}`).join(" + ")} y Haiku lo distribuirá internamente entre los alojamientos vinculados.`
                : "";

            nota.textContent = calculo + grupo;
        }

        if (wrap) wrap.hidden = false;

        if (yaExiste) {
            mostrarEstado(
                esGrupo
                    ? "Esta reserva conjunta ya tiene este ajuste activo."
                    : "Esta reserva ya tiene este ajuste activo.",
                "error"
            );
            if (confirmar) confirmar.disabled = true;
            return;
        }

        if (tipoSeleccionado === "iva_exento" && previa.pagado > previa.nuevoTotal) {
            mostrarEstado(
                "No se puede aplicar la exención porque los pagos registrados superarían el nuevo total.",
                "error"
            );
            if (confirmar) confirmar.disabled = true;
            return;
        }

        if (confirmar) confirmar.disabled = guardando;
        if (!guardando) mostrarEstado("");
    }

    async function refrescarFinanzas() {
        const fecha = fechaActual();

        try {
            const tareas = [];
            if (typeof window.haikuCargarAbonosSupabase === "function") tareas.push(window.haikuCargarAbonosSupabase());
            if (typeof window.haikuCargarSaldosCheckinSupabase === "function") tareas.push(window.haikuCargarSaldosCheckinSupabase());
            if (window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1?.refrescar) tareas.push(window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1.refrescar(fecha));
            if (window.HAIKU_PAGO_GRUPO_V1?.refrescarFicha) tareas.push(window.HAIKU_PAGO_GRUPO_V1.refrescarFicha());
            await Promise.all(tareas);
        } catch (_) {}
    }

    async function aplicarAjuste() {
        const confirmar = document.getElementById("haiku-ajuste-confirmar");
        if (guardando || !reservaSeleccionada || !tipoSeleccionado || !resumenActual) return;

        const previa = calcularVistaPrevia();
        if (!previa) return;

        const tipo = TIPOS[tipoSeleccionado];
        const esGrupo = resumenActual?.es_grupo === true;
        const destino = esGrupo
            ? ` sobre ${cabsActuales().map(n => `CAB ${n}`).join(" + ")}`
            : "";

        const mensaje = tipoSeleccionado === "iva_exento"
            ? `¿Aplicar ${tipo.titulo}${destino}?\n\nSe descontarán ${dinero(previa.monto)} y el nuevo total será ${dinero(previa.nuevoTotal)}.`
            : `¿Aplicar ${tipo.titulo}${destino}?\n\nSe añadirán ${dinero(previa.monto)} y el nuevo total será ${dinero(previa.nuevoTotal)}.`;

        if (!window.confirm(mensaje)) return;

        guardando = true;
        if (confirmar) {
            confirmar.disabled = true;
            confirmar.textContent = "Aplicando...";
        }
        mostrarEstado("Guardando ajuste en Supabase...");

        try {
            const observaciones = document.getElementById("haiku-ajuste-observacion")?.value || null;
            const { data, error } = await cliente.rpc(
                "haiku_aplicar_ajuste_unidad",
                {
                    p_reserva_id: reservaSeleccionada,
                    p_tipo_ajuste: tipoSeleccionado,
                    p_observaciones: observaciones
                }
            );
            if (error) throw error;

            resumenActual = data?.resumen || resumenActual;
            window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("ajustar cargo");
            const monto = Number(data?.monto_ajuste || previa.monto);
            const signo = Number(data?.signo || tipo.signo);

            mostrarEstado(
                signo < 0
                    ? `✓ Ajuste aplicado. Se descontaron ${dinero(monto)}${esGrupo ? " del total conjunto" : ""}.`
                    : `✓ Cargo aplicado. Se añadieron ${dinero(monto)}${esGrupo ? " al total conjunto" : ""}.`,
                "exito"
            );

            await refrescarFinanzas();

            setTimeout(() => {
                guardando = false;
                if (confirmar) confirmar.textContent = "Aplicar ajuste";
                cerrarModal();
            }, 650);
        } catch (error) {
            console.error("HAIKU · No fue posible aplicar ajuste de cargo:", error);
            guardando = false;
            if (confirmar) confirmar.textContent = "Aplicar ajuste";
            mostrarEstado(error?.message || "No fue posible aplicar el ajuste.", "error");
            pintarPrevia();
        }
    }

    function instalarRealtime() {
        if (canal || !window.haikuSesion) return;

        canal = cliente
            .channel("haiku-ajustes-cargo-v2")
            .on(
                "postgres_changes",
                { event:"*", schema:"public", table:"cargo_ajustes" },
                () => setTimeout(refrescarFinanzas, 90)
            );

        canal.subscribe(estadoCanal => {
            if (estadoCanal === "SUBSCRIBED") {
                console.info("HAIKU · Ajustes de cargo Realtime conectado.");
            }
        });
    }

    function instalar() {
        if (instalado) {
            instalarRealtime();
            return;
        }

        instalarEstilos();
        crearModal();
        crearBoton();
        instalarRealtime();
        instalado = true;
        console.info("HAIKU · Ajustes de cargo V2 preparados.");
    }

    window.addEventListener("haiku:auth-ready", () => setTimeout(instalar, 50));
    window.addEventListener("pageshow", () => setTimeout(instalar, 20));
    setTimeout(instalar, 120);

    window.HAIKU_AJUSTES_CARGO_V2 = Object.freeze({
        abrir: abrirModal,
        refrescar: refrescarFinanzas
    });
})();
