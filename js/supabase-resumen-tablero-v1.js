// =====================================================
// HAIKU · RESUMEN · TABLERO OPERATIVO V1
// Capa de presentación: reutiliza la fecha y los datos
// operativos existentes sin crear ni modificar reservas.
// =====================================================
(() => {
    "use strict";

    const MEDIA_ESCRITORIO = "(min-width: 901px)";
    const ESTADOS = {
        "libre-libre": "LIBRE",
        "libre-ingresa": "INGRESA",
        "sale-libre": "SALE",
        "sale-ingresa": "SALE / INGRESA",
        continua: "CONTINÚA",
        bloqueada: "BLOQUEADA",
        fullday: "FULLDAY"
    };

    let actualizacionPendiente = false;
    let arrastreNotas = null;

    function fechaVisible(fecha) {
        if (!fecha) return "";

        const [anio, mes, dia] = String(fecha)
            .slice(0, 10)
            .split("-")
            .map(Number);

        if (!anio || !mes || !dia) return "";

        return new Intl.DateTimeFormat("es-CL", {
            day: "numeric",
            month: "short",
            year: "numeric"
        })
            .format(new Date(anio, mes - 1, dia))
            .replace(/\./g, "");
    }

    function datosCabana(fecha, numeroCabana) {
        try {
            return datosPorFecha?.[fecha]?.cabanas?.[numeroCabana] || null;
        } catch (_) {
            return null;
        }
    }

    function estadoVisualContexto(cabana) {
        const estado = String(cabana?.estado || "").trim();

        if (estado === "bloqueada" || estado === "sale-bloqueada") {
            return "bloqueada";
        }
        if (cabana?.checkoutRealizado === true || String(cabana?.checkout || "").trim()) {
            return "checkout";
        }
        if (cabana?.checkinRealizado === true) {
            return "checkin";
        }

        return estado || "libre-libre";
    }

    function resumenContexto(fecha, numeroCabana) {
        const cabana = datosCabana(fecha, numeroCabana);
        const titular = String(cabana?.titular || "").trim();
        const estado = String(cabana?.estado || "").trim();

        return {
            fecha: fechaVisible(fecha),
            titular: titular || "Sin reserva",
            estado: ESTADOS[estado] || (estado ? estado.toUpperCase() : "LIBRE"),
            estadoVisual: estadoVisualContexto(cabana)
        };
    }

    function crearCeldaContexto(tipo) {
        const celda = document.createElement("td");
        celda.className = `resumen-dia-contexto resumen-dia-contexto--${tipo}`;
        celda.innerHTML = `
            <time class="resumen-dia-contexto-fecha"></time>
            <strong class="resumen-dia-contexto-titular"></strong>
            <em class="resumen-dia-contexto-estado"></em>
        `;
        return celda;
    }

    function moverCheckoutAlContextoAnterior(fila) {
        const contextoAnterior = fila.querySelector(
            ".resumen-dia-contexto--anterior"
        );
        const checkout = fila.querySelector(".checkout-cabana");

        if (contextoAnterior && checkout && checkout.parentElement !== contextoAnterior) {
            contextoAnterior.appendChild(checkout);
        }
    }

    function restaurarCheckoutOriginal(fila) {
        const checkout = fila.querySelector(
            ".resumen-dia-contexto--anterior .checkout-cabana"
        );
        const informacion = fila.querySelector("td.info-cabana");

        if (checkout && informacion) informacion.appendChild(checkout);
    }

    function actualizarBotonContexto(tabla, tipo) {
        const boton = tabla.querySelector(
            `[data-resumen-contexto-toggle="${tipo}"]`
        );
        if (!boton) return;

        const oculto = tabla.classList.contains(
            `resumen-contexto-${tipo}-oculto`
        );
        const nombre = tipo === "anterior" ? "día anterior" : "día siguiente";

        boton.textContent = tipo === "anterior"
            ? (oculto ? "›" : "‹")
            : (oculto ? "‹" : "›");
        boton.title = `${oculto ? "Mostrar" : "Ocultar"} ${nombre}`;
        boton.setAttribute("aria-label", boton.title);
        boton.setAttribute("aria-expanded", String(!oculto));
    }

    function configurarCabeceraContexto(tabla, celda, tipo, texto) {
        let etiqueta = celda.querySelector(".resumen-contexto-cabecera-etiqueta");
        let boton = celda.querySelector("[data-resumen-contexto-toggle]");

        if (!etiqueta || !boton) {
            celda.replaceChildren();
            etiqueta = document.createElement("span");
            etiqueta.className = "resumen-contexto-cabecera-etiqueta";
            boton = document.createElement("button");
            boton.type = "button";
            boton.className = "resumen-contexto-toggle";
            boton.dataset.resumenContextoToggle = tipo;
            boton.addEventListener("click", evento => {
                evento.stopPropagation();
                alternarContexto(tabla, tipo);
            });
            celda.append(etiqueta, boton);
        }

        etiqueta.textContent = texto;
        actualizarBotonContexto(tabla, tipo);
    }

    function alternarContexto(tabla, tipo) {
        tabla.classList.toggle(`resumen-contexto-${tipo}-oculto`);
        actualizarBotonContexto(tabla, tipo);
    }

    function asegurarEstructura() {
        const tabla = document.querySelector(
            "#seccion-resumen .tabla-contenedor > table"
        );
        if (!tabla) return null;

        tabla.classList.add("resumen-tablero");

        tabla.querySelectorAll("tbody tr[data-cabana]").forEach(fila => {
            const notas = fila.querySelector(".celda-notas");
            const ingreso = fila.querySelector('[data-campo="ingreso"]')?.closest("td");

            // El encabezado y el diseño aprobado sitúan INGRESO antes de NOTAS.
            // Sólo se reorganizan las mismas celdas y se conservan sus bindings.
            if (notas && ingreso && notas.nextElementSibling === ingreso) {
                fila.insertBefore(ingreso, notas);
            }
        });

        return tabla;
    }

    function activarContextosEscritorio(tabla) {
        if (!window.matchMedia(MEDIA_ESCRITORIO).matches) {
            tabla
                .querySelectorAll("tbody tr[data-cabana]")
                .forEach(restaurarCheckoutOriginal);
            tabla
                .querySelectorAll(".resumen-dia-contexto, .resumen-contexto-cabecera")
                .forEach(elemento => elemento.remove());
            return;
        }

        const encabezado = tabla.tHead?.rows?.[0];
        if (encabezado) {
            let anterior = encabezado.querySelector(
                ".resumen-contexto-cabecera--anterior"
            );
            if (!anterior) {
                anterior = document.createElement("th");
                encabezado.insertBefore(anterior, encabezado.firstElementChild);
            }
            anterior.className =
                "resumen-contexto-cabecera resumen-contexto-cabecera--anterior";
            anterior.scope = "col";
            configurarCabeceraContexto(tabla, anterior, "anterior", "DÍA ANTERIOR");

            let siguiente = encabezado.querySelector(
                ".resumen-contexto-cabecera--siguiente"
            );
            if (!siguiente) {
                siguiente = document.createElement("th");
                encabezado.appendChild(siguiente);
            }
            siguiente.className =
                "resumen-contexto-cabecera resumen-contexto-cabecera--siguiente";
            siguiente.scope = "col";
            configurarCabeceraContexto(tabla, siguiente, "siguiente", "DÍA SIGUIENTE");
        }

        tabla.querySelectorAll("tbody tr[data-cabana]").forEach(fila => {
            if (!fila.querySelector(".resumen-dia-contexto--anterior")) {
                fila.insertBefore(
                    crearCeldaContexto("anterior"),
                    fila.firstElementChild
                );
            }

            if (!fila.querySelector(".resumen-dia-contexto--siguiente")) {
                fila.appendChild(crearCeldaContexto("siguiente"));
            }

            moverCheckoutAlContextoAnterior(fila);
        });
    }

    function pintarContexto(celda, etiqueta, datos) {
        if (!celda) return;

        celda.querySelector(".resumen-dia-contexto-fecha").textContent = datos.fecha;
        celda.querySelector(".resumen-dia-contexto-titular").textContent = datos.titular;
        celda.querySelector(".resumen-dia-contexto-estado").textContent = datos.estado;
        celda.dataset.estadoVisual = datos.estadoVisual;
        celda.title = `${etiqueta}: ${datos.titular} · ${datos.estado}`;
    }

    function actualizarContextos() {
        actualizacionPendiente = false;

        const tabla = asegurarEstructura();
        if (!tabla) return;

        activarContextosEscritorio(tabla);
        if (!window.matchMedia(MEDIA_ESCRITORIO).matches) return;

        let actual;
        try {
            actual = fechaSeleccionada;
        } catch (_) {
            return;
        }
        if (!actual) return;

        const anterior = sumarDiasFecha(actual, -1);
        const siguiente = sumarDiasFecha(actual, 1);

        tabla.querySelectorAll("tbody tr[data-cabana]").forEach(fila => {
            const numero = String(fila.dataset.cabana || "");

            pintarContexto(
                fila.querySelector(".resumen-dia-contexto--anterior"),
                "Día anterior",
                resumenContexto(anterior, numero)
            );
            pintarContexto(
                fila.querySelector(".resumen-dia-contexto--siguiente"),
                "Día siguiente",
                resumenContexto(siguiente, numero)
            );
        });
    }

    function programarActualizacion() {
        if (actualizacionPendiente) return;
        actualizacionPendiente = true;
        requestAnimationFrame(actualizarContextos);
    }

    function navegar(diferencia) {
        let actual;
        try {
            actual = fechaSeleccionada;
        } catch (_) {
            return;
        }

        const nuevaFecha = sumarDiasFecha(actual, diferencia);
        const [anio, mes, dia] = nuevaFecha.split("-").map(Number);

        // Reutiliza exactamente el flujo existente de selección de fecha.
        seleccionarDia(anio, mes - 1, dia, nuevaFecha);
        programarActualizacion();
    }

    function iniciarArrastreNotas(evento) {
        const caja = evento.target.closest?.(
            "#seccion-resumen .nota-cabana"
        );

        if (
            !caja ||
            evento.button !== 0 ||
            evento.target.closest("button, a, input, select, textarea") ||
            caja.scrollWidth <= caja.clientWidth
        ) {
            return;
        }

        arrastreNotas = {
            caja,
            puntero: evento.pointerId,
            inicioX: evento.clientX,
            scrollInicial: caja.scrollLeft
        };
        caja.classList.add("nota-cabana--arrastrando");
        caja.setPointerCapture?.(evento.pointerId);
    }

    function moverArrastreNotas(evento) {
        if (!arrastreNotas || evento.pointerId !== arrastreNotas.puntero) return;

        arrastreNotas.caja.scrollLeft =
            arrastreNotas.scrollInicial - (evento.clientX - arrastreNotas.inicioX);
        evento.preventDefault();
    }

    function terminarArrastreNotas(evento) {
        if (!arrastreNotas || evento.pointerId !== arrastreNotas.puntero) return;

        arrastreNotas.caja.classList.remove("nota-cabana--arrastrando");
        arrastreNotas.caja.releasePointerCapture?.(evento.pointerId);
        arrastreNotas = null;
    }

    function iniciar() {
        const tabla = asegurarEstructura();
        if (!tabla) return;

        document
            .getElementById("resumen-dia-anterior")
            ?.addEventListener("click", () => navegar(-1));
        document
            .getElementById("resumen-dia-siguiente")
            ?.addEventListener("click", () => navegar(1));

        const cargarOriginal = window.cargarCabanasDia;
        if (
            typeof cargarOriginal === "function" &&
            !cargarOriginal.__haikuResumenTablero
        ) {
            const cargarConContexto = function (...argumentos) {
                const resultado = cargarOriginal.apply(this, argumentos);
                programarActualizacion();
                return resultado;
            };
            cargarConContexto.__haikuResumenTablero = true;
            window.cargarCabanasDia = cargarConContexto;
        }

        const observar = new MutationObserver(cambios => {
            const cambioOperativo = cambios.some(cambio =>
                !cambio.target.parentElement?.closest?.(".resumen-dia-contexto")
            );
            if (cambioOperativo) programarActualizacion();
        });
        observar.observe(tabla.tBodies[0], {
            childList: true,
            characterData: true,
            subtree: true
        });

        const media = window.matchMedia(MEDIA_ESCRITORIO);
        media.addEventListener?.("change", programarActualizacion);

        tabla.addEventListener("pointerdown", iniciarArrastreNotas);
        tabla.addEventListener("click", evento => {
            const boton = evento.target.closest?.(
                "[data-resumen-contexto-toggle]"
            );
            if (!boton) return;

            alternarContexto(tabla, boton.dataset.resumenContextoToggle);
        });
        window.addEventListener("pointermove", moverArrastreNotas, {
            passive: false
        });
        window.addEventListener("pointerup", terminarArrastreNotas);
        window.addEventListener("pointercancel", terminarArrastreNotas);

        programarActualizacion();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
