(() => {
    "use strict";

    const navegacion = document.querySelector(".haiku-cereza-navegacion");
    if (!navegacion) return;

    const grupos = [...navegacion.querySelectorAll(".haiku-cereza-grupo")];
    for (const grupo of grupos) {
        grupo.addEventListener("toggle", () => {
            if (grupo.open) grupos.filter(otro => otro !== grupo).forEach(otro => { otro.open = false; });
        });
    }

    document.addEventListener("click", evento => {
        for (const grupo of grupos) {
            if (grupo.open && (!grupo.contains(evento.target) || evento.target.closest(".menu-item[data-seccion]"))) {
                grupo.open = false;
                if (grupo.contains(document.activeElement)) grupo.querySelector("summary").focus();
            }
        }
    });

    navegacion.addEventListener("keydown", evento => {
        const grupo = evento.target.closest(".haiku-cereza-grupo[open]");
        if (evento.key !== "Escape" || !grupo) return;
        evento.preventDefault();
        evento.stopPropagation();
        grupo.open = false;
        grupo.querySelector("summary").focus();
    });

    document.querySelector(".haiku-cereza-marca")?.addEventListener("click", evento => {
        evento.preventDefault();
        navegacion.querySelector('[data-seccion="resumen"]').click();
    });
})();
