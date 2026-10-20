const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { entorno } = require('./fixtures/libro-servicio-manual.cjs');
const q = {desde:'2026-10-01',hasta:'2026-10-31'};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const copy = x => JSON.parse(JSON.stringify(x));
function fixture() {
    const e = entorno(), { c, state } = e;
    c.structuredClone=structuredClone;
    const original = c.HAIKU_LIBRO_RESERVA_V1.consultarHoja;
    let lecturasLibro = 0;
    c.HAIKU_LIBRO_RESERVA_V1.consultarHoja = async (...args) => { lecturasLibro++;return original(...args); };
    const db = state.db; db.pagos=[];db.notas=[];db.servicios=[];db.vista_estado_cargos=[];
    state.reservas=[];db.reservas=[];db.reserva_estadias=[];db.cabanas=[];
    const reads=[];
    c.haikuTienePermiso = () => true;
    c.haikuSupabase.auth.getSession=async()=>({data:{session:{user:{id:state.usuario}}}});
    c.haikuSupabase.from = tabla => {
        reads.push(tabla);
        let filtros=[],rango=null,datos;
        const builder={
            select(){return builder;},
            eq(k,v){filtros.push(x=>x[k]===v);return builder;},
            in(k,v){filtros.push(x=>v.includes(x[k]));return builder;},
            lte(k,v){filtros.push(x=>x[k]<=v);return builder;},
            gte(k,v){filtros.push(x=>x[k]>=v);return builder;},
            order(){return builder;},range(a,b){rango=[a,b];return builder;},
            then(ok,fail){
                datos=(db[tabla]||[]).filter(x=>filtros.every(f=>f(x)));
                if(tabla==='reserva_estadias') datos=datos.map(x=>({...x,
                    reservas:db.reservas.find(r=>r.id===x.reserva_id),
                    cabanas:db.cabanas.find(r=>r.id===x.cabana_id)}));
                if(rango)datos=datos.slice(rango[0],rango[1]+1);
                return Promise.resolve({data:copy(datos),error:null}).then(ok,fail);
            }
        };
        return builder;
    };
    // Comparar uses the real canonical module already loaded by entorno().
    c.document.documentElement = {dataset:{libroInformeReadonly:'1'}};
    vm.runInContext(fs.readFileSync('js/haiku-libro-consultas-v1.js','utf8'),c);
    const Q=c.HAIKU_LIBRO_CONSULTAS;
    const agregar=(nombre,texto,n=1)=>{
        const r={id:'fila-'+n,titular:nombre,cabana:n,adultos:2,ninos:0,mascotas:0,
            rut_documento:'1000000'+n,fecha_checkin:'2026-10-10',fecha_checkout:'2026-10-11',
            tipo_estadia:'alojamiento',noches:1,texto_original:texto,
            coordenadas_origen:{hoja:'Oct26',celda:'C'+(n+2)},pagos:[],pagos_sin_asociacion:[],
            servicios:c.HAIKU_LIBRO_SEMANTICA.servicios(texto,{origen_campo:'notas_reserva'})};
        const estancia={id:id(100+n),reserva_id:id(n),cabana_id:id(200+n),adultos:2,ninos:0,mascotas:0,
            fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,tipo_estadia:'alojamiento',estado_estadia:'confirmada'};
        state.reservas.push(r);db.reserva_estadias.push(estancia);db.cabanas.push({id:estancia.cabana_id,numero:n});
        db.reservas.push({id:estancia.reserva_id,titular_nombre:nombre,titular_numero_documento:r.rut_documento,estado_reserva:'confirmada'});
        return {r,estancia};
    };
    const servicio=({r,estancia},codigo='lateCheckout',monto=10000)=>{
        const s={id:id(300+r.cabana),reserva_id:estancia.reserva_id,estadia_id:estancia.id,
            fecha_servicio:'2026-10-11',hora_inicio:'13:00:00',hora_fin:'14:00:00',cantidad:1,personas:2,
            tipo_cobro:'normal',total:monto,estado_servicio:'programado',catalogo_servicios:{codigo,nombre:'Late Check-out'}};
        db.servicios.push(s);db.vista_estado_cargos.push({cargo_id:id(400+r.cabana),reserva_id:s.reserva_id,estadia_id:s.estadia_id,
            servicio_id:s.id,estado:'activo',monto,monto_ajustado:monto,aplicado_neto:monto,saldo_cargo:0});return s;
    };
    const comparar=()=>Q.compararSistema(state.reservas,c.haikuSupabase,q);
    return {...e,Q,db,reads,agregar,servicio,comparar,lecturas:()=>lecturasLibro};
}

function cambioServicios(r,id='hist-servicios') {
    const anterior={...r,servicios:[]};
    return {id,tipo:'modificacion',detectado_generacion:1,anterior,actual:r,
        cambios:[{campo:'servicios',antes:[],ahora:r.servicios}]};
}
test('historial: Late Check-out ya registrado usa la misma identidad que Servicios y queda resuelto',async()=>{
    const f=fixture(),reserva=f.agregar('Reserva de Late sintética','X PAGAR LATE OUT CLP$10,000 1 HORA 13:00');
    f.servicio(reserva);const antes=JSON.stringify(f.db);
    const out=await f.Q.revalidarCambiosDetectados([cambioServicios(reserva.r)],f.c.haikuSupabase,{generacion:1});
    assert.equal(out.items.length,0);assert.equal(out.resueltos.length,1);assert.equal(out.reservas.length,0);
    assert.equal(JSON.stringify(f.db),antes);assert.equal(f.lecturas(),0);assert.equal(f.state.escrituras.length,0);
});
test('historial: la tinaja de cortesía sin agenda ya anotada no se convierte en servicio faltante',async()=>{
    const f=fixture(),{r,estancia}=f.agregar('Reserva de beneficio sintética','PROMO HAIKU // 1 HORA DE TINAJA DE CORTESÍA');
    f.db.notas.push({id:id(777),reserva_id:estancia.reserva_id,tipo:'operativa_resumen',texto:'1 HORA DE TINAJA DE CORTESÍA'});
    const out=await f.Q.revalidarCambiosDetectados([cambioServicios(r)],f.c.haikuSupabase,{generacion:1});
    assert.equal(out.items.length,0);assert.equal(out.resueltos.length,1);assert.equal(f.lecturas(),0);
    assert.equal(f.state.escrituras.length,0);
});
test('historial: una nota pendiente se conserva como nota y no habilita la incorporación de reservas',async()=>{
    const f=fixture(),{r}=f.agregar('Reserva de nota sintética','PROMO HAIKU // + 1 hora de tinaja caliente');
    const out=await f.Q.revalidarCambiosDetectados([cambioServicios(r)],f.c.haikuSupabase,{generacion:1});
    assert.equal(out.items.length,1);assert.equal(out.items[0].accionable,false);
    assert.match(out.items[0].cambios[0].proyecto,/nota|Notas/i);
    assert.equal(out.reservas.length,0);assert.equal(out.comparacion.length,0);assert.equal(f.state.escrituras.length,0);
});
test('historial: un horario distinto de tinaja sigue visible para revisión y no promete una incorporación vacía',async()=>{
    const f=fixture(),a=f.agregar('Reserva de horario sintética','TINAJA TONEL 1 HORA DE CORTESÍA 19:15 A 20:15');
    const s=f.servicio(a,'tinajaTonel',0);Object.assign(s,{fecha_servicio:'2026-10-10',hora_inicio:'18:15:00',hora_fin:'19:15:00',tipo_cobro:'cortesia'});
    const out=await f.Q.revalidarCambiosDetectados([cambioServicios(a.r)],f.c.haikuSupabase,{generacion:1});
    assert.equal(out.items.length,1);assert.equal(out.items[0].accionable,false);assert.equal(out.reservas.length,0);
    assert.notEqual(out.items[0].cambios[0].proyecto,'Falta en Proyecto H.');assert.equal(f.state.escrituras.length,0);
});
test('historial: un error de lectura operativa impide concluir que todo coincide',async()=>{
    const f=fixture(),{r}=f.agregar('Reserva de error sintética','PROMO HAIKU // 18hrs jacuzzi');
    f.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2={compararReservas:async()=>{throw Error('Lectura operativa fallida');}};
    await assert.rejects(f.Q.revalidarCambiosDetectados([cambioServicios(r)],f.c.haikuSupabase,{generacion:1}),/Lectura operativa fallida/);
    assert.equal(f.state.escrituras.length,0);assert.equal(f.lecturas(),0);
});
test('historial: conserva la promo y el pago específico del Libro como evidencia, sin proponer registrar pagos',async()=>{
    const f=fixture(),{r}=f.agregar('Reserva con pago sintética','PROMO HAIKU // JACUZZI 18:00 A 19:00');
    r.pagos_sin_asociacion=[{concepto:'tinaja',monto:30000,texto_original:'1 HORA DE JACUZZI PAGADA $30.000'}];
    const original=f.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;let leido;
    f.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2={compararReservas:async(...args)=>{leido=await original.compararReservas(...args);return leido;}};
    const out=await f.Q.revalidarCambiosDetectados([cambioServicios(r)],f.c.haikuSupabase,{generacion:1});
    const i=leido.items.find(x=>x.kind==='servicio');assert.equal(i.promocion.descuento_porcentaje,10);assert.equal(i.reglaPromo,null);
    assert.equal(out.items[0].accionable,false);assert.equal(out.reservas.length,0);assert.equal(out.comparacion.pagosDetalle.length,0);
    assert.equal(f.state.escrituras.length,0);assert.equal(f.state.llamadas.length,0);
});

test('7 avisos antiguos: Late existentes y beneficios ya anotados coinciden en ambas pantallas',async()=>{
    const f=fixture();
    for(let n=1;n<=3;n++)f.servicio(f.agregar('Reserva sintética '+n,'X PAGAR LATE OUT CLP$10,000 1 HORA',n));
    for(let n=4;n<=7;n++){
        const {r,estancia}=f.agregar('Reserva sintética '+n,'1 HORA DE TINAJA DE CORTESÍA',n);
        f.db.notas.push({id:id(500+n),reserva_id:estancia.reserva_id,tipo:'operativa_resumen',texto:r.texto_original});
    }
    const antes=JSON.stringify(f.state.reservas);
    const [mensual,operativa]=await Promise.all([f.comparar(),f.api.construir('Libro: compara servicios de octubre 2026 con Proyecto H')]);
    assert.equal(mensual.criterioServiciosNotas,'operativo_v2');
    assert.equal(mensual.meta.servicios_revisar,0);assert.equal(mensual.meta.servicios_preparables,0);
    assert.equal(mensual.meta.notas_preparables,0);assert.equal(mensual.meta.notas_revisar,0);
    assert.equal(mensual.serviciosDetalle.length,3);assert.equal(mensual.notasDetalle.length,4);
    assert.ok(mensual.serviciosDetalle.every(x=>x.estado==='en_sistema'&&x.finanzas.estado==='pagado'));
    assert.ok(mensual.notasDetalle.every(x=>x.estado==='en_sistema'));
    assert.ok(operativa.items.every(x=>x.estado==='existente'));
    assert.equal(f.Q.modeloPresentacionComparacion({comparacion:mensual}).serviciosRevisar.length,0);
    assert.ok(mensual.every(r=>!r.diferencias.some(x=>/Servicio mencionado sin coincidencia/.test(x))));
    assert.equal(JSON.stringify(f.state.reservas),antes);assert.equal(f.lecturas(),1,'sólo el panel operativo leyó el Libro');
    assert.equal(f.state.escrituras.length,0);assert.equal(f.state.llamadas.length,0,'no RPC adicional');
});

test('Un servicio con cargo pendiente sigue existente, no vuelve a ser propuesto como nuevo',async()=>{
    const f=fixture();f.servicio(f.agregar('Reserva sintética','X PAGAR LATE OUT CLP$10,000 1 HORA'));
    f.db.vista_estado_cargos[0].aplicado_neto=0;f.db.vista_estado_cargos[0].saldo_cargo=10000;
    const comp=await f.comparar();assert.equal(comp.meta.servicios_revisar,0);
    assert.equal(comp.serviciosDetalle[0].estado,'en_sistema');assert.equal(comp.serviciosDetalle[0].finanzas.estado,'pendiente');
});

test('Lo que de verdad falta permanece preparado, separado de una revisión por datos ambiguos',async()=>{
    const f=fixture();f.agregar('Reserva sintética','TINAJA TONEL 1 HORA DE CORTESÍA 19:15 A 20:15');
    const comp=await f.comparar(),modelo=f.Q.modeloPresentacionComparacion({comparacion:comp});
    assert.equal(comp.meta.servicios_revisar,0);assert.equal(modelo.serviciosPreparables.length,1);
    assert.equal(modelo.serviciosRevisar.length,0);assert.equal(comp.serviciosDetalle[0].estado,'faltante');
});

test('Una nota aún no incorporada se muestra como nota preparada, nunca como tinaja faltante',async()=>{
    const f=fixture();f.agregar('Reserva sintética','1 HORA DE TINAJA DE CORTESÍA');
    const comp=await f.comparar(),m=f.Q.modeloPresentacionComparacion({comparacion:comp});
    assert.equal(m.serviciosRevisar.length,0);assert.equal(m.notasPreparables.length,1);
    assert.equal(comp.serviciosDetalle.length,0);
});

test('Una discrepancia real de precio y varios candidatos continúan protegidos',async()=>{
    for(const motivo of ['importe','multiples']){
        const f=fixture();const s=f.servicio(f.agregar('Reserva sintética','X PAGAR LATE OUT CLP$10,000 1 HORA'));
        if(motivo==='importe')s.total=20000;else f.db.servicios.push({...s,id:id(900),hora_inicio:'15:00:00'});
        const comp=await f.comparar(),op=await f.api.construir('Libro: compara servicios de octubre 2026 con Proyecto H');
        assert.equal(comp.meta.servicios_revisar,1,motivo);assert.equal(op.items[0].estado,'revisar',motivo);
        assert.match(comp.serviciosDetalle[0].razon,/contradice|varios servicios/);
    }
});

test('Fallo de la lectura canónica aborta, no usa un falso cero ni la comparación antigua',async()=>{
    const f=fixture();f.agregar('Reserva sintética','X PAGAR LATE OUT CLP$10,000 1 HORA');
    f.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2={compararReservas:async()=>{throw Error('No se pudo leer servicios');}};
    await assert.rejects(f.comparar(),/No se pudo leer servicios/);assert.equal(f.state.escrituras.length,0);
});

test('La clasificación usa el rango y filas ya seleccionados, sin abrir otro Libro',async()=>{
    const f=fixture();const a=f.agregar('Reserva consultada','1 HORA DE TINAJA DE CORTESÍA');
    f.agregar('Reserva fuera de selección','TINAJA TONEL X PAGAR 19:15',2);
    const comp=await f.Q.compararSistema([a.r],f.c.haikuSupabase,q);
    assert.equal(comp.notasDetalle.length,1);assert.equal(comp.serviciosDetalle.length,0);
    assert.equal(f.lecturas(),0);
});

test('Historial focal sin finanzas no ejecuta la nueva revisión de servicios/pagos',async()=>{
    const f=fixture();f.agregar('Reserva sintética','X PAGAR LATE OUT CLP$10,000 1 HORA');
    let calls=0;f.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2={compararReservas:async()=>{calls++;throw Error('No llamar');}};
    await f.Q.compararSistema(f.state.reservas,f.c.haikuSupabase,{...q,focal:true,incluirFinanzas:false});
    assert.equal(calls,0);assert.equal(f.reads.includes('pagos'),false);
});

test('Pago identificado con dato diferente: mismo plan lo clasifica como actualización existente',async()=>{
    const f=fixture(),{r,estancia}=f.agregar('Reserva de pago sintética','');
    const pago={monto:146302,moneda:'CLP',medio_pago:'debito',tipo_movimiento:'alojamiento',
        pago_recibido:true,estado_pago:'registrado_en_libro',fecha_comprobante:'2026-10-10',
        fecha_bloque:'2026-10-10',cabana:1,folio:'1234',bovtar:'9876',codigo_autorizacion:null,
        texto_original:'Pago de alojamiento recibido',origen:{hoja:'Oct26',celda:'C35'}};
    r.pagos=[pago];
    f.db.pagos=[{id:id(700),reserva_id:estancia.reserva_id,monto:146300,moneda:'CLP',medio_pago:'debito',tipo_movimiento:'pago',
        estado:'confirmado',folio:'1234',datos_origen:{bovtar:'9876'},fecha_pago:'2026-10-10T15:00:00Z'}];
    const comp=await f.comparar(),m=f.Q.modeloPresentacionComparacion({comparacion:comp});
    const plan=f.Q.crearPlanIncorporacion(f.state.reservas,comp);
    const update=plan.items.find(i=>i.payload?.tipo==='pago_actualizar');
    assert.ok(update);assert.equal(m.pagosActualizar.length,1);assert.equal(m.pagosRevisar.length,0);
    assert.equal(comp.meta.pagos_revisar,0);assert.equal(comp.meta.pagos_actualizar,1);
    assert.deepEqual(JSON.stringify(m.pagosActualizar[0].actualizacionExistente.cambios),JSON.stringify(update.cambios));
    assert.equal(m.pagosFaltan.length,0);assert.equal(f.db.pagos[0].monto,146300);assert.equal(f.state.escrituras.length,0);
});

test('Pago completamente coincidente no es actualización ni revisión',async()=>{
    const f=fixture(),{r,estancia}=f.agregar('Reserva de pago sintética','');
    r.pagos=[{monto:146302,moneda:'CLP',medio_pago:'debito',tipo_movimiento:'alojamiento',pago_recibido:true,
        estado_pago:'registrado_en_libro',fecha_comprobante:'2026-10-10',fecha_bloque:'2026-10-10',cabana:1,
        folio:'1234',bovtar:'9876',origen:{hoja:'Oct26',celda:'C35'}}];
    f.db.pagos=[{id:id(700),reserva_id:estancia.reserva_id,monto:146302,moneda:'CLP',medio_pago:'debito',tipo_movimiento:'pago',
        estado:'confirmado',folio:'1234',datos_origen:{bovtar:'9876'},fecha_pago:'2026-10-10T15:00:00Z'}];
    const comp=await f.comparar(),m=f.Q.modeloPresentacionComparacion({comparacion:comp});
    assert.equal(m.pagosActualizar.length,0);assert.equal(m.pagosRevisar.length,0);assert.equal(comp.pagosDetalle[0].estado,'en_sistema');
});
