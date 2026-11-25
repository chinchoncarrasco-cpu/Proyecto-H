const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const G=require('../js/haiku-guias-operativas-v1.js');
const texto=id=>JSON.stringify(G.pasosDe(id));
const documentos=id=>G.pasosDe(id).flatMap(p=>p.datos||[]).filter(([k])=>k==='Tipo de documento').map(([,v])=>v);
test('Manager distingue las contrapartidas de cada medio sin intercambiar WebPay y saldo al check-in',()=>{
    assert.deepEqual(documentos('manager-transferencia'),['ARE','ABB$']);
    assert.deepEqual(documentos('manager-transferencia-existente'),['ARE','ABB$']);
    for(const id of ['manager-webpay-credito','manager-webpay-debito','manager-futuro'])assert.deepEqual(documentos(id),['TXC','AC+P']);
    assert.deepEqual(documentos('manager-booking'),['TCR','AC+B']);
    assert.deepEqual(documentos('manager-virtual'),['TCR','AC+P']);
    assert.deepEqual(documentos('manager-checkin-debito'),['RECO']);
    assert.deepEqual(documentos('manager-checkin-credito'),['TCR']);
});
test('transferencias usan fecha y glosa bancaria, RUT de la reserva y correlativo para comprobante existente',()=>{
    assert.match(texto('manager-transferencia'),/aunque haya transferido otra persona/);
    assert.match(texto('manager-transferencia'),/fecha que indica el banco/);
    assert.match(texto('manager-transferencia'),/Cuadrar H=D/);
    assert.match(texto('manager-transferencia-existente'),/correlativo.*0112252/);
    assert.doesNotMatch(texto('manager-transferencia-existente'),/Crear el comprobante/);
});
test('autorización conserva ceros, reemplaza letras y usa año del cobro; señala la errata TXC',()=>{
    for(const id of ['manager-webpay-debito','manager-booking','manager-checkin-credito']){
        assert.match(texto(id),/Último dígito del año del cobro/);assert.match(texto(id),/Conserva los ceros/);
        assert.match(texto(id),/sustituye cada letra por 0/);assert.match(texto(id),/600123412/);
    }
    assert.match(texto('manager-webpay-credito'),/excepto 32161154/);
    assert.match(texto('manager-webpay-credito'),/empieza con 5/);
});
test('Manager distingue RUT extranjero y chileno; el genérico sin RUT sólo corresponde a Booking',()=>{
    for(const [id,guia] of Object.entries(G.guias)){
        if(guia.grupo!=='manager')continue;
        for(const paso of guia.pasos){
            const rut=paso.datos.find(([campo])=>campo==='RUT');
            if(rut)assert.equal(rut[1],'Extranjero · 66666666-6\nChileno · RUT real del titular, sin puntos y con guion');
        }
        if(id!=='manager-booking')assert.doesNotMatch(texto(id),/55555555-5/);
    }
    const booking=G.pasosDe('manager-booking').find(p=>p.titulo==='Completar AC+B');
    assert.match(booking.datos.find(([campo])=>campo==='RUT')[2],/55555555-5 para el cliente chileno si Booking no informa su RUT/);
});
test('efectivo conserva la contradicción y no fabrica un asiento EFE8',()=>{
    assert.match(texto('manager-efectivo'),/Los manuales se contradicen/);
    assert.match(texto('manager-efectivo'),/no se ingresa en Manager/);
    assert.match(texto('manager-efectivo'),/EFE8/);assert.deepEqual(documentos('manager-efectivo'),[]);
});
test('los seis medios llevan al cierre de reserva y conservan sus diferencias',()=>{
    for(const medio of ['webpay','transferencia','booking','airbnb','pos','efectivo']){
        const pasos=G.pasosDe('reserva-completa',medio);
        assert.equal(pasos[0].titulo,'Verificar el correo de reserva');assert.ok(pasos.length>6);
        assert.ok(pasos.some(p=>p.titulo==='Completar y guardar el pago'));
        assert.ok(pasos.some(p=>p.titulo==='Imprimir la tarjeta de registro'));
        assert.equal(pasos.at(-1).titulo,medio==='webpay'?'Enviar acuse de recibo WebPay':'Enviar confirmación del pago');
    }
    assert.match(texto('reserva-webpay'),/Azul claro.*confirmado/s);
    assert.match(texto('reserva-transferencia'),/lunes siguiente.*Blanco/s);
    assert.match(texto('reserva-efectivo'),/verde claro/);
    assert.match(texto('reserva-airbnb'),/Vacía mientras no se refleje la transferencia/);
    assert.match(texto('reserva-airbnb'),/2 a 3 semanas/);
    assert.match(texto('reserva-booking'),/100%.*50%.*opción 2 Hotel.*opción 1 Check-in.*opción 3 Check-out/s);
    assert.match(texto('reserva-pos'),/BOVTAR \[código de autorización\].*folio \[número de operación\]/);
});
test('los pasos no confunden la fecha del comprobante con publicar hoy y no incluyen tarjetas de ejemplo',()=>{
    assert.match(texto('reserva-cloudbeds'),/Publicar con fecha y hora actuales/);
    assert.match(texto('reserva-cloudbeds'),/fecha real del comprobante/);
    assert.match(texto('reserva-booking'),/no los reproduce ni pide pegarlos en Haku/);
    assert.doesNotMatch(JSON.stringify(G.guias),/\b\d{13,19}\b|@(?:gmail|hotmail|live|guest\.booking)\./i);
});
test('estado restaurado valida catálogo y límites; una reserva completa necesita elegir medio antes de finalizar',()=>{
    assert.deepEqual(G.estadoValido({grupo:'manager',id:'manager-booking',indice:999}),{grupo:'manager',id:'manager-booking',medio:'',indice:4});
    assert.equal(G.estadoValido({grupo:'reservas',id:'manager-booking',indice:-3}).id,'');
    assert.equal(G.estadoValido({grupo:'reservas',id:'reserva-completa',indice:999}).indice,3);
    assert.equal(G.estadoValido({grupo:'__proto__',id:'constructor',medio:'toString',indice:'abc'}).id,'');
    assert.deepEqual(G.pasosDe('__proto__'),[]);assert.ok(Object.isFrozen(G.guias['manager-booking'].pasos[0]));
});
test('la guía sólo lee su catálogo de capturas y nunca registra pagos o reservas',()=>{
    const source=fs.readFileSync(require.resolve('../js/haiku-guias-operativas-v1.js'),'utf8');
    assert.doesNotMatch(source,/\.rpc\s*\(|\.invoke\s*\(|\bfetch\s*\(|\.insert\s*\(|\.update\s*\(|\.innerHTML\s*=|localStorage|indexedDB/);
    assert.deepEqual([...source.matchAll(/haikuSupabase\.from\('([^']+)'\)/g)].map(m=>m[1]),['haiku_manager_capturas_v1']);
    assert.match(source,/No confirman que el pago o la reserva hayan sido registrados/);
});
test('los recortes reales tienen una foto completa privada y las demás guías conservan sus archivos',()=>{
    const path=require('node:path'),archivos=new Set(),recortes=new Set(),fotos=new Set();
    for(const g of Object.values(G.guias))for(const p of g.pasos)for(const ref of G.imagenesDe(p)){
        assert.ok(ref.alt&&ref.ancho>0&&ref.alto>0);
        if(g.grupo==='manager'){
            assert.equal(ref.archivo,undefined);
            assert.match(ref.clave,/^recortes\/[a-z-]+$/);
            assert.match(ref.completa.clave,/^fotos\/m[13]-\d{2}$/);
            assert.ok(ref.completa.ancho>ref.ancho&&ref.completa.alto>ref.alto);
            recortes.add(ref.clave);fotos.add(ref.completa.clave);
            continue;
        }
        assert.match(ref.archivo,/^[a-z-]+\.(png|jpg)$/);
        assert.ok(fs.statSync(path.join(__dirname,'../assets/guias',ref.archivo)).size>1000);
        archivos.add(ref.archivo);
    }
    assert.equal(recortes.size,33);
    assert.equal(fotos.size,16);
    assert.equal(archivos.size,8);
    assert.equal(G.imagenesDe({titulo:'Realizar Check-in en el terminal'}).length,4);
    assert.equal(G.imagenesDe({titulo:'Completar Check-out y recoger vouchers'})[0].titulo,'3 · Check-out');
    assert.deepEqual(G.imagenesDe({titulo:'constructor'}),[]);
    assert.deepEqual(G.imagenesDe(G.pasosDe('manager-efectivo')[0]),[]);
    for(const medio of ['webpay','transferencia','booking','airbnb','pos','efectivo']){
        const p=G.pasosDe('reserva-completa',medio).find(p=>p.titulo==='Abrir Añadir pago en Cloudbeds');
        assert.equal(G.imagenesDe(p)[0].archivo,'cloudbeds-anadir-pago.png');
    }
});
test('los recortes de Manager corresponden a los campos o indicaciones de cada paso',()=>{
    for(const guia of Object.values(G.guias).filter(g=>g.grupo==='manager')){
        for(const paso of guia.pasos){
            const recortes=paso.recortes||[];
            const campos=new Map(paso.datos);
            assert.equal(new Map(recortes).size,recortes.length);
            for(const [ancla] of recortes){
                assert.ok(typeof ancla==='number'?paso.items[ancla]:campos.has(ancla),paso.titulo);
            }
            const principal=recortes.find(([ancla])=>typeof ancla==='string');
            if(campos.has('Glosa'))assert.equal(principal[0],'Glosa',paso.titulo);
            else if(campos.has('RUT'))assert.deepEqual(principal,['RUT','rut'],paso.titulo);
            const porAncla=new Map(recortes);
            paso.items.forEach((indicacion,indice)=>{
                if(indicacion.includes('Finanzas → Comprobantes'))assert.equal(porAncla.get(indice),'ruta-comprobantes');
                if(indicacion.includes('Impresiones en Caja'))assert.equal(porAncla.get(indice),'ruta-caja');
                if(/Cuadra[ r].*?[DH]=[HD]/.test(indicacion))assert.match(porAncla.get(indice),/^cuadrar-/);
            });
            if(!['Obtener la cartola Transbank','Aclarar el ingreso en efectivo'].includes(paso.titulo))assert.ok(recortes.length,paso.titulo);
            const documento=campos.get('Tipo de documento');
            if(documento){
                const id=documento.toLowerCase().replace('$','').replace('+','');
                assert.equal(porAncla.get('Tipo de documento'),id,paso.titulo);
            }
        }
    }
});
