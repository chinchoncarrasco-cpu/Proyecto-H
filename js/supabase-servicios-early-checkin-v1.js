// ========================================
// HAIKU · EARLY CHECK-IN V1
// Añade Early Check-In al catálogo legacy y adapta la UI para:
// - precio manual por hora
// - cantidad = horas (1 unidad = 1 hora)
// - fecha y hora obligatorias
// - persistencia a Supabase mediante el puente de servicios existente
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_SERVICIOS_EARLY_CHECKIN_V1) return;
    window.HAIKU_SERVICIOS_EARLY_CHECKIN_V1 = true;

    const CODIGO = "earlyCheckin";
    const NOMBRE = "Early Check-In";

    function obtenerCatalogo() {
        try {
            if (typeof CATALOGO_SERVICIOS !== "undefined" && CATALOGO_SERVICIOS) {
                return CATALOGO_SERVICIOS;
            }
        } catch (_) {}
        return null;
    }

    function registrarEnCatalogo() {
        const catalogo = obtenerCatalogo();
        if (!catalogo) return false;

        if (!catalogo[CODIGO]) {
            catalogo[CODIGO] = {
                categoria: "checkin",
                nombre: NOMBRE,
                precio: 0,
                unidad: "hora",
                precioEditable: true,
                requiereHorario: true
            };
        }
        return true;
    }

    function elementos() {
        return {
            select: document.getElementById("servicios-producto"),
            cantidad: document.getElementById("servicios-cantidad"),
            precio: document.getElementById("servicios-precio-manual"),
            precioTexto: document.getElementById("servicios-precio"),
            programacion: document.getElementById("servicios-programacion"),
            fecha: document.getElementById("servicios-fecha"),
            hora: document.getElementById("servicios-hora"),
            btnNuevo: document.getElementById("servicios-btn-nuevo")
        };
    }

    function esEarly() {
        return elementos().select?.value === CODIGO;
    }

    function ordenarOpcion() {
        const { select } = elementos();
        if (!select) return;

        let early = select.querySelector(`option[value="${CODIGO}"]`);
        if (!early) {
            early = document.createElement("option");
            early.value = CODIGO;
            early.textContent = NOMBRE;
            select.appendChild(early);
        }

        const late = select.querySelector('option[value="lateCheckout"]');
        if (late && early !== late.previousElementSibling) {
            select.insertBefore(early, late);
        }
    }

    function precioManualActual() {
        const { precio } = elementos();
        const valor = Number(precio?.value || 0);
        return Number.isFinite(valor) && valor > 0 ? valor : 0;
    }

    function cantidadActual() {
        const { cantidad } = elementos();
        return Math.max(1, Math.trunc(Number(cantidad?.value || 1)) || 1);
    }

    function actualizarPrecioVisual() {
        const { precioTexto } = elementos();
        if (!precioTexto || !esEarly()) return;
        const total = precioManualActual() * cantidadActual();
        precioTexto.textContent = `$${Number(total || 0).toLocaleString("es-CL")}`;
    }

    function ajustarUI() {
        const { select, cantidad, precio, programacion } = elementos();
        if (!select) return;

        ordenarOpcion();

        if (select.value !== CODIGO) {
            if (precio) precio.placeholder = "Valor total";
            return;
        }

        if (cantidad) {
            cantidad.min = "1";
            cantidad.step = "1";
            if (!Number(cantidad.value) || Number(cantidad.value) < 1) cantidad.value = "1";
            cantidad.title = "1 unidad = 1 hora de Early Check-In";
        }

        if (precio) {
            precio.hidden = false;
            precio.placeholder = "Valor por hora";
            precio.min = "0";
            precio.step = "1000";
        }

        if (programacion) programacion.hidden = false;
        actualizarPrecioVisual();
    }

    function instalarWrapperRegistro() {
        if (window.HAIKU_SERVICIOS_EARLY_CHECKIN_WRAPPER_V1) return true;
        if (typeof window.registrarServicio !== "function") return false;

        const registrarAnterior = window.registrarServicio;

        window.registrarServicio = function registrarServicioConEarlyCheckin(datos = {}) {
            if (String(datos?.tipoServicio || "") !== CODIGO) {
                return registrarAnterior.apply(this, arguments);
            }

            const { fecha, hora } = elementos();
            const cantidad = Math.max(1, Math.trunc(Number(datos?.cantidad || cantidadActual())) || 1);
            const precioManual = precioManualActual();

            if (precioManual <= 0) {
                alert("Ingresa el precio por hora del Early Check-In.");
                return null;
            }

            const fechaServicio = String(datos?.fechaServicio || fecha?.value || "").slice(0, 10);
            const horaServicio = String(datos?.hora || hora?.value || "").slice(0, 5);

            if (!fechaServicio || !horaServicio) {
                alert("El Early Check-In requiere fecha y hora.");
                return null;
            }

            const datosEarly = {
                ...datos,
                tipoServicio: CODIGO,
                cantidad,
                personas: Math.max(1, Number(datos?.personas || cantidad)),
                fechaServicio,
                hora: horaServicio,
                precioManual
            };

            const nuevo = registrarAnterior.call(this, datosEarly);

            // El servicio legacy sólo aplicaba precio manual al Jacuzzi.
            // Ajustamos la copia local inmediatamente; Supabase ya recibe
            // precioManual y calcula el total correcto por hora.
            if (nuevo) {
                nuevo.precioManual = precioManual;
                nuevo.precioUnitario = precioManual;
                nuevo.cantidad = cantidad;
                nuevo.total = precioManual * cantidad;
                nuevo.fechaServicio = fechaServicio;
                nuevo.hora = horaServicio;
                nuevo.estadoPago = nuevo.total > 0 ? "pendiente" : "no-corresponde";

                try {
                    if (typeof guardarServicios === "function") guardarServicios();
                    if (typeof renderizarAgendaServicios === "function") renderizarAgendaServicios();
                } catch (_) {}
            }

            return nuevo;
        };

        window.HAIKU_SERVICIOS_EARLY_CHECKIN_WRAPPER_V1 = true;
        return true;
    }

    function instalarEventos() {
        if (window.HAIKU_SERVICIOS_EARLY_CHECKIN_EVENTOS_V1) return true;
        const { select, cantidad, precio, btnNuevo } = elementos();
        if (!select || !cantidad || !precio) return false;

        window.HAIKU_SERVICIOS_EARLY_CHECKIN_EVENTOS_V1 = true;

        select.addEventListener("change", () => {
            setTimeout(ajustarUI, 0);
        });

        // El listener legacy oculta/limpia el precio para servicios distintos de Jacuzzi.
        // En Early Check-In evitamos ese listener al cambiar la cantidad.
        cantidad.addEventListener("input", evento => {
            if (!esEarly()) return;
            evento.stopImmediatePropagation();
            actualizarPrecioVisual();
        }, true);

        precio.addEventListener("input", () => {
            if (!esEarly()) return;
            setTimeout(actualizarPrecioVisual, 0);
        });

        if (btnNuevo) {
            btnNuevo.addEventListener("click", () => {
                setTimeout(() => {
                    registrarEnCatalogo();
                    ordenarOpcion();
                    ajustarUI();
                }, 0);
            });
        }

        ordenarOpcion();
        return true;
    }

    function instalar() {
        const catalogoListo = registrarEnCatalogo();
        const eventosListos = instalarEventos();
        const wrapperListo = instalarWrapperRegistro();

        if (catalogoListo && eventosListos && wrapperListo) {
            ajustarUI();
            console.info("HAIKU · Early Check-In V1 preparado: precio manual por hora.");
            return true;
        }
        return false;
    }

    if (instalar()) return;

    let intentos = 0;
    const timer = setInterval(() => {
        intentos += 1;
        if (instalar() || intentos >= 80) clearInterval(timer);
    }, 100);
})();
