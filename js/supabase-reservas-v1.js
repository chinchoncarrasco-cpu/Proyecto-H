// ========================================
// RESERVAS V1 · TABLA OPERATIVA DE SOLO LECTURA
// Consulta paginada a Supabase. No edita ni crea reservas.
// Sin observers globales, polling, intervalos ni parches.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_RESERVAS_V1) return;

    const cliente = window.haikuSupabase;
    const seccion = document.getElementById("seccion-reservas");
    const botonMenu = document.querySelector('.menu-item[data-seccion="reservas"]');

    if (!cliente || !seccion || !botonMenu) return;

    const COLUMNAS_BASE = [
        { id: "fecha_reserva", label: "Fecha de la reserva", tipo: "fecha" },
        { id: "plan_tarifario", label: "Nombre del Plan de Tarifas (Interno)", tipo: "texto" },
        { id: "cabanas", label: "Número de Habitación / Cabaña", tipo: "texto" },
        { id: "nombre", label: "Nombre", tipo: "texto" },
        { id: "apellido", label: "Apellido", tipo: "texto" },
        { id: "check_in", label: "Check-In", tipo: "fecha" },
        { id: "check_out", label: "Check-Out", tipo: "fecha" },
        { id: "adultos", label: "Adultos", tipo: "numero" },
        { id: "ninos", label: "Niños", tipo: "numero" },
        { id: "precio_total", label: "Precio Total", tipo: "moneda" },
        { id: "abono", label: "Depósito / Abono", tipo: "moneda" },
        { id: "saldo_pendiente", label: "Saldo Pendiente", tipo: "moneda" },
        { id: "estado", label: "Estado", tipo: "estado" },
        { id: "correo", label: "Correo Electrónico", tipo: "texto" },
        { id: "telefono", label: "Móvil / Teléfono", tipo: "texto" },
        { id: "documento", label: "RUT / Pasaporte", tipo: "texto" },
        { id: "fuente", label: "Fuente", tipo: "texto" },
        { id: "pais", label: "País", tipo: "texto" }
    ];

    const CLAVE_COLUMNAS = "haikuReservasColumnasV1";
    const elementos = {
        buscar: document.getElementById("reservas-buscar"),
        contador: document.getElementById("reservas-contador"),
        chips: document.getElementById("reservas-chips"),
        estado: document.getElementById("reservas-estado"),
        cabecera: document.getElementById("reservas-tabla-cabecera"),
        cuerpo: document.getElementById("reservas-tabla-cuerpo"),
        vacio: document.getElementById("reservas-vacio"),
        rango: document.getElementById("reservas-rango"),
        porPagina: document.getElementById("reservas-por-pagina"),
        paginaActual: document.getElementById("reservas-pagina-actual"),
        anterior: document.getElementById("reservas-pagina-anterior"),
        siguiente: document.getElementById("reservas-pagina-siguiente"),
        recargar: document.getElementById("reservas-recargar"),
        abrirFiltros: document.getElementById("reservas-abrir-filtros"),
        panelFiltros: document.getElementById("reservas-panel-filtros"),
        cerrarFiltros: document.getElementById("reservas-cerrar-filtros"),
        aplicarFiltros: document.getElementById("reservas-aplicar-filtros"),
        quitarFiltros: document.getElementById("reservas-quitar-filtros"),
        elegirTodo: document.getElementById("reservas-filtros-elegir-todo"),
        desmarcarTodo: document.getElementById("reservas-filtros-desmarcar-todo"),
        abrirColumnas: document.getElementById("reservas-configurar-columnas"),
        panelColumnas: document.getElementById("reservas-panel-columnas"),
        cerrarColumnas: document.getElementById("reservas-cerrar-columnas"),
        columnasLista: document.getElementById("reservas-columnas-lista"),
        columnasRestablecer: document.getElementById("reservas-columnas-restablecer"),
        columnasListo: document.getElementById("reservas-columnas-listo"),
        filtroEstado: document.getElementById("reservas-filtro-estado"),
        filtroCategoria: document.getElementById("reservas-filtro-categoria")
    };

    const camposFiltro = {
        fecha_reserva: [
            document.getElementById("reservas-fecha-reserva-desde"),
            document.getElementById("reservas-fecha-reserva-hasta")
        ],
        checkin: [
            document.getElementById("reservas-checkin-desde"),
            document.getElementById("reservas-checkin-hasta")
        ],
        checkout: [
            document.getElementById("reservas-checkout-desde"),
            document.getElementById("reservas-checkout-hasta")
        ],
        estadia: [
            document.getElementById("reservas-estadia-desde"),
            document.getElementById("reservas-estadia-hasta")
        ],
        estado: [elementos.filtroEstado],
        categoria: [elementos.filtroCategoria],
        adultos: [document.getElementById("reservas-filtro-adultos")],
        ninos: [document.getElementById("reservas-filtro-ninos")]
    };

    let columnas = cargarColumnas();
    let filtros = filtrosVacios();
    let pagina = 1;
    let porPagina = 25;
    let total = 0;
    let orden = "fecha_reserva";
    let ascendente = false;
    let cargadoUnaVez = false;
    let tokenCarga = 0;
    let temporizadorBusqueda = null;

    function filtrosVacios() {
        return {
            busqueda: "",
            fecha_reserva: { activa: false, desde: null, hasta: null },
            checkin: { activa: false, desde: null, hasta: null },
            checkout: { activa: false, desde: null, hasta: null },
            estadia: { activa: false, desde: null, hasta: null },
            estado: { activa: false, valor: null },
            categoria: { activa: false, valor: null },
            adultos: { activa: false, valor: null },
            ninos: { activa: false, valor: null }
        };
    }

    function cargarColumnas() {
        try {
            const guardadas = JSON.parse(localStorage.getItem(CLAVE_COLUMNAS) || "null");
            if (!Array.isArray(guardadas)) return columnasIniciales();

            const idsValidos = new Set(COLUMNAS_BASE.map(item => item.id));
            const idsGuardados = new Set(guardadas.map(item => item && item.id));
            if (
                guardadas.length !== COLUMNAS_BASE.length ||
                idsGuardados.size !== COLUMNAS_BASE.length ||
                [...idsValidos].some(id => !idsGuardados.has(id))
            ) {
                return columnasIniciales();
            }

            return guardadas.map(item => ({
                id: item.id,
                visible: item.visible !== false
            }));
        } catch {
            return columnasIniciales();
        }
    }

    function columnasIniciales() {
        return COLUMNAS_BASE.map(item => ({ id: item.id, visible: true }));
    }

    function guardarColumnas() {
        try {
            localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify(columnas));
        } catch {}
    }

    function definicionColumna(id) {
        return COLUMNAS_BASE.find(item => item.id === id);
    }

    function columnasVisibles() {
        const visibles = columnas.filter(item => item.visible && definicionColumna(item.id));
        return visibles.length ? visibles : [columnas[0]];
    }

    function escapeHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function fechaVisible(valor) {
        const texto = String(valor || "");
        const coincidencia = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return coincidencia
            ? coincidencia[3] + "-" + coincidencia[2] + "-" + coincidencia[1]
            : "—";
    }

    function moneda(valor) {
        const numero = Number(valor);
        return Number.isFinite(numero)
            ? "$" + Math.round(numero).toLocaleString("es-CL")
            : "—";
    }

    function estadoVisible(valor) {
        const estados = {
            confirmada: "Confirmada",
            pendiente: "Pendiente",
            hospedada: "Hospedado",
            checked_out: "Checked Out",
            cancelada: "Cancelada",
            no_show: "No Show"
        };
        return estados[valor] || String(valor || "—").replaceAll("_", " ");
    }

    function etiquetaEstado(valor) {
        return estadoVisible(valor);
    }

    function mostrarEstado(mensaje, tipo = "") {
        elementos.estado.textContent = mensaje || "";
        if (tipo) elementos.estado.dataset.tipo = tipo;
        else delete elementos.estado.dataset.tipo;
    }

    function celdaHtml(fila, columna) {
        const valor = fila[columna.id];

        if (columna.tipo === "fecha") {
            return escapeHtml(fechaVisible(valor));
        }

        if (columna.tipo === "moneda") {
            return escapeHtml(moneda(valor));
        }

        if (columna.tipo === "estado") {
            return '<span class="reservas-estado-badge" data-estado="' +
                escapeHtml(valor || "") + '">' +
                escapeHtml(estadoVisible(valor)) +
                "</span>";
        }

        if (columna.id === "plan_tarifario" && fila.es_fullday) {
            return '<span class="reservas-plan-fullday" title="Derivado del tipo de estadía Full Day guardado en Proyecto H">Full Day</span>';
        }

        if (valor === null || valor === undefined || valor === "") {
            return '<span class="reservas-dato-faltante">—</span>';
        }

        return escapeHtml(valor);
    }

    function renderizarCabecera() {
        const celdas = columnasVisibles().map(item => {
            const columna = definicionColumna(item.id);
            const activa = orden === columna.id;
            const indicador = activa ? (ascendente ? "↑" : "↓") : "↕";
            return '<th scope="col"><button type="button" data-reservas-orden="' +
                escapeHtml(columna.id) + '">' +
                escapeHtml(columna.label) +
                '<span class="reservas-orden" aria-hidden="true">' + indicador + "</span>" +
                "</button></th>";
        }).join("");

        elementos.cabecera.innerHTML = "<tr>" + celdas + "</tr>";

        elementos.cabecera.querySelectorAll("[data-reservas-orden]").forEach(boton => {
            boton.addEventListener("click", () => {
                const nuevoOrden = boton.dataset.reservasOrden;
                if (orden === nuevoOrden) ascendente = !ascendente;
                else {
                    orden = nuevoOrden;
                    ascendente = true;
                }
                pagina = 1;
                cargarReservas();
            });
        });
    }

    function renderizarFilas(filas) {
        const visibles = columnasVisibles();

        elementos.cuerpo.innerHTML = filas.map(fila => {
            const celdas = visibles.map(item => {
                const columna = definicionColumna(item.id);
                const bruto = fila[columna.id];
                const titulo = bruto === null || bruto === undefined ? "" : String(bruto);
                return '<td data-columna="' + escapeHtml(columna.id) +
                    '" title="' + escapeHtml(titulo) + '">' +
                    celdaHtml(fila, columna) +
                    "</td>";
            }).join("");
            return '<tr data-reserva-id="' + escapeHtml(fila.reserva_id) + '">' + celdas + "</tr>";
        }).join("");

        elementos.vacio.hidden = filas.length !== 0;
        elementos.cabecera.closest("table").hidden = filas.length === 0;
    }

    function actualizarPaginacion() {
        const paginas = Math.max(1, Math.ceil(total / porPagina));
        if (pagina > paginas) pagina = paginas;

        const desde = total ? ((pagina - 1) * porPagina) + 1 : 0;
        const hasta = total ? Math.min(pagina * porPagina, total) : 0;

        elementos.contador.textContent = total + (total === 1 ? " reserva" : " reservas");
        elementos.rango.textContent = desde + "–" + hasta + " de " + total;
        elementos.paginaActual.textContent = String(pagina);
        elementos.anterior.disabled = pagina <= 1;
        elementos.siguiente.disabled = pagina >= paginas;
    }

    function valorNumero(campo) {
        const numero = Number(campo && campo.value);
        return Number.isInteger(numero) && numero >= 0 ? numero : null;
    }

    function estaActivo(nombre) {
        return document.querySelector('[data-filtro-activa="' + nombre + '"]')?.checked === true;
    }

    function leerFiltrosFormulario() {
        return {
            busqueda: String(elementos.buscar.value || "").trim(),
            fecha_reserva: {
                activa: estaActivo("fecha_reserva"),
                desde: camposFiltro.fecha_reserva[0].value || null,
                hasta: camposFiltro.fecha_reserva[1].value || null
            },
            checkin: {
                activa: estaActivo("checkin"),
                desde: camposFiltro.checkin[0].value || null,
                hasta: camposFiltro.checkin[1].value || null
            },
            checkout: {
                activa: estaActivo("checkout"),
                desde: camposFiltro.checkout[0].value || null,
                hasta: camposFiltro.checkout[1].value || null
            },
            estadia: {
                activa: estaActivo("estadia"),
                desde: camposFiltro.estadia[0].value || null,
                hasta: camposFiltro.estadia[1].value || null
            },
            estado: {
                activa: estaActivo("estado"),
                valor: elementos.filtroEstado.value || null
            },
            categoria: {
                activa: estaActivo("categoria"),
                valor: elementos.filtroCategoria.value || null
            },
            adultos: {
                activa: estaActivo("adultos"),
                valor: valorNumero(camposFiltro.adultos[0])
            },
            ninos: {
                activa: estaActivo("ninos"),
                valor: valorNumero(camposFiltro.ninos[0])
            }
        };
    }

    function parametrosRpc() {
        const f = filtros;
        return {
            p_busqueda: f.busqueda || null,
            p_fecha_reserva_desde: f.fecha_reserva.activa ? f.fecha_reserva.desde : null,
            p_fecha_reserva_hasta: f.fecha_reserva.activa ? f.fecha_reserva.hasta : null,
            p_checkin_desde: f.checkin.activa ? f.checkin.desde : null,
            p_checkin_hasta: f.checkin.activa ? f.checkin.hasta : null,
            p_checkout_desde: f.checkout.activa ? f.checkout.desde : null,
            p_checkout_hasta: f.checkout.activa ? f.checkout.hasta : null,
            p_estadia_desde: f.estadia.activa ? f.estadia.desde : null,
            p_estadia_hasta: f.estadia.activa ? f.estadia.hasta : null,
            p_estado: f.estado.activa ? f.estado.valor : null,
            p_categoria: f.categoria.activa ? f.categoria.valor : null,
            p_adultos: f.adultos.activa ? f.adultos.valor : null,
            p_ninos: f.ninos.activa ? f.ninos.valor : null,
            p_orden: orden,
            p_asc: ascendente,
            p_limite: porPagina,
            p_offset: (pagina - 1) * porPagina
        };
    }

    function rangoTexto(nombre, filtro) {
        if (!filtro.activa || (!filtro.desde && !filtro.hasta)) return null;
        const valor = filtro.desde && filtro.hasta
            ? fechaVisible(filtro.desde) + " → " + fechaVisible(filtro.hasta)
            : fechaVisible(filtro.desde || filtro.hasta);
        return { clave: nombre, texto: valor };
    }

    function chipsActivos() {
        const lista = [];
        if (filtros.busqueda) lista.push({ clave: "busqueda", texto: 'Buscar: "' + filtros.busqueda + '"' });

        [
            ["fecha_reserva", "Fecha reserva", filtros.fecha_reserva],
            ["checkin", "Check-In", filtros.checkin],
            ["checkout", "Check-Out", filtros.checkout],
            ["estadia", "Estadía", filtros.estadia]
        ].forEach(item => {
            const rango = rangoTexto(item[0], item[2]);
            if (rango) lista.push({ clave: rango.clave, texto: item[1] + ": " + rango.texto });
        });

        if (filtros.estado.activa && filtros.estado.valor) {
            lista.push({ clave: "estado", texto: "Estado: " + etiquetaEstado(filtros.estado.valor) });
        }
        if (filtros.categoria.activa && filtros.categoria.valor) {
            lista.push({ clave: "categoria", texto: "Categoría: " + filtros.categoria.valor });
        }
        if (filtros.adultos.activa && filtros.adultos.valor !== null) {
            lista.push({ clave: "adultos", texto: "Adultos: " + filtros.adultos.valor });
        }
        if (filtros.ninos.activa && filtros.ninos.valor !== null) {
            lista.push({ clave: "ninos", texto: "Niños: " + filtros.ninos.valor });
        }

        return lista;
    }

    function renderizarChips() {
        const activos = chipsActivos();
        elementos.chips.hidden = activos.length === 0;

        if (!activos.length) {
            elementos.chips.innerHTML = "";
            return;
        }

        elementos.chips.innerHTML = activos.map(chip =>
            '<span class="reservas-chip">' + escapeHtml(chip.texto) +
            '<button type="button" data-quitar-filtro="' + escapeHtml(chip.clave) +
            '" aria-label="Quitar filtro">×</button></span>'
        ).join("") +
        '<button type="button" class="reservas-chip reservas-chip--limpiar" data-quitar-filtro="todos">Quitar filtros</button>';

        elementos.chips.querySelectorAll("[data-quitar-filtro]").forEach(boton => {
            boton.addEventListener("click", () => quitarFiltro(boton.dataset.quitarFiltro));
        });
    }

    function quitarFiltro(clave) {
        if (clave === "todos") {
            limpiarFiltros();
            return;
        }

        if (clave === "busqueda") {
            filtros.busqueda = "";
            elementos.buscar.value = "";
        } else if (filtros[clave]) {
            filtros[clave].activa = false;
            const check = document.querySelector('[data-filtro-activa="' + clave + '"]');
            if (check) check.checked = false;
        }

        pagina = 1;
        renderizarChips();
        cargarReservas();
    }

    function limpiarFiltros() {
        filtros = filtrosVacios();
        elementos.buscar.value = "";
        document.querySelectorAll("[data-filtro-activa]").forEach(check => {
            check.checked = false;
        });
        Object.values(camposFiltro).flat().forEach(campo => {
            if (campo) campo.value = "";
        });
        pagina = 1;
        cerrarPanelFiltros();
        renderizarChips();
        cargarReservas();
    }

    function poblarSelect(select, valores, etiquetaTodos) {
        const anterior = select.value;
        select.innerHTML = '<option value="">' + escapeHtml(etiquetaTodos) + "</option>" +
            valores.map(valor =>
                '<option value="' + escapeHtml(valor) + '">' +
                escapeHtml(select === elementos.filtroEstado ? etiquetaEstado(valor) : valor) +
                "</option>"
            ).join("");
        if (valores.includes(anterior)) select.value = anterior;
    }

    function actualizarMetadatos(respuesta) {
        const categorias = Array.isArray(respuesta?.categorias_disponibles)
            ? respuesta.categorias_disponibles.filter(Boolean)
            : [];
        const estados = Array.isArray(respuesta?.estados_disponibles)
            ? respuesta.estados_disponibles.filter(Boolean)
            : [];

        poblarSelect(elementos.filtroCategoria, categorias, "Todas");
        poblarSelect(elementos.filtroEstado, estados, "Todos");
    }

    async function cargarReservas() {
        if (!window.haikuSesion) {
            mostrarEstado("Esperando una sesión autorizada…");
            return;
        }

        if (window.haikuTienePermiso?.("reservas.ver") !== true) {
            mostrarEstado("Tu usuario no tiene permiso para consultar Reservas.", "error");
            renderizarFilas([]);
            total = 0;
            actualizarPaginacion();
            return;
        }

        const token = ++tokenCarga;
        mostrarEstado("Cargando reservas…");
        elementos.recargar.disabled = true;

        try {
            const { data, error } = await cliente.rpc(
                "haiku_listar_reservas_v1",
                parametrosRpc()
            );

            if (token !== tokenCarga) return;
            if (error) throw error;

            const respuesta = data && typeof data === "object" ? data : {};
            const filas = Array.isArray(respuesta.reservas) ? respuesta.reservas : [];
            total = Number(respuesta.total || 0);
            cargadoUnaVez = true;

            actualizarMetadatos(respuesta);
            renderizarCabecera();
            renderizarFilas(filas);
            actualizarPaginacion();
            renderizarChips();
            mostrarEstado("");
        } catch (error) {
            if (token !== tokenCarga) return;
            console.error("HAIKU · Reservas V1:", error);
            mostrarEstado(
                "No fue posible cargar las reservas. Recarga o revisa tu conexión.",
                "error"
            );
            renderizarCabecera();
            renderizarFilas([]);
            total = 0;
            actualizarPaginacion();
        } finally {
            if (token === tokenCarga) elementos.recargar.disabled = false;
        }
    }

    function abrirPanelFiltros() {
        elementos.panelColumnas.hidden = true;
        elementos.abrirColumnas.setAttribute("aria-expanded", "false");
        elementos.panelFiltros.hidden = false;
        elementos.abrirFiltros.setAttribute("aria-expanded", "true");
    }

    function cerrarPanelFiltros() {
        elementos.panelFiltros.hidden = true;
        elementos.abrirFiltros.setAttribute("aria-expanded", "false");
    }

    function abrirPanelColumnas() {
        cerrarPanelFiltros();
        renderizarConfiguradorColumnas();
        elementos.panelColumnas.hidden = false;
        elementos.abrirColumnas.setAttribute("aria-expanded", "true");
    }

    function cerrarPanelColumnas() {
        elementos.panelColumnas.hidden = true;
        elementos.abrirColumnas.setAttribute("aria-expanded", "false");
    }

    function moverColumna(indice, desplazamiento) {
        const destino = indice + desplazamiento;
        if (destino < 0 || destino >= columnas.length) return;
        const copia = [...columnas];
        const temporal = copia[indice];
        copia[indice] = copia[destino];
        copia[destino] = temporal;
        columnas = copia;
        guardarColumnas();
        renderizarConfiguradorColumnas();
        renderizarCabecera();
        if (cargadoUnaVez) cargarReservas();
    }

    function renderizarConfiguradorColumnas() {
        elementos.columnasLista.innerHTML = columnas.map((item, indice) => {
            const columna = definicionColumna(item.id);
            return '<div class="reservas-columna-config">' +
                '<label><input type="checkbox" data-columna-visible="' + escapeHtml(item.id) + '"' +
                (item.visible ? " checked" : "") + "> " + escapeHtml(columna.label) + "</label>" +
                '<button type="button" data-columna-subir="' + indice + '" aria-label="Subir columna"' +
                (indice === 0 ? " disabled" : "") + ">↑</button>" +
                '<button type="button" data-columna-bajar="' + indice + '" aria-label="Bajar columna"' +
                (indice === columnas.length - 1 ? " disabled" : "") + ">↓</button>" +
                "</div>";
        }).join("");

        elementos.columnasLista.querySelectorAll("[data-columna-visible]").forEach(check => {
            check.addEventListener("change", () => {
                const item = columnas.find(columna => columna.id === check.dataset.columnaVisible);
                if (!item) return;

                const cantidadVisible = columnas.filter(columna => columna.visible).length;
                if (!check.checked && cantidadVisible <= 1) {
                    check.checked = true;
                    return;
                }

                item.visible = check.checked;
                guardarColumnas();
                renderizarCabecera();
                if (cargadoUnaVez) cargarReservas();
            });
        });

        elementos.columnasLista.querySelectorAll("[data-columna-subir]").forEach(boton => {
            boton.addEventListener("click", () => moverColumna(Number(boton.dataset.columnaSubir), -1));
        });

        elementos.columnasLista.querySelectorAll("[data-columna-bajar]").forEach(boton => {
            boton.addEventListener("click", () => moverColumna(Number(boton.dataset.columnaBajar), 1));
        });
    }

    function aplicarFiltros() {
        filtros = leerFiltrosFormulario();
        pagina = 1;
        cerrarPanelFiltros();
        renderizarChips();
        cargarReservas();
    }

    function activarTodosFiltros(activo) {
        document.querySelectorAll("[data-filtro-activa]").forEach(check => {
            check.checked = activo;
        });
    }

    botonMenu.addEventListener("click", () => {
        if (!cargadoUnaVez) cargarReservas();
    });

    elementos.recargar.addEventListener("click", cargarReservas);
    elementos.abrirFiltros.addEventListener("click", abrirPanelFiltros);
    elementos.cerrarFiltros.addEventListener("click", cerrarPanelFiltros);
    elementos.aplicarFiltros.addEventListener("click", aplicarFiltros);
    elementos.quitarFiltros.addEventListener("click", limpiarFiltros);
    elementos.elegirTodo.addEventListener("click", () => activarTodosFiltros(true));
    elementos.desmarcarTodo.addEventListener("click", () => activarTodosFiltros(false));
    elementos.abrirColumnas.addEventListener("click", abrirPanelColumnas);
    elementos.cerrarColumnas.addEventListener("click", cerrarPanelColumnas);
    elementos.columnasListo.addEventListener("click", cerrarPanelColumnas);
    elementos.columnasRestablecer.addEventListener("click", () => {
        columnas = columnasIniciales();
        guardarColumnas();
        renderizarConfiguradorColumnas();
        renderizarCabecera();
        if (cargadoUnaVez) cargarReservas();
    });

    elementos.porPagina.addEventListener("change", () => {
        porPagina = Number(elementos.porPagina.value) || 25;
        pagina = 1;
        cargarReservas();
    });

    elementos.anterior.addEventListener("click", () => {
        if (pagina <= 1) return;
        pagina -= 1;
        cargarReservas();
    });

    elementos.siguiente.addEventListener("click", () => {
        const paginas = Math.max(1, Math.ceil(total / porPagina));
        if (pagina >= paginas) return;
        pagina += 1;
        cargarReservas();
    });

    elementos.buscar.addEventListener("input", () => {
        clearTimeout(temporizadorBusqueda);
        temporizadorBusqueda = setTimeout(() => {
            filtros.busqueda = String(elementos.buscar.value || "").trim();
            pagina = 1;
            renderizarChips();
            cargarReservas();
        }, 350);
    });

    elementos.buscar.addEventListener("keydown", evento => {
        if (evento.key !== "Enter") return;
        clearTimeout(temporizadorBusqueda);
        filtros.busqueda = String(elementos.buscar.value || "").trim();
        pagina = 1;
        renderizarChips();
        cargarReservas();
    });

    window.addEventListener("keydown", evento => {
        if (evento.key !== "Escape") return;
        cerrarPanelFiltros();
        cerrarPanelColumnas();
    });

    window.addEventListener("haiku:auth-ready", () => {
        if (seccion.classList.contains("activa")) cargarReservas();
    });

    renderizarCabecera();
    renderizarConfiguradorColumnas();
    actualizarPaginacion();

    if (window.haikuSesion && seccion.classList.contains("activa")) {
        cargarReservas();
    }

    window.HAIKU_RESERVAS_V1 = Object.freeze({
        recargar: cargarReservas,
        estado: () => ({
            pagina,
            porPagina,
            total,
            orden,
            ascendente,
            filtros: structuredClone(filtros),
            columnas: structuredClone(columnas)
        })
    });
})();
