const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../js/haiku-libro-semantica-v1.js'),F=require('./fixtures/libro-comparacion-readonly.cjs');
const {titular,hoja,notas}=require('./fixtures/libro-titulares-sinteticos.cjs');
const leer=t=>S.normalizarHoja(hoja(t),'Oct26');
const nombres=t=>S.analizarTitular(t,true).candidatos.map(c=>c.texto);
for(const nota of notas)for(const orden of ['antes','despues'])test(`nota administrativa: ${nota} (${orden})`,()=>{
 const partes=[titular,'aurora@example.invalid','2 ADL','2 NOCHES'];
 partes.splice(orden==='antes'?0:partes.length,0,nota);
 const texto=partes.join(' // '),d=leer(texto);
 assert.deepEqual(d.reservas.map(r=>r.titular),[titular]);
 assert.equal(d.reservas[0].texto_original,texto);assert.equal(d.reservas[0].analisis_titular.criterio,'nombre_en_bloque');
 assert.deepEqual(nombres(nota),[]);
});
for(const nombre of ['Maëlle O’Ficticio-Lenoir','Jean‑Luc de Prueba','宋 虚构','Olga Fictícia de la Sierra','Del Bosque de Prueba, Aurora María'])test(`nombre compuesto o extranjero: ${nombre}`,()=>{
 assert.deepEqual(nombres(`${nombre} // BOOKING // 2 ADL`),[nombre]);
});
test('nombre contiguo a una nota explícita, sin convertir la nota en parte de la identidad',()=>{
 for(const nombre of [`${titular} (tarifa autorizada por recepción)`,`${titular} — reserva reagendada`,`${titular} — llega tarde`])
  assert.deepEqual(nombres(`${nombre} // 2 ADL`),[titular]);
 for(const nota of ['TARIFA AUTORIZADA — debe presentar PDI','COBRO HECHO SIN IVA, RECORDAR SOLICITAR PDI'])assert.deepEqual(nombres(nota),[]);
});
test('etiqueta explícita posterior conserva prioridad y elimina sólo una variante dentro del mismo bloque',()=>{
 const d=S.analizarTitular('Aurora Ficción // Titular： aurora ficción // Aurora Ficcionn // 2 ADL');
 assert.equal(d.estado,'identificado');assert.equal(d.criterio,'etiqueta_explicita');
 assert.deepEqual(d.candidatos.map(c=>c.texto),['aurora ficción']);assert.equal(d.duplicados_descartados,2);
 assert.equal(S.mismaPersona('Aurora Ficción','Aurora Ficcionn'),false);
});
test('la errata o abreviación sin etiqueta permanece pendiente y se explica',()=>{
 for(const otro of ['Aurora Ficcionn','Aurora']){
  const d=S.analizarTitular(`Aurora Ficción // Titular: ${otro} // Bastián Inventado`);
  assert.equal(d.estado,'ambiguo');assert.equal(d.candidatos.length,2);
 }
 const d=leer('Aurora Ficción // Aurora Ficcionn // 2 ADL');assert.equal(d.reservas.length,0);
 assert.match(d.anotaciones[0].analisis_titular.motivos.join(' '),/parecido.*no confirma/);
});
test('dos personas y dos etiquetas contradictorias no se resuelven por orden ni frecuencia',()=>{
 for(const texto of ['Aurora Ficción // Bastián Inventado','Bastián Inventado // Aurora Ficción','Titular: Aurora Ficción // Titular: Bastián Inventado']){
  const d=S.analizarTitular(texto);assert.equal(d.estado,'ambiguo');assert.equal(d.candidatos.length,2);assert.ok(d.motivos.length);
 }
 for(let i=0;i<20;i++)assert.equal(S.analizarTitular('Aurora Ficción // R. Inventado // 2 ADL').estado,'ambiguo');
 assert.match(S.analizarTitular('Titular: Aurora Ficción // Titular: Bastián Inventado').motivos[0],/contradictorias/);
});
test('roles explícitos separan pagador, acompañantes, agencia y personal, sin tomar sus documentos',()=>{
 for(const rol of ['Pagador','Acompañantes','Masajista','Camarero','Reserva realizada por','Contacto de la reserva']){
  const texto=`Titular: ${titular} // aurora@example.invalid // ${rol} // Bastián Inventado // 2 ADL`;
  assert.deepEqual(nombres(texto),[titular]);assert.equal(S.analizarTitular(texto).roles_descartados,2);
 }
});
test('facturación multilínea no se convierte en huésped ni aporta identidad al titular',()=>{
 const factura='Datos Facturación:\nNombre: Empresa Imaginaria\nR.U.T: 99999999-9\nGiro: Investigación\ny la ingeniería\nDirección: Calle Ficticia\nComuna Imaginaria, Ciudad de Prueba.';
 const r=leer(`${titular} // aurora@example.invalid // 2 ADL // ${factura}`).reservas[0];
 assert.equal(r.titular,titular);assert.equal(r.correo,'aurora@example.invalid');assert.equal(r.rut_documento,null);
 assert.ok(r.analisis_titular.roles_descartados>=6);
 assert.deepEqual(nombres(`${factura} // Titular: ${titular} // 2 ADL`),[titular]);
 assert.deepEqual(nombres(`${factura} // 2 ADL // ${titular}`),[titular]);
});
test('las mejoras del bloque no amplían la lectura de comprobantes ni cancelaciones',()=>{
 const nombre='Del Bosque de Prueba, Aurora María',raw=hoja(`${nombre} // 2 ADL // 2 NOCHES`);
 raw.celdas.push({r:8,c:0,valor:'Cancelaciones'},{r:9,c:2,valor:`Cancelada: ${nombre} // 2 noches`},
  {r:25,c:0,valor:'cabaña 1'},{r:26,c:2,valor:'3 oct',fechaISO:'2026-10-03'},
  {r:26,c:3,valor:nombre},{r:26,c:4,valor:'cab1/2noches'},{r:26,c:5,valor:'50000',valorNumero:50000});
 raw.combinaciones.push({s:{r:25,c:0},e:{r:29,c:0}});
 const d=S.normalizarHoja(raw,'Oct26');assert.equal(d.reservas[0].titular,nombre);
 assert.equal(d.cancelaciones.length,0);assert.equal(d.cancelaciones_por_identificar.length,1);assert.equal(d.cancelaciones_por_identificar[0].titular,null);
 assert.equal(d.pagos.length,1);assert.equal(d.pagos[0].titular,null);assert.equal(d.pagos[0].monto,50000);
});
test('repetir el titular en una celda no duplica la estadía; dos estadías conservan sus claves',()=>{
 const d=leer(`${titular} // Titular: ${titular} // 2 ADL`);assert.equal(d.reservas.length,1);
 assert.equal(d.reservas[0].analisis_titular.duplicados_descartados,1);
 const a=F.reserva({titular}),b=F.reserva({id:'otro-bloque',titular,fecha_checkin:'2026-10-13',fecha_checkout:'2026-10-15'});
 assert.equal(S.asociar(a,[{...b,id:'otra-estadia',rut_documento:'SYNTHETIC-1'}]).estado,'ambigua');
 assert.equal(S.asociar({...a,rut_documento:'SYNTHETIC-1'},[{...b,id:'otra-estadia',rut_documento:'SYNTHETIC-1'}]).estado,'ambigua');
 assert.equal(S.asociar({...a,fecha_checkin:null,fecha_checkout:null},[{...a,id:'sin-fechas',fecha_checkin:null,fecha_checkout:null}]).estado,'ambigua');
});
async function comparar(reservas,estadias){
 const data={hoja:'Oct26',reservas,pagos:[],cancelaciones:[],bloqueos:[],aseos:[],espacios:[],anotaciones:[],advertencias:[],cobertura:{geometria:true,pagos:true}};
 const w=F.web(data),cliente=F.cliente({reserva_estadias:estadias,pagos:[],cabanas:[],bloqueos_cabana:[]});
 const r=await w.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta,w.HAIKU_LIBRO_RESERVA_V1,cliente);
 assert.deepEqual(cliente.mutaciones,[]);return {r,w,cliente};
}
test('contactos compartidos con otro titular proponen revisión, nunca asociación automática',async()=>{
 for(const contacto of [{telefono:'+56900000001'},{correo:'familia@example.invalid'},{telefono:'+56900000001',correo:'familia@example.invalid'}]){
  const a=F.reserva({titular,...contacto}),e=F.estadia(a);Object.assign(e.reservas,{titular_nombre:'Bastián Inventado',telefono_contacto:contacto.telefono,correo_contacto:contacto.correo});
  const {r}=await comparar([a],[e]);assert.notEqual(r.comparacion[0].estado,'asociada');
 }
});
test('homónimos con documentos distintos y estadías repetidas no se cruzan',async()=>{
 const a=F.reserva({titular,rut_documento:'SYNTHETIC-A',tipo_documento:'pasaporte'});
 const b=F.reserva({titular,id:'otro-bloque',fecha_checkin:'2026-10-13',fecha_checkout:'2026-10-15'});
 const e=F.estadia(a,{reservas:{id:'otra-reserva',titular_nombre:titular,titular_numero_documento:'SYNTHETIC-B',titular_tipo_documento:'pasaporte',estado_reserva:'confirmada'}});
 assert.notEqual((await comparar([a],[e])).r.comparacion[0].estado,'asociada');
 assert.notEqual((await comparar([a],[F.estadia(b)])).r.comparacion[0].estado,'asociada');
});
test('multicabaña sin vínculo verificado requiere revisión; el grupo existente se conserva',async()=>{
 const a=F.reserva({titular}),b=F.reserva({titular,id:'otro-bloque',cabana:2,coordenadas_origen:F.origen('C4')});
 const {r,w,cliente}=await comparar([a,b],[]);assert.equal(r.comparacion.length,2);
 assert.equal(r.comparacion.grupos[0].estado,'ambigua');
 const plan=await w.HAIKU_LIBRO_CONSULTAS.prepararIncorporacion(r,new Map(),new Set(),cliente);
 assert.equal(plan.items.filter(i=>i.categoria==='nuevas'&&i.seleccionado).length,0);assert.deepEqual(cliente.mutaciones,[]);
 const vinculado=await comparar([a,b],[F.estadia(a),F.estadia(b,{id:'segunda-estadia'})]);
 assert.equal(vinculado.r.comparacion.grupos[0].estado,'asociada');assert.equal(vinculado.r.comparacion.grupos[0].items.length,2);
});
test('la ambigüedad y su motivo llegan al informe, sin exponer otros campos privados',async()=>{
 const data=leer('Titular: Aurora Ficción // Titular: Bastián Inventado // 2 ADL');
 const w=F.web(data),c=F.cliente({reserva_estadias:[],pagos:[],cabanas:[],bloqueos_cabana:[]});
 const r=await w.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta,w.HAIKU_LIBRO_RESERVA_V1,c);
 assert.match(w.HAIKU_LIBRO_CONSULTAS.respuesta(r),/etiquetas de titular contradictorias/);
 vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-comparacion-readonly-v1.js'),'utf8'),w);
 const dto=await w.HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo().compararMes({fuente:{libro:w.HAIKU_LIBRO_RESERVA_V1},cliente:c,ahora:F.ahora});
 assert.match(dto.contexto.reservasPorIdentificar[0].motivosIdentificacion.join(' '),/contradictorias/);assert.deepEqual(c.mutaciones,[]);
});
