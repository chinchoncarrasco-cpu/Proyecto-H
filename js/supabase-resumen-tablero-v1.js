// =====================================================
// HAIKU · RESUMEN · TABLERO OPERATIVO V1
// Capa de presentación: reutiliza la fecha y los datos
// operativos existentes sin crear ni modificar reservas.
// =====================================================
(() => {
    "use strict";

    const ESTADOS = {
        "libre-libre": "LIBRE",
        "libre-ingresa": "INGRESA",
        "sale-libre": "SALE",
        "sale-ingresa": "SALE / INGRESA",
        continua: "CONTINÚA",
        bloqueada: "BLOQUEADA",
        fullday: "FULLDAY"
    };

    const COLUMNAS_OPERATIVAS = [
        { id: "cabana", nombre: "Cabaña" },
        { id: "estado", nombre: "Estado" },
        { id: "aseo", nombre: "Aseo" },
        { id: "ingreso", nombre: "Ingreso" },
        { id: "notas", nombre: "Notas" },
        { id: "servicios", nombre: "Servicios" },
        { id: "estado-final", nombre: "Estado final" }
    ];

    let actualizacionPendiente = false;
    let arrastreNotas = null;
    const columnasOcultas = new Set();
    const filasOcultasPorFecha = new Map();
    const bloquesAnterioresOcultosPorFecha = new Map();
    const CLAVE_FILAS_OCULTAS = "haikuResumenFilasOcultasPorFechaV2";
    const CLAVE_BLOQUES_ANTERIORES_OCULTOS =
        "haikuResumenDiaAnteriorOcultoPorFechaV1";

    function fechaResumenActiva() {
        try {
            const fecha = String(fechaSeleccionada || "").slice(0, 10);
            return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : "";
        } catch (_) {
            return "";
        }
    }

    function filasOcultasDeFecha(fecha = fechaResumenActiva()) {
        const fechaISO = String(fecha || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) return new Set();

        if (!filasOcultasPorFecha.has(fechaISO)) {
            filasOcultasPorFecha.set(fechaISO, new Set());
        }
        return filasOcultasPorFecha.get(fechaISO);
    }

    function bloquesAnterioresOcultosDeFecha(fecha = fechaResumenActiva()) {
        const fechaISO = String(fecha || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) return new Set();

        if (!bloquesAnterioresOcultosPorFecha.has(fechaISO)) {
            bloquesAnterioresOcultosPorFecha.set(fechaISO, new Set());
        }
        return bloquesAnterioresOcultosPorFecha.get(fechaISO);
    }

    function cargarFilasOcultas() {
        try {
            const guardadas = JSON.parse(
                window.localStorage.getItem(CLAVE_FILAS_OCULTAS) || "{}"
            );
            if (!guardadas || Array.isArray(guardadas) || typeof guardadas !== "object") {
                return;
            }

            Object.entries(guardadas).forEach(([fecha, numeros]) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Array.isArray(numeros)) {
                    return;
                }

                const filas = filasOcultasDeFecha(fecha);
                numeros
                    .map(numero => String(numero || "").trim())
                    .filter(numero => /^\d+$/.test(numero))
                    .forEach(numero => filas.add(numero));
            });
        } catch (_) {
            // Un valor anterior inválido no debe impedir que cargue el tablero.
        }
    }

    function guardarFilasOcultas() {
        try {
            const guardadas = {};
            [...filasOcultasPorFecha.entries()]
                .sort(([fechaA], [fechaB]) => fechaA.localeCompare(fechaB))
                .forEach(([fecha, filas]) => {
                    if (!filas.size) return;
                    guardadas[fecha] = [...filas]
                        .sort((numeroA, numeroB) => Number(numeroA) - Number(numeroB));
                });
            window.localStorage.setItem(
                CLAVE_FILAS_OCULTAS,
                JSON.stringify(guardadas)
            );
        } catch (_) {
            // El tablero sigue funcionando si el navegador bloquea localStorage.
        }
    }

    function cargarBloquesAnterioresOcultos() {
        try {
            const guardados = JSON.parse(
                window.localStorage.getItem(
                    CLAVE_BLOQUES_ANTERIORES_OCULTOS
                ) || "{}"
            );
            if (!guardados || Array.isArray(guardados) || typeof guardados !== "object") {
                return;
            }

            Object.entries(guardados).forEach(([fecha, numeros]) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Array.isArray(numeros)) {
                    return;
                }

                const bloques = bloquesAnterioresOcultosDeFecha(fecha);
                numeros
                    .map(numero => String(numero || "").trim())
                    .filter(numero => /^\d+$/.test(numero))
                    .forEach(numero => bloques.add(numero));
            });
        } catch (_) {
            // Un valor anterior inválido no debe impedir que cargue el tablero.
        }
    }

    function guardarBloquesAnterioresOcultos() {
        try {
            const guardados = {};
            [...bloquesAnterioresOcultosPorFecha.entries()]
                .sort(([fechaA], [fechaB]) => fechaA.localeCompare(fechaB))
                .forEach(([fecha, bloques]) => {
                    if (!bloques.size) return;
                    guardados[fecha] = [...bloques]
                        .sort((numeroA, numeroB) => Number(numeroA) - Number(numeroB));
                });
            window.localStorage.setItem(
                CLAVE_BLOQUES_ANTERIORES_OCULTOS,
                JSON.stringify(guardados)
            );
        } catch (_) {
            // El tablero sigue funcionando si el navegador bloquea localStorage.
        }
    }

    cargarFilasOcultas();
    cargarBloquesAnterioresOcultos();

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

    function estadoRealCabana(cabana) {
        return String(
            cabana?.estadoEstadia ||
            cabana?.estado_estadia ||
            cabana?.estadoReserva ||
            cabana?.estado_reserva ||
            ""
        ).trim().toLowerCase();
    }

    function estadoVisualContexto(cabana) {
        const estado = String(cabana?.estado || "").trim();
        const estadoReal = estadoRealCabana(cabana);

        if (estado === "bloqueada" || estado === "sale-bloqueada") {
            return "bloqueada";
        }
        if (estadoReal === "checked_out" || cabana?.checkoutRealizado === true || String(cabana?.checkout || "").trim()) {
            return "checked_out";
        }
        if (estadoReal === "hospedada" || cabana?.checkinRealizado === true) {
            return "hospedada";
        }
        if (estadoReal === "confirmada") {
            return "confirmada";
        }
        if (estadoReal === "pendiente") {
            return "pendiente";
        }

        return estado || "libre-libre";
    }

    function aplicarEstadoRealFila(fila, cabana) {
        const clases = [
            "cabana-estado-confirmada",
            "cabana-estado-pendiente",
            "cabana-estado-hospedada",
            "cabana-estado-checked-out"
        ];
        fila.classList.remove(...clases);

        const operativo = String(cabana?.estado || "").trim();
        if (["bloqueada", "sale-bloqueada"].includes(operativo)) return;

        const estado = estadoRealCabana(cabana);
        const clase = {
            confirmada: "cabana-estado-confirmada",
            pendiente: "cabana-estado-pendiente",
            hospedada: "cabana-estado-hospedada",
            checked_out: "cabana-estado-checked-out"
        }[estado];
        if (clase) fila.classList.add(clase);
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
        let boton = tabla.querySelector(
            `[data-resumen-contexto-toggle="${tipo}"]`
        );

        if (!etiqueta) {
            etiqueta = document.createElement("span");
            etiqueta.className = "resumen-contexto-cabecera-etiqueta";
            celda.appendChild(etiqueta);
        }

        if (!boton) {
            boton = document.createElement("button");
            boton.type = "button";
            boton.className = "resumen-contexto-toggle";
            boton.dataset.resumenContextoToggle = tipo;
            boton.addEventListener("click", evento => {
                evento.stopPropagation();
                alternarContexto(tabla, tipo);
            });
            celda.appendChild(boton);
        }

        etiqueta.textContent = texto;
        actualizarBotonContexto(tabla, tipo);
    }

    function alternarContexto(tabla, tipo) {
        tabla.classList.toggle(`resumen-contexto-${tipo}-oculto`);
        actualizarBotonContexto(tabla, tipo);
    }

    function ubicarBotonContextoSiguiente(tabla) {
        const cabeceraEstadoFinal = tabla.querySelector(
            'th[data-resumen-columna="estado-final"]'
        );
        const boton = tabla.querySelector(
            '[data-resumen-contexto-toggle="siguiente"]'
        );
        if (!cabeceraEstadoFinal || !boton) return;

        boton.classList.add("resumen-contexto-toggle--estado-final");
        if (boton.parentElement !== cabeceraEstadoFinal) {
            cabeceraEstadoFinal.appendChild(boton);
        }
    }

    function actualizarColumnaOperativa(tabla, columna) {
        const oculto = columnasOcultas.has(columna.id);

        tabla
            .querySelectorAll(`[data-resumen-columna="${columna.id}"]`)
            .forEach(celda => {
                celda.dataset.resumenColumnaOculta = String(oculto);
            });

        const boton = tabla.querySelector(
            `th[data-resumen-columna="${columna.id}"] .resumen-columna-toggle`
        );
        if (!boton) return;

        boton.textContent = oculto ? "+" : "−";
        boton.title = `${oculto ? "Mostrar" : "Ocultar"} columna ${columna.nombre}`;
        boton.setAttribute("aria-label", boton.title);
        boton.setAttribute("aria-expanded", String(!oculto));
    }

    function alternarColumnaOperativa(tabla, columna) {
        if (columnasOcultas.has(columna.id)) {
            columnasOcultas.delete(columna.id);
        } else {
            columnasOcultas.add(columna.id);
        }
        actualizarColumnaOperativa(tabla, columna);
    }

    function manejarToggleColumna(evento) {
        const boton = evento.target.closest?.(".resumen-columna-toggle");
        if (!boton) return;

        const tabla = boton.closest("table");
        const id = boton.closest("th")?.dataset.resumenColumna;
        const columna = COLUMNAS_OPERATIVAS.find(item => item.id === id);
        if (tabla && columna) alternarColumnaOperativa(tabla, columna);
    }

    function configurarColumnasOperativas(tabla) {
        const encabezado = tabla.tHead?.rows?.[0];
        if (!encabezado) return;

        const cabeceras = [...encabezado.cells].filter(
            celda => !celda.classList.contains("resumen-contexto-cabecera")
        );

        COLUMNAS_OPERATIVAS.forEach((columna, indice) => {
            const cabecera = cabeceras[indice];
            if (!cabecera) return;

            cabecera.classList.add("resumen-columna-cabecera");
            cabecera.dataset.resumenColumna = columna.id;

            let etiqueta = cabecera.querySelector(".resumen-columna-etiqueta");
            let boton = cabecera.querySelector(".resumen-columna-toggle");
            if (!etiqueta || !boton) {
                etiqueta = document.createElement("span");
                etiqueta.className = "resumen-columna-etiqueta";
                etiqueta.textContent = columna.nombre;

                boton = document.createElement("button");
                boton.type = "button";
                boton.className = "resumen-columna-toggle";

                cabecera.replaceChildren(etiqueta, boton);
            }

            tabla.querySelectorAll("tbody tr[data-cabana]").forEach(fila => {
                const celdas = [...fila.cells].filter(
                    celda => !celda.classList.contains("resumen-dia-contexto")
                );
                const celda = celdas[indice];
                if (celda) celda.dataset.resumenColumna = columna.id;
            });

            actualizarColumnaOperativa(tabla, columna);
        });
    }

    function actualizarFilaOperativa(fila) {
        const numero = String(fila.dataset.cabana || "");
        const filasOcultas = filasOcultasDeFecha();
        const oculto = filasOcultas.has(numero);
        fila.dataset.resumenFilaOculta = String(oculto);

        const boton = fila.querySelector(".resumen-fila-toggle");
        if (!boton) return;

        boton.textContent = oculto ? "+" : "−";
        boton.title = `${oculto ? "Mostrar" : "Ocultar"} resumen CAB ${numero}`;
        boton.setAttribute("aria-label", boton.title);
        boton.setAttribute("aria-expanded", String(!oculto));
    }

    function actualizarBloqueAnteriorFila(fila) {
        const numero = String(fila.dataset.cabana || "");
        const celda = fila.querySelector(".resumen-dia-contexto--anterior");
        const informacion = fila.querySelector("td.info-cabana");
        const boton = fila.querySelector(".resumen-dia-anterior-fila-toggle");
        if (!numero || !celda || !informacion || !boton) return;

        const oculto = bloquesAnterioresOcultosDeFecha().has(numero);
        celda.dataset.resumenBloqueOculto = String(oculto);
        informacion.dataset.resumenAnteriorExpandido = String(oculto);

        if (oculto) {
            informacion.colSpan = 2;
            if (boton.parentElement !== informacion) {
                informacion.appendChild(boton);
            }
        } else {
            informacion.removeAttribute("colspan");
            if (boton.parentElement !== celda) {
                celda.appendChild(boton);
            }
        }

        boton.textContent = oculto ? "+" : "−";
        boton.title = `${oculto ? "Mostrar" : "Ocultar"} Día anterior de CAB ${numero}`;
        boton.setAttribute("aria-label", boton.title);
        boton.setAttribute("aria-expanded", String(!oculto));
    }

    function configurarBloqueAnteriorFila(fila) {
        const celda = fila.querySelector(".resumen-dia-contexto--anterior");
        if (!celda) return;

        let boton = fila.querySelector(".resumen-dia-anterior-fila-toggle");
        if (!boton) {
            boton = document.createElement("button");
            boton.type = "button";
            boton.className = "resumen-dia-anterior-fila-toggle";
            boton.dataset.resumenDiaAnteriorFilaToggle =
                fila.dataset.cabana || "";
            celda.appendChild(boton);
        }

        actualizarBloqueAnteriorFila(fila);
    }

    function etiquetaFilaMinima(contenedor, tipo) {
        if (!contenedor) return null;

        let etiqueta = contenedor.querySelector(
            `:scope > .resumen-fila-minimo--${tipo}`
        );
        if (!etiqueta) {
            etiqueta = document.createElement("span");
            etiqueta.className =
                `resumen-fila-minimo resumen-fila-minimo--${tipo}`;
            contenedor.appendChild(etiqueta);
        }
        return etiqueta;
    }

    function actualizarDatosFilaMinima(fila) {
        const anterior = fila.querySelector(".resumen-dia-contexto--anterior");
        const informacion = fila.querySelector("td.info-cabana");
        const siguiente = fila.querySelector(".resumen-dia-contexto--siguiente");

        const celdaEstado = fila.querySelector('[data-resumen-columna="estado"]');
        const celdaAseo = fila.querySelector('[data-resumen-columna="aseo"]');
        const celdaIngreso = fila.querySelector('[data-resumen-columna="ingreso"]');
        const celdaNotas = fila.querySelector('[data-resumen-columna="notas"]');
        const celdaServicios = fila.querySelector('[data-resumen-columna="servicios"]');
        const celdaEstadoFinal = fila.querySelector(
            '[data-resumen-columna="estado-final"]'
        );

        const estadoAnterior = etiquetaFilaMinima(anterior, "anterior");
        const resumenActual = etiquetaFilaMinima(informacion, "actual");
        const estadoSiguiente = etiquetaFilaMinima(siguiente, "siguiente");
        const estadoActual = etiquetaFilaMinima(celdaEstado, "estado");
        const aseoActual = etiquetaFilaMinima(celdaAseo, "aseo");
        const ingresoActual = etiquetaFilaMinima(celdaIngreso, "ingreso");
        const notasActuales = etiquetaFilaMinima(celdaNotas, "notas");
        const serviciosActuales = etiquetaFilaMinima(celdaServicios, "servicios");
        const estadoFinal = etiquetaFilaMinima(celdaEstadoFinal, "estado-final");

        const textoSelect = select => {
            if (!select || !String(select.value || "").trim()) return "";
            return select.selectedOptions?.[0]?.textContent?.trim() || "";
        };

        const textoSinControles = elemento => {
            if (!elemento) return "";
            const copia = elemento.cloneNode(true);
            copia
                .querySelectorAll("button, input, select, textarea")
                .forEach(control => control.remove());
            return String(copia.textContent || "")
                .replace(/\s+/g, " ")
                .trim();
        };

        if (estadoAnterior) {
            estadoAnterior.textContent = anterior
                ?.querySelector(".resumen-dia-contexto-estado")
                ?.textContent?.trim() || "LIBRE";
        }

        if (resumenActual) {
            const cabana = informacion
                ?.querySelector(".cabana-ficha-boton")
                ?.textContent?.trim() || `CAB ${fila.dataset.cabana || ""}`;
            const titular = informacion
                ?.querySelector(".titular-cabana")
                ?.textContent?.trim() || "Sin titular";
            const nochesElemento = informacion?.querySelector(".cabana-noches");
            const nochesValor = nochesElemento
                ?.querySelector(".valor-noches")
                ?.textContent?.trim() || "";
            const noches = nochesElemento ? ` ${nochesValor}N` : "";
            resumenActual.textContent = `${cabana} · ${titular}${noches}`;
        }

        if (estadoSiguiente) {
            estadoSiguiente.textContent = siguiente
                ?.querySelector(".resumen-dia-contexto-estado")
                ?.textContent?.trim() || "LIBRE";
        }

        if (estadoActual) {
            const select = celdaEstado?.querySelector('select[data-campo="estado"]');
            const checkin = celdaEstado?.querySelector(
                'input[data-campo="checkinRealizado"]'
            )?.checked;
            const partes = [textoSelect(select)];
            if (checkin) partes.push("CHECK-IN");
            estadoActual.textContent = partes.filter(Boolean).join(" · ");
        }

        if (aseoActual) {
            const encargado = celdaAseo
                ?.querySelector('input[data-campo="aseo"]')
                ?.value?.trim() || "";
            const horaInicio = celdaAseo
                ?.querySelector('input[data-campo="aseoIn"]')
                ?.value?.trim() || "";
            const horaFin = celdaAseo
                ?.querySelector('input[data-campo="aseoOut"]')
                ?.value?.trim() || "";
            const horario = horaInicio && horaFin
                ? `${horaInicio}–${horaFin}`
                : (horaInicio || horaFin);
            aseoActual.textContent = [encargado, horario]
                .filter(Boolean)
                .join(" · ");
        }

        if (ingresoActual) {
            ingresoActual.textContent = celdaIngreso
                ?.querySelector('input[data-campo="ingreso"]')
                ?.value?.trim() || "";
        }

        if (notasActuales) {
            const notas = [
                ...(celdaNotas?.querySelectorAll(".nota-operativa-item") || [])
            ]
                .map(textoSinControles)
                .filter(Boolean);
            if (!notas.length) {
                const caja = celdaNotas?.querySelector(".nota-cabana");
                const texto = textoSinControles(caja);
                if (texto) notas.push(texto);
            }
            notasActuales.textContent = notas.join(" · ");
        }

        if (serviciosActuales) {
            serviciosActuales.textContent = celdaServicios
                ?.querySelector('input[data-campo="servicio"]')
                ?.value?.trim() || "";
        }

        if (estadoFinal) {
            estadoFinal.textContent = textoSelect(
                celdaEstadoFinal?.querySelector('select[data-campo="estadoFinal"]')
            );
        }
    }

    function configurarFilasOperativas(tabla) {
        tabla.querySelectorAll("tbody tr[data-cabana]").forEach(fila => {
            const informacion = fila.querySelector("td.info-cabana");
            if (!informacion) return;

            let boton = informacion.querySelector(":scope > .resumen-fila-toggle");
            if (!boton) {
                boton = document.createElement("button");
                boton.type = "button";
                boton.className = "resumen-fila-toggle";
                boton.dataset.resumenFilaToggle = fila.dataset.cabana || "";
                informacion.prepend(boton);
            }

            configurarBloqueAnteriorFila(fila);
            actualizarDatosFilaMinima(fila);
            actualizarFilaOperativa(fila);
        });
    }

    function manejarToggleBloqueAnterior(evento) {
        const boton = evento.target.closest?.(
            ".resumen-dia-anterior-fila-toggle"
        );
        if (!boton) return;

        evento.preventDefault();
        evento.stopPropagation();

        const fila = boton.closest("tr[data-cabana]");
        const numero = String(fila?.dataset.cabana || "");
        if (!fila || !numero) return;

        const ocultos = bloquesAnterioresOcultosDeFecha();
        if (ocultos.has(numero)) {
            ocultos.delete(numero);
        } else {
            ocultos.add(numero);
        }
        guardarBloquesAnterioresOcultos();
        actualizarBloqueAnteriorFila(fila);
    }

    function manejarToggleFila(evento) {
        const boton = evento.target.closest?.(".resumen-fila-toggle");
        if (!boton) return;

        const fila = boton.closest("tr[data-cabana]");
        const numero = String(fila?.dataset.cabana || "");
        if (!fila || !numero) return;

        const filasOcultas = filasOcultasDeFecha();
        if (filasOcultas.has(numero)) {
            filasOcultas.delete(numero);
        } else {
            filasOcultas.add(numero);
        }
        guardarFilasOcultas();
        actualizarDatosFilaMinima(fila);
        actualizarFilaOperativa(fila);
    }

    function asegurarEstructura() {
        const tabla = document.querySelector(
            "#seccion-resumen .tabla-contenedor > table"
        );
        if (!tabla) return null;

        tabla.classList.add("resumen-tablero");
        const contenedor = tabla.closest(".tabla-contenedor");
        if (contenedor) {
            contenedor.tabIndex = 0;
            contenedor.setAttribute(
                "aria-label",
                "Estado de cabañas: desliza horizontalmente para recorrer las columnas"
            );
        }

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

    function activarContextos(tabla) {
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

        activarContextos(tabla);
        configurarColumnasOperativas(tabla);
        ubicarBotonContextoSiguiente(tabla);
        configurarFilasOperativas(tabla);

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
            aplicarEstadoRealFila(fila, datosCabana(actual, numero));

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
            actualizarDatosFilaMinima(fila);
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

    function navegarHoy() {
        const actual = new Date();
        const anio = actual.getFullYear();
        const mes = actual.getMonth();
        const dia = actual.getDate();
        const fecha = [anio, mes + 1, dia]
            .map((parte, indice) =>
                indice === 0 ? String(parte) : String(parte).padStart(2, "0")
            )
            .join("-");

        seleccionarDia(anio, mes, dia, fecha);
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
            .getElementById("resumen-dia-hoy")
            ?.addEventListener("click", navegarHoy);
        document
            .getElementById("resumen-dia-siguiente")
            ?.addEventListener("click", () => navegar(1));
        document.addEventListener("click", manejarToggleColumna);
        document.addEventListener("click", manejarToggleFila);
        document.addEventListener("click", manejarToggleBloqueAnterior);

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
