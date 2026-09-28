(function () {
  'use strict';

  const api = window.HAIKU_CLOUDBEDS_PDF_V1;
  const base = {
    reserva_cloudbeds: 'CB-DEMO-A', nombre_huesped: 'Valentina Demo', habitaciones_raw: 'CD5(1)',
    check_in: '12/10/2026', check_out: '15/10/2026', total_habitacion: '$121.008',
    precio_total: '$144.000', saldo_pendiente: '$0', deposito: '$144.000', productos: '', estado: 'Confirmada',
    noches: '3', correo: 'v***@example.invalid'
  };
  const cols = {
    id: ['Reserva', 'reserva_cloudbeds'], nombre: ['Nombre y apellido', 'nombre_huesped'],
    habitacion: ['Núm. habitación', 'habitaciones_raw'], entrada: ['Check-in', 'check_in'],
    salida: ['Check-out', 'check_out'], habitacionTotal: ['Total De La Habitación', 'total_habitacion'],
    precio: ['Precio Total', 'precio_total'], saldo: ['Saldo Pendiente', 'saldo_pendiente'],
    deposito: ['Depósito', 'deposito'], estado: ['Estado', 'estado'], noches: ['Noches', 'noches'],
    productos: ['Productos', 'productos'], correo: ['Correo electrónico', 'correo']
  };

  const compactas = [cols.nombre, cols.entrada, cols.salida, cols.precio, cols.estado, cols.saldo,
    cols.habitacionTotal, cols.deposito, cols.id, cols.productos, cols.habitacion, cols.noches];

  const escenarios = [
    { key: 'A', titulo: 'Descuento sin productos', descripcion: 'Depósito es $144.000 frente a $160.000 en Proyecto H; Total habitación × 1,19 lo corrobora.', columns: compactas, row: base, total: 160000 },
    { key: 'B', titulo: 'Alojamiento + Jacuzzi', descripcion: 'Precio Total incluye $30.000 externos. El candidato sigue siendo el Depósito de $288.000.', columns: compactas, row: { ...base, reserva_cloudbeds: 'CB-DEMO-B', precio_total: '$318.000', total_habitacion: '$242.016', deposito: '$288.000', productos: 'Tinaja tipo Jacuzzi' }, total: 300000 },
    { key: 'C', titulo: 'Varios productos', descripcion: 'El componente no alojamiento observable es $110.000; no se desglosa ni se incorpora a la tarifa.', columns: compactas, row: { ...base, reserva_cloudbeds: 'CB-DEMO-C', precio_total: '$430.232', total_habitacion: '$269.102', deposito: '$320.232', productos: 'Late check out, masaje' }, total: 330000 },
    { key: 'D', titulo: 'Producto de $10.000', descripcion: 'Precio Total $190.001 menos Depósito $180.001 deja $10.000 fuera del alojamiento.', columns: compactas, row: { ...base, reserva_cloudbeds: 'CB-DEMO-D', precio_total: '$190.001', total_habitacion: '$151.261', deposito: '$180.001', productos: 'Late check out' }, total: 190000 },
    { key: 'E', titulo: 'Cancelada con depósito histórico', descripcion: 'La reserva se clasifica NO_APLICA y no genera propuesta, aunque conserve un Depósito.', columns: compactas, row: { ...base, reserva_cloudbeds: 'CB-DEMO-E', estado: 'Cancelada', precio_total: '$0' }, total: 160000 },
    { key: 'F', titulo: 'Multihabitación', descripcion: 'Un Depósito global no se reparte entre LC4 y C10: requiere revisión manual.', columns: compactas, row: { ...base, reserva_cloudbeds: 'CB-DEMO-F', habitaciones_raw: 'LC4(1), C10(1)', precio_total: '$288.000', deposito: '$288.000' }, total: 300000 },
    { key: 'G', titulo: 'Precio menor que Depósito', descripcion: 'Las señales financieras se contradicen; el motor bloquea la propuesta segura.', columns: compactas, row: { ...base, reserva_cloudbeds: 'CB-DEMO-G', precio_total: '$143.000' }, total: 160000 },
    { key: 'H', titulo: 'Columna Productos ausente', descripcion: 'Ausente no equivale a una celda vacía: el caso queda en revisión manual.', columns: compactas.filter(columna => columna !== cols.productos), row: { ...base, reserva_cloudbeds: 'CB-DEMO-H' }, total: 160000 },
    { key: 'I', titulo: 'Exportación con muchas columnas', descripcion: 'El catálogo flexible completo sigue siendo legible en un PDF ancho.', many: true, row: { ...base, reserva_cloudbeds: 'CB-DEMO-I' }, total: 160000 },
    { key: 'J', titulo: 'Orden completamente distinto', descripcion: 'El alias Núm. habitación y un orden arbitrario conservan el significado.', columns: [cols.deposito, cols.salida, cols.productos, cols.estado, cols.id, cols.precio, cols.habitacionTotal, cols.nombre, cols.entrada, cols.habitacion], row: { ...base, reserva_cloudbeds: 'CB-DEMO-J' }, total: 160000 }
  ];

  function pagina(columnas, row) {
    const items = [], gap = 118, x0 = 32;
    columnas.forEach(([header], i) => items.push({ str: header, x: x0 + i * gap, y: 38, h: 4 }));
    columnas.forEach(([, key], i) => items.push({ str: String(row[key] ?? ''), x: x0 + i * gap, y: 88, h: 4 }));
    return { width: x0 * 2 + columnas.length * gap, height: 400, items };
  }

  function columnasEscenario(escenario) {
    return escenario.many ? api.COLUMNAS.map(definicion => [definicion.aliases[0], definicion.key]) : escenario.columns;
  }

  function filaEscenario(escenario, columnas) {
    if (!escenario.many) return escenario.row;
    const row = {};
    columnas.forEach(([, key]) => { row[key] = 'Dato ficticio'; });
    Object.assign(row, escenario.row, {
      check_in: '12/10/2026', check_out: '15/10/2026', fecha_reserva: '01/10/2026',
      total_habitacion: '$121.008', precio_total: '$144.000', saldo_pendiente: '$0',
      deposito: '$144.000', productos: '', noches: '3', adultos: '2', ninos: '0', estado_generico: 'Confirmada'
    });
    return row;
  }

  const moneda = valor => valor === null || valor === undefined
    ? 'No disponible'
    : `${Number(valor) < 0 ? '-' : ''}$${Math.abs(Number(valor)).toLocaleString('es-CL')}`;
  const selector = document.querySelector('#escenario');
  escenarios.forEach((escenario, indice) => selector.add(new Option(`${escenario.key} · ${escenario.titulo}`, String(indice))));

  function mostrar(indice) {
    const escenario = escenarios[indice];
    const columnas = columnasEscenario(escenario);
    const row = filaEscenario(escenario, columnas);
    const entrada = api.parsearPaginas([pagina(columnas, row)])[0];
    const reserva = {
      id: `reserva-${escenario.key.toLowerCase()}`,
      cloudbeds_id: escenario.sinIdProyecto ? null : entrada.identificador_cloudbeds,
      titular_nombre: 'Valentina Demo', estado_reserva: 'confirmada',
      estadias: [{ fecha_ingreso: '2026-10-12', fecha_salida: '2026-10-15', cabanas: { numero: 5 } }]
    };
    const informe = api.comparar([entrada], [reserva], [{ reserva_id: reserva.id, total_alojamiento: escenario.total }]);
    const resultado = informe.filas[0];

    selector.value = String(indice);
    document.querySelector('#titulo').textContent = `${escenario.key} · ${escenario.titulo}`;
    document.querySelector('#descripcion').textContent = escenario.descripcion;
    document.querySelector('#identidad').textContent = resultado.evidencia || 'No verificable';
    document.querySelector('#clase').textContent = resultado.certeza;
    document.querySelector('#cloudbeds').textContent = moneda(resultado.total_cloudbeds_alojamiento);
    document.querySelector('#proyecto').textContent = moneda(resultado.total_proyecto_h);
    document.querySelector('#diferencia').textContent = resultado.diferencia === null ? 'No calculable' : `${resultado.diferencia > 0 ? '+' : ''}${moneda(resultado.diferencia)}`;
    document.querySelector('#encabezados').innerHTML = columnas.map(([header]) => `<th>${escapeHtml(header)}</th>`).join('');
    document.querySelector('#valores').innerHTML = columnas.map(([, key]) => `<td>${escapeHtml(row[key] ?? '')}</td>`).join('');
    document.querySelector('#diagnostico').textContent = JSON.stringify({
      columnas_reconocidas: entrada.columnas_presentes,
      columnas_desconocidas: entrada.columnas_desconocidas,
      capacidades: entrada.capacidades,
      advertencias: entrada.advertencias,
      propuesta: resultado.propuesta,
      solo_lectura: informe.solo_lectura,
      actualizacion: resultado.actualizacion
    }, null, 2);
    const contenedor = document.querySelector('#informe');
    contenedor.innerHTML = api.renderizar(informe);
    [...contenedor.querySelectorAll('details')].forEach(detalle => { if (detalle.querySelector('article')) detalle.open = true; });
  }

  function escapeHtml(valor) {
    return String(valor).replace(/[&<>"']/g, caracter => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caracter]);
  }

  selector.addEventListener('change', () => mostrar(Number(selector.value)));
  document.querySelector('#anterior').addEventListener('click', () => mostrar((Number(selector.value) + escenarios.length - 1) % escenarios.length));
  document.querySelector('#siguiente').addEventListener('click', () => mostrar((Number(selector.value) + 1) % escenarios.length));
  mostrar(0);
}());
