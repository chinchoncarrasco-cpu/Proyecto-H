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

// El almacén local conserva las claves usadas por versiones anteriores del panel.
const cierreSeccion = document.getElementById("seccion-cierre");
const cierrePlantilla = window.HAIKU_CIERRE_PLANTILLA_V1;
let fechaCierreLocal = "";

function obtenerCierreDia(fecha) {
    const datos = obtenerDatosDia(fecha);
    const cierre = datos.cierre ||= {};
    cierre.cabanasCierre ||= {};
    cierre.llavesRecepcion ||= {};
    cierre.tareasPersonificadas ||= {};
    return cierre;
}

function claveRespuestaCierre(codigo, cabanaNumero) {
    return cabanaNumero ? `${codigo}:${cabanaNumero}` : codigo;
}

function respuestaDeControlCierre(input) {
    const codigo = input.dataset.cierreCodigo;
    if (!codigo || input.disabled || (input.type === "radio" && !input.checked)) return null;
    const cabanaNumero = Number(input.dataset.cierreCabana) || null;
    let valor = input.type === "radio" ? input.value : input.checked;
    if (input.dataset.cierreLlave) {
        valor = Object.fromEntries([...cierreSeccion.querySelectorAll("[data-cierre-llave]")]
            .map(check => [check.dataset.cierreLlave, check.checked]));
    }
    return { codigo, cabanaNumero, valor, llave: input.dataset.cierreLlave,
        estado: valor === false ? "pendiente" : "confirmado" };
}

function cargarCierreDia(fecha) {
    if (!cierreSeccion || !cierrePlantilla || !fecha || fecha !== fechaSeleccionada) return;
    const cambioDeDia = fechaCierreLocal !== fecha;
    fechaCierreLocal = fecha;
    window.HAIKU_SITES_CIERRE_V1?.mostrarFecha(fecha);
    const cierre = obtenerCierreDia(fecha);
    const exentos = new Set(cierre._cierreExentos || []);
    cierreSeccion.querySelectorAll("[data-cierre-codigo]").forEach(input => {
        const { cierreCodigo: codigo, cierreCabana: numero, cierreLlave: llave } = input.dataset;
        const campo = cierrePlantilla.campos[codigo]?.campo;
        const valor = numero ? cierre.cabanasCierre[numero]?.[codigo.slice(7)]
            : llave ? cierre.llavesRecepcion[llave] : campo ? cierre[campo] : cierre.tareasPersonificadas[codigo];
        input.checked = input.type === "radio" ? input.value === valor : valor === true;
        input.dataset.cierreExento = String(exentos.has(claveRespuestaCierre(codigo, numero)));
        if (cierreSeccion.classList.contains("haiku-cierre-bloqueado")) input.disabled = true;
    });
    const novedades = cierreSeccion.querySelector('textarea[data-cierre-campo="novedades"]');
    if (novedades && (cambioDeDia || document.activeElement !== novedades)) novedades.value = cierre.novedades || "";
    actualizarCierreTurno();
}

function actualizarCierreTurno() {
    window.HAIKU_SITES_CIERRE_V1?.actualizar();
}

cierreSeccion?.addEventListener("change", event => {
    if (!fechaSeleccionada) return;
    const input = event.target;
    const respuesta = respuestaDeControlCierre(input);
    if (respuesta) {
        const { codigo, cabanaNumero, valor } = respuesta;
        const cierre = obtenerCierreDia(fechaSeleccionada);
        if (cabanaNumero) {
            const cabana = cierre.cabanasCierre[cabanaNumero] ||= {};
            cabana[codigo.slice(7)] = valor;
        } else if (cierrePlantilla.campos[codigo]) {
            cierre[cierrePlantilla.campos[codigo].campo] = valor;
        } else {
            cierre.tareasPersonificadas[codigo] = valor;
        }
        const clave = claveRespuestaCierre(codigo, cabanaNumero);
        cierre._cierreExentos = (cierre._cierreExentos || []).filter(exento => exento !== clave);
        input.closest(".turno-control")?.querySelectorAll("[data-cierre-exento]").forEach(opcion => {
            opcion.dataset.cierreExento = "false";
        });
        input.dataset.cierreExento = "false";
        guardarDatos();
        actualizarCierreTurno();
    }

    if (input.matches("[data-evidencia-input]")) {
        const archivo = input.files[0];
        input.value = "";
        if (archivo && !input.disabled) adjuntarEvidenciaCierre(archivo, input.dataset.evidenciaInput, fechaSeleccionada);
    }
});

cierreSeccion?.addEventListener("input", event => {
    const input = event.target;
    if (!fechaSeleccionada || !input.matches('textarea[data-cierre-campo="novedades"]') || input.disabled) return;
    obtenerCierreDia(fechaSeleccionada).novedades = input.value;
    guardarDatos();
    actualizarCierreTurno();
});

cierreSeccion?.addEventListener("paste", event => {
    const boton = event.target.closest("[data-evidencia-pegar]");
    if (!boton || boton.disabled || !fechaSeleccionada) return;
    const imagen = [...(event.clipboardData?.files || [])].find(archivo => archivo.type.startsWith("image/"))
        || [...(event.clipboardData?.items || [])].find(item => item.type.startsWith("image/"))?.getAsFile();
    if (!imagen) return;
    event.preventDefault();
    adjuntarEvidenciaCierre(imagen, boton.dataset.evidenciaPegar, fechaSeleccionada);
});

function adjuntarEvidenciaCierre(archivo, nombre, fecha) {
    if (!archivo.type.startsWith("image/")) {
        window.HAIKU_DIALOGOS.aviso("Selecciona un archivo de imagen.");
        return;
    }

    const lector = new FileReader();
    lector.onerror = () => window.HAIKU_DIALOGOS.aviso("No fue posible leer la imagen.");
    lector.onload = async () => {
        try {
            await window.haikuEsperarGuardadosCierre?.(fecha);
            await guardarEvidencia(fecha, nombre, lector.result);
        } catch (error) {
            // El adaptador Supabase avisa si debe usar el respaldo local.
            console.error("HAIKU · Evidencia de cierre:", error);
        }
        window.dispatchEvent(new CustomEvent("haiku:cierre-evidencia-guardada", { detail: { fecha, nombre } }));
    };
    lector.readAsDataURL(archivo);
}

cargarCierreDia(fechaSeleccionada);
