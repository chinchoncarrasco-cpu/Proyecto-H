const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const fuente = fs.readFileSync(require.resolve('../js/supabase-auth.js'), 'utf8');
const iconoAnonimo = parseHTML(fs.readFileSync(require.resolve('../panel.html'), 'utf8'))
    .document.querySelector('link[rel="icon"]').getAttribute('href');
const sesion = { access_token: 'token-de-prueba', user: { id: 'usuario-de-prueba', email: 'operador@example.test' } };
const autorizado = { data: { usuario: { activo: true }, roles: [], permisos: ['reservas.ver'] } };
const microtareas = () => new Promise(resolve => setImmediate(resolve));

async function entorno(consultar, { sesionInicial = null, errorIngreso = null } = {}) {
    const { window, document, Event, CustomEvent } = parseHTML(
        `<html><head><link rel="icon" href="${iconoAnonimo}" data-haku-favicon="assets/haku-cordillera.svg"></head><body></body></html>`
    );
    const cierres = [], tareas = [];
    let listener, authOcupado = false, consultas = 0, avisos = 0;
    async function notificar(evento, actual) {
        authOcupado = true;
        try { await listener(evento, actual); }
        finally { authOcupado = false; }
    }
    window.addEventListener('haiku:auth-ready', () => { avisos++; });
    window.haikuSupabase = {
        auth: {
            onAuthStateChange(callback) { listener = callback; },
            async getSession() { return { data: { session: sesionInicial } }; },
            async signInWithPassword() {
                if (errorIngreso) return { error: errorIngreso };
                await notificar('SIGNED_IN', sesion);
                return { data: { session: sesion } };
            },
            async signOut() {
                cierres.push('SIGNED_OUT');
                await notificar('SIGNED_OUT', null);
            }
        },
        rpc(nombre) {
            assert.equal(nombre, 'haiku_sesion_actual');
            assert.equal(authOcupado, false, 'la consulta debe quedar fuera del bloqueo de Auth');
            return consultar(++consultas);
        }
    };
    vm.runInNewContext(fuente, {
        window, document, CustomEvent,
        console: { info() {}, warn() {}, error() {} },
        localStorage: {
            getItem(key) { return key === 'haikuLoginEmail' ? 'anterior@example.test' : null; },
            setItem() {}
        },
        requestAnimationFrame(callback) { callback(); },
        setTimeout(callback) { tareas.push(callback); }
    });
    async function completar() {
        await microtareas();
        for (const tarea of tareas.splice(0)) tarea();
        await microtareas();
    }
    await completar();
    return {
        window, cierres, completar, notificar, consultas: () => consultas, avisos: () => avisos,
        error: () => document.getElementById('haiku-auth-error').textContent,
        bloqueado: () => !document.querySelector('.haiku-auth-overlay').hidden,
        icono: () => document.querySelector('link[rel="icon"]').getAttribute('href'),
        privacidad(bloqueada) {
            window.dispatchEvent(new CustomEvent('haiku:privacidad-cambio', { detail: { bloqueada } }));
        },
        credenciales: () => ['email', 'password'].map(campo => document.getElementById('haiku-auth-' + campo).value ?? ''),
        botonEntrar: document.getElementById('haiku-auth-submit'),
        async ingresar() {
            document.getElementById('haiku-auth-email').value = sesion.user.email;
            document.getElementById('haiku-auth-password').value = 'clave-de-prueba';
            document.getElementById('haiku-auth-form').dispatchEvent(new Event('submit', { cancelable: true }));
            await completar();
        }
    };
}

test('el formulario y el evento de acceso comparten una comprobación fuera del bloqueo de Auth', async () => {
    const e = await entorno(() => autorizado);
    await e.ingresar();
    assert.equal(e.consultas(), 1);
    assert.equal(e.avisos(), 1);
    assert.equal(e.bloqueado(), false);
    assert.equal(e.window.haikuTienePermiso('reservas.ver'), true);
    assert.equal(e.botonEntrar.disabled, false);
});

test('el acceso se abre con los campos vacíos aunque el navegador conserve el correo antiguo', async () => {
    const e = await entorno(() => autorizado);
    assert.deepEqual(e.credenciales(), ['', '']);
    await e.ingresar();
    assert.equal(e.bloqueado(), false);
    await e.notificar('SIGNED_OUT', null);
    assert.equal(e.bloqueado(), true);
    assert.deepEqual(e.credenciales(), ['', '']);
});

test('Cordillera identifica la pestaña durante la sesión y deja anónimos el acceso y el bloqueo', async () => {
    const e = await entorno(() => autorizado);
    assert.equal(iconoAnonimo, 'assets/pestana-anonima.svg');
    assert.ok(fs.existsSync(require.resolve('../' + iconoAnonimo)));
    assert.equal(e.icono(), iconoAnonimo);
    await e.ingresar();
    assert.equal(e.icono(), 'assets/haku-cordillera.svg');
    e.privacidad(true);
    assert.equal(e.icono(), iconoAnonimo);
    e.privacidad(false);
    assert.equal(e.icono(), 'assets/haku-cordillera.svg');
    await e.notificar('SIGNED_OUT', null);
    assert.equal(e.icono(), iconoAnonimo);
});

test('la demora al validar no cierra la sesión y permite recuperarla al comprobar otra vez', async () => {
    const e = await entorno(i => i === 1 ? { error: { message: 'upstream request timeout' } } : autorizado,
        { sesionInicial: sesion });
    assert.match(e.error(), /No pudimos comprobar tu acceso/);
    assert.equal(e.bloqueado(), true);
    assert.equal(e.window.haikuTienePermiso('reservas.ver'), false);
    assert.deepEqual(e.cierres, []);
    await e.notificar('TOKEN_REFRESHED', sesion);
    await e.completar();
    assert.equal(e.bloqueado(), false);
    assert.equal(e.error(), '');
    assert.equal(e.avisos(), 1);
    assert.deepEqual(e.cierres, []);
});

test('la cuenta realmente deshabilitada queda bloqueada y se cierra su sesión', async () => {
    const e = await entorno(() => ({ data: { usuario: { activo: false } } }), { sesionInicial: sesion });
    assert.match(e.error(), /Tu cuenta no está habilitada/);
    assert.equal(e.bloqueado(), true);
    assert.equal(e.window.haikuTienePermiso('reservas.ver'), false);
    assert.deepEqual(e.cierres, ['SIGNED_OUT']);
    assert.equal(e.avisos(), 0);
});

test('la salida invalida una respuesta de permisos todavía en vuelo', async () => {
    let resolver;
    const e = await entorno(() => new Promise(r => { resolver = r; }), { sesionInicial: sesion });
    await e.notificar('SIGNED_OUT', null);
    resolver(autorizado);
    await e.completar();
    assert.equal(e.bloqueado(), true);
    assert.equal(e.window.haikuTienePermiso('reservas.ver'), false);
    assert.equal(e.avisos(), 0);
});

test('un 504 al ingresar muestra el fallo temporal y vuelve a habilitar el formulario', async () => {
    const e = await entorno(() => autorizado, { errorIngreso: { status: 504 } });
    await e.ingresar();
    assert.match(e.error(), /El servicio de acceso no respondió/);
    assert.equal(e.bloqueado(), true);
    assert.equal(e.botonEntrar.disabled, false);
    assert.equal(e.consultas(), 0);
});
