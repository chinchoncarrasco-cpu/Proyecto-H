const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function api() {
 const source=fs.readFileSync(require.resolve('../js/supabase-resumen-tablero-v1.js'),'utf8');
 const inicio=source.indexOf('    function estadoRealCabana');
 const fin=source.indexOf('    function resumenContexto',inicio);
 const context=vm.createContext({});
 vm.runInContext(`${source.slice(inicio,fin)};globalThis.api={estadoRealCabana,estadoVisualContexto,aplicarEstadoRealFila};`,context);
 return context.api;
}

function fila() {
 const clases=new Set();
 return {clases,elemento:{classList:{add:x=>clases.add(x),remove:(...xs)=>xs.forEach(x=>clases.delete(x))}}};
}

test('el resumen pinta cada cabaña por su estado real de estadía',()=>{
 const a=api();
 for(const [estado,clase] of [
  ['confirmada','cabana-estado-confirmada'],
  ['pendiente','cabana-estado-pendiente'],
  ['hospedada','cabana-estado-hospedada'],
  ['checked_out','cabana-estado-checked-out']
 ]) {
  const f=fila();a.aplicarEstadoRealFila(f.elemento,{estado:'continua',estadoEstadia:estado});
  assert.deepEqual([...f.clases],[clase]);
 }
});

test('bloqueada conserva prioridad roja sobre el estado de reserva',()=>{
 const a=api(),f=fila();
 a.aplicarEstadoRealFila(f.elemento,{estado:'bloqueada',estadoEstadia:'confirmada'});
 assert.deepEqual([...f.clases],[]);
 assert.equal(a.estadoVisualContexto({estado:'bloqueada',estadoEstadia:'checked_out'}),'bloqueada');
});

test('los colores de fila coinciden con los botones y el gris solicitado',()=>{
 const css=fs.readFileSync(require.resolve('../css/supabase-resumen-desktop-v1.css'),'utf8');
 assert.match(css,/cabana-estado-confirmada[\s\S]*?background:\s*#66CEF5/i);
 assert.match(css,/cabana-estado-pendiente[\s\S]*?background:\s*#95D6D3/i);
 assert.match(css,/cabana-estado-hospedada[\s\S]*?background:\s*#45B16D/i);
 assert.match(css,/cabana-estado-checked-out[\s\S]*?background:\s*#A0A0A0/i);
});
