// ========================================
// BASE DE DATOS DE EVIDENCIAS
// IndexedDB
// ========================================

let dbEvidencias = null;

function abrirDBEvidencias() {

    return new Promise((resolve, reject) => {

        const request = indexedDB.open("haikuEvidencias", 1);

        request.onupgradeneeded = (event) => {

            const db = event.target.result;

            if (!db.objectStoreNames.contains("imagenes")) {
                db.createObjectStore("imagenes");
            }
        };

        request.onsuccess = (event) => {
            dbEvidencias = event.target.result;
            resolve(dbEvidencias);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}


async function guardarEvidencia(fecha, nombre, imagen) {

    if (!dbEvidencias) {
        await abrirDBEvidencias();
    }

    const clave = `${fecha}_${nombre}`;

    const transaction = dbEvidencias.transaction(
        "imagenes",
        "readwrite"
    );

    transaction
        .objectStore("imagenes")
        .put(imagen, clave);
}


async function obtenerEvidencia(fecha, nombre) {

    if (!dbEvidencias) {
        await abrirDBEvidencias();
    }

    const clave = `${fecha}_${nombre}`;

    return new Promise((resolve, reject) => {

        const transaction = dbEvidencias.transaction(
            "imagenes",
            "readonly"
        );

        const request = transaction
            .objectStore("imagenes")
            .get(clave);

        request.onsuccess = () => {
            resolve(request.result || null);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// ========================================
// CIERRE DE TURNO
// ========================================

// Obtener / crear los datos de cierre del día
function obtenerCierreDia(fecha) {

    const datos = obtenerDatosDia(fecha);

    if (!datos.cierre) {

        datos.cierre = {

            // =========================
            // ETAPA 1
            // =========================

            salidaTemprana: "",
            salioAntes: "",
            llavesRetiradas: "",
            registroGuardado: false,
            reservaMarcada: false,
            pagoRegistrado: false,
            // MANAGER
            managerPagos: false,
            managerCaja: false,
            managerValeSalida: false,

            // =========================
            // ETAPA 2
            // =========================

            detallesCabanas: "",
            pendientesHacer: "",
            hayNovedades: "",
            novedades: "",

            // =========================
            // ETAPA 3 · TINAJAS
            // =========================

            tinajaTonelApagado: false,
            tinajaJacuzziApagado: false,
            tinajaTonelFuncionamiento: false,
            tinajaJacuzziFuncionamiento: false,
            tinajaCojinesRetirados: false,

            // =========================
            // ETAPA 4 · CABAÑAS
            // =========================

            cabanasCierre: {}
        };
    }

    // Compatibilidad con días guardados anteriormente
    if (!datos.cierre.cabanasCierre) {
        datos.cierre.cabanasCierre = {};
    }

    // Conectar Mantención y Lavandería con los datos generales del día
    if (!datos.mantencion) {
    datos.mantencion = [];
    }

    if (!datos.lavanderia) {
    datos.lavanderia = [];
    }

    return datos.cierre;
}

// ========================================
// CARGAR VISUALMENTE EL CIERRE DEL DÍA
// ========================================

function cargarCierreDia(fecha) {

    const cierre = obtenerCierreDia(fecha);
    const datos = obtenerDatosDia(fecha);

    // ----------------
    // RADIOS
    // ----------------

    const radios = [
    // ETAPA 1
    ["salida-temprana", cierre.salidaTemprana],
    ["salio-antes", cierre.salioAntes],
    ["llaves-retiradas", cierre.llavesRetiradas],

    // ETAPA 2
    ["detalles-cabanas", cierre.detallesCabanas],
    ["pendientes-hacer", cierre.pendientesHacer],
    ["hay-novedades", cierre.hayNovedades]
];

    radios.forEach(([nombre, valor]) => {

        if (!valor) return;

        const radio = document.querySelector(
            `input[name="${nombre}"][value="${valor}"]`
        );

        if (radio) {
            radio.checked = true;
        }

    });


    // ----------------
    // CHECKBOXES
    // ----------------

    const registro = document.querySelector(
        '[data-cierre-campo="registro-guardado"]'
    );

    const reserva = document.querySelector(
        '[data-cierre-campo="reserva-marcada"]'
    );

    const pago = document.querySelector(
        '[data-cierre-campo="pago-registrado"]'
    );

    // ==========================
    // MANAGER
    // ==========================

    const managerPagos = document.querySelector(
    '[data-cierre-campo="manager-pagos"]'
    );

    const managerCaja = document.querySelector(
    '[data-cierre-campo="manager-caja"]'
    );

    const managerValeSalida = document.querySelector(
    '[data-cierre-campo="manager-vale-salida"]'
    );


    if (registro) {
        registro.checked = cierre.registroGuardado === true;
    }

    if (reserva) {
        reserva.checked = cierre.reservaMarcada === true;
    }

    if (pago) {
        pago.checked = cierre.pagoRegistrado === true;
    
    // ==============================
// CARGAR LLAVES DE RECEPCIÓN
// ==============================

const checksLlavesRecepcionCargar = document.querySelectorAll(
    '[data-cierre-llave]'
);

checksLlavesRecepcionCargar.forEach(check => {
    const llave = check.dataset.cierreLlave;

    check.checked =
        cierre.llavesRecepcion?.[llave] === true;
});

    if (managerPagos) {
    managerPagos.checked = cierre.managerPagos === true;
    }

    if (managerCaja) {
    managerCaja.checked = cierre.managerCaja === true;
    }

    if (managerValeSalida) {
    managerValeSalida.checked = cierre.managerValeSalida === true;
    }
    
        // =========================
// CHECKBOXES ETAPA 3 - TINAJAS
// =========================

const tonelApagado = document.querySelector(
    '[data-cierre-campo="tinaja-tonel-apagado"]'
);

const jacuzziApagado = document.querySelector(
    '[data-cierre-campo="tinaja-jacuzzi-apagado"]'
);

const tonelFuncionamiento = document.querySelector(
    '[data-cierre-campo="tinaja-tonel-funcionamiento"]'
);

const jacuzziFuncionamiento = document.querySelector(
    '[data-cierre-campo="tinaja-jacuzzi-funcionamiento"]'
);

const cojinesRetirados = document.querySelector(
    '[data-cierre-campo="tinaja-cojines-retirados"]'
);

if (tonelApagado) {
    tonelApagado.checked = cierre.tinajaTonelApagado === true;
}

if (jacuzziApagado) {
    jacuzziApagado.checked = cierre.tinajaJacuzziApagado === true;
}

if (tonelFuncionamiento) {
    tonelFuncionamiento.checked =
        cierre.tinajaTonelFuncionamiento === true;
}

if (jacuzziFuncionamiento) {
    jacuzziFuncionamiento.checked =
        cierre.tinajaJacuzziFuncionamiento === true;
}

if (cojinesRetirados) {
    cojinesRetirados.checked =
        cierre.tinajaCojinesRetirados === true;
}
    }

    // ----------------
    // TEXTAREA ETAPA 2
    // ----------------

    const novedades = document.querySelector(
        '[data-cierre-campo="novedades"]'
    );

    if (novedades) {
        novedades.value = cierre.novedades || "";
    }
    
    // ===============================
// CARGAR ETAPA 4 - CABAÑAS
// ===============================

// Cargar checks internos de cada cabaña
const checksCabanas = document.querySelectorAll(
    '[data-cierre-cabana][data-item]'
);

checksCabanas.forEach(check => {

    const cabana = check.dataset.cierreCabana;
    const item = check.dataset.item;

    const datosCabana = cierre.cabanasCierre?.[cabana];

    check.checked = datosCabana?.[item] === true;
});


// Cargar "Ocupada / No revisar"
const checksOcupadas = document.querySelectorAll(
    '[data-cierre-cabana-ocupada]'
);

checksOcupadas.forEach(check => {

    const cabana = check.dataset.cierreCabanaOcupada;

    const datosCabana = cierre.cabanasCierre?.[cabana];

    check.checked = datosCabana?.ocupada === true;
});

// ========================================
// CARGAR EVIDENCIAS GUARDADAS
// ========================================

document.querySelectorAll("[data-evidencia-preview]").forEach(async (preview) => {

    const nombre = preview.dataset.evidenciaPreview;

    const imagenGuardada = await obtenerEvidencia(fecha, nombre);

    if (imagenGuardada) {

    preview.innerHTML = "";

    const imagen = document.createElement("img");

    imagen.src = imagenGuardada;
    imagen.alt = "Evidencia guardada";

    preview.appendChild(imagen);

    prepararToggleEvidencia(preview);
preview.style.display = "none";

const botonToggle = preview.previousElementSibling;

if (botonToggle?.classList.contains("cierre-evidencia-toggle")) {
    botonToggle.textContent = "▸ Abrir evidencia";
}

    // Mantener abierto el bloque de evidencia
    const bloqueEvidencia = preview.closest("[data-evidencia]");

    if (bloqueEvidencia) {
        bloqueEvidencia.hidden = false;
    }

} else {

    preview.innerHTML = "";
    preview.style.display = "none";

}
});

// Cargar información general del día
cargarResumenMantencionLavanderia(datos);

}

// ========================================
// RESUMEN AUTOMÁTICO: MANTENCIÓN Y LAVANDERÍA
// ========================================

function cargarResumenMantencionLavanderia(datos) {

    const mantenciones = datos.mantencion || [];
    const lavanderia = datos.lavanderia || [];

    console.log("Mantenciones del día:", mantenciones);
    console.log("Lavandería del día:", lavanderia);

}

// ========================================
// CONTROLES ETAPA 1
// ========================================

const radiosSalidaTemprana =
    document.querySelectorAll('input[name="salida-temprana"]');

const radiosSalioAntes =
    document.querySelectorAll('input[name="salio-antes"]');

const radiosLlavesRetiradas =
    document.querySelectorAll('input[name="llaves-retiradas"]');

const checkRegistroGuardado =
    document.querySelector('[data-cierre-campo="registro-guardado"]');

const checkReservaMarcada =
    document.querySelector('[data-cierre-campo="reserva-marcada"]');

const checkPagoRegistrado =
    document.querySelector('[data-cierre-campo="pago-registrado"]');

    // =========================================
// CONTROLES ETAPA 2
// =========================================

const detallesCabanasInputs =
    document.querySelectorAll('input[name="detalles-cabanas"]');

const pendientesHacerInputs =
    document.querySelectorAll('input[name="pendientes-hacer"]');

const hayNovedadesInputs =
    document.querySelectorAll('input[name="hay-novedades"]');

const novedadesInput =
    document.querySelector('[data-cierre-campo="novedades"]');

// =========================
// CONTROLES ETAPA 3 · TINAJAS
// =========================

const checkTinajaTonelApagado =
    document.querySelector(
        '[data-cierre-campo="tinaja-tonel-apagado"]'
    );

const checkTinajaJacuzziApagado =
    document.querySelector(
        '[data-cierre-campo="tinaja-jacuzzi-apagado"]'
    );

const checkTinajaTonelFuncionamiento =
    document.querySelector(
        '[data-cierre-campo="tinaja-tonel-funcionamiento"]'
    );

const checkTinajaJacuzziFuncionamiento =
    document.querySelector(
        '[data-cierre-campo="tinaja-jacuzzi-funcionamiento"]'
    );

const checkTinajaCojinesRetirados =
    document.querySelector(
        '[data-cierre-campo="tinaja-cojines-retirados"]'
    );


// ========================================
// GUARDAR RADIO BUTTON
// ========================================

function guardarRadioCierre(nombre, campo) {

    const radios =
        document.querySelectorAll(`input[name="${nombre}"]`);

    radios.forEach(radio => {

        radio.addEventListener("change", () => {

            if (!fechaSeleccionada) {
                return;
            }

            const cierre =
                obtenerCierreDia(fechaSeleccionada);

            cierre[campo] = radio.value;

            guardarDatos();

            actualizarCierreTurno();
        });

    });
}


// ========================================
// GUARDAR CHECKBOX
// ========================================

function guardarCheckCierre(elemento, campo) {

    if (!elemento) {
        return;
    }

    elemento.addEventListener("change", () => {

        if (!fechaSeleccionada) {
            return;
        }

        const cierre =
            obtenerCierreDia(fechaSeleccionada);

        cierre[campo] = elemento.checked;

        guardarDatos();

        actualizarCierreTurno();
    });
}


// ========================================
// ACTIVAR GUARDADO ETAPA 1
// ========================================

guardarRadioCierre(
    "salida-temprana",
    "salidaTemprana"
);

guardarRadioCierre(
    "salio-antes",
    "salioAntes"
);

guardarRadioCierre(
    "llaves-retiradas",
    "llavesRetiradas"
);

guardarCheckCierre(
    checkRegistroGuardado,
    "registroGuardado"
);

guardarCheckCierre(
    checkReservaMarcada,
    "reservaMarcada"
);

guardarCheckCierre(
    checkPagoRegistrado,
    "pagoRegistrado"
);

// ==============================
// GUARDAR LLAVES DE RECEPCIÓN
// ==============================

const checksLlavesRecepcion = document.querySelectorAll(
    '[data-cierre-llave]'
);

checksLlavesRecepcion.forEach(check => {

    check.addEventListener("change", () => {

        if (!fechaSeleccionada) {
            return;
        }

        const llave = check.dataset.cierreLlave;

        const cierre = obtenerCierreDia(fechaSeleccionada);

        if (!cierre.llavesRecepcion) {
            cierre.llavesRecepcion = {};
        }

        cierre.llavesRecepcion[llave] = check.checked;

        guardarDatos();
        actualizarCierreTurno();
    });

});

// ==========================
// GUARDAR MANAGER
// ==========================

guardarCheckCierre(
    document.querySelector('[data-cierre-campo="manager-pagos"]'),
    "managerPagos"
);

guardarCheckCierre(
    document.querySelector('[data-cierre-campo="manager-caja"]'),
    "managerCaja"
);

guardarCheckCierre(
    document.querySelector('[data-cierre-campo="manager-vale-salida"]'),
    "managerValeSalida"
);

// =========================================
// ACTIVAR GUARDADO ETAPA 2
// =========================================

guardarRadioCierre(
    "detalles-cabanas",
    "detallesCabanas"
);

guardarRadioCierre(
    "pendientes-hacer",
    "pendientesHacer"
);

guardarRadioCierre(
    "hay-novedades",
    "hayNovedades"
);

if (novedadesInput) {

    novedadesInput.addEventListener("input", () => {

        if (!fechaSeleccionada) {
            return;
        }

        const cierre =
            obtenerCierreDia(fechaSeleccionada);

        cierre.novedades =
            novedadesInput.value;

        guardarDatos();

        actualizarCierreTurno();

    });

}

// =========================
// ACTIVAR GUARDADO ETAPA 3
// =========================

guardarCheckCierre(
    checkTinajaTonelApagado,
    "tinajaTonelApagado"
);

guardarCheckCierre(
    checkTinajaJacuzziApagado,
    "tinajaJacuzziApagado"
);

guardarCheckCierre(
    checkTinajaTonelFuncionamiento,
    "tinajaTonelFuncionamiento"
);

guardarCheckCierre(
    checkTinajaJacuzziFuncionamiento,
    "tinajaJacuzziFuncionamiento"
);

guardarCheckCierre(
    checkTinajaCojinesRetirados,
    "tinajaCojinesRetirados"
);

// ===============================
// ACTIVAR GUARDADO ETAPA 4
// CABAÑAS
// ===============================

const checksCabanasCierre = document.querySelectorAll(
    '[data-cierre-cabana][data-item]'
);

checksCabanasCierre.forEach(check => {

    check.addEventListener("change", () => {

        if (!fechaSeleccionada) {
            return;
        }

        const cabana = check.dataset.cierreCabana;
        const item = check.dataset.item;

        const cierre = obtenerCierreDia(fechaSeleccionada);

        // Crear la cabaña si todavía no existe
        if (!cierre.cabanasCierre[cabana]) {
            cierre.cabanasCierre[cabana] = {};
        }

        // Guardar el estado del checkbox
        cierre.cabanasCierre[cabana][item] = check.checked;

        guardarDatos();

        actualizarCierreTurno();
    });

});

// ===============================
// CABAÑA OCUPADA / NO REVISAR
// ===============================

const checksCabanasOcupadas = document.querySelectorAll(
    '[data-cierre-cabana-ocupada]'
);

checksCabanasOcupadas.forEach(check => {

    check.addEventListener("change", () => {

        if (!fechaSeleccionada) {
            return;
        }

        const cabana = check.dataset.cierreCabanaOcupada;

        const cierre = obtenerCierreDia(fechaSeleccionada);

        // Crear la cabaña si todavía no existe
        if (!cierre.cabanasCierre[cabana]) {
            cierre.cabanasCierre[cabana] = {};
        }

        // Guardar si está ocupada
        cierre.cabanasCierre[cabana].ocupada = check.checked;

        guardarDatos();

        actualizarCierreTurno();
    });

});

// ========================================
// EVIDENCIAS - MOSTRAR AL MARCAR CHECK
// ========================================

const checksEvidencia = document.querySelectorAll(
    "[data-evidencia-check]"
);

checksEvidencia.forEach(check => {

    check.addEventListener("change", () => {

        const nombre = check.dataset.evidenciaCheck;

        const evidencia = document.querySelector(
            `[data-evidencia="${nombre}"]`
        );

        if (!evidencia) return;

        // Mostrar evidencia cuando el check está marcado
        evidencia.hidden = !check.checked;

        // El botón compacto recibe el pegado por teclado.
        if (check.checked) {
            evidencia.querySelector(`[data-evidencia-pegar="${nombre}"]`)?.focus();
        }

    });

});

// ========================================
// EVIDENCIAS - SUBIR IMAGEN
// ========================================

const inputsEvidencia = document.querySelectorAll(
    "[data-evidencia-input]"
);

inputsEvidencia.forEach(input => {

    input.addEventListener("change", () => {

        const archivo = input.files[0];

        if (!archivo) return;

        // Solo aceptar imágenes
        if (!archivo.type.startsWith("image/")) {
            alert("Selecciona un archivo de imagen.");
            input.value = "";
            return;
        }

        const nombre = input.dataset.evidenciaInput;

        const preview = document.querySelector(
            `[data-evidencia-preview="${nombre}"]`
        );

        if (!preview) return;

        const lector = new FileReader();

        lector.onload = async () => {

    preview.innerHTML = "";

    const imagen = document.createElement("img");

    imagen.src = lector.result;
    imagen.alt = "Evidencia adjunta";

    preview.appendChild(imagen);

    // GUARDAR IMAGEN POR FECHA
    await guardarEvidencia(
        fechaSeleccionada,
        nombre,
        lector.result
    );
    window.dispatchEvent(new CustomEvent("haiku:cierre-evidencia-guardada", {
        detail: { fecha: fechaSeleccionada, nombre }
    }));

    prepararToggleEvidencia(preview);
preview.style.display = "block";

const botonToggle = preview.previousElementSibling;

if (botonToggle?.classList.contains("cierre-evidencia-toggle")) {
    botonToggle.textContent = "▾ Cerrar evidencia";
}

    // Mantener abierto el bloque de evidencia
    const bloqueEvidencia =
        preview.closest("[data-evidencia]");

    if (bloqueEvidencia) {
        bloqueEvidencia.hidden = false;
    }
};

        lector.readAsDataURL(archivo);

    });

});

// ========================================
// EVIDENCIAS - PEGAR IMAGEN DESDE EL CONTROL COMPACTO
// ========================================

const botonesPegarEvidencia = document.querySelectorAll(
    "[data-evidencia-pegar]"
);

botonesPegarEvidencia.forEach(boton => {
    boton.addEventListener("click", () => boton.focus());
    boton.addEventListener("paste", (evento) => {

        const items = evento.clipboardData?.items;

        if (!items) return;

        for (const item of items) {

            if (!item.type.startsWith("image/")) {
                continue;
            }

            evento.preventDefault();

            const archivo = item.getAsFile();

            if (!archivo) return;

            const nombre = boton.dataset.evidenciaPegar;

            const preview = document.querySelector(
                `[data-evidencia-preview="${nombre}"]`
            );

            if (!preview) return;

            const lector = new FileReader();

            lector.onload = () => {

                preview.innerHTML = "";

                const imagen = document.createElement("img");

                imagen.src = lector.result;
                imagen.alt = "Evidencia pegada";

                preview.appendChild(imagen);
                
                // GUARDAR IMAGEN POR FECHA
                Promise.resolve(guardarEvidencia(fechaSeleccionada, nombre, lector.result))
                    .then(() => window.dispatchEvent(new CustomEvent("haiku:cierre-evidencia-guardada", {
                        detail: { fecha: fechaSeleccionada, nombre }
                    })), () => {});

                // Mostrar el preview
                prepararToggleEvidencia(preview);
                preview.style.display = "block";

                const botonToggle = preview.previousElementSibling;

                if (botonToggle?.classList.contains("cierre-evidencia-toggle")) {
                botonToggle.textContent = "▾ Cerrar evidencia";
                }
            };

            lector.readAsDataURL(archivo);

            break;
        }
    });
});


// ========================================
// ACTUALIZAR PROGRESO DEL CIERRE
// ========================================

function actualizarCierreTurno() {

    if (!fechaSeleccionada) {
        return;
    }

    const cierre =
        obtenerCierreDia(fechaSeleccionada);
        
    console.log("DATOS CIERRE:", cierre);

    // ========================================
    // ETAPA 1
    // ========================================

    const controlesEtapa1 = [
        cierre.salidaTemprana === "si" || cierre.salidaTemprana === "no-hay",
        cierre.salioAntes === "si" || cierre.salioAntes === "no",
        cierre.llavesRetiradas === "si" ||
        cierre.llavesRetiradas === "no" ||
        cierre.llavesRetiradas === "no-aplica",
        cierre.registroGuardado === true,
        cierre.reservaMarcada === true,
        cierre.pagoRegistrado === true
    ];

    const completados =
        controlesEtapa1.filter(Boolean).length;

    const total =
        controlesEtapa1.length;

    const porcentaje =
        Math.round((completados / total) * 100);

    console.log(
        `Cierre Etapa 1: ${completados}/${total} - ${porcentaje}%`
    );

    // =========================================
// ETAPA 2
// =========================================

const controlesEtapa2 = [

    cierre.detallesCabanas === "si" ||
    cierre.detallesCabanas === "pendientes",

    cierre.pendientesHacer === "si" ||
    cierre.pendientesHacer === "no",

    cierre.hayNovedades === "no" ||
    cierre.hayNovedades === "si"

];

const completadosEtapa2 =
    controlesEtapa2.filter(Boolean).length;

const totalEtapa2 =
    controlesEtapa2.length;

const porcentajeEtapa2 =
    Math.round(
        (completadosEtapa2 / totalEtapa2) * 100
    );

console.log(
    `Cierre Etapa 2: ${completadosEtapa2}/${totalEtapa2} - ${porcentajeEtapa2}%`
);

// =========================
// ETAPA 3 - TINAJAS
// =========================

const controlesEtapa3 = [
    cierre.tinajaTonelApagado === true,
    cierre.tinajaJacuzziApagado === true,
    cierre.tinajaTonelFuncionamiento === true,
    cierre.tinajaJacuzziFuncionamiento === true,
    cierre.tinajaCojinesRetirados === true
];

const completadosEtapa3 =
    controlesEtapa3.filter(Boolean).length;

const totalEtapa3 =
    controlesEtapa3.length;

const porcentajeEtapa3 =
    Math.round((completadosEtapa3 / totalEtapa3) * 100);

console.log(
    `Cierre Etapa 3: ${completadosEtapa3}/${totalEtapa3} - ${porcentajeEtapa3}%`
);

// ============================
// ETAPA 4 - CABAÑAS
// ============================

let completadosEtapa4 = 0;
const totalEtapa4 = 11;

for (let numero = 1; numero <= 11; numero++) {

    const cabana = cierre.cabanasCierre?.[numero] || {};

    // Si está ocupada, la cabaña cuenta como 100% revisada
    if (cabana.ocupada === true) {
        completadosEtapa4 += 1;
        continue;
    }

    // Controles de revisión de esta cabaña
    const controlesCabana = [
        cabana.perillas === true,
        cabana.gas === true,
        cabana.refri === true,
        cabana.calefactor === true,
        cabana.tv === true,
        cabana.ac === true,
        cabana.luces === true
    ];

    const checksCompletados =
        controlesCabana.filter(Boolean).length;

    // Cada cabaña vale máximo 1 punto.
    // Cada check aporta 1/7.
    completadosEtapa4 +=
        checksCompletados / controlesCabana.length;
}

const porcentajeEtapa4 =
    Math.round((completadosEtapa4 / totalEtapa4) * 100);

console.log(
    `Cierre Etapa 4: ${completadosEtapa4.toFixed(2)}/${totalEtapa4} - ${porcentajeEtapa4}%`
);

// =========================
// PROGRESO GENERAL
// =========================

const completadosGeneral =
    completados +
    completadosEtapa2 +
    completadosEtapa3 +
    completadosEtapa4;

const totalGeneral =
    total +
    totalEtapa2 +
    totalEtapa3 +
    totalEtapa4;

const porcentajeGeneral =
    Math.round((completadosGeneral / totalGeneral) * 100);

    // Actualizar porcentaje visual
    const porcentajeElemento =
    document.getElementById("cierre-porcentaje");

    if (porcentajeElemento) {
    porcentajeElemento.textContent = `${porcentajeGeneral}%`;
    }

    // Actualizar barra visual
    const barraProgreso =
    document.getElementById("cierre-barra-progreso");

    if (barraProgreso) {
    barraProgreso.style.width = `${porcentajeGeneral}%`;
    }

    }

    cargarCierreDia(fechaSeleccionada);
    actualizarCierreTurno();

    // ==========================================
// ABRIR / CERRAR PREVIEW DE EVIDENCIAS
// ==========================================

function prepararToggleEvidencia(preview) {

    if (!preview) return;

    // Evitar crear el botón más de una vez
    if (preview.dataset.togglePreparado === "true") return;

    preview.dataset.togglePreparado = "true";

    const boton = document.createElement("button");

    boton.type = "button";
    boton.className = "cierre-evidencia-toggle";
    boton.textContent = "▸ Abrir evidencia";

    // Insertar botón justo antes del preview
    preview.parentNode.insertBefore(boton, preview);

    // Imagen cerrada por defecto
    preview.style.display = "none";

    boton.addEventListener("click", () => {

        const estaAbierto = preview.style.display !== "none";

        if (estaAbierto) {

            preview.style.display = "none";
            boton.textContent = "▸ Abrir evidencia";

        } else {

            preview.style.display = "block";
            boton.textContent = "▾ Cerrar evidencia";

        }

    });
}


// Preparar todos los previews existentes
document.querySelectorAll("[data-evidencia-preview]").forEach(preview => {
    prepararToggleEvidencia(preview);
});
