const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../js/haiku-libro-semantica-v1.js');
const C=require('../js/haiku-libro-pagos-canon-v1.js');
const L=require('../js/haiku-libro-lenguaje-natural-v1.js').crearSemantica(S,C);
const Q=require('../js/haiku-libro-consultas-v1.js');
const T=require('../js/haiku-fullday-tarifa-v1.js');

function hoja(texto,extra={}){
 return {celdas:[
  {r:1,c:2,valor:'24 oct',fechaISO:'2026-10-24'},
  {r:1,c:6,valor:'25 oct',fechaISO:'2026-10-25'},
  {r:1,c:10,valor:'26 oct',fechaISO:'2026-10-26'},
  {r:2,c:0,valor:'cabaña 7'},{r:2,c:2,valor:`Persona Ejemplo // ${texto}`,estiloId:0},
  {r:24,c:2,valor:'Pagos de arriendos de hoy'}
 ],combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}}],
 estilos:[{fill:{fgColor:{rgb:'FFB4A7D6'}}}],...extra};
}
const leer=texto=>S.normalizarHoja(hoja(texto),'Oct26').reservas[0];
const cliente=()=>({auth:{getSession:async()=>({data:{session:{user:{id:'prueba'}}}})},from(){
 const q={select(){return q},in(){return q},lte(){return q},gte(){return q},order(){return q},range:async()=>({data:[]})};return q;
}});
for(const [texto,adultos,ninos] of [
 ['3 personas',3,null],['2 personas',2,null],['1 persona',1,null],[' 3 PERSONAS ',3,null],['3personas',3,null],
 ['3 personas // 3 PERSONAS',3,null],['2 personas + 1 niño',2,1],['2 personas // 1 niño',2,1],
 ['3 personas // 2 ADL + 1 niño',2,1],['2 adultos // 3 personas',2,null],
 ['2 personas + 1 mascota',2,null]
])test(`ocupación del Libro: ${texto}`,()=>{
 const r=leer(texto);assert.equal(r.adultos,adultos);assert.equal(r.ninos,ninos);
 assert.ok(r.texto_original.includes(texto));
});
for(const texto of [
 '0 personas','-2 personas','2.5 personas','2,5 personas','32768 personas','2 personas // 3 personas',
 '2 o 3 personas','3 personas por confirmar','máximo 3 personas','capacidad 3 personas',
 '3 personas adicionales','tinaja para 3 personas','masaje para 2 personas',
 'JACUZZI // 3 personas','TINAJA TONEL // 1 hora // 3 personas','3 personas incluidos 1 niño',
 '3 personas // incluye 1 niño','3 personas // adultos por confirmar','2 PAX','3 huéspedes',
 'tel: +56 9 1234 5678 // 2 noches'
])test(`no convierte una cantidad ambigua o de servicio en adultos: ${texto}`,async()=>{
 const r=leer(texto);assert.equal(r.adultos,null);
 const comp=await Q.compararSistema([r],cliente(),{desde:'2026-10-24',hasta:'2026-10-26'});
 assert.equal(Q.serializarIncorporacion(Q.crearPlanIncorporacion([r],comp)).length,0);
});
test('personas de la reserva y capacidad del servicio permanecen separadas',()=>{
 const r=leer('3 personas // Jacuzzi para 2 personas');assert.equal(r.adultos,3);
 const explicita=leer('2 ADL // Jacuzzi para 5 personas');assert.equal(explicita.adultos,2);
});
test('las dos reservas de una y dos noches llegan incorporables desde el lector y sus wrappers, sin escrituras',async()=>{
 const h=hoja('3 personas // 1 noche // GO // 23-10-2026 // tinaja cortesía');
 h.celdas.push({r:3,c:0,valor:'cabaña 10'},{r:3,c:2,valor:'Otra Persona // 2 personas // 2 noches // GO // 23-10-2026',estiloId:1});
 h.combinaciones.push({s:{r:3,c:2},e:{r:3,c:8}});
 h.estilos.push({fill:{fgColor:{rgb:'FFD5A6BD'}}});
 const raw=S.normalizarHoja(h,'Oct26'),r=L.corregirResultado(C.corregirResultado(raw));
 const db=cliente(),llamadas=[];db.rpc=async nombre=>{llamadas.push(nombre);throw Error('No debe escribir');};
 const plan=await Q.prepararIncorporacion({reservas:r.reservas,q:{desde:'2026-10-24',hasta:'2026-10-26'}},new Map(),new Set(),db);
 const items=Q.serializarIncorporacion(plan);
 assert.equal(items.length,2);assert.ok(items.every(x=>x.tipo==='reserva_nueva'));
 const estadias=items.flatMap(x=>x.estadias).sort((a,b)=>a.cabana_numero-b.cabana_numero);
 assert.deepEqual(estadias.map(x=>[x.cabana_numero,x.datos.adultos,x.datos.fecha_ingreso,x.datos.fecha_salida,x.datos.estado_estadia]),[
  [7,3,'2026-10-24','2026-10-25','confirmada'],[10,2,'2026-10-24','2026-10-26','pendiente']]);
 assert.equal(llamadas.length,0);
});
for(const [texto,tarifa] of [['2 personas',120000],['3 personas',180000],['2 personas + 1 niño',120000],['1 persona',null]])
test(`Full Day aplica la misma lectura sin cambiar mínimo ni tarifa: ${texto}`,async()=>{
 const r=leer(`FULLDAY // ${texto}`),resultado=T.resolverLibro(r);
 assert.equal(resultado.tarifa,tarifa);assert.equal(resultado.bloqueada,tarifa===null);
 const comp=await Q.compararSistema([r],cliente(),{desde:'2026-10-24',hasta:'2026-10-26'});
 const items=Q.serializarIncorporacion(Q.crearPlanIncorporacion([r],comp));
 assert.equal(items.length,tarifa===null?0:1);
 if(tarifa!==null)assert.equal(items[0].estadias[0].tarifas['2026-10-24'],tarifa);
});
