// HAKU · AUTOR VISUAL EN HISTORIAL V1
// Marca en el Historial las acciones cuyo origen de auditoría es Haku.
// No modifica datos: sólo cambia la presentación de las tarjetas ya cargadas.
(function (root) {
    "use strict";
    if (!root.document || root.HAIKU_HISTORIAL_AUTOR_V1) return;

    const seccion = document.getElementById("seccion-historial");
    if (!seccion) return;

    const style = document.createElement("style");
    style.id = "haiku-historial-autor-v1-style";
    style.textContent = `
      #seccion-historial .historial-supa-card[data-haiku-autor="1"]{
        border-color:#c9ded1;
      }
      #seccion-historial .historial-supa-card[data-haiku-autor="1"] .historial-supa-marca{
        background:#26704c;
      }
      #seccion-historial .historial-supa-chip--haku{
        background:#e8f5ec;
        color:#226443;
        border:1px solid #cce3d4;
        font-weight:850;
      }
      #seccion-historial .historial-supa-card[data-haiku-autor="1"] .historial-supa-pie span:last-child{
        color:#26704c;
        font-weight:800;
      }
    `;
    document.head.appendChild(style);

    function categoriaEvento(evento) {
        const entidad = String(evento?.entidad_tipo || "");
        const tipo = String(evento?.tipo_evento || "");
        if (["reservas", "reserva", "reserva_estadias", "estadia_noches"].includes(entidad)) return "reserva";
        if (["pagos", "pago"].includes(entidad) || tipo === "finanzas") return "pago";
        if (["servicios", "servicio"].includes(entidad)) return "servicio";
        if (entidad.includes("cierre") || entidad === "turnos" || tipo === "cierre_turno") return "cierre";
        return "sistema";
    }

    function esTecnicoOculto(evento) {
        const entidad = String(evento?.entidad_tipo || "");
        const tipo = String(evento?.tipo_evento || "");
        if (["reserva_estadias", "estadia_noches", "turnos", "cierres_turno"].includes(entidad)) {
            return ["creacion", "actualizacion", "eliminacion"].includes(tipo);
        }
        return false;
    }

    function fechaLocal(valor) {
        if (!valor) return "";
        try {
            const partes = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Santiago",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).formatToParts(new Date(valor));
            const obj = Object.fromEntries(partes.map(p => [p.type, p.value]));
            return `${obj.year}-${obj.month}-${obj.day}`;
        } catch (_) {
            return "";
        }
    }

    function textoBasico(evento) {
        let contexto = "";
        let cambios = "";
        try { contexto = JSON.stringify(evento?.datos_contexto || {}); } catch (_) {}
        try { cambios = JSON.stringify(evento?.cambios || []); } catch (_) {}
        return [
            evento?.accion,
            evento?.descripcion,
            evento?.tipo_evento,
            evento?.entidad_tipo,
            evento?.origen,
            contexto,
            cambios
        ].filter(Boolean).join(" ").toLocaleLowerCase("es-CL");
    }

    function eventosVisibles() {
        const api = root.HistorialSupabase;
        if (!api?.eventos) return null;
        const eventos = api.eventos();
        const modo = seccion.querySelector('[data-historial-modo].activo')?.dataset.historialModo || "historial";
        const buscar = String(seccion.querySelector("[data-historial-buscar]")?.value || "").trim().toLocaleLowerCase("es-CL");
        const desde = seccion.querySelector("[data-historial-desde]")?.value || "";
        const hasta = seccion.querySelector("[data-historial-hasta]")?.value || "";
        const tipo = seccion.querySelector("[data-historial-tipo]")?.value || "";

        return eventos.filter(evento => {
            if (modo === "historial" && esTecnicoOculto(evento)) return false;
            const fecha = fechaLocal(evento?.creado_en);
            if (desde && fecha && fecha < desde) return false;
            if (hasta && fecha && fecha > hasta) return false;
            if (tipo && categoriaEvento(evento) !== tipo) return false;
            if (buscar && !textoBasico(evento).includes(buscar)) return false;
            return true;
        });
    }

    function marcarCard(card, evento) {
        const esHaku = String(evento?.origen || "").toLowerCase() === "haku"
            || String(evento?.datos_contexto?.ejecutor || "").toLowerCase() === "haku";
        if (!esHaku) return;

        card.dataset.haikuAutor = "1";
        card.title = "Cambio ejecutado por Haku. El usuario autenticado autorizó la operación.";

        const pie = card.querySelector(".historial-supa-pie");
        const autor = pie?.querySelector("span:last-child");
        if (autor) autor.textContent = "Haku";

        const accion = card.querySelector(".historial-supa-accion");
        if (accion && !accion.querySelector(".historial-supa-chip--haku")) {
            const chip = document.createElement("em");
            chip.className = "historial-supa-chip historial-supa-chip--haku";
            chip.textContent = "Haku";
            accion.appendChild(chip);
        }
    }

    let programado = false;
    function aplicar() {
        programado = false;
        const lista = seccion.querySelector("[data-historial-lista]");
        if (!lista) return;
        const cards = [...lista.querySelectorAll(":scope > .historial-supa-card")];
        if (!cards.length) return;

        const visibles = eventosVisibles();
        if (!Array.isArray(visibles)) return;

        // Si una búsqueda por texto usa datos enriquecidos que este complemento no
        // puede reconstruir, evitamos asociar tarjetas por índice para no etiquetar
        // una acción equivocada. Los resultados normales, por fecha y por tipo sí
        // mantienen correspondencia exacta.
        if (visibles.length !== cards.length) {
            cards.forEach(card => {
                const titulo = card.querySelector(".historial-supa-accion strong")?.textContent || "";
                if (/^Haku\b/i.test(titulo)) {
                    card.dataset.haikuAutor = "1";
                    const pie = card.querySelector(".historial-supa-pie span:last-child");
                    if (pie) pie.textContent = "Haku";
                }
            });
            return;
        }

        cards.forEach((card, i) => marcarCard(card, visibles[i]));
    }

    function programar() {
        if (programado) return;
        programado = true;
        requestAnimationFrame(aplicar);
    }

    const observer = new MutationObserver(mutations => {
        if (mutations.some(m => m.type === "childList")) programar();
    });
    observer.observe(seccion, { childList: true, subtree: true });

    ["input", "change", "click"].forEach(tipo => {
        seccion.addEventListener(tipo, event => {
            if (event.target?.matches?.(
                "[data-historial-buscar],[data-historial-desde],[data-historial-hasta],[data-historial-tipo],[data-historial-modo],[data-historial-refresh],[data-historial-mas]"
            )) setTimeout(programar, 0);
        }, true);
    });

    root.addEventListener("haiku:auth-ready", () => setTimeout(programar, 350));
    setTimeout(programar, 900);

    root.HAIKU_HISTORIAL_AUTOR_V1 = Object.freeze({ version: "1.0.0", aplicar: programar });
})(typeof window !== "undefined" ? window : globalThis);
