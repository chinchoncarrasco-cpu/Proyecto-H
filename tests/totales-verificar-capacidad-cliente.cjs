// Verificación local del cliente con respuestas obtenidas por SELECT.
// No conecta a Supabase, no invoca confirmar y rechaza cualquier writer.
const fs=require('node:fs'),assert=require('node:assert/strict');
const api=require('../js/supabase-asistente-totales-v1.js');
const entrada=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const tablas={reservas:entrada.reservas,vista_saldos_alojamiento_reserva:entrada.saldos,cargo_ajustes:entrada.ajustes_constanza};
const llamadas=[];
const cliente={from(t){const filtros=[];const q={select(){return q;},order(){return q;},eq(k,v){filtros.push(r=>r[k]===v);return q;},async range(a,b){return {data:structuredClone(tablas[t].filter(r=>filtros.every(f=>f(r))).slice(a,b+1))};}};return q;},async rpc(n){llamadas.push(n);assert.equal(n,'haiku_capacidad_totales_v1','Se prohíbe invocar el writer');return {data:entrada.capacidad};}};
(async()=>{const propuesta=await api.preparar('Haku cambia el total de CAB 9 Constanza Kutscher a CLP$160.000',{cliente,permiso:()=>true});
 assert.equal(propuesta.estado,'propuesta');assert.equal(propuesta.items[0].total_actual,180000);assert.equal(propuesta.items[0].total_objetivo,160000);
 const html=api.renderizar(propuesta);assert.match(html,/<button type="button" data-total-confirmar>Confirmar 1 cambio\(s\)<\/button>/);
 console.log(JSON.stringify({version:entrada.capacidad.version,estado:propuesta.estado,confirmar_habilitado_en_render:true,total_actual:propuesta.items[0].total_actual,objetivo:propuesta.items[0].total_objetivo,rpc_observadas:llamadas,writer_invocado:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
