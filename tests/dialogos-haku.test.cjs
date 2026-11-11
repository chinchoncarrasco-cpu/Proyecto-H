const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parser = { exports: {} };
vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'], { module: parser, exports: parser.exports });
const parse = source => parser.exports.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
function walk(node, fn, parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type) fn(node, parent);
    for (const key of Object.keys(node)) if (key !== 'parent') {
        const value = node[key];
        if (Array.isArray(value)) value.forEach(child => walk(child, fn, node));
        else if (value?.type) walk(value, fn, node);
    }
}
function funcion(file, name) {
    const source = read(file); let result;
    walk(parse(source), node => { if (node.type === 'FunctionDeclaration' && node.id.name === name) result = source.slice(node.start, node.end); });
    assert.ok(result, name); return result;
}
test('todos los módulos esperan la decisión; no quedan ventanas nativas', () => {
    let decisiones = 0;
    for (const file of fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'))) {
        const source = read('js/' + file);
        if (!source.includes('HAIKU_DIALOGOS') && !/\b(?:alert|confirm|prompt)\s*\(/.test(source)) continue;
        walk(parse(source), (node, parent) => {
            if (node.type !== 'CallExpression') return;
            const callee = node.callee;
            const name = callee.type === 'Identifier' ? callee.name : callee.property?.name;
            assert.ok(!['alert', 'confirm', 'prompt'].includes(name), `${file}: ${name} nativo`);
            if (source.slice(callee.start, callee.end).includes('HAIKU_DIALOGOS') && ['confirmar', 'solicitar', 'ocupacion'].includes(name)) {
                assert.equal(parent.type, 'AwaitExpression', `${file}: falta esperar ${name}`); decisiones++;
            }
        });
    }
    assert.ok(decisiones >= 40);
});
test('cada entrada carga la interfaz compartida antes de sus operaciones', () => {
    for (const file of ['index.html', 'libro-comparacion.html', 'calendario-redes.html']) {
        const source = read(file);
        assert.equal((source.match(/src="js\/haiku-dialogos-v1.js/g) || []).length, 1, file);
        assert.match(source, /href="css\/haiku-dialogos-v1.css/);
        const first = source.indexOf('js/haiku-dialogos-v1.js');
        for (const script of ['js/cabanas.js', 'js/haiku-redes-ui-v1.js', 'js/haiku-libro-consultas-v1.js']) {
            if (source.includes(script)) assert.ok(first < source.indexOf(script), file + script);
        }
    }
    assert.match(read('panel.html'), /index\.html/);
    assert.match(read('js/haiku-redes-ui-v1.js'), /beforeunload/);
});
for (const acepta of [false, true]) test(`cancelación real espera la respuesta ${acepta} antes del RPC`, async () => {
    const calls = []; let decidir;
    const context = { window: { HAIKU_DIALOGOS: { confirmar: () => new Promise(resolve => { decidir = resolve; }), aviso: m => { throw Error(m); } } },
        cancelando: false, cliente: { rpc: async () => { calls.push('rpc'); return { data: {} }; } },
        cerrarMenuEstado() {}, cerrarFicha() {}, retirarReservaDelCache() {}, renderCalendarioInmediato() {},
        refrescarFuentesSupabase: async () => {}, console };
    vm.runInNewContext(funcion('js/supabase-reserva-estados-v1.js', 'cancelarReservaSupabase') + ';this.run=cancelarReservaSupabase;', context);
    const pending = context.run('reserva-sintetica', { antesDeCancelar: async () => { calls.push('revalidar'); return true; } });
    assert.deepEqual(calls, []);
    decidir(acepta); await pending;
    assert.deepEqual(calls, acepta ? ['revalidar', 'rpc'] : []);
    assert.equal(context.cancelando, false);
});
test('volver a Confirmada espera la confirmación de reversión', async () => {
    const source = read('js/supabase-ficha-hospedado-v1.js');
    assert.match(source, /if \(!await pedirConfirmacionReversion\(/);
    let resolver;
    const context = { window: { HAIKU_DIALOGOS: { confirmar: () => new Promise(r => { resolver = r; }) } } };
    vm.runInNewContext(funcion('js/supabase-ficha-hospedado-v1.js', 'pedirConfirmacionReversion') + ';this.run=pedirConfirmacionReversion;', context);
    const pendiente = context.run('confirmada', { estado_estadia: 'hospedado', checkin_realizado_en: '2026-11-11T10:00:00Z' });
    assert.equal(typeof pendiente.then, 'function');
    assert.equal(typeof resolver, 'function'); resolver(false); assert.equal(await pendiente, false);
});
