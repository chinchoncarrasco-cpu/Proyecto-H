// ========================================
// NAVEGACIÓN PRINCIPAL
// ========================================

const botonesMenu = document.querySelectorAll(".menu-item[data-seccion]");
const seccionesApp = document.querySelectorAll(".seccion-app");

// ========================================
// PANEL AGREGAR NOTA
// ========================================

const panelAgregarNota =
    document.getElementById("panel-agregar-nota");

botonesMenu.forEach(boton => {

    boton.addEventListener("click", () => {

        const seccionDestino = boton.dataset.seccion;

        // ========================================
        // RECORDAR SECCIÓN ACTUAL
        // ========================================

        localStorage.setItem(
        "haikuSeccionActual",
        seccionDestino
        );

        // Ocultar todas las secciones
        seccionesApp.forEach(seccion => {
            seccion.classList.remove("activa");
        });

        // Quitar estado activo de los botones
        botonesMenu.forEach(item => {
            item.classList.remove("activo");
        });

        // Mostrar sección seleccionada
        const nuevaSeccion =
            document.getElementById(`seccion-${seccionDestino}`);

        if (nuevaSeccion) {
            nuevaSeccion.classList.add("activa");
            boton.classList.add("activo");
        }

        // Actualizar Pagos al entrar a la sección
        if (seccionDestino === "pagos") {
        cargarAbonosPagos();
        cargarSaldosCheckin();
        }

    });

});

// ========================================
// RESTAURAR SECCIÓN AL RECARGAR
// ========================================

const seccionGuardadaOriginal =
    localStorage.getItem("haikuSeccionActual");
const seccionGuardada = seccionGuardadaOriginal === "aseo"
    ? "cabanas"
    : seccionGuardadaOriginal;
if (seccionGuardadaOriginal === "aseo") {
    localStorage.setItem("haikuSeccionActual", "cabanas");
}

if (seccionGuardada) {

    // Ocultar todas las secciones

    seccionesApp.forEach(seccion => {
        seccion.classList.remove("activa");
    });


    // Quitar activo de todos los botones

    botonesMenu.forEach(boton => {
        boton.classList.remove("activo");
    });


    // Recuperar sección guardada

    const seccionRestaurada =
        document.getElementById(
            `seccion-${seccionGuardada}`
        );


    const botonRestaurado =
        document.querySelector(
            `.menu-item[data-seccion="${seccionGuardada}"]`
        );


    if (seccionRestaurada) {
        seccionRestaurada.classList.add("activa");
    }


    if (botonRestaurado) {
        botonRestaurado.classList.add("activo");
    }

}

// ========================================
// DATOS OPERATIVOS POR FECHA
// ========================================

const notasDia = document.getElementById("notas-dia");

notasDia.addEventListener("input", () => {
    if (!fechaSeleccionada) return;

    const datos = obtenerDatosDia(fechaSeleccionada);

    datos.notas = notasDia.value;

    guardarDatos();

    generarResumenOperativo(fechaSeleccionada);
});

const resumenMantencion =
    document.getElementById("resumen-mantencion");

const resumenLavanderia =
    document.getElementById("resumen-lavanderia");

// Recuperar información guardada en este navegador
let datosPorFecha =
    JSON.parse(localStorage.getItem("haikuDatos")) || {};


// ========================================
// OBTENER / CREAR DÍA
// ========================================

function obtenerDatosDia(fecha) {

    if (!datosPorFecha[fecha]) {

        datosPorFecha[fecha] = {
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

    if (!datosPorFecha[fecha].notasOperativas) {
         datosPorFecha[fecha].notasOperativas = [];
    
    }

    if (!datosPorFecha[fecha].mantencion) {
    datosPorFecha[fecha].mantencion = [];
    }

    if (!datosPorFecha[fecha].lavanderia) {
    datosPorFecha[fecha].lavanderia = [];
    }

    return datosPorFecha[fecha];
}

// ===============================
// GENERAR ID ÚNICO DE RESERVA
// ===============================

function generarReservaId(fecha, numeroCabana) {

    const fechaLimpia = String(fecha).replaceAll("-", "");

    let contador = 1;
    let reservaId = "";

    do {

        reservaId = `R-${fechaLimpia}-${numeroCabana}-${contador}`;
        contador++;

    } while (existeReservaId(reservaId));

    return reservaId;
}


// ===============================
// COMPROBAR SI EXISTE RESERVA ID
// ===============================

function existeReservaId(reservaId) {

    return Object.values(datosPorFecha).some(dia => {

        if (!dia.cabanas) return false;

        return Object.values(dia.cabanas).some(cabana =>
            cabana?.reservaId === reservaId
        );

    });
}

// =============================
// SUMAR DÍAS A UNA FECHA
// =============================

function sumarDiasFecha(fecha, cantidadDias) {

    const [anio, mes, dia] = fecha.split("-").map(Number);

    const fechaBase = new Date(anio, mes - 1, dia);

    fechaBase.setDate(fechaBase.getDate() + cantidadDias);

    const nuevoAnio = fechaBase.getFullYear();
    const nuevoMes = String(fechaBase.getMonth() + 1).padStart(2, "0");
    const nuevoDia = String(fechaBase.getDate()).padStart(2, "0");

    return `${nuevoAnio}-${nuevoMes}-${nuevoDia}`;
}

// =============================
// SINCRONIZAR DATOS DE RESERVA
// =============================

function sincronizarDatosReserva(reservaId, numeroCabana, campo, valor) {

    if (!reservaId) {
        return;
    }

    Object.values(datosPorFecha).forEach(dia => {

        if (!dia.cabanas) {
            return;
        }

        const cabana = dia.cabanas[numeroCabana];

        if (!cabana) {
            return;
        }

        // Solo modificar días pertenecientes a la misma reserva
        if (cabana.reservaId !== reservaId) {
            return;
        }

        cabana[campo] = valor;

    });

    guardarDatos();
}

// =============================
// CREAR CONTINUIDADES DE RESERVA
// =============================

function crearContinuidadesReserva(fechaInicio, numeroCabana, noches) {

    const datosInicio = obtenerDatosDia(fechaInicio);
    const cabanaInicio = datosInicio.cabanas?.[numeroCabana];

    if (!cabanaInicio || noches < 1) {
    return;
}

    const reservaId = cabanaInicio.reservaId;

    if (!reservaId) {
        return;
    }

    // Recordar de qué tipo de ingreso nació la reserva
const estadoIngresoReserva =
    cabanaInicio.estadoIngresoReserva ||
    (
        cabanaInicio.estado === "libre-ingresa" ||
        cabanaInicio.estado === "sale-ingresa"
            ? cabanaInicio.estado
            : ""
    );

if (estadoIngresoReserva) {
    cabanaInicio.estadoIngresoReserva =
        estadoIngresoReserva;
}

    for (let i = 1; i <= noches; i++) {

        const fechaContinuidad = sumarDiasFecha(fechaInicio, i);
        const datosContinuidad = obtenerDatosDia(fechaContinuidad);

        if (!datosContinuidad.cabanas) {
            datosContinuidad.cabanas = {};
        }

        // Si la cabaña todavía no existe ese día, crearla
        if (!datosContinuidad.cabanas[numeroCabana]) {
            datosContinuidad.cabanas[numeroCabana] = {};
        }

        const destino = datosContinuidad.cabanas[numeroCabana];

// ¿Ya existe otra reserva REAL en esta cabaña para este día?
const hayOtraReserva =
    destino.reservaId &&
    destino.reservaId !== reservaId &&
    destino.titular;

if (hayOtraReserva) {

    // Si este es el día de salida de la reserva anterior,
    // y ya comienza otra reserva en la misma cabaña,
    // la nueva reserva pasa a SALE / INGRESA.
    if (i === noches) {
        destino.estado = "sale-ingresa";
    }

    // IMPORTANTE:
    // No modificar titular, pasajeros, noches ni reservaId
    // de la reserva que ya existe.
    continue;
}

// Identificador de la misma reserva
destino.reservaId = reservaId;

// Datos que heredamos
destino.titular = cabanaInicio.titular || "";
destino.adultos = cabanaInicio.adultos || "";
destino.ninos = cabanaInicio.ninos || "";
destino.mascotas = cabanaInicio.mascotas || "";

// Heredar el tipo de ingreso original de la reserva
destino.estadoIngresoReserva =
    estadoIngresoReserva;

        // Estado según el día de la reserva
        if (i < noches) {
        destino.estado = "continua";
        } else {
        destino.estado = "sale-libre";
        }

        // Información de estadía
        destino.noches = noches;

        // Marcamos que esta fila fue creada automáticamente
        destino.continuidadAutomatica = true;
        destino.fechaOrigenReserva = fechaInicio;
    }

    guardarDatos();
}

// ========================================
// GUARDAR TODO
// ========================================

function guardarDatos() {

    localStorage.setItem(
        "haikuDatos",
        JSON.stringify(datosPorFecha)
    );

}


// ========================================
// CARGAR UN DÍA
// ========================================

function cargarDatosDia(fecha) {

    const datos = obtenerDatosDia(fecha);

    notasDia.value = datos.notas || "";

    resumenMantencion.value = datos.mantencion || "";
    resumenLavanderia.value = datos.lavanderia || "";

    // cargarCabanasDia(fecha);

    mostrarNotasOperativas(fecha);

    // Actualizar pagos para la fecha seleccionada
    if (typeof cargarAbonosPagos === "function") {
        cargarAbonosPagos();
    }

    if (typeof cargarSaldosCheckin === "function") {
        cargarSaldosCheckin();
    }
}


// ========================================
// GUARDAR NOTAS AUTOMÁTICAMENTE
// ========================================

notasDia.addEventListener("input", () => {

    if (!fechaSeleccionada) {
        return;
    }

    const datos = obtenerDatosDia(fechaSeleccionada);

    datos.notas = notasDia.value;

    guardarDatos();

});

resumenMantencion.addEventListener("input", () => {

    if (!fechaSeleccionada) {
        return;
    }

    const datos = obtenerDatosDia(fechaSeleccionada);

    datos.mantencion = resumenMantencion.value;

    guardarDatos();
});


resumenLavanderia.addEventListener("input", () => {

    if (!fechaSeleccionada) {
        return;
    }

    const datos = obtenerDatosDia(fechaSeleccionada);

    datos.lavanderia = resumenLavanderia.value;

    guardarDatos();
});

// ========================================
// CARGAR DÍA ACTUAL AL INICIAR
// ========================================

cargarDatosDia(fechaSeleccionada);

// ========================================
// ABRIR NOTA DESDE LA ACCIÓN DEL RESUMEN
// ========================================

let versionBorradorNotaResumen = 0;

document.addEventListener(
    "click",
    evento => {

        const boton =
            evento.target.closest(
                "[data-agregar-nota-cabana]"
            );

        if (!boton) {
            return;
        }


        const numeroCabana =
            boton.dataset.agregarNotaCabana;

        const contextoNota = document.getElementById("sites-resumen-nota-contexto");
        const kickerNota = document.getElementById("sites-resumen-nota-kicker");
        if (kickerNota) kickerNota.textContent = `CABAÑA ${numeroCabana}`;

        let identidadNota = null;
        if (window.haikuSesion) {
            try {
                identidadNota = window.HAIKU_SITES_RESUMEN_NOTA_V1?.preparar(boton);
                if (!window.HAIKU_SITES_RESUMEN_NOTA_V1) {
                    throw new Error("No está disponible la identidad segura de la nota.");
                }
            } catch (error) {
                alert(error.message || "No se pudo identificar la cabaña de esta nota.");
                return;
            }
        }

        if (contextoNota) {
            const fila = boton.closest(".sites-resumen-cabana");
            const reservaId = identidadNota?.reservaId || String(fila?.dataset.resumenReservaId || "");
            const titular = reservaId && fila?.dataset.resumenFecha === fechaSeleccionada &&
                fila?.dataset.resumenTitularReservaId === reservaId
                    ? String(fila.dataset.resumenTitular || "").trim() : "";
            const datosCabana = obtenerDatosDia(fechaSeleccionada)?.cabanas?.[numeroCabana];
            const codigo = reservaId && String(datosCabana?.reservaId || "") === reservaId
                ? String(datosCabana.codigoHaiku || "").trim() : "";
            const adultos = reservaId ? Number(fila?.querySelector('[data-campo="adultos"]')?.value || 0) : 0;
            const ninos = reservaId ? Number(fila?.querySelector('[data-campo="ninos"]')?.value || 0) : 0;
            const ocupacion = [adultos ? `${adultos} adulto${adultos === 1 ? "" : "s"}` : "",
                ninos ? `${ninos} niño${ninos === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
            contextoNota.textContent = [titular || (reservaId ? "Reserva del día" : "Sin reserva"),
                codigo, ocupacion].filter(Boolean).join(" · ");
        }


        const selectorCabana =
            document.getElementById(
                "nota-cabana"
            );

        const campoTexto =
            document.getElementById(
                "nota-texto"
            );


        if (selectorCabana) {
            selectorCabana.value =
                numeroCabana;
        }


        if (campoTexto) {
            campoTexto.value = "";
        }


        if (panelAgregarNota) {
            versionBorradorNotaResumen++;
            panelAgregarNota.classList.add(
                "activo"
            );
        }

    }
);

// ========================================
// CERRAR PANEL AGREGAR NOTA
// ========================================

const botonCerrarNota =
    document.getElementById("cerrar-panel-nota");

const botonCancelarNota =
    document.getElementById("cancelar-nota");

const botonGuardarNota =
    document.getElementById("guardar-nota");

const selectorNotaCabana =
    document.getElementById("nota-cabana");

const textoNota =
    document.getElementById("nota-texto");


function cerrarPanelNota() {

    panelAgregarNota.classList.remove("activo");

}


botonCerrarNota.addEventListener("click", () => {

    cerrarPanelNota();

});


botonCancelarNota.addEventListener("click", () => {

    cerrarPanelNota();

});

// ========================================
// MOSTRAR NOTAS OPERATIVAS EN LA TABLA
// ========================================

function mostrarNotasOperativas(fecha) {

    const datos = obtenerDatosDia(fecha);

    // Recorrer CAB 1 hasta CAB 11
    for (let numeroCabana = 1; numeroCabana <= 11; numeroCabana++) {

        const cajaNota =
            document.querySelector(
                `[data-nota-cabana="${numeroCabana}"]`
            );

        if (!cajaNota) {
            continue;
        }

        const notasCabana =
            datos.notasOperativas.filter(nota => {
                return String(nota.cabana) === String(numeroCabana);
            });

        if (notasCabana.length === 0) {
            cajaNota.textContent = "";
            continue;
        }

        cajaNota.replaceChildren(...notasCabana.map(nota => {
            const item = document.createElement("span");
            item.className = "nota-operativa-item";
            item.textContent = nota.texto;
            const eliminar = document.createElement("button");
            eliminar.type = "button";
            eliminar.className = "nota-eliminar";
            eliminar.dataset.cabana = String(numeroCabana);
            eliminar.dataset.texto = nota.texto;
            eliminar.title = "Eliminar nota";
            eliminar.textContent = "×";
            item.appendChild(eliminar);
            return item;
        }));
    }

    document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {
        detail: { fecha }
    }));
}

// =====================================
// ELIMINAR NOTA OPERATIVA
// =====================================

document.addEventListener("click", async (evento) => {

    const boton = evento.target.closest(".nota-eliminar");

    if (!boton || !fechaSeleccionada) {
        return;
    }

    const numeroCabana = boton.dataset.cabana;
    const contenidoNota = boton.dataset.texto;

    const datos = obtenerDatosDia(fechaSeleccionada);

    const indice = datos.notasOperativas.findIndex(nota =>
        String(nota.cabana) === String(numeroCabana) &&
        nota.texto === contenidoNota
    );

    if (indice === -1) {
        return;
    }

    const notaOperativa = datos.notasOperativas[indice];
    const puenteNotas =
        window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1;

    if (puenteNotas && notaOperativa?.id) {
        try {
            await puenteNotas.eliminar({
                id: notaOperativa.id
            });
        } catch (error) {
            console.error(
                "HAIKU · No fue posible eliminar la nota en Supabase:",
                error
            );
            alert("No fue posible eliminar la nota. Intenta nuevamente.");
            return;
        }
    }

    const indiceActual = datos.notasOperativas.findIndex(nota =>
        notaOperativa?.id
            ? nota.id === notaOperativa.id
            : (
                String(nota.cabana) === String(numeroCabana) &&
                nota.texto === contenidoNota
            )
    );

    if (indiceActual !== -1) {
        datos.notasOperativas.splice(indiceActual, 1);
    }

    guardarDatos();

    if (
        typeof registrarActividadHaiku ===
        "function"
    ) {
        const cabana =
            datos.cabanas?.[numeroCabana] || {};

        registrarActividadHaiku({
            tipo: "nota",
            accion: "Nota operativa eliminada",
            reservaId: cabana.reservaId || "",
            numeroCabana,
            titular: cabana.titular || "",
            fechaOperacion: fechaSeleccionada,
            detalle: contenidoNota
        });
    }

mostrarNotasOperativas(fechaSeleccionada);

// Actualizar automáticamente las otras secciones
actualizarTarjetasRevision(fechaSeleccionada);
actualizarResumenAseo(fechaSeleccionada);
generarResumenOperativo(fechaSeleccionada);

textoNota.value = "";
selectorNotaCabana.value = "";

cerrarPanelNota();
});

// ========================================
// GUARDAR NOTA OPERATIVA
// ========================================

botonGuardarNota.addEventListener("click", async () => {

    if (botonGuardarNota.disabled) return;

    if (!fechaSeleccionada) {
        return;
    }

    const fechaNota = fechaSeleccionada;
    const versionBorrador = versionBorradorNotaResumen;
    const nota = textoNota.value.trim();

    if (!nota) {
        return;
    }

    const datos = obtenerDatosDia(fechaNota);

    const numeroCabana = selectorNotaCabana.value;
    const cabana = datos.cabanas?.[numeroCabana] || {};
    botonGuardarNota.disabled = true;
    try {
    let identidadNota = null;
    if (window.haikuSesion) {
        try {
            if (!window.HAIKU_SITES_RESUMEN_NOTA_V1) {
                throw new Error("No está disponible la identidad segura de la nota.");
            }
            identidadNota = await window.HAIKU_SITES_RESUMEN_NOTA_V1.validar(
                fechaNota, numeroCabana);
        } catch (error) {
            alert(error.message || "La reserva cambió. La nota no se guardó.");
            return;
        }
    }
    let notaOperativa = {
        cabana: selectorNotaCabana.value,
        texto: nota
    };

    const puenteNotas =
        window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1;

    if (puenteNotas) {
        try {
            notaOperativa = await puenteNotas.guardar({
                fecha: fechaNota,
                numeroCabana,
                texto: nota,
                reservaId: identidadNota ? identidadNota.reservaId : cabana.reservaId || "",
                estadiaId: identidadNota ? identidadNota.estadiaId : cabana.estadiaId || "",
                cabanaIdEsperada: identidadNota?.cabanaId
            });
        } catch (error) {
            console.error(
                "HAIKU · No fue posible guardar la nota en Supabase:",
                error
            );
            alert("No fue posible guardar la nota. Intenta nuevamente.");
            return;
        }
    } else if (window.haikuSesion) {
        alert("No está disponible el guardado real de notas. La nota no se guardó.");
        return;
    }

    if (
        !notaOperativa.id ||
        !datos.notasOperativas.some(item =>
            item.id === notaOperativa.id
        )
    ) {
        datos.notasOperativas.push(notaOperativa);
    }

    guardarDatos();

    if (
        typeof registrarActividadHaiku ===
        "function"
    ) {
        registrarActividadHaiku({
            tipo: "nota",
            accion: "Nota operativa agregada",
            reservaId: identidadNota ? identidadNota.reservaId : cabana.reservaId || "",
            numeroCabana,
            titular: cabana.titular || "",
            fechaOperacion: fechaNota,
            detalle: nota
        });
    }

mostrarNotasOperativas(fechaSeleccionada);
if (identidadNota && puenteNotas?.refrescar) {
    try { await puenteNotas.refrescar(fechaNota); }
    catch (error) { console.warn("HAIKU · Nota guardada; el refresco remoto sigue pendiente:", error); }
}

// Sincronizar Cabañas y Aseo inmediatamente
actualizarTarjetasRevision(fechaSeleccionada);
actualizarResumenAseo(fechaSeleccionada);
generarResumenOperativo(fechaSeleccionada);

if (versionBorrador === versionBorradorNotaResumen &&
    textoNota.value.trim() === nota && selectorNotaCabana.value === numeroCabana) {
    textoNota.value = "";
    selectorNotaCabana.value = "";
    cerrarPanelNota();
}

    } finally {
        botonGuardarNota.disabled = false;
    }

});

// =====================================================
// ESTADO FINAL · TEXTO COMPACTO EN CELULAR
// =====================================================

function actualizarTextoEstadoFinalResponsive() {

    const esMovil = window.innerWidth <= 700;

    document.querySelectorAll('.estado-final-select').forEach(select => {

        Array.from(select.options).forEach(option => {

            // Guardamos el texto original una sola vez
            if (!option.dataset.textoOriginal) {
                option.dataset.textoOriginal = option.textContent;
            }

            if (esMovil) {

                if (option.value === 'Pendiente') {
                    option.textContent = 'PEND.';
                }

                else if (option.value === 'LISTA') {
                    option.textContent = 'LISTA';
                }

                else if (option.value === 'CON DETALLES') {
                    option.textContent = 'DET.';
                }

            } else {

                // En computador vuelve al texto normal
                option.textContent = option.dataset.textoOriginal;

            }

        });

    });

}

actualizarTextoEstadoFinalResponsive();

window.addEventListener('resize', actualizarTextoEstadoFinalResponsive);

// ========================================
// BUSCADOR GLOBAL POR PALABRA CLAVE
// ========================================

const buscadorPalabra =
    document.getElementById("busqueda-palabra");

const contadorBusquedaPalabra =
    document.getElementById(
        "contador-busqueda-palabra"
    );

const botonBusquedaAnterior =
    document.getElementById(
        "busqueda-palabra-anterior"
    );

const botonBusquedaSiguiente =
    document.getElementById(
        "busqueda-palabra-siguiente"
    );

let indiceBusquedaPalabra = -1;


// Quitar resaltados anteriores
function limpiarBusquedaPalabra() {

    document
        .querySelectorAll("mark.busqueda-palabra-marca")
        .forEach(marca => {

            const padre =
                marca.parentNode;

            const texto =
                document.createTextNode(
                    marca.textContent
                );

            marca.replaceWith(texto);

            // Volver a unir los fragmentos de texto
            if (padre) {
                padre.normalize();
            }

        });

}


// Buscar dentro de la sección visible
function buscarPalabraEnSeccion() {

    if (!buscadorPalabra) {
        return;
    }

    // Primero quitamos resultados anteriores
    limpiarBusquedaPalabra();

    indiceBusquedaPalabra = -1;


    const termino =
        buscadorPalabra.value.trim();

    if (termino.length < 1) {
    return;
}


    // Buscar la sección actualmente visible
    const seccionActiva =
        Array.from(
            document.querySelectorAll(".seccion-app")
        ).find(seccion => {

            return (
                !seccion.hidden &&
                getComputedStyle(seccion).display !== "none"
            );

        });


    if (!seccionActiva) {
        return;
    }


    const terminoSeguro =
    termino.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );

    const expresion =
    new RegExp(
        `(${terminoSeguro})`,
        "gi"
    );


    const walker =
        document.createTreeWalker(
            seccionActiva,
            NodeFilter.SHOW_TEXT
        );


    const nodosTexto = [];

    let nodo;

    while (
        nodo = walker.nextNode()
    ) {

        const padre =
            nodo.parentElement;

        if (!padre) {
            continue;
        }


        // No tocar controles ni elementos delicados
        if (
            padre.closest(
                "input, textarea, select, option, script, style, button"
            )
        ) {
            continue;
        }


        if (
            nodo.textContent &&
            expresion.test(nodo.textContent)
        ) {
            nodosTexto.push(nodo);
        }

        expresion.lastIndex = 0;
    }


    // Reemplazar coincidencias por MARK
    nodosTexto.forEach(nodoTexto => {

        const fragmento =
            document.createDocumentFragment();

        const partes =
            nodoTexto.textContent.split(expresion);


        partes.forEach(parte => {

            if (
                parte.toLowerCase() ===
                termino.toLowerCase()
            ) {

                const marca =
                    document.createElement("mark");

                marca.className =
                    "busqueda-palabra-marca";

                marca.textContent =
                    parte;

                fragmento.appendChild(
                    marca
                );

            } else {

                fragmento.appendChild(
                    document.createTextNode(parte)
                );

            }

        });


        nodoTexto.replaceWith(
            fragmento
        );

    });


    // Llevarnos a la primera coincidencia
    const coincidencias =
    seccionActiva.querySelectorAll(
        ".busqueda-palabra-marca"
    );

if (contadorBusquedaPalabra) {

    if (coincidencias.length > 0) {

        contadorBusquedaPalabra.textContent =
            `0/${coincidencias.length}`;

        contadorBusquedaPalabra.hidden =
            false;

    if (botonBusquedaAnterior) {
        botonBusquedaAnterior.hidden = false;
}

    if (botonBusquedaSiguiente) {
        botonBusquedaSiguiente.hidden = false;
}

    } else {

        contadorBusquedaPalabra.textContent =
            "0/0";

        contadorBusquedaPalabra.hidden =
            termino.length === 0;

        if (botonBusquedaAnterior) {
        botonBusquedaAnterior.hidden = true;
}

        if (botonBusquedaSiguiente) {
        botonBusquedaSiguiente.hidden = true;
}
    }
}

}


// Mientras escribimos
if (buscadorPalabra) {

    buscadorPalabra.addEventListener(
        "input",
        buscarPalabraEnSeccion
    );

buscadorPalabra.addEventListener(
    "keydown",
    evento => {

        if (evento.key !== "Enter") {
            return;
        }

        evento.preventDefault();

        const seccionActiva =
            Array.from(
                document.querySelectorAll(
                    ".seccion-app"
                )
            ).find(seccion => {

                return (
                    !seccion.hidden &&
                    getComputedStyle(seccion).display !== "none"
                );

            });

        if (!seccionActiva) {
            return;
        }

        const coincidencias =
            Array.from(
                seccionActiva.querySelectorAll(
                    ".busqueda-palabra-marca"
                )
            );

        if (coincidencias.length === 0) {
            return;
        }


        // Pasar a la siguiente coincidencia
        indiceBusquedaPalabra++;

        // Si llegamos al final, volver a la primera
        if (
            indiceBusquedaPalabra >=
            coincidencias.length
        ) {
            indiceBusquedaPalabra = 0;
        }


        // Quitar selección anterior
        coincidencias.forEach(
            marca => {
                marca.classList.remove(
                    "busqueda-palabra-activa"
                );
            }
        );


        const actual =
            coincidencias[indiceBusquedaPalabra];

        actual.classList.add(
            "busqueda-palabra-activa"
        );


        actual.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });


        if (contadorBusquedaPalabra) {

            contadorBusquedaPalabra.textContent =
                `${indiceBusquedaPalabra + 1}/${coincidencias.length}`;

            contadorBusquedaPalabra.hidden =
                false;
        }

    }
);

if (botonBusquedaSiguiente) {
    botonBusquedaSiguiente.addEventListener(
        "click",
        () => {
            buscadorPalabra.dispatchEvent(
                new KeyboardEvent(
                    "keydown",
                    {
                        key: "Enter",
                        bubbles: true
                    }
                )
            );
        }
    );
}

if (botonBusquedaAnterior) {

    botonBusquedaAnterior.addEventListener(
        "click",
        () => {

            const seccionActiva =
                Array.from(
                    document.querySelectorAll(
                        ".seccion-app"
                    )
                ).find(seccion =>
                    !seccion.hidden &&
                    getComputedStyle(seccion).display !== "none"
                );

            if (!seccionActiva) return;

            const coincidencias =
                Array.from(
                    seccionActiva.querySelectorAll(
                        ".busqueda-palabra-marca"
                    )
                );

            if (coincidencias.length === 0) return;

            indiceBusquedaPalabra--;

            if (indiceBusquedaPalabra < 0) {
                indiceBusquedaPalabra =
                    coincidencias.length - 1;
            }

            coincidencias.forEach(marca => {
                marca.classList.remove(
                    "busqueda-palabra-activa"
                );
            });

            const actual =
                coincidencias[indiceBusquedaPalabra];

            actual.classList.add(
                "busqueda-palabra-activa"
            );

            actual.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            if (contadorBusquedaPalabra) {
                contadorBusquedaPalabra.textContent =
                    `${indiceBusquedaPalabra + 1}/${coincidencias.length}`;
            }
        }
    );
}

}


// Si cambiamos de sección,
// repetir la búsqueda en la nueva sección
document.addEventListener(
    "click",
    evento => {

        const botonSeccion =
            evento.target.closest(
                "[data-seccion]"
            );

        if (!botonSeccion) {
            return;
        }

        setTimeout(
            buscarPalabraEnSeccion,
            50
        );

    }
);

// ========================================
// PANEL DE NOTIFICACIONES
// ========================================

const botonNotificaciones =
    document.getElementById(
        "boton-notificaciones"
    );

const panelNotificaciones =
    document.getElementById(
        "panel-notificaciones"
    );

const cerrarNotificaciones =
    document.getElementById(
        "cerrar-notificaciones"
    );

const contenidoNotificaciones =
    document.getElementById(
        "notificaciones-contenido"
    );

// ========================================
// CHECK-IN PENDIENTES REALES
// ========================================

function obtenerCheckinsPendientes() {

    if (!fechaSeleccionada) {
        return [];
    }

    const datos =
        datosPorFecha[fechaSeleccionada];

    if (!datos?.cabanas) {
        return [];
    }

    return Object.entries(datos.cabanas)
        .filter(([numeroCabana, cabana]) => {

            if (!cabana) {
                return false;
            }

            const ingresaHoy =
                cabana.estado === "libre-ingresa" ||
                cabana.estado === "sale-ingresa";

            const faltaCheckin =
                cabana.checkinRealizado !== true;

            return (
                ingresaHoy &&
                faltaCheckin
            );
        })
        .map(([numeroCabana, cabana]) => ({
            numeroCabana,
            reservaId:
                cabana.reservaId || "",
            titular:
                cabana.titular || "Sin titular",
            hora:
                cabana.ingreso || ""
        }));
}

// ========================================
// SERVICIOS PRÓXIMOS REALES
// ========================================

// ========================================
// HORARIO INTELIGENTE DE SERVICIOS
// ========================================

function obtenerFechaLocalISO() {

    const ahora = new Date();

    const anio = ahora.getFullYear();

    const mes =
        String(
            ahora.getMonth() + 1
        ).padStart(2, "0");

    const dia =
        String(
            ahora.getDate()
        ).padStart(2, "0");

    return `${anio}-${mes}-${dia}`;
}


function obtenerEstadoHorarioServicio(
    fechaServicio,
    horaServicio,
    duracionMinutos = 0
) {

    if (!fechaServicio || !horaServicio) {
        return null;
    }

    const hoy =
        obtenerFechaLocalISO();

    if (fechaServicio !== hoy) {

        return {
            tipo: "programado",
            texto: horaServicio,
            minutos: null
        };
    }


    const [hora, minutos] =
        horaServicio
            .split(":")
            .map(Number);

    if (
        Number.isNaN(hora) ||
        Number.isNaN(minutos)
    ) {
        return null;
    }


    const ahora =
        new Date();

    const inicioServicio =
        new Date();

    inicioServicio.setHours(
        hora,
        minutos,
        0,
        0
    );


    const finServicio =
        new Date(
            inicioServicio.getTime() +
            duracionMinutos * 60000
        );


    const minutosParaInicio =
        Math.round(
            (
                inicioServicio.getTime() -
                ahora.getTime()
            ) / 60000
        );


    const minutosParaFin =
        Math.round(
            (
                finServicio.getTime() -
                ahora.getTime()
            ) / 60000
        );


    // TODAVÍA NO EMPIEZA
    if (minutosParaInicio > 60) {

        return {
            tipo: "programado",
            texto: horaServicio
        };
    }


    if (minutosParaInicio > 30) {

        return {
            tipo: "proximo",
            texto:
                `En ${minutosParaInicio} min`
        };
    }


    if (minutosParaInicio > 15) {

        return {
            tipo: "atencion",
            texto:
                `En ${minutosParaInicio} min`
        };
    }


    if (minutosParaInicio > 0) {

        return {
            tipo: "urgente",
            texto:
                `En ${minutosParaInicio} min`
        };
    }


    // SERVICIO EN CURSO
    if (
        duracionMinutos > 0 &&
        minutosParaFin > 15
    ) {

        return {
            tipo: "en-curso",
            texto:
                `En curso · termina ${
                    String(
                        finServicio.getHours()
                    ).padStart(2, "0")
                }:${
                    String(
                        finServicio.getMinutes()
                    ).padStart(2, "0")
                }`
        };
    }


    // ÚLTIMOS 15 MIN
    if (
        duracionMinutos > 0 &&
        minutosParaFin > 0
    ) {

        return {
            tipo: "finalizando",
            texto:
                `Termina en ${minutosParaFin} min`
        };
    }


    // JUSTO AL TERMINAR
    if (
        duracionMinutos > 0 &&
        minutosParaFin >= -5
    ) {

        return {
            tipo: "ahora",
            texto:
                "Finaliza ahora"
        };
    }


    // YA TERMINÓ
    if (duracionMinutos > 0) {

        return {
            tipo: "atrasado",
            texto:
                `Terminó hace ${Math.abs(
                    minutosParaFin
                )} min`
        };
    }


    return {
        tipo: "atrasado",
        texto: "Hora del servicio"
    };
}

function obtenerServiciosProximos() {

    if (!fechaSeleccionada) {
        return [];
    }

    const servicios =
        JSON.parse(
            localStorage.getItem("haikuServicios")
        ) || [];

    return servicios
    .filter(servicio => {

        const esDelDia =
            servicio.fechaServicio ===
            fechaSeleccionada;

        const siguePendiente =
            servicio.estadoServicio !==
            "realizado";

        return (
            esDelDia &&
            siguePendiente
        );
    })
    .map(servicio => {

        let duracionMinutos = 0;

        const nombre =
            String(
                servicio.nombre || ""
            ).toLowerCase();

        const tipo =
            String(
                servicio.tipoServicio || ""
            ).toLowerCase();


        // ================================
        // TINAJAS
        // ================================

        if (
            tipo.includes("tinaja") ||
            nombre.includes("tinaja") ||
            nombre.includes("jacuzzi")
        ) {

            duracionMinutos = 60;
        }


        // ================================
        // MASAJES 30 MIN
        // ================================

        else if (
            nombre.includes("30 min") ||
            nombre.includes("30 minutos")
        ) {

            duracionMinutos = 30;
        }


        // ================================
        // MASAJES 60 MIN
        // ================================

        else if (
            nombre.includes("60 min") ||
            nombre.includes("60 minutos")
        ) {

            duracionMinutos = 60;
        }


        const horario =
            obtenerEstadoHorarioServicio(
                servicio.fechaServicio,
                servicio.hora,
                duracionMinutos
            );


        return {
            ...servicio,
            duracionMinutos,
            horario
        };
    })
    .sort((a, b) =>
        (a.hora || "")
            .localeCompare(b.hora || "")
    );
}

// ========================================
// PAGOS PENDIENTES REALES
// ========================================

function obtenerPagosPendientes(
    fechaConsulta = fechaSeleccionada
) {

    if (!fechaConsulta) {
        return [];
    }

    const puenteSupabase =
        window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1;

    if (
        puenteSupabase?.estaListo?.(fechaConsulta)
    ) {
        return puenteSupabase.obtener(fechaConsulta);
    }

    const pendientes = [];

    const datos =
        obtenerDatosDia(fechaConsulta);

    const cabanas =
        datos?.cabanas || {};


    // ====================================
    // PAGOS DE RESERVAS
    // ====================================

    Object.entries(cabanas)
        .forEach(([numeroCabana, cabana]) => {

            if (!cabana) {
                return;
            }

            const estado =
                cabana.estado || "";

            const ingresaHoy =
                estado === "libre-ingresa" ||
                estado === "sale-ingresa";

            if (!ingresaHoy) {
                return;
            }


            const titular =
                cabana.titular ||
                cabana.nombre ||
                cabana.huesped ||
                "Sin titular";


            const abonoTexto =
                cabana.abono ||
                cabana.montoAbono ||
                "0";

            const abono =
                Number(
                    String(abonoTexto)
                        .replace(/\D/g, "")
                ) || 0;


            const total =
                Number(cabana.totalReserva) || 0;


            // --------------------------------
            // ABONO SIN VERIFICAR
            // --------------------------------

            if (
                cabana.abonoVerificado !== true
            ) {

                pendientes.push({
                    tipo: "abono",

                    numeroCabana,
                    reservaId:
                        cabana.reservaId || "",

                    titular,

                    titulo:
                        "Abono por verificar",

                    monto: abono
                });
            }


            // --------------------------------
            // COBRO CHECK-IN INCOMPLETO
            // --------------------------------

            const checkinCompleto =
                total > 0 &&
                cabana.checkinMedio !== "" &&
                cabana.checkinCobrado === true &&
                String(
                    cabana.checkinFolio || ""
                ).trim() !== "" &&
                String(
                    cabana.checkinCodAut || ""
                ).trim() !== "" &&
                String(
                    cabana.checkinBove || ""
                ).trim() !== "" &&
                cabana.checkinManager === true;


            if (!checkinCompleto) {

                const saldo =
                    Math.max(
                        total - abono,
                        0
                    );

                pendientes.push({
                    tipo: "checkin",

                    numeroCabana,
                    reservaId:
                        cabana.reservaId || "",

                    titular,

                    titulo:
                        "Cobro check-in pendiente",

                    monto: saldo
                });
            }

        });


    // ====================================
    // SERVICIOS PENDIENTES DE PAGO
    // ====================================

    const servicios =
        JSON.parse(
            localStorage.getItem(
                "haikuServicios"
            )
        ) || [];


    // Los servicios adicionales se cobran al finalizar
    // la estadía, no el día en que fueron programados.
    function obtenerFechaCobroServicio(servicio) {

        const reservaId =
            String(servicio?.reservaId || "");

        if (
            reservaId &&
            typeof buscarDatosReservaPorId ===
                "function"
        ) {

            const registroReserva =
                buscarDatosReservaPorId(reservaId);

            const cabanaReserva =
                registroReserva?.cabana || {};

            const fechaIngreso =
                cabanaReserva.fechaOrigenReserva ||
                cabanaReserva.fechaIngresoReserva ||
                registroReserva?.fecha ||
                "";

            const noches =
                Number(cabanaReserva.noches) || 0;

            if (fechaIngreso && noches > 0) {

                return sumarDiasFecha(
                    fechaIngreso,
                    noches
                );
            }
        }

        // Respaldo para servicios antiguos que no tengan
        // una reserva correctamente asociada.
        return (
            servicio?.fechaServicio ||
            servicio?.fecha ||
            ""
        );
    }


    servicios
        .filter(servicio =>
            servicio.estadoPago ===
                "pendiente" &&
            obtenerFechaCobroServicio(servicio) ===
                fechaConsulta
        )
        .forEach(servicio => {

            pendientes.push({

                tipo: "servicio",

                numeroCabana:
                    servicio.numeroCabana,

                reservaId:
                    servicio.reservaId || "",

                titular:
                    servicio.titular ||
                    "Sin titular",

                titulo:
                    servicio.nombre ||
                    "Servicio",

                monto:
                    Number(
                        servicio.total
                    ) || 0
            });

        });


    return pendientes;
}

function actualizarNotificaciones() {

    if (!contenidoNotificaciones) {
        return;
    }

    const checkinsPendientes =
        obtenerCheckinsPendientes();

    const serviciosProximos =
        obtenerServiciosProximos();

    const pagosPendientes =
    obtenerPagosPendientes();

    contenidoNotificaciones.innerHTML = "";


    // =====================================
    // TODO AL DÍA
    // =====================================

    if (
    checkinsPendientes.length === 0 &&
    serviciosProximos.length === 0 &&
    pagosPendientes.length === 0
) {

        contenidoNotificaciones.innerHTML = `
            <div class="notificaciones-vacias">
                <span>✓</span>
                <strong>Todo al día</strong>
                <small>No hay pendientes por ahora.</small>
            </div>
        `;

        return;
    }


    // =====================================
    // SECCIÓN AHORA
    // =====================================

    const seccion =
        document.createElement("div");

    seccion.className =
        "notificaciones-seccion";


    const titulo =
        document.createElement("div");

    titulo.className =
        "notificaciones-seccion-titulo";

    titulo.textContent = "Ahora";

    seccion.appendChild(titulo);


    // =====================================
    // SERVICIOS PRÓXIMOS
    // =====================================

    if (serviciosProximos.length > 0) {

        const resumenServicios =
            document.createElement("button");

        resumenServicios.type = "button";

        resumenServicios.className =
            "notificacion-item";

        resumenServicios.innerHTML = `
            <span class="notificacion-icono">
                ⏰
            </span>

            <span class="notificacion-contenido">
                <strong>
                    ${serviciosProximos.length}
                    ${
                        serviciosProximos.length === 1
                            ? "servicio próximo"
                            : "servicios próximos"
                    }
                </strong>

                <small>Ver servicios</small>
            </span>

            <span class="notificacion-flecha">
                ›
            </span>
        `;


        const detalleServicios =
            document.createElement("div");

        detalleServicios.className =
            "notificacion-detalle";

        detalleServicios.hidden = true;


        serviciosProximos.forEach(servicio => {

            const item =
                document.createElement("button");

            item.type = "button";

            item.className =
                "notificacion-reserva";

            item.dataset.cabana =
                servicio.numeroCabana || "";

            item.dataset.fecha =
                servicio.fechaServicio || "";

            item.innerHTML = `
    <strong>
        ${servicio.hora || "--:--"}
        ·
        ${servicio.nombre || "Servicio"}
    </strong>

    <span>
        CAB ${servicio.numeroCabana}
        ${
            servicio.titular
                ? ` · ${servicio.titular}`
                : ""
        }
    </span>

    ${
        servicio.horario
            ? `
                <span
                    class="
                        notificacion-servicio-tiempo
                        servicio-${servicio.horario.tipo}
                    "
                >
                    ${servicio.horario.texto}
                </span>
            `
            : ""
    }
`;

            detalleServicios.appendChild(item);
        });


        resumenServicios.addEventListener(
            "click",
            () => {

                detalleServicios.hidden =
                    !detalleServicios.hidden;

                const flecha =
                    resumenServicios.querySelector(
                        ".notificacion-flecha"
                    );

                if (flecha) {
                    flecha.textContent =
                        detalleServicios.hidden
                            ? "›"
                            : "⌄";
                }
            }
        );


        detalleServicios.addEventListener(
            "click",
            evento => {

                const servicio =
                    evento.target.closest(
                        ".notificacion-reserva"
                    );

                if (!servicio) {
                    return;
                }

                const numeroCabana =
                    servicio.dataset.cabana;

                const fechaServicio =
                    servicio.dataset.fecha;


                const fechaAnterior =
                    fechaSeleccionada;

                if (fechaServicio) {
                    fechaSeleccionada =
                        fechaServicio;
                }


                const botonCabana =
                    document.querySelector(
                        `[data-ficha-cabana="${numeroCabana}"]`
                    );


                if (botonCabana) {

                    cerrarPanelNotificaciones();

                    botonCabana.click();
                }


                fechaSeleccionada =
                    fechaAnterior;
            }
        );


        seccion.appendChild(
            resumenServicios
        );

        seccion.appendChild(
            detalleServicios
        );
    }


    // =====================================
    // CHECK-IN PENDIENTES
    // =====================================

    if (checkinsPendientes.length > 0) {

        const resumen =
            document.createElement("button");

        resumen.type = "button";

        resumen.className =
            "notificacion-item";

        resumen.innerHTML = `
            <span class="notificacion-icono">
                ⚠️
            </span>

            <span class="notificacion-contenido">
                <strong>
                    ${checkinsPendientes.length}
                    ${
                        checkinsPendientes.length === 1
                            ? "check-in pendiente"
                            : "check-in pendientes"
                    }
                </strong>

                <small>Ver reservas</small>
            </span>

            <span class="notificacion-flecha">
                ›
            </span>
        `;


        const detalle =
            document.createElement("div");

        detalle.className =
            "notificacion-detalle";

        detalle.hidden = true;


        checkinsPendientes.forEach(reserva => {

            const item =
                document.createElement("button");

            item.type = "button";

            item.className =
                "notificacion-reserva";

            item.dataset.cabana =
                reserva.numeroCabana;

            item.innerHTML = `
                <strong>
                    CAB ${reserva.numeroCabana}
                    ·
                    ${reserva.titular}
                </strong>

                <span>
                    ${
                        reserva.hora
                            ? `Ingreso ${reserva.hora}`
                            : "Check-in pendiente"
                    }
                </span>
            `;

            detalle.appendChild(item);
        });


        resumen.addEventListener(
            "click",
            () => {

                detalle.hidden =
                    !detalle.hidden;

                const flecha =
                    resumen.querySelector(
                        ".notificacion-flecha"
                    );

                if (flecha) {
                    flecha.textContent =
                        detalle.hidden
                            ? "›"
                            : "⌄";
                }
            }
        );


        detalle.addEventListener(
            "click",
            evento => {

                const reserva =
                    evento.target.closest(
                        ".notificacion-reserva"
                    );

                if (!reserva) {
                    return;
                }

                const numeroCabana =
                    reserva.dataset.cabana;

                const botonCabana =
                    document.querySelector(
                        `[data-ficha-cabana="${numeroCabana}"]`
                    );

                if (botonCabana) {

                    cerrarPanelNotificaciones();

                    botonCabana.click();
                }
            }
        );


        seccion.appendChild(resumen);
        seccion.appendChild(detalle);
    }

    // =====================================
// PAGOS PENDIENTES
// =====================================

if (pagosPendientes.length > 0) {

    const resumenPagos =
        document.createElement("button");

    resumenPagos.type = "button";

    resumenPagos.className =
        "notificacion-item";

    resumenPagos.innerHTML = `
        <span class="notificacion-icono">
            💳
        </span>

        <span class="notificacion-contenido">
            <strong>
                ${pagosPendientes.length}
                ${
                    pagosPendientes.length === 1
                        ? "pago pendiente"
                        : "pagos pendientes"
                }
            </strong>

            <small>
                Ver pendientes
            </small>
        </span>

        <span class="notificacion-flecha">
            ›
        </span>
    `;


    const detallePagos =
        document.createElement("div");

    detallePagos.className =
        "notificacion-detalle";

    detallePagos.hidden = true;


    pagosPendientes.forEach(pago => {

        const item =
            document.createElement("button");

        item.type = "button";

        item.className =
            "notificacion-reserva";

        item.dataset.cabana =
            pago.numeroCabana;


        const montoTexto =
            Number(pago.monto) > 0
                ? `$${Number(
                    pago.monto
                ).toLocaleString("es-CL")}`
                : "";


        item.innerHTML = `
            <strong>
                CAB ${pago.numeroCabana}
                ·
                ${pago.titular}
            </strong>

            <span>
                ${pago.titulo}
                ${
                    montoTexto
                        ? ` · ${montoTexto}`
                        : ""
                }
            </span>
        `;

        detallePagos.appendChild(item);
    });


    resumenPagos.addEventListener(
        "click",
        () => {

            detallePagos.hidden =
                !detallePagos.hidden;

            const flecha =
                resumenPagos.querySelector(
                    ".notificacion-flecha"
                );

            if (flecha) {

                flecha.textContent =
                    detallePagos.hidden
                        ? "›"
                        : "⌄";
            }
        }
    );


    detallePagos.addEventListener(
        "click",
        evento => {

            const pago =
                evento.target.closest(
                    ".notificacion-reserva"
                );

            if (!pago) {
                return;
            }

            const numeroCabana =
                pago.dataset.cabana;

            const botonCabana =
                document.querySelector(
                    `[data-ficha-cabana="${numeroCabana}"]`
                );

            if (botonCabana) {

                cerrarPanelNotificaciones();

                botonCabana.click();
            }
        }
    );


    seccion.appendChild(
        resumenPagos
    );

    seccion.appendChild(
        detallePagos
    );
}


    contenidoNotificaciones.appendChild(
        seccion
    );
}


function abrirPanelNotificaciones() {

    if (!panelNotificaciones) {
        return;
    }

    actualizarNotificaciones();

    panelNotificaciones.hidden = false;
}


function cerrarPanelNotificaciones() {

    if (!panelNotificaciones) {
        return;
    }

    panelNotificaciones.hidden = true;
}


if (botonNotificaciones) {

    botonNotificaciones.addEventListener(
        "click",
        evento => {

            evento.stopPropagation();

            if (!panelNotificaciones) {
                return;
            }


            if (panelNotificaciones.hidden) {

                actualizarNotificaciones();

                panelNotificaciones.hidden = false;

            } else {

                panelNotificaciones.hidden = true;
            }

        }
    );
}
        


if (cerrarNotificaciones) {

    cerrarNotificaciones.addEventListener(
        "click",
        cerrarPanelNotificaciones
    );
}


// Cerrar al tocar fuera
document.addEventListener(
    "click",
    evento => {

        if (
            !panelNotificaciones ||
            panelNotificaciones.hidden
        ) {
            return;
        }

        if (
            evento.target.closest(
                "#panel-notificaciones"
            )
        ) {
            return;
        }

        if (
            evento.target.closest(
                "#boton-notificaciones"
            )
        ) {
            return;
        }

        cerrarPanelNotificaciones();
    }
);

// ========================================
// NUEVA RESERVA · ABRIR / CERRAR MODAL
// ========================================

const botonNuevaReserva =
    document.getElementById("boton-nueva-reserva");

const modalNuevaReserva =
    document.getElementById("modal-nueva-reserva");

const tituloModalReserva =
    document.getElementById(
        "reserva-modal-titulo"
    );

const cerrarNuevaReserva =
    document.getElementById("cerrar-nueva-reserva");

const cancelarNuevaReserva =
    document.getElementById("cancelar-nueva-reserva");


function abrirModalNuevaReserva() {

    if (!modalNuevaReserva) {
        return;
    }

modoFormularioReserva =
    "crear";

reservaEditandoId =
    "";

reservaEditandoOriginal =
    null;

reservaEditandoFichaOriginal =
    {};


if (tituloModalReserva) {
    tituloModalReserva.textContent =
        "Nueva reserva";
}

if (pasoConfirmacionReserva) {
    const titulo = pasoConfirmacionReserva.querySelector(
        ".reserva-confirmacion-titulo strong"
    );
    const texto = pasoConfirmacionReserva.querySelector(
        ".reserva-confirmacion-titulo span"
    );

    if (titulo) titulo.textContent = "¡Reserva creada!";
    if (texto) {
        texto.textContent =
            "La reserva fue registrada correctamente.";
    }
}


if (botonCrearNuevaReserva) {

    botonCrearNuevaReserva.textContent =
        "Crear reserva";

    botonCrearNuevaReserva.disabled =
        false;
}


mascotasReserva = 0;


mesReservaBase =
    new Date();

mesReservaBase.setDate(1);


    modalNuevaReserva.hidden = false;


    fechaLlegadaReserva = "";
    fechaSalidaReserva = "";

    cabanaSeleccionadaReserva = "";
    tarifasNochesReserva = {};
    reservaCreadaId = "";

    adultosReserva = 1;
    ninosReserva = 0;


    fechaLlegadaTexto.textContent =
        "Seleccionar";

    fechaSalidaTexto.textContent =
        "Seleccionar";


    continuarFechasReserva.disabled =
        true;

    continuarReservaDetalles.disabled =
        true;


    listaCabanasDisponibles.innerHTML =
        "";

    resumenCabanaSeleccionada.innerHTML =
        "";

    reservaAcompanantes.innerHTML =
        "";

    resumenConfirmacionReserva.innerHTML =
        "";


    campoNuevoTitular.value = "";
    campoNuevoTelefono.value = "";
    campoNuevoRut.value = "";
    campoNuevoCorreo.value = "";
    campoNuevaObservacion.value = "";


    pasoFechasReserva.hidden = false;
    pasoCabanaReserva.hidden = true;
    pasoDetallesReserva.hidden = true;
    pasoConfirmacionReserva.hidden = true;


    document
        .querySelectorAll(".reserva-paso")
        .forEach(paso => {

            paso.classList.toggle(
                "activo",
                paso.dataset.paso === "1"
            );

        });


    renderizarCalendarioNuevaReserva();

    document.body.style.overflow =
        "hidden";
}


function cerrarModalNuevaReserva() {
    if (!modalNuevaReserva) return;

    modalNuevaReserva.hidden = true;

    document.body.style.overflow = "";
}


if (botonNuevaReserva) {
    botonNuevaReserva.addEventListener(
        "click",
        abrirModalNuevaReserva
    );
}


if (cerrarNuevaReserva) {
    cerrarNuevaReserva.addEventListener(
        "click",
        cerrarModalNuevaReserva
    );
}


if (cancelarNuevaReserva) {
    cancelarNuevaReserva.addEventListener(
        "click",
        cerrarModalNuevaReserva
    );
}


// Cerrar tocando fuera de la tarjeta
if (modalNuevaReserva) {
    modalNuevaReserva.addEventListener("click", evento => {

        if (evento.target === modalNuevaReserva) {
            cerrarModalNuevaReserva();
        }

    });
}

// ========================================
// NUEVA RESERVA · CALENDARIO DE FECHAS
// ========================================

const reservaCalendario =
    document.getElementById("reserva-calendario");

const fechaLlegadaTexto =
    document.getElementById("reserva-fecha-llegada");

const fechaSalidaTexto =
    document.getElementById("reserva-fecha-salida");

const continuarFechasReserva =
    document.getElementById("continuar-fechas-reserva");

const pasoFechasReserva =
    document.getElementById("reserva-paso-fechas");

const pasoCabanaReserva =
    document.getElementById("reserva-paso-cabana");

const listaCabanasDisponibles =
    document.getElementById("lista-cabanas-disponibles");

const volverReservaFechas =
    document.getElementById("volver-reserva-fechas");

const continuarReservaDetalles =
    document.getElementById("continuar-reserva-detalles");

const pasoDetallesReserva =
    document.getElementById("reserva-paso-detalles");

const resumenCabanaSeleccionada =
    document.getElementById(
        "reserva-cabana-seleccionada"
    );

const volverReservaCabana =
    document.getElementById(
        "volver-reserva-cabana"
    );

const reservaAcompanantes =
    document.getElementById(
        "reserva-acompanantes"
    );

const botonCrearNuevaReserva =
    document.getElementById(
        "crear-nueva-reserva"
    );

const pasoConfirmacionReserva =
    document.getElementById(
        "reserva-paso-confirmacion"
    );

const resumenConfirmacionReserva =
    document.getElementById(
        "reserva-confirmacion-resumen"
    );

const campoNuevoTitular =
    document.getElementById(
        "reserva-nuevo-titular"
    );

const campoNuevoTelefono =
    document.getElementById(
        "reserva-nuevo-telefono"
    );

const campoNuevoRut =
    document.getElementById(
        "reserva-nuevo-rut"
    );

const campoNuevoCorreo =
    document.getElementById(
        "reserva-nuevo-correo"
    );

const campoNuevaObservacion =
    document.getElementById(
        "reserva-nueva-observacion"
    );

const botonCrearOtraReserva =
    document.getElementById(
        "crear-otra-reserva"
    );

const botonVerReservaCreada =
    document.getElementById(
        "ver-reserva-creada"
    );

const catalogoCabanasReserva = {

    "1": {
        nombre: "Loft Clásico 1",
        capacidad: 3,
        precio: 160000
    },

    "2": {
        nombre: "Loft Clásico 2",
        capacidad: 3,
        precio: 160000
    },

    "3": {
        nombre: "Loft Clásico 3",
        capacidad: 3,
        precio: 160000
    },

    "4": {
        nombre: "Loft Clásico 4",
        capacidad: 3,
        precio: 160000
    },

    "5": {
        nombre: "Deluxe",
        capacidad: 3,
        precio: 170000
    },

    "6": {
        nombre: "Loft Clásico 6",
        capacidad: 3,
        precio: 160000
    },

    "7": {
        nombre: "Dos Ambientes 7",
        capacidad: 5,
        precio: 180000
    },

    "8": {
        nombre: "Dos Ambientes 8",
        capacidad: 5,
        precio: 180000
    },

    "9": {
        nombre: "Dos Ambientes 9",
        capacidad: 5,
        precio: 180000
    },

    "10": {
        nombre: "Mini Loft",
        capacidad: 2,
        precio: 150000
    },

    "11": {
        nombre: "Maxi Loft",
        capacidad: 4,
        precio: 180000
    }

};

let modoFormularioReserva =
    "crear";

let reservaEditandoId =
    "";

let reservaEditandoOriginal =
    null;

let reservaEditandoFichaOriginal =
    {};

let cabanaSeleccionadaReserva = "";
let tarifasNochesReserva = {};
let reservaCreadaId = "";

let adultosReserva = 1;
let ninosReserva = 0;
let mascotasReserva = 0;


let mesReservaBase = new Date();
mesReservaBase.setDate(1);

let fechaLlegadaReserva = "";
let fechaSalidaReserva = "";

function abrirModalEditarReserva(
    reservaId
) {

    if (
        !modalNuevaReserva ||
        !reservaId ||
        typeof buscarDatosReservaPorId !==
            "function"
    ) {
        return false;
    }


    const registro =
        buscarDatosReservaPorId(
            reservaId
        );


    if (!registro?.cabana) {

        alert(
            "No se encontraron los datos de esta reserva."
        );

        return false;
    }


    const cabana =
        registro.cabana;


    const fichasReservas =
        JSON.parse(
            localStorage.getItem(
                "haikuFichaReservas"
            ) || "{}"
        );


    const ficha =
        fichasReservas[reservaId] ||
        {};


    const fechaIngreso =
        cabana.fechaOrigenReserva ||
        cabana.fechaIngresoReserva ||
        registro.fecha;


    const noches =
        Number(cabana.noches) || 1;


    modoFormularioReserva =
        "editar";

    reservaEditandoId =
        String(reservaId);


    reservaEditandoOriginal = {

        reservaId:
            String(reservaId),

        numeroCabana:
            String(
                registro.numeroCabana
            ),

        fechaIngreso,

        noches,

        cabana:
            JSON.parse(
                JSON.stringify(cabana)
            )
    };


    reservaEditandoFichaOriginal =
        JSON.parse(
            JSON.stringify(ficha)
        );


    fechaLlegadaReserva =
        fechaIngreso;

    fechaSalidaReserva =
        sumarDiasNuevaReserva(
            fechaIngreso,
            noches
        );


    cabanaSeleccionadaReserva =
        String(
            registro.numeroCabana
        );


    tarifasNochesReserva = {
        ...(
            cabana.tarifasNoches ||
            ficha.tarifasNoches ||
            {}
        )
    };


    adultosReserva =
        Number(cabana.adultos) || 1;

    ninosReserva =
        Number(cabana.ninos) || 0;

    mascotasReserva =
        Number(cabana.mascotas) || 0;


    const [
        anioIngreso,
        mesIngreso
    ] = fechaIngreso
        .split("-")
        .map(Number);


    mesReservaBase =
        new Date(
            anioIngreso,
            mesIngreso - 1,
            1
        );


    if (tituloModalReserva) {

        tituloModalReserva.textContent =
            "Editar reserva";
    }


    if (botonCrearNuevaReserva) {

        botonCrearNuevaReserva.textContent =
            "Guardar cambios";

        // Se habilitará cuando conectemos
        // el guardado definitivo.
        botonCrearNuevaReserva.disabled =
            true;
    }


    fechaLlegadaTexto.textContent =
        formatearFechaReserva(
            fechaLlegadaReserva
        );

    fechaSalidaTexto.textContent =
        formatearFechaReserva(
            fechaSalidaReserva
        );


    continuarFechasReserva.disabled =
        false;

    continuarReservaDetalles.disabled =
        true;


    listaCabanasDisponibles.innerHTML =
        "";

    resumenCabanaSeleccionada.innerHTML =
        "";

    reservaAcompanantes.innerHTML =
        "";

    resumenConfirmacionReserva.innerHTML =
        "";


    campoNuevoTitular.value =
        ficha.titular ||
        cabana.titular ||
        "";

    campoNuevoTelefono.value =
        ficha.telefono ||
        cabana.telefono ||
        "";

    campoNuevoRut.value =
        ficha.rut ||
        cabana.rut ||
        "";

    campoNuevoCorreo.value =
        ficha.correo ||
        cabana.correo ||
        "";

    campoNuevaObservacion.value =
        ficha.observaciones ||
        cabana.observaciones ||
        "";


    pasoFechasReserva.hidden =
        false;

    pasoCabanaReserva.hidden =
        true;

    pasoDetallesReserva.hidden =
        true;

    pasoConfirmacionReserva.hidden =
        true;


    document
        .querySelectorAll(
            ".reserva-paso"
        )
        .forEach(paso => {

            paso.classList.toggle(
                "activo",
                paso.dataset.paso === "1"
            );
        });


    renderizarCalendarioNuevaReserva();

    actualizarSeleccionCalendarioReserva();


    modalNuevaReserva.hidden =
        false;

    document.body.style.overflow =
        "hidden";


    return true;
}

function nombreMesReserva(fecha) {
    return fecha.toLocaleDateString("es-CL", {
        month: "long",
        year: "numeric"
    });
}

function sumarDiasNuevaReserva(fechaISO, cantidad) {
    const [anio, mes, dia] =
        fechaISO.split("-").map(Number);

    const fecha =
        new Date(anio, mes - 1, dia);

    fecha.setDate(
        fecha.getDate() + cantidad
    );

    return [
        fecha.getFullYear(),
        String(fecha.getMonth() + 1).padStart(2, "0"),
        String(fecha.getDate()).padStart(2, "0")
    ].join("-");
}


function cabanaOcupadaEnNoche(numeroCabana, fechaISO) {

    let ocupada = false;

    Object.entries(datosPorFecha).forEach(
        ([fechaDia, datosDia]) => {

            if (ocupada) return;
            if (!datosDia?.cabanas) return;

            const cabana =
                datosDia.cabanas[numeroCabana];

            if (!cabana) return;

            if (
    modoFormularioReserva ===
        "editar" &&
    reservaEditandoId &&
    String(
        cabana.reservaId || ""
    ) === String(
        reservaEditandoId
    )
) {
    return;
}


            // BLOQUEO operativo
            if (
                fechaDia === fechaISO &&
                cabana.estado === "bloqueada"
            ) {
                ocupada = true;
                return;
            }


            // No hay reserva real
            if (!cabana.reservaId) return;


            const fechaIngreso =
                cabana.fechaOrigenReserva ||
                cabana.fechaIngresoReserva ||
                fechaDia;

            const noches =
                Number(cabana.noches) || 0;

            if (noches <= 0) return;


            const fechaSalida =
                sumarDiasNuevaReserva(
                    fechaIngreso,
                    noches
                );


            // Una reserva ocupa las NOCHES:
            // ingreso incluido
            // salida excluida
            if (
                fechaISO >= fechaIngreso &&
                fechaISO < fechaSalida
            ) {
                ocupada = true;
            }
        }
    );

    return ocupada;
}


function fechaTieneDisponibilidad(fechaISO) {

    for (
        let numeroCabana = 1;
        numeroCabana <= 11;
        numeroCabana++
    ) {

        const ocupada =
            cabanaOcupadaEnNoche(
                String(numeroCabana),
                fechaISO
            );

        if (!ocupada) {
            return true;
        }
    }

    return false;
}


function crearMesReserva(fechaMes) {

    const contenedorMes = document.createElement("div");
    contenedorMes.className = "reserva-mes";

    const titulo = document.createElement("strong");
    titulo.className = "reserva-mes-titulo";

    const nombreMes = nombreMesReserva(fechaMes);

    titulo.textContent =
        nombreMes.charAt(0).toUpperCase() +
        nombreMes.slice(1);

    contenedorMes.appendChild(titulo);


    const diasSemana = document.createElement("div");
    diasSemana.className = "reserva-dias-semana";

    ["L", "M", "M", "J", "V", "S", "D"].forEach(dia => {

        const span = document.createElement("span");
        span.textContent = dia;

        diasSemana.appendChild(span);
    });

    contenedorMes.appendChild(diasSemana);


    const grilla = document.createElement("div");
    grilla.className = "reserva-mes-grilla";


    const año = fechaMes.getFullYear();
    const mes = fechaMes.getMonth();

    const primerDia = new Date(año, mes, 1);

    // JS: domingo = 0
    // Nosotros: lunes = primera columna
    const desplazamiento =
        (primerDia.getDay() + 6) % 7;


    for (let i = 0; i < desplazamiento; i++) {

        const vacio = document.createElement("span");
        vacio.className = "reserva-dia-vacio";

        grilla.appendChild(vacio);
    }


    const totalDias =
        new Date(año, mes + 1, 0).getDate();


    for (let dia = 1; dia <= totalDias; dia++) {

        const botonDia = document.createElement("button");

        botonDia.type = "button";
        botonDia.className = "reserva-dia";

        botonDia.textContent = dia;

        const fecha =
            `${año}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

botonDia.dataset.fecha = fecha;

const disponible =
    fechaTieneDisponibilidad(fecha);

if (!disponible) {

    botonDia.classList.add("ocupado");
    botonDia.disabled = true;

}

if (!botonDia.disabled) {
    botonDia.addEventListener("click", () => {
        seleccionarFechaNuevaReserva(fecha);
    });
}

grilla.appendChild(botonDia);
    }


    contenedorMes.appendChild(grilla);

    return contenedorMes;
}

function formatearFechaReserva(fechaISO) {
    const [anio, mes, dia] = fechaISO.split("-");

    return `${dia}-${mes}-${anio}`;
}


function obtenerCabanasDisponiblesEnRango(fechaInicio, fechaFin) {

    const disponibles = [];

    for (
        let numeroCabana = 1;
        numeroCabana <= 11;
        numeroCabana++
    ) {

        let disponibleTodoElRango = true;

        let fechaActual = fechaInicio;

        while (fechaActual < fechaFin) {

            if (
                cabanaOcupadaEnNoche(
                    String(numeroCabana),
                    fechaActual
                )
            ) {

                disponibleTodoElRango = false;
                break;
            }

            fechaActual =
                sumarDiasNuevaReserva(
                    fechaActual,
                    1
                );
        }

        if (disponibleTodoElRango) {

            disponibles.push(
                String(numeroCabana)
            );
        }
    }

    return disponibles;
}


function formatearPrecioReserva(valor) {

    return new Intl.NumberFormat(
        "es-CL",
        {
            style: "currency",
            currency: "CLP",
            maximumFractionDigits: 0
        }
    ).format(valor);
}


function calcularNochesReserva(fechaInicio, fechaFin) {

    const inicio =
        new Date(`${fechaInicio}T12:00:00`);

    const fin =
        new Date(`${fechaFin}T12:00:00`);

    return Math.round(
        (fin - inicio) / 86400000
    );
}

function mostrarSelectorOcupacionReserva(
    tarjeta,
    cabana
) {

    const panel =
        document.createElement("div");

    panel.className =
        "reserva-ocupacion-panel";


    const opcionesAdultos =
        Array.from(
            {
                length:
                    cabana.capacidad
            },
            (_, indice) =>
                indice + 1
        )
        .map(cantidad => `
            <option
                value="${cantidad}"
                ${
                    cantidad === adultosReserva
                        ? "selected"
                        : ""
                }
            >
                ${cantidad}
            </option>
        `)
        .join("");


    const opcionesNinos =
        Array.from(
            {
                length:
                    cabana.capacidad
            },
            (_, indice) => indice
        )
        .map(cantidad => `
            <option
                value="${cantidad}"
                ${
                    cantidad === ninosReserva
                        ? "selected"
                        : ""
                }
            >
                ${cantidad}
            </option>
        `)
        .join("");


    panel.innerHTML = `
        <div class="reserva-ocupacion-titulo">

            <strong>Huéspedes</strong>

            <span>
                Máximo ${cabana.capacidad}
                ${
                    cabana.capacidad === 1
                        ? "persona"
                        : "personas"
                }
            </span>

        </div>

        <label>
            Adultos

            <select class="reserva-ocupacion-adultos">
                ${opcionesAdultos}
            </select>
        </label>

        <label>
            Niños

            <select class="reserva-ocupacion-ninos">
                ${opcionesNinos}
            </select>
        </label>
    `;


    tarjeta.insertAdjacentElement(
        "afterend",
        panel
    );


    const selectorAdultos =
        panel.querySelector(
            ".reserva-ocupacion-adultos"
        );

    const selectorNinos =
        panel.querySelector(
            ".reserva-ocupacion-ninos"
        );


    selectorAdultos.addEventListener(
        "change",
        () => {

            adultosReserva =
                Number(
                    selectorAdultos.value
                );


            if (
                adultosReserva +
                ninosReserva >
                cabana.capacidad
            ) {

                ninosReserva =
                    Math.max(
                        0,
                        cabana.capacidad -
                        adultosReserva
                    );

                selectorNinos.value =
                    String(ninosReserva);
            }
        }
    );


    selectorNinos.addEventListener(
        "change",
        () => {

            ninosReserva =
                Number(
                    selectorNinos.value
                );


            if (
                adultosReserva +
                ninosReserva >
                cabana.capacidad
            ) {

                adultosReserva =
                    Math.max(
                        1,
                        cabana.capacidad -
                        ninosReserva
                    );

                selectorAdultos.value =
                    String(adultosReserva);
            }
        }
    );
}

function mostrarEditorTarifasReserva(
    tarjeta,
    cabana,
    noches
) {

    const panelAbierto =
        tarjeta.nextElementSibling;

    if (
        panelAbierto &&
        panelAbierto.classList.contains(
            "reserva-tarifas-panel"
        )
    ) {
        panelAbierto.remove();
        return;
    }


    document
        .querySelectorAll(".reserva-tarifas-panel")
        .forEach(panel => panel.remove());


    const tarifasTemporales = {};

    let filasTarifas = "";


    for (let indice = 0; indice < noches; indice++) {

        const fechaNoche =
            sumarDiasNuevaReserva(
                fechaLlegadaReserva,
                indice
            );

        const fechaSiguiente =
            sumarDiasNuevaReserva(
                fechaNoche,
                1
            );

        const tarifaGuardada =
            tarifasNochesReserva[fechaNoche];

        const tarifa =
            tarifaGuardada ?? cabana.precio;

        tarifasTemporales[fechaNoche] =
            tarifa;


        filasTarifas += `
            <label class="reserva-tarifa-fila">

                <span>
                    ${formatearFechaReserva(fechaNoche)}
                    →
                    ${formatearFechaReserva(fechaSiguiente)}
                </span>

                <div class="reserva-tarifa-campo">
                    <span>$</span>

                    <input
                        type="number"
                        min="1"
                        step="1000"
                        value="${tarifa}"
                        data-tarifa-fecha="${fechaNoche}"
                    >
                </div>

            </label>
        `;
    }


    const panel =
        document.createElement("div");

    panel.className =
        "reserva-tarifas-panel";


    panel.innerHTML = `
        <div class="reserva-tarifas-encabezado">

            <strong>Tarifas por noche</strong>

            <span>
                Puedes modificar solamente las noches con oferta
            </span>

        </div>

        <div class="reserva-tarifas-lista">
            ${filasTarifas}
        </div>

        <div class="reserva-tarifas-total">

            <span>Total estancia</span>

            <strong>
                ${formatearPrecioReserva(
                    Object.values(
                        tarifasTemporales
                    ).reduce(
                        (suma, tarifa) =>
                            suma + tarifa,
                        0
                    )
                )}
            </strong>

        </div>

        <div class="reserva-tarifas-acciones">

            <button
                type="button"
                class="reserva-tarifas-cancelar"
            >
                Cancelar
            </button>

            <button
                type="button"
                class="reserva-tarifas-aplicar"
            >
                Aplicar tarifas
            </button>

        </div>
    `;


const panelOcupacion =
    tarjeta.nextElementSibling &&
    tarjeta.nextElementSibling
        .classList.contains(
            "reserva-ocupacion-panel"
        )
        ? tarjeta.nextElementSibling
        : null;


const puntoInsercion =
    panelOcupacion || tarjeta;


puntoInsercion.insertAdjacentElement(
    "afterend",
    panel
);


    const totalEditor =
        panel.querySelector(
            ".reserva-tarifas-total strong"
        );


    panel
        .querySelectorAll(
            "[data-tarifa-fecha]"
        )
        .forEach(input => {

            input.addEventListener(
                "input",
                () => {

                    tarifasTemporales[
                        input.dataset.tarifaFecha
                    ] = Number(input.value) || 0;


                    const nuevoTotal =
                        Object.values(
                            tarifasTemporales
                        ).reduce(
                            (suma, tarifa) =>
                                suma + tarifa,
                            0
                        );


                    totalEditor.textContent =
                        formatearPrecioReserva(
                            nuevoTotal
                        );
                }
            );

        });


    panel
        .querySelector(
            ".reserva-tarifas-cancelar"
        )
        .addEventListener(
            "click",
            () => panel.remove()
        );


    panel
        .querySelector(
            ".reserva-tarifas-aplicar"
        )
        .addEventListener(
            "click",
            () => {

                const tarifasInvalidas =
                    Object.values(
                        tarifasTemporales
                    ).some(
                        tarifa => tarifa <= 0
                    );

                if (tarifasInvalidas) {

                    alert(
                        "Cada noche debe tener una tarifa válida."
                    );

                    return;
                }


                tarifasNochesReserva = {
                    ...tarifasTemporales
                };


                const totalFinal =
                    Object.values(
                        tarifasNochesReserva
                    ).reduce(
                        (suma, tarifa) =>
                            suma + tarifa,
                        0
                    );


                const resumen =
                    tarjeta.querySelector(
                        ".reserva-cabana-info small"
                    );


                resumen.textContent =
                    `${noches} ${
                        noches === 1
                            ? "noche"
                            : "noches"
                    } · ${
                        formatearPrecioReserva(
                            totalFinal
                        )
                    }`;


                panel.remove();
            }
        );
}

function mostrarPasoCabanasReserva() {

    if (
        !fechaLlegadaReserva ||
        !fechaSalidaReserva
    ) {
        return;
    }


    const disponibles =
        obtenerCabanasDisponiblesEnRango(
            fechaLlegadaReserva,
            fechaSalidaReserva
        );


    const noches =
        calcularNochesReserva(
            fechaLlegadaReserva,
            fechaSalidaReserva
        );


    const cabanaActualEdicion =
    modoFormularioReserva === "editar"
        ? String(
            cabanaSeleccionadaReserva ||
            reservaEditandoOriginal
                ?.numeroCabana ||
            ""
        )
        : "";


cabanaSeleccionadaReserva =
    cabanaActualEdicion;


continuarReservaDetalles.disabled =
    true;

    listaCabanasDisponibles.innerHTML = "";


    disponibles.forEach(numeroCabana => {

        const cabana =
            catalogoCabanasReserva[numeroCabana];

        if (!cabana) return;


        const total =
            cabana.precio * noches;


        const tarjeta =
            document.createElement("button");

        tarjeta.type = "button";

        tarjeta.className =
            "reserva-cabana-opcion";

        tarjeta.dataset.cabana =
            numeroCabana;


        tarjeta.innerHTML = `
            <div class="reserva-cabana-info">

                <strong>
                    CAB ${numeroCabana} · ${cabana.nombre}
                </strong>

                <span>
                    Hasta ${cabana.capacidad} ${
                        cabana.capacidad === 1
                            ? "persona"
                            : "personas"
                    }
                </span>

                <small>
                    ${noches} ${
                        noches === 1
                            ? "noche"
                            : "noches"
                    } · ${formatearPrecioReserva(total)}
                </small>

                <span class="reserva-editar-tarifas">
                    Editar tarifas por noche
                </span>

            </div>

            <div class="reserva-cabana-lateral">

                <span class="reserva-cabana-disponible">
                    DISPONIBLE
                </span>

                <i class="reserva-cabana-radio"></i>

            </div>
        `;

        const enlaceEditarTarifas =
    tarjeta.querySelector(
        ".reserva-editar-tarifas"
    );


enlaceEditarTarifas.addEventListener(
    "click",
    evento => {

        evento.stopPropagation();

        mostrarEditorTarifasReserva(
            tarjeta,
            cabana,
            noches
        );
    }
);


        tarjeta.addEventListener(
            "click",
            () => {

                const cambioDeCabana =
    cabanaSeleccionadaReserva !==
    numeroCabana;


if (cambioDeCabana) {

    tarifasNochesReserva = {};


    if (
        modoFormularioReserva !==
        "editar"
    ) {
        adultosReserva = 1;
        ninosReserva = 0;
        mascotasReserva = 0;
    }
}


cabanaSeleccionadaReserva =
    numeroCabana;


document
    .querySelectorAll(
        ".reserva-tarifas-panel, .reserva-ocupacion-panel"
    )
    .forEach(panel => panel.remove());


                listaCabanasDisponibles
                    .querySelectorAll(
                        ".reserva-cabana-opcion"
                    )
                    .forEach(item => {

                        item.classList.toggle(
                            "seleccionada",
                            item === tarjeta
                        );

                    });

                    mostrarSelectorOcupacionReserva(
                        tarjeta,
                        cabana
                    );  

                continuarReservaDetalles.disabled =
                    false;
            }
        );


                listaCabanasDisponibles.appendChild(
            tarjeta
        );

    });


    if (cabanaActualEdicion) {

        const tarjetaActual =
            listaCabanasDisponibles
                .querySelector(
                    `[data-cabana="${cabanaActualEdicion}"]`
                );


        if (tarjetaActual) {
            tarjetaActual.click();
        }
    }


    pasoFechasReserva.hidden = true;
    pasoCabanaReserva.hidden = false;


    document
        .querySelectorAll(".reserva-paso")
        .forEach(paso => {

            paso.classList.toggle(
                "activo",
                paso.dataset.paso === "2"
            );

        });

}


function seleccionarFechaNuevaReserva(fecha) {

    // Sin llegada todavía
    if (!fechaLlegadaReserva) {

        fechaLlegadaReserva = fecha;
        fechaSalidaReserva = "";

    }

    // Ya había rango completo → comenzar nuevamente
    else if (fechaLlegadaReserva && fechaSalidaReserva) {

        fechaLlegadaReserva = fecha;
        fechaSalidaReserva = "";

    }

    // Elegir salida
    else {

        // Si toca una fecha anterior o igual,
        // esa fecha pasa a ser la nueva llegada
        if (fecha <= fechaLlegadaReserva) {

            fechaLlegadaReserva = fecha;
            fechaSalidaReserva = "";

        } else {

            const cabanasDisponibles =
                obtenerCabanasDisponiblesEnRango(
                    fechaLlegadaReserva,
                    fecha
                );

            // El rango completo no sirve
            if (cabanasDisponibles.length === 0) {

                alert(
                    "No hay una misma cabaña disponible durante todo ese rango."
                );

                fechaSalidaReserva = "";

            } else {

                fechaSalidaReserva = fecha;
            }
        }
    }

    actualizarSeleccionCalendarioReserva();
}

function actualizarSeleccionCalendarioReserva() {

    const botones =
        reservaCalendario.querySelectorAll(
            ".reserva-dia"
        );


    botones.forEach(boton => {

        boton.classList.remove(
            "seleccionado",
            "en-rango"
        );

        const fecha =
            boton.dataset.fecha;


        if (
            fecha === fechaLlegadaReserva ||
            fecha === fechaSalidaReserva
        ) {
            boton.classList.add(
                "seleccionado"
            );
        }


        if (
            fechaLlegadaReserva &&
            fechaSalidaReserva &&
            fecha > fechaLlegadaReserva &&
            fecha < fechaSalidaReserva
        ) {
            boton.classList.add(
                "en-rango"
            );
        }
    });


    fechaLlegadaTexto.textContent =
        fechaLlegadaReserva
            ? formatearFechaReserva(fechaLlegadaReserva)
            : "Seleccionar";


    fechaSalidaTexto.textContent =
        fechaSalidaReserva
            ? formatearFechaReserva(fechaSalidaReserva)
            : "Seleccionar";


    continuarFechasReserva.disabled =
        !(
            fechaLlegadaReserva &&
            fechaSalidaReserva
        );
}


function renderizarCalendarioNuevaReserva() {

    if (!reservaCalendario) return;

    reservaCalendario.innerHTML = "";


    const meses = document.createElement("div");
    meses.className = "reserva-calendario-meses";


    const primerMes =
        new Date(
            mesReservaBase.getFullYear(),
            mesReservaBase.getMonth(),
            1
        );

    const segundoMes =
        new Date(
            mesReservaBase.getFullYear(),
            mesReservaBase.getMonth() + 1,
            1
        );


    meses.appendChild(
        crearMesReserva(primerMes)
    );

    meses.appendChild(
        crearMesReserva(segundoMes)
    );


    reservaCalendario.appendChild(meses);
}

function mostrarPasoDetallesReserva() {

    if (!cabanaSeleccionadaReserva) {
        return;
    }


    const cabana =
        catalogoCabanasReserva[
            cabanaSeleccionadaReserva
        ];

    if (!cabana) {
        return;
    }


    const noches =
        calcularNochesReserva(
            fechaLlegadaReserva,
            fechaSalidaReserva
        );


    const tarifasGuardadas =
        Object.values(
            tarifasNochesReserva
        );


    const tieneTarifasPorNoche =
        tarifasGuardadas.length === noches;


    const totalReserva =
        tieneTarifasPorNoche
            ? tarifasGuardadas.reduce(
                (suma, tarifa) =>
                    suma + tarifa,
                0
            )
            : cabana.precio * noches;


    const tarifaModificada =
        tieneTarifasPorNoche &&
        tarifasGuardadas.some(
            tarifa =>
                tarifa !== cabana.precio
        );

    reservaAcompanantes.innerHTML = "";


for (
    let numeroAcompanante = 1;
numeroAcompanante <
    adultosReserva + ninosReserva;
    numeroAcompanante++
) {

    const campoAcompanante =
        document.createElement("label");

        campoAcompanante.innerHTML = `
        Acompañante ${numeroAcompanante}

        <input
            type="text"
            class="reserva-nuevo-acompanante"
            data-acompanante="${numeroAcompanante}"
            placeholder="Nombre completo (opcional)"
        >
    `;


    const inputAcompanante =
        campoAcompanante.querySelector(
            ".reserva-nuevo-acompanante"
        );


    if (
        modoFormularioReserva ===
            "editar" &&
        inputAcompanante
    ) {
        inputAcompanante.value =
            reservaEditandoFichaOriginal[
                `acompanante${numeroAcompanante}`
            ] || "";
    }


    reservaAcompanantes.appendChild(
        campoAcompanante
    );
}


    resumenCabanaSeleccionada.innerHTML = `
        <div class="reserva-detalles-resumen">

            <div class="reserva-detalles-cabana">

                <strong>
                    CAB ${cabanaSeleccionadaReserva}
                    ·
                    ${cabana.nombre}
                </strong>

                <span>
                    ${formatearFechaReserva(
                        fechaLlegadaReserva
                    )}
                    →
                    ${formatearFechaReserva(
                        fechaSalidaReserva
                    )}
                    ·
                    ${noches} ${
                        noches === 1
                            ? "noche"
                            : "noches"
                    }
                </span>

                ${
                    tarifaModificada
                        ? `
                            <small>
                                Tarifa personalizada
                            </small>
                        `
                        : ""
                }

            </div>

            <div class="reserva-detalles-total">

                <span>Total</span>

                <strong>
                    ${formatearPrecioReserva(
                        totalReserva
                    )}
                </strong>

            </div>

        </div>
    `;


    document
        .querySelectorAll(
            ".reserva-tarifas-panel"
        )
        .forEach(panel => panel.remove());


    pasoCabanaReserva.hidden = true;
    pasoDetallesReserva.hidden = false;


    document
        .querySelectorAll(".reserva-paso")
        .forEach(paso => {

            paso.classList.toggle(
                "activo",
                paso.dataset.paso === "3"
            );

        });

    if (
        modoFormularioReserva === "editar" &&
        botonCrearNuevaReserva
    ) {
        botonCrearNuevaReserva.disabled = false;
    }
}

// ========================================
// EDITAR RESERVA · GUARDADO DEFINITIVO
// ========================================

const camposReservaEdicion = [
    "reservaId", "titular", "adultos", "ninos", "mascotas",
    "estado", "estadoIngresoReserva", "noches",
    "continuidadAutomatica", "fechaOrigenReserva",
    "fechaIngresoReserva", "correo", "telefono", "rut",
    "observaciones", "tarifasNoches", "totalReserva",
    "abono", "montoAbono", "abonoVerificado", "medioPago",
    "checkinRealizado", "checkinManual", "checkout",
    "checkinCobrado", "checkinMedio", "checkinFolio",
    "checkinCodAut", "checkinBove", "checkinManager",
    "checkinCompleto", "borradoManual", "editadoManual"
];

function copiarDatosReservaEdicion(registro) {
    const copia = {};

    camposReservaEdicion.forEach(campo => {
        if (
            Object.prototype.hasOwnProperty.call(
                registro || {},
                campo
            )
        ) {
            copia[campo] = registro[campo];
        }
    });

    return copia;
}

function copiarDatosOperativosEdicion(registro) {
    const copia = { ...(registro || {}) };

    camposReservaEdicion.forEach(
        campo => delete copia[campo]
    );

    return copia;
}

function retirarReservaParaEdicion(
    reservaId,
    fechaIngresoOriginal
) {
    const vinculados = {
        solicitudes: [],
        notas: []
    };

    Object.entries(datosPorFecha).forEach(
        ([fechaDia, datosDia]) => {
            if (!datosDia?.cabanas) return;

            Object.entries(datosDia.cabanas).forEach(
                ([numeroCabana, registro]) => {
                    if (
                        String(registro?.reservaId || "") !==
                        String(reservaId)
                    ) {
                        return;
                    }

                    const desplazamiento = Math.max(
                        0,
                        calcularNochesReserva(
                            fechaIngresoOriginal,
                            fechaDia
                        )
                    );

                    const solicitud = String(
                        registro.solicitudAseoExpress || ""
                    ).trim();

                    if (solicitud) {
                        vinculados.solicitudes.push({
                            desplazamiento,
                            texto: solicitud,
                            estadoFinal: registro.estadoFinal || ""
                        });

                        delete registro.solicitudAseoExpress;
                        delete registro.estadoFinal;
                    }

                    if (Array.isArray(datosDia.notasOperativas)) {
                        const notasRestantes = [];

                        datosDia.notasOperativas.forEach(nota => {
                            if (
                                String(nota?.cabana || "") ===
                                String(numeroCabana)
                            ) {
                                vinculados.notas.push({
                                    desplazamiento,
                                    nota: JSON.parse(
                                        JSON.stringify(nota)
                                    )
                                });
                            } else {
                                notasRestantes.push(nota);
                            }
                        });

                        datosDia.notasOperativas = notasRestantes;
                    }

                    const estadoRestante =
                        registro.estado === "sale-ingresa"
                            ? "sale-libre"
                            : "libre-libre";

                    camposReservaEdicion.forEach(
                        campo => delete registro[campo]
                    );

                    if (Object.keys(registro).length === 0) {
                        if (estadoRestante === "sale-libre") {
                            datosDia.cabanas[numeroCabana] = {
                                estado: "sale-libre"
                            };
                        } else {
                            delete datosDia.cabanas[numeroCabana];
                        }
                    } else {
                        registro.estado = estadoRestante;
                    }
                }
            );
        }
    );

    return vinculados;
}

function obtenerRegistroDestinoVinculo(
    reservaId,
    numeroCabana,
    fechaIngreso,
    noches,
    desplazamiento
) {
    const ultimoDia = Math.max(0, noches - 1);
    const fechaDestino = sumarDiasNuevaReserva(
        fechaIngreso,
        Math.min(desplazamiento, ultimoDia)
    );
    const datosDestino = obtenerDatosDia(fechaDestino);
    const registroDestino =
        datosDestino.cabanas?.[numeroCabana];

    if (
        !registroDestino ||
        String(registroDestino.reservaId || "") !==
            String(reservaId)
    ) {
        return null;
    }

    return {
        fechaDestino,
        datosDestino,
        registroDestino
    };
}

function restaurarVinculosReservaEditada(
    vinculados,
    reservaId,
    numeroCabana,
    fechaIngreso,
    noches
) {
    vinculados.solicitudes.forEach(solicitud => {
        const destino = obtenerRegistroDestinoVinculo(
            reservaId,
            numeroCabana,
            fechaIngreso,
            noches,
            solicitud.desplazamiento
        );

        if (!destino) return;

        const anterior = String(
            destino.registroDestino.solicitudAseoExpress || ""
        ).trim();

        destino.registroDestino.solicitudAseoExpress = anterior
            ? `${anterior} · ${solicitud.texto}`
            : solicitud.texto;

        if (solicitud.estadoFinal) {
            destino.registroDestino.estadoFinal =
                solicitud.estadoFinal;
        }
    });

    vinculados.notas.forEach(elemento => {
        const destino = obtenerRegistroDestinoVinculo(
            reservaId,
            numeroCabana,
            fechaIngreso,
            noches,
            elemento.desplazamiento
        );

        if (!destino) return;

        if (!Array.isArray(destino.datosDestino.notasOperativas)) {
            destino.datosDestino.notasOperativas = [];
        }

        const nota = {
            ...elemento.nota,
            cabana: String(numeroCabana)
        };

        if (
            Object.prototype.hasOwnProperty.call(
                nota,
                "fecha"
            )
        ) {
            nota.fecha = destino.fechaDestino;
        }

        destino.datosDestino.notasOperativas.push(nota);
    });
}

function reaplicarHospedajeReservaEditada(
    reservaId,
    fechaIngreso,
    estabaHospedada
) {
    if (!estabaHospedada) return;

    Object.entries(datosPorFecha).forEach(
        ([fechaDia, datosDia]) => {
            Object.values(datosDia?.cabanas || {}).forEach(
                registro => {
                    if (
                        String(registro?.reservaId || "") !==
                        String(reservaId)
                    ) {
                        return;
                    }

                    registro.checkinRealizado =
                        registro.estado !== "sale-libre";

                    if (fechaDia === fechaIngreso) {
                        registro.checkinManual = true;
                    }
                }
            );
        }
    );
}

function mostrarConfirmacionReservaEditada({
    reservaId,
    numeroCabana,
    nombreCabana,
    titular,
    totalReserva
}) {
    const titulo = pasoConfirmacionReserva.querySelector(
        ".reserva-confirmacion-titulo strong"
    );
    const texto = pasoConfirmacionReserva.querySelector(
        ".reserva-confirmacion-titulo span"
    );

    if (titulo) titulo.textContent = "¡Reserva actualizada!";
    if (texto) {
        texto.textContent =
            "Los cambios fueron guardados correctamente.";
    }

    resumenConfirmacionReserva.innerHTML = `
        <div class="reserva-confirmacion-fila">
            <span>Cabaña</span>
            <strong>CAB ${numeroCabana} · ${nombreCabana}</strong>
        </div>

        <div class="reserva-confirmacion-fila">
            <span>Fechas</span>
            <strong>
                ${formatearFechaReserva(fechaLlegadaReserva)}
                →
                ${formatearFechaReserva(fechaSalidaReserva)}
            </strong>
        </div>

        <div class="reserva-confirmacion-fila">
            <span>Titular</span>
            <strong>${titular}</strong>
        </div>

        <div class="reserva-confirmacion-fila">
            <span>Total</span>
            <strong class="reserva-confirmacion-total">
                ${formatearPrecioReserva(totalReserva)}
            </strong>
        </div>

        <div class="reserva-confirmacion-id">
            ${reservaId}
        </div>
    `;

    pasoDetallesReserva.hidden = true;
    pasoConfirmacionReserva.hidden = false;

    document.querySelectorAll(".reserva-paso").forEach(paso => {
        paso.classList.toggle(
            "activo",
            paso.dataset.paso === "4"
        );
    });
}

function guardarCambiosReservaEditada() {
    if (
        modoFormularioReserva !== "editar" ||
        !reservaEditandoId ||
        !reservaEditandoOriginal
    ) {
        return;
    }

    const titular = campoNuevoTitular.value.trim();

    if (!titular) {
        alert("Ingresa el nombre del titular de la reserva.");
        campoNuevoTitular.focus();
        return;
    }

    if (
        campoNuevoCorreo.value.trim() &&
        !campoNuevoCorreo.checkValidity()
    ) {
        alert("Revisa que el correo esté escrito correctamente.");
        campoNuevoCorreo.focus();
        return;
    }

    const reservaId = String(reservaEditandoId);
    const numeroCabana = String(cabanaSeleccionadaReserva);
    const cabana = catalogoCabanasReserva[numeroCabana];
    const noches = calcularNochesReserva(
        fechaLlegadaReserva,
        fechaSalidaReserva
    );

    if (!cabana || noches < 1) {
        alert("Selecciona una cabaña y fechas válidas.");
        return;
    }

    const disponibles = obtenerCabanasDisponiblesEnRango(
        fechaLlegadaReserva,
        fechaSalidaReserva
    );

    if (!disponibles.includes(numeroCabana)) {
        alert(
            "La cabaña seleccionada ya no está disponible durante todo ese rango."
        );
        return;
    }

    const acompanantes = Array.from(
        document.querySelectorAll(
            ".reserva-nuevo-acompanante"
        )
    ).map(campo => campo.value.trim());

    const tarifasFinales = {};

    for (let indice = 0; indice < noches; indice++) {
        const fechaNoche = sumarDiasNuevaReserva(
            fechaLlegadaReserva,
            indice
        );

        tarifasFinales[fechaNoche] =
            tarifasNochesReserva[fechaNoche] ?? cabana.precio;
    }

    const totalReserva = Object.values(tarifasFinales).reduce(
        (suma, tarifa) => suma + Number(tarifa),
        0
    );

    const originales = copiarDatosReservaEdicion(
        reservaEditandoOriginal.cabana
    );
    const estabaHospedada =
        originales.checkinManual === true ||
        originales.checkinRealizado === true;

    const respaldoDatos = JSON.parse(
        JSON.stringify(datosPorFecha)
    );
    const respaldoFichas = localStorage.getItem(
        "haikuFichaReservas"
    );

    try {
        const vinculados = retirarReservaParaEdicion(
            reservaId,
            reservaEditandoOriginal.fechaIngreso
        );
        const datosIngreso = obtenerDatosDia(fechaLlegadaReserva);
        const registroDestino =
            datosIngreso.cabanas?.[numeroCabana] || {};
        const tieneSalidaEseDia =
            registroDestino.estado === "sale-libre" ||
            Boolean(
                registroDestino.reservaId &&
                registroDestino.titular
            );
        const estadoIngreso = tieneSalidaEseDia
            ? "sale-ingresa"
            : "libre-ingresa";

        if (!datosIngreso.cabanas) datosIngreso.cabanas = {};

        datosIngreso.cabanas[numeroCabana] = {
            ...copiarDatosOperativosEdicion(registroDestino),
            ...originales,
            reservaId,
            titular,
            adultos: String(adultosReserva),
            ninos: String(ninosReserva),
            mascotas: String(mascotasReserva),
            noches,
            fechaOrigenReserva: fechaLlegadaReserva,
            fechaIngresoReserva: fechaLlegadaReserva,
            estado: estadoIngreso,
            estadoIngresoReserva: estadoIngreso,
            continuidadAutomatica: false,
            editadoManual: true,
            borradoManual: false,
            correo: campoNuevoCorreo.value.trim(),
            telefono: campoNuevoTelefono.value.trim(),
            rut: campoNuevoRut.value.trim(),
            observaciones: campoNuevaObservacion.value.trim(),
            tarifasNoches: tarifasFinales,
            totalReserva
        };

        guardarDatos();
        crearContinuidadesReserva(
            fechaLlegadaReserva,
            numeroCabana,
            noches
        );
        reaplicarHospedajeReservaEditada(
            reservaId,
            fechaLlegadaReserva,
            estabaHospedada
        );
        restaurarVinculosReservaEditada(
            vinculados,
            reservaId,
            numeroCabana,
            fechaLlegadaReserva,
            noches
        );
        guardarDatos();

        const fichas = JSON.parse(
            localStorage.getItem("haikuFichaReservas") || "{}"
        );
        const ficha = {
            ...(fichas[reservaId] ||
                reservaEditandoFichaOriginal || {}),
            titular,
            rut: campoNuevoRut.value.trim(),
            telefono: campoNuevoTelefono.value.trim(),
            correo: campoNuevoCorreo.value.trim(),
            observaciones: campoNuevaObservacion.value.trim(),
            numeroCabana,
            fechaIngreso: fechaLlegadaReserva,
            noches,
            adultos: Number(adultosReserva),
            ninos: Number(ninosReserva),
            mascotas: Number(mascotasReserva),
            totalReserva,
            tarifasNoches: tarifasFinales
        };

        for (let indice = 0; indice < 5; indice++) {
            ficha[`acompanante${indice + 1}`] =
                acompanantes[indice] || "";
        }

        fichas[reservaId] = ficha;
        localStorage.setItem(
            "haikuFichaReservas",
            JSON.stringify(fichas)
        );
    } catch (error) {
        datosPorFecha = respaldoDatos;
        guardarDatos();

        if (respaldoFichas === null) {
            localStorage.removeItem("haikuFichaReservas");
        } else {
            localStorage.setItem(
                "haikuFichaReservas",
                respaldoFichas
            );
        }

        console.error("NO SE PUDO EDITAR LA RESERVA:", error);
        alert(
            "No se pudieron guardar los cambios. La reserva original fue restaurada."
        );
        return;
    }

    if (
        typeof actualizarServiciosReservaEditada === "function"
    ) {
        actualizarServiciosReservaEditada(
            reservaId,
            numeroCabana,
            titular
        );
    }

    if (
        typeof registrarActividadHaiku ===
        "function"
    ) {
        registrarActividadHaiku({
            tipo: "reserva",
            accion: "Reserva editada",
            reservaId,
            numeroCabana,
            titular,
            fechaOperacion: fechaLlegadaReserva,
            detalle:
                "Se actualizaron los datos, fechas o asignación de la reserva.",
            cambios: [
                {
                    campo: "Cabaña",
                    anterior:
                        `CAB ${reservaEditandoOriginal.numeroCabana}`,
                    nuevo: `CAB ${numeroCabana}`
                },
                {
                    campo: "Ingreso",
                    anterior:
                        reservaEditandoOriginal.fechaIngreso,
                    nuevo: fechaLlegadaReserva
                },
                {
                    campo: "Noches",
                    anterior:
                        reservaEditandoOriginal.noches,
                    nuevo: noches
                },
                {
                    campo: "Titular",
                    anterior: originales.titular || "",
                    nuevo: titular
                },
                {
                    campo: "Adultos",
                    anterior: originales.adultos || "0",
                    nuevo: adultosReserva
                },
                {
                    campo: "Niños",
                    anterior: originales.ninos || "0",
                    nuevo: ninosReserva
                },
                {
                    campo: "Mascotas",
                    anterior: originales.mascotas || "0",
                    nuevo: mascotasReserva
                },
                {
                    campo: "Total",
                    anterior:
                        originales.totalReserva || "0",
                    nuevo: totalReserva
                },
                {
                    campo: "Teléfono",
                    anterior:
                        reservaEditandoFichaOriginal.telefono ||
                        originales.telefono ||
                        "",
                    nuevo: campoNuevoTelefono.value.trim()
                },
                {
                    campo: "RUT",
                    anterior:
                        reservaEditandoFichaOriginal.rut ||
                        originales.rut ||
                        "",
                    nuevo: campoNuevoRut.value.trim()
                }
            ]
        });
    }

    reservaCreadaId = reservaId;

    if (typeof generarCalendario === "function") {
        generarCalendario();
    }
    if (typeof cargarCabanasDia === "function") {
        cargarCabanasDia(fechaSeleccionada, {
            evento: "reserva creada", tipo: "externo"
        });
    }
    if (typeof actualizarResumenDia === "function") {
        actualizarResumenDia(fechaSeleccionada);
    }
    if (typeof generarResumenOperativo === "function") {
        generarResumenOperativo(fechaSeleccionada);
    }

    mostrarConfirmacionReservaEditada({
        reservaId,
        numeroCabana,
        nombreCabana: cabana.nombre,
        titular,
        totalReserva
    });
}

function crearReservaDesdeFormulario() {

    const titular =
        campoNuevoTitular.value.trim();


    if (!titular) {

        alert(
            "Ingresa el nombre del titular de la reserva."
        );

        campoNuevoTitular.focus();
        return;
    }


    if (
        campoNuevoCorreo.value.trim() &&
        !campoNuevoCorreo.checkValidity()
    ) {

        alert(
            "Revisa que el correo esté escrito correctamente."
        );

        campoNuevoCorreo.focus();
        return;
    }


    const numeroCabana =
        cabanaSeleccionadaReserva;

    const cabana =
        catalogoCabanasReserva[
            numeroCabana
        ];

    if (!cabana) {
        return;
    }


    const noches =
        calcularNochesReserva(
            fechaLlegadaReserva,
            fechaSalidaReserva
        );


    const acompanantes =
        Array.from(
            document.querySelectorAll(
                ".reserva-nuevo-acompanante"
            )
        ).map(
            campo => campo.value.trim()
        );


    const cantidadHuespedes =
    adultosReserva +
    ninosReserva;


    const tarifasFinales = {};

    for (
        let indice = 0;
        indice < noches;
        indice++
    ) {

        const fechaNoche =
            sumarDiasNuevaReserva(
                fechaLlegadaReserva,
                indice
            );

        tarifasFinales[fechaNoche] =
            tarifasNochesReserva[fechaNoche]
            ?? cabana.precio;
    }


    const totalReserva =
        Object.values(
            tarifasFinales
        ).reduce(
            (suma, tarifa) =>
                suma + Number(tarifa),
            0
        );


    const reservaId =
        generarReservaId(
            fechaLlegadaReserva,
            numeroCabana
        );


    const datosIngreso =
        obtenerDatosDia(
            fechaLlegadaReserva
        );


    if (!datosIngreso.cabanas) {
        datosIngreso.cabanas = {};
    }


    const registroAnterior =
        datosIngreso.cabanas[
            numeroCabana
        ] || {};


    const tieneSalidaEseDia =
        registroAnterior.estado ===
            "sale-libre" ||
        Boolean(
            registroAnterior.reservaId &&
            registroAnterior.titular
        );


    const estadoIngreso =
        tieneSalidaEseDia
            ? "sale-ingresa"
            : "libre-ingresa";


    datosIngreso.cabanas[
        numeroCabana
    ] = {

        ...registroAnterior,

        reservaId,
        titular,

        adultos:
    String(adultosReserva),

ninos:
    String(ninosReserva),
        mascotas: "0",

        noches,

        fechaOrigenReserva:
            fechaLlegadaReserva,

        fechaIngresoReserva:
            fechaLlegadaReserva,

        estado: estadoIngreso,

        estadoIngresoReserva:
            estadoIngreso,

        continuidadAutomatica: false,
        editadoManual: true,
        borradoManual: false,

        correo:
            campoNuevoCorreo.value.trim(),

        telefono:
            campoNuevoTelefono.value.trim(),

        rut:
            campoNuevoRut.value.trim(),

        observaciones:
            campoNuevaObservacion.value.trim(),

        tarifasNoches:
            tarifasFinales,

        totalReserva,

        abono: "",
        montoAbono: "",
        abonoVerificado: false,
        medioPago: "",

        checkinRealizado: false,
        checkinManual: false,
        checkout: false
    };


    guardarDatos();


    crearContinuidadesReserva(
        fechaLlegadaReserva,
        numeroCabana,
        noches
    );


    const fichasReservas =
        JSON.parse(
            localStorage.getItem(
                "haikuFichaReservas"
            ) || "{}"
        );


    const fichaNueva = {

        titular,

        rut:
            campoNuevoRut.value.trim(),

        telefono:
            campoNuevoTelefono.value.trim(),

        correo:
            campoNuevoCorreo.value.trim(),

        observaciones:
            campoNuevaObservacion.value.trim(),

        totalReserva,

        tarifasNoches:
            tarifasFinales
    };


    for (
        let indice = 0;
        indice < 5;
        indice++
    ) {

        fichaNueva[
            `acompanante${indice + 1}`
        ] = acompanantes[indice] || "";
    }


    fichasReservas[reservaId] =
        fichaNueva;


    localStorage.setItem(
        "haikuFichaReservas",
        JSON.stringify(
            fichasReservas
        )
    );

    if (
        typeof registrarActividadHaiku ===
        "function"
    ) {
        registrarActividadHaiku({
            tipo: "reserva",
            accion: "Reserva creada",
            reservaId,
            numeroCabana,
            titular,
            fechaOperacion: fechaLlegadaReserva,
            detalle:
                `${noches} ${
                    noches === 1
                        ? "noche"
                        : "noches"
                } · ${cantidadHuespedes} ${
                    cantidadHuespedes === 1
                        ? "huésped"
                        : "huéspedes"
                } · Total $${Number(
                    totalReserva
                ).toLocaleString("es-CL")}`
        });
    }


    reservaCreadaId =
        reservaId;


    if (
        typeof generarCalendario ===
        "function"
    ) {
        generarCalendario();
    }


    if (
        fechaSeleccionada ===
        fechaLlegadaReserva
    ) {

        if (
            typeof cargarCabanasDia ===
            "function"
        ) {
            cargarCabanasDia(
                fechaSeleccionada,
                { evento: "reserva guardada", tipo: "externo" }
            );
        }

        if (
            typeof actualizarResumenDia ===
            "function"
        ) {
            actualizarResumenDia(
                fechaSeleccionada
            );
        }

        if (
            typeof generarResumenOperativo ===
            "function"
        ) {
            generarResumenOperativo(
                fechaSeleccionada
            );
        }
    }


    resumenConfirmacionReserva.innerHTML = `
        <div class="reserva-confirmacion-fila">
            <span>Cabaña</span>
            <strong>
                CAB ${numeroCabana}
                ·
                ${cabana.nombre}
            </strong>
        </div>

        <div class="reserva-confirmacion-fila">
            <span>Fechas</span>
            <strong>
                ${formatearFechaReserva(
                    fechaLlegadaReserva
                )}
                →
                ${formatearFechaReserva(
                    fechaSalidaReserva
                )}
            </strong>
        </div>

        <div class="reserva-confirmacion-fila">
            <span>Titular</span>
            <strong>${titular}</strong>
        </div>

        <div class="reserva-confirmacion-fila">
            <span>Huéspedes</span>
            <strong>
                ${cantidadHuespedes}
            </strong>
        </div>

        <div class="reserva-confirmacion-fila">
            <span>Total</span>
            <strong class="reserva-confirmacion-total">
                ${formatearPrecioReserva(
                    totalReserva
                )}
            </strong>
        </div>

        <div class="reserva-confirmacion-id">
            ${reservaId}
        </div>
    `;


    pasoDetallesReserva.hidden = true;
    pasoConfirmacionReserva.hidden = false;


    document
        .querySelectorAll(".reserva-paso")
        .forEach(paso => {

            paso.classList.toggle(
                "activo",
                paso.dataset.paso === "4"
            );

        });
}

// ========================================
// NUEVA RESERVA · NAVEGACIÓN ENTRE PASOS
// ========================================

if (continuarFechasReserva) {

    continuarFechasReserva.addEventListener(
        "click",
        mostrarPasoCabanasReserva
    );

}


if (volverReservaFechas) {

    volverReservaFechas.addEventListener(
        "click",
        () => {

            pasoCabanaReserva.hidden = true;
            pasoFechasReserva.hidden = false;

            document
                .querySelectorAll(".reserva-paso")
                .forEach(paso => {

                    paso.classList.toggle(
                        "activo",
                        paso.dataset.paso === "1"
                    );

                });

        }
    );

}

if (continuarReservaDetalles) {

    continuarReservaDetalles.addEventListener(
        "click",
        mostrarPasoDetallesReserva
    );

}


if (volverReservaCabana) {

    volverReservaCabana.addEventListener(
        "click",
        () => {

            pasoDetallesReserva.hidden = true;
            pasoCabanaReserva.hidden = false;

            document
                .querySelectorAll(".reserva-paso")
                .forEach(paso => {

                    paso.classList.toggle(
                        "activo",
                        paso.dataset.paso === "2"
                    );

                });

        }
    );

}

if (botonCrearNuevaReserva) {

    botonCrearNuevaReserva.addEventListener(
        "click",
        () => {
            if (modoFormularioReserva === "editar") {
                guardarCambiosReservaEditada();
                return;
            }

            crearReservaDesdeFormulario();
        }
    );

}

if (botonCrearOtraReserva) {

    botonCrearOtraReserva.addEventListener(
        "click",
        abrirModalNuevaReserva
    );

}


if (botonVerReservaCreada) {

    botonVerReservaCreada.addEventListener(
        "click",
        () => {

            if (
                !reservaCreadaId ||
                !cabanaSeleccionadaReserva ||
                !fechaLlegadaReserva
            ) {
                return;
            }


            const numeroCabana =
                cabanaSeleccionadaReserva;

            const fechaReserva =
                fechaLlegadaReserva;


            cerrarModalNuevaReserva();


            const fechaAnterior =
                fechaSeleccionada;


            fechaSeleccionada =
                fechaReserva;


            const botonFicha =
                document.querySelector(
                    `[data-ficha-cabana="${numeroCabana}"]`
                );


            if (botonFicha) {

                botonFicha.click();

            } else {

                alert(
                    "La reserva fue creada, pero no se encontró el acceso a su ficha."
                );
            }


            fechaSeleccionada =
                fechaAnterior;
        }
    );

}
