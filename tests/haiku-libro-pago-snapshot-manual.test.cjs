const test=require('node:test'),assert=require('node:assert/strict');
const {entorno,entornoAcumulado}=require('./fixtures/libro-medio-pago-manual.cjs');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const accion={tipo:'crear_servicio_faltante',indice:0,codigo:'tinajaTonel',fecha:'2026-10-03',
    cantidad:1,personas:2,precio:40000,tipoCobro:'normal',precioManualConfirmado:true};
const pagos=(h,p)=>h.Q.serializarIncorporacion(p).filter(i=>i.tipo.startsWith('pago'));
const decision=(h,i)=>h.decisiones.get('resolucion-pago:'+i.id);
function representativo({conServicios=false}={}){
    const h=entorno({alojamiento:false,conServicios,conComparacion:true}),p=h.r.pagos[0],e=h.tablas.reserva_estadias[0];
    // Evidencia sintética con los atributos del caso informado; no lee datos operacionales.
    h.r.titular=p.titular='Caso representativo CAB 7';h.r.cabana=p.cabana=e.cabanas.numero=7;
    e.reservas.titular_nombre=h.r.titular;
    Object.assign(p,{monto:40000,medio_pago:'tarjeta_credito',folio:'482356',codigo_autorizacion:'000346',
        concepto:'Tinaja',texto_original:'Caso representativo CAB 7 // Tinaja // $40.000 // Folio 482356 // CodAut 000346',
        clasificacion_financiera:'pago_servicio'});
    if(conServicios){const c=h.tablas.vista_estado_cargos[0],s=h.tablas.servicios[0];
        c.monto=c.monto_ajustado=c.saldo_cargo=s.total=s.precio_unitario_aplicado=40000;}
    return h;
}
async function crear(h){const p=await h.preparar();return h.resolver(p,h.item(p),accion);}
function listo(h,p){const i=h.item(p);assert.equal(i.categoria,'pagos');assert.equal(i.seleccionado,true);
    assert.equal(i.motivos.length,0);assert.ok(i.decisionPagoManual);assert.equal(pagos(h,p).length,1);return i;}
function revisar(h,p){const i=h.item(p);assert.equal(i.categoria,'dudosos');assert.equal(i.seleccionado,false);
    assert.equal(i.decisionPagoManual,null);assert.ok(i.manualPago);assert.equal(h.Q.resolucionManualDisponible(i),true);
    assert.equal(pagos(h,p).length,0);return i;}

test('Felipe representativo: snapshot inicial, servicio/cargo propios y reconstrucción conservan el pago preparado',async()=>{
    const h=representativo(),pre=await h.preparar(),original=h.result.comparacion,i=h.item(pre);
    assert.equal(original.pagosDetalle[0].resolucionPago.estado,'NUEVO_SEGURO');
    assert.equal(i.destinoFinanciero.estado,'revision');assert.equal(i.manualPago.tipo,'crear_servicio_faltante');
    const post=await h.resolver(pre,i,accion),j=listo(h,post),d=decision(h,j);
    assert.equal(j.destinoFinanciero.estado,'destino_unico');assert.equal(h.result.comparacion,original);
    const firma=JSON.parse(d.firmaDestino),app=firma.aplicaciones[0];
    assert.deepEqual(Array.from(app),[id(43),40000,40000,0]);
    const payload=pagos(h,post)[0].datos_origen.aplicaciones_servicio_v1.aplicaciones[0];
    assert.equal(payload.servicio_id,id(33));assert.equal(payload.cargo_id,id(43));assert.equal(payload.saldo_esperado,40000);
    assert.equal(decision(h,listo(h,await h.preparar())),d);
    assert.equal(h.tablas.pagos.length,0);assert.equal(h.llamadas.filter(c=>c.nombre==='haiku_registrar_servicio').length,1);
});

for(const campo of ['saldo_cargo','aplicado_neto','servicio','aplicacion','estadia','evidencia'])
test('cambio externo posterior invalida sólo la decisión propia y conserva una revisión: '+campo,async()=>{
    const h=representativo(),post=await crear(h),i=listo(h,post),cargo=h.tablas.vista_estado_cargos[0];
    if(campo==='saldo_cargo')cargo.saldo_cargo+=10000;
    if(campo==='aplicado_neto')cargo.aplicado_neto=1;
    if(campo==='servicio')h.tablas.servicios[0].personas=3;
    if(campo==='aplicacion')h.tablas.pago_aplicaciones.push({id:id(80),pago_id:id(81),cargo_id:cargo.cargo_id,monto_aplicado:1});
    if(campo==='estadia')h.tablas.reserva_estadias[0].adultos=3;
    if(campo==='evidencia')h.r.pagos[0].texto_original+=' // evidencia corregida';
    const next=await h.preparar();revisar(h,next);assert.equal(decision(h,i),undefined);assert.equal(h.aprobados.has(i.id),false);
    await assert.rejects(h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,post,h.db),/cambi|seleccion/i);
    assert.equal(h.llamadas.filter(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1').length,0);
    const nuevo=await h.resolver(next,h.item(next),{tipo:'asociacion_pago'});listo(h,nuevo);
});

for(const campo of ['saldo_cargo','aplicado_neto'])
test('guarda histórica detecta '+campo+' aunque no cambie cargo_id ni exista decisión manual',async()=>{
    const h=representativo({conServicios:true}),pre=await h.preparar();assert.equal(h.item(pre).categoria,'pagos');
    h.tablas.vista_estado_cargos[0][campo]+=10000;
    const next=await h.preparar(),i=revisar(h,next);assert.match(i.motivos.join(' '),/cambió el destino financiero/);
    const resuelto=await h.resolver(next,i,{tipo:'asociacion_pago'});listo(h,resuelto);
});

for(const mismaReserva of [false,true])test('resolver y cambiar B conserva la referencia y preparación de A; misma reserva='+mismaReserva,async()=>{
    const h=entornoAcumulado({conComparacion:true,mismaReserva,servicioA:true});
    let p=await h.definirCaso(await h.preparar(),'A','tarjeta_credito');p=await h.aprobarCaso(p,'A');
    const a=h.itemCaso(p,'A'),d=decision(h,a),firma=d.firmaDestino;
    p=await h.definirCaso(p,'B','tarjeta_debito');
    if(h.itemCaso(p,'B').manualPago?.tipo==='crear_servicio_faltante')p=await h.resolver(p,h.itemCaso(p,'B'),
        {...accion,codigo:h.casos.codigoB,personas:mismaReserva?0:2});
    p=await h.aprobarCaso(p,'B');
    assert.equal(h.itemCaso(p,'A').categoria,'pagos');assert.equal(decision(h,h.itemCaso(p,'A')),d);assert.equal(d.firmaDestino,firma);
    assert.equal(h.itemCaso(p,'B').categoria,'pagos');assert.equal(pagos(h,p).length,2);
    const decisionB=decision(h,h.itemCaso(p,'B'));
    p=await h.definirCaso(p,'B','webpay_debito');
    assert.equal(h.itemCaso(p,'A').categoria,'pagos');assert.equal(decision(h,h.itemCaso(p,'A')),d);
    assert.equal(h.itemCaso(p,'B').categoria,'dudosos');
    p=await h.aprobarCaso(p,'B');
    assert.equal(pagos(h,p).length,2);assert.notEqual(decision(h,h.itemCaso(p,'B')),decisionB);
    assert.equal(decision(h,h.itemCaso(p,'A')),d);assert.equal(d.firmaDestino,firma);
});

for(const campo of ['saldo_cargo','aplicado_neto'])
test('cambio de '+campo+' entre captura posterior y relectura invalida la nueva decisión',async()=>{
    const h=representativo(),pre=await h.preparar(),auth=h.db.auth.getSession;let capturada;
    h.db.auth.getSession=async()=>{
        if(!capturada&&h.decisiones.size){
            capturada=[...h.decisiones.values()][0];
            h.tablas.vista_estado_cargos[0][campo]+=1;
        }
        return auth();
    };
    const post=await h.resolver(pre,h.item(pre),accion);revisar(h,post);
    assert.ok(capturada);assert.deepEqual(JSON.parse(capturada.firmaDestino).aplicaciones[0],[id(43),40000,40000,0]);
    assert.equal(h.decisiones.size,0);assert.equal(h.aprobados.size,0);assert.equal(h.tablas.servicios.length,1);
    assert.equal(h.llamadas.filter(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1').length,0);
});

test('duplicado aparece en la relectura posterior: no prepara ni incorpora otro pago',async()=>{
    const h=representativo(),pre=await h.preparar(),rpc=h.db.rpc;let inject=false;
    h.db.rpc=async(n,a)=>{const r=await rpc(n,a);if(n==='haiku_registrar_servicio')inject=true;return r;};
    const auth=h.db.auth.getSession;h.db.auth.getSession=async()=>{
        if(inject&&h.decisiones.size){inject=false;h.tablas.pagos.push({id:id(85),reserva_id:id(1),monto:40000,moneda:'CLP',
            medio_pago:'tarjeta_credito',fecha_pago:'2026-10-03',codigo_autorizacion:'000346',folio:'482356',estado:'confirmado',tipo_movimiento:'pago',
            datos_origen:{origen:structuredClone(h.r.pagos[0].origen)}});}
        return auth();
    };
    const post=await h.resolver(pre,h.item(pre),accion);assert.equal(pagos(h,post).length,0);assert.equal(h.decisiones.size,0);
    assert.equal(h.tablas.pagos.length,1);assert.equal(h.llamadas.filter(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1').length,0);
});

for(const fase of ['inicio','sesion','catalogo','rpc','snapshot','relectura'])test('cancelar durante '+fase+' no deja decisión ni borra servicios confirmados',async()=>{
    const h=representativo(),pre=await h.preparar();let activo=fase!=='inicio',creado=false;
    const lecturasAntes=h.llamadas.length;
    const rpc=h.db.rpc;h.db.rpc=async(n,a)=>{const r=await rpc(n,a);if(n==='haiku_registrar_servicio'){
        creado=true;if(fase==='rpc')activo=false;}if(fase==='snapshot'&&creado&&n.includes('capacidad'))activo=false;return r;};
    const from=h.db.from;h.db.from=t=>{const b=from(t),range=b.range;b.range=async(...args)=>{
        const r=await range(...args);if(fase==='catalogo'&&t==='catalogo_servicios')activo=false;return r;};return b;};
    const auth=h.db.auth.getSession;h.db.auth.getSession=async()=>{const r=await auth();
        if(fase==='sesion'||fase==='relectura'&&h.decisiones.size)activo=false;return r;};
    let post;try{post=await h.resolver(pre,h.item(pre),{...accion,vigente:()=>activo});}
    catch(e){assert.match(e.message,/cancelada/);}
    assert.equal(h.decisiones.size,0);assert.equal(h.aprobados.size,0);assert.equal(h.tablas.pagos.length,0);
    assert.equal(h.tablas.servicios.length,['rpc','snapshot','relectura'].includes(fase)?1:0);
    if(['inicio','sesion'].includes(fase))assert.equal(h.llamadas.length,lecturasAntes);
    if(post){assert.equal(post.revisionManualCancelada,true);revisar(h,post);}
});

test('cerrar el panel durante una resolución invalida su acción aunque se vuelva a abrir',async()=>{
    const h=representativo(),pre=await h.preparar(),i=h.item(pre),fila=h.render(pre,i);
    const boton=t=>fila.querySelectorAll('button').find(b=>b.textContent===t);
    await boton('Aprobación manual').events.click();
    const campo=n=>fila.querySelectorAll('*').find(e=>e['aria-label']===n);
    for(const [n,v] of [['Aplicación a resolver','0'],['Servicio del catálogo','tinajaTonel'],['Fecha del servicio','2026-10-03'],
        ['Cantidad','1'],['Personas','2'],['Precio unitario CLP','40000']]){const e=campo(n);e.value=v;e.events.change();}
    campo('Tipo de cobro').value='normal';campo('Confirmo el precio manual y el total exacto del Libro').checked=true;
    campo('Confirmo el precio manual y el total exacto del Libro').events.change();
    let resolver,observada;const original=h.Q.resolverAprobacionManualPago;
    h.Q={...h.Q,resolverAprobacionManualPago:async(...args)=>{observada=args[5];await new Promise(r=>resolver=r);return original(...args);}};
    const pendiente=boton('Guardar servicio y continuar').events.click();assert.equal(observada.vigente(),true);
    await boton('Cancelar revisión').events.click();await boton('Aprobación manual').events.click();
    assert.equal(observada.vigente(),false);resolver();await pendiente;
    assert.equal(h.decisiones.size,0);assert.equal(h.tablas.servicios.length,0);
});

test('distribución con snapshot original completa el último servicio sin cambiar el comprobante padre',async()=>{
    const h=entorno({alojamiento:false,distribuido:true,conComparacion:true});h.r.pagos[0].medio_pago='tarjeta_debito';
    let p=await h.preparar(),original=h.result.comparacion;p=await h.resolver(p,h.item(p),{tipo:'distribucion_comprobante'});
    for(const [indice,codigo,precio] of [[0,'trozoQueque',5000],[1,'panMasaMadre',5000],[2,'huevo',3000]]){
        p=await h.resolver(p,h.item(p),{...accion,indice,codigo,precio,personas:0});
        if(indice<2){assert.equal(h.item(p).categoria,'dudosos');assert.equal(h.item(p).manualPago.tipo,'crear_servicio_faltante');}
    }
    const i=listo(h,p),serializados=pagos(h,p),apps=serializados[0].datos_origen.aplicaciones_servicio_v1.aplicaciones;
    assert.equal(serializados[0].argumentos.p_monto,13000);assert.equal(apps.reduce((n,a)=>n+a.monto,0),13000);
    assert.equal(new Set(apps.map(a=>a.cargo_id)).size,3);assert.equal(h.tablas.servicios.length,3);assert.equal(h.result.comparacion,original);
    assert.equal(decision(h,listo(h,await h.preparar())),decision(h,i));
});
