const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const API = require('../js/sites-libro-comparacion-readonly-v1.js');
const Fuente = require('../js/haiku-libro-fuente-oficial-v1.js');
const Core = require('../js/haiku-libro-comparacion-readonly-v1.js');
const F = require('./fixtures/libro-comparacion-readonly.cjs');
const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/libro-reconciliacion-oct26-real.xlsx'));
const hash = createHash('sha256').update(bytes).digest('hex');
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function escenario({ fixture = F.casos().find(f => f.id === 'asociacion_segura'), ...opts } = {}) {
    let user = 'usuario-ficticio-a', conectado = true, vigente = true, gen = 0, loaded = false, version = null;
    const capturas = [], llamadas = { fuentes: 0, m2: 0, comparar: 0, rpc: [], limpio: 0 };
    const base = F.cliente(fixture.db), session = () => ({ data: { session: user ? { user: { id: user } } : null }, error: null });
    const cliente = { ...base, auth: { getSession: async () => session(), getUser: async () => ({ data: { user: { id: user } }, error: null }),
        signOut: async () => { user = null; } }, rpc: async name => {
            llamadas.rpc.push(name); assert.equal(name, 'haiku_sesion_actual');
            return { data: { usuario: { activo: opts.inactivo !== true }, permisos: opts.permisos || ['reservas.ver', 'pagos.ver', 'servicios.ver'] }, error: opts.errorSesion ? { message: 'NO_EXPORTAR_SECRETO' } : null };
        } };
    const web = F.web(fixture.data); // Misma adaptación canónica de pagos/lenguaje que el lector Web.
    const lector = { modo: 'informe-readonly-solo-memoria', estado: () => ({ cargado: loaded, version, generacion: gen, nombre: 'Libro ficticio.xlsx' }),
        listo: async () => {}, listarHojas: () => ['Oct26'], consultarHoja: (...args) => web.HAIKU_LIBRO_RESERVA_V1.consultarHoja(...args),
        cargarDesdeGoogleParaVerificacion: async () => { gen++; loaded = true; version = hash; },
        limpiar: async () => { llamadas.limpio++; gen++; loaded = false; version = null; } };
    let control;
    const fuente = Fuente.crearControlador({ fileId: 'archivo-ficticio', lector: () => lector, autorizado: () => conectado,
        obtenerMetadata: async () => ({ id: 'archivo-ficticio', name: 'Libro ficticio.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: String(bytes.length), version: vigente ? '11' : '12', modifiedTime: '2026-10-09T12:00:00Z', sha256Checksum: hash, capabilities: { canDownload: true }, trashed: false }),
        descargar: async () => new File([bytes], 'Libro ficticio.xlsx'), entregar: f => lector.cargarDesdeGoogleParaVerificacion(f),
        alInvalidar: code => { control?.fuenteInvalidada(code); opts.observador?.(); } });
    const google = { estado: () => ({ conectado, sincronizando: false }),
        obtenerFuenteVerificada: () => { llamadas.fuentes++; return opts.descarga ? opts.descarga(fuente) : fuente.obtener(); },
        fuenteVerificada: h => fuente.fuente(h), verificarVigencia: async h => { llamadas.m2++; if (opts.m2) await opts.m2(); return fuente.verificarVigencia(h); },
        desconectar: () => { conectado = false; fuente.invalidar('GOOGLE_NO_AUTORIZADO'); } };
    const real = Core.crearNucleo(), nucleo = { compararMes: async input => { llamadas.comparar++; if (opts.antesComparar) await opts.antesComparar();
        return opts.dto ? opts.dto(input) : real.compararMes(input); } };
    control = API.crearControlador({ cliente, lector, google, nucleo, ahora: () => opts.ahora || F.ahora, emitir: s => capturas.push(s) });
    return { control, cliente, lector, fuente, google, capturas, llamadas, base, fixture,
        dto: () => capturas.findLast(s => s.resultado)?.resultado, usuario: id => { user = id; }, cambio: () => { vigente = false; },
        conectado: value => { conectado = value; }, manual: async () => { await lector.limpiar(); fuente.cambioLibro(); } };
}
test('flujo real de DTO: fuente opaca, núcleo canónico, M2 y sesión final antes de mostrar', async () => {
    const x = escenario(); await x.control.comprobarSesion(); await x.control.comparar();
    assert.equal(x.control.estado().fase, 'completo'); assert.equal(x.dto().status, 'ok'); assert.equal(x.llamadas.fuentes, 1); assert.equal(x.llamadas.m2, 1);
    assert.deepEqual(x.capturas.filter(s => ['comparando', 'vigencia'].includes(s.fase)).map(s => !!s.resultado), [false, false]);
    assert.deepEqual(x.dto().periodo, { desde: '2026-10-01', hasta: '2026-10-31', etiqueta: 'octubre 2026', timezone: 'America/Santiago' });
    assert.ok(x.base.lecturas.length); assert.deepEqual(x.base.mutaciones, []); assert.ok(x.llamadas.rpc.every(n => n === 'haiku_sesion_actual'));
});
for (const f of F.casos()) test('paridad exacta de presentación y estados: ' + f.id, async () => {
    const x = escenario({ fixture: f }); await x.control.comprobarSesion(); await x.control.comparar();
    assert.ok(x.dto(), x.control.estado().fase);
    const expected = await Core.crearNucleo().compararMes({ fuente: { hojas: { Oct26: f.data }, nombre: 'ficticio.xlsx' }, cliente: F.cliente(f.db), ahora: F.ahora });
    assert.deepEqual(x.dto().presentacion, expected.presentacion);
    assert.deepEqual(x.dto().pagosDetalle.map(p => p.estado), expected.pagosDetalle.map(p => p.estado));
    assert.deepEqual(x.dto().serviciosDetalle.map(s => s.estado), expected.serviciosDetalle.map(s => s.estado));
    assert.equal(x.dto().status, expected.status); assert.deepEqual(x.base.mutaciones, []);
});
for (const [nombre, opts, fase] of [['activo falso', { inactivo: true }, 'permisos'], ['permiso ausente', { permisos: ['reservas.ver'] }, 'permisos'],
    ['error RPC de sesión', { errorSesion: true }, 'error_sesion']]) test(nombre + ': no fuente ni SELECT', async () => {
    const x = escenario(opts); await x.control.comprobarSesion(); await x.control.comparar();
    assert.equal(x.control.estado().fase, fase); assert.equal(x.llamadas.fuentes, 0); assert.equal(x.llamadas.comparar, 0); assert.deepEqual(x.base.lecturas, []);
    assert.doesNotMatch(JSON.stringify(x.capturas), /NO_EXPORTAR_SECRETO/);
});
test('sin sesión, Google desconectado y getUser inválido fallan cerrados', async () => {
    const x = escenario(); x.usuario(null); await x.control.comparar(); assert.equal(x.control.estado().fase, 'sin_sesion');
    const y = escenario(); y.conectado(false); await y.control.comparar(); assert.equal(y.control.estado().fase, 'google_desconectado');
    const z = escenario(); z.cliente.auth.getUser = async () => ({ error: {}, data: {} }); await z.control.comparar(); assert.equal(z.control.estado().fase, 'error_sesion');
    for (const s of [x, y, z]) { assert.equal(s.llamadas.fuentes, 0); assert.deepEqual(s.base.lecturas, []); }
});
test('lector normal con persistencia no puede utilizarse en el informe', async () => {
    const x = escenario(); x.lector.modo = 'archivo-local-solo-lectura-estilo-xlsx-richtext'; await x.control.comparar();
    assert.equal(x.control.estado().fase, 'error_fuente'); assert.equal(x.llamadas.fuentes, 0);
});
test('carga manual con mismos bytes nunca es autoridad para la ruta', async () => {
    const x = escenario(); x.google.obtenerFuenteVerificada = async () => ({ tipo: 'google-drive-oficial-verificado', version: hash });
    await x.control.comparar(); assert.equal(x.control.estado().fase, 'archivo_modificado'); assert.equal(x.llamadas.comparar, 0);
});
test('periodo canónico respeta Santiago en cambio de mes UTC', async () => {
    const x = escenario({ ahora: '2026-11-01T01:00:00Z' }); await x.control.comparar(); assert.equal(x.dto().periodo.desde, '2026-10-01');
});
test('M2 cambiado descarta el DTO y limpia el lector', async () => {
    let x; x = escenario({ m2: async () => x.cambio() }); await x.control.comparar();
    assert.equal(x.control.estado().fase, 'archivo_modificado'); assert.equal(x.control.estado().tieneResultado, false);
    assert.equal(x.dto(), undefined); assert.equal(x.lector.estado().cargado, false);
});
test('M2 fallido sin cuerpo privado ni resultado parcial', async () => {
    const x = escenario({ m2: async () => { throw Error('CONTENIDO_PRIVADO'); } }); await x.control.comparar();
    assert.equal(x.control.estado().fase, 'error_fuente'); assert.equal(x.dto(), undefined); assert.doesNotMatch(JSON.stringify(x.capturas), /CONTENIDO_PRIVADO/);
});
test('error del núcleo no se presenta como cero exitoso ni ejecuta M2', async () => {
    const x = escenario({ dto: () => ({ status: 'error', error: { code: 'ERROR_SUPABASE', message: 'NO_MOSTRAR' } }) }); await x.control.comparar();
    assert.equal(x.control.estado().fase, 'error_comparacion'); assert.equal(x.llamadas.m2, 0); assert.equal(x.dto(), undefined);
});
test('doble pulsación produce una adquisición, un núcleo y una M2', async () => {
    const stop = gate(), x = escenario({ antesComparar: () => stop.promise }); const first = x.control.comparar();
    await new Promise(r => setTimeout(r, 20)); await x.control.comparar(); stop.resolve(); await first;
    assert.equal(x.llamadas.fuentes, 1); assert.equal(x.llamadas.comparar, 1); assert.equal(x.llamadas.m2, 1);
});
for (const action of ['logout', 'usuario', 'manual', 'destruir', 'google']) test(action + ': respuesta tardía descartada', async () => {
    const stop = gate(), x = escenario({ antesComparar: () => stop.promise }); const first = x.control.comparar();
    await new Promise(r => setTimeout(r, 20));
    if (action === 'logout') { x.usuario(null); x.control.cambioSesion('SIGNED_OUT', null); }
    else if (action === 'usuario') { x.usuario('usuario-ficticio-b'); x.control.cambioSesion('SIGNED_IN', { user: { id: 'usuario-ficticio-b' } }); }
    else if (action === 'manual') await x.manual();
    else if (action === 'google') x.google.desconectar();
    else x.control.destruir();
    stop.resolve(); await first; assert.equal(x.dto(), undefined); assert.equal(x.control.estado().tieneResultado, false); assert.deepEqual(x.base.mutaciones, []);
});
test('sesión revocada durante M2 no permite mostrar el DTO', async () => {
    let x; x = escenario({ m2: async () => x.usuario(null) }); await x.control.comparar();
    assert.equal(x.control.estado().fase, 'sin_sesion'); assert.equal(x.dto(), undefined);
});

test('cambio de propietario sin callback también impide reutilizar fuente y resultado', async () => {
    const x = escenario(); await x.control.comparar(); assert.equal(x.control.estado().tieneResultado, true);
    x.usuario('usuario-ficticio-b'); await x.control.comprobarSesion();
    assert.equal(x.control.estado().fase, 'obsoleta'); assert.equal(x.control.estado().tieneResultado, false);
    assert.equal(x.google.estado().conectado, false); assert.equal(x.lector.estado().cargado, false);
});

test('renovación de token del mismo usuario limpia el informe y revalida sin abrir OAuth', async () => {
    const x = escenario(); await x.control.comparar();
    x.control.cambioSesion('TOKEN_REFRESHED', { user: { id: 'usuario-ficticio-a' } });
    assert.equal(x.control.estado().tieneResultado, false); assert.equal(x.control.estado().acceso, false);
    assert.equal(x.google.estado().conectado, true); assert.equal(x.lector.estado().cargado, false);
    await x.control.comprobarSesion(); assert.equal(x.control.estado().fase, 'listo');
    await x.control.comparar(); assert.equal(x.control.estado().fase, 'completo'); assert.equal(x.llamadas.fuentes, 2);
});

test('adquisición antigua que llega después de una nueva no reemplaza su handle', async () => {
    const stop = gate(); let llamada = 0;
    const x = escenario({ descarga: async fuente => { if (++llamada === 1) { await stop.promise; return Object.freeze({}); } return fuente.obtener(); } });
    const vieja = x.control.comparar(); await new Promise(r => setTimeout(r, 20));
    x.control.invalidar(); await x.control.comparar(); assert.equal(x.control.estado().fase, 'completo');
    stop.resolve(); await vieja; x.control.revisarLocal();
    assert.equal(x.control.estado().fase, 'completo'); assert.equal(x.llamadas.comparar, 1);
});

test('error devuelto por signOut limpia datos y muestra error de sesión seguro', async () => {
    const x = escenario(); await x.control.comparar();
    x.cliente.auth.signOut = async () => ({ error: { message: 'NO_MOSTRAR' } }); await x.control.cerrarSesion();
    assert.equal(x.control.estado().fase, 'error_sesion'); assert.equal(x.control.estado().tieneResultado, false);
    assert.equal(x.lector.estado().cargado, false); assert.equal(x.google.estado().conectado, false);
    assert.doesNotMatch(JSON.stringify(x.capturas.at(-1)), /NO_MOSTRAR/);
});
test('lectura fallida de Proyecto H conserva error, no inventa registros faltantes', async () => {
    const x = escenario(); x.cliente.from = () => { throw Error('PRIVADO'); }; await x.control.comparar();
    assert.equal(x.control.estado().fase, 'error_comparacion'); assert.equal(x.dto(), undefined);
});
test('observador que falla no impide invalidación de fuente 4B.2C', async () => {
    const x = escenario({ observador: () => { throw Error('NO_PUBLICAR'); } }); await x.control.comparar(); x.fuente.invalidar(); assert.equal(x.control.estado().tieneResultado, false);
});
test('estructura dedicada: dependencias canónicas, nada de panel, writers, almacenamiento o transporte nativo', () => {
    const html = fs.readFileSync(path.join(__dirname, '../libro-comparacion.html'), 'utf8');
    const code = fs.readFileSync(path.join(__dirname, '../js/sites-libro-comparacion-readonly-v1.js'), 'utf8');
    assert.match(html, /data-libro-modo="informe-readonly"/); assert.match(html, /haiku-libro-comparacion-readonly-v1.js/);
    assert.doesNotMatch(html, /iframe|supabase-auth.js|supabase-data|supabase-asistente|supabase-sync|incorporacion|WebView/i);
    assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|console\.|innerHTML|pushState|replaceState|location\.(?:search|hash)|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    assert.match(code, /cliente\.rpc\("haiku_sesion_actual"\)/);
    assert.doesNotMatch(code, /crearPlanIncorporacion|confirmarIncorporacion|registrar_pago|importar_servicios/);
});

test('R1: sin sesión el enlace conduce al panel que instala el login Supabase canónico, sin tokens en URL', async () => {
    const x = escenario(); x.usuario(null); await x.control.comprobarSesion();
    assert.equal(x.control.estado().fase, 'sin_sesion'); assert.equal(x.control.estado().tieneResultado, false);
    assert.equal(x.llamadas.fuentes, 0); assert.deepEqual(x.base.lecturas, []);
    const html = fs.readFileSync(path.join(__dirname, '../libro-comparacion.html'), 'utf8');
    const enlace = html.match(/<a\b[^>]*\bid="informe-login"[^>]*\bhref="([^"]+)"/);
    assert.ok(enlace, 'Debe existir un enlace de login utilizable sin sesión');
    const url = new URL(enlace[1], 'https://example.invalid/Proyecto-H/libro-comparacion.html');
    assert.equal(url.pathname, '/Proyecto-H/panel.html'); assert.equal(url.search, ''); assert.equal(url.hash, '');
    const panel = fs.readFileSync(path.join(__dirname, '../panel.html'), 'utf8');
    const base = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.match(panel, /js\/supabase-client\.js/); assert.match(panel, /js\/supabase-auth\.js/);
    assert.doesNotMatch(base, /<script[^>]*src="js\/supabase-auth\.js/);
    assert.doesNotMatch(html, /<script[^>]*src="(?:panel\.html|js\/supabase-auth\.js)/);
});
