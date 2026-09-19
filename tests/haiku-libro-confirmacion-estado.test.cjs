const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('a finished data conflict replaces the stale in-progress notice',()=>{
 let clickHandler=null, observerCallback=null, estado=null;
 const aviso={textContent:'Comprobando cambios recientes y ejecutando la incorporación completa…'};
 const acciones={insertAdjacentElement(_pos,element){estado=element;}};
 const card={isConnected:true,textContent:'',querySelector(selector){
  if(selector===':scope > .haiku-incorporacion-aviso')return aviso;
  if(selector===':scope > .haiku-confirmacion-estado-v1')return estado;
  return null;
 },querySelectorAll(){return [];}};
 const boton={disabled:false,isConnected:true,textContent:'Revalidando y guardando…',closest(selector){
  if(selector==='.haiku-asistente-preview.haiku-incorporacion')return card;
  if(selector==='.haiku-incorporacion-acciones')return acciones;
  return null;
 }};
 const context={console,document:{
  getElementById(){return {};},head:{appendChild(){}},createElement(){return {className:'',textContent:'',isConnected:true,scrollIntoView(){}};},
  addEventListener(type,handler){if(type==='click')clickHandler=handler;}
 },MutationObserver:class{constructor(callback){observerCallback=callback;}observe(){}disconnect(){}},
 requestAnimationFrame(callback){callback();},setTimeout(){},globalThis:null};
 context.globalThis=context;
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-confirmacion-estado-v1.js'),'utf8'),context);
 assert.ok(clickHandler);
 clickHandler({target:{closest(){return boton;}},preventDefault(){},stopImmediatePropagation(){}});
 assert.match(estado.textContent,/revalidando/i);
 aviso.textContent='No se guardó nada: El identificador del pago ya no es inequívoco. Vuelve a comparar.';
 observerCallback();
 assert.match(estado.className,/--error/);
 assert.equal(estado.textContent,aviso.textContent);
 assert.equal(boton.textContent,'Volver a comparar con datos actuales');
});
