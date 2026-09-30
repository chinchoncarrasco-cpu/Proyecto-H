const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const frontend = read('js/supabase-auth-menu-v1.js');
const css = read('css/haiku-cuenta-redesign-v1.css');
const panel = read('panel.html');
const fixture = read('tests/fixtures/cuenta-sites/index.html');

test('Cuenta conserva la entrada actual y el contrato accesible del drawer', () => {
    assert.match(frontend, /id = BOTON_ID/);
    assert.match(frontend, /className = "menu-item haiku-cuenta-menu-boton"/);
    assert.match(frontend, /aria-haspopup", "dialog"/);
    assert.match(frontend, /aria-expanded", "false"/);
    assert.match(frontend, /aria-controls", PANEL_ID/);
    assert.match(frontend, /panel\.setAttribute\("role", "dialog"\)/);
    assert.match(frontend, /panel\.setAttribute\("aria-modal", "true"\)/);
    assert.match(frontend, /Volver y cerrar Cuenta/);
});

test('Cuenta muestra exclusivamente datos dinámicos de la sesión real', () => {
    for (const fuente of [
        'sesion.auth?.email', 'usuario.nombre', 'usuario.apellido',
        'sesionActual().roles', 'sesionActual().usuario?.activo', 'sesionActual().permisos'
    ]) assert.ok(frontend.includes(fuente), fuente);
    for (const demo of [
        'chinchon.carrasco@gmail.com', 'Usuario Haku', 'Administrador', 'Acceso completo',
        'Vista de diseño', 'Este dispositivo · vista de diseño',
        'Esta acción se conectará con la cuenta real de Haku'
    ]) assert.equal(frontend.includes(demo), false, demo);
});

test('sólo se conserva la acción real existente de cerrar sesión', () => {
    assert.match(frontend, /getElementById\("haiku-cerrar-sesion"\)/);
    assert.match(frontend, /logoutReal\.click\(\)/);
    assert.doesNotMatch(frontend, /cliente\.auth\.signOut|\.rpc\(|data-account-demo/);
    assert.doesNotMatch(frontend, />\s*(?:Editar|Cambiar foto de perfil|Cambiar contraseña)\s*</);
});

test('el CSS queda aislado, con drawer desktop y pantalla completa móvil', () => {
    assert.match(css, /\.haiku-cuenta-menu-panel\s*\{[\s\S]*position:\s*fixed[\s\S]*height:\s*100dvh[\s\S]*overflow:\s*hidden/);
    assert.match(css, /\.haiku-cuenta-scroll\s*\{[\s\S]*overflow-y:\s*auto/);
    assert.match(css, /\.haiku-cuenta-fondo\s*\{[\s\S]*background:\s*rgba\(16, 36, 29, \.46\)/);
    assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.haiku-cuenta-menu-panel\s*\{[\s\S]*width:\s*100vw[\s\S]*height:\s*100dvh/);
    assert.doesNotMatch(css, /(?:^|\n)\s*\.(?:context|shade|assistant|record|group)(?=[\s:{.#])/m);
});

test('panel carga la capa de Cuenta sin alterar el orden de Cloudbeds', () => {
    assert.match(panel, /haiku-cuenta-redesign-v1\.css\?v=\$\{version\}/);
    assert.ok(panel.indexOf('haiku-cloudbeds-tarifas-redesign-v1.css') < panel.indexOf('haiku-cuenta-redesign-v1.css'));
    assert.match(panel, /'supabase-auth-menu-v1'/);
});

test('la fixture visual es ficticia y evita conexiones remotas', () => {
    assert.match(fixture, /felipe\.fixture@example\.invalid/);
    assert.match(fixture, /window\.haikuSesion/);
    assert.doesNotMatch(fixture, /createClient|supabase\.co|cdn\.jsdelivr/);
});
