const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/haiku-reserva-estado-manual-v1.js');
const fixture = () => ({ reserva: { estado_reserva: 'confirmada' }, pagos: [], estadias: [{
    id: 'e1', cabana_numero: 2, estado_estadia: 'confirmada', tipo_estadia: 'alojamiento',
    fecha_ingreso: '2026-09-25', fecha_salida: '2026-09-28'
}] });
const ahora = new Date('2026-09-27T12:00:00Z');
const opciones = f => M.opciones(f, f.estadias[0], () => true, ahora);
test('usa los seis valores canónicos y distingue estado global del de cada cabaña', () => {
    assert.deepEqual(M.estados.map(e => e.valor), ['pendiente','confirmada','hospedada','checked_out','cancelada','no_show']);
    const f = fixture(); f.reserva.estado_reserva = 'hospedada';
    assert.equal(M.actual(f,f.estadias[0]),'confirmada');
    f.reserva.estado_reserva = 'cancelada'; assert.equal(M.actual(f,f.estadias[0]),'cancelada');
});
for (const [caso, ingreso, timestamp, permitido] of [
    ['futuro', '2026-09-28', '2026-09-27T15:00:00Z', false],
    ['23:59 del día anterior', '2026-09-27', '2026-09-27T02:59:00Z', false],
    ['último milisegundo anterior', '2026-09-27', '2026-09-27T02:59:59.999Z', false],
    ['exactamente 00:00 de ingreso', '2026-09-27', '2026-09-27T03:00:00Z', true],
    ['después de 00:00 de ingreso', '2026-09-27', '2026-09-27T15:00:00Z', true],
    ['invierno: antes de 00:00', '2026-07-27', '2026-07-27T03:59:59Z', false],
    ['invierno: exactamente 00:00', '2026-07-27', '2026-07-27T04:00:00Z', true]
]) test(`No Show America/Santiago: ${caso}`, () => {
    const f=fixture(); f.estadias[0].fecha_ingreso=ingreso;
    const motivo=M.opciones(f,f.estadias[0],()=>true,new Date(timestamp)).at(-1).motivo;
    if (permitido) assert.equal(motivo,''); else assert.match(motivo,/00:00 de la fecha de ingreso/);
});
for (const campo of ['checkin_realizado_en','checkout_realizado_en'])
test(`No Show en fecha de ingreso bloquea ${campo} previo`, () => {
    const f=fixture(); f.estadias[0].fecha_ingreso='2026-09-27';
    f.estadias[0][campo]='2026-09-27T03:00:00Z';
    assert.match(opciones(f).at(-1).motivo,/check-in o check-out/);
});
test('No Show revisa TODAS las estadías y no admite movimientos operativos', () => {
    const f=fixture(); f.estadias.push({...f.estadias[0],id:'e2',estado_estadia:'hospedada'});
    assert.match(opciones(f).at(-1).motivo,/check-in/);
});
test('reactivación conserva regla financiera, movimientos y límite seguro de una estadía', () => {
    const f=fixture(); f.reserva.estado_reserva='cancelada'; f.estadias[0].estado_estadia='cancelada';
    assert.equal(opciones(f)[0].motivo,''); assert.match(opciones(f)[1].motivo,/Sin abono/);
    f.pagos=[{estado:'confirmado',tipo_movimiento:'pago',etapa_operativa:'abono',monto:100}];
    assert.match(opciones(f)[0].motivo,/abono/); assert.equal(opciones(f)[1].motivo,'');
    f.estadias[0].checkin_realizado_en='2026-09-25T18:00:00Z';
    assert.match(opciones(f)[1].motivo,/movimientos/);
    f.estadias.push({...f.estadias[0],id:'e2'}); assert.match(opciones(f)[1].motivo,/varias/);
});
test('Confirmada sin abono sigue siendo válida; Pendiente con abono queda protegida', () => {
    const f=fixture(); f.estadias[0].estado_estadia='pendiente';
    assert.equal(opciones(f)[1].motivo,'');
    f.estadias[0].estado_estadia='confirmada';
    f.pagos=[{estado:'confirmado',tipo_movimiento:'pago',etapa_operativa:'abono',monto:100}];
    assert.match(opciones(f)[0].motivo,/abono/);
});
test('permisos distinguen cancelar de editar y No Show no tiene reactivación improvisada', () => {
    const f=fixture(); const o=M.opciones(f,f.estadias[0],p=>p==='reservas.cancelar',ahora);
    assert.equal(o[4].motivo,''); assert.match(o[2].motivo,/permiso/);
    f.reserva.estado_reserva='no_show'; assert.match(opciones(f)[1].motivo,/ruta segura/);
});
test('snapshot ordena las estadías y normaliza timestamps equivalentes', () => {
    const f=fixture(); f.estadias[0].checkin_realizado_en='2026-09-25T15:00:00-03:00';
    const a=M.esperado(f); f.estadias[0].checkin_realizado_en='2026-09-25T18:00:00Z';
    assert.deepEqual(M.esperado(f),a);
    f.estadias[0].fecha_salida='2026-09-29'; assert.notDeepEqual(M.esperado(f),a);
});
test('snapshot conserva microsegundos de Postgres al normalizar la zona horaria', () => {
    const f=fixture(); f.estadias[0].checkin_realizado_en='2026-09-25T15:00:00.123456-03:00';
    assert.equal(M.esperado(f).estadias[0].checkin_realizado_en,'2026-09-25T18:00:00.123456Z');
});
test('avisos hacen explícita la reversión y el alcance global de Cancelada/No Show', () => {
    const f=fixture(); f.estadias[0].estado_estadia='checked_out';
    assert.match(M.aviso(f,f.estadias[0],'confirmada'),/limpiarán/);
    assert.match(M.aviso(f,f.estadias[0],'hospedada'),/eliminará/);
    assert.match(M.aviso(f,f.estadias[0],'cancelada'),/todas las estadías/);
});
