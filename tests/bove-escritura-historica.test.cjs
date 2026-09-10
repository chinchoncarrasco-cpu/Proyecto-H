const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../js/supabase-asistente-bove-escritura-v1.js');
const lectura=require('../js/supabase-asistente-bove-consultas-v1.js');
const dia='2026-09-10';
const frase='Haku, a CAB 5 Macarena Hurtado 03 septiembre ponle BOVE 19800';
function reserva(id='r1',titular='Macarena Hurtado'){
 return {id,titular_nombre:titular,estado_reserva:'checked_out',bove_cierre:null,bove_checkout:null,estadias:[{id:'e'+id,fecha_ingreso:'2026-09-03',fecha_salida:'2026-09-04',tipo_estadia:'alojamiento',estado_estadia:'checked_out',cabanas:{numero:5}}]};
}
function entorno(rs=[reserva()]){
 const llamadas=[],tablas={reservas:rs,vista_estado_cargos:[],vista_saldos_alojamiento_reserva:rs.map(r=>({reserva_id:r.id,saldo_alojamiento:0,total_alojamiento:153000}))};
 const cliente={rpc(){throw Error('Escritura prohibida');},from(tabla){const filtros=[],call={tabla,filtros};llamadas.push(call);const q={select(){return q;},order(){return q;},eq(k,v){filtros.push(['eq',k,v]);return q;},lte(k,v){filtros.push(['lte',k,v]);return q;},gte(k,v){filtros.push(['gte',k,v]);return q;},async range(a,b){return {data:JSON.parse(JSON.stringify(tablas[tabla].filter(r=>filtros.every(([op,k,v])=>op!=='eq'||r[k]===v)).slice(a,b+1)))};}};return q;}};
 const opciones={dia,cliente,libro:null,lectura,permiso:()=>true};
 return {tablas,llamadas,opciones,preparar:(t=frase,o={})=>api.preparar(t,{...opciones,...o})};
}
for(const texto of [
 'Haku, a CAB 5 ponle BOVE 19800 del 3 de septiembre',
 'Haku, a CAB 5 del 03-09-2026 ponle BOVE 19800',frase,
 'Haku, a Macarena Hurtado del 3 de septiembre ponle BOVE 19800',
 'Haku, registra BOVE 19800 de alojamiento para CAB 5 del 03/09/26'
])test('frase histórica completa: '+texto,async()=>{
 const q=api.interpretar(texto,dia);assert.equal(q.fecha,'2026-09-03');assert.equal(q.numero,'19800');
 const e=entorno(),p=await e.preparar(texto);assert.equal(p.estado,'propuesta');assert.equal(p.reserva.id,'r1');assert.equal(p.q.tipo,'alojamiento');assert.equal(p.dia,'2026-09-03');
 assert.deepEqual(e.llamadas[0].filtros,[['lte','estadias.fecha_ingreso','2026-09-03'],['gte','estadias.fecha_salida','2026-09-03']]);
 assert.match(api.renderizar(p),/Confirmar BOVE · bloqueado/);assert.equal((await api.confirmar(p)).estado,'bloqueada');
});
test('titular y CAB se aplican conjuntamente, sin parecido débil',async()=>{
 const e=entorno([reserva('r1','Otra Persona'),reserva('r2')]);assert.equal((await e.preparar()).reserva.id,'r2');
 assert.equal((await e.preparar(frase.replace('Macarena Hurtado','Macarena Hurtados'))).estado,'bloqueada');
 assert.equal((await e.preparar(frase.replace('CAB 5','CAB 10'))).estado,'bloqueada');
});
test('fecha sola no identifica una reserva',async()=>{assert.equal((await entorno().preparar('ponle BOVE 19800 del 3 de septiembre')).estado,'bloqueada');});
test('cero candidatas detiene sin buscar días cercanos',async()=>{assert.equal((await entorno().preparar(frase.replace('03 septiembre','02 septiembre'))).estado,'bloqueada');});
test('dos candidatas históricas muestran opciones sin elegir',async()=>{const p=await entorno([reserva('r1'),reserva('r2')]).preparar();assert.equal(p.estado,'elegir_reserva');assert.equal(p.candidatas.length,2);});
test('alojamiento incluye ingreso, excluye checkout',async()=>{const e=entorno();assert.equal((await e.preparar()).estado,'propuesta');assert.equal((await e.preparar(frase.replace('03 septiembre','04 septiembre'))).estado,'bloqueada');});
test('Full Day sólo pertenece a su fecha real',async()=>{const r=reserva();Object.assign(r.estadias[0],{tipo_estadia:'full_day',fecha_salida:'2026-09-03'});const e=entorno([r]);assert.equal((await e.preparar()).estado,'propuesta');assert.equal((await e.preparar(frase.replace('03 septiembre','04 septiembre'))).estado,'bloqueada');r.estadias[0].fecha_salida='2026-09-04';assert.equal((await e.preparar()).estado,'bloqueada');});
test('sin fecha sólo consulta hoy; histórica queda fuera',async()=>{const e=entorno();assert.equal((await e.preparar('a CAB 5 ponle BOVE 19800')).estado,'bloqueada');assert.equal(e.llamadas[0].filtros[0][2],dia);Object.assign(e.tablas.reservas[0].estadias[0],{fecha_ingreso:dia,fecha_salida:'2026-09-11'});assert.equal((await e.preparar('a CAB 5 ponle BOVE 19800')).estado,'propuesta');});
test('sin fecha conserva contexto de salida de hoy',async()=>{const r=reserva();r.estadias[0].fecha_salida=dia;assert.equal((await entorno([r]).preparar('a CAB 5 ponle BOVE 19800')).estado,'propuesta');});
for(const f of ['31 septiembre','29 febrero 2026','03/13/26','03-09-26 y 04-09-26'])test('rechaza fecha inválida o múltiple '+f,()=>assert.ok(api.interpretar(`a CAB 5 del ${f} ponle BOVE 19800`,dia).error));
test('año omitido usa referencia Santiago y se declara; año explícito se respeta',async()=>{
 const p=await entorno().preparar();assert.match(p.mensaje,/Año no indicado/);assert.equal(api.interpretar(frase,'2027-01-01').fecha,'2027-09-03');assert.equal(api.interpretar(frase.replace('03 septiembre','03 septiembre de 2024'),dia).fecha,'2024-09-03');
});
test('BOVE y CAB no se convierten en fecha, incluso con separadores de miles',()=>{for(const n of ['19800','19.800','19,800']){const q=api.interpretar(frase.replace('19800',n),dia);assert.equal(q.numero,'19800');assert.equal(q.cabana,5);assert.equal(q.fecha,'2026-09-03');}assert.ok(api.interpretar('a CAB 5 ponle BOVE 03-09-2026',dia).error);});
test('revalidación conserva fecha histórica e identidad; detecta cambio posterior',async()=>{const e=entorno(),p=await e.preparar();assert.equal((await api.revalidar(p)).estado,'revalidada');e.tablas.reservas[0].bove_cierre='otro';assert.equal((await api.revalidar(p)).estado,'bloqueada');});
test('selección por ID sigue exigiendo la misma fecha/CAB/titular',async()=>{const e=entorno([reserva('r1'),reserva('r2','Otra Persona')]);assert.equal((await e.preparar(frase,{reservaId:'r2'})).estado,'bloqueada');const q={numero:'19800',tipo:'alojamiento',fecha:'2026-09-03'};assert.equal((await e.preparar(q,{reservaId:'r1'})).reserva.id,'r1');assert.equal((await e.preparar({...q,fecha:'2026-09-04'},{reservaId:'r1'})).estado,'bloqueada');});
test('flujo histórico contrasta Libro y no modifica reservas/pagos',async()=>{
 const e=entorno(),antes=JSON.stringify(e.tablas),visitas=[];
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Ago22','Sep26'],buscarHojasBove:async()=>({hojas:['Sep26']}),consultarHoja:async n=>{visitas.push(n);return {reservas:[],evidencias_bove:[]};}};
 const p=await e.preparar(frase,{libro});assert.equal(p.estado,'propuesta');assert.match(p.libro.mensaje,/No encontré/);assert.ok(visitas.every(n=>n==='Sep26'));assert.equal(JSON.stringify(e.tablas),antes);
});

test('propuesta Macarena filtra Sep26 y compacta segmentos sin cambiar reserva',async()=>{
 const r=reserva();r.estadias.push({id:'full',fecha_ingreso:'2026-09-04',fecha_salida:'2026-09-04',tipo_estadia:'full_day',estado_estadia:'checked_out',cabanas:{numero:10}});
 const ev=(celda,numero,cabana_contexto,fecha_bloque)=>({numero,estado:numero?'registrado':'pendiente',cabana_contexto,fecha_bloque,origen:{hoja:'Sep26',celda}});
 const todas=[ev('L27',null,5,'2026-09-03'),ev('L100','16965',8,'2026-09-03'),ev('L101','16967',5,'2026-09-20'),ev('L102',null,10,'2026-09-04'),ev('L103',null,3,'2026-09-03')];
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Sep26'],buscarHojasBove:async()=>({hojas:[]}),consultarHoja:async()=>({reservas:[{titular:"Macarena Hurtado",cabana:5,fecha_checkin:"2026-09-03",fecha_checkout:"2026-09-04",tipo_estadia:"alojamiento"}],evidencias_bove:todas})};
 const e=entorno([r]),antes=JSON.stringify(r),p=await e.preparar(frase,{libro});
 assert.equal(p.estado,'propuesta');assert.equal(p.reserva.id,r.id);assert.equal(p.reserva.estadias.length,2);assert.equal(JSON.stringify(r),antes);
 assert.deepEqual(p.libro.evidencias.map(e=>e.origen.celda),['L27']);
 const html=api.renderizar(p);assert.match(html,/L27/);assert.match(html,/PEND BOVE/);assert.match(html,/BOVE 19800 no encontrado/);
 assert.doesNotMatch(html,/16965|16967|L100|L101|L102|L103|CAB 10/);assert.match(html,/Reserva con otro segmento asociado/);
 assert.match(html,/Confirmar BOVE · bloqueado/);
});

test('número solicitado sin vínculo seguro se muestra; resto mensual no',async()=>{
 const evidencias_bove=[{numero:'19800',estado:'registrado',origen:{hoja:'Sep26',celda:'L8'}},{numero:'16977',estado:'registrado',origen:{hoja:'Sep26',celda:'L9'}}];
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Sep26'],buscarHojasBove:async()=>({hojas:['Sep26']}),consultarHoja:async()=>({reservas:[],evidencias_bove})};
 const p=await entorno().preparar(frase,{libro});assert.equal(p.estado,'propuesta');assert.deepEqual(p.libro.evidencias.map(e=>e.numero),['19800']);assert.match(p.libro.mensaje,/contexto no concluyente/);assert.doesNotMatch(api.renderizar(p),/16977|L9/);
});

test('hoja con sólo evidencias ajenas no expone detalle ni PEND contextual',async()=>{
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Sep26'],buscarHojasBove:async()=>({hojas:[]}),consultarHoja:async()=>({reservas:[],evidencias_bove:[{numero:null,estado:'pendiente',cabana_contexto:8,fecha_bloque:'2026-09-03',origen:{hoja:'Sep26',celda:'L50'}}]})};
 const p=await entorno().preparar(frase,{libro});assert.deepEqual(p.libro.evidencias,[]);assert.match(p.libro.mensaje,/sin evidencia asociable de forma segura/);assert.doesNotMatch(api.renderizar(p),/L50|aún figura PEND/);
});

for(const relacionado of [false,true])test(`muchos PEND con titular ajeno no son asociación; relacionado=${relacionado}`,async()=>{
 const evidencias_bove=Array.from({length:15},(_,i)=>({numero:null,estado:'pendiente',origen:{hoja:'Sep26',celda:`AZ${26+i}`}}));
 const reservas=evidencias_bove.map((e,i)=>({titular:`Otra Persona ${i}`,cabana:8,fecha_checkin:'2026-09-03',fecha_checkout:'2026-09-04',coordenadas_origen:e.origen}));
 // Caso que originaba la fuga: estado pendiente, pero SIN proyecto asociado.
 const ajena=lectura.desdeLibro({reservas,evidencias_bove})[0];
 assert.ok(lectura.comparar([ajena],[{titular:'Macarena Hurtado',numero:'19800',tipos:['alojamiento'],segmentos:[]}]).some(c=>c.estado==='pendiente'&&!c.proyecto));
 if(relacionado){
  evidencias_bove.push({numero:null,estado:'pendiente',fecha_bloque:'2026-09-03',cabana_contexto:5,origen:{hoja:'Sep26',celda:'L27'}});
  reservas.push({titular:'Macarena Hurtado',cabana:5,fecha_checkin:'2026-09-03',fecha_checkout:'2026-09-04',tipo_estadia:'alojamiento'});
 }
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Sep26'],buscarHojasBove:async()=>({hojas:[]}),consultarHoja:async()=>({reservas,evidencias_bove})};
 const p=await entorno().preparar(frase,{libro}),html=api.renderizar(p);
 assert.equal(p.estado,'propuesta');assert.doesNotMatch(html,/Sep26!AZ\d+/);assert.match(html,/19800 no encontrado/);assert.match(html,/Confirmar BOVE · bloqueado/);
 assert.equal(p.libro.evidencias.length,relacionado?1:0);
 if(relacionado){assert.match(html,/El Libro aún figura PEND BOVE/);assert.match(html,/Sep26!L27/);}
 else{assert.match(html,/El Libro contiene pendientes, pero ninguno puede asociarse de forma segura a esta reserva/);assert.doesNotMatch(html,/El Libro aún figura PEND BOVE/);}
});

test('CAB y fecha sin resolución inequívoca no acreditan un PEND individual',async()=>{
 const libro={listo:async()=>{},estado:()=>({cargado:true,generacion:1}),listarHojas:()=>['Sep26'],buscarHojasBove:async()=>({hojas:[]}),consultarHoja:async()=>({reservas:[],evidencias_bove:[{numero:null,estado:'pendiente',cabana_contexto:5,fecha_bloque:'2026-09-03',origen:{hoja:'Sep26',celda:'BP26'}}]})};
 const p=await entorno().preparar(frase,{libro});assert.deepEqual(p.libro.evidencias,[]);assert.match(p.libro.mensaje,/ninguno puede asociarse de forma segura/);assert.doesNotMatch(api.renderizar(p),/BP26/);
});
