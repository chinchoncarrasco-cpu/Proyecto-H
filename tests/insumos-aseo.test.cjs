const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { crearSupabaseInsumos } = require('./fixtures/insumos-supabase-mock.cjs');
const source = fs.readFileSync(path.join(__dirname, '../js/supabase-insumos-aseo-v1.js'), 'utf8');
const realtime = fs.readFileSync(path.join(__dirname, '../js/supabase-aseo-realtime-v1.js'), 'utf8');
const fecha = '2026-09-26';
const siguiente = () => new Promise(resolve => setImmediate(resolve));
function arnes(remoto = crearSupabaseInsumos(), { tardio = false, canal = false, almacenamiento = new Map(), sesion = new Map(), usuario = 'operador' } = {}) {
    const escuchas = { window: new Map(), document: new Map() }, eventos = [], timers = new Map();
    let numTimer = 0;
    const superficie = tipo => ({
        addEventListener(nombre, fn) {
            if (!escuchas[tipo].has(nombre)) escuchas[tipo].set(nombre, []);
            escuchas[tipo].get(nombre).push(fn);
        },
        dispatchEvent(e) { eventos.push(e); for (const fn of escuchas[tipo].get(e.type) || []) fn(e); }
    });
    const storage = mapa => ({ get length() { return mapa.size; }, key: i => [...mapa.keys()][i] ?? null,
        getItem: k => mapa.get(k) ?? null, setItem: (k,v) => mapa.set(k,String(v)), removeItem: k => mapa.delete(k) });
    const window = { ...superficie('window'), innerWidth: 1440, crypto: require('node:crypto').webcrypto,
        localStorage: storage(almacenamiento), sessionStorage: storage(sesion),
        haikuSesion: tardio ? null : { usuario: { id: usuario } },
        haikuSupabase: tardio ? null : remoto.cliente };
    let volverCabanas = () => {};
    const document = { ...superficie('document'), readyState: 'complete', getElementById: () => null, activeElement: null,
        querySelector: selector => selector === '.menu-item[data-seccion="cabanas"]' ? { addEventListener(tipo,fn) { volverCabanas=fn; } } : null };
    const contexto = vm.createContext({ window, document, fechaSeleccionada: fecha,
        console: { error() {}, info() {}, warn() {} }, Date, Promise,
        CustomEvent: class { constructor(type, opciones) { this.type = type; this.detail = opciones?.detail; } },
        setTimeout(fn) { timers.set(++numTimer, fn); return numTimer; }, clearTimeout(id) { timers.delete(id); },
        setInterval(fn) { timers.set(++numTimer, fn); return numTimer; }
    });
    vm.runInContext(source, contexto);
    if (canal) vm.runInContext(realtime, contexto);
    return { ...remoto, window, document, contexto, escuchas, eventos, timers,
        almacenamiento, sesion, volverCabanas: () => volverCabanas(),
        api: window.HAIKU_INSUMOS_ASEO_V1,
        async cargar(f = fecha) { await window.HAIKU_INSUMOS_ASEO_V1.hidratar(f); },
        iniciar() {
            window.haikuSupabase = remoto.cliente;
            document.dispatchEvent({ type: 'haiku:supabase-ready' });
            window.haikuSesion = { usuario: { id: usuario } };
            window.dispatchEvent({ type: 'haiku:auth-ready' });
        }
    };
}
test('sin registros: cantidades cero, sin escrituras de hidratación', async () => {
    const h = arnes(); await h.cargar();
    assert.equal(h.api.obtener(fecha, 1).lena.cantidad, 0);
    assert.equal(h.api.obtener(fecha, 1).carbon.cantidad, 0);
    assert.equal(h.api.total(fecha).carbon, 0); assert.equal(h.control.escrituras.length, 0);
});
test('+ repetido actualiza el mismo movimiento; decremento hasta cero', async () => {
    const h = arnes(); await h.cargar();
    await h.api.cambiar(fecha, 1, 'carbon', 1);
    assert.equal(h.api.obtener(fecha, 1).carbon.cantidad, 1);
    const id = h.filas.movimientos_insumos[0].id;
    await h.api.cambiar(fecha, 1, 'carbon', 1);
    assert.equal(h.filas.movimientos_insumos.length, 1); assert.equal(h.filas.movimientos_insumos[0].id, id);
    assert.equal(h.api.total(fecha).carbon, 2);
    await h.api.cambiar(fecha, 1, 'carbon', -1); await h.api.cambiar(fecha, 1, 'carbon', -1);
    const escrituras = h.control.escrituras.length;
    await h.api.cambiar(fecha, 1, 'carbon', -1);
    assert.equal(h.control.escrituras.length, escrituras); assert.equal(h.api.total(fecha).carbon, 0);
});
test('dos insumos, dos cabañas y dos fechas mantienen cantidades y totales independientes', async () => {
    const h = arnes(); await h.cargar(); await h.cargar('2026-09-27');
    await h.api.agregarSaco(fecha,1,18.4); await h.api.agregarSaco(fecha,2,17.9);
    await h.api.cambiar(fecha,1,'carbon',1); await h.api.cambiar('2026-09-27',1,'carbon',1);
    assert.equal(h.api.total(fecha).lena, 2); assert.equal(h.api.total(fecha).carbon, 1);
    assert.equal(h.api.total(fecha).lenaKg, 36.3);
    assert.equal(h.api.total('2026-09-27').lena, 0); assert.equal(h.api.total('2026-09-27').carbon, 1);
    await h.api.anularSaco(fecha,2,h.api.obtener(fecha,2).lena.sacos[0].id);
    assert.equal(h.api.total(fecha).lena, 1); assert.equal(h.api.obtener(fecha,1).lena.cantidad, 1);
});
test('clicks rápidos comparten una sola escritura en curso', async () => {
    const h = arnes(); await h.cargar();
    let liberar; h.control.pausa = new Promise(r => { liberar = r; });
    const primera = h.api.cambiar(fecha,1,'carbon',1);
    assert.equal(h.api.cambiar(fecha,1,'carbon',1), primera);
    assert.equal(h.api.obtener(fecha,1).carbon.cantidad, 1);
    assert.equal(h.api.total(fecha).carbon, 0, 'El total sólo cuenta cantidades confirmadas');
    await siguiente(); assert.equal(h.control.escrituras.length, 1);
    liberar(); await primera; assert.equal(h.api.total(fecha).carbon, 1);
});
test('error de escritura revierte el valor optimista y no modifica el total', async () => {
    const h = arnes(); await h.cargar(); h.control.fallar = true;
    const p = h.api.cambiar(fecha,1,'carbon',1);
    assert.equal(h.api.obtener(fecha,1).carbon.cantidad, 1);
    await assert.rejects(p, /rechazada/); await h.cargar();
    assert.equal(h.api.obtener(fecha,1).carbon.cantidad, 0); assert.equal(h.api.total(fecha).carbon, 0);
    assert.match(h.api.obtener(fecha,1).carbon.error, /No se confirmó/);
});
test('respuesta perdida tras commit se reconcilia sin repetir el incremento', async () => {
    const h = arnes(); await h.cargar(); h.control.respuestaPerdida = true;
    await assert.rejects(h.api.cambiar(fecha,1,'carbon',1), /perdida/);
    await h.cargar(); assert.equal(h.api.obtener(fecha,1).carbon.cantidad, 1);
    assert.equal(h.control.escrituras.length, 1);
});
test('recargar recupera datos reales e ignora origen solicitud', async () => {
    const h = arnes(); await h.cargar(); await h.api.cambiar(fecha,1,'carbon',1);
    h.filas.movimientos_insumos.push({ fecha_operativa:fecha, origen:'solicitud', insumo:'carbon', cantidad:99 });
    const nueva = arnes(h); await nueva.cargar();
    assert.equal(nueva.api.obtener(fecha,1).carbon.cantidad, 1); assert.equal(nueva.api.total(fecha).carbon, 1);
    assert.equal(h.control.escrituras.length, 1);
});
test('dos dispositivos: realtime actualiza cantidad y total sin writes derivados', async () => {
    const remoto = crearSupabaseInsumos(), a = arnes(remoto, { canal:true }), b = arnes(remoto, { canal:true });
    await a.cargar(); await b.cargar();
    await a.api.cambiar(fecha,1,'carbon',1); await b.cargar();
    assert.equal(b.api.obtener(fecha,1).carbon.cantidad, 1); assert.equal(b.api.total(fecha).carbon, 1);
    await b.api.agregarSaco(fecha,1,18.4); await siguiente();
    assert.equal(a.api.total(fecha).lena, 1, JSON.stringify({ canales: remoto.control.canales.length, filas: remoto.filas.movimientos_insumos, eventos: a.eventos, total: a.api.total(fecha) }));
    assert.equal(remoto.control.escrituras.length, 2);
    assert.ok(a.eventos.some(e => e.type === 'haiku:insumos-actualizados'));
});

test('realtime de otra fecha: A=1, ir a B, A=3 remoto, volver a A muestra 3 sin escrituras', async () => {
    const h = arnes(undefined, { canal:true }), otra = '2026-09-27';
    h.filas.movimientos_insumos.push({ id:'mov-a', fecha_operativa:fecha, cabana_id:'cab-1',
        aseo_id:'aseo-a', insumo:'carbon', unidad:'unidad', origen:'aseo', cantidad:1 });
    await h.cargar();
    assert.equal(h.api.total(fecha).carbon, 1);
    h.contexto.fechaSeleccionada = otra;
    await h.api.hidratar(otra, { forzar:false });
    const lecturas = h.control.lecturas.length;
    h.filas.movimientos_insumos[0].cantidad = 3;
    h.emitir('movimientos_insumos', { new:h.filas.movimientos_insumos[0] });
    await siguiente();
    assert.equal(h.control.lecturas.length, lecturas, 'No consulta otra fecha mientras B está visible');
    assert.equal(h.api.total(otra).carbon, 0);
    h.contexto.fechaSeleccionada = fecha;
    h.document.dispatchEvent({ type:'haiku:resumen-datos-actualizados', detail:{fecha} });
    await h.api.hidratar(fecha, { forzar:false });
    assert.ok(h.control.lecturas.length > lecturas);
    assert.equal(h.api.obtener(fecha,1).carbon.cantidad, 3);
    assert.equal(h.api.total(fecha).carbon, 3);
    assert.equal(h.control.escrituras.length, 0);
    assert.equal(h.control.canales.length, 1);
});

test('payload sin fecha invalida días cargados; una lectura pendiente no restaura datos anteriores al evento', async () => {
    const h = arnes(undefined, { canal:true }); await h.cargar();
    let liberar; h.control.pausaLectura = new Promise(r => { liberar = r; });
    const leyendo = h.api.hidratar(fecha); await siguiente();
    h.filas.movimientos_insumos.push({ id:'mov-a', fecha_operativa:fecha, cabana_id:'cab-1',
        aseo_id:'aseo-a', insumo:'carbon', unidad:'unidad', origen:'aseo', cantidad:3 });
    h.emitir('movimientos_insumos', { old:{id:'mov-a'} });
    h.control.pausaLectura = null; liberar(); await leyendo;
    assert.equal(h.api.total(fecha).carbon, 3);
    assert.equal(h.control.escrituras.length, 0);
});

test('dos dispositivos intentan simultáneamente 1→2: un éxito, un conflicto y total 2', async () => {
    const remoto = crearSupabaseInsumos();
    remoto.filas.movimientos_insumos.push({ id:'mov-a', fecha_operativa:fecha, cabana_id:'cab-1',
        aseo_id:'aseo-a', insumo:'carbon', unidad:'unidad', origen:'aseo', cantidad:1 });
    const a = arnes(remoto, { canal:true }), b = arnes(remoto, { canal:true });
    await a.cargar(); await b.cargar();
    let liberar; remoto.control.pausa = new Promise(r => { liberar = r; });
    const resultados = Promise.allSettled([a.api.cambiar(fecha,1,'carbon',1), b.api.cambiar(fecha,1,'carbon',1)]);
    await siguiente(); liberar();
    assert.deepEqual((await resultados).map(r => r.status).sort(), ['fulfilled','rejected']);
    await a.cargar(); await b.cargar();
    assert.equal(a.api.total(fecha).carbon, 2); assert.equal(b.api.total(fecha).carbon, 2);
    assert.equal(remoto.filas.movimientos_insumos.length, 1);
    assert.equal(remoto.control.escrituras.length, 2, 'Dos intentos explícitos, sin reintento automático');
});
test('lectura anterior a una escritura no puede restaurar una cantidad obsoleta', async () => {
    const h = arnes(); await h.cargar();
    let liberar; h.control.pausaLectura = new Promise(r => { liberar = r; });
    const leyendo = h.api.hidratar(fecha); await siguiente();
    await h.api.cambiar(fecha,1,'carbon',1);
    h.control.pausaLectura = null; liberar(); await leyendo;
    assert.equal(h.api.total(fecha).carbon, 1); assert.equal(h.api.obtener(fecha,1).carbon.cantidad, 1);
});
test('un error de lectura se muestra como no verificado y bloquea escrituras', async () => {
    const h = arnes(); h.control.fallarLectura = true; await h.cargar();
    assert.equal(h.api.obtener(fecha,1).listo, false);
    await assert.rejects(h.api.cambiar(fecha,1,'carbon',1), /verifique/);
    h.control.fallarLectura = false; await h.cargar(); assert.equal(h.api.total(fecha).listo, true);
});
test('cliente tardío, reinicialización y relectura de scripts no duplican listeners ni canal', async () => {
    const h = arnes(undefined, { tardio:true, canal:true });
    h.iniciar(); h.iniciar(); await h.cargar();
    const listeners = () => [...h.escuchas.window.values(), ...h.escuchas.document.values()].reduce((n,l) => n + l.length,0);
    const antes = listeners(), auth = h.control.auth.length, timers = h.timers.size;
    vm.runInContext(source,h.contexto); vm.runInContext(realtime,h.contexto);
    h.iniciar(); await h.cargar();
    assert.equal(listeners(), antes); assert.equal(h.control.auth.length, auth);
    assert.equal(h.control.canales.length, 1); assert.equal(h.timers.size, timers);
    assert.equal(h.control.canales[0].eventos.filter(e => e.filtro.table === 'movimientos_insumos').length, 1);
    await h.api.cambiar(fecha,1,'carbon',1); assert.equal(h.control.escrituras.length, 1);
});
test('salir de sesión descarta una lectura pendiente de otro usuario', async () => {
    const h = arnes(); await h.cargar();
    let liberar; h.control.pausaLectura = new Promise(r => { liberar = r; });
    const p = h.api.hidratar(fecha); await siguiente();
    h.window.haikuSesion = null; h.control.auth.forEach(fn => fn('SIGNED_OUT'));
    liberar(); await p; assert.equal(h.api.total(fecha).listo, false);
});
test('una reconexión lenta y auth-ready simultáneos no dejan canales duplicados', async () => {
    const h = arnes(undefined, { canal:true }); await h.cargar(); await siguiente();
    const inicial = h.control.canales[0];
    inicial.estado('CHANNEL_ERROR');
    const quitar = h.cliente.removeChannel;
    let liberar;
    const demora = new Promise(r => { liberar = r; });
    h.cliente.removeChannel = async canal => { await demora; return quitar(canal); };
    h.window.dispatchEvent({type:'haiku:auth-ready'});
    h.window.dispatchEvent({type:'haiku:auth-ready'});
    liberar(); await siguiente();
    assert.equal(h.control.canales.filter(c => !c.removido).length,1);
    assert.equal(h.control.canales.length,2);
});
test('salir antes del envío cancela la escritura pendiente de la sesión anterior', async () => {
    const h = arnes(); await h.cargar();
    const p = h.api.cambiar(fecha,1,'carbon',1);
    h.window.haikuSesion = null; h.control.auth.forEach(fn => fn('SIGNED_OUT'));
    await p; assert.equal(h.control.escrituras.length,0);
});

test('Leña registra 18.4 y 17.9: dos sacos, 36.3 kg; anula sin borrar ni usar contador', async () => {
    const h = arnes(undefined, {canal:true}); await h.cargar();
    await h.api.agregarSaco(fecha,1,18.4); await h.api.agregarSaco(fecha,1,17.9);
    const dato = h.api.obtener(fecha,1).lena;
    assert.equal(dato.cantidad,2); assert.equal(dato.pesoKg,36.3); assert.equal(dato.sacos.length,2);
    assert.equal(h.filas.movimientos_insumos[0].cantidad,null);
    await assert.rejects(h.api.cambiar(fecha,1,'lena',1), /peso/);
    await h.api.anularSaco(fecha,1,dato.sacos[0].id);
    assert.equal(h.api.total(fecha).lena,1); assert.equal(h.api.total(fecha).lenaKg,17.9);
    assert.equal(h.filas.movimientos_insumos_unidades.length,2);
    await h.api.cambiar(fecha,1,'carbon',1);
    assert.equal(h.api.obtener(fecha,1).carbon.cantidad,1);
    assert.equal(h.filas.movimientos_insumos_unidades.length,2,'Carbón no crea hijos');
});

test('saco pendiente deduplica clicks; respuesta perdida se reconcilia sin repetir alta', async () => {
    const h = arnes(); await h.cargar();
    for (const peso of [0,-1,'',NaN,Infinity]) await assert.rejects(h.api.agregarSaco(fecha,1,peso), /peso/);
    assert.equal(h.control.escrituras.length,0);
    let liberar; h.control.pausa = new Promise(r => { liberar = r; });
    const p = h.api.agregarSaco(fecha,1,18.4);
    assert.equal(h.api.agregarSaco(fecha,1,18.4),p);
    assert.equal(h.api.total(fecha).lena,0);
    h.control.respuestaPerdida = true; liberar();
    await p; await h.cargar();
    assert.equal(h.api.total(fecha).lena,1); assert.equal(h.api.total(fecha).lenaKg,18.4);
    assert.equal(h.control.escrituras.length,1);
});

test('respuesta perdida: durante la verificación no se habilita otra alta ni se cambia su UUID', async () => {
    const h = arnes(); await h.cargar();
    let liberar; h.control.pausaVerificacion = new Promise(r => { liberar=r; });
    h.control.respuestaPerdida = true;
    const primera = h.api.agregarSaco(fecha,1,18.4);
    await siguiente();
    assert.equal(h.api.obtener(fecha,1).lena.alta.estado,'verificando');
    assert.equal(h.api.obtener(fecha,1).lena.guardando,true);
    assert.equal(h.api.agregarSaco(fecha,1,18.4),primera);
    assert.equal(h.control.escrituras.length,1);
    liberar(); await primera;
    assert.equal(h.api.total(fecha).lena,1); assert.equal(h.api.total(fecha).lenaKg,18.4);
    assert.equal(h.api.obtener(fecha,1).lena.alta,null);
});

test('sin commit: retry conserva UUID; sólo el siguiente saco confirmado obtiene otro UUID', async () => {
    const h = arnes(); await h.cargar(); h.control.respuestaPerdidaSinCommit=true;
    await assert.rejects(h.api.agregarSaco(fecha,1,18.4),/Reintenta este mismo saco/);
    await h.cargar();
    const id = h.control.escrituras[0].p.p_unidad_id;
    assert.equal(h.filas.movimientos_insumos_unidades.length,0);
    assert.equal(h.api.obtener(fecha,1).lena.alta.estado,'reintentar');
    await assert.rejects(h.api.agregarSaco(fecha,1,19),/pendiente/);
    h.control.respuestaPerdidaSinCommit=false;
    await h.api.agregarSaco(fecha,1,18.4);
    assert.equal(h.control.escrituras[1].p.p_unidad_id,id);
    assert.equal(h.api.total(fecha).lena,1);
    await h.api.agregarSaco(fecha,1,18.4);
    assert.notEqual(h.control.escrituras[2].p.p_unidad_id,id);
    assert.equal(h.api.total(fecha).lena,2); assert.equal(h.api.total(fecha).lenaKg,36.8);
});

test('verificación fallida y recarga conservan el intento; recuperar red sólo lee el UUID existente', async () => {
    const remoto=crearSupabaseInsumos(), almacenamiento=new Map();
    const a=arnes(remoto,{almacenamiento}); await a.cargar();
    remoto.control.respuestaPerdida=true; remoto.control.fallarVerificacion=true;
    await assert.rejects(a.api.agregarSaco(fecha,1,18.4),/Vuelve a verificar/);
    await a.cargar();
    assert.equal(a.api.obtener(fecha,1).lena.guardando,false);
    const b=arnes(remoto,{almacenamiento}); await b.cargar();
    assert.equal(b.api.obtener(fecha,1).lena.alta.estado,'incierto');
    await assert.rejects(b.api.agregarSaco(fecha,1,18.4),/Vuelve a verificar/);
    assert.equal(remoto.control.escrituras.length,1);
    remoto.control.fallarVerificacion=false;
    await b.api.agregarSaco(fecha,1,18.4);
    assert.equal(remoto.control.escrituras.length,1);
    assert.equal(b.api.total(fecha).lena,1);
    assert.equal(b.api.obtener(fecha,1).lena.alta,null);
});

test('edición conserva UUID y COUNT, cambia SUM e historial; realtime remoto no escribe', async () => {
    const remoto=crearSupabaseInsumos(), a=arnes(remoto,{canal:true}), b=arnes(remoto,{canal:true});
    await a.cargar(); await b.cargar();
    await a.api.agregarSaco(fecha,1,18.4); await b.cargar();
    const saco=a.api.obtener(fecha,1).lena.sacos[0];
    for (const peso of [0,-1,NaN,Infinity]) await assert.rejects(a.api.editarSaco(fecha,1,saco.id,peso,1),/peso/);
    await a.api.editarSaco(fecha,1,saco.id,18.7,saco.version);
    await b.cargar();
    assert.equal(b.api.total(fecha).lena,1); assert.equal(b.api.total(fecha).lenaKg,18.7);
    assert.equal(b.api.obtener(fecha,1).lena.sacos[0].id,saco.id);
    assert.equal(remoto.control.escrituras.length,2);
    const historial=remoto.filas.movimientos_insumos_unidades_historial;
    assert.equal(historial[0].peso_anterior,18.4); assert.equal(historial[0].peso_nuevo,18.7);
    await assert.rejects(b.api.editarSaco(fecha,1,saco.id,19,saco.version),/otro dispositivo/);
    await b.cargar();
    assert.equal(b.api.total(fecha).lenaKg,18.7); assert.equal(historial.length,1);
    await b.api.anularSaco(fecha,1,saco.id);
    assert.equal(b.api.total(fecha).lena,0); assert.equal(historial.length,1);
    await a.cargar(); await a.api.agregarSaco(fecha,1,18.4,saco.id);
    assert.equal(a.api.total(fecha).lena,0,'Retry original no revive un saco editado y anulado');
});

test('dos ediciones simultáneas con versión 1 producen un éxito y un conflicto', async () => {
    const remoto=crearSupabaseInsumos(), a=arnes(remoto), b=arnes(remoto);
    await a.cargar(); await a.api.agregarSaco(fecha,1,18.4); await b.cargar();
    const id=a.api.obtener(fecha,1).lena.sacos[0].id;
    const resultados=await Promise.allSettled([a.api.editarSaco(fecha,1,id,18.7,1),b.api.editarSaco(fecha,1,id,19,1)]);
    assert.equal(resultados.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(resultados.filter(r=>r.status==='rejected').length,1);
    await a.cargar(); await b.cargar();
    assert.equal(a.api.total(fecha).lenaKg,18.7); assert.equal(b.api.total(fecha).lenaKg,18.7);
    assert.equal(remoto.filas.movimientos_insumos_unidades_historial.length,1);
});

test('reconciliar alta ya corregida usa peso original del historial, nunca crea otro saco', async () => {
    const remoto=crearSupabaseInsumos(), a=arnes(remoto), b=arnes(remoto);
    await a.cargar(); remoto.control.respuestaPerdida=true; remoto.control.fallarVerificacion=true;
    await assert.rejects(a.api.agregarSaco(fecha,1,18.4));
    remoto.control.respuestaPerdida=false; await b.cargar();
    const saco=b.api.obtener(fecha,1).lena.sacos[0];
    await b.api.editarSaco(fecha,1,saco.id,18.7,1);
    remoto.control.fallarVerificacion=false;
    await a.api.agregarSaco(fecha,1,18.4);
    assert.equal(remoto.control.escrituras.length,2);
    assert.equal(a.api.total(fecha).lena,1); assert.equal(a.api.total(fecha).lenaKg,18.7);
});

test('UUID con peso o cabecera ajenos queda incierto y no se reemplaza por otro UUID', async () => {
    for (const [peso,numero] of [[19,1],[18.4,2]]) {
        const h=arnes(); await h.cargar(); await h.api.agregarSaco(fecha,1,18.4);
        const id=h.api.obtener(fecha,1).lena.sacos[0].id;
        await assert.rejects(h.api.agregarSaco(fecha,numero,peso,id),/verificar/);
        assert.equal(h.api.obtener(fecha,numero).lena.alta.estado,'incierto');
        await assert.rejects(h.api.agregarSaco(fecha,numero,peso),/verificar/);
        assert.equal(h.filas.movimientos_insumos_unidades.length,1);
        assert.equal(h.control.escrituras.length,2,'El siguiente intento sólo verifica, sin RPC ni nuevo UUID');
    }
});

test('edición remota de una fecha no visible se relee al volver sin escrituras derivadas', async () => {
    const remoto=crearSupabaseInsumos(), a=arnes(remoto,{canal:true}), b=arnes(remoto);
    await a.cargar(); await a.api.agregarSaco(fecha,1,18.4); await a.cargar(); await b.cargar();
    const saco=b.api.obtener(fecha,1).lena.sacos[0];
    a.contexto.fechaSeleccionada='2026-09-27'; await a.cargar('2026-09-27');
    await b.api.editarSaco(fecha,1,saco.id,18.7,saco.version);
    assert.equal(a.api.total('2026-09-27').lena,0);
    a.contexto.fechaSeleccionada=fecha; await a.api.hidratar(fecha,{forzar:false});
    assert.equal(a.api.total(fecha).lena,1); assert.equal(a.api.total(fecha).lenaKg,18.7);
    assert.equal(remoto.control.escrituras.length,2);
    assert.equal(remoto.control.canales.filter(c=>!c.removido).length,1);
});

test('Leña entre fechas: A=1, ir a B, llegan dos sacos a A, volver muestra 3 y sus kg', async () => {
    const h = arnes(undefined,{canal:true}), otra = '2026-09-27'; await h.cargar();
    await h.api.agregarSaco(fecha,1,18.4); await h.cargar();
    const movimiento = h.filas.movimientos_insumos[0];
    h.contexto.fechaSeleccionada = otra; await h.api.hidratar(otra,{forzar:false});
    const escrituras = h.control.escrituras.length, lecturas = h.control.lecturas.length;
    h.filas.movimientos_insumos_unidades.push({id:'remoto-1',movimiento_id:movimiento.id,peso_kg:17.9},
        {id:'remoto-2',movimiento_id:movimiento.id,peso_kg:18.1});
    h.emitir('movimientos_insumos_unidades',{new:{movimiento_id:movimiento.id}});
    await siguiente(); assert.equal(h.control.lecturas.length,lecturas);
    h.contexto.fechaSeleccionada = fecha;
    await h.api.hidratar(fecha,{forzar:false});
    assert.equal(h.api.obtener(fecha,1).lena.cantidad,3); assert.equal(h.api.total(fecha).lenaKg,54.4);
    assert.equal(h.api.total(otra).lena,0); assert.equal(h.control.escrituras.length,escrituras);
    assert.equal(h.control.canales.length,1);
});

test('dos dispositivos agregan sacos distintos sin sobrescribirse; mismo UUID no duplica', async () => {
    const remoto = crearSupabaseInsumos(), a = arnes(remoto,{canal:true}), b = arnes(remoto,{canal:true});
    await a.cargar(); await b.cargar();
    await Promise.all([a.api.agregarSaco(fecha,1,18.4),b.api.agregarSaco(fecha,1,17.9)]);
    await a.cargar(); await b.cargar();
    assert.equal(a.api.total(fecha).lena,2); assert.equal(b.api.total(fecha).lenaKg,36.3);
    const id = a.api.obtener(fecha,1).lena.sacos[0].id;
    await a.api.agregarSaco(fecha,1,18.4,id);
    assert.equal(a.api.total(fecha).lena,2);
});

const altasDurables = almacenamiento => [...almacenamiento.entries()]
    .filter(([k])=>k.startsWith('haikuSacosPendientesV2:')).map(([llave,valor])=>({llave,alta:JSON.parse(valor)}));
async function dejarAltaIncierta(h, { commit=true, numero=1, dia=fecha }={}) {
    await h.cargar(dia);
    h.control.respuestaPerdida=commit; h.control.respuestaPerdidaSinCommit=!commit; h.control.fallarVerificacion=true;
    await assert.rejects(h.api.agregarSaco(dia,numero,18.4),/verificar/);
    await h.cargar(dia);
    return altasDurables(h.almacenamiento).find(({alta})=>alta.fecha===dia && alta.numero===String(numero)).alta;
}
function recuperarRed(h) {
    h.control.respuestaPerdida=false; h.control.respuestaPerdidaSinCommit=false; h.control.fallarVerificacion=false;
}

for (const cierre of ['reload','cerrar pestaña y reabrir con sessionStorage vacío']) {
    test(`durable: commit remoto y ${cierre} reconcilian UUID sin escribir ni duplicar`, async () => {
        const remoto=crearSupabaseInsumos(), almacenamiento=new Map(), sesion=new Map();
        const a=arnes(remoto,{almacenamiento,sesion});
        const alta=await dejarAltaIncierta(a); recuperarRed(a);
        assert.ok(Number.isFinite(Date.parse(alta.creadoEn)));
        assert.deepEqual(Object.keys(alta).sort(),['id','usuario','fecha','numero','cabanaId','aseoId','movimientoId','insumo','pesoKg','creadoEn'].sort());
        const b=arnes(remoto,{almacenamiento,sesion:cierre==='reload' ? sesion : new Map()});
        await b.cargar();
        assert.equal(b.api.total(fecha).lena,1); assert.equal(b.api.total(fecha).lenaKg,18.4);
        assert.equal(remoto.filas.movimientos_insumos_unidades[0].id,alta.id);
        assert.equal(remoto.control.escrituras.length,1,'Arrancar sólo consulta Supabase');
        assert.equal(altasDurables(almacenamiento).length,0,'Confirmación limpia la entrada durable');
        await b.api.agregarSaco(fecha,1,18.4);
        assert.notEqual(remoto.control.escrituras[1].p.p_unidad_id,alta.id,'Otro saco legítimo genera un UUID distinto');
        assert.equal(b.api.total(fecha).lena,2); assert.equal(altasDurables(almacenamiento).length,0);
    });
}

test('durable: sin commit, cerrar/reabrir ofrece retry con el mismo UUID', async () => {
    const remoto=crearSupabaseInsumos(), almacenamiento=new Map(), a=arnes(remoto,{almacenamiento});
    const alta=await dejarAltaIncierta(a,{commit:false}); recuperarRed(a);
    const b=arnes(remoto,{almacenamiento}); await b.cargar();
    assert.equal(b.api.obtener(fecha,1).lena.alta.estado,'reintentar');
    assert.equal(remoto.control.escrituras.length,1); assert.equal(altasDurables(almacenamiento)[0].alta.id,alta.id);
    await b.api.agregarSaco(fecha,1,18.4);
    assert.equal(remoto.control.escrituras[1].p.p_unidad_id,alta.id);
    assert.equal(b.api.total(fecha).lena,1); assert.equal(altasDurables(almacenamiento).length,0);
});

test('durable: intento antiguo existente se consulta por UUID antes de limpiarse', async () => {
    const remoto=crearSupabaseInsumos(), almacenamiento=new Map(), a=arnes(remoto,{almacenamiento});
    await dejarAltaIncierta(a); recuperarRed(a);
    const {llave,alta}=altasDurables(almacenamiento)[0]; alta.creadoEn='2000-01-01T00:00:00.000Z';
    almacenamiento.set(llave,JSON.stringify(alta));
    let liberar; remoto.control.pausaVerificacion=new Promise(r=>{liberar=r;});
    const b=arnes(remoto,{almacenamiento}); const lectura=b.cargar(); await siguiente();
    assert.equal(altasDurables(almacenamiento).length,1,'La edad no elimina la identidad antes de consultar');
    assert.equal(b.api.obtener(fecha,1).lena.alta.estado,'verificando');
    liberar(); await lectura;
    assert.equal(altasDurables(almacenamiento).length,0); assert.equal(b.api.total(fecha).lena,1);
    assert.equal(remoto.control.escrituras.length,1);
});

test('durable: intento antiguo ausente conserva UUID y permite resolverlo; no caduca a un alta nueva', async () => {
    const remoto=crearSupabaseInsumos(), almacenamiento=new Map(), a=arnes(remoto,{almacenamiento});
    await dejarAltaIncierta(a,{commit:false}); recuperarRed(a);
    const {llave,alta}=altasDurables(almacenamiento)[0]; alta.creadoEn='2000-01-01T00:00:00.000Z';
    almacenamiento.set(llave,JSON.stringify(alta));
    const b=arnes(remoto,{almacenamiento}); await b.cargar();
    assert.match(b.api.obtener(fecha,1).lena.error,/Intento antiguo verificado/);
    assert.equal(altasDurables(almacenamiento)[0].alta.id,alta.id);
    await b.api.agregarSaco(fecha,1,18.4);
    assert.equal(remoto.control.escrituras[1].p.p_unidad_id,alta.id);
    assert.equal(altasDurables(almacenamiento).length,0);
});

test('durable: otro usuario no recupera intentos ajenos; fecha y cabaña mantienen UUID separados', async () => {
    const remoto=crearSupabaseInsumos(), almacenamiento=new Map(), a=arnes(remoto,{almacenamiento});
    const primera=await dejarAltaIncierta(a,{commit:false});
    const cabana2=await dejarAltaIncierta(a,{commit:false,numero:2});
    const otroDia=await dejarAltaIncierta(a,{commit:false,dia:'2026-09-27'});
    recuperarRed(a);
    assert.equal(new Set([primera.id,cabana2.id,otroDia.id]).size,3);
    const b=arnes(remoto,{almacenamiento,usuario:'otro-usuario'}); await b.cargar();
    assert.equal(b.api.obtener(fecha,1).lena.alta,null);
    await b.api.agregarSaco(fecha,1,18.4);
    assert.notEqual(remoto.control.escrituras.at(-1).p.p_unidad_id,primera.id);
    assert.equal(altasDurables(almacenamiento).length,3,'No limpia intentos del otro usuario');
    const vuelve=arnes(remoto,{almacenamiento}); await vuelve.cargar();
    await vuelve.api.agregarSaco(fecha,2,18.4);
    assert.equal(remoto.control.escrituras.at(-1).p.p_unidad_id,cabana2.id);
    await vuelve.api.agregarSaco('2026-09-27',1,18.4);
    assert.equal(remoto.control.escrituras.at(-1).p.p_unidad_id,otroDia.id);
    assert.equal(altasDurables(almacenamiento)[0].alta.id,primera.id);
});

test('durable: aseo cambiado es conflicto; conserva el intento y no envía otra RPC', async () => {
    const remoto=crearSupabaseInsumos(), almacenamiento=new Map(), a=arnes(remoto,{almacenamiento});
    await a.cargar(); await a.api.agregarSaco(fecha,1,17.9);
    const alta=await dejarAltaIncierta(a,{commit:false}); recuperarRed(a);
    remoto.filas.movimientos_insumos[0].aseo_id='otro-aseo';
    const b=arnes(remoto,{almacenamiento}); await b.cargar();
    assert.match(b.api.obtener(fecha,1).lena.error,/Conflicto/);
    await assert.rejects(b.api.agregarSaco(fecha,1,18.4),/Conflicto/);
    assert.equal(remoto.control.escrituras.length,2); assert.equal(altasDurables(almacenamiento)[0].alta.id,alta.id);
});

test('durable: volver a Cabañas reconcilia y limpia un intento sin recargar la pestaña', async () => {
    const h=arnes(); await dejarAltaIncierta(h); recuperarRed(h);
    h.volverCabanas(); await h.cargar();
    assert.equal(h.api.total(fecha).lena,1); assert.equal(h.almacenamiento.size,0);
    assert.equal(h.control.escrituras.length,1);
});

test('durable: almacenamiento bloqueado impide enviar el alta; no usa memoria como sustituto', async () => {
    const h=arnes(); await h.cargar();
    h.window.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
    await assert.rejects(h.api.agregarSaco(fecha,1,18.4),/almacenamiento local/);
    assert.equal(h.control.escrituras.length,0); assert.equal(h.filas.movimientos_insumos_unidades.length,0);
    assert.match(h.api.obtener(fecha,1).lena.error,/almacenamiento local/);
});

test('durable: registros de dos intentos del mismo contexto no se sobrescriben al reconciliar', async () => {
    const remoto=crearSupabaseInsumos(), a=arnes(remoto), b=arnes(remoto);
    await dejarAltaIncierta(a); await dejarAltaIncierta(b);
    const almacenamiento=new Map([...a.almacenamiento,...b.almacenamiento]); recuperarRed(a);
    assert.equal(almacenamiento.size,2);
    const c=arnes(remoto,{almacenamiento}); await c.cargar();
    assert.equal(c.api.total(fecha).lena,2); assert.equal(almacenamiento.size,0);
    assert.equal(remoto.control.escrituras.length,2);
});

test('durable: conserva el UUID de sessionStorage V1 al actualizar el cliente', async () => {
    const remoto=crearSupabaseInsumos(), a=arnes(remoto);
    const alta=await dejarAltaIncierta(a); recuperarRed(a);
    delete alta.insumo; delete alta.creadoEn;
    const sesion=new Map([['haikuSacosPendientesV1:operador',JSON.stringify([alta])]]), almacenamiento=new Map();
    const b=arnes(remoto,{almacenamiento,sesion}); await b.cargar();
    assert.equal(b.api.total(fecha).lena,1); assert.equal(almacenamiento.size,0); assert.equal(sesion.size,0);
    assert.equal(remoto.control.escrituras.length,1);
});
