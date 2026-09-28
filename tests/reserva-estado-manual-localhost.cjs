// Demo visual aislada: sólo assets permitidos; ningún SDK, config ni backend real.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.resolve(__dirname, '..');
const archivos = new Map([
    ['/', 'tests/fixtures/reserva-estado-demo/index.html'],
    ['/demo.css', 'tests/fixtures/reserva-estado-demo/demo.css'],
    ['/demo.js', 'tests/fixtures/reserva-estado-demo/demo.js'],
    ...['css/styles.css', 'css/sites-resumen-v1.css',
        'js/haiku-reserva-estado-manual-v1.js', 'js/supabase-finanzas-resumen-v1.js',
        'js/sites-resumen-drawer-v1.js', 'js/sites-resumen-reserva-v1.js'].map(f => ['/' + f, f])
]);
const movil = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo estado reserva · Móvil</title><link rel="stylesheet" href="/demo.css"></head>
<body class="demo-mobile-shell"><header class="demo-mobile-head">
<strong>DEMO VISUAL · Vista móvil 390 px</strong><a href="/">Volver a escritorio</a></header>
<iframe class="demo-mobile-frame" src="/" title="Demo de reserva TEST en vista móvil"></iframe>
</body></html>`;

function crearServidor() {
    return http.createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
        }
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        if (url.pathname === '/movil') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(req.method === 'HEAD' ? undefined : movil); return;
        }
        const archivo = archivos.get(url.pathname);
        if (!archivo) { res.writeHead(404); res.end(); return; }
        const tipo = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' }[path.extname(archivo)];
        res.setHeader('Content-Type', tipo + '; charset=utf-8');
        res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(path.join(raiz, archivo)));
    });
}
module.exports = { crearServidor };
if (require.main === module) {
    const servidor = crearServidor();
    servidor.on('error', error => {
        console.error('No se pudo iniciar la demo en 127.0.0.1:4174:', error.message);
        process.exitCode = 1;
    });
    servidor.listen(4174, '127.0.0.1', () => {
        console.log('Demo visual de estado de reserva: http://127.0.0.1:4174/');
        console.log('Vista móvil: http://127.0.0.1:4174/movil');
        console.log('Sólo datos ficticios en memoria, sin Supabase. Ctrl+C para cerrar.');
    });
}
