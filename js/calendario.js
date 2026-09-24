const fechaActual = document.getElementById("fecha-actual");

const hoy = new Date();

const formatoFecha = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
});

let fechaFormateada = formatoFecha.format(hoy);

fechaFormateada =
    fechaFormateada.charAt(0).toUpperCase() +
    fechaFormateada.slice(1);

fechaActual.textContent = fechaFormateada;

// ========================================
// CALENDARIO MENSUAL
// ========================================

const calendarioGrid = document.getElementById("calendario-grid");
const tituloMes = document.getElementById("titulo-mes");
const descripcionCalendario = document.getElementById("calendario-descripcion");

const botonAnterior = document.getElementById("mes-anterior");
const botonSiguiente = document.getElementById("mes-siguiente");
const botonHoyCalendario = document.getElementById("calendario-hoy");
const agendaCalendarioMovil = document.getElementById("calendario-agenda-movil");

let fechaCalendario = new Date();
let fechaCalendarioSeleccionadaMovil =
    `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
let reservasCalendarioMes = [];

function esCalendarioMovil() {
    return window.matchMedia?.("(max-width: 780px)").matches === true;
}

function reservasEnFechaCalendario(fecha, reservas) {
    return reservas.filter(reserva => {
        const salida = sumarDiasCalendario(reserva.fechaIngreso, Number(reserva.noches) || 0);
        // Las barras representan noches; la agenda del día incluye también salidas.
        return reserva.fechaIngreso <= fecha &&
            (reserva.esBloqueo || reserva.esFullDay ? fecha < salida : fecha <= salida);
    });
}

function fechaBreveCalendario(fecha) {
    const [año, mes, dia] = fecha.split("-").map(Number);
    return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" })
        .format(new Date(año, mes - 1, dia));
}

function pintarLeyendaCalendarioMovil() {
    const categorias = new Set();
    const inicio = `${fechaCalendario.getFullYear()}-${String(fechaCalendario.getMonth() + 1).padStart(2, "0")}-01`;
    const fin = sumarDiasCalendario(
        inicio, new Date(fechaCalendario.getFullYear(), fechaCalendario.getMonth() + 1, 0).getDate() - 1
    );
    reservasCalendarioMes.forEach(reserva => {
        const salida = sumarDiasCalendario(reserva.fechaIngreso, Number(reserva.noches) || 0);
        if (reserva.fechaIngreso > fin || salida < inicio) return;
        if (reserva.esBloqueo) { categorias.add("bloqueo"); return; }
        const estado = window.HAIKU_CALENDARIO_ESTADOS_V1
            ?.estado?.(reserva.reservaId, reserva.estadiaId) || "";
        if (estado === "hospedada") categorias.add("hospedado");
        else if (reserva.esFullDay && estado !== "checked_out") categorias.add("fullday");
        else if (estado === "confirmada") categorias.add("confirmada");
    });
    seccionCalendario.querySelectorAll("[data-calendario-leyenda]").forEach(item => {
        item.hidden = !categorias.has(item.dataset.calendarioLeyenda);
    });
}

function pintarAgendaCalendarioMovil() {
    if (!agendaCalendarioMovil || !esCalendarioMovil()) return;
    const fecha = fechaCalendarioSeleccionadaMovil;
    const [año, mes, dia] = fecha.split("-").map(Number);
    const fechaVisible = new Intl.DateTimeFormat("es-CL", {
        weekday: "long", day: "numeric", month: "long"
    }).format(new Date(año, mes - 1, dia));
    const cabecera = document.createElement("div");
    cabecera.className = "sites-calendario-agenda-cabecera";
    const titulo = document.createElement("strong");
    titulo.textContent = fechaVisible.charAt(0).toUpperCase() + fechaVisible.slice(1);
    const resumen = document.createElement("button");
    resumen.type = "button";
    resumen.textContent = "Ver resumen del día";
    resumen.addEventListener("click", () => seleccionarDia(año, mes - 1, dia, fecha));
    cabecera.append(titulo, resumen);
    agendaCalendarioMovil.replaceChildren(cabecera);

    const reservas = reservasEnFechaCalendario(fecha, reservasCalendarioMes);
    if (!reservas.length) {
        const vacio = document.createElement("p");
        vacio.className = "sites-calendario-agenda-vacia";
        vacio.textContent = "Sin reservas ni bloqueos para este día.";
        agendaCalendarioMovil.appendChild(vacio);
        return;
    }

    reservas.forEach(reserva => {
        const fila = document.createElement("button");
        fila.type = "button";
        fila.className = "sites-calendario-agenda-item";
        fila.dataset.reservaId = reserva.reservaId || "";
        fila.dataset.estadiaId = reserva.estadiaId || "";
        fila.dataset.cabana = String(reserva.numeroCabana);
        if (reserva.esFullDay) fila.dataset.haikuFullday = "1";
        if (reserva.esBloqueo) fila.classList.add("cal-reserva-bloqueada");
        const estado = window.HAIKU_CALENDARIO_ESTADOS_V1
            ?.estado?.(reserva.reservaId, reserva.estadiaId) || "";
        if (!reserva.esBloqueo) {
            if (estado === "hospedada") fila.classList.add("cal-reserva-checkin");
            else if (estado === "checked_out") fila.classList.add("cal-reserva-checkout");
            else if (reserva.esFullDay) fila.classList.add("cal-reserva-fullday");
            else if (estado === "confirmada") fila.classList.add("cal-reserva-confirmada");
            else if (estado === "pendiente") fila.classList.add("cal-reserva-confirmacion-pendiente");
        }
        const riel = document.createElement("span");
        riel.className = "sites-calendario-agenda-riel";
        const texto = document.createElement("span");
        texto.className = "sites-calendario-agenda-texto";
        const nombre = document.createElement("strong");
        nombre.textContent = `CAB ${reserva.numeroCabana} · ${reserva.esBloqueo ? "Bloqueada" : reserva.titular}`;
        const detalle = document.createElement("small");
        const salida = reserva.esFullDay ? reserva.fechaIngreso :
            sumarDiasCalendario(reserva.fechaIngreso, Number(reserva.noches) || 0);
        detalle.textContent = `${reserva.esBloqueo ? "Bloqueo" : reserva.esFullDay ? "Full Day" : "Reserva"} · ` +
            `${fechaBreveCalendario(reserva.fechaIngreso)} – ${fechaBreveCalendario(salida)}`;
        texto.append(nombre, detalle);
        const flecha = document.createElement("span");
        flecha.className = "sites-calendario-agenda-flecha";
        flecha.textContent = "›";
        fila.append(riel, texto, flecha);
        fila.addEventListener("click", () => {
            if (reserva.esBloqueo) {
                const id = String(reserva.bloqueoId || "").match(/BLQ-SB-([0-9a-f-]{36})/i)?.[1];
                if (id) window.HAIKU_BLOQUEOS_CALENDARIO_SUPABASE_V1?.liberar?.(id);
                return;
            }
            window.HAIKU_RESUMEN_RESERVA_SITES_V1?.abrirPorId?.(reserva.reservaId, fila);
        });
        agendaCalendarioMovil.appendChild(fila);
    });
}

function seleccionarFechaCalendarioMovil(fecha) {
    fechaCalendarioSeleccionadaMovil = fecha;
    const [año, mes] = fecha.split("-").map(Number);
    if (fechaCalendario.getFullYear() !== año || fechaCalendario.getMonth() !== mes - 1) {
        fechaCalendario = new Date(año, mes - 1, 1);
        generarCalendario();
        return;
    }
    calendarioGrid.querySelectorAll(".dia-calendario").forEach(celda => {
        const seleccionada = celda.dataset.fecha === fecha;
        celda.classList.toggle("seleccionado", seleccionada);
        celda.setAttribute("aria-pressed", String(seleccionada));
    });
    pintarAgendaCalendarioMovil();
}

const seccionCalendario =
    document.getElementById("seccion-calendario");

const botonBloqueoCalendario =
    document.getElementById(
        "activar-bloqueo-calendario"
    );

const ayudaBloqueoCalendario =
    document.getElementById(
        "calendario-bloqueo-ayuda"
    );

const modalBloqueoCalendario =
    document.getElementById(
        "modal-bloqueo-calendario"
    );

const cerrarBloqueoCalendario =
    document.getElementById(
        "cerrar-bloqueo-calendario"
    );

const cancelarBloqueoCalendario =
    document.getElementById(
        "cancelar-bloqueo-calendario"
    );

const confirmarBloqueoCalendario =
    document.getElementById(
        "confirmar-bloqueo-calendario"
    );

const seleccionarTodasBloqueo =
    document.getElementById(
        "bloqueo-seleccionar-todas"
    );

const listaCabanasBloqueo =
    document.getElementById(
        "bloqueo-lista-cabanas"
    );

const catalogoCabanasBloqueo = {
    "1": "Loft Clásico 1",
    "2": "Loft Clásico 2",
    "3": "Loft Clásico 3",
    "4": "Loft Clásico 4",
    "5": "Deluxe",
    "6": "Loft Clásico 6",
    "7": "Dos Ambientes 7",
    "8": "Dos Ambientes 8",
    "9": "Dos Ambientes 9",
    "10": "Mini Loft",
    "11": "Maxi Loft"
};

let modoBloqueoCalendario = false;
let fechaInicioBloqueoCalendario = "";
let fechaFinBloqueoCalendario = "";


function generarCalendario() {

    calendarioGrid.innerHTML = "";

    const año = fechaCalendario.getFullYear();
    const mes = fechaCalendario.getMonth();
    if (esCalendarioMovil() &&
        !fechaCalendarioSeleccionadaMovil.startsWith(`${año}-${String(mes + 1).padStart(2, "0")}-`)) {
        fechaCalendarioSeleccionadaMovil = `${año}-${String(mes + 1).padStart(2, "0")}-01`;
    }

    // Título del mes
    const nombreMes = new Intl.DateTimeFormat("es-CL", {
        month: "long",
        year: "numeric"
    }).format(fechaCalendario);

    tituloMes.textContent =
        nombreMes.charAt(0).toUpperCase() +
        nombreMes.slice(1);

    if (botonHoyCalendario) {
        botonHoyCalendario.hidden =
            mes === hoy.getMonth() &&
            año === hoy.getFullYear();
    }


    // Primer día del mes
    const primerDia = new Date(año, mes, 1);

    // Cantidad de días
    const cantidadDias = new Date(
        año,
        mes + 1,
        0
    ).getDate();


    // JS: Domingo = 0
    // Nosotros: Lunes = 0

    let posicionPrimerDia = primerDia.getDay() - 1;

    if (posicionPrimerDia === -1) {
        posicionPrimerDia = 6;
    }


    // Las semanas completas muestran fechas contiguas. Los números quedan
    // dentro de cada celda, en su franja superior reservada por Sites.
    const totalCeldas = Math.ceil(
        (posicionPrimerDia + cantidadDias) / 7
    ) * 7;

    for (let indice = 0; indice < totalCeldas; indice++) {
        const fechaCelda = new Date(
            año,
            mes,
            1 - posicionPrimerDia + indice
        );
        const dia = fechaCelda.getDate();
        const añoDia = fechaCelda.getFullYear();
        const mesDia = fechaCelda.getMonth();
        const fechaDia =
            `${añoDia}-${String(mesDia + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
        const elementoDia = document.createElement("button");
        elementoDia.type = "button";
        elementoDia.classList.add("dia-calendario");
        elementoDia.dataset.fecha = fechaDia;
        elementoDia.setAttribute(
            "aria-label",
            new Intl.DateTimeFormat("es-CL", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            }).format(fechaCelda)
        );

        if (mesDia !== mes) {
            elementoDia.classList.add("dia-vacio");
        }
        if (
            dia === hoy.getDate() &&
            mesDia === hoy.getMonth() &&
            añoDia === hoy.getFullYear()
        ) {
            elementoDia.classList.add("hoy");
        }
        if (esCalendarioMovil()) {
            const seleccionada = fechaDia === fechaCalendarioSeleccionadaMovil;
            elementoDia.classList.toggle("seleccionado", seleccionada);
            elementoDia.setAttribute("aria-pressed", String(seleccionada));
        }

        const numero = document.createElement("span");
        numero.classList.add("numero-dia");
        numero.textContent = dia;
        elementoDia.appendChild(numero);

        elementoDia.addEventListener("click", () => {
            if (modoBloqueoCalendario) {
                seleccionarFechaBloqueoCalendario(fechaDia);
                return;
            }
            if (esCalendarioMovil()) {
                seleccionarFechaCalendarioMovil(fechaDia);
                return;
            }
            fechaCalendario = new Date(añoDia, mesDia, 1);
            seleccionarDia(añoDia, mesDia, dia, fechaDia);
        });

        calendarioGrid.appendChild(elementoDia);
    }


// Ahora que todos los días existen,
// dibujamos las reservas encima.
dibujarReservasCalendario();

// Si cambiamos de mes durante el modo bloqueo,
// conservamos visualmente el rango seleccionado.
pintarRangoBloqueoCalendario();

// Las sincronizaciones vuelven a construir todas las barras del calendario.
// Refrescamos sus vínculos una vez, cuando ese DOM ya quedó completo.
window.HAIKU_VINCULOS_ESTABLES_V1
    ?.refrescarCalendario?.();

}

// ========================================
// DIBUJAR RESERVAS EN CALENDARIO
// ========================================

function dibujarReservasCalendario() {
    const movil = esCalendarioMovil();

    // Capa independiente para las reservas.
// Así las barras NO alteran la cuadrícula de los días.
const capaReservas = movil ? null : document.createElement("div");

if (capaReservas) {
    capaReservas.className = "calendario-reservas-capa";
    calendarioGrid.appendChild(capaReservas);
}

    const datosCalendario =
        JSON.parse(
            localStorage.getItem("haikuDatos")
        ) || {};


    const reservasUnicas =
        new Map();


    // ========================================
    // REUNIR UNA SOLA VEZ CADA RESERVA
    // ========================================

    Object.entries(
        datosCalendario
    ).forEach(
        ([fecha, datosDia]) => {

            if (!datosDia?.cabanas) {
                return;
            }

            Object.entries(
                datosDia.cabanas
            ).forEach(
                ([numeroCabana, cabana]) => {

                    // Los bloqueos utilizan la misma barra
                    // que una reserva, pero cada cabaña
                    // conserva su propio número.
                    if (
                        cabana &&
                        String(
                            cabana.estado || ""
                        ).toLowerCase() === "bloqueada"
                    ) {
                        const fechaInicioBloqueo =
                            cabana.bloqueoFechaInicio ||
                            fecha;

                        const fechaFinBloqueo =
                            cabana.bloqueoFechaFin ||
                            sumarDiasCalendario(fecha, 1);

                        const nochesBloqueo =
                            calcularNochesBloqueoCalendario(
                                fechaInicioBloqueo,
                                fechaFinBloqueo
                            );

                        const bloqueoVisualId =
                            `${
                                cabana.bloqueoId ||
                                `BLQ-MANUAL-${fecha}`
                            }-CAB-${numeroCabana}`;

                        if (
                            nochesBloqueo > 0 &&
                            !reservasUnicas.has(
                                bloqueoVisualId
                            )
                        ) {
                            reservasUnicas.set(
                                bloqueoVisualId,
                                {
                                    reservaId:
                                        bloqueoVisualId,
                                    numeroCabana,
                                    titular: "Bloqueada",
                                    fechaIngreso:
                                        fechaInicioBloqueo,
                                    noches:
                                        nochesBloqueo,
                                    estado: "bloqueada",
                                    esBloqueo: true,
                                    bloqueoId:
                                        cabana.bloqueoId || "",
                                    motivoBloqueo:
                                        cabana.bloqueoMotivo || ""
                                }
                            );
                        }

                        return;
                    }

                    if (
                        !cabana ||
                        !cabana.reservaId ||
                        !cabana.titular
                    ) {
                        return;
                    }


                    // Preferimos el registro ORIGINAL
                    // y no una continuidad automática.
                    if (
                        cabana.continuidadAutomatica === true
                    ) {
                        return;
                    }


                    const claveVisual = cabana.estadiaId ||
                        `${cabana.reservaId}|${numeroCabana}|${cabana.fechaOrigenReserva || fecha}|${cabana.tipoEstadia || cabana.estado}`;
                    if (reservasUnicas.has(claveVisual)) {
                        return;
                    }


                    const esFullDay = cabana.tipoEstadia === 'fullday' || cabana.estado === 'fullday';
                    if (esFullDay && cabana.fulldayLiberadoEn) return;
                    // Ocupa una celda visual; las noches reales del cache siguen en cero.
                    const noches = esFullDay ? 1 : Number(cabana.noches) || 0;


                    if (noches < 1) {
                        return;
                    }


                    reservasUnicas.set(
                        claveVisual,
                        {
                            claveVisual,
                            estadiaId: cabana.estadiaId || '',
                            esFullDay,
                            reservaId:
                                cabana.reservaId,

                            numeroCabana,

                            titular:
                                cabana.titular,

                            fechaIngreso:
                                cabana.fechaOrigenReserva ||
                                fecha,

                            noches,

                            estado:
                                cabana.estado || ""
                        }
                    );
                }
            );
        }
    );

// Los estados visuales los aplica HAIKU_CALENDARIO_ESTADOS_V1 desde Supabase.
// La ficha y los abonos locales no deciden el estado de una estadía.

 // ========================================
// DIBUJAR RESERVAS COMO BARRAS REALES
// ========================================

// ========================================
// ORDEN DE FILAS POR NÚMERO DE CABAÑA
// ========================================

// CAB 1 siempre tiene prioridad sobre CAB 2,
// CAB 2 sobre CAB 3, etc.
// Si es la misma cabaña, ordenamos por fecha.
const reservasOrdenadas =
    Array.from(reservasUnicas.values())
        .sort((a, b) => {

            const diferenciaCabana =
                Number(a.numeroCabana) -
                Number(b.numeroCabana);

            if (diferenciaCabana !== 0) {
                return diferenciaCabana;
            }

            return a.fechaIngreso.localeCompare(
                b.fechaIngreso
            );
        });
reservasCalendarioMes = reservasOrdenadas;


const filasReserva = new Map();


// Cada fila guarda las reservas que ya utiliza.
// Así una fila puede reutilizarse cuando
// las fechas NO se cruzan.
const ocupacionFilas = [];


reservasOrdenadas.forEach(reserva => {

    const fechaInicio =
        reserva.fechaIngreso;

    const fechaSalida =
        sumarDiasCalendario(
            reserva.fechaIngreso,
            Number(reserva.noches) || 1
        );


    let filaEncontrada = -1;


    // Buscar la primera fila donde
    // esta reserva no choque con ninguna existente.
    for (
        let fila = 0;
        fila < ocupacionFilas.length;
        fila++
    ) {

        const hayCruce =
            ocupacionFilas[fila].some(
                existente => {

                    return (
                        fechaInicio <
                            existente.fechaSalida &&
                        fechaSalida >
                            existente.fechaInicio
                    );
                }
            );


        if (!hayCruce) {
            filaEncontrada = fila;
            break;
        }
    }


    // Si todas las filas están ocupadas,
    // crear una nueva.
    if (filaEncontrada === -1) {

        filaEncontrada =
            ocupacionFilas.length;

        ocupacionFilas.push([]);
    }


    ocupacionFilas[
        filaEncontrada
    ].push({
        fechaInicio,
        fechaSalida
    });


    filasReserva.set(
        reserva.claveVisual || reserva.reservaId,
        filaEncontrada
    );
});


// Datos del mes actualmente visible
const anioCalendario =
    fechaCalendario.getFullYear();

const mesCalendario =
    fechaCalendario.getMonth();

const primerDiaMes =
    new Date(
        anioCalendario,
        mesCalendario,
        1
    );

let posicionPrimerDia =
    primerDiaMes.getDay() - 1;

if (posicionPrimerDia === -1) {
    posicionPrimerDia = 6;
}

if (descripcionCalendario) {
    const inicioMes =
        `${anioCalendario}-${String(mesCalendario + 1).padStart(2, "0")}-01`;
    const siguienteMes = new Date(anioCalendario, mesCalendario + 1, 1);
    const inicioSiguienteMes =
        `${siguienteMes.getFullYear()}-${String(siguienteMes.getMonth() + 1).padStart(2, "0")}-01`;
    const visibles = reservasOrdenadas.filter(reserva => {
        const fechaSalida = sumarDiasCalendario(
            reserva.fechaIngreso,
            Number(reserva.noches) || 0
        );
        return reserva.fechaIngreso < inicioSiguienteMes &&
            (movil && !reserva.esBloqueo ? fechaSalida >= inicioMes : fechaSalida > inicioMes);
    });
    const reservas = visibles.filter(reserva => !reserva.esBloqueo).length;
    const bloqueos = visibles.length - reservas;
    descripcionCalendario.textContent =
        `${reservas} ${reservas === 1 ? "reserva" : "reservas"} · ` +
        `${bloqueos} ${bloqueos === 1 ? "bloqueo" : "bloqueos"}`;
}

if (movil) {
    calendarioGrid.querySelectorAll(".dia-calendario").forEach(celda => {
        celda.classList.toggle(
            "sites-calendario-dia-con-actividad",
            reservasEnFechaCalendario(celda.dataset.fecha, reservasOrdenadas).length > 0
        );
    });
    pintarAgendaCalendarioMovil();
    pintarLeyendaCalendarioMovil();
    return;
}
seccionCalendario.querySelectorAll("[data-calendario-leyenda]").forEach(item => { item.hidden = false; });

// ========================================
// MÁXIMO 3 FILAS VISIBLES + CONTADOR +N
// ========================================

const MAX_FILAS_VISIBLES = 3;

const reservasOcultasPorFecha =
    new Map();


reservasOrdenadas.forEach(reserva => {

    const filaReserva =
        filasReserva.get(
            reserva.claveVisual || reserva.reservaId
        );

    // Filas 0, 1 y 2 se muestran normalmente.
    if (filaReserva < MAX_FILAS_VISIBLES) {
        return;
    }


    const totalNoches =
        Number(reserva.noches) || 0;


    for (
        let indice = 0;
        indice < totalNoches;
        indice++
    ) {

        const fechaNoche =
            sumarDiasCalendario(
                reserva.fechaIngreso,
                indice
            );


        const [
            anioNoche,
            mesNoche
        ] =
            fechaNoche
                .split("-")
                .map(Number);


        // Solo contamos fechas del mes visible.
        if (
            anioNoche !== anioCalendario ||
            mesNoche - 1 !== mesCalendario
        ) {
            continue;
        }


        const cantidad =
            reservasOcultasPorFecha.get(
                fechaNoche
            ) || 0;


        reservasOcultasPorFecha.set(
            fechaNoche,
            cantidad + 1
        );
    }
});

reservasOrdenadas.forEach(reserva => {

    const totalNoches =
        Number(reserva.noches) || 0;

    if (totalNoches < 1) {
        return;
    }

    const filaReserva =
    filasReserva.get(
        reserva.claveVisual || reserva.reservaId
    );

// Las reservas desde la cuarta fila
// quedan representadas por el botón +N.
if (filaReserva >= MAX_FILAS_VISIBLES) {
    return;
}


    // ========================================
    // OBTENER LAS NOCHES VISIBLES DE LA RESERVA
    // ========================================

    const nochesVisibles = [];

    for (
        let indice = 0;
        indice < totalNoches;
        indice++
    ) {

        const fechaNoche =
            sumarDiasCalendario(
                reserva.fechaIngreso,
                indice
            );


        const [
            anioNoche,
            mesNoche,
            diaNoche
        ] =
            fechaNoche
                .split("-")
                .map(Number);


        // Solo dibujamos noches
        // pertenecientes al mes visible
        if (
            anioNoche !== anioCalendario ||
            mesNoche - 1 !== mesCalendario
        ) {
            continue;
        }


        const indiceCelda =
            posicionPrimerDia +
            diaNoche - 1;


        const filaSemana =
            Math.floor(
                indiceCelda / 7
            ) + 1;


        const columna =
            (indiceCelda % 7) + 1;


        nochesVisibles.push({
    fecha: fechaNoche,
    filaSemana,
    columna
});
    }


    if (nochesVisibles.length === 0) {
        return;
    }


    // ========================================
    // DIVIDIR SI LA RESERVA CRUZA DE SEMANA
    // ========================================

    const segmentos = [];

    nochesVisibles.forEach(noche => {

        const ultimo =
            segmentos[
                segmentos.length - 1
            ];

        if (
            ultimo &&
            ultimo.filaSemana ===
            noche.filaSemana &&
            noche.columna ===
            ultimo.columnaFin + 1
        ) {

            ultimo.columnaFin =
                noche.columna;

        } else {

            segmentos.push({

                filaReserva:
                    noche.filaReserva,

                filaSemana:
                    noche.filaSemana,

                columnaInicio:
                    noche.columna,

                columnaFin:
                    noche.columna
            });
        }
    });


    // ========================================
    // CREAR UNA BARRA POR TRAMO SEMANAL
    // ========================================

    segmentos.forEach(
        (segmento, indiceSegmento) => {

            const barra =
                document.createElement(
                    "button"
                );

            barra.type = "button";

            barra.className =
                "calendario-reserva-barra";

            if (reserva.esBloqueo) {
                barra.classList.add(
                    "calendario-bloqueo-barra"
                );
            }

if (reserva.esBloqueo) barra.classList.add('cal-reserva-bloqueada');
if (reserva.esFullDay) barra.dataset.haikuFullday = '1';


            barra.style.gridColumn =
                `${segmento.columnaInicio} / ${segmento.columnaFin + 1}`;

            barra.style.gridRow =
                `${segmento.filaSemana}`;


            barra.style.setProperty(
    "--fila-reserva",
    filaReserva
);


            // La etiqueta mantiene el titular real y la cabaña en cada
            // tramo semanal; un tramo continuado se distingue sin perderlos.
            if (indiceSegmento > 0) {
                const continuacion = document.createElement("span");
                continuacion.className =
                    "sites-calendario-barra-continuacion";
                continuacion.textContent = "↳";
                continuacion.setAttribute("aria-hidden", "true");
                barra.appendChild(continuacion);
            }
            const cabanaBarra = document.createElement("span");
            cabanaBarra.className = "sites-calendario-barra-cabana";
            cabanaBarra.textContent = `CAB ${reserva.numeroCabana}`;
            barra.appendChild(cabanaBarra);
            const titularBarra = document.createElement("span");
            titularBarra.className = "sites-calendario-barra-titular";
            titularBarra.textContent = reserva.titular;
            barra.appendChild(titularBarra);
            barra.setAttribute(
                "aria-label",
                `CAB ${reserva.numeroCabana} · ${reserva.titular}`
            );


            barra.dataset.cabana =
                reserva.numeroCabana;

            barra.dataset.reservaId =
                reserva.reservaId || "";
            barra.dataset.estadiaId = reserva.estadiaId || '';


            barra.addEventListener(
    "click",
    evento => {

        evento.stopPropagation();

        const fechaAnterior =
            fechaSeleccionada;

        // El modal de reserva necesita mirar
        // el día de origen de esta reserva
        fechaSeleccionada =
            reserva.fechaIngreso;

        const botonCabana =
            document.querySelector(
                `[data-ficha-cabana="${reserva.numeroCabana}"]`
            );

        if (botonCabana) {
            botonCabana.click();
        }

        // Volvemos a dejar seleccionada
        // la fecha que el usuario estaba mirando
        fechaSeleccionada =
            fechaAnterior;
    }
);


            capaReservas.appendChild(
    barra
);
        }
    );
});

// ========================================
// PANEL DE RESERVAS DE UN DÍA
// ========================================

function abrirPanelReservasDia(fecha) {

    // Si ya existe uno abierto, lo quitamos.
    const panelAnterior =
        document.querySelector(
            ".calendario-panel-dia"
        );

    if (panelAnterior) {
        panelAnterior.remove();
    }


    // Buscar todas las reservas
    // que ocupan esta fecha.
    const reservasDia =
        reservasOrdenadas
            .filter(reserva => {

                const fechaSalida =
                    sumarDiasCalendario(
                        reserva.fechaIngreso,
                        Number(reserva.noches) || 0
                    );

                return (
                    fecha >= reserva.fechaIngreso &&
                    fecha < fechaSalida
                );
            })
            .sort(
                (a, b) =>
                    Number(a.numeroCabana) -
                    Number(b.numeroCabana)
            );


    const [
        anio,
        mes,
        dia
    ] =
        fecha
            .split("-")
            .map(Number);


    const fechaPanel =
        new Date(
            anio,
            mes - 1,
            dia
        );


    const nombreDia =
        new Intl.DateTimeFormat(
            "es-CL",
            {
                weekday: "short"
            }
        )
            .format(fechaPanel)
            .replace(".", "")
            .toUpperCase();


    const panel =
        document.createElement("div");

    panel.className =
        "calendario-panel-dia sites-calendario-popover";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `Reservas del ${dia} de ${new Intl.DateTimeFormat("es-CL", {month: "long", year: "numeric"}).format(fechaPanel)}`);


    panel.innerHTML = `
        <div class="calendario-panel-cabecera">

            <div class="calendario-panel-fecha">
                <small>${nombreDia}</small>
                <strong>${dia} de ${new Intl.DateTimeFormat("es-CL", {month: "long", year: "numeric"}).format(fechaPanel)}</strong>
            </div>

            <button
                type="button"
                class="calendario-panel-cerrar"
                aria-label="Cerrar"
            >
                ×
            </button>

        </div>

        <div class="calendario-panel-lista"></div>
    `;


    const lista =
        panel.querySelector(
            ".calendario-panel-lista"
        );


    reservasDia.forEach(reserva => {

        const item =
            document.createElement(
                "button"
            );

        item.type = "button";

        item.className =
            "calendario-panel-reserva";

        if (reserva.esBloqueo) {
            item.classList.add(
                "calendario-bloqueo-barra"
            );
        }

if (reserva.esBloqueo) item.classList.add('cal-reserva-bloqueada');
if (reserva.esFullDay) item.dataset.haikuFullday = '1';

        item.textContent =
            `CAB ${reserva.numeroCabana} · ${reserva.titular}`;

        item.dataset.reservaId =
            reserva.reservaId;
        item.dataset.estadiaId = reserva.estadiaId || '';

        item.dataset.cabana =
            reserva.numeroCabana;


        item.addEventListener(
    "click",
    evento => {

        evento.stopPropagation();

        const fechaAnterior =
            fechaSeleccionada;

        // Para abrir la ficha usamos
        // el día que corresponde a este panel
        fechaSeleccionada =
            fecha;

        const botonCabana =
            document.querySelector(
                `[data-ficha-cabana="${reserva.numeroCabana}"]`
            );

        if (botonCabana) {

            // Cerramos el panel +N
            panel.remove();

            // Abrimos la ficha rápida existente
            botonCabana.click();
        }

        // Restauramos la fecha que estaba seleccionada
        fechaSeleccionada =
            fechaAnterior;
    }
);


        lista.appendChild(item);
    });


    panel
        .querySelector(
            ".calendario-panel-cerrar"
        )
        .addEventListener(
            "click",
            evento => {

                evento.stopPropagation();

                panel.remove();
            }
        );


    document.body.appendChild(
        panel
    );
    window.HAIKU_CALENDARIO_ESTADOS_V1?.aplicar();

    // El botón +N detiene la propagación del clic, así que la capa de
    // vínculos no puede depender del listener global para detectar este panel.
    // Refrescamos una sola vez, cuando el panel ya existe en el DOM.
    window.HAIKU_VINCULOS_ESTABLES_V1
        ?.refrescarCalendario?.();
}

// ========================================
// DIBUJAR +N EN CADA DÍA
// ========================================

reservasOcultasPorFecha.forEach(
    (cantidad, fecha) => {

        const [
            anio,
            mes,
            dia
        ] =
            fecha
                .split("-")
                .map(Number);


        const indiceCelda =
            posicionPrimerDia +
            dia - 1;


        const filaSemana =
            Math.floor(
                indiceCelda / 7
            ) + 1;


        const columna =
            (indiceCelda % 7) + 1;


        const botonMas =
            document.createElement(
                "button"
            );


        botonMas.type = "button";

        botonMas.className =
            "calendario-mas-reservas";


        botonMas.textContent =
            `+${cantidad}`;
        botonMas.setAttribute(
            "aria-label",
            `${cantidad} ${cantidad === 1 ? "reserva adicional" : "reservas adicionales"} el ${fecha}`
        );


        botonMas.dataset.fecha =
            fecha;


        botonMas.style.gridColumn =
            `${columna}`;

        botonMas.style.gridRow =
            `${filaSemana}`;


        botonMas.addEventListener(
    "click",
    evento => {

        evento.stopPropagation();

        abrirPanelReservasDia(
            fecha
        );
    }
);


        capaReservas.appendChild(
            botonMas
        );
    }
);

}


// ========================================
// SUMAR DÍAS SIN DEPENDER DE app.js
// ========================================

function sumarDiasCalendario(
    fecha,
    cantidad
) {

    const [
        anio,
        mes,
        dia
    ] =
        fecha
            .split("-")
            .map(Number);


    const resultado =
        new Date(
            anio,
            mes - 1,
            dia
        );


    resultado.setDate(
        resultado.getDate() +
        cantidad
    );


    return [
        resultado.getFullYear(),

        String(
            resultado.getMonth() + 1
        ).padStart(2, "0"),

        String(
            resultado.getDate()
        ).padStart(2, "0")

    ].join("-");
}




// ========================================
// CALENDARIO · MODO BLOQUEO
// PRIMERA ETAPA: SELECCIÓN VISUAL
// ========================================

function formatearFechaBloqueoCalendario(
    fechaISO
) {
    const [anio, mes, dia] =
        fechaISO.split("-").map(Number);

    return new Intl.DateTimeFormat(
        "es-CL",
        {
            day: "numeric",
            month: "short"
        }
    ).format(
        new Date(anio, mes - 1, dia)
    );
}


function calcularNochesBloqueoCalendario(
    fechaInicio,
    fechaFin
) {
    const inicio =
        new Date(`${fechaInicio}T12:00:00`);

    const fin =
        new Date(`${fechaFin}T12:00:00`);

    return Math.round(
        (fin - inicio) / 86400000
    );
}


function cabanaDisponibleParaBloqueo(
    numeroCabana,
    fechaInicio,
    fechaFin
) {
    const datosCalendario =
        JSON.parse(
            localStorage.getItem("haikuDatos") || "{}"
        );

    let disponible = true;

    Object.entries(datosCalendario).some(
        ([fechaRegistro, datosDia]) => {
            const cabana =
                datosDia?.cabanas?.[numeroCabana];

            if (!cabana) return false;

            const estado = String(
                cabana.estado || ""
            ).toLowerCase();

            if (
                estado === "bloqueada" &&
                fechaRegistro >= fechaInicio &&
                fechaRegistro < fechaFin
            ) {
                disponible = false;
                return true;
            }

            if (
                !cabana.reservaId ||
                cabana.continuidadAutomatica === true
            ) {
                return false;
            }

            const noches =
                Number(cabana.noches) || 0;

            if (noches < 1) return false;

            const ingreso =
                cabana.fechaOrigenReserva ||
                cabana.fechaIngresoReserva ||
                fechaRegistro;

            const salida =
                sumarDiasCalendario(
                    ingreso,
                    noches
                );

            const hayCruce =
                ingreso < fechaFin &&
                salida > fechaInicio;

            if (hayCruce) {
                disponible = false;
                return true;
            }

            return false;
        }
    );

    return disponible;
}


function obtenerCabanasDisponiblesBloqueo() {
    return Object.keys(
        catalogoCabanasBloqueo
    ).filter(numeroCabana =>
        cabanaDisponibleParaBloqueo(
            numeroCabana,
            fechaInicioBloqueoCalendario,
            fechaFinBloqueoCalendario
        )
    );
}


function obtenerCheckboxesBloqueo() {
    if (!listaCabanasBloqueo) return [];

    return Array.from(
        listaCabanasBloqueo.querySelectorAll(
            "input[data-bloqueo-cabana]"
        )
    );
}


function actualizarSeleccionCabanasBloqueo() {
    const checkboxes =
        obtenerCheckboxesBloqueo();

    const seleccionadas =
        checkboxes.filter(
            checkbox => checkbox.checked
        );

    if (seleccionarTodasBloqueo) {
        seleccionarTodasBloqueo.checked =
            checkboxes.length > 0 &&
            seleccionadas.length === checkboxes.length;

        seleccionarTodasBloqueo.indeterminate =
            seleccionadas.length > 0 &&
            seleccionadas.length < checkboxes.length;

        seleccionarTodasBloqueo.disabled =
            checkboxes.length === 0;
    }

    if (confirmarBloqueoCalendario) {
        confirmarBloqueoCalendario.disabled =
            seleccionadas.length === 0;

        confirmarBloqueoCalendario.textContent =
            seleccionadas.length > 0
                ? `Bloquear ${seleccionadas.length} ${
                    seleccionadas.length === 1
                        ? "cabaña"
                        : "cabañas"
                }`
                : "Bloquear seleccionadas";
    }

    const mensajePrueba =
        document.getElementById(
            "bloqueo-calendario-prueba"
        );

    if (mensajePrueba) {
        mensajePrueba.hidden = true;
    }
}


function renderizarCabanasDisponiblesBloqueo() {
    if (!listaCabanasBloqueo) return;

    const disponibles =
        obtenerCabanasDisponiblesBloqueo();

    const totalCabanas =
        Object.keys(catalogoCabanasBloqueo).length;

    const noDisponibles =
        totalCabanas - disponibles.length;

    const resumen =
        document.getElementById(
            "bloqueo-disponibilidad-resumen"
        );

    if (resumen) {
        resumen.textContent =
            `${disponibles.length} de ${totalCabanas} disponibles` +
            (
                noDisponibles > 0
                    ? ` · ${noDisponibles} con reserva o bloqueo`
                    : ""
            );
    }

    listaCabanasBloqueo.innerHTML = "";

    if (disponibles.length === 0) {
        const mensaje =
            document.createElement("p");

        mensaje.className =
            "bloqueo-sin-cabanas";

        mensaje.textContent =
            "No hay alojamientos libres durante todo este rango.";

        listaCabanasBloqueo.appendChild(
            mensaje
        );

        actualizarSeleccionCabanasBloqueo();
        return;
    }

    disponibles.forEach(numeroCabana => {
        const opcion =
            document.createElement("label");

        opcion.className =
            "bloqueo-cabana-opcion";

        opcion.innerHTML = `
            <input
                type="checkbox"
                data-bloqueo-cabana="${numeroCabana}"
            >
            <span>
                <strong>
                    CAB ${numeroCabana}
                </strong>
                <small>
                    ${catalogoCabanasBloqueo[numeroCabana]}
                </small>
            </span>
            <em>Disponible</em>
        `;

        const checkbox =
            opcion.querySelector("input");

        checkbox.addEventListener(
            "change",
            actualizarSeleccionCabanasBloqueo
        );

        listaCabanasBloqueo.appendChild(
            opcion
        );
    });

    actualizarSeleccionCabanasBloqueo();
}


function abrirModalSeleccionBloqueoCalendario() {
    if (
        !modalBloqueoCalendario ||
        !fechaInicioBloqueoCalendario ||
        !fechaFinBloqueoCalendario
    ) {
        return;
    }

    const desde =
        document.getElementById(
            "bloqueo-fecha-desde"
        );

    const hasta =
        document.getElementById(
            "bloqueo-fecha-hasta"
        );

    const noches =
        document.getElementById(
            "bloqueo-noches"
        );

    const motivo =
        document.getElementById(
            "bloqueo-motivo"
        );

    if (desde) {
        desde.textContent =
            formatearFechaBloqueoCalendario(
                fechaInicioBloqueoCalendario
            );
    }

    if (hasta) {
        hasta.textContent =
            formatearFechaBloqueoCalendario(
                fechaFinBloqueoCalendario
            );
    }

    if (noches) {
        noches.textContent =
            calcularNochesBloqueoCalendario(
                fechaInicioBloqueoCalendario,
                fechaFinBloqueoCalendario
            );
    }

    if (motivo) motivo.value = "";

    renderizarCabanasDisponiblesBloqueo();

    modalBloqueoCalendario.hidden = false;
    document.body.classList.add(
        "bloqueo-modal-abierto"
    );
}


function cerrarModalSeleccionBloqueoCalendario() {
    if (!modalBloqueoCalendario) return;

    modalBloqueoCalendario.hidden = true;
    document.body.classList.remove(
        "bloqueo-modal-abierto"
    );
}


function crearDiaVacioParaBloqueo() {
    return {
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


function generarIdBloqueoCalendario() {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return `BLQ-${crypto.randomUUID()}`;
    }

    return `BLQ-${Date.now()}-${
        Math.random().toString(36).slice(2, 9)
    }`;
}


function guardarBloqueoSeleccionadoCalendario() {
    const seleccionadas =
        obtenerCheckboxesBloqueo()
            .filter(checkbox => checkbox.checked)
            .map(
                checkbox =>
                    checkbox.dataset.bloqueoCabana
            );

    if (
        seleccionadas.length === 0 ||
        !fechaInicioBloqueoCalendario ||
        !fechaFinBloqueoCalendario
    ) {
        return;
    }

    const dejaronDeEstarDisponibles =
        seleccionadas.filter(numeroCabana =>
            !cabanaDisponibleParaBloqueo(
                numeroCabana,
                fechaInicioBloqueoCalendario,
                fechaFinBloqueoCalendario
            )
        );

    if (dejaronDeEstarDisponibles.length > 0) {
        alert(
            "La disponibilidad cambió antes de guardar. " +
            "Revisaremos nuevamente las cabañas libres."
        );

        renderizarCabanasDisponiblesBloqueo();
        return;
    }

    const noches =
        calcularNochesBloqueoCalendario(
            fechaInicioBloqueoCalendario,
            fechaFinBloqueoCalendario
        );

    const confirmado = confirm(
        `Se bloquearán ${seleccionadas.length} ${
            seleccionadas.length === 1
                ? "cabaña"
                : "cabañas"
        } desde ${formatearFechaBloqueoCalendario(
            fechaInicioBloqueoCalendario
        )} hasta ${formatearFechaBloqueoCalendario(
            fechaFinBloqueoCalendario
        )} (${noches} ${
            noches === 1 ? "noche" : "noches"
        }). ¿Confirmar?`
    );

    if (!confirmado) return;

    const datosCalendario =
        JSON.parse(
            localStorage.getItem("haikuDatos") || "{}"
        );

    const bloqueoId =
        generarIdBloqueoCalendario();

    const motivo =
        document.getElementById(
            "bloqueo-motivo"
        )?.value.trim() || "";

    const creadoEn =
        new Date().toISOString();

    let fecha =
        fechaInicioBloqueoCalendario;

    while (fecha < fechaFinBloqueoCalendario) {
        if (!datosCalendario[fecha]) {
            datosCalendario[fecha] =
                crearDiaVacioParaBloqueo();
        }

        if (!datosCalendario[fecha].cabanas) {
            datosCalendario[fecha].cabanas = {};
        }

        seleccionadas.forEach(numeroCabana => {
            const anterior =
                datosCalendario[fecha]
                    .cabanas[numeroCabana] || {};

            datosCalendario[fecha]
                .cabanas[numeroCabana] = {
                    ...anterior,
                    estado: "bloqueada",
                    bloqueoId,
                    bloqueoAutomatico: true,
                    bloqueoFechaInicio:
                        fechaInicioBloqueoCalendario,
                    bloqueoFechaFin:
                        fechaFinBloqueoCalendario,
                    bloqueoMotivo: motivo,
                    bloqueoCreadoEn: creadoEn,
                    bloqueoEstadoAnterior:
                        anterior.estado || ""
                };
        });

        fecha =
            sumarDiasCalendario(fecha, 1);
    }

    localStorage.setItem(
        "haikuDatos",
        JSON.stringify(datosCalendario)
    );

    if (
        typeof registrarActividadHaiku ===
        "function"
    ) {
        registrarActividadHaiku({
            tipo: "bloqueo",
            accion:
                seleccionadas.length === 1
                    ? "Fechas bloqueadas"
                    : "Fechas bloqueadas en varias cabañas",
            numeroCabana:
                seleccionadas.join(", "),
            fechaOperacion:
                fechaInicioBloqueoCalendario,
            detalle:
                `Desde ${fechaInicioBloqueoCalendario} hasta ${fechaFinBloqueoCalendario} · ${noches} ${
                    noches === 1
                        ? "noche"
                        : "noches"
                }${motivo ? ` · Motivo: ${motivo}` : ""}`
        });
    }

    if (typeof datosPorFecha !== "undefined") {
        datosPorFecha = datosCalendario;
    }

    cambiarModoBloqueoCalendario(false);
    generarCalendario();

    if (
        typeof cargarCabanasDia === "function" &&
        typeof fechaSeleccionada !== "undefined" &&
        fechaSeleccionada
    ) {
        cargarCabanasDia(fechaSeleccionada);
    }

    if (
        typeof actualizarResumenDia === "function" &&
        typeof fechaSeleccionada !== "undefined" &&
        fechaSeleccionada
    ) {
        actualizarResumenDia(fechaSeleccionada);
    }

    if (
        typeof actualizarTarjetasRevision === "function" &&
        typeof fechaSeleccionada !== "undefined" &&
        fechaSeleccionada
    ) {
        actualizarTarjetasRevision(fechaSeleccionada);
    }

    if (
        typeof actualizarResumenAseo === "function" &&
        typeof fechaSeleccionada !== "undefined" &&
        fechaSeleccionada
    ) {
        actualizarResumenAseo(fechaSeleccionada);
    }

    alert(
        `Bloqueo guardado correctamente para ${
            seleccionadas.length
        } ${
            seleccionadas.length === 1
                ? "cabaña"
                : "cabañas"
        }.`
    );
}


function actualizarAyudaBloqueoCalendario() {
    if (!ayudaBloqueoCalendario) return;

    if (!modoBloqueoCalendario) {
        ayudaBloqueoCalendario.hidden = true;
        return;
    }

    ayudaBloqueoCalendario.hidden = false;

    if (!fechaInicioBloqueoCalendario) {
        ayudaBloqueoCalendario.textContent =
            "Selecciona la fecha inicial del bloqueo.";
        return;
    }

    if (!fechaFinBloqueoCalendario) {
        ayudaBloqueoCalendario.textContent =
            `Inicio: ${formatearFechaBloqueoCalendario(
                fechaInicioBloqueoCalendario
            )} · Ahora selecciona la fecha de término.`;
        return;
    }

    const noches =
        calcularNochesBloqueoCalendario(
            fechaInicioBloqueoCalendario,
            fechaFinBloqueoCalendario
        );

    ayudaBloqueoCalendario.textContent =
        `${formatearFechaBloqueoCalendario(
            fechaInicioBloqueoCalendario
        )} → ${formatearFechaBloqueoCalendario(
            fechaFinBloqueoCalendario
        )} · ${noches} ${
            noches === 1 ? "noche" : "noches"
        } · Rango listo para elegir cabañas.`;
}


function pintarRangoBloqueoCalendario() {
    document
        .querySelectorAll(
            "#calendario-grid .dia-calendario[data-fecha]"
        )
        .forEach(elementoDia => {
            const fecha = elementoDia.dataset.fecha;

            elementoDia.classList.remove(
                "bloqueo-inicio",
                "bloqueo-rango",
                "bloqueo-fin"
            );

            if (
                !modoBloqueoCalendario ||
                !fechaInicioBloqueoCalendario
            ) {
                return;
            }

            if (
                fecha === fechaInicioBloqueoCalendario
            ) {
                elementoDia.classList.add(
                    "bloqueo-inicio"
                );
            }

            if (
                fechaFinBloqueoCalendario &&
                fecha >= fechaInicioBloqueoCalendario &&
                fecha < fechaFinBloqueoCalendario
            ) {
                elementoDia.classList.add(
                    "bloqueo-rango"
                );
            }

            if (
                fechaFinBloqueoCalendario &&
                fecha === fechaFinBloqueoCalendario
            ) {
                elementoDia.classList.add(
                    "bloqueo-fin"
                );
            }
        });
}


function seleccionarFechaBloqueoCalendario(
    fechaISO
) {
    if (
        !fechaInicioBloqueoCalendario ||
        fechaFinBloqueoCalendario
    ) {
        fechaInicioBloqueoCalendario = fechaISO;
        fechaFinBloqueoCalendario = "";
    } else if (
        fechaISO <= fechaInicioBloqueoCalendario
    ) {
        fechaInicioBloqueoCalendario = fechaISO;
        fechaFinBloqueoCalendario = "";
    } else {
        fechaFinBloqueoCalendario = fechaISO;
    }

    pintarRangoBloqueoCalendario();
    actualizarAyudaBloqueoCalendario();

    if (fechaFinBloqueoCalendario) {
        abrirModalSeleccionBloqueoCalendario();
    }
}


function cambiarModoBloqueoCalendario(
    activar
) {
    cerrarModalSeleccionBloqueoCalendario();

    modoBloqueoCalendario = Boolean(activar);
    fechaInicioBloqueoCalendario = "";
    fechaFinBloqueoCalendario = "";

    const panelDia = document.querySelector(
        ".calendario-panel-dia"
    );

    if (panelDia) panelDia.remove();

    if (seccionCalendario) {
        seccionCalendario.classList.toggle(
            "modo-bloqueo",
            modoBloqueoCalendario
        );
    }

    if (botonBloqueoCalendario) {
        botonBloqueoCalendario.classList.toggle(
            "activo",
            modoBloqueoCalendario
        );

        botonBloqueoCalendario.setAttribute(
            "aria-pressed",
            String(modoBloqueoCalendario)
        );

        botonBloqueoCalendario.textContent =
            modoBloqueoCalendario
                ? "× Cancelar bloqueo"
                : "Bloquear fechas";
    }

    pintarRangoBloqueoCalendario();
    actualizarAyudaBloqueoCalendario();
}


if (botonBloqueoCalendario) {
    botonBloqueoCalendario.addEventListener(
        "click",
        () => {
            cambiarModoBloqueoCalendario(
                !modoBloqueoCalendario
            );
        }
    );
}


if (seleccionarTodasBloqueo) {
    seleccionarTodasBloqueo.addEventListener(
        "change",
        () => {
            obtenerCheckboxesBloqueo()
                .forEach(checkbox => {
                    checkbox.checked =
                        seleccionarTodasBloqueo.checked;
                });

            actualizarSeleccionCabanasBloqueo();
        }
    );
}


[cerrarBloqueoCalendario,
 cancelarBloqueoCalendario]
    .filter(Boolean)
    .forEach(boton => {
        boton.addEventListener(
            "click",
            cerrarModalSeleccionBloqueoCalendario
        );
    });


if (modalBloqueoCalendario) {
    modalBloqueoCalendario.addEventListener(
        "click",
        evento => {
            if (
                evento.target ===
                modalBloqueoCalendario
            ) {
                cerrarModalSeleccionBloqueoCalendario();
            }
        }
    );
}


if (confirmarBloqueoCalendario) {
    confirmarBloqueoCalendario.addEventListener(
        "click",
        guardarBloqueoSeleccionadoCalendario
    );
}


document.addEventListener("keydown", evento => {
    if (evento.key !== "Escape") return;

    if (
        modalBloqueoCalendario &&
        !modalBloqueoCalendario.hidden
    ) {
        cerrarModalSeleccionBloqueoCalendario();
        return;
    }

    if (modoBloqueoCalendario) {
        cambiarModoBloqueoCalendario(false);
        return;
    }

    document.querySelector(".calendario-panel-dia")?.remove();
});


document
    .querySelectorAll(".menu-item")
    .forEach(botonMenu => {
        botonMenu.addEventListener("click", () => {
            if (
                botonMenu.dataset.seccion !== "calendario" &&
                modoBloqueoCalendario
            ) {
                cambiarModoBloqueoCalendario(false);
            }
        });
    });


// ========================================
// CAMBIAR DE MES
// ========================================

botonAnterior.addEventListener("click", () => {
    document.querySelector(".calendario-panel-dia")?.remove();
    fechaCalendario = new Date(
        fechaCalendario.getFullYear(),
        fechaCalendario.getMonth() - 1,
        1
    );
    if (esCalendarioMovil()) {
        fechaCalendarioSeleccionadaMovil =
            `${fechaCalendario.getFullYear()}-${String(fechaCalendario.getMonth() + 1).padStart(2, "0")}-01`;
    }
    generarCalendario();
});


botonSiguiente.addEventListener("click", () => {
    document.querySelector(".calendario-panel-dia")?.remove();
    fechaCalendario = new Date(
        fechaCalendario.getFullYear(),
        fechaCalendario.getMonth() + 1,
        1
    );
    if (esCalendarioMovil()) {
        fechaCalendarioSeleccionadaMovil =
            `${fechaCalendario.getFullYear()}-${String(fechaCalendario.getMonth() + 1).padStart(2, "0")}-01`;
    }
    generarCalendario();
});

if (botonHoyCalendario) {
    botonHoyCalendario.addEventListener("click", () => {
        document.querySelector(".calendario-panel-dia")?.remove();
        fechaCalendario = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        if (esCalendarioMovil()) {
            fechaCalendarioSeleccionadaMovil =
                `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
        }
        generarCalendario();
    });
}


// Generar calendario al cargar
generarCalendario();
window.matchMedia?.("(max-width: 780px)").addEventListener?.("change", () => generarCalendario());

// ========================================
// ACTUALIZAR CALENDARIO AL ABRIR LA SECCIÓN
// ========================================

const botonMenuCalendario =
    document.querySelector(
        '.menu-item[data-seccion="calendario"]'
    );

if (botonMenuCalendario) {

    botonMenuCalendario.addEventListener(
        "click",
        () => {

            generarCalendario();

        }
    );
}

// ========================================
// SELECCIONAR DÍA OPERATIVO
// ========================================

const fechaHoy =
`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;

// ========================================
// FECHA OPERATIVA AL INICIAR
// ========================================

// Al abrir Haiku, siempre comenzamos en el día actual.
// Los días anteriores siguen guardados y pueden
// consultarse manualmente desde el calendario.

let fechaSeleccionada = fechaHoy;

localStorage.setItem(
    "haikuFechaSeleccionada",
    fechaSeleccionada
);

function seleccionarDia(año, mes, dia, fechaISO) {

    fechaSeleccionada = fechaISO;

    localStorage.setItem(
        "haikuFechaSeleccionada",
        fechaSeleccionada
    );

    cargarDatosDia(fechaSeleccionada);
cargarCabanasDia(fechaSeleccionada);

if (typeof renderizarAgendaServicios === "function") {
    renderizarAgendaServicios();
}

// Actualizar pagos del día seleccionado
if (typeof cargarAbonosPagos === "function") {
    cargarAbonosPagos();
}

// Cargar cierre correspondiente al día seleccionado
if (typeof cargarCierreDia === "function") {
    cargarCierreDia(fechaSeleccionada);
}

if (typeof actualizarCierreTurno === "function") {
    actualizarCierreTurno();
}

    const fechaElegida = new Date(
        año,
        mes,
        dia
    );

    // Formatear fecha
    let textoFecha = new Intl.DateTimeFormat("es-CL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    }).format(fechaElegida);

    textoFecha =
        textoFecha.charAt(0).toUpperCase() +
        textoFecha.slice(1);


    // Cambiar fecha del Resumen
    fechaActual.textContent = textoFecha;


    // Quitar selección anterior
    document
        .querySelectorAll(".dia-calendario.seleccionado")
        .forEach(elemento => {
            elemento.classList.remove("seleccionado");
        });


    // Marcar día seleccionado
    const diaSeleccionado = document.querySelector(
        `.dia-calendario[data-fecha="${fechaISO}"]`
    );

    if (diaSeleccionado) {
        diaSeleccionado.classList.add("seleccionado");
    }


    // Abrir Resumen
    document
        .querySelectorAll(".seccion-app")
        .forEach(seccion => {
            seccion.classList.remove("activa");
        });

    document
        .getElementById("seccion-resumen")
        .classList.add("activa");


    // Cambiar botón activo
    document
        .querySelectorAll(".menu-item")
        .forEach(boton => {
            boton.classList.remove("activo");
        });

    const botonResumen = document.querySelector(
        '.menu-item[data-seccion="resumen"]'
    );

    botonResumen.classList.add("activo");

}
