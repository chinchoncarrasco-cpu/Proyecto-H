const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/libro-comparacion-readonly.cjs');
const S = require('../js/haiku-libro-semantica-v1.js');
const C = require('../js/haiku-libro-pagos-canon-v1.js');
const L = require('../js/haiku-libro-lenguaje-natural-v1.js').crearSemantica(S,C);

const consulta = 'Libro: compara pagos de noviembre 2026 con Proyecto H';
const clave = p => p.origen.hoja + '!' + p.origen.celda;
const plain = x => JSON.parse(JSON.stringify(x));

function escenario() {
    const { db, data: oct } = F.caso('auditoria');
    const nov = { ...structuredClone(oct), hoja:'Nov26', reservas:[], pagos:[] };
    const dic = { ...structuredClone(nov), hoja:'Dic26' };
    const crear = (data, cabana, ingreso, salida, comprobantes) => {
        const origen = celda => ({ hoja:data.hoja, celda });
        const titular = cabana === 1 ? 'Persona Primeraprueba' : 'Persona Segundaprueba';
        const reserva = F.reserva({ id:'libro-cab-'+cabana, titular, cabana, fecha_checkin:ingreso,
            fecha_checkout:salida, fechas_ocupadas:[ingreso], coordenadas_origen:origen('C3') });
        reserva.pagos = comprobantes.map(([fecha,celda,autorizacion,monto]) => F.pago({
            fecha_comprobante:fecha, fecha_bloque:ingreso, origen:origen(celda), titular, cabana,
            folio:null, bovtar:null, clasificacion_financiera:fecha ? 'pago_real' : 'dudoso',
            monto,codigo_autorizacion:autorizacion,texto_original:'Webpay crédito CodAut '+autorizacion
        }));
        data.reservas = [reserva];
        data.pagos = [...reserva.pagos];
        return F.estadia(reserva,{id:'estadia-'+cabana,reserva_id:'reserva-'+cabana});
    };
    db.reserva_estadias = [
        crear(oct,1,'2026-10-31','2026-11-01',[['2026-11-01','C27:F27','900001',15000]]),
        crear(nov,2,'2026-11-13','2026-11-14',[['2026-10-27','C31:F31','900002',20000],[null,'C32:F32','900003',30000]]),
        crear(dic,3,'2026-12-04','2026-12-05',[['2026-11-09','C37:F37','900004',40000]])
    ];
    nov.pagos.push(F.pago({ fecha_comprobante:'2026-11-05', monto:5000, cabana:null, venta_sin_reserva:true,
        origen:{hoja:'Nov26',celda:'T82:W82'} }));
    nov.pagos.push(F.pago({ fecha_comprobante:'2026-11-09', monto:21000, cabana:6,
        origen:{hoja:'Nov26',celda:'BX51:CA51'} }));
    db.pagos = [
        F.pagoH({ id:'registrado',reserva_id:'reserva-1',monto:15000,codigo_autorizacion:'900001',
            fecha_pago:'2026-11-01T00:00:00+00:00',datos_origen:{origen_libro:oct.pagos[0].origen} }),
        F.pagoH({ id:'solo-proyecto',reserva_id:'reserva-2',monto:7000,codigo_autorizacion:'901002',
            fecha_pago:'2026-12-01T01:30:00Z',datos_origen:{} }),
        F.pagoH({ id:'octubre-local',reserva_id:'reserva-1',codigo_autorizacion:'901003',fecha_pago:'2026-11-01T01:30:00Z' }),
        F.pagoH({ id:'anulado',reserva_id:'reserva-2',codigo_autorizacion:'901004',fecha_pago:'2026-11-05T12:30:00Z',estado:'anulado' })
    ];
    const web = F.web(nov), hojas = { Oct26:oct, Nov26:nov, Dic26:dic }, lotes = [];
    const libro = {
        ...web.HAIKU_LIBRO_RESERVA_V1, listarHojas:() => Object.keys(hojas),
        consultarHoja:async h => structuredClone(hojas[h]),
        consultarHojas:async hs => { lotes.push(hs.slice()); return hs.map(h => structuredClone(hojas[h])); }
    };
    const api = web.HAIKU_LIBRO_CONSULTAS, cliente = F.cliente(db);
    return { api, cliente, libro, hojas, lotes, consultar:() => api.consultar(consulta,libro,cliente) };
}

test('usa la fecha del comprobante, incluye estadías de otras hojas y conserva los pagos sin fecha', async () => {
    const e = escenario();
    const resultado = await e.consultar();
    assert.deepEqual(plain(e.lotes),[['Oct26','Dic26']]);
    assert.deepEqual(plain(resultado.comparacion.pagosDetalle.map(x => [clave(x.pago),x.estado])),[
        ['Nov26!C32:F32','revisar'],['Oct26!C27:F27','en_sistema'],['Dic26!C37:F37','nuevo_seguro']
    ]);
    assert.deepEqual(plain(resultado.comparacion.pagosFueraPeriodo.map(x => clave(x.pago))),['Nov26!C31:F31']);
    assert.deepEqual(plain(resultado.pagosPeriodo.sinEstadia.map(x => [x.estado,x.pago.monto])),
        [['venta_sin_reserva',5000],['sin_estadia',21000]]);
    assert.deepEqual(plain(resultado.pagosPeriodo.soloProyecto.map(x => [x.sistema.id,x.pago.fecha_comprobante])),
        [['solo-proyecto','2026-11-30']]);
    const plan = e.api.crearPlanIncorporacion(resultado.reservas,resultado.comparacion);
    assert.ok(plan.items.filter(x => x.pagoLibro).every(x =>
        !['Nov26!C31:F31','Nov26!T82:W82','Nov26!BX51:CA51'].includes(clave(x.pagoLibro))));
    assert.deepEqual(e.cliente.mutaciones,[]);
});

test('un importe cambiado con la misma autorización muestra una diferencia con el pago existente', async () => {
    const e = escenario();
    e.hojas.Oct26.pagos[0].monto = 17000;
    const r = await e.consultar();
    const movimiento = r.comparacion.pagosDetalle.find(x => clave(x.pago)==='Oct26!C27:F27');
    assert.equal(movimiento.estado,'diferente');
    assert.equal(movimiento.sistema.id,'registrado');
    assert.deepEqual(plain(movimiento.diferencias),['monto/moneda diferente']);
    assert.ok(r.pagosPeriodo.soloProyecto.every(x => x.sistema.id!=='registrado'));
    assert.deepEqual(e.cliente.mutaciones,[]);
});

test('el importe pendiente de aplicar se muestra sobre el pago existente y conserva la conciliación', async () => {
    const e = escenario();
    e.cliente.db.pago_aplicaciones = [
        {pago_id:'registrado',cargo_id:'cargo-a',monto_aplicado:7000},
        {pago_id:'registrado',cargo_id:'cargo-b',monto_aplicado:5000}
    ];
    const r = await e.consultar();
    const item = r.comparacion.pagosDetalle.find(x => x.sistema?.id==='registrado');
    assert.equal(item.estado,'en_sistema');
    assert.deepEqual(plain(r.pagosPeriodo.importesAplicados.registrado),{aplicado:12000,sinAplicar:3000});
    assert.equal(r.pagosPeriodo.pagosSinAplicar,1);

    const error = F.cliente(e.cliente.db,{errorTabla:'pago_aplicaciones'});
    const lectura = await e.api.consultar(consulta,e.libro,error);
    assert.equal(lectura.pagosPeriodo.pagosSinAplicar,null);
    assert.equal(lectura.comparacion.pagosDetalle.find(x => x.sistema?.id==='registrado').estado,'en_sistema');
    assert.deepEqual(error.mutaciones,[]);
});

test('un comprobante nuevo de servicio queda para revisión cuando falta su cargo', async () => {
    const e = escenario();
    const pago = e.hojas.Dic26.pagos[0];
    Object.assign(pago,{ tipo_movimiento:'servicio', concepto:'masaje' });
    const r = await e.consultar();
    const movimiento = r.comparacion.pagosDetalle.find(x => clave(x.pago)==='Dic26!C37:F37');
    assert.equal(movimiento.estado,'revisar');
    assert.equal(movimiento.destinoFinanciero.aplicaciones[0].estado,'sin_destino');
    assert.match(movimiento.motivos[0],/servicio pendiente compatible/);
    assert.deepEqual(e.cliente.mutaciones,[]);
});

test('mes actual se determina con la fecha de Chile', () => {
    const { data } = F.caso('auditoria');
    const web = F.web(data);
    web.Date = class extends Date {
        constructor(...args) { super(...(args.length ? args : ['2026-12-01T01:30:00Z'])); }
    };
    const q = web.HAIKU_LIBRO_CONSULTAS.interpretar('Libro: compara pagos del mes actual con Proyecto H',['Nov26','Dic26']);
    assert.deepEqual([q.por_fecha_pago,q.desde,q.hasta],[true,'2026-11-01','2026-11-30']);
});

test('un período con Libro vacío todavía compara los pagos confirmados de Proyecto H', async () => {
    const e = escenario();
    for (const hoja of Object.values(e.hojas)) { hoja.reservas = []; hoja.pagos = []; }
    const r = await e.consultar();
    assert.equal(r.comparacion.pagosDetalle.length,0);
    assert.deepEqual(plain(r.pagosPeriodo.soloProyecto.map(x => x.sistema.id)).sort(),['registrado','solo-proyecto']);
    assert.deepEqual(e.cliente.mutaciones,[]);
});

test('HOY no acredita la fecha, el reembolso conserva su importe y la venta sin reserva conserva su celda', () => {
    const c = (r,c,valor,extra) => ({r,c,valor,...extra});
    const filas = [
        c(1,2,'03-11-2026',{fechaISO:'2026-11-03'}),c(1,6,'04-11-2026',{fechaISO:'2026-11-04'}),
        c(2,0,'cabaña 1'),c(2,2,'Persona Primeraprueba // 2 ADL'),
        c(24,2,'Pagos de arriendos de hoy'),c(24,6,'Pagos de arriendos de hoy'),c(25,0,'cabaña 1'),
        c(26,2,'11-11-2026',{fechaISO:'2026-11-11',formula:'TODAY()'}),
        c(26,3,'Persona Primeraprueba // Folio 124 // BOVTAR 125 // Débito'),c(26,4,'cab1/1noche'),c(26,5,'15000',{valorNumero:15000}),
        c(27,3,'Reembolso pendiente'),c(27,4,'reembolso'),c(27,5,'-40000',{valorNumero:-40000}),
        c(31,0,'OTRAS VENTAS NO ASOCIADAS AL CHECK IN DEL DIA'),c(31,2,'03-11-2026',{fechaISO:'2026-11-03'}),
        c(31,3,'Folio 128 // BOVTAR 129 // Débito'),c(31,4,'QUEQUE'),c(31,5,'5000',{valorNumero:5000})
    ];
    const combinaciones = [{s:{r:2,c:2},e:{r:2,c:4}},{s:{r:25,c:0},e:{r:29,c:0}}];
    const d = L.corregirResultado(C.corregirResultado(S.normalizarHoja({celdas:filas,combinaciones},'Nov26')));
    const formula = d.pagos.find(p => p.fecha_comprobante_variable);
    assert.equal(formula.fecha_comprobante,null);
    assert.match(formula.advertencias[0],/día actual/);
    const venta = d.pagos.find(p => p.venta_sin_reserva);
    assert.deepEqual([venta.monto,venta.cabana,clave(venta)],[5000,null,'Nov26!C32:F32']);
    assert.ok(d.reservas.every(r => [...r.pagos,...r.pagos_sin_asociacion].every(p => !p.venta_sin_reserva)));
    const reembolso = d.anotaciones.find(a => a.monto_referencial===-40000);
    assert.equal(reembolso.fecha_comprobante,null);
    assert.equal(reembolso.origen.celda,'C28:F28');
});
