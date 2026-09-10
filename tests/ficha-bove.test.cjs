const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function ficha() {
 const ids={},events={},reads=[];let data={},core={reserva:{id:'r1'},estadias:[]},error=null;
 class El {
  constructor(){this.children=[];this.dataset={};this.hidden=false;this.textContent='';}
  append(...xs){for(const x of xs){this.children.push(x);if(x.id)ids[x.id]=x;}}
  appendChild(x){this.append(x)} replaceChildren(...xs){this.textContent='';this.children=xs;} setAttribute(){}
 }
 ids['ficha-reserva-modal']=new El();ids['ficha-reserva-modal'].dataset.reservaId='r1';
 const header=new El();
 const context={console:{info(){},warn(){},error(){}},
 document:{head:new El(),createElement:()=>new El(),getElementById:id=>ids[id]||null,querySelector:()=>header,querySelectorAll:()=>[],addEventListener(){}},
 addEventListener:(t,f)=>events[t]=f,
 haikuSupabase:{rpc:async()=>({data:core}),from(table){const read={table};reads.push(read);const b={select(fields){read.fields=fields;return b;},eq(k,v){read.filter=[k,v];return b;},order:async()=>({data:[]}),single:async()=>({data,error}),then(f){return Promise.resolve({data:[]}).then(f);}};return b;}}};context.window=context;
 let source=fs.readFileSync(require.resolve('../js/supabase-ficha-v2.js'),'utf8');
 source=source.replace(/\}\)\(\);\s*$/,`pintarEstado=pintarServicios=pintarPagos=pintarSolicitudes=pintarNotas=()=>{};window.testFicha={leerBoves,pintarBoves,cargarFicha,pintarFicha};})();`);
 vm.runInNewContext(source,context);
 const texto=el=>el?[el.textContent,...el.children.map(texto)].join(' '):'';
 return {api:context.testFicha,ids,reads,events,header,setData:x=>data=x,setCore:x=>core=x,setError:x=>error=x,texto:()=>texto(ids['ficha-reserva-boves'])};
}
for(const [datos,expected] of [[{bove_cierre:'101'},/Alojamiento 101/],[{bove_checkout:'202'},/Servicios 202/],[{bove_cierre:'101',bove_checkout:'202'},/Alojamiento 101.*Servicios 202/]])test('BOVE fuentes '+JSON.stringify(datos),()=>{
 const h=ficha();h.api.pintarBoves(datos);assert.match(h.texto(),expected);
});
test('mismo número una sola vez con ambos alcances, sin inferir boleta combinada',()=>{
 const h=ficha();h.api.pintarBoves({bove_cierre:'00101',bove_checkout:'00101'});assert.equal(h.texto().split('00101').length-1,1);assert.match(h.texto(),/Alojamiento \/ Servicios/);
});
test('null, vacío y BOVTAR de pagos nunca producen boleta',()=>{
 const h=ficha();for(const r of [{},{bove_cierre:null,bove_checkout:' '},{pagos:[{bove:'987654'}],bove:'987654'}]){h.api.pintarBoves(r);assert.equal(h.ids['ficha-reserva-boves'].hidden,true);assert.doesNotMatch(h.texto(),/987654/);}
});
test('lectura mínima sólo reservas por ID; reutiliza core cuando incluye ambos campos',async()=>{
 const h=ficha();h.setData({bove_cierre:'101',bove_checkout:null});await h.api.leerBoves('r1');assert.deepEqual(h.reads,[{table:'reservas',fields:'bove_cierre,bove_checkout',filter:['id','r1']}]);
 await h.api.leerBoves('r1',{bove_cierre:null,bove_checkout:'202'});assert.equal(h.reads.length,1);
});
test('cargar ficha integra BOVE sin fallar el resto ante lectura parcial',async()=>{
 const h=ficha();h.setData({bove_cierre:'101'});let r=await h.api.cargarFicha('r1');assert.equal(r.boves.bove_cierre,'101');h.setError(Error('Red'));r=await h.api.cargarFicha('r1');assert.equal(r.errorBoves,true);assert.equal(r.reserva.id,'r1');
});
test('evento de reserva abierta refresca únicamente BOVE; otra reserva o ficha cerrada no leen',async()=>{
 const h=ficha();h.setData({bove_cierre:'303'});await h.events['haiku:bove-actualizado']({detail:{reservaId:'r1'}});assert.match(h.texto(),/303/);assert.equal(h.reads.length,1);
 await h.events['haiku:bove-actualizado']({detail:{reservaId:'r2'}});h.ids['ficha-reserva-modal'].hidden=true;
 await h.events['haiku:bove-actualizado']({detail:{reservaId:'r1'}});assert.equal(h.reads.length,1);
});
test('Full Day y múltiples estadías pintan un solo bloque por reserva y limpian valores anteriores',()=>{
 const h=ficha(),estadia={tipo_estadia:'fullday',cabana_numero:1,fecha_ingreso:'2026-09-01',fecha_salida:'2026-09-01'};
 h.api.pintarFicha({reserva:{id:'r1'},estadias:[estadia,estadia],boves:{bove_cierre:'101'}});
 h.api.pintarFicha({reserva:{id:'r1'},estadias:[estadia,estadia],boves:{bove_cierre:'101'}});
 assert.equal(h.header.children.length,1);assert.equal(h.texto().split('101').length-1,1);
 h.api.pintarFicha({reserva:{id:'r2'},estadias:[estadia],boves:{}});assert.equal(h.ids['ficha-reserva-boves'].hidden,true);
});
test('error al refrescar no mantiene un número como si la lectura fuera vigente',async()=>{
 const h=ficha();h.api.pintarBoves({bove_cierre:'101'});h.setError(Error('Red'));await h.events['haiku:bove-actualizado']({detail:{reservaId:'r1'}});assert.doesNotMatch(h.texto(),/101/);assert.match(h.texto(),/No se pudo actualizar/);
});
for(const [archivo,selector,tipo] of [['supabase-pagos-checkin-v5.js','.haiku-saldo-v5 [data-haiku-bove-registrar]','alojamiento'],['supabase-pagos-checkout-v1.js','[data-haiku-checkout-bove-registrar]','checkout']]){
 test('evento sólo tras RPC exitosa: '+tipo,async()=>{
  const src=fs.readFileSync(require.resolve('../js/'+archivo),'utf8'),at=src.indexOf('"'+selector+'"'),start=src.lastIndexOf('document.addEventListener("click", async evento => {',at),end=src.indexOf('}, true);',at)+9;
  const events=[];let callback,fallar=false,resolveRPC;
  const tarjeta={dataset:{reservaId:'r1'},querySelector:()=>({value:'101'})},boton={closest:()=>tarjeta,textContent:'Registrar'};
  const ctx={guardandoBove:false,cliente:{rpc:()=>new Promise(r=>{resolveRPC=()=>r(fallar?{error:Error('Falló')}:{data:{bove:'101'}});})},
   document:{addEventListener:(_,fn)=>callback=fn},window:{haikuTienePermiso:()=>true,dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail;}},
   cargarSaldosCheckinMixto:async()=>{},cargarCheckoutSupabase:async()=>{},fechaActual:()=>'',alert(){},console:{info(){},error(){}}};
  vm.runInNewContext(src.slice(start,end),ctx);
  const e={target:{closest:()=>boton},preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}};
  let p=callback(e);assert.equal(events.length,0);resolveRPC();await p;assert.equal(events.length,1);assert.equal(events[0].type,'haiku:bove-actualizado');assert.equal(events[0].detail.tipo,tipo);
  fallar=true;p=callback(e);resolveRPC();await p;assert.equal(events.length,1);
 });
}
