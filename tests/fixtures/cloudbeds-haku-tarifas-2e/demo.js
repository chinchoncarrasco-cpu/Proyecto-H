(async function () {
  'use strict';
  const pdf = window.HAIKU_CLOUDBEDS_PDF_V1;
  const tarifas = window.HAIKU_CLOUDBEDS_TARIFAS_V1;
  const base = (numero, nombre, extra = {}) => ({
    reserva_cloudbeds: numero, id_cloudbeds: `RID-${numero}`, nombre_huesped: nombre,
    habitaciones_raw: 'CD5(1)', check_in: '20/09/2026', check_out: '21/09/2026', noches: '1',
    precio_total: '$144.000', total_habitacion: '$121.008', deposito: '$144.000', saldo_pendiente: '$0',
    productos: '', estado: 'Confirmada', ...extra
  });
  const reserva = (id, numero, nombre, extra = {}) => ({
    id, cloudbeds_id: numero, titular_nombre: nombre, estado_reserva: 'confirmada', grupo_reserva_id: null,
    estadias: [{ fecha_ingreso: '2026-09-20', fecha_salida: '2026-09-21', cabanas: { numero: 5 } }], ...extra
  });
  const fullDay = (numero, nombre, habitacion, ingreso, extra = {}) => {
    const siguiente = new Date(`${ingreso}T00:00:00Z`);
    siguiente.setUTCDate(siguiente.getUTCDate() + 1);
    const fechaCloudbeds = valor => valor.split('-').reverse().join('/');
    return base(numero, nombre, {
      habitaciones_raw: `${habitacion}(1)`,
      check_in: fechaCloudbeds(ingreso),
      check_out: fechaCloudbeds(siguiente.toISOString().slice(0, 10)),
      precio_total: '$120.000',
      total_habitacion: '',
      deposito: '$120.000',
      adultos: '2',
      ninos: '0',
      ...extra
    });
  };
  const reservaFullDay = (id, nombre, cabana, fecha, extra = {}) => reserva(id, null, nombre, {
    estadias: [{
      id: `e-${id}`, fecha_ingreso: fecha, fecha_salida: fecha, tipo_estadia: 'fullday',
      adultos: 2, ninos: 0, mascotas: 0, cabanas: { numero: cabana }
    }],
    ...extra
  });
  const manual = base('CB-REV', 'Bruno Ficticio'); delete manual.productos;
  const entradas = [
    base('CB-HECTOR', 'Héctor Ficticio'),
    base('CB-ELENA', 'Elena Ficticia', { precio_total: '$318.000', total_habitacion: '$242.016', deposito: '$288.000', productos: 'Tinaja tipo Jacuzzi' }),
    base('CB-OK', 'Amelia Ficticia'),
    manual,
    base('CB-CANCEL', 'Camila Ficticia', { estado: 'Cancelada', precio_total: '$0' }),
    base('CB-RODRIGO', 'Rodrigo Control'),
    base('CB-MULTI', 'Grupo Ficticio', { habitaciones_raw: 'LC4(1), C10(1)', precio_total: '$288.000', deposito: '$288.000' }),
    fullDay('CB-FD-A', 'Amanda Full Day', 'CD5', '2026-09-28'),
    fullDay('CB-FD-B', 'Beatriz Full Day', 'CD7', '2026-09-29'),
    fullDay('CB-FD-C', 'Carla Full Day', 'CD8', '2026-09-30'),
    fullDay('CB-FD-D', 'Diana Full Day', 'CD9', '2026-10-01', { precio_total: '$150.000', productos: 'Almuerzo ficticio' }),
    fullDay('CB-FD-REV', 'Nombre Cloudbeds Distinto', 'LC1', '2026-10-02')
  ].map(item => pdf.normalizar(item));
  const reservas = [
    reserva('r-hector', null, 'Héctor Ficticio'),
    reserva('r-elena', null, 'Elena Ficticia'),
    reserva('r-ok', 'CB-OK', 'Amelia Ficticia'),
    reserva('r-revision', 'CB-REV', 'Bruno Ficticio'),
    reserva('r-cancel', 'CB-CANCEL', 'Camila Ficticia'),
    reserva('r-multi', 'CB-MULTI', 'Grupo Ficticio'),
    reservaFullDay('r-fd-a', 'Amanda Full Day', 5, '2026-09-28'),
    reservaFullDay('r-fd-b', 'Beatriz Full Day', 7, '2026-09-29'),
    reservaFullDay('r-fd-c', 'Carla Full Day', 8, '2026-09-30'),
    reservaFullDay('r-fd-d', 'Diana Full Day', 9, '2026-10-01'),
    reservaFullDay('r-fd-revision', 'Nombre Proyecto H', 1, '2026-10-02')
  ];
  const saldos = [
    { reserva_id: 'r-hector', total_alojamiento: 160000 },
    { reserva_id: 'r-elena', total_alojamiento: 300000 },
    { reserva_id: 'r-ok', total_alojamiento: 144000 },
    { reserva_id: 'r-revision', total_alojamiento: 160000 },
    { reserva_id: 'r-cancel', total_alojamiento: 160000 },
    { reserva_id: 'r-multi', total_alojamiento: 300000 },
    { reserva_id: 'r-fd-a', total_alojamiento: 160000, pagado_alojamiento: 120000, saldo_alojamiento: 40000 },
    { reserva_id: 'r-fd-b', total_alojamiento: 150000, pagado_alojamiento: 120000, saldo_alojamiento: 30000 },
    { reserva_id: 'r-fd-c', total_alojamiento: 120000, pagado_alojamiento: 120000, saldo_alojamiento: 0 },
    { reserva_id: 'r-fd-d', total_alojamiento: 160000, pagado_alojamiento: 120000, saldo_alojamiento: 40000 },
    { reserva_id: 'r-fd-revision', total_alojamiento: 160000, pagado_alojamiento: 120000, saldo_alojamiento: 40000 }
  ];
  const informe = pdf.comparar(entradas, reservas, saldos);
  const modelo = await tarifas.preparar(informe, window.haikuSupabase);
  const mensajes = document.getElementById('haiku-asistente-mensajes');
  const mensaje = document.createElement('div');
  mensaje.className = 'haiku-asistente-mensaje haiku-asistente-mensaje--asistente';
  mensajes.appendChild(mensaje);
  tarifas.montar(mensaje, modelo);
  window.HAIKU_ASISTENTE.abrir();
  const campo = document.getElementById('haiku-asistente-texto');
  campo.value = 'Borrador ficticio: revisar descuento con recepción';
  mensajes.scrollTop = 180;
  document.querySelector('[data-reserva-cerrar]').addEventListener('click', () => window.HAIKU_PANELES_V1.cerrarInspector());
  document.querySelectorAll('[data-demo-ver-reserva]').forEach(boton => boton.addEventListener('click', () => {
    window.HAIKU_PANELES_V1.abrirReserva(boton.dataset.demoVerReserva, boton);
  }));
  if (new URLSearchParams(window.location.search).get('inspector') === '1') {
    await window.HAIKU_PANELES_V1.abrirReserva('r-hector');
  }
  window.DEMO_CLOUDBEDS_2E = { informe, modelo };
}()).catch(error => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="demo-error">${String(error?.stack || error)}</pre>`);
});
