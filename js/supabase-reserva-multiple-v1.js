/* =====================================================
   HAIKU · NUEVA RESERVA MÚLTIPLE · V1
   Selección de 2+ cabañas con ocupación propia por CAB.
   Cada CAB sigue siendo una reserva independiente y Supabase
   las crea juntas, vinculadas por grupo_reserva_id.
===================================================== */
(() => {
    "use strict";

    const sb = window.haikuSupabase;
    if (!sb) return;

    const seleccionadas = new Map();
    let rango = "";
    let guardando = false;
    let cabanaTarifaActiva = "";
    const ID_NORMAL = "crear-nueva-reserva";
    const ID_MULTIPLE = "crear-nueva-reserva-multiple";

    const $ = (selector) => document.querySelector(selector);

    function modoCrearAlojamiento() {
        let modo = "crear";
        try { modo = String(modoFormularioReserva || "crear"); } catch {}
        const fullDay = Boolean(
            $('[data-haiku-tipo-estadia="fullday"].activo')
        );
        return modo === "crear" && !fullDay;
    }

    function fechas() {
        let llegada = "", salida = "";
        try { llegada = String(fechaLlegadaReserva || ""); } catch {}
        try { salida = String(fechaSalidaReserva || ""); } catch {}
        return { llegada, salida, clave: `${llegada}::${salida}` };
    }

    function noches() {
        const f = fechas();
        if (!f.llegada || !f.salida) return 0;
        try { return calcularNochesReserva(f.llegada, f.salida); }
        catch { return 0; }
    }

    function catalogo(numero) {
        try { return catalogoCabanasReserva?.[String(numero)] || null; }
        catch { return null; }
    }

    function precio(valor) {
        try { return formatearPrecioReserva(Number(valor || 0)); }
        catch { return `$${Number(valor || 0).toLocaleString("es-CL")}`; }
    }

    function fechaBonita(valor) {
        try { return formatearFechaReserva(valor); }
        catch { return valor; }
    }

    function sumar(fecha, dias) {
        try { return sumarDiasNuevaReserva(fecha, dias); }
        catch { return fecha; }
    }

    function obtenerSeleccion(numero) {
        numero = String(numero);
        if (!seleccionadas.has(numero)) {
            seleccionadas.set(numero, {
                cabana: numero,
                adultos: 1,
                ninos: 0,
                mascotas: 0,
                tarifas: {}
            });
        }
        return seleccionadas.get(numero);
    }

    function totalCabana(item) {
        const cab = catalogo(item.cabana);
        const f = fechas();
        const n = noches();
        if (!cab || !f.llegada || n < 1) return 0;
        let total = 0;
        for (let i = 0; i < n; i++) {
            const fecha = sumar(f.llegada, i);
            total += Number(item.tarifas?.[fecha] ?? cab.precio ?? 0);
        }
        return total;
    }

    function primera() {
        return seleccionadas.values().next().value || null;
    }

    function sincronizarLegacy(item = null) {
        item = item || (seleccionadas.size === 1 ? primera() : null);
        if (!item) return;
        try { cabanaSeleccionadaReserva = String(item.cabana); } catch {}
        try { adultosReserva = Number(item.adultos); } catch {}
        try { ninosReserva = Number(item.ninos); } catch {}
        try { mascotasReserva = Number(item.mascotas || 0); } catch {}
        try { tarifasNochesReserva = { ...(item.tarifas || {}) }; } catch {}
    }

    function actualizarContinuar() {
        const boton = $("#continuar-reserva-detalles");
        if (boton) boton.disabled = seleccionadas.size === 0;
    }

    function quitarOcupacion(numero) {
        document.querySelectorAll(
            `.reserva-multiple-ocupacion[data-cabana="${numero}"]`
        ).forEach(el => el.remove());
    }

    function montarOcupacion(tarjeta, numero) {
        quitarOcupacion(numero);
        const item = obtenerSeleccion(numero);
        const cab = catalogo(numero);
        if (!cab) return;

        const max = Math.max(1, Number(cab.capacidad || 1));
        const opcionesAdultos = Array.from(
            { length: max }, (_, i) => i + 1
        ).map(v => `<option value="${v}">${v}</option>`).join("");
        const opcionesNinos = Array.from(
            { length: max }, (_, i) => i
        ).map(v => `<option value="${v}">${v}</option>`).join("");

        const panel = document.createElement("div");
        panel.className = "reserva-ocupacion-panel reserva-multiple-ocupacion";
        panel.dataset.cabana = String(numero);
        panel.innerHTML = `
            <div class="reserva-ocupacion-titulo">
                <strong>Huéspedes · CAB ${numero}</strong>
                <span>Máximo ${max} ${max === 1 ? "persona" : "personas"}</span>
            </div>
            <label>Adultos
                <select class="reserva-ocupacion-adultos">${opcionesAdultos}</select>
            </label>
            <label>Niños
                <select class="reserva-ocupacion-ninos">${opcionesNinos}</select>
            </label>`;
        tarjeta.insertAdjacentElement("afterend", panel);

        const adl = panel.querySelector(".reserva-ocupacion-adultos");
        const nin = panel.querySelector(".reserva-ocupacion-ninos");
        adl.value = String(item.adultos);
        nin.value = String(item.ninos);

        function guardar(origen) {
            item.adultos = Math.max(1, Number(adl.value || 1));
            item.ninos = Math.max(0, Number(nin.value || 0));
            if (item.adultos + item.ninos > max) {
                if (origen === "adl") {
                    item.ninos = Math.max(0, max - item.adultos);
                    nin.value = String(item.ninos);
                } else {
                    item.adultos = Math.max(1, max - item.ninos);
                    adl.value = String(item.adultos);
                }
            }
            if (seleccionadas.size === 1) sincronizarLegacy(item);
        }
        adl.addEventListener("change", () => guardar("adl"));
        nin.addEventListener("change", () => guardar("nin"));
    }

    function prepararPasoCabana() {
        if (!modoCrearAlojamiento()) return;
        const f = fechas();
        if (rango && f.clave && rango !== f.clave) seleccionadas.clear();
        if (f.clave) rango = f.clave;

        const titulo = $("#reserva-paso-cabana .nueva-reserva-titulo strong");
        const texto = $("#reserva-paso-cabana .nueva-reserva-titulo span");
        if (titulo) titulo.textContent = "Selecciona una o más cabañas";
        if (texto) texto.textContent =
            "Toca nuevamente una cabaña seleccionada para quitarla";

        document.querySelectorAll(
            "#lista-cabanas-disponibles .reserva-cabana-opcion[data-cabana]"
        ).forEach(tarjeta => {
            const numero = String(tarjeta.dataset.cabana || "");
            const activa = seleccionadas.has(numero);
            tarjeta.classList.toggle("seleccionada", activa);
            if (activa) montarOcupacion(tarjeta, numero);
        });
        actualizarContinuar();
        if (seleccionadas.size === 1) sincronizarLegacy();
    }

    function alternar(tarjeta) {
        const numero = String(tarjeta.dataset.cabana || "");
        if (!numero) return;
        if (seleccionadas.has(numero)) {
            seleccionadas.delete(numero);
            tarjeta.classList.remove("seleccionada");
            quitarOcupacion(numero);
        } else {
            obtenerSeleccion(numero);
            tarjeta.classList.add("seleccionada");
            montarOcupacion(tarjeta, numero);
        }
        actualizarContinuar();
        if (seleccionadas.size === 1) sincronizarLegacy();
    }

    function restaurarBotonCrear() {
        const boton = document.getElementById(ID_MULTIPLE);
        if (!boton) return;
        boton.id = ID_NORMAL;
        boton.textContent = "Crear reserva";
        boton.disabled = false;
    }

    function renderDetallesMultiples() {
        if (seleccionadas.size < 2) return;
        const resumen = $("#reserva-cabana-seleccionada");
        const acomp = $("#reserva-acompanantes");
        const paso2 = $("#reserva-paso-cabana");
        const paso3 = $("#reserva-paso-detalles");
        const boton = document.getElementById(ID_NORMAL) ||
            document.getElementById(ID_MULTIPLE);
        if (!resumen || !acomp || !paso2 || !paso3 || !boton) return;

        const f = fechas();
        const n = noches();
        let filas = "", grupos = "", total = 0;

        seleccionadas.forEach(item => {
            const cab = catalogo(item.cabana);
            if (!cab) return;
            const subtotal = totalCabana(item);
            total += subtotal;
            filas += `
                <div class="reserva-multiple-detalle-fila">
                    <div>
                        <strong>CAB ${item.cabana} · ${cab.nombre}</strong>
                        <span>${item.adultos} ADL · ${item.ninos} NIÑ · ${n} ${n === 1 ? "noche" : "noches"}</span>
                    </div>
                    <strong>${precio(subtotal)}</strong>
                </div>`;

            const cantidad = Math.max(
                0, Number(item.adultos) + Number(item.ninos) - 1
            );
            let campos = "";
            for (let i = 1; i <= cantidad; i++) {
                campos += `
                    <label>Acompañante ${i}
                        <input type="text"
                            class="reserva-nuevo-acompanante"
                            data-cabana="${item.cabana}"
                            data-acompanante="${i}"
                            placeholder="Nombre completo (opcional)">
                    </label>`;
            }
            grupos += `
                <section class="reserva-multiple-acompanantes-grupo">
                    <div class="reserva-multiple-acompanantes-titulo">
                        <strong>CAB ${item.cabana} · Huéspedes</strong>
                        <span>${Number(item.adultos) + Number(item.ninos)} en total</span>
                    </div>
                    ${campos || "<small>Sin acompañantes adicionales</small>"}
                </section>`;
        });

        resumen.innerHTML = `
            <div class="reserva-detalles-resumen reserva-multiple-resumen">
                <div class="reserva-detalles-cabana">
                    <strong>${seleccionadas.size} alojamientos seleccionados</strong>
                    <span>${fechaBonita(f.llegada)} → ${fechaBonita(f.salida)} · ${n} ${n === 1 ? "noche" : "noches"}</span>
                </div>
                <div class="reserva-multiple-detalle-lista">${filas}</div>
                <div class="reserva-multiple-total-grupo">
                    <span>Total grupo</span><strong>${precio(total)}</strong>
                </div>
            </div>`;
        acomp.innerHTML = grupos;
        paso2.hidden = true;
        paso3.hidden = false;
        document.querySelectorAll(".reserva-paso").forEach(p =>
            p.classList.toggle("activo", p.dataset.paso === "3")
        );
        boton.id = ID_MULTIPLE;
        boton.textContent = `Crear ${seleccionadas.size} reservas`;
        boton.disabled = false;
    }

    function datosComunes() {
        return {
            titular: $("#reserva-nuevo-titular")?.value.trim() || "",
            telefono: $("#reserva-nuevo-telefono")?.value.trim() || "",
            rut: $("#reserva-nuevo-rut")?.value.trim() || "",
            correo: $("#reserva-nuevo-correo")?.value.trim() || "",
            observaciones: $("#reserva-nueva-observacion")?.value.trim() || ""
        };
    }

    function payloadAlojamientos() {
        return Array.from(seleccionadas.values()).map(item => ({
            cabana: Number(item.cabana),
            adultos: Number(item.adultos || 0),
            ninos: Number(item.ninos || 0),
            mascotas: Number(item.mascotas || 0),
            tarifas: { ...(item.tarifas || {}) },
            acompanantes: Array.from(document.querySelectorAll(
                `.reserva-nuevo-acompanante[data-cabana="${item.cabana}"]`
            )).map(c => c.value.trim()).filter(Boolean)
        }));
    }

    async function crearMultiples() {
        if (guardando || seleccionadas.size < 2) return;
        const boton = document.getElementById(ID_MULTIPLE);
        if (!boton) return;
        const comun = datosComunes();
        const f = fechas();

        if (!comun.titular) {
            window.HAIKU_DIALOGOS.aviso("Ingresa el nombre del titular de la reserva.");
            $("#reserva-nuevo-titular")?.focus();
            return;
        }
        const correo = $("#reserva-nuevo-correo");
        if (correo?.value.trim() && !correo.checkValidity()) {
            window.HAIKU_DIALOGOS.aviso("Revisa que el correo esté escrito correctamente.");
            correo.focus();
            return;
        }
        if (!f.llegada || !f.salida) {
            window.HAIKU_DIALOGOS.aviso("Selecciona las fechas de la reserva.");
            return;
        }
        if (!window.haikuTienePermiso?.("reservas.crear")) {
            window.HAIKU_DIALOGOS.aviso("Tu usuario no tiene permiso para crear reservas.");
            return;
        }

        const texto = boton.textContent;
        guardando = true;
        boton.disabled = true;
        boton.textContent = "Creando reservas…";
        try {
            const { data, error } = await sb.rpc(
                "haiku_crear_reservas_multiples",
                {
                    p_titular_nombre: comun.titular,
                    p_fecha_ingreso: f.llegada,
                    p_fecha_salida: f.salida,
                    p_alojamientos: payloadAlojamientos(),
                    p_correo_contacto: comun.correo || null,
                    p_telefono_contacto: comun.telefono || null,
                    p_rut: comun.rut || null,
                    p_observaciones: comun.observaciones || null,
                    p_cloudbeds_id: null
                }
            );
            if (error) throw error;
            const creadas = Array.isArray(data?.reservas) ? data.reservas : [];
            if (creadas.length !== seleccionadas.size) {
                throw new Error("Supabase no confirmó todas las reservas del grupo.");
            }

            if (typeof window.haikuSincronizarReservasSupabase === "function") {
                await window.haikuSincronizarReservasSupabase();
            }
            try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}
            try { if (typeof generarCalendario === "function") generarCalendario(); } catch {}

            const primeraCreada = creadas[0] || {};
            try { reservaCreadaId = String(primeraCreada.reserva_id || ""); } catch {}
            try { cabanaSeleccionadaReserva = String(primeraCreada.cabana_numero || primera()?.cabana || ""); } catch {}

            const confirmacion = $("#reserva-paso-confirmacion");
            const resumen = $("#reserva-confirmacion-resumen");
            const paso3 = $("#reserva-paso-detalles");
            const titulo = confirmacion?.querySelector(".reserva-confirmacion-titulo strong");
            const subtitulo = confirmacion?.querySelector(".reserva-confirmacion-titulo span");
            if (titulo) titulo.textContent = "¡Reservas creadas!";
            if (subtitulo) subtitulo.textContent =
                `${creadas.length} alojamientos fueron registrados correctamente.`;

            if (resumen) {
                const cabanas = creadas.map(r => `CAB ${r.cabana_numero}`).join(" · ");
                const total = Array.from(seleccionadas.values())
                    .reduce((s, item) => s + totalCabana(item), 0);
                resumen.innerHTML = `
                    <div class="reserva-confirmacion-fila"><span>Alojamientos</span><strong>${cabanas}</strong></div>
                    <div class="reserva-confirmacion-fila"><span>Fechas</span><strong>${fechaBonita(f.llegada)} → ${fechaBonita(f.salida)}</strong></div>
                    <div class="reserva-confirmacion-fila"><span>Titular</span><strong>${comun.titular}</strong></div>
                    <div class="reserva-confirmacion-fila"><span>Total grupo</span><strong class="reserva-confirmacion-total">${precio(total)}</strong></div>
                    <div class="reserva-confirmacion-id">Grupo ${String(data?.grupo_reserva_id || "").slice(0, 8)}</div>`;
            }
            if (paso3) paso3.hidden = true;
            if (confirmacion) confirmacion.hidden = false;
            document.querySelectorAll(".reserva-paso").forEach(p =>
                p.classList.toggle("activo", p.dataset.paso === "4")
            );
            restaurarBotonCrear();
            console.info("HAIKU · Reserva múltiple creada:", data);
        } catch (error) {
            console.error("HAIKU · No fue posible crear reserva múltiple:", error);
            window.HAIKU_DIALOGOS.aviso(error?.message || "No fue posible crear las reservas. No se guardó el grupo.");
        } finally {
            guardando = false;
            const actual = document.getElementById(ID_MULTIPLE);
            if (actual) {
                actual.disabled = false;
                actual.textContent = texto;
            }
        }
    }

    /* Nueva reserva: limpiar estado múltiple. */
    document.addEventListener("click", e => {
        if (!e.target.closest?.("#boton-nueva-reserva")) return;
        seleccionadas.clear();
        rango = "";
        cabanaTarifaActiva = "";
        restaurarBotonCrear();
    }, true);

    /* Después de renderizar Paso 2, cambiar texto y recuperar selecciones. */
    document.addEventListener("click", e => {
        if (!e.target.closest?.("#continuar-fechas-reserva")) return;
        if (!modoCrearAlojamiento()) return;
        setTimeout(prepararPasoCabana, 0);
    });

    /* Interceptar selección de tarjetas, pero conservar editor de tarifas legacy. */
    document.addEventListener("click", e => {
        if (!modoCrearAlojamiento()) return;
        const linkTarifa = e.target.closest?.(
            "#lista-cabanas-disponibles .reserva-editar-tarifas"
        );
        if (linkTarifa) {
            const tarjeta = linkTarifa.closest(".reserva-cabana-opcion[data-cabana]");
            if (!tarjeta) return;
            const numero = String(tarjeta.dataset.cabana || "");
            if (!seleccionadas.has(numero)) {
                obtenerSeleccion(numero);
                tarjeta.classList.add("seleccionada");
                montarOcupacion(tarjeta, numero);
                actualizarContinuar();
            }
            cabanaTarifaActiva = numero;
            sincronizarLegacy(seleccionadas.get(numero));
            return;
        }

        const tarjeta = e.target.closest?.(
            "#lista-cabanas-disponibles .reserva-cabana-opcion[data-cabana]"
        );
        if (!tarjeta) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        alternar(tarjeta);
    }, true);

    /* Cuando el editor legacy aplica una tarifa, devolverla a la CAB correcta. */
    document.addEventListener("click", e => {
        if (!e.target.closest?.(".reserva-tarifas-aplicar")) return;
        if (!cabanaTarifaActiva || !seleccionadas.has(cabanaTarifaActiva)) return;
        setTimeout(() => {
            const item = seleccionadas.get(cabanaTarifaActiva);
            try { item.tarifas = { ...(tarifasNochesReserva || {}) }; } catch {}
            const tarjeta = document.querySelector(
                `#lista-cabanas-disponibles .reserva-cabana-opcion[data-cabana="${cabanaTarifaActiva}"]`
            );
            const small = tarjeta?.querySelector(".reserva-cabana-info small");
            if (small) {
                const n = noches();
                small.textContent = `${n} ${n === 1 ? "noche" : "noches"} · ${precio(totalCabana(item))}`;
            }
            cabanaTarifaActiva = "";
            if (seleccionadas.size === 1) sincronizarLegacy(item);
        }, 0);
    });

    /* Una CAB usa el flujo original; 2+ usan el detalle múltiple. */
    $("#continuar-reserva-detalles")?.addEventListener("click", e => {
        if (!modoCrearAlojamiento()) return;
        if (seleccionadas.size < 2) {
            if (seleccionadas.size === 1) sincronizarLegacy();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        renderDetallesMultiples();
    }, true);

    /* ID distinto: los interceptores de creación simple/Full Day no lo capturan. */
    document.addEventListener("click", e => {
        const boton = e.target.closest?.(`#${ID_MULTIPLE}`);
        if (!boton || !modoCrearAlojamiento() || seleccionadas.size < 2) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        crearMultiples();
    }, true);

    /* Volver conserva selección y vuelve a poner el ID normal. */
    document.addEventListener("click", e => {
        if (!e.target.closest?.("#volver-reserva-cabana")) return;
        if (!modoCrearAlojamiento()) return;
        restaurarBotonCrear();
        setTimeout(prepararPasoCabana, 0);
    });

    /* Full Day conserva exactamente su flujo existente. */
    document.addEventListener("click", e => {
        const tipo = e.target.closest?.("[data-haiku-tipo-estadia]")
            ?.dataset?.haikuTipoEstadia;
        if (tipo !== "fullday") return;
        seleccionadas.clear();
        rango = "";
        cabanaTarifaActiva = "";
        restaurarBotonCrear();
    }, true);

    window.HAIKU_RESERVA_MULTIPLE_V1 = {
        get selecciones() {
            return Array.from(seleccionadas.values()).map(item => ({
                ...item,
                tarifas: { ...(item.tarifas || {}) }
            }));
        },
        prepararPasoCabana,
        limpiar() {
            seleccionadas.clear();
            rango = "";
            cabanaTarifaActiva = "";
            restaurarBotonCrear();
        }
    };

    console.info("HAIKU · Reserva múltiple V1 preparada.");
})();
