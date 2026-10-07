const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../js/haiku-libro-semantica-v1.js');
const T = require('../js/haiku-fullday-tarifa-v1.js');

const RESERVA = '11111111-1111-4111-8111-111111111111';
const ESTADIA = '22222222-2222-4222-8222-222222222222';
const OTRA = '33333333-3333-4333-8333-333333333333';
const q = {desde:'2026-10-01',hasta:'2026-10-31'};
const limpio = x => JSON.parse(JSON.stringify(x));
const source = fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');

function harness() {
    class Element {
        constructor(tag) { this.tag=tag; this.children=[]; this.events={}; this.dataset={}; this.style={}; this.textContent=''; }
        append(...xs) { this.children.push(...xs); }
        appendChild(x) { this.append(x); }
        replaceChildren(...xs) { this.children=[]; this.append(...xs); }
        addEventListener(k,f) { this.events[k]=f; }
        setAttribute(k,v) { this[k]=v; }
        querySelectorAll(selector) {
            return this.children.flatMap(e=>[e,...e.querySelectorAll('*')]).filter(e=>selector==='*'||selector===e.tag||
                selector.startsWith('.')&&(e.className||'').split(' ').includes(selector.slice(1)));
        }
        querySelector(s) { return this.querySelectorAll(s)[0]||null; }
    }
    const context={structuredClone,HAIKU_LIBRO_SEMANTICA:S,HAIKU_FULLDAY_TARIFA_V1:T,
        document:{createElement:t=>new Element(t),querySelector:()=>null},addEventListener(){}};
    const api='Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
    assert.ok(source.includes(api));
    vm.runInNewContext(source.replace(api,api.replace(' })',', renderizarResultadoIncorporacion, contextoDetalleIncorporacion, detalleResultadoIncorporacion })')),context);
    const out=new Element('div'), Q=context.HAIKU_LIBRO_CONSULTAS;
    return {Q,context,out,texts:()=>out.querySelectorAll('*').map(e=>e.textContent).join(' '),
        button:t=>out.querySelectorAll('button').find(e=>e.textContent===t),
        render:ejecucion=>Q.renderizarResultadoIncorporacion(out,ejecucion,()=>{})};
}

const book = (extra={}) => ({id:'libro-actual',titular:'Mery Vasquez Carrion',rut_documento:'12345678-9',cabana:2,
    fecha_checkin:'2026-10-06',fecha_checkout:'2026-10-07',tipo_estadia:'alojamiento',noches:1,
    adultos:2,ninos:0,mascotas:0,pagos:[],pagos_sin_asociacion:[],servicios:[],advertencias:[],
    coordenadas_origen:{hoja:'Oct26',celda:'D6'},...extra});
const pay = (extra={}) => ({tipo_movimiento:'alojamiento',concepto:'Abono alojamiento',monto:120000,moneda:'CLP',
    medio_pago:'webpay_debito',codigo_autorizacion:'ACTUAL-123',fecha_comprobante:'2026-10-04',fecha_bloque:'2026-10-06',
    pago_recibido:true,estado_pago:'registrado_en_libro',texto_original:'Abono actual $120.000',
    origen:{hoja:'Oct26',celda:'D5'},...extra});
const stay = r => ({id:ESTADIA,reserva_id:RESERVA,cabanas:{numero:r.cabana},fecha_ingreso:r.fecha_checkin,
    fecha_salida:r.fecha_checkout,estado_estadia:'confirmada',tipo_estadia:r.tipo_estadia,adultos:2,ninos:0,mascotas:0,
    reservas:{id:RESERVA,titular_nombre:r.titular,titular_numero_documento:r.rut_documento,estado_reserva:'confirmada'}});

function client(tablas={},writer=()=>({data:{ok:true,resultados:[],detalle_omitidos:[]}})) {
    const calls=[];
    return {calls,auth:{getSession:async()=>({data:{session:{user:{id:'local-test'}}}})},from(tabla) {
        const b={select(){return b;},in(){return b;},eq(){return b;},lte(){return b;},gte(){return b;},order(){return b;},
            async range(a,z){return {data:structuredClone((tablas[tabla]||[]).slice(a,z+1))};}};return b;
    },async rpc(nombre,args) {
        calls.push({nombre,args});
        if(nombre==='haiku_libro_aplicaciones_servicio_capacidad_v1') return {data:{version:1,
            contrato:'aplicaciones_servicio_v1',rpc:'haiku_incorporar_pago_servicios_libro_v1',efectivo_sin_identificador:false}};
        if(nombre==='haiku_incorporar_libro_v1'||nombre==='haiku_incorporar_pago_servicios_libro_v1') return writer(nombre,args);
        throw Error('RPC inesperada: '+nombre);
    }};
}

function respuestaLote(items) {
    return {ok:true,reservas_creadas:items.filter(i=>i.tipo==='reserva_nueva').length,estadias_agregadas:0,
        pagos_creados:items.filter(i=>i.tipo==='pago').length,actualizaciones:0,omitidos:0,detalle_omitidos:[],
        resultados:items.map(i=>({item_id:i.item_id,tipo:i.tipo,reserva_id:RESERVA,
            ...(i.tipo==='pago'?{pago_id:'pago-confirmado',monto:i.argumentos.p_monto}:{codigo_haiku:'HAKU-LOCAL'})}))};
}

test('sólo pagos: detalle confirmado, monto/fecha/concepto y apertura por UUID con estadía real',async()=>{
    const h=harness(),r=book({pagos:[pay()]}),db=client({reserva_estadias:[stay(r)]},(_n,args)=>({data:respuestaLote(args.p_items)}));
    const result={reservas:[r],q},plan=await h.Q.prepararIncorporacion(result,new Map(),new Set(),db);
    const ejecucion=await h.Q.confirmarIncorporacion(result,new Map(),new Set(),plan,db);
    assert.equal(ejecucion.detalle.pagos.length,1);assert.equal(ejecucion.detalle.reservas.length,0);
    const before=JSON.stringify(ejecucion);h.render(ejecucion);assert.equal(JSON.stringify(ejecucion),before);
    assert.match(h.texts(),/Pagos incorporados \(1\)/);assert.match(h.texts(),/Mery Vasquez Carrion/);
    assert.match(h.texts(),/CAB 2/);assert.match(h.texts(),/120\.000/);assert.match(h.texts(),/04\/10\/26/);
    assert.match(h.texts(),/Abono alojamiento/);assert.match(h.texts(),/Incorporado/);
    const aperturas=[];h.context.HAIKU_INSPECTOR_V1={abrirReserva:(...args)=>aperturas.push(args)};
    const writes=db.calls.length;await h.button('Ver reserva').events.click();
    assert.equal(aperturas[0][0],RESERVA);
    assert.deepEqual(limpio(aperturas[0][2]),{estadiaId:ESTADIA,numeroCabana:'2'});
    assert.equal(db.calls.length,writes,'render y apertura no registran nada');
});

test('reservas + pagos: sólo los seleccionados confirmados, sin pendientes ni otra ejecución',async()=>{
    const h=harness(),r=book({pagos:[pay()]}),pendiente=book({id:'pendiente',titular:'Pendiente ajeno',cabana:4,
        coordenadas_origen:{hoja:'Oct26',celda:'E6'}});
    const db=client({},(_n,args)=>({data:respuestaLote(args.p_items)})),result={reservas:[r,pendiente],q};
    const plan=await h.Q.prepararIncorporacion(result,new Map(),new Set(),db);
    plan.items.filter(i=>i.texto.includes('Pendiente ajeno')).forEach(i=>{i.seleccionado=false;});
    const ejecucion=await h.Q.confirmarIncorporacion(result,new Map(),new Set(),plan,db);
    assert.equal(ejecucion.detalle.reservas.length,1);assert.equal(ejecucion.detalle.pagos.length,1);
    assert.equal(ejecucion.detalle.pagos[0].identidad.reservaId,RESERVA);
    h.render(ejecucion);assert.doesNotMatch(h.texts(),/Pendiente ajeno/);
    assert.match(h.texts(),/06\/10\/26 → 07\/10\/26/);assert.equal(h.out.querySelectorAll('.haiku-pago-ver-reserva').length,2);
    const segunda={resultado:{pagos_creados:1},detalle:{pagos:[{titular:'Segunda operación',estado:'Incorporado'}]}};
    h.render(segunda);assert.doesNotMatch(h.texts(),/Mery Vasquez Carrion/);assert.match(h.texts(),/Segunda operación/);
});

test('categorías vacías, contadores originales, mensaje y Volver a la comparación intactos',()=>{
    const h=harness(),ejecucion={resultado:{reservas_creadas:0,estadias_agregadas:0,pagos_creados:0,actualizaciones:0,omitidos:0}};
    let vueltas=0;h.Q.renderizarResultadoIncorporacion(h.out,ejecucion,()=>{vueltas++;});
    const grupos=h.out.querySelectorAll('details');assert.equal(grupos.length,5);assert.ok(grupos.every(g=>!g.open));
    assert.deepEqual(grupos.map(g=>g.querySelector('summary').textContent),[
        'Reservas incorporadas (0)','Estadías añadidas (0)','Pagos incorporados (0)','Actualizaciones del Libro (0)','Omitidos (0)']);
    assert.deepEqual(h.out.querySelectorAll('.haku-incorporacion-resultado-indicador').map(e=>e.querySelector('strong').textContent),['0','0','0','0','0']);
    assert.equal(h.out.querySelectorAll('.haku-incorporacion-final-vacio').length,5);
    assert.equal(h.button('Ver reserva'),undefined);
    assert.match(h.texts(),/Proyecto H confirmó la operación completa\. El Libro original no fue modificado\./);
    h.button('Volver a la comparación').events.click();assert.equal(vueltas,1);
});

function solicitud(h,items,fuentes) {
    return {items,servicios:[],detalleContexto:h.Q.contextoDetalleIncorporacion(items,{items:fuentes})};
}
const itemPago = (id='actual',reservaId=RESERVA) => ({tipo:'pago',item_id:id,reserva_id:reservaId,
    argumentos:{p_monto:3000,p_fecha_pago:'2026-10-04'},datos_origen:{}});
const fuentePago = id => ({id,categoria:'pagos',texto:'Gastón Soto · CAB 2 · $3.000 · Huevos',
    pagoLibro:{concepto:'6 Huevos',fecha_comprobante:'2026-10-04'},payload:{argumentos:{p_reserva_id:RESERVA}}});
const datosEstadia = (cabana=2,fecha='2026-10-06') => ({cabana_numero:cabana,
    datos:{fecha_ingreso:fecha,fecha_salida:fecha,estado_estadia:'confirmada'}});

test('estadías, actualizaciones y omitidos: acciones concretas y contador de revalidación',()=>{
    const h=harness(),items=[{tipo:'estadia',item_id:'estadia',reserva_id:RESERVA,estadias:[datosEstadia()]},
        {tipo:'reserva_actualizar',item_id:'actualizacion',reserva_id:RESERVA},itemPago('duplicado')];
    const fuentes=[{id:'estadia',categoria:'estadias',texto:'CAB 2 · Gastón Soto · 2026-10-06 → 2026-10-06',payload:items[0]},
        {id:'actualizacion',categoria:'actualizaciones',texto:'CAB 2 · Gastón Soto · 2026-10-06',
            cambios:[{campo:'Teléfono',anterior:'',libro:'+56912345678'}],payload:items[1]},fuentePago('duplicado')];
    const s=solicitud(h,items,fuentes);
    s.detalleContexto.omitidos.push({titular:'Seleccionado retirado',motivo:'El pago ya existe.',cabana:'CAB 4'});
    const resultado={ok:true,estadias_agregadas:1,actualizaciones:1,omitidos:1,resultados:[
        {item_id:'estadia',tipo:'estadia',reserva_id:RESERVA,estadia_id:ESTADIA},
        {item_id:'actualizacion',tipo:'reserva_actualizar',reserva_id:RESERVA}],
        detalle_omitidos:[{item_id:'duplicado',tipo:'pago',pago_id:'existente',motivo:'Ya existe el comprobante.'}]};
    const detalle=h.Q.detalleResultadoIncorporacion(s,resultado);h.render({resultado,detalle,omitidosAlRevalidar:1});
    assert.equal(detalle.estadias.length,1);assert.equal(detalle.actualizaciones.length,1);assert.equal(detalle.omitidos.length,2);
    assert.match(h.texts(),/Teléfono: \+56912345678/);assert.match(h.texts(),/Omitidos \(2\)/);
    assert.match(h.texts(),/Ya existe el comprobante/);assert.match(h.texts(),/Seleccionado retirado/);
    assert.deepEqual(limpio(detalle.estadias[0].identidad.seleccion),{estadiaId:ESTADIA,numeroCabana:'2'});
});

test('no presenta envíos como confirmados ni acepta resultados de ítems ajenos o tipos distintos',()=>{
    const h=harness(),s=solicitud(h,[itemPago()],[fuentePago('actual')]);
    const r={pagos_creados:1,resultados:[{item_id:'anterior',tipo:'pago',reserva_id:RESERVA},
        {item_id:'actual',tipo:'reserva_nueva',reserva_id:RESERVA}]};
    const detalle=h.Q.detalleResultadoIncorporacion(s,r);assert.ok(Object.values(detalle).every(xs=>xs.length===0));
    h.render({resultado:r,detalle});assert.doesNotMatch(h.texts(),/Gastón Soto/);
    assert.match(h.texts(),/1 elemento sin detalle individual disponible/);
    assert.equal(h.button('Ver reserva'),undefined);
});

test('Ver reserva requiere UUID seguro y un destino único compatible con la solicitud',()=>{
    for(const reservaId of ['sin-uuid',OTRA]) {
        const h=harness(),s=solicitud(h,[itemPago()],[fuentePago('actual')]);
        const resultado={pagos_creados:1,resultados:[{item_id:'actual',tipo:'pago',reserva_id:reservaId,monto:3000}]};
        h.render({resultado,detalle:h.Q.detalleResultadoIncorporacion(s,resultado)});
        assert.equal(h.button('Ver reserva'),undefined);
    }
    const h=harness(),item=itemPago();item.datos_origen.distribucion_manual={componentes:[
        {item_id:'a',reserva_id:RESERVA},{item_id:'b',reserva_id:OTRA}]};
    const s=solicitud(h,[item],[fuentePago('a'),{...fuentePago('b'),texto:'Otra persona · CAB 4 · $3.000 · Huevos'}]);
    const resultado={pagos_creados:1,resultados:[{item_id:'actual',tipo:'pago',reserva_id:RESERVA}]};
    h.render({resultado,detalle:h.Q.detalleResultadoIncorporacion(s,resultado)});
    assert.equal(h.button('Ver reserva'),undefined);assert.match(h.texts(),/Gastón Soto \/ Otra persona/);
});

test('pagos de servicios: detalla sólo los confirmados y separa los ya existentes',async()=>{
    const h=harness(),enviados=[{...itemPago('nuevo'),tipo:'pago_servicios_4c'},{...itemPago('existente'),tipo:'pago_servicios_4c'}];
    const s=solicitud(h,enviados,[fuentePago('nuevo'),fuentePago('existente')]);s.items=[];
    s.servicios=enviados.map((item,i)=>({item,operacionId:`op-${i}`,resultado:null}));
    const plan={items:[],solicitudPendiente:s},db=client({},(_n,args)=>({data:{ok:true,
        pagos_creados:args.p_item.item_id==='nuevo'?1:0,omitidos:args.p_item.item_id==='existente'?1:0,
        pago_id:'pago-servicio',monto:3000,motivo:'Ya existe en la reserva.'}}));
    const ejecucion=await h.Q.confirmarIncorporacion({},new Map(),new Set(),plan,db);
    assert.equal(ejecucion.detalle.pagos.length,1);assert.equal(ejecucion.detalle.omitidos.length,1);
    assert.equal(ejecucion.resultado.pagos_creados,1);assert.equal(ejecucion.resultado.omitidos,1);
    h.render(ejecucion);assert.match(h.texts(),/6 Huevos/);assert.match(h.texts(),/Ya existe en la reserva/);
    assert.equal(db.calls.some(c=>c.nombre==='haiku_incorporar_libro_v1'),false);
});

test('fallo y reintento conservan el contexto de la operación, sin usar etiquetas de una nueva comparación',async()=>{
    const h=harness(),r=book({pagos:[pay()]}),solicitudes=[];let intento=0;
    const db=client({reserva_estadias:[stay(r)]},(_n,args)=>{
        solicitudes.push(limpio(args));if(!intento++) throw Error('Fallo de red');
        return {data:{...respuestaLote(args.p_items),reintento:true}};
    });
    const result={reservas:[r],q},plan=await h.Q.prepararIncorporacion(result,new Map(),new Set(),db);
    await assert.rejects(h.Q.confirmarIncorporacion(result,new Map(),new Set(),plan,db),/Fallo de red/);
    assert.ok(plan.solicitudPendiente.detalleContexto);
    plan.items.forEach(i=>{i.texto='Persona de otra comparación';});r.titular='Otra versión';
    const ejecucion=await h.Q.confirmarIncorporacion(result,new Map(),new Set(),plan,db);
    assert.deepEqual(solicitudes[0],solicitudes[1]);h.render(ejecucion);
    assert.match(h.texts(),/Mery Vasquez Carrion/);assert.doesNotMatch(h.texts(),/Persona de otra comparación|Otra versión/);
    assert.match(h.texts(),/se recuperó el mismo resultado/);
});

test('estadías de una reserva nueva: se detallan las adicionales sólo si el contador las confirma',()=>{
    const h=harness(),item={tipo:'reserva_nueva',item_id:'nueva',reserva:{titular_nombre:'Reserva grupo'},
        estadias:[datosEstadia(2),datosEstadia(4)]};
    const s=solicitud(h,[item],[{id:'nueva',categoria:'nuevas',texto:'CAB 2 + 4 · Reserva grupo',payload:item}]);
    const resultado={reservas_creadas:1,estadias_agregadas:1,resultados:[{item_id:'nueva',tipo:'reserva_nueva',reserva_id:RESERVA}]};
    const detalle=h.Q.detalleResultadoIncorporacion(s,resultado);
    assert.equal(detalle.reservas.length,1);assert.equal(detalle.estadias.length,1);assert.equal(detalle.estadias[0].cabana,'CAB 4');
    assert.equal(detalle.estadias[0].identidad.seleccion,null,'no inventar un UUID de estadía');
    assert.equal(h.Q.detalleResultadoIncorporacion(s,{...resultado,estadias_agregadas:0}).estadias.length,0);
});

test('sin atribución segura de una estadía parcial no muestra CAB/fechas de lo omitido',()=>{
    const h=harness(),item={tipo:'estadia',item_id:'parcial',reserva_id:RESERVA,estadias:[datosEstadia(2),datosEstadia(4)]};
    const s=solicitud(h,[item],[{id:'parcial',categoria:'estadias',texto:'CAB 2 + 4 · Grupo',payload:item}]);
    const detalle=h.Q.detalleResultadoIncorporacion(s,{estadias_agregadas:1,resultados:[
        {item_id:'parcial',tipo:'estadia',reserva_id:RESERVA,estadia_id:ESTADIA}],detalle_omitidos:[
        {item_id:'parcial',tipo:'estadia',estadia_id:OTRA,motivo:'Ya existe.'}]});
    assert.equal(detalle.estadias.length,1);assert.equal(detalle.estadias[0].cabana,'');
    assert.equal(detalle.estadias[0].periodo,'');assert.equal(detalle.estadias[0].identidad.seleccion,null);
});

test('revalidación: los omitidos son sólo seleccionados retirados en esta ejecución',()=>{
    const h=harness(),seleccionado=fuentePago('retirado'),pendiente={...fuentePago('pendiente'),texto:'Pendiente sin seleccionar'};
    const contexto=h.Q.contextoDetalleIncorporacion([itemPago()],{items:[fuentePago('actual'),seleccionado,pendiente]},[
        {previo:seleccionado,nuevo:{...seleccionado,categoria:'omitidos',motivos:['El comprobante ya existe.']}}
    ]);
    seleccionado.texto='Otra comparación';
    const detalle=h.Q.detalleResultadoIncorporacion({items:[itemPago()],servicios:[],detalleContexto:contexto},
        {resultados:[{item_id:'actual',tipo:'pago',reserva_id:RESERVA,monto:3000}],omitidos:0});
    assert.equal(detalle.omitidos.length,1);assert.equal(detalle.omitidos[0].motivo,'El comprobante ya existe.');
    assert.equal(detalle.omitidos[0].titular,'Gastón Soto');
    assert.doesNotMatch(JSON.stringify(detalle),/Pendiente sin seleccionar|Otra comparación/);
});
