const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const A=require('../js/supabase-asistente-servicios-cortesia-v1.js');

const reserva={id:'r1',titular_nombre:'Luis Ortiz',estado_reserva:'checked_out',bove_checkout:null};
const estadia={id:'e1',reserva_id:'r1',cabana_id:'cab10',cabanas:{numero:10}};
const servicio=(extra={})=>({
 id:'s1',reserva_id:'r1',estadia_id:'e1',catalogo_servicio_id:'cs1',recurso_id:'rec1',
 fecha_servicio:'2026-09-12',hora_inicio:'20:45:00',hora_fin:'21:45:00',cantidad:1,personas:2,
 precio_unitario_aplicado:30000,monto_adicional:0,total:30000,tipo_cobro:'normal',motivo_cortesia:null,
 estado_servicio:'programado',actualizado_en:'2026-09-20T10:00:00.000Z',
 catalogo_servicios:{id:'cs1',codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera',activo:true,permite_cortesia:true},
 ...extra
});
const candidato=(extra={})=>{
 const s=servicio(extra);return {...s,reserva,estadia,catalogo:s.catalogo_servicios,cabana_numero:10};
};
const finanzas=(extra={})=>({
 cargos:[{id:'c1',reserva_id:'r1',estadia_id:'e1',servicio_id:'s1',tipo_cargo:'servicio',estadia_noche_id:null,monto:30000,estado:'activo',actualizado_en:'2026-09-20T10:00:01.000Z'}],
 estados:[{cargo_id:'c1',monto:30000,monto_ajustado:30000,aplicado_neto:0,saldo_cargo:30000,estado:'activo',estado_pago:'pendiente'}],
 aplicaciones:[],ajustes:[],...extra
});

test('interpreta NORMAL_A_CORTESIA, quita Haku y extrae evidencia sin inventar ausentes',()=>{
 const casos=[
  'Haku, pasa la tinaja tonel de Luis Ortiz, cab 10, del 12-09 a cortesía.',
  'Haku cambia a cortesía la tinaja tonel de Luis Ortiz del 12-09.',
  'Pasa a cortesía la tinaja de Luis Ortiz cab 10 del 12 de septiembre.',
  'Cambia el servicio tinaja tonel de Luis Ortiz a cortesía.'
 ];
 const q=casos.map(x=>A.interpretar(x,{diaActual:'2026-09-22'}));
 for(const x of q){assert.equal(x.intencion,'MODIFICAR_SERVICIO_EXISTENTE');assert.equal(x.accion,'NORMAL_A_CORTESIA');assert.equal(x.titular,'Luis Ortiz');}
 assert.deepEqual([q[0].cabana,q[0].codigo_servicio,q[0].fecha,q[0].hora],[10,'tinajaTonel','2026-09-12',null]);
 assert.deepEqual([q[1].cabana,q[1].fecha],[null,'2026-09-12']);
 assert.deepEqual(q[2].codigos_servicio,['tinajaTonel','tinajaJacuzzi']);
 assert.deepEqual([q[3].cabana,q[3].fecha,q[3].hora],[null,null,null]);
 const conHora=A.interpretar('Haku, pasa la tinaja tonel de Luis Ortiz cab 10 del 12-09 a las 20:45 a cortesía',{diaActual:'2026-09-22'});
 assert.equal(conHora.hora,'20:45');
 assert.equal(A.interpretar('Haku, no cambies la tinaja tonel de Luis Ortiz a cortesía'),null);
});

test('resuelve cero, uno o varios candidatos sólo con datos persistidos',()=>{
 const q=A.interpretar('Pasa a cortesía la tinaja tonel de Luis Ortiz cab 10 del 12-09',{diaActual:'2026-09-22'});
 const datos={reservas:[reserva,{...reserva,id:'r2',titular_nombre:'Luis Ortíz'}],estadias:[estadia],servicios:[servicio()]};
 assert.equal(A.resolverCandidatos(q,datos).length,1);
 assert.equal(A.resolverCandidatos({...q,cabana:7},datos).length,0);
 const segundo={...servicio(),id:'s2',hora_inicio:'21:45:00'};
 assert.equal(A.resolverCandidatos({...q,hora:null},{...datos,servicios:[servicio(),segundo]}).length,2);
 assert.equal(A.resolverCandidatos({...q,hora:'20:45'},{...datos,servicios:[servicio(),segundo]}).length,1);
});

test('buscarServicios consulta Proyecto H y filtra titular, estadía y cabaña persistidos',async()=>{
 const tablas={reservas:[reserva],servicios:[servicio()],reserva_estadias:[estadia]},consultadas=[];
 const cliente={from(nombre){
  consultadas.push(nombre);const filtros=[];
  const b={
   select(){return b;},ilike(c,p){filtros.push(x=>new RegExp('^'+p.split('%').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i').test(String(x[c]||'')));return b;},
   in(c,v){filtros.push(x=>v.includes(x[c]));return b;},eq(c,v){filtros.push(x=>x[c]===v);return b;},order(){return b;},
   async range(){return {data:(tablas[nombre]||[]).filter(x=>filtros.every(f=>f(x))),error:null};}
  };return b;
 }};
 const q=A.interpretar('Pasa a cortesía la tinaja tonel de Luis Ortiz cab 10 del 12-09',{diaActual:'2026-09-22'});
 const encontrados=await A.buscarServicios(q,{cliente});
 assert.equal(encontrados.length,1);assert.equal(encontrados[0].id,'s1');
 assert.deepEqual(consultadas,['reservas','servicios','reserva_estadias']);
});

test('preparar maneja cero, uno y múltiples sin elegir por posición',async()=>{
 const texto='Haku, pasa la tinaja tonel de Luis Ortiz cab 10 del 12-09 a cortesía';
 const base={diaActual:'2026-09-22',permiso:()=>true,cargarFinanzas:async()=>finanzas()};
 assert.equal((await A.preparar(texto,{...base,buscar:async()=>[]})).estado,'no_encontrado');
 const varios=await A.preparar(texto,{...base,buscar:async()=>[candidato(),candidato({id:'s2',fecha_servicio:'2026-09-13'})]});
 assert.equal(varios.estado,'multiples');assert.equal(varios.candidatos.length,2);assert.match(A.renderizar(varios),/No elegí ninguno automáticamente/);
 const unica=await A.preparar(texto,{...base,buscar:async()=>[candidato()]});assert.equal(unica.estado,'propuesta');
});

test('elegibilidad bloquea aplicaciones, ajustes y catálogo sin cortesía',()=>{
 assert.equal(A.evaluarElegibilidad(candidato(),finanzas()).estado,'elegible');
 const app=A.evaluarElegibilidad(candidato(),finanzas({aplicaciones:[{id:'a1',cargo_id:'c1'}]}));
 assert.equal(app.elegible,false);assert.match(app.razones.join(' '),/aplicaciones/i);
 const ajuste=A.evaluarElegibilidad(candidato(),finanzas({ajustes:[{id:'j1',cargo_id:'c1'}]}));
 assert.equal(ajuste.elegible,false);assert.match(ajuste.razones.join(' '),/ajustes/i);
 const sinPermiso=candidato({catalogo_servicios:{...servicio().catalogo_servicios,permite_cortesia:false}});sinPermiso.catalogo=sinPermiso.catalogo_servicios;
 assert.match(A.evaluarElegibilidad(sinPermiso,finanzas()).razones.join(' '),/no permite cortesía/i);
});

test('servicio ya cortesía coherente informa sin cambios y no ofrece confirmación',async()=>{
 const cortesia=candidato({tipo_cobro:'cortesia',total:0,motivo_cortesia:'Promo HAIKU'});
 const historico=finanzas({cargos:[{...finanzas().cargos[0],estado:'anulado'}],estados:[{...finanzas().estados[0],estado:'anulado',saldo_cargo:0}]});
 const p=await A.preparar('Pasa la tinaja tonel de Luis Ortiz a cortesía',{diaActual:'2026-09-22',permiso:()=>true,buscar:async()=>[cortesia],cargarFinanzas:async()=>historico});
 assert.equal(p.estado,'already_courtesy');assert.match(p.mensaje,/ya está registrado como cortesía/i);assert.doesNotMatch(A.renderizar(p),/Confirmar cambio/);
 const nulo=candidato({tipo_cobro:'cortesia',total:null,motivo_cortesia:'Promo HAIKU'});
 assert.equal(A.evaluarElegibilidad(nulo,historico).estado,'bloqueada');
});

test('p_estado_esperado coincide exactamente con el contrato cerrado del RPC',()=>{
 const estado=A.estadoEsperado(candidato(),finanzas());
 assert.deepEqual(estado,{
  version:1,servicio_id:'s1',servicio_actualizado_en:'2026-09-20T10:00:00.000Z',tipo_cobro:'normal',total:30000,
  estado_servicio:'programado',estado_reserva:'checked_out',bove_checkout:null,cargo_id:'c1',cargo_estado:'activo',
  cargo_monto:30000,cargo_actualizado_en:'2026-09-20T10:00:01.000Z',aplicado_neto:0,saldo_cargo:30000,
  cantidad_cargos:1,cantidad_cargos_activos:1,cantidad_aplicaciones:0,cantidad_ajustes:0
 });
});

test('motivo es obligatorio y confirmar sólo simula tras revalidar',async()=>{
 let lecturas=0,rpc=0;
 const buscar=async()=>{lecturas++;return [candidato()];},cargar=async()=>finanzas();
 const p=await A.preparar('Haku cambia a cortesía la tinaja tonel de Luis Ortiz del 12-09',{diaActual:'2026-09-22',permiso:()=>true,buscar,cargarFinanzas:cargar,cliente:{rpc(){rpc++;throw Error('No debe llamarse');}}});
 assert.equal((await A.confirmar(p,'   ',{operacionId:'op1'})).estado,'bloqueada');
 const r=await A.confirmar(p,'  Promo HAIKU  ',{operacionId:'00000000-0000-4000-8000-000000000001'});
 assert.equal(r.estado,'simulada');assert.equal(r.rpc,'haiku_cambiar_servicio_a_cortesia_v1');assert.equal(r.parametros.p_motivo,'Promo HAIKU');
 assert.equal(r.parametros.p_servicio_id,'s1');assert.deepEqual(r.parametros.p_estado_esperado,p.p_estado_esperado);
 assert.equal(lecturas,2);assert.equal(rpc,0);assert.match(A.renderizar(r),/No se llamó a Supabase/);
});

test('módulo y cargador mantienen esta etapa estrictamente read-only y aislada',()=>{
 const source=fs.readFileSync('js/supabase-asistente-servicios-cortesia-v1.js','utf8');
 assert.doesNotMatch(source,/\.rpc\s*\(|\.(?:insert|update|upsert|delete)\s*\(|localStorage|sessionStorage|HAIKU_LIBRO|serviciosRegistrados/);
 assert.match(source,/\.from\('servicios'\)/);assert.match(source,/\.from\('cargos'\)/);assert.match(source,/Ejecución remota deshabilitada/);
 const panel=fs.readFileSync('panel.html','utf8');assert.match(panel,/supabase-asistente-servicios-cortesia-v1/);
});
