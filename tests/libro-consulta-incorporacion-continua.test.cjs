// Regresiones del consumidor de haiku-libro-semantica-v1, sin datos ni escrituras reales.
const test=require('node:test'),assert=require('node:assert/strict');
const f=require('./fixtures/libro-comparacion-readonly.cjs');
function fuente(ctx, obtener, inicial=1) {
    let generacion=inicial, version='a'.repeat(64), lecturas=[];
    const estado=()=>({cargado:true,generacion,version,nombre:'prueba.xlsx'});
    const libro={estado,listarHojas:()=>['Oct26','Nov26'],listo:async()=>{},crearLectura:async()=>{
        const fijo=estado(),data=f.copy(obtener());
        return {estado:()=>fijo,listarHojas:libro.listarHojas,listo:libro.listo,
            consultarHoja:async hoja=>{lecturas.push(hoja);return f.copy(data);},
            consultarHojas:async hojas=>{lecturas.push(...hojas);return hojas.map(()=>f.copy(data));}};
    }};
    ctx.HAIKU_LIBRO_RESERVA_V1=libro;
    return {libro,lecturas,cambiar:()=>{generacion++;version=(generacion%2?'a':'b').repeat(64);}};
}
async function escenario({dos=false,onRead}={}) {
    const caso=f.casos().find(c=>c.id==='reserva_faltante');
    if(dos)caso.data.reservas.push(f.reserva({id:'otro-caso',titular:'Otra Persona',cabana:2,coordenadas_origen:f.origen('C4')}));
    const ctx=f.web(caso.data);ctx.haikuTienePermiso=()=>true;
    const src=fuente(ctx,()=>caso.data),api=ctx.HAIKU_LIBRO_CONSULTAS,cli=f.cliente(caso.db,{onRead});
    const llamadas=[];cli.rpc=async(n,args)=>{llamadas.push({n,args:f.copy(args)});return {data:{ok:true,reservas_creadas:args.p_items.length,pagos_creados:0}};};
    const result=await api.consultar('Libro: compara reservas de octubre 2026 con Proyecto H',src.libro,cli);
    const decisiones=new Map(),aprobados=new Set();
    const preparar=()=>api.prepararIncorporacion(result,decisiones,aprobados,cli);
    const confirmar=plan=>api.confirmarIncorporacion(result,decisiones,aprobados,plan,cli);
    return {caso,ctx,src,api,cli,llamadas,result,decisiones,aprobados,preparar,confirmar};
}
test('otro cambio en el Libro permite preparar y confirmar sin rehacer la consulta',async()=>{
    const h=await escenario(),antes=f.copy(h.result.reservas);h.src.lecturas.length=0;h.src.cambiar();
    const plan=await h.preparar();assert.equal(plan.items.filter(i=>i.seleccionado).length,1);
    const r=await h.confirmar(plan);assert.equal(r.resultado.reservas_creadas,1);
    assert.deepEqual(h.src.lecturas,['Oct26'],'Sólo relee la hoja consultada una vez por versión');
    assert.deepEqual(f.copy(h.result.reservas),antes);assert.equal(h.result.generacion,1);
});
test('una descarga idéntica conserva la selección y permite confirmar el plan abierto',async()=>{
    const h=await escenario({dos:true}),plan=await h.preparar();plan.items[1].seleccionado=false;h.src.cambiar();
    await h.confirmar(plan);assert.equal(h.llamadas[0].args.p_items.length,1);
    assert.equal(h.llamadas[0].args.p_items[0].reserva.titular_nombre,'Ficticiouno Apellidouno');
});
test('el cambio de la misma reserva queda localizado; el otro caso sigue listo',async()=>{
    const h=await escenario({dos:true});h.caso.data.reservas[0].fecha_checkout='2026-10-06';h.src.cambiar();
    const plan=await h.preparar(),conflicto=plan.items.find(i=>i.cambioFuente);
    assert.match(conflicto.motivos[0],/Salida: 2026-10-05 → 2026-10-06/);
    assert.equal(plan.items.filter(i=>i.seleccionado).length,1);
    await h.confirmar(plan);assert.equal(h.llamadas[0].args.p_items[0].reserva.titular_nombre,'Otra Persona');
});
test('un caso cambiado después de preparar nunca envía los valores antiguos',async()=>{
    const h=await escenario(),plan=await h.preparar();h.caso.data.reservas[0].adultos=3;h.src.cambiar();
    await assert.rejects(h.confirmar(plan),e=>e.planActual?.items.some(i=>i.cambioFuente));
    assert.equal(h.llamadas.length,0);
});
test('aceptar el cambio prepara su evidencia nueva y conserva el otro caso sin seleccionarlo por accidente',async()=>{
    const h=await escenario({dos:true});h.caso.data.reservas[0].adultos=3;h.src.cambiar();
    const plan=await h.preparar(),conflicto=plan.items.find(i=>i.cambioFuente).cambioFuente;
    const nuevo=await plan.usarFuenteActual(conflicto);
    assert.equal(nuevo.items.filter(i=>i.seleccionado).length,1);
    assert.equal(nuevo.items[0].payload.estadias[0].datos.adultos,3);
    assert.equal(plan.items.find(i=>i.seleccionado).payload.reserva.titular_nombre,'Otra Persona');
    assert.equal(h.result.reservas[0].adultos,2,'No se cambia silenciosamente la evidencia anterior');
});
test('una fuente eliminada o duplicada no se toma por otra reserva',async()=>{
    for(const modo of ['eliminada','duplicada']) {
        const h=await escenario();h.caso.data.reservas=modo==='eliminada'?[]:[h.caso.data.reservas[0],f.copy(h.caso.data.reservas[0])];h.src.cambiar();
        const plan=await h.preparar();assert.equal(plan.items.filter(i=>i.seleccionado).length,0);
        assert.equal(plan.items.find(i=>i.cambioFuente).cambioFuente.actual,null);
    }
});
test('si llega otra versión durante la lectura de Proyecto H, continúa y verifica las celdas',async()=>{
    let h,activar=false;h=await escenario({onRead:()=>{if(activar){activar=false;h.src.cambiar();}}});activar=true;
    const plan=await h.preparar();assert.equal(plan.items[0].seleccionado,true);await h.confirmar(plan);
    assert.equal(h.llamadas.length,1);
});
test('una actualización durante el RPC no borra una incorporación confirmada',async()=>{
    const h=await escenario(),plan=await h.preparar(),rpc=h.cli.rpc;
    h.cli.rpc=async(n,args)=>{h.src.cambiar();return rpc(n,args);};
    const r=await h.confirmar(plan);assert.equal(r.resultado.reservas_creadas,1);assert.equal(plan.solicitudPendiente.confirmada,true);
});
test('respuesta perdida y nueva versión conservan UUID y payload en el reintento',async()=>{
    const h=await escenario(),plan=await h.preparar(),rpc=h.cli.rpc;let n=0;
    h.cli.rpc=async(name,args)=>{const r=await rpc(name,args);if(++n===1){h.src.cambiar();throw Error('Red interrumpida');}return r;};
    await assert.rejects(h.confirmar(plan),/Red interrumpida/);
    h.caso.data.reservas[0].adultos=4;h.src.cambiar();
    await h.confirmar(plan);assert.deepEqual(h.llamadas[0],h.llamadas[1]);
});
test('una aclaración de medio de pago conserva su evidencia, permiso y aprobación frente a otro cambio',async()=>{
    const {entorno}=require('./fixtures/libro-medio-pago-manual.cjs'),h=entorno();
    const src=fuente(h.ctx,()=>({hoja:'Oct26',reservas:h.result.reservas,cobertura:{geometria:true}}),h.result.generacion);
    let plan=await h.preparar();plan=await h.definir(plan,'webpay_credito');
    h.aprobados.add(h.item(plan).id);plan=await h.preparar();
    const evidencia=f.copy(h.item(plan).payload);src.cambiar();
    const actual=await h.preparar();assert.deepEqual(f.copy(h.item(actual).payload),evidencia);
    assert.equal(h.aprobados.has(h.item(plan).id),true);
    await h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,actual,h.db);
    assert.equal(h.llamadas.filter(x=>x.nombre==='haiku_incorporar_libro_v1').length,1);
});

test('la revalidación mantiene la proyección original de una consulta sólo de pagos',async()=>{
 const h=await escenario();
 const proyectar=r=>({...r,adultos:null,notas_importantes:[],servicios:[]});
 const proxy={...h.src.libro,crearLectura:async()=>{
  const base=await h.src.libro.crearLectura();return {...base,proyectarReservaConsulta:proyectar,
   consultarHoja:async hoja=>{const d=await base.consultarHoja(hoja);return {...d,reservas:d.reservas.map(proyectar)};}};
 }};
 const result=await h.api.consultar(f.consulta,proxy,h.cli);
 h.caso.data.reservas[0].notas_importantes=['Otra nota fuera del alcance'];h.src.cambiar();
 const plan=await h.api.prepararIncorporacion(result,new Map(),new Set(),h.cli);
 assert.equal(plan.items.some(i=>i.cambioFuente),false);
 assert.equal(result.reservas[0].adultos,null,'No incorpora campos omitidos por la consulta de pagos');
});
