// ========================================
// RESERVAS · TABLA SITES DE SOLO LECTURA
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
        { id: "guest", label: "Huésped / reserva", orden: "nombre", principal: true, inicial: true },
        { id: "cabin", label: "Cabaña", orden: "cabanas", principal: true, inicial: true },
        { id: "stay", label: "Estadía", orden: "check_in", principal: true, inicial: true },
        { id: "pax", label: "Huéspedes", inicial: true },
        { id: "total", label: "Precio total", orden: "precio_total", inicial: true },
        { id: "deposit", label: "Depósito / abono", orden: "abono", inicial: true },
        { id: "due", label: "Saldo pendiente", orden: "saldo_pendiente", inicial: true },
        { id: "status", label: "Estado", orden: "estado", principal: true, inicial: true },
        { id: "created", label: "Fecha reserva", orden: "fecha_reserva" },
        { id: "plan", label: "Plan", orden: "plan_tarifario" },
        { id: "adults", label: "Adultos", orden: "adultos" },
        { id: "children", label: "Niños", orden: "ninos" },
        { id: "email", label: "Correo electrónico", orden: "correo" },
        { id: "phone", label: "Móvil / teléfono", orden: "telefono" },
        { id: "document", label: "RUT / pasaporte", orden: "documento" },
        { id: "country", label: "País", orden: "pais" }
    ];

    const CLAVE_COLUMNAS = "haikuReservasColumnasSitesV1";
    const elementos = {
        buscar: document.getElementById("reservas-buscar"),
        contador: document.getElementById("reservas-contador"),
        chips: document.getElementById("reservas-chips"),
        estado: document.getElementById("reservas-estado"),
        cabecera: document.getElementById("reservas-tabla-cabecera"),
        cuerpo: document.getElementById("reservas-tabla-cuerpo"),
        listaMovil: document.getElementById("reservas-mobile-list"),
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
        columnasMostrarTodas: document.getElementById("reservas-columnas-mostrar-todas"),
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
    let filasActuales = [];
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
            if (guardadas.length !== COLUMNAS_BASE.length || idsGuardados.size !== COLUMNAS_BASE.length ||
                [...idsValidos].some(id => !idsGuardados.has(id))) return columnasIniciales();

            return COLUMNAS_BASE.map(definicion => ({
                id: definicion.id,
                visible: definicion.principal || guardadas.find(item => item.id === definicion.id)?.visible === true
            }));
        } catch {
            return columnasIniciales();
        }
    }

    function columnasIniciales() {
        return COLUMNAS_BASE.map(item => ({ id: item.id, visible: item.inicial === true }));
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
        return visibles;
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
        if (valor === null || valor === undefined || valor === "") return "—";
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
        elementos.estado.hidden = !mensaje;
        elementos.estado.classList.toggle("rv-error", tipo === "error");
        if (tipo) elementos.estado.dataset.tipo = tipo;
        else delete elementos.estado.dataset.tipo;
    }

    function titular(fila) {
        return [fila.nombre, fila.apellido].filter(Boolean).join(" ").trim() || "Sin titular registrado";
    }

    function cabanasVisibles(fila) {
        return String(fila.cabanas || "").replace(/\bCAB\s+(\d+)\b/g, "Cabaña $1") || "—";
    }

    function variasEstadias(fila) {
        // La RPC agrega cada estadía con este separador, incluso si repite cabaña.
        return String(fila.cabanas || "").includes(" → ");
    }

    function planVisible(fila) {
        if (!fila.plan_tarifario) return "";
        return variasEstadias(fila) && fila.es_fullday ? "Incluye Full Day" : String(fila.plan_tarifario);
    }

    function duracionVisible(fila) {
        if (variasEstadias(fila)) return "Varias estadías";
        if (fila.es_fullday) return "Full Day";
        if (!fila.check_in || !fila.check_out) return "";
        const ingreso = new Date(`${String(fila.check_in).slice(0, 10)}T12:00:00`);
        const salida = new Date(`${String(fila.check_out).slice(0, 10)}T12:00:00`);
        const noches = Math.max(0, Math.round((salida - ingreso) / 86400000));
        return Number.isFinite(noches) ? `${noches} ${noches === 1 ? "noche" : "noches"}` : "";
    }

    function huespedesVisibles(fila) {
        const adultos = fila.adultos == null ? NaN : Number(fila.adultos);
        const ninos = fila.ninos == null ? NaN : Number(fila.ninos);
        const partes = [];
        const prefijo = variasEstadias(fila) ? "hasta " : "";
        if (Number.isFinite(adultos)) partes.push(`${prefijo}${adultos} ${adultos === 1 ? "adulto" : "adultos"}`);
        if (Number.isFinite(ninos) && ninos > 0) partes.push(`${prefijo}${ninos} ${ninos === 1 ? "niño" : "niños"}`);
        const texto = partes.join(" · ") || "—";
        return variasEstadias(fila) && texto !== "—" ? `${texto} por estadía` : texto;
    }

    function estadoClase(estado) {
        return ({ pendiente: "pending", confirmada: "confirmed", hospedada: "occupied",
            checked_out: "departed", cancelada: "cancelled", no_show: "cancelled" })[estado] || "";
    }

    function insigniaEstado(fila) {
        return `<span class="rv-badge ${estadoClase(fila.estado)}">${escapeHtml(estadoVisible(fila.estado))}</span>`;
    }

    function sublineaReserva(fila) {
        const partes = [fila.codigo_haiku, fila.fecha_reserva ? fechaVisible(fila.fecha_reserva) : ""].filter(Boolean);
        return partes.length ? `<small class="rv-subline">${escapeHtml(partes.join(" · "))}</small>` : "";
    }

    function celdaHtml(fila, columna) {
        const id = escapeHtml(fila.reserva_id);
        switch (columna.id) {
            case "guest":
                return `<button type="button" class="rv-name" data-abrir-reserva="${id}" aria-label="Ver reserva de ${escapeHtml(titular(fila))}">${escapeHtml(titular(fila))}</button>${sublineaReserva(fila)}`;
            case "cabin":
                return `<span class="rv-cabin">${escapeHtml(cabanasVisibles(fila))}</span>${planVisible(fila) ? `<small class="rv-subline">${escapeHtml(planVisible(fila))}</small>` : ""}`;
            case "stay":
                return `<span class="rv-stay">${escapeHtml(fechaVisible(fila.check_in))} <i>→</i> ${escapeHtml(fechaVisible(fila.check_out))}</span><small class="rv-subline">${escapeHtml(duracionVisible(fila))}</small>`;
            case "pax": return `<span class="rv-nowrap">${escapeHtml(huespedesVisibles(fila))}</span>`;
            case "total": return `<strong class="rv-money">${escapeHtml(moneda(fila.precio_total))}</strong>`;
            case "deposit": return `<span class="rv-money secondary">${escapeHtml(moneda(fila.abono))}</span>`;
            case "due": {
                const saldo = Number(fila.saldo_pendiente);
                const tono = Number.isFinite(saldo) && saldo > 0 ? "owing" : "settled";
                return `<strong class="rv-money ${tono}">${escapeHtml(moneda(fila.saldo_pendiente))}</strong>`;
            }
            case "status": return insigniaEstado(fila);
            case "created": return escapeHtml(fechaVisible(fila.fecha_reserva));
            case "plan": return escapeHtml(planVisible(fila) || "—");
            case "adults": return fila.adultos == null ? "—" : escapeHtml(variasEstadias(fila) ? `Máx. ${fila.adultos}` : fila.adultos);
            case "children": return fila.ninos == null ? "—" : escapeHtml(variasEstadias(fila) ? `Máx. ${fila.ninos}` : fila.ninos);
            case "email": return escapeHtml(fila.correo || "—");
            case "phone": return escapeHtml(fila.telefono || "—");
            case "document": return escapeHtml(fila.documento || "—");
            case "country": return escapeHtml(fila.pais || "—");
            default: return "—";
        }
    }

    function renderizarCabecera() {
        const celdas = columnasVisibles().map(item => {
            const columna = definicionColumna(item.id);
            const activa = orden === columna.orden;
            const indicador = activa ? (ascendente ? "↑" : "↓") : "↕";
            const contenido = columna.orden
                ? `<button type="button" data-reservas-orden="${escapeHtml(columna.orden)}">${escapeHtml(columna.label)} <span class="reservas-orden" aria-hidden="true">${indicador}</span></button>`
                : escapeHtml(columna.label);
            return `<th scope="col" data-columna="${escapeHtml(columna.id)}" class="rv-col-${escapeHtml(columna.id)}">${contenido}</th>`;
        }).join("");

        elementos.cabecera.innerHTML = `<tr>${celdas}<th scope="col" class="rv-detail-col">Detalle</th></tr>`;

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
        filasActuales = filas;
        const visibles = columnasVisibles();
        const visiblesMovil = new Set(visibles.map(item => item.id));

        elementos.cuerpo.innerHTML = filas.map(fila => {
            const celdas = visibles.map(item => {
                const columna = definicionColumna(item.id);
                return `<td data-columna="${escapeHtml(columna.id)}" class="rv-col-${escapeHtml(columna.id)}">${celdaHtml(fila, columna)}</td>`;
            }).join("");
            const id = escapeHtml(fila.reserva_id);
            const atencion = fila.estado === "checked_out" && Number(fila.saldo_pendiente) > 0 ? " rv-needs-attention" : "";
            return `<tr data-reserva-id="${id}" class="${atencion.trim()}">${celdas}<td class="rv-detail-col"><button type="button" data-abrir-reserva="${id}" aria-label="Ver detalle de ${escapeHtml(titular(fila))}">›</button></td></tr>`;
        }).join("");

        elementos.listaMovil.innerHTML = filas.map(fila => {
            const id = escapeHtml(fila.reserva_id);
            const atencion = fila.estado === "checked_out" && Number(fila.saldo_pendiente) > 0 ? " attention" : "";
            const finanzas = [
                visiblesMovil.has("pax") ? `<span data-columna="pax">${escapeHtml(huespedesVisibles(fila))}</span>` : "",
                visiblesMovil.has("total") ? `<span data-columna="total">Total ${escapeHtml(moneda(fila.precio_total))}</span>` : "",
                visiblesMovil.has("deposit") ? `<span data-columna="deposit">Abono ${escapeHtml(moneda(fila.abono))}</span>` : ""
            ].filter(Boolean).join('<span aria-hidden="true"> · </span>');
            return `<article class="rv-mobile-row${atencion}" data-reserva-id="${id}">
                <div class="rv-mobile-main"><button type="button" data-columna="guest" data-abrir-reserva="${id}"><strong>${escapeHtml(titular(fila))}</strong><small>${escapeHtml([fila.codigo_haiku, fila.fecha_reserva ? fechaVisible(fila.fecha_reserva) : ""].filter(Boolean).join(" · "))}</small></button><span data-columna="status">${insigniaEstado(fila)}</span></div>
                <div class="rv-mobile-meta"><span data-columna="cabin">${escapeHtml(cabanasVisibles(fila))}</span><span data-columna="stay">${escapeHtml(fechaVisible(fila.check_in))} → ${escapeHtml(fechaVisible(fila.check_out))}</span>${visiblesMovil.has("due") ? `<strong data-columna="due" class="${Number(fila.saldo_pendiente) > 0 ? "owing" : "settled"}">${escapeHtml(moneda(fila.saldo_pendiente))}</strong>` : ""}</div>
                <div class="rv-mobile-finance">${finanzas}<button type="button" data-abrir-reserva="${id}">Ver detalle</button></div>
            </article>`;
        }).join("");

        elementos.vacio.hidden = filas.length !== 0;
        elementos.cabecera.closest("table").hidden = filas.length === 0;
        elementos.listaMovil.hidden = filas.length === 0;
    }

    function actualizarPaginacion() {
        const paginas = Math.max(1, Math.ceil(total / porPagina));
        if (pagina > paginas) pagina = paginas;

        const desde = total ? ((pagina - 1) * porPagina) + 1 : 0;
        const hasta = total ? Math.min(pagina * porPagina, total) : 0;
        const esperando = !cargadoUnaVez && elementos.estado.dataset.tipo !== "error";

        elementos.contador.textContent = esperando ? "— reservas" : total + (total === 1 ? " reserva" : " reservas");
        elementos.rango.textContent = esperando ? "—" : desde + "–" + hasta + " de " + total;
        elementos.paginaActual.textContent = String(pagina);
        elementos.anterior.disabled = pagina <= 1;
        elementos.siguiente.disabled = pagina >= paginas;
    }

    function valorNumero(campo) {
        if (!campo || String(campo.value || "").trim() === "") return null;
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

    function vaciarListado(mensaje, tipo = "") {
        ++tokenCarga;
        cargadoUnaVez = false;
        total = 0;
        renderizarFilas([]);
        mostrarEstado(mensaje, tipo);
        actualizarPaginacion();
        elementos.recargar.disabled = false;
    }

    async function agregarCodigosPagina(filas) {
        const ids = [...new Set(filas.map(fila => fila.reserva_id).filter(Boolean))];
        if (!ids.length) return filas;
        try {
            const { data, error } = await cliente.from("reservas")
                .select("id,codigo_haiku")
                .in("id", ids);
            if (error) throw error;
            const codigos = new Map((Array.isArray(data) ? data : [])
                .map(item => [String(item.id), String(item.codigo_haiku || "").trim()]));
            return filas.map(fila => ({ ...fila, codigo_haiku: codigos.get(String(fila.reserva_id)) || "" }));
        } catch (error) {
            console.warn("HAIKU · No se pudo leer el código visible de esta página de Reservas.", error);
            return filas;
        }
    }

    async function cargarReservas() {
        if (!window.haikuSesion) {
            vaciarListado("Esperando una sesión autorizada…");
            return;
        }

        if (window.haikuTienePermiso?.("reservas.ver") !== true) {
            vaciarListado("Tu usuario no tiene permiso para consultar Reservas.", "error");
            return;
        }

        const token = ++tokenCarga;
        const sesionSolicitante = window.haikuSesion;
        mostrarEstado("Cargando reservas…");
        elementos.recargar.disabled = true;

        try {
            const { data, error } = await cliente.rpc(
                "haiku_listar_reservas_v1",
                parametrosRpc()
            );

            if (token !== tokenCarga) return;
            if (window.haikuSesion !== sesionSolicitante ||
                window.haikuTienePermiso?.("reservas.ver") !== true) {
                vaciarListado("La sesión cambió. Actualiza Reservas para continuar.", "error");
                return;
            }
            if (error) throw error;

            const respuesta = data && typeof data === "object" ? data : {};
            const filas = Array.isArray(respuesta.reservas) ? respuesta.reservas : [];
            total = Number(respuesta.total || 0);
            const paginas = Math.max(1, Math.ceil(total / porPagina));
            if (pagina > paginas) {
                pagina = paginas;
                cargarReservas();
                return;
            }
            const filasConCodigo = await agregarCodigosPagina(filas);
            if (token !== tokenCarga) return;
            if (window.haikuSesion !== sesionSolicitante ||
                window.haikuTienePermiso?.("reservas.ver") !== true) {
                vaciarListado("La sesión cambió. Actualiza Reservas para continuar.", "error");
                return;
            }
            cargadoUnaVez = true;

            actualizarMetadatos(respuesta);
            renderizarCabecera();
            renderizarFilas(filasConCodigo);
            actualizarPaginacion();
            renderizarChips();
            mostrarEstado("");
        } catch (error) {
            if (token !== tokenCarga) return;
            if (window.haikuSesion !== sesionSolicitante ||
                window.haikuTienePermiso?.("reservas.ver") !== true) {
                vaciarListado("La sesión cambió. Actualiza Reservas para continuar.", "error");
                return;
            }
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

    function renderizarConfiguradorColumnas() {
        elementos.columnasLista.innerHTML = columnas.map(item => {
            const columna = definicionColumna(item.id);
            return `<label><input type="checkbox" data-columna-visible="${escapeHtml(item.id)}"${item.visible ? " checked" : ""}${columna.principal ? " disabled" : ""}> ${escapeHtml(columna.label)}${columna.principal ? "<small>principal</small>" : ""}</label>`;
        }).join("");

        elementos.columnasLista.querySelectorAll("[data-columna-visible]").forEach(check => {
            check.addEventListener("change", () => {
                const item = columnas.find(columna => columna.id === check.dataset.columnaVisible);
                if (!item) return;
                if (definicionColumna(item.id)?.principal && !check.checked) {
                    check.checked = true;
                    return;
                }
                item.visible = check.checked;
                guardarColumnas();
                renderizarCabecera();
                renderizarFilas(filasActuales);
            });
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
        renderizarFilas(filasActuales);
    });

    elementos.columnasMostrarTodas.addEventListener("click", () => {
        columnas = COLUMNAS_BASE.map(item => ({ id: item.id, visible: true }));
        guardarColumnas();
        renderizarConfiguradorColumnas();
        renderizarCabecera();
        renderizarFilas(filasActuales);
    });

    seccion.addEventListener("click", async evento => {
        const boton = evento.target.closest("[data-abrir-reserva]");
        if (!boton || !seccion.contains(boton)) return;
        const reservaId = boton.dataset.abrirReserva;
        if (!filasActuales.some(fila => String(fila.reserva_id) === reservaId)) return;
        const abrir = window.HAIKU_RESUMEN_RESERVA_SITES_V1?.abrirPorId;
        if (typeof abrir !== "function") {
            mostrarEstado("No se pudo abrir el detalle de esta reserva. Recarga la página.", "error");
            return;
        }
        boton.disabled = true;
        try {
            await abrir(reservaId, boton);
        } finally {
            boton.disabled = false;
        }
    });

    document.addEventListener("click", evento => {
        if (!elementos.panelFiltros.hidden && !elementos.panelFiltros.parentElement.contains(evento.target)) cerrarPanelFiltros();
        if (!elementos.panelColumnas.hidden && !elementos.panelColumnas.parentElement.contains(evento.target)) cerrarPanelColumnas();
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

    cliente.auth?.onAuthStateChange?.(evento => {
        if (evento === "SIGNED_OUT") vaciarListado("Esperando una sesión autorizada…");
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
