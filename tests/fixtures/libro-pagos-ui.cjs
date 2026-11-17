function abrirDetallesDePago(contenedor) {
    for (const pago of contenedor.querySelectorAll('.haku-pago-revisar')) {
        if (pago.open) continue;
        pago.open = true;
        pago.events.toggle();
    }
}

module.exports = { abrirDetallesDePago };
