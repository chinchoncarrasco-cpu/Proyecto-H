const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {PAGO_AGUSTIN_RUNTIME} = require('./fixtures/libro-airbnb-agustin-runtime.cjs');
const read = f => fs.readFileSync(path.join(__dirname,'..','js',f),'utf8');
const S = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_SEMANTICA = S;
const Q = require('../js/haiku-libro-consultas-v1.js');
const METHOD = 'airbnb_prepaid_card';
const LABEL = 'Airbnb Prepaid Card';
const AIRBNB_AGUSTIN = [
    'El viajero ha pagado ...',
    'Comisión de servicio del viajero ...',
    'Impuesto sobre el uso de la propiedad ...',
    'Precio de la habitación ...',
    'Comisión de servicio del anfitrión ...',
    'Ganás ...'
].join('\n');

// Isolate real pure/controller functions from UI bootstrapping, as the existing
// controller suites do. No mock implementation of payment validation.
function funcion(file, name) {
    const text = read(file), start = text.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, `${file}:${name}`);
    const lineEnd = text.indexOf('\n',start);
    if (/\}\s*$/.test(text.slice(start,lineEnd))) return text.slice(start,lineEnd);
    const end = text.indexOf('\n    }',start);
    assert.ok(end > start, `${name} end`);
    return text.slice(start,end+6);
}
function funciones(file, names, extras = {}, mapas = []) {
    const context = vm.createContext({ Date, Intl, Math, console, window:{}, ...extras });
    const constants = mapas.map(name => {
        const found = read(file).match(new RegExp(`const ${name} = Object.freeze\\(\\{[\\s\\S]*?\\}\\);`));
        assert.ok(found,name); return found[0];
    }).join('\n');
    vm.runInContext(constants+'\n'+names.map(n=>funcion(file,n)).join('\n'),context);
    return context;
}
function canon() {
    const context = { document:{readyState:'complete',getElementById(){return null},head:{appendChild(){}},createElement(){return {}}},
        HAIKU_LIBRO_RESERVA_V1:{consultarHoja:async x=>x} };
    vm.runInNewContext(read('haiku-libro-pagos-canon-v1.js'),context);
    return context.HAIKU_LIBRO_PAGOS_CANON_V1;
}
const C = canon();

test('texto exacto de Agustin capturado en Edge: la misma función del resolver acredita Airbnb sin confiar en medio_pago', () => {
    const before = JSON.stringify(PAGO_AGUSTIN_RUNTIME);
    assert.equal(C.medioDesdeTexto({...PAGO_AGUSTIN_RUNTIME, medio_pago: null}), METHOD);
    assert.equal(JSON.stringify(PAGO_AGUSTIN_RUNTIME), before);
    assert.equal(PAGO_AGUSTIN_RUNTIME.fecha_comprobante, null);
    for (const texto_original of ['Airbnb', 'El viajero ha pagado', 'Comisión de servicio']) {
        assert.equal(C.medioDesdeTexto({...PAGO_AGUSTIN_RUNTIME, texto_original, medio_pago: null}), null);
    }
});

test('canonical parser retains literal case-insensitive recognition and real optional reference without mutating source',()=>{
    for (const texto of ['Airbnb Prepaid Card','AIRBNB PREPAID CARD','AirBnb Prepaid Card','Airbnb  Prepaid   Card']) {
        assert.equal(C.medioDesdeTexto({texto_original:texto}), METHOD);
    }
    for (const texto of ['Airbnb','Reserva Airbnb // cab4/1noche','Airbnb Card','Airbnb Prepaid','Airbnb Prepaid Cards']) {
        assert.notEqual(C.medioDesdeTexto({texto_original:texto}), METHOD);
    }
    const original = Object.freeze({texto_original:'Airbnb Prepaid Card // Referencia Airbnb: AIR-00004',monto:165598});
    const corrected = C.corregirPago(original);
    assert.equal(corrected.referencia_externa,'AIR-00004');
    assert.equal(original.referencia_externa,undefined);
    assert.equal(C.corregirPago({texto_original:LABEL}).referencia_externa,undefined);
    assert.equal(C.corregirPago({texto_original:LABEL+' // Referencia Airbnb: A1 // Referencia Airbnb: A2'}).referencia_externa,undefined);
    assert.equal(C.medioDesdeTexto({texto_original:'WebPay Crédito'}),'webpay_credito');
    assert.equal(C.medioDesdeTexto({texto_original:'Efectivo'}),'efectivo');
});

test('Airbnb receipt requires the primary paid-traveler signal and two distinct breakdown signals, ignoring case and accents',()=>{
    const signals = ['Comisión de servicio del viajero','Comisión de servicio del anfitrión',
        'Impuesto sobre el uso de la propiedad','Precio de la habitación','Ganás'];
    for(let a=0;a<signals.length;a++)for(let b=a+1;b<signals.length;b++) {
        const text = `El viajero ha pagado ...\n${signals[a]} ...\n${signals[b]} ...`;
        assert.equal(C.medioDesdeTexto({texto_original:text}),METHOD);
        assert.equal(C.medioDesdeTexto({texto_original:text.toUpperCase()}),METHOD);
        assert.equal(C.medioDesdeTexto({texto_original:text.normalize('NFD').replace(/[\u0300-\u036f]/g,'')}),METHOD);
    }
    assert.equal(C.medioDesdeTexto({texto_original:'EL VIAJERO\nHA PAGADO ... COMISIÓN DE SERVICIO DEL VIAJERO ... GANAS ...'}),METHOD);
});

test('isolated channel, paid-traveler text, generic commission, amounts and insufficient or repeated breakdown evidence infer no method',()=>{
    for(const text of ['Airbnb','El viajero ha pagado','Comisión de servicio',
        'Comisión por venta ... $165.598','El viajero ha pagado ... $165.598',
        'El viajero ha pagado ... Comisión de servicio del viajero',
        'El viajero ha pagado ... Comisión de servicio del viajero ... Comisión de servicio del viajero',
        'Comisión de servicio del viajero ... Comisión de servicio del anfitrión ... Ganás']) {
        assert.equal(C.medioDesdeTexto({texto_original:text}),null,text);
    }
    // A concept from another context must not complete the receipt signature.
    assert.equal(C.medioDesdeTexto({texto_original:'El viajero ha pagado ... Comisión de servicio del viajero',
        concepto:'Precio de la habitación'}),null);
});

test('full Agustin receipt recognizes Airbnb without inventing date/reference or mutating the source',()=>{
    const original = Object.freeze({texto_original:AIRBNB_AGUSTIN,monto:165598,fecha_comprobante:null,
        fecha_bloque:'2026-10-06',medio_pago:null});
    const corrected = C.corregirPago(original);
    assert.equal(corrected.medio_pago,METHOD);
    assert.equal(corrected.fecha_comprobante,null);
    assert.equal(corrected.referencia_externa,undefined);
    assert.equal(original.medio_pago,null);
    assert.equal(original.texto_original,AIRBNB_AGUSTIN);
});

test('Agustin receipt traverses parser/canon/compatibility/UI and loses only the missing-method reason, retaining date and manual review',async()=>{
    const sheet = {celdas:[
        {r:1,c:2,valor:'6 oct',fechaISO:'2026-10-06'}, {r:1,c:6,valor:'7 oct',fechaISO:'2026-10-07'},
        {r:2,c:0,valor:'cabaña 4'}, {r:2,c:2,valor:'Agustin Rampa Spinelli // 2 ADL // 0 niños // 0 mascotas'},
        {r:24,c:2,valor:'Pagos de arriendos de hoy'}, {r:26,c:0,valor:'cabaña 4'},
        {r:26,c:3,valor:`Agustin Rampa Spinelli // ${AIRBNB_AGUSTIN}`},
        {r:26,c:4,valor:'cab4/1noche'}, {r:26,c:5,valor:'$165.598',valorNumero:165598}
    ],combinaciones:[{s:{r:26,c:0},e:{r:28,c:0}}]};
    const xlsxBefore = JSON.stringify(sheet), raw = S.normalizarHoja(sheet,'Oct26');
    const rawBefore = JSON.stringify(raw);
    assert.equal(raw.pagos.length,1);
    let consulta = raw;
    const h={HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_RESERVA_V1:{consultarHoja:async()=>consulta},structuredClone,
        document:{readyState:'complete',getElementById(){return null},head:{appendChild(){}},createElement(){return {}}},console};
    vm.runInNewContext(read('haiku-libro-pagos-canon-v1.js'),h);
    vm.runInNewContext(read('haiku-libro-lenguaje-natural-v1.js'),h);
    const effective=await h.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Oct26');
    const payment=effective.pagos[0];
    assert.equal(payment.medio_pago,METHOD);
    assert.equal(payment.fecha_comprobante,null);
    assert.equal(payment.referencia_externa,undefined);
    const visual=funciones('haiku-libro-pagos-ui-v1.js',['normalizar','medioVisual']);
    assert.equal(visual.medioVisual(payment).nombre,LABEL);
    const cliente={auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(){
        const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range:async()=>({data:[]})};return b;
    }};
    const plan=async reservations=>Q.crearPlanIncorporacion(reservations,await Q.compararSistema(reservations,cliente,{desde:'2026-10-01',hasta:'2026-10-31'}));
    const before=(await plan(raw.reservas)).items.find(x=>x.pagoLibro || /pago:/.test(x.id));
    const after=(await plan(effective.reservas)).items.find(x=>x.pagoLibro || /pago:/.test(x.id));
    assert.ok(before.motivos.some(x=>/precisar el medio/.test(x)));
    assert.equal(after.categoria,'dudosos');
    assert.ok(after.motivos.some(x=>/fecha del comprobante/.test(x)));
    assert.ok(after.motivos.some(x=>/aprobaci.n manual/.test(x)));
    assert.deepEqual(Array.from(after.motivos).sort(),before.motivos.filter(x=>!/precisar el medio/.test(x)).sort());
    assert.equal(after.payload.argumentos.p_medio_pago,METHOD);
    assert.equal(after.payload.argumentos.p_fecha_pago,null);
    assert.equal(after.payload.argumentos.p_referencia_externa,null);
    assert.equal(JSON.stringify(raw),rawBefore);
    assert.equal(JSON.stringify(sheet),xlsxBefore);
    // Compatibility must also respect the receipt signature if the body mentions
    // a generic card word; it must not replace the canonical Airbnb method.
    const withCardWord=structuredClone(raw);
    for(const p of new Set([withCardWord.pagos[0],...withCardWord.reservas.flatMap(r=>r.pagos)]))p.texto_original+=' // tarjeta de crédito';
    consulta=withCardWord;
    assert.equal((await h.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Oct26')).pagos[0].medio_pago,METHOD);
});

test('Agustin CAB4 $165.598: recognized method removes only missing-method reason; missing real date and weak identity remain under review',async()=>{
    const p = C.corregirPago({titular:'Agustin Rampa Spinelli',cabana:4,monto:165598,moneda:'CLP',
        fecha_bloque:'2026-10-06',fecha_comprobante:null,tipo_movimiento:'alojamiento',concepto:'cab4/1noche',
        pago_recibido:true,estado_pago:'registrado_en_libro',texto_original:LABEL,
        origen:{hoja:'Oct26',celda:'O27:R27'}});
    const r = {id:'Oct26!O3',titular:p.titular,cabana:4,fecha_checkin:p.fecha_bloque,fecha_checkout:'2026-10-07',
        tipo_estadia:'alojamiento',adultos:2,ninos:0,mascotas:0,noches:1,pagos:[p],pagos_sin_asociacion:[],
        advertencias:[],notas_importantes:[],coordenadas_origen:{hoja:'Oct26',celda:'O3'}};
    const cliente = {auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(){
        const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range:async()=>({data:[]})};return b;
    }};
    const comparar = () => Q.compararSistema([r],cliente,{desde:'2026-10-01',hasta:'2026-10-31'});
    const plan = Q.crearPlanIncorporacion([r],await comparar());
    const movimiento = plan.items.find(x=>x.pagoLibro || /pago:/.test(x.id));
    assert.ok(movimiento,JSON.stringify(plan.items));
    assert.equal(movimiento.categoria,'dudosos');
    assert.ok(movimiento.motivos.some(x=>/fecha del comprobante/.test(x)));
    assert.ok(movimiento.motivos.some(x=>/aprobaci.n manual/.test(x)));
    assert.ok(!movimiento.motivos.some(x=>/precisar el medio/.test(x)));
    assert.equal(movimiento.payload.argumentos.p_medio_pago,METHOD);
    assert.equal(movimiento.payload.argumentos.p_referencia_externa,null);
    p.fecha_comprobante='2026-10-05';
    const conFecha = Q.crearPlanIncorporacion([r],await comparar()).items.find(x=>x.pagoLibro || /pago:/.test(x.id));
    assert.equal(conFecha.categoria,'dudosos');
    assert.ok(conFecha.motivos.some(x=>/aprobaci.n manual/.test(x)));
    assert.ok(!conFecha.motivos.some(x=>/fecha del comprobante/.test(x)));
});

test('all assistant payment builders accept Airbnb with amount/date only and preserve real references; channel alone is not a method',()=>{
    const files = ['supabase-asistente-v1.js','supabase-asistente-pago-existente-v1.js',
        'supabase-asistente-pago-existente-v2.js','supabase-asistente-pagos-nocturnos-v1.js'];
    for (const file of files) {
        const principal = file==='supabase-asistente-v1.js';
        const names = [principal?'normalizarClave':'normalizar','webpayDesdePago','transferenciaDesdePago',
            'tarjetaDesdePago','efectivoDesdePago','pagoParaRpc'];
        if(principal) names.push('airbnbDesdePago');
        const h = funciones(file,names);
        for (const reference of [null,'AIR-REAL-00004']) {
            const payload = h.pagoParaRpc({medio:LABEL,monto:165598,fecha:'2026-10-05',referencia_externa:reference});
            assert.ok(payload,file);
            assert.equal(payload.medio,METHOD); assert.equal(payload.monto,165598);
            assert.equal(payload.glosa,reference);
            assert.equal(payload.codaut,null); assert.equal(payload.folio,null); assert.equal(payload.bovtar,null);
        }
        assert.equal(h.pagoParaRpc({medio:'Airbnb',monto:165598,fecha:'2026-10-05'}),null);
        assert.equal(h.pagoParaRpc({medio:METHOD,monto:0,fecha:'2026-10-05'}),null);
        assert.equal(h.pagoParaRpc({medio:METHOD,monto:165598}),null);
        assert.equal(h.pagoParaRpc({medio:METHOD,monto:165598,fecha:'2026-02-31'}),null);
        assert.equal(h.pagoParaRpc({medio:METHOD,monto:165598,fecha:'2026-10-05'}).medio,METHOD);
    }
});

test('new reservation routes single and multiple Airbnb abonos through the existing atomic RPC and retains permission/date guards',async()=>{
    const file = 'supabase-asistente-v1.js', calls = [];
    const h = funciones(file,['normalizarClave','webpayDesdePago','transferenciaDesdePago','tarjetaDesdePago',
        'efectivoDesdePago','airbnbDesdePago','pagoParaRpc','enteroOpcional','pagosDesdePreview',
        'problemasFinancieros','problemasParaCrear','nombresAcompanantes','tarifasDesdeReserva',
        'crearReservaDesdePreview'],{window:{haikuTienePermiso:()=>true},moneda:n=>String(n),
        cliente:{rpc:async(name,args)=>{
            calls.push({name,args});
            return {data:name==='haiku_cabanas_disponibles'?[{numero:4}]:{reserva_id:'r4'},error:null};
        }}});
    const reserva = {titular_nombre:'Persona Prueba',cabana:4,fecha_llegada:'2026-10-06',fecha_salida:'2026-10-07',
        tipo_estadia:'alojamiento',adultos:2,cloudbeds_id:'CB-REAL-4'};
    for(const count of [1,2]) {
        const preview={confianza:'alta',reserva,pagos:Array.from({length:count},()=>
            ({medio:LABEL,monto:165598,fecha:'2026-10-05',glosa:'AIR-REAL-4'}))};
        await h.crearReservaDesdePreview(preview);
        const last=calls.at(-1);
        assert.equal(last.name,'haiku_crear_reserva_con_abonos');
        assert.equal(last.args.p_pagos.length,count);
        assert.ok(last.args.p_pagos.every(p=>p.medio===METHOD&&p.glosa==='AIR-REAL-4'&&!p.codaut&&!p.folio&&!p.bovtar));
    }
    const before=calls.length;
    assert.equal(h.problemasParaCrear({confianza:'alta',reserva,pagos:[
        {medio:'Transferencia',monto:1000,fecha:'2026-10-05',glosa:'017REAL'}]}).length,0);
    assert.equal(h.problemasParaCrear({confianza:'alta',reserva,pagos:[
        {medio:'WebPay Crédito',monto:1000,fecha:'2026-10-05',codaut:'009REAL'}]}).length,0);
    await assert.rejects(h.crearReservaDesdePreview({confianza:'alta',reserva,pagos:[{medio:LABEL,monto:165598}]}),/fecha/);
    h.window.haikuTienePermiso=()=>false;
    await assert.rejects(h.crearReservaDesdePreview({confianza:'alta',reserva,pagos:[]}),/permiso/);
    assert.equal(calls.length,before);
});

test('raw XLSX semantic parser and natural-language layer retain the explicit Airbnb method',async()=>{
    const sheet = {celdas:[
        {r:1,c:2,valor:'6 oct',fechaISO:'2026-10-06'}, {r:1,c:6,valor:'7 oct',fechaISO:'2026-10-07'},
        {r:2,c:0,valor:'cabaña 4'}, {r:2,c:2,valor:'Agustin Rampa Spinelli // 2 ADL'},
        {r:24,c:2,valor:'Pagos de arriendos de hoy'}, {r:26,c:0,valor:'cabaña 4'},
        {r:26,c:2,valor:'5 oct',fechaISO:'2026-10-05'},
        {r:26,c:3,valor:'Agustin Rampa Spinelli // Airbnb Prepaid Card'},
        {r:26,c:4,valor:'cab4/1noche'}, {r:26,c:5,valor:'$165.598',valorNumero:165598}
    ],combinaciones:[{s:{r:26,c:0},e:{r:28,c:0}}]};
    const original=JSON.stringify(sheet), parsed=S.normalizarHoja(sheet,'Oct26');
    assert.equal(parsed.pagos.length,1);
    assert.equal(parsed.pagos[0].medio_pago,METHOD);
    assert.equal(parsed.pagos[0].monto,165598);
    assert.equal(JSON.stringify(sheet),original);
    const h={HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_RESERVA_V1:{consultarHoja:async()=>structuredClone(parsed)},structuredClone,console};
    vm.runInNewContext(read('haiku-libro-lenguaje-natural-v1.js'),h);
    const layered=await h.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Oct26');
    assert.equal(layered.pagos[0].medio_pago,METHOD);
});

test('assistant normalization keeps an optional Airbnb reference and rejects contradictory Transbank evidence',()=>{
    const h = funciones('supabase-asistente-normalizacion-pagos-v1.js',
        ['clave','texto','subtipoDesdeMedio','agregarUnico','normalizarPago','pagoValido']);
    const p = {medio:LABEL,monto:165598,fecha:'2026-10-05',glosa:'CB-00004'};
    h.normalizarPago(p,[]); assert.equal(p.medio,LABEL); assert.equal(p.glosa,'CB-00004');
    assert.equal(h.pagoValido(p),true);
    const incompatible = {...p,folio:'000004'}, warnings=[];
    h.normalizarPago(incompatible,warnings);
    assert.equal(h.pagoValido(incompatible),false); assert.equal(warnings.length,1);
});

test('check-in/checkout/legacy selectors expose canonical value and label; old method requirements remain unchanged',()=>{
    for (const file of ['supabase-pagos-checkin-v4.js','supabase-pagos-checkin-v5.js','supabase-pagos-checkout-v1.js',
        'supabase-pagos-v2.js','supabase-pagos-edicion.js']) {
        const req = file.includes('checkin-v')||file.includes('checkout');
        const h = funciones(file,['codigoMedio','valorMedio','opcionesMedio',...(req?['requisitosMedio']:[]),
            ...(file==='supabase-pagos-edicion.js'?['escaparHTML']:[])],{},
            [file.includes('edicion')||file==='supabase-pagos-v2.js'?'MAPA_MEDIOS':'MEDIOS']);
        const html=h.opcionesMedio(METHOD);
        assert.match(html,/<option value="airbnb_prepaid_card"[^>]*>Airbnb Prepaid Card<\/option>/);
        assert.equal((html.match(/value="airbnb_prepaid_card"/g)||[]).length,1);
        assert.equal(h.codigoMedio(METHOD),METHOD);
        assert.equal(h.codigoMedio('Airbnb'),'');
        if(req) {
            assert.ok(Object.values(h.requisitosMedio(METHOD)).every(x=>x===false));
            assert.equal(h.requisitosMedio('transferencia').glosa,true);
            assert.equal(h.requisitosMedio('webpay_credito').codAut,true);
            assert.equal(h.requisitosMedio('tarjeta_credito').folio,true);
        }
    }
});

test('UI label maps and every general selector include Airbnb; exclusively WebPay files stay restricted',()=>{
    for (const file of ['pagos.js','sites-resumen-pago-v1.js','supabase-pago-grupo-v1.js',
        'supabase-abonos-detalle-v1.js','supabase-abonos-verificacion-v2.js','supabase-editar-abonos-v1.js',
        'supabase-pagos-checkin-grupo-v1.js','supabase-pagos-checkin-grupo-v2.js','supabase-saldo-favor-v2.js',
        'supabase-historial-v1.js','supabase-ficha-atajos.js','supabase-sync-v2.js','supabase-sync-v3.js']) {
        assert.ok(read(file).includes(METHOD),file); assert.ok(read(file).includes(LABEL),file);
    }
    assert.ok(!read('supabase-webpay-v1.js').includes(METHOD));
    const h=funciones('supabase-historial-v1.js',['medioPago','textoEstado']);
    assert.equal(h.medioPago(METHOD),LABEL);
    const visual=funciones('haiku-libro-pagos-ui-v1.js',['normalizar','medioVisual']);
    assert.equal(visual.medioVisual({medio_pago:METHOD}).nombre,LABEL);
    assert.notEqual(visual.medioVisual({texto_original:'Reserva desde Airbnb'}).nombre,LABEL);
});

test('legacy check-in retains Manager review without demanding Transbank fields in the Airbnb validation message',async()=>{
    const listeners=[], alerts=[], writes=[];
    const h={window:{haikuSupabase:{rpc:async(...args)=>writes.push(args)},addEventListener(){}},
        document:{addEventListener(type,fn){if(type==='change')listeners.push(fn)},getElementById(){return null}},
        console:{info(){}},setTimeout(){},alert:message=>alerts.push(message)};
    vm.runInNewContext(read('supabase-pagos-v2.js'),h);
    for(const method of [METHOD,'Tarjeta Crédito']) {
        const card={dataset:{reservaId:'real-reservation'},querySelector(selector){
            if(selector.includes('-medio='))return {value:method};
            if(selector.includes('-manager='))return {checked:false};
            return {value:''};
        }};
        const check={checked:true,dataset:{pagoCheckinCobrado:'4'},closest:()=>card};
        const event={target:{closest:selector=>selector==='[data-pago-checkin-cobrado]'?check:null},
            preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}};
        for(const callback of listeners)await callback(event);
        assert.equal(check.checked,false);
        const message=alerts.at(-1);
        assert.match(message,/Manager/);
        if(method===METHOD)assert.doesNotMatch(message,/Folio|CodAut|Bove|BOVTAR/);
        else assert.equal(message,'Para cerrar el saldo completa Medio de pago, Folio, CodAut, Bove y Manager revisado.');
    }
    assert.equal(writes.length,0);
});
