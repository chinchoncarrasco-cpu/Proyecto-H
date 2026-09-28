// Mocks exclusivos de esta página de prueba. No se carga ningún cliente Supabase.
(() => {
    'use strict';
    const reservaId = '00000000-0000-4000-8000-000000000001';
    const estadiaId = '00000000-0000-4000-8000-000000000002';
    const modeloReal = window.HAIKU_RESERVA_ESTADO_MANUAL_V1;
    function inicial() {
        return {
            reserva: { id: reservaId, codigo_haiku: 'H-TEST-001', titular_nombre: 'Familia TEST',
                estado_reserva: 'confirmada', telefono_contacto: 'Teléfono ficticio',
                titular_numero_documento: 'TEST-000', observaciones: 'Reserva ficticia para revisión visual.',
                bove_cierre: 'TEST-BOVE-001', bove_checkout: null },
            estadias: [{ id: estadiaId, reserva_id: reservaId, cabana_numero: 2,
                estado_estadia: 'confirmada', tipo_estadia: 'alojamiento',
                fecha_ingreso: '2026-09-27', fecha_salida: '2026-09-29', adultos: 2, ninos: 1,
                checkin_realizado_en: null, checkout_realizado_en: null }],
            huespedes: [{ es_titular: true, nombre: 'Familia', apellido: 'TEST' },
                { nombre: 'Acompañante', apellido: 'TEST' }, { nombre: 'Niño', apellido: 'TEST' }],
            servicios: [{ fecha_servicio: '2026-09-27', hora_inicio: '19:15:00',
                estado_servicio: 'programado', catalogo_servicios: { nombre: 'Tinaja TEST' } }],
            pagos: [{ estado: 'confirmado', tipo_movimiento: 'pago', etapa_operativa: 'checkin', monto: 150000 }],
            cargos: [{ estado: 'activo', tipo_cargo: 'alojamiento', monto: 200000, saldo_cargo: 50000 },
                { estado: 'activo', tipo_cargo: 'servicio', monto: 22000, saldo_cargo: 22000 }],
            notas: [{ texto: 'Nota ficticia para el turno: revisar el cambio de estado.', fecha_operacion: '2026-09-27' }],
            solicitudes: [{ descripcion: 'Desayuno TEST sin frutos secos', creado_en: '2026-09-27T12:00:00Z' }]
        };
    }
    let ficha = inicial();
    const cambios = [];
    window.fechaSeleccionada = '2026-09-27';
    window.haikuSesion = { usuario: { id: 'operador-test' } };
    window.haikuTienePermiso = permiso => ['reservas.ver', 'reservas.editar', 'reservas.cancelar'].includes(permiso);
    // Excepción visual explícita: todas las transiciones, sin modificar el modelo
    // real en disco ni simular que las reglas operativas hayan sido comprobadas.
    window.HAIKU_RESERVA_ESTADO_MANUAL_V1 = Object.freeze({
        ...modeloReal,
        opciones(fichaActual, estadia) {
            const actual = modeloReal.actual(fichaActual, estadia);
            return modeloReal.estados.map(e => ({ ...e, actual: e.valor === actual,
                motivo: e.valor === actual ? 'Estado actual' : '' }));
        }
    });
    window.haikuLeerFichaSupabaseV2 = async id => {
        if (id !== reservaId) throw new Error('Sólo está disponible la reserva TEST.');
        return structuredClone(ficha);
    };
    // El nombre rpc es la interfaz que espera el drawer; ésta es una función
    // JavaScript local en memoria, sin fetch, SDK, endpoint ni llamada remota.
    window.haikuSupabase = { async rpc(nombre, payload) {
        if (nombre !== 'haiku_cambiar_estado_reserva_manual_v1' ||
            payload.p_reserva_id !== reservaId || payload.p_estadia_id !== estadiaId ||
            !modeloReal.estados.some(e => e.valor === payload.p_estado)) {
            return { error: { code: 'P0001', message: 'Operación ajena a esta demo.' } };
        }
        if (JSON.stringify(payload.p_esperado) !== JSON.stringify(modeloReal.esperado(ficha))) {
            return { error: { code: '40001', message: 'La reserva simulada cambió.' } };
        }
        const anterior = modeloReal.actual(ficha, ficha.estadias[0]);
        const destino = payload.p_estado;
        ficha.reserva.estado_reserva = destino;
        const estadia = ficha.estadias[0];
        estadia.estado_estadia = destino;
        estadia.checkin_realizado_en = ['hospedada', 'checked_out'].includes(destino) ? '2026-09-27T15:00:00Z' : null;
        estadia.checkout_realizado_en = destino === 'checked_out' ? '2026-09-29T15:00:00Z' : null;
        cambios.push(`${modeloReal.etiqueta(anterior)} → ${modeloReal.etiqueta(destino)} · simulado`);
        return { data: { ok: true, estado: destino }, error: null };
    } };

    function pintarTarjeta() {
        document.querySelector('[data-demo-badge]').textContent = modeloReal.etiqueta(modeloReal.actual(ficha, ficha.estadias[0]));
        document.querySelector('[data-demo-contador]').textContent = `${cambios.length} ${cambios.length === 1 ? 'cambio simulado' : 'cambios simulados'}`;
        const lista = document.querySelector('[data-demo-log]');
        lista.replaceChildren(...cambios.slice().reverse().map(texto => {
            const item = document.createElement('li'); item.textContent = texto; return item;
        }));
    }
    window.haikuSincronizarReservasSupabase = async () => pintarTarjeta();
    document.addEventListener('DOMContentLoaded', () => {
        const abrir = document.getElementById('demo-abrir');
        abrir.addEventListener('click', async () => {
            const ok = await window.HAIKU_RESUMEN_RESERVA_SITES_V1.abrirPorId(reservaId, abrir,
                { estadiaId, numeroCabana: 2 });
            const error = document.querySelector('[data-demo-error]');
            error.hidden = ok;
            error.textContent = ok ? '' : 'No se pudo abrir la reserva simulada.';
            if (!ok) return;
            const footer = document.querySelector('#sites-resumen-reserva-drawer .sites-resumen-drawer-footer');
            if (!footer.querySelector('.demo-drawer-notice')) {
                const aviso = document.createElement('p'); aviso.className = 'demo-drawer-notice';
                aviso.textContent = 'DEMO VISUAL · Confirmación simulada en memoria. Sin validación operativa ni conexión a Supabase.';
                footer.appendChild(aviso);
            }
        });
        document.getElementById('demo-reiniciar').addEventListener('click', () => {
            window.HAIKU_RESUMEN_RESERVA_SITES_V1.cerrar();
            ficha = inicial(); cambios.length = 0; pintarTarjeta();
        });
        pintarTarjeta();
        window.__reservaEstadoDemoLista = true;
    });
})();
