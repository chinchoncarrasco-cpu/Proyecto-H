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
  const manual = base('CB-REV', 'Bruno Ficticio'); delete manual.productos;
  const entradas = [
    base('CB-HECTOR', 'Héctor Ficticio'),
    base('CB-ELENA', 'Elena Ficticia', { precio_total: '$318.000', total_habitacion: '$242.016', deposito: '$288.000', productos: 'Tinaja tipo Jacuzzi' }),
    base('CB-OK', 'Amelia Ficticia'),
    manual,
    base('CB-CANCEL', 'Camila Ficticia', { estado: 'Cancelada', precio_total: '$0' }),
    base('CB-RODRIGO', 'Rodrigo Control'),
    base('CB-MULTI', 'Grupo Ficticio', { habitaciones_raw: 'LC4(1), C10(1)', precio_total: '$288.000', deposito: '$288.000' })
  ].map(item => pdf.normalizar(item));
  const reservas = [
    reserva('r-hector', null, 'Héctor Ficticio'),
    reserva('r-elena', null, 'Elena Ficticia'),
    reserva('r-ok', 'CB-OK', 'Amelia Ficticia'),
    reserva('r-revision', 'CB-REV', 'Bruno Ficticio'),
    reserva('r-cancel', 'CB-CANCEL', 'Camila Ficticia'),
    reserva('r-multi', 'CB-MULTI', 'Grupo Ficticio')
  ];
  const saldos = [
    { reserva_id: 'r-hector', total_alojamiento: 160000 },
    { reserva_id: 'r-elena', total_alojamiento: 300000 },
    { reserva_id: 'r-ok', total_alojamiento: 144000 },
    { reserva_id: 'r-revision', total_alojamiento: 160000 },
    { reserva_id: 'r-cancel', total_alojamiento: 160000 },
    { reserva_id: 'r-multi', total_alojamiento: 300000 }
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
  if (new URLSearchParams(window.location.search).get('inspector') === '1') {
    await window.HAIKU_PANELES_V1.abrirReserva('r-hector');
  }
  window.DEMO_CLOUDBEDS_2E = { informe, modelo };
}()).catch(error => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="demo-error">${String(error?.stack || error)}</pre>`);
});
