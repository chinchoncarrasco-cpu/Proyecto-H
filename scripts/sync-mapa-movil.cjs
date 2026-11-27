const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const destination = process.argv[2];
if (!destination) throw new Error('Indica la ruta del repositorio Haku-Mobile.');
const web = resolve(__dirname, '..');
const mobile = resolve(destination, 'features/mapa');
const read = path => readFileSync(join(web, path), 'utf8');
const write = (name, value) => writeFileSync(join(mobile, name + '.ts'),
    '// Generado con scripts/sync-mapa-movil.cjs de Proyecto H.\n'
    + 'export const ' + name + ' = ' + JSON.stringify(value) + ';\n');

const iconDir = 'assets/huespedes';
const icons = Object.fromEntries(readdirSync(join(web, iconDir))
    .filter(name => name.endsWith('.svg'))
    .map(name => [name, 'data:image/svg+xml,' + encodeURIComponent(read(join(iconDir, name)))]));
const styles = ['haiku-huespedes-v1', 'haiku-huespedes-figma-v1']
    .map(name => read('css/' + name + '.css').replace(/^@font-face[^\n]+\n/gm, ''))
    .join('\n');
const script = read('js/haiku-huespedes-v1.js');
const reservationState = read('js/haiku-reserva-estado-manual-v1.js');
if (/<\/script/i.test(script + reservationState) || /<\/style/i.test(styles)) throw new Error('Revisa los recursos antes de insertarlos en el mapa.');

write('recintoDocument', read('assets/mapa/recinto.html'));
write('estadoReservaScript', '<script>' + reservationState + '</script>\n');
write('guestPanelAssets', '<style>' + styles + '</style>\n<script>window.HAIKU_ICONOS_FICHA_MAPA_V1 = '
    + JSON.stringify(icons) + ';</script>\n<script>' + script + '</script>\n');
