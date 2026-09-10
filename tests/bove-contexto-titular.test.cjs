const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../js/supabase-asistente-bove-consultas-v1.js');
const evidencia=()=>({numero:'16968',estado:'registrado',fecha_bloque:'2026-09-03',cabana_contexto:1,origen:{hoja:'Sep26',celda:'L27',fila:27,columna:12}});
const reserva=(extra={})=>({hoja:'Sep26',titular:'Persona Ejemplo',cabana:1,tipo_estadia:'alojamiento',fecha_checkin:'2026-09-02',fecha_checkout:'2026-09-05',fechas_ocupadas:['2026-09-02','2026-09-03','2026-09-04'],pagos:[],pagos_sin_asociacion:[],...extra});
const resolver=(reservas,e=evidencia())=>B.desdeLibro({evidencias_bove:[e],reservas})[0];
test('única candidata de misma hoja CAB y día: titular secundario, evidencia primaria intacta',()=>{
 const e=resolver([reserva()]);assert.equal(e.titular_resuelto,'Persona Ejemplo');assert.equal(e.resolucion,'contexto_unico');
 assert.deepEqual(e.origen,evidencia().origen);assert.equal(e.titular,undefined);assert.deepEqual(e.segmentos,[]);assert.deepEqual(e.tipos,['no_determinado']);
});
test('cero candidatas no inventa titular; no toma otra cabaña u hoja',()=>{
 for(const rs of [[],[reserva({cabana:2})],[reserva({hoja:'Oct26'})]]){
  const e=resolver(rs);assert.equal(e.titular_resuelto,undefined);assert.equal(e.resolucion,'sin_candidatas');
 }
});
test('dos candidatas no elige aunque tengan igual titular',()=>{
 const e=resolver([reserva(),reserva()]);assert.equal(e.titular_resuelto,undefined);assert.equal(e.resolucion,'contexto_ambiguo');assert.equal(e.candidatas_contexto,2);
});
test('Full Day y alojamiento simultáneos mantienen ambigüedad',()=>{
 const fd=reserva({tipo_estadia:'full_day',fecha_checkin:'2026-09-03',fecha_checkout:'2026-09-03',fechas_ocupadas:['2026-09-03']});
 assert.equal(resolver([reserva(),fd]).resolucion,'contexto_ambiguo');
 assert.equal(resolver([fd]).resolucion,'contexto_unico');
});
test('varias noches usa días ocupados; no añade el checkout',()=>{
 assert.equal(resolver([reserva()]).resolucion,'contexto_unico');
 assert.equal(resolver([reserva()],{...evidencia(),fecha_bloque:'2026-09-05'}).resolucion,'sin_candidatas');
 assert.equal(resolver([reserva()],{...evidencia(),fecha_bloque:'2026-09-01'}).resolucion,'sin_candidatas');
});
test('sin lista de ocupación sólo usa intervalo válido con checkout exclusivo',()=>{
 const r=reserva({fechas_ocupadas:undefined});assert.equal(resolver([r]).resolucion,'contexto_unico');
 assert.equal(resolver([r],{...evidencia(),fecha_bloque:'2026-09-05'}).resolucion,'sin_candidatas');
});
test('segmentos compatibles múltiples nunca se fusionan',()=>{
 const rs=[reserva(),reserva({fecha_checkin:'2026-09-03'})];assert.equal(resolver(rs).resolucion,'contexto_ambiguo');
});
test('cambiar coordenadas no cambia resolución ni crea identidad permanente',()=>{
 const r=reserva({id:'Sep26!A3',coordenadas_origen:{hoja:'Sep26',celda:'A3'}});
 const a=resolver([r]),b=resolver([{...r,id:'Sep26!Z9',coordenadas_origen:{hoja:'Sep26',celda:'Z9'}}],{...evidencia(),origen:{hoja:'Sep26',celda:'AX200',fila:200,columna:50}});
 assert.equal(a.titular_resuelto,b.titular_resuelto);assert.deepEqual(a.reserva_contexto,b.reserva_contexto);assert.equal(a.reserva_contexto.id,undefined);
});
test('candidata con advertencias no se declara inequívoca; faltan contexto o nombre',()=>{
 for(const r of [reserva({advertencias:['Fechas requieren revisión']}),reserva({titular:''})])assert.equal(resolver([r]).titular_resuelto,undefined);
 assert.equal(resolver([reserva()],{...evidencia(),fecha_bloque:null}).titular_resuelto,undefined);
});
test('enriquecimiento no muta reservas, pagos ni evidencias',()=>{
 const hoja={reservas:[reserva({pagos:[{monto:100}],pagos_sin_asociacion:[{monto:200}]})],evidencias_bove:[evidencia()]};const antes=structuredClone(hoja);
 B.desdeLibro(hoja);assert.deepEqual(hoja,antes);
});
test('contexto único no se convierte en coincidencia de reconciliación',()=>{
 const e=resolver([reserva()]),sinContexto=resolver([]);
 const proyecto=B.desdeProyecto([{id:'r1',titular_nombre:'Persona Ejemplo',bove_cierre:'16968',estadias:[{fecha_ingreso:'2026-09-02',fecha_salida:'2026-09-05',cabanas:{numero:1}}]}]);
 assert.deepEqual(B.comparar([e],proyecto).map(x=>x.estado),B.comparar([sinContexto],proyecto).map(x=>x.estado));
 assert.equal(B.comparar([e],proyecto)[0].estado,'no_determinado');
});
test('UI identifica resolución contextual y explica la ambigüedad sin exponer HTML',()=>{
 const html=e=>B.renderizar({q:{accion:'buscar',fuente:'libro',numero:'16968'},dia:'2026-09-03',libro:[e],proyecto:[],comparacion:[],avisos:[]});
 const seguro=html(resolver([reserva({titular:'Persona <Ejemplo>'})]));assert.match(seguro,/Persona &lt;Ejemplo&gt;/);assert.match(seguro,/Identificado por contexto único de estadía/);assert.match(seguro,/Sep26.*L27/);
 const ambiguo=html(resolver([reserva(),reserva()]));assert.match(ambiguo,/Titular no determinado/);assert.match(ambiguo,/Más de una estadía compatible/);
});
test('resuelve usando objetos ya leídos: sin cliente ni nueva lectura del Libro',()=>{
 // Se ejecuta sin cliente, DOM, RPC, loader ni worker; sólo objetos en memoria.
 assert.equal(resolver([reserva()]).resolucion,'contexto_unico');
});
