// ========================================
// GESTIÓN DE CABAÑAS
// ========================================

const filasCabanas = document.querySelectorAll("[data-cabana]");


// ========================================
// GUARDAR CAMPO DE CABAÑA
// ========================================

function guardarCampoCabana(elemento) {

    const fila = elemento.closest("[data-cabana]");

    if (!fila) {
        return;
    }

    const numeroCabana = fila.dataset.cabana;
    const campo = elemento.dataset.campo;

    if (!fechaSeleccionada) {
        return;
    }

    const datos = obtenerDatosDia(fechaSeleccionada);


    // Crear cabaña si todavía no existe

    if (!datos.cabanas[numeroCabana]) {
        datos.cabanas[numeroCabana] = {};
    }

    const valorAnterior =
        datos.cabanas[numeroCabana][campo];


    // Checkbox usa true / false
    // Los demás usan su valor normal

    const valor =
        elemento.type === "checkbox"
            ? elemento.checked
            : elemento.value;


datos.cabanas[numeroCabana][campo] = valor;

// Recordar si el CHECK-IN fue marcado manualmente
if (campo === "checkinRealizado") {
    datos.cabanas[numeroCabana].checkinManual = valor;
}

let reservaIdCheckoutHistorial = "";

// Recordar el CHECK-OUT en la reserva que SALE este día
if (campo === "checkout") {

    let reservaIdCheckout = "";

Object.entries(datosPorFecha).forEach(([fechaDia, dia]) => {

    if (!dia?.cabanas) return;

    const cabanaDia = dia.cabanas[numeroCabana];

    if (!cabanaDia?.reservaId) return;

    const fechaIngreso =
        cabanaDia.fechaOrigenReserva ||
        cabanaDia.fechaIngresoReserva ||
        fechaDia;

    const noches =
        Number(cabanaDia.noches) || 0;

    const fechaSalida =
        calcularSalidaReserva(fechaIngreso, noches);

    if (fechaSalida === fechaSeleccionada) {
        reservaIdCheckout = cabanaDia.reservaId;
    }
});

    if (reservaIdCheckout) {

        reservaIdCheckoutHistorial =
            reservaIdCheckout;

        const fichas = obtenerFichasReservas();

        if (!fichas[reservaIdCheckout]) {
            fichas[reservaIdCheckout] = {};
        }

        fichas[reservaIdCheckout].checkoutRealizado = Boolean(valor);

        guardarFichasReservas(fichas);
    }
}

// CONTINÚA solo hereda CHECK-IN si esta reserva
// tuvo un check-in marcado manualmente
if (
    campo === "estado" &&
    valor === "continua"
) {

    const reservaId =
        datos.cabanas[numeroCabana].reservaId;

    const tieneCheckinManual =
        reservaTieneCheckinManual(reservaId);

    datos.cabanas[numeroCabana].checkinRealizado =
        tieneCheckinManual;

    const checkin =
        fila.querySelector(
            '[data-campo="checkinRealizado"]'
        );

    if (checkin) {
        checkin.checked = tieneCheckinManual;
    }
}

// Sincronizar ocupación en todos los días de la misma reserva
const reservaIdActual = datos.cabanas[numeroCabana].reservaId;

if (
    reservaIdActual &&
    ["adultos", "ninos", "mascotas"].includes(campo)
) {
    sincronizarDatosReserva(
        reservaIdActual,
        numeroCabana,
        campo,
        valor
    );
}

// Si una continuidad automática recibe un nuevo titular manualmente,
// pasa a ser una reserva independiente
if (
    campo === "titular" &&
    datos.cabanas[numeroCabana].continuidadAutomatica === true
) {
    datos.cabanas[numeroCabana].reservaId =
        generarReservaId(fechaSeleccionada, numeroCabana);

    datos.cabanas[numeroCabana].continuidadAutomatica = false;
    datos.cabanas[numeroCabana].fechaOrigenReserva = fechaSeleccionada;
}

// Marcar que este día/cabaña fue editado manualmente
datos.cabanas[numeroCabana].editadoManual = true;

// ========================================
// SINCRONIZAR ESTADO FINAL -> REVISIÓN
// ========================================

if (campo === "estadoFinal") {

    let estadoRevision = "pendiente";

    if (valor === "LISTA") {
        estadoRevision = "lista";
    }

    else if (valor === "CON DETALLES") {
        estadoRevision = "con-detalles";
    }

    datos.cabanas[numeroCabana].estadoRevision =
        estadoRevision;
}

guardarDatos();

if (
    typeof registrarActividadHaiku === "function" &&
    ["estado", "checkinRealizado", "checkout"]
        .includes(campo) &&
    String(valorAnterior) !== String(valor)
) {
    const cabanaHistorial =
        datos.cabanas[numeroCabana];

    const reservaIdHistorial =
        campo === "checkout"
            ? reservaIdCheckoutHistorial
            : cabanaHistorial.reservaId || "";

    const registroReservaHistorial =
        reservaIdHistorial &&
        typeof buscarDatosReservaPorId ===
            "function"
            ? buscarDatosReservaPorId(
                reservaIdHistorial
            )
            : null;

    const acciones = {
        estado: "Estado operativo modificado",
        checkinRealizado:
            valor
                ? "Check-in registrado"
                : "Check-in anulado",
        checkout:
            valor
                ? "Checked Out registrado"
                : "Checked Out anulado"
    };

    registrarActividadHaiku({
        tipo:
            campo === "estado"
                ? "cabana"
                : "estado",
        accion: acciones[campo],
        reservaId: reservaIdHistorial,
        numeroCabana,
        titular:
            registroReservaHistorial?.cabana
                ?.titular ||
            cabanaHistorial.titular ||
            "",
        fechaOperacion: fechaSeleccionada,
        cambios: [
            {
                campo:
                    campo === "estado"
                        ? "Estado"
                        : campo === "checkout"
                            ? "Checked Out"
                            : "Check-in",
                anterior: valorAnterior,
                nuevo: valor
            }
        ]
    });
}

if (typeof generarCalendario === "function") {
    generarCalendario();
}

actualizarResumenDia(fechaSeleccionada);
actualizarTarjetasRevision(fechaSeleccionada);
actualizarResumenAseo(fechaSeleccionada);
generarResumenOperativo(fechaSeleccionada);
}

// ============================================
// COLOR OPERATIVO DE CADA CABAÑA
// ============================================

function reservaTieneCheckinManual(reservaId) {

    if (!reservaId) {
        return false;
    }

    return Object.values(datosPorFecha).some(dia => {

        if (!dia.cabanas) {
            return false;
        }

        return Object.values(dia.cabanas).some(cabana =>

            String(cabana?.reservaId || "") ===
            String(reservaId) &&

            cabana.checkinManual === true

        );

    });
}

function obtenerEstadoIngresoReserva(reservaId) {

    if (!reservaId) {
        return "";
    }

    for (const dia of Object.values(datosPorFecha)) {

        if (!dia?.cabanas) {
            continue;
        }

        for (const cabana of Object.values(dia.cabanas)) {

            if (
                String(cabana?.reservaId || "") !==
                String(reservaId)
            ) {
                continue;
            }

            if (
                cabana.estado === "libre-ingresa" ||
                cabana.estado === "sale-ingresa"
            ) {
                return cabana.estado;
            }
        }
    }

    return "";
}

function actualizarColorCabana(fila) {

    if (!fila || !fechaSeleccionada) {
        return;
    }

    const numeroCabana = fila.dataset.cabana;
    const datos = obtenerDatosDia(fechaSeleccionada);

    const datosCabana =
        datos.cabanas[numeroCabana] || {};

    // Limpiar estados anteriores
    fila.classList.remove(
    "cabana-checkout",
    "cabana-checkin",
    "cabana-libre",
    "cabana-ingresa",
    "cabana-bloqueada"
);

    // PRIORIDAD 1: CHECK-IN REALIZADO → VERDE
    if (datosCabana.checkinRealizado === true) {
        fila.classList.add("cabana-checkin");
        return;
    }

    // PRIORIDAD 2: CHECK-OUT REALIZADO → AZUL
    if (datosCabana.checkout && datosCabana.reservaId) {
        fila.classList.add("cabana-checkout");
        return;
    }

    // PRIORIDAD 3: BLOQUEADA → ROJO
if (datosCabana.estado === "bloqueada") {
    fila.classList.add("cabana-bloqueada");
    return;
}

    // PRIORIDAD 4: ESTADOS CON INGRESO → GRIS MÁS OSCURO
if (
    datosCabana.estado === "libre-ingresa" ||
    datosCabana.estado === "sale-ingresa"
) {
    fila.classList.add("cabana-ingresa");
    return;
}

// CONTINÚA sin CHECK-IN:
// busca cómo comenzó realmente esta reserva
if (
    datosCabana.estado === "continua" &&
    datosCabana.checkinRealizado !== true
) {

    const estadoIngreso =
        obtenerEstadoIngresoReserva(
            datosCabana.reservaId
        );

    console.log(
    "DEBUG CONT",
    {
        reservaId: datosCabana.reservaId,
        estadoActual: datosCabana.estado,
        estadoIngreso
    }
);

    if (
        estadoIngreso === "libre-ingresa" ||
        estadoIngreso === "sale-ingresa"
    ) {
        fila.classList.add("cabana-ingresa");
        return;
    }
}

// PRIORIDAD 5: RESTO DE ESTADOS OPERATIVOS → GRIS CLARO
if (
    datosCabana.estado === "libre-libre" ||
    datosCabana.estado === "sale-libre" ||
    datosCabana.estado === "continua" ||
    datosCabana.estado === "fullday"
) {
    fila.classList.add("cabana-libre");
}

}

// ========================================
// ESCUCHAR CAMBIOS
// ========================================

filasCabanas.forEach(fila => {

    const campos = fila.querySelectorAll(".campo-cabana");

    campos.forEach(campo => {

    campo.addEventListener("input", () => {
        guardarCampoCabana(campo);
        actualizarColorCabana(fila);
    });

    campo.addEventListener("change", () => {
        guardarCampoCabana(campo);
        actualizarColorCabana(fila);
    });

});

});

// ========================================
// CARGAR CABAÑAS DEL DÍA
// ========================================

function cargarCabanasDia(fecha) {

    const datos = obtenerDatosDia(fecha);

    filasCabanas.forEach(fila => {

        const numeroCabana = fila.dataset.cabana;

        const datosCabana =
            datos.cabanas[numeroCabana] || {};

        const contenedorOcupacion =
    fila.querySelector(
        ".ocupacion-cabana"
    );


actualizarTextoOcupacionResumen(
    contenedorOcupacion,
    datosCabana
);

// CONTINÚA solo aparece con CHECK-IN si
// esta misma reserva tuvo IN manual
if (datosCabana.estado === "continua") {

    const tieneCheckinManual =
        reservaTieneCheckinManual(
            datosCabana.reservaId
        );

    datosCabana.checkinRealizado =
        tieneCheckinManual;
}

    // ========================================
    // SERVICIOS DEL DÍA POR CABAÑA
    // ========================================

    const serviciosRegistradosCabana = JSON.parse(
    localStorage.getItem("haikuServicios")
    ) || [];

    const serviciosCabanaDia =
    serviciosRegistradosCabana.filter(servicio =>
        servicio.fechaServicio === fecha &&
        String(servicio.numeroCabana) === String(numeroCabana)
    );

    const campoServicio =
    fila.querySelector('[data-campo="servicio"]');

    if (campoServicio) {

    campoServicio.value = serviciosCabanaDia
        .map(servicio => {

            const hora = servicio.hora
                ? `${servicio.hora} `
                : "";

            const cortesia =
                servicio.cortesia ||
                servicio.tipoCobro === "cortesia"
                    ? " 🎁"
                    : "";

            return `${hora}${servicio.nombre}${cortesia}`;

        })
        .join(" · ");
}

        const titularCabana = fila.querySelector(
    `[data-titular-cabana="${numeroCabana}"]`
);

if (titularCabana) {
    titularCabana.textContent =
        datosCabana.titular && datosCabana.titular.trim() !== ""
            ? datosCabana.titular
            : "Sin titular";
}

const valorNoches = fila.querySelector(
    `[data-valor-noches="${numeroCabana}"]`
);

if (valorNoches) {
    valorNoches.textContent = datosCabana.noches || "";
    const contenedorNoches = valorNoches.closest(".cabana-noches");
    if (contenedorNoches) {
        contenedorNoches.hidden = !String(datosCabana.noches ?? "").trim();
    }
}

        const campos =
            fila.querySelectorAll(".campo-cabana");


        campos.forEach(campo => {

            const nombreCampo = campo.dataset.campo;

            if (nombreCampo === "servicio") {
            return;
            }
            const valor = datosCabana[nombreCampo];


            if (campo.type === "checkbox") {

                campo.checked = valor === true;

            } else {

                campo.value = valor || "";

            }

        });

            actualizarColorCabana(fila);

    });

    actualizarResumenDia(fecha);
    actualizarTarjetasRevision(fecha);
    actualizarResumenAseo(fecha);
    generarResumenOperativo(fecha);

}

cargarCabanasDia(fechaSeleccionada);

// ========================================
// ACTUALIZAR TARJETAS DEL RESUMEN
// ========================================

function actualizarResumenDia(fecha) {

    if (!fecha) {
        return;
    }

    const datos = obtenerDatosDia(fecha);

    let ingresan = 0;
    let salen = 0;
    let continuan = 0;
    let servicios = 0;
    let pagosPendientes = 0;

    Object.values(datos.cabanas).forEach(cabana => {

        const estado = cabana.estado || "";

        // INGRESAN
if (
    estado === "libre-ingresa" ||
    estado === "sale-ingresa" ||
    estado === "fullday"
) {
    ingresan++;
}

        // SALEN
if (
    estado === "sale-libre" ||
    estado === "sale-ingresa" ||
    estado === "fullday"
) {
    salen++;
}

        // CONTINÚAN
        if (estado === "continua") {
            continuan++;
        }


    });

    // ========================================
    // SERVICIOS DEL DÍA
    // Lee directamente el módulo Servicios
    // ========================================

    const serviciosRegistradosResumen = JSON.parse(
    localStorage.getItem("haikuServicios")
    ) || [];

    servicios = serviciosRegistradosResumen.filter(servicio =>
    servicio.fechaServicio === fecha
    ).length;

    if (
        typeof obtenerPagosPendientes ===
            "function"
    ) {
        pagosPendientes =
            obtenerPagosPendientes(fecha).length;
    }

    document.getElementById("contador-ingresan").textContent =
        ingresan;

    document.getElementById("contador-salen").textContent =
        salen;

    document.getElementById("contador-continuan").textContent =
        continuan;

    document.getElementById("contador-servicios").textContent =
        servicios;

    const contadorPagos =
        document.getElementById(
            "contador-pagos"
        );

    if (contadorPagos) {
        contadorPagos.textContent =
            pagosPendientes;
    }
}

// ====================================
// RESUMEN OPERATIVO DEL DÍA
// ====================================

function generarResumenOperativo(fecha) {

    if (!fecha) {
        return;
    }

    const datos = obtenerDatosDia(fecha);

    const ingresan = [];
    const salen = [];
    const continuan = [];

    Object.entries(datos.cabanas).forEach(([numeroCabana, cabana]) => {

    const estado = cabana.estado || "";

    if (
    estado === "libre-ingresa" ||
    estado === "sale-ingresa" ||
    estado === "fullday"
) {
    ingresan.push(numeroCabana);
}

if (
    estado === "sale-libre" ||
    estado === "sale-ingresa" ||
    estado === "fullday"
) {
    salen.push(numeroCabana);
}

    if (estado === "continua") {
        continuan.push(numeroCabana);
    }

});

const lineas = [];

const [anio, mes, dia] = fecha.split("-");

const fechaResumen =
    `${dia}.${mes}.${anio.slice(-2)}`;

lineas.push(`RESUMEN DEL DÍA ${fechaResumen}`);

if (ingresan.length > 0) {
    lineas.push("");
    lineas.push("INGRESAN");
    ingresan.forEach(numeroCabana => {

    const cabana = datos.cabanas[numeroCabana] || {};

    const adultos = Number(cabana.adultos) || 0;
    const ninos = Number(cabana.ninos) || 0;
    const mascotas = Number(cabana.mascotas) || 0;

    let detalles = [];

    if (adultos > 0) {
        detalles.push(`${adultos} ADL`);
    }

    if (ninos > 0) {
        detalles.push(`${ninos} KID`);
    }

    if (mascotas > 0) {
        detalles.push(`${mascotas} PET`);
    }

    const esFullDay = cabana.estado === "fullday";
const etiquetaFullDay = esFullDay ? " (FullDay)" : "";

if (detalles.length > 0) {
    lineas.push(`CAB ${numeroCabana} × ${detalles.join(" + ")}${etiquetaFullDay}`);
} else {
    lineas.push(`CAB ${numeroCabana}${etiquetaFullDay}`);
}

});
}

if (salen.length > 0) {
    lineas.push("");
    lineas.push("SALEN");
    salen.forEach(numeroCabana => {
        lineas.push(`CAB ${numeroCabana}`);
    });
}

if (continuan.length > 0) {
    lineas.push("");
    lineas.push("CONTINÚAN");
    continuan.forEach(numeroCabana => {
        lineas.push(`CAB ${numeroCabana}`);
    });
}

// ========================================
// SERVICIOS DEL DÍA
// ========================================

const serviciosRegistradosResumen = JSON.parse(
    localStorage.getItem("haikuServicios")
) || [];

const serviciosDelDia = serviciosRegistradosResumen
    .filter(servicio =>
        servicio.fechaServicio === fecha
    )
    .sort((a, b) =>
        (a.hora || "").localeCompare(b.hora || "")
    );

if (serviciosDelDia.length > 0) {

    lineas.push("");
    lineas.push("SERVICIOS");

    serviciosDelDia.forEach(servicio => {

        const cabana =
            servicio.numeroCabana
                ? `CAB ${servicio.numeroCabana}`
                : "";

        const hora =
            servicio.hora
                ? `${servicio.hora}`
                : "";

        const nombre =
            servicio.nombre || "Servicio";

        const cortesia =
            servicio.cortesia ||
            servicio.tipoCobro === "cortesia"
                ? " 🎁 CORTESÍA"
                : "";

        lineas.push(
            `${cabana} · ${hora} · ${nombre}${cortesia}`
        );
    });
}

// NOTAS DE CABAÑAS
if (
    Array.isArray(datos.notasOperativas) &&
    datos.notasOperativas.length > 0
) {
    lineas.push("");
    lineas.push("NOTAS");

    datos.notasOperativas.forEach(nota => {
        const numeroCabana = nota.cabana;
        const textoNota = nota.texto || nota.nota || "";

        if (textoNota.trim() !== "") {
            lineas.push(`CAB ${numeroCabana} — ${textoNota.trim()}`);
        }
    });
}

// HORARIOS DE INGRESO
const horariosIngreso = [];

Object.entries(datos.cabanas).forEach(([numeroCabana, cabana]) => {
    const horaIngreso = cabana.ingreso || "";

    if (horaIngreso.trim() !== "") {
        horariosIngreso.push({
            cabana: numeroCabana,
            hora: horaIngreso.trim()
        });
    }
});

// Ordenar desde el ingreso más temprano al más tarde
horariosIngreso.sort((a, b) => {
    return a.hora.localeCompare(b.hora);
});

if (horariosIngreso.length > 0) {
    lineas.push("");
    lineas.push("INGRESO");

    horariosIngreso.forEach(item => {
        lineas.push(`CAB ${item.cabana} — ${item.hora}`);
    });
}

// NOTAS IMPORTANTES
const notas = document.getElementById("notas-dia");

if (notas && notas.value.trim() !== "") {
    lineas.push("");
    lineas.push("IMPORTANTE:");
    lineas.push(notas.value.trim());
}

const resumenTexto = document.getElementById("resumen-dia-texto");

if (resumenTexto) {
    resumenTexto.textContent = lineas.join("\n");
}

    console.log("CABANAS RESUMEN:", datos.cabanas);
}

// ========================================
// TARJETAS DE REVISIÓN DE CABAÑAS
// ========================================

function actualizarTarjetasRevision(fecha) {

    if (!fecha) {
        return;
    }

    const datos = obtenerDatosDia(fecha);

    const tarjetas =
        document.querySelectorAll(".cabana-revision");

    tarjetas.forEach(tarjeta => {

        const numeroCabana =
            tarjeta.dataset.revisionCabana;

        const datosCabana =
            datos.cabanas[numeroCabana] || {};

        // -------------------------
// TITULAR DE LA RESERVA
// -------------------------

const titularCabana = tarjeta.querySelector(
    `[data-titular-cabana="${numeroCabana}"]`
);

if (titularCabana) {
    titularCabana.textContent =
        datosCabana.titular && datosCabana.titular.trim() !== ""
            ? datosCabana.titular
            : "Sin titular";
} 


        // ----------------------------
        // HUÉSPEDES
        // ----------------------------

        const huespedes =
            tarjeta.querySelector(".cabana-huespedes");

        if (huespedes) {

            const partes = [];

            if (datosCabana.adultos) {
                partes.push(`${datosCabana.adultos} ADL`);
            }

            if (datosCabana.ninos) {
                partes.push(`${datosCabana.ninos} KID`);
            }

            if (datosCabana.mascotas) {
                partes.push(`${datosCabana.mascotas} PET`);
            }

            huespedes.textContent =
                partes.length > 0
                    ? partes.join(" · ")
                    : "Sin huéspedes registrados";
        }

// -------------------------
// ESTADO OPERATIVO
// -------------------------

const estadoOperativo =
    tarjeta.querySelector(".cabana-estado-operativo");

if (estadoOperativo) {

    const nombresEstadoOperativo = {
        "libre-libre": "L/L",
        "libre-ingresa": "L/IN",
        "sale-libre": "S/L",
        "sale-ingresa": "S/IN",
        "continua": "CONT",
        "bloqueada": "BLQ",
        "fullday": "F/D"
    };

    estadoOperativo.textContent =
        nombresEstadoOperativo[datosCabana.estado] || "";
}

        // -------------------------
// ESTADO DE REVISIÓN
// -------------------------

const estado =
    tarjeta.querySelector(".cabana-estado");

if (estado) {

    const nombresEstadoRevision = {
        "pendiente": "PENDIENTE",
        "con-detalles": "C/DETALLE",
        "lista": "LISTA"
    };

    const estadoRevision =
        datosCabana.estadoRevision || "pendiente";

    estado.textContent =
        nombresEstadoRevision[estadoRevision] || "PENDIENTE";

    estado.dataset.estado = estadoRevision;

    // Color de la tarjeta según estado de revisión
tarjeta.classList.remove(
    "revision-pendiente",
    "revision-con-detalles",
    "revision-lista"
);

tarjeta.classList.add(`revision-${estadoRevision}`);

}

// ---------------------------
// CHECK IN
// ---------------------------

const checkin =
    tarjeta.querySelector(".cabana-in");

if (checkin) {
    checkin.textContent =
        datosCabana.ingreso
            ? `IN ${datosCabana.ingreso}`
            : "";
}


        // ----------------------------
        // CHECK OUT
        // ----------------------------

        const checkout =
            tarjeta.querySelector(".cabana-out");

        if (checkout) {
            checkout.textContent =
                datosCabana.checkout
                    ? `OUT ${datosCabana.checkout}`
                    : "";
        }


        // ----------------------------
        // ASEO
        // ----------------------------

        const aseo =
            tarjeta.querySelector(".cabana-aseo");

        if (aseo) {
            aseo.textContent =
                datosCabana.aseo || "";
        }

        // -------------------------
// NOTA OPERATIVA
// -------------------------

const notaOperativa =
    tarjeta.querySelector(".cabana-nota-operativa");

if (notaOperativa) {

    const notasCabana = datos.notasOperativas.filter(
    nota => String(nota.cabana) === String(numeroCabana)
);

notaOperativa.textContent = notasCabana.length
    ? notasCabana.map(nota => nota.texto).join(" · ")
    : "";
}

    });
}



// ========================================
// ABRIR REVISIÓN INDIVIDUAL
// ========================================

const listaRevisionCabanas =
    document.querySelector(".lista-revision-cabanas");

const revisionIndividual =
    document.getElementById("revision-individual");

const botonVolverCabanas =
    document.getElementById("volver-cabanas");

const revisionTitulo =
    document.getElementById("revision-titulo");

const revisionFecha =
    document.getElementById("revision-fecha");

const revisionSolicitudAseo =
    document.getElementById("revision-solicitud-aseo");    

const revisionInfoOperativa =
    document.getElementById("revision-info-operativa");

const revisionEstado =
    document.getElementById("revision-estado");

const revisionDetalles =
    document.getElementById("revision-detalles");

const revisionNotaOperativa =
    document.getElementById("revision-nota-operativa");

document
    .querySelectorAll(".cabana-revision")
    .forEach(boton => {

        boton.addEventListener("click", () => {

            const numeroCabana =
                boton.dataset.revisionCabana;

            abrirRevisionCabana(numeroCabana);

        });

    });


function abrirRevisionCabana(numeroCabana) {

    // ========================================
    // RECORDAR REVISIÓN ABIERTA
    // ========================================

    localStorage.setItem(
    "haikuRevisionCabana",
    numeroCabana
    );

    if (!fechaSeleccionada) {
        return;
    }

    const datos =
        obtenerDatosDia(fechaSeleccionada);

    const datosCabana =
        datos.cabanas[numeroCabana] || {};

    const solicitudAseo =
    datosCabana.solicitudAseoExpress || "";

if (revisionSolicitudAseo) {

    if (solicitudAseo) {
        revisionSolicitudAseo.textContent = `📌 ${solicitudAseo}`;
        revisionSolicitudAseo.style.display = "";
    } else {
        revisionSolicitudAseo.textContent = "";
        revisionSolicitudAseo.style.display = "none";
    }

}    

    revisionEstado.value =
        datosCabana.estadoRevision || "pendiente";

    revisionDetalles.value =
    datosCabana.detallesRevision || "";

    // ========================================
    // NOTA OPERATIVA DE LA CABAÑA
    // ========================================

const notasCabana =
    (datos.notasOperativas || []).filter(nota => {
        return String(nota.cabana) === String(numeroCabana);
    });

if (notasCabana.length > 0) {

    revisionNotaOperativa.innerHTML = `
        <strong>📝 Nota operativa</strong>
        <span>
            ${notasCabana.map(nota => nota.texto).join(" · ")}
        </span>
    `;

    revisionNotaOperativa.style.display = "";

} else {

    revisionNotaOperativa.innerHTML = "";
    revisionNotaOperativa.style.display = "none";
}


    // Título

    revisionTitulo.textContent =
        `CAB ${numeroCabana}`;

    // ========================================
    // FECHA DE LA REVISIÓN
    // ========================================

    const fechaRevision =
        new Date(`${fechaSeleccionada}T12:00:00`);

    revisionFecha.textContent =
        fechaRevision.toLocaleDateString(
        "es-CL",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    );


    // Ocupación

    const adultos =
        Number(datosCabana.adultos) || 0;

    const ninos =
        Number(datosCabana.ninos) || 0;

    const mascotas =
        Number(datosCabana.mascotas) || 0;


    const ocupacion = [];

    if (adultos > 0) {
        ocupacion.push(`${adultos} ADL`);
    }

    if (ninos > 0) {
        ocupacion.push(`${ninos} KID`);
    }

    if (mascotas > 0) {
        ocupacion.push(`${mascotas} PET`);
    }


    // Estado

    const nombresEstado = {
        "libre-libre": "LIBRE / LIBRE",
        "libre-ingresa": "LIBRE / INGRESA",
        "sale-libre": "SALE / LIBRE",
        "sale-ingresa": "SALE / INGRESA",
        "continua": "CONTINÚA",
        "bloqueada": "BLOQUEADA"
    };


    const info = [];

    if (ocupacion.length > 0) {
        info.push(ocupacion.join(" · "));
    }

    if (datosCabana.estado) {

        info.push(
            nombresEstado[datosCabana.estado] ||
            datosCabana.estado
        );

    }

    if (datosCabana.checkout) {
        info.push(`OUT ${datosCabana.checkout}`);
    }

    if (datosCabana.aseo) {
        info.push(`🧹 ${datosCabana.aseo}`);
    }


    revisionInfoOperativa.textContent =
        info.join("   ·   ");

    // Mostrar checklist correspondiente

    mostrarChecklistCabana(numeroCabana);    

    // Ocultar listado

    listaRevisionCabanas.style.display =
        "none";


    // Mostrar revisión

    revisionIndividual.classList.add(
        "activa"
    );

}

// ========================================
// GUARDAR ESTADO DE REVISIÓN
// ========================================

revisionDetalles.addEventListener("input", () => {

    if (!fechaSeleccionada) {
        return;
    }

    const numeroCabana =
        localStorage.getItem("haikuRevisionCabana");

    if (!numeroCabana) {
        return;
    }

    const datos =
        obtenerDatosDia(fechaSeleccionada);

    if (!datos.cabanas[numeroCabana]) {
        datos.cabanas[numeroCabana] = {};
    }

    datos.cabanas[numeroCabana].detallesRevision =
        revisionDetalles.value;

    guardarDatos();
});

revisionEstado.addEventListener("change", () => {

    if (!fechaSeleccionada) {
        return;
    }

    const numeroCabana =
        localStorage.getItem("haikuRevisionCabana");

    if (!numeroCabana) {
        return;
    }

    const datos =
        obtenerDatosDia(fechaSeleccionada);

    if (!datos.cabanas[numeroCabana]) {
        datos.cabanas[numeroCabana] = {};
    }

    datos.cabanas[numeroCabana].estadoRevision =
    revisionEstado.value;

    guardarDatos();

// Sincronizar ESTADO DE REVISIÓN -> ESTADO FINAL del resumen
const filaCabana = document.querySelector(
    `tr[data-cabana="${numeroCabana}"]`
);

if (filaCabana) {

    const selectorResumen = filaCabana.querySelector(
        '[data-campo="estadoFinal"]'
    );

    if (selectorResumen) {

        if (revisionEstado.value === "lista") {
            selectorResumen.value = "LISTA";
        }

        else if (revisionEstado.value === "con-detalles") {
            selectorResumen.value = "CON DETALLES";
        }

        else {
            selectorResumen.value = "";
        }

        // Guardar también estadoFinal
        datos.cabanas[numeroCabana].estadoFinal =
            selectorResumen.value;

        guardarDatos();
    }
}

actualizarTarjetasRevision(fechaSeleccionada);
actualizarResumenAseo(fechaSeleccionada);
});

// ========================================
// VOLVER AL LISTADO DE CABAÑAS
// ========================================

function volverListadoCabanas() {

    // ========================================
    // BORRAR REVISIÓN ABIERTA
    // ========================================

    localStorage.removeItem("haikuRevisionCabana");

    revisionIndividual.classList.remove("activa");

    listaRevisionCabanas.style.display = "";

}


botonVolverCabanas.addEventListener("click", () => {

    volverListadoCabanas();

});

// ========================================
// VOLVER DESDE EL MENÚ LATERAL
// ========================================

const botonMenuCabanas =
    document.querySelector('.menu-item[data-seccion="cabanas"]');


if (botonMenuCabanas) {

    botonMenuCabanas.addEventListener("click", () => {

        volverListadoCabanas();

    });

}

// ========================================
// FICHA RÁPIDA DE RESERVA
// ABRIR / CERRAR MODAL
// ========================================

const fichaReservaModal =
    document.getElementById("ficha-reserva-modal");

const fichaReservaCerrar =
    document.getElementById("ficha-reserva-cerrar");

const fichaReservaEditar =
    document.getElementById(
        "ficha-reserva-editar"
    );


// ========================================
// FORMATEAR FECHA PARA LA FICHA
// ========================================

function formatearFechaFicha(fecha) {

    if (!fecha) return "—";

    const partes = fecha.split("-");

    if (partes.length !== 3) {
        return fecha;
    }

    const [anio, mes, dia] = partes;

    return `${dia}-${mes}-${anio.slice(-2)}`;
}


// ========================================
// CALCULAR FECHA DE SALIDA
// ========================================

function calcularSalidaReserva(fechaIngreso, noches) {

    if (!fechaIngreso || !noches) {
        return "";
    }

    const [anio, mes, dia] =
        fechaIngreso.split("-").map(Number);

    const fecha =
        new Date(anio, mes - 1, dia);

    fecha.setDate(
        fecha.getDate() + Number(noches)
    );

    const salidaAnio =
        fecha.getFullYear();

    const salidaMes =
        String(fecha.getMonth() + 1).padStart(2, "0");

    const salidaDia =
        String(fecha.getDate()).padStart(2, "0");

    return `${salidaAnio}-${salidaMes}-${salidaDia}`;
}

// ========================================
// SERVICIOS DE LA FICHA POR RESERVA ID
// ========================================

function cargarServiciosFichaReserva(reservaId) {

    const contProgramados =
        document.getElementById(
            "ficha-servicios-programados"
        );

    const contRealizados =
        document.getElementById(
            "ficha-servicios-realizados"
        );

    const contPendientes =
        document.getElementById(
            "ficha-servicios-pendientes"
        );


    const contadorProgramados =
        document.getElementById(
            "ficha-servicios-programados-contador"
        );

    const contadorRealizados =
        document.getElementById(
            "ficha-servicios-realizados-contador"
        );

    const contadorPendientes =
        document.getElementById(
            "ficha-servicios-pendientes-contador"
        );


    if (
        !contProgramados ||
        !contRealizados ||
        !contPendientes
    ) {
        return;
    }


    // Limpiar contenido anterior
    contProgramados.innerHTML = "";
    contRealizados.innerHTML = "";
    contPendientes.innerHTML = "";


    // Si no hay reserva, dejamos todo en cero
    if (!reservaId) {

        contadorProgramados.textContent = "0";
        contadorRealizados.textContent = "0";
        contadorPendientes.textContent = "0";

        return;
    }


    const servicios =
        JSON.parse(
            localStorage.getItem("haikuServicios")
        ) || [];


    // SOLO servicios pertenecientes a esta reserva
    let serviciosReserva =
        servicios.filter(servicio =>
            String(servicio.reservaId || "") ===
            String(reservaId)
        );

    // Si la reserva ya fue archivada, usamos también
    // la copia histórica guardada al marcarla.
    if (serviciosReserva.length === 0) {

        const registroArchivado =
            buscarReservaArchivadaPorId(reservaId);

        serviciosReserva =
            Array.isArray(
                registroArchivado?.serviciosReserva
            )
                ? registroArchivado.serviciosReserva
                : [];
    }


    // ====================================
    // CLASIFICAR
    // ====================================

    const programados =
        serviciosReserva.filter(servicio =>
            servicio.estadoServicio !== "realizado"
        );


    const realizados =
        serviciosReserva.filter(servicio =>
            servicio.estadoServicio === "realizado"
        );


    const pendientes =
        serviciosReserva.filter(servicio =>
            servicio.estadoPago === "pendiente" &&
            servicio.tipoCobro !== "cortesia" &&
            servicio.cortesia !== true
        );


    // ====================================
    // CONTADORES
    // ====================================

    contadorProgramados.textContent =
        programados.length;

    contadorRealizados.textContent =
        realizados.length;

    contadorPendientes.textContent =
        pendientes.length;


    // ====================================
    // CREAR FILA DE SERVICIO
    // ====================================

    function crearItemServicio(servicio, mostrarFecha = false) {

    const item =
        document.createElement("div");

    item.className =
        "ficha-servicio-item";


    const izquierda =
        document.createElement("span");


    const fecha =
        mostrarFecha && servicio.fechaServicio
            ? `${formatearFechaFicha(servicio.fechaServicio)} · `
            : "";


    const hora =
        servicio.hora
            ? `${servicio.hora} · `
            : "";


    izquierda.textContent =
        `${fecha}${hora}${servicio.nombre || "Servicio"}`;


    const derecha =
        document.createElement("span");


    if (
        servicio.cortesia === true ||
        servicio.tipoCobro === "cortesia"
    ) {

        derecha.textContent = "🎁";

    } else {

        const total =
            Number(servicio.total) || 0;

        derecha.textContent =
            total > 0
                ? `$${total.toLocaleString("es-CL")}`
                : "";
    }


    item.appendChild(izquierda);
    item.appendChild(derecha);

    return item;
}


    // ====================================
    // MOSTRAR PROGRAMADOS
    // ====================================

    programados
        .sort((a, b) =>
            `${a.fechaServicio || ""} ${a.hora || ""}`
                .localeCompare(
                    `${b.fechaServicio || ""} ${b.hora || ""}`
                )
        )
        .forEach(servicio => {

            contProgramados.appendChild(
    crearItemServicio(servicio, true)
);

        });


    // ====================================
    // MOSTRAR REALIZADOS
    // ====================================

    realizados
        .sort((a, b) =>
            `${a.fechaServicio || ""} ${a.hora || ""}`
                .localeCompare(
                    `${b.fechaServicio || ""} ${b.hora || ""}`
                )
        )
        .forEach(servicio => {

            contRealizados.appendChild(
                crearItemServicio(servicio)
            );

        });


    // ====================================
    // MOSTRAR PENDIENTES DE PAGO
    // ====================================

    pendientes
        .sort((a, b) =>
            `${a.fechaServicio || ""} ${a.hora || ""}`
                .localeCompare(
                    `${b.fechaServicio || ""} ${b.hora || ""}`
                )
        )
        .forEach(servicio => {

            contPendientes.appendChild(
                crearItemServicio(servicio)
            );

        });

}

// ========================================
// PAGOS DE LA FICHA POR RESERVA ID
// ========================================

function buscarDatosReservaPorId(reservaId) {

    if (!reservaId) {
        return null;
    }

    let encontrado = null;

    Object.entries(datosPorFecha).some(([fecha, datosDia]) => {

        if (!datosDia?.cabanas) {
            return false;
        }

        return Object.entries(datosDia.cabanas).some(
            ([numeroCabana, cabana]) => {

                if (
                    String(cabana?.reservaId || "") !==
                    String(reservaId)
                ) {
                    return false;
                }

                // Preferimos el registro original de la reserva,
                // porque ahí están los datos administrativos.
                if (
                    cabana.fechaOrigenReserva === fecha ||
                    cabana.continuidadAutomatica !== true
                ) {

                    encontrado = {
                        fecha,
                        numeroCabana,
                        cabana
                    };

                    return true;
                }

                // Respaldo por si encontramos primero una continuidad
                if (!encontrado) {

                    encontrado = {
                        fecha,
                        numeroCabana,
                        cabana
                    };
                }

                return false;
            }
        );

    });

    return encontrado;
}


function buscarReservaArchivadaPorId(reservaId) {

    if (!reservaId) {
        return null;
    }

    const fuentes = [
        {
            clave: "haikuReservasNoShow",
            estado: "no-show"
        },
        {
            clave: "haikuReservasCanceladas",
            estado: "cancelada"
        }
    ];

    for (const fuente of fuentes) {

        const registros =
            JSON.parse(
                localStorage.getItem(fuente.clave)
            ) || [];

        const registro =
            registros.find(item =>
                String(item?.reservaId || "") ===
                String(reservaId)
            );

        if (registro) {
            return {
                ...registro,
                estadoArchivo:
                    registro.estado || fuente.estado
            };
        }
    }

    return null;
}


function cargarPagosFichaReserva(reservaId) {

    const campoTotal =
        document.getElementById(
            "ficha-pago-total"
        );

    const campoAbono =
        document.getElementById(
            "ficha-pago-abono"
        );

    const campoSaldo =
        document.getElementById(
            "ficha-pago-saldo"
        );

    const campoServicios =
        document.getElementById(
            "ficha-pago-servicios"
        );


    if (
        !campoTotal ||
        !campoAbono ||
        !campoSaldo ||
        !campoServicios
    ) {
        return;
    }


    // ====================================
    // DATOS DE LA RESERVA
    // ====================================

    const registroReserva =
        buscarDatosReservaPorId(reservaId);

    const registroArchivado =
        buscarReservaArchivadaPorId(
            reservaId
        );

    const cabanaReserva =
        registroReserva?.cabana ||
        registroArchivado?.datosReserva ||
        {};


    const totalReserva =
        Number(cabanaReserva.totalReserva) || 0;

    const abono =
        Number(cabanaReserva.abono) || 0;

    const saldoCalculado =
    Math.max(
        totalReserva - abono,
        0
    );

    const saldo =
    cabanaReserva.checkinCompleto === true
        ? 0
        : saldoCalculado;


    // ====================================
    // SERVICIOS PENDIENTES DE PAGO
    // ====================================

    const servicios =
        JSON.parse(
            localStorage.getItem("haikuServicios")
        ) || [];


    const serviciosPendientes =
        servicios.filter(servicio =>

            String(servicio.reservaId || "") ===
            String(reservaId) &&

            servicio.estadoPago === "pendiente" &&

            servicio.tipoCobro !== "cortesia" &&

            servicio.cortesia !== true
        );


    const totalServiciosPendientes =
        serviciosPendientes.reduce(
            (acumulado, servicio) => {

                return (
                    acumulado +
                    (Number(servicio.total) || 0)
                );

            },
            0
        );


    // ====================================
    // MOSTRAR
    // ====================================

    campoTotal.textContent =
        `$${totalReserva.toLocaleString("es-CL")}`;

    const accesoTotalReserva =
    campoTotal.closest("div");

if (accesoTotalReserva) {

    const puedeEditarTotal =
        Boolean(registroReserva?.cabana);

    accesoTotalReserva.classList.toggle(
        "ficha-pago-total-acceso",
        puedeEditarTotal
    );

    if (puedeEditarTotal) {

        accesoTotalReserva.setAttribute(
            "role",
            "button"
        );

        accesoTotalReserva.setAttribute(
            "tabindex",
            "0"
        );

        accesoTotalReserva.setAttribute(
            "title",
            "Ir a Total reserva"
        );

    } else {

        accesoTotalReserva.removeAttribute("role");
        accesoTotalReserva.removeAttribute("tabindex");
        accesoTotalReserva.removeAttribute("title");
    }
}

    campoAbono.textContent =
        `$${abono.toLocaleString("es-CL")}`;

    const accesoAbono =
    campoAbono.closest("div");

if (accesoAbono) {

    const puedeRegistrarAbono =
        Boolean(registroReserva?.cabana);

    accesoAbono.classList.toggle(
        "ficha-pago-abono-acceso",
        puedeRegistrarAbono
    );

    if (puedeRegistrarAbono) {

        accesoAbono.setAttribute(
            "role",
            "button"
        );

        accesoAbono.setAttribute(
            "tabindex",
            "0"
        );

        accesoAbono.setAttribute(
            "title",
            "Ir a registrar abono"
        );

    } else {

        accesoAbono.removeAttribute("role");
        accesoAbono.removeAttribute("tabindex");
        accesoAbono.removeAttribute("title");
    }
}

    campoSaldo.textContent =
        `$${saldo.toLocaleString("es-CL")}`;

    campoServicios.textContent =
        `$${totalServiciosPendientes.toLocaleString("es-CL")}`;

}

// ========================================
// FICHA · IR DIRECTO AL ABONO
// ========================================

function abrirAbonoReservaDesdeFicha() {

    if (!fichaReservaModal) {
        return;
    }

    const reservaId =
        fichaReservaModal.dataset.reservaId;

    if (!reservaId) {
        return;
    }


    const registroReserva =
        buscarDatosReservaPorId(
            reservaId
        );

    if (!registroReserva?.cabana) {
        return;
    }


    const numeroCabana =
        registroReserva.numeroCabana;

    const fechaIngreso =
        registroReserva.cabana
            .fechaOrigenReserva ||
        registroReserva.fecha;


    if (
        !numeroCabana ||
        !fechaIngreso
    ) {
        return;
    }


    const partesFecha =
        fechaIngreso
            .split("-")
            .map(Number);

    const [
        anio,
        mes,
        dia
    ] = partesFecha;


    if (
        !anio ||
        !mes ||
        !dia
    ) {
        return;
    }


    // Cerrar ficha
    fichaReservaModal.hidden = true;


    // Ir al día REAL de ingreso
    seleccionarDia(
        anio,
        mes - 1,
        dia,
        fechaIngreso
    );


    // Abrir sección Pagos
    const botonPagos =
        document.querySelector(
            '.menu-item[data-seccion="pagos"]'
        );

    if (botonPagos) {
        botonPagos.click();
    }


    // Buscar el abono de ESTA cabaña
    requestAnimationFrame(() => {

        const campoAbono =
            document.querySelector(
                `.pago-abono-monto[data-pago-cabana="${numeroCabana}"]`
            );

        if (!campoAbono) {
            return;
        }


        const tarjeta =
            campoAbono.closest(
                ".pago-abono-item"
            );


        if (tarjeta) {

            tarjeta.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }


        campoAbono.focus();
        campoAbono.select();

    });
}


// CLICK
document.addEventListener(
    "click",
    evento => {

        const acceso =
            evento.target.closest(
                ".ficha-pago-abono-acceso"
            );

        if (!acceso) {
            return;
        }

        abrirAbonoReservaDesdeFicha();
    }
);


// ENTER / ESPACIO
document.addEventListener(
    "keydown",
    evento => {

        const acceso =
            evento.target.closest(
                ".ficha-pago-abono-acceso"
            );

        if (!acceso) {
            return;
        }

        if (
            evento.key !== "Enter" &&
            evento.key !== " "
        ) {
            return;
        }

        evento.preventDefault();

        abrirAbonoReservaDesdeFicha();
    }
);

// ========================================
// FICHA · IR DIRECTO A TOTAL RESERVA
// ========================================

function abrirTotalReservaDesdeFicha() {

    if (!fichaReservaModal) {
        return;
    }

    const reservaId =
        fichaReservaModal.dataset.reservaId;

    if (!reservaId) {
        return;
    }


    const registroReserva =
        buscarDatosReservaPorId(
            reservaId
        );

    if (!registroReserva?.cabana) {
        return;
    }


    const numeroCabana =
        registroReserva.numeroCabana;

    const fechaIngreso =
        registroReserva.cabana
            .fechaOrigenReserva ||
        registroReserva.fecha;


    if (
        !numeroCabana ||
        !fechaIngreso
    ) {
        return;
    }


    const [
        anio,
        mes,
        dia
    ] =
        fechaIngreso
            .split("-")
            .map(Number);


    if (
        !anio ||
        !mes ||
        !dia
    ) {
        return;
    }


    // Cerrar ficha
    fichaReservaModal.hidden = true;


    // Ir al día de ingreso
    seleccionarDia(
        anio,
        mes - 1,
        dia,
        fechaIngreso
    );


    // Abrir Pagos
    const botonPagos =
        document.querySelector(
            '.menu-item[data-seccion="pagos"]'
        );

    if (botonPagos) {
        botonPagos.click();
    }


    // Ir directamente a Total reserva
    requestAnimationFrame(() => {

        const campoTotal =
            document.querySelector(
                `.pago-checkin-total[data-pago-checkin-total="${numeroCabana}"]`
            );

        if (!campoTotal) {
            return;
        }


        const tarjeta =
            campoTotal.closest(
                ".pago-checkin-item"
            );


        if (tarjeta) {

            tarjeta.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }


        campoTotal.focus();
        campoTotal.select();

    });
}


// CLICK
document.addEventListener(
    "click",
    evento => {

        const acceso =
            evento.target.closest(
                ".ficha-pago-total-acceso"
            );

        if (!acceso) {
            return;
        }

        abrirTotalReservaDesdeFicha();
    }
);


// ENTER / ESPACIO
document.addEventListener(
    "keydown",
    evento => {

        const acceso =
            evento.target.closest(
                ".ficha-pago-total-acceso"
            );

        if (!acceso) {
            return;
        }

        if (
            evento.key !== "Enter" &&
            evento.key !== " "
        ) {
            return;
        }

        evento.preventDefault();

        abrirTotalReservaDesdeFicha();
    }
);

// ========================================
// SOLICITUDES DE LA FICHA POR RESERVA ID
// ========================================

function cargarSolicitudesFichaReserva(reservaId) {

    const contenedor =
        document.getElementById(
            "ficha-reserva-solicitudes"
        );

    const contador =
        document.getElementById(
            "ficha-solicitudes-contador"
        );

    if (!contenedor || !contador) {
        return;
    }


    const solicitudes = [];


    Object.entries(datosPorFecha).forEach(
        ([fecha, datosDia]) => {

            if (!datosDia?.cabanas) {
                return;
            }


            Object.entries(datosDia.cabanas).forEach(
                ([numeroCabana, cabana]) => {

                    if (
                        String(cabana?.reservaId || "") !==
                        String(reservaId)
                    ) {
                        return;
                    }


                    const solicitud =
    String(
        cabana.solicitudAseoExpress || ""
    ).trim();

const solicitudLista =
    String(cabana.estadoFinal || "").trim().toUpperCase() === "LISTA";

if (!solicitud) {
    return;
}

solicitudes.push({
    fecha,
    texto: solicitud,
    lista: solicitudLista
});

                }
            );

        }
    );

    // Si la reserva ya salió de la operación diaria,
    // recuperamos sus solicitudes desde el archivo histórico.
    if (solicitudes.length === 0) {

        const archivo =
            buscarReservaArchivadaPorId(
                reservaId
            );

        (archivo?.registrosReserva || [])
            .forEach(registro => {

                const cabana =
                    registro.cabana || {};

                const solicitud =
                    String(
                        cabana.solicitudAseoExpress || ""
                    ).trim();

                if (!solicitud) return;

                solicitudes.push({
                    fecha: registro.fecha || "",
                    texto: solicitud,
                    lista:
                        String(
                            cabana.estadoFinal || ""
                        ).trim().toUpperCase() === "LISTA"
                });
            });
    }


    // Evitar repetir exactamente la misma solicitud
    const solicitudesUnicas =
        solicitudes.filter(
            (solicitud, indice, array) =>

                array.findIndex(item =>
                    item.fecha === solicitud.fecha &&
                    item.texto === solicitud.texto
                ) === indice
        );


    const cantidadPendientes =
    solicitudesUnicas.filter(
        solicitud => solicitud.lista !== true
    ).length;


    contenedor.innerHTML = "";

    const solicitudesPendientes =
    solicitudesUnicas.filter(
        solicitud => solicitud.lista !== true
    );

const solicitudesListas =
    solicitudesUnicas.filter(
        solicitud => solicitud.lista === true
    );

contador.textContent = "";
contador.hidden = true;


    if (solicitudesUnicas.length === 0) {

        contenedor.textContent =
            "Sin solicitudes pendientes.";

        return;
    }


    function pintarGrupoSolicitudes(titulo, solicitudes) {

    if (solicitudes.length === 0) {
        return;
    }

    const encabezado =
        document.createElement("div");

    encabezado.className =
        "ficha-solicitud-grupo-titulo";

    encabezado.textContent =
        `${titulo} ${solicitudes.length}`;

    contenedor.appendChild(encabezado);

    solicitudes.forEach(solicitud => {

        const fila =
            document.createElement("div");

        fila.className =
            "ficha-solicitud-item";

        const fecha =
            document.createElement("strong");

        fecha.textContent =
            `${formatearFechaFicha(solicitud.fecha)} ·`;

        const texto =
            document.createElement("span");

        texto.textContent =
            solicitud.texto;

        fila.appendChild(fecha);
        fila.appendChild(texto);

        contenedor.appendChild(fila);
    });
}

pintarGrupoSolicitudes(
    "PENDIENTES",
    solicitudesPendientes
);

pintarGrupoSolicitudes(
    "LISTAS",
    solicitudesListas
);

}



// ========================================
// NOTAS DE LA FICHA POR RESERVA ID
// ========================================

function cargarNotasFichaReserva(reservaId) {

    const contenedor =
        document.getElementById(
            "ficha-reserva-notas"
        );

    if (!contenedor) {
        return;
    }


    const notasReserva = [];


    Object.entries(datosPorFecha).forEach(
        ([fecha, datosDia]) => {

            if (
                !datosDia?.cabanas ||
                !Array.isArray(datosDia.notasOperativas)
            ) {
                return;
            }


            Object.entries(datosDia.cabanas).forEach(
                ([numeroCabana, cabana]) => {

                    if (
                        String(cabana?.reservaId || "") !==
                        String(reservaId)
                    ) {
                        return;
                    }


                    datosDia.notasOperativas.forEach(
                        nota => {

                            if (
                                String(nota.cabana) !==
                                String(numeroCabana)
                            ) {
                                return;
                            }


                            const texto =
                                String(
                                    nota.texto ||
                                    nota.nota ||
                                    ""
                                ).trim();


                            if (!texto) {
                                return;
                            }


                            notasReserva.push({
                                fecha,
                                texto
                            });

                        }
                    );

                }
            );

        }
    );

    // Las notas del registro histórico permanecen visibles
    // aunque la reserva ya no esté en Resumen ni Calendario.
    if (notasReserva.length === 0) {

        const archivo =
            buscarReservaArchivadaPorId(
                reservaId
            );

        (archivo?.notasReserva || [])
            .forEach(nota => {

                const texto =
                    String(
                        nota?.texto || ""
                    ).trim();

                if (!texto) return;

                notasReserva.push({
                    fecha: nota.fecha || "",
                    texto
                });
            });
    }


    // Evitar duplicados
    const notasUnicas =
        notasReserva.filter(
            (nota, indice, array) =>

                array.findIndex(item =>
                    item.fecha === nota.fecha &&
                    item.texto === nota.texto
                ) === indice
        );


    contenedor.innerHTML = "";


    if (notasUnicas.length === 0) {

        contenedor.textContent =
            "Sin notas registradas.";

        return;
    }


    notasUnicas.forEach(nota => {

        const fila =
            document.createElement("div");

        fila.className =
            "ficha-nota-item";


        const fecha =
            document.createElement("strong");

        fecha.textContent =
    `${formatearFechaFicha(nota.fecha)} ·`;


        const texto =
            document.createElement("span");

        texto.textContent =
            nota.texto;


        fila.appendChild(fecha);
        fila.appendChild(texto);

        contenedor.appendChild(fila);

    });

}

// ========================================
// BUSCADOR GLOBAL DE RESERVAS
// ========================================

const buscadorReservas =
    document.getElementById("busqueda-reservas");

const resultadosBusquedaReservas =
    document.getElementById(
        "resultados-busqueda-reservas"
    );


// Normaliza texto para que la búsqueda sea más flexible
function normalizarBusqueda(texto) {

    return String(texto || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}


// ========================================
// OBTENER RESERVAS ÚNICAS
// ========================================

function obtenerReservasParaBusqueda() {

    const reservas = new Map();

    const fichas =
        JSON.parse(
            localStorage.getItem("haikuFichaReservas")
        ) || {};

    const canceladas =
    JSON.parse(
        localStorage.getItem("haikuReservasCanceladas")
    ) || [];

    const noShows =
    JSON.parse(
        localStorage.getItem("haikuReservasNoShow")
    ) || [];


    Object.entries(datosPorFecha).forEach(
        ([fecha, datosDia]) => {

            if (!datosDia?.cabanas) {
                return;
            }

            Object.entries(datosDia.cabanas).forEach(
                ([numeroCabana, cabana]) => {

                    if (!cabana?.reservaId) {
                        return;
                    }


                    const reservaId =
                        String(cabana.reservaId);

                    const ficha =
                        fichas[reservaId] || {};


                    const fechaIngreso =
                        cabana.fechaOrigenReserva ||
                        fecha;


                    // Evitamos repetir la misma reserva
                    if (!reservas.has(reservaId)) {

                        reservas.set(
                            reservaId,
                            {
                                reservaId,
                                codigoHaiku:
                                    cabana.codigoHaiku ||
                                    ficha.codigoHaiku ||
                                    "",
                                numeroCabana,
                                fechaIngreso,

                                titular:
                                    cabana.titular ||
                                    "Sin titular",

                                rut:
                                    ficha.rut ||
                                    cabana.rut ||
                                    "",

                                telefono:
                                    ficha.telefono ||
                                    cabana.telefono ||
                                    "",

                                correo:
                                    ficha.correo ||
                                    cabana.correo ||
                                    cabana.email ||
                                    "",

                                acompanantes: [
                                    ficha.acompanante1,
                                    ficha.acompanante2,
                                    ficha.acompanante3,
                                    ficha.acompanante4,
                                    ficha.acompanante5
                                ]
                                .filter(Boolean)
                                .join(" ")
                            }
                        );
                    }

                }
            );
        }
    );

    canceladas.forEach(cancelada => {

    if (!cancelada?.reservaId) {
        return;
    }

    const reservaId =
        String(cancelada.reservaId);

    const ficha =
        fichas[reservaId] || {};

    const datosReserva =
        cancelada.datosReserva || {};

    reservas.set(
        reservaId,
        {
            reservaId,

            codigoHaiku:
                cancelada.codigoHaiku ||
                datosReserva.codigoHaiku ||
                ficha.codigoHaiku ||
                "",

            numeroCabana:
                cancelada.numeroCabana || "",

            fechaIngreso:
                cancelada.fechaIngreso || "",

            titular:
                cancelada.titular ||
                datosReserva.titular ||
                "Sin titular",

            rut:
                ficha.rut ||
                datosReserva.rut ||
                "",

            telefono:
                ficha.telefono ||
                datosReserva.telefono ||
                "",

            correo:
                ficha.correo ||
                datosReserva.correo ||
                datosReserva.email ||
                "",

            acompanantes: [
                ficha.acompanante1,
                ficha.acompanante2,
                ficha.acompanante3,
                ficha.acompanante4,
                ficha.acompanante5
            ]
            .filter(Boolean)
            .join(" "),

            cancelada: true
        }
    );

});

    noShows.forEach(noShow => {

        if (!noShow?.reservaId) {
            return;
        }

        const reservaId =
            String(noShow.reservaId);

        const ficha =
            noShow.datosFicha ||
            fichas[reservaId] ||
            {};

        const datosReserva =
            noShow.datosReserva || {};

        reservas.set(
            reservaId,
            {
                reservaId,

                codigoHaiku:
                    noShow.codigoHaiku ||
                    datosReserva.codigoHaiku ||
                    ficha.codigoHaiku ||
                    "",

                numeroCabana:
                    noShow.numeroCabana || "",

                fechaIngreso:
                    noShow.fechaIngreso || "",

                titular:
                    noShow.titular ||
                    datosReserva.titular ||
                    "Sin titular",

                rut:
                    ficha.rut ||
                    datosReserva.rut ||
                    "",

                telefono:
                    ficha.telefono ||
                    datosReserva.telefono ||
                    "",

                correo:
                    ficha.correo ||
                    datosReserva.correo ||
                    datosReserva.email ||
                    "",

                acompanantes: [
                    ficha.acompanante1,
                    ficha.acompanante2,
                    ficha.acompanante3,
                    ficha.acompanante4,
                    ficha.acompanante5
                ]
                .filter(Boolean)
                .join(" "),

                noShow: true
            }
        );
    });

    return Array.from(
        reservas.values()
    );
}


// ========================================
// MOSTRAR RESULTADOS
// ========================================

function buscarReservas(texto) {

    if (
        !resultadosBusquedaReservas ||
        !buscadorReservas
    ) {
        return;
    }


    const termino =
        normalizarBusqueda(texto);


    resultadosBusquedaReservas.innerHTML = "";


    if (termino.length < 2) {

        resultadosBusquedaReservas.hidden = true;
        return;
    }


    const reservas =
        obtenerReservasParaBusqueda();


    const coincidencias =
        reservas.filter(reserva => {

            const textoBusqueda =
                normalizarBusqueda(
                    [
                        reserva.titular,
                        reserva.codigoHaiku,
                        reserva.rut,
                        reserva.telefono,
                        reserva.correo,
                        reserva.acompanantes
                    ].join(" ")
                );


            return textoBusqueda.includes(
                termino
            );

        });


    if (coincidencias.length === 0) {

        resultadosBusquedaReservas.innerHTML = `
            <div class="busqueda-reserva-vacia">
                Sin reservas encontradas
            </div>
        `;

        resultadosBusquedaReservas.hidden = false;

        return;
    }


    coincidencias
        .slice(0, 8)
        .forEach(reserva => {

            const boton =
                document.createElement("button");

            boton.type = "button";

            boton.className =
                "resultado-reserva-item";

            boton.dataset.reservaId =
                reserva.reservaId;

            boton.dataset.cabana =
                reserva.numeroCabana;

            boton.dataset.fecha =
                reserva.fechaIngreso;

            boton.dataset.cancelada =
            reserva.cancelada === true
            ? "true"
            : "false";

            boton.dataset.noShow =
            reserva.noShow === true
            ? "true"
            : "false";


            boton.innerHTML = `
                <strong>
                    ${reserva.titular}
                </strong>

                <span>
                    CAB ${reserva.numeroCabana}
                    ·
                    ${reserva.codigoHaiku || "Sin código Haiku"}
                </span>

                ${
                    reserva.noShow === true
                    ? `
                        <em class="resultado-reserva-estado resultado-reserva-no-show">
                            ● No-Show
                        </em>
                    `
                    : ""
                }

                ${
                    reserva.rut ||
                    reserva.telefono
                        ? `
                        <small>
                            ${reserva.rut || ""}
                            ${
                                reserva.rut &&
                                reserva.telefono
                                    ? " · "
                                    : ""
                            }
                            ${reserva.telefono || ""}
                        </small>
                        `
                        : ""
                }
            `;


            resultadosBusquedaReservas.appendChild(
                boton
            );

        });


    resultadosBusquedaReservas.hidden = false;
}


// ========================================
// ESCRIBIR EN BUSCADOR
// ========================================

if (buscadorReservas) {

    buscadorReservas.addEventListener(
        "input",
        () => {

            buscarReservas(
                buscadorReservas.value
            );

        }
    );
}


// ========================================
// CLICK EN UNA RESERVA ENCONTRADA
// ========================================

if (resultadosBusquedaReservas) {

    resultadosBusquedaReservas.addEventListener(
        "click",
        evento => {

            const resultado =
                evento.target.closest(
                    ".resultado-reserva-item"
                );

            if (!resultado) {
                return;
            }


            const numeroCabana =
                resultado.dataset.cabana;

            const fechaReserva =
                resultado.dataset.fecha;

            const reservaId =
                resultado.dataset.reservaId;

            const esCancelada =
                resultado.dataset.cancelada === "true";

            const esNoShow =
                resultado.dataset.noShow === "true";

            if (esNoShow) {

                abrirFichaReservaNoShow(
                    reservaId
                );

                resultadosBusquedaReservas.hidden = true;
                buscadorReservas.value = "";

                return;
            }

            if (esCancelada) {

            abrirFichaReservaCancelada(reservaId);

                resultadosBusquedaReservas.hidden = true;
                buscadorReservas.value = "";

            return;
            }


            const fechaAnterior =
                fechaSeleccionada;


            // El modal actual busca la reserva
            // usando fechaSeleccionada.
            fechaSeleccionada =
                fechaReserva;


            const botonCabana =
                document.querySelector(
                    `[data-ficha-cabana="${numeroCabana}"]`
                );


            if (botonCabana) {

                botonCabana.click();

            }


            // Dejamos al usuario en el día
            // que estaba mirando originalmente.
            fechaSeleccionada =
                fechaAnterior;


            resultadosBusquedaReservas.hidden =
                true;

            buscadorReservas.value = "";

        }
    );
}

// ========================================
// CERRAR BUSCADOR AL HACER CLICK AFUERA
// ========================================

document.addEventListener("click", (evento) => {

    const dentroDelBuscador =
        evento.target.closest(".busqueda-reservas-wrap");

    if (dentroDelBuscador) {
        return;
    }

    if (resultadosBusquedaReservas) {
        resultadosBusquedaReservas.hidden = true;
    }

});

function abrirFichaReservaNoShow(reservaId) {

    const noShows =
        JSON.parse(
            localStorage.getItem(
                "haikuReservasNoShow"
            )
        ) || [];

    const registro =
        noShows.find(item =>
            String(item?.reservaId || "") ===
            String(reservaId || "")
        );

    if (!registro || !fichaReservaModal) {
        console.warn(
            "No se encontró reserva No-Show:",
            reservaId
        );
        return;
    }

    const datosReserva =
        registro.datosReserva || {};

    const fichas =
        obtenerFichasReservas();

    const ficha =
        registro.datosFicha ||
        fichas[reservaId] ||
        {};

    const numeroCabana =
        registro.numeroCabana || "";

    const titular =
        registro.titular ||
        datosReserva.titular ||
        "Sin titular";

    const fechaIngreso =
        registro.fechaIngreso || "";

    const noches =
        Number(registro.noches) || 0;

    const fechaSalida =
        calcularSalidaReserva(
            fechaIngreso,
            noches
        );

    const textos = {
        "ficha-reserva-cabana":
            `CAB ${numeroCabana}`,
        "ficha-reserva-titular":
            titular,
        "ficha-reserva-id":
            registro.reservaId || "Sin ID",
        "ficha-reserva-ingreso":
            formatearFechaFicha(fechaIngreso),
        "ficha-reserva-salida":
            fechaSalida
                ? formatearFechaFicha(fechaSalida)
                : "—",
        "ficha-reserva-noches":
            noches === 1
                ? "1 noche"
                : `${noches} noches`
    };

    Object.entries(textos)
        .forEach(([id, valor]) => {
            const campo =
                document.getElementById(id);

            if (campo) {
                campo.textContent = valor;
            }
        });

    const campoEstado =
        document.getElementById(
            "ficha-reserva-estado"
        );

    if (campoEstado) {
        campoEstado.classList.remove(
            "ficha-estado-hospedado",
            "ficha-estado-checkout",
            "ficha-estado-pendiente",
            "ficha-estado-confirmada",
            "ficha-estado-confirmacion-pendiente",
            "ficha-estado-cancelada",
            "ficha-estado-no-show"
        );

        campoEstado.classList.add(
            "ficha-estado-no-show"
        );

        campoEstado.textContent =
            "● No-Show";
    }

    fichaReservaModal.dataset.reservaId =
        registro.reservaId || "";

    fichaReservaModal.dataset.numeroCabana =
        numeroCabana;

    fichaReservaModal.dataset.reservaCancelada =
        "false";

    fichaReservaModal.dataset.reservaNoShow =
        "true";

    if (fichaReservaEditar) {
        fichaReservaEditar.hidden = true;
    }

    if (botonDesplegarEstadoFicha) {
        botonDesplegarEstadoFicha.hidden = true;
    }

    fichaReservaModal
        .querySelectorAll(
            ".ficha-dato-editable"
        )
        .forEach(campo => {
            campo.readOnly = true;
            campo.tabIndex = -1;
        });

    actualizarOcupacionFicha(
        datosReserva,
        false
    );

    const huespedTitular =
        document.getElementById(
            "ficha-huesped-titular"
        );

    if (huespedTitular) {
        huespedTitular.textContent =
            titular;
    }

    for (let i = 1; i <= 5; i++) {
        const campo =
            document.getElementById(
                `ficha-acompanante-${i}`
            );

        if (campo) {
            campo.value =
                ficha[`acompanante${i}`] || "";
        }
    }

    const campoRut =
        document.getElementById(
            "ficha-reserva-rut"
        );

    const campoTelefono =
        document.getElementById(
            "ficha-reserva-telefono"
        );

    if (campoRut) {
        campoRut.value = ficha.rut || "";
    }

    if (campoTelefono) {
        campoTelefono.value =
            ficha.telefono || "";
    }

    cargarServiciosFichaReserva(reservaId);
    cargarPagosFichaReserva(reservaId);
    cargarSolicitudesFichaReserva(reservaId);
    cargarNotasFichaReserva(reservaId);

    fichaReservaModal.hidden = false;
}

function abrirFichaReservaCancelada(reservaId) {

    const canceladas =
        JSON.parse(
            localStorage.getItem(
                "haikuReservasCanceladas"
            )
        ) || [];

    const registro =
        canceladas.find(
            item =>
                String(item?.reservaId || "") ===
                String(reservaId || "")
        );

    if (!registro) {
        console.warn(
            "No se encontró reserva cancelada:",
            reservaId
        );
        return;
    }

    const datosReserva =
    registro.datosReserva || {};

    const fichas =
    obtenerFichasReservas();

    const ficha =
    fichas[reservaId] || {};

    console.log(
        "FICHA CANCELADA ENCONTRADA:",
        registro
    );

    const numeroCabana =
    registro.numeroCabana || "";

const titular =
    registro.titular || "Sin titular";

const fechaIngreso =
    registro.fechaIngreso || "";

const noches =
    Number(registro.noches) || 0;

const fechaSalida =
    calcularSalidaReserva(
        fechaIngreso,
        noches
    );

const campoCabana =
    document.getElementById(
        "ficha-reserva-cabana"
    );

const campoTitular =
    document.getElementById(
        "ficha-reserva-titular"
    );

const campoReservaId =
    document.getElementById(
        "ficha-reserva-id"
    );

const campoIngreso =
    document.getElementById(
        "ficha-reserva-ingreso"
    );

const campoSalida =
    document.getElementById(
        "ficha-reserva-salida"
    );

const campoNoches =
    document.getElementById(
        "ficha-reserva-noches"
    );

const campoEstado =
    document.getElementById(
        "ficha-reserva-estado"
    );

if (campoCabana) {
    campoCabana.textContent =
        `CAB ${numeroCabana}`;
}

if (campoTitular) {
    campoTitular.textContent =
        titular;
}

if (campoReservaId) {
    campoReservaId.textContent =
        registro.reservaId || "Sin ID";
}

if (campoIngreso) {
    campoIngreso.textContent =
        formatearFechaFicha(fechaIngreso);
}

if (campoSalida) {
    campoSalida.textContent =
        fechaSalida
            ? formatearFechaFicha(fechaSalida)
            : "—";
}

if (campoNoches) {
    campoNoches.textContent =
        noches === 1
            ? "1 noche"
            : `${noches} noches`;
}

if (campoEstado) {

    campoEstado.classList.remove(
    "ficha-estado-hospedado",
    "ficha-estado-checkout",
    "ficha-estado-pendiente",
    "ficha-estado-confirmada",
    "ficha-estado-confirmacion-pendiente",
    "ficha-estado-cancelada",
    "ficha-estado-no-show"
);

campoEstado.classList.add(
    "ficha-estado-cancelada"
);
    campoEstado.textContent =
        "• Cancelada";
}

fichaReservaModal.dataset.reservaId =
    registro.reservaId || "";

fichaReservaModal.dataset.numeroCabana =
    numeroCabana;

fichaReservaModal.dataset.reservaCancelada =
    "true";

fichaReservaModal.dataset.reservaNoShow =
    "false";

if (fichaReservaEditar) {
    fichaReservaEditar.hidden =
        true;
}

if (botonDesplegarEstadoFicha) {
    botonDesplegarEstadoFicha.hidden =
        true;
}

const adultos =
    Number(datosReserva.adultos) || 0;

const ninos =
    Number(datosReserva.ninos) || 0;

const totalHuespedes =
    adultos + ninos;

const cantidadAcompanantes =
    Math.max(0, totalHuespedes - 1);

document
    .querySelectorAll(".ficha-acompanante-fila")
    .forEach(fila => {

        const numero =
            Number(fila.dataset.acompananteFila);

        if (numero <= cantidadAcompanantes) {
            fila.style.display = "";
        } else {
            fila.style.display = "none";
        }
    });

actualizarOcupacionFicha(
    datosReserva,
    false
);

const huespedTitular =
    document.getElementById(
        "ficha-huesped-titular"
    );

if (huespedTitular) {
    huespedTitular.textContent =
        registro.titular ||
        datosReserva.titular ||
        "Sin titular";
}

for (let i = 1; i <= 5; i++) {

    const campo =
        document.getElementById(
            `ficha-acompanante-${i}`
        );

    if (!campo) {
        continue;
    }

    campo.value =
        ficha[`acompanante${i}`] || "";
}

const campoRut =
    document.getElementById(
        "ficha-reserva-rut"
    );

const campoTelefono =
    document.getElementById(
        "ficha-reserva-telefono"
    );

if (campoRut) {
    campoRut.value =
        ficha.rut || "";
}

if (campoTelefono) {
    campoTelefono.value =
        ficha.telefono || "";
}

fichaReservaModal.hidden = false;
}

// ==========================================
// OCUPACIÓN SOLO LECTURA EN RESUMEN
// ==========================================

document
    .querySelectorAll(
        `
        [data-campo="adultos"],
        [data-campo="ninos"],
        [data-campo="mascotas"]
        `
    )
    .forEach(campo => {

        campo.readOnly = true;
        campo.tabIndex = -1;

        campo.classList.add(
            "campo-ocupacion-solo-lectura"
        );
    });


// ==========================================
// TEXTO COMPACTO DE OCUPACIÓN EN RESUMEN
// ==========================================

function actualizarTextoOcupacionResumen(
    contenedor,
    datosCabana = null
) {

    if (!contenedor) {
        return;
    }


    let texto =
        contenedor.querySelector(
            ".ocupacion-resumen-texto"
        );


    if (!texto) {

        texto =
            document.createElement(
                "span"
            );

        texto.className =
            "ocupacion-resumen-texto";

        contenedor.appendChild(
            texto
        );
    }


    const campoAdultos =
        contenedor.querySelector(
            '[data-campo="adultos"]'
        );

    const campoNinos =
        contenedor.querySelector(
            '[data-campo="ninos"]'
        );

    const campoMascotas =
        contenedor.querySelector(
            '[data-campo="mascotas"]'
        );


    const usarDatosCabana =
    datosCabana !== null;

    const sinReservaActual = Boolean(
        usarDatosCabana &&
        !datosCabana?.reservaId &&
        ["", "libre-libre", "sale-libre"].includes(
            String(datosCabana?.estado || "")
        )
    );

    texto.hidden = sinReservaActual;
    if (sinReservaActual) {
        texto.textContent = "";
        return;
    }


const adultos =
    usarDatosCabana
        ? Number(
            datosCabana.adultos
        ) || 0
        : Number(
            campoAdultos?.value
        ) || 0;


const ninos =
    usarDatosCabana
        ? Number(
            datosCabana.ninos
        ) || 0
        : Number(
            campoNinos?.value
        ) || 0;


const mascotas =
    usarDatosCabana
        ? Number(
            datosCabana.mascotas
        ) || 0
        : Number(
            campoMascotas?.value
        ) || 0;


    texto.textContent =
        `${adultos} ADL · ` +
        `${ninos} NIÑ · ` +
        `${mascotas} MASC`;
}


// Crear inicialmente el texto en las 11 cabañas

document
    .querySelectorAll(
        ".ocupacion-cabana"
    )
    .forEach(contenedor => {

        actualizarTextoOcupacionResumen(
            contenedor
        );
    });

// ==========================================
// MOSTRAR OCUPACIÓN EN LA FICHA
// ==========================================

function actualizarOcupacionFicha(
    cabana,
    permitirEdicion = true
) {

    const adultos =
        Number(cabana?.adultos) || 0;

    const ninos =
        Number(cabana?.ninos) || 0;

    const mascotas =
        Number(cabana?.mascotas) || 0;


    const resumen =
        document.getElementById(
            "ficha-reserva-ocupacion"
        );


    if (resumen) {

        resumen.textContent =
            `${adultos} ADL · ` +
            `${ninos} NIÑ · ` +
            `${mascotas} MASC`;
    }


    const botonEditar =
        document.querySelector(
            ".ficha-editar-ocupacion"
        );


    if (botonEditar) {

        botonEditar.hidden =
            !permitirEdicion;
    }


    const cantidadAcompanantes =
        Math.max(
            0,
            adultos + ninos - 1
        );


    document
        .querySelectorAll(
            ".ficha-acompanante-fila"
        )
        .forEach(fila => {

            const numero =
                Number(
                    fila.dataset
                        .acompananteFila
                );


            fila.style.display =
                numero <=
                cantidadAcompanantes
                    ? ""
                    : "none";
        });
}

// ========================================
// ABRIR FICHA DE RESERVA
// ========================================

document.addEventListener("click", (evento) => {

    const cabanaBoton =
        evento.target.closest("[data-ficha-cabana]");

    if (!cabanaBoton) return;
    if (!fichaReservaModal) return;
    if (!fechaSeleccionada) return;


    const numeroCabana =
        cabanaBoton.dataset.fichaCabana;


    const datosDia =
        obtenerDatosDia(fechaSeleccionada);


    const cabana =
        datosDia.cabanas[numeroCabana] || {};

        // ====================================
// CANTIDAD AUTOMÁTICA DE ACOMPAÑANTES
// ====================================

const adultos =
    Number(cabana.adultos) || 0;

const ninos =
    Number(cabana.ninos) || 0;

const totalHuespedes =
    adultos + ninos;

const cantidadAcompanantes =
    Math.max(0, totalHuespedes - 1);


document
    .querySelectorAll(".ficha-acompanante-fila")
    .forEach(fila => {

        const numero =
            Number(fila.dataset.acompananteFila);

        if (numero <= cantidadAcompanantes) {

            fila.style.display = "";

        } else {

            fila.style.display = "none";

        }

    });

    actualizarOcupacionFicha(
    cabana,
    true
);


    // ====================================
    // IDENTIDAD DE LA RESERVA
    // ====================================

    const reservaId =
        cabana.reservaId || "";

    const titular =
        cabana.titular &&
        cabana.titular.trim() !== ""
            ? cabana.titular
            : "Sin titular";

    const noches =
        Number(cabana.noches) || 0;

    const fechaIngreso =
        cabana.fechaOrigenReserva ||
        fechaSeleccionada;

    const fechaSalida =
        calcularSalidaReserva(
            fechaIngreso,
            noches
        );


    // Guardamos temporalmente qué reserva está abierta
    fichaReservaModal.dataset.numeroCabana =
        numeroCabana;

    fichaReservaModal.dataset.reservaId =
        reservaId;

    fichaReservaModal.dataset.reservaCancelada =
    "false";

    fichaReservaModal.dataset.reservaNoShow =
    "false";

    if (botonDesplegarEstadoFicha) {
        botonDesplegarEstadoFicha.hidden = false;
    }

    fichaReservaModal
        .querySelectorAll(
            ".ficha-dato-editable"
        )
        .forEach(campo => {
            campo.readOnly = false;
            campo.removeAttribute("tabindex");
        });


if (fichaReservaEditar) {
    fichaReservaEditar.hidden =
        false;
}


    // ====================================
    // CABECERA
    // ====================================

    const campoCabana =
        document.getElementById(
            "ficha-reserva-cabana"
        );

    const campoTitular =
        document.getElementById(
            "ficha-reserva-titular"
        );

    if (campoCabana) {
        campoCabana.textContent =
            `CAB ${numeroCabana}`;
    }

    if (campoTitular) {
        campoTitular.textContent =
            titular;
    }


    // El acompañante ya aparecerá en HUÉSPEDES,
    // por lo que evitamos duplicarlo arriba.
    const acompananteSuperior =
    document.getElementById(
        "ficha-reserva-acompanante-principal"
    );

if (acompananteSuperior) {

    const fichas =
        obtenerFichasReservas();

    const fichaReserva =
        fichas[reservaId] || {};

    const acompanantePrincipal =
        fichaReserva.acompanante1 || "";

    if (acompanantePrincipal) {

        acompananteSuperior.textContent =
            `Acompañante principal: ${acompanantePrincipal}`;

        acompananteSuperior.hidden = false;

    } else {

        acompananteSuperior.textContent = "";
        acompananteSuperior.hidden = true;

    }
}


    // ====================================
    // DATOS DE ESTANCIA
    // ====================================

    const campoReservaId =
        document.getElementById(
            "ficha-reserva-id"
        );

    const campoIngreso =
        document.getElementById(
            "ficha-reserva-ingreso"
        );

    const campoSalida =
        document.getElementById(
            "ficha-reserva-salida"
        );

    const campoNoches =
        document.getElementById(
            "ficha-reserva-noches"
        );


    if (campoReservaId) {
        campoReservaId.textContent =
            reservaId || "Sin ID";
    }

    if (campoIngreso) {
        campoIngreso.textContent =
            formatearFechaFicha(fechaIngreso);
    }

    if (campoSalida) {
        campoSalida.textContent =
            fechaSalida
                ? formatearFechaFicha(fechaSalida)
                : "—";
    }

    if (campoNoches) {

    const cantidadNoches =
        noches || 0;

    campoNoches.textContent =
        cantidadNoches === 1
            ? `◷ 1 noche`
            : `◷ ${cantidadNoches} noches`;
}


    // ====================================
    // TITULAR EN HUÉSPEDES
    // ====================================

    const huespedTitular =
        document.getElementById(
            "ficha-huesped-titular"
        );

    if (huespedTitular) {
        huespedTitular.textContent =
            titular;
    }


    // ====================================
    // DATOS EDITABLES
    // ====================================

    const fichas =
    obtenerFichasReservas();

    const acompanantes =
    fichas[reservaId] || {};

    for (let i = 1; i <= 5; i++) {

        const campo =
            document.getElementById(
                `ficha-acompanante-${i}`
            );

        if (campo) {
            campo.value =
                acompanantes[`acompanante${i}`] || "";
        }
    }


    const campoRut =
        document.getElementById(
            "ficha-reserva-rut"
        );

    const campoTelefono =
        document.getElementById(
            "ficha-reserva-telefono"
        );


    if (campoRut) {
        campoRut.value =
            acompanantes.rut || "";
    }

    if (campoTelefono) {
        campoTelefono.value =
            acompanantes.telefono || "";
    }

    // ====================================
// ESTADO DE LA RESERVA
// ====================================

const campoEstado =
    document.getElementById(
        "ficha-reserva-estado"
    );

if (campoEstado) {

    let tieneCheckin = false;
    let tieneCheckout = false;

    const fichasEstado = obtenerFichasReservas();
    const fichaEstado = fichasEstado[reservaId] || {};

    if (fichaEstado.checkoutRealizado === true) {
    tieneCheckout = true;
    }

    let tieneAbonoConfirmado = false;

    Object.values(datosPorFecha).forEach(dia => {

        if (!dia?.cabanas) return;

        Object.values(dia.cabanas).forEach(cabanaDia => {

            if (
                String(cabanaDia?.reservaId || "") !==
                String(reservaId)
            ) {
                return;
            }

            if (cabanaDia.checkinRealizado === true) {
                tieneCheckin = true;
            }

            if (
            cabanaDia.abonoVerificado === true &&
            Number(cabanaDia.abono || 0) > 0
            ) {
                tieneAbonoConfirmado = true;
            }

        });

    });

    campoEstado.classList.remove(
    "ficha-estado-hospedado",
    "ficha-estado-checkout",
    "ficha-estado-pendiente",
    "ficha-estado-confirmada",
    "ficha-estado-confirmacion-pendiente",
    "ficha-estado-cancelada",
    "ficha-estado-no-show"
);

    if (tieneCheckout) {

    campoEstado.textContent =
        "● Checked Out";

    campoEstado.classList.add(
        "ficha-estado-checkout"
    );

} else if (tieneCheckin) {

    campoEstado.textContent =
        "● Hospedado";

    campoEstado.classList.add(
        "ficha-estado-hospedado"
    );

} else if (tieneAbonoConfirmado) {

    campoEstado.textContent =
        "● Confirmada";

    campoEstado.classList.add(
        "ficha-estado-confirmada"
    );

} else {

    campoEstado.textContent =
        "● Confirmación pendiente";

    campoEstado.classList.add(
        "ficha-estado-confirmacion-pendiente"
    );

}
}

    // ====================================
    // SERVICIOS DE LA RESERVA
    // ====================================

    cargarServiciosFichaReserva(reservaId);

    // ====================================
    // PAGOS DE LA RESERVA
    // ====================================
    cargarPagosFichaReserva(reservaId);

    // ====================================
    // SOLICITUDES Y NOTAS
    // ====================================

    cargarSolicitudesFichaReserva(reservaId);
    cargarNotasFichaReserva(reservaId);


    // ====================================
    // MOSTRAR
    // ====================================

    fichaReservaModal.hidden = false;

});

// ========================================
// GUARDAR DATOS EDITABLES DE LA FICHA
// ========================================

function obtenerFichasReservas() {

    return JSON.parse(
        localStorage.getItem("haikuFichaReservas")
    ) || {};

}


function guardarFichasReservas(fichas) {

    localStorage.setItem(
        "haikuFichaReservas",
        JSON.stringify(fichas)
    );

}


function guardarDatosEditablesFicha(
    campoModificado = null
) {

    if (!fichaReservaModal) return;

    const reservaId =
        fichaReservaModal.dataset.reservaId;

    if (!reservaId) return;


    const fichas =
        obtenerFichasReservas();


    if (!fichas[reservaId]) {
        fichas[reservaId] = {};
    }


    const ficha =
        fichas[reservaId];

    let nombreCampoHistorial = "";
    let claveCampoHistorial = "";

    if (
        campoModificado?.id?.startsWith(
            "ficha-acompanante-"
        )
    ) {
        const numero =
            campoModificado.id.split("-").pop();

        claveCampoHistorial =
            `acompanante${numero}`;
        nombreCampoHistorial =
            `Acompañante ${numero}`;
    } else if (
        campoModificado?.id ===
        "ficha-reserva-rut"
    ) {
        claveCampoHistorial = "rut";
        nombreCampoHistorial = "RUT";
    } else if (
        campoModificado?.id ===
        "ficha-reserva-telefono"
    ) {
        claveCampoHistorial = "telefono";
        nombreCampoHistorial = "Teléfono";
    }

    const valorAnteriorHistorial =
        claveCampoHistorial
            ? ficha[claveCampoHistorial] || ""
            : "";


    for (let i = 1; i <= 5; i++) {

        const campo =
            document.getElementById(
                `ficha-acompanante-${i}`
            );

        ficha[`acompanante${i}`] =
            campo
                ? campo.value.trim()
                : "";
    }


    const campoRut =
        document.getElementById(
            "ficha-reserva-rut"
        );

    const campoTelefono =
        document.getElementById(
            "ficha-reserva-telefono"
        );


    ficha.rut =
        campoRut
            ? campoRut.value.trim()
            : "";

    ficha.telefono =
        campoTelefono
            ? campoTelefono.value.trim()
            : "";


    guardarFichasReservas(fichas);

    if (
        nombreCampoHistorial &&
        typeof registrarActividadHaiku ===
            "function"
    ) {
        registrarActividadHaiku({
            tipo: "reserva",
            accion: "Datos del huésped actualizados",
            reservaId,
            numeroCabana:
                fichaReservaModal.dataset.numeroCabana ||
                "",
            titular:
                document.getElementById(
                    "ficha-reserva-titular"
                )?.textContent.trim() || "",
            cambios: [
                {
                    campo: nombreCampoHistorial,
                    anterior: valorAnteriorHistorial,
                    nuevo: campoModificado?.value || ""
                }
            ]
        });
    }

}

document.addEventListener("change", (evento) => {

    if (
        !evento.target.closest(
            ".ficha-dato-editable"
        )
    ) {
        return;
    }

    guardarDatosEditablesFicha(
        evento.target
    );

});

if (fichaReservaEditar) {

    fichaReservaEditar.addEventListener(
        "click",
        () => {

            const reservaId =
                fichaReservaModal
                    ?.dataset.reservaId;


            if (
                !reservaId ||
                typeof abrirModalEditarReserva !==
                    "function"
            ) {
                return;
            }


            const abierta =
                abrirModalEditarReserva(
                    reservaId
                );


            if (abierta) {

                fichaReservaModal.hidden =
                    true;
            }
        }
    );
}

// CERRAR CON X
if (fichaReservaCerrar) {

    fichaReservaCerrar.addEventListener("click", () => {

        fichaReservaModal.hidden = true;

    });

}

function guardarReservaCancelada(reservaId) {

    if (!reservaId) {
        return;
    }

    const registroReserva =
        buscarDatosReservaPorId(reservaId);

    if (!registroReserva) {
        return;
    }

    const cabana =
        registroReserva.cabana || {};

    const canceladas =
        JSON.parse(
            localStorage.getItem("haikuReservasCanceladas")
        ) || [];

    canceladas.push({
        reservaId: reservaId,
        numeroCabana:
            registroReserva.numeroCabana || "",
        fechaIngreso:
            cabana.fechaOrigenReserva ||
            registroReserva.fecha ||
            "",
        noches:
            Number(cabana.noches) || 0,
        titular:
            cabana.titular || "",
        totalReserva:
            Number(cabana.totalReserva) || 0,
        abono:
            Number(cabana.abono) || 0,
        fechaCancelacion:
            new Date().toISOString(),
        estado:
            "cancelada",
        datosReserva:
    JSON.parse(
        JSON.stringify(cabana)
    )
    });

    localStorage.setItem(
        "haikuReservasCanceladas",
        JSON.stringify(canceladas)
    );
}


function obtenerRespaldoCompletoReserva(
    reservaId
) {
    const registrosReserva = [];
    const notasReserva = [];

    Object.entries(datosPorFecha)
        .forEach(([fecha, datosDia]) => {

            if (!datosDia?.cabanas) return;

            Object.entries(datosDia.cabanas)
                .forEach(
                    ([numeroCabana, cabana]) => {

                        if (
                            String(cabana?.reservaId || "") !==
                            String(reservaId)
                        ) {
                            return;
                        }

                        registrosReserva.push({
                            fecha,
                            numeroCabana,
                            cabana:
                                JSON.parse(
                                    JSON.stringify(cabana)
                                )
                        });

                        (datosDia.notasOperativas || [])
                            .forEach(nota => {

                                if (
                                    String(nota?.cabana || "") !==
                                    String(numeroCabana)
                                ) {
                                    return;
                                }

                                const texto =
                                    String(
                                        nota.texto ||
                                        nota.nota ||
                                        ""
                                    ).trim();

                                if (!texto) return;

                                notasReserva.push({
                                    fecha,
                                    texto
                                });
                            });
                    }
                );
        });

    const fichas =
        obtenerFichasReservas();

    const servicios =
        JSON.parse(
            localStorage.getItem("haikuServicios")
        ) || [];

    return {
        registrosReserva,
        notasReserva,
        datosFicha:
            JSON.parse(
                JSON.stringify(
                    fichas[reservaId] || {}
                )
            ),
        serviciosReserva:
            servicios
                .filter(servicio =>
                    String(servicio?.reservaId || "") ===
                    String(reservaId)
                )
                .map(servicio =>
                    JSON.parse(
                        JSON.stringify(servicio)
                    )
                )
    };
}


function validarNoShowReserva(reservaId) {

    const registro =
        buscarDatosReservaPorId(reservaId);

    if (!registro?.cabana) {
        return {
            permitido: false,
            mensaje:
                "No se encontraron los datos activos de esta reserva."
        };
    }

    const cabanaOrigen =
        registro.cabana;

    const fechaIngreso =
        cabanaOrigen.fechaOrigenReserva ||
        registro.fecha ||
        "";

    const partes =
        fechaIngreso
            .split("-")
            .map(Number);

    if (
        partes.length !== 3 ||
        partes.some(numero => !numero)
    ) {
        return {
            permitido: false,
            mensaje:
                "La reserva no tiene una fecha de ingreso válida."
        };
    }

    const [anio, mes, dia] = partes;

    // Se habilita al terminar completamente
    // el día agendado para el ingreso.
    const habilitadoDesde =
        new Date(
            anio,
            mes - 1,
            dia + 1,
            0,
            0,
            0,
            0
        );

    if (new Date() < habilitadoDesde) {
        const fechaDisponible =
            habilitadoDesde.toLocaleDateString(
                "es-CL"
            );

        return {
            permitido: false,
            mensaje:
                "La reserva debe respetarse durante todo " +
                "el día de ingreso. No-Show estará disponible " +
                `desde las 00:00 del ${fechaDisponible}.`,
            habilitadoDesde
        };
    }

    let tieneCheckin = false;
    let tieneCheckout = false;

    Object.values(datosPorFecha)
        .forEach(datosDia => {
            Object.values(
                datosDia?.cabanas || {}
            ).forEach(cabana => {

                if (
                    String(cabana?.reservaId || "") !==
                    String(reservaId)
                ) {
                    return;
                }

                if (
                    cabana.checkinRealizado === true ||
                    cabana.checkinManual === true
                ) {
                    tieneCheckin = true;
                }

                if (cabana.checkout === true) {
                    tieneCheckout = true;
                }
            });
        });

    const ficha =
        obtenerFichasReservas()[reservaId] || {};

    if (ficha.checkoutRealizado === true) {
        tieneCheckout = true;
    }

    if (tieneCheckin || tieneCheckout) {
        return {
            permitido: false,
            mensaje:
                tieneCheckout
                    ? "Una reserva con Checked Out no puede marcarse como No-Show."
                    : "Una reserva hospedada no puede marcarse como No-Show."
        };
    }

    return {
        permitido: true,
        registro,
        fechaIngreso,
        habilitadoDesde
    };
}


function guardarReservaNoShow(reservaId) {

    const validacion =
        validarNoShowReserva(reservaId);

    if (!validacion.permitido) {
        return false;
    }

    const registroReserva =
        validacion.registro;

    const cabana =
        registroReserva.cabana || {};

    const respaldo =
        obtenerRespaldoCompletoReserva(
            reservaId
        );

    const noShows =
        JSON.parse(
            localStorage.getItem(
                "haikuReservasNoShow"
            )
        ) || [];

    const registroNoShow = {
        reservaId,
        numeroCabana:
            registroReserva.numeroCabana || "",
        fechaIngreso:
            validacion.fechaIngreso,
        noches:
            Number(cabana.noches) || 0,
        titular:
            cabana.titular || "",
        totalReserva:
            Number(cabana.totalReserva) || 0,
        abono:
            Number(cabana.abono) || 0,
        fechaNoShow:
            new Date().toISOString(),
        estado: "no-show",
        datosReserva:
            JSON.parse(
                JSON.stringify(cabana)
            ),
        ...respaldo
    };

    const sinDuplicado =
        noShows.filter(item =>
            String(item?.reservaId || "") !==
            String(reservaId)
        );

    sinDuplicado.push(registroNoShow);

    localStorage.setItem(
        "haikuReservasNoShow",
        JSON.stringify(sinDuplicado)
    );

    return true;
}

function liberarReservaCancelada(reservaId) {

    if (!reservaId) {
        return;
    }

    Object.values(datosPorFecha).forEach(dia => {

        if (!dia?.cabanas) {
            return;
        }

        Object.values(dia.cabanas).forEach(cabana => {

            if (
                String(cabana?.reservaId || "") !==
                String(reservaId)
            ) {
                return;
            }

            Object.keys(cabana).forEach(clave => {
                delete cabana[clave];
            });

        });

    });

    guardarDatos();
}

function cancelarReservaDesdeFicha() {

    const reservaId =
        fichaReservaModal
            ?.dataset.reservaId;

    if (!reservaId) {
        return false;
    }

    const registroHistorial =
        buscarDatosReservaPorId(reservaId);


    const confirmarCancelacion =
        confirm(
            "¿Seguro que deseas cancelar esta reserva?\n\n" +
            "La reserva desaparecerá del Resumen y del Calendario."
        );


    if (!confirmarCancelacion) {
        return false;
    }


    guardarReservaCancelada(
        reservaId
    );

    if (
        typeof registrarActividadHaiku ===
        "function"
    ) {
        registrarActividadHaiku({
            tipo: "estado",
            accion: "Reserva cancelada",
            reservaId,
            numeroCabana:
                registroHistorial?.numeroCabana || "",
            titular:
                registroHistorial?.cabana?.titular || "",
            fechaOperacion:
                registroHistorial?.cabana
                    ?.fechaOrigenReserva ||
                registroHistorial?.fecha ||
                "",
            detalle:
                "La reserva fue retirada del Resumen y del Calendario, conservando su registro histórico.",
            cambios: [
                {
                    campo: "Estado",
                    anterior: "Activa",
                    nuevo: "Cancelada"
                }
            ]
        });
    }

    liberarReservaCancelada(
        reservaId
    );


    fichaReservaModal.hidden =
        true;


    cargarCabanasDia(
        fechaSeleccionada
    );


    if (
        typeof generarCalendario ===
        "function"
    ) {
        generarCalendario();
    }


    console.log(
        "RESERVA CANCELADA GUARDADA:",
        reservaId
    );


    return true;
}


function marcarReservaComoNoShowDesdeFicha() {

    const reservaId =
        fichaReservaModal
            ?.dataset.reservaId;

    if (!reservaId) {
        return false;
    }

    const validacion =
        validarNoShowReserva(reservaId);

    if (!validacion.permitido) {
        alert(validacion.mensaje);
        return false;
    }

    const confirmarNoShow =
        confirm(
            "¿Seguro que deseas marcar esta reserva como No-Show?\n\n" +
            "Se retirará del Resumen y del Calendario, " +
            "pero toda su información quedará guardada " +
            "en el buscador de reservas."
        );

    if (!confirmarNoShow) {
        return false;
    }

    const guardada =
        guardarReservaNoShow(
            reservaId
        );

    if (!guardada) {
        alert(
            "No fue posible guardar el registro No-Show. " +
            "La reserva no fue modificada."
        );
        return false;
    }

    if (
        typeof registrarActividadHaiku ===
        "function"
    ) {
        registrarActividadHaiku({
            tipo: "estado",
            accion: "Reserva marcada No-Show",
            reservaId,
            numeroCabana:
                validacion.registro?.numeroCabana || "",
            titular:
                validacion.registro?.cabana?.titular || "",
            fechaOperacion: validacion.fechaIngreso || "",
            detalle:
                "El huésped no se presentó. La reserva fue retirada de la operación activa y quedó archivada.",
            cambios: [
                {
                    campo: "Estado",
                    anterior: "Activa",
                    nuevo: "No-Show"
                }
            ]
        });
    }

    liberarReservaCancelada(
        reservaId
    );

    fichaReservaModal.hidden = true;

    if (
        typeof cargarCabanasDia === "function"
    ) {
        cargarCabanasDia(
            fechaSeleccionada
        );
    }

    if (
        typeof generarCalendario === "function"
    ) {
        generarCalendario();
    }

    if (
        typeof actualizarResumenDia === "function"
    ) {
        actualizarResumenDia(
            fechaSeleccionada
        );
    }

    if (
        typeof actualizarTarjetasRevision === "function"
    ) {
        actualizarTarjetasRevision(
            fechaSeleccionada
        );
    }

    if (
        typeof actualizarResumenAseo === "function"
    ) {
        actualizarResumenAseo(
            fechaSeleccionada
        );
    }

    if (
        typeof generarResumenOperativo === "function"
    ) {
        generarResumenOperativo(
            fechaSeleccionada
        );
    }

    console.log(
        "RESERVA NO-SHOW GUARDADA:",
        reservaId
    );

    return true;
}


// CERRAR TOCANDO EL FONDO OSCURO
if (fichaReservaModal) {

    fichaReservaModal.addEventListener("click", (evento) => {

        if (evento.target !== fichaReservaModal) return;

        fichaReservaModal.hidden = true;

    });

}

// ========================================
// MODAL SERVICIO DESDE RESUMEN
// ========================================

// ========================================
// ELEMENTOS MODAL SERVICIOS RESUMEN
// ========================================

const campoProducto =
    document.getElementById("resumen-servicio-producto");

const campoCantidad =
    document.getElementById("resumen-servicio-cantidad");

const campoFecha =
    document.getElementById("resumen-servicio-fecha");

const campoHora =
    document.getElementById("resumen-servicio-hora");

const bloqueProgramacion =
    document.getElementById("resumen-servicio-programacion");

const textoTotal =
    document.getElementById("resumen-servicio-total");

const bloquePrecioManual =
    document.getElementById("resumen-servicio-precio-manual-wrap");

const campoPrecioManual =
    document.getElementById("resumen-servicio-precio-manual");

document.addEventListener("click", (e) => {

    const boton =
        e.target.closest("[data-agregar-servicio]");

    if (!boton) return;

    const numeroCabana =
        boton.dataset.agregarServicio;

    const modal =
        document.getElementById("resumen-servicio-modal");

    const titulo =
        document.getElementById("resumen-servicio-titulo");

    const campoCabana =
        document.getElementById("resumen-servicio-cabana");

    
    if (!modal) return;

    // CAB correspondiente
    if (campoCabana) {
        campoCabana.value = `Cabaña ${numeroCabana}`;
        campoCabana.dataset.numeroCabana = numeroCabana;
    }

    // Título
    if (titulo) {
        titulo.textContent =
            `Agregar servicio · CAB ${numeroCabana}`;
    }

    // Valores iniciales
    if (campoCantidad) {
        campoCantidad.value = 1;
    }

    // Cargar catálogo real de Servicios
if (campoProducto) {

    campoProducto.innerHTML =
        '<option value="">Seleccionar servicio</option>';

    Object.entries(CATALOGO_SERVICIOS).forEach(
        ([idServicio, servicio]) => {

            const option =
                document.createElement("option");

            option.value = idServicio;
            option.textContent = servicio.nombre;

            campoProducto.appendChild(option);
        }
    );
}

    if (campoFecha) {
        campoFecha.value = fechaSeleccionada;
    }

    // Abrir modal
    modal.hidden = false;

});

function actualizarModalServicioResumen() {

    const idServicio = campoProducto.value;
    const cantidad = Number(campoCantidad.value) || 1;

    const servicio = CATALOGO_SERVICIOS[idServicio];

    if (!servicio) {
        textoTotal.textContent = "$0";
        bloqueProgramacion.hidden = true;
        return;
    }

    // PRECIO
    // ========================================
// PRECIO
// ========================================

const esJacuzzi =
    idServicio === "tinajaJacuzzi";

bloquePrecioManual.hidden = !esJacuzzi;

let precioUnitario = servicio.precio || 0;

if (esJacuzzi) {

    precioUnitario =
        campoPrecioManual.value === ""
            ? 0
            : Number(campoPrecioManual.value);

} else {

    campoPrecioManual.value = "";
}

const total =
    precioUnitario * cantidad;

textoTotal.textContent =
    `$${total.toLocaleString("es-CL")}`;


    // FECHA Y HORA
    const requiereProgramacion =
        servicio.categoria === "tinaja" ||
        servicio.categoria === "masaje" ||
        servicio.categoria === "checkout";

    bloqueProgramacion.hidden = !requiereProgramacion;

    if (requiereProgramacion) {

        if (!campoFecha.value) {
            campoFecha.value = fechaSeleccionada;
        }

    } else {

        campoFecha.value = "";
        campoHora.value = "";

    }
}

campoProducto.addEventListener(
    "change",
    actualizarModalServicioResumen
);

campoCantidad.addEventListener(
    "input",
    actualizarModalServicioResumen
);

campoPrecioManual.addEventListener(
    "input",
    actualizarModalServicioResumen
);

// ========================================
// GUARDAR SERVICIO DESDE RESUMEN
// ========================================

const btnGuardarServicioResumen =
    document.getElementById("resumen-servicio-guardar");

if (btnGuardarServicioResumen) {

    btnGuardarServicioResumen.addEventListener("click", () => {

        const campoCabana =
            document.getElementById("resumen-servicio-cabana");

        const numeroCabana =
            campoCabana?.dataset.numeroCabana;

        const idServicio =
            campoProducto.value;

        const cantidad =
            Number(campoCantidad.value) || 1;

        const tipoCobro =
            document.querySelector(
                'input[name="resumen-servicio-tipo-cobro"]:checked'
            )?.value || "normal";

        const servicio =
            CATALOGO_SERVICIOS[idServicio];

        if (!numeroCabana || !idServicio || !servicio) {
            alert("Selecciona un servicio.");
            return;
        }

        const requiereProgramacion =
            servicio.categoria === "tinaja" ||
            servicio.categoria === "masaje" ||
            servicio.categoria === "checkout";

        const fechaServicio =
            requiereProgramacion
                ? campoFecha.value
                : "";

        const horaServicio =
            requiereProgramacion
                ? campoHora.value
                : "";

        if (
            requiereProgramacion &&
            (!fechaServicio || !horaServicio)
        ) {
            alert("Selecciona fecha y hora.");
            return;
        }

        // Datos actuales de la cabaña
        const datosDia =
            obtenerDatosDia(fechaSeleccionada);

        const datosCabana =
            datosDia.cabanas[numeroCabana] || {};

        // Registrar usando EL MISMO sistema de Servicios
        const nuevoServicio = registrarServicio({

            fecha: fechaSeleccionada,

            numeroCabana: numeroCabana,

            reservaId:
                datosCabana.reservaId || "",

            titular:
                datosCabana.titular || "",

            tipoServicio:
                idServicio,

            cantidad:
                cantidad,

            personas:
                cantidad,

            precioManual:
                idServicio === "tinajaJacuzzi"
            ? Number(campoPrecioManual.value)
                : null,

            tipoCobro:
                tipoCobro,

            fechaServicio:
                fechaServicio,

            hora:
                horaServicio

        });

        if (!nuevoServicio) return;

        console.log(
            "SERVICIO GUARDADO DESDE RESUMEN:",
            nuevoServicio
        );

        // Actualizar Resumen
        cargarCabanasDia(fechaSeleccionada);
        actualizarResumenDia(fechaSeleccionada);
        generarResumenOperativo(fechaSeleccionada);

        // Cerrar modal
        cerrarModalServicioResumen();

    });

}

// ========================================
// CERRAR MODAL SERVICIO
// ========================================

function cerrarModalServicioResumen() {

    const modal =
        document.getElementById("resumen-servicio-modal");

    if (modal) {
        modal.hidden = true;
    }
}


const btnCerrarServicioResumen =
    document.getElementById("resumen-servicio-cerrar");

const btnCancelarServicioResumen =
    document.getElementById("resumen-servicio-cancelar");


if (btnCerrarServicioResumen) {

    btnCerrarServicioResumen.addEventListener(
        "click",
        cerrarModalServicioResumen
    );

}


if (btnCancelarServicioResumen) {

    btnCancelarServicioResumen.addEventListener(
        "click",
        cerrarModalServicioResumen
    );

}

// ========================================
// RESTAURAR REVISIÓN ABIERTA AL RECARGAR
// ========================================

const revisionCabanaGuardada =
    localStorage.getItem("haikuRevisionCabana");

if (revisionCabanaGuardada) {

    abrirRevisionCabana(
        revisionCabanaGuardada
    );

}

// ========================================
// RESUMEN DE ASEO
// ========================================

function actualizarResumenAseo(fecha) {

    const contenedor =
        document.getElementById("aseo-resumen");

    if (!contenedor || !fecha) {
        return;
    }

    const datos = obtenerDatosDia(fecha);

    contenedor.innerHTML = "";

    for (let numeroCabana = 1; numeroCabana <= 11; numeroCabana++) {

        const cabana =
            datos.cabanas[numeroCabana] || {};

        const solicitudAseo =
              cabana.solicitudAseoExpress || "";

        console.log(
    "CAB",
    numeroCabana,
    "SOLICITUD:",
    cabana.solicitudAseoExpress
);      

        const encargado =
            cabana.aseo || "Sin asignar";

        const horaIn =
            cabana.aseoIn || "--:--";

        const horaOut =
            cabana.aseoOut || "--:--";

        const notasCabana = datos.notasOperativas.filter(
    nota => String(nota.cabana) === String(numeroCabana)
);

const notaAseo = notasCabana.length
    ? notasCabana.map(nota => nota.texto).join(" · ")
    : "";
        
        const estadoFinal =
              cabana.estadoRevision === "lista"
            ? "LISTA"
            : cabana.estadoRevision === "con-detalles"
            ? "CON DETALLES"
            : "Pendiente";

        let claseEstado = "aseo-pendiente";

        if (estadoFinal === "LISTA") {
            claseEstado = "aseo-lista";
        }

        if (estadoFinal === "CON DETALLES") {
            claseEstado = "aseo-detalles";
        }

        const tarjeta =
            document.createElement("div");

        tarjeta.className =
            `aseo-resumen-cabana ${claseEstado}`;

            const nombreHuesped =
  cabana.titular ||
  cabana.nombre ||
  cabana.huesped ||
  "";

        tarjeta.innerHTML = `
            <div class="aseo-resumen-cabecera">

            <div class="aseo-resumen-numero">
                <strong>CAB ${numeroCabana}</strong>
                <span>· ${nombreHuesped || "Sin titular"}</span>
            </div>

            <select
    class="aseo-estado aseo-estado-select"
    data-estado-revision="${numeroCabana}"
>
    <option value="pendiente"
        ${cabana.estadoRevision === "pendiente" || !cabana.estadoRevision ? "selected" : ""}>
        Pendiente
    </option>

    <option value="con-detalles"
        ${cabana.estadoRevision === "con-detalles" ? "selected" : ""}>
        Con detalles
    </option>

    <option value="lista"
        ${cabana.estadoRevision === "lista" ? "selected" : ""}>
        Lista
    </option>
</select>

</div>

            <div class="aseo-resumen-datos">

                <div class="aseo-resumen-personal">

    <div class="aseo-resumen-encargado">
    <span>Encargado</span>

    <input
        type="text"
        class="aseo-encargado-input"
        data-aseo-encargado="${numeroCabana}"
        placeholder="Sin asignar"
        value="${cabana.aseo || ""}"
    >
</div>

    <div class="aseo-resumen-revision">
        <span>Revisión</span>
        <input
    type="text"
    class="aseo-revision-input"
    data-revision-cabana="${numeroCabana}"
    placeholder="Nombre"
    value="${cabana.revisionAseo || ""}"
>
    </div>

</div>

                <div class="aseo-resumen-horario">
    <div>
        <span>IN</span>
        <input
            type="time"
            class="aseo-hora-input"
            data-aseo-hora="aseoIn"
            data-cabana="${numeroCabana}"
            value="${cabana.aseoIn || ""}"
        >
    </div>

    <div>
        <span>OUT</span>
        <input
            type="time"
            class="aseo-hora-input"
            data-aseo-hora="aseoOut"
            data-cabana="${numeroCabana}"
            value="${cabana.aseoOut || ""}"
        >
    </div>
</div>

${notaAseo ? `
    <div class="aseo-resumen-nota">
        📝 ${notaAseo}
    </div>
` : ""}

${solicitudAseo ? `
    <div class="aseo-resumen-solicita">
        <span>📌 ${solicitudAseo}</span>

        <button
            type="button"
            class="aseo-solicita-eliminar"
            data-eliminar-solicita="${numeroCabana}"
            aria-label="Eliminar solicitud"
        >
            ×
        </button>
    </div>
` : ""}

            </div>
        `;

        tarjeta.dataset.aseoExpressCabana = numeroCabana;

        contenedor.appendChild(tarjeta);
    }

    document.querySelectorAll(".aseo-revision-input").forEach(input => {

    input.addEventListener("input", () => {

        const numeroCabana = input.dataset.revisionCabana;

        const datos = obtenerDatosDia(fecha);

        if (!datos.cabanas[numeroCabana]) {
            datos.cabanas[numeroCabana] = {};
        }

        datos.cabanas[numeroCabana].revisionAseo = input.value;

        guardarDatos();

    });

});

// ======================================
// CAMBIAR ENCARGADO DESDE ASEO
// ======================================

document.querySelectorAll(".aseo-encargado-input").forEach(input => {

    input.addEventListener("change", () => {

        const numeroCabana = input.dataset.aseoEncargado;
        const datos = obtenerDatosDia(fecha);

        if (!datos.cabanas[numeroCabana]) {
            datos.cabanas[numeroCabana] = {};
        }

        // Guardar encargado
        datos.cabanas[numeroCabana].aseo = input.value.trim();

        guardarDatos();

        // Refrescar Estado de cabañas
        cargarCabanasDia(fecha);
    });

});

// ELIMINAR SOLICITUD DE ASEO
document.querySelectorAll(".aseo-solicita-eliminar").forEach(boton => {

    boton.addEventListener("click", (evento) => {
        evento.stopPropagation();

        const numeroCabana = boton.dataset.eliminarSolicita;
        const datos = obtenerDatosDia(fecha);

        if (!datos.cabanas[numeroCabana]) {
            return;
        }

        const cabana =
            datos.cabanas[numeroCabana];

        const solicitudEliminada =
            cabana.solicitudAseoExpress || "";

        // Borrar solicitud
        cabana.solicitudAseoExpress = "";

        // Guardar cambio
        guardarDatos();

        if (
            solicitudEliminada &&
            typeof registrarActividadHaiku ===
                "function"
        ) {
            registrarActividadHaiku({
                tipo: "solicitud",
                accion: "Solicitud eliminada",
                reservaId: cabana.reservaId || "",
                numeroCabana,
                titular: cabana.titular || "",
                fechaOperacion: fecha,
                detalle: solicitudEliminada
            });
        }

        // Actualizar las tarjetas inmediatamente
        actualizarResumenAseo(fecha);
    });

});

}

// ========================================
// ABRIR REVISIÓN ASEO EXPRESS
// ========================================

document.addEventListener("click", (evento) => {

    const tarjeta = evento.target.closest(
        "[data-aseo-express-cabana]"
    );

    if (!tarjeta || !fechaSeleccionada) {
        return;
    }

    // No abrir la revisión si estamos usando
    // un select, input o botón de la tarjeta
    if (evento.target.closest("select, input, button")) {
        return;
    }

    const numeroCabana =
        tarjeta.dataset.aseoExpressCabana;

    abrirRevisionAseoExpress(numeroCabana);

});

function abrirRevisionAseoExpress(numeroCabana) {

    const panelAseo =
        document.querySelector("#seccion-aseo .aseo-panel");

    const revisionExpress =
        document.getElementById("aseo-express-individual");

    const titulo =
        document.getElementById("aseo-express-titulo");

    const fecha =
        document.getElementById("aseo-express-fecha");

    if (
        !panelAseo ||
        !revisionExpress ||
        !titulo ||
        !fecha
    ) {
        return;
    }

    titulo.textContent = `CAB ${numeroCabana}`;

    const fechaRevision =
        new Date(`${fechaSeleccionada}T12:00:00`);

    fecha.textContent =
        fechaRevision.toLocaleDateString(
            "es-CL",
            {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            }
        );

    localStorage.setItem(
        "haikuAseoExpressCabana",
        numeroCabana
    );

        // ========================================
    // CARGAR CHECKLIST ASEO EXPRESS
    // ========================================

    const datos =
        obtenerDatosDia(fechaSeleccionada);

    const datosCabana =
        datos.cabanas[numeroCabana] || {};

    const solicitudAseoExpress =
    document.getElementById("aseo-express-solicitud");

if (solicitudAseoExpress) {

    const solicitud =
        datosCabana.solicitudAseoExpress || "";

    if (solicitud) {
        solicitudAseoExpress.textContent =
            `📌 ${solicitud}`;

        solicitudAseoExpress.style.display = "";
    } else {
        solicitudAseoExpress.textContent = "";
        solicitudAseoExpress.style.display = "none";
    }
}    

    const checklistExpress =
        datosCabana.checklistAseoExpress || {};

    document
        .querySelectorAll("[data-aseo-express-item]")
        .forEach(check => {

            const item =
                check.dataset.aseoExpressItem;

            check.checked =
                checklistExpress[item] === true;

        });

            // ========================================
    // CARGAR DETALLES Y ESTADO
    // ========================================

    const detallesExpress =
        document.getElementById("aseo-express-detalles");

    const estadoExpress =
        document.getElementById("aseo-express-estado");

    if (detallesExpress) {
        detallesExpress.value =
            datosCabana.detallesAseoExpress || "";
    }

    if (estadoExpress) {
        estadoExpress.value =
            datosCabana.estadoRevision || "pendiente";
    }

    panelAseo.style.display = "none";

    revisionExpress.classList.add("activa");

}

// ========================================
// GUARDAR CHECKLIST ASEO EXPRESS
// ========================================

document.addEventListener("change", (evento) => {

    const check =
        evento.target.closest("[data-aseo-express-item]");

    if (!check || !fechaSeleccionada) {
        return;
    }

    const numeroCabana =
        localStorage.getItem("haikuAseoExpressCabana");

    if (!numeroCabana) {
        return;
    }

    const datos =
        obtenerDatosDia(fechaSeleccionada);

    if (!datos.cabanas[numeroCabana]) {
        datos.cabanas[numeroCabana] = {};
    }

    if (!datos.cabanas[numeroCabana].checklistAseoExpress) {
        datos.cabanas[numeroCabana].checklistAseoExpress = {};
    }

    const item =
        check.dataset.aseoExpressItem;

    datos.cabanas[numeroCabana]
        .checklistAseoExpress[item] =
        check.checked;

    guardarDatos();

});

const botonVolverAseo =
    document.getElementById("volver-aseo");

if (botonVolverAseo) {

    botonVolverAseo.addEventListener("click", () => {

        const panelAseo =
            document.querySelector("#seccion-aseo .aseo-panel");

        const revisionExpress =
            document.getElementById("aseo-express-individual");

        if (revisionExpress) {
            revisionExpress.classList.remove("activa");
        }

        if (panelAseo) {
            panelAseo.style.display = "";
        }

    });

}

// ========================================
// GUARDAR DETALLES ASEO EXPRESS
// ========================================

const detallesAseoExpress =
    document.getElementById("aseo-express-detalles");

if (detallesAseoExpress) {

    detallesAseoExpress.addEventListener("input", () => {

        if (!fechaSeleccionada) {
            return;
        }

        const numeroCabana =
            localStorage.getItem("haikuAseoExpressCabana");

        if (!numeroCabana) {
            return;
        }

        const datos =
            obtenerDatosDia(fechaSeleccionada);

        if (!datos.cabanas[numeroCabana]) {
            datos.cabanas[numeroCabana] = {};
        }

        datos.cabanas[numeroCabana].detallesAseoExpress =
            detallesAseoExpress.value;

        guardarDatos();

    });

}

// ========================================
// CAMBIAR ESTADO DESDE REVISIÓN ASEO EXPRESS
// ========================================

const estadoAseoExpress =
    document.getElementById("aseo-express-estado");

if (estadoAseoExpress) {

    estadoAseoExpress.addEventListener("change", () => {

        if (!fechaSeleccionada) {
            return;
        }

        const numeroCabana =
            localStorage.getItem("haikuAseoExpressCabana");

        if (!numeroCabana) {
            return;
        }

        const datos =
            obtenerDatosDia(fechaSeleccionada);

        if (!datos.cabanas[numeroCabana]) {
            datos.cabanas[numeroCabana] = {};
        }

        // Estado compartido
        datos.cabanas[numeroCabana].estadoRevision =
            estadoAseoExpress.value;

        // Sincronizar Estado Final
        if (estadoAseoExpress.value === "lista") {

            datos.cabanas[numeroCabana].estadoFinal =
                "LISTA";

        } else if (
            estadoAseoExpress.value === "con-detalles"
        ) {

            datos.cabanas[numeroCabana].estadoFinal =
                "CON DETALLES";

        } else {

            datos.cabanas[numeroCabana].estadoFinal = "";

        }

        guardarDatos();

        // Actualizar todas las vistas conectadas
        cargarCabanasDia(fechaSeleccionada);

        // Mantener sincronizado el selector
        // de la revisión normal de Cabañas
        if (revisionEstado) {
            revisionEstado.value =
                estadoAseoExpress.value;
        }

    });

}

// ========================================
// MODAL SOLICITA - ASEO EXPRESS
// ========================================

const botonAgregarSolicita =
    document.getElementById("agregar-solicita");

const panelAgregarSolicita =
    document.getElementById("panel-agregar-solicita");

const botonCerrarSolicita =
    document.getElementById("cerrar-solicita");

const botonCancelarSolicita =
    document.getElementById("cancelar-solicita");


// ABRIR MODAL
if (botonAgregarSolicita && panelAgregarSolicita) {

    botonAgregarSolicita.addEventListener("click", () => {

        panelAgregarSolicita.classList.add("activo");

    });

}


// CERRAR CON X
if (botonCerrarSolicita && panelAgregarSolicita) {

    botonCerrarSolicita.addEventListener("click", () => {

        panelAgregarSolicita.classList.remove("activo");

    });

}


// CERRAR CON CANCELAR
if (botonCancelarSolicita && panelAgregarSolicita) {

    botonCancelarSolicita.addEventListener("click", () => {

        panelAgregarSolicita.classList.remove("activo");

    });

}

// ========================================
// GUARDAR SOLICITA - ASEO EXPRESS
// ========================================

const botonGuardarSolicita =
    document.getElementById("guardar-solicita");

const selectCabanaSolicita =
    document.getElementById("solicita-cabana");

const textoSolicita =
    document.getElementById("solicita-texto");

if (
    botonGuardarSolicita &&
    selectCabanaSolicita &&
    textoSolicita
) {

    botonGuardarSolicita.addEventListener("click", () => {

        if (!fechaSeleccionada) {
            return;
        }

        const numeroCabana = selectCabanaSolicita.value;
        const solicitud = textoSolicita.value.trim();

        if (!numeroCabana || !solicitud) {
            return;
        }

        const datos = obtenerDatosDia(fechaSeleccionada);

        if (!datos.cabanas[numeroCabana]) {
            datos.cabanas[numeroCabana] = {};
        }

        // Guardamos la solicitud dentro de ESA fecha y ESA cabaña
        datos.cabanas[numeroCabana].solicitudAseoExpress = solicitud;

        guardarDatos();

        if (
            typeof registrarActividadHaiku ===
            "function"
        ) {
            const cabana =
                datos.cabanas[numeroCabana];

            registrarActividadHaiku({
                tipo: "solicitud",
                accion: "Solicitud agregada",
                reservaId: cabana.reservaId || "",
                numeroCabana,
                titular: cabana.titular || "",
                fechaOperacion: fechaSeleccionada,
                detalle: solicitud
            });
        }

        // Limpiar campo
        textoSolicita.value = "";

        // Cerrar modal
        panelAgregarSolicita.classList.remove("activo");

        // Actualizar Aseo
        actualizarResumenAseo(fechaSeleccionada);

        const reservaIdAbierta =
        fichaReservaModal?.dataset.reservaId || "";

        if (reservaIdAbierta) {
        cargarSolicitudesFichaReserva(reservaIdAbierta);
        }

    });

}

// ========================================
// CAMBIAR ESTADO DESDE ASEO
// ========================================

document.addEventListener("change", (evento) => {

    const selector = evento.target.closest("[data-estado-revision]");

    if (!selector || !fechaSeleccionada) {
        return;
    }

    const numeroCabana = selector.dataset.estadoRevision;
    const datos = obtenerDatosDia(fechaSeleccionada);

    if (!datos.cabanas[numeroCabana]) {
        datos.cabanas[numeroCabana] = {};
    }

    // Guardar estado para Revisión
datos.cabanas[numeroCabana].estadoRevision = selector.value;

// Convertir el estado de Aseo al formato que usa Resumen
let estadoFinalResumen = "";

if (selector.value === "lista") {
    estadoFinalResumen = "LISTA";
} else if (selector.value === "con-detalles") {
    estadoFinalResumen = "CON DETALLES";
}

// Guardar estado para Resumen
datos.cabanas[numeroCabana].estadoFinal = estadoFinalResumen;

    guardarDatos();

// Actualizar tabla Estado de cabañas
cargarCabanasDia(fechaSeleccionada);

// Actualizar las demás vistas
actualizarResumenDia(fechaSeleccionada);
actualizarResumenAseo(fechaSeleccionada);
actualizarTarjetasRevision(fechaSeleccionada);

    // Si está abierta esa misma cabaña, actualizar su selector
    const cabanaAbierta = localStorage.getItem("haikuRevisionCabana");

    if (
        cabanaAbierta === String(numeroCabana) &&
        revisionEstado
    ) {
        revisionEstado.value = selector.value;
    }

});

// ========================================
// CAMBIAR HORARIOS IN / OUT DESDE ASEO
// ========================================

document.addEventListener("change", (evento) => {

    const inputHora = evento.target.closest(".aseo-hora-input");

    if (!inputHora || !fechaSeleccionada) {
        return;
    }

    const numeroCabana = inputHora.dataset.cabana;
    const campoHora = inputHora.dataset.aseoHora;

    const datos = obtenerDatosDia(fechaSeleccionada);

    if (!datos.cabanas[numeroCabana]) {
        datos.cabanas[numeroCabana] = {};
    }

    // Guardar en el mismo campo que utiliza Resumen
    datos.cabanas[numeroCabana][campoHora] = inputHora.value;

    guardarDatos();

    // Actualizar Resumen y Aseo
    cargarCabanasDia(fechaSeleccionada);
    actualizarResumenAseo(fechaSeleccionada);
});

// ========================================
// ESTADOS COMPACTOS EN CELULAR
// ========================================

const nombresEstadoDesktop = {
    "libre-libre": "LIBRE / LIBRE",
    "libre-ingresa": "LIBRE / INGRESA",
    "sale-libre": "SALE / LIBRE",
    "sale-ingresa": "SALE / INGRESA",
    "continua": "CONTINÚA",
    "bloqueada": "BLOQUEADA",
    "fullday": "FULLDAY"
};

const nombresEstadoMovil = {
    "libre-libre": "L/L",
    "libre-ingresa": "L/IN",
    "sale-libre": "S/L",
    "sale-ingresa": "S/IN",
    "continua": "CONT",
    "bloqueada": "BLQ",
    "fullday": "F/D"
};


function actualizarNombresEstadosResponsive() {

    const esMovil = window.innerWidth <= 768;

    document
        .querySelectorAll('[data-campo="estado"]')
        .forEach(selector => {

            Array.from(selector.options).forEach(opcion => {

                const valor = opcion.value;

                if (esMovil && nombresEstadoMovil[valor]) {

                    opcion.textContent =
                        nombresEstadoMovil[valor];

                } else if (
                    !esMovil &&
                    nombresEstadoDesktop[valor]
                ) {

                    opcion.textContent =
                        nombresEstadoDesktop[valor];
                }

            });

        });
}


// Ejecutar al cargar
actualizarNombresEstadosResponsive();


// Actualizar si cambia el tamaño de pantalla
window.addEventListener(
    "resize",
    actualizarNombresEstadosResponsive
);

// ==========================================
// MENÚ DE ESTADO DE LA FICHA
// ==========================================

const botonDesplegarEstadoFicha =
    document.getElementById(
        "ficha-estado-desplegar"
    );

const menuEstadoFicha =
    document.getElementById(
        "ficha-estado-menu"
    );

const opcionNoShowFicha =
    menuEstadoFicha
        ?.querySelector(
            '[data-ficha-estado-opcion="no-show"]'
        );


function actualizarDisponibilidadNoShowFicha() {

    if (!opcionNoShowFicha) return;

    const reservaId =
        fichaReservaModal
            ?.dataset.reservaId;

    const esRegistroHistorico =
        fichaReservaModal
            ?.dataset.reservaCancelada === "true" ||
        fichaReservaModal
            ?.dataset.reservaNoShow === "true";

    const validacion =
        !reservaId || esRegistroHistorico
            ? {
                permitido: false,
                mensaje:
                    "Este registro ya no pertenece a una reserva activa."
            }
            : validarNoShowReserva(
                reservaId
            );

    opcionNoShowFicha.classList.toggle(
        "ficha-estado-opcion-bloqueada",
        !validacion.permitido
    );

    opcionNoShowFicha.classList.toggle(
        "ficha-estado-opcion-no-show-activa",
        validacion.permitido
    );

    opcionNoShowFicha.setAttribute(
        "aria-disabled",
        String(!validacion.permitido)
    );

    opcionNoShowFicha.title =
        validacion.permitido
            ? "Marcar como No-Show"
            : validacion.mensaje;
}


function cerrarMenuEstadoFicha() {

    if (
        !menuEstadoFicha ||
        !botonDesplegarEstadoFicha
    ) {
        return;
    }


    menuEstadoFicha.hidden = true;

    botonDesplegarEstadoFicha.setAttribute(
        "aria-expanded",
        "false"
    );
}


if (
    botonDesplegarEstadoFicha &&
    menuEstadoFicha
) {

    botonDesplegarEstadoFicha.addEventListener(
        "click",
        evento => {

            evento.stopPropagation();

            actualizarDisponibilidadNoShowFicha();

            const abrir =
                menuEstadoFicha.hidden;


            menuEstadoFicha.hidden =
                !abrir;


            botonDesplegarEstadoFicha.setAttribute(
                "aria-expanded",
                String(abrir)
            );
        }
    );
}


// Cerrar tocando fuera

document.addEventListener(
    "click",
    evento => {

        if (
            evento.target.closest(
                ".ficha-estado-control"
            )
        ) {
            return;
        }


        cerrarMenuEstadoFicha();
    }
);


// Cerrar con Escape

document.addEventListener(
    "keydown",
    evento => {

        if (evento.key === "Escape") {
            cerrarMenuEstadoFicha();
        }
    }
);


// ==========================================
// MARCAR LA RESERVA COMO HOSPEDADA
// ==========================================

function marcarReservaComoHospedada(
    reservaId,
    numeroCabana
) {

    let reservaEncontrada = false;


    Object.entries(
        datosPorFecha
    ).forEach(
        ([fechaDia, datosDia]) => {

            const cabana =
                datosDia?.cabanas?.[
                    numeroCabana
                ];


            if (
                !cabana ||
                String(cabana.reservaId) !==
                    String(reservaId)
            ) {
                return;
            }


            reservaEncontrada = true;


            const esDiaSalida =
                cabana.estado ===
                "sale-libre";


            if (!esDiaSalida) {

                cabana.checkinRealizado =
                    true;
            }


            const esRegistroOrigen =

                cabana.continuidadAutomatica !==
                    true ||

                cabana.fechaOrigenReserva ===
                    fechaDia;


            if (esRegistroOrigen) {

                cabana.checkinManual =
                    true;
            }
        }
    );


    if (!reservaEncontrada) {
        return false;
    }


    guardarDatos();

    return true;
}


// ==========================================
// OPCIONES DEL MENÚ
// ==========================================

if (menuEstadoFicha) {

    menuEstadoFicha.addEventListener(
        "click",
        evento => {

            const opcion =
                evento.target.closest(
                    "[data-ficha-estado-opcion]"
                );


            if (!opcion) {
                return;
            }


            const estadoElegido =
                opcion.dataset
                    .fichaEstadoOpcion;

            if (
                estadoElegido ===
                "no-show"
            ) {

                cerrarMenuEstadoFicha();

                marcarReservaComoNoShowDesdeFicha();

                return;
            }

            if (
                estadoElegido ===
                "cancelada"
            ) {

            cerrarMenuEstadoFicha();

            cancelarReservaDesdeFicha();

            return;
        }

            // Por ahora, las demás opciones
            // solamente cierran el menú.

            if (
                estadoElegido !==
                "hospedado"
            ) {

                cerrarMenuEstadoFicha();
                return;
            }


            const reservaId =
                fichaReservaModal
                    ?.dataset.reservaId;

            const numeroCabana =
                fichaReservaModal
                    ?.dataset.numeroCabana;


            if (
                !reservaId ||
                !numeroCabana
            ) {
                return;
            }


            const actualizado =
                marcarReservaComoHospedada(
                    reservaId,
                    numeroCabana
                );


            if (!actualizado) {
                return;
            }

            if (
                typeof registrarActividadHaiku ===
                "function"
            ) {
                const registroHistorial =
                    buscarDatosReservaPorId(reservaId);

                registrarActividadHaiku({
                    tipo: "estado",
                    accion: "Reserva marcada Hospedado",
                    reservaId,
                    numeroCabana,
                    titular:
                        registroHistorial?.cabana?.titular ||
                        "",
                    fechaOperacion:
                        registroHistorial?.cabana
                            ?.fechaOrigenReserva ||
                        registroHistorial?.fecha ||
                        "",
                    cambios: [
                        {
                            campo: "Estado",
                            anterior: "Activa",
                            nuevo: "Hospedado"
                        }
                    ]
                });
            }


            const campoEstado =
                document.getElementById(
                    "ficha-reserva-estado"
                );


            if (campoEstado) {

                campoEstado.classList.remove(
                    "ficha-estado-checkout",
                    "ficha-estado-pendiente",
                    "ficha-estado-confirmada",
                    "ficha-estado-confirmacion-pendiente",
                    "ficha-estado-cancelada",
                    "ficha-estado-no-show"
                );


                campoEstado.classList.add(
                    "ficha-estado-hospedado"
                );


                campoEstado.textContent =
                    "● Hospedado";
            }


            cerrarMenuEstadoFicha();


            if (
                typeof cargarCabanasDia ===
                "function"
            ) {

                cargarCabanasDia(
                    fechaSeleccionada
                );
            }


            if (
                typeof generarCalendario ===
                "function"
            ) {
                generarCalendario();
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
                typeof actualizarTarjetasRevision ===
                "function"
            ) {

                actualizarTarjetasRevision(
                    fechaSeleccionada
                );
            }


            if (
                typeof actualizarResumenAseo ===
                "function"
            ) {

                actualizarResumenAseo(
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
    );
}

// ==========================================
// EDITAR OCUPACIÓN DESDE LA FICHA
// ==========================================

document.addEventListener(
    "click",
    evento => {

        const boton =
            evento.target.closest(
                ".ficha-editar-ocupacion"
            );


        if (!boton) {
            return;
        }


        const reservaId =
            fichaReservaModal
                ?.dataset.reservaId;

        const numeroCabana =
            fichaReservaModal
                ?.dataset.numeroCabana;


        if (
            !reservaId ||
            !numeroCabana
        ) {
            return;
        }


        const registro =
            buscarDatosReservaPorId(
                reservaId
            );


        if (!registro?.cabana) {
            return;
        }


        const cabana =
            registro.cabana;


        const adultosActuales =
            Number(cabana.adultos) || 1;

        const ninosActuales =
            Number(cabana.ninos) || 0;

        const mascotasActuales =
            Number(cabana.mascotas) || 0;


        const respuestaAdultos =
            prompt(
                "Cantidad de adultos:",
                adultosActuales
            );


        if (respuestaAdultos === null) {
            return;
        }


        const respuestaNinos =
            prompt(
                "Cantidad de niños:",
                ninosActuales
            );


        if (respuestaNinos === null) {
            return;
        }


        const respuestaMascotas =
            prompt(
                "Cantidad de mascotas:",
                mascotasActuales
            );


        if (respuestaMascotas === null) {
            return;
        }


        const adultos =
            Number(respuestaAdultos);

        const ninos =
            Number(respuestaNinos);

        const mascotas =
            Number(respuestaMascotas);


        const cantidadesValidas =

            Number.isInteger(adultos) &&
            Number.isInteger(ninos) &&
            Number.isInteger(mascotas) &&

            adultos >= 1 &&
            ninos >= 0 &&
            mascotas >= 0;


        if (!cantidadesValidas) {

            alert(
                "Ingresa cantidades válidas. Debe existir al menos un adulto."
            );

            return;
        }


        let capacidadMaxima = 5;


        if (
            typeof catalogoCabanasReserva !==
                "undefined"
        ) {

            capacidadMaxima =
                Number(
                    catalogoCabanasReserva[
                        numeroCabana
                    ]?.capacidad
                ) || 5;
        }


        if (
            adultos + ninos >
            capacidadMaxima
        ) {

            alert(
                `La cabaña admite un máximo de ${capacidadMaxima} personas entre adultos y niños.`
            );

            return;
        }


        sincronizarDatosReserva(
            reservaId,
            numeroCabana,
            "adultos",
            String(adultos)
        );


        sincronizarDatosReserva(
            reservaId,
            numeroCabana,
            "ninos",
            String(ninos)
        );


        sincronizarDatosReserva(
            reservaId,
            numeroCabana,
            "mascotas",
            String(mascotas)
        );


        cabana.adultos =
            String(adultos);

        cabana.ninos =
            String(ninos);

        cabana.mascotas =
            String(mascotas);


        const cantidadAcompanantes =
            Math.max(
                0,
                adultos + ninos - 1
            );


        const fichas =
            obtenerFichasReservas();


        if (!fichas[reservaId]) {
            fichas[reservaId] = {};
        }


        const ficha =
            fichas[reservaId];


        for (
            let numero = 1;
            numero <= 5;
            numero++
        ) {

            const campo =
                document.getElementById(
                    `ficha-acompanante-${numero}`
                );


            if (
                numero >
                cantidadAcompanantes
            ) {

                ficha[
                    `acompanante${numero}`
                ] = "";

                if (campo) {
                    campo.value = "";
                }
            }
        }


        guardarFichasReservas(
            fichas
        );


        actualizarOcupacionFicha(
            cabana,
            true
        );


        const acompanantePrincipal =
            document.getElementById(
                "ficha-reserva-acompanante-principal"
            );


        if (
            acompanantePrincipal &&
            cantidadAcompanantes === 0
        ) {

            acompanantePrincipal.textContent =
                "";

            acompanantePrincipal.hidden =
                true;
        }


        if (
            typeof cargarCabanasDia ===
            "function"
        ) {
            cargarCabanasDia(
                fechaSeleccionada
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
);

// ==========================================
// EDITAR TITULAR DESDE LA FICHA
// ==========================================

document.addEventListener(
    "click",
    evento => {

        const boton =
            evento.target.closest(
                ".ficha-editar-titular"
            );

        if (!boton) {
            return;
        }


        const reservaId =
            fichaReservaModal
                ?.dataset.reservaId;

        const numeroCabana =
            fichaReservaModal
                ?.dataset.numeroCabana;


        if (
            !reservaId ||
            !numeroCabana
        ) {
            return;
        }


        const registro =
            buscarDatosReservaPorId(
                reservaId
            );


        if (!registro?.cabana) {
            return;
        }


        const nombreActual =
            registro.cabana.titular || "";


        const respuesta =
            prompt(
                `Nuevo titular CAB ${numeroCabana}:`,
                nombreActual
            );


        if (respuesta === null) {
            return;
        }


        const nombreFinal =
            respuesta.trim();


        if (!nombreFinal) {

            alert(
                "El titular no puede quedar vacío."
            );

            return;
        }


        sincronizarDatosReserva(
            reservaId,
            numeroCabana,
            "titular",
            nombreFinal
        );


        const fichas =
            obtenerFichasReservas();


        if (!fichas[reservaId]) {
            fichas[reservaId] = {};
        }


        fichas[reservaId].titular =
            nombreFinal;


        guardarFichasReservas(
            fichas
        );

        if (
            typeof registrarActividadHaiku ===
            "function"
        ) {
            registrarActividadHaiku({
                tipo: "reserva",
                accion: "Titular de reserva modificado",
                reservaId,
                numeroCabana,
                titular: nombreFinal,
                cambios: [
                    {
                        campo: "Titular",
                        anterior: nombreActual,
                        nuevo: nombreFinal
                    }
                ]
            });
        }


        const titularFicha =
            document.getElementById(
                "ficha-huesped-titular"
            );

        const titularCabecera =
            document.getElementById(
                "ficha-reserva-titular"
            );


        if (titularFicha) {
            titularFicha.textContent =
                nombreFinal;
        }

        if (titularCabecera) {
            titularCabecera.textContent =
                nombreFinal;
        }


        if (
            typeof generarCalendario ===
            "function"
        ) {
            generarCalendario();
        }


        if (
            typeof cargarCabanasDia ===
            "function"
        ) {
            cargarCabanasDia(
                fechaSeleccionada
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
    }
);

// ==========================================
// COMPROBAR DISPONIBILIDAD AL CAMBIAR NOCHES
// ==========================================

function reservaPuedeCambiarNoches(
    reservaId,
    numeroCabana,
    fechaIngreso,
    nuevasNoches
) {

    const nuevaSalida =
        sumarDiasFecha(
            fechaIngreso,
            nuevasNoches
        );


    return !Object.entries(
        datosPorFecha
    ).some(
        ([fechaDia, datosDia]) => {

            const otraReserva =
                datosDia?.cabanas?.[
                    numeroCabana
                ];


            if (
                !otraReserva?.reservaId ||
                String(
                    otraReserva.reservaId
                ) === String(reservaId)
            ) {
                return false;
            }


            const otroIngreso =
                otraReserva
                    .fechaOrigenReserva ||
                otraReserva
                    .fechaIngresoReserva ||
                fechaDia;


            const otrasNoches =
                Number(
                    otraReserva.noches
                ) || 0;


            if (otrasNoches < 1) {
                return false;
            }


            const otraSalida =
                sumarDiasFecha(
                    otroIngreso,
                    otrasNoches
                );


            return (
                fechaIngreso < otraSalida &&
                nuevaSalida > otroIngreso
            );
        }
    );
}


// ==========================================
// QUITAR CONTINUIDADES ANTIGUAS
// ==========================================

function quitarContinuidadesReserva(
    reservaId,
    numeroCabana
) {

    Object.values(
        datosPorFecha
    ).forEach(datosDia => {

        const cabana =
            datosDia?.cabanas?.[
                numeroCabana
            ];


        if (
            !cabana ||
            String(cabana.reservaId) !==
                String(reservaId) ||
            cabana.continuidadAutomatica !==
                true
        ) {
            return;
        }


        const camposReserva = [

            "reservaId",
            "titular",
            "adultos",
            "ninos",
            "mascotas",

            "estado",
            "estadoIngresoReserva",

            "noches",
            "continuidadAutomatica",
            "fechaOrigenReserva",
            "fechaIngresoReserva",

            "correo",
            "telefono",
            "rut",
            "observaciones",

            "tarifasNoches",
            "totalReserva",

            "abono",
            "montoAbono",
            "abonoVerificado",
            "medioPago",

            "checkinRealizado",
            "checkinManual",
            "checkout",

            "checkinCobrado",
            "checkinMedio",
            "checkinFolio",
            "checkinCodAut",
            "checkinBove",
            "checkinManager",
            "checkinCompleto",

            "borradoManual",
            "editadoManual"
        ];


        camposReserva.forEach(
            campo => delete cabana[campo]
        );


        if (
            Object.keys(cabana).length === 0
        ) {

            delete datosDia.cabanas[
                numeroCabana
            ];
        }
    });
}


// ==========================================
// EDITAR NOCHES DESDE LA FICHA
// ==========================================

document.addEventListener(
    "click",
    evento => {

        const boton =
            evento.target.closest(
                ".ficha-editar-noches"
            );


        if (!boton) {
            return;
        }


        const reservaId =
            fichaReservaModal
                ?.dataset.reservaId;

        const numeroCabana =
            fichaReservaModal
                ?.dataset.numeroCabana;


        if (
            !reservaId ||
            !numeroCabana
        ) {
            return;
        }


        const registro =
            buscarDatosReservaPorId(
                reservaId
            );


        if (!registro?.cabana) {
            return;
        }


        const cabana =
            registro.cabana;

        const fechaIngreso =
            cabana.fechaOrigenReserva ||
            cabana.fechaIngresoReserva ||
            registro.fecha;


        const nochesActuales =
            Number(cabana.noches) || 1;

        const totalAnterior =
            Number(cabana.totalReserva || 0);


        const respuesta =
            prompt(
                `Noches CAB ${numeroCabana}:`,
                nochesActuales
            );


        if (respuesta === null) {
            return;
        }


        const nuevasNoches =
            Number.parseInt(
                respuesta.trim(),
                10
            );


        if (
            !Number.isInteger(
                nuevasNoches
            ) ||
            nuevasNoches < 1
        ) {

            alert(
                "Ingresa una cantidad válida de noches."
            );

            return;
        }


        if (
            nuevasNoches ===
            nochesActuales
        ) {
            return;
        }


        const rangoDisponible =
            reservaPuedeCambiarNoches(
                reservaId,
                numeroCabana,
                fechaIngreso,
                nuevasNoches
            );


        if (!rangoDisponible) {

            alert(
                "No es posible aumentar las noches porque la cabaña tiene otra reserva dentro de ese rango."
            );

            return;
        }


        const fichas =
            obtenerFichasReservas();

        const ficha =
            fichas[reservaId] || {};


        const tarifasAnteriores =
            cabana.tarifasNoches ||
            ficha.tarifasNoches ||
            {};


        let precioBase = 0;


        if (
            typeof catalogoCabanasReserva !==
                "undefined"
        ) {

            precioBase =
                Number(
                    catalogoCabanasReserva[
                        numeroCabana
                    ]?.precio
                ) || 0;
        }


        if (
            precioBase <= 0 &&
            nochesActuales > 0
        ) {

            precioBase =
                Math.round(
                    Number(
                        cabana.totalReserva ||
                        ficha.totalReserva ||
                        0
                    ) /
                    nochesActuales
                );
        }


        const nuevasTarifas = {};


        for (
            let indice = 0;
            indice < nuevasNoches;
            indice++
        ) {

            const fechaNoche =
                sumarDiasFecha(
                    fechaIngreso,
                    indice
                );


            nuevasTarifas[
                fechaNoche
            ] =

                Number(
                    tarifasAnteriores[
                        fechaNoche
                    ]
                ) ||

                precioBase;
        }


        const nuevoTotal =
            Object.values(
                nuevasTarifas
            ).reduce(
                (suma, tarifa) =>
                    suma + Number(tarifa),
                0
            );


        quitarContinuidadesReserva(
            reservaId,
            numeroCabana
        );


        cabana.noches =
            nuevasNoches;

        cabana.tarifasNoches =
            nuevasTarifas;

        cabana.totalReserva =
            nuevoTotal;


        guardarDatos();


        crearContinuidadesReserva(
            fechaIngreso,
            numeroCabana,
            nuevasNoches
        );


        ficha.noches =
            nuevasNoches;

        ficha.tarifasNoches =
            nuevasTarifas;

        ficha.totalReserva =
            nuevoTotal;


        fichas[reservaId] =
            ficha;


        guardarFichasReservas(
            fichas
        );

        if (
            typeof registrarActividadHaiku ===
            "function"
        ) {
            registrarActividadHaiku({
                tipo: "reserva",
                accion: "Cantidad de noches modificada",
                reservaId,
                numeroCabana,
                titular: cabana.titular || "",
                fechaOperacion: fechaIngreso,
                cambios: [
                    {
                        campo: "Noches",
                        anterior: nochesActuales,
                        nuevo: nuevasNoches
                    },
                    {
                        campo: "Total reserva",
                        anterior: totalAnterior,
                        nuevo: nuevoTotal
                    }
                ]
            });
        }


        const nuevaSalida =
            sumarDiasFecha(
                fechaIngreso,
                nuevasNoches
            );


        const campoNoches =
            document.getElementById(
                "ficha-reserva-noches"
            );

        const campoSalida =
            document.getElementById(
                "ficha-reserva-salida"
            );


        if (campoNoches) {

            campoNoches.textContent =
                nuevasNoches === 1
                    ? "◷ 1 noche"
                    : `◷ ${nuevasNoches} noches`;
        }


        if (campoSalida) {

            campoSalida.textContent =
                formatearFechaFicha(
                    nuevaSalida
                );
        }


        if (
            typeof cargarPagosFichaReserva ===
            "function"
        ) {

            cargarPagosFichaReserva(
                reservaId
            );
        }


        if (
            typeof generarCalendario ===
            "function"
        ) {
            generarCalendario();
        }


        if (
            typeof cargarCabanasDia ===
            "function"
        ) {
            cargarCabanasDia(
                fechaSeleccionada
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
    }
);

// ======================================
// COPIAR RESUMEN DEL DÍA
// ======================================

const botonCopiarResumen = document.getElementById("copiar-resumen-dia");

if (botonCopiarResumen) {
    botonCopiarResumen.addEventListener("click", async () => {

        const resumen =
            document.getElementById("resumen-dia-texto")?.textContent.trim() || "";

        const mantencion =
            document.getElementById("resumen-mantencion")?.value.trim() || "";

        const lavanderia =
            document.getElementById("resumen-lavanderia")?.value.trim() || "";

        const partes = [resumen];

        if (mantencion) {
            partes.push(`MANTENCIÓN\n${mantencion}`);
        }

        if (lavanderia) {
            partes.push(`LAVANDERÍA\n${lavanderia}`);
        }

        const textoFinal = partes.join("\n\n");

        try {
            await navigator.clipboard.writeText(textoFinal);

            const textoOriginal = botonCopiarResumen.textContent;
            botonCopiarResumen.textContent = "✓ Resumen copiado";

            setTimeout(() => {
                botonCopiarResumen.textContent = textoOriginal;
            }, 2000);

        } catch (error) {
            console.error("No se pudo copiar el resumen:", error);
        }
    });
}

// ======================================
// RESUMEN RÁPIDO AL MANTENER PRESIONADO
// ======================================

const configuracionResumenRapido = [
    {
        contador: "contador-ingresan",
        tipo: "ingresan",
        titulo: "Ingresan"
    },
    {
        contador: "contador-salen",
        tipo: "salen",
        titulo: "Salen"
    },
    {
        contador: "contador-continuan",
        tipo: "continuan",
        titulo: "Continúan"
    },
    {
        contador: "contador-servicios",
        tipo: "servicios",
        titulo: "Servicios"
    },
    {
        contador: "contador-pagos",
        tipo: "pagos",
        titulo: "Pagos pendientes"
    }
];

let resumenRapidoTarjetaActiva = null;
let resumenRapidoTemporizador = null;
let resumenRapidoPointerId = null;

function obtenerReservaQueSale(
    numeroCabana,
    fecha
) {

    const reservasRevisadas =
        new Set();

    for (
        const datosDia of
        Object.values(datosPorFecha)
    ) {

        const cabanaDia =
            datosDia?.cabanas?.[numeroCabana];

        const reservaId =
            cabanaDia?.reservaId || "";

        if (
            !reservaId ||
            reservasRevisadas.has(reservaId)
        ) {
            continue;
        }

        reservasRevisadas.add(reservaId);

        const registro =
            typeof buscarDatosReservaPorId ===
                "function"
                ? buscarDatosReservaPorId(
                    reservaId
                )
                : null;

        const cabanaReserva =
            registro?.cabana || cabanaDia;

        const fechaIngreso =
            cabanaReserva.fechaOrigenReserva ||
            cabanaReserva.fechaIngresoReserva ||
            registro?.fecha ||
            "";

        const noches =
            Number(cabanaReserva.noches) || 0;

        if (!fechaIngreso || noches < 1) {
            continue;
        }

        if (
            calcularSalidaReserva(
                fechaIngreso,
                noches
            ) === fecha
        ) {
            return cabanaReserva;
        }
    }

    return null;
}

function crearTextoReservaResumenRapido(
    numeroCabana,
    cabana
) {

    const titular =
        cabana?.titular ||
        cabana?.nombre ||
        cabana?.huesped ||
        "Sin titular";

    const noches =
        Number(cabana?.noches) || 0;

    const esFullDay =
        cabana?.estado === "fullday";

    const duracion =
        esFullDay
            ? "Full Day"
            : `${noches}N`;

    return (
        `CAB ${numeroCabana} · ` +
        `${titular} · ${duracion}`
    );
}

function obtenerLineasResumenRapido(tipo) {

    if (!fechaSeleccionada) {
        return [];
    }

    const datos =
        obtenerDatosDia(fechaSeleccionada);

    const cabanasOrdenadas =
        Object.entries(datos?.cabanas || {})
            .sort(
                ([numeroA], [numeroB]) =>
                    Number(numeroA) -
                    Number(numeroB)
            );

    if (
        tipo === "ingresan" ||
        tipo === "salen" ||
        tipo === "continuan"
    ) {

        return cabanasOrdenadas
            .filter(([, cabana]) => {

                const estado =
                    cabana?.estado || "";

                if (tipo === "ingresan") {
                    return (
                        estado ===
                            "libre-ingresa" ||
                        estado ===
                            "sale-ingresa" ||
                        estado === "fullday"
                    );
                }

                if (tipo === "salen") {
                    return (
                        estado === "sale-libre" ||
                        estado === "sale-ingresa" ||
                        estado === "fullday"
                    );
                }

                return estado === "continua";
            })
            .map(([numeroCabana, cabana]) => {

                let cabanaMostrada = cabana;

                if (
                    tipo === "salen" &&
                    cabana?.estado !== "fullday"
                ) {
                    cabanaMostrada =
                        obtenerReservaQueSale(
                            numeroCabana,
                            fechaSeleccionada
                        ) || cabana;
                }

                return crearTextoReservaResumenRapido(
                    numeroCabana,
                    cabanaMostrada
                );
            });
    }

    if (tipo === "servicios") {

        const servicios =
            JSON.parse(
                localStorage.getItem(
                    "haikuServicios"
                )
            ) || [];

        return servicios
            .filter(servicio =>
                servicio.fechaServicio ===
                    fechaSeleccionada
            )
            .sort((servicioA, servicioB) => {

                const horaA =
                    servicioA.hora || "";

                const horaB =
                    servicioB.hora || "";

                return horaA.localeCompare(horaB);
            })
            .map(servicio => {

                const numeroCabana =
                    servicio.numeroCabana || "—";

                const titular =
                    servicio.titular ||
                    datos.cabanas?.[numeroCabana]
                        ?.titular ||
                    "Sin titular";

                const nombre =
                    servicio.nombre ||
                    "Servicio";

                const hora =
                    servicio.hora
                        ? ` · ${servicio.hora}`
                        : "";

                return (
                    `CAB ${numeroCabana} · ` +
                    `${titular} · ${nombre}${hora}`
                );
            });
    }

    if (
        tipo === "pagos" &&
        typeof obtenerPagosPendientes ===
            "function"
    ) {

        return obtenerPagosPendientes(
            fechaSeleccionada
        ).map(pago => {

            const monto =
                Number(pago.monto) > 0
                    ? ` · $${Number(
                        pago.monto
                    ).toLocaleString("es-CL")}`
                    : "";

            return (
                `CAB ${pago.numeroCabana} · ` +
                `${pago.titular} · ` +
                `${pago.titulo}${monto}`
            );
        });
    }

    return [];
}

function llenarPanelResumenRapido(
    tarjeta,
    tipo,
    titulo
) {

    const panel =
        tarjeta.querySelector(
            ".tarjeta-resumen-rapido-panel"
        );

    const lista =
        panel?.querySelector(
            ".tarjeta-resumen-rapido-lista"
        );

    const etiqueta =
        panel?.querySelector(
            ".tarjeta-resumen-rapido-etiqueta"
        );

    const conteo =
        panel?.querySelector(
            ".tarjeta-resumen-rapido-conteo"
        );

    if (!panel || !lista || !etiqueta || !conteo) {
        return;
    }

    const lineas =
        obtenerLineasResumenRapido(tipo);

    etiqueta.textContent = titulo;
    conteo.textContent = String(lineas.length);

    lista.innerHTML = "";

    if (lineas.length === 0) {

        const vacio =
            document.createElement("span");

        vacio.className =
            "tarjeta-resumen-rapido-vacio";

        vacio.textContent =
            "Sin registros para este día.";

        lista.appendChild(vacio);
        return;
    }

    lineas.forEach(textoLinea => {

        const partes = String(textoLinea)
            .split("·")
            .map(parte => parte.trim())
            .filter(Boolean);

        const linea =
            document.createElement("div");

        linea.className =
            "tarjeta-resumen-rapido-linea";

        const cabana = document.createElement("span");
        cabana.className = "tarjeta-resumen-rapido-cabana";
        cabana.textContent = partes.shift() || "DETALLE";

        const contenido = document.createElement("span");
        contenido.className = "tarjeta-resumen-rapido-contenido";

        const principal = document.createElement("strong");
        principal.className = "tarjeta-resumen-rapido-principal";
        principal.textContent = partes.shift() || "Sin titular";
        contenido.appendChild(principal);

        if (partes.length > 0) {
            const meta = document.createElement("small");
            meta.className = "tarjeta-resumen-rapido-meta";
            meta.textContent = partes.join(" · ");
            contenido.appendChild(meta);
        }

        linea.appendChild(cabana);
        linea.appendChild(contenido);

        lista.appendChild(linea);
    });
}

function cerrarResumenRapido() {

    if (resumenRapidoTemporizador) {
        clearTimeout(
            resumenRapidoTemporizador
        );
    }

    resumenRapidoTemporizador = null;

    if (resumenRapidoTarjetaActiva) {

        const panel =
            resumenRapidoTarjetaActiva
                .querySelector(
                    ".tarjeta-resumen-rapido-panel"
                );

        if (panel) {
            panel.hidden = true;
        }

        resumenRapidoTarjetaActiva
            .classList.remove(
                "tarjeta-resumen-rapido-activa",
                "tarjeta-resumen-rapido-esperando"
            );
    }

    resumenRapidoTarjetaActiva = null;
    resumenRapidoPointerId = null;
}

function iniciarResumenRapido(
    tarjeta,
    configuracion,
    evento
) {

    if (
        evento.pointerType === "mouse" &&
        evento.button !== 0
    ) {
        return;
    }

    cerrarResumenRapido();

    resumenRapidoTarjetaActiva = tarjeta;
    resumenRapidoPointerId =
        evento.pointerId;

    tarjeta.setPointerCapture?.(evento.pointerId);

    tarjeta.classList.add(
        "tarjeta-resumen-rapido-esperando"
    );

    resumenRapidoTemporizador =
        setTimeout(() => {

            if (
                resumenRapidoTarjetaActiva !==
                tarjeta
            ) {
                return;
            }

            llenarPanelResumenRapido(
                tarjeta,
                configuracion.tipo,
                configuracion.titulo
            );

            const panel =
                tarjeta.querySelector(
                    ".tarjeta-resumen-rapido-panel"
                );

            if (panel) {
                panel.hidden = false;
            }

            tarjeta.classList.remove(
                "tarjeta-resumen-rapido-esperando"
            );

            tarjeta.classList.add(
                "tarjeta-resumen-rapido-activa"
            );

        }, 450);
}

function inicializarResumenRapido() {

    configuracionResumenRapido
        .forEach(configuracion => {

            const contador =
                document.getElementById(
                    configuracion.contador
                );

            const tarjeta =
                contador?.closest(".tarjeta");

            if (!tarjeta) {
                return;
            }

            tarjeta.classList.add(
                "tarjeta-resumen-rapido"
            );

            tarjeta.dataset.resumenRapido =
                configuracion.tipo;

            tarjeta.setAttribute(
                "aria-label",
                `${configuracion.titulo}. ` +
                "Mantén presionado para ver el detalle."
            );

            tarjeta.setAttribute("role", "button");
            tarjeta.tabIndex = 0;
            tarjeta.title = "Mantén presionado para ver el detalle";

            const panel =
                document.createElement("div");

            panel.className =
                "tarjeta-resumen-rapido-panel";

            panel.hidden = true;

            const titulo =
                document.createElement("div");

            titulo.className =
                "tarjeta-resumen-rapido-titulo";

            const etiqueta =
                document.createElement("span");

            etiqueta.className =
                "tarjeta-resumen-rapido-etiqueta";

            const conteo =
                document.createElement("span");

            conteo.className =
                "tarjeta-resumen-rapido-conteo";

            titulo.appendChild(etiqueta);
            titulo.appendChild(conteo);

            const lista =
                document.createElement("div");

            lista.className =
                "tarjeta-resumen-rapido-lista";

            panel.appendChild(titulo);
            panel.appendChild(lista);
            tarjeta.appendChild(panel);

            tarjeta.addEventListener(
                "pointerdown",
                evento => {
                    iniciarResumenRapido(
                        tarjeta,
                        configuracion,
                        evento
                    );
                }
            );

            tarjeta.addEventListener(
                "contextmenu",
                evento => {
                    evento.preventDefault();
                }
            );

            tarjeta.addEventListener(
                "dragstart",
                evento => {
                    evento.preventDefault();
                }
            );

            tarjeta.addEventListener(
                "keydown",
                evento => {
                    if (
                        evento.repeat ||
                        !["Enter", " "].includes(evento.key)
                    ) {
                        return;
                    }

                    evento.preventDefault();
                    cerrarResumenRapido();
                    resumenRapidoTarjetaActiva = tarjeta;
                    llenarPanelResumenRapido(
                        tarjeta,
                        configuracion.tipo,
                        configuracion.titulo
                    );
                    panel.hidden = false;
                    tarjeta.classList.add(
                        "tarjeta-resumen-rapido-activa"
                    );
                }
            );

            tarjeta.addEventListener(
                "keyup",
                evento => {
                    if (["Enter", " "].includes(evento.key)) {
                        cerrarResumenRapido();
                    }
                }
            );
        });

    document.addEventListener(
        "pointerup",
        evento => {

            if (
                evento.pointerId ===
                resumenRapidoPointerId
            ) {
                cerrarResumenRapido();
            }
        }
    );

    document.addEventListener(
        "pointercancel",
        cerrarResumenRapido
    );

    window.addEventListener(
        "blur",
        cerrarResumenRapido
    );
}

inicializarResumenRapido();
