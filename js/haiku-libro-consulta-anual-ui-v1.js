(function (root) {
    "use strict";

    const DOC = root.document;
    if (!DOC) return;

    const STYLE_ID = "haiku-libro-consulta-anual-ui-v1-style";

    function asegurarEstilos() {
        if (DOC.getElementById(STYLE_ID)) return;
        const style = DOC.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            .haiku-asistente-mensaje.haiku-anual-compacto {
                flex: 0 0 auto !important;
                height: auto !important;
                max-height: none !important;
                padding: 10px 12px !important;
                overflow: visible !important;
            }
            .haiku-anual-cabecera {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 10px;
                padding-bottom: 7px;
                border-bottom: 1px solid #e5ebe7;
            }
            .haiku-anual-cabecera strong {
                display: block;
                color: #174f38;
                font-size: .76rem;
                letter-spacing: .03em;
            }
            .haiku-anual-cabecera span {
                color: #647069;
                font-size: .65rem;
                white-space: nowrap;
            }
            .haiku-anual-resumen {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin: 7px 0;
            }
            .haiku-anual-chip {
                padding: 3px 7px;
                border: 1px solid #dfe8e2;
                border-radius: 999px;
                background: #f7faf8;
                color: #44524a;
                font-size: .62rem;
                line-height: 1.2;
            }
            .haiku-anual-resultados {
                max-height: 235px;
                overflow-y: auto;
                overscroll-behavior: contain;
                padding-right: 3px;
            }
            .haiku-anual-persona {
                margin-top: 7px;
                border: 1px solid #e2e9e4;
                border-radius: 8px;
                overflow: hidden;
                background: #fff;
            }
            .haiku-anual-persona-cabecera {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 6px 8px;
                background: #f5f8f6;
                color: #263b30;
                font-size: .67rem;
            }
            .haiku-anual-persona-cabecera strong {
                font-size: .69rem;
            }
            .haiku-anual-contador {
                min-width: 20px;
                padding: 2px 6px;
                border-radius: 999px;
                background: #e4f1e9;
                color: #215c40;
                text-align: center;
                font-size: .58rem;
                font-weight: 800;
            }
            .haiku-anual-tabla-wrap {
                overflow-x: auto;
            }
            .haiku-anual-tabla {
                width: 100%;
                min-width: 330px;
                border-collapse: collapse;
                table-layout: fixed;
                font-size: .61rem;
            }
            .haiku-anual-tabla th,
            .haiku-anual-tabla td {
                padding: 5px 7px;
                border-top: 1px solid #edf1ee;
                text-align: left;
                white-space: nowrap;
            }
            .haiku-anual-tabla th {
                color: #68756e;
                font-size: .54rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .04em;
            }
            .haiku-anual-tabla th:first-child,
            .haiku-anual-tabla td:first-child {
                width: 38px;
                text-align: center;
            }
            .haiku-anual-tabla th:last-child,
            .haiku-anual-tabla td:last-child {
                width: 58px;
                text-align: right;
            }
            .haiku-anual-vacio {
                margin: 0;
                padding: 7px 8px;
                color: #7a847e;
                font-size: .61rem;
            }
            .haiku-anual-pie {
                margin: 7px 0 0;
                color: #76817b;
                font-size: .56rem;
            }
            @media (max-width: 700px) {
                .haiku-anual-resultados { max-height: 210px; }
                .haiku-anual-cabecera { align-items: flex-start; flex-direction: column; gap: 2px; }
            }
        `;
        DOC.head.append(style);
    }

    function elemento(tag, clase, texto) {
        const el = DOC.createElement(tag);
        if (clase) el.className = clase;
        if (texto !== undefined && texto !== null) el.textContent = String(texto);
        return el;
    }

    function parsear(texto) {
        const lineas = String(texto || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        if (!lineas[0]?.startsWith("LIBRO · CONSULTA ANUAL ·")) return null;

        const rango = lineas[0].replace("LIBRO · CONSULTA ANUAL ·", "").trim();
        const titularesLinea = lineas.find(x => x.startsWith("Titulares buscados:")) || "";
        const titulares = titularesLinea.replace(/^Titulares buscados:\s*/i, "").replace(/\.$/, "").split(" · ").filter(Boolean);
        const resumen = lineas.find(x => /^Revisé\s+/i.test(x)) || "";
        const hojas = Number(resumen.match(/Revisé\s+(\d+)\s+hoja/i)?.[1] || 0);
        const total = Number(resumen.match(/encontré\s+(\d+)\s+reserva/i)?.[1] || 0);
        const personas = [];

        for (let i = 0; i < lineas.length; i++) {
            const m = lineas[i].match(/^(.+?)\s+·\s+(\d+)\s+reservas?$/i);
            if (!m) continue;
            const persona = { nombre: m[1].trim(), cantidad: Number(m[2]), reservas: [] };
            for (let j = i + 1; j < lineas.length; j++) {
                if (/^.+?\s+·\s+\d+\s+reservas?$/i.test(lineas[j])) break;
                const r = lineas[j].match(/^•\s*CAB\s+(\d+)\s+·\s+.+?\s+·\s+(\d{4}-\d{2}-\d{2})\s+→\s+(\d{4}-\d{2}-\d{2})\s+·\s+(.+)$/i);
                if (r) persona.reservas.push({ cab: r[1], ingreso: r[2], salida: r[3], tipo: r[4] });
            }
            personas.push(persona);
        }

        return { rango, titulares, hojas, total, personas };
    }

    function fechaBreve(fecha) {
        const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : fecha;
    }

    function renderizar(out, data) {
        asegurarEstilos();
        out.dataset.haikuAnualCompacto = "1";
        out.classList.add("haiku-anual-compacto");
        out.replaceChildren();

        const cabecera = elemento("div", "haiku-anual-cabecera");
        cabecera.append(
            elemento("strong", "", "LIBRO · CONSULTA ANUAL"),
            elemento("span", "", data.rango)
        );
        out.append(cabecera);

        const resumen = elemento("div", "haiku-anual-resumen");
        resumen.append(
            elemento("span", "haiku-anual-chip", `${data.titulares.length} titular${data.titulares.length === 1 ? "" : "es"}`),
            elemento("span", "haiku-anual-chip", `${data.hojas} hojas revisadas`),
            elemento("span", "haiku-anual-chip", `${data.total} reserva${data.total === 1 ? "" : "s"}`)
        );
        out.append(resumen);

        const resultados = elemento("div", "haiku-anual-resultados");
        for (const persona of data.personas) {
            const bloque = elemento("section", "haiku-anual-persona");
            const titulo = elemento("div", "haiku-anual-persona-cabecera");
            titulo.append(
                elemento("strong", "", persona.nombre),
                elemento("span", "haiku-anual-contador", persona.cantidad)
            );
            bloque.append(titulo);

            if (!persona.reservas.length) {
                bloque.append(elemento("p", "haiku-anual-vacio", "No encontré reservas con este titular en el año indicado."));
            } else {
                const wrap = elemento("div", "haiku-anual-tabla-wrap");
                const tabla = elemento("table", "haiku-anual-tabla");
                const thead = DOC.createElement("thead");
                const trh = DOC.createElement("tr");
                ["CAB", "Ingreso", "Salida", "Estadía"].forEach(t => trh.append(elemento("th", "", t)));
                thead.append(trh);
                const tbody = DOC.createElement("tbody");
                for (const r of persona.reservas) {
                    const tr = DOC.createElement("tr");
                    tr.append(
                        elemento("td", "", r.cab),
                        elemento("td", "", fechaBreve(r.ingreso)),
                        elemento("td", "", fechaBreve(r.salida)),
                        elemento("td", "", r.tipo.replace(/\s+noches?$/i, "N"))
                    );
                    tbody.append(tr);
                }
                tabla.append(thead, tbody);
                wrap.append(tabla);
                bloque.append(wrap);
            }
            resultados.append(bloque);
        }
        out.append(resultados);
        out.append(elemento("p", "haiku-anual-pie", "Sólo lectura · no se modificó el Libro ni Proyecto H."));
    }

    function procesar(el) {
        if (!(el instanceof root.HTMLElement)) return;
        const candidatos = el.matches?.(".haiku-asistente-mensaje--asistente") ? [el] : [...el.querySelectorAll?.(".haiku-asistente-mensaje--asistente") || []];
        for (const out of candidatos) {
            if (out.dataset.haikuAnualCompacto === "1") continue;
            const data = parsear(out.textContent);
            if (data) renderizar(out, data);
        }
    }

    function iniciar() {
        asegurarEstilos();
        procesar(DOC.body);
        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === "characterData") procesar(m.target.parentElement);
                else {
                    procesar(m.target);
                    m.addedNodes.forEach(n => n.nodeType === 1 && procesar(n));
                }
            }
        });
        observer.observe(DOC.body, { subtree: true, childList: true, characterData: true });
    }

    if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", iniciar, { once: true });
    else iniciar();
})(typeof window !== "undefined" ? window : globalThis);
