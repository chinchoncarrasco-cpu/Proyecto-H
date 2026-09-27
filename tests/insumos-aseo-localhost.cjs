// Demo aislada: nunca sirve el cliente/configuración de producción.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { crearSupabaseInsumos } = require('./fixtures/insumos-supabase-mock.cjs');
const raiz = path.resolve(__dirname, '..');
const modulos = new Set(['js/historial.js', 'js/calendario.js', 'js/checklist.js', 'js/app.js',
    'js/cabanas.js', 'js/sites-cabanas-v1.js', 'js/supabase-aseo-operacion-v1.js',
    'js/supabase-insumos-aseo-v1.js', 'js/supabase-aseo-realtime-v1.js']);
function iniciarDemo() {
    window.supabase = { createClient: () => ({}) };
    window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: 'visible', armado: true }) };
    window.HAIKU_REVISION_SUPABASE_V1 = {};
    async function preparar() {
        if (document.readyState !== 'complete' || !window.HAIKU_CABANAS_SITES_V1 || !window.HAIKU_INSUMOS_ASEO_V1) {
            setTimeout(preparar, 20); return;
        }
        fechaSeleccionada = '2026-09-26';
        window.HAIKU_CONTEXTO_FECHAS_V1.guardarFechaActual();
        const remoto = window.__insumosDemo = crearSupabaseInsumos();
        remoto.filas.aseos = [{ id:'aseo-1',fecha:fechaSeleccionada,cabana_id:'cab-1',estado:'completado',
            encargado_nombre:'Aura',iniciado_en:'2026-09-26T18:30:00Z',completado_en:'2026-09-26T19:30:00Z' },
        { id:'aseo-2',fecha:fechaSeleccionada,cabana_id:'cab-2',estado:'pendiente',encargado_nombre:'Rodolfo' }];
        remoto.filas.movimientos_insumos = JSON.parse(localStorage.getItem('haikuInsumosDemo') || '[]');
        remoto.filas.movimientos_insumos_unidades = JSON.parse(localStorage.getItem('haikuSacosLenaDemo') || '[]');
        // La demo anterior sólo guardaba contadores: no inventar pesos para esos valores.
        remoto.filas.movimientos_insumos.filter(f => f.insumo === 'lena').forEach(f => { f.cantidad = null; });
        const rpc = remoto.cliente.rpc;
        remoto.cliente.rpc = async (...args) => {
            const respuesta = await rpc(...args);
            localStorage.setItem('haikuInsumosDemo', JSON.stringify(remoto.filas.movimientos_insumos));
            localStorage.setItem('haikuSacosLenaDemo', JSON.stringify(remoto.filas.movimientos_insumos_unidades));
            return respuesta;
        };
        window.haikuSupabase = remoto.cliente;
        document.dispatchEvent(new CustomEvent('haiku:supabase-ready'));
        window.haikuSesion = { usuario: { id:'operador-demo' }, auth: { id:'operador-demo' } };
        window.dispatchEvent(new CustomEvent('haiku:auth-ready'));
        await window.HAIKU_ASEO_OPERACION_V1.hidratar(fechaSeleccionada);
        await window.HAIKU_INSUMOS_ASEO_V1.hidratar(fechaSeleccionada);
        obtenerDatosDia(fechaSeleccionada).cabanas[1].revisionCompletaCiclo = {
            fecha:fechaSeleccionada,verificado:true,estado:'completada',resultado:'lista'
        };
        document.querySelector('.menu-item[data-seccion="cabanas"]').click();
        window.HAIKU_CABANAS_SITES_V1.pintar();
        const aviso = document.createElement('div');
        aviso.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#245a49;color:white;text-align:center;font:11px system-ui;padding:5px';
        aviso.textContent = 'DEMO LOCAL · Datos simulados · Sin conexión a Supabase';
        document.body.appendChild(aviso);
        window.__insumosDemoListo = true;
    }
    preparar();
}
function crearServidor() {
    return http.createServer((req,res) => {
        res.setHeader('Cache-Control','no-store');
        res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
        const url = new URL(req.url, 'http://127.0.0.1');
        const nombre = decodeURIComponent(url.pathname.slice(1) || 'panel.html');
        if (nombre === '__demo/sdk.js') {
            res.setHeader('Content-Type','application/javascript; charset=utf-8');
            res.end(`${crearSupabaseInsumos.toString()}\n(${iniciarDemo.toString()})();`); return;
        }
        const archivo = path.resolve(raiz, nombre);
        if (!archivo.startsWith(raiz + path.sep) || !/^(?:panel\.html|index\.html|(?:js|css|assets|vendor)\/|[^/]+\.(?:jpg|jpeg|png|webp)$)/.test(nombre)) {
            res.writeHead(404); res.end(); return;
        }
        const tipo = path.extname(nombre);
        res.setHeader('Content-Type', ({ '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
            '.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml' })[tipo] || 'application/octet-stream');
        if (tipo === '.js' && !modulos.has(nombre)) { res.end(''); return; }
        if (!fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) { res.writeHead(404); res.end(); return; }
        let body = fs.readFileSync(archivo);
        if (nombre === 'panel.html') body = body.toString('utf8').replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','/__demo/sdk.js');
        res.end(body);
    });
}
module.exports = { crearServidor };
if (require.main === module) crearServidor().listen(4173,'127.0.0.1',() => {
    console.log('Demo de reposición: http://127.0.0.1:4173/panel.html (sin Supabase; Ctrl+C para cerrar)');
});
