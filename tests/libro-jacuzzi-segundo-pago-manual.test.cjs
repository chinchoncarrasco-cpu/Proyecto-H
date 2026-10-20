const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
const {entorno}=require('./fixtures/libro-medio-pago-manual.cjs');
const conceptoEsExtra=valor=>/\b(?:tinaja|jacuzzi)\b/i.test(valor) &&
 /\b[12]\s*(?:adl|adultos?|personas?)\s*(?:extra|adicional(?:es)?)\b/i.test(valor);
test('TINAJA 2ADL EXTRA requiere la aprobación del segundo pago',()=>{
 assert.equal(conceptoEsExtra('TINAJA 2ADL EXTRA'),true);
 assert.match(source,/!pagosEfectivosMedio\.has\(p\) && !esPagoExtraJacuzzi/);
});
test('la tinaja original no requiere otra aprobación por error',()=>{
 assert.equal(conceptoEsExtra('TINAJA'),false);
});
test('el segundo pago exige aprobación explícita y confirmación con destino financiero exacto',async()=>{
 const h=entorno({alojamiento:false,conServicios:true});
 const servicio=h.tablas.servicios[0],cargo=h.tablas.vista_estado_cargos[0];
 Object.assign(servicio.catalogo_servicios,{codigo:'tinajaJacuzzi',nombre:'Tinaja Jacuzzi'});
 Object.assign(servicio,{personas:5,total:50000,monto_adicional:20000});
 Object.assign(cargo,{concepto:'Tinaja Jacuzzi',monto:50000,monto_ajustado:50000,aplicado_neto:30000,saldo_cargo:20000});
 Object.assign(h.r.pagos[0],{concepto:'TINAJA 2ADL EXTRA',monto:20000,medio_pago:'tarjeta_debito',
  texto_original:'Ignacio Herrera // TINAJA 2ADL EXTRA // $20.000 // CodAut IGNACIO30'});
 h.tablas.pagos.push({id:'00000000-0000-4000-8000-000000000051',reserva_id:servicio.reserva_id,
  monto:30000,medio_pago:'tarjeta_debito',codigo_autorizacion:'ORIGINAL30',
  fecha_pago:'2026-10-03',estado:'confirmado',tipo_movimiento:'pago'});
 const escrituras=()=>h.llamadas.filter(x=>x.nombre&&!x.nombre.includes('capacidad'));
 const plan=await h.preparar(),item=h.item(plan);
 assert.equal(item.categoria,'dudosos');assert.equal(item.seleccionado,false);
 assert.equal(item.payload.aprobado_manualmente,false);
 await assert.rejects(h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db),/Selecciona/);
 assert.equal(escrituras().length,0);
 h.aprobados.add(item.id);
 const aprobado=await h.preparar(),pago=h.item(aprobado);
 assert.equal(pago.categoria,'pagos');assert.equal(pago.seleccionado,true);
 assert.equal(pago.payload.aprobado_manualmente,true);
 assert.equal(pago.payload.argumentos.p_monto,20000);
 assert.equal(pago.payload.contrato,'aplicaciones_servicio_v1');
 const aplicaciones=pago.payload.datos_origen.aplicaciones_servicio_v1.aplicaciones;
 assert.deepEqual(Array.from(aplicaciones,a=>({cargo_id:a.cargo_id,monto:a.monto})),[{cargo_id:cargo.cargo_id,monto:20000}]);
 assert.equal(aplicaciones[0].saldo_esperado,20000);
 assert.equal(aplicaciones[0].aplicado_esperado,30000);
 assert.equal(escrituras().length,0);
 await h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,aprobado,h.db);
 assert.deepEqual(Array.from(escrituras(),x=>x.nombre),['haiku_incorporar_pago_servicios_libro_v1']);
});
