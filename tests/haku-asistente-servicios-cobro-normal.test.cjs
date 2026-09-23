const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const A=require('../js/supabase-asistente-servicios-cortesia-v1.js');

const titular={id:'r1',titular_nombre:'Mónica Pérez',estado_reserva:'checked_out',bove_checkout:null};
const estancia={id:'e1',reserva_id:'r1',cabana_id:'b4',cabanas:{numero:4}};
const catalogo=(codigo='tinajaJacuzzi')=>({id:'cat1',codigo,nombre:codigo==='tinajaJacuzzi'?'Tinaja Jacuzzi':'Tinaja Tonel de Madera',activo:true,permite_cortesia:true,unidad:'hora',precio_base:30000,capacidad_incluida:3,capacidad_maxima:codigo==='tinajaJacuzzi'?5:3,precio_persona_adicional:codigo==='tinajaJacuzzi'?10000:null});
const servicio=(extra={})=>({id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cat1',recurso_id:'re1',fecha_servicio:'2026-09-25',hora_inicio:'19:15:00',hora_fin:'21:15:00',cantidad:2,personas:2,precio_unitario_aplicado:30000,monto_adicional:0,total:0,tipo_cobro:'cortesia',motivo_cortesia:'Atención',estado_servicio:'programado',actualizado_en:'2026-09-22T12:00:00Z',catalogo_servicios:catalogo(),...extra});
const candidato=(extra={})=>{const s=servicio(extra);return {...s,reserva:titular,estadia:estancia,catalogo:s.catalogo_servicios,cabana_numero:4};};
const cargo={id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,monto:30000,estado:'anulado',actualizado_en:'2026-09-22T12:00:01Z',creado_en:'2026-09-20T12:00:00Z'};
const finanzas=(extra={})=>({cargos:[cargo],estados:[],aplicaciones:[],ajustes:[],...extra});
const orden='Haku, pasa el Jacuzzi de Monica Perez, cab 4, del 25-09 a cobro normal para 4 personas.';
const opciones=(extra={})=>({diaActual:'2026-09-22',permiso:()=>true,buscar:async()=>[candidato()],cargarFinanzas:async()=>finanzas(),cliente:{rpc:()=>{throw Error('RPC prohibido');}},...extra});
function clienteLectura(tablas){
 const consultas=[];
 return {consultas,from(tabla){
  const filtros=[],registro={tabla,columnas:null};
  const q={select(columnas){registro.columnas=columnas;return q;},
   in(campo,valores){filtros.push(fila=>valores.includes(fila[campo]));return q;},
   eq(campo,valor){filtros.push(fila=>fila[campo]===valor);return q;},
   order(){return q;},
   async range(desde,hasta){consultas.push(registro);return {data:(tablas[tabla]||[]).filter(fila=>filtros.every(f=>f(fila))).slice(desde,hasta+1),error:null};}};
  return q;
 }};
}

test('reconoce la acción canónica y los alias Tonel/Jacuzzi sin exigir frase exacta',()=>{
 for(const nombre of ['tonel','tinaja tonel','tonel de madera','tinaja de madera','tinaja tipo tonel']){
  const q=A.interpretar(`Pasa el ${nombre} de Monica Perez a cobro normal`,{diaActual:'2026-09-22'});
  assert.equal(q.accion,'CORTESIA_A_NORMAL',nombre);assert.equal(q.codigo_servicio,'tinajaTonel',nombre);
 }
 for(const nombre of ['jacuzzi','tinaja jacuzzi','tinaja tipo jacuzzi']){
  const q=A.interpretar(`Pasa el ${nombre} de Monica Perez a cobrar`,{diaActual:'2026-09-22'});
  assert.equal(q.codigo_servicio,'tinajaJacuzzi',nombre);
 }
 for(const destino of ['a cobro','a cobro normal','a cobrar','como cobrable','por cobrar'])
  assert.equal(A.interpretar(`Cambia el jacuzzi de Monica Perez ${destino}`,{diaActual:'2026-09-22'}).accion,'CORTESIA_A_NORMAL');
 const ambiguo=A.interpretar('Deja el tonel de Monica Perez como pagado',{diaActual:'2026-09-22'});
 assert.equal(ambiguo.accion,'CORTESIA_A_NORMAL');assert.match(ambiguo.errores.join(' '),/pagado/i);
 const breve=A.interpretar('Haku, pásalo a cobro',{diaActual:'2026-09-22'});
 assert.equal(breve.accion,'CORTESIA_A_NORMAL');assert.match(breve.errores.join(' '),/concepto del servicio/);
 assert.equal(A.interpretar('Pasa el tonel de Monica Perez a cortesía').accion,'NORMAL_A_CORTESIA');
});

test('resuelve personas explícitas sin confundirlas con horas y pide contexto para un nombre aislado',()=>{
 for(const frase of ['para 4 personas','4 personas','x 4 pers','para 4','cantidad 4']){
  const q=A.interpretar(`Pasa el jacuzzi de Monica Perez a cobro normal ${frase}`,{diaActual:'2026-09-22'});
  assert.equal(q.personas_solicitadas,4,frase);
 }
 const q=A.interpretar('Pasa el jacuzzi de Pedro, cab 4, del 25-09 a cobro normal para 4 personas',{diaActual:'2026-09-22'});
 assert.deepEqual([q.titular,q.cabana,q.fecha,q.personas_solicitadas],['Pedro',4,'2026-09-25',4]);assert.deepEqual(q.errores,[]);
 assert.match(A.interpretar('Pasa el jacuzzi de Pedro a cobro normal para 4 personas',{diaActual:'2026-09-22'}).errores.join(' '),/cabaña y fecha/);
 const horas=A.interpretar('Pasa el jacuzzi de Monica Perez a cobro normal, 2 horas',{diaActual:'2026-09-22'});
 assert.equal(horas.personas_solicitadas,null);
});

test('normaliza tildes, respeta filtros persistidos y conserva cardinalidad',()=>{
 const q=A.interpretar(orden,{diaActual:'2026-09-22'});
 const datos={reservas:[titular],servicios:[servicio()],estadias:[estancia]};
 assert.equal(A.resolverCandidatos(q,datos).length,1);
 assert.equal(A.resolverCandidatos({...q,cabana:8},datos).length,0);
 assert.equal(A.resolverCandidatos(q,{...datos,servicios:[servicio(),servicio({id:'s2'})]}).length,2);
 const unaPalabra=A.interpretar('Pasa el Jacuzzi de Monica, cab 4, del 25-09 a cobro normal',{diaActual:'2026-09-22'});
 assert.equal(A.resolverCandidatos(unaPalabra,datos).length,1);
 assert.equal(A.resolverCandidatos({...unaPalabra,fecha:null},datos).length,0);
});

test('busca desde las tablas reales de lectura con catálogo de precio y cargo histórico completo',async()=>{
 const cliente=clienteLectura({catalogo_servicios:[{id:'cat1',codigo:'tinajaJacuzzi'}],servicios:[servicio()],reservas:[titular],reserva_estadias:[estancia],cargos:[cargo],vista_estado_cargos:[],pago_aplicaciones:[],cargo_ajustes:[]});
 const q=A.interpretar(orden,{diaActual:'2026-09-22'});
 const encontrados=await A.buscarServicios(q,{cliente});
 assert.equal(encontrados.length,1);assert.equal(encontrados[0].reserva.titular_nombre,'Mónica Pérez');
 assert.deepEqual(cliente.consultas.slice(0,4).map(x=>x.tabla),['catalogo_servicios','servicios','reservas','reserva_estadias']);
 assert.match(cliente.consultas[1].columnas,/precio_persona_adicional/);
 const lectura=await A.cargarFinanzas(encontrados[0],{cliente,completo:true});
 assert.deepEqual(lectura.cargos,[cargo]);
 assert.equal(cliente.consultas.find(x=>x.tabla==='cargos').columnas,'*');
});

test('calcula el precio desde catálogo y cantidad persistida; bloquea exceso de capacidad',()=>{
 const f=finanzas();
 for(const personas of [1,2,3]){
  const j=A.evaluarElegibilidadCobro(candidato(),f,personas);assert.equal(j.total,60000);assert.equal(j.precio_hora,30000);assert.equal(j.elegible,true);
  const t=A.evaluarElegibilidadCobro(candidato({catalogo_servicios:catalogo('tinajaTonel')}),f,personas);assert.equal(t.total,60000);assert.equal(t.elegible,true);
 }
 for(const [personas,hora,total] of [[4,40000,80000],[5,50000,100000]]){
  const e=A.evaluarElegibilidadCobro(candidato(),f,personas);assert.equal(e.precio_hora,hora);assert.equal(e.total,total);assert.equal(e.elegible,true);
 }
 assert.equal(A.evaluarElegibilidadCobro(candidato(),f,6).elegible,false);
 assert.equal(A.evaluarElegibilidadCobro(candidato({catalogo_servicios:catalogo('tinajaTonel')}),f,4).elegible,false);
 assert.equal(A.evaluarElegibilidadCobro(candidato({cantidad:0}),f,2).elegible,false);
});

test('preparar usa personas persistidas válidas y pregunta si faltan, sin usar adultos de reserva',async()=>{
 const sinPersonas='Pasa el Jacuzzi de Monica Perez cab 4 del 25-09 a cobro normal';
 const p=await A.preparar(sinPersonas,opciones());
 assert.equal(p.estado,'propuesta');assert.equal(p.personas_origen,'persistidas');assert.equal(p.elegibilidad.personas,2);
 assert.match(A.renderizar(p),/Actualmente el servicio tiene 2 personas/);
 const invalida=await A.preparar(sinPersonas,opciones({buscar:async()=>[candidato({personas:null})]}));
 assert.equal(invalida.estado,'incompleta');assert.match(invalida.mensaje,/cuántas personas/);
 const explicita=await A.preparar(orden,opciones({buscar:async()=>[candidato({personas:null})]}));
 assert.equal(explicita.estado,'propuesta');assert.equal(explicita.elegibilidad.personas,4);
});

test('historial financiero incompatible y otros estados quedan en Requiere revisión sin confirmar',async()=>{
 for(const f of [finanzas({aplicaciones:[{id:'a1'}]}),finanzas({ajustes:[{id:'j1'}]}),finanzas({cargos:[{...cargo,estado:'activo'}]})]){
  const p=await A.preparar(orden,opciones({cargarFinanzas:async()=>f}));
  assert.equal(p.estado,'bloqueada');assert.match(A.renderizar(p),/Requiere revisión/);
  assert.doesNotMatch(A.renderizar(p),/data-servicio-cobro-confirmar/);
 }
 const noEncontrado=await A.preparar(orden,opciones({buscar:async()=>[]}));assert.equal(noEncontrado.estado,'no_encontrado');
 const multiples=await A.preparar(orden,opciones({buscar:async()=>[candidato(),candidato({id:'s2'})]}));
 assert.equal(multiples.estado,'multiples');assert.doesNotMatch(A.renderizar(multiples),/data-servicio-cobro-confirmar/);
});

test('el estado esperado incluye exactamente las claves del RPC y conserva el cargo histórico completo',()=>{
 const e=A.estadoEsperadoCobro(candidato(),finanzas());
 assert.deepEqual(Object.keys(e),['version','servicio_id','servicio_actualizado_en','catalogo_servicio_id','catalogo_codigo','catalogo_activo','catalogo_permite_cortesia','catalogo_unidad','precio_base','capacidad_incluida','capacidad_maxima','precio_persona_adicional','cantidad','personas','tipo_cobro','total','estado_servicio','estado_reserva','bove_checkout','cargos','cantidad_cargos_activos','cantidad_aplicaciones','cantidad_ajustes']);
 assert.deepEqual(e.cargos,[cargo]);assert.equal(e.cantidad_cargos_activos,0);
});

test('tarjeta muestra comparación y confirmación simulada; revalida y jamás llama al RPC',async()=>{
 let rpc=0,lecturas=0;
 const o=opciones({cliente:{rpc:async()=>{rpc++;throw Error('RPC prohibido');}},buscar:async()=>{lecturas++;return [candidato()];}});
 const p=await A.preparar(orden,o);assert.equal(p.estado,'propuesta');
 assert.equal((await A.confirmar(p,'motivo improcedente')).estado,'bloqueada');
 const vista=A.renderizar(p);
 for(const texto of ['Mónica Pérez · CAB 4','Tinaja Jacuzzi','25-09-2026 · 19:15–21:15','Cortesía','Cobro normal','$80.000','4 personas','Confirmar cambio · simulación','No se ejecutará el RPC'])assert.ok(vista.includes(texto),texto);
 assert.match(vista,/data-servicio-cobro-confirmar/);assert.doesNotMatch(vista,/data-servicio-cortesia-confirmar/);
 const operacionId='d9042e70-2ac6-41f8-9f07-65f16bdcc77b';
 const a=A.simularCobro(p,{operacionId}),b=A.simularCobro(p,{operacionId:'f125b628-3b5c-4d29-9df8-f6a1db2d73a5'});
 assert.equal(a,b);const resultado=await a;
 assert.equal(resultado.estado,'simulada');assert.equal(resultado.rpc,'haiku_cambiar_servicio_a_cobro_normal_v1');
 assert.deepEqual(Object.keys(resultado.parametros),['p_operacion_id','p_servicio_id','p_personas','p_estado_esperado']);
 assert.equal(resultado.parametros.p_operacion_id,operacionId);assert.equal(resultado.parametros.p_servicio_id,'s1');assert.equal(resultado.parametros.p_personas,4);
 assert.deepEqual(resultado.parametros.p_estado_esperado,p.p_estado_esperado);
 assert.equal(rpc,0);assert.equal(lecturas,2);
 assert.match(A.renderizar(resultado),/No se llamó al RPC/);
});

test('estado obsoleto bloquea la simulación y prepara una propuesta nueva',async()=>{
 let actual=candidato();let rpc=0;
 const o=opciones({buscar:async()=>[actual],cliente:{rpc:async()=>{rpc++;}}});
 const p=await A.preparar(orden,o);
 actual=candidato({actualizado_en:'2026-09-22T13:00:00Z'});
 const r=await A.simularCobro(p,{uuid:()=> 'op-1'});
 assert.equal(r.estado,'obsoleta');assert.equal(r.nueva.estado,'propuesta');assert.equal(rpc,0);
});

test('el flag independiente de cobro queda apagado y la ruta UI sólo llega a simularCobro',()=>{
 const fuente=fs.readFileSync(require.resolve('../js/supabase-asistente-servicios-cortesia-v1.js'),'utf8');
 assert.match(fuente,/const RPC_PRODUCCION_HABILITADO=true;/);
 assert.match(fuente,/const RPC_COBRO_NORMAL_PRODUCCION_HABILITADO=false;/);
 assert.match(fuente,/if\(b\.hasAttribute\('data-servicio-cobro-confirmar'\)\)p=await simularCobro\(propuesta\)/);
 assert.doesNotMatch(A.simularCobro.toString(),/\.rpc\s*\(/);
});
