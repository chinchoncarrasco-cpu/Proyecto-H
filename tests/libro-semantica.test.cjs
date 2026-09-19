const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_SEMANTICA = S;
const Q = require('../js/haiku-libro-consultas-v1.js');
const origen = {hoja:'Sep26',celda:'C3'};
const reserva = {id:'a',titular:'Ana Pérez',cabana:6,fecha_checkin:'2026-09-04',fecha_checkout:'2026-09-06',advertencias:[],pagos:[],pagos_sin_asociacion:[],coordenadas_origen:origen};
function hojaDosNoches(texto){return {celdas:[
 {r:1,c:2,valor:'21 sep',fechaISO:'2026-09-21'},{r:1,c:6,valor:'22 sep',fechaISO:'2026-09-22'},{r:1,c:10,valor:'23 sep',fechaISO:'2026-09-23'},
 {r:2,c:0,valor:'cabaña 6'},{r:2,c:2,valor:texto},{r:24,c:2,valor:'Pagos de arriendos de hoy'}
],combinaciones:[{s:{r:2,c:2},e:{r:2,c:8}}]};}
test('rich text separates operational state, red notes and yellow debt',()=>{
 const c={valor:'Ana / factura / jacuzzi',estiloId:0,runs:[{texto:'Ana',font:{color:{rgb:'FFFFFFFF'}}},{texto:'factura',font:{color:{rgb:'FFFF0000'}}},{texto:'factura',font:{color:{rgb:'FFFF0000'}}},{texto:'jacuzzi',font:{color:{rgb:'FFFFFF00'}}},{texto:'jacuzzi',font:{color:{rgb:'FFFFFF00'}}}]};
 const f=S.fuente(c,[{font:{color:{rgb:'FF000000'}},fill:{fgColor:{rgb:'FFB4A7D6'}}}]);
 assert.equal(f.estado,'hospedada');assert.deepEqual(f.notas,['factura']);assert.deepEqual(f.pendientes,['jacuzzi']);
 c.runs.push({texto:'other',font:{color:{rgb:'FF0000FF'}}});assert.equal(S.fuente(c,[]).estado,'no_determinado');
});
test('strict matching refuses duplicate identity and conflicting document',()=>{
 assert.equal(S.asociar(reserva,[{...reserva,id:'system'}]).estado,'asociada');
 assert.equal(S.asociar(reserva,[{...reserva,id:'1'},{...reserva,id:'2'}]).estado,'ambigua');
 assert.equal(S.asociar({...reserva,rut_documento:'123-4'},[{...reserva,rut_documento:'999-9'}]).estado,'ambigua');
 assert.equal(S.asociar({...reserva,advertencias:['night conflict']},[reserva]).estado,'ambigua');
});
test('payment concept nights do not contradict reservation geometry, while a reservation duration still can',()=>{
 const angelo=S.normalizarHoja(hojaDosNoches('Angelo Villegas // 2 ADL // cab6/1noche'),'Sep26').reservas[0];
 assert.equal(angelo.noches,2);assert.equal(angelo.noches_texto,null);
 assert.equal(angelo.fecha_checkin,'2026-09-21');assert.equal(angelo.fecha_checkout,'2026-09-23');
 assert.deepEqual(angelo.advertencias,[]);
 assert.equal(S.asociar(angelo,[{...angelo,id:'proyecto-h'}]).estado,'asociada');

 const conflicto=S.normalizarHoja(hojaDosNoches('Angelo Villegas // 2 ADL // 1 noche'),'Sep26').reservas[0];
 assert.equal(conflicto.noches,2);assert.equal(conflicto.noches_texto,1);
 assert.deepEqual(conflicto.advertencias,[]);assert.match(conflicto.notas_interpretacion.join(' '),/texto del Libro indica 1 noche.*geometría abarca 2 noches/i);
 assert.equal(S.asociar(conflicto,[{...conflicto,id:'proyecto-h'}]).estado,'asociada');
});
test('explicit numeric extension reconciles the structured base duration with calendar geometry',()=>{
 const texto='BOOKING // Angelo Villegas // 1 Noche // 2 ADL // FC // 06.06.26 // Consultó por booking como era el sistema de tinajas, se le indicó pero no hubo respuesta. // pidió extender 1 noche, de forma directa, se respeta la tarifa booking';
 const angelo=S.normalizarHoja(hojaDosNoches(texto),'Sep26').reservas[0];
 assert.equal(angelo.noches,2);assert.equal(angelo.noches_texto,1);
 assert.equal(angelo.noches_extension_texto,1);assert.equal(angelo.noches_extension_ambigua,false);assert.equal(angelo.noches_texto_efectivas,2);
 assert.deepEqual(angelo.advertencias,[]);assert.deepEqual(angelo.servicios,[]);
 assert.equal(S.asociar(angelo,[{...angelo,id:'proyecto-h'}]).estado,'asociada');

 for(const nota of ['extendió 1 noche','agregó 1 noche','solicitó agregar 1 noche']){
  const r=S.normalizarHoja(hojaDosNoches(`Persona Prueba // 1 noche // ${nota}`),'Sep26').reservas[0];
  assert.equal(r.noches_texto_efectivas,2,nota);assert.deepEqual(r.advertencias,[],nota);
 }
});
test('night extensions remain conservative when absent, incompatible, ambiguous or financial',()=>{
 for(const [texto,extension,ambigua] of [
  ['Angelo Villegas // 1 noche',null,false],
  ['Angelo Villegas // 1 noche // pidió extender 2 noches',2,false],
  ['Angelo Villegas // 1 noche // consultó por una noche adicional, sin confirmar',null,false],
  ['Angelo Villegas // 1 noche // pidió extender 1 noche // agregó 1 noche',null,true]
 ]){
  const r=S.normalizarHoja(hojaDosNoches(texto),'Sep26').reservas[0];
  assert.equal(r.noches_extension_texto,extension,texto);assert.equal(r.noches_extension_ambigua,ambigua,texto);
  assert.deepEqual(r.advertencias,[],texto);assert.ok(r.notas_interpretacion.length,texto);
 }
 const concepto=S.normalizarHoja(hojaDosNoches('Angelo Villegas // cab6/1noche'),'Sep26').reservas[0];
 assert.equal(concepto.noches_texto,null);assert.equal(concepto.noches_extension_texto,null);assert.deepEqual(concepto.advertencias,[]);
});
test('multiple explicit extensions remain informational when calendar geometry is safe',()=>{
 const r=S.normalizarHoja(hojaDosNoches('Angelo Villegas // 2 noches // pidió extender 1 noche // agregó 1 noche'),'Sep26').reservas[0];
 assert.equal(r.noches,2);assert.equal(r.noches_texto,2);assert.equal(r.noches_extension_texto,null);
 assert.equal(r.noches_extension_ambigua,true);assert.equal(r.noches_texto_efectivas,2);
 assert.deepEqual(r.advertencias,[]);assert.match(r.notas_interpretacion.join(' '),/más de una extensión/i);
 assert.equal(S.asociar(r,[{...r,id:'proyecto-h'}]).estado,'asociada');
});
test('Isabel associates by identity cabin and geometric dates despite stale written nights',()=>{
 const texto='Isabel Soto Manriques // 12.345.678-5 // isabel@example.test // +56 9 1234 5678 // 1 Noche // 2 ADL';
 const isabel=S.normalizarHoja(hojaDosNoches(texto),'Sep26').reservas[0];
 assert.equal(isabel.fecha_checkin,'2026-09-21');assert.equal(isabel.fecha_checkout,'2026-09-23');assert.equal(isabel.noches,2);assert.equal(isabel.noches_texto,1);
 assert.equal(isabel.geometria_inequivoca,true);assert.deepEqual(isabel.advertencias,[]);assert.equal(isabel.notas_interpretacion.length,1);
 const sistema={...isabel,id:'proyecto-h',notas_interpretacion:[]};
 assert.equal(S.asociar(isabel,[sistema]).estado,'asociada');
});
test('single, double and repeated slash variants all separate reservation fields',()=>{
 assert.deepEqual(S.separarCampos('// Nombre Ejemplo/RUT 12.345.678-5///2 ADL/1 MASCOTA/1 NOCHE//IN'),
  ['Nombre Ejemplo','RUT 12.345.678-5','2 ADL','1 MASCOTA','1 NOCHE','IN']);
 assert.deepEqual(S.separarCampos('Nombre Ejemplo/03/09/26/2 ADL'),['Nombre Ejemplo','03/09/26','2 ADL']);
 const texto='Andrés Ejemplo/12.345.678-5/andres@example.test//+56 9 1234 5678//2adl/1mascota/1noche/CA/17-09-26//Tonel de madera de cortesía 20.45 a 21.45';
 const hoja=hojaDosNoches(texto);hoja.combinaciones[0].e.c=4;
 const resultado=S.normalizarHoja(hoja,'Sep26');
 assert.equal(resultado.anotaciones.length,0);
 assert.equal(resultado.reservas.length,1);
 const reserva=resultado.reservas[0];
 assert.equal(reserva.titular,'Andrés Ejemplo');
 assert.equal(reserva.rut_documento,'12.345.678-5');
 assert.equal(reserva.correo,'andres@example.test');
 assert.equal(reserva.telefono,'+56 9 1234 5678');
 assert.equal(reserva.adultos,2);assert.equal(reserva.mascotas,1);assert.equal(reserva.noches_texto,1);
 assert.equal(reserva.operador,'CA');assert.equal(reserva.fecha_ingreso_libro,'2026-09-17');
 assert.equal(reserva.fecha_checkin,'2026-09-21');assert.equal(reserva.fecha_checkout,'2026-09-22');
 assert.equal(reserva.servicios[0].concepto,'tonel');
});
test('explicit date and nights recover only an imperfect but corroborated merge',async()=>{
 const texto=(fecha,noches)=>`Catalina Ejemplo // 12.345.678-5 // catalina@example.test // +56 9 1234 5678 // 3 ADL / ${noches} NOCHE${noches===1?'':'S'} // ${fecha} // JF // CAMA ADICIONAL // VIENE CON MASCOTA // COORDINAR TINAJA DE CORTESÍA`;
 const leer=(valor,fin)=>{const h=hojaDosNoches(valor);h.combinaciones[0].e.c=fin;return S.normalizarHoja(h,'Sep26').reservas[0];};

 const correcta=leer(texto('21.09.2026',1),4);
 assert.equal(correcta.geometria_inequivoca,true);assert.equal(correcta.geometria_resuelta_texto,false);
 assert.equal(correcta.fecha_checkin,'2026-09-21');assert.equal(correcta.fecha_checkout,'2026-09-22');

 const unaNoche=leer(texto('21.09.2026',1),3);
 assert.equal(unaNoche.geometria_inequivoca,false);assert.equal(unaNoche.geometria_resuelta_texto,true);
 assert.equal(unaNoche.fecha_checkin,'2026-09-21');assert.equal(unaNoche.fecha_checkout,'2026-09-22');
 assert.deepEqual(unaNoche.fechas_ocupadas,['2026-09-21']);assert.deepEqual(unaNoche.advertencias,[]);
 assert.match(unaNoche.advertencias_informativas.join(' '),/geometría.*texto explícito/i);

 const dosNoches=leer(texto('21.09.2026',2),7);
 assert.equal(dosNoches.geometria_resuelta_texto,true);assert.equal(dosNoches.fecha_checkout,'2026-09-23');
 assert.deepEqual(dosNoches.fechas_ocupadas,['2026-09-21','2026-09-22']);

 const client={auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},from(){const q={select(){return q},order(){return q},range:async()=>({data:[]})};return q}};
 const comparacion=await Q.compararSistema([unaNoche],client,{desde:'2026-09-21',hasta:'2026-09-22'});
 assert.equal(comparacion[0].estado,'sin_coincidencia');assert.equal(comparacion.meta.faltantes,1);
});
test('contradictory or insufficient explicit evidence never overrides imperfect geometry',()=>{
 const leer=texto=>{const h=hojaDosNoches(texto);h.combinaciones[0].e.c=3;return S.normalizarHoja(h,'Sep26').reservas[0];};
 for(const [caso,texto] of [
  ['fecha distinta del ancla','Persona Ejemplo // 1 NOCHE // 22.09.2026'],
  ['dos fechas','Persona Ejemplo // 1 NOCHE // 21.09.2026 // 22.09.2026'],
  ['sin noches','Persona Ejemplo // 21.09.2026'],
  ['noches contradictorias','Persona Ejemplo // 1 NOCHE // 2 NOCHES // 21.09.2026'],
  ['fecha inválida','Persona Ejemplo // 1 NOCHE // 31.09.2026']
 ]){
  const reserva=leer(texto);assert.equal(reserva.geometria_resuelta_texto,false,caso);
  assert.ok(reserva.advertencias.some(x=>/geometría.*incompleta o ambigua/i.test(x)),caso);
  assert.equal(reserva.advertencias_informativas.length,0,caso);
 }
});
test('incomplete merge and nonconsecutive calendar remain blocking geometry warnings',()=>{
 const incompleta=hojaDosNoches('Persona Prueba // 2 noches');incompleta.combinaciones[0].e.c=7;
 const a=S.normalizarHoja(incompleta,'Sep26').reservas[0];
 assert.equal(a.geometria_inequivoca,false);assert.match(a.advertencias.join(' '),/geometría.*incompleta o ambigua/i);
 assert.equal(S.asociar(a,[{...a,id:'proyecto-h',advertencias:[]}]).estado,'ambigua');

 const hueco=hojaDosNoches('Persona Prueba // 2 noches');hueco.celdas.find(c=>c.c===6).fechaISO='2026-09-23';hueco.celdas.find(c=>c.c===6).valor='23 sep';hueco.celdas.find(c=>c.c===10).fechaISO='2026-09-24';hueco.celdas.find(c=>c.c===10).valor='24 sep';
 const b=S.normalizarHoja(hueco,'Sep26').reservas[0];
 assert.equal(b.geometria_inequivoca,false);assert.match(b.advertencias.join(' '),/geometría.*incompleta o ambigua/i);
});
test('informational or unconfirmed service questions do not become services',()=>{
 for(const nota of [
  'Consultó cómo era el sistema de tinajas.',
  'Se le explicó cómo funciona la tinaja, no confirmó.',
  'Preguntó por jacuzzi pero no reservó.',
  'Consultó valor de masaje, no hubo respuesta.',
  'Consultó por tinaja, pendiente respuesta.'
 ]){
  const r=S.normalizarHoja(hojaDosNoches(`Persona Prueba // 2 noches // ${nota}`),'Sep26').reservas[0];
  assert.ok(r,nota);assert.deepEqual(r.servicios,[],nota);
 }
});
test('structured and explicit service evidence remains operational for every existing concept',()=>{
 const casos=[
  ['Tinaja 20:00','tinaja'],['Tinaja x pagar','tinaja'],['Tinaja pendiente de pago','tinaja'],['Tinaja pendiente pagar','tinaja'],
  ['Reservó tinaja','tinaja'],['Pidió tinaja','tinaja'],['Agendar tinaja','tinaja'],
  ['Jacuzzi 21:00','jacuzzi'],['Masaje 18:00','masaje'],['Tonel 19:15','tonel'],['Cuna confirmada','cuna'],
  ['Cama adicional x pagar','cama_adicional'],['Late out 13:00','lateout'],['Consultó por tinaja y reservó para las 20:00','tinaja']
 ];
 for(const [nota,concepto] of casos){
  const r=S.normalizarHoja(hojaDosNoches(`Persona Prueba // 2 noches // ${nota}`),'Sep26').reservas[0];
  assert.ok(r,nota);assert.equal(r.servicios.length,1,nota);assert.equal(r.servicios[0].concepto,concepto,nota);
 }
 const pendiente=S.normalizarHoja(hojaDosNoches('Persona Prueba // 2 noches // Tinaja x pagar'),'Sep26').reservas[0].servicios[0];
 assert.equal(pendiente.pendiente,true);
 const repetido=S.normalizarHoja(hojaDosNoches('Persona Prueba // 2 noches // CAMA ADICIONAL; CAMA ADICIONAL'),'Sep26').reservas[0];
 assert.equal(repetido.servicios.length,1);
});
test('valid dates, range, month and unknown dates',()=>{
 const q=Q.interpretar('Libro CAB 6 del 11 al 13 de septiembre de 2026',['Sep26']);assert.equal(q.desde,'2026-09-11');assert.equal(q.hasta,'2026-09-13');assert.equal(q.cabana,6);
 assert.throws(()=>Q.interpretar('Libro el 31-09-26',['Sep26']),/válido/);
 assert.throws(()=>Q.interpretar('Libro el 11-10-26',['Sep26']),/No encuentro/);
 assert.throws(()=>Q.interpretar('Libro este fin de semana',['Sep26']),/Indica/);
 assert.equal(Q.interpretar('Libro del 11-09-26 al 13-09-26 agrega reservas al calendario',['Sep26']).escribir,true);
 assert.equal(Q.interpretar('Libro del 11-09-26 al 13-09-26 incluyendo el lunes',['Sep26']).hasta,'2026-09-14');
});
test('money parsing never invents amount',()=>{
 assert.equal(S.monto('$160,000'),160000);assert.equal(S.monto('$160.000'),160000);assert.equal(S.monto('??'),null);assert.equal(S.monto(''),null);
});
test('unknown geometry cannot assert missing reservations',()=>{
 const x=S.normalizarHoja({celdas:[{r:0,c:0,valor:'Ana Pérez'}]},'REEMBOLSOS');assert.equal(x.cobertura.geometria,false);assert.equal(x.reservas.length,0);assert.equal(x.anotaciones[0].origen.celda,'A1');
});
test('disappearance does not become confirmed cancellation',()=>{
 const diff=S.compararVersiones({cobertura:{geometria:true},reservas:[reserva]},{cobertura:{geometria:true},reservas:[]});assert.equal(diff[0].tipo,'ya_no_aparece');
});
test('comparison uses only authenticated SELECT methods; ambiguous payments not assigned',async()=>{
 const calls=[]; const db={reserva_estadias:[{id:'e1',reserva_id:'r1',cabanas:{numero:6},fecha_ingreso:'2026-09-04',fecha_salida:'2026-09-06',estado_estadia:'hospedada',reservas:{titular_nombre:'Ana Pérez'}}],pagos:[],servicios:[]};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},from(table){calls.push(table); const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range(){return Promise.resolve({data:db[table]})}};return b}};
 const [r]=await Q.compararSistema([{...reserva,servicios:[]}],client);assert.equal(r.estado,'asociada');assert.deepEqual(calls,['reserva_estadias','pagos','servicios']);
 await assert.rejects(Q.compararSistema([reserva],{auth:{getSession:async()=>({data:{session:null}})}}),/Inicia sesión/);
});
test('failed SELECT is not reported as absent reservations',async()=>{
 const client={auth:{getSession:async()=>({data:{session:{}}})},from(){const q={select(){return q},lte(){return q},gte(){return q},order(){return q},range:async()=>({error:{message:'denied'}})};return q}};
 await assert.rejects(Q.compararSistema([reserva],client),/No se concluye/);
});
