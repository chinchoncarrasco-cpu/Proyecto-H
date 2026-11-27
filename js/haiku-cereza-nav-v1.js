(() => {
    "use strict";

    const navegacion = document.querySelector(".haiku-cereza-navegacion");
    if (!navegacion) return;

    document.addEventListener("click", evento => {
        const grupo = navegacion.querySelector(".haiku-cereza-grupo[open]");
        if (!grupo) return;
        const interno = grupo.contains(evento.target);
        if (interno && !evento.target.closest(".menu-item[data-seccion]")) return;
        const devolverFoco = interno && grupo.contains(document.activeElement);
        grupo.open = false;
        if (devolverFoco) grupo.querySelector("summary").focus({ preventScroll: true });
    }, true);

    navegacion.addEventListener("keydown", evento => {
        const grupo = evento.target.closest(".haiku-cereza-grupo[open]");
        if (evento.key !== "Escape" || !grupo) return;
        evento.preventDefault();
        evento.stopPropagation();
        grupo.open = false;
        grupo.querySelector("summary").focus({ preventScroll: true });
    });

    document.querySelector(".haiku-cereza-marca")?.addEventListener("click", evento => {
        evento.preventDefault();
        navegacion.querySelector('[data-seccion="resumen"]').click();
    });
})();
