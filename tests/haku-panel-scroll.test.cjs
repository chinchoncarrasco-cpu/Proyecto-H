const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const baseCss = read('css/supabase-asistente-v1.css');
const sitesCss = read('css/sites-asistente-v1.css');
const coordinatorCss = read('css/haiku-panel-coordinacion-v1.css');
const assistant = read('js/supabase-asistente-v1.js');
const tariffs = read('js/haiku-cloudbeds-tarifas-v1.js');
const fixture = read('tests/fixtures/cloudbeds-haku-tarifas-2e/index.html');

function declarations(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
        .map(match => match[1]).join('\n');
}

test('el DOM mantiene una sola cadena flex acotada entre panel y mensajes', () => {
    assert.match(assistant, /<section class="haiku-asistente-panel"[\s\S]*?<header class="haiku-asistente-cabecera"[\s\S]*?<div class="haiku-asistente-conversacion">[\s\S]*?id="haiku-asistente-mensajes"[\s\S]*?<div class="haiku-asistente-pie">/);

    const panel = declarations(baseCss, '.haiku-asistente-panel');
    const header = declarations(baseCss, '.haiku-asistente-cabecera');
    const conversation = declarations(baseCss, '.haiku-asistente-conversacion');
    const messages = declarations(baseCss, '.haiku-asistente-mensajes');
    const footer = declarations(baseCss, '.haiku-asistente-pie');

    assert.match(panel, /max-height:\s*min\(720px,\s*calc\(100dvh - 116px\)\)/);
    assert.match(panel, /overflow:\s*hidden/);
    assert.match(header, /flex:\s*0 0 auto/);
    assert.match(conversation, /min-height:\s*0/);
    assert.match(conversation, /display:\s*flex/);
    assert.match(conversation, /overflow:\s*hidden/);
    assert.match(messages, /min-height:\s*0/);
    assert.match(messages, /overflow-y:\s*auto/);
    assert.match(messages, /overscroll-behavior-y:\s*contain/);
    assert.match(messages, /overflow-anchor:\s*none/);
    assert.match(footer, /flex:\s*0 0 auto/);
    assert.doesNotMatch(conversation, /overflow-y:\s*auto/);
    assert.doesNotMatch(footer, /overflow(?:-y)?:\s*auto/);
});

test('mensajes conserva una barra visible y arrastrable en el tema Sites', () => {
    const messages = declarations(sitesCss, '.haiku-asistente-root .haiku-asistente-panel .haiku-asistente-mensajes');
    const scrollbar = declarations(sitesCss, '.haiku-asistente-root .haiku-asistente-panel .haiku-asistente-mensajes::-webkit-scrollbar');
    assert.match(messages, /overflow-y:\s*auto/);
    assert.match(messages, /scrollbar-width:\s*thin/);
    assert.match(messages, /scrollbar-gutter:\s*stable/);
    assert.match(scrollbar, /display:\s*block/);
    assert.match(scrollbar, /width:\s*9px/);
    assert.doesNotMatch(sitesCss, /haiku-asistente-mensajes[^{}]*\{[^}]*scrollbar-width:\s*none/);
});

test('viewport móvil y coordinación no agregan otro propietario del scroll', () => {
    assert.match(baseCss, /@media \(max-width: 700px\)[\s\S]*?max-height:\s*calc\(100dvh - 102px\)/);
    assert.match(sitesCss, /@media \(max-width: 600px\)[\s\S]*?inset:\s*0 !important/);
    assert.doesNotMatch(coordinatorCss, /haiku-asistente-(?:panel|conversacion|pie)[^{}]*\{[^}]*overflow-y:\s*auto/);
    assert.match(coordinatorCss, /haiku-volver-haku/);
});

test('Inspector y cambio A a B no reinician borrador ni scroll de Haku', () => {
    assert.match(fixture, /data-haiku-inspector-superficie="reserva"/);
    assert.match(fixture, /role="dialog" aria-modal="false"/);
    assert.doesNotMatch(tariffs, /haiku-asistente-texto|\.scrollTop\s*=/);
    assert.match(tariffs, /HAIKU_INSPECTOR_V1 \|\| root\.HAIKU_PANELES_V1/);
});
