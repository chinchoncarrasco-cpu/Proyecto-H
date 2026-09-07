// ========================================
// RESERVAS · COPIAR TABLA V1
// Copia la vista actualmente renderizada de Reservas
// en texto tabulado, listo para pegar en Haku.
// No consulta ni modifica Supabase.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_RESERVAS_COPIAR_V1) return;

    const seccion = document.getElementById("seccion-reservas");
    const botonColumnas = document.getElementById("reservas-configurar-columnas");
    const tabla = seccion?.querySelector(".reservas-tabla");
    const chips = document.getElementById("reservas-chips");
    const contador = document.getElementById("reservas-contador");

    if (!seccion || !botonColumnas || !tabla) return;

    const style = document.createElement("style");
    style.id = "reservas-copiar-tabla-v1-style";
    style.textContent = `
        #seccion-reservas .reservas-copiar-tabla[data-estado="copiado"] {
            border-color: #9fcbb4;
            background: #eaf5ef;
            color: #13553a;
        }

        @media (min-width: 1051px) {
            #seccion-reservas .reservas-barra-superior {
                grid-template-columns: minmax(240px, 1fr) auto auto auto auto auto;
            }
        }

        @media (min-width: 769px) and (max-width: 1050px) {
            #seccion-reservas .reservas-barra-superior {
                grid-template-columns: 1fr auto auto auto;
            }

            #seccion-reservas .reservas-copiar-tabla {
                grid-column: 4;
                grid-row: 2;
            }
        }
    `;
    document.head.appendChild(style);

    function limpiarTexto(valor) {
        return String(valor ?? "")
            .replace(/[\t\r\n]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    function encabezadoVisible(th) {
        const clon = th.cloneNode(true);
        clon.querySelectorAll(".reservas-orden").forEach(nodo => nodo.remove());
        return limpiarTexto(clon.textContent);
    }

    function filtrosVisibles() {
        if (!chips || chips.hidden) return "";

        return [...chips.querySelectorAll(".reservas-chip:not(.reservas-chip--limpiar)")]
            .map(chip => {
                const clon = chip.cloneNode(true);
                clon.querySelectorAll("button").forEach(boton => boton.remove());
                return limpiarTexto(clon.textContent);
            })
            .filter(Boolean)
            .join(" · ");
    }

    function construirTexto() {
        const encabezados = [...tabla.querySelectorAll("thead th")]
            .map(encabezadoVisible)
            .filter(Boolean);

        const filas = [...tabla.querySelectorAll("tbody tr")]
            .filter(fila => fila.offsetParent !== null)
            .map(fila => [...fila.querySelectorAll("td")].map(td => limpiarTexto(td.textContent)));

        if (!encabezados.length || !filas.length) {
            throw new Error("No hay reservas visibles para copiar.");
        }

        const lineas = [];
        lineas.push("RESERVAS HAIKU · VISTA ACTUAL");

        const totalTexto = limpiarTexto(contador?.textContent);
        if (totalTexto) lineas.push(`Resultado: ${totalTexto}`);

        const filtros = filtrosVisibles();
        if (filtros) lineas.push(`Filtros: ${filtros}`);

        lineas.push("");
        lineas.push(encabezados.join("\t"));
        filas.forEach(fila => lineas.push(fila.join("\t")));

        return lineas.join("\n");
    }

    async function copiarPortapapeles(texto) {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(texto);
            return;
        }

        const area = document.createElement("textarea");
        area.value = texto;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        area.style.top = "0";
        document.body.appendChild(area);
        area.select();

        const copiado = document.execCommand("copy");
        area.remove();

        if (!copiado) throw new Error("No fue posible copiar la tabla.");
    }

    const boton = document.createElement("button");
    boton.type = "button";
    boton.id = "reservas-copiar-tabla";
    boton.className = "reservas-boton-icono reservas-copiar-tabla";
    boton.title = "Copiar las filas visibles para pegarlas directamente en Haku";
    boton.setAttribute("aria-label", "Copiar tabla de reservas");
    boton.innerHTML = "⧉ <span>Copiar tabla</span>";

    botonColumnas.insertAdjacentElement("afterend", boton);

    boton.addEventListener("click", async () => {
        const textoOriginal = boton.innerHTML;
        boton.disabled = true;

        try {
            const contenido = construirTexto();
            await copiarPortapapeles(contenido);
            boton.innerHTML = "✓ <span>Copiado</span>";
            boton.dataset.estado = "copiado";

            window.setTimeout(() => {
                boton.innerHTML = textoOriginal;
                boton.disabled = false;
                delete boton.dataset.estado;
            }, 1500);
        } catch (error) {
            console.error("RESERVAS · No fue posible copiar la tabla:", error);
            boton.innerHTML = "! <span>Sin datos</span>";

            window.setTimeout(() => {
                boton.innerHTML = textoOriginal;
                boton.disabled = false;
            }, 1500);
        }
    });

    window.HAIKU_RESERVAS_COPIAR_V1 = Object.freeze({
        construirTexto
    });

    console.info("RESERVAS · Copiar tabla V1 preparado.");
})();