const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'),'utf8');
const conceptoEsExtra=valor=>/\b(?:tinaja|jacuzzi)\b/i.test(valor) &&
 /\b[12]\s*(?:adl|adultos?|personas?)\s*(?:extra|adicional(?:es)?)\b/i.test(valor);
test('TINAJA 2ADL EXTRA requiere la aprobación del segundo pago',()=>{
 assert.equal(conceptoEsExtra('TINAJA 2ADL EXTRA'),true);
 assert.match(source,/!pagosEfectivosMedio\.has\(p\) && !esPagoExtraJacuzzi/);
});
test('la tinaja original no requiere otra aprobación por error',()=>{
 assert.equal(conceptoEsExtra('TINAJA'),false);
});
test('solo prepara pago mediante el flujo manual protegido',()=>{
 assert.match(source,/propuestaManualPago\(item,comp,root\.HAIKU_LIBRO_RESERVA_V1\?\.estado\?\.\(\)\.generacion\)/);
 assert.match(source,/payloadPagoServicio4C\(p, destino/);
});
