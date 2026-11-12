const test = require('node:test');
const assert = require('node:assert/strict');
const { entorno } = require('./fixtures/libro-servicio-manual.cjs');

const consulta = 'Libro: compara servicios de noviembre 2026 (del 01-11-2026 al 30-11-2026) con Proyecto H';
const plano = value => JSON.parse(JSON.stringify(value));

function escenario(texto, entrada = '2026-11-06', salida = '2026-11-08', cabana = 4) {
    const e = entorno(), r = e.state.reservas[0], s = e.state.db.reserva_estadias[0];
    Object.assign(r, { cabana, fecha_checkin:entrada, fecha_checkout:salida,
        noches:(Date.parse(salida) - Date.parse(entrada)) / 86400000, tipo_estadia:entrada === salida ? 'full_day' : 'alojamiento',
        coordenadas_origen:{hoja:'Nov26',celda:'X6'} });
    Object.assign(s, { fecha_ingreso:entrada, fecha_salida:salida, tipo_estadia:r.tipo_estadia });
    e.state.db.cabanas[0].numero = cabana;
    const actualizar = texto => {
        r.texto_original = texto;
        r.servicios = e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto,{origen_campo:'notas_reserva',coordenadas_origen:r.coordenadas_origen});
    };
    actualizar(texto);
    e.c.HAIKU_LIBRO_RESERVA_V1.listarHojas = () => ['Nov26'];
    e.c.HAIKU_LIBRO_RESERVA_V1.consultarHoja = async () => ({reservas:[r]});
    const comparar = () => e.api.construir(consulta);
    const registrar = (codigo, campos) => {
        e.state.db.servicios.push({ id:'registrado-'+e.state.db.servicios.length, reserva_id:s.reserva_id,estadia_id:s.id,
            catalogo_servicios:e.state.db.catalogo_servicios.find(c => c.codigo === codigo),estado_servicio:'programado',
            tipo_cobro:'normal',personas:2,cantidad:1,...campos });
    };
    return {...e,r,s,actualizar,comparar,registrar};
}

test('recupera el rango contiguo y la fecha con barra repetida, manteniendo la nota de entrega aparte', async () => {
    for (const [texto, inicio, fin] of [
        ['TINAJA CORTESÍA TONEL 07-11 // 19:15 a 20:15 // batas entregadas','19:15','20:15'],
        ['TINAJA DE CORTESIA TONEL SAB 07//11/2026 DE 17:45 A 18:45 BATAS ENTREGADAS','17:45','18:45']
    ]) {
        const e = escenario(texto);
        const {items} = await e.comparar();
        const servicio = items.find(i => i.kind === 'servicio');
        assert.deepEqual([servicio.estado,servicio.fecha,servicio.hora,servicio.hora_fin,servicio.payload?.tipo_cobro],
            ['listo','2026-11-07',inicio,fin,'cortesia']);
        assert.match(items.find(i => i.kind === 'nota').texto,/^batas entregadas$/i);
    }
    const e = escenario('TINAJA CORTESÍA TONEL 07-11 // Recepción // 19:15 a 20:15');
    const [servicio] = (await e.comparar()).items;
    assert.equal(servicio.hora,null);
    assert.equal(servicio.estado,'revisar');
});

test('reconoce Jacuzzi con la variante escrita en recepción y conserva la entrega como nota', async () => {
    const e = escenario('tinaja jacussi 17:45 de cortesía batas entregadas','2026-11-06','2026-11-06');
    const {items} = await e.comparar();
    assert.equal(items.find(i => i.kind === 'servicio').payload.codigo_servicio,'tinajaJacuzzi');
    assert.equal(items.find(i => i.kind === 'nota').texto,'Batas entregadas');
});

test('la fecha del registro tras el operador y una nota de cama no contradice el masaje de salida', async () => {
    const masaje = 'MASAJE RELAJANTE 1 HORA 10:00AM 08-11-26 X PAGAR';
    const e = escenario('2 ADL // CAMA ADICIONAL // DA // 06-11-2026 // '+masaje,'2026-11-07','2026-11-08');
    const servicios = async () => (await e.comparar()).items.filter(i => i.kind === 'servicio');
    const [item] = await servicios();
    assert.deepEqual([item.estado,item.fecha,item.hora,item.payload.codigo_servicio],
        ['listo','2026-11-08','10:00','masajeTerapeutico60']);
    e.actualizar(masaje+' // 06-11-2026');
    assert.match((await servicios())[0].razones.join(' '),/contradictoria de fecha/);
});

test('el origen identifica el registro y deja visibles fecha, término e importe que difieren', async () => {
    const e = escenario('Jacuzzi a las 15:30 el día 12-10; x cobrar $40.000 // Late check out hasta las 18:00 hrs; x cobrar $30.000',
        '2026-11-15','2026-11-16');
    const [tinaja] = (await e.comparar()).items;
    e.registrar('tinajaJacuzzi',{fecha_servicio:'2026-10-12',hora_inicio:'15:30:00',hora_fin:'16:30:00',total:30000,
        observaciones:'[HAKU-LIBRO-SERVICIO:'+tinaja.item_id+']'});
    e.registrar('lateCheckout',{fecha_servicio:'2026-11-16',hora_inicio:'18:00:00',hora_fin:'19:00:00',total:10000});
    const {items} = await e.comparar();
    assert.ok(items.every(i => i.estado === 'revisar' && i.payload === null));
    assert.deepEqual(plano(items.map(i => i.diferenciaRegistrada.filas.map(f => [f.campo,f.libro,f.proyecto]))),[
        [['fecha','2026-10-12 · fuera de la estadía','2026-10-12'],['monto','$40.000','$30.000']],
        [['hora_fin','18:00','19:00'],['monto','$30.000','$10.000']]
    ]);
    assert.equal(e.state.escrituras.length,0);
});

test('un Late Out hasta las 18:00 permite confirmar el inicio y calcular las horas con el precio explícito', async () => {
    const e = escenario('Late check out hasta las 18:00 hrs; x cobrar $30.000');
    const [base] = (await e.comparar()).items;
    assert.equal(base.payload,null);
    const datos = await e.api.calcularManual(base,{hora:'12:00',precio_decision:'libro'},await e.api.cargarContratoManual());
    assert.deepEqual([datos.item.payload.hora,datos.item.hora_fin,datos.cantidad,datos.item.payload.precio_manual,datos.total],
        ['12:00','18:00',6,5000,30000]);
});

test('un masaje movido conserva su candidato y una indicación independiente sigue preparable', async () => {
    const antes = '1 MASAJE DESCONTRACTURANTE DE 1 HORA 07/11/2026 A LAS 19:00 X PAGAR';
    const ahora = antes.replace('19:00','20:00');
    const e = escenario(ahora);
    e.registrar('masajeDescontracturante60',{fecha_servicio:'2026-11-07',hora_inicio:'19:00:00',hora_fin:'20:00:00',total:45000,
        observaciones:'Importado desde Libro de Reserva. '+antes+' [HAKU-LIBRO-SERVICIO:srv:anterior]'});
    const [movido] = (await e.comparar()).items;
    assert.equal(movido.estado,'revisar'); assert.equal(movido.payload,null);
    assert.deepEqual(plano(movido.diferenciaRegistrada.filas.map(f => [f.etiqueta,f.libro,f.proyecto])),[['Inicio','20:00','19:00']]);
    e.actualizar(antes+' // '+ahora);
    assert.deepEqual(Array.from((await e.comparar()).items,i => i.estado),['existente','listo']);
});

test('dos turnos consecutivos difieren del intervalo importado para la misma estadía', async () => {
    const texto = '2 MASAJES DESCONTRACTURANTES DE 1 HORA C/U COMENZANDO A LAS 19:00 EL 07/11/2026 X PAGAR';
    const e = escenario(texto);
    const [base] = (await e.comparar()).items;
    e.registrar('masajeDescontracturante60',{fecha_servicio:'2026-11-07',hora_inicio:'19:00:00',hora_fin:'20:00:00',
        total:90000,cantidad:2,observaciones:'Importado desde Libro de Reserva. '+texto+' [HAKU-LIBRO-SERVICIO:'+base.item_id+']'});
    const [item] = (await e.comparar()).items;
    assert.equal(item.estado,'revisar'); assert.equal(item.payload,null);
    assert.deepEqual(plano(item.diferenciaRegistrada.filas.map(f => [f.campo,f.libro,f.proyecto])),[
        ['turnos','19:00 y 20:00','19:00–20:00']
    ]);
});

test('la coordinación pendiente conserva la nota y señala el masaje ya programado', async () => {
    const antes = '2 MASAJES RELAJANTES DE 1 HORA C/U SIMULTÁNEOS CON DOS PROFESIONALES PARA EL SÁBADO 14 DE NOV A LAS 16.00 HRS X COBRAR';
    const ahora = antes.replace('CON DOS PROFESIONALES','CON LA PRIMERA (Por coordinar segunda masajista)');
    const e = escenario(ahora,'2026-11-13','2026-11-15');
    e.registrar('masajeTerapeutico60',{fecha_servicio:'2026-11-14',hora_inicio:'16:00:00',hora_fin:'17:00:00',total:90000,cantidad:2,
        observaciones:'Importado desde Libro de Reserva. '+antes+' [HAKU-LIBRO-SERVICIO:srv:anterior]'});
    e.state.db.notas.push({reserva_id:e.s.reserva_id,estadia_id:e.s.id,tipo:'operativa_resumen',texto:ahora});
    const {items} = await e.comparar();
    const nota = items.find(i => i.kind === 'nota'), servicio = items.find(i => i.kind === 'servicio');
    assert.equal(nota.estado,'existente');
    assert.equal(servicio.estado,'revisar'); assert.equal(servicio.payload,null);
    assert.deepEqual(plano(servicio.diferenciaRegistrada.filas[0]),{campo:'coordinacion',etiqueta:'Coordinación',libro:ahora,proyecto:antes});
});

test('una nota operativa de la misma estadía compara la cantidad y conserva instrucciones nuevas', async () => {
    const antes = 'ENTREGA CARBÓN, sacacorcho, art. asado, cenicero';
    const ahora = antes.replace('cenicero','2 ceniceros');
    const e = escenario(ahora+' // Pedir Correo // pedir teléfono');
    e.state.db.notas.push({reserva_id:e.s.reserva_id,estadia_id:e.s.id,tipo:'operativa_resumen',texto:antes});
    const {items} = await e.comparar();
    const cambio = items.find(i => i.texto === ahora);
    assert.equal(cambio.estado,'revisar'); assert.equal(cambio.payload,null);
    assert.equal(cambio.diferenciaRegistrada.filas[0].proyecto,antes);
    assert.deepEqual(Array.from(items.filter(i => i.estado === 'listo'),i => i.texto),['Pedir Correo','pedir teléfono']);
    e.actualizar(antes+' // '+ahora);
    assert.deepEqual(Array.from((await e.comparar()).items,i => i.estado),['existente','listo']);
});

test('una lectura incompleta de notas conserva la revisión', async () => {
    const e = escenario('Pedir correo');
    const from = e.c.haikuSupabase.from;
    e.c.haikuSupabase.from = tabla => tabla === 'notas' ? {
        select: () => ({in: async () => ({data:null,error:Error('lectura no disponible')})})
    } : from(tabla);
    const [nota] = (await e.comparar()).items;
    assert.equal(nota.estado,'revisar'); assert.equal(nota.payload,null);
    assert.match(nota.razones.join(' '),/comprobar las notas/);
});

test('una elección manual auditada de precio sigue vigente mientras coincidan su evidencia y su registro', async () => {
    const e = escenario('TONEL 19:00 EL 07/11/2026; X COBRAR $40.000');
    const [base] = (await e.comparar()).items;
    const resuelto = await e.api.confirmarServicioManual(consulta,base.item_id,{precio_decision:'catalogo'},e.manuales,base.firmaManual);
    const aprobacion = resuelto.items[0].payload.servicio_manual_v1;
    e.registrar('tinajaTonel',{fecha_servicio:'2026-11-07',hora_inicio:'19:00:00',hora_fin:'20:00:00',
        total:30000,libro_resolucion_manual_v1:aprobacion,observaciones:'[HAKU-LIBRO-SERVICIO:'+base.item_id+']'});
    assert.equal((await e.comparar()).items[0].estado,'existente');
    e.state.db.servicios[0].total=25000;
    const diferencia=(await e.comparar()).items[0];
    assert.equal(diferencia.estado,'revisar');
    assert.equal(diferencia.diferenciaRegistrada.filas.find(f=>f.campo==='monto').proyecto,'$25.000');
    await assert.rejects(e.api.confirmarServicioManual(consulta,base.item_id,{},e.manuales,diferencia.firmaManual),/registro relacionado/);
});

test('noviembre incluye la salida de una estadía de octubre sin traer la tinaja de octubre', async () => {
    const e = escenario('TONEL CORTESÍA 22:15 // LATE OUT HASTA LAS 20 HRS X PAGAR // PEDIR RUT',
        '2026-10-31','2026-11-01');
    e.r.coordenadas_origen = {hoja:'Oct26',celda:'DS3'};
    e.c.HAIKU_LIBRO_RESERVA_V1.listarHojas = () => ['Oct26','Nov26'];
    e.c.HAIKU_LIBRO_RESERVA_V1.consultarHoja = async hoja => ({reservas:hoja === 'Oct26' ? [e.r] : []});
    for (const duplicada of [false,true]) {
        if (duplicada) e.c.HAIKU_LIBRO_RESERVA_V1.consultarHoja = async () => ({reservas:[e.r]});
        const {items,reservas} = await e.comparar();
        assert.equal(reservas.length,1); assert.equal(items.length,1);
        assert.deepEqual([items[0].servicio.concepto,items[0].fecha,items[0].horaSalidaLibro],['lateout','2026-11-01','20:00']);
    }
});
