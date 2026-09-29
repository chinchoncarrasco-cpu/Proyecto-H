/* Cloudbeds Tarifas 2E: UI Haku, selección y simulación. Nunca escribe datos. */
(function (root) {
    "use strict";

    if (root.HAIKU_CLOUDBEDS_TARIFAS_V1) return;

    const CLOUDBEDS_TARIFAS_WRITER_HABILITADO = false;
    const RPC_CAPACIDAD = "haiku_capacidad_totales_v1";
    const VERSION_VIGENTE = "total1_financiero_v31";
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
            v31_disponible: false,
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
            if (error) return capacidadNoDisponible("No fue posible comprobar la capacidad v31.", data);
            if (!data || data.version !== VERSION_VIGENTE || data.writer_disponible !== true) {
                return capacidadNoDisponible("TOTAL v31 no está disponible globalmente.", data);
            }
            return Object.freeze({
                consultada: true,
                version: data.version,
                writer_disponible: true,
                v31_disponible: true,
                motivo: "TOTAL v31 está disponible globalmente; cada reserva aún requiere revalidación final.",
                escritura_habilitada: CLOUDBEDS_TARIFAS_WRITER_HABILITADO && true
            });
        } catch {
            return capacidadNoDisponible("La comprobación global de TOTAL v31 falló.");
        }
    }

    function payloadValido(fila) {
        const propuesta = fila?.propuesta || {};
        return Boolean(
            propuesta.reserva_id &&
            Number.isSafeInteger(Number(propuesta.total_actual_haku)) &&
            Number.isSafeInteger(Number(propuesta.total_alojamiento_propuesto)) &&
            Number(propuesta.total_alojamiento_propuesto) > 0 &&
            Number(propuesta.total_actual_haku) !== Number(propuesta.total_alojamiento_propuesto)
        );
    }

    function estadoFinanciero(fila, capacidad) {
        if (fila?.certeza !== "ALTA_CERTEZA") return "NO_EVALUADA";
        if (!payloadValido(fila)) return "REQUIERE_REVISION_FINANCIERA";
        return capacidad.v31_disponible
            ? "REQUIERE_REVALIDACION_V31"
            : "CAPACIDAD_V31_NO_DISPONIBLE";
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
            const seleccionable = fila.certeza === "ALTA_CERTEZA" && payloadValido(fila);
            return {
                id,
                fila,
                certeza_cloudbeds: fila.certeza,
                compatibilidad_financiera: estadoFinanciero(fila, capacidad),
                seleccionable,
                seleccionado: false
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
            ultima_simulacion: null
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
        const item = buscarItem(modelo, id);
        if (!item || !item.seleccionable) return false;
        item.seleccionado = Boolean(seleccionado);
        modelo.ultima_simulacion = null;
        return true;
    }

    function seleccionarTodo(modelo, seleccionado = true) {
        modelo.items.forEach(item => {
            if (item.seleccionable) item.seleccionado = Boolean(seleccionado);
        });
        modelo.ultima_simulacion = null;
        return modelo.items.filter(item => item.seleccionado).length;
    }

    function construirPayload(modelo) {
        return modelo.items.filter(item => item.seleccionable && item.seleccionado).map(item => ({
            reserva_id: item.fila.propuesta.reserva_id,
            total_actual: Number(item.fila.propuesta.total_actual_haku),
            total_objetivo: Number(item.fila.propuesta.total_alojamiento_propuesto)
        }));
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
            CAPACIDAD_V31_NO_DISPONIBLE: "Capacidad v31 no disponible",
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
        if (fila?.identidad_tipo !== "CONTEXTO_EXACTO_UNICO") return "";
        return `<div class="haiku-cloudbeds-tarifas-identidad-contextual" data-cloudbeds-identidad="CONTEXTO_EXACTO_UNICO">
            <strong><span aria-hidden="true">✓</span> Reserva identificada por contexto exacto</strong>
            <span><span aria-hidden="true">○</span> Vínculo Cloudbeds aún no guardado</span>
            <small>Nombre, cabaña, check-in y check-out identifican una única reserva de Proyecto H.</small>
        </div>`;
    }

    function renderItem(item) {
        const fila = item.fila;
        const propuesta = fila.propuesta || {};
        const entrada = fila.entrada || {};
        const nombre = entrada.nombre_huesped || [entrada.nombre, entrada.apellido].filter(Boolean).join(" ") || "Reserva Cloudbeds";
        const cabana = propuesta.cabana ? `CAB ${propuesta.cabana}` : "Cabaña no identificada";
        const diferencia = propuesta.diferencia;
        const evidencias = (fila.evidencias || propuesta.evidencias || [])
            .filter(evidencia => fila.identidad_tipo !== "CONTEXTO_EXACTO_UNICO"
                || (!String(evidencia).startsWith("Reserva identificada por contexto exacto")
                    && !String(evidencia).startsWith("Proyecto H aún no tiene vínculo Cloudbeds guardado")))
            .slice(0, 8);
        const revisiones = fila.revisiones || propuesta.revisiones || [];
        const seleccion = item.seleccionable
            ? `<button type="button" class="haiku-cloudbeds-tarifas-simular-item" data-cloudbeds-seleccionar="${esc(item.id)}" aria-pressed="${item.seleccionado}">${item.seleccionado ? "Quitar de simulación" : "Simular actualización"}</button>`
            : "";
        return `<article class="haiku-cloudbeds-tarifas-tarjeta" data-cloudbeds-item="${esc(item.id)}">
            <header>
                <div><strong>${esc(nombre)} · ${esc(cabana)}</strong><span>${esc(fechaCorta(propuesta.check_in))} → ${esc(fechaCorta(propuesta.check_out))}</span></div>
                <span class="haiku-cloudbeds-tarifas-certeza haiku-cloudbeds-tarifas-certeza--${esc(fila.certeza.toLowerCase())}">${esc(fila.certeza.replaceAll("_", " "))}</span>
            </header>
            <dl class="haiku-cloudbeds-tarifas-montos">
                <div><dt>Proyecto H</dt><dd>${esc(moneda(propuesta.total_actual_haku))}</dd></div>
                <div><dt>Cloudbeds</dt><dd>${esc(moneda(propuesta.total_alojamiento_propuesto || propuesta.deposito_cloudbeds))}</dd></div>
                <div><dt>Diferencia</dt><dd class="${Number(diferencia) < 0 ? "es-negativa" : ""}">${diferencia === null || diferencia === undefined ? "No calculable" : esc(moneda(diferencia))}</dd></div>
            </dl>
            ${renderIdentidadContextual(fila)}
            ${renderProductos(propuesta)}
            ${evidencias.length ? `<div class="haiku-cloudbeds-tarifas-evidencias"><strong>Evidencias</strong><ul>${evidencias.map(evidencia => `<li>${esc(evidencia)}</li>`).join("")}</ul></div>` : ""}
            ${revisiones.length ? `<div class="haiku-cloudbeds-tarifas-revision"><strong>Revisar</strong><ul>${revisiones.map(revision => `<li>${esc(revision)}</li>`).join("")}</ul></div>` : ""}
            <div class="haiku-cloudbeds-tarifas-capas">
                <span><b>Certeza Cloudbeds</b>${esc(fila.certeza.replaceAll("_", " "))}</span>
                <span><b>Compatibilidad financiera</b>${esc(etiquetaCompatibilidad(item))}</span>
            </div>
            <footer>
                <button type="button" data-cloudbeds-ver-reserva="${esc(item.id)}" ${propuesta.reserva_id ? "" : "disabled"}>Ver reserva</button>
                ${seleccion}
                <button type="button" class="haiku-cloudbeds-tarifas-writer" disabled>Escritura aún no habilitada</button>
            </footer>
            <details class="haiku-cloudbeds-tarifas-tecnico"><summary>Detalles técnicos</summary><pre>${esc(JSON.stringify({
                identidad_tipo: fila.identidad_tipo,
                vinculo_cloudbeds_sugerido: fila.vinculo_cloudbeds_sugerido,
                certeza_cloudbeds: item.certeza_cloudbeds,
                compatibilidad_financiera: item.compatibilidad_financiera,
                propuesta
            }, null, 2))}</pre></details>
        </article>`;
    }

    function renderCategoria(modelo, certeza) {
        const items = modelo.items.filter(item => item.certeza_cloudbeds === certeza);
        return `<details class="haiku-cloudbeds-tarifas-categoria" data-cloudbeds-categoria="${certeza}" ${certeza === "ALTA_CERTEZA" && items.length ? "open" : ""}>
            <summary><span>${esc(CATEGORIAS[certeza])}</span><b>${items.length}</b></summary>
            <div>${items.length ? items.map(renderItem).join("") : "<p>No hay reservas en esta categoría.</p>"}</div>
        </details>`;
    }

    function renderizar(modelo) {
        const capacidad = modelo.capacidad;
        const seleccionados = construirPayload(modelo).length;
        return `<section class="haiku-cloudbeds-tarifas" data-cloudbeds-tarifas-2e>
            <header class="haiku-cloudbeds-tarifas-cabecera">
                <div><span>CLOUDBEDS</span><strong>Tarifas</strong><p>Propuestas de alojamiento · sólo lectura</p></div>
                <span class="haiku-cloudbeds-tarifas-seguro">Writer deshabilitado</span>
            </header>
            <div class="haiku-cloudbeds-tarifas-resumen">${CERTEZAS.map(certeza => `<span><b>${modelo.conteos[certeza]}</b>${esc(CATEGORIAS[certeza])}</span>`).join("")}</div>
            <div class="haiku-cloudbeds-tarifas-capacidad ${capacidad.v31_disponible ? "es-disponible" : "es-bloqueada"}">
                <strong>Capacidad financiera global</strong>
                <span>${esc(capacidad.version || "Sin versión")} · ${esc(capacidad.motivo)}</span>
            </div>
            <div class="haiku-cloudbeds-tarifas-lote">
                <button type="button" data-cloudbeds-seleccionar-todo>Seleccionar todo lo listo</button>
                <span data-cloudbeds-seleccion-conteo>${seleccionados} seleccionadas</span>
                <button type="button" data-cloudbeds-abrir-confirmacion ${seleccionados ? "" : "disabled"}>Simular ${seleccionados || ""} ${seleccionados === 1 ? "actualización" : "actualizaciones"}</button>
            </div>
            <div class="haiku-cloudbeds-tarifas-categorias">${CERTEZAS.map(certeza => renderCategoria(modelo, certeza)).join("")}</div>
            <section class="haiku-cloudbeds-tarifas-confirmacion" data-cloudbeds-confirmacion hidden>
                <strong>Confirmación futura</strong>
                <p data-cloudbeds-confirmacion-texto></p>
                <p>Cloudbeds será usado como fuente del nuevo total. Los pagos existentes no se eliminarán. Proyecto H recalculará saldos mediante TOTAL v31.</p>
                <div><button type="button" data-cloudbeds-cancelar>Cancelar</button><button type="button" data-cloudbeds-confirmar>Confirmar simulación</button></div>
            </section>
            <p class="haiku-cloudbeds-tarifas-estado" data-cloudbeds-estado role="status">Escritura aún no habilitada. Las acciones sólo preparan una simulación local.</p>
            <details class="haiku-cloudbeds-tarifas-payload"><summary>Payload futuro · diagnóstico</summary><pre data-cloudbeds-payload>${esc(JSON.stringify(construirPayload(modelo), null, 2))}</pre></details>
        </section>`;
    }

    function actualizarDOM(contenedor, modelo) {
        const payload = construirPayload(modelo);
        const cantidad = payload.length;
        contenedor.querySelectorAll("[data-cloudbeds-seleccionar]").forEach(boton => {
            const item = buscarItem(modelo, boton.dataset.cloudbedsSeleccionar);
            boton.setAttribute("aria-pressed", String(Boolean(item?.seleccionado)));
            boton.textContent = item?.seleccionado ? "Quitar de simulación" : "Simular actualización";
        });
        const conteo = contenedor.querySelector("[data-cloudbeds-seleccion-conteo]");
        if (conteo) conteo.textContent = `${cantidad} ${cantidad === 1 ? "seleccionada" : "seleccionadas"}`;
        const abrir = contenedor.querySelector("[data-cloudbeds-abrir-confirmacion]");
        if (abrir) {
            abrir.disabled = cantidad === 0;
            abrir.textContent = `Simular ${cantidad || ""} ${cantidad === 1 ? "actualización" : "actualizaciones"}`;
        }
        const pre = contenedor.querySelector("[data-cloudbeds-payload]");
        if (pre) pre.textContent = JSON.stringify(payload, null, 2);
        const confirmacion = contenedor.querySelector("[data-cloudbeds-confirmacion]");
        if (confirmacion && !modelo.ultima_simulacion) confirmacion.hidden = true;
    }

    function montar(contenedor, modelo) {
        if (!contenedor || typeof contenedor.addEventListener !== "function") throw new Error("Contenedor Haku inválido.");
        contenedor.innerHTML = renderizar(modelo);
        contenedor.classList?.add("haiku-asistente-mensaje--cloudbeds-tarifas");
        contenedor.addEventListener("click", evento => {
            const boton = evento.target.closest?.("button");
            if (!boton) return;
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
            if (boton.matches("[data-cloudbeds-seleccionar]")) {
                const item = buscarItem(modelo, boton.dataset.cloudbedsSeleccionar);
                seleccionar(modelo, boton.dataset.cloudbedsSeleccionar, !item?.seleccionado);
                actualizarDOM(contenedor, modelo);
                return;
            }
            if (boton.matches("[data-cloudbeds-seleccionar-todo]")) {
                const listas = modelo.items.filter(item => item.seleccionable);
                seleccionarTodo(modelo, !listas.length || listas.some(item => !item.seleccionado));
                actualizarDOM(contenedor, modelo);
                return;
            }
            if (boton.matches("[data-cloudbeds-abrir-confirmacion]")) {
                const cantidad = construirPayload(modelo).length;
                if (!cantidad) return;
                const confirmacion = contenedor.querySelector("[data-cloudbeds-confirmacion]");
                confirmacion.hidden = false;
                confirmacion.querySelector("[data-cloudbeds-confirmacion-texto]").textContent =
                    `Se actualizarían ${cantidad} ${cantidad === 1 ? "tarifa" : "tarifas"} de alojamiento.`;
                return;
            }
            if (boton.matches("[data-cloudbeds-cancelar]")) {
                contenedor.querySelector("[data-cloudbeds-confirmacion]").hidden = true;
                return;
            }
            if (boton.matches("[data-cloudbeds-confirmar]")) {
                const resultado = confirmarSimulacion(modelo);
                contenedor.querySelector("[data-cloudbeds-confirmacion]").hidden = true;
                contenedor.querySelector("[data-cloudbeds-estado]").textContent = resultado.mensaje;
                contenedor.querySelector("[data-cloudbeds-payload]").textContent = JSON.stringify(resultado.payload, null, 2);
            }
        });
        return modelo;
    }

    const api = Object.freeze({
        CLOUDBEDS_TARIFAS_WRITER_HABILITADO,
        RPC_CAPACIDAD,
        VERSION_VIGENTE,
        CERTEZAS,
        CATEGORIAS,
        consultarCapacidad,
        prepararModelo,
        preparar,
        seleccionar,
        seleccionarTodo,
        construirPayload,
        confirmarSimulacion,
        abrirReserva,
        renderizar,
        montar
    });
    root.CLOUDBEDS_TARIFAS_WRITER_HABILITADO = CLOUDBEDS_TARIFAS_WRITER_HABILITADO;
    root.HAIKU_CLOUDBEDS_TARIFAS_V1 = api;
    if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
