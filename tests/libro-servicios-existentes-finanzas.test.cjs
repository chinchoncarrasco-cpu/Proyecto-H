const test = require('node:test');
const assert = require('node:assert/strict');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');

function caso() {
    const e = entorno(), r = e.state.reservas[0], estadia = e.state.db.reserva_estadias[0];
    r.fecha_checkin = '2026-10-03'; r.fecha_checkout = '2026-10-04';
    r.texto_original = 'X PAGAR LATE OUT CLP$10,000 1 HORA';
    r.servicios = e.c.HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original, { origen_campo:'notas_reserva' });
    estadia.fecha_ingreso = r.fecha_checkin; estadia.fecha_salida = r.fecha_checkout;
    estadia.estado_estadia = 'checked_out'; e.state.db.reservas[0].estado_reserva = 'checked_out';
    const servicio = { id:'late-existente', reserva_id:estadia.reserva_id, estadia_id:estadia.id,
        fecha_servicio:'2026-10-04', hora_inicio:'13:00:00', hora_fin:'14:00:00',
        cantidad:1, personas:2, total:10000, tipo_cobro:'normal', estado_servicio:'programado',
        catalogo_servicios:{ codigo:'lateCheckout', nombre:'Late Check-out' },
        observaciones:'[HAKU-LIBRO-SERVICIO:pago_manual:comprobante-sintetico:late_checkout:0]' };
    const cargo = { cargo_id:'cargo-late', reserva_id:estadia.reserva_id, estadia_id:estadia.id,
        servicio_id:servicio.id, monto:10000, monto_ajustado:10000,
        aplicado_neto:10000, saldo_cargo:0, estado:'activo', estado_pago:'pagado' };
    e.state.db.servicios = [servicio]; e.state.db.vista_estado_cargos = [cargo];
    e.c.haikuTienePermiso = p => p === 'pagos.ver';
    const leer = async () => (await e.construir()).items.find(i => i.reserva.titular === r.titular && i.kind === 'servicio');
    return { e, r, estadia, servicio, cargo, leer };
}

test('Javiera: Late único de otra vía y sin hora en Libro se reconoce existente y pagado', async () => {
    const { e, r, servicio, leer } = caso(), fuente = JSON.stringify(r);
    const i = await leer();
    assert.equal(i.estado, 'existente'); assert.equal(i.identidad, 'YA_EXISTE');
    assert.equal(i.payload, null); assert.equal(i.servicio_existente.id, servicio.id);
    assert.equal(i.fecha, '2026-10-04'); assert.equal(i.hora, '13:00'); assert.equal(i.hora_fin, '14:00');
    assert.equal(i.razones.length, 0);
    assert.equal(i.finanzas_existente.estado, 'pagado');
    assert.equal(i.finanzas_existente.aplicado, 10000); assert.equal(i.finanzas_existente.saldo, 0);
    assert.match(i.finanzas_existente.etiqueta, /Pagado.*10.*saldo \$0/);
    assert.equal(JSON.stringify(r), fuente); assert.equal(e.state.escrituras.length, 0);
    assert.equal(servicio.estado_servicio, 'programado', 'pago no cambia el estado operativo');
});

for (const [nombre, aplicado, saldo, esperado] of [
    ['pendiente',0,10000,'pendiente'], ['parcial',4000,6000,'parcial'], ['pagado',10000,0,'pagado']
]) test('El servicio registrado permanece omitido y muestra su cargo: ' + nombre, async () => {
    const { e, cargo, leer } = caso(); cargo.aplicado_neto = aplicado; cargo.saldo_cargo = saldo;
    const i = await leer();
    assert.equal(i.estado, 'existente'); assert.equal(i.payload, null);
    assert.equal(i.finanzas_existente.estado, esperado); assert.equal(i.finanzas_existente.saldo, saldo);
    assert.equal(e.state.escrituras.length, 0);
});

test('No usa el abono total de la reserva para declarar pagado el servicio', async () => {
    const { e, cargo, leer } = caso(); cargo.aplicado_neto = 0; cargo.saldo_cargo = 10000;
    e.state.db.pagos = [{ reserva_id:cargo.reserva_id, monto:170000, estado:'confirmado', tipo_movimiento:'pago' }];
    assert.equal((await leer()).finanzas_existente.estado, 'pendiente');
});

test('Varios candidatos sin hora permanecen ambiguos aunque sólo uno coincida en importe', async () => {
    const { e, servicio, leer } = caso();
    e.state.db.servicios.push({ ...servicio, id:'otro-late', hora_inicio:'15:00:00', total:20000 });
    const i = await leer(); assert.equal(i.estado, 'revisar'); assert.equal(i.payload, null);
    assert.match(i.razones.join(' '), /varios servicios/);
});

for (const [campo, valor] of [['total',20000], ['cantidad',2], ['tipo_cobro','cortesia']])
    test('La coincidencia sin hora no oculta contradicción explícita: ' + campo, async () => {
        const { servicio, leer } = caso(); servicio[campo] = valor;
        const i = await leer(); assert.equal(i.estado, 'revisar'); assert.equal(i.payload, null);
        assert.match(i.razones.join(' '), /contradice/);
    });

for (const [campo, valor] of [['estadia_id','otra-estadia'], ['reserva_id','otra-reserva'],
    ['fecha_servicio','2026-10-05'], ['estado_servicio','cancelado']])
    test('No asocia un servicio ajeno/inactivo: ' + campo, async () => {
        const { servicio, leer } = caso(); servicio[campo] = valor;
        assert.notEqual((await leer()).estado, 'existente');
    });

test('Personas inferidas distintas no invalidan un servicio único: ausencia no es contradicción', async () => {
    const { r, servicio, leer } = caso(); r.adultos = 3; servicio.personas = 2;
    assert.equal((await leer()).estado, 'existente');
});

test('Tinaja sin tipo ni hora: una sola existente de la estadía aporta tipo/horario y cortesía', async () => {
    const { e, r, servicio, leer } = caso();
    r.texto_original = '1 HORA DE CORTESIA TINAJA';
    r.servicios = e.c.HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original, { origen_campo:'notas_reserva' });
    Object.assign(servicio, { catalogo_servicios:{codigo:'tinajaJacuzzi',nombre:'Tinaja Jacuzzi'},
        fecha_servicio:'2026-10-03', hora_inicio:'22:15:00', hora_fin:'23:15:00', tipo_cobro:'cortesia', total:0 });
    e.state.db.vista_estado_cargos = [];
    const i = await leer(); assert.equal(i.estado, 'existente');
    assert.equal(i.mapa.codigo, 'tinajaJacuzzi'); assert.equal(i.hora, '22:15');
    assert.equal(i.finanzas_existente.estado, 'cortesia'); assert.equal(i.payload, null);
});

test('Sin permiso de pagos conserva identidad, pero no afirma que esté pagado', async () => {
    const { e, leer } = caso(); e.c.haikuTienePermiso = () => false;
    const i = await leer(); assert.equal(i.estado, 'existente');
    assert.equal(i.finanzas_existente.estado, 'por_verificar'); assert.equal(i.payload, null);
});

test('Error de lectura financiera no pierde el servicio ni inventa saldo cero', async () => {
    const { e, leer } = caso(), original = e.c.haikuSupabase.from;
    e.c.haikuSupabase.from = tabla => tabla === 'vista_estado_cargos'
        ? { select(){return this;}, in(){return Promise.resolve({data:null,error:{message:'offline'}});} }
        : original(tabla);
    const i = await leer(); assert.equal(i.estado, 'existente');
    assert.equal(i.finanzas_existente.estado, 'por_verificar');
    assert.equal(Object.hasOwn(i.finanzas_existente, 'saldo'), false);
});

test('No tener cargo activo no equivale a pagado', async () => {
    const { e, cargo, leer } = caso(); cargo.estado = 'anulado';
    assert.equal((await leer()).finanzas_existente.estado, 'sin_cargo_activo');
    e.state.db.vista_estado_cargos = [];
    assert.equal((await leer()).finanzas_existente.estado, 'sin_cargo_activo');
});

test('Un ajuste total a cero se distingue de un pago recibido', async () => {
    const { cargo, leer } = caso(); cargo.monto_ajustado = 0; cargo.aplicado_neto = 0;
    const i = await leer(); assert.equal(i.finanzas_existente.estado, 'sin_saldo_ajustado');
    assert.doesNotMatch(i.finanzas_existente.etiqueta, /Pagado/);
});

for (const [campo, valor] of [['saldo_cargo',null], ['aplicado_neto',-1], ['monto',9999],
    ['reserva_id','otra-reserva'], ['estadia_id','otra-estadia'], ['estado','desconocido']])
    test('Finanzas incoherentes quedan por verificar: ' + campo, async () => {
        const { cargo, leer } = caso(); cargo[campo] = valor;
        assert.equal((await leer()).finanzas_existente.estado, 'por_verificar');
    });

test('Cargos activos múltiples no se ocultan bajo una etiqueta de pagado', async () => {
    const { e, cargo, leer } = caso();
    e.state.db.vista_estado_cargos.push({ ...cargo, cargo_id:'segundo-cargo' });
    assert.equal((await leer()).finanzas_existente.estado, 'por_verificar');
});

test('Relectura actualiza el pago sin cambiar la glosa antigua ni crear servicios', async () => {
    const { e, r, cargo, leer } = caso(), original = JSON.stringify(r);
    cargo.aplicado_neto = 4000; cargo.saldo_cargo = 6000;
    assert.equal((await leer()).finanzas_existente.estado, 'parcial');
    cargo.aplicado_neto = 10000; cargo.saldo_cargo = 0;
    assert.equal((await leer()).finanzas_existente.estado, 'pagado');
    assert.equal(JSON.stringify(r), original); assert.equal(e.state.db.servicios.length, 1);
    assert.equal(e.state.escrituras.length, 0);
});

test('La lectura paginada no declara ausencia de cargo antes de terminar', async () => {
    const { e, cargo, leer } = caso(), original = e.c.haikuSupabase.from;
    const filas = Array.from({length:500}, (_, i) => ({ ...cargo, cargo_id:'historico-' + i, estado:'anulado' }));
    filas.push(cargo); const rangos = [];
    e.c.haikuSupabase.from = tabla => tabla !== 'vista_estado_cargos' ? original(tabla) : {
        select(){return this;}, in(){return this;}, order(){return this;},
        async range(a,b){rangos.push([a,b]);return {data:filas.slice(a,b+1),error:null};}
    };
    assert.equal((await leer()).finanzas_existente.estado, 'pagado'); assert.equal(rangos.length, 2);
});

test('La ficha pagada aparece sólo en Ya existen, sin botón para incorporarla', async () => {
    const { e } = caso(), out = new e.Element('div'); e.document.card = out;
    e.api.renderizar(await e.construir(), out, consulta);
    const existentes = out.querySelector('.haku-libro-servicios__seccion--existentes');
    const revision = out.querySelector('.haku-libro-servicios__seccion--revision');
    assert.ok(existentes); assert.match(existentes.textContent, /Javiera Barrera.*Pagado/);
    assert.doesNotMatch(revision.textContent, /Javiera Barrera/);
    const fila = existentes.querySelectorAll('.haku-libro-servicios__item')[0];
    assert.equal(fila.querySelector('input').disabled, true);
    assert.equal(fila.querySelectorAll('button').filter(b => b.textContent === 'Aprobación manual').length, 0);
    assert.equal(e.state.escrituras.length, 0);
});
