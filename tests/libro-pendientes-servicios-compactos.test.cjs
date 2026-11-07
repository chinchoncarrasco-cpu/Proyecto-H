const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {entorno,read}=require('./fixtures/libro-servicio-manual.cjs');
const C=require('../js/haiku-libro-contexto-v1.js'),A=require('../js/supabase-asistente-libro-actualizacion-v1.js');
const texto='1 HORA DE TINAJA TONEL DE MADERA A LAS 17.15 X COBRAR // 2 MASAJES RELAJANTES DE 1 HORA C/U SIMULTANEOS CON MONICA Y XXX PARA EL SÁBADO 14 DE NOV A LAS 16.00 HRS X COBRAR';
async function crearCaso(){
    const e=entorno(),r=e.state.reservas[0],s=e.state.db.reserva_estadias[0];
    Object.assign(r,{id:'Nov26!CA6',hoja:'Nov26',titular:'Persona Ejemplo',cabana:3,
        fecha_checkin:'2026-11-13',fecha_checkout:'2026-11-15',noches:2,
        texto_original:texto,pagos:[],pagos_sin_asociacion:[],notas_importantes:[],pagos_pendientes:[texto]});
    r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto,{origen_campo:'pagos_pendientes',pendiente:true});
    Object.assign(s,{fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout});
    e.state.db.reservas[0].titular_nombre=r.titular;e.state.db.cabanas[0].numero=3;
    e.state.db.servicios.push({id:'masajes-registrados',reserva_id:s.reserva_id,estadia_id:s.id,
        fecha_servicio:'2026-11-14',hora_inicio:'16:00:00',hora_fin:'17:00:00',personas:2,cantidad:2,
        tipo_cobro:'normal',total:90000,estado_servicio:'programado',
        catalogo_servicios:{codigo:'masajeTerapeutico60',nombre:'Masaje Terapéutico 60 min'}});
    for(const x of e.state.db.reserva_estadias){x.cabanas=e.state.db.cabanas.find(c=>c.id===x.cabana_id);x.reservas=e.state.db.reservas.find(r=>r.id===x.reserva_id);}
    const from=e.c.haikuSupabase.from;e.c.haikuSupabase.from=n=>{const q=from(n);q.order=()=>q;q.range=(a,z)=>Promise.resolve(q).then(x=>({...x,data:x.data.slice(a,z+1)}));return q;};
    e.c.haikuSupabase.auth.getSession=async()=>({data:{session:{user:{id:e.state.usuario}}}});
    e.c.structuredClone=structuredClone;e.document.querySelector=()=>null;vm.runInContext(read('js/haiku-libro-consultas-v1.js'),e.c);
    const registro={id:'pendiente',tipo:'modificacion',actual:r,anterior:{...r,servicios:[],pagos_pendientes:[]},
        cambios:[{campo:'servicios',antes:[],ahora:r.servicios},{campo:'pagos_pendientes',antes:[],ahora:[texto]}]};
    const comparacion=await e.c.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],e.c.haikuSupabase,{generacion:1});
    const item=comparacion.items[0];item.contexto=C.construir(item,{servicios:comparacion.serviciosContexto,notas:comparacion.notasContexto});
    return {e,item,html:A.renderizarPendientes({generacion:1,items:[item]})};
}
module.exports={crearCaso};
test('lector semántico → comparación → contexto: una fecha faltante, dos masajes registrados y ninguna glosa convertida en pago',async()=>{
    const {e,item,html}=await crearCaso();
    const masaje=item.contexto.servicios.find(x=>x.tipo==='masaje');
    assert.equal(masaje.estado,'en_sistema');assert.equal(masaje.cantidad,2);assert.equal(masaje.fecha,'2026-11-14');
    assert.equal((html.match(/Falta indicar el día\./g)||[]).length,1);
    assert.match(html,/Masaje[^<]*×2[^<]*14-11-2026[^<]*16:00/);assert.match(html,/Ya registrado\./);
    assert.doesNotMatch(html,/inequívoca|sin adivinar|servicios o sus notas|servicio o nota|Pagos pendientes|Antes en el Libro: Ninguno|Nota de cobro · por revisar/);
    assert.match(html,/<details class="haku-pendiente-comparacion"><summary>Ver detalle del Libro/);
    assert.equal(e.state.escrituras.length,0);
});
test('conserva una nota independiente, otros cambios y las advertencias que no son la fecha',async()=>{
    const {item}=await crearCaso();
    item.cambios.push({campo:'notas_importantes',antes:[],ahora:['Dejar batas y <toallas>']},{campo:'adultos',antes:2,ahora:3,proyecto:2});
    item.contexto.servicios.find(x=>x.tipo==='tonel').razones.push('El precio del Libro difiere del catálogo.');
    const html=A.renderizarPendientes({generacion:1,items:[item]});
    assert.match(html,/Nota · por revisar/);assert.match(html,/Dejar batas y &lt;toallas&gt;/);assert.doesNotMatch(html,/<toallas>/);
    assert.match(html,/Adultos: 2 → 3/);assert.match(html,/El precio del Libro difiere del catálogo/);
    assert.equal((html.match(/Falta indicar el día\./g)||[]).length,1);
});
test('sin contexto operativo conserva la advertencia, y un conflicto de fechas mantiene prioridad',async()=>{
    const {item}=await crearCaso();
    const c=item.contexto;delete item.contexto;
    assert.match(A.renderizarPendientes({generacion:1,items:[item]}),/Falta una fecha/);
    item.contexto={...c,avisos:[{codigo:'noches_contradictorias',texto:'El texto dice dos noches, pero las celdas cubren una.'}]};
    assert.match(A.renderizarPendientes({generacion:1,items:[item]}),/El texto dice dos noches, pero las celdas cubren una/);
});
test('el motivo principal de identidad no se pierde al resumir los datos que faltan',async()=>{
    const {item}=await crearCaso(),s=item.contexto.servicios.find(x=>x.tipo==='tonel');
    s.razon='La asociación de la reserva requiere revisión antes de incorporar.';
    const html=A.renderizarPendientes({generacion:1,items:[item]});
    assert.match(html,/La asociación de la reserva requiere revisión antes de incorporar/);
    assert.equal((html.match(/Falta indicar el día\./g)||[]).length,1);
});

test('el informe explica una vez cortesía en Libro frente al cobro de Proyecto H, sin modificar el servicio',async()=>{
    const {e}=await crearCaso(),r=e.state.reservas[0],estadia=e.state.db.reserva_estadias[0];
    r.texto_original='TÓNEL EL 13/11 A LAS 22.15 CORTESIA';r.pagos_pendientes=[];
    r.servicios=e.c.HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
    e.state.db.servicios=[{id:'tonel-registrado',reserva_id:estadia.reserva_id,estadia_id:estadia.id,
        fecha_servicio:'2026-11-13',hora_inicio:'22:15:00',hora_fin:'23:15:00',personas:2,cantidad:1,
        tipo_cobro:'normal',total:30000,estado_servicio:'programado',
        observaciones:'Importado desde Libro: TÓNEL EL 13/11 A LAS 22.15 X PAGAR',
        catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera'}}];
    const antes=JSON.stringify(e.state.db),registro={id:'cambio-cobro',tipo:'modificacion',actual:r,
        anterior:{...r,servicios:[]},cambios:[{campo:'servicios',antes:[],ahora:r.servicios}]};
    const comp=await e.c.HAIKU_LIBRO_CONSULTAS.revalidarCambiosDetectados([registro],e.c.haikuSupabase,{generacion:1});
    const item=comp.items[0];item.contexto=C.construir(item,{servicios:comp.serviciosContexto,notas:comp.notasContexto});
    const html=A.renderizarPendientes({generacion:1,items:[item]});
    assert.equal((html.match(/Libro: cortesía\. Proyecto H: cobro de \$30\.000\. Falta actualizar el cobro\./g)||[]).length,1);
    assert.doesNotMatch(html,/tipo_cobro|contradice datos|Completa lo que falta/);
    assert.match(html,/Ver detalle del Libro/);
    assert.equal(JSON.stringify(e.state.db),antes);assert.equal(e.state.escrituras.length,0);
});
