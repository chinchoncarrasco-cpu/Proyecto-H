// Identidad read-only para la Nota operativa real abierta desde Resumen.
// La escritura permanece en HAIKU_NOTAS_RESUMEN_SUPABASE_V1.guardar.
(() => {
    "use strict";

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const FECHA = /^\d{4}-\d{2}-\d{2}$/;
    const panel = document.getElementById("panel-agregar-nota");
    if (!panel) return;

    function identidadOperacion(fila) {
        const estado = String(fila?.estado_operativo || "");
        const prefijo = ["libre-ingresa", "sale-ingresa"].includes(estado) ? "ingreso" :
            estado === "sale-libre" ? "salida" :
                estado === "continua" ? "continua" : estado === "fullday" ? "fullday" : "";
        return {
            reservaId: prefijo ? String(fila[`${prefijo}_reserva_id`] || "") : "",
            estadiaId: prefijo ? String(fila[`${prefijo}_estadia_id`] || "") : ""
        };
    }

    function articulo(numero) {
        return document.querySelector(
            `#seccion-resumen .sites-resumen-cabana[data-cabana="${numero}"]`);
    }

    function fechaActiva() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function instantanea(fila) {
        if (!fila || fila.dataset.haikuFuente !== "supabase") {
            throw new Error("No está disponible la identidad actual de la cabaña.");
        }
        const valor = {
            numero: String(fila.dataset.cabana || ""),
            fecha: String(fila.dataset.resumenFecha || ""),
            cabanaId: String(fila.dataset.haikuCabanaId || ""),
            reservaId: String(fila.dataset.resumenReservaId || ""),
            estadiaId: String(fila.dataset.resumenEstadiaId || "")
        };
        if (!/^\d{1,2}$/.test(valor.numero) || !FECHA.test(valor.fecha) ||
            !UUID.test(valor.cabanaId) ||
            (valor.reservaId && !UUID.test(valor.reservaId)) ||
            (valor.reservaId && !UUID.test(valor.estadiaId)) ||
            (!valor.reservaId && valor.estadiaId)) {
            throw new Error("La identidad de la reserva requiere revisión antes de guardar una nota.");
        }
        return valor;
    }

    function preparar(boton) {
        if (window.haikuTienePermiso?.("notas.gestionar") !== true) {
            throw new Error("No tienes permiso para gestionar notas.");
        }
        const fila = boton.closest?.(".sites-resumen-cabana");
        const datos = instantanea(fila);
        if (datos.numero !== String(boton.dataset.agregarNotaCabana || "")) {
            throw new Error("La cabaña de la nota cambió. Recarga Resumen.");
        }
        panel.dataset.sitesNotaContexto = JSON.stringify(datos);
        return datos;
    }

    async function validar(fecha, numero) {
        if (!window.haikuSesion || window.haikuTienePermiso?.("notas.gestionar") !== true) {
            throw new Error("La sesión o el permiso para notas ya no están disponibles.");
        }
        const cliente = window.haikuSupabase;
        if (!cliente || !window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1?.guardar) {
            throw new Error("No está disponible el guardado real de notas.");
        }
        let anterior;
        try { anterior = JSON.parse(panel.dataset.sitesNotaContexto || "null"); } catch { anterior = null; }
        const actual = instantanea(articulo(numero));
        if (!anterior || anterior.numero !== String(numero) || anterior.fecha !== fecha ||
            fecha !== fechaActiva() ||
            Object.keys(actual).some(clave => actual[clave] !== anterior[clave])) {
            throw new Error("La cabaña o reserva cambió desde que abriste la nota. Vuelve a abrirla.");
        }
        const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error || !Array.isArray(data)) throw error || new Error("No se pudo revalidar el día operativo.");
        const fila = data.find(item => String(item.numero) === anterior.numero);
        const identidad = identidadOperacion(fila);
        if (!fila || String(fila.cabana_id || "") !== anterior.cabanaId ||
            identidad.reservaId !== anterior.reservaId ||
            identidad.estadiaId !== anterior.estadiaId) {
            throw new Error("El estado de la reserva cambió. La nota no se guardó.");
        }
        const visible = instantanea(articulo(numero));
        if (fecha !== fechaActiva() ||
            Object.keys(visible).some(clave => visible[clave] !== anterior[clave])) {
            throw new Error("El día o la reserva cambió durante la verificación. Vuelve a abrir la nota.");
        }
        return anterior;
    }

    window.HAIKU_SITES_RESUMEN_NOTA_V1 = Object.freeze({
        preparar, validar, identidadOperacion
    });
})();
