const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const D=require('../js/haiku-libro-pagos-destinos-v1.js');
const S=require('../js/haiku-libro-semantica-v1.js');
const ui=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
const sql=fs.readFileSync(require.resolve('../supabase/migrations/20261016043000_libro_ampliar_jacuzzi_personas_extra_v1.sql'),'utf8');
const rid='11111111-1111-4111-8111-111111111111',eid='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333',cid='44444444-4444-4444-8444-444444444444';
const libro={id:'Oct26!C3',cabana:7,fecha_checkin:'2026-10-10',fecha_checkout:'2026-10-12'};
const destino={reserva_id:rid,estadia_id:eid,bloqueado:false};
const p={tipo_movimiento:'servicio',pago_recibido:true,estado_pago:'registrado_en_libro',moneda:'CLP',monto:20000,medio_pago:'debito',folio:'000370',bovtar:'651327',codigo_autorizacion:null,fecha_comprobante:'2026-10-12',fecha_bloque:'2026-10-10',origen:{hoja:'Oct26',celda:'AM59:AP59'},cabana:7,concepto:'TINAJA 2ADL EXTRA'};
function foto(personas=2,pagado=null){
 const total=30000+Math.max(personas-3,0)*10000,aplicado=pagado??30000;
 const c=[{libro,estado:'asociada',sistema:{id:eid,reserva_id:rid,cabana:7,fecha_checkin:libro.fecha_checkin,fecha_checkout:libro.fecha_checkout}}];
 c.snapshot={pagos_todos:[{reserva_id:rid,monto:30000,tipo_movimiento:'pago',estado:'confirmado',folio:'000369',bove:'627242'}],
 finanzas:{disponible:true,servicios:[{id:sid,reserva_id:rid,estadia_id:eid,catalogo_servicios:{codigo:'tinajaJacuzzi'},estado_servicio:'programado',cantidad:1,personas,total,precio_unitario_aplicado:30000,monto_adicional:total-30000,tipo_cobro:'normal',fecha_servicio:'2026-10-11',hora_inicio:'17:45:00'}],
 cargos:[{cargo_id:cid,servicio_id:sid,reserva_id:rid,estadia_id:eid,tipo_cargo:'servicio',estado:'activo',concepto:'Tinaja Jacuzzi',monto_ajustado:total,aplicado_neto:aplicado,saldo_cargo:total-aplicado}],
 aplicaciones:[],pagos:[]}};return c;
}
test('Libro reconoce concepto, 20 mil y autorización separada',()=>{
 const normal=S.normalizarHoja({celdas:[
 {r:1,c:2,valor:'10 oct',fechaISO:'2026-10-10'},{r:1,c:6,valor:'12 oct',fechaISO:'2026-10-12'},
 {r:2,c:0,valor:'cabaña 7'},{r:2,c:2,valor:'Persona Ejemplo // 2 noches // 3 ADL'},
 {r:24,c:2,valor:'Pagos de arriendos de hoy'},{r:25,c:0,valor:'cabaña 7'},
 {r:26,c:2,valor:'12-10-2026',fechaISO:'2026-10-12'},
 {r:26,c:3,valor:'Persona Ejemplo // FOLIO 000370 - BOVTAR 651327 // DEBITO // GO'},
 {r:26,c:4,valor:'TINAJA 2ADL EXTRA'},{r:26,c:5,valor:'20000',valorNumero:20000}
 ],combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}},{s:{r:25,c:0},e:{r:29,c:0}}],estilos:[]},'Oct26');
 const q=normal.pagos[0];assert.equal(q.tipo_movimiento,'servicio');assert.equal(q.monto,20000);
 assert.equal(q.folio,'000370');assert.equal(q.bovtar,'651327');
});
test('antes de ampliar: cargo $30.000 ya cubierto, no admite 20 mil',()=>{
 assert.equal(D.resolverTransaccion(p,rid,foto().snapshot.finanzas).estado,'ya_aplicada');
});
test('ampliación 3 incluidas + 2 extra crea $20.000 de saldo, sin nueva Jacuzzi',()=>{
 const x=D.proponerAmpliacionJacuzzi(p,libro,destino,foto());
 assert.ok(x);assert.equal(x.servicioId,sid);assert.equal(x.personasActuales,2);
 assert.equal(x.personasFinales,5);assert.equal(x.totalFinal,50000);
 assert.equal(x.montoAdicional,20000);assert.equal(x.origen.folio,'000370');
});
test('después de ampliar el mismo cargo acepta segundo pago $20.000',()=>{
 const f=foto(5),x=D.resolverTransaccion(p,rid,f.snapshot.finanzas);
 assert.equal(x.estado,'destino_unico');
 assert.equal(x.aplicaciones.length,1);
 assert.deepEqual(x.aplicaciones_payload,[{cargo_id:cid,monto:20000}]);
 assert.equal(f.snapshot.finanzas.cargos[0].aplicado_neto,30000);
});
test('permite también una sola persona: 3 a 4',()=>{
 const x=D.proponerAmpliacionJacuzzi({...p,monto:10000,concepto:'TINAJA 1 ADL EXTRA'},libro,destino,foto(3));
 assert.equal(x.personasFinales,4);assert.equal(x.totalFinal,40000);
});
test('segunda ampliación sólo si la primera ya fue pagada',()=>{
 const next={...p,monto:10000,concepto:'TINAJA 1 ADL EXTRA'};
 assert.equal(D.proponerAmpliacionJacuzzi(next,libro,destino,foto(4)),null);
 const x=D.proponerAmpliacionJacuzzi(next,libro,destino,foto(4,40000));
 assert.equal(x.personasFinales,5);assert.equal(x.totalFinal,50000);
});
test('mismo folio y autorización registrado impide nuevo cargo',()=>{
 const f=foto();
 f.snapshot.pagos_todos.push({tipo_movimiento:'pago',estado:'confirmado',folio:'000370',bove:'651327'});
 assert.equal(D.proponerAmpliacionJacuzzi(p,libro,destino,f),null);
});
test('cargo impago, duplicidad de servicio y conceptos no extra quedan fuera',()=>{
 assert.equal(D.proponerAmpliacionJacuzzi(p,libro,destino,foto(2,0)),null);
 const doble=foto();doble.snapshot.finanzas.servicios.push({...doble.snapshot.finanzas.servicios[0],id:'otro'});
 assert.equal(D.proponerAmpliacionJacuzzi(p,libro,destino,doble),null);
 assert.equal(D.proponerAmpliacionJacuzzi({...p,concepto:'TINAJA'},libro,destino,foto()),null);
});
test('dos pantallas Haku conectan ampliación y revalidación del pago sin escritura automática',()=>{
 assert.equal((ui.match(/aprobar\.ampliarJacuzzi = async item =>/g)||[]).length,2);
 assert.match(ui,/haiku_libro_ampliar_jacuzzi_v1/);
 assert.match(ui,/limpiarRevisionTrasAmpliarJacuzzi/);
 assert.match(ui,/El segundo pago NO se registrará/);
});
test('migración modifica exclusivamente el servicio con RPC autorizado y mismo cargo',()=>{
 assert.match(sql,/SECURITY DEFINER/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/p_adicionales IS NULL OR p_adicionales NOT IN/);
 assert.match(sql,/v_saldo IS DISTINCT FROM v_adicional/);
 assert.equal((sql.match(/UPDATE public\.servicios/gi)||[]).length,1);
 assert.doesNotMatch(sql,/(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\.(?:pagos|pago_aplicaciones)/i);
});
