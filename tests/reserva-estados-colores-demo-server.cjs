const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4177);
const tipos = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relativo = pathname === "/" ? "tests/fixtures/reserva-estados-colores/index.html"
        : pathname.replace(/^\/+/, "");
    const archivo = path.resolve(root, relativo);
    if (!archivo.startsWith(root + path.sep)) return response.writeHead(403).end("Prohibido");
    try {
        response.setHeader("Content-Type", tipos[path.extname(archivo)] || "application/octet-stream");
        response.setHeader("Cache-Control", "no-store");
        response.end(fs.readFileSync(archivo));
    } catch (_) { response.writeHead(404).end("No encontrado"); }
}).listen(port, "127.0.0.1", () => {
    console.log(`Demo de estados disponible en http://127.0.0.1:${port}/`);
});
