// ========================================
// HAIKU · FICHA · OCUPACIÓN RÁPIDA V1
// Restaura el lápiz rápido de ADL / NIÑ / MASC
// y persiste el cambio directamente en Supabase.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let guardando = false;

    function puedeEditar() {
        return Boolean(
            window.haikuSesion &&
            (typeof window.haikuTienePermiso !== "function" ||
             window.haikuTienePermiso("reservas.editar"))
        );
    }

    function prepararBoton() {
        const botonOriginal = document.querySelector(".ficha-editar-ocupacion");
        const boton = botonOriginal || document.querySelector("[data-haiku-ocupacion-rapida]");
        if (!boton) return null;

        // supabase-ficha-v2 redirige cualquier clase que contenga "editar"
        // al asistente completo. Quitamos esas clases sólo en este lápiz.
        [...boton.classList].forEach(clase => {
            if (clase.includes("editar")) boton.classList.remove(clase);
        });

        boton.classList.add("haiku-ficha-ocupacion-rapida");
        boton.dataset.haikuOcupacionRapida = "1";
        boton.title = "Editar adultos, niños y mascotas";
        boton.setAttribute("aria-label", "Editar adultos, niños y mascotas");

        actualizarDisponibilidad();
        return boton;
    }

    function actualizarDisponibilidad() {
        const boton = document.querySelector("[data-haiku-ocupacion-rapida]");
        const modal = document.getElementById("ficha-reserva-modal");
        if (!boton || !modal) return;

        const historica =
            modal.dataset.reservaCancelada === "true" ||
            modal.dataset.reservaNoShow === "true";

        boton.hidden = !puedeEditar() || historica;
        boton.disabled = guardando;
    }

    function ocupacionVisible() {
        const texto = document.getElementById("ficha-reserva-ocupacion")?.textContent || "";
        const coincidencia = texto.match(/(\d+)\s*ADL\s*·\s*(\d+)\s*NIÑ\s*·\s*(\d+)\s*MASC/i);
        if (!coincidencia) return { adultos: 1, ninos: 0, mascotas: 0 };
        return {
            adultos: Number(coincidencia[1] || 1),
            ninos: Number(coincidencia[2] || 0),
            mascotas: Number(coincidencia[3] || 0)
        };
    }

    function capacidadLocal(numeroCabana) {
        try {
            if (typeof catalogoCabanasReserva !== "undefined") {
                return Number(catalogoCabanasReserva[String(numeroCabana)]?.capacidad || 0);
            }
        } catch {}
        return 0;
    }

    function actualizarInterfaz({ adultos, ninos, mascotas }) {
        const resumen = document.getElementById("ficha-reserva-ocupacion");
        if (resumen) {
            resumen.textContent = `${adultos} ADL · ${ninos} NIÑ · ${mascotas} MASC`;
        }

        const esperados = Math.max(0, adultos + ninos - 1);
        document.querySelectorAll("#ficha-reserva-modal .ficha-acompanante-fila")
            .forEach(fila => {
                const numero = Number(fila.dataset.acompananteFila || 0);
                fila.style.display = numero <= esperados ? "" : "none";
            });
    }

    function actualizarCacheLegacy(reservaId, numeroCabana, valores) {
        try {
            if (typeof sincronizarDatosReserva === "function") {
                sincronizarDatosReserva(reservaId, numeroCabana, "adultos", String(valores.adultos));
                sincronizarDatosReserva(reservaId, numeroCabana, "ninos", String(valores.ninos));
                sincronizarDatosReserva(reservaId, numeroCabana, "mascotas", String(valores.mascotas));
            }

            if (typeof buscarDatosReservaPorId === "function") {
                const registro = buscarDatosReservaPorId(reservaId);
                if (registro?.cabana) {
                    registro.cabana.adultos = String(valores.adultos);
                    registro.cabana.ninos = String(valores.ninos);
                    registro.cabana.mascotas = String(valores.mascotas);
                }
            }

            const fichas = JSON.parse(localStorage.getItem("haikuFichaReservas") || "{}");
            fichas[reservaId] = {
                ...(fichas[reservaId] || {}),
                adultos: valores.adultos,
                ninos: valores.ninos,
                mascotas: valores.mascotas
            };
            localStorage.setItem("haikuFichaReservas", JSON.stringify(fichas));
        } catch (error) {
            console.warn("HAIKU · No fue posible actualizar cache de ocupación:", error);
        }
    }

    async function editarOcupacion() {
        if (guardando) return;
        if (!puedeEditar()) {
            window.HAIKU_DIALOGOS.aviso("Tu usuario no tiene permiso para editar reservas.");
            return;
        }

        const modal = document.getElementById("ficha-reserva-modal");
        const reservaId = String(modal?.dataset?.reservaId || "");
        const numeroCabana = String(modal?.dataset?.numeroCabana || "");
        if (!reservaId || !numeroCabana) return;

        const actual = ocupacionVisible();

        const ocupacion = await window.HAIKU_DIALOGOS.ocupacion(actual, capacidadLocal(numeroCabana), `Reserva · CAB ${numeroCabana}`);
        if (ocupacion === null) return;
        const respuestaAdultos = ocupacion.adultos;
        const respuestaNinos = ocupacion.ninos;
        const respuestaMascotas = ocupacion.mascotas;

        const valores = {
            adultos: Number(respuestaAdultos),
            ninos: Number(respuestaNinos),
            mascotas: Number(respuestaMascotas)
        };

        const validos =
            Number.isInteger(valores.adultos) &&
            Number.isInteger(valores.ninos) &&
            Number.isInteger(valores.mascotas) &&
            valores.adultos >= 1 &&
            valores.ninos >= 0 &&
            valores.mascotas >= 0;

        if (!validos) {
            window.HAIKU_DIALOGOS.aviso("Ingresa cantidades válidas. Debe existir al menos un adulto.");
            return;
        }

        const capacidad = capacidadLocal(numeroCabana);
        if (capacidad > 0 && valores.adultos + valores.ninos > capacidad) {
            window.HAIKU_DIALOGOS.aviso(`La cabaña admite un máximo de ${capacidad} personas entre adultos y niños.`);
            return;
        }

        guardando = true;
        actualizarDisponibilidad();

        try {
            const { error } = await cliente.rpc("haiku_actualizar_ocupacion_reserva", {
                p_reserva_id: reservaId,
                p_adultos: valores.adultos,
                p_ninos: valores.ninos,
                p_mascotas: valores.mascotas
            });
            if (error) throw error;

            actualizarCacheLegacy(reservaId, numeroCabana, valores);
            actualizarInterfaz(valores);

            try {
                if (typeof actualizarOcupacionFicha === "function") {
                    actualizarOcupacionFicha(valores, true);
                }
            } catch {}

            try { cargarCabanasDia?.(fechaSeleccionada); } catch {}
            try { actualizarResumenDia?.(fechaSeleccionada); } catch {}
            try { generarResumenOperativo?.(fechaSeleccionada); } catch {}

            Promise.resolve()
                .then(() => window.haikuSincronizarReservasSupabase?.())
                .catch(() => {});

            console.info("HAIKU · Ocupación rápida actualizada:", reservaId, valores);
        } catch (error) {
            console.error("HAIKU · No fue posible actualizar ocupación rápida:", error);
            window.HAIKU_DIALOGOS.aviso(error?.message || "No fue posible guardar la ocupación.");
        } finally {
            guardando = false;
            actualizarDisponibilidad();
        }
    }

    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.("[data-haiku-ocupacion-rapida]");
        if (!boton) return;
        evento.preventDefault();
        evento.stopPropagation();
        editarOcupacion();
    });

    function instalar() {
        prepararBoton();
        const modal = document.getElementById("ficha-reserva-modal");
        if (modal && modal.dataset.haikuOcupacionRapidaObservada !== "1") {
            modal.dataset.haikuOcupacionRapidaObservada = "1";
            new MutationObserver(() => {
                prepararBoton();
                actualizarDisponibilidad();
            }).observe(modal, {
                attributes: true,
                attributeFilter: ["hidden", "data-reserva-id", "data-reserva-cancelada", "data-reserva-no-show"]
            });
        }
    }

    const estilo = document.createElement("style");
    estilo.textContent = `
        .haiku-ficha-ocupacion-rapida {
            width:18px;height:18px;flex:0 0 18px;
            display:inline-flex;align-items:center;justify-content:center;
            border:0;border-radius:50%;background:#edf5f0;color:#2f7653;
            font:inherit;font-size:10px;line-height:1;cursor:pointer;padding:0;
            transition:background .14s ease,color .14s ease,transform .14s ease;
        }
        .haiku-ficha-ocupacion-rapida:hover { background:#dcebe1;color:#184f34; }
        .haiku-ficha-ocupacion-rapida:active { transform:scale(.94); }
        .haiku-ficha-ocupacion-rapida:disabled { opacity:.5;cursor:wait; }
    `;
    document.head.appendChild(estilo);

    window.addEventListener("haiku:auth-ready", () => setTimeout(instalar, 120));
    window.addEventListener("load", () => setTimeout(instalar, 180));
    setTimeout(instalar, 240);

    window.HAIKU_FICHA_OCUPACION_RAPIDA_V1 = Object.freeze({
        instalar,
        editar: editarOcupacion
    });

    console.info("HAIKU · Ocupación rápida Supabase V1 preparada.");
})();
