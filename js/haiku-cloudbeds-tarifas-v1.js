/* Cloudbeds Tarifas: UI Haku, preview backend y confirmación humana auditada. */
(function (root) {
    "use strict";

    if (root.HAIKU_CLOUDBEDS_TARIFAS_V1) return;

    const CLOUDBEDS_TARIFAS_WRITER_HABILITADO = true;
    const RPC_CAPACIDAD = "haiku_capacidad_totales_v1";
    const RPC_PREVIEW = "haiku_previsualizar_tarifa_cloudbeds_v1";
    const RPC_WRITER = "haiku_aplicar_tarifas_cloudbeds_v1";
    const VERSION_PREVIEW = "cloudbeds_writer_w1_preview_v1";
    const VERSION_V31 = "total1_financiero_v31";
    const VERSION_V32 = "total1_financiero_v32";
    const VERSION_VIGENTE = VERSION_V31;
    const VERSIONES_COMPATIBLES = Object.freeze([VERSION_V31, VERSION_V32]);
    const CERTEZAS = ["SIN_CAMBIO", "ALTA_CERTEZA", "REVISION_MANUAL", "NO_APLICA", "NO_IDENTIFICADA"];
    const CATEGORIAS = Object.freeze({
        SIN_CAMBIO: "Coinciden",
        ALTA_CERTEZA: "Propuestas seguras",
        REVISION_MANUAL: "Revisión manual",
        NO_APLICA: "Canceladas / no aplica",
        NO_IDENTIFICADA: "No identificadas"
    });

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, caracter => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[caracter]);
    const moneda = valor => Number.isSafeInteger(Number(valor))
        ? `${Number(valor) < 0 ? "-" : ""}$${Math.abs(Number(valor)).toLocaleString("es-CL")}`
        : "No disponible";
    const fechaCorta = valor => {
        const match = String(valor || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
    };

    function capacidadNoDisponible(motivo, data = null) {
        return Object.freeze({
            consultada: Boolean(data),
            version: data?.version || null,
            writer_disponible: false,
            total_disponible: false,
            v31_disponible: false,
            v32_disponible: false,
            servicios_separados: false,
            motivo,
            escritura_habilitada: false
        });
    }

    async function consultarCapacidad(cliente) {
        if (!cliente || typeof cliente.rpc !== "function") {
            return capacidadNoDisponible("Cliente de capacidad no disponible.");
        }
        try {
            const { data, error } = await cliente.rpc(RPC_CAPACIDAD);
            if (error) return capacidadNoDisponible("No fue posible comprobar la capacidad financiera.", data);
            if (!data || !VERSIONES_COMPATIBLES.includes(data.version) || data.writer_disponible !== true) {
                return capacidadNoDisponible("TOTAL v31/v32 no está disponible globalmente.", data);
            }
            const esV32 = data.version === VERSION_V32;
            return Object.freeze({
                consultada: true,
                version: data.version,
                writer_disponible: true,
                total_disponible: true,
                v31_disponible: data.version === VERSION_V31,
                v32_disponible: esV32,
                servicios_separados: esV32 && data.servicios_separados === true,
                motivo: `TOTAL ${esV32 ? "v32" : "v31"} está disponible globalmente; cada reserva aún requiere revalidación final.`,
                escritura_habilitada: CLOUDBEDS_TARIFAS_WRITER_HABILITADO && true
            });
        } catch {
            return capacidadNoDisponible("La comprobación global de TOTAL v31/v32 falló.");
        }
    }

    function propuestaTieneServicios(propuesta) {
        if (propuesta?.tiene_servicios === true) return true;
        if (Array.isArray(propuesta?.productos)) return propuesta.productos.length > 0;
        return typeof propuesta?.productos === "string" && propuesta.productos.trim().length > 0;
    }

    const capacidadEsV31 = capacidad => capacidad?.version === VERSION_V31
        && (capacidad?.writer_disponible === true || capacidad?.v31_disponible === true);
    const capacidadEsV32 = capacidad => capacidad?.version === VERSION_V32
        && (capacidad?.writer_disponible === true || capacidad?.v32_disponible === true);
    const capacidadTotalDisponible = capacidad => capacidadEsV31(capacidad) || capacidadEsV32(capacidad);

    function payloadValido(fila) {
        const propuesta = fila?.propuesta || {};
        const tipo = propuesta.es_full_day === true ? "fullday" : propuesta.tipo_estadia_proyecto_h;
        return Boolean(
            propuesta.reserva_id &&
            propuesta.estadia_id &&
            ["alojamiento", "fullday"].includes(tipo) &&
            (propuesta.reservation_number || propuesta.reservation_id) &&
            Number.isSafeInteger(Number(propuesta.total_actual_haku)) &&
            Number.isSafeInteger(Number(propuesta.total_alojamiento_propuesto)) &&
            Number(propuesta.total_alojamiento_propuesto) > 0 &&
            Number(propuesta.total_actual_haku) !== Number(propuesta.total_alojamiento_propuesto)
        );
    }

    function estadoFinanciero(fila, capacidad) {
        if (fila?.certeza !== "ALTA_CERTEZA") return "NO_EVALUADA";
        if (!payloadValido(fila)) return "REQUIERE_REVISION_FINANCIERA";
        if (propuestaTieneServicios(fila?.propuesta)) {
            return capacidadEsV32(capacidad)
                ? "REQUIERE_REVALIDACION_V32"
                : "REQUIERE_REVISION_V32";
        }
        if (capacidadEsV32(capacidad)) return "REQUIERE_REVALIDACION_V32";
        return capacidadEsV31(capacidad)
            ? "REQUIERE_REVALIDACION_V31"
            : "CAPACIDAD_TOTAL_NO_DISPONIBLE";
    }

    function capacidadCorreccionFullDay(fila) {
        const propuesta = fila?.propuesta || {};
        const preparada = Boolean(
            fila?.certeza === "ALTA_CERTEZA" &&
            propuesta.es_full_day === true &&
            propuesta.reserva_id &&
            propuesta.estadia_id &&
            Number.isSafeInteger(Number(propuesta.total_alojamiento_propuesto)) &&
            Number(propuesta.total_alojamiento_propuesto) > 0 &&
            Number(propuesta.total_alojamiento_propuesto) !== Number(propuesta.total_actual_haku)
        );
        return Object.freeze({
            certeza_cloudbeds: fila?.certeza || null,
            estado: preparada ? "PREPARADA_SIN_ESCRITURA" : "NO_PREPARADA",
            preparada,
            escritura_autorizada: false,
            motivo: preparada
                ? "La identidad y la tarifa candidata permiten preparar una revalidación futura; todavía no autorizan una escritura."
                : "La fila no reúne identidad, diferencia y certeza suficientes para preparar la edición."
        });
    }

    async function consultarPreparacionFullDay(fila, cliente) {
        const capacidad = capacidadCorreccionFullDay(fila);
        if (!capacidad.preparada) throw new Error(capacidad.motivo);
        if (!cliente || typeof cliente.from !== "function") {
            throw new Error("Cliente de lectura de Proyecto H no disponible.");
        }

        const propuesta = fila.propuesta;
        const reservaId = String(propuesta.reserva_id);
        const estadiaId = String(propuesta.estadia_id);
        const [reservaRespuesta, estadiasRespuesta, huespedesRespuesta, saldoRespuesta] = await Promise.all([
            cliente.from("reservas")
                .select("id,titular_nombre,titular_huesped_id,titular_tipo_documento,titular_numero_documento,correo_contacto,telefono_contacto,observaciones,grupo_reserva_id")
                .eq("id", reservaId)
                .maybeSingle(),
            cliente.from("reserva_estadias")
                .select("id,reserva_id,fecha_ingreso,fecha_salida,tipo_estadia,adultos,ninos,mascotas,estado_estadia,cabanas(numero)")
                .eq("reserva_id", reservaId)
                .not("estado_estadia", "in", "(cancelada,no_show)")
                .order("creado_en", { ascending: false }),
            cliente.from("reserva_huespedes")
                .select("huesped_id,huespedes(id,nombre,apellido)")
                .eq("reserva_id", reservaId),
            cliente.from("vista_saldos_alojamiento_reserva")
                .select("reserva_id,total_alojamiento,pagado_alojamiento,saldo_alojamiento")
                .eq("reserva_id", reservaId)
                .maybeSingle()
        ]);

        for (const respuesta of [reservaRespuesta, estadiasRespuesta, huespedesRespuesta, saldoRespuesta]) {
            if (respuesta?.error) throw respuesta.error;
        }

        const reserva = reservaRespuesta?.data;
        const saldo = saldoRespuesta?.data;
        const estadias = Array.isArray(estadiasRespuesta?.data) ? estadiasRespuesta.data : [];
        const estadia = estadias.find(item => String(item?.id || "") === estadiaId);
        if (!reserva || String(reserva.id) !== reservaId) {
            throw new Error("La reserva de Proyecto H ya no está disponible para revalidación.");
        }
        if (reserva.grupo_reserva_id || estadias.length !== 1 || !estadia) {
            throw new Error("La reserva ya no tiene una única estadía activa coincidente. Revisa la ficha antes de continuar.");
        }
        if (estadia.tipo_estadia !== "fullday" || estadia.fecha_ingreso !== estadia.fecha_salida) {
            throw new Error("La estadía verificada ya no conserva la estructura Full Day D → D.");
        }
        if (reserva.titular_numero_documento && reserva.titular_tipo_documento !== "rut") {
            throw new Error("El documento actual del titular no puede preservarse con el contrato canónico vigente.");
        }
        const cabanaNumero = Number(estadia.cabanas?.numero || 0);
        if (!cabanaNumero) throw new Error("La cabaña vigente no pudo revalidarse.");

        const acompanantes = (Array.isArray(huespedesRespuesta?.data) ? huespedesRespuesta.data : [])
            .filter(item => String(item?.huesped_id || "") !== String(reserva.titular_huesped_id || ""))
            .map(item => Array.isArray(item.huespedes) ? item.huespedes[0] : item.huespedes)
            // La RPC canónica actualiza sólo huespedes.nombre. Reenviar el
            // nombre compuesto duplicaría el apellido que permanece en su columna.
            .map(huesped => String(huesped?.nombre || "").trim())
            .filter(Boolean);
        const totalNuevo = Number(propuesta.total_alojamiento_propuesto);
        const totalActual = Number(saldo?.total_alojamiento);
        const pagadoActual = Number(saldo?.pagado_alojamiento);
        const saldoActual = Number(saldo?.saldo_alojamiento);
        if (!Number.isSafeInteger(totalActual) || totalActual <= 0) {
            throw new Error("El total vigente de alojamiento no pudo revalidarse.");
        }
        if (!Number.isSafeInteger(pagadoActual) || !Number.isSafeInteger(saldoActual)) {
            throw new Error("Pagado y saldo vigentes no pudieron revalidarse.");
        }
        if (totalActual !== Number(propuesta.total_actual_haku)) {
            throw new Error("La tarifa de Proyecto H cambió desde el análisis Cloudbeds. Vuelve a analizar antes de continuar.");
        }
        if (totalNuevo < pagadoActual) {
            throw new Error("La tarifa candidata no puede quedar por debajo del alojamiento pagado.");
        }

        return Object.freeze({
            solo_lectura: true,
            ejecutar: false,
            certeza_cloudbeds: capacidad.certeza_cloudbeds,
            capacidad_edicion: {
                estado: "REVALIDADA_PARA_CONFIRMACION_FUTURA",
                escritura_autorizada: false,
                rpc_canonica: "public.haiku_modificar_reserva_completa"
            },
            identidad_verificada: {
                reserva_id: reservaId,
                estadia_id: estadiaId
            },
            estado_financiero_verificado: {
                total_alojamiento: totalActual,
                pagado_alojamiento: pagadoActual,
                saldo_alojamiento: saldoActual
            },
            argumentos_rpc_futura: {
                p_reserva_id: reservaId,
                p_titular_nombre: reserva.titular_nombre,
                p_cabana_numero: cabanaNumero,
                p_fecha_ingreso: estadia.fecha_ingreso,
                p_fecha_salida: estadia.fecha_salida,
                p_tipo_estadia: "fullday",
                p_adultos: Number(estadia.adultos || 0),
                p_ninos: Number(estadia.ninos || 0),
                p_mascotas: Number(estadia.mascotas || 0),
                p_correo_contacto: reserva.correo_contacto || null,
                p_telefono_contacto: reserva.telefono_contacto || null,
                p_rut: reserva.titular_tipo_documento === "rut"
                    ? (reserva.titular_numero_documento || null)
                    : null,
                p_observaciones: reserva.observaciones || null,
                p_tarifas: {},
                p_tarifa_fullday: totalNuevo,
                p_acompanantes: acompanantes
            },
            trazabilidad_requerida: {
                reserva_id: reservaId,
                estadia_id: estadiaId,
                total_anterior: totalActual,
                total_nuevo: totalNuevo,
                fuente: "cloudbeds_pdf",
                reservation_number: propuesta.reservation_number || null,
                reservation_id: propuesta.reservation_id || null,
                usuario_id: "auth.uid() al confirmar",
                confirmado_en: "now() al confirmar",
                evidencias: [...(fila.evidencias || [])]
            }
        });
    }

    function prepararModelo(informe, capacidad) {
        const filas = Array.isArray(informe?.filas) ? informe.filas : [];
        const ids = new Set();
        const items = filas.map((fila, indice) => {
            const propuesta = fila.propuesta || {};
            const base = String(propuesta.reserva_id || propuesta.reservation_number || propuesta.reservation_id || `fila-${indice + 1}`);
            let id = base;
            let sufijo = 1;
            while (ids.has(id)) id = `${base}-${++sufijo}`;
            ids.add(id);
            const requiereV32 = propuestaTieneServicios(propuesta);
            const seleccionable = fila.certeza === "ALTA_CERTEZA" && payloadValido(fila)
                && (!requiereV32 || capacidadEsV32(capacidad));
            return {
                id,
                fila,
                tiene_servicios: requiereV32,
                certeza_cloudbeds: fila.certeza,
                compatibilidad_financiera: estadoFinanciero(fila, capacidad),
                seleccionable,
                seleccionado: false,
                preview: null
            };
        });
        const conteos = Object.fromEntries(CERTEZAS.map(certeza => [
            certeza,
            items.filter(item => item.certeza_cloudbeds === certeza).length
        ]));
        return {
            solo_lectura: true,
            writer_habilitado: CLOUDBEDS_TARIFAS_WRITER_HABILITADO,
            capacidad,
            informe,
            conteos,
            items,
            ultima_simulacion: null,
            diagnostico_writer: null,
            resultado_post_write: null,
            actualizaciones_bloqueadas: false
        };
    }

    async function preparar(informe, cliente) {
        const capacidad = await consultarCapacidad(cliente);
        return prepararModelo(informe, capacidad);
    }

    function buscarItem(modelo, id) {
        return modelo.items.find(item => item.id === String(id || "")) || null;
    }

    function seleccionar(modelo, id, seleccionado = true) {
        if (modelo.actualizaciones_bloqueadas) return false;
        const item = buscarItem(modelo, id);
        if (!item || !item.seleccionable) return false;
        item.seleccionado = Boolean(seleccionado);
        item.preview = null;
        modelo.ultima_simulacion = null;
        modelo.diagnostico_writer = null;
        modelo.resultado_post_write = null;
        return true;
    }

    function seleccionarTodo(modelo, seleccionado = true) {
        if (modelo.actualizaciones_bloqueadas) return 0;
        modelo.items.forEach(item => {
            if (item.seleccionable) {
                item.seleccionado = Boolean(seleccionado);
                item.preview = null;
            }
        });
        modelo.ultima_simulacion = null;
        modelo.diagnostico_writer = null;
        modelo.resultado_post_write = null;
        return modelo.items.filter(item => item.seleccionado).length;
    }

    function construirPayload(modelo) {
        return modelo.items
            .filter(item => item.seleccionable && item.seleccionado
                && (item.tiene_servicios
                    ? item.preview?.elegible === true
                        && item.preview?.autoridad_financiera_version === VERSION_V32
                        && item.preview?.servicios_sin_cambios === true
                    : (!CLOUDBEDS_TARIFAS_WRITER_HABILITADO || item.preview?.elegible === true)))
            .map(item => {
                const propuesta = item.fila.propuesta;
                const preview = item.preview;
                const payload = {
                    reserva_id: propuesta.reserva_id,
                    estadia_id: propuesta.estadia_id,
                    tipo_estadia: preview?.tipo_estadia || (propuesta.es_full_day === true
                        ? "fullday"
                        : propuesta.tipo_estadia_proyecto_h),
                    total_actual_esperado: Number(preview?.total_actual ?? propuesta.total_actual_haku),
                    total_objetivo: Number(preview?.total_objetivo ?? propuesta.total_alojamiento_propuesto),
                    cloudbeds_reservation_number: propuesta.reservation_number || null,
                    cloudbeds_reservation_id: propuesta.reservation_id || null,
                    certeza: item.fila.certeza,
                    evidencia: [...(item.fila.evidencias || propuesta.evidencias || [])]
                };
                if (typeof preview?.firma_iva === "string" && preview.firma_iva) {
                    payload.firma_iva = preview.firma_iva;
                }
                return payload;
            });
    }

    function solicitudesPreview(modelo) {
        return modelo.items.filter(item => item.seleccionable && item.seleccionado).map(item => ({
            item,
            parametros: {
                p_reserva_id: item.fila.propuesta.reserva_id,
                p_estadia_id: item.fila.propuesta.estadia_id,
                p_total_objetivo: Number(item.fila.propuesta.total_alojamiento_propuesto)
            }
        }));
    }

    function cantidadSeleccionada(modelo) {
        return solicitudesPreview(modelo).length;
    }

    function normalizarPreview(item, data) {
        const propuesta = item?.fila?.propuesta || {};
        if (!data || data.solo_lectura !== true || data.version !== VERSION_PREVIEW
            || String(data.reserva_id || "") !== String(propuesta.reserva_id || "")
            || String(data.estadia_id || "") !== String(propuesta.estadia_id || "")
            || Number(data.total_objetivo) !== Number(propuesta.total_alojamiento_propuesto)) {
            throw new Error("La preview backend no coincide con la propuesta seleccionada.");
        }
        if (!VERSIONES_COMPATIBLES.includes(data.autoridad_financiera_version)) {
            throw new Error("La preview backend no entregó una autoridad financiera permitida.");
        }
        if (data.elegible === true) {
            for (const campo of ["total_actual", "total_objetivo", "pagado_actual", "saldo_actual", "saldo_esperado"]) {
                if (!Number.isSafeInteger(Number(data[campo]))) {
                    throw new Error(`La preview backend no entregó ${campo} verificable.`);
                }
            }
            if (!["alojamiento", "fullday"].includes(data.tipo_estadia)) {
                throw new Error("La preview backend no entregó un tipo de estadía verificable.");
            }
            if (data.firma_iva !== undefined && (typeof data.firma_iva !== "string" || !data.firma_iva)) {
                throw new Error("La firma IVA de la preview backend es inválida.");
            }
            if (item.tiene_servicios) {
                if (data.autoridad_financiera_version !== VERSION_V32
                    || data.servicios_sin_cambios !== true) {
                    throw new Error("La preview no certificó la separación de servicios con TOTAL v32.");
                }
                for (const campo of ["total_servicios_sin_cambio", "total_reserva_actual", "total_reserva_esperado"]) {
                    if (!Number.isSafeInteger(Number(data[campo]))) {
                        throw new Error(`La preview backend no entregó ${campo} verificable.`);
                    }
                }
            }
        }
        return Object.freeze({
            ...data,
            cambio_desde_pdf: Number.isSafeInteger(Number(data.total_actual))
                && Number(data.total_actual) !== Number(propuesta.total_actual_haku)
        });
    }

    function aplicarPreview(item, data) {
        const preview = normalizarPreview(item, data);
        item.preview = preview;
        if (item.tiene_servicios) {
            item.compatibilidad_financiera = preview.elegible === true
                ? "SERVICIOS_CERTIFICADOS_V32"
                : "REQUIERE_REVISION_MANUAL_SERVICIOS";
        }
        return preview;
    }

    async function previsualizarSeleccion(modelo, cliente) {
        if (!CLOUDBEDS_TARIFAS_WRITER_HABILITADO) {
            return Object.freeze({
                ok: false,
                codigo: "WRITER_DESHABILITADO",
                previews: [],
                mensaje: "Escritura aún no habilitada. No se consultó la preview backend."
            });
        }
        const solicitudes = solicitudesPreview(modelo);
        if (!solicitudes.length || !cliente || typeof cliente.rpc !== "function") {
            return Object.freeze({
                ok: false,
                codigo: "RESERVA_NO_ELEGIBLE",
                previews: [],
                mensaje: MENSAJES_WRITER.RESERVA_NO_ELEGIBLE
            });
        }
        try {
            const preparadas = await Promise.all(solicitudes.map(async solicitud => {
                const { data, error } = await cliente.rpc(RPC_PREVIEW, solicitud.parametros) || {};
                if (error) throw error;
                return { item: solicitud.item, preview: normalizarPreview(solicitud.item, data) };
            }));
            preparadas.forEach(({ item, preview }) => {
                item.preview = preview;
                if (item.tiene_servicios) {
                    item.compatibilidad_financiera = preview.elegible === true
                        ? "SERVICIOS_CERTIFICADOS_V32"
                        : "REQUIERE_REVISION_MANUAL_SERVICIOS";
                }
            });
            const bloqueada = preparadas.find(({ preview }) => preview.elegible !== true);
            return Object.freeze({
                ok: !bloqueada,
                codigo: bloqueada ? "RESERVA_NO_ELEGIBLE" : "PREVIEW_VIGENTE",
                previews: preparadas.map(({ preview }) => preview),
                mensaje: bloqueada
                    ? (bloqueada.preview.motivo_bloqueo || MENSAJES_WRITER.RESERVA_NO_ELEGIBLE)
                    : "Preview backend vigente. Revisa los valores antes de confirmar."
            });
        } catch (error) {
            return Object.freeze({
                ok: false,
                previews: [],
                ...mapearErrorWriter(error),
                diagnostico: crearDiagnosticoWriter("preview", error)
            });
        }
    }

    const MENSAJES_WRITER = Object.freeze({
        ESTADO_DESACTUALIZADO: "La reserva cambió desde que cargaste el PDF. Revísala nuevamente.",
        PLAN_IVA_DESACTUALIZADO: "El plan IVA cambió desde la preview. Vuelve a revisar la propuesta.",
        PAGO_SUPERA_NUEVO_TOTAL: "El nuevo total quedaría por debajo de los pagos ya aplicados.",
        RESERVA_NO_ELEGIBLE: "La reserva ya no cumple las condiciones para actualización automática.",
        CONFLICTO_FINANCIERO: "Proyecto H detectó un conflicto financiero. Revisión manual requerida."
    });

    function mapearErrorWriter(error) {
        const texto = [error?.code, error?.message, error?.details, error?.hint]
            .filter(Boolean).join(" ");
        const codigo = Object.keys(MENSAJES_WRITER).find(clave => texto.includes(clave));
        return codigo
            ? { codigo, mensaje: MENSAJES_WRITER[codigo] }
            : { codigo: "CONFLICTO_FINANCIERO", mensaje: MENSAJES_WRITER.CONFLICTO_FINANCIERO };
    }

    function sanitizarDetalleWriter(valor) {
        if (valor === undefined || valor === null) return null;
        const texto = String(valor).trim();
        if (!texto) return null;
        return texto
            .replace(/(["']?(?:authorization|api[-_ ]?key|apikey|password|passwd|secret|access[-_ ]?token|refresh[-_ ]?token)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|Bearer\s+[A-Za-z0-9._~+\/-]+=*|[^,;\s}\]]+)/gi, "$1[REDACTADO]")
            .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTADO]")
            .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTADO]")
            .replace(/\b(?:sbp_|sk_live_|sk_test_|service_role_)[A-Za-z0-9._-]{8,}\b/gi, "[REDACTADO]")
            .slice(0, 1200);
    }

    function crearDiagnosticoWriter(etapa, error) {
        const mapeado = mapearErrorWriter(error);
        const detalle = sanitizarDetalleWriter(error?.details ?? error?.detail ?? error?.hint);
        return Object.freeze({
            etapa: etapa === "preview" ? "preview" : "writer",
            codigo: mapeado.codigo,
            mensaje: mapeado.mensaje,
            ...(detalle ? { detalle_backend: detalle } : {})
        });
    }

    function contenidoDiagnostico(modelo) {
        return modelo.diagnostico_writer || construirPayload(modelo);
    }

    async function reconsultarDespuesDeEscritura(modelo, cliente) {
        if (!cliente || typeof cliente.from !== "function") {
            throw new Error("Cliente de lectura de Proyecto H no disponible.");
        }
        const payload = construirPayload(modelo);
        const ids = new Set(payload.map(item => String(item.reserva_id)));
        const tareas = [
            () => root.haikuSincronizarReservasSupabase?.(),
            () => root.HAIKU_RESERVAS_V1?.recargar?.(),
            () => root.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(),
            () => root.haikuCargarSaldosCheckinSupabase?.()
        ];
        const inspector = root.HAIKU_INSPECTOR_V1 || root.HAIKU_PANELES_V1;
        const estadoInspector = inspector?.estado?.();
        if (estadoInspector?.reservaAbierta && ids.has(String(estadoInspector.entidadInspector || ""))) {
            tareas.push(() => inspector.abrirReserva(String(estadoInspector.entidadInspector)));
        }
        const vistas = await Promise.allSettled(tareas.map(tarea => Promise.resolve().then(tarea)));

        const entradas = (modelo.informe?.filas || []).map(fila => fila.entrada).filter(Boolean);
        const lector = root.HAIKU_CLOUDBEDS_PDF_V1;
        if (!entradas.length || typeof lector?.consultar !== "function") {
            throw new Error("No fue posible reconstruir el informe Cloudbeds desde su fuente original.");
        }
        // La tarjeta se reconstruye desde Proyecto H; nunca se parchean montos locales.
        const informe = await lector.consultar(entradas, cliente);
        const modeloActualizado = await preparar(informe, cliente);
        return Object.freeze({ informe, modelo: modeloActualizado, vistas });
    }

    function construirResultadoPostWrite(modeloAnterior, reconsulta, data) {
        const payload = construirPayload(modeloAnterior);
        const itemsReconsultados = reconsulta?.modelo?.items;
        if (!payload.length || !Array.isArray(itemsReconsultados)) {
            return Object.freeze({ confirmado: false, motivo: "La reconsulta no entregó un modelo verificable." });
        }

        const actualizaciones = [];
        for (const [indice, esperado] of payload.entries()) {
            const itemAnterior = modeloAnterior.items.find(item => {
                const propuesta = item.fila?.propuesta || {};
                return String(propuesta.reserva_id || "") === String(esperado.reserva_id)
                    && String(propuesta.estadia_id || "") === String(esperado.estadia_id);
            });
            const itemActual = itemsReconsultados.find(item => {
                const propuesta = item.fila?.propuesta || {};
                return String(propuesta.reserva_id || "") === String(esperado.reserva_id)
                    && String(propuesta.estadia_id || "") === String(esperado.estadia_id);
            });
            const propuestaActual = itemActual?.fila?.propuesta || {};
            const totalAnterior = Number(itemAnterior?.preview?.total_actual ?? esperado.total_actual_esperado);
            const totalNuevo = Number(propuestaActual.total_actual_haku);
            const pagado = Number(propuestaActual.pagado_actual_haku);
            const saldo = Number(propuestaActual.saldo_actual_haku);
            if (![totalAnterior, totalNuevo, pagado, saldo].every(Number.isSafeInteger)
                || totalNuevo !== Number(esperado.total_objetivo)) {
                return Object.freeze({
                    confirmado: false,
                    motivo: "El estado reconsultado no coincide con el objetivo confirmado."
                });
            }
            actualizaciones.push(Object.freeze({
                reserva_id: String(esperado.reserva_id),
                estadia_id: String(esperado.estadia_id),
                nombre: itemActual.fila?.entrada?.nombre_huesped
                    || itemAnterior?.fila?.entrada?.nombre_huesped
                    || "Reserva Cloudbeds",
                total_anterior: totalAnterior,
                total_nuevo: totalNuevo,
                pagado,
                saldo,
                certeza: itemActual.certeza_cloudbeds,
                operacion_id: data?.resultados?.[indice]?.operacion_id || null
            }));
        }
        return Object.freeze({ confirmado: true, actualizaciones: Object.freeze(actualizaciones) });
    }

    async function ejecutarActualizacion(modelo, cliente) {
        if (!CLOUDBEDS_TARIFAS_WRITER_HABILITADO) {
            return Object.freeze({
                ok: false,
                codigo: "WRITER_DESHABILITADO",
                escrituras: 0,
                mensaje: "Escritura aún no habilitada. No se envió ningún cambio."
            });
        }
        const payload = construirPayload(modelo);
        if (!payload.length || !cliente || typeof cliente.rpc !== "function") {
            return Object.freeze({
                ok: false,
                codigo: "RESERVA_NO_ELEGIBLE",
                escrituras: 0,
                mensaje: MENSAJES_WRITER.RESERVA_NO_ELEGIBLE
            });
        }
        let respuesta;
        try {
            respuesta = await cliente.rpc(RPC_WRITER, { p_operaciones: payload });
        } catch (error) {
            const diagnostico = crearDiagnosticoWriter("writer", error);
            return Object.freeze({ ok: false, escrituras: 0, ...mapearErrorWriter(error), diagnostico });
        }
        const { data, error } = respuesta || {};
        if (error) {
            const diagnostico = crearDiagnosticoWriter("writer", error);
            return Object.freeze({ ok: false, escrituras: 0, ...mapearErrorWriter(error), diagnostico });
        }
        if (data?.ok !== true || !Array.isArray(data.resultados) || data.resultados.length !== payload.length) {
            const errorContrato = {
                message: "CONFLICTO_FINANCIERO",
                details: "La respuesta del writer no coincide con el lote confirmado."
            };
            return Object.freeze({
                ok: false,
                codigo: "CONFLICTO_FINANCIERO",
                escrituras: 0,
                mensaje: MENSAJES_WRITER.CONFLICTO_FINANCIERO,
                diagnostico: crearDiagnosticoWriter("writer", errorContrato)
            });
        }
        try {
            const reconsulta = await reconsultarDespuesDeEscritura(modelo, cliente);
            const resultadoPostWrite = construirResultadoPostWrite(modelo, reconsulta, data);
            return Object.freeze({
                ok: true,
                escrituras: Number(data.cambios || 0),
                data,
                reconsulta,
                estado_final_confirmado: resultadoPostWrite.confirmado,
                confirmacion_post_write: resultadoPostWrite.confirmado ? resultadoPostWrite : null,
                requiere_reapertura: !resultadoPostWrite.confirmado,
                mensaje: resultadoPostWrite.confirmado
                    ? "Tarifa actualizada correctamente."
                    : "Proyecto H confirmó la operación, pero no fue posible refrescar la reserva. Vuelve a cargarla antes de continuar.",
                error_reconsulta: resultadoPostWrite.confirmado ? null : resultadoPostWrite.motivo
            });
        } catch (errorReconsulta) {
            return Object.freeze({
                ok: true,
                escrituras: Number(data.cambios || 0),
                data,
                reconsulta: null,
                estado_final_confirmado: false,
                confirmacion_post_write: null,
                requiere_reapertura: true,
                mensaje: "Proyecto H confirmó la operación, pero no fue posible refrescar la reserva. Vuelve a cargarla antes de continuar.",
                error_reconsulta: errorReconsulta?.message || "Reconsulta no disponible."
            });
        }
    }

    function confirmarSimulacion(modelo) {
        const payload = construirPayload(modelo);
        const resultado = Object.freeze({
            ok: payload.length > 0,
            simulado: true,
            escrituras: 0,
            payload,
            mensaje: payload.length
                ? `Simulación preparada para ${payload.length} ${payload.length === 1 ? "tarifa" : "tarifas"}. No se escribió ningún dato.`
                : "Selecciona al menos una propuesta segura."
        });
        modelo.ultima_simulacion = resultado;
        return resultado;
    }

    function abrirReserva(reservaId, origen) {
        const inspector = root.HAIKU_INSPECTOR_V1 || root.HAIKU_PANELES_V1;
        if (!reservaId || typeof inspector?.abrirReserva !== "function") return false;
        return inspector.abrirReserva(String(reservaId), origen);
    }

    function etiquetaCompatibilidad(item) {
        const etiquetas = {
            REQUIERE_REVALIDACION_V31: "Pendiente de revalidación v31",
            REQUIERE_REVALIDACION_V32: "Pendiente de revalidación v32",
            REQUIERE_REVISION_V32: "Servicios detectados · revisión manual hasta disponer de TOTAL v32",
            SERVICIOS_CERTIFICADOS_V32: "Servicios separados certificados por v32",
            REQUIERE_REVISION_MANUAL_SERVICIOS: "Servicios o pagos ambiguos · revisión manual",
            CAPACIDAD_TOTAL_NO_DISPONIBLE: "Capacidad TOTAL no disponible",
            REQUIERE_REVISION_FINANCIERA: "Requiere revisión financiera",
            NO_EVALUADA: "No corresponde evaluar"
        };
        return etiquetas[item.compatibilidad_financiera] || item.compatibilidad_financiera;
    }

    function renderProductos(propuesta) {
        const productos = Array.isArray(propuesta.productos) ? propuesta.productos : [];
        if (!productos.length) return "";
        return `<div class="haiku-cloudbeds-tarifas-productos">
            <strong>Productos Cloudbeds</strong>
            <p>${esc(productos.join(", "))}</p>
            <dl>
                <div><dt>Precio total</dt><dd>${esc(moneda(propuesta.precio_total_cloudbeds))}</dd></div>
                <div><dt>Alojamiento candidato</dt><dd>${esc(moneda(propuesta.total_alojamiento_propuesto || propuesta.deposito_cloudbeds))}</dd></div>
                <div><dt>Componente no alojamiento observable</dt><dd>${esc(moneda(propuesta.componente_no_alojamiento_observable))}</dd></div>
            </dl>
        </div>`;
    }

    function renderIdentidadContextual(fila) {
        if (["CONTEXTO_NOMBRE_PARCIAL_UNICO", "CONTEXTO_TYPO_UNICO"].includes(fila?.identidad_tipo)) {
            const propuesta = fila.propuesta || {};
            const esParcial = fila.identidad_tipo === "CONTEXTO_NOMBRE_PARCIAL_UNICO";
            const detalle = esParcial
                ? propuesta.nombre_parcial_origen === "cloudbeds"
                    ? "Cloudbeds contiene una versión abreviada del nombre"
                    : "Proyecto H contiene una versión abreviada del nombre"
                : "Los nombres difieren en un único carácter";
            return `<div class="haiku-cloudbeds-tarifas-identidad-contextual" data-cloudbeds-identidad="${esc(fila.identidad_tipo)}">
                <strong><span aria-hidden="true">✓</span> Reserva identificada por contexto único</strong>
                <span><span aria-hidden="true">≈</span> ${esc(detalle)}</span>
                <small><b>Cloudbeds:</b> ${esc(propuesta.nombre_cloudbeds || fila.entrada?.nombre_huesped || "—")}<br><b>Proyecto H:</b> ${esc(propuesta.nombre_proyecto_h || "—")}</small>
            </div>`;
        }
        if (fila?.identidad_tipo === "CONTEXTO_FULLDAY_UNICO") {
            const nombreExacto = !(fila.revisiones || []).some(item => /nombre no coincide|nombre.*no coincide/i.test(String(item)));
            return `<div class="haiku-cloudbeds-tarifas-identidad-contextual" data-cloudbeds-identidad="CONTEXTO_FULLDAY_UNICO">
                <strong><span aria-hidden="true">${nombreExacto ? "✓" : "!"}</span> Full Day identificado por contexto único</strong>
                <span><span aria-hidden="true">○</span> Vínculo Cloudbeds sugerido, no guardado</span>
                <small>${nombreExacto
                    ? "Nombre exacto, misma cabaña y patrón Cloudbeds D → D+1 contra Proyecto H D → D identifican una única estadía Full Day."
                    : "La cabaña y el patrón de fechas identifican una única estadía Full Day, pero el nombre distinto exige revisión manual."}</small>
            </div>`;
        }
        if (fila?.identidad_tipo === "CONTEXTO_EXACTO_UNICO") {
            return `<div class="haiku-cloudbeds-tarifas-identidad-contextual" data-cloudbeds-identidad="CONTEXTO_EXACTO_UNICO">
                <strong><span aria-hidden="true">✓</span> Reserva identificada por contexto exacto</strong>
                <span><span aria-hidden="true">○</span> Vínculo Cloudbeds aún no guardado</span>
                <small>Nombre, cabaña, check-in y check-out identifican una única reserva de Proyecto H.</small>
            </div>`;
        }
        return "";
    }

    function renderFullDay(propuesta) {
        if (!propuesta?.es_full_day) return "";
        const personas = [
            `${propuesta.adultos_proyecto_h ?? "—"} adultos`,
            `${propuesta.ninos_proyecto_h ?? "—"} niños`,
            `${propuesta.mascotas_proyecto_h ?? "—"} mascotas`
        ].join(" · ");
        const referencia = propuesta.referencia_fullday_clp === null || propuesta.referencia_fullday_clp === undefined
            ? "No generalizable para esta composición"
            : moneda(propuesta.referencia_fullday_clp);
        return `<div class="haiku-cloudbeds-tarifas-fullday" data-cloudbeds-fullday>
            <strong><span>FULL DAY</span> Proyecto H D → D · Cloudbeds D → D+1</strong>
            <p>${esc(fechaCorta(propuesta.fecha_ingreso_proyecto_h))} → ${esc(fechaCorta(propuesta.fecha_salida_proyecto_h))} en Proyecto H · ${esc(fechaCorta(propuesta.check_in))} → ${esc(fechaCorta(propuesta.check_out))} en Cloudbeds</p>
            <dl>
                <div><dt>Personas Proyecto H</dt><dd>${esc(personas)}</dd></div>
                <div><dt>Referencia FD</dt><dd>${esc(referencia)}</dd></div>
                <div><dt>Precio Total Cloudbeds</dt><dd>${esc(moneda(propuesta.precio_total_cloudbeds))}</dd></div>
                <div><dt>Depósito / alojamiento</dt><dd>${esc(moneda(propuesta.deposito_cloudbeds))}</dd></div>
                <div><dt>Pagado actual</dt><dd>${esc(moneda(propuesta.pagado_actual_haku))}</dd></div>
                <div><dt>Saldo actual</dt><dd>${esc(moneda(propuesta.saldo_actual_haku))}</dd></div>
                <div><dt>Saldo esperado</dt><dd>${esc(moneda(propuesta.saldo_esperado_haku))}</dd></div>
            </dl>
        </div>`;
    }

    function renderConfirmacionDetalle(modelo) {
        const seleccionados = modelo.items.filter(item => item.seleccionable && item.seleccionado);
        return seleccionados.map(item => {
            const propuesta = item.fila.propuesta || {};
            const preview = item.preview;
            const entrada = item.fila.entrada || {};
            const nombre = entrada.nombre_huesped
                || [entrada.nombre, entrada.apellido].filter(Boolean).join(" ")
                || propuesta.nombre_cloudbeds
                || "Reserva Cloudbeds";
            const totalActual = Number(preview?.total_actual ?? propuesta.total_actual_haku);
            const pagado = Number(preview?.pagado_actual ?? propuesta.pagado_actual_haku);
            const saldoActual = Number(preview?.saldo_actual ?? propuesta.saldo_actual_haku);
            const objetivo = Number(preview?.total_objetivo ?? propuesta.total_alojamiento_propuesto);
            const saldoEsperado = Number.isSafeInteger(Number(preview?.saldo_esperado))
                ? Number(preview.saldo_esperado)
                : Number.isSafeInteger(Number(propuesta.saldo_esperado_haku))
                    ? Number(propuesta.saldo_esperado_haku)
                : Number.isSafeInteger(pagado) ? objetivo - pagado : null;
            const serviciosCertificados = item.tiene_servicios
                && preview?.elegible === true
                && preview?.autoridad_financiera_version === VERSION_V32
                && preview?.servicios_sin_cambios === true;
            const serviciosBloqueados = item.tiene_servicios && preview?.elegible === false;
            return `<article class="haiku-cloudbeds-tarifas-confirmacion-item">
                <header class="haiku-cloudbeds-tarifas-confirmacion-reserva">
                    <strong>${esc(nombre)}</strong>
                    <span>${preview?.cabana_numero || propuesta.cabana ? `CAB ${esc(preview?.cabana_numero || propuesta.cabana)}` : "Cabaña no identificada"} · ${(preview?.tipo_estadia || (propuesta.es_full_day ? "fullday" : propuesta.tipo_estadia_proyecto_h)) === "fullday" ? "Full Day" : "Alojamiento"}</span>
                </header>
                ${preview?.cambio_desde_pdf ? `<p class="haiku-cloudbeds-tarifas-preview-alerta">Proyecto H cambió desde que se cargó el PDF. Estos son los valores reconsultados antes de confirmar.</p>` : ""}
                ${serviciosBloqueados ? `<p class="haiku-cloudbeds-tarifas-preview-alerta">Hay pagos o cargos mezclados entre alojamiento y servicios. Revisión manual requerida.</p>` : ""}
                ${preview?.elegible === false && !serviciosBloqueados ? `<p class="haiku-cloudbeds-tarifas-preview-alerta">${esc(preview.motivo_bloqueo || "La reserva ya no es elegible.")}</p>` : ""}
                ${serviciosCertificados ? `<p class="haiku-cloudbeds-tarifas-servicios-info">Los servicios se conservarán sin cambios.</p>` : ""}
                <dl class="haiku-cloudbeds-tarifas-confirmacion-valores">
                    <div><dt>Cabaña</dt><dd>${preview?.cabana_numero || propuesta.cabana ? `CAB ${esc(preview?.cabana_numero || propuesta.cabana)}` : "—"}</dd></div>
                    <div><dt>Tipo</dt><dd>${(preview?.tipo_estadia || (propuesta.es_full_day ? "fullday" : propuesta.tipo_estadia_proyecto_h)) === "fullday" ? "Full Day" : "Alojamiento"}</dd></div>
                    <div><dt>Alojamiento actual</dt><dd>${esc(moneda(totalActual))}</dd></div>
                    <div><dt>Alojamiento Cloudbeds</dt><dd>${esc(moneda(objetivo))}</dd></div>
                    ${serviciosCertificados ? `<div><dt>Servicios sin cambios</dt><dd>${esc(moneda(preview.total_servicios_sin_cambio))}</dd></div>
                    <div><dt>Total reserva actual</dt><dd>${esc(moneda(preview.total_reserva_actual))}</dd></div>
                    <div><dt>Total reserva esperado</dt><dd>${esc(moneda(preview.total_reserva_esperado))}</dd></div>` : ""}
                    <div><dt>Diferencia</dt><dd>${esc(moneda(objetivo - totalActual))}</dd></div>
                    <div><dt>Pagado actual</dt><dd>${esc(moneda(pagado))}</dd></div>
                    <div><dt>Saldo actual</dt><dd>${esc(moneda(saldoActual))}</dd></div>
                    <div><dt>Saldo esperado</dt><dd>${esc(moneda(saldoEsperado))}</dd></div>
                </dl>
            </article>`;
        }).join("");
    }

    function renderItem(item, actualizacionesBloqueadas = false) {
        const fila = item.fila;
        const propuesta = fila.propuesta || {};
        const entrada = fila.entrada || {};
        const nombre = entrada.nombre_huesped || [entrada.nombre, entrada.apellido].filter(Boolean).join(" ") || "Reserva Cloudbeds";
        const cabana = propuesta.cabana ? `CAB ${propuesta.cabana}` : "Cabaña no identificada";
        const diferencia = propuesta.diferencia;
        const evidencias = (fila.evidencias || propuesta.evidencias || [])
            .filter(evidencia => !["CONTEXTO_EXACTO_UNICO", "CONTEXTO_FULLDAY_UNICO", "CONTEXTO_TYPO_UNICO", "CONTEXTO_NOMBRE_PARCIAL_UNICO"].includes(fila.identidad_tipo)
                || (!String(evidencia).startsWith("Reserva identificada por contexto exacto")
                    && !String(evidencia).startsWith("Reserva identificada por contexto único")
                    && !String(evidencia).startsWith("Reserva Full Day identificada por contexto único")
                    && !String(evidencia).includes("versión abreviada del nombre")
                    && !String(evidencia).startsWith("Los nombres difieren en un único carácter")
                    && !String(evidencia).startsWith("Proyecto H aún no tiene vínculo Cloudbeds guardado")))
            .slice(0, 12);
        const revisiones = fila.revisiones || propuesta.revisiones || [];
        const seleccion = item.seleccionable
            ? `<button type="button" class="haiku-cloudbeds-tarifas-simular-item" data-cloudbeds-seleccionar="${esc(item.id)}" aria-pressed="${item.seleccionado}" ${actualizacionesBloqueadas ? "disabled" : ""}>${item.seleccionado ? "Quitar de actualización" : "Preparar actualización"}</button>`
            : "";
        const preparacionFullDay = capacidadCorreccionFullDay(fila);
        const accionFullDayFutura = !CLOUDBEDS_TARIFAS_WRITER_HABILITADO && preparacionFullDay.preparada
            ? `<button type="button" class="haiku-cloudbeds-tarifas-fd3" disabled title="Preparada para una etapa futura; no ejecuta escrituras">Actualizar tarifa Full Day</button>`
            : "";
        return `<article class="haiku-cloudbeds-tarifas-tarjeta" data-cloudbeds-item="${esc(item.id)}">
            <header>
                <div class="haiku-cloudbeds-tarifas-identidad"><strong title="${esc(nombre)} · ${esc(cabana)}">${esc(nombre)} · ${esc(cabana)}</strong><span>${esc(fechaCorta(propuesta.check_in))} → ${esc(fechaCorta(propuesta.check_out))}</span></div>
                <span class="haiku-cloudbeds-tarifas-certeza haiku-cloudbeds-tarifas-certeza--${esc(fila.certeza.toLowerCase())}">${esc(fila.certeza.replaceAll("_", " "))}</span>
            </header>
            <dl class="haiku-cloudbeds-tarifas-montos">
                <div><dt>Proyecto H</dt><dd>${esc(moneda(propuesta.total_actual_haku))}</dd></div>
                <div><dt>Alojamiento Cloudbeds</dt><dd>${esc(moneda(propuesta.total_alojamiento_propuesto || propuesta.deposito_cloudbeds))}</dd></div>
                <div><dt>Diferencia</dt><dd class="${Number(diferencia) < 0 ? "es-negativa" : ""}">${diferencia === null || diferencia === undefined ? "No calculable" : esc(moneda(diferencia))}</dd></div>
            </dl>
            <footer class="haiku-cloudbeds-tarifas-acciones">
                <button type="button" data-cloudbeds-ver-reserva="${esc(item.id)}" ${propuesta.reserva_id ? "" : "disabled"}>Ver reserva</button>
                ${seleccion}
                ${accionFullDayFutura}
                ${item.seleccionable
                    ? `<button type="button" class="haiku-cloudbeds-tarifas-writer" data-cloudbeds-actualizar="${esc(item.id)}" ${CLOUDBEDS_TARIFAS_WRITER_HABILITADO && !actualizacionesBloqueadas ? "" : "disabled"}>${CLOUDBEDS_TARIFAS_WRITER_HABILITADO ? "Actualizar tarifa" : "Escritura aún no habilitada"}</button>`
                    : ""}
            </footer>
            <details class="haiku-cloudbeds-tarifas-detalle">
                <summary><span>Ver detalle</span><span class="haiku-cloudbeds-tarifas-chevron" aria-hidden="true"></span></summary>
                <div class="haiku-cloudbeds-tarifas-detalle-cuerpo">
                    <div class="haiku-cloudbeds-tarifas-capas">
                        <span><b>Certeza Cloudbeds</b>${esc(fila.certeza.replaceAll("_", " "))}</span>
                        <span><b>Compatibilidad financiera</b>${esc(etiquetaCompatibilidad(item))}</span>
                    </div>
                    ${renderIdentidadContextual(fila)}
                    ${renderFullDay(propuesta)}
                    ${renderProductos(propuesta)}
                    ${evidencias.length ? `<div class="haiku-cloudbeds-tarifas-evidencias"><strong>Evidencias</strong><ul>${evidencias.map(evidencia => `<li>${esc(evidencia)}</li>`).join("")}</ul></div>` : ""}
                    ${revisiones.length ? `<div class="haiku-cloudbeds-tarifas-revision"><strong>Revisar</strong><ul>${revisiones.map(revision => `<li>${esc(revision)}</li>`).join("")}</ul></div>` : ""}
                    <details class="haiku-cloudbeds-tarifas-tecnico"><summary>Detalles técnicos <span aria-hidden="true">⌄</span></summary><pre>${esc(JSON.stringify({
                        identidad_tipo: fila.identidad_tipo,
                        vinculo_cloudbeds_sugerido: fila.vinculo_cloudbeds_sugerido,
                        certeza_cloudbeds: item.certeza_cloudbeds,
                        compatibilidad_financiera: item.compatibilidad_financiera,
                        propuesta
                    }, null, 2))}</pre></details>
                </div>
            </details>
        </article>`;
    }

    function renderCategoria(modelo, certeza) {
        const items = modelo.items.filter(item => item.certeza_cloudbeds === certeza);
        const presentacion = {
            ALTA_CERTEZA: { simbolo: "✓", tono: "segura", subtitulo: "Revisión previa, lista para preparar" },
            SIN_CAMBIO: { simbolo: "=", tono: "neutral", subtitulo: "Sin actualización propuesta" },
            REVISION_MANUAL: { simbolo: "!", tono: "manual", subtitulo: "Resolver antes de preparar" },
            NO_APLICA: { simbolo: "—", tono: "atenuada", subtitulo: "Fuera de esta actualización" },
            NO_IDENTIFICADA: { simbolo: "?", tono: "atenuada", subtitulo: "Identidad sin resolver" }
        }[certeza];
        return `<details class="haiku-cloudbeds-tarifas-categoria" data-cloudbeds-categoria="${certeza}" ${certeza === "ALTA_CERTEZA" && items.length ? "open" : ""}>
            <summary>
                <span class="haiku-cloudbeds-tarifas-categoria-simbolo haiku-cloudbeds-tarifas-categoria-simbolo--${presentacion.tono}" aria-hidden="true">${presentacion.simbolo}</span>
                <span class="haiku-cloudbeds-tarifas-categoria-nombre"><b>${esc(CATEGORIAS[certeza])}</b><small>${esc(presentacion.subtitulo)}</small></span>
                <strong>${items.length}</strong>
                <span class="haiku-cloudbeds-tarifas-chevron" aria-hidden="true"></span>
            </summary>
            <div class="haiku-cloudbeds-tarifas-categoria-cuerpo">${items.length ? items.map(item => renderItem(item, modelo.actualizaciones_bloqueadas)).join("") : "<p>No hay reservas en esta categoría.</p>"}</div>
        </details>`;
    }

    function renderResultadoPostWrite(modelo) {
        const resultado = modelo.resultado_post_write;
        if (!resultado) return `<section class="haiku-cloudbeds-tarifas-post-write" data-cloudbeds-post-write hidden></section>`;
        if (resultado.tipo === "advertencia") {
            return `<section class="haiku-cloudbeds-tarifas-post-write haiku-cloudbeds-tarifas-post-write--advertencia" data-cloudbeds-post-write role="status">
                <strong>Actualización registrada; refresco pendiente</strong>
                <p>${esc(resultado.mensaje)}</p>
            </section>`;
        }
        const actualizaciones = Array.isArray(resultado.actualizaciones) ? resultado.actualizaciones : [];
        return `<section class="haiku-cloudbeds-tarifas-post-write haiku-cloudbeds-tarifas-post-write--exito" data-cloudbeds-post-write role="status" aria-live="polite">
            <header class="haiku-cloudbeds-tarifas-post-write-cabecera"><span aria-hidden="true">✓</span><div><strong>Tarifa actualizada correctamente</strong><small>Estado final verificado</small></div></header>
            <div class="haiku-cloudbeds-tarifas-post-write-lista">${actualizaciones.map(actualizacion => `<article>
                <header><strong class="haiku-cloudbeds-tarifas-post-write-nombre">${esc(actualizacion.nombre)}</strong><span>Proyecto H</span></header>
                <dl>
                    <div><dt>Proyecto H</dt><dd>${esc(moneda(actualizacion.total_anterior))} <span aria-hidden="true">→</span> ${esc(moneda(actualizacion.total_nuevo))}</dd></div>
                    <div><dt>Pagado</dt><dd>${esc(moneda(actualizacion.pagado))}</dd></div>
                    <div><dt>Saldo</dt><dd>${esc(moneda(actualizacion.saldo))}</dd></div>
                </dl>
            </article>`).join("")}</div>
            <p>La reserva fue reconsultada y el cambio quedó registrado.</p>
            <div class="haiku-cloudbeds-tarifas-post-write-acciones">
                ${actualizaciones.map((actualizacion, indice) => `<button type="button" data-cloudbeds-post-write-ver-reserva="${esc(actualizacion.reserva_id)}">${actualizaciones.length === 1 ? "Ver reserva" : `Ver reserva ${indice + 1}`}</button>`).join("")}
                <button type="button" data-cloudbeds-post-write-cerrar>Cerrar</button>
            </div>
        </section>`;
    }

    function renderizar(modelo) {
        const capacidad = modelo.capacidad;
        const seleccionados = cantidadSeleccionada(modelo);
        const totalResultados = CERTEZAS.reduce((total, certeza) => total + Number(modelo.conteos[certeza] || 0), 0);
        const totalSeleccionables = modelo.items.filter(item => item.seleccionable).length;
        const writerAuditado = modelo.writer_habilitado === true && capacidadTotalDisponible(capacidad);
        return `<section class="haiku-cloudbeds-tarifas haiku-cloudbeds-tarifas-v1" data-cloudbeds-tarifas-2e>
            <header class="haiku-cloudbeds-tarifas-cabecera">
                <div><span>CLOUDBEDS · REVISIÓN DE PDF</span><strong>Tarifas</strong><p>Propuestas de alojamiento · ${totalResultados} ${totalResultados === 1 ? "resultado" : "resultados"}</p></div>
                ${writerAuditado ? `<span class="haiku-cloudbeds-tarifas-seguro">Writer auditado</span>` : ""}
            </header>
            <section class="haiku-cloudbeds-tarifas-resumen" aria-label="Resumen de resultados">
                <div class="haiku-cloudbeds-tarifas-decision">
                    <div class="haiku-cloudbeds-tarifas-decision-principal"><strong>${modelo.conteos.ALTA_CERTEZA}</strong><span>propuestas seguras<small>listas para revisar</small></span></div>
                    <div class="haiku-cloudbeds-tarifas-decision-manual"><strong>${modelo.conteos.REVISION_MANUAL}</strong><span>requieren revisión manual</span></div>
                </div>
                <div class="haiku-cloudbeds-tarifas-otros" aria-label="Otros resultados">
                    <span><b>${modelo.conteos.SIN_CAMBIO}</b> coinciden</span>
                    <span><b>${modelo.conteos.NO_APLICA}</b> canceladas / no aplica</span>
                    <span><b>${modelo.conteos.NO_IDENTIFICADA}</b> no identificadas</span>
                </div>
            </section>
            <div class="haiku-cloudbeds-tarifas-capacidad ${capacidadTotalDisponible(capacidad) ? "es-disponible" : "es-bloqueada"}">
                <span class="haiku-cloudbeds-tarifas-capacidad-icono" aria-hidden="true">ⓘ</span>
                <div><strong>Capacidad financiera global ${capacidadTotalDisponible(capacidad) ? "disponible" : "no disponible"}</strong>
                <span><code>${esc(capacidad.version || "Sin versión")}</code> · ${esc(capacidad.motivo)}</span></div>
            </div>
            ${renderResultadoPostWrite(modelo)}
            <div class="haiku-cloudbeds-tarifas-categorias">${CERTEZAS.map(certeza => renderCategoria(modelo, certeza)).join("")}</div>
            <section class="haiku-cloudbeds-tarifas-confirmacion" data-cloudbeds-confirmacion role="dialog" aria-modal="false" aria-labelledby="cloudbeds-confirmacion-titulo" hidden>
                <header class="haiku-cloudbeds-tarifas-confirmacion-cabecera"><span aria-hidden="true">↗</span><div><strong id="cloudbeds-confirmacion-titulo">Actualizar tarifa</strong><p data-cloudbeds-confirmacion-texto></p></div><span>Por confirmar</span></header>
                <div class="haiku-cloudbeds-tarifas-confirmacion-detalle" data-cloudbeds-confirmacion-detalle>${renderConfirmacionDetalle(modelo)}</div>
                <p class="haiku-cloudbeds-tarifas-confirmacion-impacto">Este cambio modificará el total de alojamiento en Proyecto H. Los pagos existentes no serán modificados.</p>
                <div class="haiku-cloudbeds-tarifas-confirmacion-acciones"><button type="button" data-cloudbeds-cancelar>Cancelar</button><button type="button" data-cloudbeds-confirmar disabled>Confirmar actualización</button></div>
            </section>
            <p class="haiku-cloudbeds-tarifas-estado" data-cloudbeds-estado role="status">${modelo.resultado_post_write?.tipo === "advertencia"
                ? esc(modelo.resultado_post_write.mensaje)
                : modelo.resultado_post_write?.tipo === "exito"
                    ? "Estado final confirmado con datos reconsultados de Proyecto H."
                    : "Selecciona una propuesta segura para reconsultar Proyecto H antes de confirmar."}</p>
            <details class="haiku-cloudbeds-tarifas-payload"><summary>Payload W1 · diagnóstico</summary><pre data-cloudbeds-payload>${esc(JSON.stringify(contenidoDiagnostico(modelo), null, 2))}</pre></details>
            <div class="haiku-cloudbeds-tarifas-lote">
                <button type="button" data-cloudbeds-seleccionar-todo aria-pressed="${totalSeleccionables > 0 && seleccionados === totalSeleccionables}" ${modelo.actualizaciones_bloqueadas ? "disabled" : ""}>Seleccionar todo lo listo</button>
                <span data-cloudbeds-seleccion-conteo><b>${seleccionados}</b> de ${totalSeleccionables} propuestas seleccionadas</span>
                <button type="button" data-cloudbeds-abrir-confirmacion ${seleccionados && !modelo.actualizaciones_bloqueadas ? "" : "disabled"}>Revisar actualizaciones</button>
            </div>
        </section>`;
    }

    function actualizarDiagnosticoDOM(contenedor, modelo) {
        const pre = contenedor.querySelector("[data-cloudbeds-payload]");
        if (pre) pre.textContent = JSON.stringify(contenidoDiagnostico(modelo), null, 2);
    }

    function actualizarDOM(contenedor, modelo) {
        const cantidad = cantidadSeleccionada(modelo);
        const totalSeleccionables = modelo.items.filter(item => item.seleccionable).length;
        contenedor.querySelectorAll("[data-cloudbeds-seleccionar]").forEach(boton => {
            const item = buscarItem(modelo, boton.dataset.cloudbedsSeleccionar);
            boton.setAttribute("aria-pressed", String(Boolean(item?.seleccionado)));
            boton.textContent = item?.seleccionado ? "Quitar de actualización" : "Preparar actualización";
        });
        const conteo = contenedor.querySelector("[data-cloudbeds-seleccion-conteo]");
        if (conteo) conteo.innerHTML = `<b>${cantidad}</b> de ${totalSeleccionables} propuestas seleccionadas`;
        const seleccionarTodoBoton = contenedor.querySelector("[data-cloudbeds-seleccionar-todo]");
        if (seleccionarTodoBoton) seleccionarTodoBoton.setAttribute("aria-pressed", String(totalSeleccionables > 0 && cantidad === totalSeleccionables));
        const abrir = contenedor.querySelector("[data-cloudbeds-abrir-confirmacion]");
        if (abrir) {
            abrir.disabled = cantidad === 0 || modelo.actualizaciones_bloqueadas;
            abrir.textContent = "Revisar actualizaciones";
        }
        const postWrite = contenedor.querySelector("[data-cloudbeds-post-write]");
        if (postWrite) postWrite.outerHTML = renderResultadoPostWrite(modelo);
        actualizarDiagnosticoDOM(contenedor, modelo);
        const confirmacion = contenedor.querySelector("[data-cloudbeds-confirmacion]");
        if (confirmacion && !modelo.ultima_simulacion) confirmacion.hidden = true;
        const detalle = contenedor.querySelector("[data-cloudbeds-confirmacion-detalle]");
        if (detalle) detalle.innerHTML = renderConfirmacionDetalle(modelo);
    }

    async function abrirConfirmacion(contenedor, modelo, cliente) {
        const cantidad = cantidadSeleccionada(modelo);
        if (!cantidad) return false;
        const confirmacion = contenedor.querySelector("[data-cloudbeds-confirmacion]");
        const estado = contenedor.querySelector("[data-cloudbeds-estado]");
        if (CLOUDBEDS_TARIFAS_WRITER_HABILITADO) {
            estado.textContent = "Reconsultando Proyecto H antes de confirmar…";
            const resultadoPreview = await previsualizarSeleccion(modelo, cliente);
            modelo.diagnostico_writer = resultadoPreview.ok
                ? null
                : (resultadoPreview.diagnostico || Object.freeze({
                    etapa: "preview",
                    codigo: resultadoPreview.codigo,
                    mensaje: resultadoPreview.mensaje
                }));
            actualizarDiagnosticoDOM(contenedor, modelo);
            confirmacion.hidden = false;
            confirmacion.querySelector("[data-cloudbeds-confirmacion-detalle]").innerHTML =
                renderConfirmacionDetalle(modelo);
            confirmacion.querySelector("[data-cloudbeds-confirmar]").disabled = !resultadoPreview.ok;
            estado.textContent = resultadoPreview.mensaje;
            if (!resultadoPreview.ok) return false;
        }
        confirmacion.hidden = false;
        confirmacion.querySelector("[data-cloudbeds-confirmacion-texto]").textContent =
            `Revisa ${cantidad} ${cantidad === 1 ? "tarifa" : "tarifas"} antes de confirmar.`;
        confirmacion.querySelector("[data-cloudbeds-confirmacion-detalle]").innerHTML =
            renderConfirmacionDetalle(modelo);
        return true;
    }

    function montar(contenedor, modelo, cliente = null) {
        if (!contenedor || typeof contenedor.addEventListener !== "function") throw new Error("Contenedor Haku inválido.");
        contenedor.innerHTML = renderizar(modelo);
        contenedor.classList?.add("haiku-asistente-mensaje--cloudbeds-tarifas");
        let ejecutando = false;
        contenedor.addEventListener("click", async evento => {
            const boton = evento.target.closest?.("button");
            if (!boton || ejecutando) return;
            if (boton.matches("[data-cloudbeds-post-write-ver-reserva]")) {
                evento.preventDefault();
                Promise.resolve(abrirReserva(boton.dataset.cloudbedsPostWriteVerReserva, boton)).catch(error => {
                    const estado = contenedor.querySelector("[data-cloudbeds-estado]");
                    if (estado) estado.textContent = error?.message || "No fue posible abrir la reserva.";
                });
                return;
            }
            if (boton.matches("[data-cloudbeds-post-write-cerrar]")) {
                modelo.resultado_post_write = null;
                boton.closest("[data-cloudbeds-post-write]")?.remove();
                const estado = contenedor.querySelector("[data-cloudbeds-estado]");
                if (estado) estado.textContent = "Selecciona una propuesta segura para reconsultar Proyecto H antes de confirmar.";
                return;
            }
            if (boton.matches("[data-cloudbeds-ver-reserva]")) {
                const item = buscarItem(modelo, boton.dataset.cloudbedsVerReserva);
                if (!item?.fila?.propuesta?.reserva_id) return;
                evento.preventDefault();
                Promise.resolve(abrirReserva(item.fila.propuesta.reserva_id, boton)).catch(error => {
                    const estado = contenedor.querySelector("[data-cloudbeds-estado]");
                    if (estado) estado.textContent = error?.message || "No fue posible abrir la reserva.";
                });
                return;
            }
            if (boton.matches("[data-cloudbeds-actualizar]")) {
                if (modelo.actualizaciones_bloqueadas) return;
                seleccionarTodo(modelo, false);
                seleccionar(modelo, boton.dataset.cloudbedsActualizar, true);
                actualizarDOM(contenedor, modelo);
                await abrirConfirmacion(contenedor, modelo, cliente);
                return;
            }
            if (boton.matches("[data-cloudbeds-seleccionar]")) {
                if (modelo.actualizaciones_bloqueadas) return;
                const item = buscarItem(modelo, boton.dataset.cloudbedsSeleccionar);
                seleccionar(modelo, boton.dataset.cloudbedsSeleccionar, !item?.seleccionado);
                actualizarDOM(contenedor, modelo);
                return;
            }
            if (boton.matches("[data-cloudbeds-seleccionar-todo]")) {
                if (modelo.actualizaciones_bloqueadas) return;
                const listas = modelo.items.filter(item => item.seleccionable);
                seleccionarTodo(modelo, !listas.length || listas.some(item => !item.seleccionado));
                actualizarDOM(contenedor, modelo);
                return;
            }
            if (boton.matches("[data-cloudbeds-abrir-confirmacion]")) {
                await abrirConfirmacion(contenedor, modelo, cliente);
                return;
            }
            if (boton.matches("[data-cloudbeds-cancelar]")) {
                contenedor.querySelector("[data-cloudbeds-confirmacion]").hidden = true;
                return;
            }
            if (boton.matches("[data-cloudbeds-confirmar]")) {
                evento.preventDefault();
                ejecutando = true;
                const controles = [...contenedor.querySelectorAll("button")]
                    .map(elemento => [elemento, elemento.disabled]);
                controles.forEach(([elemento]) => { elemento.disabled = true; });
                const estado = contenedor.querySelector("[data-cloudbeds-estado]");
                estado.textContent = "Revalidando Proyecto H…";
                try {
                    const resultado = await ejecutarActualizacion(modelo, cliente);
                    if (!resultado.ok) {
                        modelo.diagnostico_writer = resultado.diagnostico || Object.freeze({
                            etapa: "writer",
                            codigo: resultado.codigo,
                            mensaje: resultado.mensaje
                        });
                        actualizarDiagnosticoDOM(contenedor, modelo);
                        estado.textContent = resultado.mensaje;
                        return;
                    }
                    modelo = resultado.reconsulta?.modelo || modelo;
                    if (resultado.estado_final_confirmado && resultado.confirmacion_post_write) {
                        modelo.resultado_post_write = Object.freeze({
                            tipo: "exito",
                            actualizaciones: resultado.confirmacion_post_write.actualizaciones
                        });
                        modelo.actualizaciones_bloqueadas = false;
                    } else {
                        modelo.items.forEach(item => {
                            item.seleccionado = false;
                            item.preview = null;
                        });
                        modelo.resultado_post_write = Object.freeze({ tipo: "advertencia", mensaje: resultado.mensaje });
                        modelo.actualizaciones_bloqueadas = true;
                    }
                    contenedor.innerHTML = renderizar(modelo);
                    contenedor.querySelector("[data-cloudbeds-post-write]")?.scrollIntoView?.({ block: "nearest" });
                } catch (error) {
                    const mapeado = mapearErrorWriter(error);
                    modelo.diagnostico_writer = crearDiagnosticoWriter("writer", error);
                    actualizarDiagnosticoDOM(contenedor, modelo);
                    estado.textContent = mapeado.mensaje;
                } finally {
                    ejecutando = false;
                    controles.forEach(([elemento, estabaDeshabilitado]) => {
                        if (elemento.isConnected) elemento.disabled = estabaDeshabilitado;
                    });
                }
            }
        });
        return modelo;
    }

    const api = Object.freeze({
        CLOUDBEDS_TARIFAS_WRITER_HABILITADO,
        RPC_CAPACIDAD,
        RPC_PREVIEW,
        RPC_WRITER,
        VERSION_PREVIEW,
        VERSION_VIGENTE,
        VERSION_V31,
        VERSION_V32,
        VERSIONES_COMPATIBLES,
        CERTEZAS,
        CATEGORIAS,
        consultarCapacidad,
        propuestaTieneServicios,
        prepararModelo,
        preparar,
        capacidadCorreccionFullDay,
        consultarPreparacionFullDay,
        seleccionar,
        seleccionarTodo,
        solicitudesPreview,
        aplicarPreview,
        previsualizarSeleccion,
        construirPayload,
        confirmarSimulacion,
        mapearErrorWriter,
        sanitizarDetalleWriter,
        crearDiagnosticoWriter,
        ejecutarActualizacion,
        reconsultarDespuesDeEscritura,
        construirResultadoPostWrite,
        abrirReserva,
        renderResultadoPostWrite,
        renderizar,
        montar
    });
    root.CLOUDBEDS_TARIFAS_WRITER_HABILITADO = CLOUDBEDS_TARIFAS_WRITER_HABILITADO;
    root.HAIKU_CLOUDBEDS_TARIFAS_V1 = api;
    if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
