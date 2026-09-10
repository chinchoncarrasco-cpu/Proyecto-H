// ========================================
// FECHA ACTUAL EN CABECERAS PRINCIPALES
// ========================================

(function mostrarFechaActualEnSecciones() {

    "use strict";

    const ahora = new Date();

    const formateadorFecha =
        new Intl.DateTimeFormat("es-CL", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        });

    let textoFecha =
        formateadorFecha.format(ahora);

    textoFecha =
        textoFecha.charAt(0).toUpperCase() +
        textoFecha.slice(1);

    document
        .querySelectorAll(".seccion-app > .cabecera")
        .forEach(cabecera => {

            // Resumen ya tiene su fecha propia.
            if (
                cabecera.closest("#seccion-resumen")
            ) {
                return;
            }

            const titulo =
                cabecera.querySelector("h1, h2");

            if (!titulo) {
                return;
            }

            let fecha =
                cabecera.querySelector(
                    ".fecha-seccion-actual"
                );

            if (!fecha) {
                fecha = document.createElement("p");
                fecha.className =
                    "texto-secundario fecha-seccion-actual";

                titulo.insertAdjacentElement(
                    "afterend",
                    fecha
                );
            }

            fecha.textContent = textoFecha;
        });

})();

// ========================================
// HAIKU · HISTORIAL GENERAL Y DE RESERVA
// ========================================

(function iniciarHistorialHaiku() {

    "use strict";

    const CLAVE_HISTORIAL =
        "haikuHistorialActividades";

    const USUARIO_MANUAL =
        "Usuario Haiku";

    const LIMITE_REGISTROS = 5000;

    function leerHistorial() {
        try {
            const registros = JSON.parse(
                localStorage.getItem(CLAVE_HISTORIAL) || "[]"
            );

            return Array.isArray(registros)
                ? registros
                : [];
        } catch (error) {
            console.error(
                "No se pudo leer el historial HAIKU:",
                error
            );
            return [];
        }
    }

    function guardarHistorial(registros) {
        localStorage.setItem(
            CLAVE_HISTORIAL,
            JSON.stringify(
                registros.slice(-LIMITE_REGISTROS)
            )
        );
    }

    function generarIdActividad() {
        if (
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
        ) {
            return `ACT-${crypto.randomUUID()}`;
        }

        return `ACT-${Date.now()}-${
            Math.random().toString(36).slice(2, 9)
        }`;
    }

    function limpiarTexto(valor) {
        return String(valor ?? "").trim();
    }

    function normalizarCambios(cambios) {
        if (!Array.isArray(cambios)) {
            return [];
        }

        return cambios
            .map(cambio => ({
                campo: limpiarTexto(cambio?.campo),
                anterior: limpiarTexto(cambio?.anterior),
                nuevo: limpiarTexto(cambio?.nuevo)
            }))
            .filter(cambio =>
                cambio.campo &&
                cambio.anterior !== cambio.nuevo
            );
    }

    function registrarActividadHaiku(datos = {}) {
        const accion = limpiarTexto(datos.accion);

        if (!accion) {
            return null;
        }

        const registro = {
            id: generarIdActividad(),
            fechaHora: new Date().toISOString(),
            usuario:
                limpiarTexto(datos.usuario) ||
                USUARIO_MANUAL,
            tipo:
                limpiarTexto(datos.tipo) ||
                "general",
            accion,
            detalle: limpiarTexto(datos.detalle),
            reservaId: limpiarTexto(datos.reservaId),
            numeroCabana:
                limpiarTexto(datos.numeroCabana),
            titular: limpiarTexto(datos.titular),
            fechaOperacion:
                limpiarTexto(datos.fechaOperacion),
            cambios: normalizarCambios(datos.cambios)
        };

        const registros = leerHistorial();

        const ultimo =
            registros[registros.length - 1];

        const mismoRegistro =
            ultimo &&
            ultimo.accion === registro.accion &&
            ultimo.reservaId === registro.reservaId &&
            ultimo.numeroCabana ===
                registro.numeroCabana &&
            ultimo.detalle === registro.detalle &&
            JSON.stringify(ultimo.cambios || []) ===
                JSON.stringify(registro.cambios || []) &&
            new Date(registro.fechaHora) -
                new Date(ultimo.fechaHora) < 1200;

        if (mismoRegistro) {
            return ultimo;
        }

        registros.push(registro);
        guardarHistorial(registros);

        window.dispatchEvent(
            new CustomEvent(
                "haiku:historial-actualizado",
                { detail: registro }
            )
        );

        return registro;
    }

    function obtenerHistorialReserva(reservaId) {
        return leerHistorial()
            .filter(registro =>
                String(registro?.reservaId || "") ===
                String(reservaId || "")
            )
            .sort(
                (a, b) =>
                    new Date(b.fechaHora) -
                    new Date(a.fechaHora)
            );
    }

    window.registrarActividadHaiku =
        registrarActividadHaiku;

    window.HistorialHaiku = {
        leer: leerHistorial,
        registrar: registrarActividadHaiku,
        buscarPorReserva: obtenerHistorialReserva,
        usuarioActual: USUARIO_MANUAL
    };

    const seccionHistorial =
        document.getElementById("seccion-historial");

    const listaGeneral =
        document.getElementById("historial-lista");

    const contadorGeneral =
        document.getElementById("historial-contador");

    const buscarGeneral =
        document.getElementById("historial-buscar");

    const fechaDesdeGeneral =
        document.getElementById("historial-desde");

    const fechaHastaGeneral =
        document.getElementById("historial-hasta");

    const tipoGeneral =
        document.getElementById("historial-tipo");

    const limpiarFiltrosGeneral =
        document.getElementById(
            "historial-limpiar-filtros"
        );

    const modalReserva =
        document.getElementById(
            "historial-reserva-modal"
        );

    const cerrarModalReserva =
        document.getElementById(
            "historial-reserva-cerrar"
        );

    const listaReserva =
        document.getElementById(
            "historial-reserva-lista"
        );

    const tituloReserva =
        document.getElementById(
            "historial-reserva-titulo"
        );

    const metaReserva =
        document.getElementById(
            "historial-reserva-meta"
        );

    function crearElemento(
        etiqueta,
        clase,
        texto
    ) {
        const elemento =
            document.createElement(etiqueta);

        if (clase) {
            elemento.className = clase;
        }

        if (texto !== undefined) {
            elemento.textContent = texto;
        }

        return elemento;
    }

    function formatearFechaHora(fechaHora) {
        const fecha = new Date(fechaHora);

        if (Number.isNaN(fecha.getTime())) {
            return "Fecha desconocida";
        }

        return fecha.toLocaleString("es-CL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
    }

    function obtenerFechaLocal(fechaHora) {
        const fecha = new Date(fechaHora);

        if (Number.isNaN(fecha.getTime())) {
            return "";
        }

        const anio = fecha.getFullYear();
        const mes = String(
            fecha.getMonth() + 1
        ).padStart(2, "0");
        const dia = String(
            fecha.getDate()
        ).padStart(2, "0");

        return `${anio}-${mes}-${dia}`;
    }

    function nombreTipo(tipo) {
        const nombres = {
            reserva: "Reserva",
            estado: "Estado",
            pago: "Pago",
            servicio: "Servicio",
            bloqueo: "Bloqueo",
            nota: "Nota",
            solicitud: "Solicitud",
            cabana: "Cabaña",
            general: "General"
        };

        return nombres[tipo] || "Actividad";
    }

    function crearRegistroVisual(registro) {
        const articulo = crearElemento(
            "article",
            `historial-registro historial-tipo-${
                registro.tipo || "general"
            }`
        );

        const resumen = crearElemento(
            "button",
            "historial-registro-resumen"
        );
        resumen.type = "button";
        resumen.setAttribute("aria-expanded", "false");

        const marca = crearElemento(
            "span",
            "historial-registro-marca"
        );

        const contenido = crearElemento(
            "span",
            "historial-registro-contenido"
        );

        const encabezado = crearElemento(
            "span",
            "historial-registro-encabezado"
        );

        encabezado.appendChild(
            crearElemento(
                "strong",
                "historial-registro-accion",
                registro.accion || "Actividad"
            )
        );

        encabezado.appendChild(
            crearElemento(
                "em",
                "historial-registro-tipo",
                nombreTipo(registro.tipo)
            )
        );

        const referencias = [];

        if (registro.numeroCabana) {
            referencias.push(
                `CAB ${registro.numeroCabana}`
            );
        }

        if (registro.titular) {
            referencias.push(registro.titular);
        }

        if (registro.reservaId) {
            referencias.push(registro.reservaId);
        }

        const meta = crearElemento(
            "span",
            "historial-registro-meta",
            referencias.join(" · ") ||
                "Actividad general"
        );

        const pie = crearElemento(
            "span",
            "historial-registro-pie"
        );

        pie.appendChild(
            crearElemento(
                "time",
                "",
                formatearFechaHora(registro.fechaHora)
            )
        );

        pie.appendChild(
            crearElemento(
                "span",
                "",
                registro.usuario || USUARIO_MANUAL
            )
        );

        contenido.appendChild(encabezado);
        contenido.appendChild(meta);
        contenido.appendChild(pie);

        const indicador = crearElemento(
            "span",
            "historial-registro-indicador",
            "+"
        );

        resumen.appendChild(marca);
        resumen.appendChild(contenido);
        resumen.appendChild(indicador);

        const detalle = crearElemento(
            "div",
            "historial-registro-detalle"
        );
        detalle.hidden = true;

        if (registro.detalle) {
            detalle.appendChild(
                crearElemento(
                    "p",
                    "historial-registro-descripcion",
                    registro.detalle
                )
            );
        }

        if (registro.fechaOperacion) {
            detalle.appendChild(
                crearElemento(
                    "p",
                    "historial-registro-fecha-operacion",
                    `Fecha operativa: ${registro.fechaOperacion}`
                )
            );
        }

        if (
            Array.isArray(registro.cambios) &&
            registro.cambios.length > 0
        ) {
            const cambios = crearElemento(
                "div",
                "historial-registro-cambios"
            );

            registro.cambios.forEach(cambio => {
                const fila = crearElemento(
                    "div",
                    "historial-cambio"
                );

                fila.appendChild(
                    crearElemento(
                        "strong",
                        "",
                        cambio.campo
                    )
                );

                fila.appendChild(
                    crearElemento(
                        "span",
                        "",
                        `${cambio.anterior || "—"} → ${
                            cambio.nuevo || "—"
                        }`
                    )
                );

                cambios.appendChild(fila);
            });

            detalle.appendChild(cambios);
        }

        if (!detalle.childElementCount) {
            detalle.appendChild(
                crearElemento(
                    "p",
                    "historial-registro-descripcion",
                    "La acción quedó registrada sin información adicional."
                )
            );
        }

        resumen.addEventListener("click", () => {
            const abrir = detalle.hidden;
            detalle.hidden = !abrir;
            resumen.setAttribute(
                "aria-expanded",
                String(abrir)
            );
            indicador.textContent = abrir ? "−" : "+";
        });

        articulo.appendChild(resumen);
        articulo.appendChild(detalle);

        return articulo;
    }

    function mostrarLista(
        contenedor,
        registros,
        mensajeVacio
    ) {
        if (!contenedor) return;

        contenedor.innerHTML = "";

        if (registros.length === 0) {
            contenedor.appendChild(
                crearElemento(
                    "p",
                    "historial-vacio",
                    mensajeVacio
                )
            );
            return;
        }

        registros.forEach(registro => {
            contenedor.appendChild(
                crearRegistroVisual(registro)
            );
        });
    }

    function obtenerRegistrosFiltrados() {
        const texto = limpiarTexto(
            buscarGeneral?.value
        ).toLocaleLowerCase("es-CL");

        const desde = fechaDesdeGeneral?.value || "";
        const hasta = fechaHastaGeneral?.value || "";
        const tipo = tipoGeneral?.value || "";

        return leerHistorial()
            .filter(registro => {
                const fechaRegistro =
                    obtenerFechaLocal(registro.fechaHora);

                if (desde && fechaRegistro < desde) {
                    return false;
                }

                if (hasta && fechaRegistro > hasta) {
                    return false;
                }

                if (tipo && registro.tipo !== tipo) {
                    return false;
                }

                if (!texto) {
                    return true;
                }

                const contenido = [
                    registro.accion,
                    registro.detalle,
                    registro.usuario,
                    registro.tipo,
                    registro.reservaId,
                    registro.numeroCabana,
                    registro.titular,
                    ...(registro.cambios || []).flatMap(
                        cambio => [
                            cambio.campo,
                            cambio.anterior,
                            cambio.nuevo
                        ]
                    )
                ]
                    .join(" ")
                    .toLocaleLowerCase("es-CL");

                return contenido.includes(texto);
            })
            .sort(
                (a, b) =>
                    new Date(b.fechaHora) -
                    new Date(a.fechaHora)
            );
    }

    function renderizarHistorialGeneral() {
        if (!listaGeneral) return;

        const registros =
            obtenerRegistrosFiltrados();

        if (contadorGeneral) {
            contadorGeneral.textContent =
                `${registros.length} ${
                    registros.length === 1
                        ? "acción"
                        : "acciones"
                }`;
        }

        mostrarLista(
            listaGeneral,
            registros,
            "Todavía no existen acciones para mostrar con estos filtros."
        );
    }

    function abrirHistorialReservaActual() {
        const ficha = document.getElementById(
            "ficha-reserva-modal"
        );

        const reservaId =
            ficha?.dataset.reservaId || "";

        if (!reservaId || !modalReserva) {
            return;
        }

        const numeroCabana =
            ficha?.dataset.numeroCabana || "";

        const titular =
            document.getElementById(
                "ficha-reserva-titular"
            )?.textContent.trim() || "";

        if (tituloReserva) {
            tituloReserva.textContent =
                "Historial de la reserva";
        }

        if (metaReserva) {
            metaReserva.textContent = [
                numeroCabana
                    ? `CAB ${numeroCabana}`
                    : "",
                titular,
                reservaId
            ].filter(Boolean).join(" · ");
        }

        mostrarLista(
            listaReserva,
            obtenerHistorialReserva(reservaId),
            "Esta reserva todavía no tiene acciones registradas en el historial."
        );

        modalReserva.dataset.reservaId = reservaId;
        modalReserva.hidden = false;
        document.body.classList.add(
            "historial-modal-abierto"
        );
    }

    function cerrarHistorialReservaActual() {
        if (!modalReserva) return;

        modalReserva.hidden = true;
        modalReserva.dataset.reservaId = "";
        document.body.classList.remove(
            "historial-modal-abierto"
        );
    }

    [
        buscarGeneral,
        fechaDesdeGeneral,
        fechaHastaGeneral,
        tipoGeneral
    ].forEach(campo => {
        campo?.addEventListener(
            campo === buscarGeneral ? "input" : "change",
            renderizarHistorialGeneral
        );
    });

    limpiarFiltrosGeneral?.addEventListener(
        "click",
        () => {
            if (buscarGeneral) buscarGeneral.value = "";
            if (fechaDesdeGeneral) fechaDesdeGeneral.value = "";
            if (fechaHastaGeneral) fechaHastaGeneral.value = "";
            if (tipoGeneral) tipoGeneral.value = "";
            renderizarHistorialGeneral();
        }
    );

    document.addEventListener("click", evento => {
        if (
            evento.target.closest(
                "#ficha-reserva-historial"
            )
        ) {
            abrirHistorialReservaActual();
            return;
        }

        if (
            evento.target.closest(
                '.menu-item[data-seccion="historial"]'
            )
        ) {
            renderizarHistorialGeneral();
        }
    });

    cerrarModalReserva?.addEventListener(
        "click",
        cerrarHistorialReservaActual
    );

    modalReserva?.addEventListener("click", evento => {
        if (evento.target === modalReserva) {
            cerrarHistorialReservaActual();
        }
    });

    document.addEventListener("keydown", evento => {
        if (
            evento.key === "Escape" &&
            modalReserva &&
            !modalReserva.hidden
        ) {
            cerrarHistorialReservaActual();
        }
    });

    window.addEventListener(
        "haiku:historial-actualizado",
        evento => {
            if (
                seccionHistorial?.classList.contains(
                    "activa"
                )
            ) {
                renderizarHistorialGeneral();
            }

            const reservaAbierta =
                modalReserva?.dataset.reservaId || "";

            if (
                reservaAbierta &&
                String(evento.detail?.reservaId || "") ===
                    String(reservaAbierta)
            ) {
                mostrarLista(
                    listaReserva,
                    obtenerHistorialReserva(
                        reservaAbierta
                    ),
                    "Esta reserva todavía no tiene acciones registradas en el historial."
                );
            }
        }
    );

    renderizarHistorialGeneral();

})();