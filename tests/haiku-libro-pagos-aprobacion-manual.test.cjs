const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../js/haiku-libro-semantica-v1.js');
const canonContext = {structuredClone,console:{info(){}},
    document:{readyState:'complete',getElementById:()=>null,createElement:()=>({}),head:{appendChild(){}}},
    HAIKU_LIBRO_RESERVA_V1:{consultarHoja:async data=>data}};
vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-pagos-canon-v1.js'),'utf8'),canonContext);
const C = canonContext.HAIKU_LIBRO_PAGOS_CANON_V1;
const D = require('../js/haiku-libro-pagos-destinos-v1.js');
global.HAIKU_LIBRO_SEMANTICA = S;
global.HAIKU_LIBRO_PAGOS_DESTINOS_V1 = D;
const Q = require('../js/haiku-libro-consultas-v1.js');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const FECHA = '2026-10-03';
const CAP = {version:1,contrato:'aplicaciones_servicio_v1',rpc:'haiku_incorporar_pago_servicios_libro_v1',
    efectivo_sin_identificador:false,conceptos_adicionales:['queque','pan','huevos'],servicio_faltante_manual_v1:true};
const pago = extra => ({titular:'Gaston Vera Valenzuela',cabana:3,fecha_bloque:FECHA,fecha_comprobante:FECHA,
    tipo_movimiento:'servicio',concepto:'QUEQUE',monto:5000,moneda:'CLP',medio_pago:'debito',folio:'00013',bovtar:'003013',
    bove:'999',pago_recibido:true,estado_pago:'registrado_en_libro',texto_original:'Gaston // TOTAL $13.000 // QUEQUE $5.000',
    origen:{hoja:'Oct26',celda:'C20:F20'},...extra});
function gaston(montos=[5000,5000,3000]) {
    return C.agruparTransaccionesDistribuidas(montos.map((monto,i) => C.corregirPago(pago({monto,
        concepto:['QUEQUE','PAN','HUEVOS'][i],origen:{hoja:'Oct26',celda:`C${20+i}:F${20+i}`},
        texto_original:`Gaston // Folio 00013 // BOVTAR 003013 // TOTAL $13.000 // ${['QUEQUE','PAN','HUEVOS'][i]} $${monto}`}))));
}
function entorno({distribuido=true,conServicios=true,capacidad=CAP}={}) {
    let generacion=1;
    global.HAIKU_LIBRO_RESERVA_V1={estado:()=>({generacion})};
    global.haikuTienePermiso=()=>true;
    const r={id:'Oct26!C6',titular:distribuido?'Gaston Vera Valenzuela':'Ignacio Herrera',cabana:distribuido?3:2,
        fecha_checkin:FECHA,fecha_checkout:'2026-10-04',tipo_estadia:'alojamiento',noches:1,adultos:2,ninos:0,mascotas:0,
        rut_documento:'11111111-1',pagos:distribuido?gaston():[pago({titular:'Ignacio Herrera',cabana:2,monto:30000,
            concepto:'Tinaja',codigo_autorizacion:'IGNACIO30',folio:null,bovtar:null,texto_original:'Ignacio Herrera // Tinaja // $30.000 // CodAut IGNACIO30'})],
        pagos_sin_asociacion:[],servicios:[],advertencias:[],coordenadas_origen:{hoja:'Oct26',celda:'C6'}};
    const estancia={id:id(2),reserva_id:id(1),fecha_ingreso:FECHA,fecha_salida:r.fecha_checkout,tipo_estadia:'alojamiento',
        estado_estadia:'confirmada',adultos:2,ninos:0,mascotas:0,cabanas:{numero:r.cabana},
        reservas:{id:id(1),titular_nombre:r.titular,titular_numero_documento:r.rut_documento,estado_reserva:'confirmada'}};
    const catalogo=[['quequeEntero','Queque entero',8000],['panMasaMadre','Pan masa madre',7000],
        ['huevo','Huevo',500],['tinajaTonel','Tinaja Tonel',35000],['trozoQueque','Trozo de queque',2000]]
        .map(([codigo,nombre,precio_base],i)=>({id:id(10+i),codigo,nombre,precio_base,
            categoria:'servicio',activo:true,requiere_horario:false,capacidad_maxima:null,
            unidad:i===3?'hora':'unidad',capacidad_incluida:i===3?2:null,precio_persona_adicional:null}));
    const tablas={reserva_estadias:[estancia],pagos:[],servicios:[],vista_estado_cargos:[],pago_aplicaciones:[],catalogo_servicios:catalogo};
    function agregar(i,monto,fecha=FECHA) {
        const c=catalogo[i],servicio={id:id(30+i),reserva_id:id(1),estadia_id:id(2),fecha_servicio:fecha,total:monto,
            cantidad:1,personas:2,precio_unitario_aplicado:monto,monto_adicional:0,
            tipo_cobro:'normal',estado_servicio:'programado',catalogo_servicios:c};
        tablas.servicios.push(servicio);
        tablas.vista_estado_cargos.push({cargo_id:id(40+i),reserva_id:id(1),estadia_id:id(2),servicio_id:servicio.id,
            tipo_cargo:'servicio',concepto:c.nombre,monto,monto_ajustado:monto,aplicado_neto:0,saldo_cargo:monto,estado:'activo',estado_pago:'pendiente'});
        return servicio;
    }
    if(conServicios) (distribuido?[0,1,2]:[3]).forEach(i=>agregar(i,distribuido?[5000,5000,3000][i]:30000));
    const llamadas=[],opciones={};
    const db={auth:{getSession:async()=>({data:{session:{user:{id:id(90)}}}})},from(tabla){
        llamadas.push({tabla}); let filtros=[];
        const b={select(){return b},in(campo,valores){filtros.push(x=>valores.includes(x[campo]));return b},
            eq(campo,v){filtros.push(x=>x[campo]===v);return b},lte(){return b},gte(){return b},order(){return b},
            async range(a,z){if(opciones.errorLectura===tabla) return {error:Error('Lectura fallida')};
                return {data:structuredClone((tablas[tabla]||[]).filter(x=>filtros.every(f=>f(x))).slice(a,z+1))};}};
        return b;
    },async rpc(nombre,args){
        llamadas.push({nombre,args});
        if(nombre==='haiku_libro_aplicaciones_servicio_capacidad_v1') return {data:capacidad};
        if(nombre==='haiku_registrar_servicio') {
            if(opciones.errorServicio) return {error:Error('Servicio rechazado')};
            const indices=catalogo.map((c,i)=>c.codigo===args.p_codigo_servicio?i:null).filter(i=>i!==null);
            assert.equal(indices.length,1);
            const existentes=tablas.servicios.filter(s=>s.catalogo_servicios.codigo===args.p_codigo_servicio && s.fecha_servicio===args.p_fecha_servicio);
            if(existentes.length) {
                if(existentes.length!==1) return {error:Error('Servicio ambiguo')};
                const s=existentes[0];
                if(s.total!==args.p_precio_manual*args.p_cantidad || s.cantidad!==args.p_cantidad || s.personas!==args.p_personas) return {error:Error('Servicio cambió')};
                return {data:{servicio_id:s.id,total:s.total,reutilizado:true}};
            }
            const s=agregar(indices[0],args.p_precio_manual*args.p_cantidad,args.p_fecha_servicio);
            Object.assign(s,{cantidad:args.p_cantidad,personas:args.p_personas,hora_inicio:args.p_hora,
                precio_unitario_aplicado:args.p_precio_manual});
            return {data:{servicio_id:s.id,total:s.total,estado:'creado'}};
        }
        if(nombre==='haiku_incorporar_pago_servicios_libro_v1') {
            if(opciones.errorPago) return {error:Error('Red interrumpida')};
            return {data:{ok:true,pagos_creados:1,pago_id:id(60)}};
        }
        assert.fail('RPC inesperado: '+nombre);
    }};
    const result={reservas:[r],q:{desde:FECHA,hasta:r.fecha_checkout},generacion:1},decisiones=new Map(),aprobados=new Set();
    return {r,db,tablas,llamadas,opciones,result,decisiones,aprobados,agregar,
        cambiarLibro(){generacion++},
        preparar:()=>Q.prepararIncorporacion(result,decisiones,aprobados,db),
        resolver:(plan,item,accion)=>Q.resolverAprobacionManualPago(result,decisiones,aprobados,plan,item.id,accion,db)};
}
const itemPago=plan=>plan.items.find(x=>x.pagoLibro);
const accionServicio={tipo:'crear_servicio_faltante',indice:0,codigo:'tinajaTonel',fecha:FECHA,cantidad:1,personas:2,precio:30000,tipoCobro:'normal',precioManualConfirmado:true};

test('Gaston desde la geometría XLSX: parser y canon conservan tres importes explícitos en un comprobante',()=>{
    const celdas=[],combinaciones=[],cell=(r,c,valor,extra={})=>celdas.push({r,c,valor,...extra});
    for(const [c,d] of [[10,'03'],[14,'04']]) {
        cell(1,c,d+'-10-2026',{fechaISO:'2026-10-'+d});cell(24,c,'Pagos de arriendos de hoy');
        combinaciones.push({s:{r:24,c},e:{r:24,c:c+3}});
    }
    for(let cab=1;cab<=11;cab++) {
        cell(cab+1,0,'cabaña '+cab);const r=25+(cab-1)*5;cell(r,0,'cabaña '+cab);
        combinaciones.push({s:{r,c:0},e:{r:r+4,c:0}});
    }
    cell(4,10,'Gaston Vera Valenzuela // 2 ADL // 1 noche');
    [['QUEQUE',5000],['PAN',5000],['HUEVOS',3000]].forEach(([concepto,monto],i)=>{
        cell(35+i,10,'3-10-2026',{fechaISO:FECHA});
        cell(35+i,11,'Gaston Vera Valenzuela // Folio 00013 // BOVTAR 003013 // TOTAL $13.000 // DEBITO');
        cell(35+i,12,concepto);cell(35+i,13,String(monto),{valorNumero:monto});
    });
    const hoja={celdas,combinaciones,estilos:[]},original=JSON.stringify(hoja);
    const parseado=S.normalizarHoja(hoja,'Oct26'),copiaAntes=JSON.stringify(parseado),efectivo=C.corregirResultado(parseado);
    const r=efectivo.reservas.find(r=>r.titular==='Gaston Vera Valenzuela');
    assert.equal(r.cabana,3);assert.equal(r.fecha_checkin,FECHA);assert.equal(r.pagos.length,1);
    assert.equal(r.pagos[0].monto,13000);assert.equal(r.pagos[0].transaccion_distribuida,true);
    assert.deepEqual(Array.from(r.pagos[0].aplicaciones_libro,a=>[a.concepto,a.tipo_movimiento,a.monto]),
        [['QUEQUE','servicio',5000],['PAN','servicio',5000],['HUEVOS','servicio',3000]]);
    assert.equal(r.pagos[0].origenes.length,3);
    assert.equal(JSON.stringify(hoja),original);assert.equal(JSON.stringify(parseado),copiaAntes);
});

test('Gaston: evidencia explícita forma un padre 13000; confirmación produce un pago protegido con tres aplicaciones',async()=>{
    const h=entorno(),original=JSON.stringify(h.r),plan=await h.preparar(),item=itemPago(plan);
    assert.equal(h.r.pagos.length,1);assert.equal(item.pagoLibro.monto,13000);
    assert.equal(item.pagoLibro.aplicaciones_libro.length,3);
    assert.equal(item.manualPago.tipo,'distribucion_comprobante');
    assert.equal(item.categoria,'dudosos');assert.equal(Q.serializarIncorporacion(plan).filter(i=>i.tipo.startsWith('pago')).length,0);
    const aprobado=await h.resolver(plan,item,{tipo:'distribucion_comprobante'});
    const pagos=Q.serializarIncorporacion(aprobado).filter(i=>i.tipo.startsWith('pago'));
    assert.equal(pagos.length,1); const p=pagos[0];assert.equal(p.tipo,'pago_servicios_4c');
    assert.equal(p.argumentos.p_monto,13000);
    const apps=p.datos_origen.aplicaciones_servicio_v1.aplicaciones;
    assert.deepEqual(Array.from(apps,a=>[a.concepto_canon,a.monto]),[['queque',5000],['pan',5000],['huevos',3000]]);
    assert.equal(apps.reduce((n,a)=>n+a.monto,0),13000);
    assert.ok(apps.every(a=>a.monto<=a.saldo_esperado));assert.equal(new Set(apps.map(a=>a.cargo_id)).size,3);
    assert.equal(p.datos_origen.evidencia_libro.bove_administrativo,'999');assert.equal(p.argumentos.p_folio,'00013');
    assert.equal(p.datos_origen.evidencia_libro.origenes.length,3);
    assert.equal(p.argumentos.p_bove,'003013');assert.equal(JSON.stringify(h.r),original);
    await Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,aprobado,h.db);
    assert.equal(h.llamadas.filter(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1').length,1);
    assert.equal(h.llamadas.some(x=>x.nombre==='haiku_incorporar_libro_v1'),false);
});

test('Gaston: suma menor o mayor, identificador distinto, reserva distinta y concepto ambiguo no se aprueban',async()=>{
    for(const montos of [[5000,5000,2000],[5000,5000,4000]]) {
        const pagos=gaston(montos);assert.equal(pagos.length,3);assert.ok(pagos.every(p=>p.conflicto_distribucion));
    }
    for(const cambio of [{bovtar:'DISTINTO'},{titular:'Otra Reserva',cabana:4}]) {
        const partes=gaston()[0].aplicaciones_libro.map((a,i)=>pago({...a,...(i===2?cambio:{})}));
        const pagos=C.agruparTransaccionesDistribuidas(partes);assert.ok(pagos.length>1);
    }
    const h=entorno();h.r.pagos[0].aplicaciones_libro[0].concepto='QUEQUE PAN';
    const plan=await h.preparar();assert.equal(itemPago(plan).manualPago,null);assert.equal(itemPago(plan).categoria,'dudosos');
    assert.equal(D.conceptoCanon('QUEQUE PAN'),null);
    assert.equal(D.conceptoCanon('QUEQUE TINAJA'),null);
    assert.equal(D.conceptoCanon('PAN MASAJE'),null);
});

test('backend antiguo no permite los nuevos conceptos ni crear servicios con una guardia ausente',async()=>{
    const h=entorno({capacidad:{...CAP,conceptos_adicionales:[]}}),p=await h.preparar();
    assert.equal(itemPago(p).manualPago,null);assert.match(itemPago(p).motivos.join(' '),/no anuncia soporte/);
    const i=entorno({distribuido:false,conServicios:false,capacidad:{...CAP,servicio_faltante_manual_v1:false}});
    assert.equal(itemPago(await i.preparar()).manualPago,null);
    for(const conServicios of [true,false]) {
        const antiguo=entorno({conServicios,capacidad:{version:1,contrato:CAP.contrato,rpc:CAP.rpc,efectivo_sin_identificador:false}});
        const p=await antiguo.preparar();assert.equal(itemPago(p).manualPago,null);
        assert.equal(Q.serializarIncorporacion(p).filter(x=>x.tipo.startsWith('pago')).length,0);
        const incompleto=entorno({conServicios,capacidad:{...CAP,servicio_faltante_manual_v1:false}});
        assert.equal(itemPago(await incompleto.preparar()).aprobable,false);
    }
});

test('Gaston real: cero servicios, distribución y tres creaciones progresivas terminan en un solo pago',async()=>{
    const h=entorno({conServicios:false}),original=JSON.stringify(h.r);
    h.tablas.pagos.push({id:id(70),reserva_id:id(1),monto:160000,moneda:'CLP',estado:'confirmado',
        codigo_autorizacion:'GASTON-ALOJ',medio_pago:'tarjeta_debito',fecha_pago:FECHA});
    h.tablas.vista_estado_cargos.push({cargo_id:id(71),reserva_id:id(1),estadia_id:id(2),tipo_cargo:'alojamiento',
        monto:160000,monto_ajustado:160000,aplicado_neto:160000,saldo_cargo:0,estado:'activo'});
    h.tablas.pago_aplicaciones.push({id:id(72),pago_id:id(70),cargo_id:id(71),monto_aplicado:160000});
    let plan=await h.preparar();assert.equal(itemPago(plan).manualPago.tipo,'distribucion_comprobante');
    plan=await h.resolver(plan,itemPago(plan),{tipo:'distribucion_comprobante'});
    assert.equal(itemPago(plan).manualPago.tipo,'crear_servicio_faltante');
    assert.equal(itemPago(plan).manualPago.distribucionConfirmada,true);
    assert.equal(itemPago(plan).categoria,'dudosos');assert.equal(Q.serializarIncorporacion(plan).filter(x=>x.tipo.startsWith('pago')).length,0);
    const pasos=[[2,'huevo',3000],[1,'panMasaMadre',5000],[0,'trozoQueque',5000]];
    for(let i=0;i<pasos.length;i++) {
        const [indice,codigo,precio]=pasos[i],anterior=plan,accion={...accionServicio,indice,codigo,precio,personas:0};
        plan=await h.resolver(plan,itemPago(plan),accion);
        assert.equal(h.tablas.servicios.length,i+1);
        assert.equal(itemPago(plan).destinoFinanciero.aplicaciones.filter(a=>a.estado==='destino_unico').length,i+1);
        assert.equal(h.llamadas.some(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
        if(i<2) {
            assert.equal(itemPago(plan).manualPago.tipo,'crear_servicio_faltante');
            assert.equal(itemPago(plan).manualPago.distribucionConfirmada,true);
            assert.equal(Q.serializarIncorporacion(plan).filter(x=>x.tipo.startsWith('pago')).length,0);
        }
        // Reintentar el mismo paso confirmado revalida y reutiliza sin otra creación.
        plan=await h.resolver(anterior,itemPago(anterior),accion);
        assert.equal(h.tablas.servicios.length,i+1);
    }
    const pagos=Q.serializarIncorporacion(plan).filter(x=>x.tipo.startsWith('pago'));
    assert.equal(pagos.length,1);assert.equal(pagos[0].argumentos.p_monto,13000);
    assert.equal(pagos[0].datos_origen.aplicaciones_servicio_v1.aplicaciones.length,3);
    assert.equal(pagos[0].datos_origen.aplicaciones_servicio_v1.aplicaciones.reduce((n,a)=>n+a.monto,0),13000);
    assert.deepEqual([...new Set(h.llamadas.filter(x=>x.nombre==='haiku_registrar_servicio').map(x=>x.args.p_codigo_servicio))],['huevo','panMasaMadre','trozoQueque']);
    assert.deepEqual(h.tablas.servicios.map(s=>s.total).sort((a,b)=>a-b),[3000,5000,5000]);
    assert.equal(JSON.stringify(h.r),original);
    const cargo=h.tablas.vista_estado_cargos.find(c=>c.servicio_id===h.tablas.servicios[0].id);
    cargo.saldo_cargo=2000;
    await assert.rejects(Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db),/cambió/);
    assert.equal(itemPago(await h.preparar()).categoria,'dudosos');
    assert.equal(h.llamadas.some(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
});

test('las capacidades manuales se vuelven a comprobar al actuar y al confirmar, incluso en retry',async()=>{
    const cap={...CAP},h=entorno({distribuido:false,conServicios:false,capacidad:cap});
    let plan=await h.preparar();cap.servicio_faltante_manual_v1=false;
    await assert.rejects(h.resolver(plan,itemPago(plan),accionServicio),/capacidades/);
    assert.equal(h.llamadas.some(x=>x.nombre==='haiku_registrar_servicio'),false);
    cap.servicio_faltante_manual_v1=true;plan=await h.preparar();
    plan=await h.resolver(plan,itemPago(plan),accionServicio);h.opciones.errorPago=true;
    await assert.rejects(Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db),/Red/);
    cap.servicio_faltante_manual_v1=false;h.opciones.errorPago=false;
    const n=h.llamadas.filter(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1').length;
    await assert.rejects(Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db),/capacidades/);
    assert.equal(h.llamadas.filter(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1').length,n);
});

test('Ignacio: crear servicio usa RPC, luego relee snapshot; sólo cargo real y saldo válido preparan pago',async()=>{
    const h=entorno({distribuido:false,conServicios:false}),original=JSON.stringify(h.r),plan=await h.preparar(),item=itemPago(plan);
    assert.equal(item.categoria,'dudosos');assert.equal(item.aprobable,false);assert.equal(item.manualPago.tipo,'crear_servicio_faltante');
    const nuevo=await h.resolver(plan,item,accionServicio),p=itemPago(nuevo);
    const escritura=h.llamadas.findIndex(x=>x.nombre==='haiku_registrar_servicio');assert.ok(escritura>=0);
    assert.ok(h.llamadas.slice(escritura+1).some(x=>x.tabla==='vista_estado_cargos'));
    assert.ok(h.llamadas.slice(escritura+1).some(x=>x.tabla==='servicios'));
    const args=h.llamadas[escritura].args;
    assert.equal(args.p_reserva_id,id(1));assert.equal(args.p_estadia_id,id(2));
    assert.match(args.p_observaciones,/HAKU-LIBRO-SERVICIO:pago_manual:/);
    assert.ok(args.p_observaciones.includes(h.r.pagos[0].texto_original));
    assert.equal(p.categoria,'pagos');assert.equal(p.destinoFinanciero.estado,'destino_unico');
    assert.equal(h.llamadas.some(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
    assert.equal(JSON.stringify(h.r),original);
});

test('catálogo, monto, campos y permiso se validan antes de crear; no hay bypass',async()=>{
    for(const cambio of [{codigo:'inventado'},{precio:0},{precio:-1},{cantidad:0},{personas:-1},{personas:''},
        {tipoCobro:'cortesia'},{fecha:'2026-10-09'},{fecha:'2026-02-31'},{hora:'25:10'},
        {precio:31000},{cantidad:2},{precioManualConfirmado:false},{codigo:''},{indice:null}]) {
        const h=entorno({distribuido:false,conServicios:false}),plan=await h.preparar();
        await assert.rejects(h.resolver(plan,itemPago(plan),{...accionServicio,...cambio}));
        assert.equal(h.llamadas.some(x=>x.nombre==='haiku_registrar_servicio'),false);
    }
    const h=entorno({distribuido:false,conServicios:false}),plan=await h.preparar();global.haikuTienePermiso=()=>false;
    await assert.rejects(h.resolver(plan,itemPago(plan),accionServicio));
    assert.equal(h.llamadas.some(x=>x.nombre==='haiku_registrar_servicio'),false);
});

test('reserva ambigua o comprobante débil no ofrecen aprobación financiera',async()=>{
    const h=entorno({distribuido:false,conServicios:false});
    h.tablas.reserva_estadias.push({...h.tablas.reserva_estadias[0],id:id(3),reserva_id:id(4)});
    assert.equal(itemPago(await h.preparar()).manualPago,null);
    const debil=entorno({distribuido:false,conServicios:false});debil.r.pagos[0].codigo_autorizacion=null;
    assert.equal(itemPago(await debil.preparar()).manualPago,null);
});

test('si otro operador creó el servicio compatible, revalida y lo reutiliza por RPC sin duplicar',async()=>{
    const h=entorno({distribuido:false,conServicios:false}),plan=await h.preparar();h.agregar(3,30000);
    const nuevo=await h.resolver(plan,itemPago(plan),accionServicio);
    assert.equal(itemPago(nuevo).categoria,'pagos');
    assert.equal(h.llamadas.filter(x=>x.nombre==='haiku_registrar_servicio').length,1);
    assert.equal(h.tablas.servicios.length,1);
});

test('un cambio de saldo o Libro invalida una decisión manual y evita confirmar el pago viejo',async()=>{
    const h=entorno(),plan=await h.preparar(),aprobado=await h.resolver(plan,itemPago(plan),{tipo:'distribucion_comprobante'});
    h.tablas.vista_estado_cargos[0].saldo_cargo=4000;
    await assert.rejects(Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,aprobado,h.db),/cambió/);
    assert.equal(h.aprobados.size,0);assert.equal(h.decisiones.size,0);
    assert.equal(h.llamadas.some(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
    const otro=entorno({distribuido:false,conServicios:false}),previo=await otro.preparar();otro.cambiarLibro();
    await assert.rejects(otro.resolver(previo,itemPago(previo),accionServicio),/Libro/);
});

test('la creación manual se vincula al snapshot nuevo; cambios posteriores requieren nueva confirmación',async()=>{
    const h=entorno({distribuido:false,conServicios:false}),plan=await h.preparar();
    const creado=await h.resolver(plan,itemPago(plan),accionServicio);
    assert.equal(h.aprobados.size,0);assert.equal(h.decisiones.size,1);
    h.tablas.servicios[0].personas=3;
    await assert.rejects(Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,creado,h.db),/cambió/);
    const revisar=await h.preparar(),item=itemPago(revisar);
    assert.equal(item.categoria,'dudosos');assert.equal(item.seleccionado,false);
    assert.equal(item.manualPago.tipo,'asociacion_pago');
    assert.equal(itemPago(await h.preparar()).categoria,'dudosos');
    const confirmado=await h.resolver(revisar,item,{tipo:'asociacion_pago'});
    assert.equal(itemPago(confirmado).categoria,'pagos');
});

test('creación concurrente no permite aceptar otros cambios ni datos del servicio distintos',async()=>{
    for(const cambio of ['reserva','personas','durante_rpc']) {
        const h=entorno({distribuido:false,conServicios:false}),plan=await h.preparar();
        if(cambio==='durante_rpc') {
            const rpc=h.db.rpc.bind(h.db);h.db.rpc=async(n,a)=>{
                const r=await rpc(n,a);
                if(n==='haiku_registrar_servicio') h.tablas.reserva_estadias[0].adultos=4;
                return r;
            };
            const nuevo=await h.resolver(plan,itemPago(plan),accionServicio);
            assert.equal(itemPago(nuevo).categoria,'dudosos');assert.equal(itemPago(nuevo).seleccionado,false);
        } else {
            h.agregar(3,30000);
            if(cambio==='reserva') h.tablas.reserva_estadias[0].adultos=4;
            else h.tablas.servicios[0].personas=3;
            await assert.rejects(h.resolver(plan,itemPago(plan),accionServicio),/cambió/);
            assert.equal(h.llamadas.some(x=>x.nombre==='haiku_registrar_servicio'),false);
        }
        assert.equal(h.tablas.servicios.length,1);
        assert.equal(h.llamadas.some(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
    }
});

test('fallo al crear o ausencia de cargo/saldo mantiene pago sin preparar',async()=>{
    for(const fallo of ['rpc','cargo','saldo','lectura']) {
        const h=entorno({distribuido:false,conServicios:false}),plan=await h.preparar();
        if(fallo==='rpc') h.opciones.errorServicio=true;
        else {
            const rpc=h.db.rpc.bind(h.db);h.db.rpc=async(n,a)=>{
                const r=await rpc(n,a);
                if(n==='haiku_registrar_servicio') {
                    if(fallo==='cargo') h.tablas.vista_estado_cargos=[];
                    if(fallo==='saldo') h.tablas.vista_estado_cargos[0].saldo_cargo=20000;
                    if(fallo==='lectura') h.opciones.errorLectura='servicios';
                }
                return r;
            };
        }
        if(fallo==='rpc'||fallo==='lectura') await assert.rejects(h.resolver(plan,itemPago(plan),accionServicio));
        else assert.equal(itemPago(await h.resolver(plan,itemPago(plan),accionServicio)).categoria,'dudosos');
        assert.equal(h.llamadas.some(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
    }
});

test('un fallo de pago conserva el servicio y el reintento nunca lo crea nuevamente',async()=>{
    const h=entorno({distribuido:false,conServicios:false}),plan=await h.preparar();
    const nuevo=await h.resolver(plan,itemPago(plan),accionServicio);h.opciones.errorPago=true;
    await assert.rejects(Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,nuevo,h.db),/Red/);
    h.opciones.errorPago=false;
    await Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,nuevo,h.db);
    assert.equal(h.llamadas.filter(x=>x.nombre==='haiku_registrar_servicio').length,1);
    const pagos=h.llamadas.filter(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1');
    assert.equal(pagos.length,2);assert.equal(pagos[0].args.p_operacion_id,pagos[1].args.p_operacion_id);
    assert.equal(h.tablas.servicios.length,1);
});

test('aprobaciones antiguas y pagos seguros conservan su preparación automática',async()=>{
    const h=entorno({distribuido:false});assert.equal(itemPago(await h.preparar()).categoria,'pagos');
    const sinAsociar=entorno({distribuido:false});sinAsociar.r.pagos_sin_asociacion=sinAsociar.r.pagos;sinAsociar.r.pagos=[];
    const previo=await sinAsociar.preparar();sinAsociar.aprobados.add(itemPago(previo).id);
    assert.equal(itemPago(await sinAsociar.preparar()).categoria,'pagos');
});

class El {
    constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.events={};this.textContent='';this.selectedIndex=0;}
    append(...xs){for(const x of xs) x.parentElement=this;this.children.push(...xs)} appendChild(x){this.append(x)} replaceChildren(...xs){this.children=xs}
    setAttribute(k,v){this[k]=v} removeAttribute(k){delete this[k]} addEventListener(k,f){this.events[k]=f}
    get options(){return this.children} get text(){return this.textContent}
    querySelectorAll(s){return this.children.flatMap(e=>[e,...e.querySelectorAll('*')]).filter(e=>s==='*'||s===e.tag||
        s==='details[open]'&&e.tag==='details'&&e.open||s.startsWith('.')&&(e.className||'').split(' ').includes(s.slice(1)));}
    querySelector(s){return this.querySelectorAll(s)[0]||null}
    click(){assert.fail('No se permiten fake clicks')}
}

async function editorUnidadUi({indice=2,codigo='huevo',concepto='6 HUEVOS',precioBase=500,catalogo={},origen={}}={}) {
    const h=entorno({conServicios:false}),p=h.r.pagos[0],aplicacion=p.aplicaciones_libro[indice],intentos=[];
    aplicacion.fecha_comprobante='2026-10-04';
    aplicacion.origen={...aplicacion.origen,...origen};
    p.texto_original=`Gastón // ${concepto} // Folio 00013 // BOVTAR 003013 // TOTAL $13.000`;
    Object.assign(h.tablas.catalogo_servicios.find(c=>c.codigo===codigo),{precio_base:precioBase,...catalogo});
    const original=JSON.stringify(h.r),rpc=h.db.rpc.bind(h.db);
    h.db.rpc=async(n,a)=>{
        if(n==='haiku_registrar_servicio') {intentos.push(structuredClone(a));return {error:Error('Prueba UI: sin crear servicios')};}
        return rpc(n,a);
    };
    const out=new El('div'),context={structuredClone,HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_PAGOS_DESTINOS_V1:D,
        haikuSupabase:h.db,HAIKU_LIBRO_RESERVA_V1:{estado:()=>({generacion:1})},haikuTienePermiso:()=>true,
        document:{createElement:t=>new El(t),querySelector:()=>null},addEventListener(){},
        Option:function(t,v){const e=new El('option');e.textContent=t;e.value=v;return e;}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8'),context);
    await context.HAIKU_LIBRO_CONSULTAS.abrirComparacionEstructurada(out,{reservas:[h.r],generacion:1});
    const boton=t=>out.querySelectorAll('button').find(e=>e.textContent===t);
    await boton('Preparar incorporación').events.click();await boton('Aprobación manual').events.click();
    await boton('Confirmar distribución').events.click();
    const panel=out.querySelector('.haiku-incorporacion-manual-pago-panel');
    // Esperar la apertura/carga real del catálogo, incluso si el paso anterior
    // dejó el panel abierto automáticamente; no confirmar un formulario cerrado.
    if(!panel.hidden)await boton('Aprobación manual').events.click();
    await boton('Aprobación manual').events.click();
    const campo=n=>panel.querySelectorAll('*').find(e=>e['aria-label']===n);
    const cambiar=(n,v)=>{const e=campo(n);e.value=v;e.events.change();};
    cambiar('Aplicación a resolver',String(indice));cambiar('Servicio del catálogo',codigo);
    campo('Tipo de cobro').value='normal';
    const sinEscrituras=()=>{
        assert.equal(h.tablas.servicios.length,0);assert.equal(h.tablas.vista_estado_cargos.length,0);
        assert.equal(h.tablas.pagos.length,0);assert.equal(JSON.stringify(h.r),original);
        assert.equal(h.llamadas.some(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
    };
    return {h,panel,campo,cambiar,boton,intentos,sinEscrituras};
}

test('UI por unidad: Huevo, Pan y ambos Queque omiten personas/hora y usan precio catálogo exacto sin discrepancia',async()=>{
    for(const [indice,codigo,concepto,precioBase,cantidad,monto] of [[2,'huevo','6 HUEVOS',500,6,3000],
        [1,'panMasaMadre','10 PAN',500,10,5000],[0,'quequeEntero','2 QUEQUES',2500,2,5000],[0,'trozoQueque','2 QUEQUES',2500,2,5000]]) {
        const e=await editorUnidadUi({indice,codigo,concepto,precioBase});
        assert.equal(e.campo('Personas').disabled,true);assert.equal(e.campo('Personas').parentElement.hidden,true);
        assert.equal(e.campo('Hora cuando corresponda').required,false);assert.equal(e.campo('Hora cuando corresponda').value,'');
        assert.equal(e.campo('Fecha del servicio').value,'2026-10-04');assert.equal(e.campo('Cantidad').value,String(cantidad));
        assert.equal(e.campo('Precio unitario CLP').value,String(precioBase));
        const detalle=e.panel.querySelector('.haiku-incorporacion-manual-precio').textContent;
        assert.ok(detalle.includes(precioBase.toLocaleString('es-CL')));assert.ok(detalle.includes(`Cantidad: ${cantidad}`));
        assert.ok(detalle.includes(monto.toLocaleString('es-CL')));assert.doesNotMatch(detalle,/difiere|confirma expresamente/i);
        assert.equal(e.campo('Confirmo el precio manual y el total exacto del Libro').parentElement.hidden,true);
        e.campo('Personas').value='99'; // Ni un valor residual reemplaza el cero del contrato.
        e.sinEscrituras();await e.boton('Guardar servicio y continuar').events.click();
        assert.equal(e.intentos.length,1);assert.equal(e.intentos[0].p_personas,0);assert.equal(e.intentos[0].p_hora,null);
        assert.equal(e.intentos[0].p_cantidad,cantidad);assert.equal(e.intentos[0].p_precio_manual,precioBase);
        assert.equal(e.intentos[0].p_fecha_servicio,'2026-10-04');e.sinEscrituras();
    }
});

test('UI evidencia: cantidades ausentes, contradictorias, repetidas o monetarias no se infieren por monto/precio',async()=>{
    for(const concepto of ['HUEVOS','6 HUEVOS // 8 HUEVOS','6 HUEVOS + 6 HUEVOS','$3.000 HUEVOS']) {
        const e=await editorUnidadUi({concepto});
        assert.equal(e.campo('Cantidad').value,'');assert.equal(e.campo('Precio unitario CLP').value,'500');
        await e.boton('Guardar servicio y continuar').events.click();assert.equal(e.intentos.length,0);e.sinEscrituras();
    }
    const e=await editorUnidadUi({origen:{fechaISO:'04-10-2026'}});
    assert.equal(e.campo('Fecha del servicio').value,'2026-10-04');e.sinEscrituras();
    const ambiguo=await editorUnidadUi({origen:{fechaISO:'05-10-2026'}});
    assert.equal(ambiguo.campo('Fecha del servicio').value,'');ambiguo.sinEscrituras();
});

test('UI personas: capacidad incluida/máxima o precio por persona conservan la exigencia del campo',async()=>{
    for(const catalogo of [{capacidad_incluida:2},{capacidad_maxima:4},{precio_persona_adicional:250}]) {
        const e=await editorUnidadUi({catalogo});
        assert.equal(e.campo('Personas').disabled,false);assert.equal(e.campo('Personas').required,true);
        e.campo('Confirmo el precio manual y el total exacto del Libro').checked=true;
        await e.boton('Guardar servicio y continuar').events.click();assert.equal(e.intentos.length,0);
        assert.match(e.panel.querySelector('.haiku-incorporacion-aviso').textContent,/personas/i);
        e.cambiar('Personas','2');e.campo('Confirmo el precio manual y el total exacto del Libro').checked=true;
        await e.boton('Guardar servicio y continuar').events.click();assert.equal(e.intentos[0].p_personas,2);e.sinEscrituras();
    }
});

test('UI hora: sólo requiere_horario=true exige hora; la hora opcional se valida sin inventarla',async()=>{
    for(const requiere_horario of [false,true]) {
        const e=await editorUnidadUi({catalogo:{requiere_horario}});
        assert.equal(e.campo('Hora cuando corresponda').required,requiere_horario);
        await e.boton('Guardar servicio y continuar').events.click();assert.equal(e.intentos.length,requiere_horario?0:1);
        if(requiere_horario) assert.match(e.panel.querySelector('.haiku-incorporacion-aviso').textContent,/hora/i);
        e.cambiar('Hora cuando corresponda','25:10');await e.boton('Guardar servicio y continuar').events.click();
        assert.equal(e.intentos.length,requiere_horario?0:1);
        e.cambiar('Hora cuando corresponda','11:30');await e.boton('Guardar servicio y continuar').events.click();
        assert.equal(e.intentos.at(-1).p_hora,'11:30');e.sinEscrituras();
    }
});

test('UI precio: un ajuste distinto del catálogo exige confirmación y conserva cantidad explícita',async()=>{
    const e=await editorUnidadUi();e.cambiar('Precio unitario CLP','600');
    assert.equal(e.campo('Cantidad').value,'6');assert.equal(e.campo('Confirmo el precio manual y el total exacto del Libro').parentElement.hidden,false);
    assert.match(e.panel.querySelector('.haiku-incorporacion-manual-precio').textContent,/difiere/);
    await e.boton('Guardar servicio y continuar').events.click();assert.equal(e.intentos.length,0);
    e.cambiar('Cantidad','5');await e.boton('Guardar servicio y continuar').events.click();assert.equal(e.intentos.length,0);
    e.campo('Confirmo el precio manual y el total exacto del Libro').checked=true;
    await e.boton('Guardar servicio y continuar').events.click();assert.equal(e.intentos[0].p_cantidad,5);
    assert.equal(e.intentos[0].p_precio_manual,600);e.sinEscrituras();
});

test('UI Gaston progresiva: elección explícita de ambos QUEQUE, precio mostrado/confirmado y cancelar sin escribir',async()=>{
    for(const elegido of ['quequeEntero','trozoQueque']) {
        const h=entorno({conServicios:false}),out=new El('div');
        const context={structuredClone,HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_PAGOS_DESTINOS_V1:D,
            haikuSupabase:h.db,HAIKU_LIBRO_RESERVA_V1:{estado:()=>({generacion:1})},haikuTienePermiso:()=>true,
            document:{createElement:t=>new El(t),querySelector:()=>null},addEventListener(){},
            Option:function(t,v){const e=new El('option');e.textContent=t;e.value=v;return e;}};
        vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8'),context);
        await context.HAIKU_LIBRO_CONSULTAS.abrirComparacionEstructurada(out,{reservas:[h.r],generacion:1});
        const boton=t=>out.querySelectorAll('button').find(e=>e.textContent===t);
        await boton('Preparar incorporación').events.click();await boton('Aprobación manual').events.click();
        assert.ok(boton('Confirmar distribución'));assert.equal(boton('Guardar servicio y continuar'),undefined);
        await boton('Confirmar distribución').events.click();await boton('Aprobación manual').events.click();
        const panel=out.querySelector('.haiku-incorporacion-manual-pago-panel');
        const campo=n=>panel.querySelectorAll('*').find(e=>e['aria-label']===n);
        const catalogo=campo('Servicio del catálogo');assert.equal(catalogo.value,'');
        assert.ok(catalogo.options.some(o=>o.value==='quequeEntero'));assert.ok(catalogo.options.some(o=>o.value==='trozoQueque'));
        for(const [n,v] of [['Aplicación a resolver','0'],['Fecha del servicio',FECHA],['Cantidad','1'],
            ['Personas','0'],['Precio unitario CLP','5000'],['Tipo de cobro','normal']]) campo(n).value=v;
        const confirma=campo('Confirmo el precio manual y el total exacto del Libro');confirma.checked=true;
        await boton('Guardar servicio y continuar').events.click();assert.equal(h.tablas.servicios.length,0);
        catalogo.value=elegido;catalogo.events.change();
        assert.equal(confirma.checked,false);assert.equal(campo('Precio unitario CLP').value,'5000');
        assert.match(panel.querySelector('.haiku-incorporacion-manual-precio').textContent,/5\.000.*5\.000.*difiere/);
        assert.ok(panel.querySelector('.haiku-incorporacion-manual-precio').textContent.includes(elegido==='quequeEntero'?'8.000':'2.000'));
        await boton('Guardar servicio y continuar').events.click();assert.equal(h.tablas.servicios.length,0);
        confirma.checked=true;await boton('Cancelar revisión').events.click();assert.equal(panel.hidden,true);
        assert.equal(confirma.checked,false);assert.equal(h.tablas.servicios.length,0);
        await boton('Aprobación manual').events.click();confirma.checked=true;
        await boton('Guardar servicio y continuar').events.click();
        const rpc=h.llamadas.find(x=>x.nombre==='haiku_registrar_servicio');
        assert.equal(rpc.args.p_codigo_servicio,elegido);assert.equal(rpc.args.p_precio_manual,5000);assert.equal(rpc.args.p_cantidad,1);
        assert.equal(h.tablas.servicios[0].total,5000);
        assert.equal(h.llamadas.some(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
    }
});

test('UI abre subpanel estructurado dentro de la tarjeta y mantiene Ver reserva por UUID',async()=>{
    const h=entorno({distribuido:false,conServicios:false}),out=new El('div'),abiertas=[];
    const context={structuredClone,HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_PAGOS_DESTINOS_V1:D,
        haikuSupabase:h.db,HAIKU_LIBRO_RESERVA_V1:{estado:()=>({generacion:1})},haikuTienePermiso:()=>true,
        document:{createElement:t=>new El(t),querySelector:()=>null},addEventListener(){},
        HAIKU_INSPECTOR_V1:{abrirReserva:(...args)=>abiertas.push(args)},
        Option:function(t,v){const e=new El('option');e.textContent=t;e.value=v;return e;}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8'),context);
    const api=context.HAIKU_LIBRO_CONSULTAS;
    await api.abrirComparacionEstructurada(out,{reservas:[h.r],generacion:1});
    const boton=texto=>out.querySelectorAll('button').find(x=>x.textContent===texto);
    await boton('Preparar incorporación').events.click();
    assert.ok(boton('Aprobación manual'));assert.equal(boton('Aprobar este pago'),undefined);
    assert.ok(boton('Ver reserva'));await boton('Ver reserva').events.click();assert.equal(abiertas[0][0],id(1));
    const panel=out.querySelector('.haiku-incorporacion-manual-pago-panel');assert.equal(panel.hidden,true);
    assert.ok(panel.querySelectorAll('button').every(b=>b.className.includes('haiku-incorporacion-manual-accion')));
    await boton('Aprobación manual').events.click();assert.equal(panel.hidden,false);
    const campos=panel.querySelectorAll('*').filter(e=>e['aria-label']);
    const campo=n=>campos.find(e=>e['aria-label']===n);
    assert.equal(campo('Servicio del catálogo').value,'');assert.ok(campo('Servicio del catálogo').options.length>1);
    assert.equal(campo('Precio unitario CLP').value,'');assert.equal(campo('Fecha del servicio').value,'');
    for(const [n,v] of [['Aplicación a resolver','0'],['Servicio del catálogo','tinajaTonel'],['Fecha del servicio',FECHA],
        ['Cantidad','1'],['Personas','2'],['Precio unitario CLP','30000'],['Tipo de cobro','normal']]) campo(n).value=v;
    campo('Precio unitario CLP').events.input();
    assert.match(panel.querySelector('.haiku-incorporacion-manual-precio').textContent,/35\.000.*30\.000.*30\.000.*difiere/);
    assert.equal(campo('Confirmo el precio manual y el total exacto del Libro').checked,false);
    campo('Confirmo el precio manual y el total exacto del Libro').checked=true;
    await boton('Guardar servicio y continuar').events.click();
    assert.equal(h.llamadas.filter(x=>x.nombre==='haiku_registrar_servicio').length,1);
    assert.equal(h.llamadas.filter(x=>x.nombre==='haiku_incorporar_pago_servicios_libro_v1').length,0);
});

test('UI confirma distribución o asociación en la misma tarjeta y excluye esas decisiones del atajo masivo',async()=>{
    for(const distribuido of [true,false]) {
        const h=entorno({distribuido}),out=new El('div');
        if(!distribuido) {h.r.pagos_sin_asociacion=h.r.pagos;h.r.pagos=[];}
        const context={structuredClone,HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_PAGOS_DESTINOS_V1:D,
            haikuSupabase:h.db,HAIKU_LIBRO_RESERVA_V1:{estado:()=>({generacion:1})},haikuTienePermiso:()=>true,
            document:{createElement:t=>new El(t),querySelector:()=>null},addEventListener(){},
            Option:function(t,v){const e=new El('option');e.textContent=t;e.value=v;return e;}};
        vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8'),context);
        await context.HAIKU_LIBRO_CONSULTAS.abrirComparacionEstructurada(out,{reservas:[h.r],generacion:1});
        const boton=t=>out.querySelectorAll('button').find(e=>e.textContent===t);
        await boton('Preparar incorporación').events.click();
        assert.ok(boton('Aprobación manual'));assert.equal(boton('Aprobar este pago'),undefined);
        assert.equal(out.querySelectorAll('.haiku-incorporacion-atajo--aprobar').length,0);
        await boton('Aprobación manual').events.click();
        const panel=out.querySelector('.haiku-incorporacion-manual-pago-panel');
        assert.match(panel.querySelector('.haiku-manual-monto').textContent,/\$/);
        if(distribuido) assert.equal(panel.querySelectorAll('.haiku-manual-destino').length,3);
        await boton(distribuido?'Confirmar distribución':'Confirmar asociación y pago').events.click();
        assert.equal(h.llamadas.some(c=>c.nombre==='haiku_registrar_servicio'||c.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
        assert.ok(out.querySelectorAll('article').some(e=>e.className.includes('haiku-incorporacion-item--pagos')));
    }
});

test('contratos del flujo manual: sólo RPC de servicio, sin inserts, timers, fake clicks ni refresh propio',()=>{
    const src=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
    const motor=src.slice(src.indexOf('const claveDecisionPago ='),src.indexOf('function crearPlanIncorporacion('));
    const ui=src.slice(src.indexOf('function panelAprobacionManualPago('),src.indexOf('function renderizarItemIncorporacion('));
    for(const codigo of [motor,ui]) {
        assert.doesNotMatch(codigo,/\.insert\(|\.update\(|setTimeout|setInterval|\.click\(|fechaSeleccionada|HAIKU_RESUMEN_REFRESH_V1|full_day/i);
        assert.doesNotMatch(codigo,/\.from\(['"](?:servicios|cargos|pagos|reservas|reserva_estadias)['"]\)/);
    }
    assert.deepEqual(Array.from(motor.matchAll(/cliente\.rpc\('([^']+)'/g),m=>m[1]),['haiku_registrar_servicio']);
});

async function revisionVisualUi(opciones={}) {
    const h=entorno(opciones),out=new El('div'),aperturas=[];
    const context={structuredClone,HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_PAGOS_DESTINOS_V1:D,
        haikuSupabase:h.db,HAIKU_LIBRO_RESERVA_V1:{estado:()=>({generacion:1})},haikuTienePermiso:()=>true,
        document:{createElement:t=>new El(t),querySelector:()=>null},addEventListener(){},
        HAIKU_INSPECTOR_V1:{abrirReserva:(...args)=>aperturas.push(args)},
        Option:function(t,v){const e=new El('option');e.textContent=t;e.value=v;return e;}};
    const exportacion='Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
    const codigo=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8').replace(exportacion,
        exportacion.replace(' })',', renderizarIncorporacion, continuarVistaManualPago })'));
    vm.runInNewContext(codigo,context);
    const api=context.HAIKU_LIBRO_CONSULTAS,aprobar=async()=>{};
    const render=plan=>api.renderizarIncorporacion(out,plan,()=>{},aprobar,()=>assert.fail('Esta revisión no incorpora pagos'));
    aprobar.manualPago=async(plan,id,accion)=>{
        const nuevo=await api.resolverAprobacionManualPago(h.result,h.decisiones,h.aprobados,plan,id,accion,h.db);
        api.continuarVistaManualPago(plan,nuevo,id,accion);render(nuevo);
    };
    render(await api.prepararIncorporacion(h.result,h.decisiones,h.aprobados,h.db));
    const boton=t=>out.querySelectorAll('button').find(e=>e.textContent===t);
    await boton('Aprobación manual').events.click();
    const panel=()=>out.querySelector('.haiku-incorporacion-manual-pago-panel');
    const texto=()=>panel().querySelectorAll('*').map(e=>e.textContent).join(' ');
    const campo=n=>panel().querySelectorAll('*').find(e=>e['aria-label']===n);
    const cambiar=(n,v)=>{campo(n).value=v;campo(n).events.change();};
    const crear=async(indice,codigo,cantidad,precio,personas='0')=>{
        if(campo('Servicio del catálogo').options.length<2) {
            if(!panel().hidden) await boton('Aprobación manual').events.click();
            await boton('Aprobación manual').events.click();
        }
        cambiar('Aplicación a resolver',String(indice));cambiar('Servicio del catálogo',codigo);
        cambiar('Fecha del servicio',FECHA);cambiar('Cantidad',String(cantidad));cambiar('Precio unitario CLP',String(precio));
        if(!campo('Personas').disabled) cambiar('Personas',personas);
        cambiar('Tipo de cobro','normal');
        if(!campo('Confirmo el precio manual y el total exacto del Libro').disabled) {
            campo('Confirmo el precio manual y el total exacto del Libro').checked=true;
            campo('Confirmo el precio manual y el total exacto del Libro').events.change();
        }
        assert.equal(boton('Guardar servicio y continuar').disabled,false);
        await boton('Guardar servicio y continuar').events.click();
    };
    return {h,out,context,aperturas,boton,panel,texto,campo,cambiar,crear};
}

test('diseño Paso 1: datos reales, total de la aplicación, evidencia intacta y CTA sólo válido',async()=>{
    const e=await revisionVisualUi({distribuido:false,conServicios:false}),antes=JSON.stringify(e.h.tablas),original=e.h.r.pagos[0].texto_original;
    assert.equal(e.panel().dataset.paso,'1');assert.match(e.texto(),/Paso 1 de 2.*Asociar el servicio/);
    assert.match(e.texto(),/Ignacio Herrera.*CAB 2.*03 oct 2026.*30\.000/);
    assert.match(e.texto(),/Falta el servicio en Haku.*Créalo y vincula este pago/);
    assert.equal(e.boton('Guardar servicio y continuar').disabled,true);
    assert.equal(e.panel().querySelector('pre').textContent,original);
    e.cambiar('Aplicación a resolver','0');e.cambiar('Servicio del catálogo','tinajaTonel');
    assert.equal(e.campo('Hora cuando corresponda').parentElement.hidden,true);
    assert.equal(JSON.stringify(e.h.tablas),antes,'abrir/renderizar no cambia servicios, cargos ni pagos');
    assert.equal(e.h.llamadas.some(c=>c.nombre==='haiku_registrar_servicio'),false);
    await e.boton('Cancelar revisión').events.click();assert.equal(e.panel().hidden,true);
    assert.equal(JSON.stringify(e.h.tablas),antes);
});

test('Paso 2 y éxito visibles usan el destino revalidado y la acción vigente, sin registrar el pago',async()=>{
    const e=await revisionVisualUi({distribuido:false,conServicios:false});
    await e.crear(0,'tinajaTonel',1,30000,'2');
    assert.equal(e.panel().hidden,false);assert.equal(e.panel().dataset.paso,'2');
    assert.match(e.texto(),/Listo para confirmar.*Confirmar asociación y pago/);
    assert.match(e.texto(),/DESTINO DEL PAGO.*Tinaja Tonel.*03 oct 2026.*1 hora/);
    assert.match(e.texto(),/Los montos coinciden.*30\.000/);
    assert.doesNotMatch(e.texto(),/Asociación y pago aprobados/);
    assert.equal(e.h.tablas.servicios.length,1);
    const antesEditar=JSON.stringify(e.h.tablas),llamadas=e.h.llamadas.length;
    await e.boton('Volver a editar').events.click();assert.equal(e.panel().hidden,true);
    assert.equal(JSON.stringify(e.h.tablas),antesEditar);assert.equal(e.h.llamadas.length,llamadas);
    await e.boton('Aprobación manual').events.click();
    await e.boton('Confirmar asociación y pago').events.click();
    assert.equal(e.panel().dataset.paso,'aprobado');assert.match(e.texto(),/Pago seguro.*Asociación y pago aprobados/);
    assert.match(e.texto(),/Servicio vinculado a la reserva.*Asociación del pago confirmada.*Disponible en Pagos seguros/);
    assert.match(e.texto(),/Continúa en la revisión para preparar los pagos seguros/);
    const abrir=e.panel().querySelector('.haiku-pago-ver-reserva');assert.ok(abrir);await abrir.events.click();
    assert.equal(e.aperturas[0][0],id(1));assert.equal(e.aperturas[0][2].estadiaId,id(2));
    assert.equal(e.h.llamadas.filter(c=>c.nombre==='haiku_registrar_servicio').length,1);
    assert.equal(e.h.llamadas.some(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
    const pagos=e.out.querySelectorAll('article').filter(e=>e.className.includes('haiku-incorporacion-item--pagos'));
    assert.equal(pagos.length,1);assert.equal(e.h.tablas.pagos.length,0);
    await e.boton('Volver a revisión').events.click();assert.equal(e.panel().hidden,true);
    assert.equal(e.out.querySelectorAll('article').filter(e=>e.className.includes('haiku-incorporacion-item--pagos')).length,1);
});

test('Gastón visual 0/3 → 1/3 → 2/3 → 3/3 conserva las creaciones y un solo comprobante padre',async()=>{
    const e=await revisionVisualUi({conServicios:false});
    await e.boton('Confirmar distribución').events.click();
    assert.equal(e.panel().hidden,false);assert.match(e.texto(),/Aplicaciones resueltas 0 de 3/);
    for(const [i,cantidad,precio,codigo] of [[0,1,5000,'quequeEntero'],[1,1,5000,'panMasaMadre'],[2,6,500,'huevo']]) {
        await e.crear(i,codigo,cantidad,precio);
        assert.match(e.texto(),new RegExp('Aplicaciones resueltas '+(i+1)+' de 3'));
        assert.equal(e.h.tablas.servicios.length,i+1);assert.equal(e.h.tablas.pagos.length,0);
        assert.equal(e.panel().dataset.paso,i===2?'2':'1');
        assert.equal(e.h.llamadas.some(c=>c.nombre==='haiku_incorporar_pago_servicios_libro_v1'),false);
    }
    assert.equal(e.out.querySelectorAll('article').filter(e=>e.className.includes('haiku-incorporacion-item--pagos')).length,1);
    await e.boton('Confirmar asociación y pago').events.click();
    assert.equal(e.panel().dataset.paso,'aprobado');assert.match(e.texto(),/13\.000/);
    assert.equal(e.h.llamadas.filter(c=>c.nombre==='haiku_registrar_servicio').length,3);
    assert.equal(e.h.tablas.pagos.length,0);
});

test('un rechazo funcional nunca muestra Pago seguro ni un éxito visual falso',async()=>{
    const e=await revisionVisualUi({distribuido:false,conServicios:false});e.h.opciones.errorServicio=true;
    await e.crear(0,'tinajaTonel',1,30000,'2');
    assert.equal(e.panel().dataset.paso,'1');assert.match(e.texto(),/Servicio rechazado/);
    assert.doesNotMatch(e.texto(),/Asociación y pago aprobados|Pago seguro/);
    assert.equal(e.h.tablas.servicios.length,0);assert.equal(e.h.tablas.pagos.length,0);
});

test('comprobante muestra BOVE y BOVTAR según sus propios campos, sin reinterpretar evidencia',async()=>{
    const e=await revisionVisualUi({distribuido:true,conServicios:true});
    assert.match(e.texto(),/Folio 00013.*BOVE 999.*BOVTAR 003013/);
    assert.equal(e.panel().querySelector('pre').textContent,e.h.r.pagos[0].texto_original);
    assert.equal(e.h.tablas.pagos.length,0);
});
