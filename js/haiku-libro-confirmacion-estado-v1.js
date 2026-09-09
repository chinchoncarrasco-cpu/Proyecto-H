// ========================================
// HAKU · LIBRO · ESTADO DE CONFIRMACIÓN V1
// Hace visible junto al botón final el progreso/error de la revalidación.
// No modifica la selección, el matching ni escribe en Proyecto H.
// ========================================
(function (root) {
    "use strict";
    if (!root.document || root.HAIKU_LIBRO_CONFIRMACION_ESTADO_V1) return;

    function asegurarEstilo() {
        if (document.getElementById("haiku-confirmacion-estado-v1-css")) return;
        const style = document.createElement("style");
        style.id = "haiku-confirmacion-estado-v1-css";
        style.textContent = `
            .haiku-confirmacion-estado-v1 {
                margin: 8px 0 0;
                padding: 8px 10px;
                border: 1px solid #d8e4dc;
                border-radius: 9px;
                background: #f6faf7;
                color: #395247;
                font-size: .68rem;
                line-height: 1.4;
            }
            .haiku-confirmacion-estado-v1--error {
                border-color: #e9c6bd;
                background: #fff6f3;
                color: #8a3e2e;
            }
            .haiku-confirmacion-estado-v1--proceso {
                border-color: #cfe0d5;
                background: #f1f8f3;
                color: #28583d;
            }
        `;
        document.head.appendChild(style);
    }

    function obtenerEstado(card, acciones) {
        let estado = card.querySelector(":scope > .haiku-confirmacion-estado-v1");
        if (!estado) {
            estado = document.createElement("p");
            estado.className = "haiku-confirmacion-estado-v1";
            acciones.insertAdjacentElement("afterend", estado);
        }
        return estado;
    }

    function vigilar(card, boton, acciones) {
        const aviso = card.querySelector(":scope > .haiku-incorporacion-aviso");
        if (!aviso) return;
        const estado = obtenerEstado(card, acciones);
        estado.className = "haiku-confirmacion-estado-v1 haiku-confirmacion-estado-v1--proceso";
        estado.textContent = "Esperando la confirmación final…";

        let terminado = false;
        const actualizar = () => {
            if (terminado || !card.isConnected) return;
            const texto = String(aviso.textContent || "").trim();
            if (/^No se pudo confirmar:/i.test(texto)) {
                terminado = true;
                estado.className = "haiku-confirmacion-estado-v1 haiku-confirmacion-estado-v1--error";
                estado.textContent = texto;
                if (boton?.isConnected) boton.textContent = "Reintentar confirmación";
                estado.scrollIntoView({ block: "nearest", behavior: "smooth" });
                observador.disconnect();
                return;
            }
            if (/Comprobando cambios recientes|revalidando|guardando/i.test(texto) || /Revalidando y guardando/i.test(boton?.textContent || "")) {
                estado.className = "haiku-confirmacion-estado-v1 haiku-confirmacion-estado-v1--proceso";
                estado.textContent = "Haku está revalidando los datos contra Proyecto H antes de guardar…";
            }
            if (/Incorporación completada/i.test(card.textContent || "")) {
                terminado = true;
                observador.disconnect();
            }
        };

        const observador = new MutationObserver(actualizar);
        observador.observe(aviso, { childList: true, subtree: true, characterData: true });

        requestAnimationFrame(actualizar);
        setTimeout(() => {
            if (terminado || !estado.isConnected) return;
            if (/revalidando|guardando/i.test(String(boton?.textContent || "")) || /Comprobando cambios/i.test(String(aviso.textContent || ""))) {
                estado.textContent = "La revalidación sigue en curso. No vuelvas a pulsar el botón; Haku terminará o mostrará aquí el motivo si no puede continuar.";
            }
        }, 5000);
        setTimeout(() => observador.disconnect(), 120000);
    }

    asegurarEstilo();
    document.addEventListener("click", event => {
        const boton = event.target?.closest?.(".haiku-incorporacion-acciones > button.libro-reserva-boton:not(.secundario)");
        if (!boton || boton.disabled) return;
        const card = boton.closest(".haiku-asistente-preview.haiku-incorporacion");
        const acciones = boton.closest(".haiku-incorporacion-acciones");
        if (!card || !acciones || /Incorporación completada/i.test(card.textContent || "")) return;
        vigilar(card, boton, acciones);
    }, true);

    root.HAIKU_LIBRO_CONFIRMACION_ESTADO_V1 = Object.freeze({ version: "1.0.0" });
})(typeof window !== "undefined" ? window : globalThis);
