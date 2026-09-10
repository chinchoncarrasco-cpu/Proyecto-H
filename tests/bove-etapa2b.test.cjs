const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../js/supabase-asistente-bove-consultas-v1.js'),dia='2026-09-10';
function db(reservas=[],cargos=[],servicios=[]){const calls=[];return {calls,from(tabla){calls.push(['from',tabla]);const data={reservas,vista_estado_cargos:cargos,servicios}[tabla]||[];const q={select(s){calls.push(['select',s]);return q;},order(){return q;},eq(k,v){calls.push(['eq',k,v]);return q;},gte(k,v){calls.push(['gte',k,v]);return q;},lte(k,v){calls.push(['lte',k,v]);return q;},or(s){calls.push(['or',s]);return q;},range:async()=>({data})};return q;}};}
const estadia=(extra={})=>({fecha_ingreso:dia,fecha_salida:'2026-09-11',estado_estadia:'hospedada',cabanas:{numero:6},...extra});
const reserva=(extra={})=>({id:'r',titular_nombre:'Persona Prueba',bove_cierre:null,bove_checkout:null,estadias:[estadia()],...extra});
function libro(evidencias=[],reservas=[]){const calls=[];return {calls,listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Ago26','Sep26','Oct26'],buscarHojasBove:async ns=>{calls.push(['buscar',ns]);return {hojas:['Sep26','Sep26']};},consultarHoja:async h=>{calls.push(['hoja',h]);return {evidencias_bove:evidencias,reservas};}};}
const e=(numero,extra={})=>({numero,estado:numero?'registrado':'pendiente',fecha_bloque:dia,cabana_contexto:6,origen:{hoja:'Sep26',celda:'L27',fila:27,columna:12},...extra});
const rLibro=()=>({titular:'Persona Prueba',cabana:6,fecha_checkin:dia,fecha_checkout:'2026-09-11',pagos:[{tipo_movimiento:'alojamiento',origen:{hoja:'Sep26',celda:'K27:N27'}}]});
for(const [texto,numeros,fuente] of [
 ['Haku, busca los BOVE 16968, 16981 y 16982',['16968','16981','16982'],'ambas'],
 ['Haku, busca estos BOVE: 16968 / 16981 / 19888',['16968','16981','19888'],'ambas'],
 ['Haku, busca 16968, 16981 y 16982 en el Libro',['16968','16981','16982'],'libro'],
 ['Haku, busca en Proyecto H los BOVE 16980, 16981, 16982',['16980','16981','16982'],'proyecto_h'],
 ['Haku, revisa los BOVE 16968 y 19888',['16968','19888'],'ambas'],
 ['busca BOVE 16.968 / 16,968 / 327',['16968','327'],'ambas'],
 ['busca BOVE 16968, 16981, 19888 y 327',['16968','16981','19888','327'],'ambas'],
 ['busca el BOVE 16968 en el Libro por favor',['16968'],'libro']
])test('sintaxis: '+texto,()=>{const q=B.interpretar(texto,dia);assert.deepEqual(q.numeros,numeros);assert.equal(q.fuente,fuente);if(numeros.length===1)assert.equal(q.numero,numeros[0]);});

test('varios números: una búsqueda, una lectura de hoja y un SELECT focalizado',async()=>{
 const l=libro([e('16968'),e('16981')]),c=db([reserva({bove_cierre:'16968'})]);
 const r=await B.consultar('busca los BOVE 16968 y 16981',{libro:l,cliente:c,dia});
 assert.equal(l.calls.filter(x=>x[0]==='buscar').length,1);assert.deepEqual(l.calls.find(x=>x[0]==='buscar')[1],['16968','16981']);assert.equal(l.calls.filter(x=>x[0]==='hoja').length,1);
 assert.equal(c.calls.filter(x=>x[0]==='from').length,1);assert.match(c.calls.find(x=>x[0]==='or')[1],/16968/);assert.match(c.calls.find(x=>x[0]==='or')[1],/16981/);assert.equal(r.por_numero.length,2);
 const html=B.renderizar(r);assert.match(html,/BOVE consultados · 2/);
});
test('inexistente y ambiguo no contaminan el número coincidente',async()=>{
 const l=libro([e('16968'),e('327',{origen:{hoja:'Sep26',celda:'Z90',fila:90,columna:26}})],[rLibro()]);
 const c=db([reserva({bove_cierre:'16968'}),reserva({id:'r2',bove_cierre:'327'})]);
 const r=await B.consultar('busca los BOVE 16968, 327 y 99999',{libro:l,cliente:c,dia});
 assert.deepEqual(r.por_numero.map(x=>x.estado),['coinciden','no_determinado','no_encontrado']);
});
test('múltiple sólo Libro no toca Proyecto H; sólo Proyecto H no lee Libro',async()=>{
 const c=db(),l=libro();await B.consultar('busca BOVE 16968 y 327 en el Libro',{libro:l,cliente:c,dia});assert.equal(c.calls.length,0);
 l.calls.length=0;await B.consultar('busca en Proyecto H los BOVE 16968 y 327',{libro:l,cliente:c,dia});assert.equal(l.calls.length,0);
});
for(const [texto,desde,hasta] of [
 ['qué BOVE está pendiente hoy',dia,dia],
 ['qué BOVE quedó pendiente ayer','2026-09-09','2026-09-09'],
 ['qué BOVE están pendientes del 1 al 10 de septiembre','2026-09-01',dia],
 ['qué BOVE están pendientes entre el 05-09-26 y el 10-09-26','2026-09-05',dia],
 ['qué BOVE quedaron pendientes esta semana','2026-09-07',dia],
 ['revisa BOVE pendientes desde el 8 hasta hoy','2026-09-08',dia]
])test('rango: '+texto,()=>{const q=B.interpretar(texto,dia);assert.equal(q.desde,desde);assert.equal(q.hasta_efectiva,hasta);});
for(const texto of ['qué BOVE están pendientes','qué BOVE están pendientes entre el 01-01-26 y el 10-09-26','qué BOVE están pendientes del 31 al 32 de septiembre','qué BOVE están pendientes del 10 al 1 de septiembre'])test('rango bloqueado sin lecturas: '+texto,async()=>{
 const c=db(),l=libro();const r=await B.consultar(texto,{cliente:c,libro:l,dia});assert.ok(r.q.error_rango);assert.equal(c.calls.length+l.calls.length,0);assert.match(B.renderizar(r),/rango/);
});
test('rango futuro se recorta en servidor y cliente; futuro completo no consulta',async()=>{
 const c=db([reserva({estadias:[estadia({fecha_ingreso:'2026-09-11'})]})],[{tipo_cargo:'alojamiento',monto:100}]);
 const r=await B.consultar('qué BOVE están pendientes del 10 al 20 de septiembre',{cliente:c,libro:libro(),dia});assert.equal(r.proyecto.length,0);assert.ok(c.calls.some(x=>x[0]==='lte'&&x[2]===dia));assert.match(r.avisos.join(' '),/futuras/);
 const otro=db();await B.consultar('qué BOVE están pendientes del 11 al 20 de septiembre',{cliente:otro,libro:libro(),dia});assert.equal(otro.calls.length,0);
});
for(const estado of ['confirmada','pendiente','cancelada','no_show'])test(estado+' no es BOVE atrasado por fecha',async()=>{
 const c=db([],[{tipo_cargo:'alojamiento',monto:100}]);for(const ingreso of [dia,'2026-09-09']){
  const p=await B.pendientes([reserva({estadias:[estadia({estado_estadia:estado,fecha_ingreso:ingreso})]})],c,dia,{desde:'2026-09-01',hasta_efectiva:dia});assert.equal(p.length,0);
 }assert.equal(c.calls.length,0);
});
for(const estado of ['hospedada','checked_out'])test(estado+' sin BOVE es pendiente',async()=>{
 const p=await B.pendientes([reserva({estadias:[estadia({estado_estadia:estado})]})],db([],[{tipo_cargo:'alojamiento',monto:100}]),dia);assert.equal(p.length,1);
});
test('timestamps acreditan ingreso, pero cancelada/no_show prevalecen',async()=>{
 for(const estado of ['confirmada','cancelada','no_show']){
  const p=await B.pendientes([reserva({estadias:[estadia({estado_estadia:estado,checkin_realizado_en:dia+'T12:00:00Z'})]})],db([],[{tipo_cargo:'alojamiento',monto:100}]),dia);assert.equal(p.length,estado==='confirmada'?1:0);
 }
});
test('alojamiento registrado y servicio cobrable pagado: sólo servicios pendiente',async()=>{
 const c=db([],[{tipo_cargo:'servicio',servicio_id:'s',monto:30,saldo_cargo:0}],[{id:'s',total:30}]);
 const p=await B.pendientes([reserva({bove_cierre:'16980'})],c,dia);assert.deepEqual(p.map(x=>x.tipos),[['servicios']]);
 assert.equal((await B.pendientes([reserva()],db(),dia)).length,0);
});
for(const [numero,texto] of [['16986','Libro contiene BOVE 16986; Proyecto H aún no lo tiene registrado.'],[null,'Pendiente en ambas fuentes.']])test(texto,async()=>{
 const r=await B.consultar('qué BOVE está pendiente hoy',{dia,cliente:db([reserva()],[{tipo_cargo:'alojamiento',monto:100}]),libro:libro([e(numero)],[rLibro()])});assert.ok(B.renderizar(r).includes(texto));
});
test('evidencia contextual ambigua se presenta como posible, sin asignarla',async()=>{
 const r=await B.consultar('qué BOVE está pendiente hoy',{dia,cliente:db([reserva()],[{tipo_cargo:'alojamiento',monto:100}]),libro:libro([e('16986')],[])});const h=B.renderizar(r);assert.match(h,/Posible contexto del Libro/);assert.ok(!h.includes('Libro contiene BOVE 16986; Proyecto H'));
});
test('rango de dos meses sólo consulta ambas hojas necesarias',async()=>{
 const l=libro();await B.consultar('qué BOVE están pendientes entre el 30-08-26 y el 02-09-26',{libro:l,cliente:db(),dia});assert.deepEqual(l.calls,[['hoja','Ago26'],['hoja','Sep26']]);
});
test('lecturas sin escritores no mutan reservas ni evidencias',async()=>{
 const rs=[reserva()],es=[e('16968')],snapshot=structuredClone({rs,es});await B.consultar('qué BOVE está pendiente hoy',{dia,cliente:db(rs,[{tipo_cargo:'alojamiento',monto:100}]),libro:libro(es)});assert.deepEqual({rs,es},snapshot);
});
