const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function cargarPintor() {
 const source=fs.readFileSync(require.resolve('../js/supabase-ficha-v2.js'),'utf8');
 const inicio=source.indexOf('    function limpiarClasesEstado');
 const fin=source.indexOf('    function pintarPagos',inicio);
 const clases=new Set();
 const campo={textContent:'',classList:{add:x=>clases.add(x),remove:(...xs)=>xs.forEach(x=>clases.delete(x))}};
 const context=vm.createContext({document:{getElementById:id=>id==='ficha-reserva-estado'?campo:null}});
 vm.runInContext(`${source.slice(inicio,fin)};globalThis.pintarEstado=pintarEstado;`,context);
 return {pintar:context.pintarEstado,campo,clases};
}

test('la ficha usa el estado de su cabaña dentro de una reserva grupal',()=>{
 const h=cargarPintor();
 h.pintar({reserva:{estado_reserva:'confirmada'},estadias:[{estado_estadia:'hospedada'}]});
 assert.equal(h.campo.textContent,'● Hospedado');
 assert.ok(h.clases.has('ficha-estado-hospedado'));

 h.pintar({reserva:{estado_reserva:'hospedada'},estadias:[{estado_estadia:'confirmada'}]});
 assert.equal(h.campo.textContent,'● Confirmada');
 assert.ok(h.clases.has('ficha-estado-confirmada'));
});

test('cancelación y no-show de la reserva mantienen prioridad',()=>{
 const h=cargarPintor();
 h.pintar({reserva:{estado_reserva:'cancelada'},estadias:[{estado_estadia:'hospedada'}]});
 assert.equal(h.campo.textContent,'● Cancelada');
 h.pintar({reserva:{estado_reserva:'no_show'},estadias:[{estado_estadia:'confirmada'}]});
 assert.equal(h.campo.textContent,'● No-Show');
});
