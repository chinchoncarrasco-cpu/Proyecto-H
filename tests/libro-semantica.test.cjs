const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_SEMANTICA = S;
const Q = require('../js/haiku-libro-consultas-v1.js');
const origen = {hoja:'Sep26',celda:'C3'};
const reserva = {id:'a',titular:'Ana Pérez',cabana:6,fecha_checkin:'2026-09-04',fecha_checkout:'2026-09-06',advertencias:[],pagos:[],pagos_sin_asociacion:[],coordenadas_origen:origen};
test('rich text separates operational state, red notes and yellow debt',()=>{
 const c={valor:'Ana / factura / jacuzzi',estiloId:0,runs:[{texto:'Ana',font:{color:{rgb:'FFFFFFFF'}}},{texto:'factura',font:{color:{rgb:'FFFF0000'}}},{texto:'jacuzzi',font:{color:{rgb:'FFFFFF00'}}}]};
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
 const diff=S.compararVersiones({cobertura:{geometria:true},reservas:[reserva]},{cobertura:{geometria:true},reservas:[]});assert.equal(diff[0].tipo,'ya_no_aparece_o_modificada');
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
