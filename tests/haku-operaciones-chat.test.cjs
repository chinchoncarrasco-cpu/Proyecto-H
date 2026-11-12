const assert = require("node:assert/strict");
const test = require("node:test");
const parser = require("../js/haiku-asistente-operaciones-v1.js");
const ayuda = require("../js/haiku-ayuda-v1.js");
const contexto = { diaActual: "2026-11-12" };
const leer = texto => parser.interpretar(texto, contexto);

const casos = [
    ["modifca la cabaña de Ana Pérez CAB 3 hoy a CAB 4", "editarReserva", { campo:"cabana", valor:4, cabana:3, titular:"Ana Pérez" }],
    ["mueve la resrva de Ana Pérez de cba.3 hoy a cab4", "editarReserva", { campo:"cabana", valor:4, cabana:3 }],
    ["cambia la fecha de ingreso de Ana Pérez CAB3 hoy al 15/11", "editarReserva", { campo:"ingreso", valor:"2026-11-15" }],
    ["cambia fechas de Ana Pérez cab3 hoy del 15/11/2026 al 17/11/2026", "editarReserva",
        { campo:"fechas", valor:{desde:"2026-11-15",hasta:"2026-11-17"} }],
    ["cambia la salida de CAB 3 del ingreso hoy a mañana", "editarReserva", { campo:"salida", modoFecha:"ingreso", valor:"2026-11-13" }],
    ["fija el precio por noche de CAB3 hoy en 180 lucas", "editarReserva", { campo:"tarifa", valor:180000 }],
    ["corrige el nombre del titular de CAB3 hoy a María del Carmen Soto", "editarReserva", { campo:"titular", valor:"María del Carmen Soto" }],
    ["edita el fono de CAB 3 hoy a +56 9 1234 5678", "editarReserva", { campo:"telefono", valor:"+56 9 1234 5678" }],
    ["deja la ocupación de CAB3 hoy en 2 adultos y 1 niño", "editarReserva", { campo:"ocupacion", valor:{adultos:2,ninos:1} }],
    ["deja los niños de CAB3 hoy en 0", "editarReserva", { campo:"ocupacion", valor:{ninos:0} }],
    ["cancela reserva de Ana Pérez CAB 3 hoy", "estadoReserva", { estado:"cancelada" }],
    ["checkout de cab3 hoy", "estadoReserva", { estado:"checked_out", modoFecha:"salida" }],
    ["haz el check out de la reserva H-20261112-03-ABC123", "estadoReserva", { estado:"checked_out", codigo:"H-20261112-03-ABC123" }],
    ["mraca no show de CAB 3 hoy", "estadoReserva", { estado:"no_show" }],
    ["pon reserva de CAB3 hoy como no show", "estadoReserva", { estado:"no_show" }],
    ["reativa resrva de CAB3 hoy", "estadoReserva", { estado:"reactivar" }],
    ["mueve el Tónel de CAB3 hoy de las 18.00 a las 20.45", "reprogramar", { horaOriginal:"18:00", nuevo:{hora:"20:45"} }],
    ["reagenda la tinaja jacuzzi de CAB 3 hoy para mañana a las 8:15 pm", "reprogramar",
        { servicio:"tinaja jacuzzi", fecha:"2026-11-12", nuevo:{fecha:"2026-11-13",hora:"20:15"} }],
    ["consulta agenda de masajes de CAB3 mañana", "agendaServicios", { fecha:"2026-11-13", cabana:3, soloMasajes:true }],
    ["corrjge el abono folio 00123 de CAB3 hoy a $90.000", "editarPago", { referencia:"00123", cambio:{monto:90000} }],
    ["cambia el pago folio 00123 de CAB3 hoy a folio 00124", "editarPago", { referencia:"00123", cambio:{folio:"00124"} }],
    ["edita el abono de CAB3 hoy a fecha 10/11/26", "editarPago", { cambio:{fecha_pago:"2026-11-10"} }],
    ["cambia el pago folio 00123 de CAB3 hoy a medio tarjeta débito", "editarPago", { cambio:{medio_pago:"tarjeta_debito"} }],
    ["anula el pago folio 00123 de CAB3 hoy motivo: Duplicado", "anularPago", { referencia:"00123", motivo:"Duplicado" }],
    ["anula webpay pendiente codaut 000345", "anularPago", { referencia:"000345", webpay:true }],
    ["devuelve el abono de CAB3 hoy", "reembolso", { cabana:3 }],
    ["registra devolución del pago folio 00123 de CAB3 hoy, fecha 12/11/2026, medio transferencia, comprobante DEV-123, motivo: Duplicado",
        "registrarDevolucion", { fechaDevolucion:"2026-11-12", comprobante:"DEV-123" }],
    ["registra aseo de CAB3 hoy IN 10:00 OUT 11.30 encargado María Paz", "aseo",
        { campos:{in:"10:00",out:"11:30",encargado_nombre:"María Paz"} }],
    ["marca aseo no requiere de CAB3 hoy", "aseo", { estado:"no_requiere" }],
    ["inicia revisión completa de CAB3 hoy", "revision", { modalidad:"completa", estado:"en_revision" }],
    ["marca repaso lista de CAB3 hoy", "revision", { modalidad:"repaso", estado:"lista" }],
    ["blokea CAB3 del 15 al 17 de noviembre por mantención", "bloquear", { desde:"2026-11-15", hasta:"2026-11-17", motivo:"mantención" }],
    ["anota nota de reserva de Ana Pérez CAB3 hoy: Lleva 2 batas.\nAvisó ayer.", "nota",
        { asociar:true, texto:"Lleva 2 batas.\nAvisó ayer." }],
    ["envía whatsapp a Ana Pérez CAB3 hoy: ¿Llegan a las 20:00?", "mensaje", { canal:"whatsapp", texto:"¿Llegan a las 20:00?" }],
    ["cobra saldo de CAB3 hoy", "cobrar", { fecha:"2026-11-12" }]
];

for (const [texto, accion, esperado] of casos) {
    test(texto, () => {
        for (const prefijo of ["", "Haku, ", "Oye Haiku, porfa, "]) {
            const q = leer(prefijo + texto);
            assert.equal(q?.accion, accion, JSON.stringify(q));
            for (const [k,v] of Object.entries(esperado)) assert.deepEqual(q[k],v);
        }
    });
}

test("preserva comandos de Libro, check-in, totales y especialistas de pagos y servicios", () => {
    for (const texto of ["compara servicios y notas de noviembre con el Libro", "marca como hospedadas las reservas que ingresan hoy en CAB 3",
        "cambia el precio de Ana Pérez CAB 3 hoy a $180.000", "registra el pago folio 123 de CAB3",
        "cancela tinaja de CAB3 hoy", "cambia la tinaja Tónel de Ana Pérez CAB 3 del 12/11/2026 a las 20:00 a cobro normal",
        "agenda tonel CAB3 a las 20.45", "dime horarios libres de tinajas mañana", "abre ficha de CAB3 hoy"]) {
        assert.equal(leer(texto), null, texto);
    }
});

test("exige alcance, identidad y evidencia según la acción", () => {
    for (const texto of ["cambia cabaña CAB3 y CAB4 a CAB5", "bloquea CAB3 desde mañana hasta hoy",
        "envía WhatsApp a CAB3 hoy", "registra aseo CAB3 hoy IN 25:00 OUT 23:00",
        "anula WebPay pendiente", "registra devolución del abono folio 00123 de CAB3 hoy"]) {
        assert.ok(leer(texto)?.error, texto);
    }
});

test("los ejemplos nuevos de Ayuda llegan a la acción que describen", () => {
    const acciones = ayuda.secciones.flatMap(g => g.acciones);
    const soportadas = new Set(acciones.flatMap(a => a.ejemplos || []).map(t => leer(t)?.accion).filter(Boolean));
    assert.deepEqual([...soportadas].sort(), [...new Set(casos.map(c => c[1]))].sort());
    for (const texto of acciones.flatMap(a => a.ejemplos || [])) assert.equal(leer(texto)?.error, undefined, texto);
});
