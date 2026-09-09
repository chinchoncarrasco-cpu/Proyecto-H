// ========================================
// HAKU · PAGOS FOCALIZADOS V1
// Cuando el operador pide revisar pagos de una o varias reservas concretas,
// limita la lectura del Libro a esos objetivos y a la fecha indicada.
// Esta capa NO escribe por sí sola: reutiliza la reconciliación segura
// existente y, en la preparación, deja seleccionables sólo pagos nuevos.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_LIBRO_PAGOS_FOCALIZADOS_V1) return;

    const estado = {
        scope: null,
        esperandoSalida: false
    };

    const meses = {
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
        julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
        octubre: 10, noviembre: 11, diciembre: 12
    };

    function normalizar(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function iso(y, m, d) {
        const year = Number(y), month = Number(m), day = Number(d);
        const fecha = new Date(Date.UTC(year, month - 1, day));
        if (fecha.getUTCFullYear() !== year || fecha.getUTCMonth() !== month - 1 || fecha.getUTCDate() !== day) return null;
        return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    function fechaDesdeTexto(texto) {
        const raw = String(texto || "");
        const numerica = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
        if (numerica) {
            const year = Number(numerica[3]) < 100 ? 2000 + Number(numerica[3]) : Number(numerica[3]);
            return iso(year, Number(numerica[2]), Number(numerica[1]));
        }

        const t = normalizar(raw);
        const m = t.match(/\b(?:(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(20\d{2}))?\b/);
        if (!m) return null;
        const year = Number(m[3] || new Date().getFullYear());
        return iso(year, meses[m[2]], Number(m[1]));
    }

    function limpiarNombre(valor) {
        return String(valor || "")
            .replace(/^[\s·•*\-–—:;,.]+/, "")
            .replace(/[\s·•*\-–—:;,.]+$/, "")
            .trim();
    }

    function pareceNombre(valor) {
        const n = normalizar(valor);
        if (!n || n.length < 3) return false;
        if (/^(pago|pagos|agrega|agregar|revisa|revisar|pendiente|pendientes|libro|proyecto|fecha|viernes|jueves|miercoles|martes|lunes|sabado|domingo)\b/.test(n)) return false;
        return /[a-z]/.test(n);
    }

    function objetivosDesdeTexto(texto) {
        const lineas = String(texto || "").split(/\r?\n/);
        const objetivos = [];

        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i];
            const m = linea.match(/\bCAB(?:AÑA)?\s*(\d{1,2})\b/i);
            if (!m) continue;

            const cabana = Number(m[1]);
            let nombre = limpiarNombre(linea.slice((m.index || 0) + m[0].length));

            if (!pareceNombre(nombre)) {
                for (let j = i + 1; j < lineas.length; j++) {
                    if (/\bCAB(?:AÑA)?\s*\d{1,2}\b/i.test(lineas[j])) break;
                    const candidato = limpiarNombre(lineas[j]);
                    if (pareceNombre(candidato)) {
                        nombre = candidato;
                        break;
                    }
                }
            }

            if (!pareceNombre(nombre)) continue;
            const clave = `${cabana}|${normalizar(nombre)}`;
            if (!objetivos.some(x => x.clave === clave)) objetivos.push({ cabana, nombre, clave });
        }

        return objetivos;
    }

    function objetivoIndividualDesdeTexto(texto) {
        const raw = String(texto || "").replace(/\s+/g, " ").trim();
        const nombresDias = "(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)";
        const nombresMeses = "(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";
        const fechaEscrita = `\\s+(?:(?:el|del)\\s+)?(?:${nombresDias}\\s+)?\\d{1,2}\\s+de\\s+${nombresMeses}\\b`;
        const patron = new RegExp(`\\bpagos?\\s+(?:asociad[oa]s?\\s+)?(?:a|de)\\s+(.+?)(?=${fechaEscrita}|\\s+para\\b|[.;,]|$)`, "i");
        const encontrado = raw.match(patron);
        if (!encontrado) return null;

        const cabana = Number(raw.match(/\bCAB(?:AÑA)?\s*(\d{1,2})\b/i)?.[1]) || null;
        const nombre = limpiarNombre(encontrado[1].replace(/\bCAB(?:AÑA)?\s*\d{1,2}\b/gi, ""));
        if (!pareceNombre(nombre)) return null;
        return { cabana, nombre, clave: `${cabana || "*"}|${normalizar(nombre)}` };
    }

    function nombreCoincide(a, b) {
        const na = normalizar(a), nb = normalizar(b);
        if (!na || !nb) return false;
        if (na === nb || na.includes(nb) || nb.includes(na)) return true;
        const ta = new Set(na.split(" ").filter(x => x.length > 1));
        const tb = nb.split(" ").filter(x => x.length > 1);
        return tb.length >= 2 && tb.every(x => ta.has(x));
    }

    function fechaCanon(valor) {
        const s = String(valor || "").trim();
        const isoMatch = s.match(/^(20\d{2})-(\d{2})-(\d{2})/);
        if (isoMatch) return iso(isoMatch[1], isoMatch[2], isoMatch[3]);
        const local = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/);
        if (!local) return null;
        const year = Number(local[3]) < 100 ? 2000 + Number(local[3]) : Number(local[3]);
        return iso(year, local[2], local[1]);
    }

    function pagoDeFecha(pago, fecha) {
        if (!fecha) return true;
        return [pago?.fecha_comprobante, pago?.fecha_pago, pago?.fecha_bloque]
            .map(fechaCanon)
            .some(x => x === fecha);
    }

    function conservarMovimientosRelacionados(scope) {
        // En una consulta individual sin CAB, la fecha identifica la reserva,
        // no necesariamente la fecha de cada abono. Se conservan todos sus
        // movimientos para que las tarjetas asociadas no pierdan información.
        return scope?.objetivos?.length === 1 && !scope.objetivos[0]?.cabana;
    }

    function detectarScope(texto) {
        const t = normalizar(texto);
        if (!/\bpagos?\b/.test(t) || (!/\blibro\b/.test(t) &&
            !(/\bhaku\b/.test(t) && /\brevisa(?:r)?\b/.test(t)))) return null;
        const objetivosListado = objetivosDesdeTexto(texto);
        const objetivoIndividual = objetivoIndividualDesdeTexto(texto);
        const objetivos = objetivosListado.length >= 2 ? objetivosListado :
            objetivoIndividual ? [objetivoIndividual] : objetivosListado;
        const fecha = fechaDesdeTexto(texto);
        if (!objetivos.length || !fecha) return null;
        return {
            token: `pagos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            texto: String(texto || ""),
            fecha,
            objetivos,
            cabanaFiltroOriginal: objetivos[0].cabana,
            creado: Date.now()
        };
    }

    function reservaObjetivo(reserva, scope) {
        const cab = Number(reserva?.cabana || reserva?.cabanas?.[0]);
        return scope.objetivos.some(obj => (!obj.cabana || Number(obj.cabana) === cab) && nombreCoincide(reserva?.titular, obj.nombre));
    }

    function sanitizarReserva(reserva, scope) {
        const todosPagos = Array.isArray(reserva?.pagos) ? reserva.pagos : [];
        const todosPagosSin = Array.isArray(reserva?.pagos_sin_asociacion) ? reserva.pagos_sin_asociacion : [];
        const conservarTodos = conservarMovimientosRelacionados(scope);
        const pagos = conservarTodos ? todosPagos : todosPagos.filter(p => pagoDeFecha(p, scope.fecha));
        const pagosSin = conservarTodos ? todosPagosSin : todosPagosSin.filter(p => pagoDeFecha(p, scope.fecha));
        const cab = Number(reserva?.cabana || reserva?.cabanas?.[0]);
        const bypass = Number(scope.cabanaFiltroOriginal);

        return {
            ...reserva,
            // El parser general detecta el primer CAB escrito en la pregunta.
            // Esta lista permite que también pasen los demás CAB explícitamente
            // solicitados, sin alterar la cabaña real usada para el matching.
            cabanas: [...new Set([...(Array.isArray(reserva?.cabanas) ? reserva.cabanas : []), cab, bypass].filter(Boolean))],

            // Modo focalizado = pagos. Se omiten datos que podrían generar una
            // propuesta de modificación de la reserva o de servicios.
            rut_documento: null,
            correo: null,
            telefono: null,
            adultos: null,
            ninos: null,
            mascotas: null,
            estado_confirmacion: "no_determinado",
            estado_operativo: "no_determinado",
            tipo_estadia: null,
            notas_importantes: [],
            pagos_pendientes: [],
            servicios: [],
            texto_original: "",
            operador: null,
            fecha_ingreso_libro: null,

            pagos,
            pagos_sin_asociacion: pagosSin
        };
    }

    function instalarProxyLibro() {
        const original = window.HAIKU_LIBRO_RESERVA_V1;
        if (!original || original.__pagosFocalizadosProxy) return Boolean(original);

        const consultarOriginal = original.consultarHoja;
        if (typeof consultarOriginal !== "function") return false;

        const proxy = {
            ...original,
            __pagosFocalizadosProxy: true,
            consultarHoja: async (...args) => {
                const data = await consultarOriginal(...args);
                const scope = estado.scope;
                if (!scope || args[1] === "anterior" || !Array.isArray(data?.reservas)) return data;

                return {
                    ...data,
                    reservas: data.reservas
                        .filter(r => reservaObjetivo(r, scope))
                        .map(r => sanitizarReserva(r, scope))
                };
            }
        };

        window.HAIKU_LIBRO_RESERVA_V1 = Object.freeze(proxy);
        return true;
    }

    function esDisparoHaku(evento) {
        if (evento.type === "click") return Boolean(evento.target?.closest?.("#haiku-asistente-enviar"));
        return evento.type === "keydown" && evento.target?.id === "haiku-asistente-texto" &&
            (evento.ctrlKey || evento.metaKey) && evento.key === "Enter";
    }

    function prepararScopeAntesDeHaku(evento) {
        if (!esDisparoHaku(evento)) return;
        const campo = document.getElementById("haiku-asistente-texto");
        const texto = campo?.value?.trim() || "";
        const scope = detectarScope(texto);
        estado.scope = scope;
        estado.esperandoSalida = Boolean(scope);
        if (scope) {
            // Esta petición explícita de revisión de pagos usa el lector del Libro,
            // también cuando el operador omite la palabra «Libro».
            if (!/\blibro\b/i.test(texto)) campo.value = 'Libro: ' + texto;
            instalarProxyLibro();
            console.info("HAKU · Pagos focalizados:", scope.fecha,
                scope.objetivos.map(x => [x.cabana ? `CAB ${x.cabana}` : null, x.nombre].filter(Boolean).join(" ")));
        }
    }

    function etiquetaFecha(fecha) {
        const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : fecha;
    }

    function crearAvisoScope(scope) {
        const aviso = document.createElement("div");
        aviso.className = "haku-pagos-focalizados-aviso";
        const lista = scope.objetivos.map(x => [x.cabana ? `CAB ${x.cabana}` : null, x.nombre].filter(Boolean).join(" · ")).join(" · ");
        const alcance = conservarMovimientosRelacionados(scope)
            ? "Haku compara únicamente esta persona y conserva los movimientos financieros relacionados con sus estadías."
            : "Haku compara únicamente estos objetivos y descarta pagos de otras fechas.";
        aviso.innerHTML = `<strong>Consulta focalizada en pagos</strong><span>${etiquetaFecha(scope.fecha)} · ${lista}</span><small>${alcance} Las reservas y servicios no forman parte de esta incorporación.</small>`;
        return aviso;
    }

    function asegurarAviso(out, scope) {
        if (out.querySelector(":scope > .haku-pagos-focalizados-aviso")) return;
        const cabecera = out.querySelector(":scope > .haiku-asistente-preview-cabecera, :scope > .haiku-incorporacion-cabecera");
        const aviso = crearAvisoScope(scope);
        if (cabecera) cabecera.after(aviso);
        else out.prepend(aviso);
    }

    function asignarTextoSiCambia(elemento, texto) {
        if (elemento && elemento.textContent !== texto) elemento.textContent = texto;
    }

    function focalizarComparacion(out, scope) {
        asegurarAviso(out, scope);
        const resumen = out.querySelector(":scope > .haiku-asistente-preview-resumen");
        const alcanceIndividual = conservarMovimientosRelacionados(scope)
            ? `Alcance solicitado: ${scope.objetivos[0].nombre} · reserva identificada por ${etiquetaFecha(scope.fecha)}. Se conservan sus movimientos financieros relacionados y las demás personas del mes quedan fuera.`
            : `Alcance solicitado: ${scope.objetivos.length} reservas objetivo · pagos del ${etiquetaFecha(scope.fecha)}. Proyecto H se usa sólo para comprobar esas reservas y evitar duplicar pagos ya registrados; las demás reservas del mes quedan fuera de esta tarea.`;
        asignarTextoSiCambia(
            resumen,
            alcanceIndividual
        );

        const tarjetas = [...out.querySelectorAll(":scope > .haiku-asistente-preview-grid > div")];
        for (const tarjeta of tarjetas) {
            const label = normalizar(tarjeta.querySelector("span")?.textContent);
            const strong = tarjeta.querySelector("strong");
            if (label === "proyecto h") asignarTextoSiCambia(strong, `${scope.objetivos.length} objetivos`);
        }

        const pie = out.querySelector(":scope > .haiku-asistente-preview-pie span");
        asignarTextoSiCambia(
            pie,
            "Modo focalizado: sólo se prepararán pagos de los objetivos indicados. Ninguna reserva, estadía ni servicio se incorporará desde esta consulta."
        );
    }

    function deseleccionarSeccion(seccion, scope) {
        if (seccion.dataset.hakuFocalBloqueada !== scope.token) {
            seccion.querySelectorAll('input[type="checkbox"]').forEach(check => {
                if (check.checked) {
                    check.checked = false;
                    check.dispatchEvent(new Event("change", { bubbles: true }));
                }
            });
            seccion.dataset.hakuFocalBloqueada = scope.token;
        }
        if (!seccion.hidden) seccion.hidden = true;
    }

    function focalizarIncorporacion(out, scope) {
        asegurarAviso(out, scope);

        asignarTextoSiCambia(out.querySelector(".haiku-incorporacion-modo"), "Sólo pagos");
        const aviso = conservarMovimientosRelacionados(scope)
            ? "Esta preparación conserva los movimientos financieros relacionados con la persona y reserva solicitadas. Los datos de reserva, estadía y servicios no se reemplazarán desde este modo."
            : "Esta preparación está limitada a pagos faltantes de las reservas y fecha solicitadas. Los datos de reserva, estadía, servicios y pagos ya existentes no se reemplazarán desde este modo.";
        asignarTextoSiCambia(
            out.querySelector(":scope > .haiku-incorporacion-aviso"),
            aviso
        );

        ["nuevas", "estadias", "actualizaciones"].forEach(categoria => {
            out.querySelectorAll(`.haiku-incorporacion-seccion--${categoria}`).forEach(seccion => deseleccionarSeccion(seccion, scope));
        });

        // Evita que el atajo general vuelva a seleccionar categorías ocultas.
        out.querySelectorAll(".haiku-incorporacion-atajo").forEach(boton => {
            if (/seleccionar todo lo listo/i.test(boton.textContent || "") && !boton.hidden) boton.hidden = true;
        });
    }

    function procesarSalida(out) {
        const scope = estado.scope;
        if (!scope || !out?.isConnected) return;
        if (out.dataset.hakuPagosFocalizados !== scope.token) return;

        if (out.classList.contains("haiku-incorporacion")) focalizarIncorporacion(out, scope);
        else if (out.classList.contains("haiku-asistente-preview")) focalizarComparacion(out, scope);
    }

    const observador = new MutationObserver(mutations => {
        const scope = estado.scope;
        if (!scope) return;

        for (const mut of mutations) {
            for (const nodo of mut.addedNodes || []) {
                if (!(nodo instanceof Element)) continue;

                if (estado.esperandoSalida && nodo.matches?.(".haiku-asistente-mensaje--asistente") && /leyendo la estructura del libro local/i.test(nodo.textContent || "")) {
                    nodo.dataset.hakuPagosFocalizados = scope.token;
                    estado.esperandoSalida = false;
                }

                if (nodo.dataset?.hakuPagosFocalizados === scope.token) procesarSalida(nodo);
            }

            const target = mut.target instanceof Element
                ? mut.target.closest?.(`[data-haku-pagos-focalizados="${scope.token}"]`)
                : mut.target?.parentElement?.closest?.(`[data-haku-pagos-focalizados="${scope.token}"]`);
            if (target) procesarSalida(target);
        }
    });

    // Al restaurar el XLSX después de F5, el visor base selecciona la primera
    // hoja visible (por ejemplo Jun20). Esta capa corrige sólo la selección
    // inicial de cada carga y abre automáticamente la hoja del mes vigente en
    // Chile si existe (Sep26 en septiembre de 2026). No interfiere con cambios
    // manuales posteriores del selector.
    let generacionMesAplicada = null;
    let timerMesActual = null;

    const nombresMesHoja = [
        ["ene", "jan", "enero", "january"],
        ["feb", "febrero", "february"],
        ["mar", "marzo", "march"],
        ["abr", "apr", "abril", "april"],
        ["may", "mayo"],
        ["jun", "junio", "june"],
        ["jul", "julio", "july"],
        ["ago", "aug", "agosto", "august"],
        ["sep", "sept", "set", "septiembre", "setiembre", "september"],
        ["oct", "octubre", "october"],
        ["nov", "noviembre", "november"],
        ["dic", "dec", "diciembre", "december"]
    ];

    function canonHoja(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
    }

    function fechaChileActual() {
        try {
            const partes = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Santiago",
                year: "numeric",
                month: "2-digit"
            }).formatToParts(new Date());
            const valor = tipo => Number(partes.find(p => p.type === tipo)?.value);
            return { year: valor("year"), month: valor("month") };
        } catch (_) {
            const ahora = new Date();
            return { year: ahora.getFullYear(), month: ahora.getMonth() + 1 };
        }
    }

    function encontrarHojaMesActual(selector) {
        const { year, month } = fechaChileActual();
        if (!year || !month) return null;
        const yy = String(year).slice(-2);
        const yyyy = String(year);
        const prefijos = nombresMesHoja[month - 1] || [];
        const opciones = [...selector.options];
        const coincide = opcion => {
            const nombre = canonHoja(opcion.value || opcion.textContent);
            return prefijos.some(prefijo => nombre === `${prefijo}${yy}` || nombre === `${prefijo}${yyyy}`);
        };
        return opciones.find(opcion => /hojas visibles/i.test(opcion.parentElement?.label || "") && coincide(opcion))
            || opciones.find(coincide)
            || null;
    }

    function intentarMesActual() {
        const api = window.HAIKU_LIBRO_RESERVA_V1;
        const selector = document.getElementById("libro-reserva-hoja");
        const info = api?.estado?.();
        if (!api || !info?.cargado || !selector || selector.disabled || !selector.options.length) return false;
        if (generacionMesAplicada === info.generacion) return true;

        const opcion = encontrarHojaMesActual(selector);
        generacionMesAplicada = info.generacion;
        if (!opcion || selector.value === opcion.value) return true;

        selector.value = opcion.value;
        selector.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }

    function programarMesActual() {
        if (timerMesActual) clearInterval(timerMesActual);
        let intentos = 0;
        timerMesActual = setInterval(() => {
            intentos += 1;
            if (intentarMesActual() || intentos >= 150) {
                clearInterval(timerMesActual);
                timerMesActual = null;
            }
        }, 100);
    }

    function iniciar() {
        // Los listeners se registran inmediatamente porque este archivo se carga
        // justo antes de haiku-libro-consultas-v1.js. Así el alcance focalizado
        // se prepara antes que el interceptor general de Haku.
        window.addEventListener("click", prepararScopeAntesDeHaku, true);
        window.addEventListener("keydown", prepararScopeAntesDeHaku, true);
        observador.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

        instalarProxyLibro();
        // El API del Libro se crea en DOMContentLoaded. Si aún no existe, este
        // segundo intento lo envuelve después de que supabase-libro-reserva-v1
        // haya terminado su propia inicialización.
        if (!window.HAIKU_LIBRO_RESERVA_V1) {
            document.addEventListener("DOMContentLoaded", instalarProxyLibro, { once: true });
        }

        // Cada carga/restauración del Libro incrementa su generación. La primera
        // vez que el selector queda poblado para esa generación elegimos el mes
        // actual; luego respetamos cualquier selección manual del operador.
        window.addEventListener("haiku:libro-cambio", () => {
            generacionMesAplicada = null;
            programarMesActual();
        });
        programarMesActual();

        const style = document.createElement("style");
        style.id = "haku-pagos-focalizados-v1-style";
        style.textContent = `
          .haku-pagos-focalizados-aviso{margin:10px 0;padding:10px 12px;border:1px solid #b9d9c7;border-radius:12px;background:#f3faf6;color:#234334;display:flex;flex-direction:column;gap:3px}
          .haku-pagos-focalizados-aviso strong{font-size:.73rem;letter-spacing:.06em;text-transform:uppercase;color:#1f6d49}
          .haku-pagos-focalizados-aviso span{font-size:.72rem;font-weight:800;line-height:1.4}
          .haku-pagos-focalizados-aviso small{font-size:.65rem;line-height:1.4;color:#607267}
        `;
        document.head.appendChild(style);
    }

    window.HAIKU_LIBRO_PAGOS_FOCALIZADOS_V1 = Object.freeze({
        version: "1.0.5",
        detectar: detectarScope,
        estado: () => estado.scope ? structuredClone(estado.scope) : null
    });

    iniciar();
})();
