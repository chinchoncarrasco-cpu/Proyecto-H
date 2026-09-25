// ========================================
// PAGOS
// ========================================


// ========================================
// MOSTRAR ABONOS DE LOS INGRESOS
// ========================================

function cargarAbonosPagos() {
    if (window.HAIKU_PAGOS_REFRESH_V1?.interceptar("abonos-legacy")) return;

    const lista = document.getElementById("pagos-lista-abonos");
    const contador = document.getElementById("pagos-contador-abonos");

    if (!lista || !contador) {
        return;
    }

    if (!fechaSeleccionada) {
        return;
    }

    const datos = obtenerDatosDia(fechaSeleccionada);

    if (!datos || !datos.cabanas) {
        return;
    }

    lista.innerHTML = "";

    let cantidad = 0;

    Object.entries(datos.cabanas).forEach(([numeroCabana, cabana]) => {

        const estado = cabana.estado || "";

        const ingresa =
            estado === "libre-ingresa" ||
            estado === "sale-ingresa";

        if (!ingresa) {
            return;
        }

        if (cabana.abonoVerificado !== true) {
    cantidad++;
}

        const tarjeta = document.createElement("div");
        tarjeta.className = "pago-abono-item";

        if (cabana.abonoVerificado === true) {
    tarjeta.classList.add("abono-verificado");
}

        const titular =
    cabana.titular ||
    cabana.nombre ||
    cabana.huesped ||
    "Sin titular";

const montoAbono =
    cabana.abono ||
    cabana.montoAbono ||
    "";

const medioPago = cabana.medioPago || "";

tarjeta.innerHTML = `

    <div class="pago-abono-nuevo">

        <div class="pago-abono-cabecera">

            <div class="pago-abono-identidad">
                <strong>CAB ${numeroCabana}</strong>
                <span>· ${titular}</span>
            </div>

            <span class="pago-abono-estado">
                ${
                    cabana.abonoVerificado === true
                        ? "✓ Verificado"
                        : "Pendiente"
                }
            </span>

        </div>


        <div class="pago-abono-grid">

            <label class="pago-abono-grupo">

                <span class="pago-abono-label">
                    Abono
                </span>

                <div class="pago-abono-monto-wrap">

                    <span>$</span>

                    <input
                        type="number"
                        class="pago-abono-monto"
                        data-pago-cabana="${numeroCabana}"
                        value="${montoAbono || ""}"
                        min="0"
                        step="1000"
                        placeholder="0"
                    >

                </div>

            </label>


            <label class="pago-abono-grupo">

                <span class="pago-abono-label">
                    Medio
                </span>

                <select
                    class="pago-abono-medio"
                    data-pago-cabana="${numeroCabana}"
                >
                    <option value="" ${medioPago === "" ? "selected" : ""}>
                        Seleccionar...
                    </option>

                    <option value="Transferencia" ${medioPago === "Transferencia" ? "selected" : ""}>
                        Transferencia
                    </option>

                    <option value="WebPay Crédito" ${medioPago === "WebPay Crédito" ? "selected" : ""}>
                        WebPay Crédito
                    </option>

                    <option value="WebPay Débito" ${medioPago === "WebPay Débito" ? "selected" : ""}>
                        WebPay Débito
                    </option>

                    <option value="Tarjeta Crédito" ${medioPago === "Tarjeta Crédito" ? "selected" : ""}>
                        Tarjeta Crédito
                    </option>

                    <option value="Tarjeta Débito" ${medioPago === "Tarjeta Débito" ? "selected" : ""}>
                        Tarjeta Débito
                    </option>

                    <option value="Efectivo" ${medioPago === "Efectivo" ? "selected" : ""}>
                        Efectivo
                    </option>
                </select>

            </label>

        </div>


        <label class="pago-abono-verificacion">

            <input
                type="checkbox"
                data-pago-abono="${numeroCabana}"
                ${cabana.abonoVerificado === true ? "checked" : ""}
            >

            <span>
                Confirmar abono
            </span>

        </label>

    </div>
`;

        lista.appendChild(tarjeta);
    });

    contador.textContent = cantidad;

}

// ========================================
// WEBPAY POR CONFIRMAR
// ========================================

let registrosWebpay = JSON.parse(
    localStorage.getItem("haikuWebpay")
) || [];

function guardarWebpay() {
    localStorage.setItem(
        "haikuWebpay",
        JSON.stringify(registrosWebpay)
    );
}

function formatearFechaWebpay(fecha) {

    if (!fecha) return "Sin datos";

    const partes = fecha.split("-");

    if (partes.length !== 3) return fecha;

    return `${partes[2]}-${partes[1]}-${partes[0]}`;
}


function cargarWebpayPendientes() {
    if (window.HAIKU_PAGOS_REFRESH_V1?.interceptar("webpay-legacy")) return;

    const lista =
        document.getElementById("pagos-lista-webpay");

    const contador =
        document.getElementById("pagos-contador-webpay");

    if (!lista || !contador) return;

    const pendientes =
    registrosWebpay.filter(registro =>
        !registro.primerAbono
    );

    contador.textContent = pendientes.length;

    lista.innerHTML = "";

    if (pendientes.length === 0) {

        lista.innerHTML = `
            <p class="pagos-checkout-vacio">
                No hay WebPay pendientes de confirmar.
            </p>
        `;

        return;
    }


    pendientes.forEach(registro => {

        const tarjeta =
            document.createElement("div");

        tarjeta.className =
            "pago-webpay-item";

        tarjeta.innerHTML = `

            <div class="pago-webpay-header">

    <div class="pago-webpay-titulo">

        <strong>
            CAB ${registro.cabana}
        </strong>

        <span>
            · ${registro.nombre || "Sin titular"}
        </span>

    </div>

    <button
        type="button"
        class="pago-webpay-eliminar"
        data-webpay-eliminar="${registro.id}"
        title="Eliminar WebPay"
        aria-label="Eliminar WebPay"
    >
        ×
    </button>

</div>


            <div class="pago-webpay-monto">
                $${Number(
                    registro.monto || 0
                ).toLocaleString("es-CL")}
            </div>


            <div class="pago-webpay-detalles">

                <div>
                    RUT:
                    ${registro.rut || "Sin datos"}
                </div>

                <div>
                    Cod. Aut:
                    ${registro.codAut || "Sin datos"}
                </div>

                <div>
                    Tipo:
                    ${registro.tipo || "Sin datos"}
                </div>

                <div>
                    Fecha pago:
                    ${formatearFechaWebpay(
                        registro.fechaPago
                    )}
                </div>

                <div>
                    Fecha reserva:
                    ${formatearFechaWebpay(
                        registro.fechaReserva
                    )}
                </div>

                <div>
                    Tarjeta:
                    ${registro.tarjeta || "Sin datos"}
                </div>

            </div>

<div class="pago-webpay-manager">

    <span>
        Fecha 1er abono
    </span>

    <input
        type="date"
        data-webpay-primer-abono="${registro.id}"
    >

</div>
        `;

        lista.appendChild(tarjeta);

    });

}

// ========================================
// AGREGAR WEBPAY
// ========================================

const botonAgregarWebpay =
    document.getElementById("pagos-webpay-agregar");

if (botonAgregarWebpay) {

    botonAgregarWebpay.addEventListener("click", () => {

        const nombre =
            document.getElementById("pagos-webpay-nombre");

        const rut =
            document.getElementById("pagos-webpay-rut");

        const cabana =
            document.getElementById("pagos-webpay-cabana");

        const monto =
            document.getElementById("pagos-webpay-monto");

        const codAut =
            document.getElementById("pagos-webpay-codaut");

        const tipo =
            document.getElementById("pagos-webpay-tipo");

        const fechaPago =
            document.getElementById("pagos-webpay-fecha-pago");

        const fechaReserva =
            document.getElementById("pagos-webpay-fecha-reserva");

        const tarjeta =
            document.getElementById("pagos-webpay-tarjeta");


        if (
            !nombre.value.trim() ||
            !cabana.value ||
            !monto.value
        ) {
            alert(
                "Completa al menos Nombre, Cabaña y Monto."
            );
            return;
        }


        const nuevoWebpay = {

            id:
                "webpay-" +
                Date.now() +
                "-" +
                Math.random()
                    .toString(36)
                    .slice(2, 7),

            nombre:
                nombre.value.trim(),

            rut:
                rut.value.trim(),

            cabana:
                cabana.value,

            monto:
                Number(monto.value) || 0,

            codAut:
                codAut.value.trim(),

            tipo:
                tipo.value,

            fechaPago:
                fechaPago.value,

            fechaReserva:
                fechaReserva.value,

            tarjeta:
                tarjeta.value.trim(),

            primerAbono: "",

            primerAbono: "",

            creadoEn:
                new Date().toISOString()

        };


        registrosWebpay.push(nuevoWebpay);

        guardarWebpay();
        cargarWebpayPendientes();


        // Limpiar formulario
        nombre.value = "";
        rut.value = "";
        cabana.value = "";
        monto.value = "";
        codAut.value = "";
        tipo.value = "";
        fechaPago.value = "";
        fechaReserva.value = "";
        tarjeta.value = "";

    });

}

// ========================================
// CONFIRMAR FECHA PRIMER ABONO WEBPAY
// ========================================

document.addEventListener("change", (evento) => {

    const campoFecha =
        evento.target.closest(
            "[data-webpay-primer-abono]"
        );

    if (!campoFecha) return;

    const idWebpay =
        campoFecha.dataset.webpayPrimerAbono;

    const registro =
        registrosWebpay.find(
            item => item.id === idWebpay
        );

    if (!registro) return;

    if (!campoFecha.value) return;

    registro.primerAbono =
        campoFecha.value;

    guardarWebpay();

    cargarWebpayPendientes();

});

// ========================================
// ELIMINAR WEBPAY PENDIENTE
// ========================================

document.addEventListener("click", (evento) => {

    const boton =
        evento.target.closest(
            "[data-webpay-eliminar]"
        );

    if (!boton) return;

    const idWebpay =
        boton.dataset.webpayEliminar;

    registrosWebpay =
        registrosWebpay.filter(
            registro =>
                String(registro.id) !== String(idWebpay)
        );

    guardarWebpay();
    cargarWebpayPendientes();

});

// ========================================
// CARGA INICIAL DE PAGOS
// ========================================

cargarAbonosPagos();
cargarSaldosCheckin();
cargarCobrosCheckout();
cargarWebpayPendientes();

// ========================================
// COBROS CHECK-OUT DESDE SERVICIOS
// ========================================

function cargarCobrosCheckout() {
    if (window.HAIKU_PAGOS_REFRESH_V1?.interceptar("checkout-legacy")) return;

    const lista =
        document.getElementById("pagos-lista-checkout");

    const contador =
        document.getElementById("pagos-contador-checkout");

    if (!lista || !contador) {
        return;
    }

    const servicios = JSON.parse(
        localStorage.getItem("haikuServicios")
    ) || [];

    // ========================================
// RESERVAS QUE HACEN CHECK-OUT HOY
// ========================================

const datosDia = obtenerDatosDia(fechaSeleccionada);

const reservasCheckout = new Set();

Object.entries(datosDia.cabanas || {}).forEach(
    ([numeroCabana, cabana]) => {

        const estado = cabana.estado || "";

        const saleHoy =
            estado === "sale-libre" ||
            estado === "sale-ingresa" ||
            estado === "fullday";

        if (
            saleHoy &&
            cabana.reservaId
        ) {
            reservasCheckout.add(
                String(cabana.reservaId)
            );
        }

    }
);

// ========================================
// COBROS PENDIENTES DE ESAS RESERVAS
// ========================================

const pendientes = servicios.filter(servicio => {

    const pagoPendiente =
        servicio.estadoPago === "pendiente";

    const perteneceReservaCheckout =
        servicio.reservaId &&
        reservasCheckout.has(
            String(servicio.reservaId)
        );

    return (
        pagoPendiente &&
        perteneceReservaCheckout
    );

});

    lista.innerHTML = "";

    contador.textContent = pendientes.length;

    if (pendientes.length === 0) {
        lista.innerHTML = `
            <p class="pagos-checkout-vacio">
                No hay cobros pendientes de servicios.
            </p>
        `;
        return;
    }

    // ========================================
// AGRUPAR COBROS POR RESERVA
// ========================================

const gruposPorReserva = {};

pendientes.forEach(servicio => {

    const clave =
        servicio.reservaId ||
        `cab-${servicio.numeroCabana}`;

    if (!gruposPorReserva[clave]) {

        gruposPorReserva[clave] = {
            reservaId: servicio.reservaId || "",
            numeroCabana: servicio.numeroCabana || "",
            titular: servicio.titular || "",
            servicios: []
        };

    }

    gruposPorReserva[clave].servicios.push(servicio);

});


// ========================================
// CREAR UNA TARJETA POR RESERVA
// ========================================

Object.values(gruposPorReserva).forEach(grupo => {

    const tarjeta =
        document.createElement("div");

    tarjeta.className =
        "pago-checkout-item";


    // Ordenar servicios por fecha y hora
    grupo.servicios.sort((a, b) => {

        const fechaA =
            `${a.fechaServicio || ""} ${a.hora || ""}`;

        const fechaB =
            `${b.fechaServicio || ""} ${b.hora || ""}`;

        return fechaA.localeCompare(fechaB);

    });


    const totalReserva =
        grupo.servicios.reduce(
            (suma, servicio) =>
                suma + Number(servicio.total || 0),
            0
        );


    const serviciosHTML =
        grupo.servicios.map(servicio => {

            return `
                <div class="pago-checkout-servicio-fila">

                    <div class="pago-checkout-servicio-info">

                        <strong>
                            ${servicio.hora
                                ? `${servicio.hora} · `
                                : ""}
                            ${servicio.nombre}
                        </strong>

                    </div>

                    <strong class="pago-checkout-servicio-monto">
                        $${Number(
                            servicio.total || 0
                        ).toLocaleString("es-CL")}
                    </strong>

                </div>
            `;

        }).join("");


    tarjeta.innerHTML = `

    <div class="pago-checkout-nuevo">

        <div class="pago-checkout-cabecera">

            <div class="pago-checkout-identidad">

                <strong>
                    CAB ${grupo.numeroCabana}
                </strong>

                <span>
                    ${
                        grupo.titular
                            ? `· ${grupo.titular}`
                            : "· Sin titular"
                    }
                </span>

            </div>


            <span class="pago-checkout-estado">
                Pendiente
            </span>

        </div>


        <div class="pago-checkout-servicios-lista">

            ${serviciosHTML}

        </div>


        <div class="pago-checkout-total-nuevo">

            <span>
                Total pendiente
            </span>

            <strong>
                $${totalReserva.toLocaleString("es-CL")}
            </strong>

        </div>

    </div>
`;

    lista.appendChild(tarjeta);

});

}

// =====================================
// SALDOS CHECK-IN
// =====================================

function cargarSaldosCheckin() {
    if (window.HAIKU_PAGOS_REFRESH_V1?.interceptar("checkin-legacy")) return;

    const lista = document.getElementById("pagos-lista-checkin");
    const contador = document.getElementById("pagos-contador-checkin");

    if (!lista || !contador) {
        return;
    }

    if (!fechaSeleccionada) {
        return;
    }

    const datos = obtenerDatosDia(fechaSeleccionada);

    if (!datos || !datos.cabanas) {
        return;
    }

    lista.innerHTML = "";

    let cantidad = 0;

    Object.entries(datos.cabanas).forEach(([numeroCabana, cabana]) => {

    const estado = cabana.estado || "";

    const ingresa =
        estado === "libre-ingresa" ||
        estado === "sale-ingresa";

    if (!ingresa) {
        return;
    }

    cantidad++;

    const titular =
        cabana.titular ||
        cabana.nombre ||
        cabana.huesped ||
        "Sin titular";

    const abonoTexto =
    cabana.abono ||
    cabana.montoAbono ||
    "0";

const abono = Number(
    String(abonoTexto).replace(/\D/g, "")
);

    const tarjeta = document.createElement("div");
tarjeta.className = "pago-checkin-item";

tarjeta.innerHTML = `

    <div class="pago-checkin-nuevo">

        <!-- CABECERA -->
        <div class="pago-checkin-cabecera">

            <div class="pago-checkin-identidad">
                <strong>CAB ${numeroCabana}</strong>
                <span>· ${titular}</span>
            </div>

            <span class="pago-checkin-estado">
                Pendiente
            </span>

        </div>


        <!-- TOTAL Y SALDO -->
        <div class="pago-checkin-resumen-nuevo">

            <label class="pago-checkin-grupo">

                <span class="pago-checkin-label">
                    Total reserva
                </span>

                <div class="pago-checkin-input-monto">

                    <span>$</span>

                    <input
                        type="number"
                        class="pago-checkin-total"
                        data-pago-checkin-total="${numeroCabana}"
                        placeholder="300000"
                    >

                </div>

            </label>


            <div class="pago-checkin-saldo-nuevo">

                <span>
                    Saldo pendiente
                </span>

                <strong class="pago-checkin-saldo">
                    $0
                </strong>

            </div>

        </div>


        <!-- MEDIO DE PAGO -->
        <div class="pago-checkin-bloque">

            <span class="pago-checkin-label">
                Medio de pago
            </span>

            <div class="pago-checkin-medio-fila">

                <select
                    data-pago-checkin-medio="${numeroCabana}"
                >
                    <option value="">
                        Seleccionar...
                    </option>

                    <option value="WebPay Débito">
                        WebPay Débito
                    </option>

                    <option value="WebPay Crédito">
                        WebPay Crédito
                    </option>

                    <option value="Tarjeta Débito">
                        Tarjeta Débito
                    </option>

                    <option value="Tarjeta Crédito">
                        Tarjeta Crédito
                    </option>

                    <option value="Transferencia">
                        Transferencia
                    </option>

                    <option value="Efectivo">
                        Efectivo
                    </option>
                </select>


                <label class="pago-checkin-cobrado">

                    <input
                        type="checkbox"
                        class="pago-checkin-check"
                        data-pago-checkin-cobrado="${numeroCabana}"
                    >

                    <span>
                        Cobrado
                    </span>

                </label>

            </div>

        </div>


        <!-- DATOS ADMINISTRATIVOS -->
        <div class="pago-checkin-datos">

            <label class="pago-checkin-grupo">

                <span class="pago-checkin-label">
                    Folio
                </span>

                <input
                    type="text"
                    data-pago-checkin-folio="${numeroCabana}"
                    placeholder="Rellenar"
                >

            </label>


            <label class="pago-checkin-grupo">

                <span class="pago-checkin-label">
                    CodAut
                </span>

                <input
                    type="text"
                    data-pago-checkin-codaut="${numeroCabana}"
                    placeholder="Rellenar"
                >

            </label>


            <label class="pago-checkin-grupo">

                <span class="pago-checkin-label">
                    Bove
                </span>

                <input
                    type="text"
                    data-pago-checkin-bove="${numeroCabana}"
                    placeholder="Rellenar"
                >

            </label>


            <label class="pago-checkin-manager-nuevo">

                <span class="pago-checkin-label">
                    Manager
                </span>

                <div>
                    <input
                        type="checkbox"
                        data-pago-checkin-manager="${numeroCabana}"
                    >

                    <span>
                        Revisado
                    </span>
                </div>

            </label>

        </div>

    </div>
`;

lista.appendChild(tarjeta);

const inputTotal = tarjeta.querySelector(".pago-checkin-total");
const saldoTexto = tarjeta.querySelector(".pago-checkin-saldo");
const selectMedio = tarjeta.querySelector(
    `[data-pago-checkin-medio="${numeroCabana}"]`
);

const checkCobrado = tarjeta.querySelector(
    `[data-pago-checkin-cobrado="${numeroCabana}"]`
);

const inputFolio = tarjeta.querySelector(
    `[data-pago-checkin-folio="${numeroCabana}"]`
);

const inputCodAut = tarjeta.querySelector(
    `[data-pago-checkin-codaut="${numeroCabana}"]`
);

const inputBove = tarjeta.querySelector(
    `[data-pago-checkin-bove="${numeroCabana}"]`
);

const checkManager = tarjeta.querySelector(
    `[data-pago-checkin-manager="${numeroCabana}"]`
);

function actualizarEstadoCompleto() {
    const estadoCompletoAnterior =
        cabana.checkinCompleto === true;

    const completo =
        Number(inputTotal.value) > 0 &&
        selectMedio.value !== "" &&
        checkCobrado.checked &&
        inputFolio.value.trim() !== "" &&
        inputCodAut.value.trim() !== "" &&
        inputBove.value.trim() !== "" &&
        checkManager.checked;

    tarjeta.classList.toggle("pago-checkin-completo", completo);

    cabana.checkinCompleto = completo;
    guardarDatos();

    if (
        completo !== estadoCompletoAnterior &&
        typeof registrarActividadHaiku ===
            "function"
    ) {
        registrarActividadHaiku({
            tipo: "pago",
            accion:
                completo
                    ? "Cobro de check-in completado"
                    : "Cobro de check-in reabierto",
            reservaId:
                cabana.reservaId || "",
            numeroCabana,
            titular:
                cabana.titular || "",
            fechaOperacion: fechaSeleccionada,
            detalle:
                `Total $${Number(
                    inputTotal.value || 0
                ).toLocaleString("es-CL")} · ${
                    selectMedio.value || "Sin medio"
                }`,
            cambios: [
                {
                    campo: "Cobro check-in",
                    anterior:
                        estadoCompletoAnterior
                            ? "Completo"
                            : "Pendiente",
                    nuevo:
                        completo
                            ? "Completo"
                            : "Pendiente"
                }
            ]
        });
    }


const pendientes = lista.querySelectorAll(
    ".pago-checkin-item:not(.pago-checkin-completo)"
).length;

contador.textContent = pendientes;

}

// Recuperar valores guardados
selectMedio.value = cabana.checkinMedio || "";
checkCobrado.checked = cabana.checkinCobrado === true;

// Recuperar datos administrativos guardados
inputFolio.value = cabana.checkinFolio || "";
inputCodAut.value = cabana.checkinCodAut || "";
inputBove.value = cabana.checkinBove || "";
checkManager.checked = cabana.checkinManager === true;

// Guardar medio de pago
selectMedio.addEventListener("change", () => {
    cabana.checkinMedio = selectMedio.value;
    guardarDatos();
});

// Guardar ticket de cobro
checkCobrado.addEventListener("change", () => {
    cabana.checkinCobrado = checkCobrado.checked;
    guardarDatos();
});

// Guardar Folio
inputFolio.addEventListener("input", () => {
    cabana.checkinFolio = inputFolio.value;
    guardarDatos();
});

// Guardar Código de Autorización
inputCodAut.addEventListener("input", () => {
    cabana.checkinCodAut = inputCodAut.value;
    guardarDatos();
});

// Guardar Bove
inputBove.addEventListener("input", () => {
    cabana.checkinBove = inputBove.value;
    guardarDatos();
});

// Guardar Manager
checkManager.addEventListener("change", () => {
    cabana.checkinManager = checkManager.checked;
    guardarDatos();
});

[
    inputTotal,
    selectMedio,
    checkCobrado,
    inputFolio,
    inputCodAut,
    inputBove,
    checkManager
].forEach(elemento => {
    elemento.addEventListener("input", actualizarEstadoCompleto);
    elemento.addEventListener("change", actualizarEstadoCompleto);
});

inputTotal.value = cabana.totalReserva || "";

function actualizarSaldo() {

    const total = Number(inputTotal.value) || 0;

    const saldo = Math.max(total - abono, 0);

    saldoTexto.textContent =
        "$" + saldo.toLocaleString("es-CL");
}

inputTotal.addEventListener("input", () => {

    cabana.totalReserva = inputTotal.value;

    guardarDatos();

    actualizarSaldo();
});

actualizarSaldo();
actualizarEstadoCompleto();

});

const pendientes = lista.querySelectorAll(
    ".pago-checkin-item:not(.pago-checkin-completo)"
).length;

contador.textContent = pendientes;

}

// ========================================
// ABONO VERIFICADO - CAMBIO VISUAL
// ========================================

document.addEventListener("change", (evento) => {

    const check = evento.target.closest("[data-pago-abono]");

    if (!check) {
        return;
    }

    const tarjeta = check.closest(".pago-abono-item");

    if (!tarjeta) {
        return;
    }

    tarjeta.classList.toggle(
        "abono-verificado",
        check.checked
    );

});

// ========================================
// GUARDAR DATOS DEL ABONO
// ========================================

document.addEventListener("change", (evento) => {

    if (!fechaSeleccionada) {
        return;
    }

    const monto = evento.target.closest(".pago-abono-monto");
    const medio = evento.target.closest(".pago-abono-medio");
    const verificado = evento.target.closest("[data-pago-abono]");

    if (!monto && !medio && !verificado) {
        return;
    }

    const numeroCabana =
        monto?.dataset.pagoCabana ||
        medio?.dataset.pagoCabana ||
        verificado?.dataset.pagoAbono;

    if (!numeroCabana) {
        return;
    }

    const datos = obtenerDatosDia(fechaSeleccionada);

    if (!datos.cabanas[numeroCabana]) {
        datos.cabanas[numeroCabana] = {};
    }

    const cabana = datos.cabanas[numeroCabana];

    const abonoAnterior =
        cabana.abono || "";
    const medioAnterior =
        cabana.medioPago || "";
    const verificadoAnterior =
        cabana.abonoVerificado === true;

    if (monto) {
        cabana.abono = monto.value;
    }

    if (medio) {
        cabana.medioPago = medio.value;
    }

    if (verificado) {
    cabana.abonoVerificado = verificado.checked;
}

guardarDatos();

if (
    typeof registrarActividadHaiku ===
    "function"
) {
    const cambios = [];

    if (monto) {
        cambios.push({
            campo: "Monto del abono",
            anterior: abonoAnterior,
            nuevo: monto.value
        });
    }

    if (medio) {
        cambios.push({
            campo: "Medio de pago",
            anterior: medioAnterior,
            nuevo: medio.value
        });
    }

    if (verificado) {
        cambios.push({
            campo: "Verificación",
            anterior:
                verificadoAnterior
                    ? "Verificado"
                    : "Pendiente",
            nuevo:
                verificado.checked
                    ? "Verificado"
                    : "Pendiente"
        });
    }

    registrarActividadHaiku({
        tipo: "pago",
        accion:
            verificado
                ? verificado.checked
                    ? "Abono confirmado"
                    : "Confirmación de abono retirada"
                : "Datos del abono actualizados",
        reservaId:
            cabana.reservaId || "",
        numeroCabana,
        titular:
            cabana.titular || "",
        fechaOperacion: fechaSeleccionada,
        detalle:
            `Abono $${Number(
                cabana.abono || 0
            ).toLocaleString("es-CL")}${
                cabana.medioPago
                    ? ` · ${cabana.medioPago}`
                    : ""
            }`,
        cambios
    });
}

cargarAbonosPagos();
cargarSaldosCheckin();
});

// ========================================
// ACTUALIZAR PAGOS AL ENTRAR A LA SECCIÓN
// ========================================

document.addEventListener("click", (e) => {

    const botonPagos =
        e.target.closest('[data-seccion="pagos"]');

    if (!botonPagos) return;

    setTimeout(() => {

        cargarAbonosPagos();
        cargarSaldosCheckin();
        cargarCobrosCheckout();

    }, 0);

});
