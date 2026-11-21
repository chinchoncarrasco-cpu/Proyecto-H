// Contratos de selección del lote. Exclusivamente reservas y pagos ficticios.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('./fixtures/libro-comparacion-readonly.cjs');
function api(){const w=F.web(F.caso('etapas').data);vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8').replace(
 'const apiConsultas = Object.freeze({ interpretar,','const apiConsultas = Object.freeze({ priorizarActualizacionesEstadia, restaurarSeleccionIncorporacion, interpretar,'),w);return w.HAIKU_LIBRO_CONSULTAS;}
const cambio=(extra={})=>({id:'mover',categoria:'actualizaciones',seleccionado:true,motivos:[],dependeDe:[],
 payload:{tipo:'reserva_actualizar',reserva_id:'reserva-original',estadia_id:'estadia-original',reserva:{antes:{},despues:{}},
  estadia:{antes:{cabana_numero:1,fecha_ingreso:'2026-12-01',fecha_salida:'2026-12-03',tipo_estadia:'alojamiento'},despues:{cabana_numero:2}}},...extra});
const alta=(cab=1)=>({id:'alta-'+cab,categoria:'nuevas',seleccionado:true,motivos:[],dependeDe:[],texto:'Persona Ficticia CAB '+cab,
 payload:{reserva:{titular_nombre:'Persona Ficticia'},estadias:[{cabana_numero:cab,datos:{fecha_ingreso:'2026-12-01',fecha_salida:'2026-12-03',tipo_estadia:'alojamiento'}}]}});
test('primera confirmación sólo envía correcciones; una preparación posterior habilita las altas',()=>{
 const Q=api(),p={items:[cambio(),alta(),alta(3)]};
 Q.priorizarActualizacionesEstadia(p);
 assert.equal(p.etapa,'actualizar_estadias');assert.equal(p.actualizarEstadiasPrimero,true);
 assert.deepEqual(Array.from(Q.serializarIncorporacion(p),i=>i.tipo),['reserva_actualizar']);
 assert.ok(p.items.slice(1).every(i=>i.etapaSiguiente&&!i.seleccionado));
 // Tras la relectura, la corrección ya coincide y no se vuelve a enviar.
 const siguiente={items:[alta(),alta(3)]};Q.priorizarActualizacionesEstadia(siguiente);
 assert.deepEqual(Array.from(Q.serializarIncorporacion(siguiente),i=>i.tipo),['reserva_nueva','reserva_nueva']);
});
test('un pago dependiente espera la misma etapa que su reserva',()=>{
 const Q=api(),p={items:[cambio(),alta(),{id:'pago',categoria:'pagos',seleccionado:true,motivos:[],dependeDe:['alta-1'],payload:{}}]};
 Q.priorizarActualizacionesEstadia(p);
 assert.equal(p.items[2].seleccionado,false);assert.equal(p.items[2].etapaSiguiente,true);
 // La serialización tampoco acepta forzar el check de una etapa deshabilitada.
 p.items[1].seleccionado=p.items[2].seleccionado=true;
 assert.deepEqual(Array.from(Q.serializarIncorporacion(p),i=>i.tipo),['reserva_actualizar']);
});
for(const motivo of ['sin seleccionar','bloqueada'])test('corrección '+motivo+': no intenta ocupar la cabaña ni bloquea una independiente',()=>{
 const Q=api(),p={items:[cambio(motivo==='bloqueada'?{motivos:['Destino ocupado']}:{seleccionado:false}),alta(),alta(3)]};
 Q.priorizarActualizacionesEstadia(p);
 assert.equal(p.items[1].seleccionado,false);assert.match(p.items[1].motivos.join(' '),/primero la actualización/);
 assert.equal(p.items[2].seleccionado,true);
 assert.deepEqual(Array.from(Q.serializarIncorporacion(p),i=>i.reserva?.titular_nombre).filter(Boolean),['Persona Ficticia']);
});
test('una modificación sólo de notas conserva el flujo existente',()=>{
 const Q=api(),m=cambio();m.payload.estadia={antes:{},despues:{}};m.payload.reserva={antes:{observaciones:'Antes'},despues:{observaciones:'Después'}};
 const p={items:[m,alta()]};Q.priorizarActualizacionesEstadia(p);
 assert.equal(p.etapa,undefined);assert.equal(p.items[1].seleccionado,true);
});
test('la etapa de identidad y sus bloqueos existentes se conservan',()=>{
 const Q=api(),p={etapa:'actualizar_identidad',items:[cambio(),alta()]};Q.priorizarActualizacionesEstadia(p);
 assert.equal(p.etapa,'actualizar_identidad');assert.equal(p.items[1].seleccionado,false);
});
test('la relectura conserva la intención de las altas aplazadas, sin seleccionarlas antes de corregir',()=>{
 const Q=api(),p={contextoSeleccion:{generacion:1},items:[cambio(),alta()]};Q.priorizarActualizacionesEstadia(p);
 const siguiente={contextoSeleccion:{generacion:1},items:[alta()]};
 Q.restaurarSeleccionIncorporacion(siguiente,p);assert.equal(siguiente.items[0].seleccionado,true);
 const pendiente={contextoSeleccion:{generacion:1},items:[cambio(),alta()]};Q.priorizarActualizacionesEstadia(pendiente);
 Q.restaurarSeleccionIncorporacion(pendiente,p);assert.equal(pendiente.items[1].seleccionado,false);
});
