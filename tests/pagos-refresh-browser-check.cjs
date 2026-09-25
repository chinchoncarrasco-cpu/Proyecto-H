// Harness local de DOM real; no usa credenciales ni datos de Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
    const ejecutable = [chromium.executablePath(),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
        .find(ruta => fs.existsSync(ruta));
    if (!ejecutable) throw new Error('No hay Chromium o Edge disponible para el harness.');
    const browser = await chromium.launch({ headless: true, executablePath: ejecutable });
    try {
        const page = await browser.newPage();
        const errores = [];
        page.on('pageerror', error => errores.push(error.message));
        await page.setContent(`<html class="haiku-pagos-pendiente"><head>
            <style>html.haiku-pagos-pendiente .sites-pagos-section{visibility:hidden}</style>
            </head><body><button data-seccion="pagos" id="entrar">Pagos</button>
            <section id="seccion-pagos"><p id="pagos-refresh-estado">Cargando Pagos…</p>
            <span id="sites-pagos-fecha"></span>
            ${['abonos', 'checkin', 'checkout', 'webpay'].map(nombre => `
                <section class="sites-pagos-section"><strong id="pagos-contador-${nombre}">1</strong>
                <div id="pagos-lista-${nombre}"><p>Anterior ${nombre}</p></div></section>`).join('')}
            </section></body></html>`);
        await page.evaluate(() => {
            window.fechaSeleccionada = '2026-09-25';
            window.haikuSesion = { auth: { id: 'usuario-prueba' } };
            window.haikuTienePermiso = () => true;
            window.haikuMigrarServiciosLegacySupabase = async () => {};
            window.__saldo = 16000;
            window.__checkoutPendiente = 5000;
            window.__fallarCandidatos = false;
            window.__fallarCredito = false;
            window.__fallarSaldos = false;
            window.__boveCierre = null;
            window.__boveCheckout = null;
            window.__grupo = false;
            window.__holdCheckout = null;
            window.__crearPuerta = () => {
                let resolver;
                const promesa = new Promise(fin => { resolver = fin; });
                return { promesa, resolver };
            };
            window.__holdCheckout = window.__crearPuerta();
            const reserva = { id: 'r1', grupo_reserva_id: null, titular_nombre: 'Yervic Enrique',
                codigo_haiku: 'H-1', estado_reserva: 'confirmada', bove_cierre: null,
                bove_checkout: null };
            const pagoAbono = { id: 'p1', reserva_id: 'r1', monto: 144000,
                medio_pago: 'transferencia', fecha_pago: '2026-09-24T12:00:00Z',
                estado: 'confirmado', etapa_operativa: 'abono', tipo_movimiento: 'pago',
                verificado_por: null, datos_origen: {} };
            const pagoAbono2 = { ...pagoAbono, id: 'p2', monto: 10000,
                fecha_pago: '2026-09-24T13:00:00Z' };
            const pagoWebpay = { id: 'wp1', monto: 12000, medio_pago: 'webpay_credito',
                estado: 'pendiente_asociacion', tipo_movimiento: 'pago',
                fecha_pago: '2026-09-20T12:00:00Z',
                datos_origen: { cabana_referencia: 2 }, pagador_nombre: 'Invitado' };
            function datos(tabla, filtros, seleccion) {
                if (tabla === 'reservas') {
                    const r1 = { ...reserva, grupo_reserva_id: window.__grupo ? 'g1' : null,
                        bove_cierre: window.__boveCierre, bove_checkout: window.__boveCheckout };
                    return window.__grupo ? [r1, { ...r1, id: 'r2', grupo_reserva_id: 'g1' }] : [r1];
                }
                if (tabla === 'reserva_estadias') {
                    const e1 = { reserva_id: 'r1', cabana_id: 'c1', fecha_ingreso: '2026-09-25',
                        fecha_salida: '2026-09-26', estado_estadia: 'confirmada' };
                    return window.__grupo ? [e1, { ...e1, reserva_id: 'r2', cabana_id: 'c2' }] : [e1];
                }
                if (tabla === 'cabanas') return window.__grupo
                    ? [{ id: 'c1', numero: 2 }, { id: 'c2', numero: 3 }] : [{ id: 'c1', numero: 2 }];
                if (tabla === 'pagos') {
                    if (filtros.estado === 'pendiente_asociacion') return [pagoWebpay];
                    if (filtros.etapa_operativa === 'otro') return [];
                    if (window.__grupo) return [
                        { ...pagoAbono, monto: 10000, pago_grupo_id: 'pg1' },
                        pagoAbono2,
                        { ...pagoAbono, id: 'p3', reserva_id: 'r2', monto: 5000,
                            pago_grupo_id: 'pg1' }
                    ];
                    return [pagoAbono, pagoAbono2];
                }
                if (tabla === 'vista_saldos_alojamiento_reserva') {
                    const s1 = { reserva_id: 'r1',
                    total_alojamiento: 160000, pagado_alojamiento: 160000 - window.__saldo,
                    saldo_alojamiento: window.__saldo };
                    return window.__grupo ? [s1, { ...s1, reserva_id: 'r2',
                        total_alojamiento: 30000, pagado_alojamiento: 20000,
                        saldo_alojamiento: 10000 }] : [s1];
                }
                if (tabla === 'vista_estado_cargos') return seleccion.includes('saldo_cargo')
                    ? [{ cargo_id: 'c1', reserva_id: 'r1', servicio_id: 's1', tipo_cargo: 'servicio',
                        concepto: 'Tinaja', monto: 20000, saldo_cargo: window.__checkoutPendiente,
                        estado: 'activo' },
                       { cargo_id: 'anulado', reserva_id: 'r1', servicio_id: 's1',
                         tipo_cargo: 'servicio', concepto: 'Cancelado', monto: 999999,
                         saldo_cargo: 999999, estado: 'anulado' }]
                    : [{ reserva_id: 'r1', monto: 20000, tipo_cargo: 'servicio', estado: 'activo' },
                       { reserva_id: 'r1', monto: 999999, tipo_cargo: 'servicio', estado: 'anulado' }];
                if (tabla === 'servicios') return [{ id: 's1', reserva_id: 'r1',
                    fecha_servicio: '2026-09-25', hora_inicio: '19:00',
                    catalogo_servicios: { nombre: 'Tinaja' } }];
                if (tabla === 'usuarios') return [];
                return [];
            }
            window.haikuSupabase = {
                async rpc(nombre) {
                    if (nombre === 'haiku_operacion_dia' && window.__grupo) return { data: [
                        { numero: 2, estado_operativo: 'libre-ingresa', ingreso_reserva_id: 'r1',
                            ingreso_titular: 'Yervic Enrique' },
                        { numero: 3, estado_operativo: 'libre-ingresa', ingreso_reserva_id: 'r2',
                            ingreso_titular: 'Yervic Enrique' }
                    ], error: null };
                    if (nombre === 'haiku_operacion_dia') return { data: [{ numero: 2,
                        estado_operativo: 'fullday', fullday_titular: 'Yervic Enrique',
                        fullday_reserva_id: 'r1', fullday_estadia_id: 'e1' }], error: null };
                    if (nombre === 'haiku_finanzas_grupo') return { data: {
                        total_alojamiento: 190000, saldo_alojamiento: 15000,
                        miembros: [{ cabana: 2, reserva_id: 'r1' },
                            { cabana: 3, reserva_id: 'r2' }], servicios_pendientes: 0
                    }, error: null };
                    if (nombre === 'haiku_saldo_favor_unidad' && window.__fallarCredito)
                        return { data: null, error: new Error('crédito temporalmente no disponible') };
                    if (nombre === 'haiku_saldo_favor_unidad') return { data: {
                        saldo_a_favor: 0, fuentes: [], cargos_servicio: [] }, error: null };
                    return { data: {}, error: null };
                },
                from(tabla) {
                    const filtros = {};
                    let seleccion = '';
                    const q = {
                        select(valor) { seleccion = valor; return q; },
                        eq(campo, valor) { filtros[campo] = valor; return q; },
                        neq() { return q; },
                        in(campo, valor) { filtros[campo] = valor; return q; },
                        order() { return q; },
                        then(fin, error) {
                            const lectura = async () => {
                                if (tabla === 'vista_estado_cargos' && seleccion.includes('saldo_cargo') &&
                                    window.__holdCheckout) await window.__holdCheckout.promesa;
                                if (tabla === 'reservas' && seleccion.includes('estado_reserva') &&
                                    window.__fallarCandidatos) return { data: null,
                                        error: new Error('candidatos no disponibles') };
                                if (tabla === 'vista_saldos_alojamiento_reserva' &&
                                    window.__fallarSaldos) return { data: null,
                                        error: new Error('saldos no disponibles') };
                                return { data: datos(tabla, filtros, seleccion).filter(fila =>
                                    Object.entries(filtros).every(([campo, valor]) => Array.isArray(valor)
                                        ? valor.includes(fila[campo]) : fila[campo] === valor)), error: null };
                            };
                            return lectura().then(fin, error);
                        }
                    };
                    return q;
                },
                channel() { return { on() { return this; }, subscribe() { return this; } }; }
            };
            window.HAIKU_SITES_PAGOS_V1 = { publicar(filas) {
                document.getElementById('sites-pagos-fecha').textContent = window.fechaSeleccionada;
                window.__sitesPublicaciones = (window.__sitesPublicaciones || 0) + 1;
                window.__identidad = filas[0].fullday_reserva_id;
            } };
        });
        for (const nombre of [
            'supabase-abonos-verificacion-v2', 'supabase-pagos-checkin-v5',
            'supabase-pagos-checkout-v1', 'supabase-webpay-v1',
            'supabase-pagos-checkin-grupo-v2', 'supabase-saldo-favor-v2',
            'supabase-pagos-refresh-v1'
        ]) await page.addScriptTag({ path: path.join(__dirname, '../js', `${nombre}.js`) });
        await page.evaluate(() => {
            document.getElementById('seccion-pagos').classList.add('activa');
            document.getElementById('entrar').click();
        });
        await page.waitForTimeout(80);
        const previo = await page.evaluate(() => ({
            pendiente: document.documentElement.classList.contains('haiku-pagos-pendiente'),
            publicaciones: window.HAIKU_PAGOS_REFRESH_V1.publicaciones(),
            abonos: document.getElementById('pagos-lista-abonos').textContent
        }));
        assert.equal(previo.pendiente, true);
        assert.equal(previo.publicaciones, 0);
        assert.match(previo.abonos, /Anterior abonos/);
        await page.evaluate(() => { window.__holdCheckout.resolver(); window.__holdCheckout = null; });
        await page.waitForFunction(() => window.HAIKU_PAGOS_REFRESH_V1.publicaciones() === 1);
        const primera = await page.evaluate(() => ({
            saldo: document.getElementById('pagos-lista-checkin').textContent,
            checkout: document.getElementById('pagos-lista-checkout').textContent,
            webpay: document.getElementById('pagos-lista-webpay').textContent,
            fecha: document.getElementById('sites-pagos-fecha').textContent,
            identidad: window.__identidad,
            publicacionesSites: window.__sitesPublicaciones,
            webpayScope: window.HAIKU_PAGOS_REFRESH_V1.snapshot().webpayScope
        }));
        assert.match(primera.saldo, /\$16\.000/);
        assert.match(primera.checkout, /\$5\.000/);
        assert.doesNotMatch(primera.checkout, /Cancelado|999\.999/);
        assert.match(primera.webpay, /Invitado/);
        assert.equal(primera.fecha, '2026-09-25');
        assert.equal(primera.identidad, 'r1');
        assert.equal(primera.publicacionesSites, 1);
        assert.equal(primera.webpayScope, 'global');
        assert.equal(await page.locator('#pagos-lista-abonos [data-haiku-verificar-abono-v2]').count(), 2);
        await page.evaluate(() => {
            window.__holdCheckout = window.__crearPuerta();
            window.__saldo = 8000;
            window.__checkoutPendiente = 2000;
            window.__refreshPagos = window.HAIKU_PAGOS_REFRESH_V1.solicitar({ tipo: 'usuario', nombre: 'refresh' });
        });
        await page.waitForTimeout(80);
        const durante = await page.evaluate(() => ({
            saldo: document.getElementById('pagos-lista-checkin').textContent,
            publicaciones: window.HAIKU_PAGOS_REFRESH_V1.publicaciones()
        }));
        assert.match(durante.saldo, /\$16\.000/);
        assert.equal(durante.publicaciones, 1);
        await page.evaluate(() => { window.__holdCheckout.resolver(); window.__holdCheckout = null; });
        await page.waitForFunction(() => window.HAIKU_PAGOS_REFRESH_V1.publicaciones() === 2);
        await page.waitForFunction(() => Number.isFinite(
            window.HAIKU_PAGOS_REFRESH_V1.perfil()?.tVisibleMs));
        const final = await page.evaluate(() => ({
            saldo: document.getElementById('pagos-lista-checkin').textContent,
            checkout: document.getElementById('pagos-lista-checkout').textContent,
            sitios: window.__sitesPublicaciones,
            perfil: window.HAIKU_PAGOS_REFRESH_V1.perfil()
        }));
        assert.match(final.saldo, /\$8\.000/);
        assert.match(final.checkout, /\$2\.000/);
        assert.equal(final.sitios, 2);
        assert.equal(final.perfil.publicaciones, 1);
        await page.evaluate(() => {
            window.__fallarCandidatos = true;
            window.__fallarCredito = true;
            window.__refreshOpcional = window.HAIKU_PAGOS_REFRESH_V1.solicitar({
                tipo: 'usuario', nombre: 'opcionales ausentes' });
        });
        await page.waitForFunction(() => window.HAIKU_PAGOS_REFRESH_V1.publicaciones() === 3);
        const opcionales = await page.evaluate(() => ({
            webpay: document.getElementById('pagos-lista-webpay').textContent,
            webpayDeshabilitado: document.querySelector('[data-webpay-confirmar]')?.disabled,
            checkin: document.getElementById('pagos-lista-checkin').textContent,
            publicaciones: window.HAIKU_PAGOS_REFRESH_V1.publicaciones()
        }));
        assert.match(opcionales.webpay, /Candidatos no disponibles/);
        assert.equal(opcionales.webpayDeshabilitado, true);
        assert.match(opcionales.checkin, /Saldo a favor no disponible/);
        await page.evaluate(() => {
            window.__fallarSaldos = true;
            window.__refreshObligatorio = window.HAIKU_PAGOS_REFRESH_V1.solicitar({
                tipo: 'usuario', nombre: 'autoridad no disponible' });
        });
        await page.evaluate(() => window.__refreshObligatorio);
        assert.equal(await page.evaluate(() => window.HAIKU_PAGOS_REFRESH_V1.publicaciones()), 3);
        assert.match(await page.locator('#pagos-lista-checkin').textContent(), /\$8\.000/);
        await page.evaluate(() => {
            window.__fallarSaldos = false;
            window.__fallarCandidatos = false;
            window.__fallarCredito = false;
            window.__saldo = 0;
            window.__checkoutPendiente = 0;
            window.__boveCierre = 'BOVE-ALOJAMIENTO';
            window.__boveCheckout = 'BOVE-CHECKOUT';
            window.__refreshPagado = window.HAIKU_PAGOS_REFRESH_V1.solicitar({
                tipo: 'usuario', nombre: 'saldo cero y BOVE' });
        });
        await page.waitForFunction(() => window.HAIKU_PAGOS_REFRESH_V1.publicaciones() === 4);
        const pagado = await page.evaluate(() => ({
            checkin: document.getElementById('pagos-lista-checkin').textContent,
            checkout: document.getElementById('pagos-lista-checkout').textContent,
            webpay: document.getElementById('pagos-lista-webpay').textContent
        }));
        assert.match(pagado.checkin, /BOVE-ALOJAMIENTO/);
        assert.match(pagado.checkout, /BOVE-CHECKOUT/);
        assert.match(pagado.webpay, /Invitado/);
        await page.evaluate(() => {
            window.__grupo = true;
            window.__saldo = 5000;
            window.__refreshGrupo = window.HAIKU_PAGOS_REFRESH_V1.solicitar({
                tipo: 'usuario', nombre: 'pago distribuido' });
        });
        await page.waitForFunction(() => window.HAIKU_PAGOS_REFRESH_V1.publicaciones() === 5);
        assert.equal(await page.locator('#pagos-lista-abonos .haiku-abono-v2-unidad').count(), 1);
        assert.equal(await page.locator('#pagos-lista-abonos .haiku-abono-v2-movimiento').count(), 2);
        assert.equal(await page.locator('#pagos-lista-checkin .haiku-checkin-grupo-v2').count(), 1);
        await page.evaluate(() => {
            window.fechaSeleccionada = '2026-09-26';
            window.__refreshOtroDia = window.HAIKU_PAGOS_REFRESH_V1.solicitar({
                tipo: 'usuario', nombre: 'otro día' });
        });
        await page.waitForFunction(() => window.HAIKU_PAGOS_REFRESH_V1.publicaciones() === 6);
        assert.match(await page.locator('#pagos-lista-webpay').textContent(), /Invitado/);
        assert.equal(await page.evaluate(() =>
            window.HAIKU_PAGOS_REFRESH_V1.snapshot().webpayScope), 'global');
        assert.deepEqual(errores, []);
        console.log(JSON.stringify({ resultado: 'ok', fuentesMs: final.perfil.fuentes,
            snapshotMs: final.perfil.tSnapshotMs, publicarMs: final.perfil.tPublishMs,
            visibleMs: final.perfil.tVisibleMs, publicaciones: 6,
            coalescidas: final.perfil.coalescidas }));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
