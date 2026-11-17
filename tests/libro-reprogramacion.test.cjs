const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../js/haiku-reprogramacion-estadia-v1.js'),I=require('../js/haiku-servicios-identidad-v1.js');
function plan(){return {version:1,reserva_id:'r',estadia_id:'e',origen:{cabana_numero:9,fecha_ingreso:'2026-11-15',fecha_salida:'2026-11-16'},destino:{cabana_numero:9,fecha_ingreso:'2026-12-28',fecha_salida:'2026-12-29'},firma:'ficticia',
 snapshot:{reserva:{id:'r'},estadia:{id:'e'},servicios:[],notas:[],finanzas:'sin-cambios'},bloqueos:[],items:[
  {id:'late',nombre:'Late Check-out',tipo:'servicio',fecha_propuesta:'2026-12-29',estado:'trasladable',opciones:['mover','revision','conservar'],inicial:'mover'},
  {id:'viejo',nombre:'Jacuzzi de octubre',tipo:'servicio',estado:'revision',motivo:'Fuera de fechas originales',opciones:['revision','conservar'],inicial:null}]};}
const cliente=p=>{const calls=[];return{calls,auth:{getSession:async()=>({data:{session:{user:{id:'operador-ficticio'}}}})},rpc:async(n,a)=>{calls.push([n,a]);if(n==='haiku_reprogramacion_preparar_v1')return{data:structuredClone(p)};throw Error('Escritura no esperada');}};};
test('el servicio antiguo exige decisión y no queda confirmado por vínculo',()=>{const p=plan(),d=R.defaults(p);assert.equal(d.late,'mover');assert.equal(d.viejo,null);assert.equal(R.valida(p,d),false);assert.deepEqual(R.pendientes(p,d).map(i=>i.id),['viejo']);d.viejo='revision';assert.equal(R.valida(p,d),true);});
test('un bloqueo de disponibilidad impide confirmar aunque las decisiones estén completas',()=>{const p=plan(),d=R.defaults(p);d.viejo='conservar';p.bloqueos=['Cabaña ocupada'];assert.equal(R.valida(p,d),false);});
test('cambios de estado/horario y notas explican qué debe revisarse',()=>{const a=plan(),b=structuredClone(a);b.snapshot.notas=[{texto:'Nueva indicación'}];b.items[0].estado='revision';b.items[0].motivo='El horario está ocupado';b.items[0].conflictos=[{servicio_id:'otro'}];assert.match(R.diferencias(a,b).join(' '),/notas operativas/);assert.match(R.diferencias(a,b).join(' '),/Late Check-out: El horario está ocupado/);});
test('la propuesta Haku no escribe al preparar ni permite guardar una decisión incompleta',async()=>{const p=plan(),c=cliente(p),v=await R.preparar({cliente:c,reservaId:'r',estadiaId:'e',destino:p.destino});assert.equal(v.puedeGuardar(),false);await assert.rejects(()=>v.guardar(),/decisiones/);assert.equal(c.calls.filter(x=>x[0]!=='haiku_reprogramacion_preparar_v1').length,0);});
test('el pago/servicio cambiado tras la vista previa no dispara el escritor',async()=>{const p=plan(),c=cliente(p),v=await R.preparar({cliente:c,reservaId:'r',estadiaId:'e',destino:p.destino});v.decisiones.viejo='conservar';p.snapshot.servicios=[{hora_inicio:'19:00'}];await assert.rejects(()=>v.guardar(),e=>/servicios/.test(e.message)&&!!e.reprogramacionActual);assert.equal(c.calls.filter(x=>x[0]==='haiku_reprogramar_estadia_v1').length,0);});
test('la revisión sólo vale para el mismo estado y horario; una reprogramación manual posterior la supera',()=>{
 const s={id:'s',reserva_id:'r',estadia_id:'e',fecha_servicio:'2026-10-03',hora_inicio:'20:00',estado_servicio:'programado',catalogo_servicios:{codigo:'tinajaJacuzzi'},
  reprogramacion_revision_v1:{version:1,fecha:'2026-10-03',inicio:'20:00:00'}};
 assert.equal(R.revisionServicio(s),true);assert.equal(I.revisionReprogramacion(s),true);
 assert.equal(I.resolverServicio({...s,reprogramacion_revision_v1:null},[s]).estado,'revisar');
 assert.equal(I.resolverServicio({...s,reprogramacion_revision_v1:null,fecha_servicio:'2026-12-28'},[s]).estado,'nuevo','el servicio antiguo pendiente no absorbe otro servicio con fecha propia');
 assert.equal(R.revisionServicio({...s,fecha_servicio:'2026-12-28'}),false);assert.equal(I.revisionReprogramacion({...s,estado_servicio:'realizado'}),false);
});
