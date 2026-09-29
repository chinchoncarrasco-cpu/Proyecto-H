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
    estadias: [{ id: `e-${id}`, fecha_ingreso: '2026-09-20', fecha_salida: '2026-09-21',
      tipo_estadia: 'alojamiento', adultos: 2, ninos: 0, mascotas: 0, cabanas: { numero: 5 } }], ...extra
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
  const llamadas = [];
  window.haikuSupabase = {
    from(tabla) {
      const data = tabla === 'reservas' ? reservas : tabla === 'vista_saldos_alojamiento_reserva' ? saldos : [];
      return {
        select() { return this; },
        order() { return this; },
        async range(inicio, fin) {
          llamadas.push(`select:${tabla}`);
          return { data: data.slice(inicio, fin + 1) };
        }
      };
    },
    async rpc(nombre, parametros = {}) {
      llamadas.push(`rpc:${nombre}`);
      if (nombre === tarifas.RPC_CAPACIDAD) {
        return { data: { version: tarifas.VERSION_V32, writer_disponible: true, servicios_separados: true } };
      }
      if (nombre === tarifas.RPC_PREVIEW) {
        const reservaActual = reservas.find(item => item.id === parametros.p_reserva_id);
        const estadia = reservaActual?.estadias?.find(item => item.id === parametros.p_estadia_id);
        const saldo = saldos.find(item => item.reserva_id === parametros.p_reserva_id);
        const totalActual = Number(saldo?.total_alojamiento);
        const pagado = Number(saldo?.pagado_alojamiento || 0);
        const objetivo = Number(parametros.p_total_objetivo);
        const elegible = Boolean(reservaActual && estadia && Number.isSafeInteger(objetivo) && objetivo > 0 && pagado <= objetivo);
        const filaInforme = informe.filas.find(item => item.propuesta?.reserva_id === parametros.p_reserva_id);
        const servicios = Number(filaInforme?.propuesta?.componente_no_alojamiento_observable || 0);
        const tieneServicios = servicios > 0;
        return { data: {
          solo_lectura: true,
          version: tarifas.VERSION_PREVIEW,
          autoridad_financiera_version: tarifas.VERSION_V32,
          reserva_id: parametros.p_reserva_id,
          estadia_id: parametros.p_estadia_id,
          tipo_estadia: estadia?.tipo_estadia || null,
          cabana_numero: estadia?.cabanas?.numero || null,
          total_actual: totalActual,
          total_objetivo: objetivo,
          pagado_actual: pagado,
          saldo_actual: Number(saldo?.saldo_alojamiento ?? totalActual - pagado),
          saldo_esperado: objetivo - pagado,
          ...(elegible && tieneServicios ? {
            servicios_sin_cambios: true,
            total_servicios_sin_cambio: servicios,
            total_reserva_actual: totalActual + servicios,
            total_reserva_esperado: objetivo + servicios
          } : {}),
          elegible,
          motivo_bloqueo: elegible ? null : 'La reserva ficticia requiere revisión manual.'
        } };
      }
      if (nombre === tarifas.RPC_WRITER) {
        const operaciones = Array.isArray(parametros.p_operaciones) ? parametros.p_operaciones : [];
        operaciones.forEach(operacion => {
          const saldo = saldos.find(item => item.reserva_id === operacion.reserva_id);
          if (!saldo) return;
          saldo.total_alojamiento = Number(operacion.total_objetivo);
          saldo.saldo_alojamiento = saldo.total_alojamiento - Number(saldo.pagado_alojamiento || 0);
        });
        return { data: { ok: true, cambios: operaciones.length, resultados: operaciones.map(() => ({ ok: true })) } };
      }
      throw new Error(`RPC no permitida en demo: ${nombre}`);
    }
  };
  const informe = pdf.comparar(entradas, reservas, saldos);
  const modelo = await tarifas.preparar(informe, window.haikuSupabase);
  const mensajes = document.getElementById('haiku-asistente-mensajes');
  const mensaje = document.createElement('div');
  mensaje.className = 'haiku-asistente-mensaje haiku-asistente-mensaje--asistente';
  mensajes.appendChild(mensaje);
  tarifas.montar(mensaje, modelo, window.haikuSupabase);
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
  window.DEMO_CLOUDBEDS_2E = { informe, modelo, llamadas, reservas, saldos };
}()).catch(error => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="demo-error">${String(error?.stack || error)}</pre>`);
});
