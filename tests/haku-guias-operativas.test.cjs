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
test('Booking conserva RUT genéricos y cargo virtual explica el dato que no especifica su apartado',()=>{
    assert.match(texto('manager-booking'),/66\.666\.666-6.*residente.*55\.555\.555-5.*extranjero/);
    assert.match(texto('manager-virtual'),/no especifica qué RUT usar/);
    assert.doesNotMatch(texto('manager-virtual'),/66\.666|55\.555/);
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
test('el módulo es una guía local sin acceso a datos, cobros, correos ni modelo externo',()=>{
    const source=fs.readFileSync(require.resolve('../js/haiku-guias-operativas-v1.js'),'utf8');
    assert.doesNotMatch(source,/\.rpc\s*\(|\.invoke\s*\(|\bfetch\s*\(|\.insert\s*\(|\.update\s*\(|\.innerHTML\s*=|localStorage|indexedDB/);
    assert.match(source,/No confirman que el pago o la reserva hayan sido registrados/);
});
test('cada captura corresponde al paso y existe localmente, sin depender de URLs temporales',()=>{
    const path=require('node:path'),archivos=new Set();
    for(const g of Object.values(G.guias))for(const p of g.pasos)for(const ref of G.imagenesDe(p)){
        assert.match(ref.archivo,/^[a-z-]+\.(png|jpg)$/);
        assert.ok(ref.alt.length>20&&ref.ancho>0&&ref.alto>0);
        assert.ok(fs.statSync(path.join(__dirname,'../assets/guias',ref.archivo)).size>1000);
        archivos.add(ref.archivo);
    }
    assert.equal(archivos.size,8);
    assert.equal(G.imagenesDe({titulo:'Realizar Check-in en el terminal'}).length,4);
    assert.equal(G.imagenesDe({titulo:'Completar Check-out y recoger vouchers'})[0].titulo,'3 · Check-out');
    assert.deepEqual(G.imagenesDe({titulo:'constructor'}),[]);
    assert.deepEqual(G.imagenesDe({titulo:'Crear el comprobante'}),[],'el manual Manager no tiene capturas');
    for(const medio of ['webpay','transferencia','booking','airbnb','pos','efectivo']){
        const p=G.pasosDe('reserva-completa',medio).find(p=>p.titulo==='Abrir Añadir pago en Cloudbeds');
        assert.equal(G.imagenesDe(p)[0].archivo,'cloudbeds-anadir-pago.png');
    }
});
