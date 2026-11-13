/* Haku · Comparación de Informes Cloudbeds y revisión de pagos. */
(function (root) {
    "use strict";

    const doc = root.document;
    const informes = root.HAIKU_CLOUDBEDS_INFORMES_V1;
    if (!doc || !informes) return;
    const workerUrl = new URL("supabase-libro-reserva-worker-v1.js", doc.currentScript.src);
    workerUrl.search = new URL(doc.currentScript.src).search;

    const listas = Object.freeze({ reservas: "Reservas", transacciones: "Transacciones", cancelaciones: "Cancelaciones", notas: "Notas" });
    const estados = Object.freeze({
        coincide: "Coincide", dato_distinto: "Dato distinto", por_verificar: "Por verificar",
        falta: "Falta", informativo: "Informativo"
    });
    const formato = new Intl.NumberFormat("es-CL");
    const cantidad = (n, singular, plural = singular + "s") => formato.format(n) + " " + (n === 1 ? singular : plural);
    const lista = v => Array.isArray(v) ? v : [];
    const unico = v => [...new Set(v.filter(Boolean))];

    function leerXLSX(buffer) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(workerUrl);
            const timer = setTimeout(() => terminar(null, "El XLSX tardó demasiado."), 30000);
            function terminar(data, error) {
                clearTimeout(timer);
                worker.terminate();
                if (error) reject(new Error(error)); else resolve(data);
            }
            worker.onmessage = ({ data }) => terminar(data?.resultado, data?.ok ? null : data?.error || "No pude leer el XLSX.");
            worker.onerror = () => terminar(null, "No pude iniciar el lector de Excel.");
            worker.postMessage({ id: 1, tipo: "cloudbeds_tablas", buffer }, [buffer]);
        });
    }

    async function leerArchivo(file, tipo) {
        const bytes = await file.arrayBuffer();
        if (tipo === "xlsx") return informes.parsearXLSX(await leerXLSX(bytes), file.name);
        const paginas = await root.HAIKU_CLOUDBEDS_PDF_V1.leerPaginasPDF(bytes);
        return informes.parsearPDF(paginas, file.name);
    }

    async function paginas(consulta, signal, campo = "id") {
        const filas = [];
        for (let inicio = 0; inicio < 10000; inicio += 500) {
            if (signal.aborted) throw new Error("Consulta interrumpida.");
            let q = consulta().order(campo).range(inicio, inicio + 499);
            if (typeof q.abortSignal === "function") q = q.abortSignal(signal);
            const { data, error } = await q;
            if (error || !Array.isArray(data)) throw new Error("Lectura incompleta.");
            filas.push(...data);
            if (data.length < 500) return filas;
        }
        throw new Error("La consulta supera el límite de lectura.");
    }

    async function porIds(cliente, tabla, campos, campo, ids, signal) {
        const todas = [...ids], filas = [];
        for (let i = 0; i < todas.length; i += 100) {
            const lote = todas.slice(i, i + 100);
            filas.push(...await paginas(() => cliente.from(tabla).select(campos).in(campo, lote), signal));
        }
        return filas;
    }

    function agrupar(filas, transformar) {
        const mapa = new Map();
        for (const fila of filas) {
            const id = fila.reserva_id;
            if (!mapa.has(id)) mapa.set(id, []);
            mapa.get(id).push(transformar(fila));
        }
        return mapa;
    }

    const camposEstadia = "id,reserva_id,fecha_ingreso,fecha_salida,estado_estadia,tipo_estadia,cabanas(numero)";
    const camposReserva = "id,cloudbeds_id,titular_nombre,estado_reserva,observaciones";

    function estadiaProyecto(e, r) {
        const reserva = informes.estado(r.estado_reserva), estadia = informes.estado(e.estado_estadia);
        const estado = reserva === "cancelada" || estadia === "cancelada" ? "cancelada" : estadia || reserva;
        return {
            reservaId: r.id, estadiaId: e.id, cloudbedsId: informes.idCloudbeds(r.cloudbeds_id), titular: r.titular_nombre,
            estado, confirmacion: reserva, observaciones: r.observaciones,
            cabana: Number(e.cabanas?.numero) || null, entrada: e.fecha_ingreso, salida: e.fecha_salida,
            fullDay: e.tipo_estadia === "full_day"
        };
    }

    async function cargarProyecto(filas, cliente, { verReservas, verPagos }, signal) {
        if (!verReservas) return { disponible: false };
        const fechas = unico(filas.flatMap(f => [f.entrada, f.salida])).sort();
        const ids = unico(filas.flatMap(f => [f.id, f.idAlterno]));
        const [porFecha, porIdentificador] = await Promise.all([
            fechas.length ? paginas(() => cliente.from("reserva_estadias").select(`${camposEstadia},reservas(${camposReserva})`)
                .gte("fecha_salida", fechas[0]).lte("fecha_ingreso", fechas.at(-1)), signal) : [],
            porIds(cliente, "reservas", `${camposReserva},reserva_estadias(${camposEstadia})`, "cloudbeds_id", ids, signal)
        ]);
        if (porFecha.some(e => !e.reservas?.id)) throw new Error("Proyecto H devolvió estadías sin reserva visible.");
        const estadias = new Map(porFecha.map(e => [e.id, estadiaProyecto(e, e.reservas)]));
        for (const r of porIdentificador) {
            const deReserva = lista(r.reserva_estadias);
            for (const e of deReserva) estadias.set(e.id, estadiaProyecto(e, r));
            if (!deReserva.length) estadias.set("reserva:" + r.id, estadiaProyecto({}, r));
        }
        const reservas = [...estadias.values()];
        const destinos = informes.destinosProyecto(filas, reservas);
        const [notas, pagos, servicios] = await Promise.allSettled([
            porIds(cliente, "notas", "id,reserva_id,texto", "reserva_id", destinos.notas, signal),
            verPagos ? porIds(cliente, "pagos", "id,reserva_id,monto,moneda,estado,fecha_pago,tipo_movimiento,medio_pago,folio,codigo_autorizacion,datos_origen",
                "reserva_id", destinos.pagos, signal) : Promise.reject(new Error("Sin permiso para leer pagos.")),
            verPagos ? porIds(cliente, "servicios", "id,reserva_id,estadia_id,fecha_servicio,total,estado_servicio,catalogo_servicios(nombre)",
                "reserva_id", destinos.servicios, signal) : []
        ]);
        return {
            disponible: true, reservas,
            notasDisponibles: notas.status === "fulfilled", notas: agrupar(notas.value || [], n => n.texto),
            pagosDisponibles: pagos.status === "fulfilled", pagos: agrupar(pagos.value || [], p => p),
            servicios: agrupar((servicios.value || []).filter(s => !/cancelad|anulad|no_show/i.test(s.estado_servicio)), s => ({
                estadiaId: s.estadia_id, concepto: s.catalogo_servicios?.nombre, fecha: s.fecha_servicio,
                monto: s.total == null ? null : Number(s.total)
            }))
        };
    }

    function mesesDe(filas) {
        const fechas = filas.flatMap(f => [f.entrada, f.salida, f.registradoEn, f.servicioEn, f.canceladaEn, f.comprobante?.fecha]);
        const meses = root.HAIKU_LIBRO_SEMANTICA?.meses || [];
        return new Set(unico(fechas).map(s => meses[Number(s.slice(5, 7)) - 1] + s.slice(2, 4)));
    }

    async function cargarLibro(filas, libro, finanzas) {
        if (!libro?.crearLectura) return { hojas: [] };
        const lectura = await libro.crearLectura();
        const meses = mesesDe(filas);
        const seleccion = lectura.listarHojas().filter(h => meses.has(informes.normalizar(h).replace(/\s/g, "")));
        if (!seleccion.length) return { hojas: [] };
        const hojas = (await lectura.consultarHojas(seleccion)).filter(Boolean);
        return { hojas, finanzas, estado: lectura.estado?.() };
    }

    function permisos() {
        return { verReservas: root.haikuTienePermiso?.("reservas.ver") === true, verPagos: root.haikuTienePermiso?.("pagos.ver") === true };
    }

    async function usuario(cliente) {
        const { data, error } = await cliente.auth.getSession();
        if (error || !data?.session?.user?.id) throw new Error("Inicia sesión en Proyecto H para comparar.");
        return data.session.user.id;
    }

    async function analizar(archivos, cliente, avance, documentos = []) {
        const autor = await usuario(cliente);
        const acceso = permisos();
        const errores = [];
        for (const { file, tipo } of archivos) {
            try { documentos.push(await leerArchivo(file, tipo)); }
            catch (error) { errores.push({ archivo: file.name, motivo: error?.message || "No pude leer el archivo." }); }
        }
        const filas = informes.preparar(documentos);
        avance?.();
        let libro, proyecto;
        if (filas.length) {
            const control = new AbortController();
            let timer;
            const plazo = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    control.abort();
                    reject(new Error("La fuente tardó demasiado."));
                }, 30000);
            });
            try {
                const [ph, lr] = await Promise.allSettled([
                    Promise.race([cargarProyecto(filas, cliente, acceso, control.signal), plazo]),
                    Promise.race([cargarLibro(filas, root.HAIKU_LIBRO_RESERVA_V1, acceso.verReservas && acceso.verPagos), plazo])
                ]);
                proyecto = ph.value;
                libro = lr.value;
            } finally {
                clearTimeout(timer);
                control.abort();
            }
        }
        const vigente = permisos();
        if (autor !== await usuario(cliente) || acceso.verReservas !== vigente.verReservas || acceso.verPagos !== vigente.verPagos) {
            throw new Error("Cambió la sesión o los permisos. Vuelve a adjuntar los informes.");
        }
        return { documentos, errores, filas: informes.comparar(filas, { proyecto, libro }),
            proyectoDisponible: proyecto?.disponible === true, hojas: (libro?.hojas || []).map(h => h.hoja),
            autor, fuenteLibro: libro?.estado };
    }

    function elemento(tag, clase, texto) {
        const e = doc.createElement(tag);
        if (clase) e.className = clase;
        if (texto) e.textContent = texto;
        return e;
    }

    const partes = (...datos) => datos.filter(Boolean).join(" · ");
    function origen(o) {
        return partes(o.archivo, o.hoja, o.pagina && `pág. ${o.pagina}`, o.celda || o.fila && `fila ${o.fila}`);
    }

    function etiqueta(fuente, r) {
        return r.estado === "falta" ? `Falta en ${fuente}` : estados[r.estado];
    }

    function resumenFila(f) {
        if (f.tipo === "nota") return partes(informes.dia(f.creadaEn), f.horaNota, f.estadoNota);
        if (f.tipo === "cancelacion") return f.canceladaEn ? `Cancelada el ${informes.dia(f.canceladaEn)}` : "Cancelada en el listado";
        if (informes.gruposMovimiento.has(f.tipo)) {
            return partes(f.descripcion, informes.pesos(f.credito || f.debito), informes.dia(f.registradoEn));
        }
        return informes.datoEstadia({ entrada: f.entrada, salida: f.salida, estado: f.estado });
    }

    function bloqueFuente(nombre, r) {
        const bloque = elemento("div", "haku-cloudbeds-informes__fuente");
        bloque.append(elemento("strong", "", nombre), elemento("span", "haku-cloudbeds-informes__estado", etiqueta(nombre, r)),
            elemento("p", "", r.detalle));
        if (r.dato) bloque.append(elemento("p", "", r.dato));
        if (r.origen) bloque.append(elemento("small", "", origen(r.origen)));
        return bloque;
    }

    const seleccionReserva = f => ({ estadiaId: f.estadiaId, numeroCabana: String(f.cabana), fecha: f.fecha });

    function abrirReserva(fila, acciones, aviso) {
        const accion = elemento("button", "", "Ver reserva");
        accion.type = "button";
        accion.addEventListener("click", async () => {
            accion.disabled = true;
            const f = fila.destino;
            const seleccion = seleccionReserva(f);
            try {
                const inspector = root.HAIKU_INSPECTOR_V1;
                const abierta = inspector?.abrirReserva ? await inspector.abrirReserva(f.reservaId, accion, seleccion) :
                    await root.HAIKU_RESUMEN_RESERVA_SITES_V1?.abrirPorId?.(f.reservaId, accion, seleccion);
                if (!abierta) aviso.textContent = "No pude abrir la reserva. Vuelve a consultar.";
            } catch (_) { aviso.textContent = "No pude abrir la reserva. Vuelve a consultar."; }
            finally { accion.disabled = false; }
        });
        acciones.append(accion);
        return accion;
    }

    const puedeIncorporarPago = (f, modelo) => Boolean(f.pagoIncorporable && Number.isSafeInteger(modelo.fuenteLibro?.generacion) &&
        root.haikuTienePermiso?.("pagos.registrar") === true && root.HAIKU_LIBRO_CONSULTAS?.prepararPagoInformeCloudbeds);

    function incorporarPago(fila, acciones, aviso, revision, verReserva, modelo, cliente, conciliar, bloquearCierre) {
        if (!puedeIncorporarPago(fila, modelo)) return;
        const libro = root.HAIKU_LIBRO_CONSULTAS;
        const {autor, fuenteLibro} = modelo;
        const incorporar = elemento("button", "haku-cloudbeds-informes__principal", "Incorporar pago");
        incorporar.type = "button";
        incorporar.setAttribute("aria-expanded", "false");
        acciones.prepend(incorporar);
        const limpiarRevision = () => {
            revision.replaceChildren();
            revision.hidden = true;
            incorporar.setAttribute("aria-expanded", "false");
            incorporar.disabled = false;
        };
        const registrarResultado = creado => {
            bloquearCierre(false);
            limpiarRevision();
            incorporar.remove();
            fila.pagoIncorporable = null;
            const mensaje = creado ? "Pago incorporado en Proyecto H." : "El pago ya está registrado en Proyecto H.";
            fila.proyecto = { estado: "coincide", detalle: mensaje };
            conciliar();
            aviso.textContent = mensaje;
            verReserva.focus();
        };
        incorporar.addEventListener("click", async () => {
            incorporar.disabled = true;
            aviso.textContent = "Verificando comprobante y destino…";
            try {
                const preparacion = await libro.prepararPagoInformeCloudbeds({
                    ...fila.pagoIncorporable, ...fuenteLibro, autor
                }, cliente);
                if (preparacion.registrado) { registrarResultado(false); return; }
                const importe = informes.pesos(fila.credito);
                const datos = elemento("div", "haku-cloudbeds-informes__pago-datos");
                datos.append(elemento("strong", "", importe), elemento("small", "",
                    partes(preparacion.medio || informes.medioComprobante(fila), informes.dia(fila.comprobante.fecha))));
                const destinos = elemento("ul", "haku-cloudbeds-informes__pago-destinos");
                for (const d of preparacion.destinos) {
                    const nombre = Number(d.cantidad) > 1 ? `${d.cantidad} × ${d.nombre}` : d.nombre;
                    destinos.append(elemento("li", "", partes(nombre, informes.dia(d.fecha), d.hora,
                        d.saldo != null && `Saldo después ${informes.pesos(d.saldo - fila.credito)}`,
                        preparacion.destinos.length > 1 && informes.pesos(d.monto))));
                }
                const controles = elemento("div", "haku-cloudbeds-informes__acciones");
                const confirmar = elemento("button", "haku-cloudbeds-informes__principal", "Confirmar pago");
                const cancelar = elemento("button", "", "Cancelar");
                confirmar.type = cancelar.type = "button";
                cancelar.addEventListener("click", () => {
                    limpiarRevision();
                    aviso.textContent = "";
                    incorporar.focus();
                });
                confirmar.addEventListener("click", async () => {
                    confirmar.disabled = cancelar.disabled = true;
                    bloquearCierre(true);
                    aviso.textContent = "Confirmando pago…";
                    try {
                        const resultado = await preparacion.confirmar();
                        registrarResultado(resultado.creado);
                        void Promise.allSettled([
                            Promise.resolve().then(() => root.haikuCargarAbonosSupabase?.()),
                            Promise.resolve().then(() => root.haikuCargarSaldosCheckinSupabase?.()),
                            Promise.resolve().then(() => root.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("pago de Informes Cloudbeds")),
                            Promise.resolve().then(() => {
                                const inspector = root.HAIKU_INSPECTOR_V1?.estado?.();
                                const {reservaId} = fila.destino;
                                if (inspector?.reservaAbierta && inspector.entidadInspector === reservaId) {
                                    return root.HAIKU_RESUMEN_RESERVA_SITES_V1?.abrirPorId?.(reservaId, verReserva,
                                        inspector.seleccionInspector || seleccionReserva(fila.destino));
                                }
                            })
                        ]);
                    } catch (error) {
                        bloquearCierre(!!error.pagoInformePendiente);
                        confirmar.disabled = !error.pagoInformePendiente;
                        confirmar.textContent = error.pagoInformePendiente ? "Reintentar confirmación" : "Confirmar pago";
                        cancelar.disabled = !!error.pagoInformePendiente;
                        aviso.textContent = error.pagoInformePendiente
                            ? "La confirmación está pendiente. Reintenta desde aquí."
                            : error?.message || "Proyecto H no confirmó el pago.";
                    }
                });
                controles.append(confirmar, cancelar);
                const aplicacion = elemento("div");
                aplicacion.append(elemento("strong", "", "Aplicar pago a"), destinos);
                const resumenPago = elemento("div", "haku-cloudbeds-informes__pago-resumen");
                resumenPago.append(aplicacion, datos);
                revision.append(resumenPago, controles);
                revision.hidden = false;
                incorporar.setAttribute("aria-expanded", "true");
                aviso.textContent = "";
                confirmar.focus();
            } catch (error) {
                aviso.textContent = error?.message || "No pude preparar el pago.";
                incorporar.disabled = false;
            }
        });
    }

    function montarFila(fila, modelo, cliente, actualizarConteo, bloquearCierre, enGrupo) {
        const detalle = elemento("details", "haku-cloudbeds-informes__fila");
        const resumen = elemento("summary", "");
        const identidad = elemento("span", "haku-cloudbeds-informes__identidad");
        identidad.append(elemento("strong", "", enGrupo ? partes(informes.titulos[fila.tipo], informes.pesos(fila.credito || fila.debito)) :
            partes(informes.titulos[fila.tipo], fila.titular || (fila.id ? `#${fila.id}` : "Sin reserva"),
            informes.cab(fila.cabana) || fila.cabanas?.map(informes.cab).join(", "))),
            elemento("small", "", enGrupo ? partes(informes.dia(fila.comprobante.fecha || fila.registradoEn),
                informes.medioComprobante(fila)) : partes(fila.tipo !== "reserva" && fila.entrada && `IN ${informes.dia(fila.entrada)}`, resumenFila(fila))));
        const indicadores = elemento("span", "haku-cloudbeds-informes__indicadores");
        resumen.append(identidad, indicadores);
        const actualizarIndicadores = () => indicadores.replaceChildren(...[["Proyecto H", fila.proyecto], ["Libro", fila.libro]].map(([nombre, r]) => {
            const corto = nombre === "Proyecto H" ? "H" : "Libro";
            const rotulo = nombre === "Proyecto H" && puedeIncorporarPago(fila, modelo) ? "Por incorporar" : etiqueta(nombre, r);
            return elemento("span", `haku-cloudbeds-informes__indicador is-${r.estado}`,
                r.estado === "falta" ? rotulo : `${corto} · ${rotulo}`);
        }));
        actualizarIndicadores();
        detalle.append(resumen);
        // Sólo se montan los detalles al abrir la fila.
        detalle.addEventListener("toggle", () => {
            if (!detalle.open || detalle.childElementCount > 1) return;
            const cuerpo = elemento("div", "haku-cloudbeds-informes__detalle");
            const evidencia = elemento("div", "haku-cloudbeds-informes__evidencia");
            const fechas = [informes.dia(fila.entrada), informes.dia(fila.salida)].filter(Boolean).join(" → ");
            evidencia.append(elemento("strong", "", partes("Cloudbeds", fila.id && `Reserva #${fila.id}`, fechas)));
            for (const o of unico(fila.origenes.map(origen))) evidencia.append(elemento("small", "", o));
            if (fila.contextoCloudbeds && fila.tipo === "nota") {
                evidencia.append(elemento("small", "", "Titular cotejado con " + origen(fila.contextoCloudbeds)));
            }
            if (fila.tipo === "nota") {
                if (fila.nota) evidencia.append(elemento("p", "", fila.nota));
                if (fila.autor) evidencia.append(elemento("small", "", "Nota escrita por " + fila.autor));
            }
            if (informes.gruposMovimiento.has(fila.tipo)) {
                const c = fila.comprobante;
                evidencia.append(elemento("p", "", partes(fila.codigo && `Código ${fila.codigo}`, fila.medio,
                    fila.medioNota && fila.medioNota !== fila.medio && `Medio en nota: ${fila.medioNota}`,
                    fila.registradoEn && `Registro ${partes(informes.dia(fila.registradoEn), fila.horaRegistro)}`,
                    fila.servicioEn && `Servicio ${informes.dia(fila.servicioEn)}`, c.fecha && `Comprobante ${informes.dia(c.fecha)}`)));
                const comprobante = partes(c.folio && `Folio ${c.folio}`, c.autorizacion && `Autorización ${c.autorizacion}`, c.bove && `BOVE ${c.bove}`);
                if (comprobante) evidencia.append(elemento("small", "", comprobante));
            }
            if (fila.tipo === "reserva" && fila.total != null) evidencia.append(elemento("small", "", "Precio total del listado · " + informes.pesos(fila.total)));
            const fuentes = elemento("div", "haku-cloudbeds-informes__fuentes");
            fuentes.append(bloqueFuente("Proyecto H", fila.proyecto), bloqueFuente("Libro", fila.libro));
            cuerpo.append(evidencia, fuentes);
            if (fila.destino) {
                const acciones = elemento("div", "haku-cloudbeds-informes__acciones");
                const revision = elemento("section", "haku-cloudbeds-informes__revision-pago");
                revision.hidden = true;
                const aviso = elemento("small", "haku-cloudbeds-informes__aviso");
                aviso.setAttribute("role", "status");
                const avisoReserva = elemento("small", "haku-cloudbeds-informes__aviso");
                avisoReserva.setAttribute("role", "status");
                const verReserva = abrirReserva(fila, acciones, avisoReserva);
                incorporarPago(fila, acciones, aviso, revision, verReserva, modelo, cliente, () => {
                    fuentes.firstElementChild.replaceWith(bloqueFuente("Proyecto H", fila.proyecto));
                    actualizarIndicadores();
                    actualizarConteo();
                }, bloquearCierre);
                cuerpo.append(acciones, revision, aviso, avisoReserva);
            }
            detalle.append(cuerpo);
        });
        return detalle;
    }

    const categorias = {
        todos: "Todos los tipos", reserva: "Reservas", cancelacion: "Cancelaciones", nota: "Notas",
        pago: "Pagos", reversas: "Anulaciones y reembolsos", contable: "Cargos, impuestos y ajustes"
    };
    const porCategoria = (f, tipo) => tipo === "todos" || tipo === f.tipo ||
        tipo === "reversas" && ["anulacion", "reembolso"].includes(f.tipo) ||
        tipo === "contable" && ["cargo", "impuesto", "ajuste", "movimiento"].includes(f.tipo);
    const diferencias = f => [f.proyecto.estado, f.libro.estado].some(e => e === "falta" || e === "dato_distinto");
    const dudas = f => [f.proyecto.estado, f.libro.estado].includes("por_verificar");
    const porEstado = (f, estado) => estado === "todos" || estado === "diferencias" && diferencias(f) ||
        estado === "dudas" && dudas(f) || estado === "coinciden" && f.proyecto.estado === "coincide" && f.libro.estado === "coincide";

    function selector(label, opciones) {
        const campo = elemento("select");
        campo.setAttribute("aria-label", label);
        for (const [valor, texto] of Object.entries(opciones)) {
            const opcion = elemento("option", "", texto);
            opcion.value = valor;
            campo.append(opcion);
        }
        return campo;
    }

    function montar(contenedor, modelo, cliente = root.haikuSupabase) {
        const { documentos, errores, filas, proyectoDisponible, hojas } = modelo;
        const articulo = elemento("article", "haku-cloudbeds-informes");
        articulo.dataset.cloudbedsInformes = "";
        const cabecera = elemento("header", "");
        const titulo = elemento("div", "");
        titulo.append(elemento("h2", "", "Informes Cloudbeds"),
            elemento("small", "", partes(cantidad(documentos.length, "archivo"), cantidad(filas.length, "registro"))));
        const cerrar = elemento("button", "", "×");
        cerrar.type = "button";
        cerrar.setAttribute("aria-label", "Cerrar informe Cloudbeds");
        cerrar.addEventListener("click", () => contenedor.remove());
        cabecera.append(titulo, cerrar);
        articulo.append(cabecera);

        const archivos = elemento("details", "haku-cloudbeds-informes__archivos");
        archivos.open = errores.length > 0;
        archivos.append(elemento("summary", "", errores.length ? `Archivos y cobertura · ${errores.length} por revisar` : "Archivos y cobertura"));
        const listaArchivos = elemento("ul");
        for (const f of documentos) {
            const r = elemento("li", "", partes(f.tipos.map(t => listas[t]).join(", "), f.archivo, cantidad(f.filas.length, "fila")));
            for (const filtro of f.filtros) r.append(elemento("small", "", filtro));
            listaArchivos.append(r);
        }
        for (const e of errores) listaArchivos.append(elemento("li", "", partes(e.archivo, e.motivo)));
        listaArchivos.append(elemento("li", "", partes(proyectoDisponible ? "Proyecto H consultado" : "Proyecto H sin lectura",
            hojas.length ? "Libro · " + hojas.join(", ") : "Libro sin hojas disponibles para estas fechas")));
        archivos.append(listaArchivos);
        articulo.append(archivos);

        if (filas.length) {
            const grupos = informes.agruparPagos(filas);
            const bloques = [...new Set(filas.map(f => grupos.get(f) || f))];
            const controles = elemento("div", "haku-cloudbeds-informes__controles");
            const tipos = selector("Tipo de registro", Object.fromEntries(Object.entries(categorias).flatMap(([k, label]) => {
                const total = filas.filter(f => porCategoria(f, k)).length;
                return total ? [[k, `${label} (${formato.format(total)})`]] : [];
            })));
            const filtros = selector("Resultado de comparación", { todos: "Todos los resultados", diferencias: "Diferencias", dudas: "Por verificar", coinciden: "Coinciden en ambas fuentes" });
            const conteo = elemento("small", "");
            conteo.setAttribute("role", "status");
            const resultados = elemento("div", "haku-cloudbeds-informes__resultados");
            const mas = elemento("button", "haku-cloudbeds-informes__mas", "Mostrar más");
            mas.type = "button";
            controles.append(tipos, filtros, conteo);
            articulo.append(controles, resultados, mas);

            let visibles = [], desde = 0;
            const filasDe = bloque => Array.isArray(bloque) ? bloque : [bloque];
            const puedeIncorporar = f => puedeIncorporarPago(f, modelo);
            const mostradas = new Map();
            const montadas = new WeakMap(), confirmaciones = new Set();
            const actualizarConteo = () => {
                const cantidadVisible = visibles.reduce((n,b) => n + mostradas.get(b).length, 0);
                const cantidadMontada = visibles.slice(0, desde).reduce((n,b) => n + mostradas.get(b).length, 0);
                const conDiferencias = visibles.reduce((n,b) => n + mostradas.get(b).filter(diferencias).length, 0);
                conteo.textContent = `${cantidadMontada} de ${cantidadVisible} · ${conDiferencias} con diferencias`;
            };
            const bloquearCierre = (fila, ocupado) => {
                if (ocupado) confirmaciones.add(fila);
                else confirmaciones.delete(fila);
                cerrar.disabled = tipos.disabled = filtros.disabled = confirmaciones.size > 0;
            };
            const montarRegistro = (fila, actualizar, enGrupo = false) => {
                if (!montadas.has(fila)) montadas.set(fila, montarFila(fila, modelo, cliente, actualizar,
                    ocupado => bloquearCierre(fila, ocupado), enGrupo));
                return montadas.get(fila);
            };
            const gruposMontados = new WeakMap();
            function montarGrupo(grupo) {
                if (!gruposMontados.has(grupo)) {
                    const primera = grupo[0];
                    const detalle = elemento("details", "haku-cloudbeds-informes__grupo");
                    const resumen = elemento("summary");
                    const identidad = elemento("span", "haku-cloudbeds-informes__identidad");
                    const fechas = [primera.entrada, primera.salida].filter(Boolean).map(informes.dia).join(" → ");
                    identidad.append(elemento("strong", "", partes(primera.titular || `#${primera.id}`, informes.cab(primera.cabana))),
                        elemento("small", "", fechas));
                    const estado = elemento("small", "haku-cloudbeds-informes__grupo-estado");
                    resumen.append(identidad, estado);
                    const contenido = elemento("div", "haku-cloudbeds-informes__grupo-pagos");
                    detalle.append(resumen, contenido);
                    const actualizarGrupo = (filas = mostradas.get(grupo) || []) => {
                        const pendientes = filas.filter(puedeIncorporar).length;
                        const revisar = filas.filter(f => !puedeIncorporar(f) && (dudas(f) || diferencias(f))).length;
                        const soloPagos = filas.every(f => f.tipo === "pago");
                        estado.textContent = partes(cantidad(filas.length, soloPagos ? "pago" : "movimiento"),
                            pendientes && `${pendientes} por incorporar`, revisar && `${revisar} por revisar`);
                    };
                    const actualizar = () => {
                        actualizarGrupo();
                        actualizarConteo();
                    };
                    const actualizarFilas = () => {
                        const filas = mostradas.get(grupo);
                        if (!filas) return;
                        actualizarGrupo(filas);
                        if (detalle.open) contenido.replaceChildren(...filas.map(f => montarRegistro(f, actualizar, true)));
                    };
                    detalle.addEventListener("toggle", actualizarFilas);
                    gruposMontados.set(grupo, {detalle, actualizarFilas});
                }
                const vista = gruposMontados.get(grupo);
                vista.actualizarFilas();
                return vista.detalle;
            }
            function mostrarMas() {
                const lote = visibles.slice(desde, desde + 20);
                resultados.append(...lote.map(b => Array.isArray(b) ? montarGrupo(b) : montarRegistro(b, actualizarConteo)));
                desde += lote.length;
                mas.hidden = desde >= visibles.length;
                actualizarConteo();
            }
            function filtrar() {
                mostradas.clear();
                visibles = bloques.filter(b => {
                    const coinciden = filasDe(b).filter(f => porCategoria(f, tipos.value) && porEstado(f, filtros.value));
                    if (!coinciden.length) return false;
                    mostradas.set(b, coinciden);
                    return true;
                });
                const prioridad = b => mostradas.get(b).some(puedeIncorporar) ? 0 :
                    mostradas.get(b).some(diferencias) ? 1 : mostradas.get(b).some(dudas) ? 2 : 3;
                visibles.sort((a, b) => prioridad(a) - prioridad(b));
                desde = 0;
                resultados.replaceChildren();
                mostrarMas();
                if (!visibles.length) resultados.append(elemento("p", "haku-cloudbeds-informes__vacio", "No hay registros con esos filtros."));
            }
            tipos.addEventListener("change", filtrar);
            filtros.addEventListener("change", filtrar);
            mas.addEventListener("click", mostrarMas);
            filtrar();
        } else if (!errores.length) articulo.append(elemento("p", "haku-cloudbeds-informes__vacio", "Los archivos reconocidos no contienen filas en el período exportado."));
        contenedor.replaceChildren(articulo);
    }

    root.HAIKU_ASISTENTE_CLOUDBEDS_INFORMES_V1 = Object.freeze({ analizar, montar });
})(window);
