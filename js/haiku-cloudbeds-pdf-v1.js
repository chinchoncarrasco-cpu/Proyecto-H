/* Cloudbeds PDF 2C: extracción flexible y propuestas conservadoras de sólo lectura. */
(function (root) {
    "use strict";

    const MAPA = Object.freeze({ LC1: 1, LC2: 2, LC3: 3, LC4: 4, LC6: 6, CD5: 5, CD7: 7, CD8: 8, CD9: 9, C10: 10, C11: 11 });
    const CLASES = [
        "COINCIDE", "TOTAL_DIFERENTE", "REVISION_FINANCIERA",
        "FALTA_EN_PROYECTO_H", "CANCELADA", "MULTIHABITACION_REQUIERE_REVISION",
        "AMBIGUA", "NO_SOPORTADA"
    ];
    const CERTEZAS = ["SIN_CAMBIO", "ALTA_CERTEZA", "REVISION_MANUAL", "NO_APLICA", "NO_IDENTIFICADA"];
    const TOLERANCIA_CLP = 5;
    const IVA_REFERENCIAL = 1.19;
    const TARIFA_FULLDAY_PERSONA_CLP = 60000;
    const MIN_PERSONAS_FULLDAY = 2;
    const ESTADOS = new Set([
        "confirmada", "confirmado", "confirmed", "confirmacion pendiente", "pendiente",
        "checked out", "checked in", "hospedado", "cancelada", "cancelado", "no show"
    ]);

    const norm = valor => String(valor ?? "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/\s+/g, " ").trim();
    const canon = valor => norm(valor).replace(/[^a-z0-9]/g, "");
    const PARTICULAS_NOMBRE = new Set(["da", "das", "de", "del", "do", "dos", "el", "la", "las", "los", "y"]);

    function tokensNombre(valor) {
        const normalizado = norm(valor).replace(/[^a-z0-9]+/g, " ").trim();
        return normalizado ? normalizado.split(/\s+/) : [];
    }

    function esTokenSignificativo(token) {
        return Boolean(token) && !PARTICULAS_NOMBRE.has(token);
    }

    function esSubsecuenciaTokens(cortos, largos) {
        let indice = 0;
        for (const token of largos) {
            if (token === cortos[indice]) indice++;
            if (indice === cortos.length) return true;
        }
        return false;
    }

    function distanciaEdicionUno(izquierda, derecha) {
        if (izquierda === derecha || Math.abs(izquierda.length - derecha.length) > 1) return false;
        let i = 0;
        let j = 0;
        let cambios = 0;
        while (i < izquierda.length && j < derecha.length) {
            if (izquierda[i] === derecha[j]) {
                i++;
                j++;
                continue;
            }
            cambios++;
            if (cambios > 1) return false;
            if (izquierda.length > derecha.length) i++;
            else if (derecha.length > izquierda.length) j++;
            else {
                i++;
                j++;
            }
        }
        if (i < izquierda.length || j < derecha.length) cambios++;
        return cambios === 1;
    }

    function clasificarNombres(nombreProyectoH, nombreCloudbeds) {
        const proyecto = tokensNombre(nombreProyectoH);
        const cloudbeds = tokensNombre(nombreCloudbeds);
        if (!proyecto.length || !cloudbeds.length) return null;
        if (proyecto.length === cloudbeds.length && proyecto.every((token, indice) => token === cloudbeds[indice])) {
            return { tipo: "exacto", origen_corto: null, tokens_coincidentes: proyecto.length };
        }

        if (proyecto.length === cloudbeds.length) {
            const diferentes = proyecto
                .map((token, indice) => ({ proyecto: token, cloudbeds: cloudbeds[indice] }))
                .filter(par => par.proyecto !== par.cloudbeds);
            const significativosAlineados = proyecto.filter((token, indice) =>
                esTokenSignificativo(token) && esTokenSignificativo(cloudbeds[indice])
            ).length;
            if (diferentes.length === 1 && significativosAlineados >= 2
                && distanciaEdicionUno(diferentes[0].proyecto, diferentes[0].cloudbeds)) {
                return { tipo: "typo", origen_corto: null, tokens_coincidentes: proyecto.length - 1 };
            }
        }

        if (proyecto.length === cloudbeds.length) return null;
        const proyectoEsCorto = proyecto.length < cloudbeds.length;
        const cortos = proyectoEsCorto ? proyecto : cloudbeds;
        const largos = proyectoEsCorto ? cloudbeds : proyecto;
        const significativos = cortos.filter(esTokenSignificativo).length;
        if (significativos < 2 || !esSubsecuenciaTokens(cortos, largos)) return null;
        return {
            tipo: "parcial",
            origen_corto: proyectoEsCorto ? "proyecto_h" : "cloudbeds",
            tokens_coincidentes: cortos.length
        };
    }

    function comparteTokenSignificativo(nombreProyectoH, nombreCloudbeds) {
        const proyecto = new Set(tokensNombre(nombreProyectoH).filter(esTokenSignificativo));
        return tokensNombre(nombreCloudbeds).some(token => esTokenSignificativo(token) && proyecto.has(token));
    }

    const DEFINICIONES_COLUMNAS = Object.freeze([
        ["nombre", ["Nombre", "First name", "Nombre del huésped principal de la habitación"]],
        ["apellido", ["Apellido", "Surname", "Last name", "Apellido del huésped principal de la habitación"]],
        ["habitaciones_raw", ["Número De Habitación", "Numero de habitacion", "Número de habitación", "Núm. habitación", "Num. habitacion", "Room number", "Habitación"]],
        ["check_in", ["Check-In", "Check in", "Fecha de check-in", "Fecha de check-in de la habitación"]],
        ["check_out", ["Check-Out", "Check out", "Fecha de check-out", "Fecha de check-out de la habitación"]],
        ["noches", ["Noches", "Room length of stay", "Duración de la estancia en la habitación"]],
        ["precio_total", ["Precio Total", "Total price", "Grand total", "Total general"]],
        ["estado_generico", ["Estado", "Status"]],
        ["saldo_pendiente", ["Saldo Pendiente", "Balance due", "Reservation balance due", "Saldo pendiente de la reserva"]],
        ["total_habitacion", ["Total De La Habitación", "Total de la habitación", "Room total price", "Precio total de la habitación"]],
        ["ingresos_habitacion", ["Total de ingresos por habitación", "Room revenue total", "Ingresos por reserva de habitación", "Room reservation revenue"]],
        ["deposito", ["Depósito", "Deposito", "Deposit", "Suggested deposit", "Depósito sugerido"]],
        ["nombre_propiedad", ["Nombre de la propiedad", "Property name"]],
        ["hotel_collect_booking", ["Hotel Collect Booking", "Hotel collect"]],
        ["id_cloudbeds", ["ID", "Reservation ID", "ID de reserva", "Identificador de reserva"]],
        ["reserva_cloudbeds", ["Reserva", "Reservation", "Número de reserva", "Numero de reserva", "Res #"]],
        ["fuente", ["Fuente", "Source", "Reservation source"]],
        ["fecha_reserva", ["Fecha de la reserva", "Reservation date"]],
        ["fecha_reserva_huso", ["Fecha de la reserva (Huso horario)", "Fecha de reserva (Huso horario)", "Reservation date (Timezone)"]],
        ["adultos", ["Adultos", "Adults"]],
        ["ninos", ["Niños", "Ninos", "Children"]],
        ["habitacion_ids", ["Habitación ID", "Habitacion ID", "Room ID", "Identificador de la habitación"]],
        ["categoria_habitacion", ["Categoría de habitación", "Categoria de habitacion", "Room category", "Room type category"]],
        ["plan_comidas", ["Plan de comidas", "Meal plan"]],
        ["productos", ["Productos", "Products", "Additional items", "Productos adicionales"]],
        ["confirmacion_terceros", ["Número de confirmación de terceros", "Numero de confirmacion de terceros", "Third-party confirmation number"]],
        ["procedencia", ["Procedencia", "Origin"]],
        ["hora_estimada", ["Hora estimada", "Estimated arrival time", "ETA"]],
        ["cancelado_por_usuario", ["Canceled by user", "Cancelled by user", "Cancelado por usuario"]],
        ["origen_cancelacion", ["Origen de la cancelación", "Origen de la cancelacion", "Cancellation source"]],
        ["fecha_cancelacion", ["Fecha de cancelación", "Fecha de cancelacion", "Cancellation date"]],
        ["cargo_cancelacion", ["Cargo por cancelación", "Cargo por cancelacion", "Cancellation fee"]],
        ["etiquetas", ["Etiquetas", "Tags"]],
        ["nombre_huesped", ["Nombre y apellido", "Nombre completo", "Full name", "Room primary guest full name"]],
        ["fecha_nacimiento", ["Fecha de nacimiento", "Date of birth"]],
        ["genero", ["Género", "Genero", "Gender"]],
        ["correo", ["Correo electrónico", "Correo electronico", "Email", "E-mail"]],
        ["movil", ["Móvil", "Movil", "Mobile", "Cell phone"]],
        ["telefono", ["Teléfono", "Telefono", "Phone"]],
        ["tipo_documento", ["Tipo de documento", "Document type"]],
        ["pais_emisor_documento", ["País emisor del documento", "Pais emisor del documento", "Document issuing country"]],
        ["pais_emisor_documento_codigo", ["País emisor del documento Código", "Pais emisor del documento Codigo", "Document issuing country code"]],
        ["fecha_caducidad_documento", ["Fecha de caducidad del documento", "Document expiration date"]],
        ["fecha_emision_documento", ["Fecha de emisión del documento", "Fecha de emision del documento", "Document issue date"]],
        ["direccion", ["Dirección", "Direccion", "Address"]],
        ["apartamento", ["Apartamento, suite, piso, etc.", "Apartamento suite piso", "Address line 2"]],
        ["ciudad", ["Ciudad", "City"]],
        ["estado_direccion", ["Estado/Provincia", "Provincia", "State/Province", "Region"]],
        ["pais", ["País", "Pais", "Country"]],
        ["pais_codigo", ["País Código", "Pais Codigo", "Country code"]],
        ["codigo_postal", ["Código postal", "Codigo postal", "Postal code", "ZIP"]],
        ["nombre_perfil_grupo", ["Nombre del perfil del grupo", "Group profile name"]],
        ["tipo_perfil_grupo", ["Tipo de perfil de grupo", "Group profile type"]],
        ["plan_tarifa_interno", ["Nombre del plan de tarifas (interno)", "Rate plan private name", "Room rate plans - private names"]],
        ["plan_tarifa_publico", ["Nombre del plan de tarifas (público)", "Nombre del plan de tarifas (publico)", "Rate plan public name", "Room rate plans - public names"]],
        ["tipo_tarjeta", ["Tipo de tarjeta", "Card type"]]
    ].map(([key, aliases]) => Object.freeze({ key, aliases: Object.freeze(aliases) })));

    const ALIASES = new Map();
    DEFINICIONES_COLUMNAS.forEach(definicion => definicion.aliases.forEach(alias => ALIASES.set(canon(alias), definicion.key)));
    const HEAD = Object.freeze(Object.fromEntries([...ALIASES.entries()]));
    const MATRIZ_CAPACIDADES = Object.freeze({
        parsear: Object.freeze({ minimo: "Dos encabezados Cloudbeds conocidos y una fila delimitable", escritura: false }),
        identificar_fuerte: Object.freeze({ requiere: Object.freeze(["reserva_cloudbeds o id_cloudbeds inequívoco"]), escritura: false }),
        identificar_fallback: Object.freeze({ requiere: Object.freeze(["nombre exacto", "habitación", "check_in", "check_out", "coincidencia única"]), identidad_tipo: "CONTEXTO_EXACTO_UNICO", solo_revision: false, escritura: false }),
        identificar_typo: Object.freeze({ requiere: Object.freeze(["un carácter distinto en un único token", "al menos dos tokens significativos", "habitación y fechas exactas", "coincidencia única", "sin conflicto de identificadores"]), identidad_tipo: "CONTEXTO_TYPO_UNICO", solo_revision: false, escritura: false }),
        identificar_nombre_parcial: Object.freeze({ requiere: Object.freeze(["tokens completos en subsecuencia", "al menos dos tokens significativos", "habitación y fechas exactas", "coincidencia única", "sin conflicto de identificadores"]), identidad_tipo: "CONTEXTO_NOMBRE_PARCIAL_UNICO", solo_revision: false, escritura: false }),
        identificar_fullday: Object.freeze({ requiere: Object.freeze(["nombre exacto", "una habitación", "Cloudbeds D→D+1", "Proyecto H fullday D→D", "coincidencia única"]), identidad_tipo: "CONTEXTO_FULLDAY_UNICO", solo_revision: false, escritura: false }),
        comparar_alojamiento: Object.freeze({ requiere: Object.freeze(["identidad asociada", "Depósito válido", "Precio Total", "Productos presente", "total_alojamiento Proyecto H"]), escritura: false }),
        proponer_total: Object.freeze({ regla_propiedad: "Depósito = alojamiento bruto final con IVA; Productos queda fuera", tolerancia_clp: TOLERANCIA_CLP, escritura: false }),
        actualizar_tarifa: Object.freeze({ implementada: false, escritura: false })
    });

    function dinero(valor) {
        const texto = String(valor ?? "").trim().replace(/^(?:CLP\s*\$?|\$)\s*/i, "");
        if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(texto)) return null;
        const numero = Number(texto.replace(/\./g, ""));
        return Number.isSafeInteger(numero) ? numero : null;
    }

    function fecha(valor) {
        const match = String(valor ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!match) return null;
        const [dia, mes, ano] = match.slice(1).map(Number);
        const fechaUtc = new Date(Date.UTC(ano, mes - 1, dia));
        return fechaUtc.getUTCFullYear() === ano && fechaUtc.getUTCMonth() === mes - 1 && fechaUtc.getUTCDate() === dia
            ? `${match[3]}-${match[2]}-${match[1]}` : null;
    }

    const entero = valor => /^\d+$/.test(String(valor ?? "").trim()) ? Number(valor) : null;
    const contacto = valor => String(valor ?? "").trim() || null;
    const mascara = valor => /[*•●]|[xX]{3,}/.test(valor || "");
    const lista = valor => Array.isArray(valor) ? valor : valor === undefined ? [] : [valor];
    const primero = valor => lista(valor).map(contacto).find(Boolean) || null;
    const presente = (raw, key) => (raw._columnas_presentes || Object.keys(raw)).includes(key);

    function habitacionesDesde(raw) {
        const codigos = String(raw || "").replace(/\s+/g, "").split(",").filter(Boolean);
        return codigos.map(valor => {
            const match = valor.toUpperCase().match(/^([A-Z]+\d+)(?:\((\d+)\))?$/);
            return {
                raw: valor,
                codigo: match?.[1] || null,
                cantidad: match ? Number(match[2] || 1) : null,
                cabana: match ? MAPA[match[1]] ?? null : null
            };
        });
    }

    function normalizar(raw, origen = {}) {
        const habitacionesRaw = primero(raw.habitaciones_raw) || "";
        const habitaciones = habitacionesDesde(habitacionesRaw);
        const reservaCloudbeds = String(primero(raw.reserva_cloudbeds) || "").replace(/\s/g, "");
        const idCloudbeds = String(primero(raw.id_cloudbeds) || "").replace(/\s/g, "");
        const estadosGenericos = lista(raw.estado_generico).map(valor => norm(valor)).filter(Boolean);
        const estadoDirecto = norm(primero(raw.estado));
        const estado = estadoDirecto || estadosGenericos.find(valor => ESTADOS.has(valor)) || "";
        const estadoDireccion = primero(raw.estado_direccion) || lista(raw.estado_generico)
            .map(contacto).find(valor => valor && norm(valor) !== estado) || null;
        const nombreHuesped = primero(raw.nombre_huesped) || [primero(raw.nombre), primero(raw.apellido)].filter(Boolean).join(" ") || null;
        const precioTotal = dinero(primero(raw.precio_total));
        const totalHabitacion = dinero(primero(raw.total_habitacion));
        const ingresosHabitacion = dinero(primero(raw.ingresos_habitacion));
        const saldoPendiente = dinero(primero(raw.saldo_pendiente));
        const deposito = dinero(primero(raw.deposito));
        const checkInRaw = primero(raw.check_in);
        const checkOutRaw = primero(raw.check_out);
        const checkIn = fecha(checkInRaw);
        const checkOut = fecha(checkOutRaw);
        const noches = entero(primero(raw.noches));
        const habitacionIds = String(primero(raw.habitacion_ids) || "").split(/[\s,;]+/).filter(Boolean);
        const columnasPresentes = [...new Set(raw._columnas_presentes || Object.keys(raw).filter(key => !key.startsWith("_")))];
        const productos = primero(raw.productos);
        const productosColumnaPresente = columnasPresentes.includes("productos");
        const productosLista = productos
            ? String(productos).split(/[,;|]/).map(valor => valor.trim()).filter(Boolean)
            : [];
        const resultado = {
            reserva_cloudbeds: reservaCloudbeds,
            id_cloudbeds: idCloudbeds,
            identificador_cloudbeds: reservaCloudbeds || idCloudbeds || null,
            tipo_identificador_cloudbeds: reservaCloudbeds ? "reserva" : idCloudbeds ? "id" : null,
            identificadores_cloudbeds: Object.freeze({ reserva: reservaCloudbeds || null, id: idCloudbeds || null }),
            identificador_conflictivo: false,
            fecha_reserva: fecha(primero(raw.fecha_reserva)),
            fecha_reserva_huso: contacto(primero(raw.fecha_reserva_huso)),
            habitaciones_raw: habitacionesRaw,
            habitaciones,
            check_in: checkIn,
            check_out: checkOut,
            precio_total: precioTotal,
            total_habitacion: totalHabitacion,
            ingresos_habitacion: ingresosHabitacion,
            saldo_pendiente: saldoPendiente,
            deposito,
            productos,
            productos_lista: productosLista,
            productos_columna_presente: productosColumnaPresente,
            productos_celda_vacia: productosColumnaPresente && productosLista.length === 0,
            estado,
            estado_direccion: estadoDireccion,
            noches,
            adultos: entero(primero(raw.adultos)),
            ninos: entero(primero(raw.ninos)),
            habitacion_ids: habitacionIds,
            nombre: contacto(primero(raw.nombre)),
            apellido: contacto(primero(raw.apellido)),
            nombre_huesped: contacto(nombreHuesped),
            correo: contacto(primero(raw.correo)),
            movil: contacto(primero(raw.movil)),
            telefono: contacto(primero(raw.telefono)),
            fuente: contacto(primero(raw.fuente)),
            categoria_habitacion: contacto(primero(raw.categoria_habitacion)),
            plan_comidas: contacto(primero(raw.plan_comidas)),
            plan_tarifa_interno: contacto(primero(raw.plan_tarifa_interno)),
            plan_tarifa_publico: contacto(primero(raw.plan_tarifa_publico)),
            columnas_presentes: columnasPresentes,
            columnas_desconocidas: raw._columnas_desconocidas || [],
            columnas_duplicadas: raw._columnas_duplicadas || [],
            origen,
            advertencias: []
        };

        resultado.correo_enmascarado = mascara(resultado.correo);
        resultado.movil_enmascarado = mascara(resultado.movil);
        resultado.telefono_enmascarado = mascara(resultado.telefono);
        resultado.contactos_verificados = false;
        resultado.multihabitacion = habitaciones.length > 1 || habitaciones.some(item => item.cantidad > 1) || habitacionIds.length > 1;
        const dias = checkIn && checkOut ? (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000 : null;

        if (checkInRaw && !checkIn) resultado.advertencias.push("Check-in inválido.");
        if (checkOutRaw && !checkOut) resultado.advertencias.push("Check-out inválido.");
        if (noches !== null && dias !== null && noches !== dias) resultado.advertencias.push("Check-in, Check-out y Noches no coinciden.");
        if (presente(raw, "precio_total") && primero(raw.precio_total) && precioTotal === null) resultado.advertencias.push("Precio Total inválido.");
        if (presente(raw, "total_habitacion") && primero(raw.total_habitacion) && totalHabitacion === null) resultado.advertencias.push("Total de la habitación inválido.");
        if (presente(raw, "saldo_pendiente") && primero(raw.saldo_pendiente) && saldoPendiente === null) resultado.advertencias.push("Saldo Pendiente inválido.");
        if (presente(raw, "deposito") && primero(raw.deposito) && deposito === null) resultado.advertencias.push("Depósito inválido.");
        if (estado && !ESTADOS.has(estado)) resultado.advertencias.push("Estado de reserva no reconocido; se conserva como dato informativo.");
        if (totalHabitacion !== null && precioTotal !== null && Math.abs(totalHabitacion - precioTotal) > 5) {
            resultado.advertencias.push("Precio Total y Total de la habitación tienen alcances distintos.");
        }

        resultado.fuente_tarifa_propuesta = deposito !== null ? "deposito_100_alojamiento_haiku_cabanas" : null;
        resultado.valor_alojamiento_propuesto = deposito;
        resultado.valor_por_noche_referencia = !resultado.multihabitacion && noches > 0 && deposito !== null
            ? deposito / noches : null;
        const fallbackCompleto = Boolean(resultado.nombre_huesped && habitaciones.length === 1 && habitaciones[0].cabana && checkIn && checkOut);
        resultado.capacidades = Object.freeze({
            parsear: "disponible",
            identificar: resultado.identificador_cloudbeds ? "fuerte_o_contextual" : fallbackCompleto ? "contexto_exacto_posible" : "no_verificable",
            comparar_alojamiento: deposito !== null ? "candidato_deposito_regla_propiedad" : "requiere_deposito",
            actualizar_tarifa: "no_disponible_solo_lectura"
        });
        return resultado;
    }

    function agruparX(items, tolerancia) {
        const grupos = [];
        [...items].sort((a, b) => a.x - b.x || a.y - b.y).forEach(item => {
            let grupo = grupos.find(actual => Math.abs(actual.x - item.x) <= tolerancia);
            if (!grupo) {
                grupo = { x: item.x, items: [] };
                grupos.push(grupo);
            }
            grupo.items.push(item);
            grupo.x = Math.min(grupo.x, item.x);
        });
        return grupos.sort((a, b) => a.x - b.x);
    }

    function columnas(page) {
        if (!Array.isArray(page?.items) || !page.items.length) return null;
        let mejor = null;
        for (const ancla of page.items) {
            const alto = Math.max(Number(ancla.h) || 4, 2);
            const radio = Math.max(alto * 3, 12);
            const banda = page.items.filter(item => Math.abs(item.y - ancla.y) <= radio);
            const grupos = agruparX(banda, Math.max(alto * 1.25, 2.5));
            const cols = grupos.map((grupo, indice) => {
                const etiqueta = grupo.items.sort((a, b) => a.y - b.y || a.x - b.x)
                    .map(item => String(item.str || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
                return { id: `col-${indice}`, x: grupo.x, etiqueta, key: ALIASES.get(canon(etiqueta)) || null };
            });
            const conocidas = cols.filter(columna => columna.key);
            const claves = new Set(conocidas.map(columna => columna.key));
            const util = [...claves].some(key => [
                "reserva_cloudbeds", "id_cloudbeds", "nombre_huesped", "nombre", "habitaciones_raw",
                "check_in", "check_out", "precio_total", "total_habitacion", "saldo_pendiente", "deposito"
            ].includes(key));
            if (conocidas.length < 2 || !util) continue;
            const puntaje = conocidas.length * 100 + claves.size * 10 - banda.length;
            if (!mejor || puntaje > mejor.puntaje || (puntaje === mejor.puntaje && ancla.y < mejor.y)) {
                mejor = {
                    cols,
                    width: page.width,
                    inicio: Math.min(...banda.map(item => item.y)),
                    fin: Math.max(...banda.map(item => item.y)),
                    alto,
                    y: ancla.y,
                    puntaje,
                    reconocidas: conocidas.map(columna => columna.key),
                    desconocidas: cols.filter(columna => !columna.key).map(columna => columna.etiqueta).filter(Boolean)
                };
            }
        }
        if (!mejor) return null;
        delete mejor.y;
        delete mejor.puntaje;
        return mejor;
    }

    function columnaDe(item, cabecera) {
        const cols = cabecera.cols;
        for (let indice = 0; indice < cols.length; indice++) {
            const izquierda = indice === 0 ? -Infinity : (cols[indice - 1].x + cols[indice].x) / 2;
            const derecha = indice === cols.length - 1 ? Infinity : (cols[indice].x + cols[indice + 1].x) / 2;
            if (item.x >= izquierda && item.x < derecha) return cols[indice];
        }
        return null;
    }

    function valorAnclaValido(key, valor) {
        const texto = String(valor || "").trim();
        if (!texto) return false;
        if (["reserva_cloudbeds", "id_cloudbeds"].includes(key)) return /^[A-Za-z0-9][A-Za-z0-9-]{2,}$/.test(texto);
        if (["check_in", "check_out"].includes(key)) return Boolean(fecha(texto));
        if (["precio_total", "total_habitacion", "saldo_pendiente", "deposito", "ingresos_habitacion"].includes(key)) return dinero(texto) !== null;
        if (key === "habitaciones_raw") return Boolean(habitacionesDesde(texto).length) || /^N\/?A$/i.test(texto);
        return texto.length >= 2;
    }

    function agruparAnclas(items, distancia) {
        const grupos = [];
        [...items].sort((a, b) => a.y - b.y).forEach(item => {
            const ultimo = grupos.at(-1);
            if (!ultimo || item.y - ultimo.at(-1).y > distancia) grupos.push([item]);
            else ultimo.push(item);
        });
        return grupos.map(grupo => ({ y: grupo.reduce((suma, item) => suma + item.y, 0) / grupo.length, items: grupo }));
    }

    function anclasDe(items, cabecera) {
        const prioridades = [
            "reserva_cloudbeds", "id_cloudbeds", "check_in", "check_out", "habitaciones_raw",
            "total_habitacion", "precio_total", "nombre_huesped", "nombre", "correo"
        ];
        for (const key of prioridades) {
            for (const columna of cabecera.cols.filter(item => item.key === key)) {
                const candidatas = items.filter(item => columnaDe(item, cabecera)?.id === columna.id && valorAnclaValido(key, item.str));
                if (candidatas.length) return { key, columna, grupos: agruparAnclas(candidatas, Math.max(cabecera.alto * 3, 12)) };
            }
        }
        return null;
    }

    function rawDesdeCeldas(celdas, cabecera) {
        const raw = { _columnas_presentes: [], _columnas_desconocidas: [], _columnas_duplicadas: [] };
        const vistos = new Set();
        cabecera.cols.forEach(columna => {
            const valor = (celdas.get(columna.id) || []).sort((a, b) => a.y - b.y || a.x - b.x)
                .map(item => String(item.str || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
            if (!columna.key) {
                if (valor) raw._columnas_desconocidas.push({ encabezado: columna.etiqueta, valor });
                return;
            }
            raw._columnas_presentes.push(columna.key);
            if (!vistos.has(columna.key)) {
                raw[columna.key] = valor;
                vistos.add(columna.key);
            } else {
                raw[columna.key] = lista(raw[columna.key]).concat(valor);
                if (!raw._columnas_duplicadas.includes(columna.key)) raw._columnas_duplicadas.push(columna.key);
            }
        });
        raw._columnas_presentes = [...new Set(raw._columnas_presentes)];
        return raw;
    }

    function parsearPaginas(pages) {
        if (!Array.isArray(pages) || !pages.length) throw new Error("PDF vacío o inválido.");
        let cabecera = null;
        const entradas = [];
        for (let paginaIndice = 0; paginaIndice < pages.length; paginaIndice++) {
            const page = pages[paginaIndice];
            const propia = columnas(page);
            if (propia) cabecera = propia;
            if (!cabecera || Math.abs(Number(page.width) - Number(cabecera.width)) > 1) {
                throw new Error("PDF no Cloudbeds o sin una estructura tabular reconocible.");
            }
            const limiteSuperior = propia ? propia.fin + cabecera.alto : 30;
            const items = page.items.filter(item => String(item.str || "").trim() && item.y > limiteSuperior && item.y < page.height - 22);
            const anclas = anclasDe(items, cabecera);
            if (!anclas?.grupos?.length) continue;
            anclas.grupos.forEach((grupo, indice) => {
                const top = indice ? (anclas.grupos[indice - 1].y + grupo.y) / 2 : limiteSuperior;
                const bottom = indice + 1 < anclas.grupos.length ? (grupo.y + anclas.grupos[indice + 1].y) / 2 : page.height - 22;
                const celdas = new Map();
                items.filter(item => item.y >= top && item.y < bottom).forEach(item => {
                    const columna = columnaDe(item, cabecera);
                    if (!columna) return;
                    if (!celdas.has(columna.id)) celdas.set(columna.id, []);
                    celdas.get(columna.id).push(item);
                });
                const raw = rawDesdeCeldas(celdas, cabecera);
                entradas.push(normalizar(raw, {
                    pagina: paginaIndice + 1,
                    fila: indice + 1,
                    columna_ancla: anclas.key,
                    encabezados_reconocidos: [...new Set(cabecera.reconocidas)],
                    encabezados_desconocidos: cabecera.desconocidas
                }));
            });
        }
        if (!entradas.length) throw new Error("PDF Cloudbeds reconocido, pero no contiene filas delimitables.");
        return entradas;
    }

    async function leerPDF(bytes, { pdfjs, timeout = 30000 } = {}) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (data.length > 12 * 1024 * 1024) throw new Error("El PDF supera 12 MB.");
        if (new TextDecoder().decode(data.slice(0, 5)) !== "%PDF-") throw new Error("Archivo PDF inválido.");
        if (!pdfjs) {
            pdfjs = await import("../vendor/pdfjs/pdf.mjs");
            pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.mjs", root.document.baseURI).href;
        }
        const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, stopAtErrors: true, disableAutoFetch: true });
        let timer;
        try {
            return await Promise.race([
                (async () => {
                    const doc = await task.promise;
                    if (doc.numPages > 50) throw new Error("El PDF supera 50 páginas.");
                    const pages = [];
                    for (let numero = 1; numero <= doc.numPages; numero++) {
                        const pagina = await doc.getPage(numero);
                        const viewport = pagina.getViewport({ scale: 1 });
                        const contenido = await pagina.getTextContent();
                        pages.push({
                            width: viewport.width,
                            height: viewport.height,
                            items: contenido.items.filter(item => item.str?.trim()).map(item => ({
                                str: item.str,
                                x: item.transform[4],
                                y: viewport.height - item.transform[5],
                                w: item.width,
                                h: item.height
                            }))
                        });
                    }
                    return parsearPaginas(pages);
                })(),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("El PDF tardó demasiado. Intenta con un archivo más pequeño.")), timeout); })
            ]);
        } finally {
            clearTimeout(timer);
            await task.destroy();
        }
    }

    function sumarDiasIso(valor, dias) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""))) return null;
        const fechaUtc = new Date(`${valor}T00:00:00Z`);
        if (Number.isNaN(fechaUtc.getTime())) return null;
        fechaUtc.setUTCDate(fechaUtc.getUTCDate() + dias);
        return fechaUtc.toISOString().slice(0, 10);
    }

    function esVentanaFullDay(entrada) {
        return Boolean(entrada?.check_in && entrada?.check_out && sumarDiasIso(entrada.check_in, 1) === entrada.check_out);
    }

    function esEstadiaFullDay(estadia) {
        return norm(estadia?.tipo_estadia).replace(/[ _-]/g, "") === "fullday";
    }

    function estadiasContextoExacto(reserva, entrada, cabana) {
        const estadias = Array.isArray(reserva?.estadias) ? reserva.estadias : [];
        if (!cabana || !entrada.check_in || !entrada.check_out) return [];
        return estadias.filter(estadia =>
            !esEstadiaFullDay(estadia) &&
            Number(estadia.cabanas?.numero) === cabana &&
            estadia.fecha_ingreso === entrada.check_in &&
            estadia.fecha_salida === entrada.check_out
        );
    }

    function estadiasContextoFullDay(reserva, entrada, cabana) {
        const estadias = Array.isArray(reserva?.estadias) ? reserva.estadias : [];
        if (!cabana || !esVentanaFullDay(entrada)) return [];
        return estadias.filter(estadia =>
            esEstadiaFullDay(estadia) &&
            Number(estadia.cabanas?.numero) === cabana &&
            estadia.fecha_ingreso === entrada.check_in &&
            estadia.fecha_salida === entrada.check_in
        );
    }

    function coincidenciasContexto(reserva, entrada, cabana) {
        return [
            ...estadiasContextoExacto(reserva, entrada, cabana).map(estadia => ({ estadia, tipo: "exacto" })),
            ...estadiasContextoFullDay(reserva, entrada, cabana).map(estadia => ({ estadia, tipo: "fullday" }))
        ];
    }

    function resolverContexto(reservas, entrada, cabana) {
        const completo = Boolean(entrada.nombre_huesped && cabana && entrada.check_in && entrada.check_out);
        if (!completo) return { completo: false, candidatas: [], ambiguas_estadia: [], con_coincidencia: [], coincidencias: [], coincidencias_geometricas: [], nombres_inseguros: [] };
        const candidatas = [];
        const ambiguasEstadia = [];
        const conCoincidencia = [];
        const coincidencias = [];
        const coincidenciasGeometricas = [];
        const nombresInseguros = [];
        reservas.forEach(reserva => {
            const geometricas = coincidenciasContexto(reserva, entrada, cabana);
            if (!geometricas.length) return;
            coincidenciasGeometricas.push(...geometricas.map(item => ({ ...item, reserva })));
            const nombre = clasificarNombres(reserva.titular_nombre, entrada.nombre_huesped);
            if (!nombre && comparteTokenSignificativo(reserva.titular_nombre, entrada.nombre_huesped)) {
                nombresInseguros.push(...geometricas.map(item => ({ ...item, reserva })));
            }
            const compatibles = geometricas.filter(item => item.tipo === "fullday" || nombre);
            if (!compatibles.length) return;
            conCoincidencia.push(reserva);
            coincidencias.push(...compatibles.map(item => ({
                ...item,
                reserva,
                nombre_tipo: nombre?.tipo || null,
                nombre_exacto: nombre?.tipo === "exacto",
                nombre_corto_origen: nombre?.origen_corto || null
            })));
            if (compatibles.length === 1) candidatas.push(reserva);
            else ambiguasEstadia.push(reserva);
        });
        return {
            completo: true,
            candidatas,
            ambiguas_estadia: ambiguasEstadia,
            con_coincidencia: conCoincidencia,
            coincidencias,
            coincidencias_geometricas: coincidenciasGeometricas,
            nombres_inseguros: nombresInseguros
        };
    }

    function enteroSeguroCampo(valor) {
        if (valor === null || valor === undefined || valor === "") return null;
        const numero = Number(valor);
        return Number.isSafeInteger(numero) ? numero : null;
    }

    function comparar(entradas, reservas, saldos) {
        const saldosPorReserva = new Map(saldos.map(saldo => [saldo.reserva_id, saldo]));
        const conteos = Object.fromEntries(CLASES.map(clase => [clase, 0]));
        const conteosCerteza = Object.fromEntries(CERTEZAS.map(certeza => [certeza, 0]));
        const numeros = entradas.map(entrada => entrada.reserva_cloudbeds).filter(Boolean);
        const ids = entradas.map(entrada => entrada.id_cloudbeds).filter(Boolean);
        const numerosRepetidos = new Set(numeros.filter((valor, indice) => numeros.indexOf(valor) !== indice));
        const idsRepetidos = new Set(ids.filter((valor, indice) => ids.indexOf(valor) !== indice));

        const filas = entradas.map(entrada => {
            const evidencias = [];
            const revisiones = [];
            let certeza = null;
            let candidatas = [];
            let identidad = null;
            let identidadTipo = "NO_IDENTIFICADA";
            let vinculoCloudbedsSugerido = null;
            const cabana = entrada.habitaciones.length === 1 ? entrada.habitaciones[0].cabana : null;
            const fallbackCompleto = Boolean(entrada.nombre_huesped && cabana && entrada.check_in && entrada.check_out);
            const contexto = resolverContexto(reservas, entrada, cabana);
            const canceladaCloudbeds = ["cancelada", "cancelado"].includes(entrada.estado);

            const aplicarContexto = () => {
                const usaNombreFlexible = contexto.coincidencias.some(item => ["typo", "parcial"].includes(item.nombre_tipo));
                const ambiguo = contexto.ambiguas_estadia.length > 0
                    || contexto.coincidencias.length > 1
                    || contexto.candidatas.length > 1
                    || (usaNombreFlexible && contexto.coincidencias_geometricas.length !== 1);
                if (ambiguo) {
                    identidadTipo = "AMBIGUA";
                    certeza = "REVISION_MANUAL";
                    revisiones.push("El contexto coincide con más de una reserva o estadía compatible.");
                    return;
                }
                if (contexto.candidatas.length === 1) {
                    const candidata = contexto.candidatas[0];
                    const coincidencia = contexto.coincidencias[0];
                    if (String(candidata.cloudbeds_id || "").trim()) {
                        identidadTipo = "AMBIGUA";
                        certeza = "REVISION_MANUAL";
                        revisiones.push("El contexto exacto apunta a una reserva que ya tiene otro vínculo Cloudbeds guardado.");
                        return;
                    }
                    candidatas = [candidata];
                    const esFullDay = coincidencia?.tipo === "fullday";
                    const identidadNombre = coincidencia?.nombre_tipo === "typo"
                        ? "CONTEXTO_TYPO_UNICO"
                        : coincidencia?.nombre_tipo === "parcial" ? "CONTEXTO_NOMBRE_PARCIAL_UNICO" : null;
                    identidadTipo = identidadNombre || (esFullDay ? "CONTEXTO_FULLDAY_UNICO" : "CONTEXTO_EXACTO_UNICO");
                    identidad = identidadNombre
                        ? "Reserva identificada por contexto único"
                        : esFullDay ? "Reserva Full Day identificada por contexto único" : "Reserva identificada por contexto exacto";
                    evidencias.push(`${identidad}.`);
                    if (identidadTipo === "CONTEXTO_NOMBRE_PARCIAL_UNICO") {
                        evidencias.push(coincidencia.nombre_corto_origen === "proyecto_h"
                            ? "Proyecto H contiene una versión abreviada del nombre."
                            : "Cloudbeds contiene una versión abreviada del nombre.");
                    } else if (identidadTipo === "CONTEXTO_TYPO_UNICO") {
                        evidencias.push("Los nombres difieren en un único carácter de un único token.");
                    }
                    evidencias.push(esFullDay
                        ? "Proyecto H aún no tiene vínculo Cloudbeds guardado. Cabaña, patrón de fechas Full Day y estadía única sostienen la identidad."
                        : identidadNombre
                            ? "Proyecto H aún no tiene vínculo Cloudbeds guardado. Nombre compatible, cabaña, check-in y check-out identifican una única reserva."
                            : "Proyecto H aún no tiene vínculo Cloudbeds guardado. Nombre, cabaña, check-in y check-out identifican una única reserva.");
                    vinculoCloudbedsSugerido = {
                        reserva_id: candidatas[0].id,
                        reservation_number: entrada.reserva_cloudbeds || null,
                        reservation_id: entrada.id_cloudbeds || null,
                        evidencia: identidadTipo.toLowerCase()
                    };
                    if (esFullDay && !coincidencia.nombre_exacto) {
                        if (!identidadNombre) {
                            certeza = "REVISION_MANUAL";
                            revisiones.push("La cabaña y las fechas Full Day identifican una única estadía, pero el nombre no coincide exactamente ni satisface una regla controlada.");
                        }
                    }
                    return;
                }
                if (contexto.coincidencias_geometricas.length === 1 && contexto.nombres_inseguros.length === 1) {
                    identidadTipo = "AMBIGUA";
                    certeza = "REVISION_MANUAL";
                    revisiones.push("La cabaña y las fechas coinciden, pero el nombre sólo comparte evidencia insuficiente para identificar la reserva.");
                    return;
                }
                identidadTipo = "NO_IDENTIFICADA";
                certeza = "NO_IDENTIFICADA";
                revisiones.push(entrada.identificador_cloudbeds
                    ? "ID/Reserva no aparece en Proyecto H y el contexto exacto tampoco identifica una reserva accesible."
                    : "El contexto exacto no identifica una reserva accesible.");
            };

            if (canceladaCloudbeds) {
                certeza = "NO_APLICA";
                revisiones.push("La reserva está cancelada en Cloudbeds; el Depósito histórico no genera propuesta.");
            } else if (entrada.estado === "no show") {
                certeza = "REVISION_MANUAL";
                revisiones.push("No-show requiere revisión porque su semántica financiera no es inequívoca.");
            } else if (entrada.multihabitacion) {
                identidadTipo = "AMBIGUA";
                certeza = "REVISION_MANUAL";
                revisiones.push("La fila contiene varias habitaciones o segmentos; no se distribuye el Depósito automáticamente.");
            } else if (numerosRepetidos.has(entrada.reserva_cloudbeds) || idsRepetidos.has(entrada.id_cloudbeds)) {
                identidadTipo = "AMBIGUA";
                certeza = "REVISION_MANUAL";
                revisiones.push("Un mismo ID o Reserva aparece en más de una fila del PDF.");
            } else if (entrada.reserva_cloudbeds || entrada.id_cloudbeds) {
                const porReserva = entrada.reserva_cloudbeds
                    ? reservas.filter(reserva => String(reserva.cloudbeds_id || "").trim() === entrada.reserva_cloudbeds) : [];
                const porId = entrada.id_cloudbeds
                    ? reservas.filter(reserva => String(reserva.cloudbeds_id || "").trim() === entrada.id_cloudbeds) : [];
                const unicas = new Map([...porReserva, ...porId].map(reserva => [reserva.id, reserva]));
                if (porReserva.length > 1 || porId.length > 1 || (porReserva.length && porId.length && unicas.size > 1)) {
                    identidadTipo = "AMBIGUA";
                    certeza = "REVISION_MANUAL";
                    revisiones.push("ID y Reserva de Cloudbeds no identifican una única reserva de Proyecto H.");
                } else if (!unicas.size) {
                    aplicarContexto();
                } else {
                    candidatas = [[...unicas.values()][0]];
                    identidadTipo = porReserva.length ? "CLOUDBEDS_RESERVA_EXACTA" : "CLOUDBEDS_ID_EXACTO";
                    identidad = porReserva.length ? "Reserva Cloudbeds exacta" : "ID Cloudbeds exacto";
                    evidencias.push(identidad);
                    if (porReserva.length) evidencias.push("El importador de listado conserva la columna Reserva en reservas.cloudbeds_id.");
                    else evidencias.push("Coincidencia con vínculo histórico; el campo legado no distingue tipo de identificador.");
                    if (fallbackCompleto) {
                        if (contexto.con_coincidencia.some(reserva => reserva.id !== candidatas[0].id)) {
                            candidatas = [];
                            identidadTipo = "AMBIGUA";
                            certeza = "REVISION_MANUAL";
                            revisiones.push("El identificador fuerte y el fallback contextual apuntan a reservas distintas.");
                        }
                    }
                }
            } else if (fallbackCompleto) {
                aplicarContexto();
            } else {
                identidadTipo = "NO_IDENTIFICADA";
                certeza = "NO_IDENTIFICADA";
                revisiones.push("Faltan ID/Reserva y el contexto completo nombre + habitación + fechas.");
            }

            const reserva = candidatas.length === 1 ? candidatas[0] : null;
            const estadias = Array.isArray(reserva?.estadias) ? reserva.estadias : [];
            const saldoProyectoH = reserva ? saldosPorReserva.get(reserva.id) : null;
            const totalProyectoH = enteroSeguroCampo(saldoProyectoH?.total_alojamiento);
            const totalValido = Number.isSafeInteger(totalProyectoH);
            const pagadoProyectoH = enteroSeguroCampo(saldoProyectoH?.pagado_alojamiento);
            const saldoActualProyectoH = enteroSeguroCampo(saldoProyectoH?.saldo_alojamiento);
            const coincidenciasReserva = reserva ? coincidenciasContexto(reserva, entrada, cabana) : [];
            const coincidenciaReserva = coincidenciasReserva.length === 1 ? coincidenciasReserva[0] : null;
            const estadiaContextual = coincidenciaReserva?.estadia || null;
            const esFullDay = coincidenciaReserva?.tipo === "fullday";
            const adultosProyectoH = enteroSeguroCampo(estadiaContextual?.adultos);
            const ninosProyectoH = enteroSeguroCampo(estadiaContextual?.ninos);
            const mascotasProyectoH = enteroSeguroCampo(estadiaContextual?.mascotas);
            const referenciaFullDay = esFullDay && adultosProyectoH === 2 && ninosProyectoH === 0
                ? TARIFA_FULLDAY_PERSONA_CLP * MIN_PERSONAS_FULLDAY : null;
            if (reserva && esFullDay) {
                evidencias.push(`Proyecto H: Full Day ${estadiaContextual.fecha_ingreso} → ${estadiaContextual.fecha_salida}.`);
                evidencias.push(`Cloudbeds: ${entrada.check_in} → ${entrada.check_out}, representación D → D+1 de Full Day.`);
                evidencias.push(`Misma cabaña: CAB ${cabana}.`);
                if (referenciaFullDay !== null) {
                    evidencias.push(`Referencia Full Day comprobable: 2 × $${TARIFA_FULLDAY_PERSONA_CLP.toLocaleString("es-CL")} = $${referenciaFullDay.toLocaleString("es-CL")}.`);
                } else {
                    evidencias.push("La composición de personas no permite generalizar una tarifa infantil; Depósito sigue siendo la fuente primaria.");
                }
            }

            if (reserva && !certeza) {
                if (reserva.grupo_reserva_id || estadias.length !== 1) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("Proyecto H contiene un grupo o más de una estadía; v31 no debe recibir una distribución inferida.");
                } else if (norm(reserva.estado_reserva).replace(/ /g, "_") === "cancelada") {
                    certeza = "NO_APLICA";
                    revisiones.push("La reserva asociada está cancelada en Proyecto H.");
                } else if (norm(reserva.estado_reserva).replace(/ /g, "_") === "no_show") {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("La reserva asociada es no-show y requiere revisión financiera.");
                }
            }

            if (reserva && !certeza) {
                if (!cabana || !entrada.check_in || !entrada.check_out) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("Para alta certeza se requieren habitación, check-in y check-out.");
                } else if (!coincidenciaReserva) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("El vínculo existe, pero habitación o fechas contradicen Proyecto H.");
                } else {
                    if (esFullDay && !["CONTEXTO_TYPO_UNICO", "CONTEXTO_NOMBRE_PARCIAL_UNICO"].includes(identidadTipo)) {
                        if (norm(reserva.titular_nombre) !== norm(entrada.nombre_huesped)) {
                            certeza = "REVISION_MANUAL";
                            revisiones.push("El nombre Cloudbeds no coincide exactamente con Proyecto H; no se usa coincidencia difusa.");
                        }
                    } else {
                        evidencias.push(`Contexto exacto: cabaña ${cabana}, ${entrada.check_in} → ${entrada.check_out}.`);
                    }
                }
                if (!certeza && (!entrada.estado || !ESTADOS.has(entrada.estado))) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("Falta un estado Cloudbeds reconocido para confirmar que la reserva es operable.");
                }
            }

            if (reserva && !certeza) {
                if (!Number.isSafeInteger(entrada.deposito) || entrada.deposito <= 0) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("Depósito falta, es inválido o no es un entero CLP positivo.");
                } else {
                    evidencias.push("Regla Haiku Cabañas: Depósito representa 100% del alojamiento bruto final con IVA.");
                }
                if (!certeza && referenciaFullDay !== null) {
                    if (Math.abs(entrada.deposito - referenciaFullDay) > TOLERANCIA_CLP) {
                        certeza = "REVISION_MANUAL";
                        revisiones.push("El Depósito no coincide con la referencia Full Day comprobable de 2 adultos y 0 niños.");
                    } else {
                        evidencias.push("El Depósito Cloudbeds coincide con la tarifa Full Day de la propiedad.");
                    }
                }
                if (!certeza && (!Number.isSafeInteger(entrada.precio_total) || entrada.precio_total <= 0)) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("Precio Total falta o es inválido; no se puede corroborar la separación de productos.");
                }
                if (!certeza && !entrada.productos_columna_presente) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("La columna Productos está ausente; no se asume que no existan extras.");
                }
                if (!certeza && entrada.precio_total < entrada.deposito - TOLERANCIA_CLP) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("Precio Total es menor que Depósito; contradicción financiera.");
                }
                if (!certeza && entrada.productos_celda_vacia && Math.abs(entrada.precio_total - entrada.deposito) > TOLERANCIA_CLP) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("Productos está presente y vacío, pero Precio Total no coincide con Depósito.");
                }
                if (!certeza && entrada.productos_lista.length && entrada.precio_total <= entrada.deposito + TOLERANCIA_CLP) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("Hay productos declarados, pero Precio Total no contiene un componente adicional observable.");
                }
                if (!certeza && entrada.productos_lista.length) {
                    evidencias.push(`Productos declarados; componente no alojamiento observable: $${(entrada.precio_total - entrada.deposito).toLocaleString("es-CL")}.`);
                } else if (!certeza) {
                    evidencias.push("Productos presente y vacío; Precio Total coincide con Depósito dentro de tolerancia.");
                }
                if (!certeza && entrada.total_habitacion !== null) {
                    if (!Number.isSafeInteger(entrada.total_habitacion) || entrada.total_habitacion <= 0 || entrada.total_habitacion > entrada.deposito + TOLERANCIA_CLP) {
                        certeza = "REVISION_MANUAL";
                        revisiones.push("Total habitación contradice el Depósito bruto final.");
                    } else {
                        const brutoReferencial = Math.round(entrada.total_habitacion * IVA_REFERENCIAL);
                        const corroboraIva = Math.abs(brutoReferencial - entrada.deposito) <= TOLERANCIA_CLP;
                        evidencias.push(corroboraIva
                            ? "Total habitación × 1,19 corrobora el Depósito (señal referencial, no regla universal)."
                            : "Total habitación se conserva como referencia neta aproximada; el IVA 1,19 no corrobora este caso y no reemplaza al Depósito.");
                    }
                }
                if (!certeza && !totalValido) {
                    certeza = "REVISION_MANUAL";
                    revisiones.push("El total efectivo de alojamiento de Proyecto H no está disponible como entero CLP.");
                }
            }

            const candidato = Number.isSafeInteger(entrada.deposito) && entrada.deposito > 0 ? entrada.deposito : null;
            const diferencia = candidato !== null && totalValido ? candidato - totalProyectoH : null;
            const saldoEsperado = candidato !== null && pagadoProyectoH !== null ? candidato - pagadoProyectoH : null;
            if (reserva && !certeza) {
                certeza = Math.abs(diferencia) <= TOLERANCIA_CLP ? "SIN_CAMBIO" : "ALTA_CERTEZA";
                evidencias.push(certeza === "SIN_CAMBIO"
                    ? "Depósito y alojamiento efectivo coinciden dentro de $5 CLP."
                    : "Todas las señales mínimas son coherentes; existe una propuesta informativa.");
            }

            const clase = certeza === "SIN_CAMBIO" ? "COINCIDE"
                : certeza === "ALTA_CERTEZA" ? "TOTAL_DIFERENTE"
                    : certeza === "NO_APLICA" ? "CANCELADA"
                        : certeza === "NO_IDENTIFICADA" ? (entrada.identificador_cloudbeds ? "FALTA_EN_PROYECTO_H" : "NO_SOPORTADA")
                            : entrada.multihabitacion || reserva?.grupo_reserva_id || estadias.length > 1
                                ? "MULTIHABITACION_REQUIERE_REVISION" : "REVISION_FINANCIERA";
            const motivo = revisiones[0] || evidencias.at(-1) || "Revisión conservadora de sólo lectura.";
            const componenteNoAlojamiento = candidato !== null && entrada.precio_total !== null
                ? entrada.precio_total - candidato : null;
            const propuesta = {
                reserva_id: reserva?.id || null,
                estadia_id: estadiaContextual?.id || null,
                cloudbeds_id: reserva?.cloudbeds_id || null,
                reservation_id: entrada.id_cloudbeds || null,
                reservation_number: entrada.reserva_cloudbeds || null,
                cabana,
                check_in: entrada.check_in,
                check_out: entrada.check_out,
                tipo_estadia_proyecto_h: estadiaContextual?.tipo_estadia || null,
                fecha_ingreso_proyecto_h: estadiaContextual?.fecha_ingreso || null,
                fecha_salida_proyecto_h: estadiaContextual?.fecha_salida || null,
                nombre_cloudbeds: entrada.nombre_huesped || null,
                nombre_proyecto_h: reserva?.titular_nombre || null,
                nombre_parcial_origen: contexto.coincidencias[0]?.nombre_corto_origen || null,
                es_full_day: esFullDay,
                adultos_proyecto_h: adultosProyectoH,
                ninos_proyecto_h: ninosProyectoH,
                mascotas_proyecto_h: mascotasProyectoH,
                tarifa_fullday_persona_clp: esFullDay ? TARIFA_FULLDAY_PERSONA_CLP : null,
                minimo_personas_fullday: esFullDay ? MIN_PERSONAS_FULLDAY : null,
                referencia_fullday_clp: referenciaFullDay,
                total_actual_haku: totalValido ? totalProyectoH : null,
                pagado_actual_haku: pagadoProyectoH,
                saldo_actual_haku: saldoActualProyectoH,
                saldo_esperado_haku: saldoEsperado,
                precio_total_cloudbeds: entrada.precio_total,
                total_habitacion_cloudbeds: entrada.total_habitacion,
                deposito_cloudbeds: entrada.deposito,
                productos: entrada.productos_lista,
                productos_columna_presente: entrada.productos_columna_presente,
                total_alojamiento_propuesto: certeza === "ALTA_CERTEZA" || certeza === "SIN_CAMBIO" ? candidato : null,
                componente_no_alojamiento_observable: componenteNoAlojamiento,
                diferencia,
                certeza,
                identidad_tipo: identidadTipo,
                vinculo_cloudbeds_sugerido: vinculoCloudbedsSugerido,
                evidencias,
                revisiones,
                distribucion_v31: estadias.length === 1
                    ? "Una estadía: el total canónico corresponde al alojamiento completo; una futura escritura exigiría revalidación v31."
                    : "Sin distribución automática.",
                solo_lectura: true,
                actualizacion_disponible: false
            };

            conteos[clase]++;
            conteosCerteza[certeza]++;
            return {
                clase,
                certeza,
                identidad_tipo: identidadTipo,
                motivo,
                evidencia: identidad,
                evidencias,
                revisiones,
                vinculo_cloudbeds_sugerido: vinculoCloudbedsSugerido,
                entrada,
                reserva_id: propuesta.reserva_id,
                total_proyecto_h: propuesta.total_actual_haku,
                total_cloudbeds_alojamiento: propuesta.total_alojamiento_propuesto,
                fuente_financiera: candidato !== null ? "deposito_100_alojamiento_haiku_cabanas" : null,
                diferencia,
                propuesta,
                actualizacion: { disponible: false, estado: "solo_lectura_2c" }
            };
        });
        return {
            solo_lectura: true,
            total: filas.length,
            conteos,
            conteos_certeza: conteosCerteza,
            filas,
            matriz_capacidades: MATRIZ_CAPACIDADES
        };
    }

    function filtrarInforme(informe, filtro = {}) {
        const dia = filtro.fecha || null;
        const desde = filtro.desde || dia;
        const hasta = filtro.hasta || (dia ? dia : null);
        const buscada = norm(filtro.reserva);
        const filas = informe.filas.filter(fila => {
            const entrada = fila.entrada;
            const coincideReserva = !buscada || [fila.reserva_id, entrada.reserva_cloudbeds, entrada.id_cloudbeds]
                .some(valor => norm(valor) === buscada);
            const finRango = hasta || desde;
            const coincideFecha = !desde || !finRango || Boolean(
                entrada.check_in && entrada.check_out && entrada.check_in <= finRango && entrada.check_out > desde
            );
            return coincideReserva && coincideFecha;
        });
        const conteos = Object.fromEntries(CLASES.map(clase => [clase, filas.filter(fila => fila.clase === clase).length]));
        const conteosCerteza = Object.fromEntries(CERTEZAS.map(certeza => [certeza, filas.filter(fila => fila.certeza === certeza).length]));
        return { ...informe, total: filas.length, filas, conteos, conteos_certeza: conteosCerteza, filtro: { fecha: dia, desde, hasta, reserva: filtro.reserva || null } };
    }

    async function consultar(entradas, cliente) {
        async function leer(tabla, campos, orden) {
            const resultado = [];
            for (let inicio = 0; inicio < 20000; inicio += 500) {
                const { data, error } = await cliente.from(tabla).select(campos).order(orden).range(inicio, inicio + 499);
                if (error) throw new Error("No se pudo consultar Proyecto H. No se clasifican reservas como faltantes.");
                if (!Array.isArray(data)) throw new Error("Respuesta incompleta de Proyecto H.");
                resultado.push(...data);
                if (data.length < 500) return resultado;
            }
            throw new Error("Consulta demasiado amplia; requiere revisión.");
        }
        const [reservas, saldos] = await Promise.all([
            leer("reservas", "id,cloudbeds_id,titular_nombre,estado_reserva,grupo_reserva_id,estadias:reserva_estadias(id,fecha_ingreso,fecha_salida,tipo_estadia,adultos,ninos,mascotas,cabanas(numero))", "id"),
            leer("vista_saldos_alojamiento_reserva", "reserva_id,total_alojamiento,pagado_alojamiento,saldo_alojamiento", "reserva_id")
        ]);
        return comparar(entradas, reservas, saldos);
    }

    function renderizar(informe) {
        const esc = valor => String(valor ?? "—").replace(/[&<>"']/g, caracter => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[caracter]);
        const moneda = valor => valor === null || valor === undefined
            ? "No disponible"
            : `${Number(valor) < 0 ? "-" : ""}$${Math.abs(Number(valor)).toLocaleString("es-CL")}`;
        const labels = {
            SIN_CAMBIO: "Coinciden", ALTA_CERTEZA: "Propuestas seguras",
            REVISION_MANUAL: "Revisión manual", NO_APLICA: "Canceladas / no aplica",
            NO_IDENTIFICADA: "No identificadas"
        };
        const resumen = `<div class="haiku-cloudbeds-resumen">${CERTEZAS.map(certeza =>
            `<span><strong>${esc(informe.conteos_certeza?.[certeza] || 0)}</strong> ${esc(labels[certeza])}</span>`).join("")}</div>`;
        const detalles = CERTEZAS.map(certeza => `<details data-certeza="${certeza}"><summary>${esc(labels[certeza])} · ${informe.conteos_certeza?.[certeza] || 0}</summary>${informe.filas
            .filter(fila => fila.certeza === certeza).map(fila => {
                const entrada = fila.entrada;
                const identidad = entrada.nombre_huesped || entrada.identificador_cloudbeds || "Fila Cloudbeds";
                const diferencia = fila.diferencia === null ? "No calculable" : `${fila.diferencia > 0 ? "+" : ""}${moneda(fila.diferencia)}`;
                const propuesta = fila.propuesta;
                return `<article style="border-top:1px solid #dce6e0;padding:10px 0;overflow-wrap:anywhere"><strong>${esc(identidad)}</strong>
                    <p>${esc(entrada.habitaciones_raw || "Habitación no incluida")} · ${esc(entrada.check_in)} → ${esc(entrada.check_out)} · ${esc(entrada.noches)} noches</p>
                    <p>Proyecto H: ${esc(moneda(propuesta.total_actual_haku))} · Depósito candidato: ${esc(moneda(propuesta.total_alojamiento_propuesto))} · Diferencia: ${esc(diferencia)}</p>
                    <p>Precio Total: ${esc(moneda(entrada.precio_total))} · Productos: ${esc(entrada.productos_columna_presente ? entrada.productos || "Sin productos" : "Columna ausente")} · Componente no alojamiento: ${esc(moneda(propuesta.componente_no_alojamiento_observable))}</p>
                    <p>Total habitación (referencial): ${esc(moneda(entrada.total_habitacion))} · Saldo (nunca tarifa): ${esc(moneda(entrada.saldo_pendiente))} · Depósito: ${esc(moneda(entrada.deposito))}</p>
                    <p><strong>${esc(fila.certeza)}</strong> · ${esc(fila.motivo)}</p>
                    ${fila.evidencias.length ? `<ul>${fila.evidencias.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}
                    ${fila.revisiones.length ? `<ul>${fila.revisiones.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}
                    <small>Reserva Cloudbeds: ${esc(entrada.reserva_cloudbeds)} · ID Cloudbeds: ${esc(entrada.id_cloudbeds)} · Página ${esc(entrada.origen.pagina)}<br>
                    Capacidad de identidad: ${esc(entrada.capacidades.identificar)} · Tarifa: ${esc(entrada.capacidades.comparar_alojamiento)}<br>
                    Columnas reconocidas: ${esc(entrada.columnas_presentes.join(", "))}<br>
                    Columnas desconocidas conservadas: ${esc(entrada.columnas_desconocidas.map(item => item.encabezado).join(", ") || "ninguna")}<br>
                    SOLO LECTURA · no existe acción de escritura.</small></article>`;
            }).join("")}</details>`).join("");
        return `<section class="haiku-cloudbeds-informe"><strong>Cloudbeds · propuestas conservadoras de sólo lectura</strong>
            <p>Revisé ${informe.total} entradas. Depósito es el único candidato a alojamiento según la regla de esta propiedad.</p>
            <p>Precio Total incluye alojamiento y productos; Total habitación sólo puede corroborar; Saldo nunca es tarifa. No se crean ni modifican datos.</p>
            ${resumen}${detalles}</section>`;
    }

    const api = Object.freeze({
        MAPA, CLASES, CERTEZAS, HEAD, COLUMNAS: DEFINICIONES_COLUMNAS, MATRIZ_CAPACIDADES,
        TOLERANCIA_CLP, IVA_REFERENCIAL, TARIFA_FULLDAY_PERSONA_CLP, MIN_PERSONAS_FULLDAY,
        dinero, fecha, tokensNombre, clasificarNombres, normalizar, columnas, parsearPaginas, leerPDF, esVentanaFullDay, comparar, filtrarInforme, consultar, renderizar
    });
    root.HAIKU_CLOUDBEDS_PDF_V1 = api;
    if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
