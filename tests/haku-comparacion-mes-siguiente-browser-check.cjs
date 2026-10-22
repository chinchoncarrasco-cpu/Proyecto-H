// Botones reales de Haku con los interceptores reales del Libro y Servicios.
// El lector XLSX se sustituye en memoria; no hay escritura ni red.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const raiz = path.resolve(__dirname, '..');
const leer = nombre => fs.readFileSync(path.join(raiz, 'js', nombre), 'utf8');
// Orden de los interceptores del Libro en panel.html; Haku se carga dinámicamente.
const scripts = ['haiku-libro-semantica-v1.js','supabase-asistente-libro-actualizacion-v1.js',
    'haiku-libro-pagos-canon-v1.js','haiku-libro-lenguaje-natural-v1.js',
    'haiku-libro-servicios-scope-v2.js','haiku-libro-pagos-focalizados-v1.js',
    'haiku-libro-consultas-v1.js','supabase-asistente-v1.js'];
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function escenario(browser, instante, hojas, acciones, ancho = 1280) {
    const page = await browser.newPage({ timezoneId: 'America/Santiago', viewport: { width: ancho, height: 800 } });
    const errores = [];
    page.on('pageerror', error => errores.push(error.message));
    try {
        await page.route('**/*', route => route.abort());
        await page.clock.install({ time: new Date(instante) });
        await page.goto('about:blank');
        await page.evaluate(nombres => {
            window.haikuSesion = { auth: { id: 'usuario-prueba' } };
            window.haikuSupabase = { auth: { onAuthStateChange: () => ({}) } };
            window.__hojas = nombres;
            window.__lecturas = [];
            window.HAIKU_LIBRO_RESERVA_V1 = {
                listo: async () => {},
                estado: () => ({ cargado: true, nombre: 'Libro de prueba.xlsx', generacion: 1 }),
                listarHojas: () => window.__hojas,
                consultarHoja: async hoja => {
                    window.__lecturas.push({ hoja, ruta: new Error().stack });
                    throw new Error(`LECTURA CONTROLADA ${hoja}`);
                }
            };
        }, hojas);
        for (const nombre of scripts) {
            await page.addScriptTag({ content: leer(nombre) });
        }
        await page.locator('#haiku-asistente-boton').click();
        for (const accion of acciones) {
            const antes = await page.locator('#haiku-asistente-mensajes .haiku-asistente-mensaje--usuario').count();
            const lecturasAntes = await page.evaluate(() => window.__lecturas.length);
            await page.locator('#haiku-asistente-rapidas summary').click();
            await page.locator(`#haiku-asistente-rapidas [data-haiku-accion-rapida="${accion.id}"]`).click();
            await page.waitForFunction(cantidad => document.querySelectorAll(
                '#haiku-asistente-mensajes .haiku-asistente-mensaje--usuario').length > cantidad, antes);
            const texto = await page.locator('#haiku-asistente-mensajes .haiku-asistente-mensaje--usuario').last().innerText();
            assert.match(texto, accion.texto, accion.id);
            assert.equal(await page.evaluate(valor => window.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.esConsultaServicios(valor), texto),
                accion.tipo === 'servicios');
            if (accion.hoja) {
                const rango = await page.evaluate(({ valor, tipo }) => tipo === 'servicios'
                    ? window.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.rangoDesdeTexto(valor)
                    : window.HAIKU_LIBRO_CONSULTAS.interpretar(valor, window.__hojas),
                { valor: texto, tipo: accion.tipo });
                const fechas = [...texto.matchAll(/\b(\d{2})-(\d{2})-(\d{4})\b/g)]
                    .map(([, dia, mes, anio]) => `${anio}-${mes}-${dia}`);
                assert.equal(rango.desde, fechas[0]);
                assert.equal(rango.hasta, fechas[1]);
                if (accion.tipo === 'libro') assert.deepEqual(rango.hojas, [accion.hoja]);
            }
            await page.waitForFunction(fragmento => document.querySelector(
                '#haiku-asistente-mensajes .haiku-asistente-mensaje--asistente:last-child')?.textContent.includes(fragmento),
            accion.resultado);
            const nuevas = await page.evaluate(inicio => window.__lecturas.slice(inicio), lecturasAntes);
            assert.equal(await page.locator('#haiku-asistente-mensajes .haiku-asistente-mensaje--usuario').count(), antes+1,
                'un clic produce exactamente un envío');
            if (accion.hoja) {
                assert.deepEqual(nuevas.map(x => x.hoja), [accion.hoja], accion.id);
                assert.match(nuevas[0].ruta, accion.tipo === 'servicios' ? /leerLibro/ : /consultar/);
            } else assert.equal(nuevas.length, 0, 'sin hoja no se consulta otro mes');
        }
        assert.deepEqual(errores, []);
    } finally { await page.close(); }
}

async function consultasPendientes(browser, ancho) {
    const page=await browser.newPage({timezoneId:'America/Santiago',viewport:{width:ancho,height:800}}),errores=[];
    page.on('pageerror',e=>errores.push(e.message));
    try {
        await page.route('**/*',r=>r.abort());
        await page.clock.install({time:new Date('2026-10-22T12:00:00Z')});
        await page.goto('about:blank');
        await page.evaluate(()=>{
            window.haikuSesion={auth:{id:'usuario-sintetico'}};
            const lectura=()=>new Proxy({},{get:(_,k)=>k==='then'?(ok,no)=>Promise.resolve({data:[]}).then(ok,no):()=>lectura()});
            window.haikuSupabase={auth:{onAuthStateChange:()=>({}),getSession:async()=>({data:{session:{user:{id:'usuario-sintetico'}}}})},
                from:()=>lectura(),rpc:async()=>{throw Error('RPC prohibido en esta prueba');}};
            window.__lecturas=[];window.__eventos=[];
            for(const tipo of ['input','click']) window.addEventListener(tipo,e=>{
                const id=e.target.id||e.target.dataset?.haikuAccionRapida;
                if(id)window.__eventos.push({tipo,id,real:e.isTrusted,disabled:document.getElementById('haiku-asistente-enviar')?.disabled});
            },true);
            window.HAIKU_LIBRO_RESERVA_V1={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Oct26','Nov26'],
                consultarHoja:hoja=>{window.__lecturas.push(hoja);return new Promise((resolve,reject)=>{
                    window.__soltar=error=>error?reject(Error('LECTURA CONTROLADA')):resolve({reservas:[],advertencias:[]});
                });}};
        });
        for(const nombre of scripts)await page.addScriptTag({content:leer(nombre)});
        await page.locator('#haiku-asistente-boton').click();
        const acciones=['libro','libro-siguiente','servicios','servicios-siguiente'];
        for(const [i,accion] of acciones.entries()) {
            await page.locator('#haiku-asistente-rapidas summary').click();
            await page.locator(`[data-haiku-accion-rapida="${accion}"]`).click();
            await page.waitForFunction(n=>window.__lecturas.length===n,i+1);
            assert.equal(await page.evaluate(()=>window.HAIKU_ASISTENTE.procesando()),true);
            assert.equal(await page.locator('#haiku-asistente-texto').isDisabled(),true);
            assert.equal(await page.locator('#haiku-asistente-enviar').isDisabled(),true);
            assert.equal(await page.locator('[data-haiku-accion-rapida]:not(:disabled)').count(),0);
            // Ni input sintético ni un clic forzado deben desbloquear o sustituir la consulta activa.
            await page.evaluate(()=>{
                document.getElementById('haiku-asistente-texto').dispatchEvent(new Event('input',{bubbles:true}));
                document.querySelector('[data-haiku-accion-rapida="libro-siguiente"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
            });
            assert.equal(await page.locator('#haiku-asistente-enviar').isDisabled(),true);
            assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'');
            assert.equal(await page.evaluate(()=>window.__lecturas.length),i+1);
            await page.evaluate(error=>window.__soltar(error),i%2===0);
            await page.waitForFunction(()=>!window.HAIKU_ASISTENTE.procesando());
            assert.equal(await page.locator('[data-haiku-accion-rapida]:disabled').count(),0);
            assert.equal(await page.locator('#haiku-asistente-enviar').isDisabled(),true,'vacío al terminar éxito o error');
            assert.equal(await page.locator('#haiku-asistente-texto').isDisabled(),false);
        }
        assert.deepEqual(await page.evaluate(()=>window.__lecturas),['Oct26','Nov26','Oct26','Nov26']);
        assert.equal(await page.locator('.haiku-asistente-mensaje--usuario').count(),4);
        const eventos=await page.evaluate(()=>window.__eventos);
        assert.equal(eventos.filter(e=>e.tipo==='click'&&e.id==='haiku-asistente-enviar').length,4);
        assert.ok(eventos.filter(e=>e.tipo==='click'&&e.id==='haiku-asistente-enviar').every(e=>!e.disabled&&!e.real));
        assert.equal(eventos.filter(e=>e.tipo==='click'&&acciones.includes(e.id)&&e.real).length,4,'clics reales en atajos');
        // Los atajos incompletos siguen pidiendo información o abriendo el selector de archivos.
        await page.locator('#haiku-asistente-rapidas summary').click();
        await page.locator('#haiku-asistente-rapidas [data-haiku-accion-rapida="preparar-reserva"]').click();
        assert.match(await page.locator('#haiku-asistente-texto').inputValue(),/información que te indicaré/);
        await page.locator('#haiku-asistente-texto').evaluate(el=>{if(document.activeElement!==el)throw Error('Falta foco para completar');});
        for(const [accion,accept] of [['revisar-captura','image/png,image/jpeg,image/webp'],['consultar-documento','application/pdf']]) {
            await page.locator('#haiku-asistente-rapidas summary').click();
            const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator(`#haiku-asistente-rapidas [data-haiku-accion-rapida="${accion}"]`).click()]);
            assert.equal(await chooser.element().getAttribute('accept'),accept);
        }
        assert.equal(await page.locator('.haiku-asistente-mensaje--usuario').count(),4);
        assert.deepEqual(errores,[]);
    } finally {await page.close();}
}

(async () => {
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        // Aún es septiembre en Santiago cuando UTC ya pasó a octubre.
        await escenario(browser, '2026-10-01T02:30:00Z', ['Sep26', 'Oct26'], [
            { id: 'libro', tipo: 'libro', texto: /septiembre 2026.*01-09-2026 al 30-09-2026/, hoja: 'Sep26', resultado: 'LECTURA CONTROLADA Sep26' },
            { id: 'libro-siguiente', tipo: 'libro', texto: /octubre 2026.*01-10-2026 al 31-10-2026/, hoja: 'Oct26', resultado: 'LECTURA CONTROLADA Oct26' },
            { id: 'libro', tipo: 'libro', texto: /septiembre 2026.*01-09-2026 al 30-09-2026/, hoja: 'Sep26', resultado: 'LECTURA CONTROLADA Sep26' },
            { id: 'servicios', tipo: 'servicios', texto: /septiembre 2026.*01-09-2026 al 30-09-2026/, hoja: 'Sep26', resultado: 'LECTURA CONTROLADA Sep26' },
            { id: 'servicios-siguiente', tipo: 'servicios', texto: /octubre 2026.*01-10-2026 al 31-10-2026/, hoja: 'Oct26', resultado: 'LECTURA CONTROLADA Oct26' },
            { id: 'servicios', tipo: 'servicios', texto: /septiembre 2026.*01-09-2026 al 30-09-2026/, hoja: 'Sep26', resultado: 'LECTURA CONTROLADA Sep26' }
        ]);
        await escenario(browser, '2026-09-25T12:00:00Z', ['Sep26'], [
            { id: 'libro-siguiente', tipo: 'libro', texto: /octubre 2026.*01-10-2026 al 31-10-2026/, resultado: 'No encuentro la hoja oct26' },
            { id: 'servicios-siguiente', tipo: 'servicios', texto: /octubre 2026.*01-10-2026 al 31-10-2026/, resultado: 'No encuentro la hoja oct26' }
        ]);
        await escenario(browser, '2027-01-01T02:30:00Z', ['Dec26', 'Ene27'], [
            { id: 'libro-siguiente', tipo: 'libro', texto: /enero 2027.*01-01-2027 al 31-01-2027/, hoja: 'Ene27', resultado: 'LECTURA CONTROLADA Ene27' },
            { id: 'servicios-siguiente', tipo: 'servicios', texto: /enero 2027.*01-01-2027 al 31-01-2027/, hoja: 'Ene27', resultado: 'LECTURA CONTROLADA Ene27' }
        ], 390);
        await consultasPendientes(browser,1280);
        await consultasPendientes(browser,390);
        console.log('Haku: clic real único, bloqueo compartido, recuperación éxito/error, adjuntos, períodos Chile y móvil OK');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
