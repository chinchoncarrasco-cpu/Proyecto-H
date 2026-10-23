/* Preferencia visual local. Se ejecuta en head antes del primer contenido. */
(function () {
    "use strict";
    if (window.HAIKU_TEMA_V1) return;
    const clave = "haikuTemaV1";
    const raiz = document.documentElement;
    let tema = "claro";
    const normalizar = valor => valor === "oscuro" ? "oscuro" : "claro";
    try { tema = normalizar(localStorage.getItem(clave)); } catch (_) { /* almacenamiento restringido */ }

    function aplicar(valor) {
        tema = normalizar(valor);
        raiz.setAttribute("data-haiku-tema", tema);
        const boton = document.getElementById("haiku-tema-boton");
        if (!boton) return;
        const oscuro = tema === "oscuro";
        const destino = oscuro ? "Tema claro" : "Tema oscuro";
        boton.setAttribute("aria-label", "Cambiar a " + destino.toLowerCase());
        boton.title = "Cambiar a " + destino.toLowerCase();
        boton.querySelector("[data-tema-icono]").textContent = oscuro ? "☀" : "☾";
        boton.querySelector("[data-tema-texto]").textContent = destino;
    }
    function iniciar() {
        const boton = document.getElementById("haiku-tema-boton");
        if (!boton) return;
        aplicar(tema);
        boton.hidden = false;
        // El selector no es un clic fuera del drawer que el usuario está revisando.
        boton.addEventListener("pointerdown", evento => evento.stopPropagation());
        boton.addEventListener("click", function (evento) {
            evento.stopPropagation();
            aplicar(tema === "oscuro" ? "claro" : "oscuro");
            try { localStorage.setItem(clave, tema); } catch (_) { /* funciona durante esta visita */ }
        });
    }
    window.HAIKU_TEMA_V1 = Object.freeze({ get tema() { return tema; } });
    aplicar(tema);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    else iniciar();
    window.addEventListener("storage", function (evento) {
        if (evento.key === clave || evento.key === null) aplicar(evento.newValue);
    });
})();
