// Frontera de UI para las pruebas de negocio existentes. Conserva las decisiones,
// avisos y contadores de cada fixture; la interfaz real se prueba en el navegador.
const nativeVM = require('node:vm');
function instalar(contexto = globalThis) {
    const ventana = contexto.window || contexto;
    if (!ventana.HAIKU_DIALOGOS) {
        const llamar = (nombre, args) => {
            const propietario = typeof ventana[nombre] === 'function' ? ventana : contexto;
            if (typeof propietario[nombre] !== 'function') throw Error(`Falta definir ${nombre} en el fixture`);
            return propietario[nombre](...args);
        };
        ventana.HAIKU_DIALOGOS = {
            confirmar: async (...args) => llamar('confirm', args),
            solicitar: async (...args) => llamar('prompt', args),
            aviso: (...args) => llamar('alert', args)
        };
    }
    return contexto;
}
const vm = {
    ...nativeVM,
    runInContext: (codigo, contexto, ...opciones) => nativeVM.runInContext(codigo, instalar(contexto), ...opciones),
    runInNewContext: (codigo, contexto = {}, ...opciones) => nativeVM.runInNewContext(codigo, instalar(contexto), ...opciones)
};
async function prepararNavegador(page) {
    // Sólo fixtures de negocio que ya simulaban alert/confirm. La suite de diseño
    // carga haiku-dialogos-v1.js y pulsa los controles reales, sin este adaptador.
    await page.addInitScript(instalar);
    await page.evaluate(instalar);
}
module.exports = { instalar, vm, prepararNavegador };
