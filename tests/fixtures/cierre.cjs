const { readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const scripts = ['cierre-plantilla-v1', 'sites-cierre-v1', 'cierre', 'supabase-cierre-v1', 'supabase-cierre-final-v1'];

async function prepararCierre(page, fecha = '2026-11-12') {
    await page.evaluate(fecha => {
        const unidades = Array.from({ length: 11 }, (_, i) => ({ numero: i + 1, nombre: 'Cabaña ' + (i + 1), activa: true }));
        const previa = '2026-11-11';
        const modelo = {
            llamadas: [], avisos: [], confirmaciones: [], abiertas: [],
            respaldos: { [fecha]: { 'manager-caja': [{ url: 'https://cierre.test/adjunto-caja-guardado.png' }] } },
            permitir: true, confirmar: true, motivo: 'Corrección de prueba', demora: 0,
            remoto: {
                [fecha]: { estado: 'borrador', pendientes: 2, novedades: '', resumen_entrega: '', respuestas: [] },
                [previa]: {
                    estado: 'cerrado_con_pendientes', pendientes: 3, novedades: 'Novedad de ayer',
                    resumen_entrega: 'Entrega de ayer', cerrado_en: '2026-11-12T02:00:00Z',
                    respuestas: [{
                        estado: 'confirmado', valor: 'no-hay', cierre_checklist_items: { codigo: 'salida_temprana' }
                    }, {
                        estado: 'no_corresponde', valor: null, cierre_checklist_items: { codigo: 'cabana_ocupada' },
                        cabanas: { numero: 12, nombre: 'Cabaña histórica' }
                    }]
                }
            }
        };
        const local = {};
        const dia = fecha => modelo.remoto[fecha] ||= {
            estado: 'borrador', pendientes: 2, novedades: '', resumen_entrega: '', respuestas: []
        };
        function estado(fecha) {
            const datos = dia(fecha);
            const total = 30;
            return {
                fecha_operativa: fecha, cierre_estado: datos.estado, pendientes: datos.pendientes,
                completados: total - datos.pendientes, total_requeridos: total,
                porcentaje: Math.round((total - datos.pendientes) / total * 100),
                resumen_entrega: datos.resumen_entrega, cerrado_en: datos.cerrado_en
            };
        }

        window.__cierre = modelo;
        window.fechaSeleccionada = fecha;
        window.obtenerDatosDia = fecha => local[fecha] ||= {
            cabanas: { 1: { estadoRevision: 'lista' }, 2: { estadoRevision: 'con-detalles' } }
        };
        window.guardarDatos = () => {};
        window.haikuSesion = { permisos: ['cierres.reabrir'], roles: ['administrador'] };
        window.haikuTienePermiso = () => modelo.permitir;
        window.HAIKU_CABANAS_SITES_V1 = {
            estadoFinal: datos => datos.estadoRevision,
            abrir: numero => {
                modelo.abiertas.push(numero);
                document.getElementById('cabinsDetail').hidden = false;
            },
            cerrar: () => { document.getElementById('cabinsDetail').hidden = true; }
        };
        window.HAIKU_DIALOGOS = {
            aviso: mensaje => modelo.avisos.push(mensaje),
            confirmar: async mensaje => { modelo.confirmaciones.push(mensaje); return modelo.confirmar; },
            solicitar: async () => modelo.motivo
        };
        window.haikuSupabase = {
            async rpc(nombre, args) {
                modelo.llamadas.push({ nombre, args });
                const fecha = args.p_fecha;
                const datos = dia(fecha);
                if (nombre === 'haiku_asegurar_cierre_dia') return { data: { cierre_id: fecha } };
                if (nombre === 'haiku_estado_cierre_dia') return { data: estado(fecha) };
                if (nombre === 'haiku_guardar_respuesta_cierre') {
                    if (modelo.demora) await new Promise(resolve => setTimeout(resolve, modelo.demora));
                    const { p_codigo, p_estado, p_valor, p_cabana_numero } = args;
                    datos.respuestas = datos.respuestas.filter(r => r.cierre_checklist_items.codigo !== p_codigo ||
                        (r.cabanas?.numero ?? null) !== p_cabana_numero);
                    datos.respuestas.push({
                        estado: p_estado, valor: p_valor, cierre_checklist_items: { codigo: p_codigo },
                        cabanas: unidades.find(u => u.numero === p_cabana_numero)
                    });
                    return { data: {} };
                }
                if (nombre === 'haiku_guardar_novedades_cierre') {
                    datos.novedades = args.p_novedades;
                    return { data: {} };
                }
                if (nombre === 'haiku_cerrar_turno_dia') {
                    datos.estado = datos.pendientes ? 'cerrado_con_pendientes' : 'cerrado';
                    datos.resumen_entrega = args.p_resumen_entrega;
                    datos.cerrado_en = '2026-11-12T23:00:00Z';
                    return { data: estado(fecha) };
                }
                if (nombre === 'haiku_reabrir_cierre_dia') {
                    datos.estado = 'reabierto';
                    return { data: estado(fecha) };
                }
                throw Error('RPC inesperado: ' + nombre);
            },
            from(tabla) {
                let fecha;
                function data() {
                    if (tabla === 'cabanas') return unidades;
                    if (tabla === 'cierre_respuestas') return dia(fecha).respuestas;
                    if (tabla === 'cierres_turno') return dia(fecha);
                    throw Error('Tabla inesperada: ' + tabla);
                }
                const consulta = {
                    select() { return consulta; },
                    eq(campo, valor) { if (campo !== 'activa') fecha = valor; return consulta; },
                    order() { return consulta; },
                    single() { return Promise.resolve({ data: structuredClone(data()) }); },
                    then(resolve, reject) {
                        return Promise.resolve().then(() => ({ data: structuredClone(data()) })).then(resolve, reject);
                    }
                };
                return consulta;
            }
        };
    }, fecha);
    for (const script of scripts) await page.addScriptTag({ content: read('js/' + script + '.js') });
    await page.evaluate(async () => {
        window.HAIKU_CIERRE_EVIDENCIAS_V1 = {
            listar: async (fecha, id) => window.__cierre.respaldos[fecha]?.[id] || [],
            obtenerLocal: async () => null
        };
        window.guardarEvidencia = async (fecha, id, imagen) => {
            const respaldos = window.__cierre.respaldos[fecha] ||= {};
            const archivos = respaldos[id] ||= [];
            archivos.unshift({ url: 'https://cierre.test/adjunto-' + id + '-' + (archivos.length + 1) + '.png' });
            window.__cierre.ultimaImagen = imagen;
        };
        await Promise.all([haikuCargarCierreSupabase(fechaSeleccionada), haikuRefrescarEstadoCierre()]);
    });
}

module.exports = { prepararCierre };
